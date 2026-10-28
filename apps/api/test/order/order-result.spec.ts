import { describe, it, expect, vi } from 'vitest';
import { OrderService } from '../../src/modules/order/order.service';

/**
 * 오더 결과·시행 기록(2026-09-29 사람 요청 "처방 결과·결과지·행위 종료를 해당 의료진이 기록").
 *  1. 범용 유형(치료·간호·활동·식이)은 요약·소견·실제 시행 시각을 **덧붙인다** — 정정은 새 항목(AMENDMENT), 원래 기록은 남는다
 *  2. 검사·영상·약은 전용 원장이 정본 — 여기서 받지 않는다(정본이 둘이 되지 않게)
 *  3. 🔴 완료는 시행 범위 안에서만 — 종전엔 누구나 검사·영상을 결과 없이 '완료'로 만들 수 있었다
 *  4. 모르는 시각을 박지 않는다 — 미래·오더 이전 시행 시각 거부
 */
type Row = { role: string; profession: string | null };
function build(user: Row, order: { status: string; type: string; result?: unknown; createdAt?: Date }) {
  const state = { result: order.result ?? null };
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ ...user, familyName: '김', givenName: '간호' })) },
    order: {
      findUnique: vi.fn(async () => ({ id: 'o1', status: order.status, createdAt: order.createdAt ?? new Date(Date.now() - 3600_000), result: state.result, prescription: { type: order.type } })),
      update: vi.fn(async ({ data }: { data: { result?: unknown } }) => { if (data.result !== undefined) state.result = data.result; return {}; }),
    },
  };
  const svc = new OrderService(prisma as never, {} as never);
  const changeStatus = vi.spyOn(svc, 'changeStatus').mockResolvedValue({} as never);
  return { svc, prisma, state, changeStatus };
}
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;

