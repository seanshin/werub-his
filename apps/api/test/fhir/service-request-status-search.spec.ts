import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FhirController } from '../../src/modules/fhir/fhir.controller';
import {
  ORDER_STATUS_TO_FHIR_SR,
  orderStatusesForFhirSrSearch,
} from '../../src/modules/fhir/service-request-status';

/**
 * 🔴 ServiceRequest 검색 `status=active` ↔ 응답 매퍼 — 같은 표 하나.
 *
 * LIS 폴링 계약은 `category=laboratory&status=active&_lastUpdated=ge<직전>` 이다. 종전 검색은 active→ORDERED
 * 하나만 걸러, 폴링 사이에 HIS 에서 채혈(IN_PROGRESS)·접수(RECEIVED)가 먼저 된 오더는 **LIS 에 영영 가지 않았다.**
 * 응답 매퍼는 같은 오더를 `active` 로 내보내면서 말이다.
 *
 * 목은 Prisma `order.findMany` 의 where 를 **실제로 적용**하는 인메모리 테이블이다(where 를 무시하는 목은
 * 필터 결함을 못 잡는다).
 */
type OrderRow = { id: string; status: string; department: string; updatedAt: Date; createdAt: Date; priority: string; prescription: unknown };

function row(id: string, status: string, updatedAt = new Date('2026-09-28T10:02:00Z')): OrderRow {
  return {
    id, status, department: 'LAB', priority: 'STAT', updatedAt, createdAt: new Date('2026-09-28T10:00:00Z'),
    prescription: {
      procedureCodeId: 'pc-1',
      procedureCode: { code: 'B2570', nameKo: 'CBC' },
      encounter: { id: 'e1', patientId: 'p1', doctorId: 'd1', doctor: null, patient: { mrn: 'HR-1' } },
    },
  };
}

function applyWhere(rows: OrderRow[], where: Record<string, any>): OrderRow[] {
  return rows.filter((r) => {
    if (where.department?.in && !where.department.in.includes(r.department)) return false;
    if (where.status !== undefined) {
      if (typeof where.status === 'string' && r.status !== where.status) return false;
      if (where.status?.in && !where.status.in.includes(r.status)) return false;
    }
    if (where.updatedAt?.gte && r.updatedAt < where.updatedAt.gte) return false;
    return true;
  });
}

describe('ServiceRequest 검색 status — 매퍼와 같은 표', () => {
  let controller: FhirController;
  let rows: OrderRow[];

  beforeEach(() => {
    rows = [row('o-ordered', 'ORDERED'), row('o-received', 'RECEIVED'), row('o-collected', 'IN_PROGRESS'), row('o-done', 'COMPLETED'), row('o-cancel', 'CANCELLED')];
    const prisma = { order: { findMany: vi.fn(async (args: { where: Record<string, any> }) => applyWhere(rows, args.where)) } };
    const smartAuth = { hasScope: vi.fn().mockReturnValue(true), hasSystemScope: vi.fn().mockReturnValue(false), assertPatientAccess: vi.fn() };
    controller = new FhirController({} as never, {} as never, prisma as never, {} as never, smartAuth as never);
  });

  const ids = (b: any) => b.entry.map((e: any) => e.resource.id).sort();

  it('🔴 폴링 사이에 채혈·접수된 LAB 오더도 status=active 증분 폴링에 잡힌다', async () => {
    const b: any = await controller.searchServiceRequests(undefined, 'active', 'laboratory', 'ge2026-09-28T09:58:00Z');
    expect(ids(b)).toEqual(['o-collected', 'o-ordered', 'o-received']);
    // 같은 응답 안에서 — 찾힌 것은 전부 active 로 그려진다
    expect(b.entry.every((e: any) => e.resource.status === 'active')).toBe(true);
  });

  it('검색 결과의 status 는 항상 검색한 값과 같다 — 표의 모든 값에 대해(P12 역상 대조)', async () => {
    for (const code of new Set(Object.values(ORDER_STATUS_TO_FHIR_SR))) {
      const b: any = await controller.searchServiceRequests(undefined, code, 'laboratory');
      expect(b.entry.length).toBeGreaterThan(0);
      expect(b.entry.every((e: any) => e.resource.status === code)).toBe(true);
      // 역으로 — 이 값으로 그려지는 행은 전부 찾힌다
      const expected = rows.filter((r) => ORDER_STATUS_TO_FHIR_SR[r.status as keyof typeof ORDER_STATUS_TO_FHIR_SR] === code).map((r) => r.id).sort();
      expect(ids(b)).toEqual(expected);
    }
  });

  it('대조군 — revoked 는 취소만, completed 는 완료만(범위를 넓히지 않았다)', async () => {
    expect(ids(await controller.searchServiceRequests(undefined, 'revoked', 'laboratory'))).toEqual(['o-cancel']);
    expect(ids(await controller.searchServiceRequests(undefined, 'completed', 'laboratory'))).toEqual(['o-done']);
  });

  it('쉼표 OR — active,revoked', async () => {
    const b: any = await controller.searchServiceRequests(undefined, 'active,revoked', 'laboratory');
    expect(ids(b)).toEqual(['o-cancel', 'o-collected', 'o-ordered', 'o-received']);
  });

  it('매핑 없는 코드(draft·오타)는 전건이 아니라 빈 결과 — 필터를 버리지 않는다', async () => {
    expect((await controller.searchServiceRequests(undefined, 'draft', 'laboratory') as any).entry).toEqual([]);
    expect((await controller.searchServiceRequests(undefined, 'actve', 'laboratory') as any).entry).toEqual([]);
    expect(orderStatusesForFhirSrSearch('on-hold')).toEqual([]);
  });

  it('대조군 — status 미지정이면 상태로 거르지 않는다', async () => {
    expect(ids(await controller.searchServiceRequests(undefined, undefined, 'laboratory'))).toHaveLength(5);
  });
});
