import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 진단검사 보드 데모 시드 — P1~P3 신규 기능 시연(추가·멱등·비파괴)
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-diagnostics-board-demo.ts
 * TAT초과·기능검사 위험소견·판독 검토대기·delta 급변·모달별 큐·추이를 채운다.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
const prisma = new PrismaClient();
const uid = (s: string) => {
  const h = createHash('md5').update(`dxb-demo:${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const minAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

async function main() {
  const doc = await prisma.user.findFirst({ where: { role: 'DOCTOR' }, orderBy: { createdAt: 'asc' } });
  const tech = (await prisma.user.findFirst({ where: { role: 'LAB_TECH' } })) ?? doc;
  const patients = await prisma.patient.findMany({ take: 8, orderBy: { createdAt: 'desc' } });
  if (!doc || !tech || patients.length < 8) throw new Error('DOCTOR/LAB_TECH/환자8 필요');

  type Case = {
    key: string; pIdx: number; testType: string; testName: string;
    data: Partial<Prisma.DiagnosticTestUncheckedCreateInput>;
  };
  const cases: Case[] = [
    // TAT 초과(STAT·목표 경과 미완)
    { key: 'tat1', pIdx: 0, testType: 'EKG', testName: '심전도 (EKG)', data: { status: 'IN_PROGRESS', priority: 'STAT', targetTatMinutes: 30, createdAt: minAgo(95), performedBy: tech.id, performedAt: minAgo(20), roomName: '심전도실', equipmentName: 'GE MAC2000' } },
    { key: 'tat2', pIdx: 1, testType: 'ENDOSCOPY_UPPER', testName: '상부위장관내시경', data: { status: 'ORDERED', priority: 'URGENT', targetTatMinutes: 60, createdAt: minAgo(130), roomName: '내시경실1' } },
    // 기능검사 위험소견 + 검토 대기
    { key: 'crit1', pIdx: 2, testType: 'PFT', testName: '폐기능검사 (PFT)', data: { status: 'COMPLETED', priority: 'ROUTINE', reportedAt: minAgo(15), interpretedBy: doc.id, conclusion: 'ABNORMAL', criticalFlag: true, criticalNote: 'FEV1 45% 예측치 — 중증 폐쇄성 장애', reviewStatus: 'PENDING_REVIEW', measurements: { FEV1: 45, FVC: 62 } as Prisma.InputJsonValue } },
    { key: 'crit2', pIdx: 3, testType: 'HOLTER', testName: '24시간 심전도 (Holter)', data: { status: 'COMPLETED', priority: 'URGENT', reportedAt: minAgo(40), interpretedBy: doc.id, conclusion: 'ABNORMAL', criticalFlag: true, criticalNote: '비지속성 심실빈맥 3연발·주의 요망', reviewStatus: 'PENDING_REVIEW' } },
    // delta 급변 + 검토 대기
    { key: 'delta1', pIdx: 4, testType: 'ECHO', testName: '심초음파 (Echo)', data: { status: 'COMPLETED', priority: 'ROUTINE', reportedAt: minAgo(30), interpretedBy: doc.id, conclusion: 'ABNORMAL', deltaFlag: true, deltaNote: '이전 대비 급변: EF 60→38(37%)', reviewStatus: 'PENDING_REVIEW', measurements: { EF: 38 } as Prisma.InputJsonValue } },
    // 검토 대기(정상)
    { key: 'rev1', pIdx: 5, testType: 'DEXA', testName: '골밀도검사 (DEXA)', data: { status: 'COMPLETED', priority: 'ROUTINE', reportedAt: minAgo(20), interpretedBy: doc.id, conclusion: 'BORDERLINE', reviewStatus: 'PENDING_REVIEW', measurements: { Tscore: -1.8 } as Prisma.InputJsonValue } },
    // 모달별 큐 다양화
    { key: 'q1', pIdx: 6, testType: 'TMT', testName: '운동부하검사 (TMT)', data: { status: 'SCHEDULED', priority: 'ROUTINE', scheduledAt: minAgo(-60), roomName: '운동부하실' } },
    { key: 'q2', pIdx: 7, testType: 'AUDIOMETRY', testName: '청력검사', data: { status: 'ORDERED', priority: 'ROUTINE' } },
    // 추이용 — 환자0 EKG 2회 완료(delta 시연)
    { key: 'trend1', pIdx: 0, testType: 'EKG', testName: '심전도 (EKG)', data: { status: 'COMPLETED', priority: 'ROUTINE', reportedAt: minAgo(2880), interpretedBy: doc.id, conclusion: 'NORMAL', measurements: { QTc: 420, HR: 72 } as Prisma.InputJsonValue } },
    { key: 'trend2', pIdx: 0, testType: 'EKG', testName: '심전도 (EKG)', data: { status: 'COMPLETED', priority: 'ROUTINE', reportedAt: minAgo(60), interpretedBy: doc.id, conclusion: 'ABNORMAL', deltaFlag: true, deltaNote: '이전 대비 급변: QTc 420→490(17%)', reviewStatus: 'PENDING_REVIEW', measurements: { QTc: 490, HR: 88 } as Prisma.InputJsonValue } },
  ];

  let n = 0;
  for (const c of cases) {
    const id = uid(c.key);
    const base = { patientId: patients[c.pIdx].id, testType: c.testType, testName: c.testName, requestedBy: doc.id, ...c.data };
    await prisma.diagnosticTest.upsert({ where: { id }, update: base as Prisma.DiagnosticTestUncheckedUpdateInput, create: { id, ...base } as Prisma.DiagnosticTestUncheckedCreateInput });
    n++;
  }

  const pending = await prisma.diagnosticTest.count({ where: { reviewStatus: 'PENDING_REVIEW' } });
  const crit = await prisma.diagnosticTest.count({ where: { criticalFlag: true } });
  console.log(`진단검사 보드 데모 시드 — ${n}건(검토대기 ${pending}·위험소견 ${crit}·TAT초과2·delta2·추이 EKG2)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
