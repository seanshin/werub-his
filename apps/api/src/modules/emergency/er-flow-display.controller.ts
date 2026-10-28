import { Controller, Get, Sse } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Observable, interval, switchMap, from, startWith, map } from 'rxjs';
import { ErFlowDisplayService } from './er-flow-display.service';

/**
 * ER 흐름 TV 보드 — **의도된 공개 EP**(대기실 TV·로그인 없는 브라우저).
 * 외래 호출 전광판(`/api/v1/queue/public/*`) 선례 ③(공개+PHI 강마스킹)과 같은 민감도 계약:
 * 서버가 마스킹·필드 화이트리스트를 강제하고(er-flow-display.service), 계약 테스트가 이를 고정한다.
 * 무가드 컨트롤러 감사 관점: 이 컨트롤러는 공개가 결함이 아니라 사양이다.
 */
@ApiTags('Emergency Flow Display (Public)')
@Controller('api/v1/emergency/public')
export class ErFlowDisplayController {
  constructor(private readonly service: ErFlowDisplayService) {}

  @Get('flow-board')
  @ApiOperation({ summary: 'ER 환자 흐름 보드(공개 TV) — 마스킹 이름·베드·단계만(중증도·주호소·진단 없음)' })
  async flowBoard() {
    return { data: await this.service.getFlowBoard() };
  }

  @Sse('flow-board/stream')
  @ApiOperation({ summary: 'ER 흐름 보드 SSE(공개·10초) — 외래 전광판 publicStream 선례 ③' })
  flowBoardStream(): Observable<{ data: unknown }> {
    return interval(10_000).pipe(
      startWith(0),
      switchMap(() => from(this.service.getFlowBoard().catch(() => null))),
      map((board) => ({ data: board ?? { error: 'unavailable' } })),
    );
  }
}
