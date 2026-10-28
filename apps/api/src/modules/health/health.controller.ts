import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { MetricsInterceptor } from '../../common/interceptors/metrics.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { HIS_VERSION } from '@hospital-run/shared';
import { readBuildInfo } from './build-info';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  check() {
    // 버전은 정본(HIS_VERSION) — '0.1.0' 하드코딩은 배포 버전과 무관한 낡은 표시였다(P6)
    // 🔴 (2026-09-13) 커밋도 함께 — 표시 버전만으로는 운영 코드를 특정하지 못했다(v4.19.0 뒤 20커밋). 기록이 없으면 null(지어내지 않는다)
    return { status: 'ok', version: HIS_VERSION, commit: readBuildInfo().commit };
  }

  @Get('ready')
  async ready() {
    const db = await this.prisma
      .$queryRaw`SELECT 1`
      .then(() => 'ok')
      .catch(() => 'error');
    const cache = await this.redis
      .ping()
      .then(() => 'ok')
      .catch(() => 'error');
    return { db, redis: cache };
  }

  @Get('live')
  live() {
    return;
  }

  @Get('metrics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  metrics() {
    return { data: MetricsInterceptor.getMetrics() };
  }
}
