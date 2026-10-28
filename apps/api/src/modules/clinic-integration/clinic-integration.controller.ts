import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Req,
  UseGuards,
  Logger,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { secureKeyEqual } from '../../common/util/secure-compare';
import { ClinicApiService } from './clinic-api.service';
import { ErpEapprovalService } from './erp-eapproval.service';
import {
  SyncSurgeryScheduleDto,
  UpdateRoleMappingDto,
  SendNotificationDto,
  SendUrgentNotificationDto,
  SendChannelMessageDto,
  SendHandoffDto,
  SyncCalendarDto,
  RequestLeaveDto,
  RequestApprovalDto,
  CreateWikiPageDto,
  SubscribeWebhookDto,
  ReceiveWebhookDto,
} from './dto/clinic-integration.dto';

@ApiTags('Clinic Integration')
@Controller('api/v1/clinic')
export class ClinicIntegrationController {
  private readonly logger = new Logger(ClinicIntegrationController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly clinicApi: ClinicApiService,
  ) {}

  /**
   * GET /api/v1/clinic/status
   * Integration status check
   */
  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinic 연동 상태' })
  async getStatus() {
    const clinicApiUrl = this.config.get<string>('CLINIC_API_URL', '');
    const clinicApiKey = this.config.get<string>('CLINIC_API_KEY', '');
    const hospitalCode = this.config.get<string>('CLINIC_HOSPITAL_CODE', '');

    const linkedStaffCount = await this.prisma.staff.count({
      where: { clinicUserId: { not: null } },
    });
    const totalStaffCount = await this.prisma.staff.count({
      where: { status: 'ACTIVE' },
    });

    return {
      data: {
        configured: !!(clinicApiUrl && clinicApiKey && hospitalCode),
        clinicApiUrl: clinicApiUrl || null,
        hospitalCode: hospitalCode || null,
        hasApiKey: !!clinicApiKey,
        staffMapping: {
          linked: linkedStaffCount,
          total: totalStaffCount,
        },
      },
    };
  }

