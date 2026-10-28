import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Sse,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Observable, interval, switchMap, from, fromEvent, merge, map } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { WaitingQueueService } from './waiting-queue.service';
import { CallPatientDto } from './dto/call-patient.dto';
import { UpdateQueueDto } from './dto/update-queue.dto';
import { QueueCheckInDto } from './dto/check-in.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Waiting Queue')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/queue')
export class WaitingQueueController {
  constructor(
    private readonly service: WaitingQueueService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // 접수데스크·진료실 대기 실시간 신호(SSE) — 대기열 변경 시 즉시 발화, FE는 신호 수신 시 재조회.
  // (EventSource는 헤더 인증 불가 → FE는 subscribeSseSignal(fetch-streaming) 사용)
  // 🔴 (2026-09-16 E3) 대기열은 환자 식별(이름·번호)이 실린다 — 접수·진료 3역할 + 관리자만.
  //    쓰기(접수·호출·취소)는 이미 이 집합인데 조회·통계·SSE 만 전 직원이었다.
  //    소비 화면: /clinic-queue(ADMIN·DOCTOR·NURSE·RECEPTIONIST)·/reception(ADMIN·NURSE·RECEPTIONIST)·간호 대시보드.
  //    `@Sse` 는 헤더 선전송이라 CanActivate 가드(RolesGuard)만 유효하다.
  @Sse('events')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  events(): Observable<{ data: unknown }> {
    return merge(
      fromEvent(this.eventEmitter, 'queue.changed').pipe(map((p) => ({ data: p }))),
      interval(30000).pipe(map(() => ({ data: { heartbeat: true } }))), // keep-alive
    );
  }

  @Post('check-in')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST) // 접수는 원무·간호·관리자 — 비접수 역할의 대기열 생성 차단
  @ApiOperation({ summary: '접수 (예약 or walk-in)' })
  async checkIn(
    @Body() body: QueueCheckInDto,
  ) {
    return { data: await this.service.checkIn(body) };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '대기열 조회' })
  async findAll(
    @Query('department') department?: string,
    @Query('doctorId') doctorId?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
  ) {
    return { data: await this.service.findAll({ department, doctorId, status, date }) };
  }

  @Get('my')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '내 대기열 (의사/간호사/관리자용)' })
  async findMyQueue(@CurrentUser('id') userId: string) {
    return { data: await this.service.findMyQueue(userId) };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '대기 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  @Patch(':id/call')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({
    summary: '환자 호출 (WAITING -> CALLED)',
    description:
      '`notifyPatient: true` 이면 환자 앱 푸시도 시도한다(설정이 켜져 있을 때만). ' +
      '응답 `data.patientPush = { attempted, sent, reason }` 이 무슨 일이 있었는지 그대로 말한다 — ' +
      '화면은 이 값을 지어내지 말고 그대로 보여준다.',
  })
  async callNext(@Param('id', ParseUUIDPipe) id: string, @Body() dto?: CallPatientDto) {
    return { data: await this.service.callNext(id, { notifyPatient: dto?.notifyPatient === true }) };
  }

  @Patch(':id/start')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '진료 시작 (CALLED -> IN_CONSULTATION)' })
  async startConsultation(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.startConsultation(id) };
  }

  @Patch(':id/complete')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '진료 완료' })
  async complete(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.complete(id) };
  }

  @Patch(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST) // 접수 취소도 원무·간호·관리자
  @ApiOperation({ summary: '접수 취소' })
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.cancel(id) };
  }

  @Patch(':id/no-show')
  // 🔴 (2026-09-16 K3) 바로 위 `:id/cancel` 은 "접수 취소도 원무·간호·관리자"라며 원무를 넣었는데
  //    미방문만 빠져 있었다 — 환자가 오지 않은 것을 아는 자리는 접수 데스크다. 두 화면(`/reception`·
  //    `/clinic-queue`) 모두 nav 에 원무가 있고 두 곳 다 이 버튼을 그린다.
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '미방문 처리' })
  async noShow(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.noShow(id) };
  }

  @Patch(':id/restore')
  // 취소·미방문을 누를 수 있는 역할과 같은 집합(원무 포함) — 누른 사람이 되돌릴 수 있어야 한다
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '취소·미방문 되돌리기(오늘·진료 미시작·중복 접수 없음)' })
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.restore(id) };
  }

  @Post('auto-close-stale')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '묵은 대기 즉시 마감 — config reception.staleQueueAutoCloseHours 기준(0=OFF·매일 새벽 자동)' })
  async autoCloseStale() {
    return { data: await this.service.autoCloseStaleQueues() };
  }

  // 리터럴 라우트 선점 방지 — ':id' 단독 매칭은 반드시 마지막에 선언
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '접수 정정 (진료과/의사/유형/사유 — 대기·호출 상태만)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateQueueDto,
  ) {
    return { data: await this.service.update(id, body) };
  }
}
