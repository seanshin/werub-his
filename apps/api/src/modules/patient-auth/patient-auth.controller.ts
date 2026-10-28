import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards, Delete, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { LoginResult, RefreshResult } from '../portal/portal.response-schemas';
import { Throttle } from '@nestjs/throttler';
import { PatientAccountRequest } from '../../common/interfaces/portal-request.interface';
import { PatientAuthService } from './patient-auth.service';
import { SmsOtpService } from './services/sms-otp.service';
import { HisModeService } from '../../common/his-mode/his-mode.service';
import { allowsSeedLogin } from '@hospital-run/shared';
import { PatientAccountAuthGuard } from './guards/patient-account-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import {
  PatientSignupDto, SendSmsDto, VerifySmsDto, PatientLoginDto,
  PatientLoginPinDto, RefreshTokenDto, PatientLogoutDto,
  ChangePasswordDto, SetPinDto, GuardianRequestDto, GuardianApproveDto,
  GuardianRejectDto, UpdateNotificationSettingsDto,
} from './dto/patient-auth.dto';
import { RegisterPatientPushTokenDto, UpdatePatientFcmTokenDto } from './dto/patient-push-token.dto';

/**
 * 🔴 **시드 4개 EP 가 운영에 무인증 공개돼 있었다**(2026-08-31 실측: `POST seed-test-accounts` → 201).
 *    "개발용"이라면서 클래스 레벨 가드가 없어(개별 `@UseGuards` 만) 누구나 운영에서
 *    **알려진 공용 비밀번호로 테스트 환자 계정을 생성**할 수 있었다.
 *    dev-demo 선례대로 **직원 관리자 인증**을 요구한다(환자가 시드를 만들 이유가 없다).
 */
@ApiTags('Patient Auth')
@Controller('api/v1/patient-auth')
export class PatientAuthController {
  constructor(
    private readonly auth: PatientAuthService,
    private readonly sms: SmsOtpService,
    private readonly hisMode: HisModeService,
  ) {}

