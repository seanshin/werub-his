import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ClinicScheduleService } from './clinic-schedule.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateClinicScheduleDto, UpdateClinicScheduleDto, CreateClinicClosureDto } from './dto/clinic-schedule.dto';

@ApiTags('Clinic Schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ClinicScheduleController {
  constructor(private readonly service: ClinicScheduleService) {}

  // --- Schedule ---

  @Get('api/v1/clinic-schedule')
  @ApiOperation({ summary: '전체 진료표 조회' })
  async findAll() {
    return { data: await this.service.findAll() };
  }

  @Get('api/v1/clinic-schedule/today')
  @ApiOperation({ summary: '오늘 진료 가능 의사 (진료과별)' })
  async findToday(@Query('department') department?: string) {
    return { data: await this.service.findToday(department) };
  }

  @Get('api/v1/clinic-schedule/week')
  @ApiOperation({ summary: '주간 진료표' })
  async findWeek() {
    return { data: await this.service.findWeek() };
  }

  @Post('api/v1/clinic-schedule')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '진료표 등록' })
  async create(
    @Body() body: CreateClinicScheduleDto,
  ) {
    return { data: await this.service.create(body) };
  }

  @Put('api/v1/clinic-schedule/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '진료표 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateClinicScheduleDto,
  ) {
    return { data: await this.service.update(id, body) };
  }

  @Delete('api/v1/clinic-schedule/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '진료표 삭제' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.delete(id) };
  }

  // --- Closure ---

  @Get('api/v1/clinic-closure')
  @ApiOperation({ summary: '휴진 목록' })
  async findClosures(@Query('date') date?: string) {
    return { data: await this.service.findClosures(date) };
  }

  @Get('api/v1/clinic-closure/affected/:date')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '특정일 휴진이 닿는 기존 예약(연락 필요 목록) — 자동 취소·발송 없음 · 판정 불가는 needsReview' })
  async findClosureAffected(@Param('date') date: string) {
    return { data: await this.service.findClosureAffected(date) };
  }

  @Post('api/v1/clinic-closure')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '휴진 등록' })
  async createClosure(
    @Body() body: CreateClinicClosureDto,
  ) {
    return { data: await this.service.createClosure(body) };
  }

  @Delete('api/v1/clinic-closure/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '휴진 취소' })
  async deleteClosure(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteClosure(id) };
  }
}
