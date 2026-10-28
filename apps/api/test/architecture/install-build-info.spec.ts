import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseBuildInfo } from '../../src/modules/health/build-info';

/**
 * 🔴 설치본 산출물 기록(2026-09-14) — 리허설에서 설치본의 공개 버전 EP 가 `buildInfo: unavailable`·`commit: null` 이었다.
 *    deploy.sh 는 `apps/api/BUILD_INFO.json` 을 쓰는데 install.sh 는 쓰지 않아, 설치된 서버가 어느 릴리즈인지 증명할 수 없었다.
 *
 * 지키는 것:
 *  ① 형식 — `infra/install/build-info.sh` 의 `his_build_info_json` 이 deploy.sh `build_info_json`(형식 정본)과 **같은 입력에 같은 출력**
 *  ② 읽는 쪽 정본(`build-info.ts parseBuildInfo`)이 설치본 기록을 `source:'file'` 로 읽는다
 *  ③ 커밋 출처 3상태 — 저장소 루트(git) / 릴리즈 사본(RELEASE_COMMIT) / 모름(null) · 다른 저장소 안에 풀어 둔 사본이 바깥 HEAD 를 말하지 않는다
 *  ④ `git archive` 가 RELEASE_COMMIT 에 실제로 HEAD 를 박는다(export-subst — 속성 파일이 빠지면 릴리즈 사본이 전부 "모름"이 된다)
 *  ⑤ install.sh 배선 — 판정은 빌드 전, 기록은 dist 확인 뒤, 부팅 확인은 서버가 말한 커밋과 대조
 */

const ROOT = join(__dirname, '../../../..');
const LIB = join(ROOT, 'infra/install/build-info.sh');
const DEPLOY = readFileSync(join(ROOT, 'infra/scripts/deploy.sh'), 'utf8');
const INSTALL = join(ROOT, 'infra/install/install.sh');
const CONSTANTS = join(ROOT, 'packages/shared/src/constants.ts');
const HEX40 = 'a3f9c1d2e4b5a6978877665544332211aabbccdd';

const deployFn = (() => {
  const i = DEPLOY.indexOf('build_info_json() {');
  if (i < 0) throw new Error('deploy.sh 에 build_info_json() 가 없다');
  return DEPLOY.slice(i, DEPLOY.indexOf('\n}\n', i) + 3);
})();

