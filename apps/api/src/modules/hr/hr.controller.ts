import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';
import { HrService } from './hr.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateStaffDto, UpdateStaffDto, PatchStaffDto, SetScheduleDto, SetStaffManagerDto, ChangeStaffStatusDto } from './dto/hr.dto';

/**
 * 🔴 역할 목록은 shared 정본 하나 — 여기에 다시 적으면 신설 직군이 따라오지 못한다.
 *    실제로 그랬다(2026-09-02 실측): 손으로 적은 12역할 목록에 CRM_MANAGER·CRM_STAFF 가 빠져
 *    CRM 직원이 자기 근태·급여·결재함에서 상시 403 을 봤다.
 *    READ 만 뺀다 — 외부 연동 **읽기전용 서비스 계정**이라 사람 인사 정보의 대상이 아니다.
 */
const HUMAN_STAFF_ROLES = EVERY_STAFF_ROLE.filter((r) => r !== 'READ').map((r) => r as UserRole);

@ApiTags('HR (인사관리)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/hr')
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Get('staff')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '직원 목록 (관리자 전용)' })
  async findAll(@Query('category') category?: string, @Query('department') department?: string, @Query('status') status?: string) {
    return { data: await this.hrService.findAll({ category, department, status }) };
  }

  @Post('staff')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '직원 등록' })
  async create(@Body() dto: CreateStaffDto) { return { data: await this.hrService.create(dto as any) }; }

  @Patch('staff/:id/manager')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '직원 보고라인(상급자 Staff) 설정 — 에스컬레이션 대상(P1-7)' })
  async setManager(@Param('id', ParseUUIDPipe) id: string, @Body() body: SetStaffManagerDto) {
    return { data: await this.hrService.setManager(id, body?.managerStaffId || null) };
  }

  @Post('staff/backfill-erp')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기존 직원 ERP 디렉터리 백필(staff.created 재발행·멱등)' })
  async backfillErp(@Query('status') status?: string) {
    return { data: await this.hrService.backfillStaffToErp(status ?? 'ACTIVE') };
  }

  @Post('staff/backfill-from-users')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기존 직원 User→Staff 백필 — Staff 없는 User에 Staff 생성(ESS 활성화·멱등)' })
  async backfillFromUsers() {
    return { data: await this.hrService.backfillUsersToStaff() };
  }

  @Get('me')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '내 인사기록 조회' })
  async findMe(@CurrentUser('id') userId: string) {
    const staff = await this.hrService.findByUserId(userId);
    return { data: staff };
  }

  @Get('staff/:id')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '직원 상세 (스케줄 포함)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const staff = await this.hrService.findById(id);
    if (user.role !== 'ADMIN' && staff.userId !== (user.id ?? user.sub)!) {
      throw new ForbiddenException('본인의 인사기록만 조회할 수 있습니다.');
    }
    return { data: staff };
  }

  @Put('staff/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '직원 정보 수정' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto) { return { data: await this.hrService.update(id, dto) }; }

  @Patch('staff/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '직원 정보 부분 수정 (Clinic 연동용)' })
  async patchStaff(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchStaffDto) {
    return { data: await this.hrService.patch(id, dto) };
  }

  @Patch('staff/:id/resign')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '퇴직 처리' })
  async resign(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.hrService.resign(id) }; }

  @Patch('staff/:id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '재직상태 변경(휴직 ON_LEAVE/복직 ACTIVE) — ERP staff.changed 발행' })
  async changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChangeStaffStatusDto) {
    return { data: await this.hrService.changeStatus(id, body.status, body.effectiveDate || undefined) };
  }

  @Get('departments')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '부서 목록 + 인원' })
  async getDepartments() { return { data: await this.hrService.getDepartmentList() }; }

  @Post('schedule')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '근무 스케줄 등록/수정 (배치)' })
  async setSchedule(@Body() body: SetScheduleDto) {
    return { data: await this.hrService.setSchedule(body.staffId, body.schedules) };
  }

  @Get('schedule')
  @Roles(...HUMAN_STAFF_ROLES)
  @ApiOperation({ summary: '근무 스케줄 조회 (기간/부서/개인)' })
  async getSchedule(@Query('staffId') staffId?: string, @Query('department') department?: string, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return { data: await this.hrService.getSchedule({ staffId, department, dateFrom: dateFrom ?? new Date().toISOString().split('T')[0], dateTo: dateTo ?? new Date().toISOString().split('T')[0] }) };
  }
}
