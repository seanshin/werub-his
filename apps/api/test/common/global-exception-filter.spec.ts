import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { DomainError } from '../../src/domain/errors/domain-error';

/**
 * 에러 응답 정보 노출 계약 — 2026-07 에러 노출 전수검토.
 *
 * 핵심 계약: **처리되지 않은 예외(내부 오류·Prisma 등)는 500 으로 마스킹**되고,
 * 원본 메시지·스택은 응답에 절대 나가지 않는다(로그로만). 이 계약이 미래에 깨지면
 * DB 구조·내부 URL 이 클라이언트로 새므로 테스트로 고정한다.
 */
function mockHost(captured: { status?: number; body?: any }) {
  const res = {
    headersSent: false,
    status(s: number) { captured.status = s; return this; },
    json(b: any) { captured.body = b; return this; },
  };
  const req = { headers: {} };
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as any;
}

describe('GlobalExceptionFilter — 에러 노출 계약', () => {
  const filter = new GlobalExceptionFilter();

  it('🔴 처리되지 않은 예외는 500 으로 마스킹 — 원본 메시지·스택 미노출', () => {
    const captured: any = {};
    // Prisma 스타일 내부 에러(컬럼·제약 정보 포함)
    const dbError = new Error('column "patient_ssn" does not exist in relation "patients"');
    (dbError as any).stack = 'at PrismaClient... /app/node_modules/@prisma/...';

    filter.catch(dbError, mockHost(captured));

    expect(captured.status).toBe(500);
    expect(captured.body.error.code).toBe('INTERNAL_ERROR');
    expect(captured.body.error.message).toBe('An unexpected error occurred');
    // 원본 메시지·컬럼명·스택·경로가 응답에 절대 없어야 한다
    const serialized = JSON.stringify(captured.body);
    expect(serialized).not.toContain('patient_ssn');
    expect(serialized).not.toContain('does not exist');
    expect(serialized).not.toContain('node_modules');
    expect(serialized).not.toContain('PrismaClient');
    expect(captured.body.error.details).toBeUndefined();
  });

  it('문자열 throw 도 500 으로 마스킹', () => {
    const captured: any = {};
    filter.catch('접속 문자열 secret=xyz 노출 위험', mockHost(captured));
    expect(captured.status).toBe(500);
    expect(JSON.stringify(captured.body)).not.toContain('secret=xyz');
  });

  it('HttpException 은 개발자가 의도한 메시지를 그대로 전달(400/404)', () => {
    const captured: any = {};
    filter.catch(new NotFoundException('환자를 찾을 수 없습니다'), mockHost(captured));
    expect(captured.status).toBe(404);
    expect(captured.body.error.message).toBe('환자를 찾을 수 없습니다');
  });

  it('ValidationPipe 필드 상세(BadRequest)는 details 로 전달', () => {
    const captured: any = {};
    filter.catch(new BadRequestException(['name should not be empty']), mockHost(captured));
    expect(captured.status).toBe(400);
    expect(captured.body.error.details).toEqual(['name should not be empty']);
  });

  it('DomainError 는 코드별 상태로 매핑', () => {
    const captured: any = {};
    filter.catch(new DomainError('PATIENT_NOT_FOUND', '없음'), mockHost(captured));
    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body.error.code).toBe('PATIENT_NOT_FOUND');
  });

  it('모든 응답은 { error, meta } 규약 + requestId·timestamp 포함', () => {
    const captured: any = {};
    filter.catch(new HttpException('x', 418), mockHost(captured));
    expect(captured.body).toHaveProperty('error.code');
    expect(captured.body).toHaveProperty('meta.requestId');
    expect(captured.body).toHaveProperty('meta.timestamp');
  });
});

/**
 * 🔴 **"없는 것"을 "서버 오류"라 말하지 않는다** (2026-08-29 · 발굴 20회차 운영 실측).
 *
 * `PATCH /api/v1/nutrition/meals/<없는 id>/status` 가 **500 `INTERNAL_ERROR`** 를 냈다.
 * `update`/`delete` 가 대상을 못 찾으면 Prisma 는 `P2025` 를 던지는데 전역 필터에 매핑이 없었다.
 * 같은 결함을 **개별 EP 에서 두 번 봉합한 흔적**이 이 저장소에 남아 있다(층이 틀렸다는 뜻).
 * 해당 호출부는 `update` 987 + `delete` 44 = **1,031개소**다.
 */
describe('🔴 Prisma 가 확정적으로 아는 실패는 상태코드로 말한다', () => {
  const filter = new GlobalExceptionFilter();
  const prismaErr = (code: string) =>
    Object.assign(new Error('Invalid `prisma.mealOrder.update()` invocation in /app/src/x.ts:46'), {
      code,
      clientVersion: '6.0.0',
    });

  const run = (e: unknown) => {
    const captured: { status?: number; body?: any } = {};
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          headersSent: false,
          status(s: number) { captured.status = s; return this; },
          json(b: any) { captured.body = b; return this; },
        }),
        getRequest: () => ({ headers: {}, method: 'PATCH', url: '/api/v1/x' }),
      }),
    } as any;
    filter.catch(e, host);
    return captured;
  };

  it('P2025(대상 없음) → 404 — 500 이 아니다', () => {
    const r = run(prismaErr('P2025'));
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('🔴 P2023(UUID 형식 오류) → 400 — ?patientId=notauuid 가 500 이 아니다', () => {
    // 개별 @Query 문자열 인자는 ValidationPipe 를 우회 → 잘못된 UUID 가 @db.Uuid where 로
    // 직행하면 Prisma 가 P2023("Error creating UUID")을 던진다(운영 실측: orders·encounters·
    // chemo·diagnostic-tests 500). 클라이언트 입력 문제이므로 400 으로 말한다.
    const r = run(prismaErr('P2023'));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_FORMAT');
    expect(JSON.stringify(r.body)).not.toContain('prisma.'); // 내부 메시지 미노출
  });

  it('P2002(중복) → 409 · P2003(FK) → 400', () => {
    expect(run(prismaErr('P2002')).status).toBe(409);
    expect(run(prismaErr('P2003')).status).toBe(400);
  });

  it('🔴 내부 메시지(파일·줄·쿼리)를 절대 내보내지 않는다', () => {
    const r = run(prismaErr('P2025'));
    const s = JSON.stringify(r.body);
    expect(s).not.toContain('invocation');
    expect(s).not.toContain('/app/src');
    expect(s).not.toContain('mealOrder');
  });

  it('🔴 모르는 Prisma 오류는 그대로 500 이다(대조군 — 전부 삼키지 않는다)', () => {
    const r = run(prismaErr('P9999'));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('🔴 Prisma 가 아닌 `code` 를 가진 오류를 오인하지 않는다(대조군)', () => {
    const r = run(Object.assign(new Error('boom'), { code: 'P2025' })); // clientVersion 없음
    expect(r.status).toBe(500);
  });
});
