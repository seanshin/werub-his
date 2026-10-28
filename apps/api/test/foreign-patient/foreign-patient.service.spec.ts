import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ForeignPatientService } from '../../src/modules/foreign-patient/foreign-patient.service';

// 🔴 (2026-09-13) 이 스펙은 여권·외국인등록번호 암호화 경로(`legacy-pid-crypto`)를 지나는데 `ENCRYPTION_KEY` 를
//    **자기가 주지 않고 같은 워커의 다른 스펙이 흘린 값에 기대고 있었다**(vitest 스레드는 process.env 를 공유한다).
//    테스트 파일이 늘어 실행 순서가 바뀌자 단독·전체 실행 모두에서 실패했다. 테스트 환경만 명시한다(코드 기본값은 그대로).
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'a3f9'.repeat(16);

describe('ForeignPatientService', () => {
  let service: ForeignPatientService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      patient: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      emergencyArrivalNote: {
        create: vi.fn(async ({ data }: any) => ({ id: 'note-1', createdAt: new Date(), ...data })),
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
      user: { findMany: vi.fn(async () => [{ id: 'user-1', familyName: '김', givenName: '간호' }]) },
      emergencyPrenotification: { findUnique: vi.fn(async () => null), update: vi.fn(async ({ data }: any) => data) },
    };
    // 등록은 환자+첫 기록을 한 트랜잭션으로 — 목은 같은 객체를 tx 로 넘긴다(실제 반환 모양과 같게)
    mockPrisma.$transaction = vi.fn(async (fn: any) => fn(mockPrisma));
    service = new ForeignPatientService(mockPrisma);
  });

  describe('registerForeign', () => {
    const baseDto = {
      patientType: 'FOREIGN_TOURIST' as const,
      familyName: 'Smith',
      givenName: 'John',
      nameEn: 'John Smith',
      nationality: 'USA',
      passportNumber: 'M12345678',
      dateOfBirth: '1985-03-15',
      gender: 'MALE' as const,
      preferredLanguage: 'en',
      insuranceType: 'SELF_PAY' as const,
    };

    it('외국인 관광객 등록 성공', async () => {
      mockPrisma.patient.create.mockResolvedValue({ id: 'new-id', mrn: 'FT-260601-ABCD', ...baseDto });

      const result = await service.registerForeign(baseDto, 'user-1');
      expect(result.mrn).toMatch(/^FT-/);
      expect(mockPrisma.patient.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          familyName: 'Smith',
          nationality: 'USA',
          patientSource: 'FOREIGN_TOURIST',
          depositRequired: true,
        }),
      }));
    });

    it('외국인 거주자 MRN 접두어 FR', async () => {
      const dto = { ...baseDto, patientType: 'FOREIGN_RESIDENT' as const, alienRegistrationNo: '000000-0000000' };
      mockPrisma.patient.create.mockImplementation(({ data }: any) => ({ id: 'id', ...data }));

      const result = await service.registerForeign(dto, 'user-1');
      expect(result.mrn).toMatch(/^FR-/);
    });

    it('여권번호 중복 시 BadRequestException', async () => {
      mockPrisma.patient.findFirst.mockResolvedValueOnce({ id: 'existing', mrn: 'FT-001' });

      await expect(service.registerForeign(baseDto, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('여행자 보험 정보 포함', async () => {
      const dto = {
        ...baseDto,
        insuranceType: 'TRAVEL_INSURANCE' as const,
        travelInsurance: { company: 'AIG', policyNo: 'TI-001', contactNo: '+1-800-123' },
      };
      mockPrisma.patient.create.mockImplementation(({ data }: any) => ({ id: 'id', ...data }));

      const result = await service.registerForeign(dto, 'user-1');
      // 🔴 enum 밖 지불보증(여행자보험/대사관/선수금)은 청구상 SELF_PAY 로 강제되지만,
      //    선택 자체는 guaranteeType 으로 보존한다 — 조용히 버리면 보증정보 소실(2026-08-13 W3).
      expect(result.travelInsurance).toEqual({ company: 'AIG', policyNo: 'TI-001', contactNo: '+1-800-123', guaranteeType: 'TRAVEL_INSURANCE' });
      expect(result.insuranceType).toBe('SELF_PAY');
    });
  });

  describe('registerEmergencyUnknown', () => {
    it('응급 미확인 환자 등록 — 임시 ID 부여', async () => {
      mockPrisma.patient.create.mockImplementation(({ data }: any) => ({ id: 'emg-id', ...data }));

      const result = await service.registerEmergencyUnknown({ gender: 'MALE', estimatedAge: 40 }, 'user-1');
      expect(result.mrn).toMatch(/^EMG-/);
      expect(result.familyName).toBe('미확인');
      expect(result.patientSource).toBe('EMERGENCY_UNKNOWN');
    });

    it('최소 정보만으로 등록 가능', async () => {
      mockPrisma.patient.create.mockImplementation(({ data }: any) => ({ id: 'id', ...data }));

      const result = await service.registerEmergencyUnknown({}, 'user-1');
      expect(result.gender).toBe('UNKNOWN');
      expect(result.patientSource).toBe('EMERGENCY_UNKNOWN');
    });
  });

  describe('🔴 도착 상황 기록 — 종전엔 검증 후 버렸다(저장 0)', () => {
    it('옛 필드 arrivalNote·injuryType 도 첫 기록(INITIAL)으로 저장한다 · 한국어 손상 유형은 코드로', async () => {
      mockPrisma.patient.create.mockImplementation(({ data }: any) => ({ id: 'emg-id', ...data }));
      const r = await service.registerEmergencyUnknown({ arrivalNote: '버스정류장에서 쓰러진 채 발견', injuryType: '추락' }, 'user-1');
      expect(mockPrisma.emergencyArrivalNote.create).toHaveBeenCalledTimes(1);
      const data = mockPrisma.emergencyArrivalNote.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ patientId: 'emg-id', kind: 'INITIAL', recordedById: 'user-1', note: '버스정류장에서 쓰러진 채 발견', injuryTypes: ['FALL'] });
      expect(r.arrivalNoteId).toBe('note-1');
    });
    it('구조화 기록 — 모르는 시각은 null(지금으로 채우지 않는다) · 어휘에 없는 옛 손상 유형은 버리지 않고 원문으로 메모에', async () => {
      mockPrisma.patient.create.mockImplementation(({ data }: any) => ({ id: 'p2', ...data }));
      await service.registerEmergencyUnknown({
        injuryType: '감전',
        arrival: { arrivalMode: 'AMBULANCE_119', emsUnit: '가상시119', consciousness: 'PAIN', belongings: [{ item: '휴대전화', custody: 'HOSPITAL_STORED' }, { item: '  ', custody: 'UNKNOWN' }], policeInvolved: true, policeCaseNo: '2026-123' },
      }, 'user-1');
      const data = mockPrisma.emergencyArrivalNote.create.mock.calls[0][0].data;
      expect(data.arrivalAt).toBeNull();
      expect(data.foundAt).toBeNull();
      expect(data).toMatchObject({ arrivalMode: 'AMBULANCE_119', emsUnit: '가상시119', consciousness: 'PAIN', policeInvolved: true, policeCaseNo: '2026-123', note: 'injuryType=감전' });
      expect(data.belongings).toEqual([{ item: '휴대전화', custody: 'HOSPITAL_STORED' }]); // 빈 품목은 뺀다
    });
    it('아무것도 적지 않았으면 빈 기록을 만들지 않는다', async () => {
      mockPrisma.patient.create.mockImplementation(({ data }: any) => ({ id: 'p3', ...data }));
      const r = await service.registerEmergencyUnknown({ gender: 'MALE' }, 'user-1');
      expect(mockPrisma.emergencyArrivalNote.create).not.toHaveBeenCalled();
      expect(r.arrivalNoteId).toBeNull();
    });
    it('추가 기록 — 첫 기록이 있으면 ADDENDUM(덧붙임) · 없으면 INITIAL · 빈 기록은 400 · 없는 환자 404', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p1' });
      mockPrisma.emergencyArrivalNote.count.mockResolvedValueOnce(1);
      await service.addArrivalNote('p1', { note: '경찰 연락 — 실종 신고와 인상착의 일치 가능성' }, 'user-1');
      expect(mockPrisma.emergencyArrivalNote.create.mock.calls[0][0].data).toMatchObject({ kind: 'ADDENDUM', note: '경찰 연락 — 실종 신고와 인상착의 일치 가능성' });
      mockPrisma.emergencyArrivalNote.count.mockResolvedValueOnce(0);
      await service.addArrivalNote('p1', { arrivalMode: 'WALK_IN' }, 'user-1');
      expect(mockPrisma.emergencyArrivalNote.create.mock.calls[1][0].data.kind).toBe('INITIAL');
      await expect(service.addArrivalNote('p1', { note: '   ' }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      mockPrisma.patient.findUnique.mockResolvedValue(null);
      await expect(service.addArrivalNote('none', { note: 'x' }, 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('🔴 사전통보 연결 — 출처로 남기고, 도착 처리는 사람이 고른 경우만 · 취소된 통보 400 · 없는 통보 404', async () => {
      mockPrisma.patient.create.mockImplementation(({ data }: any) => ({ id: 'p9', ...data }));
      mockPrisma.emergencyPrenotification.findUnique.mockResolvedValue({ id: 'pre-1', status: 'EN_ROUTE' });
      // 고르지 않으면 도착 처리하지 않는다
      const r1 = await service.registerEmergencyUnknown({ prenotificationId: 'pre-1', arrival: { arrivalMode: 'AMBULANCE_119' } }, 'user-1');
      expect(mockPrisma.emergencyArrivalNote.create.mock.calls[0][0].data.prenotificationId).toBe('pre-1');
      expect(mockPrisma.emergencyPrenotification.update).not.toHaveBeenCalled();
      expect(r1.prenotificationArrived).toBe(false);
      // 고르면 EN_ROUTE → ARRIVED
      const r2 = await service.registerEmergencyUnknown({ prenotificationId: 'pre-1', markPrenotificationArrived: true, arrival: { note: 'x' } }, 'user-1');
      expect(mockPrisma.emergencyPrenotification.update.mock.calls[0][0].data.status).toBe('ARRIVED');
      expect(r2.prenotificationArrived).toBe(true);
      // 이미 도착 처리된 통보는 건드리지 않는다
      mockPrisma.emergencyPrenotification.findUnique.mockResolvedValue({ id: 'pre-1', status: 'ARRIVED' });
      await service.registerEmergencyUnknown({ prenotificationId: 'pre-1', markPrenotificationArrived: true }, 'user-1');
      expect(mockPrisma.emergencyPrenotification.update).toHaveBeenCalledTimes(1);
      mockPrisma.emergencyPrenotification.findUnique.mockResolvedValue({ id: 'pre-1', status: 'CANCELLED' });
      await expect(service.registerEmergencyUnknown({ prenotificationId: 'pre-1' }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      mockPrisma.emergencyPrenotification.findUnique.mockResolvedValue(null);
      await expect(service.registerEmergencyUnknown({ prenotificationId: 'pre-x' }, 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('목록 — 오래된 순 · 기록자 이름', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p1', patientSource: 'EMERGENCY_UNKNOWN' });
      mockPrisma.emergencyArrivalNote.findMany.mockResolvedValue([{ id: 'n1', kind: 'INITIAL', recordedById: 'user-1' }]);
      const r = await service.listArrivalNotes('p1');
      expect(mockPrisma.emergencyArrivalNote.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
      expect(r.notes[0].recordedByName).toBe('김간호');
      expect(r.patientSource).toBe('EMERGENCY_UNKNOWN');
    });
  });

  describe('identifyPatient', () => {
    it('미확인 환자 신원 확인 성공', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'emg-id', patientSource: 'EMERGENCY_UNKNOWN', metadata: {} });
      mockPrisma.patient.update.mockResolvedValue({ id: 'emg-id', familyName: '김', givenName: '환자', patientSource: 'DOMESTIC' });

      const result = await service.identifyPatient('emg-id', {
        familyName: '김', givenName: '환자', dateOfBirth: '1990-01-01', gender: 'MALE',
      }, 'user-1');

      expect(result.familyName).toBe('김');
      expect(result.patientSource).toBe('DOMESTIC');
    });

    it('미확인 환자가 아니면 BadRequestException', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'normal-id', patientSource: 'DOMESTIC', metadata: {} });

      await expect(service.identifyPatient('normal-id', {
        familyName: '김', givenName: '환자', dateOfBirth: '1990-01-01', gender: 'MALE',
      }, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('존재하지 않는 환자 NotFoundException', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(null);

      await expect(service.identifyPatient('nonexist', {
        familyName: '김', givenName: '환자', dateOfBirth: '1990-01-01', gender: 'MALE',
      }, 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPassportInfo', () => {
    it('여권 정보 조회 성공', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({
        id: 'id', familyName: 'Smith', nationality: 'USA', passportNumber: 'M123',
      });

      const result = await service.getPassportInfo('id');
      expect(result.passportNumber).toBe('M123');
    });

    it('없는 환자 NotFoundException', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(null);
      await expect(service.getPassportInfo('nonexist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('등록 목록 관리', () => {
    it('listForeign — 기본은 보관 제외·외국인 소스만', async () => {
      mockPrisma.patient.findMany = vi.fn().mockResolvedValue([]);
      await service.listForeign({});
      const where = mockPrisma.patient.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(true);
      expect(where.patientSource.in).toContain('FOREIGN_TOURIST');
    });

    it('archiveForeign — isActive=false·archivedAt 스탬프', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-1' });
      mockPrisma.patient.update.mockResolvedValue({ id: 'p-1', isActive: false });
      await service.archiveForeign('p-1', 'u-1');
      expect(mockPrisma.patient.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      );
    });

    it('deleteForeign — 임상 기록 있으면 거부(의무기록 보존)', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({
        mrn: 'FT-1', _count: { encounters: 2, appointments: 0, billings: 0, consentForms: 0 },
      });
      await expect(service.deleteForeign('p-1')).rejects.toThrow();
    });

    it('deleteForeign — 임상 기록 전무하면 삭제 허용', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({
        mrn: 'FT-2', _count: { encounters: 0, appointments: 0, billings: 0, consentForms: 0 },
      });
      mockPrisma.patientContact = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
      mockPrisma.patient.delete = vi.fn().mockResolvedValue({});
      const r = await service.deleteForeign('p-2');
      expect(r.deleted).toBe(true);
      expect(mockPrisma.patient.delete).toHaveBeenCalled();
    });

    it('updateForeign — 여권번호 타 환자 중복 거부', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-1', patientSource: 'FOREIGN_TOURIST' });
      mockPrisma.patient.findFirst.mockResolvedValue({ mrn: 'FT-9' });
      await expect(service.updateForeign('p-1', { passportNumber: 'M111' }, 'u-1')).rejects.toThrow();
    });
  });
});
