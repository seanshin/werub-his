import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { ApiConsumes } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { safeUploadSegment } from '../../common/util/upload-url';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OpeningService } from './opening.service';
import { EvidenceExtractService } from '../evidence/evidence-extract.service';
import { PHASE_ORDER } from './opening.registry';

/**
 * 🔴 업로드 허용 형식 — **저장형 XSS 전례**가 있다(media fileFilter 부재 → SVG/HTML).
 *    SVG 는 스크립트를 품을 수 있으므로 넣지 않는다.
 */
const EVIDENCE_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** 🔴 클래스 DTO 로 둔다 — 인라인 `@Body()` 는 ValidationPipe 를 통째로 스킵한다 */
class RecordTaskDto {
  @IsIn(['RECORDED', 'NOT_APPLICABLE']) state!: string;
  @IsOptional() @IsString() @MaxLength(200) evidenceRef?: string;
  @IsOptional() @IsString() @MaxLength(10) evidenceDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

/**
 * 기관이 추가하는 항목 (P3).
 *
 * 🔴 **연결 키(goLiveKey·decisionKey·committeeCode)를 받지 않는다.** 받는 순간 기관이
 *    남의 상태를 자기 상태인 척할 수 있다 — 파생은 코드 정본만 한다.
 * 🔴 전역 `whitelist:true` 가 DTO 에 없는 키를 **조용히 지운다**. 그래서 여기 없는 것은
 *    "무시된다"가 아니라 "닿지 않는다" — 위 규칙이 실제로 강제된다.
 */
class CustomTaskDto {
  @IsIn(PHASE_ORDER) phase!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(100) owner!: string;
  /** 🔴 비울 수 없다 — 비면 "모든 나라"인지 "아직 안 정했는지" 구분되지 않는다 */
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) countries!: string[];
  @IsIn(['BEFORE_OPENING', 'AT_OPENING', 'AFTER_OPENING', 'RECURRING']) dueBy!: string;
  @IsOptional() @IsString() @MaxLength(200) authority?: string;
  @IsOptional() @IsString() @MaxLength(20) cycle?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) dependsOn?: string[];
}

/** 항목 내리기/올리기 — 🔴 내릴 때 사유는 서비스가 강제한다(여기서는 형식만 본다) */
class CustomTaskActiveDto {
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

@ApiTags('opening')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/opening')
export class OpeningController {
  constructor(
    private svc: OpeningService,
    private evidence: EvidenceExtractService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '개원·운영 단계 흐름(개원 전·개원·개원 후) — 상태는 기존 정본에서 파생' })
  async overview(@Query('country') country?: string) {
    // 🔴 나라를 지정하지 않으면 기관 설정(`hospital.country`)을 본다 — 응답이 어느 쪽인지 밝힌다
    return { data: await this.svc.overview(country) };
  }

