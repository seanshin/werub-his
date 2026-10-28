import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import type { PrescriptionService } from '../prescription/prescription.service';
import { publicBaseUrl } from '../../common/util/public-url';

/**
 * 사전승인(Pre-Authorization) 서비스 — 고위험 오더 발행 전 결재 게이트.
 * 결재는 전자결재 백본(EApprovalRelay docType=PRE_AUTH) 재사용. 승인 훅(confirmPreAuth)이 발행.
 * P0 = 마약류 처방(NARCOTIC_RX). 나머지 오더 유형·환자 포털 신청은 P1/P2.
 */
@Injectable()
export class PreAuthService {
  private readonly logger = new Logger(PreAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * 발행 서비스 런타임 lazy resolve. prescription.service를 값 import하지 않고(type-only) 런타임 require로 클래스 토큰만
   * 얻는다 → 부팅 시 prescription 파일 로드 체인에 개입하지 않아 CJS 순환(StepUp/PushApproval 초기화 방해) 없음.
   */
  private get prescription(): PrescriptionService {
    const { PrescriptionService: Svc } = require('../prescription/prescription.service');
    return this.moduleRef.get(Svc, { strict: false });
  }

  private audit(userId: string, action: 'CREATE' | 'UPDATE', resourceId: string, changes?: object) {
    void this.prisma.auditLog.create({ data: { userId, action, resourceType: 'PreAuthRequest', resourceId, changes: (changes ?? undefined) as never } }).catch(() => undefined);
  }

  /**
   * 의료진발 오더 사전승인 상신 — 처방 초안을 payload에 담아 책임의(과장) 결재선으로 상신.
   * 승인권자 미지정 시 처방의(encounter 담당의)의 관리자(과장)로 해소.
   */
  async submitOrderPreAuth(userId: string, dto: { type: string; encounterId: string; approverUserId?: string; draft: Record<string, unknown>; prescriberId?: string }) {
    if (!['NARCOTIC_RX', 'HIGH_COST_IMAGING', 'TRANSFUSION', 'CHEMO_REGIMEN'].includes(dto.type))
      throw new BadRequestException('지원하지 않는 오더 사전승인 유형입니다');
    const enc = await this.prisma.encounter.findUnique({ where: { id: dto.encounterId }, select: { patientId: true, doctorId: true } });
    if (!enc) throw new NotFoundException('진료(encounter)를 찾을 수 없습니다');

    // 승인권자(책임의) 해소 — 지정 우선, 없으면 처방의의 관리자(과장)
    let approverUserId = dto.approverUserId;
    if (!approverUserId && enc.doctorId) {
      const staff = await this.prisma.staff.findUnique({ where: { userId: enc.doctorId }, select: { manager: { select: { userId: true } } } });
      approverUserId = staff?.manager?.userId ?? undefined;
    }
    if (!approverUserId) throw new BadRequestException('승인 책임의(과장)를 지정하세요 — 처방의 관리자 미등록');
    // M1 직무분리(SoD) — 요청자(기안자)·처방의 본인이 스스로 승인 불가
    if (approverUserId === userId) throw new BadRequestException('본인이 상신한 사전승인은 본인이 승인할 수 없습니다(직무분리)');
    if (dto.prescriberId && approverUserId === dto.prescriberId) throw new BadRequestException('처방의 본인은 사전승인 승인권자가 될 수 없습니다(직무분리)');
    const approver = await this.prisma.user.findUnique({ where: { id: approverUserId }, select: { role: true } });
    if (approver?.role !== 'DOCTOR') throw new BadRequestException('승인자는 의사여야 합니다');
    const approverStaff = await this.prisma.staff.findUnique({ where: { userId: approverUserId }, select: { id: true, familyName: true, givenName: true } });
    if (!approverStaff) throw new BadRequestException('승인 책임의의 직원(Staff) 정보가 없습니다');

    const orderLabel = ({ NARCOTIC_RX: '마약류 처방', HIGH_COST_IMAGING: '고가·특수 검사', TRANSFUSION: '수혈', CHEMO_REGIMEN: '항암 레지멘' } as Record<string, string>)[dto.type] ?? '오더';
    const pa = await this.prisma.preAuthRequest.create({
      data: {
        category: 'ORDER', type: dto.type, status: 'PENDING',
        patientId: enc.patientId, encounterId: dto.encounterId, requestedByUserId: userId,
        payload: { dto: dto.draft, prescriberId: dto.prescriberId ?? null } as object,
      },
    });
    const callbackUrl = `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`;
    const relay = await this.prisma.eApprovalRelay.create({
      data: {
        docType: 'PRE_AUTH', title: `${orderLabel} 사전승인 요청`,
        refModule: 'preauth.pre_auth_requests', refId: pa.id, callbackUrl,
        approvalLine: [{ order: 1, staffId: approverStaff.id, userId: approverUserId, role: 'APPROVE' }] as object,
      },
    });
    await this.prisma.preAuthRequest.update({ where: { id: pa.id }, data: { eApprovalRef: relay.refId } });
    await this.prisma.notification
      .create({ data: { userId: approverUserId, type: 'PRE_AUTH', title: `${orderLabel} 사전승인 요청`, message: `${orderLabel} 사전승인 결재가 도착했습니다`, severity: 'INFO', refType: 'PRE_AUTH', refId: pa.id } })
      .catch(() => undefined);
    this.audit(userId, 'CREATE', pa.id, { type: dto.type, approverUserId });
    return { preAuthId: pa.id, relayId: relay.id, status: 'PENDING', approverUserId };
  }

  /**
   * 확약 확정 훅(ess DocTypeRegistry PRE_AUTH) — refId = PreAuthRequest.id.
   * 승인=type별 발행(마약류=처방 create, preAuthRef 동반해 게이트 통과), 반려=REJECTED. 멱등(fulfilled면 skip).
   */
  async confirmPreAuth(refId: string, decision: 'APPROVED' | 'REJECTED', approverUserId?: string, comment?: string) {
    const pa = await this.prisma.preAuthRequest.findUnique({ where: { id: refId } });
    if (!pa) return { notFound: true };
    if (['REJECTED', 'CANCELLED'].includes(pa.status)) return { idempotent: true, status: pa.status };
    // 사후승인(POST_FACTO)은 이미 발행돼 fulfilledRef가 있어도 결정(추인/반려)을 처리해야 함 — 멱등 가드에서 제외
    const isPostFacto = pa.status === 'POST_FACTO_PENDING';
    if (!isPostFacto && (pa.status === 'FULFILLED' || pa.fulfilledRef)) return { idempotent: true, fulfilledRef: pa.fulfilledRef };

    if (decision === 'REJECTED') {
      // 동시 콜백 재수신 이중 처리 방지 — 읽은 status 에서만 전이(낙관적 락·2026-07 멱등 전수).
      // count 0 = 다른 콜백이 선점 → prescription.cancel 을 중복 호출하지 않는다.
      const claimed = await this.prisma.preAuthRequest.updateMany({ where: { id: refId, status: pa.status }, data: { status: 'REJECTED', decision: 'REJECTED', decidedAt: new Date(), bypassReason: comment ? comment.slice(0, 300) : pa.bypassReason } });
      if (claimed.count === 0) return { idempotent: true, status: 'REJECTED' };
      // 반려 자동취소 정책(2026-07-22) — 사후승인 반려 시 우회 발행분(처방) 자동취소.
      // 이미 시행분(투약·시행 기록)은 prescription.cancel이 감사 보존(SCHEDULED MAR만 제거). config로 끌 수 있음(기본 ON).
      let autoCancelled = false;
      if (isPostFacto && pa.fulfilledRef && (pa.fulfilledType ?? 'prescription') === 'prescription') {
        const auto = String((await this.configRuntime.get('preauth.postFacto.autoCancelOnReject').catch(() => null)) ?? 'true') === 'true';
        if (auto) {
          try {
            await this.prescription.cancel(pa.fulfilledRef, approverUserId);
            autoCancelled = true;
          } catch (e) {
            this.logger.warn(`사후승인 반려 자동취소 실패(수동 조치 필요) rx=${pa.fulfilledRef}: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      await this.notifyRequester(pa, false, comment ? `${comment}${autoCancelled ? ' — 발행분 자동취소됨' : ''}` : (autoCancelled ? '발행분 자동취소됨' : undefined));
      return { status: 'REJECTED', ...(isPostFacto ? { autoCancelled } : {}) };
    }

    // 사후승인 승인 = 추인(ratify) — 이미 발행됐으므로 재발행 없이 상태만 종결
    if (isPostFacto) {
      const claimed = await this.prisma.preAuthRequest.updateMany({ where: { id: refId, status: pa.status }, data: { status: 'APPROVED', decision: 'APPROVED', decidedAt: new Date() } });
      if (claimed.count === 0) return { idempotent: true, status: 'APPROVED' };
      await this.notifyRequester(pa, true);
      return { status: 'APPROVED', ratified: true };
    }

    // 승인 — 처방/검사 발행(preAuthRef로 게이트 통과). 마약류=처방, 고가검사=IMAGING 오더 동일 create 경로.
    if (['NARCOTIC_RX', 'HIGH_COST_IMAGING'].includes(pa.type)) {
      const payload = pa.payload as { dto?: Record<string, unknown>; prescriberId?: string | null };
      if (!payload?.dto || !pa.encounterId) throw new BadRequestException('사전승인 오더 초안이 없습니다');
      const prescriberUserId = pa.requestedByUserId ?? approverUserId!;
      const rx = await this.prescription.create(
        pa.encounterId,
        payload.dto as never,
        prescriberUserId,
        undefined,
        { preAuthRef: refId, prescriberId: payload.prescriberId ?? undefined },
      );
      const rxId = (rx as { prescription?: { id?: string } })?.prescription?.id ?? null;
      await this.prisma.preAuthRequest.update({ where: { id: refId }, data: { status: 'FULFILLED', decision: 'APPROVED', decidedAt: new Date(), fulfilledRef: rxId, fulfilledType: 'prescription' } });
      await this.notifyRequester(pa, true);
      return { status: 'FULFILLED', prescriptionId: rxId };
    }

    // 플래그 게이트 유형(TRANSFUSION·CHEMO_REGIMEN) — 발행은 각 도메인 엔진이 findApprovedPreAuth 확인 후 수행. 승인=플래그.
    await this.prisma.preAuthRequest.update({ where: { id: refId }, data: { status: 'APPROVED', decision: 'APPROVED', decidedAt: new Date() } });
    await this.notifyRequester(pa, true);
    return { status: 'APPROVED' };
  }

  /** 기안자(직원) 결과 통지 — 환자 기안은 ess resolveDrafter 스킵 후 포털 알림(P2에서 처리) */
  private async notifyRequester(pa: { id: string; requestedByUserId: string | null; type: string }, approved: boolean, comment?: string) {
    if (!pa.requestedByUserId) return;
    await this.prisma.notification
      .create({ data: { userId: pa.requestedByUserId, type: 'PRE_AUTH_RESULT', title: approved ? '사전승인이 승인되었습니다' : '사전승인이 반려되었습니다', message: approved ? '사전승인 오더가 발행되었습니다' : `반려 (사유: ${comment ?? '-'})`, severity: 'INFO', refType: 'PRE_AUTH', refId: pa.id } })
      .catch(() => undefined);
  }

  async listMine(userId: string) {
    return this.prisma.preAuthRequest.findMany({ where: { requestedByUserId: userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  // ── 환자 포털 사전승인 신청 (P2·환자→행정→주치의 다단계) ──

  private portalLabel(type: string): string {
    return ({ PORTAL_REFILL: '재처방(리필)', PORTAL_TEST: '검사', PORTAL_REFERRAL: '진료의뢰·소견', PORTAL_CONSULT: '시술·수술 상담' } as Record<string, string>)[type] ?? '신청';
  }

  /** 담당(주치)의 해소 — 활성 입원 주치의 → 최근 SIGNED 진료의 */
  private async resolveAttendingDoctor(patientId: string): Promise<string | undefined> {
    const adm = await this.prisma.admission.findFirst({
      where: { patientId, status: 'ADMITTED' }, orderBy: { createdAt: 'desc' },
      select: { attendingDoctorId: true, admittingDoctorId: true },
    });
    if (adm) return adm.attendingDoctorId ?? adm.admittingDoctorId ?? undefined;
    const enc = await this.prisma.encounter.findFirst({
      where: { patientId, status: 'SIGNED' }, orderBy: { createdAt: 'desc' }, select: { doctorId: true },
    });
    return enc?.doctorId ?? undefined;
  }

  /**
   * 환자 포털 신청 → 행정 접수 → 주치의 승인 다단계. 결재선 [행정(order1), 주치의(order2)] — decideApproval이 순차 처리.
   * 최종(주치의) 승인 시 confirmPreAuth가 status=APPROVED(발행은 의료진 후속). 게이트 preauth.portal.enabled(기본 OFF).
   *
   * 🔴 (2026-09-17 L2) 게이트 조회의 `.catch(() => false)` 를 걷었다 — 실패를 "관리자가 껐다"로 번역해
   *    환자에게 "신청이 비활성화되어 있습니다" 라고 단정하던 자리다(미설정은 `get()` 이 이미 `null` 로 답한다).
   */
  async submitPortalPreAuth(patientId: string, dto: { type: string; detail?: Record<string, unknown>; note?: string }) {
    if (String(await this.configRuntime.get('preauth.portal.enabled')) !== 'true')
      throw new BadRequestException('환자 포털 사전승인 신청이 비활성화되어 있습니다(preauth.portal.enabled)');
    if (!['PORTAL_REFILL', 'PORTAL_TEST', 'PORTAL_REFERRAL', 'PORTAL_CONSULT'].includes(dto.type))
      throw new BadRequestException('지원하지 않는 신청 유형입니다');
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');

    const intakeUserId = (await this.configRuntime.get('preauth.portalIntakeStaffId').catch(() => null)) as string | null;
    if (!intakeUserId) throw new BadRequestException('원무 접수 담당자가 지정되지 않았습니다(preauth.portalIntakeStaffId)');
    const doctorUserId = await this.resolveAttendingDoctor(patientId);
    if (!doctorUserId) throw new BadRequestException('담당(주치)의를 확인할 수 없습니다 — 최근 진료·입원 기록이 필요합니다');

    const dup = await this.prisma.preAuthRequest.findFirst({ where: { category: 'PORTAL', type: dto.type, patientId, status: 'PENDING' } });
    if (dup) throw new BadRequestException('동일 유형의 신청이 진행 중입니다');

    const [intakeStaff, doctorStaff] = await Promise.all([
      this.prisma.staff.findUnique({ where: { userId: intakeUserId }, select: { id: true } }),
      this.prisma.staff.findUnique({ where: { userId: doctorUserId }, select: { id: true } }),
    ]);
    if (!intakeStaff) throw new BadRequestException('원무 접수 담당 직원 정보가 없습니다');
    if (!doctorStaff) throw new BadRequestException('주치의 직원 정보가 없습니다');

    const label = this.portalLabel(dto.type);
    const pa = await this.prisma.preAuthRequest.create({
      data: {
        category: 'PORTAL', type: dto.type, status: 'PENDING', patientId, requestedByPatientId: patientId,
        payload: { detail: dto.detail ?? null, note: dto.note ?? null } as object,
      },
    });
    const callbackUrl = `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`;
    const relay = await this.prisma.eApprovalRelay.create({
      data: {
        docType: 'PRE_AUTH', title: `${label} 신청(환자 포털)`, refModule: 'preauth.pre_auth_requests', refId: pa.id, callbackUrl,
        approvalLine: [
          { order: 1, staffId: intakeStaff.id, userId: intakeUserId, role: 'APPROVE' },
          { order: 2, staffId: doctorStaff.id, userId: doctorUserId, role: 'APPROVE' },
        ] as object,
      },
    });
    await this.prisma.preAuthRequest.update({ where: { id: pa.id }, data: { eApprovalRef: relay.refId } });
    // 첫 결재자(행정) 알림 — 주치의는 행정 승인 후 자동 노출(순차 결재선)
    await this.prisma.notification
      .create({ data: { userId: intakeUserId, type: 'PRE_AUTH', title: '환자 사전승인 신청 접수', message: `${label} 신청이 접수되었습니다`, severity: 'INFO', refType: 'PRE_AUTH', refId: pa.id } })
      .catch(() => undefined);
    return { preAuthId: pa.id, relayId: relay.id, status: 'PENDING', stage: '행정 접수 대기' };
  }

  /** 환자 본인 포털 신청 취소 — 진행(PENDING) 건만, 본인 확인 */
  async cancelPortal(patientId: string, id: string) {
    const pa = await this.prisma.preAuthRequest.findUnique({ where: { id }, select: { requestedByPatientId: true, status: true, category: true } });
    if (!pa || pa.category !== 'PORTAL' || pa.requestedByPatientId !== patientId) throw new NotFoundException('신청을 찾을 수 없습니다');
    if (pa.status !== 'PENDING') throw new BadRequestException('진행 중(PENDING)인 신청만 취소할 수 있습니다');
    await this.prisma.preAuthRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.prisma.eApprovalRelay.updateMany({ where: { docType: 'PRE_AUTH', refId: id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
    return { cancelled: true };
  }

  /** 환자 본인 신청 목록(진행상태 조회) */
  async listPortalMine(patientId: string) {
    return this.prisma.preAuthRequest.findMany({
      where: { requestedByPatientId: patientId, category: 'PORTAL' }, orderBy: { createdAt: 'desc' }, take: 30,
      select: { id: true, type: true, status: true, payload: true, decision: true, createdAt: true, decidedAt: true },
    });
  }

  async cancel(userId: string, id: string) {
    const pa = await this.prisma.preAuthRequest.findUnique({ where: { id }, select: { requestedByUserId: true, status: true } });
    if (!pa || pa.requestedByUserId !== userId) throw new NotFoundException('사전승인 요청을 찾을 수 없습니다');
    if (!['DRAFT', 'PENDING'].includes(pa.status)) throw new BadRequestException('진행 중(PENDING) 요청만 취소할 수 있습니다');
    await this.prisma.preAuthRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.prisma.eApprovalRelay.updateMany({ where: { docType: 'PRE_AUTH', refId: id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
    this.audit(userId, 'UPDATE', id, { status: 'CANCELLED' });
    return { cancelled: true };
  }
}
