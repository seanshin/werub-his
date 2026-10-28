import { randomUUID } from 'crypto';
import { todayDateOnly } from '../../common/day-range';
import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { buildOrderData, emitOrderCreated } from '../order/order.service';
import { DurService } from '../prescription/dur/dur.service';
import { AuditService } from '../audit/audit.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';
import { FormularyGateService } from '../formulary/formulary-gate.service';

// ON_CHECKIN 자동 활성화는 비약물만 — 약물은 어떤 경로로도 의사 승인 없이 발효 불가(안전 원칙)
const ON_CHECKIN_ALLOWED_TYPES = new Set(['LAB', 'IMAGING']);

/** 승인 시점 DUR 재검증 결과 — `FAILED` 는 "경고 없음"이 아니라 "검사하지 못함"이다 */
export interface PreOrderDurCheck {
  status: 'CHECKED' | 'FAILED' | 'NOT_APPLICABLE';
  reason: string | null;
}

// 작성 시점 DUR 검사용 — 아직 encounter가 없으므로 NIL UUID로 조회(현재 진료분 없음·최근 30일 처방은 patientId 기준으로 검사됨)
const NIL_ENCOUNTER = '00000000-0000-0000-0000-000000000000';
const DEFAULT_EXPIRY_DAYS = 90; // 만료 미지정 시 기본 — 무기한 잔존 방지

/** 사전 오더 수정 경로가 바꿀 수 있는 필드 — 정본(서비스). DTO 밖 호출도 이것만 Prisma 로 간다 */
const PRE_ORDER_MODIFIABLE = ['dosage', 'frequency', 'duration', 'quantity', 'route', 'priority', 'instructions'] as const;

@Injectable()
export class PreOrderService {
  private readonly logger = new Logger(PreOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dur: DurService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
    @Optional() private readonly preAuthGate?: PreAuthGateService,
    // 🔴 W8-R3(2026-08-14) — 원내 처방집 시행 게이트. PreOrderModule 이 provider 로 직접 등록하므로
    //    실서비스에선 항상 존재한다. @Optional 은 기존 스펙의 위치 인자 생성용이며,
    //    배선 누락 시 게이트가 조용히 no-op 이 되므로 가드 스펙이 providers 목록을 검사한다.
    @Optional() private readonly formularyGate?: FormularyGateService,
    // (2026-09-15 T2) 승인 시점 DUR 재검증 실패를 감사에 남긴다(요청 키만 담는 인터셉터로는 "재검증 못 함"이 안 남는다)
    @Optional() private readonly audit?: AuditService,
  ) {}

  private async autoActivationEnabled(): Promise<boolean> {
    const v = await this.configRuntime?.get('preOrder.autoActivation').catch(() => null);
    return String(v ?? 'false') === 'true';
  }

