/**
 * 질 지표 판정 정본 (Quality Indicator Policy)
 *
 * 🔴 원래 결함(P12 — 같은 사실에 정본이 셋): "목표 달성/미달" 하나를 만드는 규칙이 세 벌이었고
 *    방향이 서로 반대였다.
 *      - `prisma/seed.ts`  : 지표명 키워드로 lowerIsBetter 추정 — 키워드에 '폐렴'이 없어
 *                            인공호흡기 관련 폐렴 발생률 1.51(목표 2.0)이 빨간 '✗ 미달'로 표시됐다.
 *      - `QualityService.addMeasurement` : `value >= target` — **전 지표를 '높을수록 좋음'으로 단정**.
 *                            API 로 새 측정값을 넣으면 낙상·투약오류·감염률이 좋아질수록 '미달'로 뒤집혔다.
 *      - `web/(main)/quality/page.tsx` 폴백 : `latestValue <= target` — **전 지표를 '낮을수록 좋음'으로 단정**.
 *    이제 판정은 이 파일 하나에서만 나온다. FE 는 서버가 낸 판정을 그대로 쓴다.
 *
 * ── 우선순위 (2026-08-18 · DB 컬럼 도입) ────────────────────────────────
 * `QualityIndicator` 에 `direction` / `unit` / `valueScale` 컬럼이 생겼다. 같은 사실에 정본이 둘이
 * 되지 않도록 **순서를 여기 한 곳에 못박는다**:
 *
 *   ① **DB 컬럼**(`indicator.direction` / `unit` / `valueScale`) — 관리자가 화면에서 등재한 것. **최우선**.
 *   ② **코드 등재표**(이 파일의 `DIRECTION_BY_NAME`) 와 `formula` 파싱 — 컬럼이 비어 있을 때만.
 *   ③ 그래도 모르면 **미등재**(direction=null → 판정 불가 · unit=null → 단위 없음).
 *
 * 🔴 ①이 ②를 **항상** 이긴다. 둘이 어긋나면 컬럼을 따르되 `directionConflict: true` 로 드러낸다
 *    (조용히 한쪽을 지우면 P12 — 같은 사실에 정본이 둘 — 이 다시 생긴다).
 * 🔴 읽기는 관대하게(`LOWER_BETTER` 같은 표기도 받는다) · 쓰기는 정본 하나로(`*_IS_BETTER`).
 * 🔴 어느 층에서도 확정할 수 없으면 **추정하지 않고 null** 을 낸다 — 모르는 것을 아는 척하지 않는다.
 *    특히 방향 미상은 '미달'도 '달성'도 아니다(measurement.meetTarget = null 로 저장된다).
 */

import { roundBy } from '@hospital-run/shared';

export type IndicatorDirection = 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER';

/** 공백·전각공백 제거 — DB 실값('감염관리')과 문서 표기('감염 관리')가 갈리는 것을 흡수한다. */
export function normalizeIndicatorKey(s: string): string {
  return (s ?? '').replace(/[\s　]+/g, '');
}

/**
 * 지표 방향 등재표 — 지표명(공백 제거) 기준.
 * 🔴 키워드 추정보다 **등재**가 먼저다. 키워드만 쓰면 '폐렴' 같은 누락 하나가 임상 지표를 뒤집는다.
 */
