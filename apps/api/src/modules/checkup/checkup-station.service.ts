import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { SpaceModelService } from '../space-model/space-model.service';
import { checkupItemPriority, estimatedWaitMinutes, rankNextStations } from '@hospital-run/shared';
import { todayRange } from '../../common/day-range';

@Injectable()
export class CheckupStationService {
  private readonly logger = new Logger(CheckupStationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journey?: JourneyService,
    // P4 이동 거리(동점 처리) — 도면 모듈이 없으면 거리 없이 추천한다
    @Optional() private readonly spaceModel?: SpaceModelService,
  ) {}

  // ═══════════════════════════════════════════
  // 스테이션 관리
  // ═══════════════════════════════════════════

  async getStations(category?: string) {
    const where: Prisma.CheckupStationWhereInput = { isActive: true };
    if (category) where.category = category;
    return this.prisma.checkupStation.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getStation(stationId: string) {
    const station = await this.prisma.checkupStation.findUnique({
      where: { stationId },
    });
    if (!station) throw new NotFoundException(`스테이션 '${stationId}'를 찾을 수 없습니다`);
    return station;
  }

  async updateStation(stationId: string, data: {
    name?: string; location?: string; avgMinutes?: number;
    capacity?: number; template?: unknown; isActive?: boolean;
    spaceNodeId?: string | null;
  }) {
    await this.getStation(stationId);
    if (data.spaceNodeId) {
      const node = await this.prisma.spaceNode.findUnique({ where: { id: data.spaceNodeId }, select: { isActive: true, nodeType: true } });
      if (!node || !node.isActive) throw new NotFoundException({ code: 'SPACE_NOT_FOUND', message: '공간을 찾을 수 없거나 비활성입니다.' });
      if (!['ZONE', 'WING', 'FLOOR'].includes(node.nodeType))
        throw new BadRequestException({ code: 'SPACE_NOT_PLACEABLE', message: '층·구역 단위에만 연결할 수 있습니다.', details: { nodeType: node.nodeType } });
    }
    return this.prisma.checkupStation.update({
      where: { stationId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.avgMinutes !== undefined && { avgMinutes: data.avgMinutes }),
        ...(data.capacity !== undefined && { capacity: data.capacity }),
        ...(data.template !== undefined && { template: data.template as Prisma.InputJsonValue }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.spaceNodeId !== undefined && { spaceNodeId: data.spaceNodeId }),
      },
    });
  }

  // ═══════════════════════════════════════════
  // 동선 추적 — 도착 / 시작 / 완료
  // ═══════════════════════════════════════════

