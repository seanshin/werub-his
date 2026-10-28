import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, stripComments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 진료과 보드 18화면의 UI 언어 배선 가드 (2026-09-11 §12 잔여 · 카탈로그 `clinical5`).
 *    응급(베드보드·ER 보드·골든타임) · 호스피스 · 분만장 · 투석 · 방사선종양 · 재활 · 이식 ·
 *    만성질환 · 감염관리 3 · 직원 노출 2 · 영상 2 · 임상도구 · 퇴원요약.
 *
 * 이 화면들은 스캐너 기준 `<T>`/`tAttr` 배선이 **0** 이었다(12화면) 또는 카탈로그가 비어 있었다(6화면) —
 * 어떤 언어를 골라도 KTAS 등급·격리 종류·노출 사고 3상·모아 식별밴드 경고가 전부 한국어였다.
 *
 * 이 가드가 못박는 것은 **반증 가능한 것만**이다:
 *   (a)  화면별 한글 잔여 조각 수(스캐너 `ko`) — **정확 일치**(여유 0).
 *   (a') 화면별 식 옆 JSX 텍스트 조각 수(스캐너 `koExpr`) — **정확 일치**. `{n}건 중 {m}건` 류 문장 뼈대는
 *        `ko` 가 세지 않는다 — 보간 키를 생한글 조각으로 되돌리면 여기서 걸린다.
 *   (b)  화면별 `<T>`/`tAttr`(스캐너 `t`) · `<Tf>`/`tfAttr` 보간 배선 수 — 하한(전 화면 > 0).
 *   (c)  화면이 i18n 층에 넘기는 한국어 키가 **어느 카탈로그엔가 있다**(없으면 `EN×` 거짓 티).
 *        정적 키 · 동적 키의 원천 리터럴(`<T k={조건 ? '…' : '…'}>`) · 라벨 맵 값(숫자 키 포함) ·
 *        모듈 로컬 라벨 정본(`infection-labels`·`staff-exposure-labels`) · shared 상수(`KTAS_LEVEL_LABEL`)를 함께 본다.
 *   (c') 🔴 자리표시자(`{이름}`)가 든 키를 `<T>`/`tAttr` 로 부르지 않는다 — 보간 없이 `{수}` 가 그대로 찍힌다.
 *   (c'') 🔴 스스로 번역하는 부품(`EmptyState`·`Ratio`·`StatusBadge`)에는 **생 키**를 넘긴다 —
 *        밖에서 `tAttr` 로 감싸면 이중 처리가 되고 미등록 티를 그릴 방법이 사라진다.
 *   (d)  🔴 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 clinical5 가 다시 정의하지 않는다.
 *   (e)  🔴 고아 키 0 — clinical5 의 모든 키를 소유 화면(또는 그 화면이 쓰는 라벨 정본)이 실제로 넘긴다.
 *   (f)  세 언어 키 집합 동일 · 빈 값 0 · 🔴 번역문이 키와 같은 자리표시자를 갖는다.
 *   (g)  🔴 clinical5 의 문맥 키가 추가 언어 팩에 문맥 결손을 만들지 않는다.
 *   (h)  🔴 저장값·전송값은 번역하지 않는다 — option `value`·감사 원장 필드명·AI 프롬프트.
 *   (i)  🧑 **임상 검수 목록이 썩지 않는다** — 카탈로그 헤더가 가리키는 `CLINICAL5_CLINICAL_REVIEW` 의
 *        모든 키가 카탈로그에 실재한다(목록만 남고 키가 사라지면 "검수 대상"이 조용히 증발한다).
 *   (j)  🔴 **베드사이드 디스플레이는 배선하지 않는다** — 기기 단위 화면인데 `useUiLocale` 은 사용자 단위
 *        선호다. 배선하면 태블릿을 켠 직원의 언어가 침상 곁 환자가 보는 화면을 바꾼다. 같은 축의 공개
 *        전광판(`app/display/**`)도 전부 미배선이라 한 화면만 열면 정본이 둘이 된다(사유는 카탈로그 헤더 ⑥).
 *        누군가 배선하면 이 검사가 실패해 **결정을 다시 지나가게** 한다.
 *
 * 🔴 **정본에서 파생한다** — 카탈로그 목록·등록 순서는 `registry.ts` 를, 파서는 스캐너의 `catalogKeysOf` 를 쓴다.
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf8');

/** 이 갈래가 소유한 화면 */
const OWNED = [
  '(main)/emergency/components/BedBoard.tsx',
  '(main)/emergency-board/page.tsx',
  '(main)/emergency-board/GoldenPathwayPanel.tsx',
  '(main)/hospice/page.tsx',
  '(main)/obgyn/DeliveryBoard.tsx',
  '(main)/dialysis/page.tsx',
  '(main)/radiation/page.tsx',
  '(main)/rehab/page.tsx',
  '(main)/transplant/page.tsx',
  '(main)/chronic/page.tsx',
  '(main)/infection/page.tsx',
  '(main)/infection/InfectionRegistry.tsx',
  '(main)/infection/ContactCandidatesPanel.tsx', // 2026-09-28 P5 위치 겹침 접촉자 후보
  '(main)/infection/staff-exposure/page.tsx',
  '(main)/infection/staff-exposure/ReportForm.tsx',
  '(main)/imaging/components/ReportsTab.tsx',
  '(main)/imaging/components/StudiesTab.tsx',
  '(main)/clinical-tools/page.tsx',
  '(main)/inpatient/[admissionId]/discharge-summary/page.tsx',
  '(main)/pharmacist-replies/page.tsx', // 2026-09-30 약사 ↔ 의사 루프 — 의사 회신 워크리스트
] as const;

/**
 * 🔴 소유 화면은 아니지만 clinical5 키를 넘기는 곳(2026-09-30 약사 ↔ 의사 루프) — 고아 키 판정(e)에만 쓴다.
 *    `pharmacist-activity` 는 quality2 갈래가 소유(기준선도 그쪽)하고, DUR 무시 기록 부품은 두 화면이 함께 쓴다.
 *    여기 두지 않으면 그 화면들이 실제로 부르는 키가 "고아"로 잡힌다(부르는 곳을 못 보는 가드).
 */
const CONSUMERS = [
  '(main)/pharmacist-activity/page.tsx',
  '../components/pharmacy/DurOverrideList.tsx',
  '../components/pharmacy/SubstitutionDecision.tsx', // 2026-09-30 대체조제 판정 부품(의사 회신·약제 관리 두 화면) — 판정 토스트 키를 넘긴다
  // 2026-10-10 전문진료 2차 — 소유 화면에서 쪼갠 부품(page.tsx 는 다른 export 를 둘 수 없다)·환자 차트 탭
  '(main)/hospice/AdvanceDirectiveCard.tsx',
  // 2026-10-10 전문진료 3차 — 간호 메뉴의 분만 현황·격리 감시(같은 부품을 간호사에게) · 격리 부품의 역할 고지
  '(main)/nurse-station/delivery-board/page.tsx',
  '(main)/nurse-station/seclusion/page.tsx',
  '(main)/psychiatry/SeclusionRestraintSection.tsx',
  '(main)/radiation/radiation-dose.tsx',
  '(main)/transplant/transplant-tdm.tsx',
  '(main)/patients/[id]/components/RadiationTab.tsx',
  // 2026-10-10 흐름 추적 — 방사선 계획 진행·호스피스 종결 부품
  '(main)/radiation/radiation-plan-actions.tsx',
  '(main)/hospice/HospiceEndForm.tsx',
  '(main)/hospice/AdvanceDirectiveForm.tsx',
] as const;

/** 🔴 의도적 **미배선** — 기기 단위 화면(사유는 clinical5.ts 헤더 ⑥) */
const UNWIRED_BY_DECISION = '(main)/emergency/bed-display/[bedId]/page.tsx';

/**
 * 동적 키(`<T k={맵[x]}>`·`<T k={fn()}>`)의 원천 리터럴이 사는 **모듈 로컬 라벨 정본**.
 * 화면 소스만 읽으면 이 값들이 어디에도 없어 (c)·(e) 가 헛돈다.
 */
const KEY_SOURCES = [
  '(main)/infection/infection-labels.ts',
  '(main)/infection/staff-exposure/staff-exposure-labels.ts',
  '(main)/radiation/radiation-toxicity.ts', // 2026-10-07 부작용 항목 라벨(화면이 <T k={item.label}> 로 그린다)
] as const;
/** 소유 화면이 i18n 층에 그대로 넘기는 shared 상수(라벨 정본은 shared 하나) */
const SHARED_KEY_MAPS = ['KTAS_LEVEL_LABEL', 'EMERGENCY_VISIT_STATUS_LABEL'] as const;

/**
 * 2026-09-11 배선 후 실측 (재현: `node scripts/i18n-unwired-scan.mjs --json` → rows[].ko / koExpr / t).
 * 배선 전: 12화면이 `t=0` · 18화면 ko 합 429 · koExpr 합 30.
 * `ko` 에 남은 것(사유는 `packages/shared/src/i18n/messages/clinical5.ts` 머리 주석):
 *   · 라벨 맵 값(`STATUS_LABEL`·`ORGAN_LABEL`·`COND_LABEL`·`SESSION_STATUS`·`PPS_LABELS` …) — `<T k={맵[x]}>` 로 그린다
 *   · 스스로 번역하는 부품에 넘기는 생 키(`EmptyState title`·`Ratio unavailableHint`·`DraftBanner signLabel`)
 *   · `<Unit>건</Unit>` 같은 단위 children — `Unit` 이 스스로 조회한다(밖에서 감싸면 이중 처리)
 *   · 저장·전송값(감사 원장 필드명 `입원경과`·서명 메타 `퇴원요약 서명`·AI 프롬프트 본문)
 * `t` = `<T`·`<Tf` + `t(f)Attr(` 출현 수(스캐너) · `tf` = `<Tf` + `tfAttr(` 출현 수.
 * 🔴 여유 0 — 늘면 실패, 줄면 이 표를 내린다.
 */
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
const BASELINE: Record<string, { ko: number; koExpr: number; t: number; tf: number }> = {
  '(main)/emergency/components/BedBoard.tsx': { ko: 22, koExpr: 0, t: 69, tf: 16 },
  '(main)/emergency-board/page.tsx': { ko: 18, koExpr: 0, t: 46, tf: 11 },
  '(main)/emergency-board/GoldenPathwayPanel.tsx': { ko: 6, koExpr: 0, t: 16, tf: 4 },
  '(main)/hospice/page.tsx': { ko: 24, koExpr: 0, t: 57, tf: 2 },
  '(main)/obgyn/DeliveryBoard.tsx': { ko: 22, koExpr: 0, t: 43, tf: 4 },
  '(main)/dialysis/page.tsx': { ko: 20, koExpr: 0, t: 48, tf: 0 },
  '(main)/radiation/page.tsx': { ko: 3, // 2026-10-07 부작용 항목 라벨을 radiation-toxicity.ts(KEY_SOURCES)로 옮겨 −5
    koExpr: 0, t: 54, tf: 4 },
  '(main)/rehab/page.tsx': { ko: 13, koExpr: 0, t: 40, tf: 0 },
  '(main)/transplant/page.tsx': { ko: 10, koExpr: 0, t: 41, tf: 0 },
  '(main)/chronic/page.tsx': { ko: 11, koExpr: 0, t: 32, tf: 4 },
  '(main)/infection/page.tsx': { ko: 12, koExpr: 0, t: 40, tf: 4 },
  '(main)/infection/InfectionRegistry.tsx': { ko: 8, koExpr: 0, t: 24, tf: 6 },
  // 2026-09-28 ko 15: 접촉자 등록 폼 선택지 라벨 12(`tAttr(o.l)` 로 넘김·카탈로그 등재) + 저장 메모 문자열(기록 데이터 — 번역 대상 아님)
  '(main)/infection/ContactCandidatesPanel.tsx': { ko: 15, koExpr: 0, t: 21, tf: 2 },
  '(main)/infection/staff-exposure/page.tsx': { ko: 1, koExpr: 0, t: 40, tf: 6 },
  '(main)/infection/staff-exposure/ReportForm.tsx': { ko: 0, koExpr: 0, t: 33, tf: 3 },
  '(main)/imaging/components/ReportsTab.tsx': { ko: 5, koExpr: 0, t: 29, tf: 2 },
  '(main)/imaging/components/StudiesTab.tsx': { ko: 1, koExpr: 0, t: 17, tf: 6 },
  '(main)/clinical-tools/page.tsx': { ko: 3, koExpr: 0, t: 16, tf: 2 },
  '(main)/inpatient/[admissionId]/discharge-summary/page.tsx': { ko: 7, koExpr: 0, t: 36, tf: 6 },
  // 2026-09-30 ko 5: 회신 선택지 라벨 맵 3(`<T k={REPLY_LABEL[k]}>`)·EmptyState title 생 키 2(부품이 스스로 번역)
  // 2026-09-30 ko 5→3·t 32→29 — 승인·거부 버튼·토스트가 공용 판정 부품(SubstitutionDecision · CONSUMERS)으로 옮겨 갔다(배선 소실 아님)
  '(main)/pharmacist-replies/page.tsx': { ko: 3, koExpr: 0, t: 29, tf: 1 },
};

/* ── 카탈로그 파싱 (정본 = registry.ts 의 등록 순서) ────────────────────────── */

/** registry.ts 가 `registerCatalog` 로 등록하는 순서 — `t()` 의 우선순위 정본 */
function registeredOrder(): string[] {
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`);
  // 🔴 common 은 t.ts 가 직접 등록한다(registry 에 registerCatalog 호출이 없다) — 맨 앞이다
  return [...new Set(['common.ts', ...files])];
}

/** 파서 정본은 스캐너(`catalogKeysOf` — 네 표기) — 가드마다 두면 표기 하나를 빠뜨려 갈라진다 */
const keysOf = (file: string, dir = MSG) => catalogKeysOf(read(join(dir, file))) as Set<string>;

/** 추가 언어 팩(zh·ru·vi·kk·mn·th) — 등재부 `packs/index.ts` 에서 파생(수기 목록 금지) */
const PACKS_DIR = join(ROOT, 'packages/shared/src/i18n/packs');
function packFiles(): string[] {
  const idx = read(join(PACKS_DIR, 'index.ts'));
  return [...new Set([...idx.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`))];
}

