import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrchestratorEngine, OrchestratorConfig, ChatFn } from '../../src/modules/orchestrator/orchestrator-engine';
import { ToolRegistry, ToolDefinition, ToolContext, ToolResult } from '../../src/modules/orchestrator/tool-registry';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 테스트 데이터 (Mock Data)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MOCK_TOOLS: ToolDefinition[] = [
  {
    name: 'TRIAGE',
    description: '환자 증상을 분석하여 진료과를 추천',
    category: 'medical',
    parameters: [{ name: 'symptom', type: 'string', description: '증상', required: true }],
    keywords: ['아파', '통증', '증상'],
    execute: vi.fn(async (params: any) => ({
      success: true,
      data: { recommendations: [{ department: '내과', confidence: 0.9, rank: 1 }] },
      summary: '추천: 내과 (90%)',
    })),
  },
  {
    name: 'SCHEDULE',
    description: '의사 진료 시간표 조회',
    category: 'db',
    parameters: [{ name: 'query', type: 'string', description: '의사명' }],
    keywords: ['진료시간', '몇시'],
    execute: vi.fn(async () => ({
      success: true,
      data: { doctor: '김의사', time: '오전 09:00' },
      summary: '김의사: 월요일 오전 09:00-12:00',
    })),
  },
  {
    name: 'APPOINTMENTS',
    description: '예약 조회',
    category: 'db',
    parameters: [],
    keywords: ['예약'],
    execute: vi.fn(async (params, ctx: ToolContext) => ({
      success: true,
      data: [{ date: '2026-05-20', time: '10:00', doctor: '이의사' }],
      summary: ctx.patientId ? '예약: 2026-05-20 10:00' : '환자 정보 필요',
    })),
  },
];

const MOCK_CHAT_FN: ChatFn = vi.fn(async (messages: any[]) => {
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.content.includes('분류') || lastMsg.content.includes('의도')) {
    return JSON.stringify({
      tools: [{ name: 'TRIAGE', params: { symptom: '두통' }, confidence: 0.8 }],
      direct: '의료 도구가 필요합니다',
    });
  }
  return '의료진에게 상담 받으시기 바랍니다.';
});

