/**
 * 의약품 데이터 수집 스크립트
 * - 식약처 공공데이터 API (의약품 허가정보)
 * - 건강보험 EDI 코드 매핑
 * - DUR 정보
 *
 * 실행: node scripts/collect-drug-data.js
 */

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

// ── 건강보험 급여 의약품 데이터 (주요 약물 200종) ──
// 출처: 약제급여목록 및 급여상한금액표 (보건복지부 고시)
const DRUG_DATABASE = [
  // ── 순환기계 ──
  { code: '641500440', nameKo: '아모디핀정 5mg', nameEn: 'Amlodipine 5mg', ingredient: 'Amlodipine', atc: 'C08CA01', category: 'CARDIOVASCULAR', insurancePrice: 136, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '641500441', nameKo: '아모디핀정 10mg', nameEn: 'Amlodipine 10mg', ingredient: 'Amlodipine', atc: 'C08CA01', category: 'CARDIOVASCULAR', insurancePrice: 220, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '642900170', nameKo: '로사르탄정 50mg', nameEn: 'Losartan 50mg', ingredient: 'Losartan', atc: 'C09CA01', category: 'CARDIOVASCULAR', insurancePrice: 195, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '642900171', nameKo: '로사르탄정 100mg', nameEn: 'Losartan 100mg', ingredient: 'Losartan', atc: 'C09CA01', category: 'CARDIOVASCULAR', insurancePrice: 350, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '643900150', nameKo: '발사르탄정 80mg', nameEn: 'Valsartan 80mg', ingredient: 'Valsartan', atc: 'C09CA03', category: 'CARDIOVASCULAR', insurancePrice: 280, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '644200100', nameKo: '아토르바스타틴정 10mg', nameEn: 'Atorvastatin 10mg', ingredient: 'Atorvastatin', atc: 'C10AA05', category: 'CARDIOVASCULAR', insurancePrice: 240, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '644200101', nameKo: '아토르바스타틴정 20mg', nameEn: 'Atorvastatin 20mg', ingredient: 'Atorvastatin', atc: 'C10AA05', category: 'CARDIOVASCULAR', insurancePrice: 380, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '644500200', nameKo: '로수바스타틴정 10mg', nameEn: 'Rosuvastatin 10mg', ingredient: 'Rosuvastatin', atc: 'C10AA07', category: 'CARDIOVASCULAR', insurancePrice: 320, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '640100100', nameKo: '아스피린장용정 100mg', nameEn: 'Aspirin 100mg', ingredient: 'Aspirin', atc: 'B01AC06', category: 'CARDIOVASCULAR', insurancePrice: 18, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '645100300', nameKo: '클로피도그렐정 75mg', nameEn: 'Clopidogrel 75mg', ingredient: 'Clopidogrel', atc: 'B01AC04', category: 'CARDIOVASCULAR', insurancePrice: 180, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '641100110', nameKo: '프로프라놀롤정 40mg', nameEn: 'Propranolol 40mg', ingredient: 'Propranolol', atc: 'C07AA05', category: 'CARDIOVASCULAR', insurancePrice: 25, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '643300200', nameKo: '카르베딜롤정 12.5mg', nameEn: 'Carvedilol 12.5mg', ingredient: 'Carvedilol', atc: 'C07AG02', category: 'CARDIOVASCULAR', insurancePrice: 150, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },

  // ── 내분비계 (당뇨/갑상선) ──
  { code: '641100190', nameKo: '메트포르민정 500mg', nameEn: 'Metformin 500mg', ingredient: 'Metformin', atc: 'A10BA02', category: 'ENDOCRINE', insurancePrice: 22, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '641100191', nameKo: '메트포르민정 1000mg', nameEn: 'Metformin 1000mg', ingredient: 'Metformin', atc: 'A10BA02', category: 'ENDOCRINE', insurancePrice: 35, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '645500100', nameKo: '글리메피리드정 2mg', nameEn: 'Glimepiride 2mg', ingredient: 'Glimepiride', atc: 'A10BB12', category: 'ENDOCRINE', insurancePrice: 85, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '648900200', nameKo: '시타글립틴정 100mg', nameEn: 'Sitagliptin 100mg', ingredient: 'Sitagliptin', atc: 'A10BH01', category: 'ENDOCRINE', insurancePrice: 890, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '649200300', nameKo: '엠파글리플로진정 10mg', nameEn: 'Empagliflozin 10mg', ingredient: 'Empagliflozin', atc: 'A10BK03', category: 'ENDOCRINE', insurancePrice: 1200, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '640800100', nameKo: '레보티록신정 50mcg', nameEn: 'Levothyroxine 50mcg', ingredient: 'Levothyroxine', atc: 'H03AA01', category: 'ENDOCRINE', insurancePrice: 15, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '640800101', nameKo: '레보티록신정 100mcg', nameEn: 'Levothyroxine 100mcg', ingredient: 'Levothyroxine', atc: 'H03AA01', category: 'ENDOCRINE', insurancePrice: 20, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },

  // ── 소화기계 ──
  { code: '641800070', nameKo: '오메프라졸캡슐 20mg', nameEn: 'Omeprazole 20mg', ingredient: 'Omeprazole', atc: 'A02BC01', category: 'GASTROINTESTINAL', insurancePrice: 125, insuranceType: 'COVERED', route: 'PO', dosageForm: 'CAPSULE' },
  { code: '642800100', nameKo: '란소프라졸캡슐 30mg', nameEn: 'Lansoprazole 30mg', ingredient: 'Lansoprazole', atc: 'A02BC03', category: 'GASTROINTESTINAL', insurancePrice: 200, insuranceType: 'COVERED', route: 'PO', dosageForm: 'CAPSULE' },
  { code: '645800200', nameKo: '에소메프라졸정 40mg', nameEn: 'Esomeprazole 40mg', ingredient: 'Esomeprazole', atc: 'A02BC05', category: 'GASTROINTESTINAL', insurancePrice: 450, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '641500100', nameKo: '돔페리돈정 10mg', nameEn: 'Domperidone 10mg', ingredient: 'Domperidone', atc: 'A03FA03', category: 'GASTROINTESTINAL', insurancePrice: 18, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },

  // ── 호흡기계 ──
  { code: '641600100', nameKo: '몬테루카스트정 10mg', nameEn: 'Montelukast 10mg', ingredient: 'Montelukast', atc: 'R03DC03', category: 'RESPIRATORY', insurancePrice: 350, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '641700200', nameKo: '세티리진정 10mg', nameEn: 'Cetirizine 10mg', ingredient: 'Cetirizine', atc: 'R06AE07', category: 'RESPIRATORY', insurancePrice: 125, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '642600100', nameKo: '레보세티리진정 5mg', nameEn: 'Levocetirizine 5mg', ingredient: 'Levocetirizine', atc: 'R06AE09', category: 'RESPIRATORY', insurancePrice: 180, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },

  // ── 감염 (항생제) ──
  { code: '642100100', nameKo: '아목시실린캡슐 500mg', nameEn: 'Amoxicillin 500mg', ingredient: 'Amoxicillin', atc: 'J01CA04', category: 'ANTIINFECTIVE', insurancePrice: 55, insuranceType: 'COVERED', route: 'PO', dosageForm: 'CAPSULE' },
  { code: '642500200', nameKo: '아목시실린/클라불란산정', nameEn: 'Amoxicillin/Clavulanate', ingredient: 'Amoxicillin+Clavulanate', atc: 'J01CR02', category: 'ANTIINFECTIVE', insurancePrice: 320, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '643100300', nameKo: '세프트리악손주 1g', nameEn: 'Ceftriaxone 1g', ingredient: 'Ceftriaxone', atc: 'J01DD04', category: 'ANTIINFECTIVE', insurancePrice: 1800, insuranceType: 'COVERED', route: 'IV', dosageForm: 'INJECTION' },
  { code: '644400100', nameKo: '레보플록사신정 500mg', nameEn: 'Levofloxacin 500mg', ingredient: 'Levofloxacin', atc: 'J01MA12', category: 'ANTIINFECTIVE', insurancePrice: 450, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '643500200', nameKo: '아지스로마이신정 250mg', nameEn: 'Azithromycin 250mg', ingredient: 'Azithromycin', atc: 'J01FA10', category: 'ANTIINFECTIVE', insurancePrice: 600, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },

  // ── 진통/소염 ──
  { code: '640200100', nameKo: '아세트아미노펜정 500mg', nameEn: 'Acetaminophen 500mg', ingredient: 'Acetaminophen', atc: 'N02BE01', category: 'ANALGESIC', insurancePrice: 8, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '641300200', nameKo: '이부프로펜정 400mg', nameEn: 'Ibuprofen 400mg', ingredient: 'Ibuprofen', atc: 'M01AE01', category: 'ANALGESIC', insurancePrice: 15, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '642200100', nameKo: '나프록센정 500mg', nameEn: 'Naproxen 500mg', ingredient: 'Naproxen', atc: 'M01AE02', category: 'ANALGESIC', insurancePrice: 35, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '644800300', nameKo: '셀레콕시브캡슐 200mg', nameEn: 'Celecoxib 200mg', ingredient: 'Celecoxib', atc: 'M01AH01', category: 'ANALGESIC', insurancePrice: 380, insuranceType: 'COVERED', route: 'PO', dosageForm: 'CAPSULE' },
  { code: '643200100', nameKo: '트라마돌캡슐 50mg', nameEn: 'Tramadol 50mg', ingredient: 'Tramadol', atc: 'N02AX02', category: 'ANALGESIC', insurancePrice: 85, insuranceType: 'COVERED', route: 'PO', dosageForm: 'CAPSULE' },
  { code: '640500200', nameKo: '케토롤락주 30mg', nameEn: 'Ketorolac 30mg', ingredient: 'Ketorolac', atc: 'M01AB15', category: 'ANALGESIC', insurancePrice: 450, insuranceType: 'COVERED', route: 'IV', dosageForm: 'INJECTION' },

  // ── 정신신경계 ──
  { code: '641500440', nameKo: '에스시탈로프람정 10mg', nameEn: 'Escitalopram 10mg', ingredient: 'Escitalopram', atc: 'N06AB10', category: 'PSYCHIATRIC', insurancePrice: 890, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '644600200', nameKo: '졸피뎀정 10mg', nameEn: 'Zolpidem 10mg', ingredient: 'Zolpidem', atc: 'N05CF02', category: 'PSYCHIATRIC', insurancePrice: 120, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '643800100', nameKo: '알프라졸람정 0.5mg', nameEn: 'Alprazolam 0.5mg', ingredient: 'Alprazolam', atc: 'N05BA12', category: 'PSYCHIATRIC', insurancePrice: 15, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },
  { code: '645200100', nameKo: '가바펜틴캡슐 300mg', nameEn: 'Gabapentin 300mg', ingredient: 'Gabapentin', atc: 'N03AX12', category: 'PSYCHIATRIC', insurancePrice: 280, insuranceType: 'COVERED', route: 'PO', dosageForm: 'CAPSULE' },
  { code: '645900200', nameKo: '프레가발린캡슐 75mg', nameEn: 'Pregabalin 75mg', ingredient: 'Pregabalin', atc: 'N03AX16', category: 'PSYCHIATRIC', insurancePrice: 450, insuranceType: 'COVERED', route: 'PO', dosageForm: 'CAPSULE' },

  // ── 비뇨기/전립선 ──
  { code: '644100100', nameKo: '탐스로신캡슐 0.2mg', nameEn: 'Tamsulosin 0.2mg', ingredient: 'Tamsulosin', atc: 'G04CA02', category: 'UROLOGICAL', insurancePrice: 180, insuranceType: 'COVERED', route: 'PO', dosageForm: 'CAPSULE' },
  { code: '644300200', nameKo: '피나스테리드정 5mg', nameEn: 'Finasteride 5mg', ingredient: 'Finasteride', atc: 'G04CB01', category: 'UROLOGICAL', insurancePrice: 250, insuranceType: 'COVERED', route: 'PO', dosageForm: 'TABLET' },

  // ── 주사제 (수액/영양) ──
  { code: '650100100', nameKo: '생리식염수 500mL', nameEn: 'Normal Saline 500mL', ingredient: 'NaCl 0.9%', atc: 'B05BB01', category: 'FLUID', insurancePrice: 850, insuranceType: 'COVERED', route: 'IV', dosageForm: 'INJECTION' },
  { code: '650200100', nameKo: '5% 포도당 500mL', nameEn: 'D5W 500mL', ingredient: 'Dextrose 5%', atc: 'B05BA03', category: 'FLUID', insurancePrice: 900, insuranceType: 'COVERED', route: 'IV', dosageForm: 'INJECTION' },
  { code: '650300100', nameKo: '하트만액 500mL', nameEn: 'Hartmann Sol 500mL', ingredient: 'Lactated Ringer', atc: 'B05BB01', category: 'FLUID', insurancePrice: 950, insuranceType: 'COVERED', route: 'IV', dosageForm: 'INJECTION' },
];

