import { describe, it, expect, vi } from 'vitest';
import { SAFETY_METRICS } from '../../src/modules/data-quality/quality-registry';
import { rawSeverityAliases } from '@hospital-run/shared';

/**
 * 10단계(안전·감염) 지표 가드 — `safety.rcaMissingForSevere`
 *
 * 🔴 severity 는 자유 문자열이다 — 운영 실측에 `CRITICAL` 8·`SENTINEL` 3 이 있지만 정본 별칭에는
 *    `SEVERE`·`위해`·`적신호` 도 있다. 단일 값 비교(`severity: 'CRITICAL'`)로 되돌리면
 *    별칭으로 저장된 중대사고가 **분모에서 조용히 빠진다**(어휘 오염이 안전장치를 끄는 유형 — v4.1.0 누적선량).
 *
 * 중대의 정의는 정본 `isEscalatingSeverity`(SENTINEL·CRITICAL)와 동일 — MAJOR 를 조용히 넓히지 않는다.
 */
describe('safety.rcaMissingForSevere', () => {
  const metric = SAFETY_METRICS.find((m) => m.key === 'safety.rcaMissingForSevere')!;

  function mockPrisma(counts: { total: number; done: number }) {
    const calls: unknown[] = [];
    return {
      calls,
      safetyIncident: {
        count: vi.fn(async (arg: { where: { rcaCompleted?: boolean } }) => {
          calls.push(arg.where);
          return arg.where.rcaCompleted === true ? counts.done : counts.total;
        }),
      },
    };
  }

  it('등록돼 있다 — 도메인 safety · 워크리스트 딥링크 필수 규약', () => {
    expect(metric).toBeDefined();
    expect(metric.domain).toBe('safety');
    expect(metric.drillDown).toBe('/safety');
    expect(metric.severityWhenOver).toBe('CRITICAL');
  });

  it('🔴 중대 필터가 정본 별칭 집합을 쓴다 — 단일 값 비교로 되돌리면 실패한다', async () => {
    const p = mockPrisma({ total: 11, done: 3 });
    await metric.compute(p as never);
    const where = p.calls[0] as { severity: { in: string[] } };
    // SENTINEL·CRITICAL 의 별칭 전량이 있어야 한다(SEVERE·위해·적신호 포함)
    for (const alias of [...rawSeverityAliases('SENTINEL'), ...rawSeverityAliases('CRITICAL')]) {
      expect(where.severity.in, `별칭 누락: ${alias}`).toContain(alias);
    }
    // 🔴 MAJOR(중대 '아님' — isEscalatingSeverity 정본과 동일 범위)를 조용히 넓히지 않는다
    for (const alias of rawSeverityAliases('MAJOR')) {
      expect(where.severity.in).not.toContain(alias);
    }
  });

  it('값 = 중대 총계 − RCA 완료 · 분모 병기 (운영 실측 11/3 → 8/11)', async () => {
    const p = mockPrisma({ total: 11, done: 3 });
    const r = await metric.compute(p as never);
    expect(r).toEqual({ value: 8, total: 11 });
  });

  it('대조군 — 전건 RCA 완료면 0 이라고 말한다 (성공을 실패로 말하지 않는다)', async () => {
    const p = mockPrisma({ total: 5, done: 5 });
    const r = await metric.compute(p as never);
    expect(r).toEqual({ value: 0, total: 5 });
  });

  it('대조군 — 중대사고 0건이면 0/0 (분모 0 은 "누락 없음"이 아니라 표본 부재)', async () => {
    const p = mockPrisma({ total: 0, done: 0 });
    const r = await metric.compute(p as never);
    expect(r).toEqual({ value: 0, total: 0 });
  });
});
