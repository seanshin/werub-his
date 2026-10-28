import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QualityService } from '../../src/modules/quality/quality.service';

/**
 * 🔴 QI 측정값 정정·무효화 가드 — 이연 회수 T2-14(2026-08-18).
 *
 * 종전에는 **오기를 고칠 방법이 없었다.** 같은 기간을 다시 넣으면 별도 행으로 쌓여
 * 어느 것이 맞는지 화면도 집계도 알 수 없었다(운영 실측: 측정 300건·기간 중복 0 — 제약 추가 안전).
 *
 * 규약:
 *  · 지표×기간은 하나다 — 중복은 **거절하고 정정 경로를 안내**한다(조용히 덮어쓰지 않는다).
 *  · 무효화는 **지우지 않는다** — QI 는 인증·대외 보고의 근거라 "무엇이 있었는지"가 남아야 한다.
 *    하드 삭제하면 그 기간이 애초에 미측정이었는지, 잘못 넣었다 지운 것인지 구분할 수 없다.
 *  · 분모 0 은 값 0 이 아니라 산출 불가다.
 */

const INDICATOR = {
  id: 'ind-1', name: '낙상 발생률', targetValue: 2,
  direction: 'LOWER_IS_BETTER', unit: '건/1000 재원일수', valueScale: 1000,
};

function makeService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    qualityIndicator: {
      findUnique: vi.fn().mockResolvedValue(INDICATOR),
      update: vi.fn().mockResolvedValue(INDICATOR),
      findMany: vi.fn().mockResolvedValue([]),
    },
    qiMeasurement: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', ...data })),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', value: 3, ...data })),
      ...(overrides.qiMeasurement as object ?? {}),
    },
  };
  return { svc: new QualityService(prisma as never), prisma };
}

describe('지표×기간은 하나다', () => {
  it('🔴 같은 기간이 이미 있으면 거절하고 정정 경로를 알려준다(덮어쓰지 않는다)', async () => {
    const { svc } = makeService({
      qiMeasurement: { findUnique: vi.fn().mockResolvedValue({ id: 'm-old', value: 4, voidedAt: null }) },
    });
    await expect(
      svc.addMeasurement({ indicatorId: 'ind-1', period: '2026-07', numerator: 3, denominator: 1000 } as never),
    ).rejects.toThrow(/이미 있습니다|정정/);
  });

  it('무효화된 같은 기간 행이 있으면 그 자리를 되살린다(유니크와 충돌하지 않게)', async () => {
    const update = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm-old', ...data }));
    const { svc } = makeService({
      qiMeasurement: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm-old', value: 4, voidedAt: new Date('2026-08-01') }),
        update,
      },
    });
    await svc.addMeasurement({ indicatorId: 'ind-1', period: '2026-07', numerator: 3, denominator: 1000 } as never);
    expect(update).toHaveBeenCalled();
    const data = update.mock.calls[0][0].data;
    expect(data.voidedAt, '되살릴 때 무효화 표시를 지운다').toBeNull();
  });
});

describe('정정(update)', () => {
  let svc: QualityService;
  let prisma: { qiMeasurement: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    const made = makeService({
      qiMeasurement: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'm1', indicatorId: 'ind-1', period: '2026-07',
          numerator: 3, denominator: 1000, value: 3, meetTarget: false,
          notes: null, voidedAt: null, indicator: INDICATOR,
        }),
        update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', ...data })),
      },
    });
    svc = made.svc;
    prisma = made.prisma as never;
  });

  it('값과 판정을 다시 산출한다', async () => {
    const out = await svc.updateMeasurement('m1', { numerator: 1 }) as { value: number; meetTarget: boolean | null };
    // 1/1000 × 1000 = 1 (목표 2 이하 · LOWER_IS_BETTER → 달성)
    expect(out.value).toBe(1);
    expect(out.meetTarget).toBe(true);
  });

  it('🔴 분모 0 은 값 0 이 아니라 산출 불가다', async () => {
    await expect(svc.updateMeasurement('m1', { denominator: 0 })).rejects.toThrow(/분모|표본/);
  });

  it('🔴 기간·지표는 바꾸지 않는다(같은 행의 기간을 갈아끼우면 추적 불가)', async () => {
    await svc.updateMeasurement('m1', { numerator: 2 });
    const data = prisma.qiMeasurement.update.mock.calls[0][0].data;
    expect(data.period).toBeUndefined();
    expect(data.indicatorId).toBeUndefined();
  });

  it('무효화된 측정은 정정할 수 없다', async () => {
    const { svc: s2 } = makeService({
      qiMeasurement: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm1', voidedAt: new Date(), indicator: INDICATOR, numerator: 1, denominator: 10 }),
      },
    });
    await expect(s2.updateMeasurement('m1', { numerator: 2 })).rejects.toThrow(/무효화/);
  });
});

