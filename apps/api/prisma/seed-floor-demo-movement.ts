import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 데모 동선 데이터 — 2층 외래 다단계 환자 이동(대기→진료→검사→영상)
// flows/events/history 시연용. 재실행 가능(metadata.demo=true 정리 후 재생성).
// 실행: npx ts-node prisma/seed-floor-demo-movement.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 2층 외래 동선 경로(존 code) — 다양한 전이가 나오도록 여러 패턴
const PATHS: string[][] = [
  ['F2-IM-W', 'F2-IM-201', 'F2-LAB', 'F2-IMG'],
  ['F2-IM-W', 'F2-IM-202', 'F2-LAB'],
  ['F2-SG-W', 'F2-SG-203', 'F2-IMG'],
  ['F2-IM-W', 'F2-IM-201', 'F2-EKG'],
  ['F2-SG-W', 'F2-OS-206', 'F2-LAB', 'F2-IMG'],
  ['F2-IM-W', 'F2-IM-201'],
  ['F2-IM-W', 'F2-PD-204', 'F2-LAB'],
  ['F2-SG-W', 'F2-ENT-207', 'F2-EKG'],
];
const STATUS: Record<string, string> = {
  WAITING: 'waiting', CLINIC: 'in-treatment', LAB: 'in-lab', IMAGING: 'in-lab', EKG: 'in-lab',
};
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  // 2층 존 code→{id,spaceType}
  const codes = [...new Set(PATHS.flat())];
  const zones = await prisma.spaceNode.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, spaceType: true } });
  const zmap = new Map(zones.map((z) => [z.code!, z]));
  const missing = codes.filter((c) => !zmap.has(c));
  if (missing.length) console.warn('누락 존(스킵):', missing.join(','));

  // 데모 대상 환자 24명
  const patients = await prisma.patient.findMany({ take: 24, select: { id: true }, orderBy: { createdAt: 'desc' } });
  if (!patients.length) { console.error('환자 없음'); return; }

  // 기존 데모 위치 정리(재실행 idempotent)
  const del = await prisma.patientLocation.deleteMany({
    where: { patientId: { in: patients.map((p) => p.id) }, metadata: { path: ['demo'], equals: true } },
  });
  console.log(`기존 데모 위치 삭제: ${del.count}`);

  let created = 0;
  const now = Date.now();
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i];
    const path = pick(PATHS).filter((c) => zmap.has(c));
    if (path.length < 2) continue;
    // 시작: 최근 0~180분 전
    let t = now - rand(10, 180) * 60000;
    const leaveLast = Math.random() < 0.6; // 40%는 현재 진행중(active)
    for (let s = 0; s < path.length; s++) {
      const z = zmap.get(path[s])!;
      const isLast = s === path.length - 1;
      const dwell = rand(5, 28); // 분
      const enteredAt = new Date(t);
      const active = isLast && !leaveLast;
      const leftAt = active ? null : new Date(t + dwell * 60000);
      await prisma.patientLocation.create({
        data: {
          patientId: p.id,
          zoneId: z.id,
          status: STATUS[z.spaceType] ?? 'moving',
          enteredAt,
          leftAt,
          duration: active ? null : dwell,
          source: 'SIMULATED', // 데모 이동(난수 체류) — P0-1
          eventType: 'DEMO_MOVEMENT',
          metadata: { demo: true },
        },
      });
      created++;
      t += dwell * 60000;
    }
  }
  console.log(`✅ 데모 동선 생성: ${created} 위치 / ${patients.length} 환자 (2층 외래)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
