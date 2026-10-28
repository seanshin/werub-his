import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { KioskService } from './kiosk.service';
import { KioskCheckInDto, KioskPayDto } from './dto/kiosk.dto';

/**
 * 무인증(공개) — 병원 내 물리 키오스크 단말.
 *
 * 🔴 2026-08-19: 전역 ThrottlerGuard(기본 600회/분)만 걸려 있었고 본인확인 실패에 잠금이 없었다.
 *    게다가 등록번호 부존재(404)와 생년월일 불일치(400)를 **갈라서 답해** MRN 열거 오라클이었다
 *    → 서비스에서 응답을 하나로 합치고, 여기서 시도 횟수를 낮춘다.
 * 🔴 무인증이라 감사 인터셉터(`user.id` 없으면 return)가 탈락한다 — 조회 기록은 남지 않는다.
 *    남는 것은 이 단말이 만든 행(대기열·수납)뿐이다. 별도 접근 원장은 스키마 제안 대상이다.
 */
@ApiTags('Kiosk')
@Controller('api/v1/kiosk')
export class KioskController {
  constructor(private readonly svc: KioskService) {}

  @Post('check-in')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 본인확인 대입 시도 = 이 호출이다
  @ApiOperation({ summary: '키오스크 접수(등록번호+생년월일 본인확인·예약 기반)' })
  async checkIn(@Body() dto: KioskCheckInDto) {
    return { data: await this.svc.checkIn(dto.mrn, dto.dob) };
  }

  @Post('billing')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 본인확인 대입 시도 = 이 호출이다
  @ApiOperation({ summary: '키오스크 미납 조회(본인확인)' })
  async getBilling(@Body() dto: KioskCheckInDto) {
    return { data: await this.svc.getBilling(dto.mrn, dto.dob) };
  }

  @Post('pay')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 본인확인 대입 시도 = 이 호출이다
  @ApiOperation({ summary: '키오스크 수납(미납 전액 결제)' })
  async pay(@Body() dto: KioskPayDto) {
    return { data: await this.svc.pay(dto.mrn, dto.dob, dto.method ?? 'CARD') };
  }
}
