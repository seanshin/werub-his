import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 데모 예약/오더 — 2층 현재 환자의 "다음 행선지"(schedule #8) 시연용
// - 미래 SCHEDULED Appointment(consult) 신규 + 기존 Prescription에 pending Order(lab/imaging) 추가
// - 멱등: 이미 미래 예약/대기 오더 있으면 스킵. 실행: npx ts-node prisma/seed-floor-demo-schedule.ts
import { PrismaClient, OrderDepartment } from '@prisma/client';

const prisma = new PrismaClient();
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  // 2층 존
  const floor = await prisma.spaceNode.findFirst({ where: { code: '2f', nodeType: 'FLOOR' } });
  if (!floor) { console.error('2f 없음'); return; }
  const children = await prisma.spaceNode.findMany({ where: { parentId: floor.id }, select: { id: true } });
  const zoneIds = children.map((c) => c.id);

  // 현재 2층 환자
  const locs = await prisma.patientLocation.findMany({ where: { zoneId: { in: zoneIds }, leftAt: null }, select: { patientId: true } });
  const patientIds = [...new Set(locs.map((l) => l.patientId))];
  if (!patientIds.length) { console.log('2층 현재 환자 없음'); return; }
  console.log(`2층 현재 환자 ${patientIds.length}명`);

  const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true }, select: { id: true } });
  if (!doctors.length) { console.error('의사 없음'); return; }

  // 환자별 기존 prescription (오더용 재사용)
  const pres = await prisma.prescription.findMany({
    where: { encounter: { patientId: { in: patientIds } } },
    select: { id: true, encounter: { select: { patientId: true } } },
  });
  const presByPatient = new Map<string, string>();
  for (const p of pres) if (p.encounter?.patientId && !presByPatient.has(p.encounter.patientId)) presByPatient.set(p.encounter.patientId, p.id);

  const ORDER_DEPTS: OrderDepartment[] = ['LAB', 'IMAGING', 'PHARMACY'];
  const now = Date.now();
  let appts = 0, orders = 0;

  for (let i = 0; i < patientIds.length; i++) {
    const pid = patientIds[i];
    const presId = presByPatient.get(pid);

    // 절반 + prescription 보유자는 오더(lab/imaging/pharmacy), 나머지는 예약(consult)
    if (presId && i % 2 === 0) {
      const pending = await prisma.order.count({ where: { prescriptionId: presId, status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } } });
      if (pending === 0) {
        await prisma.order.create({ data: { prescriptionId: presId, department: pick(ORDER_DEPTS), status: 'ORDERED' } });
        orders++;
      }
    } else {
      const fut = await prisma.appointment.count({ where: { patientId: pid, status: 'SCHEDULED', scheduledAt: { gte: new Date() } } });
      if (fut === 0) {
        await prisma.appointment.create({
          data: {
            patientId: pid,
            doctorId: pick(doctors).id,
            scheduledAt: new Date(now + rand(5, 55) * 60000),
            status: 'SCHEDULED',
            type: 'FOLLOW_UP',
            createdBy: pick(doctors).id,
          },
        });
        appts++;
      }
    }
  }
  console.log(`✅ 데모 스케줄: 예약 ${appts}건 + 오더 ${orders}건`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
