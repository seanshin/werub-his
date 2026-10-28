import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 검진결과 해석 감수 콘텐츠 — 확충 시드(운영 CheckupTestMaster 실코드 매칭)
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-checkup-explainer-expand.ts
 * ⚠️ 시연/개발용 초안(DRAFT·감수 대기). 웰니스 톤·가드레일 통과 문안. 실서비스 노출 전 의료 감수 필수.
 *   (기존 샘플 seed-checkup-explainer-samples.ts 의 LFT·LIPID 실코드 버전 포함)
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

interface Sample { testCode: string; testName: string; plainWhat: string; plainMeaning: string; lifestyleInfo: string; whenToSeeDoctor: string; sourceRef: string }

const S: Sample[] = [
  { testCode: 'LFT', testName: '간기능검사',
    plainWhat: '간세포 상태와 담즙 관련 효소를 종합적으로 보는 검사예요.',
    plainMeaning: '일부 수치가 참고범위를 벗어나면 간에 부담이 있을 가능성을 참고로 보여줄 수 있어요. 원인은 다양하며 의사의 평가가 필요합니다.',
    lifestyleInfo: '절주, 균형 잡힌 식사, 적정 체중 유지가 간 건강에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '수치가 지속적으로 높거나 피로·황달·복부 불편이 있으면 진료를 권합니다.', sourceRef: '대한간학회 참고자료' },
  { testCode: 'LIPID', testName: '지질검사(콜레스테롤·중성지방)',
    plainWhat: '혈액 속 콜레스테롤(총·LDL·HDL)과 중성지방 수준을 보는 검사예요.',
    plainMeaning: '이른바 나쁜 콜레스테롤·중성지방이 높은 범위면 심혈관 위험과 관련될 수 있다고 알려져 있어요. 위험도는 다른 요인과 함께 의사가 종합 판단합니다.',
    lifestyleInfo: '포화·트랜스지방 줄이기, 식이섬유·활동 늘리기가 지질 관리에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '결과지 판정이 경계·의심 이상이거나 가족력이 있으면 진료를 권합니다.', sourceRef: '한국지질·동맥경화학회 진료지침' },
  { testCode: 'THYROID', testName: '갑상선기능(TSH/fT4)',
    plainWhat: '갑상선호르몬 상태를 반영하는 혈액검사예요.',
    plainMeaning: '수치가 참고범위를 벗어나면 갑상선 기능이 항진 또는 저하된 상태일 가능성을 참고로 보여줄 수 있어요. 확인은 의사의 진료가 필요합니다.',
    lifestyleInfo: '급격한 체중·피로·심박 변화가 있으면 기록해 두면 상담에 도움이 될 수 있어요.',
    whenToSeeDoctor: '결과지에 이상·재검으로 표기되면 내분비내과 진료를 권합니다.', sourceRef: '대한갑상선학회 참고자료' },
  { testCode: 'PSA', testName: '전립선표지자(PSA)',
    plainWhat: '전립선에서 나오는 단백질(PSA) 수치를 보는 혈액검사예요.',
    plainMeaning: '높은 범위는 전립선비대·염증·암 등 여러 상태와 관련될 수 있어요. 단일 수치로 병을 단정하지 않으며 추가 평가가 필요할 수 있습니다.',
    lifestyleInfo: '검사 전 사정·자전거·직장검사가 수치에 영향을 줄 수 있어, 재검 시 이를 참고하면 좋아요.',
    whenToSeeDoctor: '결과지 판정이 경계·의심 이상이거나 배뇨 증상이 있으면 비뇨의학과 진료를 권합니다.', sourceRef: '대한비뇨의학회 참고자료' },
  { testCode: 'URIC', testName: '요산',
    plainWhat: '혈액 속 요산 농도를 보는 검사로, 통풍·대사와 관련돼요.',
    plainMeaning: '높은 범위는 통풍·요로결석 위험과 관련될 수 있다고 알려져 있어요. 증상 없이 높은 경우의 판단은 의사의 진료가 필요합니다.',
    lifestyleInfo: '충분한 수분, 과도한 음주·고퓨린 식품 줄이기가 요산 관리에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '관절이 갑자기 붓고 아프거나 결과지에 이상으로 표기되면 진료를 권합니다.', sourceRef: '국가건강검진 결과 해설' },
  { testCode: 'VIT_D', testName: '비타민D',
    plainWhat: '뼈 건강 등과 관련되는 비타민D 수준을 보는 검사예요.',
    plainMeaning: '낮은 범위는 비타민D 부족 가능성을 참고로 보여줄 수 있어요. 보충 여부와 방법은 의사와 상담이 필요합니다.',
    lifestyleInfo: '적절한 야외활동(햇빛)과 균형 잡힌 식사가 일반적으로 권장돼요.',
    whenToSeeDoctor: '결과지에 부족으로 표기되거나 뼈·근육 관련 증상이 있으면 상담을 권합니다.', sourceRef: '국가건강검진 결과 해설' },
  { testCode: 'hsCRP', testName: '고감도 CRP',
    plainWhat: '몸속 미세한 염증 정도를 민감하게 보는 검사예요.',
    plainMeaning: '높은 범위는 염증이나 심혈관 위험과 관련될 수 있다고 알려져 있어요. 감염 등 일시적 요인으로도 오를 수 있어 해석에 주의가 필요합니다.',
    lifestyleInfo: '금연·활동·체중 관리가 만성 염증 지표에 영향을 줄 수 있다고 알려져 있어요.',
    whenToSeeDoctor: '지속적으로 높거나 다른 위험 항목과 함께 나오면 진료를 권합니다.', sourceRef: '국가건강검진 결과 해설' },
  { testCode: 'UA_BASIC', testName: '소변검사',
    plainWhat: '소변 속 단백·잠혈·당 등을 보아 콩팥·요로 상태를 가늠하는 검사예요.',
    plainMeaning: '단백·잠혈 등이 양성이면 추가 확인 필요를 참고로 보여줄 수 있어요. 일시적 요인으로도 나올 수 있어 재검으로 확인하기도 합니다.',
    lifestyleInfo: '충분한 수분과 무분별한 약물 남용 피하기가 일반적으로 권장돼요.',
    whenToSeeDoctor: '결과지에 이상·재검으로 표기되거나 배뇨 증상이 있으면 진료를 권합니다.', sourceRef: '국가건강검진 결과 해설' },
  { testCode: 'CHEST_PA', testName: '흉부 X-ray',
    plainWhat: '가슴 부위를 촬영해 폐·심장 등의 대략적 상태를 보는 영상검사예요.',
    plainMeaning: '판독의가 소견을 남기며, 이상 소견이 있으면 추가 검사 필요를 안내할 수 있어요. 해석은 판독의·의사가 담당합니다.',
    lifestyleInfo: '금연이 폐 건강에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '결과지 판독에 추가검사·경과관찰이 권고되면 안내에 따라 진료를 권합니다.', sourceRef: '영상 판독 소견 기반' },
  { testCode: 'ABD_US', testName: '상복부 초음파',
    plainWhat: '간·담낭·췌장·신장 등 상복부 장기를 초음파로 보는 검사예요.',
    plainMeaning: '지방간·담석·낭종 등의 소견이 참고로 기재될 수 있어요. 소견의 의미와 추적은 의사의 판단이 필요합니다.',
    lifestyleInfo: '지방간 소견 시 절주·체중 관리가 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '판독에 추가검사·추적이 권고되면 진료를 권합니다.', sourceRef: '영상 판독 소견 기반' },
  { testCode: 'BMD', testName: '골밀도검사(DEXA)',
    plainWhat: '뼈의 밀도를 측정해 골감소·골다공증 경향을 보는 검사예요.',
    plainMeaning: 'T-score가 낮은 범위면 뼈가 약해진 경향을 참고로 보여줄 수 있어요. 진단·관리는 의사의 판단이 필요합니다.',
    lifestyleInfo: '체중부하 운동, 칼슘·비타민D 섭취, 금연·절주가 뼈 건강에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '결과지에 골감소·골다공증으로 표기되거나 골절력이 있으면 진료를 권합니다.', sourceRef: 'WHO 골다공증 기준' },
  { testCode: 'FOBT', testName: '분변잠혈검사',
    plainWhat: '대변에 눈에 보이지 않는 혈액이 있는지 보는, 대장암 선별 검사예요.',
    plainMeaning: '양성이면 대장에 출혈 원인이 있을 가능성을 참고로 보여줄 수 있어요. 확인을 위해 대장내시경이 권고되기도 합니다(의사 판단).',
    lifestyleInfo: '섬유질 섭취·규칙적 배변 습관이 장 건강에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '결과가 양성이거나 배변 변화·혈변이 있으면 진료를 권합니다.', sourceRef: '국가암검진 안내' },
  { testCode: 'GASTROSCOPY', testName: '위내시경',
    plainWhat: '내시경으로 식도·위·십이지장 점막을 직접 관찰하는 검사예요.',
    plainMeaning: '위염·궤양·용종 등의 소견이 기재될 수 있으며, 필요 시 조직검사 결과가 함께 안내돼요. 해석은 의사가 담당합니다.',
    lifestyleInfo: '금연·절주, 자극적 음식 줄이기가 위 건강에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '판독에 추적·치료가 권고되거나 속쓰림·삼킴곤란이 지속되면 진료를 권합니다.', sourceRef: '내시경 소견 기반' },
  { testCode: 'COLONOSCOPY', testName: '대장내시경',
    plainWhat: '내시경으로 대장 점막을 직접 관찰하고 필요 시 용종을 확인하는 검사예요.',
    plainMeaning: '용종·염증 등의 소견과 제거·조직검사 결과가 기재될 수 있어요. 추적 주기 등은 의사의 판단이 필요합니다.',
    lifestyleInfo: '섬유질·활동, 절주·금연이 장 건강에 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '판독에 추적·치료가 권고되면 안내에 따라 진료를 권합니다.', sourceRef: '내시경 소견 기반' },
  { testCode: 'HBsAg', testName: 'B형간염 항원',
    plainWhat: 'B형간염 바이러스 감염 여부를 보는 검사예요.',
    plainMeaning: '양성이면 현재 감염 상태일 가능성을 참고로 보여줄 수 있어요. 감염 여부·관리는 의사의 진료가 필요합니다.',
    lifestyleInfo: '가족·주변과의 예방(백신·위생) 정보는 진료 시 함께 상담하면 좋아요.',
    whenToSeeDoctor: '결과가 양성이거나 간 관련 항목이 함께 이상이면 진료를 권합니다.', sourceRef: '대한간학회 참고자료' },
  { testCode: 'CEA', testName: '종양표지자(CEA)',
    plainWhat: '일부 암·염증 등에서 오를 수 있는 혈액 표지자예요.',
    plainMeaning: '높은 범위가 곧 암을 의미하지는 않으며, 흡연·염증 등으로도 오를 수 있어요. 해석은 다른 검사와 함께 의사가 판단합니다.',
    lifestyleInfo: '금연이 일부 표지자 수치에 영향을 줄 수 있다고 알려져 있어요.',
    whenToSeeDoctor: '결과지에 추가검사·추적이 권고되면 진료를 권합니다.', sourceRef: '국가건강검진 결과 해설' },
  { testCode: 'PFT', testName: '호흡기능검사(폐활량)',
    plainWhat: '숨을 들이쉬고 내쉬는 능력을 측정해 폐 기능을 보는 검사예요.',
    plainMeaning: '수치가 낮은 범위면 기류제한 등 폐기능 저하 가능성을 참고로 보여줄 수 있어요. 확인은 의사의 판단이 필요합니다.',
    lifestyleInfo: '금연이 폐 기능 유지에 일반적으로 가장 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '결과지에 이상으로 표기되거나 만성 기침·호흡곤란이 있으면 진료를 권합니다.', sourceRef: 'GOLD/국가건강검진 결과 해설' },
  { testCode: 'FUNDUS', testName: '안저검사',
    plainWhat: '눈 안쪽(망막·시신경·혈관)을 촬영해 상태를 보는 검사예요.',
    plainMeaning: '고혈압·당뇨 관련 변화나 녹내장 의심 소견이 참고로 기재될 수 있어요. 해석은 안과 판독이 필요합니다.',
    lifestyleInfo: '혈압·혈당 관리가 눈 혈관 건강에도 일반적으로 도움이 된다고 알려져 있어요.',
    whenToSeeDoctor: '판독에 안과 진료·추적이 권고되면 안내에 따라 진료를 권합니다.', sourceRef: '안과 판독 소견 기반' },
];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } }) ?? await prisma.user.findFirst();
  if (!admin) throw new Error('createdBy 사용자 없음');
  let c = 0, s = 0;
  for (const x of S) {
    if (await prisma.checkupExplainerContent.findUnique({ where: { testCode: x.testCode } })) { s++; continue; }
    await prisma.checkupExplainerContent.create({ data: { ...x, status: 'DRAFT', createdBy: admin.id } });
    c++;
  }
  console.log(`검진해석 확충 시드 — 생성 ${c} / 보존 ${s} (총 ${S.length}, DRAFT)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
