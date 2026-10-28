import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import {
  scanScreens,
  stripComments,
  stripI18nKeys,
  koFragments,
  koExprFragments,
  catalogKeysOf,
} from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 운영·분석 화면 16 + 공용 CMS 편집기 1 의 UI 언어 배선 가드 (2026-09-12 §12 잔여 · 카탈로그 `ops12`).
 *    facility-info · interoperability(+/test) · simulator · mapping-review · flow-analytics ·
 *    pacs-portal · ai-booking · concierge · journey · metaverse · notifications · his-health-info ·
 *    custom/[slug] · patient-flow · safety-quality-board · components/admin/CategoryCmsPage
 *
 * 🔴 이 갈래에서 실제로 겪은 것에서만 규칙을 만들었다:
 *    **키는 `<T k="원문">` 만이 아니다.** 표에 담아 `<T k={변수}>` 로 넘기는 문구와, 자기번역 부품
 *    (`EmptyState` title/hint · 화면 안 `Card`/`Stat`/`MetricCard` label)에 생문자열로 넘기는 문구도
 *    전부 키다. literal 만 훑는 첫 집계에서 **115키가 통째로 시야 밖**이었다 — 등재 없이 그리면
 *    전 언어에서 한국어 원문 + 미등록 티가 뜬다(= 죽은 키). 그래서 (c) 는 두 갈래를 모두 센다.
 *
 * 못박는 것은 **반증 가능한 것만**이다:
 *   (a)  화면별 한글 잔여 조각 수(스캐너 `ko`) — **정확 일치**(여유 0).
 *   (a') 화면별 식 옆 JSX 텍스트 조각 수(스캐너 `koExpr`) — **정확 일치**. 전 화면 0 이다.
 *        문장을 `<T k="완료 "/>{n}<T k="건"/>` 처럼 조각으로 되돌리면 여기서 걸린다.
 *   (b)  화면별 `<T>`/`tAttr` 배선 수 · `<Tf>`/`tfAttr` 보간 배선 수 — 하한(전 화면 > 0).
 *   (c)  화면이 i18n 층에 넘기는 한국어 키가 **어느 카탈로그엔가 있다** — 미등재는 아래 `UNREGISTERED`
 *        뿐이고 그 집합은 **정확 일치**다(말없이 늘리거나, 등재하면서 지우지 않는 것 둘 다 실패한다).
 *   (c') 🔴 자리표시자(`{이름}`)가 든 키를 `<T>`/`tAttr` 로 부르지 않는다 — 보간 없이 `{수}` 가 그대로 찍힌다.
 *   (d)  🔴 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 ops12 가 다시 정의하지 않는다.
 *   (e)  🔴 고아 키 0 — ops12 의 모든 키를 소유 화면이 i18n 층에 실제로 넘긴다.
 *   (f)  세 언어 키 집합 동일 · 빈 값 0 · 🔴 번역문이 키와 같은 자리표시자를 갖는다.
 *   (g)  🔴 ops12 는 문맥 키(`원문@문맥`)를 만들지 않는다 — 추가 언어 팩에 문맥 결손을 만들지 않기 위해서다.
 *   (h)  🔴 저장값·전송값은 번역하지 않는다 — `<option value>`·AI 에게 보내는 빠른 질문이 `tAttr` 를 지나지 않는다.
 *   (i)  🔴 자기번역 부품(EmptyState·Ratio·화면 안 Card/Stat/MetricCard)에는 **생키**를 넘긴다 —
 *        `tAttr()` 로 미리 번역해 넘기면 부품 안에서 번역문을 키로 다시 찾는다(이중 번역).
 *
 * 🔴 **정본에서 파생한다** — 카탈로그 목록·등록 순서는 `registry.ts` 를, 파서는 스캐너의 `catalogKeysOf` 를 쓴다.
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf8');

/** 이 갈래가 소유한 화면 — `app/` 아래(스캐너가 직접 센다) */
const OWNED = [
  '(main)/facility-info/page.tsx',
  '(main)/interoperability/page.tsx',
  '(main)/interoperability/test/page.tsx',
  '(main)/simulator/page.tsx',
  '(main)/mapping-review/page.tsx',
  '(main)/flow-analytics/page.tsx',
  '(main)/pacs-portal/page.tsx',
  '(main)/ai-booking/page.tsx',
  '(main)/concierge/page.tsx',
  '(main)/journey/page.tsx',
  '(main)/metaverse/page.tsx',
  '(main)/notifications/page.tsx',
  '(main)/his-health-info/page.tsx',
  '(main)/custom/[slug]/page.tsx',
  '(main)/patient-flow/page.tsx',
  '(main)/safety-quality-board/page.tsx',
] as const;

/**
 * 🔴 공용 CMS 편집기는 `app/` 밖이라 **스캐너의 화면 순회에 잡히지 않는다** — 같은 계측 함수를 직접 불러
 *    같은 규칙으로 센다(여기서 따로 세는 규칙을 만들면 두 정본이 갈라진다).
 */
const COMPONENT = 'apps/web/src/components/admin/CategoryCmsPage.tsx';

/**
 * 🔴 (2026-09-28 공간·동선 P2) 메타버스 화면의 도면 뷰어 부품 — `app/` 밖이라 같은 방식으로 소유 목록에 넣는다.
 *    이 부품이 넘기는 키는 메타버스 화면(ops12)이 소유한다 · 부품 쪽 한글 잔여는 아래 SPACE_COMPONENT_KO 로 정확 동결.
 */
const SPACE_COMPONENTS = [
  'apps/web/src/components/space/SpaceViewer.tsx',
  'apps/web/src/components/space/FloorStack3D.tsx',
  'apps/web/src/components/space/FloorStackWebGL.tsx', // 2026-09-28 three.js 3D
  'apps/web/src/components/space/AssetPlacementPanel.tsx', // 2026-09-28 자산 배치 편집
  'apps/web/src/components/space/FloorPlanSvg.tsx',
  'apps/web/src/components/space/RouteSteps.tsx',
  'apps/web/src/components/space/RouteFloorPlans.tsx', // 2026-10-26 길안내 층별 도면(대기표·포털 예약 공용)
] as const;

/**
 * 🔴 화면이 i18n 층에 넘기지만 **일부러 등재하지 않은** 키 — 사유는 `ops12.ts` 머리 주석에 적혀 있다.
 *    이 집합은 정확 일치다 — 새 미등록 키가 생기면 실패하고, 등재했는데 여기 남겨둬도 실패한다.
 *
 *    · ai-booking `QUICK_PROMPTS` 5 — 누르면 **입력창에 그대로 들어가 AI 에게 전송되는 환자 발화**다.
 *      표시만 번역하면 화면과 전송 내용이 갈린다(전송값 · ops12 머리 ②).
 *    (interoperability `<pre>` API 예시 바디의 `"reason"` 값도 일부러 두었지만, 그것은 템플릿 문자열
 *     안이라 추출기가 **애초에 보지 않는다** — 여기 적으면 있지도 않은 것을 가리키는 예외가 된다.
 *     사유는 카탈로그 머리 ③ 에 남겼다.)
 *    · facility-info `FLOORS[].title` 6 — 이 병원의 **층 구성 이름표**다(기관 정체성 · 머리 ①).
 *      🔴 화면이 `{f.title}` 로 **생으로 찍는다** — 등재하면 아무도 부르지 않는 죽은 키가 된다.
 */
const UNREGISTERED = [
  '두통이 심해요',
  '감기 증상이에요',
  '건강검진 예약',
  '피부 트러블',
  '허리가 아파요',
  '지하',
  '로비·응급',
  '외래·검사',
  '외과 병동·수술',
  '소아·산부',
  '정형외과·재활',
];

/**
 * 2026-09-12 배선 후 실측 (재현: `node scripts/i18n-unwired-scan.mjs --json` → rows[].ko / koExpr / t).
 * `ko` 에 남은 것(사유는 `packages/shared/src/i18n/messages/ops12.ts` 머리 주석 ①~⑥):
 *   · facility-info 약 89 — 기관 정체성 데이터(층 구성·가격·전화번호·업소명). 🔴 게다가 이 값들은
 *     기관 정본(`system_configs.hospital.*` = 가상 가상시)과 어긋난다(화면은 '서울시 강남구').
 *   · API 예시 코드·엔드포인트 경로 · CMS 콘텐츠(태그·본문) · 표준 코드값 · 전송값
 *   · 라벨 맵 값·자기번역 부품 prop 원문 — 등재는 **했고**, 조각으로는 남는다(부품 안에서 그린다)
 * `t` = `<T`·`<Tf` + `t(f)Attr(` 출현 수(스캐너) · `tf` = `<Tf` + `tfAttr(` 출현 수.
 * 🔴 ko·koExpr 는 여유 0 — 늘면 실패, 줄면 이 표를 내린다. t·tf 는 하한.
 */
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
const BASELINE: Record<string, { ko: number; koExpr: number; t: number; tf: number }> = {
  // 🔴 2026-09-12 ko 100 → 95 · t 14 → 17: 지어낸 전화번호 3개(`02-1234-56xx`)를 앱 정본(`hospital-contact.ts`)으로
  //    바꾸고, 정본이 없는 연락처는 '정본 미등재'로 말하게 했다. 서울 강남 주소도 기관 정본(가상)으로 교정.
  //    화면 상단에 "아래는 등재된 정보가 아니라 예시"라는 고지를 추가했다(P15 — 화면이 스스로 한계를 말한다).
  // 🔴 2026-09-14 ko 95 → 87 · t 17 → 18: 주요 안내 카드 4장의 상수(정원·요금·업소명·영업시간)를 CMS 공개 행 3상태 카드로 교체.
  '(main)/facility-info/page.tsx': { ko: 87, koExpr: 0, t: 18, tf: 1 },
  '(main)/interoperability/page.tsx': { ko: 67, koExpr: 0, t: 34, tf: 7 },
  '(main)/interoperability/test/page.tsx': { ko: 6, koExpr: 0, t: 15, tf: 4 },
  '(main)/simulator/page.tsx': { ko: 13, koExpr: 0, t: 56, tf: 8 },
  '(main)/mapping-review/page.tsx': { ko: 19, koExpr: 0, t: 49, tf: 9 },
  '(main)/flow-analytics/page.tsx': { ko: 24, koExpr: 0, t: 42, tf: 8 },
  '(main)/pacs-portal/page.tsx': { ko: 3, koExpr: 0, t: 46, tf: 10 },
  '(main)/ai-booking/page.tsx': { ko: 6, koExpr: 0, t: 36, tf: 12 },
  '(main)/concierge/page.tsx': { ko: 10, koExpr: 0, t: 35, tf: 7 },
  '(main)/journey/page.tsx': { ko: 16, koExpr: 0, t: 19, tf: 2 }, // 9→16 2026-10-03 결정 D8·D9 지표 표 — 외래 체류 라벨·모집단 2·뺀 수 문장 3·이유 1(전부 <T k={표[키]}> 배선·카탈로그 등재) · 8→9 2026-10-01 재원일수 모집단 문구 상수(POPULATION_OF · <T k> 로 배선) · 24→8 2026-10-01 여정 P3 — 타임라인을 공용 JourneyTab 으로(로컬 유형 표·목록 마크업 회수 · 고아 키 4 회수)
  // 🔴 2026-09-28 ko 12 → 16: 화면 재구성(P2) — 탭 +1('구역 격자')·관측 필터 라벨 맵 3(`SOURCE_FILTER_LABEL` → <T k={맵[x]}>) · 전부 카탈로그 등재.
  // 🔴 2026-09-28 ko 16 → 17: P4b 탭 +1('체류 분석' — 탭 배열 라벨을 <Tf k={t.l}> 로 넘김 · 카탈로그 등재).
  '(main)/metaverse/page.tsx': { ko: 17, koExpr: 0, t: 19, tf: 6 },
  '(main)/notifications/page.tsx': { ko: 22, koExpr: 0, t: 12, tf: 3 },
  '(main)/his-health-info/page.tsx': { ko: 16, koExpr: 0, t: 6, tf: 1 },
  '(main)/custom/[slug]/page.tsx': { ko: 0, koExpr: 0, t: 18, tf: 2 },
  '(main)/patient-flow/page.tsx': { ko: 6, koExpr: 0, t: 12, tf: 2 },
  '(main)/safety-quality-board/page.tsx': { ko: 6, koExpr: 0, t: 14, tf: 5 },
};

/** `app/` 밖 공용 부품의 같은 계측 — 스캐너와 같은 함수로 센다 */
const COMPONENT_BASELINE = { ko: 4, koExpr: 0, t: 65, tf: 10 };

/* ── 카탈로그 파싱 (정본 = registry.ts 의 등록 순서) ────────────────────────── */

/** registry.ts 가 `registerCatalog` 로 등록하는 순서 — `t()` 의 우선순위 정본 */
function registeredOrder(): string[] {
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`);
  // 🔴 common 은 t.ts 가 직접 등록한다(registry 에 registerCatalog 호출이 없다) — 맨 앞이다
  return [...new Set(['common.ts', ...files])];
}

/** 파서 정본은 스캐너(`catalogKeysOf` — 네 표기) — 가드마다 두면 표기 하나를 빠뜨려 갈라진다(§12-H ③) */
const keysOf = (file: string, dir = MSG) => catalogKeysOf(read(join(dir, file))) as Set<string>;

/** 추가 언어 팩(zh·ru·vi·kk·mn·th) — 등재부 `packs/index.ts` 에서 파생(수기 목록 금지) */
const PACKS_DIR = join(ROOT, 'packages/shared/src/i18n/packs');
function packFiles(): string[] {
  const idx = read(join(PACKS_DIR, 'index.ts'));
  return [...new Set([...idx.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`))];
}

