import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 임상 볼륨 확장 — 병동 간호(flow sheet · 간호기록 · 인수인계 · 회진) · 실행:
 *
 *   cd apps/api && npx ts-node --transpile-only prisma/seeds/clinical-volume-nursing.ts
 *
 * 전제: 메인 `prisma/seed.ts`(환자·직원·병상·입원). 멱등: 결정적 UUID + `upsertArgs`(update:{} 금지).
 *
 * ── 왜 이 축인가 ────────────────────────────────────────────────────────
 * 운영 실측(2026-08-18): `flow_sheet_entries` 2 · `universal_nursing_notes` 2 ·
 * `clinical_handoffs` 2 · `rounds` **0**. 입원 환자 22명인데 병동 화면(활력 시트·간호기록·
 * 인수인계·회진)이 전부 빈 목록이다. 병동은 매 근무마다 열리는 화면이라 우선순위가 가장 높다.
 *
 * ── 🔴 정본을 부른다 ────────────────────────────────────────────────────
 * · 근무(shift) 판정은 `@hospital-run/shared` 의 `shiftOf` 하나다. 시드가 "10시=DAY" 를
 *   자기 식으로 적으면 병원 교대 경계(config `nursing.shift.boundaries`)를 바꾼 순간 갈라진다.
 * · 활력 값은 `CreateFlowSheetEntryDto` 의 범위를 **넘지 않는다**. 가드가 실제 DTO 로
 *   `validateSync` 해서 확인한다 — API 가 400 을 낼 값을 시드가 DB 에 넣으면
 *   "화면에는 있는데 다시 입력하면 거부되는 값"이 된다.
 * · 미래 시각을 만들지 않는다. 퇴원한 입원은 퇴원일까지만, 재원 중이면 now 까지만 기록한다.
 */

import type { Prisma } from '@prisma/client';
import { shiftOf, HANDOFF_ILLNESS_LABEL, type HandoffIllness } from '@hospital-run/shared';

import {
  CV_TAGS,
  CV_UUID_PREFIX,
  CvContext,
  TimeOrderRule,
  cvRandom,
  cvReport,
  cvUuid,
  intBetween,
  pickOne,
  round1,
  upsertArgs,
} from './clinical-volume-core';

// ─────────────────────────── 참조 데이터 ───────────────────────────

export interface CvAdmissionRef {
  id: string;
  patientId: string;
  admitDate: Date;
  dischargeDate: Date | null;
  admittingDoctorId: string;
}

export interface CvVisitRef {
  id: string;
  patientId: string;
  at: Date;
}

export interface NursingSeedContext extends CvContext {
  admissions: CvAdmissionRef[];
  /** 간호기록 컨텍스트로 쓸 외래 진료 */
  encounters: CvVisitRef[];
  /** 간호기록 컨텍스트로 쓸 응급 방문 */
  emergencyVisits: CvVisitRef[];
}

// ─────────────────────────── Flow Sheet ───────────────────────────

/** 근무별 기록 시각(시) — 이 시각이 `shiftOf` 판정과 어긋나면 가드가 잡는다 */
export const FLOWSHEET_HOURS = [10, 18, 2] as const;

/** 입원 1건당 최대 기록 일수 — 화면이 스크롤·필터를 보여줄 정도면 충분하다(전량은 자른다) */
export const FLOWSHEET_MAX_DAYS = 12;

export type FlowSheetRow = Prisma.FlowSheetEntryUncheckedCreateInput & { id: string };

/** AVPU — `icu-scores.computeNews2` 가 'ALERT' 만 정상으로 본다. 그 어휘를 그대로 쓴다. */
const AVPU = ['ALERT', 'ALERT', 'ALERT', 'ALERT', 'VERBAL', 'PAIN'] as const;

/**
 * 입원 환자 활력·I/O 기록.
 * 🔴 값은 **정상 근처에서 흔들리되** `CreateFlowSheetEntryDto` 범위 안이다.
 *    "spo2 9999 · temperature -50" 이 통과하던 시절의 데이터를 다시 만들지 않는다.
 */
