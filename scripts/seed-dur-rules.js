const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

// ── 주요 약물 상호작용 규칙 (ATC 코드 기반) ──
// 출처: 건강보험심사평가원 DUR 점검 기준
const DUR_RULES = [
  // ── 병용금기 (Contraindicated) ──
  { drug1: 'C08CA01', drug1Name: '아모디핀', drug2: 'C08DB01', drug2Name: '딜티아젬', severity: 'CONTRAINDICATED', type: 'INTERACTION', description: 'CCB 중복 — 과도한 혈압 강하, 서맥, 심부전 위험', recommendation: '동시 투여 금지. 하나만 선택하여 사용' },
  { drug1: 'B01AC06', drug1Name: '아스피린', drug2: 'B01AA03', drug2Name: '와파린', severity: 'MAJOR', type: 'INTERACTION', description: '항응고+항혈소판 병용 — 출혈 위험 현저히 증가', recommendation: '병용 필요 시 INR 모니터링 강화, 출혈 증상 관찰' },
  { drug1: 'N02BE01', drug1Name: '아세트아미노펜', drug2: 'B01AA03', drug2Name: '와파린', severity: 'MODERATE', type: 'INTERACTION', description: '아세트아미노펜이 와파린 효과 증강 가능', recommendation: '1일 2g 이하로 제한, INR 모니터링' },
  { drug1: 'M01AE01', drug1Name: '이부프로펜', drug2: 'C09CA01', drug2Name: '로사르탄', severity: 'MODERATE', type: 'INTERACTION', description: 'NSAID가 ARB의 항고혈압 효과 감소 + 신기능 악화 가능', recommendation: '단기 사용 권장, 신기능 및 혈압 모니터링' },
  { drug1: 'M01AE01', drug1Name: '이부프로펜', drug2: 'B01AC06', drug2Name: '아스피린', severity: 'MODERATE', type: 'INTERACTION', description: 'NSAID가 아스피린의 항혈소판 효과 감소', recommendation: '이부프로펜 투여 30분 전 또는 8시간 후 아스피린 투여' },
  { drug1: 'N06AB10', drug1Name: '에스시탈로프람', drug2: 'N02AX02', drug2Name: '트라마돌', severity: 'MAJOR', type: 'INTERACTION', description: '세로토닌 증후군 위험 — SSRI + 트라마돌', recommendation: '병용 금지 또는 최소 용량, 세로토닌 증후군 증상 모니터링' },
  { drug1: 'N05CF02', drug1Name: '졸피뎀', drug2: 'N05BA12', drug2Name: '알프라졸람', severity: 'MAJOR', type: 'INTERACTION', description: '중추신경 억제 중복 — 과도한 진정, 호흡억제', recommendation: '동시 투여 피하기. 불가피 시 용량 감량' },
  { drug1: 'A10BA02', drug1Name: '메트포르민', drug2: 'V08AB', drug2Name: '요오드화 조영제', severity: 'CONTRAINDICATED', type: 'INTERACTION', description: '조영제 투여 시 메트포르민에 의한 젖산산증 위험', recommendation: '조영제 검사 48시간 전 메트포르민 중단, 검사 후 48시간 후 재개' },
  { drug1: 'C10AA05', drug1Name: '아토르바스타틴', drug2: 'J01FA10', drug2Name: '아지스로마이신', severity: 'MODERATE', type: 'INTERACTION', description: '마크로라이드가 스타틴 농도 증가 — 횡문근 융해 위험', recommendation: '병용 시 근육통/CK 모니터링, 가능하면 다른 항생제 선택' },
  { drug1: 'C10AA05', drug1Name: '아토르바스타틴', drug2: 'C08CA01', drug2Name: '아모디핀', severity: 'MINOR', type: 'INTERACTION', description: '아모디핀이 아토르바스타틴 농도 경미하게 증가', recommendation: '일반적으로 병용 가능, 아토르바스타틴 고용량 시 주의' },

  // ── 연령 금기 ──
  { drug1: 'M01AE01', drug1Name: '이부프로펜', drug2: null, drug2Name: null, severity: 'CONTRAINDICATED', type: 'AGE', description: '6개월 미만 영아 금기', recommendation: '6개월 미만 영아에게 투여 금지', ageMin: 0, ageMax: 0.5 },
  { drug1: 'N02BE01', drug1Name: '아세트아미노펜', drug2: null, drug2Name: null, severity: 'CAUTION', type: 'AGE', description: '3개월 미만 영아 주의', recommendation: '3개월 미만 영아 의사 상담 후 투여', ageMin: 0, ageMax: 0.25 },
  { drug1: 'J01MA12', drug1Name: '레보플록사신', drug2: null, drug2Name: null, severity: 'CONTRAINDICATED', type: 'AGE', description: '18세 미만 소아 금기 (퀴놀론계)', recommendation: '성장기 소아에게 투여 금지 — 관절/연골 손상 위험', ageMin: 0, ageMax: 18 },
  { drug1: 'N05CF02', drug1Name: '졸피뎀', drug2: null, drug2Name: null, severity: 'CONTRAINDICATED', type: 'AGE', description: '18세 미만 소아 금기', recommendation: '소아에게 투여 금지', ageMin: 0, ageMax: 18 },

  // ── 임부 금기 ──
  { drug1: 'C09CA01', drug1Name: '로사르탄', drug2: null, drug2Name: null, severity: 'CONTRAINDICATED', type: 'PREGNANCY', description: '임부 금기 (FDA 카테고리 D) — ARB', recommendation: '임부에게 투여 금지, 임신 확인 시 즉시 중단' },
  { drug1: 'C10AA05', drug1Name: '아토르바스타틴', drug2: null, drug2Name: null, severity: 'CONTRAINDICATED', type: 'PREGNANCY', description: '임부 금기 (FDA 카테고리 X) — 스타틴', recommendation: '임부에게 절대 투여 금지' },
  { drug1: 'A10BA02', drug1Name: '메트포르민', drug2: null, drug2Name: null, severity: 'CAUTION', type: 'PREGNANCY', description: '임부 주의 — 인슐린으로 전환 권고', recommendation: '임신 시 인슐린 치료로 전환' },

  // ── 중복 처방 ──
  { drug1: 'C08CA01', drug1Name: '아모디핀', drug2: 'C08CA01', drug2Name: '아모디핀', severity: 'CONTRAINDICATED', type: 'DUPLICATE', description: '동일 성분 중복 처방', recommendation: '동일 성분 중복 투여 금지' },
  { drug1: 'M01AE01', drug1Name: '이부프로펜', drug2: 'M01AE02', drug2Name: '나프록센', severity: 'MAJOR', type: 'DUPLICATE', description: 'NSAID 동일 계열 중복 — 위장관 출혈 위험 증가', recommendation: 'NSAID 1종만 선택하여 사용' },
  { drug1: 'A02BC01', drug1Name: '오메프라졸', drug2: 'A02BC03', drug2Name: '란소프라졸', severity: 'MAJOR', type: 'DUPLICATE', description: 'PPI 동일 계열 중복', recommendation: 'PPI 1종만 선택하여 사용' },

  // ── 용량 주의 ──
  { drug1: 'N02BE01', drug1Name: '아세트아미노펜', drug2: null, drug2Name: null, severity: 'MAJOR', type: 'DOSE', description: '1일 최대 4g 초과 금지 — 간독성 위험', recommendation: '1일 총 투여량 4g 초과 금지, 간기능 장애 시 2g 이하', maxDailyDose: 4000 },
  { drug1: 'M01AE01', drug1Name: '이부프로펜', drug2: null, drug2Name: null, severity: 'MODERATE', type: 'DOSE', description: '1일 최대 2.4g 초과 주의', recommendation: '일반 진통: 1.2g/일, 항염: 최대 2.4g/일', maxDailyDose: 2400 },
];

