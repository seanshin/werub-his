import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 임상 볼륨 확장 — 수술(수술기록 · 마취기록 · WHO 체크리스트 · 마취전평가) · 실행:
 *
 *   cd apps/api && npx ts-node --transpile-only prisma/seeds/clinical-volume-surgery.ts
 *
 * 전제: 메인 `prisma/seed.ts`(환자·직원). 멱등: 결정적 UUID + 자연키(`surgeryId`) upsert.
 *
 * ── 왜 이 축인가 ────────────────────────────────────────────────────────
 * 운영 실측(2026-08-18): 수술 14건에 `surgery_op_notes` 2 · `anesthesia_records` 2 ·
 * `surgical_checklists` 3 · `pre_anesthesia_evaluations` 1. 수술 화면 4개 탭이 전부 빈칸이다.
 *
 * ── 🔴 기존 수술 14건은 건드리지 않는다 ─────────────────────────────────
 * 자식 4종이 전부 `surgeryId @unique` 라, 이미 기록이 붙은 수술에 다른 id 로 붙이면
 * P2002(유니크 위반)로 **시드 전체가 죽는다**. 이 시드는 **자기가 만든 수술에만** 자식을 붙인다.
 *
 * ── 🔴 같은 사실이 4곳에 적힌다(P12 위험 지점) ──────────────────────────
 * 마취 종류: `Surgery.anesthesiaType` · `SurgeryOpNote.anesthesiaType` ·
 *            `AnesthesiaRecord.anesthesiaType` · `PreAnesthesiaEvaluation.plan`
 * 실혈량:    `Surgery.ebl` · `SurgeryOpNote.estimatedBloodLoss` · `AnesthesiaRecord.ebl`
 * ASA 등급:  `SurgeryOpNote.asaClass`(Int) · `PreAnesthesiaEvaluation.asaClass`(문자)
 * → 생성기는 **한 번 정한 값을 네 곳에 그대로 복사**하고, 가드가 네 곳의 일치를 검사한다.
 *   마취 종류 코드는 `@hospital-run/shared` 의 `isCanonicalAnesthesiaCode` 로 검증한다
 *   (DB 에 한글/영문이 섞여 있는 것이 이미 실측됐다 — 시드가 거기에 한 벌 더 얹지 않는다).
 */

import type { Prisma } from '@prisma/client';

import {
  CV_TAGS,
  CvContext,
  TimeOrderRule,
  cvRandom,
  cvReport,
  cvUuid,
  intBetween,
  pickOne,
  plusMinutes,
  upsertArgs,
  withoutId,
} from './clinical-volume-core';

// ─────────────────────────── 술식 카탈로그 ───────────────────────────

export interface ProcedureSpec {
  name: string;
  /** 절개~봉합 소요(분) */ opMinutes: [number, number];
  /** 추정 실혈량(mL) */ ebl: [number, number];
  /** 마취 종류 코드 — shared ANESTHESIA_LABEL 키 */ anesthesia: 'GENERAL' | 'SPINAL' | 'SEDATION' | 'LOCAL';
  bodySite: string;
  laterality: 'LEFT' | 'RIGHT' | 'BILATERAL' | 'MIDLINE' | 'NA';
  preOpDx: string;
  postOpDx: string;
  findings: string;
}

