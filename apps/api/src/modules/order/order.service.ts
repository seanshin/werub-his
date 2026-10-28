import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { canExecuteOrder, DEDICATED_RESULT_SCREEN, GENERIC_RESULT_TYPES, parseOrderResult, type OrderEntryType, type OrderResultEntry } from '@hospital-run/shared';
import { localDateKey } from '../../common/day-range';
import { AuditAction, OrderDepartment, OrderStatus, Prisma, PrescriptionType } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PacsProxyService } from '../pacs-proxy/pacs-proxy.service';
import { buildCareContext, DEFAULT_ICU_WARD_PATTERNS, type CareContextResult } from './care-context';
import { myOrdersPrescriptionWhere } from './my-orders-scope';
import { OrderSignLogService } from '../order-sign-log/order-sign-log.service';
import { AuditService } from '../audit/audit.service';
import { assertEnumParam } from '../../common/enum-param';

/**
 * 오더 상태기계 — 실무 워크플로 반영(2026-07-15 이중경로 통합):
 * - 병합 전이: ORDERED→IN_PROGRESS(접수 생략 즉시 시행 — lab/imaging/therapy 관례),
 *   RECEIVED→COMPLETED(시행 즉시 완료 — completeLabResult 관례)
 * - 역전이: IN_PROGRESS→RECEIVED(재작업 롤백 — pharmacy/lab/imaging 관례)
 */
export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  ORDERED: ['RECEIVED', 'IN_PROGRESS', 'CANCELLED'],
  RECEIVED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'RECEIVED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** 중앙 상태전이 가드 — 워크스테이션 등 도메인 외 경로도 이 함수를 통해 전이 규칙을 공유한다 */
export function assertOrderTransition(current: OrderStatus, next: OrderStatus): void {
  if (!VALID_ORDER_TRANSITIONS[current].includes(next)) {
    throw new BadRequestException(`Cannot transition order from ${current} to ${next}`);
  }
}

export const TYPE_TO_DEPARTMENT: Record<PrescriptionType, OrderDepartment> = {
  MEDICATION: 'PHARMACY',
  LAB: 'LAB',
  IMAGING: 'IMAGING',
  THERAPY: 'THERAPY',
  // 🔴 아래 3종은 **제 부서가 없어 PHARMACY 로 대체**한 것이다(`OrderDepartment` 에 간호·영양 값이 없다).
  //    그 대가로 약국 조제 큐에 `병실 내 보행`·`침상머리 30° 거상`·`체위 변경`·`기본식사` 가 섰다
  //    — 실측 19건 중 8건이 비약물이었다(2026-08-12). 약사가 조제할 수 없는 것들이다.
  //    **약국 큐는 `department` 가 아니라 `prescription.type='MEDICATION'` 으로 걸러야 한다**
  //    (`getPharmacyWorklist`). 부서 값을 늘리는 것은 스키마 변경이라 별도 과제.
  DIET: 'PHARMACY',      // 식이 처방 → 실제로는 영양과
  ACTIVITY: 'PHARMACY',  // 활동 제한 → 실제로는 간호부
  NURSING: 'PHARMACY',   // 간호 지시 → 실제로는 간호부
};

/** 오더 생성 스펙 — 모든 생성 경로(CPOE·복사·반복·사전처방·워크스테이션·치료반복)가 공유 */
export interface OrderCreateSpec {
  prescriptionId: string;
  type: PrescriptionType;
  priority?: string | null;
  /** MEDICATION 한정 — 원내/원외(INTERNAL/EXTERNAL). 미지정 시 INTERNAL */
  dispensingType?: string | null;
  preOrderId?: string;
  notes?: string;
}

/**
 * 오더 생성 데이터 단일 정본 — department 매핑(TYPE_TO_DEPARTMENT)·pharmacyType·기본값을
 * 한 곳에서 결정한다. 각 경로의 인라인 삼항(THERAPY→IMAGING 오분류 버그)·매핑 사본 금지.
 */
export function buildOrderData(spec: OrderCreateSpec): Prisma.OrderUncheckedCreateInput {
  const department = TYPE_TO_DEPARTMENT[spec.type] ?? 'PHARMACY';
  return {
    prescriptionId: spec.prescriptionId,
    department,
    status: 'ORDERED',
    priority: spec.priority ?? 'ROUTINE',
    pharmacyType: spec.type === 'MEDICATION' ? (spec.dispensingType ?? 'INTERNAL') : 'INTERNAL',
    ...(spec.preOrderId ? { preOrderId: spec.preOrderId } : {}),
    ...(spec.notes ? { notes: spec.notes } : {}),
  };
}

