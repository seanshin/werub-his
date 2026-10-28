import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { OphthalmologyService } from './ophthalmology.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateOphthalmologyExamDto, CreateOphthalmologySurgeryDto,
  PrescribeGlassesDto, PrescribeContactsDto, CreatePrescriptionDto,
  UploadFundusPhotoDto,
} from './dto/ophthalmology.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('Ophthalmology (안과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/ophthalmology')
export class OphthalmologyController {
  constructor(private readonly service: OphthalmologyService) {}

  @Get('patients')
  @ApiOperation({ summary: '안과 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  @Post('exam')
  @ApiOperation({ summary: '안과 검사 기록' })
  async createExam(
    @Body() body: CreateOphthalmologyExamDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createExam({ ...body, examinedBy: userId }) };
  }

  @Get('exam/:patientId')
  @ApiOperation({ summary: '검사 이력' })
  async getExams(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getExams(patientId) };
  }

  @Get('exam/:id/detail')
  @ApiOperation({ summary: '검사 상세' })
  async getExamDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getExamDetail(id) };
  }

  @Post('surgery')
  @ApiOperation({ summary: '안과 수술 기록' })
  async createSurgery(
    @Body() body: CreateOphthalmologySurgeryDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createSurgery({ ...body, operatedBy: userId }) };
  }

  @Get('surgery/:patientId')
  @ApiOperation({ summary: '수술 이력' })
  async getSurgeries(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getSurgeries(patientId) };
  }

  @Post('prescription/glasses')
  @ApiOperation({ summary: '안경 처방전' })
  async prescribeGlasses(@Body() body: PrescribeGlassesDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.prescribeGlasses({ ...body, prescribedBy: userId }) };
  }

  @Post('prescription/contacts')
  @ApiOperation({ summary: '콘택트렌즈 처방' })
  async prescribeContacts(@Body() body: PrescribeContactsDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.prescribeContacts({ ...body, prescribedBy: userId }) };
  }

  @Post('prescriptions')
  @ApiOperation({ summary: '안경/콘택트 처방전 생성' })
  async createPrescription(
    @Body() body: CreatePrescriptionDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createPrescription({ ...body, prescribedBy: userId }) };
  }

  @Get('prescriptions/:patientId')
  @ApiOperation({ summary: '처방전 이력' })
  async getPrescriptions(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPrescriptions(patientId) };
  }

  @Get('iop-trend/:patientId')
  @ApiOperation({ summary: '안압 추이' })
  async getIopTrend(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getIopTrend(patientId) };
  }

  @Get('today')
  @ApiOperation({ summary: '오늘 안과 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Get('stats')
  @ApiOperation({ summary: '안과 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  /* ───── Fundus Photo Viewer (Phase 2) ───── */

  @Post('fundus-photos')
  @ApiOperation({ summary: '안저 사진 업로드' })
  async uploadFundusPhoto(@Body() body: UploadFundusPhotoDto) {
    return { data: await this.service.uploadFundusPhoto(body.examId, body) };
  }

  @Get('fundus-photos/:patientId')
  @ApiOperation({ summary: '환자 안저 사진 목록' })
  async getFundusPhotos(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getFundusPhotos(patientId) };
  }

  @Get('fundus-photos/compare')
  @ApiOperation({ summary: '안저 사진 비교' })
  async compareFundusPhotos(
    @Query('photoId1') photoId1: string,
    @Query('photoId2') photoId2: string,
  ) {
    return { data: await this.service.compareFundusPhotos(photoId1, photoId2) };
  }
}
