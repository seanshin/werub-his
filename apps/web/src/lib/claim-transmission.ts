/**
 * 🔴 청구 전송 여부 해석 — **정본은 여기 하나다.**
 *
 * 배경(2026-08-20): `PATCH /claims/:id/submit` 은 심평원 전송 채널이 아직 없어
 * **전송하지 않고도** `status: 'SUBMITTED'` 로 남는다. `ClaimStatus` 가 Prisma enum 이라
 * `LOCAL_RECORDED` 같은 정직한 상태를 넣지 못했기 때문이다(스키마 승인 필요).
 * 그래서 **상태만 보면 '제출'로 읽힌다.** 미전송 근거는 `claimData.transmission` 에만 있다.
 * BE 는 이미 `submittedAt` 을 미전송이면 `null` 로 두지만, 화면이 그것을 읽지 않으면
 * 거짓말은 그대로 남는다 — 이 파일이 그 자리를 메운다.
 *
 * 🔴 3상태다. **모르는 것을 "전송됨"으로 접지 않는다.**
 */
export interface ClaimTransmission {
  outcome?: string | null;
  receiptNo?: string | null;
  transmittedAt?: string | null;
  recordedAt?: string | null;
  note?: string | null;
  manualFallback?: string | null;
}

export interface ClaimLike {
  status?: string;
  submittedAt?: string | null;
  claimData?: { transmission?: ClaimTransmission } | null;
}

export interface ClaimTransmitView {
  /** true=전송됨 · false=전송되지 않음 · null=근거가 없어 판정 불가 */
  transmitted: boolean | null;
  label: string;
  /** 화면에 함께 보일 사유·조치(없으면 null) */
  note: string | null;
}

/** 제출 시도가 있었던 상태인지 — 이 상태에서만 전송 여부를 따진다 */
const SUBMITTED_LIKE = new Set(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'PAID']);

export function claimTransmission(c: ClaimLike | null | undefined): ClaimTransmitView | null {
  if (!c?.status || !SUBMITTED_LIKE.has(c.status)) return null; // 제출 전 — 따질 것이 없다
  const t = c.claimData?.transmission;

  if (t?.outcome === 'SENT') {
    return { transmitted: true, label: '전송됨', note: t.receiptNo ? `접수번호 ${t.receiptNo}` : null };
  }
  if (t?.outcome) {
    return {
      transmitted: false,
      label: '미전송',
      note: [t.note, t.manualFallback].filter(Boolean).join(' · ') || `전송 결과 ${t.outcome}`,
    };
  }
  // 🔴 근거가 없다 — 전송됐다고도, 안 됐다고도 말하지 않는다.
  //    (봉합 이전에 '제출'로 기록된 과거 건이 여기 들어온다)
  return {
    transmitted: null,
    label: '전송 여부 확인 불가',
    note: '전송 기록이 남아 있지 않은 건입니다 — 심평원 접수 여부를 별도로 확인하세요.',
  };
}
