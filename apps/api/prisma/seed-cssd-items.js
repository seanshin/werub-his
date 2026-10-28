require('./seed-mode-guard').assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// CSSD 기구 품목 마스터 + 공급사 시드. 멱등(code unique).
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SUPPLIERS = [
  { name: '(주)메드텍', contact: '김영업', phone: '02-555-1200' },
  { name: '대한의료기', contact: '박담당', phone: '031-700-3400' },
  { name: '글로벌서지컬', contact: 'J.Park', phone: '02-888-9900' },
];
// [code, name, category, spec, stock, safety, location]
const ITEMS = [
  ['INS-0001', '메스 핸들 #3', '절단', '표준', 60, 15, '선반 A-1'],
  ['INS-0002', '메이요 가위', '절단', '14cm', 40, 10, '선반 A-2'],
  ['INS-0003', '메첸바움 가위', '절단', '18cm', 24, 8, '선반 A-2'],
  ['INS-0004', '지혈 겸자(켈리)', '지혈', '16cm', 120, 30, '선반 B-1'],
  ['INS-0005', '모스키토 겸자', '지혈', '12cm', 90, 25, '선반 B-1'],
  ['INS-0006', '앨리스 겸자', '지혈', '15cm', 50, 12, '선반 B-2'],
  ['INS-0007', '니들 홀더', '봉합', '15cm', 45, 10, '선반 C-1'],
  ['INS-0008', '조직 포셉', '견인', '표준', 80, 20, '선반 C-2'],
  ['INS-0009', '리트랙터(견인기)', '견인', '중형', 30, 8, '선반 C-3'],
  ['INS-0010', '석션 팁', '세척', '표준', 70, 20, '선반 D-1'],
  ['INS-0011', '봉합 가위', '절단', '소형', 35, 10, '선반 A-3'],
  ['INS-0012', '거즈(멸균)', '세척', '10x10', 8, 50, '선반 D-2'],   // 부족(안전재고 미달)
  ['INS-0013', '제대 가위', '절단', '산과용', 6, 8, '선반 A-3'],     // 부족
  ['INS-0014', '투관침(트로카)', '기타', '5mm', 20, 6, '선반 E-1'],
  ['INS-0015', '후두경 블레이드', '기타', 'Mac 3', 18, 6, '선반 E-2'],
  ['INS-0016', '미세 포셉', '견인', '안과용', 28, 8, '선반 F-1'],
];

async function main() {
  const sup = {};
  for (const s of SUPPLIERS) {
    let row = await prisma.supplier.findFirst({ where: { name: s.name } });
    if (!row) row = await prisma.supplier.create({ data: s });
    sup[s.name] = row;
  }
  const supList = Object.values(sup);
  let created = 0;
  for (let i = 0; i < ITEMS.length; i++) {
    const [code, name, category, spec, stock, safety, location] = ITEMS[i];
    const supplier = supList[i % supList.length];
    const exist = await prisma.instrumentItem.findUnique({ where: { code } });
    if (exist) {
      await prisma.instrumentItem.update({ where: { code }, data: { name, category, spec, stock, safetyStock: safety, location, supplierId: supplier.id } });
    } else {
      const it = await prisma.instrumentItem.create({ data: { code, name, category, spec, unit: '개', stock, safetyStock: safety, location, supplierId: supplier.id } });
      await prisma.supplyTransaction.create({ data: { itemId: it.id, type: 'IN', qty: stock, balanceAfter: stock, reason: '초기 재고' } });
      created++;
    }
  }
  const low = (await prisma.instrumentItem.findMany()).filter(i => i.stock <= i.safetyStock).length;
  console.log(`✅ CSSD 품목 시드: 공급사 ${SUPPLIERS.length}, 품목 ${ITEMS.length}(신규 ${created}), 안전재고 미달 ${low}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
