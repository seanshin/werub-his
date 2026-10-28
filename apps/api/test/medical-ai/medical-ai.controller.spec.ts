import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalAiController } from '../../src/modules/medical-ai/medical-ai.controller';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

describe('MedicalAiController', () => {
  let controller: MedicalAiController;
  let service: MedicalAiService;

  beforeEach(() => {
    const mockGetTools = vi.fn().mockReturnValue([]);

    service = {
      getStatus: vi.fn(),
      processCommand: vi.fn(),
      summarize: vi.fn(),
      analyze: vi.fn(),
      drugInfo: vi.fn(),
      explain: vi.fn(),
      draft: vi.fn(),
      triage: vi.fn(),
      triageDepartments: vi.fn(),
      reference: vi.fn(),
      updateFeedback: vi.fn(),
      getFeedbackStats: vi.fn(),
      getRegisteredTools: mockGetTools,
    } as any;

    controller = new MedicalAiController(service);
  });

  describe('GET /api/v1/ai/status (getStatus)', () => {
    it('should return AI service status', async () => {
      const mockStatus = {
        status: 'online',
        version: '3.0',
        knowledge_base: { documents: 10000 },
      };

      vi.mocked(service.getStatus).mockResolvedValue(mockStatus);

      const result = await controller.getStatus();

      expect(result.data).toBeDefined();
      expect(result.data.status).toBe('online');
      expect(service.getStatus).toHaveBeenCalled();
    });

    it('should include service details', async () => {
      const mockStatus = {
        status: 'online',
        version: '3.0',
        uptime: 3600,
        lastUpdate: new Date(),
      };

      vi.mocked(service.getStatus).mockResolvedValue(mockStatus);

      const result = await controller.getStatus();

      expect(result.data.version).toBe('3.0');
      expect(result.data.uptime).toBe(3600);
    });
  });

  describe('POST /api/v1/ai/chat (chat)', () => {
    it('should handle CLI command chat', async () => {
      const mockResult = { cmd: '/참고', type: 'reference', source: 'AI' as const, draft: false, data: { answer: '참고 자료' } };

      vi.mocked(service.processCommand).mockResolvedValue(mockResult);

      const result = await controller.chat({
        message: '/참고 두통',
        context: {},
      }, { id: 'u1', role: 'DOCTOR' });

      expect(result.data.type).toBe('reference');
      // 역할을 넘긴다 — 임상 판단 명령의 역할 검사는 서비스가 AI 호출 앞에서 한다
      expect(service.processCommand).toHaveBeenCalledWith('/참고 두통', {}, { role: 'DOCTOR' });
    });

    it('should pass context to service', async () => {
      const mockResult = { cmd: null, type: 'chat', source: 'AI' as const, draft: false, data: {} };
      vi.mocked(service.processCommand).mockResolvedValue(mockResult);

      const context = { patientId: '11111111-1111-4111-8111-111111111111' };

      await controller.chat({ message: '증상 문의', context }, { id: 'u1', role: 'NURSE' });

      expect(service.processCommand).toHaveBeenCalledWith('증상 문의', context, { role: 'NURSE' });
    });

    it('should handle various command types', async () => {
      const commands = ['/약물', '/감별', '/설명', '/초안'];

      for (const cmd of commands) {
        vi.mocked(service.processCommand).mockResolvedValue({ cmd, type: 'command', source: 'AI', draft: false, data: {} });

        const result = await controller.chat({
          message: `${cmd} 정보`,
        });

        expect(result.data).toBeDefined();
      }
    });
  });

  describe('POST /api/v1/ai/summarize (summarize)', () => {
    it('should summarize SOAP notes', async () => {
      const mockSummary = {
        soap: {
          subjective: '환자 호소: 두통',
          objective: '검사 결과 정상',
          assessment: '긴장성 두통',
          plan: '생활 습관 개선',
        },
      };

      vi.mocked(service.summarize).mockResolvedValue(mockSummary);

      const result = await controller.summarize({
        text: '환자가 3일간 두통을 호소합니다. 검사 결과 정상입니다.',
        specialty: '신경과',
      });

      expect(result.data).toHaveProperty('soap');
      expect(result.data.soap.assessment).toBe('긴장성 두통');
      expect(service.summarize).toHaveBeenCalledWith(
        '환자가 3일간 두통을 호소합니다. 검사 결과 정상입니다.',
        '신경과'
      );
    });

    it('should handle summary without specialty', async () => {
      const mockSummary = { soap: {} };
      vi.mocked(service.summarize).mockResolvedValue(mockSummary);

      const result = await controller.summarize({
        text: '요약할 텍스트',
      });

      expect(result.data).toBeDefined();
      expect(service.summarize).toHaveBeenCalled();
    });

    it('should include all SOAP components', async () => {
      const mockSummary = {
        soap: {
          subjective: 'S',
          objective: 'O',
          assessment: 'A',
          plan: 'P',
        },
      };

      vi.mocked(service.summarize).mockResolvedValue(mockSummary);

      const result = await controller.summarize({
        text: 'SOAP 작성',
        specialty: '내과',
      });

      expect(result.data.soap).toHaveProperty('subjective');
      expect(result.data.soap).toHaveProperty('objective');
      expect(result.data.soap).toHaveProperty('assessment');
      expect(result.data.soap).toHaveProperty('plan');
    });
  });

  describe('POST /api/v1/ai/diagnose (diagnose)', () => {
    it('should provide differential diagnosis', async () => {
      const mockDiagnosis = {
        diagnoses: [
          { disease: '편두통', confidence: 0.85, treatment: '트립탄 약물' },
          { disease: '긴장성 두통', confidence: 0.72 },
        ],
      };

      vi.mocked(service.analyze).mockResolvedValue(mockDiagnosis);

      const result = await controller.diagnose({
        symptoms: ['두통', '구역질'],
        age: 45,
        sex: 'M',
      });

      expect(result.data.diagnoses).toHaveLength(2);
      expect(result.data.diagnoses[0].confidence).toBe(0.85);
      expect(service.analyze).toHaveBeenCalled();
    });

    it('should include vitals in diagnosis', async () => {
      const mockDiagnosis = { diagnoses: [] };
      vi.mocked(service.analyze).mockResolvedValue(mockDiagnosis);

      const result = await controller.diagnose({
        symptoms: ['발열'],
        vitals: { temp: 38.5, hr: 100 },
      });

      expect(result.data).toBeDefined();
      expect(service.analyze).toHaveBeenCalled();
    });

    it('should include lab values in analysis', async () => {
      const mockDiagnosis = { diagnoses: [] };
      vi.mocked(service.analyze).mockResolvedValue(mockDiagnosis);

      await controller.diagnose({
        symptoms: ['기침'],
        labs: { wbc: 12000, crp: 50 },
        history: '폐렴 과거력',
      });

      expect(service.analyze).toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/ai/explain (explain)', () => {
    it('should generate patient explanation', async () => {
      const mockExplanation = {
        explanation: '고혈압은 혈압이 높아지는 질환입니다.',
        treatment: '약물 치료와 생활 습관 개선이 필요합니다.',
        lifestyle: ['나트륨 섭취 제한', '규칙적 운동'],
      };

      vi.mocked(service.explain).mockResolvedValue(mockExplanation);

      const result = await controller.explain({
        diagnosis: '고혈압',
        treatmentPlan: '항고혈압제 처방',
        patientLevel: 'general',
      });

      expect(result.data).toHaveProperty('explanation');
      expect(result.data).toHaveProperty('treatment');
      expect(service.explain).toHaveBeenCalledWith(
        '고혈압',
        '항고혈압제 처방',
        'general'
      );
    });

    it('should use default patient level', async () => {
      const mockExplanation = { explanation: '...' };
      vi.mocked(service.explain).mockResolvedValue(mockExplanation);

      await controller.explain({
        diagnosis: '진단',
        treatmentPlan: '치료',
      });

      expect(service.explain).toHaveBeenCalled();
    });

    it('should include lifestyle recommendations', async () => {
      const mockExplanation = {
        explanation: '설명',
        treatment: '치료',
        lifestyle: ['권장사항 1', '권장사항 2'],
      };

      vi.mocked(service.explain).mockResolvedValue(mockExplanation);

      const result = await controller.explain({
        diagnosis: '진단',
        treatmentPlan: '계획',
      });

      expect(result.data.lifestyle).toBeDefined();
    });
  });

  describe('POST /api/v1/ai/triage (triage)', () => {
    it('should recommend department for symptom', async () => {
      const mockTriage = {
        recommendations: [
          { rank: 1, department: '신경과', confidence: 0.95, reason: '두통' },
          { rank: 2, department: '내과', confidence: 0.45 },
        ],
      };

      vi.mocked(service.triage).mockResolvedValue(mockTriage);

      const result = await controller.triage({
        symptom: '지속적인 두통',
      });

      expect(result.data.recommendations).toHaveLength(2);
      expect(result.data.recommendations[0].department).toBe('신경과');
      expect(result.data.recommendations[0].confidence).toBe(0.95);
      // 🔴 나이·성별을 함께 넘긴다(2026-08-26) — 종전엔 컨트롤러가 이 둘을 버려
      //    화면이 보내던 `age` 가 AI 에 닿은 적이 없었다. 모르는 값은 undefined 로 간다.
      expect(service.triage).toHaveBeenCalledWith('지속적인 두통', { age: undefined, sex: undefined });
    });

    it('🔴 나이·성별이 오면 그대로 서비스에 넘어간다(KTAS 소아·고령 가중)', async () => {
      vi.mocked(service.triage).mockResolvedValue({ recommendations: [] });
      await controller.triage({ symptom: '흉통', age: 6, sex: 'M' });
      expect(service.triage).toHaveBeenCalledWith('흉통', { age: 6, sex: 'M' });
    });

    it('should indicate confidence level for each recommendation', async () => {
      const mockTriage = {
        recommendations: [
          { rank: 1, department: '과1', confidence: 0.9 },
          { rank: 2, department: '과2', confidence: 0.7 },
        ],
      };

      vi.mocked(service.triage).mockResolvedValue(mockTriage);

      const result = await controller.triage({
        symptom: '증상',
      });

      expect(result.data.recommendations[0].confidence).toBeGreaterThan(
        result.data.recommendations[1].confidence
      );
    });

    it('should include reason for each recommendation', async () => {
      const mockTriage = {
        recommendations: [
          {
            rank: 1,
            department: '과',
            confidence: 0.9,
            reason: '증상 특성상',
          },
        ],
      };

      vi.mocked(service.triage).mockResolvedValue(mockTriage);

      const result = await controller.triage({
        symptom: '증상',
      });

      expect(result.data.recommendations[0]).toHaveProperty('reason');
    });
  });

  describe('POST /api/v1/ai/reference (reference)', () => {
    it('should retrieve medical reference', async () => {
      const mockReference = {
        answer: '두통의 원인은 다양하며...',
        sources: ['의학 교과서', '임상 가이드'],
        relevance: 0.95,
      };

      vi.mocked(service.reference).mockResolvedValue(mockReference);

      const result = await controller.reference({
        question: '두통의 원인',
        category: '신경계',
      });

      expect(result.data).toHaveProperty('answer');
      expect(result.data).toHaveProperty('sources');
      expect(service.reference).toHaveBeenCalledWith('두통의 원인', '신경계');
    });

    it('should include source citations', async () => {
      const mockReference = {
        answer: '참고 내용',
        sources: ['출처1', '출처2', '출처3'],
      };

      vi.mocked(service.reference).mockResolvedValue(mockReference);

      const result = await controller.reference({
        question: '의학 질문',
      });

      expect(result.data.sources.length).toBeGreaterThan(0);
    });

    it('should handle category-specific searches', async () => {
      const mockReference = { answer: '...' };
      vi.mocked(service.reference).mockResolvedValue(mockReference);

      await controller.reference({
        question: '질문',
        category: '약물',
      });

      expect(service.reference).toHaveBeenCalled();
    });
  });
});
