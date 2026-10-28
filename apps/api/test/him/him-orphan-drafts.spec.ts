import { describe, it, expect, vi } from 'vitest';
import { HimService } from '../../src/modules/him/him.service';

/**
 * 작성자가 의사가 아닌 미서명 진료(2026-10-10).
 * 🔴 관리자 계정이 만든 미서명 진료(운영 168건)의 HIM 독촉도 그 관리자 한 명에게 갔다(회수 알림과 같은 결함).
 *  · 작성자가 활성 의사가 아니면 책임자를 비운다 · 처방을 단 의사를 이름과 함께 · 빈 초안 표식
 */
const old = new Date(Date.now() - 10 * 86400_000);
function build(drafts: any[]) {
  const prisma: any = {
    admission: { findMany: vi.fn(async () => []) },
    encounter: { findMany: vi.fn().mockResolvedValueOnce(drafts).mockResolvedValueOnce([]) },
    nursingNote: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => [{ id: 'dr-9', familyName: '오', givenName: '처방' }]) },
  };
  const noti = { create: vi.fn(async () => ({})), pushNotification: vi.fn(async () => ({})) };
  return { svc: new HimService(prisma, { get: vi.fn(async () => null) } as never, noti as never), prisma, noti };
}
const base = { createdAt: old, patient: { mrn: 'P1', familyName: '김', givenName: '환자' }, subjective: null, objective: null, assessment: null, plan: null, chiefComplaint: null, _count: { diagnoses: 0 } };

describe('HIM — 작성자 의사 아님', () => {
  it('🔴 관리자 작성 → 책임자 없음 · 처방의 이름 · 빈 초안 여부', async () => {
    const { svc } = build([
      { ...base, id: 'e1', doctorId: 'adm', doctor: { familyName: '관', givenName: '리', role: 'ADMIN', isActive: true }, prescriptions: [{ prescriberId: null, createdBy: 'dr-9' }] },
      { ...base, id: 'e2', doctorId: 'adm', doctor: { familyName: '관', givenName: '리', role: 'ADMIN', isActive: true }, prescriptions: [] },
    ]);
    const r = await svc.getDeficiencies();
    const e1 = r.items.find((i) => i.refId === 'e1')!;
    const e2 = r.items.find((i) => i.refId === 'e2')!;
    expect(e1).toMatchObject({ responsibleId: null, authorIsDoctor: false, prescribers: [{ id: 'dr-9', name: '오처방' }], empty: false });
    expect(e2).toMatchObject({ responsibleId: null, authorIsDoctor: false, prescribers: [], empty: true });
  });

  it('비활성 의사 작성도 책임자 없음 · 대조군 — 활성 의사는 그대로 책임자', async () => {
    const { svc } = build([
      { ...base, id: 'e3', doctorId: 'dr-x', doctor: { familyName: '퇴', givenName: '직', role: 'DOCTOR', isActive: false }, prescriptions: [] },
      { ...base, id: 'e4', doctorId: 'dr-1', doctor: { familyName: '이', givenName: '의사', role: 'DOCTOR', isActive: true }, prescriptions: [], subjective: '두통' },
    ]);
    const r = await svc.getDeficiencies();
    expect(r.items.find((i) => i.refId === 'e3')).toMatchObject({ responsibleId: null, authorIsDoctor: false });
    expect(r.items.find((i) => i.refId === 'e4')).toMatchObject({ responsibleId: 'dr-1', authorIsDoctor: true, empty: false });
  });

  it('🔴 독촉이 관리자에게 가지 않는다', async () => {
    const { svc, noti } = build([
      { ...base, id: 'e1', doctorId: 'adm', doctor: { familyName: '관', givenName: '리', role: 'ADMIN', isActive: true }, prescriptions: [] },
    ]);
    await svc.remind();
    expect(noti.create).not.toHaveBeenCalled();
  });
});
