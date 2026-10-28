/**
 * 간호 스테이션 교대(상번·하번) — 2026-09-30 사람 요청 "상하번 간호사의 간호기록 등이 작성될 수 있어야"·결함 1~10.
 *
 *  · 담당 배정: 같은 간호사·같은 입원 중복 활성 금지(멱등) · 재원 중만 · 해제는 조건부 · 입원 종료·병동 이동이면 해제
 *  · 상번 인수: 다른 간호사의 활성 배정은 같은 트랜잭션에서 해제(내 것은 그대로)
 *  · 인계 작성자: 서버가 로그인 사용자로(본문 fromDoctorId 무시 — 컨트롤러 스펙에서)
 *  · 간호기록: 미래 기록 시각 400 · 늦은 기록은 막지 않고 표식(파생)
 *  · MAR: 지난 날짜 미처리분(carriedOver)은 이번 입원 안으로만
 *  · 근무조 마감: 이번 근무조 창(병원 표준시) · 기록 유무만 · 담당 0 은 "모두 완료"가 아니다
 */
import { describe, it, expect, vi } from 'vitest';
import { NurseStationService } from '../../src/modules/nurse-station/nurse-station.service';
import { NurseStationListener } from '../../src/modules/nurse-station/nurse-station.listener';
import { NursingService } from '../../src/modules/nursing/nursing.service';
import { transferBedInTx } from '../../src/modules/inpatient/bed-transfer';

const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;
const kst = (s: string) => new Date(`${s}+09:00`);

function station(o: { admStatus?: string | null; existing?: unknown } = {}) {
  const npa = {
    findFirst: vi.fn(async () => o.existing ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data })),
    // DB 처럼 — 조건(releasedAt: null)이 걸린 쓰기만 이미 해제된 행을 건너뛴다
    updateMany: vi.fn(async (a: { where: Record<string, unknown> }) => ({ count: 'releasedAt' in a.where ? 1 : 1 })),
    findUnique: vi.fn(async () => ({ id: 'a1', releasedAt: new Date() })),
  };
  const prisma: Record<string, any> = {
    admission: { findUnique: vi.fn(async () => (o.admStatus === null ? null : { status: o.admStatus ?? 'ADMITTED' })) },
    nursePatientAssignment: npa,
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ role: where.id.startsWith('doc') ? 'DOCTOR' : 'NURSE' })) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { svc: new NurseStationService(prisma as never, {} as never, {} as never, { emit: vi.fn() } as never, {} as never), prisma, npa };
}

describe('담당 배정', () => {
  it('🔴 이미 활성인 같은 배정이면 새로 만들지 않고 그것을 돌려준다', async () => {
    const { svc, npa } = station({ existing: { id: 'old' } });
    const r = await svc.assignPatient({ nurseId: 'n1', admissionId: 'a1', assignedBy: 'n1' });
    expect(r).toEqual({ id: 'old' });
    expect(npa.create).not.toHaveBeenCalled();
    expect(npa.findFirst.mock.calls[0][0].where).toMatchObject({ nurseId: 'n1', admissionId: 'a1', releasedAt: null });
  });
  it('대조군 — 없으면 만든다(보낸 근무조 그대로)', async () => {
    const { svc, npa } = station();
    await svc.assignPatient({ nurseId: 'n1', admissionId: 'a1', assignedBy: 'n1', shiftType: 'NIGHT' });
    expect(npa.create.mock.calls[0][0].data).toMatchObject({ nurseId: 'n1', admissionId: 'a1', shiftType: 'NIGHT' });
  });
  it('퇴원한 입원에는 배정하지 않는다(400)', async () => {
    const { svc } = station({ admStatus: 'DISCHARGED' });
    await expect(svc.assignPatient({ nurseId: 'n1', admissionId: 'a1', assignedBy: 'n1' })).rejects.toSatisfy((e) => code(e) === 'ADMISSION_NOT_ACTIVE');
  });
  it('해제는 조건부(이미 해제된 시각을 덮지 않는다)', async () => {
    const { svc, npa } = station();
    await svc.releaseAssignment('a1');
    expect(npa.updateMany.mock.calls[0][0].where).toEqual({ id: 'a1', releasedAt: null });
  });
});

