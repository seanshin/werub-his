import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe, ParseIntPipe, Res, Sse, MessageEvent, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { Observable } from 'rxjs';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConsentService } from './consent.service';
import { CreateConsentDto, CreatePatientConsentDto, SignConsentDto, RevokeConsentDto } from './dto/consent.dto';
import { PdfGenerationService } from '../medical-record-copy/pdf-generation.service';
import { CreateConsentSignSessionDto } from './dto/consent-body.dto';

@ApiTags('Consent (동의서)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/consent')
export class ConsentController {
  constructor(
    private readonly service: ConsentService,
    private readonly pdfService: PdfGenerationService,
  ) {}

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 전체 목록' })
  async findAll(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('patientId') patientId?: string,
  ) { return { data: await this.service.findAll({ status, type, patientId }) }; }

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 생성(요청)' })
  async create(@Body() dto: CreateConsentDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.create({ ...dto, requestedBy: userId } as any) };
  }

  @Post('ai-generate')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 동의서 내용 생성(위험·대안·설명)' })
  async aiGenerate(@Body() body: { consentType?: string; procedureName: string; patientId?: string }, @CurrentUser('id') userId: string) {
    // 🔴 초안 생성자는 제안 원장(`AiProposal.createdBy`)의 주체다 — 익명 초안을 만들지 않는다
    return { data: await this.service.aiGenerate(body, userId) };
  }

  // ── 동의서 워크스테이션 ──

  @Get('workstation/queue')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 워크스테이션 큐' })
  async workstationQueue(@Query('status') status?: string, @Query('consentType') consentType?: string) {
    return { data: await this.service.getWorkstationQueue({ status, consentType }) };
  }

  @Get('workstation/stats')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 워크스테이션 통계' })
  async workstationStats() {
    return { data: await this.service.getWorkstationStats() };
  }

  @Sse('workstation/stream')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 워크스테이션 실시간 스트림 (SSE)' })
  workstationStream(): Observable<MessageEvent> {
    return this.service.getWorkstationStream() as unknown as Observable<MessageEvent>;
  }

  @Post(':id/sign-session')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '태블릿/PC 대면 서명 세션 생성' })
  async createSignSession(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateConsentSignSessionDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createSignSession(id, userId, body) };
  }

  @Post('sign-session/:token/cancel')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '서명 세션 취소' })
  async cancelSignSession(@Param('token') token: string) {
    return { data: await this.service.cancelSignSession(token) };
  }

  /**
   * 수술 전 필수 동의서(수술·마취·수혈) 상태 — 수술 준비 워크스테이션이 상수 "확인 필요"를 그리던 자리.
   * 🔴 `:id` 보다 **앞에** 둔다(경로 충돌 — 뒤에 두면 'surgery-status' 가 UUID 파이프에 걸린다).
   */
  @Get('surgery-status')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '수술 전 필수 동의서 상태 (surgeryId 연결 우선 · 없으면 같은 환자·종류·최근 N일)' })
  async surgeryStatus(
    @Query('patientId', ParseUUIDPipe) patientId: string,
    @Query('surgeryId', new ParseUUIDPipe({ optional: true })) surgeryId?: string,
    @Query('windowDays', new ParseIntPipe({ optional: true })) windowDays?: number,
  ) {
    return { data: await this.service.getSurgeryConsentStatus({ patientId, surgeryId, windowDays }) };
  }

  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 상세' })
  async findById(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.service.findById(id) }; }

  @Patch(':id/sign')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 서명' })
  async sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignConsentDto,
    @CurrentUser('id') userId: string,
  ) { return { data: await this.service.sign(id, dto, { userId }) }; }

  @Get('patient/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 동의서 목록' })
  async getByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) { return { data: await this.service.getByPatient(patientId) }; }

  @Patch(':id/doctor-sign')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '의사 서명 (의사 본인 인증 필수)' })
  async doctorSign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') doctorId: string) {
    // 서명자는 로그인한 의사 본인 — body 신뢰하지 않음(의료법 §24-2 설명 의사 본인 서명)
    return { data: await this.service.doctorSign(id, doctorId) };
  }

  @Patch(':id/witness-sign')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '증인 서명 (로그인 본인)' })
  async witnessSign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') witnessId: string) {
    return { data: await this.service.witnessSign(id, witnessId) };
  }

  @Patch(':id/nurse-check')
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '간호사 사전 확인 (의료진 사전 체크)' })
  async nurseCheck(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') nurseId: string) {
    return { data: await this.service.nurseCheck(id, nurseId) };
  }

  @Get(':id/blockchain-log')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 블록체인 서명 기록' })
  async blockchainLog(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getConsentBlockchainLog(id) };
  }

  @Get(':id/signature-status')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '서명 현황 조회' })
  async signatureStatus(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getSignatureStatus(id) };
  }

  @Post(':id/resend-notification')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '서명 요청 알림 재전송' })
  async resendNotification(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.resendNotification(id) };
  }

  @Patch(':id/revoke')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 철회' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeConsentDto,
  ) { return { data: await this.service.revoke(id, dto?.reason) }; }

  @Get(':id/generate-pdf')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 PDF 생성 (HTML 반환)' })
  async generatePdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const html = await this.pdfService.generateConsentFormPdf(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  // ── 첨부파일 — 인쇄 시 별첨(설명자료·스캔본 등) ──

  @Post(':id/attachments')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 첨부파일 업로드 (jpeg/png/webp/pdf·10MB) — 인쇄 시 별첨 표시' })
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
      cb(ok ? null : new BadRequestException('jpeg/png/webp/pdf 파일만 첨부할 수 있습니다'), ok);
    },
  }))
  async addAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) throw new BadRequestException('file 필드에 파일을 첨부하세요');
    // multer는 originalname을 latin1로 파싱 — 한글 파일명 복원
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return {
      data: await this.service.addAttachment(id, {
        url: `/uploads/consent/${file.filename}`,
        fileName, mimeType: file.mimetype, size: file.size,
      }, userId),
    };
  }

  @Delete(':id/attachments/:index')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 첨부파일 삭제 (배열 인덱스)' })
  async removeAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return { data: await this.service.removeAttachment(id, index) };
  }

  @Post(':id/translate')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 다국어 번역 — 🔴 미구현(501). 템플릿 언어판을 사용한다' })
  async translate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { targetLanguage: string },
  ) {
    return { data: await this.service.translateConsent(id, body.targetLanguage) };
  }
}

// 설계서 패턴: /api/v1/patients/:patientId/consents
@ApiTags('Consent (동의서)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients/:patientId/consents')
export class PatientConsentController {
  constructor(
    private readonly service: ConsentService,
    private readonly pdfService: PdfGenerationService,
  ) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) // 간호·원무 접수단계 발급(서명은 별도 단계)
  @ApiOperation({ summary: '환자 동의서 생성' })
  async create(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreatePatientConsentDto,
  ) {
    return { data: await this.service.create({ ...dto, patientId } as any) };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 동의서 목록' })
  async getByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getByPatient(patientId) };
  }

  @Get(':consentId/generate-pdf')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 동의서 PDF 생성 (HTML 반환)' })
  async generatePdf(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('consentId', ParseUUIDPipe) consentId: string,
    @Res() res: Response,
  ) {
    const html = await this.pdfService.generateConsentFormPdf(consentId, patientId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}
