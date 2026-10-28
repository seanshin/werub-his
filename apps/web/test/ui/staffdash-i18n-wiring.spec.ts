import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APPOINTMENT_STATUS_LABEL } from '@hospital-run/shared';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, stripComments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 스태프 포털(/staff/*) 10화면 + 대시보드 확장 위젯 21종의 UI 언어 배선 가드 (2026-09-11 §12 잔여 · 카탈로그 `staffdash`).
 *
 * 두 묶음은 결함의 모양이 다르다.
 *   · /staff/* — 스캐너 `t=0`(배선 0). 로그인·생체 승인·전자결재·인수인계 화면의 문구·토스트·confirm·
 *     보간 문장(`전송됨 (N명)`·`수신함 N`·`N건 미확인`)이 전부 생문자열이었다.
 *   · 위젯 21종 — 라벨은 부모 부품(`ApiStatsWidget` 의 `<T k={s.label}>`·`RowListWidget` 의 `<T k={empty}>`)이
 *     이미 번역하고 있어 **파일 안에는 `<T>` 가 없어도 배선된 것**이다(그래서 이 파일들의 `t` 는 0 이 정답일 수 있다).
 *     남은 결함은 ① 행 오른쪽 값(`${n}건`·`${n}점`·`산출 불가 (… 미관측)`)이 생문자열 ② `tt('…')` 로
 *     **이미 번역한 문자열을 스스로 번역하는 부품**(EmptyState·Ratio)에 넘겨 AI 초안 표기·미등록 티가 사라지던 이중 번역
 *     ③ 맨 키 `예약`(=Appointment)·`해결`(=Resolve)이 혈액 유닛 예약·감염 해결 건수 라벨로 쓰인 오역.
 *
 * 이 가드가 못박는 것은 **반증 가능한 것만**이다:
 *   (a) 화면별 한글 잔여 조각(`ko`)과 식 옆 텍스트 조각(`koExpr`) — 스캐너 정본 수와 **정확 일치**(여유 0).
 *   (b) 화면별 `<T>`/`tAttr`/`<Tf>`/`tfAttr` 배선 수(`t`) — 하한. /staff 10화면은 전부 >0.
 *   (b') 🔴 위젯 라벨을 번역하는 **부모 부품의 배선** — 이것이 끊기면 위젯 21종의 라벨이 한꺼번에 생한글이 된다.
 *   (c) 화면이 i18n 층에 넘기는 한국어 키가 어느 카탈로그엔가 있다(없으면 `EN×` 거짓 티).
 *   (c') 자리표시자(`{이름}`)가 든 키를 `<T>`/`tAttr` 로 부르지 않는다 — 보간 없이 `{수}` 가 그대로 찍힌다.
 *   (c'') 🔴 스스로 번역하는 부품(EmptyState title·Ratio unavailableHint)에 `tAttr`/`tt` 결과를 넘기지 않는다(이중 번역).
 *   (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 staffdash 가 다시 정의하지 않는다.
 *   (e) 고아 키 0 — staffdash 의 모든 키를 소유 화면이 i18n 층에 실제로 넘긴다.
 *   (f) 세 언어 키 집합 동일 · 빈 값 0 · 번역문이 키와 같은 자리표시자를 갖는다.
 *   (g) 문맥 키가 추가 언어 팩에 문맥 결손을 만들지 않는다.
 *
 * 🔴 정본에서 파생한다 — 카탈로그 목록·등록 순서는 `registry.ts` 를 읽어서 만든다.
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const WEB = join(ROOT, 'apps/web/src');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf8');

const EXT = '(main)/dashboard/components/widgets/ext';
const STAFF_FILES = [
  'staff/approvals/HrApprovalSection.tsx',
  'staff/approvals/page.tsx',
  'staff/dashboard/page.tsx',
  'staff/enroll/[sessionId]/page.tsx',
  'staff/ess/page.tsx',
  'staff/handoffs/page.tsx',
  'staff/login/page.tsx',
  'staff/page.tsx',
  'staff/payroll/page.tsx',
  'staff/team/page.tsx',
] as const;
const WIDGET_FILES = [
  'AdmissionTrendWidget', 'AdrStatsWidget', 'AppointmentsWidget', 'BedStatusWidget', 'BillingReviewQueueWidget',
  'BloodBankWidget', 'ChartTopDxWidget', 'ClaimsWidget', 'DailySettlementWidget', 'ErStatusWidget',
  'EwsHighRiskWidget', 'IcuAlertsWidget', 'IcuDashboardWidget', 'InfectionWidget', 'IpsgSummaryWidget',
  'LabStatsWidget', 'PatientFlowWidget', 'QiDashboardWidget', 'RevenueTodayWidget', 'SafetyIncidentsWidget',
  'SystemHealthWidget',
].map((n) => `${EXT}/${n}.tsx`);
const OWNED = [...STAFF_FILES, ...WIDGET_FILES];

/**
 * 2026-09-11 배선 후 실측 (재현: `node scripts/i18n-unwired-scan.mjs --json` → rows[].ko / koExpr / t).
 * `ko` 에 남은 것은 표시 문구가 아니다 — 라벨 맵 정의(`<T k={맵[x]}>` 로 렌더)·부서명 비교값(`dept.startsWith('검사실')`)·
 *   스스로 번역하는 부품의 prop(ReasonInput placeholder·EmptyState title·위젯 `label:`)·`<Unit>건</Unit>`(단위 부품)·
 *   의도적 미번역(통화 접미 `원`·병원명 하드코딩 — 사유는 `staffdash.ts` 머리 주석).
 * 🔴 여유 0 — 늘면 실패, 줄면 이 표를 내린다.
 */
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
const BASELINE: Record<string, { ko: number; koExpr: number; t: number }> = {
  'staff/approvals/HrApprovalSection.tsx': { ko: 10, koExpr: 0, t: 27 }, // 2026-09-14 상태 라벨 삼항 <T> 1곳 → StatusBadge domain="hrRequest"(배지가 번역) — 배선 감소가 아니라 정본 이관
  'staff/approvals/page.tsx': { ko: 13, koExpr: 0, t: 39 },
  'staff/dashboard/page.tsx': { ko: 1, koExpr: 0, t: 26 },
  'staff/enroll/[sessionId]/page.tsx': { ko: 0, koExpr: 0, t: 16 },
  'staff/ess/page.tsx': { ko: 0, koExpr: 0, t: 3 },
  'staff/handoffs/page.tsx': { ko: 0, koExpr: 0, t: 10 },
  'staff/login/page.tsx': { ko: 12, koExpr: 0, t: 48 },
  'staff/page.tsx': { ko: 36, koExpr: 0, t: 38 },
  'staff/payroll/page.tsx': { ko: 0, koExpr: 0, t: 4 },
  'staff/team/page.tsx': { ko: 7, koExpr: 0, t: 19 },
  // 2026-10-02 — 기간 합계 줄을 더해 단위어(`<Unit>건</Unit>`·`<Unit>일</Unit>` — Unit 부품이 번역) 하나 늘었다
  [`${EXT}/AdmissionTrendWidget.tsx`]: { ko: 2, koExpr: 0, t: 1 },
  [`${EXT}/AdrStatsWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  [`${EXT}/AppointmentsWidget.tsx`]: { ko: 0, koExpr: 0, t: 1 },
  [`${EXT}/BedStatusWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  [`${EXT}/BillingReviewQueueWidget.tsx`]: { ko: 1, koExpr: 0, t: 0 },
  [`${EXT}/BloodBankWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  [`${EXT}/ChartTopDxWidget.tsx`]: { ko: 1, koExpr: 0, t: 1 },
  [`${EXT}/ClaimsWidget.tsx`]: { ko: 7, koExpr: 0, t: 0 },
  [`${EXT}/DailySettlementWidget.tsx`]: { ko: 5, koExpr: 0, t: 0 },
  [`${EXT}/ErStatusWidget.tsx`]: { ko: 3, koExpr: 0, t: 0 },
  [`${EXT}/EwsHighRiskWidget.tsx`]: { ko: 1, koExpr: 0, t: 2 },
  [`${EXT}/IcuAlertsWidget.tsx`]: { ko: 1, koExpr: 0, t: 4 },
  [`${EXT}/IcuDashboardWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  [`${EXT}/InfectionWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  [`${EXT}/IpsgSummaryWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  [`${EXT}/LabStatsWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  [`${EXT}/PatientFlowWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  [`${EXT}/QiDashboardWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  [`${EXT}/RevenueTodayWidget.tsx`]: { ko: 5, koExpr: 0, t: 0 },
  [`${EXT}/SafetyIncidentsWidget.tsx`]: { ko: 4, koExpr: 0, t: 0 },
  // 2026-10-02 — DB·Redis 점검을 더해 행 라벨 셋(`label="API 서버"` 등 · 부품 안에서 <T k={label}> 로 배선)
  [`${EXT}/SystemHealthWidget.tsx`]: { ko: 3, koExpr: 0, t: 0 },
};

/* ── 카탈로그 파싱 (정본 = registry.ts 의 등록 순서) ────────────────────────── */

/** registry.ts 가 import(=registerCatalog) 하는 순서 — `t()` 의 우선순위 정본 */
function registeredOrder(): string[] {
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`);
  // 🔴 common 은 t.ts 가 직접 등록한다(registry 에 registerCatalog 호출이 없다) — 맨 앞이다
  return [...new Set(['common.ts', ...files])];
}
/** 파서 정본은 스캐너(`catalogKeysOf` — 네 표기) */
function keysOf(file: string, dir = MSG): Set<string> {
  return catalogKeysOf(read(join(dir, file)));
}
const PACKS_DIR = join(ROOT, 'packages/shared/src/i18n/packs');
function packFiles(): string[] {
  const idx = read(join(PACKS_DIR, 'index.ts'));
  return [...new Set([...idx.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`))];
}

/**
 * 🔴 의도적 미등재 — 화면은 i18n 층에 넘기지만 **일부러** 카탈로그에 넣지 않은 키(원문+EN× 가 정직하다).
 *   · ~~`급여@인사`~~ — 2026-09-12 등재(맨 `급여` = 'Covered' 오역 회수). 결손이 생기는 팩 5종(zh·th·ru·kk·mn)을 함께 채웠다.
 *   · `연차 잔여` — 급여·근로 법정 어휘(comp2 머리 주석과 같은 정책 · ESS 화면도 같은 키를 미등재로 배선).
 *   집합이 늘거나 줄면 실패한다.
 */
const INTENTIONALLY_UNREGISTERED = ['연차 잔여'];

/** staffdash 의 [en, ja, ar] 튜플 */
function catRows(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'staffdash.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  return [...body.matchAll(/^\s*'((?:\\.|[^'\\])+)':\s*\[([\s\S]*?)\],$/gm)].map((m) => ({
    key: m[1].replace(/\\'/g, "'"),
    v: [...m[2].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((x) => x[1].replace(/\\'/g, "'")),
  }));
}

/* ── 화면 소스에서 i18n 층으로 넘어가는 키 추출 ────────────────────────────── */

/** `name(` 호출의 괄호 안 전체(중첩 괄호 포함) */
function callBodies(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${name}\\(`, 'g');
  for (const m of src.matchAll(re)) {
    let i = m.index! + m[0].length;
    let depth = 1;
    const start = i;
    let q: string | null = null;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') q = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}
/** 문자열 리터럴 — 작은/큰따옴표 모두, 소스 순서대로 */
function literals(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"/g)) {
    out.push(m[1] !== undefined ? m[1].replace(/\\'/g, "'") : m[2]);
  }
  return out;
}

const HAN = /[가-힣]/;
const PARAM = /\{([^{}\s]+)\}/g;
const paramsOf = (s: string) => [...s.matchAll(PARAM)].map((m) => m[1]).sort();

interface Used { plain: Set<string>; interp: Set<string>; all: Set<string> }
function usedKeys(file: string): Used {
  const src = stripComments(read(join(APP, file)));
  const plain = new Set<string>();
  const interp = new Set<string>();
  // 정적 키
  for (const m of src.matchAll(/<T\s+(?:className="[^"]*"\s+)?k="((?:\\.|[^"\\])+)"/g)) plain.add(m[1]);
  for (const m of src.matchAll(/<Tf\s+(?:className="[^"]*"\s+)?k="((?:\\.|[^"\\])+)"/g)) interp.add(m[1]);
  // 동적 키 — `<T k={…}>` 안의 리터럴(조건식 양쪽)
  for (const m of src.matchAll(/<T\s+(?:className="[^"]*"\s+)?k=\{([^{}]*)\}/g)) for (const l of literals(m[1])) plain.add(l);
  // tAttr(…) / tfAttr(…) — tfAttr 는 첫 리터럴만(params 객체 뒤를 보지 않는다)
  for (const b of callBodies(src, 'tAttr')) for (const l of literals(b)) plain.add(l);
  for (const b of callBodies(src, 'tfAttr')) { const l = literals(b)[0]; if (l) interp.add(l); }
  // 라벨 맵·목록 리터럴 — 전부 `<T k={x.label}>`/`<T k={맵[x]}>`/부모 부품의 `<T k={s.label}>` 로 렌더된다.
  //   작은·큰따옴표 둘 다(InfectionWidget 은 `label:"…"`). `key:`·`c:`(색 클래스)는 넣지 않는다.
  for (const m of src.matchAll(/\b(?:label|desc|t|l|[A-Z][A-Z_]+):\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)")/g)) {
    plain.add(m[1] !== undefined ? m[1].replace(/\\'/g, "'") : m[2]);
  }
  // `[['1', '오늘'], ['7', '7일'], …]` — 기간 탭(`<T k={label}>` 로 렌더)
  for (const m of src.matchAll(/\[\s*'[^'\n]*',\s*'([^'\n]*)'\s*\]/g)) plain.add(m[1]);
  // 스스로 번역하는 부품의 문자열 prop — EmptyState title·hint · RowListWidget empty · Ratio unavailableHint · ReasonInput placeholder
  for (const m of src.matchAll(/\b(?:title|hint|empty|unavailableHint|placeholder)="([^"]*)"/g)) plain.add(m[1]);
  const keep = (s: Set<string>) => new Set([...s].filter((k) => HAN.test(k)));
  const p = keep(plain);
  const i = keep(interp);
  return { plain: p, interp: i, all: new Set([...p, ...i]) };
}

/** 부서명 비교값 — 화면에 그리지 않는 데이터(`dept.startsWith('검사실')`) · 추출기가 `label:` 등으로 줍지 않는지 확인용 */
const DEPT_DATA = ['건강검진센터', '검사실', '영상실', '기초검사', '영상의학과(', '치료실', '간호', '병동'];

const ORDER = registeredOrder();
const AT = ORDER.indexOf('staffdash.ts');
const CAT = new Map(ORDER.map((f) => [f, keysOf(f)]));
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of CAT.get(f)!) ALL_KEYS.add(k);
const ROWS = catRows();
const USED = OWNED.map((f) => ({ f, u: usedKeys(f) }));
const USED_ALL = new Set<string>();
for (const { u } of USED) for (const k of u.all) USED_ALL.add(k);
const short = (f: string) => f.replace(`${EXT}/`, 'ext/');

describe('🔴 스태프 포털·대시보드 위젯 i18n 배선 (staffdash)', () => {
  it('대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string }>;
    expect(rows.length).toBeGreaterThan(500);
    for (const f of OWNED) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    expect(OWNED.length).toBe(31);
    expect(AT, 'registry 에서 staffdash 를 찾지 못했다').toBeGreaterThan(0);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(30);
    expect(ROWS.length, 'staffdash 표 파싱이 깨졌다').toBeGreaterThan(100);
    expect(ROWS.length, '표 행 수와 키 수가 다르다(파서가 행을 흘렸다)').toBe(CAT.get('staffdash.ts')!.size);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(5000);
    expect(USED_ALL.size, '화면 키 추출이 깨졌다').toBeGreaterThan(250);
    // 추출기 대조군 — 경로마다 실제로 잡는다
    expect(USED_ALL.has('전송됨 ({수}명)')).toBe(true); // tfAttr
    expect(USED_ALL.has('승인 요청은 {계정}으로 로그인한 기기에서만 보입니다. {로그인} 후 자동으로 이 화면으로 돌아옵니다.')).toBe(true); // <Tf k> 노드 자리표시자
    expect(USED_ALL.has('출근 완료')).toBe(true); // <T k={조건식}>
    expect(USED_ALL.has('환자 차트(모바일)')).toBe(true); // 타일 label:
    expect(USED_ALL.has('해결@상태')).toBe(true); // 큰따옴표 label:
    expect(USED_ALL.has('등록 ICU 병상 0')).toBe(true); // Ratio unavailableHint
    expect(USED_ALL.has('7일')).toBe(true); // 기간 탭 배열
    expect(USED_ALL.has('위임 사유(필수)')).toBe(true); // ReasonInput placeholder
    // 부서명 비교값은 표시 키가 아니다 — 추출기가 줍지 않는다
    for (const d of DEPT_DATA) expect(USED_ALL.has(d), `부서 비교값을 표시 키로 주웠다: ${d}`).toBe(false);
  });

  it('(a) 화면별 한글 잔여(ko)·식 옆 텍스트(koExpr)가 기준선과 **정확히** 일치한다(여유 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number; koExpr: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => {
      const r = rows.find((x) => x.file === f)!;
      return [f, { ko: r.ko, koExpr: r.koExpr }];
    }));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, { ko: BASELINE[f].ko, koExpr: BASELINE[f].koExpr }])));
  });

  it('(b) 화면마다 배선 수(t)가 기준선 이상이다 — /staff 10화면은 전부 0 보다 크다', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; t: number }>;
    for (const f of OWNED) {
      expect(rows.find((r) => r.file === f)!.t, `${f} 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].t);
    }
    for (const f of STAFF_FILES) expect(BASELINE[f].t, `${f} 하한이 0 이면 이 검사는 아무것도 보증하지 않는다`).toBeGreaterThan(0);
    // 위젯은 라벨을 부모 부품이 번역한다((b') 참조) — 파일 안 배선이 0 인 것이 정상인 위젯이 있다.
    //    다만 행 오른쪽 값(건·점)을 직접 그리는 위젯 5종은 0 이면 안 된다.
    for (const n of ['AdmissionTrendWidget', 'ChartTopDxWidget', 'EwsHighRiskWidget', 'IcuAlertsWidget', 'AppointmentsWidget']) {
      expect(BASELINE[`${EXT}/${n}.tsx`].t, `${n} 하한이 0`).toBeGreaterThan(0);
    }
  });

  it("🔴 (b') 위젯 라벨을 번역하는 부모 부품의 배선이 살아 있다 — 끊기면 위젯 21종 라벨이 한꺼번에 생한글이 된다", () => {
    const stats = stripComments(read(join(APP, '(main)/dashboard/components/widgets/ApiStatsWidget.tsx')));
    expect(stats, 'ApiStatsWidget 이 stat label 을 <T> 로 그리지 않는다').toMatch(/<T k=\{s\.label\} \/>/);
    const list = stripComments(read(join(APP, `${EXT}/RowListWidget.tsx`)));
    expect(list, 'RowListWidget 이 empty 를 <T> 로 그리지 않는다').toMatch(/<T k=\{empty\} \/>/);
    /**
     * 🔴 **리터럴이 아니라 규칙을 겨눈다**(2026-09-12). 종전엔 `<T k={title} />` 이라는 소스 문자열을
     *    찾았는데, 그러면 부품이 **더 정확해져도** 가드가 깨진다 — 서버 데이터에 거짓 `EN×` 를 달던 것을
     *    고치느라 `문자열=키 · 노드=그대로`(`asText`)로 바꾸자 이 검사가 먼저 실패했다.
     *    지켜야 할 사실은 "부품이 **문자열 prop 을 카탈로그 키로 조회한다**"이지 표기가 아니다.
     *    (동작 자체는 `empty-state-honesty.spec.tsx` 가 en 렌더로 검증한다 — 여기선 배선 존재만 본다.)
     */
    const display = stripComments(read(join(WEB, 'components/ui/display.tsx')));
    expect(display, 'EmptyState 가 문자열 prop 을 <T> 로 조회하지 않는다').toMatch(/typeof v === 'string' \? <T k=\{v\} \/>/);
    for (const prop of ['title', 'hint']) {
      expect(display, `EmptyState 가 ${prop} 을 그리는 경로가 asText 를 지나지 않는다`).toMatch(new RegExp(`asText\\(${prop}\\)`));
    }
    expect(display, 'Ratio 가 unavailableHint 를 <T> 로 조회하지 않는다').toMatch(/typeof unavailableHint === 'string' \? <T k=\{unavailableHint\} \/>/);
    const reason = stripComments(read(join(WEB, 'components/ui/ReasonInput.tsx')));
    expect(reason, 'ReasonInput 이 placeholder 를 tAttr 로 옮기지 않는다').toMatch(/placeholder \? tAttr\(placeholder\)/);
  });

  it('(c) 화면이 i18n 층에 넘기는 한국어 키가 카탈로그에 있다 — 없으면 화면에 EN× 거짓 티가 뜬다', () => {
    const missing: string[] = [];
    for (const { f, u } of USED) {
      for (const k of u.all) if (!ALL_KEYS.has(k) && !INTENTIONALLY_UNREGISTERED.includes(k)) missing.push(`${short(f)}: ${k}`);
    }
    // 🔴 동적 키 — /staff/dashboard 가 `<T k={APPOINTMENT_STATUS_LABEL[status]}>` 로 그리는 shared 정본 라벨
    for (const v of Object.values(APPOINTMENT_STATUS_LABEL)) if (!ALL_KEYS.has(v)) missing.push(`APPOINTMENT_STATUS_LABEL: ${v}`);
    expect(missing.sort(), `미등록 키(원문+티로 나간다):\n${missing.join('\n')}`).toEqual([]);
    expect(INTENTIONALLY_UNREGISTERED.filter((k) => USED_ALL.has(k) && !ALL_KEYS.has(k))).toEqual(INTENTIONALLY_UNREGISTERED);
  });

  it("🔴 (c') 자리표시자가 든 키를 <T>/tAttr 로 부르지 않는다 — 보간 없이 `{수}` 가 그대로 찍힌다", () => {
    const bad: string[] = [];
    for (const { f, u } of USED) for (const k of u.plain) if (paramsOf(k).length) bad.push(`${short(f)}: ${k}`);
    expect(bad, `<Tf>/tfAttr 로 옮겨야 하는 자리:\n${bad.join('\n')}`).toEqual([]);
  });

  it("🔴 (c'') 스스로 번역하는 부품에 번역 결과를 넘기지 않는다 — 이중 번역은 AI 초안 표기·미등록 티를 지운다", () => {
    const bad: string[] = [];
    for (const f of OWNED) {
      const src = stripComments(read(join(APP, f)));
      for (const m of src.matchAll(/\b(title|hint|unavailableHint|empty)=\{\s*(?:tt|tAttr|tfAttr)\(/g)) bad.push(`${short(f)}: ${m[1]}`);
    }
    expect(bad, `원문 키를 그대로 넘긴다(부품이 <T> 로 번역한다):\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔴 (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 staffdash 가 다시 정의하지 않는다', () => {
    const earlier = ORDER.slice(0, AT);
    const dead = [...CAT.get('staffdash.ts')!]
      .filter((k) => earlier.some((f) => CAT.get(f)!.has(k)))
      .map((k) => `${k} ← ${earlier.filter((f) => CAT.get(f)!.has(k)).join(',')}`)
      .sort();
    expect(dead, `죽은 키(앞 카탈로그가 이긴다 — 여기서 지운다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('🔴 (e) 고아 키 0 — staffdash 의 모든 키를 소유 화면이 i18n 층에 실제로 넘긴다', () => {
    const orphan = ROWS.map((r) => r.key).filter((k) => !USED_ALL.has(k)).sort();
    expect(orphan, `소유 화면이 부르지 않는 키:\n${orphan.join('\n')}`).toEqual([]);
    expect(ROWS.filter((r) => r.key.lastIndexOf('@') === 0).map((r) => r.key)).toEqual([]);
  });

  it('(f) 세 언어 키 집합이 같고 빈 값이 없으며, 🔴 번역문이 키와 같은 자리표시자를 갖는다', () => {
    const bad = ROWS.filter((r) => r.v.length !== 3 || r.v.some((x) => !x.trim())).map((r) => r.key);
    expect(bad, `en/ja/ar 중 빠지거나 빈 값:\n${bad.join('\n')}`).toEqual([]);
    const lost: string[] = [];
    for (const r of ROWS) {
      const want = paramsOf(r.key).join(',');
      r.v.forEach((x, i) => { if (paramsOf(x).join(',') !== want) lost.push(`${['en', 'ja', 'ar'][i]}: ${r.key} → ${x}`); });
    }
    expect(lost, `자리표시자가 어긋난 번역:\n${lost.join('\n')}`).toEqual([]);
    expect(ROWS.filter((r) => paramsOf(r.key).length).length, '보간 키 대조군이 0').toBeGreaterThan(15);
  });

  it('🔴 (g) staffdash 의 문맥 키가 추가 언어 팩에 문맥 결손을 만들지 않는다', () => {
    const files = packFiles();
    expect(files.length, '팩 등재부 파싱이 깨졌다').toBeGreaterThanOrEqual(6);
    const packKeys = new Map(files.map((f) => [f, keysOf(f, PACKS_DIR)]));
    const gaps: string[] = [];
    for (const { key } of ROWS) {
      const at = key.lastIndexOf('@');
      if (at <= 0) continue;
      const bare = key.slice(0, at);
      for (const [f, ks] of packKeys) if (ks.has(bare) && !ks.has(key)) gaps.push(`${f}: ${key}`);
    }
    expect(gaps, `팩 결손을 만드는 문맥 키:\n${gaps.join('\n')}`).toEqual([]);
    // 대조군 — 맨 `급여`(Covered)를 가진 팩이 실제로 있고(표본), 그 전부가 `급여@인사` 도 갖는다(2026-09-12 채움).
    //    판정기가 살아 있는지는 가짜 팩으로 확인한다 — 결손 하나를 넣으면 같은 식이 잡아야 한다.
    const withBare = [...packKeys.values()].filter((ks) => ks.has('급여'));
    expect(withBare.length, '맨 `급여` 를 가진 팩이 없다 — 표본이 사라졌다').toBeGreaterThanOrEqual(5);
    expect(withBare.every((ks) => ks.has('급여@인사'))).toBe(true);
    const fake = new Set(['급여']);
    expect([...packKeys.values(), fake].some((ks) => ks.has('급여') && !ks.has('급여@인사')), '판정기가 결손을 못 본다').toBe(true);
  });

  it('🔴 (h) 오역 회수 — 맨 키(앞 카탈로그의 다른 뜻)로 되돌아가지 않는다', () => {
    // 맨 키는 등재돼 있어서 (c) 가 못 잡는다 — 뜻이 다른 번역이 조용히 나간다(혈액 '예약' 이 'Appointment' 로).
    const at = (f: string) => USED.find((x) => x.f === f)!.u.plain;
    const cases: Array<[string, string, string]> = [
      [`${EXT}/BloodBankWidget.tsx`, '예약@병상', '예약'], // 맨 '예약' = Appointment
      [`${EXT}/InfectionWidget.tsx`, '해결@상태', '해결'], // 맨 '해결' = Resolve(동사)
      ['staff/page.tsx', '전송@버튼', '전송'], // 맨 '전송' = Sent(상태)
      ['staff/page.tsx', '호출@동작', '호출'], // 맨 '호출' = Called(상태)
      ['staff/page.tsx', '검사@직군', '검사'], // 역할 선택지 — 맨 '검사' = 검사(행위)
      ['staff/approvals/page.tsx', '거부@행위', '__없음__'],
      ['staff/approvals/HrApprovalSection.tsx', '승인@버튼', '__없음__'],
      ['staff/approvals/HrApprovalSection.tsx', '확정@정산버튼', '확정'], // 맨 '확정' = Confirmed(상태)
      ['staff/team/page.tsx', '해제@지정', '해제'],
      ['staff/dashboard/page.tsx', '급여@인사', '급여'], // 맨 '급여' = Covered(보험 급여)
    ];
    const bad: string[] = [];
    for (const [f, want, bare] of cases) {
      if (!at(f).has(want)) bad.push(`${short(f)}: ${want} 가 없다`);
      if (at(f).has(bare)) bad.push(`${short(f)}: 맨 키 ${bare} 로 배선됐다`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('전량 AI_DRAFT — 사람 검수(VERIFIED)를 코드가 임의로 선언하지 않는다', () => {
    expect(read(join(MSG, 'staffdash.ts'))).toMatch(/STAFFDASH_VERIFIED: ReadonlySet<string> = new Set\(\)/);
  });

  it('🔴 카탈로그 헤더가 "무엇을 왜 뺐는지"를 적었다 (제외 주장은 검증 가능해야 한다)', () => {
    const head = read(join(MSG, 'staffdash.ts'));
    const block = head.slice(0, head.indexOf('*/') + 2);
    expect(block).toMatch(/의도적\s*미등재/);
    expect(block, '중복 회피를 적지 않았다').toMatch(/중복이라 등재하지 않았다/);
    expect(block, '사람 검수 대상을 열거하지 않았다').toMatch(/사람 검수 대상/);
    for (const k of INTENTIONALLY_UNREGISTERED) expect(block, `${k} 의 미등재 사유가 헤더에 없다`).toContain(k);
    expect(block, '통화 접미 원 을 왜 두는지 적지 않았다').toContain('통화');
    expect(block, '병원명 하드코딩을 왜 두는지 적지 않았다').toContain('위루비병원 내부포털');
  });
});
