import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { QueueDisplayService } from './queue-display.service';

/**
 * 전광판 SSE 키 인가 — **가드로** 건다.
 *
 * 🔴 `@Sse` 는 옵저버블을 구독하기 **전에 200 헤더를 보낸다.** 그래서 핸들러 안에서 던지거나
 *    `{ error: ... }` 를 흘려도 `EventSource` 는 "연결 성공"으로 읽는다
 *    (정본: `test/architecture/sse-auth-honesty.spec.ts`).
 *
 * 🔴 그리고 이 EP 는 **키가 없으면 통과**했다(2026-09-02 실측) —
 *    `if (queryKey) { 검증 }` 이라 **틀린 키는 막고 없는 키는 통과**하는 fail-open 이었다.
 *    Swagger 요약에는 'API Key 인증'이라 적혀 있었다. 형제 EP 둘은 실제로 검증한다.
 *    (판정 규칙 §5 "무가드 컨트롤러 — `if(expected && …)`=fail-open")
 *
 * 키 없이 볼 수 있는 안내는 같은 컨트롤러의 공개 EP(`GET stream`)가 이미 제공한다 —
 * 이 자리를 열어 둘 이유가 없다.
 */
@Injectable()
export class DisplayKeyStreamGuard implements CanActivate {
  constructor(private readonly service: QueueDisplayService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const key: string | undefined = req.headers?.['x-display-key'] || req.query?.key;
    if (!key) {
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'X-Display-Key 헤더 또는 key 파라미터가 필요합니다.' });
    }
    if (!(await this.service.validateApiKey(String(key)))) {
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'API Key가 유효하지 않습니다.' });
    }
    return true;
  }
}
