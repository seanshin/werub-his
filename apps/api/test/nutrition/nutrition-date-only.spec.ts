/**
 * 🔴 급양 축 날짜 정합 가드 — `@db.Date` 컬럼에 **하루 밀린 값**을 넣지 않는다.
 *
 * 2026-08-21 운영 실증에서 확인한 것:
 *   · `POST /nutrition/staff-menu { date: '2026-08-21' }` → DB `2026-08-20` (하루 앞)
 *   · 직원이 8/21 점심을 신청하면 화면의 **8/20 칸**에 뜬다(FE 는 `date.slice(0,10)` 로 칸을 고른다)
 *   · 마감 응답이 `date: '2026-08-20'` — 화면은 "오늘 마감"이라 말하고 **어제 것을 마감**했다
 *   · 주간 통계는 **이중 밀림**(요청 주보다 2일 어긋남)
 *   · 월 정산은 `${month}-01T00:00:00+09:00` 이 UTC 로 전달 말일 15:00 이라
 *     **전달 말일 신청이 이번 달에 포함**됐다(급여공제 금액)
 *
 * 원인은 하나다 — `new Date('YYYY-MM-DD')`(UTC 자정)에 `.setHours(0,0,0,0)`(로컬 자정)을 걸면
 * KST 에서 **UTC 기준 전날**이 되고, Prisma `@db.Date` 는 그 UTC 날짜 부분만 저장한다.
 * 정본은 `common/day-range.ts` 의 `dateOnlyValue`/`todayDateOnly` 이며 이미 존재했다
 * (🔴 정본을 만든 것과 모든 소비처가 그것을 쓰는 것은 다른 일이다).
 *
 * 재주입: `dayValue` 를 `new Date(x)` + `setHours(0,0,0,0)` 로 되돌리면 이 파일이 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NutritionService } from '../../src/modules/nutrition/nutrition.service';

/** KST 에서 돌 때 UTC 자정으로 저장되는가 — TZ 를 강제해 재현한다 */
const KST = 'Asia/Seoul';
const origTZ = process.env.TZ;

