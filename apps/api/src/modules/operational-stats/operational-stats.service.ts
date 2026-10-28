import { Injectable } from '@nestjs/common';
import { summarizeStayDays } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AdmissionStatus } from '@prisma/client';

@Injectable()
export class OperationalStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 기본 조회창(일) — 명시 인자가 없을 때 거슬러 올라가는 날짜 수 */
  private static readonly DEFAULT_WINDOW_DAYS = 30;

  private getDateRange(startDate?: string, endDate?: string): { gte: Date; lte: Date } {
    const now = new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - OperationalStatsService.DEFAULT_WINDOW_DAYS);
    const end = endDate ? new Date(endDate) : now;

    return { gte: start, lte: end };
  }

  /**
   * 조회창을 응답에 그대로 실어 보낸다 — 화면이 "며칠치인지" 라벨에 적을 수 있게.
   * 🔴 종전에는 창이 응답 어디에도 없어서, 30일 값을 '오늘'로 읽는 소비처가 생겼다(P1).
   */
  private windowMeta(startDate?: string, endDate?: string) {
    const { gte, lte } = this.getDateRange(startDate, endDate);
    const isDefault = !startDate && !endDate;
    return {
      from: gte.toISOString(),
      to: lte.toISOString(),
      /** 창에 **온전히** 들어가는 일수(floor) — 부풀리지 않는다. 정확한 경계는 from/to 가 정본 */
      days: Math.max(1, Math.floor((lte.getTime() - gte.getTime()) / 86_400_000)),
      isDefault,
    };
  }

  /** 기준 시각이 속한 KST 하루의 시작(UTC Date) — 컨테이너 OS 는 UTC 라 로컬 자정에 기대지 않는다 */
  private kstDayStart(now: Date = new Date()): Date {
    const kst = new Date(now.getTime() + 9 * 3_600_000);
    return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3_600_000);
  }

  async getWardStats(startDate?: string, endDate?: string) {
    const dateRange = this.getDateRange(startDate, endDate);

    // 병동 + 병상 수(beds.length만 필요 → id만 select)
    const wards = await this.prisma.ward.findMany({
      include: { beds: { select: { id: true } } },
    });

    // N+1 제거: 병동별 개별 쿼리 대신 단일 조회 후 wardId로 그룹핑
    const admissions = await this.prisma.admission.findMany({
      where: { admitDate: dateRange, bed: { wardId: { in: wards.map(w => w.id) } } },
      select: { status: true, bed: { select: { wardId: true } } },
    });
    const byWard = new Map<string, { total: number; discharged: number; active: number }>();
    for (const a of admissions) {
      const wid = a.bed?.wardId;
      if (!wid) continue;
      const g = byWard.get(wid) ?? { total: 0, discharged: 0, active: 0 };
      g.total += 1;
      if (a.status === AdmissionStatus.DISCHARGED) g.discharged += 1;
      if (a.status === AdmissionStatus.ADMITTED) g.active += 1;
      byWard.set(wid, g);
    }

    return wards.map(ward => {
      const g = byWard.get(ward.id) ?? { total: 0, discharged: 0, active: 0 };
      return {
        wardId: ward.id,
        wardName: ward.name,
        totalBeds: ward.beds.length,
        totalAdmissions: g.total,
        discharged: g.discharged,
        activePatients: g.active,
        /**
         * 🔴 (2026-09-16 I4) 분모(그 병동의 기간 내 입원)가 0 이면 퇴원율은 **0% 가 아니라 산출 불가**다.
         *    종전엔 입원을 한 건도 받지 않은 병동이 "퇴원율 0%"(=최악)로 그려졌다.
         */
        dischargeRate: g.total > 0 ? (g.discharged / g.total) * 100 : null,
        dischargeRateUnavailableReason: g.total > 0 ? null : '기간 내 입원 0건 — 퇴원율을 산출할 수 없습니다',
      };
    });
  }

  async getAdmissionTrends(startDate?: string, endDate?: string) {
    const dateRange = this.getDateRange(startDate, endDate);

    const admissions = await this.prisma.admission.findMany({
      where: { admitDate: dateRange },
      select: { admitDate: true, dischargeDate: true, status: true },
    });

    const groupedByDate = new Map<string, number>();
    admissions.forEach(a => {
      const date = a.admitDate.toISOString().split('T')[0];
      groupedByDate.set(date, (groupedByDate.get(date) || 0) + 1);
    });

    const dailyTrends = Array.from(groupedByDate.entries()).map(([date, count]) => ({
      date,
      admissions: count,
    }));

    const totalAdmissions = admissions.length;
    const totalDischarges = admissions.filter(a => a.status === AdmissionStatus.DISCHARGED).length;
    // 🔴 (2026-10-01) 종전: 분자는 퇴원일이 있는 행 전부·분모는 DISCHARGED 수(서로 다른 집합) · 소수 일 · 표본 0 이면 `0`.
    //    → 퇴원한 입원만 · 개별 값은 정본 stayDays · 표본 0 이면 null(산출 불가 — 0 일이 아니다)
    const los = summarizeStayDays(admissions.filter(a => a.status === AdmissionStatus.DISCHARGED));

    return {
      totalAdmissions,
      totalDischarges,
      avgStayDays: los.meanDays,
      /** 평균 재원일수 표본(퇴원 입원 중 날짜가 온전한 것) */
      avgStayDaysSampleN: los.n,
      dailyTrends: dailyTrends.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  /**
   * 환자 유입/퇴원.
   *
   * 🔴 원 결함(W8 이연·2026-08-14 회수): `dischargedToday` 가 **이름과 달리 기본 30일 창**의
   *    퇴원 수였다(`getDateRange` 기본값). 화면(대시보드 '환자 흐름' 위젯)은 이 값을 그대로 읽는데
   *    필드명이 '오늘'이라고 말하니, 서버를 읽는 쪽은 전부 오늘로 오해한다 —
   *    **필드명이 거짓말을 하면 라벨을 아무리 고쳐도 다음 소비처에서 또 갈라진다**(P1·P12).
   *    운영 실측(2026-08-14): 30일 퇴원 **1건** / 오늘 퇴원 **0건** — 화면은 '오늘 퇴원 1명'이었다.
   *
   *    회수 방식: **창을 이름에 맞춘다** — `dischargedToday` 는 이제 진짜 '오늘(KST)'만 센다.
   *    창 기준 값은 이름 그대로인 `dischargedInWindow` 로 따로 낸다(키 제거 없음 = 소비처 안 깨짐).
   *    창 자체도 `window` 로 응답에 실어 화면이 기간을 라벨에 적을 수 있게 한다.
   */
  async getPatientFlow(startDate?: string, endDate?: string) {
    const dateRange = this.getDateRange(startDate, endDate);
    const todayStart = this.kstDayStart();
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);
    const todayRange = { gte: todayStart, lt: todayEnd };

    const [admitted, discharged, activeAdmissions, admittedToday, dischargedToday] = await Promise.all([
      this.prisma.admission.count({
        where: { admitDate: dateRange, status: { in: [AdmissionStatus.ADMITTED, AdmissionStatus.TRANSFERRED] } },
      }),
      this.prisma.admission.count({
        where: { dischargeDate: dateRange, status: AdmissionStatus.DISCHARGED },
      }),
      this.prisma.admission.count({ where: { status: AdmissionStatus.ADMITTED } }),
      this.prisma.admission.count({
        where: { admitDate: todayRange, status: { in: [AdmissionStatus.ADMITTED, AdmissionStatus.TRANSFERRED] } },
      }),
      this.prisma.admission.count({
        where: { dischargeDate: todayRange, status: AdmissionStatus.DISCHARGED },
      }),
    ]);

    return {
      /** 조회창(기본 30일) — 화면이 라벨에 기간을 적을 수 있게 응답에 싣는다 */
      window: this.windowMeta(startDate, endDate),

      // ── 창 기준 ──
      newAdmissions: admitted,
      /** 🔴 창 기준 퇴원 — 이름 그대로. 종전 `dischargedToday` 가 실제로 담고 있던 값이다 */
      dischargedInWindow: discharged,
      netFlow: admitted - discharged,

      // ── 오늘(KST) 기준 ──
      /** 🔴 이제 정말 '오늘'이다(종전엔 창 전체였다) */
      dischargedToday,
      admittedToday,
      netFlowToday: admittedToday - dischargedToday,

      activePatients: activeAdmissions,
    };
  }

  async getDiseaseStats(startDate?: string, endDate?: string) {
    const dateRange = this.getDateRange(startDate, endDate);

    // 전건 fetch+JS 집계 대신 DB groupBy(상위 10) → 코드명만 별도 1회 조회
    const grouped = await this.prisma.prescription.groupBy({
      by: ['procedureCodeId'],
      where: { procedureCodeId: { not: null }, encounter: { createdAt: dateRange } },
      _count: { _all: true },
      orderBy: { _count: { procedureCodeId: 'desc' } },
      take: 10,
    });
    const ids = grouped.map(g => g.procedureCodeId).filter((x): x is string => !!x);
    if (!ids.length) return [];
    const codes = await this.prisma.procedureCode.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, nameKo: true },
    });
    const codeMap = new Map(codes.map(c => [c.id, c]));

    return grouped.map(g => {
      const c = codeMap.get(g.procedureCodeId as string);
      return { name: `${c?.code}-${c?.nameKo}`, count: g._count._all };
    });
  }

  async getFinancialStats(startDate?: string, endDate?: string) {
    const dateRange = this.getDateRange(startDate, endDate);

    const billings = await this.prisma.billing.findMany({
      where: { createdAt: dateRange },
      select: { totalAmount: true, insuranceCovered: true, patientCopay: true, status: true },
    });

    const totalAmount = billings.reduce((sum, b) => sum + b.totalAmount, 0);
    const insuranceCovered = billings.reduce((sum, b) => sum + b.insuranceCovered, 0);
    const patientCopay = billings.reduce((sum, b) => sum + b.patientCopay, 0);

    return {
      totalBillings: billings.length,
      totalAmount,
      insuranceCovered,
      patientCopay,
      // 🔴 (2026-09-17 L4) 청구 0 건이면 평균 청구액은 0 원이 아니라 산출 불가.
      avgBillingAmount: billings.length > 0 ? Math.round((totalAmount / billings.length) * 100) / 100 : null,
    };
  }
}