/** clinical5 의 [en, ja, ar] 튜플 — 세 언어 대조용 */
function clinical5Rows(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'clinical5.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('export const CLINICAL5_CLINICAL_REVIEW'));
  return [...body.matchAll(/^\s*'((?:\\.|[^'\\])+)':\s*\[([\s\S]*?)\],$/gm)].map((m) => ({
    key: m[1].replace(/\\'/g, "'"),
    v: [...m[2].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((x) => x[1].replace(/\\'/g, "'")),
  }));
}

/** 🧑 임상 검수 목록 — 카탈로그가 스스로 선언한다(가드가 베껴 적으면 갈라진다) */
function clinicalReviewKeys(): string[] {
  const src = read(join(MSG, 'clinical5.ts'));
  const at = src.indexOf('export const CLINICAL5_CLINICAL_REVIEW');
  const body = src.slice(at, src.indexOf('];', at));
  return [...body.matchAll(/^\s*'((?:\\.|[^'\\])+)',$/gm)].map((m) => m[1].replace(/\\'/g, "'"));
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

/**
 * plain  = `<T k>`·`tAttr(` 로 부르는 키(자리표시자가 있으면 안 된다)
 * interp = `<Tf k>`·`tfAttr(` 로 부르는 키
 * label  = 라벨 맵 값·부품 prop 원문 — 존재·고아 검사에만 쓴다
 */
