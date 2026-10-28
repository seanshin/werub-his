import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('InpatientService', () => {
  let service: InpatientService;
  let mockPrisma: any;
  let mockJourney: any;

  beforeEach(() => {
    mockPrisma = {
      bed: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]) },
      nursePatientAssignment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      admission: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      // 활성 식이처방 병합(2026-08-12) — 입원 목록이 영양팀 처방을 우선 표시한다
      // 🔴 2026-08-21: 퇴원 시 활성 식이 처방을 종료한다 → `updateMany` 도 정본 모양에 포함된다
      dietOrder: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      chargeOfCare: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
      bedAssignment: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
      progressNote: { create: vi.fn() },
      clinicalHandoff: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
      round: { create: vi.fn(), findMany: vi.fn() },
      patientJourneyEvent: { findMany: vi.fn() },
      patient: { findUnique: vi.fn() },
      interimBilling: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
      prescription: { findMany: vi.fn().mockResolvedValue([]) }, // 중간정산 처방합산(기본 처방 0)
      order: { count: vi.fn().mockResolvedValue(0) }, // 퇴원 미결 오더 경고(R3-1, 기본 0)
      // 환자 단위 advisory lock(pg_advisory_xact_lock) — 태그드 템플릿 호출이므로 vi.fn()으로 충분
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn((cb: any) => (typeof cb === 'function' ? cb(mockPrisma) : Promise.all(cb))),
    };
    mockJourney = { emit: vi.fn() };
    service = new InpatientService(mockPrisma, mockJourney);
  });

  describe('admit', () => {
    it('should throw BadRequestException if bed not available', async () => {
      mockPrisma.bed.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.admit({ patientId: 'p-1', bedId: 'b-1', doctorId: 'd-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if bed occupied', async () => {
      mockPrisma.bed.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.admit({ patientId: 'p-1', bedId: 'b-1', doctorId: 'd-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should admit patient to available bed', async () => {
      const mockBed = { id: 'b-1', status: 'AVAILABLE', wardId: 'w-1' };
      const mockAdmission = { id: 'adm-1', patientId: 'p-1', bedId: 'b-1', bed: { ward: { name: 'Ward A' } } };

      mockPrisma.bed.findUnique.mockResolvedValue(mockBed);
      mockPrisma.bed.update.mockResolvedValue({ id: 'b-1', status: 'OCCUPIED' });
      mockPrisma.admission.create.mockResolvedValue(mockAdmission);
      mockPrisma.chargeOfCare.create.mockResolvedValue({ id: 'coc-1' });
      mockPrisma.bedAssignment.create.mockResolvedValue({ id: 'ba-1' });

      const result = await service.admit({ patientId: 'p-1', bedId: 'b-1', doctorId: 'd-1' });

      expect(result.id).toBe('adm-1');
      // 병상 비관적 선점(updateMany AVAILABLE→OCCUPIED)
      expect(mockPrisma.bed.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'OCCUPIED' },
      }));
    });

    it('should set default diet type to 일반식', async () => {
      mockPrisma.bed.findUnique.mockResolvedValue({ id: 'b-1', status: 'AVAILABLE' });
      mockPrisma.admission.create.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.chargeOfCare.create.mockResolvedValue({ id: 'coc-1' });
      mockPrisma.bedAssignment.create.mockResolvedValue({ id: 'ba-1' });

      await service.admit({ patientId: 'p-1', bedId: 'b-1', doctorId: 'd-1' });

      expect(mockPrisma.admission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dietType: '일반식',
          }),
        }),
      );
    });

    it('should create chargeOfCare record', async () => {
      mockPrisma.bed.findUnique.mockResolvedValue({ id: 'b-1', status: 'AVAILABLE' });
      mockPrisma.admission.create.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.chargeOfCare.create.mockResolvedValue({ id: 'coc-1' });
      mockPrisma.bedAssignment.create.mockResolvedValue({ id: 'ba-1' });

      await service.admit({ patientId: 'p-1', bedId: 'b-1', doctorId: 'd-1' });

      expect(mockPrisma.chargeOfCare.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admissionId: 'adm-1',
            doctorId: 'd-1',
          }),
        }),
      );
    });

    it('should emit journey event', async () => {
      mockPrisma.bed.findUnique.mockResolvedValue({ id: 'b-1', status: 'AVAILABLE' });
      mockPrisma.admission.create.mockResolvedValue({ id: 'adm-1', bed: { ward: { name: 'Ward A' } } });
      mockPrisma.chargeOfCare.create.mockResolvedValue({ id: 'coc-1' });
      mockPrisma.bedAssignment.create.mockResolvedValue({ id: 'ba-1' });

      await service.admit({ patientId: 'p-1', bedId: 'b-1', doctorId: 'd-1' });

      expect(mockJourney.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'p-1',
          eventType: 'ADMISSION',
        }),
      );
    });
  });

  describe('discharge', () => {
    it('should throw NotFoundException if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(service.discharge('adm-1', 'summary')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if not currently admitted', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1', status: 'DISCHARGED' });

      await expect(service.discharge('adm-1', 'summary')).rejects.toThrow(BadRequestException);
    });

    it('should discharge patient', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1', status: 'ADMITTED', bedId: 'b-1' });
      mockPrisma.bed.update.mockResolvedValue({ id: 'b-1', status: 'AVAILABLE' });
      mockPrisma.chargeOfCare.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.bedAssignment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.admission.update.mockResolvedValue({ id: 'adm-1', status: 'DISCHARGED' });

      const result = await service.discharge('adm-1', 'Patient stable');

      expect(result.status).toBe('DISCHARGED');
      expect(mockPrisma.bed.update).toHaveBeenCalled();
      expect(mockPrisma.chargeOfCare.updateMany).toHaveBeenCalled();
    });
  });

  describe('transfer', () => {
    it('should throw NotFoundException if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(service.transfer('adm-1', 'b-2')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if new bed not available', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1', bedId: 'b-1', status: 'ADMITTED', patientId: 'p-1' });
      mockPrisma.bed.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.transfer('adm-1', 'b-2')).rejects.toThrow(BadRequestException);
    });

    it('should transfer patient to new bed', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1', bedId: 'b-1', status: 'ADMITTED', patientId: 'p-1' });
      mockPrisma.bed.findUnique.mockResolvedValue({ id: 'b-2', status: 'AVAILABLE' });
      mockPrisma.bed.update.mockResolvedValue({});
      mockPrisma.bedAssignment.updateMany.mockResolvedValue({});
      mockPrisma.bedAssignment.create.mockResolvedValue({});
      mockPrisma.admission.update.mockResolvedValue({ id: 'adm-1', bedId: 'b-2' });

      const result = await service.transfer('adm-1', 'b-2', 'ICU upgrade');

      expect(result.bedId).toBe('b-2');
      expect(mockPrisma.bed.updateMany).toHaveBeenCalled(); // 신병상 선점
      // 구병상 반납 — 점유 중일 때만(2026-09-30 전실 정본 transferBedInTx · 청소·정비 중 병상을 가용으로 되돌리지 않는다)
      expect(mockPrisma.bed.updateMany).toHaveBeenCalledWith({ where: { id: expect.any(String), status: 'OCCUPIED' }, data: { status: 'AVAILABLE' } });
    });
  });

  describe('findByPatient', () => {
    it('should return admission history for patient', async () => {
      const mockAdmissions = [
        { id: 'adm-1', patientId: 'p-1', status: 'DISCHARGED' },
        { id: 'adm-2', patientId: 'p-1', status: 'ADMITTED' },
      ];

      mockPrisma.admission.findMany.mockResolvedValue(mockAdmissions);

      const result = await service.findByPatient('p-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.admission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'p-1' },
          orderBy: { admitDate: 'desc' },
        }),
      );
    });

    it('should return empty array if no admissions', async () => {
      mockPrisma.admission.findMany.mockResolvedValue([]);

      const result = await service.findByPatient('p-no-admissions');

      expect(result).toHaveLength(0);
    });
  });

  /**
   * 🔴 환자의 식이가 `admissions.dietType` 과 `diet_orders` 두 곳에 따로 있다.
   *    연결이 없어 고단백식 처방을 받은 환자가 입원 목록에서 식이 `-` 로 보였다(2026-08-12).
   *    **재원 목록 EP 가 둘이라**(`/inpatient`·`/admissions/active/list`) 양쪽 다 병합해야 한다.
   */
  describe('퇴원 시 식이 처방 종료', () => {
    /**
     * 🔴 2026-08-21 운영 실측: 활성 식이 처방 3건이 **전부 퇴원 환자**의 것이었다.
     *    퇴원해도 처방이 닫히지 않으면 재입원 시 옛 처방이 딸려오고,
     *    "활성 식이 처방" 집계가 퇴원 환자까지 세어 실제보다 많아 보인다.
     * 재주입: discharge 트랜잭션의 `dietOrder.updateMany` 를 빼면 이 테스트가 실패한다.
     */
    it('🔴 퇴원하면 그 입원의 활성 식이 처방이 종료된다', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'a1', status: 'ADMITTED', bedId: 'b1', patientId: 'p1' });
      mockPrisma.admission.update.mockResolvedValue({ id: 'a1', status: 'DISCHARGED' });
      await service.discharge('a1', '요약', 'HOME', new Date());
      expect(mockPrisma.dietOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ admissionId: 'a1', isActive: true }),
          data: expect.objectContaining({ isActive: false }),
        }),
      );
    });
  });

  describe('getCurrentAdmissions', () => {
    it('🔴 활성 식이처방을 입원 시 지정보다 우선한다', async () => {
      mockPrisma.admission.findMany.mockResolvedValue([
        { id: 'a1', patientId: 'p1', dietType: 'REGULAR' },
      ]);
      mockPrisma.dietOrder.findMany.mockResolvedValue([{ patientId: 'p1', dietType: 'HIGH_PROTEIN' }]);

      const [row] = await service.getCurrentAdmissions();
      expect(row.dietType).toBe('HIGH_PROTEIN');
      expect(row.dietSource).toBe('ORDER');
    });

    it('should get all admitted patients', async () => {
      const mockAdmissions = [{ id: 'adm-1', status: 'ADMITTED' }];

      mockPrisma.admission.findMany.mockResolvedValue(mockAdmissions);

      const result = await service.getCurrentAdmissions();

      expect(result).toHaveLength(1);
      expect(mockPrisma.admission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ADMITTED' },
        }),
      );
    });
  });

  describe('getAdmission', () => {
    it('should get admission detail', async () => {
      const mockAdmission = { id: 'adm-1', patientId: 'p-1' };

      mockPrisma.admission.findUnique.mockResolvedValue(mockAdmission);

      const result = await service.getAdmission('adm-1');

      expect(result.id).toBe('adm-1');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(service.getAdmission('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addProgressNote', () => {
    it('should create progress note', async () => {
      const mockNote = { id: 'pn-1', content: 'Patient improving' };

      mockPrisma.progressNote.create.mockResolvedValue(mockNote);

      const result = await service.addProgressNote('adm-1', 'd-1', { content: 'Patient improving' });

      expect(result.id).toBe('pn-1');
      expect(mockPrisma.progressNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admissionId: 'adm-1',
            doctorId: 'd-1',
            content: 'Patient improving',
          }),
        }),
      );
    });
  });

  describe('getAttending', () => {
    it('should get current attending doctor', async () => {
      const mockCoc = { id: 'coc-1', doctorId: 'd-1', doctor: { id: 'd-1', familyName: 'Kim' } };

      mockPrisma.chargeOfCare.findFirst.mockResolvedValue(mockCoc);

      const result = await service.getAttending('adm-1');

      expect(result.data).toBeDefined();
    });
  });

  describe('changeAttending', () => {
    it('should throw NotFoundException if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(
        service.changeAttending('adm-1', { newDoctorId: 'd-2', reason: 'Shift change' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should change attending doctor', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1', patientId: 'p-1', attendingDoctorId: 'd-1', admittingDoctorId: 'd-1' });
      mockPrisma.chargeOfCare.updateMany.mockResolvedValue({});
      mockPrisma.chargeOfCare.create.mockResolvedValue({});
      mockPrisma.admission.update.mockResolvedValue({});
      mockPrisma.clinicalHandoff.create.mockResolvedValue({});

      const result = await service.changeAttending('adm-1', { newDoctorId: 'd-2', reason: 'Shift' }, 'user-1');

      expect(result.data.newDoctorId).toBe('d-2');
      expect(mockPrisma.clinicalHandoff.create).toHaveBeenCalled();
    });
  });

  describe('getCareTeam', () => {
    it('should get care team history', async () => {
      const mockHistory = [{ id: 'coc-1', doctorId: 'd-1' }];

      mockPrisma.chargeOfCare.findMany.mockResolvedValue(mockHistory);

      const result = await service.getCareTeam('adm-1');

      expect(result.data).toHaveLength(1);
    });
  });

  describe('createHandoff', () => {
    it('should create clinical handoff', async () => {
      const mockHandoff = { id: 'ho-1', type: 'SHIFT_CHANGE' };

      mockPrisma.clinicalHandoff.create.mockResolvedValue(mockHandoff);

      const result = await service.createHandoff({
        type: 'SHIFT_CHANGE',
        patientId: 'p-1',
        fromDoctorId: 'd-1',
        toDoctorId: 'd-2',
        summary: 'Patient stable',
      });

      expect(result.data.id).toBe('ho-1');
    });
  });

  describe('getHandoffs', () => {
    it('should get patient handoff history', async () => {
      const mockHandoffs = [{ id: 'ho-1', type: 'SHIFT_CHANGE' }];

      mockPrisma.clinicalHandoff.findMany.mockResolvedValue(mockHandoffs);

      const result = await service.getHandoffs('p-1');

      // 이중 래핑 제거(2026-08-12) — 컨트롤러가 `{ data }` 를 씌운다
      expect(result).toHaveLength(1);
    });

    it('🔴 환자·인계자·인수자를 모두 동봉한다(화면이 세 이름을 모두 그린다)', async () => {
      mockPrisma.clinicalHandoff.findMany.mockResolvedValue([]);
      await service.getHandoffs('p-1');
      const include = mockPrisma.clinicalHandoff.findMany.mock.calls[0][0].include;
      expect(Object.keys(include).sort()).toEqual(['fromDoctor', 'patient', 'toDoctor']);
    });
  });

  describe('getRecentHandoffs', () => {
    it('should return recent handoffs with limit', async () => {
      const mockHandoffs = [
        { id: 'ho-1', type: 'SHIFT_CHANGE', createdAt: new Date() },
        { id: 'ho-2', type: 'TRANSFER', createdAt: new Date() },
      ];

      mockPrisma.clinicalHandoff.findMany.mockResolvedValue(mockHandoffs);

      const result = await service.getRecentHandoffs(5);

      expect(result).toHaveLength(2);
      expect(mockPrisma.clinicalHandoff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      );
    });

    it('should include patient and doctor info', async () => {
      mockPrisma.clinicalHandoff.findMany.mockResolvedValue([]);

      await service.getRecentHandoffs(10);

      expect(mockPrisma.clinicalHandoff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            patient: expect.any(Object),
            fromDoctor: expect.any(Object),
            toDoctor: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('acknowledgeHandoff', () => {
    it('should acknowledge handoff', async () => {
      const mockHandoff = { id: 'ho-1', acknowledgedAt: new Date() };

      mockPrisma.clinicalHandoff.findUnique.mockResolvedValue(mockHandoff);

      const result = await service.acknowledgeHandoff('ho-1');

      expect(result.data.id).toBe('ho-1');
      // 🔴 확인 시각은 한 번만 — 조건부 쓰기(acknowledgedAt: null)
      expect(mockPrisma.clinicalHandoff.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ho-1', acknowledgedAt: null } }));
      expect(result.data.alreadyAcknowledged).toBe(false);
    });
  });

  /**
   * 🔴 `toDoctor` 가 include 에 없어 **인수인계 화면이 통째로 크래시**했다
   *    (`Cannot read properties of undefined (reading 'familyName')` · 2026-08-12).
   *    교대 인계는 환자 안전의 핵심인데 화면이 아예 열리지 않았다.
   */
  describe('getPendingHandoffs', () => {
    it('🔴 인수자(toDoctor)를 반드시 동봉한다 — 없으면 화면이 죽는다', async () => {
      mockPrisma.clinicalHandoff.findMany.mockResolvedValue([]);
      await service.getPendingHandoffs('d-1');
      const include = mockPrisma.clinicalHandoff.findMany.mock.calls[0][0].include;
      expect(include.toDoctor, 'toDoctor 누락 — 화면이 크래시한다').toBeTruthy();
      expect(include.fromDoctor).toBeTruthy();
      expect(include.patient).toBeTruthy();
    });

    it('should get unacknowledged handoffs', async () => {
      const mockHandoffs = [{ id: 'ho-1', acknowledgedAt: null }];

      mockPrisma.clinicalHandoff.findMany.mockResolvedValue(mockHandoffs);

      const result = await service.getPendingHandoffs('d-1');

      expect(result).toHaveLength(1);
      expect(mockPrisma.clinicalHandoff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            toDoctorId: 'd-1',
            acknowledgedAt: null,
          }),
        }),
      );
    });
  });

  describe('addRound', () => {
    it('should add round record', async () => {
      const mockRound = { id: 'r-1', roundType: 'MORNING' };

      mockPrisma.round.create.mockResolvedValue(mockRound);

      const result = await service.addRound('adm-1', 'd-1', { roundType: 'MORNING', notes: 'Good progress' });

      expect(result.data.id).toBe('r-1');
      expect(mockPrisma.round.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admissionId: 'adm-1',
            doctorId: 'd-1',
            roundType: 'MORNING',
          }),
        }),
      );
    });
  });

  describe('getRounds', () => {
    it('should get round history', async () => {
      const mockRounds = [{ id: 'r-1', roundType: 'MORNING' }];

      mockPrisma.round.findMany.mockResolvedValue(mockRounds);

      const result = await service.getRounds('adm-1');

      expect(result.data).toHaveLength(1);
    });
  });

  describe('getTodayRounds', () => {
    it('should get today rounds with roundedToday flag', async () => {
      const mockAdmissions = [
        { id: 'adm-1', rounds: [{ roundType: 'MORNING' }] },
        { id: 'adm-2', rounds: [] },
      ];

      mockPrisma.admission.findMany.mockResolvedValue(mockAdmissions);

      const result = await service.getTodayRounds();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].roundedToday).toBe(true);
      expect(result.data[1].roundedToday).toBe(false);
    });
  });

  describe('getBedHistory', () => {
    it('should get bed assignment history', async () => {
      const mockHistory = [{ id: 'ba-1', bedId: 'b-1', reason: 'ADMISSION' }];

      mockPrisma.bedAssignment.findMany.mockResolvedValue(mockHistory);

      const result = await service.getBedHistory('adm-1');

      expect(result.data).toHaveLength(1);
    });
  });

  // 백로그 #6 — 병상 등급별 입원료 일당
  // 2026-10-22 중간정산 산식은 정본 BillingService.quoteInpatientStay 로 옮겼다 — 단가 출처 사슬 시험은 test/inpatient/interim-ledger-v2.spec.ts

  describe('getPatientTimeline', () => {
    it('should get patient timeline events', async () => {
      const mockEvents = [{ id: 'evt-1', eventAt: new Date(), eventType: 'ADMISSION' }];
      const mockPatient = { id: 'p-1', mrn: '12345' };

      mockPrisma.patientJourneyEvent.findMany.mockResolvedValue(mockEvents);
      mockPrisma.patient.findUnique.mockResolvedValue(mockPatient);

      const result = await service.getPatientTimeline('p-1');

      expect(result.data.patient).toBeDefined();
      expect(result.data.events).toHaveLength(1);
      expect(result.data.summary.totalEvents).toBe(1);
    });

    it('should filter by date range', async () => {
      mockPrisma.patientJourneyEvent.findMany.mockResolvedValue([]);
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-1' });

      await service.getPatientTimeline('p-1', '2026-05-01', '2026-05-31');

      expect(mockPrisma.patientJourneyEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });

    it('should calculate timeline summary', async () => {
      const now = new Date();
      const mockEvents = [
        { eventAt: new Date(now.getTime() - 86400000), eventType: 'ADMISSION' },
        { eventAt: now, eventType: 'ROUND' },
      ];

      mockPrisma.patientJourneyEvent.findMany.mockResolvedValue(mockEvents);
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-1' });

      const result = await service.getPatientTimeline('p-1');

      expect(result.data.summary.totalEvents).toBe(2);
      expect(result.data.summary.firstEvent).toBeDefined();
      expect(result.data.summary.lastEvent).toBeDefined();
    });
  });
});
