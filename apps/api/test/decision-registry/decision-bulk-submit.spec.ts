/**
 * 위원회 안건 일괄 상정(2026-10-21 사용자 "안건 상정까지 기능 구현").
 *  · 🔴 하나씩 올리는 경로(submitAgenda → updateAgenda)와 같다 · 상정은 의결이 아니다(등록부·결정 기록 안 바뀜)
 *  · 🔴 검증 실패면 아무것도 만들지 않는다 — 배정 밖·권한자 경로·이미 실결정·열린 안건·중복
 *  · 회의: 없음(접수만) / 이 위원회의 예정 회의(순번 이어서) / 새 회의(참석자 없이 — 사람이 회의 때 넣는다)
 *  · 🔴 같은 결정의 열린 안건은 하나만 — 단건 상정도 409 · 일괄 의사결정은 열린 안건을 그대로 의결한다
 *  · 🔴 회의 배정은 그 안건의 위원회 회의에만 · 취소·봉인 회의·의결된 안건 거부
 */
import { describe, it, expect, vi } from 'vitest';
import { DecisionBulkService } from '../../src/modules/decision-registry/decision-bulk.service';
import { GovernanceService } from '../../src/modules/gld/governance.service';

const A = 'patient.mergeReversal'; // MRC 단독 · 개발 반영
const B = 'patient.listScopeByRole'; // MRC 주관 · OPS 합동
const OPS_ONLY = 'patient.photoPolicy'; // OPS 주관 · SAFE 합동 — MRC 배정 밖
const ROLE = 'nursing.lateEntry.graceMinutes'; // MRC · 권한자 경로
const SEED_REC = { choice: 'NONE', legalReviewRef: '개발 시드(DEV-SEED) — 2026-10-10 사용자 지시(위원회 의결 전)', authorityClaim: '개발 시드(DEV-SEED) — 위원회 의결 미검증' };
const REAL_REC = { choice: 'ALL', legalReviewRef: 'MRC 2026-4차 회의록', authorityClaim: '의무기록위원회' };

function mk(opts: {
  records?: Array<{ key: string; value: unknown }>;
  open?: Record<string, { id: string; committeeId: string; status?: string }>;
  meeting?: { committeeId: string; status: string; minutesSignedAt: Date | null } | null;
  lastSeq?: number | null;
  failFor?: string;
} = {}) {
  const calls: string[] = [];
  const prisma: any = {
    systemConfig: { findMany: vi.fn(async () => opts.records ?? []) },
    committee: { findUnique: vi.fn(async () => ({ id: 'c-mrc', name: '의무기록위원회', quorum: 4 })) },
    committeeMeeting: { findUnique: vi.fn(async () => (opts.meeting === undefined ? { committeeId: 'c-mrc', status: 'SCHEDULED', minutesSignedAt: null } : opts.meeting)) },
    committeeAgenda: { findFirst: vi.fn(async () => (opts.lastSeq == null ? null : { seq: opts.lastSeq })) },
  };
  const gld: any = { createMeeting: vi.fn(async (d: unknown) => { calls.push('meeting'); return { id: 'm-new', ...(d as object) }; }) };
  const governance: any = {
    openDecisionAgenda: vi.fn(async (k: string) => opts.open?.[k] ?? null),
    submitAgenda: vi.fn(async (_u: string, d: { sourceRef: { key: string } }) => {
      calls.push(`agenda:${d.sourceRef.key}`);
      if (d.sourceRef.key === opts.failFor) throw Object.assign(new Error('x'), { response: { code: 'DECISION_AGENDA_OPEN', message: '이미 올라가 있음' } });
      return { id: `ag-${d.sourceRef.key}` };
    }),
    updateAgenda: vi.fn(async (id: string, d: { meetingId: string; seq: number }) => { calls.push(`assign:${id}@${d.meetingId}#${d.seq}`); return {}; }),
    resolveAgenda: vi.fn(),
  };
  const decisions: any = { decide: vi.fn() };
  return { svc: new DecisionBulkService(prisma, gld, governance, { enactDecision: vi.fn() } as never, decisions), calls, prisma, gld, governance, decisions };
}

