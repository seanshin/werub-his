import type { Prisma } from '@prisma/client';

/**
 * 서명본 보존(2026-10-03) — 서명된 기록을 정정(SIGNED→AMENDED)하는 순간 직전 서명본을 남긴다.
 *
 * 🔴 종전 진료기록·퇴원요약 정정은 서명본을 **제자리에서 덮어썼다** — 정정 전 내용이 사라지고, 재서명하면 원래 서명 시각·
 *    서명자까지 덮였다. 감사 로그엔 바뀐 필드 **이름**만 남는다(값은 PHI 라 싣지 않는다). 간호기록은 처음부터 원본을 두고
 *    정정문을 새 행으로 남기는 방식이라 해당 없다.
 * 🔴 보존은 정정 쓰기와 **같은 트랜잭션** — "정정됐는데 이전 판 없음"을 남기지 않는다.
 */
export const SIGNED_RECORD_TYPES = ['ENCOUNTER', 'DISCHARGE_SUMMARY'] as const;
export type SignedRecordType = typeof SIGNED_RECORD_TYPES[number];

export async function preserveSignedVersion(
  tx: Prisma.TransactionClient,
  input: {
    patientId: string;
    recordType: SignedRecordType;
    recordId: string;
    signedAt: Date | null;
    signedBy: string | null;
    content: Record<string, unknown>;
    supersededBy: string | null;
    changedFields: string[];
    /** 정정 사유(선택) — 빈 문자열은 없음 */
    reason?: string | null;
  },
) {
  return tx.signedRecordVersion.create({
    data: {
      patientId: input.patientId,
      recordType: input.recordType,
      recordId: input.recordId,
      signedAt: input.signedAt,
      signedBy: input.signedBy,
      content: input.content as Prisma.InputJsonValue,
      supersededBy: input.supersededBy,
      changedFields: input.changedFields as Prisma.InputJsonValue,
      // 길이는 수정 DTO(MaxLength 500)가 막는다 — 여기서 조용히 자르지 않는다
      reason: input.reason?.trim() ? input.reason.trim() : null,
    },
    select: { id: true },
  });
}

/** 정정 요청이 실제로 건드린 항목 — undefined 는 "안 보냄"(정정하지 않음) */
export function touchedFields(dto: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.filter((f) => dto[f] !== undefined);
}
