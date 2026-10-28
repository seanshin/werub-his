/**
 * 이번 방문 ↔ 직전 방문 대비(patient-chart-refinement C7).
 * 지키는 것:
 *  ① 직전(서명) 방문이 없으면 previous=null · reason NO_PREVIOUS_VISIT — 지어낸 비교 없음
 *  ② 다른 환자의 방문 id 로는 비교하지 않는다(환자 조건을 같이 걸어 404)
 *  ③ 한쪽에서 재지 않은 활력은 null(0 아님) · 한쪽에만 있는 진단·약·검사는 반대쪽 null
 *  ④ 직전 방문 조회는 같은 환자·이번보다 먼저·서명(SIGNED/AMENDED)만
 *  ⑤ 판정 문구·델타를 만들지 않는다(응답에 그런 필드가 없다)
 *  ⑥ 처방·검사가 상한을 넘으면 truncated
 * 목은 Prisma 실제 반환 모양(select 결과)을 따른다.
 */
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CHART_ACCESS_ROLES } from '@hospital-run/shared';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { MedicalRecordSearchController } from '../../src/modules/medical-record-search/medical-record-search.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VisitComparisonService } from '../../src/modules/patient/visit-comparison.service';
import { VisitComparisonController } from '../../src/modules/patient/visit-comparison.controller';

const PID = '11111111-2222-4333-8444-555555555555';
const CUR = { id: 'enc-cur', createdAt: new Date('2026-09-10T01:00:00Z'), status: 'DRAFT', visitType: 'OUTPATIENT', doctor: { familyName: '이', givenName: '의사' } };
const PREV = { id: 'enc-prev', createdAt: new Date('2026-08-10T01:00:00Z'), status: 'SIGNED', visitType: 'OUTPATIENT', doctor: { familyName: '박', givenName: '의사' } };

