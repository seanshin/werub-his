import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DoctorsService } from './doctors.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuickRoundDto } from './dto/quick-round.dto';
import { BulkAcknowledgeOrdersDto, ResultsInboxQueryDto } from './dto/results-inbox.dto';

@ApiTags('Doctors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/doctors')
export class DoctorsController {
  constructor(private readonly service: DoctorsService) {}

  @Get('my-census')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '담당 환자 센서스 (주치의 대시보드)' })
  async getMyCensus(
    @CurrentUser() user: { id?: string; sub?: string },
    @Query('sortBy') sortBy?: string,
  ) {
    return { data: await this.service.getMyCensus((user.id ?? user.sub)!, sortBy) };
  }

  @Get('rounds/today')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '오늘 회진 대상 + 진행률' })
  async getMyRoundsToday(@CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.service.getMyRoundsToday((user.id ?? user.sub)!) };
  }

  /**
   * 🔴 전 의료진 회진 현황 — 종전엔 **본인 것만** 볼 수 있었다(사람 신고 2026-08-26).
   *    간호도 본다(병동에서 "오늘 회진이 어디까지 돌았나"는 간호가 먼저 묻는다).
   */
  @Get('rounds/today/all')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '오늘 회진 현황 — 담당의별(담당의 미지정 묶음 포함·분모 병기)' })
  async getRoundsTodayAll() {
    return { data: await this.service.getRoundsTodayAll() };
  }

  @Post('rounds/quick')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '빠른 회진 기록' })
  async quickRound(
    @CurrentUser() user: { id?: string; sub?: string },
    @Body() dto: QuickRoundDto,
  ) {
    return { data: await this.service.quickRound((user.id ?? user.sub)!, dto) };
  }

  /**
   * 검사결과 확인함 — 결과가 도착했는데 아직 확인하지 않은 **내 오더**(또는 `patientId` 지정 시 그 환자 전부).
   * 소비처: /results-inbox(1011) · 대시보드 '검사결과 도착' 위젯 · 센서스 "미확인 검사 N건" 드릴다운.
   */
  @Get('results-inbox')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검사결과 확인함 — 미확인 결과(위급·이상 우선·최근 완료순·총 건수 병기)' })
  async getResultsInbox(
    @CurrentUser() user: { id?: string; sub?: string },
    @Query() query: ResultsInboxQueryDto,
  ) {
    return { data: await this.service.getResultsInbox((user.id ?? user.sub)!, query) };
  }

  @Get('my-followups')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '내 후속 일 — 미서명 진료기록·퇴원요약·회신 도착한 내 협진·처리 기한(원내 정책 · 미설정 null)' })
  async getMyFollowups(@CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.service.getMyFollowups((user.id ?? user.sub)!) };
  }

  @Get('my-handled')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '내가 처리한 것(하루 · 기본 오늘 KST) — 처리자·시각이 원장에 남는 일만(결과 확인·구두 처방 서명·갱신·사전처방 승인·약사 회신·협진 회신·기록 서명) · 종류별 상한 50+전체 수' })
  async getMyHandled(@CurrentUser() user: { id?: string; sub?: string }, @Query('date') date?: string) {
    return { data: await this.service.getMyHandled((user.id ?? user.sub)!, date) };
  }

  @Post('orders/acknowledge')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검사 결과 일괄 확인 — 결과 있는 미확인 오더만(확인·건너뜀 건수 반환)' })
  async acknowledgeOrders(
    @CurrentUser() user: { id?: string; sub?: string },
    @Body() dto: BulkAcknowledgeOrdersDto,
  ) {
    return { data: await this.service.acknowledgeOrders(dto.orderIds, (user.id ?? user.sub)!) };
  }

  @Patch('orders/:id/acknowledge')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검사 결과 확인 (acknowledge) — 결과 없는 오더는 409' })
  async acknowledgeOrder(
    @CurrentUser() user: { id?: string; sub?: string },
    @Param('id', ParseUUIDPipe) orderId: string,
  ) {
    return { data: await this.service.acknowledgeOrder(orderId, (user.id ?? user.sub)!) };
  }
}
