import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { ageOf } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AdmissionVitalsReader } from '../vitals/admission-vitals.reader';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AllergyService } from '../allergy/allergy.service';
import type { SkillEnvelope } from './ai-verify';

/**
 * 환자 AI 브리핑 — **하이브리드 실행 모델의 배치 A**(기획서 `chart-ai-assistant-agent.plan.md` §4.6-a).
 *
 * 왜: 진료 보조 스킬 지연(12~32초 실측)의 대부분은 진료 **전에** 알 수 있는 데이터(검사·활성약·문제·활력·과거 진료)를
 *     진료 **중에** 다시 끌어오기 때문이다. 이 서비스는 그것을 **결정론적으로(LLM 없이)** 미리 만든다.
 *
 * 규칙
 *   · LLM 을 부르지 않는다 — 항상 계산 가능하고, 틀릴 수 있는 것은 "해석"이 아니라 정본 값의 나열이다.
 *   · 저장은 Redis(`ai:brief:<patientId>` · TTL 24h) — 스키마 없이 시작한다. 영속 원장은 P2(사람 게이트).
 *   · 근거 데이터 이벤트(검사 확정·조제 완료·입원·서명·활력)가 오면 **삭제**한다 → 다음 조회가 lazy 재계산(stale 을 안고 살지 않는다).
 *   · 야간 크론은 **다음날 예약 + 재원 환자만** 만든다(전 환자 × — 예산·PHI 최소). config `ai.brief.batch.enabled` 기본 OFF.
 *   · 화면은 `computedAt`·`trigger`(BATCH/LAZY/EVENT) 를 값과 함께 낸다(§3.3 최신성).
 *   · **배치 B(LLM 사전 스킬)** 는 `skills.*` 에만 — **야간 배치에서만** 계산한다(lazy 는 LLM 을 부르지 않는다).
 *     config `ai.brief.llm.enabled`(기본 OFF) · 검사 결과가 0건이면 부르지 않는다(근거 게이트) · 환자당 시간 예산
 *     `ai.brief.patientBudgetSec` 초과분은 **미계산이라고 적고**(`unavailable`) 셈해서 로그에 남긴다.
 *     검증층을 통과한(`source:'AI'`) 것만 싣는다 — 실시간과 같은 출력 계약·같은 검증층(정본은 하나).
 */

/** 검사해석 봉투 — 실시간 `MedicalAiService.interpretLab` 과 같은 모양(정본은 하나) */
export type LabInterpretationEnvelope = {
  summary: string;
  findings: Array<{ test: string; interpretation?: string; severity?: string }>;
  clinicalImplication: string;
  suggestedActions: string[];
  confidence: number | null;
} & SkillEnvelope;

/** 배치 B 가 브리핑에 싣는 사전 스킬 결과 — 계산 시각·근거를 값과 함께 */
export interface PatientBriefSkills {
  labInterpretation: (LabInterpretationEnvelope & { computedAt: string; basedOn: string[] }) | null;
}

/** 배치 B 가 부르는 해석기 — MedicalAiService 가 부팅 시 붙인다(같은 모듈 안 순환을 늦은 바인딩으로 푼다) */
export type LabInterpreter = (patientId: string, brief: PatientBrief) => Promise<LabInterpretationEnvelope>;

