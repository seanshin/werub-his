import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import { DomainError } from '../../domain/errors/domain-error';
import { exceptionMsgOf } from '../msg-exception';
import type { ServerMessage } from '@hospital-run/shared';

const DOMAIN_ERROR_STATUS_MAP: Record<string, number> = {
  PATIENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  DUPLICATE_MRN: HttpStatus.CONFLICT,
  APPOINTMENT_CONFLICT: HttpStatus.CONFLICT,
  INVALID_STATUS_TRANSITION: HttpStatus.UNPROCESSABLE_ENTITY,
  // EMR Enhancement
  PROBLEM_NOT_FOUND: HttpStatus.NOT_FOUND,
  PROBLEM_ALREADY_RESOLVED: HttpStatus.BAD_REQUEST,
  ALLERGY_NOT_FOUND: HttpStatus.NOT_FOUND,
  ALLERGY_DRUG_CONFLICT: HttpStatus.CONFLICT,
  DISCHARGE_SUMMARY_EXISTS: HttpStatus.CONFLICT,
  DISCHARGE_SUMMARY_NOT_FOUND: HttpStatus.NOT_FOUND,
  DISCHARGE_ALREADY_SIGNED: HttpStatus.BAD_REQUEST,
  CONSENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  CONSENT_ALREADY_SIGNED: HttpStatus.BAD_REQUEST,
  CONSENT_ALREADY_REVOKED: HttpStatus.BAD_REQUEST,
  NURSING_ASSESSMENT_EXISTS: HttpStatus.CONFLICT,
  ADMISSION_NOT_FOUND: HttpStatus.NOT_FOUND,
  MED_ADMIN_NOT_SCHEDULED: HttpStatus.BAD_REQUEST,
  MED_ADMIN_NOT_FOUND: HttpStatus.NOT_FOUND,
};


/**
 * Prisma 가 **확정적으로 아는 실패**만 상태코드로 옮긴다 — 모르는 것은 그대로 500 이다.
 * 🔴 내부 메시지(`Invalid \`prisma.x.update()\` invocation … 파일·줄)는 절대 내보내지 않는다.
 */
const PRISMA_ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  P2025: { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: '대상을 찾을 수 없습니다' },
  /**
   * 🔴 P2023(Inconsistent column data) — 실제로는 거의 전부 **UUID 형식 오류**다
   *    (`?patientId=notauuid` 가 @db.Uuid where 로 직행 → "Error creating UUID").
   *    개별 @Query 문자열 인자는 ValidationPipe 를 우회하므로 호출부마다 막을 수 없다 —
   *    P2025 와 같은 이유로 층에서 한 번에 말한다(운영 실측 500: orders·encounters·chemo·
   *    diagnostic-tests 등). 클라이언트 입력 문제이므로 400. 내부 메시지는 감춘다.
   */
  P2023: { status: HttpStatus.BAD_REQUEST, code: 'INVALID_FORMAT', message: '요청 값의 형식이 올바르지 않습니다' },
  P2002: { status: HttpStatus.CONFLICT, code: 'DUPLICATE', message: '이미 존재하는 값입니다' },
  P2003: { status: HttpStatus.BAD_REQUEST, code: 'FK_CONSTRAINT', message: '연결된 대상이 올바르지 않습니다' },
};

/** `instanceof PrismaClientKnownRequestError` 는 클라이언트 인스턴스가 달라지면 깨진다 — 형태로 본다 */
function isPrismaKnownError(e: unknown): e is { code: string } {
  return (
    typeof e === 'object' && e !== null &&
    'code' in e && typeof (e as { code: unknown }).code === 'string' &&
    /^P\d{4}$/.test((e as { code: string }).code) &&
    'clientVersion' in e
  );
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    // 이미 응답이 전송된 경우 (예: @Res() 사용 컨트롤러) — 중복 전송 방지
    if (response.headersSent) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.warn(`Exception after response sent: ${err.message}`);
      return;
    }

    let status: number;
    let code: string;
    let message: string;
    let details: unknown;
    /** 예외 문장 `{ k, params }`(`msgException`) — 있을 때만 싣는다(없는 응답의 모양은 종전 그대로) */
    let msg: ServerMessage | undefined;

    if (exception instanceof DomainError) {
      status = DOMAIN_ERROR_STATUS_MAP[exception.code] || HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res !== 'object' || res === null) {
        code = 'HTTP_ERROR';
        message = exception.message;
        details = undefined;
      } else {
        const body = res as Record<string, unknown>;
        // 🔴 코드는 던진 쪽이 정한 것을 그대로 — 종전엔 `code:` 를 안 보고 전부 'HTTP_ERROR' 로 뭉갰다.
        //    (DUR_CHECK_FAILED·CDSS_CHECK_FAILED 등 FE 분기 키가 서버에서 사라졌다)
        code = typeof body.code === 'string' && body.code
          ? body.code
          : 'error' in body ? String(body.error) : 'HTTP_ERROR';
        message = exception.message;
        msg = exceptionMsgOf(body);
        // 🔴 payload 보존 — 종전엔 details = res.message 만 담아 durWarnings·checks·blocked 등
        //    구조화 payload 54개소가 통째로 버려졌다(응답 규약 { error:{code,message,details} } 은 유지).
        //    ValidationPipe(message 배열)·문자열 message 호환은 그대로 둔다.
        const rest: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body)) {
          if (k === 'code' || k === 'error' || k === 'message' || k === 'statusCode' || k === 'details' || k === 'msg') continue;
          rest[k] = v;
        }
        const hasRest = Object.keys(rest).length > 0;
        if (hasRest) {
          details = body.details !== undefined ? { ...rest, details: body.details } : rest;
        } else {
          details = body.details !== undefined ? body.details : body.message;
        }
      }
    } else if (isPrismaKnownError(exception) && exception.code in PRISMA_ERROR_MAP) {
      /**
       * 🔴 **"없는 것"을 "서버 오류"라 말하지 않는다.**
       *    `update`/`delete` 가 대상 행을 못 찾으면 Prisma 는 `P2025` 를 던지는데,
       *    여기 매핑이 없어 **500 `INTERNAL_ERROR`** 로 나갔다(운영 실측: 급식 상태 전이).
       *    이 저장소는 같은 결함을 **개별 EP 에서 두 번 봉합**했다(응급 처분 결정·병원정보) —
       *    층이 틀렸다는 뜻이라 여기서 한 번에 말한다. 해당 호출부는 **1,031개소**다.
       *    운영 로그로만 남던 사실을 상태코드로 말할 뿐, 내부 메시지는 그대로 감춘다.
       */
      const m = PRISMA_ERROR_MAP[exception.code];
      status = m.status;
      code = m.code;
      message = m.message;
      this.logger.warn(`Prisma ${exception.code}: ${request.method} ${request.url}`);
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_ERROR';
      message = 'An unexpected error occurred';
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`Unhandled exception: ${err.message}`, err.stack);
    }

    // details에 circular 구조가 포함될 수 있으므로 안전하게 직렬화
    let safeDetails = details;
    if (details !== null && typeof details === 'object') {
      try { JSON.stringify(details); } catch { safeDetails = String(details); }
    }

    response.status(status).json({
      // 🔴 `msg` 는 **추가 키**다 — `message`(한국어)는 그대로 두어 모바일·외부 호출자가 깨지지 않는다(I4)
      error: msg ? { code, message, details: safeDetails, msg } : { code, message, details: safeDetails },
      meta: {
        requestId: request.headers['x-request-id'] || randomUUID(),
        timestamp: new Date().toISOString(),
      },
    });
  }
}
