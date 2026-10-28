import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roundBy } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';
import type {
  CreateCostCenterDto, CreateCostDriverDto, CreateManualCostAllocationDto, UpdateCostCenterDto, UpdateCostDriverDto,
} from './dto/cost-analysis.dto';

export interface CostCenterNode {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  department: string;
  isActive: boolean;
  children: CostCenterNode[];
}

@Injectable()
export class CostAnalysisService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: IntegrationOutboxService) {}

  // ──────────────────────────────────────────
  // Cost Centers (원가 중심점)
  // ──────────────────────────────────────────

  /** 원가 중심점 트리 조회 */
  async getCenters(): Promise<CostCenterNode[]> {
    const rows = await this.prisma.costCenter.findMany({
      orderBy: { code: 'asc' },
    });

    const map = new Map<string, CostCenterNode>();
    const roots: CostCenterNode[] = [];

    for (const r of rows) {
      map.set(r.id, { ...r, children: [] });
    }

    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /** 원가 중심점 생성 — 🔴 (2026-09-15 B6) 필드를 명시해 넘긴다(종전 본문 `as never` 통째 전달 = 대량 할당) */
  async createCenter(data: CreateCostCenterDto) {
    return this.prisma.costCenter.create({
      data: { code: data.code, name: data.name, type: data.type, department: data.department, parentId: data.parentId ?? null },
    });
  }

  /** 원가 중심점 수정 */
  async updateCenter(id: string, data: UpdateCostCenterDto) {
    return this.prisma.costCenter.update({
      where: { id },
      data: {
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.department !== undefined ? { department: data.department } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  }

  // ──────────────────────────────────────────
  // Cost Drivers (원가 동인)
  // ──────────────────────────────────────────

  /** 원가 동인 목록 (카테고리/기간 필터) */
  async getDrivers(category?: string, period?: string) {
    return this.prisma.costDriver.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(period ? { period } : {}),
      },
      orderBy: { code: 'asc' },
    });
  }

  /** 원가 동인 생성 */
  async createDriver(data: CreateCostDriverDto) {
    return this.prisma.costDriver.create({
      data: {
        code: data.code, name: data.name, category: data.category, unit: data.unit,
        unitCost: data.unitCost, period: data.period, note: data.note ?? null,
      },
    });
  }

  /** 원가 동인 수정 */
  async updateDriver(id: string, data: UpdateCostDriverDto) {
    const fields = ['code', 'name', 'category', 'unit', 'unitCost', 'period', 'note'] as const;
    const patch: Record<string, unknown> = {};
    for (const f of fields) if (data[f] !== undefined) patch[f] = data[f];
    return this.prisma.costDriver.update({ where: { id }, data: patch });
  }

  // ──────────────────────────────────────────
  // Allocations (원가 배부)
  // ──────────────────────────────────────────

  /**
   * 수동 원가 배부 — 🔴 (2026-09-15 B6) 금액·출처를 요청자가 정하던 것(종전 본문 통째 create)과
   * 화면이 보내는 `driverId`·금액 없음이 모델과 어긋나 한 번도 저장되지 않던 것(P11)을 함께 봉합.
   * 금액 = 동인 단가 × 수량(자동 배부와 같은 식) · 출처 `MANUAL` 고정 · 동인은 같은 기간의 것만.
   */
  async createAllocation(data: CreateManualCostAllocationDto) {
    const [center, driver] = await Promise.all([
      this.prisma.costCenter.findUnique({ where: { id: data.costCenterId } }),
      this.prisma.costDriver.findUnique({ where: { id: data.driverId } }),
    ]);
    if (!center) throw new NotFoundException('원가 중심점을 찾을 수 없습니다');
    if (!driver) throw new NotFoundException('원가 동인을 찾을 수 없습니다');
    if (driver.period !== data.period) {
      throw new BadRequestException({
        code: 'COST_DRIVER_PERIOD_MISMATCH',
        message: '원가 동인의 기간과 배부 기간이 다릅니다',
        driverPeriod: driver.period,
        allocationPeriod: data.period,
      });
    }
    // 곱은 Decimal 로 정확히, 반올림은 수치 정책 정본(`money`)으로
    const amount = roundBy(new Prisma.Decimal(driver.unitCost).mul(data.quantity).toNumber(), 'money');
    if (amount == null) throw new BadRequestException('배부 금액을 계산할 수 없습니다(단가·수량 확인)');
    return this.prisma.costAllocation.create({
      data: {
        costCenterId: center.id,
        costDriverId: driver.id,
        period: data.period,
        quantity: data.quantity,
        amount,
        source: 'MANUAL',
      },
    });
  }

  /** 자동 원가 배부 — 동인 기반 */
  async autoAllocate(period: string) {
    const drivers = await this.prisma.costDriver.findMany({
      where: { period },
    });

    const centers = await this.prisma.costCenter.findMany({
      where: { isActive: true },
    });

    const created: { costCenterId: string; driverId: string; amount: number }[] = [];

    for (const driver of drivers) {
      for (const center of centers) {
        // 동인 단가 × 중심점별 기본 수량(1) — 실제 운영 시 활동량 데이터 연동
        const amount = Number(driver.unitCost);
        if (amount <= 0) continue;

        await this.prisma.costAllocation.create({
          data: {
            costCenterId: center.id,
            costDriverId: driver.id,
            period,
            amount,
            quantity: 1,
            source: 'AUTO',
          },
        });

        created.push({
          costCenterId: center.id,
          driverId: driver.id,
          amount,
        });
      }
    }

    return { period, allocationsCreated: created.length, details: created };
  }

  /** 배부 내역 조회 */
  async getAllocations(costCenterId?: string, period?: string) {
    return this.prisma.costAllocation.findMany({
      where: {
        ...(costCenterId ? { costCenterId } : {}),
        ...(period ? { period } : {}),
      },
      include: { costCenter: true },
      orderBy: { allocatedAt: 'desc' },
    });
  }

  // ──────────────────────────────────────────
  // Procedure Costs (시술별 원가)
  // ──────────────────────────────────────────

  /** 시술별 원가 목록 */
  async getProcedureCosts(period?: string) {
    return this.prisma.procedureCost.findMany({
      where: period ? { period } : {},
      orderBy: { totalCost: 'desc' },
    });
  }

  /** 시술별 원가 산출 — 배부/수납 데이터 집계 */
  async calculateProcedureCosts(period: string) {
    // 1) 해당 기간 배부 합계 (간접비)
    const allocations = await this.prisma.costAllocation.findMany({
      where: { period },
      include: { costCenter: true },
    });

    const totalIndirect = allocations.reduce(
      (sum, a) => sum + Number(a.amount),
      0,
    );

    // 2) 해당 기간 처방(시술) 건 집계 — 직접비 + 수익
    const prescriptions = await this.prisma.prescription.findMany({
      where: {
        status: 'ACTIVE',
        procedureCode: { isNot: null },
        createdAt: {
          gte: new Date(`${period}-01`),
          lt: new Date(
            period.length === 7
              ? `${Number(period.slice(0, 4))}-${String(Number(period.slice(5, 7)) + 1).padStart(2, '0')}-01`
              : `${Number(period) + 1}-01-01`,
          ),
        },
      },
      include: { procedureCode: true },
    });

    // 시술코드별 그룹핑
    const grouped = new Map<
      string,
      { name: string; count: number; directSum: number; revenueSum: number }
    >();

    for (const rx of prescriptions) {
      if (!rx.procedureCode) continue;
      const code = rx.procedureCode.code;
      const prev = grouped.get(code) ?? {
        name: rx.procedureCode.nameKo,
        count: 0,
        directSum: 0,
        revenueSum: 0,
      };
      prev.count += 1;
      prev.directSum += Number(rx.procedureCode.unitPrice ?? 0);
      prev.revenueSum += Number(rx.procedureCode.unitPrice ?? 0);
      grouped.set(code, prev);
    }

    const totalVolume = Array.from(grouped.values()).reduce(
      (s, g) => s + g.count,
      0,
    );

    const results: {
      procedureCode: string;
      procedureName: string;
      directCost: number;
      indirectCost: number;
      totalCost: number;
      revenueAvg: number;
      margin: number;
      volumeCount: number;
    }[] = [];

    for (const [code, g] of grouped.entries()) {
      const indirectShare =
        totalVolume > 0
          ? Math.round((g.count / totalVolume) * totalIndirect)
          : 0;
      const total = g.directSum + indirectShare;
      const revenueAvg = g.count > 0 ? g.revenueSum / g.count : 0;
      const margin = revenueAvg > 0 ? (revenueAvg - total / g.count) / revenueAvg : 0;

      const row = {
        procedureCode: code,
        procedureName: g.name,
        directCost: g.directSum,
        indirectCost: indirectShare,
        totalCost: total,
        revenueAvg: Math.round(revenueAvg),
        margin: Math.round(margin * 10000) / 10000,
        volumeCount: g.count,
      };

      results.push(row);

      // upsert ProcedureCost
      await this.prisma.procedureCost.upsert({
        where: { procedureCode_period: { procedureCode: code, period } },
        update: {
          procedureName: row.procedureName,
          directCost: row.directCost,
          indirectCost: row.indirectCost,
          totalCost: row.totalCost,
          revenueAvg: row.revenueAvg,
          margin: row.margin,
          volumeCount: row.volumeCount,
        },
        create: {
          procedureCode: code,
          procedureName: row.procedureName,
          period,
          directCost: row.directCost,
          indirectCost: row.indirectCost,
          totalCost: row.totalCost,
          revenueAvg: row.revenueAvg,
          margin: row.margin,
          volumeCount: row.volumeCount,
        },
      });
    }

    return { period, procedureCount: results.length, totalIndirectCost: totalIndirect, results };
  }

  // ──────────────────────────────────────────
  // Analytics (분석)
  // ──────────────────────────────────────────

  /** 부서별 원가/매출 분석 */
  async getDepartmentAnalytics(period?: string) {
    const where = period ? { period } : {};

    const allocations = await this.prisma.costAllocation.findMany({
      where,
      include: { costCenter: true },
    });

    // 부서별 원가 합산
    const deptMap = new Map<
      string,
      { department: string; totalCost: number; allocationCount: number }
    >();

    for (const a of allocations) {
      const dept = a.costCenter.department;
      const prev = deptMap.get(dept) ?? {
        department: dept,
        totalCost: 0,
        allocationCount: 0,
      };
      prev.totalCost += Number(a.amount);
      prev.allocationCount += 1;
      deptMap.set(dept, prev);
    }

    return Array.from(deptMap.values()).sort(
      (a, b) => b.totalCost - a.totalCost,
    );
  }

  /** 시술/DRG 수익성 순위 */
  async getProfitability(period?: string) {
    const where = period ? { period } : {};
    const costs = await this.prisma.procedureCost.findMany({
      where,
      orderBy: { margin: 'desc' },
    });

    return costs.map((c) => ({
      procedureCode: c.procedureCode,
      procedureName: c.procedureName,
      period: c.period,
      totalCost: Number(c.totalCost),
      revenueAvg: Number(c.revenueAvg),
      margin: Number(c.margin),
      volumeCount: c.volumeCount,
      profitPerCase: Number(c.revenueAvg) - Number(c.totalCost) / (c.volumeCount || 1),
    }));
  }

  /**
   * 실제 청구 수익 연계 손익 — 표준수가(revenueAvg) 대신 BillingItem 실제 청구액으로 마진 재계산.
   * ProcedureCost.procedureCode(코드) ↔ ProcedureCode.id ↔ BillingItem.codeId 조인.
   */
  async getActualProfitability(period?: string) {
    const p = period ?? new Date().toISOString().slice(0, 7);
    // 기간 형식: 'YYYY-MM'(월) 또는 'YYYY-QN'(분기) 지원
    const [yStr, unit] = p.split('-');
    const y = Number(yStr);
    let start: Date, end: Date;
    if (unit?.startsWith('Q')) {
      const q = Number(unit.slice(1));
      start = new Date(y, (q - 1) * 3, 1);
      end = new Date(y, q * 3, 1);
    } else {
      const m = Number(unit);
      start = new Date(y, m - 1, 1);
      end = new Date(y, m, 1);
    }

    const costs = await this.prisma.procedureCost.findMany({ where: { period: p } });
    if (costs.length === 0) return { period: p, rows: [], summary: { totalRevenue: 0, totalCost: 0, totalMargin: 0 } };

    // 실제 청구 수익: 기간 내 PROCEDURE 라인 합계 by codeId
    const revItems = await this.prisma.billingItem.groupBy({
      by: ['codeId'],
      where: { codeType: 'PROCEDURE', billing: { is: { createdAt: { gte: start, lt: end } } } },
      _sum: { amount: true },
      _count: true,
    });
    const idToCode = new Map<string, string>();
    if (revItems.length) {
      const codes = await this.prisma.procedureCode.findMany({ where: { id: { in: revItems.map((r) => r.codeId) } }, select: { id: true, code: true } });
      codes.forEach((pc) => idToCode.set(pc.id, pc.code));
    }
    const revByCode = new Map<string, { revenue: number; count: number }>();
    for (const r of revItems) {
      const code = idToCode.get(r.codeId);
      if (!code) continue;
      const cur = revByCode.get(code) ?? { revenue: 0, count: 0 };
      cur.revenue += r._sum.amount ?? 0;
      cur.count += r._count;
      revByCode.set(code, cur);
    }

    let totalRevenue = 0, totalCost = 0;
    const rows = costs.map((c) => {
      const unitCost = Number(c.totalCost) / (c.volumeCount || 1);
      const actual = revByCode.get(c.procedureCode);
      const actualVolume = actual?.count ?? 0;
      const actualRevenue = actual?.revenue ?? 0;
      const actualRevenuePerCase = actualVolume > 0 ? actualRevenue / actualVolume : 0;
      const periodCost = unitCost * actualVolume;
      const actualMargin = actualRevenue > 0 ? (actualRevenue - periodCost) / actualRevenue : 0;
      totalRevenue += actualRevenue;
      totalCost += periodCost;
      return {
        procedureCode: c.procedureCode,
        procedureName: c.procedureName,
        unitCost: Math.round(unitCost),
        standardRevenueAvg: Number(c.revenueAvg),
        actualRevenuePerCase: Math.round(actualRevenuePerCase),
        actualVolume,
        actualRevenue,
        periodCost: Math.round(periodCost),
        actualMargin: Math.round(actualMargin * 10000) / 10000,
        standardMargin: Number(c.margin),
        // 표준 대비 실제 마진 편차(음수=수익성 악화)
        marginVariance: Math.round((actualMargin - Number(c.margin)) * 10000) / 10000,
      };
    });
    return {
      period: p,
      rows: rows.sort((a, b) => a.actualMargin - b.actualMargin), // 저마진 우선(관리 대상)
      summary: { totalRevenue, totalCost: Math.round(totalCost), totalMargin: totalRevenue > 0 ? Math.round((totalRevenue - totalCost) / totalRevenue * 10000) / 10000 : 0 },
    };
  }

  /** ERP 관리회계 연계 — 기간 원가배부 + 실제손익을 ERP로 발행(GL 전기·경영분석은 ERP 담당) */
  async exportToErp(period: string) {
    const [allocations, profitability] = await Promise.all([
      this.getAllocations(undefined, period),
      this.getActualProfitability(period),
    ]);
    await this.outbox.enqueue('cost', 'cost.period_closed', `cost:period:${period}`, {
      period,
      allocations: allocations.map((a) => ({ costCenterId: a.costCenterId, costDriverId: a.costDriverId, amount: Number(a.amount) })),
      profitability: { summary: profitability.summary, rows: profitability.rows },
    });
    return { period, exported: true, allocationCount: allocations.length, procedureCount: profitability.rows.length };
  }

  /** 기간별 원가 추이 */
  /**
   * 경영 대시보드 — 🔴 2026-08-14(W6) 신설.
   *
   * '경영 대시보드' 탭은 `GET /api/v1/cost/dashboard` 를 부르는데 **그 EP 가 없었다**(404).
   * 화면은 실패를 `?? 0` 으로 받아 "총 원가 ₩0 · 총 수익 ₩0 · 순이익 ₩0 · 마진율 0%"를
   * 그렸고, 마진율 0% 는 `>= 0` 이라 **초록색**으로 떴다 — 호출이 실패한 화면이
   * 건전한 손익으로 보였다(P1-ⓐ · P9).
   *
   * 지금도 원가 배분 실적은 0건이다. 그건 **사실**이므로 0 을 숨기지 않되,
   * '배분을 아직 안 돌렸다'와 '원가가 0원이다'를 화면이 구분할 수 있게 근거를 함께 보낸다.
   */
  async getDashboard(period?: string) {
    const p = period ?? new Date().toISOString().slice(0, 7);

    const [allocations, actual] = await Promise.all([
      this.prisma.costAllocation.findMany({ where: { period: p }, include: { costCenter: true } }),
      this.getActualProfitability(p),
    ]);

    const deptMap = new Map<string, { department: string; totalCost: number; allocationCount: number }>();
    for (const a of allocations) {
      const dept = a.costCenter.department;
      const prev = deptMap.get(dept) ?? { department: dept, totalCost: 0, allocationCount: 0 };
      prev.totalCost += Number(a.amount);
      prev.allocationCount += 1;
      deptMap.set(dept, prev);
    }

    /**
     * 🔴 부서별 '수익'은 산출 경로가 없다 — 청구(Billing)는 Encounter 에 걸리는데
     * Encounter 에 진료과 필드가 없어 매출을 부서로 떨어뜨릴 수 없다.
     * 0 으로 채우면 모든 부서가 마진율 -100% 로 보인다. **모른다고 말한다.**
     */
    const departments = [...deptMap.values()]
      .sort((a, b) => b.totalCost - a.totalCost)
      .map((d) => ({ ...d, totalRevenue: null, margin: null, marginRate: null }));

    // 추이: 요청 기간을 포함한 최근 6개 기간(배분 실적이 있는 기간만)
    const trendRows = await this.prisma.costAllocation.findMany({
      where: { period: { lte: p } },
      select: { period: true, amount: true },
      orderBy: { period: 'desc' },
    });
    const periodMap = new Map<string, { period: string; totalCost: number; count: number }>();
    for (const r of trendRows) {
      const prev = periodMap.get(r.period) ?? { period: r.period, totalCost: 0, count: 0 };
      prev.totalCost += Number(r.amount);
      prev.count += 1;
      periodMap.set(r.period, prev);
    }
    const trends = [...periodMap.values()].sort((a, b) => a.period.localeCompare(b.period)).slice(-6);

    const overallCost = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
    // 전사 수익은 행위별 원가가 등재된 경우에만 실청구와 대조할 수 있다.
    const revenueAvailable = actual.rows.length > 0;
    const overallRevenue = revenueAvailable ? actual.summary.totalRevenue : null;

    return {
      period: p,
      departments,
      trends,
      overallCost,
      overallRevenue,
      overallMargin: overallRevenue != null ? overallRevenue - overallCost : null,
      // 화면이 '배분 미실행'과 '원가 0원'을 구분할 근거
      allocationCount: allocations.length,
      revenueAvailable,
      departmentRevenueAvailable: false,
      departmentRevenueReason: '진료과별 매출 귀속 경로 없음(청구는 Encounter 기준, Encounter 에 진료과 없음)',
    };
  }

  async getTrend(startPeriod: string, endPeriod: string) {
    const allocations = await this.prisma.costAllocation.findMany({
      where: {
        period: { gte: startPeriod, lte: endPeriod },
      },
      orderBy: { period: 'asc' },
    });

    // 기간별 합산
    const periodMap = new Map<
      string,
      { period: string; totalCost: number; count: number }
    >();

    for (const a of allocations) {
      const prev = periodMap.get(a.period) ?? {
        period: a.period,
        totalCost: 0,
        count: 0,
      };
      prev.totalCost += Number(a.amount);
      prev.count += 1;
      periodMap.set(a.period, prev);
    }

    return Array.from(periodMap.values()).sort((a, b) =>
      a.period.localeCompare(b.period),
    );
  }
}
