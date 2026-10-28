import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  UnauthorizedException,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Observable, interval, switchMap, from, of } from 'rxjs';
import { QueueDisplayService } from './queue-display.service';
import { DisplayKeyStreamGuard } from './display-key-stream.guard';

@ApiTags('Queue Display (Public)')
@Controller('api/v1/queue/public')
export class QueueDisplayController {
  constructor(private readonly service: QueueDisplayService) {}

  private async validateApiKey(key: string | undefined) {
    if (!key) throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'X-Display-Key 헤더가 필요합니다.' });
    const valid = await this.service.validateApiKey(key);
    if (!valid) throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'API Key가 유효하지 않습니다.' });
  }

  @Get('display')
  @ApiOperation({ summary: '과별 대기 현황 (디스플레이용)' })
  async getDisplay(
    @Headers('x-display-key') apiKey: string,
    @Query('key') queryKey: string,
    @Query('departments') departments?: string,
    @Query('statuses') statuses?: string,
    @Query('limit') limit?: string,
  ) {
    await this.validateApiKey(apiKey || queryKey);
    return this.service.getDisplay({
      departments: departments?.split(',').map(d => d.trim()),
      statuses: statuses?.split(',').map(s => s.trim()),
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('display/call-events')
  @ApiOperation({ summary: '최근 호출 이벤트 (TTS/배너 트리거)' })
  async getCallEvents(
    @Headers('x-display-key') apiKey: string,
    @Query('key') queryKey: string,
    @Query('since') since?: string,
    @Query('departments') departments?: string,
  ) {
    await this.validateApiKey(apiKey || queryKey);
    return this.service.getCallEvents({
      since: since ? new Date(since) : undefined,
      departments: departments?.split(',').map(d => d.trim()),
    });
  }

  /**
   * 🔴 인가는 **가드**로 — `@Sse` 는 헤더를 먼저 보내므로 핸들러 안 검사로는 200 이 이미 나간다.
   *    이전에는 `if (queryKey)` 라 **키가 없으면 그대로 통과**했다(fail-open).
   */
  @Sse('display/stream')
  @UseGuards(DisplayKeyStreamGuard)
  @ApiOperation({ summary: 'SSE 실시간 스트림 (API Key 인증 — 가드)' })
  stream(
    @Query('departments') departments?: string,
  ): Observable<any> {
    const depts = departments?.split(',').map(d => d.trim());
    let lastCallAt: string | null = null;

    return interval(5000).pipe(
      switchMap(() =>
        from(
          (async () => {
            try {
              const display = await this.service.getDisplay({ departments: depts, limit: 20 });
              const callAt = display.data.lastCall?.calledAt ?? null;

              if (callAt && callAt !== lastCallAt) {
                lastCallAt = callAt;
                return {
                  data: { eventType: 'CALLED', ...display.data.lastCall },
                };
              }

              return {
                data: {
                  departments: display.data.departments.map((d) => ({
                    name: d.name,
                    ...d.stats,
                  })),
                },
              };
            } catch {
              return { data: { timestamp: new Date().toISOString() } };
            }
          })(),
        ),
      ),
    );
  }

  @Sse('stream')
  @ApiOperation({ summary: 'SSE 실시간 대기 안내 스트림 (인증 불필요)' })
  publicStream(
    @Query('departments') departments?: string,
  ): Observable<any> {
    const depts = departments?.split(',').map(d => d.trim());
    let lastCallAt: string | null = null;

    return interval(5000).pipe(
      switchMap(() =>
        from(
          (async () => {
            try {
              const display = await this.service.getDisplay({ departments: depts, limit: 20 });
              const callAt = display.data.lastCall?.calledAt ?? null;

              // 환자 호출 이벤트 감지
              if (callAt && callAt !== lastCallAt) {
                lastCallAt = callAt;
                return {
                  data: JSON.stringify({
                    event: 'call',
                    data: display.data.lastCall,
                    timestamp: new Date().toISOString(),
                  }),
                };
              }

              // 전체 대기열 현황
              return {
                data: JSON.stringify({
                  event: 'queue-update',
                  data: {
                    departments: display.data.departments.map((d) => ({
                      name: d.name,
                      queues: d.queues,
                      ...d.stats,
                    })),
                    totalStats: display.data.totalStats,
                  },
                  timestamp: new Date().toISOString(),
                }),
              };
            } catch {
              return {
                data: JSON.stringify({
                  event: 'queue-update',
                  data: null,
                  timestamp: new Date().toISOString(),
                }),
              };
            }
          })(),
        ),
      ),
    );
  }

  @Get('ticket/:queueId')
  @ApiOperation({ summary: '대기번호표 데이터' })
  async getTicket(
    @Headers('x-display-key') apiKey: string,
    @Query('key') queryKey: string,
    @Param('queueId') queueId: string,
  ) {
    await this.validateApiKey(apiKey || queryKey);
    return this.service.getTicket(queueId);
  }

  @Get('waiting/:token')
  @ApiOperation({ summary: '환자 모바일 대기 확인 (토큰 기반)' })
  async getWaiting(@Param('token') token: string) {
    return this.service.getWaiting(token);
  }

  @Get('stats')
  @ApiOperation({ summary: '과별 통계' })
  async getStats(
    @Headers('x-display-key') apiKey: string,
    @Query('key') queryKey: string,
    @Query('departments') departments?: string,
  ) {
    await this.validateApiKey(apiKey || queryKey);
    return this.service.getPublicStats(departments?.split(',').map(d => d.trim()));
  }

  @Get('departments')
  @ApiOperation({ summary: '오늘 운영중 진료과 목록' })
  async getDepartments(
    @Headers('x-display-key') apiKey: string,
    @Query('key') queryKey: string,
  ) {
    await this.validateApiKey(apiKey || queryKey);
    return this.service.getDepartments();
  }
}
