import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StepUpService } from './step-up.service';
import { STEP_UP_ACTION, hashBody } from './require-step-up.decorator';
import { ConfigRuntimeService } from '../../config/config-runtime.service';

// config 게이트 step-up 가드 (단말 제로트러스트 ② Tier2 Step E).
// @RequireStepUp('ACTION') + 본 가드를 고위험 엔드포인트에 적용하되,
//   **config `terminal.stepUpActions` 에 등록된 액션만 실제 강제**(기본 미설정=OFF·진료 무중단).
//   강제 시 x-step-up-token 없으면 403 STEPUP_REQUIRED(details=action/resourceId) → FE 가 스마트폰 푸시
//   생체승인 모달(StepUpApprovalPrompt) → 폰 승인 토큰으로 재시도.
// 🛡️ 단계적 활성화(환자안전): `terminal.stepUpPilotUserIds`(["*"]=전체)에 든 사용자만 강제(파일럿).
//   비대상=무중단 통과. 파일럿이어도 **패스키 미보유면 step-up 불가 → fail-safe 통과**(생명직결 처방
//   영구차단 금지). 운영은 준비된 의사만 파일럿에 추가(준비도 리포트 /push/readiness).
// ⚠️ 크로스모듈 사용(예: PrescriptionModule)에서 인스턴스화되므로 deps(StepUpService·
//   ConfigRuntimeService)가 그 모듈에서 해석돼야 함 → StepUpModule 이 둘을 (재)노출.
@Injectable()
export class GatedStepUpGuard implements CanActivate {
  private readonly logger = new Logger(GatedStepUpGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly stepUp: StepUpService,
    private readonly config: ConfigRuntimeService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<string>(STEP_UP_ACTION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!action) return true; // 데코레이터 없음 → 통과

    const enabled = (await this.config.get('terminal.stepUpActions')) as string[] | null;
    if (!Array.isArray(enabled) || !enabled.includes(action)) return true; // 미활성 액션 → 무중단 통과

    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('인증이 필요합니다.');

    // 위임/대리처방 분기: 본인 외 처방의를 지정한 경우, 입력자 step-up 을 면제하고
    //   서비스가 **지정 처방의(sub=prescriberId)** 의 토큰을 강제하도록 위임. 단, 규칙이
    //   위임 인증을 보장(enabled+allowDelegate+requireDelegateAuth)할 때만 — 그래야 인증이 누락되지 않음.
    const designated = typeof req.body?.prescriberId === 'string' ? req.body.prescriberId.trim() : '';
    if (designated && designated !== userId) {
      const rules = (await this.config.get('prescription.prescriberRules')) as { enabled?: boolean; allowDelegate?: boolean; requireDelegateAuth?: boolean } | null;
      if (rules?.enabled && rules?.allowDelegate && rules?.requireDelegateAuth) return true; // 서비스가 처방의 토큰 강제
    }

    // 파일럿 게이팅 — 단계적 롤아웃: 목록(또는 "*")에 든 사용자만 강제. 비대상=무중단 통과.
    const pilot = (await this.config.get('terminal.stepUpPilotUserIds')) as string[] | null;
    const subject = Array.isArray(pilot) && (pilot.includes('*') || pilot.includes(userId));
    if (!subject) return true;

    // 준비도 fail-safe — 패스키 미보유 사용자는 step-up 자체가 불가 → 하드블록 금지(환자안전).
    if (!(await this.stepUp.hasPasskey(userId))) {
      this.logger.warn(`파일럿 대상이나 패스키 미보유 — fail-safe 통과(userId=${userId}, action=${action})`);
      return true;
    }

    // 라우트별 리소스 파라미터 정규화(:id=차트서명, :encounterId=처방) — 승인 컨텍스트·바인딩 일관성
    const resourceId = req.params?.id ?? req.params?.encounterId;
    const token = req.headers['x-step-up-token'];
    if (!token || typeof token !== 'string') {
      // 글로벌 필터가 error.code=STEPUP_REQUIRED·details=res.message 로 전달 → FE 가 details.action 사용
      throw new ForbiddenException({
        error: 'STEPUP_REQUIRED',
        message: { action, resourceId },
      });
    }
    await this.stepUp.consume(token, userId, action, {
      resourceId,
      bodyHash: hashBody(req.body),
    });
    return true;
  }
}
