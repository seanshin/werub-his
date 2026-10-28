import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RegistrationConsentCollectService } from './registration-consent-collect.service';

export class DispatchRegistrationConsentDto {
  @IsUUID() deviceId!: string;
}

export class RecordPaperRegistrationConsentDto {
  /** 종이에 표시된 항목별 동의 { 유형: boolean } — 값 검증은 서비스(10종 모두 boolean) */
  @IsObject() choices!: Record<string, unknown>;
  @IsString() @MaxLength(100) signedBy!: string;
  @IsOptional() @IsString() @MaxLength(100) guardianName?: string;
  @IsOptional() @IsIn(['PARENT', 'SPOUSE', 'CHILD', 'LEGAL_GUARDIAN']) guardianRelation?: string;
}

export class ApplySignedRegistrationConsentDto {
  @IsUUID() consentId!: string;
}

/** 접수 창구가 쓰는 역할 — 등록 동의 EP(registration-consents)와 같다 + 의사 */
const COLLECT_ROLES = [UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST, UserRole.DOCTOR] as const;

@ApiTags('초진 등록 동의 수집')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...COLLECT_ROLES)
@Controller('api/v1/patients/:patientId/registration-consents/collect')
export class RegistrationConsentCollectController {
  constructor(private readonly svc: RegistrationConsentCollectService) {}

  @Get()
  @ApiOperation({ summary: '초진 동의 현황 — 원장 10종(방식·증빙) + 열린 묶음(스캔본 수)' })
  async status(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.svc.status(patientId) };
  }

  @Get('devices')
  @ApiOperation({ summary: '서명 태블릿(승인된 기기) — 보내기 대상' })
  async devices() {
    return { data: await this.svc.listDevices() };
  }

  @Post('tablet')
  @ApiOperation({ summary: '초진 동의 묶음을 태블릿으로 보내기(서명 세션 5분) — 환자가 항목별로 고르고 서명' })
  async tablet(@Param('patientId', ParseUUIDPipe) patientId: string, @Body() body: DispatchRegistrationConsentDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.dispatchToTablet(patientId, body.deviceId, userId) };
  }

  @Post('mobile-link')
  @ApiOperation({ summary: '환자 휴대폰 전자동의 링크(일회 · 15분 · QR) — 화면이 자기 오리진으로 URL 을 만든다' })
  async mobileLink(@Param('patientId', ParseUUIDPipe) patientId: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.mobileLink(patientId, userId) };
  }

  @Post('paper-scan')
  @ApiOperation({ summary: '종이 동의서 스캔본 등록(jpeg/png/webp/pdf · 10MB) — 서명 URL 로만 열린다' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = join(process.cwd(), 'uploads', 'consent');
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
      cb(ok ? null : new BadRequestException('jpeg/png/webp/pdf 파일만 등록할 수 있습니다'), ok);
    },
  }))
  async paperScan(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) throw new BadRequestException('file 필드에 스캔본을 첨부하세요');
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8'); // multer latin1 → 한글 파일명 복원
    return { data: await this.svc.attachScan(patientId, { url: `/uploads/consent/${file.filename}`, fileName, mimeType: file.mimetype, size: file.size }, userId) };
  }

  @Post('paper')
  @ApiOperation({ summary: '종이 동의서 기록 — 스캔본이 있어야 한다 · 종이에 표시된 항목별 동의를 옮겨 적음(PAPER)' })
  async paper(@Param('patientId', ParseUUIDPipe) patientId: string, @Body() body: RecordPaperRegistrationConsentDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.recordPaper(patientId, body, userId) };
  }

  @Post('apply-signed')
  @ApiOperation({ summary: '서명됐지만 원장에 없는 묶음을 서명본의 선택대로 원장에 기록(서명 시각·방식 그대로) — 서명 뒤 바뀐 기록이 있으면 거부' })
  async applySigned(@Param('patientId', ParseUUIDPipe) patientId: string, @Body() body: ApplySignedRegistrationConsentDto) {
    return { data: await this.svc.applySigned(patientId, body.consentId) };
  }
}

/**
 * 재수집 목록(병원 전체) — 서명은 됐는데 원장 10종이 비어 있는 환자(2026-10-03).
 * 접수 워크스테이션이 부른다. 환자 지목 조회가 아니라 목록이라 열람 감사는 환자를 열 때 남는다.
 */
@ApiTags('초진 등록 동의 수집')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...COLLECT_ROLES)
@Controller('api/v1/registration-consents/unapplied-signatures')
export class RegistrationConsentUnappliedController {
  constructor(private readonly svc: RegistrationConsentCollectService) {}

  @Get()
  @ApiOperation({ summary: '서명됐지만 원장에 없는 초진 동의 묶음 — 서명본대로 기록 가능(APPLY)·다시 받기(RECOLLECT · 사유)' })
  async list() {
    return { data: await this.svc.unappliedSignatures() };
  }
}
