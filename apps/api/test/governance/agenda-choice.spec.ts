import { describe, it, expect, vi } from 'vitest';
import { GovernanceService } from '../../src/modules/gld/governance.service';
import { CHOSEN_MODIFIED, type DecisionOptionShape } from '@hospital-run/shared';

/**
 * 의결 시 **선택** 배선 (2026-08-27 · 계획서 §3.1 · 가드 G1·G3·G13).
 *
 * 🔴 단위 함수가 통과하는 것과 **의결 경로가 실제로 그렇게 동작하는 것**은 다른 일이다.
 *    종전 `resolveAgenda` 는 `dto.actions` 를 그대로 원장에 넣었다 — 위원이 손으로 타이핑한 값이다.
 *    이제 고른 선택지의 `enact` 가 그 자리를 차지한다.
 *
 * 재주입: `effectiveActions` 를 `dto.actions` 로 되돌리거나 선택 검증을 지우면 아래가 실패한다.
 */
const OPTS: DecisionOptionShape[] = [
  { value: 'KEEP', label: '유지', effect: '그대로', enact: null },
  { value: 'BLOCK', label: 'BLOCK 승격', effect: '게이트를 막는다', enact: { kind: 'GATE_MODE', target: { key: 'dur.enforce', mode: 'BLOCK' } } },
];

function makeSvc(agendaOptions: unknown) {
  const created: Record<string, unknown>[] = [];
  const tx = {
    $executeRaw: vi.fn(),
    committeeDecision: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'dec-1', decisionNo: 'GOV-2026-001', resolution: data.resolution, actions: [] };
      }),
      update: vi.fn(),
    },
    committeeAgenda: { update: vi.fn() },
  };
  const prisma = {
    committeeAgenda: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'ag-1', committeeId: 'c-1', meetingId: 'm-1', status: 'SCHEDULED',
        options: agendaOptions, committee: { id: 'c-1', quorum: 1 },
      }),
    },
    committeeMember: { findMany: vi.fn().mockResolvedValue([]) },
    committeeMeeting: { findUnique: vi.fn().mockResolvedValue({ attendees: [{ id: 'u1' }, { id: 'u2' }] }) },
    committeeDecision: { update: vi.fn() },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const enactment = { validateAction: vi.fn() };
  const svc = new GovernanceService(prisma as never, enactment as never, undefined, undefined, undefined);
  // 봉인은 비차단 부수효과 — 이 테스트의 대상이 아니다
  (svc as never as { sealDecision: unknown }).sealDecision = vi.fn(async () => undefined);
  return { svc, created, tx, enactment };
}

describe('resolveAgenda — 선택지가 있으면 골라야 한다', () => {
  it('🔴 G1 — 선택지 있는 안건을 산문만으로 의결하면 거부한다', async () => {
    const { svc } = makeSvc(OPTS);
    await expect(svc.resolveAgenda('ag-1', { resolution: 'B안으로 의결함' }))
      .rejects.toThrowError(/선택지|CHOICE_REQUIRED/);
  });

  it('🔴 G3 — 고른 선택지의 enact 가 그대로 집행 액션이 된다(사람이 보낸 값이 아니다)', async () => {
    const { svc, created, enactment } = makeSvc(OPTS);
    await svc.resolveAgenda('ag-1', {
      resolution: 'BLOCK 승격으로 의결',
      chosenOption: { value: 'BLOCK', snapshot: OPTS },
    });
    const data = created[0];
    expect((data.actions as { create: unknown[] }).create).toEqual([
      expect.objectContaining({ kind: 'GATE_MODE', target: { key: 'dur.enforce', mode: 'BLOCK' } }),
    ]);
    // 검증도 그 값으로 돈다
    expect(enactment.validateAction).toHaveBeenCalledWith('GATE_MODE', { key: 'dur.enforce', mode: 'BLOCK' });
  });

  it('🔴 선택지 있는 안건에 액션을 손으로 보내면 거부한다(정본이 둘이 된다)', async () => {
    const { svc } = makeSvc(OPTS);
    await expect(svc.resolveAgenda('ag-1', {
      resolution: 'x', chosenOption: { value: 'BLOCK', snapshot: OPTS },
      actions: [{ kind: 'CONFIG_CHANGE', target: { key: 'other', value: 1 } }],
    })).rejects.toThrowError(/따로 보내지|ACTIONS_CONFLICT/);
  });

  it('🔴 G4 — enact:null 을 고르면 액션 0건이 정상이다', async () => {
    const { svc, created } = makeSvc(OPTS);
    await svc.resolveAgenda('ag-1', { resolution: '유지', chosenOption: { value: 'KEEP', snapshot: OPTS } });
    expect(created[0].actions).toBeUndefined();
  });

  it('🔴 G13 — 수정 의결은 원안의 enact 를 집행하지 않는다', async () => {
    const { svc, created } = makeSvc(OPTS);
    await svc.resolveAgenda('ag-1', {
      resolution: 'BLOCK 안을 수정하여 WARN 으로 의결',
      chosenOption: { value: CHOSEN_MODIFIED, snapshot: OPTS, note: 'BLOCK 대신 WARN 으로' },
    });
    // 🔴 원안(BLOCK)이 자동 집행되면 위원회가 의결하지 않은 것을 하는 셈이다
    expect(created[0].actions).toBeUndefined();
    expect((created[0].chosenOption as { value: string }).value).toBe(CHOSEN_MODIFIED);
  });

  it('🔴 G2 — 고른 선택은 스냅샷으로 저장된다(값만 저장하지 않는다)', async () => {
    const { svc, created } = makeSvc(OPTS);
    await svc.resolveAgenda('ag-1', { resolution: 'x', chosenOption: { value: 'BLOCK', snapshot: OPTS } });
    const chosen = created[0].chosenOption as { value: string; snapshot: unknown[] };
    expect(chosen.snapshot).toHaveLength(2);
    expect(chosen.snapshot).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'KEEP' })]));
  });

  it('선택지 없는 안건은 종전대로 자유서술 의결 + 손으로 보낸 액션 허용', async () => {
    const { svc, created } = makeSvc(null);
    await svc.resolveAgenda('ag-1', {
      resolution: '자유서술 의결',
      actions: [{ kind: 'MANUAL', target: { note: 'x' } }],
    });
    expect((created[0].actions as { create: unknown[] }).create).toHaveLength(1);
    expect(created[0].chosenOption).toBeUndefined();
  });

  it('🔴 근거는 집행 원장에 실린다 — 정본 밖 키는 버린다', async () => {
    const { svc, created } = makeSvc(OPTS);
    await svc.resolveAgenda('ag-1', {
      resolution: 'x', chosenOption: { value: 'BLOCK', snapshot: OPTS },
      basis: { legal: ['의료법 §22'], nope: ['버려야 한다'] },
    });
    const act = (created[0].actions as { create: Record<string, unknown>[] }).create[0];
    expect(act.basis).toEqual({ legal: ['의료법 §22'] });
  });
});
