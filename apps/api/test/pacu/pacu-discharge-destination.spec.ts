import { describe, it, expect, vi } from 'vitest';
import { PacuService } from '../../src/modules/pacu/pacu.service';

/**
 * PACU 퇴실 → 병상·ICU 연결 — 2026-09-30.
 *  종전: 퇴실은 disposition 만 적고 여정 이벤트뿐 — 병상·입원·ICU 는 아무것도 바뀌지 않았다.
 *  · WARD: 재원 중 입원 필수(없으면 409) · 원 병상 복귀 / 다른 병상 = 전실 정본(같은 트랜잭션 · 간호사·관리자)
 *  · ICU: 먼저 열린 ICU 입실을 잇거나 · 병상+사유+의사로 새 입실(같은 트랜잭션) · 둘 다 아니면 409
 *  · HOME: 재원 중이면 409(퇴원 절차를 건너뛰지 않는다)
 *  · 동시 퇴실이면 409 이고 병상·ICU 쓰기까지 되돌린다(조건부 갱신이 트랜잭션 안)
 */
const full = { activity: 2, respiration: 2, circulation: 2, consciousness: 2, spo2: 2, pain: 2 };
function mk(o: { admission?: unknown; icu?: unknown; doneCount?: number; bedFree?: boolean; icuFree?: boolean } = {}) {
  const record = { id: 'r1', patientId: 'p1', surgeryId: 's1', arrivalTime: new Date(), dischargeTime: null, aldretScore: 12, aldreteDetail: full, padssScore: 10, vitalSigns: [], arrivalHandoff: null, dischargeHandoff: null };
  const writes: string[] = [];
  const prisma: Record<string, any> = {
    pacuRecord: {
      findUnique: vi.fn(async () => record),
      // DB 처럼 — 이미 퇴실한 기록이면(doneCount 0) **조건부**(dischargeTime: null) 쓰기만 0건이다. 조건을 빼면 1건 맞아 버린다
      updateMany: vi.fn(async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        writes.push('pacu');
        const conditional = 'dischargeTime' in a.where && a.where.dischargeTime === null;
        return { count: conditional ? (o.doneCount ?? 1) : 1, data: a.data };
      }),
    },
    admission: {
      findFirst: vi.fn(async () => (o.admission === undefined ? { id: 'adm-1', bedId: 'bed-1', bed: { roomNumber: '501', bedNumber: '1', ward: { name: '5병동' } } } : o.admission)),
      update: vi.fn(async () => { writes.push('admission'); return { bedId: 'bed-9', bed: { roomNumber: '702', bedNumber: '2', ward: { name: '7병동' } } }; }),
    },
    icuAdmission: {
      findFirst: vi.fn(async () => o.icu ?? null),
      create: vi.fn(async () => { writes.push('icuAdmission'); return { id: 'icu-a', icuBedId: 'icub-1', icuBed: { unitName: 'MICU', bedNumber: '3' } }; }),
    },
    bed: {
      updateMany: vi.fn(async (a: { where: { status?: string } }) => { writes.push(a.where.status === 'AVAILABLE' ? 'bedClaim' : 'bedRelease'); return { count: a.where.status === 'AVAILABLE' && o.bedFree === false ? 0 : 1 }; }),
      // 5병동 → 7병동(병동이 바뀐다 → 담당 간호 배정 해제)
      findMany: vi.fn(async () => [{ id: 'bed-1', wardId: 'w5' }, { id: 'bed-9', wardId: 'w7' }]),
    },
    nursePatientAssignment: { updateMany: vi.fn(async () => { writes.push('nurseRelease'); return { count: 1 }; }) },
    bedAssignment: { updateMany: vi.fn(async () => { writes.push('assignClose'); }), create: vi.fn(async () => { writes.push('assignNew'); }) },
    icuBed: { updateMany: vi.fn(async () => { writes.push('icuClaim'); return { count: o.icuFree === false ? 0 : 1 }; }) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { svc: new PacuService(prisma as never), prisma, writes };
}
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;
const destOf = (prisma: Record<string, any>) => (prisma.pacuRecord.updateMany.mock.calls[0][0] as { data: { destination: Record<string, unknown> } }).data.destination;

describe('WARD', () => {
  it('원 병상 복귀 — 병상은 건드리지 않고 목적지를 기록한다', async () => {
    const { svc, prisma, writes } = mk();
    await svc.discharge('r1', 'n1', 'WARD', undefined, undefined, 'NURSE');
    expect(destOf(prisma)).toMatchObject({ kind: 'WARD', action: 'RETURN_TO_BED', admissionId: 'adm-1', bedId: 'bed-1', wardName: '5병동' });
    expect(writes).toEqual(['pacu']);
  });
  it('다른 병상 — 전실 정본(선점·반납·이력 닫기·새 이력·입원 bedId)을 퇴실과 같은 트랜잭션에서', async () => {
    const { svc, prisma, writes } = mk();
    await svc.discharge('r1', 'n1', 'WARD', undefined, undefined, 'NURSE', { targetBedId: 'bed-9' });
    expect(writes).toEqual(['bedClaim', 'bedRelease', 'assignClose', 'assignNew', 'nurseRelease', 'admission', 'pacu']);
    expect(destOf(prisma)).toMatchObject({ action: 'TRANSFERRED', bedId: 'bed-9', fromBedId: 'bed-1', wardName: '7병동' });
    expect(prisma.bedAssignment.create.mock.calls[0][0].data).toMatchObject({ reason: 'PACU_DISCHARGE' });
  });
  it('재원 중 입원이 없으면 409(입원 수속은 입원 경로) · 병상 이동은 간호사·관리자만 · 병상이 차 있으면 퇴실도 안 된다', async () => {
    await expect(mk({ admission: null }).svc.discharge('r1', 'n1', 'WARD', undefined, undefined, 'NURSE')).rejects.toSatisfy((e) => code(e) === 'PACU_WARD_NEEDS_ADMISSION');
    await expect(mk().svc.discharge('r1', 'd1', 'WARD', undefined, undefined, 'DOCTOR', { targetBedId: 'bed-9' })).rejects.toSatisfy((e) => code(e) === 'PACU_TRANSFER_ROLE');
    const full1 = mk({ bedFree: false });
    await expect(full1.svc.discharge('r1', 'n1', 'WARD', undefined, undefined, 'NURSE', { targetBedId: 'bed-9' })).rejects.toThrow(/not available/);
    expect(full1.writes).not.toContain('pacu');
  });
});

describe('ICU', () => {
  it('먼저 열린 ICU 입실을 잇는다(누구든) · 병동 병상은 비우지 않고 그 사실을 기록', async () => {
    const { svc, prisma, writes } = mk({ icu: { id: 'icu-0', icuBedId: 'icub-0' } });
    await svc.discharge('r1', 'n1', 'ICU', undefined, undefined, 'NURSE');
    expect(destOf(prisma)).toMatchObject({ kind: 'ICU', action: 'ICU_EXISTING', icuAdmissionId: 'icu-0', wardBedHeld: 'bed-1' });
    expect(writes).toEqual(['pacu']);
  });
  it('새 ICU 입실 — 병상·사유·의사 · 입실 정본을 같은 트랜잭션에서', async () => {
    const { svc, prisma, writes } = mk();
    await svc.discharge('r1', 'd1', 'ICU', undefined, undefined, 'DOCTOR', { icuBedId: 'icub-1', icuAdmitReason: '호흡 불안정' });
    expect(writes).toEqual(['icuClaim', 'icuAdmission', 'pacu']);
    expect(prisma.icuAdmission.create.mock.calls[0][0].data).toMatchObject({ patientId: 'p1', icuBedId: 'icub-1', doctorId: 'd1', admitReason: '호흡 불안정' });
    expect(destOf(prisma)).toMatchObject({ action: 'ICU_ADMITTED', icuAdmissionId: 'icu-a' });
  });
  it('병상 없음 409 · 간호사 단독 새 입실 403 · 사유 없음 400', async () => {
    await expect(mk().svc.discharge('r1', 'd1', 'ICU', undefined, undefined, 'DOCTOR')).rejects.toSatisfy((e) => code(e) === 'PACU_ICU_BED_REQUIRED');
    await expect(mk().svc.discharge('r1', 'n1', 'ICU', undefined, undefined, 'NURSE', { icuBedId: 'icub-1', icuAdmitReason: 'x' })).rejects.toSatisfy((e) => code(e) === 'PACU_ICU_ADMIT_ROLE');
    await expect(mk().svc.discharge('r1', 'd1', 'ICU', undefined, undefined, 'DOCTOR', { icuBedId: 'icub-1', icuAdmitReason: ' ' })).rejects.toSatisfy((e) => code(e) === 'PACU_ICU_REASON_REQUIRED');
  });
});

describe('HOME·동시성', () => {
  it('재원 중 입원 환자는 PACU 에서 귀가 처리할 수 없다(퇴원 절차) · 입원 없으면 귀가', async () => {
    await expect(mk().svc.discharge('r1', 'n1', 'HOME', undefined, undefined, 'NURSE')).rejects.toSatisfy((e) => code(e) === 'PACU_HOME_WHILE_ADMITTED');
    const { svc, prisma } = mk({ admission: null });
    await svc.discharge('r1', 'n1', 'HOME', undefined, undefined, 'NURSE');
    expect(destOf(prisma)).toEqual({ kind: 'HOME', action: 'HOME' });
  });
  it('🔴 동시에 다른 단말이 퇴실했으면 409 — 병상 이동까지 같은 트랜잭션이라 되돌려진다', async () => {
    const { svc } = mk({ doneCount: 0 });
    await expect(svc.discharge('r1', 'n1', 'WARD', undefined, undefined, 'NURSE', { targetBedId: 'bed-9' })).rejects.toSatisfy((e) => code(e) === 'PACU_ALREADY_DISCHARGED');
  });
});
