import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 진료 스케줄 시드 — 접수/의사 자동배정/길안내 동작용
// 의사별 7일(dayOfWeek 0~6) period 'ALL'(시간무관) 생성. 멱등(기존 있으면 스킵).
// 실행: npx ts-node prisma/seed-clinic-schedule.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_DEPT = '가정의학과';
const normDept = (d?: string | null) => (d ? d.replace(/\(.+\)/, '').trim() : '') || DEFAULT_DEPT;

async function main() {
  const doctors = await prisma.user.findMany({
    where: { role: 'DOCTOR', isActive: true },
    select: { id: true, department: true, familyName: true, givenName: true },
  });
  if (!doctors.length) { console.error('의사(DOCTOR) 없음'); return; }

  let created = 0, skipped = 0;
  const deptCount = new Map<string, number>();

  for (const doc of doctors) {
    const existing = await prisma.clinicSchedule.count({ where: { doctorId: doc.id } });
    if (existing > 0) { skipped++; continue; }
    const dept = normDept(doc.department);
    const n = (deptCount.get(dept) ?? 0) + 1;
    deptCount.set(dept, n);
    const room = `${dept} ${n}진료실`;
    for (let dow = 0; dow <= 6; dow++) {
      await prisma.clinicSchedule.create({
        data: {
          doctorId: doc.id, departmentName: dept, roomName: room,
          dayOfWeek: dow, period: 'ALL', startTime: '09:00', endTime: '18:00',
          maxPatients: 30, isActive: true,
        },
      });
    }
    created++;
  }
  console.log(`✅ 진료 스케줄 시드: 의사 ${created}명(각 7일·종일), 스킵 ${skipped}명`);
  console.log('진료과:', [...deptCount.entries()].map(([d, c]) => `${d}(${c})`).join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
