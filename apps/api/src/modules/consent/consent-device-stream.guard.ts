import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConsentDeviceService } from './consent-device.service';

/**
 * 동의서 태블릿 스트림 인가 — 🔴 **가드로 해야 한다.**
 *
 * 종전엔 `@Sse` 핸들러 안에서 인가를 보고 실패 시 `EMPTY` 를 흘렸다.
 * 그래서 **HTTP 200 + 빈 스트림**이 나갔고, 브라우저 `EventSource` 는 그것을
 * **"연결 성공"** 으로 읽어 secret 이 낡은 태블릿이 **영원히 이벤트를 기다렸다**.
 *
 * 🔴 **핸들러 안에서 예외를 던지는 것으로는 고쳐지지 않는다**(2026-08-29 실측).
 *    `@Sse` 는 **응답 헤더를 먼저 보내고** 옵저버블을 구독한다 —
 *    그 뒤에 던지면 상태 코드는 **이미 200** 이다. 운영에 배포해 눌러보고서야 알았다.
 *    → 인가는 **응답이 시작되기 전**에 끝나야 하고, 그 자리가 **가드**다.
 *
 * 🔴 데이터가 새던 문제는 아니었다(인가 판정 자체는 정확했다).
 *    고치는 것은 **실패를 실패라고 말하는 것**이다.
 */
@Injectable()
export class ConsentDeviceStreamGuard implements CanActivate {
  constructor(private readonly svc: ConsentDeviceService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ params?: Record<string, string>; query?: Record<string, string> }>();
    const deviceUid = req.params?.deviceUid;
    const secret = req.query?.secret;
    if (!deviceUid || !(await this.svc.authorizeStream(deviceUid, secret))) {
      throw new UnauthorizedException('기기 인증 실패 — 단말을 다시 등록하세요');
    }
    return true;
  }
}
