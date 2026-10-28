import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 임상 볼륨 확장 — 중환자·응급(코드블루 · RRT · ICU 재원이력 · 응급 처분/재평가) · 실행:
 *
 *   cd apps/api && npx ts-node --transpile-only prisma/seeds/clinical-volume-critical.ts
 *
 * 전제: 메인 `prisma/seed.ts`(환자·직원·ICU 병상·응급 방문). 멱등: 결정적 UUID·자연키 upsert.
 *
 * ── 왜 이 축인가 ────────────────────────────────────────────────────────
 * 운영 실측(2026-08-18): `code_blue_events` 1 · `rrt_activations` 1 · `icu_admissions` 3 ·
 * `emergency_dispositions` 2(응급 방문 150건 중 **148건이 처분 기록 없음**) ·
 * `emergency_reassessments` **0**. 응급·중환자 화면은 임상 위험이 가장 높은데 전부 비어 있다.
 *
 * ── 🔴 정본을 부른다 ────────────────────────────────────────────────────
 * · RRT 발동 사유가 `NEWS2` 인 건은 **활력에서 실제로 NEWS2 를 계산해** 고위험일 때만 쓴다
 *   (shared `scoreNews2` 정본 — 2026-08-19 수렴 전에는 ICU 판을 불렀고 그 판은 밴드가 달랐다).
 *   사유 라벨만 붙이면 "NEWS2 때문에 불렀다"는
 *   기록이 활력과 어긋난다 — 화면에서 근거를 열면 거짓이 드러난다.
 * · 응급 재평가의 등급은 Prisma `KtasLevel` 어휘를 그대로 쓴다.
 *
 * ── 🔴 하지 않는 것 ─────────────────────────────────────────────────────
 * · **재원 중(ADMITTED) ICU 입실을 만들지 않는다.** ICU 입실은 병상을 OCCUPIED 로 선점하는
 *   트랜잭션이라(`icu.service.admit`), 시드가 입실행만 넣으면 병상 점유와 어긋나 이중 점유가 된다.
 *   여기서는 **퇴실 완료(DISCHARGED) 이력**만 만든다 — 그건 병상을 점유하지 않는다.
 * · 처분(disposition)은 `visitId @unique` 라 방문당 1건이다. 자연키로 upsert 한다.
 */

import type { Prisma } from '@prisma/client';

import { scoreNews2 } from '@hospital-run/shared';
import {
  CV_TAGS,
  CvContext,
  TimeOrderRule,
  cvRandom,
  cvReport,
  cvUuid,
  cvUuidKey,
  intBetween,
  pickOne,
  plusMinutes,
  round1,
  upsertArgs,
  withoutId,
} from './clinical-volume-core';

// ─────────────────────────── 참조 데이터 ───────────────────────────

export interface CvEmergencyVisitRef {
  id: string;
  patientId: string;
  arrivalAt: Date;
  triageLevel: string;
  status: string;
  doctorId: string | null;
  /** 이미 처분 기록이 있는가 — 있으면 건드리지 않는다 */
  hasDisposition: boolean;
}

export interface CvIcuBedRef {
  id: string;
  unitName: string;
  bedNumber: string;
}

export interface CriticalSeedContext extends CvContext {
  emergencyVisits: CvEmergencyVisitRef[];
  icuBeds: CvIcuBedRef[];
}

// ─────────────────────────── 코드블루 ───────────────────────────

export type CodeBlueRow = Prisma.CodeBlueEventUncheckedCreateInput & { id: string };

export const CODE_BLUE_TIME_RULES: readonly TimeOrderRule[] = [
  ['recognizedAt', 'teamArrivedAt'],
  ['recognizedAt', 'cprStartedAt'],
  ['cprStartedAt', 'roscAt'],
  ['roscAt', 'endedAt'],
  ['teamArrivedAt', 'endedAt'],
] as const;

