import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { NotificationService } from '../notification/notification.service';
import { JourneyService } from '../journey/journey.service';

export type VocType = 'QUESTION' | 'COMPLAINT' | 'SUGGESTION' | 'COMPLIMENT';

export interface CreateTicketInput {
  type?: VocType;
  title: string;
  body: string;
  department?: string;
  category?: string;
  replyChannel?: 'PORTAL' | 'EMAIL' | 'SMS';
  consent: boolean;
  channel?: string;
  // 신청자(포털토큰 시 patientId는 서버가 주입, 위조 불가)
  patientId?: string | null;
  submitterName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

const VALID_TYPES: VocType[] = ['QUESTION', 'COMPLAINT', 'SUGGESTION', 'COMPLIMENT'];
// 본문 키워드 → 심각도 URGENT 자동 상향(환자안전)
const URGENT_KEYWORDS = ['사고', '감염', '낙상', '오투약', '투약오류', '자살', '응급', '사망'];

@Injectable()
export class VocService {
  private readonly logger = new Logger(VocService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
    @Optional() private readonly notify?: NotificationService,
    @Optional() private readonly journey?: JourneyService,
  ) {}

  /** 접수 활성 여부 게이트 */
  private async assertEnabled() {
    const on = String((await this.config.get('voc.enabled').catch(() => 'true')) ?? 'true') !== 'false';
    if (!on) throw new BadRequestException('현재 고객의 소리 접수가 일시 중단되었습니다.');
  }

  /**
   * 접수번호 생성 — VOC-YYYY-NNNNNN. tx 내 advisory lock 으로 동시성 직렬화(중복 방지).
   * 선례: consult.assignWithCapacity 의 pg_advisory_xact_lock.
   */
  private async genTicketNo(tx: any, year: number): Promise<string> {
    const prefix = `VOC-${year}-`;
    // 연도별 카운터 네임스페이스 잠금
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;
    const last = await tx.vocTicket.findFirst({
      where: { ticketNo: { startsWith: prefix } },
      orderBy: { ticketNo: 'desc' },
      select: { ticketNo: true },
    });
    let seq = 1;
    if (last) seq = parseInt(last.ticketNo.slice(prefix.length), 10) + 1;
    return `${prefix}${String(seq).padStart(6, '0')}`;
  }

  private deriveSeverity(type: VocType, title: string, body: string): string {
    const text = `${title} ${body}`;
    if (URGENT_KEYWORDS.some((k) => text.includes(k))) return 'URGENT';
    if (type === 'COMPLAINT') return 'HIGH';
    return 'NORMAL';
  }

  /** SLA 마감 계산 — 영업일 근사(주말 건너뜀, 공휴일은 P2에서 캘린더 연동) */
  private async computeDueAt(type: VocType, from = new Date()): Promise<Date> {
    // 🔴 (2026-10-01) 종전 `.catch(() => 2)` — 조회 실패 시 기본 2일 마감이 **티켓 원장에 박혔다**(원내 SLA 와 다른 값이 사실처럼). 실패는 전파(접수 실패로 알린다)
    const days = Number((await this.config.get(`voc.sla.${type}`)) ?? 2);
    const d = new Date(from);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return d;
  }

  /** 접수 생성 — 포털(본인확인) 또는 비회원 */
  async createTicket(input: CreateTicketInput) {
    await this.assertEnabled();
    if (!input.consent) throw new BadRequestException('개인정보 수집·이용 동의가 필요합니다.');
    const title = (input.title ?? '').trim();
    const body = (input.body ?? '').trim();
    if (!title || title.length > 300) throw new BadRequestException('제목을 300자 이내로 입력해주세요.');
    if (!body) throw new BadRequestException('문의 내용을 입력해주세요.');
    const type: VocType = VALID_TYPES.includes(input.type as VocType) ? (input.type as VocType) : 'QUESTION';

    const verified = !!input.patientId;
    if (!verified) {
      const allowAnon = String((await this.config.get('voc.allowAnonymous').catch(() => 'true')) ?? 'true') !== 'false';
      if (!allowAnon) throw new BadRequestException('본인 확인 후 문의를 접수할 수 있습니다.');
      if (!input.submitterName?.trim() || !(input.contactPhone?.trim() || input.contactEmail?.trim())) {
        throw new BadRequestException('비회원 문의는 성함과 연락처(전화 또는 이메일)가 필요합니다.');
      }
    }

    const severity = this.deriveSeverity(type, title, body);
    const dueAt = await this.computeDueAt(type);
    const year = new Date().getFullYear();
    // 라우팅: 부서 미지정 시 category→department 매핑(config voc.routing) 적용
    let department = input.department?.trim() || null;
    if (!department && input.category) {
      // 🔴 (2026-10-01) 종전 `.catch(() => ({}))` — 조회 실패 시 부서 배정 없이 저장돼 **아무 부서 목록에도 안 뜨는** 문의가 됐다. 실패는 전파
      const routing = (await this.config.get('voc.routing')) as Record<string, string>;
      if (routing && typeof routing === 'object' && routing[input.category]) department = routing[input.category];
    }

    const ticket = await this.prisma.$transaction(async (tx) => {
      const ticketNo = await this.genTicketNo(tx, year);
      return tx.vocTicket.create({
        data: {
          ticketNo,
          type,
          status: 'RECEIVED',
          severity,
          channel: input.channel ?? (verified ? 'PORTAL' : 'WEB'),
          patientId: input.patientId ?? null,
          identityVerified: verified,
          submitterName: input.submitterName?.trim() || null,
          contactPhone: input.contactPhone?.trim() || null,
          contactEmail: input.contactEmail?.trim() || null,
          replyChannel: input.replyChannel ?? 'PORTAL',
          title,
          department,
          category: input.category?.trim() || null,
          dueAt,
          consentAt: new Date(),
          messages: {
            create: {
              authorType: 'PATIENT',
              authorId: input.patientId ?? null,
              authorName: input.submitterName?.trim() || null,
              body,
            },
          },
        },
        select: { id: true, ticketNo: true, type: true, status: true, dueAt: true, createdAt: true },
      });
    });

    // 여정 이벤트(회원만) — fire-and-forget
    if (verified && input.patientId) {
      this.journey?.emit({
        patientId: input.patientId,
        eventType: 'voc.received',
        title: '고객의 소리 접수',
        description: `${this.typeLabel(type)} · ${title}`,
        refType: 'VocTicket',
        refId: ticket.id,
        navUrl: '/portal/voc',
        severity: severity === 'URGENT' ? 'WARNING' : 'INFO',
      });
    }

    this.logger.log(`VoC 접수 ${ticket.ticketNo} (${type}/${severity})`);
    return ticket;
  }