  @Post('seed-test-accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '테스트 계정 시드 (개발용 · 관리자 전용)' })
  async seedTestAccounts() {
    // 🔴 (2026-09-14 G12 실측) ADMIN 권한만 보고 운영 모드를 보지 않았다 — REAL 에서도 비밀번호가 알려진 환자 포털 계정 5개를
    //    만들 수 있었다. api 는 빌드 상한이 없으니 런타임 정본(`allowsSeedLogin`)으로 거부한다(직원 시드 로그인과 같은 규약).
    await this.assertSeedAllowed('Seed test accounts are disabled in REAL mode');
    return { data: await this.auth.seedTestAccounts() };
  }

  /**
   * 🔴 운영 모드 게이트가 `seed-test-accounts` 하나에만 있었다.
   *    나머지 시드 3개는 계정을 만들지 않고 **이미 있는 계정(고정 전화번호)의 환자 기록에 쓴다** —
   *    오늘 여정 이벤트·진행 중 검진 방문/결과·검진센터 대기열을 **삭제**하고 가짜 '진료 완료'·수술 동의서를 만든다.
   *    실환자가 그 번호로 가입하면 REAL 에서 실기록이 지워진다. 같은 런타임 정본(`allowsSeedLogin`)으로 넷 다 막는다.
   */
  private async assertSeedAllowed(message: string): Promise<void> {
    const mode = await this.hisMode.effective();
    if (!allowsSeedLogin(mode)) {
      throw new ForbiddenException(message);
    }
  }

  @Post('seed-outpatient-journey')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '외래 여정 시나리오 시드 (개발용 · 관리자 전용)' })
  async seedOutpatientJourney() {
    await this.assertSeedAllowed('Seed outpatient journey is disabled in REAL mode');
    return { data: await this.auth.seedOutpatientJourney() };
  }

  @Post('seed-consent-data')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '동의서 테스트 데이터 시드 (개발용 · 관리자 전용)' })
  async seedConsentData() {
    await this.assertSeedAllowed('Seed consent data is disabled in REAL mode');
    return { data: await this.auth.seedConsentData() };
  }

  @Post('seed-checkup-journey')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '건강검진 여정 시나리오 시드 (개발용 · 관리자 전용)' })
  async seedCheckupJourney() {
    await this.assertSeedAllowed('Seed checkup journey is disabled in REAL mode');
    return { data: await this.auth.seedCheckupJourney() };
  }

  @Post('sms/send')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'SMS OTP 발송' })
  async sendSms(@Body() body: SendSmsDto, @Req() req: PatientAccountRequest) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip;
    return { data: await this.sms.send(body.phone, body.purpose, ip) };
  }

  @Post('sms/verify')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'SMS OTP 인증' })
  async verifySms(@Body() body: VerifySmsDto) {
    const verified = await this.sms.verify(body.phone, body.code, body.purpose);
    return { data: { verified } };
  }

  @Get('signup/availability')
  @ApiOperation({ summary: '가입 경로가 지금 열려 있는가 — 본인확인 연동 상태' })
  signupAvailability() {
    // 🔴 막힌 폼을 다 채우게 하지 않는다. 화면이 폼을 열기 전에 서버에 묻는다.
    return { data: this.auth.signupAvailability() };
  }

  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '회원가입 (NICE CI + 동의 + 비밀번호)' })
  async signup(@Body() dto: PatientSignupDto) {
    return { data: await this.auth.signup(dto) };
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '로그인 (phone + password)' })
  @ApiOkResponse({ schema: LoginResult })
  async login(@Body() body: PatientLoginDto, @Req() req: PatientAccountRequest) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip;
    return { data: await this.auth.login(body.phone, body.password, body.deviceId, body.platform, ip, body.fcmToken) };
  }

  @Post('login/pin')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'PIN 로그인 (기기 바인딩)' })
  async loginPin(@Body() body: PatientLoginPinDto) {
    return { data: await this.auth.loginWithPin(body.phone, body.pin, body.deviceId) };
  }

  @Post('token/refresh')
  @ApiOperation({ summary: 'access + 회전 refresh 재발급 (AUTH-P-02)' })
  @ApiOkResponse({ schema: RefreshResult })
  async refresh(@Body() body: RefreshTokenDto) {
    return {
      data: await this.auth.refreshToken(body.refreshToken, {
        installationId: body.installationId,
        deviceId: body.deviceId,
      }),
    };
  }

  @Post('logout')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '로그아웃' })
  async logout(@Req() req: PatientAccountRequest, @Body() body: PatientLogoutDto) {
    await this.auth.logout(req.patientAccountId, body.deviceId);
    return { data: { success: true } };
  }

  @Put('password/change')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '비밀번호 변경' })
  async changePassword(@Req() req: PatientAccountRequest, @Body() body: ChangePasswordDto) {
    return { data: await this.auth.changePassword(req.patientAccountId, body.currentPassword, body.newPassword) };
  }

  @Put('pin/set')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'PIN 설정/변경' })
  async setPin(@Req() req: PatientAccountRequest, @Body() body: SetPinDto) {
    const { accountId } = await this.auth.verifyAccessToken((req.headers['authorization'] as string)?.replace('Bearer ', '') ?? '');
    return { data: await this.auth.setPin(accountId, body.password, body.pin) };
  }

  // ── 기기 관리 ──

  @Get('devices')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '등록 기기 목록' })
  async getDevices(@Req() req: PatientAccountRequest) {
    return { data: await this.auth.getDevices(req.patientAccountId) };
  }

  @Delete('devices/:id')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '기기 삭제 (원격 로그아웃)' })
  async removeDevice(@Param('id') id: string, @Req() req: PatientAccountRequest) {
    return { data: await this.auth.removeDevice(req.patientAccountId, id) };
  }

  @Put('devices/fcm-token')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FCM 푸시 토큰 갱신' })
  async updateFcmToken(@Req() req: PatientAccountRequest, @Body() body: UpdatePatientFcmTokenDto) {
    return { data: await this.auth.updateFcmToken(req.patientAccountId, body.deviceId, body.fcmToken) };
  }

  // ── 보호자 워크플로우 ──

  @Post('guardians/request')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '보호자 등록 신청' })
  async requestGuardian(@Req() req: PatientAccountRequest, @Body() dto: GuardianRequestDto) {
    const accountId = req.patientAccountId;
    return { data: await this.auth.requestGuardian(accountId, { ...dto, guardianAccountId: accountId }) };
  }

  @Get('guardians')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 보호자/피부양자 목록' })
  async getGuardians(@Req() req: PatientAccountRequest) {
    const accountId = req.patientAccountId;
    return { data: await this.auth.getGuardianRelations(accountId) };
  }

  @Delete('guardians/:id')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '보호자 관계 해제' })
  async removeGuardian(@Param('id') id: string, @Req() req: PatientAccountRequest) {
    const accountId = req.patientAccountId;
    return { data: await this.auth.removeGuardian(accountId, id) };
  }

  // ── 알림 관리 ──

  @Get('notifications')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 알림 목록 (페이지네이션)' })
  async getNotifications(@Req() req: PatientAccountRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    const accountId = req.patientAccountId;
    return { data: await this.auth.getNotifications(accountId, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20) };
  }

  @Get('notifications/unread-count')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '미읽음 알림 수' })
  async getUnreadCount(@Req() req: PatientAccountRequest) {
    const accountId = req.patientAccountId;
    return { data: { count: await this.auth.getUnreadCount(accountId) } };
  }

  @Put('notifications/:id/read')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '알림 읽음 처리' })
  async markNotificationRead(@Param('id') id: string, @Req() req: PatientAccountRequest) {
    const accountId = req.patientAccountId;
    return { data: await this.auth.markNotificationRead(accountId, id) };
  }

  @Put('notifications/read-all')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '전체 알림 읽음 처리' })
  async markAllRead(@Req() req: PatientAccountRequest) {
    const accountId = req.patientAccountId;
    return { data: await this.auth.markAllNotificationsRead(accountId) };
  }

  @Get('notifications/settings')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '알림 설정 조회' })
  async getNotificationSettings(@Req() req: PatientAccountRequest) {
    const accountId = req.patientAccountId;
    return { data: await this.auth.getNotificationSettings(accountId) };
  }

  @Put('notifications/settings')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '알림 설정 변경' })
  async updateNotificationSettings(@Req() req: PatientAccountRequest, @Body() dto: UpdateNotificationSettingsDto) {
    const accountId = req.patientAccountId;
    return { data: await this.auth.updateNotificationSettings(accountId, dto.settings) };
  }

  @Post('device/push-token')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'FCM 푸시 토큰 등록/갱신' })
  async registerPushToken(
    @Req() req: PatientAccountRequest,
    @Body() body: RegisterPatientPushTokenDto,
  ) {
    const accountId = req.patientAccountId;
    await this.auth.registerPushToken(accountId, body.deviceId, body.fcmToken, body.platform);
    return { data: { registered: true } };
  }
}