  /**
   * GET /api/v1/clinic/role-mapping
   * Get role mappings (Staff records with clinicUserId)
   */
  @Get('role-mapping')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '역할 매핑 조회' })
  async getRoleMappings() {
    const staffWithMapping = await this.prisma.staff.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        userId: true,
        clinicUserId: true,
        familyName: true,
        givenName: true,
        category: true,
        department: true,
        position: true,
        specialty: true,
      },
      orderBy: [{ department: 'asc' }, { familyName: 'asc' }],
    });

    return {
      data: {
        mappings: staffWithMapping.map(s => ({
          staffId: s.id,
          userId: s.userId,
          clinicUserId: s.clinicUserId,
          name: `${s.familyName}${s.givenName}`,
          hisRole: s.category,
          department: s.department,
          position: s.position,
          specialty: s.specialty,
          linked: !!s.clinicUserId,
        })),
      },
    };
  }

  /**
   * PUT /api/v1/clinic/role-mapping
   * Update a staff member's clinic user mapping
   */
  @Put('role-mapping')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '역할 매핑 업데이트' })
  async updateRoleMapping(@Body() dto: UpdateRoleMappingDto) {
    const updateData: Record<string, unknown> = { clinicUserId: dto.clinicUserId };
    if (dto.department) updateData.department = dto.department;

    const updated = await this.prisma.staff.update({
      where: { id: dto.staffId },
      data: updateData,
    });

    this.logger.log(`Role mapping updated: staff ${dto.staffId} -> clinic ${dto.clinicUserId}`);

    return { data: updated };
  }

  /**
   * POST /api/v1/clinic/sync-staff
   * Sync staff list from Clinic
   */
  @Post('sync-staff')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinic 직원 동기화' })
  async syncStaff() {
    const clinicStaff = await this.clinicApi.fetchClinicStaff();

    let linked = 0;
    let skipped = 0;

    for (const cs of clinicStaff) {
      const csId = cs.id as string;
      const csEmail = cs.email as string;
      // Try to find matching HIS staff by email
      const hisStaff = await this.prisma.staff.findFirst({
        where: {
          OR: [
            { clinicUserId: csId },
            { email: csEmail },
          ],
          status: 'ACTIVE',
        },
      });

      if (hisStaff && !hisStaff.clinicUserId) {
        await this.prisma.staff.update({
          where: { id: hisStaff.id },
          data: { clinicUserId: csId },
        });
        linked++;
      } else {
        skipped++;
      }
    }

    this.logger.log(`Staff sync completed: ${linked} linked, ${skipped} skipped from ${clinicStaff.length} Clinic staff`);

    return {
      data: {
        totalFromClinic: clinicStaff.length,
        linked,
        skipped,
      },
    };
  }

  /**
   * POST /api/v1/clinic/push-staff
   * Push HIS staff to Clinic (register as members)
   */
  @Post('push-staff')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'HIS 직원 → Clinic 멤버 등록' })
  async pushStaff(@CurrentUser('id') userId: string) {
    const staffList = await this.prisma.staff.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, userId: true, email: true, familyName: true, givenName: true, department: true, category: true, employeeNumber: true, position: true },
    });

    // 🔴 종전에는 직원 **분류**를 역할 어휘로 옮겼다 — MEDICAL(의사+간호사)→'Doctor',
    //    ADMIN(행정직)→'Admin'. 분류는 권한이 아니다. Clinic 이 이 값을 돌려주면 SSO 신규 생성에서
    //    간호사가 DOCTOR, 행정직이 시스템 ADMIN 이 될 수 있었다.
    //    이제 **HIS 정본 역할(User.role)** 을 보낸다. 연결된 활성 계정이 없으면 최소권한 READ(모르면 안전측).
    const linkedUserIds = staffList.map(s => s.userId).filter((id): id is string => !!id);
    const linkedUsers = linkedUserIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: linkedUserIds } }, select: { id: true, role: true, isActive: true } })
      : [];
    const roleByUserId = new Map(linkedUsers.filter(u => u.isActive).map(u => [u.id, u.role as string]));

    // 🔴 종전에는 **모든 직원에게 같은 고정 비밀번호**(개발 시드 값)를 실어 보냈고 상대는 그 값으로
    //    계정을 만들었다(email_verified=true). 저장소에 적힌 값이라 아는 사람은 누구나 남의 계정으로 들어간다.
    //    기본값을 지어내지 않는다 — 기관이 정하는 값이고, **미설정이면 보내지 않는다**(fail-closed).
    //    다른 Clinic 연동 값(CLINIC_API_URL·CLINIC_API_KEY·CLINIC_HOSPITAL_CODE)과 같은 층(환경변수)에 둔다.
    const initialPassword = this.config.get<string>('CLINIC_INITIAL_PASSWORD', '').trim();
    if (!initialPassword) {
      throw new BadRequestException({
        code: 'CLINIC_INITIAL_PASSWORD_UNSET',
        message: '연동 초기 비밀번호(CLINIC_INITIAL_PASSWORD)가 설정되지 않았습니다. 값을 정한 뒤 다시 실행하세요.',
      });
    }

    const payload = staffList.map(s => ({
      email: s.email ?? `${s.familyName}${s.givenName}@hospitalrun.example`.toLowerCase(),
      name: `${s.familyName}${s.givenName}`,
      password: initialPassword,
      department: s.department,
      hisRole: (s.userId && roleByUserId.get(s.userId)) || 'READ',
      // ⚠️ employeeNumber/position 동봉 금지 — Clinic staff/sync가 미지원 필드에 500 (2026-07-17 실측). 사번·직위는 organization/sync로만
    }));

    let result: Record<string, unknown> = { registered: 0, skipped: 0, errors: [] };
    let logStatus = 'SUCCESS';
    let errorMessage: string | undefined;

    let mapped = 0;
    let mapFailed = 0;
    try {
      result = await this.clinicApi.pushStaffToClinic(payload);
      // 회신 details[].clinicUserId를 Staff 매핑에 영속 (C-3 §2 — 매핑 키=Clinic userId)
      const details = (result.details as { email?: string; employeeNumber?: string; clinicUserId?: string }[] | undefined) ?? [];
      for (const d of details) {
        if (!d.clinicUserId) continue;
        const target = staffList.find(st => (d.employeeNumber && st.employeeNumber === d.employeeNumber) || (d.email && st.email === d.email));
        if (!target) continue;
        // 🔴 매핑 실패를 삼키면 `mapped` 가 실제보다 크게 나온다 — 실패는 세어서 돌려준다
        try {
          await this.prisma.staff.update({ where: { id: target.id }, data: { clinicUserId: d.clinicUserId } });
          mapped++;
        } catch (e) {
          mapFailed++;
          this.logger.warn(`clinicUserId 매핑 저장 실패 staff=${target.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (err: unknown) {
      logStatus = 'FAILED';
      const msg = err instanceof Error ? err.message : String(err);
      errorMessage = msg;
      result = { registered: 0, skipped: 0, errors: [msg] };
    }

    // 동기화 이력 저장
    const resultErrors = result.errors as unknown[] | undefined;
    await this.prisma.clinicSyncLog.create({
      data: {
        syncType: 'PUSH_STAFF',
        status: logStatus,
        totalSent: payload.length,
        registered: (result.registered as number) ?? 0,
        skipped: (result.skipped as number) ?? 0,
        failed: resultErrors?.length ?? 0,
        details: (result.details ?? result.errors ?? null) as Parameters<typeof this.prisma.clinicSyncLog.create>[0]['data']['details'],
        errorMessage,
        executedBy: userId,
      },
    });

    return { data: { total: payload.length, mappedClinicUserIds: mapped, mappingFailed: mapFailed, ...result } };
  }

  /**
   * POST /api/v1/clinic/sync-organization
   * HIS 조직도(부서·보고라인) → Clinic 단방향 push — 결재선 추천의 근거
   */
  @Post('sync-organization')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'HIS 조직도 → Clinic 동기화(부서·보고라인)' })
  async syncOrganization(@CurrentUser('id') userId: string) {
    // v2 staff[] 포맷 (Clinic 회신 2026-07-17) — 사번 기반 보고라인·멱등 upsert·자동 계정 생성·mappings[] 회신
    // 🔴 `take:1000` 에 정렬이 없어 1,000명 초과 기관은 **임의의** 1,000명만 갔고
    //    응답은 `sent:1000`·SUCCESS 였다. 정렬(사번)로 결정적으로 자르고, 잘랐다고 응답·이력에 밝힌다.
    const ORG_SYNC_LIMIT = 1000; // v2 호출당 상한
    const orgWhere = { status: { in: ['ACTIVE', 'ON_LEAVE'] as ('ACTIVE' | 'ON_LEAVE')[] } };
    const eligibleTotal = await this.prisma.staff.count({ where: orgWhere });
    const staff = await this.prisma.staff.findMany({
      where: orgWhere,
      select: {
        id: true, employeeNumber: true, email: true, familyName: true, givenName: true,
        department: true, position: true, status: true, hireDate: true,
        manager: { select: { employeeNumber: true } },
      },
      orderBy: { employeeNumber: 'asc' },
      take: ORG_SYNC_LIMIT,
    });
    const truncated = eligibleTotal > staff.length;
    // ⚠️ Clinic v2 스키마는 null 불허(expected string) — 널 필드는 생략 (2026-07-17 실측)
    const payload = staff.map(s => ({
      employeeNumber: s.employeeNumber,
      email: s.email,
      name: `${s.familyName}${s.givenName}`,
      department: s.department,
      status: s.status,
      ...(s.position ? { position: s.position } : {}),
      ...(s.hireDate ? { hireDate: s.hireDate.toISOString().slice(0, 10) } : {}),
      ...(s.manager?.employeeNumber ? { managerEmployeeNumber: s.manager.employeeNumber } : {}),
    }));

    let logStatus = 'SUCCESS';
    let errorMessage: string | undefined;
    let result: Record<string, unknown> = {};
    let mapped = 0;
    let mapFailed = 0;
    try {
      result = await this.clinicApi.pushOrganizationToClinic({ staff: payload });
      // mappings[] (employeeNumber↔clinicUserId) 영속 — 매핑 키 왕복 저장(회신 §1)
      const mappings = (result.mappings as { employeeNumber?: string; clinicUserId?: string }[] | undefined) ?? [];
      for (const m of mappings) {
        if (!m.employeeNumber || !m.clinicUserId) continue;
        const target = staff.find(st => st.employeeNumber === m.employeeNumber);
        if (!target) continue;
        // 🔴 (B5) 저장 실패를 삼킨 뒤에도 mapped++ 로 셌다 — 실패는 따로 센다(push-staff 와 같은 규칙)
        try {
          await this.prisma.staff.update({ where: { id: target.id }, data: { clinicUserId: m.clinicUserId } });
          mapped++;
        } catch (e) {
          mapFailed++;
          this.logger.warn(`clinicUserId 매핑 저장 실패(조직 동기화) staff=${target.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (err: unknown) {
      logStatus = 'FAILED';
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    await this.prisma.clinicSyncLog.create({
      data: {
        syncType: 'PUSH_ORG', status: logStatus, totalSent: payload.length,
        registered: Number((result.synced as Record<string, unknown> | undefined)?.members ?? (result.synced as Record<string, unknown> | undefined)?.created ?? result.created ?? 0),
        skipped: 0, failed: logStatus === 'FAILED' ? payload.length : 0,
        details: JSON.parse(JSON.stringify({ ...(result ?? {}), hisSelection: { eligibleTotal, sent: payload.length, truncated, limit: ORG_SYNC_LIMIT } })), errorMessage, executedBy: userId,
      },
    });
    if (logStatus === 'FAILED') throw new HttpException({ code: 'CLINIC_ORG_SYNC_FAILED', message: errorMessage }, HttpStatus.BAD_GATEWAY);
    return {
      data: {
        sent: payload.length, eligibleTotal, truncated, limit: ORG_SYNC_LIMIT,
        mappedClinicUserIds: mapped, mappingFailed: mapFailed, clinicResult: result,
      },
    };
  }

  /**
   * GET /api/v1/clinic/sync-logs
   * 동기화 이력 조회
   */
  @Get('sync-logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinic 동기화 이력' })
  async getSyncLogs() {
    const logs = await this.prisma.clinicSyncLog.findMany({
      orderBy: { executedAt: 'desc' },
      take: 50,
      include: { executor: { select: { familyName: true, givenName: true } } },
    });
    return { data: logs };
  }

  /**
   * GET /api/v1/clinic/hospital
   * Hospital info for Clinic
   */
  @Get('hospital')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiBearerAuth()
  @ApiOperation({ summary: '병원 정보 (Clinic 연동용)' })
  async getHospitalInfo() {
    const hospitalCode = this.config.get<string>('CLINIC_HOSPITAL_CODE', '');

    const staffCount = await this.prisma.staff.count({ where: { status: 'ACTIVE' } });
    const departments = await this.prisma.staff.groupBy({
      by: ['department'],
      where: { status: 'ACTIVE' },
      _count: true,
    });

    return {
      data: {
        code: hospitalCode,
        name: this.config.get<string>('HOSPITAL_NAME', 'Hospital RUN'),
        type: 'hospital',
        staffCount,
        departments: departments.map(d => d.department),
        hisEnabled: true,
        features: {
          emr: true,
          ocs: true,
          pharmacy: true,
          lab: true,
          imaging: true,
          billing: true,
          inpatient: true,
          surgery: true,
          emergency: true,
        },
      },
    };
  }

  // ============================================================
  // Phase 2: Notifications / Channel
  // ============================================================

  /**
   * POST /api/v1/clinic/notify
   * Send notification via Clinic
   */
  @Post('notify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinic 알림 발송' })
  async sendNotification(@Body() dto: SendNotificationDto) {
    await this.clinicApi.sendNotification(dto);
    return { data: { sent: true } };
  }

  /**
   * POST /api/v1/clinic/notify/urgent
   * Send urgent notification via Clinic
   */
  @Post('notify/urgent')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinic 긴급 알림 발송' })
  async sendUrgentNotification(@Body() dto: SendUrgentNotificationDto) {
    await this.clinicApi.sendUrgentNotification(dto);
    return { data: { sent: true } };
  }

  /**
   * POST /api/v1/clinic/channel/message
   * Send message to a Clinic channel
   */
  @Post('channel/message')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinic 채널 메시지 발송' })
  async sendChannelMessage(@Body() dto: SendChannelMessageDto) {
    await this.clinicApi.sendChannelMessage(dto);
    return { data: { sent: true } };
  }

  /**
   * POST /api/v1/clinic/channel/handoff
   * Send handoff note via Clinic
   */
  @Post('channel/handoff')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinic 인수인계 노트 발송' })
  async sendHandoff(@Body() dto: SendHandoffDto) {
    await this.clinicApi.sendHandoff(dto);
    return { data: { sent: true } };
  }

  /**
   * GET /api/v1/clinic/channels
   * Get list of Clinic channels
   */
  @Get('channels')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinic 채널 목록 조회' })
  async getChannels() {
    const channels = await this.clinicApi.getChannels();
    return { data: { channels } };
  }

  // ============================================================
  // Phase 3: Calendar / Attendance
  // ============================================================

  /**
   * POST /api/v1/clinic/calendar/sync
   * Sync HIS calendar events to Clinic
   */
  @Post('calendar/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'HIS 캘린더 이벤트 → Clinic 동기화' })
  async syncCalendar(@Body() dto: SyncCalendarDto) {
    const result = await this.clinicApi.syncCalendarEvents(dto.events);
    return { data: result };
  }

  /**
   * POST /api/v1/clinic/calendar/surgery
   * Sync surgery schedule to Clinic
   */
  @Post('calendar/surgery')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: '수술 일정 → Clinic 동기화' })
  async syncSurgerySchedule(@Body() dto: SyncSurgeryScheduleDto) {
    await this.clinicApi.syncSurgerySchedule(dto);
    return { data: { synced: true } };
  }

  /**
   * GET /api/v1/clinic/attendance
   * Get attendance status from Clinic
   */
  @Get('attendance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiBearerAuth()
  @ApiOperation({ summary: '출퇴근 현황 조회 (Clinic)' })
  async getAttendance() {
    const records = await this.clinicApi.getAttendance();
    return { data: { records } };
  }

  /**
   * GET /api/v1/clinic/leave/:userId
   * Get leave balance from Clinic
   */
  @Get('leave/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiBearerAuth()
  @ApiOperation({ summary: '연차 잔여 조회 (Clinic)' })
  async getLeaveBalance(@Param('userId') userId: string) {
    const balance = await this.clinicApi.getLeaveBalance(userId);
    return { data: balance };
  }

  /**
   * POST /api/v1/clinic/leave/request
   * Request leave via Clinic
   */
  @Post('leave/request')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiBearerAuth()
  @ApiOperation({ summary: '연차 신청 (Clinic)' })
  async requestLeave(@Body() dto: RequestLeaveDto) {
    const result = await this.clinicApi.requestLeave(dto);
    return { data: result };
  }

  // ============================================================
  // Phase 4: Approval (W.Sign) / Wiki (ShareSpace)
  // ============================================================

  /**
   * POST /api/v1/clinic/wsign/request
   * Request approval via Clinic W.Sign
   */
  @Post('wsign/request')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: '전자결재 요청 (Clinic W.Sign)' })
  async requestApproval(@Body() dto: RequestApprovalDto) {
    const result = await this.clinicApi.requestApproval(dto);
    return { data: result };
  }

  /**
   * GET /api/v1/clinic/wsign/status/:docId
   * Check approval status
   */
  @Get('wsign/status/:docId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: '전자결재 상태 조회 (Clinic W.Sign)' })
  async getApprovalStatus(@Param('docId') docId: string) {
    const status = await this.clinicApi.getApprovalStatus(docId);
    return { data: status };
  }

  /**
   * GET /api/v1/clinic/wiki/search
   * Search Clinic Wiki (ShareSpace)
   */
  @Get('wiki/search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Wiki 검색 (Clinic ShareSpace)' })
  async searchWiki(@Query('q') q: string) {
    if (!q) {
      throw new HttpException(
        { code: 'INVALID_INPUT', message: 'Query parameter "q" is required' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const pages = await this.clinicApi.searchWiki(q);
    return { data: { pages } };
  }

  /**
   * GET /api/v1/clinic/wiki/page/:pageId
   * Get a single wiki page
   */
  @Get('wiki/page/:pageId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Wiki 페이지 조회 (Clinic ShareSpace)' })
  async getWikiPage(@Param('pageId') pageId: string) {
    const page = await this.clinicApi.getWikiPage(pageId);
    return { data: page };
  }

  /**
   * POST /api/v1/clinic/wiki/page
   * Create a new wiki page
   */
  /**
   * 🔴 원 결함(W8/A6): 이 **쓰기**에 `RolesGuard` 가 없어(JwtAuthGuard 뿐) 로그인한 전 직원이
   *    병원 서비스 자격으로 외부 Clinic ShareSpace 에 문서를 만들 수 있었다 — 외부 시스템에
   *    병원 이름으로 남는 기록이다. 같은 컨트롤러의 다른 쓰기(webhook 구독 등)는 전부
   *    `@Roles(ADMIN)` 인데 여기만 빠져 있었다. 호출하는 화면은 없다(FE grep 0건).
   */
  @Post('wiki/page')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Wiki 페이지 생성 (Clinic ShareSpace·관리자)' })
  async createWikiPage(@Body() dto: CreateWikiPageDto) {
    const page = await this.clinicApi.createWikiPage(dto);
    return { data: page };
  }

  // ============================================================
  // Phase 5: Webhook Management
  // ============================================================

  /**
   * POST /api/v1/clinic/webhooks/subscribe
   * Subscribe to Clinic webhook events
   */
  @Post('webhooks/subscribe')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Webhook 구독 등록' })
  async subscribeWebhook(@Body() dto: SubscribeWebhookDto) {
    // Register on Clinic side
    const clinicResult = await this.clinicApi.subscribeWebhook(dto);

    // Persist locally
    const subscription = await this.prisma.webhookSubscription.create({
      data: {
        url: dto.url,
        events: dto.events,
        secret: dto.secret,
        isActive: true,
      },
    });

    this.logger.log(`Webhook subscribed: ${subscription.id} for events [${dto.events.join(', ')}]`);

    return {
      data: {
        id: subscription.id,
        url: subscription.url,
        events: subscription.events,
        isActive: subscription.isActive,
        clinicResponse: clinicResult,
      },
    };
  }

  /**
   * GET /api/v1/clinic/webhooks/subscriptions
   * List local webhook subscriptions
   */
  @Get('webhooks/subscriptions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Webhook 구독 목록 조회' })
  async listWebhookSubscriptions() {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: { isActive: true },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { data: { subscriptions } };
  }

  /**
   * DELETE /api/v1/clinic/webhooks/:id
   * Unsubscribe from webhook events
   */
  @Delete('webhooks/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Webhook 구독 해제' })
  async unsubscribeWebhook(@Param('id') id: string) {
    const subscription = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new HttpException(
        { code: 'NOT_FOUND', message: 'Webhook subscription not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    // Notify Clinic to remove the webhook
    try {
      await this.clinicApi.unsubscribeWebhook(id);
    } catch (error) {
      this.logger.warn(`Failed to unsubscribe on Clinic side: ${error instanceof Error ? error.message : error}`);
    }

    // Soft-delete locally
    await this.prisma.webhookSubscription.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`Webhook unsubscribed: ${id}`);

    return { data: { id, unsubscribed: true } };
  }
}

/**
 * Webhook receiver controller
 * Receives webhooks from Clinic (e.g., wsign.approved, attendance.checkin)
 */
@ApiTags('Webhooks')
@Controller('api/v1/webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly erpEapproval: ErpEapprovalService,
  ) {}

  /**
   * POST /api/v1/webhooks/clinic
   * Receive webhooks from Clinic
   */
  @Post('clinic')
  @ApiOperation({ summary: 'Clinic Webhook 수신' })
  async receiveWebhook(
    @Req() req: { rawBody?: Buffer },
    @Headers('x-clinic-signature') clinicSignature: string | undefined,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Headers('x-webhook-secret') webhookSecret: string | undefined,
    @Body() dto: ReceiveWebhookDto,
  ) {
    // C-3 정본 경로: X-Clinic-Signature = HMAC-SHA256(rawBody) — HIS가 PUT callback-secret으로
    // 등록한 시크릿(CLINIC_CALLBACK_SECRET)과 쌍. wsign.* 이벤트는 이 경로 사용 (2026-07-16 Clinic 회신)
    //
    // 🔴 (2026-09-16 G2) 종전 구조는 **미설정 시 여는 방향**으로 열려 있었다(fail-open).
    //    레거시 분기가 `if (secret) { …검증… }` 이라 HIS_WEBHOOK_SECRET·WEBHOOK_SECRET 둘 다
    //    미설정이면 **검증 블록을 통째로 건너뛰고** 그대로 처리했다. 운영에는 CLINIC_CALLBACK_SECRET 만
    //    설정돼 있어, 공격자가 X-Clinic-Signature 를 **빼기만 하면** 레거시 분기로 떨어져 무인증 통과했다
    //    (2026-09-16 운영 실측: 서명 없는 POST → 201 `{received:true}`).
    //    이 EP 는 `hospital-register` 로 CLINIC_API_KEY·CLINIC_API_URL(아웃바운드 연동 대상)을 덮어쓰고
    //    `wsign.*` 로 전자결재 결과를 릴레이한다 — 무인증 쓰기가 닿으면 안 되는 자리다.
    //    이제 **어느 시크릿도 설정돼 있지 않으면 거부**한다(§운영모드 NODE_ENV 안전분기 함정과 같은 유형).
    const clinicSecret = this.configService.get<string>('CLINIC_CALLBACK_SECRET');
    const legacySecret = this.configService.get<string>('HIS_WEBHOOK_SECRET') || this.configService.get<string>('WEBHOOK_SECRET');
    if (!clinicSecret && !legacySecret) {
      throw new UnauthorizedException('웹훅 시크릿 미구성 — 수신을 거부합니다');
    }
    if (clinicSignature) {
      // 서명을 동봉했으면 정본 경로로만 판정한다(시크릿 미설정 시 레거시로 흘려보내지 않는다)
      if (!clinicSecret) throw new UnauthorizedException('Clinic 콜백 시크릿 미구성');
      if (!req.rawBody) throw new UnauthorizedException('원문 본문 없음(rawBody)');
      const crypto = await import('crypto');
      const expectedHex = crypto.createHmac('sha256', clinicSecret).update(req.rawBody).digest('hex');
      const given = Buffer.from(clinicSignature.replace(/^sha256=/, ''), 'hex');
      const expected = Buffer.from(expectedHex, 'hex');
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
        throw new UnauthorizedException('Invalid clinic signature');
      }
    } else if (legacySecret) {
      // 레거시 경로: X-Webhook-Secret 또는 HMAC 서명 검증
      if (webhookSecret && secureKeyEqual(webhookSecret, legacySecret)) {
        // OK — simple secret match(상수시간 비교)
      } else if (signature) {
        // HMAC 서명 검증
        const crypto = await import('crypto');
        const expected = crypto
          .createHmac('sha256', legacySecret)
          .update(JSON.stringify(dto))
          .digest('hex');
        if (!secureKeyEqual(signature, `sha256=${expected}`)) {
          throw new UnauthorizedException('Invalid webhook signature');
        }
      } else {
        throw new UnauthorizedException('Missing webhook authentication');
      }
    } else {
      // 정본 시크릿만 설정된 환경에서 서명을 빼고 들어온 요청 — 종전에 뚫려 있던 경로
      throw new UnauthorizedException('Missing webhook authentication');
    }

    // Replay 방지: 5분 이내 요청만 허용
    if (dto.timestamp) {
      const eventTime = new Date(dto.timestamp).getTime();
      if (Math.abs(Date.now() - eventTime) > 5 * 60 * 1000) {
        throw new UnauthorizedException('Webhook timestamp expired');
      }
    }

    this.logger.log(`Webhook received: ${dto.event} at ${dto.timestamp}`);

    switch (dto.event) {
      case 'hospital-register':
        return this.handleHospitalRegister(dto.data as { hospitalId: string; hospitalName: string; hospitalCode: string; hospitalType: string; apiKey: string; clinicApiUrl: string });

      case 'wsign.approved':
      case 'wsign.rejected':
      case 'wsign.withdrawn': {
        const docId = dto.data?.docId as string;
        this.logger.log(`W.Sign event: ${dto.event} for doc ${docId} (eventId=${dto.eventId ?? '-'})`);
        // ERP 릴레이 문서면 ERP 콜백으로 전달 — eventId는 최상위가 정본(C-3 §5.3)
        if (docId) void this.erpEapproval.handleWsignResult(docId, dto.event as 'wsign.approved' | 'wsign.rejected' | 'wsign.withdrawn', { ...(dto.data ?? {}), eventId: dto.eventId ?? dto.data?.eventId });
        break;
      }
      case 'attendance.checkin':
      case 'attendance.checkout':
        // 폐기 확정(2026-07-16 Clinic 회신) — Clinic 측 발신 코드 없음, 근태는 HIS 단일 정본
        this.logger.log(`Attendance event(폐기된 경로 — 무시): ${dto.event}`);
        break;
      case 'member.joined':
      case 'member.left':
        this.logger.log(`Member event: ${dto.event} for user ${dto.data?.userId}`);
        break;
      default:
        this.logger.log(`Unhandled webhook event: ${dto.event}`);
    }

    return { received: true, event: dto.event };
  }

  /**
   * hospital-register 이벤트 처리
   * 메인앱에서 병원 승인 시 호출. API 키와 병원 정보를 시스템 설정에 저장.
   */
  private async handleHospitalRegister(data: {
    hospitalId: string;
    hospitalName: string;
    hospitalCode: string;
    hospitalType: string;
    apiKey: string;
    clinicApiUrl: string;
  }) {
    this.logger.log(`Hospital register webhook: ${data.hospitalName} (${data.hospitalCode})`);

    // SystemConfig에 저장 (키-값 형태)
    const configs = [
      { key: 'CLINIC_API_KEY', value: data.apiKey },
      { key: 'CLINIC_API_URL', value: data.clinicApiUrl },
      { key: 'CLINIC_HOSPITAL_CODE', value: data.hospitalCode },
      { key: 'CLINIC_HOSPITAL_ID', value: data.hospitalId },
      { key: 'CLINIC_HOSPITAL_NAME', value: data.hospitalName },
      { key: 'CLINIC_HOSPITAL_TYPE', value: data.hospitalType },
    ];

    for (const cfg of configs) {
      await this.prisma.systemConfig.upsert({
        where: { key: cfg.key },
        update: { value: JSON.stringify(cfg.value) as any },
        create: { key: cfg.key, value: JSON.stringify(cfg.value) as any, category: 'clinic-integration', label: `Clinic 연동 — ${cfg.key}` },
      });
    }

    this.logger.log(`Hospital registered successfully: ${data.hospitalName}. ${configs.length} config entries saved.`);

    return {
      received: true,
      event: 'hospital-register',
      hospitalCode: data.hospitalCode,
      configsSaved: configs.length,
    };
  }
}