const bash = (script: string, cwd = ROOT, env: Record<string, string> = {}) => {
  const r = spawnSync('bash', ['-c', `set -euo pipefail\n${script}`], {
    cwd, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const stripTime = (s: string) => s.replace(/"builtAt":"[^"]+"/, '"builtAt":"T"');

describe('① 형식 — install 기록 = deploy.sh 기록(같은 입력)', () => {
  const cases: Array<[string, string]> = [[HEX40, 'false'], ['abcdef1234567', 'true'], ['', '']];
  for (const [commit, dirty] of cases) {
    it(`commit=${commit || '(없음)'} dirty=${dirty || '(모름)'}`, () => {
      const viaDeploy = bash(`${deployFn}\nLOCAL_DIR='${ROOT}'; BUILD_COMMIT='${commit}'; BUILD_DIRTY='${dirty}'\nbuild_info_json`);
      const viaInstall = bash(`. '${LIB}'\nhis_build_info_json '${CONSTANTS}' '${commit}' '${dirty}' deploy.sh`);
      expect(viaDeploy.code, viaDeploy.err).toBe(0);
      expect(viaInstall.code, viaInstall.err).toBe(0);
      expect(stripTime(viaInstall.out)).toBe(stripTime(viaDeploy.out));
    });
  }

  it('형식이 아닌 값은 기록하지 않는다 — "unknown" 문자열·치환 전 $Format$·yes 가 파일에 남지 않는다', () => {
    const r = bash(`. '${LIB}'\nhis_build_info_json '${CONSTANTS}' '$Format:%H$' 'yes' install.sh unknown`);
    expect(r.code, r.err).toBe(0);
    const o = JSON.parse(r.out);
    expect(o.commit).toBeNull();
    expect(o.dirty).toBeNull();
  });
});

describe('② 읽는 쪽 정본이 설치본 기록을 읽는다', () => {
  it('commitSource 가 붙어도 source=file · commit·dirty·recordedVersion 이 그대로', () => {
    const r = bash(`. '${LIB}'\nhis_build_info_json '${CONSTANTS}' '${HEX40}' '' install.sh release`);
    const b = parseBuildInfo(r.out);
    expect(b.source).toBe('file');
    expect(b.commit).toBe(HEX40);
    expect(b.dirty, '릴리즈 사본의 dirty 는 모름').toBeNull();
    expect(b.recordedVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(JSON.parse(r.out).commitSource).toBe('release');
  });
});

describe('③ 커밋 출처 3상태', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'his-bi-')); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const resolve = (root: string) => {
    const r = bash(`. '${LIB}'\nhis_resolve_commit '${root}'\necho "SRC=$HIS_BUILD_COMMIT_SOURCE C=$HIS_BUILD_COMMIT D=$HIS_BUILD_DIRTY"`);
    expect(r.code, r.err).toBe(0);
    return r.out.trim();
  };
  const git = (cwd: string, ...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

  it('저장소 루트 — HEAD · clean=false · 산출물 경로에 변경이 생기면 dirty=true', () => {
    mkdirSync(join(tmp, 'apps'), { recursive: true });
    writeFileSync(join(tmp, 'apps/a.txt'), 'a');
    git(tmp, 'init', '-q'); git(tmp, 'add', '.'); git(tmp, 'commit', '-qm', 'x');
    const head = git(tmp, 'rev-parse', 'HEAD').stdout.trim();
    expect(resolve(tmp)).toBe(`SRC=git C=${head} D=false`);
    writeFileSync(join(tmp, 'apps/b.txt'), 'b');
    expect(resolve(tmp)).toBe(`SRC=git C=${head} D=true`);
  });

  it('릴리즈 사본 — RELEASE_COMMIT 의 40자 hex · dirty 는 모름', () => {
    mkdirSync(join(tmp, 'infra/install'), { recursive: true });
    writeFileSync(join(tmp, 'infra/install/RELEASE_COMMIT'), `${HEX40}\n`);
    expect(resolve(tmp)).toBe(`SRC=release C=${HEX40} D=`);
  });

  it('모름 — 치환 전 $Format:%H$(작업 트리 사본)는 커밋이 아니다', () => {
    mkdirSync(join(tmp, 'infra/install'), { recursive: true });
    writeFileSync(join(tmp, 'infra/install/RELEASE_COMMIT'), '$Format:%H$\n');
    expect(resolve(tmp)).toBe('SRC=unknown C= D=');
  });

  it('🔴 다른 저장소 안에 풀어 둔 사본은 바깥 저장소의 HEAD 를 말하지 않는다', () => {
    const inner = join(tmp, 'vendor/his');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(tmp, 'outer.txt'), 'o');
    git(tmp, 'init', '-q'); git(tmp, 'add', '.'); git(tmp, 'commit', '-qm', 'outer');
    expect(resolve(inner)).toBe('SRC=unknown C= D=');
  });
});

describe('④ git archive 가 RELEASE_COMMIT 에 HEAD 를 박는다(export-subst)', () => {
  const isRepo = existsSync(join(ROOT, '.git'));
  it.skipIf(!isRepo)('archive 사본의 RELEASE_COMMIT = rev-parse HEAD', () => {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    const ar = spawnSync('bash', ['-c', 'git archive --format=tar HEAD infra/install/RELEASE_COMMIT | tar -xO infra/install/RELEASE_COMMIT'], { cwd: ROOT, encoding: 'utf8' });
    expect(ar.status, ar.stderr).toBe(0);
    expect(ar.stdout.trim()).toBe(head);
  });
});

describe('⑤ install.sh 배선', () => {
  const code = readFileSync(INSTALL, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('판정은 빌드 전 · 기록은 dist 확인 뒤 · 기록 형식은 공용 함수', () => {
    const resolveAt = code.indexOf('his_resolve_commit "$ROOT"');
    const nest = code.indexOf('npx nest build');
    const distCheck = code.indexOf('test -f "$API/dist/main.js"');
    const write = code.indexOf('> "$API/BUILD_INFO.json"');
    expect(resolveAt, '커밋 판정이 없다').toBeGreaterThan(0);
    expect(resolveAt, '커밋 판정은 빌드 전').toBeLessThan(nest);
    expect(distCheck).toBeGreaterThan(nest);
    expect(write, '기록은 dist 확인 뒤(실패한 빌드가 새 커밋을 말하지 않게)').toBeGreaterThan(distCheck);
    expect(code).toMatch(/his_build_info_json "\$ROOT\/packages\/shared\/src\/constants\.ts" "\$HIS_BUILD_COMMIT" "\$HIS_BUILD_DIRTY" "install\.sh"/);
  });

  it('부팅 확인이 서버가 말한 커밋·buildInfo=file 을 기록과 대조한다(모르면 commit:null 을 기대)', () => {
    expect(code).toMatch(/EXPECT_COMMIT='"commit":null'/);
    expect(code).toMatch(/\*"\$EXPECT_COMMIT"\*'"buildInfo":"file"'\*\)/);
  });
});
