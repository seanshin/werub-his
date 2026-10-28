import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 소득분위 데모 시드 — 전 환자에 현실적 분포(1~10) 결정적 배정. 추가·멱등.
 * 실운영은 NHIS 자격조회에서 수신. 실행: npx ts-node --transpile-only prisma/seed-income-decile.ts
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
const prisma = new PrismaClient();

async function main() {
  const patients = await prisma.patient.findMany({ select: { id: true } });
  let updated = 0;
  for (const p of patients) {
    // 결정적 분위(id 해시 기반 1~10, 중간분위 가중)
    const h = parseInt(createHash('md5').update(p.id).digest('hex').slice(0, 8), 16);
    const dist = [3, 4, 4, 5, 5, 5, 6, 6, 7, 8, 2, 9, 5, 6, 4]; // 중간 가중 분포
    const decile = dist[h % dist.length];
    await prisma.patient.update({ where: { id: p.id }, data: { incomeDecile: decile } });
    updated++;
  }
  console.log(`소득분위 시드 — ${updated}명 배정(현실적 분포·결정적)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
