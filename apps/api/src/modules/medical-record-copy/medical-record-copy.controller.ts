import { Controller, Get, Post, Param, Body, Res, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { MedicalRecordCopyService } from './medical-record-copy.service';
import { PdfGenerationService } from './pdf-generation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateMedicalRecordCopyDto, GeneratePdfDto } from './dto/medical-record-copy.dto';

@ApiTags('Medical Record Copy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class MedicalRecordCopyController {
  constructor(
    private readonly service: MedicalRecordCopyService,
    private readonly pdfService: PdfGenerationService,
  ) {}

  @Post('medical-records/generate-pdf')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: '의무기록 PDF 생성 (HTML 반환)' })
  async generatePdf(@Body() body: GeneratePdfDto, @Res() res: Response) {
    const html = await this.service.generatePdf(body.recordType, body.recordId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Post('medical-records/download-pdf')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: '의무기록 PDF 다운로드 (실제 PDF Buffer)' })
  async downloadPdf(@Body() body: GeneratePdfDto, @Res() res: Response) {
    const buffer = await this.pdfService.getEncounterPdfBuffer(body.recordId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="medical-record-${body.recordId}.pdf"`);
    res.send(buffer);
  }

  @Post('medical-record-copies')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: '사본발급 이력 생성' })
  async createCopy(@Body() dto: CreateMedicalRecordCopyDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createCopy(dto, userId) };
  }

  @Get('patients/:patientId/record-copies')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: '환자 사본발급 이력' })
  async findByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.findByPatient(patientId) };
  }
}

/**
 * 🔴 (2026-10-13 결함 발굴 B8) 공개 `GET /api/v1/verify/record-copy/:copyId` 제거 — 토큰을 받지도 대조하지도 않고
 *    번호만 있으면 `valid:true` 였다. 그런데 이 원장(medicalRecordCopy)은 **문서를 만들지 않는 이력 기록**이다(B6) —
 *    없는 문서를 진짜라고 보증하는 공개 표면이었다. QR 토큰 생성기도 부르는 곳이 0 이었다.
 *    문서 진위확인 정본은 `GET /api/v1/documents/verify/:issueNo`(발급 원장) 하나.
 */
