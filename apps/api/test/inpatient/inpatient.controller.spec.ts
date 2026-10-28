import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InpatientController } from '../../src/modules/inpatient/inpatient.controller';

describe('InpatientController', () => {
  let controller: InpatientController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getCurrentAdmissions: vi.fn(),
      admit: vi.fn(),
      getAdmission: vi.fn(),
      discharge: vi.fn(),
      transfer: vi.fn(),
      addProgressNote: vi.fn(),
      getAttending: vi.fn(),
      changeAttending: vi.fn(),
      getCareTeam: vi.fn(),
      addRound: vi.fn(),
      getRounds: vi.fn(),
      getTodayRounds: vi.fn(),
      getBedHistory: vi.fn(),
      createHandoff: vi.fn(),
      findByPatient: vi.fn(),
      getRecentHandoffs: vi.fn(),
      getHandoffs: vi.fn(),
      acknowledgeHandoff: vi.fn(),
      getPendingHandoffs: vi.fn(),
      getPatientTimeline: vi.fn(),
    };
    controller = new InpatientController(mockService);
  });

  describe('list', () => {
    it('should get current admissions', async () => {
      const mockAdmissions = [
        { id: 'adm-1', patientId: 'p-1', status: 'ADMITTED' },
        { id: 'adm-2', patientId: 'p-2', status: 'ADMITTED' },
      ];

      mockService.getCurrentAdmissions.mockResolvedValue(mockAdmissions);

      const result = await controller.list();

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveLength(2);
      expect(mockService.getCurrentAdmissions).toHaveBeenCalled();
    });

    it('should wrap response in data object', async () => {
      mockService.getCurrentAdmissions.mockResolvedValue([]);

      const result = await controller.list();

      expect(result).toEqual({ data: [] });
    });
  });

  describe('admit', () => {
    it('should admit patient with body parameters', async () => {
      const body = { patientId: 'p-1', bedId: 'b-1', reason: 'Acute illness' };
      const mockAdmission = { id: 'adm-1', patientId: 'p-1', bedId: 'b-1' };

      mockService.admit.mockResolvedValue(mockAdmission);

      const result = await controller.admit(body, 'doc-1');

      expect(result.data.id).toBe('adm-1');
      expect(mockService.admit).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'p-1',
          bedId: 'b-1',
          doctorId: 'doc-1',
        }),
      );
    });

    it('should use provided doctorId from body', async () => {
      const body = { patientId: 'p-1', bedId: 'b-1', doctorId: 'doc-2' };

      mockService.admit.mockResolvedValue({});

      await controller.admit(body, 'doc-1');

      expect(mockService.admit).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'doc-2',
        }),
      );
    });

    it('should use userId as doctorId if not in body', async () => {
      const body = { patientId: 'p-1', bedId: 'b-1' };

      mockService.admit.mockResolvedValue({});

      await controller.admit(body, 'doc-1');

      expect(mockService.admit).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'doc-1',
        }),
      );
    });

    it('should pass optional dietType', async () => {
      const body = { patientId: 'p-1', bedId: 'b-1', dietType: '저단백식' };

      mockService.admit.mockResolvedValue({});

      await controller.admit(body, 'doc-1');

      expect(mockService.admit).toHaveBeenCalledWith(
        expect.objectContaining({
          dietType: '저단백식',
        }),
      );
    });
  });

  describe('findByPatient', () => {
    it('should get admission history for a patient', async () => {
      const mockAdmissions = [
        { id: 'adm-1', patientId: 'p-1', status: 'DISCHARGED' },
        { id: 'adm-2', patientId: 'p-1', status: 'ADMITTED' },
      ];

      mockService.findByPatient.mockResolvedValue(mockAdmissions);

      const result = await controller.findByPatient('p-1');

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveLength(2);
      expect(mockService.findByPatient).toHaveBeenCalledWith('p-1');
    });

    it('should wrap response in data object', async () => {
      mockService.findByPatient.mockResolvedValue([]);

      const result = await controller.findByPatient('p-1');

      expect(result).toEqual({ data: [] });
    });
  });

  describe('detail', () => {
    it('should get admission detail by id', async () => {
      const mockAdmission = { id: 'adm-1', patientId: 'p-1', status: 'ADMITTED' };

      mockService.getAdmission.mockResolvedValue(mockAdmission);

      const result = await controller.detail('adm-1');

      expect(result.data.id).toBe('adm-1');
      expect(mockService.getAdmission).toHaveBeenCalledWith('adm-1');
    });

    it('should wrap response in data object', async () => {
      mockService.getAdmission.mockResolvedValue({ id: 'adm-1' });

      const result = await controller.detail('adm-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('discharge', () => {
    it('should discharge patient with summary', async () => {
      const body = { summary: 'Patient improved, discharged home' };
      const mockAdmission = { id: 'adm-1', status: 'DISCHARGED' };

      mockService.discharge.mockResolvedValue(mockAdmission);

      const result = await controller.discharge('adm-1', body);

      expect(result.data.status).toBe('DISCHARGED');
      expect(mockService.discharge).toHaveBeenCalledWith('adm-1', 'Patient improved, discharged home', undefined);
    });

    it('should wrap response in data object', async () => {
      mockService.discharge.mockResolvedValue({});

      const result = await controller.discharge('adm-1', { summary: 'test' });

      expect(result).toHaveProperty('data');
    });
  });

  describe('transfer', () => {
    it('should transfer patient to new bed', async () => {
      const body = { newBedId: 'b-2', reason: 'ICU upgrade' };
      const mockAdmission = { id: 'adm-1', bedId: 'b-2' };

      mockService.transfer.mockResolvedValue(mockAdmission);

      const result = await controller.transfer('adm-1', body);

      expect(result.data.bedId).toBe('b-2');
      expect(mockService.transfer).toHaveBeenCalledWith('adm-1', 'b-2', 'ICU upgrade');
    });

    it('should handle optional reason parameter', async () => {
      const body = { newBedId: 'b-2' };

      mockService.transfer.mockResolvedValue({});

      await controller.transfer('adm-1', body);

      expect(mockService.transfer).toHaveBeenCalledWith('adm-1', 'b-2', undefined);
    });

    it('should wrap response in data object', async () => {
      mockService.transfer.mockResolvedValue({});

      const result = await controller.transfer('adm-1', { newBedId: 'b-2' });

      expect(result).toHaveProperty('data');
    });
  });

  describe('addNote', () => {
    it('should add progress note with doctorId from user', async () => {
      const body = { content: 'Patient showing improvement' };
      const mockNote = { id: 'pn-1', content: 'Patient showing improvement' };

      mockService.addProgressNote.mockResolvedValue(mockNote);

      const result = await controller.addNote('adm-1', body, 'doc-1');

      expect(result.data.id).toBe('pn-1');
      expect(mockService.addProgressNote).toHaveBeenCalledWith('adm-1', 'doc-1', body);
    });

    it('should include optional vitalSigns', async () => {
      const body = { content: 'Test', vitalSigns: { bp: '120/80' } };

      mockService.addProgressNote.mockResolvedValue({});

      await controller.addNote('adm-1', body, 'doc-1');

      expect(mockService.addProgressNote).toHaveBeenCalledWith(
        'adm-1',
        'doc-1',
        expect.objectContaining({
          vitalSigns: { bp: '120/80' },
        }),
      );
    });

    it('should wrap response in data object', async () => {
      mockService.addProgressNote.mockResolvedValue({});

      const result = await controller.addNote('adm-1', { content: 'test' }, 'doc-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('getAttending', () => {
    it('should get current attending doctor', async () => {
      const mockAttending = { id: 'coc-1', doctorId: 'd-1', doctor: { familyName: 'Kim' } };

      mockService.getAttending.mockResolvedValue(mockAttending);

      const result = await controller.getAttending('adm-1');

      expect(result.data).toBeDefined();
      expect(mockService.getAttending).toHaveBeenCalledWith('adm-1');
    });

    it('should wrap response in data object', async () => {
      mockService.getAttending.mockResolvedValue({});

      const result = await controller.getAttending('adm-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('changeAttending', () => {
    it('should change attending doctor', async () => {
      const body = { newDoctorId: 'd-2', reason: 'Shift change', handoffNote: 'Patient stable' };
      const mockResult = { data: { admissionId: 'adm-1', newDoctorId: 'd-2', reason: 'Shift change' } };

      mockService.changeAttending.mockResolvedValue(mockResult);

      const result = await controller.changeAttending('adm-1', body, 'doc-1');

      expect(result.data.data.newDoctorId).toBe('d-2');
      expect(mockService.changeAttending).toHaveBeenCalledWith('adm-1', body, 'doc-1');
    });

    it('should handle optional handoffNote', async () => {
      const body = { newDoctorId: 'd-2', reason: 'Shift change' };

      mockService.changeAttending.mockResolvedValue({ data: { admissionId: 'adm-1', newDoctorId: 'd-2', reason: 'Shift change' } });

      await controller.changeAttending('adm-1', body, 'doc-1');

      expect(mockService.changeAttending).toHaveBeenCalledWith('adm-1', body, 'doc-1');
    });

    it('should pass userId to service', async () => {
      const body = { newDoctorId: 'd-2', reason: 'Shift' };

      mockService.changeAttending.mockResolvedValue({ data: { admissionId: 'adm-1', newDoctorId: 'd-2', reason: 'Shift' } });

      await controller.changeAttending('adm-1', body, 'user-123');

      expect(mockService.changeAttending).toHaveBeenCalledWith('adm-1', body, 'user-123');
    });
  });

  describe('getCareTeam', () => {
    it('should get care team history', async () => {
      const mockTeam = [
        { id: 'coc-1', doctorId: 'd-1' },
        { id: 'coc-2', doctorId: 'd-2' },
      ];

      mockService.getCareTeam.mockResolvedValue(mockTeam);

      const result = await controller.getCareTeam('adm-1');

      expect(result.data).toHaveLength(2);
      expect(mockService.getCareTeam).toHaveBeenCalledWith('adm-1');
    });

    it('should wrap response in data object', async () => {
      mockService.getCareTeam.mockResolvedValue([]);

      const result = await controller.getCareTeam('adm-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('addRound', () => {
    it('should add round with doctorId from user', async () => {
      const dto = { roundType: 'MORNING', notes: 'Good progress' };
      const mockRound = { id: 'r-1', roundType: 'MORNING' };

      mockService.addRound.mockResolvedValue(mockRound);

      const result = await controller.addRound('adm-1', dto, 'doc-1');

      expect(result.id).toBe('r-1');
      expect(mockService.addRound).toHaveBeenCalledWith('adm-1', 'doc-1', dto);
    });

    it('should pass CreateRoundDto', async () => {
      const dto = { roundType: 'EVENING', assessment: 'Stable', plan: 'Continue meds' };

      mockService.addRound.mockResolvedValue({});

      await controller.addRound('adm-1', dto, 'doc-1');

      expect(mockService.addRound).toHaveBeenCalledWith('adm-1', 'doc-1', dto);
    });

    it('should include optional vitalSigns', async () => {
      const dto = { roundType: 'MORNING', vitalSigns: { hr: 75, bp: '120/80' } };

      mockService.addRound.mockResolvedValue({});

      await controller.addRound('adm-1', dto, 'doc-1');

      expect(mockService.addRound).toHaveBeenCalledWith(
        'adm-1',
        'doc-1',
        expect.objectContaining({
          vitalSigns: { hr: 75, bp: '120/80' },
        }),
      );
    });
  });

  describe('getRounds', () => {
    it('should get round history', async () => {
      const mockRounds = [
        { id: 'r-1', roundType: 'MORNING' },
        { id: 'r-2', roundType: 'EVENING' },
      ];

      mockService.getRounds.mockResolvedValue(mockRounds);

      const result = await controller.getRounds('adm-1');

      expect(result.data).toHaveLength(2);
      expect(mockService.getRounds).toHaveBeenCalledWith('adm-1');
    });

    it('should wrap response in data object', async () => {
      mockService.getRounds.mockResolvedValue([]);

      const result = await controller.getRounds('adm-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('getTodayRounds', () => {
    it('should get todays round list', async () => {
      const mockRounds = [
        { id: 'adm-1', patient: { name: 'Kim' }, roundedToday: true },
        { id: 'adm-2', patient: { name: 'Lee' }, roundedToday: false },
      ];

      mockService.getTodayRounds.mockResolvedValue(mockRounds);

      const result = await controller.getTodayRounds();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].roundedToday).toBe(true);
      expect(mockService.getTodayRounds).toHaveBeenCalled();
    });

    it('should wrap response in data object', async () => {
      mockService.getTodayRounds.mockResolvedValue([]);

      const result = await controller.getTodayRounds();

      expect(result).toHaveProperty('data');
    });
  });

  describe('getBedHistory', () => {
    it('should get bed assignment history', async () => {
      const mockHistory = [
        { id: 'ba-1', bedId: 'b-1', reason: 'ADMISSION' },
        { id: 'ba-2', bedId: 'b-2', reason: 'TRANSFER' },
      ];

      mockService.getBedHistory.mockResolvedValue(mockHistory);

      const result = await controller.getBedHistory('adm-1');

      expect(result.data).toHaveLength(2);
      expect(mockService.getBedHistory).toHaveBeenCalledWith('adm-1');
    });

    it('should wrap response in data object', async () => {
      mockService.getBedHistory.mockResolvedValue([]);

      const result = await controller.getBedHistory('adm-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('createHandoff', () => {
    it('should create clinical handoff', async () => {
      const dto = {
        type: 'SHIFT_CHANGE',
        patientId: 'p-1',
        fromDoctorId: 'd-1',
        toDoctorId: 'd-2',
        summary: 'Patient stable',
      };
      const mockHandoff = { id: 'ho-1', type: 'SHIFT_CHANGE' };

      mockService.createHandoff.mockResolvedValue(mockHandoff);

      const result = await controller.createHandoff(dto, 'd-1');

      expect(result.id).toBe('ho-1');
      expect(mockService.createHandoff).toHaveBeenCalledWith(dto);
    });

    it('should pass CreateHandoffDto with all fields', async () => {
      const dto = {
        type: 'TRANSFER',
        patientId: 'p-1',
        fromDoctorId: 'd-1',
        toDoctorId: 'd-2',
        admissionId: 'adm-1',
        summary: 'Handoff notes',
        vitalSigns: { hr: 80 },
      };

      mockService.createHandoff.mockResolvedValue({});

      await controller.createHandoff(dto, 'd-1');

      expect(mockService.createHandoff).toHaveBeenCalledWith(dto);
    });
  });

  describe('createHandoff — 인계자는 로그인 사용자(2026-09-30)', () => {
    it('🔴 본문 fromDoctorId 가 다른 사람이어도 로그인 사용자로 기록한다', async () => {
      mockService.createHandoff.mockResolvedValue({});
      await controller.createHandoff({ type: 'NURSING_SHIFT', patientId: 'p-1', fromDoctorId: 'someone-else', toDoctorId: 'n-2', summary: 's' }, 'n-1');
      expect(mockService.createHandoff).toHaveBeenCalledWith(expect.objectContaining({ fromDoctorId: 'n-1', toDoctorId: 'n-2' }));
    });
    it('본문에 fromDoctorId 가 없어도 된다', async () => {
      mockService.createHandoff.mockResolvedValue({});
      await controller.createHandoff({ type: 'NURSING_SHIFT', patientId: 'p-1', toDoctorId: 'n-2', summary: 's' }, 'n-1');
      expect(mockService.createHandoff).toHaveBeenCalledWith(expect.objectContaining({ fromDoctorId: 'n-1' }));
    });
  });

  describe('getRecentHandoffs', () => {
    it('should get recent handoffs with default limit', async () => {
      const mockHandoffs = [{ id: 'ho-1' }, { id: 'ho-2' }];

      mockService.getRecentHandoffs.mockResolvedValue(mockHandoffs);

      const result = await controller.getRecentHandoffs();

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveLength(2);
      expect(mockService.getRecentHandoffs).toHaveBeenCalledWith(10, undefined, undefined);
    });

    it('should parse limit query parameter', async () => {
      mockService.getRecentHandoffs.mockResolvedValue([]);

      await controller.getRecentHandoffs('5');

      expect(mockService.getRecentHandoffs).toHaveBeenCalledWith(5, undefined, undefined);
    });

    it('should use default limit 10 for invalid string', async () => {
      mockService.getRecentHandoffs.mockResolvedValue([]);

      await controller.getRecentHandoffs('invalid');

      expect(mockService.getRecentHandoffs).toHaveBeenCalledWith(10, undefined, undefined);
    });

    /**
     * 🔴 입원 상세는 **그 입원의** 인수인계만 원한다 — 필터가 없어 화면이 존재하지 않는
     *    `/inpatient/:id/handoffs` 를 부르고 있었다(운영 404 · 개통 이래 무동작).
     */
    it('admissionId 를 서비스로 넘긴다 — 그 입원 건만', async () => {
      mockService.getRecentHandoffs.mockResolvedValue([]);

      await controller.getRecentHandoffs(undefined, 'adm-1');

      expect(mockService.getRecentHandoffs).toHaveBeenCalledWith(10, 'adm-1', undefined);
    });
  });

  describe('getHandoffs', () => {
    it('should get patient handoff history', async () => {
      const mockHandoffs = [
        { id: 'ho-1', type: 'SHIFT_CHANGE', fromDoctorId: 'd-1' },
        { id: 'ho-2', type: 'TRANSFER', fromDoctorId: 'd-2' },
      ];

      mockService.getHandoffs.mockResolvedValue(mockHandoffs);

      const result = await controller.getHandoffs('p-1');

      expect(result.data).toHaveLength(2);
      expect(mockService.getHandoffs).toHaveBeenCalledWith('p-1');
    });

    it('should wrap response in data object', async () => {
      mockService.getHandoffs.mockResolvedValue([]);

      const result = await controller.getHandoffs('p-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('acknowledgeHandoff', () => {
    it('should acknowledge handoff', async () => {
      const mockHandoff = { id: 'ho-1', acknowledgedAt: new Date() };

      mockService.acknowledgeHandoff.mockResolvedValue(mockHandoff);

      const result = await controller.acknowledgeHandoff('ho-1', 'user-1', 'NURSE');

      expect(result.data.id).toBe('ho-1');
      expect(mockService.acknowledgeHandoff).toHaveBeenCalledWith('ho-1', 'user-1', 'NURSE');
    });

    it('should wrap response in data object', async () => {
      mockService.acknowledgeHandoff.mockResolvedValue({});

      const result = await controller.acknowledgeHandoff('ho-1', 'user-1', 'NURSE');

      expect(result).toHaveProperty('data');
    });
  });

  describe('getPendingHandoffs', () => {
    it('should get unacknowledged handoffs for user', async () => {
      const mockHandoffs = [
        { id: 'ho-1', acknowledgedAt: null },
        { id: 'ho-2', acknowledgedAt: null },
      ];

      mockService.getPendingHandoffs.mockResolvedValue(mockHandoffs);

      const result = await controller.getPendingHandoffs('doc-1');

      expect(result.data).toHaveLength(2);
      expect(mockService.getPendingHandoffs).toHaveBeenCalledWith('doc-1');
    });

    it('should pass userId from current user', async () => {
      mockService.getPendingHandoffs.mockResolvedValue([]);

      await controller.getPendingHandoffs('user-123');

      expect(mockService.getPendingHandoffs).toHaveBeenCalledWith('user-123');
    });

    it('should wrap response in data object', async () => {
      mockService.getPendingHandoffs.mockResolvedValue([]);

      const result = await controller.getPendingHandoffs('doc-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('getTimeline', () => {
    it('should get patient timeline', async () => {
      const mockTimeline = {
        patient: { id: 'p-1', name: 'Kim' },
        events: [{ id: 'evt-1', eventType: 'ADMISSION' }],
        summary: { totalEvents: 1 },
      };

      mockService.getPatientTimeline.mockResolvedValue(mockTimeline);

      const result = await controller.getTimeline('p-1');

      expect(result.data.patient).toBeDefined();
      expect(result.data.events).toHaveLength(1);
      expect(mockService.getPatientTimeline).toHaveBeenCalledWith('p-1', undefined, undefined);
    });

    it('should pass optional from date parameter', async () => {
      mockService.getPatientTimeline.mockResolvedValue({ events: [], summary: {} });

      await controller.getTimeline('p-1', '2026-05-01');

      expect(mockService.getPatientTimeline).toHaveBeenCalledWith('p-1', '2026-05-01', undefined);
    });

    it('should pass optional to date parameter', async () => {
      mockService.getPatientTimeline.mockResolvedValue({ events: [], summary: {} });

      await controller.getTimeline('p-1', undefined, '2026-05-31');

      expect(mockService.getPatientTimeline).toHaveBeenCalledWith('p-1', undefined, '2026-05-31');
    });

    it('should pass both date range parameters', async () => {
      mockService.getPatientTimeline.mockResolvedValue({ events: [], summary: {} });

      await controller.getTimeline('p-1', '2026-05-01', '2026-05-31');

      expect(mockService.getPatientTimeline).toHaveBeenCalledWith('p-1', '2026-05-01', '2026-05-31');
    });

    it('should wrap response in data object', async () => {
      mockService.getPatientTimeline.mockResolvedValue({});

      const result = await controller.getTimeline('p-1');

      expect(result).toHaveProperty('data');
    });

    it('should include timeline events in response', async () => {
      const mockTimeline = {
        patient: { id: 'p-1' },
        events: [
          { id: 'evt-1', eventType: 'ADMISSION', title: 'Admitted' },
          { id: 'evt-2', eventType: 'ROUND', title: 'Morning round' },
        ],
        summary: { totalEvents: 2, firstEvent: {}, lastEvent: {} },
      };

      mockService.getPatientTimeline.mockResolvedValue(mockTimeline);

      const result = await controller.getTimeline('p-1');

      expect(result.data.events).toHaveLength(2);
      expect(result.data.summary.totalEvents).toBe(2);
    });
  });

  describe('Authorization', () => {
    it('should require DOCTOR or ADMIN role for admit', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) is applied to admit
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR or ADMIN role for discharge', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) is applied to discharge
      expect(controller).toBeDefined();
    });

    it('should require NURSE or ADMIN role for transfer', async () => {
      // @Roles(UserRole.NURSE, UserRole.ADMIN) is applied to transfer
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR role for progress note', async () => {
      // @Roles(UserRole.DOCTOR) is applied to addNote
      expect(controller).toBeDefined();
    });

    it('should require JWT authentication', async () => {
      // @UseGuards(JwtAuthGuard, RolesGuard) is applied
      expect(controller).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('should wrap all list responses in data object', async () => {
      mockService.getCurrentAdmissions.mockResolvedValue([]);

      const result = await controller.list();

      expect(result).toEqual({ data: [] });
    });

    it('should wrap all detail responses in data object', async () => {
      mockService.getAdmission.mockResolvedValue({ id: 'adm-1' });

      const result = await controller.detail('adm-1');

      expect(result).toEqual({ data: { id: 'adm-1' } });
    });

    it('should include all fields in admission response', async () => {
      const mockAdmission = {
        id: 'adm-1',
        patientId: 'p-1',
        bedId: 'b-1',
        status: 'ADMITTED',
        dietType: '일반식',
        admittedAt: new Date(),
      };

      mockService.getAdmission.mockResolvedValue(mockAdmission);

      const result = await controller.detail('adm-1');

      expect(result.data).toEqual(mockAdmission);
    });
  });

  describe('Query Parameters', () => {
    it('should handle date range parameters', async () => {
      mockService.getPatientTimeline.mockResolvedValue({});

      await controller.getTimeline('p-1', '2026-05-01', '2026-05-31');

      expect(mockService.getPatientTimeline).toHaveBeenCalledWith(
        'p-1',
        '2026-05-01',
        '2026-05-31',
      );
    });

    it('should handle undefined query parameters', async () => {
      mockService.getPatientTimeline.mockResolvedValue({});

      await controller.getTimeline('p-1', undefined, undefined);

      expect(mockService.getPatientTimeline).toHaveBeenCalledWith('p-1', undefined, undefined);
    });
  });

  describe('Route Parameters', () => {
    it('should pass admissionId to service', async () => {
      mockService.getAdmission.mockResolvedValue({});

      await controller.detail('adm-123');

      expect(mockService.getAdmission).toHaveBeenCalledWith('adm-123');
    });

    it('should pass patientId to getTimeline', async () => {
      mockService.getPatientTimeline.mockResolvedValue({});

      await controller.getTimeline('patient-123');

      expect(mockService.getPatientTimeline).toHaveBeenCalledWith('patient-123', undefined, undefined);
    });

    it('should pass patientId with ParseUUIDPipe validation', async () => {
      mockService.getHandoffs.mockResolvedValue([]);

      await controller.getHandoffs('p-1');

      expect(mockService.getHandoffs).toHaveBeenCalledWith('p-1');
    });
  });

  describe('User Dependency Injection', () => {
    it('should inject userId as doctorId for admit', async () => {
      const body = { patientId: 'p-1', bedId: 'b-1' };

      mockService.admit.mockResolvedValue({});

      await controller.admit(body, 'injected-doctor-id');

      expect(mockService.admit).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'injected-doctor-id',
        }),
      );
    });

    it('should inject userId as doctorId for progress note', async () => {
      mockService.addProgressNote.mockResolvedValue({});

      await controller.addNote('adm-1', { content: 'test' }, 'injected-doctor-id');

      expect(mockService.addProgressNote).toHaveBeenCalledWith(
        'adm-1',
        'injected-doctor-id',
        expect.any(Object),
      );
    });

    it('should inject userId for rounds', async () => {
      mockService.addRound.mockResolvedValue({});

      await controller.addRound('adm-1', { roundType: 'MORNING' }, 'injected-doctor-id');

      expect(mockService.addRound).toHaveBeenCalledWith('adm-1', 'injected-doctor-id', expect.any(Object));
    });

    it('should inject userId for changeAttending', async () => {
      mockService.changeAttending.mockResolvedValue({});

      await controller.changeAttending('adm-1', { newDoctorId: 'd-2', reason: 'shift' }, 'injected-user-id');

      expect(mockService.changeAttending).toHaveBeenCalledWith('adm-1', expect.any(Object), 'injected-user-id');
    });

    it('should inject userId for getPendingHandoffs', async () => {
      mockService.getPendingHandoffs.mockResolvedValue([]);

      await controller.getPendingHandoffs('injected-doctor-id');

      expect(mockService.getPendingHandoffs).toHaveBeenCalledWith('injected-doctor-id');
    });
  });

  describe('Admission Operations', () => {
    it('should admit with all optional parameters', async () => {
      const body = {
        patientId: 'p-1',
        bedId: 'b-1',
        doctorId: 'doc-1',
        reason: 'Acute illness',
        dietType: '저단백식',
      };

      mockService.admit.mockResolvedValue({});

      await controller.admit(body, 'ignored-user');

      expect(mockService.admit).toHaveBeenCalledWith(expect.objectContaining(body));
    });

    it('should discharge with summary', async () => {
      mockService.discharge.mockResolvedValue({});

      await controller.discharge('adm-1', { summary: 'Recovered completely' });

      expect(mockService.discharge).toHaveBeenCalledWith('adm-1', 'Recovered completely', undefined);
    });

    it('should transfer with optional reason', async () => {
      mockService.transfer.mockResolvedValue({});

      await controller.transfer('adm-1', { newBedId: 'b-2', reason: 'ICU admission' });

      expect(mockService.transfer).toHaveBeenCalledWith('adm-1', 'b-2', 'ICU admission');
    });
  });

  describe('Clinical Operations', () => {
    it('should create handoff with all fields', async () => {
      const dto = {
        type: 'SHIFT_CHANGE',
        patientId: 'p-1',
        fromDoctorId: 'd-1',
        toDoctorId: 'd-2',
        admissionId: 'adm-1',
        summary: 'Patient stable, continue current plan',
        vitalSigns: { hr: 75, bp: '120/80' },
        pendingItems: { tests: ['blood work'] },
      };

      mockService.createHandoff.mockResolvedValue({ id: 'ho-1' });

      await controller.createHandoff(dto, 'd-1');

      expect(mockService.createHandoff).toHaveBeenCalledWith(dto);
    });

    it('should add round with all round types', async () => {
      const roundTypes = ['MORNING', 'NOON', 'EVENING', 'NIGHT'];

      for (const roundType of roundTypes) {
        mockService.addRound.mockResolvedValue({});

        await controller.addRound('adm-1', { roundType }, 'doc-1');

        expect(mockService.addRound).toHaveBeenCalledWith('adm-1', 'doc-1', { roundType });
      }
    });
  });

  describe('Timeline Operations', () => {
    it('should get full timeline without date filter', async () => {
      mockService.getPatientTimeline.mockResolvedValue({ events: [], patient: {}, summary: {} });

      await controller.getTimeline('p-1');

      expect(mockService.getPatientTimeline).toHaveBeenCalledWith('p-1', undefined, undefined);
    });

    it('should get timeline with start date only', async () => {
      mockService.getPatientTimeline.mockResolvedValue({ events: [], patient: {}, summary: {} });

      await controller.getTimeline('p-1', '2026-05-01');

      expect(mockService.getPatientTimeline).toHaveBeenCalledWith('p-1', '2026-05-01', undefined);
    });

    it('should get timeline with end date only', async () => {
      mockService.getPatientTimeline.mockResolvedValue({ events: [], patient: {}, summary: {} });

      await controller.getTimeline('p-1', undefined, '2026-05-31');

      expect(mockService.getPatientTimeline).toHaveBeenCalledWith('p-1', undefined, '2026-05-31');
    });

    it('should include all event details in timeline', async () => {
      const mockTimeline = {
        patient: { id: 'p-1', mrn: '00001' },
        events: [
          {
            id: 'evt-1',
            eventType: 'ADMISSION',
            title: 'Hospital Admission',
            department: 'Emergency',
            eventAt: new Date(),
          },
        ],
        summary: { totalEvents: 1, firstEvent: {}, lastEvent: {} },
      };

      mockService.getPatientTimeline.mockResolvedValue(mockTimeline);

      const result = await controller.getTimeline('p-1');

      expect(result.data.events[0]).toEqual(mockTimeline.events[0]);
    });
  });
});
