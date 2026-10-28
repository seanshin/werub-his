import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrescriptionService, hashPrescriptionBody } from '../../src/modules/prescription/prescription.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

describe('PrescriptionService', () => {
  let service: PrescriptionService;
  let mockPrisma: any;
  let mockDurService: any;
  let mockOrderService: any;
  let mockConfig: any;
  let mockStepUp: any;
  let mockPushApproval: any;
  let mockEventEmitter: any;

  beforeEach(() => {
    mockPrisma = {
      encounter: {
        findUnique: vi.fn(),
      },
      prescription: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      order: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]), // 처방 취소 시 취소대상 오더 캡처(order.cancelled 이벤트 역전용)
        updateMany: vi.fn().mockResolvedValue({ count: 0 }), // 처방 취소 시 연결 오더 취소
        count: vi.fn().mockResolvedValue(0), // 발효 판정(2026-09-30) — 기본 미발효
      },
      medicationAdministration: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }), // 처방 취소 시 예정 MAR 제거(desync 방지)
        count: vi.fn().mockResolvedValue(0), // 발효 판정 — 기본 투약 기록 없음
      },
      $transaction: vi.fn((cb) => cb(mockPrisma)),
      medicationCode: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      // 작성자 역할 조회 — 비처방 역할(간호사·임상병리사)이면 지정 처방의+승인을 강제하는 게이트가 읽는다.
      // 기본은 의사(종전 동작 유지). 역할 게이트 자체는 prescriber-role-gate.spec 이 고정한다.
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'DOCTOR' }),
      },
    };

    mockDurService = {
      checkInteractions: vi.fn(),
    };

    mockOrderService = {
      create: vi.fn(),
    };

    mockEventEmitter = { emit: vi.fn() };
    // 규칙 OFF(get→null) → resolvePrescriber 는 작성자 본인 반환(위임/step-up 미경유)
    mockConfig = { get: vi.fn().mockResolvedValue(null) };
    mockStepUp = { consume: vi.fn() };
    mockPushApproval = { requestDelegate: vi.fn() };
    const mockAudit = { safeLog: vi.fn() };
    service = new PrescriptionService(
      mockPrisma,
      mockDurService,
      mockEventEmitter as any,
      mockOrderService,
      mockConfig as any,
      mockStepUp as any,
      mockPushApproval as any,
      mockAudit as any,
      { assertOrderGate: vi.fn().mockResolvedValue(undefined) } as any, // PreAuthGateService — 게이트 no-op
    );
  });

  describe('create', () => {
    it('should create medication prescription with DUR check', async () => {
      const dto = {
        type: 'MEDICATION',
        medicationCodeId: 'med-001',
        dosage: '500mg',
        frequency: '1일 3회',
        duration: 7,
        route: 'PO',
        priority: 'ROUTINE',
      };

      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        patientId: 'pat-1',
      });

      mockDurService.checkInteractions.mockResolvedValue([]);

      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({
        id: 'rx-1',
        encounterId: 'enc-1',
        ...dto,
        durChecked: true,
        medicationCode: { code: 'MED001', nameKo: '약물명' },
      });

      const result = await service.create('enc-1', dto as any, 'doc-1');

      expect(result.prescription.id).toBe('rx-1');
      expect(result.durWarnings).toEqual([]);
      expect(mockDurService.checkInteractions).toHaveBeenCalledWith(
        'enc-1', 'med-001', 'pat-1',
        expect.objectContaining({ dosage: expect.anything() }), // maxDailyDose 검사용 용법 컨텍스트
      );
    });

    it('should block medication with ERROR severity DUR warning unless overridden', async () => {
      const dto = {
        type: 'MEDICATION',
        medicationCodeId: 'med-001',
        dosage: '500mg',
        frequency: '1일 3회',
        duration: 7,
        route: 'PO',
      };

      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        patientId: 'pat-1',
      });

      mockDurService.checkInteractions.mockResolvedValue([
        { severity: 'ERROR', message: '약물 상호작용 위험' },
      ]);

      await expect(service.create('enc-1', dto as any, 'doc-1')).rejects.toThrow(BadRequestException);
    });

    it('should allow medication with overrideDur flag (사유 포함)', async () => {
      const dto = {
        type: 'MEDICATION',
        medicationCodeId: 'med-001',
        dosage: '500mg',
        frequency: '1일 3회',
        duration: 7,
        route: 'PO',
        overrideDur: true,
        // 🔴 사유 없는 강제 처방은 이제 거부된다 — 종전 이 케이스는 사유 없이 통과해
        //    "우회는 되는데 근거는 없는" 상태를 계약으로 굳히고 있었다(아래 거울 케이스 참조).
        overrideReason: '타 약제 실패 — 담당의 판단',
      };

      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        patientId: 'pat-1',
      });

      mockDurService.checkInteractions.mockResolvedValue([
        { severity: 'ERROR', message: '약물 상호작용 위험' },
      ]);

      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({
        id: 'rx-1',
        ...dto,
      });

      const result = await service.create('enc-1', dto as any, 'doc-1');

      expect(result.prescription.id).toBe('rx-1');
      // who/why 가 원장에 남는다(COPY·REPEAT 만 남기고 CREATE 는 빠져 있었다)
      expect(mockPrisma.prescription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            durOverridden: true,
            durOverrideReason: '타 약제 실패 — 담당의 판단',
            durOverrideBy: 'doc-1',
          }),
        }),
      );
    });

    it('🔴 overrideDur 만 보내고 사유가 없으면 거부한다(BLOCK 게이트 구멍)', async () => {
      const dto = {
        type: 'MEDICATION', medicationCodeId: 'med-001', dosage: '500mg',
        frequency: '1일 3회', duration: 7, route: 'PO', overrideDur: true,
      };
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-1', patientId: 'pat-1' });
      mockDurService.checkInteractions.mockResolvedValue([{ severity: 'ERROR', message: '약물 상호작용 위험' }]);
      await expect(service.create('enc-1', dto as any, 'doc-1')).rejects.toMatchObject({
        response: { code: 'DUR_OVERRIDE_REASON_REQUIRED' },
      });
    });

    it('should throw NotFoundException if encounter not found', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(null);

      await expect(
        service.create('enc-1', {} as any, 'doc-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create order for non-medication prescription automatically', async () => {
      const dto = {
        type: 'LAB',
        procedureCodeId: 'proc-001',
        quantity: 1,
        priority: 'STAT',
      };

      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        patientId: 'pat-1',
      });

      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({
        id: 'rx-1',
        type: 'LAB',
      });

      await service.create('enc-1', dto as any, 'doc-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('findByEncounter', () => {
    it('should return all prescriptions for encounter', async () => {
      const mockPrescriptions = [
        {
          id: 'rx-1',
          type: 'MEDICATION',
          dosage: '500mg',
          medicationCode: { code: 'MED001', nameKo: '약물' },
          orders: [{ id: 'ord-1', department: 'PHARMACY', status: 'PENDING' }],
        },
      ];

      mockPrisma.prescription.findMany.mockResolvedValue(mockPrescriptions);

      const result = await service.findByEncounter('enc-1');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('MEDICATION');
      expect(result[0].orders).toHaveLength(1);
    });
  });

  describe('cancel', () => {
    it('should cancel prescription', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({
        id: 'rx-1',
        status: 'ACTIVE',
      });

      mockPrisma.prescription.update.mockResolvedValue({
        id: 'rx-1',
        status: 'CANCELLED',
      });

      const result = await service.cancel('rx-1');

      expect(result.status).toBe('CANCELLED');
      expect(mockPrisma.prescription.update).toHaveBeenCalledWith({
        where: { id: 'rx-1' },
        data: { status: 'CANCELLED' },
      });
    });

    it('should throw NotFoundException if prescription not found', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue(null);

      await expect(service.cancel('rx-1')).rejects.toThrow(NotFoundException);
    });

    it('should emit order.cancelled for cancelled orders (accrual 역전 트리거)', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({ id: 'rx-1', status: 'ACTIVE' });
      mockPrisma.prescription.update.mockResolvedValue({ id: 'rx-1', status: 'CANCELLED' });
      mockPrisma.order.findMany.mockResolvedValue([{ id: 'ord-1' }, { id: 'ord-2' }]);

      await service.cancel('rx-1');

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('order.cancelled', expect.objectContaining({
        prescriptionId: 'rx-1', orderIds: ['ord-1', 'ord-2'], reason: 'PRESCRIPTION_CANCELLED',
      }));
    });

    it('should NOT emit order.cancelled when no orders were cancelled', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({ id: 'rx-1', status: 'ACTIVE' });
      mockPrisma.prescription.update.mockResolvedValue({ id: 'rx-1', status: 'CANCELLED' });
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.cancel('rx-1');

      const calls = mockEventEmitter.emit.mock.calls.filter((c: unknown[]) => c[0] === 'order.cancelled');
      expect(calls).toHaveLength(0);
    });
  });

  describe('checkDur', () => {
    it('should perform manual DUR check before prescription', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        patientId: 'pat-1',
      });

      mockDurService.checkInteractions.mockResolvedValue([
        { severity: 'WARNING', message: '부작용 주의' },
      ]);

      const result = await service.checkDur('enc-1', 'med-001');

      expect(result.durWarnings).toHaveLength(1);
      expect(result.safe).toBe(false);
    });

    it('should return safe when no warnings', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        patientId: 'pat-1',
      });

      mockDurService.checkInteractions.mockResolvedValue([]);

      const result = await service.checkDur('enc-1', 'med-001');

      expect(result.durWarnings).toEqual([]);
      expect(result.safe).toBe(true);
    });
  });

  describe('copyFromEncounter', () => {
    it('should copy prescriptions from source to target encounter', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-2',
      });

      mockPrisma.prescription.findMany.mockResolvedValue([
        {
          id: 'rx-1',
          type: 'MEDICATION',
          dosage: '500mg',
          frequency: '1일 3회',
          duration: 7,
          route: 'PO',
        },
      ]);

      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({
        id: 'rx-2',
        encounterId: 'enc-2',
        source: 'COPY',
      });

      const result = await service.copyFromEncounter('enc-2', 'enc-1', 'doc-1');

      expect(result.count).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should filter by prescriptionIds if provided', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-2' });
      mockPrisma.prescription.findMany.mockResolvedValue([
        {
          id: 'rx-1',
          type: 'MEDICATION',
          dosage: '500mg',
        },
      ]);

      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({
        id: 'rx-2',
        encounterId: 'enc-2',
        source: 'COPY',
      });

      await service.copyFromEncounter('enc-2', 'enc-1', 'doc-1', ['rx-1']);

      expect(mockPrisma.prescription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['rx-1'] },
          }),
        }),
      );
    });

    it('should throw if no prescriptions to copy', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-2' });
      mockPrisma.prescription.findMany.mockResolvedValue([]);

      await expect(service.copyFromEncounter('enc-2', 'enc-1', 'doc-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('copyPrescriptions', () => {
    it('should copy prescriptions between encounters with type filter', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValueOnce({ id: 'enc-2', patientId: 'pat-2' });
      mockPrisma.encounter.findUnique.mockResolvedValueOnce({ id: 'enc-1', patientId: 'pat-1' });

      mockPrisma.prescription.findMany.mockResolvedValue([
        {
          id: 'rx-1',
          type: 'MEDICATION',
          dosage: '500mg',
          medicationCodeId: 'med-001',
        },
      ]);

      mockDurService.checkInteractions.mockResolvedValue([]);

      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({
        id: 'rx-2',
        encounterId: 'enc-2',
        source: 'COPY',
      });

      const result = await service.copyPrescriptions('enc-1', 'enc-2', 'doc-1', ['MEDICATION']);

      expect(result.count).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should re-check DUR for copied medications', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValueOnce({ id: 'enc-2', patientId: 'pat-2' });
      mockPrisma.encounter.findUnique.mockResolvedValueOnce({ id: 'enc-1', patientId: 'pat-1' });

      mockPrisma.prescription.findMany.mockResolvedValue([
        {
          id: 'rx-1',
          type: 'MEDICATION',
          medicationCodeId: 'med-001',
        },
      ]);

      mockDurService.checkInteractions.mockResolvedValue([
        { severity: 'WARNING', message: '부작용 주의' },
      ]);

      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({
        id: 'rx-2',
        source: 'COPY',
      });

      const result = await service.copyPrescriptions('enc-1', 'enc-2', 'doc-1');

      expect(result.prescriptions[0].durWarnings).toHaveLength(1);
    });
  });

  describe('repeatPrescription', () => {
    it('should repeat prescription in same encounter', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({
        id: 'rx-1',
        type: 'MEDICATION',
        dosage: '500mg',
        frequency: '1일 3회',
        duration: 7,
        route: 'PO',
        encounterId: 'enc-1',
        medicationCodeId: 'med-001',
        encounter: { patientId: 'pat-1' },
      });

      mockDurService.checkInteractions.mockResolvedValue([]);

      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({
        id: 'rx-2',
        encounterId: 'enc-1',
        source: 'COPY',
      });

      const result = await service.repeatPrescription('rx-1', 'doc-1');

      expect(result.prescription.id).toBe('rx-2');
      expect(result.prescription.source).toBe('COPY');
    });

    it('should perform DUR check on repeat', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({
        id: 'rx-1',
        type: 'MEDICATION',
        medicationCodeId: 'med-001',
        encounterId: 'enc-1',
        encounter: { patientId: 'pat-1' },
      });

      mockDurService.checkInteractions.mockResolvedValue([
        { severity: 'WARNING', message: '재복용 주의' },
      ]);

      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({
        id: 'rx-2',
        source: 'COPY',
      });

      const result = await service.repeatPrescription('rx-1', 'doc-1');

      expect(result.durWarnings).toHaveLength(1);
    });

    it('should throw NotFoundException if prescription not found', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue(null);

      await expect(service.repeatPrescription('rx-1', 'doc-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // W-1: 위임 step-up 토큰에 약품 내용(bodyHash) 바인딩 — 부인방지
  describe('hashPrescriptionBody', () => {
    const body = { type: 'MEDICATION', medicationCodeId: 'med-001', dosage: '500mg', frequency: '1일 3회', duration: 7, quantity: 14 };

    it('동일 본문은 동일 해시(결정성·키순서 비의존)', () => {
      const h1 = hashPrescriptionBody(body);
      const h2 = hashPrescriptionBody({ quantity: 14, duration: 7, frequency: '1일 3회', dosage: '500mg', medicationCodeId: 'med-001', type: 'MEDICATION' });
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('용량이 바뀌면 해시도 달라짐(승인 후 변조 탐지 가능)', () => {
      expect(hashPrescriptionBody(body)).not.toBe(hashPrescriptionBody({ ...body, dosage: '1000mg' }));
    });
  });

  describe('requestPrescriberDelegate (서버 권위적 위임 요청)', () => {
    const body = { type: 'MEDICATION', medicationCodeId: 'med-001', dosage: '500mg', frequency: '1일 3회', duration: 7, quantity: 14 };

    beforeEach(() => {
      mockConfig.get.mockResolvedValue({ enabled: true, allowDelegate: true, requireDelegateAuth: true, allowedRoles: ['DOCTOR'] });
      mockPrisma.user = { findUnique: vi.fn().mockResolvedValue({ id: 'doc-2', role: 'DOCTOR', department: 'IM', isActive: true }) };
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-1', admissionId: null });
      mockPushApproval.requestDelegate.mockResolvedValue({ requestId: 'req-1', expiresAt: '2026-06-21T00:05:00.000Z' });
      mockPrisma.medicationCode = { ...(mockPrisma.medicationCode ?? {}), findUnique: vi.fn().mockResolvedValue({ nameKo: '아세트아미노펜정500밀리그램' }) };
    });

    it('서버가 처방 본문으로 bodyHash 를 계산해 requestDelegate 에 전달', async () => {
      const res = await service.requestPrescriberDelegate('enc-1', 'doc-1', 'doc-2', body);
      expect(res.requestId).toBe('req-1');
      const expectedHash = hashPrescriptionBody(body);
      expect(mockPushApproval.requestDelegate).toHaveBeenCalledWith(
        'doc-1', 'doc-2', 'PRESCRIPTION_CREATE', 'enc-1', expectedHash, expect.any(String),
      );
    });

    it('🔴 (B1) 폰 요약에 약품 이름이 실린다 — `코드 <id>` 가 아니다 · 없는 코드면 요청을 만들지 않는다', async () => {
      await service.requestPrescriberDelegate('enc-1', 'doc-1', 'doc-2', body);
      const summary = mockPushApproval.requestDelegate.mock.calls[0][5] as string;
      expect(summary).toContain('아세트아미노펜정500밀리그램');
      expect(summary).toContain('500mg');
      expect(summary).not.toContain('med-001');
      mockPushApproval.requestDelegate.mockClear();
      mockPrisma.medicationCode.findUnique.mockResolvedValue(null);
      const e = await service.requestPrescriberDelegate('enc-1', 'doc-1', 'doc-2', body).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'DELEGATE_CODE_NOT_FOUND' });
      expect(mockPushApproval.requestDelegate).not.toHaveBeenCalled();
    });

    it('본인 위임은 거부(self-delegation)', async () => {
      await expect(service.requestPrescriberDelegate('enc-1', 'doc-1', 'doc-1', body)).rejects.toThrow(BadRequestException);
      expect(mockPushApproval.requestDelegate).not.toHaveBeenCalled();
    });

    it('allowDelegate=false 면 거부', async () => {
      mockConfig.get.mockResolvedValue({ enabled: true, allowDelegate: false, allowedRoles: ['DOCTOR'] });
      await expect(service.requestPrescriberDelegate('enc-1', 'doc-1', 'doc-2', body)).rejects.toThrow(ForbiddenException);
    });

    it('지정 처방의 역할이 허용 목록에 없으면 거부', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'doc-2', role: 'NURSE', department: 'IM', isActive: true });
      await expect(service.requestPrescriberDelegate('enc-1', 'doc-1', 'doc-2', body)).rejects.toThrow(BadRequestException);
    });
  });

  // 백로그 #5 — 진료기록 상태 가드(clinical.prescriptionRequiresOpenEncounter, 옵트인)
  describe('진료기록 상태 가드(prescriptionRequiresOpenEncounter)', () => {
    const labDto = { type: 'LAB', procedureCodeId: 'proc-1', priority: 'ROUTINE' };

    // config: 가드 키만 true, 그 외(prescriberRules 등) null → resolvePrescriber 는 작성자 본인
    const guardOn = () =>
      mockConfig.get.mockImplementation(async (k: string) =>
        k === 'clinical.prescriptionRequiresOpenEncounter' ? true : null,
      );

    beforeEach(() => {
      mockDurService.checkInteractions.mockResolvedValue([]);
      mockPrisma.order.create.mockResolvedValue({ id: 'order-1' });
      mockPrisma.prescription.create.mockResolvedValue({ id: 'rx-1', encounterId: 'enc-1', type: 'LAB' });
    });

    it('가드 OFF(미설정): SIGNED 진료기록에도 처방 생성 — 현행 유지', async () => {
      // mockConfig.get 기본값 null → 가드 skip
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-1', patientId: 'pat-1', status: 'SIGNED' });
      const res = await service.create('enc-1', labDto as any, 'doc-1');
      expect(res.prescription.id).toBe('rx-1');
    });

    it('가드 ON: SIGNED 진료기록은 처방 추가 차단(ENCOUNTER_NOT_PRESCRIBABLE)', async () => {
      guardOn();
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-1', patientId: 'pat-1', status: 'SIGNED' });
      await expect(service.create('enc-1', labDto as any, 'doc-1')).rejects.toMatchObject({
        response: { code: 'ENCOUNTER_NOT_PRESCRIBABLE' },
      });
      expect(mockPrisma.prescription.create).not.toHaveBeenCalled();
    });

    it('가드 ON: DRAFT(작성 중)는 정상 처방 생성', async () => {
      guardOn();
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-1', patientId: 'pat-1', status: 'DRAFT' });
      const res = await service.create('enc-1', labDto as any, 'doc-1');
      expect(res.prescription.id).toBe('rx-1');
    });

    it('가드 ON: AMENDED(정정 중)는 합법적 추가 → 허용', async () => {
      guardOn();
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-1', patientId: 'pat-1', status: 'AMENDED' });
      const res = await service.create('enc-1', labDto as any, 'doc-1');
      expect(res.prescription.id).toBe('rx-1');
    });

    it('가드 ON: copyFromEncounter 대상이 SIGNED 면 차단', async () => {
      guardOn();
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-tgt', patientId: 'pat-1', status: 'SIGNED' });
      await expect(service.copyFromEncounter('enc-tgt', 'enc-src', 'doc-1')).rejects.toMatchObject({
        response: { code: 'ENCOUNTER_NOT_PRESCRIBABLE' },
      });
      expect(mockPrisma.prescription.create).not.toHaveBeenCalled();
    });

    it('가드 ON: repeatPrescription 의 진료기록이 SIGNED 면 차단', async () => {
      guardOn();
      mockPrisma.prescription.findUnique.mockResolvedValue({
        id: 'rx-0', encounterId: 'enc-1', type: 'LAB',
        encounter: { id: 'enc-1', patientId: 'pat-1', status: 'SIGNED' },
      });
      await expect(service.repeatPrescription('rx-0', 'doc-1')).rejects.toMatchObject({
        response: { code: 'ENCOUNTER_NOT_PRESCRIBABLE' },
      });
      expect(mockPrisma.prescription.create).not.toHaveBeenCalled();
    });
  });
});
