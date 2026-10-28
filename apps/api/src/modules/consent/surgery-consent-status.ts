/**
 * 수술 전 필수 동의서(수술·마취·수혈) 상태 판정 — 순수 함수.
 *
 * 🔴 수술 준비 워크스테이션이 세 동의서를 **상수 "확인 필요"** 로 그리고 있었다(P15 — 화면이 상태를 지어냄).
 *    서명된 환자에게도 "확인 필요", 동의서가 아예 없는 환자에게도 "확인 필요"라 **아무것도 말하지 않았다.**
 *
 * 대조 규칙(화면에도 그대로 밝힌다):
 *   1) `surgeryId` 가 주어지고 그 수술에 **연결된**(`ConsentForm.surgeryId`) 같은 종류 동의서가 있으면 그것만 본다 — `SURGERY_ID`.
 *   2) 없으면 **같은 환자 · 같은 종류(consentType) · 최근 windowDays 일 안에 작성된** 동의서로 느슨하게 대조한다 — `PATIENT_WINDOW`.
 *      이때 **다른 수술에 연결된** 동의서는 빼고(그 수술의 것이다), 수술을 모르면(surgeryId 없음) 뺄 근거가 없어 포함한다.
 *   🔴 2) 는 "이 수술의 동의서"라는 보증이 아니다 — 화면은 느슨한 대조임을 그 자리에서 말한다.
 *   🔴 현재 동의서 작성 경로 중 `surgeryId` 를 채우는 곳이 없다(2026-09-30 실측) — 그래서 1) 은 대개 비어 있고 2) 가 주로 쓰인다.
 *
 * 상태: SIGNED(유효한 서명본 있음) · PENDING(작성됐으나 미서명) · NONE(유효한 동의서 없음).
 *   철회(REVOKED·isValid=false)·개정 대체(supersededAt)·만료(expiresAt 경과)는 유효하지 않다.
 *   서명 판정은 LIS 동의 조회(`lis-reference.service`)와 같은 기준 — `status==='SIGNED' || signedAt`.
 *   "조회 실패"는 이 함수가 아니라 화면의 3번째 상태다(조회가 실패하면 여기까지 오지 않는다).
 */

export const SURGERY_CONSENT_TYPES = ['SURGERY', 'ANESTHESIA', 'TRANSFUSION'] as const;
export type SurgeryConsentType = (typeof SURGERY_CONSENT_TYPES)[number];

export type SurgeryConsentState = 'SIGNED' | 'PENDING' | 'NONE';
export type SurgeryConsentMatch = 'SURGERY_ID' | 'PATIENT_WINDOW';

export interface ConsentRowForStatus {
  id: string;
  consentType: string | null;
  status: string | null;
  signedAt: Date | null;
  surgeryId: string | null;
  createdAt: Date;
  isValid: boolean;
  revokedAt: Date | null;
  supersededAt: Date | null;
  expiresAt: Date | null;
}

export interface SurgeryConsentItem {
  consentType: SurgeryConsentType;
  state: SurgeryConsentState;
  /** 어떤 규칙으로 찾은 동의서인가 — NONE 이면 null(찾은 것이 없다) */
  matchedBy: SurgeryConsentMatch | null;
  consentId: string | null;
  signedAt: Date | null;
  createdAt: Date | null;
}

export const DEFAULT_CONSENT_WINDOW_DAYS = 30;

const isCurrent = (r: ConsentRowForStatus, now: number) =>
  r.isValid && !r.revokedAt && r.status !== 'REVOKED' && r.status !== 'EXPIRED' && !r.supersededAt
  && !(r.expiresAt && r.expiresAt.getTime() < now);

const isSigned = (r: ConsentRowForStatus) => r.status === 'SIGNED' || !!r.signedAt;

export function deriveSurgeryConsentStatus(
  rows: ConsentRowForStatus[],
  opts: { surgeryId?: string | null; since: Date; now?: Date },
): SurgeryConsentItem[] {
  const now = (opts.now ?? new Date()).getTime();
  const surgeryId = opts.surgeryId ?? null;
  // 최신 우선
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return SURGERY_CONSENT_TYPES.map((t): SurgeryConsentItem => {
    const ofType = sorted.filter((r) => r.consentType === t);
    const linked = surgeryId ? ofType.filter((r) => r.surgeryId === surgeryId) : [];
    let matchedBy: SurgeryConsentMatch = 'SURGERY_ID';
    let pool = linked;
    if (pool.length === 0) {
      matchedBy = 'PATIENT_WINDOW';
      pool = ofType.filter((r) =>
        r.createdAt.getTime() >= opts.since.getTime()
        && (!surgeryId || !r.surgeryId || r.surgeryId === surgeryId),
      );
    }
    const current = pool.filter((r) => isCurrent(r, now));
    const signed = current.find(isSigned);
    const pending = current.find((r) => !isSigned(r));
    const hit = signed ?? pending ?? null;
    if (!hit) return { consentType: t, state: 'NONE', matchedBy: null, consentId: null, signedAt: null, createdAt: null };
    return {
      consentType: t,
      state: signed ? 'SIGNED' : 'PENDING',
      matchedBy,
      consentId: hit.id,
      signedAt: hit.signedAt,
      createdAt: hit.createdAt,
    };
  });
}