const CODE_BLUE_LOCATIONS = [
  '3층 내과병동 305호', '4층 외과병동 412호', '5층 소아/산부병동 508호',
  '6층 정형외과병동 604호', '응급실 처치실 2', '영상의학과 CT실', '중환자실 A-3',
] as const;

export const CODE_BLUE_DEFAULT_COUNT = 26;

/**
 * 코드블루. 🔴 결과(outcome)와 시각이 서로 맞아야 한다 —
 *   ROSC → `roscAt` 있음 · DEATH → `roscAt` **없음** · ONGOING → `endedAt` 없음.
 * 결과만 적고 시각을 아무렇게나 넣으면 소생 통계가 통째로 거짓이 된다.
 */
export function buildCodeBlueEvents(ctx: CriticalSeedContext, count = CODE_BLUE_DEFAULT_COUNT): CodeBlueRow[] {
  if (!ctx.patients.length || !ctx.doctors.length) return [];
  const rows: CodeBlueRow[] = [];

  for (let i = 0; i < count; i++) {
    const r = cvRandom(`cv-codeblue:${i}`);
    const patient = ctx.patients[i % ctx.patients.length];
    // 최근 180일 안에 분포시킨다(전부 오늘이면 추이 화면이 죽는다)
    const recognizedAt = new Date(ctx.now.getTime() - intBetween(r(), 1, 180) * 86_400_000 - intBetween(r(), 0, 23) * 3_600_000);
    const teamArrivedAt = plusMinutes(recognizedAt, intBetween(r(), 1, 5));
    const cprStartedAt = plusMinutes(recognizedAt, intBetween(r(), 0, 2));

    // 실제 소생률에 가깝게: 약 절반이 ROSC, 일부 사망, 일부 이송
    const roll = r();
    const outcome: 'ROSC' | 'DEATH' | 'TRANSFER' = roll < 0.5 ? 'ROSC' : roll < 0.78 ? 'TRANSFER' : 'DEATH';
    const cprMinutes = intBetween(r(), 6, 34);
    const roscAt = outcome === 'DEATH' ? null : plusMinutes(cprStartedAt, cprMinutes);
    const endedAt = plusMinutes(cprStartedAt, cprMinutes + intBetween(r(), 3, 20));
    if (endedAt.getTime() > ctx.now.getTime()) continue;

    rows.push({
      id: cvUuid(CV_TAGS.codeBlue, i),
      patientId: patient.id,
      location: pickOne(CODE_BLUE_LOCATIONS, r()),
      recognizedAt,
      teamArrivedAt,
      cprStartedAt,
      roscAt,
      endedAt,
      defibrillationCount: outcome === 'DEATH' ? intBetween(r(), 0, 4) : intBetween(r(), 0, 3),
      outcome,
      medications: undefined,
      notes: `[시연] 코드블루 대응 기록 — CPR ${cprMinutes}분.`,
      recordedBy: ctx.doctors[i % ctx.doctors.length],
      createdAt: endedAt,
      updatedAt: endedAt,
    });
  }
  return rows;
}

// ─────────────────────────── RRT(신속대응팀) ───────────────────────────

export type RrtRow = Prisma.RrtActivationUncheckedCreateInput & { id: string };

export const RRT_TIME_RULES: readonly TimeOrderRule[] = [['activatedAt', 'respondedAt']] as const;

export const RRT_DEFAULT_COUNT = 34;

/** 발동 시점의 활력 — NEWS2 산출 근거이자 사유 판정의 원자료 */
export interface RrtVitalSnapshot {
  respiratoryRate: number;
  spo2: number;
  systolicBp: number;
  heartRate: number;
  temperature: number;
  consciousness: string;
  /** 🔴 NEWS2 7요소 중 하나 — 관측을 시드가 명시한다. 없으면 정본이 산출을 거부한다(가정하지 않는다) */
  supplementalO2: boolean;
}

