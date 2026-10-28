import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Phase0CutoverService, CUTOVER_CHECKLIST } from '../../src/modules/phase0-cutover/phase0-cutover.service';
import { BadRequestException } from '@nestjs/common';

/** Phase0 컷오버 승인 게이트 — 법무 승인 없이 플립 차단 */
describe('Phase0CutoverService', () => {
  let svc: Phase0CutoverService;
  let store: Record<string, unknown>;
  let config: any; let prisma: any;

  const fullChecklist = () => Object.fromEntries(CUTOVER_CHECKLIST.map((c) => [c.key, true]));

  beforeEach(() => {
    store = { 'integration.pseudonymizeChartNo': false, 'integration.pseudonymKey': 'k', 'integration.cutoverApproval': {}, 'integration.cutoverRequireSeparation': true };
    config = { get: vi.fn(async (k: string) => store[k]), set: vi.fn(async (k: string, v: unknown) => { store[k] = v; }) };
    prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) }, patient: { count: vi.fn().mockResolvedValue(874) } };
    svc = new Phase0CutoverService(prisma, config);
  });

  it('승인 없이 execute → 차단', async () => {
    await expect(svc.execute('u1')).rejects.toThrow(BadRequestException);
    expect(store['integration.pseudonymizeChartNo']).toBe(false);
  });

  it('체크리스트 미완 승인 → 거부', async () => {
    await expect(svc.approve('u1', '홍', { reason: 'x', checklist: { mappingVerified: true } })).rejects.toThrow(BadRequestException);
  });

  it('사유 없는 승인 → 거부', async () => {
    await expect(svc.approve('u1', '홍', { reason: '', checklist: fullChecklist() })).rejects.toThrow(BadRequestException);
  });

  it('전항 확인+사유 → 승인 기록·감사', async () => {
    const r = await svc.approve('u1', '법무', { reason: 'CPO 검토 완료', checklist: fullChecklist() });
    expect(r.approved).toBe(true);
    expect((store['integration.cutoverApproval'] as any).approvedByName).toBe('법무');
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('승인 후 execute → 게이트 플립+실행 감사', async () => {
    await svc.approve('u1', '법무', { reason: 'ok', checklist: fullChecklist() });
    const r = await svc.execute('u2');
    expect(r.executed).toBe(true);
    expect(store['integration.pseudonymizeChartNo']).toBe(true);
    expect((store['integration.cutoverApproval'] as any).executedBy).toBe('u2');
  });

  it('키 미설정 시 execute 차단(승인돼도)', async () => {
    store['integration.pseudonymKey'] = '';
    await svc.approve('u1', '법무', { reason: 'ok', checklist: fullChecklist() });
    await expect(svc.execute('u2')).rejects.toThrow(BadRequestException);
  });

  it('rollback → 게이트 OFF 복귀·실행표시 제거', async () => {
    await svc.approve('u1', '법무', { reason: 'ok', checklist: fullChecklist() });
    await svc.execute('u2');
    await svc.rollback('u3');
    expect(store['integration.pseudonymizeChartNo']).toBe(false);
    expect((store['integration.cutoverApproval'] as any).executedAt).toBeUndefined();
  });

  it('status — 승인·실행 상태 종합', async () => {
    const s0 = await svc.status();
    expect(s0.approved).toBe(false);
    await svc.approve('u1', '법무', { reason: 'ok', checklist: fullChecklist() });
    const s1 = await svc.status();
    expect(s1.approved).toBe(true);
    expect(s1.canExecute).toBe(true);
  });

  it('직무분리 — 승인자 본인이 실행 시 차단(4-eyes)', async () => {
    await svc.approve('u1', '법무', { reason: 'ok', checklist: fullChecklist() });
    await expect(svc.execute('u1')).rejects.toThrow(BadRequestException); // 승인자 본인
    expect(store['integration.pseudonymizeChartNo']).toBe(false);
    const r = await svc.execute('u2'); // 다른 관리자
    expect(r.executed).toBe(true);
  });

  it('직무분리 완화(config false) — 승인자 본인 실행 허용', async () => {
    store['integration.cutoverRequireSeparation'] = false;
    await svc.approve('u1', '법무', { reason: 'ok', checklist: fullChecklist() });
    const r = await svc.execute('u1');
    expect(r.executed).toBe(true);
  });
});

