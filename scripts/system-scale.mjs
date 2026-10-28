#!/usr/bin/env node
/**
 * scripts/system-scale.mjs — CLAUDE.md "System Scale" 표의 **정본 계측기**
 *
 * 목적: 같은 항목을 사람마다 다르게 세어(테스트 443/462/448, 페이지 434/435 …)
 *       표가 재현 불가였던 문제를 없앤다. 세는 규칙을 여기 코드로 못박는다.
 *
 * 사용법
 *   node scripts/system-scale.mjs              # 규칙 + 표 출력
 *   node scripts/system-scale.mjs --json       # 기계 판독용 JSON
 *   node scripts/system-scale.mjs --rules      # 규칙(포함/제외)만 출력
 *   node scripts/system-scale.mjs --check      # 동결값(system-scale.lock.json) 과 비교
 *                                              #   많아도 적어도 **양방향 모두 실패**(exit 1)
 *   node scripts/system-scale.mjs --freeze     # 현재 실측을 동결값으로 기록
 *
 * 규약
 *  - 🔴 자르거나 추정하지 않는다. 세지 못하는 것은 세지 않고 `null` + 사유를 남긴다.
 *  - 🔴 이 스크립트는 계측만 한다. 소스를 고쳐 숫자를 맞추지 않는다.
 *  - 파일 시스템만 읽는다(런타임/DB 를 건드리지 않는다). 그래서 "테스트 통과 수",
 *    "운영 DB 행 수"(약품 코드·진단 코드 등)는 **범위 밖**이다 — 표에서 출처를 따로 밝힌다.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = join(ROOT, 'scripts', 'system-scale.lock.json');

/** 어디에서도 세지 않는 디렉터리 — 빌드 산출물·의존성은 "우리가 쓴 것"이 아니다. */
// 🔴 `.claude` — 병행 에이전트 워크트리(`.claude/worktrees/agent-*`)에 저장소 사본이 통째로 들어 있다.
//    빼지 않으면 사본의 테스트를 우리 것으로 세서 `orphanTestFiles` 가 0 → 3,325 로 튄다(2026-09-13 실측).
//    릴리즈 동결 수치가 병행 작업 여부에 따라 달라지면 동결이 아니다.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.next', '.turbo', 'coverage', '.git', 'build', 'out', '.expo', '.claude',
]);

// ─────────────────────────────────────────────────────────────── 파일 수집 유틸

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push(p);
  }
  return out;
}

/** glob → RegExp. `**`(경로 가로지름) · `*`(세그먼트 내) · `{a,b}` · `?` 지원. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` 는 0개 이상 디렉터리
        if (glob[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2; }
        else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += '(?:' + glob.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')';
      i = end;
    } else re += escapeRe(c);
  }
  return new RegExp('^' + re + '$');
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** base 아래 파일 중 glob 목록 하나라도 매칭되는 것(경로는 base 기준 상대·POSIX). */
function globFiles(base, globs) {
  const res = globs.map(globToRegExp);
  return walk(join(ROOT, base))
    .map((p) => relative(join(ROOT, base), p).split(sep).join('/'))
    .filter((rel) => res.some((r) => r.test(rel)))
    .sort();
}

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/** 행 수 = 개행 문자 수(= `wc -l` 과 동일). 사람이 wc 로 검산할 수 있어야 한다. */
const lines = (p) => (read(p).match(/\n/g) || []).length;

// ─────────────────────────────────────────────────────────── 규칙(포함/제외) 정본

/**
 * 각 지표는 { key, label, rule, ambiguity? , measure() } 로 정의한다.
 * `rule` 은 사람이 읽는 포함/제외 문장이고, `measure()` 가 그 문장을 코드로 못박은 것이다.
 * 둘이 어긋나면 **문장이 아니라 코드가 정본**이다(코드가 재현되는 쪽이므로).
 */
const METRICS = [];
const M = (m) => { METRICS.push(m); return m; };

