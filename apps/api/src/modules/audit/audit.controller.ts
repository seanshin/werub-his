import { Controller, Get, Post, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrintEventDto } from './print-event.dto';

/**
 * 리소스 종류별 집계에서 이표기(PRESCRIPTION / Prescription)를 하나로 합친다.
 * 대표 표기는 건수가 많은 쪽 — 과거 데이터는 앵커링돼 있어 수정할 수 없으므로 표시 단계에서 흡수한다.
 */
function mergeResourceCounts(rows: Array<{ resourceType: string; _count: number }>) {
  const merged = new Map<string, { resourceType: string; count: number }>();
  for (const r of rows) {
    const key = r.resourceType.toLowerCase();
    const prev = merged.get(key);
    if (!prev) merged.set(key, { resourceType: r.resourceType, count: r._count });
    else {
      if (r._count > prev.count) prev.resourceType = r.resourceType; // 다수 표기를 대표로
      prev.count += r._count;
    }
  }
  return [...merged.values()].sort((a, b) => b.count - a.count);
}

@ApiTags('Audit')
@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '감사 로그 조회' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
  ) {
    const take = Math.min(Number(limit) || 50, 100);
    const skip = ((Number(page) || 1) - 1) * take;

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    // 과거 기록에는 직접 호출분의 이표기(PRESCRIPTION / Prescription)가 섞여 있다.
    // 앵커링된 행(변조탐지 대상)이라 과거 데이터를 고칠 수 없으므로 **조회 계층에서 흡수**한다.
    if (resourceType) where.resourceType = { equals: resourceType, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take,
        skip,
        include: {
          user: { select: { id: true, familyName: true, givenName: true, role: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page: Number(page) || 1, limit: take, hasMore: skip + take < total },
    };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '감사 로그 통계' })
  async stats() {
    const [byAction, byResource, recentCount] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['action'], _count: true }),
      // 이표기 병합을 위해 전량 집계 후 상위 10종을 고른다(리소스 종류 수는 백 단위라 부담 없음)
      this.prisma.auditLog.groupBy({ by: ['resourceType'], _count: true }),
      this.prisma.auditLog.count({ where: { timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    ]);

    return {
      data: {
        byAction: byAction.map(a => ({ action: a.action, count: a._count })),
        byResource: mergeResourceCounts(byResource).slice(0, 10),
        last24h: recentCount,
        total: await this.prisma.auditLog.count(),
      },
    };
  }

  @Post('anchor')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '감사 로그 블록체인 앵커링 (변조 방지)' })
  async anchorLogs() {
    return { data: await this.auditService.anchorAuditLogs() };
  }

  /**
   * 인쇄 시도 감사(PrintGuard) — 차단·지정 인쇄를 사용자 지목으로 기록(전 인증 사용자).
   * 🔴 resourceId 는 @db.Uuid — 비UUID 를 넣으면 anchoring 큐 poison. 주체(userId)를 지목한다.
   */
  @Post('print-event')
  @ApiOperation({ summary: '인쇄 시도 기록 — BLOCKED(차단)/SANCTIONED(지정 버튼)/PRINT_ROUTE(전용 경로)' })
  async printEvent(@CurrentUser('id') userId: string, @Body() dto: PrintEventDto) {
    await this.auditService.log({
      action: 'CREATE',
      resourceType: 'PrintAttempt',
      resourceId: userId,
      userId,
      changes: { print: { old: null, new: { kind: dto.kind, path: dto.path, ...(dto.detail ? { detail: dto.detail } : {}) } } },
    });
    return { data: { ok: true } };
  }

  @Get('verify/:logId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '감사 로그 무결성 검증' })
  async verifyLog(@Param('logId', ParseUUIDPipe) logId: string) {
    return { data: await this.auditService.verifyIntegrity(logId) };
  }
}
