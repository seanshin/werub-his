import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 환자 마킹('루비'/VIP/지인) 샘플 — 일회성
 * 실행: npx ts-node prisma/seed-patient-flags.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const patients = await prisma.patient.findMany({ where: { mrn: { startsWith: 'P2026' } }, take: 12, orderBy: { mrn: 'asc' }, select: { id: true, familyName: true, givenName: true, mrn: true } });
  const staff = await prisma.user.findMany({ where: { isActive: true, role: { in: ['DOCTOR', 'NURSE', 'ADMIN'] as never } }, take: 20, select: { id: true } });
  if (patients.length < 6 || staff.length < 6) { console.log('환자/직원 데이터 부족'); return; }

  // 기존 샘플 마킹 정리(재실행 대비) — 본 시드가 만든 것만 비활성
  await prisma.patientFlag.deleteMany({ where: { patientId: { in: patients.map((p) => p.id) } } });

  const reasons = ['진료 중 폭언·위협', '반복 무단취소·노쇼', '직원 대상 민원·고성', '수납 거부 이력', '비협조적 행동'];
  let ruby = 0, vip = 0, acq = 0;

  // 루비(악성): 환자별로 서로 다른 직원 N명이 표시 → 카운트 1/2/3/5/8
  const counts = [8, 5, 3, 2, 1];
  for (let i = 0; i < counts.length; i++) {
    const p = patients[i];
    for (let k = 0; k < counts[i]; k++) {
      const flagger = staff[k % staff.length];
      await prisma.patientFlag.create({ data: { patientId: p.id, flagType: 'MALICIOUS', flaggedBy: flagger.id, reason: reasons[k % reasons.length] } }).catch(() => {});
      ruby++;
    }
  }

  // VIP: 2명 — 누구의 VIP인지(직원) 지정
  for (let i = 5; i < 7; i++) {
    const p = patients[i];
    await prisma.patientFlag.create({ data: { patientId: p.id, flagType: 'VIP', flaggedBy: staff[0].id, relatedUserId: staff[i % staff.length].id, reason: '병원장 소개 VIP' } }).catch(() => {});
    vip++;
  }

  // 직원 지인/가족: 2명
  const rels = ['FAMILY', 'FRIEND'];
  for (let i = 7; i < 9; i++) {
    const p = patients[i];
    await prisma.patientFlag.create({ data: { patientId: p.id, flagType: 'ACQUAINTANCE', flaggedBy: staff[1].id, relatedUserId: staff[(i + 2) % staff.length].id, relation: rels[i % 2] } }).catch(() => {});
    acq++;
  }

  console.log(`샘플 마킹 생성 — 루비 ${ruby}건(환자 ${counts.length}명) / VIP ${vip}명 / 지인 ${acq}명`);
  console.log(`루비 카운트 예시: ${patients[0].familyName}${patients[0].givenName} 💎${counts[0]}, ${patients[1].familyName}${patients[1].givenName} 💎${counts[1]}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
