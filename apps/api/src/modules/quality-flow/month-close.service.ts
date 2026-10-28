import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CPOE_QI_KEYS, qiChartKindFor, qiControlChart, type CpoeQiKey, type PChartPointInput, type QiSupplierKey } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { monthRangeLocal } from '../../common/day-range';
import { QualityService } from '../quality/quality.service';
import { IndicatorSupplierService } from '../quality/indicator-supplier.service';
import { ACTIVE_MEASUREMENT, primaryPerPeriod } from '../quality/measurement-read';
import { evaluateMeetTarget, resolveIndicatorPolicy } from '../quality/indicator-policy';
import { CpoeQualityService } from '../cpoe-quality/cpoe-quality.service';

export interface MonthCloseResult {
  period: string;
  trigger: 'CRON' | 'MANUAL';
  recorded: Array<{ indicatorId: string; name: string; numerator: number; denominator: number }>;
  existing: Array<{ indicatorId: string; name: string }>;
  unavailable: Array<{ indicatorId: string; name: string; reason: string }>;
  cpoe: Array<{ key: string; status: 'RECORDED' | 'EXISTS' | 'SKIPPED'; reason?: string }>;
  manualMissing: Array<{ indicatorId: string; name: string }>;
  targetMissed: Array<{ indicatorId: string; name: string; value: number; target: number }>;
  /** 병동 층 — 기록한 칸 수 · 병동이 비어 어느 층에도 넣지 않은 사고 수(지표별) */
  strata: Array<{ indicatorId: string; name: string; recorded: number; existing: number; unassignedIncidents: number; reason: string | null }>;
}

/**
 * 질 지표 월 마감(QI 흐름 2026-10-08) — 측정 → 판정 → 경보까지 한 번에.
 *
 *  · 공급원 있는 지표: 원장에서 다시 세어 출처 AUTO 로 기록(수기 행은 덮지 않는다 · 같은 달 자동 행이 이미 있으면 그대로)
 *  · CPOE 지표: 처방·오더 원장 재집계(원장에 등록된 지표만)
 *  · 공급원 없는 지표: 측정이 없으면 "수기 미입력"으로 알린다(채우지 않는다)
 *  · 판정: 그 달 정본 행(결정 qi.autoManual.precedence)으로 — 미달은 담당·관리자에게 알린다(판정 불가는 알리지 않는다)
 *  · 매월 1일 06:30 — **설정 qi.autoMeasure.enabled 가 켜졌을 때만**(결정 qi.autoMeasure.enable). 관리자 수동 실행은 설정과 무관(사람의 행위)
 */
