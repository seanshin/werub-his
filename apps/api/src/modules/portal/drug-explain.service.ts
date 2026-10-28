import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { configEnvOverride } from '../../common/config-env-overrides';
import { ageOf } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { DrugInfoResolver, EDrugInfo } from './drug-info.resolver';
import { parseFrequencySlots } from './frequency-slots.util';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';
import { aiDisabledException, isAiServerEnabled } from '../../common/util/ai-kill-switch';

/**
 * F-7 처방·투약 AI 쉬운 설명 (설계 patient-portal-enhancement §5)
 * - 캐시 우선(DrugExplainCache — 환자 무관 부분만) + 비동기 잡(포뮬러리 aiJobs 패턴 자체 복제 — 공용화 금지 결정 §0)
 * - LLM은 e약은요 원문 grounding 강제 · 금칙어 후처리 · 원문 없으면 생성 금지(UNAVAILABLE)
 * - 잡에 patientId 바인딩 — 타 환자 jobId 폴링 404(PHI)
 * - config portal.aiDrugExplain 기본 false — OFF면 전 EP 404(기능 부재와 동일 취급)
 */

/** 캐시 content(JsonB) — 환자 무관 3단 + 표기 메타(생성일·disclaimer는 캐시 응답에도 원값 유지 §6.5-③④) */
interface ExplainContent {
  purpose: string;
  cautions: string[];
  sideEffects: string[];
  whenToCall: string[];
  drugName?: string;
  /** WeRU.B 생성 시각 — row.createdAt은 개정 재확인(checked_at 겸용)으로 갱신되므로 생성일은 content에 보존 */
  generatedAt?: string;
  /** 서버(WeRU.B) 동봉 disclaimer 정본 */
  disclaimer?: string | null;
}

interface CacheRow {
  medicationCodeId: string;
  itemCode: string | null;
  content: ExplainContent;
  sourceVersion: string | null;
  /** 약사 승인 여부 — 미승인은 환자 비노출(검수 대기 폴백). 재생성 시 리셋 */
  approved: boolean;
}

interface RxLite {
  id: string;
  dosage: string | null;
  frequency: string | null;
  duration: number | null;
  route: string | null;
}

type ExplainResult =
  | { status: 'UNAVAILABLE'; reason?: 'PENDING_REVIEW' }
  | { status: 'READY'; explain: Record<string, unknown> };

interface ExplainJob {
  patientId: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  result?: unknown;
  error?: string;
  at: number;
}

/** 금칙어 — 해당 문장 drop, 전부 걸리면 UNAVAILABLE (기획 §3.5 규제 경계) */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /진단/,
  /복용을\s*중단/,
  /복용을\s*멈추/,
  /용량을\s*늘/,
  /용량을\s*줄/,
  /줄이세요/,
  /늘리세요/,
  /대신\s*드세요/,
  /대신\s*복용/,
];

const containsForbidden = (s: string) => FORBIDDEN_PATTERNS.some((p) => p.test(s));

/** 문자열 배열에서 금칙어 문장 drop */
export function filterForbiddenLines(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l): l is string => typeof l === 'string' && !!l.trim())
    .map((l) => l.trim())
    .filter((l) => !containsForbidden(l));
}

/** purpose(문단)는 문장 단위 필터 */
export function filterForbiddenText(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .split(/(?<=[.!?다요])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !containsForbidden(s))
    .join(' ')
    .trim();
}

/** LLM 산출 → 금칙어 후처리. 전부 걸리면 null(UNAVAILABLE) */
export function sanitizeExplainContent(raw: Record<string, unknown>): Omit<ExplainContent, 'drugName' | 'generatedAt' | 'disclaimer'> | null {
  const purpose = filterForbiddenText(raw.purpose);
  const cautions = filterForbiddenLines(raw.cautions);
  const sideEffects = filterForbiddenLines(raw.sideEffects);
  const whenToCall = filterForbiddenLines(raw.whenToCall);
  if (!purpose && !cautions.length && !sideEffects.length && !whenToCall.length) return null;
  return { purpose, cautions, sideEffects, whenToCall };
}

/** MedicationCode.nameKo → DUR 입력용 제품명(괄호 앞 — EDI 코드는 resolved:false 실측 §5.6-⑤⑥) */
export function drugNameForDur(nameKo: string): string {
  return nameKo.split('(')[0].trim();
}

