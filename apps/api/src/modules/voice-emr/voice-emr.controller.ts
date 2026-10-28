import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsString, IsOptional, IsIn, IsBoolean, IsInt, IsObject, IsUUID, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VoiceEmrService } from './voice-emr.service';

class StartDto { @IsOptional() @IsString() encounterId?: string; @IsOptional() @IsUUID() surgeryId?: string; @IsOptional() @IsIn(['read', 'dictate', 'command', 'READ', 'DICTATE', 'COMMAND']) mode?: string }
class ChunkDto { @IsString() pcmBase64!: string; @IsIn(['partial', 'final']) mode!: 'partial' | 'final'; @IsOptional() @IsInt() sampleRate?: number; @IsOptional() @IsString() targets?: string }
class ParseDto { @IsString() @MaxLength(2000) transcript!: string; @IsOptional() confidence?: number }
class ConfirmDto { @IsString() intent!: string; @IsOptional() @IsObject() slots?: object; @IsOptional() @IsString() resultKind?: string; @IsOptional() @IsString() resultRef?: string; @IsOptional() @IsString() phraseId?: string }
class ProfileDto { @IsOptional() @IsString() defaultMode?: string; @IsOptional() @IsBoolean() pttEnabled?: boolean; @IsOptional() @IsBoolean() speakerGateEnabled?: boolean; @IsOptional() @IsString() language?: string }
class PhraseDto { @IsIn(['ALIAS', 'HABIT', 'VOCAB', 'MACRO']) type!: string; @IsString() @MaxLength(200) pattern!: string; @IsOptional() @IsObject() action?: object; @IsOptional() @IsInt() priority?: number }
class ToggleDto { @IsBoolean() enabled!: boolean }
class ConsentDto { @IsBoolean() agreed!: boolean; @IsOptional() @IsString() @MaxLength(16) version?: string }
class EnrollSampleDto { @IsString() pcmBase64!: string; @IsOptional() @IsInt() sampleRate?: number; @IsOptional() @IsString() @MaxLength(32) promptId?: string }
class DiarizeDto { @IsString() audioBase64!: string; @IsOptional() @IsString() @MaxLength(64) mime?: string }

@ApiTags('VoiceEMR (음성 구동 EMR)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/voice')
export class VoiceEmrController {
  constructor(private readonly svc: VoiceEmrService) {}

