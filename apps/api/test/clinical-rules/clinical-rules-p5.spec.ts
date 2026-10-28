/**
 * 임상 규칙·템플릿 P5 B4(2026-10-21) — 약속처방 사용 중 전환 → 담당 위원회 안건.
 *  · 🔴 세트를 바꾸지 않는다 — 선택지(사용 중으로 = PUBLISH 집행 · 보류 = 집행 없음)를 안건으로만
 *  · 🔴 담당은 표면 매핑(카탈로그 단위 `publish:order_set`) — 없으면 owner null · 조회 실패는 전파(없음으로 접지 않음)
 *  · 🔴 사용 중으로 못 바꾸는 상태(승인 대기·사용 중·폐기)는 올리지 않는다 · 없는 세트 404
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CatalogAgendaService, ORDER_SET_PUBLISH_SURFACE } from '../../src/modules/clinical-rules/catalog-agenda.service';
import { SCREEN_AGENDA_SOURCES } from '../../src/modules/order-governance/committee-agenda.service';

function make(status: string | null, agendaOver: Record<string, unknown> = {}) {
  const prisma: any = { orderSet: { findUnique: vi.fn(async () => (status ? { id: 's1', name: '폐렴 세트', version: 2, status } : null)) } };
  const agenda: any = {
    ownerCommittee: vi.fn(async () => ({ id: 'c1', code: 'DTC', name: '약사위원회' })),
    submit: vi.fn(async () => ({ agenda: { id: 'a1' }, committee: { code: 'DTC' } })),
    list: vi.fn(async () => []),
    ...agendaOver,
  };
  return { svc: new CatalogAgendaService(prisma, agenda), prisma, agenda };
}

describe('🔴 약속처방 사용 중 전환 안건', () => {
  it('초안 → 카탈로그 표면으로 상정 · 선택지 PUBLISH(세트 id·publish)·보류(집행 없음) · 세트는 쓰지 않는다', async () => {
    const { svc, agenda, prisma } = make('DRAFT');
    await svc.submitOrderSetActivation('s1', 'u1');
    const [input, proposer] = agenda.submit.mock.calls[0];
    expect(proposer).toBe('u1');
    expect(input).toMatchObject({ surfaceKey: ORDER_SET_PUBLISH_SURFACE, source: 'CATALOG_ORDER_SET', key: 's1' });
    expect(input.options).toEqual([
      expect.objectContaining({ value: 'PUBLISH', enact: { kind: 'PUBLISH', target: { docType: 'ORDER_SET', id: 's1', op: 'publish' } } }),
      expect.objectContaining({ value: 'HOLD', enact: null }),
    ]);
    expect(Object.keys(prisma.orderSet)).toEqual(['findUnique']);
    expect(SCREEN_AGENDA_SOURCES).toContain('CATALOG_ORDER_SET');
  });
  it('승인됨도 올린다(사용 중으로 갈 수 있다)', async () => {
    const { svc, agenda } = make('APPROVED');
    await svc.submitOrderSetActivation('s1', 'u1');
    expect(agenda.submit).toHaveBeenCalled();
  });
  it('🔴 승인 대기·사용 중·폐기는 409 — 의결해도 집행이 거부되는 안건을 만들지 않는다 · 없는 세트 404', async () => {
    for (const st of ['PENDING_APPROVAL', 'ACTIVE', 'DEPRECATED']) {
      const { svc, agenda } = make(st);
      const e = await svc.submitOrderSetActivation('s1', 'u1').catch((x) => x);
      expect(e, st).toBeInstanceOf(ConflictException);
      expect(agenda.submit).not.toHaveBeenCalled();
    }
    await expect(make(null).svc.submitOrderSetActivation('s1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('담당 — 지정 안 됨은 null · 🔴 다른 실패는 전파(없음으로 접지 않음) · 대조군 지정됨', async () => {
    const none = make('DRAFT', { ownerCommittee: vi.fn().mockRejectedValue(new BadRequestException({ code: 'AGENDA_NO_OWNER', message: 'x' })) });
    expect(await none.svc.owner()).toBeNull();
    const broken = make('DRAFT', { ownerCommittee: vi.fn().mockRejectedValue(new Error('db down')) });
    await expect(broken.svc.owner()).rejects.toThrow('db down');
    const other400 = make('DRAFT', { ownerCommittee: vi.fn().mockRejectedValue(new BadRequestException({ code: 'OTHER' })) });
    await expect(other400.svc.owner()).rejects.toBeInstanceOf(BadRequestException);
    expect(await make('DRAFT').svc.owner()).toMatchObject({ code: 'DTC' });
  });
});
