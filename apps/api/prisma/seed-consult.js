require('./seed-mode-guard').assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 테스트 상담 세션 시드 (데스크/포털 확인용). 고정 id로 멱등.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const FIXED = '00000000-0000-4000-c000-0000000c0001'; // 고정 테스트 세션 id(영문)
const P1 = '00000000-0000-4000-a000-000000d00001';     // 김영수
const P3 = '00000000-0000-4000-a000-000000d00003';     // 박철수

async function main() {
  await prisma.consultMessage.deleteMany({ where: { sessionId: FIXED } }).catch(() => {});
  await prisma.consultSession.deleteMany({ where: { id: FIXED } }).catch(() => {});
  await prisma.consultSession.create({ data: { id: FIXED, patientId: P1, status: 'OPEN', locale: 'en' } });

  const msgs = [
    { sender: 'PATIENT', content: 'Hello, when will my blood test results be ready?', contentKo: '안녕하세요, 혈액검사 결과는 언제 나오나요?', lang: 'en' },
    { sender: 'AI', content: "Hello! Blood test results are usually available within 1-2 days, viewable in the portal's Test Results tab.", contentKo: '안녕하세요! 혈액검사 결과는 보통 1~2일 내 확인 가능하며 포털 검사결과 탭에서 보실 수 있습니다.', lang: 'en' },
    { sender: 'PATIENT', content: 'Can I get an English medical certificate?', contentKo: '영문 진단서를 받을 수 있나요?', lang: 'en' },
  ];
  let t = Date.now() - 300000;
  for (const m of msgs) { await prisma.consultMessage.create({ data: { sessionId: FIXED, ...m, createdAt: new Date(t) } }); t += 60000; }

  const ko = await prisma.consultSession.findFirst({ where: { patientId: P3 } });
  if (ko) {
    await prisma.consultMessage.create({ data: { sessionId: ko.id, sender: 'STAFF', content: '네, 무엇을 도와드릴까요? 예약 변경은 예약 탭에서 가능합니다.', contentKo: '네, 무엇을 도와드릴까요? 예약 변경은 예약 탭에서 가능합니다.', lang: 'ko' } });
  }
  console.log('✅ 테스트 상담 세션 시드: 영문 세션 ' + FIXED + ' (메시지 3) + 한국어 세션 직원답변');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
