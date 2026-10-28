import { Controller, Get, Post, Patch, Delete, Sse, Body, Param, Query, Req, UseGuards, MessageEvent, ParseUUIDPipe } from '@nestjs/common';
import { Observable, defer, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, MaxLength, IsUUID, IsBoolean, MinLength, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsultAgentGuard } from './consult-agent.guard';
import { ConsultRole } from './consult-role.decorator';
import { ConsultService } from './consult.service';
import { ConsultTemplateService } from './consult-template.service';
import { ConsultTeamService } from './consult-team.service';
import { ConsultStaffStreamGuard } from './consult-stream.guards';
import { AuditAiRead } from '../audit/no-audit.decorator';

class ReplyDto { @IsString() @MaxLength(2000) content!: string; }
class AiModeDto { @IsIn(['AUTO', 'SUGGEST', 'OFF']) mode!: string; }
class AssignDto { @IsString() agentUserId!: string; }
class EscalateDto { @IsString() @MaxLength(300) reason!: string; }
class NoteDto { @IsString() @MaxLength(2000) content!: string; }
/** 부서 큐 이관 — 분류 어휘는 개설 DTO·팀 정본과 같다(GENERAL/INTERNATIONAL/CHECKUP/BILLING) */
class RouteDto {
  @IsUUID() teamId!: string;
  @IsOptional() @IsIn(['GENERAL', 'INTERNATIONAL', 'CHECKUP', 'BILLING']) category?: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
class TemplateCreateDto {
  @IsString() @MinLength(1) @MaxLength(80) title!: string;
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
  /** 생략 = 팀장은 자기 팀·ADMIN 은 공용 · null = 공용(ADMIN 만) */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() teamId?: string | null;
}
class TemplateUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) body?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() teamId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
class SessionsQueryDto {
  @IsOptional() @IsIn(['ALL', 'OPEN', 'ACTIVE', 'WAITING', 'CLOSED']) status?: string;
  @IsOptional() @IsIn(['mine', 'team', 'unassigned', 'all']) scope?: string;
}

interface ConsultReq {
  user: { id: string; role: string; familyName?: string; givenName?: string };
  consultAgent: { teamId: string | null; role: string } | null;
}

