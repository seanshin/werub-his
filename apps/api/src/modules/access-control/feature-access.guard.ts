import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_FEATURE } from './require-feature.decorator';
import { FeatureAccessService } from './feature-access.service';

/**
 * @RequireFeature(key) 가 부착된 핸들러의 진입 권한을 중앙 판정한다.
 * JwtAuthGuard 가 선행되어 req.user({ id, role }) 가 채워져 있어야 한다.
 */
@Injectable()
export class FeatureAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const featureKey = this.reflector.getAllAndOverride<string>(REQUIRE_FEATURE, [ctx.getHandler(), ctx.getClass()]);
    if (!featureKey) return true; // 데코레이터 없으면 통과

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new UnauthorizedException();

    const ok = await this.featureAccess.can(user.id, user.role, featureKey);
    if (!ok) throw new ForbiddenException(`기능 접근 권한 없음: ${featureKey}`);
    return true;
  }
}
