import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry, ToolDefinition, ToolContext, ToolResult } from '../../src/modules/orchestrator/tool-registry';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  const createTool = (name: string, keywords: string[] = [], executeFn?: any): ToolDefinition => ({
    name,
    description: `${name} 도구`,
    category: 'medical',
    parameters: [{ name: 'query', type: 'string', description: '검색어', required: true }],
    keywords,
    execute: executeFn ?? vi.fn().mockResolvedValue({ success: true, data: {}, summary: 'OK' }),
  });

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register / unregister / get', () => {
    it('도구 등록 및 조회', () => {
      const tool = createTool('TRIAGE', ['트리아지', '분류']);
      registry.register(tool);
      expect(registry.get('TRIAGE')).toBe(tool);
      expect(registry.getAll()).toHaveLength(1);
    });

    it('도구 해제', () => {
      registry.register(createTool('TEST'));
      registry.unregister('TEST');
      expect(registry.get('TEST')).toBeUndefined();
      expect(registry.getAll()).toHaveLength(0);
    });

    it('존재하지 않는 도구 조회 시 undefined', () => {
      expect(registry.get('NONEXISTENT')).toBeUndefined();
    });
  });

  describe('getToolDescriptions', () => {
    it('LLM용 도구 설명 생성', () => {
      registry.register(createTool('SCHEDULE', ['예약']));
      registry.register(createTool('TRIAGE', ['트리아지']));
      const desc = registry.getToolDescriptions();
      expect(desc).toContain('SCHEDULE');
      expect(desc).toContain('TRIAGE');
      expect(desc).toContain('query*');
    });

    it('파라미터 없는 도구도 처리', () => {
      const tool: ToolDefinition = {
        name: 'SIMPLE', description: '단순', category: 'system',
        parameters: [], keywords: [],
        execute: vi.fn().mockResolvedValue({ success: true, data: null, summary: '' }),
      };
      registry.register(tool);
      const desc = registry.getToolDescriptions();
      expect(desc).toContain('SIMPLE');
      expect(desc).not.toContain('파라미터');
    });
  });

  describe('preFilter', () => {
    it('키워드 매칭으로 후보 도구 선정', () => {
      registry.register(createTool('SCHEDULE', ['예약', '일정']));
      registry.register(createTool('TRIAGE', ['트리아지', '응급']));
      registry.register(createTool('LAB', ['검사', '혈액']));

      const candidates = registry.preFilter('내일 예약 가능한 일정 확인');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe('SCHEDULE');
    });

    it('여러 키워드 매칭 시 점수순 정렬', () => {
      registry.register(createTool('A', ['예약']));
      registry.register(createTool('B', ['예약', '일정', '시간']));

      const candidates = registry.preFilter('예약 일정 시간 확인');
      expect(candidates[0].name).toBe('B'); // 점수 높은 순
    });

    it('매칭 없으면 빈 배열', () => {
      registry.register(createTool('A', ['예약']));
      const candidates = registry.preFilter('오늘 날씨');
      expect(candidates).toHaveLength(0);
    });
  });

  describe('executeTools', () => {
    const context: ToolContext = { userMessage: 'test', patientId: 'p-1' };

    it('도구 병렬 실행', async () => {
      const exec1 = vi.fn().mockResolvedValue({ success: true, data: { a: 1 }, summary: '도구1 완료' });
      const exec2 = vi.fn().mockResolvedValue({ success: true, data: { b: 2 }, summary: '도구2 완료' });
      registry.register(createTool('T1', [], exec1));
      registry.register(createTool('T2', [], exec2));

      const results = await registry.executeTools(
        [{ name: 'T1', params: { query: 'a' } }, { name: 'T2', params: { query: 'b' } }],
        context,
      );

      expect(results.size).toBe(2);
      expect(results.get('T1')?.success).toBe(true);
      expect(results.get('T2')?.summary).toBe('도구2 완료');
    });

    it('존재하지 않는 도구는 실패 결과', async () => {
      const results = await registry.executeTools(
        [{ name: 'NONEXISTENT', params: {} }],
        context,
      );
      expect(results.get('NONEXISTENT')?.success).toBe(false);
    });

    it('도구 실행 오류 시 에러 캡처', async () => {
      const failExec = vi.fn().mockRejectedValue(new Error('DB 연결 실패'));
      registry.register(createTool('FAIL', [], failExec));

      const results = await registry.executeTools(
        [{ name: 'FAIL', params: {} }],
        context,
      );
      expect(results.get('FAIL')?.success).toBe(false);
      expect(results.get('FAIL')?.summary).toContain('DB 연결 실패');
    });
  });
});
