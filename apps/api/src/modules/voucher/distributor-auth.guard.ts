import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { DistributorAuthService } from './distributor-auth.service';

/**
 * 딜러 별도 포털 가드 — staff/portal 가드와 분리(독립 인증주체, typ=distributor).
 * req.distributor 주입. 상태 ACTIVE 아니면 차단(정지/해지 딜러 거래 동결).
 */
@Injectable()
export class DistributorAuthGuard implements CanActivate {
  constructor(private readonly auth: DistributorAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const h = req.headers?.authorization as string | undefined;
    if (!h?.startsWith('Bearer ')) throw new UnauthorizedException();
    const principal = await this.auth.verify(h.slice(7));
    if (principal.status !== 'ACTIVE') throw new ForbiddenException(`딜러 상태 ${principal.status} — 거래 불가`);
    req.distributor = principal;
    return true;
  }
}

/** 딜러 스코프 검증 — 타 딜러 리소스 접근 차단(IDOR). */
export function assertDistributorScope(req: { distributor?: { distributorId: string } }, ownerDistributorId: string) {
  if (!req.distributor || req.distributor.distributorId !== ownerDistributorId)
    throw new ForbiddenException('다른 딜러의 리소스에 접근할 수 없습니다');
}
