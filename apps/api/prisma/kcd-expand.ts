/**
 * KCD-8 상병코드 확충 — 추가·멱등 standalone 시드 (메인 seed 비파괴).
 * 다빈도 외래 상병 ~53종. codeSystem_code 유니크 upsert → 재실행 안전.
 * 운영 적용: 서버에서 `npx ts-node --transpile-only prisma/kcd-expand.ts`
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const codes: Array<{ code: string; nameKo: string; nameEn: string; category: string; chapter: string; icd10Code: string; icd11Code: string }> = [
  { code: 'J02.9', nameKo: '급성 인두염, 상세불명', nameEn: 'Acute pharyngitis, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J02.9', icd11Code: 'CA02.Z' },
  { code: 'J03.9', nameKo: '급성 편도염, 상세불명', nameEn: 'Acute tonsillitis, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J03.9', icd11Code: 'CA03.Z' },
  { code: 'J30.4', nameKo: '알레르기비염, 상세불명', nameEn: 'Allergic rhinitis, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J30.4', icd11Code: 'CA08.0' },
  { code: 'J32.9', nameKo: '만성 부비동염, 상세불명', nameEn: 'Chronic sinusitis, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J32.9', icd11Code: 'CA0A.Z' },
  { code: 'J35.1', nameKo: '편도의 비대', nameEn: 'Hypertrophy of tonsils', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J35.1', icd11Code: 'CA0F.0' },
  { code: 'K30', nameKo: '기능성 소화불량', nameEn: 'Functional dyspepsia', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K30', icd11Code: 'DD90.3' },
  { code: 'K52.9', nameKo: '비감염성 위장염 및 결장염, 상세불명', nameEn: 'Noninfective gastroenteritis and colitis, unspecified', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K52.9', icd11Code: 'DA9Z' },
  { code: 'K58.9', nameKo: '과민성 대장증후군', nameEn: 'Irritable bowel syndrome', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K58.9', icd11Code: 'DD91.0' },
  { code: 'K76.0', nameKo: '지방(변화)간, 달리 분류되지 않은', nameEn: 'Fatty liver, not elsewhere classified', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K76.0', icd11Code: 'DB92' },
  { code: 'K64', nameKo: '치핵 및 항문주위 정맥혈전증', nameEn: 'Haemorrhoids and perianal venous thrombosis', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K64', icd11Code: 'DB60' },
  { code: 'I11.9', nameKo: '고혈압성 심장병, 심부전 없는', nameEn: 'Hypertensive heart disease without heart failure', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I11.9', icd11Code: 'BA01.Z' },
  { code: 'I25.1', nameKo: '죽상경화성 심장병', nameEn: 'Atherosclerotic heart disease', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I25.1', icd11Code: 'BA5Z' },
  { code: 'I67.9', nameKo: '뇌혈관질환, 상세불명', nameEn: 'Cerebrovascular disease, unspecified', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I67.9', icd11Code: '8B2Z' },
  { code: 'I83.9', nameKo: '하지의 정맥류, 궤양이나 염증이 없는', nameEn: 'Varicose veins of lower extremities', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I83.9', icd11Code: 'BD74.Z' },
  { code: 'E04.9', nameKo: '비독성 갑상선종, 상세불명', nameEn: 'Nontoxic goitre, unspecified', category: '내분비계 질환', chapter: 'IV', icd10Code: 'E04.9', icd11Code: '5A03.Z' },
  { code: 'E05.9', nameKo: '갑상선중독증, 상세불명', nameEn: 'Thyrotoxicosis, unspecified', category: '내분비계 질환', chapter: 'IV', icd10Code: 'E05.9', icd11Code: '5A02.Z' },
  { code: 'E86', nameKo: '용적 감소(탈수)', nameEn: 'Volume depletion', category: '내분비/대사 질환', chapter: 'IV', icd10Code: 'E86', icd11Code: '5C70' },
  { code: 'M06.9', nameKo: '류마티스관절염, 상세불명', nameEn: 'Rheumatoid arthritis, unspecified', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M06.9', icd11Code: 'FA20.Z' },
  { code: 'M10.9', nameKo: '통풍, 상세불명', nameEn: 'Gout, unspecified', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M10.9', icd11Code: 'FA25.Z' },
  { code: 'M25.5', nameKo: '관절통', nameEn: 'Pain in joint', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M25.5', icd11Code: 'FA0Z' },
  { code: 'M79.1', nameKo: '근육통', nameEn: 'Myalgia', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M79.1', icd11Code: 'FB56.2' },
  { code: 'M48.0', nameKo: '척추협착', nameEn: 'Spinal stenosis', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M48.0', icd11Code: 'FA81.0' },
  { code: 'G40.9', nameKo: '간질, 상세불명', nameEn: 'Epilepsy, unspecified', category: '신경계 질환', chapter: 'VI', icd10Code: 'G40.9', icd11Code: '8A6Z' },
  { code: 'G43.9', nameKo: '편두통, 상세불명', nameEn: 'Migraine, unspecified', category: '신경계 질환', chapter: 'VI', icd10Code: 'G43.9', icd11Code: '8A80.Z' },
  { code: 'G47.0', nameKo: '수면개시 및 유지장애[불면증]', nameEn: 'Insomnia', category: '신경계 질환', chapter: 'VI', icd10Code: 'G47.0', icd11Code: '7A00' },
  { code: 'G56.0', nameKo: '손목굴증후군', nameEn: 'Carpal tunnel syndrome', category: '신경계 질환', chapter: 'VI', icd10Code: 'G56.0', icd11Code: '8C10.0' },
  { code: 'A41.9', nameKo: '패혈증, 상세불명', nameEn: 'Sepsis, unspecified', category: '감염성 질환', chapter: 'I', icd10Code: 'A41.9', icd11Code: '1G41' },
  { code: 'B02.9', nameKo: '합병증이 없는 대상포진', nameEn: 'Zoster without complication', category: '감염성 질환', chapter: 'I', icd10Code: 'B02.9', icd11Code: '1E91.Z' },
  { code: 'U07.1', nameKo: '코로나바이러스감염증-19, 바이러스 확인됨', nameEn: 'COVID-19, virus identified', category: '감염성 질환', chapter: 'XXII', icd10Code: 'U07.1', icd11Code: 'RA01.0' },
  { code: 'N40', nameKo: '전립선의 증식증', nameEn: 'Hyperplasia of prostate', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N40', icd11Code: 'GA90' },
  { code: 'N30.0', nameKo: '급성 방광염', nameEn: 'Acute cystitis', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N30.0', icd11Code: 'GC00.0' },
  { code: 'N80.9', nameKo: '자궁내막증, 상세불명', nameEn: 'Endometriosis, unspecified', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N80.9', icd11Code: 'GA10.Z' },
  { code: 'N95.1', nameKo: '폐경 및 여성 갱년기 상태', nameEn: 'Menopausal and female climacteric states', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N95.1', icd11Code: 'GA30.0' },
  { code: 'F20.9', nameKo: '조현병, 상세불명', nameEn: 'Schizophrenia, unspecified', category: '정신 및 행동장애', chapter: 'V', icd10Code: 'F20.9', icd11Code: '6A20.Z' },
  { code: 'F31.9', nameKo: '양극성 정동장애, 상세불명', nameEn: 'Bipolar affective disorder, unspecified', category: '정신 및 행동장애', chapter: 'V', icd10Code: 'F31.9', icd11Code: '6A60.Z' },
  { code: 'F03', nameKo: '상세불명의 치매', nameEn: 'Unspecified dementia', category: '정신 및 행동장애', chapter: 'V', icd10Code: 'F03', icd11Code: '6D8Z' },
  { code: 'H25.9', nameKo: '노년백내장, 상세불명', nameEn: 'Senile cataract, unspecified', category: '눈 질환', chapter: 'VII', icd10Code: 'H25.9', icd11Code: '9B10.2Z' },
  { code: 'H40.9', nameKo: '녹내장, 상세불명', nameEn: 'Glaucoma, unspecified', category: '눈 질환', chapter: 'VII', icd10Code: 'H40.9', icd11Code: '9C61.Z' },
  { code: 'H81.1', nameKo: '양성 돌발성 현기증(BPPV)', nameEn: 'Benign paroxysmal positional vertigo', category: '귀 질환', chapter: 'VIII', icd10Code: 'H81.1', icd11Code: 'AB31.0' },
  { code: 'L20.9', nameKo: '아토피성 피부염, 상세불명', nameEn: 'Atopic dermatitis, unspecified', category: '피부 질환', chapter: 'XII', icd10Code: 'L20.9', icd11Code: 'EA80.Z' },
  { code: 'L40.9', nameKo: '건선, 상세불명', nameEn: 'Psoriasis, unspecified', category: '피부 질환', chapter: 'XII', icd10Code: 'L40.9', icd11Code: 'EA90.Z' },
  { code: 'B35.9', nameKo: '백선증, 상세불명', nameEn: 'Dermatophytosis, unspecified', category: '감염성 질환', chapter: 'I', icd10Code: 'B35.9', icd11Code: '1F28.Z' },
  { code: 'R05', nameKo: '기침', nameEn: 'Cough', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R05', icd11Code: 'MD12' },
  { code: 'R10.4', nameKo: '기타 및 상세불명의 복통', nameEn: 'Other and unspecified abdominal pain', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R10.4', icd11Code: 'MD81' },
  { code: 'R51', nameKo: '두통', nameEn: 'Headache', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R51', icd11Code: 'MB40' },
  { code: 'R42', nameKo: '어지럼 및 어지러움', nameEn: 'Dizziness and giddiness', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R42', icd11Code: 'MB48.0' },
  { code: 'R11', nameKo: '오심 및 구토', nameEn: 'Nausea and vomiting', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R11', icd11Code: 'MD90' },
  { code: 'R07.4', nameKo: '흉통, 상세불명', nameEn: 'Chest pain, unspecified', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R07.4', icd11Code: 'MD30.Z' },
  { code: 'R53', nameKo: '병감 및 피로', nameEn: 'Malaise and fatigue', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R53', icd11Code: 'MG22' },
  { code: 'Z00.0', nameKo: '일반 성인 의학적 검사', nameEn: 'General adult medical examination', category: '건강상태에 영향', chapter: 'XXI', icd10Code: 'Z00.0', icd11Code: 'QA00' },
  { code: 'Z23', nameKo: '예방접종의 필요', nameEn: 'Need for immunization', category: '건강상태에 영향', chapter: 'XXI', icd10Code: 'Z23', icd11Code: 'QC00' },
];

async function main() {
  const validFrom = new Date('2021-01-01');
  let created = 0;
  for (const dc of codes) {
    const res = await prisma.diagnosisCode.upsert({
      where: { codeSystem_code: { codeSystem: 'KCD-8', code: dc.code } },
      update: { nameKo: dc.nameKo, nameEn: dc.nameEn, category: dc.category, chapter: dc.chapter, icd10Code: dc.icd10Code, icd11Code: dc.icd11Code, isActive: true },
      create: { codeSystem: 'KCD-8', code: dc.code, nameKo: dc.nameKo, nameEn: dc.nameEn, category: dc.category, chapter: dc.chapter, icd10Code: dc.icd10Code, icd11Code: dc.icd11Code, isActive: true, validFrom },
    });
    if (res) created++;
  }
  const total = await prisma.diagnosisCode.count({ where: { codeSystem: 'KCD-8' } });
  console.log(`KCD-8 확충: ${codes.length}건 upsert 처리, 현재 KCD-8 총 ${total}건`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
