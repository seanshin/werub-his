import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PortalService } from './portal.service';

/**
 * 🔴 공개 검진 안내 — 2026-09-01.
 *
 * 종전 `/portal/checkup-programs` 는 summary 에 "(공개)"라 적혔고 서비스 이름도
 * `getPublicCheckupPrograms` 였지만, **클래스 가드(PortalOrPatientGuard)가 덮어 401** 이었다 —
 * "공개"라 적은 것과 공개인 것은 다른 일이다(클래스 @Roles 가 핸들러를 덮는 함정의 가드판).
 * 그래서 홈페이지 검진 페이지가 무인증으로 부르다 401 을 받고 `data ?? []` 로
 * **실패를 빈 목록으로 번역** — 검진 프로그램이 개통 이래 항상 비어 보였다.
 *
 * 검진 상품 목록·날짜별 잔여 수량은 PHI 가 아니다(환자 지목 없음) → public 네임스페이스가 정답.
 * 포털 경로는 그대로 두고(포털 화면 소비처 유지), 공개 소비처는 여기로 온다 — 구현은 같은
 * PortalService 정본 하나다(정본이 둘이면 갈라진다).
 */
@ApiTags('Public')
@Controller('api/v1/public')
export class PortalPublicCheckupController {
  constructor(private readonly svc: PortalService) {}

  @Get('checkup-programs')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  @ApiOperation({ summary: '검진 프로그램 목록 (공개 — 홈페이지 안내용)' })
  async getCheckupPrograms() {
    return { data: await this.svc.getPublicCheckupPrograms() };
  }

  @Get('checkup-capacity')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  @ApiOperation({ summary: '검진 날짜별 잔여 용량 (공개 — 예약 가능일 안내용)' })
  async getCheckupCapacity(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.svc.getCheckupCapacity(from, to) };
  }
}
