import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AppKeyService } from './app-key.service';
import {
  AssertionChallengeDto,
  AttestationChallengeDto,
  AttestationRegisterDto,
  RevokeAppKeyDto,
} from './dto/app-key.dto';

/**
 * 앱 설치 개별키 — APPKEY-01.
 *
 * 🔴 `attestation/challenge` 와 최초 `register` 만 **사전 인증 경로**다(가입 전에 필요).
 *    그래서 App ID 별 rate limit·설치별 생성 상한·challenge 1회 소비를 둔다.
 *    `status/revoke` 는 소유 세션 또는 관리자만 — URL 의 appKeyId 만으로 조회·변경할 수 없다.
 */
@ApiTags('mobile-app-integrity')
@Controller('api/v1/mobile/app-keys')
export class AppKeyController {
  constructor(private readonly appKeys: AppKeyService) {}

  @Post('attestation/challenge')
  @Throttle({ auth: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'App Attest 등록 challenge 발급(미인증)' })
  @ApiOkResponse({ description: '등록 challenge — 1회 소비(재사용 시 검증 실패)', schema: { type: 'object', properties: { data: { type: 'object', properties: { challengeId: { type: 'string' }, challenge: { type: 'string', description: 'base64 — clientDataHash 재료' }, expiresAt: { type: 'string', format: 'date-time' }, attestationEnvironment: { type: 'string', description: '허용 환경 — 기본 production 만(명시적 옵트인 없이는 development 불허)' } } } } } })
  async attestationChallenge(@Body() dto: AttestationChallengeDto) {
    return { data: await this.appKeys.attestationChallenge(dto) };
  }

  @Post('attestation/register')
  @Throttle({ auth: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'App Attest 등록 검증(미인증) — 결합 전 PENDING' })
  @ApiOkResponse({ description: 'attestation 전수 검증 후 키 등록 — 응답 모양은 서비스 return 정본', schema: { type: 'object', properties: { data: { type: 'object', properties: { appKeyId: { type: 'string', format: 'uuid' }, status: { type: 'string', description: '결합 전 PENDING — 로그인/결합이 별도 단계다' }, attestationEnvironment: { type: 'string' } } } } } })
  async register(@Body() dto: AttestationRegisterDto) {
    return { data: await this.appKeys.register(dto) };
  }

  @Post('assertion/challenge')
  @Throttle({ auth: { ttl: 60_000, limit: 120 } })
  @ApiOperation({ summary: '요청 assertion challenge 발급 — 목적·method·path·body 에 결합' })
  @ApiOkResponse({ description: 'assertion challenge — replay 방어는 counter 가 아니라 challenge 1회 소비다', schema: { type: 'object', properties: { data: { type: 'object', properties: { challengeId: { type: 'string' }, challenge: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } } } } } })
  async assertionChallenge(@Body() dto: AssertionChallengeDto) {
    return { data: await this.appKeys.assertionChallenge(dto) };
  }

  @Get(':appKeyId/status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '키 상태 조회(스탭 세션)' })
  @ApiOkResponse({ description: '키 상태', schema: { type: 'object', properties: { data: { type: 'object', properties: { appKeyId: { type: 'string', format: 'uuid' }, app: { type: 'string' }, installationId: { type: 'string' }, status: { type: 'string' } } } } } })
  async status(
    @Param('appKeyId') appKeyId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return { data: await this.appKeys.status(appKeyId, { userId, role }) };
  }

  @Delete(':appKeyId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '키 폐기(스탭 세션)' })
  async revoke(
    @Param('appKeyId') appKeyId: string,
    @Body() dto: RevokeAppKeyDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return { data: await this.appKeys.revoke(appKeyId, dto.reason, { userId, role }) };
  }
}
