import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { JourneyService } from '../journey/journey.service';

export interface InboxFilter {
  status?: string;   // 티켓 상태
  type?: string;     // 티켓 유형
  sla?: string;      // 'overdue'
  channel?: string;  // 'ticket' | 'consult' | 'all'
  assigneeId?: string;
}

@Injectable()
export class VocAdminService {
  private readonly logger = new Logger(VocAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notify?: NotificationService,
    @Optional() private readonly journey?: JourneyService,
  ) {}

  /** 통합 인박스 — 비동기 VocTicket + 실시간 ConsultSession 합산(정규화). KPI 포함 */
  async inbox(filter: InboxFilter = {}) {
    const wantConsult = filter.channel !== 'ticket';
    const wantTicket = filter.channel !== 'consult';
    const now = Date.now();

    // ── VocTicket ──
    let tickets: any[] = [];
    if (wantTicket) {
      const where: any = {};
      if (filter.status && filter.status !== 'ALL') where.status = filter.status;
      else where.status = { notIn: ['CLOSED'] };
      if (filter.type) where.type = filter.type;
      if (filter.assigneeId) where.assigneeId = filter.assigneeId;
      if (filter.sla === 'overdue') { where.dueAt = { lt: new Date() }; where.firstResponseAt = null; }
      const rows = await this.prisma.vocTicket.findMany({
        where, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], take: 100,
        select: {
          id: true, ticketNo: true, type: true, status: true, severity: true, channel: true,
          title: true, department: true, assigneeId: true, dueAt: true, firstResponseAt: true,
          identityVerified: true, submitterName: true, createdAt: true, updatedAt: true,
          patient: { select: { mrn: true, familyName: true, givenName: true } },
        },
      });
      tickets = rows.map((t) => ({
        kind: 'ticket', id: t.id, ref: t.ticketNo, type: t.type, status: t.status, severity: t.severity,
        channel: t.channel, title: t.title, department: t.department, assigneeId: t.assigneeId,
        dueAt: t.dueAt, firstResponseAt: t.firstResponseAt,
        overdue: !!(t.dueAt && !t.firstResponseAt && t.dueAt.getTime() < now),
        patient: t.patient ? { mrn: t.patient.mrn, name: `${t.patient.familyName}${t.patient.givenName}` } : (t.submitterName ? { mrn: '비회원', name: t.submitterName } : null),
        identityVerified: t.identityVerified, updatedAt: t.updatedAt, createdAt: t.createdAt,
      }));
    }

