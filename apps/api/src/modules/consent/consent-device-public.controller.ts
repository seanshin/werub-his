import { Body, Controller, Get, MessageEvent, Param, Post, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { ConsentDeviceService } from './consent-device.service';
import { ConsentDeviceEnrollDto, ConsentDeviceSignedDto } from './dto/consent-public.dto';
import { ConsentDeviceStreamGuard } from './consent-device-stream.guard';

// 공개(태블릿) — 고정 링크 /consent-device. deviceUid + deviceSecret 기반, 직원 로그인 불필요
@ApiTags('Consent Device (Public)')
@Controller('api/v1/consent-device')
export class ConsentDevicePublicController {
  constructor(private readonly svc: ConsentDeviceService) {}

  @Post('enroll')
  @ApiOperation({ summary: '태블릿 자가 등록(code 있으면 자동 승인). deviceSecret 반환' })
  async enroll(@Body() body: ConsentDeviceEnrollDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent']?.slice(0, 300);
    return { data: await this.svc.enroll({ deviceUid: body?.deviceUid, name: body?.name, code: body?.code, secret: body?.secret, userAgent }) };
  }

  @Get(':deviceUid')
  @ApiOperation({ summary: '태블릿 상태 조회 (secret로 currentToken 보호)' })
  async state(@Param('deviceUid') deviceUid: string, @Query('secret') secret?: string) {
    return { data: await this.svc.getDeviceState(deviceUid, secret) };
  }

  @Sse(':deviceUid/stream')
  @ApiOperation({ summary: '태블릿 실시간 스트림(approved/dispatch/cleared) — secret 인가' })
  /**
   * 🔴 **인증 실패를 빈 스트림으로 말하지 않는다**(2026-08-29 실측).
   *
   *    종전엔 인가 실패 시 `EMPTY` 를 흘려 **HTTP 200 + 빈 스트림**이 나갔다.
   *    브라우저 `EventSource` 는 그것을 **"연결 성공"** 으로 읽는다 —
   *    secret 이 낡은 태블릿은 오류 없이 **영원히 이벤트를 기다린다**(화면은 정상으로 보인다).
   *    데이터가 새지는 않았으나, **실패를 "아직 이벤트가 없음"으로 번역**하는 코드였다.
   *
   * 🔴 같은 서비스의 `deviceSigned()` 는 같은 인증 실패를 **예외로 던진다** —
   *    한 인증 실패를 두 가지로 말하고 있었다. 스트림도 같은 말을 하게 맞춘다.
   *    `EventSource` 는 비‑200 을 `onerror` 로 받아 **재연결/안내**를 할 수 있다.
   */
  @UseGuards(ConsentDeviceStreamGuard)
  stream(@Param('deviceUid') deviceUid: string): Observable<MessageEvent> {
    // 🔴 인가는 **가드**가 끝냈다 — 여기서 보면 이미 헤더가 나간 뒤라 200 이 박힌다
    return this.svc.getDeviceStream(deviceUid) as unknown as Observable<MessageEvent>;
  }

  @Post(':deviceUid/heartbeat')
  @ApiOperation({ summary: '온라인 하트비트' })
  async heartbeat(@Param('deviceUid') deviceUid: string) {
    return { data: await this.svc.heartbeat(deviceUid) };
  }

  @Post(':deviceUid/signed')
  @ApiOperation({ summary: '서명 완료 통지(대기 복귀) — secret 검증' })
  async signed(@Param('deviceUid') deviceUid: string, @Body() body: ConsentDeviceSignedDto) {
    return { data: await this.svc.deviceSigned(deviceUid, body?.secret) };
  }
}
