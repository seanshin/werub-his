import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NutritionService } from '../../src/modules/nutrition/nutrition.service';

/**
 * 배식 확인(5-Rights)은 **읽을 수 있어야 기록이다.**
 *
 * 🔴 2026-09-02 실측: `meal_delivery_checks` 는 쓰는 코드 1(배식 완료), **읽는 코드 0**.
 *    본인·식이유형·**알레르기**·온도 확인이 원장에 남는데 그것을 꺼내 볼 화면도 보고서도 없었다 —
 *    오배식이 나도 "누가 무엇을 확인했는가"를 아무도 답할 수 없다(§9 등록 EP 만으로는 기록이 아니다).
 *    관계(@relation)가 없는 컬럼이라 include 로 못 붙는다 → 같은 조회에서 배치로 붙인다.
 */
describe('급식 목록이 배식 확인 기록을 함께 돌려준다', () => {
  let prisma: any;
  let svc: NutritionService;

  const meal = (id: string) => ({ id, mealType: 'LUNCH', status: 'DELIVERED', patient: null, admission: null });

  beforeEach(() => {
    prisma = {
      mealOrder: { findMany: vi.fn().mockResolvedValue([meal('m1'), meal('m2')]) },
      mealDeliveryCheck: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    svc = new NutritionService(prisma, { emitWorkstation: vi.fn() } as any, { get: vi.fn() } as any);
  });

  it('🔴 확인 기록을 실제로 조회한다 — 안 부르면 원장이 화면에 영원히 안 나온다', async () => {
    await svc.getMealOrders('2026-09-02');
    expect(prisma.mealDeliveryCheck.findMany).toHaveBeenCalled();
    const where = prisma.mealDeliveryCheck.findMany.mock.calls[0][0].where;
    expect(where.mealOrderId.in).toEqual(['m1', 'm2']); // 배치 — N+1 아님
  });

  it('확인 항목을 그대로(참·거짓 모두) 붙인다 — 미확인이 사라지면 안 된다', async () => {
    prisma.mealDeliveryCheck.findMany.mockResolvedValue([
      { mealOrderId: 'm1', patientVerified: true, dietVerified: true, allergyVerified: false, tempOk: false, deliveredBy: 'u1', deliveredAt: new Date('2026-09-02T03:00:00Z') },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', familyName: '김', givenName: '급양' }]);
    const rows: any[] = await svc.getMealOrders('2026-09-02');
    const m1 = rows.find((r) => r.id === 'm1');
    expect(m1.deliveryCheck).toMatchObject({ patientVerified: true, allergyVerified: false, tempOk: false, deliveredByName: '김급양' });
    // 확인 기록이 없는 급식은 null — "확인 안 함"과 "기록 없음"을 뒤바꿔 말하지 않는다
    expect(rows.find((r) => r.id === 'm2').deliveryCheck).toBeNull();
  });

  it('🔴 배식자 이름을 못 찾으면 지어내지 않는다(null)', async () => {
    prisma.mealDeliveryCheck.findMany.mockResolvedValue([
      { mealOrderId: 'm1', patientVerified: true, dietVerified: true, allergyVerified: true, tempOk: true, deliveredBy: 'ghost', deliveredAt: new Date() },
    ]);
    prisma.user.findMany.mockResolvedValue([]);
    const rows: any[] = await svc.getMealOrders('2026-09-02');
    expect(rows.find((r) => r.id === 'm1').deliveryCheck.deliveredByName).toBeNull();
  });

  it('같은 급식에 확인이 여러 번이면 가장 최근 것', async () => {
    prisma.mealDeliveryCheck.findMany.mockResolvedValue([
      { mealOrderId: 'm1', patientVerified: true, dietVerified: true, allergyVerified: true, tempOk: true, deliveredBy: 'u1', deliveredAt: new Date('2026-09-02T05:00:00Z') },
      { mealOrderId: 'm1', patientVerified: false, dietVerified: false, allergyVerified: false, tempOk: false, deliveredBy: 'u1', deliveredAt: new Date('2026-09-02T03:00:00Z') },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', familyName: '김', givenName: '급양' }]);
    const rows: any[] = await svc.getMealOrders('2026-09-02');
    expect(rows.find((r) => r.id === 'm1').deliveryCheck.patientVerified).toBe(true);
  });

  it('급식이 없으면 확인 조회를 하지 않는다(빈 in 절 방지)', async () => {
    prisma.mealOrder.findMany.mockResolvedValue([]);
    await svc.getMealOrders('2026-09-02');
    expect(prisma.mealDeliveryCheck.findMany).not.toHaveBeenCalled();
  });
});

describe('화면이 그 기록을 실제로 그린다', () => {
  it('태블릿 급양 화면이 deliveryCheck 를 렌더한다 — 서버만 고치면 아무도 못 본다', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), '..', 'web', 'src', 'app', 'tablet', 'nutrition', 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toContain('<DeliveryCheckLine');
    expect(src).toContain('m.deliveryCheck');
  });
});