export interface RrtSeedRow {
  row: RrtRow;
  /** 가드가 사유↔활력 일치를 검사하기 위해 원자료를 함께 낸다 */
  vitals: RrtVitalSnapshot;
  news2: number;
}

/**
 * 🔴 사유는 활력에서 나온다. `computeNews2` 로 실제 점수를 낸 뒤
 *    **고위험(score ≥ 7)일 때만** trigger 를 `NEWS2` 로 적는다. 그 외는 `DIRECT_CALL`·`FAMILY`.
 *    라벨만 붙이면 "NEWS2 때문에 불렀다"는 기록이 활력과 어긋난다.
 */
export function buildRrtActivations(ctx: CriticalSeedContext, count = RRT_DEFAULT_COUNT): RrtSeedRow[] {
  if (!ctx.patients.length || !ctx.doctors.length) return [];
  const out: RrtSeedRow[] = [];

  for (let i = 0; i < count; i++) {
    const r = cvRandom(`cv-rrt:${i}`);
    const patient = ctx.patients[i % ctx.patients.length];
    const severe = r() < 0.55; // 절반 이상은 실제로 악화된 활력을 갖는다

    const vitals: RrtVitalSnapshot = severe
      ? {
          respiratoryRate: intBetween(r(), 25, 32),
          spo2: intBetween(r(), 86, 92),
          systolicBp: intBetween(r(), 78, 98),
          heartRate: intBetween(r(), 112, 138),
          temperature: round1(38.2 + r() * 1.4),
          // 구 AVPU 'VERBAL' 을 일부러 남긴다 — 정본이 어휘를 접는지 시드로도 확인된다
          consciousness: r() < 0.5 ? 'VERBAL' : 'ALERT',
          supplementalO2: r() < 0.7, // 악화 환자 다수는 산소 투여 중
        }
      : {
          respiratoryRate: intBetween(r(), 18, 23),
          spo2: intBetween(r(), 93, 97),
          systolicBp: intBetween(r(), 104, 128),
          heartRate: intBetween(r(), 88, 108),
          temperature: round1(36.8 + r() * 1.0),
          consciousness: 'ALERT',
          supplementalO2: false,
        };

    // 🔴 정본이 산출을 거부하면(관측 부족) 그 행은 만들지 않는다 — 점수 없는 근거를 적지 않는다
    const scored = scoreNews2({ ...vitals, spO2: vitals.spo2 });
    if (!scored) continue;
    const news2 = scored.totalScore;
    const trigger: 'NEWS2' | 'DIRECT_CALL' | 'FAMILY' = news2 >= 7 ? 'NEWS2' : r() < 0.75 ? 'DIRECT_CALL' : 'FAMILY';

    const activatedAt = new Date(ctx.now.getTime() - intBetween(r(), 1, 150) * 86_400_000 - intBetween(r(), 0, 23) * 3_600_000);
    const respondedAt = plusMinutes(activatedAt, intBetween(r(), 2, 12));
    if (respondedAt.getTime() > ctx.now.getTime()) continue;

    // 결과도 중증도를 따른다 — 안정한 활력에서 ICU 전실이 쏟아지면 지표가 거짓이 된다
    const outcome: 'WARD_STAY' | 'ICU_TRANSFER' | 'CODE_BLUE' | 'DECEASED' = severe
      ? (r() < 0.55 ? 'ICU_TRANSFER' : r() < 0.85 ? 'WARD_STAY' : 'CODE_BLUE')
      : (r() < 0.85 ? 'WARD_STAY' : 'ICU_TRANSFER');

    out.push({
      vitals,
      news2,
      row: {
        id: cvUuid(CV_TAGS.rrtActivation, i),
        patientId: patient.id,
        trigger,
        activatedAt,
        respondedAt,
        responderTeam: pickOne(['RRT-A', 'RRT-B', 'RRT-야간'], r()),
        outcome,
        reason:
          trigger === 'NEWS2'
            ? `[시연] NEWS2 ${news2}점 — RR ${vitals.respiratoryRate}/min · SpO2 ${vitals.spo2}% · SBP ${vitals.systolicBp}mmHg`
            : '[시연] 병동 간호사 직접 호출 — 전신 상태 악화 우려',
        recordedBy: ctx.doctors[i % ctx.doctors.length],
        createdAt: activatedAt,
        updatedAt: respondedAt,
      },
    });
  }
  return out;
}