function makePrisma() {
  return {
    patient: { findUnique: vi.fn().mockResolvedValue({ id: PID }) },
    encounter: { findFirst: vi.fn() },
    preVisitVitals: { findFirst: vi.fn().mockResolvedValue(null) },
    encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([]) },
    prescription: { findMany: vi.fn().mockResolvedValue([]) },
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe('방문 대비', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: VisitComparisonService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new VisitComparisonService(prisma as any);
  });

  it('① 직전 서명 방문이 없으면 previous=null · NO_PREVIOUS_VISIT', async () => {
    prisma.encounter.findFirst.mockResolvedValueOnce(CUR).mockResolvedValueOnce(null);
    const r = await service.compare(PID);
    expect(r.reason).toBe('NO_PREVIOUS_VISIT');
    expect(r.current?.id).toBe('enc-cur');
    expect(r.previous).toBeNull();
    expect(r.vitals.previous).toBeNull();
  });

  it('① 방문이 하나도 없으면 NO_ENCOUNTER', async () => {
    prisma.encounter.findFirst.mockResolvedValueOnce(null);
    const r = await service.compare(PID);
    expect(r.reason).toBe('NO_ENCOUNTER');
    expect(r.current).toBeNull();
  });

  it('② 다른 환자의 방문 id 는 404 이고, 조회에 환자 조건이 걸린다', async () => {
    prisma.encounter.findFirst.mockResolvedValueOnce(null);
    await expect(service.compare(PID, 'enc-of-other-patient')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.encounter.findFirst.mock.calls[0][0].where).toEqual({ id: 'enc-of-other-patient', patientId: PID });
  });

  it('② 없는 환자는 404', async () => {
    prisma.patient.findUnique.mockResolvedValueOnce(null);
    await expect(service.compare(PID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('③④⑤ 값만 나란히 — 미측정 null · 한쪽에만 있는 항목은 반대쪽 null · 직전 조회 조건', async () => {
    prisma.encounter.findFirst.mockResolvedValueOnce(CUR).mockResolvedValueOnce(PREV);
    prisma.preVisitVitals.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.encounterId === 'enc-cur'
        ? { measuredAt: new Date('2026-09-10T00:50:00Z'), systolicBp: 150, diastolicBp: 95, heartRate: null, temperature: '36.8', spo2: null, respiratoryRate: null, painScore: null, weight: null, bmi: null }
        : null),
    );
    prisma.encounterDiagnosis.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where.encounterId === 'enc-cur'
        ? [{ type: 'PRIMARY', certainty: 'CONFIRMED', diagnosisCode: { code: 'I10', nameKo: '본태성 고혈압', nameEn: 'Essential hypertension' } }]
        : [{ type: 'PRIMARY', certainty: 'CONFIRMED', diagnosisCode: { code: 'E11', nameKo: '2형 당뇨병', nameEn: null } }]),
    );
    prisma.prescription.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where.encounterId === 'enc-cur'
        ? [{ medicationCodeId: 'm1', dosage: '100mg', frequency: 'QD', duration: 30, route: 'PO', medicationCode: { code: 'A1', nameKo: '아스피린', nameEn: 'Aspirin', ingredient: 'aspirin' } }]
        : [{ medicationCodeId: 'm1', dosage: '50mg', frequency: 'QD', duration: 30, route: 'PO', medicationCode: { code: 'A1', nameKo: '아스피린', nameEn: 'Aspirin', ingredient: 'aspirin' } }]),
    );
    prisma.labResult.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where.order.prescription.encounterId === 'enc-prev'
        ? [{ status: 'VERIFIED', verifiedAt: new Date('2026-08-10T03:00:00Z'), completedAt: null, createdAt: new Date('2026-08-10T02:00:00Z'), items: [{ testName: 'HbA1c', testCode: 'HBA1C', loincCode: null, value: '7.2', unit: '%', flag: 'H' }] }]
        : []),
    );

    const r = await service.compare(PID);

    // ④ 직전 방문 조회 조건
    const prevWhere = prisma.encounter.findFirst.mock.calls[1][0].where;
    expect(prevWhere).toEqual({ patientId: PID, id: { not: 'enc-cur' }, createdAt: { lt: CUR.createdAt }, status: { in: ['SIGNED', 'AMENDED'] } });

    expect(r.reason).toBeNull();
    // ③ 활력: 이번엔 잰 것만 값, 안 잰 것 null · 직전 방문엔 측정 자체가 없어 null
    expect(r.vitals.current?.systolicBp).toBe(150);
    expect(r.vitals.current?.heartRate).toBeNull();
    expect(r.vitals.current?.temperature).toBe(36.8);
    expect(r.vitals.previous).toBeNull();
    // ③ 진단: 한쪽에만
    const i10 = r.diagnoses.find((d) => d.code === 'I10')!;
    const e11 = r.diagnoses.find((d) => d.code === 'E11')!;
    expect(i10.previous).toBeNull();
    expect(e11.current).toBeNull();
    // 같은 약 두 방문 — 값만 나란히(용량 변경을 '증량'이라 부르지 않는다)
    expect(r.medications).toHaveLength(1);
    expect(r.medications[0].current?.dosage).toBe('100mg');
    expect(r.medications[0].previous?.dosage).toBe('50mg');
    // 검사: 직전에만 · flag 는 기록된 값 그대로 · 보고값 문자열 그대로
    expect(r.labs[0]).toMatchObject({ testName: 'HbA1c', current: null, previous: { value: '7.2', flag: 'H', status: 'VERIFIED' } });
    // ⑤ 판정·델타 필드 없음
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/"(delta|trend|change|worse|better|improved|worsened)"/i);
    expect(r.truncated).toBe(false);
  });

  it('⑥ 처방이 상한(200)을 넘으면 truncated', async () => {
    prisma.encounter.findFirst.mockResolvedValueOnce(CUR).mockResolvedValueOnce(null);
    prisma.prescription.findMany.mockResolvedValue(
      Array.from({ length: 201 }, (_, i) => ({ medicationCodeId: `m${i}`, dosage: null, frequency: null, duration: null, route: null, medicationCode: null })),
    );
    const r = await service.compare(PID);
    expect(r.truncated).toBe(true);
    expect(r.medications).toHaveLength(200);
  });

  it('권한 — 두 EP 모두 차트 화면 역할(CHART_ACCESS_ROLES)만 · 그 밖 역할은 RolesGuard 가 403', () => {
    const reflector = new Reflector();
    const cmp = [...(reflector.get<string[]>(ROLES_KEY, VisitComparisonController.prototype.compare) ?? [])].sort();
    const search = [...(reflector.get<string[]>(ROLES_KEY, MedicalRecordSearchController.prototype.search) ?? [])].sort();
    const chart = [...CHART_ACCESS_ROLES].sort();
    expect(cmp).toEqual(chart);
    expect(search).toEqual(chart);
    for (const outsider of ['RECEPTIONIST', 'CRM_MANAGER', 'READ', 'PHARMACIST']) {
      expect(cmp).not.toContain(outsider);
      expect(search).not.toContain(outsider);
    }
  });

  it('컨트롤러 — encounterId 형식이 틀리면 400(서비스 호출 없음)', async () => {
    const svc = { compare: vi.fn() };
    const ctrl = new VisitComparisonController(svc as any);
    await expect(ctrl.compare(PID, 'x')).rejects.toThrow();
    expect(svc.compare).not.toHaveBeenCalled();
  });
});
