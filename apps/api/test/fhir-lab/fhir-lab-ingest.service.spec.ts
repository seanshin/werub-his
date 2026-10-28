import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { FhirLabIngestService } from '../../src/modules/fhir-lab/fhir-lab-ingest.service';

describe('FhirLabIngestService', () => {
  let service: FhirLabIngestService;
  let mockPrisma: any;

  const diagnosticReport = (overrides: any = {}) => ({
    resourceType: 'DiagnosticReport',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '11502-2', display: '검사패널' }] },
    subject: { reference: 'Patient/11111111-1111-1111-1111-111111111111' },
    basedOn: [{ reference: 'ServiceRequest/00000000-0000-0000-0000-000000000abc' }],
    identifier: [{ value: 'MRN001-A' }],
    contained: [
      {
        resourceType: 'Observation', status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '2823-3', display: '칼륨' }] },
        valueQuantity: { value: 6.8, unit: 'mmol/L' },
        referenceRange: [{ low: { value: 3.5 }, high: { value: 5.1 } }],
        interpretation: [{ coding: [{ code: 'HH' }] }],
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    mockPrisma = {
      labInstrument: {
        upsert: vi.fn().mockResolvedValue({ id: 'instr-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      order: { findFirst: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000abc' }) },
      labInterfaceResult: {
        create: vi.fn().mockResolvedValue({ id: 'lir-1' }),
        update: vi.fn().mockResolvedValue({ id: 'lir-1' }),
        findFirst: vi.fn().mockResolvedValue(null), // 멱등 중복행 없음(기본)
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'sys-user-1', isActive: true }) }, // 자동반영 시스템계정
      labResult: { findUnique: vi.fn().mockResolvedValue(null) }, // 기존 결과 없음(VERIFIED revert 방지 검사용)
      // 환자 해소 정본(patient-ref.util) — UUID 는 존재, MRN 은 기본 미등록
      patient: {
        findUnique: vi.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: where.id })),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    service = new FhirLabIngestService(mockPrisma);
  });

  describe('중복 결과 가드 (LIS 스모크 관찰)', () => {
    it('이미 COMPLETED된 오더에 정정 아닌 재수신 → DUPLICATE 표시·자동반영 스킵', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({ status: 'COMPLETED' });
      await service.ingestDiagnosticReport(diagnosticReport({ status: 'final' }), 'lis-client');
      const arg = mockPrisma.labInterfaceResult.create.mock.calls[0][0];
      expect(arg.data.status).toBe('DUPLICATE');
      expect(arg.data.errorMessage).toContain('중복 결과');
    });

    it('정정 의도(status=amended)면 DUPLICATE 아님(직원 amend 경로 허용)', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({ status: 'COMPLETED' });
      await service.ingestDiagnosticReport(diagnosticReport({ status: 'amended' }), 'lis-client');
      const arg = mockPrisma.labInterfaceResult.create.mock.calls[0][0];
      expect(arg.data.status).not.toBe('DUPLICATE');
    });

    it('기존 결과 없으면(최초) 정상 MATCHED', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue(null);
      await service.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      const arg = mockPrisma.labInterfaceResult.create.mock.calls[0][0];
      expect(arg.data.status).not.toBe('DUPLICATE');
    });

    it('결과가 아직 미확정(RECEIVED 등)이면 재수신 허용', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({ status: 'RECEIVED' });
      await service.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      const arg = mockPrisma.labInterfaceResult.create.mock.calls[0][0];
      expect(arg.data.status).not.toBe('DUPLICATE');
    });
  });

  it('DiagnosticReport의 contained Observation을 parsedItem으로 매핑·스테이징', async () => {
    const res = await service.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
    expect(res.items).toBe(1);
    const arg = mockPrisma.labInterfaceResult.create.mock.calls[0][0];
    const item = (arg.data.parsedItems as any[])[0];
    expect(item.testCode).toBe('2823-3');
    expect(item.loincCode).toBe('2823-3');
    expect(item.value).toBe('6.8');
    expect(item.unit).toBe('mmol/L');
    expect(item.normalMin).toBe(3.5);
    expect(item.normalMax).toBe(5.1);
    expect(item.interpretation).toBe('HH');
  });

  it('basedOn ServiceRequest → 오더 결속(MATCHED)', async () => {
    const res = await service.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
    expect(res.status).toBe('MATCHED');
    expect(res.matchedOrderId).toBe('00000000-0000-0000-0000-000000000abc');
    expect(mockPrisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: '00000000-0000-0000-0000-000000000abc', department: 'LAB' }) }),
    );
  });

  it('basedOn 없으면 subject 환자의 열린 LAB 오더로 결속(바코드 substring 폐기)', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'ord-subj' });
    const body = diagnosticReport({ basedOn: undefined });
    const res = await service.ingestDiagnosticReport(body, 'lis-client');
    expect(res.status).toBe('MATCHED');
    expect(res.matchedOrderId).toBe('ord-subj');
    // subject 환자(UUID)로 조회했는지
    expect(mockPrisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ prescription: { encounter: { patientId: '11111111-1111-1111-1111-111111111111' } } }) }),
    );
  });

  it('비UUID subject는 UUID 쿼리 없이 안전 처리(500 방지)', async () => {
    const body = diagnosticReport({ basedOn: undefined, subject: { reference: 'Patient/not-a-uuid' } });
    const res = await service.ingestDiagnosticReport(body, 'lis-client');
    // subject 폴백 오더 쿼리를 하지 않음(비UUID) → 미결속
    expect(res.status).toBe('RECEIVED');
    expect(mockPrisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('[P0] basedOn 오더 환자 ≠ subject → 미결속(RECEIVED, 오환자 결속 차단)', async () => {
    // basedOn 오더가 다른 환자(other-pat) 소속 → subject(pat-1)와 불일치 → 미결속
    mockPrisma.order.findFirst.mockResolvedValueOnce({ id: '00000000-0000-0000-0000-000000000abc', prescription: { encounter: { patientId: 'other-pat' } } });
    // subject 폴백 매칭도 없음(다른 환자라 열린 오더 없음)
    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    const res = await service.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
    expect(res.status).toBe('RECEIVED');
    expect(res.matchedOrderId).toBeNull();
  });

  describe('🔴 subject 가 MRN 일 때 오환자 대조', () => {
    const ORDER = '00000000-0000-0000-0000-000000000abc';
    const mrnReport = () => diagnosticReport({ subject: { reference: 'Patient/MRN-7001' } });

    it('MRN 이 해소되고 오더 환자와 다르면 미결속(RECEIVED) — 종전엔 대조를 건너뛰고 MATCHED', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue({ id: 'pat-by-mrn' });
      mockPrisma.order.findFirst.mockResolvedValueOnce({ id: ORDER, prescription: { encounter: { patientId: 'other-pat' } } });
      mockPrisma.order.findFirst.mockResolvedValueOnce(null);
      const res = await service.ingestDiagnosticReport(mrnReport(), 'lis-client');
      expect(mockPrisma.patient.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { mrn: 'MRN-7001' } }));
      expect(res.status).toBe('RECEIVED');
      expect(res.matchedOrderId).toBeNull();
    });

    it('대조군 — MRN 이 해소되고 오더 환자와 같으면 결속(MATCHED)', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue({ id: 'pat-by-mrn' });
      mockPrisma.order.findFirst.mockResolvedValueOnce({ id: ORDER, prescription: { encounter: { patientId: 'pat-by-mrn' } } });
      const res = await service.ingestDiagnosticReport(mrnReport(), 'lis-client');
      expect(res.status).toBe('MATCHED');
      expect(res.matchedOrderId).toBe(ORDER);
    });

    it('보냈는데 못 찾은 subject 는 "대조 불가" — basedOn 만으로 결속하지 않고 사유를 남긴다', async () => {
      mockPrisma.order.findFirst.mockResolvedValueOnce({ id: ORDER, prescription: { encounter: { patientId: 'any-pat' } } });
      const res = await service.ingestDiagnosticReport(mrnReport(), 'lis-client');
      expect(res.status).toBe('RECEIVED');
      expect(res.matchedOrderId).toBeNull();
      const arg = mockPrisma.labInterfaceResult.create.mock.calls[0][0];
      expect(arg.data.errorMessage).toContain('대조할 수 없습니다');
    });

    it('대조군 — subject 를 아예 보내지 않은 경우는 종전대로 basedOn 결속(absent ≠ unresolved)', async () => {
      mockPrisma.order.findFirst.mockResolvedValueOnce({ id: ORDER, prescription: { encounter: { patientId: 'any-pat' } } });
      const res = await service.ingestDiagnosticReport(diagnosticReport({ subject: undefined }), 'lis-client');
      expect(res.status).toBe('MATCHED');
    });
  });

  it('contained Observation 없으면 400(참조 result만으로는 수신 불가)', async () => {
    const body = diagnosticReport({ contained: [] });
    await expect(service.ingestDiagnosticReport(body, 'lis-client')).rejects.toThrow(BadRequestException);
  });

  it('resourceType 불일치 시 400', async () => {
    await expect(service.ingestDiagnosticReport({ resourceType: 'Patient' } as any, 'c')).rejects.toThrow(BadRequestException);
  });

  it('가상 계측기 upsert(원자·경합 방지)', async () => {
    await service.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
    expect(mockPrisma.labInstrument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { interfaceType_serialNumber: { interfaceType: 'API', serialNumber: 'FHIR:lis-client' } },
        create: expect.objectContaining({ interfaceType: 'API', serialNumber: 'FHIR:lis-client' }),
      }),
    );
  });

  it('[P2] 같은 검체 미적용 스테이징행 있으면 재사용(멱등·중복행 방지)', async () => {
    mockPrisma.labInterfaceResult.findFirst.mockResolvedValue({ id: 'lir-existing' });
    const res = await service.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
    expect(mockPrisma.labInterfaceResult.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lir-existing' } }),
    );
    expect(mockPrisma.labInterfaceResult.create).not.toHaveBeenCalled();
    expect(res.id).toBe('lir-1');
  });

  it('단건 Observation 수신', async () => {
    const obs = {
      resourceType: 'Observation', status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: '혈색소' }] },
      valueQuantity: { value: 8.2, unit: 'g/dL' },
    };
    const res = await service.ingestObservation(obs as any, 'lis-client');
    expect(res.items).toBe(1);
  });

  describe('ingestReport (Bundle 경로 — 별도 Observation 참조)', () => {
    it('별도 엔트리 Observation들을 report와 함께 스테이징', async () => {
      const report = {
        resourceType: 'DiagnosticReport', status: 'final',
        basedOn: [{ reference: 'ServiceRequest/00000000-0000-0000-0000-000000000abc' }],
        code: { coding: [{ system: 'http://loinc.org', code: '11502-2' }] },
      };
      const observations = [
        { resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '2823-3', display: 'K' }] }, valueQuantity: { value: 6.8, unit: 'mmol/L' } },
        { resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '2951-2', display: 'Na' }] }, valueQuantity: { value: 140, unit: 'mmol/L' } },
      ];
      const res = await service.ingestReport(report as any, observations as any, 'lis-client');
      expect(res.items).toBe(2);
      expect(res.status).toBe('MATCHED');
    });

    it('연결된 Observation이 전무하면 400', async () => {
      await expect(service.ingestReport({ resourceType: 'DiagnosticReport' } as any, [], 'c')).rejects.toThrow(BadRequestException);
    });
  });

  describe('자동 apply 게이트', () => {
    it('OFF(기본)이면 스테이징만·apply 미호출', async () => {
      const labService: any = { applyInterfaceResult: vi.fn() };
      const config: any = { get: vi.fn().mockResolvedValue('OFF') };
      const svc = new FhirLabIngestService(mockPrisma, labService, config);
      const res = await svc.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      expect(res.applied).toBe(false);
      expect(labService.applyInterfaceResult).not.toHaveBeenCalled();
    });

    it('ON + 시스템유저 + 매칭 시 자동 apply', async () => {
      const labService: any = { applyInterfaceResult: vi.fn().mockResolvedValue({}) };
      const config: any = { get: vi.fn().mockImplementation((k: string) => Promise.resolve(k === 'lab.fhirAutoApply' ? 'ON' : 'sys-user-1')) };
      const svc = new FhirLabIngestService(mockPrisma, labService, config);
      const res = await svc.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      expect(labService.applyInterfaceResult).toHaveBeenCalledWith('lir-1', 'sys-user-1');
      expect(res.applied).toBe(true);
      expect(res.status).toBe('APPLIED');
    });

    it('ON이지만 시스템유저 미설정이면 apply 생략', async () => {
      const labService: any = { applyInterfaceResult: vi.fn() };
      const config: any = { get: vi.fn().mockImplementation((k: string) => Promise.resolve(k === 'lab.fhirAutoApply' ? 'ON' : null)) };
      const svc = new FhirLabIngestService(mockPrisma, labService, config);
      const res = await svc.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      expect(labService.applyInterfaceResult).not.toHaveBeenCalled();
      expect(res.applied).toBe(false);
    });

    it('시스템 서비스계정 설정 시 그 명의로 감사 기록(clientId는 details)', async () => {
      const audit: any = { log: vi.fn().mockResolvedValue({}) };
      const config: any = { get: vi.fn().mockResolvedValue('sys-user-1') };
      const svc = new FhirLabIngestService(mockPrisma, undefined, config, audit);
      await svc.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'sys-user-1', action: 'CREATE', resourceType: 'LabInterfaceResult', resourceId: 'lir-1',
        changes: expect.objectContaining({ sourceClient: { old: null, new: 'lis-client' } }),
      }));
    });

    it('시스템 서비스계정 미설정 시 감사 생략(User FK 무음실패 방지)', async () => {
      const audit: any = { log: vi.fn().mockResolvedValue({}) };
      const config: any = { get: vi.fn().mockResolvedValue(null) };
      const svc = new FhirLabIngestService(mockPrisma, undefined, config, audit);
      await svc.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('[P2] 시스템계정 비활성/미존재면 자동 apply 생략', async () => {
      const labService: any = { applyInterfaceResult: vi.fn() };
      const config: any = { get: vi.fn().mockImplementation((k: string) => Promise.resolve(k === 'lab.fhirAutoApply' ? 'ON' : 'sys-user-1')) };
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'sys-user-1', isActive: false }); // 비활성
      const svc = new FhirLabIngestService(mockPrisma, labService, config);
      const res = await svc.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      expect(labService.applyInterfaceResult).not.toHaveBeenCalled();
      expect(res.applied).toBe(false);
    });

    it('[P2] 기존 결과가 VERIFIED면 자동 apply 생략(재전송 revert 방지)', async () => {
      const labService: any = { applyInterfaceResult: vi.fn() };
      const config: any = { get: vi.fn().mockImplementation((k: string) => Promise.resolve(k === 'lab.fhirAutoApply' ? 'ON' : 'sys-user-1')) };
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'sys-user-1', isActive: true });
      mockPrisma.labResult.findUnique.mockResolvedValue({ status: 'VERIFIED' }); // 이미 확정검증
      const svc = new FhirLabIngestService(mockPrisma, labService, config);
      const res = await svc.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      expect(labService.applyInterfaceResult).not.toHaveBeenCalled();
      expect(res.applied).toBe(false);
    });

    it('apply 실패해도 스테이징 유지(best-effort)', async () => {
      const labService: any = { applyInterfaceResult: vi.fn().mockRejectedValue(new Error('boom')) };
      const config: any = { get: vi.fn().mockImplementation((k: string) => Promise.resolve(k === 'lab.fhirAutoApply' ? 'ON' : 'sys-user-1')) };
      const svc = new FhirLabIngestService(mockPrisma, labService, config);
      const res = await svc.ingestDiagnosticReport(diagnosticReport(), 'lis-client');
      expect(res.applied).toBe(false);
      expect(res.id).toBe('lir-1');
    });
  });
});
