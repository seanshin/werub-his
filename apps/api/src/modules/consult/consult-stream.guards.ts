import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConsultService } from './consult.service';

/**
 * 🔴 상담 SSE 소유권/스코프 인가를 **응답 시작 전**에 끝낸다 (2026-08-31).
 *
 * `@Sse` 는 응답 헤더(200)를 먼저 보내고 옵저버블을 구독한다 — 그래서 소유권 검사를
 * 핸들러의 `defer(...)` 안에서 하면, 거부돼도 상태 코드는 **이미 200**이고 스트림만 끊긴다.
 * EventSource 는 200 뒤 끊김을 "일시 오류"로 보고 **자동 재접속 루프**를 돈다(403 이면 영구 중단).
 * → 인가를 `CanActivate` 가드로 올려 실제로 403/404 가 나가게 한다.
 * (데이터 누출은 종전에도 없었다 — switchMap 이 스트림을 게이팅했다. 이 가드는 **상태·재접속**을 고친다.)
 * 근거: consent-device SSE 동일 유형(커밋 2978a7ff). 가드는 authz 메서드를 **실제로 호출**한다.
 */
@Injectable()
export class ConsultPortalStreamGuard implements CanActivate {
  constructor(private readonly svc: ConsultService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const id = req.params?.id;
    const patientId = req.portalPatientId;
    // 본인 세션 아니면 getSessionInfo→ensure 가 Forbidden/NotFound 를 던진다(응답 시작 전).
    await this.svc.getSessionInfo(id, patientId);
    return true;
  }
}

@Injectable()
export class ConsultStaffStreamGuard implements CanActivate {
  constructor(private readonly svc: ConsultService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const id = req.params?.id;
    const isAdmin = req.consultAgent?.role === 'ADMIN' || req.user?.role === 'ADMIN';
    const teamId = req.consultAgent?.teamId ?? null;
    // 팀 스코프 미일치면 assertScope 가 Forbidden 을 던진다(응답 시작 전).
    await this.svc.assertScope(id, { teamId, isAdmin });
    return true;
  }
}
