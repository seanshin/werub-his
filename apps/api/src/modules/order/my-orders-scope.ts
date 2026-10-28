import type { Prisma } from '@prisma/client';

/**
 * "내 오더" 정본 — 검사결과 확인함(`GET doctors/results-inbox`)·오더 목록 `mine=true` 가 같은 정의를 쓴다.
 *
 * 🔴 (2026-09-30) 대시보드 '검사결과 도착' 위젯은 `/orders?...&mine=true` 를 보냈는데 서버가 `mine` 을
 *    **조용히 무시**해 병원 전체 결과가 "내 결과"처럼 보였다. 정의를 한 곳에 두지 않으면 두 소비처가 갈라진다.
 *
 * 내 오더 = 다음 중 하나라도 나인 처방에서 나온 오더:
 *  · `prescriberId` — 책임 처방의(위임·대리 입력 시 지정된 의사)
 *  · `createdBy`    — 실제 입력자(책임 처방의 미지정이면 이 사람이 처방의다)
 *  · `encounter.doctorId` — 그 진료의 담당의(결과 통보 리스너가 알림을 보내는 사람과 같다)
 */
export function myOrdersPrescriptionWhere(userId: string): Prisma.PrescriptionWhereInput {
  return {
    OR: [
      { prescriberId: userId },
      { createdBy: userId },
      { encounter: { doctorId: userId } },
    ],
  };
}
