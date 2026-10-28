/**
 * NEWS2 (National Early Warning Score 2) 채점 정본 — Royal College of Physicians, 2017.
 *
 * 🔴 2026-08-19 수렴 전 실측: 이 병원에 NEWS2 채점판이 **네 벌** 있었다.
 *   ① `PatientSafetyService.calculateNews2` — RCP 정합(SpO₂ Scale 2·단일 3점 규칙 포함). 법정기록 저장 경로.
 *   ② `icu/icu-scores.computeNews2` — Scale 2 없음 · **위험등급 밴드가 달랐다**
 *      (단일 3점 → `MEDIUM`, 총점 1~4 → `LOW_MEDIUM`. RCP 는 각각 LOW_MEDIUM / LOW).
 *      게다가 관측되지 않은 항목을 **빼고 합산**해 부분 점수를 총점처럼 내놓았다.
 *   ③ `workstation/nursing` 의 `calcNEWS2`(FE) — 🔴 **보충산소 2점 항목이 통째로 없다.**
 *      산소를 투여 중인 환자를 서버보다 **2점 낮게** 표시했다.
 *   ④ `clinical-charts/definitions/scoring.ts` 의 NEWS2 표 — 선언형 채점표(수기 작성).
 *
 *   같은 환자·같은 활력에 화면마다 다른 점수와 다른 위험등급이 나왔다(P12).
 *   → 채점은 이 파일 하나로 수렴한다. ④는 표라서 코드로 대체하지 않고 **기계 대조 가드**로 묶는다.
 *
 * 🔴 이 점수 밴드는 국제 표준이라 원내 config(활력 임계 통합)에서 **의도적으로 제외**한다 —
 *    위원회 재량이 아니다. 바꿀 수 있는 것은 대응 절차이지 점수표가 아니다.
 *
 * 🔴 미관측은 0점이 아니다. 7요소가 전부 관측된 경우에만 산출한다(`scoreNews2` 가 `null` 반환).
 *    관측되지 않은 항목을 빼고 더하면 **낮은 총점이 진짜 총점처럼** 보인다(= 조기경보가 조용히 사라진다).
 */

/** ACVPU — A(명료) 외 전부 3점. 'C'(new Confusion)는 NEWS2 2017 개정에서 추가됐다. */
export const ACVPU_VALUES = ['ALERT', 'CONFUSION', 'VOICE', 'PAIN', 'UNRESPONSIVE'] as const;
export type Acvpu = (typeof ACVPU_VALUES)[number];

export type News2RiskLevel = 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH';

export interface News2Input {
  respiratoryRate: number;
  spO2: number;
  /** 보충산소 투여 중 — 🔴 미상을 false 로 가정하지 않는다(2점이 조용히 사라진다) */
  supplementalO2: boolean;
  /** 1=일반, 2=고이산화탄소혈증 위험(COPD 등·목표 88–92%) */
  spO2Scale?: 1 | 2;
  systolicBp: number;
  heartRate: number;
  consciousness: string;
  temperature: number;
}

export interface News2Breakdown {
  rr: number; spo2: number; o2: number; bp: number; hr: number; temp: number; consciousness: number;
}