/** 🔴 마취 종류·실혈량은 술식에서 나온다 — 백내장 수술에 전신마취 4시간이 붙으면 즉시 거짓이 드러난다 */
export const PROCEDURES: readonly ProcedureSpec[] = [
  {
    name: '복강경 담낭절제술', opMinutes: [55, 120], ebl: [20, 120], anesthesia: 'GENERAL',
    bodySite: '담낭', laterality: 'NA',
    preOpDx: '[시연] 만성 담낭염 및 담석증', postOpDx: '[시연] 만성 담낭염 및 담석증',
    findings: '[시연] 담낭벽 비후 및 유착 관찰. 담관 손상 없이 담낭 절제 완료.',
  },
  {
    name: '복강경 충수절제술', opMinutes: [35, 80], ebl: [10, 60], anesthesia: 'GENERAL',
    bodySite: '충수', laterality: 'NA',
    preOpDx: '[시연] 급성 충수염', postOpDx: '[시연] 급성 충수염',
    findings: '[시연] 충수 종창 및 주위 삼출액 관찰. 천공 소견 없음.',
  },
  {
    name: '무릎 관절경 반월상연골 부분절제술', opMinutes: [40, 90], ebl: [10, 50], anesthesia: 'SPINAL',
    bodySite: '슬관절', laterality: 'RIGHT',
    preOpDx: '[시연] 내측 반월상연골 파열', postOpDx: '[시연] 내측 반월상연골 파열',
    findings: '[시연] 내측 반월상연골 후각부 수평 파열 확인, 불안정 부분 절제.',
  },
  {
    name: '인공 고관절 전치환술', opMinutes: [90, 180], ebl: [250, 800], anesthesia: 'SPINAL',
    bodySite: '고관절', laterality: 'LEFT',
    preOpDx: '[시연] 퇴행성 고관절염', postOpDx: '[시연] 퇴행성 고관절염',
    findings: '[시연] 관절면 연골 소실 확인. 삽입물 위치 및 안정성 양호.',
  },
  {
    name: '백내장 수술(초음파유화술 및 인공수정체 삽입)', opMinutes: [15, 35], ebl: [0, 5], anesthesia: 'LOCAL',
    bodySite: '수정체', laterality: 'RIGHT',
    preOpDx: '[시연] 노인성 백내장', postOpDx: '[시연] 노인성 백내장',
    findings: '[시연] 수정체 혼탁 제거 후 인공수정체 낭내 삽입 완료.',
  },
  {
    name: '갑상선 반절제술', opMinutes: [70, 150], ebl: [30, 150], anesthesia: 'GENERAL',
    bodySite: '갑상선', laterality: 'RIGHT',
    preOpDx: '[시연] 갑상선 결절', postOpDx: '[시연] 갑상선 결절',
    findings: '[시연] 반회후두신경 보존 확인. 부갑상선 보존.',
  },
  {
    name: '서혜부 탈장 교정술', opMinutes: [45, 100], ebl: [10, 60], anesthesia: 'SPINAL',
    bodySite: '서혜부', laterality: 'LEFT',
    preOpDx: '[시연] 서혜부 탈장', postOpDx: '[시연] 서혜부 탈장',
    findings: '[시연] 탈장낭 환원 후 인공막 보강. 장 손상 없음.',
  },
  {
    name: '위내시경적 점막하 박리술', opMinutes: [50, 120], ebl: [5, 40], anesthesia: 'SEDATION',
    bodySite: '위', laterality: 'NA',
    preOpDx: '[시연] 위 선종', postOpDx: '[시연] 위 선종',
    findings: '[시연] 병변 일괄 절제 완료. 천공 및 활동성 출혈 없음.',
  },
] as const;

/** 마취 종류 → 마취전평가 `plan` 값. 🔴 같은 사실이라 여기서 한 번만 매핑한다 */
export const ANESTHESIA_TO_PLAN: Record<ProcedureSpec['anesthesia'], string> = {
  GENERAL: 'GENERAL',
  SPINAL: 'SPINAL',
  SEDATION: 'SEDATION',
  LOCAL: 'LOCAL',
};

/** 기도 확보는 마취 종류를 따른다 — 국소마취에 기관삽관이 붙으면 거짓이다 */
const AIRWAY_BY_ANESTHESIA: Record<ProcedureSpec['anesthesia'], string | null> = {
  GENERAL: 'ETT',
  SPINAL: null,
  SEDATION: 'NASAL_CANNULA',
  LOCAL: null,
};

// ─────────────────────────── 생성기 ───────────────────────────

export interface SurgerySeedContext extends CvContext {
  /** 마취과 의사 풀(별도 계정이 없으면 의사 풀) */
  anesthetists: string[];
}

