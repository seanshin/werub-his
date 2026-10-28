import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

/**
 * 🔴 릴리즈 고정 장치 가드 (2026-09-13 · 상용 릴리즈 기획 T1-1·T1-4·T2-6·T3-5).
 *
 * 실측 결함:
 *  · 버전 — `HIS_VERSION` v4.19.0 인데 워크스페이스 package.json 6개가 1.0.0·1.5.0·0.1.0 으로 제각각(정본과 무관).
 *  · 배포 — 원천이 working tree rsync 라 미커밋 코드가 나갔고 커밋 기록 0 · 서버 빌드가 의존성을 설치하지 않았다 ·
 *    서버 Node 를 확인하지 않았다 · 서버 주소·경로가 스크립트에 박혀 다른 설치 대상에 쓸 수 없었다.
 *
 * 문자열이 아니라 **실행해서** 확인한다(`deploy-public-site-notice.spec.ts` 선례 — 함수를 뽑아 stub 과 함께 돌린다).
 */
const ROOT = join(process.cwd(), '..', '..');
const SH = readFileSync(join(ROOT, 'infra', 'scripts', 'deploy.sh'), 'utf8');
const fnOf = (name: string) => {
  const i = SH.indexOf(`${name}() {`);
  if (i < 0) throw new Error(`deploy.sh 에 ${name}() 가 없다`);
  return SH.slice(i, SH.indexOf('\n}\n', i) + 3);
};

