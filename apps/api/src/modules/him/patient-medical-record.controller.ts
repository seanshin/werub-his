import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PatientMedicalRecordService } from './patient-medical-record.service';

@ApiTags('의무기록')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients/:patientId/medical-record')
export class PatientMedicalRecordController {
  constructor(private readonly svc: PatientMedicalRecordService) {}

  @Get()
  // 의무기록사(MEDICAL_RECORDS)는 기록 완결·발급의 주 업무자다 — 임상 직군과 함께 연다(쓰기 없음)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: '환자 의무기록 — 기록 완결(미비)·발급 문서·발급 요청·정정 이력(목록 상한 50 · 전체 수 동봉)' })
  async get(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.svc.forPatient(patientId) };
  }

  @Get('versions/:versionId')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: '보존된 서명본 한 판 — 정정 전 내용·지금 내용·바뀐 항목(진료기록·퇴원요약)' })
  async version(@Param('patientId', ParseUUIDPipe) patientId: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return { data: await this.svc.signedVersion(patientId, versionId) };
  }
}