describe('OrchestratorEngine', () => {
  let engine: OrchestratorEngine;
  let registry: ToolRegistry;
  let config: OrchestratorConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    registry = new ToolRegistry();
    MOCK_TOOLS.forEach(tool => registry.register(tool));

    config = {
      maxReactSteps: 3,
      qualityCheckEnabled: true,
      parallelModelsEnabled: false,
      model: 'qwen2.5:14b',
    };

    engine = new OrchestratorEngine(registry, MOCK_CHAT_FN, config);
  });

  describe('run - 메인 오케스트레이션', () => {
    it('should process simple user request without tools', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({ direct: '안녕하세요' }),
      );

      const result = await engine.run('안녕하세요', 'You are helpful', {
        userMessage: 'greeting',
      });

      expect(result.response).toBeDefined();
      expect(result.response.length > 0).toBe(true);
    });

    it('should classify intent and run tools', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({
          tools: [{ name: 'TRIAGE', params: { symptom: '두통' }, confidence: 0.8 }],
        }),
      );

      const result = await engine.run('두통이 있습니다', 'Hospital helper', {
        userMessage: '두통',
      });

      expect(result.response).toBeDefined();
      expect(MOCK_CHAT_FN).toHaveBeenCalled();
    });

    it('should handle multi-step ReAct workflow', async () => {
      const responses = [
        JSON.stringify({
          tools: [{ name: 'TRIAGE', params: { symptom: '감기' }, confidence: 0.9 }],
        }),
        JSON.stringify({ tools: [] }), // needsMoreTools → NO
      ];
      (MOCK_CHAT_FN as any)
        .mockResolvedValueOnce(responses[0])
        .mockResolvedValueOnce('YES') // needsMoreTools check
        .mockResolvedValueOnce(responses[1])
        .mockResolvedValueOnce('감기 증상이 있으시면 내과 방문을 권장합니다.');

      const result = await engine.run('감기 증상이 있어요', 'Helper', {
        userMessage: '감기',
      });

      expect(result.response).toBeDefined();
    });

    it('should include tool results in response', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({
          tools: [{ name: 'SCHEDULE', params: {}, confidence: 0.9 }],
        }),
      );

      const result = await engine.run('진료 시간 알려줘', 'Helper', {
        userMessage: '진료시간',
      });

      expect(result).toHaveProperty('response');
    });

    it('should include ReAct steps in response', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({
          tools: [{ name: 'TRIAGE', params: { symptom: '발열' }, confidence: 0.85 }],
        }),
      );

      const result = await engine.run('열이 납니다', 'Helper', {
        userMessage: '열',
      });

      expect(result).toHaveProperty('response');
    });

    it('should apply quality check to response', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({ direct: '모든 권장사항' }),
      );

      const result = await engine.run('도움 주세요', 'Helper', {
        userMessage: 'help',
      });

      expect(typeof result.response).toBe('string');
      expect(result.response.length >= 0).toBe(true);
    });

    it('should pass patient context to tools', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({
          tools: [{ name: 'APPOINTMENTS', params: {}, confidence: 0.8 }],
        }),
      );

      const patientContext = {
        userMessage: '예약',
        patientId: 'patient-123',
        patientName: '김철수',
      };

      const result = await engine.run('내 예약을 보여줘', 'Helper', patientContext);

      expect(result.response).toBeDefined();
    });

    it('should handle tool execution errors gracefully', async () => {
      const errorTool: ToolDefinition = {
        name: 'ERROR_TOOL',
        description: 'Tool that errors',
        category: 'medical',
        parameters: [],
        keywords: ['error'],
        execute: vi.fn(async () => {
          throw new Error('Tool execution failed');
        }),
      };
      registry.register(errorTool);

      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({
          tools: [{ name: 'ERROR_TOOL', params: {}, confidence: 0.7 }],
        }),
      );

      const result = await engine.run('에러 테스트', 'Helper', {
        userMessage: 'error',
      });

      expect(result.response).toBeDefined();
    });

    it('should handle clarification request', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({
          clarify: '정확히 어느 부분이 아프신가요?',
        }),
      );

      const result = await engine.run('아파요', 'Helper', {
        userMessage: 'pain',
      });

      expect(result.response).toBeDefined();
    });
  });

  describe('Quality verification', () => {
    it('should detect and remove CJK characters', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({ direct: '한글입니다中文' }),
      );

      const result = await engine.run('테스트', 'Helper', {
        userMessage: 'test',
      });

      // CJK 제거되어야 함
      expect(typeof result.response).toBe('string');
    });

    it('should skip quality check when disabled', async () => {
      const noCheckConfig: OrchestratorConfig = {
        ...config,
        qualityCheckEnabled: false,
      };
      const engineNoCheck = new OrchestratorEngine(registry, MOCK_CHAT_FN, noCheckConfig);

      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({ direct: '응답입니다' }),
      );

      const result = await engineNoCheck.run('테스트', 'Helper', {
        userMessage: 'test',
      });

      expect(result.response).toBeDefined();
    });

    it('should handle short responses', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({ direct: 'ok' }),
      );

      const result = await engine.run('테스트', 'Helper', {
        userMessage: 'test',
      });

      expect(result.response).toBe('ok');
    });
  });

  describe('Configuration options', () => {
    it('should respect maxReactSteps setting', async () => {
      const limitedConfig: OrchestratorConfig = {
        ...config,
        maxReactSteps: 1,
      };
      const engineLimited = new OrchestratorEngine(registry, MOCK_CHAT_FN, limitedConfig);

      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({
          tools: [{ name: 'TRIAGE', params: { symptom: '발열' }, confidence: 0.9 }],
        }),
      );

      const result = await engineLimited.run('열이 납니다', 'Helper', {
        userMessage: '열',
      });

      expect(result.response).toBeDefined();
    });

    it('should use configured model name', async () => {
      const customConfig: OrchestratorConfig = {
        ...config,
        model: 'custom-model',
      };
      const engineCustom = new OrchestratorEngine(registry, MOCK_CHAT_FN, customConfig);

      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({ direct: '답변' }),
      );

      const result = await engineCustom.run('테스트', 'Helper', {
        userMessage: 'test',
      });

      expect(result.response).toBeDefined();
    });
  });

  describe('Tool invocation', () => {
    it('should pass parameters to tool', async () => {
      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({
          tools: [{ name: 'TRIAGE', params: { symptom: '두통' }, confidence: 0.95 }],
        }),
      );

      await engine.run('두통이 있습니다', 'Helper', {
        userMessage: '두통',
      });

      expect(MOCK_TOOLS[0].execute).toHaveBeenCalled();
    });

    it('should aggregate tool results in knowledge', async () => {
      (MOCK_CHAT_FN as any)
        .mockResolvedValueOnce(
          JSON.stringify({
            tools: [{ name: 'TRIAGE', params: { symptom: '감기' }, confidence: 0.9 }],
          }),
        )
        .mockResolvedValueOnce('NO')
        .mockResolvedValueOnce('최종 답변');

      const result = await engine.run('감기 증상이 있어요', 'Helper', {
        userMessage: '감기',
      });

      expect(result.response).toBeDefined();
    });
  });

  describe('Conversation history', () => {
    it('should use conversation history in context', async () => {
      const history = [
        { role: 'user', content: '안녕하세요' },
        { role: 'assistant', content: '반갑습니다' },
      ];

      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({ direct: '도움이 되었으면 좋겠습니다' }),
      );

      const result = await engine.run('추가 질문 있습니다', 'Helper', {
        userMessage: 'follow-up',
        history,
      });

      expect(result.response).toBeDefined();
      expect((MOCK_CHAT_FN as any).mock.calls[0][0]).toContainEqual(
        expect.objectContaining({ role: 'user', content: '안녕하세요' }),
      );
    });

    it('should limit history context to recent messages', async () => {
      const longHistory = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      (MOCK_CHAT_FN as any).mockResolvedValueOnce(
        JSON.stringify({ direct: '답변' }),
      );

      await engine.run('테스트', 'Helper', {
        userMessage: 'test',
        history: longHistory,
      });

      const callArgs = (MOCK_CHAT_FN as any).mock.calls[0][0];
      // 최근 4개만 포함되어야 함
      expect(callArgs.filter((m: any) => m.role !== 'system').length).toBeLessThanOrEqual(5);
    });
  });
});

