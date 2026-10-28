import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 🔴 **긴 원격 빌드를 SSH 세션에 묶지 않는다**(정본 `docs/05-reference/production-operations.md` §2.0).
 *
 * 2026-09-10 실측: `deploy.sh --web` 이 `Connection closed by remote host` 로 **연속 2회** 죽었다.
 * 메모리·부하는 정상이었고 OOM 도 없었다 — 세션이 끊긴 것이다. 그때 `.next-build` 가 남아 스왑 전이었고
 * 사이트는 직전 빌드를 계속 서비스했다(실패했는데 화면은 멀쩡한 자리).
 *
 * 🔴 그리고 **성공 판정을 로그 문자열로 하면 안 된다** — 본문이 그 문자열을 출력만 해도 완료로 읽힌다.
 *    자체 시험에서 실제로 뚫렸고, 사람이 수동 배포할 때도 오류 메시지 안의 문자열을 보고 오판했다.
 *    완료 파일(`set -e` 를 통과한 마지막 줄에서만 생성)로 판정한다.
 */
const DEPLOY = path.join(__dirname, '..', '..', '..', '..', 'infra', 'scripts', 'deploy.sh');
const src = fs.readFileSync(DEPLOY, 'utf8');

describe('🔴 배포 스크립트 — 원격 빌드가 세션에 묶이지 않는다', () => {
  it('대조군 — 스크립트를 실제로 읽었다', () => {
    expect(src.length, 'deploy.sh 를 읽지 못했다').toBeGreaterThan(3000);
    expect(src).toContain('deploy_web()');
    expect(src).toContain('deploy_api()');
  });

  it('분리 실행 헬퍼가 있고 웹·API 빌드가 그것을 쓴다', () => {
    expect(src, 'remote_detached 헬퍼가 사라졌다').toContain('remote_detached()');
    const web = src.slice(src.indexOf('deploy_web()'), src.indexOf('deploy_web()') + 3000);
    const api = src.slice(src.indexOf('deploy_api()'), src.indexOf('deploy_api()') + 3000);
    expect(web, '웹 빌드가 다시 단일 세션 안에서 돈다 — 연결이 끊기면 통째로 날아간다')
      .toMatch(/remote_detached\s+"web"/);
    expect(api, 'API 빌드가 다시 단일 세션 안에서 돈다').toMatch(/remote_detached\s+"api"/);
  });

  it('🔴 성공 판정이 완료 파일이다 — 로그 문자열 grep 으로 되돌아가지 않는다', () => {
    const helper = src.slice(src.indexOf('remote_detached()'), src.indexOf('remote_detached()') + 2500);
    expect(helper, '완료 파일 판정이 사라졌다').toMatch(/\[ -f \$\{donef\} \]/);
    expect(helper, '로그에서 마커를 grep 하는 방식으로 되돌아갔다 — 본문이 출력만 해도 통과한다')
      .not.toMatch(/grep -q .*\$\{logf\}/);
  });

  it('🔴 API 는 빌드 성공을 확인한 뒤에만 재시작한다(낡은 dist 무증상 재시작 방지)', () => {
    const api = src.slice(src.indexOf('deploy_api()'), src.indexOf('deploy_api()') + 3000);
    // 🔴 주석 안의 `pm2 restart` 를 세면 안 된다 — 이 파일의 주석이 그 함정을 **설명**하고 있어서
    //    첫 검사가 주석을 실제 명령으로 읽고 실패했다(가드가 다른 이유로 실패한 자리).
    const apiCode = api.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    const buildAt = apiCode.search(/remote_detached\s+"api"/);
    const restartAt = apiCode.search(/remote\s+"[^"]*pm2 restart/);
    expect(buildAt, 'API 빌드 호출을 찾지 못했다').toBeGreaterThan(-1);
    expect(restartAt, 'API 재시작을 찾지 못했다').toBeGreaterThan(-1);
    expect(restartAt, '빌드보다 먼저 재시작한다 — 빌드가 날아가도 낡은 dist 로 살아난다').toBeGreaterThan(buildAt);
    expect(api, '빌드 실패에도 재시작으로 넘어간다').toMatch(/재시작하지 않는다/);
    expect(apiCode, '재시작 명령을 찾지 못했다 — 검사가 헛돈다').toMatch(/pm2 restart/);
  });

  it('🔴 시한 초과를 실패로 단정하지 않는다(아직 돌고 있을 수 있다)', () => {
    const helper = src.slice(src.indexOf('remote_detached()'), src.indexOf('remote_detached()') + 2500);
    expect(helper).toMatch(/실패로 단정하지 않는다/);
    expect(helper, '시한 초과가 실패(1)와 같은 코드로 접힌다 — 두 사실이 구분되지 않는다').toMatch(/return 2/);
  });
});

describe('🔴 npm ci 뒤 Prisma 클라이언트 생성(2026-09-28)', () => {
  it('설치 명령이 prisma generate 를 함께 부른다 — npm ci 가 생성된 클라이언트를 지워 API 빌드가 4,024건 실패했다', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../../infra/scripts/deploy.sh'), 'utf8') as string;
    const line = src.split('\n').find((l: string) => /^\s*CI_CMD=\$?['"]npm ci/.test(l));
    expect(line).toBeDefined();
    // 설치와 생성은 **다른 줄**이어야 한다 — `npm ci && …` 는 set -e 가 설치 실패를 무시한다(release-freeze-guard T2-6 이 잡는다)
    expect(line).toMatch(/npm ci [^\\]*\\n\(cd apps\/api && npx prisma generate\)/);
    expect(line).not.toMatch(/npm ci[^\\]*&&/);
  });
});
