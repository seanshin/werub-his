import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { BED_TRANSFER_CLOSED_BY_ADMISSION } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { NotificationService } from '../notification/notification.service';
import { transferBedInTx } from '../inpatient/bed-transfer';
import { CreateBedTransferDto } from './bed-transfer.dto';

/**
 * 병동 간 전동 요청 → 수락(2026-09-30) — 기획 `docs/01-plan/features/bed-transfer-request.plan.md`.
 *
 * 🔴 종전 전동은 보내는 병동 간호사가 **병상 번호를 골라 즉시** 옮겼다(window.prompt) — 받는 병동은 환자가 도착해서야 알았다.
 *  · 요청(간호사·의사·관리자) — 받는 병동·사유(필수)·원하는 병상(선택) · 입원 하나에 열린 요청 하나(부분 유니크 → 409)
 *  · 수락(간호사·관리자 — 전실 EP 와 같은 권한) — 받는 병동의 병상을 골라 **같은 트랜잭션**에서 전실 정본(transferBedInTx) + 조건부 상태 전이
 *  · 거절(사유 필수) · 취소(요청자·관리자) · 입원이 끝나면 열린 요청은 저절로 닫힌다(판정자 null · 사유 ADMISSION_CLOSED)
 *  · 🔴 받는 병동 **소속**은 확인하지 못한다(사용자에 병동 소속이 없다) — 누가 수락했는지만 남긴다
 *  · 요청 때 병상을 잡지 않는다(사람 결정 `bedTransfer.reserveOnRequest`)
 */
