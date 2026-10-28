import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canTransitQiAction, cpoeQiDef, joinPatientName, proportionDiff,
  type CpoeQiKey, type QiActionStatus,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { dateOnlyValue, dayRange } from '../../common/day-range';
import { resolveIndicatorPolicy, resolveRegistryDirection } from '../quality/indicator-policy';
import { IndicatorSupplierService } from '../quality/indicator-supplier.service';
import { CpoeQualityService } from './cpoe-quality.service';

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 366;
const OPEN: QiActionStatus[] = ['PLAN', 'DO', 'CHECK', 'ACT'];

/**
 * 질 개선 활동(PDCA) — 질 지표 신호에서 시작해 효과를 다시 재고 닫는다.
 *
 * 2026-10-08(QI 흐름) — CPOE 지표만 열 수 있던 것을 **질 지표 원장의 모든 지표**로 넓혔다.
 *   · CPOE 지표(indicatorKey) → 처방·오더 원장 재집계(CpoeQualityService.countPeriod)
 *   · 공급원이 있는 지표(indicatorId · 낙상·손위생 등) → IndicatorSupplierService 재집계(분모 결정 전이면 거절·이유)
 *   · 공급원 없는 지표 → 사람이 센 분자·분모(baselineSource MANUAL) — 화면이 "수기 기준선"이라고 밝힌다
 *
 * 🔴 기준선·효과 확인 수는 **서버가 원장에서 병원 전체로 다시 센다**(화면이 보낸 수를 쓰지 않는다).
 * 🔴 CHECK → ACT 는 효과 확인 기록이 있어야 한다 — 재지 않고 "개선됐다"로 넘어가지 않는다.
 * 🔴 효과 확인은 기준선 기간이 끝난 뒤의 기간만 — 겹치면 전후 비교가 아니다.
 * 🔴 판정어를 만들지 않는다 — 차이와 95% 구간·표본 크기만(구간이 0 을 포함하면 "변화 확인 불가").
 * 🔴 경과는 덧붙이기만(QiImprovementEvent) — 상태를 바꾼 사람·때·사유가 남는다.
 */
