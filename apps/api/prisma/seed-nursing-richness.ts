import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 간호기록 다양화 시드 — 모든 입원건에 간호노트 5형식(FOCUS/NARRATIVE/DAR/SOAP/DARE) +
// 간호과정(NANDA-NIC-NOC: 진단·중재·기대결과) + 낙상위험 재사정 + 간호 재사정을 추가.
// 멱등: 결정적 UUID upsert(추가만, 비파괴). 실행: cd apps/api && npx ts-node --transpile-only prisma/seed-nursing-richness.ts
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
function rng(s: string) { let a = parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16) >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeId(ns: string, n: number | string): string { const h = createHash('sha256').update(`${ns}:${n}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; }
const shiftOf = (h: number): 'DAY' | 'EVENING' | 'NIGHT' => (h < 14 ? 'DAY' : h < 22 ? 'EVENING' : 'NIGHT');

// NANDA-NIC-NOC 간호과정 풀(국내 표준 분류)
const CARE_POOL = [
  { nanda: '00132', name: '급성 통증', rf: '수술/침습적 처치', dc: '통증 호소, 통증척도 상승, 보호적 체위', noc: { code: '2102', name: '통증 수준', base: 2, target: 4 }, nic: [{ code: '1400', name: '통증 관리', freq: 'q4h 및 PRN' }, { code: '2210', name: '진통제 투여', freq: '처방대로' }] },
  { nanda: '00155', name: '낙상 위험', rf: '근력 약화, 보행 장애, 진정제', dc: '낙상력, 어지럼, 불안정한 보행', noc: { code: '1909', name: '낙상 발생 없음', base: 3, target: 5 }, nic: [{ code: '6490', name: '낙상 예방', freq: '매 근무' }, { code: '6486', name: '환경 관리: 안전', freq: '지속' }] },
  { nanda: '00004', name: '감염 위험', rf: '침습적 장치(IV/유치도뇨)', dc: 'WBC 상승, 발열, 침습장치 보유', noc: { code: '0703', name: '감염 중증도 감소', base: 3, target: 5 }, nic: [{ code: '6540', name: '감염 관리', freq: '지속' }, { code: '6550', name: '감염 예방', freq: '매 근무' }] },
  { nanda: '00002', name: '영양불균형: 신체요구량보다 적음', rf: '식욕부진, 흡수장애', dc: '섭취량 감소, 체중 감소', noc: { code: '1004', name: '영양 상태 개선', base: 2, target: 4 }, nic: [{ code: '1100', name: '영양 관리', freq: '매 식사' }, { code: '1160', name: '영양 모니터링', freq: '일 1회' }] },
  { nanda: '00032', name: '비효과적 호흡양상', rf: '폐 분비물, 통증', dc: '호흡곤란, SpO2 저하, 보조근 사용', noc: { code: '0415', name: '호흡 상태 안정', base: 2, target: 4 }, nic: [{ code: '3350', name: '호흡 감시', freq: 'q4h' }, { code: '3320', name: '산소 요법', freq: '처방대로' }] },
  { nanda: '00027', name: '체액 부족', rf: '구토/설사, 수분섭취 부족', dc: '점막 건조, 소변량 감소, 빈맥', noc: { code: '0601', name: '수분 균형 회복', base: 2, target: 4 }, nic: [{ code: '4120', name: '수분 관리', freq: '지속' }, { code: '4130', name: '수분 모니터링', freq: 'q8h' }] },
  { nanda: '00126', name: '지식 부족', rf: '질병/치료 정보 부족', dc: '질문 많음, 부정확한 수행', noc: { code: '1803', name: '지식: 질병 과정', base: 2, target: 4 }, nic: [{ code: '5602', name: '교육: 질병 과정', freq: '입원/퇴원 시' }, { code: '5616', name: '교육: 처방약물', freq: '퇴원 전' }] },
  { nanda: '00046', name: '피부 통합성 장애 위험', rf: '부동, 압력, 영양저하', dc: '발적, Braden 점수 저하', noc: { code: '1101', name: '조직 통합성 유지', base: 3, target: 5 }, nic: [{ code: '3540', name: '압력 관리', freq: 'q2h 체위변경' }, { code: '3590', name: '피부 감시', freq: '매 근무' }] },
];

async function main() {
  const admissions = await prisma.admission.findMany({
    where: { status: { not: 'CANCELLED' } },
    select: { id: true, patientId: true, admitDate: true, dischargeDate: true, status: true, attendingDoctorId: true },
    orderBy: { admitDate: 'asc' },
  });
  if (!admissions.length) { console.error('입원 없음'); return; }
  const nurses = await prisma.user.findMany({ where: { role: 'NURSE' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  if (!nurses.length) { console.error('간호사 없음'); return; }
  const nrs = (i: number) => nurses[i % nurses.length].id;
  const doc = (i: number) => (doctors.length ? doctors[i % doctors.length].id : nurses[0].id);

  let nnCnt = 0, dxCnt = 0, nicCnt = 0, nocCnt = 0, frCnt = 0, naCnt = 0;

  for (let ai = 0; ai < admissions.length; ai++) {
    const a = admissions[ai];
    const r = rng(`nr:${a.id}`);
    const start = new Date(a.admitDate);
    const end = a.dischargeDate ? new Date(a.dischargeDate) : new Date();
    const losDays = Math.max(2, Math.min(14, Math.ceil((end.getTime() - start.getTime()) / 86400000)));
    const dayAt = (d: number, h: number) => { const x = new Date(start); x.setDate(x.getDate() + Math.min(d, losDays - 1)); x.setHours(h, 0, 0, 0); return x; };

    // ── 간호 재사정(care-plan 앵커 + 추가 재사정) ──
    const anchorNaId = makeId('nr-na', a.id);
    const painBase = 3 + Math.floor(r() * 5);
    await prisma.nursingAssessment.upsert({
      where: { id: anchorNaId }, update: {},
      create: { id: anchorNaId, admissionId: a.id, nurseId: nrs(ai), consciousness: 'ALERT', mobility: ai % 2 ? 'BED_REST' : 'AMBULATORY_ASSIST', painScore: painBase, painLocation: ['수술 부위', '복부', '요부', '흉부', '전신'][ai % 5], nutritionStatus: ai % 3 ? 'ADEQUATE' : 'POOR', skinIntegrity: ai % 4 === 0 ? 'AT_RISK' : 'INTACT', bradenScore: 13 + Math.floor(r() * 9), allergyConfirmed: true, additionalData: { admissionRoute: '응급실', orientation: 'x3', riskScreen: 'completed' }, assessedAt: start },
    }).then(() => { naCnt++; }).catch(() => {});
    // 중간 재사정(호전)
    const midNaId = makeId('nr-na2', a.id);
    await prisma.nursingAssessment.upsert({
      where: { id: midNaId }, update: {},
      create: { id: midNaId, admissionId: a.id, nurseId: nrs(ai + 1), consciousness: 'ALERT', mobility: 'AMBULATORY', painScore: Math.max(0, painBase - 3), nutritionStatus: 'ADEQUATE', skinIntegrity: 'INTACT', bradenScore: 18 + Math.floor(r() * 4), allergyConfirmed: true, additionalData: { reassessment: true, note: '경과 재사정 — 호전' }, assessedAt: dayAt(Math.floor(losDays / 2), 10) },
    }).then(() => { naCnt++; }).catch(() => {});

    // ── 낙상위험 재사정(입원/중간/퇴원전, Morse) ──
    const morseSeq = [55, 40, 25];
    for (let f = 0; f < 3; f++) {
      const frId = makeId('nr-fr', `${a.id}-${f}`);
      const score = morseSeq[f] + Math.floor((r() - 0.5) * 10);
      const level = score >= 45 ? 'HIGH' : score >= 25 ? 'MODERATE' : 'LOW';
      await prisma.fallRiskAssessment.upsert({
        where: { id: frId }, update: {},
        create: { id: frId, patientId: a.patientId, assessorId: nrs(ai + f), score, riskLevel: level, factors: { fallHistory: f === 0, secondaryDx: true, ambulatoryAid: f < 2 ? '가구/벽 잡음' : '없음', ivTherapy: f < 2, gait: f < 2 ? 'impaired' : 'normal', mentalStatus: 'oriented' }, interventions: level === 'HIGH' ? ['낙상고위험 표지', '침상난간 상시', '호출벨 교육', '야간 순회 강화'] : ['낙상주의 교육', '미끄럼방지 양말'], assessedAt: dayAt(f === 0 ? 0 : f === 1 ? Math.floor(losDays / 2) : losDays - 1, 8) },
      }).then(() => { frCnt++; }).catch(() => {});
    }

    // ── 간호과정(NANDA-NIC-NOC) 3건 ──
    const pick = [ai % CARE_POOL.length, (ai + 2) % CARE_POOL.length, (ai + 5) % CARE_POOL.length];
    const uniq = [...new Set(pick)].slice(0, 3);
    for (let k = 0; k < uniq.length; k++) {
      const cp = CARE_POOL[uniq[k]];
      const ndId = makeId('nr-nd', `${a.id}-${k}`);
      const resolved = a.status === 'DISCHARGED' && k < 2;
      await prisma.nursingDiagnosis.upsert({
        where: { id: ndId }, update: {},
        create: { id: ndId, assessmentId: anchorNaId, nurseId: nrs(ai + k), nandaCode: cp.nanda, nandaName: cp.name, relatedFactors: cp.rf, definingCharacteristics: cp.dc, expectedOutcome: `${cp.noc.name} (목표 ${cp.noc.target}/5)`, status: resolved ? 'RESOLVED' : 'ACTIVE' },
      }).then(() => { dxCnt++; }).catch(() => {});
      // NIC 중재 2건
      for (let m = 0; m < cp.nic.length; m++) {
        const niId = makeId('nr-ni', `${a.id}-${k}-${m}`);
        await prisma.nursingIntervention.upsert({
          where: { id: niId }, update: {},
          create: { id: niId, nursingDiagnosisId: ndId, nicCode: cp.nic[m].code, name: cp.nic[m].name, detail: `${cp.name}에 대한 ${cp.nic[m].name} 시행`, frequency: cp.nic[m].freq, status: resolved ? 'COMPLETED' : 'ACTIVE', createdBy: nrs(ai + k) },
        }).then(() => { nicCnt++; }).catch(() => {});
      }
      // NOC 기대결과 1건(평가)
      const noId = makeId('nr-no', `${a.id}-${k}`);
      const current = resolved ? cp.noc.target : Math.min(cp.noc.target, cp.noc.base + 1);
      await prisma.nursingOutcome.upsert({
        where: { id: noId }, update: {},
        create: { id: noId, nursingDiagnosisId: ndId, nocCode: cp.noc.code, name: cp.noc.name, baselineScore: cp.noc.base, targetScore: cp.noc.target, currentScore: current, status: current >= cp.noc.target ? 'MET' : current > cp.noc.base ? 'PARTIALLY_MET' : 'NOT_MET', evaluatedAt: dayAt(losDays - 1, 11), evaluatedBy: nrs(ai + k), createdBy: nrs(ai + k) },
      }).then(() => { nocCnt++; }).catch(() => {});
    }

    // ── 간호노트 5형식 다양화 ──
    const notes: { ns: string; day: number; hour: number; type: 'FOCUS' | 'NARRATIVE' | 'DAR' | 'SOAP' | 'DARE'; fields: Record<string, string> }[] = [
      { ns: 'narr', day: 0, hour: 16, type: 'NARRATIVE', fields: { content: '금일 입원하여 병동 안내 및 입원 생활 교육 시행함. 입원 시 활력징후 측정하였으며 낙상위험 사정 결과 고위험으로 침상난간 적용 및 호출벨 교육함. 보호자 상주 확인하였고, 환자 불안 호소하여 정서적 지지 제공함.' } },
      { ns: 'dar', day: 1, hour: 10, type: 'DAR', fields: { focus: '통증', data: 'NRS 6/10, 수술 부위 통증 호소, 찡그린 표정', action: '처방된 진통제(IV) 투여, 편안한 체위 유지 도움', response: '투여 30분 후 NRS 3/10으로 감소, 안정됨' } },
      { ns: 'soap', day: 1, hour: 21, type: 'SOAP', fields: { subjective: '"잠을 잘 못 자겠어요" 수면 장애 호소', objective: '야간 빈번한 각성, 활력징후 안정(BP 124/78, HR 72)', assessment: '입원 환경 변화 및 통증과 관련된 수면 양상 장애', plan: '소음 차단, 야간 처치 최소화, 필요시 수면 환경 조절 교육' } },
      { ns: 'dare', day: 2, hour: 14, type: 'DARE', fields: { focus: '투약 교육', data: '퇴원 약물에 대한 이해 부족, 복용법 질문 다수', action: '처방 약물 복용법·부작용·보관법 설명, 리플릿 제공', response: '환자/보호자 복용법 정확히 재설명함', education: '저염식·규칙적 복약·증상 악화 시 내원 교육 완료' } },
      { ns: 'focus2', day: 3, hour: 9, type: 'FOCUS', fields: { focus: '활동', data: '보조 하에 병실 내 보행 시도, 어지럼 없음', action: '보행 보조, 낙상 예방 재교육', response: '복도 20m 보행 성공, 자신감 표현' } },
    ];
    for (const nt of notes) {
      if (nt.day >= losDays && nt.ns !== 'narr') continue; // 재원일수 내만
      const nnId = makeId('nr-nn', `${a.id}-${nt.ns}`);
      const recordedAt = dayAt(nt.day, nt.hour);
      await prisma.nursingNote.upsert({
        where: { id: nnId }, update: {},
        // 🔴 2026-08-28 — `createdAt` 을 넣지 않아 **삽입 시각**이 박혔다. `signedAt` 은 과거
        //    진료일이라 운영에 **"생성보다 먼저 서명된 기록" 186건**이 생겼다(실측).
        //    기록의 시각은 그 기록이 있었던 때다 — 시드를 돌린 때가 아니다.
        create: { id: nnId, admissionId: a.id, nurseId: nrs(ai + nt.day), noteType: nt.type, shiftType: shiftOf(nt.hour), priority: 'NORMAL', recordedAt, status: 'SIGNED', signedAt: recordedAt, signedBy: nrs(ai + nt.day), createdAt: recordedAt, ...nt.fields },
      }).then(() => { nnCnt++; }).catch(() => {});
    }
  }
  console.log(`[seed-nursing-richness] 입원 ${admissions.length}건 — 간호노트(5형식) ${nnCnt} · 간호진단(NANDA) ${dxCnt} · 중재(NIC) ${nicCnt} · 기대결과(NOC) ${nocCnt} · 낙상재사정 ${frCnt} · 간호재사정 ${naCnt}`);
}

main().catch((e) => { console.error('[seed-nursing-richness] 실패:', e); process.exit(1); }).finally(() => prisma.$disconnect());
