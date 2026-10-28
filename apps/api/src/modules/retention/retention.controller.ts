import { Body, Controller, Get, Param, Post, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RetentionService } from './retention.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UpsertPolicyDto, PurgeDto } from './dto/retention.dto';

// 데이터 보유/파기 (security-governance G1) — RETENTION_MANAGE
@ApiTags('retention')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermission(Permission.RETENTION_MANAGE)
@Controller('api/v1/retention')
export class RetentionController {
  constructor(
    private readonly retention: RetentionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('policies')
  @ApiOperation({ summary: '보유/파기 정책 목록' })
  async policies() {
    return { data: await this.retention.listPolicies() };
  }

  @Get('report')
  @ApiOperation({ summary: 'DRY-RUN 파기 후보 리포트(삭제 없음)' })
  async report() {
    return { data: await this.retention.report() };
  }

  @Get('legal-kinds')
  @ApiOperation({ summary: '국가별 법정 기록 종류 보유 현황(보존기간 미확정 — 후보 수 없음 · 두 기산점의 최고령)' })
  async legalKinds(@Query('country') country?: string) {
    const c = (country ?? 'KR').toUpperCase();
    if (c !== 'KR' && c !== 'AE') throw new BadRequestException('country 는 KR 또는 AE');
    return { data: await this.retention.legalKinds(c) };
  }

  @Post('policy')
  @ApiOperation({ summary: '정책 등록/수정(법무 확정 토글 포함)' })
  async upsert(@Body() body: UpsertPolicyDto) {
    return { data: await this.retention.upsertPolicy(body) };
  }

  // ── 4-eyes(G6) ──
  @Post('purge-request')
  @ApiOperation({ summary: '파기 요청(4-eyes) — 2인 승인 대기 생성' })
  async purgeRequest(@CurrentUser('id') actorId: string, @Body() body: PurgeDto) {
    return { data: await this.retention.requestPurge(body.resourceType, actorId, body.reason) };
  }

  @Get('approvals')
  @ApiOperation({ summary: '대기 중 파기 승인 요청' })
  async approvals() {
    return { data: await this.retention.listApprovals() };
  }

  @Post('approvals/:id/approve')
  @ApiOperation({ summary: '파기 요청 승인(요청자≠승인자 강제)' })
  async approve(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return { data: await this.retention.approve(id, actorId) };
  }

  @Post('purge')
  @ApiOperation({ summary: '실제 파기(4중 게이트: 전역 활성+법무 확정+클램프+4-eyes 승인)' })
  async purge(@CurrentUser('id') actorId: string, @Body() body: PurgeDto) {
    if (!body.confirm) throw new BadRequestException('confirm=true 필수');
    return { data: await this.retention.purge(body.resourceType, actorId) };
  }
}