  async create(dto: {
    patientId: string;
    doctorId: string;
    type: string;
    medicationCodeId?: string;
    procedureCodeId?: string;
    dosage?: string;
    frequency?: string;
    duration?: number;
    quantity?: number;
    route?: string;
    priority?: string;
    instructions?: string;
    reason?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    expiresAt?: string;
    source?: string;      // MANUAL(기본) | LIS_REFLEX — 외부 발신 오더 표식
    externalRef?: string; // 외부 시스템 식별자 — 재발신 멱등키(unique)
    appointmentId?: string; // 연계 예약("이 재진에서 시행")
    activationMode?: string; // ON_APPROVAL(기본) | ON_CHECKIN(접수 시 자동 — 비약물·연계예약·config 필수)
    recurEvery?: number; // P3 반복 — 매 N일 (scheduledDate 필수)
    recurCount?: number; // P3 반복 — 총 회차(2~12)
  }) {
    // P3 반복 게이트 — 예정일 기준 회차 전개(매 N일 ×M회)
    const isRecurring = !!(dto.recurEvery || dto.recurCount);
    if (isRecurring) {
      if (!dto.scheduledDate) throw new BadRequestException('반복 사전처방은 예정일(scheduledDate)이 필요합니다');
      if (!dto.recurEvery || dto.recurEvery < 1 || dto.recurEvery > 90) throw new BadRequestException('반복 간격은 1~90일이어야 합니다');
      if (!dto.recurCount || dto.recurCount < 2 || dto.recurCount > 12) throw new BadRequestException('반복 회차는 2~12회여야 합니다');
      if (dto.activationMode === 'ON_CHECKIN') throw new BadRequestException('반복 사전처방은 접수 자동 활성화와 함께 쓸 수 없습니다');
    }
    // ON_CHECKIN 게이트 — ① config ON ② 비약물(LAB/IMAGING)만 ③ 연계 예약 필수(접수 트리거 기준)
    if (dto.activationMode === 'ON_CHECKIN') {
      if (!(await this.autoActivationEnabled())) {
        throw new BadRequestException('접수 시 자동 활성화(ON_CHECKIN)가 비활성 상태입니다 (config preOrder.autoActivation)');
      }
      if (!ON_CHECKIN_ALLOWED_TYPES.has(dto.type)) {
        throw new BadRequestException('접수 시 자동 활성화는 검사/영상(비약물)만 가능합니다 — 약물은 의사 승인 필수');
      }
      if (!dto.appointmentId) {
        throw new BadRequestException('접수 시 자동 활성화는 연계 예약이 필요합니다');
      }
    }
    // 연계 예약 검증 — 본인 예약만 연결(타 환자 예약 연결 방지)
    if (dto.appointmentId) {
      const appt = await this.prisma.appointment.findUnique({
        where: { id: dto.appointmentId },
        select: { patientId: true, status: true },
      });
      if (!appt) throw new BadRequestException('연계 예약을 찾을 수 없습니다.');
      if (appt.patientId !== dto.patientId) throw new BadRequestException('연계 예약의 환자가 일치하지 않습니다.');
      if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(appt.status)) {
        throw new BadRequestException(`종료된 예약(${appt.status})에는 연계할 수 없습니다.`);
      }
    }
    // 작성 시점 DUR 사전체크(비차단) — 발효 시점이 아니므로 경고 스냅샷만 남기고 승인 시 재검증
    let durSnapshot: unknown[] | null = null;
    if (dto.type === 'MEDICATION' && dto.medicationCodeId) {
      durSnapshot = await this.dur
        .checkInteractions(NIL_ENCOUNTER, dto.medicationCodeId, dto.patientId)
        .catch((e) => { this.logger.warn(`사전처방 DUR 스냅샷 실패(비차단): ${e.message}`); return null; });
    }

    const baseDate = dto.scheduledDate ? new Date(dto.scheduledDate) : null;
    const recurringGroupId = isRecurring ? randomUUID() : null;
    const occurrences = isRecurring ? dto.recurCount! : 1;

