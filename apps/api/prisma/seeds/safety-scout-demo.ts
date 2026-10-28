import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 미검토 안전영역 스카우트 P2 신모델 데모 시드(멱등) — 화면 확인용.
 * FK(환자·의사·이식기록·안전사건) 존재 시에만 생성. 고정 UUID upsert로 재실행 안전.
 * 실행: npx tsx prisma/seeds/safety-scout-demo.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const patient = await prisma.patient.findFirst({ select: { id: true } });
  const doctor = await prisma.user.findFirst({ where: { role: 'DOCTOR' }, select: { id: true } });
  if (!patient || !doctor) {
    console.log('[safety-scout-demo] 환자/의사 없음 — 건너뜀');
    return;
  }
  const pid = patient.id;
  const did = doctor.id;
  const now = new Date();

  // 코드블루
  await prisma.codeBlueEvent.upsert({
    where: { id: '00000000-0000-0000-0000-0000cb000001' },
    create: {
      id: '00000000-0000-0000-0000-0000cb000001', patientId: pid, location: '병동 3A-12',
      recognizedAt: now, teamArrivedAt: new Date(now.getTime() + 2 * 60000), cprStartedAt: now,
      roscAt: new Date(now.getTime() + 12 * 60000), endedAt: new Date(now.getTime() + 20 * 60000),
      defibrillationCount: 2, outcome: 'ROSC', recordedBy: did, notes: '데모: 자발순환 회복',
    },
    update: {},
  });

  // RRT
  await prisma.rrtActivation.upsert({
    where: { id: '00000000-0000-0000-0000-0000cb000002' },
    create: {
      id: '00000000-0000-0000-0000-0000cb000002', patientId: pid, trigger: 'NEWS2',
      activatedAt: now, respondedAt: new Date(now.getTime() + 5 * 60000), responderTeam: 'RRT-A',
      outcome: 'ICU_TRANSFER', recordedBy: did, reason: '데모: NEWS2 급상승',
    },
    update: {},
  });

  // ASP 요청
  await prisma.aspRequest.upsert({
    where: { id: '00000000-0000-0000-0000-0000a5b00001' },
    create: {
      id: '00000000-0000-0000-0000-0000a5b00001', patientId: pid,
      antimicrobialName: 'Meropenem 1g IV q8h', indication: '복강내 감염(데모)', restrictedLevel: 'RESTRICTED',
      requestedBy: did, status: 'PENDING',
    },
    update: {},
  });

  // RCA (SafetyIncident 존재 시)
  const incident = await prisma.safetyIncident.findFirst({ select: { id: true } });
  if (incident) {
    await prisma.rcaReport.upsert({
      where: { incidentId: incident.id },
      create: {
        incidentId: incident.id, findings: '데모: 근본원인 분석 진행', status: 'OPEN', owner: did,
        dueAt: new Date(now.getTime() + 45 * 86400000),
      },
      update: {},
    });
  }

  // 이식 TDM/FollowUp (TransplantRecord 존재 시)
  const trec = await prisma.transplantRecord.findFirst({ select: { id: true } });
  if (trec) {
    await prisma.transplantTdm.upsert({
      where: { id: '00000000-0000-0000-0000-0000c50a0001' },
      create: {
        id: '00000000-0000-0000-0000-0000c50a0001', transplantId: trec.id, drug: 'tacrolimus',
        troughLevel: 8.5, targetLow: 5, targetHigh: 15, inRange: true, sampledAt: now, recordedBy: did,
      },
      update: {},
    });
    await prisma.transplantFollowUp.upsert({
      where: { id: '00000000-0000-0000-0000-0000c50a0002' },
      create: {
        id: '00000000-0000-0000-0000-0000c50a0002', transplantId: trec.id, visitDate: now,
        postOpDay: 30, graftFunction: 'GOOD', rejectionSigns: false, recordedBy: did,
      },
      update: {},
    });
  }

  // 이식 HLA (TransplantWaitlist 존재 시)
  const wl = await prisma.transplantWaitlist.findFirst({ select: { id: true } });
  if (wl) {
    await prisma.transplantHla.upsert({
      where: { id: '00000000-0000-0000-0000-0000c50a0003' },
      create: {
        id: '00000000-0000-0000-0000-0000c50a0003', waitlistId: wl.id,
        classI: { hlaA: ['A*02:01'], hlaB: ['B*15:01'], hlaC: [] }, method: 'PCR-SSO', pra: 10,
        lab: '면역유전학검사실', testedAt: now, recordedBy: did,
      },
      update: {},
    });
  }

  console.log(`[safety-scout-demo] 완료 — 코드블루·RRT·ASP${incident ? '·RCA' : ''}${trec ? '·이식TDM/FollowUp' : ''}${wl ? '·HLA' : ''}`);
}

assertSeedAllowed(__filename, 'DEMO'); // 🔴 실행 진입에서만 판정 — 테스트가 이 모듈을 import 하므로 최상단에 두지 않는다(상용 릴리즈 T2-3)
main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