interface Used { plain: Set<string>; interp: Set<string>; label: Set<string>; all: Set<string> }
function usedKeys(file: string): Used {
  const src = stripComments(read(join(APP, file)));
  const plain = new Set<string>();
  const interp = new Set<string>();
  const label = new Set<string>();
  const attrs = String.raw`(?:className=(?:"[^"]*"|\{[^{}]*\})\s+)?`;
  for (const m of src.matchAll(new RegExp(String.raw`<T\s+${attrs}k="((?:\\.|[^"\\])+)"`, 'g'))) plain.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`<Tf\s+${attrs}[\s\S]{0,4}?k="((?:\\.|[^"\\])+)"`, 'g'))) interp.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`<T\s+${attrs}k=\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}`, 'g'))) for (const l of literals(m[1])) plain.add(l);
  for (const b of callBodies(src, 'tAttr')) for (const l of literals(b)) plain.add(l);
  for (const b of callBodies(src, 'tfAttr')) { const l = literals(b)[0]; if (l) interp.add(l); }
  // 라벨 맵·목록 리터럴(`ACTIVE: '활성'`·`label: '소생'`) — 소유 화면에서 한글 값을 가진 `이름: '…'` 은 전부 i18n 키다(실측)
  for (const m of src.matchAll(/\b[A-Za-z_]+:\s*'((?:\\.|[^'\\\n])*)'/g)) label.add(m[1].replace(/\\'/g, "'"));
  // 🔴 숫자 키 라벨 맵(`100: '정상'` — PPS 등급). 식별자 키 규칙만 두면 이 11키가 검사에서 통째로 빠진다
  for (const m of src.matchAll(/(?:^|[{,]\s*)\d+:\s*'((?:\\.|[^'\\\n])*)'/gm)) label.add(m[1].replace(/\\'/g, "'"));
  // 부품 prop — EmptyState 의 title·hint, Ratio 의 unavailableHint 등
  for (const m of src.matchAll(/\b(?:title|hint|subtitle|emptyHint|unavailableHint|label)="([^"]*)"/g)) label.add(m[1]);
  /**
   * 🔴 **중괄호 한 겹을 넘는다.** 종전 `[^{}]*?` 는 값 안에 중첩 중괄호가 생기면 통째로 놓쳤다 —
   *    서버 사유를 `<Data>{x}</Data>` 로 감싸자(2026-09-12 거짓 `EN×` 회수) `관측 0건` 폴백 키가
   *    추출에서 사라져 "고아 키"로 잡혔다. `<T k={…}>` 규칙(위)과 같은 깊이를 허용한다.
   */
  for (const m of src.matchAll(/\b(?:unavailableHint|title|hint)=\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) for (const l of literals(m[1])) label.add(l);
  const keep = (s: Set<string>) => new Set([...s].filter((k) => HAN.test(k)));
  const p = keep(plain);
  const i = keep(interp);
  const l = keep(label);
  return { plain: p, interp: i, label: l, all: new Set([...p, ...i, ...l]) };
}

