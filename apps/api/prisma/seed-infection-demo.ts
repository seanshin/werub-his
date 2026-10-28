import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 감염관리 보강 데모 시드 — HAI·MDRO·법정감염병 (추가·멱등·비파괴)
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-infection-demo.ts
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
const prisma = new PrismaClient();
const uid = (s: string) => {
  const h = createHash('md5').update(`inf-demo:${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);

async function main() {
  const user = (await prisma.user.findFirst({ where: { role: 'DOCTOR' } }))!;
  const patients = await prisma.patient.findMany({ take: 8, orderBy: { createdAt: 'desc' } });
  if (patients.length < 8) throw new Error('환자 8 필요');

  // HAI 케이스 4종
  const hai = [
    { k: 'h1', p: 0, haiType: 'CLABSI', organism: 'Klebsiella pneumoniae', deviceType: 'CENTRAL_LINE', deviceDays: 9, ward: '내과중환자실', onset: 3, konis: false, criteria: 'NHSN CLABSI 기준 충족(중심정맥관 2일 초과·혈액배양 양성)' },
    { k: 'h2', p: 1, haiType: 'CAUTI', organism: 'E. coli', deviceType: 'FOLEY', deviceDays: 6, ward: '외과병동', onset: 2, konis: false, criteria: 'CAUTI 기준(유치도뇨 2일 초과·증상+요배양)' },
    { k: 'h3', p: 2, haiType: 'VAP', organism: 'Acinetobacter baumannii', deviceType: 'VENTILATOR', deviceDays: 12, ward: '내과중환자실', onset: 5, konis: true, criteria: 'VAP 기준(인공호흡 2일 초과·흉부영상+임상)' },
    { k: 'h4', p: 3, haiType: 'SSI', organism: 'Staphylococcus aureus', deviceType: 'SURGICAL', ward: '정형외과', onset: 7, konis: false, criteria: '표재성 SSI(수술 30일 이내·창상 화농)' },
  ];
  let h = 0;
  for (const c of hai) {
    const id = uid(c.k);
    const data = { patientId: patients[c.p].id, haiType: c.haiType, organism: c.organism, deviceType: c.deviceType ?? null, deviceDays: c.deviceDays ?? null, ward: c.ward, onsetAt: daysAgo(c.onset), criteriaMet: c.criteria, status: 'ACTIVE', reportedToKonis: c.konis, detectedBy: user.id };
    await prisma.haiCase.upsert({ where: { id }, update: data, create: { id, ...data } });
    h++;
  }

  // MDRO 4종
  const mdro = [
    { k: 'm1', p: 0, organism: 'Klebsiella pneumoniae', mdroType: 'CRE', mechanism: 'KPC', specimen: '혈액', ward: '내과중환자실', iso: 'CONTACT' },
    { k: 'm2', p: 4, organism: 'Staphylococcus aureus', mdroType: 'MRSA', specimen: '창상', ward: '정형외과', iso: 'CONTACT' },
    { k: 'm3', p: 2, organism: 'Acinetobacter baumannii', mdroType: 'CRAB', mechanism: 'OXA-23', specimen: '기관흡인', ward: '내과중환자실', iso: 'CONTACT' },
    { k: 'm4', p: 5, organism: 'Enterococcus faecium', mdroType: 'VRE', specimen: '대변', ward: '혈액종양내과', iso: 'CONTACT' },
  ];
  let m = 0;
  for (const c of mdro) {
    const id = uid(c.k);
    const data = { patientId: patients[c.p].id, organism: c.organism, mdroType: c.mdroType, mechanism: c.mechanism ?? null, specimen: c.specimen, ward: c.ward, detectedAt: daysAgo(4), isolationType: c.iso, active: true };
    await prisma.mdroRegistry.upsert({ where: { id }, update: data, create: { id, ...data } });
    m++;
  }

  // 법정감염병 신고 3종
  const ndr = [
    { k: 'n1', p: 6, name: '결핵', grade: '2', code: 'A15', dx: 'CONFIRMED', status: 'SUBMITTED', ref: 'KCDC-DEMO01' },
    { k: 'n2', p: 7, name: '카바페넴내성장내세균속균종(CRE) 감염증', grade: '2', code: 'U82', dx: 'CONFIRMED', status: 'DRAFT', ref: null },
    { k: 'n3', p: 3, name: '수두', grade: '2', code: 'B01', dx: 'SUSPECT', status: 'DRAFT', ref: null },
  ];
  let n = 0;
  for (const c of ndr) {
    const id = uid(c.k);
    const data = { patientId: patients[c.p].id, diseaseName: c.name, diseaseGrade: c.grade, kcdcCode: c.code, diagnosisType: c.dx, status: c.status, submittedAt: c.status === 'SUBMITTED' ? daysAgo(1) : null, reportRef: c.ref, reportedBy: user.id };
    await prisma.notifiableDiseaseReport.upsert({ where: { id }, update: data, create: { id, ...data } });
    n++;
  }

  console.log(`감염관리 데모 시드 — HAI ${h}·MDRO ${m}·법정감염병 ${n}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
