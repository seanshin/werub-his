/**
 * 검사 AI 추이 해석(2026-10-02 실측 환자 P2026-1152).
 *  🔴 종전: COMPLETED 만 읽어 **확인(VERIFIED)된 결과 16건이 통째로 빠졌다** — 두 달 전 미확인 결과(WBC 13,200)를
 *     "현재값"으로 해석했다(확인된 최신 WBC 는 2,740 L). 출력에 중국어가 섞여 HbA1c 7.2% 를 "정상 범위"라 적었다.
 *  · 확인된 결과도 읽는다 · 출력에 한자·가나가 섞이면 qualityWarnings 로 말한다(대조군: 한국어만이면 경고 없음)
 * 재주입: 상태 필터를 COMPLETED 로 되돌리면 · 섞임 검사를 빼면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { LabService, mixedScript } from '../../src/modules/lab/lab.service';

const row = { completedAt: new Date('2026-08-04T01:00:00Z'), createdAt: new Date('2026-08-04T01:00:00Z'), items: [{ testName: 'WBC', value: '2740', unit: '/uL', flag: 'L', normalMin: 4000, normalMax: 10000 }] };
const make = (answer: string) => {
  const findMany = vi.fn(async () => [row]);
  const ai = { clinicalQa: vi.fn(async () => ({ answer })), getDisclaimer: vi.fn(async () => '참고') };
  const svc = new LabService({ labResult: { findMany } } as never, {} as never, ai as never, {} as never);
  return { svc, findMany, ai };
};

describe('검사 AI 추이 — 확인된 결과·출력 언어', () => {
  it('🔴 확인(VERIFIED)된 결과도 읽는다', async () => {
    const { svc, findMany } = make('WBC 감소');
    await svc.analyzeLabTrend('p1');
    expect((findMany.mock.calls[0] as any[])[0].where.status).toEqual({ in: ['COMPLETED', 'VERIFIED'] });
  });

  it('🔴 출력에 한자·가나가 섞이면 경고 · 대조군: 한국어만이면 경고 없음', async () => {
    const mixed = await make('HbA1c 7.2% 在正常范围内').svc.analyzeLabTrend('p1');
    expect(mixed).toMatchObject({ source: 'AI', qualityWarnings: ['MIXED_SCRIPT'] });
    const ko = await make('WBC 2,740 으로 참고 범위보다 낮습니다').svc.analyzeLabTrend('p1');
    expect(ko).toMatchObject({ source: 'AI', qualityWarnings: [] });
    expect(mixedScript({ answer: 'カタカナ' })).toBe(true);
  });
});
