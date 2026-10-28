import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PreAuthService } from './pre-auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubmitOrderPreAuthDto } from './dto/pre-auth.dto';

// 사전승인(Pre-Authorization) — 고위험 오더 발행 전 결재. 결재 자체는 기존 /ess/approvals 결재함 재사용.
@ApiTags('사전승인(Pre-Auth)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/pre-auth')
export class PreAuthController {
  constructor(private readonly svc: PreAuthService) {}

  @Post('orders')
  @ApiOperation({ summary: '오더 사전승인 상신(P0: 마약류 처방) — 승인 시 처방 발행. 게이트 preauth.enforce.NARCOTIC_RX' })
  async submitOrder(@CurrentUser('id') userId: string, @Body() dto: SubmitOrderPreAuthDto) {
    return { data: await this.svc.submitOrderPreAuth(userId, dto) };
  }

  @Get('mine')
  @ApiOperation({ summary: '내 사전승인 상신 목록' })
  async mine(@CurrentUser('id') userId: string) {
    return { data: await this.svc.listMine(userId) };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '사전승인 취소(PENDING만)' })
  async cancel(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.cancel(userId, id) };
  }
}