// 직원 상담 데스크 — ConsultAgentGuard(상담원 등록 기반 접근)
@ApiTags('Consult Desk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ConsultAgentGuard)
@Controller('api/v1/consult')
export class ConsultStaffController {
  constructor(private readonly svc: ConsultService, private readonly templates: ConsultTemplateService, private readonly teamSvc: ConsultTeamService) {}

  private ctx(req: ConsultReq) {
    const isAdmin = req.consultAgent?.role === 'ADMIN' || req.user.role === 'ADMIN';
    return { userId: req.user.id, teamId: req.consultAgent?.teamId ?? null, isAdmin };
  }
  /** 직원 세션 EP 공통 — 팀 스코프(IDOR) 검증 */
  private async scope(req: ConsultReq, id: string) {
    const { teamId, isAdmin } = this.ctx(req);
    await this.svc.assertScope(id, { teamId, isAdmin });
  }

  @Get('sessions')
  @ApiOperation({ summary: '상담 세션 인박스(scope=mine|team|unassigned|all)' })
  async sessions(@Req() req: ConsultReq, @Query() q: SessionsQueryDto) {
    const { userId, teamId, isAdmin } = this.ctx(req);
    return { data: await this.svc.listSessions({ status: q.status, scope: q.scope, userId, teamId, isAdmin }) };
  }

  @Get('escalations')
  @ApiOperation({ summary: '미응답 SLA 에스컬레이션 세션' })
  async escalations() {
    return { data: await this.svc.listEscalations() };
  }

  @Get('sessions/:id/messages')
  @ApiOperation({ summary: '상담 메시지(직원용·한국어)' })
  async messages(@Req() req: ConsultReq, @Param('id') id: string) {
    await this.scope(req, id);
    return { data: await this.svc.staffMessages(id) };
  }

  @Post('sessions/:id/reply')
  @ApiOperation({ summary: '직원 답변(한국어→환자언어 번역)' })
  async reply(@Req() req: ConsultReq, @Param('id') id: string, @Body() dto: ReplyDto) {
    await this.scope(req, id);
    return { data: await this.svc.staffReply(id, req.user.id, dto.content) };
  }

  @Patch('sessions/:id/ai-mode')
  @ApiOperation({ summary: 'AI 모드 변경(AUTO/SUGGEST/OFF)' })
  async aiMode(@Req() req: ConsultReq, @Param('id') id: string, @Body() dto: AiModeDto) {
    await this.scope(req, id);
    return { data: await this.svc.setAiMode(id, dto.mode, req.user.id) };
  }

  @AuditAiRead('AiConsultDraft')

  @Get('sessions/:id/ai-draft')
  @ApiOperation({ summary: 'AI 초안 조회(SUGGEST)' })
  async aiDraft(@Req() req: ConsultReq, @Param('id') id: string) {
    await this.scope(req, id);
    return { data: await this.svc.getAiDraft(id) };
  }

  @Post('sessions/:id/video')
  @ApiOperation({ summary: '1:1 화상 시작/참가(직원=모더레이터)' })
  async video(@Req() req: ConsultReq, @Param('id') id: string) {
    await this.scope(req, id);
    const u = req.user;
    const name = `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() || '상담원';
    return { data: await this.svc.startVideo(id, 'STAFF', name, u.id) };
  }

  @Post('sessions/:id/claim')
  @ApiOperation({ summary: '상담 담당 배정(claim)' })
  async claim(@Req() req: ConsultReq, @Param('id') id: string) {
    await this.scope(req, id);
    return { data: await this.svc.claim(id, req.user.id) };
  }

  @Post('sessions/:id/close')
  @ApiOperation({ summary: '상담 종료' })
  async close(@Req() req: ConsultReq, @Param('id') id: string) {
    await this.scope(req, id);
    return { data: await this.svc.closeSession(id) };
  }

  // ── 에스컬레이션 & 내부노트(P2) ──
  @Post('sessions/:id/escalate')
  @ApiOperation({ summary: '팀장 에스컬레이션(사유)' })
  async escalate(@Req() req: ConsultReq, @Param('id') id: string, @Body() dto: EscalateDto) {
    await this.scope(req, id);
    return { data: await this.svc.escalate(id, req.user.id, dto.reason) };
  }

  @Post('sessions/:id/note')
  @ApiOperation({ summary: '내부 노트(환자 비노출)' })
  async note(@Req() req: ConsultReq, @Param('id') id: string, @Body() dto: NoteDto) {
    await this.scope(req, id);
    const role = req.consultAgent?.role ?? (req.user.role === 'ADMIN' ? 'ADMIN' : 'AGENT');
    return { data: await this.svc.addNote(id, req.user.id, role, dto.content) };
  }

  // ── 팀장 콘솔 ──
  @Get('lead/queue')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '팀장 큐 + 상담원 보드' })
  async leadQueue(@Req() req: ConsultReq) {
    const { teamId, isAdmin } = this.ctx(req);
    return { data: await this.svc.leadQueue({ teamId, isAdmin }) };
  }

  @Post('lead/sessions/:id/assign')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '팀장 배정/재배정' })
  async assign(@Req() req: ConsultReq, @Param('id') id: string, @Body() dto: AssignDto) {
    const { teamId, isAdmin } = this.ctx(req);
    await this.svc.assertScope(id, { teamId, isAdmin });
    return { data: await this.svc.assign(id, dto.agentUserId, req.user.id, { teamId, isAdmin }) };
  }

  @Post('lead/sessions/:id/co-reply')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '팀장 공동응답(담당 보존)' })
  async coReply(@Req() req: ConsultReq, @Param('id') id: string, @Body() dto: ReplyDto) {
    await this.scope(req, id);
    return { data: await this.svc.leadCoReply(id, req.user.id, dto.content) };
  }

  @Post('lead/sessions/:id/transfer')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '담당 이관(팀장 인수)' })
  async transfer(@Req() req: ConsultReq, @Param('id') id: string) {
    await this.scope(req, id);
    return { data: await this.svc.transfer(id, req.user.id) };
  }

  @Get('lead/teams')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '이관 대상 팀 목록(활성·이름·분류만) — 팀 세팅 목록(teams)은 ADMIN 전용이라 팀장용으로 좁혀 연다' })
  async leadTeams() {
    const teams = await this.teamSvc.listTeams();
    return { data: teams.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, categories: t.categories, isDefault: t.isDefault })) };
  }

  @Post('lead/sessions/:id/route')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '부서(팀) 큐 이관 — 수동(자동 분류 없음)·이전 담당 해제·직원 노트' })
  async route(@Req() req: ConsultReq, @Param('id') id: string, @Body() dto: RouteDto) {
    await this.scope(req, id);
    return { data: await this.svc.routeToTeam(id, dto.teamId, req.user.id, { category: dto.category, reason: dto.reason }) };
  }

  // ── 빠른답변 템플릿(입력 보조 — 전송하지 않는다) ──
  @Get('templates')
  @ApiOperation({ summary: '빠른답변 템플릿 목록(공용 + 내 팀 · ADMIN all=1 은 비활성 포함)' })
  async listTemplates(@Req() req: ConsultReq, @Query('all') all?: string) {
    return { data: await this.templates.list(this.ctx(req), all === '1') };
  }

  @Post('templates')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '빠른답변 템플릿 작성(팀장=자기 팀·ADMIN=공용 가능)' })
  async createTemplate(@Req() req: ConsultReq, @Body() dto: TemplateCreateDto) {
    return { data: await this.templates.create(this.ctx(req), dto) };
  }

  @Patch('templates/:id')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '빠른답변 템플릿 수정·활성 전환' })
  async updateTemplate(@Req() req: ConsultReq, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TemplateUpdateDto) {
    return { data: await this.templates.update(this.ctx(req), id, dto) };
  }

  @Delete('templates/:id')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '빠른답변 템플릿 비활성(삭제하지 않음)' })
  async deactivateTemplate(@Req() req: ConsultReq, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.templates.deactivate(this.ctx(req), id) };
  }

  @Post('lead/sessions/:id/resolve-escalation')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '에스컬레이션 해제(상담원 반환)' })
  async resolveEscalation(@Req() req: ConsultReq, @Param('id') id: string) {
    await this.scope(req, id);
    return { data: await this.svc.resolveEscalation(id, req.user.id) };
  }

  @Get('lead/analytics')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '상담 분석(기간·팀별 지표)' })
  async analytics(@Req() req: ConsultReq, @Query('days') days?: string) {
    const { teamId, isAdmin } = this.ctx(req);
    return { data: await this.svc.analytics({ teamId, isAdmin, days: days ? Number(days) : 7 }) };
  }

  @Post('lead/auto-assign')
  @ConsultRole('LEAD')
  @ApiOperation({ summary: '자동 배분(미배정→least-busy 상담원)' })
  async autoAssign(@Req() req: ConsultReq) {
    const { teamId, isAdmin, userId } = this.ctx(req);
    return { data: await this.svc.autoAssign({ teamId, isAdmin, byUserId: userId }) };
  }

  @Sse('sessions/:id/stream')
  @UseGuards(ConsultStaffStreamGuard)
  @ApiOperation({ summary: '상담 실시간 신호(SSE, 직원 전용 채널)' })
  stream(@Req() req: ConsultReq, @Param('id') id: string): Observable<MessageEvent> {
    const { teamId, isAdmin } = this.ctx(req);
    // 구독 전 팀 스코프 검증(미일치 시 스트림 에러로 종료)
    return defer(() => from(this.svc.assertScope(id, { teamId, isAdmin }))).pipe(
      switchMap(() => this.svc.getStaffStream(id) as unknown as Observable<MessageEvent>),
    );
  }
}