    // ── ConsultSession(실시간) ──
    let sessions: any[] = [];
    // 🔴 상태 필터를 티켓에만 걸어, '접수'만 골라도 상담 '대기·상담중' 6건이 그대로 섞여 나왔다
    //    (2026-08-13 W6 실측: 무필터 13 → ?status=RECEIVED 12). 세션에도 같은 뜻으로 적용한다.
    //    티켓 RECEIVED ↔ 세션 OPEN/WAITING(미착수), 티켓 IN_PROGRESS ↔ 세션 ACTIVE.
    const SESSION_STATUS_BY_TICKET: Record<string, string[]> = {
      RECEIVED: ['OPEN', 'WAITING'],
      IN_PROGRESS: ['ACTIVE'],
    };
    const sessionStatuses = filter.status
      ? SESSION_STATUS_BY_TICKET[filter.status] ?? []
      : ['OPEN', 'WAITING', 'ACTIVE'];
    if (wantConsult && filter.sla !== 'overdue' && !filter.type && sessionStatuses.length > 0) {
      const rows = await this.prisma.consultSession.findMany({
        where: { status: { in: sessionStatuses } },
        orderBy: { updatedAt: 'desc' }, take: 100,
        select: {
          id: true, status: true, category: true, priority: true, escalationLevel: true,
          assigneeId: true, updatedAt: true, createdAt: true, patientId: true,
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { sender: true, content: true, contentKo: true, createdAt: true } },
        },
      });
      const pids = [...new Set(rows.map((r) => r.patientId))];
      const patients = await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, mrn: true, familyName: true, givenName: true } });
      const pmap = new Map(patients.map((p) => [p.id, p]));
      sessions = rows.map((s) => {
        const last = s.messages[0];
        const waitingForHuman = last && last.sender === 'PATIENT';
        const p = pmap.get(s.patientId);
        return {
          kind: 'consult', id: s.id, ref: `상담 ${s.id.slice(0, 8)}`, type: 'CONSULT', status: s.status,
          severity: s.priority === 'URGENT' ? 'URGENT' : s.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
          channel: 'CONSULT', title: last ? (last.contentKo ?? last.content).slice(0, 60) : '상담 세션',
          department: s.category, assigneeId: s.assigneeId,
          waitingSec: waitingForHuman ? Math.round((now - new Date(last.createdAt).getTime()) / 1000) : 0,
          escalationLevel: s.escalationLevel,
          patient: p ? { mrn: p.mrn, name: `${p.familyName}${p.givenName}` } : null,
          updatedAt: s.updatedAt, createdAt: s.createdAt,
        };
      });
    }

    const items = [...tickets, ...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // KPI
    const [unassigned, overdueCount, openTickets, waitingConsult] = await Promise.all([
      this.prisma.vocTicket.count({ where: { status: { notIn: ['CLOSED'] }, assigneeId: null } }),
      this.prisma.vocTicket.count({ where: { status: { notIn: ['CLOSED'] }, firstResponseAt: null, dueAt: { lt: new Date() } } }),
      this.prisma.vocTicket.count({ where: { status: { notIn: ['CLOSED'] } } }),
      this.prisma.consultSession.count({ where: { status: { in: ['OPEN', 'WAITING'] }, assigneeId: null } }),
    ]);
    return { items, kpi: { unassigned, overdue: overdueCount, openTickets, waitingConsult } };
  }

  async getTicket(id: string) {
    const t = await this.prisma.vocTicket.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, url: true, fileName: true, uploadedBy: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true, phone: true } },
      },
    });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    return t;
  }

  /** 분류·심각도·부서·상태 변경 */
  async updateTicket(id: string, patch: { status?: string; severity?: string; category?: string; department?: string }) {
    const t = await this.prisma.vocTicket.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    const data: any = {};
    if (patch.status) data.status = patch.status;
    if (patch.severity) data.severity = patch.severity;
    if (patch.category !== undefined) data.category = patch.category || null;
    if (patch.department !== undefined) data.department = patch.department || null;
    if (patch.status === 'CLOSED') data.closedAt = new Date();
    return this.prisma.vocTicket.update({ where: { id }, data });
  }

  /** 담당 배정 → IN_PROGRESS + 담당자 알림 */
  async assign(id: string, assigneeId: string, byUserId: string) {
    const t = await this.prisma.vocTicket.findUnique({ where: { id }, select: { id: true, ticketNo: true, status: true } });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    await this.prisma.vocTicket.update({
      where: { id },
      data: { assigneeId, status: t.status === 'RECEIVED' || t.status === 'TRIAGED' ? 'IN_PROGRESS' : t.status },
    });
    this.notify?.notify(assigneeId, {
      type: 'VOC_ASSIGNED', title: 'VoC 배정', message: `${t.ticketNo} 문의가 배정되었습니다.`,
      severity: 'INFO', refType: 'VocTicket', refId: id,
    });
    return { ok: true };
  }

  /** 직원 답변/내부메모. 비내부 첫 응답 → firstResponseAt + ANSWERED. 내부메모 → 상태 불변 */
  async addStaffMessage(id: string, userId: string, userName: string, body: string, internal: boolean, aiDraft = false) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('내용을 입력해주세요.');
    const t = await this.prisma.vocTicket.findUnique({ where: { id }, select: { id: true, patientId: true, firstResponseAt: true, status: true, type: true, title: true } });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');

    await this.prisma.vocMessage.create({
      // aiDraft(STAFF 메시지) = AI 초안에서 출발한 답변 — 저자는 직원(authorType STAFF), 출발점만 남긴다
      data: { ticketId: id, authorType: 'STAFF', authorId: userId, authorName: userName, body: text, internal, aiDraft },
    });
    if (!internal) {
      await this.prisma.vocTicket.update({
        where: { id },
        data: { status: 'ANSWERED', ...(t.firstResponseAt ? {} : { firstResponseAt: new Date() }) },
      });
      // 여정(회원): 답변 등록
      if (t.patientId) {
        this.journey?.emit({
          patientId: t.patientId, eventType: 'voc.answered', title: '고객의 소리 답변',
          description: t.title, refType: 'VocTicket', refId: id, navUrl: '/portal/voc', severity: 'INFO',
        });
      }
    }
    return { ok: true };
  }

  async close(id: string) {
    const t = await this.prisma.vocTicket.findUnique({ where: { id }, select: { id: true, patientId: true, title: true } });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    await this.prisma.vocTicket.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
    if (t.patientId) {
      this.journey?.emit({ patientId: t.patientId, eventType: 'voc.closed', title: '고객의 소리 종결', description: t.title, refType: 'VocTicket', refId: id, severity: 'INFO' });
    }
    return { ok: true };
  }

  async reopen(id: string) {
    const t = await this.prisma.vocTicket.findUnique({ where: { id }, select: { id: true, reopenCount: true } });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    await this.prisma.vocTicket.update({ where: { id }, data: { status: 'REOPENED', closedAt: null, reopenCount: { increment: 1 } } });
    return { ok: true };
  }

  /** 상담 세션 → VocTicket 승격(불만/개선 소지). 대화 요약을 초기 메시지로. 중복(consultSessionId) 방지 */
  async promoteConsult(sessionId: string, type = 'COMPLAINT', title?: string) {
    const existing = await this.prisma.vocTicket.findFirst({ where: { consultSessionId: sessionId }, select: { id: true, ticketNo: true } });
    if (existing) return { ...existing, alreadyPromoted: true };

    const s = await this.prisma.consultSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
    });
    if (!s) throw new NotFoundException('상담 세션을 찾을 수 없습니다.');
    const firstPatient = s.messages.find((m) => m.sender === 'PATIENT');
    const ttl = (title?.trim() || (firstPatient ? (firstPatient.contentKo ?? firstPatient.content).slice(0, 100) : '상담 승격 건')) || '상담 승격 건';
    const summary = s.messages
      .map((m) => `[${m.sender === 'PATIENT' ? '고객' : m.sender === 'AI' ? 'WeRU.B' : '상담팀'}] ${(m.contentKo ?? m.content).slice(0, 300)}`)
      .join('\n');

    const year = new Date().getFullYear();
    const ticket = await this.prisma.$transaction(async (tx) => {
      const prefix = `VOC-${year}-`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;
      const last = await tx.vocTicket.findFirst({ where: { ticketNo: { startsWith: prefix } }, orderBy: { ticketNo: 'desc' }, select: { ticketNo: true } });
      const seq = last ? parseInt(last.ticketNo.slice(prefix.length), 10) + 1 : 1;
      const ticketNo = `${prefix}${String(seq).padStart(6, '0')}`;
      return tx.vocTicket.create({
        data: {
          ticketNo, type, status: 'IN_PROGRESS', severity: type === 'COMPLAINT' ? 'HIGH' : 'NORMAL',
          channel: 'CONSULT', consultSessionId: sessionId, patientId: s.patientId, identityVerified: true,
          title: ttl, department: s.category, assigneeId: s.assigneeId,
          messages: { create: { authorType: 'SYSTEM', body: `[상담 세션 승격]\n${summary}` } },
        },
        select: { id: true, ticketNo: true },
      });
    });
    this.logger.log(`상담 세션 ${sessionId} → VoC ${ticket.ticketNo} 승격`);
    return ticket;
  }

  /** VocTicket → 개선과제(SurveyActionItem) 승격 */
  async promoteAction(id: string, department: string, priority = 'MEDIUM', title?: string) {
    const t = await this.prisma.vocTicket.findUnique({
      where: { id },
      include: { messages: { where: { internal: false }, orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    if (t.actionItemId) throw new BadRequestException('이미 개선과제로 승격된 문의입니다.');
    const desc = `[VoC ${t.ticketNo}] ${t.messages[0]?.body?.slice(0, 500) ?? t.title}`;
    const action = await this.prisma.surveyActionItem.create({
      data: { department, title: title?.trim() || t.title, description: desc, priority, status: 'OPEN' },
      select: { id: true, title: true },
    });
    await this.prisma.vocTicket.update({ where: { id }, data: { actionItemId: action.id } });
    return { ok: true, actionItemId: action.id };
  }

  /** VoC 통계 — 3채널 합산·SLA 준수·처리시간·재오픈·만족도 */
  async analytics(days = 30) {
    const from = new Date(Date.now() - days * 86400_000);
    const tickets = await this.prisma.vocTicket.findMany({
      where: { createdAt: { gte: from } },
      select: { type: true, status: true, channel: true, department: true, dueAt: true, firstResponseAt: true, closedAt: true, createdAt: true, reopenCount: true, ratingScore: true },
    });
    const total = tickets.length;
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byDept: Record<string, number> = {};
    let firstRespSum = 0, firstRespN = 0, resolSum = 0, resolN = 0, slaMet = 0, slaN = 0, reopened = 0, ratingSum = 0, ratingN = 0;
    for (const t of tickets) {
      byType[t.type] = (byType[t.type] ?? 0) + 1;
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      if (t.department) byDept[t.department] = (byDept[t.department] ?? 0) + 1;
      if (t.firstResponseAt) {
        firstRespSum += t.firstResponseAt.getTime() - t.createdAt.getTime(); firstRespN++;
      }
      // 🔴 종전엔 응답한 티켓만 분모에 넣어 **기한을 넘긴 채 미응답인 건이 계수 자체에서 빠졌다**
      //    → 인박스는 "SLA 초과 6건", 통계는 "준수율 100%"라고 같은 화면에서 충돌했다(2026-08-13 W6).
      //    기한이 있는 티켓은 전부 분모다. 미응답+기한경과는 위반이다.
      if (t.dueAt) {
        slaN++;
        const met = t.firstResponseAt ? t.firstResponseAt <= t.dueAt : new Date() <= t.dueAt;
        if (met) slaMet++;
      }
      if (t.closedAt) { resolSum += t.closedAt.getTime() - t.createdAt.getTime(); resolN++; }
      if (t.reopenCount > 0) reopened++;
      if (t.ratingScore != null) { ratingSum += t.ratingScore; ratingN++; }
    }
    const consultCount = await this.prisma.consultSession.count({ where: { createdAt: { gte: from } } });
    return {
      days, total, consultCount, combinedTotal: total + consultCount,
      byType, byStatus, byDept,
      avgFirstResponseHours: firstRespN ? +(firstRespSum / firstRespN / 3600000).toFixed(1) : null,
      avgResolutionHours: resolN ? +(resolSum / resolN / 3600000).toFixed(1) : null,
      slaComplianceRate: slaN ? Math.round((slaMet / slaN) * 100) : null,
      /** 🔴 준수율의 분자·분모 — 내부에만 있던 `slaMet / slaN`(기한이 있는 티켓 전량)을 노출한다 */
      slaNumerator: slaMet,
      slaDenominator: slaN,
      // 🔴 티켓이 0건이면 재오픈율은 0%(=재오픈 없음)가 아니라 산출 불가다.
      reopenRate: total ? Math.round((reopened / total) * 100) : null,
      reopenNumerator: reopened,
      reopenDenominator: total,
      avgRating: ratingN ? +(ratingSum / ratingN).toFixed(1) : null,
    };
  }
}
