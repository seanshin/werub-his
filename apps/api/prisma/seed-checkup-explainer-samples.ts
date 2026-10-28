import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 검진결과 해석 감수 콘텐츠 — 시연용 샘플 시드 (추가·멱등)
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-checkup-explainer-samples.ts
 *
 * ⚠️ 시연/개발용 초안. 상태 DRAFT 로 생성(감수 미완료) — 콘솔 워크플로 시연 목적.
 *    웰니스 톤(단정·처방 배제)·가드레일 통과 문안. 실서비스 노출 전 의료 감수 필수.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

interface Sample {
  testCode: string; testName: string;
  plainWhat: string; plainMeaning: string; lifestyleInfo: string; whenToSeeDoctor: string; sourceRef: string;
}

const SAMPLES: Sample[] = [
  {
    testCode: 'FBS', testName: '공복혈당',
    plainWhat: '8시간 이상 금식 후 혈액 속 포도당(혈당) 농도를 보는 검사예요.',
    plainMeaning: '수치가 높은 범위에 해당하면 당뇨병 또는 당뇨병 전단계 가능성을 시사할 수 있어요. 확진과 판단은 의사의 진료가 필요합니다.',
    lifestyleInfo: '규칙적인 식사, 단순당·과식 줄이기, 꾸준한 신체활동이 혈당 관리에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '결과지에 재검·경계·의심으로 표기되었거나 갈증·다뇨·체중감소가 있으면 내과 진료를 권합니다.',
    sourceRef: '대한당뇨병학회 진료지침 / 국가건강검진 결과 해설',
  },
  {
    testCode: 'HbA1c', testName: '당화혈색소',
    plainWhat: '지난 2~3개월간의 평균 혈당 수준을 반영하는 검사예요.',
    plainMeaning: '값이 높은 범위일수록 최근 몇 달간 평균 혈당이 높았음을 의미할 수 있어요. 단일 수치로 병을 단정하지는 않습니다.',
    lifestyleInfo: '식사·활동 습관의 꾸준한 관리가 평균 혈당에 영향을 줄 수 있다고 알려져 있어요.',
    whenToSeeDoctor: '결과지 판정이 경계·의심 이상이면 전문의 상담을 권합니다.',
    sourceRef: '대한당뇨병학회 / ADA Standards of Care',
  },
  {
    testCode: 'BP', testName: '혈압',
    plainWhat: '심장이 피를 내보낼 때(수축기)와 쉴 때(이완기) 혈관에 가해지는 압력을 재는 검사예요.',
    plainMeaning: '높은 범위가 반복되면 고혈압 가능성을 시사할 수 있어요. 진단은 여러 번 측정과 의사의 판단이 필요합니다.',
    lifestyleInfo: '싱겁게 먹기, 절주, 규칙적 활동, 체중 관리가 혈압 관리에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '가정 측정에서도 높은 값이 반복되거나 두통·어지럼이 동반되면 진료를 권합니다.',
    sourceRef: '대한고혈압학회 진료지침',
  },
  {
    testCode: 'BMI', testName: '체질량지수(BMI)',
    plainWhat: '키와 몸무게로 계산한, 비만 정도를 가늠하는 참고 지표예요.',
    plainMeaning: '높은 범위는 과체중·비만 경향을 참고로 보여줄 수 있어요. 근육량·체형에 따라 해석이 달라질 수 있습니다.',
    lifestyleInfo: '균형 잡힌 식사와 규칙적 신체활동이 체중 관리에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '체중 변화가 급격하거나 대사 관련 항목이 함께 경계로 나오면 상담을 권합니다.',
    sourceRef: '대한비만학회 기준',
  },
  {
    testCode: 'LDL', testName: 'LDL 콜레스테롤',
    plainWhat: '혈액 속 이른바 "나쁜 콜레스테롤"의 양을 보는 검사예요.',
    plainMeaning: '높은 범위는 심혈관 위험과 관련될 수 있다고 알려져 있어요. 위험도는 다른 요인과 함께 의사가 종합 판단합니다.',
    lifestyleInfo: '포화지방·트랜스지방 줄이기, 식이섬유·활동 늘리기가 지질 관리에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '결과지 판정이 경계·의심 이상이거나 가족력이 있으면 진료를 권합니다.',
    sourceRef: '한국지질·동맥경화학회 진료지침',
  },
  {
    testCode: 'BUN_CR', testName: '신장기능(BUN/Cr)',
    plainWhat: '노폐물 배출을 담당하는 콩팥이 얼마나 잘 일하는지 가늠하는 검사예요.',
    plainMeaning: '수치가 참고범위를 벗어나면 신장 기능 상태를 더 살펴볼 필요를 시사할 수 있어요. 단일 수치로 병을 단정하지 않습니다.',
    lifestyleInfo: '충분한 수분, 무분별한 약물·건강보조제 남용 피하기가 콩팥 건강에 일반적으로 권장돼요.',
    whenToSeeDoctor: '결과지에 이상·재검으로 표기되면 내과(신장) 진료를 권합니다.',
    sourceRef: 'KDIGO / 국가건강검진 결과 해설',
  },
  {
    testCode: 'AST_ALT', testName: '간기능(AST/ALT)',
    plainWhat: '간세포 상태를 반영하는 효소 수치를 보는 검사예요.',
    plainMeaning: '높은 범위는 간에 부담이 있을 가능성을 참고로 보여줄 수 있어요. 원인은 매우 다양하며 의사의 평가가 필요합니다.',
    lifestyleInfo: '절주, 균형 잡힌 식사, 적정 체중 유지가 간 건강에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '수치가 지속적으로 높거나 피로·황달이 있으면 진료를 권합니다.',
    sourceRef: '대한간학회 참고자료',
  },
  {
    testCode: 'CBC_18', testName: '일반혈액검사(빈혈 등)',
    plainWhat: '혈색소·적혈구·백혈구·혈소판 등 혈액의 기본 구성을 보는 검사예요.',
    plainMeaning: '혈색소가 낮은 범위면 빈혈 경향을, 일부 항목의 이상은 추가 확인 필요를 참고로 보여줄 수 있어요.',
    lifestyleInfo: '균형 잡힌 영양 섭취가 일반적으로 권장되며, 원인에 따라 관리 방법이 달라질 수 있어요.',
    whenToSeeDoctor: '결과지에 이상·재검으로 표기되거나 어지럼·피로가 심하면 진료를 권합니다.',
    sourceRef: '국가건강검진 결과 해설',
  },
];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } }) ?? await prisma.user.findFirst();
  if (!admin) throw new Error('createdBy 로 쓸 사용자가 없습니다');

  let created = 0, skipped = 0;
  for (const s of SAMPLES) {
    const existing = await prisma.checkupExplainerContent.findUnique({ where: { testCode: s.testCode } });
    if (existing) { skipped++; continue; } // 기존(감수 진행 가능성) 보존 — 비파괴
    await prisma.checkupExplainerContent.create({
      data: {
        testCode: s.testCode, testName: s.testName,
        plainWhat: s.plainWhat, plainMeaning: s.plainMeaning,
        lifestyleInfo: s.lifestyleInfo, whenToSeeDoctor: s.whenToSeeDoctor,
        sourceRef: s.sourceRef, status: 'DRAFT', createdBy: admin.id,
      },
    });
    created++;
  }
  console.log(`검진해석 샘플 시드 — 생성 ${created} / 보존(기존) ${skipped} (총 ${SAMPLES.length}, 전부 DRAFT·감수대기)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
