import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CONSULT_AUTO_REPLY_KEY, SAFE_DEFAULT_AI_MODE, isConsultAutoReplyAllowed } from './consult-ai-gate';

const CATEGORIES = ['GENERAL', 'INTERNATIONAL', 'CHECKUP', 'BILLING'];
const AI_MODES = ['AUTO', 'SUGGEST', 'OFF'];
const ROLES = ['AGENT', 'LEAD', 'ADMIN'];

export interface TeamInput {
  name?: string;
  description?: string | null;
  categories?: string[];
  locales?: string[] | null;
  defaultAiMode?: string;
  isDefault?: boolean;
  active?: boolean;
}

@Injectable()
export class ConsultTeamService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 라우팅: category/locale → 팀 ──
  async routeTeam(category?: string | null, locale?: string | null): Promise<string | null> {
    const teams = await this.prisma.consultTeam.findMany({ where: { active: true } });
    if (!teams.length) return null;
    const cat = category || 'GENERAL';
    const match = teams.find((t) => {
      const cats = (t.categories as string[] | null) ?? [];
      const locs = (t.locales as string[] | null) ?? [];
      const catOk = cats.length ? cats.includes(cat) : false;
      const locOk = locs.length ? (locale ? locs.includes(locale) : false) : true;
      return catOk && locOk;
    });
    if (match) return match.id;
    const def = teams.find((t) => t.isDefault);
    return def?.id ?? null;
  }

  // ── 팀 CRUD ──
  async listTeams() {
    const teams = await this.prisma.consultTeam.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    const counts = await this.prisma.consultAgent.groupBy({ by: ['teamId'], _count: { _all: true } });
    const cmap = new Map(counts.map((c) => [c.teamId, c._count._all]));
    return teams.map((t) => ({
      id: t.id, name: t.name, description: t.description,
      categories: (t.categories as string[] | null) ?? [],
      locales: (t.locales as string[] | null) ?? [],
      defaultAiMode: t.defaultAiMode, isDefault: t.isDefault, active: t.active,
      memberCount: cmap.get(t.id) ?? 0,
    }));
  }

  private async validate(dto: TeamInput) {
    if (dto.categories) for (const c of dto.categories) if (!CATEGORIES.includes(c)) throw new BadRequestException(`잘못된 카테고리: ${c}`);
    if (dto.defaultAiMode && !AI_MODES.includes(dto.defaultAiMode)) throw new BadRequestException('AI 모드는 AUTO/SUGGEST/OFF');
    // 🔴 팀 기본값으로 AUTO 를 심으면 그 팀의 **모든 신규 세션**이 사람 검토 없는 자동 전송이 된다
    //    — 세션 단위 게이트(setAiMode)와 같은 조건으로 막는다(한 곳만 막으면 다른 곳으로 들어온다).
    if (dto.defaultAiMode === 'AUTO' && !(await isConsultAutoReplyAllowed(this.prisma))) {
      throw new BadRequestException({
        code: 'CONSULT_AUTO_REPLY_DISABLED',
        message: `팀 기본 AI 모드 AUTO 는 사람 검토 없이 환자에게 전송되므로 기본 차단입니다. 시스템 설정 '${CONSULT_AUTO_REPLY_KEY}' 를 켠 뒤 다시 시도하세요.`,
      });
    }
  }

  async createTeam(dto: TeamInput) {
    if (!dto.name?.trim()) throw new BadRequestException('팀명 필수');
    await this.validate(dto);
    if (dto.isDefault) await this.prisma.consultTeam.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const t = await this.prisma.consultTeam.create({
      data: {
        name: dto.name.trim(), description: dto.description ?? null,
        categories: dto.categories ?? [], locales: dto.locales ?? undefined,
        defaultAiMode: dto.defaultAiMode ?? SAFE_DEFAULT_AI_MODE, isDefault: dto.isDefault ?? false,
      },
    });
    return { id: t.id };
  }

  async updateTeam(id: string, dto: TeamInput) {
    const t = await this.prisma.consultTeam.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('팀 없음');
    await this.validate(dto);
    if (dto.isDefault === true && !t.isDefault) await this.prisma.consultTeam.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    if (dto.isDefault === false && t.isDefault) throw new BadRequestException('기본팀은 다른 팀을 기본 지정해 해제하세요');
    await this.prisma.consultTeam.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? undefined, description: dto.description,
        categories: dto.categories ?? undefined, locales: dto.locales ?? undefined,
        defaultAiMode: dto.defaultAiMode ?? undefined, isDefault: dto.isDefault ?? undefined,
        active: dto.active ?? undefined,
      },
    });
    return { ok: true };
  }

  async deleteTeam(id: string) {
    const t = await this.prisma.consultTeam.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('팀 없음');
    if (t.isDefault) throw new BadRequestException('기본팀은 비활성화할 수 없습니다');
    await this.prisma.consultTeam.update({ where: { id }, data: { active: false } });
    return { ok: true };
  }

  // ── 멤버 ──
  async listMembers(teamId: string) {
    const agents = await this.prisma.consultAgent.findMany({ where: { teamId } });
    const userIds = agents.map((a) => a.userId);
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, familyName: true, givenName: true, role: true } });
    const umap = new Map(users.map((u) => [u.id, u]));
    const actives = await this.prisma.consultSession.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: userIds }, status: 'ACTIVE' }, _count: { _all: true } });
    const amap = new Map(actives.map((a) => [a.assigneeId, a._count._all]));
    return agents.map((a) => {
      const u = umap.get(a.userId);
      return {
        userId: a.userId, name: u ? `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() : a.userId,
        role: a.role, status: a.status, maxConcurrent: a.maxConcurrent,
        activeCount: amap.get(a.userId) ?? 0,
      };
    });
  }

  async upsertMember(teamId: string, userId: string, role: string, maxConcurrent?: number) {
    if (!ROLES.includes(role)) throw new BadRequestException('역할은 AGENT/LEAD/ADMIN');
    const team = await this.prisma.consultTeam.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('팀 없음');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('직원 없음');
    await this.prisma.consultAgent.upsert({
      where: { userId },
      create: { userId, teamId, role, maxConcurrent: maxConcurrent ?? 5 },
      update: { teamId, role, maxConcurrent: maxConcurrent ?? undefined },
    });
    return { ok: true };
  }

  async removeMember(teamId: string, userId: string) {
    const a = await this.prisma.consultAgent.findUnique({ where: { userId } });
    if (!a || a.teamId !== teamId) throw new NotFoundException('해당 팀 멤버 아님');
    await this.prisma.consultAgent.delete({ where: { userId } });
    return { ok: true };
  }
}
