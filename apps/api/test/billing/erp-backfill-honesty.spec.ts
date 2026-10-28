import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

/**
 * ERP 청구 백필 정직성 — 생태계 인바운드 §23·§24 회수(2026-09-23).
 *
 * §24 `backfillLines(from, to)` — 종전 `lte: new Date(to)`:
 *   ERP 가 `to=오늘` 로 당기면 **그날 수납이 통째로 빠졌다**(날짜만 든 문자열은 그날 00:00 — 그것도 UTC).
 *   → 날짜 구간 정본 `dayRange`(로컬 자정 `gte` · 다음 날 자정 미만 `lt`) 로 수렴. 경계값 골든으로 잡는다.
 *   형식이 틀린 날짜는 조용한 전건이 아니라 **400**.
 *
 * §23 `pullConfirmedDrugCodes()` — 종전 `const { updated, notFound } = …` 가 상류의 `rejected` 를 **버렸다**.
 *   pulled 3 = updated 1 + notFound 1 + (어디에도 안 보이는 1). 키가 빈 행은 `filter` 에서 사라져 `pulled` 에도 없었다.
 *   → `received / pulled / updated / rejected / malformed / notFound` 를 전부 돌려주고 크론도 미반영을 로그로 남긴다.
 */

function makeService(over: { medUpdateMany?: ReturnType<typeof vi.fn>; medUpdate?: ReturnType<typeof vi.fn>; medFindMany?: ReturnType<typeof vi.fn>; billingFindMany?: ReturnType<typeof vi.fn>; config?: Record<string, unknown> } = {}) {
  const billingFindMany = over.billingFindMany ?? vi.fn().mockResolvedValue([]);
  const medUpdateMany = over.medUpdateMany ?? vi.fn().mockResolvedValue({ count: 1 });
  const medUpdate = over.medUpdate ?? vi.fn().mockResolvedValue({});
  const medFindMany = over.medFindMany ?? vi.fn().mockResolvedValue([]);
  const prisma = {
    billing: { findMany: billingFindMany },
    medicationCode: { updateMany: medUpdateMany, update: medUpdate, findMany: medFindMany },
  };
  const cfg = over.config ?? {};
  const configRuntime = { get: vi.fn(async (k: string) => cfg[k]) };
  const svc = new BillingService(
    prisma as any,
    {} as any,
    { enqueue: vi.fn() } as any,
    configRuntime as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, billingFindMany, medUpdateMany, medUpdate, medFindMany, configRuntime };
}

