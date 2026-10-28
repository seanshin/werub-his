import { Body, Controller, Get, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { TerminalService } from './terminal.service';
import { TerminalPinService } from './terminal-pin.service';
import { TerminalDraftService } from './terminal-draft.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RegisterTerminalDto,
  OverrideTerminalDto,
  VerifyPinDto,
  RevealPinDto,
  SaveDraftDto,
  KillSwitchDto,
} from './dto/terminal.dto';

// 제로 트러스트 단말 보안 — D1 (terminal-zero-trust 설계 §4)
@ApiTags('terminal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/terminal')
export class TerminalController {
  constructor(
    private readonly terminal: TerminalService,
    private readonly pin: TerminalPinService,
    private readonly draft: TerminalDraftService,
  ) {}

  @Get('context')
  @ApiOperation({ summary: '단말+직군 보안 프로파일 결정(X-Device-UUID/IP)' })
  async context(
    @CurrentUser() user: { id: string; role: string },
    @Headers('x-device-uuid') deviceUuid?: string,
    @Ip() ip?: string,
  ) {
    return { data: await this.terminal.resolveContext(user, deviceUuid, ip) };
  }

  @Post('registry')
  @RequirePermission(Permission.TERMINAL_MANAGE)
  @ApiOperation({ summary: '단말 등록/수정(mode·전담·타임아웃)' })
  async register(@CurrentUser('id') actorId: string, @Body() body: RegisterTerminalDto) {
    return { data: await this.terminal.register(body, actorId) };
  }

  @Get('registry')
  @RequirePermission(Permission.TERMINAL_MANAGE)
  @ApiOperation({ summary: '단말 목록' })
  async list() {
    return { data: await this.terminal.list() };
  }

  @Post('override')
  @RequirePermission(Permission.TERMINAL_OVERRIDE)
  @ApiOperation({ summary: '현장 오버라이드(모드/전담/격리) + 감사' })
  async override(@CurrentUser('id') actorId: string, @Body() body: OverrideTerminalDto) {
    return { data: await this.terminal.override(body, actorId) };
  }

  // ── D2: 데일리 PIN (§6.5) ──
  @Post('daily-pin')
  @ApiOperation({ summary: '데일리 PIN 발급(본인 생체 세션·출근 통합·HMAC)' })
  async issuePin(@CurrentUser('id') userId: string) {
    return { data: await this.pin.issue(userId) };
  }

  @Post('daily-pin/reveal')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '데일리 PIN 보기(생체 재인증 → 당일 PIN 재발급·표시)' })
  async revealPin(
    @CurrentUser('id') userId: string,
    @Body() body: RevealPinDto,
  ) {
    return { data: await this.pin.reveal(userId, body.response as unknown as AuthenticationResponseJSON) };
  }

  @Post('daily-pin/verify')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '데일리 PIN 검증(복합 컨텍스트 단말+사번+PIN)' })
  async verifyPin(@Body() body: VerifyPinDto) {
    return { data: await this.pin.verify(body.deviceUuid, body.employeeNumber, body.pin) };
  }

  // ── D2: Atomic Draft (§6.4) ──
  @Post('draft')
  @ApiOperation({ summary: '작성 중 스냅샷 원자적 저장(암호화·짧은 TTL)' })
  async saveDraft(@CurrentUser('id') userId: string, @Body() body: SaveDraftDto) {
    return { data: await this.draft.save(userId, body.snapshot) };
  }

  @Get('draft')
  @ApiOperation({ summary: '내 스냅샷 복원' })
  async getDraft(@CurrentUser('id') userId: string) {
    return { data: await this.draft.restore(userId) };
  }

  // ── D4: 분실 Kill-Switch (§6.6) ──
  @Post('kill-switch')
  @RequirePermission(Permission.TERMINAL_KILL)
  @ApiOperation({ summary: '분실 기기 세션 파기(SLO + 패스키 폐기 + PIN/draft 제거)' })
  async killSwitch(@CurrentUser('id') actorId: string, @Body() body: KillSwitchDto) {
    return { data: await this.terminal.killSwitch(body, actorId) };
  }

  // ── D4: 페일모드 health (§6.7.2) ──
  @Get('health')
  @ApiOperation({ summary: 'Redis 가용성·페일모드 정책 신호(프론트 fail-secure/open 분기)' })
  async health() {
    return { data: await this.terminal.health() };
  }
}
