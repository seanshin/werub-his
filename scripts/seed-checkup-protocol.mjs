#!/usr/bin/env node
/**
 * 국가 일반건강검진 표준 검진 프로토콜 시드 (멱등).
 * code=CK-NHIS-GENERAL 가 이미 있으면 스킵. 생성 → 표준 판정룰 등록 → 발효(ACTIVE).
 * 판정등급 A 정상 · B 경미이상 · C1 요관찰(질환의심) · C2 요치료(질환의심강) · D1 정밀.
 * 사용: API_BASE=http://localhost:4000 node scripts/seed-checkup-protocol.mjs
 */
const API = (process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL || 'admin@hospital.example.org';
const PASS = process.env.ADMIN_PASS || 'staff1234!';

// 국가 일반건강검진 표준 판정 룰. 패널(혈압/지질/간)은 표준 분석물 코드로 분해.
const RULES = [
  // 혈당
  { testCode: 'FBS', sex: 'ALL', normalLow: 70, normalHigh: 99, panicLow: 50, panicHigh: 300, gradeBands: [{ op: '>=', value: 126, grade: 'C2' }, { op: 'between', min: 100, max: 125, grade: 'C1' }], requiredInterpretation: false },
  { testCode: 'HbA1c', sex: 'ALL', normalLow: 4, normalHigh: 5.6, gradeBands: [{ op: '>=', value: 6.5, grade: 'C2' }, { op: 'between', min: 5.7, max: 6.4, grade: 'C1' }] },
  // 혈압(분해: SBP/DBP)
  { testCode: 'SBP', sex: 'ALL', normalLow: 90, normalHigh: 119, panicHigh: 180, panicLow: 80, gradeBands: [{ op: '>=', value: 140, grade: 'C2' }, { op: 'between', min: 120, max: 139, grade: 'C1' }] },
  { testCode: 'DBP', sex: 'ALL', normalLow: 60, normalHigh: 79, panicHigh: 120, gradeBands: [{ op: '>=', value: 90, grade: 'C2' }, { op: 'between', min: 80, max: 89, grade: 'C1' }] },
  // 지질(분해: TC/LDL/HDL/TG)
  { testCode: 'TC', sex: 'ALL', normalLow: 0, normalHigh: 199, gradeBands: [{ op: '>=', value: 240, grade: 'C2' }, { op: 'between', min: 200, max: 239, grade: 'C1' }] },
  { testCode: 'LDL', sex: 'ALL', normalLow: 0, normalHigh: 129, gradeBands: [{ op: '>=', value: 160, grade: 'C2' }, { op: 'between', min: 130, max: 159, grade: 'C1' }] },
  { testCode: 'HDL', sex: 'ALL', normalLow: 40, normalHigh: 200, gradeBands: [{ op: '<', value: 40, grade: 'C1' }] },
  { testCode: 'TG', sex: 'ALL', normalLow: 0, normalHigh: 149, panicHigh: 500, gradeBands: [{ op: '>=', value: 200, grade: 'C2' }, { op: 'between', min: 150, max: 199, grade: 'C1' }] },
  // 간기능(분해: AST/ALT/GGT) — GGT 성별 기준
  { testCode: 'AST', sex: 'ALL', normalLow: 0, normalHigh: 40, panicHigh: 300, gradeBands: [{ op: '>=', value: 51, grade: 'C2' }, { op: 'between', min: 41, max: 50, grade: 'C1' }] },
  { testCode: 'ALT', sex: 'ALL', normalLow: 0, normalHigh: 40, panicHigh: 300, gradeBands: [{ op: '>=', value: 51, grade: 'C2' }, { op: 'between', min: 41, max: 50, grade: 'C1' }] },
  { testCode: 'GGT', sex: 'MALE', normalLow: 0, normalHigh: 63, gradeBands: [{ op: '>', value: 63, grade: 'C1' }] },
  { testCode: 'GGT', sex: 'FEMALE', normalLow: 0, normalHigh: 35, gradeBands: [{ op: '>', value: 35, grade: 'C1' }] },
  // 신장(분해: Cr)
  { testCode: 'CR', sex: 'ALL', normalLow: 0.6, normalHigh: 1.2, panicHigh: 4, gradeBands: [{ op: '>', value: 1.3, grade: 'C1' }] },
  // 혈색소(빈혈) 성별 기준
  { testCode: 'HB', sex: 'MALE', normalLow: 13, normalHigh: 16.5, panicLow: 7, gradeBands: [{ op: '<', value: 13, grade: 'C1' }] },
  { testCode: 'HB', sex: 'FEMALE', normalLow: 12, normalHigh: 15.5, panicLow: 7, gradeBands: [{ op: '<', value: 12, grade: 'C1' }] },
  // 요산
  { testCode: 'URIC', sex: 'ALL', normalLow: 3.5, normalHigh: 7.0, gradeBands: [{ op: '>', value: 7.0, grade: 'C1' }] },
  // BMI
  { testCode: 'BMI', sex: 'ALL', normalLow: 18.5, normalHigh: 22.9, gradeBands: [{ op: '>=', value: 25, grade: 'C2' }, { op: 'between', min: 23, max: 24.9, grade: 'C1' }, { op: '<', value: 18.5, grade: 'C1' }] },
  // 비타민D
  { testCode: 'VIT_D', sex: 'ALL', normalLow: 20, normalHigh: 100, gradeBands: [{ op: '<', value: 10, grade: 'C2' }, { op: 'between', min: 10, max: 19.9, grade: 'C1' }] },
  // 고감도 CRP
  { testCode: 'hsCRP', sex: 'ALL', normalLow: 0, normalHigh: 0.9, gradeBands: [{ op: '>', value: 3, grade: 'C2' }, { op: 'between', min: 1, max: 3, grade: 'C1' }] },
];

(async () => {
  const tok = (await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) })).json())?.data?.accessToken;
  if (!tok) { console.error('login failed'); process.exit(1); }
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` };

  const existing = (await (await fetch(`${API}/api/v1/checkup/protocols`, { headers: H })).json())?.data ?? [];
  if (existing.some((p) => p.code === 'CK-NHIS-GENERAL')) { console.log('이미 존재(CK-NHIS-GENERAL) — 스킵'); return; }

  const created = (await (await fetch(`${API}/api/v1/checkup/protocols`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ code: 'CK-NHIS-GENERAL', name: '국가 일반건강검진 표준', gender: 'ALL', signerRoles: ['DOCTOR'], requireAllInterpretations: true }),
  })).json())?.data;
  console.log('생성:', created.code, created.id);

  await fetch(`${API}/api/v1/checkup/protocols/${created.id}/rules`, { method: 'PUT', headers: H, body: JSON.stringify({ rules: RULES }) });
  console.log(`룰 ${RULES.length}건 등록`);

  const pub = (await (await fetch(`${API}/api/v1/checkup/protocols/${created.id}/publish`, { method: 'POST', headers: H })).json())?.data;
  console.log('발효:', pub.status);

  // 검증 미리보기
  for (const [tc, v] of [['FBS', 130], ['SBP', 145], ['HDL', 35], ['HbA1c', 6.0]]) {
    const r = (await (await fetch(`${API}/api/v1/checkup/protocols/${created.id}/judge-preview`, { method: 'POST', headers: H, body: JSON.stringify({ testCode: tc, value: v }) })).json())?.data;
    console.log(`  ${tc}=${v} → ${r.finding}/${r.grade}${r.panic ? '(panic)' : ''}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
