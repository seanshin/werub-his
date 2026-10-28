import { Req, Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AdmissionService } from './admission.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CreateAdmissionDto, DischargeAdmissionDto, TransferBedDto, UpdateAdmissionDto, TransferCareDto } from './dto/admission.dto';

@ApiTags('Admission')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admissions')
export class AdmissionController {
  constructor(private readonly admissionService: AdmissionService) {}

  @Post('create')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '환자 입원' })
  @ApiResponse({ status: 201, description: '입원 생성 성공' })
  async create(@Body() dto: CreateAdmissionDto) {
    return {
      data: await this.admissionService.create(
        dto.patientId,
        dto.bedId,
        dto.admittingDoctorId,
        dto.admitDate,
        dto.admitReason,
        dto.dietType
      ),
    };
  }

  @Patch(':admissionId/discharge')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '환자 퇴원' })
  @ApiResponse({ status: 200, description: '퇴원 성공' })
  async discharge(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: DischargeAdmissionDto
  ) {
    return {
      data: await this.admissionService.discharge(admissionId, dto.dischargeDate, dto.dischargeSummary),
    };
  }

  @Patch(':admissionId/transfer-care')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '전과 — 담당의(ATTENDING) 변경 기록 (사유 필수·인계노트·ChargeOfCare 이력)' })
  async transferCare(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: TransferCareDto,
    @Req() req: { user?: { id?: string; sub?: string } },
  ) {
    const userId = (req.user?.id ?? req.user?.sub) as string | undefined;
    return { data: await this.admissionService.transferCare(admissionId, dto, userId) };
  }

  @Patch(':admissionId/transfer-bed')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '병상 전동' })
  @ApiResponse({ status: 200, description: '병상 전동 성공' })
  async transferBed(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: TransferBedDto
  ) {
    return {
      data: await this.admissionService.transferBed(admissionId, dto.newBedId, dto.reason),
    };
  }

  @Get(':admissionId')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '입원 상세 조회' })
  @ApiResponse({ status: 200, description: '입원 상세 조회 성공' })
  async getDetail(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.admissionService.getDetail(admissionId) };
  }

  @Get('patient/:patientId/history')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자 입원 이력' })
  @ApiResponse({ status: 200, description: '환자 입원 이력 조회 성공' })
  async getPatientAdmissions(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.admissionService.getPatientAdmissions(patientId) };
  }

  @Get('active/list')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '현재 입원 환자 목록' })
  @ApiResponse({ status: 200, description: '현재 입원 환자 목록 조회 성공' })
  async getActiveAdmissions(
    @Query('wardId') wardId?: string,
    @Query('attendingDoctorId') attendingDoctorId?: string,
  ) {
    // 🔴 주치의 워크스테이션이 `attendingDoctorId` 를 보내는데 서버가 **받지 않아 무시**했다.
    //    그래서 "담당 환자 5명"이 실제로는 **전체 재원 환자**였다(담당의는 5명 제각각·2026-08-12).
    //    재원이 늘면 주치의 화면이 남의 환자로 가득 찬다.
    return { data: await this.admissionService.getActiveAdmissions(wardId, attendingDoctorId) };
  }

  @Patch(':admissionId/update')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '입원 정보 수정' })
  @ApiResponse({ status: 200, description: '입원 정보 수정 성공' })
  async updateAdmission(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: UpdateAdmissionDto
  ) {
    return {
      data: await this.admissionService.updateAdmission(admissionId, dto.dietType, dto.attendingDoctorId),
    };
  }
}
