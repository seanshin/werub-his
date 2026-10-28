import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

/**
 * 가드 — `Promise.all` 안에서 실패가 조용히 사라지던 자리 (2026-08-21)
 *
 * 🔴 원 결함: `suggestEdiCodes` 가 진단별 AI 조회를 `Promise.all` 로 돌리면서
 *    `searchEdi(name).catch(() => null)` 로 접었다. 3건 중 2건이 실패해도 응답은
 *    `{ suggestions: [1건], source: 'AI' }` — **"이 진단에는 EDI 매칭이 없다"와
 *    "AI 에 물어보지 못했다"가 같은 모양**이었다. 청구 담당자는 실패한 진단을
 *    '제안 없음'으로 읽고 수기 코딩으로 넘어간다.
 *
 * 재주입 검증: `.catch(() => null)` 로 되돌리면 아래 세 케이스가 전부 실패한다
 * (unavailable 이 사라지고 source 가 늘 'AI').
 */
describe('suggestEdiCodes — 조회 실패를 "제안 없음"으로 접지 않는다', () => {
  let service: BillingService;
  let mockPrisma: any;
  let searchEdi: ReturnType<typeof vi.fn>;

  const encounterWith = (names: string[]) => ({
    id: 'e-1',
    diagnoses: names.map((n) => ({ diagnosisCode: { nameKo: n, code: n } })),
  });

  beforeEach(() => {
    searchEdi = vi.fn();
    mockPrisma = { encounter: { findUnique: vi.fn() } };
    service = new BillingService(
      mockPrisma,
      { searchEdi } as any,
      { enqueue: vi.fn() } as any,
      { get: vi.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('🔴 일부 진단의 AI 조회가 실패하면 그 진단을 unavailable 로 드러내고 source=PARTIAL', async () => {
    mockPrisma.encounter.findUnique.mockResolvedValue(encounterWith(['본태성 고혈압', '2형 당뇨병']));
    searchEdi.mockImplementation(async (name: string) => {
      if (name === '2형 당뇨병') throw new Error('AI unreachable');
      return [{ code: 'AA100', name: '진찰료' }];
    });

    const r: any = await service.suggestEdiCodes('e-1');

    expect(r.unavailable).toEqual(['2형 당뇨병']);
    expect(r.suggestions).toHaveLength(1);
    expect(r.askedCount).toBe(2); // 분모를 함께 낸다
    expect(r.source).toBe('PARTIAL');
  });

  it('🔴 전건 실패는 source=UNAVAILABLE — 빈 제안 목록을 "AI 가 본 결과"로 말하지 않는다', async () => {
    mockPrisma.encounter.findUnique.mockResolvedValue(encounterWith(['본태성 고혈압', '2형 당뇨병']));
    searchEdi.mockRejectedValue(new Error('AI unreachable'));

    const r: any = await service.suggestEdiCodes('e-1');

    expect(r.suggestions).toEqual([]);
    expect(r.unavailable).toEqual(['본태성 고혈압', '2형 당뇨병']);
    expect(r.source).toBe('UNAVAILABLE');
  });

  it('조회는 됐고 매칭이 없는 것은 실패가 아니다 — unavailable 비고 source=AI', async () => {
    mockPrisma.encounter.findUnique.mockResolvedValue(encounterWith(['본태성 고혈압']));
    searchEdi.mockResolvedValue(null); // 매칭 없음

    const r: any = await service.suggestEdiCodes('e-1');

    expect(r.suggestions).toEqual([]);
    expect(r.unavailable).toEqual([]);
    expect(r.source).toBe('AI');
  });
});