  private typeLabel(t: string): string {
    return { QUESTION: '질문', COMPLAINT: '불만', SUGGESTION: '건의', COMPLIMENT: '칭찬' }[t] ?? '문의';
  }

  /** 나의 문의 목록(포털 토큰 sub 기준) */
  async listMine(patientId: string) {
    const tickets = await this.prisma.vocTicket.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, ticketNo: true, type: true, status: true, severity: true,
        title: true, department: true, dueAt: true, firstResponseAt: true,
        closedAt: true, ratingScore: true, createdAt: true, updatedAt: true,
        _count: { select: { messages: { where: { internal: false } } } },
      },
    });
    return tickets.map((t) => ({ ...t, messageCount: t._count.messages, _count: undefined }));
  }

  /** 티켓 상세(스레드) — 소유자만. 내부 메모(internal) 제외 */
  async getMine(id: string, patientId: string) {
    const t = await this.prisma.vocTicket.findUnique({
      where: { id },
      include: {
        messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, url: true, fileName: true } },
      },
    });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    if (t.patientId !== patientId) throw new ForbiddenException('본인의 문의만 조회할 수 있습니다.');
    return t;
  }

  /** 환자 재질문(포털) — CLOSED면 REOPENED로 전이 */
  async addPatientMessage(id: string, patientId: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('내용을 입력해주세요.');
    const t = await this.prisma.vocTicket.findUnique({ where: { id }, select: { id: true, patientId: true, status: true, reopenCount: true, type: true, assigneeId: true, ticketNo: true } });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    if (t.patientId !== patientId) throw new ForbiddenException('본인의 문의만 이용할 수 있습니다.');

    const reopening = t.status === 'CLOSED';
    const dueAt = reopening ? await this.computeDueAt(t.type as VocType) : undefined;

    await this.prisma.$transaction([
      this.prisma.vocMessage.create({
        data: { ticketId: id, authorType: 'PATIENT', authorId: patientId, body: text },
      }),
      this.prisma.vocTicket.update({
        where: { id },
        data: reopening
          ? { status: 'REOPENED', reopenCount: { increment: 1 }, closedAt: null, firstResponseAt: null, ...(dueAt ? { dueAt } : {}) }
          : { updatedAt: new Date() },
      }),
    ]);

    // 담당자에게 알림(있으면)
    if (t.assigneeId) {
      this.notify?.notify(t.assigneeId, {
        type: reopening ? 'VOC_REOPENED' : 'VOC_PATIENT_REPLY',
        title: reopening ? '문의 재오픈' : '고객 추가 문의',
        message: `${t.ticketNo} — ${text.slice(0, 60)}`,
        severity: 'INFO',
        refType: 'VocTicket',
        refId: id,
      });
    }
    return { ok: true, reopened: reopening };
  }

  /** 첨부 추가(포털) — 본인 티켓. 저장 경로만 기록 */
  async addAttachment(id: string, patientId: string, url: string, fileName: string) {
    const t = await this.prisma.vocTicket.findUnique({ where: { id }, select: { id: true, patientId: true } });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    if (t.patientId !== patientId) throw new ForbiddenException('본인의 문의만 이용할 수 있습니다.');
    const a = await this.prisma.vocAttachment.create({ data: { ticketId: id, url, fileName, uploadedBy: 'PATIENT' }, select: { id: true, url: true, fileName: true } });
    return a;
  }

  /** 답변 만족도 평가(포털) — ANSWERED/CLOSED 본인 티켓·1~5. 재평가 허용 */
  async rate(id: string, patientId: string, score: number) {
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new BadRequestException('평점은 1~5 사이여야 합니다.');
    const t = await this.prisma.vocTicket.findUnique({ where: { id }, select: { id: true, patientId: true, status: true } });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    if (t.patientId !== patientId) throw new ForbiddenException('본인의 문의만 평가할 수 있습니다.');
    if (t.status !== 'ANSWERED' && t.status !== 'CLOSED') throw new BadRequestException('답변이 등록된 문의만 평가할 수 있습니다.');
    await this.prisma.vocTicket.update({ where: { id }, data: { ratingScore: score } });
    return { ok: true, ratingScore: score };
  }
}
