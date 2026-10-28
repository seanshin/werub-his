import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { AgentSessionService } from './agent-session.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateAgentSessionDto, SendAgentMessageDto } from './dto/agent-session.dto';

/**
 * HIS 내부 (인증 필요)
 *
 * 🔴 (2026-09-16 K3) 세 핸들러 모두 ADMIN·NURSE 뿐이라 **접수 데스크의 주 사용자인 원무가 403** 이었다.
 *    이 세션의 채널은 `HIS_RECEPTION`(접수 AI 상담)이고 부르는 화면은 `/reception`(nav: ADMIN·NURSE·RECEPTIONIST)의
 *    `AiReceptionChat` 이다 — 원무가 열면 상담창이 열리지 않았다.
 *    🔴 아무도 못 본 이유: 정적 스캐너는 `reception/components/` **하위 폴더를 읽지 않았고**(EP 0개로 잡혔다),
 *    실로그인 프로브는 **쓰기를 부르지 않는다**. 두 도구가 반대 방향으로 눈이 멀어 이 자리가 비어 있었다.
 */
@ApiTags('Agent Session')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/agent')
export class AgentSessionController {
  constructor(private readonly service: AgentSessionService) {}

  @Post('session')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '에이전트 세션 시작' })
  async createSession(@Body() body: CreateAgentSessionDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createSession(body.channel ?? 'HIS_RECEPTION', userId) };
  }

  @Post('session/:sessionId/message')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '에이전트 메시지 전송' })
  async sendMessage(@Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() body: SendAgentMessageDto) {
    return { data: await this.service.processMessage(sessionId, body.message) };
  }

  @Get('session/:sessionId')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '세션 상태 조회' })
  async getSession(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return { data: await this.service.getSession(sessionId) };
  }
}

/**
 * 인터넷 예약 (공개, 인증 불필요).
 *
 * 🔴 2026-08-19: 이 공개 EP 가 **MRN 한 줄에 알레르기·활성 문제목록·최근 진료를 반환**하고 있었다.
 *    이름 검색은 최대 5명의 `이름(MRN) 생년 성별` 목록을 냈다. 본인확인 절차가 없었고,
 *    무인증이라 감사 인터셉터(`user.id` 없으면 return)도 탈락해 조회 기록조차 남지 않았다.
 *    → 서비스에 **공개 채널 본인확인 게이트**(MRN+생년월일 2요소·실패 응답 동일화·시도 상한)를 넣고,
 *      공개 응답에서 임상정보를 분리했다(`isPublicSession`·`verifyPublicIdentity`).
 *
 * 🔴 스로틀은 이 EP 의 유일한 방어선이다 — 신원 대입 시도가 곧 메시지 전송이므로 낮게 잡는다.
 */
@ApiTags('Online Booking')
@Controller('api/v1/booking')
export class BookingController {
  constructor(private readonly service: AgentSessionService) {}

  @Post('session')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '예약 세션 시작 (공개)' })
  async createSession() {
    return { data: await this.service.createSession('WEB_BOOKING') };
  }

  @Post('session/:sessionId/message')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 신원 대입 시도 = 메시지 전송이라 낮게 잡는다
  @ApiOperation({ summary: '예약 대화 (공개)' })
  async sendMessage(@Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() body: SendAgentMessageDto) {
    return { data: await this.service.processMessage(sessionId, body.message) };
  }

  @Get('session/:sessionId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '예약 세션 조회 (공개)' })
  async getSession(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return { data: await this.service.getSession(sessionId) };
  }

  @Post('enhanced')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '고품질 AI 응답 — 멀티모델 파이프라인 (공개)' })
  async enhancedChat(@Body() body: { message: string; sessionId?: string }) {
    return { data: await this.service.enhancedChat(body.message) };
  }

  @Get('common-symptoms')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '자주 묻는 증상 목록 (공개)' })
  async getCommonSymptoms() {
    return { data: await this.service.getCommonSymptoms() };
  }
}
