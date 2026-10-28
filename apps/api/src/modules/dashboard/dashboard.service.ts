import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { DispensingStatus, LabResultStatus, ImagingResultStatus, ClaimStatus } from '@prisma/client';
// 🔴 미래 접수 상한 정본(W8 Q9) — 이 파일만 상한을 갖고 있었고 다른 축은 빠져 있었다.
//    이제 상한은 한 곳에서 나오고, 전 축이 그것을 부른다.
import { notFutureCheckIn } from '../journey-console/flow-canon';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  private getDateRange(range: 'today' | 'week' | 'month' = 'today'): { gte: Date; lte: Date } {
    const now = new Date();
    const start = new Date();

    if (range === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (range === 'week') {
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    } else if (range === 'month') {
      start.setDate(now.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    }

    return { gte: start, lte: now };
  }

  async getPharmacyStats(range: 'today' | 'week' | 'month' = 'today') {
    const dateRange = this.getDateRange(range);
    const groups = await this.prisma.dispensing.groupBy({
      by: ['status'],
      where: { createdAt: dateRange },
      _count: true,
    });

    const statusMap = new Map(groups.map(g => [g.status, g._count]));
    const pending = statusMap.get(DispensingStatus.PENDING) ?? 0;
    const inProgress = statusMap.get(DispensingStatus.DISPENSED) ?? 0;
    const completed = statusMap.get(DispensingStatus.VERIFIED) ?? 0;
    const total = groups.reduce((s, g) => s + g._count, 0);

    return {
      department: 'PHARMACY',
      total,
      pending,
      inProgress,
      completed,
      cancelled: 0,
      completionRate: total > 0 ? Math.round((completed / total) * 100 * 100) / 100 : 0,
    };
  }

  async getLabStats(range: 'today' | 'week' | 'month' = 'today') {
    const dateRange = this.getDateRange(range);
    const groups = await this.prisma.labResult.groupBy({
      by: ['status'],
      where: { createdAt: dateRange },
      _count: true,
    });

    const statusMap = new Map(groups.map(g => [g.status, g._count]));
    const pending = statusMap.get(LabResultStatus.COLLECTED) ?? 0;
    const inProgress = statusMap.get(LabResultStatus.IN_PROGRESS) ?? 0;
    const completed = statusMap.get(LabResultStatus.COMPLETED) ?? 0;
    const total = groups.reduce((s, g) => s + g._count, 0);

    return {
      department: 'LAB',
      total,
      pending,
      inProgress,
      completed,
      cancelled: 0,
      completionRate: total > 0 ? Math.round((completed / total) * 100 * 100) / 100 : 0,
    };
  }

  async getImagingStats(range: 'today' | 'week' | 'month' = 'today') {
    const dateRange = this.getDateRange(range);
    const groups = await this.prisma.imagingResult.groupBy({
      by: ['status'],
      where: { createdAt: dateRange },
      _count: true,
    });

    const statusMap = new Map(groups.map(g => [g.status, g._count]));
    const pending = statusMap.get(ImagingResultStatus.ORDERED) ?? 0;
    const inProgress = statusMap.get(ImagingResultStatus.ACQUIRED) ?? 0;
    const completed = statusMap.get(ImagingResultStatus.REPORTED) ?? 0;
    const total = groups.reduce((s, g) => s + g._count, 0);

    return {
      department: 'IMAGING',
      total,
      pending,
      inProgress,
      completed,
      cancelled: 0,
      completionRate: total > 0 ? Math.round((completed / total) * 100 * 100) / 100 : 0,
    };
  }

  async getFinancialSummary(range: 'today' | 'week' | 'month' = 'today') {
    const dateRange = this.getDateRange(range);

    const [billingAgg, claimAgg] = await Promise.all([
      this.prisma.billing.aggregate({
        where: { createdAt: dateRange },
        _sum: { totalAmount: true, insuranceCovered: true, patientCopay: true },
      }),
      this.prisma.claim.aggregate({
        where: { createdAt: dateRange },
        _sum: { claimedAmount: true, approvedAmount: true, paidAmount: true },
      }),
    ]);

    const totalAmount = billingAgg._sum.totalAmount ?? 0;
    const insuranceCovered = billingAgg._sum.insuranceCovered ?? 0;
    const patientCopay = billingAgg._sum.patientCopay ?? 0;
    const claimedAmount = claimAgg._sum.claimedAmount ?? 0;
    const approvedAmount = claimAgg._sum.approvedAmount ?? 0;
    const paidAmount = claimAgg._sum.paidAmount ?? 0;
    const pendingAmount = approvedAmount - paidAmount;
    const claimApprovalRate = claimedAmount > 0 ? Math.round((approvedAmount / claimedAmount) * 100 * 100) / 100 : 0;

    return {
      totalAmount,
      insuranceCovered,
      patientCopay,
      claimedAmount,
      approvedAmount,
      paidAmount,
      pendingAmount,
      claimApprovalRate,
    };
  }

  async getPharmacyQueue() {
    return this.prisma.dispensing.findMany({
      where: { status: { in: [DispensingStatus.PENDING, DispensingStatus.DISPENSED] } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
  }

  async getLabQueue() {
    return this.prisma.labResult.findMany({
      where: { status: { in: [LabResultStatus.COLLECTED, LabResultStatus.IN_PROGRESS] } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
  }

  async getImagingQueue() {
    return this.prisma.imagingResult.findMany({
      where: { status: { in: [ImagingResultStatus.ORDERED, ImagingResultStatus.ACQUIRED] } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
  }

  async getChartData() {
    if (this.cache) {
      return this.cache.getOrSet('dashboard:charts', 60, () => this._getChartData());
    }
    return this._getChartData();
  }

  private async _getChartData() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

    // 1. 시간대별 접수 환자 수 (오늘)
    // 🔴 미래 접수는 '접수된 환자'가 아니다 — 상한이 없으면 아직 오지 않은 사람이 미래 시간대 막대에
    //    미리 그려진다(W8 Q9·전 축 공통 상한).
    const todayQueue = await this.prisma.waitingQueue.findMany({
      where: { checkedInAt: { gte: today, ...notFutureCheckIn() } },
      select: { checkedInAt: true, departmentName: true },
    });
    const hourlyPatients = Array.from({ length: 12 }, (_, i) => {
      const hour = i + 8; // 08~19시
      return {
        hour: `${hour}:00`,
        count: todayQueue.filter(q => q.checkedInAt.getHours() === hour).length,
      };
    });

    // 2. 부서별 환자 수 (오늘)
    const deptMap = new Map<string, number>();
    for (const q of todayQueue) {
      const dept = q.departmentName ?? '기타';
      deptMap.set(dept, (deptMap.get(dept) ?? 0) + 1);
    }
    const departmentPatients = [...deptMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // 3. 오더 상태 분포
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: today } },
      select: { status: true, department: true },
    });
    const orderStatus = {
      ORDERED: orders.filter(o => o.status === 'ORDERED').length,
      RECEIVED: orders.filter(o => o.status === 'RECEIVED').length,
      IN_PROGRESS: orders.filter(o => o.status === 'IN_PROGRESS').length,
      COMPLETED: orders.filter(o => o.status === 'COMPLETED').length,
      CANCELLED: orders.filter(o => o.status === 'CANCELLED').length,
    };

    // 4. 7일간 일별 진료 건수
    const weekEncounters = await this.prisma.encounter.findMany({
      where: { createdAt: { gte: weekAgo } },
      select: { createdAt: true },
    });
    const dailyEncounters = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().split('T')[0];
      return {
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        count: weekEncounters.filter(e => e.createdAt.toISOString().split('T')[0] === dateStr).length,
      };
    });

    // 5. 응급실 KTAS 분포
    const erVisits = await this.prisma.emergencyVisit.findMany({
      where: { disposition: null },
      select: { triageLevel: true },
    });
    const ktasDistribution = {
      LEVEL_1: erVisits.filter(e => e.triageLevel === 'LEVEL_1').length,
      LEVEL_2: erVisits.filter(e => e.triageLevel === 'LEVEL_2').length,
      LEVEL_3: erVisits.filter(e => e.triageLevel === 'LEVEL_3').length,
      LEVEL_4: erVisits.filter(e => e.triageLevel === 'LEVEL_4').length,
      LEVEL_5: erVisits.filter(e => e.triageLevel === 'LEVEL_5').length,
    };

    return { hourlyPatients, departmentPatients, orderStatus, dailyEncounters, ktasDistribution };
  }

  async getDashboardSummary(range: 'today' | 'week' | 'month' = 'today') {
    if (this.cache) {
      return this.cache.getOrSet(`dashboard:summary:${range}`, 30, () => this._getDashboardSummary(range));
    }
    return this._getDashboardSummary(range);
  }

  private async _getDashboardSummary(range: 'today' | 'week' | 'month' = 'today') {
    const dateRange = this.getDateRange(range);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const [pharmacy, lab, imaging, financialSummary,
      totalPatients, totalEncounters,
      todayAppointments, todayEncounters, draftEncounters,
      pendingOrders, pendingBillings, myWaiting] = await Promise.all([
      this.getPharmacyStats(range),
      this.getLabStats(range),
      this.getImagingStats(range),
      this.getFinancialSummary(range),
      this.prisma.patient.count(),
      this.prisma.encounter.count(),
      this.prisma.appointment.count({
        // 🔴 '오늘 예약'은 취소만 뺀 전량 — 종전엔 SCHEDULED/CHECKED_IN 만 세서 확정(CONFIRMED) 6건이
        //    빠졌고, 같은 화면의 병원 현황 위젯(20)과 다른 값(13)을 말했다(P3·P12).
        where: { scheduledAt: { gte: today, lt: tomorrow }, status: { not: 'CANCELLED' } },
      }),
      this.prisma.encounter.count({
        where: { createdAt: { gte: today, lt: tomorrow } },
      }),
      this.prisma.encounter.count({
        where: { status: 'DRAFT' },
      }),
      this.prisma.order.count({
        where: { status: { in: ['ORDERED', 'RECEIVED'] } },
      }),
      this.prisma.billing.count({
        where: { status: 'PENDING' },
      }),
      // 🔴 '대기 환자'는 대기열 정본(waitingNow 와 같은 조건: 오늘 접수·checkedInAt≤now·WAITING) —
      //    종전엔 오늘 예약 건수를 그대로 넣어 한 화면이 "대기 13명"과 "대기 없음"을 동시에 말했다(P12).
      //    상한(now)이 없으면 아직 오지 않은 예약 접수가 섞인다(W3 반복 패턴 — 라이브 실측 196 vs 실대기 51).
      this.prisma.waitingQueue.count({ where: { status: 'WAITING', checkedInAt: { gte: today, ...notFutureCheckIn() } } }),
    ]);

    return {
      pharmacy,
      lab,
      imaging,
      totalPatients,
      totalEncounters,
      todayAppointments,
      todayEncounters,
      draftEncounters,
      pendingOrders,
      pendingBillings,
      myWaiting,
      financialSummary,
    };
  }

  /** 월별 매출 추이 (최근 6개월) — 5분 캐시 */
  async getMonthlyRevenue() {
    return (this.cache?.getOrSet('dashboard:monthly-revenue', 300, () => this._fetchMonthlyRevenue()) ?? this._fetchMonthlyRevenue());
  }

  private async _fetchMonthlyRevenue() {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const billings = await this.prisma.billing.findMany({
      where: { status: 'PAID', createdAt: { gte: sixMonthsAgo } },
      select: { totalAmount: true, paidAmount: true, createdAt: true },
    });

    const monthly: Record<string, { revenue: number; count: number }> = {};
    for (const b of billings) {
      const key = b.createdAt.toISOString().slice(0, 7);
      if (!monthly[key]) monthly[key] = { revenue: 0, count: 0 };
      monthly[key].revenue += Number(b.paidAmount ?? b.totalAmount ?? 0);
      monthly[key].count++;
    }

    return Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));
  }

  /** 진료과별 매출 통계 — 5분 캐시 */
  async getDepartmentRevenue() {
    return (this.cache?.getOrSet('dashboard:dept-revenue', 300, () => this._fetchDepartmentRevenue()) ?? this._fetchDepartmentRevenue());
  }

  private async _fetchDepartmentRevenue() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    const billings = await this.prisma.billing.findMany({
      where: { status: 'PAID', createdAt: { gte: firstDay } },
      select: { totalAmount: true, encounter: { select: { doctor: { select: { department: true } } } } },
    });

    const deptMap: Record<string, { revenue: number; count: number }> = {};
    for (const b of billings) {
      const dept = b.encounter?.doctor?.department ?? '기타';
      if (!deptMap[dept]) deptMap[dept] = { revenue: 0, count: 0 };
      deptMap[dept].revenue += Number(b.totalAmount ?? 0);
      deptMap[dept].count++;
    }

    return Object.entries(deptMap)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .map(([department, data]) => ({ department, ...data }));
  }

  /** 병상 가동률 추이 (최근 7일) — 10분 캐시 */
  async getBedOccupancyTrend() {
    return (this.cache?.getOrSet('dashboard:bed-occupancy', 600, () => this._fetchBedOccupancyTrend()) ?? this._fetchBedOccupancyTrend());
  }

  private async _fetchBedOccupancyTrend() {
    const totalBeds = await this.prisma.bed.count();
    const admissions = await this.prisma.admission.findMany({
      where: { status: { in: ['ADMITTED', 'DISCHARGED'] } },
      select: { admitDate: true, dischargeDate: true },
    });

    /** `rate: null` = 등록 병상 0(산출 불가) — 0% 와 다른 사실이다 */
    const trend: Array<{ date: string; rate: number | null; occupied: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(23, 59, 59, 999);
      // 🔴 재원 중(discharge=now)은 '그날 23:59' 기준으로는 미래가 아니라서 오늘만 0 으로 떨어졌다
      //    (매일 마지막 점이 절벽 0%·같은 화면의 점유율 카드와 모순 P12). 그날에 걸쳐 있으면 점유다.
      const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
      const occupied = admissions.filter(a => {
        const admit = new Date(a.admitDate);
        const discharge = a.dischargeDate ? new Date(a.dischargeDate) : new Date();
        return admit <= d && discharge >= dayStart;
      }).length;
      trend.push({
        date: d.toISOString().slice(5, 10),
        /**
         * 🔴 (2026-09-16 I4) 등록 병상이 0 이면 가동률은 **0% 가 아니라 산출 불가**다.
         *    같은 사실(병상 가동률)을 executive 는 이미 `null`+'등록 병상 0 — 산출 불가' 로 내는데
         *    이 추이만 `0` 이라 **정본이 둘로 갈라져 있었다**(P12) — 위젯은 그 0 을 "가동률 0%"로 그린다.
         */
        rate: totalBeds > 0 ? Math.round((occupied / totalBeds) * 100) : null,
        occupied,
      });
    }
    return { totalBeds, trend };
  }
}
