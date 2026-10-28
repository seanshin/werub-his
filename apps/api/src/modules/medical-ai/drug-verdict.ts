/**
 * 약물추천 **DUR 정본 재검증**(`durVerdict`) — 기획서 `chart-ai-assistant-agent.plan.md` §4.2·§4.4 규칙 6.
 *
 * 🔴 왜: LLM 이 적은 `"cdssCheck": "PASS"` 는 판정이 아니다(문자열). 판정은 **서버 DUR 정본**(`DurService.checkInteractions`)
 *    만이 낸다. 약명은 **약가마스터 정본 검색**(`buildMedicationSearchWhere`)으로 특정하고, 특정하지 못하면 `UNRESOLVED`
 *    라고 말한다(추정 매칭으로 PASS 를 만들지 않는다). DUR 서비스가 없거나 실패하면 `null` + "재검증 실패: <사유>" —
 *    **PASS 를 지어내지 않는다**.
 *
 * 순수 함수 + 얇은 의존 주입(prisma·dur) — 모듈 의존 없이 테스트 가능.
 */
import { Prisma } from '@prisma/client';
import { buildMedicationSearchWhere, MEDICATION_SEARCH_ORDER } from '../../common/medication-search';
import { ZERO_UUID } from '../audit/audit-routes';
import type { DurWarning } from '../prescription/dur/dur.service';

export type DurVerdict = 'PASS' | 'WARNING' | 'BLOCK' | 'UNRESOLVED';

/**
 * 어떻게 특정했는가 — 화면이 "무엇에 대한 판정인지"를 구분해 그린다.
 *   · `EXACT`            상품 1건으로 특정(종전 ONE)
 *   · `INGREDIENT_GROUP` 후보가 여럿이지만 **주성분이 하나**라 성분 대표로 판정(제품별 함량·제형 차이는 처방 폼에서 확정)
 *   · `AMBIGUOUS`        서로 다른 성분이 섞였거나 주성분 정보가 없다 → 판정하지 않는다(UNRESOLVED)
 *   · `NONE`             약가마스터 미매칭
 * 🔴 판정을 못 한 경로(DUR 미주입·예외)에서는 이 필드를 **비운다** — 모르는 것을 값으로 채우지 않는다.
 */
export type DrugResolution = 'EXACT' | 'INGREDIENT_GROUP' | 'AMBIGUOUS' | 'NONE';

/** 화면에 싣는 경고 요약 — 정본 DurWarning 에서 type/severity/message 만(drugA/B 는 message 에 이미 있다) */
export interface DurWarningTrimmed { type: string; severity: string; message: string }

export interface DrugVerdictResult {
  /** null = 재검증 자체를 못 했다(서비스 부재·오류). PASS 가 아니다 */
  durVerdict: DurVerdict | null;
  /** 어떤 약가 코드에 매칭했고 경고가 몇 건이었는지 — 사람이 읽는 근거 */
  durVerdictBasis: string;
  durWarnings: DurWarningTrimmed[];
  medicationCodeId?: string;
  resolvedName?: string;
  /** 특정 방식(§ DrugResolution). 판정 자체를 못 한 경로에서는 없다 */
  resolution?: DrugResolution;
}

/** 약가마스터 조회에 필요한 최소 prisma 표면(테스트에서 mock 하기 쉽게) */
export interface MedicationCodeLookup {
  medicationCode: {
    findMany: (args: {
      where: Prisma.MedicationCodeWhereInput;
      orderBy?: Prisma.MedicationCodeOrderByWithRelationInput[];
      take?: number;
      select?: Record<string, boolean>;
    }) => Promise<Array<{ id: string; code: string; nameKo: string; nameEn: string | null; ingredient: string | null; ingredientCode?: string | null }>>;
  };
}
export interface EncounterLookup {
  encounter: { findFirst: (args: { where: { patientId: string }; orderBy: { createdAt: 'desc' }; select: { id: true } }) => Promise<{ id: string } | null> };
}
export interface DurChecker {
  checkInteractions: (encounterId: string, medicationCodeId: string, patientId: string, doseCtx?: { dosage?: string | null; frequency?: string | null }) => Promise<DurWarning[]>;
}

/**
 * 후보 조회 상한. 🔴 20 이었다 — 그런데 "후보가 전부 같은 성분인가"는 **후보 전체를 봐야** 알 수 있다.
 * 한 페이지(20건)만 보고 '전부 같은 성분'이라 말하면 21번째가 다른 성분일 때 거짓 판정이 된다.
 * 그래서 상한을 넉넉히 올리고, **상한에 닿으면 성분 대표 판정을 하지 않는다**(전체를 못 봤다고 말한다).
 *
 * 성분(INN) 경로는 상한의 뜻이 다르다 — 아래 `resolveByIngredient` 주석 참조(그쪽은 소진 논증이 아니라
 * 행별 검증이라 절단돼도 대표가 흔들리지 않는다). 값을 바꾸려면 §운영 실측(2026-08-20)을 다시 재고 바꾼다.
 */
const CANDIDATE_TAKE = 200;

