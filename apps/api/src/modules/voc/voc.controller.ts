import { Controller, Get, Post, Body, Param, Req, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsOptional, IsIn, IsBoolean, IsEmail, IsInt, Min, Max, MaxLength, MinLength } from 'class-validator';
import { PortalOrPatientGuard } from '../patient-auth/guards/portal-or-patient.guard';
import { VocService } from './voc.service';

interface PortalReq { portalPatientId: string }

const TYPES = ['QUESTION', 'COMPLAINT', 'SUGGESTION', 'COMPLIMENT'] as const;
const CHANNELS = ['PORTAL', 'EMAIL', 'SMS'] as const;

class CreateTicketDto {
  @IsOptional() @IsIn(TYPES as unknown as string[]) type?: string;
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @IsString() @MaxLength(60) department?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsIn(CHANNELS as unknown as string[]) replyChannel?: string;
  @IsBoolean() consent!: boolean;
  // 비회원 전용
  @IsOptional() @IsString() @MaxLength(100) submitterName?: string;
  @IsOptional() @IsString() @MaxLength(30) contactPhone?: string;
  @IsOptional() @IsEmail() @MaxLength(120) contactEmail?: string;
}

class MessageDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
}

class RatingDto {
  @IsInt() @Min(1) @Max(5) score!: number;
}

/** 포털(본인확인 후) — patientId는 토큰 sub 주입, 위조 불가 */
@ApiTags('Portal VoC')
@UseGuards(PortalOrPatientGuard)
@Controller('api/v1/portal/voc')
export class PortalVocController {
  constructor(private readonly svc: VocService) {}

  @Post('tickets')
  @ApiOperation({ summary: '고객의 소리 접수(본인확인)' })
  async create(@Req() req: PortalReq, @Body() dto: CreateTicketDto) {
    const t = await this.svc.createTicket({
      type: dto.type as any,
      title: dto.title,
      body: dto.body,
      department: dto.department,
      category: dto.category,
      replyChannel: dto.replyChannel as any,
      consent: dto.consent,
      channel: 'PORTAL',
      patientId: req.portalPatientId,
    });
    return { data: t };
  }

  @Get()
  @ApiOperation({ summary: '나의 문의 목록' })
  async listMine(@Req() req: PortalReq) {
    return { data: await this.svc.listMine(req.portalPatientId) };
  }

  @Get(':id')
  @ApiOperation({ summary: '나의 문의 상세(스레드)' })
  async detail(@Req() req: PortalReq, @Param('id') id: string) {
    return { data: await this.svc.getMine(id, req.portalPatientId) };
  }

  @Post(':id/messages')
  @ApiOperation({ summary: '추가 문의/재질문' })
  async reply(@Req() req: PortalReq, @Param('id') id: string, @Body() dto: MessageDto) {
    return { data: await this.svc.addPatientMessage(id, req.portalPatientId, dto.body) };
  }

  @Post(':id/rating')
  @ApiOperation({ summary: '답변 만족도 평가(1~5)' })
  async rate(@Req() req: PortalReq, @Param('id') id: string, @Body() dto: RatingDto) {
    return { data: await this.svc.rate(id, req.portalPatientId, dto.score) };
  }

  @Post(':id/attachment')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: multer.diskStorage({
      destination: (_q, _f, cb) => { const d = 'uploads/voc'; fs.mkdirSync(d, { recursive: true }); cb(null, d); },
      filename: (_q, file, cb) => cb(null, `v-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_q, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'].includes(file.mimetype)),
  }))
  @ApiOperation({ summary: '첨부 업로드(이미지/PDF, 5MB)' })
  async attach(@Req() req: PortalReq, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('파일이 필요합니다(이미지/PDF, 5MB)');
    return { data: await this.svc.addAttachment(id, req.portalPatientId, `/uploads/voc/${file.filename}`, file.originalname) };
  }
}

/** 공개(비회원) — 본인확인 실패/미로그인 접수. voc.allowAnonymous 게이트 + 연락처 필수 */
@ApiTags('VoC Public')
@Controller('api/v1/voc')
export class VocPublicController {
  constructor(private readonly svc: VocService) {}

  @Post('tickets')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 비회원 접수 스팸 방지 5회/분 (전역 600/분 override)
  @ApiOperation({ summary: '고객의 소리 접수(비회원)' })
  async create(@Body() dto: CreateTicketDto) {
    const t = await this.svc.createTicket({
      type: dto.type as any,
      title: dto.title,
      body: dto.body,
      department: dto.department,
      category: dto.category,
      replyChannel: (dto.replyChannel as any) ?? 'EMAIL',
      consent: dto.consent,
      channel: 'WEB',
      patientId: null,
      submitterName: dto.submitterName,
      contactPhone: dto.contactPhone,
      contactEmail: dto.contactEmail,
    });
    return { data: t };
  }
}
