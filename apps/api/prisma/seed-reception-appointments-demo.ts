import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 접수(/reception) 예약 탭 데모 시드 — 오늘 예약 20명(SCHEDULED/CONFIRMED·과·시간대 분산).
// 멱등: 결정적 id(a0000000-0000-4000-9000-{YYYYMMDD}00{NN}) upsert — 같은 날 재실행 스킵.
// 실행: npx ts-node prisma/seed-reception-appointments-demo.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TOTAL = 20;
const EXCLUDE = ['영상의학과(판독)', '건강검진센터(의사)'];
const REASONS = ['정기 외래', '재진 상담', '검사결과 확인', '만성질환 관리', '수술 후 경과', '초진 상담', '예방접종 상담', '통증 재평가'];

async function main() {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

  const doctors = await prisma.user.findMany({
    where: { role: 'DOCTOR', isActive: true, department: { notIn: EXCLUDE, not: null } },
    select: { id: true, department: true },
    orderBy: { email: 'asc' },
  });
  if (!doctors.length) { console.error('의사 없음'); return; }

  const patients = await prisma.patient.findMany({ select: { id: true }, skip: 300, take: 100, orderBy: { createdAt: 'asc' } });
  if (patients.length < TOTAL) { console.error('환자 부족'); return; }

  // 오늘 09:00~17:30 사이 30분 간격 슬롯에 분산(이미 지난 시간대 일부 포함 — 접수 처리 데모용)
  const base = new Date(now); base.setHours(9, 0, 0, 0);

  let created = 0, skipped = 0;
  for (let i = 0; i < TOTAL; i++) {
    const id = `a0000000-0000-4000-9000-${dateKey}00${String(i).padStart(2, '0')}`;
    const doctor = doctors[i % doctors.length];
    const scheduledAt = new Date(base.getTime() + i * 30 * 60_000); // 9:00, 9:30, …
    const confirmed = i % 3 === 0; // 1/3은 확정(CONFIRMED)
    const res = await prisma.appointment.upsert({
      where: { id },
      update: {},
      create: {
        id,
        patientId: patients[i].id,
        doctorId: doctor.id,
        scheduledAt,
        duration: 30,
        status: confirmed ? 'CONFIRMED' : 'SCHEDULED',
        type: i % 2 === 0 ? 'FOLLOW_UP' : 'INITIAL',
        reason: REASONS[i % REASONS.length],
        departmentName: doctor.department,
        slotPeriod: scheduledAt.getHours() < 12 ? 'AM' : 'PM',
        bookedVia: i % 4 === 0 ? 'PORTAL' : 'STAFF',
        ...(confirmed ? { confirmedAt: new Date(scheduledAt.getTime() - 86400_000) } : {}),
      },
    });
    if (res.createdAt.getTime() > now.getTime() - 60_000) created++; else skipped++;
  }
  console.log(`접수 예약 시드: 오늘 ${TOTAL}건 — 생성 ${created}·기존 ${skipped} (09:00~ 30분 간격·과 분산·CONFIRMED ${Math.ceil(TOTAL / 3)}건)`);
}

main().finally(() => prisma.$disconnect());