export interface PatientBrief {
  version: 1;
  patientId: string;
  computedAt: string;
  trigger: 'BATCH' | 'LAZY' | 'REFRESH';
  basis: string[];
  demographics: { age: number | null; sex: string | null };
  allergy: { status: string; items: string[] } | { status: 'UNAVAILABLE'; items: [] };
  activeMedications: string[];
  /**
   * 활성 투약 상세(2026-10-02) — 같은 약·용량·용법은 한 줄(`count` = 활성 처방 건수).
   * `overDuration` = 처방일 + 일수가 지났는데 ACTIVE(만료 처리 안 됨 — 자동 중단은 사람 결정 배치 M) · 일수 없으면 null(모름)
   */
  medicationDetails?: Array<{ name: string; dosage: string | null; frequency: string | null; latestPrescribedAt: string; durationDays: number | null; overDuration: boolean | null; count: number }>;
  /** 문제 목록 — 활성·만성(2026-10-03 · 종전 활성만 읽어 만성 문제가 진료 전 요약에서 빠졌다 · 탭 기본 필터와 같다) */
  activeProblems: string[];
  /**
   * 서명·정정된 진료 기록의 진단(코드별 최신 · 2026-10-02) — 문제 목록이 비어 있어도 진료 기록에는 진단이 있다.
   * 🔴 문제 목록을 대신하지 않는다 — 출처가 다르다(화면이 "진료 기록 진단"이라 밝힌다)
   * `onProblemList`(2026-10-03) — 같은 진단 코드가 문제 목록에 있는가(상태 무관 — 해결로 정리한 것도 정리된 것) ·
   *   문제 목록을 읽지 못했으면 null(모름 — "없음"으로 말하지 않는다) · 자동 등록은 하지 않는다(사람 판단)
   */
  recordDiagnoses?: Array<{ code: string; name: string; lastAt: string; encounters: number; diagnosisCodeId?: string; onProblemList?: boolean | null }>;
  /** 가장 최근 검사 결과 시각(기간 무관) — 30일 창이 비었을 때 "마지막 검사"를 말한다 · 검사 없으면 null */
  lastLabAt?: string | null;
  recentLabs: Array<{ testName: string; value: string; unit: string | null; flag: string | null; resultedAt: string | null }>;
  abnormalLabCount: number;
  latestVitals: { measuredAt: string; systolicBp: number | null; diastolicBp: number | null; heartRate: number | null; temperature: number | null; spo2: number | null; respiratoryRate: number | null } | null;
  lastEncounter: { at: string; chiefComplaint: string | null; assessment: string | null; status: string } | null;
  currentAdmission: { admittedAt: string; ward: string | null } | null;
  /** 계산하지 못한 축 — 조용히 비우지 않는다 */
  unavailable: string[];
  /** 배치 B(LLM 사전 스킬) — 야간 배치에서만 채워진다. lazy 계산은 null(부르지 않았다) */
  skills: PatientBriefSkills;
}

// v2(2026-10-02): 투약 상세·진료 기록 진단·마지막 검사 시각 · v3(2026-10-03): 만성 문제·진단의 문제 목록 등재 여부 — 옛 모양 캐시를 읽지 않게 키를 바꾼다
const KEY = (pid: string) => `ai:brief:v3:${pid}`;
const TTL_SEC = 24 * 3600;

