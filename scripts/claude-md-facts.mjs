#!/usr/bin/env node
/**
 * scripts/claude-md-facts.mjs — CLAUDE.md **서술 수치** ↔ 코드 실측 기계 대조
 *
 * 왜: System Scale 표의 21개 지표는 `system-scale.mjs --check` 가 동결 대조하지만, 표 **서술 안**의
 *     수치("wired 28종"·"71불변식"·"펄스 9지표"·"결정 등록부 66"·"영역 카탈로그 48" …)는 손으로 적혀 낡는다.
 *     2026-09-13 한 주에만 12→28·67→71·7→9·61→66·46→48 을 사후에 발견했다 — 같은 사실에 정본이 둘이면 갈라진다.
 *
 * 규약
 *  - 🔴 코드가 정본이다. 불일치면 CLAUDE.md 를 고친다 — 코드를 문서에 맞추지 않는다.
 *  - 🔴 세지 못하는 것은 `null` + 사유로 남기고 `--check` 는 **실패**한다(모르는 것을 통과로 세지 않는다).
 *  - 각 항목은 "코드 어디서 어떻게 세는가"(`where`)를 못박는다. 재현 불가 항목은 EXCLUDED 에 사유와 함께 둔다.
 *  - 표의 21개 지표 행 자체는 `system-scale.lock.json` 과 대조한다(살아 있는 계측은 system-scale 이 맡는다 —
 *    여기서는 "표에 적힌 수 = 동결값" 만 본다. 동결값 ≠ 코드는 `system-scale --check` 의 몫).
 *
 * 사용법
 *   node scripts/claude-md-facts.mjs            # 대조표 출력
 *   node scripts/claude-md-facts.mjs --check    # 불일치·측정 불가가 하나라도 있으면 exit 1
 *   node scripts/claude-md-facts.mjs --json     # 기계 판독
 *   node scripts/claude-md-facts.mjs --sources  # 이 스크립트가 읽는 파일 목록(테스트 재주입용)
 *   옵션 --root <dir>  --shared-dist <dir>      # 테스트가 임시 사본을 겨눌 때
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const ROOT = opt('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_DIST = opt('--shared-dist') ?? join(ROOT, 'packages', 'shared', 'dist');

// ───────────────────────────────────────────────────────────── 읽는 파일(정본 위치)
export const SOURCES = {
  doc: 'CLAUDE.md',
  lock: 'scripts/system-scale.lock.json',
  safetyGate: 'apps/api/src/modules/safety-gate/safety-gate.service.ts',
  integritySql: 'infra/scripts/data-integrity-scan.sql',
  pulse: 'apps/api/src/sentinel/pulse-registry.ts',
  verdicts: 'packages/shared/src/sentinel-judgment.ts',
  decisions: 'apps/api/src/modules/decision-registry/decision.registry.ts',
  committees: 'apps/api/src/modules/gld/governance.service.ts',
  opening: 'apps/api/src/modules/opening/opening.registry.ts',
  seed: 'apps/api/prisma/seed.ts',
  emergencyDir: 'apps/api/src/modules/emergency',
  boardsDir: 'apps/web/src/app/display/_boards',
  prisma: 'apps/api/prisma/schema.prisma',
  apiSrcDir: 'apps/api/src',
  prismaDir: 'apps/api/prisma',
  screenCodes: 'apps/web/src/components/layout/screen-codes.frozen.ts',
};

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripLineComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/.*$/gm, '');
/** `marker` 로 시작해 처음 만나는 `\n];` 까지 — 배열 리터럴 블록 */
function arrayBlock(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error(`marker 없음: ${marker}`);
  const j = src.indexOf('\n];', i);
  if (j < 0) throw new Error(`배열 끝 없음: ${marker}`);
  return src.slice(i, j);
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const count = (s, re) => (s.match(re) ?? []).length;

// ───────────────────────────────────────────────────────────── shared dist(i18n — 빌드 산출물 필요)
let shared = null, sharedErr = null;
try {
  shared = createRequire(import.meta.url)(join(SHARED_DIST, 'index.js'));
} catch (e) {
  sharedErr = `shared dist 를 읽지 못했다(${SHARED_DIST}) — \`cd packages/shared && npm run build\` · ${e.message.split('\n')[0]}`;
}
const viaShared = (fn) => { if (!shared) throw new Error(sharedErr); return fn(shared); };

// ───────────────────────────────────────────────────────────── 실측(코드가 정본)
function measureGates() {
  const src = stripLineComments(read(SOURCES.safetyGate));
  const i = src.indexOf('private wiredGates()');
  if (i < 0) throw new Error('wiredGates() 없음');
  const body = src.slice(i, src.indexOf('\n    ];', i));
  const modes = [...body.matchAll(/defaultMode: '(BLOCK|WARN|OFF)'/g)].map((m) => m[1]);
  const keys = count(body, /\bkey: '/g);
  if (keys !== modes.length) throw new Error(`게이트 key ${keys} ≠ defaultMode ${modes.length} — 모드 없는 게이트가 있다`);
  const by = (m) => modes.filter((x) => x === m).length;
  return { wired: keys, block: by('BLOCK'), warn: by('WARN'), off: by('OFF') };
}
const gates = lazy(measureGates);
function lazy(fn) { let v, done = false; return () => { if (!done) { v = fn(); done = true; } return v; }; }

function measureDecisions() {
  const src = read(SOURCES.decisions);
  const reg = arrayBlock(src, 'export const DECISION_REGISTRY');
  const tracks = src.slice(src.indexOf('export const DECISION_TRACKS'), src.indexOf('} as const;', src.indexOf('export const DECISION_TRACKS')));
  // 🔴 (2026-09-15) 등록부가 증분 파일(`decision.registry.batch-*.ts`)을 전개(`...DECISION_BATCH_*`)로 합친다 —
  //    본 파일만 세면 17건이 늘어도 "66 일치"로 통과했다. 전개된 증분 배열만 더한다(전개 안 된 파일은 등록부가 아니다).
  const dir = dirname(SOURCES.decisions);
  const blocks = [reg];
  for (const name of readdirSync(join(ROOT, dir)).filter((f) => /^decision\.registry\.batch-.+\.ts$/.test(f)).sort()) {
    const bsrc = read(join(dir, name));
    const m = /export const (DECISION_BATCH_[A-Z0-9_]+)/.exec(bsrc);
    if (!m || !new RegExp(`\\.\\.\\.${m[1]}\\b`).test(reg)) continue;
    blocks.push(arrayBlock(bsrc, `export const ${m[1]}`));
  }
  const sum = (re) => blocks.reduce((n, b) => n + count(b, re), 0);
  return {
    registry: sum(/^  \{/gm),
    requiredBefore: sum(/goLive: 'REQUIRED_BEFORE',/g),
    releaseKeys: sum(/key: 'release\./g),
    tracks: count(tracks, /^  [A-Z0-9_]+: '/gm),
  };
}
const decisions = lazy(measureDecisions);

function measureOpening() {
  const src = read(SOURCES.opening);
  const countries = [...src.matchAll(/countries: \[([^\]]*)\]/g)].map((m) => m[1]);
  const stage = src.slice(src.indexOf('export const PHASE_STAGE'), src.indexOf('\n};', src.indexOf('export const PHASE_STAGE')));
  return {
    kr: countries.filter((c) => /'KR'/.test(c)).length,
    ae: countries.filter((c) => /'AE'/.test(c)).length,
    before: count(stage, /: 'BEFORE'/g),
    after: count(stage, /: 'AFTER'/g),
  };
}
const opening = lazy(measureOpening);

function measureErZones() {
  const m = read(SOURCES.seed).match(/const ER_ZONES: \[string, number\]\[\] = \[([^\]]*(?:\][^\]]*)*)\];/);
  if (!m) throw new Error('seed.ts ER_ZONES 없음');
  const pairs = [...m[1].matchAll(/\['([A-Z]+)', (\d+)\]/g)];
  return { zones: pairs.length, beds: pairs.reduce((a, p) => a + Number(p[2]), 0) };
}
const erZones = lazy(measureErZones);

function measureI18n() {
  return viaShared((s) => {
    const packs = s.allLocalePacks().map((p) => p.code).filter((c) => !c.startsWith('xx-'));
    const core = s.localeCoverage(s.COVERAGE_CORE_LOCALE);
    const gaps = Object.fromEntries(packs.map((c) => [c, (s.packContextGaps(c) ?? []).length]));
    // 🔴 코어 조립본(en·ja)과 DEFERRED(ar)를 뺀 나머지가 "추가 팩" — 정의는 i18n-coverage-honesty.spec 과 같다
    const extra = packs.filter((c) => !['en', 'ja', 'ar'].includes(c));
    return { areaCatalogs: s.AREA_CATALOGS.length, coreKeys: core.coreTotal, extraPacks: extra.length, gaps };
  });
}
const i18n = lazy(measureI18n);

function screenCode(href) {
  const m = read(SOURCES.screenCodes).match(new RegExp(`'${href.replace(/[/.]/g, '\\$&')}': '(\\d+)'`));
  if (!m) throw new Error(`frozen 화면번호 없음: ${href}`);
  return Number(m[1]);
}

/**
 * 대조 항목 — { id, where, doc: CLAUDE.md 에서 수치를 뽑는 정규식(1그룹), code: 실측 }
 * 🔴 doc 정규식은 그 수치 하나만 잡도록 앞뒤 문맥을 충분히 물린다(엉뚱한 수를 잡으면 가드가 헛돈다).
 */
export const FACTS = [
  { id: 'gates.wired', where: 'safety-gate.service.ts wiredGates() 의 key 수', doc: /wired \*\*(\d+)종\*\*/, code: () => gates().wired },
  { id: 'gates.block', where: 'wiredGates() defaultMode BLOCK', doc: /기본 BLOCK (\d+)·WARN \d+·\*\*OFF \d+\*\*/, code: () => gates().block },
  { id: 'gates.warn', where: 'wiredGates() defaultMode WARN', doc: /기본 BLOCK \d+·WARN (\d+)·\*\*OFF \d+\*\*/, code: () => gates().warn },
  { id: 'gates.off', where: 'wiredGates() defaultMode OFF', doc: /기본 BLOCK \d+·WARN \d+·\*\*OFF (\d+)\*\*/, code: () => gates().off },
  { id: 'sentinel.invariants', where: "data-integrity-scan.sql 의 `SELECT '<심각도>'` 행 수(🔴🟡⚪)", doc: /데이터 정합성 \*\*(\d+)불변식\*\*/, code: () => count(read(SOURCES.integritySql), /^SELECT '(🔴|🟡|⚪)'/gm) },
  { id: 'sentinel.pulse', where: 'pulse-registry.ts PULSE_METRICS 의 key 수', doc: /1분 펄스 \*\*(\d+)지표\*\*/, code: () => count(stripLineComments(arrayBlock(read(SOURCES.pulse), 'export const PULSE_METRICS')), /^\s*key: '/gm) },
  { id: 'sentinel.verdicts', where: 'shared sentinel-judgment.ts SENTINEL_JUDGMENT_VERDICTS 길이', doc: /append-only·shared 어휘 (\d+)종/, code: () => { const src = read(SOURCES.verdicts); const i = src.indexOf('export const SENTINEL_JUDGMENT_VERDICTS'); return count(src.slice(i, src.indexOf('] as const', i)), /^\s*'[A-Z_]+',/gm); } },
  { id: 'decisions.registry', where: 'decision.registry.ts DECISION_REGISTRY 항목 수', doc: /결정 등록부 \*\*(\d+)\*\*/, code: () => decisions().registry },
  { id: 'decisions.releaseKeys', where: "DECISION_REGISTRY 중 key 'release.*'", doc: /`release\.\*` (\d+)건 등재/, code: () => decisions().releaseKeys },
  { id: 'decisions.requiredBefore', where: "DECISION_REGISTRY 중 goLive 'REQUIRED_BEFORE'", doc: /개시 전 필수 (\d+) ·/, code: () => decisions().requiredBefore },
  { id: 'decisions.tracks', where: 'DECISION_TRACKS 키 수', doc: /\*\*축 (\d+)종\*\*\(`DECISION_TRACKS`\)/, code: () => decisions().tracks },
  { id: 'committees', where: 'gld/governance.service.ts COMMITTEE_SEED 항목 수', doc: /\+위원회 (\d+)\(선택지 의결/, code: () => count(arrayBlock(read(SOURCES.committees), 'const COMMITTEE_SEED'), /^\s*\{ code: '/gm) },
  { id: 'opening.kr', where: "opening.registry.ts countries 에 'KR' 포함 항목", doc: /국가 축\*\*\(KR (\d+)·AE \d+·/, code: () => opening().kr },
  { id: 'opening.ae', where: "opening.registry.ts countries 에 'AE' 포함 항목", doc: /국가 축\*\*\(KR \d+·AE (\d+)·/, code: () => opening().ae },
  { id: 'opening.before', where: 'PHASE_STAGE 의 BEFORE 수', doc: /개원 전 (\d+)단계\+개원\+개원 후 \d+단계/, code: () => opening().before },
  { id: 'opening.after', where: 'PHASE_STAGE 의 AFTER 수', doc: /개원 전 \d+단계\+개원\+개원 후 (\d+)단계/, code: () => opening().after },
  { id: 'opening.screenCode', where: "screen-codes.frozen.ts '/admin/opening'", doc: /\/admin\/opening\((\d+)\)/, code: () => screenCode('/admin/opening') },
  { id: 'er.beds', where: 'prisma/seed.ts ER_ZONES 병상 합', doc: /(\d+)병상 \d+구역\(RESUS/, code: () => erZones().beds },
  { id: 'er.zones', where: 'prisma/seed.ts ER_ZONES 구역 수', doc: /\d+병상 (\d+)구역\(RESUS/, code: () => erZones().zones },
  { id: 'er.configKeys', where: "modules/emergency/*.ts 의 서로 다른 'er.…' 설정 키 리터럴", doc: /config er\.\* (\d+)키/, code: () => new Set(walk(join(ROOT, SOURCES.emergencyDir)).filter((f) => f.endsWith('.ts')).flatMap((f) => readFileSync(f, 'utf8').match(/'er\.[a-zA-Z.]+'/g) ?? [])).size },
  { id: 'display.boards', where: 'app/display/_boards/*Board.tsx 파일 수', doc: /공개 전광판 (\d+)종\(/, code: () => readdirSync(join(ROOT, SOURCES.boardsDir)).filter((f) => /Board\.tsx$/.test(f)).length },
  { id: 'rbac.roles', where: 'schema.prisma enum UserRole 멤버 수', doc: /RBAC 역할\(UserRole\) \| (\d+) —/, code: () => { const m = read(SOURCES.prisma).match(/enum UserRole \{([^}]*)\}/); return count(stripLineComments(m[1]), /^\s*[A-Z_]+\s*$/gm); } },
  { id: 'controllers.decorators', where: 'apps/api/src(스펙 제외) 의 `@Controller(` 수', doc: /@Controller\(\) 데코레이터는 (\d+)/, code: () => walk(join(ROOT, SOURCES.apiSrcDir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).reduce((a, f) => a + count(readFileSync(f, 'utf8'), /@Controller\(/g), 0) },
  { id: 'seed.guardEntries', where: "apps/api/prisma 에서 'seed-mode-guard' 를 참조하는 시드 파일(가드 자신 제외)", doc: /시드 진입점 (\d+)곳/, code: () => walk(join(ROOT, SOURCES.prismaDir)).filter((f) => !/seed-mode-guard\.(js|d\.ts)$/.test(f) && /\.(ts|js|cjs|mjs)$/.test(f) && readFileSync(f, 'utf8').includes('seed-mode-guard')).length },
  { id: 'i18n.coreKeys', where: 'shared localeCoverage(COVERAGE_CORE_LOCALE).coreTotal', doc: /코어 \*\*([\d,]+)키\*\*/, code: () => i18n().coreKeys },
  { id: 'i18n.extraPacks', where: 'shared allLocalePacks() − en·ja·ar(가드 표본 xx- 제외)', doc: /추가 팩 (\d+)종/, code: () => i18n().extraPacks },
  { id: 'i18n.areaCatalogs', where: 'shared AREA_CATALOGS.length', doc: /영역 카탈로그 (\d+)\(/, code: () => i18n().areaCatalogs },
  { id: 'i18n.reviewScreenCode', where: "screen-codes.frozen.ts '/admin/ui-locale/review'", doc: /`\/admin\/ui-locale\/review` (\d+)/, code: () => screenCode('/admin/ui-locale/review') },
  ...['ar', 'zh', 'th', 'ru', 'vi', 'kk', 'mn'].map((c) => ({
    id: `i18n.gap.${c}`, where: `shared packContextGaps('${c}').length`,
    doc: new RegExp(`문맥 키 결손 잔여 (?:[a-z]{2} \\d+·)*${c} (\\d+)`), code: () => i18n().gaps[c],
  })),
];

/** System Scale 표 행 — "표에 적힌 수 = 동결값(system-scale.lock.json)". 행 첫 수치만 본다. */
export const TABLE_ROWS = [
  ['Prisma Models', 'prismaModels'], ['Backend Modules (도메인)', 'backendModules'], ['Controllers', 'controllers'],
  ['Services', 'services'], ['API Endpoints', 'apiEndpoints'], ['AI Endpoints', 'aiEndpoints'],
  ['Frontend Pages (Total)', 'webPagesTotal'], ['Frontend Pages (Main)', 'webPagesMain'], ['Frontend Pages (Homepage)', 'webPagesHomepage'],
  ['Admin Pages', 'adminPages'], ['Workstation Pages', 'workstationPages'], ['Mobile Screens', 'mobileScreens'],
  ['Backend Test Files', 'backendTestFiles'], ['Seed Data Lines', 'seedDataLines'], ['Plan Documents', 'planDocuments'],
];
const TABLE_INLINE = [
  { id: 'table.apiEndpointsSse', key: 'apiEndpointsSse', doc: /@Sse (\d+) [은는] 별도/ },
  { id: 'table.webTestFiles', key: 'webTestFiles', doc: /\+web (\d+)파일·shared \d+파일/ },
  { id: 'table.sharedTestFiles', key: 'sharedTestFiles', doc: /\+web \d+파일·shared (\d+)파일/ },
  { id: 'table.homepageAppPages', key: 'homepageAppPages', doc: /별도 앱 `apps\/homepage` (\d+) 은 미포함/ },
  { id: 'table.webPagesOther', key: 'webPagesOther', doc: /기타 그룹 (\d+)\(tablet/ },
];

/** 코드로 재현할 수 없어 대조하지 않는 서술 수치 — 사유를 남긴다(없는 척하지 않는다) */
export const EXCLUDED = [
  ['Medication/Diagnosis Codes (운영) 24,022·18,184 등', '운영 DB 행 수 — 파일 시스템 밖(system-scale 규칙과 같은 사유)'],
  ['통과 테스트 수 BE/web/shared', '러너 실행 결과 — 파일 수와 다른 지표. 갱신은 실행분 날짜와 함께 사람이 적는다'],
  ['번역 비율 en/ja 100%·ar 94.8%·추가 팩 9.5/8.0/…%', '비율은 반올림·분모 시점에 따라 흔들린다 — 분모(코어 키 수)만 대조한다'],
  ['분류기 자동수집 ~34종 · docType 9종+', '"~"·"+" 가 붙은 근사치 — 정확 수를 주장하지 않는 서술'],
  ['자동 해제 4경로 · 전송 상태·감사 규약 등 설계 서술', '경로 수는 코드 구조로 기계 판정할 정의가 없다(사람 판단 항목)'],
  ['판정 규칙 절의 실측 수치(24개소 중 16·9역할·54개소 …)', '그 시점의 사건 기록(역사)이지 현재 상태 주장이 아니다'],
  ['Formulary 7영역·전자결재 3카테고리', '정본 상수를 찾지 못했다 — 화면·서비스에 흩어진 서술. 상수가 생기면 등재한다'],
];

// ───────────────────────────────────────────────────────────── 대조
export function compare() {
  const doc = read(SOURCES.doc);
  const lock = JSON.parse(read(SOURCES.lock)).values;
  const rows = [];
  const num = (s) => Number(String(s).replace(/,/g, ''));
  for (const f of FACTS) {
    const m = doc.match(f.doc);
    const docVal = m ? num(m[1]) : null;
    let codeVal = null, err = null;
    try { codeVal = f.code(); } catch (e) { err = e.message; }
    if (codeVal == null && !err) err = '실측이 null';
    rows.push({ id: f.id, where: f.where, doc: docVal, code: codeVal, ok: docVal != null && codeVal != null && docVal === codeVal, err: err ?? (m ? null : 'CLAUDE.md 에서 문구를 찾지 못했다(형식이 바뀌었으면 정규식을 고친다)') });
  }
  for (const [label, key] of TABLE_ROWS) {
    const m = doc.match(new RegExp(`^\\| ${label.replace(/[()]/g, '\\$&')} \\| ([\\d,]+)`, 'm'));
    const docVal = m ? num(m[1]) : null;
    rows.push({ id: `table.${key}`, where: `system-scale.lock.json ${key}`, doc: docVal, code: lock[key] ?? null, ok: docVal != null && docVal === lock[key], err: m ? null : `표 행 '${label}' 없음` });
  }
  for (const t of TABLE_INLINE) {
    const m = doc.match(t.doc);
    const docVal = m ? num(m[1]) : null;
    rows.push({ id: t.id, where: `system-scale.lock.json ${t.key}`, doc: docVal, code: lock[t.key] ?? null, ok: docVal != null && docVal === lock[t.key], err: m ? null : 'CLAUDE.md 에서 문구를 찾지 못했다' });
  }
  return rows;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (argv.includes('--sources')) {
    for (const v of Object.values(SOURCES)) console.log(v);
    process.exit(0);
  }
  const rows = compare();
  const bad = rows.filter((r) => !r.ok);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ root: relative(process.cwd(), ROOT) || '.', rows, excluded: EXCLUDED }, null, 2));
  } else {
    for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id.padEnd(30)} 문서 ${String(r.doc).padStart(7)} · 코드 ${String(r.code).padStart(7)}  — ${r.where}${r.err ? `  🔴 ${r.err}` : ''}`);
    console.log(`\n${rows.length}개 대조 · 불일치 ${bad.length} · 대조 제외 ${EXCLUDED.length}(사유는 --json)`);
    if (bad.length) console.log('🔴 코드가 정본이다 — CLAUDE.md 의 수치를 실측으로 고친다(코드를 문서에 맞추지 않는다).');
  }
  if (argv.includes('--check') && bad.length) process.exit(1);
}