export interface SurgerySeedRow {
  index: number;
  surgery: Prisma.SurgeryUncheckedCreateInput & { id: string };
  opNote: Prisma.SurgeryOpNoteUncheckedCreateInput & { id: string };
  anesthesia: Prisma.AnesthesiaRecordUncheckedCreateInput & { id: string };
  checklist: Prisma.SurgicalChecklistUncheckedCreateInput & { id: string };
  preAnesthesia: Prisma.PreAnesthesiaEvaluationUncheckedCreateInput & { id: string };
}

export const SURGERY_TIME_RULES: readonly TimeOrderRule[] = [
  ['scheduledAt', 'startedAt'],
  ['startedAt', 'incisionTime'],
  ['incisionTime', 'closureTime'],
  ['closureTime', 'endedAt'],
] as const;

export const OPNOTE_TIME_RULES: readonly TimeOrderRule[] = [['incisionTime', 'closureTime']] as const;

export const ANESTHESIA_TIME_RULES: readonly TimeOrderRule[] = [
  ['inductionTime', 'intubationTime'],
  ['intubationTime', 'extubationTime'],
  ['inductionTime', 'extubationTime'],
] as const;

export const CHECKLIST_TIME_RULES: readonly TimeOrderRule[] = [
  ['signInCompletedAt', 'timeOutCompletedAt'],
  ['timeOutCompletedAt', 'signOutCompletedAt'],
] as const;

export const PRE_ANESTHESIA_TIME_RULES: readonly TimeOrderRule[] = [['npoSince', 'completedAt']] as const;

export const SURGERY_DEFAULT_COUNT = 36;

/**
 * 수술 한 벌(수술 + 자식 4종)을 생성한다.
 * 🔴 마취 종류·실혈량·ASA 는 **여기서 한 번 정하고 네 곳에 그대로 복사**한다.
 *    각 테이블에서 따로 뽑으면 같은 수술의 마취가 화면마다 달라진다(실제로 있었던 결함 유형).
 */
