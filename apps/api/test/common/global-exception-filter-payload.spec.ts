import { describe, it, expect, vi } from 'vitest';
import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus, ArgumentsHost,
} from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';

/**
 * 🔴 전역 예외 필터의 payload 보존 가드.
 *
 * 결함(2026-08-18 실측): 필터가 HttpException 응답에서 `details = res.message` 만 뽑고
 * 나머지 키를 통째로 버렸다. 그래서
 *   - `DUR_CHECK_FAILED` 와 함께 실어 보낸 `durWarnings` 가 서버를 못 벗어났고
 *   - FE 의 DUR 강제처방(override) 모달 3곳이 전부 **도달 불가능한 죽은 코드**였다
 *     (`details?.durWarnings` 가 항상 undefined) → `dur_override_reason` 운영 0행.
 *   - `code` 도 `res.error` 만 보고 나머지를 'HTTP_ERROR' 로 뭉갰다.
 * 같은 피해를 보던 구조화 payload 는 54개소였다(durWarnings·cdssChecks·blocked·gate·blockers 등).
 *
 * 응답 규약은 `{ error: { code, message, details }, meta }` — 규약을 바꾸지 않고 details 로만 실어 보낸다.
 */
function capture(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ headersSent: false, status }),
      getRequest: () => ({ headers: {} }),
    }),
  } as unknown as ArgumentsHost;
  new GlobalExceptionFilter().catch(exception, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as any };
}

describe('GlobalExceptionFilter — 구조화 payload 보존', () => {
  it('🔴 DUR 차단: durWarnings 가 error.details 로 살아 나가고 code 가 보존된다(FE override 모달 도달)', () => {
    const durWarnings = [
      { severity: 'ERROR', type: 'INTERACTION', message: '출혈 위험 증가 (항응고+항혈소판)', drugA: '와파린', drugB: '아스피린' },
    ];
    const { status, body } = capture(new BadRequestException({
      code: 'DUR_CHECK_FAILED',
      message: 'DUR 점검에서 위험 경고가 발생했습니다. 강제 처방하려면 overrideDur: true를 전송하세요.',
      durWarnings,
    }));
    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.error.code).toBe('DUR_CHECK_FAILED');
    // FE 3화면이 읽는 자리 — 여기가 undefined 면 강제처방 모달이 영영 안 뜬다
    expect(body.error.details?.durWarnings).toEqual(durWarnings);
    expect(body.meta.requestId).toBeTruthy();
  });

  it('CDSS 차단: cdssChecks 도 동일하게 보존', () => {
    const cdssChecks = [{ category: 'ALLERGY', level: 'ERROR', title: '알레르기 경고', message: '환자 알레르기: 페니실린' }];
    const { body } = capture(new BadRequestException({ code: 'CDSS_CHECK_FAILED', message: '경고', cdssChecks }));
    expect(body.error.code).toBe('CDSS_CHECK_FAILED');
    expect(body.error.details?.cdssChecks).toEqual(cdssChecks);
  });

  it('여러 payload 키를 함께 던져도 전부 남는다(formulary 게이트 형)', () => {
    const { body } = capture(new BadRequestException({
      code: 'FORMULARY_NOT_APPROVED', message: '미등재', domain: 'MEDICATION', codeId: 'm-1', itemStatus: 'PENDING',
    }));
    expect(body.error.details).toEqual({ domain: 'MEDICATION', codeId: 'm-1', itemStatus: 'PENDING' });
  });

  it('종전 계약 유지 ①: `error` 키 형(step-up)은 code=error·details=message 그대로', () => {
    const { body } = capture(new ForbiddenException({
      error: 'STEPUP_REQUIRED', message: { action: 'PRESCRIBE', resourceId: 'enc-1' },
    }));
    expect(body.error.code).toBe('STEPUP_REQUIRED');
    expect(body.error.details).toEqual({ action: 'PRESCRIBE', resourceId: 'enc-1' });
  });

  it('종전 계약 유지 ②: ValidationPipe 형(message 배열)은 details 에 배열 그대로', () => {
    const { body } = capture(new BadRequestException({
      statusCode: 400, message: ['dosage must be a string', 'quantity must be a number'], error: 'Bad Request',
    }));
    expect(body.error.code).toBe('Bad Request');
    expect(body.error.details).toEqual(['dosage must be a string', 'quantity must be a number']);
  });

  it('종전 계약 유지 ③: `details` 키를 명시한 형은 그 값이 details', () => {
    const { body } = capture(new BadRequestException({ code: 'IMPORT_FAILED', message: '실패', details: { row: 3 } }));
    expect(body.error.details).toEqual({ row: 3 });
  });

  it('문자열 예외는 종전과 동일(details 없음)', () => {
    const { body } = capture(new HttpException('단순 오류', HttpStatus.CONFLICT));
    expect(body.error.code).toBe('HTTP_ERROR');
    expect(body.error.details).toBeUndefined();
  });

  it('알 수 없는 예외는 내부 상세를 노출하지 않는다', () => {
    const { status, body } = capture(new Error('DB password is hunter2'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
