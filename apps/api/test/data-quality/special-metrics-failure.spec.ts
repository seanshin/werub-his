import { describe, it, expect, vi } from 'vitest';
import { DataQualityService } from '../../src/modules/data-quality/data-quality.service';

/**
 * 🔴 특수 지표(raw SQL 5종) 산출이 실패하면 **카드가 통째로 사라지던 것**에 대한 가드(2026-08-21).
 *
 * `await this.specialPatientMetrics().catch(() => [])` 는 실패를 빈 배열로 접었다.
 * 화면(admin/data-quality)은 줄이 없으면 "그런 지표는 없다"로 읽는다 — 그중엔
 * '퇴원요약 미완(퇴원 30일 내)' 같은 미완결 추적 지표가 있다.
 * 레지스트리 지표는 이미 `{error:true, value:-1}` → '집계 실패'로 그려진다. 같은 계약을 쓴다.
 *
 * 재주입 역검증: `.catch(() => [])` 로 되돌리면 두 it 모두 실패한다.
 */
describe('데이터 품질 요약 — 특수 지표 산출 실패를 "지표 없음"으로 접지 않는다', () => {
  function svcWith(rawRejects: boolean) {
    const prisma = {
      $queryRaw: rawRejects
        ? vi.fn().mockRejectedValue(new Error('relation does not exist'))
        : vi.fn().mockResolvedValue([{ count: BigInt(0) }]),
    };
    // 레지스트리 지표는 이 테스트의 관심이 아니다 — compute 를 전부 실패시켜 개수만 고정한다
    const svc = new DataQualityService(prisma as never);
    (svc as unknown as { metrics: unknown[] }).metrics = [];
    return svc;
  }

  it('실패해도 5개 지표 줄이 남고 error:true 로 "집계 실패"라고 말한다', async () => {
    const res = await svcWith(true).summary();
    const all = res.domains.flatMap((d) => d.metrics) as Array<{ key: string; value: number; error?: boolean }>;
    expect(all).toHaveLength(5);
    expect(all.every((m) => m.error === true && m.value === -1)).toBe(true);
    expect(all.map((m) => m.key)).toContain('admission.summaryMissing');
  });

  it('성공하면 실패 표시 없이 실제 값을 낸다(거짓 경보 금지)', async () => {
    const res = await svcWith(false).summary();
    const all = res.domains.flatMap((d) => d.metrics) as Array<{ key: string; value: number; error?: boolean }>;
    expect(all).toHaveLength(5);
    expect(all.some((m) => m.error === true)).toBe(false);
  });
});