// ─────────────────────────────────────────────────────────────────────────────
// 약가마스터 `ingredient` 표기 파서 — 🔴 추정이 아니라 운영 실측(2026-08-20 · 활성 22,713행)에서 나왔다.
//
//   단일제  `carvedilol   25mg`
//           `amlodipine besylate (as amlodipine   5mg)`      ← 염기(as …)에 활성 본체가 적힌다
//   복합제  `amlodipine besylate (as amlodipine   5mg), rosuvastatin calcium (as rosuvastatin   10mg), telmisartan   80mg`
//
// 실측 분포: 최상위 콤마 세그먼트 1개 = 17,157행 · 2개 이상(복합제) = 5,556행 · ingredient 없음 387행.
// 괄호 **안**에 콤마가 오는 행이 74건 있다(`(as EPA …, DHA …)`) → 콤마 분해는 반드시 괄호 깊이를 본다.
//
// 🔴 `ingredientCode` 를 성분 키로 쓰면 안 된다(종전 구현이 그랬다): 6자리+제형3자 코드가 **염·함량까지** 구분한다.
//    실측 — amlodipine 단일제만으로 107601/459801/107602/470801/479701/… 15개 접두로 쪼개진다.
//    그래서 `INGREDIENT_GROUP` 이 운영에서 **0/10** 이었다(기획서 §1.5). 성분 키는 `ingredient` 파싱으로 만든다.
// ─────────────────────────────────────────────────────────────────────────────

/** 최상위(괄호 밖) 콤마로 성분 세그먼트를 나눈다 — 괄호 안 콤마는 세그먼트 경계가 아니다(실측 74행) */
export function splitIngredientComponents(ingredient: string | null | undefined): string[] {
  const s = String(ingredient ?? '').trim();
  if (!s) return [];
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '（') depth++;
    else if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** 함량 이후를 잘라내는 패턴 — `carvedilol   25mg` · `sodium alginate   1.25g(50mg/mL)` */
const STRENGTH_TAIL_RE = /(?:^|\s)\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|kg|ml|mL|L|IU|U|GBq|mCi|%|억|만)?.*$/;

/**
 * 세그먼트 1개 → 활성 본체(moiety) 이름. `(as X …)` 가 있으면 그 안이 활성 본체다(염기 표기 흡수).
 * 🔴 `(as A …, B …)` 처럼 **안에 콤마가 있으면 다성분**이다 → `null`(모른다). 단일제로 접지 않는다.
 */
export function moietyOfComponent(segment: string | null | undefined): string | null {
  let s = String(segment ?? '').trim();
  const as = s.match(/\(\s*as\s+([^)]*)\)/i);
  if (as) {
    if (as[1].includes(',')) return null;
    s = as[1];
  } else {
    s = s.replace(/\([^)]*\)/g, ' ');
  }
  s = s.replace(STRENGTH_TAIL_RE, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return s || null;
}

/** 한 제품의 활성 본체 목록(중복 제거). 하나라도 못 읽으면 `null` — 모르는 것을 "성분 하나"로 접지 않는다 */
export function ingredientMoieties(ingredient: string | null | undefined): string[] | null {
  const segs = splitIngredientComponents(ingredient);
  if (segs.length === 0) return null;
  const ms = segs.map(moietyOfComponent);
  if (ms.some((m) => !m)) return null;
  return [...new Set(ms as string[])];
}

/**
 * 염·수화물 접미. 🔴 사전을 감으로 적지 않았다 — 활성 단일제 성분키 1,325종의 **마지막 토큰 실측 분포**에서
 * 골랐다(hydrochloride 115 · sodium 40 · hydrate 23 · acetate 17 · sulfate 14 · chloride 9 · tartrate 7 …).
 * 이 정규화가 필요한 이유: LLM 은 INN(`metformin`)을 쓰는데 마스터는 염표기(`metformin hydrochloride`)를 쓴다.
 * 실측 — `metformin` 정확일치 단일제는 **1건**뿐이고 `metformin hydrochloride` 가 127건이었다.
 */
const SALT_TOKENS = new Set([
  // `hcl` 은 축약 표기 — 마스터에도 12행 실재하고(정본은 `hydrochloride` 4,549행), LLM 도 "metformin HCl" 로 쓴다
  'hydrochloride', 'dihydrochloride', 'hydrobromide', 'hydroiodide', 'hcl',
  'sodium', 'disodium', 'potassium', 'dipotassium', 'calcium', 'magnesium',
  'besylate', 'besilate', 'mesylate', 'mesilate', 'maleate', 'fumarate', 'tartrate', 'bitartrate',
  'succinate', 'citrate', 'acetate', 'sulfate', 'sulphate', 'phosphate', 'diphosphate', 'nitrate',
  'carbonate', 'bicarbonate', 'oxalate', 'malate', 'lactate', 'gluconate', 'stearate', 'palmitate',
  'pamoate', 'tosylate', 'camsylate', 'edisylate', 'napadisylate', 'orotate', 'adipate', 'nicotinate',
  'aspartate', 'glutamate', 'embonate', 'xinafoate', 'propionate', 'furoate', 'valerate', 'dipropionate',
  'hydrate', 'monohydrate', 'dihydrate', 'trihydrate', 'sesquihydrate', 'anhydrous', 'micronized',
  'bromide', 'chloride', 'iodide', 'oxide',
]);

