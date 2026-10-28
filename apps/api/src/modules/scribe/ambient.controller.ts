import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AmbientScribeService } from './ambient.service';
import { StartAmbientSessionDto, AddUtteranceDto, PatchUtteranceDto, ApplySuggestionDto } from './dto/ambient.dto';

/**
 * 앰비언트 대화 스트림 — 담당의 본인만(소유 검증은 서비스).
 * config `voiceEmr.ambient.enabled` 게이트(기본 OFF). STT 청크는 /api/v1/voice/session/:sid/chunk 재사용.
 */
@ApiTags('Scribe')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/scribe/ambient')
export class AmbientScribeController {
  constructor(private readonly ambient: AmbientScribeService) {}

  @Post('session')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '대화 세션 시작 (RECORDING 동의 검증 선행)' })
  async start(@Body() dto: StartAmbientSessionDto, @CurrentUser('id') userId: string) {
    return { data: await this.ambient.startSession(dto.encounterId, userId) };
  }

  @Get('session/:sid')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '대화 세션 + 발화 목록' })
  async get(@Param('sid', ParseUUIDPipe) sid: string, @CurrentUser('id') userId: string) {
    return { data: await this.ambient.getSession(sid, userId) };
  }

  @Post('session/:sid/utterances')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '발화 확정 저장(멱등 upsert) — 응답에 규칙 NER 동봉' })
  async addUtterance(
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: AddUtteranceDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.ambient.addUtterance(sid, userId, dto) };
  }

  @Patch('session/:sid/utterances/:seq')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '발화 수정·화자 토글·삭제(소프트)' })
  async patchUtterance(
    @Param('sid', ParseUUIDPipe) sid: string,
    @Param('seq', ParseIntPipe) seq: number,
    @Body() dto: PatchUtteranceDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.ambient.patchUtterance(sid, seq, userId, dto) };
  }

  @Post('session/:sid/analyze')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '전체 분석 — 발화 → 필드별 SOAP 제안(규칙 항상·AI 부가). 확정 없음' })
  async analyze(@Param('sid', ParseUUIDPipe) sid: string, @CurrentUser('id') userId: string) {
    return { data: await this.ambient.analyze(sid, userId) };
  }

  @Post('session/:sid/apply')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'SOAP 반영 기록(provenance·감사) — 텍스트 쓰기는 진료 저장 경로' })
  async apply(
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: ApplySuggestionDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.ambient.applySuggestion(sid, userId, dto) };
  }

  @Post('session/:sid/close')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '대화 세션 종료 — 발화 스냅샷을 transcript 로 고정' })
  async close(@Param('sid', ParseUUIDPipe) sid: string, @CurrentUser('id') userId: string) {
    return { data: await this.ambient.closeSession(sid, userId) };
  }
}
