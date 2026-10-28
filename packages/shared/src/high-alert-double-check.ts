/**
 * 고위험약 **독립 이중확인(Independent Double Check, IPSG.3)** 적용 범위 정본 — 2026-08-18.
 *
 * 🔴 이 파일이 생긴 이유 (재현된 사실)
 *   - BE(`nursing.service.administerMed`)의 이중확인 로직은 견고했다(자가서명 차단·활성 간호사 검증).
 *     그런데 **투약 EP 를 부르는 화면 4곳이 전부 `verifiedBy` 를 보내지 않았다.**
 *     → 고위험약 투약은 전건이 `[IPSG3-DOUBLECHECK-BYPASS]` 표식만 남기고 통과했고,
 *       **그 표식은 어느 화면에도 뜨지 않았다.** 우회가 아니라 **우회가 보이지 않는 것**이 결함이었다.
 *   - 2차 확인자를 고르는 UI 자체가 존재하지 않았다.
 *
 * 🔴 **모든 고위험약에 걸지 않는다.**
 *   ISMP 는 독립 이중확인을 "모든 고위험 약물"에 적용하는 것을 **권고하지 않는다**
 *   (ISMP, *Independent Double Checks: Worth the Effort if Used Judiciously and Properly*).
 *   전부에 걸면 의식(ritual)이 되어 실제 검출력이 사라진다(alarm/부담 피로).
 *   ISMP 가 일관되게 지목하는 **좁은 목록**만 강제한다.
 *
 * 운영 실측(2026-08-18 · `medication_codes`): `highAlertFlag` 634품목
 *   CHEMOTHERAPY 166 · ANTICOAGULANT 184 · OPIOID 155 · CONCENTRATED_ELECTROLYTE 46 ·
 *   SEDATIVE 36 · INSULIN 31 · NEUROMUSCULAR_BLOCKER 16  (미분류 0건)
 *
 * 적용 결과: **상시 대상 259품목**(41%) + **비경구일 때만 375품목**(59%).
 * 즉 경구 와파린·경구 마약성 진통제·경구 벤조디아제핀은 이중확인을 요구하지 않는다 —
 * ISMP 목록에 없고, 병동 투약의 대부분을 차지해 형식화의 주범이기 때문이다.
 *
 * 🔴 **모르면 안전측으로 접는다.** 경로가 판별 불가하거나 분류가 등재되지 않은 고위험약은
 *    "요구함"으로 판정한다. 여기서는 미상을 관대하게 접으면 **보호가 조용히 사라진다**
 *    (이 저장소가 반복해 당한 P1 — 모르는 것을 아는 것처럼 말하기 — 의 반대 방향 적용).
 */

/** DB `medication_codes.high_alert_category` 어휘(운영 실측 7종). */
export const HIGH_ALERT_CATEGORIES = [
  'CHEMOTHERAPY',
  'NEUROMUSCULAR_BLOCKER',
  'CONCENTRATED_ELECTROLYTE',
  'INSULIN',
  'ANTICOAGULANT',
  'OPIOID',
  'SEDATIVE',
] as const;

export type HighAlertCategory = (typeof HIGH_ALERT_CATEGORIES)[number];

export const HIGH_ALERT_CATEGORY_LABEL: Record<HighAlertCategory, string> = {
  CHEMOTHERAPY: '항암제',
  NEUROMUSCULAR_BLOCKER: '신경근차단제',
  CONCENTRATED_ELECTROLYTE: '고농축 전해질',
  INSULIN: '인슐린',
  ANTICOAGULANT: '항응고제',
  OPIOID: '마약성 진통제',
  SEDATIVE: '진정제',
};

/**
 * **경로 무관 상시 독립 이중확인** — ISMP 가 명시적으로 지목하는 목록.
 * 오투약 시 되돌릴 수 없거나 치명적인 결과가 즉시 발생하는 군.
 */
export const ALWAYS_DOUBLE_CHECK: readonly HighAlertCategory[] = [
  'CHEMOTHERAPY',
  'NEUROMUSCULAR_BLOCKER',
  'CONCENTRATED_ELECTROLYTE',
  'INSULIN',
];

/**
 * **비경구(주사) 경로일 때만** 독립 이중확인.
 * 경구 제형은 ISMP 상시 목록에 없다 — 전부에 걸면 형식화되어 검출력이 사라진다.
 */
