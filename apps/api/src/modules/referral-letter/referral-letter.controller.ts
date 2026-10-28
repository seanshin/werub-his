import { Controller, Get, Post, Put, Patch, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ReferralLetterService } from './referral-letter.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GenerateReferralLetterDto, ReferralLetterReasonDto, UpdateReferralLetterDto } from './dto/referral-letter-write.dto';

@ApiTags('Referral Letter')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/referral-letters')
export class ReferralLetterController {
  constructor(private readonly service: ReferralLetterService) {}

  @Post('generate')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: 'AI 의뢰서 초안 생성 — 초안만(협진은 서명 시 생성 · 제안 원장 proposalId 동봉)' })
  async generate(
    @Body() body: GenerateReferralLetterDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.generateDraft(body, userId) };
  }

  // ── 목록 (라우트 충돌 방지: 고정 경로 먼저) ──

  @Get('all')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '전체 의뢰서 목록 (최근)' })
  async findAll(@Query('limit') limit?: string) {
    return { data: await this.service.findAll(limit ? parseInt(limit) : 50) };
  }

  @Get('pending')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '수신 대기 의뢰서 (내 과)' })
  async findPending(@Query('department') department: string) {
    return { data: await this.service.findPending(department) };
  }

  @Get('by-patient/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자별 의뢰서 목록' })
  async findByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.findByPatient(patientId) };
  }

  // ── 개별 ──

  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '의뢰서 조회' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.findOne(id) };
  }

  @Put(':id')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '의뢰서 수정 (DRAFT 상태)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateReferralLetterDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.update(id, body.content, userId) };
  }

  @Patch(':id/sign-and-send')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '의뢰서 서명 + 전송 (원자적)' })
  async signAndSend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.signAndSend(id, userId) };
  }

  @Patch(':id/sign')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '의뢰서 전자서명' })
  async sign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.sign(id, userId) };
  }

  @Patch(':id/send')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '의뢰서 전송' })
  async send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.send(id, userId) };
  }

  @Patch(':id/reject')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '의뢰 거절' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReferralLetterReasonDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.reject(id, userId, body.reason as string) };
  }

  @Patch(':id/void')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '의뢰서 무효화' })
  async voidLetter(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReferralLetterReasonDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.voidLetter(id, userId, body.reason as string) };
  }

  @Get(':id/html')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '의뢰서 PDF/인쇄용 HTML' })
  async getHtml(@Param('id', ParseUUIDPipe) id: string) {
    return { data: { html: await this.service.generateHtml(id) } };
  }
}