@Injectable()
export class BedTransferService {
  private readonly logger = new Logger(BedTransferService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async create(dto: CreateBedTransferDto, userId: string) {
    const reason = (dto.reason ?? '').trim();
    if (!reason) throw new BadRequestException({ code: 'BED_TRANSFER_REASON_REQUIRED', message: 'A reason is required' });
    const admission = await this.prisma.admission.findUnique({ where: { id: dto.admissionId }, select: { id: true, patientId: true, bedId: true, status: true, bed: { select: { wardId: true } } } });
    if (!admission) throw new NotFoundException('Admission not found');
    if (admission.status !== 'ADMITTED') throw new ConflictException({ code: 'ADMISSION_NOT_ACTIVE', message: 'Only an active admission can be transferred' });
    if (admission.bed?.wardId === dto.targetWardId) {
      // 같은 병동 안 이동은 요청이 필요 없다 — 병상 이동(즉시)으로
      throw new BadRequestException({ code: 'BED_TRANSFER_SAME_WARD', message: 'Same-ward moves do not need a transfer request' });
    }
    const ward = await this.prisma.ward.findUnique({ where: { id: dto.targetWardId }, select: { id: true, isActive: true } });
    if (!ward || !ward.isActive) throw new NotFoundException('Target ward not found');
    if (dto.targetBedId) {
      const bed = await this.prisma.bed.findUnique({ where: { id: dto.targetBedId }, select: { wardId: true } });
      if (!bed || bed.wardId !== dto.targetWardId) throw new BadRequestException({ code: 'BED_TRANSFER_BED_WARD_MISMATCH', message: 'The requested bed is not in the target ward' });
    }
    try {
      const row = await this.prisma.bedTransferRequest.create({
        data: {
          admissionId: admission.id, patientId: admission.patientId, fromBedId: admission.bedId,
          targetWardId: dto.targetWardId, targetBedId: dto.targetBedId ?? null, reason, requestedById: userId,
        },
      });
      return row;
    } catch (e) {
      // 부분 유니크(열린 요청 하나) — 동시 요청·중복 요청
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'BED_TRANSFER_ALREADY_OPEN', message: 'This admission already has an open transfer request' });
      }
      throw e;
    }
  }

  /** 목록 — incoming(받을 요청 · 병동 선택) · mine(내가 보낸) · recent(최근 처리 7일) */
  async list(q: { scope?: string; targetWardId?: string }, userId: string) {
    const LIMIT = 200;
    const where: Prisma.BedTransferRequestWhereInput =
      q.scope === 'mine' ? { requestedById: userId }
      : q.scope === 'recent' ? { status: { in: ['ACCEPTED', 'REJECTED', 'CANCELLED'] }, decidedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }
      : { status: 'REQUESTED', ...(q.targetWardId ? { targetWardId: q.targetWardId } : {}) };
    const rows = await this.prisma.bedTransferRequest.findMany({ where, orderBy: { requestedAt: q.scope === 'recent' ? 'desc' : 'asc' }, take: LIMIT + 1 });
    const page = rows.slice(0, LIMIT);
    const bedIds = [...new Set(page.flatMap((r) => [r.fromBedId, r.targetBedId, r.acceptedBedId]).filter((v): v is string => !!v))];
    const wardIds = [...new Set(page.map((r) => r.targetWardId))];
    const patientIds = [...new Set(page.map((r) => r.patientId))];
    const userIds = [...new Set(page.flatMap((r) => [r.requestedById, r.decidedById]).filter((v): v is string => !!v))];
    const [beds, wards, patients, users] = await Promise.all([
      bedIds.length ? this.prisma.bed.findMany({ where: { id: { in: bedIds } }, select: { id: true, roomNumber: true, bedNumber: true, ward: { select: { id: true, name: true } } } }) : [],
      wardIds.length ? this.prisma.ward.findMany({ where: { id: { in: wardIds } }, select: { id: true, name: true } }) : [],
      patientIds.length ? this.prisma.patient.findMany({ where: { id: { in: patientIds } }, select: { id: true, mrn: true, familyName: true, givenName: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, familyName: true, givenName: true } }) : [],
    ]);
    const bm = new Map(beds.map((b) => [b.id, b])), wm = new Map(wards.map((w) => [w.id, w])), pm = new Map(patients.map((p) => [p.id, p]));
    const um = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}` || null]));
    return {
      items: page.map((r) => ({
        ...r,
        patient: pm.get(r.patientId) ?? null,
        fromBed: bm.get(r.fromBedId) ?? null,
        targetWard: wm.get(r.targetWardId) ?? null,
        targetBed: r.targetBedId ? bm.get(r.targetBedId) ?? null : null,
        acceptedBed: r.acceptedBedId ? bm.get(r.acceptedBedId) ?? null : null,
        requestedByName: um.get(r.requestedById) ?? null,
        decidedByName: r.decidedById ? um.get(r.decidedById) ?? null : null,
      })),
      truncated: rows.length > LIMIT,
      limit: LIMIT,
    };
  }

  /** 수락 — 받는 병동의 병상으로 **같은 트랜잭션**에서 이동(전실 정본) + 조건부 상태 전이 */
  async accept(id: string, bedId: string, userId: string, note?: string) {
    const req = await this.prisma.bedTransferRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Transfer request not found');
    if (req.status !== 'REQUESTED') throw new ConflictException({ code: 'BED_TRANSFER_NOT_OPEN', message: 'This request is no longer open', details: { status: req.status } });
    const bed = await this.prisma.bed.findUnique({ where: { id: bedId }, select: { wardId: true } });
    if (!bed || bed.wardId !== req.targetWardId) throw new BadRequestException({ code: 'BED_TRANSFER_BED_WARD_MISMATCH', message: 'The bed is not in the requested ward' });
    const admission = await this.prisma.admission.findUnique({ where: { id: req.admissionId }, select: { id: true, bedId: true, status: true, patientId: true } });
    if (!admission || admission.status !== 'ADMITTED') throw new ConflictException({ code: 'ADMISSION_NOT_ACTIVE', message: 'The admission is no longer active' });
    const now = new Date();
    const moved = await this.prisma.$transaction(async (tx) => {
      const done = await tx.bedTransferRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'ACCEPTED', decidedById: userId, decidedAt: now, decisionNote: note?.trim() || null, acceptedBedId: bedId },
      });
      if (done.count === 0) throw new ConflictException({ code: 'BED_TRANSFER_NOT_OPEN', message: 'This request is no longer open' });
      return transferBedInTx(tx, admission, bedId, 'TRANSFER_REQUEST', now);
    });
    this.journey?.emit({
      patientId: admission.patientId, eventType: 'BED_TRANSFER',
      title: '전동', department: moved.bed?.ward?.name ?? undefined, refType: 'ADMISSION', refId: admission.id,
      occurredAt: now, // 여정 P1: 병상 이력 원장과 같은 시각
    });
    const notice = await this.notifyRequester(req.requestedById, req.id, 'ACCEPTED', moved.bed?.ward?.name ?? null);
    return { ...(await this.prisma.bedTransferRequest.findUnique({ where: { id } })), requesterNotice: notice };
  }

  async reject(id: string, userId: string, reasonRaw: string) {
    const reason = (reasonRaw ?? '').trim();
    if (!reason) throw new BadRequestException({ code: 'BED_TRANSFER_REJECT_REASON_REQUIRED', message: 'A reason is required to reject' });
    const req = await this.prisma.bedTransferRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Transfer request not found');
    const done = await this.prisma.bedTransferRequest.updateMany({ where: { id, status: 'REQUESTED' }, data: { status: 'REJECTED', decidedById: userId, decidedAt: new Date(), decisionNote: reason } });
    if (done.count === 0) throw new ConflictException({ code: 'BED_TRANSFER_NOT_OPEN', message: 'This request is no longer open' });
    const notice = await this.notifyRequester(req.requestedById, req.id, 'REJECTED', reason);
    return { ...(await this.prisma.bedTransferRequest.findUnique({ where: { id } })), requesterNotice: notice };
  }

  async cancel(id: string, userId: string, role: string, reason?: string) {
    const req = await this.prisma.bedTransferRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Transfer request not found');
    if (req.requestedById !== userId && role !== 'ADMIN') throw new ForbiddenException({ code: 'BED_TRANSFER_CANCEL_NOT_ALLOWED', message: 'Only the requester or an administrator can cancel' });
    const done = await this.prisma.bedTransferRequest.updateMany({ where: { id, status: 'REQUESTED' }, data: { status: 'CANCELLED', decidedById: userId, decidedAt: new Date(), decisionNote: reason?.trim() || null } });
    if (done.count === 0) throw new ConflictException({ code: 'BED_TRANSFER_NOT_OPEN', message: 'This request is no longer open' });
    return this.prisma.bedTransferRequest.findUnique({ where: { id } });
  }

  /** 입원이 끝나면(퇴원·취소) 열린 요청은 저절로 닫힌다 — 판정자 없음(사람이 거절한 것이 아니다) */
  @OnEvent('admission.closed', { async: true })
  async onAdmissionClosed(p: { admissionId: string }) {
    if (!p?.admissionId) return;
    try {
      const n = await this.prisma.bedTransferRequest.updateMany({
        where: { admissionId: p.admissionId, status: 'REQUESTED' },
        data: { status: 'CANCELLED', decidedAt: new Date(), decisionNote: BED_TRANSFER_CLOSED_BY_ADMISSION },
      });
      if (n.count) this.logger.log(`입원 종료 — 열린 전동 요청 ${n.count}건 닫음 admission=${p.admissionId}`);
    } catch (e) {
      this.logger.error(`입원 종료 시 전동 요청 닫기 실패 admission=${p.admissionId}: ${(e as Error).message}`);
    }
  }

  /** 요청자에게 원내 인앱 알림(대외 발신 아님) — 결과 {attempted,sent,reason} · 문장은 조립하지 않는다(값만) */
  private async notifyRequester(userId: string, refId: string, result: 'ACCEPTED' | 'REJECTED', detail: string | null) {
    if (!this.notifications) return { attempted: false, sent: false, reason: 'NO_NOTIFIER' as const };
    try {
      await this.notifications.notify(userId, {
        type: 'BED_TRANSFER_DECIDED',
        title: result === 'ACCEPTED' ? '✅ 전동 수락' : '⛔ 전동 거절',
        message: detail ?? '',
        severity: result === 'ACCEPTED' ? 'INFO' : 'WARNING',
        refType: 'BED_TRANSFER', refId,
      });
      return { attempted: true, sent: true, reason: null };
    } catch (e) {
      this.logger.warn(`전동 결과 알림 실패(비차단) request=${refId}: ${(e as Error).message}`);
      return { attempted: true, sent: false, reason: 'FAILED' as const };
    }
  }
}
