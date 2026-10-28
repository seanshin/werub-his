import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InfectionControlService } from '../../src/modules/infection-control/infection-control.service';
import { NotFoundException } from '@nestjs/common';
import { IsolationType } from '../../src/modules/infection-control/dto/infection-control.dto';

describe('InfectionControlService', () => {
  let service: InfectionControlService;
  let mockPrisma: any;

  beforeEach(() => {
    const createMockFn = () => ({
      mockResolvedValue: vi.fn().mockName('mockResolvedValue'),
    });

    mockPrisma = {
      patient: {
        findUnique: vi.fn(),
      },
      infectionSurveillance: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      // 병동별 집계는 감지 시점 재원 병동을 본다(하드코딩 {} 제거)
      admission: { findMany: vi.fn().mockResolvedValue([]) },
    };

    service = new InfectionControlService(mockPrisma);
  });

  describe('updateInfectionStatus — status→resolvedAt', () => {
    it('[P2] RESOLVED면 종료일 없어도 resolvedAt 설정(해소 반영)', async () => {
      mockPrisma.infectionSurveillance.findUnique.mockResolvedValue({ id: 'inf-1', notes: '', resolvedAt: null });
      mockPrisma.infectionSurveillance.update.mockResolvedValue({ id: 'inf-1' });
      await service.updateInfectionStatus('inf-1', { status: 'RESOLVED' } as any);
      const arg = mockPrisma.infectionSurveillance.update.mock.calls[0][0];
      expect(arg.data.resolvedAt).toBeInstanceOf(Date);
    });

    it('[P2] 비종말(CONFIRMED) 수정은 resolvedAt=null(활성)', async () => {
      mockPrisma.infectionSurveillance.findUnique.mockResolvedValue({ id: 'inf-1', notes: '', resolvedAt: new Date() });
      mockPrisma.infectionSurveillance.update.mockResolvedValue({ id: 'inf-1' });
      await service.updateInfectionStatus('inf-1', { status: 'CONFIRMED' } as any);
      const arg = mockPrisma.infectionSurveillance.update.mock.calls[0][0];
      expect(arg.data.resolvedAt).toBeNull();
    });
  });

  describe('createInfectionReport', () => {
    it('should create infection report', async () => {
      const dto = {
        patientId: 'pat-1',
        diseaseName: '코로나19',
        confirmationDate: '2026-05-13',
        isolationType: IsolationType.DROPLET,
      };

      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.infectionSurveillance.create.mockResolvedValue({
        id: 'inf-1',
        infectionType: '코로나19',
        patient: { id: 'pat-1', familyName: '김', givenName: '환자' },
      });

      const result = await service.createInfectionReport(dto);
      expect(result.infectionType).toBe('코로나19');
    });

    it('should throw if patient not found', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(null);

      await expect(
        service.createInfectionReport({
          patientId: 'pat-1',
          diseaseName: '코로나19',
          confirmationDate: '2026-05-13',
          isolationType: IsolationType.DROPLET,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getInfectionQueue', () => {
    it('should return active infections', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue([
        {
          id: 'inf-1',
          patientId: 'pat-1',
          patient: { familyName: '김', givenName: '환자' },
          infectionType: '코로나19',
          resolvedAt: null,
          detectedAt: new Date(),
          isolationType: IsolationType.DROPLET,
        },
      ]);

      const result = await service.getInfectionQueue();
      expect(result).toHaveLength(1);
      expect(result[0].patientName).toBe('김환자');
    });
  });

  describe('addContactTrace', () => {
    it('should add contact trace', async () => {
      mockPrisma.patient.findUnique
        .mockResolvedValueOnce({ id: 'pat-1' })
        .mockResolvedValueOnce({ id: 'pat-2' });

      mockPrisma.infectionSurveillance.findFirst
        .mockResolvedValueOnce({ id: 'inf-1', infectionType: '코로나19', organism: 'SARS-CoV-2', resolvedAt: null }) // 지표 감염
        .mockResolvedValueOnce(null); // 기존 미해소 접촉 레코드 없음

      mockPrisma.infectionSurveillance.create.mockResolvedValue({
        id: 'inf-2',
        patientId: 'pat-2',
        infectionType: 'Contact',
      });

      const result = await service.addContactTrace({
        sourcePatientId: 'pat-1',
        contactPersonId: 'pat-2',
        relationshipType: 'FAMILY' as any,
        riskLevel: 'HIGH',
      });

      expect(result.patientId).toBe('pat-2');
      // 🔴 보호구·접촉 시간을 모르면 UNKNOWN — 종전 `PPE: No`(착용 안 함)·`0min` 으로 지어냈다
      const notes = mockPrisma.infectionSurveillance.create.mock.calls.at(-1)[0].data.notes as string;
      expect(notes).toContain('PPE: UNKNOWN');
      expect(notes).toContain('Duration: UNKNOWN');
      expect(notes).not.toContain('undefined');
    });

    it('🔴 같은 접촉자·같은 감염의 미해소 레코드가 있으면 409 CONTACT_ALREADY_REGISTERED(중복 생성 없음)', async () => {
      mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' }).mockResolvedValueOnce({ id: 'pat-2' });
      mockPrisma.infectionSurveillance.findFirst
        .mockResolvedValueOnce({ id: 'inf-1', infectionType: '코로나19', organism: null, resolvedAt: null })
        .mockResolvedValueOnce({ id: 'inf-9' });
      mockPrisma.infectionSurveillance.create.mockClear();
      await expect(service.addContactTrace({ sourcePatientId: 'pat-1', contactPersonId: 'pat-2', relationshipType: 'PATIENT' as any }))
        .rejects.toMatchObject({ response: { code: 'CONTACT_ALREADY_REGISTERED', id: 'inf-9' } });
      expect(mockPrisma.infectionSurveillance.create).not.toHaveBeenCalled();
      const dup = mockPrisma.infectionSurveillance.findFirst.mock.calls.at(-1)[0].where;
      expect(dup).toMatchObject({ patientId: 'pat-2', infectionType: 'Contact Exposure: 코로나19', resolvedAt: null });
    });

    it('일괄 등록은 실패 사유를 함께 낸다(삼키지 않는다)', async () => {
      const spy = vi.spyOn(service, 'addContactTrace')
        .mockResolvedValueOnce({ id: 'x' } as any)
        .mockRejectedValueOnce(Object.assign(new Error('Conflict'), { response: { code: 'CONTACT_ALREADY_REGISTERED' } }));
      const r = await service.addBulkContactTraces({ sourcePatientId: 'pat-1', contactPersonIds: ['a', 'b'], relationshipType: 'PATIENT' as any });
      expect(r).toEqual({ created: 1, total: 2, failed: [{ contactPersonId: 'b', reason: 'CONTACT_ALREADY_REGISTERED' }] });
      spy.mockRestore();
    });
  });

  describe('getInfectionAnalytics', () => {
    /**
     * 🔴 원 결함(W8 이연 회수·2026-08-14): 이 EP 는 `byWard: {}` · `dailyTrend: []` 를
     *    **하드코딩**으로 내보내고 `totalContacts` 는 `activeIsolations` 의 무고지 별칭이었다.
     *    운영 실측: 감시 3건(2026-05-26 · 전부 미해소 · isolationType CONTACT 1건)인데
     *    화면은 "접촉자 3명 · 고위험 접촉 1명 · 병동별 없음 · 추세 없음"이라 말했다.
     */
    const D = (s: string) => new Date(s);
    const rows = [
      { id: 'inf-1', patientId: 'p1', infectionType: 'HAP', organism: 'S. pneumoniae', isolationType: null, detectedAt: D('2026-05-26T08:50:26+09:00'), resolvedAt: null },
      { id: 'inf-2', patientId: 'p2', infectionType: 'CAUTI', organism: 'E. coli', isolationType: IsolationType.CONTACT, detectedAt: D('2026-05-26T08:50:26+09:00'), resolvedAt: null },
      { id: 'inf-3', patientId: 'p3', infectionType: 'SSI', organism: 'S. aureus', isolationType: null, detectedAt: D('2026-05-27T01:00:00+09:00'), resolvedAt: null },
    ];

    it('should calculate statistics', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue([
        {
          id: 'inf-1',
          patientId: 'p1',
          infectionType: '코로나19',
          organism: 'SARS-CoV-2',
          isolationType: IsolationType.DROPLET,
          detectedAt: D('2026-05-26T10:00:00+09:00'),
          resolvedAt: null,
        },
        {
          id: 'inf-2',
          patientId: 'p2',
          infectionType: '코로나19',
          organism: null,
          isolationType: IsolationType.CONTACT,
          detectedAt: D('2026-05-26T10:00:00+09:00'),
          resolvedAt: null,
        },
      ]);

      const result = await service.getInfectionAnalytics();

      expect(result.totalCases).toBe(2);
      expect(result.confirmedCases).toBe(1);
      expect(result.suspectedCases).toBe(1);
    });

    it('🔴 totalContacts 는 activeIsolations 의 별칭이 아니다 — 접촉자 추적 레코드만 센다', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue(rows);

      const result = await service.getInfectionAnalytics();

      expect(result.activeIsolations).toBe(3);
      // 종전 결함이면 3(=activeIsolations)이 나온다
      expect(result.totalContacts).toBe(0);
      expect(result.totalContacts).not.toBe(result.activeIsolations);
      // 접촉자 추적이 0건이면 고위험 접촉도 0 — 감시 레코드의 격리유형을 빌려오지 않는다
      expect(result.highRiskContacts).toBe(0);
      expect(result.contactBasis).toContain('접촉자 추적');
    });

    it('접촉자 추적 레코드가 있으면 그것만 센다', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue([
        ...rows,
        { id: 'c1', patientId: 'p9', infectionType: 'Contact Exposure: CAUTI', organism: 'E. coli', isolationType: 'CONTACT', detectedAt: D('2026-05-27T09:00:00+09:00'), resolvedAt: null },
        { id: 'c2', patientId: 'p8', infectionType: 'Contact Exposure: CAUTI', organism: 'E. coli', isolationType: 'STANDARD', detectedAt: D('2026-05-27T09:00:00+09:00'), resolvedAt: null },
      ]);

      const result = await service.getInfectionAnalytics();

      expect(result.totalContacts).toBe(2);
      expect(result.highRiskContacts).toBe(1); // riskLevel HIGH → CONTACT
    });

    it('🔴 dailyTrend 는 하드코딩 [] 이 아니다 — 감지일(KST)로 실집계, 빈 날은 행을 만들지 않는다', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue(rows);

      const result = await service.getInfectionAnalytics();

      expect(result.dailyTrend).toEqual([
        { date: '2026-05-26', count: 2 },
        { date: '2026-05-27', count: 1 },
      ]);
      expect(result.dailyTrendBasis).toContain('detectedAt');
    });

    it('🔴 byWard 는 하드코딩 {} 이 아니다 — 감지 시점 재원 병동으로 집계한다', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue(rows);
      mockPrisma.admission.findMany.mockResolvedValue([
        { patientId: 'p1', admitDate: D('2026-05-20T00:00:00+09:00'), dischargeDate: null, bed: { ward: { name: '3층 내과병동' } } },
        { patientId: 'p2', admitDate: D('2026-05-01T00:00:00+09:00'), dischargeDate: D('2026-06-01T00:00:00+09:00'), bed: { ward: { name: '3층 내과병동' } } },
        // p3 는 감지 시점 이후 입원 — 이 감지는 병동을 알 수 없다
        { patientId: 'p3', admitDate: D('2026-06-10T00:00:00+09:00'), dischargeDate: null, bed: { ward: { name: '5층 외과병동' } } },
      ]);

      const result = await service.getInfectionAnalytics();

      expect(result.byWard).toEqual({ '3층 내과병동': 2 });
      // 🔴 병동 미상은 아무 병동에나 얹지 않고 분리해 드러낸다
      expect(result.byWardUnknown).toBe(1);
      expect(result.byWardBasis).toContain('detectedAt');
    });

    it('입원 이력이 전혀 없으면 byWard 는 빈 객체 + 전건 미상 — 0 인 병동을 지어내지 않는다', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue(rows);
      mockPrisma.admission.findMany.mockResolvedValue([]);

      const result = await service.getInfectionAnalytics();

      expect(result.byWard).toEqual({});
      expect(result.byWardUnknown).toBe(3);
    });

    it('감시 레코드가 0건이면 입원 조회조차 하지 않는다(빈 IN 쿼리 방지)', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue([]);

      const result = await service.getInfectionAnalytics();

      expect(result.byWard).toEqual({});
      expect(result.byWardUnknown).toBe(0);
      expect(result.dailyTrend).toEqual([]);
      expect(mockPrisma.admission.findMany).not.toHaveBeenCalled();
    });
  });

  describe('detectOutbreakAlert', () => {
    it('detects outbreak', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue(
        Array(5)
          .fill(null)
          .map((_, i) => ({
            id: `inf-${i}`,
            infectionType: '코로나19',
            detectedAt: new Date(),
            resolvedAt: null,
          })),
      );

      const alert = await service.detectOutbreakAlert();
      expect(alert?.type).toBe('OUTBREAK');
    });

    it('returns null without outbreak', async () => {
      mockPrisma.infectionSurveillance.findMany.mockResolvedValue([]);
      const alert = await service.detectOutbreakAlert();
      expect(alert).toBeNull();
    });
  });

  describe('getIsolationProtocol', () => {
    it('returns DROPLET protocol', async () => {
      const protocol = await service.getIsolationProtocol(IsolationType.DROPLET);
      expect(protocol?.standardDurationDays).toBe(5);
      expect(protocol?.requiredPPE).toContain('Surgical mask');
    });

    it('returns STRICT protocol', async () => {
      const protocol = await service.getIsolationProtocol(IsolationType.STRICT);
      expect(protocol?.standardDurationDays).toBe(14);
      expect(protocol?.visitationPolicy).toBe('Prohibited');
    });
  });
});