/** 모듈 로컬 라벨 정본(.ts)의 한글 리터럴 — 화면이 `<T k={fn()}>` 로 넘기는 값의 원천 */
function sourceKeys(file: string): Set<string> {
  const src = stripComments(read(join(APP, file)));
  return new Set(literals(src).filter((l) => HAN.test(l)));
}

/** shared 상수 맵의 한글 값 — 화면이 그대로 i18n 층에 넘긴다 */
function sharedMapKeys(): Set<string> {
  const src = read(join(ROOT, 'packages/shared/src/constants.ts'));
  const out = new Set<string>();
  for (const name of SHARED_KEY_MAPS) {
    const at = src.indexOf(`export const ${name}`);
    if (at < 0) continue;
    for (const l of literals(src.slice(at, src.indexOf('};', at)))) if (HAN.test(l)) out.add(l);
  }
  return out;
}

const tfCount = (file: string) => {
  const noc = stripComments(read(join(APP, file)));
  return (noc.match(/<Tf[\s>]/g) || []).length + (noc.match(/\btfAttr\(/g) || []).length;
};

const ORDER = registeredOrder();
const AT = ORDER.indexOf('clinical5.ts');
const CAT = new Map(ORDER.map((f) => [f, keysOf(f)]));
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of CAT.get(f)!) ALL_KEYS.add(k);
const ROWS = clinical5Rows();
const USED = OWNED.map((f) => ({ f, u: usedKeys(f) }));
const USED_ALL = new Set<string>();
for (const { u } of USED) for (const k of u.all) USED_ALL.add(k);
const CONSUMER_KEYS = new Set<string>();
for (const f of CONSUMERS) for (const k of usedKeys(f).all) CONSUMER_KEYS.add(k);
const SRC_KEYS = new Set<string>();
for (const f of KEY_SOURCES) for (const k of sourceKeys(f)) SRC_KEYS.add(k);
for (const k of sharedMapKeys()) SRC_KEYS.add(k);
/** 화면이 넘길 수 있는 키 전체 = 화면 리터럴 ∪ 그 화면이 쓰는 라벨 정본 */
const REACHABLE = new Set<string>([...USED_ALL, ...SRC_KEYS, ...CONSUMER_KEYS]);
const short = (f: string) => f.split('/').slice(1).join('/');

