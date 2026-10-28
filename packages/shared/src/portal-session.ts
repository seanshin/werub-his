/**
 * 환자 포털 세션 능력표 — 정본(2026-10-19 포털 세련화 기획 A1).
 *
 * 🔴 포털 로그인은 세 종류다 — 휴대폰 계정(ACCOUNT) · 등록번호+생년월일(MRN) · 보호자 위임(GUARDIAN).
 *    계정 전용 기능(`PatientAccountAuthGuard` 뒤 EP)은 ACCOUNT 만 쓸 수 있는데, 화면이 그걸 모른 채 불러
 *    실패를 보고서야 알았다 — 그 401/403 을 "세션 만료"로 읽어 로그아웃·거짓 문구가 났다(v4.93.0~v4.93.2 사용자 신고 3건).
 *    서버가 로그인한 세션의 능력을 먼저 알려 주고(`GET /api/v1/portal/session`), 화면은 능력이 없는 기능을 **부르지 않는다**.
 *
 * 🔴 이 표는 서버 가드와 기계 대조된다(api `test/portal/portal-session-capabilities.spec.ts`) —
 *    계정 가드 뒤 EP 가 어느 기능에도 속하지 않거나, 기능 경로에 계정 가드 EP 가 없으면 실패한다.
 */
export const PORTAL_SESSION_KINDS = ['ACCOUNT', 'MRN', 'GUARDIAN'] as const;
export type PortalSessionKind = (typeof PORTAL_SESSION_KINDS)[number];

/** 계정 전용 기능 → 그 기능의 EP 경로 접두사(`/api/v1` 아래). 가장 긴 접두사가 이긴다(`family` vs `family-accounts`). */
export const PORTAL_ACCOUNT_FEATURES = {
  notifications: ['/api/v1/patient-auth/notifications'],
  nationalId: ['/api/v1/patient-auth/profile/national-id'],
  family: ['/api/v1/patient-auth/profile/family'],
  familyAccounts: ['/api/v1/patient-auth/profile/family-accounts'],
  address: ['/api/v1/patient-auth/profile/address'],
  guardianRequests: ['/api/v1/patient-auth/guardians'],
  accountSecurity: [
    '/api/v1/patient-auth/logout', '/api/v1/patient-auth/password', '/api/v1/patient-auth/pin',
    '/api/v1/patient-auth/devices', '/api/v1/patient-auth/device', '/api/v1/mobile-devices/patient',
  ],
} as const;
export type PortalAccountFeature = keyof typeof PORTAL_ACCOUNT_FEATURES;
export const PORTAL_ACCOUNT_FEATURE_KEYS = Object.keys(PORTAL_ACCOUNT_FEATURES) as PortalAccountFeature[];

/** 세션 종류 → 계정 전용 기능 사용 가능 여부. 계정이 없는 세션(MRN·GUARDIAN)은 전부 false. */
export function portalAccountFeatures(kind: PortalSessionKind): Record<PortalAccountFeature, boolean> {
  return Object.fromEntries(PORTAL_ACCOUNT_FEATURE_KEYS.map((k) => [k, kind === 'ACCOUNT'])) as Record<PortalAccountFeature, boolean>;
}

/** 경로 → 계정 전용 기능(아니면 null). 쿼리·뒤 경로는 무시하고 가장 긴 접두사로 판정한다. */
export function portalAccountFeatureOfPath(path: string): PortalAccountFeature | null {
  const p = path.split('?')[0];
  let best: { k: PortalAccountFeature; len: number } | null = null;
  for (const k of PORTAL_ACCOUNT_FEATURE_KEYS) {
    for (const pre of PORTAL_ACCOUNT_FEATURES[k]) {
      if ((p === pre || p.startsWith(`${pre}/`)) && (!best || pre.length > best.len)) best = { k, len: pre.length };
    }
  }
  return best?.k ?? null;
}

/** `GET /api/v1/portal/session` 응답 계약 */
export interface PortalSessionInfo {
  kind: PortalSessionKind;
  features: Record<PortalAccountFeature, boolean>;
  /** 토큰 만료 시각(ISO) — 모르면 null */
  expiresAt: string | null;
  /**
   * 병원 설정으로 켜고 끄는 포털 기능 — 꺼진 기능은 화면이 부르지 않는다(종전엔 불러서 404 PORTAL_INPATIENT_LIFE_DISABLED 로 알았다).
   * `inpatientLife` = 설정 `portal.inpatientLife`(입원 식이·중간 정산).
   */
  services: { inpatientLife: boolean };
  /**
   * 포털 첫 안내(온보딩)를 이미 봤는가(2026-10-20).
   *  · ACCOUNT — 계정에 남긴 기록(보호자 위임은 보는 사람 = 보호자 계정) · completedAt null = 아직
   *  · DEVICE — 계정이 없는 등록번호 세션: 서버에 남길 곳이 없어 기기(브라우저)에만 남긴다 · completedAt 은 늘 null
   */
  onboarding: { scope: 'ACCOUNT' | 'DEVICE'; completedAt: string | null };
}
