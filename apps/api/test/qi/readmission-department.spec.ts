import { describe, it, expect, vi } from 'vitest';
import { QiService } from '../../src/modules/qi/qi.service';

/**
 * 🔴 재입원율 부서별 분해 (B5 · 2026-08-31).
 * 종전엔 Admission 에 진료과 컬럼이 없어 빈 배열이었다 → 주치의(없으면 입원의) 진료과 **파생**으로 실산출.
 * 🔴 분자/분모는 실제로 센 값·부서 분모 0이면 rate=null·미지정은 지어내지 않는다.
 */
function svc(discharged: any[]) {
  const prisma: any = {
    admission: {
      findMany: vi.fn().mockResolvedValue(discharged),
      // 재입원 카운트: 특정 patientId 만 1 반환
      count: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.patientId === 'p-readmit' ? 1 : 0)),
    },
    // 2026-10-08 — 목표는 질 지표 원장에서 읽는다(미등록이면 목표·판정 없음)
    qualityIndicator: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return new QiService(prisma);
}

describe('getReadmissionRate — 부서별 분해', () => {
  it('주치의 진료과로 파생 집계하고 분모/분자를 함께 낸다', async () => {
    const d = new Date('2026-08-10');
    const s = svc([
      { id: 'a1', patientId: 'p-readmit', dischargeDate: d, attendingDoctor: { department: '내과' }, admittingDoctor: null },
      { id: 'a2', patientId: 'p2', dischargeDate: d, attendingDoctor: { department: '내과' }, admittingDoctor: null },
      { id: 'a3', patientId: 'p3', dischargeDate: d, attendingDoctor: null, admittingDoctor: { department: '외과' } },
    ]);
    const r = await s.getReadmissionRate('2026-08');
    const 내과 = r.byDepartment.find((x) => x.department === '내과')!;
    expect(내과.discharges).toBe(2);
    expect(내과.readmissions).toBe(1);
    expect(내과.rate).toBe(50);
    const 외과 = r.byDepartment.find((x) => x.department === '외과')!;
    expect(외과.discharges).toBe(1);
    expect(외과.readmissions).toBe(0);
    expect(외과.rate).toBe(0);
  });

  it('🔴 주치의·입원의 진료과가 모두 없으면 미지정(지어내지 않는다)', async () => {
    const d = new Date('2026-08-10');
    const s = svc([{ id: 'a1', patientId: 'p1', dischargeDate: d, attendingDoctor: null, admittingDoctor: null }]);
    const r = await s.getReadmissionRate('2026-08');
    expect(r.byDepartment[0].department).toBe('미지정');
  });
});
