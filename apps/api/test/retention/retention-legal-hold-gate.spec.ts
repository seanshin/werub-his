import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { RetentionService } from '../../src/modules/retention/retention.service';

/**
 * 🔴 T10-7 — 법적 보존명령이 걸린 환자 기록은 **파기 입구에서** 제외된다 (2026-09-13).
 *
 * 지금 파기 핸들러는 PRE_BOARD_ACCOUNT(직원 임시계정) 하나라 환자 귀속이 없다. 그래서 이 가드는 "지금 새는가"가 아니라
 * **앞으로 환자 기록 파기·익명화 핸들러가 생길 때 보존명령을 건너뛰는 코드가 통과하지 못하는가**를 지킨다.
 *
 *  ① 환자 귀속 핸들러가 보존명령 제외를 선언하지 않으면 거부 — 승인도 소비하지 않는다.
 *  ② 보존명령 조회가 실패하면 거부(빈 집합으로 접지 않는다 · fail-closed).
 *  ③ 제외 집합이 핸들러에 그대로 전달된다.
 *  ④ 대조군 — 환자 귀속이 아닌 핸들러는 보존명령 조회 없이 종전대로 파기된다(성공을 실패로 말하지 않는다).
 */
type Handler = { count: () => Promise<unknown>; patientScoped?: boolean; honorsLegalHold?: boolean; purge?: (c: Date, ctx: { heldPatientIds: ReadonlySet<string> }) => Promise<number> };

function setup(handler: Handler, legalHold: { heldPatientIds: () => Promise<ReadonlySet<string>> }) {
  const prisma = {
    retentionPolicy: {
      findUnique: vi.fn(async () => ({ id: 'p1', resourceType: 'X', retentionDays: 10, legalMinDays: 0, action: 'SOFT_DELETE', legalConfirmed: true, enabled: true })),
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  const config = { get: vi.fn(async () => true) };
  const approval = { consume: vi.fn(async () => undefined) };
  const svc = new RetentionService(prisma as never, audit as never, config as never, approval as never, legalHold as never);
  (svc as unknown as { handlers: () => Record<string, Handler> }).handlers = () => ({ X: handler });
  return { svc, approval };
}

describe('파기 입구 — 법적 보존명령', () => {
  it('① 환자 귀속인데 보존명령 제외를 선언하지 않으면 거부 · 승인을 소비하지 않는다', async () => {
    const purge = vi.fn(async () => 3);
    const { svc, approval } = setup({ count: vi.fn(), patientScoped: true, purge }, { heldPatientIds: vi.fn(async () => new Set<string>()) });
    await expect(svc.purge('X', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(purge).not.toHaveBeenCalled();
    expect(approval.consume).not.toHaveBeenCalled();
  });

  it('② 🔴 보존명령 조회 실패 → 파기 거부(빈 집합으로 접지 않는다)', async () => {
    const purge = vi.fn(async () => 3);
    const { svc, approval } = setup({ count: vi.fn(), patientScoped: true, honorsLegalHold: true, purge }, { heldPatientIds: vi.fn(async () => { throw new Error('db down'); }) });
    await expect(svc.purge('X', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(purge).not.toHaveBeenCalled();
    expect(approval.consume).not.toHaveBeenCalled();
  });

  it('③ 제외 집합이 핸들러에 전달된다', async () => {
    const held = new Set(['pat-a', 'pat-b']);
    const purge = vi.fn(async () => 1);
    const { svc } = setup({ count: vi.fn(), patientScoped: true, honorsLegalHold: true, purge }, { heldPatientIds: vi.fn(async () => held) });
    await svc.purge('X', 'u1');
    expect(purge).toHaveBeenCalledTimes(1);
    expect((purge.mock.calls[0] as unknown[])[1]).toEqual({ heldPatientIds: held });
  });

  it('④ 대조군 — 환자 귀속이 아닌 핸들러는 보존명령 조회 없이 파기된다', async () => {
    const heldPatientIds = vi.fn(async () => { throw new Error('호출되면 안 된다'); });
    const purge = vi.fn(async () => 2);
    const { svc } = setup({ count: vi.fn(), purge }, { heldPatientIds });
    const r = await svc.purge('X', 'u1');
    expect(r.purged).toBe(2);
    expect(heldPatientIds).not.toHaveBeenCalled();
  });

  it('구조 — 실제 핸들러 중 환자 귀속 파기가 있으면 보존명령 제외를 선언한다', () => {
    const svc = new RetentionService({} as never, {} as never, {} as never, {} as never, {} as never);
    const handlers = (svc as unknown as { handlers: () => Record<string, Handler> }).handlers();
    const bad = Object.entries(handlers).filter(([, h]) => h.patientScoped && h.purge && !h.honorsLegalHold).map(([k]) => k);
    expect(bad).toEqual([]);
    expect(Object.keys(handlers).length, '대조군 — 핸들러를 하나도 못 읽었다').toBeGreaterThan(3);
  });
});
