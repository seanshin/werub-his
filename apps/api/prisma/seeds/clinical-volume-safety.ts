import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 임상 볼륨 확장 — 환자안전·감염관리(안전사건 · RCA · 의료관련감염 · 다제내성균) · 실행:
 *
 *   cd apps/api && npx ts-node --transpile-only prisma/seeds/clinical-volume-safety.ts
 *
 * 전제: 메인 `prisma/seed.ts`(환자·직원). 멱등: 결정적 UUID + 자연키(`incidentId`) upsert.
 *
 * ── 왜 이 축인가 ────────────────────────────────────────────────────────
 * 운영 실측(2026-08-18): `safety_incidents` 3 · `rca_reports` 1 · `hai_cases` 4 · `mdro_registry` 4.
 * 안전·감염 대시보드는 **비어 있는 것과 안전한 것을 구분하지 못한다** — 표본이 없으면
 * 화면의 초록·0건이 근거 없이 안심시킨다(P17). 개발 중 그 화면을 판단하려면 표본이 필요하다.
 *
 * ── 🔴 정본을 부른다 ────────────────────────────────────────────────────
 * 심각도 어휘는 `@hospital-run/shared` 의 `INCIDENT_SEVERITIES` 하나다. 종전에 저장된
 * `LOW` 2건이 화면 차트의 **어느 막대에도 속하지 않아** 조회조차 안 됐다. 시드가 정본 밖
 * 문자열을 쓰면 그 결함을 다시 심는 것이다 — 가드가 `normalizeIncidentSeverity` 왕복으로 검사한다.
 *
 * ── 🔴 여기서 만들지 않는 것 ────────────────────────────────────────────
 * `critical_value_alerts`(위급값 알림, 현재 2행)는 **만들지 않는다.**
 *   ① 이 행은 `lab.service.submitResult` 트랜잭션 안에서 검사 결과의 위급 flag(HH/LL)로부터
 *      파생되는 기록이다. 운영 DB 의 `lab_result_items` 에는 **HH/LL 이 한 건도 없다**(N 1163·
 *      H 632·L 78). 알림만 심으면 "근거 없는 위급 경보"가 되고, 거짓 경보는 진짜 경보를 죽인다.
 *   ② 위급 판정·사유 문구의 정본(`detectCriticalValues` + `isCriticalFlag`)이 서비스 내부에 있어
 *      시드가 복제하면 정본이 둘이 된다(P12).
 * → 선행 조건은 **위급 flag 를 가진 검사 결과를 만드는 축**이다. 그 뒤에 파생시켜야 한다.
 */

import type { Prisma } from '@prisma/client';
import { INCIDENT_SEVERITIES, isEscalatingSeverity } from '@hospital-run/shared';

import {
  CV_TAGS,
  CvContext,
  TimeOrderRule,
  cvRandom,
  cvReport,
  cvUuid,
  intBetween,
  pickOne,
  upsertArgs,
  withoutId,
} from './clinical-volume-core';

// ─────────────────────────── 안전사건 ───────────────────────────

export type SafetyIncidentRow = Prisma.SafetyIncidentUncheckedCreateInput & { id: string };
export type RcaReportRow = Prisma.RcaReportUncheckedCreateInput & { id: string };

export const INCIDENT_TIME_RULES: readonly TimeOrderRule[] = [['occurredAt', 'createdAt']] as const;

/** 유형별 서술 — 🔴 유형과 무관한 상수 문구를 돌려 쓰지 않는다 */
export const INCIDENT_TYPES: readonly { type: string; location: string; description: string; action: string }[] = [
  { type: 'FALL', location: '3층 내과병동 복도', description: '[시연] 야간 화장실 이동 중 미끄러짐. 외상 없음, 활력징후 안정.', action: '[시연] 즉시 평가 및 낙상 재평가 시행, 침상 난간 재교육.' },
  { type: 'MEDICATION_ERROR', location: '4층 외과병동 처치실', description: '[시연] 투약 시각 지연(예정 대비 90분). 환자 상태 변화 없음.', action: '[시연] 담당의 보고 및 투약 일정 조정, 근무조 인수인계 보완.' },
  { type: 'PRESSURE_ULCER', location: '중환자실', description: '[시연] 천골부 1단계 욕창 신규 발생 확인.', action: '[시연] 체위변경 주기 단축, 압력분산 매트리스 적용.' },
  { type: 'EQUIPMENT', location: '영상의학과', description: '[시연] 검사 장비 일시 정지로 검사 30분 지연. 환자 위해 없음.', action: '[시연] 장비팀 점검 요청 및 대체 장비 운용.' },
  { type: 'SPECIMEN_LABEL', location: '진단검사의학과 접수', description: '[시연] 검체 라벨 정보 불일치 발견, 검사 전 차단.', action: '[시연] 검체 폐기 후 재채취, 라벨 이중확인 절차 재교육.' },
  { type: 'DOCUMENTATION', location: '외래 3진료실', description: '[시연] 기록 항목 누락 확인, 당일 보완 완료.', action: '[시연] 기록 템플릿 필수항목 안내.' },
  { type: 'PATIENT_ID', location: '채혈실', description: '[시연] 환자 확인 2단계 중 1단계만 시행한 정황 확인(근접오류).', action: '[시연] 환자확인 절차 재교육 및 현장 점검.' },
] as const;

