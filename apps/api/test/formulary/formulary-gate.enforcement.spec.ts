import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { FormularyGateService } from '../../src/modules/formulary/formulary-gate.service';
import { PrescriptionService } from '../../src/modules/prescription/prescription.service';
import { PrescriptionModule } from '../../src/modules/prescription/prescription.module';

/**
 * 원내 처방집 시행 게이트 — 서버 집행 가드(W8-R2 F1/F2/F3, 2026-08-14).
 *
 * 이 스펙이 지키는 사실 네 가지:
 *  ① 미지 게이트값은 BLOCK 으로 해석된다(fail-closed·정본 common/gate-mode.ts)
 *  ② 처방 발행 3경로(create·copy·repeat)가 게이트를 실제로 부른다 + DI 에 배선돼 있다
 *  ③ WARN 은 막지 않되 위반을 GateViolationLog 에 남긴다
 *  ④ FE 확인창을 거치지 않는 직접 API 호출도 동일하게 집행된다
 */

function makeGatePrisma() {
  return {
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    formularyItem: { findFirst: vi.fn().mockResolvedValue(null) },
    gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
    medicationCode: { findUnique: vi.fn().mockResolvedValue({ code: 'M001', nameKo: '아목시실린' }) },
    procedureCode: { findUnique: vi.fn().mockResolvedValue({ code: 'B001', nameKo: '일반혈액검사' }) },
  };
}

/** config.get 을 키별로 답하게 하는 스텁 */
function makeConfig(values: Record<string, unknown>) {
  return { get: vi.fn(async (k: string) => values[k] ?? null), set: vi.fn() };
}

const logged = (prisma: ReturnType<typeof makeGatePrisma>) =>
  prisma.gateViolationLog.create.mock.calls.map((c) => (c[0] as { data: { severity: string; message: string; gateKey: string } }).data);

describe('원내 처방집 시행 게이트 — 정책 해석(F2)', () => {
  let prisma: ReturnType<typeof makeGatePrisma>;

  beforeEach(() => { prisma = makeGatePrisma(); });

  const gateWith = (value: unknown) => new FormularyGateService(prisma as never, makeConfig({ 'formulary.enforce': value }) as never);

  it('① 미지값(오타·임의 문자열)은 BLOCK 으로 잠긴다 — 조용히 OFF 로 떨어지지 않는다', async () => {
    const p = await gateWith({ MEDICATION: 'HACK', LAB: 'BLOCKED', IMAGING: '차단', DIET: 1 }).getPolicy();
    expect(p.MEDICATION).toBe('BLOCK');
    expect(p.LAB).toBe('BLOCK');
    expect(p.IMAGING).toBe('BLOCK');
    expect(p.DIET).toBe('BLOCK');
  });

  it('명시적 완화(OFF/WARN)는 공백·대소문자만 달라도 그대로 인정하고, 키 부재는 OFF(미설정)', async () => {
    const p = await gateWith({ MEDICATION: ' warn ', LAB: 'off' }).getPolicy();
    expect(p.MEDICATION).toBe('WARN');
    expect(p.LAB).toBe('OFF');
    expect(p.NURSING).toBe('OFF');
  });

  it('설정 자체가 없으면 전 영역 OFF(현행 무회귀)', async () => {
    const p = await gateWith(null).getPolicy();
    expect(Object.values(p).every((m) => m === 'OFF')).toBe(true);
  });
});

describe('원내 처방집 시행 게이트 — 집행점 표(F3)', () => {
  it('프리셋(치료·활동)·간호지시는 처방 레코드에 대조 키가 없어 집행 불가임을 사실대로 낸다', async () => {
    const prisma = makeGatePrisma();
    const e = await new FormularyGateService(prisma as never, makeConfig({ 'formulary.enforce': { MEDICATION: 'WARN' } }) as never).enforcement();
    expect(e.MEDICATION.enforced).toBe(true);
    // 집행됨이어도 아직 배선 안 된 발행 경로는 숨기지 않는다(P17 — '전부'가 아닌 것을 전부라 하지 않는다).
    // 🔴 2026-08-14 반전 — 우회 경로 2건(pre-order·remote-consultation)을 같은 날 봉합해 목록이 비었다.
    //    **화면이 실제보다 덜 안전하게 말하는 것도 사실이 아니다.** 이제는 비어 있는 것이 정답이고,
    //    새 우회 경로가 생기면 `formulary-gate.bypass-paths.spec.ts` 의 구조 가드가 먼저 잡는다.
    expect(e.MEDICATION.notEnforcedAt).toEqual([]);
    expect(e.THERAPY.notEnforcedAt).toEqual([]);
    expect(e.LAB.enforced).toBe(true);
    expect(e.IMAGING.enforced).toBe(true);
    expect(e.DIET.enforced).toBe(true);
    for (const d of ['THERAPY', 'ACTIVITY', 'NURSING'] as const) {
      expect(e[d].enforced).toBe(false);
      expect(e[d].enforcedAt).toEqual([]);
      expect(e[d].reason).toBeTruthy(); // 왜 집행 못 하는지를 말한다
    }
  });
});

