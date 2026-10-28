import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { localDateKey } from '../../common/day-range';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TherapyOrderService } from './therapy-order.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateTherapyOrderDto, UpdateTherapyOrderDto, CompleteTherapyOrderDto } from './dto/therapy-order.dto';

@ApiTags('Therapy Order')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) // 기본 가드(조회·수행) — 미지정 핸들러 무가드화 방지. 생성/수정은 메서드에서 DOCTOR/ADMIN로 강화
@Controller('api/v1/therapy-orders')
export class TherapyOrderController {
  constructor(private readonly service: TherapyOrderService) {}

  @Post()
  // 간호사·치료사도 — 단 본인이 입력한(의사 승인을 거친) 치료 처방의 오더에만(서비스가 강제)
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE, UserRole.LAB_TECH)
  @ApiOperation({ summary: '치료 오더 생성 (+ 반복 일정 자동 생성)' })
  async create(@Body() dto: CreateTherapyOrderDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.create(dto, userId) };
  }

  @Get('schedule')
  // 🔴 방사선치료사(운영 실측: tx.radiation=LAB_TECH)가 /workstation/therapy 를 열면
  //    스케줄 조회가 클래스 @Roles(LAB_TECH 없음)에 걸려 상시 403 이었다. 워크리스트 조회만 연다.
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '일자별 치료 일정 조회' })
  async getSchedule(
    @Query('date') date: string,
    @Query('stationId') stationId?: string,
    @Query('therapistId') therapistId?: string,
  ) {
    return { data: await this.service.findByDate(date || localDateKey(new Date()), stationId, therapistId) };
  }

  @Get('stats')
  @ApiOperation({ summary: '일자별 치료 통계' })
  async getStats(@Query('date') date?: string) {
    return { data: await this.service.getStats(date || localDateKey(new Date())) };
  }

  @Get('patient/:patientId')
  @ApiOperation({ summary: '환자별 치료 오더 이력 (차트 치료 이력 탭)' })
  async findByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.findByPatient(patientId) };
  }

  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '치료 오더 상세' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.findById(id) };
  }

  @Patch(':id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '치료 오더 수정 (일정/치료사 변경)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTherapyOrderDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Patch(':id/start')
  // 🔴 (2026-09-29) 워크리스트는 LAB_TECH(치료사)에 열었는데 시작·완료는 클래스 @Roles 라 치료사에게 상시 403 이었다.
  //    LAB_TECH 는 임상병리사와 공유 — 치료 직종인지는 서비스(assertTherapyExecutor)가 가른다.
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '치료 시작' })
  async start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.start(id, userId) };
  }

  @Patch(':id/complete')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '치료 완료 (결과 기록)' })
  async complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteTherapyOrderDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.complete(id, dto, userId) };
  }
}