export function buildFlowSheetEntries(ctx: NursingSeedContext): FlowSheetRow[] {
  const rows: FlowSheetRow[] = [];
  let idx = 0;
  for (const adm of ctx.admissions) {
    const end = adm.dischargeDate && adm.dischargeDate.getTime() < ctx.now.getTime() ? adm.dischargeDate : ctx.now;
    const spanDays = Math.floor((end.getTime() - adm.admitDate.getTime()) / 86_400_000);
    if (spanDays < 0) continue;
    const days = Math.min(spanDays + 1, FLOWSHEET_MAX_DAYS);
    // 최근 쪽을 남긴다 — 화면 기본 정렬이 최신순이라 오래된 것만 채우면 여전히 비어 보인다
    const firstDayOffset = Math.max(0, spanDays - days + 1);

    for (let d = 0; d < days; d++) {
      for (const hour of FLOWSHEET_HOURS) {
        const at = new Date(adm.admitDate.getTime() + (firstDayOffset + d) * 86_400_000);
        at.setHours(hour, 0, 0, 0);
        if (at.getTime() < adm.admitDate.getTime()) continue; // 입원 전 기록은 없다
        if (at.getTime() > end.getTime()) continue;           // 퇴원 후·미래 기록은 없다

        const r = cvRandom(`cv-flowsheet:${adm.id}:${d}:${hour}`);
        // 회복 추세 — 입원 초에 나쁘고 지나면서 좋아진다(모든 행이 같은 값이면 추세 화면이 죽는다)
        const acuity = Math.max(0, 1 - d / Math.max(1, days - 1));
        const feverish = r() < 0.18;

        const intakeOral = intBetween(r(), 100, 400);
        const intakeIv = intBetween(r(), 0, 500);
        const outputUrine = intBetween(r(), 150, 600);

        rows.push({
          id: cvUuid(CV_TAGS.flowSheetEntry, idx++),
          admissionId: adm.id,
          nurseId: ctx.nurses[idx % ctx.nurses.length],
          recordedAt: at,
          // 🔴 근무는 시각에서 나온다 — 정본 `shiftOf` 판정을 그대로 저장한다
          shiftType: shiftOf(at),
          systolicBp: intBetween(r(), 105, 138) + Math.round(acuity * 12),
          diastolicBp: intBetween(r(), 62, 86) + Math.round(acuity * 6),
          heartRate: intBetween(r(), 62, 92) + Math.round(acuity * 14),
          temperature: round1(36.3 + r() * 0.7 + (feverish ? 1.4 : 0)),
          spo2: 100 - intBetween(r(), 0, 4) - Math.round(acuity * 2),
          respiratoryRate: intBetween(r(), 14, 19) + Math.round(acuity * 3),
          consciousness: pickOne(AVPU, r()),
          painScore: Math.max(0, intBetween(r(), 0, 4) + Math.round(acuity * 3)),
          painLocation: r() < 0.4 ? '수술 부위' : null,
          intakeOral,
          intakeIv,
          intakeOther: 0,
          outputUrine,
          outputDrain: r() < 0.3 ? intBetween(r(), 10, 80) : 0,
          outputOther: 0,
          gcsScore: 15 - (r() < 0.08 ? intBetween(r(), 1, 3) : 0),
          notes: null,
        });
      }
    }
  }
  return rows;
}

// ─────────────────────────── 간호기록(SBAR) ───────────────────────────

/** 화면 정본 어휘 — `components/nursing/NursingNotePanel.tsx` 의 목록과 같아야 한다 */
export const NURSING_NOTE_TYPES = ['OBSERVATION', 'TREATMENT', 'MEDICATION', 'EDUCATION', 'ASSESSMENT'] as const;
export const NURSING_SEVERITIES = ['NORMAL', 'NORMAL', 'NORMAL', 'CAUTION', 'WARNING'] as const;

export type NursingNoteRow = Prisma.UniversalNursingNoteUncheckedCreateInput & { id: string };