@Injectable()
export class MonthCloseService {
  private readonly logger = new Logger(MonthCloseService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly quality: QualityService,
    private readonly suppliers: IndicatorSupplierService,
    private readonly cpoe: CpoeQualityService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  private assertClosedMonth(period: string, now = new Date()) {
    const { end } = monthRangeLocal(period);
    if (end > now) throw new BadRequestException({ code: 'QI_MONTH_OPEN', message: '아직 끝나지 않은 달입니다 — 끝난 달만 마감합니다', period });
  }

  /** 한 지표·한 달 미리보기(쓰지 않는다) — 공급원 결과와 그 달 원장 행 */
  async preview(indicatorId: string, period: string) {
    const ind = await this.prisma.qualityIndicator.findUnique({ where: { id: indicatorId } });
    if (!ind) throw new NotFoundException('질 지표를 찾을 수 없습니다');
    const range = this.suppliers.monthRange(period);
    const supply = await this.suppliers.supplyForIndicator(ind, range);
    const rows = await this.prisma.qiMeasurement.findMany({ where: { indicatorId, period, ...ACTIVE_MEASUREMENT }, orderBy: { sourceKey: 'asc' } });
    // 병동 층(분석용) — 판정에 쓰지 않는다
    const strataRows = await this.prisma.qiMeasurement.findMany({ where: { indicatorId, period, voidedAt: null, stratumKey: { not: '' } }, orderBy: { stratumKey: 'asc' } });
    const wards = strataRows.length ? await this.prisma.ward.findMany({ where: { id: { in: strataRows.map((r) => r.stratumKey) } }, select: { id: true, name: true } }) : [];
    const wardName = new Map(wards.map((w) => [w.id, w.name]));
    const policy = resolveIndicatorPolicy(ind);
    return {
      indicator: { id: ind.id, name: ind.name, supplierKey: this.suppliers.supplierOf(ind), unit: policy.unit, valueScale: policy.valueScale },
      period, supply,
      ledger: rows.map((r) => ({ id: r.id, source: r.source, sourceKey: r.sourceKey, numerator: r.numerator, denominator: r.denominator, value: Number(r.value) })),
      strata: strataRows.map((r) => ({ id: r.id, wardKey: r.stratumKey, wardName: wardName.get(r.stratumKey) ?? null, source: r.source, numerator: r.numerator, denominator: r.denominator, value: Number(r.value) })),
    };
  }

  async closeMonth(period: string, opts: { trigger: 'CRON' | 'MANUAL'; actorId?: string }): Promise<MonthCloseResult> {
    this.assertClosedMonth(period);
    const out: MonthCloseResult = { period, trigger: opts.trigger, recorded: [], existing: [], unavailable: [], cpoe: [], manualMissing: [], targetMissed: [], strata: [] };
    const range = this.suppliers.monthRange(period);
    const indicators = await this.prisma.qualityIndicator.findMany({ where: { isActive: true } });
    for (const ind of indicators) {
      const key = this.suppliers.supplierOf(ind);
      if (!key) continue;
      const r = await this.suppliers.supply(key, range);
      if (!r.available) { out.unavailable.push({ indicatorId: ind.id, name: ind.name, reason: r.reason }); continue; }
      try {
        await this.quality.addMeasurement({
          indicatorId: ind.id, period, numerator: r.numerator, denominator: r.denominator,
          source: 'AUTO', computedBy: `supplier:${key}`, evidence: r.evidence, createdBy: opts.actorId,
        });
        out.recorded.push({ indicatorId: ind.id, name: ind.name, numerator: r.numerator, denominator: r.denominator });
        await this.recordStrata(ind, key, period, range, opts.actorId, out);
      } catch (e) {
        const code = (e as { response?: { code?: string } })?.response?.code;
        if (e instanceof ConflictException && code === 'QI_MEASUREMENT_EXISTS') out.existing.push({ indicatorId: ind.id, name: ind.name });
        else out.unavailable.push({ indicatorId: ind.id, name: ind.name, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    for (const key of CPOE_QI_KEYS as readonly CpoeQiKey[]) {
      try {
        await this.cpoe.recordMonth(key, period, new Date(), opts.actorId);
        out.cpoe.push({ key, status: 'RECORDED' });
      } catch (e) {
        const code = (e as { response?: { code?: string } })?.response?.code;
        if (code === 'QI_MEASUREMENT_EXISTS') out.cpoe.push({ key, status: 'EXISTS' });
        else out.cpoe.push({ key, status: 'SKIPPED', reason: code ?? (e instanceof Error ? e.message : String(e)) });
      }
    }
    // 판정·누락 — 그 달 병원 전체 정본 행으로
    const precedence = await this.quality.precedence();
    const rows = await this.prisma.qiMeasurement.findMany({ where: { period, ...ACTIVE_MEASUREMENT }, select: { id: true, indicatorId: true, period: true, value: true, sourceKey: true } });
    for (const ind of indicators) {
      const mine = rows.filter((r) => r.indicatorId === ind.id);
      const head = primaryPerPeriod(mine, precedence)[0];
      if (!head) {
        if (!this.suppliers.supplierOf(ind)) out.manualMissing.push({ indicatorId: ind.id, name: ind.name });
        continue;
      }
      const policy = resolveIndicatorPolicy(ind);
      const value = Number(head.primary.value);
      const target = Number(ind.targetValue);
      if (evaluateMeetTarget(value, target, policy.direction) === false) out.targetMissed.push({ indicatorId: ind.id, name: ind.name, value, target });
    }
    const owners = new Map(indicators.map((i) => [i.id, i.ownerId]));
    for (const t of out.targetMissed) this.events?.emit('qi.target.missed', { ...t, period, ownerId: owners.get(t.indicatorId) ?? null });
    for (const m of out.manualMissing) this.events?.emit('qi.measurement.missing', { ...m, period, ownerId: owners.get(m.indicatorId) ?? null });
    this.logger.log(`QI 월 마감 ${period}(${opts.trigger}) — 기록 ${out.recorded.length} · 기존 ${out.existing.length} · 산출 불가 ${out.unavailable.length} · 수기 미입력 ${out.manualMissing.length} · 미달 ${out.targetMissed.length}`);
    return out;
  }

  /** 병동 층 기록 — 판정·경보는 병원 전체 칸만(층은 분석용) · 이미 있는 칸은 그대로 */
  private async recordStrata(ind: { id: string; name: string }, key: QiSupplierKey, period: string, range: { from: Date; to: Date }, actorId: string | undefined, out: MonthCloseResult) {
    const w = await this.suppliers.supplyWardStrata(key, range);
    if (w.reason === 'NOT_STRATIFIABLE') return;
    const row = { indicatorId: ind.id, name: ind.name, recorded: 0, existing: 0, unassignedIncidents: w.unassignedIncidents, reason: w.reason };
    for (const st of w.strata) {
      try {
        await this.quality.addMeasurement({
          indicatorId: ind.id, period, numerator: st.numerator, denominator: st.denominator, stratumKey: st.wardKey,
          source: 'AUTO', computedBy: `supplier:${key}:ward`, evidence: { stratum: 'WARD', wardKey: st.wardKey, denominatorSource: 'patient_day_snapshots', numeratorSource: 'safety_incidents(ward_id)' }, createdBy: actorId,
        });
        row.recorded++;
      } catch (e) {
        const code = (e as { response?: { code?: string } })?.response?.code;
        if (code === 'QI_MEASUREMENT_EXISTS') row.existing++;
        // 층 기록 실패가 병원 전체 칸(이미 기록됨)을 "산출 불가"로 바꾸지 않게 — 층 줄에 실패로 남긴다
        else row.reason = code ?? 'STRATUM_WRITE_FAILED';
      }
    }
    out.strata.push(row);
  }

  /** 지표 관리도 — 병원 전체 정본 행(최근 24개월) · 지표 종류대로 p/u */
  async spc(indicatorId: string, months = 24) {
    const ind = await this.prisma.qualityIndicator.findUnique({ where: { id: indicatorId } });
    if (!ind) throw new NotFoundException('질 지표를 찾을 수 없습니다');
    const rows = await this.prisma.qiMeasurement.findMany({ where: { indicatorId, ...ACTIVE_MEASUREMENT }, orderBy: { period: 'desc' }, take: months * 2 });
    const precedence = await this.quality.precedence();
    const series = primaryPerPeriod(rows, precedence).slice(0, months).reverse();
    const points: PChartPointInput[] = series.map((x) => ({ period: x.period, numerator: x.primary.numerator, denominator: x.primary.denominator }));
    const policy = resolveIndicatorPolicy(ind);
    const supplierKey = this.suppliers.supplierOf(ind);
    const kind = qiChartKindFor(supplierKey, points, policy.valueScale);
    return {
      indicator: { id: ind.id, name: ind.name, unit: policy.unit, valueScale: policy.valueScale, target: Number(ind.targetValue), direction: policy.direction, supplierKey },
      kind, precedence,
      sources: series.map((x) => ({ period: x.period, source: x.primary.source ?? null, hasAlternate: !!x.alternate })),
      chart: qiControlChart(kind, points),
    };
  }

  /** 매월 1일 06:30 — 설정이 켜졌을 때만 전월 마감 */
  @Cron('30 6 1 * *', { name: 'qi-month-close' })
  async monthly() {
    let enabled = false;
    try { enabled = (await this.config?.get('qi.autoMeasure.enabled')) === true; } catch (e) {
      this.logger.error(`QI 월 마감 설정 확인 실패 — 실행하지 않음: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!enabled) return;
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    try { await this.closeMonth(period, { trigger: 'CRON' }); } catch (e) {
      this.logger.error(`QI 월 마감 실패(${period}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
