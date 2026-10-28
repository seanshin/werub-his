import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmrCertController } from '../../src/modules/emr-cert/emr-cert.controller';
import { EmrCertService } from '../../src/modules/emr-cert/emr-cert.service';

describe('EmrCertController', () => {
  let controller: EmrCertController;
  let mockService: any;

  beforeEach(() => {
    mockService = { getChecklist: vi.fn(), getByCategory: vi.fn() };
    controller = new EmrCertController(mockService as EmrCertService);
  });

  it('getChecklist wraps in { data }', async () => {
    // 🔴 종전 스펙은 `total: 59` 리터럴을 계약으로 굳혔다(W8). 지금 계약은 실집계 요약이다.
    mockService.getChecklist.mockResolvedValue({ registered: 10, measured: 8, passed: 7, passRate: 88 });
    const result = await controller.getChecklist();
    expect(result.data.registered).toBe(10);
    expect(result.data.measured).toBe(8);
  });

  it('getByCategory wraps in { data }', async () => {
    mockService.getByCategory.mockResolvedValue([{ id: 'FN-01', category: '기능' }]);
    const result = await controller.getByCategory('기능');
    expect(result.data).toHaveLength(1);
  });
});
