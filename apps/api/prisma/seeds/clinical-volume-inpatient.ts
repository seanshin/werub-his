import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 임상 볼륨 확장 — 입원 축(간호기록 · 투약 실시(MAR) · 퇴원 완료 입원 이력) · 실행:
 *
 *   cd apps/api && npx ts-node --transpile-only prisma/seeds/clinical-volume-inpatient.ts
 *
 * 전제: 메인 `prisma/seed.ts`. 멱등: 결정적 UUID(자연키 파생) + `upsertArgs`(update:{} 금지).
 *
 * ── 왜 이 축인가 (2026-08-18 재실측) ────────────────────────────────────
 * 앞선 `clinical-volume-nursing.ts` 가 채운 것은 **`universal_nursing_notes`** 였다.
 * 입원 병동이 읽는 것은 **`nursing_notes`**(입원 전용·`admissionId` 필수)라 병동 화면은 그대로 비었다.
 *   · `nursing_notes` 최신 2026-08-03(15일 정지) · ADMITTED 5건 중 **1건은 간호기록 0건**
 *   · `medication_administrations` 최신 2026-06-09(70일 정지)
 *   · `admissions` 최신 입원일 2026-07-10(39일 정지)
 * 화면에서 읽으면 "환자 5명이 39일째 재원 중인데 두 달 넘게 약이 나간 기록이 없다"가 된다.
 *
 * ── 🔴 새 입원을 만들지 않는 곳 ─────────────────────────────────────────
 * **재원 중(ADMITTED) 입원은 만들지 않는다.** 입원은 병상을 점유하는 트랜잭션이라
 * 시드가 입원행만 넣으면 `beds.status` 와 어긋나 이중 점유가 된다(ICU 입실에서 판단한 것과 같다).
 * 신규는 **퇴원 완료(DISCHARGED)** 건만 만든다 — 그건 병상을 점유하지 않는다.
 *
 * ── 🔴 MAR 은 처방과 이어진다 ───────────────────────────────────────────
 * 투약 실시는 "그 약이 처방됐고 그 시각에 실제로 줬다"는 **두 겹의 주장**이다.
 * 그래서 이 시드는 MAR 만 심지 않고 진료(Encounter) → 처방(Prescription) → 약제 오더(Order) →
 * 실시(MedicationAdministration) 사슬을 통째로 만든다. 대응 처방이 없으면 MAR 도 없다.
 *
 * 🔴 **마약류·향정·고위험 약물은 실시 기록을 만들지 않는다.** 이중확인·잔량 폐기·NIMS 보고가
 *    따라붙는 법정 기록이라 시드가 흉내낼 대상이 아니다. 게다가 운영 DB 실측에서
 *    **`narcotic_type` 플래그만 믿으면 안 된다**는 것이 드러났다 —
 *    `acetaminophen+hydrocodone`(마약 복합제)·`acetaminophen+tramadol` 제제가 `narcotic_type IS NULL`
 *    로 등재돼 플래그 필터를 그대로 통과한다(큐레이션 미완). 그래서 여기서는
 *    **플래그 필터 + 단일성분 정확 일치 허용목록 + 성분명 금지어**를 3중으로 건다.
 *
 * ── 🔴 기존 `clinical-volume-nursing.ts` 의 id 를 지킨다 ────────────────
 * 그 파일의 flow sheet·회진·인수인계 id 는 **입원 목록 순번**에서 나온다. 입원을 추가하면
 * 순번이 밀려 이미 운영에 들어간 987행이 재실행 때 **통째로 중복**된다. 그래서
 * `clinical-volume-nursing.ts` 는 **이 축이 만든 입원을 제외**하고 돌도록 했고(런너 필터),
 * 여기서 만드는 입원의 간호 기록은 전부 이 파일이 책임진다.
 * 이 파일의 id 는 전부 **자연키 파생**(`cvUuidKey`)이라 목록 순서에 흔들리지 않는다.
 */

