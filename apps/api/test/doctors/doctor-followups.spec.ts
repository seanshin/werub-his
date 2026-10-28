import { describe, it, expect, vi } from 'vitest';
import { DoctorsService, normalizeDueHours, MY_FOLLOWUP_LIMIT } from '../../src/modules/doctors/doctors.service';
import { ConsultationService } from '../../src/modules/consultation/consultation.service';

/**
 * 의사 할 일함 — 나 기준 후속 일(2026-10-10).
 * 🔴 미서명 기록·내가 보낸 협진의 회신은 "나 기준 EP" 가 없어 할 일함에 없었다. 처리 기한은 원내 정책 — 미설정이면 판정하지 않는다.
 */
function prisma(over: Record<string, unknown> = {}) {
  return {
    encounter: { findMany: vi.fn(async () => [{ id: 'e1' }]), count: vi.fn(async () => 3) },
    dischargeSummary: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    consultation: { findMany: vi.fn(async () => [{ id: 'c1' }]), count: vi.fn(async () => 1) },
    ...over,
  };
}

describe('getMyFollowups — 나 기준 세 목록', () => {
  it('🔴 모두 로그인한 본인으로 좁힌다 · 미서명은 DRAFT · 협진은 내가 의뢰했고 회신 온 것(REPLIED)', async () => {
    const p = prisma();
    const r = await new DoctorsService(p as never).getMyFollowups('me');
    expect(p.encounter.findMany.mock.calls[0][0].where).toEqual({ doctorId: 'me', status: 'DRAFT' });
    expect(p.dischargeSummary.findMany.mock.calls[0][0].where).toEqual({ doctorId: 'me', status: 'DRAFT' });
    expect(p.consultation.findMany.mock.calls[0][0].where).toEqual({ requestingDoctorId: 'me', status: 'REPLIED' });
    expect(p.encounter.findMany.mock.calls[0][0].take).toBe(MY_FOLLOWUP_LIMIT);
    // 자르면 잘랐다고 — 받은 1건 < 전체 3건
    expect(r.unsignedEncounters).toMatchObject({ total: 3, truncated: true });
    expect(r.repliedConsults).toMatchObject({ total: 1, truncated: false });
  });

  it('🔴 처리 기한 미설정이면 null(늦음 판정 없음) · 설정값은 그대로', async () => {
    expect((await new DoctorsService(prisma() as never).getMyFollowups('me')).policy.dueHours).toBeNull();
    const cfg = { get: vi.fn(async (k: string) => (k === 'doctor.inbox.dueHours' ? 24 : null)) };
    expect((await new DoctorsService(prisma() as never, cfg as never).getMyFollowups('me')).policy.dueHours).toBe(24);
  });

  it('기한 값 — 1~168 정수만(그 밖은 미설정)', () => {
    expect(normalizeDueHours(24)).toBe(24);
    expect(normalizeDueHours('48')).toBe(48);
    for (const bad of [null, 0, 169, 2.5, 'x', '', -1]) expect(normalizeDueHours(bad)).toBeNull();
  });
});

describe('협진 종결 권한 — 의뢰의·수신자·관리자만', () => {
  const svc = (row: Record<string, unknown>, myDept = '내과') => {
    const p = {
      consultation: {
        findUnique: vi.fn(async () => row),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      user: { findUnique: vi.fn(async () => ({ department: myDept })) },
    };
    return { s: new ConsultationService(p as never, undefined as never), p };
  };
  const ROW = { id: 'c1', status: 'REPLIED', requestingDoctorId: 'req', toDoctorId: 'to', toDepartment: '신경과' };

  it('🔴 남의 협진(의뢰의도 수신자도 아님)은 종결하지 못한다', async () => {
    const { s, p } = svc(ROW);
    await expect(s.close('c1', 'stranger', 'DOCTOR')).rejects.toThrow();
    expect(p.consultation.updateMany).not.toHaveBeenCalled();
  });
  it('의뢰의·지정 수신의·관리자는 종결한다', async () => {
    for (const [u, role] of [['req', 'DOCTOR'], ['to', 'DOCTOR'], ['x', 'ADMIN']] as const) {
      const { s, p } = svc(ROW);
      await s.close('c1', u, role);
      expect(p.consultation.updateMany).toHaveBeenCalledTimes(1);
    }
  });
  it('대조군 — 이미 종결이면 그대로(멱등)', async () => {
    const { s, p } = svc({ ...ROW, status: 'CLOSED' });
    await s.close('c1', 'stranger', 'DOCTOR');
    expect(p.consultation.updateMany).not.toHaveBeenCalled();
  });
});
