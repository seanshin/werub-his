import { describe, it, expect } from 'vitest';
import { buildOrderData } from '../../src/modules/order/order.service';

/**
 * 비대면 처방의 약국 오더가 정본 게이트웨이 산출과 동일함을 고정(2026-07-30 봉합).
 * 종전: prisma.order.create 에 department/status/pharmacyType 인라인 하드코딩 + order.created 미발행
 *       → 여정(PRESCRIPTION_ADDED)·PACS 등 구독자 미발동.
 */
describe('비대면 처방 오더 — 정본 buildOrderData 산출', () => {
  it('외부 조제(EXTERNAL) 오더 필드가 정본과 일치', () => {
    const d = buildOrderData({ prescriptionId: 'rx1', type: 'MEDICATION', priority: 'ROUTINE', dispensingType: 'EXTERNAL' });
    expect(d).toMatchObject({
      prescriptionId: 'rx1',
      department: 'PHARMACY',
      status: 'ORDERED',
      priority: 'ROUTINE',
      pharmacyType: 'EXTERNAL',
    });
  });

  it('내부 조제(INTERNAL)도 동일 경로로 산출', () => {
    const d = buildOrderData({ prescriptionId: 'rx2', type: 'MEDICATION', priority: 'ROUTINE', dispensingType: 'INTERNAL' });
    expect(d).toMatchObject({ department: 'PHARMACY', pharmacyType: 'INTERNAL', status: 'ORDERED' });
  });

  it('dispensingType 미지정 시 정본 기본값(INTERNAL)', () => {
    const d = buildOrderData({ prescriptionId: 'rx3', type: 'MEDICATION' });
    expect(d).toMatchObject({ pharmacyType: 'INTERNAL', priority: 'ROUTINE' });
  });
});
