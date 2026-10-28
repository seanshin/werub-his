import { Injectable, NotFoundException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DomainException } from '../../common/errors/domain.exception';
import * as E from '../../common/errors/domain-error-codes';

export interface TemplateCtx { userId: string; teamId: string | null; isAdmin: boolean }
export interface TemplateInput { title?: string; body?: string; teamId?: string | null; active?: boolean }

/**
 * 상담 빠른답변 템플릿 — 기획 portal-chat-consultation FR-12 "빠른 답변 템플릿(직원)".
 * 🔴 **입력 보조일 뿐 전송이 아니다**: 이 서비스는 ConsultMessage 를 만들지 않는다. 직원이 답변 칸에 넣고 직접 전송한다.
 * 🔴 시드 문구를 넣지 않는다 — 임상 판단·운영 수치(시간·금액)를 지어낸 기본 문구가 환자에게 나가던 사례가 있었다(빈 목록으로 시작).
 * 범위: teamId null = 전체 공용(ADMIN 만 작성·수정) · 팀 전용 = 그 팀 LEAD 또는 ADMIN. 삭제 대신 비활성.
 */
@Injectable()
export class ConsultTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /** 상담원 목록 — 활성 + (공용 ∪ 내 팀). ADMIN 은 includeInactive 로 관리용 전체 */
  async list(ctx: TemplateCtx, includeInactive = false) {
    const where: Record<string, unknown> = {};
    if (!(ctx.isAdmin && includeInactive)) where.active = true;
    if (!ctx.isAdmin) where.OR = [{ teamId: null }, ...(ctx.teamId ? [{ teamId: ctx.teamId }] : [])];
    return this.prisma.consultReplyTemplate.findMany({ where, orderBy: [{ teamId: 'asc' }, { title: 'asc' }] });
  }

  private assertWritable(ctx: TemplateCtx, teamId: string | null) {
    if (ctx.isAdmin) return;
    if (teamId === null || teamId !== ctx.teamId) {
      throw new DomainException(E.CONSULT_TEMPLATE_SCOPE, '팀장은 자기 팀 템플릿만 작성·수정할 수 있습니다(공용은 관리자)', HttpStatus.FORBIDDEN, { teamId });
    }
  }

  async create(ctx: TemplateCtx, dto: { title: string; body: string; teamId?: string | null }) {
    // 팀장이 팀을 비워 보내면 자기 팀으로(공용으로 조용히 올리지 않는다)
    const teamId = dto.teamId === undefined ? (ctx.isAdmin ? null : ctx.teamId) : dto.teamId;
    this.assertWritable(ctx, teamId);
    return this.prisma.consultReplyTemplate.create({
      data: { title: dto.title.trim(), body: dto.body, teamId, createdBy: ctx.userId },
    });
  }

  async update(ctx: TemplateCtx, id: string, dto: TemplateInput) {
    const cur = await this.prisma.consultReplyTemplate.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('템플릿 없음');
    this.assertWritable(ctx, cur.teamId);
    if (dto.teamId !== undefined) this.assertWritable(ctx, dto.teamId);
    return this.prisma.consultReplyTemplate.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.teamId !== undefined ? { teamId: dto.teamId } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        updatedBy: ctx.userId,
      },
    });
  }

  /** 삭제 대신 비활성 — 누가 어떤 문구를 썼는지 흔적을 지우지 않는다 */
  async deactivate(ctx: TemplateCtx, id: string) {
    return this.update(ctx, id, { active: false });
  }
}
