/**
 * 수혈 적합성(ABO/Rh) 판정 — 순수 함수(단위 검증 가능).
 * 적혈구제제(RBC/전혈)와 혈장제제(FFP/PLASMA)는 적합성 규칙이 서로 반대이므로 제제 범주로 분기한다.
 *  - 적혈구: 수혈자 혈장의 항체가 공혈 적혈구 항원을 공격하면 안 됨(급성 용혈).
 *  - 혈장: 공혈 혈장의 항체가 수혈자 적혈구 항원을 공격하면 안 됨.
 * 치명적 안전 통제이므로 형이 미확정이면 부적합으로 판정한다(설정으로 완화/우회는 상위 계층).
 */

export type Abo = 'A' | 'B' | 'O' | 'AB';
export type ProductCategory = 'RBC' | 'PLASMA' | 'PLATELET' | 'OTHER';

// 적혈구제제: 수혈자(key)가 받을 수 있는 공혈자 ABO(value)
const RBC_ABO_OK: Record<Abo, Abo[]> = {
  O: ['O'],
  A: ['A', 'O'],
  B: ['B', 'O'],
  AB: ['A', 'B', 'O', 'AB'], // 만능 수혈자
};

// 혈장제제: 수혈자(key)가 받을 수 있는 공혈자 혈장 ABO(value) — 적혈구와 반대
const PLASMA_ABO_OK: Record<Abo, Abo[]> = {
  O: ['O', 'A', 'B', 'AB'], // 만능 혈장 수혈자
  A: ['A', 'AB'],
  B: ['B', 'AB'],
  AB: ['AB'], // AB 혈장 = 만능 공혈 혈장
};

export function normalizeAbo(v: string | null | undefined): Abo | null {
  if (!v) return null;
  const t = String(v).trim().toUpperCase();
  if (t === 'A' || t === 'B' || t === 'O' || t === 'AB') return t as Abo;
  return null;
}

/** Rh 표기를 POS/NEG로 정규화(+/-, POS/NEG, POSITIVE/NEGATIVE, 양성/음성). 불명이면 null */
export function normalizeRh(v: string | null | undefined): 'POS' | 'NEG' | null {
  if (v == null) return null;
  const t = String(v).trim().toUpperCase();
  if (t === '+' || t === 'POS' || t === 'POSITIVE' || t === '양성' || t === 'RH+') return 'POS';
  if (t === '-' || t === 'NEG' || t === 'NEGATIVE' || t === '음성' || t === 'RH-') return 'NEG';
  return null;
}

export function productCategory(productType: string | null | undefined): ProductCategory {
  const t = String(productType ?? '').toUpperCase();
  // ABO 무관(면제) 제제만 명시적으로 OTHER 처리 — 인식불가는 fail-safe로 RBC(ABO 강제)로 떨어뜨린다.
  if (/CRYO|동결침전|ALBUMIN|알부민|IVIG|IMMUNOGLOB|면역글로불린|FACTOR|응고인자/.test(t)) return 'OTHER';
  if (/FFP|PLASMA|혈장/.test(t)) return 'PLASMA';
  // 혈소판: PLT/PLATELET/혈소판 + 실제 코드 PC/SDP/RDP/APHERESIS(성분채집) 포함(과거 'PC'가 OTHER→ABO무검사였음)
  if (/PLT|PLATELET|혈소판|\bPC\b|\bSDP\b|\bRDP\b|APHERESIS|성분채집/.test(t)) return 'PLATELET';
  if (/RBC|RED|PRBC|WHOLE|WB|전혈|적혈구|PACKED/.test(t)) return 'RBC';
  // 인식불가 제제 — 보수적으로 적혈구 규칙(ABO 강제). OTHER=무검사로 떨어져 부적합 출고되던 것 방지.
  return 'RBC';
}

export interface CompatInput {
  productType: string;
  patientAbo: string | null | undefined;
  patientRh: string | null | undefined;
  productAbo: string | null | undefined;
  productRh: string | null | undefined;
}

export interface CompatResult {
  compatible: boolean;
  /** 부적합/불명 사유(불명은 compatible=false로 취급) */
  reason?: string;
  category: ProductCategory;
}

/**
 * ABO/Rh 적합성 판정.
 *  - RBC: ABO(RBC_ABO_OK) + Rh(음성 수혈자는 음성 공혈만)
 *  - PLASMA: ABO(PLASMA_ABO_OK), Rh 무관(적혈구 없음)
 *  - PLATELET: ABO는 RBC 규칙 준용(보수적), Rh 음성 수혈자는 음성 권장 → 부적합 처리
 *  - OTHER(동결침전물 등): ABO 강제 안 함(적합)
 */
export function checkAboRhCompatible(input: CompatInput): CompatResult {
  const category = productCategory(input.productType);
  if (category === 'OTHER') return { compatible: true, category };

  const pAbo = normalizeAbo(input.patientAbo);
  const dAbo = normalizeAbo(input.productAbo);
  if (!pAbo) return { compatible: false, category, reason: '환자 ABO 혈액형 미확정(수혈전검사 필요)' };
  if (!dAbo) return { compatible: false, category, reason: '혈액제제 ABO 형 불명' };

  if (category === 'PLASMA') {
    const ok = PLASMA_ABO_OK[pAbo].includes(dAbo);
    return ok
      ? { compatible: true, category }
      : { compatible: false, category, reason: `혈장 ABO 부적합: 수혈자 ${pAbo} ← 공혈 ${dAbo}` };
  }

  // RBC / PLATELET — 적혈구 규칙
  if (!RBC_ABO_OK[pAbo].includes(dAbo)) {
    return { compatible: false, category, reason: `ABO 부적합: 수혈자 ${pAbo} ← 공혈 ${dAbo}` };
  }
  // Rh: 음성 수혈자는 음성 공혈만(양성 수혈자는 양성/음성 모두 가능)
  const pRh = normalizeRh(input.patientRh);
  const dRh = normalizeRh(input.productRh);
  if (pRh === 'NEG') {
    if (dRh == null) return { compatible: false, category, reason: '혈액제제 Rh 불명(Rh음성 수혈자)' };
    if (dRh === 'POS') return { compatible: false, category, reason: 'Rh 부적합: Rh음성 수혈자에 Rh양성 공혈' };
  }
  return { compatible: true, category };
}