const DIRECTION_BY_NAME: Record<string, IndicatorDirection> = {
  // ── 환자안전 ──
  '30일내재입원율': 'LOWER_IS_BETTER',
  '병원감염발생률': 'LOWER_IS_BETTER',
  '낙상발생률': 'LOWER_IS_BETTER',
  '투약오류발생률': 'LOWER_IS_BETTER',
  '수술부위감염률': 'LOWER_IS_BETTER',
  '욕창발생률': 'LOWER_IS_BETTER',
  '수혈부작용발생률': 'LOWER_IS_BETTER',
  // ── 진료 성과 ──
  '환자만족도': 'HIGHER_IS_BETTER',
  '응급실체류시간(중증)': 'LOWER_IS_BETTER',
  '평균재원일수': 'LOWER_IS_BETTER',
  '수술사망률': 'LOWER_IS_BETTER',
  '외래초진대기시간': 'LOWER_IS_BETTER',
  // ── 진료 효율 ──
  '병상가동률': 'HIGHER_IS_BETTER',
  '수술실가동률': 'HIGHER_IS_BETTER',
  '검사결과보고시간': 'LOWER_IS_BETTER',
  '처방전달시간': 'LOWER_IS_BETTER',
  // ── 감염관리 ──
  '손위생수행률': 'HIGHER_IS_BETTER',
  '중심정맥관관련혈류감염률': 'LOWER_IS_BETTER',
  '요로감염발생률(도뇨관)': 'LOWER_IS_BETTER',
  '인공호흡기관련폐렴발생률': 'LOWER_IS_BETTER', // 🔴 seed 키워드 목록에 '폐렴'이 없어 뒤집혀 있던 지표
  // ── 경영 ──
  '직원이직률': 'LOWER_IS_BETTER',
  '의료수익대비인건비율': 'LOWER_IS_BETTER',
  '필수교육이수율': 'HIGHER_IS_BETTER',
  '환자불만건수': 'LOWER_IS_BETTER',
  '진료비청구반송률': 'LOWER_IS_BETTER',
  // ── CPOE(처방·오더 원장 산출 — shared `CPOE_QI_DEFS.qiName`) · 2026-10-07 ──
  // 🔴 방향이 임상적으로 분명한 것만 등재한다. 경고 발생률·무시율·구두 처방 비율·취소율·STAT 비율·중재 수락률은
  //    높고 낮음이 좋고 나쁨을 바로 말하지 않는 관찰 지표다 — 등재하지 않는다(위원회가 원장에서 정한다).
  'CPOEDUR점검수행률': 'HIGHER_IS_BETTER',
  'CPOEDUR무시사유미기록률': 'LOWER_IS_BETTER',
  'CPOE구두처방복창확인미기록률': 'LOWER_IS_BETTER',
  'CPOE구두처방서명미완료율': 'LOWER_IS_BETTER',
  'CPOE처방상병미연결률': 'LOWER_IS_BETTER',
  'CPOE처방중단사유미기록률': 'LOWER_IS_BETTER',
  'CPOE검사결과미확인률': 'LOWER_IS_BETTER',
  'CPOE검체채취시각기록률': 'HIGHER_IS_BETTER',
  'CPOE위급값미확인률': 'LOWER_IS_BETTER',
  'CPOE위급값복창확인미기록률': 'LOWER_IS_BETTER',
  'CPOE약사중재미응답률': 'LOWER_IS_BETTER',
  'CPOECDSS무시사유미기록률': 'LOWER_IS_BETTER',
};

/** 등재에 없는 신규 지표를 위한 보조 신호 — 양쪽이 다 잡히거나 하나도 안 잡히면 판정하지 않는다. */
const LOWER_HINTS = [
  '재입원', '감염', '폐렴', '패혈', '낙상', '욕창', '오류', '사고', '사망', '부작용', '합병증',
  '대기시간', '체류시간', '보고시간', '전달시간', '소요시간', '재원일수', '이직', '인건비',
  '불만', '반송', '지연', '재수술', '재검', '취소율', '결손', '이탈',
];
const HIGHER_HINTS = [
  '준수율', '수행률', '이수율', '만족도', '가동률', '시행률', '성공률', '완료율', '달성률',
  '충족률', '응답률', '참여율', '일치율', '정확도', '적정처방률',
];

/**
 * DB 컬럼(자유 문자열 VarChar(20)) → 정본 enum.
 *
 * 🔴 **저장 정본은 `LOWER_IS_BETTER` / `HIGHER_IS_BETTER` 하나**다(코드·DTO·화면이 쓰는 값).
 *    다만 스키마 주석·외부 유입은 `LOWER_BETTER`/`higher-is-better` 처럼 적혀 올 수 있어
 *    **읽을 때만** 흡수한다. 해석되지 않는 문자열은 **미등재로 취급**한다 —
 *    오타를 방향으로 지어내면 임상 지표가 통째로 뒤집힌다.
 */
