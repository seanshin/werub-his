import { CanActivate, ExecutionContext, Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FeatureAccessService } from '../access-control/feature-access.service';
import { CRED_PERMISSION_KEY } from './cred.decorator';

const FEATURE_KEY = 'credential.admin';

// JwtAuthGuard 이후 사용. 자격증명 관리 권한 검사 — ADMIN(부트스트랩·슈퍼) OR per-user grant(미만료).
// FR-40: effectivePermissions = ROLE(ADMIN) ∪ AdminPermissionGrant(userId)
// 기능 접근 매트릭스 연동: 차단(deny) 최우선(시스템 ADMIN 제외), 명시 grant/역할 오버라이드 = 추가 허용.
// 오버라이드 미설정 시 기존 동작 100% 보존.
@Injectable()
export class CredentialGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(CRED_PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || !required.length) return true;

    const { user } = ctx.switchToHttp().getRequest();
    if (!user) throw new UnauthorizedException();

    const isSystemAdmin = user.role === UserRole.ADMIN;
    // 차단 최우선(시스템 ADMIN 제외 = 자기잠금 방지)
    if (!isSystemAdmin && (await this.featureAccess.isDenied(FEATURE_KEY, user.id))) {
      throw new ForbiddenException('자격증명 관리 접근이 차단되었습니다');
    }
    // ADMIN = 부트스트랩·슈퍼유저(분리 강화 시 ROLE_PERMISSIONS 조정으로 제거 가능)
    if (isSystemAdmin) return true;

    const grants = await this.prisma.adminPermissionGrant.findMany({
      where: { userId: user.id, permission: { in: required } },
      select: { expiresAt: true },
    });
    const now = new Date();
    const has = grants.some((g) => !g.expiresAt || g.expiresAt > now);
    if (has) return true;

    // 추가 허용: 관리자가 매트릭스에 명시 설정한 grant/역할이면 통과
    if (await this.featureAccess.isExplicitlyAllowed(FEATURE_KEY, user.id, user.role)) return true;

    throw new ForbiddenException(`자격증명 관리 권한이 없습니다. 필요: ${required.join(', ')}`);
  }
}
