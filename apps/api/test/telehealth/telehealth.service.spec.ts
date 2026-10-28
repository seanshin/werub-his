import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelehealthService } from '../../src/modules/telehealth/telehealth.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('TelehealthService', () => {
  let service: TelehealthService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      telehealthSession: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        aggregate: vi.fn(),
      },
      encounter: {
        create: vi.fn(),
        findFirst: vi.fn(),
      },
      billing: {
        create: vi.fn(),
      },
      // 🔴 정본이 진찰료 코드를 마스터에서 찾아 라인을 붙인다 — 목이 그 모양을 가져야 한다
      procedureCode: {
        findFirst: vi.fn().mockResolvedValue({ id: 'pc-consult', nameKo: '재진진찰료', unitPrice: 11690 }),
      },
      patient: {
        findFirst: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ insuranceType: 'NHI' }),
      },
      user: {
        findFirst: vi.fn(),
        // 담당의 검증(활성 의사인지)에 쓴다 — 기본은 정상적인 활성 의사
        findUnique: vi.fn().mockResolvedValue({ id: 'd-1', role: 'DOCTOR', isActive: true, department: '내과' }),
      },
      systemConfig: {
        // 비대면 가능 진료과 설정 — 기본은 **미설정 = 전체 허용**
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const mockConfig = { get: vi.fn() };
    const mockEligibility = { resolveCopayRate: vi.fn().mockResolvedValue({ rate: 0.3, copayCategory: 'NHI' }) };
    // 🔴 (G3) 한 트랜잭션으로 묶인 쓰기 — 목은 정본의 실제 호출 모양을 쓴다(tx 는 같은 목 재사용)
    mockPrisma.$transaction = vi.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
    );
    service = new TelehealthService(mockPrisma, mockConfig as never, mockEligibility as never);
  });

  describe('createSession', () => {
    it('should create a telehealth session with roomId', async () => {
      const input = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-29T10:00:00Z', sessionType: 'VIDEO' };
      const mockSession = { id: 'ts-1', ...input, roomId: 'th-abc123', status: 'SCHEDULED' };
      mockPrisma.telehealthSession.create.mockResolvedValue(mockSession);

      const result = await service.createSession(input);
      expect(result.roomId).toBeDefined();
      expect(result.roomId).toMatch(/^th-/);
      expect(mockPrisma.telehealthSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ patientId: 'p-1', sessionType: 'VIDEO', doctorId: 'd-1' }),
        }),
      );
    });

    /**
     * 🔴 이연 회수 T2-5(2026-08-18) — 원내 '새 원격진료' 화면에 담당의 선택이 없어 서버가
     *    **호출자를 담당의로 박았다.** 관리자·간호사가 잡은 예약은 담당의가 본인이 됐고,
     *    그 세션은 어느 의사의 목록에도 뜨지 않는다. 누가 볼지 모르는 예약은 만들지 않는다.
     */
    it('🔴 담당의가 없으면 예약을 만들지 않는다(누가 볼지 모르는 채로 확정 금지)', async () => {
      await expect(
        service.createSession({ patientId: 'p-1', scheduledAt: '2026-05-29T10:00:00Z', sessionType: 'VIDEO' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.telehealthSession.create).not.toHaveBeenCalled();
    });

    it('🔴 의사가 아닌 계정(관리자·간호사)은 담당의가 될 수 없다', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'adm-1', role: 'ADMIN', isActive: true, department: '원무과' });
      await expect(
        service.createSession({ patientId: 'p-1', doctorId: 'adm-1', scheduledAt: '2026-05-29T10:00:00Z', sessionType: 'VIDEO' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.telehealthSession.create).not.toHaveBeenCalled();
    });

    it('퇴직·비활성 의사도 담당의가 될 수 없다', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'd-9', role: 'DOCTOR', isActive: false, department: '내과' });
      await expect(
        service.createSession({ patientId: 'p-1', doctorId: 'd-9', scheduledAt: '2026-05-29T10:00:00Z', sessionType: 'VIDEO' }),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * 🔴 비대면 가능 진료과 설정(`remote-consult.departments`)은 관리자 화면이 "선택한 진료과만
     *    가능합니다"라고 말하는 근거다. 예약 경로가 그 설정을 읽지 않으면 그 문장이 거짓말이 된다.
     */
    it('🔴 설정이 제한 모드면 목록에 없는 진료과는 예약을 거절한다', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue({ value: { enabled: ['가정의학과'], infectiousMode: false } });
      await expect(
        service.createSession({ patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-29T10:00:00Z', sessionType: 'VIDEO' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('설정 미등록(null)은 **전체 허용**이다 — 막지 않는다', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue({ value: { enabled: null, infectiousMode: false } });
      mockPrisma.telehealthSession.create.mockResolvedValue({ id: 'ts-2', roomId: 'th-x' });
      await expect(
        service.createSession({ patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-29T10:00:00Z', sessionType: 'VIDEO' }),
      ).resolves.toBeDefined();
    });
  });

  describe('startSession', () => {
    it('should update status to IN_PROGRESS with startedAt', async () => {
      mockPrisma.telehealthSession.findUnique.mockResolvedValue({
        id: 'ts-1', patientId: 'p-1', doctorId: 'd-1', encounterId: 'enc-0', sessionType: 'VIDEO', chiefComplaint: '두통',
      });
      mockPrisma.telehealthSession.update.mockResolvedValue({ id: 'ts-1', status: 'IN_PROGRESS', startedAt: new Date() });

      const result = await service.startSession('ts-1');
      expect(result.status).toBe('IN_PROGRESS');
      expect(mockPrisma.telehealthSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ts-1' },
          data: expect.objectContaining({ status: 'IN_PROGRESS' }),
        }),
      );
    });

    // 🔴 진료 중 고른 진단·입력한 처방을 붙일 곳이 필요하다 — Encounter 는 시작 시 만들어진다.
    //    종전엔 종료 시에만 생겨서, 진료 중 처방이 화면에만 쌓이다 사라졌다(2026-08-18).
    it('🔴 Encounter 가 없으면 시작 시 만들어 세션에 연결한다(DRAFT)', async () => {
      mockPrisma.telehealthSession.findUnique.mockResolvedValue({
        id: 'ts-1', patientId: 'p-1', doctorId: 'd-1', encounterId: null, sessionType: 'VIDEO', chiefComplaint: '두통',
      });
      mockPrisma.encounter.create.mockResolvedValue({ id: 'enc-new' });
      mockPrisma.telehealthSession.update.mockResolvedValue({ id: 'ts-1', status: 'IN_PROGRESS' });

      await service.startSession('ts-1');
      expect(mockPrisma.encounter.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ patientId: 'p-1', status: 'DRAFT' }) }),
      );
      expect(mockPrisma.telehealthSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ encounterId: 'enc-new' }) }),
      );
    });

    it('이미 Encounter 가 있으면 새로 만들지 않는다(이중 생성 금지)', async () => {
      mockPrisma.telehealthSession.findUnique.mockResolvedValue({
        id: 'ts-1', patientId: 'p-1', doctorId: 'd-1', encounterId: 'enc-0', sessionType: 'VIDEO',
      });
      mockPrisma.encounter.create.mockClear();
      mockPrisma.telehealthSession.update.mockResolvedValue({ id: 'ts-1', status: 'IN_PROGRESS' });

      await service.startSession('ts-1');
      expect(mockPrisma.encounter.create).not.toHaveBeenCalled();
    });
  });

  describe('endSession', () => {
    it('should create Encounter + Billing when no encounterId exists', async () => {
      const session = { id: 'ts-1', patientId: 'p-1', doctorId: 'd-1', encounterId: null, startedAt: new Date(Date.now() - 600000), chiefComplaint: '두통', sessionType: 'VIDEO', patient: { id: 'p-1' } };
      mockPrisma.telehealthSession.findUnique.mockResolvedValue(session);

      const encounter = { id: 'enc-1', patientId: 'p-1' };
      mockPrisma.encounter.create.mockResolvedValue(encounter);
      mockPrisma.encounter.findFirst.mockResolvedValue(null); // first visit → 초진
      mockPrisma.billing.create.mockResolvedValue({ id: 'bill-1' });
      mockPrisma.procedureCode.findFirst.mockResolvedValue({ id: 'pc-aa157', code: 'AA157', nameKo: '초진 진찰료', unitPrice: 16820 });
      mockPrisma.telehealthSession.update.mockResolvedValue({ ...session, status: 'COMPLETED', encounterId: 'enc-1' });

      const result = await service.endSession('ts-1', '진료 완료');

      // Encounter 생성 확인
      expect(mockPrisma.encounter.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'p-1',
            doctorId: 'd-1',
            status: 'SIGNED',
          }),
        }),
      );

      // Billing 생성 확인 — 🔴 (P5-3) 헤더 금액은 라인(수가 마스터 초진 AA157 단가)에서 나온다(종전 하드코딩 21,100)
      expect(mockPrisma.billing.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            encounterId: 'enc-1',
            totalAmount: 16820,
            insuranceCovered: 16820 - Math.round(16820 * 0.3),
          }),
        }),
      );
      // 🔴 (2026-10-20) 진찰료 코드는 종별 정본 — 종별 미설정 = 의원 초진 AA154(종전 상급종합 AA157 고정)
      expect(mockPrisma.procedureCode.findFirst.mock.calls.at(-1)[0].where.code).toBe('AA154');

      expect(result.status).toBe('COMPLETED');
    });

    it('should skip Encounter creation if already linked', async () => {
      const session = { id: 'ts-1', patientId: 'p-1', doctorId: 'd-1', encounterId: 'enc-existing', startedAt: new Date(), sessionType: 'VIDEO', patient: { id: 'p-1' } };
      mockPrisma.telehealthSession.findUnique.mockResolvedValue(session);
      mockPrisma.telehealthSession.update.mockResolvedValue({ ...session, status: 'COMPLETED' });

      await service.endSession('ts-1');

      expect(mockPrisma.encounter.create).not.toHaveBeenCalled();
      expect(mockPrisma.billing.create).not.toHaveBeenCalled();
    });

    it('should calculate duration from startedAt', async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const session = { id: 'ts-1', patientId: 'p-1', doctorId: 'd-1', encounterId: 'enc-1', startedAt: tenMinutesAgo, sessionType: 'VIDEO', patient: { id: 'p-1' } };
      mockPrisma.telehealthSession.findUnique.mockResolvedValue(session);
      mockPrisma.telehealthSession.update.mockImplementation(({ data }: any) => Promise.resolve({ ...session, ...data }));

      const result = await service.endSession('ts-1');
      expect(mockPrisma.telehealthSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ durationMinutes: 10 }),
        }),
      );
    });

    it('should throw NotFoundException for invalid session', async () => {
      mockPrisma.telehealthSession.findUnique.mockResolvedValue(null);
      await expect(service.endSession('ts-none')).rejects.toThrow(NotFoundException);
    });

    it('should set 재진 fee (11,690) if patient has prior encounters', async () => {
      const session = { id: 'ts-1', patientId: 'p-1', doctorId: 'd-1', encounterId: null, startedAt: new Date(), chiefComplaint: '재방문', sessionType: 'VIDEO', patient: { id: 'p-1' } };
      mockPrisma.telehealthSession.findUnique.mockResolvedValue(session);
      mockPrisma.encounter.create.mockResolvedValue({ id: 'enc-2' });
      mockPrisma.encounter.findFirst.mockResolvedValue({ id: 'enc-prev' }); // 기존 진료 있음 → 재진
      mockPrisma.billing.create.mockResolvedValue({ id: 'bill-2' });
      mockPrisma.telehealthSession.update.mockResolvedValue({ ...session, status: 'COMPLETED' });

      await service.endSession('ts-1');

      expect(mockPrisma.billing.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalAmount: 11690 }),
        }),
      );
    });
  });

  describe('cancelSession', () => {
    it('should update status to CANCELLED', async () => {
      mockPrisma.telehealthSession.update.mockResolvedValue({ id: 'ts-1', status: 'CANCELLED' });

      const result = await service.cancelSession('ts-1');
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('patientJoin', () => {
    it('should update status to WAITING', async () => {
      mockPrisma.telehealthSession.update.mockResolvedValue({ id: 'ts-1', status: 'WAITING' });

      const result = await service.patientJoin('ts-1');
      expect(result.status).toBe('WAITING');
    });
  });


  describe('getStats', () => {
    it('should return aggregated statistics', async () => {
      mockPrisma.telehealthSession.count
        .mockResolvedValueOnce(50)   // total
        .mockResolvedValueOnce(30)   // completed
        .mockResolvedValueOnce(5);   // today
      mockPrisma.telehealthSession.aggregate.mockResolvedValue({ _avg: { patientRating: 4.2 } });

      const result = await service.getStats('d-1');
      expect(result.total).toBe(50);
      expect(result.completed).toBe(30);
      expect(result.today).toBe(5);
      expect(result.avgRating).toBe(4.2);
    });
  });

  describe('createDemoSession', () => {
    it('should create demo session with random complaint', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue({ id: 'p-1', familyName: '김', givenName: '영수' });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'd-1', familyName: '이', givenName: '내과', department: '내과' });
      mockPrisma.telehealthSession.create.mockResolvedValue({
        id: 'ts-demo', status: 'WAITING', roomId: 'demo-abc123',
        patient: { familyName: '김', givenName: '영수' },
      });

      const result = await service.createDemoSession('user-1', 'VIDEO');
      expect(result.status).toBe('WAITING');
      expect(result.roomId).toMatch(/^demo-/);
    });

    it('should throw if no patient exists', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue(null);
      await expect(service.createDemoSession('user-1', 'VIDEO')).rejects.toThrow(BadRequestException);
    });
  });

  describe('비동기 진료', () => {
    it('should save patient message and set WAITING', async () => {
      mockPrisma.telehealthSession.update.mockResolvedValue({ id: 'ts-1', status: 'WAITING', patientMessage: '증상 설명' });

      const result = await service.submitPatientMessage('ts-1', '증상 설명');
      expect(result.status).toBe('WAITING');
    });

    it('should save doctor reply and complete', async () => {
      mockPrisma.telehealthSession.update.mockResolvedValue({ id: 'ts-1', status: 'COMPLETED', doctorReply: '처방 안내' });

      const result = await service.submitDoctorReply('ts-1', '처방 안내');
      expect(result.status).toBe('COMPLETED');
    });
  });
});
