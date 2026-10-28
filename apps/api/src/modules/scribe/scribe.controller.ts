import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  ParseIntPipe,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ScribeService } from './scribe.service';
import {
  StartScribeSessionDto,
  UploadScribeAudioDto,
  TranscribeScribeDto,
  EnrollVoiceProfileDto,
  RelabelScribeSegmentDto,
} from './dto/scribe.dto';

/** 진료 스크라이브 세션 — 담당의 본인만(소유 검증은 서비스). config `scribe.enabled` 게이트. */
@ApiTags('Scribe')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/encounters')
export class ScribeSessionController {
  constructor(private readonly scribe: ScribeService) {}

  @Post(':encounterId/scribe/session')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '스크라이브 세션 시작 (RECORDING 동의 검증 선행)' })
  async start(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Body() _dto: StartScribeSessionDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.scribe.startSession(encounterId, userId) };
  }

  @Get(':encounterId/scribe/:sid')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '세션 상태·전사·초안 조회' })
  async get(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.scribe.getSession(encounterId, sid, userId) };
  }

  @Post(':encounterId/scribe/:sid/audio')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '오디오 업로드 (P0 base64 · P1 청크)' })
  async upload(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: UploadScribeAudioDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.scribe.uploadAudio(encounterId, sid, userId, dto) };
  }

  @Post(':encounterId/scribe/:sid/transcribe')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '전사+화자분리 요청 (비동기·완료는 세션 폴링)' })
  async transcribe(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: TranscribeScribeDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.scribe.transcribe(encounterId, sid, userId, dto.diarize ?? true) };
  }

  @Post(':encounterId/scribe/:sid/draft')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '전사→SOAP 초안 생성 (NER+SOAP·의사 검토·서명 필수)' })
  async draft(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.scribe.draft(encounterId, sid, userId) };
  }

  @Patch(':encounterId/scribe/:sid/segment/:index')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '화자분리 세그먼트 재라벨 (D8 — 화자만 정정·원문 불변)' })
  async relabelSegment(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: RelabelScribeSegmentDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.scribe.relabelSegment(encounterId, sid, index, userId, dto) };
  }

  @Delete(':encounterId/scribe/:sid')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '세션·원음 삭제 (철회·보존만료·legal hold 우선)' })
  async remove(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.scribe.deleteSession(encounterId, sid, userId) };
  }
}

/** 의료진 음성 프로파일 — 본인만(생체정보·opt-in). */
@ApiTags('Scribe')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/scribe')
export class ScribeVoiceProfileController {
  constructor(private readonly scribe: ScribeService) {}

  @Get('voice-profile')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '본인 음성 프로파일 상태' })
  async get(@CurrentUser('id') userId: string) {
    return { data: await this.scribe.getVoiceProfile(userId) };
  }

  @Post('voice-profile')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '음성 프로파일 등록 (생체 동의 선행)' })
  async enroll(@Body() dto: EnrollVoiceProfileDto, @CurrentUser('id') userId: string) {
    return { data: await this.scribe.enrollVoiceProfile(userId, dto) };
  }

  @Delete('voice-profile')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '음성 프로파일 철회·임베딩 파기' })
  async revoke(@CurrentUser('id') userId: string) {
    return { data: await this.scribe.revokeVoiceProfile(userId) };
  }
}