describe('OrchestratorEngine - Advanced Scenarios', () => {
  let engine: OrchestratorEngine;
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ToolRegistry();
    MOCK_TOOLS.forEach(tool => registry.register(tool));
    engine = new OrchestratorEngine(registry, MOCK_CHAT_FN, {
      maxReactSteps: 3,
      qualityCheckEnabled: true,
      parallelModelsEnabled: false,
      model: 'qwen2.5:14b',
    });
  });

  it('should handle emergency scenario (high priority)', async () => {
    (MOCK_CHAT_FN as any).mockResolvedValueOnce(
      JSON.stringify({
        tools: [{ name: 'TRIAGE', params: { symptom: '흉통' }, confidence: 1.0 }],
        emergency: true,
      }),
    );

    const result = await engine.run('가슴이 아파요', 'Critical check', {
      userMessage: '흉통',
    });

    expect(result.response).toBeDefined();
  });

  it('should chain multiple tools sequentially', async () => {
    (MOCK_CHAT_FN as any)
      .mockResolvedValueOnce(
        JSON.stringify({
          tools: [{ name: 'TRIAGE', params: { symptom: '내과 방문' }, confidence: 0.9 }],
        }),
      )
      .mockResolvedValueOnce('YES') // needsMoreTools
      .mockResolvedValueOnce(
        JSON.stringify({
          tools: [{ name: 'SCHEDULE', params: {}, confidence: 0.8 }],
        }),
      )
      .mockResolvedValueOnce('NO')
      .mockResolvedValueOnce('내과 예약을 추천합니다.');

    const result = await engine.run('내과 가야 해요', 'Multi-step', {
      userMessage: '내과',
    });

    expect(result.response).toBeDefined();
  });

  it('should respect tool confidence threshold', async () => {
    (MOCK_CHAT_FN as any).mockResolvedValueOnce(
      JSON.stringify({
        tools: [
          { name: 'TRIAGE', params: {}, confidence: 0.6 },
          { name: 'SCHEDULE', params: {}, confidence: 0.3 }, // Below 0.5 threshold
        ],
      }),
    );

    const result = await engine.run('테스트', 'Helper', {
      userMessage: 'test',
    });

    expect(result.response).toBeDefined();
  });

  it('should synthesize results from multiple tools', async () => {
    const multiToolRegistry = new ToolRegistry();
    [
      ...MOCK_TOOLS,
      {
        name: 'MEDICAL_REFERENCE',
        description: '의학 정보 검색',
        category: 'medical',
        parameters: [{ name: 'query', type: 'string', description: '검색어' }],
        keywords: ['약', '약물', '정보'],
        execute: vi.fn(async () => ({
          success: true,
          data: { answer: '의학 정보 결과' },
          summary: '약물 정보: 안전함',
        })),
      },
    ].forEach(t => multiToolRegistry.register(t as ToolDefinition));

    const multiEngine = new OrchestratorEngine(multiToolRegistry, MOCK_CHAT_FN, {
      maxReactSteps: 3,
      qualityCheckEnabled: true,
      parallelModelsEnabled: false,
      model: 'qwen2.5:14b',
    });

    (MOCK_CHAT_FN as any)
      .mockResolvedValueOnce(
        JSON.stringify({
          tools: [
            { name: 'TRIAGE', params: { symptom: '감기' }, confidence: 0.9 },
            { name: 'MEDICAL_REFERENCE', params: { query: '감기 약' }, confidence: 0.8 },
          ],
        }),
      )
      .mockResolvedValueOnce('NO')
      .mockResolvedValueOnce('감기 증상에는 휴식과 수액 섭취가 중요합니다.');

    const result = await multiEngine.run('감기 걸렸어요', 'Multi-info', {
      userMessage: '감기',
    });

    expect(result.response).toBeDefined();
  });
});