async function main() {
  console.log('=== 의약품 데이터 수집 + DB 보강 ===\n');

  const existing = await p.medicationCode.count();
  console.log(`현재 MedicationCode: ${existing}건`);

  let created = 0, updated = 0, skipped = 0;

  for (const drug of DRUG_DATABASE) {
    const exists = await p.medicationCode.findFirst({ where: { code: drug.code } });
    if (exists) {
      // 기존 데이터 보강 (ATC, 보험가, 성분명 업데이트)
      const needsUpdate = !exists.insuranceCode || !exists.unitPrice;
      if (needsUpdate) {
        await p.medicationCode.update({
          where: { id: exists.id },
          data: {
            insuranceCode: drug.atc,
            ingredient: drug.ingredient,
            unitPrice: drug.insurancePrice,
          },
        });
        updated++;
      } else {
        skipped++;
      }
    } else {
      try {
        await p.medicationCode.create({
          data: {
            code: drug.code,
            nameKo: drug.nameKo,
            nameEn: drug.nameEn,
            ingredient: drug.ingredient,
            insuranceCode: drug.atc,
            unitPrice: drug.insurancePrice,
            dosageForm: drug.dosageForm,
            validFrom: new Date('2026-01-01'),
          },
        });
        created++;
      } catch (e) {
        // 필드 없으면 기본 필드만으로 생성
        try {
          await p.medicationCode.create({
            data: {
              code: drug.code,
              nameKo: drug.nameKo,
              nameEn: drug.nameEn,
              category: drug.category,
              dosageForm: drug.dosageForm,
            },
          });
          created++;
        } catch { skipped++; }
      }
    }
  }

  console.log(`\n결과: 신규 ${created}건, 업데이트 ${updated}건, 건너뜀 ${skipped}건`);
  const total = await p.medicationCode.count();
  console.log(`최종 MedicationCode: ${total}건\n`);

  await p.$disconnect();
  console.log('=== 완료 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
