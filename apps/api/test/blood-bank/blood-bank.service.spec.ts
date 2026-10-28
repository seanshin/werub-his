import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BloodBankService } from '../../src/modules/blood-bank/blood-bank.service';

describe('BloodBankService', () => {
  let service: BloodBankService;
  let mockPrisma: any;

  const mockProduct = { id: 'bp-1', unitNumber: 'U001', productType: 'RBC', bloodType: 'A', rhFactor: '+', status: 'AVAILABLE', volume: 320, expiresAt: new Date('2099-07-01'), irradiated: false, leukoreduced: false, cmvNegative: false, washed: false };
  const mockTransfusion = { id: 't-1', orderId: 'o-1', bloodProductId: 'bp-1', patientId: 'p-1', status: 'PENDING', verifiedByNurse1: null, verifiedByNurse2: null, vitalSigns: [] };

  beforeEach(() => {
    mockPrisma = {
      bloodProduct: {
        findMany: vi.fn().mockResolvedValue([mockProduct]),
        findUnique: vi.fn().mockResolvedValue(mockProduct),
        create: vi.fn().mockResolvedValue(mockProduct),
        update: vi.fn().mockResolvedValue(mockProduct),
        count: vi.fn().mockResolvedValue(3),
        groupBy: vi.fn().mockResolvedValue([{ productType: 'RBC', bloodType: 'A', rhFactor: 'POS', status: 'AVAILABLE', _count: { id: 5 } }]),
      },
      bloodCrossmatch: {
        create: vi.fn().mockResolvedValue({ id: 'cx-1', result: null }),
        findUnique: vi.fn().mockResolvedValue({ id: 'cx-1', method: 'GEL' }),
        update: vi.fn().mockResolvedValue({ id: 'cx-1', result: 'COMPATIBLE' }),
      },
      transfusionOrder: {
        create: vi.fn().mockResolvedValue({ id: 'o-1', units: 2 }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'o-1', patientId: 'p-1', units: 2 }),
        count: vi.fn().mockResolvedValue(5),
        update: vi.fn().mockResolvedValue({ id: 'o-1', status: 'ISSUED' }),
        // 시행이 오더 상태를 끌고 간다(2026-08-18) — 시작=IN_PROGRESS · 요청 단위 완료=COMPLETED
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      bloodTransfusion: {
        create: vi.fn().mockResolvedValue(mockTransfusion),
        findUnique: vi.fn().mockResolvedValue(mockTransfusion),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ ...mockTransfusion, status: 'VERIFIED' }),
        count: vi.fn().mockResolvedValue(0), // 기본: 해당 오더 출고 이력 없음(과출고 가드 통과)
      },
      // 출고 안전 게이트용 — 기본은 적합 시나리오(환자 A+·항체없음·교차 COMPATIBLE·미만료)
      patientBloodTyping: { findUnique: vi.fn().mockResolvedValue({ abo: 'A', rh: 'POS' }) },
      patientAntibody: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation((arg) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
      ),
    };
    // bloodProduct.updateMany(원자 선점) + bloodCrossmatch.findFirst(적합 교차) 추가
    mockPrisma.bloodProduct.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    mockPrisma.bloodCrossmatch.findFirst = vi.fn().mockResolvedValue({ id: 'cx-1', result: 'COMPATIBLE', validUntil: new Date('2099-01-01') });
    // config 미주입 → 게이트 기본 BLOCK(적합 시나리오라 통과)
    service = new BloodBankService(mockPrisma);
  });

  describe('getInventory', () => {
    it('필터 없이 전체 재고 조회', async () => {
      const result = await service.getInventory();
      expect(result).toHaveLength(1);
      expect(mockPrisma.bloodProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('필터 적용', async () => {
      await service.getInventory('RBC', 'A', 'AVAILABLE');
      expect(mockPrisma.bloodProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { productType: 'RBC', bloodType: 'A', status: 'AVAILABLE' },
      }));
    });
  });

  describe('addProduct', () => {
    it('혈액제제 입고', async () => {
      const result = await service.addProduct({
        unitNumber: 'U001', productType: 'RBC', bloodType: 'A', rhFactor: '+',
        volume: 320, collectedAt: '2026-05-01', expiresAt: '2026-07-01',
      });
      expect(result.unitNumber).toBe('U001');
    });
  });

  describe('updateProductStatus', () => {
    it('상태 변경 성공', async () => {
      await service.updateProductStatus('bp-1', 'EXPIRED');
      expect(mockPrisma.bloodProduct.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'EXPIRED' } }));
    });

    it('존재하지 않는 제제', async () => {
      mockPrisma.bloodProduct.findUnique.mockResolvedValue(null);
      await expect(service.updateProductStatus('x', 'EXPIRED')).rejects.toThrow(NotFoundException);
    });
  });

  describe('requestCrossmatch', () => {
    it('교차시험 요청', async () => {
      const result = await service.requestCrossmatch({ patientId: 'p-1', bloodProductId: 'bp-1' }, 'user-1');
      expect(mockPrisma.bloodCrossmatch.create).toHaveBeenCalled();
    });
  });

  describe('submitCrossmatchResult', () => {
    it('교차시험 결과 입력 (72시간 유효)', async () => {
      await service.submitCrossmatchResult('cx-1', { result: 'COMPATIBLE' }, 'tech-1');
      expect(mockPrisma.bloodCrossmatch.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ result: 'COMPATIBLE', validUntil: expect.any(Date) }),
      }));
    });

    it('존재하지 않는 교차시험', async () => {
      mockPrisma.bloodCrossmatch.findUnique.mockResolvedValue(null);
      await expect(service.submitCrossmatchResult('x', { result: 'OK' }, 'tech-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('issueBlood', () => {
    it('적합 시나리오 출고 성공(원자 선점)', async () => {
      await service.issueBlood('o-1', 'bp-1');
      expect(mockPrisma.bloodProduct.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'bp-1', status: 'AVAILABLE' }, data: { status: 'ISSUED' },
      }));
      expect(mockPrisma.bloodTransfusion.create).toHaveBeenCalled();
    });

    it('오더 없음 시 NotFoundException', async () => {
      mockPrisma.transfusionOrder.findUnique.mockResolvedValue(null);
      await expect(service.issueBlood('x', 'bp-1')).rejects.toThrow(NotFoundException);
    });

    it('🔴 오더 수량만큼 출고되면 추가 출고 거부 — 무제한 재출고 봉합(2026-08-13 W3)', async () => {
      // 오더 상태가 전이되지 않아 출고 버튼 조건이 영구 참이던 결함의 서버측 가드
      mockPrisma.bloodTransfusion.count.mockResolvedValue(2); // units=2 전량 기출고
      await expect(service.issueBlood('o-1', 'bp-1')).rejects.toThrow(/이미 오더 수량/);
      expect(mockPrisma.bloodTransfusion.create).not.toHaveBeenCalled();
    });

    it('🔴 마지막 유닛 출고 시 오더가 ISSUED 로 전이된다', async () => {
      mockPrisma.bloodTransfusion.count.mockResolvedValue(1); // 2U 중 1U 기출고 → 이번이 마지막
      await service.issueBlood('o-1', 'bp-1');
      expect(mockPrisma.transfusionOrder.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'o-1' }, data: { status: 'ISSUED' },
      }));
    });

    it('부분 출고(1/2U)는 오더 상태를 바꾸지 않는다', async () => {
      mockPrisma.bloodTransfusion.count.mockResolvedValue(0);
      await service.issueBlood('o-1', 'bp-1');
      expect(mockPrisma.transfusionOrder.update).not.toHaveBeenCalled();
    });

    it('이미 사용된 혈액제제', async () => {
      mockPrisma.bloodProduct.findUnique.mockResolvedValue({ ...mockProduct, status: 'ISSUED' });
      await expect(service.issueBlood('o-1', 'bp-1')).rejects.toThrow(BadRequestException);
    });

    it('[P0] ABO 부적합 시 BLOCK(출고 차단)', async () => {
      mockPrisma.patientBloodTyping.findUnique.mockResolvedValue({ abo: 'O', rh: 'POS' }); // O 수혈자에 A 제제
      await expect(service.issueBlood('o-1', 'bp-1')).rejects.toMatchObject({ response: { code: 'BLOOD_ISSUE_INCOMPATIBLE' } });
      expect(mockPrisma.bloodProduct.updateMany).not.toHaveBeenCalled();
    });

    it('[P0] 만료 제제 출고 차단', async () => {
      mockPrisma.bloodProduct.findUnique.mockResolvedValue({ ...mockProduct, expiresAt: new Date('2000-01-01') });
      await expect(service.issueBlood('o-1', 'bp-1')).rejects.toMatchObject({ response: { code: 'BLOOD_ISSUE_INCOMPATIBLE' } });
    });

    it('[P0] 적합 교차시험 없으면 차단', async () => {
      mockPrisma.bloodCrossmatch.findFirst.mockResolvedValue(null);
      await expect(service.issueBlood('o-1', 'bp-1')).rejects.toMatchObject({ response: { code: 'BLOOD_ISSUE_INCOMPATIBLE' } });
    });

    it('[P0] 유의 항체 보유 시 차단', async () => {
      mockPrisma.patientAntibody.findMany.mockResolvedValue([{ significance: 'SIGNIFICANT' }]);
      await expect(service.issueBlood('o-1', 'bp-1')).rejects.toMatchObject({ response: { code: 'BLOOD_ISSUE_INCOMPATIBLE' } });
    });

    it('WARN 모드는 (게이트 가능한) 교차시험 미비여도 출고하되 warnings 동봉', async () => {
      const warnSvc = new BloodBankService(mockPrisma, { get: vi.fn().mockResolvedValue('WARN') } as any);
      // ABO는 적합(A←A) 유지, 교차시험만 없음(게이트 가능) → WARN이면 출고+warnings
      mockPrisma.bloodCrossmatch.findFirst.mockResolvedValue(null);
      const res: any = await warnSvc.issueBlood('o-1', 'bp-1');
      expect(res.warnings?.length).toBeGreaterThan(0);
      expect(mockPrisma.bloodProduct.updateMany).toHaveBeenCalled();
    });

    it('[P0] WARN/OFF/오타 모드여도 ABO 부적합은 항상 차단(hard-block)', async () => {
      mockPrisma.patientBloodTyping.findUnique.mockResolvedValue({ abo: 'O', rh: 'POS' }); // O←A 부적합
      for (const m of ['WARN', 'OFF', 'BLOCK ', '엉뚱값']) {
        const svc = new BloodBankService(mockPrisma, { get: vi.fn().mockResolvedValue(m) } as any);
        await expect(svc.issueBlood('o-1', 'bp-1')).rejects.toMatchObject({ response: { code: 'BLOOD_ISSUE_INCOMPATIBLE' } });
      }
    });

    it('[P1] 최신 교차시험이 INCOMPATIBLE이면 차단(구 COMPATIBLE 무시)', async () => {
      mockPrisma.bloodCrossmatch.findFirst.mockResolvedValue({ id: 'cx-2', result: 'INCOMPATIBLE', validUntil: new Date('2099-01-01') });
      await expect(service.issueBlood('o-1', 'bp-1')).rejects.toMatchObject({ response: { code: 'BLOOD_ISSUE_INCOMPATIBLE' } });
    });

    it('동시 출고 충돌(updateMany count 0) → ConflictException', async () => {
      mockPrisma.bloodProduct.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.issueBlood('o-1', 'bp-1')).rejects.toThrow();
    });
  });

  describe('verifyTransfusion', () => {
    it('2인 확인 성공', async () => {
      await service.verifyTransfusion('t-1', 'nurse-1', 'nurse-2');
      expect(mockPrisma.bloodTransfusion.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'VERIFIED' }),
      }));
    });

    it('동일 간호사 시 BadRequestException', async () => {
      await expect(service.verifyTransfusion('t-1', 'nurse-1', 'nurse-1')).rejects.toThrow(BadRequestException);
    });

    // bedside 바코드 대조 (2026-07 R2)
    it('스캔 일치 시 VERIFIED + 스캔 원본 보존', async () => {
      mockPrisma.bloodTransfusion.findUnique.mockResolvedValue({
        id: 't-1', status: 'PENDING', patient: { mrn: 'P2026-0001' }, bloodProduct: { unitNumber: 'KRC-2026-0001' },
      });
      await service.verifyTransfusion('t-1', 'nurse-1', 'nurse-2', { patientBandScan: 'p2026-0001', bloodUnitScan: 'KRC-2026-0001' });
      expect(mockPrisma.bloodTransfusion.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'VERIFIED', patientBandScan: 'p2026-0001', bloodUnitScan: 'KRC-2026-0001', bedsideScanAt: expect.any(Date) }),
      }));
    });

    it('환자 밴드 불일치 → 항상 BLOCK (BEDSIDE_PATIENT_MISMATCH)', async () => {
      mockPrisma.bloodTransfusion.findUnique.mockResolvedValue({
        id: 't-1', status: 'PENDING', patient: { mrn: 'P2026-0001' }, bloodProduct: { unitNumber: 'KRC-2026-0001' },
      });
      await expect(
        service.verifyTransfusion('t-1', 'nurse-1', 'nurse-2', { patientBandScan: 'P2026-9999', bloodUnitScan: 'KRC-2026-0001' }),
      ).rejects.toMatchObject({ response: { code: 'BEDSIDE_PATIENT_MISMATCH' } });
    });

    it('혈액백 불일치 → 항상 BLOCK (BEDSIDE_UNIT_MISMATCH)', async () => {
      mockPrisma.bloodTransfusion.findUnique.mockResolvedValue({
        id: 't-1', status: 'PENDING', patient: { mrn: 'P2026-0001' }, bloodProduct: { unitNumber: 'KRC-2026-0001' },
      });
      await expect(
        service.verifyTransfusion('t-1', 'nurse-1', 'nurse-2', { patientBandScan: 'P2026-0001', bloodUnitScan: 'KRC-9999' }),
      ).rejects.toMatchObject({ response: { code: 'BEDSIDE_UNIT_MISMATCH' } });
    });

    // 🔴 팔찌 발급 정본(`buildPatientQr`/`parsePatientQr`)과 통일 — 한 곳만 고치면 갈라진다.
    //    투약(BCMA)과 수혈이 같은 파서를 쓰지 않으면 구 형식 팔찌가 한쪽에서만 통과한다.
    it.each([
      ['구 팔찌 JSON', '{"t":"PATIENT","mrn":"P2026-0001","n":"홍길동"}', 'P2026-0001'],
      ['구 포털 접두', 'HRPT:P2026-0001', 'P2026-0001'],
      ['순수 MRN(정본)', 'p2026-0001', 'p2026-0001'],
    ])('%s 스캔도 통과한다', async (_label, raw, stored) => {
      mockPrisma.bloodTransfusion.findUnique.mockResolvedValue({
        id: 't-1', status: 'PENDING', patient: { mrn: 'P2026-0001' }, bloodProduct: { unitNumber: 'KRC-2026-0001' },
      });
      await service.verifyTransfusion('t-1', 'nurse-1', 'nurse-2', { patientBandScan: raw, bloodUnitScan: 'KRC-2026-0001' });
      // 대조는 파싱된 MRN 으로, 저장은 파싱 결과(구 형식은 MRN, 정본은 원문) — 원본 정보를 잃지 않는다
      expect(mockPrisma.bloodTransfusion.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'VERIFIED', patientBandScan: stored }),
      }));
    });

    it('구 팔찌라도 다른 환자면 여전히 차단한다(관대하게 받되 대조는 엄격)', async () => {
      mockPrisma.bloodTransfusion.findUnique.mockResolvedValue({
        id: 't-1', status: 'PENDING', patient: { mrn: 'P2026-0001' }, bloodProduct: { unitNumber: 'KRC-2026-0001' },
      });
      await expect(
        service.verifyTransfusion('t-1', 'nurse-1', 'nurse-2', { patientBandScan: '{"t":"PATIENT","mrn":"P2026-9999"}', bloodUnitScan: 'KRC-2026-0001' }),
      ).rejects.toMatchObject({ response: { code: 'BEDSIDE_PATIENT_MISMATCH' } });
    });

    it('enforce ON일 때 스캔 미제공 차단 (BEDSIDE_SCAN_REQUIRED)', async () => {
      const enforceSvc = new BloodBankService(mockPrisma, { get: vi.fn().mockResolvedValue('true') } as any); // bloodBank.bedsideScan.enforce
      mockPrisma.bloodTransfusion.findUnique.mockResolvedValue({
        id: 't-1', status: 'PENDING', patient: { mrn: 'P2026-0001' }, bloodProduct: { unitNumber: 'KRC-2026-0001' },
      });
      await expect(enforceSvc.verifyTransfusion('t-1', 'nurse-1', 'nurse-2')).rejects.toMatchObject({ response: { code: 'BEDSIDE_SCAN_REQUIRED' } });
    });
  });

  describe('startTransfusion', () => {
    it('VERIFIED 상태에서 시작 성공', async () => {
      mockPrisma.bloodTransfusion.findUnique.mockResolvedValue({ ...mockTransfusion, status: 'VERIFIED', verifiedByNurse1: 'n-1', verifiedByNurse2: 'n-2' });
      await service.startTransfusion('t-1');
      expect(mockPrisma.bloodTransfusion.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_PROGRESS' }),
      }));
    });

    it('VERIFIED 아니면(PENDING) 시작 차단', async () => {
      mockPrisma.bloodTransfusion.findUnique.mockResolvedValue({ ...mockTransfusion, status: 'PENDING', verifiedByNurse1: null });
      await expect(service.startTransfusion('t-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeTransfusion', () => {
    it('수혈 완료', async () => {
      mockPrisma.bloodTransfusion.findUnique.mockResolvedValue({ ...mockTransfusion, status: 'IN_PROGRESS' });
      await service.completeTransfusion('t-1', 280);
      expect(mockPrisma.bloodTransfusion.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ volumeTransfused: 280, status: 'COMPLETED' }),
      }));
    });
  });

  describe('reportReaction', () => {
    it('수혈 부작용 보고', async () => {
      await service.reportReaction('t-1', { reactionType: 'FEBRILE', reactionSeverity: 'MODERATE' });
      expect(mockPrisma.bloodTransfusion.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ reactionOccurred: true, status: 'REACTION' }),
      }));
    });
  });

  describe('getDashboard', () => {
    it('대시보드 반환 — 매트릭스는 FE 계약({제제: {"A+": n}}) 객체다', async () => {
      mockPrisma.bloodCrossmatch = { ...mockPrisma.bloodCrossmatch, count: vi.fn().mockResolvedValue(1) };
      const result = await service.getDashboard();
      // 🔴 종전엔 groupBy 배열을 그대로 실어 유형 열에 '0'..'13', 합계에 문자열이 이어붙었다(P11)
      expect(Array.isArray(result.inventoryMatrix)).toBe(false);
      expect(result.inventoryMatrix).toEqual({ RBC: { 'A+': 5 } });
      // 상단 카드 3칸이 읽는 FE 계약 필드 — 종전엔 없어서 전부 '-' 였다
      expect(result).toHaveProperty('totalInventory', 5);
      expect(result).toHaveProperty('todayOrders');
      expect(result).toHaveProperty('pendingCrossmatch');
      expect(result).toHaveProperty('todayStats');
    });
  });

  describe('사전승인 게이트 (TRANSFUSION)', () => {
    it('수혈 오더 발행 시 assertGate(TRANSFUSION) 호출 — 응급은 urgency로 매핑', async () => {
      const gate = { assertGate: vi.fn().mockResolvedValue({ ok: true }) };
      const svc = new BloodBankService(mockPrisma, undefined, gate as any);
      await svc.createTransfusionOrder({ patientId: 'pt-1', productType: 'RBC', units: 1, urgency: 'STAT' } as any, 'u-1');
      expect(gate.assertGate).toHaveBeenCalledWith('TRANSFUSION', expect.objectContaining({ patientId: 'pt-1', emergency: true, priority: 'STAT' }));
      expect(mockPrisma.transfusionOrder.create).toHaveBeenCalled();
    });

    it('게이트 미주입(@Optional)이어도 발행 진행 — 하위호환', async () => {
      await service.createTransfusionOrder({ patientId: 'pt-1', productType: 'RBC', units: 1, urgency: 'ROUTINE' } as any, 'u-1');
      expect(mockPrisma.transfusionOrder.create).toHaveBeenCalled();
    });

    it('게이트가 BLOCK 차단(throw)하면 오더 발행 안 됨', async () => {
      const gate = { assertGate: vi.fn().mockRejectedValue(new Error('PREAUTH_REQUIRED')) };
      const svc = new BloodBankService(mockPrisma, undefined, gate as any);
      mockPrisma.transfusionOrder.create.mockClear();
      await expect(svc.createTransfusionOrder({ patientId: 'pt-1', productType: 'RBC', units: 1, urgency: 'ROUTINE' } as any, 'u-1')).rejects.toThrow(/PREAUTH_REQUIRED/);
      expect(mockPrisma.transfusionOrder.create).not.toHaveBeenCalled();
    });
  });
});
