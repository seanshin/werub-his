import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { assertStateTransition, stateChangedConflict, TransitionMap } from '../../common/state-transition';

/** 협진 상태 어휘 — 스키마 주석(Consultation.status) 그대로 */
export type ConsultationStatus = 'REQUESTED' | 'ACCEPTED' | 'REPLIED' | 'CLOSED';

@Injectable()
export class ConsultationService {
  /** 회신은 접수 전후 모두 가능(실무: 바로 회신) · 종결·회신 후 재회신은 덮어쓰기라 막는다 */
  private static readonly TRANSITIONS: TransitionMap<ConsultationStatus> = {
    REQUESTED: ['ACCEPTED', 'REPLIED', 'CLOSED'],
    ACCEPTED: ['REPLIED', 'CLOSED'],
    REPLIED: ['CLOSED'],
    CLOSED: [],
  };
  private static readonly TX_CTX = { code: 'CONSULTATION', message: '지금 상태에서는 할 수 없는 협진 처리입니다' };
  private readonly logger = new Logger(ConsultationService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
  ) {}

  async create(data: {
    encounterId: string;
    requestingDoctorId: string;
    toDepartment: string;
    toDoctorId?: string;
    reason: string;
    clinicalQuestion?: string;
    urgency?: string;
  }) {
    const consult = await this.prisma.consultation.create({
      data: {
        encounterId: data.encounterId,
        requestingDoctorId: data.requestingDoctorId,
        toDepartment: data.toDepartment,
        toDoctorId: data.toDoctorId,
        reason: data.reason,
        clinicalQuestion: data.clinicalQuestion,
        urgency: data.urgency ?? 'ROUTINE',
      },
      include: {
        requestingDoctor: { select: { familyName: true, givenName: true, department: true } },
        encounter: { select: { patient: { select: { familyName: true, givenName: true } } } },
      },
    });
    // 수신 의료진에게 알림(지정의 → 본인, 미지정 → 해당 과 의사 전원)
    this.notifyRecipients(consult).catch((e) => this.logger.warn(`협진 알림 실패: ${e instanceof Error ? e.message : e}`));
    return consult;
  }

