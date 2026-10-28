import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortalController } from '../../src/modules/portal/portal.controller';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';

describe('PortalController', () => {
  let controller: PortalController;
  let mockService: any;
  let mockReq: any;

  beforeEach(() => {
    mockService = {
      authenticate: vi.fn(),
      logout: vi.fn(),
      getAppointments: vi.fn(),
      getEncounters: vi.fn(),
      getLabResults: vi.fn(),
      getDiagnosticTests: vi.fn(),
      getBillings: vi.fn(),
      rescheduleAppointment: vi.fn(),
      cancelAppointment: vi.fn(),
      getWaitingStatus: vi.fn(),
      getProfile: vi.fn(),
      updateProfile: vi.fn(),
      getLabTrends: vi.fn(),
      getReceipt: vi.fn(),
      getMedicalExpenses: vi.fn(),
      getCurrentMedications: vi.fn(),
      getNotices: vi.fn(),
      requestDocument: vi.fn(),
      getDocumentRequests: vi.fn(),
      getDocumentRequest: vi.fn(),
      getVaccinations: vi.fn(),
      getHealthMemos: vi.fn(),
      createHealthMemo: vi.fn(),
      deleteHealthMemo: vi.fn(),
      getSatisfactionSurveys: vi.fn(),
      submitSatisfaction: vi.fn(),
      getPatientSurgeryChecklists: vi.fn(),
      getInsuranceClaimGuide: vi.fn(),
      getMessages: vi.fn(),
      sendMessage: vi.fn(),
      getPatientMrn: vi.fn(),
      getUnpaidBillings: vi.fn(),
      getPatientConsents: vi.fn(),
      signConsent: vi.fn(),
      getAllergies: vi.fn(),
      getQuestionnaires: vi.fn(),
      getHealthDashboard: vi.fn(),
      getMedicationSchedule: vi.fn(),
      checkMedication: vi.fn(),
      getAnnualBillingSummary: vi.fn(),
      switchFamily: vi.fn(),
      replyToMessage: vi.fn(),
      requestCertificate: vi.fn(),
      getPatientCertificates: vi.fn(),
      getPatientAuditLog: vi.fn(),
    };
    controller = new PortalController(mockService);
    mockReq = {
      portalPatientId: 'p-1',
      headers: { 'x-forwarded-for': '127.0.0.1', 'user-agent': 'test-agent', authorization: 'Bearer tok' },
      ip: '127.0.0.1',
    };
  });

  // ── authenticate ──

  describe('authenticate', () => {
    it('should authenticate and return data+token', async () => {
      const body = { mrn: '12345', dateOfBirth: '1990-01-01' };
      const mockPatient = { id: 'p-1', mrn: '12345', familyName: 'Kim', givenName: 'John' };
      mockService.authenticate.mockResolvedValue({ patient: mockPatient, token: 'jwt-tok', expiresAt: new Date() });

      const result = await controller.authenticate(body, mockReq);

      expect(result.data).toEqual(mockPatient);
      expect(result.token).toBe('jwt-tok');
      expect(result.expiresAt).toBeDefined();
    });

    it('should pass IP and user-agent to service', async () => {
      const body = { mrn: '12345', dateOfBirth: '1990-01-01' };
      mockService.authenticate.mockResolvedValue({ patient: { id: 'p-1' }, token: 'tok', expiresAt: new Date() });
      await controller.authenticate(body, mockReq);
      expect(mockService.authenticate).toHaveBeenCalledWith('12345', '1990-01-01', '127.0.0.1', 'test-agent');
    });

    it('should throw UnauthorizedException on failure', async () => {
      mockService.authenticate.mockRejectedValue(new UnauthorizedException('Invalid'));
      await expect(controller.authenticate({ mrn: 'x', dateOfBirth: '2000-01-01' }, mockReq)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── logout ──

  describe('logout', () => {
    it('should logout and return success', async () => {
      const result = await controller.logout(mockReq);
      expect(result.data.success).toBe(true);
    });
  });

  // ── getAppointments ──

  describe('getAppointments', () => {
    it('should return appointments wrapped in data', async () => {
      mockService.getAppointments.mockResolvedValue([{ id: 'apt-1' }]);
      const result = await controller.getAppointments(mockReq);
      expect(result.data).toHaveLength(1);
      expect(mockService.getAppointments).toHaveBeenCalledWith('p-1');
    });
  });

  // ── getEncounters ──

  describe('getEncounters', () => {
    it('should return encounters wrapped in data', async () => {
      mockService.getEncounters.mockResolvedValue([{ id: 'enc-1' }]);
      const result = await controller.getEncounters(mockReq);
      expect(result.data).toHaveLength(1);
    });
  });

  // ── getLabResults ──

  describe('getLabResults', () => {
    it('should return lab results wrapped in data', async () => {
      mockService.getLabResults.mockResolvedValue([{ id: 'lab-1' }]);
      const result = await controller.getLabResults(mockReq);
      expect(result.data).toHaveLength(1);
    });
  });

  // ── getDiagnosticTests ──

  describe('getDiagnosticTests', () => {
    it('should return diagnostic tests wrapped in data', async () => {
      mockService.getDiagnosticTests.mockResolvedValue([{ id: 'dt-1' }]);
      const result = await controller.getDiagnosticTests(mockReq);
      expect(result.data).toHaveLength(1);
    });
  });

  // ── getBillings ──

  describe('getBillings', () => {
    it('should return billings wrapped in data', async () => {
      mockService.getBillings.mockResolvedValue([{ id: 'b-1', totalAmount: 100000 }]);
      const result = await controller.getBillings(mockReq);
      expect(result.data[0].totalAmount).toBe(100000);
    });
  });

  // ── rescheduleAppointment ──

  describe('rescheduleAppointment', () => {
    it('should reschedule and wrap in data', async () => {
      mockService.rescheduleAppointment.mockResolvedValue({ id: 'apt-1', scheduledAt: '2030-01-01' });
      const result = await controller.rescheduleAppointment('apt-1', { scheduledAt: '2030-01-01' }, mockReq);
      expect(result.data.id).toBe('apt-1');
      expect(mockService.rescheduleAppointment).toHaveBeenCalledWith('p-1', 'apt-1', '2030-01-01');
    });
  });

  // ── cancelAppointment ──

  describe('cancelAppointment', () => {
    it('should cancel and wrap in data', async () => {
      mockService.cancelAppointment.mockResolvedValue({ id: 'apt-1', status: 'CANCELLED' });
      const result = await controller.cancelAppointment('apt-1', { reason: '사유' }, mockReq);
      expect(result.data.status).toBe('CANCELLED');
    });
  });

  // ── getWaitingStatus ──

  describe('getWaitingStatus', () => {
    it('should return waiting status wrapped in data', async () => {
      mockService.getWaitingStatus.mockResolvedValue([{ queueNumber: 5, aheadCount: 3 }]);
      const result = await controller.getWaitingStatus(mockReq);
      expect(result.data[0].aheadCount).toBe(3);
    });
  });

  // ── profile ──

  describe('profile', () => {
    it('should get profile', async () => {
      mockService.getProfile.mockResolvedValue({ id: 'p-1', mrn: '001' });
      const result = await controller.getProfile(mockReq);
      expect(result.data.mrn).toBe('001');
    });

    it('should update profile', async () => {
      mockService.updateProfile.mockResolvedValue({ id: 'p-1', phone: '010-new' });
      const result = await controller.updateProfile({ phone: '010-new' }, mockReq);
      expect(result.data.phone).toBe('010-new');
    });
  });

  // ── getLabTrends ──

  describe('getLabTrends', () => {
    it('should return lab trends', async () => {
      mockService.getLabTrends.mockResolvedValue([{ testName: '혈당', data: [] }]);
      const result = await controller.getLabTrends(mockReq, '혈당,ALT');
      expect(result.data).toHaveLength(1);
      expect(mockService.getLabTrends).toHaveBeenCalledWith('p-1', ['혈당', 'ALT']);
    });

    it('should pass undefined if no tests query', async () => {
      mockService.getLabTrends.mockResolvedValue([]);
      await controller.getLabTrends(mockReq);
      expect(mockService.getLabTrends).toHaveBeenCalledWith('p-1', undefined);
    });
  });

  // ── getReceipt ──

  describe('getReceipt', () => {
    it('should return receipt wrapped in data', async () => {
      mockService.getReceipt.mockResolvedValue({ hospitalName: 'H', receiptNo: 'R-001' });
      const result = await controller.getReceipt('b-1', mockReq);
      expect(result.data.hospitalName).toBe('H');
      expect(mockService.getReceipt).toHaveBeenCalledWith('p-1', 'b-1');
    });
  });

  // ── getMedicalExpenses ──

  describe('getMedicalExpenses', () => {
    it('should return expenses with year', async () => {
      mockService.getMedicalExpenses.mockResolvedValue({ year: 2026, summary: {} });
      const result = await controller.getMedicalExpenses(mockReq, '2026');
      expect(result.data.year).toBe(2026);
      expect(mockService.getMedicalExpenses).toHaveBeenCalledWith('p-1', 2026);
    });
  });

  // ── getCurrentMedications ──

  describe('getCurrentMedications', () => {
    it('should return medications', async () => {
      mockService.getCurrentMedications.mockResolvedValue([{ name: '타이레놀' }]);
      const result = await controller.getCurrentMedications(mockReq);
      expect(result.data[0].name).toBe('타이레놀');
    });
  });

  // ── getNotices ──

  describe('getNotices', () => {
    it('should return notices', async () => {
      mockService.getNotices.mockResolvedValue([{ title: '공지' }]);
      const result = await controller.getNotices();
      expect(result.data[0].title).toBe('공지');
    });
  });

  // ── documents ──

  describe('documents', () => {
    it('should request document', async () => {
      mockService.requestDocument.mockResolvedValue({ id: 'dr-1' });
      const result = await controller.requestDocument({ type: 'RECEIPT' }, mockReq);
      expect(result.data.id).toBe('dr-1');
    });

    it('should get document requests', async () => {
      mockService.getDocumentRequests.mockResolvedValue([{ id: 'dr-1' }]);
      const result = await controller.getDocumentRequests(mockReq);
      expect(result.data).toHaveLength(1);
    });

    it('should get single document request', async () => {
      mockService.getDocumentRequest.mockResolvedValue({ id: 'dr-1' });
      const result = await controller.getDocumentRequest('dr-1', mockReq);
      expect(result.data.id).toBe('dr-1');
    });
  });

  // ── vaccinations ──

  describe('vaccinations', () => {
    it('should return vaccinations', async () => {
      mockService.getVaccinations.mockResolvedValue([{ vaccineName: 'COVID-19' }]);
      const result = await controller.getVaccinations(mockReq);
      expect(result.data[0].vaccineName).toBe('COVID-19');
    });
  });

  // ── health memos ──

  describe('healthMemos', () => {
    it('should list health memos', async () => {
      mockService.getHealthMemos.mockResolvedValue([{ id: 'm-1' }]);
      const result = await controller.getHealthMemos(mockReq);
      expect(result.data).toHaveLength(1);
    });

    it('should create health memo', async () => {
      mockService.createHealthMemo.mockResolvedValue({ id: 'm-1', content: 'test' });
      const result = await controller.createHealthMemo(mockReq, { content: 'test' });
      expect(result.data.content).toBe('test');
    });

    it('should delete health memo', async () => {
      mockService.deleteHealthMemo.mockResolvedValue({});
      const result = await controller.deleteHealthMemo('m-1', mockReq);
      expect(result.data.deleted).toBe(true);
    });
  });

  // ── satisfaction ──

  describe('satisfaction', () => {
    it('should list satisfaction surveys', async () => {
      mockService.getSatisfactionSurveys.mockResolvedValue([{ id: 's-1' }]);
      const result = await controller.getSatisfaction(mockReq);
      expect(result.data).toHaveLength(1);
    });

    it('should submit satisfaction', async () => {
      mockService.submitSatisfaction.mockResolvedValue({ id: 's-1', overallRating: 5 });
      const result = await controller.submitSatisfaction(mockReq, { overallRating: 5 });
      expect(result.data.overallRating).toBe(5);
    });
  });

  // ── surgery checklist ──

  describe('surgeryChecklist', () => {
    it('should return surgery checklists', async () => {
      mockService.getPatientSurgeryChecklists.mockResolvedValue([{ id: 'surg-1' }]);
      const result = await controller.getSurgeryChecklist(mockReq);
      expect(result.data).toHaveLength(1);
    });
  });

  // ── insurance guide ──

  describe('insuranceGuide', () => {
    it('should return insurance guide', async () => {
      mockService.getInsuranceClaimGuide.mockReturnValue({ title: '실비보험', steps: [] });
      const result = await controller.getInsuranceGuide();
      expect(result.data.title).toBe('실비보험');
    });
  });

  // ── messages ──

  describe('messages', () => {
    it('should list messages', async () => {
      mockService.getMessages.mockResolvedValue([{ id: 'msg-1' }]);
      const result = await controller.getMessages(mockReq);
      expect(result.data).toHaveLength(1);
    });

    it('should send message', async () => {
      mockService.sendMessage.mockResolvedValue({ id: 'msg-1', sender: 'PATIENT' });
      const result = await controller.sendMessage(mockReq, { content: 'hello' });
      expect(result.data.sender).toBe('PATIENT');
    });

    it('should reply to message', async () => {
      mockService.replyToMessage.mockResolvedValue({ id: 'msg-2', content: 'RE: reply' });
      const result = await controller.replyToMessage(mockReq, { messageId: 'msg-1', content: 'reply' });
      expect(result.data.content).toContain('RE:');
    });
  });

  // ── unpaid billings ──

  describe('unpaidBillings', () => {
    it('should return unpaid billings', async () => {
      mockService.getUnpaidBillings.mockResolvedValue([{ id: 'b-1', status: 'PENDING' }]);
      const result = await controller.getUnpaidBillings(mockReq);
      expect(result.data[0].status).toBe('PENDING');
    });
  });

  // ── consents ──

  describe('consents', () => {
    it('should list consents', async () => {
      mockService.getPatientConsents.mockResolvedValue([{ id: 'c-1' }]);
      const result = await controller.getConsents(mockReq);
      expect(result.data).toHaveLength(1);
    });

    it('should sign consent', async () => {
      mockService.signConsent.mockResolvedValue({ id: 'c-1', status: 'SIGNED' });
      const result = await controller.signConsent('c-1', mockReq, { signature: 'sig-data' });
      expect(result.data.status).toBe('SIGNED');
    });
  });

  // ── allergies / questionnaires ──

  describe('allergies', () => {
    it('should return allergies', async () => {
      mockService.getAllergies.mockResolvedValue([{ id: 'a-1' }]);
      const result = await controller.getAllergies(mockReq);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('questionnaires', () => {
    it('should return questionnaires', async () => {
      mockService.getQuestionnaires.mockResolvedValue([{ id: 'qt-1' }]);
      const result = await controller.getQuestionnaires(mockReq);
      expect(result.data).toHaveLength(1);
    });
  });

  // ── health dashboard ──

  describe('healthDashboard', () => {
    it('should return dashboard data', async () => {
      mockService.getHealthDashboard.mockResolvedValue({ vitals: {}, activeRx: [], problems: [] });
      const result = await controller.getHealthDashboard(mockReq);
      expect(result.data.vitals).toBeDefined();
    });
  });

  // ── medication schedule / check ──

  describe('medicationSchedule', () => {
    it('should return medication schedule', async () => {
      mockService.getMedicationSchedule.mockResolvedValue([{ id: 'rx-1', slots: ['아침 식후'] }]);
      const result = await controller.getMedicationSchedule(mockReq);
      expect(result.data[0].slots).toBeDefined();
    });

    it('should check medication', async () => {
      mockService.checkMedication.mockResolvedValue({ success: true });
      const result = await controller.checkMedication(mockReq, { prescriptionId: 'rx-1', slot: '아침 식후', taken: true });
      expect(result.data.success).toBe(true);
    });
  });

  // ── annual billing summary ──

  describe('annualBillingSummary', () => {
    it('should return annual summary', async () => {
      mockService.getAnnualBillingSummary.mockResolvedValue({ year: 2026, totalVisits: 5 });
      const result = await controller.getAnnualBillingSummary(mockReq, '2026');
      expect(result.data.year).toBe(2026);
    });
  });

  // ── family switch ──

  describe('familySwitch', () => {
    it('should switch family account', async () => {
      mockService.switchFamily.mockResolvedValue({ switched: true, patientId: 'p-2' });
      const result = await controller.switchFamily(mockReq, { linkedPatientId: 'p-2' });
      expect(result.data.switched).toBe(true);
    });
  });

  // ── certificates ──

  describe('certificates', () => {
    it('should request certificate', async () => {
      mockService.requestCertificate.mockResolvedValue({ id: 'cert-1', status: 'PENDING' });
      const result = await controller.requestCertificate(mockReq, { publicKey: 'pk', algorithm: 'RSA' });
      expect(result.data.status).toBe('PENDING');
    });

    it('should list certificates', async () => {
      mockService.getPatientCertificates.mockResolvedValue([{ id: 'cert-1' }]);
      const result = await controller.getMyCertificates(mockReq);
      expect(result.data).toHaveLength(1);
    });
  });

  // ── audit log ──

  describe('auditLog', () => {
    it('should return audit log', async () => {
      mockService.getPatientAuditLog.mockResolvedValue({ btgAccesses: [], accessLogs: [] });
      const result = await controller.getAuditLog(mockReq);
      expect(result.data.btgAccesses).toBeDefined();
      expect(result.data.accessLogs).toBeDefined();
    });
  });

  // ── Response Format ──

  describe('Response Format', () => {
    it('should wrap all GET responses in data object', async () => {
      mockService.getAppointments.mockResolvedValue([]);
      mockService.getEncounters.mockResolvedValue([]);
      mockService.getLabResults.mockResolvedValue([]);
      mockService.getDiagnosticTests.mockResolvedValue([]);
      mockService.getBillings.mockResolvedValue([]);
      mockService.getWaitingStatus.mockResolvedValue([]);
      mockService.getProfile.mockResolvedValue({});
      mockService.getAllergies.mockResolvedValue([]);
      mockService.getQuestionnaires.mockResolvedValue([]);

      const results = await Promise.all([
        controller.getAppointments(mockReq),
        controller.getEncounters(mockReq),
        controller.getLabResults(mockReq),
        controller.getDiagnosticTests(mockReq),
        controller.getBillings(mockReq),
        controller.getWaitingStatus(mockReq),
        controller.getProfile(mockReq),
        controller.getAllergies(mockReq),
        controller.getQuestionnaires(mockReq),
      ]);

      results.forEach(r => expect(r).toHaveProperty('data'));
    });
  });

  // ── Error Handling ──

  describe('Error Handling', () => {
    it('should propagate service errors', async () => {
      mockService.getAppointments.mockRejectedValue(new Error('DB error'));
      await expect(controller.getAppointments(mockReq)).rejects.toThrow('DB error');
    });

    it('should propagate NotFoundException', async () => {
      mockService.getReceipt.mockRejectedValue(new NotFoundException('Not found'));
      await expect(controller.getReceipt('b-1', mockReq)).rejects.toThrow(NotFoundException);
    });
  });
});
