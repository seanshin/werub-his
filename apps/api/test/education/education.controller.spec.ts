import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EducationController } from '../../src/modules/education/education.controller';
import { EducationService } from '../../src/modules/education/education.service';

describe('EducationController', () => {
  let controller: EducationController;
  let mockService: any;

  beforeEach(() => {
    mockService = { getPrograms: vi.fn(), createProgram: vi.fn(), recordCompletion: vi.fn(), getStaffCompletions: vi.fn(), getExpiringSoon: vi.fn(), getCompletionCoverage: vi.fn() };
    controller = new EducationController(mockService as EducationService);
  });

  it('getPrograms wraps in { data }', async () => {
    mockService.getPrograms.mockResolvedValue([{ id: 'p1' }]);
    expect(await controller.getPrograms()).toEqual({ data: [{ id: 'p1' }] });
  });

  it('create wraps in { data }', async () => {
    mockService.createProgram.mockResolvedValue({ id: 'p1' });
    const result = await controller.create({ name: '감염', category: 'SAFETY', isMandatory: true } as any);
    expect(result.data.id).toBe('p1');
  });

  it('record wraps in { data }', async () => {
    mockService.recordCompletion.mockResolvedValue({ id: 'c1' });
    expect((await controller.record({ programId: 'p1', staffId: 's1' } as any)).data.id).toBe('c1');
  });

  it('getByStaff returns completions', async () => {
    mockService.getStaffCompletions.mockResolvedValue([{ id: 'c1' }]);
    expect((await controller.getByStaff('s1')).data).toHaveLength(1);
  });

  // 🔴 종전 스펙은 응답을 배열로 굳혀뒀다. 실효(경과)와 임박(도래 예정)이 섞여 있던 것이 원 결함이라
  //    계약을 `{ expired, dueSoon }` 로 바꾸고 스펙도 정본으로 갱신한다.
  it('getExpiring 은 실효/임박을 분리한 봉투를 돌려준다', async () => {
    const payload = {
      asOf: new Date().toISOString(), horizonDays: 30, limit: 200,
      expired: { total: 194, truncated: false, items: [{ id: 'c1' }] },
      dueSoon: { total: 67, truncated: false, items: [] },
    };
    mockService.getExpiringSoon.mockResolvedValue(payload);
    const res = await controller.getExpiring();
    expect(res.data.expired.total).toBe(194);
    expect(res.data.dueSoon.total).toBe(67);
  });

  it('getExpiring 은 limit 쿼리를 서비스로 넘긴다', async () => {
    mockService.getExpiringSoon.mockResolvedValue({});
    await controller.getExpiring('50');
    expect(mockService.getExpiringSoon).toHaveBeenCalledWith(50);
    await controller.getExpiring();
    expect(mockService.getExpiringSoon).toHaveBeenLastCalledWith(undefined);
  });

  it('getCoverage 는 이수율 산출 불가 사실을 그대로 전달한다', async () => {
    mockService.getCompletionCoverage.mockResolvedValue({ activeStaffTotal: 90, withAnyRecord: 56, withoutAnyRecord: 34, completionRate: null });
    const res = await controller.getCoverage();
    expect(res.data.completionRate).toBeNull();
    expect(res.data.withoutAnyRecord).toBe(34);
  });
});