const CACHE_RECHECK_DAYS = 30; // §5.2 — 30일 이내 hit는 외부 호출 0
const JOB_TTL_MS = 30 * 60_000; // 30분 GC(포뮬러리 동일)

@Injectable()
export class DrugExplainService {
  private readonly logger = new Logger(DrugExplainService.name);

  // 잡 스토어 — nginx 60s 회피용 인메모리(pm2 단일 인스턴스 전제 · 포뮬러리 aiJobs 패턴 복제)
  private jobs = new Map<string, ExplainJob>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly resolver: DrugInfoResolver,
    @Optional() private readonly medicalAi?: MedicalAiService,
  ) {}

  /** config OFF면 404 — FE는 조용한 폴백(기능 부재와 동일 취급, F-3 선례) */
  private async assertEnabled() {
    if ((await this.configRuntime.get('portal.aiDrugExplain')) !== true) {
      throw new NotFoundException('약 설명 기능이 비활성화되어 있습니다.');
    }
  }

  // ── 약 단위: GET /portal/medications/:prescriptionId/explain ──

  async explainForPrescription(patientId: string, prescriptionId: string): Promise<ExplainResult | { status: 'PENDING'; jobId: string }> {
    await this.assertEnabled();
    // 본인 처방 검증(Prescription→encounter.patientId=세션) — 불일치 404
    const rx = await this.prisma.prescription.findFirst({
      where: { id: prescriptionId, type: 'MEDICATION', encounter: { patientId } },
      select: {
        id: true, dosage: true, frequency: true, duration: true, route: true, medicationCodeId: true,
        medicationCode: { select: { nameKo: true } },
      },
    });
    if (!rx) throw new NotFoundException('처방을 찾을 수 없습니다.');
    if (!rx.medicationCodeId) return { status: 'UNAVAILABLE' };

    const medicationCodeId = rx.medicationCodeId;
    const drugName = rx.medicationCode?.nameKo ?? '';
    const cached = await this.getFreshCache(medicationCodeId);
    if (cached?.approved) return { status: 'READY', explain: this.assemble(cached, rx, drugName) }; // LLM 0회
    // 생성은 됐으나 약사 미승인 — 환자 비노출(승인제: 원내 약사 판단 전제)
    if (cached) return { status: 'UNAVAILABLE', reason: 'PENDING_REVIEW' };

    const jobId = this.startJob(patientId, async () => {
      const row = await this.generateAndCache(medicationCodeId, drugName);
      if (!row) return { status: 'UNAVAILABLE' } satisfies ExplainResult;
      // 신규 생성분은 약사 승인 대기 — 생성만 하고(검수 큐 적재) 노출은 승인 후
      return { status: 'UNAVAILABLE', reason: 'PENDING_REVIEW' } satisfies ExplainResult;
    });
    return { status: 'PENDING', jobId };
  }

  // ── 퇴원약(명칭 진입): GET /portal/medications/explain-by-name?name= ──
  // 퇴원요약 medications는 자유 JSON(drugName만)이라 처방 ID가 없음 — 본인 퇴원약 확인 후
  // HIS 마스터 **정확 일치 단일** 매칭만 허용(0건/복수=UNAVAILABLE — e약은요 명칭 오매칭 금지 원칙 준용).

  async explainByName(patientId: string, rawName: string): Promise<ExplainResult | { status: 'PENDING'; jobId: string }> {
    await this.assertEnabled();
    const name = (rawName ?? '').trim();
    if (!name || name.length > 200) throw new NotFoundException('약을 찾을 수 없습니다.');

    // 본인 퇴원약 검증 — 최근 퇴원요약 내 동일 명칭 존재(임의 약명 열람·LLM 남용 방지). patientId는 admission 경유
    const summaries = await this.prisma.dischargeSummary.findMany({
      where: { admission: { patientId } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { dischargeMedications: true },
    });
    // 🔴 요약 정본 키는 `name` 이다(프리필·서명 스냅샷) — `drugName`/`drug` 만 찾아 본인 퇴원약 확인이 늘 실패했다
    const owned = summaries.some((s) => {
      const meds = s.dischargeMedications;
      return Array.isArray(meds) && (meds as Record<string, unknown>[]).some(
        (m) => String(m?.drugName ?? m?.name ?? m?.drug ?? '').trim() === name,
      );
    }) || (await this.prisma.prescription.count({
      // 퇴원약 오더화(2026-09-30) — 처방 원장의 본인 퇴원약(요약 서명 전이어도 처방은 있다)
      where: { dischargeMed: true, status: 'ACTIVE', type: 'MEDICATION', medicationCode: { nameKo: name }, encounter: { patientId } },
    })) > 0;
    if (!owned) throw new NotFoundException('퇴원약을 찾을 수 없습니다.');

    const matches = await this.prisma.medicationCode.findMany({
      where: { nameKo: name, isActive: true },
      select: { id: true },
      take: 2,
    });
    if (matches.length !== 1) return { status: 'UNAVAILABLE' }; // 0건·동명 복수 = 오매칭 위험 → 폴백

    const medicationCodeId = matches[0].id;
    const cached = await this.getFreshCache(medicationCodeId);
    if (cached?.approved) return { status: 'READY', explain: this.assemble(cached, null, name) };
    if (cached) return { status: 'UNAVAILABLE', reason: 'PENDING_REVIEW' };
    const jobId = this.startJob(patientId, async () => {
      const row = await this.generateAndCache(medicationCodeId, name);
      return (row
        ? { status: 'UNAVAILABLE', reason: 'PENDING_REVIEW' } // 생성=검수 큐 적재, 노출은 승인 후
        : { status: 'UNAVAILABLE' }) satisfies ExplainResult;
    });
    return { status: 'PENDING', jobId };
  }

  // ── 처방전 단위: POST /portal/prescriptions/:encounterId/explain (항상 비동기 잡) ──

  async startEncounterExplain(patientId: string, encounterId: string): Promise<{ jobId: string }> {
    await this.assertEnabled();
    const enc = await this.prisma.encounter.findFirst({ where: { id: encounterId, patientId }, select: { id: true } });
    if (!enc) throw new NotFoundException('진료 기록을 찾을 수 없습니다.');
    const jobId = this.startJob(patientId, () => this.buildEncounterExplain(patientId, encounterId));
    return { jobId };
  }

  /** 잡 폴링 — 소유 대조가 정본(불일치·부재 = 404, jobId 추측 차단) */
  getJob(patientId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.patientId !== patientId) throw new NotFoundException('작업을 찾을 수 없습니다(만료되었을 수 있음).');
    return { status: job.status, result: job.result, error: job.error };
  }

  // ── P2 배선 교정: 포털용 약물 상호작용 프록시(직원 EP는 포털 토큰 401) ──

  async drugInteractions(drugs: string[]): Promise<unknown> {
    if (!this.medicalAi) return { error: true };
    try {
      return await this.medicalAi.drugInteractions(drugs.map((d) => drugNameForDur(d)).filter(Boolean));
    } catch (e) {
      this.logger.warn(`포털 약물상호작용 프록시 실패: ${e instanceof Error ? e.message : e}`);
      return { error: true };
    }
  }

  // ── 약사 승인(원내 약사 판단 전제 — 미승인=환자 비노출·재생성 시 리셋) ──

  async adminList(status: 'pending' | 'approved' | 'all' = 'all') {
    const where = status === 'pending' ? { approvedAt: null } : status === 'approved' ? { approvedAt: { not: null } } : {};
    const rows = await this.prisma.drugExplainCache.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const meds = await this.prisma.medicationCode.findMany({
      where: { id: { in: rows.map((r) => r.medicationCodeId) } },
      select: { id: true, code: true, nameKo: true },
    });
    const byId = new Map(meds.map((m) => [m.id, m]));
    return rows.map((r) => ({
      medicationCodeId: r.medicationCodeId,
      code: byId.get(r.medicationCodeId)?.code ?? null,
      nameKo: byId.get(r.medicationCodeId)?.nameKo ?? ((r.content as { drugName?: string })?.drugName ?? ''),
      itemCode: r.itemCode,
      sourceVersion: r.sourceVersion,
      generatedAt: (r.content as { generatedAt?: string })?.generatedAt ?? null,
      approvedAt: r.approvedAt,
      approvedBy: r.approvedBy,
    }));
  }

  /** 검수 상세 — 생성 내용 + e약은요 원문 대조 동봉(환각 확인용) */
  async adminDetail(medicationCodeId: string) {
    const row = await this.prisma.drugExplainCache.findUnique({ where: { medicationCodeId } });
    if (!row) throw new NotFoundException('생성된 설명이 없습니다.');
    const med = await this.prisma.medicationCode.findUnique({
      where: { id: medicationCodeId },
      select: { code: true, nameKo: true, insuranceCode: true },
    });
    const source = await this.resolver.resolve(medicationCodeId, row.itemCode).catch(() => null);
    return { ...row, med, source };
  }

  async adminApprove(medicationCodeId: string, userId: string) {
    try {
      await this.prisma.drugExplainCache.update({
        where: { medicationCodeId },
        data: { approvedAt: new Date(), approvedBy: userId },
      });
    } catch {
      throw new NotFoundException('생성된 설명이 없습니다.');
    }
    return { approved: true };
  }

  /** 반려 = 행 삭제 — 다음 요청 시 재생성되어 재검수 큐로(안전 측) */
  async adminReject(medicationCodeId: string) {
    await this.prisma.drugExplainCache.delete({ where: { medicationCodeId } }).catch(() => undefined);
    return { rejected: true };
  }

  // ── 캐시 ──

  /**
   * 캐시 조회 + 개정 확인(§5.2):
   * - createdAt(=마지막 확인 시각 겸용 — checked_at 컬럼은 DDL에 없어 createdAt으로 대체, 생성일은 content.generatedAt에 보존)
   *   30일 이내면 외부 호출 0으로 hit.
   * - 30일 경과 시 e약은요 1회 재조회(1-hop) → update_de 동일하면 createdAt만 리셋, 다르면 miss(재생성).
   * - 재조회 실패(AI 서버 다운 등)는 기존 캐시 유지(보수적).
   */
  private async getFreshCache(medicationCodeId: string): Promise<CacheRow | null> {
    const row = await this.prisma.drugExplainCache.findUnique({ where: { medicationCodeId } });
    if (!row) return null;
    const cache: CacheRow = {
      medicationCodeId: row.medicationCodeId,
      itemCode: row.itemCode,
      content: row.content as unknown as ExplainContent,
      sourceVersion: row.sourceVersion,
      approved: !!row.approvedAt,
    };
    const ageDays = (Date.now() - row.createdAt.getTime()) / 86_400_000;
    if (ageDays <= CACHE_RECHECK_DAYS) return cache;
    const info = await this.resolver.resolve(medicationCodeId, row.itemCode);
    if (!info) return cache;
    if ((info.updateDe ?? null) === (row.sourceVersion ?? null)) {
      await this.prisma.drugExplainCache.update({ where: { medicationCodeId }, data: { createdAt: new Date() } }).catch(() => undefined);
      return cache;
    }
    return null; // 개정 감지 → 재생성
  }

  /** resolve → LLM → 금칙어 후처리 → 캐시 upsert. 실패/근거 부재 = null(UNAVAILABLE — 생성 금지) */
  private async generateAndCache(medicationCodeId: string, drugName: string): Promise<CacheRow | null> {
    const hint = (await this.prisma.drugExplainCache.findUnique({ where: { medicationCodeId }, select: { itemCode: true } }))?.itemCode;
    const info = await this.resolver.resolve(medicationCodeId, hint);
    if (!info) return null;

    let parsed: Record<string, unknown>;
    try {
      const raw = await this.llmGenerate(this.buildDrugPrompt(drugName, info));
      parsed = this.extractJson<Record<string, unknown>>(raw);
    } catch (e) {
      this.logger.warn(`약 설명 생성 실패(${medicationCodeId}): ${e instanceof Error ? e.message : e}`);
      return null;
    }
    const sanitized = sanitizeExplainContent(parsed);
    if (!sanitized) return null;

    const content: ExplainContent = {
      ...sanitized,
      drugName,
      generatedAt: new Date().toISOString(),
      disclaimer: info.disclaimer ?? null,
    };
    const data = {
      itemCode: info.itemCode,
      content: content as unknown as object,
      sourceVersion: info.updateDe ?? null,
      createdAt: new Date(),
      // 신규 생성·재생성(개정) 모두 승인 리셋 — 약사 승인 전 환자 비노출(안전 측)
      approvedBy: null,
      approvedAt: null,
    };
    await this.prisma.drugExplainCache.upsert({
      where: { medicationCodeId },
      create: { medicationCodeId, ...data },
      update: data,
    });
    return { medicationCodeId, itemCode: info.itemCode, content, sourceVersion: info.updateDe ?? null, approved: false };
  }

  /** 캐시(①③④ 환자 무관) + ②용법(처방별 템플릿 조립 — LLM 불필요) → 응답 조립 */
  private assemble(cache: CacheRow, rx: RxLite | null, drugName: string): Record<string, unknown> {
    // rx=null(퇴원약 명칭 진입 — 처방 레코드 없음)이면 용법은 퇴원 안내 폴백 문구
    const slots = rx ? parseFrequencySlots(rx.frequency) : [];
    const usageParts = rx
      ? [
          rx.dosage ? `1회 ${rx.dosage}` : null,
          slots.length ? `하루 ${slots.length}회(${slots.join(' · ')})` : null,
          rx.duration ? `${rx.duration}일 동안` : null,
          rx.route && rx.route !== 'PO' ? `투여 경로: ${rx.route}` : null,
        ].filter(Boolean)
      : [];
    const c = cache.content;
    return {
      prescriptionId: rx?.id ?? null,
      drugName: c.drugName || drugName,
      purpose: c.purpose,
      usage: rx
        ? { text: usageParts.join(', ') || '처방전의 용법을 따라 주세요.', slots, dosage: rx.dosage, duration: rx.duration, route: rx.route }
        : { text: '퇴원 안내문의 용법을 따라 주세요.', slots: [], dosage: null, duration: null, route: null },
      cautions: c.cautions,
      sideEffects: c.sideEffects,
      whenToCall: c.whenToCall,
      source: {
        name: '식약처 e약은요',
        updateDe: cache.sourceVersion,     // 사실 출처 개정일(§6.5-③)
        generatedAt: c.generatedAt ?? null, // WeRU.B 생성일(캐시 응답도 원 생성일 유지)
        itemCode: cache.itemCode,
      },
      disclaimer: c.disclaimer ?? null, // 서버 동봉 정본 우선(§6.5-④) — null이면 FE 기본 문구
    };
  }

  // ── 처방전 단위 잡 본체 — 약별 캐시 재사용 + 신규분만 LLM + DUR(명칭 배열) 쉬운 말 1회 + 복용 스케줄 표 ──

  private async buildEncounterExplain(patientId: string, encounterId: string): Promise<Record<string, unknown>> {
    const rxs = await this.prisma.prescription.findMany({
      // 환자에게 설명하는 복약 일정 — 취소·중단(2026-09-30)된 약은 뺀다(중단된 약을 계속 먹으라고 안내하지 않는다)
      where: { encounterId, type: 'MEDICATION', status: 'ACTIVE' },
      select: {
        id: true, dosage: true, frequency: true, duration: true, route: true, medicationCodeId: true,
        medicationCode: { select: { nameKo: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!rxs.length) return { status: 'UNAVAILABLE' };

    // 약별 설명 — 동일 약 중복 생성 방지(코드 단위 1회)
    const byCode = new Map<string, CacheRow | null>();
    const items: Record<string, unknown>[] = [];
    for (const rx of rxs) {
      const name = rx.medicationCode?.nameKo ?? '';
      if (!rx.medicationCodeId) {
        items.push({ prescriptionId: rx.id, drugName: name, status: 'UNAVAILABLE' });
        continue;
      }
      if (!byCode.has(rx.medicationCodeId)) {
        let row = await this.getFreshCache(rx.medicationCodeId);
        if (!row) row = await this.generateAndCache(rx.medicationCodeId, name); // 신규분만 LLM(순차) — 검수 큐 적재
        byCode.set(rx.medicationCodeId, row);
      }
      const row = byCode.get(rx.medicationCodeId) ?? null;
      items.push(
        row?.approved
          ? { prescriptionId: rx.id, drugName: row.content.drugName || name, status: 'READY', explain: this.assemble(row, rx, name) }
          : row
            ? { prescriptionId: rx.id, drugName: name, status: 'PENDING_REVIEW' } // 약사 승인 대기 — 비노출
            : { prescriptionId: rx.id, drugName: name, status: 'UNAVAILABLE' },
      );
    }

    // DUR — 명칭 배열 입력(EDI 코드는 resolved:false 실측 §5.6-⑤) + 쉬운 말 1회
    const dur = await this.checkDurEasy(patientId, rxs.map((r) => r.medicationCode?.nameKo).filter((n): n is string => !!n));

    // 복용 스케줄 표(템플릿 — LLM 불필요)
    const schedule = rxs.map((rx) => ({
      prescriptionId: rx.id,
      drugName: rx.medicationCode?.nameKo ?? '',
      dosage: rx.dosage,
      slots: parseFrequencySlots(rx.frequency),
      duration: rx.duration,
    }));

    return { status: 'READY', items, dur, schedule };
  }

  /** DUR 8종 점검 → 원 유형명 배지 병기(§6.5-⑤) + 쉬운 말 LLM 1회(실패 시 원문 유지) */
  private async checkDurEasy(patientId: string, names: string[]): Promise<Record<string, unknown> | null> {
    if (!this.medicalAi || !names.length) return null;
    try {
      const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { dateOfBirth: true } });
      const age = patient?.dateOfBirth
        ? Math.max(0, ageOf(patient.dateOfBirth) ?? 0)
        : undefined;
      const drugs = [...new Set(names.map(drugNameForDur).filter(Boolean))];
      const res = (await this.medicalAi.durCheck({ drugs, ...(age != null ? { age } : {}) })) as Record<string, unknown>;
      const rawWarnings = ([] as Record<string, unknown>[]).concat(
        (Array.isArray(res?.warnings) ? res.warnings : []) as Record<string, unknown>[],
        (Array.isArray(res?.results) ? res.results : []) as Record<string, unknown>[],
        (Array.isArray(res?.alerts) ? res.alerts : []) as Record<string, unknown>[],
      );
      const notes = rawWarnings.slice(0, 10).map((w) => ({
        type: String(w.type ?? w.check ?? w.category ?? 'DUR'),
        drugs: Array.isArray(w.drugs) ? w.drugs.map(String) : [w.drug, w.drug_a, w.drug_b].filter(Boolean).map(String),
        detail: String(w.description ?? w.message ?? w.detail ?? ''),
        easy: null as string | null,
      }));
      if (notes.length) {
        try {
          const listing = notes.map((n, i) => `${i + 1}. [${n.type}] ${n.drugs.join(', ')}: ${n.detail}`).join('\n');
          const raw = await this.llmGenerate(this.buildDurPrompt(listing), 60_000);
          const parsed = this.extractJson<{ notes?: unknown }>(raw);
          const easy = filterForbiddenLines(parsed.notes);
          notes.forEach((n, i) => { n.easy = easy[i] ?? null; });
        } catch { /* 쉬운 말 실패 시 원문 유지 */ }
      }
      return {
        checked: true,
        drugs,
        notes,
        disclaimer: typeof res?.disclaimer === 'string' ? res.disclaimer : null, // 서버 정본(§6.5-④)
      };
    } catch (e) {
      this.logger.warn(`DUR 점검 실패: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  // ── 프롬프트 ──

  private cut(s: string | undefined, max = 1500): string {
    return (s ?? '').slice(0, max);
  }

  /** 약 단위 그라운딩 프롬프트(§5.4) — 원문 강제·금지 지시·용어 풀어쓰기·JSON 강제 */
  private buildDrugPrompt(drugName: string, info: EDrugInfo): string {
    return (
      `당신은 병원 환자포털의 복약 안내 도우미다. 아래 식약처 e약은요 [원문]만을 근거로, 환자가 이해하기 쉬운 설명을 만들어라.\n\n` +
      `규칙:\n` +
      `1. 원문에 없는 내용은 절대 만들지 마라(추측·일반 상식 보충 금지).\n` +
      `2. 진단하는 문장, 효과를 판정하는 문장, 용법 변경을 권고하는 문장(복용 중단·용량 조절·다른 약 대체 권유)은 금지.\n` +
      `3. 초등학생도 이해할 수 있는 짧고 쉬운 한국어 문장으로 써라.\n` +
      `4. 의학 약어와 괄호 안 영어(예: CABG, PTCA)는 쉬운 말로 풀어 쓰거나 생략하라.\n` +
      `5. JSON만 출력하라. JSON 앞뒤에 다른 텍스트를 붙이지 마라.\n\n` +
      `출력 형식: {"purpose":"이 약이 무슨 약인지 1~3문장","cautions":["주의할 점(각 1문장)"],"sideEffects":["나타날 수 있는 증상(각 1문장)"],"whenToCall":["병원이나 약국에 연락해야 하는 경우(각 1문장)"]}\n\n` +
      `약 이름: ${drugName}\n\n` +
      `[원문 — 효능]\n${this.cut(info.efficacy)}\n\n` +
      `[원문 — 사용법]\n${this.cut(info.usage)}\n\n` +
      `[원문 — 사용 전 주의]\n${this.cut(info.warn)}\n\n` +
      `[원문 — 주의사항]\n${this.cut(info.precaution)}\n\n` +
      `[원문 — 상호작용]\n${this.cut(info.interaction)}\n\n` +
      `[원문 — 부작용]\n${this.cut(info.sideEffect)}\n\n` +
      `[원문 — 보관법]\n${this.cut(info.storage)}`
    );
  }

  /** DUR 결과 쉬운 말 변환 프롬프트 — 경고 강도 희석 금지(§6.5-⑤) */
  private buildDurPrompt(listing: string): string {
    return (
      `아래는 약물 안전 점검(DUR) 결과다. 각 항목을 환자가 이해하기 쉬운 한국어 한 문장으로 바꿔라.\n` +
      `규칙: 원문의 의미와 경고 수준을 유지하라(약화 금지). 진단, 복용 중단, 용량 변경을 지시하는 표현은 금지. ` +
      `"의사나 약사와 상의하세요" 같은 안내는 허용. JSON만 출력: {"notes":["항목1 쉬운 문장","항목2 쉬운 문장"]} (입력 순서 유지)\n\n` +
      `[점검 결과]\n${listing}`
    );
  }

  // ── LLM 호출(포뮬러리 llmGenerate/extractJson 자체 복제 — §0 결정: 공용 유틸 추출 금지) ──

  /** Ollama generate — 프록시가 stream:false를 무시하고 NDJSON 스트리밍 반환하므로 라인 병합 필수(§5.6-⑦ 실증) */
  private async llmGenerate(prompt: string, timeoutMs = 120_000): Promise<string> {
    const cfgs = await this.prisma.systemConfig.findMany({ where: { key: { in: ['ai.server.url', 'ai.server.gpuKey', 'ai.server.enabled'] } } });
    const cfg = new Map(cfgs.map((c) => [c.key, c.value as string]));
    // 🔴 kill switch — 꺼져 있으면 보내지 않는다(r3 B6 · 정본 common/util/ai-kill-switch)
    if (!isAiServerEnabled(cfg.get('ai.server.enabled'))) throw aiDisabledException();
    // 🔴 배포 환경변수가 DB 설정을 이긴다 — 정본 `common/config-env-overrides`
    const url = configEnvOverride('ai.server.url') ?? (cfg.get('ai.server.url') ?? ''); // P0-6
    const key = cfg.get('ai.server.gpuKey') ?? '';
    // 미설정과 '허용되지 않음'은 다른 사실이다.
    if (!url.trim()) throw new Error('AI 서버 미설정(ai.server.url)');
    // G3: 목적지 검증 + 경계 통과 감사(정본 common/util/ai-egress-fetch).
    const res = await aiEgressFetch(url, '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt, stream: false, options: { temperature: 0.1 } }),
      signal: AbortSignal.timeout(timeoutMs),
    }, { client: 'portal/drug-explain' });
    if (!res.ok) throw new Error(`AI 서버 오류: ${res.status}`);
    const raw = await res.text();
    let full = '';
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        full += (JSON.parse(t) as { response?: string }).response ?? '';
      } catch { /* skip */ }
    }
    return full;
  }

  /**
   * 첫 JSON 객체만 중괄호 짝으로 추출 — JSON 뒤 부가 텍스트(§5.6-⑦)뿐 아니라
   * 두 번째 JSON 객체가 붙는 경우도 실측(2026-07-07 검수 배치) — last-} 방식은 "Extra data" 실패
   */
  private extractJson<T>(text: string): T {
    const start = text.indexOf('{');
    if (start < 0) throw new Error('AI 응답 파싱 실패');
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1)) as T;
      }
    }
    throw new Error('AI 응답 파싱 실패');
  }

  // ── 잡 스토어(포뮬러리 패턴 복제 + patientId 바인딩) ──

  private startJob(patientId: string, work: () => Promise<unknown>): string {
    for (const [k, v] of this.jobs) if (Date.now() - v.at > JOB_TTL_MS) this.jobs.delete(k); // 30분 GC
    const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.jobs.set(jobId, { patientId, status: 'RUNNING', at: Date.now() });
    work()
      .then((result) => this.jobs.set(jobId, { patientId, status: 'DONE', result, at: Date.now() }))
      .catch((e: Error) => this.jobs.set(jobId, { patientId, status: 'ERROR', error: e.message, at: Date.now() }));
    return jobId;
  }
}