  @Post('tasks/:key/record')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '개원 항목 사람 기록(완료·해당없음) — 파생 항목에는 쓸 수 없다' })
  async record(@Param('key') key: string, @Body() dto: RecordTaskDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.record(key, dto, userId) };
  }

  @Delete('tasks/:key/record')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '개원 항목 기록 철회 — 지우는 것이 "완료 아님"이다' })
  async clearRecord(@Param('key') key: string) {
    return { data: await this.svc.clearRecord(key) };
  }

  @Get('committee-cycle')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '위원회 주기 준수 — 이번 주기에 회의 기록이 있는가(미개최 아님)' })
  async committeeCycle() {
    return { data: await this.svc.committeeCycleCompliance() };
  }

  /**
   * 증빙 첨부.
   *
   * 🔴 종전 주석: "`key` 는 레지스트리에 있는 값만 통과하므로(서비스가 검증) 경로 조작 여지가 없다."
   *    **틀렸다** — 그 검증은 핸들러(`svc.addAttachment`)에서 일어나고, multer 의 destination 콜백은
   *    그보다 먼저 돈다. 즉 레지스트리에 없는 키로도 **파일은 이미 디스크에 쓰인 뒤**다(G4).
   *    경로 안전은 destination 이 스스로 지킨다(`safeUploadSegment`).
   *    파일명은 uuid 로 새로 만들고, 원본 확장자만 붙인다.
   */
  @Post('tasks/:key/attachments')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '개원 항목 증빙 첨부(pdf/jpeg/png/webp · 10MB)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (req, _f, cb) => {
        // 🔴 `..` 가 정제를 통과해 저장 경로가 한 단계 위(uploads/)로 새던 자리 — G4
        const safe = safeUploadSegment((req.params as Record<string, string> | undefined)?.key);
        if (!safe) return cb(new BadRequestException('항목 키가 올바르지 않습니다'), '');
        const dir = join(process.cwd(), 'uploads', 'opening', safe);
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_r, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_r, file, cb) => {
      const ok = EVIDENCE_MIME.includes(file.mimetype);
      cb(ok ? null : new BadRequestException('pdf/jpeg/png/webp 파일만 첨부할 수 있습니다'), ok);
    },
  }))
  async addAttachment(
    @Param('key') key: string,
    @UploadedFile() file: { filename: string; originalname: string; mimetype: string; size: number } | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) throw new BadRequestException('파일이 필요합니다');
    return {
      data: await this.svc.addAttachment(
        key,
        { filename: file.filename, originalName: file.originalname, mimetype: file.mimetype, size: file.size },
        userId,
      ),
    };
  }

  @Delete('tasks/:key/attachments/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '증빙 첨부 제거(목록에서 뺀다 — 파일을 지웠다고 말하지 않는다)' })
  async removeAttachment(@Param('key') key: string, @Param('id') id: string) {
    return { data: await this.svc.removeAttachment(key, id) };
  }

  /**
   * 🔴 증빙 **판독 초안** — 저장하지 않는다. 화면이 사람에게 보여주고, 사람이 고쳐서 저장한다.
   *    권한 검사(`@Roles`)가 AI 호출 **앞**에 있다(§임상UX 규약).
   */
  @Post('tasks/:key/attachments/:id/extract')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '증빙 AI 판독(초안 — 저장하지 않는다)' })
  async extract(@Param('key') key: string, @Param('id') id: string) {
    // 🔴 기관 항목도 제목을 찾는다 — 레지스트리만 보면 기관 항목이 늘 '행정 증빙 문서'가 된다
    const title = await this.svc.taskTitle(key);
    const { path, fileName } = await this.svc.attachmentPath(key, id);
    return { data: await this.evidence.extract(path, fileName, title ?? '행정 증빙 문서') };
  }

  /**
   * 🔴 **기관 항목 추가** — 레지스트리가 "전수가 아니다"라고 말하면서 정하는 통로는
   *    주지 않던 자리다(개원 직후 O9 는 기본 목록이 아예 비어 있다).
   */
  @Post('custom-tasks')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기관 항목 추가 — 기본 목록에 없는 것을 기관이 등재한다(연결 키는 받지 않는다)' })
  async createCustom(@Body() dto: CustomTaskDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createCustomTask(dto, userId) };
  }

  @Patch('custom-tasks/:key')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기관 항목 수정 — 기본 목록의 항목에는 쓸 수 없다' })
  async updateCustom(@Param('key') key: string, @Body() dto: CustomTaskDto) {
    return { data: await this.svc.updateCustomTask(key, dto) };
  }

  @Patch('custom-tasks/:key/active')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기관 항목 내리기/올리기 — 삭제가 아니다(기록·증빙이 붙어 있을 수 있다)' })
  async setCustomActive(@Param('key') key: string, @Body() dto: CustomTaskActiveDto) {
    return { data: await this.svc.setCustomTaskActive(key, dto.isActive, dto.reason) };
  }

  @Delete('custom-tasks/:key')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기관 항목 삭제 — 🔴 기록이 하나도 없을 때만(오타 회수용)' })
  async deleteCustom(@Param('key') key: string) {
    return { data: await this.svc.deleteCustomTask(key) };
  }

  @Get('link-health')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '레지스트리 연결 키 실재 확인(고아 링크)' })
  async linkHealth() {
    return { data: await this.svc.linkHealth() };
  }
}
