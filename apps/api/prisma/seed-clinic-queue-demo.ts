import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 진료실 대기(/clinic-queue) 데모 시드 — 과별 대기 환자 10명씩 오늘 날짜로 생성.
// 멱등: waitingToken(`dcq-YYYYMMDD-과-순번`) unique 기준 — 같은 날 재실행 시 스킵.
// 실행: npx ts-node prisma/seed-clinic-queue-demo.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PER_DEPT = 10;
// 비진료성 부서 제외(판독·검진센터·영상)
const EXCLUDE = ['영상의학과(판독)', '영상의학과', '건강검진센터(의사)'];
const REASONS = ['정기 진료', '감기 증상', '복통', '두통·어지럼', '검사결과 상담', '재처방', '피부 발진', '관절 통증', '건강 상담', '어제부터 발열'];

async function main() {
  const today = new Date();
  const dateKey = today.toISOString().slice(0, 10).replace(/-/g, '');

  const doctors = await prisma.user.findMany({
    where: { role: 'DOCTOR', isActive: true, department: { notIn: EXCLUDE } },
    select: { id: true, department: true },
  });
  const byDept = new Map<string, string[]>();
  for (const d of doctors) {
    if (!d.department) continue;
    byDept.set(d.department, [...(byDept.get(d.department) ?? []), d.id]);
  }
  if (!byDept.size) { console.error('의사(DOCTOR) 없음'); return; }

  const patients = await prisma.patient.findMany({ select: { id: true }, take: 500, orderBy: { createdAt: 'asc' } });
  if (patients.length < PER_DEPT) { console.error('환자 부족'); return; }

  let created = 0, skipped = 0, pi = 0;
  const depts = [...byDept.keys()].sort();

  for (const dept of depts) {
    const docIds = byDept.get(dept)!;
    // 오늘 해당 과 기존 최대 순번 이어서 채번
    const agg = await prisma.waitingQueue.aggregate({
      where: { departmentName: dept, checkedInAt: { gte: new Date(today.toISOString().slice(0, 10)) } },
      _max: { queueNumber: true },
    });
    let seq = (agg._max.queueNumber ?? 0) + 1;

    for (let i = 0; i < PER_DEPT; i++) {
      const token = `dcq-${dateKey}-${dept}-${i}`;
      const exists = await prisma.waitingQueue.findUnique({ where: { waitingToken: token }, select: { id: true } });
      if (exists) { skipped++; continue; }
      const patient = patients[pi++ % patients.length];
      // 접수 시각을 최근 90분에 분산(먼저 온 순서대로 순번)
      const checkedInAt = new Date(today.getTime() - (PER_DEPT - i) * 9 * 60_000);
      await prisma.waitingQueue.create({
        data: {
          patientId: patient.id,
          doctorId: docIds[i % docIds.length],
          departmentName: dept,
          queueNumber: seq++,
          type: i % 3 === 0 ? 'APPOINTMENT' : 'WALK_IN',
          visitType: i % 2 === 0 ? 'FOLLOW_UP' : 'INITIAL',
          reason: REASONS[i % REASONS.length],
          status: 'WAITING',
          waitingToken: token,
          checkedInAt,
        },
      });
      created++;
    }
  }
  console.log(`진료실 대기 시드: ${depts.length}개 과 × ${PER_DEPT} — 생성 ${created}·스킵 ${skipped}`);
  console.log(`과: ${depts.join(', ')}`);
}

main().finally(() => prisma.$disconnect());
