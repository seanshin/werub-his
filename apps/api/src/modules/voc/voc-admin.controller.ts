import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsOptional, IsString, IsBoolean, IsIn, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VocAdminService } from './voc-admin.service';
import { VocAiService } from './voc-ai.service';

class UpdateDto {
  @IsOptional() @IsIn(['RECEIVED', 'TRIAGED', 'IN_PROGRESS', 'ANSWERED', 'ON_HOLD', 'CLOSED', 'REOPENED']) status?: string;
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) severity?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(60) department?: string;
}
class AssignDto { @IsString() assigneeId!: string; }
class MessageDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @IsBoolean() internal?: boolean;
  /** 🔴 초안≠확정 — 답변이 AI 초안에서 출발했으면 true(프로비넌스). 직원이 검토·서명한 답변이며 저자는 직원이다 */
  @IsOptional() @IsBoolean() aiDraft?: boolean;
}
class PromoteConsultDto {
  @IsOptional() @IsIn(['QUESTION', 'COMPLAINT', 'SUGGESTION', 'COMPLIMENT']) type?: string;
  @IsOptional() @IsString() @MaxLength(300) title?: string;
}
class PromoteActionDto {
  @IsString() @MaxLength(60) department!: string;
  @IsOptional() @IsIn(['HIGH', 'MEDIUM', 'LOW']) priority?: string;
  @IsOptional() @IsString() @MaxLength(300) title?: string;
}

@ApiTags('Admin VoC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.CRM_MANAGER, UserRole.CRM_STAFF) // 원무/QI = 고객관계(CRM) + 관리자
@Controller('api/v1/admin/voc')
export class VocAdminController {
  constructor(private readonly svc: VocAdminService, private readonly ai: VocAiService) {}

  @Get('inbox')
  @ApiOperation({ summary: '통합 인박스(VocTicket + ConsultSession) + KPI' })
  async inbox(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('sla') sla?: string,
    @Query('channel') channel?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    return { data: await this.svc.inbox({ status, type, sla, channel, assigneeId }) };
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: '티켓 상세(스레드·내부메모 포함)' })
  async detail(@Param('id') id: string) {
    return { data: await this.svc.getTicket(id) };
  }

  @Patch('tickets/:id')
  @ApiOperation({ summary: '분류·심각도·부서·상태 변경' })
  async update(@Param('id') id: string, @Body() dto: UpdateDto) {
    return { data: await this.svc.updateTicket(id, dto) };
  }

  @Post('tickets/:id/assign')
  @ApiOperation({ summary: '담당 배정' })
  async assign(@Param('id') id: string, @Body() dto: AssignDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.assign(id, dto.assigneeId, userId) };
  }

  @Post('tickets/:id/claim')
  @ApiOperation({ summary: '나에게 배정' })
  async claim(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.assign(id, userId, userId) };
  }

  @Post('tickets/:id/messages')
  @ApiOperation({ summary: '답변 / 내부메모' })
  async message(@Param('id') id: string, @Body() dto: MessageDto, @CurrentUser() user: { id: string; name?: string; familyName?: string; givenName?: string }) {
    const name = user.name || `${user.familyName ?? ''}${user.givenName ?? ''}` || '담당자';
    return { data: await this.svc.addStaffMessage(id, user.id, name, dto.body, !!dto.internal, !!dto.aiDraft) };
  }

  @Post('tickets/:id/close')
  @ApiOperation({ summary: '종결' })
  async close(@Param('id') id: string) {
    return { data: await this.svc.close(id) };
  }

  @Post('tickets/:id/reopen')
  @ApiOperation({ summary: '재오픈' })
  async reopen(@Param('id') id: string) {
    return { data: await this.svc.reopen(id) };
  }

  @Post('consult/:sessionId/promote')
  @ApiOperation({ summary: '상담 세션 → VoC 티켓 승격(불만/개선 소지)' })
  async promoteConsult(@Param('sessionId') sessionId: string, @Body() dto: PromoteConsultDto) {
    return { data: await this.svc.promoteConsult(sessionId, dto.type, dto.title) };
  }

  @Post('tickets/:id/promote-action')
  @ApiOperation({ summary: 'VoC → 개선과제(SurveyActionItem) 승격' })
  async promoteAction(@Param('id') id: string, @Body() dto: PromoteActionDto) {
    return { data: await this.svc.promoteAction(id, dto.department, dto.priority, dto.title) };
  }

  @Get('analytics')
  @ApiOperation({ summary: 'VoC 통계(3채널 합산·SLA·처리시간·재오픈·만족도)' })
  async analytics(@Query('days') days?: string) {
    return { data: await this.svc.analytics(days ? Number(days) : 30) };
  }

  // ── AI 컨시어지 C1~C5 (전부 게이트 OFF 기본·Human-in-loop) ──
  @Post('tickets/:id/ai/classify')
  @ApiOperation({ summary: 'C1 자동 분류 제안(적용은 사람)' })
  async aiClassify(@Param('id') id: string) {
    return { data: await this.ai.classify(id) };
  }

  @Post('tickets/:id/ai/quick-answer')
  @ApiOperation({ summary: 'C2 즉답 초안(aiDraft·미발송)' })
  async aiQuickAnswer(@Param('id') id: string) {
    return { data: await this.ai.quickAnswerDraft(id) };
  }

  @Post('tickets/:id/ai/reply-assist')
  @ApiOperation({ summary: 'C3 답변 초안 보조' })
  async aiReplyAssist(@Param('id') id: string, @Body() dto: { note?: string }) {
    return { data: await this.ai.replyAssist(id, dto?.note) };
  }

  @Post('ai/translate')
  @ApiOperation({ summary: 'C4 다국어 번역' })
  async aiTranslate(@Body() dto: { text: string; targetLang: string }) {
    return { data: await this.ai.translate(dto.text, dto.targetLang) };
  }

  @Get('ai/cluster')
  @ApiOperation({ summary: 'C5 유사문의 클러스터' })
  async aiCluster(@Query('days') days?: string) {
    return { data: await this.ai.cluster(days ? Number(days) : 30) };
  }
}