export function normalizeIndicatorDirection(raw?: string | null): IndicatorDirection | null {
  const v = (raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!v) return null;
  if (v === 'LOWER_IS_BETTER' || v === 'LOWER_BETTER' || v === 'LOWER') return 'LOWER_IS_BETTER';
  if (v === 'HIGHER_IS_BETTER' || v === 'HIGHER_BETTER' || v === 'HIGHER') return 'HIGHER_IS_BETTER';
  return null; // 모르는 표기 = 모른다
}

/** 방향이 **어디서 왔는지**. COLUMN=관리자 등재(최우선) · REGISTRY=코드 등재표 · HINT=이름 보조신호 */
export type IndicatorDirectionSource = 'COLUMN' | 'REGISTRY' | 'HINT';

/**
 * 코드 층(②)의 방향 — 등재표 → 보조 신호 → null. **DB 컬럼이 있으면 이 함수는 쓰이지 않는다.**
 */
export function resolveRegistryDirection(name: string): {
  direction: IndicatorDirection | null;
  source: IndicatorDirectionSource | null;
} {
  const key = normalizeIndicatorKey(name);
  if (!key) return { direction: null, source: null };
  const registered = DIRECTION_BY_NAME[key];
  if (registered) return { direction: registered, source: 'REGISTRY' };

  const lower = LOWER_HINTS.some((h) => key.includes(h));
  const higher = HIGHER_HINTS.some((h) => key.includes(h));
  if (lower === higher) return { direction: null, source: null }; // 둘 다이거나 둘 다 아니면 = 모른다
  return { direction: lower ? 'LOWER_IS_BETTER' : 'HIGHER_IS_BETTER', source: 'HINT' };
}

/**
 * 지표 방향 판정(코드 층만) — 등재표 → 보조 신호 → null.
 * 🔴 DB 컬럼을 함께 보려면 `resolveIndicatorPolicy(indicator)` 를 쓴다. 이 함수만 부르면
 *    관리자가 화면에서 등재한 방향을 놓친다.
 * @returns 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER' | null(판정 불가 — 달성 여부를 만들지 않는다)
 */
export function resolveIndicatorDirection(name: string, _category?: string | null): IndicatorDirection | null {
  return resolveRegistryDirection(name).direction;
}

/**
 * 목표 달성 판정 — **유일한 정본**.
 * @returns boolean | null(방향 미상 → 판정 불가). null 을 false 로 뭉개지 말 것.
 */
export function evaluateMeetTarget(
  value: number | null | undefined,
  target: number | null | undefined,
  direction: IndicatorDirection | null,
): boolean | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (target == null || !Number.isFinite(target)) return null;
  if (!direction) return null;
  return direction === 'LOWER_IS_BETTER' ? value <= target : value >= target;
}

/**
 * 목표 대비 달성률(진행바용) — 방향을 반영한다.
 *
 * 🔴 원래 결함: 화면 진행바가 `value / target * 100` 이라 '낮을수록 좋은' 지표에서 반대로 찼다
 *    (낙상이 나빠질수록 초록 막대가 길어졌다).
 * @returns 0~100 | null(방향·목표 미상 → 막대를 그리지 않는다)
 */
export function achievementPercent(
  value: number | null | undefined,
  target: number | null | undefined,
  direction: IndicatorDirection | null,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (target == null || !Number.isFinite(target)) return null;
  if (!direction) return null;
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  if (direction === 'HIGHER_IS_BETTER') {
    if (target <= 0) return value >= target ? 100 : 0;
    return clamp((value / target) * 100);
  }
  // 낮을수록 좋음 — 목표 이하면 100%, 넘으면 초과분만큼 줄어든다
  if (value <= target) return 100;
  if (value <= 0) return 100;
  return clamp((target / value) * 100);
}

