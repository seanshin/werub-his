import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  buildOrderData,
  emitOrderCreated,
  orderTransitionData,
  assertOrderTransition,
  VALID_ORDER_TRANSITIONS,
  TYPE_TO_DEPARTMENT,
} from '../../src/modules/order/order.service';

describe('Order 생성 게이트웨이 (buildOrderData)', () => {
  it('should map all 7 prescription types via TYPE_TO_DEPARTMENT (정본 단일화)', () => {
    expect(buildOrderData({ prescriptionId: 'rx', type: 'MEDICATION' }).department).toBe('PHARMACY');
    expect(buildOrderData({ prescriptionId: 'rx', type: 'LAB' }).department).toBe('LAB');
    expect(buildOrderData({ prescriptionId: 'rx', type: 'IMAGING' }).department).toBe('IMAGING');
    // 복사/반복 경로의 3-way 삼항이 IMAGING으로 오분류하던 유형들
    expect(buildOrderData({ prescriptionId: 'rx', type: 'THERAPY' }).department).toBe('THERAPY');
    expect(buildOrderData({ prescriptionId: 'rx', type: 'DIET' }).department).toBe('PHARMACY');
    expect(buildOrderData({ prescriptionId: 'rx', type: 'ACTIVITY' }).department).toBe('PHARMACY');
    expect(buildOrderData({ prescriptionId: 'rx', type: 'NURSING' }).department).toBe('PHARMACY');
  });

  it('should set pharmacyType only from MEDICATION dispensingType (원외 처방 유지)', () => {
    expect(buildOrderData({ prescriptionId: 'rx', type: 'MEDICATION', dispensingType: 'EXTERNAL' }).pharmacyType).toBe('EXTERNAL');
    expect(buildOrderData({ prescriptionId: 'rx', type: 'MEDICATION' }).pharmacyType).toBe('INTERNAL');
    expect(buildOrderData({ prescriptionId: 'rx', type: 'LAB', dispensingType: 'EXTERNAL' }).pharmacyType).toBe('INTERNAL');
  });

  it('should default priority ROUTINE and pass preOrderId/notes', () => {
    const d = buildOrderData({ prescriptionId: 'rx', type: 'LAB', preOrderId: 'po-1', notes: 'memo' });
    expect(d.priority).toBe('ROUTINE');
    expect(d.status).toBe('ORDERED');
    expect(d.preOrderId).toBe('po-1');
    expect(d.notes).toBe('memo');
    expect(buildOrderData({ prescriptionId: 'rx', type: 'LAB', priority: 'STAT' }).priority).toBe('STAT');
  });

  it('emitOrderCreated should publish standard payload', () => {
    const emitter = { emit: vi.fn() };
    emitOrderCreated(emitter, { orderId: 'o-1', type: 'IMAGING', patientId: 'p-1', priority: null });
    expect(emitter.emit).toHaveBeenCalledWith('order.created',
      expect.objectContaining({ orderId: 'o-1', type: 'IMAGING', patientId: 'p-1', priority: 'ROUTINE' }));
  });
});

describe('Order 상태기계 (병합·역전이 반영)', () => {
  it('should allow merged transitions used by domain paths', () => {
    expect(() => assertOrderTransition('ORDERED', 'IN_PROGRESS')).not.toThrow(); // 접수 생략 시행
    expect(() => assertOrderTransition('RECEIVED', 'COMPLETED')).not.toThrow(); // 시행 즉시 완료
    expect(() => assertOrderTransition('IN_PROGRESS', 'RECEIVED')).not.toThrow(); // 재작업 롤백
  });

  it('should still reject invalid transitions', () => {
    expect(() => assertOrderTransition('COMPLETED', 'IN_PROGRESS')).toThrow(BadRequestException);
    expect(() => assertOrderTransition('CANCELLED', 'ORDERED')).toThrow(BadRequestException);
    expect(() => assertOrderTransition('ORDERED', 'COMPLETED')).toThrow(BadRequestException); // 이중 병합은 불허
  });

  it('FSM 정의가 전 상태를 커버한다', () => {
    for (const st of ['ORDERED', 'RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const) {
      expect(VALID_ORDER_TRANSITIONS[st]).toBeDefined();
    }
  });
});

describe('orderTransitionData (전이+시행자 스탬프)', () => {
  it('should stamp receiver/starter/completer per transition', () => {
    expect(orderTransitionData('RECEIVED', 'u-1')).toEqual(
      expect.objectContaining({ status: 'RECEIVED', receivedById: 'u-1', receivedAt: expect.any(Date) }));
    expect(orderTransitionData('IN_PROGRESS', 'u-1')).toEqual(
      expect.objectContaining({ status: 'IN_PROGRESS', startedById: 'u-1', startedAt: expect.any(Date) }));
    expect(orderTransitionData('COMPLETED', 'u-1')).toEqual(
      expect.objectContaining({ status: 'COMPLETED', completedById: 'u-1', completedAt: expect.any(Date) }));
  });

  it('should stamp time even without userId (기존 관례 유지)', () => {
    const d = orderTransitionData('COMPLETED');
    expect(d.completedAt).toEqual(expect.any(Date));
    expect(d).not.toHaveProperty('completedById');
  });

  it('TYPE_TO_DEPARTMENT 정본이 7유형 전부를 정의한다', () => {
    expect(Object.keys(TYPE_TO_DEPARTMENT).sort()).toEqual(
      ['ACTIVITY', 'DIET', 'IMAGING', 'LAB', 'MEDICATION', 'NURSING', 'THERAPY'],
    );
  });
});
