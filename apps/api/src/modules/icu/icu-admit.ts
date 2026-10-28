import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * ICU 입실 트랜잭션 단계 — 정본 하나(2026-09-30 추출).
 * ICU 화면 입실(`IcuService.admit`)과 PACU 퇴실 → ICU(`PacuService.discharge`)가 **같은 함수**를 쓴다.
 *  · ICU 병상은 AVAILABLE 일 때만 선점(조건부 — 동시 입실 한쪽만 성공) · 입실 기록 생성
 * 존재·이중입원 확인은 호출자가 먼저 한다(오류 문구를 호출 자리에 맞게).
 */
export async function admitIcuInTx(
  tx: Prisma.TransactionClient,
  data: { patientId: string; icuBedId: string; doctorId: string; admitReason: string; severity?: string; ventilator?: boolean; isolation?: boolean },
) {
  const upd = await tx.icuBed.updateMany({ where: { id: data.icuBedId, status: 'AVAILABLE' }, data: { status: 'OCCUPIED' } });
  if (upd.count === 0) throw new ConflictException('ICU 병상이 이미 사용 중입니다(동시 입원 충돌)');
  return tx.icuAdmission.create({
    data: {
      patientId: data.patientId, icuBedId: data.icuBedId, doctorId: data.doctorId,
      admitDate: new Date(), admitReason: data.admitReason,
      severity: data.severity, ventilator: data.ventilator ?? false, isolation: data.isolation ?? false,
    },
    include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } }, icuBed: true },
  });
}