    const rowFor = (k: number): Prisma.PreOrderUncheckedCreateInput => ({
      patientId: dto.patientId,
      doctorId: dto.doctorId,
      type: dto.type,
      medicationCodeId: dto.medicationCodeId ?? null,
      procedureCodeId: dto.procedureCodeId ?? null,
      dosage: dto.dosage ?? null,
      frequency: dto.frequency ?? null,
      duration: dto.duration ?? null,
      quantity: dto.quantity ?? null,
      route: dto.route ?? null,
      priority: dto.priority ?? 'ROUTINE',
      instructions: dto.instructions ?? null,
      reason: isRecurring ? `${dto.reason ?? ''}${dto.reason ? ' ' : ''}(반복 ${k + 1}/${occurrences})` : (dto.reason ?? null),
      scheduledDate: baseDate ? new Date(baseDate.getTime() + k * (dto.recurEvery ?? 0) * 86400_000) : null,
      scheduledTime: dto.scheduledTime ?? null,
      expiresAt: dto.expiresAt
        ? new Date(dto.expiresAt)
        : new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86400_000 + k * (dto.recurEvery ?? 0) * 86400_000),
      durSnapshot: durSnapshot ? (durSnapshot as Prisma.InputJsonValue) : Prisma.JsonNull,
      source: dto.source ?? 'MANUAL',
      externalRef: dto.externalRef ?? null,
      appointmentId: k === 0 ? (dto.appointmentId ?? null) : null, // 연계 예약은 1회차만(예약 1건에 1회차)
      activationMode: dto.activationMode === 'ON_CHECKIN' ? 'ON_CHECKIN' : 'ON_APPROVAL',
      recurringGroupId,
      status: 'PENDING',
    });

    // 반복 회차(k>0)는 부가 생성 — 실패해도 1회차는 유지되도록 순차 생성
    const preOrder = await this.prisma.preOrder.create({
      data: rowFor(0),
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        doctor: { select: { id: true, familyName: true, givenName: true } },
        medicationCode: true,
        procedureCode: true,
      },
    });
    let createdCount = 1;
    for (let k = 1; k < occurrences; k++) {
      await this.prisma.preOrder.create({ data: rowFor(k) })
        .then(() => { createdCount += 1; })
        .catch((e) => this.logger.warn(`반복 회차 ${k + 1} 생성 실패(비차단): ${e.message}`));
    }
    return {
      data: preOrder,
      ...(isRecurring ? { recurring: { groupId: recurringGroupId, requested: occurrences, created: createdCount } } : {}),
    };
  }

  async findAll(filters: { patientId?: string; doctorId?: string; status?: string }) {
    const where: Prisma.PreOrderWhereInput = {};
    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.doctorId) where.doctorId = filters.doctorId;
    if (filters.status) where.status = filters.status;

    const preOrders = await this.prisma.preOrder.findMany({
      where,
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        doctor: { select: { id: true, familyName: true, givenName: true } },
        // nameEn·ingredient — 사전처방 탭 목록이 약품을 <DrugName> 으로 그린다(영문 모드 실탄은 성분명:
        // 상품명 nameEn 은 0.2%뿐). 빠지면 영문 모드에서 거의 모든 약이 'EN×' 로 그려진다.
        medicationCode: { select: { id: true, code: true, nameKo: true, nameEn: true, ingredient: true } },
        // ProcedureCode 에는 영문명 필드가 없다 — 지어내지 않는다(한글 그대로).
        procedureCode: { select: { id: true, code: true, nameKo: true } },
        appointment: { select: { id: true, scheduledAt: true, status: true } },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
    return { data: preOrders };
  }

  async findById(id: string) {
    const preOrder = await this.prisma.preOrder.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        doctor: { select: { id: true, familyName: true, givenName: true } },
        medicationCode: true,
        procedureCode: true,
      },
    });
    if (!preOrder) throw new NotFoundException('Pre-Order를 찾을 수 없습니다.');
    return { data: preOrder };
  }

  async findPendingByPatient(patientId: string) {
    const preOrders = await this.prisma.preOrder.findMany({
      where: { patientId, status: 'PENDING' },
      include: {
        doctor: { select: { familyName: true, givenName: true } },
        medicationCode: { select: { code: true, nameKo: true } },
        procedureCode: { select: { code: true, nameKo: true } },
        appointment: { select: { id: true, scheduledAt: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: preOrders };
  }

  async findMyPending(doctorId: string) {
    const preOrders = await this.prisma.preOrder.findMany({
      where: { doctorId, status: 'PENDING' },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        medicationCode: { select: { code: true, nameKo: true } },
        procedureCode: { select: { code: true, nameKo: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: preOrders };
  }

  /** 승인 → Prescription + Order 자동 생성 (MEDICATION은 승인 시점 DUR 재검증) */
  async approve(
    id: string,
    approvedBy: string,
    encounterId: string,
    override?: { overrideDur?: boolean; overrideReason?: string },
  ) {
    const preOrder = await this.prisma.preOrder.findUnique({ where: { id } });
    if (!preOrder) throw new NotFoundException('Pre-Order를 찾을 수 없습니다.');
    if (preOrder.status !== 'PENDING' && preOrder.status !== 'MODIFIED') {
      throw new BadRequestException('승인 가능한 상태가 아닙니다.');
    }

    // 승인 시점 DUR 재검증 — 작성 이후 환자 상태 변화(신규 처방·임신·알레르기) 반영.
    // ERROR는 사유 있는 오버라이드 없이 발효 불가(기존 처방 게이트와 동일 규칙).
    // 사람 결정 대기: `policy.clinical.gateOverrideAuthority` — 오버라이드 가능 역할(현재 승인 EP 역할 DOCTOR·ADMIN 그대로)
    // 🔴 (2026-09-15 T2) 재검증이 **실패**하면 종전엔 `[]`(경고 없음)으로 접고 처방에 `durChecked: true` 를 박았다 —
    //    "검사해서 이상 없음"과 "검사하지 못함"이 같은 행이 됐다. 막을지는 사람 결정(`policy.clinical.gateOverrideAuthority`)
    //    이라 막지 않되, 결과(`durCheck`)·처방(`durChecked: false`)·감사에 "재검증 실패"를 남긴다.
    let durWarnings: Awaited<ReturnType<DurService['checkInteractions']>> = [];
    let durOverridden = false;
    let durCheck: PreOrderDurCheck = { status: 'NOT_APPLICABLE', reason: null };
    if (preOrder.type === 'MEDICATION' && preOrder.medicationCodeId) {
      try {
        durWarnings = await this.dur.checkInteractions(encounterId, preOrder.medicationCodeId, preOrder.patientId);
        durCheck = { status: 'CHECKED', reason: null };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.logger.warn(`사전처방 승인 DUR 재검증 실패(비차단 — 결과·감사에 FAILED 기록): ${reason}`);
        durWarnings = [];
        durCheck = { status: 'FAILED', reason };
      }
      const hasError = durWarnings.some((w) => w.severity === 'ERROR');
      if (hasError) {
        if (!(override?.overrideDur && override.overrideReason?.trim())) {
          throw new BadRequestException({
            code: 'DUR_CHECK_FAILED',
            message: 'DUR 차단 경고 — 검토 후 오버라이드 사유를 입력해야 승인할 수 있습니다.',
            warnings: durWarnings,
          });
        }
        durOverridden = true;
      }
    }

    // 🔴 W8-R3(2026-08-14) 원내 처방집 게이트 — 사전처방 승인은 **처방 발행**인데 여기는
    //    PrescriptionService 를 거치지 않고 prisma.prescription.create 를 직접 부른다.
    //    그래서 W8-R2 에서 처방 서비스 3경로(create·copy·repeat)에만 게이트를 달았을 때
    //    이 경로는 통째로 우회로였다(관리 화면은 '미배선 경로'라고 표시만 하고 있었다).
    //    판정은 새로 만들지 않고 정본 FormularyGateService.assertOrderAllowed 를 그대로 부른다.
    //    호출 순서도 정본(prescription.service)과 동일하게 **DUR 뒤·사전승인 앞**.
    //    현재 운영 모드 MEDICATION=WARN 이라 막히는 건 없고 GateViolationLog 만 쌓인다.
    await this.formularyGate?.assertOrderAllowed(
      { type: preOrder.type, medicationCodeId: preOrder.medicationCodeId, procedureCodeId: preOrder.procedureCodeId },
      { encounterId, path: 'CREATE' },
    );

    // 사전승인 게이트 — 사전처방 승인 발행 전 결재 확인(F2 우회 차단). 게이트 OFF 시 no-op.
    await this.preAuthGate?.assertOrderGate(
      { type: preOrder.type, medicationCodeId: preOrder.medicationCodeId, procedureCodeId: preOrder.procedureCodeId, priority: preOrder.priority },
      { patientId: preOrder.patientId, encounterId, requestedByUserId: approvedBy, draft: { preOrderId: id } },
    );

    /**
     * 🔴 (2026-09-16 F3) 처방 발행·오더 생성·사전처방 승인 표시는 **한 트랜잭션**이다.
     *    종전엔 셋을 따로 커밋해서, 중간에 실패하면 사전처방이 PENDING 으로 남았다 —
     *    화면은 '승인 대기'를 그대로 보여주고, 승인을 다시 누르면 앞서 만들어진 처방·오더가 살아 있는 채로
     *    **두 번째 처방과 오더가 더 생긴다**(같은 사전처방 1건에 처방 2건 = 이중 투약 경로).
     *    게이트(처방집·사전승인)와 DUR 은 위에서 이미 끝났고 위반 원장은 tx 밖이라 롤백돼도 남는다.
     *    오더 생성 이벤트는 **커밋 뒤**에 발행한다(커밋되지 않은 오더를 구독자가 먼저 보지 않게).
     */
    const { prescription, order, updated } = await this.prisma.$transaction(async (tx) => {
    // Prescription 생성
    const prescription = await tx.prescription.create({
      data: {
        encounterId,
        type: preOrder.type as any,
        medicationCodeId: preOrder.medicationCodeId,
        procedureCodeId: preOrder.procedureCodeId,
        dosage: preOrder.dosage,
        frequency: preOrder.frequency,
        duration: preOrder.duration,
        quantity: preOrder.quantity,
        route: preOrder.route,
        instructions: preOrder.instructions,
        priority: preOrder.priority,
        source: 'PRE_ORDER',
        createdBy: approvedBy,
        prescriberId: preOrder.doctorId ?? approvedBy, // 사전오더 작성 의사가 책임 처방의(승인자=createdBy)
        // 약물이 아니면 종전과 같이 true(검사 대상 아님을 여기서 바꾸지 않는다) · 재검증 실패만 false
        durChecked: durCheck.status !== 'FAILED',
        durWarnings: durWarnings.length ? (durWarnings as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        ...(durOverridden
          ? {
              durOverridden: true,
              durOverrideReason: override!.overrideReason!.trim(),
              durOverrideBy: approvedBy,
              durOverrideAt: new Date(),
            }
          : {}),
      },
    });

    // Order 자동 생성 — 생성 데이터는 buildOrderData 단일 정본(매핑 사본 제거)
    const order = await tx.order.create({
      data: buildOrderData({
        prescriptionId: prescription.id,
        type: preOrder.type as never,
        priority: preOrder.priority,
        preOrderId: preOrder.id,
      }),
    });

    // Pre-Order 상태 갱신
    const updated = await tx.preOrder.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy,
        approvedAt: new Date(),
        encounterId,
        prescriptionId: prescription.id,
      },
      include: {
        patient: { select: { familyName: true, givenName: true } },
        medicationCode: { select: { nameKo: true } },
        procedureCode: { select: { nameKo: true } },
      },
    });
      return { prescription, order, updated };
    });

    // 커밋 뒤 발행 — 롤백된 오더를 구독자(여정·알림)가 먼저 보지 않게
    emitOrderCreated(this.eventEmitter, {
      orderId: order.id, type: preOrder.type, patientId: preOrder.patientId,
      encounterId, procedureCodeId: preOrder.procedureCodeId, priority: preOrder.priority,
    });

    if (durCheck.status === 'FAILED') {
      await this.audit?.safeLog({
        userId: approvedBy,
        action: AuditAction.UPDATE,
        resourceType: 'PreOrderDurRecheck',
        resourceId: id,
        changes: {
          durCheck: { old: null, new: 'FAILED' },
          prescriptionId: { old: null, new: prescription.id },
        },
      });
    }

    return { data: { preOrder: updated, prescription, order, durWarnings, durCheck } };
  }

  /**
   * P2: 접수(CHECKED_IN) 시 ON_CHECKIN 사전처방 자동 활성화 — 검사 선행 시나리오.
   * 안전장치: config 재확인·비약물만(작성 게이트와 이중)·당일 encounter 없으면 skip(의사 승인 폴백).
   */
  @OnEvent('appointment.checked_in')
  async onAppointmentCheckedIn(payload: { id?: string; patientId?: string }) {
    if (!payload?.id) return;
    if (!(await this.autoActivationEnabled())) return; // 활성화 시점 config 재확인
    const targets = await this.prisma.preOrder.findMany({
      where: { appointmentId: payload.id, status: { in: ['PENDING', 'MODIFIED'] }, activationMode: 'ON_CHECKIN' },
    });
    if (!targets.length) return;

    // 접수 시 생성된 당일 진료(Encounter) 해소 — 처방은 encounter에 귀속되어야 함
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const encounter = await this.prisma.encounter.findFirst({
      where: { patientId: targets[0].patientId, createdAt: { gte: todayStart } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!encounter) {
      this.logger.warn(`ON_CHECKIN 자동 활성화 보류(당일 encounter 없음 — 의사 승인 폴백): appt ${payload.id}, ${targets.length}건`);
      return;
    }

    for (const po of targets) {
      // 비약물 한정 이중 확인(작성 게이트가 1차)
      if (!ON_CHECKIN_ALLOWED_TYPES.has(po.type)) continue;
      await this.approve(po.id, po.doctorId, encounter.id)
        .then(() => this.logger.log(`ON_CHECKIN 자동 활성화: preOrder ${po.id} (${po.type}) → encounter ${encounter.id}`))
        .catch((e) => this.logger.warn(`ON_CHECKIN 자동 활성화 실패(비차단·의사 승인 폴백): ${po.id} — ${e.message}`));
    }
  }

  /** P2: 검사실 예정 큐 — 오늘~+N일 시행 예정(연계 예약/예정일 기준) 미결 검사 사전처방 (시약·검체 용기 사전 준비용 read-only) */
  async findUpcomingLab(days = 2) {
    // 🔴 scheduledDate 는 @db.Date — 로컬 자정(setHours)은 하루 밀린다. 정본 todayDateOnly().
    const from = todayDateOnly();
    const to = new Date(from.getTime() + Math.max(1, Math.min(14, days)) * 86400_000);
    const preOrders = await this.prisma.preOrder.findMany({
      where: {
        type: { in: ['LAB', 'IMAGING'] },
        status: { in: ['PENDING', 'MODIFIED'] },
        OR: [
          { scheduledDate: { gte: from, lt: to } },
          { appointment: { scheduledAt: { gte: from, lt: to }, status: { in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'] } } },
        ],
      },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        doctor: { select: { familyName: true, givenName: true } },
        procedureCode: { select: { code: true, nameKo: true } },
        appointment: { select: { scheduledAt: true, status: true } },
      },
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    return { data: preOrders };
  }

  /** 만료 처리 — expiresAt 경과한 미결(PENDING/MODIFIED) 건을 EXPIRED로 (매일 자정 크론 + 수동 트리거) */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async expireOverdue() {
    const result = await this.prisma.preOrder.updateMany({
      where: { status: { in: ['PENDING', 'MODIFIED'] }, expiresAt: { not: null, lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    if (result.count > 0) this.logger.log(`사전처방 만료 처리: ${result.count}건 → EXPIRED`);
    return { expired: result.count };
  }

  /** 수정 후 승인 대기 — 수정 전 값 스냅샷(PreOrderRevision) 기록 */
  async modify(
    id: string,
    updates: Partial<{
      dosage: string; frequency: string; duration: number; quantity: number;
      route: string; priority: string; instructions: string;
    }>,
    changedBy?: string,
    reason?: string,
  ) {
    const preOrder = await this.prisma.preOrder.findUnique({ where: { id } });
    if (!preOrder) throw new NotFoundException('Pre-Order를 찾을 수 없습니다.');
    if (preOrder.status !== 'PENDING') throw new BadRequestException('수정 가능한 상태가 아닙니다.');

    // 🔴 (B5) 수정 가능한 필드만 옮긴다 — 종전 `...updates` 는 본문 전체를 Prisma data 로 보냈다
    //    (DTO 에 사유 `reason` 이 들어온 뒤로는 모르는 필드 500 이 되고, DTO 를 거치지 않는 호출은 status·doctorId 까지 덮을 수 있었다)
    const changes: Partial<Record<(typeof PRE_ORDER_MODIFIABLE)[number], unknown>> = {};
    for (const key of PRE_ORDER_MODIFIABLE) {
      const v = (updates as Record<string, unknown>)[key];
      if (v !== undefined) changes[key] = v;
    }
    // 수정 전 값 스냅샷 — 변경된 필드만 (감사·삭감 추적)
    const snapshot: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) {
      snapshot[key] = (preOrder as Record<string, unknown>)[key] ?? null;
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.preOrder.update({
        where: { id },
        data: { ...(changes as Prisma.PreOrderUpdateInput), status: 'MODIFIED' },
      }),
      this.prisma.preOrderRevision.create({
        data: {
          preOrderId: id,
          snapshot: snapshot as Prisma.InputJsonValue,
          changedBy: changedBy ?? null,
          reason: reason ?? null,
        },
      }),
    ]);
    return { data: updated };
  }

  /** 수정 이력 조회 */
  async getRevisions(id: string) {
    await this.prisma.preOrder.findUniqueOrThrow({ where: { id }, select: { id: true } })
      .catch(() => { throw new NotFoundException('Pre-Order를 찾을 수 없습니다.'); });
    return this.prisma.preOrderRevision.findMany({
      where: { preOrderId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(id: string, scope?: string) {
    const preOrder = await this.prisma.preOrder.findUnique({ where: { id } });
    if (!preOrder) throw new NotFoundException('Pre-Order를 찾을 수 없습니다.');
    if (['APPROVED', 'CANCELLED', 'EXPIRED'].includes(preOrder.status)) {
      throw new BadRequestException('취소 가능한 상태가 아닙니다.');
    }

    // P3: 반복 그룹 일괄 취소 — 미결(PENDING/MODIFIED)만, 승인/만료 회차는 보존
    if (scope === 'group' && preOrder.recurringGroupId) {
      const result = await this.prisma.preOrder.updateMany({
        where: { recurringGroupId: preOrder.recurringGroupId, status: { in: ['PENDING', 'MODIFIED'] } },
        data: { status: 'CANCELLED' },
      });
      return { data: { cancelled: result.count, groupId: preOrder.recurringGroupId } };
    }

    const updated = await this.prisma.preOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    return { data: updated };
  }
}