const mk = () => {
  const prisma: any = {
    staffMealMenu: { upsert: vi.fn(async ({ create }: any) => create), findMany: vi.fn().mockResolvedValue([]) },
    staffMealRequest: {
      upsert: vi.fn(async ({ create }: any) => create),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    mealOrder: { create: vi.fn(async ({ data }: any) => data), update: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
    haccpCheck: { create: vi.fn(async ({ data }: any) => data), findMany: vi.fn().mockResolvedValue([]) },
    productionBatch: { findUnique: vi.fn().mockResolvedValue(null) },
    mealDeliveryCheck: { create: vi.fn(async ({ data }: any) => ({ id: 'c1', ...data })) },
  };
  const svc = new NutritionService(prisma);
  vi.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
  return { svc, prisma };
};

const iso = (d: Date) => d.toISOString();

describe('급양 날짜 — @db.Date 는 그 날짜의 UTC 자정이다', () => {
  beforeEach(() => { process.env.TZ = KST; vi.restoreAllMocks(); });
  afterEach(() => { process.env.TZ = origTZ; });

  it('🔴 직원 식단 등록: 2026-08-21 을 넣으면 2026-08-21T00:00:00.000Z 로 저장된다(하루 앞이 아니다)', async () => {
    const { svc, prisma } = mk();
    await svc.upsertStaffMenu({ date: '2026-08-21', mealType: 'LUNCH', courseType: 'A', menuName: '된장찌개' }, 'u1');
    const created = prisma.staffMealMenu.upsert.mock.calls[0][0].create;
    expect(iso(created.date)).toBe('2026-08-21T00:00:00.000Z');
    // 조회 키(where)도 같은 값이어야 한다 — 한쪽만 고치면 반대로 어긋난다
    const where = prisma.staffMealMenu.upsert.mock.calls[0][0].where.date_mealType_courseType;
    expect(iso(where.date)).toBe('2026-08-21T00:00:00.000Z');
  });

  it('🔴 식수 신청: 신청한 날짜 그대로 저장된다 — 직원이 고른 칸과 같은 칸에 뜬다', async () => {
    const { svc, prisma } = mk();
    await svc.requestStaffMeal('u1', { date: '2026-08-21', mealType: 'LUNCH', courseType: 'A' });
    const created = prisma.staffMealRequest.upsert.mock.calls[0][0].create;
    expect(iso(created.date)).toBe('2026-08-21T00:00:00.000Z');
  });

  it('🔴 마감 확정: 요청한 날짜를 마감하고, 응답도 그 날짜를 말한다(어제가 아니다)', async () => {
    const { svc, prisma } = mk();
    const r = await svc.confirmStaffMeals('2026-08-21');
    expect(r.date).toBe('2026-08-21');
    const where = prisma.staffMealRequest.updateMany.mock.calls[0][0].where.date;
    expect(iso(where.gte)).toBe('2026-08-21T00:00:00.000Z');
    expect(iso(where.lt)).toBe('2026-08-22T00:00:00.000Z');
  });

  it('🔴 주간 통계: 요청한 주의 7일을 그대로 돌려준다(이중 밀림 없음)', async () => {
    const { svc } = mk();
    const days = await svc.getStaffMealWeeklyStats('2026-08-17');
    expect(days.map((d) => d.date)).toEqual([
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23',
    ]);
  });

  it('🔴 월 정산: 그 달 1일부터 다음 달 1일 전까지 — 전달 말일이 섞이지 않는다', async () => {
    const { svc, prisma } = mk();
    await svc.getStaffMealSettlement('2026-08');
    const where = prisma.staffMealRequest.findMany.mock.calls[0][0].where.date;
    expect(iso(where.gte)).toBe('2026-08-01T00:00:00.000Z');
    expect(iso(where.lt)).toBe('2026-09-01T00:00:00.000Z');
  });

  it('🔴 HACCP: 기록 날짜가 하루 밀리지 않는다(법정 기록의 일자)', async () => {
    const { svc, prisma } = mk();
    await svc.recordHaccp({ date: '2026-08-21', ccpType: 'HEATING', value: 78 }, 'u1');
    expect(iso(prisma.haccpCheck.create.mock.calls[0][0].data.date)).toBe('2026-08-21T00:00:00.000Z');
  });

  it('잘못된 날짜는 500 이 아니라 400 으로 말한다 — 사용자가 자기 입력 문제인 줄 알 수 있게', async () => {
    const { svc } = mk();
    await expect(svc.upsertStaffMenu({ date: 'not-a-date', mealType: 'LUNCH', courseType: 'A', menuName: 'x' }, 'u1'))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('배식·상태 — 실패를 삼키지 않는다', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('🔴 배식 확인은 남았는데 상태 갱신이 실패하면 그 사실을 돌려준다', async () => {
    const { svc, prisma } = mk();
    prisma.mealOrder.update.mockRejectedValue(new Error('DB down'));
    const r: any = await svc.recordDeliveryCheck('m1', { patientVerified: true }, 'u1');
    expect(r.statusUpdated).toBe(false);
    expect(r.statusNote).toContain('배식 완료');
    expect(r.id).toBe('c1'); // 확인 기록 자체는 살아 있다 — 없던 일로 만들지 않는다
  });

  it('성공하면 실패라 말하지 않는다 — 거짓 경보 방지 대조군', async () => {
    const { svc } = mk();
    const r: any = await svc.recordDeliveryCheck('m1', { patientVerified: true }, 'u1');
    expect(r.statusUpdated).toBe(true);
    expect(r.statusNote).toBeUndefined();
  });

  it('🔴 미배식은 사유 없이 기록되지 않는다 — 왜 안 나갔는지를 잃지 않는다', async () => {
    const { svc } = mk();
    await expect(svc.updateStatus('m1', 'UNDELIVERED')).rejects.toMatchObject({ status: 400 });
  });

  it('미배식이 아닌 상태로 되돌리면 지난 사유를 지운다 — 남으면 사실처럼 읽힌다', async () => {
    const { svc, prisma } = mk();
    await svc.updateStatus('m1', 'DELIVERED');
    expect(prisma.mealOrder.update.mock.calls[0][0].data.undeliveredReason).toBeNull();
  });
});
