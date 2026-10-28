import { Controller, Post, Get, Sse, Body, Param, Req, UseGuards, UseInterceptors, UploadedFile, BadRequestException, MessageEvent } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import * as path from 'path';
import { Observable, defer, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, Min, Max, MaxLength } from 'class-validator';
import { PortalOrPatientGuard } from '../patient-auth/guards/portal-or-patient.guard';
import { ConsultService } from './consult.service';
import { ConsultPortalStreamGuard } from './consult-stream.guards';

interface PortalReq { portalPatientId: string }

class OpenDto {
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsIn(['GENERAL', 'INTERNATIONAL', 'CHECKUP', 'BILLING']) category?: string;
}
class MsgDto { @IsString() @MaxLength(2000) content!: string; }
class RateDto { @IsInt() @Min(1) @Max(5) rating!: number; @IsOptional() @IsString() @MaxLength(500) comment?: string; }

@ApiTags('Portal Consult')
@UseGuards(PortalOrPatientGuard)
@Controller('api/v1/portal/consult')
export class ConsultController {
  constructor(private readonly svc: ConsultService) {}

  @Post()
  @ApiOperation({ summary: '상담 세션 열기(언어 선택)' })
  async open(@Req() req: PortalReq, @Body() dto: OpenDto) {
    const s = await this.svc.openSession(req.portalPatientId, dto.locale ?? 'ko', dto.category);
    return { data: { id: s.id, status: s.status, locale: s.locale, serviceOnline: await this.svc.serviceOnline() } };
  }

  @Get(':id/messages')
  @ApiOperation({ summary: '상담 메시지 목록' })
  async messages(@Req() req: PortalReq, @Param('id') id: string) {
    return { data: await this.svc.listMessages(id, req.portalPatientId) };
  }

  @Post(':id/message')
  @ApiOperation({ summary: '환자 메시지 전송(→번역·AI 1차 응답)' })
  async send(@Req() req: PortalReq, @Param('id') id: string, @Body() dto: MsgDto) {
    return { data: await this.svc.patientMessage(id, req.portalPatientId, dto.content) };
  }

  @Post(':id/video')
  @ApiOperation({ summary: '1:1 화상 시작/참가(환자)' })
  async video(@Req() req: PortalReq, @Param('id') id: string) {
    return { data: await this.svc.patientVideo(id, req.portalPatientId) };
  }

  @Get(':id')
  @ApiOperation({ summary: '상담 세션 상태/평가' })
  async info(@Req() req: PortalReq, @Param('id') id: string) {
    return { data: await this.svc.getSessionInfo(id, req.portalPatientId) };
  }

  @Post(':id/rate')
  @ApiOperation({ summary: '만족도 평가' })
  async rate(@Req() req: PortalReq, @Param('id') id: string, @Body() dto: RateDto) {
    return { data: await this.svc.rate(id, req.portalPatientId, dto.rating, dto.comment) };
  }

  @Post(':id/attachment')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: multer.diskStorage({
      destination: 'uploads/consult',
      filename: (_q, file, cb) => cb(null, `c-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_q, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'].includes(file.mimetype)),
  }))
  @ApiOperation({ summary: '첨부 업로드(이미지/PDF)' })
  async attach(@Req() req: PortalReq, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('파일이 필요합니다(이미지/PDF, 5MB)');
    return { data: await this.svc.addAttachment(id, req.portalPatientId, `/uploads/consult/${file.filename}`) };
  }

  @Sse(':id/stream')
  @UseGuards(ConsultPortalStreamGuard)
  @ApiOperation({ summary: '상담 실시간 신호(SSE)' })
  stream(@Req() req: PortalReq, @Param('id') id: string): Observable<MessageEvent> {
    // 구독 전 본인 세션 확인(getSessionInfo→ensure가 소유권 검증)
    return defer(() => from(this.svc.getSessionInfo(id, req.portalPatientId))).pipe(
      switchMap(() => this.svc.getStream(id) as unknown as Observable<MessageEvent>),
    );
  }
}
