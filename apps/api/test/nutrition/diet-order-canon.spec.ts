/**
 * 🔴 식이 처방이 실제 배식에 반영되는가 — 임상 안전 직결.
 *
 * 2026-08-21 운영 실측:
 *   · 고단백식(HIGH_PROTEIN) 처방 환자 → 실제 배식 **일반식**
 *   · 신장식(RENAL) 처방 환자 → 실제 배식 **저단백식(CKD)**
 *   · `admissions.diet_type` 은 **전부 비어 있어** 앞으로 생성될 식사는 전부 `'일반식'` 이 될 상태였다
 * 원인: `generateDailyOrders` 가 `adm.dietType ?? '일반식'` 을 썼다 — **`DietOrder` 를 보지 않았다.**
 * 입원 목록 화면은 이미 "임상 정본은 활성 처방"이라 병합해 두었는데(2026-08-12) 배식만 옛 값을 따랐다.
 *
 * 재주입: `resolveDiet` 를 쓰지 않고 `adm.dietType ?? '일반식'` 로 되돌리면 이 파일이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { NutritionService } from '../../src/modules/nutrition/nutrition.service';

describe('식이 정본 해석 — 활성 처방 > 입원 시 지정 > 기본식', () => {
  it('🔴 활성 처방이 있으면 그것을 쓴다(입원 시 지정을 따르지 않는다)', () => {
    const r = NutritionService.resolveDiet({ dietType: 'HIGH_PROTEIN' }, '일반식');
    expect(r.dietType).toBe('HIGH_PROTEIN');
    expect(r.source).toBe('ORDER');
  });

  it('질감(texture)도 함께 말한다 — 연식·갈은식이 누락되면 흡인 위험이 있다', () => {
    const r = NutritionService.resolveDiet({ dietType: 'DIABETIC', texture: 'PUREED' }, null);
    expect(r.note).toContain('질감');
    expect(r.note).toContain('갈은식');
  });

  it('처방이 없으면 입원 시 지정을 쓰되, 처방이 없다는 사실을 남긴다', () => {
    const r = NutritionService.resolveDiet(undefined, '저염식');
    expect(r.dietType).toBe('저염식');
    expect(r.source).toBe('ADMISSION');
    expect(r.note).toContain('처방 없음');
  });

  it('🔴 둘 다 없으면 기본식으로 나가되 **조용히 하지 않는다**', () => {
    const r = NutritionService.resolveDiet(undefined, null);
    expect(r.dietType).toBe('일반식');
    expect(r.source).toBe('DEFAULT');
    expect(r.note).toContain('식이 처방이 없어');
    expect(r.note).toContain('확인이 필요');
  });
});

describe('일괄 생성 — 처방을 반영하고 누락을 센다', () => {
  const mk = (dietOrders: any[], admissionDiet: string | null) => {
    const upserts: any[] = [];
    const prisma: any = {
      admission: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'adm-1', patientId: 'pat-1', dietType: admissionDiet,
          patient: { id: 'pat-1', allergiesRel: [] }, bed: { ward: { name: '3A' } },
        }]),
      },
      dietOrder: { findMany: vi.fn().mockResolvedValue(dietOrders) },
      mealOrder: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(async (args: any) => { upserts.push(args); return {}; }),
      },
    };
    return { svc: new NutritionService(prisma), upserts, prisma };
  };

  it('🔴 활성 처방(RENAL)이 있으면 세 끼 모두 RENAL 로 만들어진다', async () => {
    const { svc, upserts } = mk([{ admissionId: 'adm-1', dietType: 'RENAL', texture: null, createdAt: new Date() }], null);
    const r: any = await svc.generateDailyOrders('2026-08-21');
    expect(upserts).toHaveLength(3);
    expect(upserts.map((u) => u.create.dietType)).toEqual(['RENAL', 'RENAL', 'RENAL']);
    // 이미 있는 식사도 처방으로 최신화한다 — 처방을 바꿨는데 옛 식이가 남으면 안 된다
    expect(upserts[0].update.dietType).toBe('RENAL');
    expect(r.withoutDietOrder).toBe(0);
  });

  it('🔴 처방이 없으면 기본식으로 만들되 `withoutDietOrder` 로 센다(분모와 함께)', async () => {
    const { svc, upserts } = mk([], null);
    const r: any = await svc.generateDailyOrders('2026-08-21');
    expect(upserts[0].create.dietType).toBe('일반식');
    expect(upserts[0].create.notes).toContain('처방이 없어');
    expect(r.withoutDietOrder).toBe(1);
    expect(r.admissions).toBe(1);
  });

  it('같은 입원에 활성 처방이 여러 건이면 최신 것을 쓴다', async () => {
    const { svc, upserts } = mk([
      { admissionId: 'adm-1', dietType: 'DIABETIC', texture: null, createdAt: new Date('2026-08-20') },
      { admissionId: 'adm-1', dietType: 'RENAL', texture: null, createdAt: new Date('2026-08-10') },
    ], null);
    await svc.generateDailyOrders('2026-08-21');
    expect(upserts[0].create.dietType).toBe('DIABETIC');
  });

  it('전원 처방이 있으면 경보를 만들지 않는다 — 거짓 경보 방지 대조군', async () => {
    const { svc } = mk([{ admissionId: 'adm-1', dietType: 'DIABETIC', texture: null, createdAt: new Date() }], '일반식');
    const r: any = await svc.generateDailyOrders('2026-08-21');
    expect(r.withoutDietOrder).toBe(0);
  });
});