// ─────────────────────────── ICU 재원 이력 ───────────────────────────

export type IcuAdmissionRow = Prisma.IcuAdmissionUncheckedCreateInput & { id: string };

export const ICU_TIME_RULES: readonly TimeOrderRule[] = [['admitDate', 'dischargeDate']] as const;

export const ICU_DEFAULT_COUNT = 22;

const ICU_REASONS = [
  '[시연] 폐렴에 의한 급성 호흡부전 — 산소요법 및 감시',
  '[시연] 수술 후 혈역학 감시 목적 입실',
  '[시연] 패혈증 의심 — 승압제 및 집중 감시',
  '[시연] 중증 외상 후 감시',
  '[시연] 급성 신부전 — 신대체요법 준비',
  '[시연] 의식 저하 — 기도 보호 및 신경학적 감시',
] as const;

/** 🔴 퇴실 완료 이력만 만든다(병상 점유와 어긋나지 않게) */
export function buildIcuAdmissions(ctx: CriticalSeedContext, count = ICU_DEFAULT_COUNT): IcuAdmissionRow[] {
  if (!ctx.patients.length || !ctx.icuBeds.length || !ctx.doctors.length) return [];
  const rows: IcuAdmissionRow[] = [];

  for (let i = 0; i < count; i++) {
    const r = cvRandom(`cv-icu:${i}`);
    const patient = ctx.patients[(i * 7) % ctx.patients.length];
    const stayDays = intBetween(r(), 1, 12);
    const admitDate = new Date(ctx.now.getTime() - intBetween(r(), stayDays + 1, 200) * 86_400_000);
    const dischargeDate = new Date(admitDate.getTime() + stayDays * 86_400_000 + intBetween(r(), 0, 20) * 3_600_000);
    if (dischargeDate.getTime() > ctx.now.getTime()) continue;

    const severity = r() < 0.3 ? 'CRITICAL' : r() < 0.7 ? 'SEVERE' : 'MODERATE';
    rows.push({
      id: cvUuid(CV_TAGS.icuAdmission, i),
      patientId: patient.id,
      icuBedId: ctx.icuBeds[i % ctx.icuBeds.length].id,
      doctorId: ctx.doctors[i % ctx.doctors.length],
      admitDate,
      dischargeDate,
      admitReason: pickOne(ICU_REASONS, r()),
      // 인공호흡기·격리는 중증도를 따른다(경증에 인공호흡기가 붙으면 지표가 거짓이 된다)
      ventilator: severity === 'CRITICAL' ? r() < 0.8 : severity === 'SEVERE' ? r() < 0.35 : false,
      isolation: r() < 0.18,
      severity,
      status: 'DISCHARGED',
      createdAt: admitDate,
      updatedAt: dischargeDate,
    });
  }
  return rows;
}

// ─────────────────────────── 응급 처분 ───────────────────────────

export type EmergencyDispositionRow = Prisma.EmergencyDispositionRecordUncheckedCreateInput & { id: string };

export const DISPOSITION_TIME_RULES: readonly TimeOrderRule[] = [['decidedAt', 'followUpDate']] as const;

/** 서버 DTO(`EmergencyDispositionFull`)가 아는 값만 쓴다 — 화면이 모르는 처분은 어느 필터에도 안 걸린다 */
const DISPOSITIONS = ['DISCHARGE', 'DISCHARGE', 'DISCHARGE', 'ADMISSION', 'OBSERVATION', 'TRANSFER', 'LEAVE_AMA'] as const;

