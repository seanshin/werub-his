import { describe, it, expect, vi } from 'vitest';
import { AmbientScribeService } from '../../src/modules/scribe/ambient.service';

/**
 * 🔴 R12-b — `ScribeSessionStatus.APPLIED` 는 **대입하는 코드가 0개**였다(죽은 정본).
 *    제안을 진료기록에 반영해도 세션은 "종료됨(TRANSCRIBED)"에 머물러, 원장만 보면
 *    반영이 있었는지 알 수 없었다.
 *
 * 🔴 전이는 **종료된 세션에서만**이다. 녹음 중(RECORDING)에 APPLIED 로 올리면
 *    `closeSession` 이 RECORDING 을 요구하므로 반영 한 번이 **종료 자체를 막는다**.
 */
const ON = { 'voiceEmr.ambient.enabled': true, 'voiceEmr.pilotUserIds': [] };
const S = (over: Record<string, unknown> = {}) => ({
  id: 's1', doctorId: 'doc1', patientId: 'p1', encounterId: 'e1', status: 'TRANSCRIBED', source: 'AMBIENT', ...over,
});

function make(sessionStatus: string, draftSnapshot: unknown = null) {
  const sessionUpdate = vi.fn().mockResolvedValue({});
  const encounterUpdate = vi.fn().mockResolvedValue({});
  const prisma: any = {
    scribeSession: {
      findUnique: vi.fn(async ({ select }: any) =>
        select?.draftSnapshot !== undefined ? { status: sessionStatus, draftSnapshot } : S({ status: sessionStatus }),
      ),
      update: sessionUpdate,
    },
    encounter: { update: encounterUpdate },
  };
  prisma.$transaction = vi.fn((fn: any) => fn(prisma));
  const config: any = { get: vi.fn((k: string) => Promise.resolve((ON as any)[k])) };
  return { svc: new AmbientScribeService(prisma, config), sessionUpdate, encounterUpdate, prisma };
}

const DTO = { field: 'subjective' as const, text: '두통 호소.', sourceSeqs: [1], engine: 'RULE' as const };

describe('🔴 반영은 세션 상태로 남는다(DRAFTED/TRANSCRIBED → APPLIED)', () => {
  it('TRANSCRIBED 세션에 반영하면 APPLIED 로 전이한다', async () => {
    const { svc, sessionUpdate, encounterUpdate, prisma } = make('TRANSCRIBED');
    const r = await svc.applySuggestion('s1', 'doc1', DTO as any);
    expect(r.sessionStatus).toBe('APPLIED');
    expect(sessionUpdate.mock.calls[0][0].data.status).toBe('APPLIED');
    // 🔴 같은 트랜잭션 — 진료기록 프로비넌스와 세션 상태가 갈라지지 않는다
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(encounterUpdate.mock.calls[0][0].data).toMatchObject({ aiScribed: true, scribeSessionId: 's1' });
  });

  it('DRAFTED 세션도 APPLIED 로 전이한다', async () => {
    const { svc, sessionUpdate } = make('DRAFTED');
    await svc.applySuggestion('s1', 'doc1', DTO as any);
    expect(sessionUpdate.mock.calls[0][0].data.status).toBe('APPLIED');
  });

  it('🔴 녹음 중(RECORDING)에는 전이하지 않는다 — 전이하면 종료가 막힌다', async () => {
    const { svc, sessionUpdate } = make('RECORDING');
    const r = await svc.applySuggestion('s1', 'doc1', DTO as any);
    expect(r.sessionStatus).toBe('RECORDING');
    expect(sessionUpdate.mock.calls[0][0].data.status).toBeUndefined();
    // 그래도 반영 사실(초안 스냅샷)은 남는다
    expect(sessionUpdate.mock.calls[0][0].data.draftSnapshot).toMatchObject({ appliedFields: { subjective: '두통 호소.' } });
  });

  it('🔴 실패·삭제 세션을 되살리지 않는다', async () => {
    for (const st of ['FAILED', 'DELETED']) {
      const { svc, sessionUpdate } = make(st);
      await svc.applySuggestion('s1', 'doc1', DTO as any);
      expect(sessionUpdate.mock.calls[0][0].data.status, st).toBeUndefined();
    }
  });

  it('🔴 기존 초안 스냅샷을 덮지 않고 병합한다 — 같은 필드는 누적', async () => {
    const { svc, sessionUpdate } = make('TRANSCRIBED', { soap: { subjective: '원 초안' }, appliedFields: { subjective: '앞서 반영' } });
    await svc.applySuggestion('s1', 'doc1', DTO as any);
    const snap = sessionUpdate.mock.calls[0][0].data.draftSnapshot;
    expect(snap.soap).toEqual({ subjective: '원 초안' });
    expect(snap.appliedFields.subjective).toBe('앞서 반영\n두통 호소.');
  });
});