/** 심각도 분포 — 대부분은 근접오류·경미다. 전부 중대면 화면이 늘 빨갛고 아무 정보도 못 준다. */
const SEVERITY_MIX: readonly (typeof INCIDENT_SEVERITIES)[number][] = [
  'NEAR_MISS', 'NEAR_MISS', 'NEAR_MISS', 'MINOR', 'MINOR', 'MINOR', 'MODERATE', 'MODERATE', 'MAJOR', 'CRITICAL', 'SENTINEL',
];

export const INCIDENT_DEFAULT_COUNT = 72;

export interface SafetySeedRow {
  incident: SafetyIncidentRow;
  /** RCA 대상이 아니면 null — 🔴 RCA 없는 사건에 `rcaCompleted:true` 를 적지 않는다 */
  rca: RcaReportRow | null;
}

/**
 * 안전사건 + RCA.
 * 🔴 `SafetyIncident.rcaCompleted` 는 **RCA 보고서 상태에서 파생**한다.
 *    두 곳에 따로 적으면 "RCA 완료라는데 보고서가 없는" 사건이 생긴다(실제로 잘 나는 결함).
 */
export function buildSafetyIncidents(ctx: CvContext, count = INCIDENT_DEFAULT_COUNT): SafetySeedRow[] {
  if (!ctx.patients.length || !ctx.nurses.length || !ctx.doctors.length) return [];
  const out: SafetySeedRow[] = [];

  for (let i = 0; i < count; i++) {
    const r = cvRandom(`cv-incident:${i}`);
    const spec = INCIDENT_TYPES[i % INCIDENT_TYPES.length];
    const severity = pickOne(SEVERITY_MIX, r());

    const occurredAt = new Date(ctx.now.getTime() - intBetween(r(), 1, 300) * 86_400_000 - intBetween(r(), 0, 23) * 3_600_000);
    // 보고는 발생 뒤에 한다(보고 지연은 실제로 흔하다 — 그걸 보여주는 것이 화면의 목적이다)
    const reportedAt = new Date(occurredAt.getTime() + intBetween(r(), 10, 4320) * 60_000);
    if (reportedAt.getTime() > ctx.now.getTime()) continue;

    // 중대 이상은 RCA 를 연다. 그중 일부는 아직 진행 중이다(완료를 흉내내지 않는다).
    const needsRca = isEscalatingSeverity(severity) || severity === 'MAJOR';
    const rcaDone = needsRca && r() < 0.6;
    const rcaApproved = rcaDone && r() < 0.5;

    const incidentId = cvUuid(CV_TAGS.safetyIncident, i);
    const rcaStartedAt = new Date(reportedAt.getTime() + intBetween(r(), 1, 5) * 86_400_000);
    const rcaDueAt = new Date(rcaStartedAt.getTime() + 45 * 86_400_000);
    const rcaApprovedAt = rcaApproved ? new Date(rcaStartedAt.getTime() + intBetween(r(), 10, 40) * 86_400_000) : null;

    out.push({
      incident: {
        id: incidentId,
        patientId: r() < 0.8 ? ctx.patients[i % ctx.patients.length].id : null,
        reporterId: ctx.nurses[i % ctx.nurses.length],
        type: spec.type,
        severity,
        description: spec.description,
        location: spec.location,
        occurredAt,
        actionTaken: spec.action,
        status: rcaDone ? 'CLOSED' : needsRca ? 'INVESTIGATING' : 'REPORTED',
        // 🔴 파생값 — RCA 보고서가 완료 상태일 때만 true
        rcaCompleted: rcaDone,
        createdAt: reportedAt,
      },
      rca: needsRca
        ? {
            id: cvUuid(CV_TAGS.rcaReport, i),
            incidentId,
            findings: rcaDone
              ? '[시연] 근본원인 분석 결과 절차 이행 편차와 인수인계 정보 누락이 기여요인으로 확인됨.'
              : null,
            contributingFactors: rcaDone
              ? (['[시연] 절차 이행 편차', '[시연] 인수인계 정보 누락', '[시연] 업무 부하'] as Prisma.InputJsonValue)
              : undefined,
            actionPlan: rcaDone
              ? ([
                  { action: '[시연] 절차 체크리스트 개정', owner: '간호부', due: '30일' },
                  { action: '[시연] 근무조 인수인계 표준화 교육', owner: '교육팀', due: '45일' },
                ] as Prisma.InputJsonValue)
              : undefined,
            owner: ctx.doctors[i % ctx.doctors.length],
            dueAt: rcaDueAt,
            // 🔴 승인되지 않았으면 승인자·승인시각은 없다(승인을 흉내내지 않는다)
            status: rcaApproved ? 'APPROVED' : rcaDone ? 'COMPLETED' : 'IN_PROGRESS',
            approvedBy: rcaApproved ? ctx.doctors[(i + 1) % ctx.doctors.length] : null,
            approvedAt: rcaApprovedAt && rcaApprovedAt.getTime() <= ctx.now.getTime() ? rcaApprovedAt : null,
            createdAt: rcaStartedAt,
            updatedAt: rcaApprovedAt ?? rcaStartedAt,
          }
        : null,
    });
  }
  return out;
}

