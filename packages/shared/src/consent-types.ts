/**
 * 동의서 유형 라벨 정본 — 2026-08-12.
 *
 * 🔴 서버(`consent.service`)와 화면(`workstation/consent`)이 **각자 라벨표를 들고 있었고,
 *    같은 코드에 다른 말을 하고 있었다.**
 *      DNR      → 서버 '연명의료' / 화면 'DNR'
 *      GENERAL  → 서버 '진료'     / 화면 '일반'
 *    게다가 화면은 라벨을 못 찾으면 `?? type` 으로 **영문 코드를 그대로 노출**했다
 *    (실측: 목록에 `GENERAL`·`TREATMENT`·`DNR` 배지가 영문으로 떴다).
 *
 * 동의서 유형은 법적 문서의 성격을 규정한다. `DNR` 은 연명의료결정법상 **'연명의료'** 가
 * 정확한 표현이므로 그쪽으로 통일한다. 라벨을 로컬에서 다시 정의하지 않는다.
 */
export const CONSENT_TYPE_LABEL: Record<string, string> = {
  SURGERY: '수술',
  ANESTHESIA: '마취',
  PROCEDURE: '시술',
  TRANSFUSION: '수혈',
  RESEARCH: '연구',
  DNR: '연명의료',
  TREATMENT: '진료',
  GENERAL: '진료',
  // 진료 녹음·AI 문서화(앰비언트 스크라이브) 전용 별도 동의 — 서버 `requireRecordingConsent` 가 이 유형의 행을 요구한다.
  // 🔴 2026-09-22 까지 라벨이 없어 서버 프롬프트·화면 배지가 영문 코드 `RECORDING` 을 그대로 냈다(voice-emr §13.2 P0-2).
  RECORDING: '진료 녹음·AI 문서화',
  // 개인정보·민감정보 계열(등록 동의서)
  PRIVACY_COLLECT: '개인정보 수집·이용',
  THIRD_PARTY: '제3자 제공',
  SENSITIVE_HEALTH: '민감정보 처리',
};

/**
 * Prisma `enum ConsentType` 의 거울 — **동의서 워크스테이션이 접수할 수 있어야 하는 유형의 전체 집합**.
 *
 * 🔴 2026-09-22 실측(voice-emr §13.2 P0-2): 워크스테이션 유형 목록에 `RECORDING` 이 빠져 있어
 *    서버는 동의 행을 요구하는데 **그 행을 만들 화면이 없었다**("데이터 0행"의 세 번째 뜻 = 쓰기 경로가 막혀 있다).
 *    화면 목록은 UI 순서만 정하고, **집합은 이 배열과 일치**해야 한다(가드: web `consent-type-list-canon.spec.ts`,
 *    shared `consent-types.spec.ts` 가 schema.prisma 와 대조).
 * 🔴 `PRIVACY_COLLECT` 등 등록 동의서 계열은 enum 이 아니라 `ConsentForm.type` 문자열로만 존재한다 — 여기 넣지 않는다.
 */
export const CONSENT_TYPE_CODES = [
  'SURGERY', 'ANESTHESIA', 'PROCEDURE', 'TRANSFUSION', 'RESEARCH', 'DNR', 'TREATMENT', 'GENERAL', 'RECORDING',
] as const;
export type ConsentTypeCode = (typeof CONSENT_TYPE_CODES)[number];

/**
 * 코드 → 한글 라벨. 두 필드(consentType·type) 어느 쪽이 와도 찾는다.
 *
 * 모르는 코드는 **뭉개지 않고 코드를 그대로** 돌려준다 — 임상 문서 유형을 '기타'로 통일하면
 * 어떤 동의서인지 사라진다. 대신 `isKnownConsentType` 으로 화면이 '미등록'임을 표시할 수 있다.
 */
export function consentTypeText(...codes: (string | null | undefined)[]): string {
  for (const c of codes) {
    if (c && CONSENT_TYPE_LABEL[c]) return CONSENT_TYPE_LABEL[c];
  }
  for (const c of codes) if (c) return c;
  return '-';
}

/** 라벨표에 등재된 코드인가 — 화면이 '미등록 유형'을 회색으로 구분할 때 쓴다 */
export function isKnownConsentType(...codes: (string | null | undefined)[]): boolean {
  return codes.some((c) => !!c && !!CONSENT_TYPE_LABEL[c]);
}