export function buildSurgeries(ctx: SurgerySeedContext, count = SURGERY_DEFAULT_COUNT): SurgerySeedRow[] {
  if (!ctx.patients.length || !ctx.doctors.length || !ctx.anesthetists.length || !ctx.nurses.length) return [];
  const rows: SurgerySeedRow[] = [];

  for (let i = 0; i < count; i++) {
    const r = cvRandom(`cv-surgery:${i}`);
    const spec = PROCEDURES[i % PROCEDURES.length];
    const patient = ctx.patients[(i * 11) % ctx.patients.length];
    const surgeonId = ctx.doctors[i % ctx.doctors.length];
    const anesthetistId = ctx.anesthetists[(i + 1) % ctx.anesthetists.length];
    const scrubNurseId = ctx.nurses[i % ctx.nurses.length];

    // ── 한 번만 정하는 사실들 ──
    const opMinutes = intBetween(r(), spec.opMinutes[0], spec.opMinutes[1]);
    const ebl = intBetween(r(), spec.ebl[0], spec.ebl[1]);
    // 🔴 20건 중 1건은 Sign-In 을 미완료로 남긴다 — 미이행 탐지 워크리스트에
    //    표본이 없으면 그 기능이 작동하는지 알 수 없다(결정적: 재실행해도 같은 건).
    const signInIncomplete = i % 20 === 3;
    const asaClass = r() < 0.55 ? 1 : r() < 0.85 ? 2 : 3;
    const anesthesiaType = spec.anesthesia;

    // ── 시각 ──
    const scheduledAt = new Date(ctx.now.getTime() - intBetween(r(), 3, 210) * 86_400_000);
    scheduledAt.setHours(intBetween(r(), 8, 15), pickOne([0, 30], r()), 0, 0);
    const startedAt = plusMinutes(scheduledAt, intBetween(r(), 5, 45)); // 입실 지연은 흔하다
    const inductionTime = plusMinutes(startedAt, intBetween(r(), 2, 10));
    const intubationTime = AIRWAY_BY_ANESTHESIA[anesthesiaType] === 'ETT' ? plusMinutes(inductionTime, intBetween(r(), 2, 8)) : null;
    const incisionTime = plusMinutes(intubationTime ?? inductionTime, intBetween(r(), 8, 25));
    const closureTime = plusMinutes(incisionTime, opMinutes);
    const extubationTime = intubationTime ? plusMinutes(closureTime, intBetween(r(), 3, 18)) : null;
    const endedAt = plusMinutes(extubationTime ?? closureTime, intBetween(r(), 5, 20));
    if (endedAt.getTime() > ctx.now.getTime()) continue;

    // 체크리스트 3단계 — Sign-in(마취 유도 전) · Time-out(절개 직전) · Sign-out(봉합 후 퇴실 전).
    // 🔴 Sign-out 은 **봉합과 퇴실 사이**에 있어야 한다. 종전엔 closure+2~12분을 고정으로 더해
    //    비삽관 수술(퇴실까지 5~20분)에서 Sign-out 이 퇴실보다 늦어졌다 — 가드가 잡았다.
    const signInAt = plusMinutes(inductionTime, -intBetween(r(), 1, 5));
    const timeOutAt = plusMinutes(incisionTime, -intBetween(r(), 1, 4));
    const closureToEndMin = Math.round((endedAt.getTime() - closureTime.getTime()) / 60_000);
    const signOutAt = plusMinutes(closureTime, Math.max(1, intBetween(r(), 1, Math.max(1, closureToEndMin - 1))));

    // 🔴 마취전평가는 수술 **당일 입실 전**에 끝난다. NPO 는 그 전날 밤부터다.
    //    종전엔 평가를 18~30시간 전으로 잡아 `npoConfirmed:true` 인데 **NPO 시작보다 평가가 빨랐다**
    //    (아직 시작도 안 한 금식을 "확인했다"고 기록한 셈 — 가드가 잡았다).
    const preAnesthesiaCompletedAt = plusMinutes(scheduledAt, -intBetween(r(), 60, 120));
    const npoSince = new Date(scheduledAt);
    npoSince.setDate(npoSince.getDate() - 1);
    npoSince.setHours(22, 0, 0, 0);

    const surgeryId = cvUuid(CV_TAGS.surgery, i);

    rows.push({
      index: i,
      surgery: {
        id: surgeryId,
        patientId: patient.id,
        surgeonId,
        anesthetistId,
        scheduledAt,
        startedAt,
        endedAt,
        procedureName: spec.name,
        bodySite: spec.bodySite,
        laterality: spec.laterality,
        status: 'COMPLETED',
        preOpDiagnosis: spec.preOpDx,
        postOpDiagnosis: spec.postOpDx,
        findings: spec.findings,
        ebl,
        incisionTime,
        closureTime,
        scrubNurseId,
        anesthesiaType,
        createdAt: scheduledAt,
        updatedAt: endedAt,
      },
      opNote: {
        id: cvUuid(CV_TAGS.opNote, i),
        surgeryId,
        preOpDiagnosis: spec.preOpDx,
        postOpDiagnosis: spec.postOpDx,
        anesthesiaType,
        incisionTime,
        closureTime,
        findings: spec.findings,
        estimatedBloodLoss: ebl,
        narrative: `[시연] ${spec.name} 시행. 수술 경과 특이사항 없음.`,
        postOpOrders: '[시연] 활력징후 관찰, 통증 조절, 조기 보행 격려.',
        asaClass,
        vteProphylaxis: opMinutes >= 60,
        prophylacticAbx: '[시연] 절개 60분 이내 예방적 항생제 투여함',
        // 🔴 합병증이 없으면 등급도 없다 — 'NONE' 같은 값을 만들어 넣지 않는다
        complications: null,
        complicationGrade: null,
        createdBy: surgeonId,
        createdAt: endedAt,
      },
      anesthesia: {
        id: cvUuid(CV_TAGS.anesthesiaRecord, i),
        surgeryId,
        anesthetistId,
        anesthesiaType,
        asaClass: String(asaClass),
        airwayType: AIRWAY_BY_ANESTHESIA[anesthesiaType],
        inductionTime,
        intubationTime,
        extubationTime,
        ebl,
        // 소변량은 수술 시간에 비례한다(0.5~1.0 mL/kg/hr 수준을 성인 60kg 로 단순화)
        urineOutput: Math.round((opMinutes / 60) * intBetween(r(), 30, 60)),
        notes: `[시연] 마취 경과 안정. ${anesthesiaType} 유지.`,
      },
      checklist: {
        id: cvUuid(CV_TAGS.surgicalChecklist, i),
        surgeryId,
        // 🔴 종전엔 `signInSiteMarked` 를 **좌우 유무에 연결**했다 —
        //    좌우가 없는 술식(NA)이면 false 가 되는데 완료 스탬프는 무조건 찍혀
        //    **"확인자 OO·시각 T" 가 사실이 아닌 행이 14건** 생겼다(2026-08-18 실측).
        //    수술 부위 표시는 **좌우와 무관한 필수 절차**다.
        // 🔴 완료 스탬프는 정본 규칙(`CHECKLIST_ITEMS` required 전부 true)을 따른다 —
        //    20건 중 1건은 **일부러 미완료로 남긴다**. 전건이 완료면 미이행 탐지
        //    워크리스트가 한 번도 표본을 갖지 못해 **작동하는지 알 수 없다**.
        signInPatientId: true,
        signInSiteMarked: !signInIncomplete,
        signInConsentSigned: true,
        signInAnesthesiaCheck: true,
        signInAllergyCheck: true,
        signInPulseOximeter: true,
        signInExpectedBloodLoss: ebl >= 200,
        signInDifficultAirway: false,
        signInCompletedBy: signInIncomplete ? null : anesthetistId,
        signInCompletedAt: signInIncomplete ? null : signInAt,
        timeOutTeamIntro: true,
        timeOutPatientName: true,
        timeOutProcedure: true,
        timeOutSite: true,
        timeOutAntibiotics: true,
        timeOutCriticalEvents: true,
        timeOutImagingDisplayed: true,
        timeOutCompletedBy: surgeonId,
        timeOutCompletedAt: timeOutAt,
        signOutProcedureRecorded: true,
        signOutInstrumentCount: true,
        signOutSpecimenLabeled: true,
        signOutRecoveryPlan: true,
        signOutEquipmentIssues: false,
        signOutCompletedBy: scrubNurseId,
        signOutCompletedAt: signOutAt,
        // 🔴 계수는 **사람이 두 번 세는 절차**다. `countStatus` 만 박으면
        //    잔류이물 게이트(`surgery.countEnforce`)가 **데이터 없이 통과**한다 —
        //    운영 실측(2026-08-18) `count_items` 0/39 · `count_status` MATCH 36 이 그 상태였다.
        //    판정 정본은 `surgery-advanced.service.deriveCountStatus` 이고, 그 규칙은
        //    **숫자가 같아도 사람이 고르지 않으면 MATCH 가 아니다** 이므로 status 를 함께 기록한다.
        ...buildCountRecord(r, i),
      },
      preAnesthesia: {
        id: cvUuid(CV_TAGS.preAnesthesiaEval, i),
        surgeryId,
        patientId: patient.id,
        evaluatorId: anesthetistId,
        asaClass: String(asaClass),
        airwayMallampati: pickOne(['I', 'II', 'III'], r()),
        npoConfirmed: true,
        npoSince,
        labsReviewed: true,
        cardiacRiskRcri: asaClass >= 3 ? intBetween(r(), 1, 3) : 0,
        anesthesiaConsent: true,
        plan: ANESTHESIA_TO_PLAN[anesthesiaType],
        status: 'COMPLETED',
        completedAt: preAnesthesiaCompletedAt,
        notes: '[시연] 마취 전 평가 완료. 특이 기왕력 및 약물 알레르기 보고 없음.',
        createdAt: preAnesthesiaCompletedAt,
        updatedAt: preAnesthesiaCompletedAt,
      },
    });
  }
  return rows;
}

