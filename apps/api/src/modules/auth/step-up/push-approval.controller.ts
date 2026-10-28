import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { PushApprovalService } from './push-approval.service';
import { StepUpService } from './step-up.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { StepUpApprovePinDto, StepUpPushRequestDto } from './dto/push-approval.dto';

// 스마트폰 푸시 생체 승인 — Tier 2 (단말 제로트러스트 ②). 전부 인증 필요.
@ApiTags('auth-step-up-push')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/auth/step-up/push')
export class PushApprovalController {
  constructor(
    private readonly svc: PushApprovalService,
    private readonly stepUp: StepUpService,
  ) {}

  @Get('readiness')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'ADMIN: Tier2 준비도(의사별 패스키·FCM폰) — 파일럿 선정용' })
  async readiness() {
    return { data: await this.stepUp.tier2Readiness() };
  }

  @Post('request')
  @ApiOperation({ summary: 'PC: 승인 요청 생성 + 스태프 폰 푸시' })
  async request(
    @CurrentUser('id') userId: string,
    @Body() body: StepUpPushRequestDto,
  ) {
    return { data: await this.svc.request(userId, body.action, body.resourceId, body.bodyHash) };
  }

  // 🔴 (2026-10-13 결함 발굴 A3) `POST delegate/request` 제거 — 요청자가 보낸 bodyHash·summary 를 그대로 저장해
  //    처방의 폰에 **요청자가 쓴 요약**을 띄웠다(실제 처방과 다른 요약으로 승인을 받을 수 있었다). 처방의 자격·직종 범위
  //    검사도 없었다. 위임 승인 요청의 정본은 `POST encounters/:id/prescriptions/delegate-request`(서버가 처방 본문으로
  //    해시·요약 생성) 하나 — 같은 일을 하는 EP 를 둘 두지 않는다. 화면 호출 0(제거 시점).

  @Get('delegate/status/:id')
  @ApiOperation({ summary: '위임: 입력자가 지정 처방의 승인 토큰 polling(본인 요청건만 수령)' })
  async delegateStatus(@CurrentUser('id') requesterId: string, @Param('id') id: string) {
    return { data: await this.svc.delegateStatus(requesterId, id) };
  }

  @Get('pending')
  @ApiOperation({ summary: '폰: 대기 중 승인 요청 목록(푸시 미수신 대비 polling)' })
  async pending(@CurrentUser('id') userId: string) {
    return { data: await this.svc.pending(userId) };
  }

  @Get('history')
  @ApiOperation({ summary: '폰: 승인 요청 처리 이력(로그) — 기간/페이지 필터' })
  async history(
    @CurrentUser('id') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return { data: await this.svc.history(userId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    }) };
  }

  @Get('admin/approvals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'ADMIN 오버사이트: 전체 의료진 승인 내역(필터·페이지)' })
  async adminApprovals(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('method') method?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return { data: await this.svc.adminList({
      userId, status, method,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    }) };
  }

  @Get('status/:id')
  @ApiOperation({ summary: 'PC: 승인 상태 polling — APPROVED 시 step-up 토큰 1회 수령' })
  async status(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { data: await this.svc.status(userId, id) };
  }

  @Post(':id/approve')
  @ApiOperation({ summary: '폰: 생체(passkey) 승인 → 서버 검증 후 step-up 토큰 발급' })
  async approve(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { response: AuthenticationResponseJSON },
  ) {
    return { data: await this.svc.approve(userId, id, body.response) };
  }

  @Post(':id/approve-pin')
  @ApiOperation({ summary: '폰: 데일리 PIN 승인(생체 대안) → step-up 토큰 발급' })
  async approvePin(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: StepUpApprovePinDto,
  ) {
    return { data: await this.svc.approveWithPin(userId, id, body.pin) };
  }

  @Post(':id/deny')
  @ApiOperation({ summary: '폰: 승인 거부' })
  async deny(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { data: await this.svc.deny(userId, id) };
  }
}
