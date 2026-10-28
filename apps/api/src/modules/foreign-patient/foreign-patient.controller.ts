import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe, ParseIntPipe, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ForeignPatientService, ForeignPatientDto, EmergencyUnknownDto } from './foreign-patient.service';
import { IdentifyPatientDto } from './dto/identify.dto';
import { ArrivalNoteDto } from './dto/arrival-note.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Foreign Patient (외국인/해외 환자)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients')
export class ForeignPatientController {
  constructor(private readonly foreignPatientService: ForeignPatientService) {}

  @Post('foreign')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '외국인 환자 등록 (관광/거주/재외동포/원격)' })
  async registerForeign(
    @Body() dto: ForeignPatientDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.foreignPatientService.registerForeign(dto, userId) };
  }

  @Post('emergency-unknown')
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '응급 미확인 환자 등록 (임시ID 자동 부여)' })
  async registerEmergencyUnknown(
    @Body() dto: EmergencyUnknownDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.foreignPatientService.registerEmergencyUnknown(dto, userId) };
  }

  // ── 응급 도착 상황 기록(첫 기록 + 추가 기록 · 고치지 않고 덧붙인다) ──
  @Get(':id/arrival-notes')
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '응급 도착 상황 기록 목록(첫 기록·추가 기록)' })
  async listArrivalNotes(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.foreignPatientService.listArrivalNotes(id) };
  }

  @Post(':id/arrival-notes')
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '응급 도착 상황 추가 기록(덧붙임)' })
  async addArrivalNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArrivalNoteDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.foreignPatientService.addArrivalNote(id, dto, userId) };
  }

  // ── 외국인 등록 목록 관리 ──
  // 경로는 'foreign/list' 2세그먼트 — PatientController의 ':id' 단일 세그먼트 라우트와 충돌 방지

  @Get('foreign/list')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '외국인 환자 등록 목록 (검색·유형 필터·보관 포함 옵션)' })
  async listForeign(
    @Query('search') search?: string,
    @Query('patientType') patientType?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return { data: await this.foreignPatientService.listForeign({ search, patientType, includeArchived: includeArchived === 'true' }) };
  }

  @Patch('foreign/:id')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '외국인 환자 정보 수정 (여권/외등번호 중복 재검증)' })
  async updateForeign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, unknown>,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.foreignPatientService.updateForeign(id, dto as never, userId) };
  }

  @Patch('foreign/:id/archive')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '외국인 환자 보관 (목록에서 숨김 — 복원 가능)' })
  async archiveForeign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.foreignPatientService.archiveForeign(id, userId) };
  }

  @Patch('foreign/:id/restore')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '보관 해제(복원)' })
  async restoreForeign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.foreignPatientService.restoreForeign(id, userId) };
  }

  @Post('foreign/:id/attachments')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '환자 서류 첨부 업로드(여권 사본·보험증권 등 — jpeg/png/webp/pdf·10MB)' })
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = join(process.cwd(), 'uploads', 'patient-docs');
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
      cb(ok ? null : new BadRequestException('jpeg/png/webp/pdf 파일만 첨부할 수 있습니다'), ok);
    },
  }))
  async addAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) throw new BadRequestException('file 필드에 파일을 첨부하세요');
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8'); // multer latin1 → 한글 복원
    return {
      data: await this.foreignPatientService.addAttachment(id, {
        url: `/uploads/patient-docs/${file.filename}`,
        fileName, mimeType: file.mimetype, size: file.size,
      }, userId),
    };
  }

  @Delete('foreign/:id/attachments/:index')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '환자 서류 첨부 삭제(인덱스)' })
  async removeAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.foreignPatientService.removeAttachment(id, index, userId) };
  }

  @Delete('foreign/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '외국인 환자 삭제 — 임상기록(진료/예약/수납/동의서) 전무한 등록 오류 건만 허용' })
  async deleteForeign(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.foreignPatientService.deleteForeign(id) };
  }

  @Patch(':id/identify')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '미확인 환자 신원 확인 (임시 → 정식)' })
  async identifyPatient(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IdentifyPatientDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.foreignPatientService.identifyPatient(id, dto, userId) };
  }

  @Get(':id/passport')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '여권 정보 조회 (권한 제한)' })
  async getPassportInfo(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.foreignPatientService.getPassportInfo(id) };
  }

  @Get(':id/certificate-en')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '영문 진단서 (Medical Certificate in English)' })
  async getCertificateEn(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.foreignPatientService.generateEnglishCertificate(id) };
  }
}