import type { Prisma } from '@prisma/client';
import { shiftOf } from '@hospital-run/shared';

import {
  CV_TAGS,
  CV_UUID_PREFIX,
  CvContext,
  CvPatientRef,
  TimeOrderRule,
  cvRandom,
  cvReport,
  cvUuidKey,
  intBetween,
  pickOne,
  upsertArgs,
} from './clinical-volume-core';

// ─────────────────────────── 참조 데이터 ───────────────────────────

export interface CvInpatientAdmissionRef {
  id: string;
  patientId: string;
  admitDate: Date;
  dischargeDate: Date | null;
  attendingDoctorId: string;
}

export interface CvMedRef {
  id: string;
  code: string;
  nameKo: string;
  ingredient: string | null;
  narcoticType: string | null;
  controlSchedule: string | null;
  highAlertFlag: boolean;
  aspRestrictedLevel: string | null;
}

export interface InpatientSeedContext extends CvContext {
  /** 이미 존재하는 입원(재원 + 퇴원) — 간호기록을 붙일 대상 */
  admissions: CvInpatientAdmissionRef[];
  /** 입원 이력이 없는 환자 — 신규 퇴원 완료 건의 대상 */
  unadmittedPatients: CvPatientRef[];
  /** 사용 가능한 병상 id */
  beds: string[];
  /** 안전 필터를 통과한 약품 마스터 */
  meds: CvMedRef[];
}

// ─────────────────────── 🔴 투약 안전 필터 ───────────────────────

/**
 * 실시 기록을 만들어도 되는 **단일 성분 정확 일치** 허용목록.
 * 🔴 부분 일치(`ilike 'acetaminophen%'`)를 쓰면 `acetaminophen+hydrocodone` 같은 마약 복합제가
 *    걸려 들어온다(운영 실측). 정확 일치만 인정한다.
 */
export const MAR_ALLOWED_INGREDIENTS = [
  'Acetaminophen',
  'Ceftriaxone',
  'Famotidine',
  'Ibuprofen',
  'Levofloxacin',
  'Metoclopramide',
] as const;

/**
 * 성분·품명에 이 단어가 들어가면 **무조건 제외**한다(플래그 큐레이션을 믿지 않는 마지막 방어선).
 * 마약성 진통제·향정·고위험 약물 계열.
 */
export const MAR_DENY_SUBSTRINGS = [
  'morphine', 'fentanyl', 'oxycodone', 'hydrocodone', 'codeine', 'pethidine', 'meperidine',
  'tramadol', 'buprenorphine', 'methadone', 'remifentanil', 'sufentanil', 'nalbuphine',
  'midazolam', 'diazepam', 'lorazepam', 'alprazolam', 'zolpidem', 'phenobarbital', 'ketamine',
  'propofol', 'insulin', 'heparin', 'warfarin', 'potassium chloride', 'digoxin', 'methotrexate',
  '마약', '향정',
] as const;

/** 약품 1건이 실시 기록 생성 대상인가 — 플래그·허용목록·금지어 3중 검사 */
export function isMarSafeMedication(med: CvMedRef): boolean {
  if (med.narcoticType) return false;
  if (med.controlSchedule) return false;
  if (med.highAlertFlag) return false;
  if (med.aspRestrictedLevel) return false;
  const ingredient = (med.ingredient ?? '').trim();
  if (!MAR_ALLOWED_INGREDIENTS.includes(ingredient as (typeof MAR_ALLOWED_INGREDIENTS)[number])) return false;
  const hay = `${ingredient} ${med.nameKo}`.toLowerCase();
  return !MAR_DENY_SUBSTRINGS.some((w) => hay.includes(w));
}

// ─────────────────── 신규 입원(퇴원 완료 건) ───────────────────

export type AdmissionRow = Prisma.AdmissionUncheckedCreateInput & { id: string };

export const ADMISSION_TIME_RULES: readonly TimeOrderRule[] = [['admitDate', 'dischargeDate']] as const;