describe('원내 처방집 시행 게이트 — 판정(F1)', () => {
  let prisma: ReturnType<typeof makeGatePrisma>;
  const gate = (mode: unknown, domain = 'MEDICATION') =>
    new FormularyGateService(prisma as never, makeConfig({ 'formulary.enforce': { [domain]: mode } }) as never);
  const MED = { type: 'MEDICATION', medicationCodeId: 'm-1' };
  const CTX = { encounterId: 'enc-1', path: 'CREATE' as const };

  beforeEach(() => { prisma = makeGatePrisma(); });

  it('③ WARN + 미등재 — 막지 않되 위반을 GateViolationLog 에 남긴다', async () => {
    const r = await gate('WARN').assertOrderAllowed(MED, CTX);
    expect(r.outcome).toBe('WARN');
    expect(logged(prisma)).toEqual([
      expect.objectContaining({ gateKey: 'formulary.enforce', severity: 'WARN', message: expect.stringContaining('미등재') }),
    ]);
  });

  it('BLOCK + 미등재 — 차단(FORBIDDEN)하고 BLOCK 위반을 남긴다', async () => {
    await expect(gate('BLOCK').assertOrderAllowed(MED, CTX)).rejects.toThrow(ForbiddenException);
    expect(logged(prisma)[0]).toEqual(expect.objectContaining({ severity: 'BLOCK' }));
  });

  it('BLOCK + 위원회 사용중지(SUSPENDED) — 차단하고 사유를 구분해 남긴다', async () => {
    prisma.formularyItem.findFirst.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(gate('BLOCK').assertOrderAllowed(MED, CTX)).rejects.toThrow(ForbiddenException);
    expect(logged(prisma)[0].message).toContain('사용중지');
  });

  it('승인(ACTIVE) — 통과하고 아무것도 기록하지 않는다', async () => {
    prisma.formularyItem.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    const r = await gate('BLOCK').assertOrderAllowed(MED, CTX);
    expect(r.outcome).toBe('APPROVED');
    expect(prisma.gateViolationLog.create).not.toHaveBeenCalled();
  });

  it('OFF + 미등재 — 통과하되 승격 판단용으로 OFF 를 기록한다(DUR 게이트 선례)', async () => {
    const r = await gate('OFF').assertOrderAllowed(MED, CTX);
    expect(r.outcome).toBe('OFF');
    expect(logged(prisma)[0]).toEqual(expect.objectContaining({ severity: 'OFF' }));
  });

  it('집행점 없는 영역(THERAPY)은 BLOCK 이어도 막지 않고 "판정 불가"로 기록한다 — 막은 척하지 않는다', async () => {
    const r = await gate('BLOCK', 'THERAPY').assertOrderAllowed({ type: 'THERAPY' }, CTX);
    expect(r.outcome).toBe('UNENFORCEABLE');
    expect(logged(prisma)[0]).toEqual(expect.objectContaining({ severity: 'UNCHECKED', message: expect.stringContaining('집행점 없음') }));
  });

  it('코드 없는 자유기재 오더는 BLOCK 이어도 막지 않고 "판정 불가"로 기록한다(모름을 준수로 세지 않는다)', async () => {
    const r = await gate('BLOCK', 'LAB').assertOrderAllowed({ type: 'LAB', procedureCodeId: null }, CTX);
    expect(r.outcome).toBe('UNCHECKED');
    expect(logged(prisma)[0]).toEqual(expect.objectContaining({ severity: 'UNCHECKED' }));
    expect(prisma.formularyItem.findFirst).not.toHaveBeenCalled();
  });

  it('포뮬러리 영역이 아닌 타입은 게이트 밖(설정 조회조차 하지 않는다)', async () => {
    const r = await gate('BLOCK').assertOrderAllowed({ type: 'UNKNOWN_TYPE' }, CTX);
    expect(r.outcome).toBe('SKIPPED');
    expect(prisma.gateViolationLog.create).not.toHaveBeenCalled();
  });
});

/**
 * ②④ 처방 발행 경로가 게이트를 실제로 부르는가 —
 * FE(진료 작성 화면)의 확인창을 거치지 않는 **서비스 직접 호출**(=모바일·워크스테이션·API)로 검증한다.
 * 종전엔 이 경로가 전부 무검사 통과였다.
 */
