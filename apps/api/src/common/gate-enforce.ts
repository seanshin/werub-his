import { BadRequestException } from '@nestjs/common';
import type { GateMode } from './gate-mode';

/**
 * 안전 게이트 3상 집행 정본 — OFF / WARN / BLOCK.
 *
 * 🔴 이 파일이 있는 이유(2026-08-26 A4 전수 판정):
 *    게이트 4종(`radiation.igrtEnforce` · `obgyn.newbornId.enforce` · `cssd.biCiEnforce` ·
 *    `dialysis.ufRateEnforce`)이 호출부에서 **`gateMode(...) === 'BLOCK'` 하나만 분기**하고 있었다.
 *    설정 설명은 `OFF|WARN|BLOCK` 3상을 말하고 관제 화면은 WARN 버튼을 그리는데,
 *    **WARN 으로 올려도 차단도 기록도 경고도 없어 OFF 와 완전히 동일**했다.
 *    이 저장소의 게이트 규약(OFF → WARN 으로 근거 수집 → BLOCK 승격)이 그 넷에서는
 *    **원리적으로 작동할 수 없었다** — WARN 이 아무 흔적도 남기지 않으니 승격 근거가 생기지 않는다.
 *    v4.5.0 에서 `surgery.signOutEnforce`·`surgery.countEnforce` 를 같은 이유로 봉합했고
 *    (`SurgeryService.enforceGate`), 그 형태를 여기서 정본화한다.
 *
 * 🔴 규칙:
 *   · **WARN 은 막지 않되 반드시 남긴다.** 기록이 없으면 승격 판단도 없다.
 *   · **BLOCK 의 동작은 종전과 한 글자도 달라지지 않는다**(같은 code·같은 message·같은 예외).
 *     게이트를 약화하는 방향의 변경은 이 헬퍼가 하지 않는다.
 *   · **평가되지 않은 것을 위반으로 세지 않는다.** `violated=false` 면 아무것도 기록하지 않는다 —
 *     모집단 0 인 축에 경보를 켜면 진짜 경보가 묻힌다.
 *   · 원장 기록 실패가 임상 행위를 막지 않는다(best-effort) — 다만 BLOCK 은 기록 성패와 무관히 막는다.
 */

/**
 * 위반 원장 기록자 — 정본은 `SafetyGateService`(modules/safety-gate).
 * 여기서 최소 형태만 요구하는 이유: `common/` 이 `modules/` 를 import 하면 의존 방향이 뒤집힌다.
 */
export interface GateViolationRecorder {
  record(gateKey: string, severity: string, message: string, refType?: string, refId?: string): Promise<unknown>;
}

/** WARN 으로 통과했을 때 호출부가 응답에 실어 보낼 수 있는 형태 */
export interface GateWarning {
  gateKey: string;
  code: string;
  message: string;
}

export interface EnforceGateParams {
  /** config 키 그대로 — 관제·GateViolationLog 가 이 문자열로 조인한다(지어내지 않는다) */
  gateKey: string;
  /** `gateMode(...)` 로 정규화된 현재 모드 */
  mode: GateMode;
  /** 게이트 조건이 실제로 위반됐는가. false 면 아무 일도 일어나지 않는다 */
  violated: boolean;
  /** BLOCK 시 던질 예외의 `code` — 종전 값을 그대로 넘겨야 FE 분기가 살아 있다 */
  code: string;
  /**
   * 사람이 읽을 **위반 사실**. 원장·로그에 이 문자열이 남는다.
   * 🔴 "차단했다"가 아니라 "무엇이 어긋났다"를 적는다 — WARN 에서는 행위가 실제로 수행됐으므로
   *    "조사 불가" 같은 차단 어휘를 원장에 박으면 원장이 거짓말을 한다.
   */
  message: string;
  /** BLOCK 시 예외 본문에 넣을 문구(차단 어휘). 없으면 `message` 를 쓴다 */
  blockMessage?: string;
  /** GateViolationLog.refType / refId — 사후 추적 경로 */
  refType?: string;
  refId?: string;
  /** 없으면 기록하지 않는다(주입 실패해도 BLOCK 은 그대로 막는다) */
  recorder?: GateViolationRecorder;
  /** WARN 통과를 로그에도 남길 때 */
  logger?: { warn(message: string): void; error(message: string): void };
  /** BLOCK 예외 본문에 함께 실을 추가 필드(종전 payload 보존용) */
  extra?: Record<string, unknown>;
}

