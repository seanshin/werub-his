import { Injectable, NotFoundException, GoneException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WaitingQueueService } from './waiting-queue.service';
import { publicBaseUrl } from '../../common/util/public-url';
import { todayDateOnly } from '../../common/day-range';
import { readHospitalConfig } from '../config/hospital-facts';

@Injectable()
export class QueueDisplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: WaitingQueueService,
  ) {}

  private getTodayStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /**
   * 접수 후 경과 분 — 🔴 **아직 오지 않은 시각은 경과가 아니다**(W9·P1).
   * 실측(2026-08-14 운영 SSE): `checkedInAt` 이 현재보다 앞선 행이 섞여 있어
   * `waitMinutes: -93`, `-113` 이 공개 전광판 페이로드에 그대로 실려 나갔다.
   * 화면은 이걸 `-1시간 33분` 또는 '방금'으로 그린다 — 둘 다 거짓이다.
   * 모르는 것(아직 접수 시각에 이르지 않음)은 **null** 로 말하고 화면이 '-' 를 그리게 한다.
   */
  private elapsedMinutes(from: Date, now: number): number | null {
    const diff = now - from.getTime();
    if (diff < 0) return null;
    return Math.round(diff / 60000);
  }

  /**
   * 예상 대기시간 정본 — 해당 과 **오늘 실측 표본**만 쓴다.
   * 🔴 표본이 없을 때 상수로 채우면(종전 티켓 15분·모바일 `앞대기×8분`) 환자에게 보여주는 숫자가 날조된다(P15).
   *    표본 부재의 정답은 폴백이 아니라 **산출 불가(null)** — 근거 문장을 함께 실어 화면이 이유를 말하게 한다.
   */
  private async estimateWait(departmentName: string, waitingAhead: number) {
    const completed = await this.prisma.waitingQueue.findMany({
      where: {
        departmentName,
        checkedInAt: { gte: this.getTodayStart() },
        startedAt: { not: null },
      },
      select: { checkedInAt: true, startedAt: true },
      take: 20,
      orderBy: { checkedInAt: 'desc' },
    });

    // 음수 대기(접수 시각이 진료 시작보다 뒤)는 표본에서 뺀다 — 평균을 끌어내려 대기를 축소해 보이게 한다
    const times = completed
      .map((c) => (c.startedAt!.getTime() - c.checkedInAt.getTime()) / 60000)
      .filter((m) => m >= 0);
    const avgWait = times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : null;

    return {
      estimatedWaitMinutes: avgWait === null
        ? null
        : Math.max(1, Math.round((avgWait * (waitingAhead + 1)) / 2)),
      estimatedWaitSampleN: times.length,
      estimatedWaitBasis: avgWait === null
        ? `${departmentName} 오늘 진료 시작 시각 기록이 없어 예상 대기시간을 산출할 수 없습니다`
        : `${departmentName} 오늘 진료 시작 ${times.length}건 기준(평균 대기 ${avgWait}분)`,
    };
  }

  /** API Key 검증 */
  async validateApiKey(key: string): Promise<boolean> {
    const apiKey = await this.prisma.displayApiKey.findUnique({ where: { key } });
    if (!apiKey || !apiKey.isActive) return false;
    // 마지막 사용 시간 갱신 (fire-and-forget)
    this.prisma.displayApiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});
    return true;
  }

  /** 과별 대기 현황 (디스플레이 메인) */
  async getDisplay(opts: {
    departments?: string[];
    statuses?: string[];
    limit?: number;
  }) {
    const todayStart = this.getTodayStart();
    const defaultStatuses = ['WAITING', 'CALLED', 'IN_CONSULTATION', 'CASHIER_WAITING', 'PHARMACY_WAITING'];
    const statuses = opts.statuses?.length ? opts.statuses : defaultStatuses;

    const where: Prisma.WaitingQueueWhereInput = {
      checkedInAt: { gte: todayStart },
      status: { in: statuses },
    };
    if (opts.departments?.length) {
      where.departmentName = { in: opts.departments };
    }

    const queues = await this.prisma.waitingQueue.findMany({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true } },
        doctor: { select: { familyName: true, givenName: true } },
      },
      orderBy: [{ priorityOrder: 'asc' }, { queueNumber: 'asc' }],
    });

    // 과별 그룹핑
    const deptMap = new Map<string, any[]>();
    for (const q of queues) {
      const dept = q.departmentName;
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(q);
    }

    // 과별 통계 (전체 — COMPLETED 포함)
    const allQueues = await this.prisma.waitingQueue.findMany({
      where: {
        checkedInAt: { gte: todayStart },
        ...(opts.departments?.length ? { departmentName: { in: opts.departments } } : {}),
      },
      select: { departmentName: true, status: true, checkedInAt: true, startedAt: true },
    });

    const deptStats = new Map<string, { waiting: number; called: number; inConsultation: number; completedToday: number; waitTimes: number[] }>();
    for (const q of allQueues) {
      if (!deptStats.has(q.departmentName)) {
        deptStats.set(q.departmentName, { waiting: 0, called: 0, inConsultation: 0, completedToday: 0, waitTimes: [] });
      }
      const s = deptStats.get(q.departmentName)!;
      if (q.status === 'WAITING') s.waiting++;
      else if (q.status === 'CALLED') s.called++;
      else if (q.status === 'IN_CONSULTATION') s.inConsultation++;
      // 🔴 진료를 마치고 수납을 기다리는 환자(CASHIER_WAITING)도 **진료는 끝났다.**
      //    종전엔 어느 버킷에도 안 들어가 진료실 '오늘 완료' 실적이 실제보다 낮게 나왔다.
      // 🔴 2026-09-02: 수납 **이후** 두 상태도 같은 이유로 빠져 있었다.
      //    `billing.service.ts` 는 결제(PAID) 시 CASHIER_WAITING 을 처방 유무에 따라
      //    PHARMACY_WAITING / VISIT_COMPLETED 로 바꾼다 — 즉 **수납한 환자는 전부** 이 둘이 된다.
      //    그런데 집계는 셋 다 아니어서 '오늘 완료'가 수납 순간 오히려 줄었다.
      //    (운영 DB 에 아직 이 상태 0행인 것은 시드가 수납 전이를 태우지 않아서다 — 결함이 없어서가 아니다.)
      //    (취소 CANCELLED·미방문 NO_SHOW 는 의도적으로 어디에도 세지 않는다 — 대기도 완료도 아니다.)
      else if (q.status === 'COMPLETED' || q.status === 'CASHIER_WAITING' || q.status === 'PHARMACY_WAITING' || q.status === 'VISIT_COMPLETED') s.completedToday++;
      // 🔴 음수 대기(진료 시작이 접수보다 앞선 행)는 표본에서 뺀다 — 섞이면 평균이 내려가 대기를 축소해 보이게 한다(W9)
      if (q.startedAt) {
        const wait = (q.startedAt.getTime() - q.checkedInAt.getTime()) / 60000;
        if (wait >= 0) s.waitTimes.push(wait);
      }
    }

    const now = Date.now();
    const departments = Array.from(deptMap.entries()).map(([name, items]) => {
      const limited = items.slice(0, opts.limit ?? 20);
      const stats = deptStats.get(name) ?? { waiting: 0, called: 0, inConsultation: 0, completedToday: 0, waitTimes: [] };
      // 🔴 표본 0건을 '평균 대기 0분'으로 말하던 것 — W8 잔여(P1: 모르는 것을 안다고 말함).
      //    '0분'은 "기다림이 없다"는 뜻이라 대기 인원이 수백 명이어도 전광판이 초록으로 안심시킨다(P17).
      //    모르면 null 이고, 표본 수(waitSampleN)를 같이 실어 화면이 근거를 말하게 한다.
      const avgWait = stats.waitTimes.length > 0
        ? Math.round(stats.waitTimes.reduce((a, b) => a + b, 0) / stats.waitTimes.length)
        : null;

      return {
        name,
        queues: limited.map(q => ({
          queueNumber: q.queueNumber,
          status: q.status,
          patientName: this.queueService.maskName(q.patient.familyName, q.patient.givenName),
          roomName: q.roomName,
          doctorName: this.queueService.maskName(q.doctor.familyName, q.doctor.givenName),
          type: q.type,
          visitType: q.visitType,
          checkedInAt: q.checkedInAt.toISOString(),
          calledAt: q.calledAt?.toISOString() ?? null,
          startedAt: q.startedAt?.toISOString() ?? null,
          /** 🔴 아직 오지 않은 접수 시각은 음수가 아니라 null — 전광판이 '-1시간 33분'을 그리지 않게 한다 */
          waitMinutes: this.elapsedMinutes(q.checkedInAt, now),
          callCount: q.callCount,
        })),
        stats: {
          waiting: stats.waiting,
          called: stats.called,
          inConsultation: stats.inConsultation,
          completedToday: stats.completedToday,
          /** 표본 없으면 null(산출 불가) — 0 은 '대기 없음'이라는 다른 사실이다 */
          avgWaitMinutes: avgWait,
          /** 평균 대기 산출에 쓴 표본 수 = 오늘분 중 진료 시작 시각이 기록된 건 */
          waitSampleN: stats.waitTimes.length,
        },
      };
    });

    // 최근 호출 (lastCall)
    const lastCalled = await this.prisma.waitingQueue.findFirst({
      where: {
        checkedInAt: { gte: todayStart },
        status: 'CALLED',
        calledAt: { not: null },
        ...(opts.departments?.length ? { departmentName: { in: opts.departments } } : {}),
      },
      include: {
        patient: { select: { familyName: true, givenName: true } },
        doctor: { select: { familyName: true, givenName: true } },
      },
      orderBy: { calledAt: 'desc' },
    });

    let lastCall = null;
    if (lastCalled) {
      const masked = this.queueService.maskName(lastCalled.patient.familyName, lastCalled.patient.givenName);
      lastCall = {
        departmentName: lastCalled.departmentName,
        queueNumber: lastCalled.queueNumber,
        patientName: masked,
        roomName: lastCalled.roomName,
        doctorName: this.queueService.maskName(lastCalled.doctor.familyName, lastCalled.doctor.givenName),
        calledAt: lastCalled.calledAt!.toISOString(),
        callCount: lastCalled.callCount,
        ttsText: this.queueService.buildTtsText(
          lastCalled.departmentName, lastCalled.queueNumber,
          masked, lastCalled.roomName, lastCalled.callCount,
        ),
      };
    }

    // 전체 통계
    let totalWaiting = 0, totalCalled = 0, totalInConsultation = 0, totalCompleted = 0;
    for (const s of deptStats.values()) {
      totalWaiting += s.waiting;
      totalCalled += s.called;
      totalInConsultation += s.inConsultation;
      totalCompleted += s.completedToday;
    }

    return {
      data: {
        departments,
        lastCall,
        totalStats: {
          waiting: totalWaiting,
          called: totalCalled,
          inConsultation: totalInConsultation,
          completedToday: totalCompleted,
        },
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  /** 최근 호출 이벤트 */
  async getCallEvents(opts: { since?: Date; departments?: string[] }) {
    const todayStart = this.getTodayStart();
    const since = opts.since ?? new Date(Date.now() - 5 * 60 * 1000); // 기본 5분 전

    const where: Prisma.WaitingQueueWhereInput = {
      checkedInAt: { gte: todayStart },
      calledAt: { gte: since },
      status: { in: ['CALLED', 'IN_CONSULTATION'] },
    };
    if (opts.departments?.length) {
      where.departmentName = { in: opts.departments };
    }

    const events = await this.prisma.waitingQueue.findMany({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true } },
        doctor: { select: { familyName: true, givenName: true } },
      },
      orderBy: { calledAt: 'desc' },
      take: 20,
    });

    return {
      data: {
        events: events.map(e => {
          const masked = this.queueService.maskName(e.patient.familyName, e.patient.givenName);
          return {
            eventId: e.id,
            eventType: e.callCount > 1 ? 'RE_CALLED' : 'CALLED',
            departmentName: e.departmentName,
            queueNumber: e.queueNumber,
            patientName: masked,
            roomName: e.roomName,
            doctorName: this.queueService.maskName(e.doctor.familyName, e.doctor.givenName),
            calledAt: e.calledAt!.toISOString(),
            callCount: e.callCount,
            ttsText: this.queueService.buildTtsText(
              e.departmentName, e.queueNumber,
              masked, e.roomName, e.callCount,
            ),
          };
        }),
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  /** 대기번호표 데이터 (마스킹 없음 — 본인용) */
  async getTicket(queueId: string) {
    const queue = await this.prisma.waitingQueue.findUnique({
      where: { id: queueId },
      include: {
        patient: { select: { familyName: true, givenName: true } },
        doctor: { select: { familyName: true, givenName: true } },
      },
    });
    if (!queue) throw new NotFoundException({ code: 'QUEUE_NOT_FOUND', message: '대기 정보를 찾을 수 없습니다.' });

    // 앞 대기 인원 계산
    const waitingAhead = await this.prisma.waitingQueue.count({
      where: {
        departmentName: queue.departmentName,
        doctorId: queue.doctorId,
        status: 'WAITING',
        queueNumber: { lt: queue.queueNumber },
        checkedInAt: { gte: this.getTodayStart() },
      },
    });

    // 🔴 표본이 없을 때 `avgWait = 15`(기본 15분)로 폴백해 **환자에게 보여주는 예상 대기시간을 상수로 날조**하던 것 — W8 잔여(P15).
    //    실측(2026-08-14): 외래 waiting_queue 오늘분 198건 전부 `startedAt` 미기록 → 모든 과에서 표본 0건인데도
    //    환자 안내 화면은 "예상 15분×앞대기"를 그럴듯한 숫자로 계산해 내보내고 있었다.
    //    산출은 정본 `estimateWait` 하나로 — 종전엔 여기와 모바일 대기 확인이 서로 다른 공식을 썼다(P12).
    const { estimatedWaitMinutes, estimatedWaitSampleN, estimatedWaitBasis } =
      await this.estimateWait(queue.departmentName, waitingAhead);

    const baseUrl = publicBaseUrl();
    // 🔴 기관명은 정본(DB 행만) — 종전엔 'Hospital RUN' 상수였다. 미설정이면 null(번호표에 지어낸 이름을 싣지 않는다).
    const { 'hospital.name': hospitalName } = await readHospitalConfig(this.prisma, ['hospital.name'] as const);

    return {
      data: {
        queueId: queue.id,
        queueNumber: queue.queueNumber,
        departmentName: queue.departmentName,
        doctorName: `${queue.doctor.familyName}${queue.doctor.givenName}`,
        roomName: queue.roomName,
        patientName: `${queue.patient.familyName}${queue.patient.givenName}`,
        type: queue.type,
        visitType: queue.visitType,
        checkedInAt: queue.checkedInAt.toISOString(),
        waitingAhead,
        /** 표본이 없으면 null — 화면은 숫자 대신 '산출 불가'를 말해야 한다(폴백 금지) */
        estimatedWaitMinutes,
        estimatedWaitSampleN,
        estimatedWaitBasis,
        waitingToken: queue.waitingToken,
        waitingUrl: queue.waitingToken ? `${baseUrl}/api/v1/queue/public/waiting/${queue.waitingToken}` : null,
        hospital: {
          name: hospitalName,
          notice: '3회 호출 후 미응답 시 접수가 취소됩니다',
        },
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  /** 환자 모바일 대기 확인 (토큰 기반) */
  async getWaiting(token: string) {
    const queue = await this.prisma.waitingQueue.findUnique({
      where: { waitingToken: token },
      include: {
        doctor: { select: { familyName: true, givenName: true } },
      },
    });

    if (!queue) throw new NotFoundException({ code: 'QUEUE_NOT_FOUND', message: '대기 정보를 찾을 수 없습니다.' });

    // 토큰 만료 체크 (접수일 다음날 자정)
    if (queue.checkedInAt.getTime() < this.getTodayStart().getTime()) {
      throw new GoneException({ code: 'TOKEN_EXPIRED', message: '대기 정보가 만료되었습니다. 접수 데스크에 문의하세요.' });
    }

    // 앞 대기 인원
    const waitingAhead = queue.status === 'WAITING'
      ? await this.prisma.waitingQueue.count({
          where: {
            departmentName: queue.departmentName,
            doctorId: queue.doctorId,
            status: 'WAITING',
            queueNumber: { lt: queue.queueNumber },
            checkedInAt: { gte: this.getTodayStart() },
          },
        })
      : 0;

    // 🔴 예상 대기가 **상수 8분 × 앞대기**로 날조되고 있었다 — 환자가 QR 로 여는 화면이다(W9·P15).
    //    "앞에 5명이니 40분"은 실측이 아니라 코드에 박힌 숫자였고, 티켓 화면(estimateWait)과도 값이 갈렸다(P12).
    //    → 진료 대기 중일 때만 정본 산출기를 태우고, 표본이 없으면 **산출 불가(null)** 로 말한다.
    const est = queue.status === 'WAITING'
      ? await this.estimateWait(queue.departmentName, waitingAhead)
      : { estimatedWaitMinutes: null, estimatedWaitSampleN: 0, estimatedWaitBasis: '진료 대기 단계가 지나 예상 대기시간을 안내하지 않습니다' };

    // 상태 플로우
    const allDone = ['WAITING', 'CALLED', 'IN_CONSULTATION', 'CASHIER_WAITING', 'PHARMACY_WAITING', 'VISIT_COMPLETED', 'COMPLETED'];
    const statusFlow = [
      { step: 'checked_in', label: '접수 완료', at: queue.checkedInAt.toISOString(), done: true, current: queue.status === 'WAITING' && !queue.calledAt },
      { step: 'waiting', label: '대기중', at: null, done: allDone.includes(queue.status), current: queue.status === 'WAITING' },
      { step: 'called', label: '호출', at: queue.calledAt?.toISOString() ?? null, done: ['CALLED', 'IN_CONSULTATION', 'CASHIER_WAITING', 'PHARMACY_WAITING', 'VISIT_COMPLETED', 'COMPLETED'].includes(queue.status), current: queue.status === 'CALLED' },
      { step: 'in_consultation', label: '진료중', at: queue.startedAt?.toISOString() ?? null, done: ['IN_CONSULTATION', 'CASHIER_WAITING', 'PHARMACY_WAITING', 'VISIT_COMPLETED', 'COMPLETED'].includes(queue.status), current: queue.status === 'IN_CONSULTATION' },
      { step: 'cashier', label: '수납 대기', at: null, done: ['PHARMACY_WAITING', 'VISIT_COMPLETED', 'COMPLETED'].includes(queue.status), current: queue.status === 'CASHIER_WAITING' },
      { step: 'pharmacy', label: '약국 대기', at: null, done: ['VISIT_COMPLETED', 'COMPLETED'].includes(queue.status), current: queue.status === 'PHARMACY_WAITING' },
      { step: 'completed', label: '완료', at: null, done: ['VISIT_COMPLETED', 'COMPLETED'].includes(queue.status), current: queue.status === 'VISIT_COMPLETED' || queue.status === 'COMPLETED' },
    ];

    return {
      data: {
        queueNumber: queue.queueNumber,
        departmentName: queue.departmentName,
        roomName: queue.roomName,
        doctorName: this.queueService.maskName(queue.doctor.familyName, queue.doctor.givenName),
        status: queue.status,
        waitingAhead,
        /** 표본 없으면 null(산출 불가) — 숫자를 만들지 않는다. 근거는 estimatedWaitBasis 가 말한다 */
        estimatedWaitMinutes: est.estimatedWaitMinutes,
        estimatedWaitSampleN: est.estimatedWaitSampleN,
        estimatedWaitBasis: est.estimatedWaitBasis,
        checkedInAt: queue.checkedInAt.toISOString(),
        calledAt: queue.calledAt?.toISOString() ?? null,
        callCount: queue.callCount,
        type: queue.type,
        visitType: queue.visitType,
        statusFlow,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  /** 과별 통계 (Public) */
  async getPublicStats(departments?: string[]) {
    const todayStart = this.getTodayStart();
    const where: Prisma.WaitingQueueWhereInput = { checkedInAt: { gte: todayStart } };
    if (departments?.length) where.departmentName = { in: departments };

    const queues = await this.prisma.waitingQueue.findMany({
      where,
      select: {
        departmentName: true,
        doctorId: true,
        status: true,
        roomName: true,
        checkedInAt: true,
        startedAt: true,
        doctor: { select: { familyName: true, givenName: true } },
      },
    });

    // 과별 + 의사별 집계
    const deptMap = new Map<string, {
      waiting: number; called: number; inConsultation: number; completedToday: number;
      waitTimes: number[]; maxWait: number;
      doctors: Map<string, { name: string; room: string | null; waiting: number; status: string }>;
    }>();

    for (const q of queues) {
      if (!deptMap.has(q.departmentName)) {
        deptMap.set(q.departmentName, {
          waiting: 0, called: 0, inConsultation: 0, completedToday: 0,
          waitTimes: [], maxWait: 0,
          doctors: new Map(),
        });
      }
      const dept = deptMap.get(q.departmentName)!;

      if (q.status === 'WAITING') dept.waiting++;
      else if (q.status === 'CALLED') dept.called++;
      else if (q.status === 'IN_CONSULTATION') dept.inConsultation++;
      // 수납 대기·약국 대기·방문 완료도 진료는 끝난 상태 — 위 집계와 **같은 규칙**(취소·미방문은 제외)
      //    🔴 두 곳이 갈라지면 같은 병원에 '오늘 완료'가 둘이 된다
      else if (q.status === 'COMPLETED' || q.status === 'CASHIER_WAITING' || q.status === 'PHARMACY_WAITING' || q.status === 'VISIT_COMPLETED') dept.completedToday++;

      if (q.startedAt) {
        const wait = (q.startedAt.getTime() - q.checkedInAt.getTime()) / 60000;
        // 🔴 음수 대기는 표본에서 제외(위 getDisplay 와 같은 규칙) — 정본이 갈라지면 두 화면이 다른 평균을 말한다
        if (wait >= 0) {
          dept.waitTimes.push(wait);
          if (wait > dept.maxWait) dept.maxWait = wait;
        }
      }

      // 의사별 집계
      if (!dept.doctors.has(q.doctorId)) {
        dept.doctors.set(q.doctorId, {
          name: this.queueService.maskName(q.doctor.familyName, q.doctor.givenName),
          room: q.roomName,
          waiting: 0,
          status: 'IDLE',
        });
      }
      const doc = dept.doctors.get(q.doctorId)!;
      if (q.status === 'WAITING') doc.waiting++;
      if (q.status === 'IN_CONSULTATION') doc.status = 'IN_CONSULTATION';
      else if (q.status === 'CALLED' && doc.status !== 'IN_CONSULTATION') doc.status = 'CALLED';
    }

    let totalW = 0, totalC = 0, totalI = 0, totalComp = 0;
    const departments_result = Array.from(deptMap.entries()).map(([name, d]) => {
      totalW += d.waiting; totalC += d.called; totalI += d.inConsultation; totalComp += d.completedToday;
      // 🔴 공개 전광판도 같은 거짓말을 하고 있었다 — 표본 0건 → '평균 0분 / 최장 0분'.
      //    이건 대기 중인 환자에게 "기다릴 필요 없다"고 말하는 것이라 창구 항의로 직결된다(P1·P17).
      //    표본이 없으면 평균·최장 모두 null 이다(최장 0분도 관측된 사실이 아니다).
      const hasSample = d.waitTimes.length > 0;
      const avg = hasSample
        ? Math.round(d.waitTimes.reduce((a, b) => a + b, 0) / d.waitTimes.length) : null;
      return {
        name,
        waiting: d.waiting, called: d.called, inConsultation: d.inConsultation, completedToday: d.completedToday,
        avgWaitMinutes: avg,
        maxWaitMinutes: hasSample ? Math.round(d.maxWait) : null,
        /** 평균·최장 대기의 표본 수(진료 시작 시각이 기록된 오늘분) — 0 이면 위 두 값은 null */
        waitSampleN: d.waitTimes.length,
        doctors: Array.from(d.doctors.values()).map(doc => ({
          name: doc.name,
          roomName: doc.room,
          waiting: doc.waiting,
          currentStatus: doc.status === 'IN_CONSULTATION' ? '진료중' : doc.status === 'CALLED' ? '호출중' : '대기',
        })),
      };
    });

    return {
      data: {
        departments: departments_result,
        total: { waiting: totalW, called: totalC, inConsultation: totalI, completedToday: totalComp },
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  /** 오늘 운영중 진료과 */
  async getDepartments() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    // 🔴 `clinic_closures.date` 는 `@db.Date` — KST 자정을 넘기면 UTC 날짜가 전날이 된다.
    //    전광판이 휴진을 하루 늦게 반영하던 것. 정본 `common/day-range.ts` — 화면 실사용 점검 W8.
    const todayDate = todayDateOnly(now);

    // 오늘 휴진
    const closures = await this.prisma.clinicClosure.findMany({
      where: { date: todayDate },
      select: { doctorId: true, period: true },
    });
    const closedSet = new Set(closures.map(c => `${c.doctorId}_${c.period ?? 'ALL'}`));

    // 오늘 진료표
    const schedules = await this.prisma.clinicSchedule.findMany({
      where: { dayOfWeek, isActive: true },
      include: { doctor: { select: { familyName: true, givenName: true } } },
      orderBy: [{ departmentName: 'asc' }, { startTime: 'asc' }],
    });

    const deptMap = new Map<string, { doctors: { name: string; roomName: string | null; period: string | null; startTime: string; endTime: string }[]; isOpen: boolean }>();
    for (const s of schedules) {
      const isClosed = closedSet.has(`${s.doctorId}_ALL`) || closedSet.has(`${s.doctorId}_${s.period}`);
      if (isClosed) continue;

      if (!deptMap.has(s.departmentName)) deptMap.set(s.departmentName, { doctors: [], isOpen: true });
      deptMap.get(s.departmentName)!.doctors.push({
        name: this.queueService.maskName(s.doctor.familyName, s.doctor.givenName),
        roomName: s.roomName,
        period: s.period,
        startTime: s.startTime,
        endTime: s.endTime,
      });
    }

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

    return {
      data: {
        departments: Array.from(deptMap.entries()).map(([name, d]) => ({
          name,
          isOpen: d.isOpen,
          doctors: d.doctors,
        })),
        date: todayDate.toISOString().split('T')[0],
        dayOfWeek: days[dayOfWeek],
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }
}
