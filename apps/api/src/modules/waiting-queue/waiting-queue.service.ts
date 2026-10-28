import { Injectable, NotFoundException, BadRequestException, ConflictException, GoneException, Optional, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
// 게이트 위반 원장 — 예외만 던지면 관제의 '0건'이 준수인지 미평가인지 구분되지 않는다
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { todayDateOnly } from '../../common/day-range';
import { firstPatientPushResult, normalizeQueueNearAhead, PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY } from '../notification/patient-push.contract';
import { SpaceModelService } from '../space-model/space-model.service';
import { recordGateViolation } from '../../common/gate-enforce';
import { scheduleSlotOf, scheduleWhereAt } from './schedule-slot';

/**
 * 공개 길안내(QR·무인증)의 이름 마스킹 — **세 번째 구현**이다.
 *
 * 🔴 (2026-09-16 F1) 공개 표면 마스킹은 `maskPublicName`(전광판)·`WaitingQueueService.maskName`(대기열)
 *    두 곳으로 알려져 있었고 `public-name-mask-parity.spec.ts` 가 그 둘만 대조했다. 그런데 길안내는
 *    핸들러 안에 **인라인으로 또 하나**를 두고 있었다 — 가드의 전제("두 곳")가 이미 틀려 있었다.
 *    지금은 성(姓)만 남기고 이름 전체를 가려(홍○○) 정본(홍○동)보다 **더** 가린다. 공개 면에서
 *    덜 가리는 쪽으로 자동 수렴시키지 않는다(§4 "숨기는 방향으로는 자동이 없다") — 대신 이름을 붙여
 *    테스트 가능하게 만들고, 가드가 "정본보다 덜 가리지 않는다"를 지킨다. 합치는 것은 사람이 정한다.
 */
export function maskGuideName(familyName: string, givenName: string): string {
  const gn = givenName ?? '';
  return `${familyName ?? ''}${'○'.repeat(Math.max(1, gn.length))}`;
}

@Injectable()
export class WaitingQueueService {
  private readonly logger = new Logger(WaitingQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly gates?: SafetyGateService,
    @Optional() private readonly spaceModel?: SpaceModelService,
  ) {}

  /**
   * 대기표 길안내(P3 · 공개) — 대기표 검증(만료·존재)을 먼저 지난다. 진료실이 공간에 연결돼 있어야 경로가 나온다.
   * 🔴 통제 구역은 지나지 않는다 · 경로를 못 구하면 이유만(직선·추정 경로를 그리지 않는다).
   */
  async guideRoute(queueId: string, from: string | undefined, accessibleOnly: boolean) {
    const g = await this.getGuide(queueId);
    if (!g) return null;
    return this.routeToRoom(g.roomName ?? null, from, accessibleOnly);
  }

  /**
   * 그 의사가 그 시각에 진료하는 진료실(진료표 기준) — 없으면 null(지어내지 않는다).
   * 🔴 예약 원장의 `roomName` 은 운영에서 늘 비어 있다(2026-10-26 실측 1,877건 전부 null) — 진료실은 접수 때 진료표로 정해진다.
   *    포털 예약 길안내(B1)는 그 **같은 규칙**으로 "예정 진료실"을 말한다(접수 때 바뀔 수 있다).
   */
  async resolveScheduledRoom(doctorId: string, at: Date): Promise<string | null> {
    const schedule = await this.prisma.clinicSchedule.findFirst({ where: scheduleWhereAt(doctorId, at), select: { roomName: true } });
    return schedule?.roomName ?? null;
  }

  /**
   * 진료실까지 길안내(공개 응답) — 대기표 QR·포털 예약 길안내 공용.
   * 공간 연결된 진료실만 · 통제 구역 제외 · 계산할 수 없으면 이유(직선·추정 경로를 그리지 않는다).
   */
  async routeToRoom(roomName: string | null, from: string | undefined, accessibleOnly: boolean) {
    const entrances = this.spaceModel ? await this.spaceModel.entrances(false) : [];
    if (!this.spaceModel) return { available: false as const, reason: 'NO_GEOMETRY', entrances };
    if (!roomName) return { available: false as const, reason: 'ROOM_NOT_ASSIGNED', entrances };
    const room = await this.prisma.clinicRoom.findUnique({ where: { name: roomName }, select: { spaceNodeId: true } });
    if (!room?.spaceNodeId) return { available: false as const, reason: 'ROOM_NOT_LINKED', entrances };
    const r = await this.spaceModel.route({ from: from ? `entrance:${from}` : undefined, to: room.spaceNodeId, accessibleOnly, allowRestricted: false });
    if (!r.available) return { ...r, entrances };
    const floors = await this.spaceModel.floorsForRoute([...new Set(r.segments.map((s) => s.floor))]);
    return { ...r, entrances, floors, targetSpaceNodeId: room.spaceNodeId };
  }

  /** 이름 마스킹: 김영수→김○수, 박수→박○ */
  maskName(familyName: string, givenName: string): string {
    const full = `${familyName}${givenName}`;
    if (full.length <= 1) return full;
    if (full.length === 2) return `${full[0]}○`;
    return `${full[0]}○${full[full.length - 1]}`;
  }

  /**
   * 방 이름 뒤 '로/으로' 조사 — 받침 없음·ㄹ받침·한글 아님(숫자)은 '로', 그 외 받침은 '으로'.
   * (표준 국어: '심전도실'→'심전도실로', '내시경실1'→'내시경실1로')
   */
  private roomJosa(word: string): '로' | '으로' {
    const last = word.charCodeAt(word.length - 1);
    if (last < 0xac00 || last > 0xd7a3) return '로'; // 숫자·영문 등 — '로'가 자연스럽다
    const jong = (last - 0xac00) % 28;
    return jong === 0 || jong === 8 ? '로' : '으로'; // 8 = ㄹ받침
  }

  /** TTS 텍스트 생성 */
  buildTtsText(dept: string, num: number, maskedName: string, room: string | null, callCount: number): string {
    // 🔴 room 은 '3진료실'(진료실) 뿐 아니라 '심전도실'·'운동부하실'·'내시경실1'(검사실)도 온다.
    //    종전엔 무조건 `${room}번 진료실로 오세요` 여서 검사실이 "심전도실번 진료실로 오세요"로 깨져 방송됐다.
    //    진료실 미배정(null)은 '접수 창구로'(v3.95 봉합). 부분 문자열 단언은 이 깨짐을 숨기므로 계약은 정확 비교로 고정.
    let roomText: string;
    if (!room) {
      roomText = ', 접수 창구로 오세요';
    } else if (room.includes('진료실')) {
      const n = room.replace('진료실', '').trim();
      roomText = n ? `, ${n}번 진료실로 오세요` : ', 진료실로 오세요';
    } else {
      roomText = `, ${room}${this.roomJosa(room)} 오세요`;
    }
    const suffix = callCount > 2 ? ' (최종호출)' : callCount > 1 ? ' (재호출)' : '';
    return `${dept} ${num}번 ${maskedName}님${roomText}${suffix}`;
  }

  private getTodayStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  async getNextQueueNumber(departmentName: string, client?: Prisma.TransactionClient): Promise<number> {
    const db = client ?? this.prisma;
    const todayStart = this.getTodayStart();
    const last = await db.waitingQueue.findFirst({
      where: { departmentName, checkedInAt: { gte: todayStart } },
      orderBy: { queueNumber: 'desc' },
    });
    return (last?.queueNumber ?? 0) + 1;
  }

  async checkIn(data: {
    patientId: string;
    doctorId?: string;
    departmentName: string;
    visitType?: string;
    reason?: string;
    appointmentId?: string;
    type?: string;
  }) {
    let { doctorId } = data;

    // 중복 접수 방지: 같은 환자·같은 과 당일 활성 대기(대기/호출/진료중) 존재 시 차단
    const dupCheckStart = this.getTodayStart();
    const dup = await this.prisma.waitingQueue.findFirst({
      where: {
        patientId: data.patientId,
        departmentName: data.departmentName,
        status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] },
        checkedInAt: { gte: dupCheckStart },
      },
      select: { queueNumber: true },
    });
    if (dup) {
      throw new BadRequestException(`이미 접수된 환자입니다 (${data.departmentName} 대기 #${dup.queueNumber}).`);
    }

    // Auto-assign doctor if not specified
    if (!doctorId) { // auto-assign
      doctorId = await this.autoAssignDoctor(data.departmentName);
      if (!doctorId) { // auto-assign
        throw new BadRequestException('현재 진료 가능한 의사가 없습니다.');
      }
    }

    // Get room name from schedule — 진료표 칸 정본(scheduleSlotOf · 포털 예약 길안내와 같은 규칙)
    const schedule = await this.prisma.clinicSchedule.findFirst({ where: scheduleWhereAt(doctorId, new Date()) });

    const waitingToken = randomUUID().replace(/-/g, '');

    // 큐 번호 중복 방지 — 부서 단위 advisory lock으로 번호할당(max+1)+생성을 원자화(동시 접수 시 동일번호 발급 race 제거)
    const queue = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`queue:${data.departmentName}`}))`;
      const queueNumber = await this.getNextQueueNumber(data.departmentName, tx);
      return tx.waitingQueue.create({
        data: {
          patientId: data.patientId,
          doctorId,
          departmentName: data.departmentName,
          roomName: schedule?.roomName ?? null,
          queueNumber,
          type: data.type ?? (data.appointmentId ? 'APPOINTMENT' : 'WALK_IN'),
          visitType: data.visitType ?? 'INITIAL',
          reason: data.reason ?? null,
          appointmentId: data.appointmentId ?? null,
          waitingToken,
          status: 'WAITING',
        },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          doctor: { select: { id: true, familyName: true, givenName: true } },
        },
      });
    });
    const queueNumber = queue.queueNumber;

    this.journey?.emit({
      patientId: data.patientId, eventType: 'RECEPTION_CHECKIN',
      title: `${data.departmentName} 접수 (대기 #${queueNumber})`,
      department: data.departmentName, refType: 'WAITING_QUEUE', refId: queue.id,
      navUrl: '/reception', metadata: { queueNumber },
    });

    this.eventEmitter.emit('queue.checked_in', {
      queueId: queue.id,
      doctorId,
      patientId: data.patientId,
      departmentName: data.departmentName,
    });
    this.eventEmitter.emit('queue.changed', { queueId: queue.id, status: 'WAITING' }); // 접수데스크 SSE 신호

    // 컨트롤러가 { data } 로 감싸므로 여기서 다시 감싸면 이중 래핑이 된다.
    // (종전 `{ data: queue }` 로 인해 FE 가 res.data.id 로 큐 ID 를 얻지 못해
    //  접수 직후 자격조회·본인확인이 대기열에 연결되지 않았다 — 2026-07 종단 검토)
    return queue;
  }

  /** R7: 공개 길안내 — QR 스캔 시 환자에게 다음 행선지 안내(최소 정보·이름 마스킹) */
  async getGuide(id: string) {
    const q = await this.prisma.waitingQueue.findUnique({
      where: { id },
      include: { patient: { select: { familyName: true, givenName: true } }, doctor: { select: { familyName: true, givenName: true } } },
    });
    if (!q) return null;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    /**
     * 🔴 (2026-09-16 H2) 만료가 없었다 — 형제 `queue-display.getWaiting`(환자 QR·토큰)은
     *    "접수일 다음날 자정"에 만료시키는데, 이 길안내(QR·queueId)만 **영구히** 답했다.
     *    같은 성격의 공개 QR 화면인데 한쪽만 만료가 없으면, 사진으로 남은 QR 이 몇 달 뒤에도
     *    대기번호·진료과·진료실·접수시각을 그대로 돌려준다. 정본(getWaiting)과 같은 규칙으로 맞춘다.
     */
    if (q.checkedInAt.getTime() < todayStart.getTime()) {
      throw new GoneException({ code: 'GUIDE_EXPIRED', message: '접수 정보가 만료되었습니다. 접수 데스크에 문의하세요.' });
    }
    const aheadCount = q.status === 'WAITING'
      ? await this.prisma.waitingQueue.count({ where: { departmentName: q.departmentName, status: 'WAITING', queueNumber: { lt: q.queueNumber }, checkedInAt: { gte: todayStart } } })
      : 0;
    return {
      queueNumber: q.queueNumber,
      status: q.status,
      departmentName: q.departmentName,
      roomName: q.roomName ?? null,
      // 진료실 위치(층·구역) — 진료실 이름이 공간에 연결된 경우만(P0-5). 미연결이면 null(층을 지어내지 않는다)
      roomLocation: await this.roomLocation(q.roomName),
      visitType: q.visitType,
      doctorName: q.doctor ? `${q.doctor.familyName}${q.doctor.givenName}` : null,
      patientName: q.patient ? maskGuideName(q.patient.familyName, q.patient.givenName) : null,
      aheadCount,
      checkedInAt: q.checkedInAt,
    };
  }

  /** 진료실 이름 → 공간(층·구역) — 공개 대기표용이라 이름과 층 표식만 */
  private async roomLocation(roomName: string | null | undefined): Promise<{ zoneName: string; floorLabel: string | null } | null> {
    if (!roomName) return null;
    const room = await this.prisma.clinicRoom.findUnique({
      where: { name: roomName },
      select: { spaceNode: { select: { name: true, floor: true } } },
    });
    const sn = room?.spaceNode;
    if (!sn) return null;
    return { zoneName: sn.name, floorLabel: sn.floor == null ? null : sn.floor < 0 ? `B${-sn.floor}` : `${sn.floor}F` };
  }

  private async autoAssignDoctor(departmentName: string): Promise<string | undefined> {
    const { dayOfWeek, period } = scheduleSlotOf(new Date()); // 진료표 칸 정본(접수·예약 길안내와 같은 규칙)
    const todayStart = this.getTodayStart();

    // Get today's closures
    // 🔴 `clinic_closures.date` 는 `@db.Date` 라 `getTodayStart()`(KST 자정)를 넘기면
    //    UTC 날짜 부분이 **전날**이 된다 — 휴진 의사가 접수 가능 목록에 그대로 남았다.
    //    (`checkedInAt` 같은 timestamptz 에는 `getTodayStart()` 가 옳다. 컬럼 타입에 따라 다르다.)
    //    정본은 `common/day-range.ts` 의 `todayDateOnly` — 화면 실사용 점검 W8.
    const closures = await this.prisma.clinicClosure.findMany({
      where: {
        date: todayDateOnly(),
        OR: [{ period }, { period: null }],
      },
    });
    const closedDoctorIds = closures.map((c) => c.doctorId);

    // Find available schedules
    const schedules = await this.prisma.clinicSchedule.findMany({
      where: {
        departmentName,
        dayOfWeek,
        isActive: true,
        doctorId: { notIn: closedDoctorIds },
        OR: [{ period }, { period: 'ALL' }],
      },
    });

    if (schedules.length === 0) return undefined;

    // Count waiting for each doctor
    const doctorIds = schedules.map((s) => s.doctorId);
    const waitingCounts = await this.prisma.waitingQueue.groupBy({
      by: ['doctorId'],
      where: {
        doctorId: { in: doctorIds },
        status: 'WAITING',
        checkedInAt: { gte: todayStart },
      },
      _count: true,
    });
    const countMap = new Map(waitingCounts.map((w) => [w.doctorId, w._count]));

    // Exclude doctors at max capacity
    const available = schedules.filter((s) => {
      const count = countMap.get(s.doctorId) ?? 0;
      return count < s.maxPatients;
    });

    if (available.length === 0) return undefined;

    // Pick doctor with least waiting
    available.sort((a, b) => (countMap.get(a.doctorId) ?? 0) - (countMap.get(b.doctorId) ?? 0));
    return available[0].doctorId;
  }

  /**
   * 대기열 목록(스태프 화면 정본).
   *
   * 🔴 `gender`·`dateOfBirth` 를 select 에서 빠뜨렸더니 외래 간호 워크스테이션이 **전 환자를
   *    여성(F)으로 표시**했다 — 화면이 `gender === 'MALE' ? 'M' : 'F'` 라 `undefined` 가 전부
   *    F 로 떨어졌다(2026-08-12 실측·20행 연속 F). 성별은 간호 준비·기준치·용량이 읽는 값이다.
   *    **삼항 폴백은 없는 값을 반대 값으로 단정한다.**
   */
  async findAll(filters: { department?: string; doctorId?: string; status?: string; date?: string }) {
    const where: Prisma.WaitingQueueWhereInput = {};
    if (filters.department) where.departmentName = filters.department;
    if (filters.doctorId) where.doctorId = filters.doctorId;
    if (filters.status) where.status = filters.status;

    const dateStart = filters.date ? new Date(filters.date) : this.getTodayStart();
    const dateEnd = new Date(dateStart);
    dateEnd.setDate(dateEnd.getDate() + 1);
    where.checkedInAt = { gte: dateStart, lt: dateEnd };

    const queues = await this.prisma.waitingQueue.findMany({
      where,
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true } },
        doctor: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: { queueNumber: 'asc' },
    });

    // 🔴 **아직 오지 않은 예약을 '지금 대기'와 섞지 않는다.** 각 행이 스스로 밝히게 해서
    //    화면마다 따로 판정하다 갈라지는 것을 막는다(실측 2026-08-13 08:30: 대기 180명 중
    //    129명이 미래 접수 — 진료실 대기와 접수 데스크가 서로 다른 수를 말하고 있었다).
    //    값이 없으면 '지금 대기'로 본다 — 없는 것을 예약으로 단정하면 큐에서 사라진다.
    const now = Date.now();
    return {
      data: queues.map((q) => ({
        ...q,
        isScheduled: q.checkedInAt instanceof Date ? q.checkedInAt.getTime() > now : false,
      })),
    };
  }

  async findMyQueue(doctorId: string) {
    const todayStart = this.getTodayStart();
    const queues = await this.prisma.waitingQueue.findMany({
      where: {
        doctorId,
        status: { in: ['WAITING', 'CALLED'] },
        checkedInAt: { gte: todayStart },
      },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
      orderBy: { queueNumber: 'asc' },
    });
    return { data: queues };
  }

  /**
   * 환자 호출(WAITING/CALLED → CALLED).
   * @param opts.notifyPatient 🔴 환자 앱 푸시 **명시 옵트인**. 화면이 "환자 앱 알림도 보낼까요?"를 물어
   *        받은 값이다. 설정(마스터+타입)이 켜져 있어도 이것이 true 가 아니면 나가지 않는다.
   */
  async callNext(id: string, opts?: { notifyPatient?: boolean }) {
    const queue = await this.prisma.waitingQueue.findUnique({
      where: { id },
      include: { patient: { select: { familyName: true, givenName: true } } },
    });
    if (!queue) throw new NotFoundException('Queue entry not found');
    if (!['WAITING', 'CALLED'].includes(queue.status)) {
      throw new BadRequestException('호출 가능한 상태가 아닙니다.');
    }

    const updated = await this.prisma.waitingQueue.update({
      where: { id },
      data: {
        status: 'CALLED',
        calledAt: new Date(),
        callCount: { increment: 1 },
      },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        doctor: { select: { id: true, familyName: true, givenName: true } },
      },
    });

    const maskedName = this.maskName(queue.patient.familyName, queue.patient.givenName);
    const ttsText = this.buildTtsText(
      updated.departmentName, updated.queueNumber,
      maskedName, updated.roomName, updated.callCount,
    );

    // 여정 타임라인: 호출 단계 기록(RECEPTION_CALLED)
    this.journey?.emit({
      patientId: updated.patientId, eventType: 'RECEPTION_CALLED',
      title: `${updated.departmentName} ${updated.queueNumber}번 호출${updated.callCount > 1 ? ` (${updated.callCount}회)` : ''}`,
      department: updated.departmentName, refType: 'WAITING_QUEUE', refId: updated.id,
      navUrl: '/reception', metadata: { queueNumber: updated.queueNumber, callCount: updated.callCount },
    });

    this.eventEmitter.emit('queue.changed', { queueId: updated.id, status: 'CALLED' }); // 접수데스크 SSE 신호

    // 🔴 환자 앱 푸시 — **호출이 실제로 일어난 뒤**(status=CALLED·calledAt 기록 후) 알린다.
    //    판정(설정 ON·야간·중복)은 notification 게이트 한 곳이 하고, 여기서는 결과를 받아 그대로 돌려준다.
    //    발행부는 전송 시각·성공 플래그를 원장에 적지 않는다 — 보내지 않았는데 보냈다고 남지 않게.
    const patientPush = firstPatientPushResult(
      await this.eventEmitter.emitAsync('patient.called', {
        patientId: updated.patientId,
        departmentName: updated.departmentName ?? undefined,
        roomName: updated.roomName ?? undefined,
        notifyPatient: opts?.notifyPatient === true,
      }),
    );

    return { data: { ...updated, ttsText, patientPush } };
  }

  async startConsultation(id: string) {
    const queue = await this.prisma.waitingQueue.findUnique({ where: { id } });
    if (!queue) throw new NotFoundException('Queue entry not found');
    if (queue.status !== 'CALLED') throw new BadRequestException('환자가 호출 상태가 아닙니다.');

    /**
     * 🔴 (2026-09-16 K1) 진료 레코드 생성과 대기열 전이가 따로 커밋됐다 — 큐 갱신이 실패하면
     *    **주인 없는 Encounter** 가 남고 큐는 CALLED 그대로다. 다시 호출하면 상태 검사를 통과해
     *    **또 다른 Encounter** 가 생긴다(진료기록 중복 · 서명 시 청구가 각각 생성될 수 있다).
     *    진료 시작은 한 사건이다 — 한 트랜잭션으로 묶는다.
     */
    const { encounter, updated } = await this.prisma.$transaction(async (tx) => {
      const enc = await tx.encounter.create({
        data: {
          patientId: queue.patientId,
          doctorId: queue.doctorId,
        },
      });
      const row = await tx.waitingQueue.update({
        where: { id },
        data: { status: 'IN_CONSULTATION', startedAt: new Date(), encounterId: enc.id },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          doctor: { select: { id: true, familyName: true, givenName: true } },
        },
      });
      return { encounter: enc, updated: row };
    });

    // Phase 4: Vitals → Encounter 자동 연결을 위한 이벤트 발행
    this.eventEmitter.emit('encounter.created', {
      encounterId: encounter.id,
      queueId: id,
      patientId: queue.patientId,
    });

    // 여정 타임라인: 진료 시작 기록(ENCOUNTER_START) — 진료화면이 큐 Encounter 재사용 시에도 누락 방지
    this.journey?.emit({
      patientId: queue.patientId, eventType: 'ENCOUNTER_START',
      title: `${updated.departmentName} 진료 시작`,
      department: updated.departmentName, refType: 'ENCOUNTER', refId: encounter.id,
      navUrl: `/patients/${queue.patientId}/encounter/new?encounterId=${encounter.id}`,
      metadata: { queueNumber: updated.queueNumber },
      episode: { type: 'WaitingQueue', id: updated.id }, // 여정 P1: 원 기록은 진료 — 방문 단위는 접수
    });

    this.eventEmitter.emit('queue.changed', { queueId: updated.id, status: 'IN_CONSULTATION' }); // 접수데스크 SSE 신호
    return { data: { ...updated, encounter } };
  }

  async complete(id: string) {
    const queue = await this.prisma.waitingQueue.findUnique({ where: { id } });
    if (!queue) throw new NotFoundException('Queue entry not found');
    if (queue.status !== 'IN_CONSULTATION') throw new BadRequestException('진료 중 상태가 아닙니다.');

    // 서명 기반 완료(§통일): 진료기록 서명 후에만 완료 — 서명 시 billing 리스너가 CASHIER_WAITING으로 전이하므로
    // 정상 흐름에서는 서명 자체가 완료 트리거. 미서명 완료 우회를 차단(config queue.completeRequiresSign 기본 ON).
    const requireSign = (await this.config?.get('queue.completeRequiresSign')) !== false;
    if (requireSign && queue.encounterId) {
      const enc = await this.prisma.encounter.findUnique({ where: { id: queue.encounterId }, select: { status: true } });
      if (enc && enc.status === 'DRAFT') {
        // 🔴 2026-08-26: 종전엔 예외만 던지고 남기지 않아 관제가 '0건'의 뜻을 구분할 수 없었다.
        await recordGateViolation({ gateKey: 'queue.completeRequiresSign', recorder: this.gates, logger: this.logger, refType: 'WaitingQueue', refId: id }, 'BLOCK', '진료기록 미서명(DRAFT) 상태에서 대기열 완료 시도 — 차단');
        throw new BadRequestException('진료기록 서명 후 완료됩니다. 진료기록을 작성·서명해 주세요.');
      }
    }

    const updated = await this.prisma.waitingQueue.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    this.eventEmitter.emit('queue.changed', { queueId: updated.id, status: updated.status }); // 접수데스크 SSE 신호
    return { data: updated };
  }

  /** 접수 정정 — 진료과/의사/유형/사유 수정(취소 후 재접수 불필요).
   *  WAITING/CALLED만 허용(진료 시작 후엔 Encounter가 이미 생성돼 정정 불가).
   *  과 변경 시 새 과 기준 순번 재발급·의사 미지정이면 자동배정·진료실 재계산. */
  async update(id: string, data: { departmentName?: string; doctorId?: string; visitType?: string; reason?: string }) {
    const queue = await this.prisma.waitingQueue.findUnique({ where: { id } });
    if (!queue) throw new NotFoundException('Queue entry not found');
    if (!['WAITING', 'CALLED'].includes(queue.status)) {
      throw new BadRequestException('대기/호출 상태에서만 정정할 수 있습니다.');
    }

    const deptChanged = !!data.departmentName && data.departmentName !== queue.departmentName;
    const patch: Prisma.WaitingQueueUpdateInput = {};
    if (data.visitType) patch.visitType = data.visitType;
    if (data.reason !== undefined) patch.reason = data.reason || null;

    let doctorId = data.doctorId ?? (deptChanged ? undefined : queue.doctorId);
    if (deptChanged) {
      // 과 변경: 중복 접수 가드(새 과 기준) + 순번 재발급
      const dup = await this.prisma.waitingQueue.findFirst({
        where: {
          patientId: queue.patientId, departmentName: data.departmentName!,
          status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] }, checkedInAt: { gte: this.getTodayStart() }, id: { not: id },
        },
        select: { queueNumber: true },
      });
      if (dup) throw new BadRequestException(`이미 접수된 환자입니다 (${data.departmentName} 대기 #${dup.queueNumber}).`);
      if (!doctorId) {
        doctorId = (await this.autoAssignDoctor(data.departmentName!)) ?? undefined;
        if (!doctorId) throw new BadRequestException('변경할 과에 진료 가능한 의사가 없습니다.');
      }
      patch.departmentName = data.departmentName!;
      patch.queueNumber = await this.getNextQueueNumber(data.departmentName!);
    }
    if (doctorId && doctorId !== queue.doctorId) patch.doctor = { connect: { id: doctorId } };

    // 의사/과 변경 시 진료실 재계산
    if (doctorId && (deptChanged || doctorId !== queue.doctorId)) {
      const schedule = await this.prisma.clinicSchedule.findFirst({ where: scheduleWhereAt(doctorId, new Date()) });
      patch.roomName = schedule?.roomName ?? null;
    }

    const updated = await this.prisma.waitingQueue.update({
      where: { id },
      data: patch,
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        doctor: { select: { id: true, familyName: true, givenName: true } },
      },
    });
    this.eventEmitter.emit('queue.changed', { queueId: updated.id, status: updated.status }); // 접수데스크 SSE 신호
    return { data: updated };
  }

  async cancel(id: string) {
    const queue = await this.prisma.waitingQueue.findUnique({ where: { id } });
    if (!queue) throw new NotFoundException('Queue entry not found');
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(queue.status)) {
      throw new BadRequestException('이미 종료된 대기입니다.');
    }

    const updated = await this.prisma.waitingQueue.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    this.eventEmitter.emit('queue.changed', { queueId: updated.id, status: updated.status }); // 접수데스크 SSE 신호
    return { data: updated };
  }

  async noShow(id: string) {
    const queue = await this.prisma.waitingQueue.findUnique({ where: { id } });
    if (!queue) throw new NotFoundException('Queue entry not found');
    // 🔴 (2026-09-16 E1) 바로 위 `cancel` 은 같은 가드를 갖는데 여기만 빠져 있었다 —
    //    **진료를 마친(COMPLETED) 대기를 '미방문'으로 뒤집고** 완료 시각까지 지금으로 덮어썼다.
    //    미방문율은 QI 지표이고, 진료를 마쳤다는 것은 일어난 사실이다(형제 하나만 막고 옆을 잊는 기전).
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(queue.status)) {
      throw new BadRequestException('이미 종료된 대기입니다.');
    }

    const updated = await this.prisma.waitingQueue.update({
      where: { id },
      data: { status: 'NO_SHOW', completedAt: new Date() },
    });
    this.eventEmitter.emit('queue.changed', { queueId: updated.id, status: updated.status }); // 접수데스크 SSE 신호
    return { data: updated };
  }

  /**
   * 잘못 누른 취소·미방문 되돌리기(2026-09-29 접수 데스크 보강).
   *
   * 종전엔 '접수 취소'·'노쇼'가 되돌릴 길이 없어, 잘못 누르면 **새로 접수**하는 수밖에 없었다 —
   * 순번이 뒤로 밀리고(환자는 이미 기다렸다) 같은 날 같은 환자의 대기 행이 둘 남았다.
   * 막는 것:
   *  - 오늘 접수분만(지난 날의 종료 기록은 일어난 사실 — 소급하지 않는다)
   *  - 진료가 시작된 적 있는 행(startedAt·encounterId)은 되돌리지 않는다
   *  - 같은 환자가 오늘 같은 과에 이미 다시 접수돼 활성 대기가 있으면 409(되돌리면 둘이 된다)
   * 순번·접수 시각은 그대로 둔다(기다린 시간은 사실이다). 사유 칸은 두지 않는다 —
   * 감사 원장은 필드 **키만** 남기므로 받아도 어디에도 남지 않는다(받는 척하지 않는다).
   */
  async restore(id: string) {
    const queue = await this.prisma.waitingQueue.findUnique({ where: { id } });
    if (!queue) throw new NotFoundException('Queue entry not found');
    if (!['CANCELLED', 'NO_SHOW'].includes(queue.status)) {
      throw new BadRequestException('취소·미방문 상태만 되돌릴 수 있습니다.');
    }
    if (queue.checkedInAt < this.getTodayStart()) {
      throw new BadRequestException('오늘 접수분만 되돌릴 수 있습니다 — 지난 날짜의 종료 기록은 바꾸지 않습니다.');
    }
    if (queue.startedAt || queue.encounterId) {
      throw new BadRequestException('진료가 시작된 적 있는 접수는 되돌릴 수 없습니다.');
    }
    const active = await this.prisma.waitingQueue.findFirst({
      where: {
        id: { not: id },
        patientId: queue.patientId,
        departmentName: queue.departmentName,
        status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] },
        checkedInAt: { gte: this.getTodayStart() },
      },
      select: { id: true },
    });
    // 문장에 값을 끼워 넣지 않는다(server-composed-display-text 가드 — 화면 언어를 바꿔도 한국어로 남는다)
    if (active) {
      throw new ConflictException('이미 같은 과에 다시 접수돼 있습니다 — 되돌리면 대기가 둘이 됩니다.');
    }

    // 조건부 갱신 — 확인과 쓰기 사이에 다른 창이 상태를 바꿨으면 덮어쓰지 않는다
    const res = await this.prisma.waitingQueue.updateMany({
      where: { id, status: { in: ['CANCELLED', 'NO_SHOW'] } },
      data: { status: 'WAITING', completedAt: null },
    });
    if (res.count !== 1) throw new ConflictException('다른 곳에서 상태가 바뀌었습니다 — 새로고침 후 다시 확인하세요.');
    const updated = await this.prisma.waitingQueue.findUniqueOrThrow({ where: { id } });
    this.eventEmitter.emit('queue.changed', { queueId: updated.id, status: updated.status }); // 접수데스크 SSE 신호
    return { data: updated };
  }

  async getStats() {
    const todayStart = this.getTodayStart();
    const nowTs = new Date();

    // 🔴 '대기' 안에 아직 오지 않은 예약이 섞여 있었다 — KPI 를 쓰는 모든 화면이
    //    같은 답을 내도록 **서버에서 가른다**.
    const [waitingNow, waitingScheduled] = await Promise.all([
      this.prisma.waitingQueue.count({
        where: { checkedInAt: { gte: todayStart, lte: nowTs }, status: 'WAITING' },
      }),
      this.prisma.waitingQueue.count({
        where: { checkedInAt: { gt: nowTs }, status: 'WAITING' },
      }),
    ]);

    const stats = await this.prisma.waitingQueue.groupBy({
      by: ['departmentName', 'status'],
      where: { checkedInAt: { gte: todayStart } },
      _count: true,
    });

    // Calculate average wait time for completed patients
    const completed = await this.prisma.waitingQueue.findMany({
      where: {
        checkedInAt: { gte: todayStart },
        status: { in: ['IN_CONSULTATION', 'COMPLETED'] },
        startedAt: { not: null },
      },
      select: { departmentName: true, checkedInAt: true, startedAt: true },
    });

    const avgWaitByDept: Record<string, number> = {};
    const deptTimes: Record<string, number[]> = {};
    for (const c of completed) {
      if (!c.startedAt) continue;
      const wait = (c.startedAt.getTime() - c.checkedInAt.getTime()) / 60000; // minutes
      if (!deptTimes[c.departmentName]) deptTimes[c.departmentName] = [];
      deptTimes[c.departmentName].push(wait);
    }
    for (const [dept, times] of Object.entries(deptTimes)) {
      avgWaitByDept[dept] = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    }

    // 🔴 `avgWaitByDept` 는 표본이 있는 과만 담고 나머지는 **키 자체가 없다**. 화면이 `?? 0` 으로 읽으면
    //    "평균 대기 0분"이 되어 모르는 것을 안다고 말하게 된다 — 근거(표본 수·기준 문구)를 응답에 실어
    //    화면이 '산출 불가'를 말할 수 있게 한다(W8 qi/journey-analytics 와 같은 규약: waitSampleN·waitBasis).
    const todayTotal = await this.prisma.waitingQueue.count({ where: { checkedInAt: { gte: todayStart } } });
    const waitSampleN = completed.length;
    const waitUnmeasuredN = Math.max(0, todayTotal - waitSampleN);

    // 시간대별 접수 현황 + 워크인/예약 비율(운영 분석)
    const todayRows = await this.prisma.waitingQueue.findMany({
      where: { checkedInAt: { gte: todayStart } },
      select: { checkedInAt: true, type: true },
    });
    const hourlyMap: Record<number, { total: number; walkIn: number; appointment: number }> = {};
    const typeCounts = { WALK_IN: 0, APPOINTMENT: 0 };
    for (const r of todayRows) {
      const h = r.checkedInAt.getHours(); // 서버 TZ=KST
      const b = (hourlyMap[h] ??= { total: 0, walkIn: 0, appointment: 0 });
      b.total++;
      if (r.type === 'APPOINTMENT') { b.appointment++; typeCounts.APPOINTMENT++; }
      else { b.walkIn++; typeCounts.WALK_IN++; }
    }
    const hourly = Object.entries(hourlyMap)
      .map(([hour, v]) => ({ hour: Number(hour), ...v }))
      .sort((a, b) => a.hour - b.hour);

    return {
      data: {
        statusCounts: stats,
        /** 표본이 있는 과만 담긴다 — 키가 없으면 '산출 불가'이지 0분이 아니다 */
        avgWaitMinutes: avgWaitByDept,
        /** 대기시간을 산출할 수 있는 건(진료 시작 시각 보유) */
        waitSampleN,
        /** 오늘 접수됐지만 대기시간을 산출할 수 없는 건 */
        waitUnmeasuredN,
        waitBasis: waitSampleN > 0
          ? `진료 시작 시각 보유 ${waitSampleN}건 기준(오늘 접수 ${todayTotal}건 중 ${waitUnmeasuredN}건은 산출 불가)`
          : `대기시간을 산출할 수 있는 건 없음(오늘 접수 ${todayTotal}건 전부 진료 시작 시각 미기록) — 대기 지표 산출 불가`,
        hourly,
        typeCounts,
        /** 지금 실제로 기다리는 인원 — 아직 오지 않은 예약은 뺀다 */
        waitingNow,
        /** 오늘 접수됐지만 접수 시각이 아직 오지 않은 인원(예약 대기) */
        waitingScheduled,
      },
    };
  }

  /**
   * 묵은 대기 자동 마감 — config `reception.staleQueueAutoCloseHours`(0=OFF 기본)·매일 새벽 4시.
   *
   * 접수만 하고 진료를 받지 않은 대기가 계속 쌓여 대기 인원·평균 대기시간·상황판을 왜곡한다
   * (2026-08-03 실측: 1일 넘게 WAITING 인 접수 188건). 응급 방문 자동 종결과 같은 규약
   * (`emergency.staleVisitAutoCloseHours`)을 따른다 — 임계는 관리 화면에서 무재시작 변경.
   *
   * 대상은 **WAITING·CALLED 만**이다. 진료중(IN_CONSULTATION)·수납대기·약국대기는 뒤 공정이
   * 진행 중인 상태라 자동으로 닫으면 진행 중인 환자를 큐에서 지우게 된다.
   * 전이 대상 상태는 '미방문(NO_SHOW)' — 수동 취소(CANCELLED)와 구분돼야 사후 분석이 된다.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async autoCloseStaleQueues(): Promise<{ closed: number; hours: number }> {
    const hours = Number((await this.config?.get('reception.staleQueueAutoCloseHours').catch(() => 0)) ?? 0);
    if (!hours || hours <= 0) return { closed: 0, hours: 0 };

    const cutoff = new Date(Date.now() - hours * 3600_000);
    const stale = await this.prisma.waitingQueue.findMany({
      where: { status: { in: ['WAITING', 'CALLED'] }, checkedInAt: { lt: cutoff } },
      select: { id: true, departmentName: true },
    });

    let closed = 0;
    for (const q of stale) {
      try {
        await this.prisma.waitingQueue.update({
          where: { id: q.id },
          // completedAt 은 채우지 않는다 — 진료를 마친 게 아니다(완료 시각 불변식과 충돌)
          data: { status: 'NO_SHOW' },
        });
        this.eventEmitter.emit('queue.changed', { queueId: q.id, status: 'NO_SHOW' }); // 접수데스크 SSE
        closed += 1;
      } catch {
        // 개별 실패는 무시(다음 스윕에서 재시도)
      }
    }
    if (closed) this.logger.log(`묵은 대기 자동 마감 ${closed}/${stale.length}건 (기준 ${hours}시간)`);
    else if (stale.length) this.logger.warn(`묵은 대기 ${stale.length}건을 마감하지 못했습니다.`);
    return { closed, hours };
  }

  /**
   * 진료 차례 임박 알림(포털 B3 · 2026-10-26) — 대기 상태가 바뀔 때마다(접수·호출·진료 시작·취소·미방문 · 모두 `queue.changed`)
   * 그 진료과 **오늘** 대기를 다시 세어, 앞 인원(대기 현황 화면과 같은 정의 — 같은 과 오늘 WAITING 중 번호가 앞선 수)이
   * 기준 이하인 대기표에 **한 번** 알린다.
   *  · 🔴 기준(`queueNearAhead`)은 원내 정책 — 미설정이면 아무것도 하지 않는다(지어낸 기본값 없음)
   *  · 🔴 같은 대기표에는 두 번 보내지 않는다 — 원장(PatientNotification.data.queueId)으로 확인
   *  · 보낼지(마스터·유형 스위치·계정) 판정은 게이트 한 곳 — 여기는 "사실이 참이 됐다"만 알린다
   *  · 실패는 대기열 동작을 막지 않는다(알림은 부수 효과) — 로그로 남긴다
   */
  @OnEvent('queue.changed', { async: true })
  async notifyQueueNear(payload: { queueId: string }): Promise<number> {
    try {
      const ahead = normalizeQueueNearAhead(await this.config?.get(PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY));
      if (ahead == null) return 0;
      const changed = await this.prisma.waitingQueue.findUnique({ where: { id: payload.queueId }, select: { departmentName: true } });
      if (!changed?.departmentName) return 0;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      // 앞 인원 = 같은 과 오늘 WAITING 중 번호가 앞선 수 → 번호순 i 번째(0부터)의 앞 인원은 i
      const waiting = await this.prisma.waitingQueue.findMany({
        where: { departmentName: changed.departmentName, status: 'WAITING', createdAt: { gte: today } },
        select: { id: true, patientId: true, queueNumber: true },
        orderBy: { queueNumber: 'asc' },
        take: ahead + 1,
      });
      let emitted = 0;
      for (let i = 0; i < waiting.length; i++) {
        const q = waiting[i];
        const already = await this.prisma.patientNotification.findFirst({
          where: { type: 'QUEUE_NEAR', data: { path: ['queueId'], equals: q.id } },
          select: { id: true },
        });
        if (already) continue;
        await this.eventEmitter.emitAsync('patient.queue_near', { patientId: q.patientId, queueId: q.id, departmentName: changed.departmentName, aheadCount: i });
        emitted += 1;
      }
      return emitted;
    } catch (e) {
      this.logger.warn(`차례 임박 알림 판정 실패(대기열 동작은 계속): ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  }
}
