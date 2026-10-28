import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PatientAccountRequest } from '../../../common/interfaces/portal-request.interface';
import { PatientAuthService } from '../patient-auth.service';
import { PortalService } from '../../portal/portal.service';

@Injectable()
export class PatientAccountAuthGuard implements CanActivate {
  constructor(
    private readonly authService: PatientAuthService,
    // 🔴 PortalService 를 생성자로 받지 않는다 — 이 가드는 MobileModule 컨트롤러에서도 쓰여 의존이 그 모듈로 번진다
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PatientAccountRequest>();
    const authHeader = req.headers['authorization'] as string;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('인증이 필요합니다.');
    }

    const token = authHeader.slice(7);
    let verified: Awaited<ReturnType<PatientAuthService['verifyAccessToken']>>;
    try {
      verified = await this.authService.verifyAccessToken(token);
    } catch (e) {
      // 🔴 (2026-10-19 v4.93.2) 등록번호(MRN+생년월일)·보호자 위임 세션은 **살아 있는 세션**인데 계정 전용 기능이 없을 뿐이다.
      //    종전엔 401 을 줘 포털이 "세션이 만료되었습니다 · 다시 로그인"을 그렸다(사용자 신고 — 내 정보 탭 3칸).
      //    401 = 세션 끝, 403 PATIENT_ACCOUNT_REQUIRED = 계정으로 로그인해야 쓰는 기능 — 두 사실을 가른다.
      if (await this.isLivePortalSession(token)) {
        throw new ForbiddenException({ code: 'PATIENT_ACCOUNT_REQUIRED', message: '휴대폰 번호로 가입한 계정으로 로그인하면 이용할 수 있습니다.' });
      }
      throw e;
    }

    // 기존 포털 API와 동일한 인터페이스
    req.portalPatientId = verified.patientId;
    req.patientAccountId = verified.accountId;
    return true;
  }

  private async isLivePortalSession(token: string): Promise<boolean> {
    const portal = this.moduleRef.get(PortalService, { strict: false });
    if (!portal) return false;
    try {
      await portal.resolveAuth(token);
      return true;
    } catch {
      return false;
    }
  }
}
