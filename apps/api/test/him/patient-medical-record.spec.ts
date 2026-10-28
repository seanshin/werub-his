/**
 * 환자 차트 '의무기록' 탭 서버(2026-10-02).
 * 🔴 미비 기록·발급 문서·발급 요청이 서버에는 있었는데 환자 차트에서 볼 자리가 없었다.
 *  · 미비는 병원 목록과 같은 정본(HimService)에 환자 조건만 더한다 — 네 갈래 모두에
 *  · 발급·요청은 상한 50 + 전체 수(자르면 잘랐다고 말할 수 있게) · 발급자 이름을 모르면 null(지어내지 않는다)
 * 재주입: 한 갈래라도 환자 조건을 빼면 · 전체 수를 목록 길이로 세면 · 이름을 지어내면 실패한다.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { HimService } from '../../src/modules/him/him.service';
import { PatientMedicalRecordService, PATIENT_RECORD_LIST_LIMIT } from '../../src/modules/him/patient-medical-record.service';
import { PatientMedicalRecordController } from '../../src/modules/him/patient-medical-record.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

function prismaMock() {
  return {
    admission: { findMany: vi.fn(async () => []) },
    encounter: { findMany: vi.fn(async () => []) },
    nursingNote: { findMany: vi.fn(async () => []) },
    issuedDocument: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    documentRequest: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    user: { findMany: vi.fn(async () => []) },
    // 정정 이력 원장(2026-10-03)
    signedRecordVersion: { findMany: vi.fn(async () => []) },
    dischargeSummary: { findMany: vi.fn(async () => []) },
    labResultAmendment: { findMany: vi.fn(async () => []) },
  };
}
const config = { get: vi.fn(async () => undefined) };

describe('미비 기록 — 환자 지정', () => {
  it('🔴 네 갈래(퇴원요약·미서명 진료·미서명 간호·상병 미입력) 모두에 환자 조건이 붙는다', async () => {
    const p = prismaMock();
    const him = new HimService(p as never, config as never, undefined as never);
    await him.getDeficiencies(false, 'pat-1');
    expect((p.admission.findMany.mock.calls[0] as any)[0].where.patientId).toBe('pat-1');
    const encWheres = p.encounter.findMany.mock.calls.map((c: any) => c[0].where);
    expect(encWheres).toHaveLength(2);
    for (const w of encWheres) expect(w.patientId).toBe('pat-1');
    expect((p.nursingNote.findMany.mock.calls[0] as any)[0].where.admission).toEqual({ patientId: 'pat-1' });
  });

  it('대조군: 환자를 지정하지 않으면 병원 전체(종전과 같다)', async () => {
    const p = prismaMock();
    await new HimService(p as never, config as never, undefined as never).getDeficiencies(false);
    expect((p.admission.findMany.mock.calls[0] as any)[0].where).not.toHaveProperty('patientId');
    expect((p.nursingNote.findMany.mock.calls[0] as any)[0].where).not.toHaveProperty('admission');
  });
});

describe('환자 의무기록 묶음', () => {
  it('🔴 발급 문서·요청은 상한 50 + 전체 수 · 발급자 이름을 모르면 null · 환자 이름은 다시 싣지 않는다', async () => {
    const p = prismaMock();
    p.encounter.findMany = vi.fn(async (a: any) => (a.where.status === 'DRAFT'
      ? [{ id: 'e1', createdAt: new Date('2026-09-30'), doctorId: 'd1', patient: { mrn: 'M', familyName: '김', givenName: '영수' }, doctor: { familyName: '김', givenName: '내과' } }]
      : [])) as never;
    p.issuedDocument.findMany = vi.fn(async () => [
      { issueNo: 'WRB-DX-1', documentType: 'DIAGNOSIS', status: 'ORIGINAL', reissueOf: null, issuedAt: new Date(), issuedBy: 'u1' },
      { issueNo: 'WRB-DX-2', documentType: 'DIAGNOSIS', status: 'REISSUE', reissueOf: 'WRB-DX-1', issuedAt: new Date(), issuedBy: 'ghost' },
      { issueNo: 'WRB-CP-1', documentType: 'COPY', status: 'COPY', reissueOf: null, issuedAt: new Date(), issuedBy: null },
    ]) as never;
    p.issuedDocument.count = vi.fn(async () => 73) as never;
    p.documentRequest.findMany = vi.fn(async () => [{ id: 'r1', type: 'RECORD_COPY', status: 'READY', copies: 1, purpose: null, deliveryMethod: 'VISIT', createdAt: new Date(), completedAt: null, slaDueAt: null, issuedDocumentId: 'WRB-CP-1' }]) as never;
    p.documentRequest.count = vi.fn(async () => 1) as never;
    p.user.findMany = vi.fn(async () => [{ id: 'u1', familyName: '이', givenName: '의무' }]) as never;
    const svc = new PatientMedicalRecordService(p as never, new HimService(p as never, config as never, undefined as never));
    const r = await svc.forPatient('pat-1');

    expect((p.issuedDocument.findMany.mock.calls[0] as any)[0]).toMatchObject({ where: { patientId: 'pat-1' }, take: PATIENT_RECORD_LIST_LIMIT });
    expect(r.issuedDocuments.total).toBe(73);
    expect(r.issuedDocuments.items.map((d) => d.issuedBy)).toEqual([{ id: 'u1', name: '이의무' }, { id: 'ghost', name: null }, null]);
    expect(r.documentRequests.items[0]).toMatchObject({ issueNo: 'WRB-CP-1' });
    expect(r.deficiencies.items).toHaveLength(1);
    expect(r.deficiencies.items[0]).not.toHaveProperty('patient');
    expect(r.deficiencies.items[0]).toMatchObject({ type: 'UNSIGNED_ENCOUNTER', refId: 'e1' });
  });

  it('의무기록사도 연다(쓰기 없음) — 임상 직군과 함께', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PatientMedicalRecordController.prototype.get);
    expect([...roles].sort()).toEqual([UserRole.ADMIN, UserRole.DOCTOR, UserRole.MEDICAL_RECORDS, UserRole.NURSE].sort());
  });
});
