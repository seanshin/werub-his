import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { StepUpService } from '../../src/modules/auth/step-up/step-up.service';
import { PrescriptionService, hashPrescriptionBody } from '../../src/modules/prescription/prescription.service';

/**
 * 위임 처방 "성공 경로" 통합 테스트 — 실 토큰 생명주기.
 *
 * WebAuthn/PIN 하드웨어(폰 생체 승인)만 우회하고, 그 이후 전 구간을 REAL 로 검증:
 *  - 실제 StepUpService: 진짜 JWT 서명/검증 + jti 1회 소비(in-memory Redis)
 *  - 실제 PrescriptionService.resolvePrescriber: 토큰 consume + bodyHash 바인딩 검증
 *
 * issueDirect 는 폰 승인 직후 서버가 토큰을 발급하는 실제 메서드 →
 * "폰이 승인했다"를 issueDirect 호출로 시뮬레이션하고, 나머지는 전부 실제 코드.
 */
describe('위임 처방 성공 경로 (실 토큰 통합)', () => {
  let stepUp: StepUpService;
  let service: PrescriptionService;
  let mockPrisma: any;
  let redisStore: Map<string, string>;

  const CLERK = 'clerk-nurse-1';     // 입력자(전공의·간호사)
  const PRESCRIBER = 'doc-attending-2'; // 책임 처방의(지정)
  const ENCOUNTER = 'enc-1';
  const dto: any = { type: 'MEDICATION', medicationCodeId: 'med-001', dosage: '500mg', frequency: '1일 3회', duration: 7, quantity: 14, route: 'PO' };

  // create 가 resolvePrescriber 에 넘기는 본문과 동일 필드로 해시 산출(토큰 발급용)
  const bodyOf = (d: any) => ({
    type: d.type, medicationCodeId: d.medicationCodeId, procedureCodeId: d.procedureCodeId,
    dosage: d.dosage, frequency: d.frequency, duration: d.duration, quantity: d.quantity, route: d.route,
  });

  /** 폰 승인 시뮬레이션 — 지정 처방의에게 실제 step-up 토큰 발급 */
  const phoneApproves = (userId: string, body: any, resourceId: string | undefined = ENCOUNTER) =>
    stepUp.issueDirect(userId, 'PRESCRIPTION_CREATE', resourceId, body ? hashPrescriptionBody(body) : undefined)
      .then((r) => r.stepUpToken);

  beforeEach(() => {
    // ── 실제 StepUpService (passkey/prisma 는 PRESCRIPTION_CREATE 경로에서 미사용) ──
    redisStore = new Map();
    const fakeRedis: any = {
      set: (k: string, v: string) => { redisStore.set(k, v); return Promise.resolve('OK'); },
      get: (k: string) => Promise.resolve(redisStore.get(k) ?? null),
      del: (k: string) => { redisStore.delete(k); return Promise.resolve(1); },
    };
    const config: any = { get: () => undefined, getOrThrow: () => 'test-auth-secret' };
    stepUp = new StepUpService(new JwtService({}), fakeRedis, config, {} as any, {} as any);

    // ── PrescriptionService: 데이터 접근만 mock, 로직은 실제 ──
    mockPrisma = {
      encounter: { findUnique: vi.fn().mockResolvedValue({ id: ENCOUNTER, patientId: 'pat-1', admissionId: null }) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: PRESCRIBER, role: 'DOCTOR', department: 'IM', isActive: true }) },
      medicationCode: { findUnique: vi.fn().mockResolvedValue(null) },
      prescription: { create: vi.fn((args: any) => Promise.resolve({ id: 'rx-1', ...args.data })) },
      order: { create: vi.fn().mockResolvedValue({ id: 'order-1' }) },
      $transaction: vi.fn((cb: any) => cb(mockPrisma)),
    };
    const mockDur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const mockEmitter = { emit: vi.fn() };
    const mockOrder = { create: vi.fn() };
    // 규칙 ON: 위임 허용 + 위임 인증 강제
    const mockConfig = { get: vi.fn().mockResolvedValue({ enabled: true, allowDelegate: true, requireDelegateAuth: true, allowedRoles: ['DOCTOR'] }) };
    const mockPush = { requestDelegate: vi.fn() };
    const mockAudit = { safeLog: vi.fn() };

    service = new PrescriptionService(
      mockPrisma, mockDur as any, mockEmitter as any, mockOrder as any,
      mockConfig as any, stepUp, mockPush as any, mockAudit as any,
      { assertOrderGate: vi.fn().mockResolvedValue(undefined) } as any, // PreAuthGateService — 게이트 no-op
    );
  });

  it('성공: 폰 승인 토큰으로 위임 처방 발행 → prescriberId=책임처방의, createdBy=입력자', async () => {
    const token = await phoneApproves(PRESCRIBER, bodyOf(dto));

    const res = await service.create(ENCOUNTER, dto, CLERK, undefined, {
      prescriberId: PRESCRIBER,
      prescriberStepUpToken: token,
    });

    expect(res.prescription.prescriberId).toBe(PRESCRIBER); // 책임 = 지정 처방의
    expect(res.prescription.createdBy).toBe(CLERK);          // 입력 = 전공의/간호사
    // 토큰 jti 가 소비됨(Redis 에서 삭제)
    expect(redisStore.size).toBe(0);
  });

  it('토큰 재사용 차단: 동일 토큰으로 2번째 발행 시 거부(jti 1회 소비)', async () => {
    const token = await phoneApproves(PRESCRIBER, bodyOf(dto));
    await service.create(ENCOUNTER, dto, CLERK, undefined, { prescriberId: PRESCRIBER, prescriberStepUpToken: token });

    await expect(
      service.create(ENCOUNTER, dto, CLERK, undefined, { prescriberId: PRESCRIBER, prescriberStepUpToken: token }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('약품 변조 차단: 승인한 본문과 다른 용량으로 발행 시 STEPUP_MISMATCH', async () => {
    const token = await phoneApproves(PRESCRIBER, bodyOf(dto)); // 500mg 로 승인
    const tampered = { ...dto, dosage: '1000mg' };             // 1000mg 로 발행 시도

    await expect(
      service.create(ENCOUNTER, tampered, CLERK, undefined, { prescriberId: PRESCRIBER, prescriberStepUpToken: token }),
    ).rejects.toThrow(/STEPUP_MISMATCH|내용이 변경/);
  });

  it('타인 토큰 차단: 지정 처방의가 아닌 사람 토큰은 거부(sub 바인딩)', async () => {
    const otherToken = await phoneApproves('doc-other-3', bodyOf(dto)); // 다른 의사 토큰

    await expect(
      service.create(ENCOUNTER, dto, CLERK, undefined, { prescriberId: PRESCRIBER, prescriberStepUpToken: otherToken }),
    ).rejects.toThrow(UnauthorizedException);
    // 소비되지 않아야 함(sub 불일치로 jti del 전에 거부)
    expect(redisStore.size).toBe(1);
  });

  it('미바인딩 토큰 차단: bodyHash 없는 토큰은 STEPUP_BODY_UNBOUND', async () => {
    const unboundToken = await phoneApproves(PRESCRIBER, undefined); // bodyHash 없이 발급(구 경로 모사)

    await expect(
      service.create(ENCOUNTER, dto, CLERK, undefined, { prescriberId: PRESCRIBER, prescriberStepUpToken: unboundToken }),
    ).rejects.toThrow(/STEPUP_BODY_UNBOUND|바인딩/);
  });

  it('인증 누락 차단: 위임인데 토큰 미동봉 시 PRESCRIBER_AUTH_REQUIRED', async () => {
    await expect(
      service.create(ENCOUNTER, dto, CLERK, undefined, { prescriberId: PRESCRIBER }),
    ).rejects.toThrow(/PRESCRIBER_AUTH_REQUIRED|승인.*필요/);
  });
});
