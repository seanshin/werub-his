import { describe, it, expect, vi } from 'vitest';
import { EncounterService } from '../../src/modules/encounter/encounter.service';
import { levenshteinCapped } from '../../src/common/util/edit-distance';

/**
 * 🔴 R12-d — `Encounter.aiEditDistance` 는 **writer 가 0개**였다. FE(`EncounterHistoryTab`)가
 *    읽고 있었지만 언제나 null 이라, AI 초안 과신 모니터가 "표본 없음"이 아니라 **아무것도 아니었다.**
 *
 * 🔴 재지 못한 것을 0(무수정)으로 채우지 않는다 — 0 은 "의사가 초안을 한 글자도 안 고쳤다"는
 *    임상적으로 무거운 주장이다.
 */
function make(existing: Record<string, unknown>, draftSnapshot: unknown, opts: { hasSession?: boolean } = {}) {
  const update = vi.fn().mockResolvedValue({ id: 'e1', status: 'SIGNED' });
  const findScribe = vi.fn().mockResolvedValue(opts.hasSession === false ? null : { draftSnapshot });
  const prisma: any = {
    encounter: { findUnique: vi.fn().mockResolvedValue(existing), update },
    encounterDiagnosis: { count: vi.fn().mockResolvedValue(1) },
    gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
    scribeSession: { findUnique: findScribe },
  };
  prisma.$transaction = vi.fn((fn: any) => fn(prisma));
  const svc = new EncounterService(prisma, { emit: vi.fn() } as any);
  return { svc, update, findScribe };
}

const BASE = {
  id: 'e1', status: 'DRAFT', patientId: 'p1',
  subjective: '두통 호소. 3일째.', objective: 'BP 120/80', assessment: '긴장성 두통', plan: '타이레놀 500mg',
};

describe('🔴 서명 시 AI 초안 대비 수정량을 잰다', () => {
  it('앰비언트 반영 스냅샷(appliedFields)과 서명본의 편집거리를 저장한다', async () => {
    const { svc, update } = make(
      { ...BASE, aiScribed: true, scribeSessionId: 's1', aiEditDistance: null },
      { appliedFields: { subjective: '두통 호소.' } },
    );
    await svc.sign('e1', 'doc1');
    // 초안에 있던 필드(S)만 비교한다 — 의사가 스스로 쓴 A·P 가 수정량으로 계상되면 안 된다
    expect(update.mock.calls[0][0].data.aiEditDistance).toBe(levenshteinCapped('두통 호소.', BASE.subjective));
  });

  it('녹음 스크라이브 초안(soap)도 같은 방식으로 잰다', async () => {
    const { svc, update } = make(
      { ...BASE, aiScribed: true, scribeSessionId: 's1', aiEditDistance: null },
      { soap: { subjective: '두통 호소. 3일째.', plan: '타이레놀 500mg' } },
    );
    await svc.sign('e1', 'doc1');
    expect(update.mock.calls[0][0].data.aiEditDistance).toBe(0); // 그대로 서명 — 진짜 0
  });

  it('🔴 초안 스냅샷이 없으면 저장하지 않는다(null 유지) — 못 잰 것을 0 으로 말하지 않는다', async () => {
    const { svc, update } = make({ ...BASE, aiScribed: true, scribeSessionId: 's1', aiEditDistance: null }, null);
    await svc.sign('e1', 'doc1');
    expect('aiEditDistance' in update.mock.calls[0][0].data).toBe(false);
  });

  it('🔴 세션 자체를 못 찾아도 지어내지 않는다', async () => {
    const { svc, update } = make({ ...BASE, aiScribed: true, scribeSessionId: 's1', aiEditDistance: null }, null, { hasSession: false });
    await svc.sign('e1', 'doc1');
    expect('aiEditDistance' in update.mock.calls[0][0].data).toBe(false);
  });

  it('🔴 스크라이브 세션 조회 실패를 "초안 없음"으로 번역하지 않는다 — 실패는 올라간다', async () => {
    const { svc } = make({ ...BASE, aiScribed: true, scribeSessionId: 's1', aiEditDistance: null }, null);
    (svc as any).prisma.scribeSession.findUnique = vi.fn().mockRejectedValue(new Error('DB down'));
    await expect(svc.sign('e1', 'doc1')).rejects.toThrow('DB down');
  });

  it('대조군 — AI 초안이 아닌 진료기록은 세션을 읽지도 않는다', async () => {
    const { svc, update, findScribe } = make({ ...BASE }, null);
    await svc.sign('e1', 'doc1');
    expect(findScribe).not.toHaveBeenCalled();
    expect('aiEditDistance' in update.mock.calls[0][0].data).toBe(false);
  });

  it('이미 계측된 기록은 다시 재지 않는다(정정 후 재서명이 원 수정량을 덮지 않는다)', async () => {
    const { svc, update, findScribe } = make(
      { ...BASE, status: 'AMENDED', aiScribed: true, scribeSessionId: 's1', aiEditDistance: 12 },
      { appliedFields: { subjective: 'x' } },
    );
    await svc.sign('e1', 'doc1');
    expect(findScribe).not.toHaveBeenCalled();
    expect('aiEditDistance' in update.mock.calls[0][0].data).toBe(false);
  });
});