const ADMIT_REASONS = [
  { reason: '[시연] 폐렴 — 정맥 항생제 및 산소요법', summary: '[시연] 항생제 치료 후 발열 소실 및 산소포화도 회복. 경구 항생제로 전환하여 퇴원.' },
  { reason: '[시연] 급성 위장염 — 탈수 교정', summary: '[시연] 수액 및 대증 치료 후 경구 섭취 가능. 탈수 소견 없이 퇴원.' },
  { reason: '[시연] 복강경 담낭절제술 후 관찰', summary: '[시연] 수술 후 경과 양호. 창상 이상 없이 퇴원, 외래 추적 예정.' },
  { reason: '[시연] 요로감염 — 정맥 항생제', summary: '[시연] 배양 결과에 따른 항생제 치료 완료. 발열 소실 후 퇴원.' },
  { reason: '[시연] 흉통 감별 — 관찰 입원', summary: '[시연] 연속 심전도 및 효소 검사에서 허혈 소견 없음. 외래 추적 조건으로 퇴원.' },
  { reason: '[시연] 당뇨 조절 및 교육', summary: '[시연] 혈당 조절 및 자가관리 교육 완료. 외래 추적 예정.' },
] as const;

const DIETS = ['일반식', '당뇨식', '연식', '저염식'] as const;

export const NEW_ADMISSION_COUNT = 12;

/**
 * 최근 6주 구간의 **퇴원 완료** 입원 이력.
 * 🔴 병상 충돌을 만들지 않는다 — 입원 1건당 서로 다른 병상을 쓰고(같은 병상에 겹치는 재원 기간이
 *    생기지 않는다), 전부 퇴원 상태라 현재 점유에도 영향이 없다.
 * 🔴 입원 이력이 없는 환자만 고른다 — 같은 환자가 두 입원에 동시에 들어 있으면 재원일수·병상
 *    가동률이 통째로 거짓이 된다.
 */
export function buildDischargedAdmissions(ctx: InpatientSeedContext, count = NEW_ADMISSION_COUNT): AdmissionRow[] {
  if (!ctx.unadmittedPatients.length || !ctx.beds.length || !ctx.doctors.length) return [];
  const n = Math.min(count, ctx.unadmittedPatients.length, ctx.beds.length);
  const rows: AdmissionRow[] = [];

  for (let i = 0; i < n; i++) {
    const patient = ctx.unadmittedPatients[i];
    const r = cvRandom(`cv-admission:${patient.id}`);
    const spec = pickOne(ADMIT_REASONS, r());
    const los = intBetween(r(), 2, 9);
    // 퇴원일이 오늘 안쪽에 들어오도록 입원일을 잡는다 — 미래 퇴원은 만들지 않는다
    const dischargeDaysAgo = intBetween(r(), 0, 40 - los);
    const dischargeDate = new Date(ctx.now.getTime() - dischargeDaysAgo * 86_400_000);
    dischargeDate.setHours(intBetween(r(), 10, 15), pickOne([0, 30], r()), 0, 0);
    const admitDate = new Date(dischargeDate.getTime() - los * 86_400_000);
    if (dischargeDate.getTime() > ctx.now.getTime()) continue;

    const doctorId = ctx.doctors[i % ctx.doctors.length];
    rows.push({
      id: cvUuidKey(CV_TAGS.admission, patient.id),
      patientId: patient.id,
      bedId: ctx.beds[i % ctx.beds.length],
      admittingDoctorId: doctorId,
      attendingDoctorId: doctorId,
      admitDate,
      dischargeDate,
      expectedDischargeDate: dischargeDate,
      status: 'DISCHARGED',
      admitReason: spec.reason,
      dischargeSummary: spec.summary,
      dietType: pickOne(DIETS, r()),
      createdAt: admitDate,
      updatedAt: dischargeDate,
    });
  }
  return rows;
}

// ─────────────────── 입원 간호기록(nursing_notes) ───────────────────

export type NursingNoteRow = Prisma.NursingNoteUncheckedCreateInput & { id: string };

