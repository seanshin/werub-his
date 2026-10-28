/**
 * 책임 처방의(responsible prescriber) — **정본 규약 하나**.
 *
 * `Prescription.prescriberId` 는 위임·대리 입력 시 지정된 책임 처방의이고, 미지정이면 실제 입력자(`createdBy`)가
 * 책임 처방의다(스키마 주석 "미지정=createdBy"). 처방 취소 권한(prescription.service `cancel`)·오더 서명 로그
 * (order-sign-log)·기록 시계열이 각자 `prescriberId ?? createdBy` 를 적어 왔다.
 *
 * 🔴 약사 중재 회신·대체조제 승인이 "누구의 처방인가"를 **각자 다른 규칙으로** 정하면 갈라진다
 *    (한쪽은 입력자, 한쪽은 지정의 — 같은 처방에 대해 회신할 수 있는 의사가 둘이 된다).
 *    새 소비처는 여기를 부른다.
 */
export function responsiblePrescriberOf(rx: { prescriberId: string | null; createdBy: string }): string {
  return rx.prescriberId ?? rx.createdBy;
}

/** Prisma where 조각 — "이 사용자가 책임 처방의인 처방" (위 규약과 같은 판정) */
export function prescribedByWhere(userId: string) {
  return {
    OR: [
      { prescriberId: userId },
      { prescriberId: null, createdBy: userId },
    ],
  };
}
