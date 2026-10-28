/**
 * 주치의 워크스테이션 필터가 서버에서 **실제로 적용되는지** (2026-09-30).
 *
 * 🔴 결함: 화면은 `GET /orders?prescribedBy=<나>&status=ORDERED`·`GET /handoffs?doctorId=<나>` 를 불렀는데
 *    서버가 두 키를 선언하지 않아 **조용히 버렸다** — "내 대기 오더"가 병원 전체 ORDERED 오더,
 *    "인수인계"가 전 병원 최근 인계였다. 의사 대시보드 결과 위젯의 `mine=true` 도 같은 식으로 버려졌다.
 * 봉합: ① 두 필터를 서버가 받는다 ② 모르는 필터는 400(`UNKNOWN_QUERY_PARAM`) — 버리지 않는다.
 * 대조군: 필터 없이 부르면 좁히지 않는다 · 알려진 키만 보내는 기존 호출은 통과한다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrderService } from '../../src/modules/order/order.service';
import { OrderController, ORDER_LIST_QUERY_KEYS } from '../../src/modules/order/order.controller';
import { InpatientController, HANDOFF_LIST_QUERY_KEYS } from '../../src/modules/inpatient/inpatient.controller';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';
import { assertKnownQueryKeys } from '../../src/common/known-query-keys';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('assertKnownQueryKeys', () => {
  it('모르는 키는 400 + 코드·키 목록', () => {
    try {
      assertKnownQueryKeys({ status: 'ORDERED', prescribedByX: ME }, ['status']);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as { code: string; message: string; details: { unknown: string[] } };
      expect(body.code).toBe('UNKNOWN_QUERY_PARAM');
      expect(body.details.unknown).toEqual(['prescribedByX']);
      // 서버 예외 문장에 한국어를 끼우지 않는다
      expect(/[가-힣]/.test(body.message)).toBe(false);
    }
  });
  it('대조군 — 알려진 키만이면 통과 · query 없음(직접 호출)이면 검사 안 함', () => {
    expect(() => assertKnownQueryKeys({ status: 'x' }, ['status'])).not.toThrow();
    expect(() => assertKnownQueryKeys(undefined, ['status'])).not.toThrow();
  });
});

describe('GET /orders — prescribedBy·mine 가 적용된다', () => {
  let prisma: { order: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> } };
  let service: OrderService;
  beforeEach(() => {
    prisma = { order: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) } };
    service = new OrderService(prisma as never, {} as never);
  });

  it('prescribedBy = 책임 처방의(prescriberId) 또는 미지정이면 입력자(createdBy)', async () => {
    await service.findAll({ prescribedBy: ME, status: 'ORDERED' });
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('ORDERED');
    expect(where.prescription.OR).toEqual([
      { prescriberId: ME },
      { prescriberId: null, createdBy: ME },
    ]);
  });

  it('대조군 — prescribedBy 없으면 처방의로 좁히지 않는다', async () => {
    await service.findAll({ status: 'ORDERED' });
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.prescription).toBeUndefined();
  });

  it('컨트롤러가 prescribedBy 를 서비스로 넘긴다(HTTP 경로 모양: rawQuery 동반)', async () => {
    const svc = { findAll: vi.fn().mockResolvedValue({ data: [] }) };
    const c = new OrderController(svc as never);
    const q = { prescribedBy: ME, status: 'ORDERED' };
    // 위치 인자: department,status,doctorId,type,from,to,priority,page,limit,careContext,nightOnly,patientId,prescribedBy,mine,rawQuery,currentUserId
    await c.findAll(undefined, 'ORDERED', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, ME, undefined, q, ME);
    expect(svc.findAll).toHaveBeenCalledWith(expect.objectContaining({ prescribedBy: ME, status: 'ORDERED' }));
  });

  // 병합(2026-09-30): mine 은 "내 오더" 정본(my-orders-scope — 처방의·입력자·진료의)으로 서비스에 넘긴다 — prescribedBy 와 정의가 다르다
  it('mine=true → 호출자 본인의 "내 오더"(정본 정의)', async () => {
    const svc = { findAll: vi.fn().mockResolvedValue({ data: [] }) };
    const c = new OrderController(svc as never);
    await c.findAll('LAB', 'COMPLETED', undefined, undefined, undefined, undefined, undefined, undefined, '10', undefined, undefined, undefined, undefined, 'true',
      { department: 'LAB', status: 'COMPLETED', limit: '10', mine: 'true' }, ME);
    expect(svc.findAll).toHaveBeenCalledWith(expect.objectContaining({ mine: true, mineUserId: ME, department: 'LAB', prescribedBy: undefined }));
  });

  it('mine=true 와 다른 사람의 prescribedBy 가 같이 오면 400(어느 쪽인지 추측하지 않는다)', async () => {
    const svc = { findAll: vi.fn() };
    const c = new OrderController(svc as never);
    await expect(c.findAll(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, OTHER, 'true',
      { prescribedBy: OTHER, mine: 'true' }, ME)).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.findAll).not.toHaveBeenCalled();
  });

  it('모르는 필터는 400 — 서비스까지 가지 않는다', async () => {
    const svc = { findAll: vi.fn() };
    const c = new OrderController(svc as never);
    await expect(c.findAll(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { prescriber: ME }, ME)).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.findAll).not.toHaveBeenCalled();
  });

  it('기존 화면들이 보내는 키는 전부 허용 목록에 있다(대조군 — 이번 봉합이 기존 호출을 깨지 않는다)', () => {
    // web 호출부 실측(2026-09-30): useOrders·imaging·nurse-station·대시보드·주치의 워크스테이션
    const used = ['department', 'status', 'limit', 'type', 'patientId', 'doctorId', 'from', 'to', 'careContext', 'nightOnly', 'mine', 'prescribedBy'];
    for (const k of used) expect(ORDER_LIST_QUERY_KEYS as readonly string[]).toContain(k);
  });
});

describe('GET /handoffs — doctorId 가 적용된다', () => {
  it('doctorId = 그 의사가 준(from) 또는 받은(to) 인계', async () => {
    const prisma = { clinicalHandoff: { findMany: vi.fn().mockResolvedValue([]) } };
    const svc = new InpatientService(prisma as never, {} as never);
    await svc.getRecentHandoffs(10, undefined, ME);
    const arg = prisma.clinicalHandoff.findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([{ fromDoctorId: ME }, { toDoctorId: ME }]);
  });

  it('대조군 — doctorId 없으면 좁히지 않는다 · admissionId 는 그대로 적용', async () => {
    const prisma = { clinicalHandoff: { findMany: vi.fn().mockResolvedValue([]) } };
    const svc = new InpatientService(prisma as never, {} as never);
    await svc.getRecentHandoffs(10, 'adm-1');
    const arg = prisma.clinicalHandoff.findMany.mock.calls[0][0];
    expect(arg.where.OR).toBeUndefined();
    expect(arg.where.admissionId).toBe('adm-1');
  });

  it('컨트롤러가 doctorId 를 넘기고, 모르는 필터는 400', async () => {
    const mock = { getRecentHandoffs: vi.fn().mockResolvedValue([]) };
    const c = new InpatientController(mock as never);
    await c.getRecentHandoffs(undefined, undefined, ME, { doctorId: ME });
    expect(mock.getRecentHandoffs).toHaveBeenCalledWith(10, undefined, ME);
    await expect(c.getRecentHandoffs(undefined, undefined, undefined, { attendingId: ME })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('대조군 — 기존 호출 키(limit·admissionId)는 허용', () => {
    for (const k of ['limit', 'admissionId', 'doctorId']) expect(HANDOFF_LIST_QUERY_KEYS as readonly string[]).toContain(k);
  });
});
