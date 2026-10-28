import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 진료차트 검증용 데이터 확장 시드 — 외래 진료 시계열(환자당 5회·14개월), 검사 추이(다회 LabResult),
// 만성질환 다소스(CLINIC 미러), 입원 풀사이클(간호노트 3교대·경과·I/O·투약·퇴원요약까지).
// 멱등: 결정적 UUID upsert + ChronicObservation는 sourceId 'CHARTSEED:' 마커 삭제 후 재생성.
// 선행: 메인 seed.ts(환자/코드/병상/직원) 적용. 실행: cd apps/api && npx ts-node --transpile-only prisma/seed-chart-richness.ts
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
// 🔴 이상 판정은 정본 하나(`vitals-evaluate`). 시드가 자기 임계치를 적으면 같은 화면에서 규칙이 갈린다 —
//    종전 `sbp>=140 || spo2<95` 는 정본의 **warn 층**(주의)이라, 앱 규칙상 정상인 BP 150/95 가
//    타임라인에서 ABNORMAL 로 붉게 떴다(`record-timeline` 이 isAbnormal 을 그대로 렌더한다).
import { evaluateVitals } from '../src/modules/vitals/vitals-evaluate';

const prisma = new PrismaClient();

/** 결정적 PRNG */
function rng(seedStr: string) {
  let a = parseInt(createHash('sha256').update(seedStr).digest('hex').slice(0, 8), 16) >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashPct = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 6), 16) % 100;
