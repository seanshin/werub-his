import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { readJitsiEnv, signJitsiToken } from '../../common/jitsi/jitsi-token';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';
import { FormularyGateService } from '../formulary/formulary-gate.service';
import { DurService } from '../prescription/dur/dur.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { getTelehealthDepartmentPolicy, TELEHEALTH_DEPARTMENT_CONFIG_KEY } from '../../common/telehealth-department-policy';
import { buildOrderData, emitOrderCreated } from '../order/order.service';
import { localeDateTimeText, REFUND_LEDGER_METHOD } from '@hospital-run/shared';
import { recordGateViolation } from '../../common/gate-violation-record';

// 비대면 진료 수가 (비급여, 병원 자체 책정)
const FEE_MAP: Record<string, number> = {
  TEXT: 20000,
  RESULT_REVIEW: 30000,
  VIDEO: 40000,
  VIDEO_30: 60000,
  HYBRID: 40000,
};

const REMOTE_CONSENT_TYPE = 'REMOTE_MEDICAL';

@Injectable()
export class RemoteConsultationService {
  private readonly logger = new Logger(RemoteConsultationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly preAuthGate?: PreAuthGateService,
    @Optional() private readonly durService?: DurService,
    @Optional() private readonly runtimeConfig?: ConfigRuntimeService,
    @Optional() private readonly eventEmitter?: EventEmitter2, // order.created 표준 발행(여정·PACS 구독점)
    // 🔴 W8-R3(2026-08-14) — 원내 처방집 시행 게이트. RemoteConsultationModule 이 provider 로 직접
    //    등록하므로 실서비스에선 항상 존재한다. 배선이 빠지면 게이트가 조용히 no-op 이 되므로
    //    가드 스펙(test/formulary/formulary-gate.bypass-paths.spec.ts)이 providers 목록을 검사한다.
    @Optional() private readonly formularyGate?: FormularyGateService,
  ) {}

  /** DUR 게이트 — PrescriptionService.applyDurGate 동일 로직(원격 처방 DUR 우회 봉합). ERROR 시 dur.enforce 모드별 차단/경고 */
  private async applyRemoteDurGate(durWarnings: { type?: string; severity: string; message: string }[], encounterId: string): Promise<void> {
    const errors = durWarnings.filter((w) => w.severity === 'ERROR');
    if (errors.length === 0) return;
    const mode = gateMode(await this.runtimeConfig?.get('dur.enforce'), 'BLOCK');
    const summary = `[REMOTE] ${errors.map((e) => `${e.type}: ${e.message}`).join(' / ')}`.slice(0, 1900);
    const record = (severity: string) => {
      void recordGateViolation(this.prisma, this.logger, {
        gateKey: 'dur.enforce', severity, message: summary, refType: 'ENCOUNTER', refId: encounterId,
      });
    };
    if (mode === 'OFF') { record('OFF'); return; }
    if (mode === 'WARN') { record('WARN'); this.logger.warn(`원격 DUR gate WARN 통과 — ${summary}`); return; }
    record('BLOCK');
    throw new BadRequestException({ code: 'DUR_CHECK_FAILED', message: 'DUR 점검에서 위험 경고가 발생했습니다(비대면).', durWarnings });
  }

  /** 의사에게 알림 (NotificationService 없을 때 무시) */
  private async notifyDoctor(doctorId: string, input: { type: string; title: string; message: string; severity?: string; refId?: string }) {
    try {
      await this.notifications?.create(doctorId, { ...input, refType: 'REMOTE_CONSULT' });
    } catch (e) {
      this.logger.warn(`비대면진료 알림 실패: ${e}`);
    }
  }

  // ════════════════════════════════════════
  // 포털 API (환자용)
  // ════════════════════════════════════════