/**
 * 표시 단위 — formula 문자열에 **적힌 것만** 읽는다(추정 금지).
 *
 * 🔴 원래 결함: `QualityIndicator` 에 unit 컬럼이 없는데 화면이 `q.unit ?? '%'` 로 폴백해
 *    25지표 전부에 `%` 를 붙였다 — 평균 재원일수 목표 "7%"(일)·외래 초진 대기시간 "30%"(분)·
 *    환자 불만 "5%"(건)·VAP "2%"(건/1000 인공호흡기 유치일수).
 * @returns 단위 문자열 | null(모르면 단위를 붙이지 않는다)
 */
export function resolveIndicatorUnit(formula?: string | null): string | null {
  const f = (formula ?? '').trim();
  if (!f) return null;

  if (/\(\s*\d+\s*점\s*만점\s*\)/.test(f) || /점수/.test(f)) return '점';
  if (/\(\s*분\s*\)/.test(f)) return '분';
  if (/\(\s*시간\s*\)/.test(f)) return '시간';
  if (/\(\s*일\s*\)/.test(f)) return '일';

  // (분자 / 분모) × 1000 — 분모를 그대로 읽어 '건/1000 <분모>' 로 적는다(‰ 로 뭉개지 않는다)
  const per1000 = f.match(/\/\s*([^()]+?)\s*\)\s*[×xX*]\s*1000\b/);
  if (per1000) return `건/1000 ${per1000[1].trim()}`;
  if (/[×xX*]\s*1000\b/.test(f)) return null; // 배율은 알지만 분모를 못 읽으면 단위를 만들지 않는다

  if (/[×xX*]\s*100\b/.test(f)) return '%';

  // 연산자 없는 형태 — 단순 건수 / 일수 비
  if (!f.includes('/')) return /건수\s*$/.test(f) ? '건' : null;
  const numerator = f.split('/')[0].replace(/[()]/g, '').trim();
  if (/일수$/.test(numerator)) return '일';
  return null;
}

/**
 * 측정값 배율 — `(분자/분모) × N` 의 N. formula 에 적힌 것만 읽는다.
 *
 * 🔴 원래 결함: `addMeasurement` 가 지표와 무관하게 항상 `× 100` 이었다. '월간 환자 불만 접수 건수'
 *    7건이 700 으로, `× 1000` 지표(낙상·감염)는 1/10 로 기록됐다.
 * @returns 배율 | null(힌트 없음)
 */
export function resolveValueScale(formula?: string | null): number | null {
  const f = (formula ?? '').trim();
  if (!f) return null;
  if (/[×xX*]\s*1000\b/.test(f)) return 1000;
  if (/[×xX*]\s*100\b/.test(f)) return 100;
  // 평균(시간·점수)·비율(분자/분모)·단순 건수 — 배율 없음
  if (/평균/.test(f) || f.includes('/') || /건수\s*$/.test(f) || /점수/.test(f)) return 1;
  return null;
}

/**
 * 🔴 formula 에도 컬럼에도 배율 힌트가 없을 때의 가정. 종전 동작(백분율)을 유지하되
 *    **가정임을 남긴다**(`valueScaleKnown: false` · `valueScaleSource: 'ASSUMED'`).
 *    확정하려면 관리자가 `valueScale` 컬럼을 등재한다.
 */
export const DEFAULT_VALUE_SCALE = 100;

