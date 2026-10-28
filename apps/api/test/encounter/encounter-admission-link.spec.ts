import { describe, it, expect, vi } from 'vitest';
import { EncounterService } from '../../src/modules/encounter/encounter.service';

/**
 * 진료 ↔ 입원 연결(2026-09-30 의사 업무 점검).
 * 🔴 진료 작성·오더 화면이 patientId 만 보내 입원 환자의 진료가 입원과 끊겼다 — 입원 상세의 활성 오더·
 *    퇴원 '미결 오더'·오더 진료 조회가 encounter.admissionId 로 세는데 늘 0, visitType null 이라 외래로 청구됐다.
 */
function mk(activeAdmission: { id: string } | null, staff: { licenseNumber: string | null } | null = null) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    admission: { findFirst: vi.fn(async () => activeAdmission) },
    encounter: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'e1', ...data, doctor: { familyName: '김', givenName: '의사' } }; }),
      findUnique: vi.fn(async () => ({ id: 'e1', doctorId: 'd1', doctor: { id: 'd1', familyName: '김', givenName: '의사' } })),
    },
    staff: { findUnique: vi.fn(async () => staff) },
  };
  const svc = new EncounterService(prisma as never, { emit: vi.fn() } as never);
  vi.spyOn(svc as unknown as { gateDiagnosisRestrictions: () => Promise<unknown[]> }, 'gateDiagnosisRestrictions').mockResolvedValue([]);
  return { svc, created, prisma };
}

describe('입원 중 환자의 진료는 그 입원에 잇는다', () => {
  it('🔴 호출이 밝히지 않았고 입원 중이면 admissionId·INPATIENT', async () => {
    const { svc, created } = mk({ id: 'adm1' });
    await svc.create({ patientId: 'p1' } as never, 'd1');
    expect(created[0]).toMatchObject({ admissionId: 'adm1', visitType: 'INPATIENT' });
  });
  it('대조군 — 입원 중이 아니면 종전대로(null=외래)', async () => {
    const { svc, created } = mk(null);
    await svc.create({ patientId: 'p1' } as never, 'd1');
    expect(created[0].admissionId).toBeUndefined();
    expect(created[0].visitType).toBeUndefined();
  });
  it('호출이 visitType 을 밝혔으면(외래) 추정하지 않는다', async () => {
    const { svc, created, prisma } = mk({ id: 'adm1' });
    await svc.create({ patientId: 'p1', visitType: 'OUTPATIENT' } as never, 'd1');
    expect(created[0]).toMatchObject({ visitType: 'OUTPATIENT' });
    expect(created[0].admissionId).toBeUndefined();
    expect(prisma.admission.findFirst).not.toHaveBeenCalled();
  });
  it('입원을 밝히고 유형을 빠뜨리면 외래로 청구하지 않는다(INPATIENT)', async () => {
    const { svc, created } = mk(null);
    await svc.create({ patientId: 'p1', admissionId: 'adm9' } as never, 'd1');
    expect(created[0]).toMatchObject({ admissionId: 'adm9', visitType: 'INPATIENT' });
  });
  it('진행 중인 입원만 — 전원(TRANSFERRED)·퇴원은 입원 중이 아니다', async () => {
    const { svc, prisma } = mk(null);
    await svc.create({ patientId: 'p1' } as never, 'd1');
    expect(prisma.admission.findFirst.mock.calls[0][0]).toMatchObject({ where: { patientId: 'p1', status: 'ADMITTED' } });
  });
});

describe('진료 상세의 담당의 면허번호(처방전 인쇄)', () => {
  it('직원 행의 면허번호를 싣는다 · 없으면 null(지어내지 않는다)', async () => {
    const a = mk(null, { licenseNumber: '12345' });
    expect(((await a.svc.findDetail('e1')) as { doctor: { licenseNumber: string | null } }).doctor.licenseNumber).toBe('12345');
    const b = mk(null, null);
    expect(((await b.svc.findDetail('e1')) as { doctor: { licenseNumber: string | null } }).doctor.licenseNumber).toBeNull();
  });
});
