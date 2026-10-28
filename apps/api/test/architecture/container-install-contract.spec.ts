import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { builtinModules } from 'node:module';

/**
 * 🔴 컨테이너 설치 경로 계약 가드 — 설치 재현성(갈래 E · 2026-09-21).
 *
 * 실측 경위: 형제 프로젝트가 기준 커밋을 `git archive` 로 풀어 **격리 네트워크에서** 운영 compose
 * (`infra/docker/docker-compose.prod.yml`)로 설치를 따라가 봤고, **저장소 원본 파일만으로는 설치본을
 * 만들 수 없었다**(R1~R19·R49). 막힌 순서대로:
 *   · R2 `apps/web/src/lib/sanitize.ts` 가 `dompurify` 를 쓰는데 `apps/web/package.json` 에 선언이 없다
 *        (웹 이미지는 web·shared 만 설치 → `Module not found`. 루트 `npm ci` 로 호이스트돼 개발기에선 안 보였다)
 *   · R1·R3 API·웹 빌드가 Node 기본 힙에서 134(힙 부족)로 죽는다
 *   · R4 `next.config.ts` 에 standalone 출력이 없어 runner 의 `COPY .next/standalone` 이 실패한다
 *   · R5·R7 `migrate` 서비스가 `/app` 에서 돌아 스키마를 못 찾고, 운영 이미지에는 `prisma` CLI·`ts-node` 가 없다
 *   · R11·R12 compose 가 `BIND_HOST` 를 안 넘겨 루프백만 listen · 헬스체크 `localhost` 가 `::1` 로 풀린다
 *   · R13 운영 nginx 가 PACS upstream 을 참조해 HIS 단독 설치에서 nginx 가 기동을 거부한다
 *   · R14 웹 빌드 인자 기본값이 특정 설치본 주소다
 *   · R19 DB 서비스 이름이 `postgres` 라 같은 호스트의 형제 시스템과 충돌한다
 *   · R49 상시 감시자가 compose 에 없어 컨테이너 설치 기관은 감시자 없이 운영하게 된다
 *
 * 🔴 이 가드가 보증하지 **않는 것**: `docker build`·`docker compose up` 성공. 여기 있는 것은
 *    파일 사이의 계약(짝)뿐이다 — 한쪽만 고치면 실패한다. 빌드·기동 확인은 사람 몫으로 남아 있다.
 *
 * 🔴 모든 검사는 아래 `describe('🔴 재주입 …')` 에서 결함 텍스트를 **1회 치환**(assert count==1)해
 *    실제로 실패하는지 역검증한다 — 통과하는 가드가 아무것도 보증하지 않을 수 있기 때문이다.
 */

