import { Logger } from '@nestjs/common';

/**
 * 🔴 AI 호출 원장(`AiCallLog`) 싱크 — **DI 없이** 쓰는 한 줄짜리 연결부.
 *
 * 왜 이런 모양인가:
 *   `aiEgressFetch` 는 10개 모듈이 부르는 **순수 함수**다(전송 직전 동기 경로). NestJS DI 를 가질 수 없고,
 *   가지게 만들면 정본이 둘로 갈라진다(같은 이유로 `buildHisMode` 도 여기서 빌드 상한만 읽는다).
 *   그래서 앱 부트 시 `AiCallLogService`(`modules/ai-call-log/`)가 `registerAiCallLogSink()` 로
 *   자기 자신을 꽂고, 이 파일은 **꽂힌 것이 있으면 부르고 없으면 조용히 건너뛴다.**
 *
 * 🔴 미등록을 "0건"으로 그리지 않기 위해 **프로세스당 1회 warn** 한다 — 원장이 비어 있는 것과
 *    호출이 없었던 것은 다른 사실이고, 이 경고가 그 둘을 가르는 유일한 흔적이다.
 *
 * 🔴 **PHI 를 담지 않는다.** 여기 흐르는 것은 "무엇을 어떤 모델로 불렀고 얼마나 걸렸으며 어떻게 끝났는가"
 *    뿐이다. 프롬프트·응답 본문·환자 식별자는 이 타입에 필드가 없다(넣으려면 스키마부터 다시 본다).
 *
 * 🔴 감사 로그 라인(`{t:'AI_EGRESS', …}` 8키)과는 **별개의 원장**이다. 그쪽 키 집합은 운영 로그 파서가
 *    물려 있어 건드리지 않는다(가드: `test/medical-ai/ai-egress-canon.spec.ts` ④).
 */

/** 원장 1행에 담기는 것 — 전부 메타다(본문 없음). 모르는 값은 `null`(0 으로 채우지 않는다). */
export interface AiCallLogRecord {
  /** 스킬 — 호출부가 따로 알려주지 않으므로 `client` 문자열을 그대로 쓴다(지어내지 않는다) */
  skill: string;
  /** 호출 주체(모듈·클라이언트) — `aiEgressFetch` 의 `opts.client` */
  client: string;
  /** 우리가 요청한 태그(요청 본문의 `model`). 못 읽으면 null */
  requestedModel: string | null;
  /** 🔴 상류가 보고한 태그(응답의 `model`/`model_used`). 요청 태그로 대신 채우지 않는다 */
  modelRef: string | null;
  latencyMs: number | null;
  /** 전송 자체가 실패하면 null — "상태를 모른다"는 0 이나 500 과 다른 사실이다 */
  httpStatus: number | null;
  /** 응답 바이트 수(스키마 주석 기준). 못 재면 null — -1 같은 신호값을 쓰지 않는다 */
  bytes: number | null;
  /** 운영 모드 — 🔴 빌드 상한이라 실효 모드(런타임 토글)와 다를 수 있다 */
  mode: string | null;
}

export type AiCallLogSink = (rec: AiCallLogRecord) => void | Promise<void>;

const logger = new Logger('AiCallLogSink');

let sink: AiCallLogSink | null = null;
let missingWarned = false;
let errorLogged = false;

/** 앱 부트 시 1회. 두 번 부르면 마지막 것이 이긴다(테스트가 갈아끼울 수 있게). */
export function registerAiCallLogSink(fn: AiCallLogSink): void {
  sink = fn;
  missingWarned = false;
  errorLogged = false;
}

/** 테스트·종료용. 운영 코드에서는 부르지 않는다. */
export function clearAiCallLogSink(): void {
  sink = null;
  missingWarned = false;
  errorLogged = false;
}

export function hasAiCallLogSink(): boolean {
  return sink !== null;
}

/**
 * 원장 1행 기록 시도. **절대 던지지 않는다** — 기록 실패가 AI 호출을 막으면 안 된다.
 * 성공/실패를 호출부에 돌려주지도 않는다(fire-and-forget).
 */
export function emitAiCallLog(rec: AiCallLogRecord): void {
  const fn = sink;
  if (!fn) {
    if (!missingWarned) {
      missingWarned = true;
      logger.warn(
        'AiCallLog 싱크가 등록되지 않아 AI 호출 원장이 남지 않습니다 — 원장의 0행을 "호출 없음"으로 읽지 마십시오. ' +
          '(등록 지점: modules/ai-call-log/AiCallLogService.onModuleInit · 프로세스당 1회만 알립니다)',
      );
    }
    return;
  }
  try {
    const ret = fn(rec) as unknown;
    if (ret && typeof (ret as Promise<void>).catch === 'function') {
      (ret as Promise<void>).catch(reportSinkError);
    }
  } catch (e) {
    reportSinkError(e);
  }
}

function reportSinkError(e: unknown): void {
  if (errorLogged) return;
  errorLogged = true;
  logger.error(
    `AiCallLog 기록 실패 — AI 호출 자체는 막지 않았습니다(프로세스당 1회만 알립니다): ${
      (e as Error)?.message ?? String(e)
    }`,
  );
}

/** VarChar 한계에 맞춰 자른다 — 자르면 잘랐다는 사실이 드러나게 말미에 `…` 를 남긴다. */
export function clampTag(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
