require('./seed-mode-guard').assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// CSSD 재포장 시드 — 트레이 마스터 + 멸균 패키지(LOT) + 멸균 로드. 멱등.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const TEMPLATES = [
  { name: '일반 수술 세트', category: '외과', pack: 'CONTAINER', life: 30, items: [['메스 핸들', 2], ['지혈 겸자', 8], ['가위(메이요)', 2], ['포셉', 4], ['니들 홀더', 2]] },
  { name: '정형외과 세트', category: '정형외과', pack: 'CONTAINER', life: 30, items: [['골절기', 1], ['리트랙터', 4], ['본 커터', 1], ['엘리베이터', 3]] },
  { name: '복강경 수술 세트', category: '외과', pack: 'WRAP', life: 21, items: [['투관침', 4], ['그래스퍼', 3], ['클립 어플라이어', 1], ['카메라 포트', 1]] },
  { name: '제왕절개 세트', category: '산부인과', pack: 'CONTAINER', life: 30, items: [['메스 핸들', 2], ['앨리스 겸자', 6], ['리트랙터', 2], ['제대 가위', 1]] },
  { name: '드레싱 세트', category: '외래', pack: 'POUCH', life: 14, items: [['포셉', 2], ['가위', 1], ['거즈', 10]] },
  { name: '봉합 세트', category: '응급', pack: 'POUCH', life: 14, items: [['니들 홀더', 1], ['포셉', 1], ['봉합 가위', 1], ['지혈 겸자', 2]] },
  { name: '기관삽관 세트', category: '중환자', pack: 'WRAP', life: 30, items: [['후두경 블레이드', 3], ['기관내관', 4], ['스타일렛', 2]] },
  { name: '백내장 수술 세트', category: '안과', pack: 'POUCH', life: 21, items: [['미세 포셉', 4], ['낭절개침', 1], ['I/A 팁', 1], ['미세 가위', 2]] },
];

async function main() {
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  const by = user?.id ?? null;
  const tmplMap = {};
  for (const t of TEMPLATES) {
    const tm = await prisma.instrumentSetTemplate.upsert({
      where: { name: t.name },
      update: { category: t.category, packagingType: t.pack, shelfLifeDays: t.life, items: t.items.map(([name, qty]) => ({ name, qty })) },
      create: { name: t.name, category: t.category, packagingType: t.pack, shelfLifeDays: t.life, items: t.items.map(([name, qty]) => ({ name, qty })) },
    });
    tmplMap[t.name] = tm;
  }

  // 기존 패키지/로드 정리(시드 멱등) — LOT 접두 SEED
  await prisma.packageEvent.deleteMany({ where: { package: { lotNo: { startsWith: 'SEED' } } } }).catch(() => {});
  await prisma.sterilePackage.deleteMany({ where: { lotNo: { startsWith: 'SEED' } } }).catch(() => {});

  let seq = 0;
  const mk = async (tname, status, expDays) => {
    seq++;
    const tm = tmplMap[tname];
    const lot = `SEED-${String(seq).padStart(3, '0')}`;
    const sterilizable = status === 'STERILE' || status === 'IN_USE' || status === 'EXPIRED';
    const pkg = await prisma.sterilePackage.create({
      data: {
        lotNo: lot, templateId: tm.id, templateName: tm.name, status,
        packagingType: tm.packagingType, countVerified: true, assembledBy: by,
        packagedAt: day(-2), location: '중앙공급실 보관',
        sterilizedAt: sterilizable ? day(expDays - tm.shelfLifeDays) : null,
        expiresAt: expDays != null ? day(expDays) : null,
      },
    });
    await prisma.packageEvent.create({ data: { packageId: pkg.id, action: '조립·포장', by, note: `LOT ${lot}`, createdAt: day(-2) } });
    if (sterilizable) await prisma.packageEvent.create({ data: { packageId: pkg.id, action: '멸균 합격', by, createdAt: day(-1) } });
    return pkg;
  };

  await mk('일반 수술 세트', 'STERILE', 25);
  await mk('일반 수술 세트', 'STERILE', 2);   // 임박
  await mk('정형외과 세트', 'STERILE', 18);
  await mk('드레싱 세트', 'STERILE', 1);       // 임박
  await mk('봉합 세트', 'STERILE', 10);
  await mk('백내장 수술 세트', 'IN_USE', 20);
  await mk('제왕절개 세트', 'EXPIRED', -2);     // 만료
  const p1 = await mk('복강경 수술 세트', 'PACKAGED', null);
  const p2 = await mk('기관삽관 세트', 'PACKAGED', null);

  // 멸균 로드(판독 대기) — PACKAGED 2건 투입
  const load = await prisma.sterilizationLoad.create({
    data: { loadNo: 'SEED-L-001', sterilizer: 'STERIS V-PRO 1', program: 'STEAM', tempC: 134, durationMin: 30, operatorId: by, startedAt: day(0) },
  });
  await prisma.sterilePackage.updateMany({ where: { id: { in: [p1.id, p2.id] } }, data: { status: 'IN_LOAD', loadId: load.id } });

  console.log(`✅ CSSD 재포장 시드: 트레이 ${TEMPLATES.length}종, 패키지 ${seq}건, 로드 1건(판독대기)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