const API = join(__dirname, '../..');
const ROOT = join(API, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const COMPOSE_PATH = 'infra/docker/docker-compose.prod.yml';
const API_DOCKERFILE = 'apps/api/Dockerfile';
const WEB_DOCKERFILE = 'apps/web/Dockerfile';
const NEXT_CONFIG = 'apps/web/next.config.ts';
const NGINX_HIS_ONLY = 'infra/docker/nginx/prod-his-only.conf';
const NGINX_WITH_PACS = 'infra/docker/nginx/prod.conf';

/** 주석(`#` 로 시작하는 줄)을 뺀 본문 — 주석의 낱말이 검사를 대신 통과하는 일을 막는다 */
function withoutComments(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════
 * 검사기 — 전부 "파일 텍스트 → 위반 목록". 재주입 테스트가 같은 함수를 부른다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** R5·R7 — migrate 서비스: 개발 의존성 단계에서 · apps/api 에서 · 데모 시드를 부르지 않고 */
export function checkMigrateService(composeBodyRaw: string): string[] {
  const composeBody = withoutComments(composeBodyRaw);
  const bad: string[] = [];
  const block = composeBody.match(/^ {2}migrate:\n([\s\S]*?)(?=^ {2}\S)/m)?.[1] ?? '';
  if (!block) return ['compose 에 migrate 서비스가 없다'];
  if (!/target:\s*builder/.test(block)) {
    bad.push('migrate 가 `target: builder` 를 쓰지 않는다 — 운영 이미지에는 prisma CLI(devDependency)가 없다');
  }
  if (!/working_dir:\s*\/app\/apps\/api/.test(block)) {
    bad.push('migrate 의 working_dir 가 /app/apps/api 가 아니다 — schema.prisma 를 못 찾는다');
  }
  if (/prisma\s+db\s+seed/.test(block)) {
    bad.push('migrate 가 `prisma db seed`(데모 시드)를 부른다 — 운영 이미지에 ts-node 가 없고, 판매본에 가상 병원 데이터를 넣지 않는다');
  }
  if (!/prisma\s+migrate\s+deploy/.test(block)) {
    bad.push('migrate 가 `prisma migrate deploy` 를 부르지 않는다 — 새 DB 스키마 정본은 migrate deploy 다');
  }
  return bad;
}

/** R11·R12 — api 서비스: 0.0.0.0 바인드 · 헬스체크는 IPv4 리터럴 */
export function checkApiService(composeBodyRaw: string): string[] {
  // 🔴 주석을 먼저 턴다 — "localhost 를 쓰면 안 된다"고 적은 **내 주석**이 검사를 대신 실패시켰다(첫 판 실측)
  const composeBody = withoutComments(composeBodyRaw);
  const bad: string[] = [];
  const block = composeBody.match(/^ {2}api:\n([\s\S]*?)(?=^ {2}\S)/m)?.[1] ?? '';
  if (!block) return ['compose 에 api 서비스가 없다'];
  if (!/BIND_HOST:\s*0\.0\.0\.0/.test(block)) {
    bad.push('api 에 BIND_HOST=0.0.0.0 이 없다 — main.ts 기본값은 127.0.0.1 이라 web·nginx 가 못 닿는다');
  }
  const health = block.match(/healthcheck:\n([\s\S]*?)(?=^ {4}\w)/m)?.[1] ?? '';
  if (/localhost/.test(health)) {
    bad.push('헬스체크가 localhost 를 쓴다 — 컨테이너에서 ::1 로 먼저 풀려 IPv4 바인딩에 닿지 못한다');
  }
  if (!/127\.0\.0\.1:4000\/health/.test(health)) {
    bad.push('헬스체크가 127.0.0.1:4000/health 를 부르지 않는다');
  }
  return bad;
}

/** R19 — DB·Redis 서비스 이름 고유화(형제 시스템과 같은 이름이면 남의 DB 로 붙는다) */
export function checkServiceNamesUnique(composeBodyRaw: string): string[] {
  const composeBody = withoutComments(composeBodyRaw);
  const bad: string[] = [];
  if (/^ {2}postgres:/m.test(composeBody)) bad.push('DB 서비스 이름이 `postgres` 다 — 같은 네트워크의 형제 시스템과 충돌한다');
  if (/^ {2}redis:/m.test(composeBody)) bad.push('Redis 서비스 이름이 `redis` 다 — 같은 이유로 고유화한다');
  if (!/^ {2}his-postgres:/m.test(composeBody)) bad.push('his-postgres 서비스가 없다');
  return bad;
}

/** R14 — 웹 빌드 인자에 특정 설치본 주소를 기본값으로 박지 않는다 */
export function checkWebBuildArgs(composeBodyRaw: string): string[] {
  const composeBody = withoutComments(composeBodyRaw);
  const bad: string[] = [];
  const m = composeBody.match(/NEXT_PUBLIC_API_URL:\s*(.+)/);
  if (!m) return ['compose 에 NEXT_PUBLIC_API_URL 빌드 인자가 없다'];
  const value = m[1].trim();
  if (/https?:\/\//.test(value)) {
    bad.push(`NEXT_PUBLIC_API_URL 기본값에 주소가 박혀 있다(${value}) — 정본은 빈 문자열(브라우저 상대경로)이다`);
  }
  return bad;
}

/** R49 — 상시 감시자 서비스 */
export function checkSentinelService(composeBodyRaw: string): string[] {
  const composeBody = withoutComments(composeBodyRaw);
  const bad: string[] = [];
  const block = composeBody.match(/^ {2}sentinel:\n([\s\S]*?)(?=^ {2}\S|^volumes:)/m)?.[1] ?? '';
  if (!block) return ['compose 에 sentinel 서비스가 없다 — 컨테이너 설치 기관이 감시자 없이 운영하게 된다'];
  if (!/dist\/sentinel\.main\.js/.test(block)) bad.push('sentinel 이 dist/sentinel.main.js 를 실행하지 않는다');
  if (/replicas:/.test(block)) bad.push('sentinel 에 replicas 가 있다 — 스윕이 두 벌 돌면 같은 주기에 판정이 두 번 적재된다');
  if (!/HIS_MODE:/.test(block)) bad.push('sentinel 에 HIS_MODE 가 없다 — 미설정은 REAL 로 판정된다(pm2 경로에서 같은 사고가 있었다)');
  return bad;
}

/** R13 — HIS 단독 nginx 설정에는 PACS upstream 이 없다 */
export function checkHisOnlyNginx(hisOnly: string): string[] {
  const body = withoutComments(hisOnly);
  const bad: string[] = [];
  for (const host of ['ohif', 'orthanc', 'pacs-api']) {
    if (new RegExp(`upstream[\\s\\S]*?server\\s+${host}:`).test(body)) {
      bad.push(`HIS 단독 설정이 ${host} upstream 을 참조한다 — 그 컨테이너가 없어 nginx 가 기동을 거부한다`);
    }
  }
  return bad;
}

/** R4 — Dockerfile 이 standalone 을 복사한다면 그 짝(빌드 인자·next.config)이 있어야 한다 */
export function checkStandalonePair(webDockerfile: string, nextConfig: string): string[] {
  const bad: string[] = [];
  const copiesStandalone = /\.next\/standalone/.test(webDockerfile);
  const buildAsksStandalone = /NEXT_OUTPUT=standalone/.test(webDockerfile);
  const configHonors = /NEXT_OUTPUT\s*===\s*'standalone'/.test(nextConfig) && /output:\s*'standalone'/.test(nextConfig);
  if (copiesStandalone && !buildAsksStandalone) {
    bad.push('runner 가 .next/standalone 을 복사하는데 빌드 단계가 NEXT_OUTPUT=standalone 을 켜지 않는다');
  }
  if (buildAsksStandalone && !configHonors) {
    bad.push('Dockerfile 이 NEXT_OUTPUT=standalone 을 켜는데 next.config 가 그 값을 보지 않는다 — COPY 가 실패한다');
  }
  if (configHonors && !/outputFileTracingRoot/.test(nextConfig)) {
    bad.push('모노레포인데 outputFileTracingRoot 가 없다 — 워크스페이스 의존이 산출물에 따라오지 않는다');
  }
  return bad;
}

/** R1·R3 — 빌드 힙은 **빌드 명령에만**. 런타임 ENV 로 두면 메모리 한도 1G 컨테이너가 위험하다 */
export function checkBuildHeap(dockerfile: string, buildCmd: RegExp): string[] {
  const body = withoutComments(dockerfile);
  const bad: string[] = [];
  const buildLine = body.split('\n').find((l) => buildCmd.test(l));
  if (!buildLine) return [`빌드 명령을 찾지 못했다(${buildCmd})`];
  if (!/--max-old-space-size=\d+/.test(buildLine)) {
    bad.push('빌드 명령에 힙 설정이 없다 — Node 기본 힙에서 134(힙 부족)로 죽는다');
  }
  if (/^ENV\s+NODE_OPTIONS/m.test(body)) {
    bad.push('NODE_OPTIONS 를 ENV 로 둔다 — 런타임 컨테이너까지 힙 상한이 걸려 메모리 한도와 어긋난다');
  }
  return bad;
}

/** Node 판 — Dockerfile ↔ .nvmrc ↔ engines */
export function checkNodeMajor(dockerfile: string, nvmrc: string, engines: string): string[] {
  const want = nvmrc.trim();
  const bad: string[] = [];
  const froms = [...dockerfile.matchAll(/^FROM\s+node:(\d+)/gm)].map((m) => m[1]);
  if (!froms.length) return ['Dockerfile 에 FROM node:<major> 가 없다'];
  for (const got of froms) {
    if (got !== want) bad.push(`Dockerfile 이 node:${got} 인데 .nvmrc 는 ${want} 다`);
  }
  if (!engines.includes(want)) bad.push(`package.json engines 가 .nvmrc(${want})를 담지 않는다`);
  return bad;
}

/** R49 짝 — 감시자가 읽는 경로를 운영 이미지가 지우지 않는다 */
export function checkImageKeepsSentinelInputs(apiDockerfile: string): string[] {
  const body = withoutComments(apiDockerfile);
  const bad: string[] = [];
  const pruneLine = body.match(/rm -rf [^\n]*/g)?.join('\n') ?? '';
  if (/apps\/api\/src/.test(pruneLine)) {
    bad.push('운영 이미지가 apps/api/src 를 지운다 — 감시자 흐름 축(pipe.unconsumedEvents)이 영구 관측 불가가 된다');
  }
  if (/infra/.test(pruneLine)) {
    bad.push('운영 이미지가 infra 를 지운다 — 감시자 정합성 축이 data-integrity-scan.sql 을 읽지 못한다');
  }
  return bad;
}

/** R2 — 웹 소스가 쓰는 패키지는 웹 package.json 이 선언한다(루트 호이스트에 기대지 않는다) */
export function undeclaredWebImports(srcDir: string, pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string[] {
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  const builtin = new Set(builtinModules);
  const seen = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const src = readFileSync(p, 'utf8');
      // 🔴 `from` 뒤에 **공백**을 요구한다 — `qs.set('from', …)` 같은 문자열이 대신 걸렸다(첫 판에서 오탐 6건)
      for (const m of src.matchAll(/(?:\bfrom\s+|\bimport\(\s*|\brequire\(\s*)(['"])([^'"]+)\1/g)) {
        const spec = m[2];
        if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('node:')) continue;
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!seen.has(name)) seen.set(name, p);
      }
    }
  };
  walk(srcDir);
  return [...seen.entries()]
    .filter(([n]) => !declared.has(n) && !builtin.has(n))
    .map(([n, p]) => `${n} (${p.replace(ROOT + '/', '')})`);
}

/**
 * lockfile 의 워크스페이스 항목이 그 워크스페이스 package.json 과 같아야 한다.
 *
 * 🔴 **오판 정정(2026-09-21)**: 처음엔 "이 상태면 `npm ci` 가 거부한다"고 적었는데, 합성 저장소로
 *    재현해 보니 **`npm ci` 는 통과했다**(워크스페이스 항목에 의존 선언이 없어도 lock 트리에 그 패키지가
 *    있으면 설치된다). 그래서 이 검사는 "설치가 막힌다"가 아니라 **선언 두 곳이 갈라졌다**를 말한다 —
 *    `--workspace` 로 범위를 좁혀 설치할 때(웹 이미지가 그렇게 한다) lock 이 근거로 삼을 기록이 없다.
 */
export function lockWorkspaceDrift(
  lock: { packages: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> },
  workspaces: { path: string; pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } }[],
): string[] {
  const norm = (o?: Record<string, string>) => Object.keys(o ?? {}).sort().map((k) => `${k}@${o![k]}`).join(',');
  const bad: string[] = [];
  for (const { path, pkg } of workspaces) {
    const entry = lock.packages[path];
    if (!entry) { bad.push(`lockfile 에 워크스페이스 항목이 없다: ${path}`); continue; }
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const a = norm(pkg[field]);
      const b = norm(entry[field]);
      if (a !== b) bad.push(`${path} ${field} 가 lockfile 의 기록과 다르다 — 선언 정본이 둘로 갈라졌다`);
    }
  }
  return bad;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 지금 저장소가 계약을 지키는가
 * ══════════════════════════════════════════════════════════════════════════ */

describe('컨테이너 설치 계약 — 운영 compose 로 설치본을 만들 수 있는 모양인가', () => {
  const compose = read(COMPOSE_PATH);
  const apiDf = read(API_DOCKERFILE);
  const webDf = read(WEB_DOCKERFILE);

  it('R5·R7 migrate 는 개발 의존성 단계에서 apps/api 기준으로 migrate deploy 만 한다', () => {
    expect(checkMigrateService(compose)).toEqual([]);
  });

  it('R11·R12 api 는 0.0.0.0 으로 listen 하고 헬스체크는 IPv4 리터럴을 쓴다', () => {
    expect(checkApiService(compose)).toEqual([]);
  });

  it('R19 DB·Redis 서비스 이름이 형제 시스템과 겹치지 않는다', () => {
    expect(checkServiceNamesUnique(compose)).toEqual([]);
  });

  it('R14 웹 빌드 인자에 특정 설치본 주소가 박혀 있지 않다', () => {
    expect(checkWebBuildArgs(compose)).toEqual([]);
  });

  it('R49 상시 감시자가 compose 에 있고, 운영 이미지가 감시자 입력 경로를 지우지 않는다', () => {
    expect(checkSentinelService(compose)).toEqual([]);
    expect(checkImageKeepsSentinelInputs(apiDf)).toEqual([]);
  });

  it('R13 HIS 단독 nginx 설정에는 PACS upstream 이 없다', () => {
    expect(checkHisOnlyNginx(read(NGINX_HIS_ONLY))).toEqual([]);
  });

  it('🔴 대조군 — PACS 포함 설정(prod.conf)은 그대로다(HIS 단독 분리가 원본을 깎지 않았다)', () => {
    const withPacs = read(NGINX_WITH_PACS);
    expect(checkHisOnlyNginx(withPacs).length, 'prod.conf 에서 PACS upstream 이 사라졌다 — 분리가 아니라 삭제다').toBeGreaterThan(0);
    for (const path of ['/viewer/', '/dicom-web/', '/wado', '/pacs-api/']) {
      expect(withPacs, `prod.conf 의 ${path} 경로가 사라졌다`).toContain(path);
    }
  });

  it('R13 compose 는 기본으로 HIS 단독 설정을 마운트하고, PACS 포함 설정으로 바꿀 길을 남긴다', () => {
    expect(compose).toMatch(/\$\{NGINX_CONF:-\.\/nginx\/prod-his-only\.conf\}/);
  });

  it('R4 standalone 출력은 Dockerfile 과 next.config 가 짝으로 켠다', () => {
    expect(checkStandalonePair(webDf, read(NEXT_CONFIG))).toEqual([]);
  });

  it('R1·R3 빌드 힙은 빌드 명령에만 준다(런타임 ENV 로 두지 않는다)', () => {
    expect(checkBuildHeap(apiDf, /nest build/)).toEqual([]);
    expect(checkBuildHeap(webDf, /cd apps\/web && .*npm run build/)).toEqual([]);
  });

  it('이미지 Node 판이 .nvmrc·engines 와 같다', () => {
    const nvmrc = read('.nvmrc');
    const engines = JSON.stringify(JSON.parse(read('package.json')).engines ?? {});
    expect(checkNodeMajor(apiDf, nvmrc, engines)).toEqual([]);
    expect(checkNodeMajor(webDf, nvmrc, engines)).toEqual([]);
  });

  it('R9 첫 관리자 부트스트랩이 compose 에 있고, `up` 을 막지 않는다(profiles)', () => {
    const block = compose.match(/^ {2}bootstrap-admin:\n([\s\S]*?)(?=^ {2}\S)/m)?.[1] ?? '';
    expect(block, 'bootstrap-admin 서비스가 없다').not.toBe('');
    expect(block).toMatch(/profiles:\s*\[\s*"bootstrap"\s*\]/);
    expect(block).toMatch(/create-admin\.cjs/);
    // 🔴 비밀번호를 compose 파일에 박지 않는다 — 환경변수 치환(`${...}`)만
    //    (첫 판의 정규식은 `${ADMIN_PASSWORD:-}` **안쪽**의 `ADMIN_PASSWORD:-` 에 스스로 걸렸다)
    const pwLine = withoutComments(block).split('\n').find((l) => /^\s*ADMIN_PASSWORD:/.test(l)) ?? '';
    expect(pwLine, 'bootstrap-admin 에 ADMIN_PASSWORD 배선이 없다').not.toBe('');
    expect(pwLine.replace(/^\s*ADMIN_PASSWORD:\s*/, '')).toMatch(/^\$\{[^}]*\}$/);
  });
});

describe('R2 웹이 쓰는 패키지는 웹이 선언한다 — 루트 호이스트에 기대지 않는다', () => {
  it('apps/web/src 의 외부 import 가 전부 apps/web/package.json 에 선언돼 있다', () => {
    const pkg = JSON.parse(read('apps/web/package.json'));
    expect(undeclaredWebImports(join(ROOT, 'apps/web/src'), pkg)).toEqual([]);
  });

  it('🔴 대조군 — 스캐너가 실제로 import 를 세고 있다(0개를 세고 통과하지 않는다)', () => {
    const pkg = JSON.parse(read('apps/web/package.json'));
    // 선언을 통째로 비우면 "미선언"이 대량으로 나와야 한다 — 안 나오면 스캐너가 아무것도 안 본 것이다
    const all = undeclaredWebImports(join(ROOT, 'apps/web/src'), {});
    expect(all.length, '스캐너가 web 소스에서 외부 import 를 하나도 찾지 못했다').toBeGreaterThan(10);
    expect(all.some((s) => s.startsWith('dompurify'))).toBe(true);
    expect(Object.keys(pkg.dependencies)).toContain('dompurify');
  });
});

describe('lockfile 이 워크스페이스 선언과 같다(선언 정본이 둘로 갈라지지 않는다)', () => {
  it('모든 워크스페이스가 lockfile 과 일치한다', () => {
    const lock = JSON.parse(read('package-lock.json'));
    const workspaces = ['apps/api', 'apps/web', 'apps/homepage', 'packages/shared'].map((p) => ({
      path: p,
      pkg: JSON.parse(read(`${p}/package.json`)),
    }));
    expect(lockWorkspaceDrift(lock, workspaces)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔴 재주입 역검증 — 결함을 다시 넣으면 검사기가 **실패해야** 가드다.
 *    치환이 무동작이면 "통과"를 증거로 읽게 되므로, 치환 횟수를 먼저 확인한다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** 정확히 1회 치환됐는지 확인하고 바뀐 텍스트를 돌려준다 */
function replaceOnce(text: string, from: string | RegExp, to: string): string {
  const src = typeof from === 'string' ? from : from.source;
  const count = (text.match(typeof from === 'string' ? new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : new RegExp(src, 'g')) ?? []).length;
  expect(count, `재주입 대상이 ${count}곳이다(1이어야 한다): ${src}`).toBe(1);
  return text.replace(from, to);
}

describe('🔴 재주입 — 결함을 되돌리면 각 검사기가 실패한다', () => {
  const compose = read(COMPOSE_PATH);
  const apiDf = read(API_DOCKERFILE);
  const webDf = read(WEB_DOCKERFILE);
  const nextCfg = read(NEXT_CONFIG);

  it('R5 migrate 가 /app 에서 돌면(working_dir 제거) 잡는다', () => {
    const broken = replaceOnce(compose, '    working_dir: /app/apps/api\n    command: sh -c "npx prisma migrate deploy"', '    command: sh -c "npx prisma migrate deploy"');
    expect(checkMigrateService(broken).join(' ')).toContain('working_dir');
  });

  it('R5 migrate 가 운영 이미지(target 없음)를 쓰면 잡는다 — prisma CLI 가 없다', () => {
    const broken = replaceOnce(compose, '      target: builder\n    working_dir: /app/apps/api\n    command: sh -c "npx prisma migrate deploy"', '    working_dir: /app/apps/api\n    command: sh -c "npx prisma migrate deploy"');
    expect(checkMigrateService(broken).join(' ')).toContain('target: builder');
  });

  it('R7 migrate 가 데모 시드를 다시 부르면 잡는다', () => {
    const broken = replaceOnce(compose, 'sh -c "npx prisma migrate deploy"', 'sh -c "npx prisma migrate deploy && npx prisma db seed"');
    expect(checkMigrateService(broken).join(' ')).toContain('db seed');
  });

  it('R11 BIND_HOST 를 빼면 잡는다', () => {
    const broken = replaceOnce(compose, '      BIND_HOST: 0.0.0.0\n', '');
    expect(checkApiService(broken).join(' ')).toContain('BIND_HOST');
  });

  it('R12 헬스체크가 localhost 로 돌아가면 잡는다', () => {
    const broken = replaceOnce(compose, 'http://127.0.0.1:4000/health', 'http://localhost:4000/health');
    expect(checkApiService(broken).join(' ')).toContain('localhost');
  });

  it('R19 서비스 이름을 postgres 로 되돌리면 잡는다', () => {
    // 🔴 앵커는 서비스 선언 한 곳뿐이어야 한다(`his-postgres` 문자열은 DATABASE_URL 등에 5곳 있었다)
    const broken = replaceOnce(compose, '  his-postgres:\n    image: postgres:16-alpine', '  postgres:\n    image: postgres:16-alpine');
    expect(checkServiceNamesUnique(broken).join(' ')).toContain('postgres');
  });

  it('R14 빌드 인자에 주소를 박으면 잡는다', () => {
    const broken = replaceOnce(compose, 'NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-}', 'NEXT_PUBLIC_API_URL: ${PUBLIC_URL:-https://his.hospital.kr}');
    expect(checkWebBuildArgs(broken).join(' ')).toContain('주소가 박혀');
  });

  it('R49 감시자 서비스를 지우면 잡는다', () => {
    const block = compose.match(/^ {2}sentinel:\n[\s\S]*?(?=^ {2}web:)/m);
    expect(block, '재주입 대상(sentinel 블록)을 찾지 못했다').not.toBeNull();
    const broken = replaceOnce(compose, block![0], '');
    expect(checkSentinelService(broken).join(' ')).toContain('sentinel 서비스가 없다');
  });

  it('R49 운영 이미지가 apps/api/src 를 다시 지우면 잡는다', () => {
    const broken = replaceOnce(apiDf, 'rm -rf apps/web .next .git', 'rm -rf apps/web apps/api/src .next .git');
    expect(checkImageKeepsSentinelInputs(broken).join(' ')).toContain('apps/api/src');
  });

  it('R13 HIS 단독 설정에 PACS upstream 을 넣으면 잡는다', () => {
    const hisOnly = read(NGINX_HIS_ONLY);
    const broken = replaceOnce(hisOnly, 'upstream api_backend {\n    server api:4000;\n}', 'upstream api_backend {\n    server api:4000;\n}\n\nupstream ohif_viewer {\n    server ohif:3001;\n}');
    expect(checkHisOnlyNginx(broken).join(' ')).toContain('ohif');
  });

  it('R4 next.config 에서 standalone 을 빼면 잡는다', () => {
    const broken = replaceOnce(nextCfg, "output: 'standalone' as const", "output: undefined as unknown as undefined");
    expect(checkStandalonePair(webDf, broken).join(' ')).toContain('next.config');
  });

  it('R1 빌드 명령에서 힙을 빼면 잡는다', () => {
    const broken = replaceOnce(apiDf, 'NODE_OPTIONS=--max-old-space-size=3072 npx nest build', 'npx nest build');
    expect(checkBuildHeap(broken, /nest build/).join(' ')).toContain('힙 설정이 없다');
  });

  it('R1 힙을 런타임 ENV 로 옮기면 잡는다(메모리 한도 1G 컨테이너가 위험하다)', () => {
    const broken = replaceOnce(apiDf, 'FROM builder AS runtime\n', 'FROM builder AS runtime\nENV NODE_OPTIONS=--max-old-space-size=3072\n');
    expect(checkBuildHeap(broken, /nest build/).join(' ')).toContain('ENV');
  });

  it('Node 판이 .nvmrc 와 어긋나면 잡는다', () => {
    const broken = apiDf.replace(/FROM node:22-alpine/g, 'FROM node:20-alpine');
    expect(broken, '재주입이 무동작이다').not.toBe(apiDf);
    expect(checkNodeMajor(broken, '22\n', '{"node":">=22.0.0 <23.0.0"}').join(' ')).toContain('node:20');
  });

  it('R2 웹 package.json 에서 dompurify 선언을 빼면 잡는다', () => {
    const pkg = JSON.parse(read('apps/web/package.json'));
    expect(pkg.dependencies.dompurify, '재주입 대상(dompurify 선언)이 없다').toBeTruthy();
    delete pkg.dependencies.dompurify;
    const miss = undeclaredWebImports(join(ROOT, 'apps/web/src'), pkg);
    expect(miss.join(' ')).toContain('dompurify');
  });

  it('lockfile 이 워크스페이스 선언과 갈라지면 잡는다', () => {
    const lock = JSON.parse(read('package-lock.json'));
    const pkg = JSON.parse(read('apps/web/package.json'));
    expect(lock.packages['apps/web'].dependencies.dompurify, '재주입 대상이 없다').toBeTruthy();
    delete lock.packages['apps/web'].dependencies.dompurify;
    expect(lockWorkspaceDrift(lock, [{ path: 'apps/web', pkg }]).join(' ')).toContain('갈라졌다');
  });
});