/**
 * 🔴 벗겨내면 **원소명만 남는** 것은 벗기지 않는다 — `potassium chloride` 를 `potassium` 으로 접으면
 * `potassium citrate` 와 한 성분이 되어 버린다. 그건 다른 약이다. `sodium chloride`·`magnesium oxide` 도 같다.
 */
const ELEMENT_ONLY = new Set(['sodium', 'potassium', 'calcium', 'magnesium', 'iron', 'ferrous', 'ferric', 'zinc', 'lithium', 'aluminium', 'aluminum', 'ammonium', 'barium', 'water']);

/**
 * 활성 본체 → 염 정규화 키. `atorvastatin calcium`→`atorvastatin` · `montelukast sodium`→`montelukast`.
 * 실측 효과: 단일제 성분 1,325종 → 1,276종(47종이 병합 — 전부 같은 활성 본체의 염 변이였다).
 */
export function baseIngredientKey(moiety: string | null | undefined): string {
  let t = String(moiety ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  while (t.length >= 2 && SALT_TOKENS.has(t[t.length - 1])) {
    const cand = t.slice(0, -1);
    const joined = cand.join(' ');
    if (joined.length < 4 || ELEMENT_ONLY.has(joined)) break;
    t = cand;
  }
  return t.join(' ');
}

/** 제품의 성분 키(정렬·중복제거해 합친다). 복합제는 `a+b`. 못 읽으면 null(= 모른다) */
export function productIngredientKey(row: { ingredient: string | null }): string | null {
  const ms = ingredientMoieties(row.ingredient);
  if (!ms) return null;
  const bases = [...new Set(ms.map(baseIngredientKey).filter(Boolean))].sort();
  return bases.length ? bases.join('+') : null;
}

/** LLM 이 낸 성분명 → 조회 키. 괄호·함량을 떼고 염 정규화까지 한다(`Metformin HCl 500mg` → `metformin hcl`→`metformin`) */
export function normalizeInnQuery(name: string | null | undefined): string {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  const seg = splitIngredientComponents(raw)[0] ?? raw;
  const moiety = moietyOfComponent(seg);
  return baseIngredientKey(moiety ?? seg.toLowerCase());
}

/**
 * LLM 이 적은 약명을 검색어 후보로 정규화한다 — 원문 → 괄호·용량 토큰 제거 → 첫 토큰. 앞에서부터 시도해
 * **첫 번째로 결과가 나오는 질의**를 쓴다(원문 우선 — 넓히기는 하되 좁히지 않는다).
 */
export function medicationQueryCandidates(name: string): string[] {
  const raw = (name ?? '').toString().trim();
  if (!raw) return [];
  const noParen = raw.replace(/[（(][^)）]*[)）]/g, ' ').replace(/\s+/g, ' ').trim();
  const noDose = noParen.replace(/(?<![A-Za-z0-9])\d+(?:[.,]\d+)?\s*(mg|mcg|µg|ug|g|ml|mL|IU|단위|정|캡슐|포|앰플|바이알|%)(?![A-Za-z가-힣])/gi, ' ').replace(/\s+/g, ' ').trim();
  const first = noDose.split(/[\s,/·]+/).filter(Boolean)[0] ?? '';
  const out: string[] = [];
  for (const q of [raw, noParen, noDose, first]) if (q && q.length >= 2 && !out.includes(q)) out.push(q);
  return out;
}

export type ResolvedMedication =
  | { status: 'ONE'; id: string; code: string; nameKo: string; query: string; via?: 'NAME' | 'INGREDIENT' }
  /** 후보가 여럿인데 **주성분이 하나** — 대표 1건(code 최소)으로 성분 단위 판정 */
  | { status: 'INGREDIENT_GROUP'; id: string; code: string; nameKo: string; ingredientKey: string; ingredientLabel: string; count: number; query: string; via?: 'NAME' | 'INGREDIENT'; scanTruncated?: boolean }
  /** `repIrrelevant` = 성분은 하나로 모였지만 **대표가 질의와 의미 있게 일치하지 않는다**(§의미 일치) → 대표 판정 보류 */
  | { status: 'MANY'; count: number; query: string; distinctIngredients: number; ingredientLabels: string[]; unknownIngredient: boolean; truncated: boolean; repIrrelevant?: boolean }
  /**
   * `reason` — 🔴 "0건"과 "부분 문자열로만 겹친다"는 다른 사실이다. 화면이 이유를 말할 수 있게 구분해 싣는다.
   *   · `NO_CANDIDATE`        어떤 질의로도 후보가 0건(진짜 미매칭)
   *   · `NO_MEANINGFUL_MATCH` 후보는 있었으나 질의가 제품명·성분 어느 쪽과도 **의미 있게** 일치하지 않았다(약효군·일반 명사)
   */
  | { status: 'NONE'; reason?: 'NO_CANDIDATE' | 'NO_MEANINGFUL_MATCH'; looseCount?: number; query?: string };

