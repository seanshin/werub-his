import { Injectable, Logger } from '@nestjs/common';
import {
  HIS_MODE_CONFIG_KEY, HIS_MODE_FALLBACK, HisMode,
  parseHisMode, resolveHisMode, isRuntimeModeEffective,
} from '@hospital-run/shared';
import { ConfigRuntimeService } from '../../modules/config/config-runtime.service';

export interface HisModeState {
  /** 배포(빌드/기동) 시 정해진 상한 — 재기동 없이는 바뀌지 않는다 */
  build: HisMode;
  /** 관리 화면에서 바꾼 값(미설정이면 null) */
  runtime: HisMode | null;
  /** 실제로 적용되는 모드 = 둘 중 더 제한적인 쪽 */
  effective: HisMode;
  /** 🔴 런타임이 빌드보다 넓히려 한 경우 false — 화면은 그 사실을 말해야 한다 */
  runtimeEffective: boolean;
}

/**
 * 운영 모드(개발/리허설/리얼) 판정 — 정본은 shared `his-mode.ts`.
 *
 * 🔴 **빌드 상한은 환경변수 `HIS_MODE` 하나다.** 없으면 `REAL`(가장 제한적)로 본다 —
 *    "설정돼 있겠지" 싶은 변수에 안전을 걸지 않는다(운영에 `NODE_ENV` 가 없어 안전 분기 7건이
 *    위험한 쪽으로 열려 있던 일에서 배운 것).
 *
 * 🔴 런타임 토글은 **좁히기만 한다.** 리얼 배포본에는 시드 모듈이 아예 없으므로
 *    런타임으로 `DEV` 를 골라도 살아나지 않는다 — 그래서 넓히는 방향은 무시하고, 무시했다는 사실을
 *    `runtimeEffective:false` 로 밖에 알린다.
 */
@Injectable()
export class HisModeService {
  private readonly logger = new Logger(HisModeService.name);
  private warned = false;

  constructor(private readonly config: ConfigRuntimeService) {}

  /** 빌드(기동) 상한. 프로세스 수명 동안 바뀌지 않는다. */
  buildMode(): HisMode {
    const parsed = parseHisMode(process.env.HIS_MODE);
    if (!parsed && !this.warned) {
      this.warned = true;
      // 막지 않고 시끄럽게 말한다 — 기본이 REAL 이라 안전 쪽이지만, 모르고 리허설을 돌리면
      // "왜 시드 로그인이 안 보이나"로 시간을 버린다(2026-08-25 에 실제로 그랬다).
      this.logger.warn(
        `HIS_MODE 미설정 또는 해석 불가(${String(process.env.HIS_MODE)}) — ${HIS_MODE_FALLBACK} 로 동작합니다. ` +
        `리허설 서버라면 HIS_MODE=REHEARSAL 을 설정하세요.`,
      );
    }
    return parsed ?? HIS_MODE_FALLBACK;
  }

  /** 관리 화면이 바꾼 런타임 값. 미설정·해석 불가는 `null`(빌드 모드를 그대로 쓴다). */
  async runtimeMode(): Promise<HisMode | null> {
    try {
      return parseHisMode(await this.config.get(HIS_MODE_CONFIG_KEY));
    } catch (err) {
      // 🔴 조회 실패를 "설정 없음"으로 번역하지 않는다 — 그러면 장애가 모드를 넓힐 수 있다.
      //    빌드 상한이 이미 안전측이므로 여기서는 빌드 모드로 떨어뜨리되, 실패를 로그로 남긴다.
      this.logger.warn(`모드 설정 조회 실패 — 빌드 모드로 판정합니다: ${(err as Error).message}`);
      return null;
    }
  }

  async state(): Promise<HisModeState> {
    const build = this.buildMode();
    const runtime = await this.runtimeMode();
    return {
      build,
      runtime,
      effective: resolveHisMode(build, runtime),
      runtimeEffective: isRuntimeModeEffective(build, runtime),
    };
  }

  /** 실효 모드 한 값만 필요할 때. */
  async effective(): Promise<HisMode> {
    return (await this.state()).effective;
  }
}
