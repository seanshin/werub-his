import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigRuntimeController } from '../../src/modules/config/config-runtime.controller';
import { BadRequestException } from '@nestjs/common';

/** 스카우트 4차 — 컷오버 게이트 우회 봉합(config PUT 보호 키) */
describe('ConfigRuntimeController — 보호 키 PUT 차단', () => {
  let ctrl: ConfigRuntimeController;
  let svc: any;
  beforeEach(() => {
    svc = { set: vi.fn().mockResolvedValue({ ok: true }) };
    ctrl = new ConfigRuntimeController(Object.assign({ get: async () => null }, svc) as never, { emitAsync: async () => [] } as never);
  });

  it('pseudonymizeChartNo 직접 PUT → 차단(승인 게이트 우회 방지)', async () => {
    await expect(ctrl.set('integration.pseudonymizeChartNo', { value: true } as any, 'u1')).rejects.toThrow(BadRequestException);
    expect(svc.set).not.toHaveBeenCalled();
  });

  it('cutoverApproval 위조 PUT → 차단(승인 레코드 조작 방지)', async () => {
    await expect(ctrl.set('integration.cutoverApproval', { value: { approvedAt: 'x' } } as any, 'u1')).rejects.toThrow(BadRequestException);
    expect(svc.set).not.toHaveBeenCalled();
  });

  it('일반 키는 정상 변경', async () => {
    await ctrl.set('ui.dateStyle', { value: 'ko' } as any, 'u1');
    expect(svc.set).toHaveBeenCalledWith('ui.dateStyle', 'ko', 'u1');
  });
});
