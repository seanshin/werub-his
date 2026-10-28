/**
 * 위원회 중요결정 일괄 의사결정(2026-10-11 사용자 "관련된 위원회 중요결정사항에 대해서 일괄 변경").
 *  · 🔴 일괄이어도 경로는 하나씩과 같다 — 위원회 항목은 회의 하나 → 결정마다 안건 → 배정 → 의결 / 권한자 항목은 decide()
 *  · 🔴 검증 실패는 일부 실행의 이유가 아니다 — 하나라도 틀리면 아무것도 하지 않는다
 *  · 🔴 참석자·회의 일시는 사람이 넣은 그대로(명부로 채우지 않는다) · 미래 회의 거부 · 정족수 미달 사전 거부
 *  · 원자적이지 않다 — 항목 실패를 전체 성공으로 말하지 않는다 · 즉시 집행은 요청했을 때만
 */
import { describe, it, expect, vi } from 'vitest';
import { DecisionBulkService } from '../../src/modules/decision-registry/decision-bulk.service';

const A = 'draft.retention'; // MRC · 위원회 경로
const B = 'policy.voice.dictateWriteScope'; // MRC · 위원회 경로
const ROLE = 'nursing.lateEntry.graceMinutes'; // MRC · 권한자 경로
const PAST = '2026-10-10T09:00:00.000Z';
const ATT = ['00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000004'];

function mk(opts: { resolveFailFor?: string; quorum?: number; openAgenda?: Record<string, { id: string; committeeId: string; committee?: { code: string } }> } = {}) {
  const calls: string[] = [];
  const prisma: any = {
    committee: { findUnique: vi.fn(async () => ({ id: 'c-mrc', quorum: opts.quorum ?? 4, name: '의무기록위원회' })) },
    committeeAgenda: { findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, options: [{ value: 'X', label: 'x', effect: 'e' }] })) },
  };
  const gld: any = { createMeeting: vi.fn(async (d: unknown) => { calls.push('meeting'); return { id: 'm-1', ...(d as object) }; }) };
  let n = 0;
  const governance: any = {
    openDecisionAgenda: vi.fn(async (k: string) => opts.openAgenda?.[k] ?? null),
    submitAgenda: vi.fn(async (_u: string, d: { sourceRef: { key: string } }) => { calls.push(`agenda:${d.sourceRef.key}`); n++; return { id: `ag-${d.sourceRef.key}`, options: [{ value: 'X', label: 'x', effect: 'e' }], key: d.sourceRef.key }; }),
    updateAgenda: vi.fn(async (id: string) => { calls.push(`assign:${id}`); return {}; }),
    resolveAgenda: vi.fn(async (id: string) => {
      calls.push(`resolve:${id}`);
      if (opts.resolveFailFor && id === `ag-${opts.resolveFailFor}`) throw Object.assign(new Error('x'), { response: { code: 'AGENDA_CHOICE_X', message: '실패' } });
      return { id: `d-${id}`, decisionNo: `GOV-2026-0${n}`, registryRecord: { written: true, engine: { logged: true } } };
    }),
  };
  const enactment: any = { enactDecision: vi.fn(async () => ({ enacted: 1, failed: 0 })) };
  const decisions: any = { decide: vi.fn(async (k: string) => { calls.push(`decide:${k}`); return { engine: { logged: true, propagatedTo: [] } }; }) };
  return { svc: new DecisionBulkService(prisma, gld, governance, enactment, decisions), calls, gld, governance, enactment, decisions };
}
const base = { committeeCode: 'MRC', basisRef: '의무기록위원회 2026-3차 회의록', authorityClaim: '간호부장', meeting: { heldAt: PAST, attendeeUserIds: ATT } };