describe('오더 결과 기록(범용 유형)', () => {
  it('간호사 간호 오더 결과 — 항목이 덧붙고 완료는 전이 정본(시작→완료)을 지난다', async () => {
    const { svc, state, changeStatus } = build({ role: 'NURSE', profession: null }, { status: 'ORDERED', type: 'NURSING' });
    await svc.recordResult('o1', { summary: '체위변경 시행 · 발적 없음', performedAt: new Date(Date.now() - 600_000).toISOString(), complete: true }, 'n1');
    const doc = state.result as { entries: { kind: string; summary: string; performedAt: string | null; recordedBy: string }[] };
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ kind: 'RESULT', summary: '체위변경 시행 · 발적 없음', recordedBy: 'n1' });
    expect(changeStatus.mock.calls.map((c) => c[1])).toEqual(['IN_PROGRESS', 'COMPLETED']);
  });

  it('정정은 새 항목 — 원래 기록은 남는다 · 없는 기록을 정정할 수 없다', async () => {
    const first = { id: '11111111-1111-4111-8111-111111111111', kind: 'RESULT', summary: 'A', performedAt: null, recordedAt: 'x', recordedBy: 'n1' };
    const { svc, state } = build({ role: 'NURSE', profession: null }, { status: 'IN_PROGRESS', type: 'NURSING', result: { entries: [first], attachments: [] } });
    await svc.recordResult('o1', { summary: 'A 정정', amends: first.id }, 'n1');
    const doc = state.result as { entries: { kind: string; amends?: string; summary: string }[] };
    expect(doc.entries.map((e) => e.summary)).toEqual(['A', 'A 정정']);
    expect(doc.entries[1]).toMatchObject({ kind: 'AMENDMENT', amends: first.id });
    await expect(svc.recordResult('o1', { summary: 'x', amends: '22222222-2222-4222-8222-222222222222' }, 'n1')).rejects.toSatisfy((e) => code(e) === 'AMENDS_NOT_FOUND');
  });

  it('검사·영상·약은 전용 원장으로 안내(여기서 받지 않는다)', async () => {
    for (const type of ['LAB', 'IMAGING', 'MEDICATION']) {
      const { svc, prisma } = build({ role: 'DOCTOR', profession: null }, { status: 'IN_PROGRESS', type });
      await expect(svc.recordResult('o1', { summary: 'x' }, 'd1')).rejects.toSatisfy((e) => code(e) === 'ORDER_RESULT_DEDICATED');
      expect(prisma.order.update).not.toHaveBeenCalled();
    }
  });

  it('범위 밖 직종은 기록 불가 — 임상병리사(직종 미지정 LAB_TECH)의 치료 결과 · 원무의 간호 결과', async () => {
    await expect(build({ role: 'LAB_TECH', profession: null }, { status: 'IN_PROGRESS', type: 'THERAPY' }).svc.recordResult('o1', { summary: 'x' }, 'u'))
      .rejects.toSatisfy((e) => code(e) === 'ORDER_EXECUTION_SCOPE');
    await expect(build({ role: 'RECEPTIONIST', profession: null }, { status: 'IN_PROGRESS', type: 'NURSING' }).svc.recordResult('o1', { summary: 'x' }, 'u'))
      .rejects.toSatisfy((e) => code(e) === 'ORDER_EXECUTION_SCOPE');
  });

  it('물리치료사는 치료 결과를 기록한다', async () => {
    const { svc, state } = build({ role: 'LAB_TECH', profession: 'PHYSICAL_THERAPIST' }, { status: 'IN_PROGRESS', type: 'THERAPY' });
    await svc.recordResult('o1', { summary: 'ROM 운동 30분' }, 'pt');
    expect((state.result as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('모르는 시각을 박지 않는다 — 미래·오더 이전 시행 시각 거부 · 비우면 null', async () => {
    const mk = () => build({ role: 'NURSE', profession: null }, { status: 'IN_PROGRESS', type: 'NURSING', createdAt: new Date(Date.now() - 3600_000) });
    await expect(mk().svc.recordResult('o1', { summary: 'x', performedAt: new Date(Date.now() + 3600_000).toISOString() }, 'n')).rejects.toSatisfy((e) => code(e) === 'PERFORMED_AT_FUTURE');
    await expect(mk().svc.recordResult('o1', { summary: 'x', performedAt: new Date(Date.now() - 7200_000).toISOString() }, 'n')).rejects.toSatisfy((e) => code(e) === 'PERFORMED_AT_BEFORE_ORDER');
    const ok = mk();
    await ok.svc.recordResult('o1', { summary: 'x' }, 'n');
    expect((ok.state.result as { entries: { performedAt: string | null }[] }).entries[0].performedAt).toBeNull();
  });

  it('취소된 오더·빈 요약은 거부', async () => {
    await expect(build({ role: 'NURSE', profession: null }, { status: 'CANCELLED', type: 'NURSING' }).svc.recordResult('o1', { summary: 'x' }, 'n')).rejects.toSatisfy((e) => code(e) === 'ORDER_CANCELLED');
    await expect(build({ role: 'NURSE', profession: null }, { status: 'IN_PROGRESS', type: 'NURSING' }).svc.recordResult('o1', { summary: '  ' }, 'n')).rejects.toSatisfy((e) => code(e) === 'RESULT_SUMMARY_REQUIRED');
  });
});

describe('🔴 완료(changeStatus COMPLETED)는 시행 범위 안에서만', () => {
  const mk = (user: Row, type: string, status = 'IN_PROGRESS') => {
    const prisma = {
      user: { findUnique: vi.fn(async () => user) },
      order: { findUnique: vi.fn(async () => ({ id: 'o1', status, prescription: { type } })) },
      $transaction: vi.fn(async () => { throw new Error('reached-transaction'); }),
    };
    return new OrderService(prisma as never, {} as never);
  };
  it('간호사가 검사 오더를 결과 없이 완료할 수 없다', async () => {
    await expect(mk({ role: 'NURSE', profession: null }, 'LAB').changeStatus('o1', 'COMPLETED', undefined, 'n')).rejects.toSatisfy((e) => code(e) === 'ORDER_EXECUTION_SCOPE');
  });
  it('대조군 — 의료기사의 검사·영상 완료(종전 흐름)는 통과해 전이로 간다', async () => {
    await expect(mk({ role: 'LAB_TECH', profession: null }, 'IMAGING').changeStatus('o1', 'COMPLETED', undefined, 't')).rejects.toThrow('reached-transaction');
  });
  it('접수·시작은 종전대로(범위 검사 없음)', async () => {
    await expect(mk({ role: 'NURSE', profession: null }, 'LAB', 'RECEIVED').changeStatus('o1', 'IN_PROGRESS' as never, undefined, 'n')).rejects.toThrow('reached-transaction');
  });
});
