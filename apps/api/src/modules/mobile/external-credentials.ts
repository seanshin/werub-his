/**
 * 외부 자격증명 정본 — 네이티브 앱 스택이 **밖에서 받아와야만** 되는 값들을 한 곳에 모은다.
 *
 * 🔴 왜 한 곳인가 — 이 값들이 코드 곳곳에 `process.env.X ?? 기본값` 으로 흩어지면
 *    **미설정이 "설정된 것처럼" 조용히 통과한다.** 우리 저장소에서 반복해 나온 유형이다
 *    (대외 발신 채널 7파일 분산 · provider 만 보고 "켜짐"이라 판정할 뻔).
 *
 * 규약
 * - 미설정이면 **그 기능은 되는 척하지 않는다.** `blocking` 이 그 결과를 못박는다.
 * - 값 자체는 **여기서 반환하지 않는다**(로그·응답에 실리지 않게). 있는지 없는지만 말한다.
 * - 내부적으로 이미 정해진 것(우리가 만든 계약)은 여기 넣지 않는다 — 여기 있는 것은
 *   **전부 밖에서 와야 하는 것**이고, 그래서 개발이 이것을 기다리지 않도록 설계한다.
 */
export type CredentialBlocking =
  /** 없으면 그 기능이 꺼진 상태로 정직하게 응답한다(개발·다른 기능은 계속 진행) */
  | 'FEATURE_OFF'
  /** 없으면 요청을 거절한다(되는 척하면 위험한 것) */
  | 'FAIL_CLOSED';

export interface ExternalCredentialSpec {
  key: string;
  label: string;
  /** 이것 없이는 못 도는 기능 */
  neededFor: string[];
  provider: string;
  /** 누가 발급받아 넣는가 — 서버팀이 스스로 만들 수 없는 것들이다 */
  owner: string;
  env: string[];
  /** 이 중 **하나만** 있어도 구성된 것으로 본다(전부 필요한 `env` 와 다르다) */
  anyOfEnv?: string[];
  blocking: CredentialBlocking;
  /** 미설정일 때 API 가 돌려주는 코드 — 화면이 이유를 그대로 말할 수 있게 */
  unavailableCode: string;
  notes?: string;
}

export const EXTERNAL_CREDENTIALS: ExternalCredentialSpec[] = [
  {
    key: 'apple.appIdentity',
    label: 'Apple Team ID · 환자/스탭 Bundle ID',
    neededFor: ['APPKEY-01 App Attest 검증(App ID hash)', 'LINK-01 AASA', 'Passkey webcredentials'],
    provider: 'Apple Developer Program',
    owner: 'iOS 팀 — 앱 등록 후 확정',
    env: ['APPLE_TEAM_ID', 'IOS_PATIENT_BUNDLE_ID', 'IOS_STAFF_BUNDLE_ID'],
    blocking: 'FAIL_CLOSED',
    unavailableCode: 'APP_IDENTITY_NOT_CONFIGURED',
    notes:
      'App Attest 는 App ID(Team ID + Bundle ID)의 해시를 검증한다. 이 값을 모르면 검증이 성립하지 않는다 — ' +
      '"검증한 척" 하지 않고 거절한다. Apple 루트 CA 는 공개 산출물이라 자격증명이 아니다(코드에 동봉).',
  },
  {
    key: 'identity.provider',
    label: '휴대폰 본인확인 site code · API key · 인증서',
    neededFor: ['EXT-ID-01 실제 본인확인', 'AUTH-P-01 환자 가입'],
    provider: '본인확인기관(계약 대상)',
    owner: '병원 계약·법무 — 서버팀 단독 불가',
    env: ['IDENTITY_PROVIDER', 'IDENTITY_SITE_CODE', 'IDENTITY_API_KEY', 'IDENTITY_CERT_PEM'],
    blocking: 'FEATURE_OFF',
    unavailableCode: 'IDENTITY_PROVIDER_NOT_CONFIGURED',
    notes:
      '미설정이면 운영 가입 경로가 닫힌 상태로 정직하게 응답한다. 개발·스테이징은 ' +
      'LOCAL_FAKE 어댑터로 끝까지 진행할 수 있고, **운영에서는 fake 가 선택되지 않는다**.',
  },
  {
    key: 'identity.pepper',
    label: 'CI 조회 해시용 서버 pepper',
    neededFor: ['CI 중복 판정(원문 복호화 없이)'],
    provider: '자체 생성(운영 secret manager)',
    owner: '인프라 — 운영 주입',
    env: ['IDENTITY_CI_PEPPER'],
    blocking: 'FAIL_CLOSED',
    unavailableCode: 'IDENTITY_PEPPER_NOT_CONFIGURED',
    notes: '없으면 CI 해시를 만들 수 없다. 임의 기본값을 쓰면 해시가 전 배포에서 갈라진다.',
  },
  {
    key: 'push.provider',
    label: 'FCM/APNs 서비스 계정',
    neededFor: ['PUSH-01 실제 발송'],
    provider: 'Firebase / Apple',
    owner: '인프라',
    // 🔴 2026-08-25 정정 — 발송기(`FcmPushService.onModuleInit`)가 실제로 읽는 변수로 맞춘다.
    //    종전엔 `FIREBASE_SERVICE_ACCOUNT`/`FIREBASE_PROJECT_ID` 를 적어 뒀는데 발송 코드는
    //    그것을 보지 않는다 — 운영은 후자만 있어서 **발송기는 켜져 있는데 관제·readiness 는
    //    "미구성"이라 답했다.** v4.6.0 규약("관제는 발송 코드가 무엇을 보는가를 먼저 읽는다")의 재발.
    //    이 둘은 **택일**이다(둘 중 하나면 발송기가 초기화된다) — `anyOf` 로 표시한다.
    env: [],
    anyOfEnv: ['GOOGLE_APPLICATION_CREDENTIALS', 'FCM_SERVICE_ACCOUNT_JSON'],
    blocking: 'FEATURE_OFF',
    unavailableCode: 'PUSH_PROVIDER_NOT_CONFIGURED',
    notes:
      '🔴 미설정일 때 **조용히 성공으로 접지 않는다**. 토큰 등록은 받되 readiness 가 실패를 표시하고, ' +
      '발송 결과는 `{attempted, sent, reason}` 로 정직하게 돌려준다.',
  },
];

export const EXTERNAL_CREDENTIAL_BY_KEY = new Map(EXTERNAL_CREDENTIALS.map((c) => [c.key, c]));
