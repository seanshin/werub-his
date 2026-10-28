import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SentinelAdvisorService, extractJsonBlock } from '../../src/sentinel/sentinel-advisor.service';

/**
 * AI 판정 보조 가드 — 이 축의 규칙은 하나다: **지어낸 초안이 제일 위험하다.**
 * 출처는 AI | UNAVAILABLE 둘뿐(FALLBACK 없음) · 정본 밖 어휘를 접어주지 않는다 ·
 * 관측 불가 값을 사실처럼 프롬프트에 넣지 않는다.
 */

const finding = (over: Record<string, unknown> = {}) => ({
  id: 'f-1', axis: 'DATA', checkKey: 'integrity.60', severity: 'RED',
  label: '미래 시각의 대기열 기록', value: 1073, prevValue: 4,
  firstSeenAt: new Date('2026-09-02T16:54:33+09:00'), lastSeenAt: new Date(),
  resolvedAt: null, drillDown: null, unobservable: false, detail: null,
  notifyPending: false, notifiedAt: null,
  ...over,
});

const makeSvc = (opts: { finding?: unknown; advise?: (s: string, u: string) => Promise<string>; noAi?: boolean }) => {
  // 🔴 `opts.finding ?? finding()` 은 null(발견 없음)을 기본 발견으로 접는다 — `in` 으로 가른다
  const row = 'finding' in opts ? opts.finding : finding();
  const prisma = { sentinelFinding: { findUnique: vi.fn().mockResolvedValue(row) } };
  const advise = vi.fn(opts.advise ?? (async () => ''));
  const ai = opts.noAi ? undefined : { sentinelAdvise: advise };
  return { svc: new SentinelAdvisorService(prisma as never, ai as never), advise, prisma };
};

const GOOD = JSON.stringify({
  verdictSuggestion: 'SEED_ARTIFACT',
  rationale: '값이 롤포워드 직후 급증했고 운영 DB 가 시드라는 전제와 부합한다. 다만 원 데이터 확인 전이라 불확실하다.',
  verifySteps: ['대기열 레코드의 created_at 분포를 시드 UUID 와 대조', 'dev.demoDateRoll 실행 로그 시각과 급증 시각 비교'],
});

describe('AI 판정 보조 — analyze()', () => {
  it('존재하지 않는 발견은 404 — 지어낸 좌표로 AI 를 부르지 않는다', async () => {
    const { svc, advise } = makeSvc({ finding: null });
    await expect(svc.analyze('DATA', 'integrity.999')).rejects.toBeInstanceOf(NotFoundException);
    expect(advise).not.toHaveBeenCalled();
  });

  it('🔴 AI 미배선·빈 응답·예외·이해 불가 전부 UNAVAILABLE — FALLBACK 이 없다', async () => {
    const cases: { svc: SentinelAdvisorService }[] = [
      makeSvc({ noAi: true }),
      makeSvc({ advise: async () => '' }),
      makeSvc({ advise: async () => { throw new Error('conn refused'); } }),
      makeSvc({ advise: async () => '판단하기 어렵습니다만 대체로 정상으로 보입니다' }),
    ];
    for (const { svc } of cases) {
      const r = await svc.analyze('DATA', 'integrity.60');
      expect(r.source).toBe('UNAVAILABLE');
      if (r.source === 'UNAVAILABLE') expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('🔴 정본에 없는 판정 어휘를 접어주지 않는다 — 초안 자체를 내지 않는다', async () => {
    const { svc } = makeSvc({
      advise: async () => JSON.stringify({ verdictSuggestion: 'PROBABLY_FINE', rationale: '괜찮아 보인다', verifySteps: [] }),
    });
    const r = await svc.analyze('DATA', 'integrity.60');
    expect(r.source).toBe('UNAVAILABLE');
  });

  it('🔴 근거 없는 제안은 초안이 아니다', async () => {
    const { svc } = makeSvc({
      advise: async () => JSON.stringify({ verdictSuggestion: 'SEED_ARTIFACT', rationale: '', verifySteps: ['x'] }),
    });
    expect((await svc.analyze('DATA', 'integrity.60')).source).toBe('UNAVAILABLE');
  });

  it('정상 응답은 AI 초안으로 온다(대조군) — 코드펜스에 싸여 와도 읽는다', async () => {
    const { svc } = makeSvc({ advise: async () => '```json\n' + GOOD + '\n```' });
    const r = await svc.analyze('DATA', 'integrity.60');
    expect(r.source).toBe('AI');
    if (r.source === 'AI') {
      expect(r.verdictSuggestion).toBe('SEED_ARTIFACT');
      expect(r.verdictLabel).toBe('시드·백필 아티팩트');
      expect(r.verifySteps).toHaveLength(2);
    }
  });

  it('🔴 관측 불가 값을 사실처럼 프롬프트에 넣지 않는다', async () => {
    const { svc, advise } = makeSvc({
      finding: finding({ unobservable: true, value: 99 }),
      advise: async () => GOOD,
    });
    await svc.analyze('DATA', 'integrity.60');
    const userPrompt = advise.mock.calls[0][1] as string;
    expect(userPrompt).toContain('관측 불가');
    expect(userPrompt).not.toContain('현재 건수: 99');
  });

  it('프롬프트가 판정 어휘 정본과 초안 원칙을 담는다(사람 확정 명시)', async () => {
    const { svc, advise } = makeSvc({ advise: async () => GOOD });
    await svc.analyze('DATA', 'integrity.60');
    const system = advise.mock.calls[0][0] as string;
    expect(system).toContain('UNDETERMINED');
    expect(system).toContain('확정 판정은 사람이 한다');
    expect(system).toContain('지어내지 않는다');
  });
});

describe('extractJsonBlock', () => {
  it('펜스·잡담 속 JSON 을 꺼내되 내용은 손대지 않는다', () => {
    expect(extractJsonBlock('앞말 {"a":1} 뒷말')).toBe('{"a":1}');
    expect(extractJsonBlock('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('JSON 이 없으면 null — 없는 것을 만들지 않는다', () => {
    expect(extractJsonBlock('그냥 문장')).toBeNull();
    expect(extractJsonBlock('}{')).toBeNull();
  });
});
