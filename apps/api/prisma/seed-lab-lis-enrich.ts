import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 검사실(LIS 연동) 시드 보강 — 멱등. LIS 왕복·분자진단·사전승인 고가검사 게이트 데모용.
 * 실행: npx tsx prisma/seed-lab-lis-enrich.ts  (또는 ts-node)
 *
 * 점검(2026-07-19)에서 식별된 갭 보강:
 *  ① preauth.imaging 판정기준 빈값 → 고가검사 게이트 무력 (config 실값 주입)
 *  ② 분자진단(PCR)·응급 검사 마스터 협소 (실 LOINC로 확대)
 *  ③ LabTestCode EDI 4종 공백 (NT-proBNP·Troponin-I·CK-MB·ABG)
 *
 * ⚠ LabResultItem 결과 코드 보정은 제외 — 이름기반 LOINC 매칭 금지 원칙(오LOINC 안전위험·PR#457).
 *   결과 LOINC는 코드기반(LIS 수신 Observation.code·수기 testCode 피커)으로만 채운다.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── ② 신규 검사 마스터(분자진단·응급) — 실 LOINC. EDI는 형태값(실 수가는 후속 CSV로 교체) ──
const NEW_LAB_CODES = [
  // 분자진단(PCR) — LIS가 분자진단 검사실
  { code: 'M0001', loincCode: '94500-6', nameKo: 'SARS-CoV-2 RNA (PCR)', nameEn: 'SARS-CoV-2 RNA', category: '분자진단', specimen: 'Nasopharyngeal swab', unit: '', refRangeMale: '', refRangeFemale: '', turnaround: 360, edi: 'D6591' },
  { code: 'M0002', loincCode: '38379-4', nameKo: '결핵균 DNA (TB-PCR)', nameEn: 'M. tuberculosis DNA', category: '분자진단', specimen: 'Sputum', unit: '', refRangeMale: 'Not detected', refRangeFemale: 'Not detected', turnaround: 720, edi: 'D6592' },
  { code: 'M0003', loincCode: '20447-9', nameKo: 'HIV RNA 정량 (Viral load)', nameEn: 'HIV-1 RNA', category: '분자진단', specimen: 'Plasma', unit: 'copies/mL', refRangeMale: '<20', refRangeFemale: '<20', turnaround: 720, edi: 'D6593' },
  { code: 'M0004', loincCode: '11259-9', nameKo: 'HCV RNA 정량', nameEn: 'HCV RNA', category: '분자진단', specimen: 'Plasma', unit: 'IU/mL', refRangeMale: '<15', refRangeFemale: '<15', turnaround: 720, edi: 'D6594' },
  { code: 'M0005', loincCode: '5010-4', nameKo: 'HBV DNA 정량', nameEn: 'HBV DNA', category: '분자진단', specimen: 'Plasma', unit: 'IU/mL', refRangeMale: '<10', refRangeFemale: '<10', turnaround: 720, edi: 'D6595' },
  { code: 'M0006', loincCode: '76078-5', nameKo: '인플루엔자 A/B RNA (PCR)', nameEn: 'Influenza A/B RNA', category: '분자진단', specimen: 'Nasopharyngeal swab', unit: '', refRangeMale: 'Not detected', refRangeFemale: 'Not detected', turnaround: 240, edi: 'D6596' },
  // 응급/심장 표지자
  { code: 'L0110', loincCode: '48065-7', nameKo: 'D-dimer', nameEn: 'D-dimer', category: '혈액', specimen: 'Blood', unit: 'μg/mL FEU', refRangeMale: '<0.5', refRangeFemale: '<0.5', turnaround: 60, edi: 'E6721' },
  { code: 'L0111', loincCode: '33959-8', nameKo: 'Procalcitonin', nameEn: 'Procalcitonin', category: '생화학', specimen: 'Blood', unit: 'ng/mL', refRangeMale: '<0.5', refRangeFemale: '<0.5', turnaround: 90, edi: 'E6731' },
  { code: 'L0112', loincCode: '2524-7', nameKo: 'Lactate (젖산)', nameEn: 'Lactate', category: '생화학', specimen: 'Blood', unit: 'mmol/L', refRangeMale: '0.5-2.2', refRangeFemale: '0.5-2.2', turnaround: 30, edi: 'E6741' },
];

// ── ③ 기존 EDI 공백 4종 보완 ──
const EDI_FIX: Record<string, string> = {
  L0109: 'E6712', // NT-proBNP
  L0701: 'E6751', // Troponin-I
  L0702: 'E6761', // CK-MB
  L0801: 'E6771', // ABG
};

async function main() {
  let created = 0, ediFixed = 0, termMapped = 0;

  // ② 신규 검사 마스터 upsert + LOINC 매핑(TerminologyMapping)
  for (const c of NEW_LAB_CODES) {
    const rec = await prisma.labTestCode.upsert({
      where: { code: c.code },
      update: { loincCode: c.loincCode, ediCode: c.edi || null, category: c.category, nameKo: c.nameKo, nameEn: c.nameEn, specimen: c.specimen, unit: c.unit, refRangeMale: c.refRangeMale, refRangeFemale: c.refRangeFemale, turnaroundMin: c.turnaround },
      create: { code: c.code, loincCode: c.loincCode, ediCode: c.edi || null, category: c.category, nameKo: c.nameKo, nameEn: c.nameEn, specimen: c.specimen, unit: c.unit, refRangeMale: c.refRangeMale, refRangeFemale: c.refRangeFemale, turnaroundMin: c.turnaround },
    });
    created++;
    // TerminologyMapping — testCode→LOINC(멱등)
    const existing = await prisma.terminologyMapping.findFirst({ where: { sourceTable: 'lab_test_codes', sourceId: rec.id, targetSystem: 'LOINC' } });
    if (!existing) {
      await prisma.terminologyMapping.create({ data: { sourceTable: 'lab_test_codes', sourceId: rec.id, sourceCode: c.code, targetSystem: 'LOINC', targetCode: c.loincCode, targetDisplay: c.nameEn ?? c.nameKo, mapSource: 'OFFICIAL' } }).catch(() => undefined);
      termMapped++;
    }
  }

  // ③ EDI 공백 보완
  for (const [code, edi] of Object.entries(EDI_FIX)) {
    const r = await prisma.labTestCode.updateMany({ where: { code, OR: [{ ediCode: null }, { ediCode: '' }] }, data: { ediCode: edi } });
    ediFixed += r.count;
  }

  // ① preauth.imaging 판정기준 config 기본값 주입(고가검사 게이트 데모 활성화)
  // 🔴 `update` 를 비워 둔다 — 이 기준(고가 검사 판정 금액·대상 분류)은 **원내 정책**이라
  //    기관이 `/admin` 에서 바꾼 값을 시드 재실행이 데모 값으로 되돌리면 안 된다(인바운드 H1 · 2026-09-21).
  await prisma.systemConfig.upsert({
    where: { key: 'preauth.imaging' },
    update: {},
    create: { key: 'preauth.imaging', value: { minUnitPrice: 100000, categories: ['영상진단료'], codePrefixes: [] }, category: 'clinical', label: '고가·특수 검사 판정 기준' },
  }).catch((e) => console.warn('preauth.imaging config 주입 실패(무시 가능):', e.message));

  console.log(`✅ LIS 검사실 시드 보강 완료 — 검사코드 upsert=${created}, EDI 보완=${ediFixed}, LOINC 매핑=${termMapped}, preauth.imaging config 주입`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