async function main() {
  console.log('=== DUR 규칙 시드 데이터 추가 ===\n');

  // SystemConfig에 DUR 규칙 저장
  const admin = await p.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) { console.error('ADMIN 사용자 없음'); return; }

  let created = 0;
  for (let i = 0; i < DUR_RULES.length; i++) {
    const rule = DUR_RULES[i];
    const key = `dur.rule.${i + 1}`;
    const exists = await p.systemConfig.findFirst({ where: { key } });
    if (exists) { continue; }
    await p.systemConfig.upsert({
      where: { key },
      update: {},
      create: {
        key,
        value: rule,
        category: 'dur',
        label: `${rule.type}: ${rule.drug1Name}${rule.drug2Name ? ' + ' + rule.drug2Name : ''} (${rule.severity})`,
        updatedBy: admin.id,
      },
    });
    created++;
  }

  console.log(`DUR 규칙 ${created}건 추가 (총 ${DUR_RULES.length}건)`);

  // MedicationCode에 DUR 관련 필드 업데이트 (maxDailyDose)
  const doseRules = DUR_RULES.filter(r => r.type === 'DOSE' && r.maxDailyDose);
  for (const rule of doseRules) {
    const meds = await p.medicationCode.findMany({
      where: { insuranceCode: rule.drug1 },
      select: { id: true, maxDailyDose: true },
    });
    for (const med of meds) {
      if (!med.maxDailyDose) {
        await p.medicationCode.update({
          where: { id: med.id },
          data: { maxDailyDose: rule.maxDailyDose },
        });
      }
    }
  }

  const total = await p.systemConfig.count({ where: { category: 'dur' } });
  console.log(`최종 DUR 규칙: ${total}건\n=== 완료 ===`);
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
