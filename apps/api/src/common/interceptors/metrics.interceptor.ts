import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * API 성능 메트릭 수집 인터셉터.
 *
 * 요청별 응답시간, 상태코드, 경로를 로깅합니다.
 * /api/v1/health/metrics 엔드포인트에서 집계된 통계를 조회할 수 있습니다.
 */

interface RouteMetric {
  count: number;
  totalMs: number;
  maxMs: number;
  errors: number;
  lastAt: number;
}

// 인메모리 메트릭 저장 (간단한 APM)
const metrics: Map<string, RouteMetric> = new Map();
let totalRequests = 0;
let totalErrors = 0;
const startTime = Date.now();

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('APM');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, path } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.recordMetric(method, path, Date.now() - start, false),
        error: () => this.recordMetric(method, path, Date.now() - start, true),
      }),
    );
  }

  private recordMetric(method: string, path: string, durationMs: number, isError: boolean): void {
    // 경로 정규화 (UUID 제거)
    const normalizedPath = `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')}`;

    const existing = metrics.get(normalizedPath) ?? { count: 0, totalMs: 0, maxMs: 0, errors: 0, lastAt: 0 };
    existing.count++;
    existing.totalMs += durationMs;
    existing.maxMs = Math.max(existing.maxMs, durationMs);
    existing.lastAt = Date.now();
    if (isError) existing.errors++;
    metrics.set(normalizedPath, existing);

    totalRequests++;
    if (isError) totalErrors++;

    // 느린 요청 경고 (500ms 이상)
    if (durationMs > 500) {
      this.logger.warn(`Slow request: ${normalizedPath} ${durationMs}ms`);
    }
  }

  /** 메트릭 조회 (health 엔드포인트용) */
  static getMetrics() {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const routes: Array<{ path: string; count: number; avgMs: number; maxMs: number; errors: number }> = [];

    metrics.forEach((m, path) => {
      routes.push({
        path,
        count: m.count,
        avgMs: Math.round(m.totalMs / m.count),
        maxMs: m.maxMs,
        errors: m.errors,
      });
    });

    // 요청 수 내림차순 정렬
    routes.sort((a, b) => b.count - a.count);

    return {
      uptime: uptimeSeconds,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? `${((totalErrors / totalRequests) * 100).toFixed(2)}%` : '0%',
      topRoutes: routes.slice(0, 20),
      slowRoutes: routes.filter(r => r.avgMs > 200).sort((a, b) => b.avgMs - a.avgMs).slice(0, 10),
    };
  }

  /** 메트릭 초기화 */
  static resetMetrics() {
    metrics.clear();
    totalRequests = 0;
    totalErrors = 0;
  }
}
