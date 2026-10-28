import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { PortalRequest } from '../../../common/interfaces/portal-request.interface';
import { PortalService } from '../../portal/portal.service';
import { PatientAuthService } from '../patient-auth.service';
import { guardianDenies } from '../../portal/guardian-scope';

// 보호자가 접근할 수 없는 본인 전용 기능 (동의서 서명, 보호자 관리, 프로필 수정 등)
// medication-check: 대리 복약 체크는 기록 무결성 훼손 — 위임 세션 읽기 전용(설계 §6.6)
// documents/request-bundle: F-4 실손보험 서류 세트 신청은 본인 전용(대리 발급은 별도 기획·법무 대기 — 설계 §6.6)
const GUARDIAN_BLOCKED = ['/consents', '/remote-consult/consent', '/guardians', '/profile', '/medication-check', '/documents/request-bundle', '/pre-auth'];

/**
 * 포털(MRN+DOB JWT) / 앱(phone+PW JWT) / 보호자(위임 JWT) 중 하나라도 통과하면 인증 성공.
 * 세 경우 모두 req.portalPatientId에 (피)환자 patientId를 주입.
 * 보호자 토큰이면 접근범위(accessScope) 제어 + 본인전용 차단 + 열람 감사 기록.
 */
@Injectable()
export class PortalOrPatientGuard implements CanActivate {
  constructor(
    private readonly portalService: PortalService,
    private readonly patientAuthService: PatientAuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PortalRequest>();

    // /auth 엔드포인트는 인증 불필요
    if (req.url.includes('/portal/auth') && req.method === 'POST') return true;

    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('인증이 필요합니다.');

    // 1. 앱 JWT (type: patient) 먼저 시도
    try {
      const { accountId, patientId } = await this.patientAuthService.verifyAccessToken(token);
      req.portalPatientId = patientId;
      req.patientAccountId = accountId;
      return true;
    } catch {}

    // 2. 포털 JWT(type: portal) 또는 보호자 위임 JWT(type: guardian)
    let auth: Awaited<ReturnType<PortalService['resolveAuth']>>;
    try {
      auth = await this.portalService.resolveAuth(token);
    } catch {
      throw new UnauthorizedException('인증이 만료되었습니다. 다시 로그인해주세요.');
    }

    req.portalPatientId = auth.patientId;

    if (auth.guardian) {
      // ── 보호자 위임 접근 ──
      req.isGuardianAccess = true;
      req.guardianAccountId = auth.guardian.accountId;
      req.guardianScope = auth.guardian.scope;

      // 본인 전용 기능 차단 (동의서 서명, 보호자 관리, 프로필 수정 등)
      if (GUARDIAN_BLOCKED.some((b) => req.url.includes(b)) && req.method !== 'GET') {
        throw new ForbiddenException('보호자 권한으로는 이용할 수 없는 기능입니다. 본인 계정으로 전환하세요.');
      }

      // accessScope 범위 제어
      // 🔴 정본 `portal/guardian-scope.ts` — fail-closed(키가 없으면 막는다).
      //    종전 `=== false` 는 **생성되지 않는 키(imaging)** 를 통과시켜 게이트가 죽어 있었다.
      if (guardianDenies(auth.guardian.scope, req.url)) {
        throw new ForbiddenException('보호자 열람 범위에 포함되지 않은 정보입니다.');
      }

      // 보호자 열람 감사 기록 (누가/무엇을)
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip;
      this.portalService.logAudit(
        auth.patientId,
        `GUARDIAN_${this.actionName(req.method, req.url)}`,
        req.url,
        ip,
        `GUARDIAN:${auth.guardian.accountId}`,
      ).catch(() => {});
    }

    return true;
  }

  private actionName(method: string, url: string): string {
    if (url.includes('appointments')) return 'VIEW_APPOINTMENTS';
    if (url.includes('encounters')) return 'VIEW_ENCOUNTERS';
    if (url.includes('lab-results')) return 'VIEW_LAB_RESULTS';
    if (url.includes('diagnostic')) return 'VIEW_DIAGNOSTIC';
    if (url.includes('imaging')) return 'VIEW_IMAGING';
    if (url.includes('billings')) return 'VIEW_BILLINGS';
    if (url.includes('medications')) return 'VIEW_MEDICATIONS';
    return `${method}_${url.split('?')[0].split('/').pop()}`.toUpperCase();
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers['authorization'] as string;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return req.headers['x-portal-token'] as string ?? null;
  }
}