@Injectable()
export class CpoeImprovementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quality: CpoeQualityService,
    private readonly suppliers: IndicatorSupplierService,
  ) {}

  /**
   * 기간 분자·분모 — 활동의 지표 종류대로. 공급원이 값을 못 내면 거절(이유 그대로).
   * manual 은 MANUAL 기준선 활동(공급원 없음)일 때만 쓴다.
   */
  private async countFor(
    a: { indicatorKey?: string | null; indicatorId?: string | null; baselineSource?: string | null },
    range: { from: Date; to: Date },
    manual: { numerator?: number; denominator?: number },
  ): Promise<{ numerator: number; denominator: number; source: 'SUPPLIER' | 'MANUAL' }> {
    if (a.indicatorKey) {
      const c = await this.quality.countPeriod(a.indicatorKey as CpoeQiKey, range);
      return { numerator: c.numerator, denominator: c.denominator, source: 'SUPPLIER' };
    }
    const ind = a.indicatorId ? await this.prisma.qualityIndicator.findUnique({ where: { id: a.indicatorId } }) : null;
    if (!ind) throw new NotFoundException('질 지표를 찾을 수 없습니다');
    if (a.baselineSource !== 'MANUAL') {
      const r = await this.suppliers.supplyForIndicator(ind, range);
      if (r.available) return { numerator: r.numerator, denominator: r.denominator, source: 'SUPPLIER' };
      if (r.reason !== 'NO_SUPPLIER' || a.baselineSource === 'SUPPLIER') {
        throw new BadRequestException({ code: 'QI_SUPPLY_UNAVAILABLE', message: '이 기간 이 지표를 원장에서 다시 셀 수 없습니다', reason: r.reason, detail: 'detail' in r ? r.detail : undefined });
      }
    }
    if (manual.numerator == null || manual.denominator == null || !(manual.denominator > 0) || manual.numerator > manual.denominator * 1_000_000) {
      throw new BadRequestException({ code: 'QI_MANUAL_COUNT_REQUIRED', message: '자동 산출 공급원이 없는 지표입니다 — 분자·분모를 직접 입력해야 합니다(분모 1 이상)' });
    }
    return { numerator: manual.numerator, denominator: manual.denominator, source: 'MANUAL' };
  }

  /** 지표 방향(효과의 "바람직한 쪽") — CPOE 는 등재표, 일반 지표는 원장 정본(등재·컬럼일 때만) */
  private async directions(rows: Array<{ indicatorId?: string | null }>): Promise<Map<string, { direction: string | null; known: boolean; name: string }>> {
    const ids = [...new Set(rows.map((r) => r.indicatorId).filter((x): x is string => !!x))];
    const inds = ids.length ? await this.prisma.qualityIndicator.findMany({ where: { id: { in: ids } } }) : [];
    return new Map(inds.map((i) => {
      const p = resolveIndicatorPolicy(i);
      const known = p.directionSource === 'COLUMN' || p.directionSource === 'REGISTRY';
      return [i.id, { direction: known ? p.direction : null, known, name: i.name }];
    }));
  }

  private period(from: string, to: string, label: string): { from: Date; to: Date } {
    const r = dayRange(from, to);
    if (!r?.gte || !r?.lt) throw new BadRequestException({ code: 'CPOE_QI_PERIOD_REQUIRED', message: '시작일·종료일이 모두 필요합니다', field: label });
    if (r.gte >= r.lt) throw new BadRequestException({ code: 'CPOE_QI_PERIOD_ORDER', message: '시작일이 종료일보다 늦습니다', field: label });
    if ((r.lt.getTime() - r.gte.getTime()) / DAY > MAX_RANGE_DAYS) {
      throw new BadRequestException({ code: 'CPOE_QI_RANGE_TOO_LONG', message: '기간은 366일까지입니다', field: label });
    }
    return { from: r.gte, to: r.lt };
  }

  private async names(ids: (string | null | undefined)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    const users = list.length ? await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, familyName: true, givenName: true } }) : [];
    return Object.fromEntries(users.map((u) => [u.id, joinPatientName(u.familyName, u.givenName)]));
  }

  /** 마지막 효과 확인 대 기준선 — 차이·95% 구간 · 지표 방향을 아는 경우에만 "바람직한 쪽" 여부 */
  private effect(a: { indicatorKey: string | null; indicatorId?: string | null; baselineNumerator: number; baselineDenominator: number }, check: { checkNumerator: number | null; checkDenominator: number | null } | undefined, dirs?: Map<string, { direction: string | null; known: boolean }>) {
    if (!check || check.checkNumerator == null || check.checkDenominator == null) return null;
    const diff = proportionDiff(
      { numerator: a.baselineNumerator, denominator: a.baselineDenominator },
      { numerator: check.checkNumerator, denominator: check.checkDenominator },
    );
    if (!diff) return { diff: null, direction: null, favorable: null };
    const def = a.indicatorKey ? cpoeQiDef(a.indicatorKey) : null;
    const general = a.indicatorId ? dirs?.get(a.indicatorId) : undefined;
    const direction = def ? resolveRegistryDirection(def.qiName)
      : general?.known ? { direction: general.direction, source: 'REGISTRY' as const } : { direction: null, source: null };
    // 방향이 등재표(REGISTRY)일 때만 말한다 — 이름 추정(HINT)이나 미정이면 좋고 나쁨을 말하지 않는다
    const favorable = direction.source === 'REGISTRY' && !diff.includesZero
      ? (direction.direction === 'LOWER_IS_BETTER' ? diff.diff < 0 : diff.diff > 0)
      : null;
    return { diff, direction: direction.source === 'REGISTRY' ? direction.direction : null, favorable };
  }

  async list(q: { status?: string; indicatorKey?: string; indicatorId?: string }) {
    const rows = await this.prisma.qiImprovementAction.findMany({
      where: {
        ...(q.status === 'OPEN' ? { status: { in: OPEN } } : q.status ? { status: q.status } : {}),
        ...(q.indicatorKey ? { indicatorKey: q.indicatorKey } : {}),
        ...(q.indicatorId ? { indicatorId: q.indicatorId } : {}),
      },
      include: { events: { where: { kind: 'CHECK' }, orderBy: { at: 'desc' }, take: 1 } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
    const names = await this.names(rows.map((r) => r.ownerId));
    const dirs = await this.directions(rows);
    return rows.map(({ events, ...a }) => ({
      ...a,
      ownerName: a.ownerId ? names[a.ownerId] ?? null : null,
      // 일반 질 지표 활동은 지표 이름을 함께(CPOE 는 화면이 등재표 라벨로 그린다)
      indicatorName: a.indicatorId ? dirs.get(a.indicatorId)?.name ?? null : null,
      lastCheck: events[0] ? { at: events[0].at, from: events[0].checkFrom, to: events[0].checkTo, numerator: events[0].checkNumerator, denominator: events[0].checkDenominator } : null,
      effect: this.effect(a, events[0], dirs),
    }));
  }

  async get(id: string) {
    const a = await this.prisma.qiImprovementAction.findUnique({ where: { id }, include: { events: { orderBy: { at: 'asc' } } } });
    if (!a) throw new NotFoundException('개선 활동을 찾을 수 없습니다');
    const names = await this.names([a.ownerId, a.createdBy, ...a.events.map((e) => e.actorId)]);
    const lastCheck = [...a.events].reverse().find((e) => e.kind === 'CHECK');
    const dirs = await this.directions([a]);
    return { ...a, names, indicatorName: a.indicatorId ? dirs.get(a.indicatorId)?.name ?? null : null, effect: this.effect(a, lastCheck, dirs) };
  }

  async create(dto: {
    indicatorKey?: CpoeQiKey; indicatorId?: string; title: string; problem: string; rootCause?: string; plan: string;
    ownerId?: string; dueDate?: string; triggerPeriod?: string; baselineFrom: string; baselineTo: string;
    baselineNumerator?: number; baselineDenominator?: number;
  }, actorId: string) {
    if (!!dto.indicatorKey === !!dto.indicatorId) {
      throw new BadRequestException({ code: 'QI_ACTION_INDICATOR', message: 'CPOE 지표 또는 질 지표 하나를 고르십시오' });
    }
    if (dto.indicatorKey && !cpoeQiDef(dto.indicatorKey)) throw new BadRequestException('알 수 없는 CPOE 지표입니다');
    if (dto.ownerId) {
      const owner = await this.prisma.user.findUnique({ where: { id: dto.ownerId }, select: { id: true } });
      if (!owner) throw new BadRequestException({ code: 'CPOE_QI_OWNER_NOT_FOUND', message: '담당자를 찾을 수 없습니다' });
    }
    const due = dto.dueDate ? dateOnlyValue(dto.dueDate) : null;
    if (dto.dueDate && !due) throw new BadRequestException({ code: 'CPOE_QI_DUE_DATE', message: '기한을 YYYY-MM-DD 형식으로 지정해주세요' });
    const base = this.period(dto.baselineFrom, dto.baselineTo, 'baseline');
    const counts = await this.countFor({ indicatorKey: dto.indicatorKey ?? null, indicatorId: dto.indicatorId ?? null, baselineSource: null }, base, { numerator: dto.baselineNumerator, denominator: dto.baselineDenominator });
    // 🔴 표본 없는 기준선은 기준선이 아니다 — 뒤에 무엇과 비교해도 "개선"을 말할 수 없다
    if (!(counts.denominator > 0)) {
      throw new BadRequestException({ code: 'CPOE_QI_BASELINE_EMPTY', message: '기준선 기간에 대상이 없습니다 — 다른 기간을 고르십시오' });
    }
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.qiImprovementAction.create({
        data: {
          indicatorKey: dto.indicatorKey ?? null, indicatorId: dto.indicatorId ?? null, baselineSource: counts.source, title: dto.title.trim(), problem: dto.problem.trim(), rootCause: dto.rootCause?.trim() || null,
          plan: dto.plan.trim(), ownerId: dto.ownerId ?? null, dueDate: due, triggerPeriod: dto.triggerPeriod?.trim() || null,
          baselineFrom: base.from, baselineTo: base.to, baselineNumerator: counts.numerator, baselineDenominator: counts.denominator,
          createdBy: actorId,
        },
      });
      await tx.qiImprovementEvent.create({ data: { actionId: a.id, kind: 'CREATED', toStatus: 'PLAN', actorId } });
      return a;
    });
  }

  async transition(id: string, dto: { to: QiActionStatus; note?: string }, actorId: string) {
    const a = await this.prisma.qiImprovementAction.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!a) throw new NotFoundException('개선 활동을 찾을 수 없습니다');
    const from = a.status as QiActionStatus;
    if (!canTransitQiAction(from, dto.to)) {
      throw new BadRequestException({ code: 'CPOE_QI_TRANSITION', message: '이 단계에서 갈 수 없는 단계입니다', from, to: dto.to });
    }
    const note = dto.note?.trim() || null;
    if ((dto.to === 'CANCELLED' || dto.to === 'CLOSED') && !note) {
      throw new BadRequestException({ code: 'CPOE_QI_NOTE_REQUIRED', message: '종결·취소에는 사유(무엇을 표준화했는지·왜 멈췄는지)가 필요합니다' });
    }
    if (from === 'CHECK' && dto.to === 'ACT') {
      const checks = await this.prisma.qiImprovementEvent.count({ where: { actionId: id, kind: 'CHECK' } });
      if (!checks) throw new BadRequestException({ code: 'CPOE_QI_CHECK_REQUIRED', message: '효과 확인 기록이 없습니다 — 먼저 효과를 다시 재십시오' });
    }
    return this.prisma.$transaction(async (tx) => {
      // 🔴 같은 단계에서만 바꾼다 — 두 사람이 동시에 누르면 한 쪽은 409(조용히 덮지 않는다)
      const r = await tx.qiImprovementAction.updateMany({
        where: { id, status: from },
        data: { status: dto.to, closedAt: dto.to === 'CLOSED' || dto.to === 'CANCELLED' ? new Date() : null },
      });
      if (!r.count) throw new ConflictException({ code: 'CPOE_QI_STALE', message: '다른 사람이 먼저 단계를 바꿨습니다 — 새로 고친 뒤 다시 하십시오' });
      await tx.qiImprovementEvent.create({ data: { actionId: id, kind: 'STATUS', fromStatus: from, toStatus: dto.to, note, actorId } });
      return tx.qiImprovementAction.findUnique({ where: { id } });
    });
  }

  async addNote(id: string, note: string, actorId: string) {
    const a = await this.prisma.qiImprovementAction.findUnique({ where: { id }, select: { id: true } });
    if (!a) throw new NotFoundException('개선 활동을 찾을 수 없습니다');
    return this.prisma.qiImprovementEvent.create({ data: { actionId: id, kind: 'NOTE', note: note.trim(), actorId } });
  }

  async check(id: string, dto: { from: string; to: string; note?: string; numerator?: number; denominator?: number }, actorId: string) {
    const a = await this.prisma.qiImprovementAction.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('개선 활동을 찾을 수 없습니다');
    if (!(['DO', 'CHECK', 'ACT'] as string[]).includes(a.status)) {
      throw new BadRequestException({ code: 'CPOE_QI_CHECK_STATUS', message: '실행 이후 단계에서만 효과를 잽니다', status: a.status });
    }
    const p = this.period(dto.from, dto.to, 'check');
    if (p.from < a.baselineTo) {
      throw new BadRequestException({ code: 'CPOE_QI_CHECK_OVERLAP', message: '효과 확인 기간은 기준선 기간이 끝난 뒤여야 합니다' });
    }
    // 기준선과 같은 길로 센다(공급원 재집계 · MANUAL 이면 사람이 센 수)
    const counts = await this.countFor(a, p, { numerator: dto.numerator, denominator: dto.denominator });
    const ev = await this.prisma.qiImprovementEvent.create({
      data: {
        actionId: id, kind: 'CHECK', note: dto.note?.trim() || null, actorId,
        checkFrom: p.from, checkTo: p.to, checkNumerator: counts.numerator, checkDenominator: counts.denominator,
      },
    });
    return { event: ev, effect: this.effect(a, ev, await this.directions([a])) };
  }
}
