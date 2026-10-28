import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PreOrderService } from './pre-order.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApprovePreOrderDto, CreatePreOrderDto, ModifyPreOrderDto } from './dto/pre-order.dto';

@ApiTags('Pre-Order')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
/**
 * 🔴 (2026-09-16 D4) 사전오더 **읽기 5EP 가 무역할**이었다(목록·환자별 대기·상세·정정 이력·검사 예정) —
 *    처방 내용이 인증된 전 직원에게 열려 있었다. 소비 화면은 환자 차트 탭(`CHART_ACCESS_ROLES`)과
 *    검사 워크스테이션(ADMIN·LAB_TECH)이라 그 합집합을 클래스 기본값으로 둔다(쓰기는 기존 선언이 덮는다).
 */
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MEDICAL_RECORDS, UserRole.LAB_TECH)
@Controller('api/v1/pre-orders')
export class PreOrderController {
  constructor(private readonly service: PreOrderService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '사전 오더 생성' })
  async create(@Body() dto: CreatePreOrderDto, @CurrentUser('id') userId: string) {
    // 사람 결정 대기: `policy.clinical.actorAttribution` — 본문 doctorId(책임 의사 대리 지정)를 받을지 · 지정 대상 역할 미확인
    return this.service.create({ ...dto, doctorId: dto.doctorId ?? userId });
  }

  @Get()
  @ApiOperation({ summary: '사전 오더 목록' })
  async findAll(
    @Query('patientId') patientId?: string,
    @Query('doctorId') doctorId?: string,
    @Query('status') status?: string,
  ) {
    return { data: await this.service.findAll({ patientId, doctorId, status }) };
  }

  @Get('pending')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '내 미결 사전 오더' })
  async findMyPending(@CurrentUser('id') userId: string) {
    return { data: await this.service.findMyPending(userId) };
  }

  @Get('upcoming-lab')
  @ApiOperation({ summary: '검사실 예정 큐 — 오늘~+N일 시행 예정 미결 검사 사전처방 (사전 준비용)' })
  async findUpcomingLab(@Query('days') days?: string) {
    return { data: await this.service.findUpcomingLab(days ? Number(days) : 2) };
  }

  @Get('patient/:patientId')
  @ApiOperation({ summary: '환자별 미결 사전 오더' })
  async findPendingByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.findPendingByPatient(patientId) };
  }

  @Get(':id')
  @ApiOperation({ summary: '사전 오더 상세' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.findById(id) };
  }

  @Patch(':id/approve')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '사전 오더 승인 (→ 처방 생성, DUR 재검증 — ERROR는 오버라이드 사유 필수)' })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApprovePreOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.approve(id, userId, body.encounterId, { overrideDur: body.overrideDur, overrideReason: body.overrideReason }) };
  }

  @Post('expire-overdue')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '만료 사전 오더 일괄 EXPIRED 처리 (수동 트리거 — 크론은 매일 자정)' })
  async expireOverdue() {
    return { data: await this.service.expireOverdue() };
  }

  @Patch(':id/modify')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '사전 오더 수정 (수정 전 값 스냅샷 기록)' })
  async modify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModifyPreOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.modify(id, dto, userId, dto.reason);
  }

  @Get(':id/revisions')
  @ApiOperation({ summary: '사전 오더 수정 이력' })
  async getRevisions(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getRevisions(id) };
  }

  @Patch(':id/cancel')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN) // create/approve/modify 와 동일 — 임의 인증사용자의 미결 오더 취소 차단
  @ApiOperation({ summary: '사전 오더 취소 (?scope=group — 반복 그룹 미결 일괄 취소)' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Query('scope') scope?: string) {
    return { data: await this.service.cancel(id, scope) };
  }
}
