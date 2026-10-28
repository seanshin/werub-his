import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 혈액은행 보강 데모 시드 — P1~P3 신규 기능 시연(추가·멱등·비파괴)
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-blood-bank-demo.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
const prisma = new PrismaClient();
const uid = (s: string) => {
  const h = createHash('md5').update(`bb-demo:${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

async function main() {
  const user = (await prisma.user.findFirst({ where: { role: 'LAB_TECH' } }))
    ?? (await prisma.user.findFirst({ where: { role: 'DOCTOR' } }));
  if (!user) throw new Error('LAB_TECH/DOCTOR 사용자 없음');
  const patients = await prisma.patient.findMany({ take: 6, orderBy: { createdAt: 'desc' } });
  if (patients.length < 6) throw new Error('환자 6명 필요');

  let typings = 0, abs = 0;
  // P1: 환자 혈액형 6종(다양·1명 Rh-·1명 항체양성)
  const types = [
    { abo: 'A', rh: 'POS', ab: 'NEG' }, { abo: 'O', rh: 'NEG', ab: 'POS' },
    { abo: 'B', rh: 'POS', ab: 'NEG' }, { abo: 'AB', rh: 'POS', ab: 'NEG' },
    { abo: 'O', rh: 'POS', ab: 'NEG' }, { abo: 'A', rh: 'NEG', ab: 'POS' },
  ];
  for (let i = 0; i < 6; i++) {
    const t = types[i], p = patients[i];
    await prisma.patientBloodTyping.upsert({
      where: { patientId: p.id },
      update: { abo: t.abo, rh: t.rh, aboConfirm: t.abo, antibodyScreen: t.ab, method: '슬라이드+시험관', typedBy: user.id, typedAt: new Date() },
      create: { patientId: p.id, abo: t.abo, rh: t.rh, aboConfirm: t.abo, antibodyScreen: t.ab, method: '슬라이드+시험관', typedBy: user.id },
    });
    typings++;
    // 항체양성 환자에 불규칙항체 이력
    if (t.ab === 'POS') {
      const abId = uid(`ab-${i}`);
      await prisma.patientAntibody.upsert({
        where: { id: abId },
        update: {},
        create: { id: abId, patientId: p.id, antibody: i === 1 ? 'anti-E' : 'anti-K', significance: 'SIGNIFICANT', identifiedBy: user.id, notes: '항글로불린법 동정' },
      });
      abs++;
    }
  }

  // P1: 대량수혈 프로토콜 — O- 환자(idx1) 외상 활성화(중복 방지)
  const mtpPatient = patients[1];
  const existingMtp = await prisma.massiveTransfusionProtocol.findFirst({ where: { patientId: mtpPatient.id, status: 'ACTIVE' } });
  if (!existingMtp) {
    await prisma.massiveTransfusionProtocol.create({
      data: { patientId: mtpPatient.id, indication: 'TRAUMA', ratio: '1:1:1', packsIssued: 6, activatedBy: user.id, notes: '교통사고 다발성 외상·활성 출혈' },
    });
  }

  // P2: 수혈반응 보고 — 기존 수혈 1건에 연계(있으면)
  let reactions = 0;
  const tx = await prisma.bloodTransfusion.findFirst();
  if (tx) {
    await prisma.transfusionReactionReport.upsert({
      where: { transfusionId: tx.id },
      update: {},
      create: {
        transfusionId: tx.id, patientId: tx.patientId, reactionType: 'FEBRILE', severity: 'MILD',
        signs: '수혈 30분 후 체온 38.2℃·오한', workup: { DAT: '음성', 재검혈액형: '일치', 배양: '진행중' } as Prisma.InputJsonValue,
        managementNote: '수혈 중단·해열제·경과관찰', reportedToBloodCenter: true, reportedAt: new Date(), outcome: '회복', reportedBy: user.id,
      },
    });
    reactions = 1;
  }

  // P2: 특수제제 속성 — 기존 AVAILABLE pRBC 일부에 방사선조사·백혈구제거
  const products = await prisma.bloodProduct.findMany({ where: { status: 'AVAILABLE' }, take: 4 });
  for (let i = 0; i < products.length; i++) {
    await prisma.bloodProduct.update({
      where: { id: products[i].id },
      data: i % 2 === 0 ? { irradiated: true, leukoreduced: true } : { cmvNegative: true },
    });
  }

  // P3: 혈액원 발주 3건(1건은 O- 긴급)
  const reorders = [
    { productType: 'PRBC', bloodType: 'O-', units: 4, urgency: 'STAT', status: 'ORDERED' },
    { productType: 'FFP', bloodType: 'AB+', units: 6, urgency: 'ROUTINE', status: 'REQUESTED' },
    { productType: 'PC', bloodType: 'A+', units: 2, urgency: 'URGENT', status: 'RECEIVED' },
  ];
  for (let i = 0; i < reorders.length; i++) {
    const r = reorders[i], id = uid(`reorder-${i}`);
    await prisma.bloodReorderRequest.upsert({
      where: { id },
      update: {},
      create: { id, ...r, supplierName: '대한적십자사 혈액원', requestedBy: user.id },
    });
  }

  console.log(`혈액은행 데모 시드 — 혈액형 ${typings}·항체 ${abs}·MTP 1·반응 ${reactions}·특수제제 ${products.length}·발주 ${reorders.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