// ─────────────────────────── 의료관련감염(HAI) ───────────────────────────

export type HaiCaseRow = Prisma.HaiCaseUncheckedCreateInput & { id: string };

/**
 * 🔴 감염 유형과 기구는 짝이다 — CLABSI 인데 기구가 도뇨관이면 정의 자체가 틀린다.
 *    `deviceDays` 도 **삽입일~발생일에서 계산**한다(따로 난수로 넣으면 분모가 거짓이 된다).
 */
export const HAI_SPECS: readonly { haiType: string; deviceType: string | null; site: string; organisms: readonly string[]; criteria: string }[] = [
  { haiType: 'CLABSI', deviceType: 'CENTRAL_LINE', site: '혈류', organisms: ['Staphylococcus epidermidis', 'Klebsiella pneumoniae', 'Candida albicans'], criteria: '[시연] 중심정맥관 유치 2일 초과 후 혈액배양 양성, 타 부위 감염원 없음' },
  { haiType: 'CAUTI', deviceType: 'FOLEY', site: '요로', organisms: ['Escherichia coli', 'Enterococcus faecalis', 'Pseudomonas aeruginosa'], criteria: '[시연] 유치도뇨관 2일 초과 후 발열 및 요배양 유의균 검출' },
  { haiType: 'VAP', deviceType: 'VENTILATOR', site: '하기도', organisms: ['Acinetobacter baumannii', 'Pseudomonas aeruginosa'], criteria: '[시연] 인공호흡기 적용 2일 초과 후 새로운 폐 침윤 및 산소요구 증가' },
  { haiType: 'SSI', deviceType: 'SURGICAL', site: '수술부위', organisms: ['Staphylococcus aureus', 'Escherichia coli'], criteria: '[시연] 수술 30일 이내 절개부 화농성 배액 및 배양 양성' },
  { haiType: 'CDI', deviceType: null, site: '장관', organisms: ['Clostridioides difficile'], criteria: '[시연] 항생제 사용 후 설사 및 독소 검사 양성' },
] as const;

const HAI_WARDS = ['3층 내과병동', '4층 외과병동', '중환자실', '응급병동'] as const;

export const HAI_DEFAULT_COUNT = 26;

export function buildHaiCases(ctx: CvContext, count = HAI_DEFAULT_COUNT): HaiCaseRow[] {
  if (!ctx.patients.length || !ctx.doctors.length) return [];
  const rows: HaiCaseRow[] = [];

  for (let i = 0; i < count; i++) {
    const r = cvRandom(`cv-hai:${i}`);
    const spec = HAI_SPECS[i % HAI_SPECS.length];
    const onsetAt = new Date(ctx.now.getTime() - intBetween(r(), 2, 240) * 86_400_000);
    // 기구 관련 감염은 정의상 유치 2일 초과 후 발생한다
    const deviceDays = spec.deviceType ? intBetween(r(), 3, 21) : null;
    const deviceInsertedAt = deviceDays ? new Date(onsetAt.getTime() - deviceDays * 86_400_000) : null;

    rows.push({
      id: cvUuid(CV_TAGS.haiCase, i),
      patientId: ctx.patients[(i * 5) % ctx.patients.length].id,
      haiType: spec.haiType,
      organism: pickOne(spec.organisms, r()),
      deviceType: spec.deviceType,
      deviceInsertedAt,
      // 🔴 파생값 — 삽입일과 발생일에서 나온다
      deviceDays,
      site: spec.site,
      ward: pickOne(HAI_WARDS, r()),
      onsetAt,
      criteriaMet: spec.criteria,
      status: r() < 0.65 ? 'RESOLVED' : 'ACTIVE',
      // KONIS 보고는 실제로 보낸 적이 없다 — 전송을 흉내내지 않는다
      reportedToKonis: false,
      detectedBy: ctx.doctors[i % ctx.doctors.length],
      notes: '[시연] 감염관리실 확인 및 표준주의 강화 안내.',
      createdAt: onsetAt,
    });
  }
  return rows;
}