/** ns:n → 결정적 UUID v4 형태 */
function makeId(ns: string, n: number | string): string {
  const h = createHash('sha256').update(`${ns}:${n}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const round1 = (x: number) => Math.round(x * 10) / 10;
const flagOf = (v: number, min: number | null, max: number | null) => (max != null && v > max ? 'H' : min != null && v < min ? 'L' : 'N');
const daysAgo = (d: number) => { const x = new Date(); x.setDate(x.getDate() - d); return x; };
const atHour = (base: Date, h: number) => { const x = new Date(base); x.setHours(h, 0, 0, 0); return x; };

async function main() {
  const patients = await prisma.patient.findMany({ select: { id: true, familyName: true, givenName: true }, orderBy: { createdAt: 'asc' } });
  if (!patients.length) { console.error('환자 없음 — 메인 seed 먼저 실행'); return; }
  const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  const nurses = await prisma.user.findMany({ where: { role: 'NURSE' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  if (!doctors.length || !nurses.length) { console.error('의사/간호사 계정 없음'); return; }
  const beds = await prisma.bed.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 30 });
  const doc = (i: number) => doctors[i % doctors.length].id;
  const nrs = (i: number) => nurses[i % nurses.length].id;

  // 진단·약품 코드 (존재하는 것만 사용)
  const dxCodes = ['E11', 'I10', 'E78', 'J20', 'K29', 'M54', 'J00', 'N39', 'J45', 'K21'];
  const dxMap = new Map<string, string>();
  /**
   * 🔴 **정확 일치만 찾다가 진단 없는 서명 진료를 만들었다** (2026-08-30 운영 실측).
   *    KCD-8 은 세분류(`K29.5`)로 실려 있어 `K29`·`N39` 는 **정확 일치가 없다**.
   *    그 결과 `if (did)` 가 거짓이 되어 진단을 안 붙이고 **`status:'SIGNED'` 만 남겼다** —
   *    운영 스캔의 "서명된 진료인데 진단 없음" 83건 중 8월분 5건이 이 시드였다.
   *    서명은 청구 트리거라 상병이 없으면 심사 삭감·반려 위험이다.
   *    → 정확 일치 → **상위코드 접두 매칭** 순으로 찾고, 그래도 없으면 **조용히 넘기지 않는다**.
   */
  const dxMissing: string[] = [];
  for (const c of dxCodes) {
    const d = await prisma.diagnosisCode.findFirst({ where: { code: c }, select: { id: true } })
      ?? await prisma.diagnosisCode.findFirst({
        where: { code: { startsWith: `${c}.` }, isActive: true },
        select: { id: true }, orderBy: { code: 'asc' },
      });
    if (d) dxMap.set(c, d.id); else dxMissing.push(c);
  }
  if (dxMissing.length) {
    // 코드 마스터가 안 실린 환경이면 **진단 없는 서명 진료를 만들지 않는다**(사실을 말하고 멈춘다)
    throw new Error(
      `[seed-chart-richness] 진단코드를 찾지 못했습니다: ${dxMissing.join(', ')}. `
      + 'KCD-8 마스터를 먼저 적재하세요 — 진단 없이 서명된 진료를 만들면 청구 심사 삭감·반려 위험이 있습니다.',
    );
  }
  const meds = await prisma.medicationCode.findMany({ select: { id: true }, take: 20, orderBy: { code: 'asc' } });
  const medId = (i: number) => (meds.length ? meds[i % meds.length].id : null);

  // 코호트 분류(만성질환 시드와 동일 규칙)
  const isDM = (id: string) => hashPct(`dm:${id}`) < 30;
  const isHTN = (id: string) => !isDM(id) && hashPct(`htn:${id}`) < 25;

  let encCnt = 0, labCnt = 0, labItemCnt = 0, vitalCnt = 0, dxCnt = 0, rxCnt = 0;
  const clinicObs: { id: string; patientId: string; code: string; value: number; unit: string; measuredAt: Date; source: string; sourceId: string; context: string; normalMin: number | null; normalMax: number | null; flag: string; encounterId: string }[] = [];

  // ════════ PART A. 외래 진료 시계열 (환자당 5회, ~14개월 분산) ════════
  const VISIT_MONTHS = [15, 11, 8, 4, 1]; // 개월 전
  for (let pi = 0; pi < patients.length; pi++) {
    const p = patients[pi];
    const r = rng(`cr:${p.id}`);
    const dm = isDM(p.id), htn = isHTN(p.id);
    // 추세 기준값
    let hba1c = dm ? [6.8, 7.8, 9.2][Math.floor(r() * 3)] : 5.6;
    let ldl = 120 + Math.floor(r() * 80);
    let cr = round1(0.8 + r() * 0.6);
    let sbp = htn ? 150 : dm ? 134 : 120;
    let weight = round1(58 + r() * 30);
    const heightCm = Math.round(155 + r() * 30);
    const heightM = heightCm / 100;

    for (let v = 0; v < VISIT_MONTHS.length; v++) {
      const visitDate = atHour(daysAgo(VISIT_MONTHS[v] * 30 + Math.floor(r() * 10)), 9 + Math.floor(r() * 6));
      const encId = makeId('cr-enc', `${pi}-${v}`);
      // 추세 진행(방문마다 약간 호전 또는 변동)
      hba1c = Math.max(5.2, round1(hba1c - (dm ? 0.18 : 0) + (r() - 0.5) * 0.3));
      ldl = Math.max(60, Math.round(ldl - (r() < 0.5 ? 6 : 0) + (r() - 0.5) * 14));
      cr = round1(Math.max(0.6, cr + (r() - 0.5) * 0.12));
      sbp = Math.round(sbp - (htn ? 2.5 : 0) + (r() - 0.5) * 12);
      const dbp = Math.round(sbp * 0.63 + (r() - 0.5) * 8);
      const hr = 64 + Math.floor(r() * 24);
      const temp = round1(36.3 + r() * 0.8);
      const spo2 = 96 + Math.floor(r() * 4);
      weight = round1(weight + (r() - 0.5) * 1.2);
      const bmi = round1(weight / (heightM * heightM));
      const fbs = Math.round(95 + (hba1c - 6) * 22 + (r() - 0.5) * 14);

      const cond = dm ? '제2형 당뇨병' : htn ? '본태성 고혈압' : '';
      const s = dm ? `${cond} 추적. 다음·다뇨 ${r() < 0.5 ? '경미' : '없음'}, 저혈당 증상 없음. 복약 순응 양호.`
        : htn ? `${cond} 추적. 두통·어지럼 ${r() < 0.4 ? '간헐적' : '없음'}, 가정혈압 기록 지참.`
        : ['감기 증상(기침·인후통) 3일째.', '소화불량·상복부 불편감.', '요통, 좌측 하지 방사통.', '건강검진 후 추적 상담.', '알레르기성 비염 증상.'][(pi + v) % 5];
      const o = `BP ${sbp}/${dbp}, HR ${hr}, BT ${temp}℃, SpO2 ${spo2}%, 체중 ${weight}kg(BMI ${bmi})` + (dm ? `, FBS ${fbs}, HbA1c ${hba1c}%` : htn ? `, 가정혈압 평균 ${sbp - 4}/${dbp - 2}` : '');
      const a = dm ? `${cond}, 혈당 조절 ${hba1c < 7 ? '양호' : hba1c < 8 ? '경계' : '불량'}(HbA1c ${hba1c}%)` : htn ? `${cond}, 혈압 ${sbp < 140 ? '조절됨' : '조절 미흡'}` : ['급성 상기도감염', '기능성 소화불량', '요추 염좌', '특이소견 없음', '알레르기성 비염'][(pi + v) % 5];
      const plan = dm ? `약물 유지${v === VISIT_MONTHS.length - 1 ? ', 3개월 후 HbA1c 재검' : ', 메트포르민 지속'}. 식이·운동 교육.` : htn ? '항고혈압제 유지, 저염식 교육, 1개월 후 재방문.' : '대증치료, 경과관찰, 악화 시 재방문.';

      await prisma.encounter.upsert({
        where: { id: encId }, update: {},
        create: { id: encId, patientId: p.id, doctorId: doc(pi + v), visitType: 'OUTPATIENT', chiefComplaint: s.slice(0, 60), subjective: s, objective: o, assessment: a, plan, status: 'SIGNED', signedAt: visitDate, signedBy: doc(pi + v), createdAt: visitDate },
      });
      encCnt++;

      // 진단
      const primary = dm ? 'E11' : htn ? 'I10' : dxCodes[2 + ((pi + v) % 6)];
      const dxList = [primary, ...(dm && dxMap.has('E78') ? ['E78'] : [])];
      for (let di = 0; di < dxList.length; di++) {
        // 🔴 `continue` 로 넘기면 **진단 없는 SIGNED 진료**가 남는다(운영 실측). 위에서 전량 확보를 보장한다.
        const did = dxMap.get(dxList[di]);
        if (!did) throw new Error(`[seed-chart-richness] 외래 진료 상병 누락: ${dxList[di]}`);
        const edId = makeId('cr-ed', `${pi}-${v}-${di}`);
        // 🔴 실패를 삼키지 않는다 — 삼키면 "만들었다"고 세면서 실제로는 없다
        await prisma.encounterDiagnosis.upsert({ where: { id: edId }, update: {}, create: { id: edId, encounterId: encId, diagnosisCodeId: did, type: di === 0 ? 'PRIMARY' : 'SECONDARY' } });
        dxCnt++;
      }

      // 활력징후(PreVisitVitals)
      const pvId = makeId('cr-pv', `${pi}-${v}`);
      const rrate = 16 + Math.floor(r() * 4);
      await prisma.preVisitVitals.upsert({
        where: { id: pvId }, update: {},
        create: { id: pvId, encounterId: encId, patientId: p.id, nurseId: nrs(pi + v), systolicBp: sbp, diastolicBp: dbp, heartRate: hr, temperature: temp, spo2, weight, height: heightCm, bmi, painScore: htn || dm ? 0 : (pi + v) % 4, respiratoryRate: rrate, isAbnormal: evaluateVitals({ systolicBp: sbp, diastolicBp: dbp, heartRate: hr, temperature: temp, spo2, respiratoryRate: rrate, weight, height: heightCm }).isAbnormal, measuredAt: visitDate },
      }).then(() => { vitalCnt++; }).catch(() => {});

      // 만성 약물 처방(코호트)
      if (dm || htn) {
        const rxId = makeId('cr-rx', `${pi}-${v}`);
        await prisma.prescription.upsert({ where: { id: rxId }, update: {}, create: { id: rxId, encounterId: encId, type: 'MEDICATION', medicationCodeId: medId(pi + v), quantity: 30, status: 'ACTIVE', createdBy: doc(pi + v), createdAt: visitDate } }).then(() => { rxCnt++; }).catch(() => {});
        // 🔴 오더를 함께 만든다 — 런타임 정본(PrescriptionService)은 처방·오더를 한 트랜잭션에서 만든다.
        //    시드가 처방만 넣으면 그 처방은 조제 큐(orders 기준)·오더 서명 원장에 **영원히 안 보인다**
        //    (2026-09-16 운영 실측: 오더 없는 처방 250건 전부 시드 산출물 · 정합성 스캔 07 이 244 로 보고 중).
        await prisma.order.upsert({ where: { id: makeId('cr-rxord', `${pi}-${v}`) }, update: {}, create: { id: makeId('cr-rxord', `${pi}-${v}`), prescriptionId: rxId, department: 'PHARMACY', status: 'COMPLETED', completedAt: visitDate, createdAt: visitDate } }).catch(() => {});
      }

      // 검사 시계열 — 코호트는 매회, 일반은 첫·마지막 방문만
      const doLab = dm || htn || v === 0 || v === VISIT_MONTHS.length - 1;
      if (doLab) {
        const labRxId = makeId('cr-labrx', `${pi}-${v}`);
        const orderId = makeId('cr-ord', `${pi}-${v}`);
        const labResultId = makeId('cr-lab', `${pi}-${v}`);
        await prisma.prescription.upsert({ where: { id: labRxId }, update: {}, create: { id: labRxId, encounterId: encId, type: 'LAB', status: 'ACTIVE', createdBy: doc(pi + v), createdAt: visitDate } }).catch(() => {});
        await prisma.order.upsert({ where: { id: orderId }, update: {}, create: { id: orderId, prescriptionId: labRxId, department: 'LAB', status: 'COMPLETED', completedAt: visitDate } }).catch(() => {});
        await prisma.labResult.upsert({ where: { orderId }, update: {}, create: { id: labResultId, orderId, patientId: p.id, technicianId: nrs(pi), status: 'COMPLETED', collectedAt: visitDate, completedAt: visitDate } }).catch(() => {});
        labCnt++;
        const items: { testName: string; value: string; unit: string; min: number | null; max: number | null }[] = [
          { testName: 'WBC', value: String(4500 + Math.floor(r() * 5000)), unit: '/μL', min: 4000, max: 10000 },
          { testName: 'Hb', value: String(round1(12 + r() * 4)), unit: 'g/dL', min: 13, max: 17 },
          { testName: 'Creatinine', value: String(cr), unit: 'mg/dL', min: 0.7, max: 1.3 },
          { testName: 'AST', value: String(20 + Math.floor(r() * 25)), unit: 'IU/L', min: 0, max: 40 },
          { testName: 'ALT', value: String(18 + Math.floor(r() * 30)), unit: 'IU/L', min: 0, max: 41 },
          { testName: 'LDL', value: String(ldl), unit: 'mg/dL', min: 0, max: 130 },
          { testName: 'Total Cholesterol', value: String(ldl + 60 + Math.floor(r() * 30)), unit: 'mg/dL', min: 0, max: 200 },
        ];
        if (dm) { items.push({ testName: 'HbA1c', value: String(hba1c), unit: '%', min: 4, max: 6.5 }, { testName: '공복혈당 (FBS)', value: String(fbs), unit: 'mg/dL', min: 70, max: 100 }); }
        for (let ii = 0; ii < items.length; ii++) {
          const t = items[ii];
          const itemId = makeId('cr-labi', `${pi}-${v}-${ii}`);
          const fl = t.min != null && t.max != null ? (Number(t.value) < t.min ? 'L' : Number(t.value) > t.max ? 'H' : 'N') : null;
          await prisma.labResultItem.upsert({ where: { id: itemId }, update: {}, create: { id: itemId, labResultId, testName: t.testName, value: t.value, unit: t.unit, normalMin: t.min, normalMax: t.max, flag: fl } }).then(() => { labItemCnt++; }).catch(() => {});
        }
        // 만성 다소스 미러(CLINIC) — 통합 시계열에 진료실 측정 포인트 추가
        const mirror = (code: string, value: number, unit: string, min: number | null, max: number | null) => {
          clinicObs.push({ id: makeId('cr-cobs', `${pi}-${v}-${code}`), patientId: p.id, code, value, unit, measuredAt: visitDate, source: 'CLINIC', sourceId: `CHARTSEED:enc:${encId}:${code}`, context: 'CHRONIC', normalMin: min, normalMax: max, flag: flagOf(value, min, max), encounterId: encId });
        };
        if (dm) { mirror('HBA1C', hba1c, '%', 4.0, 6.5); mirror('FBS', fbs, 'mg/dL', 70, 100); }
        mirror('SBP', sbp, 'mmHg', null, 120); mirror('DBP', dbp, 'mmHg', null, 80);
        mirror('WEIGHT', weight, 'kg', null, null);
      }
    }
  }
  // CLINIC 미러 멱등 재생성
  await prisma.chronicObservation.deleteMany({ where: { source: 'CLINIC', sourceId: { startsWith: 'CHARTSEED:' } } });
  if (clinicObs.length) await prisma.chronicObservation.createMany({ data: clinicObs, skipDuplicates: true });
  console.log(`[A] 외래 진료 ${encCnt}건 · 진단 ${dxCnt} · 활력 ${vitalCnt} · 처방 ${rxCnt} · 검사 ${labCnt}건(${labItemCnt}항목) · 만성 CLINIC 미러 ${clinicObs.length}건`);

  // ════════ PART B. 입원 풀사이클(퇴원까지) ════════
  // 대표 환자(만성·대표 혼합)에 신규 입원 — 간호노트 3교대·경과·I/O·투약·퇴원요약.
  const inpatientPlan: { patientIdx: number; los: number; gapAfter: number; reason: string; primaryDx: string }[] = [
    { patientIdx: 0, los: 6, gapAfter: 20, reason: '당뇨병성 케톤산증 의증 — 혈당 조절 및 수액 치료', primaryDx: 'E11' },
    { patientIdx: 3, los: 8, gapAfter: 35, reason: '지역사회획득 폐렴 — 정맥 항생제 치료', primaryDx: 'J20' },
    { patientIdx: 6, los: 5, gapAfter: 12, reason: '고혈압성 응급 — 혈압 조절 및 평가', primaryDx: 'I10' },
    { patientIdx: 10, los: 7, gapAfter: 50, reason: '급성 위장관염 — 탈수 교정', primaryDx: 'K29' },
    { patientIdx: 14, los: 9, gapAfter: 28, reason: '요로감염 패혈증 — 항생제·수액', primaryDx: 'N39' },
    { patientIdx: 18, los: 5, gapAfter: 16, reason: '천식 급성 악화 — 스테로이드·기관지확장제', primaryDx: 'J45' },
  ];
  let admCnt = 0, nnCnt = 0, pnCnt = 0, ioCnt = 0, maCnt = 0, dsCnt = 0;
  const shifts: { name: 'DAY' | 'EVENING' | 'NIGHT'; hour: number }[] = [{ name: 'DAY', hour: 9 }, { name: 'EVENING', hour: 15 }, { name: 'NIGHT', hour: 22 }];

  for (let ai = 0; ai < inpatientPlan.length; ai++) {
    const plan = inpatientPlan[ai];
    if (plan.patientIdx >= patients.length || !beds.length) continue;
    const p = patients[plan.patientIdx];
    const r = rng(`cradm:${p.id}:${ai}`);
    const admitDate = atHour(daysAgo(plan.gapAfter + plan.los), 14);
    const dischargeDate = atHour(daysAgo(plan.gapAfter), 11);
    const admId = makeId('cr-adm', ai);
    const bedId = beds[ai % beds.length].id;
    const dDoc = doc(ai + 1);

    await prisma.admission.upsert({
      where: { id: admId }, update: {},
      create: { id: admId, patientId: p.id, bedId, admittingDoctorId: dDoc, attendingDoctorId: dDoc, admitDate, dischargeDate, status: 'DISCHARGED', admitReason: plan.reason },
    });
    admCnt++;

    // 입원 진료(Encounter, INPATIENT)
    const iEncId = makeId('cr-ienc', ai);
    await prisma.encounter.upsert({
      where: { id: iEncId }, update: {},
      create: { id: iEncId, patientId: p.id, doctorId: dDoc, admissionId: admId, visitType: 'INPATIENT', chiefComplaint: plan.reason.split(' — ')[0], subjective: `입원: ${plan.reason}`, objective: '입원 시 활력징후 측정·기본검사 시행.', assessment: plan.reason.split(' — ')[0], plan: '입원 치료 계획 수립, 경과 관찰.', status: 'SIGNED', signedAt: admitDate, signedBy: dDoc, createdAt: admitDate },
    });
    encCnt++;
    {
      // 🔴 위에서 전량 확보를 보장하므로 여기서 조용히 건너뛰지 않는다 — 없으면 그 사실을 알린다
      const did = dxMap.get(plan.primaryDx);
      if (!did) throw new Error(`[seed-chart-richness] 입원 진료 상병 누락: ${plan.primaryDx}`);
      const edId = makeId('cr-ied', ai);
      await prisma.encounterDiagnosis.upsert({ where: { id: edId }, update: {}, create: { id: edId, encounterId: iEncId, diagnosisCodeId: did, type: 'PRIMARY' } });
    }

    // 입원 시 간호사정
    const naId = makeId('cr-na', ai);
    await prisma.nursingAssessment.upsert({
      where: { id: naId }, update: {},
      create: { id: naId, admissionId: admId, nurseId: nrs(ai), consciousness: 'ALERT', mobility: ai % 2 ? 'BED_REST' : 'AMBULATORY', painScore: 2 + (ai % 4), nutritionStatus: ai % 3 ? 'ADEQUATE' : 'POOR', skinIntegrity: ai % 4 === 0 ? 'AT_RISK' : 'INTACT', bradenScore: 14 + (ai % 7), allergyConfirmed: true, assessedAt: admitDate },
    }).catch(() => {});

    // 입원 투약 처방(2종)
    const medRx: string[] = [];
    for (let m = 0; m < 2; m++) {
      const rxId = makeId('cr-imrx', `${ai}-${m}`);
      await prisma.prescription.upsert({ where: { id: rxId }, update: {}, create: { id: rxId, encounterId: iEncId, type: 'MEDICATION', medicationCodeId: medId(ai + m), quantity: 1, status: 'ACTIVE', createdBy: dDoc, createdAt: admitDate } }).then(() => medRx.push(rxId)).catch(() => {});
      await prisma.order.upsert({ where: { id: makeId('cr-imrxord', `${ai}-${m}`) }, update: {}, create: { id: makeId('cr-imrxord', `${ai}-${m}`), prescriptionId: rxId, department: 'PHARMACY', status: 'COMPLETED', completedAt: admitDate, createdAt: admitDate } }).catch(() => {});
    }

    // 일자별 기록(재원일수)
    const focusByDx: Record<string, string[]> = {
      E11: ['혈당 변동', '수액 요법', '식이 교육'], J20: ['발열 관리', '산소 요법', '호흡 양상'], I10: ['혈압 관리', '두통 호소', '약물 반응'],
      K29: ['구토·설사', '수분 보충', '복통 관리'], N39: ['발열·배뇨통', '항생제 투여', '수액 관리'], J45: ['호흡곤란', '천명음', '흡입 치료'],
    };
    const fl = focusByDx[plan.primaryDx] ?? ['전신 상태', '활력징후', '투약 관리'];
    for (let d = 0; d < plan.los; d++) {
      const dayBase = new Date(admitDate); dayBase.setDate(dayBase.getDate() + d);
      const trend = d / Math.max(plan.los - 1, 1); // 0(입원)→1(퇴원) 호전
      const sbp = Math.round((plan.primaryDx === 'I10' ? 158 : 132) - trend * 18 + (r() - 0.5) * 10);
      const hr = Math.round((88 - trend * 12) + (r() - 0.5) * 8);
      const temp = round1((plan.primaryDx === 'J20' || plan.primaryDx === 'N39' ? 38.4 : 37.0) - trend * 1.2 + (r() - 0.5) * 0.3);
      const spo2 = Math.min(99, Math.round(93 + trend * 4 + (r() - 0.5) * 2));
      const rr = Math.round(20 - trend * 3 + (r() - 0.5) * 2);

      // 3교대 간호노트
      for (let si = 0; si < shifts.length; si++) {
        const sh = shifts[si];
        // 야간은 격일로만(과다 방지)
        if (sh.name === 'NIGHT' && d % 2 === 1) continue;
        const recordedAt = atHour(dayBase, sh.hour);
        const focus = fl[(d + si) % fl.length];
        const nnId = makeId('cr-nn', `${ai}-${d}-${si}`);
        const better = trend > 0.6;
        await prisma.nursingNote.upsert({
          where: { id: nnId }, update: {},
          create: {
            id: nnId, admissionId: admId, nurseId: nrs(ai + si), noteType: 'FOCUS', shiftType: sh.name,
            focus, data: `${focus} 관련 — BP ${sbp}/${Math.round(sbp * 0.64)}, HR ${hr}, BT ${temp}℃, SpO2 ${spo2}%, RR ${rr}. ${better ? '증상 호전 양상.' : si === 0 ? '아침 라운딩 관찰.' : '경과 관찰 중.'}`,
            action: better ? '활동 격려, 투약 지속, 퇴원 교육 진행.' : '처방 약물 투여, 활력징후 모니터링, 의사 보고.',
            response: better ? '환자 안정적, 불편감 호소 없음.' : '투약 후 증상 완화, 지속 관찰.',
            priority: temp >= 38 || spo2 < 92 ? 'URGENT' : 'NORMAL',
            // 🔴 `createdAt` 이 없으면 삽입 시각이 박혀 "생성보다 먼저 서명"이 된다(2026-08-28 실측 186건)
            recordedAt, status: 'SIGNED', signedAt: recordedAt, signedBy: nrs(ai + si), createdAt: recordedAt,
          },
        }).then(() => { nnCnt++; }).catch(() => {});
      }

      // 경과기록(일 1회)
      const pnId = makeId('cr-pn', `${ai}-${d}`);
      await prisma.progressNote.upsert({
        where: { id: pnId }, update: {},
        create: { id: pnId, admissionId: admId, doctorId: dDoc, noteDate: dayBase, content: `S: ${trend > 0.6 ? '증상 호전, 식이 양호' : '증상 지속, 경과 관찰'}\nO: BP ${sbp}/${Math.round(sbp * 0.64)}, HR ${hr}, BT ${temp}℃, SpO2 ${spo2}%\nA: ${plan.reason.split(' — ')[0]} ${trend > 0.6 ? '— 호전 중' : '— 치료 중'}\nP: ${d === plan.los - 1 ? '퇴원 결정, 외래 추적' : '현 치료 유지'}`, vitalSigns: { systolicBp: sbp, diastolicBp: Math.round(sbp * 0.64), heartRate: hr, temperature: temp, spo2, respiratoryRate: rr } },
      }).then(() => { pnCnt++; }).catch(() => {});

      // 섭취/배설(일 2회)
      for (let k = 0; k < 2; k++) {
        const ioId = makeId('cr-io', `${ai}-${d}-${k}`);
        await prisma.intakeOutput.upsert({
          where: { id: ioId }, update: {},
          create: { id: ioId, admissionId: admId, nurseId: nrs(ai + k), recordedAt: atHour(dayBase, k === 0 ? 8 : 16), intakeType: k === 0 ? 'IV' : 'ORAL', intakeAmount: k === 0 ? 500 : 350, intakeDetail: k === 0 ? 'N/S 500mL' : '식사+물', outputType: 'URINE', outputAmount: 300 + Math.floor(r() * 300), outputDetail: '자연 배뇨' },
        }).then(() => { ioCnt++; }).catch(() => {});
      }

      // 투약 시행(처방별 1회/일)
      for (let m = 0; m < medRx.length; m++) {
        const maId = makeId('cr-ma', `${ai}-${d}-${m}`);
        const schAt = atHour(dayBase, m === 0 ? 9 : 18);
        await prisma.medicationAdministration.upsert({
          where: { id: maId }, update: {},
          create: { id: maId, prescriptionId: medRx[m], patientId: p.id, nurseId: nrs(ai + m), scheduledAt: schAt, administeredAt: schAt, status: 'ADMINISTERED', route: m === 0 ? 'IV' : 'PO', dose: m === 0 ? '1 vial' : '1 tab', verifiedBy: nrs(ai) },
        }).then(() => { maCnt++; }).catch(() => {});
      }
    }

    // 퇴원요약
    const dsId = makeId('cr-ds', ai);
    const dxName = ({ E11: '제2형 당뇨병', J20: '급성 기관지염/폐렴', I10: '본태성 고혈압', K29: '위장관염', N39: '요로감염', J45: '천식' } as Record<string, string>)[plan.primaryDx] ?? plan.reason;
    await prisma.dischargeSummary.upsert({
      where: { admissionId: admId }, update: {},
      create: {
        id: dsId, admissionId: admId, doctorId: dDoc, admitDate, dischargeDate,
        admitDiagnosis: dxName, dischargeDiagnosis: `${dxName}, 호전`, diagnosisCodes: [plan.primaryDx],
        hospitalCourse: `${plan.reason} 목적으로 입원하여 ${plan.los}일간 치료. 활력징후 안정화 및 증상 호전 확인 후 퇴원.`,
        conditionAtDischarge: '호전(Improved)', dischargeMedications: [{ name: '퇴원약', days: 14 }],
        followUpPlan: '2주 후 외래 추적, 증상 악화 시 즉시 내원.', followUpDate: atHour(daysAgo(plan.gapAfter - 14 > 0 ? plan.gapAfter - 14 : 0), 10),
        dietaryInstructions: plan.primaryDx === 'E11' ? '당뇨식, 규칙적 식사' : '균형식', activityRestrictions: '무리한 활동 제한, 충분한 휴식',
        // 🔴 같은 이유 — 퇴원요약도 그 시점의 기록이다
        patientEducation: '복약 순응·자가 모니터링 교육 완료.', status: 'SIGNED', signedAt: dischargeDate, signedBy: dDoc, createdAt: dischargeDate,
      },
    }).then(() => { dsCnt++; }).catch((e: unknown) => { console.error('[DS-FAIL]', ai, e instanceof Error ? e.message.split('\n')[0] : e); });
  }
  console.log(`[B] 입원 ${admCnt}건(퇴원완료) · 간호노트 ${nnCnt} · 경과 ${pnCnt} · I/O ${ioCnt} · 투약 ${maCnt} · 퇴원요약 ${dsCnt}`);
  console.log(`[seed-chart-richness] 완료 — 총 진료 ${encCnt}건 / 환자 ${patients.length}명`);
}

main().catch((e) => { console.error('[seed-chart-richness] 실패:', e); process.exit(1); }).finally(() => prisma.$disconnect());