describe('상번 인수', () => {
  it('🔴 다른 간호사의 활성 배정만 해제하고 내 배정을 만든다(같은 트랜잭션)', async () => {
    const { svc, prisma, npa } = station();
    const r = await svc.takeOverAssignment('n2', 'a1', 'EVENING');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(npa.updateMany.mock.calls[0][0].where).toEqual({ admissionId: 'a1', releasedAt: null, nurseId: { not: 'n2' } });
    expect(npa.create.mock.calls[0][0].data).toMatchObject({ nurseId: 'n2', admissionId: 'a1', shiftType: 'EVENING', assignedBy: 'n2' });
    expect(r.alreadyMine).toBe(false);
  });
  it('이미 내 배정이면 새로 만들지 않는다', async () => {
    const { svc, npa } = station({ existing: { id: 'mine' } });
    const r = await svc.takeOverAssignment('n2', 'a1', 'DAY');
    expect(npa.create).not.toHaveBeenCalled();
    expect(r).toMatchObject({ alreadyMine: true, assignment: { id: 'mine' } });
  });
  it('퇴원한 입원은 인수하지 않는다', async () => {
    const { svc } = station({ admStatus: 'DISCHARGED' });
    await expect(svc.takeOverAssignment('n2', 'a1', 'DAY')).rejects.toSatisfy((e) => code(e) === 'ADMISSION_NOT_ACTIVE');
  });
});

describe('입원 종료 → 배정 해제', () => {
  it('🔴 admission.closed 를 받으면 그 입원의 활성 배정을 해제한다', async () => {
    const { svc, npa } = station();
    const l = new NurseStationListener({} as never, svc);
    await l.handleAdmissionClosed({ admissionId: 'a9' });
    expect(npa.updateMany.mock.calls[0][0].where).toEqual({ admissionId: 'a9', releasedAt: null });
  });
  it('해제가 실패해도 던지지 않는다(퇴원은 유지)', async () => {
    const { svc, npa } = station();
    npa.updateMany.mockRejectedValueOnce(new Error('db'));
    const l = new NurseStationListener({} as never, svc);
    await expect(l.handleAdmissionClosed({ admissionId: 'a9' })).resolves.toBeUndefined();
  });
});

describe('병상 이동 — 병동이 바뀌면 담당 배정 해제', () => {
  const tx = (fromWard: string, toWard: string) => ({
    bed: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [{ id: 'b1', wardId: fromWard }, { id: 'b2', wardId: toWard }]),
    },
    bedAssignment: { updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(async () => ({})) },
    nursePatientAssignment: { updateMany: vi.fn(async () => ({ count: 1 })) },
    admission: { update: vi.fn(async () => ({})) },
  });
  it('🔴 다른 병동으로 가면 해제', async () => {
    const t = tx('w1', 'w2');
    await transferBedInTx(t as never, { id: 'a1', bedId: 'b1' }, 'b2', null);
    expect(t.nursePatientAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { admissionId: 'a1', releasedAt: null } }));
  });
  it('대조군 — 같은 병동 전실이면 그대로', async () => {
    const t = tx('w1', 'w1');
    await transferBedInTx(t as never, { id: 'a1', bedId: 'b1' }, 'b2', null);
    expect(t.nursePatientAssignment.updateMany).not.toHaveBeenCalled();
  });
});

function nursing(p: Record<string, any>, boundaries?: unknown) {
  const config = { get: vi.fn(async () => boundaries ?? null) };
  return new NursingService(p as never, undefined, config as never);
}

describe('간호기록 — 기록 시각', () => {
  it('🔴 미래 기록 시각은 400', async () => {
    const svc = nursing({ admission: { findUnique: vi.fn(async () => ({ id: 'a1' })) }, nursingNote: { create: vi.fn() } });
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    await expect(svc.createNote('a1', { noteType: 'NARRATIVE', content: 'x', shiftType: 'DAY', recordedAt: future } as never, 'n1'))
      .rejects.toSatisfy((e) => code(e) === 'NOTE_RECORDED_AT_FUTURE');
  });
  it('목록은 늦은 기록을 표식한다(근무조가 끝난 뒤 작성) · 저장하지 않고 파생', async () => {
    const rows = [
      { id: 'on', recordedAt: kst('2026-09-30T10:00:00'), createdAt: kst('2026-09-30T10:05:00') },
      { id: 'late', recordedAt: kst('2026-09-30T10:00:00'), createdAt: kst('2026-09-30T16:00:00') },
    ];
    const svc = nursing({ nursingNote: { findMany: vi.fn(async () => rows) } });
    const r = (await svc.getNotes('a1', {})) as Array<{ id: string; lateEntry: boolean }>;
    expect(r.map((n) => [n.id, n.lateEntry])).toEqual([['on', false], ['late', true]]);
  });
});

