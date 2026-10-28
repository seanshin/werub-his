import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppKeyService } from './app-key.service';
import { bodyHashOf } from './app-key.canonical';

export const APP_ASSERTION_PURPOSE = 'app_assertion_purpose';

/**
 * 이 핸들러는 **등록된 앱 설치가 보낸 요청**임을 증명해야 한다.
 *
 * 🔴 모든 GET 에 걸지 않는다 — 병렬 요청에서 counter 순서가 뒤집혀 정상 클라이언트가
 *    replay 로 오판될 수 있다. 요청서가 정한 **최소 필수 적용점**에만 건다
 *    (가입·로그인·refresh·기기 등록/복구·고위험 변경).
 */
export const RequireAppAssertion = (purpose: string) => SetMetadata(APP_ASSERTION_PURPOSE, purpose);

export interface AppAssertionContext {
  appKeyId: string;
  app: 'PATIENT_IOS' | 'STAFF_IOS';
  installationId: string;
  status: string;
}

@Injectable()
export class AppAssertionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly appKeys: AppKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const purpose = this.reflector.getAllAndOverride<string>(APP_ASSERTION_PURPOSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!purpose) return true;

    const req = context.switchToHttp().getRequest<Request & { appAssertion?: AppAssertionContext }>();
    const appKeyId = req.header('x-app-key-id');
    const challengeId = req.header('x-app-challenge-id');
    const assertion = req.header('x-app-attest-assertion');

    if (!appKeyId || !challengeId || !assertion) {
      // 🔴 "없으면 통과"로 두지 않는다. 켜 둔 지점은 반드시 증명을 요구한다.
      throw new UnauthorizedException({
        code: 'APP_ASSERTION_REQUIRED',
        message: '앱 설치 개별키 증명이 필요합니다.',
      });
    }

    const ctx = await this.appKeys.assertRequest({
      appKeyId,
      challengeId,
      assertion,
      purpose,
      method: req.method.toUpperCase(),
      // 프록시 뒤에서도 안정적인 값 — 쿼리스트링은 제외한다(서명 대상에서 뺀 것과 같아야 한다)
      path: req.originalUrl.split('?')[0],
      bodySha256: bodyHashOf(req.body),
      sessionId: (req.header('x-session-id') || undefined) ?? undefined,
    });
    req.appAssertion = ctx;
    return true;
  }
}