/** 성분 키 정규화 — 앞뒤 공백 제거·소문자·연속 공백 1칸(표기 흔들림으로 성분이 갈라지지 않게) */
export function normalizeIngredientKey(v: string | null | undefined): string {
  return (v ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 후보 1건의 성분 키.
 *
 * 🔴 종전엔 `ingredientCode` 를 **우선**했다 — 그게 INGREDIENT_GROUP 적중 0/10(기획서 §1.5)의 원인이었다.
 *    주성분코드는 성분이 아니라 **성분+염+함량+제형**을 식별한다(실측: amlodipine 단일제가 15개 코드접두로 분산).
 *    같은 성분끼리 절대 묶이지 않으니 "전 후보가 같은 성분"이 성립할 수 없었다.
 *
 * 지금은 `ingredient` 표기를 파싱해 **활성 본체(염 정규화)** 를 키로 쓴다. `ingredient` 가 없거나 못 읽으면
 * 빈 키(= 모른다) — 주성분코드로 **대신 채우지 않는다**(키 공간이 섞이면 같은 성분이 서로 다른 성분처럼 보인다).
 */
function ingredientKeyOf(r: { ingredient: string | null; ingredientCode?: string | null }): { key: string; label: string } {
  const key = productIngredientKey(r);
  if (key) return { key: `I:${key}`, label: key };
  return { key: '', label: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 "의미 있게 일치하는가" — 약명 경로의 승격 조건(2026-08-20 실측으로 신설)
//
// 무엇이 일어났나: LLM 이 약이 아니라 **약효군**(`콜레스테롤 저하제`)을 약명으로 냈는데,
// 후보 질의가 첫 토큰 `콜레스테롤` 로 넓혀지며 nameKo 부분일치가 **우연히 1건**에 걸렸다
// (`아도스테롤(131I)주사액(요오디네이티트(131I)노르콜레스테롤)` — 진단용 방사성 의약품).
// 후보 1건 = ONE → EXACT → DUR 이 그 제품 하나에 돌아 `PASS` → 화면은 초록 배지.
// **환자와 무관한 약을 "DUR 통과"로 보여주는 거짓 안심**이다. 거짓 경보보다 나쁘다.
//
// 🔴 "후보가 1건뿐"은 특정의 근거가 아니다 — 마스터가 작아서일 수도, 부분 문자열이 우연히 걸렸을 수도 있다.
// 그래서 승격(ONE·INGREDIENT_GROUP) 전에 **질의가 그 제품과 의미 있게 일치하는지**를 따로 묻는다.
//
// 판정: 질의가 nameKo·nameEn·ingredient 안에서 **토큰 경계에서 시작**하거나(문자열 처음, 또는 앞 글자가
// 한글/라틴/숫자가 아님 — `(`·`_`·공백·`/`·`-` 등), code 접두이면 의미 일치로 본다.
//   · `콜레스테롤` ⊂ `…노르콜레스테롤)` → 앞 글자가 `르` → **불일치**(다른 물질의 어미로 걸린 것)
//   · `아스피린`  ⊂ `케이아스피린장용정(아스피린)` → 괄호 뒤 `(아스피린` → 일치
// 🔴 **끝 경계는 요구하지 않는다** — 한국어 표기는 접미가 그대로 붙는다(`(아세트아미노펜제피세립)`).
//    끝까지 요구했다면 정상 약명이 대량으로 탈락한다(실측으로 확인하고 뺐다).
//
// 왜 사전(약효군 어휘)을 쓰지 않았나 — **데이터에 물어봤다**(2026-08-20 · 활성 22,713행):
//   `항생제·진통제·이뇨제·해열제·수면제·소화제·지사제·항암제·주사제·경구약·혈압약·당뇨약·스테로이드·스타틴·콜레스테롤`
//   전부 nameKo/ingredient **접두 0행**. 즉 약효군 명사는 이 마스터에서 경계일치가 성립하지 않는다 —
//   기계적 신호 하나로 충분했고, 손으로 적은 사전은 근거 없이 늘어나기만 한다.
// 실측 효과(같은 DB · 일반 명사 44종 / 정상 약명 32종): 일반 명사 EXACT 1→0 · 정상 약명 판정률 불변.
// ─────────────────────────────────────────────────────────────────────────────

/** 단어 문자 — 이 문자 뒤에 이어지는 부분일치는 **다른 낱말의 일부**다(경계가 아니다) */
const WORD_CHAR_RE = /[A-Za-z0-9ㄱ-ㆎ가-힣]/;

/** 질의가 텍스트 안에서 토큰 경계에서 시작하는가(대소문자 무시) */
export function matchesAtTokenBoundary(query: string, text: string | null | undefined): boolean {
  const needle = String(query ?? '').trim().toLowerCase();
  const hay = String(text ?? '').toLowerCase();
  if (!needle || !hay) return false;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    if (i === 0 || !WORD_CHAR_RE.test(hay[i - 1])) return true;
  }
  return false;
}

/** 질의가 이 후보와 **의미 있게** 일치하는가 — 제품명(한/영)·성분 표기의 토큰 경계 또는 코드 접두 */
export function queryMatchesRow(
  query: string,
  row: { code?: string | null; nameKo?: string | null; nameEn?: string | null; ingredient?: string | null },
): boolean {
  const q = String(query ?? '').trim();
  if (!q) return false;
  if (String(row.code ?? '').toUpperCase().startsWith(q.toUpperCase())) return true;
  return matchesAtTokenBoundary(q, row.nameKo) || matchesAtTokenBoundary(q, row.nameEn) || matchesAtTokenBoundary(q, row.ingredient);
}

/**
 * 약가마스터 정본 검색으로 약명을 특정한다. 활성 코드만.
 *   · 정확히 1건 → ONE
 *   · 여러 건인데 nameKo/nameEn 이 질의와 **정확히 같은** 코드가 1건 → ONE(동명 상품이 여럿이면 아래로)
 *   · 여러 건인데 **주성분 키가 하나뿐**(전 후보가 같은 성분) → INGREDIENT_GROUP + 대표(code 최소·결정론)
 *   · 성분이 2종 이상이거나 성분 정보 없는 후보가 섞이면 → MANY(성분 몇 종인지 동봉 — 판정하지 않는다)
 *   · 후보가 상한(CANDIDATE_TAKE)에 닿으면 전체를 못 본 것이므로 성분 대표 판정을 하지 않는다 → MANY(truncated)
 *   · 0건 → NONE
 *
 * 🔴 성분명 질의(운영에서 거의 전부)가 종전엔 전량 MANY→UNRESOLVED 였다. 성분이 같으면 DUR 판정(상호작용·중복·
 *    알레르기·연령)은 제품이 달라도 같은 결론이 나온다 — 다만 **함량·제형은 다르다**. 그래서 판정은 하되
 *    "성분 대표 판정"이라고 근거에 못 박고, 함량 확정은 처방 폼으로 미룬다.
 */
/**
 * **성분(INN) 경로** — 기획서 §1.5 후속 선택지 1. LLM 이 제품명 대신 성분명을 내면 이 경로로 특정한다.
 *
 * 왜 이름 검색과 다른 자를 써야 하는가(운영 실측 2026-08-20):
 *   · 이름 검색(`buildMedicationSearchWhere`)은 nameKo/nameEn/ingredient/code 를 OR 로 훑어 **복합제를 대량으로**
 *     끌어온다 — `q=암로디핀` 후보 100건에 성분 56종. 그래서 "전 후보가 같은 성분"이 성립하지 않았다(0/10).
 *   · 여기서는 성분 필드만 좁혀 조회한 뒤, **행마다** "이 제품의 활성 본체가 요청한 INN 하나뿐인가"를 검증한다.
 *
 * 🔴 상한(CANDIDATE_TAKE)의 뜻이 이름 경로와 반대다. 이름 경로는 "전 후보가 같은 성분"이라는 **소진 논증**이라
 *    절단되면 판정을 포기해야 한다. 이 경로는 행별 검증이라 절단돼도 **틀리지 않는다** — `code asc` 로 정렬해
 *    앞에서부터 읽으므로 창 안의 첫 적중이 곧 전체 최소 code 다(대표가 흔들리지 않는다).
 *    실측 근거: 활성 단일제 성분 1,270종에 대해 code 오름차순 창에서 첫 적중 순위 중앙 1 · p95 5 · p99 38 ·
 *    최대 431 — **200 초과는 3종(0.24%)**. 그 3종은 창 안에 적중이 없어 UNRESOLVED 로 접힌다(안전측).
 *    상한을 바꾸려면 이 분포를 다시 재고 바꾼다.
 */
export async function resolveByIngredient(prisma: MedicationCodeLookup, ingredientName: string): Promise<ResolvedMedication | null> {
  const inn = normalizeInnQuery(ingredientName);
  // 2글자 이하는 성분명으로 보지 않는다(`B`·`철` 같은 토큰이 마스터 전체를 긁는다)
  if (inn.length < 3) return null;
  const rows = await prisma.medicationCode.findMany({
    where: { isActive: true, ingredient: { contains: inn, mode: 'insensitive' } },
    // 🔴 이름 경로의 nameKo asc 가 아니라 code asc — 대표(최소 code)를 절단 아래에서도 결정론적으로 얻기 위해서다
    orderBy: [{ code: 'asc' }],
    take: CANDIDATE_TAKE,
    select: { id: true, code: true, nameKo: true, nameEn: true, ingredient: true, ingredientCode: true },
  });
  // contains 가 0건이면 startsWith 도 0건이다(부분집합) — 2차 조회를 낭비하지 않는다
  if (rows.length === 0) return null;
  // 단일제이면서 활성 본체가 요청 INN 과 정확히 같은 행만 — 복합제는 여기서 전부 탈락한다
  const hits = rows.filter((r) => productIngredientKey(r) === inn);
  if (hits.length > 0) return groupOf(hits, inn, inn, rows.length >= CANDIDATE_TAKE);

  // ── 2차: 에스터·프로드러그 접미 ────────────────────────────────────────────
  // 🔴 INN 이 `olmesartan` 인데 마스터는 `olmesartan medoxomil` 로만 존재한다(실측: 단일제 표기 1종).
  //    이런 접미는 **염이 아니다** — 벗겨서 한 성분으로 접으면 안 되는 경우가 있다:
  //    `tenofovir` 는 `tenofovir alafenamide` 와 `tenofovir disoproxil` 로 갈리는데 둘은 다른 약이다.
  //    그래서 사전으로 벗기지 않고 **데이터에 물어본다** — 접미가 붙은 활성 본체가 **딱 하나뿐일 때만** 특정한다.
  //    조회는 `startsWith`(성분 표기는 활성 본체로 시작한다)라 창이 작다(실측: olmesartan 299→92 · candesartan 145→128).
  const pre = await prisma.medicationCode.findMany({
    where: { isActive: true, ingredient: { startsWith: inn, mode: 'insensitive' } },
    orderBy: [{ code: 'asc' }],
    take: CANDIDATE_TAKE,
    select: { id: true, code: true, nameKo: true, nameEn: true, ingredient: true, ingredientCode: true },
  });
  if (pre.length === 0 || pre.length >= CANDIDATE_TAKE) return null; // 절단되면 "하나뿐"을 논증할 수 없다
  // 🔴 **단일제만** 본다. 복합제 키는 정렬·결합(`a+b`)이라 `olmesartan medoxomil+rosuvastatin` 처럼
  //    `${inn} ` 로 시작해 버릴 수 있다 — 그대로 두면 복합제가 성분 대표로 새어 들어온다(실측으로 잡았다).
  const derived = pre
    .map((r) => ({ row: r, moieties: ingredientMoieties(r.ingredient), key: productIngredientKey(r) }))
    .filter((x): x is { row: typeof pre[number]; moieties: string[]; key: string } =>
      !!x.key && x.moieties?.length === 1 && x.key.startsWith(`${inn} `));
  const bases = [...new Set(derived.map((d) => d.key))];
  if (bases.length !== 1) return null; // 0종(없다) 또는 2종 이상(어느 쪽인지 모른다) → 특정하지 않는다
  return groupOf(derived.map((d) => d.row), bases[0], inn, false);
}

/** 성분 후보 묶음 → 대표(code asc 정렬의 첫 건 = 최소 code) */
function groupOf(
  hits: Array<{ id: string; code: string; nameKo: string }>,
  ingredientLabel: string, query: string, scanTruncated: boolean,
): ResolvedMedication {
  const rep = hits[0];
  if (hits.length === 1 && !scanTruncated) {
    return { status: 'ONE', id: rep.id, code: rep.code, nameKo: rep.nameKo, query, via: 'INGREDIENT' };
  }
  return {
    status: 'INGREDIENT_GROUP', id: rep.id, code: rep.code, nameKo: rep.nameKo,
    ingredientKey: `I:${ingredientLabel}`, ingredientLabel, count: hits.length, query,
    via: 'INGREDIENT', scanTruncated,
  };
}

/**
 * @param ingredientHint LLM 이 낸 성분명(영문 INN). 있으면 **성분 경로를 먼저** 탄다(§1.5 후속 선택지 1).
 *        못 맞히면 조용히 이름 경로로 내려간다 — 힌트가 틀렸다고 추천을 버리지 않는다.
 */
export async function resolveMedicationCode(prisma: MedicationCodeLookup, name: string, ingredientHint?: string | null): Promise<ResolvedMedication> {
  if (ingredientHint) {
    const byIng = await resolveByIngredient(prisma, ingredientHint);
    if (byIng) return byIng;
  }
  // 힌트가 없거나 빗나갔으면 약명 자체가 성분명일 수 있다(LLM 이 `metformin` 을 name 에 적는 경우)
  if (!ingredientHint || normalizeInnQuery(ingredientHint) !== normalizeInnQuery(name)) {
    const byName = await resolveByIngredient(prisma, name);
    if (byName) return byName;
  }
  /** 후보는 나왔지만 **의미 있는 일치가 하나도 없던** 첫 질의(= 약효군·일반 명사 신호). 원문에 가장 가까운 질의를 남긴다 */
  let loose: { query: string; count: number } | null = null;
  for (const q of medicationQueryCandidates(name)) {
    const rows = await prisma.medicationCode.findMany({
      where: { ...buildMedicationSearchWhere(q), isActive: true },
      orderBy: MEDICATION_SEARCH_ORDER,
      take: CANDIDATE_TAKE,
      select: { id: true, code: true, nameKo: true, nameEn: true, ingredient: true, ingredientCode: true },
    });
    if (rows.length === 0) continue;
    // 🔴 승격 전에 "의미 있게 일치하는가"를 먼저 묻는다(§의미 일치). 부분 문자열로만 겹치면 **특정하지 않는다** —
    //    후보 1건이어도 그렇다. 다음 질의로 넘어가고, 끝까지 없으면 NONE(사유 동봉).
    const relevant = rows.filter((r) => queryMatchesRow(q, r));
    if (relevant.length === 0) { loose = loose ?? { query: q, count: rows.length }; continue; }
    if (rows.length === 1) return { status: 'ONE', id: rows[0].id, code: rows[0].code, nameKo: rows[0].nameKo, query: q };
    const ql = q.toLowerCase();
    const exact = rows.filter((r) => r.nameKo?.toLowerCase() === ql || r.nameEn?.toLowerCase() === ql);
    if (exact.length === 1) return { status: 'ONE', id: exact[0].id, code: exact[0].code, nameKo: exact[0].nameKo, query: q };

    const keyed = rows.map((r) => ({ row: r, ...ingredientKeyOf(r) }));
    const unknownIngredient = keyed.some((k) => !k.key);
    const keys = [...new Set(keyed.filter((k) => k.key).map((k) => k.key))];
    const labels = [...new Set(keyed.filter((k) => k.key).map((k) => k.label))];
    const truncated = rows.length >= CANDIDATE_TAKE;
    // 대표는 code 최소 — 같은 입력에 같은 대표가 나오도록(비결정적 첫 건 잡기 금지)
    const rep = [...rows].sort((a, b) => String(a.code).localeCompare(String(b.code)))[0];
    // 🔴 대표로 DUR 을 돌릴 것이므로 **대표 자신이** 질의와 의미 있게 일치해야 한다.
    //    그룹 안 아무 후보 하나가 걸린 것으로는 부족하다(엉뚱한 제품에 판정이 붙는다).
    const repIrrelevant = !queryMatchesRow(q, rep);
    if (!unknownIngredient && !truncated && keys.length === 1 && !repIrrelevant) {
      return {
        status: 'INGREDIENT_GROUP', id: rep.id, code: rep.code, nameKo: rep.nameKo,
        ingredientKey: keys[0], ingredientLabel: labels[0] ?? '', count: rows.length, query: q,
      };
    }
    return {
      status: 'MANY', count: rows.length, query: q, distinctIngredients: keys.length,
      ingredientLabels: labels.slice(0, 5), unknownIngredient, truncated,
      ...(keys.length === 1 && !unknownIngredient && !truncated && repIrrelevant ? { repIrrelevant: true } : {}),
    };
  }
  return loose
    ? { status: 'NONE', reason: 'NO_MEANINGFUL_MATCH', looseCount: loose.count, query: loose.query }
    : { status: 'NONE', reason: 'NO_CANDIDATE' };
}

/** 정본 DurWarning 심각도 → 판정. ERROR/BLOCK/CONTRAINDICATED 하나라도 있으면 BLOCK, WARNING 있으면 WARNING, 없으면 PASS(INFO 만이면 PASS) */
export function verdictFromWarnings(warnings: ReadonlyArray<{ severity: string }>): Exclude<DurVerdict, 'UNRESOLVED'> {
  const sev = warnings.map((w) => String(w.severity ?? '').toUpperCase());
  if (sev.some((s) => s === 'ERROR' || s === 'BLOCK' || s === 'CONTRAINDICATED')) return 'BLOCK';
  if (sev.some((s) => s === 'WARNING')) return 'WARNING';
  return 'PASS';
}

export function trimWarnings(warnings: ReadonlyArray<DurWarning>): DurWarningTrimmed[] {
  return warnings.map((w) => ({ type: String(w.type), severity: String(w.severity), message: String(w.message ?? '') }));
}

/**
 * DUR 가 볼 진료(encounter) 를 정한다 — 입력 encounterId > 환자의 최근 진료 > ZERO_UUID.
 * ZERO_UUID 면 `encounter.findUnique` 가 null 이라 **임신 여부·현 진료 처방 점검이 생략**된다 — basis 에 그렇게 적는다.
 */
export async function resolveEncounterForDur(prisma: EncounterLookup, patientId: string, encounterId?: string | null): Promise<{ encounterId: string; note: string | null }> {
  if (encounterId) return { encounterId, note: null };
  // 🔴 (2026-09-15) 종전 `.catch(() => null)` — 조회 **실패**를 '진료 미특정'(진료가 없다)으로 말했다. 점검 생략은 같지만 이유가 다르다.
  let latest: { id: string } | null;
  try {
    latest = await prisma.encounter.findFirst({ where: { patientId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  } catch {
    return { encounterId: ZERO_UUID, note: '최근 진료 조회 실패 — 임신 여부·현 진료 처방 점검 생략' };
  }
  if (latest?.id) return { encounterId: latest.id, note: '최근 진료 기준' };
  return { encounterId: ZERO_UUID, note: '진료 미특정 — 임신 여부·현 진료 처방 점검 생략' };
}

/**
 * 추천 1건의 판정. 실패는 실패라고 말한다(`durVerdict: null` + '재검증 실패: …') — PASS 로 접지 않는다.
 */
export async function verdictForRecommendation(
  deps: { prisma: MedicationCodeLookup; dur: DurChecker | null | undefined },
  input: { name: string; ingredient?: string | null; dosage?: string | null; patientId: string; encounterId: string; encounterNote?: string | null },
): Promise<DrugVerdictResult> {
  if (!deps.dur) return { durVerdict: null, durVerdictBasis: '재검증 실패: DUR 서비스 미주입', durWarnings: [] };
  let resolution: DrugResolution | undefined;
  try {
    const resolved = await resolveMedicationCode(deps.prisma, input.name, input.ingredient);
    if (resolved.status === 'NONE') {
      // 🔴 왜 특정하지 못했는지를 사람이 읽을 수 있게 남긴다 — 화면(툴팁)이 이 문장을 그대로 보여준다.
      //    "0건"과 "부분 문자열로만 겹친다(약효군·일반 명사)"는 서로 다른 사실이다.
      const basis = resolved.reason === 'NO_MEANINGFUL_MATCH'
        // 🔴 조사(이/가·은/는)를 변수 뒤에 붙이지 않는다 — 질의는 괄호 안에 둔다(조사 깨짐 이력 v3.95)
        ? `약효군·일반 명사로 보여 특정하지 않음 — 후보 ${resolved.looseCount}건이 있으나 제품명·성분 어느 쪽과도 의미 있게 일치하지 않음(질의 '${resolved.query}' · 부분 문자열만 겹침) — 처방 폼에서 특정`
        : `약가마스터 미매칭('${input.name}') — 처방 폼에서 특정`;
      return { durVerdict: 'UNRESOLVED', durVerdictBasis: basis, durWarnings: [], resolution: 'NONE' };
    }
    if (resolved.status === 'MANY') {
      // 🔴 성분이 갈라지면 판정하지 않는다 — 아무 후보나 잡아 PASS 를 만들지 않는다. 몇 종인지 말한다.
      const why = resolved.repIrrelevant
        // 성분은 하나로 모였지만 대표가 질의와 의미 있게 일치하지 않는다 — 엉뚱한 제품에 판정을 붙이지 않는다
        ? `후보 ${resolved.count}건(성분 1종) — 대표 품목이 질의와 의미 있게 일치하지 않아 성분 대표 판정 보류`
        : resolved.truncated
          ? `후보 ${resolved.count}건 이상 — 전체를 보지 못해 성분 동일 여부 확인 불가`
          : resolved.unknownIngredient
            ? `후보 ${resolved.count}건 — 주성분 정보 없는 후보가 있어 성분 대표 판정 불가`
            : `후보 ${resolved.count}건 — 서로 다른 성분 ${resolved.distinctIngredients}종(${resolved.ingredientLabels.join(', ')})`;
      return { durVerdict: 'UNRESOLVED', durVerdictBasis: `${why}('${resolved.query}') — 처방 폼에서 특정`, durWarnings: [], resolution: 'AMBIGUOUS' };
    }
    resolution = resolved.status === 'INGREDIENT_GROUP' ? 'INGREDIENT_GROUP' : 'EXACT';
    const warnings = await deps.dur.checkInteractions(input.encounterId, resolved.id, input.patientId, { dosage: input.dosage ?? null });
    const verdict = verdictFromWarnings(warnings);
    const counts = { ERROR: 0, WARNING: 0, INFO: 0 } as Record<string, number>;
    for (const w of warnings) counts[String(w.severity).toUpperCase()] = (counts[String(w.severity).toUpperCase()] ?? 0) + 1;
    const countText = warnings.length ? `경고 ${warnings.length}건(ERROR ${counts.ERROR ?? 0}·WARNING ${counts.WARNING ?? 0}·INFO ${counts.INFO ?? 0})` : '경고 0건';
    // 🔴 자르면 잘랐다고 말한다 — 성분 경로에서 조회 창이 가득 찼으면 후보 수가 하한이라는 뜻이다(대표는 그래도 결정론적)
    const countQualifier = resolved.status === 'INGREDIENT_GROUP' && resolved.scanTruncated ? '건 이상(조회 창 절단)' : '건';
    const head = resolved.status === 'INGREDIENT_GROUP'
      ? resolved.via === 'INGREDIENT'
        ? `성분 '${resolved.ingredientLabel}' 단일제 ${resolved.count}${countQualifier} 대표 판정(대표 ${resolved.code} ${resolved.nameKo}) — 복합제 제외 · 제품별 함량·제형 차이는 처방 폼에서 확정`
        : `성분 동일 후보 ${resolved.count}건 대표 판정(주성분 ${resolved.ingredientLabel} · 대표 ${resolved.code} ${resolved.nameKo}) — 제품별 함량·제형 차이는 처방 폼에서 확정`
      : resolved.via === 'INGREDIENT'
        ? `DUR 정본 ${resolved.code} ${resolved.nameKo}(성분 '${resolved.query}' 단일제 1건)`
        : `DUR 정본 ${resolved.code} ${resolved.nameKo}`;
    const basis = [head, countText, input.encounterNote].filter(Boolean).join(' · ');
    return { durVerdict: verdict, durVerdictBasis: basis, durWarnings: trimWarnings(warnings), medicationCodeId: resolved.id, resolvedName: resolved.nameKo, resolution };
  } catch (e) {
    // 🔴 판정 실패 — 어디까지 갔는지는 알면 남기고(resolution), 모르면 비운다. PASS 로 접지 않는다.
    return { durVerdict: null, durVerdictBasis: `재검증 실패: ${e instanceof Error ? e.message : String(e)}`, durWarnings: [], ...(resolution ? { resolution } : {}) };
  }
}