/** 컬럼에 적힌 배율이 쓸 수 있는 값인가 — 0·음수·소수는 배율이 아니다(무시하고 아래 층으로 내려간다). */
function usableScale(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** 지표 1건에 붙는 파생 메타 — 서버가 계산해 내려주고 FE 는 재계산하지 않는다. */
export interface IndicatorPolicyMeta {
  /** 판정에 쓰는 방향(①→②→null) */
  direction: IndicatorDirection | null;
  /** 그 방향이 어디서 왔는가 — null 이면 **미등재**(판정 불가) */
  directionSource: IndicatorDirectionSource | null;
  /** 🔴 DB 컬럼과 코드 등재표가 어긋난다 — 컬럼을 따르되 화면이 이 사실을 말해야 한다 */
  directionConflict: boolean;
  unit: string | null;
  unitSource: 'COLUMN' | 'FORMULA' | null;
  valueScale: number;
  /** 배율이 컬럼/ formula 에서 확정됐는지 — false 면 백분율 가정 */
  valueScaleKnown: boolean;
  valueScaleSource: 'COLUMN' | 'FORMULA' | 'ASSUMED';
  /**
   * 관리자가 **컬럼에 등재한 원본 값**(없으면 null). 관리 화면의 편집 폼이 이것을 프리필한다 —
   * `direction`/`unit`/`valueScale` 은 폴백이 섞인 값이라 폼에 그대로 넣으면
   * '등재된 적 없는 값'이 등재된 것처럼 보인다.
   */
  registeredDirection: IndicatorDirection | null;
  registeredUnit: string | null;
  registeredValueScale: number | null;
}

/** 정책 해석 입력 — Prisma `QualityIndicator` 행을 그대로 넘기면 된다. */
export interface IndicatorPolicyInput {
  name: string;
  category?: string | null;
  formula?: string | null;
  /** DB 컬럼(①) — 있으면 코드 등재표(②)를 **이긴다** */
  direction?: string | null;
  unit?: string | null;
  valueScale?: number | null;
}

/**
 * 지표 정책 해석 — **우선순위는 파일 상단 주석 하나에서만 정의된다**.
 * ① DB 컬럼 → ② 코드 등재표/ formula → ③ 미등재(null).
 */
export function resolveIndicatorPolicy(indicator: IndicatorPolicyInput): IndicatorPolicyMeta {
  // ── 방향 ──
  const registeredDirection = normalizeIndicatorDirection(indicator.direction);
  const registry = resolveRegistryDirection(indicator.name);
  const direction = registeredDirection ?? registry.direction;
  const directionSource: IndicatorDirectionSource | null = registeredDirection
    ? 'COLUMN'
    : registry.direction
      ? registry.source
      : null;

  // ── 단위 ──
  const registeredUnit = (indicator.unit ?? '').trim() || null;
  const formulaUnit = resolveIndicatorUnit(indicator.formula);
  const unit = registeredUnit ?? formulaUnit;

  // ── 배율 ──
  const registeredValueScale = usableScale(indicator.valueScale);
  const formulaScale = resolveValueScale(indicator.formula);
  const valueScale = registeredValueScale ?? formulaScale ?? DEFAULT_VALUE_SCALE;

  return {
    direction,
    directionSource,
    // 🔴 컬럼이 코드 등재표와 반대다 — 어느 하나를 조용히 지우지 않고 드러낸다
    directionConflict:
      registeredDirection !== null &&
      registry.source === 'REGISTRY' &&
      registry.direction !== null &&
      registry.direction !== registeredDirection,
    unit,
    unitSource: registeredUnit ? 'COLUMN' : formulaUnit ? 'FORMULA' : null,
    valueScale,
    valueScaleKnown: registeredValueScale !== null || formulaScale !== null,
    valueScaleSource: registeredValueScale !== null ? 'COLUMN' : formulaScale !== null ? 'FORMULA' : 'ASSUMED',
    registeredDirection,
    registeredUnit,
    registeredValueScale,
  };
}

/**
 * 측정값 저장 한계 — `QiMeasurement.value` 는 `Decimal(5, 2)` 다(정수부 3자리 + 소수 2자리).
 *
 * 🔴 한도를 넘으면 Prisma 가 `numeric field overflow` 로 터져 **저장 실패가 500 으로** 나갔다.
 *    화면은 그것을 "알 수 없는 오류"로 밖에 말할 수 없다 — 무엇이 한도인지 알려주고 거절한다.
 *    (한도를 늘리려면 스키마 변경이 필요하다. 여기서 값을 잘라 저장하면 **잘린 줄 모르는 수치**가 남는다.)
 */
export const MEASUREMENT_VALUE_MAX = 999.99;

/** 저장 소수 자릿수 — `Decimal(5, 2)` 의 2. 값 산출·정합 판정이 같은 자릿수를 쓰게 한 곳에 둔다. */
export const MEASUREMENT_VALUE_DECIMALS = 2;

/**
 * 측정값 산출 — **분자/분모 × 배율의 유일한 계산점**.
 *
 * 🔴 종전엔 입력 경로와 정정 경로가 **각자 다른 식**으로 반올림했다(문자열 포맷 vs `roundBy`).
 *    같은 분자·분모가 두 경로에서 다른 값이 될 수 있으면 "정정했더니 값이 달라졌다"가 정상처럼 보인다(P12).
 * @returns 값 | null(분모 0·비유한수 — 0 으로 나눈 수를 지어내지 않는다)
 */
export function computeMeasurementValue(
  numerator: number,
  denominator: number,
  scale: number,
): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !(denominator > 0)) return null;
  if (!Number.isFinite(scale)) return null;
  /**
   * 🔴 반올림은 **정본 `roundBy('qiValue')` 하나**로 한다. `qiValue` 는 shared `NUMERIC_POLICIES` 에
   *    `decimals: 2` 로 등재돼 있어(2026-08-18) 이 호출이 실제로 소수 2자리로 반올림한다
   *    (`roundBy(12.3456,'qiValue') === 12.35` 실측). 저장 컬럼 `Decimal(5,2)` 와 자릿수 일치.
   *    종전엔 미등재라 반올림이 안 됐고 아래에 수동 `Math.round` 보정을 덧대 두었으나(정본을 부르는
   *    모양만 갖춘 코드였다), 등재 후 그 보정은 잉여가 되어 제거했다 — 이제 정본만 부른다.
   */
  const v = roundBy((numerator / denominator) * scale, 'qiValue', { decimals: MEASUREMENT_VALUE_DECIMALS });
  if (v === null || !Number.isFinite(v)) return null;
  return v;
}