/**
 * 3상 집행. 반환값:
 *   · `null` — OFF 이거나 위반 아님(아무 일도 없었다)
 *   · `GateWarning` — WARN 이고 위반이었다(원장에 남았고 막지는 않았다)
 *   · throw — BLOCK 이고 위반이었다(원장에 남기고 막았다)
 */
/**
 * 위반을 원장(`GateViolationLog`)에 남긴다 — **실패해도 집행을 막지 않되, 실패를 지우지도 않는다.**
 *
 * 🔴 이 함수가 따로 있는 이유(2026-08-26 실측):
 *    종전 코드는 `recorder?.record(...).catch(() => undefined)` 였다. 이 한 줄이 **두 가지를 동시에 지운다**.
 *
 *    ① **기록 실패** — DB 가 거부해도 아무 흔적이 없다.
 *    ② 🔴 **recorder 자체가 없는 경우** — `?.` 가 조용히 `undefined` 를 돌려주고 끝난다.
 *
 *    ②가 실제로 일어나 있었다. `SafetyGateService` 는 `@Global` 이 아니고 소비처가 전부 `@Optional()` 이라,
 *    **모듈이 `SafetyGateModule` 을 import 하지 않으면 `gates` 가 `undefined` 가 된다.**
 *    그러면 **집행(차단)은 정상 동작하는데 기록만 통째로 사라진다** — 화면에는 "위반 0건"으로 보인다.
 *    `blood-bank`(4지점)·`waiting-queue`(1지점)가 그 상태였고, `record('키'` 문자열을 세는
 *    구조 가드는 이 층을 **통과시키고 있었다**(호출은 실재하므로).
 *
 *    이 저장소에서 같은 유형이 반복해서 나왔다 — `gate_violation_logs` 0행이 "위반 없음"이 아니라
 *    "탐지기가 죽음"이었던 v4.4.0 DUR 43룰, `.catch(()=>undefined)` 로 BTG 긴급열람 통보가
 *    실패조차 소실된 v4.6.0. **`.catch(() => 기본값)` 은 "실패"를 "없음"으로 번역하는 코드다.**
 *
 * 🔴 그래서 `logger` 로 남긴다. 남길 곳이 없으면(로거도 없으면) **그 사실이 조용해지지 않도록**
 *    호출부가 로거를 넘기게 두고, 여기서 만들어내지 않는다(없는 원장을 지어내지 않는다).
 */
export async function recordGateViolation(
  params: Pick<EnforceGateParams, 'gateKey' | 'recorder' | 'logger' | 'refType' | 'refId'>,
  severity: string,
  message: string,
): Promise<void> {
  const { gateKey, recorder, logger, refType, refId } = params;
  const at = `${refType ?? ''}${refId ? `:${refId}` : ''}`;
  if (!recorder) {
    logger?.error(
      `[게이트 ${gateKey}=${severity}] 위반 원장 미주입(SafetyGateService) — ${at} ${message}` +
        ' · 해당 모듈이 SafetyGateModule 을 import 하지 않았다(집행은 되지만 기록이 남지 않는다)',
    );
    return;
  }
  try {
    await recorder.record(gateKey, severity, message, refType, refId);
  } catch (e) {
    logger?.error(`[게이트 ${gateKey}=${severity}] 위반 원장 기록 실패 — ${at} ${message} · ${e}`);
  }
}

export async function enforceGate(params: EnforceGateParams): Promise<GateWarning | null> {
  const { gateKey, mode, violated, code, message, refType, refId } = params;
  if (mode === 'OFF' || !violated) return null;

  // 🔴 기록은 차단 여부와 무관하다 — WARN 도 BLOCK 도 남는다.
  //    기록 실패가 BLOCK 을 뚫어서는 안 되지만, **삼키지도 않는다**(§recordGateViolation).
  await recordGateViolation(params, mode, message);

  if (mode === 'BLOCK') {
    throw new BadRequestException({ code, message: params.blockMessage ?? message, gateKey, ...(params.extra ?? {}) });
  }

  params.logger?.warn(`[게이트 ${gateKey}=WARN] ${refType ?? ''}${refId ? `:${refId}` : ''} — ${message}`);
  return { gateKey, code, message };
}
