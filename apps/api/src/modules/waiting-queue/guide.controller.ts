import { Controller, Get, Param, NotFoundException, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WaitingQueueService } from './waiting-queue.service';

// R7: 환자 길안내 (공개 — QR 스캔용, 인증 없음, 최소 정보·이름 마스킹)
@ApiTags('guide')
@Controller('api/v1/guide')
export class GuideController {
  constructor(private readonly service: WaitingQueueService) {}

  @Get(':queueId')
  @ApiOperation({ summary: '접수 길안내 (QR)' })
  async get(@Param('queueId') queueId: string) {
    const data = await this.service.getGuide(queueId);
    if (!data) throw new NotFoundException({ code: 'NOT_FOUND', message: '접수 정보를 찾을 수 없습니다.' });
    return { data };
  }

  /** 대기표 길안내(P3) — 주출입구(또는 고른 출입구)에서 진료실까지 · 공간 연결된 진료실만 · 통제 구역 제외 */
  @Get(':queueId/route')
  @ApiOperation({ summary: '대기표 길안내 경로(QR) — 구조화된 단계·층별 경로 점' })
  async route(@Param('queueId') queueId: string, @Query('origin') from?: string, @Query('accessible') accessible?: string) {
    // 🔴 `from` 은 전역 DateQueryPipe 의 날짜 키 — 출입구 id 를 400 으로 막는다(origin 을 쓴다)
    if (from && !/^[A-Za-z0-9-]{1,40}$/.test(from)) throw new NotFoundException({ code: 'ENTRANCE_UNKNOWN', message: '출입구를 찾을 수 없습니다.' });
    const data = await this.service.guideRoute(queueId, from || undefined, accessible === 'true' || accessible === '1');
    if (!data) throw new NotFoundException({ code: 'NOT_FOUND', message: '접수 정보를 찾을 수 없습니다.' });
    return { data };
  }
}
