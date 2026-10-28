import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateInviteDto, SendInviteDto, ReviewDocumentDto } from './dto/onboarding.dto';

// 신규 입사자 관리 (관리자/행정과) — 온보딩 시작점
@ApiTags('Onboarding (신규 입사자 관리)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/onboarding/invites')
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get()
  @ApiOperation({ summary: '입사예정자 목록(상태/직종/검색)' })
  async list(@Query('status') status?: string, @Query('jobCategory') jobCategory?: string, @Query('q') q?: string) {
    return { data: await this.svc.list({ status, jobCategory, q }) };
  }

  @Post()
  @ApiOperation({ summary: '입사예정자 등록 + 초대 발급(토큰/링크/QR 1회 반환)' })
  async create(@Body() dto: CreateInviteDto, @CurrentUser('id') adminId: string) {
    return { data: await this.svc.createInvite(dto, adminId) };
  }

  @Get(':id')
  @ApiOperation({ summary: '입사예정자 상세(서류·계약·발송이력)' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getInvite(id) };
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'EMAIL=실발송 시도(결과 그대로 기록) · QR_IMAGE/LINK=직접 전달 기록' })
  async send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendInviteDto, @CurrentUser('id') adminId: string) {
    return { data: await this.svc.recordSend(id, dto.channel, adminId, dto.link) };
  }

  @Post(':id/resend')
  @ApiOperation({ summary: '초대 재발급(토큰 회전·이전 무효)' })
  async resend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') adminId: string) {
    return { data: await this.svc.resendInvite(id, adminId) };
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: '초대 폐기' })
  async revoke(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.revokeInvite(id) };
  }

  @Post('documents/:docId/review')
  @ApiOperation({ summary: '서류 검토(승인/반려)' })
  async reviewDocument(@Param('docId', ParseUUIDPipe) docId: string, @Body() dto: ReviewDocumentDto, @CurrentUser('id') reviewerId: string) {
    return { data: await this.svc.reviewDocument(docId, dto.status, reviewerId, dto.rejectReason) };
  }

  @Post(':id/approve-boot')
  @ApiOperation({ summary: '계정 활성화(Staff 생성·임시계정 승격·ERP 발행) → BOOTED' })
  async approveBoot(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') adminId: string) {
    return { data: await this.svc.approveBoot(id, adminId) };
  }

  @Get('documents/:docId/file')
  @ApiOperation({ summary: '서류 복호화 열람(HR 검토·ERP 입력용 req4-b)' })
  async downloadDocument(@Param('docId', ParseUUIDPipe) docId: string, @CurrentUser('id') adminId: string, @Res() res: Response) {
    const { buffer, contentType } = await this.svc.readDocumentFile(docId, adminId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }
}
