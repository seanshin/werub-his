import { Injectable } from '@nestjs/common';
import { CLINICAL_RULES_LEDGER, type LedgerCardValue } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { FormularyGateService } from '../formulary/formulary-gate.service';
import { rowsToRuleSet } from '../prescription/dur/dur-rules.repo';
import { decisionRecordKey, isSeedDecisionRecord } from '../decision-registry/decision.service';

const DAY = 86_400_000;
const maxDate = (...ds: Array<Date | null | undefined>) => {
  const t = ds.filter((d): d is Date => !!d).map((d) => d.getTime());
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
};

/**
 * 임상 규칙 대장(화면 3417 · 2026-10-21 임상 규칙·템플릿 P4 B1) — 10개 카탈로그를 한 장에.
 *  · 지표 코드·라벨 정본 = shared `clinical-rules-ledger`(서버는 코드와 값만)
 *  · 🔴 카드마다 따로 계산한다 — 한 카드 조회가 실패하면 그 카드만 `metrics: null`(확인 불가 · 0 아님), 다른 카드는 그대로
 *  · 소유 위원회는 결정 `catalog.ownership` 기록에서(개발 시드면 그렇다고) · 재검토 기한은 아직 없다(기획 P5)
 */
@Injectable()
export class ClinicalRulesLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
    private readonly formularyGate: FormularyGateService,
  ) {}

  private readonly compute: Record<string, () => Promise<Omit<LedgerCardValue, 'key'>>> = {
    ORDER_SET: async () => {
      const since = new Date(Date.now() - 90 * DAY);
      const [active, draft, noApprover, linked, usage90d, last] = await Promise.all([
        this.prisma.orderSet.count({ where: { isActive: true, status: 'ACTIVE' } }),
        this.prisma.orderSet.count({ where: { isActive: true, status: 'DRAFT' } }),
        this.prisma.orderSet.count({ where: { isActive: true, status: 'ACTIVE', approvedBy: null } }),
        this.prisma.orderSet.count({ where: { isActive: true, status: 'ACTIVE', OR: [{ diagnosisCode: { not: null } }, { diagnoses: { some: {} } }] } }),
        this.prisma.orderSetUsage.count({ where: { usedAt: { gte: since } } }),
        this.prisma.orderSet.aggregate({ _max: { updatedAt: true } }),
      ]);
      return { metrics: { active, draft, activeNoApprover: noApprover, activeNoDiagnosis: active - linked, usage90d }, lastChangedAt: maxDate(last._max.updatedAt) };
    },
    TREATMENT_TEMPLATE: async () => {
      const [active, draft, noApprover, schedules, last] = await Promise.all([
        this.prisma.treatmentScheduleTemplate.count({ where: { isActive: true, status: 'ACTIVE' } }),
        this.prisma.treatmentScheduleTemplate.count({ where: { isActive: true, status: 'DRAFT' } }),
        this.prisma.treatmentScheduleTemplate.count({ where: { isActive: true, status: 'ACTIVE', approvedBy: null } }),
        this.prisma.patientTreatmentSchedule.count({ where: { status: 'ACTIVE' } }),
        this.prisma.treatmentScheduleTemplate.aggregate({ _max: { updatedAt: true } }),
      ]);
      return { metrics: { active, draft, activeNoApprover: noApprover, schedulesActive: schedules }, lastChangedAt: maxDate(last._max.updatedAt) };
    },
    FORMULARY: async () => {
      const [itemsActive, itemsSuspended, requestsPending, policy, last] = await Promise.all([
        this.prisma.formularyItem.count({ where: { status: 'ACTIVE' } }),
        this.prisma.formularyItem.count({ where: { status: 'SUSPENDED' } }),
        this.prisma.formularyRequest.count({ where: { status: 'PENDING' } }),
        this.formularyGate.getPolicy(),
        this.prisma.formularyItem.aggregate({ _max: { updatedAt: true } }),
      ]);
      const enforcedDomains = Object.values(policy).filter((m) => m !== 'OFF').length;
      return { metrics: { itemsActive, itemsSuspended, requestsPending, enforcedDomains }, lastChangedAt: maxDate(last._max.updatedAt) };
    },
    DUR: async () => {
      const from = new Date(Date.now() - 90 * DAY);
      const [rows, legacy, since, hits, last] = await Promise.all([
        this.prisma.durRule.findMany({ where: { isActive: true } }),
        this.prisma.cdssRule.count({ where: { isActive: true } }),
        this.prisma.$queryRaw<Array<{ since: Date | null }>>`
          SELECT MIN(p.created_at) AS since FROM prescriptions p, jsonb_array_elements(p.dur_warnings) e
          WHERE jsonb_typeof(p.dur_warnings) = 'array' AND e ? 'ruleId'`.then((r) => r[0]?.since ?? null),
        this.prisma.$queryRaw<Array<{ n: number }>>`
          SELECT COUNT(*)::int AS n FROM prescriptions p, jsonb_array_elements(p.dur_warnings) e
          WHERE jsonb_typeof(p.dur_warnings) = 'array' AND e ? 'ruleId' AND p.created_at >= ${from}`.then((r) => r[0]?.n ?? 0),
        this.prisma.durRule.aggregate({ _max: { updatedAt: true } }),
      ]);
      const set = rowsToRuleSet(rows as never);
      const fallbackTypes = (['interaction', 'age', 'maxDose', 'beers', 'pediatric'] as const).filter((k) => !set[k].length).length;
      // 계측 전이면 적중은 모른다(null)
      return { metrics: { rulesActive: rows.length, fallbackTypes, hits90d: since ? hits : null, legacyUnused: legacy }, lastChangedAt: maxDate(last._max.updatedAt) };
    },
    PROTOCOL: async () => {
      const [templatesActive, instancesActive, last] = await Promise.all([
        this.prisma.protocolTemplate.count({ where: { status: 'ACTIVE' } }),
        this.prisma.protocolInstance.count({ where: { status: 'ACTIVE' } }),
        this.prisma.protocolTemplate.aggregate({ _max: { publishedAt: true, createdAt: true } }),
      ]);
      // 프로토콜은 판으로 발행된다 — 마지막 발행·생성 시각
      return { metrics: { templatesActive, instancesActive }, lastChangedAt: maxDate(last._max?.publishedAt, last._max?.createdAt) };
    },
    PRESCRIBER: async () => {
      const r = (await this.config.get('prescription.prescriberRules')) as { enabled?: unknown; allowDelegate?: unknown } | null;
      // 설정 모양을 모르면 지어내지 않는다
      const b = (v: unknown) => (typeof v === 'boolean' ? v : null);
      return { metrics: { enabled: b(r?.enabled), allowDelegate: b(r?.allowDelegate) }, lastChangedAt: null };
    },
    CHART_TEMPLATE: async () => {
      const [templates, versions, last] = await Promise.all([
        this.prisma.chartTemplate.count({ where: { isActive: true } }),
        this.prisma.chartTemplateVersion.count(),
        this.prisma.chartTemplate.aggregate({ _max: { updatedAt: true } }),
      ]);
      return { metrics: { templates, versions }, lastChangedAt: maxDate(last._max.updatedAt) };
    },
    FORM: async () => {
      const [schemas, submissions, last] = await Promise.all([
        this.prisma.formSchema.count({ where: { isActive: true } }),
        this.prisma.formSubmission.count(),
        this.prisma.formSchema.aggregate({ _max: { updatedAt: true } }),
      ]);
      return { metrics: { schemas, submissions }, lastChangedAt: maxDate(last._max.updatedAt) };
    },
    CHART_VERIFY: async () => {
      const rows = await this.prisma.clinicalChartVerification.findMany({ select: { chartId: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
      const latest = new Map<string, string>();
      for (const r of rows) if (!latest.has(r.chartId)) latest.set(r.chartId, r.status);
      const verifiedCharts = [...latest.values()].filter((s) => s === 'VERIFIED').length;
      return { metrics: { verifiedCharts, records: rows.length }, lastChangedAt: rows[0] ? rows[0].createdAt.toISOString() : null };
    },
    TRIAGE: async () => {
      const [rulesActive, symptoms, aliases, hits, last] = await Promise.all([
        this.prisma.triageRule.count({ where: { isActive: true } }),
        this.prisma.triageSymptom.count(),
        this.prisma.triageAlias.count(),
        this.prisma.triageRule.aggregate({ _sum: { hitCount: true } }),
        this.prisma.triageRule.aggregate({ _max: { updatedAt: true } }),
      ]);
      return { metrics: { rulesActive, symptoms, aliases, hits: hits._sum.hitCount ?? 0 }, lastChangedAt: maxDate(last._max.updatedAt) };
    },
  };

  async ledger() {
    const results = await Promise.allSettled(CLINICAL_RULES_LEDGER.map((c) => this.compute[c.key]()));
    const cards: LedgerCardValue[] = CLINICAL_RULES_LEDGER.map((c, i) => {
      const r = results[i];
      return r.status === 'fulfilled' ? { key: c.key, ...r.value } : { key: c.key, metrics: null, lastChangedAt: null };
    });
    const own = await this.prisma.systemConfig.findUnique({ where: { key: decisionRecordKey('catalog.ownership') }, select: { value: true } }).then(
      (row) => {
        const v = row?.value as { choice?: string } | null;
        return { choice: v?.choice ?? null, seeded: v ? isSeedDecisionRecord(v as never) : false, known: true as const };
      },
      () => ({ choice: null, seeded: false, known: false as const }),
    );
    return { cards, ownership: own, reviewDue: null as null };
  }
}
