import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';
import { ConfigService } from '@nestjs/config';
import { ConfigRuntimeService } from '../../src/modules/config/config-runtime.service';

describe('MedicalAiService', () => {
  let service: MedicalAiService;
  let mockConfigService: any;
  let mockRuntimeConfig: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockConfigService = {
      get: vi.fn((key: string, defaultValue?: any) => {
        const config: Record<string, string> = {
          'MEDICAL_AI_URL': 'https://example.org/ollama',
          'MEDICAL_AI_KEY': 'test-key-123',
          'GPU_API_KEY': 'gpu-key-456',
        };
        return config[key] ?? defaultValue;
      }),
    };

    mockRuntimeConfig = {
      get: vi.fn().mockResolvedValue('서울'),
      getHospitalContext: vi.fn().mockResolvedValue('병원명: Hospital RUN\n주소: 서울시'),
    };

    mockPrisma = {
      aiFeedback: {
        create: vi.fn(),
        count: vi.fn(),
        aggregate: vi.fn(),
        update: vi.fn(),
      },
      systemConfig: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    service = new MedicalAiService(mockConfigService, mockRuntimeConfig, mockPrisma);
  });

  describe('summarize', () => {
    it('should summarize SOAP notes', async () => {
      const mockResponse = {
        soap: {
          subjective: '환자 호소: 두통 3일',
          objective: '체온 37.2°C',
          assessment: '긴장성 두통',
          plan: '진통제 처방',
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.summarize('두통 3일, 스트레스', '신경과');

      expect(result).toHaveProperty('soap');
      expect(mockConfigService.get).toHaveBeenCalledWith('MEDICAL_AI_URL', expect.any(String));
    });

    it('should use default specialty if not provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ soap: {} }),
      });

      await service.summarize('증상');

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('analyze', () => {
    it('should provide differential diagnosis', async () => {
      const mockResponse = {
        diagnoses: [
          { disease: '편두통', confidence: 0.85 },
          { disease: '긴장성 두통', confidence: 0.72 },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.analyze({
        symptoms: ['두통', '구역질'],
        age: 45,
        sex: 'M',
      });

      expect(result).toHaveProperty('diagnoses');
    });

    it('should include vitals and labs in analysis', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ diagnoses: [] }),
      });

      await service.analyze({
        symptoms: ['발열'],
        vitals: { temp: 38.5 },
        labs: { wbc: 12000 },
      });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('reference', () => {
    it('should retrieve medical reference information', async () => {
      const mockResponse = {
        answer: '두통의 주요 원인은...',
        sources: ['의학 교과서 1', '의학 교과서 2'],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.reference('두통 원인');

      expect(result).toHaveProperty('answer');
      expect(result).toHaveProperty('sources');
    });

    it('should support category filtering', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ answer: '...' }),
      });

      await service.reference('용량', '약물');

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('explain', () => {
    it('should generate patient-friendly explanation', async () => {
      const mockResponse = {
        explanation: '고혈압은...',
        treatment: '약물 치료와 생활 습관 개선이...',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.explain('고혈압', '항고혈압제 처방', 'general');

      expect(result).toHaveProperty('explanation');
    });

    it('should use default patient level if not provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ explanation: '...' }),
      });

      await service.explain('진단', '치료');

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('draft', () => {
    it('should generate medical record draft', async () => {
      const mockResponse = {
        draft: '2026-05-13 환자 방문. 주증상: 두통...',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.draft('progress_note', {
        subjective: '두통',
        objective: '정상',
      });

      expect(result).toHaveProperty('draft');
    });

    it('should support different draft types', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ draft: '...' }),
      });

      await service.draft('discharge_summary', { reason: '퇴원' });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('drugInfo', () => {
    it('should retrieve drug information', async () => {
      const mockResponse = {
        name: '아스피린',
        indication: '진통, 해열, 소염',
        dosage: '500mg 1-2정',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.drugInfo('아스피린');

      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('indication');
    });

    it('should translate drug information', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ name: '약물', translation: '약물 정보' }),
      });

      await service.drugInfo('ibuprofen');

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('triage', () => {
    it('should recommend department for symptom', async () => {
      const mockResponse = {
        recommendations: [
          { rank: 1, department: '신경과', confidence: 0.95, reason: '두통 증상' },
          { rank: 2, department: '내과', confidence: 0.45, reason: '전신 검진' },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.triage('지속적인 두통');

      expect(result).toHaveProperty('recommendations');
      expect(result.recommendations[0].rank).toBe(1);
    });

    it('should detect emergency warnings', async () => {
      const mockResponse = {
        emergency_warning: '응급 대응 필요',
        recommendations: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.triage('심한 가슴 통증');

      expect(result).toHaveProperty('emergency_warning');
    });

    it('should handle API fallback gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('API error'));

      const result = await service.triage('증상');

      expect(result).toBeNull();
    });
  });

  describe('triageDepartments', () => {
    it('should return available departments', async () => {
      const mockResponse = {
        departments: [
          { code: '01', name: '신경과' },
          { code: '02', name: '내과' },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.triageDepartments();

      expect(result).toHaveProperty('departments');
      expect(result.departments).toHaveLength(2);
    });

    it('should handle department query failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
      });

      const result = await service.triageDepartments();

      expect(result).toBeNull();
    });
  });

  describe('updateFeedback', () => {
    it('should update AI response feedback', async () => {
      const mockFeedback = {
        id: 'feedback-1',
        rating: 'GOOD',
        comment: '정확한 진단',
      };

      vi.mocked(mockPrisma.aiFeedback.update).mockResolvedValue(mockFeedback);

      const result = await service.updateFeedback('feedback-1', 'GOOD', '정확한 진단');

      expect(result.rating).toBe('GOOD');
      expect(mockPrisma.aiFeedback.update).toHaveBeenCalledWith({
        where: { id: 'feedback-1' },
        data: { rating: 'GOOD', comment: '정확한 진단' },
      });
    });

    it('should support ratings without comment', async () => {
      vi.mocked(mockPrisma.aiFeedback.update).mockResolvedValue({
        id: 'feedback-1',
        rating: 'BAD',
      });

      await service.updateFeedback('feedback-1', 'BAD');

      expect(mockPrisma.aiFeedback.update).toHaveBeenCalled();
    });
  });

  describe('getFeedbackStats', () => {
    it('should return feedback statistics', async () => {
      vi.mocked(mockPrisma.aiFeedback.count)
        .mockResolvedValueOnce(45) // good
        .mockResolvedValueOnce(5)  // bad
        .mockResolvedValueOnce(60); // total

      vi.mocked(mockPrisma.aiFeedback.aggregate).mockResolvedValue({
        _avg: { latencyMs: 1250 },
      });

      const result = await service.getFeedbackStats();

      expect(result.good).toBe(45);
      expect(result.bad).toBe(5);
      expect(result.total).toBe(60);
      expect(result.satisfactionRate).toBe(75);
    });

    /**
     * 🔴 (2026-09-17 L4) 종전엔 피드백 0 건에 `satisfactionRate: 0` 을 기대했다 — 만족도 0% 는
     *    "전원 불만"으로 읽힌다(J3 가 만족도·컨시어지 평점에서 고친 것과 같은 모양).
     */
    it('피드백 0 건이면 만족도는 null(0% 가 아니다)', async () => {
      vi.mocked(mockPrisma.aiFeedback.count)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      vi.mocked(mockPrisma.aiFeedback.aggregate).mockResolvedValue({
        _avg: { latencyMs: null },
      });

      const result = await service.getFeedbackStats();

      expect(result.total).toBe(0);
      expect(result.satisfactionRate).toBeNull();
      expect(result.avgLatencyMs).toBeNull(); // 표본 0 의 _avg 는 null 이다
    });

    it('should calculate neutral feedback count', async () => {
      vi.mocked(mockPrisma.aiFeedback.count)
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(100);

      vi.mocked(mockPrisma.aiFeedback.aggregate).mockResolvedValue({
        _avg: { latencyMs: 800 },
      });

      const result = await service.getFeedbackStats();

      expect(result.neutral).toBe(60); // 100 - 30 - 10
    });
  });

  describe('getStatus', () => {
    it('should retrieve AI service status', async () => {
      const mockStatus = {
        status: 'online',
        knowledge_base: { size: 10000, last_updated: '2026-05-13' },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockStatus),
      });

      const result = await service.getStatus();

      expect(result).toHaveProperty('connected');
    });
  });

  describe('getRegisteredTools', () => {
    it('should return list of registered tools', async () => {
      // This tests the tool registry functionality
      const tools = service.getRegisteredTools();

      expect(Array.isArray(tools)).toBe(true);
      // Tools should have name, description, category
      if (tools.length > 0) {
        expect(tools[0]).toHaveProperty('name');
        expect(tools[0]).toHaveProperty('description');
      }
    });
  });

  describe('generateNaturalResponse', () => {
    it('should generate natural language response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('{"message":{"content":"반갑습니다."}}'),
      });

      const result = await service.generateNaturalResponse(
        '온라인 예약 AI',
        '예약을 취소하고 싶습니다.'
      );

      expect(typeof result === 'string').toBe(true);
    });

    it('should use context if provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('{"message":{"content":"도움이 되길 바랍니다."}}'),
      });

      await service.generateNaturalResponse(
        'AI 도우미',
        '안내 메시지',
        '환자가 혼란스러워함'
      );

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('processCommand', () => {
    it('should parse slash command for drug info', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ info: '약물 정보' }),
      });

      const result = await service.processCommand('/약물 아스피린', null, { role: 'DOCTOR' });

      expect(result).toHaveProperty('type');
      expect(result.type).toBe('drug');
    });

    it('should parse slash command for diagnosis', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ diagnoses: [] }),
      });

      const result = await service.processCommand('/감별 두통,구역질', null, { role: 'DOCTOR' });

      expect(result.type).toBe('diagnose');
    });

    it('should parse slash command for explanation', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ explanation: '...' }),
      });

      const result = await service.processCommand('/설명 고혈압', null, { role: 'DOCTOR' });

      expect(result.type).toBe('explain');
    });

    it('should provide help for /도움 command', async () => {
      const result = await service.processCommand('/도움', null, { role: 'DOCTOR' });

      expect(result.type).toBe('help');
      expect((result.data as { commands: string[] }).commands.length).toBeGreaterThan(0);
    });

    it('should handle regular message as reference search', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ answer: '...' }),
      });

      const result = await service.processCommand('두통 치료법');

      expect(result.type).toBe('chat');
    });

    it('should use context from command', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ draft: '...' }),
      });

      const result = await service.processCommand('/초안 discharge_summary', {
        soap: { subjective: '두통', assessment: '긴장성 두통' },
      }, { role: 'DOCTOR' });

      expect(result.type).toBe('draft');
      expect(result.draft).toBe(true);
    });
  });

  describe('clinicalAnalyze', () => {
    it('should perform clinical analysis with translation', async () => {
      const mockResponse = {
        analysis: 'Clinical findings indicate...',
        recommendations: ['Further testing', 'Specialist referral'],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.clinicalAnalyze({
        findings: 'EKG shows abnormality',
      });

      expect(result).toHaveProperty('analysis');
    });
  });
});
