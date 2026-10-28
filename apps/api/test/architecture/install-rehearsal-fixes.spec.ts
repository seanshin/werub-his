import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

/**
 * 🔴 빈 환경 설치 리허설(G9 로컬 선행 · 2026-09-14)에서 `infra/install/install.sh` 가 **실제로 멈춘 자리** 4곳의 가드.
 *
 * 리허설: node:22-bookworm · postgres:16-alpine · redis:7-alpine 컨테이너(8GB)에 `git archive HEAD` 사본을 넣고
 * 설치 가이드대로 진행했다. 개발기에서는 하나도 보이지 않던 것들이다(개발기에는 dist 가 남아 있고 셸에 env 가 있고 힙이 크다).
 *   ① 가이드는 루트 `.env` 를 만들라는데 스크립트는 환경변수만 봤다 → 0단계 "DATABASE_URL 이 비었습니다".
 *   ② `packages/shared/dist` 는 저장소에 없다 → `nest build` 가 `@hospital-run/shared` 를 못 찾아 178 오류.
 *   ③ Node 기본 힙(heap_size_limit 2,096MB)에서 `nest build` 가 OOM 으로 죽었다(실측 피크 약 4.0GB).
 *   ④ 2단계 이후 실패하면 테이블이 남아 재실행이 1단계에서 멈춘다 — 무엇을 해야 하는지 말하지 않았다.
 *
 * (a)(b)(d) 는 **스크립트를 실제로 실행**한다 — 가짜 `psql`(테이블 수만 답한다)을 PATH 앞에 두고 0~1단계까지 돌린다.
 * (c) 는 7단계 순서라 실행 대신 소스 순서로 본다(빌드는 수 분 걸린다 — 리허설 로그가 실행 증거다).
 */

const ROOT = join(__dirname, '../../../..');
const INSTALL = join(ROOT, 'infra/install/install.sh');
const MANIFEST = join(ROOT, 'infra/install/masters.manifest.tsv');
const NODE_MAJOR = process.versions.node.split('.')[0];

let tmp: string;
let bin: string;

/** 임시 저장소 모양: <tmp>/infra/install/{install.sh,manifest} · .nvmrc · node_modules/ · 가짜 psql */
function layout(opts: { env?: string; tables?: string }) {
  mkdirSync(join(tmp, 'infra/install'), { recursive: true });
  mkdirSync(join(tmp, 'node_modules'), { recursive: true });
  mkdirSync(join(tmp, 'apps/api'), { recursive: true });
  copyFileSync(INSTALL, join(tmp, 'infra/install/install.sh'));
  copyFileSync(MANIFEST, join(tmp, 'infra/install/masters.manifest.tsv'));
  // install.sh 가 source 한다(산출물 기록·빌드 메모리 판정) — 없으면 0단계 전에 죽는다
  copyFileSync(join(ROOT, 'infra/install/build-info.sh'), join(tmp, 'infra/install/build-info.sh'));
  copyFileSync(join(ROOT, 'infra/install/build-memory.sh'), join(tmp, 'infra/install/build-memory.sh'));
  writeFileSync(join(tmp, '.nvmrc'), `${NODE_MAJOR}\n`);
  if (opts.env !== undefined) writeFileSync(join(tmp, '.env'), opts.env);
  bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  // 가짜 psql — 테이블 수 질의에만 답한다(1단계). 그 뒤로는 가지 않게 테이블 수를 0 이 아닌 값으로 둔다.
  writeFileSync(join(bin, 'psql'), `#!/usr/bin/env bash\necho "${opts.tables ?? '565'}"\n`);
  chmodSync(join(bin, 'psql'), 0o755);
}

