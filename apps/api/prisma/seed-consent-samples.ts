import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 동의서 워크스테이션 샘플 재생성 (일회성)
 * 실행: npx ts-node prisma/seed-consent-samples.ts
 * - 기존 미서명 샘플(같은 템플릿명, PENDING) 정리 후 새로 생성
 * - 담당 의사/간호사 배정 → 새 흐름(의사 사전 확인·서명부터)에서 큐에 노출
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SAMPLES: { type: string; name: string; risks: string; alternatives: string; explanation: string }[] = [
  {
    type: 'SURGERY', name: '심장 스텐트 삽입술 동의서',
    risks: '시술 중 관상동맥 천공·박리, 출혈, 조영제 부작용(알레르기·신기능 저하), 부정맥, 드물게 심근경색·뇌졸중·사망이 발생할 수 있습니다. 시술 후 스텐트 내 재협착·혈전이 생길 수 있습니다.',
    alternatives: '약물치료(항혈소판제·항협심증제), 관상동맥우회술(CABG), 경과 관찰. 다만 협착이 심한 경우 시술을 시행하지 않으면 흉통 악화 및 심근경색 위험이 높아집니다.',
    explanation: '관상동맥의 협착 부위를 풍선으로 확장한 뒤 스텐트를 삽입하여 혈류를 회복시키는 시술입니다. 시술 시간은 약 1~2시간, 시술 후 이중항혈소판요법이 필요합니다.',
  },
  {
    type: 'ANESTHESIA', name: '전신마취 동의서',
    risks: '마취제에 대한 알레르기·아나필락시스, 기도 손상, 흡인성 폐렴, 악성 고열, 술후 오심·구토, 인지기능 저하, 드물게 심정지 등이 발생할 수 있습니다.',
    alternatives: '부위마취(척추·경막외), 국소마취, 진정하 시술. 시술의 종류·범위에 따라 전신마취가 불가피할 수 있습니다.',
    explanation: '수술 동안 의식과 통증을 완전히 차단하기 위해 전신마취를 시행합니다. 마취과 의사가 활력징후를 지속 감시합니다. 수술 전 금식이 필요합니다.',
  },
  {
    type: 'TRANSFUSION', name: '수혈 동의서',
    risks: '발열·알레르기 반응, 용혈성 수혈반응, 수혈관련 급성폐손상(TRALI), 순환 과부하(TACO), 감염(드뭄) 등이 발생할 수 있습니다.',
    alternatives: '철분제·조혈제 투여, 자가수혈, 수혈 보류. 출혈·빈혈이 심한 경우 수혈을 하지 않으면 생명에 위험이 될 수 있습니다.',
    explanation: '혈색소 저하·출혈에 대해 적혈구/혈장/혈소판 등 혈액제제를 수혈합니다. 수혈 전 혈액형 및 교차적합시험을 시행하며, 수혈 중·후 부작용을 관찰합니다.',
  },
  {
    type: 'PROCEDURE', name: '상부위장관 내시경 시술 동의서',
    risks: '출혈, 천공, 진정제에 의한 호흡억제·혈압저하, 흡인, 인후부 불편감 등이 발생할 수 있습니다.',
    alternatives: '상부위장관 조영검사, CT, 경과 관찰. 다만 조직검사·지혈·이물 제거 등은 내시경이 필요합니다.',
    explanation: '내시경을 입을 통해 삽입하여 식도·위·십이지장을 관찰하고 필요시 조직검사·치료를 시행합니다. 진정 내시경 시 시술 후 일정 시간 안정이 필요합니다.',
  },
  {
    type: 'TREATMENT', name: '항불안제 투약 동의서',
    risks: '졸음·어지럼, 인지·운동 능력 저하, 장기 사용 시 의존성·내성, 호흡억제(고용량·병용 시) 등이 발생할 수 있습니다.',
    alternatives: '인지행동치료, 비약물적 이완요법, 다른 계열 약물. 증상 정도에 따라 약물치료가 권장됩니다.',
    explanation: '불안·불면 증상 완화를 위해 항불안제를 투여합니다. 음주 및 운전 시 주의가 필요하며, 임의 중단·증량을 피해야 합니다.',
  },
  {
    type: 'DNR', name: '연명의료계획서(DNR) 동의서',
    risks: '심정지 시 심폐소생술, 인공호흡기, 혈액투석, 항암제 투여 등 연명의료를 시행하지 않습니다. 환자·가족의 의사에 따라 언제든 변경할 수 있습니다.',
    alternatives: '연명의료 전부 또는 일부 시행, 호스피스·완화의료. 환자의 자기결정과 최선의 이익을 우선합니다.',
    explanation: '회복 가능성이 없는 임종과정의 환자에 대하여 연명의료의 시행·중단에 관한 의사를 사전에 정합니다. 통증·증상 완화를 위한 의료는 계속 제공됩니다.',
  },
];

async function main() {
  const patients = await prisma.patient.findMany({ where: { mrn: { startsWith: 'P2026' } }, take: 8, orderBy: { mrn: 'asc' }, select: { id: true, familyName: true, givenName: true, mrn: true } });
  const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true }, take: 12, select: { id: true } });
  const nurses = await prisma.user.findMany({ where: { role: 'NURSE', isActive: true }, take: 12, select: { id: true } });

  if (!patients.length || !doctors.length) {
    console.log('환자 또는 의사 데이터가 없어 중단합니다.');
    return;
  }

  // 기존 미서명 샘플 정리 (같은 템플릿명 + PENDING + 서명 전)
  const names = SAMPLES.map((s) => s.name);
  const stale = await prisma.consentForm.findMany({
    where: { status: 'PENDING', templateName: { in: names }, patientSignedAt: null, doctorSignedAt: null },
    select: { id: true },
  });
  const staleIds = stale.map((s) => s.id);
  if (staleIds.length) {
    await prisma.consentSignSession.deleteMany({ where: { consentId: { in: staleIds } } });
    await prisma.consentForm.deleteMany({ where: { id: { in: staleIds } } });
    console.log(`기존 미서명 샘플 정리: ${staleIds.length}건`);
  }

  let created = 0;
  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    const p = patients[i % patients.length];
    const doc = doctors[i % doctors.length];
    const nurse = nurses[i % nurses.length];
    await prisma.consentForm.create({
      data: {
        patientId: p.id,
        type: s.type,
        consentType: s.type as never,
        templateName: s.name,
        content: { title: s.name } as never,
        risks: s.risks,
        alternatives: s.alternatives,
        explanation: s.explanation,
        doctorId: doc.id,
        nurseId: nurse?.id,
        status: 'PENDING',
      },
    });
    created++;
    console.log(`  + ${s.name} → ${p.familyName}${p.givenName}(${p.mrn})`);
  }
  console.log(`샘플 동의서 ${created}건 재생성 완료. (의사 사전 확인·서명부터 시작)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
