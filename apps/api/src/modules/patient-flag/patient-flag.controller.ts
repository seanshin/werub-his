import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PatientFlagService } from './patient-flag.service';
import { CreatePatientFlagDto } from './dto/patient-flag.dto';

const CLINICAL = [UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST, UserRole.LAB_TECH];

// 환자 마킹('루비'=악성·VIP·직원지인) — 내부 직원
@ApiTags('Patient Flag (루비)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patient-flags')
export class PatientFlagController {
  constructor(private readonly svc: PatientFlagService) {}

  @Get('list')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '마킹 환자 목록(관리)' })
  async list(@Query('type') type?: string) { return { data: await this.svc.list(type) }; }

  @Get('summary')
  @Roles(...CLINICAL)
  @ApiOperation({ summary: '여러 환자 마킹 요약(목록 배지)' })
  async summary(@Query('ids') ids?: string) {
    return { data: await this.svc.summaryFor((ids ?? '').split(',').map((s) => s.trim()).filter(Boolean)) };
  }

  @Get(':patientId')
  @Roles(...CLINICAL)
  @ApiOperation({ summary: '환자 마킹 요약(루비 카운트/VIP/지인)' })
  async getForPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.svc.getForPatient(patientId) };
  }

  @Get(':patientId/mine')
  @Roles(...CLINICAL)
  @ApiOperation({ summary: '내가 남긴 마킹(토글용)' })
  async mine(@Param('patientId', ParseUUIDPipe) patientId: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.myFlags(patientId, userId) };
  }

  @Post()
  @Roles(...CLINICAL)
  @ApiOperation({ summary: '환자 마킹 (악성은 누구나, VIP/지인은 발견 시)' })
  async flag(@Body() body: CreatePatientFlagDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.flag({ ...body, flaggedBy: userId }) };
  }

  @Delete(':patientId/:flagType')
  @Roles(...CLINICAL)
  @ApiOperation({ summary: '내 마킹 해제' })
  async unflag(@Param('patientId', ParseUUIDPipe) patientId: string, @Param('flagType') flagType: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.unflag(patientId, flagType, userId) };
  }

  @Delete('id/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '마킹 삭제(관리자)' })
  async removeById(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.svc.removeById(id) }; }
}
