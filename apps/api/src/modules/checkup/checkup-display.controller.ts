import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CheckupService } from './checkup.service';

/**
 * 검진 대기 안내 TV 보드 — **의도된 공개 EP**(대기실 TV·로그인 없는 브라우저).
 *
 * 🔴 2026-08-13 W5: 종전엔 이 보드가 인증(`PATIENT_VIEW`)을 요구해, 대기실 TV 를 운영하려면
 *    브라우저에 **스태프 토큰을 상주**시켜야 했다. 그 토큰이면 전 환자 차트에 닿는다 —
 *    인증을 요구해서 오히려 더 위험한 구조였다. ER 흐름·외래 호출 전광판과 같은 규약으로 통일한다:
 *    **무인증 공개 + 서버 마스킹 + 필드 화이트리스트 + 계약 테스트**.
 */
@ApiTags('Checkup Display (Public)')
@Controller('api/v1/checkup/public')
export class CheckupDisplayController {
  constructor(private readonly checkupService: CheckupService) {}

  @Get('display')
  @ApiOperation({ summary: '검진 대기 보드(공개 TV) — 마스킹 이름·프로그램·단계만(결과·소견 없음)' })
  async display() {
    return { data: await this.checkupService.getDisplayData() };
  }
}
