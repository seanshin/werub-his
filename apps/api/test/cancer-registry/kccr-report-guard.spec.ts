import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CancerRegistryService } from '../../src/modules/cancer-registry/cancer-registry.service';
import { CancerRegistryController } from '../../src/modules/cancer-registry/cancer-registry.controller';
import { GenerateKccrReportDto } from '../../src/modules/cancer-registry/dto/kccr-report.dto';

/**
 * KCCR(중앙암등록본부) 보고 가드.
 *
 * 🔴 원결함 (운영 실측)
 *  1) 화면이 `apiClient.post(url, { body: JSON.stringify({ids}), headers })` 로 이중 래핑해
 *     서버에는 ids=undefined 가 도착 → 서버가 `{reportedToKccr:false, status:'VERIFIED'}` **전건**을
 *     대상으로 삼아 VERIFIED 3건이 한 번에 봉인됐다(되돌릴 경로 없음).
 *  2) 전송 코드가 없는데 화면은 "KCCR 일괄 보고가 완료되었습니다" 라고 말했다(P16).
 *
 * 이 스펙은 (1) 전건 확대 금지 · (2) 전송했다고 말하지 않기 를 계약으로 고정한다.
 */
describe('KCCR 보고 가드 (전건 확대 금지 · 전송 사칭 금지)', () => {
  let service: CancerRegistryService;
  let mockPrisma: any;

  const patient = {
    id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자',
    dateOfBirth: new Date('1965-03-15'), gender: 'MALE',
  };

  const base = {
    patientId: 'pat-1',
    diagnosisDate: new Date('2026-03-01'),
    primarySite: 'C34.1',
    morphology: '8140/3',
    behavior: '3',
    grade: null,
    laterality: null,
    diagnosisBasis: 'HISTOLOGY',
    icdCode: 'C34.1',
    tnmClinical: 'cT2N1M0',
    tnmPathological: null,
    ajccStage: 'IIIA',
    ajccEdition: 8,
    firstTreatment: 'SURGERY',
    firstTreatmentDate: new Date('2026-04-01'),
    vitalStatus: 'ALIVE',
    lastContactDate: null,
    deathDate: null,
    causeOfDeath: null,
    patient,
    treatments: [],
  };

  /** 전송 근거 컬럼(2026-08-18 신설) — 미전송이면 둘 다 비어 있다 */
  const untransmitted = { kccrTransmittedAt: null, kccrSubmissionId: null };

  const verified = { ...base, ...untransmitted, id: 'reg-1', registrationNo: 'CR-2026-00001', status: 'VERIFIED', reportedToKccr: false };
  const verified2 = { ...base, ...untransmitted, id: 'reg-2', registrationNo: 'CR-2026-00002', status: 'VERIFIED', reportedToKccr: false };
  const registered = { ...base, ...untransmitted, id: 'reg-3', registrationNo: 'CR-2026-00003', status: 'REGISTERED', reportedToKccr: false };
  const alreadyPrepared = { ...base, ...untransmitted, id: 'reg-4', registrationNo: 'CR-2026-00004', status: 'VERIFIED', reportedToKccr: true, kccrSubmissionId: 'LOCAL-KCCR-ABC' };

  beforeEach(() => {
    mockPrisma = {
      cancerRegistry: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        // 원내 접수번호(LOCAL-) 발급용 — 전송이 아니다
        update: vi.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: where.id })),
      },
    };
    service = new CancerRegistryService(mockPrisma, { reference: vi.fn(), getDisclaimer: vi.fn() } as any);
  });

  describe('대상이 비면 전건으로 확대하지 않는다 (fail-closed)', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['빈 배열', []],
      ['배열 아님', 'reg-1'],
    ])('ids=%s 이면 400 으로 거부하고 아무 것도 조회·변경하지 않는다', async (_label, ids) => {
      await expect(service.generateKccrReport(ids as any, { confirm: true })).rejects.toThrow(
        BadRequestException,
      );

      // 🔴 전건 봉인은 되돌릴 수 없다 — 조회조차 하지 않아야 한다
      expect(mockPrisma.cancerRegistry.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.cancerRegistry.updateMany).not.toHaveBeenCalled();
    });

    it('컨트롤러도 빈 ids 를 서비스로 넘기지 않고 거부된다', async () => {
      const controller = new CancerRegistryController(service);

      await expect(
        controller.generateKccrReport({ ids: [], confirm: true } as GenerateKccrReportDto),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.cancerRegistry.updateMany).not.toHaveBeenCalled();
    });

    it('DTO 검증이 빈 ids / 비UUID 를 ValidationPipe 단계에서 막는다', async () => {
      const empty = await validate(plainToInstance(GenerateKccrReportDto, { ids: [] }));
      expect(empty.length).toBeGreaterThan(0);

      const missing = await validate(plainToInstance(GenerateKccrReportDto, { confirm: true }));
      expect(missing.length).toBeGreaterThan(0);

      const notUuid = await validate(plainToInstance(GenerateKccrReportDto, { ids: ['not-a-uuid'] }));
      expect(notUuid.length).toBeGreaterThan(0);

      const ok = await validate(
        plainToInstance(GenerateKccrReportDto, {
          ids: ['3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
          confirm: true,
        }),
      );
      expect(ok).toHaveLength(0);
    });
  });

  describe('확정 표시는 요청한 대상 안에서만', () => {
    it('confirm 없이는 어떤 건도 표시하지 않는다 (자료 생성 ≠ 보고 대상 확정)', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([verified]);

      const result = await service.generateKccrReport(['reg-1']);

      expect(result.count).toBe(1);
      expect(result.confirmed).toBe(false);
      expect(result.preparedCount).toBe(0);
      expect(mockPrisma.cancerRegistry.updateMany).not.toHaveBeenCalled();
    });

    it('confirm=true 여도 요청한 id 만 조회·표시한다', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([verified, verified2]);

      const result = await service.generateKccrReport(['reg-1', 'reg-2', 'reg-1'], { confirm: true });

      // 중복 제거 후 요청 id 로만 조회
      expect(mockPrisma.cancerRegistry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['reg-1', 'reg-2'] } } }),
      );
      expect(mockPrisma.cancerRegistry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['reg-1', 'reg-2'] } },
        data: { reportedToKccr: true },
      });
      expect(result.preparedIds).toEqual(['reg-1', 'reg-2']);
    });

    it('검증 전(REGISTERED) 건은 자료·확정에서 모두 제외한다', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([verified, registered]);

      const result = await service.generateKccrReport(['reg-1', 'reg-3'], { confirm: true });

      expect(result.rows.map((r) => r.registryId)).toEqual(['reg-1']);
      expect(result.skipped).toContainEqual({
        id: 'reg-3', registrationNo: 'CR-2026-00003', reason: 'NOT_VERIFIED',
      });
      expect(mockPrisma.cancerRegistry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['reg-1'] } },
        data: { reportedToKccr: true },
      });
    });

    it('이미 확정된 건은 다시 확정 표시하지 않고 사유를 남긴다', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([alreadyPrepared]);

      const result = await service.generateKccrReport(['reg-4'], { confirm: true });

      expect(result.preparedCount).toBe(0);
      expect(mockPrisma.cancerRegistry.updateMany).not.toHaveBeenCalled();
      expect(result.skipped).toContainEqual({
        id: 'reg-4', registrationNo: 'CR-2026-00004', reason: 'ALREADY_PREPARED',
      });
    });

    // 🔴 가드 — 나가지 않은 건이 한 번의 클릭으로 **영구 미보고**로 굳으면 안 된다.
    //    (external-reporting 의 RESUBMITTABLE 규약과 같은 문제)
    it('확정만 되고 전송되지 않은 건은 자료를 다시 산출할 수 있다(재제출 가능)', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([alreadyPrepared]);

      const result = await service.generateKccrReport(['reg-4'], { confirm: true });

      expect(result.rows.map((r) => r.registryId)).toEqual(['reg-4']);
      expect(result.resubmittable).toBe(true);
      expect(result.rows[0].transmission.resubmittable).toBe(true);
      expect(result.rows[0].transmission.transmitted).toBe(false);
    });

    it('존재하지 않는 id 는 조용히 삼키지 않고 NOT_FOUND 로 보고한다', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([verified]);

      const result = await service.generateKccrReport(['reg-1', 'reg-missing'], { confirm: true });

      expect(result.requested).toBe(2);
      expect(result.count).toBe(1);
      expect(result.skipped).toContainEqual({
        id: 'reg-missing', registrationNo: null, reason: 'NOT_FOUND',
      });
    });
  });

  describe('전송했다고 말하지 않는다', () => {
    it('응답은 항상 NOT_TRANSMITTED 를 실어 보낸다', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([verified]);

      const result = await service.generateKccrReport(['reg-1'], { confirm: true });

      expect(result.transmission.status).toBe('NOT_TRANSMITTED');
      expect(result.transmission.channel).toBeNull();
      // reportedToKccr 는 '전송 완료'가 아니라 '보고 대상 확정(미전송)' 이다
      expect(result.transmission.markMeaning).toBe('PREPARED_NOT_TRANSMITTED');
      expect(result.transmission.note).toContain('전송된 것이 아닙니다');
    });
  });

  describe('previewKccrReport (조회 전용)', () => {
    it('미리보기는 어떤 상태도 바꾸지 않는다', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue(verified);

      const row = await service.previewKccrReport('reg-1');

      expect(row.registrationNo).toBe('CR-2026-00001');
      expect(row.eligible).toBe(true);
      expect(row.transmission.status).toBe('NOT_TRANSMITTED');
      expect(mockPrisma.cancerRegistry.updateMany).not.toHaveBeenCalled();
    });

    it('검증 전 건은 제출 불가 사유를 함께 알린다', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue(registered);

      const row = await service.previewKccrReport('reg-3');

      expect(row.eligible).toBe(false);
      expect(row.ineligibleReason).toBe('NOT_VERIFIED');
    });

    it('없는 건은 404', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue(null);

      await expect(service.previewKccrReport('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
