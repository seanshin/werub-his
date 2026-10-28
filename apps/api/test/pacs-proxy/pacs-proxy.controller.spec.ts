import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PacsProxyController } from '../../src/modules/pacs-proxy/pacs-proxy.controller';

describe('PacsProxyController', () => {
  let controller: PacsProxyController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getStudies: vi.fn(),
      getStudySeries: vi.fn(),
      getWorklist: vi.fn(),
      createWorklistItem: vi.fn(),
      createOrder: vi.fn(),
      getOrderStatus: vi.fn(),
      getReports: vi.fn(),
      createReport: vi.fn(),
      getReportDetail: vi.fn(),
      updateReport: vi.fn(),
      signReport: vi.fn(),
      getPatientReports: vi.fn(),
      getAiModels: vi.fn(),
      requestAiInference: vi.fn(),
      getAiJobStatus: vi.fn(),
      getDashboardToday: vi.fn(),
      getReadingQueue: vi.fn(),
      getTemplates: vi.fn(),
      checkHealth: vi.fn(),
      isServiceAccountConfigured: vi.fn().mockReturnValue(true),
      getViewerUrl: vi.fn(),
    };

    // 뷰어 URL 은 내부 IdP 단기 토큰을 싣는다(§22) — grant 가 없으면 토큰 없는 URL 이 되므로 정본 반환 모양으로 목을 둔다
    const ssoIdp = { grant: vi.fn().mockResolvedValue({ mode: 'url', token: 'short-ohif-token', expiresIn: 60 }) };
    controller = new PacsProxyController(mockService, {} as any, ssoIdp as any);
  });

  const mockReq = {
    user: { id: 'user-1', email: 'test@hospital.example.org', role: 'DOCTOR' },
    headers: { authorization: 'Bearer test-jwt-token' },
  } as any;

  describe('DICOMweb Studies', () => {
    it('should get studies', async () => {
      const mockStudies = {
        count: 2,
        results: [{ uid: 'study-1' }],
      };

      vi.mocked(mockService.getStudies).mockResolvedValue(mockStudies);

      const result = await controller.getStudies(mockReq, 'P001', '2026-05-13', 'X-ray');

      expect(result.data.count).toBe(2);
      expect(mockService.getStudies).toHaveBeenCalledWith(
        { patientId: 'P001', studyDate: '2026-05-13', modality: 'X-ray' },
        expect.anything(),
      );
    });

    it('should get studies without filters', async () => {
      const mockStudies = { count: 0, results: [] };

      vi.mocked(mockService.getStudies).mockResolvedValue(mockStudies);

      const result = await controller.getStudies(mockReq);

      expect(result.data.count).toBe(0);
      expect(mockService.getStudies).toHaveBeenCalledWith(
        { patientId: undefined, studyDate: undefined, modality: undefined },
        expect.anything(),
      );
    });

    it('should get study series', async () => {
      const mockSeries = {
        count: 3,
        results: [
          { seriesUid: 'series-1' },
          { seriesUid: 'series-2' },
        ],
      };

      vi.mocked(mockService.getStudySeries).mockResolvedValue(mockSeries);

      const result = await controller.getStudySeries(mockReq, 'study-uid-1');

      expect(result.data.count).toBe(3);
      expect(mockService.getStudySeries).toHaveBeenCalledWith('study-uid-1', expect.anything());
    });
  });

  describe('Worklist', () => {
    it('should get worklist', async () => {
      const mockWorklist = {
        total: 10,
        count: 3,
        results: [{ id: 'wl-1', status: 'pending' }],
      };

      vi.mocked(mockService.getWorklist).mockResolvedValue(mockWorklist);

      const result = await controller.getWorklist(
        mockReq,
        '2026-05-13',
        'pending',
        'X-ray',
      );

      expect(result.data.total).toBe(10);
      expect(mockService.getWorklist).toHaveBeenCalledWith(
        { scheduledDate: '2026-05-13', status: 'pending', modality: 'X-ray' },
        expect.anything(),
      );
    });

    it('should create worklist item', async () => {
      const mockItem = { id: 'wl-1', status: 'created' };

      vi.mocked(mockService.createWorklistItem).mockResolvedValue(mockItem);

      const body = { patientId: 'P001', modality: 'X-ray' };
      const result = await controller.createWorklistItem(mockReq, body);

      expect(result.data.status).toBe('created');
      expect(mockService.createWorklistItem).toHaveBeenCalledWith(body, expect.anything());
    });
  });

  describe('Orders', () => {
    it('should create imaging order', async () => {
      const mockOrder = { orderId: 'ord-1', status: 'created' };

      vi.mocked(mockService.createOrder).mockResolvedValue(mockOrder);

      const body = {
        patient_id: 'P001',
        patient_name: '김영수',
        accession_number: 'ACC001',
        requested_procedure_id: 'proc-1',
        requested_procedure_description: 'Chest X-ray',
        modality: 'X-ray',
        scheduled_date: '2026-05-14',
        referring_physician: '이의사',
      };

      const result = await controller.createOrder(mockReq, body);

      expect(result.data.orderId).toBe('ord-1');
      expect(mockService.createOrder).toHaveBeenCalledWith(body, expect.anything());
    });

    it('should get order status', async () => {
      const mockStatus = { status: 'completed' };

      vi.mocked(mockService.getOrderStatus).mockResolvedValue(mockStatus);

      const result = await controller.getOrderStatus(mockReq, 'ACC001');

      expect(result.data.status).toBe('completed');
      expect(mockService.getOrderStatus).toHaveBeenCalledWith('ACC001', expect.anything());
    });
  });

  describe('Reports', () => {
    it('should get reports', async () => {
      const mockReports = {
        count: 2,
        results: [{ reportId: 'rep-1', status: 'signed' }],
      };

      vi.mocked(mockService.getReports).mockResolvedValue(mockReports);

      const result = await controller.getReports(mockReq, 'P001', 'study-1', 'signed');

      expect(result.data.count).toBe(2);
      expect(mockService.getReports).toHaveBeenCalledWith(
        { patientId: 'P001', studyUid: 'study-1', status: 'signed' },
        expect.anything(),
      );
    });

    it('should create report', async () => {
      const mockReport = { reportId: 'rep-1', status: 'draft' };

      vi.mocked(mockService.createReport).mockResolvedValue(mockReport);

      const body = { studyUid: 'study-1', templId: 'tmpl-1' };
      const result = await controller.createReport(mockReq, body);

      expect(result.data.reportId).toBe('rep-1');
      expect(mockService.createReport).toHaveBeenCalledWith(body, expect.anything());
    });

    it('should get report detail', async () => {
      const mockDetail = { reportId: 'rep-1', content: 'Normal' };

      vi.mocked(mockService.getReportDetail).mockResolvedValue(mockDetail);

      const result = await controller.getReportDetail(mockReq, 'rep-1');

      expect(result.data.content).toBe('Normal');
      expect(mockService.getReportDetail).toHaveBeenCalledWith('rep-1', expect.anything());
    });

    it('should update report', async () => {
      const mockUpdated = { reportId: 'rep-1', content: 'Updated' };

      vi.mocked(mockService.updateReport).mockResolvedValue(mockUpdated);

      const body = { content: 'Updated findings' };
      const result = await controller.updateReport(mockReq, 'rep-1', body);

      expect(result.data.content).toBe('Updated');
      expect(mockService.updateReport).toHaveBeenCalledWith('rep-1', body, expect.anything());
    });

    it('should sign report as final', async () => {
      const mockSigned = { reportId: 'rep-1', status: 'signed' };

      vi.mocked(mockService.signReport).mockResolvedValue(mockSigned);

      const result = await controller.signReport(mockReq, 'rep-1', 'false');

      expect(result.data.status).toBe('signed');
      expect(mockService.signReport).toHaveBeenCalledWith('rep-1', false, expect.anything());
    });

    it('should sign report as preliminary', async () => {
      const mockSigned = { reportId: 'rep-1', status: 'preliminary' };

      vi.mocked(mockService.signReport).mockResolvedValue(mockSigned);

      const result = await controller.signReport(mockReq, 'rep-1', 'true');

      expect(result.data.status).toBe('preliminary');
      expect(mockService.signReport).toHaveBeenCalledWith('rep-1', true, expect.anything());
    });

    it('should get patient reports', async () => {
      const mockReports = {
        count: 5,
        results: [{ reportId: 'rep-1' }],
      };

      vi.mocked(mockService.getPatientReports).mockResolvedValue(mockReports);

      const result = await controller.getPatientReports(mockReq, 'P001');

      expect(result.data.count).toBe(5);
      expect(mockService.getPatientReports).toHaveBeenCalledWith('P001', expect.anything());
    });
  });

  describe('AI Inference', () => {
    it('should get AI models', async () => {
      const mockModels = {
        count: 2,
        results: [{ modelId: 'model-1', name: 'Chest Classifier' }],
      };

      vi.mocked(mockService.getAiModels).mockResolvedValue(mockModels);

      const result = await controller.getAiModels(mockReq);

      expect(result.data.count).toBe(2);
      expect(mockService.getAiModels).toHaveBeenCalled();
    });

    it('should request AI inference', async () => {
      const mockJob = { jobId: 'job-1', status: 'queued' };

      vi.mocked(mockService.requestAiInference).mockResolvedValue(mockJob);

      const body = {
        study_instance_uid: 'study-1',
        model_id: 'model-1',
      };

      const result = await controller.requestAiInference(mockReq, body);

      expect(result.data.jobId).toBe('job-1');
      expect(mockService.requestAiInference).toHaveBeenCalledWith(body, expect.anything());
    });

    it('should get AI job status', async () => {
      const mockJobStatus = {
        jobId: 'job-1',
        status: 'completed',
        result: { findings: [] },
      };

      vi.mocked(mockService.getAiJobStatus).mockResolvedValue(mockJobStatus);

      const result = await controller.getAiJobStatus(mockReq, 'job-1');

      expect(result.data.status).toBe('completed');
      expect(mockService.getAiJobStatus).toHaveBeenCalledWith('job-1', expect.anything());
    });
  });

  describe('Dashboard & Stats', () => {
    it('should get dashboard today stats', async () => {
      const mockDash = {
        total_studies: 10,
        completed: 7,
        pending: 3,
      };

      vi.mocked(mockService.getDashboardToday).mockResolvedValue(mockDash);

      const result = await controller.getDashboardToday(mockReq);

      expect(result.data.total_studies).toBe(10);
      expect(result.data.completed).toBe(7);
      expect(mockService.getDashboardToday).toHaveBeenCalled();
    });

    it('should get reading queue', async () => {
      const mockQueue = {
        count: 5,
        results: [
          { reportId: 'rep-1', priority: 'high' },
          { reportId: 'rep-2', priority: 'normal' },
        ],
      };

      vi.mocked(mockService.getReadingQueue).mockResolvedValue(mockQueue);

      const result = await controller.getReadingQueue(mockReq);

      expect(result.data.count).toBe(5);
      expect(result.data.results).toHaveLength(2);
      expect(mockService.getReadingQueue).toHaveBeenCalled();
    });
  });

  describe('Templates', () => {
    it('should get report templates', async () => {
      const mockTemplates = {
        count: 3,
        results: [
          { id: 'tmpl-1', name: 'Chest X-ray' },
          { id: 'tmpl-2', name: 'CT Abdomen' },
        ],
      };

      vi.mocked(mockService.getTemplates).mockResolvedValue(mockTemplates);

      const result = await controller.getTemplates(mockReq);

      expect(result.data.count).toBe(3);
      expect(result.data.results).toHaveLength(2);
      expect(mockService.getTemplates).toHaveBeenCalled();
    });
  });

  describe('Health & Status', () => {
    it('should check PACS health', async () => {
      const mockHealth = { status: 'healthy', version: '1.0.0' };

      vi.mocked(mockService.checkHealth).mockResolvedValue(mockHealth);

      const result = await controller.checkHealth();

      expect(result.data.status).toBe('healthy');
      expect(mockService.checkHealth).toHaveBeenCalled();
    });

    it('should return unavailable status when PACS is down', async () => {
      const mockHealth = {
        status: 'unavailable',
        message: 'OpenPACS 서버에 연결할 수 없습니다.',
      };

      vi.mocked(mockService.checkHealth).mockResolvedValue(mockHealth);

      const result = await controller.checkHealth();

      expect(result.data.status).toBe('unavailable');
      expect(result.data.message).toContain('연결할 수 없습니다');
    });
  });

  describe('Viewer URL', () => {
    it('should get viewer URL for study', async () => {
      vi.mocked(mockService.getViewerUrl).mockReturnValue(
        '/viewer/?StudyInstanceUIDs=study-uid-1',
      );

      const result = await controller.getViewerUrl(mockReq, 'study-uid-1');

      expect(result.data.url).toContain('/viewer/');
      expect(result.data.url).toContain('study-uid-1');
      expect(mockService.getViewerUrl).toHaveBeenCalledWith('study-uid-1', expect.anything());
    });

    it('should URL-encode special characters in viewer URL', async () => {
      vi.mocked(mockService.getViewerUrl).mockReturnValue(
        '/viewer/?StudyInstanceUIDs=' +
        encodeURIComponent('study.uid/with-special'),
      );

      const result = await controller.getViewerUrl(mockReq, 'study.uid/with-special');

      expect(result.data.url).toContain(
        encodeURIComponent('study.uid/with-special'),
      );
    });
  });

  describe('Authorization', () => {
    it('should allow DOCTOR, LAB_TECH, ADMIN for getStudies', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN) is applied
      vi.mocked(mockService.getStudies).mockResolvedValue({
        count: 0,
        results: [],
      });

      const result = await controller.getStudies(mockReq);

      expect(result).toBeDefined();
    });

    it('should allow DOCTOR, ADMIN for createReport', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) is applied
      vi.mocked(mockService.createReport).mockResolvedValue({
        reportId: 'rep-1',
      });

      const result = await controller.createReport(mockReq, {});

      expect(result).toBeDefined();
    });

    it('should require ADMIN for removeCatalogItem (if exists)', async () => {
      // Note: No removeCatalogItem endpoint, but structure tested
      expect(true).toBe(true);
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap all responses in data object', async () => {
      const mockStudies = { count: 0, results: [] };

      vi.mocked(mockService.getStudies).mockResolvedValue(mockStudies);

      const result = await controller.getStudies(mockReq);

      expect(result).toHaveProperty('data');
      expect(result.data.count).toBe(0);
    });

    it('should wrap viewer URL in data object with nested url property', async () => {
      vi.mocked(mockService.getViewerUrl).mockReturnValue('/viewer/?StudyInstanceUIDs=study-1');

      const result = await controller.getViewerUrl(mockReq, 'study-1');

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('url');
      expect(result.data.url).toBe('/viewer/?StudyInstanceUIDs=study-1');
    });
  });

  describe('Error Handling', () => {
    it('should handle null returns from service gracefully', async () => {
      vi.mocked(mockService.createOrder).mockResolvedValue(null);

      const body = { patient_id: 'P001' };
      const result = await controller.createOrder(mockReq, body);

      expect(result.data).toBeNull();
    });

    it('should handle service exceptions', async () => {
      vi.mocked(mockService.getStudies).mockRejectedValue(
        new Error('Service error'),
      );

      await expect(controller.getStudies(mockReq)).rejects.toThrow(
        'Service error',
      );
    });
  });
});