/**
 * 종결된 응급 방문에 처분 기록을 붙인다.
 * 🔴 이미 처분이 있는 방문은 건드리지 않는다(`visitId @unique` · 남의 기록을 덮지 않는다).
 * 🔴 KTAS 1~2 는 귀가 비중이 낮아야 한다 — 중증도와 처분이 어긋나면 응급 지표가 통째로 거짓이 된다.
 */
export function buildEmergencyDispositions(ctx: CriticalSeedContext): EmergencyDispositionRow[] {
  const rows: EmergencyDispositionRow[] = [];
  for (const visit of ctx.emergencyVisits) {
    if (visit.hasDisposition) continue;
    if (visit.status !== 'COMPLETED') continue; // 진행 중인 방문에 처분을 박지 않는다
    const r = cvRandom(`cv-disposition:${visit.id}`);

    const severe = visit.triageLevel === 'LEVEL_1' || visit.triageLevel === 'LEVEL_2';
    const disposition = severe
      ? (r() < 0.62 ? 'ADMISSION' : r() < 0.85 ? 'OBSERVATION' : 'TRANSFER')
      : pickOne(DISPOSITIONS, r());

    const decidedAt = new Date(visit.arrivalAt.getTime() + intBetween(r(), 45, 480) * 60_000);
    if (decidedAt.getTime() > ctx.now.getTime()) continue;

    const followUpDate =
      disposition === 'DISCHARGE' ? new Date(decidedAt.getTime() + intBetween(r(), 3, 14) * 86_400_000) : null;

    rows.push({
      id: cvUuidKey(CV_TAGS.emergencyDisposition, visit.id),
      visitId: visit.id,
      disposition,
      decidedBy: visit.doctorId ?? ctx.doctors[rows.length % ctx.doctors.length],
      decidedAt,
      dischargeInstructions:
        disposition === 'DISCHARGE'
          ? '[시연] 증상 악화(고열·호흡곤란·의식 변화) 시 즉시 재내원. 처방 약물 복용법 안내함.'
          : null,
      // 🔴 추적 예약일은 **미래일 수 있다** — 예약은 앞날의 계획이지 기록된 사실이 아니다.
      //    그래서 이 필드만은 미래 금지 규칙에서 제외한다(가드도 이 필드를 예외로 안다).
      followUpDate,
      admissionId: null,
      transferTo: disposition === 'TRANSFER' ? '[시연] 상급종합병원(전원 협의 완료)' : null,
      transferReason: disposition === 'TRANSFER' ? '[시연] 원내 미보유 전문 진료 필요' : null,
    });
  }
  return rows;
}

// ─────────────────────────── 응급 재평가 ───────────────────────────

export type EmergencyReassessmentRow = Prisma.EmergencyReassessmentUncheckedCreateInput & { id: string };

/** Prisma `KtasLevel` 어휘 — 시드가 'KTAS-2' 같은 자기 표기를 쓰면 등급 필터에서 사라진다 */
export const KTAS_LEVELS = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5'] as const;

/**
 * 재평가 — 등급이 **올라가거나 내려간다**. 🔴 `previousLevel === newLevel` 인 행은 만들지 않는다
 * (재평가인데 아무것도 안 바뀐 기록은 화면에서 의미가 없고, 등급 변동 통계를 부풀린다).
 */
