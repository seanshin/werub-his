/**
 * 오케스트레이터 v3 — 도구 레지스트리
 *
 * 도구를 동적으로 등록/해제하는 플러그인 구조.
 * 각 도구는 이름, 설명, 파라미터 스키마, 실행 함수를 가짐.
 */

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  name: string;                    // TRIAGE, SCHEDULE, DOCTORS, ...
  description: string;             // LLM에게 전달되는 설명
  category: 'medical' | 'db' | 'external' | 'system';
  parameters: ToolParameter[];
  keywords: string[];              // 규칙 기반 사전 필터용 키워드
  execute: (params: Record<string, any>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  patientId?: string;
  patientName?: string;
  department?: string;
  userMessage: string;
}

export interface ToolResult {
  success: boolean;
  data: any;
  summary: string;                 // LLM에 전달할 요약 텍스트
  metadata?: Record<string, any>;
}

export interface IntentClassification {
  tools: { name: string; params: Record<string, any>; confidence: number }[];
  directResponse?: string;         // 도구 불필요 시 직접 응답
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** LLM 시스템 프롬프트용 도구 설명 생성 */
  getToolDescriptions(): string {
    return this.getAll().map(t => {
      const params = t.parameters.length > 0
        ? ` (파라미터: ${t.parameters.map(p => `${p.name}${p.required ? '*' : ''}: ${p.description}`).join(', ')})`
        : '';
      return `- ${t.name}: ${t.description}${params}`;
    }).join('\n');
  }

  /** 규칙 기반 사전 필터 — 키워드 매칭으로 후보 도구 선정 */
  preFilter(userMessage: string): ToolDefinition[] {
    const msg = userMessage.toLowerCase();
    const candidates: { tool: ToolDefinition; score: number }[] = [];

    for (const tool of this.tools.values()) {
      let score = 0;
      for (const kw of tool.keywords) {
        if (msg.includes(kw)) score++;
      }
      if (score > 0) candidates.push({ tool, score });
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .map(c => c.tool);
  }

  /** 도구 병렬 실행 */
  async executeTools(
    toolCalls: { name: string; params: Record<string, any> }[],
    context: ToolContext,
  ): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();

    const promises = toolCalls.map(async (call) => {
      const tool = this.tools.get(call.name);
      if (!tool) {
        results.set(call.name, { success: false, data: null, summary: `도구 ${call.name}을(를) 찾을 수 없습니다.` });
        return;
      }
      try {
        const result = await tool.execute(call.params, context);
        results.set(call.name, result);
      } catch (e: unknown) {
        results.set(call.name, { success: false, data: null, summary: `${call.name} 실행 오류: ${e instanceof Error ? e.message : String(e)}` });
      }
    });

    await Promise.all(promises);
    return results;
  }
}