  /** 협진 수신자 해석 후 인앱 알림 + SSE 푸시 */
  private async notifyRecipients(consult: {
    id: string; toDoctorId: string | null; toDepartment: string; urgency: string; requestingDoctorId: string;
    requestingDoctor?: { familyName: string | null; givenName: string | null; department: string | null } | null;
    encounter?: { patient?: { familyName: string | null; givenName: string | null } | null } | null;
  }) {
    let recipientIds: string[] = [];
    if (consult.toDoctorId) {
      recipientIds = [consult.toDoctorId];
    } else {
      let docs = await this.prisma.user.findMany({
        where: { role: 'DOCTOR', isActive: true, department: consult.toDepartment },
        select: { id: true },
      });
      // 스카우트: 부서명 완전일치라 표기 불일치(공백 등) 시 전원 미전달 — trim 재시도 + 미전달 경고
      if (!docs.length && consult.toDepartment?.trim() !== consult.toDepartment) {
        docs = await this.prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true, department: consult.toDepartment.trim() }, select: { id: true } });
      }
      recipientIds = docs.map((d) => d.id);
    }
    // 요청자 본인 제외·중복 제거
    recipientIds = [...new Set(recipientIds)].filter((id) => id && id !== consult.requestingDoctorId);
    if (!recipientIds.length) {
      this.logger.warn(`협진 알림 수신자 0명 — toDepartment='${consult.toDepartment}' 표기 확인 필요(부서 완전일치 매칭)`);
      return;
    }

    const reqDept = consult.requestingDoctor?.department ?? '타과';
    const p = consult.encounter?.patient;
    const patientName = p ? `${p.familyName ?? ''}${p.givenName ?? ''}` : '환자';
    const urgLabel = consult.urgency === 'EMERGENT' ? '[응급] ' : consult.urgency === 'URGENT' ? '[긴급] ' : '';
    const severity = consult.urgency === 'EMERGENT' ? 'CRITICAL' : consult.urgency === 'URGENT' ? 'WARNING' : 'INFO';

    for (const uid of recipientIds) {
      try {
        const n = await this.notification.create(uid, {
          type: 'CONSULT_REQUEST',
          title: `${urgLabel}협진 의뢰 도착`,
          message: `${reqDept} → ${patientName} 환자 협진 요청${consult.toDoctorId ? '' : `(${consult.toDepartment} 과)`}`,
          severity,
          refType: 'consultation',
          refId: consult.id,
        });
        this.notification.pushNotification(uid, {
          id: n.id, type: n.type, title: n.title, message: n.message,
          severity: n.severity, refType: n.refType ?? undefined, refId: n.refId ?? undefined,
        });
      } catch (e) {
        this.logger.warn(`협진 알림 대상 ${uid} 실패: ${e instanceof Error ? e.message : e}`);
      }
    }
    this.logger.log(`협진 ${consult.id} 알림 발송: ${recipientIds.length}명`);
  }

  async findAll(opts: { limit?: number; toDoctorId?: string; toDepartment?: string; status?: string; requestingDoctorId?: string } = {}) {
    const where: Record<string, unknown> = {};
    if (opts.requestingDoctorId) where.requestingDoctorId = opts.requestingDoctorId;
    if (opts.toDoctorId) where.toDoctorId = opts.toDoctorId;
    if (opts.toDepartment) where.toDepartment = opts.toDepartment;
    if (opts.status) where.status = opts.status.includes(',') ? { in: opts.status.split(',') } : opts.status;
    return this.prisma.consultation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
      include: {
        encounter: { select: { id: true, patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } } },
        requestingDoctor: { select: { familyName: true, givenName: true, department: true } },
        toDoctor: { select: { familyName: true, givenName: true } },
        replyDoctor: { select: { familyName: true, givenName: true } },
        closedBy: { select: { familyName: true, givenName: true } },
      },
    });
  }

  /** 내게 온 미처리 협진(지정의=나 OR 미지정+내 과) — 대시보드/워크스테이션 인박스 */
  async findInbox(userId: string, limit = 20) {
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { department: true } });
    const orConds: Record<string, unknown>[] = [{ toDoctorId: userId }];
    if (me?.department) orConds.push({ toDoctorId: null, toDepartment: me.department });
    return this.prisma.consultation.findMany({
      where: { status: { in: ['REQUESTED', 'ACCEPTED'] }, OR: orConds },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        encounter: { select: { id: true, patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } } },
        requestingDoctor: { select: { familyName: true, givenName: true, department: true } },
      },
    });
  }

  /**
   * 환자의 협진 전부(진료 여러 건 · 2026-10-10) — 🔴 차트 의뢰/회신 탭이 **가장 최근 진료 한 건**의 협진만 읽어
   *    그 전 진료에서 의뢰한 협진·회신이 차트에서 사라졌다. 최근 순 상한 100 + 전체 수.
   */
  async findByPatient(patientId: string, limit = 100) {
    const where = { encounter: { patientId } };
    const [items, total] = await Promise.all([
      this.prisma.consultation.findMany({
        where, orderBy: { createdAt: 'desc' }, take: limit,
        include: {
          encounter: { select: { id: true, createdAt: true } },
          requestingDoctor: { select: { familyName: true, givenName: true, department: true } },
          toDoctor: { select: { familyName: true, givenName: true, department: true } },
          replyDoctor: { select: { familyName: true, givenName: true, department: true } },
          closedBy: { select: { familyName: true, givenName: true } },
        },
      }),
      this.prisma.consultation.count({ where }),
    ]);
    return { items, total, truncated: total > items.length };
  }

  async findByEncounter(encounterId: string) {
    return this.prisma.consultation.findMany({
      where: { encounterId },
      include: {
        requestingDoctor: {
          select: { familyName: true, givenName: true, department: true },
        },
        toDoctor: {
          select: { familyName: true, givenName: true, department: true },
        },
        replyDoctor: {
          select: { familyName: true, givenName: true, department: true },
        },
        closedBy: { select: { familyName: true, givenName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPending(department: string) {
    return this.prisma.consultation.findMany({
      where: {
        toDepartment: department,
        status: { in: ['REQUESTED', 'ACCEPTED'] },
      },
      include: {
        requestingDoctor: {
          select: { familyName: true, givenName: true, department: true },
        },
        encounter: {
          select: {
            patient: {
              select: { familyName: true, givenName: true, mrn: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 수신자 권한 검증(ADMIN·지정의 본인·수신 과 소속만 회신/접수) */
  private async assertRecipient(consult: { toDoctorId: string | null; toDepartment: string }, userId: string, role?: string) {
    if (role === 'ADMIN') return;
    if (consult.toDoctorId) {
      if (consult.toDoctorId !== userId) throw new ForbiddenException('지정된 협진의만 처리할 수 있습니다.');
      return;
    }
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { department: true } });
    if (me?.department !== consult.toDepartment) throw new ForbiddenException('수신 과 소속 의료진만 처리할 수 있습니다.');
  }

  /** 협진 접수(REQUESTED→ACCEPTED) — 미지정 의뢰는 처리자에게 배정(claim) + 요청자 알림 */
  async accept(id: string, doctorId: string, role?: string) {
    const consult = await this.prisma.consultation.findUnique({
      where: { id },
      include: { encounter: { select: { patient: { select: { familyName: true, givenName: true } } } } },
    });
    if (!consult) throw new NotFoundException('협진을 찾을 수 없습니다.');
    if (consult.status !== 'REQUESTED') throw new ForbiddenException('이미 접수/회신된 협진입니다.');
    await this.assertRecipient(consult, doctorId, role);
    const updated = await this.prisma.consultation.update({
      where: { id },
      data: { status: 'ACCEPTED', toDoctorId: consult.toDoctorId ?? doctorId },
    });
    this.notifyRequester(consult, doctorId, '협진 접수', '협진이 접수되었습니다 — 회신 예정').catch((e) => this.logger.warn(`접수 알림 실패: ${e instanceof Error ? e.message : e}`));
    return updated;
  }

  async reply(
    id: string,
    data: {
      replyDoctorId: string;
      replyContent: string;
      recommendations?: string;
    },
    role?: string,
  ) {
    const consult = await this.prisma.consultation.findUnique({
      where: { id },
      include: { encounter: { select: { patient: { select: { familyName: true, givenName: true } } } } },
    });
    if (!consult) throw new NotFoundException('Consultation not found');
    await this.assertRecipient(consult, data.replyDoctorId, role);
    // 🔴 (2026-09-15 D1) 종전엔 상태를 보지 않아 **종결(CLOSED)된 협진에도 회신이 덮어써졌고**,
    //    이미 회신된 협진을 다시 회신하면 앞선 회신 내용·회신의·회신 시각이 사라졌다(임상 기록을 고쳐 쓴다).
    assertStateTransition(
      ConsultationService.TRANSITIONS,
      consult.status as ConsultationStatus,
      'REPLIED',
      ConsultationService.TX_CTX,
    );
    const upd = await this.prisma.consultation.updateMany({
      where: { id, status: consult.status },
      data: {
        replyDoctorId: data.replyDoctorId,
        replyContent: data.replyContent,
        recommendations: data.recommendations,
        repliedAt: new Date(),
        status: 'REPLIED',
      },
    });
    if (upd.count === 0) stateChangedConflict(ConsultationService.TX_CTX, consult.status);
    const updated = await this.prisma.consultation.findUnique({ where: { id } });
    // 원 요청자에게 회신 도착 알림(루프 폐쇄)
    this.notifyRequester(consult, data.replyDoctorId, '협진 회신 도착', '협진 회신이 도착했습니다').catch((e) => this.logger.warn(`회신 알림 실패: ${e instanceof Error ? e.message : e}`));
    return updated;
  }

  /** 요청자(requestingDoctorId)에게 상태 알림 */
  private async notifyRequester(
    consult: { id: string; requestingDoctorId: string; toDepartment: string; encounter?: { patient?: { familyName: string | null; givenName: string | null } | null } | null },
    actorId: string,
    title: string,
    action: string,
  ) {
    if (!consult.requestingDoctorId || consult.requestingDoctorId === actorId) return;
    const p = consult.encounter?.patient;
    const patientName = p ? `${p.familyName ?? ''}${p.givenName ?? ''}` : '환자';
    const n = await this.notification.create(consult.requestingDoctorId, {
      type: 'CONSULT_REPLY',
      title,
      message: `${consult.toDepartment} → ${patientName} 환자 ${action}`,
      severity: 'INFO',
      refType: 'consultation',
      refId: consult.id,
    });
    this.notification.pushNotification(consult.requestingDoctorId, {
      id: n.id, type: n.type, title: n.title, message: n.message,
      severity: n.severity, refType: n.refType ?? undefined, refId: n.refId ?? undefined,
    });
  }

  /**
   * 협진 종결. 회신 전(REQUESTED·ACCEPTED) 종결은 **막지 않는다** — 취소·불필요 판단은 임상 몫이고,
   * 막으면 종결하지 못한 협진이 목록에 쌓인다(판정 규칙 §4 "막으면 방치된다").
   * 다만 이미 종결된 것을 다시 종결하지는 않는다(멱등 — 일어난 사실을 다시 쓰지 않는다).
   */
  async close(id: string, userId?: string, role?: string) {
    const cur = await this.prisma.consultation.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Consultation not found');
    if (cur.status === 'CLOSED') return cur;
    // 🔴 (2026-10-10) 종전엔 의사면 누구나 남의 협진을 종결할 수 있었다 — 의뢰의·수신자(지정의·수신 과)·관리자만
    if (userId && role !== 'ADMIN' && cur.requestingDoctorId !== userId) await this.assertRecipient(cur, userId, role);
    const upd = await this.prisma.consultation.updateMany({
      where: { id, status: cur.status },
      // 🔴 (2026-10-10) 누가·언제 종결했는지 남긴다(종전엔 상태만 — 기존 종결 행은 null = 모름)
      data: { status: 'CLOSED', closedAt: new Date(), closedById: userId ?? null },
    });
    if (upd.count === 0) stateChangedConflict(ConsultationService.TX_CTX, cur.status);
    return this.prisma.consultation.findUnique({ where: { id } });
  }

  /** 협진 수신 과 목록(활성 의사 보유 과) — 생성 폼 드롭다운·알림 대상 일치 보장 */
  async getDepartments() {
    const rows = await this.prisma.user.findMany({
      where: { role: 'DOCTOR', isActive: true, department: { not: null } },
      distinct: ['department'],
      select: { department: true },
      orderBy: { department: 'asc' },
    });
    return rows.map((r) => r.department).filter(Boolean);
  }

  /** 특정 과 소속 활성 의사 목록 — 지정의(toDoctorId) 선택기 */
  async getDoctors(department?: string) {
    return this.prisma.user.findMany({
      where: { role: 'DOCTOR', isActive: true, ...(department ? { department } : {}) },
      select: { id: true, familyName: true, givenName: true, department: true },
      orderBy: [{ department: 'asc' }, { familyName: 'asc' }],
    });
  }
}
