/**
 * 위원회가 할 일을 화면에서 안건으로(2026-10-07).
 *  · 집행 엔진 MASTER_DATA `quality-indicator` — 필수·허용 필드·목표 범위·방향 어휘 · 미배선이면 의결 시점 거부 · create/update 는 원장 정본 서비스로
 *  · 안건 다리 — 담당 위원회는 표면 매핑이 정한다(없으면 400) · 열린 같은 안건 409 · 선택지 enact 는 올릴 때 엔진 검증 · 출처(sourceRef) 남김
 *  · 주의 기준 안건 — 1~1440 정수 · 빈 후보·중복 후보 거부 · CONFIG_CHANGE 후보 + "정하지 않음"(enact null)
 *  · CPOE 지표 안건 — 방향: 원장 → 등재표 → 제안자(이름 추정 HINT 는 안 씀) · 미등록이면 create · 등록이면 update(id) · 목표 0~100
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { GovernanceEnactmentService } from '../../src/modules/gld/governance-enactment.service';
import { CommitteeAgendaService } from '../../src/modules/order-governance/committee-agenda.service';
import { AttentionAgendaService } from '../../src/modules/order-governance/attention-agenda.service';
import { CpoeAgendaService } from '../../src/modules/cpoe-quality/cpoe-agenda.service';

function engine(quality?: Record<string, unknown> | null) {
  const config = { hasDefault: () => true, get: vi.fn(async () => null), set: vi.fn(async () => ({})) };
  const stub = () => ({});
  const prisma = { qualityIndicator: { findUnique: vi.fn(async () => ({ id: 'qi1', targetValue: 10 })) } };
  const args: unknown[] = [prisma, config, undefined, undefined, ...Array.from({ length: 16 }, stub), quality === null ? undefined : (quality ?? { createIndicator: vi.fn(async (p: object) => ({ id: 'new', ...p })), updateIndicator: vi.fn(async () => ({})) })];
  return new (GovernanceEnactmentService as unknown as new (...a: unknown[]) => GovernanceEnactmentService)(...args);
}
const create = (payload: Record<string, unknown>) => ({ master: 'quality-indicator', op: 'create', payload });
const okPayload = { name: 'CPOE 처방 상병 미연결률', category: 'CPOE', formula: 'a / b × 100', targetValue: 10, direction: 'LOWER_IS_BETTER', unit: '%', valueScale: 100 };

describe('집행 엔진 — 질 지표 원장 바인딩', () => {
  it('🔴 create 는 이름·분류·산식·목표 필수 · 허용 밖 필드 거부 · 목표 0~999.99 · 방향 어휘', () => {
    const e = engine();
    expect(() => e.validateAction('MASTER_DATA', create(okPayload))).not.toThrow();
    expect(() => e.validateAction('MASTER_DATA', create({ ...okPayload, name: ' ' }))).toThrow();
    expect(() => e.validateAction('MASTER_DATA', create({ ...okPayload, isActive: false }))).toThrow();
    expect(() => e.validateAction('MASTER_DATA', create({ ...okPayload, targetValue: 1000 }))).toThrow();
    expect(() => e.validateAction('MASTER_DATA', create({ ...okPayload, targetValue: '10' }))).toThrow();
    expect(() => e.validateAction('MASTER_DATA', create({ ...okPayload, direction: 'LOWER' }))).toThrow();
  });

  it('🔴 update 는 판정 값만(이름·산식은 못 바꾼다) · id 필요', () => {
    const e = engine();
    expect(() => e.validateAction('MASTER_DATA', { master: 'quality-indicator', op: 'update', id: 'qi1', payload: { targetValue: 8 } })).not.toThrow();
    expect(() => e.validateAction('MASTER_DATA', { master: 'quality-indicator', op: 'update', id: 'qi1', payload: { name: '다른 지표' } })).toThrow();
    expect(() => e.validateAction('MASTER_DATA', { master: 'quality-indicator', op: 'update', payload: { targetValue: 8 } })).toThrow();
  });

  it('🔴 원장 서비스가 배선되지 않았으면 의결 시점에 거부(조용한 no-op 아님)', () => {
    expect(() => engine(null).validateAction('MASTER_DATA', create(okPayload))).toThrow(/QualityService|미배선/);
  });

  it('집행 — create/update 는 원장 정본 서비스로', async () => {
    const quality = { createIndicator: vi.fn(async (p: object) => ({ id: 'new', ...p })), updateIndicator: vi.fn(async () => ({})) };
    const e = engine(quality) as unknown as { executeAction: (k: string, t: object, c: object) => Promise<unknown> };
    const ctx = { decisionNo: 'GOV-2026-099', committeeCode: 'QPS', userId: 'u1' };
    expect(await e.executeAction('MASTER_DATA', create(okPayload), ctx)).toMatchObject({ master: 'quality-indicator', id: 'new' });
    expect(quality.createIndicator).toHaveBeenCalledWith(okPayload);
    await e.executeAction('MASTER_DATA', { master: 'quality-indicator', op: 'update', id: 'qi1', payload: { targetValue: 8 } }, ctx);
    expect(quality.updateIndicator).toHaveBeenCalledWith('qi1', { targetValue: 8 });
  });
});

function bridge(opts: { owners?: { code: string | null; name: string }[]; open?: unknown; committee?: unknown } = {}) {
  const prisma: any = {
    committee: { findUnique: vi.fn(async () => (opts.committee === undefined ? { id: 'cQPS', code: 'QPS', name: '질향상·환자안전위원회' } : opts.committee)) },
    committeeAgenda: { findFirst: vi.fn(async () => opts.open ?? null), findMany: vi.fn(async () => []) },
  };
  const governance: any = {
    provenance: vi.fn(async () => ({ owners: opts.owners ?? [{ code: 'QPS', name: '질향상·환자안전위원회' }] })),
    submitAgenda: vi.fn(async (_u: string, dto: object) => ({ id: 'ag1', ...dto })),
  };
  const enactment: any = { validateAction: vi.fn() };
  return { svc: new CommitteeAgendaService(prisma, governance, enactment), prisma, governance, enactment };
}
const opt = { value: 'A', label: 'x', effect: 'y', enact: { kind: 'CONFIG_CHANGE', target: { key: 'k', newValue: 1 } } };

describe('안건 다리', () => {
  it('🔴 담당 위원회가 없으면 올리지 않는다(화면이 고르지 않는다)', async () => {
    await expect(bridge({ owners: [] }).svc.submit({ surfaceKey: 's', source: 'CPOE_QI', key: 'K', title: 't', body: 'b', options: [opt] }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'AGENDA_NO_OWNER' } });
  });

  it('🔴 열린 같은 안건이 있으면 409', async () => {
    await expect(bridge({ open: { id: 'old', status: 'SCHEDULED' } }).svc.submit({ surfaceKey: 's', source: 'CPOE_QI', key: 'K', title: 't', body: 'b', options: [opt] }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'AGENDA_OPEN', agendaId: 'old' } });
  });

  it('🔴 선택지 enact 는 올릴 때 엔진 검증 · 담당 위원회·출처를 남겨 정본 경로로 올린다', async () => {
    const { svc, enactment, governance } = bridge();
    await svc.submit({ surfaceKey: 'master:quality-indicator', source: 'CPOE_QI', key: 'NO_DIAGNOSIS', title: 't', body: 'b', options: [opt, { value: 'NONE', label: 'n', effect: 'e', enact: null }] }, 'u1');
    expect(enactment.validateAction).toHaveBeenCalledTimes(1);
    expect(governance.submitAgenda).toHaveBeenCalledWith('u1', expect.objectContaining({
      committeeId: 'cQPS', sourceRef: { type: 'CPOE_QI', key: 'NO_DIAGNOSIS', surfaceKey: 'master:quality-indicator' },
    }));
  });

  it('🔴 엔진이 거부하는 선택지면 올리지 않는다', async () => {
    const b = bridge();
    b.enactment.validateAction.mockImplementation(() => { throw new Error('BAD'); });
    await expect(b.svc.submit({ surfaceKey: 's', source: 'CPOE_QI', key: 'K', title: 't', body: 'b', options: [opt] }, 'u1')).rejects.toThrow('BAD');
    expect(b.governance.submitAgenda).not.toHaveBeenCalled();
  });
});

describe('오더 주의 기준 안건', () => {
  const mk = () => { const agendas: any = { submit: vi.fn(async (i: object) => i) }; return { svc: new AttentionAgendaService(agendas), agendas }; };

  it('🔴 후보마다 CONFIG_CHANGE · "정하지 않음"은 enact null', async () => {
    const { svc, agendas } = mk();
    await svc.propose({ candidates: [{ STAT: 30, ROUTINE: 240 }, { STAT: 60 }] }, 'u1');
    const input = agendas.submit.mock.calls[0][0];
    expect(input).toMatchObject({ surfaceKey: 'config:orders.tracking.attentionMin', source: 'ORDER_ATTENTION', key: 'orders.tracking.attentionMin' });
    expect(input.options[0].enact).toEqual({ kind: 'CONFIG_CHANGE', target: { key: 'orders.tracking.attentionMin', newValue: { STAT: 30, ROUTINE: 240 } } });
    expect(input.options[0].label).toBe('STAT 30 · ROUTINE 240 (min)');
    expect(input.options.at(-1)).toMatchObject({ value: 'NONE', enact: null });
  });

  it('🔴 범위 밖·빈 후보·중복 후보 거부', async () => {
    const { svc } = mk();
    await expect(svc.propose({ candidates: [{ STAT: 0 }] }, 'u1')).rejects.toMatchObject({ response: { code: 'ATTENTION_VALUE' } });
    await expect(svc.propose({ candidates: [{ STAT: 1441 }] }, 'u1')).rejects.toMatchObject({ response: { code: 'ATTENTION_VALUE' } });
    await expect(svc.propose({ candidates: [{}] }, 'u1')).rejects.toMatchObject({ response: { code: 'ATTENTION_EMPTY' } });
    await expect(svc.propose({ candidates: [{ STAT: 30 }, { STAT: 30 }] }, 'u1')).rejects.toMatchObject({ response: { code: 'ATTENTION_DUPLICATE' } });
  });
});

describe('CPOE 지표 안건', () => {
  const mk = (ledger: unknown[] = []) => {
    const prisma: any = { qualityIndicator: { findMany: vi.fn(async () => ledger) } };
    const agendas: any = { submit: vi.fn(async (i: object) => i) };
    return { svc: new CpoeAgendaService(prisma, agendas), agendas };
  };

  it('🔴 미등록 + 등재 방향 → create(원장 등록) · 방향은 등재표 · 마지막은 "정하지 않음"', async () => {
    const { svc, agendas } = mk();
    await svc.propose({ key: 'NO_DIAGNOSIS', targets: [10, 5] }, 'u1');
    const input = agendas.submit.mock.calls[0][0];
    expect(input).toMatchObject({ surfaceKey: 'master:quality-indicator', source: 'CPOE_QI', key: 'NO_DIAGNOSIS' });
    expect(input.options[0]).toMatchObject({ label: '≤ 10%', enact: { kind: 'MASTER_DATA', target: { master: 'quality-indicator', op: 'create', payload: { name: 'CPOE 처방 상병 미연결률', targetValue: 10, direction: 'LOWER_IS_BETTER', valueScale: 100 } } } });
    expect(input.options.at(-1)).toMatchObject({ value: 'NONE', enact: null });
  });

  it('🔴 등록된 지표는 update(id) — 이름·산식을 다시 보내지 않는다', async () => {
    const { svc, agendas } = mk([{ id: 'qi1', name: 'CPOE 처방 상병 미연결률', direction: 'LOWER_IS_BETTER', unit: '%', valueScale: 100, formula: 'x', targetValue: 10 }]);
    await svc.propose({ key: 'NO_DIAGNOSIS', targets: [8] }, 'u1');
    expect(agendas.submit.mock.calls[0][0].options[0].enact.target).toEqual({ master: 'quality-indicator', op: 'update', id: 'qi1', payload: { targetValue: 8 } });
  });

  it('🔴 방향이 정해지지 않은 관찰 지표는 제안자가 방향을 골라야 · 이름 추정(HINT)은 방향으로 쓰지 않는다', async () => {
    await expect(mk().svc.propose({ key: 'VERBAL_RATE', targets: [5] }, 'u1')).rejects.toMatchObject({ response: { code: 'QI_DIRECTION_REQUIRED' } });
    // '처방 취소율' 은 이름 보조신호로 LOWER 가 잡히지만 그것을 정책으로 박지 않는다
    await expect(mk().svc.propose({ key: 'RX_CANCEL_RATE', targets: [5] }, 'u1')).rejects.toMatchObject({ response: { code: 'QI_DIRECTION_REQUIRED' } });
    const { svc, agendas } = mk();
    await svc.propose({ key: 'VERBAL_RATE', targets: [5], direction: 'LOWER_IS_BETTER' }, 'u1');
    expect(agendas.submit.mock.calls[0][0].options[0].enact.target.payload.direction).toBe('LOWER_IS_BETTER');
  });

  it('목표 범위·중복 후보 거부', async () => {
    await expect(mk().svc.propose({ key: 'NO_DIAGNOSIS', targets: [120] }, 'u1')).rejects.toMatchObject({ response: { code: 'QI_TARGET_RANGE' } });
    await expect(mk().svc.propose({ key: 'NO_DIAGNOSIS', targets: [10, 10] }, 'u1')).rejects.toMatchObject({ response: { code: 'QI_TARGET_DUPLICATE' } });
  });
});