export const PARENTERAL_ONLY_DOUBLE_CHECK: readonly HighAlertCategory[] = [
  'ANTICOAGULANT',
  'OPIOID',
  'SEDATIVE',
];

/** 비경구(주사) 경로 표기 — 자유 문자열이라 한/영 혼용. */
const PARENTERAL_ROUTES = [
  'IV', 'IVP', 'IVPB', 'IV PUSH', 'IVI', 'INFUSION', 'DRIP',
  'IM', 'SC', 'SQ', 'SUBQ', 'SUBCUT',
  'EPIDURAL', 'IT', 'INTRATHECAL', 'PCA', 'IO', 'IA',
  '정맥', '정주', '주사', '근주', '근육', '피하', '경막외', '척수강', '수액',
];

/** 비경구가 **아님이 확실한** 경로 — 여기 없는 값은 "미상"으로 둔다(추정 금지). */
const NON_PARENTERAL_ROUTES = [
  'PO', 'P.O.', 'ORAL', 'PER OS', '경구', '내복',
  'SL', 'SUBLINGUAL', '설하',
  'PR', 'RECTAL', '직장',
  'INH', 'NEB', 'INHALATION', '흡입',
  'TOP', 'TOPICAL', 'TD', 'TRANSDERMAL', '외용', '도포', '패치',
  'OPH', 'OPHTHALMIC', '점안', 'OTIC', '점이',
  'NAS', 'NASAL', '비강',
  'NGT', 'NG', 'PEG', '경관',
  'VAG', 'VAGINAL', '질',
];

function norm(v: string | null | undefined): string {
  return String(v ?? '').trim().toUpperCase();
}

/**
 * 비경구 경로인가. **모르면 `null`** — 추정하지 않는다.
 * 판정 불가를 `false` 로 접으면 이중확인이 조용히 면제된다.
 */
export function isParenteralRoute(route: string | null | undefined): boolean | null {
  const r = norm(route);
  if (!r) return null;
  if (PARENTERAL_ROUTES.some((p) => r === p || r.includes(p))) return true;
  if (NON_PARENTERAL_ROUTES.some((p) => r === p || r.includes(p))) return false;
  return null;
}

/** 등재된 분류인가 */
export function isHighAlertCategory(v: string | null | undefined): v is HighAlertCategory {
  return (HIGH_ALERT_CATEGORIES as readonly string[]).includes(norm(v));
}

export interface DoubleCheckScope {
  /** 독립 이중확인(2인 서명)을 요구하는가 */
  required: boolean;
  /** 정본 분류(미등재면 null) */
  category: HighAlertCategory | null;
  /** 사람이 읽을 판정 사유 — 화면에 그대로 띄운다(근거 없는 경고 금지) */
  reason: string;
}

/**
 * 이 투약이 독립 이중확인 대상인가.
 *
 * @param input.highAlertFlag  `medication_codes.high_alert_flag`
 * @param input.highAlertCategory `medication_codes.high_alert_category`
 * @param input.route 실제 투여 경로(없으면 처방 경로)
 */
export function requiresIndependentDoubleCheck(input: {
  highAlertFlag?: boolean | null;
  highAlertCategory?: string | null;
  route?: string | null;
}): DoubleCheckScope {
  if (!input.highAlertFlag) {
    return { required: false, category: null, reason: '고위험(high-alert) 약물이 아닙니다.' };
  }

  const cat = isHighAlertCategory(input.highAlertCategory)
    ? (norm(input.highAlertCategory) as HighAlertCategory)
    : null;

  if (cat && ALWAYS_DOUBLE_CHECK.includes(cat)) {
    return {
      required: true,
      category: cat,
      reason: `${HIGH_ALERT_CATEGORY_LABEL[cat]} — 경로와 무관하게 독립 이중확인 대상(ISMP 상시 목록).`,
    };
  }

  // 비경구 한정군 + 분류 미등재 고위험약(안전측으로 동일 규칙 적용)
  const parenteral = isParenteralRoute(input.route);
  const label = cat ? HIGH_ALERT_CATEGORY_LABEL[cat] : '고위험 약물(분류 미등재)';

  if (parenteral === true) {
    return {
      required: true,
      category: cat,
      reason: `${label} 비경구(${String(input.route ?? '').trim()}) 투여 — 독립 이중확인 대상.`,
    };
  }
  if (parenteral === false) {
    return {
      required: false,
      category: cat,
      reason: `${label} 경구·국소(${String(input.route ?? '').trim()}) 투여 — ISMP 상시 이중확인 목록이 아닙니다(형식적 이중확인은 검출력을 떨어뜨립니다).`,
    };
  }
  return {
    required: true,
    category: cat,
    reason: `${label} — 투여 경로를 판별할 수 없어(${String(input.route ?? '').trim() || '미기재'}) 안전측으로 독립 이중확인을 요구합니다.`,
  };
}

