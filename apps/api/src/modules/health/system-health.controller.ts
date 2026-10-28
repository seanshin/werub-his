import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { HIS_VERSION } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { readBuildInfo } from './build-info';

/**
 * 관리자 대시보드 '시스템 상태'(2026-10-02).
 * 🔴 `/health/ready`(DB·Redis)는 외부 경로에 열려 있지 않아 브라우저가 부를 수 없었다 — 위젯은 설명에 "API/DB/Redis"라
 *    적어 놓고 `/health`(살아 있음)만 물었다. 같은 점검을 `/api/v1` 아래 관리자 전용으로 낸다.
 * 점검마다 `ok`/`error` 만 말한다 — 실패 사유 문자열은 내보내지 않는다(내부 구성 노출).
 */
@ApiTags('Health')
@Controller('api/v1/system-health')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SystemHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '시스템 상태(API·DB·Redis 점검) — 관리자 대시보드' })
  async check() {
    const started = Date.now();
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const, () => 'error' as const),
      this.redis.ping().then(() => 'ok' as const, () => 'error' as const),
    ]);
    return {
      data: {
        api: 'ok' as const,
        db,
        redis,
        version: HIS_VERSION,
        commit: readBuildInfo().commit,
        checkedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
      },
    };
  }
}
