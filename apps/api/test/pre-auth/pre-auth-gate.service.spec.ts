import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreAuthGateService } from '../../src/modules/pre-auth/pre-auth-gate.service';

// 사전승인 발행 게이트 — 마약류 처방 (OFF 통과·응급 우회·BLOCK 차단·WARN 감사)
describe('PreAuthGateService 마약류 게이트', () => {
  let gate: PreAuthGateService;
  let configMap: Record<string, unknown>;
  let prisma: any;

  const CTX = { patientId: 'pat-1', encounterId: 'enc-1', medicationCodeId: 'med-1', controlSchedule: 'II' };

  beforeEach(() => {
    configMap = { 'preauth.enforce': { NARCOTIC_RX: 'BLOCK' } };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    prisma = {
      preAuthRequest: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'pa-post' })), updateMany: vi.fn(async () => ({ count: 1 })) },
      procedureCode: { findUnique: vi.fn(async () => ({ unitPrice: 300000, code: 'HA401', category: 'IMAGING' })) },
    };
    gate = new PreAuthGateService(prisma, configRuntime as any);
  });

  const assert = (extra?: any) => gate.assertNarcoticGate({ ...CTX, ...extra });

  it('게이트 OFF(미설정)면 즉시 통과 — no-op', async () => {
    configMap = {};
    const r = await assert();
    expect(r.ok).toBe(true);
    expect(prisma.preAuthRequest.create).not.toHaveBeenCalled();
  });

  it('preAuthRef 동반(승인 훅 발행)이면 통과', async () => {
    const r = await assert({ preAuthRef: 'pa-1' });
    expect(r.ok).toBe(true);
    expect(prisma.preAuthRequest.findFirst).not.toHaveBeenCalled();
  });

  it('BLOCK + 승인 없음 → 차단', async () => {
    await expect(assert()).rejects.toThrow(/사전승인이 필요/);
  });

  it('BLOCK + 승인된 사전승인 존재 → 1회 소비(CONSUMED) 후 통과', async () => {
    prisma.preAuthRequest.findFirst = vi.fn(async () => ({ id: 'pa-approved' }));
    const r = await assert();
    expect(r.ok).toBe(true);
    // 원자 소비 — APPROVED→CONSUMED claim
    expect(prisma.preAuthRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pa-approved', status: 'APPROVED' }, data: { status: 'CONSUMED' } }));
  });

  it('BLOCK + 승인 존재하나 경합으로 이미 소비됨(claim 실패) → 차단(H1)', async () => {
    prisma.preAuthRequest.findFirst = vi.fn(async () => ({ id: 'pa-approved' }));
    prisma.preAuthRequest.updateMany = vi.fn(async () => ({ count: 0 })); // 다른 발행이 먼저 소비
    await expect(assert()).rejects.toThrow(/사전승인이 필요/);
  });

  it('응급(emergency=true + 사유) → BLOCK이어도 우회 발행 + 사후승인 큐', async () => {
    const r = await assert({ emergency: true, bypassReason: '응급실 STAT 처방' });
    expect(r.ok).toBe(true);
    expect(r.bypassed).toBe(true);
    expect(prisma.preAuthRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'POST_FACTO_PENDING' }) }));
  });

  it('응급이라도 사유(bypassReason) 없으면 차단(H2)', async () => {
    await expect(assert({ emergency: true })).rejects.toThrow(/사유/);
  });

  it('priority=STAT만으로는 우회 불가 — BLOCK 차단(H2 자가선언 우회 방지)', async () => {
    await expect(assert({ priority: 'STAT' })).rejects.toThrow(/사전승인이 필요/);
    expect(prisma.preAuthRequest.create).not.toHaveBeenCalled();
  });

  it('WARN + 승인 없음 → 통과하되 사후 큐 기록', async () => {
    configMap = { 'preauth.enforce': { NARCOTIC_RX: 'WARN' } };
    const r = await assert();
    expect(r.ok).toBe(true);
    expect(r.bypassed).toBe(true);
    expect(prisma.preAuthRequest.create).toHaveBeenCalled();
  });

  // 고가검사 판정(config 기반)
  const isHighCost = (pid = 'proc-1') => gate.isHighCostImaging(pid);

  it('고가검사 판정 — config 미설정이면 false(비고가)', async () => {
    configMap = {};
    expect(await isHighCost()).toBe(false);
  });

  it('고가검사 판정 — minUnitPrice 임계값 이상이면 true', async () => {
    configMap = { 'preauth.imaging': { minUnitPrice: 200000 } };
    expect(await isHighCost()).toBe(true);
  });

  it('고가검사 판정 — codePrefixes 매칭이면 true', async () => {
    configMap = { 'preauth.imaging': { codePrefixes: ['HA4'] } };
    expect(await isHighCost()).toBe(true);
  });

  it('고가검사 판정 — categories 매칭이면 true', async () => {
    configMap = { 'preauth.imaging': { categories: ['IMAGING'] } };
    expect(await isHighCost()).toBe(true);
  });

  it('고가검사 판정 — 어느 기준도 미매칭이면 false', async () => {
    configMap = { 'preauth.imaging': { minUnitPrice: 999999, codePrefixes: ['ZZ'], categories: ['LAB'] } };
    expect(await isHighCost()).toBe(false);
  });

  // 공용 choke point — 모든 발행 경로가 호출(F1~F3)
  describe('assertOrderGate (공용 게이트)', () => {
    const order = (item: any, ctx: any = { patientId: 'p1' }) => gate.assertOrderGate(item, ctx);

    it('마약류(control_schedule) 처방 → NARCOTIC_RX 게이트 적용', async () => {
      configMap = { 'preauth.enforce': { NARCOTIC_RX: 'BLOCK' } };
      prisma.medicationCode = { findUnique: vi.fn(async () => ({ controlSchedule: 'II' })) };
      await expect(order({ type: 'MEDICATION', medicationCodeId: 'm1' })).rejects.toThrow(/사전승인이 필요/);
    });

    it('일반 약물(control_schedule=null)은 게이트 없음 — 통과', async () => {
      configMap = { 'preauth.enforce': { NARCOTIC_RX: 'BLOCK' } };
      prisma.medicationCode = { findUnique: vi.fn(async () => ({ controlSchedule: null })) };
      await expect(order({ type: 'MEDICATION', medicationCodeId: 'm1' })).resolves.toEqual({ postFactoId: undefined });
    });

    it('고가검사(IMAGING+판정)면 HIGH_COST_IMAGING 게이트 적용', async () => {
      configMap = { 'preauth.enforce': { HIGH_COST_IMAGING: 'BLOCK' }, 'preauth.imaging': { categories: ['IMAGING'] } };
      await expect(order({ type: 'IMAGING', procedureCodeId: 'proc-1' })).rejects.toThrow(/사전승인이 필요/);
    });

    it('비고가 검사(config 미판정)는 게이트 없음 — 통과', async () => {
      configMap = { 'preauth.enforce': { HIGH_COST_IMAGING: 'BLOCK' } }; // preauth.imaging 미설정 → isHighCostImaging false
      await expect(order({ type: 'IMAGING', procedureCodeId: 'proc-1' })).resolves.toEqual({ postFactoId: undefined });
    });
  });
});
