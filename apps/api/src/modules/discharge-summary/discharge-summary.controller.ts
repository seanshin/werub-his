import {
  Controller, Get, Post, Put, Patch, Param, Body,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DischargeSummaryService } from './discharge-summary.service';
import { DiagnosisPoaService } from './diagnosis-poa.service';
import { SetPoaDto } from './dto/set-poa.dto';
import { CreateDischargeSummaryDto, UpdateDischargeSummaryDto } from './dto/create-discharge-summary.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Discharge Summary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admissions/:admissionId/discharge-summary')
export class DischargeSummaryController {
  constructor(private readonly service: DischargeSummaryService, private readonly poa: DiagnosisPoaService) {}

  /** 입원 기간 진단별 POA(입원 시 존재) — 필수 여부는 결정 safety.poaFlag(설정 safety.poa.required) */
  @Get('poa')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.MEDICAL_RECORDS, UserRole.ADMIN)
  @ApiOperation({ summary: '입원 기간 진단별 POA · 필수 여부 · 빈 진단' })
  async listPoa(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.poa.list(admissionId) };
  }

  @Put('poa')
  @Roles(UserRole.DOCTOR, UserRole.MEDICAL_RECORDS, UserRole.ADMIN)
  @ApiOperation({ summary: '진단 하나의 POA 기록(Y 입원 시 있었음 · N 입원 후 발생 · U 판단 불가)' })
  async setPoa(@Param('admissionId', ParseUUIDPipe) admissionId: string, @Body() dto: SetPoaDto, @CurrentUser('id') userId: string) {
    return { data: await this.poa.set(admissionId, dto.diagnosisCode, dto.poa, userId) };
  }

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '퇴원요약 작성' })
  async create(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: CreateDischargeSummaryDto,
    @CurrentUser('id') doctorId: string,
  ) {
    const summary = await this.service.create(admissionId, dto, doctorId);
    return { data: summary };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '퇴원요약 조회' })
  async findByAdmission(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    const summary = await this.service.findByAdmission(admissionId);
    return { data: summary };
  }

  @Put()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '퇴원요약 수정' })
  async update(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: UpdateDischargeSummaryDto,
    @CurrentUser('id') userId: string,
  ) {
    const summary = await this.service.update(admissionId, dto, userId);
    return { data: summary };
  }

  @Patch('sign')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '퇴원요약 서명' })
  async sign(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser('id') doctorId: string,
    @Body() body?: {
      blockchainSignature?: {
        certificateId: string;
        signatureValue: string;
        signatureAlgorithm: string;
        documentHash: string;
      };
    },
  ) {
    const summary = await this.service.sign(admissionId, doctorId, body?.blockchainSignature);
    return { data: summary };
  }

  @Get('prefill')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '퇴원요약 자동 프리필 데이터' })
  async prefill(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    const data = await this.service.prefill(admissionId);
    return { data };
  }
}
