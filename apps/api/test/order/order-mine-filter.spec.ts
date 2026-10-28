import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrderService } from '../../src/modules/order/order.service';
import { OrderController, parseMineFlag } from '../../src/modules/order/order.controller';
import { myOrdersPrescriptionWhere } from '../../src/modules/order/my-orders-scope';
import { matchesWhere } from '../common/prisma-where-eval';

/**
 * 🔴 (2026-09-30) 대시보드 '검사결과 도착' 위젯이 `/orders?...&mine=true` 를 보냈는데 `findAll` 이 `mine` 을
 *    **조용히 무시**했다 — 의사 대시보드에 병원 전체 완료 결과가 "내 결과"처럼 떴다.
 *    지키는 것: mine=true 는 내 오더(검사결과 확인함과 같은 정본)로 좁힌다 · 해석할 수 없는 값은 400.
 */
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function rows() {
  const mk = (id: string, rx: { prescriberId?: string | null; createdBy: string; doctorId: string }, patientId = 'p1') => ({
    id, department: 'LAB', status: 'COMPLETED', priority: 'ROUTINE', createdAt: new Date(),
    prescription: { prescriberId: rx.prescriberId ?? null, createdBy: rx.createdBy, type: 'LAB', encounter: { doctorId: rx.doctorId, patientId } },
  });
  return [
    mk('o-mine-enc', { createdBy: OTHER, doctorId: ME }),
    mk('o-mine-rx', { prescriberId: ME, createdBy: OTHER, doctorId: OTHER }),
    mk('o-mine-created', { createdBy: ME, doctorId: OTHER }),
    mk('o-other', { createdBy: OTHER, doctorId: OTHER }),
    mk('o-other-p2', { createdBy: OTHER, doctorId: ME }, 'p2'),
  ];
}

function makeService() {
  const data = rows();
  const prisma: any = {
    order: {
      findMany: vi.fn(async ({ where }: any) => data.filter((r) => matchesWhere(r, where))),
      count: vi.fn(async ({ where }: any) => data.filter((r) => matchesWhere(r, where)).length),
    },
    emergencyVisit: { findMany: vi.fn().mockResolvedValue([]) },
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  };
  return { service: new OrderService(prisma, {} as never), prisma };
}

describe('오더 목록 mine=true', () => {
  it('🔴 mine=true 면 내 오더만 — 남의 오더가 "내 것"으로 섞이지 않는다', async () => {
    const { service, prisma } = makeService();
    await service.findAll({ mine: true, mineUserId: ME });
    const where = prisma.order.findMany.mock.calls[0][0].where;
    const got = rows().filter((r) => matchesWhere(r, where)).map((r) => r.id).sort();
    expect(got).toEqual(['o-mine-created', 'o-mine-enc', 'o-mine-rx', 'o-other-p2'].sort());
  });

  it('다른 처방 필터(patientId)와 함께 걸린다 — 한쪽이 다른 쪽을 덮지 않는다', async () => {
    const { service, prisma } = makeService();
    await service.findAll({ mine: true, mineUserId: ME, patientId: 'p2' });
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(rows().filter((r) => matchesWhere(r, where)).map((r) => r.id)).toEqual(['o-other-p2']);
  });

  it('대조군: mine 이 없으면 종전처럼 전체 — 좁히지 않는다', async () => {
    const { service, prisma } = makeService();
    await service.findAll({});
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(rows().filter((r) => matchesWhere(r, where))).toHaveLength(5);
  });

  it('mine=true 인데 사용자를 모르면 400 — 전체를 내 것으로 말하지 않는다', async () => {
    const { service } = makeService();
    await expect(service.findAll({ mine: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('정본은 하나 — 확인함과 같은 정의(myOrdersPrescriptionWhere)', () => {
    const w = myOrdersPrescriptionWhere(ME);
    expect(w.OR).toHaveLength(3);
  });
});

describe('컨트롤러 mine 해석', () => {
  it('true/1 은 켬 · false/0/없음은 끔 · 그 외는 400(조용히 무시하지 않는다)', () => {
    expect(parseMineFlag('true')).toBe(true);
    expect(parseMineFlag('1')).toBe(true);
    expect(parseMineFlag(undefined)).toBe(false);
    expect(parseMineFlag('false')).toBe(false);
    expect(() => parseMineFlag('yes')).toThrow(BadRequestException);
  });

  it('로그인 사용자 id 를 서비스에 넘긴다(CurrentUser)', async () => {
    const svc = { findAll: vi.fn().mockResolvedValue({ data: [] }) };
    const ctl = new OrderController(svc as never);
    // 위치 인자: … patientId, prescribedBy, mine, rawQuery, currentUserId(병합 후 순서)
    await ctl.findAll('LAB', 'COMPLETED', undefined, undefined, undefined, undefined, undefined, undefined, '10',
      undefined, undefined, undefined, undefined, 'true', { department: 'LAB', status: 'COMPLETED', limit: '10', mine: 'true' }, ME);
    expect(svc.findAll).toHaveBeenCalledWith(expect.objectContaining({ mine: true, mineUserId: ME, department: 'LAB' }));
  });
});
