import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { ApiConsumes } from '@nestjs/swagger';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { safeUploadSegment } from '../../common/util/upload-url';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DecisionService } from './decision.service';
import { EvidenceExtractService } from '../evidence/evidence-extract.service';
import { BulkDecisionDto, BulkSubmitDto, CommitteeAuthorityRecordDto, DecisionImpactQueryDto, DevEnactmentDto, DecisionLogQueryDto, RecordDecisionDto, ReviewConfirmDto } from './decision.dto';
import { DecisionBulkService } from './decision-bulk.service';
import { DecisionEngineService } from './decision-engine.service';

@ApiTags('Human Decisions (중요 사람 결정)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/decisions')
export class DecisionController {
  constructor(
    private readonly svc: DecisionService,
    private readonly evidence: EvidenceExtractService,
    private readonly engine: DecisionEngineService,
    private readonly bulk: DecisionBulkService,
  ) {}

  /**
   * 🔴 위원회 중요결정 일괄 의사결정 — 하나씩과 같은 경로(회의·안건·의결 / 권한자 기록)를 차례로 지난다.
   *    의결 입력은 관리자 몫이다(의결 EP 와 같은 역할) · 항목마다 성공/실패를 돌려준다(원자적이지 않다).
   */
  @Post('bulk')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '위원회 중요결정 일괄 의사결정(회의 하나 · 결정마다 안건·의결 · 권한자 항목은 결정 기록)' })
  async bulkDecide(@Body() dto: BulkDecisionDto, @CurrentUser('id') userId: string) {
    return { data: await this.bulk.decide(dto, userId) };
  }

  /**
   * 🔴 위원회 안건 일괄 상정 — 의결 없이 안건 접수 + (고르면) 회의 배정까지. 하나씩 올리는 경로와 같다.
   *    상정은 의결이 아니다 — 등록부·설정은 바뀌지 않는다 · 회의 배정은 관리자 몫(안건 배정 EP 와 같은 역할)
   */
  @Post('bulk-submit')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '위원회 안건 일괄 상정(결정마다 안건 접수 · 회의 배정 선택 · 의결 없음)' })
  async bulkSubmit(@Body() dto: BulkSubmitDto, @CurrentUser('id') userId: string) {
    if (dto.meetingId && dto.scheduledAt) throw new BadRequestException({ code: 'BULK_SUBMIT_MEETING_BOTH', message: '예정 회의와 새 회의 중 하나만 고르세요' });
    return { data: await this.bulk.submit({ committeeCode: dto.committeeCode, keys: dto.keys, meeting: dto.meetingId ? { meetingId: dto.meetingId } : dto.scheduledAt ? { scheduledAt: dto.scheduledAt, title: dto.meetingTitle } : null }, userId) };
  }

  /** 결정 이력 원장(전체) — 최신부터 · 자르면 nextCursor 로 말한다 */
  @Get('log')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '결정 이력 원장 — 결정·의결·선행 변경·재검토 확인·설정 직접 변경(덧붙이기만)' })
  async log(@Query() q: DecisionLogQueryDto) {
    return { data: await this.engine.log(q) };
  }

  @Get(':key/log')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '결정 하나의 이력 — 오래된 것부터(결정 문서의 경과)' })
  async logFor(@Param('key') key: string) {
    return { data: await this.engine.logFor(key) };
  }

  /** 🔴 고르기 전에 결과를 보여준다 — 바뀌는 설정·후행 결정(재검토·열림·막힘)·선행 충족 */
  @Get(':key/impact')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '결정 영향 미리보기(저장하지 않는다)' })
  async impact(@Param('key') key: string, @Query() q: DecisionImpactQueryDto) {
    return { data: await this.engine.impact(key, q.choice) };
  }

  @Post(':key/review-confirm')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '재검토 확인 — 선행 결정이 바뀐 뒤 이 결정을 그대로 둔다는 근거(선택은 바꾸지 않는다)' })
  async reviewConfirm(@Param('key') key: string, @Body() dto: ReviewConfirmDto, @CurrentUser('id') userId: string) {
    return { data: await this.engine.reviewConfirm(key, userId, dto.note) };
  }

  /**
   * 🔴 위원회 결정권한자 표 원내 채택 기록(기획 P3 G7) — 종전엔 쓰는 경로가 없어 개발 시드가 영원히 남았다.
   *    근거(규정·의결 번호) 필수 · 시드 표식 근거 거부 · 관리자.
   */
  @Post('committee-authority/:code')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '위원회 결정권한자 표 원내 채택 기록(근거 필수)' })
  async committeeAuthority(@Param('code') code: string, @Body() dto: CommitteeAuthorityRecordDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.recordCommitteeAuthority(code, userId, dto) };
  }

  /**
   * 🔴 개발 반영 기록(기획 P2) — 개발이 실결정 선택대로 반영했다 / 현행이라 할 일 없다.
   *    "되돌림 필요"는 실결정 기록 순간 시스템이 남긴다(이 EP 로 남기지 않는다). 확인자는 관리자(사람 결정 D5 전 기본값).
   */
  @Post(':key/dev-enactment')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '개발 반영 기록 — 반영 확인(릴리즈 버전)·반영 불필요(근거)' })
  async devEnactment(@Param('key') key: string, @Body() dto: DevEnactmentDto, @CurrentUser('id') userId: string) {
    return { data: await this.engine.recordDevEnactment(key, userId, dto) };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '중요 사람 결정 등록부 — 무엇을·왜·누가 결정해야 하는가와 현재 기록' })
  async list() {
    return { data: await this.svc.list() };
  }

  /**
   * 🔴 이 EP 는 **결정을 기록**한다. 적용은 경로에 따라 다르다:
   * 위원회 의결 사항은 적용하지 않고 안건으로 넘긴다 — 화면이 갖지 않은 권한을 가진 척하지 않는다.
   */
  /**
   * 🔴 허가 근거 문서 첨부 — 기록 **전에** 올린다(기록 시 함께 봉인된다).
   *
   * 저장 위치는 `uploads/decisions/<key>/` 이고, `/uploads` 정적 서빙은 **서명 없이는 401** 이다
   * (`main.ts` 업로드 서명 게이트). 응답 URL 은 인터셉터가 서명해서 내보낸다.
   * 🔴 **시스템은 문서의 진위·유효성을 검증하지 못한다** — 무엇이 언제 누구에 의해 올라왔는지만 남는다.
   */
  /**
   * 🔴 허가 근거 문서 **판독 초안** — 개원 축과 **같은 정본**(`EvidenceExtractService`)을 쓴다.
   *    각자 구현하면 한쪽만 정직해진다(한쪽은 못 읽은 칸을 빈 문자열로 채우고, 한쪽은 안 채우는 식).
   *    저장하지 않는다 — 사람이 확인하고 고쳐서 저장한다.
   */
  @Post(':key/attachments/:id/extract')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '허가 근거 문서 AI 판독(초안 — 저장하지 않는다)' })
  async extractAttachment(@Param('key') key: string, @Param('id') id: string) {
    const { path, fileName } = await this.svc.attachmentPath(key, id);
    return { data: await this.evidence.extract(path, fileName, '의료기관 허가·법적 근거 문서') };
  }

  @Post(':key/attachments')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '허가 근거 문서 첨부(pdf/jpeg/png/webp · 10MB)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (req, _f, cb) => {
        // 🔴 등록부 검증(service.def)은 **핸들러에서** 일어난다 — destination 콜백은 그보다 먼저 돌아
        //    파일이 이미 디스크에 쓰인 뒤다. 경로 안전은 여기서 스스로 지킨다(G4).
        const safe = safeUploadSegment((req.params as Record<string, string> | undefined)?.key);
        if (!safe) return cb(new BadRequestException('결정 키가 올바르지 않습니다'), '');
        const dir = join(process.cwd(), 'uploads', 'decisions', safe);
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_r, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_r, file, cb) => {
      const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
      cb(ok ? null : new BadRequestException('pdf/jpeg/png/webp 파일만 첨부할 수 있습니다'), ok);
    },
  }))
  async attach(@Param('key') key: string, @UploadedFile() file: Express.Multer.File, @CurrentUser('id') userId: string) {
    if (!file) throw new BadRequestException('file 필드에 파일을 첨부하세요');
    // multer 는 originalname 을 latin1 로 파싱 — 한글 파일명 복원(선례: consent)
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return { data: await this.svc.addAttachment(key, userId, { filename: file.filename, originalName, mimetype: file.mimetype, size: file.size }) };
  }

  @Post(':key/record')
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '결정 기록(법적 검토 근거 필수 · 없으면 거부)' })
  async record(@Param('key') key: string, @Body() dto: RecordDecisionDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.decide(key, userId, dto) };
  }
}