/** 유형별 SBAR 본문 — 🔴 유형과 무관한 상수 문구를 돌려 쓰지 않는다 */
const SBAR_BY_TYPE: Record<string, { s: string; b: string; a: string; r: string }> = {
  OBSERVATION: {
    s: '[시연] 활력징후 정기 측정 및 전신 상태 관찰.',
    b: '[시연] 기저질환 관리 중이며 특이 알레르기 보고 없음.',
    a: '[시연] 활력징후 안정 범위. 통증 자가 조절 가능 수준.',
    r: '[시연] 근무조별 활력 재측정 유지, 변화 시 담당의 보고.',
  },
  TREATMENT: {
    s: '[시연] 처치 시행 및 시행 후 반응 관찰.',
    b: '[시연] 처치 전 환자 확인 2단계 및 동의 확인 완료.',
    a: '[시연] 처치 부위 발적·출혈 없음. 환자 불편감 호소 없음.',
    r: '[시연] 처치 부위 상태 재확인, 이상 시 즉시 보고.',
  },
  MEDICATION: {
    s: '[시연] 처방 약물 투여 및 투여 후 관찰.',
    b: '[시연] 투약 전 5R 확인. 최근 투약 관련 이상반응 기록 없음.',
    a: '[시연] 투여 후 즉시형 이상반응 관찰되지 않음.',
    r: '[시연] 다음 투여 시각까지 상태 관찰 유지.',
  },
  EDUCATION: {
    s: '[시연] 퇴원 후 자가관리 교육 시행.',
    b: '[시연] 보호자 동석. 이전 교육 이력 확인.',
    a: '[시연] 교육 내용 되짚기(teach-back) 가능 수준으로 이해.',
    r: '[시연] 퇴원 교육 자료 제공, 외래 방문 일정 안내.',
  },
  ASSESSMENT: {
    s: '[시연] 낙상·욕창 위험 재평가 시행.',
    b: '[시연] 이전 평가 이후 보행 상태 및 진정 약물 변화 확인.',
    a: '[시연] 위험 요인 변화 없음. 침상 난간 및 호출벨 접근성 확인.',
    r: '[시연] 평가 주기에 따라 재평가 예정, 위험 상승 시 조기 재평가.',
  },
};

export const NURSING_NOTE_DEFAULT_COUNT = 260;

/**
 * 외래·응급 컨텍스트 간호기록. 🔴 `contextType` 어휘는 화면(`NursingNotePanel`)이 아는 값만 쓴다 —
 * 화면이 모르는 컨텍스트를 넣으면 그 기록은 어느 탭에도 안 나오는 유령 행이 된다.
 */
export function buildNursingNotes(ctx: NursingSeedContext, count = NURSING_NOTE_DEFAULT_COUNT): NursingNoteRow[] {
  const contexts: { type: 'OUTPATIENT' | 'EMERGENCY'; ref: CvVisitRef }[] = [
    ...ctx.encounters.map((ref) => ({ type: 'OUTPATIENT' as const, ref })),
    ...ctx.emergencyVisits.map((ref) => ({ type: 'EMERGENCY' as const, ref })),
  ];
  if (!contexts.length || !ctx.nurses.length) return [];

  const rows: NursingNoteRow[] = [];
  for (let i = 0; i < count; i++) {
    const c = contexts[i % contexts.length];
    const r = cvRandom(`cv-nursing-note:${i}:${c.ref.id}`);
    const noteType = pickOne(NURSING_NOTE_TYPES, r());
    const recordedAt = new Date(c.ref.at.getTime() + intBetween(r(), 10, 240) * 60_000);
    if (recordedAt.getTime() > ctx.now.getTime()) continue;

    const sbar = SBAR_BY_TYPE[noteType];
    rows.push({
      id: cvUuid(CV_TAGS.nursingNote, i),
      patientId: c.ref.patientId,
      nurseId: ctx.nurses[i % ctx.nurses.length],
      contextType: c.type,
      contextId: c.ref.id,
      noteType,
      situation: sbar.s,
      background: sbar.b,
      assessment: sbar.a,
      recommendation: sbar.r,
      content: null,
      // 🔴 활력을 여기 또 적지 않는다 — 활력 정본은 Vital/FlowSheet 다(같은 사실에 정본이 둘이 된다)
      vitalSigns: undefined,
      severity: pickOne(NURSING_SEVERITIES, r()),
      shiftType: shiftOf(recordedAt),
      recordedAt,
      createdAt: recordedAt,
    });
  }
  return rows;
}

// ─────────────────────────── 인수인계(I-PASS) ───────────────────────────

export type HandoffRow = Prisma.ClinicalHandoffUncheckedCreateInput & { id: string };

/**
 * 🔴 (2026-10-04) 종전엔 한국어(`안정·주의·위중`)를 박았다 — 서버 DTO 어휘(`STABLE·UNSTABLE·CRITICAL`) 밖이라
 *    인수인계 화면이 시드 인계를 전부 "중증도 미기재"로 그렸다. 어휘 정본 shared `HANDOFF_ILLNESS` 의 코드를 쓴다.
 */
const ILLNESS = ['STABLE', 'STABLE', 'UNSTABLE', 'CRITICAL'] as const satisfies readonly HandoffIllness[];

export const HANDOFF_TIME_RULES: readonly TimeOrderRule[] = [['createdAt', 'acknowledgedAt']] as const;