/**
 * 저장된 값이 그 행의 분자/분모 × 현재 배율에서 나온 값인가.
 *
 * 🔴 운영 실측(2026-08-18): 측정 300건 중 **273건(91%)** 이 아니다. 시드가 값을 먼저 정하고
 *    분자/분모를 `×100` 가정으로 역산해 넣었기 때문에, `×1000` 지표는 재산출이 **10배**,
 *    배율 1 지표는 **1/100** 이 된다(예: 낙상 0.79 ↔ 68/8550×1000 = 7.95).
 *    → 화면이 분자·분모와 값을 나란히 보여주면 **같은 사실에 정본이 둘**이 된다(P12).
 *      정정 경로가 이 행을 무심코 재산출하면 값이 10배로 튄다 — 서비스가 그 사실을 드러낸다.
 *    (시드 데이터 품질 결함은 코드로 교정하지 않는다 — 방어하고 밝힌다.)
 * @returns true=분자/분모에서 산출된 값 · false=아니다 · null=판정 불가(값 없음·분모 0)
 */
export function valueDerivedFromRatio(
  value: number | null | undefined,
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  scale: number,
): boolean | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (numerator == null || denominator == null) return null;
  const recomputed = computeMeasurementValue(numerator, denominator, scale);
  if (recomputed === null) return null;
  // 소수 2자리 저장분의 반올림 오차만 허용한다(0.01 = 마지막 자리 1)
  return Math.abs(recomputed - value) <= 0.011;
}

/** 달성 판정을 낼 수 없는 이유 — 화면이 "판정 불가"라고 말할 때 **무엇이 없어서인지** 함께 말한다. */
export type UndeterminedReason = 'DIRECTION_NOT_REGISTERED' | 'NO_TARGET' | 'NO_VALUE';

export function undeterminedReason(
  value: number | null | undefined,
  target: number | null | undefined,
  direction: IndicatorDirection | null,
): UndeterminedReason | null {
  if (value == null || !Number.isFinite(value)) return 'NO_VALUE';
  if (target == null || !Number.isFinite(target)) return 'NO_TARGET';
  if (!direction) return 'DIRECTION_NOT_REGISTERED';
  return null;
}

export const UNDETERMINED_REASON_LABEL: Record<UndeterminedReason, string> = {
  DIRECTION_NOT_REGISTERED: '지표 방향(높을수록/낮을수록 좋음) 미등재 — 달성 판정 불가',
  NO_TARGET: '목표값 미등재 — 달성 판정 불가',
  NO_VALUE: '측정값 없음 — 달성 판정 불가',
};
