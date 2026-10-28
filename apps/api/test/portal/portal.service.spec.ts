import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortalService } from '../../src/modules/portal/portal.service';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
// 🔴 (2026-09-15 N2) 발급 입구가 SPKI 공개키만 받는다 — 픽스처도 실제 키를 쓴다(지어낸 'pk-test-123' 은 이제 400)
const rsaPem = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PK = rsaPem();

vi.mock('jsonwebtoken', () => ({
  sign: vi.fn().mockReturnValue('mock-jwt-token'),
  verify: vi.fn(),
}));

describe('PortalService', () => {
  let service: PortalService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockConfigRuntime: any;
  let mockSchedule: any;

  beforeEach(() => {
    mockPrisma = {
      patient: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      appointment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      encounter: { findMany: vi.fn(), findFirst: vi.fn() },
      labResult: { findMany: vi.fn() },
      labResultItem: { findMany: vi.fn() },
      criticalValueAlert: { findMany: vi.fn().mockResolvedValue([]) },
      diagnosticTest: { findMany: vi.fn() },
      billing: { findMany: vi.fn(), findFirst: vi.fn() },
      portalSession: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
      portalAuditLog: { create: vi.fn().mockResolvedValue({}) },
      waitingQueue: { findMany: vi.fn(), count: vi.fn() },
      vaccination: { findMany: vi.fn() },
      healthMemo: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
      satisfactionSurvey: { findMany: vi.fn(), create: vi.fn() },
      surgery: { findMany: vi.fn() },
      patientMessage: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
      consentForm: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      allergy: { findMany: vi.fn() },
      questionnaireToken: { findMany: vi.fn() },
      prescription: { findMany: vi.fn(), findFirst: vi.fn() },
      systemConfig: { findMany: vi.fn(), findUnique: vi.fn() },
      preVisitVitals: { findFirst: vi.fn() },
      problemList: { findMany: vi.fn() },
      documentRequest: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      patientFamily: { findFirst: vi.fn() },
      breakTheGlassAccess: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      auditLog: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      blockchainCertificate: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      patientAccount: { findUnique: vi.fn() },
      // F-2 복약체크·검진결과 통합 이후 추가된 델리게이트(누락 시 undefined 접근으로 실패 — mock 드리프트)
      checkupVisit: { findMany: vi.fn().mockResolvedValue([]) },
      patientJourneyEvent: { create: vi.fn().mockResolvedValue({}) },
      medicationCheckLog: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({}) },
    };
    mockConfig = {
      get: vi.fn().mockReturnValue('test-jwt-secret'),
    };
    mockConfigRuntime = {
      get: vi.fn().mockResolvedValue('manual'),
    };
    // 예약 변경/취소는 ScheduleService로 위임(포털 셀프 예약변경) — 목 주입
    mockSchedule = {
      rescheduleByPatient: vi.fn(),
      cancelByPatient: vi.fn(),
    };
    const mockClinicSchedule = {} as any;
    const mockWaitingQueue = {} as any;
    service = new PortalService(mockPrisma, mockConfig, mockConfigRuntime, mockClinicSchedule, mockWaitingQueue, mockSchedule);
  });

  // ── authenticate ──

  describe('authenticate', () => {
    it('should authenticate patient with valid MRN and dateOfBirth', async () => {
      const mockPatient = {
        id: 'p-1', mrn: '12345', familyName: 'Kim', givenName: 'John',
        dateOfBirth: new Date('1990-01-01'), gender: 'M', phone: '010-1234-5678', insuranceType: 'NATIONAL',
      };
      mockPrisma.patient.findFirst.mockResolvedValue(mockPatient);

      const result = await service.authenticate('12345', '1990-01-01');

      expect(result.patient.id).toBe('p-1');
      expect(result.token).toBeDefined();
      expect(result.expiresAt).toBeDefined();
    });

    it('should throw UnauthorizedException if patient not found', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue(null);
      await expect(service.authenticate('invalid', '1990-01-01')).rejects.toThrow(UnauthorizedException);
    });

    it('should only query active patients (validTo: null)', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue({ id: 'p-1', mrn: '12345' });
      await service.authenticate('12345', '1990-01-01');
      expect(mockPrisma.patient.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ validTo: null }) }),
      );
    });

    it('should create portal session', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue({ id: 'p-1', mrn: '12345', familyName: 'Kim', givenName: 'J' });
      await service.authenticate('12345', '1990-01-01', '1.2.3.4', 'TestBrowser');
      expect(mockPrisma.portalSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ patientId: 'p-1', ipAddress: '1.2.3.4' }) }),
      );
    });

    it('should log audit on login', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue({ id: 'p-1', mrn: '12345', familyName: 'K', givenName: 'J' });
      await service.authenticate('12345', '1990-01-01', '1.2.3.4');
      expect(mockPrisma.portalAuditLog.create).toHaveBeenCalled();
    });
  });

  // ── verifyToken ──

  describe('verifyToken', () => {
    it('should return patientId for valid token with active session', async () => {
      const jwt = await import('jsonwebtoken');
      (jwt.verify as any).mockReturnValue({ sub: 'p-1', type: 'portal' });
      mockPrisma.portalSession.findFirst.mockResolvedValue({ id: 'sess-1', token: 'tok' });

      const result = await service.verifyToken('tok');
      expect(result).toBe('p-1');
    });

    it('should throw UnauthorizedException if token type is not portal', async () => {
      const jwt = await import('jsonwebtoken');
      (jwt.verify as any).mockReturnValue({ sub: 'p-1', type: 'staff' });

      await expect(service.verifyToken('tok')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if session not found', async () => {
      const jwt = await import('jsonwebtoken');
      (jwt.verify as any).mockReturnValue({ sub: 'p-1', type: 'portal' });
      mockPrisma.portalSession.findFirst.mockResolvedValue(null);

      await expect(service.verifyToken('tok')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if jwt.verify fails', async () => {
      const jwt = await import('jsonwebtoken');
      (jwt.verify as any).mockImplementation(() => { throw new Error('expired'); });

      await expect(service.verifyToken('bad-tok')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── logout ──

  describe('logout', () => {
    it('should deactivate session', async () => {
      await service.logout('tok-123');
      expect(mockPrisma.portalSession.updateMany).toHaveBeenCalledWith({
        where: { token: 'tok-123' },
        data: { isActive: false },
      });
    });
  });

  // ── getAppointments ──

  describe('getAppointments', () => {
    it('should retrieve scheduled/checked-in appointments', async () => {
      const appts = [{ id: 'apt-1', status: 'SCHEDULED', doctor: { familyName: 'P', givenName: 'M', department: 'IM' } }];
      mockPrisma.appointment.findMany.mockResolvedValue(appts);

      const result = await service.getAppointments('p-1');
      expect(result).toEqual(appts);
      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { patientId: 'p-1', status: { in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'] } } }),
      );
    });

    it('should order by scheduledAt asc', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      await service.getAppointments('p-1');
      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { scheduledAt: 'asc' } }),
      );
    });
  });

  // ── getEncounters ──

  describe('getEncounters', () => {
    it('should retrieve signed encounters', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([{ id: 'enc-1', diagnoses: [] }]); // 관계 select 는 늘 배열
      const result = await service.getEncounters('p-1');
      expect(result).toHaveLength(1);
      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { patientId: 'p-1', status: 'SIGNED' }, take: 20 }),
      );
    });
  });

  // ── getLabResults ──

  describe('getLabResults', () => {
    it('should retrieve completed lab results', async () => {
      mockPrisma.labResult.findMany.mockResolvedValue([{ id: 'lab-1', items: [{ testName: 'WBC', value: 7 }] }]);
      const result = await service.getLabResults('p-1');
      // FE 계약 정규화(items[].name) — 검진결과 통합 시 testName→name으로 변환됨
      expect(result[0].items[0].name).toBe('WBC');
    });
  });

  // ── getDiagnosticTests ──

  describe('getDiagnosticTests', () => {
    it('should retrieve completed diagnostic tests', async () => {
      mockPrisma.diagnosticTest.findMany.mockResolvedValue([{ id: 'dt-1', testType: 'IMAGING' }]);
      const result = await service.getDiagnosticTests('p-1');
      expect(result[0].testType).toBe('IMAGING');
    });
  });

  // ── getBillings ──

  describe('getBillings', () => {
    it('should retrieve billing history', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([{ id: 'b-1', totalAmount: 100000 }]);
      const result = await service.getBillings('p-1');
      expect(result[0].totalAmount).toBe(100000);
    });

    it('should limit to 20 and order by createdAt desc', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([]);
      await service.getBillings('p-1');
      expect(mockPrisma.billing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  // ── rescheduleAppointment ──

  describe('rescheduleAppointment', () => {
    // 예약 변경 로직은 ScheduleService.rescheduleByPatient로 위임(검증·정원·상태전이 포함) — 위임 계약만 검증
    it('should delegate to schedule.rescheduleByPatient', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 7).toISOString();
      mockSchedule.rescheduleByPatient.mockResolvedValue({ id: 'apt-1', scheduledAt: new Date(futureDate) });

      const result = await service.rescheduleAppointment('p-1', 'apt-1', futureDate);
      expect(result.id).toBe('apt-1');
      expect(mockSchedule.rescheduleByPatient).toHaveBeenCalledWith('apt-1', 'p-1', futureDate);
    });

    it('should propagate NotFoundException from schedule service', async () => {
      mockSchedule.rescheduleByPatient.mockRejectedValue(new NotFoundException('not found'));
      await expect(service.rescheduleAppointment('p-1', 'apt-x', '2030-01-01')).rejects.toThrow(NotFoundException);
    });
  });

  // ── cancelAppointment ──

  describe('cancelAppointment', () => {
    it('should delegate to schedule.cancelByPatient', async () => {
      mockSchedule.cancelByPatient.mockResolvedValue({ id: 'apt-1', status: 'CANCELLED' });

      const result = await service.cancelAppointment('p-1', 'apt-1', '개인 사유');
      expect(result.status).toBe('CANCELLED');
      expect(mockSchedule.cancelByPatient).toHaveBeenCalledWith('apt-1', 'p-1', '개인 사유');
    });

    it('should propagate NotFoundException from schedule service', async () => {
      mockSchedule.cancelByPatient.mockRejectedValue(new NotFoundException('not found'));
      await expect(service.cancelAppointment('p-1', 'x', '')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getWaitingStatus ──

  describe('getWaitingStatus', () => {
    it('should return waiting queues with ahead count', async () => {
      mockPrisma.waitingQueue.findMany.mockResolvedValue([
        { id: 'q-1', queueNumber: 5, departmentName: 'IM', status: 'WAITING', createdAt: new Date() },
      ]);
      mockPrisma.waitingQueue.count.mockResolvedValue(3);

      const result = await service.getWaitingStatus('p-1');
      expect(result).toHaveLength(1);
      // 앞 대기 인원은 실제로 센 값 — 그대로 낸다
      expect(result[0].aheadCount).toBe(3);
      /**
       * 🔴 이 단언(`3 × 8분 = 24`)이 날조를 계약으로 굳혀두고 있었다 — 화면 실사용 점검 W8(2026-08-14).
       *    `estimatedMinutes: ahead * 8` 은 **측정한 적 없는 상수**인데 환자 포털에 예상 대기로 표시됐다(P15).
       *    실측: 외래 완료 462건 중 진료 시작 시각이 있는 것은 13건뿐 —
       *    이 병원의 회전율을 뒷받침할 표본이 사실상 없다. 모르면 지어내지 않고 null 이다.
       *    (같은 날 전광판·접수 화면의 상수 15분, 진료대기 화면의 8분도 함께 걷어냈다.)
       */
      expect(result[0].estimatedMinutes).toBeNull();
    });

    it('should return empty array if no queues', async () => {
      mockPrisma.waitingQueue.findMany.mockResolvedValue([]);
      const result = await service.getWaitingStatus('p-1');
      expect(result).toEqual([]);
    });
  });

  // ── getVaccinations ──

  describe('getVaccinations', () => {
    it('should return vaccination history', async () => {
      mockPrisma.vaccination.findMany.mockResolvedValue([{ id: 'v-1', vaccineName: 'COVID-19' }]);
      const result = await service.getVaccinations('p-1');
      expect(result[0].vaccineName).toBe('COVID-19');
    });
  });

  // ── getHealthMemos / createHealthMemo / deleteHealthMemo ──

  describe('healthMemos', () => {
    it('should list health memos', async () => {
      mockPrisma.healthMemo.findMany.mockResolvedValue([{ id: 'm-1', content: 'test' }]);
      const result = await service.getHealthMemos('p-1');
      expect(result).toHaveLength(1);
    });

    it('should create health memo with default category', async () => {
      mockPrisma.healthMemo.create.mockResolvedValue({ id: 'm-1', category: 'GENERAL' });
      const result = await service.createHealthMemo('p-1', { content: 'note' });
      expect(result.category).toBe('GENERAL');
    });

    it('should delete health memo', async () => {
      mockPrisma.healthMemo.findUnique.mockResolvedValue({ id: 'm-1', patientId: 'p-1' });
      mockPrisma.healthMemo.delete.mockResolvedValue({ id: 'm-1' });
      const result = await service.deleteHealthMemo('p-1', 'm-1');
      expect(result.id).toBe('m-1');
    });

    it('should throw NotFoundException if memo not found on delete', async () => {
      mockPrisma.healthMemo.findUnique.mockResolvedValue(null);
      await expect(service.deleteHealthMemo('p-1', 'x')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if memo belongs to another patient', async () => {
      mockPrisma.healthMemo.findUnique.mockResolvedValue({ id: 'm-1', patientId: 'p-other' });
      await expect(service.deleteHealthMemo('p-1', 'm-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── satisfaction ──

  describe('satisfaction', () => {
    it('should list satisfaction surveys', async () => {
      mockPrisma.satisfactionSurvey.findMany.mockResolvedValue([{ id: 's-1', overallRating: 5 }]);
      const result = await service.getSatisfactionSurveys('p-1');
      expect(result[0].overallRating).toBe(5);
    });

    it('should submit satisfaction survey', async () => {
      mockPrisma.satisfactionSurvey.create.mockResolvedValue({ id: 's-1', overallRating: 4 });
      const result = await service.submitSatisfaction('p-1', { overallRating: 4 });
      expect(result.overallRating).toBe(4);
    });
  });

  // ── surgery checklists ──

  describe('getPatientSurgeryChecklists', () => {
    it('should return scheduled surgeries', async () => {
      mockPrisma.surgery.findMany.mockResolvedValue([{ id: 'surg-1', procedureName: 'Knee' }]);
      const result = await service.getPatientSurgeryChecklists('p-1');
      expect(result[0].procedureName).toBe('Knee');
    });
  });

  // ── getInsuranceClaimGuide ──

  describe('getInsuranceClaimGuide', () => {
    it('should return static guide object', () => {
      const result = service.getInsuranceClaimGuide();
      expect(result.title).toContain('실비보험');
      expect(result.steps).toHaveLength(4);
      expect(result.requiredDocuments.length).toBeGreaterThan(0);
      expect(result.tips.length).toBeGreaterThan(0);
    });
  });

  // ── messages ──

  describe('messages', () => {
    it('should get messages', async () => {
      mockPrisma.patientMessage.findMany.mockResolvedValue([{ id: 'msg-1', sender: 'DOCTOR' }]);
      const result = await service.getMessages('p-1');
      expect(result).toHaveLength(1);
    });

    it('should send message with specified doctorId', async () => {
      mockPrisma.patientMessage.create.mockResolvedValue({ id: 'msg-1', sender: 'PATIENT' });
      const result = await service.sendMessage('p-1', 'hello', 'd-1');
      expect(mockPrisma.patientMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ doctorId: 'd-1', sender: 'PATIENT' }) }),
      );
    });

    it('should find last encounter doctor if doctorId not provided', async () => {
      mockPrisma.encounter.findFirst.mockResolvedValue({ doctorId: 'd-last' });
      mockPrisma.patientMessage.create.mockResolvedValue({ id: 'msg-1' });
      await service.sendMessage('p-1', 'hi');
      expect(mockPrisma.patientMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ doctorId: 'd-last' }) }),
      );
    });

    it('should reply to message', async () => {
      mockPrisma.patientMessage.findUnique.mockResolvedValue({ id: 'msg-1', patientId: 'p-1', doctorId: 'd-1' });
      mockPrisma.patientMessage.create.mockResolvedValue({ id: 'msg-2', content: 'RE: reply' });
      const result = await service.replyToMessage('p-1', 'msg-1', 'reply');
      expect(result.content).toContain('RE:');
    });

    it('should throw NotFoundException if original message not found on reply', async () => {
      mockPrisma.patientMessage.findUnique.mockResolvedValue(null);
      await expect(service.replyToMessage('p-1', 'x', 'text')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if message belongs to another patient on reply', async () => {
      mockPrisma.patientMessage.findUnique.mockResolvedValue({ id: 'msg-1', patientId: 'p-other' });
      await expect(service.replyToMessage('p-1', 'msg-1', 'text')).rejects.toThrow(NotFoundException);
    });
  });

  // ── unpaid billings ──

  describe('getUnpaidBillings', () => {
    it('should retrieve pending/partial billings', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([{ id: 'b-1', status: 'PENDING', patientCopay: 10000, discountAmount: 0, paidAmount: 0 }]);
      const result = await service.getUnpaidBillings('p-1');
      expect(result[0].status).toBe('PENDING');
      expect(result[0].outstanding).toBe(10000);
      // P4-1: 미수 정본 집합(보류 포함)
      expect(mockPrisma.billing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { patientId: 'p-1', status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] } } }),
      );
    });
  });

  // ── consents ──

  describe('consents', () => {
    it('should list patient consents', async () => {
      mockPrisma.consentForm.findMany.mockResolvedValue([{ id: 'c-1', status: 'DRAFT' }]);
      const result = await service.getPatientConsents('p-1');
      expect(result).toHaveLength(1);
    });

    it('should sign consent', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({ id: 'c-1', patientId: 'p-1', status: 'DRAFT' });
      mockPrisma.consentForm.update.mockResolvedValue({ id: 'c-1', status: 'SIGNED' });
      const result = await service.signConsent('p-1', 'c-1', 'sig-data');
      expect(result.status).toBe('SIGNED');
    });

    it('should return existing consent if already signed', async () => {
      const existing = { id: 'c-1', patientId: 'p-1', status: 'SIGNED' };
      mockPrisma.consentForm.findUnique.mockResolvedValue(existing);
      const result = await service.signConsent('p-1', 'c-1', 'sig');
      expect(result).toBe(existing);
      expect(mockPrisma.consentForm.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if consent not found', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue(null);
      await expect(service.signConsent('p-1', 'x', 'sig')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if consent belongs to another patient', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({ id: 'c-1', patientId: 'p-other', status: 'DRAFT' });
      await expect(service.signConsent('p-1', 'c-1', 'sig')).rejects.toThrow(NotFoundException);
    });
  });

  // ── allergies / questionnaires ──

  describe('allergies', () => {
    it('should return active allergies', async () => {
      mockPrisma.allergy.findMany.mockResolvedValue([{ id: 'a-1', isActive: true }]);
      const result = await service.getAllergies('p-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('questionnaires', () => {
    it('should return questionnaire tokens', async () => {
      mockPrisma.questionnaireToken.findMany.mockResolvedValue([{ id: 'qt-1' }]);
      const result = await service.getQuestionnaires('p-1');
      expect(result).toHaveLength(1);
    });
  });

  // ── getPatientMrn ──

  describe('getPatientMrn', () => {
    it('should return mrn', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ mrn: 'MRN-001' });
      const result = await service.getPatientMrn('p-1');
      expect(result).toBe('MRN-001');
    });

    it('should throw NotFoundException if patient not found', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(null);
      await expect(service.getPatientMrn('x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── profile ──

  describe('profile', () => {
    it('should get profile', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-1', mrn: '001', familyName: 'Kim' });
      const result = await service.getProfile('p-1');
      expect(result.mrn).toBe('001');
    });

    it('should update profile (phone/email/address)', async () => {
      mockPrisma.patient.update.mockResolvedValue({ id: 'p-1', phone: '010-1111-2222' });
      const result = await service.updateProfile('p-1', { phone: '010-1111-2222' });
      expect(result.phone).toBe('010-1111-2222');
    });
  });

  // ── getLabTrends ──

  describe('getLabTrends', () => {
    it('should return grouped lab trends', async () => {
      mockPrisma.labResultItem.findMany.mockResolvedValue([
        // 실제 반환 모양 — labResult 관계(id·완료 시각·오더 결과 확인)는 늘 있다
        { testName: '혈당', value: '100', unit: 'mg/dL', flag: 'NORMAL', labResult: { id: 'l1', completedAt: new Date(), order: { acknowledgedAt: null } } },
        { testName: '혈당', value: '110', unit: 'mg/dL', flag: 'NORMAL', labResult: { id: 'l2', completedAt: new Date(), order: { acknowledgedAt: null } } },
        { testName: 'ALT', value: '25', unit: 'U/L', flag: null, labResult: { id: 'l3', completedAt: new Date(), order: { acknowledgedAt: null } } },
      ]);
      const result = await service.getLabTrends('p-1');
      expect(result).toHaveLength(2);
      const glucose = result.find(r => r.testName === '혈당');
      expect(glucose?.data).toHaveLength(2);
    });

    it('should use default test names when none specified', async () => {
      mockPrisma.labResultItem.findMany.mockResolvedValue([]);
      await service.getLabTrends('p-1');
      expect(mockPrisma.labResultItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ testName: expect.objectContaining({ in: expect.arrayContaining(['혈당', 'HbA1c']) }) }) }),
      );
    });

    it('should use provided test names', async () => {
      mockPrisma.labResultItem.findMany.mockResolvedValue([]);
      await service.getLabTrends('p-1', ['WBC', 'RBC']);
      expect(mockPrisma.labResultItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ testName: { in: ['WBC', 'RBC'] } }) }),
      );
    });
  });

  // ── getMedicalExpenses ──

  describe('getMedicalExpenses', () => {
    it('should return annual medical expense summary', async () => {
      // P2-5: 원장 줄 없는 옛 수납 — 완납일에 납부액 · 집계는 돈이 오간 청구로
      mockPrisma.billingPayment = { findMany: vi.fn().mockResolvedValue([]) };
      mockPrisma.billing.findMany.mockImplementation(async ({ where }: any) => (where?.id?.in
        ? [{ id: 'b1', totalAmount: 50000, insuranceCovered: 40000, patientCopay: 10000 }]
        : [{ id: 'b1', paidAmount: 10000, paidAt: new Date('2026-03-15T03:00:00Z'), refundAmount: null, refundedAt: null }]));

      const result = await service.getMedicalExpenses('p-1', 2026);
      expect(result.year).toBe(2026);
      expect(result.summary.totalAmount).toBe(50000);
      expect(result.visitCount).toBe(1);
      expect(result.monthly.length).toBeGreaterThan(0);
    });
  });

  // ── getCurrentMedications ──

  describe('getCurrentMedications', () => {
    it('should return deduplicated active medications', async () => {
      mockPrisma.prescription.findMany.mockResolvedValue([
        { dosage: '500mg', frequency: '1일 2회', duration: 7, route: 'PO', createdAt: new Date(), medicationCode: { nameKo: '타이레놀', nameEn: 'Tylenol', code: 'TYL' }, encounter: { doctor: { familyName: 'K', givenName: 'J', department: 'IM' } } },
      ]);
      const result = await service.getCurrentMedications('p-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('타이레놀');
    });

    it('should deduplicate by medication name', async () => {
      mockPrisma.prescription.findMany.mockResolvedValue([
        { dosage: '500mg', frequency: '1일 2회', duration: 7, route: 'PO', createdAt: new Date(), medicationCode: { nameKo: '타이레놀', code: 'TYL' }, encounter: { doctor: { familyName: 'K', givenName: 'J', department: 'IM' } } },
        { dosage: '500mg', frequency: '1일 2회', duration: 7, route: 'PO', createdAt: new Date(), medicationCode: { nameKo: '타이레놀', code: 'TYL' }, encounter: { doctor: { familyName: 'K', givenName: 'J', department: 'IM' } } },
      ]);
      const result = await service.getCurrentMedications('p-1');
      expect(result).toHaveLength(1);
    });
  });

  // ── getNotices ──

  describe('getNotices', () => {
    it('should return notices from systemConfig', async () => {
      mockPrisma.systemConfig.findMany.mockResolvedValue([
        { key: 'notice-1', value: '진료 안내', label: '공지 1', updatedAt: new Date() },
      ]);
      const result = await service.getNotices();
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('공지 1');
    });

    /**
     * 🔴 종전 기본 공지는 '평일 09:00~18:00 / 토요일 09:00~13:00 …' 을 **병원 사실로** 환자에게 말했다.
     *    이 병원의 CMS 정본은 평일 ~17:30 이었다(P15 — 화면이 값을 지어냈다).
     *    이제 진료시간은 정본 `hospital.hours.*` DB 행에서만 오고, **하나도 없으면 그 공지를 싣지 않는다**.
     */
    it('설정된 진료시간이 없으면 진료시간 공지를 싣지 않는다 — 시간을 지어내지 않는다', async () => {
      mockPrisma.systemConfig.findMany.mockResolvedValue([]);
      const result = await service.getNotices();
      // 🔴 (2026-09-14) 지어낸 시설 기본 공지 4건을 걷었다 — 등록된 공지·진료시간이 없으면 빈 목록이 사실이다
      expect(result).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('09:00~18:00');
    });

    it('설정된 진료시간이 있으면 **그 값**으로 공지한다', async () => {
      mockPrisma.systemConfig.findMany
        .mockResolvedValueOnce([]) // category:'notice' 조회 — 등록된 공지 없음
        .mockResolvedValueOnce([{ key: 'hospital.hours.weekday', value: '09:00~17:30' }, { key: 'hospital.emergency', value: '24시간' }]);
      const result = await service.getNotices();
      expect(result[0].title).toContain('진료 시간');
      expect(result[0].content).toBe('평일: 09:00~17:30 / 응급실: 24시간');
    });
  });

  // ── getReceipt ──

  describe('getReceipt', () => {
    it('should return receipt data', async () => {
      mockPrisma.billing.findFirst.mockResolvedValue({
        id: 'b-1', totalAmount: 100000, insuranceCovered: 80000, patientCopay: 20000, paidAmount: 20000, status: 'PAID', createdAt: new Date(),
        encounter: { createdAt: new Date(), doctor: { familyName: 'K', givenName: 'J', department: 'IM' }, diagnoses: [{ diagnosisCode: { code: 'I10', nameKo: '고혈압' } }] },
      });
      mockPrisma.patient.findUnique.mockResolvedValue({ familyName: 'Kim', givenName: 'John', mrn: '001', dateOfBirth: new Date(), insuranceType: 'NHI' });
      mockPrisma.systemConfig.findMany.mockResolvedValue([{ key: 'hospital.name', value: 'Test Hospital' }]);

      const result = await service.getReceipt('p-1', 'b-1');
      expect(result.hospitalName).toBe('Test Hospital');
      expect(result.patient.name).toBe('KimJohn');
    });

    /** 🔴 종전엔 기관명 미설정이면 영수증에 'Hospital RUN' 을 찍었다 — 환자가 받는 문서다(날조). */
    it('🔴 기관명이 미설정이면 지어내지 않고 "미설정"이라고 찍는다', async () => {
      mockPrisma.billing.findFirst.mockResolvedValue({
        id: 'b-1', totalAmount: 1, insuranceCovered: 0, patientCopay: 1, paidAmount: 1, status: 'PAID', createdAt: new Date(), encounter: null,
      });
      mockPrisma.patient.findUnique.mockResolvedValue({ familyName: 'Kim', givenName: 'John', mrn: '001', dateOfBirth: new Date(), insuranceType: 'NHI' });
      mockPrisma.systemConfig.findMany.mockResolvedValue([]);

      const result = await service.getReceipt('p-1', 'b-1');
      expect(result.hospitalName).toBe('(기관명 미설정)');
      expect(result.hospitalName).not.toContain('Hospital RUN');
    });

    it('should throw NotFoundException if billing not found', async () => {
      mockPrisma.billing.findFirst.mockResolvedValue(null);
      await expect(service.getReceipt('p-1', 'x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getHealthDashboard ──

  describe('getHealthDashboard', () => {
    it('should aggregate dashboard data', async () => {
      mockPrisma.preVisitVitals.findFirst.mockResolvedValue({ systolicBp: 120 });
      mockPrisma.prescription.findMany.mockResolvedValue([{ id: 'rx-1', medicationCode: { nameKo: 'Aspirin' }, medicationCodeId: 'ASP', dosage: '100mg', frequency: '1일 1회', route: 'PO' }]);
      mockPrisma.problemList.findMany.mockResolvedValue([{ id: 'pl-1', description: 'HTN', status: 'ACTIVE', severity: 'MILD', onsetDate: new Date(), diagnosisCode: { code: 'I10', nameKo: '고혈압' } }]);
      mockPrisma.appointment.findFirst.mockResolvedValue({ id: 'apt-1', scheduledAt: new Date(), type: 'FU', reason: 'checkup', doctor: { familyName: 'K', givenName: 'J', department: 'IM' } });
      mockPrisma.allergy.findMany.mockResolvedValue([]);
      mockPrisma.labResult.findMany.mockResolvedValue([]);

      const result = await service.getHealthDashboard('p-1');
      expect(result.vitals).toBeDefined();
      expect(result.activeRx).toHaveLength(1);
      expect(result.problems).toHaveLength(1);
      expect(result.nextAppointment).toBeDefined();
    });
  });

  // ── getMedicationSchedule ──

  describe('getMedicationSchedule', () => {
    it('should return medication schedule with time slots', async () => {
      mockPrisma.prescription.findMany.mockResolvedValue([
        { id: 'rx-1', medicationCode: { nameKo: '타이레놀', nameEn: 'Tylenol' }, medicationCodeId: 'TYL', dosage: '500mg', frequency: '1일 3회', route: 'PO' },
      ]);
      const result = await service.getMedicationSchedule('p-1');
      expect(result).toHaveLength(1);
      expect(result[0].slots).toEqual(['아침 식후', '점심 식후', '저녁 식후']);
    });

    it('should parse BID frequency', async () => {
      mockPrisma.prescription.findMany.mockResolvedValue([
        { id: 'rx-1', medicationCode: { nameKo: 'Test' }, medicationCodeId: 'T', dosage: '10mg', frequency: '1일 2회', route: 'PO' },
      ]);
      const result = await service.getMedicationSchedule('p-1');
      expect(result[0].slots).toEqual(['아침 식후', '저녁 식후']);
    });
  });

  // ── checkMedication ──

  describe('checkMedication', () => {
    it('should record medication check', async () => {
      mockPrisma.prescription.findFirst.mockResolvedValue({ id: 'rx-1' });
      const result = await service.checkMedication('p-1', { prescriptionId: 'rx-1', slot: '아침 식후', taken: true });
      expect(result.success).toBe(true);
      expect(result.taken).toBe(true);
    });

    it('should throw NotFoundException if prescription not found', async () => {
      mockPrisma.prescription.findFirst.mockResolvedValue(null);
      await expect(service.checkMedication('p-1', { prescriptionId: 'x', slot: '아침', taken: true })).rejects.toThrow(NotFoundException);
    });
  });

  // ── getAnnualBillingSummary ──

  describe('getAnnualBillingSummary', () => {
    it('should return annual summary with monthly breakdown', async () => {
      // P2-5: 원장 줄 없는 옛 수납 — 완납일에 납부액 · 집계는 돈이 오간 청구로
      mockPrisma.billingPayment = { findMany: vi.fn().mockResolvedValue([]) };
      mockPrisma.billing.findMany.mockImplementation(async ({ where }: any) => (where?.id?.in
        ? [{ id: 'b1', totalAmount: 50000, insuranceCovered: 40000, patientCopay: 10000 }]
        : [{ id: 'b1', paidAmount: 10000, paidAt: new Date('2026-06-15T03:00:00Z'), refundAmount: null, refundedAt: null }]));
      const result = await service.getAnnualBillingSummary('p-1', 2026);
      expect(result.year).toBe(2026);
      expect(result.totalVisits).toBe(1);
      expect(result.monthly).toHaveLength(12);
    });
  });

  // ── switchFamily ──

  describe('switchFamily', () => {
    it('should switch to linked family patient', async () => {
      mockPrisma.patientFamily.findFirst.mockResolvedValue({ patientId: 'p-1', linkedPatientId: 'p-2', relationship: 'CHILD' });
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-2', mrn: '002', familyName: 'Kim', givenName: 'Jr' });

      const result = await service.switchFamily('p-1', 'p-2');
      expect(result.switched).toBe(true);
      expect(result.patientId).toBe('p-2');
      expect(result.relationship).toBe('CHILD');
      expect(result.token).toBeDefined();
    });

    it('should throw NotFoundException if no family relation', async () => {
      mockPrisma.patientFamily.findFirst.mockResolvedValue(null);
      await expect(service.switchFamily('p-1', 'p-x')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if linked patient not found', async () => {
      mockPrisma.patientFamily.findFirst.mockResolvedValue({ patientId: 'p-1', linkedPatientId: 'p-gone' });
      mockPrisma.patient.findUnique.mockResolvedValue(null);
      await expect(service.switchFamily('p-1', 'p-gone')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getPatientAuditLog ──

  describe('getPatientAuditLog', () => {
    it('should return BTG and audit logs', async () => {
      mockPrisma.breakTheGlassAccess.findMany.mockResolvedValue([
        { id: 'btg-1', reason: 'Emergency', resourceType: 'Chart', accessedAt: new Date(), isApproved: true, user: { familyName: 'K', givenName: 'J', department: 'ER' } },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { id: 'al-1', action: 'VIEW', timestamp: new Date(), user: { familyName: 'L', givenName: 'M', department: 'IM' } },
      ]);

      const result = await service.getPatientAuditLog('p-1');
      expect(result.btgAccesses).toHaveLength(1);
      expect(result.accessLogs).toHaveLength(1);
    });
  });

  // ── requestDocument / getDocumentRequests / getDocumentRequest ──

  describe('documents', () => {
    it('should create document request with fee calculation', async () => {
      mockPrisma.documentRequest.create.mockResolvedValue({ id: 'dr-1', type: 'DIAGNOSIS_CERT', fee: 20000 });
      const result = await service.requestDocument('p-1', { type: 'DIAGNOSIS_CERT' });
      expect(result.fee).toBe(20000);
    });

    // 🔴 (2026-10-10) 포털은 따로 둔 금액표로 20,000×3 = 60,000 을 매겼다 — 창구·발급의 규칙 정본은 1부 20,000 + 추가 1부 1,000.
    //    같은 서류가 신청 경로에 따라 6만 원/2만2천 원이 됐다. 이제 정본 하나(fee-rules · 원내 개정 config 포함).
    it('부수 수수료는 수수료 규칙 정본으로(포털 전용 금액표 없음)', async () => {
      mockPrisma.documentRequest.create.mockResolvedValue({ id: 'dr-1', fee: 22000 });
      await service.requestDocument('p-1', { type: 'DIAGNOSIS_CERT', copies: 3 });
      expect(mockPrisma.documentRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ fee: 22000, copies: 3 }) }),
      );
    });

    it('🔴 모르는 종류는 조용한 0원 접수가 아니라 400 · 사망진단서는 포털 신청 불가(창구)', async () => {
      await expect(service.requestDocument('p-1', { type: 'NOPE' })).rejects.toMatchObject({ response: { code: 'UNKNOWN_DOC_TYPE' } });
      await expect(service.requestDocument('p-1', { type: 'DEATH_CERT' })).rejects.toMatchObject({ response: { code: 'DOC_TYPE_DESK_ONLY' } });
      expect(mockPrisma.documentRequest.create).not.toHaveBeenCalled();
    });

    it('원내 개정(config)이 포털 신청 금액에도 먹는다', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce({ value: { DIAGNOSIS_CERT: { label: '진단서', base: 15000, perExtraCopy: 500 } } });
      mockPrisma.documentRequest.create.mockResolvedValue({ id: 'dr-1' });
      await service.requestDocument('p-1', { type: 'DIAGNOSIS_CERT', copies: 2 });
      expect(mockPrisma.documentRequest.create.mock.calls[0][0].data).toMatchObject({ fee: 15500 });
    });

    it('should list document requests', async () => {
      mockPrisma.documentRequest.findMany.mockResolvedValue([{ id: 'dr-1' }]);
      const result = await service.getDocumentRequests('p-1');
      expect(result).toHaveLength(1);
    });

    it('should get single document request', async () => {
      mockPrisma.documentRequest.findFirst.mockResolvedValue({ id: 'dr-1', patientId: 'p-1' });
      const result = await service.getDocumentRequest('p-1', 'dr-1');
      expect(result.id).toBe('dr-1');
    });

    it('should throw NotFoundException if document request not found', async () => {
      mockPrisma.documentRequest.findFirst.mockResolvedValue(null);
      await expect(service.getDocumentRequest('p-1', 'x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── requestCertificate / getPatientCertificates ──

  describe('certificates', () => {
    it('🔴 지어낸 공개키는 400 — 기존 인증서 폐기·발급 없음', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-1', mrn: '001', familyName: 'Kim', givenName: 'J' });
      mockConfigRuntime.get.mockResolvedValue('auto-all');
      await expect(service.requestCertificate('p-1', { publicKey: Buffer.from(`portal-patient-${Date.now()}`).toString('base64'), algorithm: 'ECDSA-P256' }))
        .rejects.toMatchObject({ response: { code: 'PUBLIC_KEY_INVALID' } });
      expect(mockPrisma.blockchainCertificate.create).not.toHaveBeenCalled();
    });

    it('should create certificate request with PENDING status (manual policy)', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-1', mrn: '001', familyName: 'Kim', givenName: 'J' });
      mockConfigRuntime.get.mockResolvedValue('manual');
      mockPrisma.blockchainCertificate.create.mockResolvedValue({ id: 'cert-1', status: 'PENDING' });

      const result = await service.requestCertificate('p-1', { publicKey: PK, algorithm: 'RSA-2048' });
      expect(result.status).toBe('PENDING');
    });

    it('should auto-approve with auto-all policy', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'p-1', mrn: '001', familyName: 'Kim', givenName: 'J' });
      mockConfigRuntime.get.mockResolvedValue('auto-all');
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue(null);
      mockPrisma.blockchainCertificate.create.mockResolvedValue({ id: 'cert-1', status: 'ACTIVE' });

      const result = await service.requestCertificate('p-1', { publicKey: PK, algorithm: 'RSA-2048' });
      expect(result.status).toBe('ACTIVE');
    });

    it('should throw NotFoundException if patient not found', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(null);
      await expect(service.requestCertificate('x', { publicKey: PK, algorithm: 'RSA-2048' })).rejects.toThrow(NotFoundException);
    });

    it('should list patient certificates', async () => {
      mockPrisma.blockchainCertificate.findMany.mockResolvedValue([{ id: 'cert-1', status: 'ACTIVE' }]);
      const result = await service.getPatientCertificates('p-1');
      expect(result).toHaveLength(1);
    });
  });

  // ── admin documents ──

  describe('admin documents', () => {
    it('should list all document requests (admin)', async () => {
      mockPrisma.documentRequest.findMany.mockResolvedValue([{ id: 'dr-1' }]);
      const result = await service.getDocumentRequestsAdmin();
      expect(result).toHaveLength(1);
    });

    it('should filter by status (admin)', async () => {
      mockPrisma.documentRequest.findMany.mockResolvedValue([]);
      await service.getDocumentRequestsAdmin('PENDING');
      expect(mockPrisma.documentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } }),
      );
    });

    // 🔴 (2026-10-10) 상태 문자열을 그대로 쓰던 관리 EP — 동결·서명·발급 없이 READY(발급완료)를 만들 수 있었다(부르는 화면 0)
    it('🔴 상태 직접 변경은 거절한다 — 원장을 바꾸지 않는다', async () => {
      for (const status of ['READY', 'DELIVERED', 'REJECTED']) {
        await expect(service.updateDocumentStatus('dr-1', { status, rejectReason: '서류 불일치' }, 'admin-1')).rejects.toMatchObject({ response: { code: 'USE_ISSUANCE_WORKFLOW' } });
      }
      expect(mockPrisma.documentRequest.update).not.toHaveBeenCalled();
    });
  });

  // ── Error Handling ──

  describe('Error Handling', () => {
    it('should throw error with Korean message on auth failure', async () => {
      mockPrisma.patient.findFirst.mockResolvedValue(null);
      try {
        await service.authenticate('invalid', '1990-01-01');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.message).toContain('환자 정보');
      }
    });

    it('should handle DB errors', async () => {
      mockPrisma.patient.findFirst.mockRejectedValue(new Error('DB error'));
      await expect(service.authenticate('12345', '1990-01-01')).rejects.toThrow('DB error');
    });
  });
});
