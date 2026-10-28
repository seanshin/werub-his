import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 만성질환 추적관찰 시드 — 환자 1명에 **외래 20회(약 2년)** 경과를 서사로 생성.
//
// 목적: '차트 시계열'(회차 열 비교)과 '처방 시계열'(약물 기간 레인)이 실제 추적관찰처럼 읽히는지 검증.
// 서사: 고혈압 발견 → 약물 시작·증량 → 당뇨 병발 → 메트포르민 시작·부작용으로 서방정 전환 →
//       이상지질 추가 → 미세알부민뇨(ARB 증량) → HbA1c 재상승(DPP-4i 추가) → 저혈당 후 감량 → 안정.
// 멱등: 결정적 UUID upsert(ns 'cfseed'). 재실행 시 값도 갱신(update 비우지 않음).
// 실행: cd apps/api && npx tsx prisma/seed-chronic-followup.ts <patientId|MRN>
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

const makeId = (ns: string, n: string | number): string => {
  const h = createHash('sha256').update(`cfseed:${ns}:${n}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const daysAgo = (d: number, hour = 10) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(hour, 30, 0, 0);
  return x;
};

/** 약품 사전 — 실제 마스터에서 이름으로 찾고, 없으면 첫 약품으로 대체(시드 목적상 표기만 중요) */
const DRUGS = ['로사르탄', '메트포르민', '아토르바스타틴', '시타글립틴', '암로디핀'] as const;
type DrugKey = (typeof DRUGS)[number];

interface Visit {
  d: number;                       // 며칠 전
  cc: string;
  s: string; o: string; a: string; p: string;
  dx: string[];                    // KCD 코드
  bp: [number, number]; hr: number; wt: number;
  labs?: [string, string, string, string, number | null, number | null][]; // 검사명·값·단위·flag·하한·상한
  rx?: { drug: DrugKey; dose: string; freq: string; days: number; stop?: boolean }[];
}

// 오래된 → 최근 (20회). 간격: 초반 4~8주, 안정기 12주
// 🔴 HbA1c 참고상한은 정본(`chronic.service` HBA1C `{min: 4.0, max: 6.5}`)을 따른다 —
//    종전 시드는 5.7 을 써서, 같은 화면(검사 상세·만성 시계열)에서 같은 분석물의 참고범위가
//    행마다 달라지고 6.6% 의 H/N 판정이 어느 시드에서 왔느냐로 갈렸다.
const VISITS: Visit[] = [
  { d: 720, cc: '건강검진 혈압 상승 소견', s: '증상 없음. 검진에서 혈압 높다고 들었음.', o: 'BP 148/94. 체중 82kg. 흡연 없음.', a: '혈압 상승(관찰) — 본태성 고혈압 의증', p: '4주 생활습관 교정(저염·주 150분 운동) 후 재측정. 가정혈압 기록 교육.', dx: ['I10'], bp: [148, 94], hr: 78, wt: 82,
    labs: [['Creatinine', '0.9', 'mg/dL', 'N', 0.7, 1.3], ['Glucose', '108', 'mg/dL', 'H', 70, 100]] },
  { d: 692, cc: '혈압 재측정', s: '두통 간헐. 짠 음식 줄였음.', o: 'BP 150/96. 가정혈압 평균 147/93.', a: '본태성 고혈압 확진 — 1단계', p: 'ARB 시작(로사르탄 50mg). 4주 후 신기능·전해질 확인.', dx: ['I10'], bp: [150, 96], hr: 80, wt: 82,
    rx: [{ drug: '로사르탄', dose: '50mg', freq: 'qd', days: 28 }] },
  { d: 664, cc: '약물 시작 후 경과', s: '두통 호소 감소. 어지럼 부인.', o: 'BP 138/86. 체중 81kg.', a: '고혈압 — 약물 반응 양호', p: '동일 용량 유지. 8주 처방. HbA1c 추가 확인.', dx: ['I10'], bp: [138, 86], hr: 76, wt: 81,
    labs: [['Creatinine', '0.9', 'mg/dL', 'N', 0.7, 1.3], ['K', '4.3', 'mmol/L', 'N', 3.5, 5.1], ['HbA1c', '6.6', '%', 'H', 4, 6.5]],
    rx: [{ drug: '로사르탄', dose: '50mg', freq: 'qd', days: 56 }] },
  { d: 608, cc: '혈당 상승 상담', s: '갈증·다뇨 경미. 체중 변화 없음.', o: 'BP 136/84. FBS 132.', a: '당뇨병 전단계 → 2형 당뇨병 진입 판단', p: '메트포르민 500mg 시작(식후). 당뇨 교육 의뢰. 8주 후 HbA1c.', dx: ['I10', 'E11'], bp: [136, 84], hr: 78, wt: 81,
    labs: [['Glucose', '132', 'mg/dL', 'H', 70, 100], ['HbA1c', '7.2', '%', 'H', 4, 6.5]],
    rx: [{ drug: '로사르탄', dose: '50mg', freq: 'qd', days: 56 }, { drug: '메트포르민', dose: '500mg', freq: 'bid', days: 56 }] },
  { d: 552, cc: '당뇨약 부작용 상담', s: '복부 불편감·설사 호소. 복약은 유지.', o: 'BP 134/82. 체중 80kg.', a: '메트포르민 위장 부작용', p: '서방정으로 전환(1000mg qd 취침). 증상 지속 시 연락.', dx: ['I10', 'E11'], bp: [134, 82], hr: 76, wt: 80,
    rx: [{ drug: '로사르탄', dose: '50mg', freq: 'qd', days: 56 }, { drug: '메트포르민', dose: '1000mg', freq: 'qd(서방)', days: 56 }] },
  { d: 496, cc: '경과 관찰', s: '위장 증상 소실. 운동 주 3회.', o: 'BP 132/80. 체중 79kg.', a: '고혈압·당뇨 — 조절 개선 중', p: '동일 유지. HbA1c·지질 확인.', dx: ['I10', 'E11'], bp: [132, 80], hr: 74, wt: 79,
    labs: [['HbA1c', '6.9', '%', 'H', 4, 6.5], ['LDL', '148', 'mg/dL', 'H', null, 130], ['Creatinine', '1.0', 'mg/dL', 'N', 0.7, 1.3]],
    rx: [{ drug: '로사르탄', dose: '50mg', freq: 'qd', days: 84 }, { drug: '메트포르민', dose: '1000mg', freq: 'qd(서방)', days: 84 }] },
  { d: 440, cc: '이상지질 상담', s: '특이 증상 없음.', o: 'BP 130/80. LDL 148.', a: '이상지질혈증 동반(고위험군)', p: '스타틴 시작(아토르바스타틴 10mg). 3개월 후 지질·간효소.', dx: ['I10', 'E11', 'E78.0'], bp: [130, 80], hr: 74, wt: 79,
    rx: [{ drug: '로사르탄', dose: '50mg', freq: 'qd', days: 84 }, { drug: '메트포르민', dose: '1000mg', freq: 'qd(서방)', days: 84 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 84 }] },
  { d: 384, cc: '정기 추적', s: '근육통 부인. 복약 순응 양호.', o: 'BP 128/78. 체중 78kg.', a: '3제 병용 — 목표 접근', p: '유지. 미세알부민뇨 검사 추가.', dx: ['I10', 'E11', 'E78.0'], bp: [128, 78], hr: 72, wt: 78,
    labs: [['LDL', '96', 'mg/dL', 'N', null, 130], ['ALT', '28', 'U/L', 'N', null, 40], ['HbA1c', '6.8', '%', 'H', 4, 6.5]],
    rx: [{ drug: '로사르탄', dose: '50mg', freq: 'qd', days: 84 }, { drug: '메트포르민', dose: '1000mg', freq: 'qd(서방)', days: 84 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 84 }] },
  { d: 356, cc: '미세알부민뇨 결과 상담', s: '증상 없음. 부종 부인.', o: 'UACR 62 mg/g. BP 130/82.', a: '당뇨병성 초기 신증(미세알부민뇨)', p: 'ARB 증량(로사르탄 100mg). 신기능 4주 후 재확인. 단백 제한 교육.', dx: ['I10', 'E11'], bp: [130, 82], hr: 74, wt: 78,
    labs: [['UACR', '62', 'mg/g', 'H', null, 30], ['Creatinine', '1.0', 'mg/dL', 'N', 0.7, 1.3]],
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 28 }, { drug: '메트포르민', dose: '1000mg', freq: 'qd(서방)', days: 28 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 28 }] },
  { d: 328, cc: 'ARB 증량 후 확인', s: '기립 시 어지럼 경미.', o: 'BP 124/76. Cr 1.1, K 4.6.', a: '증량 후 안정 — 신기능 유지', p: '증량 유지. 기립성 저혈압 주의 교육.', dx: ['I10', 'E11'], bp: [124, 76], hr: 72, wt: 78,
    labs: [['Creatinine', '1.1', 'mg/dL', 'N', 0.7, 1.3], ['K', '4.6', 'mmol/L', 'N', 3.5, 5.1]],
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 84 }, { drug: '메트포르민', dose: '1000mg', freq: 'qd(서방)', days: 84 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 84 }] },
  { d: 272, cc: '당뇨 합병증 선별', s: '시야 흐림 부인. 발 저림 경미.', o: 'BP 126/78. 족부 진찰 — 진동감각 정상.', a: '당뇨 합병증 선별 — 안과 의뢰 필요', p: '안과 망막검사 의뢰. 족부 관리 교육. 12주 후 재방문.', dx: ['E11', 'I10'], bp: [126, 78], hr: 74, wt: 77,
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 84 }, { drug: '메트포르민', dose: '1000mg', freq: 'qd(서방)', days: 84 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 84 }] },
  { d: 216, cc: '혈당 재상승', s: '명절 이후 체중 증가. 간식 늘었음.', o: 'BP 128/80. 체중 79kg. HbA1c 7.4.', a: '당뇨 조절 악화 — 2제 병용 필요', p: 'DPP-4 억제제 추가(시타글립틴 100mg). 영양 재교육.', dx: ['E11', 'I10'], bp: [128, 80], hr: 76, wt: 79,
    labs: [['HbA1c', '7.4', '%', 'H', 4, 6.5], ['Glucose', '148', 'mg/dL', 'H', 70, 100]],
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 84 }, { drug: '메트포르민', dose: '1000mg', freq: 'qd(서방)', days: 84 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 84 }, { drug: '시타글립틴', dose: '100mg', freq: 'qd', days: 84 }] },
  { d: 188, cc: '저혈당 의심 삽화', s: '오전 공복 시 식은땀·손떨림 1회. 사탕 먹고 호전.', o: 'BP 126/78. 자가측정 62 mg/dL 기록.', a: '경도 저혈당 삽화 — 용량 조정 필요', p: '메트포르민 500mg 로 감량. 저혈당 대처 교육. 4주 후 확인.', dx: ['E11'], bp: [126, 78], hr: 78, wt: 78,
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 28 }, { drug: '메트포르민', dose: '500mg', freq: 'qd(서방)', days: 28 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 28 }, { drug: '시타글립틴', dose: '100mg', freq: 'qd', days: 28 }] },
  { d: 160, cc: '감량 후 경과', s: '저혈당 재발 없음.', o: 'BP 124/76. 체중 77kg.', a: '조절 안정화', p: '동일 유지. 12주 처방.', dx: ['E11', 'I10'], bp: [124, 76], hr: 74, wt: 77,
    labs: [['HbA1c', '7.0', '%', 'H', 4, 6.5]],
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 84 }, { drug: '메트포르민', dose: '500mg', freq: 'qd(서방)', days: 84 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 84 }, { drug: '시타글립틴', dose: '100mg', freq: 'qd', days: 84 }] },
  { d: 132, cc: '혈압 변동 상담', s: '늦은 저녁 식사 후 두근거림.', o: 'BP 138/88(진료실). 가정혈압 평균 134/85.', a: '혈압 목표 미달 — 병용 고려', p: 'CCB 추가(암로디핀 5mg). 하지 부종 관찰 교육.', dx: ['I10'], bp: [138, 88], hr: 80, wt: 77,
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 56 }, { drug: '암로디핀', dose: '5mg', freq: 'qd', days: 56 }, { drug: '메트포르민', dose: '500mg', freq: 'qd(서방)', days: 56 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 56 }, { drug: '시타글립틴', dose: '100mg', freq: 'qd', days: 56 }] },
  { d: 104, cc: 'CCB 추가 후 확인', s: '경미한 발목 부종. 통증 없음.', o: 'BP 122/74. 하지 함요부종 1+.', a: '혈압 목표 도달 — CCB 부종(경미)', p: '용량 유지·다리 올리기 교육. 부종 심하면 감량 검토.', dx: ['I10'], bp: [122, 74], hr: 72, wt: 77,
    labs: [['Creatinine', '1.1', 'mg/dL', 'N', 0.7, 1.3], ['LDL', '88', 'mg/dL', 'N', null, 130]],
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 84 }, { drug: '암로디핀', dose: '5mg', freq: 'qd', days: 84 }, { drug: '메트포르민', dose: '500mg', freq: 'qd(서방)', days: 84 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 84 }, { drug: '시타글립틴', dose: '100mg', freq: 'qd', days: 84 }] },
  { d: 76, cc: '정기 추적', s: '증상 없음. 운동 주 4회 유지.', o: 'BP 120/74. 체중 76kg.', a: '고혈압·당뇨·이상지질 — 전 항목 목표 내', p: '동일 유지. 안과 결과 확인(망막병증 없음).', dx: ['I10', 'E11', 'E78.0'], bp: [120, 74], hr: 70, wt: 76,
    labs: [['HbA1c', '6.7', '%', 'H', 4, 6.5], ['UACR', '28', 'mg/g', 'N', null, 30]],
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 84 }, { drug: '암로디핀', dose: '5mg', freq: 'qd', days: 84 }, { drug: '메트포르민', dose: '500mg', freq: 'qd(서방)', days: 84 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 84 }, { drug: '시타글립틴', dose: '100mg', freq: 'qd', days: 84 }] },
  { d: 48, cc: '독감 예방접종 및 상담', s: '특이 증상 없음.', o: 'BP 122/76. 접종 부위 이상 없음.', a: '만성질환 안정 — 예방접종 시행', p: '인플루엔자 접종 완료. 동일 처방 유지.', dx: ['I10', 'E11'], bp: [122, 76], hr: 72, wt: 76,
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 56 }, { drug: '암로디핀', dose: '5mg', freq: 'qd', days: 56 }, { drug: '메트포르민', dose: '500mg', freq: 'qd(서방)', days: 56 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 56 }, { drug: '시타글립틴', dose: '100mg', freq: 'qd', days: 56 }] },
  { d: 20, cc: '정기 추적(3개월)', s: '전반적 컨디션 양호. 저혈당 없음.', o: 'BP 118/72. 체중 76kg.', a: '전 항목 목표 유지 — 합병증 진행 없음', p: '동일 유지. 3개월 후 재방문·연간 합병증 검사 예약.', dx: ['I10', 'E11', 'E78.0'], bp: [118, 72], hr: 70, wt: 76,
    labs: [['HbA1c', '6.6', '%', 'H', 4, 6.5], ['Creatinine', '1.0', 'mg/dL', 'N', 0.7, 1.3], ['LDL', '82', 'mg/dL', 'N', null, 130]],
    rx: [{ drug: '로사르탄', dose: '100mg', freq: 'qd', days: 90 }, { drug: '암로디핀', dose: '5mg', freq: 'qd', days: 90 }, { drug: '메트포르민', dose: '500mg', freq: 'qd(서방)', days: 90 }, { drug: '아토르바스타틴', dose: '10mg', freq: 'qd', days: 90 }, { drug: '시타글립틴', dose: '100mg', freq: 'qd', days: 90 }] },
  { d: 6, cc: '혈압 자가측정 이상 문의', s: '가정혈압 1회 150/95 측정되어 방문. 증상 없음.', o: '진료실 BP 126/78(2회 평균). 측정법 재확인 — 커프 위치 오류 확인.', a: '측정 오류로 인한 일시 상승 — 조절 상태 양호', p: '측정법 재교육. 처방 변경 없음. 예정대로 3개월 후 방문.', dx: ['I10'], bp: [126, 78], hr: 74, wt: 76 },
];

async function main() {
  const arg = process.argv[2];
  if (!arg) { console.error('사용법: npx tsx prisma/seed-chronic-followup.ts <patientId|MRN>'); process.exit(1); }
  const patient = await prisma.patient.findFirst({
    where: arg.includes('-') && arg.length > 20 ? { id: arg } : { mrn: arg },
    select: { id: true, mrn: true, familyName: true, givenName: true },
  });
  if (!patient) { console.error(`환자를 찾을 수 없음: ${arg}`); process.exit(1); }
  const P = patient.id;

  const doctor = await prisma.user.findFirst({ where: { role: 'DOCTOR' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  const nurse = await prisma.user.findFirst({ where: { role: 'NURSE' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  if (!doctor || !nurse) { console.error('의사/간호사 계정 없음'); process.exit(1); }
  const D = doctor.id, N = nurse.id;

  // 진단 코드
  const dxCodes = await prisma.diagnosisCode.findMany({ where: { code: { in: ['I10', 'E11', 'E78.0'] } }, select: { id: true, code: true } });
  const dxBy = (c: string) => dxCodes.find((x) => x.code === c)?.id;

  // 약품 마스터 — 이름 부분일치로 찾고 없으면 대체(표기 목적)
  const fallback = await prisma.medicationCode.findFirst({ select: { id: true } });
  const drugMap = new Map<DrugKey, string>();
  for (const name of DRUGS) {
    const m = await prisma.medicationCode.findFirst({ where: { nameKo: { contains: name } }, select: { id: true } });
    if (m) drugMap.set(name, m.id);
    else if (fallback) drugMap.set(name, fallback.id);
  }
  const proc = await prisma.procedureCode.findFirst({ select: { id: true } });

  const stat = { enc: 0, dx: 0, vit: 0, lab: 0, labItem: 0, rx: 0 };

  for (const [i, v] of VISITS.entries()) {
    const at = daysAgo(v.d, 9 + (i % 6));
    const encId = makeId('enc', `${P}-${i}`);

    await prisma.encounter.upsert({
      where: { id: encId },
      update: { chiefComplaint: v.cc, subjective: v.s, objective: v.o, assessment: v.a, plan: v.p },
      create: {
        id: encId, patientId: P, doctorId: D, visitType: 'OUTPATIENT', status: 'SIGNED',
        chiefComplaint: v.cc, subjective: v.s, objective: v.o, assessment: v.a, plan: v.p,
        signedAt: at, signedBy: D, createdAt: at,
      },
    }).then(() => { stat.enc++; }).catch((e: any) => console.error('enc 실패:', String(e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' / ')));

    for (const [j, code] of v.dx.entries()) {
      const id = dxBy(code);
      if (!id) continue;
      await prisma.encounterDiagnosis.upsert({
        where: { id: makeId('ed', `${P}-${i}-${j}`) }, update: {},
        create: { id: makeId('ed', `${P}-${i}-${j}`), encounterId: encId, diagnosisCodeId: id, type: j === 0 ? 'PRIMARY' : 'SECONDARY' },
      }).then(() => { stat.dx++; }).catch(() => {});
    }

    await prisma.preVisitVitals.upsert({
      where: { id: makeId('pv', `${P}-${i}`) },
      update: { systolicBp: v.bp[0], diastolicBp: v.bp[1], heartRate: v.hr, weight: v.wt },
      create: {
        id: makeId('pv', `${P}-${i}`), patientId: P, encounterId: encId, nurseId: N,
        systolicBp: v.bp[0], diastolicBp: v.bp[1], heartRate: v.hr, temperature: 36.5, spo2: 98,
        respiratoryRate: 16, weight: v.wt, height: 168, bmi: Math.round((v.wt / 1.68 / 1.68) * 10) / 10,
        painScore: 0, isAbnormal: v.bp[0] >= 180 || v.bp[0] <= 80, measuredAt: at,
      },
    }).then(() => { stat.vit++; }).catch(() => {});

    if (v.labs?.length) {
      const labRxId = makeId('labrx', `${P}-${i}`);
      const ordId = makeId('labord', `${P}-${i}`);
      const resId = makeId('lab', `${P}-${i}`);
      await prisma.prescription.upsert({
        where: { id: labRxId }, update: {},
        create: { id: labRxId, encounterId: encId, type: 'LAB', status: 'ACTIVE', createdBy: D, createdAt: at, ...(proc ? { procedureCodeId: proc.id } : {}) },
      }).catch(() => {});
      await prisma.order.upsert({
        where: { id: ordId }, update: {},
        create: { id: ordId, prescriptionId: labRxId, department: 'LAB', status: 'COMPLETED', completedAt: at, createdAt: at },
      }).catch(() => {});
      await prisma.labResult.upsert({
        where: { orderId: ordId }, update: {},
        create: { id: resId, orderId: ordId, patientId: P, technicianId: N, status: 'COMPLETED', collectedAt: at, completedAt: at, verifiedAt: new Date(at.getTime() + 3600_000 * 2), verifiedBy: N, createdAt: at },
      }).then(() => { stat.lab++; }).catch(() => {});
      for (const [j, it] of v.labs.entries()) {
        await prisma.labResultItem.upsert({
          where: { id: makeId('labitem', `${P}-${i}-${j}`) },
          update: { value: it[1], flag: it[3], normalMin: it[4], normalMax: it[5] },
          create: { id: makeId('labitem', `${P}-${i}-${j}`), labResultId: resId, testName: it[0], value: it[1], unit: it[2], flag: it[3], normalMin: it[4], normalMax: it[5] },
        }).then(() => { stat.labItem++; }).catch(() => {});
      }
    }

    for (const [j, r] of (v.rx ?? []).entries()) {
      const medId = drugMap.get(r.drug);
      if (!medId) continue;
      await prisma.prescription.upsert({
        where: { id: makeId('rx', `${P}-${i}-${j}`) },
        update: { dosage: r.dose, frequency: r.freq, duration: r.days },
        create: {
          id: makeId('rx', `${P}-${i}-${j}`), encounterId: encId, type: 'MEDICATION', medicationCodeId: medId,
          dosage: r.dose, frequency: r.freq, duration: r.days, quantity: r.days,
          status: 'ACTIVE', createdBy: D, prescriberId: D, createdAt: at,
          instructions: `${r.drug} — 만성질환 추적 처방`,
        },
      }).then(() => { stat.rx++; }).catch((e: any) => console.error('rx 실패:', String(e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' / ')));
      // 🔴 오더 동반 생성 — 런타임 정본은 처방·오더를 한 트랜잭션에서 만든다. 시드가 처방만 넣으면
      //    조제 큐·오더 서명 원장이 그 처방을 못 본다(2026-09-16 실측: 이 경로가 운영 결손 60건의 출처).
      await prisma.order.upsert({
        where: { id: makeId('rxord', `${P}-${i}-${j}`) }, update: {},
        create: { id: makeId('rxord', `${P}-${i}-${j}`), prescriptionId: makeId('rx', `${P}-${i}-${j}`), department: 'PHARMACY', status: 'COMPLETED', completedAt: at, createdAt: at },
      }).catch(() => {});
    }
  }

  console.log(`[만성질환 추적 시드] ${patient.familyName ?? ''}${patient.givenName ?? ''}(${patient.mrn}) — 외래 ${VISITS.length}회`);
  console.log(JSON.stringify(stat, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
