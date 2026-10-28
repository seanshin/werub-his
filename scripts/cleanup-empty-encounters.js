const { PrismaClient } = require('../apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const all = await prisma.encounter.findMany({
    select: {
      id: true, subjective: true, objective: true, assessment: true, plan: true,
      prescriptions: { select: { id: true } },
      diagnoses: { select: { id: true } },
    },
  });

  const toDelete = all.filter(e =>
    !(e.subjective || '').trim() &&
    !(e.objective || '').trim() &&
    !(e.assessment || '').trim() &&
    !(e.plan || '').trim() &&
    e.prescriptions.length === 0 &&
    e.diagnoses.length === 0
  );

  console.log(`전체: ${all.length}건, 빈 진료기록(처방/진단 없음): ${toDelete.length}건`);

  if (toDelete.length > 0) {
    const ids = toDelete.map(e => e.id);
    const result = await prisma.encounter.deleteMany({ where: { id: { in: ids } } });
    console.log(`삭제 완료: ${result.count}건`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
