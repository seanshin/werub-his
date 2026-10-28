import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { canonicalJson } from '../../common/util/canonical-json';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SignIntegrationService } from '../sign-integration/sign-integration.service';

/** 거버넌스 봉인 스트림(D5) — 의사록·의결을 sign 해시체인에 append(오더의 his-orders 와 분리) */
export const GOVERNANCE_STREAM = 'his-governance';

/** 봉인 범위(C5) — 봉인 뒤 바꿀 수 없는 칸 */
const SEALED_FIELDS = ['minutes', 'decisions', 'attendees', 'title', 'scheduledAt'] as const;
/** 회의 기록 봉인 해시 — 키 정렬 JSON(재계산 가능) · 참석자는 정렬(순서는 기록이 아니다) */
export function meetingRecordSha256(m: { title: string; scheduledAt: Date; minutes: string | null; decisions: unknown; attendees: unknown }): string {
  const attendees = Array.isArray(m.attendees) ? [...(m.attendees as unknown[])].map(String).sort() : m.attendees ?? null;
  return createHash('sha256').update(canonicalJson({ title: m.title, scheduledAt: m.scheduledAt, minutes: m.minutes, decisions: m.decisions ?? null, attendees }), 'utf8').digest('hex');
}

@Injectable()
export class GldService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly sign?: SignIntegrationService,
  ) {}

  private async userMap(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter(Boolean) as string[])];
    const users = uniq.length ? await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, familyName: true, givenName: true, role: true, department: true } }) : [];
    return new Map(users.map((u) => [u.id, u]));
  }

  // ── 위원회 ──
  async listCommittees() {
    const rows = await this.prisma.committee.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { members: { where: { isActive: true } }, meetings: true } } },
    });
    const umap = await this.userMap(rows.map((c) => c.chairId));
    return rows.map((c) => ({ ...c, chair: c.chairId ? umap.get(c.chairId) ?? null : null, memberCount: c._count.members, meetingCount: c._count.meetings }));
  }

  /** code=거버넌스 관제 노출 키(unique·대문자) — 없으면 gld 전용 위원회로만 존재(관제 카드 비노출) */
  async createCommittee(data: { name: string; type: string; code?: string; quorum?: number; purpose?: string; charter?: string; meetingCycle?: string; chairId?: string }) {
    if (!data.name?.trim()) throw new BadRequestException('위원회명이 필요합니다');
    const code = data.code?.trim().toUpperCase() || undefined;
    if (code && !/^[A-Z0-9_]{2,20}$/.test(code)) throw new BadRequestException('코드는 영문 대문자·숫자 2~20자여야 합니다(예: DTC·QPS)');
    const quorum = data.quorum !== undefined ? Math.max(0, Math.floor(Number(data.quorum) || 0)) : undefined;
    try {
      return await this.prisma.committee.create({
        data: { name: data.name.trim(), type: data.type, code, quorum, purpose: data.purpose, charter: data.charter, meetingCycle: data.meetingCycle, chairId: data.chairId || undefined },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BadRequestException(`위원회 코드 '${code}' 는 이미 사용 중입니다`);
      throw e;
    }
  }

  async getCommittee(id: string) {
    const c = await this.prisma.committee.findUnique({
      where: { id },
      include: {
        members: { where: { isActive: true }, orderBy: { joinedAt: 'asc' } },
        meetings: { orderBy: { scheduledAt: 'desc' }, take: 10 },
        policies: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!c) throw new NotFoundException('위원회를 찾을 수 없습니다');
    const umap = await this.userMap([c.chairId, ...c.members.map((m) => m.userId)]);
    return {
      ...c,
      chair: c.chairId ? umap.get(c.chairId) ?? null : null,
      members: c.members.map((m) => ({ ...m, user: umap.get(m.userId) ?? null })),
    };
  }

  async updateCommittee(id: string, data: { name?: string; code?: string | null; quorum?: number; type?: string; purpose?: string; charter?: string; meetingCycle?: string; chairId?: string | null; isActive?: boolean }) {
    // 🔴 (2026-09-15 U2) 종전 `{ ...data }` — 컨트롤러가 `any` 본문을 넘겨 id·createdAt·관계 중첩 쓰기까지 Prisma data 로 들어갔다.
    //    DTO whitelist 와 별개로 여기서도 읽는 키만 옮긴다(다른 호출부가 생겨도 새지 않게).
    const patch: Record<string, unknown> = {
      name: data.name, type: data.type, purpose: data.purpose, charter: data.charter,
      meetingCycle: data.meetingCycle, isActive: data.isActive,
    };
    if (data.code !== undefined) {
      const code = data.code?.trim().toUpperCase() || null;
      if (code && !/^[A-Z0-9_]{2,20}$/.test(code)) throw new BadRequestException('코드는 영문 대문자·숫자 2~20자여야 합니다');
      patch.code = code;
    }
    if (data.quorum !== undefined) patch.quorum = Math.max(0, Math.floor(Number(data.quorum) || 0));
    if (data.chairId !== undefined) patch.chairId = data.chairId || null;
    try {
      return await this.prisma.committee.update({ where: { id }, data: patch });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BadRequestException('위원회 코드가 이미 사용 중입니다');
      throw e;
    }
  }

  /** 위원 역할 정본 — 여기 없는 값은 저장하지 않는다(어휘를 지어내지 않는다) */
  private static readonly MEMBER_ROLES = ['CHAIR', 'VICE_CHAIR', 'SECRETARY', 'MEMBER'];

  /**
   * 위원 임명 — **사람 계정에 연결한다.**
   *
   * 🔴 종전에는 `userId` 를 검증하지 않았다. 아무 uuid 나 위원이 될 수 있었고, 화면은
   *    이름을 못 찾으면 조용히 `null` 로 그렸다 — **이름 없는 위원**이 정족수를 채운다.
   * 🔴 비활성 위원이 남아 있으면 **되살린다**(새 행을 만들면 같은 사람이 두 줄이 된다).
   */
  async addMember(committeeId: string, userId: string, role: string, actorId?: string) {
    const wanted = (role || 'MEMBER').toUpperCase();
    if (!GldService.MEMBER_ROLES.includes(wanted)) {
      throw new BadRequestException(`위원 역할이 올바르지 않습니다: ${role}`);
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
    if (!user) throw new BadRequestException('존재하지 않는 사용자입니다 — 위원은 실제 계정에 연결되어야 합니다');
    if (!user.isActive) throw new BadRequestException('비활성 계정은 위원으로 임명할 수 없습니다');

    const exists = await this.prisma.committeeMember.findFirst({ where: { committeeId, userId } });
    if (exists) {
      // 🔴 화면에서 손댄 순간 **시드가 아니라 실제 임명**이 된다(사람이 확인한 것이다)
      return this.prisma.committeeMember.update({
        where: { id: exists.id },
        data: { role: wanted, isActive: true, source: 'MANUAL', appointedBy: actorId ?? null },
      });
    }
    return this.prisma.committeeMember.create({
      data: { committeeId, userId, role: wanted, source: 'MANUAL', appointedBy: actorId ?? null },
    });
  }

  async removeMember(memberId: string) {
    return this.prisma.committeeMember.update({ where: { id: memberId }, data: { isActive: false } });
  }

  // ── 회의 ──
  async listMeetings(params: { committeeId?: string; status?: string }) {
    const where: any = {};
    if (params.committeeId) where.committeeId = params.committeeId;
    if (params.status) where.status = params.status;
    const rows = await this.prisma.committeeMeeting.findMany({ where, orderBy: { scheduledAt: 'desc' }, take: 100, include: { committee: { select: { name: true, type: true } } } });
    return rows;
  }

  /**
   * 회의 참석자 정규화 — 🔴 **계정 id 로 받는다.**
   *
   * 종전에는 화면이 **이름을 콤마로 타이핑**받아 문자열 배열을 그대로 저장했고
   * (운영 실측 2026-08-28: `["a","b","c","d","e"]`), 정족수는 그 **배열 길이**만 셌다.
   * 그래서 아무 문자 다섯 개로 정족수 5가 충족됐다.
   *
   * 🔴 옛 데이터를 여기서 교정하지 않는다 — 그 문자열이 누구인지 모른다.
   *    새로 저장되는 것만 계정에 묶고, 옛 회의는 "대조 불가"로 남는다.
   */
  private async normalizeAttendees(committeeId: string, raw: unknown): Promise<string[]> {
    if (!Array.isArray(raw)) throw new BadRequestException('참석자는 배열이어야 합니다');
    const ids: string[] = [];
    for (const a of raw) {
      const v = typeof a === 'string' ? a : (a as { userId?: unknown } | null)?.userId;
      if (typeof v !== 'string' || !v.trim()) throw new BadRequestException('참석자는 사용자 계정으로 지정해야 합니다');
      ids.push(v.trim());
    }
    const uniq = [...new Set(ids)];
    if (uniq.length !== ids.length) throw new BadRequestException('참석자가 중복되었습니다');
    if (uniq.length === 0) return [];
    const users = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true } });
    if (users.length !== uniq.length) {
      throw new BadRequestException('존재하지 않는 사용자가 참석자에 있습니다 — 명부에서 선택하세요');
    }
    // 🔴 명부 밖 참석자를 **막지 않는다**(배석·외부 자문은 실제로 있다).
    //    정족수는 의결 시점에 명부와 대조된다(governance.quorumRosterGate).
    void committeeId;
    return uniq;
  }

  async createMeeting(data: { committeeId: string; title: string; scheduledAt: string; location?: string; agenda?: string; createdBy?: string; attendees?: unknown }) {
    if (!data.committeeId || !data.title?.trim() || !data.scheduledAt) throw new BadRequestException('위원회·제목·일시가 필요합니다');
    const attendees = data.attendees === undefined || data.attendees === null
      ? undefined
      : await this.normalizeAttendees(data.committeeId, data.attendees);
    return this.prisma.committeeMeeting.create({
      data: { committeeId: data.committeeId, title: data.title.trim(), scheduledAt: new Date(data.scheduledAt), location: data.location, agenda: data.agenda, createdBy: data.createdBy, attendees: attendees as never },
    });
  }

  async updateMeeting(id: string, data: { title?: string; scheduledAt?: string; location?: string; agenda?: string; minutes?: string; decisions?: unknown; attendees?: unknown; status?: string }) {
    // 봉인된 의사록은 불변(D5·append-only) — 개정이 필요하면 정정 회의록을 새 회의로 남긴다
    // 🔴 (2026-10-13 결함 발굴 C5) 종전엔 minutes 만 막아 봉인 뒤에도 의결(decisions)·참석자·제목·일시가 바뀌었다 — 봉인 범위 전부를 막는다
    if (SEALED_FIELDS.some((k) => data[k] !== undefined)) {
      const sealed = await this.prisma.committeeMeeting.findUnique({ where: { id }, select: { minutesSignedAt: true } });
      if (sealed?.minutesSignedAt) {
        throw new BadRequestException({ code: 'MINUTES_SEALED', message: '봉인된 회의 기록(의사록·의결·참석자·제목·일시)은 수정할 수 없습니다 — 정정은 새 회의록으로 남기세요' });
      }
    }
    let attendees: string[] | undefined;
    if (data.attendees !== undefined) {
      const m = await this.prisma.committeeMeeting.findUnique({ where: { id }, select: { committeeId: true } });
      if (!m) throw new NotFoundException('회의를 찾을 수 없습니다');
      attendees = await this.normalizeAttendees(m.committeeId, data.attendees);
    }
    return this.prisma.committeeMeeting.update({
      where: { id },
      data: {
        title: data.title, location: data.location, agenda: data.agenda, minutes: data.minutes,
        ...(data.scheduledAt ? { scheduledAt: new Date(data.scheduledAt) } : {}),
        ...(data.decisions !== undefined ? { decisions: data.decisions as never } : {}),
        ...(attendees !== undefined ? { attendees: attendees as never } : {}),
        ...(data.status ? { status: data.status } : {}),
      },
    });
  }

  /**
   * 의사록 sign 봉인(D5·P3) — 외부 sign 해시체인에 의사록 해시를 append 하고 영수증(entryHash)을 보관.
   * 원문은 원내(minutes 컬럼), 체인에는 sha256 만(PHI 미전송). anchor=true 로 스트림 head TSA 앵커.
   * 멱등: 이미 봉인이면 기존 영수증 반환. sign 미연동(EXTERNAL 아님)이면 명시 거부 — 조용한 무봉인 방지.
   */
  async sealMeetingMinutes(meetingId: string, userId: string, userRole?: string) {
    const meeting = await this.prisma.committeeMeeting.findUnique({
      where: { id: meetingId },
      include: { committee: { select: { code: true, name: true } } },
    });
    if (!meeting) throw new NotFoundException('회의를 찾을 수 없습니다');
    if (meeting.minutesSignedAt) {
      return { alreadySealed: true, minutesSignedAt: meeting.minutesSignedAt, minutesSignRef: meeting.minutesSignRef };
    }
    if (!meeting.minutes?.trim()) throw new BadRequestException('의사록이 비어 있습니다 — 작성 후 봉인하세요');
    if (meeting.status !== 'COMPLETED') throw new BadRequestException('회의 완료(확정) 후에만 봉인할 수 있습니다');
    if (!this.sign) {
      throw new BadRequestException({ code: 'SIGN_NOT_WIRED', message: 'sign 연동 모듈 미주입 — 봉인 불가' });
    }

    const minutesSha256 = createHash('sha256').update(meeting.minutes, 'utf8').digest('hex');
    // 🔴 (C5) 봉인은 회의 기록 전부(의사록·의결·참석자·제목·일시)를 덮는다 — 종전 해시는 의사록만, 참석자는 수만 실었다
    const recordSha256 = meetingRecordSha256(meeting);
    const attendeeCount = Array.isArray(meeting.attendees) ? (meeting.attendees as unknown[]).length : 0;
    const receipt = await this.sign.recordSignAuditEvent({
      userId,
      actorRole: userRole,
      action: 'GOVERNANCE_MINUTES_SEALED',
      targetType: 'CommitteeMeeting',
      targetRef: meetingId,
      stream: GOVERNANCE_STREAM,
      anchor: true,
      occurredAt: new Date().toISOString(),
      data: {
        committee: meeting.committee?.code ?? meeting.committee?.name ?? '',
        title: meeting.title,
        scheduledAt: meeting.scheduledAt.toISOString(),
        minutesSha256,
        recordSha256,
        attendeeCount: String(attendeeCount),
      },
    });
    if (!receipt.ok) {
      throw new BadRequestException({
        code: receipt.skipped ? 'SIGN_DISABLED' : 'SEAL_FAILED',
        message: receipt.skipped
          ? `sign 연동이 비활성입니다(${receipt.reason ?? 'EXTERNAL 아님'}) — 봉인은 연동 활성 후 가능합니다`
          : `봉인 실패: ${receipt.reason ?? '원인 미상'}`,
      });
    }
    // 🔴 (C5) 읽은 뒤 봉인 쓰기 전까지 기록이 바뀌었으면 봉인하지 않는다(종전엔 잠금 없음 — TOCTOU) ·
    //    봉인 쓰기는 아직 봉인되지 않은 행에만(동시 봉인 두 번이 서로 덮지 않게)
    const now = await this.prisma.committeeMeeting.findUnique({ where: { id: meetingId } });
    if (!now || meetingRecordSha256(now) !== recordSha256) {
      throw new ConflictException({ code: 'SEAL_CONTENT_CHANGED', message: '봉인하는 사이 회의 기록이 바뀌어 봉인하지 않았습니다(체인 영수증은 남았습니다) — 다시 봉인하세요' });
    }
    const signedAt = new Date();
    const claimed = await this.prisma.committeeMeeting.updateMany({
      where: { id: meetingId, minutesSignedAt: null },
      data: { minutesSignedAt: signedAt, minutesSignRef: receipt.entryHash ?? null },
    });
    if (claimed.count !== 1) {
      const m = await this.prisma.committeeMeeting.findUnique({ where: { id: meetingId }, select: { minutesSignedAt: true, minutesSignRef: true } });
      return { alreadySealed: true, minutesSignedAt: m?.minutesSignedAt ?? null, minutesSignRef: m?.minutesSignRef ?? null };
    }
    return { sealed: true, minutesSignedAt: signedAt, minutesSignRef: receipt.entryHash ?? null, recordSha256, anchorHead: receipt.anchorHead ?? null };
  }

  // ── 정책/규정 ──
  async listPolicies(params: { category?: string; status?: string }) {
    const where: any = {};
    if (params.category) where.category = params.category;
    if (params.status) where.status = params.status;
    const rows = await this.prisma.institutionalPolicy.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, include: { committee: { select: { name: true } } } });
    const umap = await this.userMap(rows.map((p) => p.approvedBy));
    const now = new Date();
    return rows.map((p) => ({ ...p, approver: p.approvedBy ? umap.get(p.approvedBy) ?? null : null, reviewDue: !!p.reviewDate && p.reviewDate < now && p.status === 'ACTIVE' }));
  }

  async createPolicy(data: { code?: string; title: string; category: string; content?: string; committeeId?: string; effectiveDate?: string; reviewDate?: string }) {
    if (!data.title?.trim()) throw new BadRequestException('정책명이 필요합니다');
    return this.prisma.institutionalPolicy.create({
      data: {
        code: data.code, title: data.title.trim(), category: data.category, content: data.content, committeeId: data.committeeId || undefined,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : undefined,
        reviewDate: data.reviewDate ? new Date(data.reviewDate) : undefined,
      },
    });
  }

  async updatePolicy(id: string, data: { title?: string; content?: string; status?: string; reviewDate?: string; version?: string }) {
    return this.prisma.institutionalPolicy.update({
      where: { id },
      data: { title: data.title, content: data.content, status: data.status, version: data.version, ...(data.reviewDate ? { reviewDate: new Date(data.reviewDate) } : {}) },
    });
  }

  async approvePolicy(id: string, approverId: string) {
    return this.prisma.institutionalPolicy.update({ where: { id }, data: { status: 'ACTIVE', approvedBy: approverId, approvedAt: new Date(), effectiveDate: new Date() } });
  }

  // ── 대시보드 ──
  async getDashboard() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [committees, meetingsThisMonth, activePolicies, reviewDue, draftPolicies] = await Promise.all([
      this.prisma.committee.count({ where: { isActive: true } }),
      this.prisma.committeeMeeting.count({ where: { scheduledAt: { gte: monthStart } } }),
      this.prisma.institutionalPolicy.count({ where: { status: 'ACTIVE' } }),
      this.prisma.institutionalPolicy.findMany({ where: { status: 'ACTIVE', reviewDate: { lt: now } }, orderBy: { reviewDate: 'asc' }, take: 10, select: { id: true, title: true, category: true, reviewDate: true } }),
      this.prisma.institutionalPolicy.count({ where: { status: 'DRAFT' } }),
    ]);
    return { committees, meetingsThisMonth, activePolicies, draftPolicies, reviewDueCount: reviewDue.length, reviewDue };
  }
}
