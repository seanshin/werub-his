import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QualityController } from '../../src/modules/quality/quality.controller';
import { QualityService } from '../../src/modules/quality/quality.service';

describe('QualityController', () => {
  let controller: QualityController;
  let mockService: any;

  beforeEach(() => {
    mockService = { getIndicators: vi.fn(), createIndicator: vi.fn(), guardDirectEdit: vi.fn().mockResolvedValue(undefined), addMeasurement: vi.fn(), getMeasurements: vi.fn(), getDashboard: vi.fn() };
    controller = new QualityController(mockService as QualityService);
  });

  it('getIndicators wraps in { data }', async () => {
    mockService.getIndicators.mockResolvedValue([{ id: 'i1' }]);
    expect(await controller.getIndicators()).toEqual({ data: [{ id: 'i1' }] });
  });

  it('create wraps in { data }', async () => {
    mockService.createIndicator.mockResolvedValue({ id: 'i1' });
    expect((await controller.create({ name: '낙상률', category: 'SAFETY', formula: 'x', targetValue: 1, changeReason: '신규 지표 등재' } as any, 'u1')).data.id).toBe('i1');
    // 결정 qi.indicator.directEdit — 화면 생성은 가드를 지난다 · 사유는 지표 필드로 저장하지 않는다
    expect(mockService.guardDirectEdit).toHaveBeenCalledWith({ create: true, fields: [], changeReason: '신규 지표 등재' });
    expect(mockService.createIndicator.mock.calls[0][0]).not.toHaveProperty('changeReason');
  });

  it('measure wraps in { data }', async () => {
    mockService.addMeasurement.mockResolvedValue({ id: 'm1', value: 90 });
    expect((await controller.measure({ indicatorId: 'i1', period: '2026-05', numerator: 90, denominator: 100 } as any, 'u1')).data.value).toBe(90);
    // 화면 입력 = 출처 MANUAL
    expect(mockService.addMeasurement.mock.calls.at(-1)[0]).toMatchObject({ source: 'MANUAL' });
  });

  it('getMeasurements returns trend', async () => {
    mockService.getMeasurements.mockResolvedValue([{ id: 'm1' }]);
    expect((await controller.getMeasurements('i1')).data).toHaveLength(1);
  });

  it('getDashboard returns all indicators', async () => {
    mockService.getDashboard.mockResolvedValue([{ id: 'i1', latestValue: 0.8 }]);
    expect((await controller.getDashboard()).data[0].latestValue).toBe(0.8);
  });
});
