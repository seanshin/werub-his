import { describe, it, expect, vi } from 'vitest';
import { AdmissionService } from '../../src/modules/admission/admission.service';

/**
 * 재원 목록 필터 계약 — 2026-08-12 (화면 점검 W1).
 *
 * 🔴 주치의 워크스테이션이 `attendingDoctorId` 를 보내는데 **컨트롤러가 받지 않아 무시**됐다.
 *    그 결과 "담당 환자 5명"이 실제로는 **전체 재원 환자**였다 — 5명의 담당의가
 *    관리자·박내과·최외과·김내과·이외과로 제각각인데 로그인한 주치의에게 전부 보였다.
 *    재원이 100명이면 주치의 화면이 남의 환자 100명으로 찬다.
 *
 * "담당"이라고 쓴 목록은 담당만 담아야 한다.
 */

function svc() {
  const findMany = vi.fn().mockResolvedValue([]);
  const empty = {
    findMany: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };
  const prisma = {
    admission: { findMany },
    dietOrder: { findMany: vi.fn().mockResolvedValue([]) },
    preVisitVitals: { ...empty, findFirst: vi.fn().mockResolvedValue(null) },
    flowSheetEntry: empty, // 입원 활력 읽기 정본(두 원장 · 2026-10-10)
    prescription: empty,
    order: empty,
    medicationAdministration: empty,
    fallRiskAssessment: empty,
    encounter: empty,
  };
  return { s: new AdmissionService(prisma as never), findMany };
}

describe('재원 목록(getActiveAdmissions)', () => {
  it('🔴 주치의 필터를 적용한다 — 안 그러면 남의 환자가 "담당 환자"로 보인다', async () => {
    const { s, findMany } = svc();
    await s.getActiveAdmissions(undefined, 'doc-1');
    expect(findMany.mock.calls[0][0].where.attendingDoctorId).toBe('doc-1');
  });

  it('병동 필터는 그대로 동작한다(회귀 방지)', async () => {
    const { s, findMany } = svc();
    await s.getActiveAdmissions('ward-1');
    expect(findMany.mock.calls[0][0].where.bed).toEqual({ wardId: 'ward-1' });
  });

  it('둘 다 주면 함께 좁힌다', async () => {
    const { s, findMany } = svc();
    await s.getActiveAdmissions('ward-1', 'doc-1');
    const where = findMany.mock.calls[0][0].where;
    expect(where.bed).toEqual({ wardId: 'ward-1' });
    expect(where.attendingDoctorId).toBe('doc-1');
  });

  /**
   * 🔴 환자의 식이가 두 곳에 따로 있다 — `admissions.dietType`(입원 시 지정)과
   *    `diet_orders`(영양팀 처방). 연결이 없어 **고단백식 처방을 받은 환자가 입원 목록에서
   *    식이 `-`** 로 보였다(2026-08-12 실측). 임상 정본은 활성 처방이다.
   */
  it('🔴 활성 식이처방이 있으면 그것을 쓴다(입원 시 지정보다 우선)', async () => {
    const { s, findMany } = svc();
    findMany.mockResolvedValue([
      { id: 'a1', patientId: 'p1', dietType: 'REGULAR', bed: null, nursingAssessments: [], encounters: [] },
    ]);
    (s as unknown as { prisma: { dietOrder: { findMany: ReturnType<typeof vi.fn> } } }).prisma.dietOrder.findMany
      .mockResolvedValue([{ patientId: 'p1', dietType: 'HIGH_PROTEIN' }]);

    const [row] = await s.getActiveAdmissions();
    expect(row.dietType).toBe('HIGH_PROTEIN');
    expect(row.dietSource).toBe('ORDER');
  });

  it('처방이 없으면 입원 시 지정으로 폴백하고 출처를 밝힌다', async () => {
    const { s, findMany } = svc();
    findMany.mockResolvedValue([
      { id: 'a1', patientId: 'p1', dietType: 'REGULAR', bed: null, nursingAssessments: [], encounters: [] },
    ]);

    const [row] = await s.getActiveAdmissions();
    expect(row.dietType).toBe('REGULAR');
    expect(row.dietSource).toBe('ADMISSION');
  });

  it('둘 다 없으면 null — 빈 문자열로 말하지 않는다', async () => {
    const { s, findMany } = svc();
    findMany.mockResolvedValue([
      { id: 'a1', patientId: 'p1', dietType: null, bed: null, nursingAssessments: [], encounters: [] },
    ]);

    const [row] = await s.getActiveAdmissions();
    expect(row.dietType).toBeNull();
    expect(row.dietSource).toBeNull();
  });

  it('필터가 없으면 재원 전체(관리 화면 용도)', async () => {
    const { s, findMany } = svc();
    await s.getActiveAdmissions();
    const where = findMany.mock.calls[0][0].where;
    expect(where.attendingDoctorId).toBeUndefined();
    expect(where.bed).toBeUndefined();
  });
});
