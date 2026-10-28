import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FhirController } from '../../src/modules/fhir/fhir.controller';

// 인바운드 ServiceRequest → PreOrder 수용 (LIS reflex R-1)
describe('FhirController POST /ServiceRequest (inbound)', () => {
  let controller: FhirController;
  let mockPrisma: any;
  let mockPreOrder: any;
  let mockConfig: any;

  const validSr = () => ({
    resourceType: 'ServiceRequest',
    status: 'draft',
    intent: 'reflex-order',
    identifier: [{ system: 'urn:lis:order', value: 'LIS-RX-001' }],
    subject: { reference: 'Patient/pat-1' },
    basedOn: [{ reference: 'ServiceRequest/ord-1' }],
    code: { text: 'HBsAg 확진', coding: [{ system: 'http://loinc.org', code: '5195-3', display: 'HBsAg' }] },
    reasonCode: [{ text: '선별 양성 → 확진 reflex (standing order SO-12)' }],
  });

  beforeEach(() => {
    mockPrisma = {
      preOrder: { findUnique: vi.fn().mockResolvedValue(null) },
      // 🔴 subject 는 UUID(내부 id)로도, MRN(차트번호)으로도 온다 — 정본이 둘 다 찾는다
      patient: {
        findUnique: vi.fn().mockResolvedValue({ id: 'pat-1' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'pat-1' }),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ord-1',
          prescription: { encounter: { patientId: 'pat-1', doctorId: 'doc-1' } },
        }),
      },
      procedureCode: { findFirst: vi.fn().mockResolvedValue({ id: 'pc-1', code: 'D2810', nameKo: 'HBsAg 정밀' }) },
    };
    mockPreOrder = { create: vi.fn().mockResolvedValue({ data: { id: 'po-1', status: 'PENDING' } }) };
    mockConfig = { get: vi.fn().mockResolvedValue('true') };

    controller = new FhirController(
      {} as any, {} as any, mockPrisma, {} as any, {} as any,
      mockPreOrder, mockConfig,
    );
  });

  it('should accept draft reflex SR → PreOrder(LIS_REFLEX) with doctor from basedOn', async () => {
    const ack = await controller.createServiceRequest(validSr());

    expect(mockPreOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      patientId: 'pat-1',
      doctorId: 'doc-1',
      type: 'LAB',
      procedureCodeId: 'pc-1',
      source: 'LIS_REFLEX',
      externalRef: 'urn:lis:order|LIS-RX-001',
    }));
    expect(ack.resourceType).toBe('ServiceRequest');
    expect(ack.id).toBe('po-1');
    expect(ack.status).toBe('draft');
  });

  it('should reject when inbound config is OFF (기본 OFF — A-1~3 합의 게이트)', async () => {
    mockConfig.get.mockResolvedValue('false');
    await expect(controller.createServiceRequest(validSr())).rejects.toThrow(ForbiddenException);
  });

  it('should reject non-draft status (무단 처방 금지)', async () => {
    await expect(controller.createServiceRequest({ ...validSr(), status: 'active' }))
      .rejects.toThrow(BadRequestException);
    expect(mockPreOrder.create).not.toHaveBeenCalled();
  });

  /**
   * 🔴 외부 점검 — LIS 는 환자 식별자를 **MRN 우선**으로 잡아 `subject: Patient/<MRN>` 을 보낸다.
   * 종전엔 UUID 로만 찾아 400 `환자를 찾을 수 없습니다` 로 거절했다(실호출 확인). 같은 요청의 subject 를
   * UUID 로 바꾸면 통과했다 — 식별자 종류가 다른 것을 "없는 환자"라고 말하지 않는다.
   */
  it('🔴 subject 가 MRN 이어도 받는다(차트번호로 찾는다)', async () => {
    const sr = { ...validSr(), subject: { reference: 'Patient/MRN-20260922-001' } };
    const ack = await controller.createServiceRequest(sr);

    expect(ack).toBeTruthy();
    expect(mockPrisma.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mrn: 'MRN-20260922-001' } }),
    );
    expect(mockPrisma.preOrder.findUnique).toHaveBeenCalled();
  });

  it('대조군 — subject 가 UUID 면 내부 id 로 찾는다(MRN 조회로 새지 않는다)', async () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    mockPrisma.patient.findUnique.mockResolvedValue({ id: uuid });
    mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', prescription: { encounter: { patientId: uuid, doctorId: 'doc-1' } } });
    await controller.createServiceRequest({ ...validSr(), subject: { reference: `Patient/${uuid}` } });

    expect(mockPrisma.patient.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: uuid } }));
  });

  it('🔴 MRN 으로 찾아도 원오더의 환자와 다르면 거절한다(교차 검증은 그대로다)', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue({ id: 'pat-OTHER' });
    await expect(
      controller.createServiceRequest({ ...validSr(), subject: { reference: 'Patient/MRN-X' } }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPreOrder.create, '환자가 다른데 PreOrder 를 만들었다').not.toHaveBeenCalled();
  });

  it('should reject when basedOn patient mismatches subject', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'ord-1', prescription: { encounter: { patientId: 'OTHER', doctorId: 'doc-1' } },
    });
    await expect(controller.createServiceRequest(validSr())).rejects.toThrow(BadRequestException);
  });

  it('should reject missing basedOn (책임 처방의 해소 불가)', async () => {
    await expect(controller.createServiceRequest({ ...validSr(), basedOn: undefined }))
      .rejects.toThrow(BadRequestException);
  });

  it('should reject unmapped LOINC with explicit signal (R-4)', async () => {
    mockPrisma.procedureCode.findFirst.mockResolvedValue(null);
    const err = await controller.createServiceRequest(validSr()).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = err.getResponse() as { issue?: { diagnostics?: string }[] };
    expect(body.issue?.[0]?.diagnostics).toContain('미매핑 LOINC: 5195-3');
  });

  it('should be idempotent on re-send (externalRef) — 기존 건 반환·재생성 없음', async () => {
    mockPrisma.preOrder.findUnique.mockResolvedValue({ id: 'po-existing', status: 'PENDING' });

    const ack = await controller.createServiceRequest(validSr());

    expect(ack.id).toBe('po-existing');
    expect(mockPreOrder.create).not.toHaveBeenCalled();
  });
});