// ─────────────────────────── 실행 ───────────────────────────

async function main(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const patients = await prisma.patient.findMany({
      select: { id: true, dateOfBirth: true, gender: true }, orderBy: { createdAt: 'asc' }, take: 300,
    });
    const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    const nurses = await prisma.user.findMany({ where: { role: 'NURSE' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    if (!patients.length || doctors.length < 2 || !nurses.length) {
      console.log('[clinical-volume:surgery] 환자/의사/간호사 부족 — 메인 seed 먼저. 건너뜀');
      return;
    }

    const ctx: SurgerySeedContext = {
      now,
      patients: patients.map((p) => ({ id: p.id, dateOfBirth: p.dateOfBirth, gender: p.gender })),
      doctors: doctors.map((d) => d.id),
      nurses: nurses.map((n) => n.id),
      anesthetists: doctors.map((d) => d.id),
    };

    const rows = buildSurgeries(ctx);
    for (const x of rows) await prisma.surgery.upsert(upsertArgs(x.surgery));
    // 🔴 자식 4종은 surgeryId 가 유니크다 — 자연키로 맞춰야 재실행이 안전하다
    for (const x of rows) {
      await prisma.surgeryOpNote.upsert({ where: { surgeryId: x.opNote.surgeryId }, create: x.opNote, update: withoutId(x.opNote) });
      await prisma.anesthesiaRecord.upsert({ where: { surgeryId: x.anesthesia.surgeryId }, create: x.anesthesia, update: withoutId(x.anesthesia) });
      await prisma.surgicalChecklist.upsert({ where: { surgeryId: x.checklist.surgeryId }, create: x.checklist, update: withoutId(x.checklist) });
      await prisma.preAnesthesiaEvaluation.upsert({ where: { surgeryId: x.preAnesthesia.surgeryId }, create: x.preAnesthesia, update: withoutId(x.preAnesthesia) });
    }

    cvReport('surgery', {
      surgeries: rows.length,
      opNotes: rows.length,
      anesthesiaRecords: rows.length,
      checklists: rows.length,
      preAnesthesiaEvaluations: rows.length,
    });
    console.log('[clinical-volume:surgery] 기존 수술 14건에는 손대지 않았다(자식 4종이 surgeryId 유니크 — 남의 기록을 덮지 않는다)');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) assertSeedAllowed(__filename, 'DEMO'); // 🔴 실행 진입에서만 판정 — 테스트가 이 모듈을 import 하므로 최상단에 두지 않는다(상용 릴리즈 T2-3)
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

/**
 * 수술 계수(거즈·스펀지·바늘·기구·칼날) 기록 생성.
 *
 * 🔴 종전엔 `countStatus:'MATCH'` 만 박고 `countItems` 를 비워 뒀다 —
 *    잔류이물 게이트가 셀 것이 없어 늘 통과했다(운영 36/39).
 * 🔴 20건 중 1건은 **불일치 + 해소 기록**으로 둔다. 전건이 MATCH 이면
 *    게이트가 한 번도 작동하지 않아 **작동하는지 알 수 없다**.
 */
function buildCountRecord(r: () => number, i: number): {
  countItems: Array<{ item: string; initial: number; final: number; status: string }>;
  countStatus: string;
  countDiscrepancyNote?: string;
} {
  const ITEMS = ['GAUZE', 'SPONGE', 'NEEDLE', 'INSTRUMENT', 'BLADE'] as const;
  const mismatch = i % 20 === 7; // 결정적 — 재실행해도 같은 건이 불일치
  const items = ITEMS.map((item, k) => {
    const initial = 4 + Math.floor(r() * 8);
    const off = mismatch && k === 0 ? 1 : 0; // 거즈 1개 부족
    return { item, initial, final: initial - off, status: off ? 'MISMATCH' : 'MATCH' };
  });
  return mismatch
    ? {
        countItems: items,
        countStatus: 'MISMATCH',
        countDiscrepancyNote: '[시연] 거즈 1개 불일치 — 재계수 후 술야 확인, 이동식 X-ray 촬영으로 잔류 없음 확인. 순회간호사·집도의 공동 확인.',
      }
    : { countItems: items, countStatus: 'MATCH' };
}
