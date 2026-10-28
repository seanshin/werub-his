import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PacsProxyService } from '../../src/modules/pacs-proxy/pacs-proxy.service';

describe('PacsProxyService', () => {
  let service: PacsProxyService;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      get: vi.fn((key: string, defaultVal?: string) => {
        const config: Record<string, string> = {
          OPENPACS_API_URL: 'http://127.0.0.1:8000',
          OPENPACS_USER: 'admin',
          OPENPACS_PASS: 'pacs1234!',
        };
        return config[key] ?? defaultVal;
      }),
    };

    service = new PacsProxyService(mockConfig as ConfigService);
    vi.clearAllMocks();
  });

  describe('Token Management', () => {
    it('should get token from PACS on first call', async () => {
      const mockToken = 'token-abc123';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: mockToken }),
      });

      // Access private getToken through reflection
      const token = await (service as any).getServiceToken();

      expect(token).toBe(mockToken);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8000/api/v1/auth/login',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should cache token until expiry', async () => {
      const mockToken = 'token-cached';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: mockToken }),
      });

      // First call
      const token1 = await (service as any).getServiceToken();
      const callCount1 = vi.mocked(global.fetch).mock.calls.length;

      // Second call within expiry
      const token2 = await (service as any).getServiceToken();
      const callCount2 = vi.mocked(global.fetch).mock.calls.length;

      expect(token1).toBe(token2);
      expect(callCount2).toBe(callCount1); // No additional fetch
    });

    it('should handle auth failure gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const token = await (service as any).getServiceToken();

      expect(token).toBe('');
    });

    it('should return empty token on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const token = await (service as any).getServiceToken();

      expect(token).toBe('');
    });

    it('should handle alternate token field name (data.token)', async () => {
      const mockToken = 'token-alternate';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: mockToken }),
      });

      const token = await (service as any).getServiceToken();

      expect(token).toBe(mockToken);
    });
  });

  describe('HTTP Request Wrapper', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'mock-token' }),
      });
    });

    it('should construct URL with query parameters', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [] }),
        });

      await (service as any).request('GET', '/api/v1/studies', undefined, {
        PatientID: 'P001',
        StudyDate: '2026-05-13',
      });

      const secondCall = vi.mocked(global.fetch).mock.calls[1];
      expect(secondCall[0]).toContain('PatientID=P001');
      expect(secondCall[0]).toContain('StudyDate=2026-05-13');
    });

    it('should skip undefined and empty query parameters', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [] }),
        });

      await (service as any).request('GET', '/api/v1/studies', undefined, {
        PatientID: 'P001',
        StudyDate: undefined,
        Modality: '',
      });

      const secondCall = vi.mocked(global.fetch).mock.calls[1];
      expect(secondCall[0]).toContain('PatientID=P001');
      expect(secondCall[0]).not.toContain('StudyDate');
      expect(secondCall[0]).not.toContain('Modality');
    });

    it('should include Authorization header when token exists', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'bearer-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: 'test' }),
        });

      await (service as any).request('GET', '/api/v1/studies');

      const secondCall = vi.mocked(global.fetch).mock.calls[1];
      const headers = secondCall[1]?.headers;
      expect(headers?.['Authorization']).toBe('Bearer bearer-token');
    });

    it('should handle 401 by clearing token cache', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        });

      const result = await (service as any).request('GET', '/api/v1/studies');

      expect(result).toBeNull();
      // Next call should request new token
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'new-token' }),
      });

      await (service as any).getServiceToken();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should return null on API error', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

      const result = await (service as any).request('GET', '/api/v1/studies');

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await (service as any).request('GET', '/api/v1/studies');

      expect(result).toBeNull();
    });
  });

  describe('DICOMweb Studies', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        });
    });

    it('should get studies with filters', async () => {
      const mockStudies = {
        count: 2,
        results: [
          { uid: 'study-1', patientId: 'P001', date: '2026-05-13' },
        ],
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockStudies,
        });

      const result = await service.getStudies({ patientId: 'P001' });

      expect(result.count).toBe(2);
      expect(result.results).toHaveLength(1);
    });

    // 🔴 종전 이 자리에는 "실패하면 count:0 을 돌려준다"가 **정상 동작으로 동결**돼 있었다.
    //    그 결과 운영에서 OpenPACS 401 이 화면에 "등록된 영상이 없습니다"로 나타났다(2026-08-18 실측).
    //    조회 실패는 '없음'이 아니다 — 503 으로 말한다.
    it('조회 실패를 "0건"으로 바꿔 말하지 않는다 (503)', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      await expect(service.getStudies({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('PACS 인증 실패(401)도 "0건"이 아니라 실패로 말한다', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
        .mockResolvedValueOnce({ ok: false, status: 401 });

      await expect(service.getStudies({})).rejects.toMatchObject({
        response: { error: 'PACS_UNAVAILABLE' },
      });
    });

    it('연결 자체가 안 되어도 "0건"이 아니라 실패로 말한다', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.getStudies({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('should get study series', async () => {
      const mockSeries = {
        count: 1,
        results: [{ seriesUid: 'series-1' }],
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSeries,
        });

      const result = await service.getStudySeries('study-uid-1');

      expect(result.count).toBe(1);
    });
  });

  describe('Worklist', () => {
    beforeEach(() => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        });
    });

    it('should get worklist', async () => {
      const mockWorklist = {
        total: 5,
        count: 3,
        results: [
          { id: 'wl-1', status: 'pending' },
        ],
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockWorklist,
        });

      const result = await service.getWorklist({});

      expect(result.total).toBe(5);
      expect(result.count).toBe(3);
    });

    it('워크리스트 조회 실패를 "0건"으로 바꿔 말하지 않는다 (503)', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
        });

      await expect(service.getWorklist({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('should create worklist item', async () => {
      const mockItem = { id: 'wl-1', status: 'created' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockItem,
        });

      const result = await service.createWorklistItem({ data: 'test' });

      expect(result.status).toBe('created');
    });
  });

  describe('Orders', () => {
    beforeEach(() => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        });
    });

    it('should create imaging order', async () => {
      const mockOrder = { orderId: 'ord-1', status: 'created' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOrder,
        });

      const orderData = {
        patient_id: 'P001',
        patient_name: '김영수',
        accession_number: 'ACC001',
        requested_procedure_id: 'proc-1',
        requested_procedure_description: 'Chest X-ray',
        modality: 'X-ray',
        scheduled_date: '2026-05-14',
        referring_physician: '이의사',
      };

      const result = await service.createOrder(orderData);

      expect(result.orderId).toBe('ord-1');
    });

    // 🔴 종전 이 자리는 `expect(result).toBeNull()` 이었다 — **결함을 계약으로 못박고 있었다.**
    //    쓰기가 조용히 null 이면 컨트롤러가 201 {data:null} 을 돌려주고 화면은 성공으로 그린다.
    it('🔴 오더 생성 실패는 예외로 올린다(조용한 null 금지)', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
        });

      const orderData = {
        patient_id: 'P001',
        patient_name: '김영수',
        accession_number: 'ACC001',
        requested_procedure_id: 'proc-1',
        requested_procedure_description: 'Chest X-ray',
        modality: 'X-ray',
        scheduled_date: '2026-05-14',
        referring_physician: '이의사',
      };

      await expect(service.createOrder(orderData)).rejects.toMatchObject({
        response: { error: 'PACS_WRITE_FAILED' },
      });
    });

    it('should get order status', async () => {
      const mockStatus = { status: 'completed', resultId: 'result-1' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockStatus,
        });

      const result = await service.getOrderStatus('ACC001');

      expect(result.status).toBe('completed');
    });
  });

  describe('Reports', () => {
    beforeEach(() => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        });
    });

    it('should get reports with filters', async () => {
      const mockReports = {
        count: 2,
        results: [
          { reportId: 'rep-1', status: 'signed' },
        ],
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReports,
        });

      const result = await service.getReports({ patientId: 'P001' });

      expect(result.count).toBe(2);
    });

    it('판독문 조회 실패를 "판독문 없음"으로 바꿔 말하지 않는다 (503)', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
        });

      await expect(service.getReports({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('should create report', async () => {
      const mockReport = { reportId: 'rep-1', status: 'draft' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReport,
        });

      const result = await service.createReport({ studyUid: 'study-1' });

      expect(result.reportId).toBe('rep-1');
    });

    it('should get report detail', async () => {
      const mockDetail = { reportId: 'rep-1', content: 'Normal' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDetail,
        });

      const result = await service.getReportDetail('rep-1');

      expect(result.content).toBe('Normal');
    });

    // 404("그런 리포트가 없다")와 그 외 실패("못 불러왔다")는 다른 사실이다 — 갈라 던진다.
    it('없는 리포트는 404 로, 조회 실패는 503 으로 갈라 말한다', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      await expect(service.getReportDetail('non-existent')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('리포트 조회 실패(502)는 "없음"이 아니라 503 으로 말한다', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
        .mockResolvedValueOnce({ ok: false, status: 502 });

      await expect(service.getReportDetail('any')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('should update report', async () => {
      const mockUpdated = { reportId: 'rep-1', content: 'Updated' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockUpdated,
        });

      const result = await service.updateReport('rep-1', { content: 'Updated' });

      expect(result.content).toBe('Updated');
    });

    it('should sign report as final', async () => {
      const mockSigned = { reportId: 'rep-1', status: 'signed' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSigned,
        });

      const result = await service.signReport('rep-1', false);

      expect(result.status).toBe('signed');
    });

    it('should sign report as preliminary', async () => {
      const mockSigned = { reportId: 'rep-1', status: 'preliminary' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSigned,
        });

      const result = await service.signReport('rep-1', true);

      expect(result.status).toBe('preliminary');
    });

    it('should get patient reports', async () => {
      const mockReports = {
        count: 3,
        results: [{ reportId: 'rep-1' }],
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReports,
        });

      const result = await service.getPatientReports('P001');

      expect(result.count).toBe(3);
    });
  });

  describe('AI Inference', () => {
    beforeEach(() => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        });
    });

    it('should get AI models', async () => {
      const mockModels = {
        count: 2,
        results: [
          { modelId: 'model-1', name: 'Chest X-ray Classifier' },
        ],
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockModels,
        });

      const result = await service.getAiModels();

      expect(result.count).toBe(2);
    });

    it('should request AI inference', async () => {
      const mockJob = { jobId: 'job-1', status: 'queued' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockJob,
        });

      const result = await service.requestAiInference({
        study_instance_uid: 'study-1',
        model_id: 'model-1',
      });

      expect(result.jobId).toBe('job-1');
    });

    it('🔴 AI 추론 요청 실패는 예외로 올린다(조용한 null 금지)', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
        });

      await expect(service.requestAiInference({
        study_instance_uid: 'study-1',
        model_id: 'model-1',
      })).rejects.toMatchObject({ response: { error: 'PACS_WRITE_FAILED' } });
    });

    it('should get AI job status', async () => {
      const mockJobStatus = { jobId: 'job-1', status: 'completed', result: {} };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockJobStatus,
        });

      const result = await service.getAiJobStatus('job-1');

      expect(result.status).toBe('completed');
    });
  });

  describe('Dashboard & Health', () => {
    beforeEach(() => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        });
    });

    it('should get dashboard today stats', async () => {
      const mockDash = { total_studies: 10, completed: 7, pending: 3 };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDash,
        });

      const result = await service.getDashboardToday();

      expect(result.total_studies).toBe(10);
    });

    // 🔴 운영 실측(2026-08-18): 401 인데 `/api/v1/pacs/dashboard/today` 가 "오늘 0건"을 200 으로
    //    돌려주고 있었다. 통계 0 은 "실적이 없다"는 다른 사실을 말한다.
    it('통계 조회 실패를 "오늘 0건"으로 바꿔 말하지 않는다 (503)', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
        });

      await expect(service.getDashboardToday()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('should get reading queue', async () => {
      const mockQueue = {
        count: 5,
        results: [{ reportId: 'rep-1' }],
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQueue,
        });

      const result = await service.getReadingQueue();

      expect(result.count).toBe(5);
    });

    it('should get templates', async () => {
      const mockTemplates = {
        count: 3,
        results: [{ id: 'tmpl-1', name: 'Chest' }],
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTemplates,
        });

      const result = await service.getTemplates();

      expect(result.count).toBe(3);
    });

    it('should check PACS health', async () => {
      const mockHealth = { status: 'healthy' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockHealth,
        });

      const result = await service.checkHealth();

      expect(result.status).toBe('healthy');
    });

    it('should return unavailable when PACS health check fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
        });

      const result = await service.checkHealth();

      expect(result.status).toBe('unavailable');
      expect(result.message).toContain('연결할 수 없습니다');
    });
  });

  describe('Viewer URL', () => {
    it('should generate viewer URL with study UID', () => {
      const url = service.getViewerUrl('study-uid-123');

      expect(url).toContain('/viewer/');
      expect(url).toContain('StudyInstanceUIDs=study-uid-123');
    });

    it('should URL-encode special characters in study UID', () => {
      const url = service.getViewerUrl('study.uid/with-special');

      expect(url).toContain(encodeURIComponent('study.uid/with-special'));
    });
  });
});