describe('MAR — 지난 날짜 미처리분', () => {
  it('🔴 includeOverdue 면 이전 SCHEDULED 를 carriedOver 로 앞에 싣는다 · 입원일 이전은 제외', async () => {
    const findMany = vi.fn(async (a: { where: { status?: string } }) => (a.where.status === 'SCHEDULED' ? [{ id: 'old' }] : [{ id: 'today' }]));
    const admitDate = kst('2026-09-29T14:00:00');
    const svc = nursing({ admission: { findUnique: vi.fn(async () => ({ patientId: 'p1', admitDate })) }, medicationAdministration: { findMany } });
    const r = await svc.getMedicationSchedule('a1', '2026-09-30', true);
    expect(r.map((m) => [m.id, m.carriedOver])).toEqual([['old', true], ['today', false]]);
    const carriedWhere = findMany.mock.calls.find((c) => c[0].where.status === 'SCHEDULED')![0].where as { scheduledAt: { gte: Date } };
    expect(carriedWhere.scheduledAt.gte).toEqual(admitDate);
  });
  it('대조군 — includeOverdue 가 아니면 그날만', async () => {
    const findMany = vi.fn(async () => [{ id: 'today' }]);
    const svc = nursing({ admission: { findUnique: vi.fn(async () => ({ patientId: 'p1', admitDate: new Date(0) })) }, medicationAdministration: { findMany } });
    const r = await svc.getMedicationSchedule('a1', '2026-09-30');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(r).toEqual([{ id: 'today', carriedOver: false }]);
  });
});

describe('근무조 마감(하번)', () => {
  const assign = (id: string, admissionId: string, patientId: string) => ({
    id, admissionId, shiftType: 'DAY', assignedAt: new Date(),
    admission: { patientId, admitDate: new Date('2026-09-01T00:00:00Z'), dischargeDate: null, patient: { id: patientId, familyName: '김', givenName: id, mrn: id }, bed: null },
  });
  const mk = (assigns: unknown[]) => {
    const p = {
      nursePatientAssignment: { findMany: vi.fn(async () => assigns) },
      nursingNote: { findMany: vi.fn(async () => [{ admissionId: 'a1', nurseId: 'n1', status: 'SIGNED' }, { admissionId: 'a2', nurseId: 'other', status: 'SIGNED' }]) },
      flowSheetEntry: { findMany: vi.fn(async () => [{ id: 'fs1', admissionId: 'a1', nurseId: 'n1', recordedAt: new Date() }]) },
      preVisitVitals: { findMany: vi.fn(async () => []) },
      intakeOutput: { findMany: vi.fn(async () => []) },
      medicationAdministration: { findMany: vi.fn(async () => [{ patientId: 'p2', status: 'SCHEDULED' }, { patientId: 'p2', status: 'ADMINISTERED' }]) },
      clinicalHandoff: { findMany: vi.fn(async () => [{ admissionId: 'a1', createdAt: new Date(), acknowledgedAt: null, toDoctor: { id: 'n2', familyName: '이', givenName: '상번' } }]) },
    };
    return { svc: nursing(p), p };
  };
  it('🔴 내 기록만 "내 기록"으로 센다 · 남의 기록은 total 에만 · 인계·미처리 투약 요약', async () => {
    const { svc, p } = mk([assign('s1', 'a1', 'p1'), assign('s2', 'a2', 'p2')]);
    const r = await svc.getShiftCloseout('n1', kst('2026-09-30T14:00:00'));
    expect(r.shift).toBe('DAY');
    expect(r.start).toEqual(kst('2026-09-30T07:00:00'));
    const [i1, i2] = r.items;
    expect(i1).toMatchObject({ notes: { mine: 1, total: 1 }, vitals: 1, handoff: { to: { id: 'n2' } } });
    expect(i2).toMatchObject({ notes: { mine: 0, total: 1 }, vitals: 0, meds: { dueSoFar: 2, pending: 1 }, handoff: null });
    expect(r.summary).toEqual({ withoutMyNote: 1, withoutVitals: 1, pendingMeds: 1, withoutHandoff: 1 });
    // 투약은 근무조 시작 ~ 지금(아직 오지 않은 예정은 미처리가 아니다)
    const medWhere = p.medicationAdministration.findMany.mock.calls[0][0].where.scheduledAt;
    expect(medWhere).toEqual({ gte: kst('2026-09-30T07:00:00'), lt: kst('2026-09-30T14:00:00') });
    // 인계는 내가 쓴 것만
    expect(p.clinicalHandoff.findMany.mock.calls[0][0].where.fromDoctorId).toBe('n1');
  });
  it('담당 배정 0 이면 빈 목록 + assignments 0(모두 완료로 그리지 않게)', async () => {
    const { svc, p } = mk([]);
    const r = await svc.getShiftCloseout('n1', kst('2026-09-30T14:00:00'));
    expect(r).toMatchObject({ assignments: 0, items: [] });
    expect(p.nursingNote.findMany).not.toHaveBeenCalled();
  });
});
