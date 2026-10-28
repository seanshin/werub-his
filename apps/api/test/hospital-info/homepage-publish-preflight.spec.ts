import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * 공개 사이트 '빌드·발행'(3306) — HIS 안에서 업데이트가 끝까지 가는가를 **말하는** 계약(2026-09-15).
 *
 * 🔴 실측(09-15): ① 서버의 apps/homepage 사본이 **09-01 소스**였다(--homepage 만 갱신) — 키가 정상이었다면
 *    2주 전 코드를 발행하고 '발행 완료'라 했을 것 ② AWS 키가 만료돼 매번 S3 에서 실패하는데 화면은 '설정됨'
 *    ③ S3 에서 실패한 1506 을 "최신 발행(1506)"이라 부르며 라이브와 대조 ④ 5분 빌드를 다 돌리고 나서야 자격 실패.
 */
const safeFetchMock = vi.fn();
vi.mock('../../src/common/util/safe-fetch', () => ({
  safeFetch: (...a: unknown[]) => safeFetchMock(...a),
  EgressBlockedError: class EgressBlockedError extends Error {},
}));
const { HospitalInfoService } = await import('../../src/modules/hospital-info/hospital-info.service');

const ROOT = resolve(__dirname, '../../../..');

describe('발행 기준은 마지막 *성공* 발행 — 실패한 시도를 발행이라 부르지 않는다', () => {
  let dir: string; let svc: any;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hp-pub-'));
    const cfg: Record<string, string> = { HOMEPAGE_PUBLIC_URL: 'https://hospital.example.org', HOMEPAGE_BUILD_STATUS: join(dir, 'status.json') };
    svc = new HospitalInfoService({} as any, { get: (k: string) => cfg[k] } as any);
    safeFetchMock.mockReset();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('🔴 마지막 시도가 S3 실패면 그 ts 로 라이브를 대조하지 않는다 — 발행 기록 파일의 ts 가 기준', async () => {
    writeFileSync(join(dir, 'status.json'), JSON.stringify({ status: 'failed', ts: '20260915-1506', stage: 's3' }));
    writeFileSync(join(dir, 'homepage-last-published.json'), JSON.stringify({ ts: '20260909-1106' }));
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '20260909-1106' });
    const r = await svc.homepageLiveFreshness();
    expect(r.fresh).toBe(true);
    expect(r.detail).not.toContain('20260915-1506');
  });

  it('실패 시도만 있고 발행 기록이 없으면 비교 대상 없음(null) — 낡음으로 단정하지 않는다', async () => {
    writeFileSync(join(dir, 'status.json'), JSON.stringify({ status: 'failed', ts: '20260915-1506', stage: 's3' }));
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '20260909-1106' });
    const r = await svc.homepageLiveFreshness();
    expect(r.fresh).toBeNull();
  });

  it('대조군 — 기록 도입 전 성공 상태(deploy_triggered)는 발행으로 친다', () => {
    writeFileSync(join(dir, 'status.json'), JSON.stringify({ status: 'deploy_triggered', ts: '20260909-1106' }));
    expect(svc.readLastPublished()?.ts).toBe('20260909-1106');
  });
});

describe("'설정됨'은 스크립트 존재가 아니라 발행이 갈 수 있는가", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hp-pre-')); safeFetchMock.mockReset(); safeFetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => '' }); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const mk = (awsScript: string) => {
    const scripts = join(dir, 'infra/scripts'); mkdirSync(scripts, { recursive: true });
    writeFileSync(join(scripts, 'build-homepage.sh'), '#!/bin/sh\n');
    const hp = join(dir, 'apps/homepage'); mkdirSync(hp, { recursive: true });
    writeFileSync(join(hp, 'SOURCE_INFO.json'), JSON.stringify({ version: '4.19.0', commit: 'abcdef1234567', dirty: false, builtAt: '2026-09-15T06:00:00Z' }));
    const aws = join(dir, 'aws'); writeFileSync(aws, `#!/bin/sh\n${awsScript}\n`); chmodSync(aws, 0o755);
    const cfg: Record<string, string> = { HOMEPAGE_BUILD_SCRIPT: join(scripts, 'build-homepage.sh'), HOMEPAGE_AWS_BIN: aws, HOMEPAGE_BUILD_STATUS: join(dir, 'st.json') };
    return new HospitalInfoService({} as any, { get: (k: string) => cfg[k] } as any) as any;
  };

  it('🔴 자격 거부(InvalidClientTokenId) → configured=false · FAILED · 사유를 말한다', async () => {
    const r = await mk('echo "An error occurred (InvalidClientTokenId) when calling the GetCallerIdentity" >&2; exit 254').homepageDeployStatus();
    expect(r.preflight.script).toBe(true);
    expect(r.preflight.awsCredentials).toBe('FAILED');
    expect(r.configured).toBe(false);
    expect(r.preflight.awsDetail).toContain('거부');
  });

  it('대조군 — 자격 정상이면 configured=true · 소스 커밋을 읽는다', async () => {
    const r = await mk('echo "{}"; exit 0').homepageDeployStatus();
    expect(r.preflight.awsCredentials).toBe('OK');
    expect(r.configured).toBe(true);
    expect(r.source.commit).toBe('abcdef1234567');
  });

  it('분류 못 한 실패는 FAILED 가 아니라 UNKNOWN — 발행을 막는 말로 번역하지 않는다', async () => {
    const r = await mk('echo "Could not connect to the endpoint URL" >&2; exit 255').homepageDeployStatus();
    expect(r.preflight.awsCredentials).toBe('UNKNOWN');
    expect(r.configured).toBe(true);
  });
});