describe('§24 backfillLines — 날짜 경계는 dayRange 정본 하나(그날 수납이 빠지지 않는다)', () => {
  it('🔴 경계값 골든 — to=그날 이면 그날 23:59:59.999 수납이 구간 안에 있고, 다음 날 00:00 은 밖이다', async () => {
    const { svc, billingFindMany } = makeService();
    await svc.backfillLines('2026-09-15', '2026-09-15');
    const where = billingFindMany.mock.calls[0][0].where as { createdAt: { gte?: Date; lt?: Date; lte?: Date } };
    expect(where.createdAt.lte, '`lte` 상한이 남아 있다 — 그날 00:00 이후 수납이 빠진다').toBeUndefined();
    expect(where.createdAt.gte).toEqual(new Date(2026, 8, 15, 0, 0, 0, 0));
    expect(where.createdAt.lt).toEqual(new Date(2026, 8, 16, 0, 0, 0, 0));
    const inRange = (d: Date) => d.getTime() >= where.createdAt.gte!.getTime() && d.getTime() < where.createdAt.lt!.getTime();
    expect(inRange(new Date(2026, 8, 15, 23, 59, 59, 999)), '그날 마지막 순간의 수납이 빠졌다').toBe(true);
    expect(inRange(new Date(2026, 8, 15, 0, 0, 0, 0)), '그날 자정 수납이 빠졌다').toBe(true);
    expect(inRange(new Date(2026, 8, 16, 0, 0, 0, 0)), '다음 날 자정이 들어왔다').toBe(false);
    expect(inRange(new Date(2026, 8, 14, 23, 59, 59, 999)), '전날 수납이 들어왔다').toBe(false);
  });

  it('🔴 하한은 UTC 자정이 아니라 서버 로컬 자정 — `new Date("YYYY-MM-DD")` 와 다르다', async () => {
    const { svc, billingFindMany } = makeService();
    await svc.backfillLines('2026-09-15');
    const where = billingFindMany.mock.calls[0][0].where as { createdAt: { gte?: Date; lt?: Date } };
    expect(where.createdAt.gte!.getHours()).toBe(0);
    expect(where.createdAt.gte!.getDate()).toBe(15);
    // TZ 가 UTC 인 러너에서는 두 값이 같을 수 있으므로 시각(로컬 0시)으로 판정한다 — 값 비교는 대조군일 뿐
    if (new Date().getTimezoneOffset() !== 0) expect(where.createdAt.gte!.getTime()).not.toBe(new Date('2026-09-15').getTime());
    expect(where.createdAt.lt, 'to 를 안 줬는데 상한이 생겼다').toBeUndefined();
  });

  it('to 만 주면 하한 없이 그날 끝까지', async () => {
    const { svc, billingFindMany } = makeService();
    await svc.backfillLines(undefined, '2026-09-15');
    const where = billingFindMany.mock.calls[0][0].where as { createdAt: { gte?: Date; lt?: Date } };
    expect(where.createdAt.gte).toBeUndefined();
    expect(where.createdAt.lt).toEqual(new Date(2026, 8, 16, 0, 0, 0, 0));
  });

  it('🔴 형식이 틀린 날짜는 400 — 조용히 전건이 되거나 500 이 나지 않는다', async () => {
    const { svc, billingFindMany } = makeService();
    // `2026/09/15` 같은 값은 정본이 ISO 로 읽는다(V8 이 파싱함) — 여기서 잡는 것은 **못 읽는 값**과 **달력에 없는 날짜**다
    await expect(svc.backfillLines('abc', undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.backfillLines(undefined, 'today')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.backfillLines('2026-13-40', undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.backfillLines(undefined, '2026-09-31')).rejects.toBeInstanceOf(BadRequestException);
    expect(billingFindMany, '400 인데 조회가 나갔다(전건 조회)').not.toHaveBeenCalled();
  });

  it('대조군 — 둘 다 안 주면 필터 없음(종전과 같다)', async () => {
    const { svc, billingFindMany } = makeService();
    await svc.backfillLines();
    expect(billingFindMany.mock.calls[0][0].where).toEqual({});
  });
});

describe('§23 pullConfirmedDrugCodes — 거부·누락·미존재를 버리지 않는다', () => {
  const ERP_ITEMS = [
    { his_code: 'A-OK', insurance_code: '641234567' }, //  반영
    { his_code: 'B-BAD', insurance_code: '12ab' }, //       형식 거부(숫자 8~13자리 아님)
    { his_code: 'C-NONE', insurance_code: '641234568' }, // HIS 미존재(updateMany count 0)
    { his_code: 'D-EMPTY', insurance_code: '' }, //         키 누락(종전엔 filter 에서 사라져 pulled 에도 없었다)
    { his_code: '', insurance_code: '641234569' }, //       키 누락
  ];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: ERP_ITEMS.length, items: ERP_ITEMS }) })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('🔴 received 5 = updated 1 + rejected 1 + notFound 1 + malformed 2 — 합이 맞고 어느 코드인지 보인다', async () => {
    const medUpdateMany = vi.fn(async ({ where }: { where: { code: string } }) => ({ count: where.code === 'A-OK' ? 1 : 0 }));
    const { svc } = makeService({ medUpdateMany, config: { 'erp.webhookUrl': 'http://erp.local/', 'erp.integrationKey': 'k' } });
    const r = await svc.pullConfirmedDrugCodes();
    expect(r.reason).toBeUndefined();
    expect(r.received).toBe(5);
    expect(r.pulled).toBe(3);
    expect(r.updated).toBe(1);
    expect(r.rejected, '형식 거부 건이 응답에서 사라졌다(§23 원결함)').toEqual(['B-BAD:12ab']);
    expect(r.notFound).toEqual(['C-NONE']);
    expect(r.malformed, '키 누락 행이 조용히 사라졌다').toEqual(['D-EMPTY:?', '?:641234569']);
    expect(r.updated + r.rejected.length + r.notFound.length + r.malformed.length, '분모와 갈래 합이 다르다').toBe(r.received);
    // 형식 거부·키 누락은 DB 에 닿지 않는다
    expect(medUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('🔴 DB 갱신 실패는 notFound 가 아니라 실패다(종전 `.catch(() => ({count:0}))` 가 "없음"으로 번역했다)', async () => {
    const medUpdateMany = vi.fn(async () => { throw new Error('db down'); });
    const { svc } = makeService({ medUpdateMany, config: { 'erp.webhookUrl': 'http://erp.local' } });
    await expect(svc.backfillInsuranceCodes([{ code: 'A-OK', insuranceCode: '641234567' }])).rejects.toThrow('db down');
  });

  it('ERP 미설정·HTTP 오류는 reason 과 함께 전부 0 — 0건 반영이 아니라 당기지 못한 것', async () => {
    const { svc: notConfigured } = makeService({ config: {} });
    expect(await notConfigured.pullConfirmedDrugCodes()).toEqual({ received: 0, pulled: 0, updated: 0, notFound: [], rejected: [], malformed: [], reason: 'ERP_NOT_CONFIGURED' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const { svc } = makeService({ config: { 'erp.webhookUrl': 'http://erp.local' } });
    expect((await svc.pullConfirmedDrugCodes()).reason).toBe('ERP_503');
  });

  it('🔴 크론 — updated 0 이어도 미반영이 있으면 warn 으로 남긴다(종전엔 `updated>0` 한 줄뿐)', async () => {
    const medUpdateMany = vi.fn(async () => ({ count: 0 }));
    const { svc } = makeService({ medUpdateMany, config: { 'erp.webhookEnabled': true, 'erp.webhookUrl': 'http://erp.local' } });
    const logger = (svc as unknown as { logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } }).logger;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    await svc.cronPullConfirmedDrugCodes();
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('unapplied=5/5');
    expect(warned).toContain('rejected=1(B-BAD:12ab)');
    expect(warned).toContain('malformed=2(');
    expect(warned).toContain('notFound=2(');
    // `backfillInsuranceCodes` 자체의 집계 로그(updated=0, …)는 별개 — 크론의 성공 줄만 본다
    expect(log.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[cron]')), 'updated=0 인데 크론 성공 로그가 났다').toEqual([]);
  });

  it('대조군 — 전건 반영이면 warn 이 없다(성공을 실패로 말하지 않는다)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [{ his_code: 'A-OK', insurance_code: '641234567' }] }) })));
    const { svc } = makeService({ config: { 'erp.webhookEnabled': true, 'erp.webhookUrl': 'http://erp.local' } });
    const logger = (svc as unknown as { logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } }).logger;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    await svc.cronPullConfirmedDrugCodes();
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * 성분코드 쌍둥이 (2026-09-27)
 *
 * 🔴 09-23 §23 은 `backfillInsuranceCodes` 의 `.catch(() => ({count:0}))` 만 고쳤다. **7줄 아래**
 *    `backfillIngredientCodes` 에 같은 삼킴이 그대로 있었고(형제 쿼리 하나만 막고 옆을 잊는 함정),
 *    `deriveIngredientKeys` 는 catch 에서 `skipped++` 한 뒤 `updated++` 가 그대로 실행돼
 *    **쓰지 않은 행을 "갱신"으로** 세고 같은 건을 두 번 셌다.
 */
describe('성분코드 백필·파생 — 실패를 "없음"도 "건너뜀"도 "갱신"도 아니라고 말한다', () => {
  it('🔴 DB 갱신 실패는 notFound 가 아니라 실패다(보험코드 쌍둥이와 같은 규칙)', async () => {
    const medUpdateMany = vi.fn(async () => { throw new Error('db down'); });
    const { svc } = makeService({ medUpdateMany });
    await expect(svc.backfillIngredientCodes([{ code: 'A-OK', ingredientCode: 'KR1234AB' }])).rejects.toThrow('db down');
  });

  it('대조군 — 정상 갱신은 updated 로 세고 실패로 말하지 않는다', async () => {
    const { svc } = makeService({ medUpdateMany: vi.fn().mockResolvedValue({ count: 1 }) });
    const r = await svc.backfillIngredientCodes([{ code: 'A-OK', ingredientCode: 'KR1234AB' }]);
    expect(r).toEqual({ updated: 1, notFound: [], rejected: [] });
  });

  it('🔴 파생 실패를 updated 로 세지 않는다 — failed 로 갈리고 분모(total)와 합이 맞는다', async () => {
    const medFindMany = vi.fn().mockResolvedValue([
      { id: 'm1', ingredient: '아세트아미노펜' },      // 정상 갱신
      { id: 'm2', ingredient: '이부프로펜' },          // DB 실패
      { id: 'm3', ingredient: '' },                    // 키 없음 = 의도적 건너뜀
    ]);
    const medUpdate = vi.fn(async ({ where }: any) => { if (where.id === 'm2') throw new Error('db down'); return {}; });
    const { svc } = makeService({ medFindMany, medUpdate });
    const r = await svc.deriveIngredientKeys(false);
    expect(r.updated, '쓰지 못한 행이 갱신으로 세어졌다').toBe(1);
    expect(r.failed, 'DB 실패가 사라졌다').toBe(1);
    expect(r.skipped, '키 없음(의도적 건너뜀)이 실패와 섞였다').toBe(1);
    expect(r.total).toBe(3);
    expect(r.updated + r.failed + r.skipped, '분모와 갈래 합이 다르다(같은 건이 두 번 세어졌다)').toBe(r.total);
  });

  it('대조군 — 전건 성공이면 failed 0 이고 updated 가 분모와 같다', async () => {
    const medFindMany = vi.fn().mockResolvedValue([{ id: 'm1', ingredient: '아세트아미노펜' }, { id: 'm2', ingredient: '이부프로펜' }]);
    const { svc } = makeService({ medFindMany });
    const r = await svc.deriveIngredientKeys(false);
    expect(r).toEqual({ updated: 2, skipped: 0, failed: 0, total: 2 });
  });
});
