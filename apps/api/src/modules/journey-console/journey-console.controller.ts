import { Body, Controller, Get, MessageEvent, Param, Post, Query, Sse, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable } from 'rxjs';
import { JourneyService } from '../journey/journey.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JourneyConsoleService } from './journey-console.service';
import { JourneyAnalyticsService } from './journey-analytics.service';
import { JourneyAckService } from './journey-ack.service';
import { JourneyAckDto } from './dto/journey-ack.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// 환자여정 통합 관제 콘솔 — 경영/원무 읽기 집계(EXECUTIVE 권한은 RBAC 매핑 후).
@ApiTags('Journey Console (환자여정 관제)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
@Controller('api/v1/journey-console')
export class JourneyConsoleController {
  constructor(
    private readonly svc: JourneyConsoleService,
    private readonly analytics: JourneyAnalyticsService,
    private readonly acks: JourneyAckService,
    private readonly eventEmitter: EventEmitter2,
    private readonly journey: JourneyService,
  ) {}

  /**
   * (여정 P2-5) 여정 기록 상태 — 발행기가 **이 API 프로세스 시작 이후** 저장·실패·이중 발행 억제·방문 단위 누락을 몇 건 겪었나.
   * 🔴 재시작하면 0 부터다(`since` 를 함께 낸다) — 누적 원장이 아니다. 상태–사건 불일치(감시자 79·80·81)는 감시자 화면이 정본.
   * 운영자 전용(ADMIN) — 경영 열람 역할의 화면이 아니다.
   */
  @Get('recording-health')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '여정 기록 상태 — 발행 저장·실패·이중 발행 억제·방문 단위 누락(프로세스 시작 이후)' })
  recordingHealth() {
    return { data: this.journey.emitStats() };
  }

  /**
   * FR-10 실시간 갱신 힌트 SSE — 여정 이벤트가 저장되면 `{type:'refresh', at}` 을 보낸다(수신 측은 board·kpi 재조회).
   *
   * 🔴 인가는 **클래스 가드**(JwtAuthGuard·RolesGuard = CanActivate)가 응답 시작 **전에** 한다 — `@Sse` 는 헤더를 먼저 보내므로
   *    핸들러 안 검사로는 인증 실패가 200+빈 스트림이 된다(sse-auth-honesty). 이 핸들러에는 인가 분기를 두지 않는다.
   * 🔴 환자 식별 정보를 싣지 않는다 — 유형·시각도 싣지 않고 "무언가 바뀌었다"만. 화면은 권한 있는 조회 EP 로 다시 읽는다.
   * 과부하 방지: 이벤트가 몰려도 5초에 한 번만 보낸다(여러 발행을 한 힌트로 합침). 프록시 idle 방지 하트비트 25초.
   */
  @Sse('stream')
  @ApiOperation({ summary: '관제 실시간 갱신 힌트 SSE — 여정 이벤트 저장 시 refresh(환자 정보 없음·5초 합침)' })
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let pending: ReturnType<typeof setTimeout> | null = null;
      const onSaved = () => {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          subscriber.next({ data: { type: 'refresh', at: new Date().toISOString() } });
        }, 5000);
      };
      this.eventEmitter.on(JourneyService.SAVED_EVENT, onSaved);
      const heartbeat = setInterval(() => subscriber.next({ data: { type: 'heartbeat' } }), 25000);
      return () => {
        clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        this.eventEmitter.off(JourneyService.SAVED_EVENT, onSaved);
      };
    });
  }

  @Get('analytics')
  @ApiOperation({ summary: '이탈/지연 분석 — 단계별 체류·병목·SLA 위반(외래/응급/입원)' })
  async getAnalytics(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.analytics.getFlowAnalytics({ from, to }) };
  }

  @Get('board')
  @ApiOperation({ summary: '흐름 보드 — 외래/입원/응급 단계별(ERP 무호출). track=ALL|OPD|IPD|ER' })
  async board(
    @CurrentUser('role') role: string,
    @Query('track') track?: string,
    @Query('dept') dept?: string,
    @Query('ward') ward?: string,
    @Query('insuranceType') insuranceType?: string,
    @Query('minStayMin') minStayMin?: string,
    @Query('minUnpaid') minUnpaid?: string,
  ) {
    return { data: await this.svc.getBoard({ track, dept, ward, insuranceType, minStayMin: minStayMin ? Number(minStayMin) : undefined, minUnpaid: minUnpaid ? Number(minUnpaid) : undefined }, role === 'EXECUTIVE') };
  }

  @Get('kpi')
  @ApiOperation({ summary: '경영 KPI — 활성·대기·미수납·매출·임계알림' })
  async kpi() {
    return { data: await this.svc.getKpi() };
  }

  /**
   * 지연 **확인·조치 기록**.
   *
   * 🔴 **확인은 지연을 숨기지 않는다** — 카드는 그대로 지연이고 확인 사실이 덧붙는다.
   * 🔴 **확인은 만료된다** — 그 지연을 판정한 임계와 같은 시간만 유효하다.
   *    (한 번 확인하고 잊는 것을 막는다. 여러 지연이 겹치면 **가장 짧은 임계**를 따른다.)
   * 🔴 **EXECUTIVE 는 쓰지 못한다** — 경영 열람 역할이다.
   */
  @Post('ack')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '지연 확인·조치 기록 — 지연 표시는 그대로 남는다' })
  async ack(@Body() body: JourneyAckDto, @CurrentUser('id') userId: string) {
    const th = await this.svc.thresholdsForAck();
    return { data: await this.acks.ack(body, userId, th) };
  }

  @Get('view/:patientId')
  @ApiOperation({ summary: '드릴다운 열람 감사(P5) — 환자 여정·진료비 열람 기록' })
  async view(@CurrentUser('id') userId: string, @Param('patientId', ParseUUIDPipe) patientId: string) {
    this.svc.auditPatientView(userId, patientId);
    return { data: { ok: true } };
  }
}