  async arrive(visitId: string, stationId: string) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
      include: { patient: { select: { id: true, familyName: true, givenName: true } } },
    });
    if (!visit) throw new NotFoundException('검진 방문을 찾을 수 없습니다');
    const station = await this.getStation(stationId);

    // 이미 로그 있으면 업데이트, 없으면 생성
    const existing = await this.prisma.checkupStationLog.findUnique({
      where: { visitId_stationId: { visitId, stationId } },
    });

    const log = existing
      ? await this.prisma.checkupStationLog.update({
          where: { id: existing.id },
          data: { arrivedAt: new Date() },
        })
      : await this.prisma.checkupStationLog.create({
          data: { visitId, stationId, arrivedAt: new Date() },
        });

    this.journey?.emit({
      patientId: visit.patientId,
      eventType: 'CHECKUP_STATION_ARRIVE',
      title: `${station.name} 도착`,
      department: '건강검진센터',
      refType: 'CheckupStationLog',
      refId: log.id,
      navUrl: `/his-checkup/ws/${stationId}`,
      episode: { type: 'CheckupVisit', id: visitId }, occurredAt: log.arrivedAt ?? null, // 여정 P1: 방문 단위·스테이션 원장 시각
    });

    return log;
  }

  async start(visitId: string, stationId: string, operatorId?: string) {
    const log = await this.prisma.checkupStationLog.findUnique({
      where: { visitId_stationId: { visitId, stationId } },
    });
    if (!log) throw new BadRequestException('도착 기록이 없습니다. 먼저 도착 처리하세요.');

    return this.prisma.checkupStationLog.update({
      where: { id: log.id },
      data: { startedAt: new Date(), operatorId },
    });
  }

  /**
   * 스테이션 검사 완료.
   *
   * 🔴 `testNames` 는 **이 스테이션이 실제로 시행한 검사**다. 종전엔 이 인자가 없어
   *    `category` 가 같은 **미시행 항목까지 전부** 같은 판정으로 마감했다(2026-08-13 W5).
   *    LAB=채혈실+검체실, DIAGNOSTIC=심전도·폐기능·내시경·안과 이므로,
   *    채혈실이 '정상'을 찍으면 **채취조차 안 한 소변검사가 '정상 · 완료'** 가 되고
   *    심전도실이 찍으면 **위내시경이 '정상'** 으로 결과지에 인쇄됐다.
   *    시행하지 않은 검사를 정상이라 말하면 병변은 다음 검진(1년 뒤)까지 발견되지 않는다.
   */
  async complete(
    visitId: string,
    stationId: string,
    body: { resultData?: unknown; finding: string; note?: string; operatorId?: string; testNames?: string[] },
  ) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
      include: { patient: { select: { id: true, familyName: true, givenName: true } } },
    });
    if (!visit) throw new NotFoundException('검진 방문을 찾을 수 없습니다');
    const station = await this.getStation(stationId);

    // 1. StationLog 완료
    let log = await this.prisma.checkupStationLog.findUnique({
      where: { visitId_stationId: { visitId, stationId } },
    });
    if (!log) {
      // 도착 없이 바로 완료 (간소화 모드)
      log = await this.prisma.checkupStationLog.create({
        data: {
          visitId, stationId,
          arrivedAt: new Date(),
          startedAt: new Date(),
        },
      });
    }

    // 🔴 (2026-09-16 I2) 스테이션 완료(원장)·검사 항목 판정(임상 결과)·방문 상태를 한 트랜잭션에서 쓴다.
    //    종전엔 셋이 따로 나가, 중간에 실패하면 "스테이션은 완료인데 검사 항목은 PENDING"(전 항목 완료
    //    판정이 영영 안 선다) 또는 "항목은 판정됐는데 방문은 CHECKED_IN" 으로 갈라졌다. 재시도하면
    //    이미 완료된 로그를 다시 완료로 덮으면서 시행자·완료시각만 바뀐다.
    const scopedNames = (body.testNames ?? []).map((n) => String(n)).filter(Boolean);
    const { updated, itemsUpdated } = await this.prisma.$transaction(async (tx) => {
      const updatedLog = await tx.checkupStationLog.update({
        where: { id: log!.id },
        data: {
          completedAt: new Date(),
          resultData: body.resultData as Prisma.InputJsonValue ?? Prisma.JsonNull,
          finding: body.finding,
          note: body.note,
          operatorId: body.operatorId ?? log!.operatorId,
          ...(log!.startedAt ? {} : { startedAt: new Date() }),
        },
      });

      // 2. CheckupResultItem 업데이트 — **시행한 검사만**. 범위 미지정이면 항목을 건드리지 않는다
      //    (스테이션↔검사항목 매핑이 데이터에 없어 서버가 대신 추측할 수 없다 — 추측은 날조가 된다).
      const items = scopedNames.length > 0
        ? (await tx.checkupResultItem.updateMany({
            where: { visitId, category: station.category, finding: 'PENDING', testName: { in: scopedNames } },
            data: { finding: body.finding, completedAt: new Date() },
          })).count
        : 0;

      // 3. Visit 상태 자동 전환 (첫 완료 시 IN_PROGRESS)
      if (visit.status === 'CHECKED_IN') {
        await tx.checkupVisit.update({
          where: { id: visitId },
          data: { status: 'IN_PROGRESS' },
        });
      }
      return { updated: updatedLog, itemsUpdated: items };
    });

    // 4. 전 스테이션 완료 체크
    const [totalPending, totalLogs] = await Promise.all([
      this.prisma.checkupResultItem.count({ where: { visitId, finding: 'PENDING' } }),
      this.prisma.checkupStationLog.count({ where: { visitId, completedAt: { not: null } } }),
    ]);

    // 5. Journey 이벤트
    this.journey?.emit({
      patientId: visit.patientId,
      eventType: 'CHECKUP_STATION_COMPLETE',
      title: `${station.name} 완료 — ${body.finding === 'NORMAL' ? '정상' : body.finding === 'CRITICAL' ? '위급값' : '이상'}`,
      department: '건강검진센터',
      refType: 'CheckupStationLog',
      refId: updated.id,
      navUrl: `/his-checkup/ws/${stationId}`,
      severity: body.finding === 'CRITICAL' ? 'CRITICAL' : undefined,
      episode: { type: 'CheckupVisit', id: visitId }, occurredAt: updated.completedAt ?? null, // 여정 P1
    });

    // 6. 위급값 알림
    if (body.finding === 'CRITICAL') {
      this.journey?.emit({
        patientId: visit.patientId,
        eventType: 'CHECKUP_CRITICAL',
        title: `위급값 발견 — ${station.name}`,
        department: '건강검진센터',
        refType: 'CheckupStationLog',
        refId: updated.id,
        severity: 'CRITICAL',
        navUrl: `/his-checkup/visit/${visitId}`,
      });
    }

    // 7. 다음 스테이션 추천
    const nextStation = await this.getNextStation(visitId);

    return {
      ...updated,
      stationsDone: totalLogs,
      itemsUpdated,
      itemsPending: totalPending,
      allDone: totalPending === 0,
      nextStation,
    };
  }

  // ═══════════════════════════════════════════
  // 동선 현황판 (Flow Board)
  // ═══════════════════════════════════════════

  private todayRange() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateStr = kst.toISOString().slice(0, 10);
    const today = new Date(dateStr + 'T00:00:00Z');
    const tomorrow = new Date(dateStr + 'T00:00:00Z');
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { today, tomorrow, dateStr };
  }

  async getFlowBoard() {
    const { today, tomorrow } = this.todayRange();

    const [stations, visits] = await Promise.all([
      this.prisma.checkupStation.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { stationId: true, name: true, icon: true, category: true, avgMinutes: true },
      }),
      this.prisma.checkupVisit.findMany({
        where: {
          scheduledDate: { gte: today, lt: tomorrow },
          status: { in: ['CHECKED_IN', 'IN_PROGRESS', 'EXAM_COMPLETE', 'PARTIAL_COMPLETE'] },
        },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true } },
          program: { select: { code: true, name: true } },
          stationLogs: {
            select: { stationId: true, arrivedAt: true, startedAt: true, completedAt: true, finding: true },
          },
        },
        orderBy: { checkedInAt: 'asc' },
      }),
    ]);

    // 수검자 × 스테이션 매트릭스 구성
    const matrix = visits.map((v) => {
      const logMap = new Map(v.stationLogs.map((l) => [l.stationId, l]));
      return {
        visitId: v.id,
        patient: v.patient,
        program: v.program,
        status: v.status,
        checkedInAt: v.checkedInAt,
        stations: stations.map((s) => {
          const log = logMap.get(s.stationId);
          return {
            stationId: s.stationId,
            status: !log ? 'WAITING'
              : log.completedAt ? 'COMPLETED'
              : log.startedAt ? 'IN_PROGRESS'
              : 'ARRIVED',
            finding: log?.finding ?? null,
            arrivedAt: log?.arrivedAt ?? null,
            completedAt: log?.completedAt ?? null,
          };
        }),
      };
    });

    // 스테이션별 대기 수
    const stationStats = stations.map((s) => {
      const waiting = matrix.filter((m) =>
        m.stations.find((st) => st.stationId === s.stationId && st.status === 'ARRIVED'),
      ).length;
      const inProgress = matrix.filter((m) =>
        m.stations.find((st) => st.stationId === s.stationId && st.status === 'IN_PROGRESS'),
      ).length;
      const completed = matrix.filter((m) =>
        m.stations.find((st) => st.stationId === s.stationId && st.status === 'COMPLETED'),
      ).length;
      return { ...s, waiting, inProgress, completed, estimatedWait: waiting * s.avgMinutes };
    });

    return { stations: stationStats, matrix, totalVisitors: visits.length };
  }

  // ═══════════════════════════════════════════
  // 다음 스테이션 추천 (대기시간 기반)
  // ═══════════════════════════════════════════

  /**
   * 다음 스테이션 추천 — 정본 shared `rankNextStations`(환자 앱과 같은 규칙 · P0-6).
   *
   * 🔴 종전: 대기 수 조건 `arrivedAt: { not: undefined }` 를 Prisma 가 무시해 **날짜와 무관한 미완료 로그 전부**를 셌고
   *    (어제 끝내지 못한 기록이 오늘의 대기가 됐다), 금식 채혈 우선·내시경 후순위 규칙을 보지 않았다.
   * 지금: 오늘 도착·미완료만 센다 · 우선순위(그 스테이션에서 할 미완료 검사 중 가장 이른 것) → 예상 대기.
   */
  async getNextStation(visitId: string) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
      include: {
        program: { select: { items: true } },
        stationLogs: { select: { stationId: true, completedAt: true, station: { select: { spaceNodeId: true } } } },
        items: { select: { testName: true, category: true, finding: true } },
      },
    });
    if (!visit) return null;

    const completedStations = new Set(
      visit.stationLogs.filter((l) => l.completedAt).map((l) => l.stationId),
    );
    const pendingItems = visit.items.filter((i) => i.finding === 'PENDING');
    const pendingCategories = new Set(pendingItems.map((i) => i.category));

    const stations = await this.prisma.checkupStation.findMany({
      where: { isActive: true, category: { in: [...pendingCategories] } },
      orderBy: { sortOrder: 'asc' },
      include: { spaceNode: { select: { id: true, name: true, floor: true } } },
    });
    const open = stations.filter((s) => !completedStations.has(s.stationId));
    if (!open.length) return null;

    const { gte, lt } = todayRange();
    const waiting = await this.prisma.checkupStationLog.groupBy({
      by: ['stationId'],
      where: { stationId: { in: open.map((s) => s.stationId) }, completedAt: null, arrivedAt: { gte, lt } },
      _count: true,
    });
    const waitBy = new Map(waiting.map((w) => [w.stationId, w._count]));
    // 현재 위치 = 마지막으로 완료한 스테이션의 공간(없으면 거리를 계산하지 않는다)
    const lastDone = [...visit.stationLogs].filter((l) => l.completedAt).sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())[0];
    const distances = this.spaceModel
      ? await this.spaceModel.walkDistances(lastDone?.station?.spaceNodeId ?? null, open.map((s) => s.spaceNode?.id).filter((x): x is string => !!x))
      : new Map<string, number | null>();

    const candidates = open.map((s) => {
      const mine = pendingItems.filter((i) => i.category === s.category);
      const priority = mine.length
        ? Math.min(...mine.map((i) => checkupItemPriority({ category: i.category, name: i.testName })))
        : checkupItemPriority({ category: s.category, name: null });
      const waitingCount = waitBy.get(s.stationId) ?? 0;
      return {
        key: s.stationId,
        stationId: s.stationId,
        name: s.name,
        // 위치는 공간 정본에서 — 연결 안 된 스테이션은 null(자유 텍스트 `location` 으로 채우지 않는다)
        location: s.spaceNode?.name ?? null,
        floor: s.spaceNode?.floor ?? null,
        spaceNodeId: s.spaceNode?.id ?? null,
        icon: s.icon,
        priority,
        waitingCount,
        avgMinutes: s.avgMinutes,
        estimatedWait: estimatedWaitMinutes({ waitingCount, avgMinutes: s.avgMinutes }),
        distanceM: s.spaceNode ? distances.get(s.spaceNode.id) ?? null : null,
      };
    });
    return rankNextStations(candidates)[0] ?? null;
  }

  // ═══════════════════════════════════════════
  // 스테이션 큐 (개별 스테이션용)
  // ═══════════════════════════════════════════

  async getStationQueue(stationId: string) {
    const station = await this.getStation(stationId);
    const { today, tomorrow } = this.todayRange();

    // 오늘 접수된 방문 중 이 스테이션 카테고리에 해당하는 PENDING 항목이 있는 것
    const visits = await this.prisma.checkupVisit.findMany({
      where: {
        scheduledDate: { gte: today, lt: tomorrow },
        status: { in: ['CHECKED_IN', 'IN_PROGRESS'] },
        items: { some: { category: station.category, finding: 'PENDING' } },
      },
      include: {
        patient: {
          select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true },
        },
        program: { select: { code: true, name: true } },
        stationLogs: {
          where: { stationId },
          select: { arrivedAt: true, startedAt: true, completedAt: true, finding: true },
          take: 1,
        },
        items: {
          where: { category: station.category },
          select: { testName: true, finding: true, value: true, unit: true },
        },
      },
      orderBy: { checkedInAt: 'asc' },
    });

    // 이미 이 스테이션을 완료한 방문은 제외
    const queue = visits.filter((v) => {
      const log = v.stationLogs[0];
      return !log?.completedAt;
    }).map((v) => ({
      visitId: v.id,
      patient: v.patient,
      program: v.program,
      checkedInAt: v.checkedInAt,
      stationStatus: v.stationLogs[0]
        ? (v.stationLogs[0].startedAt ? 'IN_PROGRESS' : 'ARRIVED')
        : 'WAITING',
      items: v.items,
      pendingCount: v.items.filter((i) => i.finding === 'PENDING').length,
    }));

    return { station, queue, queueLength: queue.length };
  }

  // ═══════════════════════════════════════════
  // 스테이션 통계
  // ═══════════════════════════════════════════

  async getStationStats(stationId: string, date?: string) {
    let targetDate: Date, nextDay: Date;
    if (date) {
      targetDate = new Date(date + 'T00:00:00+09:00');
      nextDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
    } else {
      const r = this.todayRange();
      targetDate = r.today;
      nextDay = r.tomorrow;
    }

    const logs = await this.prisma.checkupStationLog.findMany({
      where: {
        stationId,
        arrivedAt: { gte: targetDate, lt: nextDay },
        completedAt: { not: null },
      },
      select: { arrivedAt: true, startedAt: true, completedAt: true, finding: true },
    });

    let totalMinutes = 0;
    const hourlyCount: Record<number, number> = {};

    for (const log of logs) {
      if (log.startedAt && log.completedAt) {
        totalMinutes += (log.completedAt.getTime() - log.startedAt.getTime()) / 60000;
      }
      const hour = log.arrivedAt.getHours();
      hourlyCount[hour] = (hourlyCount[hour] ?? 0) + 1;
    }

    return {
      stationId,
      date: targetDate.toISOString().slice(0, 10),
      totalProcessed: logs.length,
      // 🔴 (2026-09-17 L4) 처리 0 건이면 '평균 0 분'(=즉시 처리)이 아니라 산출 불가. totalProcessed 가 분모다.
      avgMinutes: logs.length > 0 ? Math.round((totalMinutes / logs.length) * 10) / 10 : null,
      abnormalCount: logs.filter((l) => l.finding === 'ABNORMAL' || l.finding === 'CRITICAL').length,
      criticalCount: logs.filter((l) => l.finding === 'CRITICAL').length,
      hourlyDistribution: hourlyCount,
    };
  }
}