/** 문자열 리터럴 — 작은/큰따옴표 모두, 이스케이프를 풀어 소스 순서대로 */
function literals(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const q = s[i];
    if (q !== "'" && q !== '"') continue;
    let buf = '';
    let j = i + 1;
    for (; j < s.length; j++) {
      if (s[j] === '\\') { buf += s[j + 1]; j++; continue; }
      if (s[j] === q) break;
      if (s[j] === '\n') { j = -1; break; } // 줄을 넘는 것은 리터럴이 아니다
      buf += s[j];
    }
    if (j < 0) continue;
    out.push(buf);
    i = j;
  }
  return out;
}

/** ops12 의 [en, ja, ar] 튜플 — 세 언어 대조용(키·값이 작은따옴표/큰따옴표 섞여 있다) */
function ops12Rows(): Array<{ key: string; v: string[] }> {
  const src = stripComments(read(join(MSG, 'ops12.ts'))) as string;
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  const rows: Array<{ key: string; v: string[] }> = [];
  const re = /(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)")\s*:\s*\[([\s\S]*?)\]\s*,/g;
  for (const m of body.matchAll(re)) {
    const key = (m[1] !== undefined ? m[1] : m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"');
    rows.push({ key, v: literals(m[3]) });
  }
  return rows;
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

const HAN = /[가-힣]/;
const PARAM = /\{([^{}\s]+)\}/g;
const paramsOf = (s: string) => [...s.matchAll(PARAM)].map((m) => m[1]).sort();

/**
 * plain  = `<T k>`·`tAttr(` 로 부르는 키(자리표시자가 있으면 안 된다)
 * interp = `<Tf k>`·`tfAttr(` 로 부르는 키
 * label  = 라벨 맵·목록 값·자기번역 부품 prop 원문 — 존재·고아 검사에 쓴다
 *
 * 🔴 **데이터 prop 은 키로 세지 않는다** — facility-info 의 `name`/`detail`(층 구성·가격·전화번호)과
 *    `value`/`path`(전송값·엔드포인트 경로)는 기관 데이터·전송값이라 번역 대상이 아니다(ops12 머리 ①③).
 *    이것을 키로 세면 **번역해서는 안 될 값이 카탈로그에 들어간다.**
 */
interface Used { plain: Set<string>; interp: Set<string>; label: Set<string>; all: Set<string> }
function usedKeysOf(srcRaw: string): Used {
  const src = stripComments(srcRaw) as string;
  const plain = new Set<string>();
  const interp = new Set<string>();
  const label = new Set<string>();
  for (const m of src.matchAll(/<T\s+(?:className="[^"]*"\s+)?k=("((?:\\.|[^"\\])+)"|'((?:\\.|[^'\\])+)')/g)) plain.add((m[2] ?? m[3]).replace(/\\'/g, "'"));
  for (const m of src.matchAll(/<Tf\s+(?:className="[^"]*"\s+)?k=("((?:\\.|[^"\\])+)"|'((?:\\.|[^'\\])+)')/g)) interp.add((m[2] ?? m[3]).replace(/\\'/g, "'"));
  for (const m of src.matchAll(/<T\s+(?:className="[^"]*"\s+)?k=\{([^{}]*)\}/g)) for (const l of literals(m[1])) plain.add(l);
  for (const m of src.matchAll(/<Tf\s+(?:className="[^"]*"\s+)?k=\{([^{}]*)\}/g)) for (const l of literals(m[1])) interp.add(l);
  for (const b of callBodies(src, 'tAttr')) for (const l of literals(b)) plain.add(l);
  for (const b of callBodies(src, 'tfAttr')) { const l = literals(b)[0]; if (l) interp.add(l); }
  /**
   * 라벨 맵·상수 — 값이 `<T k={맵[x]}>`/`<Tf k={목록.l}>` 로 흘러 들어간다.
   * 🔴 **속성 이름으로는 데이터와 키를 가를 수 없다** — 같은 `title:` 이 interoperability 에서는 키고
   *    (`<T k={s.title}>`) facility-info 에서는 층 이름표(생으로 찍는 기관 데이터)다. 그래서
   *    **넓게 걷고**(대문자 상수 + 모든 소문자 속성) 아래 DATA_PROP 만 덜어낸 뒤, 그래도 남는
   *    "일부러 안 등재한 것"은 `UNREGISTERED` 로 이름을 대고 못박는다(사유는 카탈로그 머리에).
   */
  const DATA_PROP = /^(?:name|detail|value|path|href|icon|color|tone|floor|method|step|phase|weeks|slug|param|ops|rawType)$/;
  for (const m of src.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*('((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)")/g)) {
    if (DATA_PROP.test(m[1])) continue;
    label.add((m[3] ?? m[4]).replace(/\\'/g, "'"));
  }
  // 목록 상수 — `['진료','약품',…]` 처럼 배열에 담아 `<T k={x}>` 로 그리는 자리(concierge 정보 탭 등)
  for (const m of src.matchAll(/\[\s*('(?:\\.|[^'\\\n])*'\s*,\s*)+'(?:\\.|[^'\\\n])*'\s*\]/g)) for (const l of literals(m[0])) label.add(l);
  // 조건식 안의 키 — `cond ? '키A' : '키B'` 를 변수에 담아 `<Tf k={key}>` 로 넘기는 자리(concierge 출처 배지)
  for (const m of src.matchAll(/\?\s*('((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)")\s*:\s*('((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)")/g)) {
    label.add((m[2] ?? m[3]).replace(/\\'/g, "'"));
    label.add((m[5] ?? m[6]).replace(/\\'/g, "'"));
  }
  // 자기번역 부품 prop — 생키를 넘기는 자리(EmptyState title/hint · Card title · Stat/MetricCard label …)
  for (const m of src.matchAll(/\b(?:title|hint|subtitle|emptyHint|unavailableHint|label|placeholder)="([^"]*)"/g)) label.add(m[1]);
  const keep = (s: Set<string>) => new Set([...s].filter((k) => HAN.test(k)));
  const p = keep(plain);
  const i = keep(interp);
  const l = keep(label);
  return { plain: p, interp: i, label: l, all: new Set([...p, ...i, ...l]) };
}

/** 스캐너와 같은 규칙으로 `app/` 밖 부품을 센다 */
function measureComponent(srcRaw: string) {
  const noc = stripComments(srcRaw) as string;
  const t = (noc.match(/<Tf?[\s>]/g) || []).length + (noc.match(/\bt(?:f)?Attr\w*\(/g) || []).length;
  const tf = (noc.match(/<Tf[\s>]/g) || []).length + (noc.match(/\btfAttr\w*\(/g) || []).length;
  const stripped = stripI18nKeys(noc) as string;
  return { t, tf, ko: [...(koFragments(stripped) as Iterable<string>)].length, koExpr: [...(koExprFragments(stripped) as Iterable<string>)].length };
}

const ORDER = registeredOrder();
const AT = ORDER.indexOf('ops12.ts');
const CAT = new Map(ORDER.map((f) => [f, keysOf(f)]));
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of CAT.get(f)!) ALL_KEYS.add(k);
const ROWS = ops12Rows();
const COMPONENT_SRC = read(join(ROOT, COMPONENT));
const USED = [
  ...OWNED.map((f) => ({ f, u: usedKeysOf(read(join(APP, f))) })),
  { f: COMPONENT, u: usedKeysOf(COMPONENT_SRC) },
  ...SPACE_COMPONENTS.map((f) => ({ f, u: usedKeysOf(read(join(ROOT, f))) })),
];
const USED_ALL = new Set<string>();
for (const { u } of USED) for (const k of u.all) USED_ALL.add(k);
const short = (f: string) => f.replace('(main)/', '').replace('apps/web/src/components/admin/', '');
const tfCount = (file: string) => {
  const noc = stripComments(read(join(APP, file))) as string;
  return (noc.match(/<Tf[\s>]/g) || []).length + (noc.match(/\btfAttr\(/g) || []).length;
};

describe('🔴 운영·분석 화면 16 + 공용 CMS 편집기 i18n 배선 (ops12)', () => {
  it('대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string }>;
    expect(rows.length).toBeGreaterThan(500);
    for (const f of OWNED) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    // 🔴 공용 부품은 `app/` 밖이라 스캐너 순회에 **없다** — 없다는 사실 자체를 못박는다(있으면 이중 계측이다)
    expect(rows.find((r) => r.file.includes('CategoryCmsPage')), '부품이 화면 순회에 들어왔다').toBeFalsy();
    expect(COMPONENT_SRC.length, '공용 부품을 읽지 못했다').toBeGreaterThan(1000);
    expect(AT, 'registry 에서 ops12 를 찾지 못했다').toBeGreaterThan(0);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(30);
    expect(ROWS.length, 'ops12 표 파싱이 깨졌다').toBeGreaterThan(350);
    expect(ROWS.length, '표 행 수와 키 수가 다르다(파서가 행을 흘렸다)').toBe(CAT.get('ops12.ts')!.size);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(5000);
    expect(USED_ALL.size, '화면 키 추출이 깨졌다').toBeGreaterThan(380);
    // 추출기 대조군 — 경로마다 실제로 잡는다
    expect(USED_ALL.has('알림 센터')).toBe(true); // <T k="…">
    expect(USED_ALL.has('{수} 시설')).toBe(true); // <Tf k="…">
    expect(USED_ALL.has('안전·위급')).toBe(true); // 라벨 맵 값 → <T k={맵[x]}>
    expect(USED_ALL.has('진단코드 (KCD)')).toBe(true); // 소문자 스네이크 키 라벨 맵
    expect(USED_ALL.has('혼잡도 데이터가 없습니다')).toBe(true); // EmptyState title prop
    expect(USED_ALL.has('병목 단계')).toBe(true); // 화면 안 Card title prop
    expect(USED_ALL.has('환자명 또는 등록번호(MRN)')).toBe(true); // tAttr(placeholder)
    expect(USED_ALL.has('{AI표기} 응답 불가')).toBe(true); // 조건식 안의 키
    // 🔴 기관 데이터·전송값은 키로 세지 않는다 — 세면 "번역해서는 안 될 값"이 카탈로그에 들어간다
    expect(USED_ALL.has('B1~B3 총 320대'), 'facility-info 시설 세부(기관 데이터)를 키로 셌다').toBe(false);
    expect(USED_ALL.has('/fhir/R4/Patient?name=김'), '엔드포인트 경로를 키로 셌다').toBe(false);
  });

  it('(a) 화면별 한글 잔여(스캐너 `ko`)가 기준선과 **정확히** 일치한다(여유 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.ko]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].ko])));
    expect(measureComponent(COMPONENT_SRC).ko, `${short(COMPONENT)} 한글 잔여`).toBe(COMPONENT_BASELINE.ko);
  });

  it("🔴 (a') 식 옆 JSX 텍스트(스캐너 `koExpr`)도 **정확히** 일치한다 — 문장을 생한글 조각으로 되돌리면 여기서 걸린다", () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; koExpr: number }>;
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.koExpr]));
    expect(actual).toEqual(Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].koExpr])));
    expect(measureComponent(COMPONENT_SRC).koExpr).toBe(COMPONENT_BASELINE.koExpr);
    // 하한이 전부 0 이라 "조각이 늘면 걸린다"만 보증한다 — 그 판정기가 살아 있는지 대조군으로 확인한다
    expect(Object.values(BASELINE).every((b) => b.koExpr === 0)).toBe(true);
    expect([...(koExprFragments('<p>남은 {n}건</p>') as Iterable<string>)].length, 'koExpr 판정기가 죽었다').toBeGreaterThan(0);
  });

  it('(b) 화면마다 <T>/tAttr 배선과 <Tf>/tfAttr 보간 배선이 기준선 이상이다(전 화면 배선 > 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; t: number }>;
    for (const f of OWNED) {
      const t = rows.find((r) => r.file === f)!.t;
      expect(t, `${f} 배선이 0 이다(원래 상태로 되돌아갔다)`).toBeGreaterThan(0);
      expect(t, `${f} <T>/tAttr 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].t);
      expect(tfCount(f), `${f} 보간 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].tf);
    }
    const c = measureComponent(COMPONENT_SRC);
    expect(c.t, `${short(COMPONENT)} 배선이 줄었다`).toBeGreaterThanOrEqual(COMPONENT_BASELINE.t);
    expect(c.tf, `${short(COMPONENT)} 보간 배선이 줄었다`).toBeGreaterThanOrEqual(COMPONENT_BASELINE.tf);
    // 하한이 0 이면 이 검사는 아무것도 보증하지 않는다
    expect(OWNED.filter((f) => BASELINE[f].tf > 0).length, '보간 배선 하한이 전부 0').toBeGreaterThanOrEqual(10);
  });

  it('(c) 화면이 i18n 층에 넘기는 한국어 키가 카탈로그에 있다 — 미등재는 사유가 적힌 키뿐이다', () => {
    const missing: string[] = [];
    for (const { f, u } of USED) for (const k of u.all) if (!ALL_KEYS.has(k)) missing.push(`${short(f)}: ${k}`);
    const bare = [...new Set(missing.map((m) => m.split(': ').slice(1).join(': ')))].sort();
    // 🔴 정확 일치 — 새 미등록 키가 생겨도, 등재해 놓고 예외 목록에 남겨둬도 실패한다
    expect(bare, `미등록 키(원문+티로 나간다):\n${missing.join('\n')}`).toEqual([...UNREGISTERED].sort());
    // 미등재 키는 카탈로그에 정말 없어야 한다(예외 목록이 "있는 키"를 가리키면 검사가 헛돈다)
    for (const k of UNREGISTERED) expect(ALL_KEYS.has(k), `${k} 는 이미 등재돼 있다 — 예외 목록에서 지운다`).toBe(false);
  });

  it("🔴 (c') 자리표시자가 든 키를 <T>/tAttr 로 부르지 않는다 — 보간 없이 {수} 가 그대로 찍힌다", () => {
    const bad: string[] = [];
    for (const { f, u } of USED) for (const k of u.plain) if (paramsOf(k).length) bad.push(`${short(f)}: ${k}`);
    expect(bad, `<Tf>/tfAttr 로 옮겨야 하는 자리:\n${bad.join('\n')}`).toEqual([]);
    // 대조군 — 보간 키를 실제로 갖고 있다(0 이면 위 검사는 아무것도 보증하지 않는다)
    const interpKeys = new Set<string>();
    for (const { u } of USED) for (const k of u.interp) if (paramsOf(k).length) interpKeys.add(k);
    expect(interpKeys.size, '보간 키 대조군이 0').toBeGreaterThanOrEqual(50);
    // 🔴 metaverse 뷰 탭 목록에는 `환자 위치 ({수})` 가 섞여 있다 — `<T k={t.l}>` 로 그리면 `{수}` 가 그대로 찍힌다
    const meta = stripComments(read(join(APP, '(main)/metaverse/page.tsx'))) as string;
    expect(meta, 'metaverse 뷰 탭을 <Tf> 로 부르지 않는다').toMatch(/<Tf\s+k=\{t\.l\}\s+params=\{\{\s*수:/);
    expect(/<T\s+k=\{t\.l\}/.test(meta), 'metaverse 뷰 탭을 <T> 로 부른다(자리표시자가 그대로 찍힌다)').toBe(false);
  });

  it('🔴 (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 ops12 가 다시 정의하지 않는다', () => {
    const earlier = ORDER.slice(0, AT);
    expect(earlier.length, 'ops12 앞에 카탈로그가 없다(등록 순서 파싱이 깨졌다)').toBeGreaterThan(30);
    const dead = [...CAT.get('ops12.ts')!]
      .filter((k) => earlier.some((f) => CAT.get(f)!.has(k)))
      .map((k) => `${k} ← ${earlier.filter((f) => CAT.get(f)!.has(k)).join(',')}`)
      .sort();
    expect(dead, `죽은 키(앞 카탈로그가 이긴다 — 여기서 지운다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('🔴 (e) 고아 키 0 — ops12 의 모든 키를 소유 화면이 i18n 층에 실제로 넘긴다', () => {
    const orphan = ROWS.map((r) => r.key).filter((k) => !USED_ALL.has(k)).sort();
    expect(orphan, `소유 화면이 부르지 않는 키:\n${orphan.join('\n')}`).toEqual([]);
    // `@` 로 시작하는 키는 표시 원문이 빈 문자열이 된다 — 어떤 검사든 빠져나가는 형태라 따로 막는다(§12-F ③)
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

  it('🔴 (g) ops12 는 문맥 키를 만들지 않는다 — 추가 언어 팩에 문맥 결손을 만들지 않기 위해서다', () => {
    const files = packFiles();
    expect(files.length, '팩 등재부 파싱이 깨졌다').toBeGreaterThanOrEqual(6);
    const packKeys = new Map(files.map((f) => [f, keysOf(f, PACKS_DIR)]));
    for (const [f, ks] of packKeys) expect(ks.size, `${f} 키 파싱이 깨졌다`).toBeGreaterThan(300);
    const context = ROWS.map((r) => r.key).filter((k) => k.lastIndexOf('@') > 0);
    const gaps: string[] = [];
    for (const key of context) {
      const bare = key.slice(0, key.lastIndexOf('@'));
      for (const [f, ks] of packKeys) if (ks.has(bare) && !ks.has(key)) gaps.push(`${f}: ${key}`);
    }
    expect(gaps, `팩 결손을 만드는 문맥 키(팩과 함께 하거나 문맥 키를 쓰지 않는다):\n${gaps.join('\n')}`).toEqual([]);
    expect(context, 'ops12 가 문맥 키를 새로 만들었다 — 팩 결손을 확인하고 이 기대값을 갱신한다').toEqual([]);
    // 대조군 — 결손 판정기가 살아 있다: 이미 알려진 결손(`판정@검사`)을 이 판정기도 본다
    expect([...packKeys.values()].some((ks) => ks.has('판정') && !ks.has('판정@검사'))).toBe(true);
  });

  it('🔴 (h) 저장값·전송값은 번역하지 않는다 — option value·AI 에게 보내는 빠른 질문이 tAttr 를 지나지 않는다', () => {
    const bad: string[] = [];
    for (const f of OWNED) {
      const src = stripComments(read(join(APP, f))) as string;
      // 🔴 `<option value>` 만 본다 — `<Stat value={tfAttr('{수}건'…)}>` 는 **표시값**이라 번역이 맞다
      //    (넓게 잡았다가 그 자리를 결함으로 불렀다 · 정당 판정에 억지 가드를 만들지 않는다)
      if (/<option\b[^>]*\bvalue=\{\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: <option value={tAttr(…)}>`);
      if (/\bvalue:\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: value: tAttr(…)`);
      if (/\bsetInput\(\s*t(?:f)?Attr\(/.test(src)) bad.push(`${short(f)}: setInput(tAttr(…))`);
    }
    expect(bad).toEqual([]);
    // 대조군 — 라벨은 번역하고 value 는 그대로 넘기는 형태가 실제로 있다(사라지면 검사 대상이 없다)
    const sim = stripComments(read(join(APP, '(main)/simulator/page.tsx'))) as string;
    expect(sim, 'simulator 이벤트 option 이 value 는 코드·라벨만 번역하는 형태여야 한다').toMatch(/value=\{t\.value\}>\{tAttr\(t\.label\)\}/);
    const booking = stripComments(read(join(APP, '(main)/ai-booking/page.tsx'))) as string;
    expect(booking, '빠른 질문은 전송값이라 생문자열로 남아 있어야 한다').toContain("'두통이 심해요'");
  });

  it('🔴 (i) 자기번역 부품에는 생키를 넘긴다 — 미리 번역해 넘기면 부품이 번역문을 키로 다시 찾는다', () => {
    const bad: string[] = [];
    let raw = 0;
    for (const f of [...OWNED, COMPONENT]) {
      const src = stripComments(f === COMPONENT ? COMPONENT_SRC : read(join(APP, f))) as string;
      for (const m of src.matchAll(/<(EmptyState|Ratio|Card|Stat|MetricCard)\b[^>]*>/g)) {
        if (/\b(?:title|hint|subtitle|emptyHint|unavailableHint|label|sub)=\{\s*t(?:f)?Attr\(/.test(m[0])) bad.push(`${short(f)}: ${m[1]}`);
        if (/\b(?:title|label|unavailableHint)="[^"]*[가-힣]/.test(m[0])) raw++;
      }
    }
    expect(bad, `자기번역 부품에 번역된 문자열을 넘긴다:\n${bad.join('\n')}`).toEqual([]);
    expect(raw, '생키를 넘기는 자기번역 부품 대조군이 0(검사 대상이 없다)').toBeGreaterThanOrEqual(10);
  });

  it('전량 AI_DRAFT — 사람 검수(VERIFIED) 를 코드가 임의로 선언하지 않는다', () => {
    expect(read(join(MSG, 'ops12.ts'))).toMatch(/OPS12_VERIFIED: ReadonlySet<string> = new Set\(\)/);
  });

  it('🔴 카탈로그 헤더가 "무엇을 왜 뺐는지"를 적었다 (제외 주장은 검증 가능해야 한다)', () => {
    const head = read(join(MSG, 'ops12.ts'));
    const block = head.slice(0, head.indexOf('*/') + 2);
    expect(block).toMatch(/의도적\s*미등재/);
    expect(block, '기관 정체성 제외 사유를 적지 않았다').toMatch(/기관 정체성 데이터/);
    expect(block, '저장값·전송값 제외 사유를 적지 않았다').toMatch(/전송값·저장값/);
    expect(block, 'API 예시 코드 제외 사유를 적지 않았다').toMatch(/API 예시 코드/);
    expect(block, 'CMS 콘텐츠 제외 사유를 적지 않았다').toMatch(/CMS 콘텐츠/);
    expect(block, '서버 조립 문장 제외 사유를 적지 않았다').toMatch(/서버·외부 시스템이 조립한 문장/);
    expect(block, '사람 검수 대상을 열거하지 않았다').toMatch(/사람 검수 대상/);
    // 🔴 미등재 키는 이름을 대고 남긴다 — 잊히면 누군가 "번역 누락"으로 채운다
    for (const k of UNREGISTERED) expect(block, `미등재 사유에 ${k} 가 없다`).toContain(k);
  });
});
