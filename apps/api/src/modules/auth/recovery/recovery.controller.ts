import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { RecoveryService } from './recovery.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RecoveryRequestDto, RecoveryApproveDto, RecoveryCompleteDto } from './dto/recovery.dto';

import { cookieSecure } from '../../../common/release-security';
@ApiTags('account-recovery')
@Controller('api/v1')
export class RecoveryController {
  constructor(private readonly svc: RecoveryService) {}

  // 공개 — 잠긴 직원
  @Post('auth/recovery/request')
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: '계정 복구 요청(패스키 분실)' })
  async request(@Body() body: RecoveryRequestDto) {
    return { data: await this.svc.request(body.identifier, body.reason) };
  }

  @Post('auth/recovery/complete')
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: '복구 완료 — 기존 패스키 폐기 + 임시 세션(재등록 강제)' })
  async complete(@Body() body: RecoveryCompleteDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.svc.complete(body.requestId, body.recoveryToken);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: cookieSecure(), // 🔴 T4-2 — REAL 은 항상 secure(NODE_ENV=development 로 평문 쿠키가 열리지 않는다)
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });
    return { data: { accessToken: result.accessToken, expiresIn: result.expiresIn, mustRegisterPasskey: result.mustRegisterPasskey } };
  }

  // 관리자 — 다중통제 승인
  @Get('admin/recovery')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '복구 요청 목록(대기/승인)' })
  async list() {
    return { data: await this.svc.listPending() };
  }

  @Post('admin/recovery/:id/approve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '복구 승인 → 복구 토큰 발급(대면 전달)' })
  async approve(
    @CurrentUser('id') approverId: string,
    @Param('id') id: string,
    @Body() body: RecoveryApproveDto,
  ) {
    return { data: await this.svc.approve(approverId, id, body.secondApproverId, body.minutes) };
  }
}