/** 입원 1건당 인수인계 회수 상한 — 근무 교대분만 남긴다 */
export const HANDOFF_MAX_PER_ADMISSION = 6;

export function buildHandoffs(ctx: NursingSeedContext): HandoffRow[] {
  if (ctx.nurses.length < 2) return [];
  const rows: HandoffRow[] = [];
  let idx = 0;

  for (const adm of ctx.admissions) {
    const end = adm.dischargeDate && adm.dischargeDate.getTime() < ctx.now.getTime() ? adm.dischargeDate : ctx.now;
    for (let k = 0; k < HANDOFF_MAX_PER_ADMISSION; k++) {
      // 교대 시각(07/15/23)에 인계한다 — `shiftOf` 경계와 같은 시각이다
      const at = new Date(adm.admitDate.getTime() + k * 8 * 3_600_000);
      at.setMinutes(0, 0, 0);
      if (at.getTime() > end.getTime()) break;

      const r = cvRandom(`cv-handoff:${adm.id}:${k}`);
      const from = ctx.nurses[(idx * 2) % ctx.nurses.length];
      const to = ctx.nurses[(idx * 2 + 1) % ctx.nurses.length];
      const illness = pickOne(ILLNESS, r());
      // 인수 확인은 인계 뒤 0~40분. 🔴 아직 확인 안 된 건은 null 로 남긴다(확인을 흉내내지 않는다)
      const ackDelay = intBetween(r(), 0, 40);
      const acknowledgedAt = r() < 0.75 ? new Date(at.getTime() + ackDelay * 60_000) : null;

      rows.push({
        id: cvUuid(CV_TAGS.clinicalHandoff, idx++),
        // 간호사 → 간호사 교대 = NURSING_SHIFT(2026-10-26 — 종전 SHIFT_CHANGE 로 의사 교대와 섞여 간호 스테이션 "담당 인수" 단추를 못 받았다)
        type: 'NURSING_SHIFT',
        patientId: adm.patientId,
        admissionId: adm.id,
        fromDoctorId: from,
        toDoctorId: to,
        illness,
        patientSummary: `[시연] 재원 중 환자 인수인계 요약 (중증도: ${HANDOFF_ILLNESS_LABEL[illness]}).`,
        actionList: [
          { action: '활력징후 근무조별 측정', status: 'PENDING' },
          { action: '통증 조절 상태 확인', status: 'PENDING' },
        ] as Prisma.InputJsonValue,
        situationAwareness: '[시연] 야간 상태 악화 시 담당의 즉시 호출.',
        synthesis: '[시연] 인수자가 요약 내용을 되짚어 확인함.',
        summary: `[시연] 근무 교대 인수인계 — 중증도 ${HANDOFF_ILLNESS_LABEL[illness]}.`,
        pendingItems: undefined,
        vitalSigns: undefined,
        acknowledgedAt: acknowledgedAt && acknowledgedAt.getTime() <= ctx.now.getTime() ? acknowledgedAt : null,
        createdAt: at,
      });
    }
  }
  return rows;
}

// ─────────────────────────── 회진 ───────────────────────────

export type RoundRow = Prisma.RoundUncheckedCreateInput & { id: string };

/**
 * 회진 유형별 시각 창(시). 🔴 유형과 시각이 어긋나면(야간 회진이 오전 9시) 화면이 거짓말한다 —
 * 가드가 이 표로 검사한다.
 */
export const ROUND_WINDOWS: Record<string, readonly [number, number]> = {
  MORNING: [7, 11],
  EVENING: [16, 19],
  NIGHT: [22, 23],
};