export const NURSING_NOTE_TIME_RULES: readonly TimeOrderRule[] = [
  ['recordedAt', 'createdAt'],
  ['createdAt', 'signedAt'],
] as const;

/** 근무별 기록 시각 — `shiftOf` 판정과 어긋나면 가드가 잡는다 */
export const NOTE_HOURS = [9, 17, 1] as const;

/** 입원 1건당 최대 기록 일수(최근 쪽을 남긴다) */
export const NOTE_MAX_DAYS = 7;

/**
 * 🔴 기록 형식(noteType)과 채우는 칸은 한 벌이다. SOAP 노트에 DAR 칸을 채우면
 *    화면이 어느 칸을 보여줄지 갈리고, 같은 기록이 형식마다 다르게 읽힌다.
 */
const NOTE_BODIES = {
  SOAP: {
    subjective: '[시연] 통증은 견딜 만하다고 표현함. 야간 수면은 보통.',
    objective: '[시연] 활력징후 안정 범위. 섭취·배설 균형 유지. 창상 부위 발적 없음.',
    assessment: '[시연] 현재 치료에 대한 반응 양호. 급성 악화 징후 없음.',
    plan: '[시연] 근무조별 활력 측정 유지, 통증 척도 재평가, 조기 보행 격려.',
  },
  DAR: {
    focus: '[시연] 통증 관리',
    data: '[시연] 통증 척도 자가 보고 3점. 표정 및 자세에서 심한 불편감 관찰되지 않음.',
    action: '[시연] 처방된 진통제 투여 및 체위 변경 도움, 이완 호흡 안내.',
    response: '[시연] 30분 후 통증 척도 1점으로 감소. 이상반응 관찰되지 않음.',
  },
  NARRATIVE: {
    content: '[시연] 근무 중 전신 상태 관찰함. 발열·호흡곤란·의식 변화 없음. 보호자에게 경과 설명함.',
  },
} as const;

const NOTE_TYPES = ['SOAP', 'DAR', 'NARRATIVE'] as const;

/**
 * 입원 간호기록 — **재원 중이면 오늘까지**, 퇴원했으면 퇴원일까지.
 * 🔴 `recordedAt ≤ createdAt ≤ signedAt`. 운영 데이터에는 `signed_at < created_at` 이 187건 있다
 *    (기존 시드 결함). 그 형태를 다시 만들지 않는다.
 */
export function buildAdmissionNursingNotes(
  admissions: CvInpatientAdmissionRef[],
  ctx: CvContext,
): NursingNoteRow[] {
  if (!ctx.nurses.length) return [];
  const rows: NursingNoteRow[] = [];

  for (const adm of admissions) {
    const end = adm.dischargeDate && adm.dischargeDate.getTime() < ctx.now.getTime() ? adm.dischargeDate : ctx.now;
    const spanDays = Math.floor((end.getTime() - adm.admitDate.getTime()) / 86_400_000);
    if (spanDays < 0) continue;
    const days = Math.min(spanDays + 1, NOTE_MAX_DAYS);
    const firstDayOffset = Math.max(0, spanDays - days + 1);

    for (let d = 0; d < days; d++) {
      for (const hour of NOTE_HOURS) {
        const at = new Date(adm.admitDate.getTime() + (firstDayOffset + d) * 86_400_000);
        at.setHours(hour, intBetween(cvRandom(`h:${adm.id}:${d}:${hour}`)(), 0, 50), 0, 0);
        if (at.getTime() < adm.admitDate.getTime() || at.getTime() > end.getTime()) continue;

        const r = cvRandom(`cv-adm-note:${adm.id}:${d}:${hour}`);
        const noteType = NOTE_TYPES[(d + hour) % NOTE_TYPES.length];
        const createdAt = new Date(at.getTime() + intBetween(r(), 2, 20) * 60_000);
        const signedAt = new Date(createdAt.getTime() + intBetween(r(), 1, 25) * 60_000);
        if (signedAt.getTime() > ctx.now.getTime()) continue;
        const nurseId = ctx.nurses[(d * 3 + hour) % ctx.nurses.length];

        const body =
          noteType === 'SOAP' ? NOTE_BODIES.SOAP : noteType === 'DAR' ? NOTE_BODIES.DAR : NOTE_BODIES.NARRATIVE;

        rows.push({
          id: cvUuidKey(CV_TAGS.admissionNursingNote, `${adm.id}:${at.toISOString()}`),
          admissionId: adm.id,
          nurseId,
          noteType,
          // 🔴 형식에 없는 칸은 채우지 않는다
          ...body,
          shiftType: shiftOf(at),
          priority: 'NORMAL',
          recordedAt: at,
          createdAt,
          status: 'SIGNED',
          signedAt,
          signedBy: nurseId,
        });
      }
    }
  }
  return rows;
}

