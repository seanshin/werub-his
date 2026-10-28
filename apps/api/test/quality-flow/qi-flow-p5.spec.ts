/**
 * 결정이 선행인 몫을 운영 경로로(2026-10-09)
 *  · 적정성 평가 — 산출하지 않고 등재된 지표를 보인다(등재 0 이면 산출 불가) · 외부 통보 결과는 출처 EXTERNAL(통보 문서·번호 필수)
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { QiService } from '../../src/modules/qi/qi.service';
import { QualityController } from '../../src/modules/quality/quality.controller';

describe('적정성 평가', () => {
  it('🔴 등재된 지표가 없으면 산출 불가 + 결정 키(값을 지어내지 않는다)', async () => {
    const svc = new QiService({ qualityIndicator: { findMany: vi.fn(async () => [{ id: 'i', name: '낙상', category: '환자안전', measurements: [] }]) } } as never);
    const r = await svc.getAdequacyIndicators();
    expect(r.available).toBe(false);
    expect(r.reason).toContain('qi.hiraIndicatorSet');
  });
  it('적정성 분류 지표는 최신 정본 측정과 출처를 함께', async () => {
    const svc = new QiService({ qualityIndicator: { findMany: vi.fn(async () => [
      { id: 'a', name: '급성기 뇌졸중', category: '적정성 평가', targetValue: 90, direction: 'HIGHER_IS_BETTER', unit: '%', valueScale: 100, measurements: [{ id: 'm', period: '2026-06', value: 95, source: 'EXTERNAL', sourceKey: 'MANUAL', numerator: 95, denominator: 100 }] },
      { id: 'b', name: '낙상', category: '환자안전', measurements: [] },
    ]) } } as never);
    const r = await svc.getAdequacyIndicators();
    expect(r.available).toBe(true);
    expect(r.indicators).toEqual([expect.objectContaining({ indicatorId: 'a', value: 95, source: 'EXTERNAL', period: '2026-06', achieved: true })]);
  });
});

describe('외부 통보 결과 입력', () => {
  it('🔴 EXTERNAL 은 통보 문서·번호 필수 · 출처와 근거가 원장에 남는다 · 대조군: 기본은 MANUAL', async () => {
    const addMeasurement = vi.fn(async () => ({}));
    const c = new QualityController({ addMeasurement } as never);
    await expect(c.measure({ indicatorId: 'i', period: '2026-06', numerator: 1, denominator: 2, source: 'EXTERNAL' } as never, 'u1')).rejects.toThrow(BadRequestException);
    await c.measure({ indicatorId: 'i', period: '2026-06', numerator: 1, denominator: 2, source: 'EXTERNAL', externalRef: '심평원 통보 2026-118' } as never, 'u1');
    expect(addMeasurement).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'EXTERNAL', evidence: { externalRef: '심평원 통보 2026-118' }, createdBy: 'u1' }));
    await c.measure({ indicatorId: 'i', period: '2026-07', numerator: 1, denominator: 2 } as never, 'u1');
    expect(addMeasurement).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'MANUAL' }));
  });
});