export function buildRounds(ctx: NursingSeedContext): RoundRow[] {
  if (!ctx.doctors.length) return [];
  const rows: RoundRow[] = [];
  let idx = 0;

  for (const adm of ctx.admissions) {
    const end = adm.dischargeDate && adm.dischargeDate.getTime() < ctx.now.getTime() ? adm.dischargeDate : ctx.now;
    const spanDays = Math.floor((end.getTime() - adm.admitDate.getTime()) / 86_400_000);
    if (spanDays < 0) continue;
    const days = Math.min(spanDays + 1, FLOWSHEET_MAX_DAYS);
    const firstDayOffset = Math.max(0, spanDays - days + 1);

    for (let d = 0; d < days; d++) {
      // 아침 회진은 매일, 저녁 회진은 격일 — 전부 같은 패턴이면 회진 화면이 무의미하다
      const types = d % 2 === 0 ? ['MORNING', 'EVENING'] : ['MORNING'];
      for (const roundType of types) {
        const r = cvRandom(`cv-round:${adm.id}:${d}:${roundType}`);
        const [lo, hi] = ROUND_WINDOWS[roundType];
        const at = new Date(adm.admitDate.getTime() + (firstDayOffset + d) * 86_400_000);
        at.setHours(intBetween(r(), lo, hi), intBetween(r(), 0, 55), 0, 0);
        if (at.getTime() < adm.admitDate.getTime() || at.getTime() > end.getTime()) continue;

        rows.push({
          id: cvUuid(CV_TAGS.round, idx++),
          admissionId: adm.id,
          doctorId: ctx.doctors[idx % ctx.doctors.length],
          roundType,
          roundedAt: at,
          notes: '[시연] 회진 시 환자·보호자와 경과 및 계획 공유.',
          assessment: '[시연] 전신 상태 안정. 발열·호흡곤란 등 새로운 증상 없음.',
          plan: '[시연] 현 치료 유지, 검사 결과 확인 후 계획 재평가.',
          // 🔴 활력은 여기 복사하지 않는다 — flow sheet 가 정본이다
          vitalSigns: undefined,
          createdAt: at,
        });
      }
    }
  }
  return rows;
}

// ─────────────────────────── 실행 ───────────────────────────

async function main(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const admissionRows = await prisma.admission.findMany({
      select: { id: true, patientId: true, admitDate: true, dischargeDate: true, admittingDoctorId: true },
      where: { status: { in: ['ADMITTED', 'DISCHARGED'] } },
      orderBy: { admitDate: 'desc' },
    });
    // 🔴 `clinical-volume-inpatient.ts` 가 만든 입원은 **제외**한다.
    //    아래 생성기들의 id 는 이 목록의 **순번**에서 나온다(`cvUuid(tag, idx)`). 목록에 입원이
    //    하나만 늘어도 순번이 밀려, 이미 운영 DB 에 들어간 flow sheet·회진·인수인계 987행이
    //    재실행 때 **다른 id 로 통째로 다시 들어간다**(중복). 그 입원들의 간호 기록은
    //    inpatient 축이 자연키 id 로 책임진다 — 여기서 다시 세지 않는다.
    const admissions = admissionRows.filter((a) => !a.id.startsWith(CV_UUID_PREFIX));
    const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    const nurses = await prisma.user.findMany({ where: { role: 'NURSE' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    const encounters = await prisma.encounter.findMany({
      select: { id: true, patientId: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 150,
    });
    const emergencyVisits = await prisma.emergencyVisit.findMany({
      select: { id: true, patientId: true, arrivalAt: true }, orderBy: { arrivalAt: 'desc' }, take: 100,
    });

    if (!doctors.length || !nurses.length) {
      console.log('[clinical-volume:nursing] 의사/간호사 없음 — 메인 seed 먼저. 건너뜀');
      return;
    }

    const ctx: NursingSeedContext = {
      now,
      patients: [],
      doctors: doctors.map((d) => d.id),
      nurses: nurses.map((n) => n.id),
      admissions,
      encounters: encounters.map((e) => ({ id: e.id, patientId: e.patientId, at: e.createdAt })),
      emergencyVisits: emergencyVisits.map((v) => ({ id: v.id, patientId: v.patientId, at: v.arrivalAt })),
    };

    const flowsheets = buildFlowSheetEntries(ctx);
    const notes = buildNursingNotes(ctx);
    const handoffs = buildHandoffs(ctx);
    const rounds = buildRounds(ctx);

    for (const row of flowsheets) await prisma.flowSheetEntry.upsert(upsertArgs(row));
    for (const row of notes) await prisma.universalNursingNote.upsert(upsertArgs(row));
    for (const row of handoffs) await prisma.clinicalHandoff.upsert(upsertArgs(row));
    for (const row of rounds) await prisma.round.upsert(upsertArgs(row));

    cvReport('nursing', {
      flowSheetEntries: flowsheets.length,
      nursingNotes: notes.length,
      handoffs: handoffs.length,
      rounds: rounds.length,
    });
    if (!admissions.length) console.log('[clinical-volume:nursing] 입원이 없어 flow sheet·회진·인수인계는 0건이다(시드 부재가 아니라 입원 부재)');
    const skipped = admissionRows.length - admissions.length;
    if (skipped > 0) console.log(`[clinical-volume:nursing] inpatient 축이 만든 입원 ${skipped}건은 제외했다(id 순번이 밀리면 기존 행이 중복된다)`);
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
