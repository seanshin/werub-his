/**
 * 포털 접수 동의서 전자서명 — "무엇이 남았는가" 정본 (2026-09-15 T2).
 *
 * 🔴 화면은 인증서가 있으면 "블록체인 전자서명이 자동 적용됩니다"라고 말하고 `signMethod: 'BLOCKCHAIN'` 을 보냈다.
 *    실제로는 환자용 서명·앵커링 경로가 없고(blockchain-cert 에 서명 EP 0), 화면이 만든 서명값은
 *    `base64(이름-유형-시각)` 이었으며 서버는 그것을 저장하지도 않았다. 방식 어휘(schema `sign_method`)도
 *    PAPER·PORTAL·MOBILE·HIS 뿐이다.
 *    → 방식은 서버가 `PORTAL` 로 정하고, 응답이 남은 증빙을 그대로 말한다(없는 것을 있다고 하지 않는다).
 */
export const PORTAL_CONSENT_SIGN_METHOD = 'PORTAL' as const;

export interface PortalConsentEvidence {
  signMethod: string | null;
  /** 서명 이미지(signatureData)가 저장됐는가 — 현재 포털 화면은 보내지 않는다 */
  signatureImageStored: boolean;
  /** 서명 IP 가 기록됐는가 */
  ipRecorded: boolean;
  /** 블록체인 서명·앵커링 — 이 경로에는 구현이 없다(항상 false) */
  blockchainAnchored: false;
}

export function portalConsentEvidence(consent: {
  signMethod?: string | null;
  signatureData?: string | null;
  ipAddress?: string | null;
}): PortalConsentEvidence {
  return {
    signMethod: consent.signMethod ?? null,
    signatureImageStored: !!consent.signatureData,
    ipRecorded: !!consent.ipAddress,
    blockchainAnchored: false,
  };
}
