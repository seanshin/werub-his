import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PasskeyService } from './passkey.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { authContextFromRequest } from '../auth-audit';
import {
  PasskeyRegisterVerifyDto,
  PasskeyLoginOptionsDto,
  PasskeyLoginVerifyDto,
  PasskeyRenameDto,
} from './dto/passkey.dto';

import { cookieSecure } from '../../../common/release-security';
@ApiTags('auth-passkey')
@Controller('api/v1/auth/passkey')
export class PasskeyController {
  constructor(private readonly passkey: PasskeyService) {}

  // ── 등록 (인증 필요) ──
  @Post('register/options')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '패스키 등록 옵션(챌린지) 발급' })
  async registerOptions(@CurrentUser('id') userId: string) {
    return { data: await this.passkey.getRegistrationOptions(userId) };
  }

  @Post('register/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '패스키 등록 검증·저장' })
  async registerVerify(
    @CurrentUser('id') userId: string,
    @Body() body: PasskeyRegisterVerifyDto,
  ) {
    return { data: await this.passkey.verifyRegistration(userId, body.response, body.deviceName) };
  }

  // ── 로그인 (공개) ──
  @Post('login/options')
  @Throttle({ auth: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: '패스키 로그인 옵션(챌린지) 발급' })
  async loginOptions(@Body() body: PasskeyLoginOptionsDto) {
    return { data: await this.passkey.getLoginOptions(body?.identifier) };
  }

  @Post('login/verify')
  @Throttle({ auth: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: '패스키 로그인 검증 → 토큰 발급(+refresh 쿠키)' })
  async loginVerify(
    @Body() body: PasskeyLoginVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 접속기록 — 패스키 로그인도 같은 원장에 남는다(경로만 PASSKEY 로 구분)
    const result = await this.passkey.verifyLogin(body.flowId, body.response, authContextFromRequest(req, 'PASSKEY'));
    // 비밀번호 로그인과 동일하게 refresh 토큰을 httpOnly 쿠키로 — 생체 로그인도 세션 갱신 가능(세션 만료 방지)
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: cookieSecure(), // 🔴 T4-2 — REAL 은 항상 secure(NODE_ENV=development 로 평문 쿠키가 열리지 않는다)
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });
    return { data: { accessToken: result.accessToken, expiresIn: result.expiresIn } };
  }

  // ── 관리 (인증 필요) ──
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 패스키 목록' })
  async list(@CurrentUser('id') userId: string) {
    return { data: await this.passkey.listCredentials(userId) };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '패스키 이름 변경' })
  async rename(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: PasskeyRenameDto,
  ) {
    return { data: await this.passkey.rename(userId, id, body.deviceName) };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '패스키 삭제(최소 1개 유지)' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { data: await this.passkey.remove(userId, id) };
  }
}
