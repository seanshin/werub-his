import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isServerMessage, renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';

/**
 * 예외 메시지 `{ k, params }` — 서버 표시 문장 i18n 의 **예외 배치**(2026-09-15 I4).
 *
 * 🔴 `throw new BadRequestException(\`단계가 올바르지 않습니다: ${x}\`)` 는 값이 문장 안에 녹아 있어서
 *    화면 언어를 바꿔도 한국어이고, 카탈로그로도 고칠 수 없다(키가 매번 달라진다).
 *    그래서 예외에 `msg`(shared `ServerMessage`)를 싣는다 — 전역 예외 필터가 `error.msg` 로 보존하고,
 *    화면(`ApiError.msg`)이 카탈로그로 조립한다.
 *
 * 🔴 **하위 호환** — `message` 는 종전과 같은 한국어 문장이다(`renderServerMessageKo(msg)` · 같은 정본에서 파생).
 *    모바일·외부 API 호출자·로그·기존 테스트(`message` 대조)는 그대로 읽는다. `code` 도 종전 Nest 예외와 같다
 *    (`Bad Request`·`Not Found` — 필터가 `error` 키에서 뽑는다). `extra` 로 `code`·구조화 payload 를 함께 실을 수 있다.
 *
 * 설계 `docs/01-plan/features/server-display-text-i18n.plan.md` §3.2.
 */
export type MsgExceptionStatus =
  | HttpStatus.BAD_REQUEST
  | HttpStatus.FORBIDDEN
  | HttpStatus.NOT_FOUND
  | HttpStatus.CONFLICT
  | HttpStatus.UNPROCESSABLE_ENTITY
  // 2026-09-21 D-27(원격진료 녹화 프록시) — "연동 미설정"(503)·"녹화 서버가 거부"(502)도 화면 문장이다.
  //   옆에 `new ServiceUnavailableException('한국어 문장')` 을 두면 그 문장만 영영 한국어로 남는다 → 정본을 넓힌다.
  | HttpStatus.BAD_GATEWAY
  | HttpStatus.SERVICE_UNAVAILABLE;

const CLASSES: Record<MsgExceptionStatus, new (body: string | Record<string, unknown>) => HttpException> = {
  [HttpStatus.BAD_REQUEST]: BadRequestException,
  [HttpStatus.FORBIDDEN]: ForbiddenException,
  [HttpStatus.NOT_FOUND]: NotFoundException,
  [HttpStatus.CONFLICT]: ConflictException,
  [HttpStatus.UNPROCESSABLE_ENTITY]: UnprocessableEntityException,
  [HttpStatus.BAD_GATEWAY]: BadGatewayException,
  [HttpStatus.SERVICE_UNAVAILABLE]: ServiceUnavailableException,
};

export function msgException(
  status: MsgExceptionStatus,
  msg: ServerMessage,
  extra?: Record<string, unknown>,
): HttpException {
  const Cls = CLASSES[status];
  const message = renderServerMessageKo(msg);
  // 종전 `new Cls(문자열)` 과 같은 응답 모양(statusCode·message·error)을 먼저 만들고 msg 를 더한다
  const base = new Cls(message).getResponse() as Record<string, unknown>;
  return new Cls({ ...base, ...(extra ?? {}), message, msg });
}

/** 예외 응답 본문에서 `msg` 를 꺼낸다 — 형태가 아니면 `undefined`(지어내지 않는다) */
export function exceptionMsgOf(body: unknown): ServerMessage | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const m = (body as { msg?: unknown }).msg;
  return isServerMessage(m) ? m : undefined;
}
