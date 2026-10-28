import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AiProposalService } from './ai-proposal.service';
import { DecideAiProposalDto, ListAiProposalQueryDto, MarkPresentedDto } from './dto/ai-proposal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAiRead } from '../audit/no-audit.decorator';

/**
 * AI 제안 열람·결정 EP — 기획서 §2.1.
 *
 * 🔴 **생성 EP 는 없다.** 제안은 각 스킬 서비스가 서버 안에서 `AiProposalService.create()` 로 만든다.
 *    외부에서 임의 초안을 밀어 넣을 수 있으면 "AI 가 낸 것"이라는 사실 자체가 증거가 못 된다.
 *
 * 🔴 열람 감사: `@AuditAiRead` — 이 GET 들은 **환자 기록에서 뽑은 초안을 읽는 열람 행위**다.
 *    `audit.interceptor` 의 `resolveAiPatient` 가 ① 응답 `data.patientId` ② 라우트 `:patientId`
 *    순으로 환자를 찾아 `resourceId` 에 넣고, 못 찾으면 `patientBound=false` 로 **못 찾았다고 적는다**.
 *    그래서 상세 응답은 `data.patientId` 를 **반드시 최상위로** 낸다(중첩하면 귀속이 조용히 끊긴다).
 *
 * 🔴 POST 두 개는 변이라 기본 감사 ON 경로를 그대로 탄다(면제 없음).
 */
@ApiTags('AI Proposals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/ai/proposals')
export class AiProposalController {
  constructor(private readonly service: AiProposalService) {}

  /**
   * GET /api/v1/ai/proposals/:id — 제안 상세(본문 복호는 여기서만).
   * 본문이 없거나 못 읽으면 `content:null` + `contentUnavailableReason` 으로 **그 사실을 말한다**.
   */
  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
  @AuditAiRead('AiProposal')
  @ApiOperation({ summary: 'AI 제안 상세(본문 복호 · 전이 원장 포함)' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.get(id);
    return { data };
  }

  /**
   * POST /api/v1/ai/proposals/:id/presented — 화면이 실제로 렌더한 시점 보고(1회).
   * 🔴 멱등이다. 이미 노출됐거나 결정된 건이면 `changed:false` 와 그 이유를 돌려준다(에러가 아니다).
   */
  @Post(':id/presented')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: '제안 노출 보고(GENERATED→PRESENTED · 멱등)' })
  async markPresented(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPresentedDto,
    @CurrentUser('id') actorId: string,
  ) {
    const data = await this.service.markPresented(id, actorId, dto?.clientContext ?? null);
    return { data };
  }

  /**
   * POST /api/v1/ai/proposals/:id/decision — 사람 결정 기록.
   * 🔴 정본 반영은 여기서 하지 않는다 — 각 도메인 정본 서비스가 **같은 트랜잭션에서** 부르는 것이 규약이다.
   */
  @Post(':id/decision')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 제안 결정(ACCEPTED|EDITED|REJECTED)' })
  async decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideAiProposalDto,
    @CurrentUser('id') actorId: string,
  ) {
    const data = await this.service.decide(id, {
      decision: dto.decision,
      actorId,
      finalText: dto.finalText,
      reason: dto.reason,
      clientContext: dto.clientContext ?? null,
    });
    return { data };
  }

  /**
   * GET /api/v1/ai/proposals/patients/:patientId — 환자별 제안 목록(본문 없음).
   * 🔴 잘렸으면 `truncated:true` 로 말한다.
   */
  @Get('patients/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
  @AuditAiRead('AiProposal')
  @ApiOperation({ summary: '환자별 AI 제안 목록(본문 미포함)' })
  async listByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: ListAiProposalQueryDto,
  ) {
    const data = await this.service.listByPatient(patientId, {
      kind: query.kind,
      status: query.status,
      limit: query.limit,
    });
    return { data: { ...data, patientId } };
  }
}