describe('🔴 검증 — 하나라도 틀리면 아무것도 올리지 않는다', () => {
  it('배정 밖·권한자 경로·이미 실결정·열린 안건·중복 → BULK_SUBMIT_INVALID(항목별) · 안건·회의 0', async () => {
    const t = mk({ records: [{ key: `decision.${B}`, value: REAL_REC }], open: { [A]: { id: 'ag-old', committeeId: 'c-mrc' } } });
    await expect(t.svc.submit({ committeeCode: 'MRC', keys: [A, B, OPS_ONLY, ROLE, A], meeting: { scheduledAt: '2026-11-01T09:00:00Z' } }, 'u'))
      .rejects.toMatchObject({ response: { code: 'BULK_SUBMIT_INVALID', details: { problems: expect.arrayContaining([
        { key: A, code: 'OPEN_AGENDA', agendaId: 'ag-old' }, { key: B, code: 'ALREADY_DECIDED' }, { key: OPS_ONLY, code: 'NOT_ASSIGNED' }, { key: ROLE, code: 'ROLE_PATH' }, { key: A, code: 'DUPLICATE' },
      ]) } } });
    expect(t.calls).toEqual([]);
  });
  it('개발 시드 기록은 결정이 아니다 — 시드만 있는 결정은 올라간다(대조군)', async () => {
    const t = mk({ records: [{ key: `decision.${A}`, value: SEED_REC }] });
    const r = await t.svc.submit({ committeeCode: 'MRC', keys: [A] }, 'u');
    expect(r).toMatchObject({ succeeded: 1, failed: 0 });
  });
  it('위원회 코드·빈 목록·50건 초과 거부', async () => {
    const t = mk();
    await expect(t.svc.submit({ committeeCode: 'XX', keys: [A] }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_COMMITTEE' } });
    await expect(t.svc.submit({ committeeCode: 'MRC', keys: [] }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_EMPTY' } });
    await expect(t.svc.submit({ committeeCode: 'MRC', keys: Array(51).fill(A) }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_TOO_MANY' } });
  });
});

describe('실행 — 하나씩과 같은 경로 · 상정은 의결이 아니다', () => {
  it('회의 없음 — 결정마다 안건 접수(SUBMITTED) · 배정·의결·결정 기록 없음', async () => {
    const t = mk();
    const r = await t.svc.submit({ committeeCode: 'MRC', keys: [A, B] }, 'admin-1');
    expect(t.calls).toEqual([`agenda:${A}`, `agenda:${B}`]);
    expect(t.governance.submitAgenda.mock.calls[0]).toEqual(['admin-1', expect.objectContaining({ committeeId: 'c-mrc', sourceRef: { type: 'DECISION', key: A } })]);
    expect(t.governance.resolveAgenda).not.toHaveBeenCalled();
    expect(t.decisions.decide).not.toHaveBeenCalled();
    expect(r).toMatchObject({ meetingId: null, total: 2, succeeded: 2 });
    expect(r.results.map((x) => x.status)).toEqual(['SUBMITTED', 'SUBMITTED']);
  });

  it('예정 회의 — 그 회의에 배정(SCHEDULED) · 순번은 이미 있는 안건 뒤로', async () => {
    const t = mk({ lastSeq: 3 });
    const r = await t.svc.submit({ committeeCode: 'MRC', keys: [A, B], meeting: { meetingId: 'm-1' } }, 'u');
    expect(t.calls).toEqual([`agenda:${A}`, `assign:ag-${A}@m-1#4`, `agenda:${B}`, `assign:ag-${B}@m-1#5`]);
    expect(r.results.map((x) => x.status)).toEqual(['SCHEDULED', 'SCHEDULED']);
  });

  it('🔴 다른 위원회 회의·끝난/봉인 회의에는 올리지 않는다 — 아무것도 만들지 않음', async () => {
    const other = mk({ meeting: { committeeId: 'c-ops', status: 'SCHEDULED', minutesSignedAt: null } });
    await expect(other.svc.submit({ committeeCode: 'MRC', keys: [A], meeting: { meetingId: 'm-x' } }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_SUBMIT_MEETING' } });
    const done = mk({ meeting: { committeeId: 'c-mrc', status: 'COMPLETED', minutesSignedAt: null } });
    await expect(done.svc.submit({ committeeCode: 'MRC', keys: [A], meeting: { meetingId: 'm-1' } }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_SUBMIT_MEETING_CLOSED' } });
    const sealed = mk({ meeting: { committeeId: 'c-mrc', status: 'SCHEDULED', minutesSignedAt: new Date() } });
    await expect(sealed.svc.submit({ committeeCode: 'MRC', keys: [A], meeting: { meetingId: 'm-1' } }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_SUBMIT_MEETING_CLOSED' } });
    for (const x of [other, done, sealed]) expect(x.calls).toEqual([]);
  });

  it('🔴 새 회의 — 예정 일시(미래 가능)로 만들고 참석자는 넣지 않는다(회의 때 사람이) · 순번 1부터', async () => {
    const t = mk();
    await t.svc.submit({ committeeCode: 'MRC', keys: [A], meeting: { scheduledAt: '2026-11-05T09:00:00.000Z', title: 'MRC 11월 정기' } }, 'admin-1');
    const arg = t.gld.createMeeting.mock.calls[0][0];
    expect(arg).toMatchObject({ committeeId: 'c-mrc', title: 'MRC 11월 정기', scheduledAt: '2026-11-05T09:00:00.000Z', createdBy: 'admin-1' });
    expect('attendees' in arg).toBe(false);
    expect(t.calls).toEqual(['meeting', `agenda:${A}`, `assign:ag-${A}@m-new#1`]);
    await expect(mk().svc.submit({ committeeCode: 'MRC', keys: [A], meeting: { scheduledAt: 'nope' } }, 'u')).rejects.toMatchObject({ response: { code: 'BULK_SUBMIT_MEETING_DATE' } });
  });

  it('한 항목 실패는 그 항목만 — 나머지는 진행 · 전체 성공으로 말하지 않는다', async () => {
    const t = mk({ failFor: A });
    const r = await t.svc.submit({ committeeCode: 'MRC', keys: [A, B] }, 'u');
    expect(r).toMatchObject({ succeeded: 1, failed: 1 });
    expect(r.results[0]).toMatchObject({ key: A, ok: false, error: { code: 'DECISION_AGENDA_OPEN' } });
  });
});

describe('🔴 상정 뒤 의결 — 일괄 의사결정은 열린 안건을 그대로 의결한다(안건 둘 금지)', () => {
  const PAST = '2026-10-10T09:00:00.000Z';
  const ATT = ['00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000004'];
  function mkDecide(open: Record<string, { id: string; committeeId: string; committee?: { code: string } }>) {
    const calls: string[] = [];
    const prisma: any = {
      committee: { findUnique: vi.fn(async () => ({ id: 'c-mrc', quorum: 4, name: 'MRC' })) },
      committeeAgenda: { findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, options: [{ value: 'NONE', label: 'x', effect: 'e' }] })) },
    };
    const governance: any = {
      openDecisionAgenda: vi.fn(async (k: string) => open[k] ?? null),
      submitAgenda: vi.fn(async (_u: string, d: { sourceRef: { key: string } }) => { calls.push(`agenda:${d.sourceRef.key}`); return { id: `ag-new-${d.sourceRef.key}`, options: [] }; }),
      updateAgenda: vi.fn(async (id: string) => { calls.push(`assign:${id}`); return {}; }),
      resolveAgenda: vi.fn(async (id: string) => { calls.push(`resolve:${id}`); return { id: `d-${id}`, decisionNo: 'GOV-2026-001', registryRecord: { written: true } }; }),
    };
    const svc = new DecisionBulkService(prisma, { createMeeting: vi.fn(async () => ({ id: 'm-held' })) } as never, governance, { enactDecision: vi.fn() } as never, { decide: vi.fn() } as never);
    return { svc, calls };
  }
  const base = { committeeCode: 'MRC', basisRef: 'MRC 2026-4차 회의록', authorityClaim: '', meeting: { heldAt: PAST, attendeeUserIds: ATT } };

  it('같은 위원회 열린 안건 → 새 안건 없이 그 안건을 회의에 배정하고 의결', async () => {
    const t = mkDecide({ [A]: { id: 'ag-open', committeeId: 'c-mrc' } });
    const r = await t.svc.decide({ ...base, items: [{ key: A, choice: 'NONE' }] }, 'u');
    expect(t.calls).toEqual(['assign:ag-open', 'resolve:ag-open']);
    expect(r.results[0]).toMatchObject({ ok: true, agendaId: 'ag-open' });
  });
  it('다른 위원회 안건이면 그 항목 실패(대신 의결하지 않는다)', async () => {
    const t = mkDecide({ [B]: { id: 'ag-ops', committeeId: 'c-ops', committee: { code: 'OPS' } } });
    const r = await t.svc.decide({ ...base, items: [{ key: B, choice: 'ALL' }] }, 'u');
    expect(r.results[0]).toMatchObject({ ok: false, error: { code: 'DECISION_AGENDA_OTHER_COMMITTEE' } });
    expect(t.calls).toEqual([]);
  });
});

describe('🔴 안건 서비스 — 중복 상정 금지 · 회의 배정은 같은 위원회 예정 회의에만', () => {
  function gov(o: { open?: unknown; agenda?: { committeeId: string; status: string } | null; meeting?: { committeeId: string; status: string; minutesSignedAt: Date | null } | null } = {}) {
    const prisma: any = {
      committee: { findUnique: vi.fn(async () => ({ code: 'MRC' })) },
      committeeAgenda: {
        findFirst: vi.fn(async () => o.open ?? null),
        create: vi.fn(async ({ data }: { data: unknown }) => ({ id: 'ag-1', ...(data as object) })),
        findUnique: vi.fn(async () => (o.agenda === undefined ? { committeeId: 'c-mrc', status: 'SUBMITTED' } : o.agenda)),
        update: vi.fn(async ({ data }: { data: unknown }) => data),
      },
      committeeMeeting: { findUnique: vi.fn(async () => (o.meeting === undefined ? { committeeId: 'c-mrc', status: 'SCHEDULED', minutesSignedAt: null } : o.meeting)) },
    };
    return { svc: new GovernanceService(prisma as never, { validateAction: vi.fn() } as never, undefined, { get: vi.fn() } as never), prisma };
  }
  it('같은 결정의 열린 안건이 있으면 409 DECISION_AGENDA_OPEN · 안 만든다 · 열린 상태 = 접수·상정·보류', async () => {
    const g = gov({ open: { id: 'ag-0', status: 'SCHEDULED', committee: { code: 'MRC' }, meetingId: 'm-1' } });
    await expect(g.svc.submitAgenda('u', { committeeId: 'c-mrc', title: 't', sourceRef: { type: 'DECISION', key: A } }))
      .rejects.toMatchObject({ status: 409, response: { code: 'DECISION_AGENDA_OPEN', details: { agendaId: 'ag-0' } } });
    expect(g.prisma.committeeAgenda.create).not.toHaveBeenCalled();
    const where = JSON.stringify(g.prisma.committeeAgenda.findFirst.mock.calls[0][0].where);
    expect(where).toContain('["SUBMITTED","SCHEDULED","DEFERRED"]');
    expect(where).toContain(`"equals":"${A}"`);
  });
  it('대조군 — 열린 안건이 없으면(의결·부결·철회 뒤) 올라간다 · 등록부 밖 안건은 검사하지 않는다', async () => {
    const g = gov();
    expect(await g.svc.submitAgenda('u', { committeeId: 'c-mrc', title: 't', sourceRef: { type: 'DECISION', key: A } })).toBeTruthy();
    await g.svc.submitAgenda('u', { committeeId: 'c-mrc', title: 't', sourceRef: { type: 'SAFETY_GATE', key: 'dur.enforce' } });
    expect(g.prisma.committeeAgenda.findFirst).toHaveBeenCalledTimes(1);
  });
  it('회의 배정 — 다른 위원회 회의·취소·봉인 회의·의결된 안건 거부 · 같은 위원회 예정 회의는 SCHEDULED', async () => {
    await expect(gov({ meeting: { committeeId: 'c-nut', status: 'SCHEDULED', minutesSignedAt: null } }).svc.updateAgenda('ag-1', { meetingId: 'm-1' })).rejects.toMatchObject({ response: { code: 'AGENDA_MEETING_COMMITTEE' } });
    await expect(gov({ meeting: { committeeId: 'c-mrc', status: 'CANCELLED', minutesSignedAt: null } }).svc.updateAgenda('ag-1', { meetingId: 'm-1' })).rejects.toMatchObject({ response: { code: 'AGENDA_MEETING_CLOSED' } });
    await expect(gov({ meeting: { committeeId: 'c-mrc', status: 'SCHEDULED', minutesSignedAt: new Date() } }).svc.updateAgenda('ag-1', { meetingId: 'm-1' })).rejects.toMatchObject({ response: { code: 'AGENDA_MEETING_CLOSED' } });
    await expect(gov({ agenda: { committeeId: 'c-mrc', status: 'RESOLVED' } }).svc.updateAgenda('ag-1', { meetingId: 'm-1' })).rejects.toMatchObject({ response: { code: 'AGENDA_RESOLVED' } });
    const ok = gov();
    await ok.svc.updateAgenda('ag-1', { meetingId: 'm-1' });
    expect(ok.prisma.committeeAgenda.update.mock.calls[0][0].data).toMatchObject({ meetingId: 'm-1', status: 'SCHEDULED' });
  });
});
