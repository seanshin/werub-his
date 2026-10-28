import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, GoneException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * 온보딩 토큰 가드 — 계정 전(前) 단계.
 * raw 토큰(링크/QR)을 sha256 해시해 OnboardingInvite 조회.
 * 만료/폐기 시 차단. 통과 시 req.invite 에 부착.
 * staff JwtAuthGuard 와 분리(라우트 중복 금지).
 */
@Injectable()
export class OnboardingTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const raw: string | undefined = req.params?.token || req.headers['x-onboarding-token'];
    if (!raw) throw new UnauthorizedException('온보딩 토큰이 없습니다.');

    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const invite = await this.prisma.onboardingInvite.findUnique({ where: { tokenHash } });
    if (!invite) throw new UnauthorizedException({ code: 'ONBOARDING_TOKEN_REVOKED', message: '유효하지 않은 초대입니다.' });
    if (invite.status === 'REVOKED') throw new UnauthorizedException({ code: 'ONBOARDING_TOKEN_REVOKED', message: '폐기된 초대입니다.' });
    if (invite.status === 'EXPIRED' || invite.expiresAt < new Date()) {
      throw new GoneException({ code: 'ONBOARDING_TOKEN_EXPIRED', message: '초대가 만료되었습니다. 담당자에게 재발급을 요청하세요.' });
    }
    req.invite = invite;
    return true;
  }
}