// ─────────────────── 입원 투약(처방 → 오더 → MAR) ───────────────────

export interface MedRegimen {
  ingredient: (typeof MAR_ALLOWED_INGREDIENTS)[number];
  dose: string;
  route: 'PO' | 'IV';
  frequency: string;
  /** 투여 시각(시) — 길이가 곧 1일 투여 횟수다 */
  hours: readonly number[];
  instructions: string;
}

/** 🔴 1일 투여 횟수는 `hours.length` 하나에서 나온다 — frequency 문자열과 따로 세지 않는다 */
export const MED_REGIMENS: readonly MedRegimen[] = [
  { ingredient: 'Acetaminophen', dose: '500mg', route: 'PO', frequency: '1일 3회', hours: [8, 14, 20], instructions: '[시연] 발열·통증 시 경구 투여' },
  { ingredient: 'Famotidine', dose: '20mg', route: 'PO', frequency: '1일 2회', hours: [8, 20], instructions: '[시연] 위산 분비 억제' },
  { ingredient: 'Ceftriaxone', dose: '1g', route: 'IV', frequency: '1일 1회', hours: [10], instructions: '[시연] 정맥 항생제' },
  { ingredient: 'Levofloxacin', dose: '500mg', route: 'PO', frequency: '1일 1회', hours: [10], instructions: '[시연] 경구 항생제' },
  { ingredient: 'Metoclopramide', dose: '5mg', route: 'PO', frequency: '1일 3회', hours: [8, 14, 20], instructions: '[시연] 오심 조절' },
  { ingredient: 'Ibuprofen', dose: '400mg', route: 'PO', frequency: '1일 2회', hours: [9, 21], instructions: '[시연] 소염 진통' },
] as const;

/** 투약 치료 기간 상한 — 현재 유효한 처방을 보여주는 것이 목적이라 전 재원기간을 채우지 않는다 */
export const MED_THERAPY_MAX_DAYS = 10;

export interface InpatientMedRow {
  encounter: Prisma.EncounterUncheckedCreateInput & { id: string };
  prescription: Prisma.PrescriptionUncheckedCreateInput & { id: string };
  order: Prisma.OrderUncheckedCreateInput & { id: string };
  admins: (Prisma.MedicationAdministrationUncheckedCreateInput & { id: string })[];
  /** 가드가 "실시 건수 = 1일 횟수 × 일수" 를 검사하기 위한 원자료 */
  dosesPerDay: number;
  therapyDays: number;
}

export const MAR_TIME_RULES: readonly TimeOrderRule[] = [['scheduledAt', 'administeredAt']] as const;

/**
 * 재원 중인 입원에 **현재 유효한 투약**을 붙인다.
 *
 * 🔴 사슬을 통째로 만든다: 진료 → 처방 → 약제 오더 → 실시. 실시만 심으면
 *    "처방 없이 약이 나갔다"는 기록이 된다.
 * 🔴 미래 예정분은 `SCHEDULED`(실시 시각 **null**)로 남긴다 — 예정은 계획이지 실시가 아니다.
 *    실시하지 않은 것을 실시했다고 적는 것이 P16 이다.
 */