// ── 관리자 환자 계정 관리 ──
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@ApiTags('Patient Account Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/patient-accounts')
export class PatientAccountAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: PatientAuthService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '환자 계정 목록' })
  async list(@Query('status') status?: string, @Query('search') search?: string) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { patient: { familyName: { contains: search } } },
        { patient: { givenName: { contains: search } } },
      ];
    }
    const accounts = await this.prisma.patientAccount.findMany({
      where, take: 50, orderBy: { createdAt: 'desc' },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        devices: { where: { isActive: true }, select: { id: true, platform: true, lastActiveAt: true } },
        _count: { select: { consents: true, devices: true } },
      },
    });
    return { data: accounts };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '계정 상세' })
  async detail(@Param('id') id: string) {
    return {
      data: await this.prisma.patientAccount.findUnique({
        where: { id },
        include: {
          patient: { select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true, phone: true } },
          devices: true,
          consents: { orderBy: { createdAt: 'desc' } },
        },
      }),
    };
  }

  @Put(':id/lock')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '계정 잠금' })
  async lock(@Param('id') id: string) {
    return { data: await this.prisma.patientAccount.update({ where: { id }, data: { status: 'LOCKED', lockedUntil: new Date('2099-12-31') } }) };
  }

  @Put(':id/unlock')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '계정 잠금 해제' })
  async unlock(@Param('id') id: string) {
    return { data: await this.prisma.patientAccount.update({ where: { id }, data: { status: 'ACTIVE', lockedUntil: null, failedAttempts: 0 } }) };
  }

  @Get('stats/summary')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '계정 통계' })
  async stats() {
    const [total, active, locked, withdrawn, todaySignups] = await Promise.all([
      this.prisma.patientAccount.count(),
      this.prisma.patientAccount.count({ where: { status: 'ACTIVE' } }),
      this.prisma.patientAccount.count({ where: { status: { in: ['LOCKED', 'SUSPENDED'] } } }),
      this.prisma.patientAccount.count({ where: { status: 'WITHDRAWN' } }),
      this.prisma.patientAccount.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    ]);
    return { data: { total, active, locked, withdrawn, todaySignups } };
  }

  // ── 보호자 관리 (관리자) ──

  @Get('guardians/pending')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '승인 대기 보호자 목록' })
  async getPendingGuardians() {
    return { data: await this.authService.getPendingGuardians() };
  }

  @Put('guardians/:id/approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '보호자 승인' })
  async approveGuardian(@Param('id') id: string, @Body() dto: GuardianApproveDto, @CurrentUser('id') userId: string) {
    return { data: await this.authService.approveGuardian(id, userId, dto.accessScope, dto.expiresAt) };
  }

  @Put('guardians/:id/reject')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '보호자 거부' })
  async rejectGuardian(@Param('id') id: string, @Body() dto: GuardianRejectDto) {
    return { data: await this.authService.rejectGuardian(id, dto.reason) };
  }
}
