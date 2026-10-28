/**
 * 휴대폰 본인확인 공급자 어댑터 — **공급자를 서버 뒤에 격리한다**(EXT-ID-01).
 *
 * 🔴 앱은 공급자 SDK 를 직접 부르지 않는다. 앱이 `provider` 나 `returnUrl` 을 임의로 정할 수도 없다
 *    (그러면 공격자가 자기 서버를 callback 으로 지정한다). 운영 공급자는 **서버 설정이 고른다.**
 *
 * 🔴 공급자 앱의 복귀값이나 브라우저의 "성공" 화면을 신뢰하지 않는다.
 *    callback 은 HIS 백엔드가 받고 state/nonce·거래ID·목적·만료·1회 사용·서명·서버 간 조회를 모두 검증한다.
 */
export interface IdentityStartInput {
  purpose: 'PATIENT_SIGNUP' | 'PATIENT_RECOVERY';
  verificationId: string;
  stateNonce: string;
  /** 서버가 정한 callback — 앱이 준 값이 아니다 */
  callbackUrl: string;
}

export interface ProviderStartResult {
  /** 앱이 열 인증 화면 — 공급자 도메인 */
  authUrl: string;
  providerTxRef: string;
}

export interface ProviderCallbackInput {
  verificationId: string;
  stateNonce: string;
  /** 공급자가 callback 에 실어 보낸 원시 파라미터 */
  raw: Record<string, string>;
}

export interface VerifiedIdentity {
  ci: string;
  name: string;
  birthDate: string;
  gender: 'MALE' | 'FEMALE';
  phone: string;
  /** 공급자 거래 참조 — 감사·재조회용 */
  providerTxRef: string;
}

export interface IdentityProviderHealth {
  provider: string;
  available: boolean;
  reason: string | null;
}

export interface IdentityProviderAdapter {
  readonly name: string;
  /** 이 어댑터를 **운영에서 써도 되는가** — fake 는 false 를 돌려준다 */
  readonly usableInProduction: boolean;
  start(input: IdentityStartInput): Promise<ProviderStartResult>;
  completeCallback(input: ProviderCallbackInput): Promise<{ providerTxRef: string }>;
  fetchVerifiedResult(providerTxRef: string): Promise<VerifiedIdentity>;
  cancel(providerTxRef: string): Promise<void>;
  health(): Promise<IdentityProviderHealth>;
}
