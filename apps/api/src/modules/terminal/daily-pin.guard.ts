import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TerminalPinService } from './terminal-pin.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

// 데일리 PIN 승인 게이트 (단말 제로트러스트 ② — 차트/오더 승인 시 PIN 재입력).
// 안전 설계: 데코레이터는 적용하되 **config `terminal.approvalPin.actions` 에 등록된 액션만 강제**.
//   기본(미설정) = 미강제 → 진료 워크플로우 무중단. 준비된 액션부터 단계적 활성화.
// 클라이언트는 헤더 `x-daily-pin` 으로 당일 PIN 전달. JwtAuthGuard 이후 method-level 적용 필요.

export const DAILY_PIN_ACTION = 'daily_pin_action';

/** 승인 시 데일리 PIN 재입력을 요구(액션이 config 활성목록에 있을 때만 실제 강제). */
export const RequireDailyPin = (action: string) => SetMetadata(DAILY_PIN_ACTION, action);

@Injectable()
export class DailyPinGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly terminalPin: TerminalPinService,
    private readonly config: ConfigRuntimeService,
    private readonly events: EventEmitter2,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<string>(DAILY_PIN_ACTION, ctx.getHandler());
    if (!action) return true; // 데코레이터 없음 → 통과

    // 활성 액션만 강제(기본 OFF). 배열 미설정/미포함이면 무중단 통과.
    const enabled = (await this.config.get('terminal.approvalPin.actions')) as string[] | null;
    if (!Array.isArray(enabled) || !enabled.includes(action)) return true;

    const req = ctx.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.id;
    if (!userId) throw new UnauthorizedException('인증이 필요합니다.');

    const pin = req.headers['x-daily-pin'];
    if (!pin || typeof pin !== 'string') {
      // 구조화 코드 — 글로벌 필터가 error.code 로 전달, FE 가 이 코드로 PIN 모달 표시
      throw new ForbiddenException({ error: 'DAILY_PIN_REQUIRED', message: '승인을 위해 데일리 PIN 입력이 필요합니다.' });
    }
    const ok = await this.terminalPin.verifyByUserId(userId, pin);
    if (!ok) throw new ForbiddenException({ error: 'DAILY_PIN_INVALID', message: 'PIN이 일치하지 않거나 잠금 상태입니다.' });

    // PIN 승인 성공 → sign 블록체인 감사 봉인(비차단·리스너에서 EXTERNAL 게이트·의료진 SSO 신원 봉인).
    this.events.emit('terminal.pin_approved', { userId, action, targetType: 'MEDICAL_RECORD_APPROVAL', targetRef: req.params?.id });
    return true;
  }
}
