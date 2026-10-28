// 의무기록·증명서 발급 수수료 규칙(P3).
// 기본값은 의료법 시행규칙 §13의3(제증명 수수료) 상한 가이드를 참고한 운영 기본값이며,
// 실제 금액은 기관이 SystemConfig key 'medical_record.fee_rules'(JSON)로 오버라이드한다.

export type FeeRule = {
  label: string;
  base: number; // 1부 기본 수수료(원)
  perExtraCopy: number; // 2부째부터 추가 1부당(원)
  pageTier?: { firstQty: number; firstUnit: number; nextUnit: number }; // 매수 누진(사본): 1~firstQty매 firstUnit/매, 초과분 nextUnit/매
};

// request.type 기준. (MEDICAL_RECORD=A그룹 사본 / 나머지=B그룹 증명서)
export const DEFAULT_FEE_RULES: Record<string, FeeRule> = {
  MEDICAL_RECORD: { label: '의무기록 사본', base: 1000, perExtraCopy: 0, pageTier: { firstQty: 5, firstUnit: 1000, nextUnit: 100 } },
  DIAGNOSIS_CERT: { label: '진단서(일반)', base: 20000, perExtraCopy: 1000 },
  OPINION: { label: '소견서', base: 10000, perExtraCopy: 1000 },
  ADMISSION_CERT: { label: '입·퇴원확인서', base: 3000, perExtraCopy: 1000 },
  // F-4 실손보험 세트 신설 type 2종 (patient-portal-enhancement §4.2 — TYPE_FEES 와 두 곳 동시 확장)
  DETAILED_BILL: { label: '진료비 세부산정내역서', base: 1000, perExtraCopy: 0 },
  ATTENDANCE_CERT: { label: '통원확인서', base: 3000, perExtraCopy: 1000 },
  RECEIPT: { label: '진료비 영수증', base: 0, perExtraCopy: 0 },
  TAX_INVOICE: { label: '진료비 세금계산서', base: 0, perExtraCopy: 0 },
  // N-W1 신설 2종 (portal TYPE_FEES 와 두 곳 동시 확장 규약) — 기본값은 제증명수수료 상한 고시 계열
  // (기존 표와 같은 출처). 🔴 원내 확정 금액은 config(medical_record.fee_rules) 개정으로 — 사람 결정.
  DEATH_CERT: { label: '사망진단서(시체검안서)', base: 10000, perExtraCopy: 1000 },
  BIRTH_CERT: { label: '출생증명서', base: 3000, perExtraCopy: 1000 },
};

export type FeeBreakdown = {
  type: string; label: string; copies: number; pages: number;
  base: number; pageCharge: number; copyCharge: number; total: number; ruleSource: 'CONFIG' | 'DEFAULT';
};

/** 순수 계산 — 매수(사본)·부수 기반. 사본은 누진, 증명서는 부수 가산. */
export function computeFeeWith(rules: Record<string, FeeRule>, source: 'CONFIG' | 'DEFAULT', type: string, pages: number, copies: number): FeeBreakdown {
  const rule = rules[type] ?? DEFAULT_FEE_RULES[type] ?? { label: type, base: 0, perExtraCopy: 0 };
  const c = Math.max(1, copies || 1);
  const p = Math.max(0, pages || 0);
  let perSet = rule.base; // 1부 금액. 사본은 매수 누진, 그 외는 base.
  if (rule.pageTier && p > 0) {
    const { firstQty, firstUnit, nextUnit } = rule.pageTier;
    perSet = Math.min(p, firstQty) * firstUnit + Math.max(0, p - firstQty) * nextUnit;
  }
  // breakdown 합산 정합(모든 경우 base + pageCharge + copyCharge === total):
  //  - 사본(pageTier): base=0, pageCharge=1부 금액(perSet), copyCharge=추가부수. p=0이어도 perSet=base라 정합
  //  - 증명서: base=rule.base, pageCharge=0, copyCharge=부수 가산
  const pageCharge = rule.pageTier ? perSet : 0;
  const copyCharge = rule.pageTier ? perSet * (c - 1) : rule.perExtraCopy * (c - 1);
  const total = rule.pageTier ? perSet * c : rule.base + copyCharge;
  const base = rule.pageTier ? 0 : rule.base;
  return { type, label: rule.label, copies: c, pages: p, base, pageCharge, copyCharge, total, ruleSource: source };
}

/** 수령 방법 어휘 — 포털 다운로드·방문·우편·팩스(창구 접수는 PORTAL 제외) */
export const DOC_DELIVERY_METHODS = ['PORTAL', 'VISIT', 'MAIL', 'FAX'] as const;
/** 신청 부수 상한(창구·포털 같은 규칙) */
export const DOC_MAX_COPIES = 10;
/** 포털(환자 본인)로 신청할 수 없는 서류 — 사망진단서는 사망자 본인 계정이 성립하지 않는다(유족 창구 접수) */
export const PORTAL_BLOCKED_DOC_TYPES: readonly string[] = ['DEATH_CERT'];

/**
 * 수수료 규칙 적재 — 기본값 + SystemConfig('medical_record.fee_rules') 오버라이드. **정본 하나**(창구·포털·발급이 같이 쓴다).
 * 🔴 (2026-10-10) 종전엔 조회 실패를 `.catch(() => null)` 로 기본값에 접어, 원내 개정 금액 대신 기본 금액을 **조용히** 매겼다
 *    → 실패는 전파한다. 포털은 따로 둔 금액표(TYPE_FEES)를 써서 원내 개정이 포털 신청에 반영되지 않았다(같은 사실에 정본 둘).
 */
export async function loadFeeRules(prisma: { systemConfig: { findUnique: (a: { where: { key: string } }) => Promise<{ value: unknown } | null> } }): Promise<{ rules: Record<string, FeeRule>; source: 'CONFIG' | 'DEFAULT' }> {
  const cfg = await prisma.systemConfig.findUnique({ where: { key: 'medical_record.fee_rules' } });
  if (cfg && cfg.value && typeof cfg.value === 'object' && !Array.isArray(cfg.value)) {
    return { rules: { ...DEFAULT_FEE_RULES, ...(cfg.value as Record<string, FeeRule>) }, source: 'CONFIG' };
  }
  return { rules: DEFAULT_FEE_RULES, source: 'DEFAULT' };
}
