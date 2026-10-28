import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BedTransferService } from './bed-transfer.service';
import { AcceptBedTransferDto, CancelBedTransferDto, CreateBedTransferDto, RejectBedTransferDto } from './bed-transfer.dto';

@ApiTags('Bed Transfer (병동 간 전동 요청·수락)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/bed-transfers')
export class BedTransferController {
  constructor(private readonly svc: BedTransferService) {}

  @Get()
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '전동 요청 목록 — scope=incoming(받을·병동 선택)|mine(보낸)|recent(최근 처리 7일)' })
  async list(@Query('scope') scope: string | undefined, @Query('targetWardId') targetWardId: string | undefined, @CurrentUser('id') userId: string) {
    const r = await this.svc.list({ scope, targetWardId }, userId);
    return { data: r.items, meta: { truncated: r.truncated, limit: r.limit } };
  }

  @Post()
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '전동 요청 — 받는 병동·사유(필수)·원하는 병상(선택) · 입원 하나에 열린 요청 하나' })
  async create(@Body() dto: CreateBedTransferDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.create(dto, userId) };
  }

  @Post(':id/accept')
  // 병상 이동 EP(inpatient transfer)와 같은 권한
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '전동 수락 — 받는 병동의 병상으로 즉시 이동(같은 트랜잭션)' })
  async accept(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptBedTransferDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.accept(id, dto.bedId, userId, dto.note) };
  }

  @Post(':id/reject')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '전동 거절 — 사유 필수' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectBedTransferDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.reject(id, userId, dto.reason) };
  }

  @Post(':id/cancel')
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '전동 요청 취소 — 요청자·관리자' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBedTransferDto, @CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    return { data: await this.svc.cancel(id, userId, role, dto.reason) };
  }
}
