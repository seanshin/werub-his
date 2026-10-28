import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { authContextFromRequest } from '../auth-audit';
import { MobileAuthService } from './mobile-auth.service';
import { MobileLoginDto, MobileLogoutDto, MobileRefreshDto } from './dto/mobile-auth.dto';
import { AppAssertionGuard, RequireAppAssertion } from '../../mobile/app-key/app-assertion.guard';

type SessionUser = { id: string; sessionId?: string };

/**
 * 네이티브 스탭 인증 — 쿠키 없이 JSON 만으로 login → refresh → logout (AUTH-S-01).
 *
 * 🔴 웹 경로(`/api/v1/auth/*`)는 **건드리지 않는다.** 같은 세션 저장소를 공유하되
 *    계약만 네이티브용으로 따로 둔다.
 */
@ApiTags('mobile-staff-auth')
@Controller('api/v1/auth/mobile')
@UseGuards(AppAssertionGuard)
export class MobileAuthController {
  constructor(private readonly mobile: MobileAuthService) {}

  @Post('login')
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @RequireAppAssertion('STAFF_PASSWORD_LOGIN')
  @ApiOperation({ summary: '스탭 네이티브 로그인(비밀번호 fallback)' })
  @ApiOkResponse({ description: '네이티브 세션 발급 — 이 스키마는 서비스 return 정본을 옮긴 것(2026-08-25)', schema: { type: 'object', properties: { data: { type: 'object', properties: { account: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string' }, employeeId: { type: 'string', nullable: true }, familyName: { type: 'string' }, givenName: { type: 'string' }, role: { type: 'string' }, department: { type: 'string', nullable: true } } }, tokens: { type: 'object', properties: { accessToken: { type: 'string' }, accessTokenExpiresAt: { type: 'string', format: 'date-time' }, refreshToken: { type: 'string' }, refreshTokenExpiresAt: { type: 'string', format: 'date-time' } } }, session: { type: 'object', properties: { sessionId: { type: 'string' }, installationId: { type: 'string', nullable: true }, staffDeviceId: { type: 'string', nullable: true }, appKeyId: { type: 'string', nullable: true }, deviceState: { type: 'string', example: 'ACTIVE' }, assuranceLevel: { type: 'string' }, appIntegrity: { type: 'object', properties: { verified: { type: 'boolean' }, reason: { type: 'string', nullable: true } }, description: '앱 무결성 검증이 성립하지 않으면 그 사실을 그대로 말한다' } } }, security: { type: 'object', properties: { passwordChangeRequired: { type: 'boolean' }, stepUpMethods: { type: 'array', items: { type: 'string' } } } }, navigation: { type: 'object', description: '역할별 홈 모듈(서버 매핑)' } } } } } })
  async login(@Body() dto: MobileLoginDto, @Req() req: Request) {
    return { data: await this.mobile.login(dto, authContextFromRequest(req)) };
  }

  @Post('refresh')
  @Throttle({ auth: { ttl: 60_000, limit: 60 } })
  @RequireAppAssertion('STAFF_TOKEN_REFRESH')
  @ApiOperation({ summary: 'access + 회전 refresh 재발급' })
  @ApiOkResponse({ description: 'refresh 회전 — 만료 시각은 서명 토큰 exp 에서 산출(응답이 실제와 다르게 말하지 않는다)', schema: { type: 'object', properties: { data: { type: 'object', properties: { tokens: { type: 'object', properties: { accessToken: { type: 'string' }, accessTokenExpiresAt: { type: 'string', format: 'date-time' }, refreshToken: { type: 'string' }, refreshTokenExpiresAt: { type: 'string', format: 'date-time' } } }, session: { type: 'object', properties: { sessionId: { type: 'string' } } } } } } } })
  async refresh(@Body() dto: MobileRefreshDto) {
    return { data: await this.mobile.refresh(dto) };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '현재 세션 로그아웃(기본) 또는 전체 로그아웃' })
  @ApiOkResponse({ description: '세션 폐기 범위와 개수', schema: { type: 'object', properties: { data: { type: 'object', properties: { scope: { type: 'string', enum: ['CURRENT_SESSION', 'ALL_SESSIONS'] }, revokedSessions: { type: 'number' } } } } } })
  async logout(@Body() dto: MobileLogoutDto, @Req() req: Request & { user: SessionUser }) {
    return { data: await this.mobile.logout(req.user.id, dto, authContextFromRequest(req)) };
  }

  @Get('session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '세션 살아 있는가 — foreground 복귀 시 확인' })
  async session(@Req() req: Request & { user: SessionUser }) {
    return { data: await this.mobile.session(req.user.id, req.user.sessionId) };
  }
}
