import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 임상 기록 통합 시계열 검증용 과거 이력 시드 — **환자 1명 지정**(기본: 인자 patientId 또는 MRN)
//
// 목적: /admin 없이도 진료 화면 '기록 시계열'과 차트 탭에서 8트랙이 실제로 시간축에 섞여 보이는지 확인.
// 생성: 외래 진료 4회(SOAP+진단) · 검사 3회(항목/이상치 플래그) · 영상 2회(판독 소견/결론) ·
//       처방 4건 · 활력 5회 · 외래 간호기록 2건 · 입원 1회(입원간호 3건·퇴원) · 수술 1회.
// 멱등: 결정적 UUID upsert(마커 ns 'tlseed'). 재실행해도 중복 생성 없음.
// 실행: cd apps/api && npx tsx prisma/seed-timeline-history.ts <patientId|MRN>
import { PrismaClient, NursingNoteType, ShiftType } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

const makeId = (ns: string, n: string | number): string => {
  const h = createHash('sha256').update(`tlseed:${ns}:${n}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const daysAgo = (d: number, hour = 10) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(hour, 0, 0, 0);
  return x;
};

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('사용법: npx tsx prisma/seed-timeline-history.ts <patientId|MRN>');
    process.exit(1);
  }
  const patient = await prisma.patient.findFirst({
    where: arg.includes('-') && arg.length > 20 ? { id: arg } : { mrn: arg },
    select: { id: true, mrn: true, familyName: true, givenName: true },
  });
  if (!patient) { console.error(`환자를 찾을 수 없음: ${arg}`); process.exit(1); }
  const P = patient.id;
  const who = `${patient.familyName ?? ''}${patient.givenName ?? ''}(${patient.mrn})`;

  const doctor = await prisma.user.findFirst({ where: { role: 'DOCTOR' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  const nurse = await prisma.user.findFirst({ where: { role: 'NURSE' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  if (!doctor || !nurse) { console.error('의사/간호사 계정 없음 — 메인 seed 먼저'); process.exit(1); }
  const D = doctor.id, N = nurse.id;

  const dx = await prisma.diagnosisCode.findMany({ where: { code: { in: ['I10', 'E11', 'J18.9', 'K29.7'] } }, select: { id: true, code: true } });
  const dxBy = (c: string) => dx.find((d) => d.code === c)?.id;
  const med = await prisma.medicationCode.findFirst({ where: { nameKo: { contains: '메트포르민' } }, select: { id: true } })
    ?? await prisma.medicationCode.findFirst({ select: { id: true } });
  const proc = await prisma.procedureCode.findFirst({ select: { id: true } });

  const stat = { enc: 0, dxc: 0, rx: 0, lab: 0, labItem: 0, img: 0, vit: 0, nurseOpd: 0, nurseIpd: 0, adm: 0, surg: 0 };

  // ── 외래 진료 4회 (오래된 → 최근) ──
  const VISITS = [
    { d: 210, cc: '건강검진 후 혈압 상승 소견', s: '두통 간헐. 특이 증상 없음.', o: 'BP 148/92. 기타 정상.', a: '본태성 고혈압(I10) 의증', p: '생활습관 교정 교육. 4주 후 재측정.', dxCode: 'I10' },
    { d: 150, cc: '혈압 추적', s: '두통 호소. 어지럼 부인.', o: 'BP 152/95. 체중 78kg.', a: '본태성 고혈압 — 약물 시작', p: '항고혈압제 시작. 8주 후 검사.', dxCode: 'I10' },
    { d: 84, cc: '공복 혈당 상승', s: '갈증, 다뇨 호소.', o: 'FBS 146. HbA1c 7.2%.', a: '2형 당뇨병(E11) 신규', p: '메트포르민 시작. 당뇨 교육 의뢰.', dxCode: 'E11' },
    { d: 21, cc: '기침·발열 3일', s: '기침 심함, 야간 발열. 흉통 부인.', o: 'BT 38.2. 청진상 우하엽 수포음.', a: '지역사회획득 폐렴(J18.9)', p: '흉부 X-ray. 경구 항생제 5일. 3일 후 f/u.', dxCode: 'J18.9' },
  ];

  for (const [i, v] of VISITS.entries()) {
    const encId = makeId('enc', `${P}-${i}`);
    const at = daysAgo(v.d, 10 + i);
    await prisma.encounter.upsert({
      where: { id: encId }, update: {},
      create: {
        id: encId, patientId: P, doctorId: D, visitType: 'OUTPATIENT', status: 'SIGNED',
        chiefComplaint: v.cc, subjective: v.s, objective: v.o, assessment: v.a, plan: v.p,
        signedAt: at, signedBy: D, createdAt: at, updatedAt: at,
      },
    }).then(() => { stat.enc++; }).catch((e) => console.error('enc', e.message));

    const dxId = dxBy(v.dxCode);
    if (dxId) {
      await prisma.encounterDiagnosis.upsert({
        where: { id: makeId('ed', `${P}-${i}`) }, update: {},
        create: { id: makeId('ed', `${P}-${i}`), encounterId: encId, diagnosisCodeId: dxId, type: 'PRIMARY' },
      }).then(() => { stat.dxc++; }).catch(() => {});
    }

    // 처방(약)
    if (med && i >= 1) {
      const rxId = makeId('rx', `${P}-${i}`);
      await prisma.prescription.upsert({
        where: { id: rxId }, update: {},
        create: {
          id: rxId, encounterId: encId, type: 'MEDICATION', medicationCodeId: med.id,
          dosage: i === 3 ? '500mg' : '1000mg', frequency: i === 3 ? 'tid' : 'bid', duration: i === 3 ? 5 : 30,
          quantity: i === 3 ? 15 : 60, status: 'ACTIVE', // PrescriptionStatus = ACTIVE|CANCELLED 뿐(실측)
          createdBy: D, prescriberId: D, createdAt: at,   // Prescription 에 updatedAt 없음(실측)
        },
      }).then(() => { stat.rx++; }).catch((e: any) => console.error('rx 실패:', String(e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' / ')));
      // 🔴 오더 동반 생성 — 아래 검사·영상 처방은 오더를 만드는데 약 처방만 빠져 있었다.
      //    오더 없는 처방은 조제 큐(orders 기준)에 영영 안 뜬다(2026-09-16 운영 실측 3건의 출처).
      await prisma.order.upsert({
        where: { id: makeId('rxord', `${P}-${i}`) }, update: {},
        create: { id: makeId('rxord', `${P}-${i}`), prescriptionId: rxId, department: 'PHARMACY', status: 'COMPLETED', completedAt: at, createdAt: at },
      }).catch(() => {});
    }

    // 활력
    const vit = [
      { sbp: 148, dbp: 92, hr: 78, t: 36.6, spo2: 98 },
      { sbp: 152, dbp: 95, hr: 82, t: 36.5, spo2: 98 },
      { sbp: 138, dbp: 86, hr: 76, t: 36.7, spo2: 97 },
      { sbp: 132, dbp: 84, hr: 96, t: 38.2, spo2: 96 },
    ][i];
    await prisma.preVisitVitals.upsert({
      where: { id: makeId('pv', `${P}-${i}`) }, update: {},
      create: {
        id: makeId('pv', `${P}-${i}`), patientId: P, encounterId: encId, nurseId: N,
        systolicBp: vit.sbp, diastolicBp: vit.dbp, heartRate: vit.hr, temperature: vit.t, spo2: vit.spo2,
        respiratoryRate: i === 3 ? 22 : 16, weight: 78, height: 172, bmi: 26.4, painScore: 0,
        isAbnormal: vit.sbp >= 180 || vit.t >= 38.5, measuredAt: at,
      },
    }).then(() => { stat.vit++; }).catch((e) => console.error('pv', e.message));
  }

  // ── 검사 3회(처방→오더→결과→항목) ──
  // [검사명, 값, 단위, flag, 참고하한, 참고상한] — 참고범위는 상세 펼침에서 이상 판단 근거로 표시된다
  type LabItem = [string, string, string, string, number | null, number | null];
  const LABS: { d: number; items: LabItem[] }[] = [
    { d: 150, items: [['Creatinine', '1.1', 'mg/dL', 'N', 0.7, 1.3], ['Na', '141', 'mmol/L', 'N', 135, 145], ['K', '4.2', 'mmol/L', 'N', 3.5, 5.1]] },
    { d: 84, items: [['Glucose', '146', 'mg/dL', 'H', 70, 100], ['HbA1c', '7.2', '%', 'H', 4, 6.5], ['Creatinine', '1.2', 'mg/dL', 'N', 0.7, 1.3]] },
    { d: 21, items: [['WBC', '13200', '/μL', 'H', 4000, 10000], ['CRP', '8.4', 'mg/dL', 'H', null, 0.5], ['Hb', '13.8', 'g/dL', 'N', 13, 17]] },
  ];
  for (const [i, L] of LABS.entries()) {
    const at = daysAgo(L.d, 11);
    const encId = makeId('enc', `${P}-${VISITS.findIndex((v) => v.d === L.d)}`);
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
      create: { id: resId, orderId: ordId, patientId: P, technicianId: N, status: 'COMPLETED', collectedAt: at, completedAt: at, verifiedAt: new Date(at.getTime() + 2 * 3600_000), verifiedBy: N, createdAt: at },
    }).then(() => { stat.lab++; }).catch((e: any) => console.error('lab 실패:', String(e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' / ')));
    for (const [j, it] of L.items.entries()) {
      const itemData = { labResultId: resId, testName: it[0], value: it[1], unit: it[2], flag: it[3], normalMin: it[4], normalMax: it[5] };
      await prisma.labResultItem.upsert({
        where: { id: makeId('labitem', `${P}-${i}-${j}`) },
        update: { flag: it[3], normalMin: it[4], normalMax: it[5] }, // 재실행 시 참고범위 보강 반영
        create: { id: makeId('labitem', `${P}-${i}-${j}`), ...itemData },
      }).then(() => { stat.labItem++; }).catch((e: any) => console.error('labitem 실패:', String(e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' / ')));
    }
  }

  // ── 영상 2회 ──
  const IMGS = [
    { d: 84, modality: 'US', body: '복부', finding: '간 경도 지방침착. 담석 없음.', imp: '경도 지방간' },
    { d: 21, modality: 'XR', body: '흉부', finding: '우하엽 폐야에 반점상 침윤. 심비대 없음.', imp: '우하엽 폐렴 소견' },
  ];
  for (const [i, im] of IMGS.entries()) {
    const at = daysAgo(im.d, 12);
    const encId = makeId('enc', `${P}-${VISITS.findIndex((v) => v.d === im.d)}`);
    const imgRxId = makeId('imgrx', `${P}-${i}`);
    const ordId = makeId('imgord', `${P}-${i}`);
    await prisma.prescription.upsert({
      where: { id: imgRxId }, update: {},
      create: { id: imgRxId, encounterId: encId, type: 'IMAGING', status: 'ACTIVE', createdBy: D, createdAt: at },
    }).catch(() => {});
    await prisma.order.upsert({
      where: { id: ordId }, update: {},
      create: { id: ordId, prescriptionId: imgRxId, department: 'IMAGING', status: 'COMPLETED', completedAt: at, createdAt: at },
    }).catch(() => {});
    await prisma.imagingResult.upsert({
      where: { orderId: ordId }, update: {},
      create: {
        id: makeId('img', `${P}-${i}`), orderId: ordId, patientId: P, radiologistId: D,
        modality: im.modality, bodyPart: im.body, finding: im.finding, impression: im.imp,
        status: 'REPORTED', acquiredAt: at, reportedAt: new Date(at.getTime() + 3 * 3600_000), createdAt: at,
      },
    }).then(() => { stat.img++; }).catch((e: any) => console.error('img 실패:', String(e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' / ')));
  }

  // ── 외래 간호기록 2건(UniversalNursingNote — 환자 직결) ──
  const OPD_NOTES = [
    { d: 150, type: 'EDUCATION', content: '고혈압 생활습관 교육 시행. 저염식·주 150분 운동 안내. 자가 혈압 측정법 시범 후 확인.' },
    { d: 84, type: 'EDUCATION', content: '당뇨 초기 교육. 자가혈당측정 기기 사용법·저혈당 대처 교육. 영양팀 상담 예약 안내.' },
  ];
  for (const [i, n] of OPD_NOTES.entries()) {
    const at = daysAgo(n.d, 13);
    await prisma.universalNursingNote.upsert({
      where: { id: makeId('unn', `${P}-${i}`) }, update: {},
      create: { id: makeId('unn', `${P}-${i}`), patientId: P, nurseId: N, contextType: 'OUTPATIENT', contextId: makeId('enc', `${P}-${VISITS.findIndex((v) => v.d === n.d)}`), noteType: n.type, content: n.content, recordedAt: at, createdAt: at },
    }).then(() => { stat.nurseOpd++; }).catch((e: any) => console.error('unn 실패:', String(e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' / ')));
  }

  // ── 입원 1회(입원 간호기록 3건 + 퇴원) + 수술 1회 ──
  const admId = makeId('adm', P);
  const admitAt = daysAgo(60, 14);
  const dischargeAt = daysAgo(55, 11);
  // Bed 에는 createdAt 이 없다(스키마 실측) — 병상번호로 결정적 선택
  const bed = await prisma.bed.findFirst({ select: { id: true }, orderBy: { bedNumber: 'asc' } });
  if (bed) {
    await prisma.admission.upsert({
      where: { id: admId }, update: {},
      create: {
        id: admId, patientId: P, bedId: bed.id, admittingDoctorId: D, attendingDoctorId: D, status: 'DISCHARGED',
        admitDate: admitAt, dischargeDate: dischargeAt,
        admitReason: '담석성 담낭염 — 복강경 담낭절제술 예정', createdAt: admitAt, updatedAt: dischargeAt,
      },
    }).then(() => { stat.adm++; }).catch((e: any) => console.error('adm 실패:', String(e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' / ')));

    const IPD_NOTES = [
      { h: 16, type: 'DAR', shift: 'DAY', focus: '수술 전 준비', data: '금식 유지 중. 활력 안정.', action: '수술 전 체크리스트 확인·동의서 확인.', response: '환자 불안 호소 없음.' },
      { h: 22, type: 'DAR', shift: 'EVENING', focus: '수술 후 통증', data: 'NRS 5 통증 호소.', action: '처방 진통제 투여·체위 변경.', response: '30분 후 NRS 2로 감소.' },
      { h: 9, type: 'DAR', shift: 'DAY', focus: '조기 보행', data: '보행 시 어지럼 호소 없음.', action: '병동 1회 보행 보조.', response: '보행 양호. 자가 배뇨 확인.' },
    ];
    // 🔴 종전 결함: `i < 2 ? 0 : 2` 라 **'수술 후 통증' 기록(i=1)이 입원 당일 22시**에 찍혔다.
    //    수술은 입원 다음날 09시다 — 수술이 시작되기 **11시간 전**에 "수술 후 통증 NRS 5"가
    //    법정 간호기록에 남았다. 기록일은 그 기록이 말하는 사건의 순서를 따라야 한다:
    //    D+0 수술 전 준비 → D+1 수술 후 통증 → D+2 조기 보행.
    for (const [i, n] of IPD_NOTES.entries()) {
      const at = new Date(admitAt);
      at.setDate(at.getDate() + i);
      at.setHours(n.h, 0, 0, 0);
      await prisma.nursingNote.upsert({
        where: { id: makeId('nn', `${P}-${i}`) }, update: {},
        create: {
          // 🔴 리터럴 배열이라 타입이 `string` 으로 넓어진다 — Prisma enum 으로 좁힌다
          //    (값 자체는 `DAR`·`DAY` 등 enum 멤버다. 넓은 채로 두면 오타를 컴파일러가 못 잡는다)
          id: makeId('nn', `${P}-${i}`), admissionId: admId, nurseId: N,
          noteType: n.type as NursingNoteType, shiftType: n.shift as ShiftType,
          focus: n.focus, data: n.data, action: n.action, response: n.response,
          status: 'SIGNED', priority: 'NORMAL', recordedAt: at, createdAt: at,
        },
      }).then(() => { stat.nurseIpd++; }).catch((e) => console.error('nn', e.message));
    }

    const surgAt = new Date(admitAt);
    surgAt.setDate(surgAt.getDate() + 1);
    surgAt.setHours(9, 0, 0, 0);
    await prisma.surgery.upsert({
      where: { id: makeId('surg', P) }, update: {},
      create: {
        id: makeId('surg', P), patientId: P, surgeonId: D, admissionId: admId,
        procedureName: '복강경 담낭절제술', bodySite: '복부(우상복부)',
        preOpDiagnosis: '담석성 담낭염', postOpDiagnosis: '담석성 담낭염(확인)',
        findings: '담낭 벽 비후·다발성 담석. 주변 유착 경미.',
        status: 'COMPLETED', scheduledAt: surgAt, startedAt: surgAt, endedAt: new Date(surgAt.getTime() + 90 * 60_000),
        createdAt: admitAt, updatedAt: surgAt,
      },
    }).then(() => { stat.surg++; }).catch((e) => console.error('surg', e.message));
  } else {
    console.warn('병상 없음 — 입원/수술 생략');
  }

  // ── 활력 1회 추가(입원 중) ──
  await prisma.preVisitVitals.upsert({
    where: { id: makeId('pv', `${P}-ipd`) }, update: {},
    create: {
      id: makeId('pv', `${P}-ipd`), patientId: P, nurseId: N,
      systolicBp: 126, diastolicBp: 78, heartRate: 88, temperature: 37.4, spo2: 97, respiratoryRate: 18,
      painScore: 5, isAbnormal: false, measuredAt: new Date(admitAt.getTime() + 30 * 3600_000),
    },
  }).then(() => { stat.vit++; }).catch(() => {});

  console.log(`[시계열 시드] ${who}`);
  console.log(JSON.stringify(stat, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