// ── 1. Prisma Models
M({
  key: 'prismaModels',
  label: 'Prisma Models',
  rule: '포함: apps/api/prisma/schema.prisma 의 행 시작 `model <Name> {` 선언. '
      + '제외: `enum`·`type`·`view`·주석 처리된 model·다른 .prisma 파일(현재 없음).',
  measure: () => (read('apps/api/prisma/schema.prisma').match(/^model\s+\w+\s*\{/gm) || []).length,
});

// ── 2. Backend Modules (도메인)
M({
  key: 'backendModules',
  label: 'Backend Modules (도메인)',
  rule: '포함: apps/api/src/modules/ 의 **1단계 하위 디렉터리** 개수(= 도메인 1개). '
      + '제외: common/·domain/·infrastructure/ (도메인 아님)·중첩 하위 디렉터리·*.module.ts 파일 수.',
  ambiguity: '"모듈"을 @Module() 데코레이터 수로 세면 다른 값이 나온다(모듈 파일이 도메인당 1개가 아닐 수 있음). '
           + '표의 이름이 "도메인"이므로 디렉터리 기준을 정본으로 한다.',
  measure: () => readdirSync(join(ROOT, 'apps/api/src/modules'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).length,
});

// ── 3~4. Controllers / Services
M({
  key: 'controllers',
  label: 'Controllers',
  rule: '포함: apps/api/src/**/*.controller.ts **파일 수**. 제외: *.spec.ts·test/ 아래·dist. '
      + '한 파일에 @Controller() 가 여러 개 있어도 **1로 센다**(파일 기준).',
  ambiguity: '@Controller() 데코레이터 수로 세면 값이 다르다(현재 파일 284 vs 데코레이터 310). '
           + '두 값 모두 아래 detail 에 함께 출력한다.',
  measure: () => globFiles('apps/api/src', ['**/*.controller.ts']).filter((f) => !f.endsWith('.spec.ts')).length,
  detail: () => {
    const files = globFiles('apps/api/src', ['**/*.controller.ts']).filter((f) => !f.endsWith('.spec.ts'));
    let deco = 0;
    for (const f of files) deco += (read(join('apps/api/src', f)).match(/^\s*@Controller\(/gm) || []).length;
    return `파일 ${files.length} · @Controller() 데코레이터 ${deco}`;
  },
});
M({
  key: 'services',
  label: 'Services',
  rule: '포함: apps/api/src/**/*.service.ts **파일 수**. 제외: *.spec.ts·test/ 아래·dist. '
      + '@Injectable() 이지만 파일명이 *.service.ts 가 아닌 것(guard·interceptor·client)은 제외.',
  measure: () => globFiles('apps/api/src', ['**/*.service.ts']).filter((f) => !f.endsWith('.spec.ts')).length,
});

// ── 5. API Endpoints
const HTTP_DECO = /^\s*@(Get|Post|Put|Patch|Delete|All|Head|Options)\(/gm;
const SSE_DECO = /^\s*@Sse\(/gm;
function endpointCounts() {
  const files = globFiles('apps/api/src', ['**/*.controller.ts']).filter((f) => !f.endsWith('.spec.ts'));
  let http = 0, sse = 0;
  const perMethod = {};
  for (const f of files) {
    const src = read(join('apps/api/src', f));
    for (const m of src.matchAll(HTTP_DECO)) { http++; perMethod[m[1]] = (perMethod[m[1]] || 0) + 1; }
    sse += (src.match(SSE_DECO) || []).length;
  }
  return { http, sse, perMethod, files: files.length };
}
M({
  key: 'apiEndpoints',
  label: 'API Endpoints',
  rule: '포함: apps/api/src/**/*.controller.ts 안의 **행 시작 HTTP 메서드 데코레이터 수** '
      + '(@Get/@Post/@Put/@Patch/@Delete/@All/@Head/@Options). '
      + '= "핸들러 수"이지 "고유 라우트 경로 수"가 아니다. '
      + '제외: @Sse(별도 집계)·주석/문자열 안의 데코레이터(행 시작 앵커로 배제)·test/ 아래.',
  ambiguity: '① 한 파일에 @Controller 가 여러 개면 같은 핸들러가 여러 prefix 로 노출되지만 **1로 센다**'
           + '(경로 수로 세면 더 크다). ② @Sse 는 실제 GET 라우트지만 역사적으로 제외돼 왔다 — '
           + '값을 끊지 않기 위해 본 수치에서는 제외하고 `apiEndpointsSse` 로 따로 센다.',
  measure: () => endpointCounts().http,
  detail: () => {
    const c = endpointCounts();
    return Object.entries(c.perMethod).map(([k, v]) => `${k} ${v}`).join(' · ');
  },
});
M({
  key: 'apiEndpointsSse',
  label: 'API Endpoints (SSE)',
  rule: '포함: 같은 파일들의 @Sse() 데코레이터 수. API Endpoints 본 수치에는 **더해지지 않는다**.',
  measure: () => endpointCounts().sse,
});

// ── 6. AI Endpoints
/** @Controller('...') prefix + 메서드 데코레이터 인자로 전체 경로를 복원한다. */
function resolveRoutes() {
  const files = globFiles('apps/api/src', ['**/*.controller.ts']).filter((f) => !f.endsWith('.spec.ts'));
  const routes = [];
  for (const f of files) {
    const src = read(join('apps/api/src', f));
    // 파일 안 @Controller 블록 경계로 나눈다(다중 컨트롤러 파일 대응)
    const ctrlRe = /^\s*@Controller\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/gm;
    const marks = [...src.matchAll(ctrlRe)].map((m) => ({ idx: m.index, prefix: m[1] ?? m[2] ?? m[3] ?? '' }));
    if (marks.length === 0) continue;
    for (let i = 0; i < marks.length; i++) {
      const seg = src.slice(marks[i].idx, i + 1 < marks.length ? marks[i + 1].idx : undefined);
      const mRe = /^\s*@(Get|Post|Put|Patch|Delete|All|Head|Options|Sse)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/gm;
      for (const m of seg.matchAll(mRe)) {
        const sub = m[2] ?? m[3] ?? m[4] ?? '';
        const path = ('/' + [marks[i].prefix, sub].filter(Boolean).join('/')).replace(/\/+/g, '/');
        routes.push({ file: f, method: m[1], path });
      }
    }
  }
  return routes;
}
M({
  key: 'aiEndpoints',
  label: 'AI Endpoints',
  rule: '포함: 복원된 전체 경로에 **`ai` 라는 경로 세그먼트가 통째로 있는** 엔드포인트'
      + '(예: /api/v1/ai/…). @Sse 포함. '
      + '제외: 단어 안에 ai 가 들어갈 뿐인 경로(claims·blockchain·questionnaire 등).',
  ambiguity: '🔴 이 지표는 원래 "AI 기능 엔드포인트"라는 **수기 집계**였고(v2.3.0, 2026-05) 재현 규칙이 없었다. '
           + 'AI 를 쓰는 핸들러는 /ai 밖에도 있다(checkup-explainer·drug-explain·ambient-scribe 등) — '
           + '"AI 를 쓴다"의 판정은 기계적으로 안전하지 않아 **경로 세그먼트**로만 못박는다. '
           + '더 넓은 정의가 필요하면 사람이 목록을 정하고 여기 상수로 등재해야 한다.',
  measure: () => resolveRoutes().filter((r) => r.path.split('/').includes('ai')).length,
  detail: () => {
    const hit = resolveRoutes().filter((r) => r.path.split('/').includes('ai'));
    const by = {};
    for (const r of hit) {
      const i = r.path.split('/').indexOf('ai');
      const k = r.path.split('/').slice(0, i + 1).join('/');
      by[k] = (by[k] || 0) + 1;
    }
    return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  },
});

// ── 7~10. Frontend Pages
const WEB_APP = 'apps/web/src/app';
const webPages = () => globFiles(WEB_APP, ['**/page.tsx']);
M({
  key: 'webPagesTotal',
  label: 'Frontend Pages (Total)',
  rule: `포함: ${WEB_APP}/**/page.tsx 전부(라우트 그룹 \`(…)\` 포함). `
      + '제외: layout/template/loading/error/not-found·route.ts(API 라우트)·page.test.tsx·'
      + '**별도 앱 apps/homepage**(다른 워크스페이스라 아래 homepageAppPages 로 따로 센다).',
  ambiguity: 'Total = Main + Homepage 가 **아니다**. (main)·(homepage) 밖의 최상위 경로'
           + '(tablet·staff·display·portal·print·station·smart·onboarding·다국어 등)가 남는다 — '
           + 'webPagesOther 로 명시 출력한다.',
  measure: () => webPages().length,
});
M({
  key: 'webPagesMain',
  label: 'Frontend Pages (Main)',
  rule: `포함: ${WEB_APP}/(main)/ 아래 page.tsx.`,
  measure: () => webPages().filter((f) => f.startsWith('(main)/')).length,
});
M({
  key: 'webPagesHomepage',
  label: 'Frontend Pages (Homepage)',
  rule: `포함: ${WEB_APP}/(homepage)/ 아래 page.tsx (= web 앱 안의 병원 소개 라우트 그룹).`,
  ambiguity: '🔴 실제 공개 사이트는 **별도 앱 apps/homepage** 다. 이름이 같아 혼동돼 왔다 → '
           + 'homepageAppPages 를 따로 센다.',
  measure: () => webPages().filter((f) => f.startsWith('(homepage)/')).length,
});
M({
  key: 'webPagesOther',
  label: 'Frontend Pages (기타 그룹)',
  rule: `포함: ${WEB_APP} 아래 page.tsx 중 (main)·(homepage) 에 속하지 않는 것 `
      + '(tablet·staff·display·portal·print·station·smart·sso·onboarding·verify·다국어 등).',
  measure: () => webPages().filter((f) => !f.startsWith('(main)/') && !f.startsWith('(homepage)/')).length,
});
M({
  key: 'homepageAppPages',
  label: 'Homepage App Pages (apps/homepage)',
  rule: '포함: apps/homepage/**/page.tsx (별도 Next 앱). Frontend Pages(Total) 에 **포함되지 않는다**.',
  measure: () => globFiles('apps/homepage', ['**/page.tsx']).length,
});
M({
  key: 'adminPages',
  label: 'Admin Pages',
  rule: `포함: ${WEB_APP}/(main)/admin/ 아래 page.tsx 전부(중첩 포함). `
      + '제외: 도메인 안의 admin 하위 화면((main)/consult/admin·(main)/pharmacy/admin) — detail 에 명시.',
  measure: () => webPages().filter((f) => f.startsWith('(main)/admin/')).length,
  detail: () => {
    const extra = webPages().filter((f) => /\/admin\//.test('/' + f) && !f.startsWith('(main)/admin/'));
    return `(main)/admin 밖 admin 화면 ${extra.length}건: ${extra.join(', ') || '없음'}`;
  },
});
M({
  key: 'workstationPages',
  label: 'Workstation Pages',
  rule: `포함: ${WEB_APP}/(main)/workstation/ 아래 page.tsx 전부(허브 인덱스 page.tsx 포함). `
      + '제외: (main)/admin/workstations(관리 화면)·tablet/workstation(타블렛 모드).',
  ambiguity: '허브 인덱스((main)/workstation/page.tsx)는 스테이션이 아니라 목록 화면이다 — '
           + '"페이지 수" 지표이므로 **포함**한다(스테이션만 세면 29→28).',
  measure: () => webPages().filter((f) => f.startsWith('(main)/workstation/')).length,
});

// ── 11. Mobile Screens
M({
  key: 'mobileScreens',
  label: 'Mobile Screens',
  rule: '포함: apps/mobile/app/**/*.tsx (expo-router 라우트 파일) 중 `_layout.tsx` 를 **제외**한 것. '
      + '제외 근거: web 쪽 Frontend Pages 가 page.tsx 만 세고 layout.tsx 는 세지 않는 것과 같은 규칙. '
      + '제외: apps/mobile/src/**(컴포넌트)·App.tsx.',
  ambiguity: '레이아웃 2개(_layout.tsx)를 포함하면 31 이 된다. 표의 이름이 "Screens" 이므로 제외한다.',
  measure: () => globFiles('apps/mobile/app', ['**/*.tsx']).filter((f) => !f.endsWith('_layout.tsx')).length,
});

// ── 12~14. 테스트 파일 — 🔴 러너 설정(vitest include)이 정본이다
/** vitest.config.ts 의 `include: [...]` 를 파싱한다. 못 읽으면 null(추정하지 않는다). */
function vitestInclude(pkgDir) {
  const cfg = join(ROOT, pkgDir, 'vitest.config.ts');
  if (!existsSync(cfg)) return null;
  const m = readFileSync(cfg, 'utf8').match(/include\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  return [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
}
function testFiles(pkgDir, fallbackGlobs) {
  const inc = vitestInclude(pkgDir) ?? fallbackGlobs;
  return { globs: inc, files: globFiles(pkgDir, inc), fromConfig: vitestInclude(pkgDir) !== null };
}
M({
  key: 'backendTestFiles',
  label: 'Backend Test Files',
  rule: '포함: apps/api/vitest.config.ts 의 `include` 글롭에 매칭되는 파일 전부 '
      + '(현재 `test/**/*.spec.ts` + `src/**/*.spec.ts`). '
      + '🔴 규칙의 정본은 **러너 설정**이다 — 사람이 test/ 만 세거나 src/ 만 세서 값이 갈렸다.',
  measure: () => testFiles('apps/api', []).files.length,
  detail: () => {
    const t = testFiles('apps/api', []);
    const a = t.files.filter((f) => f.startsWith('test/')).length;
    const b = t.files.filter((f) => f.startsWith('src/')).length;
    return `include=${JSON.stringify(t.globs)} → test/ ${a} + src/ ${b}`;
  },
});
M({
  key: 'webTestFiles',
  label: 'Web Test Files',
  rule: '포함: apps/web/vitest.config.ts 의 `include` 글롭 매칭 파일 '
      + '(현재 `src/**/*.{test,spec}.{ts,tsx}` + `test/**/*.{test,spec}.{ts,tsx}`).',
  measure: () => testFiles('apps/web', []).files.length,
});
M({
  key: 'sharedTestFiles',
  label: 'Shared Test Files',
  rule: '포함: packages/shared/vitest.config.ts 의 `include` 글롭 매칭 파일. '
      + '🔴 규칙의 정본은 **러너 설정**이다(2026-08-18 설정 신설 — 종전엔 설정이 없어 이 스크립트의 '
      + '임시 글롭이 정본 노릇을 했다).',
  measure: () => testFiles('packages/shared', ['test/**/*.spec.ts', 'src/**/*.spec.ts']).files.length,
});
M({
  key: 'orphanTestFiles',
  label: 'Orphan Test Files (러너 미매칭)',
  rule: '포함: 저장소 안 *.spec.ts(x)/*.test.ts(x) 중 위 세 규칙 어디에도 매칭되지 않는 파일. '
      + '🔴 0 이 아니면 **아무 러너도 실행하지 않는 테스트**가 있다는 뜻이다.',
  measure: () => orphanTests().length,
  detail: () => orphanTests().join(', ') || '없음',
});
function orphanTests() {
  const all = globFiles('.', ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'])
    .filter((f) => !f.startsWith('apps/mobile/')); // 모바일은 러너 없음(별도)
  const known = new Set([
    ...testFiles('apps/api', []).files.map((f) => `apps/api/${f}`),
    ...testFiles('apps/web', []).files.map((f) => `apps/web/${f}`),
    ...globFiles('packages/shared', ['test/**/*.spec.ts', 'test/**/*.test.ts',
      'src/**/*.spec.ts', 'src/**/*.test.ts']).map((f) => `packages/shared/${f}`),
  ]);
  return all.filter((f) => !known.has(f));
}

// ── 15. Seed Data Lines
M({
  key: 'seedDataLines',
  label: 'Seed Data Lines',
  rule: '포함: apps/api/prisma/seed.ts + apps/api/prisma/seed-*.{ts,js} + '
      + 'apps/api/prisma/seeds/**/*.{ts,js,cjs,mjs} 의 **총 행 수**. '
      + '제외: .sql(prisma/manual·prisma/sql·seeds 안의 .sql)·backfill-*·import-*·kcd-expand '
      + '(시드가 아니라 이관/보정 스크립트).',
  ambiguity: '🔴 이전 15,588 은 어떤 파일 집합인지 기록이 없어 재현되지 않았다. '
           + '.sql 시드를 포함할지는 사람 판단(현재 제외).',
  measure: () => seedFiles().reduce((n, f) => n + lines(f), 0),
  detail: () => `${seedFiles().length} 파일`,
});
function seedFiles() {
  return [
    ...globFiles('apps/api/prisma', ['seed.ts', 'seed-*.ts', 'seed-*.js',
      'seeds/**/*.ts', 'seeds/**/*.js', 'seeds/**/*.cjs', 'seeds/**/*.mjs']),
  ].map((f) => `apps/api/prisma/${f}`);
}

// ── 16. Plan Documents
M({
  key: 'planDocuments',
  label: 'Plan Documents',
  rule: '포함: docs/**/*.plan.md 전부(하위 폴더 포함). 제외: docs 밖·.plan.md 가 아닌 기획 문서.',
  measure: () => globFiles('docs', ['**/*.plan.md']).length,
});

// ─────────────────────────────────────────────────────── 세지 않는 것(명시적 부재)

/**
 * 🔴 파일시스템만으로 셀 수 없는 값 — **추정하지 않는다.** 출처를 밝히고 넘긴다.
 */
const NOT_MEASURED = [
  ['Medication Codes / Diagnosis Codes', '운영 DB 행 수. `psql` 실측이 출처(스크립트는 DB 를 읽지 않는다).'],
  ['통과 테스트 수(BE 8,086 등)', '러너 실행 결과. `npm test` 출력이 출처 — 파일 수와 다른 지표다.'],
  ['RBAC 역할·게이트·베드 등 서술형 행', '수치가 아니라 설계 서술. 계측 대상이 아니다.'],
];

// ─────────────────────────────────────────────────────────────────────── 실행

function measureAll() {
  const out = {};
  for (const m of METRICS) out[m.key] = m.measure();
  return out;
}

function printRules() {
  console.log('# System Scale 계수 규칙 (정본: scripts/system-scale.mjs)\n');
  for (const m of METRICS) {
    console.log(`## ${m.label}  (\`${m.key}\`)`);
    console.log(m.rule);
    if (m.ambiguity) console.log(`\n> 애매한 지점: ${m.ambiguity}`);
    console.log('');
  }
  console.log('## 계측하지 않는 것');
  for (const [k, why] of NOT_MEASURED) console.log(`- **${k}** — ${why}`);
  console.log('');
}

function printTable(vals) {
  const w = Math.max(...METRICS.map((m) => m.label.length));
  console.log('| 지표 | 수량 | 근거 |');
  console.log('|------|-----:|------|');
  for (const m of METRICS) {
    const d = m.detail ? m.detail() : '';
    console.log(`| ${m.label.padEnd(w)} | ${String(vals[m.key]).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} | ${d} |`);
  }
}

const args = new Set(process.argv.slice(2));

if (args.has('--rules')) { printRules(); process.exit(0); }

const vals = measureAll();

if (args.has('--json')) {
  console.log(JSON.stringify({ measuredAt: new Date().toISOString().slice(0, 10), values: vals }, null, 2));
  process.exit(0);
}

function gitProvenance() {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim();
    return { head, dirty: dirty ? dirty.split('\n').length : 0 };
  } catch { return null; }
}

if (args.has('--freeze')) {
  const prov = gitProvenance();
  writeFileSync(LOCK, JSON.stringify({
    note: 'scripts/system-scale.mjs --check 의 동결값. 커지든 작아지든 다르면 실패한다.',
    frozenAt: new Date().toISOString().slice(0, 10),
    gitHead: prov?.head ?? null,
    dirtyFilesAtFreeze: prov?.dirty ?? null,
    dirtyWarning: prov && prov.dirty > 0
      ? '🔴 동결 시점에 미커밋 변경이 있었다(병렬 작업 중일 수 있음). 전부 랜딩된 뒤 다시 --freeze 하라.'
      : undefined,
    values: vals,
  }, null, 2) + '\n');
  console.log(`frozen → ${relative(ROOT, LOCK)}`);
  process.exit(0);
}

if (args.has('--check')) {
  if (!existsSync(LOCK)) {
    console.error('동결값이 없다. 먼저 `node scripts/system-scale.mjs --freeze` 를 실행하라.');
    process.exit(2);
  }
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  const diffs = [];
  const keys = new Set([...Object.keys(lock.values), ...Object.keys(vals)]);
  for (const k of keys) {
    const was = lock.values[k], now = vals[k];
    if (was === undefined) { diffs.push(`+ ${k}: 동결값에 없는 신규 지표 (현재 ${now})`); continue; }
    if (now === undefined) { diffs.push(`- ${k}: 스크립트에서 사라진 지표 (동결 ${was})`); continue; }
    if (now > was) diffs.push(`↑ ${k}: ${was} → ${now} (+${now - was})`);
    else if (now < was) diffs.push(`↓ ${k}: ${was} → ${now} (${now - was})`);
  }
  if (diffs.length === 0) {
    console.log(`OK — ${keys.size}개 지표가 동결값(${lock.frozenAt})과 일치한다.`);
    process.exit(0);
  }
  console.error(`FAIL — System Scale 이 동결값(${lock.frozenAt})과 어긋난다 (${diffs.length}건):\n`);
  for (const d of diffs) console.error('  ' + d);
  console.error('\n실제 증감이면: CLAUDE.md 표를 갱신하고 `--freeze` 로 다시 동결하라.');
  console.error('세는 방법을 바꿨다면: docs/05-reference/system-scale-counting-rules.md 도 같이 고쳐라.');
  process.exit(1);
}

printRules();
console.log(`# 실측 (${new Date().toISOString().slice(0, 10)})\n`);
printTable(vals);