// ─────────────────────────── 다제내성균(MDRO) ───────────────────────────

export type MdroRow = Prisma.MdroRegistryUncheckedCreateInput & { id: string };

/** 🔴 균종과 내성 유형은 짝이다 — MRSA 인데 균이 대장균이면 그 자체가 오정보다 */
export const MDRO_SPECS: readonly { mdroType: string; organism: string; mechanism: string; isolation: string }[] = [
  { mdroType: 'MRSA', organism: 'Staphylococcus aureus', mechanism: 'mecA', isolation: 'CONTACT' },
  { mdroType: 'VRE', organism: 'Enterococcus faecium', mechanism: 'vanA', isolation: 'CONTACT' },
  { mdroType: 'CRE', organism: 'Klebsiella pneumoniae', mechanism: 'KPC', isolation: 'CONTACT' },
  { mdroType: 'CRAB', organism: 'Acinetobacter baumannii', mechanism: 'OXA-23', isolation: 'CONTACT' },
  { mdroType: 'CPE', organism: 'Escherichia coli', mechanism: 'NDM', isolation: 'CONTACT' },
  { mdroType: 'CDIFF', organism: 'Clostridioides difficile', mechanism: 'toxin B', isolation: 'CONTACT' },
] as const;

const MDRO_SPECIMENS = ['혈액', '객담', '소변', '창상 도말', '직장 도말'] as const;

export const MDRO_DEFAULT_COUNT = 24;

export function buildMdroRegistry(ctx: CvContext, count = MDRO_DEFAULT_COUNT): MdroRow[] {
  if (!ctx.patients.length) return [];
  const rows: MdroRow[] = [];

  for (let i = 0; i < count; i++) {
    const r = cvRandom(`cv-mdro:${i}`);
    const spec = MDRO_SPECS[i % MDRO_SPECS.length];
    const detectedAt = new Date(ctx.now.getTime() - intBetween(r(), 3, 300) * 86_400_000);
    // 🔴 해제(clearedAt)와 active 는 같은 사실의 두 표현이다 — 반드시 함께 움직인다
    const cleared = r() < 0.4;
    const clearedAt = cleared ? new Date(detectedAt.getTime() + intBetween(r(), 14, 90) * 86_400_000) : null;
    if (clearedAt && clearedAt.getTime() > ctx.now.getTime()) continue;

    rows.push({
      id: cvUuid(CV_TAGS.mdroRegistry, i),
      patientId: ctx.patients[(i * 13) % ctx.patients.length].id,
      organism: spec.organism,
      mdroType: spec.mdroType,
      mechanism: spec.mechanism,
      specimen: pickOne(MDRO_SPECIMENS, r()),
      ward: pickOne(HAI_WARDS, r()),
      detectedAt,
      clearedAt,
      active: !clearedAt,
      isolationType: spec.isolation,
      notes: '[시연] 접촉주의 적용 및 병실 배정 조정.',
      createdAt: detectedAt,
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
    if (!patients.length || !doctors.length || !nurses.length) {
      console.log('[clinical-volume:safety] 환자/의사/간호사 없음 — 메인 seed 먼저. 건너뜀');
      return;
    }

    const ctx: CvContext = {
      now,
      patients: patients.map((p) => ({ id: p.id, dateOfBirth: p.dateOfBirth, gender: p.gender })),
      doctors: doctors.map((d) => d.id),
      nurses: nurses.map((n) => n.id),
    };

    const incidents = buildSafetyIncidents(ctx);
    const hai = buildHaiCases(ctx);
    const mdro = buildMdroRegistry(ctx);

    for (const x of incidents) await prisma.safetyIncident.upsert(upsertArgs(x.incident));
    // 🔴 RCA 는 incidentId 가 유니크다(사건 1건당 1건) — 자연키로 맞춘다
    for (const x of incidents) {
      if (!x.rca) continue;
      await prisma.rcaReport.upsert({ where: { incidentId: x.rca.incidentId }, create: x.rca, update: withoutId(x.rca) });
    }
    for (const row of hai) await prisma.haiCase.upsert(upsertArgs(row));
    for (const row of mdro) await prisma.mdroRegistry.upsert(upsertArgs(row));

    cvReport('safety', {
      safetyIncidents: incidents.length,
      rcaReports: incidents.filter((x) => x.rca).length,
      haiCases: hai.length,
      mdroRegistry: mdro.length,
    });
    console.log('[clinical-volume:safety] critical_value_alerts 는 만들지 않았다 — 위급 flag(HH/LL) 검사결과가 0건이라 근거 없는 경보가 된다(파일 상단 주석 참조)');
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
