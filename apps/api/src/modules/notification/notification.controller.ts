import { Body, Controller, Get, Patch, Param, Post, Query, Sse, UseGuards, Request, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Observable } from 'rxjs';
import { NotificationService } from './notification.service';
import { AlertApprovalDto, AlertRevokeDto } from './dto/alert-approval.dto';
import { PatientPushGateService } from './patient-push-gate.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * 🔴 **자기 알림은 모든 직원의 것이다.**
 *
 * 2026-08-21 사람 신고(급양 계정 로그인)에서 드러났다 — 자기 알림 EP 가 임상 5역할
 * (`DOCTOR·NURSE·PHARMACIST·LAB_TECH·ADMIN`) 전용이라, v3.96 에서 신설한 지원 직군
 * (급양·원무·의무기록·검진·CRM×2·행정·경영·조회)은 **자기 앞으로 온 알림을 하나도 볼 수 없었다.**
 * 그런데 `(main)` 레이아웃은 **전 직군에 SSE 를 연결**하고 `/notifications`(2906) 화면도
 * 전 직군에 열려 있다 — 화면은 열리는데 목록이 403 이었다.
 *
 * 🔴 이 EP 들은 **`userId` 로 스코프된 자기 것**이다(받을 수 없는 사람에게는 애초에 발행되지 않는다).
 *    관제성 EP(`registry`·`patient-push/settings`)는 종전대로 ADMIN·EXECUTIVE 로 좁혀 둔다 —
 *    그것은 남의 알림 통계를 보는 일이라 성격이 다르다.
 */
const SELF_NOTIFICATION_ROLES = [
  UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.ADMIN,
  UserRole.NUTRITION, UserRole.RECEPTIONIST, UserRole.ADMIN_STAFF, UserRole.MEDICAL_RECORDS,
  UserRole.CHECKUP, UserRole.CRM_MANAGER, UserRole.CRM_STAFF, UserRole.EXECUTIVE, UserRole.READ,
] as const;

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly patientPushGate: PatientPushGateService,
  ) {}

  @Sse('stream')
  @Roles(...SELF_NOTIFICATION_ROLES)
  @ApiOperation({ summary: '실시간 알림 스트림 (SSE)' })
  stream(@Request() req: { user: { id?: string; sub?: string } }): Observable<MessageEvent> {
    const userId = (req.user.id ?? req.user.sub)!;
    return this.notificationService.getStream(userId);
  }

  @Get()
  @Roles(...SELF_NOTIFICATION_ROLES)
  @ApiOperation({ summary: '내 알림 목록 조회' })
  async findAll(
    @Request() req: { user: { id?: string; sub?: string } },
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const userId = (req.user.id ?? req.user.sub)!;
    const data = await this.notificationService.findByUser(
      userId,
      unreadOnly === 'true',
    );
    return { data };
  }

  /**
   * 경보 등록부 관제(읽기 전용) — 코드별 발화/읽음/중앙값·미등재·보존 창. 관리자·경영진.
   * 리터럴 라우트는 `:id` 보다 먼저 등록한다(Nest 선점).
   */
  @Get('registry')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '경보 등록부 관제 보고(30일)' })
  async registry(@Query('days') days?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 180);
    return { data: await this.notificationService.registryReport(d) };
  }

  /**
   * 경보 승인 기록·철회(2026-10-09) — 등록부의 tier·대상·억제 창을 사람이 승인한다(값 snapshot · 근거 필수).
   * 🔴 승인자 직책을 검증하지 못한다 — 근거 문구로 남기고 화면이 그 사실을 말한다.
   */
  @Post('registry/:code/approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '경보 승인 기록(근거 필수 · 지금 값 snapshot)' })
  async approveAlert(@Param('code') code: string, @Body() dto: AlertApprovalDto, @CurrentUser('id') userId: string) {
    return { data: await this.notificationService.approveAlert(code, dto.basis, userId) };
  }

  @Post('registry/:code/revoke')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '경보 승인 철회(사유 필수 · 지우지 않음)' })
  async revokeAlertApproval(@Param('code') code: string, @Body() dto: AlertRevokeDto, @CurrentUser('id') userId: string) {
    return { data: await this.notificationService.revokeAlertApproval(code, dto.reason, userId) };
  }

  /**
   * 환자 푸시(대외 발신) 설정 조회 — 관리 화면이 토글을 그리는 근거.
   * 🔴 읽기 전용이다. 쓰기는 기존 시스템 설정 경로(`PUT /api/v1/config/:key`)를 쓴다 —
   *    설정 쓰기 정본을 둘로 만들지 않는다.
   * 🔴 값을 지어내지 않는다: 미설정은 false 를 그대로 낸다(기본 OFF 가 사실이다).
   */
  @Get('patient-push/settings')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '환자 앱 푸시 설정(마스터·타입별·야간 억제 창) 조회' })
  async patientPushSettings() {
    return { data: await this.patientPushGate.settings() };
  }

  @Get('unread-count')
  @Roles(...SELF_NOTIFICATION_ROLES)
  @ApiOperation({ summary: '읽지 않은 알림 수' })
  async getUnreadCount(@Request() req: { user: { id?: string; sub?: string } }) {
    const userId = (req.user.id ?? req.user.sub)!;
    const count = await this.notificationService.getUnreadCount(userId);
    return { data: { count } };
  }

  @Patch('read-all')
  @Roles(...SELF_NOTIFICATION_ROLES)
  @ApiOperation({ summary: '내 알림 전체 읽음' })
  async markAllRead(@Request() req: { user: { id?: string; sub?: string } }) {
    return { data: await this.notificationService.markAllRead((req.user.id ?? req.user.sub)!) };
  }

  @Patch(':id/read')
  @Roles(...SELF_NOTIFICATION_ROLES)
  @ApiOperation({ summary: '알림 읽음 처리' })
  async markRead(@Param('id') id: string, @Request() req: { user: { id?: string; sub?: string } }) {
    const data = await this.notificationService.markRead(id, (req.user.id ?? req.user.sub)!);
    return { data };
  }
}
