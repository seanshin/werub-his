import { describe, it, expect, vi } from 'vitest';
import { EncounterService } from '../../src/modules/encounter/encounter.service';

/**
 * 🔴 '미완료 차트' 위젯이 `?status=DRAFT&mine=true` 를 부르는데 서버가 그 필터를 **무시**했다
 *    (2026-08-26 실측 · `findAll` 이 patientId·doctorId·page·limit 만 처리).
 *    → 남의 진료·서명된 진료까지 "미완료"로 셌다.
 */
const prisma = () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  return { encounter: { findMany, count } } as any;
};

describe('진료기록 목록 필터', () => {
  it('🔴 status 를 where 에 건다(무시하지 않는다)', async () => {
    const p = prisma();
    await new EncounterService(p).findAll({ status: 'DRAFT' });
    expect(p.encounter.findMany.mock.calls[0][0].where).toMatchObject({ status: 'DRAFT' });
  });

  it('doctorId 도 함께 걸린다(내 것만)', async () => {
    const p = prisma();
    await new EncounterService(p).findAll({ status: 'DRAFT', doctorId: 'u1' });
    expect(p.encounter.findMany.mock.calls[0][0].where).toMatchObject({ status: 'DRAFT', doctorId: 'u1' });
  });

  it('🔴 대조군 — status 를 안 주면 상태 조건을 걸지 않는다(전체 조회가 막히면 안 된다)', async () => {
    const p = prisma();
    await new EncounterService(p).findAll({});
    expect(p.encounter.findMany.mock.calls[0][0].where.status).toBeUndefined();
  });
});