export function buildInpatientMedications(ctx: InpatientSeedContext): InpatientMedRow[] {
  const active = ctx.admissions.filter((a) => !a.dischargeDate);
  const safeMeds = ctx.meds.filter(isMarSafeMedication);
  if (!active.length || !safeMeds.length || !ctx.nurses.length) return [];

  const byIngredient = new Map(safeMeds.map((m) => [(m.ingredient ?? '').trim(), m]));
  const rows: InpatientMedRow[] = [];

  for (const adm of active) {
    const r = cvRandom(`cv-med:${adm.id}`);
    const stayDays = Math.floor((ctx.now.getTime() - adm.admitDate.getTime()) / 86_400_000);
    const therapyDays = Math.max(1, Math.min(MED_THERAPY_MAX_DAYS, stayDays + 1));
    // 치료 시작일 = 오늘 기준 therapyDays-1 일 전 (현재 유효한 처방)
    const startDay = new Date(ctx.now.getTime() - (therapyDays - 1) * 86_400_000);
    startDay.setHours(0, 0, 0, 0);
    if (startDay.getTime() < adm.admitDate.getTime()) startDay.setTime(adm.admitDate.getTime());

    const encounterAt = new Date(startDay.getTime());
    encounterAt.setHours(7, 30, 0, 0);
    if (encounterAt.getTime() < adm.admitDate.getTime()) encounterAt.setTime(adm.admitDate.getTime());

    const encounterId = cvUuidKey(CV_TAGS.inpatientEncounter, adm.id);
    const encounter: Prisma.EncounterUncheckedCreateInput & { id: string } = {
      id: encounterId,
      patientId: adm.patientId,
      doctorId: adm.attendingDoctorId,
      admissionId: adm.id,
      visitType: 'INPATIENT',
      chiefComplaint: '[시연] 재원 중 경과 관찰',
      assessment: '[시연] 현 치료 유지. 급성 악화 징후 없음.',
      plan: '[시연] 투약 지속, 활력 관찰, 경과에 따라 퇴원 계획 수립.',
      status: 'SIGNED',
      signedAt: encounterAt,
      signedBy: adm.attendingDoctorId,
      createdAt: encounterAt,
      updatedAt: encounterAt,
    };

    // 환자별 2~3개 약물(결정적)
    const regimenCount = 2 + (r() < 0.6 ? 1 : 0);
    const offset = Math.floor(r() * MED_REGIMENS.length);
    for (let k = 0; k < regimenCount; k++) {
      const reg = MED_REGIMENS[(offset + k) % MED_REGIMENS.length];
      const med = byIngredient.get(reg.ingredient);
      // 🔴 약품 마스터에 없으면 처방을 지어내지 않는다 — 없는 약을 준 기록이 된다
      if (!med) continue;

      const prescriptionId = cvUuidKey(CV_TAGS.inpatientPrescription, `${adm.id}:${reg.ingredient}`);
      const orderId = cvUuidKey(CV_TAGS.pharmacyOrder, `${adm.id}:${reg.ingredient}`);
      const dosesPerDay = reg.hours.length;

      const prescription: Prisma.PrescriptionUncheckedCreateInput & { id: string } = {
        id: prescriptionId,
        encounterId,
        type: 'MEDICATION',
        medicationCodeId: med.id,
        dosage: reg.dose,
        frequency: reg.frequency,
        duration: therapyDays,
        // 총량 = 1일 횟수 × 일수. 🔴 따로 정한 숫자를 적지 않는다
        quantity: dosesPerDay * therapyDays,
        route: reg.route,
        instructions: reg.instructions,
        priority: 'ROUTINE',
        source: 'MANUAL',
        dispensingType: 'INTERNAL',
        orderSource: 'WRITTEN',
        status: 'ACTIVE',
        createdAt: encounterAt,
        createdBy: adm.attendingDoctorId,
        prescriberId: adm.attendingDoctorId,
      };

      const order: Prisma.OrderUncheckedCreateInput & { id: string } = {
        id: orderId,
        prescriptionId,
        department: 'PHARMACY',
        status: 'COMPLETED',
        priority: 'ROUTINE',
        receivedAt: new Date(encounterAt.getTime() + 20 * 60_000),
        receivedById: ctx.nurses[0],
        startedAt: new Date(encounterAt.getTime() + 35 * 60_000),
        startedById: ctx.nurses[0],
        completedAt: new Date(encounterAt.getTime() + 60 * 60_000),
        completedById: ctx.nurses[0],
        notes: '[시연] 입원 투약 오더(clinical-volume)',
        createdAt: encounterAt,
        updatedAt: new Date(encounterAt.getTime() + 60 * 60_000),
      };

      const admins: (Prisma.MedicationAdministrationUncheckedCreateInput & { id: string })[] = [];
      for (let d = 0; d < therapyDays; d++) {
        for (const hour of reg.hours) {
          const scheduledAt = new Date(startDay.getTime() + d * 86_400_000);
          scheduledAt.setHours(hour, 0, 0, 0);
          if (scheduledAt.getTime() < adm.admitDate.getTime()) continue;

          const rr = cvRandom(`cv-mar:${prescriptionId}:${d}:${hour}`);
          const future = scheduledAt.getTime() > ctx.now.getTime();
          // 예정분은 계획이다 — 실시 시각을 만들지 않는다
          let status: 'SCHEDULED' | 'ADMINISTERED' | 'HELD' | 'REFUSED' | 'MISSED' = 'SCHEDULED';
          let administeredAt: Date | null = null;
          let holdReason: string | null = null;
          if (!future) {
            const roll = rr();
            if (roll < 0.94) {
              status = 'ADMINISTERED';
              administeredAt = new Date(scheduledAt.getTime() + intBetween(rr(), 0, 25) * 60_000);
              if (administeredAt.getTime() > ctx.now.getTime()) administeredAt = new Date(scheduledAt.getTime());
            } else if (roll < 0.97) {
              status = 'HELD';
              holdReason = '[시연] 금식 중으로 담당의 확인 후 보류';
            } else if (roll < 0.99) {
              status = 'REFUSED';
              holdReason = '[시연] 환자 복용 거부 — 담당의 보고함';
            } else {
              status = 'MISSED';
              holdReason = '[시연] 검사 이동으로 투여 시각 경과';
            }
          }

          admins.push({
            id: cvUuidKey(CV_TAGS.medAdmin, `${prescriptionId}:${scheduledAt.toISOString()}`),
            prescriptionId,
            orderId,
            patientId: adm.patientId,
            nurseId: status === 'SCHEDULED' ? null : ctx.nurses[(d + hour) % ctx.nurses.length],
            scheduledAt,
            administeredAt,
            status,
            holdReason,
            // 🔴 용량·경로는 처방에서 그대로 온다(같은 사실을 두 곳에서 따로 정하지 않는다)
            route: reg.route,
            dose: reg.dose,
            notes: null,
            createdAt: encounterAt,
          });
        }
      }

      rows.push({ encounter, prescription, order, admins, dosesPerDay, therapyDays });
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
    const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    const nurses = await prisma.user.findMany({ where: { role: 'NURSE' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    if (!doctors.length || !nurses.length) {
      console.log('[clinical-volume:inpatient] 의사/간호사 없음 — 메인 seed 먼저. 건너뜀');
      return;
    }

    const existing = await prisma.admission.findMany({
      where: { status: { in: ['ADMITTED', 'DISCHARGED'] } },
      select: { id: true, patientId: true, admitDate: true, dischargeDate: true, attendingDoctorId: true, admittingDoctorId: true },
      orderBy: { admitDate: 'desc' },
    });
    const beds = await prisma.bed.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 40 });
    const admittedPatientIds = new Set((await prisma.admission.findMany({ select: { patientId: true } })).map((a) => a.patientId));
    const candidates = await prisma.patient.findMany({
      select: { id: true, dateOfBirth: true, gender: true }, orderBy: { createdAt: 'asc' }, take: 400,
    });

    // 🔴 약품 안전 필터는 DB 질의에서 한 번, 생성기에서 한 번 더 건다(큐레이션을 믿지 않는다)
    const meds = await prisma.medicationCode.findMany({
      where: {
        isActive: true,
        narcoticType: null,
        controlSchedule: null,
        highAlertFlag: false,
        aspRestrictedLevel: null,
        ingredient: { in: [...MAR_ALLOWED_INGREDIENTS] },
      },
      select: {
        id: true, code: true, nameKo: true, ingredient: true,
        narcoticType: true, controlSchedule: true, highAlertFlag: true, aspRestrictedLevel: true,
      },
    });

    const ctx: InpatientSeedContext = {
      now,
      patients: [],
      doctors: doctors.map((d) => d.id),
      nurses: nurses.map((n) => n.id),
      admissions: existing.map((a) => ({
        id: a.id, patientId: a.patientId, admitDate: a.admitDate, dischargeDate: a.dischargeDate,
        attendingDoctorId: a.attendingDoctorId ?? a.admittingDoctorId,
      })),
      unadmittedPatients: candidates.filter((p) => !admittedPatientIds.has(p.id)),
      beds: beds.map((b) => b.id),
      meds,
    };

    // ① 신규 퇴원 완료 입원
    const newAdmissions = buildDischargedAdmissions(ctx);
    for (const row of newAdmissions) await prisma.admission.upsert(upsertArgs(row));

    // ② 간호기록 — 기존 입원 + 방금 만든 입원 전부
    const allAdmissions: CvInpatientAdmissionRef[] = [
      ...ctx.admissions,
      ...newAdmissions.map((a) => ({
        id: a.id, patientId: a.patientId, admitDate: a.admitDate as Date,
        dischargeDate: (a.dischargeDate as Date) ?? null, attendingDoctorId: a.admittingDoctorId,
      })),
    ];
    const notes = buildAdmissionNursingNotes(allAdmissions, ctx);
    for (const row of notes) await prisma.nursingNote.upsert(upsertArgs(row));

    // ③ 재원 중 투약 사슬
    const medRows = buildInpatientMedications(ctx);
    const seenEncounter = new Set<string>();
    for (const m of medRows) {
      if (!seenEncounter.has(m.encounter.id)) {
        await prisma.encounter.upsert(upsertArgs(m.encounter));
        seenEncounter.add(m.encounter.id);
      }
      await prisma.prescription.upsert(upsertArgs(m.prescription));
      await prisma.order.upsert(upsertArgs(m.order));
      for (const a of m.admins) await prisma.medicationAdministration.upsert(upsertArgs(a));
    }

    cvReport('inpatient', {
      dischargedAdmissions: newAdmissions.length,
      nursingNotes: notes.length,
      inpatientEncounters: seenEncounter.size,
      prescriptions: medRows.length,
      pharmacyOrders: medRows.length,
      medicationAdministrations: medRows.reduce((s, m) => s + m.admins.length, 0),
    });
    if (!meds.length) {
      console.log('[clinical-volume:inpatient] 🔴 안전 허용목록 약품이 약품 마스터에 없어 MAR 을 만들지 않았다 — 없는 약을 준 기록을 만들지 않는다');
    }
    console.log(`[clinical-volume:inpatient] 마약류·향정·고위험 약물은 실시 기록 대상에서 제외했다(허용 성분 ${MAR_ALLOWED_INGREDIENTS.length}종만)`);
    console.log(`[clinical-volume:inpatient] 재원 중(ADMITTED) 입원은 만들지 않았다 — 병상 점유와 어긋난다. 신규는 퇴원 완료 ${newAdmissions.length}건뿐이다`);
    console.log(`[clinical-volume:inpatient] 이 축의 id 는 전부 자연키 파생(${CV_UUID_PREFIX}…)이라 목록 순서가 바뀌어도 중복되지 않는다`);
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
