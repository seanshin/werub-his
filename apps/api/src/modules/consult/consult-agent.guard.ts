import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FeatureAccessService } from '../access-control/feature-access.service';
import { CONSULT_ROLE_KEY, CONSULT_SELF_PROBE_KEY, ConsultRoleReq } from './consult-role.decorator';

const RANK: Record<string, number> = { AGENT: 1, LEAD: 2, ADMIN: 3 };
const FEATURE_KEY: Record<string, string> = { ADMIN: 'consult.admin', LEAD: 'consult.lead', AGENT: 'consult.desk' };

/**
 * 상담 데스크 접근 가드 — JwtAuthGuard 뒤단.
 * - 접근 자격 = ConsultAgent 등록(직무 역할이 아닌 상담원 등록 기반).
 * - @ConsultRole 로 LEAD/ADMIN 분기. 계층(ADMIN>LEAD>AGENT).
 * - ADMIN 요구 시 시스템 UserRole.ADMIN 폴백 허용(부트스트랩, 설계 D-4).
 * - req.consultAgent 주입(시스템 ADMIN 폴백 시 null 가능).
 * - 기능 접근 매트릭스 연동(feature-access-matrix):
 *   · 차단 목록(deny) = 최우선(즉시 회수). 시스템 ADMIN은 자기잠금 방지로 제외.
 *   · 명시 grant/역할 오버라이드 = 등록 없이도 추가 허용(관리자가 매트릭스에서 설정한 경우만).
 *   · 오버라이드 미설정 시 기존 등록 기반 동작 100% 보존.
 */
@Injectable()
export class ConsultAgentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.get<ConsultRoleReq>(CONSULT_ROLE_KEY, context.getHandler()) ??
      this.reflector.get<ConsultRoleReq>(CONSULT_ROLE_KEY, context.getClass());

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.id) throw new ForbiddenException('인증 필요');

    const isSystemAdmin = user.role === UserRole.ADMIN;
    const featureKey = FEATURE_KEY[required ?? 'AGENT'];

    // 등록 여부를 묻는 핸들러(@ConsultSelfProbe)는 미등록자도 통과 — 차단 목록은 그대로 우선한다.
    const selfProbe =
      this.reflector.get<boolean>(CONSULT_SELF_PROBE_KEY, context.getHandler()) ?? false;
    if (selfProbe) {
      if (!isSystemAdmin && (await this.featureAccess.isDenied(featureKey, user.id))) {
        throw new ForbiddenException({ code: 'CONSULT_FORBIDDEN', message: '상담 접근이 차단되었습니다' });
      }
      req.consultAgent = await this.prisma.consultAgent.findUnique({ where: { userId: user.id } });
      return true;
    }

    // 차단 최우선(시스템 ADMIN 제외 = 자기잠금 방지)
    if (!isSystemAdmin && (await this.featureAccess.isDenied(featureKey, user.id))) {
      throw new ForbiddenException({ code: 'CONSULT_FORBIDDEN', message: '상담 접근이 차단되었습니다' });
    }

    const agent = await this.prisma.consultAgent.findUnique({ where: { userId: user.id } });
    req.consultAgent = agent ?? null;

    // ADMIN 요구: ConsultAgent.role=ADMIN 또는 시스템 ADMIN 폴백
    if (required === 'ADMIN') {
      if (agent?.role === 'ADMIN' || isSystemAdmin) return true;
    } else if (required === 'LEAD') {
      // LEAD 요구: LEAD 이상(또는 시스템 ADMIN 폴백)
      if ((agent && RANK[agent.role] >= RANK.LEAD) || isSystemAdmin) return true;
    } else {
      // 미지정(AGENT 이상): 등록된 상담원이면 통과(시스템 ADMIN 부트스트랩 허용)
      if (agent || isSystemAdmin) return true;
    }

    // 추가 허용: 관리자가 매트릭스에 명시 설정한 grant/역할이면 등록 없이도 통과
    if (await this.featureAccess.isExplicitlyAllowed(featureKey, user.id, user.role)) return true;

    // 거부
    if (required === 'ADMIN') throw new ForbiddenException({ code: 'CONSULT_FORBIDDEN', message: '상담 관리자 권한 필요' });
    if (required === 'LEAD') throw new ForbiddenException({ code: 'CONSULT_FORBIDDEN', message: '상담 팀장 권한 필요' });
    throw new ForbiddenException({ code: 'CONSULT_NOT_ENROLLED', message: '상담원으로 등록되지 않았습니다' });
  }
}
