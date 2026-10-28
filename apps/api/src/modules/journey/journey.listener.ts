import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from './journey.service';

/**
 * 도메인 이벤트 → 환자 여정 이벤트 브리지.
 *
 * 오더 생성은 진입 경로가 8개(처방·복사·반복·워크스테이션·사전오더·치료오더 등)라
 * 각 경로에 개별 배선하면 누락이 재발한다. 전 경로가 공통으로 발행하는 `order.created`를
 * 단일 구독점으로 삼아 여정을 남긴다(정본=order.service.emitOrderCreated).
 *
 * 발행은 fire-and-forget(JourneyService.emit) — 임상 트랜잭션에 영향 없음.
 */
@Injectable()
export class JourneyListener {
  private readonly logger = new Logger(JourneyListener.name);

  constructor(
    private readonly journey: JourneyService,
    // 완료 이벤트는 오더 id 만 싣는다 — 환자 귀속을 찾는 조회용(미주입이면 그 유형만 발행하지 않고 warn)
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  private static readonly DEPT_BY_TYPE: Record<string, string> = {
    MEDICATION: '약제부',
    LAB: '진단검사의학과',
    IMAGING: '영상의학과',
    PROCEDURE: '진료부',
    THERAPY: '진료부',
  };

  @OnEvent('order.created')
  onOrderCreated(payload: {
    orderId: string;
    type?: string;
    patientId?: string;
    encounterId?: string;
    priority?: string;
    notes?: string;
  }) {
    if (!payload?.patientId) return;
    const type = payload.type ?? 'PROCEDURE';
    const isMed = type === 'MEDICATION';
    this.journey.emit({
      patientId: payload.patientId,
      eventType: isMed ? 'PRESCRIPTION_ADDED' : 'ORDER_CREATED',
      title: isMed ? '처방 발행' : '검사·처치 오더 발행',
      // 🔴 (2026-09-14) 오더 메모(payload.notes)는 직원 자유 입력 — 환자 노출 유형이라 설명에 싣지 않는다(포털 타임라인에 그대로 나갔다).
      department: JourneyListener.DEPT_BY_TYPE[type] ?? undefined,
      refType: 'Order',
      refId: payload.orderId,
      severity: payload.priority === 'STAT' || payload.priority === 'EMERGENCY' ? 'WARNING' : undefined,
    });
  }

  /** 조제 완료 — 약국 창구 수령 안내의 근거가 되는 여정 지점. */
  @OnEvent('dispensing.completed')
  onDispensed(payload: { dispensingId: string; orderId?: string; patientId?: string }) {
    if (!payload?.patientId) return;
    this.journey.emit({
      patientId: payload.patientId,
      eventType: 'DISPENSED',
      title: '조제 완료',
      department: '약제부',
      refType: 'Dispensing',
      refId: payload.dispensingId,
    });
  }

  /**
   * 치료 오더 완료 — ORDER_COMPLETED.
   * 🔴 검사·영상·약은 각자 결과 여정(LAB_RESULT·IMAGING_RESULT·DISPENSED)이 이미 완료를 말한다 —
   *    같은 사실을 두 줄로 쓰지 않도록 치료(THERAPY)만 남긴다.
   * 발행은 커밋 뒤(order.service·therapy-order.service) — 조회·발행 실패는 warn 으로 남기고 도메인 쓰기는 되돌리지 않는다.
   */
  @OnEvent('order.completed')
  async onOrderCompleted(payload: { orderId: string; department?: string; prescriptionId?: string | null }) {
    if (!payload?.orderId || payload.department !== 'THERAPY') return;
    if (!payload.prescriptionId) {
      this.logger.warn(`journey ORDER_COMPLETED skipped: order ${payload.orderId} has no prescription (patient unknown)`);
      return;
    }
    if (!this.prisma) {
      this.logger.warn(`journey ORDER_COMPLETED skipped: prisma not injected (order ${payload.orderId})`);
      return;
    }
    try {
      const rx = await this.prisma.prescription.findUnique({
        where: { id: payload.prescriptionId },
        select: { encounter: { select: { patientId: true } } },
      });
      const patientId = rx?.encounter?.patientId;
      if (!patientId) {
        this.logger.warn(`journey ORDER_COMPLETED skipped: patient not resolved for order ${payload.orderId}`);
        return;
      }
      this.journey.emit({
        patientId,
        eventType: 'ORDER_COMPLETED',
        title: '치료 시행 완료',
        department: JourneyListener.DEPT_BY_TYPE.THERAPY,
        refType: 'Order',
        refId: payload.orderId,
      });
    } catch (err: unknown) {
      this.logger.warn(`journey ORDER_COMPLETED lookup failed for order ${payload.orderId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 진료비 산정(청구 생성) — BILLING_CREATED.
   * 구독점은 청구가 **실제로 만들어진 뒤** 나가는 `billing.patient_pending`(billing.service.createFromEncounter).
   * 반환값을 내지 않는다 — 같은 이벤트의 환자 푸시 결과 계약(firstPatientPushResult)에 끼어들지 않게.
   * 금액은 넣지 않는다(수납 화면이 정본 — 여정 문장에 박으면 정정 시 낡는다).
   */
  @OnEvent('billing.patient_pending')
  onBillingCreated(payload: { patientId?: string; billingId?: string }): void {
    if (!payload?.patientId || !payload.billingId) return;
    this.journey.emit({
      patientId: payload.patientId,
      eventType: 'BILLING_CREATED',
      title: '진료비 산정',
      department: '원무과',
      refType: 'Billing',
      refId: payload.billingId,
    });
  }

  /** 동의서 철회 — CONSENT_REVOKED. 사유는 싣지 않는다(여정은 환자 포털에 그대로 나간다). */
  @OnEvent('consent.revoked')
  onConsentRevoked(payload: { consentId: string; patientId?: string; templateName?: string | null }): void {
    if (!payload?.patientId) return;
    this.journey.emit({
      patientId: payload.patientId,
      eventType: 'CONSENT_REVOKED',
      title: '동의서 철회',
      description: payload.templateName ? payload.templateName.slice(0, 200) : undefined,
      refType: 'ConsentForm',
      refId: payload.consentId,
    });
  }
}