export interface News2Result {
  totalScore: number;
  riskLevel: News2RiskLevel;
  scoreBreakdown: News2Breakdown;
  /** 단일 항목 3점(RCP 의 red score) — 총점과 무관하게 긴급 검토 대상 */
  hasIndividual3: boolean;
  /** 에스컬레이션 필요 — HIGH·MEDIUM 또는 단일 3점 */
  escalationRequired: boolean;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 의식 어휘 정규화 — 🔴 이 병원에는 의식 어휘가 **두 벌** 있다.
 *   `EarlyWarningScore.consciousness` = ACVPU 2017 — ALERT · CONFUSION · 'VOICE' · PAIN · UNRESPONSIVE
 *   ICU·간호 플로우시트 = 구 AVPU — ALERT · 'VERBAL' · PAIN · UNRESPONSIVE (C 없음)
 * 시드에는 `'Alert'`(대소문자 혼재)와 한글 5단계('명료/기면/혼미/반혼수/혼수')까지 섞여 있다.
 *
 * 🔴 종전 채점은 `c === 'ALERT' ? 0 : 3` 이었다 — **`'명료'`(=명료한 환자)가 3점**을 받고,
 *    `'VERBAL'` 은 의도대로 3점을 받되 그것이 우연이었다. 어휘를 여기서 한 번만 접는다.
 *
 * 🔴 접는 것은 **같은 척도의 다른 표기**뿐이다(구 AVPU·약어·대소문자).
 *    한글 5단계('명료/기면/혼미/반혼수/혼수')는 ACVPU 와 **다른 척도**라 한 칸도 접지 않는다 —
 *    '명료'만 골라 접으면 명료한 환자만 채점되고 기면·혼미 환자는 채점에서 빠져,
 *    보드가 **깨어 있는 환자만 보고 조용해진다**(대칭이 깨진 채로 안전해 보인다).
 *    다른 척도는 통째로 `null`(= NEWS2 산출 불가)이다. 산출 불가는 0점이 아니다.
 */
export function normalizeAcvpu(v: unknown): Acvpu | null {
  if (typeof v !== 'string') return null;
  const k = v.trim().toUpperCase();
  if (!k) return null;
  if (k === 'ALERT' || k === 'A') return 'ALERT';
  if (k === 'CONFUSION' || k === 'CONFUSED' || k === 'C') return 'CONFUSION';
  if (k === 'VOICE' || k === 'VERBAL' || k === 'V') return 'VOICE';
  if (k === 'PAIN' || k === 'P') return 'PAIN';
  if (k === 'UNRESPONSIVE' || k === 'U') return 'UNRESPONSIVE';
  return null;
}

/** ACVPU 로 접을 수 있는 값인가 — 접히지 않는 자유 문자열은 관측으로 인정하지 않는다 */
export function isAcvpuValue(v: unknown): boolean {
  return normalizeAcvpu(v) !== null;
}

/** 7요소가 전부 관측됐는가 — 하나라도 없으면 NEWS2 는 **산출 불가**다(0점이 아니다) */
export function canScoreNews2(m: Partial<News2Input> | null | undefined): boolean {
  if (!m) return false;
  return (
    isNum(m.respiratoryRate) && isNum(m.spO2) && isNum(m.systolicBp) &&
    isNum(m.heartRate) && isNum(m.temperature) &&
    typeof m.supplementalO2 === 'boolean' && isAcvpuValue(m.consciousness)
  );
}

/** 항목별 채점 — RCP 2017 표 그대로. 이 숫자는 여기 말고 어디에도 적지 않는다. */
function scoreRr(rr: number): number {
  return rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3;
}

function scoreSpo2(spO2: number, scale: 1 | 2, supplementalO2: boolean): number {
  if (scale === 2) {
    // Scale 2(목표 88–92%). 🔴 상단(≥93) 가점은 **보충산소 투여 중에만** 적용한다.
    // 실내공기에서 SpO₂ ≥88 은 정상이다 — 상단 밴드를 무조건 적용하면 허위 고위험이 된다.
    if (supplementalO2) {
      return spO2 >= 97 ? 3 : spO2 >= 95 ? 2 : spO2 >= 93 ? 1 : spO2 >= 88 ? 0 : spO2 >= 86 ? 1 : spO2 >= 84 ? 2 : 3;
    }
    return spO2 >= 88 ? 0 : spO2 >= 86 ? 1 : spO2 >= 84 ? 2 : 3;
  }
  return spO2 >= 96 ? 0 : spO2 >= 94 ? 1 : spO2 >= 92 ? 2 : 3;
}

function scoreBp(bp: number): number {
  return bp <= 90 ? 3 : bp <= 100 ? 2 : bp <= 110 ? 1 : bp <= 219 ? 0 : 3;
}

function scoreHr(hr: number): number {
  return hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3;
}

function scoreTemp(t: number): number {
  return t <= 35.0 ? 3 : t <= 36.0 ? 1 : t <= 38.0 ? 0 : t <= 39.0 ? 1 : 2;
}

function scoreConsciousness(c: string): number {
  // 정규화된 값만 들어온다(canScoreNews2 통과 전제). A 외 전부 3점.
  return normalizeAcvpu(c) === 'ALERT' ? 0 : 3;
}

/**
 * 임상 위험등급 — RCP 2017.
 *   총점 0        → LOW      (최소 12시간마다 관찰)
 *   총점 1–4      → LOW      (4–6시간마다 간호사 평가)
 *   단일 항목 3점 → LOW_MEDIUM (총점과 무관 · 병동 의사 긴급 검토)
 *   총점 5–6      → MEDIUM   (신속대응 임계)
 *   총점 ≥7       → HIGH     (긴급 · 중환자 대응)
 * 🔴 순서가 중요하다 — 총점 판정을 단일 3점보다 **먼저** 본다(총점 5인데 3점 항목이 있으면 MEDIUM).
 */
function deriveRiskLevel(totalScore: number, hasIndividual3: boolean): News2RiskLevel {
  if (totalScore >= 7) return 'HIGH';
  if (totalScore >= 5) return 'MEDIUM';
  if (hasIndividual3) return 'LOW_MEDIUM';
  return 'LOW';
}

/**
 * NEWS2 채점 — 7요소가 전부 관측된 경우에만 결과를 낸다.
 * @returns 결과 또는 `null`(산출 불가). 🔴 호출부는 `null` 을 "0점"으로 바꾸지 않는다.
 */
export function scoreNews2(input: Partial<News2Input> | null | undefined): News2Result | null {
  if (!canScoreNews2(input)) return null;
  const m = input as News2Input;
  const scale: 1 | 2 = m.spO2Scale === 2 ? 2 : 1;

  const scoreBreakdown: News2Breakdown = {
    rr: scoreRr(m.respiratoryRate),
    spo2: scoreSpo2(m.spO2, scale, m.supplementalO2),
    o2: m.supplementalO2 ? 2 : 0,
    bp: scoreBp(m.systolicBp),
    hr: scoreHr(m.heartRate),
    temp: scoreTemp(m.temperature),
    consciousness: scoreConsciousness(m.consciousness),
  };

  const totalScore =
    scoreBreakdown.rr + scoreBreakdown.spo2 + scoreBreakdown.o2 + scoreBreakdown.bp +
    scoreBreakdown.hr + scoreBreakdown.temp + scoreBreakdown.consciousness;

  // 🔴 보충산소 2점은 red score 가 아니다(RCP 표에서 최대 2점) — 단일 3점 판정에서 제외한다.
  const hasIndividual3 = [
    scoreBreakdown.rr, scoreBreakdown.spo2, scoreBreakdown.bp,
    scoreBreakdown.hr, scoreBreakdown.temp, scoreBreakdown.consciousness,
  ].some((s) => s === 3);

  const riskLevel = deriveRiskLevel(totalScore, hasIndividual3);

  return {
    totalScore,
    riskLevel,
    scoreBreakdown,
    hasIndividual3,
    escalationRequired: riskLevel === 'HIGH' || riskLevel === 'MEDIUM' || hasIndividual3,
  };
}

/** 위험등급 표시 라벨 — 화면마다 다시 적지 않는다('정상/저위험/중위험/고위험'이 갈라져 있었다) */
export const NEWS2_RISK_LABEL: Record<News2RiskLevel, string> = {
  LOW: '저위험',
  LOW_MEDIUM: '저-중위험',
  MEDIUM: '중위험',
  HIGH: '고위험',
};

/**
 * 재측정 빈도 **참고** — 영국 왕립의사회(RCP) NEWS2(2017) 임상 대응표의 "최소 관찰 빈도"(2026-10-10).
 * 🔴 원내 규정이 아니다 — 화면은 "원내 재측정 주기 미설정 · 참고: RCP 권고"로 말한다(기본값을 정책인 척하지 않는다).
 *    원내 규정이 정해지면 config 로 옮긴다. 점수를 모르면(null) 참고도 내지 않는다.
 */
export const NEWS2_MONITORING_SOURCE = 'RCP NEWS2(2017) 임상 대응 — 원내 규정 아님';
export type News2MonitoringRef = { band: 'ZERO' | 'LOW' | 'SINGLE_3' | 'MEDIUM' | 'HIGH'; minIntervalHours: number | null; label: string };
export function news2MonitoringReference(r: { totalScore: number; hasIndividual3?: boolean | null } | null | undefined): News2MonitoringRef | null {
  if (!r || !Number.isFinite(r.totalScore)) return null;
  const t = r.totalScore;
  if (t >= 7) return { band: 'HIGH', minIntervalHours: null, label: '지속 감시(연속)' };
  if (t >= 5) return { band: 'MEDIUM', minIntervalHours: 1, label: '최소 1시간마다' };
  if (r.hasIndividual3) return { band: 'SINGLE_3', minIntervalHours: 1, label: '최소 1시간마다(단일 항목 3점)' };
  if (t >= 1) return { band: 'LOW', minIntervalHours: 4, label: '최소 4~6시간마다' };
  return { band: 'ZERO', minIntervalHours: 12, label: '최소 12시간마다' };
}
