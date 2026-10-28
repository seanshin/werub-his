import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConsultationService } from './consultation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateConsultationDto, ReplyConsultationDto } from './dto/create-consultation.dto';

@ApiTags('Consultation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/consultations')
export class ConsultationController {
  constructor(private readonly service: ConsultationService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '협진 의뢰' })
  async create(
    @Body() dto: CreateConsultationDto,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
  ) {
    return {
      data: await this.service.create({
        ...dto,
        requestingDoctorId: req.user.id,
      }),
    };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '협진 목록 (수신자·과·상태 필터)' })
  async findAll(
    @Query('limit') limit?: string,
    @Query('toDoctorId') toDoctorId?: string,
    @Query('toDepartment') toDepartment?: string,
    @Query('status') status?: string,
    /** `me` = 로그인한 본인이 의뢰한 것만(보낸 협진 — 2026-10-10) · 다른 값은 받지 않는다(남의 보낸 목록을 이 파라미터로 열지 않게) */
    @Query('requestedBy') requestedBy?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req?: any,
  ) {
    const requestingDoctorId = requestedBy === 'me' ? req?.user?.id : undefined;
    return { data: await this.service.findAll({ limit: limit ? parseInt(limit) : 50, toDoctorId, toDepartment, status, requestingDoctorId }) };
  }

  @Get('inbox')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '내게 온 미처리 협진 (대시보드 인박스)' })
  async findInbox(
    @Query('limit') limit?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req?: any,
  ) {
    return { data: await this.service.findInbox(req.user.id, limit ? parseInt(limit) : 20) };
  }

  @Get('departments')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '협진 수신 과 목록(활성 의사 보유 과)' })
  async getDepartments() {
    return { data: await this.service.getDepartments() };
  }

  @Get('doctors')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '과별 의사 목록(지정의 선택)' })
  async getDoctors(@Query('department') department?: string) {
    return { data: await this.service.getDoctors(department) };
  }

  @Get('patient/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '환자의 협진 전부(모든 진료 · 최근 순 상한 100 + 전체 수)' })
  async findByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    const r = await this.service.findByPatient(patientId);
    return { data: r.items, meta: { total: r.total, truncated: r.truncated } };
  }

  @Get('encounter/:encounterId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '진료별 협진 목록' })
  async findByEncounter(@Param('encounterId') encounterId: string) {
    return { data: await this.service.findByEncounter(encounterId) };
  }

  @Get('pending')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '내 과 대기 협진 목록' })
  async findPending(@Query('department') department: string) {
    return { data: await this.service.findPending(department) };
  }

  @Patch(':id/accept')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '협진 접수(수신자·미지정은 배정)' })
  async accept(
    @Param('id') id: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
  ) {
    return { data: await this.service.accept(id, req.user.id, req.user.role) };
  }

  @Patch(':id/reply')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '협진 회신' })
  async reply(
    @Param('id') id: string,
    @Body() dto: ReplyConsultationDto,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
  ) {
    return {
      data: await this.service.reply(id, {
        ...dto,
        replyDoctorId: req.user.id,
      }, req.user.role),
    };
  }

  @Patch(':id/close')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '협진 종료' })
  async close(
    @Param('id') id: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
  ) {
    return { data: await this.service.close(id, req.user.id, req.user.role) };
  }
}
