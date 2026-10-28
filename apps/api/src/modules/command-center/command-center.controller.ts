import { Controller, Get, Query, Sse, UseGuards, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommandCenterService } from './command-center.service';
import { CommandCenterSpaceService } from './command-center-space.service';
import { CommandCenterTrendService } from './command-center-trend.service';

/** 즉시 갱신 힌트 대상 이벤트 → 카드 도메인 (초 단위 인지가 필요한 위급 신호만) */
const REFRESH_EVENTS: Record<string, string> = {
  'lab.critical.value': 'diagnostics',
  'ews.recorded': 'nursing',
};

@ApiTags('통합 상황판')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
@Controller('api/v1/command-center')
export class CommandCenterController {
  constructor(
    private readonly svc: CommandCenterService,
    private readonly space: CommandCenterSpaceService,
    private readonly trendSvc: CommandCenterTrendService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: '7개 현장 보드 요약 집계(1요청·역할 필터·부분 실패 허용) + 통합 KPI' })
  async summary(@CurrentUser('role') role: string) {
    return { data: await this.svc.getSummary(role) };
  }

  @Get('space-load')
  @ApiOperation({ summary: '3D 건물 보기 — 진료실 대기·검진 스테이션 부하(업무 원장) · 공간에 못 놓는 대기는 따로 센다 · 집계만' })
  async spaceLoad() {
    return { data: await this.space.spaceLoad() };
  }

  @Get('trend')
  @ApiOperation({ summary: '상단 지표 이력(5분 칸 · 기본 24시간 · 최대 168) — 서버가 남긴 값만 · 실패 칸은 null · 기록 시작 시각 동봉 · 역할 섹션 필터' })
  async trend(@CurrentUser('role') role: string, @Query('hours') hours?: string) {
    return { data: await this.trendSvc.trend(role, hours) };
  }

  @Sse('stream')
  @ApiOperation({ summary: '즉시 갱신 힌트 SSE — 위급값·EWS 발생 시 {domain} push (수신 측은 summary 재조회)' })
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const handlers = Object.entries(REFRESH_EVENTS).map(([event, domain]) => {
        const h = () => subscriber.next({ data: { type: 'refresh', domain, at: new Date().toISOString() } });
        this.eventEmitter.on(event, h);
        return [event, h] as const;
      });
      // 프록시 idle timeout 방지 하트비트
      const heartbeat = setInterval(() => subscriber.next({ data: { type: 'heartbeat' } }), 25000);
      return () => {
        clearInterval(heartbeat);
        for (const [event, h] of handlers) this.eventEmitter.off(event, h);
      };
    });
  }
}
