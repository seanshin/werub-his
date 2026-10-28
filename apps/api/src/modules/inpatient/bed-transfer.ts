import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * 병상 이동(전실) 트랜잭션 단계 — 정본 하나(2026-09-30 추출).
 * 입원 화면 전실(`InpatientService.transfer`)과 PACU 퇴실 → 다른 병상(`PacuService.discharge`)이 **같은 함수**를 쓴다
 * (둘이 각자 병상을 옮기면 배정 이력·병상 상태 규칙이 갈라진다).
 *  · 신병상은 AVAILABLE 일 때만 선점(조건부 — 이중 배정 차단) · 구병상 반납 · 배정 이력 닫고 새로 · 입원의 bedId 갱신
 */
export async function transferBedInTx(
  tx: Prisma.TransactionClient,
  admission: { id: string; bedId: string },
  newBedId: string,
  reason: string | null,
  now: Date = new Date(),
  /** 신병상이 비어 있지 않을 때 던질 오류 — 경로마다 공개 계약이 다르다(입원 화면 400 · 입원 API 409) */
  onUnavailable: () => Error = () => new BadRequestException('New bed not available'),
) {
  if (newBedId === admission.bedId) throw new BadRequestException('현재 병상과 동일합니다.');
  const claimed = await tx.bed.updateMany({ where: { id: newBedId, status: 'AVAILABLE' }, data: { status: 'OCCUPIED' } });
  if (claimed.count === 0) throw onUnavailable();
  // 구병상 반납 — 점유 중일 때만(청소·정비 중으로 바뀐 병상을 '가용'으로 되돌리지 않는다)
  await tx.bed.updateMany({ where: { id: admission.bedId, status: 'OCCUPIED' }, data: { status: 'AVAILABLE' } });
  await tx.bedAssignment.updateMany({ where: { admissionId: admission.id, releasedAt: null }, data: { releasedAt: now } });
  await tx.bedAssignment.create({ data: { admissionId: admission.id, bedId: newBedId, assignedAt: now, reason } });
  // 병동이 바뀌면 전 병동 간호사의 담당 배정도 끝난다(2026-09-30) — 받는 병동이 새로 배정한다.
  // 🔴 종전엔 전동한 환자가 보낸 병동 간호사의 "내 담당"에 남아 그 병동 화면에서 계속 보였다. 같은 병동 전실은 그대로.
  const beds = await tx.bed.findMany({ where: { id: { in: [admission.bedId, newBedId] } }, select: { id: true, wardId: true } });
  const fromWard = beds.find((b) => b.id === admission.bedId)?.wardId;
  const toWard = beds.find((b) => b.id === newBedId)?.wardId;
  if (fromWard && toWard && fromWard !== toWard) {
    await tx.nursePatientAssignment.updateMany({ where: { admissionId: admission.id, releasedAt: null }, data: { releasedAt: now } });
  }
  return tx.admission.update({
    where: { id: admission.id }, data: { bedId: newBedId },
    include: { bed: { include: { ward: { select: { name: true } } } } },
  });
}
