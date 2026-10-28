import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 산과 분만(L&D) + ICU 실계산 데모 시드 — 추가·멱등·비파괴
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-obgyn-icu-demo.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
const prisma = new PrismaClient();
const uid = (s: string) => {
  const h = createHash('md5').update(`obicu-demo:${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const minAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

async function main() {
  const doc = await prisma.user.findFirst({ where: { role: 'DOCTOR' }, orderBy: { createdAt: 'asc' } });
  const nurse = await prisma.user.findFirst({ where: { role: 'NURSE' }, orderBy: { createdAt: 'asc' } });
  const patients = await prisma.patient.findMany({ take: 12, orderBy: { createdAt: 'desc' } });
  if (!doc || !nurse || patients.length < 12) throw new Error('DOCTOR/NURSE/환자12 필요');

  // ───── 산과 분만 ─────
  let deliv = 0, nb = 0, prog = 0;
  const D = async (key: string, data: Prisma.DeliveryRecordUncheckedCreateInput) => {
    const id = uid(key);
    await prisma.deliveryRecord.upsert({ where: { id }, update: data, create: { id, ...data } });
    return id;
  };
  // A. 진통 초기(파토그램 2건)
  const a = await D('d-labor1', { patientId: patients[0].id, status: 'IN_LABOR', gestationalWeeks: '39+1', laborOnsetAt: minAgo(180) });
  for (const [k, o, dil, st, fhr] of [['p1', 150, 4, -2, 140], ['p2', 60, 7, 0, 138]] as const) {
    const pid = uid(`${a}-${k}`);
    await prisma.laborProgressRecord.upsert({ where: { id: pid }, update: {}, create: { id: pid, deliveryId: a, recordedAt: minAgo(o), cervicalDilation: dil, station: st, fetalHeartRate: fhr, contractionFreq: 4, recordedBy: nurse.id } });
    prog++;
  }
  deliv++;
  // B. 진통 후기(만출 임박)
  const b = await D('d-labor2', { patientId: patients[1].id, status: 'IN_LABOR', gestationalWeeks: '40+3', laborOnsetAt: minAgo(420) });
  const bp = uid(`${b}-p1`);
  await prisma.laborProgressRecord.upsert({ where: { id: bp }, update: {}, create: { id: bp, deliveryId: b, recordedAt: minAgo(20), cervicalDilation: 9, station: 1, fetalHeartRate: 145, contractionFreq: 5, recordedBy: nurse.id } });
  prog++; deliv++;
  // C. 질식분만 완료 + 신생아 정상
  const c = await D('d-vaginal', { patientId: patients[2].id, status: 'DELIVERED', gestationalWeeks: '39+4', deliveryType: 'VAGINAL', laborOnsetAt: minAgo(360), deliveredAt: minAgo(90), stage1Minutes: 240, stage2Minutes: 25, stage3Minutes: 8, anesthesia: 'EPIDURAL', bloodLossMl: 300, deliveredBy: doc.id });
  const cn = uid(`${c}-nb`);
  await prisma.newbornRecord.upsert({ where: { id: cn }, update: {}, create: { id: cn, deliveryId: c, birthAt: minAgo(90), sex: 'M', weightG: 3250, lengthCm: new Prisma.Decimal(50.0), headCircCm: new Prisma.Decimal(34.5), apgar1: 8, apgar5: 9, feedingType: '모유', nicuAdmission: false } });
  nb++; deliv++;
  // D. 제왕절개 + 신생아 NICU
  const d = await D('d-cesarean', { patientId: patients[3].id, status: 'POSTPARTUM', gestationalWeeks: '37+2', deliveryType: 'CESAREAN', laborOnsetAt: minAgo(300), deliveredAt: minAgo(150), stage1Minutes: 120, anesthesia: 'SPINAL', bloodLossMl: 750, indication: '태아곤란(반복성 late deceleration)', deliveredBy: doc.id, lochia: '소량 적색', fundusStatus: '제와부·단단', woundStatus: '깨끗·건조' });
  const dn = uid(`${d}-nb`);
  await prisma.newbornRecord.upsert({ where: { id: dn }, update: {}, create: { id: dn, deliveryId: d, birthAt: minAgo(150), sex: 'F', weightG: 2680, lengthCm: new Prisma.Decimal(47.0), headCircCm: new Prisma.Decimal(33.0), apgar1: 5, apgar5: 8, resuscitation: 'PPV 30초·산소', nicuAdmission: true, feedingType: 'NICU' } });
  nb++; deliv++;

  // ───── ICU 실 NEWS2/APACHE/SOFA 데모 — 재실 환자에 이상 활력 기록 추가 ─────
  const admissions = await prisma.icuAdmission.findMany({ where: { status: 'ADMITTED' }, take: 3, orderBy: { admitDate: 'desc' } });
  const abn = [
    { hr: 128, sbp: 84, dbp: 48, spo2: 89, rr: 28, temp: 39.3, gcs: 10, cons: 'VERBAL', fio2: 50, vent: 'AC', urine: 150 }, // 고위험
    { hr: 108, sbp: 96, dbp: 60, spo2: 93, rr: 22, temp: 38.4, gcs: 14, cons: 'ALERT', fio2: 32, vent: null, urine: 400 }, // 중등
    { hr: 78, sbp: 122, dbp: 76, spo2: 98, rr: 16, temp: 36.7, gcs: 15, cons: 'ALERT', fio2: null, vent: null, urine: 900 }, // 정상
  ];
  let icu = 0;
  for (let i = 0; i < admissions.length; i++) {
    const v = abn[i]; const rid = uid(`icu-rec-${admissions[i].id}`);
    await prisma.icuRecord.upsert({
      where: { id: rid },
      update: { recordTime: minAgo(10), heartRate: v.hr, systolicBp: v.sbp, diastolicBp: v.dbp, spo2: v.spo2, respiratoryRate: v.rr, temperature: new Prisma.Decimal(v.temp), gcScore: v.gcs, consciousness: v.cons, fio2: v.fio2, ventMode: v.vent, outputUrine: v.urine },
      create: { id: rid, admissionId: admissions[i].id, recordTime: minAgo(10), heartRate: v.hr, systolicBp: v.sbp, diastolicBp: v.dbp, spo2: v.spo2, respiratoryRate: v.rr, temperature: new Prisma.Decimal(v.temp), gcScore: v.gcs, consciousness: v.cons, fio2: v.fio2, ventMode: v.vent, outputUrine: v.urine, recordedBy: nurse.id },
    });
    icu++;
  }

  console.log(`데모 시드 — 분만 ${deliv}(신생아 ${nb}·파토그램 ${prog}) / ICU 이상활력 ${icu}건(NEWS2 실계산용)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