describe('T1-1 버전 정본 — package.json·lock 이 HIS_VERSION 을 따른다', () => {
  const run = (cwd: string, ...args: string[]) =>
    spawnSync('node', [join(cwd, 'scripts', 'sync-version.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 30_000 });

  it('현재 트리는 일치한다', () => {
    const r = run(ROOT, '--check');
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('🔴 재주입 — 매니페스트 하나를 어긋나게 하면 --check 가 실패한다(사본 트리)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ver-'));
    try {
      mkdirSync(join(dir, 'scripts'));
      cpSync(join(ROOT, 'scripts', 'sync-version.mjs'), join(dir, 'scripts', 'sync-version.mjs'));
      for (const f of ['package.json', 'package-lock.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/homepage/package.json', 'apps/mobile/package.json', 'packages/shared/package.json', 'packages/shared/src/constants.ts']) {
        mkdirSync(join(dir, f, '..'), { recursive: true });
        cpSync(join(ROOT, f), join(dir, f));
      }
      const p = join(dir, 'apps/web/package.json');
      const before = readFileSync(p, 'utf8');
      const after = before.replace(/("version"\s*:\s*)"[^"]*"/, '$1"9.9.9"');
      expect(after, '주입이 무동작이다').not.toBe(before);
      writeFileSync(p, after);
      const r = run(dir, '--check');
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('apps/web/package.json 9.9.9');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('T1-4 산출물 커밋 고정 — dirty tree 는 명시 없이 배포하지 않는다(실행 검증)', () => {
  const runGit = (setup: string, allowDirty = '') => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    try {
      writeFileSync(join(dir, 'fn.sh'), fnOf('preflight_git'));
      const script = [
        'set -euo pipefail',
        `cd ${dir}`, 'git init -q repo', 'cd repo', 'git config user.email t@t', 'git config user.name t',
        'mkdir -p apps/api && echo a > apps/api/a.ts && git add -A && git commit -qm init',
        setup,
        'log(){ echo "$1"; }',
        `LOCAL_DIR=${dir}/repo; ALLOW_DIRTY='${allowDirty}'; BUILD_COMMIT=''; BUILD_DIRTY=''`,
        `source ${dir}/fn.sh`,
        'if preflight_git; then echo "RC=0 DIRTY=$BUILD_DIRTY COMMIT=${BUILD_COMMIT:0:7}"; else echo "RC=1"; fi',
      ].join('\n');
      return spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 30_000 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it('대조군 — clean 이면 통과하고 커밋을 기록한다', () => {
    const r = runGit(':');
    expect(r.stdout).toMatch(/RC=0 DIRTY=false COMMIT=[0-9a-f]{7}/);
  });

  it('🔴 배포 경로에 미커밋 변경 → 중단(RC=1)', () => {
    const r = runGit('echo b >> apps/api/a.ts');
    expect(r.stdout).toContain('RC=1');
    expect(r.stdout).toContain('커밋되지 않은 변경');
  });

  it('--allow-dirty 면 진행하되 dirty=true 로 기록한다', () => {
    const r = runGit('echo b >> apps/api/a.ts', '1');
    expect(r.stdout).toMatch(/RC=0 DIRTY=true/);
  });

  it('배포되지 않는 경로(.claude 워크트리·docs)의 변경은 dirty 로 세지 않는다', () => {
    const r = runGit('mkdir -p .claude/worktrees/x docs && echo z > .claude/worktrees/x/f && echo d > docs/d.md');
    expect(r.stdout).toMatch(/RC=0 DIRTY=false/);
  });

  it('산출물 기록은 빌드 확인(dist/main.js)을 통과한 **뒤에** 쓴다 — 실패한 배포가 새 커밋을 말하지 않게', () => {
    const api = fnOf('deploy_api');
    const iTest = api.indexOf('test -f apps/api/dist/main.js');
    // 🔴 주석의 'BUILD_INFO.json' 이 아니라 **쓰는 명령**을 찾는다(첫 판이 주석을 잡아 헛판정했다)
    const iWrite = api.indexOf('> apps/api/BUILD_INFO.json');
    expect(iTest).toBeGreaterThan(0);
    expect(iWrite, 'BUILD_INFO 기록이 빌드 확인보다 앞선다').toBeGreaterThan(iTest);
  });

  it('dirty 판정은 서버에 닿기 전(모드 기록보다 먼저)에 한다', () => {
    const iPre = SH.indexOf('preflight_git || exit 1');
    const iMode = SH.indexOf("echo 'HIS_MODE=${HIS_MODE}' >> .env");
    expect(iPre).toBeGreaterThan(0);
    expect(iPre, 'dirty 로 중단될 배포가 서버 모드부터 바꾼다').toBeLessThan(iMode);
  });
});

describe('T2-6 의존성·Node — 모르면 막고, 명시로만 진행한다(실행 검증)', () => {
  const runDeps = (localFp: string, remoteFp: string, flags: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'dp-'));
    try {
      writeFileSync(join(dir, 'fn.sh'), fnOf('deps_preflight'));
      const script = [
        'set -euo pipefail',
        'log(){ echo "$1"; }',
        `node(){ echo "${localFp}"; }`,
        'rsync_run(){ :; }',
        `remote(){ echo "${remoteFp}"; }`,
        'sync_manifests(){ echo SYNCED; }',
        `LOCAL_DIR=/x; SERVER=s; REMOTE_DIR=/r; NEED_NPM_CI=''; ${flags}`,
        `source ${dir}/fn.sh`,
        'if deps_preflight; then echo "RC=0 NEED=${NEED_NPM_CI}"; else echo "RC=1"; fi',
      ].join('\n');
      return spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 30_000 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const A = 'a'.repeat(64); const B = 'b'.repeat(64);

  it('대조군 — 지문이 같으면 설치 없이 통과(종전과 같다)', () => {
    expect(runDeps(A, A, "INSTALL_DEPS=''; SKIP_DEPS_CHECK=''").stdout).toMatch(/RC=0 NEED=$/m);
  });
  it('🔴 지문이 다르면 명시 없이는 중단 — 새 의존성이 없는 채로 빌드되지 않게', () => {
    const r = runDeps(A, B, "INSTALL_DEPS=''; SKIP_DEPS_CHECK=''");
    expect(r.stdout).toContain('RC=1');
  });
  it('🔴 서버 lock 을 확인할 수 없으면(빈 지문) 같다고 치지 않는다', () => {
    expect(runDeps(A, '', "INSTALL_DEPS=''; SKIP_DEPS_CHECK=''").stdout).toContain('RC=1');
  });
  it('--install-deps 면 매니페스트를 동기화하고 npm ci 를 예약한다', () => {
    const r = runDeps(A, B, "INSTALL_DEPS=1; SKIP_DEPS_CHECK=''");
    expect(r.stdout).toContain('SYNCED');
    expect(r.stdout).toMatch(/RC=0 NEED=1/);
  });
  it('--skip-deps-check 는 종전 동작(경고 후 진행)', () => {
    const r = runDeps(A, B, "INSTALL_DEPS=''; SKIP_DEPS_CHECK=1");
    expect(r.stdout).toMatch(/RC=0/);
    expect(r.stdout).toContain('점검 생략');
  });

  it('npm ci 는 빌드 체인 **안에서** 빌드보다 먼저 — 실패하면 set -e 로 완료 파일이 안 생긴다', () => {
    for (const name of ['deploy_api', 'deploy_web']) {
      const body = fnOf(name);
      const iTake = body.indexOf('take_npm_ci');
      const iCi = body.indexOf('${CI_CMD}');
      const iBuild = body.indexOf('npm run build');
      expect(iTake, `${name}: take_npm_ci 호출 없음`).toBeGreaterThan(0);
      expect(iCi, `${name}: 설치가 빌드보다 뒤다`).toBeGreaterThan(0);
      expect(iCi).toBeLessThan(iBuild);
      expect(body, `${name}: $(…) 서브셸로 부르면 두 번 설치된다`).not.toContain('$(take_npm_ci)');
    }
  });

  /**
   * 🔴 실제 `remote_detached`·`deploy_api` 를 로컬에서 돌린다(ssh·rsync·pm2·curl 은 stub, 원격 스크립트는 로컬 bash 로 실행).
   *    npm ci 가 실패하면 ① 완료 파일이 안 생기고 ② 산출물 기록(BUILD_INFO)이 안 쓰이며 ③ deploy_api 가 0 이 아닌 값을 돌려준다
   *    → 메인 루프가 `set -e` 로 끝나 "배포 완료!" 에 닿지 않는다.
   */
  const runChain = (needCi: boolean, failCi: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'ch-'));
    try {
      mkdirSync(join(dir, 'repo', 'apps', 'api'), { recursive: true });
      mkdirSync(join(dir, 'bin'));
      writeFileSync(join(dir, 'bin', 'npm'), [
        '#!/bin/bash',
        `echo "npm $*" >> ${dir}/npm.log`,
        `if [ "$1" = "ci" ] && [ "${failCi ? '1' : ''}" = "1" ]; then echo "npm ci 실패(주입)"; exit 1; fi`,
        'if [ "$1" = "run" ]; then mkdir -p apps/api/dist && touch apps/api/dist/main.js; fi',
      ].join('\n'), { mode: 0o755 });
      writeFileSync(join(dir, 'bin', 'pm2'), '#!/bin/bash\necho "pm2 $*"\n', { mode: 0o755 });
      writeFileSync(join(dir, 'fns.sh'), ['remote_detached', 'take_npm_ci', 'build_info_json', 'deploy_api'].map(fnOf).join('\n'));
      const script = [
        'set -euo pipefail',
        'log(){ echo "[log] $1"; }',
        // ssh -p PORT SERVER "cmd" — 앞의 셋을 버리고 명령을 로컬 bash 로
        'ssh(){ while [ "$#" -gt 1 ]; do shift; done; bash -c "$1"; }',
        'remote(){ bash -c "$1"; }',
        'rsync_run(){ :; }', 'sync_shared(){ :; }',
        // 🔴 0.2초로 줄였더니 원격 스크립트가 pid 를 쓰기 전에 첫 폴링이 돌아 STOPPED 로 오독했다(테스트 쪽 경쟁 — 운영은 15초).
        //    스크립트는 수십 ms 에 끝나므로 1초면 판정이 결정적이다.
        'sleep(){ command sleep 1; }',
        'curl(){ echo 401; }',
        `export PATH=${dir}/bin:$PATH`,
        `SSH_PORT=0; SERVER=local; REMOTE_DIR=${dir}/repo; REMOTE_NODE_BIN=${dir}/bin; LOCAL_DIR='${ROOT}'; PM2_ENV=""; PM2_API=x; HIS_PUBLIC_URL=http://127.0.0.1:9`,
        'BUILD_COMMIT=abcdef1234567; BUILD_DIRTY=false; CI_CMD=":"',
        `source ${dir}/fns.sh`,
        `NEED_NPM_CI='${needCi ? '1' : ''}'`,
        'if deploy_api; then echo "RC=0"; else echo "RC=$?"; fi',
        `test -f ${dir}/repo/apps/api/BUILD_INFO.json && echo "INFO=yes" || echo "INFO=no"`,
        `cat ${dir}/npm.log 2>/dev/null | tr '\\n' ';' | sed 's/^/NPM=/'; echo`,
      ].join('\n');
      return spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 90_000 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it('🔴 재주입 — npm ci 실패 → 체인 중단 · 산출물 기록 없음 · deploy_api 비정상 종료', () => {
    const r = runChain(true, true);
    expect(r.stdout, r.stderr).toMatch(/RC=[1-9]/);
    expect(r.stdout, '실패한 배포가 산출물 기록을 남겼다').toContain('INFO=no');
    expect(r.stdout).toContain('npm ci');
    expect(r.stdout, '설치가 실패했는데 빌드가 돌았다').not.toContain('npm run build');
  }, 90_000);

  it('대조군 — 설치 없이(지문 일치) 빌드가 성공하면 기록을 쓰고 커밋이 담긴다', () => {
    const r = runChain(false, false);
    expect(r.stdout, r.stderr).toContain('RC=0');
    expect(r.stdout).toContain('INFO=yes');
    expect(r.stdout, '설치가 필요 없는데 npm ci 가 돌았다').not.toContain('npm ci');
  }, 90_000);

  it('서버 Node 주 버전이 다르거나 확인 불가면 중단한다', () => {
    const runNode = (v: string) => spawnSync('bash', ['-c', [
      'set -euo pipefail', 'log(){ echo "$1"; }', `remote(){ echo "${v}"; }`,
      'HIS_NODE_MAJOR=22; REMOTE_NODE_BIN=/n',
      fnOf('preflight_remote_node'),
      'if preflight_remote_node; then echo RC=0; else echo RC=1; fi',
    ].join('\n')], { encoding: 'utf8', timeout: 30_000 });
    expect(runNode('v22.22.1').stdout).toContain('RC=0');
    expect(runNode('v20.11.0').stdout).toContain('RC=1');
    expect(runNode('').stdout).toContain('RC=1');
  });
});

/**
 * 🔴 운영 실측(2026-09-13): `${PM2_ENV} pm2 describe X && pm2 restart X || pm2 start …` 는 셸 규칙상
 *    환경 변수 접두가 **첫 명령(describe)에만** 붙는다. his-api 는 `HIS_MODE=REHEARSAL` 인데 his-sentinel 은
 *    HIS_MODE 가 없었다 — 미설정은 REAL 판정이라 리허설 운영에서 감시자만 REAL 로 돌 수 있었다.
 *    규칙: 프로세스를 **기동하는** `pm2 restart`·`pm2 start` 는 반드시 바로 앞에 `${PM2_ENV} ` 가 있어야 한다.
 */
describe('pm2 기동 명령은 운영 환경(HIS_MODE 등)을 실제로 받는다', () => {
  const starts = () => {
    const out: Array<{ line: number; text: string; prefixed: boolean }> = [];
    SH.split('\n').forEach((l, i) => {
      if (/^\s*#/.test(l)) return; // 주석 제외
      for (const m of l.matchAll(/pm2 (restart|start)\b/g)) {
        const before = l.slice(0, m.index);
        out.push({ line: i + 1, text: l.trim().slice(0, 120), prefixed: /\$\{PM2_ENV\} $/.test(before) });
      }
    });
    return out;
  };

  it('대조군 — 기동 명령을 실제로 찾는다(API·감시자 restart·감시자 start)', () => {
    expect(starts().length).toBeGreaterThanOrEqual(4);
  });

  it('🔴 모든 pm2 restart·start 앞에 ${PM2_ENV} 가 붙어 있다', () => {
    const bad = starts().filter((s) => !s.prefixed);
    expect(bad, `환경 접두 없이 기동하는 줄:\n${bad.map((b) => `  :${b.line} ${b.text}`).join('\n')}`).toEqual([]);
  });

  it('🔴 실행 검증 — 감시자 재시작 명령이 HIS_MODE 를 pm2 에 넘긴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm2-'));
    try {
      mkdirSync(join(dir, 'bin'));
      // pm2 stub: describe 는 성공(이미 있음) · restart/start 는 받은 HIS_MODE 를 찍는다
      writeFileSync(join(dir, 'bin', 'pm2'), '#!/bin/bash\nif [ "$1" = "describe" ]; then exit 0; fi\necho "PM2 $1 HIS_MODE=${HIS_MODE:-<없음>}"\n', { mode: 0o755 });
      const body = fnOf('deploy_sentinel');
      const i = body.indexOf('remote "cd ${REMOTE_DIR} && if pm2 describe');
      expect(i, '감시자 기동 명령 모양을 못 찾았다').toBeGreaterThan(0);
      const cmdLine = body.slice(i, body.indexOf('fi"', i) + 3);
      const script = [
        'set -euo pipefail',
        `export PATH=${dir}/bin:$PATH`,
        'remote(){ bash -c "$1"; }',
        `REMOTE_DIR=${dir}; PM2_SENTINEL=his-sentinel; PM2_ENV="TZ=Asia/Seoul HIS_MODE=REHEARSAL"`,
        cmdLine,
      ].join('\n');
      const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 30_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('PM2 restart HIS_MODE=REHEARSAL');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('T3-5 설치 대상 변수화 — 설정 파일이 없어도 종전 값으로 돈다', () => {
  it('서버 주소·경로 리터럴은 기본값 한 곳에만 있다(함수 본문에 박히지 않는다)', () => {
    const bodyAfterConfig = SH.slice(SH.indexOf('HIS_NODE_MAJOR="${HIS_NODE_MAJOR:-22}"'));
    expect(bodyAfterConfig.length).toBeGreaterThan(1000);
    expect(bodyAfterConfig, '서버 IP 가 본문에 다시 박혔다').not.toContain('203.0.113.10');
    expect(bodyAfterConfig, '공개 URL 이 본문에 다시 박혔다(HIS_PUBLIC_URL 을 쓴다)').not.toMatch(/https:\/\/his\.weve\.io\.kr\/api/);
    expect(bodyAfterConfig, '백업 경로가 본문에 다시 박혔다').not.toContain('/home/deploy/backups/hospitalrun');
  });

  it('🔴 대조군 — 기본값이 종전 운영 값 그대로다(이 변경이 기존 배포를 바꾸지 않는다)', () => {
    expect(SH).toContain('SERVER="${HIS_SERVER:-deploy@203.0.113.10}"');
    expect(SH).toContain('SSH_PORT="${HIS_SSH_PORT:-22}"');
    expect(SH).toContain('REMOTE_DIR="${HIS_REMOTE_DIR:-/home/deploy/his-backup/weruby/hospital-run}"');
    expect(SH).toContain('HIS_PUBLIC_URL="${HIS_PUBLIC_URL:-https://his.example.org}"');
  });

  it('deploy.env 가 있으면 읽고, 환경변수가 파일보다 우선하며, 빈 줄·주석·잘못된 키에 죽지 않는다(실행 검증)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'de-'));
    try {
      const END = 'HIS_NODE_MAJOR="${HIS_NODE_MAJOR:-22}"';
      const head = SH.slice(SH.indexOf('DEPLOY_ENV_FILE='), SH.indexOf(END) + END.length);
      writeFileSync(join(dir, 'head.sh'), head);
      writeFileSync(join(dir, 'deploy.env'), '# 주석\n\nHIS_SERVER=me@10.0.0.1\nHIS_SSH_PORT=2222\nbad key=1\nHIS_REMOTE_DIR=\n');
      const r = spawnSync('bash', ['-c', `set -euo pipefail; DEPLOY_ENV_FILE=${dir}/deploy.env; HIS_SSH_PORT=9999; source ${dir}/head.sh; echo "S=$SERVER P=$SSH_PORT D=$REMOTE_DIR"`], { encoding: 'utf8', timeout: 30_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('S=me@10.0.0.1');
      expect(r.stdout, '환경변수가 파일을 이겨야 한다').toContain('P=9999');
      expect(r.stdout, '빈 값은 종전 기본값으로').toContain('D=/home/deploy/his-backup/weruby/hospital-run');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('bash 문법이 유효하다', () => {
    const r = spawnSync('bash', ['-n', join(ROOT, 'infra', 'scripts', 'deploy.sh')], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });
});

describe('lockfile 지문 — 버전만 올리면 바뀌지 않고, 의존성이 바뀌면 바뀐다', () => {
  it('🔴 워크스페이스 자기 버전·engines 변경은 지문 불변 · 의존성 버전 변경은 지문 변화', async () => {
    const { lockFingerprint } = await import('../../../../infra/scripts/lock-fingerprint.mjs');
    const base = {
      name: 'x', version: '1.0.0', lockfileVersion: 3,
      packages: {
        '': { name: 'x', version: '1.0.0', engines: { node: '>=20' } },
        'apps/api': { name: '@x/api', version: '1.5.0', dependencies: { a: '^1.0.0' } },
        'node_modules/@x/api': { resolved: 'apps/api', link: true },
        'node_modules/a': { version: '1.0.1' },
      },
    };
    const bumped = JSON.parse(JSON.stringify(base));
    bumped.version = '4.19.0'; bumped.packages[''].version = '4.19.0'; bumped.packages[''].engines.node = '>=22 <23';
    bumped.packages['apps/api'].version = '4.19.0';
    expect(lockFingerprint(bumped)).toBe(lockFingerprint(base));
    const dep = JSON.parse(JSON.stringify(base)); dep.packages['node_modules/a'].version = '1.0.2';
    expect(lockFingerprint(dep), '의존성이 바뀌었는데 지문이 같다').not.toBe(lockFingerprint(base));
  });
});
