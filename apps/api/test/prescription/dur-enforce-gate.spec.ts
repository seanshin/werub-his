import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PrescriptionService } from '../../src/modules/prescription/prescription.service';

/**
 * DUR 강제게이트(dur.enforce OFF|WARN|BLOCK·기본 BLOCK) — 모드별 차단/통과 + GateViolationLog 영속 + copy/repeat 우회 봉인.
 *
 * 🔴 이 스펙은 **게이트만** 검사한다 — DurService 는 목(mock)이다.
 *    즉 "ERROR 경고가 주어지면 막는가"는 보증하지만 "경고가 나오는가"는 아무것도 보증하지 않는다.
 *    탐지기(DurService) 가 죽어 있던 기간 내내 이 스펙은 초록이었다.
 *    탐지 가드: test/prescription/dur-real-vocabulary.spec.ts (실제 서비스 × 실제 약품 어휘)
 */
describe('DUR enforce gate (dur.enforce)', () => {
  let service: PrescriptionService;
  let mockPrisma: any;
  let mockDur: any;
  let mockConfig: any;

  const ERROR_WARNING = { type: 'INTERACTION', severity: 'ERROR', message: '병용금기: A+B' };
  const WARN_WARNING = { type: 'DUPLICATE', severity: 'WARNING', message: '동일성분 중복' };

  beforeEach(() => {
    mockPrisma = {
      encounter: { findUnique: vi.fn() },
      prescription: { findMany: vi.fn() },
      gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(),
    };
    mockDur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    mockConfig = { get: vi.fn().mockResolvedValue(null) };
    service = new PrescriptionService(
      mockPrisma,
      mockDur,
      { emit: vi.fn() } as any, // eventEmitter
      {} as any, // orderService
      mockConfig,
      {} as any, // stepUp
      {} as any, // pushApproval
      { safeLog: vi.fn() } as any, // audit
      {} as any, // preAuthGate
    );
  });

  describe('applyDurGate 모드별 판정', () => {
    const gate = (warnings: any[], override?: { flag?: boolean; reason?: string }) =>
      (service as any).applyDurGate(warnings, { encounterId: 'enc-1', path: 'CREATE', override });

    it('기본(config 미설정)=BLOCK — ERROR 시 차단 + 위반 BLOCK 영속(종전 하드코딩 차단과 동일)', async () => {
      await expect(gate([ERROR_WARNING])).rejects.toThrow(BadRequestException);
      expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gateKey: 'dur.enforce', severity: 'BLOCK', refType: 'ENCOUNTER', refId: 'enc-1' }) }),
      );
    });

    it('WARN — ERROR라도 통과 + 위반 WARN 영속', async () => {
      mockConfig.get.mockResolvedValue('WARN');
      await expect(gate([ERROR_WARNING])).resolves.toBeUndefined();
      expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ severity: 'WARN' }) }),
      );
    });

    it('OFF — 통과하되 OFF 기록(승격 판단용 통계)', async () => {
      mockConfig.get.mockResolvedValue('OFF');
      await expect(gate([ERROR_WARNING])).resolves.toBeUndefined();
      expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ severity: 'OFF' }) }),
      );
    });

    it('BLOCK + override — 통과 + OVERRIDE 영속(감사)', async () => {
      mockConfig.get.mockResolvedValue('BLOCK');
      await expect(gate([ERROR_WARNING], { flag: true, reason: '임상 판단' })).resolves.toBeUndefined();
      expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ severity: 'OVERRIDE' }) }),
      );
    });

    it('🔴 BLOCK + override 인데 사유가 없으면 차단 — 사유 없는 우회는 우회가 아니라 구멍이다', async () => {
      // 2026-09-15 외부 실호출: dur.enforce=BLOCK 에서 `overrideDur: true` 만 보내면 201 이 났고
      // dur_override_reason·dur_override_by 가 모두 NULL 이라 약국·심사가 추적할 근거가 없었다.
      mockConfig.get.mockResolvedValue('BLOCK');
      await expect(gate([ERROR_WARNING], { flag: true })).rejects.toMatchObject({
        response: { code: 'DUR_OVERRIDE_REASON_REQUIRED' },
      });
      await expect(gate([ERROR_WARNING], { flag: true, reason: '   ' })).rejects.toMatchObject({
        response: { code: 'DUR_OVERRIDE_REASON_REQUIRED' },
      });
      // 막힌 것은 BLOCK 으로 센다 — 어휘를 새로 만들지 않는다
      expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ severity: 'BLOCK' }) }),
      );
    });

    it('OFF 모드에서는 사유를 묻지 않는다 — 게이트가 강제하지 않는데 사유만 강요하지 않는다(대조군)', async () => {
      mockConfig.get.mockResolvedValue('OFF');
      await expect(gate([ERROR_WARNING], { flag: true })).resolves.toBeUndefined();
      expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ severity: 'OFF' }) }),
      );
    });

    it('ERROR 없음(WARNING만) — 게이트 미발동·기록 없음', async () => {
      await expect(gate([WARN_WARNING])).resolves.toBeUndefined();
      expect(mockPrisma.gateViolationLog.create).not.toHaveBeenCalled();
      expect(mockConfig.get).not.toHaveBeenCalled();
    });
  });

  describe('copy 경로 우회 봉인', () => {
    beforeEach(() => {
      mockPrisma.encounter.findUnique
        .mockResolvedValueOnce({ id: 'enc-t', patientId: 'p-1' }) // target
        .mockResolvedValueOnce({ id: 'enc-s', patientId: 'p-1' }); // source
      mockPrisma.prescription.findMany.mockResolvedValue([
        { id: 'src-1', type: 'MEDICATION', medicationCodeId: 'm-1', dosage: null, frequency: null, priority: 'ROUTINE' },
      ]);
      vi.spyOn(service as any, 'assertEncounterPrescribable').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'assertPreAuthForOrder').mockResolvedValue({});
    });

    it('copyPrescriptions — ERROR + BLOCK이면 tx 진입 전 차단(종전엔 경고 저장만 하고 통과하던 구멍)', async () => {
      mockDur.checkInteractions.mockResolvedValue([ERROR_WARNING]);
      await expect(service.copyPrescriptions('enc-s', 'enc-t', 'doc-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gateKey: 'dur.enforce', severity: 'BLOCK' }) }),
      );
    });

    it('copyPrescriptions — override 시 통과(OVERRIDE 감사)', async () => {
      mockDur.checkInteractions.mockResolvedValue([ERROR_WARNING]);
      mockPrisma.$transaction.mockResolvedValue([]);
      await service.copyPrescriptions('enc-s', 'enc-t', 'doc-1', undefined, { overrideDur: true, overrideReason: '지속 처방 필요' });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.gateViolationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ severity: 'OVERRIDE' }) }),
      );
    });
  });
});
