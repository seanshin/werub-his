import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ScheduleService } from './schedule.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { RegisterWaitlistDto } from './dto/waitlist.dto';
import { AppointmentQueryDto, CalendarQueryDto, AvailabilityQueryDto } from './dto/appointment-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Appointments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1/appointments')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  /**
   * 🔴 **접수원이 이 화면의 주 사용자다**(`/reception` 예약 탭). 클래스 `@Roles` 에
   *    `RECEPTIONIST` 가 없어 **접수 화면을 열면 이 목록이 403** 이었다(2026-08-29 실측).
   *    같은 화면의 `call-patient` 에는 `RECEPTIONIST` 가 **이미 들어 있었다** —
   *    접수원이 쓴다는 것을 알고 있었는데 목록·체크인만 빠뜨린 것이다.
   * 🔴 **여는 것이 답인 성격이다**: 예약 명단은 접수 업무 자체이지 임상 정보 열람이 아니다.
   */
  @Roles(UserRole.RECEPTIONIST, UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '예약 목록 (날짜/의사/환자 필터)' })
  async findAll(@Query() query: AppointmentQueryDto) {
    return this.scheduleService.findAll(query);
  }

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '예약 생성' })
  async create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser('id') userId: string,
  ) {
    const { appointment, warnings } = await this.scheduleService.create(dto, userId);
    return { data: appointment, meta: { warnings } };
  }

  @Get('calendar')
  @ApiOperation({ summary: '캘린더 뷰 (주간/월간)' })
  async calendar(@Query() query: CalendarQueryDto) {
    return this.scheduleService.getCalendar(query);
  }

  // 🔴 접수원의 예약 업무는 목록만으로 안 된다 — 가용 슬롯·통계·일 뷰가 닫혀 있어
  //    /schedule·/schedule/new 에서 상시 403 이었다(2026-08-30 운영 실측). 조회만 연다(생성은 종전대로).
  @Get('availability')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '가용 슬롯 조회 (근무·휴진·정원 반영)' })
  async availability(@Query() query: AvailabilityQueryDto) {
    return this.scheduleService.getAvailability(query);
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '예약 통계 (상태별·노쇼율·과별)' })
  async stats(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.scheduleService.getStats({ dateFrom, dateTo });
  }

  @Get('day')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '일 뷰 타임그리드 (의사 레인·근무세션·예약블록)' })
  async day(
    @Query('date') date: string,
    @Query('departmentName') departmentName?: string,
    @Query('doctorId') doctorId?: string,
    @Query('groupBy') groupBy?: 'doctor' | 'room',
  ) {
    return this.scheduleService.getDayGrid({ date, departmentName, doctorId, groupBy });
  }

  @Get('heatmap')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '시간대 혼잡 히트맵 (시별 예약 수 + 시간표 슬롯 분모 · 휴진·시간표 없음 구분)' })
  async heatmap(
    @Query('date') date: string,
    @Query('by') by?: string,
    @Query('departmentName') departmentName?: string,
    @Query('doctorId') doctorId?: string,
  ) {
    return this.scheduleService.getHourHeatmap({ date, by, departmentName, doctorId });
  }

  @Post('waitlist')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '대기자 등록' })
  async registerWaitlist(
    @Body() body: RegisterWaitlistDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.scheduleService.registerWaitlist(body, userId) };
  }

  @Get('waitlist')
  @ApiOperation({ summary: '대기자 목록' })
  async getWaitlist(
    @Query('departmentName') departmentName?: string,
    @Query('doctorId') doctorId?: string,
    @Query('status') status?: string,
  ) {
    return this.scheduleService.listWaitlist({ departmentName, doctorId, status });
  }

  @Delete('waitlist/:id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '대기자 취소' })
  async cancelWaitlist(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.scheduleService.cancelWaitlist(id) };
  }

  @Get(':id')
  @ApiOperation({ summary: '예약 상세' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const appointment = await this.scheduleService.findById(id);
    return { data: appointment };
  }

  @Put(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '예약 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser('id') userId: string,
  ) {
    const { appointment, warnings } = await this.scheduleService.update(id, dto, userId);
    return { data: appointment, meta: { warnings } };
  }

  @Patch(':id/status')
  // 🔴 **체크인은 접수원의 핵심 행위다** — 화면 버튼이 있는데 403 이면 접수가 막힌다
  @Roles(UserRole.RECEPTIONIST, UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '예약 상태 변경 (체크인, 완료, 취소)' })
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser('id') userId: string,
  ) {
    const appointment = await this.scheduleService.changeStatus(id, dto, userId);
    return { data: appointment };
  }

  @Post(':id/confirm')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '예약 확정 (SCHEDULED → CONFIRMED)' })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    const { appointment, warnings } = await this.scheduleService.confirm(id, userId);
    return { data: appointment, meta: { warnings } };
  }

  @Post(':id/call-patient')
  @Roles(UserRole.RECEPTIONIST, UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '환자앱 도착 확인 호출 — 곧 도착/지각 예약 환자에게 인앱+푸시 문의(10분 쿨다운)' })
  async callPatient(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.scheduleService.callPatient(id, userId) };
  }

  @Post(':id/no-show')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '노쇼 처리 (SCHEDULED/CONFIRMED → NO_SHOW)' })
  async noShow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    const appointment = await this.scheduleService.noShow(id, userId);
    return { data: appointment };
  }
}
