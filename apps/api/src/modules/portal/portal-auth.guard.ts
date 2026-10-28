import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { PortalService } from './portal.service';
import { guardianDenies } from './guardian-scope';

// 보호자가 접근할 수 없는 본인 전용 기능 (동의서 서명, 보호자 관리 등)
const GUARDIAN_BLOCKED = ['/consents', '/remote-consult/consent', '/guardians', '/profile'];

/**
 * 환자 포털 JWT 인증 가드
 * Authorization: Bearer <jwt> 또는 X-Portal-Token 헤더로 JWT 검증
 * 검증 성공 시 req.portalPatientId에 환자 ID 주입
 * 보호자(위임) 토큰이면 피부양자 ID 주입 + 접근범위 제어 + 감사 기록
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(private readonly portalService: PortalService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    // /auth, /auth/logout 엔드포인트는 인증 불필요
    if (req.url.includes('/portal/auth') && req.method === 'POST') {
      return true;
    }

    // JWT 토큰 추출 (Authorization: Bearer 또는 X-Portal-Token)
    let token: string | undefined;
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
    if (!token) {
      token = req.headers['x-portal-token'] as string | undefined;
    }

    if (!token || token.trim() === '') {
      throw new UnauthorizedException('포털 인증이 필요합니다.');
    }

    // JWT 검증 + 세션 확인 (포털 또는 보호자 위임 토큰)
    const auth = await this.portalService.resolveAuth(token);
    (req as any).portalPatientId = auth.patientId;
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip;

    if (auth.guardian) {
      // ── 보호자 위임 접근 ──
      (req as any).isGuardianAccess = true;
      (req as any).guardianAccountId = auth.guardian.accountId;
      (req as any).guardianScope = auth.guardian.scope;

      // 본인 전용 기능 차단 (동의서 서명, 보호자 관리 등)
      if (GUARDIAN_BLOCKED.some((b) => req.url.includes(b)) && req.method !== 'GET') {
        throw new ForbiddenException('보호자 권한으로는 이용할 수 없는 기능입니다. 본인 계정으로 전환하세요.');
      }

      // accessScope 범위 제어
      // 정본 공유 — 지도를 따로 두면 한쪽만 막는 우회로가 생긴다(W9 에서 실제로 그랬다)
      if (guardianDenies(auth.guardian.scope, req.url)) {
        throw new ForbiddenException('보호자 열람 범위에 포함되지 않은 정보입니다.');
      }

      // 보호자 열람 감사 기록 (누가/무엇을)
      this.portalService.logAudit(
        auth.patientId,
        `GUARDIAN_${this.getActionName(req.method, req.url)}`,
        req.url,
        ip,
        `GUARDIAN:${auth.guardian.accountId}`,
      ).catch(() => {});
    } else {
      // ── 본인 접근 ──
      this.portalService.logAudit(
        auth.patientId,
        this.getActionName(req.method, req.url),
        req.url,
        ip,
      ).catch(() => {});
    }

    return true;
  }

  private getActionName(method: string, url: string): string {
    if (url.includes('appointments')) return 'VIEW_APPOINTMENTS';
    if (url.includes('encounters')) return 'VIEW_ENCOUNTERS';
    if (url.includes('lab-results')) return 'VIEW_LAB_RESULTS';
    if (url.includes('diagnostic')) return 'VIEW_DIAGNOSTIC_TESTS';
    if (url.includes('billings')) return 'VIEW_BILLINGS';
    if (url.includes('questionnaire')) return 'VIEW_QUESTIONNAIRES';
    if (url.includes('profile')) return method === 'PUT' ? 'UPDATE_PROFILE' : 'VIEW_PROFILE';
    if (url.includes('documents')) return method === 'POST' ? 'REQUEST_DOCUMENT' : 'VIEW_DOCUMENTS';
    return `${method}_${url.split('/').pop()}`.toUpperCase();
  }
}
