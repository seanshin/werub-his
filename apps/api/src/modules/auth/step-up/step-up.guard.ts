import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StepUpService } from './step-up.service';
import { STEP_UP_ACTION, hashBody } from './require-step-up.decorator';

// JwtAuthGuard 이후에 사용. 헤더 x-step-up-token 을 검증하고 1회 소비(FR-10).
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly stepUp: StepUpService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<string>(STEP_UP_ACTION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!action) return true; // 데코레이터 없으면 통과

    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('인증이 필요합니다.');

    const token = req.headers['x-step-up-token'];
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException({ code: 'STEPUP_REQUIRED', message: '생체 재인증이 필요합니다.' });
    }

    await this.stepUp.consume(token, userId, action, {
      resourceId: req.params?.id,
      bodyHash: hashBody(req.body),
    });
    return true;
  }
}