describe('무효화(void)', () => {
  it('🔴 지우지 않고 사유·시각·행위자를 남긴다', async () => {
    const update = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', ...data }));
    const { svc } = makeService({
      qiMeasurement: { findUnique: vi.fn().mockResolvedValue({ id: 'm1', voidedAt: null }), update },
    });
    await svc.voidMeasurement('m1', 'user-1', '분모를 잘못 집계함');
    const data = update.mock.calls[0][0].data;
    expect(data.voidedAt).toBeInstanceOf(Date);
    expect(data.voidedBy).toBe('user-1');
    expect(data.voidReason).toBe('분모를 잘못 집계함');
  });

  it('🔴 사유 없이 무효화하지 않는다 — 왜 취소했는지가 남아야 한다', async () => {
    const { svc } = makeService({
      qiMeasurement: { findUnique: vi.fn().mockResolvedValue({ id: 'm1', voidedAt: null }) },
    });
    await expect(svc.voidMeasurement('m1', 'user-1', '   ')).rejects.toThrow(/사유/);
  });

  it('이미 무효화된 것을 다시 무효화하지 않는다', async () => {
    const { svc } = makeService({
      qiMeasurement: { findUnique: vi.fn().mockResolvedValue({ id: 'm1', voidedAt: new Date() }) },
    });
    await expect(svc.voidMeasurement('m1', 'user-1', '사유')).rejects.toThrow(/이미/);
  });
});

describe('무효화된 측정은 조회·집계에서 빠진다', () => {
  it('🔴 기본 조회는 무효화분을 제외한다', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { svc } = makeService({ qiMeasurement: { findMany } });
    await svc.getMeasurements('ind-1');
    expect(findMany.mock.calls[0][0].where).toMatchObject({ voidedAt: null });
  });

  it('includeVoided 로만 이력이 보인다', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { svc } = makeService({ qiMeasurement: { findMany } });
    await svc.getMeasurements('ind-1', true);
    expect(findMany.mock.calls[0][0].where.voidedAt).toBeUndefined();
  });

  it('🔴 대시보드 최신값도 무효화분을 집지 않는다', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/modules/quality/quality.service.ts'), 'utf-8');
    // 2026-10-08 — 무효 조건은 읽기 정본 ACTIVE_MEASUREMENT(= { voidedAt: null })로 수렴
    expect(SRC).toMatch(/measurements:\s*\{\s*where:\s*(ACTIVE_MEASUREMENT|\{\s*voidedAt:\s*null\s*\})/);
  });
});

describe('스키마 계약', () => {
  const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');

  it('🔴 지표×기간 유니크 제약이 있다', () => {
    // 2026-10-08 QI 흐름 — 지표×기간×층×출처칸(수기·자동 나란히). 정정은 같은 칸 안에서 일어난다
    expect(SCHEMA).toMatch(/@@unique\(\[indicatorId, period, stratumKey, sourceKey\]\)/);
  });

  it('무효화 흔적 컬럼이 있다(하드 삭제가 아니다)', () => {
    for (const col of ['voidedAt', 'voidedBy', 'voidReason']) {
      expect(SCHEMA).toContain(col);
    }
  });
});
