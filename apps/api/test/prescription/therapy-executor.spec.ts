import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REHAB_EXECUTOR_PROFESSIONS, THERAPY_EXECUTOR_PROFESSIONS } from '@hospital-run/shared';
import { assertTherapyExecutor } from '../../src/common/therapy-executor';

/**
 * 치료 시행(시작·완료) 직종 게이트 — 2026-09-29.
 * 🔴 종전: 치료 워크리스트는 LAB_TECH(치료사)에 열려 있었는데 시작·완료는 클래스 @Roles(DOCTOR·NURSE·ADMIN)라
 *    치료사가 누르면 상시 403. 재활 세션도 같은 형태(치료사 전면 403). LAB_TECH 는 임상병리사와 공유 → 직종으로 가른다.
 */
const prisma = (role: string, profession: string | null) => ({ user: { findUnique: vi.fn(async () => ({ role, profession })) } });

describe('치료 시행 직종 게이트', () => {
  it('물리치료사는 재활 세션 시행 · 임상병리사·직종 미지정은 거부', async () => {
    await expect(assertTherapyExecutor(prisma('LAB_TECH', 'PHYSICAL_THERAPIST'), 'u', REHAB_EXECUTOR_PROFESSIONS)).resolves.toBeUndefined();
    await expect(assertTherapyExecutor(prisma('LAB_TECH', 'CLINICAL_LAB_TECHNOLOGIST'), 'u', REHAB_EXECUTOR_PROFESSIONS)).rejects.toMatchObject({ response: { code: 'THERAPY_PROFESSION_REQUIRED' } });
    await expect(assertTherapyExecutor(prisma('LAB_TECH', null), 'u', THERAPY_EXECUTOR_PROFESSIONS)).rejects.toMatchObject({ response: { code: 'THERAPY_PROFESSION_REQUIRED' } });
  });
  it('대조군 — 의사·간호사는 종전대로 시행', async () => {
    await expect(assertTherapyExecutor(prisma('NURSE', null), 'u', REHAB_EXECUTOR_PROFESSIONS)).resolves.toBeUndefined();
    await expect(assertTherapyExecutor(prisma('DOCTOR', null), 'u', THERAPY_EXECUTOR_PROFESSIONS)).resolves.toBeUndefined();
  });

  const read = (f: string) => readFileSync(join(process.cwd(), 'src/modules', f), 'utf8');
  const rolesOf = (src: string, route: string) => {
    const i = src.indexOf(route); expect(i).toBeGreaterThan(-1);
    const win = src.slice(i, src.indexOf('async ', i));
    return /@Roles\(([^)]*)\)/.exec(win)?.[1] ?? '';
  };
  it.each([
    ['therapy-order/therapy-order.controller.ts', "@Patch(':id/start')"],
    ['therapy-order/therapy-order.controller.ts', "@Patch(':id/complete')"],
    ['rehab/rehab.controller.ts', "@Patch('sessions/:id/start')"],
    ['rehab/rehab.controller.ts', "@Patch('sessions/:id/complete')"],
    ['rehab/rehab.controller.ts', "@Get('therapist/schedule')"],
  ])('%s %s — 치료사(LAB_TECH)가 들어올 수 있다(직종은 서비스가 가른다)', (f, route) => {
    expect(rolesOf(read(f), route)).toContain('UserRole.LAB_TECH');
  });
  it('시행 서비스가 게이트를 부른다(열기만 하고 직종을 안 가르면 임상병리사도 치료 완료를 찍는다)', () => {
    expect(read('therapy-order/therapy-order.service.ts')).toMatch(/assertTherapyExecutor\(this\.prisma, userId, THERAPY_EXECUTOR_PROFESSIONS\)[\s\S]*assertTherapyExecutor\(this\.prisma, userId, THERAPY_EXECUTOR_PROFESSIONS\)/);
    expect(read('rehab/rehab.service.ts')).toMatch(/assertTherapyExecutor\(this\.prisma, opts\?\.userId, REHAB_EXECUTOR_PROFESSIONS\)[\s\S]*assertTherapyExecutor\(this\.prisma, userId, REHAB_EXECUTOR_PROFESSIONS\)/);
  });
});

describe('치료 일정 생성(therapy-orders POST) — 비의사는 본인이 입력한 치료 처방에만', async () => {
  const { TherapyOrderService } = await import('../../src/modules/therapy-order/therapy-order.service');
  const make = (role: string, profession: string | null, order: { createdBy: string; type: string } | null) => {
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ role, profession })) },
      order: { findUnique: vi.fn(async () => (order ? { prescription: order } : null)) },
      therapyOrder: { create: vi.fn(async () => ({ id: 't1' })) },
    };
    return { svc: new TherapyOrderService(prisma as never, { emit: vi.fn() } as never), prisma };
  };
  const dto = { orderId: 'o1', therapyType: 'PT', scheduledDate: '2026-09-29' } as never;
  it('물리치료사 — 본인이 입력한 치료 처방이면 생성', async () => {
    const { svc, prisma } = make('LAB_TECH', 'PHYSICAL_THERAPIST', { createdBy: 'me', type: 'THERAPY' });
    await expect(svc.create(dto, 'me')).resolves.toBeTruthy();
    expect(prisma.therapyOrder.create).toHaveBeenCalled();
  });
  it('🔴 남이 입력한 오더에 일정을 얹을 수 없다', async () => {
    const { svc, prisma } = make('NURSE', null, { createdBy: 'other', type: 'THERAPY' });
    await expect(svc.create(dto, 'me')).rejects.toMatchObject({ response: { code: 'THERAPY_ORDER_NOT_OWN' } });
    expect(prisma.therapyOrder.create).not.toHaveBeenCalled();
  });
  it('치료 처방이 아닌 오더 · 직종 미지정 LAB_TECH 는 거부', async () => {
    await expect(make('NURSE', null, { createdBy: 'me', type: 'LAB' }).svc.create(dto, 'me')).rejects.toMatchObject({ response: { code: 'THERAPY_ORDER_REQUIRED' } });
    await expect(make('LAB_TECH', null, { createdBy: 'me', type: 'THERAPY' }).svc.create(dto, 'me')).rejects.toMatchObject({ response: { code: 'THERAPY_PROFESSION_REQUIRED' } });
  });
  it('대조군 — 의사는 종전대로(소유 검사 없음)', async () => {
    const { svc } = make('DOCTOR', null, { createdBy: 'other', type: 'THERAPY' });
    await expect(svc.create(dto, 'me')).resolves.toBeTruthy();
  });
});