@Injectable()
export class PatientBriefService {
  private readonly logger = new Logger(PatientBriefService.name);
  private labInterpreter: LabInterpreter | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly allergyService?: AllergyService,
    /** 두 원장 활력 읽기 정본(2026-10-10) — 미주입(단위 테스트)이면 같은 prisma 로 구성 */
    @Optional() private readonly admissionVitalsInjected?: AdmissionVitalsReader,
  ) {}

  private _admissionVitalsFallback?: AdmissionVitalsReader;
  private get admissionVitals(): AdmissionVitalsReader {
    return this.admissionVitalsInjected ?? (this._admissionVitalsFallback ??= new AdmissionVitalsReader(this.prisma));
  }

  /** 배치 B 해석기 늦은 바인딩 — MedicalAiService.onModuleInit 이 부른다. 안 붙으면 배치 B 는 "해석기 없음"으로 건너뛰고 셈한다 */
  attachLabInterpreter(fn: LabInterpreter | null) { this.labInterpreter = fn; }

  /** 조회 — 캐시가 없으면 lazy 계산. `refresh` 면 강제 재계산 */
  async get(patientId: string, opts?: { refresh?: boolean }): Promise<PatientBrief & { cached: boolean }> {
    let prior: PatientBrief | null = null;
    if (this.redis) {
      try {
        const raw = await this.redis.get(KEY(patientId));
        if (raw) {
          const parsed = JSON.parse(raw) as PatientBrief;
          if (!opts?.refresh) return { ...parsed, skills: parsed.skills ?? { labInterpretation: null }, cached: true };
          prior = parsed;
        }
      } catch (e) { this.logger.warn(`brief 캐시 조회 실패(${patientId}): ${e instanceof Error ? e.message : e}`); }
    }
    const brief = await this.compute(patientId, opts?.refresh ? 'REFRESH' : 'LAZY');
    // lazy/refresh 는 LLM 을 부르지 않는다 — 배치 B 결과는 근거(검사 항목·값)가 그대로면 이어받고, 달라졌으면 null
    if (prior?.skills?.labInterpretation && JSON.stringify(prior.recentLabs) === JSON.stringify(brief.recentLabs)) {
      brief.skills.labInterpretation = prior.skills.labInterpretation;
    }
    await this.store(brief);
    return { ...brief, cached: false };
  }

  /** 결정론 계산 — 실패한 축은 unavailable 에 적고 나머지는 낸다 */
  async compute(patientId: string, trigger: PatientBrief['trigger']): Promise<PatientBrief> {
    const unavailable: string[] = [];
    const basis: string[] = [];
    const since30 = new Date(Date.now() - 30 * 86400_000);

    type MedRow = { dosage: string | null; frequency: string | null; duration: number | null; createdAt: Date; medicationCode: { nameKo: string | null } | null };
    type DxRow = { diagnosisCode: { id: string; code: string; nameKo: string }; encounter: { id: string; createdAt: Date } };
    const [patient, meds, problems, labs, vitals, lastEnc, admission, allergy, dxRows, lastLab] = await Promise.all([
      this.prisma.patient.findUnique({ where: { id: patientId }, select: { dateOfBirth: true, gender: true } }).catch(() => (unavailable.push('demographics'), null)),
      this.prisma.prescription.findMany({
        where: { encounter: { patientId }, status: 'ACTIVE', type: 'MEDICATION' },
        orderBy: { createdAt: 'desc' }, take: 100,
        select: { dosage: true, frequency: true, duration: true, createdAt: true, medicationCode: { select: { nameKo: true } } },
      }).catch(() => (unavailable.push('activeMedications'), [] as MedRow[])),
      // 문제 목록 — 전 상태를 읽어 ① 요약엔 활성·만성 ② 진단 등재 여부엔 상태 무관 코드(해결로 정리한 것도 정리된 것)
      this.prisma.problemList.findMany({ where: { patientId }, select: { description: true, status: true, diagnosisCode: { select: { code: true } } }, orderBy: { createdAt: 'desc' }, take: 200 })
        .catch(() => (unavailable.push('activeProblems'), [] as Array<{ description: string; status: string; diagnosisCode: { code: string } | null }>)),
      this.prisma.labResult.findMany({
        where: { patientId, status: { in: ['COMPLETED', 'VERIFIED'] }, completedAt: { gte: since30 } },
        orderBy: { completedAt: 'desc' }, take: 10,
        select: { completedAt: true, items: { select: { testName: true, value: true, unit: true, flag: true } } },
      }).catch(() => (unavailable.push('recentLabs'), [] as Array<{ completedAt: Date | null; items: Array<{ testName: string; value: string; unit: string | null; flag: string | null }> }>)),
      // 두 원장(외래 + 입원) 최신 1건(2026-10-10 · 종전 외래 원장만 — 입원 중 플로시트 활력을 못 봤다)
      this.admissionVitals.recentForPatient(patientId, 1).then((r) => r[0] ?? null).catch(() => (unavailable.push('latestVitals'), null)),
      // 서명·정정된 진료만(초안은 확정 기록이 아니다)
      this.prisma.encounter.findFirst({ where: { patientId, status: { in: ['SIGNED', 'AMENDED'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, chiefComplaint: true, assessment: true, status: true } })
        .catch(() => (unavailable.push('lastEncounter'), null)),
      this.prisma.admission.findFirst({ where: { patientId, status: 'ADMITTED' }, select: { admitDate: true, bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } } } }).catch(() => (unavailable.push('currentAdmission'), null)),
      this.allergyService ? this.allergyService.getStatus(patientId).catch(() => (unavailable.push('allergy'), null)) : (unavailable.push('allergy'), Promise.resolve(null)),
      // 진료 기록 진단 — 서명·정정된 진료만(초안의 진단은 확정 기록이 아니다)
      this.prisma.encounterDiagnosis.findMany({
        where: { encounter: { patientId, status: { in: ['SIGNED', 'AMENDED'] } } },
        orderBy: { encounter: { createdAt: 'desc' } }, take: 200,
        select: { diagnosisCode: { select: { id: true, code: true, nameKo: true } }, encounter: { select: { id: true, createdAt: true } } },
      }).catch(() => (unavailable.push('recordDiagnoses'), [] as DxRow[])),
      this.prisma.labResult.findFirst({
        where: { patientId, status: { in: ['COMPLETED', 'VERIFIED'] }, completedAt: { not: null } },
        orderBy: { completedAt: 'desc' }, select: { completedAt: true },
      }).catch(() => (unavailable.push('lastLabAt'), null)),
    ]);

    // 투약 — 같은 약·용량·용법은 한 줄로(같은 약이 여러 번 ACTIVE 로 남아 있는 것을 숨기지 않고 count 로 말한다)
    const now = Date.now();
    const medMap = new Map<string, NonNullable<PatientBrief['medicationDetails']>[number]>();
    for (const m of meds) {
      const name = m.medicationCode?.nameKo;
      if (!name) continue;
      const k = `${name}|${m.dosage ?? ''}|${m.frequency ?? ''}`;
      const over = m.duration != null && m.duration > 0 ? m.createdAt.getTime() + m.duration * 86400_000 < now : null;
      const cur = medMap.get(k);
      if (!cur) medMap.set(k, { name, dosage: m.dosage ?? null, frequency: m.frequency ?? null, latestPrescribedAt: m.createdAt.toISOString(), durationDays: m.duration ?? null, overDuration: over, count: 1 });
      else cur.count += 1; // desc 순회 — 첫 행이 최신(기간 판정도 최신 처방 기준)
    }
    // 진단 — 코드별 최신 시각·진료 건수
    const dxMap = new Map<string, NonNullable<PatientBrief['recordDiagnoses']>[number] & { encIds: Set<string> }>();
    for (const d of dxRows) {
      const cur = dxMap.get(d.diagnosisCode.code);
      if (!cur) dxMap.set(d.diagnosisCode.code, { code: d.diagnosisCode.code, name: d.diagnosisCode.nameKo, diagnosisCodeId: d.diagnosisCode.id, lastAt: d.encounter.createdAt.toISOString(), encounters: 1, encIds: new Set([d.encounter.id]) });
      else if (!cur.encIds.has(d.encounter.id)) { cur.encIds.add(d.encounter.id); cur.encounters += 1; }
    }
    // 문제 목록 등재 여부 — 문제 목록을 읽지 못했으면 null(모름)
    const problemsKnown = !unavailable.includes('activeProblems');
    const listedCodes = new Set(problems.map((p) => p.diagnosisCode?.code).filter((c): c is string => !!c));
    const recordDiagnoses = [...dxMap.values()].slice(0, 10).map(({ encIds: _e, ...rest }) => ({ ...rest, onProblemList: problemsKnown ? listedCodes.has(rest.code) : null }));

    // 항목별 최신값만(desc 순회)
    const latest = new Map<string, PatientBrief['recentLabs'][number]>();
    for (const r of labs) for (const it of r.items) if (!latest.has(it.testName)) latest.set(it.testName, { testName: it.testName, value: it.value, unit: it.unit ?? null, flag: it.flag ?? null, resultedAt: r.completedAt?.toISOString() ?? null });
    const recentLabs = [...latest.values()];
    const abnormalLabCount = recentLabs.filter((l) => !!l.flag && l.flag !== 'N').length;
    if (!unavailable.includes('recentLabs')) basis.push(`검사 최근 30일 ${recentLabs.length}항목`);
    if (!unavailable.includes('activeMedications')) basis.push('활성 처방');
    if (!unavailable.includes('activeProblems')) basis.push('문제목록(활성·만성)');
    if (!unavailable.includes('allergy')) basis.push('알레르기 3상태(NKA)');
    if (!unavailable.includes('latestVitals')) basis.push('최근 활력');
    if (!unavailable.includes('recordDiagnoses')) basis.push('진료 기록 진단(서명)');

    const adm = admission;
    return {
      version: 1,
      patientId,
      computedAt: new Date().toISOString(),
      trigger,
      basis,
      demographics: { age: patient?.dateOfBirth ? ageOf(patient.dateOfBirth) : null, sex: patient?.gender ?? null },
      allergy: allergy ? { status: allergy.status, items: allergy.allergies.map((a) => a.allergen) } : { status: 'UNAVAILABLE', items: [] },
      activeMedications: [...new Set(meds.map((m) => m.medicationCode?.nameKo).filter((x): x is string => !!x))],
      medicationDetails: [...medMap.values()],
      activeProblems: problems.filter((p) => p.status === 'ACTIVE' || p.status === 'CHRONIC').slice(0, 30).map((p) => p.description),
      recordDiagnoses,
      lastLabAt: lastLab?.completedAt?.toISOString() ?? null,
      recentLabs,
      abnormalLabCount,
      latestVitals: vitals ? {
        measuredAt: vitals.measuredAt.toISOString(),
        systolicBp: vitals.systolicBp ?? null, diastolicBp: vitals.diastolicBp ?? null, heartRate: vitals.heartRate ?? null,
        temperature: vitals.temperature != null ? Number(vitals.temperature) : null, spo2: vitals.spo2 ?? null, respiratoryRate: vitals.respiratoryRate ?? null,
      } : null,
      lastEncounter: lastEnc ? { at: lastEnc.createdAt.toISOString(), chiefComplaint: lastEnc.chiefComplaint ?? null, assessment: lastEnc.assessment ?? null, status: String(lastEnc.status) } : null,
      currentAdmission: adm ? { admittedAt: adm.admitDate.toISOString(), ward: adm.bed ? `${adm.bed.ward?.name ?? ''} ${adm.bed.roomNumber}-${adm.bed.bedNumber}`.trim() : null } : null,
      unavailable,
      skills: { labInterpretation: null },
    };
  }

  private async store(brief: PatientBrief) {
    if (!this.redis) return;
    try { await this.redis.setex(KEY(brief.patientId), TTL_SEC, JSON.stringify(brief)); } catch (e) { this.logger.warn(`brief 저장 실패: ${e instanceof Error ? e.message : e}`); }
  }

  /** 근거 데이터가 바뀌면 지운다 — 다음 조회가 다시 계산한다(stale 을 안고 살지 않는다) */
  async invalidate(patientId: string | null | undefined, why: string) {
    if (!patientId || !this.redis) return;
    try { await this.redis.del(KEY(patientId)); this.logger.debug?.(`brief 무효화 ${patientId} (${why})`); } catch { /* 무시 */ }
  }

  @OnEvent('lab.result.completed') onLab(p: { patientId?: string }) { void this.invalidate(p?.patientId, 'lab.result.completed'); }
  @OnEvent('lab.result.verified') onLabVerified(p: { patientId?: string }) { void this.invalidate(p?.patientId, 'lab.result.verified'); }
  @OnEvent('dispensing.completed') onDispense(p: { patientId?: string }) { void this.invalidate(p?.patientId, 'dispensing.completed'); }
  @OnEvent('admission.created') onAdmit(p: { patientId?: string }) { void this.invalidate(p?.patientId, 'admission.created'); }
  @OnEvent('encounter.signed') onSigned(p: { patientId?: string }) { void this.invalidate(p?.patientId, 'encounter.signed'); }
  @OnEvent('vitals.recorded') onVitals(p: { patientId?: string }) { void this.invalidate(p?.patientId, 'vitals.recorded'); }
  /** 입원·중환자 활력(재원 단위 사건 · 2026-10-10) — 재원으로 환자를 찾아 무효화 */
  @OnEvent('vitals.admission.recorded') onAdmissionVitals(p: { admissionId?: string }) {
    if (!p?.admissionId) return;
    void this.prisma.admission.findUnique({ where: { id: p.admissionId }, select: { patientId: true } })
      .then((a) => this.invalidate(a?.patientId, 'vitals.admission.recorded'))
      .catch((e) => this.logger.warn(`요약 무효화 실패(재원 활력): ${e instanceof Error ? e.message : e}`));
  }
  // 알레르기 등록·정정·확인·문진 — 종전엔 무효화가 없어 헤더는 🚫알레르기인데 브리핑은 '알레르기 없음(문진 확인)'이 하루까지 남았다
  @OnEvent('allergy.changed') onAllergy(p: { patientId?: string }) { void this.invalidate(p?.patientId, 'allergy.changed'); }

  /**
   * 야간 배치 — 다음날 예약 + 재원 환자. 🔴 전 환자 × (예산·PHI 최소). config `ai.brief.batch.enabled` (기본 OFF).
   * 결과는 로그로 셈한다(성공/실패/대상 수) — 조용히 건너뛰지 않는다.
   *
   * 배치 B(LLM 사전 스킬 · `ai.brief.llm.enabled` 기본 OFF): 배치 A 저장 뒤 검사 결과가 있는 환자만 해석기를 부르고,
   * 환자당 예산(`ai.brief.patientBudgetSec` · 기본 60초) 초과분은 `unavailable` 에 적고 `budgetSkipped` 로 센다.
   * 검증층 통과(`source:'AI'`)만 싣는다 — 아니면 null + 사유를 `unavailable` 에 적는다.
   */
  @Cron('0 2 * * *')
  async nightly() {
    const enabled = await this.config?.get('ai.brief.batch.enabled').catch(() => null);
    if (enabled !== true && enabled !== 'true') return;
    const targets = await this.batchTargets();
    let ok = 0, fail = 0;
    const llmRaw = await this.config?.get('ai.brief.llm.enabled').catch(() => null);
    const llm = llmRaw === true || llmRaw === 'true';
    const CONC = Number((await this.config?.get('ai.brief.concurrency').catch(() => null)) ?? 3) || 3;
    const budgetSec = Number((await this.config?.get('ai.brief.patientBudgetSec').catch(() => null)) ?? 60) || 60;
    // 배치 B 셈 — 대상(검사 있음)/계산/예산 초과/검증 탈락(FALLBACK 등)/해석기 없음/오류
    const b = { eligible: 0, computed: 0, budgetSkipped: 0, rejected: 0, noInterpreter: 0, error: 0, noLabs: 0 };
    for (let i = 0; i < targets.length; i += CONC) {
      await Promise.all(targets.slice(i, i + CONC).map(async (pid) => {
        try {
          const brief = await this.compute(pid, 'BATCH');
          await this.store(brief);
          ok++;
          if (!llm) return;
          if (brief.recentLabs.length === 0) { b.noLabs++; return; } // 근거 게이트 — 해석할 검사가 없으면 부르지 않는다
          b.eligible++;
          if (!this.labInterpreter) { b.noInterpreter++; brief.unavailable.push('skills.labInterpretation(해석기 미연결)'); await this.store(brief); return; }
          const r = await this.withBudget(this.labInterpreter(pid, brief), budgetSec * 1000);
          if (r.status === 'TIMEOUT') { b.budgetSkipped++; brief.unavailable.push(`skills.labInterpretation(예산 ${budgetSec}초 초과 — 미계산)`); }
          else if (r.status === 'ERROR') { b.error++; brief.unavailable.push(`skills.labInterpretation(오류: ${r.message})`); }
          else if (r.value.source !== 'AI') { b.rejected++; brief.unavailable.push(`skills.labInterpretation(${r.value.source}${r.value.reason ? ':' + r.value.reason : ''})`); }
          else {
            b.computed++;
            brief.skills.labInterpretation = { ...r.value, computedAt: new Date().toISOString(), basedOn: [`브리핑 ${brief.computedAt}`, ...brief.recentLabs.map((l) => `${l.testName} ${l.value}${l.unit ?? ''}${l.flag && l.flag !== 'N' ? `(${l.flag})` : ''}`)] };
          }
          await this.store(brief);
        } catch (e) { fail++; this.logger.warn(`brief 배치 실패 ${pid}: ${e instanceof Error ? e.message : e}`); }
      }));
    }
    this.logger.log(`AI 브리핑 야간 배치 — 대상 ${targets.length} · 성공 ${ok} · 실패 ${fail}` + (llm ? ` · 배치B(검사해석) 대상 ${b.eligible}(검사 없음 ${b.noLabs}) · 계산 ${b.computed} · 예산초과 ${b.budgetSkipped} · 검증탈락 ${b.rejected} · 해석기없음 ${b.noInterpreter} · 오류 ${b.error}` : ' · 배치B OFF'));
    return { targets: targets.length, ok, fail, ...(llm ? { llm: b } : {}) };
  }

  /** 환자당 시간 예산 — 넘기면 TIMEOUT 으로 말한다(결과를 기다리지 않는다 — 다음 환자로) */
  private withBudget<T>(p: Promise<T>, ms: number): Promise<{ status: 'OK'; value: T } | { status: 'TIMEOUT' } | { status: 'ERROR'; message: string }> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ status: 'TIMEOUT' }), ms);
      p.then((value) => { clearTimeout(t); resolve({ status: 'OK', value }); }, (e) => { clearTimeout(t); resolve({ status: 'ERROR', message: e instanceof Error ? e.message : String(e) }); });
    });
  }

  /** 대상 = 내일 예약(SCHEDULED/CONFIRMED) + 현재 재원(ADMITTED) — 중복 제거 */
  async batchTargets(): Promise<string[]> {
    const start = new Date(); start.setHours(24, 0, 0, 0);
    const end = new Date(start.getTime() + 86400_000);
    const [appts, adms] = await Promise.all([
      this.prisma.appointment.findMany({ where: { scheduledAt: { gte: start, lt: end }, status: { in: ['SCHEDULED', 'CONFIRMED'] } }, select: { patientId: true } }),
      this.prisma.admission.findMany({ where: { status: 'ADMITTED' }, select: { patientId: true } }),
    ]);
    return [...new Set([...appts, ...adms].map((x) => x.patientId))];
  }
}
