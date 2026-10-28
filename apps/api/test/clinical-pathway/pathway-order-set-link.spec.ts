/**
 * 임상경로 마일스톤 ↔ 약속처방 세트 연결(2026-10-07).
 *  · 연결은 사용 중(ACTIVE) 세트만 · UUID 아님/없는 세트는 400 · null 은 연결 해제 · 다른 detail 키는 보존(병합)
 *  · 읽을 때 세트 이름·상태를 붙인다 — 사용 중지 세트는 그 상태로, 사라진 세트는 MISSING(이름 지어내지 않음)
 *  · 연결 없는 항목은 orderSet null(제목을 오더로 풀지 않는다)
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ClinicalPathwayService } from '../../src/modules/clinical-pathway/clinical-pathway.service';

const SET_A = '11111111-1111-4111-8111-111111111111';
const SET_OFF = '22222222-2222-4222-8222-222222222222';
const SET_GONE = '33333333-3333-4333-8333-333333333333';
const SET_DEL = '44444444-4444-4444-8444-444444444444';
const sets: Record<string, { id: string; name: string; status: string }> = {
  [SET_A]: { id: SET_A, name: '폐렴 입원 기본 오더', status: 'ACTIVE' },
  [SET_OFF]: { id: SET_OFF, name: '옛 세트', status: 'INACTIVE' },
  [SET_DEL]: { id: SET_DEL, name: '지운 세트', status: 'ACTIVE', isActive: false } as any,
};

function make() {
  const prisma: any = {
    clinicalPathway: { findUnique: vi.fn().mockResolvedValue({ id: 'pw-1', status: 'DRAFT' }) },
    pathwayMilestone: {
      create: vi.fn(async ({ data }: any) => ({ id: 'ms-new', ...data })),
      findUnique: vi.fn(),
      update: vi.fn(async ({ data }: any) => data),
    },
    pathwayAssignment: { findUnique: vi.fn() },
    orderSet: {
      findUnique: vi.fn(async ({ where }: any) => sets[where.id] ?? null),
      findMany: vi.fn(async ({ where }: any) => (where.id.in as string[]).map((i) => sets[i]).filter(Boolean)),
    },
  };
  return { prisma, svc: new ClinicalPathwayService(prisma) };
}

describe('연결 쓰기 검증', () => {
  it('🔴 사용 중 세트만 연결 — 중지·없음·UUID 아님은 400', async () => {
    const { svc, prisma } = make();
    await svc.addMilestone('pw-1', { day: 0, category: 'ORDER', title: 't', detail: { orderSetId: SET_A } });
    expect(prisma.pathwayMilestone.create.mock.calls[0][0].data.detail).toEqual({ orderSetId: SET_A });
    for (const bad of [SET_OFF, SET_GONE, SET_DEL, 'not-a-uuid', 42]) {
      await expect(svc.addMilestone('pw-1', { day: 0, category: 'ORDER', title: 't', detail: { orderSetId: bad } })).rejects.toThrow(BadRequestException);
    }
  });
  it('🔴 수정은 기존 detail 과 병합 · null 은 연결 해제(다른 키는 남는다)', async () => {
    const { svc, prisma } = make();
    prisma.pathwayMilestone.findUnique.mockResolvedValue({ id: 'ms-1', detail: { orderSetId: SET_A, note: '병동 공통' } });
    await svc.updateMilestone('ms-1', { detail: { orderSetId: null } });
    expect(prisma.pathwayMilestone.update.mock.calls[0][0].data.detail).toEqual({ note: '병동 공통' });
    await svc.updateMilestone('ms-1', { title: '제목만' });
    expect('detail' in prisma.pathwayMilestone.update.mock.calls[1][0].data).toBe(false);
  });
});

describe('읽기 — 세트 이름·상태', () => {
  it('🔴 배정 상세: 연결 ACTIVE·INACTIVE·MISSING·없음 네 경우', async () => {
    const { svc, prisma } = make();
    const ms = [
      { id: 'm1', isRequired: true, detail: { orderSetId: SET_A } },
      { id: 'm2', isRequired: true, detail: { orderSetId: SET_OFF } },
      { id: 'm3', isRequired: false, detail: { orderSetId: SET_GONE } },
      { id: 'm4', isRequired: false, detail: null },
      { id: 'm5', isRequired: false, detail: { orderSetId: SET_DEL } },
    ];
    prisma.pathwayAssignment.findUnique.mockResolvedValue({ id: 'a1', pathway: { id: 'pw-1', milestones: ms }, outcomes: [] });
    const r: any = await svc.getAssignment('a1');
    expect(r.pathway.milestones.map((m: any) => m.orderSet)).toEqual([
      { id: SET_A, name: '폐렴 입원 기본 오더', status: 'ACTIVE' },
      { id: SET_OFF, name: '옛 세트', status: 'INACTIVE' },
      { id: SET_GONE, name: null, status: 'MISSING' },
      null,
      { id: SET_DEL, name: '지운 세트', status: 'DELETED' },
    ]);
  });
  it('대조군 — 연결이 하나도 없으면 세트 조회를 하지 않는다', async () => {
    const { svc, prisma } = make();
    prisma.clinicalPathway.findUnique.mockResolvedValue({ id: 'pw-1', milestones: [{ id: 'm', detail: null }], _count: { assignments: 0 } });
    const r: any = await svc.findOne('pw-1');
    expect(r.milestones[0].orderSet).toBeNull();
    expect(prisma.orderSet.findMany).not.toHaveBeenCalled();
  });
});
