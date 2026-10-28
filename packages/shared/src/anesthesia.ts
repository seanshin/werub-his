/**
 * 마취 종류 표기 정본 — 2026-08-12.
 *
 * 🔴 두 가지가 겹쳐 있었다.
 *   ① 수술방 관리 화면이 `anesthesiaType` 을 **그대로** 찍어 `GENERAL`·`LOCAL` 이 노출됐다.
 *      (라벨표는 `workstation/post-op` 에 로컬로만 있었다 — 다른 화면은 못 쓴다.)
 *   ② **DB 에 영문 코드와 한글이 섞여 저장돼 있다**(운영 실측: `GENERAL` 1 / `전신마취` 5 ·
 *      `LOCAL` 1 / `국소마취` 1 / `척추마취` 1). `anesthesia_type` 이 enum 이 아니라 자유
 *      문자열이고, 성형 진료 화면은 한글을, 다른 경로는 영문 코드를 저장한다.
 *
 * 그래서 이 정본은 **둘 다 받아** 한글 하나로 말한다. 저장 값 통일은 마이그레이션이 필요한
 * 별도 과제이고, 그때까지 화면이 두 표현으로 갈라지면 안 된다.
 */
export const ANESTHESIA_LABEL: Record<string, string> = {
  GENERAL: '전신마취',
  SPINAL: '척추마취',
  EPIDURAL: '경막외마취',
  LOCAL: '국소마취',
  SEDATION: '수면마취',
  REGIONAL: '부분마취',
  NONE: '무마취',
  OTHER: '기타',
};

/** 한글로 저장된 값도 정본으로 인정한다(현재 DB 에 실재한다) */
const KOREAN_FORMS = new Set(Object.values(ANESTHESIA_LABEL).concat(['부분마취', '수면마취', '무마취']));

/**
 * 마취 종류 → 한글. 영문 코드·한글 어느 쪽이 와도 한글 하나로 답한다.
 * 모르는 값은 **뭉개지 않고 그대로** 돌려준다(임상 기재를 '기타'로 지우지 않는다).
 */
export function anesthesiaText(value: string | null | undefined, fallback = '-'): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (ANESTHESIA_LABEL[trimmed]) return ANESTHESIA_LABEL[trimmed];
  if (ANESTHESIA_LABEL[trimmed.toUpperCase()]) return ANESTHESIA_LABEL[trimmed.toUpperCase()];
  return trimmed; // 한글 저장분·미등재 값은 그대로
}

/** 표준 코드로 저장된 값인가 — 데이터 정합성 점검·마이그레이션 대상 식별용 */
export function isCanonicalAnesthesiaCode(value: string | null | undefined): boolean {
  return !!value && !!ANESTHESIA_LABEL[value.trim()];
}

/** 한글로 저장된 값인가(마이그레이션 대상) */
export function isKoreanAnesthesiaForm(value: string | null | undefined): boolean {
  return !!value && KOREAN_FORMS.has(value.trim());
}