  @Post('session')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '음성 세션 시작(진료 단위 또는 수술 단위(수술팀·구술만)·워밍·vocab)' })
  start(@CurrentUser('id') userId: string, @Body() dto: StartDto) { return this.svc.startSession(userId, dto).then((data) => ({ data })); }

  @Post('session/:sid/chunk')
  @SkipThrottle() // 실시간 스트리밍(발화당 다수 청크) — 세션 소유+JWT 로 보호. 전역 레이트리밋 제외.
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: 'raw PCM 청크(base64) → STT partial/final' })
  async chunk(@Param('sid', ParseUUIDPipe) sid: string, @Body() dto: ChunkDto) {
    // 세션 소유 검증은 parse/confirm 에서(청크는 저지연 우선). STT 프록시.
    const pcm = new Uint8Array(Buffer.from(dto.pcmBase64, 'base64'));
    return { data: await this.svc.chunk(sid, pcm, dto.mode, dto.sampleRate, dto.targets) };
  }

  @Post('session/:sid/parse')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: 'final 전사 → intent/slots(rule 1차·환자 신원·needsConfirm)' })
  parse(@CurrentUser('id') userId: string, @Param('sid', ParseUUIDPipe) sid: string, @Body() dto: ParseDto) { return this.svc.parse(userId, sid, dto).then((data) => ({ data })); }

  @Get('search')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '약품/검사 마스터 n-best(퍼지·초성)' })
  search(@Query('kind') kind: 'drug' | 'lab', @Query('q') q: string) { return this.svc.searchCodes(kind === 'lab' ? 'lab' : 'drug', q).then((data) => ({ data })); }

  @Post('session/:sid/confirm')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '명령 확정(감사·실 EMR 쓰기는 기존 EP)' })
  confirm(@CurrentUser('id') userId: string, @Param('sid', ParseUUIDPipe) sid: string, @Body() dto: ConfirmDto) { return this.svc.confirm(userId, sid, dto).then((data) => ({ data })); }

  @Delete('session/:sid')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  close(@CurrentUser('id') userId: string, @Param('sid', ParseUUIDPipe) sid: string) { return this.svc.closeSession(userId, sid).then((data) => ({ data })); }

  // ── 개인화 (self-service) ──
  @Get('profile')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  getProfile(@CurrentUser('id') userId: string) { return this.svc.getProfile(userId).then((data) => ({ data })); }

  @Patch('profile')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  updateProfile(@CurrentUser('id') userId: string, @Body() dto: ProfileDto) { return this.svc.updateProfile(userId, dto).then((data) => ({ data })); }

  @Get('phrases')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  listPhrases(@CurrentUser('id') userId: string, @Query('type') type?: string) { return this.svc.listPhrases(userId, type).then((data) => ({ data })); }

  @Post('phrases')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  addPhrase(@CurrentUser('id') userId: string, @Body() dto: PhraseDto) { return this.svc.addPhrase(userId, dto).then((data) => ({ data })); }

  @Patch('phrases/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  togglePhrase(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ToggleDto) { return this.svc.togglePhrase(userId, id, dto.enabled).then((data) => ({ data })); }

  @Delete('phrases/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  deletePhrase(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) { return this.svc.deletePhrase(userId, id).then((data) => ({ data })); }

  // ── 화자 음성 등록(생체인식·성문·self-service) ──
  @Get('enroll')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '화자 등록 현황(동의·표본·상태)' })
  enrollStatus(@CurrentUser('id') userId: string) { return this.svc.getEnrollStatus(userId).then((data) => ({ data })); }

  @Post('enroll/consent')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '생체정보 처리 동의/철회(개인정보보호법 §23)' })
  enrollConsent(@CurrentUser('id') userId: string, @Body() dto: ConsentDto) { return this.svc.recordConsent(userId, dto.agreed, dto.version).then((data) => ({ data })); }

  @Post('enroll/sample')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '등록 표본 1건(성문 임베딩·개별 연습)' })
  enrollSample(@CurrentUser('id') userId: string, @Body() dto: EnrollSampleDto) {
    const pcm = new Uint8Array(Buffer.from(dto.pcmBase64, 'base64'));
    return this.svc.enrollSample(userId, pcm, dto.sampleRate, dto.promptId).then((data) => ({ data }));
  }

  @Post('enroll/complete')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '등록 완료 확정(최소 표본 충족)' })
  enrollComplete(@CurrentUser('id') userId: string) { return this.svc.completeEnroll(userId).then((data) => ({ data })); }

  @Delete('enroll')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '등록 철회 + 성문 삭제(철회권·파기)' })
  enrollRevoke(@CurrentUser('id') userId: string) { return this.svc.revokeEnroll(userId).then((data) => ({ data })); }

  // ── 다자간 화자분리(diarization) 테스트 ──
  @Post('diarize-test')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '다자간 대화 녹음 제출 → 화자분리 잡(jobId)' })
  diarizeSubmit(@CurrentUser('id') userId: string, @Body() dto: DiarizeDto) { return this.svc.submitDiarizeTest(userId, dto.audioBase64, dto.mime).then((data) => ({ data })); }

  @Get('diarize-test/:jobId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '화자분리 잡 폴링 → 화자별 텍스트 세그먼트' })
  diarizePoll(@CurrentUser('id') userId: string, @Param('jobId') jobId: string) { return this.svc.pollDiarizeTest(userId, jobId).then((data) => ({ data })); }
}