describe('🔴 진료과 보드 18화면 i18n 배선 (clinical5)', () => {
  it('대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string }>;
    expect(rows.length).toBeGreaterThan(500);
    for (const f of [...OWNED, UNWIRED_BY_DECISION]) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    expect(AT, 'registry 에서 clinical5 를 찾지 못했다').toBeGreaterThan(0);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(30);
    expect(ROWS.length, 'clinical5 표 파싱이 깨졌다').toBeGreaterThan(400);
    expect(ROWS.length, '표 행 수와 키 수가 다르다(파서가 행을 흘렸다)').toBe(CAT.get('clinical5.ts')!.size);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(5000);
    expect(USED_ALL.size, '화면 키 추출이 깨졌다').toBeGreaterThan(500);
    expect(SRC_KEYS.size, '라벨 정본 키 추출이 깨졌다').toBeGreaterThan(30);
    // 추출기 대조군 — 경로마다 실제로 잡는다
    expect(USED_ALL.has('활성 프로토콜 없음')).toBe(true); // <T k="…">
    expect(USED_ALL.has('{시간} 남음')).toBe(true); // <Tf k>
    expect(USED_ALL.has('KTAS {등급} 환자를 {구역} 구역에 배정합니다.\\n소생·중증 구역이 아닙니다 — 계속할까요?')).toBe(true); // tfAttr(confirm)
    expect(USED_ALL.has('신생아')).toBe(true); // <T k={조건식}>
    expect(USED_ALL.has('재태주수 예 39+2')).toBe(true); // tAttr(placeholder)
    expect(USED_ALL.has('이상지질')).toBe(true); // 라벨 맵 값
    expect(USED_ALL.has('완전 돌봄')).toBe(true); // 🔴 숫자 키 라벨 맵(PPS)
    expect(USED_ALL.has('관측 0건')).toBe(true); // Ratio unavailableHint
    expect(USED_ALL.has('대상 환자가 없습니다.')).toBe(true); // EmptyState title prop
    expect(SRC_KEYS.has('접촉격리')).toBe(true); // 모듈 로컬 라벨 정본(infection-labels)
    expect(SRC_KEYS.has('주사침 자상')).toBe(true); // 모듈 로컬 라벨 정본(staff-exposure-labels)
    expect(SRC_KEYS.has('1 소생')).toBe(true); // shared 상수(KTAS_LEVEL_LABEL)
    // 소비처 추출 대조군 — 소유 밖 화면·부품에서도 실제로 잡는다
    expect(CONSUMER_KEYS.has('DUR 무시 기록')).toBe(true); // 탭 라벨(pharmacist-activity)
    expect(CONSUMER_KEYS.has('최근 {일}일 DUR 경고 무시 기록이 없습니다')).toBe(true); // <Tf k> (DurOverrideList)
  });

  it('(a) 화면별 한글 잔여(스캐너 `ko`)가 기준선과 **정확히** 일치한다(여유 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.ko]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].ko])));
  });

  it("🔴 (a') 식 옆 JSX 텍스트(스캐너 `koExpr`)도 **정확히** 일치한다 — 보간 키를 생한글 조각으로 되돌리면 여기서 걸린다", () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; koExpr: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.koExpr]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].koExpr])));
  });

  it('(b) 화면마다 <T>/tAttr 배선과 <Tf>/tfAttr 보간 배선이 기준선 이상이다(전 화면 배선 > 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; t: number }>;
    for (const f of OWNED) {
      const t = rows.find((r) => r.file === f)!.t;
      expect(t, `${f} 배선이 0 이다(원래 상태로 되돌아갔다)`).toBeGreaterThan(0);
      expect(t, `${f} <T>/tAttr 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].t);
      expect(tfCount(f), `${f} 보간 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].tf);
    }
    // 하한이 0 이면 이 검사는 아무것도 보증하지 않는다
    expect(OWNED.filter((f) => BASELINE[f].tf > 0).length, '보간 배선 하한이 전부 0').toBeGreaterThanOrEqual(10);
  });

  it('(c) 화면이 i18n 층에 넘기는 한국어 키가 카탈로그에 있다 — 없으면 화면에 EN× 거짓 티가 뜬다', () => {
    const missing: string[] = [];
    for (const { f, u } of USED) for (const k of u.all) if (!ALL_KEYS.has(k)) missing.push(`${short(f)}: ${k}`);
    // 🔴 동적 키의 원천(라벨 정본·shared 상수)도 같은 검사를 받는다 — 화면 소스에는 리터럴이 없다
    for (const k of SRC_KEYS) if (!ALL_KEYS.has(k)) missing.push(`라벨 정본: ${k}`);
    expect(missing.sort(), `미등록 키(원문+티로 나간다):\n${missing.join('\n')}`).toEqual([]);
  });

  it("🔴 (c') 자리표시자가 든 키를 <T>/tAttr 로 부르지 않는다(보간 없이 {수} 가 그대로 찍힌다)", () => {
    const bad: string[] = [];
    for (const { f, u } of USED) for (const k of u.plain) if (paramsOf(k).length) bad.push(`${short(f)}: ${k}`);
    expect(bad, `<Tf>/tfAttr 로 옮겨야 하는 자리:\n${bad.join('\n')}`).toEqual([]);
    // 대조군 — 보간 키가 실제로 여럿 있다(0 이면 이 검사가 아무것도 보지 않는다)
    const interpAll = new Set<string>();
    for (const { u } of USED) for (const k of u.interp) interpAll.add(k);
    expect(interpAll.size, '보간 키 대조군이 0').toBeGreaterThan(50);
  });

  it("🔴 (c'') 스스로 번역하는 부품에는 **생 키**를 넘긴다 — 밖에서 감싸면 이중 처리가 된다", () => {
    const bad: string[] = [];
    for (const f of OWNED) {
      const src = stripComments(read(join(APP, f)));
      // EmptyState title/hint · Ratio unavailableHint · StatusBadge config · Unit children
      if (/<EmptyState[^>]*\b(?:title|hint)=\{\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: EmptyState 에 tAttr`);
      if (/unavailableHint=\{\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: Ratio unavailableHint 에 tAttr`);
      if (/<StatusBadge[^>]*config=\{\{[\s\S]{0,200}?t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: StatusBadge config 에 tAttr`);
      if (/<Unit>\{\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: Unit children 에 tAttr`);
    }
    expect(bad, `부품이 스스로 번역한다 — 생 키를 넘긴다:\n${bad.join('\n')}`).toEqual([]);
    // 대조군 — 그 부품들이 실제로 이 화면들에 쓰인다(0 이면 검사 대상이 없다)
    const srcs = OWNED.map((f) => stripComments(read(join(APP, f)))).join('\n');
    expect(/<EmptyState/.test(srcs), 'EmptyState 대조군 없음').toBe(true);
    expect(/unavailableHint=/.test(srcs), 'Ratio 대조군 없음').toBe(true);
    expect(/<StatusBadge/.test(srcs), 'StatusBadge 대조군 없음').toBe(true);
  });

  it('🔴 (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 clinical5 가 다시 정의하지 않는다', () => {
    const earlier = ORDER.slice(0, AT);
    const dead = [...CAT.get('clinical5.ts')!]
      .filter((k) => earlier.some((f) => CAT.get(f)!.has(k)))
      .map((k) => `${k} ← ${earlier.filter((f) => CAT.get(f)!.has(k)).join(',')}`)
      .sort();
    expect(dead, `죽은 키(앞 카탈로그가 이긴다 — 여기서 지운다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('🔴 (e) 고아 키 0 — clinical5 의 모든 키를 소유 화면(또는 그 화면의 라벨 정본)이 실제로 넘긴다', () => {
    const orphan = ROWS.map((r) => r.key).filter((k) => !REACHABLE.has(k)).sort();
    expect(orphan, `소유 화면이 부르지 않는 키:\n${orphan.join('\n')}`).toEqual([]);
    // `@` 로 시작하는 키는 표시 원문이 빈 문자열이 된다 — 어떤 검사든 빠져나가는 형태라 따로 막는다
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
    expect(lost, `자리표시자가 어긋난 번역(값이 사라지거나 {이름} 이 그대로 찍힌다):\n${lost.join('\n')}`).toEqual([]);
    expect(ROWS.filter((r) => paramsOf(r.key).length).length, '보간 키 대조군이 0').toBeGreaterThan(50);
  });

  it('🔴 (g) clinical5 의 문맥 키가 추가 언어 팩에 문맥 결손을 만들지 않는다(팩은 이 갈래 소유가 아니다)', () => {
    const files = packFiles();
    expect(files.length, '팩 등재부 파싱이 깨졌다').toBeGreaterThanOrEqual(6);
    const packKeys = new Map(files.map((f) => [f, keysOf(f, PACKS_DIR)]));
    for (const [f, ks] of packKeys) expect(ks.size, `${f} 키 파싱이 깨졌다`).toBeGreaterThan(300);
    const gaps: string[] = [];
    let contextKeys = 0;
    for (const { key } of ROWS) {
      const at = key.lastIndexOf('@');
      if (at <= 0) continue;
      contextKeys++;
      const bare = key.slice(0, at);
      for (const [f, ks] of packKeys) if (ks.has(bare) && !ks.has(key)) gaps.push(`${f}: ${key}`);
    }
    expect(gaps, `팩 결손을 만드는 문맥 키(팩과 함께 하거나 문맥 키를 쓰지 않는다):\n${gaps.join('\n')}`).toEqual([]);
    expect(contextKeys, '문맥 키 대조군(`가정@호스피스`)이 0').toBeGreaterThanOrEqual(1);
    // 대조군 — 결손 판정기가 살아 있다: 이미 알려진 결손(`판정@검사`)을 이 판정기도 본다
    expect([...packKeys.values()].some((ks) => ks.has('판정') && !ks.has('판정@검사'))).toBe(true);
  });

  it('🔴 (h) 저장값·전송값은 번역하지 않는다 — option value·감사 원장 필드명·AI 프롬프트', () => {
    const bad: string[] = [];
    for (const f of OWNED) {
      const src = stripComments(read(join(APP, f)));
      if (/\bvalue=\{\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: value={tAttr(…)}`);
      if (/\bvalue:\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: value: tAttr(…)`);
      if (/\bfields:\s*\[\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: 감사 원장 필드명을 번역한다`);
      if (/documentTitle=\{\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: 서명 메타데이터를 번역한다`);
    }
    expect(bad).toEqual([]);
    // 대조군 — 라벨은 번역하고 value 는 그대로 넘기는 형태가 실제로 있다(사라지면 검사 대상이 없다)
    const obgyn = stripComments(read(join(APP, '(main)/obgyn/DeliveryBoard.tsx')));
    expect(obgyn).toMatch(/<option value="M">\{tAttr\('남'\)\}<\/option>/);
    const ds = stripComments(read(join(APP, '(main)/inpatient/[admissionId]/discharge-summary/page.tsx')));
    expect(ds, '감사 원장 필드명이 생문자열로 남아 있어야 한다').toMatch(/fields: \['입원경과'\]/);
  });

  it('🧑 (i) 임상 검수 목록이 썩지 않는다 — 헤더가 가리키는 키가 전부 카탈로그에 실재한다', () => {
    const review = clinicalReviewKeys();
    expect(review.length, '임상 검수 목록 파싱이 깨졌다').toBeGreaterThan(50);
    const cat = CAT.get('clinical5.ts')!;
    const gone = review.filter((k) => !cat.has(k)).sort();
    expect(gone, `목록에만 있고 카탈로그에 없는 키(검수 대상이 조용히 증발했다):\n${gone.join('\n')}`).toEqual([]);
    // 목록이 실제 위험 어휘를 담는가 — 몇 개는 이름을 대고 못박는다(목록을 통째로 비우면 여기서 걸린다)
    for (const k of ['1 소생', '접촉격리', '수술부위감염', '주사침 자상',
      '원환자 양성 — 노출 후 예방요법(PEP) 대상 여부를 즉시 판단하십시오',
      '모아 식별밴드 불일치 — 수유·투약 전 재확인', '실제 조사선량 (Gy)']) {
      expect(review, `임상 검수 목록에서 빠졌다: ${k}`).toContain(k);
    }
    // 🔴 검수했다고 코드가 선언하지 않는다(검수는 커밋으로 남는 사람 행위)
    expect(read(join(MSG, 'clinical5.ts'))).toMatch(/CLINICAL5_VERIFIED: ReadonlySet<string> = new Set\(\)/);
  });

  it('🔴 (j) 베드사이드 디스플레이는 배선하지 않는다 — 기기 단위 화면을 사용자 단위 언어로 바꾸지 않는다', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; t: number; ko: number }>;
    const r = rows.find((x) => x.file === UNWIRED_BY_DECISION)!;
    expect(r.t, '베드사이드 디스플레이가 배선됐다 — 카탈로그 헤더 ⑥의 결정을 다시 지나가라').toBe(0);
    // 대조군 — 이 화면에 번역 대상 한국어가 실제로 남아 있다(0 이면 "미배선"이 아무 뜻이 없다)
    expect(r.ko, '이 화면에 한국어가 없다 — 미배선 판정이 무의미해졌다').toBeGreaterThan(10);
    // 같은 축의 공개 전광판도 전부 미배선이다(한 화면만 열면 정본이 둘이 된다)
    const boards = rows.filter((x) => x.file.startsWith('display/'));
    expect(boards.length, '공개 전광판 스캔이 깨졌다').toBeGreaterThanOrEqual(8);
    expect(boards.filter((x) => x.t > 0).map((x) => x.file), '전광판 축이 열렸다면 베드사이드 결정도 함께 다시 본다').toEqual([]);
  });

  it('🔴 카탈로그 헤더가 "무엇을 왜 뺐는지"를 적었다 (제외 주장은 검증 가능해야 한다)', () => {
    const head = read(join(MSG, 'clinical5.ts'));
    const block = head.slice(0, head.indexOf('*/') + 2);
    expect(block, '의도적 미등재를 적지 않았다').toMatch(/의도적\s*미등재/);
    expect(block, '서버 조립 문장 제외 사유를 적지 않았다').toMatch(/서버가 조립한 문장은 등재하지 않았다/);
    expect(block, '저장값 제외 사유를 적지 않았다').toMatch(/저장값·전송값이라 등재하지 않았다/);
    expect(block, '임상 검수 대상을 밝히지 않았다').toMatch(/임상 검수 필요/);
    // 🔴 미배선 결정(베드사이드·투석기 상태)은 이름을 대고 남긴다 — 잊히면 누군가 "번역 누락"으로 채운다
    expect(block).toContain('bed-display');
    expect(block).toContain('durationText');
    expect(block).toContain('AI_ORIGIN_TEXT');
  });
});