function run(env: Record<string, string> = {}) {
  // 메모리 판정은 이 스펙의 대상이 아니다 — 러너 메모리에 따라 결과가 갈리지 않게 "잴 수 없음"으로 고정(install-build-memory.spec 이 따로 본다)
  const clean: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: tmp,
    HIS_MEM_CGROUP_DIR: join(tmp, 'no-cgroup'), HIS_MEM_MEMINFO: join(tmp, 'no-meminfo'),
  };
  const r = spawnSync('bash', [join(tmp, 'infra/install/install.sh')], {
    cwd: tmp,
    env: { ...clean, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const FULL_ENV = [
  '# 설치 가이드대로 만든 .env',
  'HIS_MODE=REAL',
  'DATABASE_URL=postgresql://u:p@127.0.0.1:5432/his',
  'REDIS_URL=redis://127.0.0.1:6379',
  'AUTH_SECRET="quoted-auth-secret-0123456789abcdef"',
  'AUTH_REFRESH_SECRET=refresh-secret-0123456789abcdef',
  'ENCRYPTION_KEY=9f2c41a7be5d0837c6194e2ab8d503f71c0a6e94bd2738150fae6c39b7042d8e',
  '',
].join('\n');

describe('🔴 install.sh — 빈 환경 리허설에서 멈춘 자리(2026-09-14)', () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'his-install-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('대조군 — .env 가 없고 환경변수도 없으면 0단계에서 DATABASE_URL 로 멈춘다(이 표본이 없으면 (a)는 빈 검사다)', () => {
    layout({});
    const r = run();
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/DATABASE_URL 이 비었습니다/);
  });

  it('(a) ① 루트 .env 만 있어도 0단계를 지나 1단계(빈 DB 확인)까지 간다 — 따옴표 값도 읽는다', () => {
    layout({ env: FULL_ENV });
    const r = run();
    expect(r.out).toMatch(/\.env 읽음/);
    expect(r.out, '0단계 필수 키가 .env 에서 채워져야 한다').not.toMatch(/비었습니다|HIS_MODE=REAL 을 명시/);
    expect(r.out).toMatch(/1\/7 빈 DB 확인/);
  });

  it('(b) ① 이미 설정된 환경변수는 .env 가 덮지 않는다 — 명령행 HIS_MODE=DEV 가 파일의 REAL 을 이긴다', () => {
    layout({ env: FULL_ENV });
    const r = run({ HIS_MODE: 'DEV' });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/HIS_MODE=REAL 을 명시하세요\(현재: DEV\)/);
  });

  it('(d) ④ 테이블이 남은 DB 에서는 "새 빈 DB 로 다시" 를 말하고 멈춘다(데이터를 지우는 명령은 적지 않는다)', () => {
    layout({ env: FULL_ENV, tables: '565' });
    const r = run();
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/테이블 565개/);
    expect(r.out).toMatch(/새 빈 DB 를 만들어 다시 실행/);
    expect(r.out, '설치 스크립트가 DB 를 비우는 명령을 안내하면 안 된다').not.toMatch(/DROP SCHEMA|DROP DATABASE|dropdb/i);
  });

  it('(c) ②③ 7단계는 shared 를 먼저 빌드하고, 빌드 힙 기본값을 주며, 실패를 조용히 넘기지 않는다', () => {
    const code = readFileSync(INSTALL, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const shared = code.indexOf('packages/shared" && npm run build');
    const nest = code.indexOf('npx nest build');
    expect(shared, 'shared 빌드가 없다').toBeGreaterThan(0);
    expect(nest, 'nest build 가 없다').toBeGreaterThan(0);
    expect(shared, 'shared 빌드가 nest build 보다 앞이어야 한다(dist 가 저장소에 없다)').toBeLessThan(nest);
    // 힙 기본값은 이제 가용 메모리에서 정한다(하한 3072 — 기본 힙 134 실측) — 설치자가 정한 NODE_OPTIONS 는 덮지 않는다
    expect(code, '설치자가 정한 NODE_OPTIONS 는 존중하고 없을 때만 힙을 준다').toMatch(/if \[ -z "\$\{NODE_OPTIONS:-\}" \]; then[\s\S]{0,200}--max-old-space-size=\$\{HEAP_MB\}/);
    expect(code, '힙 하한 3072').toMatch(/\[ "\$HEAP_MB" -lt 3072 \] && HEAP_MB=3072/);
    expect(code, 'nest build 실패는 이유를 말하고 멈춘다').toMatch(/npx nest build[^\n]*\|\| fail/);
    expect(code, '떠 있는 서버가 REAL 이라고 말하는지 응답으로 확인한다').toMatch(/public\/version/);
  });

  it('(e) ⑤ 부팅 확인이 **다른 서버의 응답**을 성공으로 읽지 않는다 — 포트 선점 확인·node 직접 PID·응답 뒤 생존 확인·kill+wait', () => {
    // 리허설 실측: `(cd … && node … & echo $!)` 의 $! 는 서브셸 PID 라 kill 이 node 를 못 죽였다 → 고아 API 가 4시간 포트를 쥐고
    // 다음 설치의 /health 에 대신 답했다(새 서버는 EADDRINUSE 로 죽었는데 7단계 "성공").
    const code = readFileSync(INSTALL, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const precheck = code.indexOf('이미 서버가 응답합니다');
    const start = code.search(/^\s*HIS_MODE=REAL node dist\/main\.js[^\n]*&\s*$/m);
    expect(precheck, '포트 선점 확인이 없다').toBeGreaterThan(0);
    expect(start, 'node 를 직접 백그라운드로 띄워야 $! 가 node 다').toBeGreaterThan(0);
    expect(precheck, '포트 선점 확인은 기동보다 앞이어야 한다').toBeLessThan(start);
    expect(code, '서브셸 안에서 띄우면 $! 가 node 가 아니다').not.toMatch(/\(cd[^)\n]*node dist\/main\.js[^)\n]*&/);
    expect(code).toMatch(/BOOT_PID=\$!/);
    expect(code, '응답 뒤 우리 프로세스가 살아 있는지 본다').toMatch(/"\$OK" = 1 \] && ! kill -0 "\$BOOT_PID"/);
    expect(code, '끄고 기다린다(고아를 남기지 않는다)').toMatch(/kill "\$BOOT_PID"[^\n]*\n\s*wait "\$BOOT_PID"/);
  });
});