// ── 우회(bypass) — 막지 않되 반드시 보이게 한다 ──────────────────────────────

/**
 * 🔴 **우회를 봉쇄하지 않는다.** 야간 단독 근무처럼 2차 확인자가 물리적으로 없는 상황이 실재하고,
 *    봉쇄하면 투약이 멈춘다(그리고 현장은 계정 공유 같은 더 나쁜 우회로 간다).
 *    대신 **우회한 사실·사유·시각·투약자**를 기록에 남기고 **화면에 띄운다.**
 *    (게이트 `nursing.highAlertDoubleCheck` 를 BLOCK 으로 올리는 것은 병원의 운영 판단이다.)
 */
export const DOUBLE_CHECK_BYPASS_REASONS = [
  { code: 'SOLO_SHIFT', label: '단독 근무 — 2차 확인 간호사 부재' },
  { code: 'EMERGENCY', label: '응급 — 지연 시 환자에게 위해' },
  { code: 'VERIFIER_UNAVAILABLE', label: '확인 간호사 즉시 확보 불가' },
  { code: 'OTHER', label: '기타(사유 직접 입력)' },
] as const;

export type DoubleCheckBypassReasonCode = (typeof DOUBLE_CHECK_BYPASS_REASONS)[number]['code'];

/** notes 안에 심는 감사 표식 태그(기존 기록과 동일 — 소급 호환). */
export const DOUBLE_CHECK_BYPASS_TAG = 'IPSG3-DOUBLECHECK-BYPASS';

/** 사유 미기재를 "사유 있음"으로 위장하지 않는다 — 빈 값은 이 문자열로 남긴다. */
export const BYPASS_REASON_UNSTATED = '미기재';

export function buildDoubleCheckBypassMarker(input: {
  at?: Date | string;
  nurseId: string;
  reason?: string | null;
}): string {
  const at = input.at instanceof Date ? input.at.toISOString() : String(input.at ?? new Date().toISOString());
  // 표식 파싱이 깨지지 않도록 대괄호·개행만 제거한다(내용은 자르지 않는다 — 자르면 잘랐다고 말해야 한다).
  const reason = String(input.reason ?? '').replace(/[\[\]\r\n]/g, ' ').trim() || BYPASS_REASON_UNSTATED;
  return `[${DOUBLE_CHECK_BYPASS_TAG} ${at} nurse=${input.nurseId} reason=${reason}]`;
}

export interface DoubleCheckBypassRecord {
  at: string | null;
  nurseId: string | null;
  /** 사유 — 구 기록(사유 필드 이전)은 `미기재` */
  reason: string;
}

/**
 * 기록(notes)에서 우회 표식을 읽는다. 없으면 `null`.
 * 🔴 사유 필드가 없던 **구 표식도 읽는다**(이미 남아 있는 기록을 못 읽으면 화면이 다시 침묵한다).
 */
export function parseDoubleCheckBypass(notes: string | null | undefined): DoubleCheckBypassRecord | null {
  const s = String(notes ?? '');
  if (!s.includes(DOUBLE_CHECK_BYPASS_TAG)) return null;
  const re = new RegExp(`\\[${DOUBLE_CHECK_BYPASS_TAG}\\s+([^\\s\\]]*)\\s*(?:nurse=([^\\s\\]]*))?\\s*(?:reason=([^\\]]*))?\\]`);
  const m = re.exec(s);
  if (!m) return { at: null, nurseId: null, reason: BYPASS_REASON_UNSTATED };
  return {
    at: m[1] || null,
    nurseId: m[2] || null,
    reason: (m[3] ?? '').trim() || BYPASS_REASON_UNSTATED,
  };
}
