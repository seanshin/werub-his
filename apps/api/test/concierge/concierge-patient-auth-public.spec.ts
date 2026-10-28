import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConciergeService } from '../../src/modules/concierge/concierge.service';
import { ConciergePatientAuthDto } from '../../src/modules/concierge/dto/concierge-patient-auth.dto';

/**
 * 공개(무인증) 환자 본인 인증 `POST /api/v1/concierge/patient-auth/verify`.
 *
 * 🔴 (2026-09-16 H1 실측) 세 가지가 함께 있었다.
 *   ① **연산자 주입으로 본인 인증 우회** — 개별 `@Body(key)` 는 ValidationPipe 를 건너뛰어
 *      `{"mrn":{"not":"__x__"}}` 가 Prisma where 에 그대로 들어갔다(그 생년월일의 아무 환자로 통과).
 *   ② **지어낸 자격증명** — 저장하지 않는 `token`(randomBytes)과 24h `expiresAt` 을 돌려줬다.
 *      ConciergeSession 에 토큰 컬럼이 없다 — 아무것도 인증하지 않는 값이었다.
 *   ③ **레이트리밋 없음** — 무인증 신원 대입에 전역 기본 600/분이 붙어 있었다.
 */

function makeSvc(patient: unknown, existingSession: unknown = null) {
  const prisma = {
    patient: { findFirst: vi.fn().mockResolvedValue(patient) },
    conciergeSession: {
      findFirst: vi.fn().mockResolvedValue(existingSession),
      create: vi.fn().mockResolvedValue({ id: 'sess-new' }),
    },
  };
  const svc = new ConciergeService(prisma as never, {} as never, {} as never);
  return { svc, prisma };
}

const PATIENT = { id: 'pat-1', familyName: '홍', givenName: '길동' };

describe('DTO — 연산자 주입 차단(본인 인증 우회)', () => {
  it('🔴 mrn 에 객체를 보내면 검증에서 걸린다', async () => {
    const dto = plainToInstance(ConciergePatientAuthDto, { mrn: { not: '__x__' }, dateOfBirth: '1980-01-01' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'mrn')).toBe(true);
  });

  it('🔴 dateOfBirth 형식(YYYY-MM-DD)을 벗어나면 걸린다', async () => {
    const dto = plainToInstance(ConciergePatientAuthDto, { mrn: 'P2026-0001', dateOfBirth: { gte: '1900-01-01' } });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'dateOfBirth')).toBe(true);
  });

  it('대조군 — 정상 입력은 통과한다', async () => {
    const dto = plainToInstance(ConciergePatientAuthDto, { mrn: 'P2026-0001', dateOfBirth: '1980-01-01' });
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('서비스 — 자격증명을 지어내지 않는다', () => {
  it('🔴 저장하지 않는 token/expiresAt 을 발급하지 않는다(사유를 말한다)', async () => {
    const { svc } = makeSvc(PATIENT);
    const r = await svc.authenticatePatient('P2026-0001', '1980-01-01');
    expect(r.token).toBeNull();
    expect(r.tokenReason).toBe('NOT_ISSUED_NO_LEDGER');
    expect(r).not.toHaveProperty('expiresAt');
  });

  it('대조군 — 실재하는 식별자(sessionId)와 본인 확인 결과는 그대로 돌려준다', async () => {
    const { svc } = makeSvc(PATIENT);
    const r = await svc.authenticatePatient('P2026-0001', '1980-01-01');
    expect(r.sessionId).toBe('sess-new');
    expect(r.patientId).toBe('pat-1');
    expect(r.patientName).toBe('홍길동');
  });

  it('활성 세션이 있으면 재사용한다(무인증 쓰기 누적 금지)', async () => {
    const { svc, prisma } = makeSvc(PATIENT, { id: 'sess-old' });
    const r = await svc.authenticatePatient('P2026-0001', '1980-01-01');
    expect(r.sessionId).toBe('sess-old');
    expect(prisma.conciergeSession.create).not.toHaveBeenCalled();
  });

  it('🔴 서비스 직접 호출에서도 객체 mrn 은 통과하지 못한다(방어적 재확인)', async () => {
    const { svc, prisma } = makeSvc(PATIENT);
    await expect(
      svc.authenticatePatient({ not: '__x__' } as unknown as string, '1980-01-01'),
    ).rejects.toThrow();
    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
  });

  it('불일치는 401 — 어느 쪽이 틀렸는지 말하지 않는다', async () => {
    const { svc } = makeSvc(null);
    await expect(svc.authenticatePatient('P2026-9999', '1980-01-01')).rejects.toThrow(
      /등록번호 또는 생년월일/,
    );
  });
});

describe('컨트롤러 — 무인증 신원 대입에 레이트리밋', () => {
  it('🔴 verify 핸들러에 민감 등급 Throttle 이 걸려 있다', async () => {
    const { ConciergePatientAuthController } = await import('../../src/modules/concierge/concierge.controller');
    const meta = Reflect.getMetadata(
      'THROTTLER:LIMIT',
      ConciergePatientAuthController.prototype.authenticatePatient,
    ) as Record<string, unknown> | undefined;
    // @Throttle 은 이름별 메타데이터로 붙는다 — 키 존재만으로 판정하지 않고 값까지 본다
    const raw = JSON.stringify(
      Reflect.getMetadataKeys(ConciergePatientAuthController.prototype.authenticatePatient).map((k) => [
        k,
        Reflect.getMetadata(k as string, ConciergePatientAuthController.prototype.authenticatePatient),
      ]),
    );
    expect(meta !== undefined || raw.includes('sensitive')).toBe(true);
    expect(raw).toContain('sensitive');
  });
});