/**
 * order.created 표준 발행 — PACS worklist(영상)·후속 소비자가 구독. 트랜잭션 커밋 후 호출.
 * (기존에는 CPOE 정본 경로만 발행 → 복사·반복·사전처방 영상오더가 PACS에 미등록되던 결함)
 */
export function emitOrderCreated(
  emitter: { emit: (event: string, payload: unknown) => unknown },
  payload: { orderId: string; type: string; patientId?: string; encounterId?: string; procedureCodeId?: string | null; priority?: string | null; notes?: string | null },
): void {
  emitter.emit('order.created', {
    orderId: payload.orderId,
    type: payload.type,
    patientId: payload.patientId,
    encounterId: payload.encounterId,
    procedureCodeId: payload.procedureCodeId ?? undefined,
    priority: payload.priority ?? 'ROUTINE',
    notes: payload.notes ?? undefined,
  });
}

/** 전이+시행자 스탬프 update 데이터 — 직접 update 경로(치료 등)가 스탬프를 누락하지 않도록 공용화 */
export function orderTransitionData(next: OrderStatus, userId?: string): Prisma.OrderUncheckedUpdateInput {
  const now = new Date();
  return {
    status: next,
    ...(next === 'RECEIVED' ? { receivedAt: now, ...(userId ? { receivedById: userId } : {}) } : {}),
    ...(next === 'IN_PROGRESS' ? { startedAt: now, ...(userId ? { startedById: userId } : {}) } : {}),
    ...(next === 'COMPLETED' ? { completedAt: now, ...(userId ? { completedById: userId } : {}) } : {}),
  };
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pacsProxy: PacsProxyService,
    // 서명 로그는 부가 기능 — 미주입이어도 오더 처리는 그대로 동작해야 한다
    @Optional() private readonly signLog?: OrderSignLogService,
    @Optional() private readonly events?: EventEmitter2,
    // 처방 연동 취소를 남기는 용도 — 미주입이어도 오더 처리는 그대로 동작해야 한다
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * 처방으로부터 오더 자동 생성 — 생성 데이터는 buildOrderData 단일 정본.
   * (현재 각 도메인 경로가 tx 내에서 buildOrderData를 직접 사용 — 본 메서드는 비트랜잭션 진입점)
   */
  async createFromPrescription(prescriptionId: string, type: PrescriptionType, priority?: string) {
    const order = await this.prisma.order.create({
      data: buildOrderData({ prescriptionId, type, priority }),
    });

    // 영상 오더인 경우 OpenPACS Worklist에 자동 등록 (실패해도 오더는 유지)
    if (type === 'IMAGING') {
      this.pushToWorklist(order.id, prescriptionId).catch((err) => {
        this.logger.warn(`Failed to push imaging order ${order.id} to PACS worklist: ${err.message}`);
      });
    }

    return order;
  }

  /**
   * OpenPACS Worklist에 항목 추가 (graceful degradation)
   */
  private async pushToWorklist(orderId: string, prescriptionId: string): Promise<void> {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: {
        encounter: {
          select: {
            patient: { select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
            doctor: { select: { familyName: true, givenName: true } },
          },
        },
        procedureCode: { select: { code: true, nameKo: true } },
      },
    });

    if (!prescription?.encounter?.patient) return;

    const patient = prescription.encounter.patient;
    const doctor = prescription.encounter.doctor;
    const today = localDateKey(new Date()); // 🔴 DICOM 워크리스트 scheduled_date 는 KST 날짜(UTC slice 는 오전에 전날)

    await this.pacsProxy.createWorklistItem({
      patient_id: patient.mrn,
      patient_name: `${patient.familyName ?? ''}${patient.givenName ?? ''}`,
      patient_birth_date: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().slice(0, 10).replace(/-/g, '') : undefined,
      patient_sex: patient.gender === 'MALE' ? 'M' : patient.gender === 'FEMALE' ? 'F' : 'O',
      accession_number: orderId.slice(0, 16),
      modality: 'DX', // 기본값, procedureCode에서 추출 가능
      scheduled_date: today,
      scheduled_time: new Date().toTimeString().slice(0, 5).replace(':', ''),
      study_description: prescription.procedureCode?.nameKo ?? '',
      referring_physician: doctor ? `${doctor.familyName ?? ''}${doctor.givenName ?? ''}` : undefined,
      his_order_id: orderId,
    });
  }

  /**
   * 오더 목록 (부서/상태 필터)
   */
  async findAll(filters: {
    department?: string; status?: string; doctorId?: string;
    type?: string; from?: string; to?: string; priority?: string;
    /** 진료 맥락 — OUTPATIENT|INPATIENT|ICU|ER (쉼표 다중) */
    careContext?: string;
    /** 야간 당직 처리 대상만 */
    nightOnly?: boolean;
    /** 특정 환자의 오더만(간호 스테이션에서 선택 환자 기준 조회) */
    patientId?: string;
    /** 책임 처방의 — `prescriberId`(위임·대리 입력 시 지정 처방의), 미지정이면 입력자(`createdBy`)가 책임자다(스키마 주석 정본) */
    prescribedBy?: string;
    /** 내 오더만(`myOrdersPrescriptionWhere`) — mine=true 인데 사용자를 모르면 400(전체를 내 것으로 말하지 않는다) */
    mine?: boolean; mineUserId?: string;
    page?: number; limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const where: Prisma.OrderWhereInput = {};
    if (filters.department) { assertEnumParam(filters.department, OrderDepartment, '부서'); where.department = filters.department as OrderDepartment; }
    if (filters.status) { assertEnumParam(filters.status, OrderStatus, '상태'); where.status = filters.status as OrderStatus; }
    if (filters.priority) where.priority = filters.priority;

    // prescription-level filters
    const rxWhere: Prisma.PrescriptionWhereInput = {};
    if (filters.doctorId || filters.patientId) {
      rxWhere.encounter = {
        ...(filters.doctorId ? { doctorId: filters.doctorId } : {}),
        ...(filters.patientId ? { patientId: filters.patientId } : {}),
      };
    }
    if (filters.type) { assertEnumParam(filters.type, PrescriptionType, '유형'); rxWhere.type = filters.type as PrescriptionType; }
    // 책임 처방의 = prescriberId ?? createdBy — 대리 입력(간호사가 적고 의사가 책임)도 의사의 "내 오더"다
    if (filters.prescribedBy) {
      rxWhere.OR = [
        { prescriberId: filters.prescribedBy },
        { prescriberId: null, createdBy: filters.prescribedBy },
      ];
    }
    if (filters.mine) {
      if (!filters.mineUserId) throw new BadRequestException('내 오더 조회(mine=true)는 로그인 사용자가 필요합니다');
      where.prescription = Object.keys(rxWhere).length > 0
        ? { AND: [rxWhere, myOrdersPrescriptionWhere(filters.mineUserId)] }
        : myOrdersPrescriptionWhere(filters.mineUserId);
    } else if (Object.keys(rxWhere).length > 0) where.prescription = rxWhere;

    // date range
    if (filters.from || filters.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.from) createdAt.gte = new Date(filters.from);
      if (filters.to) createdAt.lte = new Date(filters.to + 'T23:59:59.999Z');
      where.createdAt = createdAt;
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        include: {
          receiver: { select: { familyName: true, givenName: true, role: true } },
          starter: { select: { familyName: true, givenName: true, role: true } },
          completer: { select: { familyName: true, givenName: true, role: true } },
          // 오더 확인자 — 관계는 정의돼 있었으나 응답에 실리지 않아 화면에서 이름을 못 썼다(2026-07)
          acknowledger: { select: { familyName: true, givenName: true, role: true } },
          prescription: {
            select: {
              id: true, type: true,
              dosage: true, frequency: true, duration: true,
              quantity: true, route: true, priority: true,
              durChecked: true, durWarnings: true, durOverridden: true,
              encounter: {
                select: {
                  id: true, patientId: true,
                  // 진료 맥락 판정 재료 — 입원 여부·방문유형·배정 병동(중환자 판정)
                  admissionId: true, visitType: true,
                  admission: { select: { bed: { select: { ward: { select: { name: true } } } } } },
                  patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
                  doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
                },
              },
              medicationCode: { select: { code: true, nameKo: true, nameEn: true, ingredient: true, dosageForm: true } },
              procedureCode: { select: { code: true, nameKo: true } },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    // 진료 맥락(외래·입원·중환자·응급)·야간 처리 대상 부여 — 정본 하나(withCareContext · 오더 추적도 같은 함수)
    let enriched = await this.withCareContext(data);

    // 맥락 필터는 **조회 후** 적용한다(응급 판정이 다른 테이블에 있어 where 로 못 만든다).
    // 그래서 total 도 필터 결과로 다시 센다 — 화면 건수와 목록이 어긋나지 않게.
    const wanted = (filters.careContext ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    if (wanted.length) enriched = enriched.filter((o) => wanted.includes(o.careContext));
    if (filters.nightOnly) enriched = enriched.filter((o) => o.nightHandled);
    const filtered = wanted.length > 0 || filters.nightOnly;

    return {
      data: enriched,
      pagination: {
        total: filtered ? enriched.length : total,
        page, limit,
        hasMore: filtered ? false : page * limit < total,
        ...(filtered ? { filteredFromPage: true } : {}),
      },
    };
  }

  /**
   * 진료 맥락(외래·입원·중환자·응급)·야간 처리 대상을 붙인다 — 오더 목록·오더 실시간 추적이 같은 규칙.
   * 응급은 **진행 중 방문**만 인정하므로 환자별로 한 번에 조회한다(N+1 금지).
   */
  async withCareContext<T extends {
    priority: string; createdAt: Date;
    prescription?: { encounter?: { patientId?: string | null; admissionId?: string | null; visitType?: string | null; admission?: { bed?: { ward?: { name?: string | null } | null } | null } | null } | null } | null;
  }>(data: T[]): Promise<(T & CareContextResult)[]> {
    const patientIds = [...new Set(data.map((o) => o.prescription?.encounter?.patientId).filter(Boolean) as string[])];
    const erByPatient = new Map<string, string>();
    if (patientIds.length) {
      const visits = await this.prisma.emergencyVisit.findMany({
        where: { patientId: { in: patientIds }, status: { not: 'COMPLETED' } },
        select: { patientId: true, status: true, arrivalAt: true },
        orderBy: { arrivalAt: 'desc' },
      });
      for (const v of visits) if (!erByPatient.has(v.patientId)) erByPatient.set(v.patientId, v.status);
    }
    const icuPatterns = await this.icuWardPatterns();
    return data.map((o) => {
      const enc = o.prescription?.encounter;
      const ctx = buildCareContext({
        admissionId: enc?.admissionId ?? null,
        visitType: enc?.visitType ?? null,
        wardName: enc?.admission?.bed?.ward?.name ?? null,
        erStatus: enc?.patientId ? erByPatient.get(enc.patientId) ?? null : null,
        priority: o.priority,
        createdAt: o.createdAt,
      }, icuPatterns);
      return { ...o, ...ctx };
    });
  }

  /** 중환자 병동 이름 패턴 — 운영 병동명이 기본값과 다르면 SystemConfig 로 덮어쓴다 */
  private async icuWardPatterns(): Promise<string[]> {
    try {
      const raw = await this.prisma.systemConfig.findUnique({ where: { key: 'ward.icuNames' }, select: { value: true } });
      const v = raw?.value as unknown;
      if (Array.isArray(v) && v.length) return v.map(String);
    } catch { /* 설정 조회 실패는 기본 패턴으로 */ }
    return DEFAULT_ICU_WARD_PATTERNS;
  }

  /**
   * 부서별 대기열 (ORDERED + RECEIVED 상태만)
   */
  async getQueue(department: OrderDepartment) {
    return this.prisma.order.findMany({
      where: {
        department,
        status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }], // STAT(S) < ROUTINE(R) 알파벳 순
      include: {
        prescription: {
          include: {
            encounter: {
              select: {
                patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
                doctor: { select: { familyName: true, givenName: true } },
              },
            },
            medicationCode: { select: { code: true, nameKo: true, nameEn: true, ingredient: true, dosageForm: true } },
            procedureCode: { select: { code: true, nameKo: true } },
          },
        },
      },
    });
  }

  /**
   * 오더 상태 변경
   */
  /** 시행·결과 기록 범위(정본 shared canExecuteOrder) — userId 없는 내부 호출은 검사하지 않는다 */
  private async assertExecutor(userId: string | undefined, type: string | null | undefined): Promise<void> {
    if (!userId) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, profession: true } });
    if (!canExecuteOrder(u?.role, u?.profession, type ?? '')) {
      throw new ForbiddenException({ code: 'ORDER_EXECUTION_SCOPE', message: '이 직종이 완료·결과를 기록하는 오더 유형이 아닙니다.' });
    }
  }

  /**
   * 범용 결과 기록(치료·간호·활동·식이) — 요약·소견·실제 시행 시각. **덧붙이기만** 한다(정정은 AMENDMENT 새 항목).
   * 🔴 이 유형들은 결과를 남길 곳이 없었다 — `Order.result` 칼럼은 있었지만 쓰는 경로가 0 이라, 간호사·치료사가 무엇을 했는지는
   *    '완료' 스탬프 하나뿐이었다. 검사·영상·약은 **전용 원장**이 정본이라 여기서 받지 않는다(정본이 둘이 되지 않게).
   * `complete=true` 면 상태도 완료로 — 전이 정본(changeStatus)을 지나 서명 로그·감사가 그대로 남는다.
   * 시스템 스탬프(접수·시작·완료)는 '기록한 때', performedAt 은 '실제 시행한 때'(기록자 입력) — 둘을 섞지 않는다.
   */
  async recordResult(id: string, dto: { summary: string; findings?: string; performedAt?: string; complete?: boolean; amends?: string }, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, createdAt: true, result: true, prescription: { select: { type: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const type = order.prescription?.type as OrderEntryType | undefined;
    if (type && DEDICATED_RESULT_SCREEN[type]) {
      // 문장에 값을 끼우지 않는다(server-composed-display-text) — 어느 화면인지는 화면이 shared DEDICATED_RESULT_SCREEN 으로 안내한다
      throw new BadRequestException({ code: 'ORDER_RESULT_DEDICATED', message: '이 유형의 결과는 전용 화면(검사 결과·영상 판독·조제/투약 기록)에서 기록합니다.' });
    }
    if (!type || !GENERIC_RESULT_TYPES.includes(type)) throw new BadRequestException({ code: 'ORDER_RESULT_UNSUPPORTED', message: '결과를 기록할 수 없는 오더 유형입니다.' });
    if (order.status === 'CANCELLED') throw new BadRequestException({ code: 'ORDER_CANCELLED', message: '취소된 오더에는 결과를 기록하지 않습니다.' });
    await this.assertExecutor(userId, type);
    const summary = dto.summary?.trim();
    if (!summary) throw new BadRequestException({ code: 'RESULT_SUMMARY_REQUIRED', message: '결과 요약을 적으세요.' });

    let performedAt: string | null = null;
    if (dto.performedAt) {
      const t = new Date(dto.performedAt);
      if (Number.isNaN(t.getTime())) throw new BadRequestException({ code: 'PERFORMED_AT_INVALID', message: '시행 시각 형식이 올바르지 않습니다.' });
      // 미래·오더 이전 시각은 받지 않는다(모르는 시각을 원장에 박지 않는다 — 비우면 '기록 시각만 앎')
      if (t.getTime() > Date.now() + 60_000) throw new BadRequestException({ code: 'PERFORMED_AT_FUTURE', message: '시행 시각이 미래입니다.' });
      if (t.getTime() < order.createdAt.getTime() - 60_000) throw new BadRequestException({ code: 'PERFORMED_AT_BEFORE_ORDER', message: '시행 시각이 오더 발행보다 앞섭니다.' });
      performedAt = t.toISOString();
    }

    const doc = parseOrderResult(order.result);
    if (dto.amends && !doc.entries.some((e) => e.id === dto.amends)) {
      throw new BadRequestException({ code: 'AMENDS_NOT_FOUND', message: '정정할 원래 기록을 찾을 수 없습니다.' });
    }
    const who = await this.prisma.user.findUnique({ where: { id: userId }, select: { familyName: true, givenName: true } });
    const entry: OrderResultEntry = {
      id: randomUUID(),
      kind: dto.amends ? 'AMENDMENT' : 'RESULT',
      summary,
      findings: dto.findings?.trim() || null,
      performedAt,
      recordedAt: new Date().toISOString(),
      recordedBy: userId,
      recordedByName: who ? `${who.familyName}${who.givenName}` : null,
      amends: dto.amends ?? null,
    };
    await this.prisma.order.update({
      where: { id },
      data: { result: { ...doc, entries: [...doc.entries, entry] } as unknown as Prisma.InputJsonValue },
    });

    if (dto.complete && order.status !== 'COMPLETED') {
      // 전이 정본을 지난다 — 접수 전(ORDERED)·접수(RECEIVED)면 시행 시작을 거쳐 완료(각 단계 스탬프·서명 로그)
      if (order.status === 'ORDERED' || order.status === 'RECEIVED') await this.changeStatus(id, 'IN_PROGRESS', undefined, userId);
      await this.changeStatus(id, 'COMPLETED', undefined, userId);
    }
    return this.prisma.order.findUnique({ where: { id }, select: { id: true, status: true, completedAt: true, result: true } });
  }

  /** 결과지 첨부 — 전 유형(외부 결과지·스캔본). 지우지 않는다(기록 원장) · 최대 20 */
  async addResultAttachment(id: string, file: { url: string; fileName: string; mimeType: string; size: number }, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, select: { id: true, status: true, result: true, prescription: { select: { type: true } } } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'CANCELLED') throw new BadRequestException({ code: 'ORDER_CANCELLED', message: '취소된 오더에는 결과지를 붙이지 않습니다.' });
    await this.assertExecutor(userId, order.prescription?.type);
    const doc = parseOrderResult(order.result);
    if (doc.attachments.length >= 20) throw new BadRequestException({ code: 'ATTACHMENT_LIMIT', message: '결과지는 최대 20개까지 붙일 수 있습니다.' });
    const who = await this.prisma.user.findUnique({ where: { id: userId }, select: { familyName: true, givenName: true } });
    const att = { ...file, uploadedBy: userId, uploadedByName: who ? `${who.familyName}${who.givenName}` : null, uploadedAt: new Date().toISOString() };
    await this.prisma.order.update({
      where: { id },
      data: { result: { ...doc, attachments: [...doc.attachments, att] } as unknown as Prisma.InputJsonValue },
    });
    return { id, attachments: [...doc.attachments, att] };
  }

  async changeStatus(id: string, newStatus: OrderStatus, notes?: string, userId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { prescription: { select: { type: true } } } });
    if (!order) throw new NotFoundException('Order not found');

    assertOrderTransition(order.status, newStatus);
    // 완료는 시행 범위 안에서만(2026-09-29) — 종전엔 누구나 검사·영상 오더를 결과 없이 완료로 만들 수 있었다
    if (newStatus === 'COMPLETED') await this.assertExecutor(userId, order.prescription?.type);

    const updateData: Prisma.OrderUpdateInput = { status: newStatus };
    if (notes) updateData.notes = notes;

    if (newStatus === 'RECEIVED') {
      updateData.receivedAt = new Date();
      if (userId) updateData.receiver = { connect: { id: userId } };
    }
    if (newStatus === 'IN_PROGRESS') {
      updateData.startedAt = new Date();
      if (userId) updateData.starter = { connect: { id: userId } };
    }
    if (newStatus === 'COMPLETED') {
      updateData.completedAt = new Date();
      if (userId) updateData.completer = { connect: { id: userId } };
    }
    // 취소도 시각·행위자를 남긴다 — 종전엔 취소만 스탬프가 없어 "누가 언제 취소했는가"를
    // 사후에 재구성할 수 없었다(서명 로그 소급 복원도 불가).
    if (newStatus === 'CANCELLED') {
      updateData.cancelledAt = new Date();
      if (userId) updateData.canceller = { connect: { id: userId } };
    }

    // 오더 취소 = 처방 취소(같은 행위로 간주 — 2026-08-03 정책 확정).
    // 🔴 종전엔 오더만 CANCELLED 가 되고 처방은 ACTIVE 로 남았다(운영 실측 61건·계속 누적):
    //    취소한 검사·약이 처방 목록·청구·MAR 에서는 살아 있는 상태였다.
    // 역방향(처방 취소 → 오더 취소)은 prescription.service.cancel 이 이미 같은 일을 한다.
    //    **두 방향의 부수효과(상태 + SCHEDULED MAR 제거)를 같게 유지할 것** — 한쪽만 고치면 다시 어긋난다.
    //    모듈 순환(운영 다운 이력)을 만들지 않으려고 서비스를 호출하지 않고 같은 트랜잭션에서 직접 쓴다.
    let syncedPrescriptionId: string | null = null;
    let removedMarCount = 0;
    const updated = await this.prisma.$transaction(async (tx) => {
      const o = await tx.order.update({ where: { id }, data: updateData });
      if (newStatus === 'CANCELLED' && o.prescriptionId) {
        const rx = await tx.prescription.findUnique({
          where: { id: o.prescriptionId },
          select: { id: true, status: true },
        });
        // 멱등 — 역방향에서 이미 취소된 처방은 건드리지 않는다(재취소 무해)
        // 🔴 (2026-09-30) 활성 처방만 따라 취소한다 — 중단(DISCONTINUED)된 처방을 취소로 바꾸면 이미 일어난 투약이 무효처럼 된다.
        //    활성이어도 이미 발효됐으면(투약 기록·다른 오더 시행) 이 오더 하나 취소로 처방 전체를 무효로 만들지 않는다.
        const tookEffect = rx && rx.status === 'ACTIVE'
          ? (await tx.medicationAdministration.count({ where: { prescriptionId: rx.id, status: { in: ['ADMINISTERED', 'HELD', 'REFUSED', 'MISSED'] } } }))
            + (await tx.order.count({ where: { prescriptionId: rx.id, id: { not: id }, status: { in: ['RECEIVED', 'IN_PROGRESS', 'COMPLETED'] } } })) > 0
          : false;
        if (rx && rx.status === 'ACTIVE' && !tookEffect) {
          await tx.prescription.update({ where: { id: rx.id }, data: { status: 'CANCELLED' } });
          // 취소약이 간호 MAR 에 남아 투약되는 사고 방지. 이미 시행/보류/거부분은 감사 위해 보존.
          const removed = await tx.medicationAdministration.deleteMany({
            where: { prescriptionId: rx.id, status: 'SCHEDULED' },
          });
          removedMarCount = removed.count;
          syncedPrescriptionId = rx.id;
        }
      }
      return o;
    });

    // 오더 취소를 후속 소비자에게 알린다 — 종전엔 이 경로가 이벤트를 내지 않아
    // PACS 워크리스트에 **유령 오더**가 남았다(촬영실에는 취소된 검사가 계속 떠 있었다).
    if (newStatus === 'CANCELLED') {
      this.events?.emit('order.cancelled', {
        orderId: id,
        orderIds: [id],
        department: order.department,
        prescriptionId: order.prescriptionId,
        reason: 'ORDER_STATUS_CHANGED',
      });
    }

    // 오더 완료를 후속 소비자에게 알린다(여정 ORDER_COMPLETED 등) — 커밋 뒤 발행.
    if (newStatus === 'COMPLETED') {
      this.events?.emit('order.completed', { orderId: id, department: order.department, prescriptionId: order.prescriptionId });
    }

    // sign 서명 로그 — 스탬프와 **같은 시각**을 넘겨야 소급 복원과 겹쳐도 1건으로 합쳐진다.
    // 🔴 우선순위(completedAt ?? startedAt ?? …)로 고르면 안 된다: 역전이(IN_PROGRESS→RECEIVED)는
    //    startedAt 이 이미 있어서 **이전 시행 시각**이 잡힌다. 전이한 상태의 스탬프를 직접 집는다.
    const stampOf: Record<string, Date | null> = {
      RECEIVED: updated.receivedAt,
      IN_PROGRESS: updated.startedAt,
      COMPLETED: updated.completedAt,
      CANCELLED: updated.cancelledAt,
    };
    const occurredAt = stampOf[newStatus] ?? updated.updatedAt;
    await this.signLog?.recordTransition({
      orderId: id, from: order.status, to: newStatus, actorId: userId ?? null, occurredAt,
    });

    // 처방까지 취소됐다면 그 사실을 남긴다 — 오더 감사만으로는 "처방이 왜 죽었는지" 재구성할 수 없다
    // (역방향 prescription.cancel 도 PRESCRIPTION 감사를 남긴다 — 대칭 유지).
    if (syncedPrescriptionId) {
      this.logger.log(`오더 취소 연동: 처방 ${syncedPrescriptionId} 취소·예정투약 ${removedMarCount}건 제거 (order=${id})`);
      if (userId) {
        await this.audit?.safeLog({
          userId,
          action: AuditAction.UPDATE,
          resourceType: 'PRESCRIPTION',
          resourceId: syncedPrescriptionId,
          changes: {
            status: { old: 'ACTIVE', new: 'CANCELLED' },
            cancelledBy: { old: null, new: `ORDER_CANCELLED:${id}` },
            cancelledScheduledMar: { old: removedMarCount, new: 0 },
          },
        });
      }
    }

    return updated;
  }
}