describe('검증 — 하나라도 틀리면 아무것도 하지 않는다', () => {
  it('🔴 배정 밖 위원회·허가권자 층·선택지 밖·중복 → BULK_INVALID(항목별 사유) · 회의·안건·결정 0', async () => {
    const t = mk();
    await expect(t.svc.decide({ ...base, items: [
      { key: A, choice: 'NOTIFY_ONLY' }, { key: 'qi.autoMeasure.enable', choice: 'ON' }, { key: 'billing.institutionType', choice: 'CLINIC' },
      { key: B, choice: 'NOPE' }, { key: A, choice: 'NOTIFY_ONLY' },
    ] }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_INVALID', details: { problems: expect.arrayContaining([
      { key: 'qi.autoMeasure.enable', code: 'NOT_ASSIGNED' }, { key: 'billing.institutionType', code: 'NOT_COMMITTEE_LAYER' }, { key: B, code: 'INVALID_CHOICE' }, { key: A, code: 'DUPLICATE' },
    ]) } } });
    expect(t.calls).toEqual([]);
  });
  it('🔴 근거 없음 · 권한자 항목인데 권한 근거 없음 · 위원회 항목인데 회의 없음/미래 회의 · 정족수 미달 — 모두 아무것도 만들지 않는다', async () => {
    const t = mk({ quorum: 5 });
    await expect(t.svc.decide({ ...base, basisRef: ' ', items: [{ key: A, choice: 'NOTIFY_ONLY' }] }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_BASIS_REQUIRED' } });
    await expect(t.svc.decide({ ...base, authorityClaim: '', items: [{ key: ROLE, choice: 'MIN_30' }] }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_AUTHORITY_REQUIRED' } });
    await expect(t.svc.decide({ ...base, meeting: null, items: [{ key: A, choice: 'NOTIFY_ONLY' }] }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_MEETING_REQUIRED' } });
    await expect(t.svc.decide({ ...base, meeting: { heldAt: '2099-01-01T00:00:00Z', attendeeUserIds: ATT }, items: [{ key: A, choice: 'NOTIFY_ONLY' }] }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_MEETING_FUTURE' } });
    await expect(t.svc.decide({ ...base, items: [{ key: A, choice: 'NOTIFY_ONLY' }] }, 'u')).rejects.toMatchObject({ response: { code: 'QUORUM_NOT_MET' } });
    expect(t.calls).toEqual([]);
  });
});

describe('실행 — 하나씩과 같은 경로', () => {
  it('🔴 회의 하나(사람이 고른 참석자·일시·근거) → 결정마다 안건→배정→의결 · 권한자 항목은 decide · 즉시 집행은 요청 시', async () => {
    const t = mk();
    const r = await t.svc.decide({ ...base, enactNow: true, items: [{ key: A, choice: 'NOTIFY_ONLY' }, { key: ROLE, choice: 'MIN_30' }, { key: B, choice: 'S_ONLY' }] }, 'admin-1');
    expect(t.calls).toEqual(['meeting', `agenda:${A}`, `assign:ag-${A}`, `resolve:ag-${A}`, `decide:${ROLE}`, `agenda:${B}`, `assign:ag-${B}`, `resolve:ag-${B}`]);
    expect(t.gld.createMeeting.mock.calls[0][0]).toMatchObject({ committeeId: 'c-mrc', scheduledAt: PAST, attendees: ATT, agenda: base.basisRef, createdBy: 'admin-1' });
    expect(t.governance.updateAgenda).toHaveBeenCalledWith(`ag-${A}`, { meetingId: 'm-1' });
    const resolveArg = t.governance.resolveAgenda.mock.calls[0][1];
    expect(resolveArg.chosenOption).toMatchObject({ value: 'NOTIFY_ONLY', snapshot: [{ value: 'X', label: 'x', effect: 'e' }] }); // 스냅샷 = 그 안건의 선택지 그대로
    expect(t.decisions.decide).toHaveBeenCalledWith(ROLE, 'admin-1', expect.objectContaining({ choice: 'MIN_30', legalReviewRef: base.basisRef, authorityClaim: '간호부장' }));
    expect(t.enactment.enactDecision).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ total: 3, succeeded: 3, failed: 0, meetingId: 'm-1' });
    expect(r.results.find((x) => x.key === A)).toMatchObject({ ok: true, path: 'COMMITTEE', registryWritten: true });
    expect(r.results.find((x) => x.key === ROLE)).toMatchObject({ ok: true, path: 'ROLE' });
  });
  it('🔴 한 항목 의결 실패는 그 항목 실패로 — 나머지는 진행 · 전체 성공으로 말하지 않는다 · 즉시 집행 미요청이면 집행 안 함', async () => {
    const t = mk({ resolveFailFor: A });
    const r = await t.svc.decide({ ...base, items: [{ key: A, choice: 'NOTIFY_ONLY' }, { key: B, choice: 'S_ONLY' }] }, 'u');
    expect(r).toMatchObject({ succeeded: 1, failed: 1 });
    expect(r.results[0]).toMatchObject({ key: A, ok: false, error: { code: 'AGENDA_CHOICE_X' } });
    expect(t.enactment.enactDecision).not.toHaveBeenCalled();
  });
  it('권한자 항목만이면 회의를 만들지 않는다', async () => {
    const t = mk();
    await t.svc.decide({ ...base, meeting: null, items: [{ key: ROLE, choice: 'MIN_60' }] }, 'u');
    expect(t.gld.createMeeting).not.toHaveBeenCalled();
  });
});
