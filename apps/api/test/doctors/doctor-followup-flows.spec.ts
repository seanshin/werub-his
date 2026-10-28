import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { ConsultationController } from '../../src/modules/consultation/consultation.controller';
import { ConsultationService } from '../../src/modules/consultation/consultation.service';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';

/**
 * 의사 후속 업무 흐름 추적(2026-10-10) — 할 일함에 모이는 일의 끝까지.
 *  · 🔴 '보낸 협진'이 병원 전체 최근 50건에서 내 것만 골라 오래된 내 의뢰가 사라졌다 → 서버가 의뢰의=나로 좁힌다(requestedBy=me)
 *  · 🔴 대체조제 승인 대기에 환자 id 가 없어 의사 화면이 차트로 갈 수 없었다 → id 를 싣는다
 */
describe('보낸 협진 — 서버가 의뢰의=나로', () => {
  const mk = () => {
    const p: any = { consultation: { findMany: vi.fn(async () => []) } };
    const svc = new ConsultationService(p, { create: vi.fn(), pushNotification: vi.fn() } as never);
    return { ctrl: new ConsultationController(svc), p };
  };
  it('requestedBy=me 면 로그인한 본인 id 로 좁힌다', async () => {
    const { ctrl, p } = mk();
    await ctrl.findAll('50', undefined, undefined, undefined, 'me', { user: { id: 'doc-1' } });
    expect(p.consultation.findMany.mock.calls[0][0].where).toEqual({ requestingDoctorId: 'doc-1' });
  });
  it('🔴 다른 값은 받지 않는다 — 남의 보낸 목록을 파라미터로 열지 않는다 · 대조군(파라미터 없음)', async () => {
    const { ctrl, p } = mk();
    await ctrl.findAll('50', undefined, undefined, undefined, 'other-doctor-id', { user: { id: 'doc-1' } });
    expect(p.consultation.findMany.mock.calls[0][0].where).toEqual({});
    await ctrl.findAll('50');
    expect(p.consultation.findMany.mock.calls[1][0].where).toEqual({});
  });
});

describe('대체조제 승인 대기 — 환자 id', () => {
  it('🔴 응답의 환자에 id 를 싣는다(차트 링크·환자별 묶기)', async () => {
    const findMany = vi.fn(async () => []);
    const svc = Object.create(PharmacyService.prototype) as PharmacyService;
    (svc as any).prisma = { genericSubstitution: { findMany } };
    await svc.getMyPendingSubstitutions('doc-1');
    const sel = (findMany.mock.calls[0] as any)[0].include.originalPrescription.include.encounter.select.patient.select;
    expect(sel).toMatchObject({ id: true, familyName: true, givenName: true, mrn: true });
  });
});
