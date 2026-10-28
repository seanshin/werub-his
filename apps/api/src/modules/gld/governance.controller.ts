import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GovernanceService } from './governance.service';
import { StandardGovernanceService } from './standard-governance.service';
import { DecisionPathwayService } from './decision-pathway.service';
import { GovernanceEnactmentService } from './governance-enactment.service';
import { SubmitAgendaDto, UpdateAgendaDto, ResolveAgendaDto, ConfirmManualActionDto, PrecheckAgendaDto, StandardRuleDto, StartPathwayDto, CompleteStepDto, BlockStepDto } from './governance.dto';

/**
 * 위원회 거버넌스 P0-b — 안건·의결·집행항목(MANUAL)·관제 요약.
 * 조회=전 직원(투명성·D 규약 — ETH 민감 안건 플래그는 후속), 운영(배정·의결·이행확인)=ADMIN.
 */
@ApiTags('Governance (위원회 거버넌스)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
/**
 * 🔴 (2026-09-16 D4) 의결·평가 쓰기만 `@Roles(ADMIN)` 이고 **조회·안건 상신 10EP 는 무역할**이었다 —
 *    거버넌스 요약·근거·결정 목록이 인증된 전 직원에게 열려 있었다.
 *    소비 화면은 `/admin/gld`(ADMIN·DOCTOR·NURSE)와 `/admin/governance`(ADMIN)라 그 합집합을 기본값으로 둔다.
 */
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1/governance')
export class GovernanceController {
  constructor(
    private readonly svc: GovernanceService,
    private readonly enactment: GovernanceEnactmentService,
    private readonly standardGov: StandardGovernanceService,
    private readonly pathways: DecisionPathwayService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: '관제 요약 — 위원회 카드·미결 안건·최근 의결·이행 대기·재검토 임박' })
  async summary() { return { data: await this.svc.summary() }; }

  @Get('provenance')
  @ApiOperation({ summary: '표면 provenance — 이 config/게이트를 건드린 결정 체인(⚖배지 데이터)' })
  async provenance(@Query('surfaceKey') surfaceKey: string) {
    return { data: await this.svc.provenance(surfaceKey ?? '') };
  }

  @Get('badges')
  @ApiOperation({ summary: '표면→최신 유효 결정 맵 — 관리 화면 ⚖배지 일괄 조회' })
  async badges() { return { data: await this.svc.activeDecisionBadges() }; }

  @Get('health')
  @ApiOperation({ summary: '거버넌스 헬스체크(D13) — config 드리프트·관제 수집 누락' })
  async health() { return { data: await this.svc.healthCheck() }; }

  @Get('surface-map')
  @ApiOperation({ summary: '정책 표면 담당 매핑(D14)' })
  async surfaceMap() { return { data: await this.svc.surfaceMap() }; }

  @Get('sign-chain/verify')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'his-governance 봉인 체인 무결성 검증(D5) — 외부 sign verify 프록시' })
  async verifySignChain() { return { data: await this.svc.verifySignChain() }; }

  @Post('agendas')
  @ApiOperation({ summary: '안건 제안 — 전 직원' })
  async submit(@CurrentUser('id') userId: string, @Body() dto: SubmitAgendaDto) {
    return { data: await this.svc.submitAgenda(userId, dto) };
  }

  @Post('agendas/precheck')
  @ApiOperation({ summary: '제안 사전 검토(AI·비차단) — 유사/중복 안건·관련 기능·보완 질의. 게이트 governance.ai.enabled' })
  async precheck(@Body() dto: PrecheckAgendaDto) {
    return { data: await this.svc.precheckAgenda(dto) };
  }

  @Get('agendas')
  @ApiOperation({ summary: '안건 목록(위원회·상태 필터)' })
  async agendas(@Query('committeeId') committeeId?: string, @Query('status') status?: string) {
    return { data: await this.svc.listAgendas(committeeId, status) };
  }

  @Patch('agendas/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '안건 회의 배정·상태 전이(RESOLVED 는 resolve 전용)' })
  async updateAgenda(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgendaDto) {
    return { data: await this.svc.updateAgenda(id, dto) };
  }

  @Post('agendas/:id/resolve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '의결 — 정족수 검증·GOV 번호 발번·P0-b 는 MANUAL 액션만' })
  async resolve(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveAgendaDto) {
    return { data: await this.svc.resolveAgenda(id, dto, userId) };
  }

  @Post('agendas/:id/assess')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 영향 평가(워크벤치 P2) — 게이트 governance.ai.enabled·RESOLVED 후 동결·재생성=교체' })
  async assess(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.assessAgenda(id) };
  }

  @Get('decisions')
  @ApiOperation({ summary: '의결 목록' })
  async decisions(@Query('committeeId') committeeId?: string) {
    return { data: await this.svc.listDecisions(committeeId) };
  }

  @Get('decisions/:id')
  @ApiOperation({ summary: '의결 상세 — 액션·supersede 체인 포함' })
  async decision(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getDecision(id) };
  }

  @Post('decisions/:id/enact')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '지금 집행(P1) — 크론과 동일 경로. 게이트 OFF/시행일 전이면 거부' })
  async enact(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.enactment.enactDecision(id, userId) };
  }

  @Patch('actions/:id/confirm')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'MANUAL 집행 이행 확인 — 전 항목 종결 시 결정 ENACTED 승격' })
  async confirmAction(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string, @Body() dto: ConfirmManualActionDto) {
    return { data: await this.svc.confirmManualAction(id, userId, dto.manualNote) };
  }
  // ── 표준 발효 거버넌스 (P1-c) ──

  /**
   * 🔴 표준(프로세스·프로토콜·CP) 목록과 **지금 상태**.
   *    운영 실측(2026-08-27) 시점에 발효 중 9건 전부 `NO_BASIS` 였다.
   */
  @Get('standards')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '표준 발효 현황 — 의결 근거/규칙 유무를 3상으로' })
  async standards() {
    return { data: await this.standardGov.listStandards() };
  }

  /** 발효 요건 정의·수정 — 유형 기본(`standardCode` 생략) 또는 표준별 예외 */
  @Post('standards/rules')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '표준 발효 요건 정의(의결 주체 요건·근거·주기·시행 강도)' })
  async upsertStandardRule(@Body() dto: StandardRuleDto, @CurrentUser('id') userId: string) {
    return { data: await this.standardGov.upsertRule(dto as never, userId) };
  }

  // ── 결정 경로 엔진 (P2) ──

  /** 기본 경로 3종 시드 — 멱등 */
  @Post('pathways/seed')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '결정 경로 기본 3종(허가권자·위원회·코드변경) 시드' })
  async seedPathways(@CurrentUser('id') userId: string) {
    return { data: await this.pathways.seedDefaults(userId) };
  }

  /**
   * 🔴 **막혀 있는 것들** — "N건 진행 중"이 아니라 무엇이 어디서 왜 멈췄는지.
   *    결정 축에는 지금까지 이 목록이 없었다.
   */
  @Get('pathways/blocked')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '막혀 있는 결정 경로 — 단계·담당·막힌 이유' })
  async blockedPathways() {
    return { data: await this.pathways.blocked() };
  }

  /** 안건/등록부 키로 경로 조회 — 없으면 null(만들지 않는다) */
  @Get('pathways/instance')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '안건·등록부 키의 결정 경로 진행 상태' })
  async pathwayInstance(@Query('agendaId') agendaId?: string, @Query('registryKey') registryKey?: string) {
    return { data: await this.pathways.findBySource({ agendaId, registryKey }) };
  }

  /**
   * 🔴 층별 요약 — **합치지 않는다.** 그리고 기준이 없으므로 "지연"을 세지 않고
   *    **체류 일수**라는 사실만 낸다.
   */
  @Get('pathways/summary')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '결정 경로 층별 요약 — 진행·막힘·체류일(지연 아님)' })
  async pathwaySummary() {
    return { data: await this.pathways.summaryByLayer() };
  }

  @Post('pathways/start')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '결정 경로 시작(출처는 안건·등록부 중 하나)' })
  async startPathway(@Body() dto: StartPathwayDto) {
    return { data: await this.pathways.start(dto) };
  }

  @Post('pathways/instances/:id/complete')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '단계 완료 → 다음으로. 게이트는 통과 근거 없이 넘어가지 못한다' })
  async completeStep(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteStepDto, @CurrentUser('id') userId: string) {
    return { data: await this.pathways.complete(id, dto.stepKey, { ...dto, actorId: userId }) };
  }

  @Post('pathways/instances/:id/block')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '막힘 기록 — 사유 필수(사유 없는 막힘은 아무 정보도 아니다)' })
  async blockStep(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockStepDto, @CurrentUser('id') userId: string) {
    return { data: await this.pathways.block(id, dto.stepKey, dto.reason, userId) };
  }

}
