/**
 * 🔴 식이 처방을 바꾸면 **아직 배식되지 않은 식사**가 따라 바뀌는가 · 이전 처방이 닫히는가.
 *
 * 종전: `createDietOrder` 가 그냥 `create` 만 했다 —
 *   · 이전 활성 처방이 **살아 남아** 소비처(`findFirst({isActive:true})`)가 어느 것을 볼지 알 수 없었다
 *   · 이미 생성된 오늘 식사는 **옛 식이 그대로** 주방에 나갔다
 * 🔴 이미 배식·섭취된 식사는 **일어난 사실**이므로 소급해 고치지 않는다.
 *
 * 재주입: 트랜잭션의 `updateMany`(이전 처방 종료) 또는 `applyDietToPendingMeals` 를 빼면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { NutritionAdvancedService } from '../../src/modules/nutrition/nutrition-advanced.service';

const mk = () => {
  const calls: Record<string, any[]> = { deactivate: [], mealUpdate: [] };
  const tx: any = {
    dietOrder: {
      updateMany: vi.fn(async (a: any) => { calls.deactivate.push(a); return { count: 1 }; }),
      create: vi.fn(async ({ data }: any) => ({ id: 'do-2', ...data })),
    },
  };
  const prisma: any = {
    $transaction: vi.fn(async (fn: any) => fn(tx)),
    mealOrder: { updateMany: vi.fn(async (a: any) => { calls.mealUpdate.push(a); return { count: 2 }; }) },
  };
  const svc = new NutritionAdvancedService(prisma, {} as any, {} as any, {} as any);
  vi.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  return { svc, prisma, calls };
};

describe('식이 처방 변경 전파', () => {
  it('🔴 새 처방을 내면 같은 입원의 이전 활성 처방이 닫힌다 — 한 시점 한 처방', async () => {
    const { svc, calls } = mk();
    await svc.createDietOrder({ patientId: 'p1', admissionId: 'adm-1', dietType: 'DIABETIC', startDate: '2026-08-21' }, 'u1');
    expect(calls.deactivate).toHaveLength(1);
    expect(calls.deactivate[0].where).toMatchObject({ admissionId: 'adm-1', isActive: true });
    expect(calls.deactivate[0].data.isActive).toBe(false);
  });

  it('🔴 아직 배식되지 않은 식사(ORDERED·PREPARED)만 새 식이로 갱신된다', async () => {
    const { svc, calls } = mk();
    const r: any = await svc.createDietOrder({ patientId: 'p1', admissionId: 'adm-1', dietType: 'DIABETIC', startDate: '2026-08-21' }, 'u1');
    expect(calls.mealUpdate).toHaveLength(1);
    expect(calls.mealUpdate[0].where.status.in).toEqual(['ORDERED', 'PREPARED']);
    expect(calls.mealUpdate[0].data.dietType).toBe('DIABETIC');
    expect(r.mealsUpdated).toBe(2);
  });

  it('🔴 이미 배식·섭취된 식사는 대상에서 빠진다 — 지난 기록을 소급해 바꾸지 않는다', async () => {
    const { svc, calls } = mk();
    await svc.createDietOrder({ patientId: 'p1', admissionId: 'adm-1', dietType: 'DIABETIC', startDate: '2026-08-21' }, 'u1');
    const statuses: string[] = calls.mealUpdate[0].where.status.in;
    for (const done of ['DELIVERED', 'COMPLETED', 'PARTIAL', 'REFUSED', 'UNDELIVERED']) {
      expect(statuses, `${done} 는 소급 대상이 아니다`).not.toContain(done);
    }
  });

  it('질감(texture)이 있으면 식사 비고에 함께 실린다', async () => {
    const { svc, calls } = mk();
    await svc.createDietOrder({ patientId: 'p1', admissionId: 'adm-1', dietType: 'DIABETIC', texture: 'SOFT', startDate: '2026-08-21' }, 'u1');
    expect(calls.mealUpdate[0].data.notes).toContain('연식');
  });

  it('잘못된 날짜는 500 이 아니라 400 으로 말한다', async () => {
    const { svc } = mk();
    await expect(svc.createDietOrder({ patientId: 'p1', admissionId: 'adm-1', dietType: 'DIABETIC', startDate: 'bad' }, 'u1'))
      .rejects.toMatchObject({ status: 400 });
  });
});