describe('🔴 빌드 스크립트 — 자격이 거부되면 빌드 전에 멈추고 소스 커밋을 기록한다(실행 검증)', () => {
  it('stage=credentials · sourceCommit · npm 을 부르지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hp-sh-'));
    try {
      const bin = join(dir, 'bin'); mkdirSync(bin);
      writeFileSync(join(bin, 'aws'), '#!/bin/sh\necho "InvalidClientTokenId" >&2\nexit 254\n'); chmodSync(join(bin, 'aws'), 0o755);
      writeFileSync(join(bin, 'npm'), `#!/bin/sh\ntouch ${join(dir, 'NPM_CALLED')}\n`); chmodSync(join(bin, 'npm'), 0o755);
      const src = join(dir, 'src'); mkdirSync(src);
      writeFileSync(join(src, 'SOURCE_INFO.json'), '{"version":"4.19.0","commit":"0123456789abcdef","dirty":false}');
      const st = join(dir, 'status.json');
      const r = spawnSync('bash', [join(ROOT, 'infra/scripts/build-homepage.sh')], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOMEPAGE_SRC: src, HOMEPAGE_BUILD_STATUS: st }, encoding: 'utf8', timeout: 30_000,
      });
      expect(r.status).toBe(1);
      const j = JSON.parse(readFileSync(st, 'utf8'));
      expect(j.status).toBe('failed');
      expect(j.stage).toBe('credentials');
      expect(j.sourceCommit).toBe('0123456789abcdef');
      expect(() => readFileSync(join(dir, 'NPM_CALLED'))).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('🔴 HIS 배포(--api)가 홈페이지 소스를 서버에 올리고 커밋을 기록한다', () => {
  const SH = readFileSync(join(ROOT, 'infra/scripts/deploy.sh'), 'utf8');
  const body = (name: string) => { const i = SH.indexOf(`${name}() {`); expect(i, `${name} 없음`).toBeGreaterThan(-1); return SH.slice(i, SH.indexOf('\n}\n', i)); };

  it('deploy_sentinel(--api 경로)이 sync_homepage_source 를 부른다', () => {
    expect(body('deploy_sentinel')).toMatch(/^\s*sync_homepage_source\s*$/m);
    expect(SH).toMatch(/--api\)\s+deploy_api; deploy_sentinel/);
  });

  it('sync_homepage_source 가 apps/homepage 를 올리고 SOURCE_INFO.json 을 쓴다', () => {
    const f = body('sync_homepage_source');
    expect(f).toContain('apps/homepage/');
    expect(f).toContain('SOURCE_INFO.json');
    expect(f).toContain('build_info_json');
  });
});

describe('🔴 로컬 발행(deploy.sh --homepage)도 빌드 스탬프·소스 커밋을 심는다', () => {
  it('deploy_homepage 가 build-stamp.txt 와 build-source.txt 를 쓴다', () => {
    const SH = readFileSync(join(ROOT, 'infra/scripts/deploy.sh'), 'utf8');
    const i = SH.indexOf('deploy_homepage() {');
    const f = SH.slice(i, SH.indexOf('\n}\n', i));
    expect(f).toMatch(/printf '%s' "\$TS" > "\$\{ISO\}\/public\/build-stamp\.txt"/);
    expect(f).toContain('build-source.txt');
  });
});