describe('처방 발행 경로 서버 집행(F1) — FE 우회 호출', () => {
  let prisma: any;
  let gatePrisma: ReturnType<typeof makeGatePrisma>;
  let service: PrescriptionService;

  const build = (formularyValue: unknown) => {
    gatePrisma = makeGatePrisma();
    const gateConfig = makeConfig({ 'formulary.enforce': formularyValue });
    const gate = new FormularyGateService(gatePrisma as never, gateConfig as never);
    prisma = {
      encounter: { findUnique: vi.fn().mockResolvedValue({ id: 'enc-1', patientId: 'p-1', status: 'DRAFT', admissionId: null }) },
      prescription: { findMany: vi.fn(), findUnique: vi.fn() },
      medicationCode: { findUnique: vi.fn().mockResolvedValue(null) },
      gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async () => ({ prescription: { id: 'rx-1' }, orderId: 'o-1' })),
    };
    const config = makeConfig({}); // dur/cdss/prescriberRules 전부 미설정
    service = new PrescriptionService(
      prisma, { checkInteractions: vi.fn().mockResolvedValue([]) } as never, { emit: vi.fn() } as never, {} as never,
      config as never, {} as never, {} as never, { safeLog: vi.fn() } as never, {} as never,
      undefined, undefined, undefined, gate,
    );
    vi.spyOn(service as never as { resolvePrescriber: () => Promise<string> }, 'resolvePrescriber').mockResolvedValue('doc-1');
    vi.spyOn(service as never as { assertPreAuthForOrder: () => Promise<object> }, 'assertPreAuthForOrder').mockResolvedValue({});
    return service;
  };

  it('create — BLOCK + 미승인 약품은 트랜잭션 진입 전에 차단된다', async () => {
    const svc = build({ MEDICATION: 'BLOCK' });
    await expect(svc.create('enc-1', { type: 'MEDICATION', medicationCodeId: 'm-1' } as never, 'doc-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(logged(gatePrisma)[0]).toEqual(expect.objectContaining({ severity: 'BLOCK', message: expect.stringContaining('[CREATE/MEDICATION]') }));
  });

  it('create — 운영 현재 모드(MEDICATION=WARN)는 처방을 막지 않고 위반만 남긴다', async () => {
    const svc = build({ MEDICATION: 'WARN' });
    const r = await svc.create('enc-1', { type: 'MEDICATION', medicationCodeId: 'm-1' } as never, 'doc-1');
    expect(r.prescription).toEqual({ id: 'rx-1' });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(logged(gatePrisma)[0]).toEqual(expect.objectContaining({ severity: 'WARN' }));
  });

  it('create — 미지 게이트값이면 fail-closed 로 차단된다(설정 오타가 통제를 끄지 못한다)', async () => {
    const svc = build({ MEDICATION: 'WRN' });
    await expect(svc.create('enc-1', { type: 'MEDICATION', medicationCodeId: 'm-1' } as never, 'doc-1')).rejects.toThrow(ForbiddenException);
  });

  it('copyPrescriptions — 복사도 새 발행이라 게이트를 통과해야 한다', async () => {
    const svc = build({ MEDICATION: 'BLOCK' });
    prisma.encounter.findUnique
      .mockResolvedValueOnce({ id: 'enc-t', patientId: 'p-1', status: 'DRAFT' })
      .mockResolvedValueOnce({ id: 'enc-s', patientId: 'p-1', status: 'DRAFT' });
    prisma.prescription.findMany.mockResolvedValue([{ id: 'src-1', type: 'MEDICATION', medicationCodeId: 'm-1', priority: 'ROUTINE' }]);
    await expect(svc.copyPrescriptions('enc-s', 'enc-t', 'doc-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(logged(gatePrisma)[0].message).toContain('[COPY/MEDICATION]');
  });

  it('copyFromEncounter — 같은 게이트를 통과해야 한다', async () => {
    const svc = build({ MEDICATION: 'BLOCK' });
    prisma.prescription.findMany.mockResolvedValue([{ id: 'src-1', type: 'MEDICATION', medicationCodeId: 'm-1', priority: 'ROUTINE' }]);
    await expect(svc.copyFromEncounter('enc-t', 'enc-s', 'doc-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('repeatPrescription — 중지된 코드가 반복 갱신으로 되살아나지 않는다', async () => {
    const svc = build({ MEDICATION: 'BLOCK' });
    gatePrisma.formularyItem.findFirst.mockResolvedValue({ status: 'SUSPENDED' });
    prisma.prescription.findUnique.mockResolvedValue({
      id: 'rx-0', type: 'MEDICATION', medicationCodeId: 'm-1', encounterId: 'enc-1', priority: 'ROUTINE',
      encounter: { id: 'enc-1', patientId: 'p-1', status: 'DRAFT' },
    });
    await expect(svc.repeatPrescription('rx-0', 'doc-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(logged(gatePrisma)[0].message).toContain('[REPEAT/MEDICATION]');
  });
});

describe('게이트 DI 배선(F1) — provider 가 빠지면 게이트는 조용히 no-op 이 된다', () => {
  it('PrescriptionModule 이 FormularyGateService 를 provider 로 등록한다', () => {
    const providers = (Reflect.getMetadata('providers', PrescriptionModule) ?? []) as unknown[];
    expect(providers).toContain(FormularyGateService);
  });
});