  /** 내 비대면 진료 목록 */
  async getConsultations(patientId: string) {
    return this.prisma.remoteConsultation.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, sender: true, createdAt: true } },
      },
    });
  }

  /** 비대면 진료 상세 + 메시지 */
  async getConsultationDetail(id: string, patientId: string) {
    const consult = await this.prisma.remoteConsultation.findFirst({
      where: { id, patientId },
      include: {
        doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    return consult;
  }

  /** 비대면 진료 상세 (의사용 — 담당의 본인만) */
  async getDoctorConsultationDetail(id: string, doctorId: string) {
    const consult = await this.prisma.remoteConsultation.findFirst({
      where: { id, doctorId },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    return consult;
  }

  /** 새 상담 요청 (환자) */
  async createConsultation(patientId: string, data: {
    doctorId: string; channel: string; category?: string; subject: string;
    chiefComplaint?: string; symptomDuration?: string; attachments?: unknown;
    priorLabResultId?: string; videoScheduledAt?: string; paymentMethod?: string;
  }) {
    // 0. 첫 이용 동의 게이트 (REMOTE_MEDICAL 동의 필수)
    const consent = await this.getConsentStatus(patientId);
    if (!consent.agreed) {
      throw new ForbiddenException({
        code: 'REMOTE_CONSENT_REQUIRED',
        message: '비대면 진료 첫 이용 동의가 필요합니다',
        action: 'POST /api/v1/portal/remote-consult/consent',
      });
    }

    // 1. 진료과별 비대면 적합성 게이트 (§12.2) + 감염병 유행 모드
    const deptConfig = await this.getDepartmentConfig();
    const doctor = await this.prisma.user.findUnique({ where: { id: data.doctorId }, select: { department: true } });
    if (deptConfig.enabled && doctor?.department && !deptConfig.enabled.includes(doctor.department)) {
      throw new ForbiddenException({
        code: 'DEPT_NOT_ELIGIBLE',
        message: `${doctor.department}는 현재 비대면 진료를 제공하지 않습니다`,
      });
    }

    // 2. 초진/재진 판정 — 해당 의사 1년 이내 대면 진료 이력
    const priorVisit = await this.prisma.encounter.findFirst({
      where: { patientId, doctorId: data.doctorId, status: 'SIGNED', createdAt: { gte: new Date(Date.now() - 365 * 86400000) } },
      select: { id: true },
    });
    const isFirstVisit = !priorVisit;
    // 초진은 화상만 허용 (의료법 비대면 시범사업 지침) — 감염병 유행 모드 시 초진 텍스트도 허용
    if (isFirstVisit && !deptConfig.infectiousMode && (data.channel === 'TEXT' || data.channel === 'RESULT_REVIEW')) {
      throw new ForbiddenException({
        code: 'FIRST_VISIT_VIDEO_ONLY',
        message: '초진(최근 1년 내 대면 진료 이력 없음)은 화상 진료만 가능합니다',
      });
    }

    // 3. 수가 결정
    const feeAmount = FEE_MAP[data.channel] ?? 20000;

    // 퇴원 7일 이내 무료 상담 체크
    const recentDischarge = await this.prisma.admission.findFirst({
      where: { patientId, status: 'DISCHARGED', dischargeDate: { gte: new Date(Date.now() - 7 * 86400000) } },
    });
    const existingFree = recentDischarge ? await this.prisma.remoteConsultation.count({
      where: { patientId, isFreeConsult: true, createdAt: { gte: recentDischarge.dischargeDate! } },
    }) : 1;
    const isFree = !!recentDischarge && existingFree === 0;

    const consult = await this.prisma.remoteConsultation.create({
      data: {
        patientId,
        doctorId: data.doctorId,
        channel: data.channel,
        category: data.category,
        subject: data.subject,
        chiefComplaint: data.chiefComplaint,
        symptomDuration: data.symptomDuration,
        attachments: data.attachments as any,
        priorLabResultId: data.priorLabResultId,
        videoScheduledAt: data.videoScheduledAt ? new Date(data.videoScheduledAt) : undefined,
        consultationType: data.channel === 'VIDEO' ? 'VIDEO_15' : data.channel === 'RESULT_REVIEW' ? 'LAB_INTERPRET' : 'BASIC',
        feeAmount: isFree ? 0 : feeAmount,
        billingStatus: isFree ? 'WAIVED' : 'PENDING',
        paymentMethod: data.paymentMethod ?? consent.paymentMethod ?? undefined,
        isFreeConsult: isFree,
        messageCount: 1,
        lastMessageAt: new Date(),
      },
      include: { doctor: { select: { id: true, familyName: true, givenName: true, department: true } } },
    });

    // 첫 메시지 생성
    if (data.chiefComplaint) {
      await this.prisma.consultationMessage.create({
        data: {
          consultationId: consult.id,
          sender: 'PATIENT',
          senderId: patientId,
          content: data.chiefComplaint,
          attachments: data.attachments as any,
          sharedLabResultId: data.priorLabResultId,
        },
      });
    }

    // 의사 알림
    await this.notifyDoctor(data.doctorId, {
      type: 'REMOTE_CONSULT_NEW',
      title: '새 비대면 진료 요청',
      message: `${data.channel === 'VIDEO' ? '화상' : data.channel === 'RESULT_REVIEW' ? '결과설명' : '텍스트'} 상담: ${data.subject}`,
      severity: data.channel === 'VIDEO' ? 'WARNING' : 'INFO',
      refId: consult.id,
    });

    return consult;
  }

  /** 환자 메시지 전송 */
  async sendMessage(consultationId: string, patientId: string, data: { content: string; attachments?: unknown }) {
    const consult = await this.prisma.remoteConsultation.findFirst({ where: { id: consultationId, patientId } });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    if (consult.status === 'COMPLETED' || consult.status === 'CANCELLED') throw new ForbiddenException('종료된 상담입니다');
    // 7일 유효기간 / 메시지 횟수 제한 (§12.4)
    await this.enforceConsultLimits(consult, 'PATIENT');

    const msg = await this.prisma.consultationMessage.create({
      data: {
        consultationId,
        sender: 'PATIENT',
        senderId: patientId,
        content: data.content,
        attachments: data.attachments as any,
      },
    });

    await this.prisma.remoteConsultation.update({
      where: { id: consultationId },
      data: { messageCount: { increment: 1 }, lastMessageAt: new Date(),  },
    });

    // 의사 알림 (환자 추가 메시지)
    await this.notifyDoctor(consult.doctorId, {
      type: 'REMOTE_CONSULT_MSG',
      title: '비대면 진료 환자 메시지',
      message: `${consult.subject}: ${data.content.slice(0, 40)}`,
      refId: consultationId,
    });

    return msg;
  }

  /** 메시지 가능 의사 목록 (최근 진료 의사) */
  async getAvailableDoctors(patientId: string) {
    const encounters = await this.prisma.encounter.findMany({
      where: { patientId, status: 'SIGNED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { doctor: { select: { id: true, familyName: true, givenName: true, department: true } }, createdAt: true },
    });
    const seen = new Set<string>();
    return encounters
      .filter((e: any) => e.doctor && !seen.has(e.doctor.id) && seen.add(e.doctor.id))
      .map((e: any) => ({ ...e.doctor, lastVisit: e.createdAt }));
  }

  // ════════════════════════════════════════
  // HIS API (의사용)
  // ════════════════════════════════════════

  /** 의사의 미답변 + 진행중 상담 목록 */
  async getDoctorConsultations(doctorId: string, status?: string) {
    const where: any = { doctorId };
    if (status === 'pending') where.status = { in: ['REQUESTED', 'ACCEPTED'] };
    else if (status === 'active') where.status = 'IN_PROGRESS';
    else if (status === 'completed') where.status = 'COMPLETED';

    return this.prisma.remoteConsultation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, sender: true, createdAt: true } },
      },
    });
  }

  /** 환자별 상담 목록 (환자 차트 내) */
  async getPatientConsultations(patientId: string, doctorId?: string) {
    const where: any = { patientId };
    if (doctorId) where.doctorId = doctorId;
    return this.prisma.remoteConsultation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  /** 의사 답변 */
  async doctorReply(consultationId: string, doctorId: string, data: {
    content: string; attachments?: unknown; isMedicalAdvice?: boolean;
    sharedLabResultId?: string; sharedImagingId?: string; sharedPrescriptionId?: string;
    assessment?: string; plan?: string; isSimpleInquiry?: boolean;
  }) {
    const consult = await this.prisma.remoteConsultation.findFirst({ where: { id: consultationId, doctorId } });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    if (consult.status === 'COMPLETED' || consult.status === 'CANCELLED') throw new BadRequestException('종료된 상담입니다');
    // 7일 유효기간 / 메시지 횟수 제한 (§12.4)
    await this.enforceConsultLimits(consult, 'DOCTOR');

    const msg = await this.prisma.consultationMessage.create({
      data: {
        consultationId,
        sender: 'DOCTOR',
        senderId: doctorId,
        content: data.content,
        attachments: data.attachments as any,
        isMedicalAdvice: data.isMedicalAdvice ?? true,
        sharedLabResultId: data.sharedLabResultId,
        sharedImagingId: data.sharedImagingId,
        sharedPrescriptionId: data.sharedPrescriptionId,
      },
    });

    // 상담 상태 업데이트
    const updateData: any = {
      status: 'IN_PROGRESS',
      messageCount: { increment: 1 },
      lastMessageAt: new Date(),
      doctorRepliedAt: consult.doctorRepliedAt ?? new Date(),
    };
    if (data.assessment) updateData.doctorAssessment = data.assessment;
    if (data.plan) updateData.doctorPlan = data.plan;

    // 단순 문의 재분류 → 무료
    if (data.isSimpleInquiry) {
      updateData.consultationType = 'SIMPLE_INQUIRY';
      updateData.feeAmount = 0;
      updateData.billingStatus = 'WAIVED';
      updateData.isFreeConsult = true;
    }

    await this.prisma.remoteConsultation.update({ where: { id: consultationId }, data: updateData });

    return msg;
  }

  /** 비대면 진료 → Encounter 생성 + 처방 발행 */
  async createPrescription(consultationId: string, doctorId: string, data: {
    medications: { medicationCodeId: string; dosage: string; frequency: string; duration: number; quantity: number; route: string; instructions?: string }[];
    dispensingType?: string; // INTERNAL | EXTERNAL (default EXTERNAL for remote)
  }) {
    const consult = await this.prisma.remoteConsultation.findFirst({
      where: { id: consultationId, doctorId },
      include: { patient: { select: { id: true } } },
    });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');

    // 1. Encounter 자동 생성 (없으면)
    let encounterId = consult.encounterId;
    if (!encounterId) {
      // 🔴 (2026-09-16 F3) 진료(Encounter) 생성과 연결 표시는 한 트랜잭션 — 따로 커밋하면 연결이 실패했을 때
      //    **주인 없는 진료가 남고** 비대면 진료는 여전히 미연결이라, 다시 부르면 또 하나가 생긴다(중복 진료).
      const encounter = await this.prisma.$transaction(async (tx) => {
        const created = await tx.encounter.create({
          data: {
            patientId: consult.patientId,
            doctorId,
            status: 'DRAFT',
            chiefComplaint: consult.subject,
            assessment: consult.doctorAssessment,
            plan: consult.doctorPlan,
            visitType: 'REMOTE',
          },
        });
        await tx.remoteConsultation.update({ where: { id: consultationId }, data: { encounterId: created.id } });
        return created;
      });
      encounterId = encounter.id;
    }

    // 2. 처방 생성
    const prescriptions = [];
    for (const med of data.medications) {
      // DUR 점검 — 상호작용·중복·용량·알레르기(원격 처방 DUR 우회 봉합·대면과 동일 게이트). tx 밖 호출(차단 롤백에도 위반기록 보존)
      if (this.durService) {
        const durWarnings = await this.durService.checkInteractions(
          encounterId, med.medicationCodeId, consult.patientId,
          { dosage: med.dosage, frequency: med.frequency },
        );
        await this.applyRemoteDurGate(durWarnings as never[], encounterId);
      }
      // 🔴 W8-R3(2026-08-14) 원내 처방집 게이트 — 비대면 처방도 PrescriptionService 를 거치지 않고
      //    prisma.prescription.create 를 직접 부르는 우회로였다(W8-R2 는 처방 서비스 3경로만 배선).
      //    판정은 새로 만들지 않고 정본 FormularyGateService.assertOrderAllowed 를 그대로 부르며,
      //    호출 순서도 정본(prescription.service)과 동일하게 **DUR 뒤·사전승인 앞**이다.
      //    tx 밖 호출이라 차단(BLOCK) 시에도 GateViolationLog 는 남는다.
      await this.formularyGate?.assertOrderAllowed(
        { type: 'MEDICATION', medicationCodeId: med.medicationCodeId },
        { encounterId, path: 'CREATE' },
      );
      // 사전승인 게이트 — 비대면 마약류 처방 발행 전 결재(F3 우회 차단·원격 마약류 처방 방지). 게이트 OFF 시 no-op.
      await this.preAuthGate?.assertOrderGate(
        { type: 'MEDICATION', medicationCodeId: med.medicationCodeId, priority: 'ROUTINE' },
        { patientId: consult.patientId, encounterId, requestedByUserId: doctorId, draft: { consultationId } },
      );
      /**
       * 🔴 (2026-09-16 F3) 처방과 약국 오더는 **한 트랜잭션**이다(약 1건 단위).
       *    종전엔 처방을 먼저 커밋해서, 오더 생성이 실패하면 **처방은 났는데 약국 큐에 뜨지 않는**
       *    반쪽 상태가 남았다 — 환자는 처방받았다고 알고 약국은 그 처방을 영원히 보지 못한다.
       *    DUR·처방집·사전승인 게이트는 위에서 tx 밖에 끝냈다(차단돼도 위반 원장은 남는다).
       */
      const { rx, order } = await this.prisma.$transaction(async (tx) => {
      const rx = await tx.prescription.create({
        data: {
          encounterId,
          type: 'MEDICATION',
          medicationCodeId: med.medicationCodeId,
          dosage: med.dosage,
          frequency: med.frequency,
          duration: med.duration,
          quantity: med.quantity,
          route: med.route,
          instructions: med.instructions,
          dispensingType: data.dispensingType ?? 'EXTERNAL',
          rxValidUntil: new Date(Date.now() + 3 * 86400000), // 3일 유효
          source: 'REMOTE',
          priority: 'ROUTINE',
          createdBy: doctorId,
          prescriberId: doctorId, // 비대면 진료 의사가 책임 처방의
        },
        include: { medicationCode: { select: { nameKo: true, code: true } } },
      });

      // 3. 약국 오더 자동 생성 — 정본 게이트웨이 경유(인라인 필드 조립 금지·department/status/pharmacyType 일원화)
      const order = await tx.order.create({
        data: buildOrderData({
          prescriptionId: rx.id,
          type: 'MEDICATION',
          priority: 'ROUTINE',
          dispensingType: data.dispensingType ?? 'EXTERNAL',
        }),
      });
      return { rx, order };
      });
      // 🔴 종전 미발행 → 여정(PRESCRIPTION_ADDED)·후속 구독자 미발동. 표준 발행으로 균일화.
      //    발행은 **커밋 뒤**다(롤백된 오더를 구독자가 먼저 보지 않게).
      if (this.eventEmitter) emitOrderCreated(this.eventEmitter, {
        orderId: order.id,
        type: 'MEDICATION',
        patientId: consult.patientId,
        encounterId,
        priority: 'ROUTINE',
      });

      prescriptions.push(rx);
    }

    // 4. 환자에게 시스템 메시지
    const rxNames = prescriptions.map(rx => rx.medicationCode?.nameKo ?? '약품').join(', ');
    await this.prisma.consultationMessage.create({
      data: {
        consultationId,
        sender: 'SYSTEM',
        content: `처방전이 발행되었습니다: ${rxNames}\n처방전 유효기간: 3일\n가까운 약국에서 수령하세요.`,
        sharedPrescriptionId: prescriptions[0]?.id,
      },
    });

    return { encounterId, prescriptions };
  }

  /** 비대면 진료의 처방 목록 조회 (호출자 소유권 검증) */
  async getPrescriptions(consultationId: string, owner: { doctorId?: string; patientId?: string }) {
    const where: any = { id: consultationId };
    if (owner.doctorId) where.doctorId = owner.doctorId;
    if (owner.patientId) where.patientId = owner.patientId;
    const consult = await this.prisma.remoteConsultation.findFirst({
      where,
      select: { encounterId: true },
    });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    if (!consult.encounterId) return [];

    return this.prisma.prescription.findMany({
      where: { encounterId: consult.encounterId, type: 'MEDICATION', status: 'ACTIVE' },
      include: { medicationCode: { select: { nameKo: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 의사가 상담 종료 (→ Encounter 생성 + 수납 확정) */
  async completeConsultation(consultationId: string, doctorId: string, data?: {
    assessment?: string; plan?: string; linkToEncounter?: boolean;
  }) {
    const consult = await this.prisma.remoteConsultation.findFirst({ where: { id: consultationId, doctorId } });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    if (consult.status === 'COMPLETED') throw new BadRequestException('이미 종료된 상담입니다');

    const assessment = data?.assessment ?? consult.doctorAssessment;
    const plan = data?.plan ?? consult.doctorPlan;

    // 원격진료 완료는 진료기록(의료법 §22)·청구·상담 상태가 함께 성립해야 한다 —
    // 부분 성공 시 청구만 남고 진료기록이 없거나, 상담은 완료인데 정산이 빠진 상태가 된다.
    // (2026-07 트랜잭션 경계 전수)
    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. Encounter 자동 생성/연동 (진료 기록 보존 — 의료법 제22조)
      let encounterId = consult.encounterId;
      if (!encounterId) {
        const encounter = await tx.encounter.create({
          data: {
            patientId: consult.patientId,
            doctorId,
            visitType: 'REMOTE',
            chiefComplaint: consult.subject,
            subjective: consult.chiefComplaint ?? '',
            objective: `비대면 진료 (${consult.channel === 'VIDEO' ? '화상' : consult.channel === 'RESULT_REVIEW' ? '결과설명' : '텍스트'}, 메시지 ${consult.messageCount}건)`,
            assessment: assessment ?? '',
            plan: plan ?? '',
            status: 'SIGNED',
            signedAt: new Date(),
            signedBy: doctorId,
          },
        });
        encounterId = encounter.id;
      }

      // 2. Billing 생성 (비급여 → 전액 본인부담)
      let billingId = consult.billingId;
      if (!consult.isFreeConsult && !billingId && encounterId) {
        const fee = consult.feeAmount ?? 0;
        const existing = await tx.billing.findUnique({ where: { encounterId } });
        const billing = existing ?? await tx.billing.create({
          data: {
            encounterId,
            patientId: consult.patientId,
            totalAmount: fee,
            insuranceCovered: 0,          // 비대면 진료는 비급여
            patientCopay: fee,
            status: consult.paymentMethod === 'DEFERRED' ? 'DEFERRED' : 'PENDING',
            paymentMethod: consult.paymentMethod ?? undefined,
            deferredReason: consult.paymentMethod === 'DEFERRED' ? '비대면 진료 후불 정산 (다음 방문 시)' : undefined,
          },
        });
        billingId = billing.id;
      }

      const updateData: any = {
        status: 'COMPLETED',
        completedAt: new Date(),
        encounterId,
        doctorAssessment: assessment,
        doctorPlan: plan,
      };
      if (billingId) updateData.billingId = billingId;
      if (!consult.isFreeConsult && consult.billingStatus === 'PENDING') {
        updateData.billingStatus = 'CONFIRMED';
      }

      const updated = await tx.remoteConsultation.update({ where: { id: consultationId }, data: updateData });

      // 시스템 메시지
      await tx.consultationMessage.create({
        data: {
          consultationId,
          sender: 'SYSTEM',
          content: consult.isFreeConsult
            ? '상담이 종료되었습니다.'
            : `상담이 종료되었습니다. 상담료 ${(consult.feeAmount ?? 0).toLocaleString()}원이 청구되었습니다. 포털에서 결제해주세요.`,
        },
      });
      return updated;
    });

    return updated;
  }

  /** 의사 주도 안내 발송 (무료) */
  async initiateConsultation(doctorId: string, data: {
    patientId: string; subject: string; content: string; category: string;
    sharedLabResultId?: string; sharedImagingId?: string;
  }) {
    const consult = await this.prisma.remoteConsultation.create({
      data: {
        patientId: data.patientId,
        doctorId,
        channel: 'TEXT',
        category: data.category,
        subject: data.subject,
        status: 'IN_PROGRESS',
        consultationType: 'DOCTOR_INITIATED',
        feeAmount: 0,
        billingStatus: 'WAIVED',
        isFreeConsult: true,
        messageCount: 1,
        lastMessageAt: new Date(),
        doctorRepliedAt: new Date(),
      },
    });

    await this.prisma.consultationMessage.create({
      data: {
        consultationId: consult.id,
        sender: 'DOCTOR',
        senderId: doctorId,
        content: data.content,
        isMedicalAdvice: true,
        sharedLabResultId: data.sharedLabResultId,
        sharedImagingId: data.sharedImagingId,
      },
    });

    return consult;
  }

  /** 의사 대시보드 통계 */
  async getDoctorStats(doctorId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [pending, active, completedMonth, totalRevenue] = await Promise.all([
      this.prisma.remoteConsultation.count({ where: { doctorId, status: { in: ['REQUESTED', 'ACCEPTED'] } } }),
      this.prisma.remoteConsultation.count({ where: { doctorId, status: 'IN_PROGRESS' } }),
      this.prisma.remoteConsultation.count({ where: { doctorId, status: 'COMPLETED', completedAt: { gte: monthStart } } }),
      this.prisma.remoteConsultation.aggregate({
        where: { doctorId, status: 'COMPLETED', completedAt: { gte: monthStart }, isFreeConsult: false },
        _sum: { feeAmount: true },
      }),
    ]);

    // 평균 응답 시간
    const repliedConsults = await this.prisma.remoteConsultation.findMany({
      where: { doctorId, doctorRepliedAt: { not: null }, completedAt: { gte: monthStart } },
      select: { createdAt: true, doctorRepliedAt: true },
    });
    // 🔴 표본 0 은 '산출 불가'(null)다 — 0분·100% 로 채우면 실적이 하나도 없는데
    //    "즉시 응답·전건 준수"로 읽힌다(P1-ⓐ). 표본 부재를 성적으로 바꾸지 않는다.
    const avgResponseHours = repliedConsults.length > 0
      ? repliedConsults.reduce((sum: number, c: any) => sum + (c.doctorRepliedAt!.getTime() - c.createdAt.getTime()) / 3600000, 0) / repliedConsults.length
      : null;
    // SLA 준수율 — 24시간 내 첫 답변 비율
    const within24h = repliedConsults.filter((c: any) => (c.doctorRepliedAt!.getTime() - c.createdAt.getTime()) <= 24 * 3600000).length;
    const slaComplianceRate = repliedConsults.length > 0 ? Math.round((within24h / repliedConsults.length) * 100) : null;

    const revenue = Number(totalRevenue._sum.feeAmount ?? 0);
    const doctorIncentive = Math.round(revenue * 0.7);  // §12.6 의사 70%
    return {
      pending,
      active,
      completedMonth,
      totalRevenue: revenue,
      doctorIncentive,                    // 의사 인센티브 (70%)
      hospitalShare: revenue - doctorIncentive, // 병원 (30%)
      avgResponseHours: avgResponseHours == null ? null : Math.round(avgResponseHours * 10) / 10,
      slaComplianceRate,
      /**
       * 🔴 준수율의 분자·분모 — 내부에만 있던 `within24h / repliedConsults.length` 를 그대로 낸다.
       *    "SLA 100%"가 1건 중 1건인지 40건 중 40건인지 화면이 말할 수 있어야 한다.
       */
      slaNumerator: within24h,
      slaDenominator: repliedConsults.length,
    };
  }

  // ════════════════════════════════════════
  // 진료과 설정 + 시간/횟수 제한 (§12.2, §12.4)
  // ════════════════════════════════════════

  /** 진료과별 비대면 가능 설정 조회 (없으면 전체 허용) — 정본 common/telehealth-department-policy */
  async getDepartmentConfig(): Promise<{ enabled: string[] | null; infectiousMode: boolean }> {
    return getTelehealthDepartmentPolicy(this.prisma);
  }

  /** 진료과별 비대면 가능 설정 변경 (ADMIN) */
  async setDepartmentConfig(data: { enabled: string[] | null; infectiousMode?: boolean }, updatedBy?: string) {
    return this.prisma.systemConfig.upsert({
      where: { key: TELEHEALTH_DEPARTMENT_CONFIG_KEY },
      create: { key: TELEHEALTH_DEPARTMENT_CONFIG_KEY, value: data as any, category: 'clinical', label: '비대면 진료 가능 진료과', updatedBy },
      update: { value: data as any, updatedBy },
    });
  }

  /** 7일 유효기간 + 메시지 횟수 제한 검증 (§12.4) */
  private async enforceConsultLimits(consult: { id: string; createdAt: Date; channel: string }, sender: 'PATIENT' | 'DOCTOR') {
    // 텍스트/하이브리드 상담 7일 유효기간
    if ((consult.channel === 'TEXT' || consult.channel === 'RESULT_REVIEW' || consult.channel === 'HYBRID')
        && (Date.now() - consult.createdAt.getTime()) > 7 * 86400000) {
      throw new BadRequestException('상담 유효기간(7일)이 지났습니다. 새 상담을 시작해주세요.');
    }
    // 발신자별 메시지 10회 제한 (환자 10 + 의사 10 = 최대 20)
    const count = await this.prisma.consultationMessage.count({ where: { consultationId: consult.id, sender } });
    if (count >= 10) {
      throw new BadRequestException(`${sender === 'PATIENT' ? '환자' : '의사'} 메시지 횟수(10회)를 초과했습니다. 새 상담을 시작해주세요.`);
    }
  }

  // ════════════════════════════════════════
  // 첫 이용 동의 (REMOTE_MEDICAL)
  // ════════════════════════════════════════

  /** 비대면 진료 첫 이용 동의 상태 조회 */
  async getConsentStatus(patientId: string) {
    const consent = await this.prisma.registrationConsent.findFirst({
      where: { patientId, type: REMOTE_CONSENT_TYPE, agreed: true, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const valid = !!consent && (!consent.expiresAt || consent.expiresAt > new Date());
    // 등록 결제수단은 동의 시점에 signatureData 메타로 저장 (간이) — 별도 카드 보관은 PG 연동 시
    let paymentMethod: string | null = null;
    if (consent?.signMethod && consent.signMethod.startsWith('PORTAL:')) {
      paymentMethod = consent.signMethod.split(':')[1] || null;
    }
    return { agreed: valid, signedAt: consent?.signedAt ?? null, version: consent?.version ?? null, paymentMethod };
  }

  /** 비대면 진료 첫 이용 동의 제출 (4단계: 안내→수가→서명→결제수단) */
  async submitConsent(patientId: string, data: {
    remoteService: boolean; feeAgreement: boolean; healthInfoConsent: boolean;
    recordRetention: boolean; videoRecording?: boolean;
    signatureData?: string; paymentMethod?: string; ipAddress?: string;
  }) {
    // 필수 항목 검증
    if (!data.remoteService || !data.feeAgreement || !data.healthInfoConsent || !data.recordRetention) {
      throw new BadRequestException('필수 동의 항목에 모두 동의해야 합니다');
    }
    const version = '1.0';
    const pm = data.paymentMethod ?? 'CARD';
    const consent = await this.prisma.registrationConsent.upsert({
      where: { patientId_type_version: { patientId, type: REMOTE_CONSENT_TYPE, version } },
      create: {
        patientId,
        type: REMOTE_CONSENT_TYPE,
        version,
        agreed: true,
        signedAt: new Date(),
        signMethod: `PORTAL:${pm}`,
        signatureData: data.signatureData,
        expiresAt: new Date(Date.now() + 365 * 86400000), // 1년
        ipAddress: data.ipAddress,
      },
      update: {
        agreed: true,
        signedAt: new Date(),
        signMethod: `PORTAL:${pm}`,
        signatureData: data.signatureData,
        revokedAt: null,
        revokedReason: null,
        expiresAt: new Date(Date.now() + 365 * 86400000),
        ipAddress: data.ipAddress,
      },
    });
    return { id: consent.id, agreed: true, signedAt: consent.signedAt, paymentMethod: pm };
  }

  // ════════════════════════════════════════
  // 수납 (결제 / 취소 / 환불)
  // ════════════════════════════════════════

  /**
   * 환자 결제 (포털).
   * 🔴 (2026-10-14 수납·청구 결함 발굴 P3-1) 종전엔 카드를 고르면 **결제 승인 없이** 청구를 PAID·납부액 = 상담료로 적었다
   *   . 카드·카카오페이 결제를 승인받을 연동(PG)이 이 저장소에 없다 — 결제했다고 적지 않고 거부한다
   *    (키오스크 수납과 같은 원칙). 후불 정산은 사실 그대로 '창구에서 낼 돈'으로 남긴다(청구 보류 · 상담은 결제 대기 그대로).
   */
  async payConsultation(consultationId: string, patientId: string, data: { paymentMethod: string }) {
    const consult = await this.prisma.remoteConsultation.findFirst({ where: { id: consultationId, patientId } });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    if (consult.isFreeConsult) return { paid: true, message: '무료 상담입니다' };
    if (consult.billingStatus === 'PAID') throw new BadRequestException('이미 결제되었습니다');
    if (consult.billingStatus !== 'CONFIRMED') throw new BadRequestException('상담 종료 후 결제할 수 있습니다');
    if (data.paymentMethod !== 'DEFERRED') {
      throw new ConflictException({
        code: 'ONLINE_PAYMENT_NOT_AVAILABLE',
        message: '온라인 결제(카드·카카오페이) 승인 연동이 없어 결제하지 않았습니다 — 후불 정산을 고르거나 병원 창구에서 수납하세요',
        details: { paymentMethod: data.paymentMethod, charged: false },
      });
    }
    // 후불 — 청구는 열린 상태(미납·보류)일 때만 보류로 · 상담은 결제 대기 그대로 + 고른 방법만 남긴다
    const updated = await this.prisma.$transaction(async (tx) => {
      if (consult.billingId) {
        await tx.billing.updateMany({
          where: { id: consult.billingId, status: { in: ['PENDING', 'DEFERRED'] } },
          data: { status: 'DEFERRED', deferredReason: '비대면 진료 후불 정산(환자 선택)' },
        });
      }
      return tx.remoteConsultation.update({ where: { id: consultationId }, data: { paymentMethod: 'DEFERRED' } });
    });
    return { paid: false, deferred: true, billingStatus: updated.billingStatus, paymentMethod: 'DEFERRED' };
  }

  /** 환자 상담 취소 (답변 전 전액 환불) */
  async cancelConsultation(consultationId: string, patientId: string, reason?: string) {
    const consult = await this.prisma.remoteConsultation.findFirst({ where: { id: consultationId, patientId } });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    if (consult.status === 'COMPLETED') throw new BadRequestException('종료된 상담은 취소할 수 없습니다');
    if (consult.doctorRepliedAt) throw new BadRequestException('의사 답변 후에는 취소(환불)가 불가합니다');

    const r = await this.refundAndCancel(consult.id, consult.billingId, reason ?? '환자 취소 (답변 전)');
    await this.notifyDoctor(consult.doctorId, {
      type: 'REMOTE_CONSULT_CANCEL', title: '비대면 진료 취소', message: `${consult.subject} 상담이 환자에 의해 취소되었습니다`, refId: consult.id,
    });
    // 🔴 (P3-1) 종전 `refunded: !isFreeConsult` — 결제 전(대부분 · 결제는 상담 종료 뒤)에도 '환불'이라 말했다
    return { cancelled: r.done, refunded: r.refundedAmount > 0, refundedAmount: r.refundedAmount };
  }

  /**
   * 환불 + 취소 처리 (공통).
   * 🔴 (P3-1) 종전엔 결제가 있었는지 보지 않고 상담 = REFUNDED·청구 = REFUNDED(환불액 없음 — 일마감 환불 집계에도 안 잡힘)로 적었다.
   *    받은 돈이 있으면 그만큼 환불(청구 refundAmount + 수납 원장 환불 줄 — 일마감 정본) · 없으면 취소(환불할 돈 없음).
   */
  private async refundAndCancel(consultationId: string, billingId: string | null, reason: string): Promise<{ done: boolean; refundedAmount: number }> {
    // 환불(billing) + 취소(consultation)를 원자적으로 처리 — 멱등성 보장(이미 취소면 0건 처리)
    const result = await this.prisma.$transaction(async (tx) => {
      const billing = billingId ? await tx.billing.findUnique({ where: { id: billingId }, select: { status: true, paidAmount: true, refundAmount: true } }) : null;
      const refundable = billing && billing.status !== 'REFUNDED' && billing.status !== 'CANCELLED' ? Math.max(0, (billing.paidAmount ?? 0) - (billing.refundAmount ?? 0)) : 0;
      // 멱등 가드: 아직 취소되지 않은 건만 처리 (동시 실행/재실행 시 1회만 성공)
      const updated = await tx.remoteConsultation.updateMany({
        where: { id: consultationId, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
        data: { status: 'CANCELLED', billingStatus: refundable > 0 ? 'REFUNDED' : 'CANCELLED', completedAt: new Date() },
      });
      if (updated.count === 0) return { done: false, refundedAmount: 0 }; // 이미 처리됨
      if (billingId && billing) {
        const now = new Date();
        if (refundable > 0) {
          const r = await tx.billing.updateMany({
            where: { id: billingId, status: billing.status, refundAmount: billing.refundAmount },
            data: { status: 'REFUNDED', refundAmount: (billing.refundAmount ?? 0) + refundable, refundedAt: now, refundReason: reason },
          });
          if (r.count === 0) throw new ConflictException({ code: 'BILLING_CHANGED', message: '다른 처리로 수납 상태가 바뀌었습니다 — 다시 시도하세요' });
          await tx.billingPayment.create({ data: { billingId, method: REFUND_LEDGER_METHOD, amount: -refundable } });
        } else {
          await tx.billing.updateMany({ where: { id: billingId, status: { in: ['PENDING', 'DEFERRED'] } }, data: { status: 'CANCELLED' } });
        }
      }
      return { done: true, refundedAmount: refundable };
    });
    if (result.done) {
      await this.prisma.consultationMessage.create({
        data: { consultationId, sender: 'SYSTEM', content: `상담이 취소되었습니다. (${reason})` },
      }).catch(() => undefined);
    }
    return result;
  }

  /** 환자 만족도 평가 */
  async rateConsultation(consultationId: string, patientId: string, data: { rating: number; feedback?: string }) {
    const consult = await this.prisma.remoteConsultation.findFirst({ where: { id: consultationId, patientId } });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    return this.prisma.remoteConsultation.update({
      where: { id: consultationId },
      data: { patientRating: Math.max(1, Math.min(5, data.rating)), patientFeedback: data.feedback },
    });
  }

  // ════════════════════════════════════════
  // 화상 전환 (텍스트 → 화상)
  // ════════════════════════════════════════

  /** 화상 전환 요청/제안 (환자 또는 의사) */
  async requestVideoEscalation(consultationId: string, by: 'PATIENT' | 'DOCTOR', actorId: string, scheduledAt?: string) {
    const where: any = { id: consultationId };
    if (by === 'PATIENT') where.patientId = actorId; else where.doctorId = actorId;
    const consult = await this.prisma.remoteConsultation.findFirst({ where });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    if (consult.status === 'COMPLETED' || consult.status === 'CANCELLED') throw new BadRequestException('종료된 상담입니다');

    await this.prisma.remoteConsultation.update({
      where: { id: consultationId },
      data: {
        videoRequestedBy: by,
        videoRequestedAt: new Date(),
        videoScheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      },
    });
    await this.prisma.consultationMessage.create({
      data: {
        consultationId, sender: 'SYSTEM',
        content: `${by === 'PATIENT' ? '환자' : '의사'}가 화상 진료 전환을 ${by === 'PATIENT' ? '요청' : '제안'}했습니다.${scheduledAt ? ` (희망: ${localeDateTimeText(new Date(scheduledAt), 'ko-KR')})` : ''}`,
      },
    });
    if (by === 'PATIENT') {
      await this.notifyDoctor(consult.doctorId, {
        type: 'REMOTE_VIDEO_REQUEST', title: '화상 전환 요청', message: `${consult.subject}: 환자가 화상 진료를 요청했습니다`, severity: 'WARNING', refId: consult.id,
      });
    }
    return { requested: true, by };
  }

  /** 화상 전환 수락 → Jitsi roomId 생성 + 수가 업그레이드 */
  async acceptVideoEscalation(consultationId: string, actorId: string, role: 'PATIENT' | 'DOCTOR') {
    const where: any = { id: consultationId };
    if (role === 'PATIENT') where.patientId = actorId; else where.doctorId = actorId;
    const consult = await this.prisma.remoteConsultation.findFirst({ where });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    if (!consult.videoRequestedBy) throw new BadRequestException('화상 전환 요청이 없습니다');

    const roomId = consult.videoRoomId ?? `rc-${randomBytes(8).toString('hex')}`;
    // 수가 업그레이드 (텍스트 20K → 화상 40K) — 미결제 상태에서만
    const upgradeFee = !consult.isFreeConsult && (consult.feeAmount ?? 0) < FEE_MAP.VIDEO;
    await this.prisma.remoteConsultation.update({
      where: { id: consultationId },
      data: {
        channel: 'HYBRID',
        videoRoomId: roomId,
        videoScheduledAt: consult.videoScheduledAt ?? new Date(),
        ...(upgradeFee ? { feeAmount: FEE_MAP.VIDEO, consultationType: 'VIDEO_15' } : {}),
      },
    });
    await this.prisma.consultationMessage.create({
      data: {
        consultationId, sender: 'SYSTEM',
        content: `화상 진료 전환이 수락되었습니다.${upgradeFee ? ` 화상 진료 수가(${FEE_MAP.VIDEO.toLocaleString()}원)가 적용됩니다.` : ''} 대기실에서 장비를 점검하고 입장하세요.`,
      },
    });
    return { roomId, channel: 'HYBRID', feeUpgraded: upgradeFee };
  }

  /** 화상 진료 Jitsi 토큰 발급 (환자/의사) */
  async getVideoToken(consultationId: string, actorId: string, role: 'PATIENT' | 'DOCTOR') {
    const where: any = { id: consultationId };
    if (role === 'PATIENT') where.patientId = actorId; else where.doctorId = actorId;
    const consult = await this.prisma.remoteConsultation.findFirst({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true } },
        doctor: { select: { familyName: true, givenName: true, email: true } },
      },
    });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    if (!consult.videoRoomId) throw new BadRequestException('화상 세션이 생성되지 않았습니다');
    if (consult.status === 'COMPLETED' || consult.status === 'CANCELLED' || consult.videoEndedAt) {
      throw new BadRequestException('종료된 화상 진료입니다');
    }

    // 🔴 서명 정본 `common/jitsi/jitsi-token.ts`(2026-09-21 · P12 — 종전엔 여기 인라인 `jwt.sign` 이 세 번째 사본이었다)
    const env = readJitsiEnv({ get: (k) => this.config.get<string>(k) });
    if (!env) {
      this.logger.error('JITSI_JWT_SECRET 미설정');
      throw new BadRequestException('화상 진료를 일시적으로 이용할 수 없습니다');
    }
    const isDoctor = role === 'DOCTOR';
    const userName = isDoctor
      ? `${consult.doctor.familyName}${consult.doctor.givenName}`
      : `${consult.patient.familyName}${consult.patient.givenName} (환자)`;

    // 화상 시작 시각 기록
    if (!consult.videoStartedAt) {
      await this.prisma.remoteConsultation.update({ where: { id: consultationId }, data: { videoStartedAt: new Date(), status: 'IN_PROGRESS' } });
    }

    const token = signJitsiToken(env, {
      roomName: consult.videoRoomId,
      userName,
      userId: actorId,
      email: isDoctor ? consult.doctor.email || '' : '',
      isModerator: isDoctor,
    });
    return { token, roomId: consult.videoRoomId, domain: env.domain, isModerator: isDoctor };
  }

  /** 화상 종료 (진료 시간 기록) */
  async endVideo(consultationId: string, doctorId: string) {
    const consult = await this.prisma.remoteConsultation.findFirst({ where: { id: consultationId, doctorId } });
    if (!consult) throw new NotFoundException('비대면 진료를 찾을 수 없습니다');
    const durationMin = consult.videoStartedAt ? Math.round((Date.now() - consult.videoStartedAt.getTime()) / 60000) : undefined;
    return this.prisma.remoteConsultation.update({
      where: { id: consultationId },
      data: { videoEndedAt: new Date(), videoDurationMin: durationMin },
    });
  }

  // ════════════════════════════════════════
  // SLA 모니터링 (Cron)
  // ════════════════════════════════════════

  /**
   * SLA 감시 — 매시간 실행
   * - 24시간 미답변: 의사 + 과장 에스컬레이션 알림
   * - 48시간 미답변: 자동 환불 + 상담 취소
   */
  @Cron('0 0 * * * *')
  async runSlaCheck() {
    const now = Date.now();
    const pending = await this.prisma.remoteConsultation.findMany({
      where: { status: { in: ['REQUESTED', 'ACCEPTED'] }, doctorRepliedAt: null, isFreeConsult: false },
      select: { id: true, doctorId: true, subject: true, createdAt: true, billingId: true },
    });
    let escalated = 0;
    let refunded = 0;
    for (const c of pending) {
      const ageH = (now - c.createdAt.getTime()) / 3600000;
      if (ageH >= 48) {
        const r = await this.refundAndCancel(c.id, c.billingId, '48시간 미답변 자동 취소');
        if (r.done) {
          // 🔴 (P3-1) 결제 전 취소를 '자동 환불'(CRITICAL)이라 알리지 않는다 — 돈이 돌아간 경우만 환불이다
          await this.notifyDoctor(c.doctorId, r.refundedAmount > 0
            ? { type: 'REMOTE_SLA_REFUND', title: '비대면 진료 자동 환불', message: `${c.subject}: 48시간 미답변으로 자동 환불 처리되었습니다`, severity: 'CRITICAL', refId: c.id }
            : { type: 'REMOTE_SLA_REFUND', title: '비대면 진료 자동 취소', message: `${c.subject}: 48시간 미답변으로 자동 취소되었습니다(결제 전 — 환불할 금액 없음)`, severity: 'WARNING', refId: c.id });
          refunded++;
        }
      } else if (ageH >= 24 && ageH < 25) {
        // 24h 경과 직후 1시간 윈도우에서만 1회 에스컬레이션 (매시간 중복 알림 방지)
        await this.notifyDoctor(c.doctorId, {
          type: 'REMOTE_SLA_ESCALATE', title: '⚠️ 비대면 진료 응답 지연', message: `${c.subject}: 24시간 이상 미답변입니다. 빠른 답변이 필요합니다 (48h 경과 시 자동 환불)`, severity: 'WARNING', refId: c.id,
        });
        // 과장(부서장)에게도 에스컬레이션
        const doctor = await this.prisma.user.findUnique({ where: { id: c.doctorId }, select: { department: true } });
        if (doctor?.department) {
          const heads = await this.prisma.user.findMany({
            where: { department: doctor.department, role: 'ADMIN' },
            select: { id: true }, take: 3,
          });
          for (const h of heads) {
            await this.notifyDoctor(h.id, {
              type: 'REMOTE_SLA_ESCALATE', title: '부서 비대면 진료 응답 지연', message: `${doctor.department} 비대면 진료 24h 미답변 건 발생`, severity: 'WARNING', refId: c.id,
            });
          }
        }
        escalated++;
      }
    }

    // 7일 유효기간 만료 — 답변된 진행중 텍스트 상담 자동 종료 (§12.4)
    let expired = 0;
    const stale = await this.prisma.remoteConsultation.findMany({
      where: {
        status: 'IN_PROGRESS',
        channel: { in: ['TEXT', 'RESULT_REVIEW', 'HYBRID'] },
        createdAt: { lt: new Date(now - 7 * 86400000) },
      },
      select: { id: true, doctorId: true, isFreeConsult: true, billingStatus: true, encounterId: true, patientId: true, subject: true, feeAmount: true, doctorAssessment: true, doctorPlan: true, messageCount: true, channel: true },
    });
    for (const c of stale) {
      await this.completeConsultation(c.id, c.doctorId).catch((e) => this.logger.warn(`7일 자동종료 실패 ${c.id}: ${e}`));
      expired++;
    }

    // 화상 예약 no-show — 예약 후 10분 미입장 (§12.4)
    let videoNoShow = 0;
    const noShow = await this.prisma.remoteConsultation.findMany({
      where: {
        status: { in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] },
        videoScheduledAt: { lt: new Date(now - 10 * 60000) },
        videoStartedAt: null,
        videoRoomId: { not: null },
      },
      select: { id: true, doctorId: true, subject: true },
    });
    for (const c of noShow) {
      await this.prisma.remoteConsultation.update({ where: { id: c.id }, data: { videoRoomId: null, videoScheduledAt: null, videoRequestedBy: null } });
      await this.prisma.consultationMessage.create({
        data: { consultationId: c.id, sender: 'SYSTEM', content: '예약된 화상 진료에 10분 이상 미입장하여 화상 세션이 취소되었습니다. 필요 시 다시 요청해주세요.' },
      });
      await this.notifyDoctor(c.doctorId, {
        type: 'REMOTE_VIDEO_NOSHOW', title: '화상 진료 미입장', message: `${c.subject}: 환자 미입장으로 화상 세션이 취소되었습니다`, refId: c.id,
      });
      videoNoShow++;
    }

    if (escalated || refunded || expired || videoNoShow) {
      this.logger.log(`SLA 감시: 에스컬레이션 ${escalated} · 자동 취소(환불 포함) ${refunded} · 7일만료 ${expired} · 화상no-show ${videoNoShow}`);
    }
    return { escalated, refunded, expired, videoNoShow };
  }
}
