import { describe, it, expect, vi } from 'vitest';
import { DoctorsService } from '../../src/modules/doctors/doctors.service';
import { ConsultationService } from '../../src/modules/consultation/consultation.service';

/**
 * 의사 할 일함 '처리한 것' · 차트 협진 전체(2026-10-10).
 * 🔴 처리자·시각이 원장에 남는 일만 센다(지어내지 않는다) · 협진 종결은 종결자 칸이 없어 세지 않고 밝힌다.
 * 🔴 차트 의뢰/회신 탭이 가장 최근 진료의 협진만 읽던 것 → 환자 전체.
 */
function prisma(n = 0) {
  const fm = () => vi.fn(async () => []);
  const cnt = () => vi.fn(async () => n);
  return {
    order: { findMany: fm(), count: cnt() },
    prescription: { findMany: fm(), count: cnt() },
    preOrder: { findMany: fm(), count: cnt() },
    pharmacistIntervention: { findMany: fm(), count: cnt() },
    consultation: { findMany: fm(), count: cnt() },
    encounter: { findMany: fm(), count: cnt() },
    dischargeSummary: { findMany: fm(), count: cnt() },
  };
}

describe('getMyHandled — 처리한 것', () => {
  it('🔴 모든 종류를 로그인한 본인·그 하루(KST)로 좁힌다', async () => {
    const p = prisma();
    const r = await new DoctorsService(p as never).getMyHandled('me', '2026-10-09');
    const w = (m: { findMany: ReturnType<typeof vi.fn> }, i = 0) => m.findMany.mock.calls[i][0].where;
    expect(w(p.order)).toMatchObject({ acknowledgedBy: 'me' });
    expect(w(p.prescription, 0)).toMatchObject({ prescriberCosignedBy: 'me' });
    expect(w(p.prescription, 1)).toMatchObject({ createdBy: 'me', renewedFromId: { not: null } });
    expect(w(p.preOrder)).toMatchObject({ approvedBy: 'me' });
    expect(w(p.pharmacistIntervention)).toMatchObject({ respondedBy: 'me' });
    expect(w(p.consultation)).toMatchObject({ replyDoctorId: 'me' });
    expect(w(p.encounter)).toMatchObject({ signedBy: 'me' });
    expect(w(p.dischargeSummary)).toMatchObject({ signedBy: 'me' });
    const day = w(p.order).acknowledgedAt;
    expect(day.lt.getTime() - day.gte.getTime()).toBe(86_400_000);
    expect(r.date).toBe('2026-10-09');
    expect(r.notCounted).toEqual(['CONSULT_CLOSE']);
  });
  it('수는 전체 수 · 목록이 상한보다 적으면 잘림', async () => {
    const r = await new DoctorsService(prisma(3) as never).getMyHandled('me');
    expect(r.total).toBe(24);
    expect(r.truncated).toBe(true); // 목록 0건 < 전체 3건
  });
  it('대조군 — 아무것도 처리하지 않았으면 0 · 잘림 아님', async () => {
    const r = await new DoctorsService(prisma(0) as never).getMyHandled('me');
    expect(r).toMatchObject({ total: 0, truncated: false });
  });
  it('날짜 형식이 틀리면 400(전건 조회로 새지 않는다)', async () => {
    await expect(new DoctorsService(prisma() as never).getMyHandled('me', '2026-13-99')).rejects.toThrow();
  });
});

describe('환자의 협진 전부 — 차트 의뢰/회신 탭', () => {
  it('🔴 진료 한 건이 아니라 환자 기준 · 전체 수·잘림', async () => {
    const p = { consultation: { findMany: vi.fn(async () => [{ id: 'c1' }]), count: vi.fn(async () => 120) } };
    const r = await new ConsultationService(p as never, {} as never).findByPatient('p1');
    expect(p.consultation.findMany.mock.calls[0][0].where).toEqual({ encounter: { patientId: 'p1' } });
    expect(r).toMatchObject({ total: 120, truncated: true });
  });
});