export function buildEmergencyReassessments(ctx: CriticalSeedContext): EmergencyReassessmentRow[] {
  const rows: EmergencyReassessmentRow[] = [];
  let n = 0;

  for (const visit of ctx.emergencyVisits) {
    const r = cvRandom(`cv-reassess:${visit.id}`);
    if (r() > 0.42) continue; // 모든 방문이 재평가되지는 않는다
    const prevIdx = KTAS_LEVELS.indexOf(visit.triageLevel as (typeof KTAS_LEVELS)[number]);
    if (prevIdx < 0) continue;

    // 악화(등급 숫자 감소) 60% · 호전(증가) 40%
    const worsen = r() < 0.6;
    const newIdx = worsen ? Math.max(0, prevIdx - 1) : Math.min(KTAS_LEVELS.length - 1, prevIdx + 1);
    if (newIdx === prevIdx) continue;

    const assessedAt = new Date(visit.arrivalAt.getTime() + intBetween(r(), 20, 300) * 60_000);
    if (assessedAt.getTime() > ctx.now.getTime()) continue;

    rows.push({
      id: cvUuidKey(CV_TAGS.emergencyReassessment, `${visit.id}:1`),
      visitId: visit.id,
      previousLevel: KTAS_LEVELS[prevIdx],
      newLevel: KTAS_LEVELS[newIdx],
      reason: worsen
        ? '[시연] 재평가 시 활력징후 악화 확인 — 응급도 상향'
        : '[시연] 처치 후 증상 호전 확인 — 응급도 하향',
      // 🔴 활력 스냅샷은 여기 지어내지 않는다. 재평가 시점 활력의 정본은 EmergencyVisit.vitalSigns 다.
      vitals: undefined,
      assessedBy: ctx.nurses[n % ctx.nurses.length],
      assessedAt,
    });
    n++;
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
    const icuBeds = await prisma.icuBed.findMany({ select: { id: true, unitName: true, bedNumber: true }, orderBy: { bedNumber: 'asc' } });
    const visits = await prisma.emergencyVisit.findMany({
      select: {
        id: true, patientId: true, arrivalAt: true, triageLevel: true, status: true, doctorId: true,
        dispositionRecord: { select: { id: true } },
      },
      orderBy: { arrivalAt: 'desc' },
    });
    if (!patients.length || !doctors.length || !nurses.length) {
      console.log('[clinical-volume:critical] 환자/의사/간호사 없음 — 메인 seed 먼저. 건너뜀');
      return;
    }

    const ctx: CriticalSeedContext = {
      now,
      patients: patients.map((p) => ({ id: p.id, dateOfBirth: p.dateOfBirth, gender: p.gender })),
      doctors: doctors.map((d) => d.id),
      nurses: nurses.map((n) => n.id),
      icuBeds,
      emergencyVisits: visits.map((v) => ({
        id: v.id, patientId: v.patientId, arrivalAt: v.arrivalAt,
        triageLevel: v.triageLevel, status: v.status, doctorId: v.doctorId,
        hasDisposition: !!v.dispositionRecord,
      })),
    };

    const codeBlues = buildCodeBlueEvents(ctx);
    const rrts = buildRrtActivations(ctx);
    const icu = buildIcuAdmissions(ctx);
    const dispositions = buildEmergencyDispositions(ctx);
    const reassessments = buildEmergencyReassessments(ctx);

    for (const row of codeBlues) await prisma.codeBlueEvent.upsert(upsertArgs(row));
    for (const x of rrts) await prisma.rrtActivation.upsert(upsertArgs(x.row));
    for (const row of icu) await prisma.icuAdmission.upsert(upsertArgs(row));
    // 🔴 1:1 테이블은 자연키로 맞춘다 — 순번 id 로 upsert 하면 방문 목록이 바뀔 때 유니크 위반이 난다
    for (const row of dispositions) {
      await prisma.emergencyDispositionRecord.upsert({ where: { visitId: row.visitId }, create: row, update: withoutId(row) });
    }
    for (const row of reassessments) await prisma.emergencyReassessment.upsert(upsertArgs(row));

    cvReport('critical', {
      codeBlueEvents: codeBlues.length,
      rrtActivations: rrts.length,
      icuAdmissions: icu.length,
      emergencyDispositions: dispositions.length,
      emergencyReassessments: reassessments.length,
    });
    if (!icuBeds.length) console.log('[clinical-volume:critical] ICU 병상이 없어 ICU 이력 0건(시드 부재가 아니라 병상 부재)');
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
