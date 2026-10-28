import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * 상번 인수 쓰기 정본(2026-10-26) — 간호 스테이션 "담당 인수" 단추와 인계 "늘 묶음" 인수 확인이 같은 함수로 쓴다
 * (한 곳만 고치면 "내 담당"이 두 사람에게 보이던 결함이 한쪽에서 되살아난다).
 * 그 입원의 **다른 간호사** 활성 배정은 같은 트랜잭션에서 해제한다 · 이미 내 배정이면 새로 만들지 않는다.
 */
export async function takeOverInTx(tx: Prisma.TransactionClient, nurseId: string, admissionId: string, shiftType: string) {
  const adm = await tx.admission.findUnique({ where: { id: admissionId }, select: { status: true } });
  if (!adm) throw new NotFoundException({ code: 'ADMISSION_NOT_FOUND', message: 'Admission not found' });
  if (adm.status !== 'ADMITTED') throw new BadRequestException({ code: 'ADMISSION_NOT_ACTIVE', message: 'Only admitted patients can be taken over' });
  const now = new Date();
  const released = await tx.nursePatientAssignment.updateMany({
    where: { admissionId, releasedAt: null, nurseId: { not: nurseId } },
    data: { releasedAt: now },
  });
  const mine = await tx.nursePatientAssignment.findFirst({ where: { nurseId, admissionId, releasedAt: null } });
  const assignment = mine ?? await tx.nursePatientAssignment.create({
    data: { nurseId, admissionId, shiftType, isPrimary: true, assignedBy: nurseId, assignedAt: now },
  });
  return { assignment, releasedOthers: released.count, alreadyMine: !!mine };
}
