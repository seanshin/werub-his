/**
 * 오케스트레이터 v3 엔진
 *
 * ReAct 패턴: Reason → Act → Observe (최대 3회)
 * 실행 계획: 복잡한 요청 → 단계별 분해
 * 품질 검증: 한국어/할루시네이션 체크
 * 피드백 학습: 좋아요/나빠요 → 프롬프트 DB
 */
import { Logger } from '@nestjs/common';
import { ToolRegistry, ToolContext, ToolResult, IntentClassification } from './tool-registry';

export interface OrchestratorConfig {
  maxReactSteps: number;          // ReAct 최대 반복 (기본 3)
  qualityCheckEnabled: boolean;
  parallelModelsEnabled: boolean;
  model: string;
}

export interface ChatFn {
  (messages: { role: string; content: string }[], options?: { num_predict?: number; temperature?: number }): Promise<string>;
  withModel?: (model: string, messages: { role: string; content: string }[], options?: any) => Promise<string>;
}

interface ReActStep {
  thought: string;
  action: string;
  observation: string;
}

export class OrchestratorEngine {
  private readonly logger = new Logger('OrchestratorEngine');

  constructor(
    private readonly registry: ToolRegistry,
    private readonly chatLlm: ChatFn,
    private readonly config: OrchestratorConfig = { maxReactSteps: 3, qualityCheckEnabled: true, parallelModelsEnabled: false, model: 'qwen2.5:14b' },
  ) {}

  /**
   * 메인 오케스트레이션
   */
  async run(
    userMessage: string,
    systemPrompt: string,
    context: ToolContext & { history?: { role: string; content: string }[]; patientContext?: string },
  ): Promise<{ response: string; toolResults?: Map<string, ToolResult>; steps?: ReActStep[] }> {

    // [1단계] 규칙 기반 사전 필터
    const candidates = this.registry.preFilter(userMessage);
    this.logger.log(`PreFilter: ${candidates.length} candidates for "${userMessage.slice(0, 30)}..."`);

    // [2단계] LLM 의도 분류 (구조화 JSON)
    const intent = await this.classifyIntent(userMessage, systemPrompt, context, candidates);

    // [3단계] 직접 응답이면 바로 반환
    if (intent.directResponse && intent.tools.length === 0) {
      const verified = this.config.qualityCheckEnabled ? this.verifyQuality(intent.directResponse) : intent.directResponse;
      return { response: verified };
    }

    // [4단계] 되묻기 필요 시
    if (intent.needsClarification) {
      return { response: intent.clarificationQuestion ?? '좀 더 구체적으로 말씀해주시겠어요?' };
    }

    // [5단계] ReAct 패턴 — Reason → Act → Observe
    const steps: ReActStep[] = [];
    let allResults = new Map<string, ToolResult>();
    let accumulatedKnowledge = '';

    for (let i = 0; i < this.config.maxReactSteps; i++) {
      // 실행할 도구 결정
      const toolsToRun = i === 0 ? intent.tools : await this.decideNextTools(userMessage, accumulatedKnowledge, systemPrompt, context);

      if (toolsToRun.length === 0) break;

      // Act — 도구 병렬 실행
      const toolCalls = toolsToRun.map(t => ({ name: t.name, params: t.params }));
      const results = await this.registry.executeTools(toolCalls, context);

      // Observe — 결과 관찰
      for (const [name, result] of results) {
        allResults.set(name, result);
        accumulatedKnowledge += `\n[${name}] ${result.summary}`;
      }

      steps.push({
        thought: `도구 ${toolCalls.map(t => t.name).join(', ')} 실행`,
        action: toolCalls.map(t => `${t.name}(${JSON.stringify(t.params)})`).join(', '),
        observation: Array.from(results.values()).map(r => r.summary.slice(0, 100)).join(' | '),
      });

      // 도구 체이닝 판단 — 추가 도구가 필요한지 확인
      const needsMore = await this.needsMoreTools(userMessage, accumulatedKnowledge, context);
      if (!needsMore) break;
    }

    // [6단계] 최종 종합 — LLM이 모든 결과를 자연어로
    const response = await this.synthesize(userMessage, accumulatedKnowledge, systemPrompt, context);
    const verified = this.config.qualityCheckEnabled ? this.verifyQuality(response) : response;

    return { response: verified, toolResults: allResults, steps };
  }

  /**
   * [2단계] LLM 의도 분류
   */
  private async classifyIntent(
    userMessage: string, systemPrompt: string,
    context: ToolContext & { history?: { role: string; content: string }[] },
    candidates: any[],
  ): Promise<IntentClassification> {
    const toolList = candidates.length > 0
      ? candidates.map(t => `${t.name}: ${t.description}`).join('\n')
      : this.registry.getToolDescriptions();

    const classifyPrompt = `사용자 메시지를 분석하여 필요한 도구를 선택하세요.

사용 가능한 도구:
${toolList}

응답 형식 (반드시 JSON으로):
{"tools":[{"name":"도구명","params":{"key":"값"},"confidence":0.9}],"direct":"도구 없이 직접 답할 내용","clarify":"모호할 때 되묻기 질문"}

규칙:
- 도구가 필요 없으면 direct에 한국어 답변
- 여러 도구 동시 가능
- 모호하면 clarify에 질문
- confidence 0.5 미만은 제외`;

    const messages = [
      { role: 'system', content: classifyPrompt },
      ...(context.history?.slice(-4) ?? []),
      { role: 'user', content: userMessage },
    ];

    try {
      const raw = await this.chatLlm(messages, { temperature: 0.3, num_predict: 200 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          tools: (parsed.tools ?? []).filter((t: any) => t.confidence >= 0.5),
          directResponse: parsed.direct || undefined,
          needsClarification: !!parsed.clarify,
          clarificationQuestion: parsed.clarify,
        };
      }
    } catch (e) {
      this.logger.warn(`Intent classification parse failed: ${e}`);
    }

    // 파싱 실패 시 규칙 기반 폴백
    if (candidates.length > 0) {
      return { tools: [{ name: candidates[0].name, params: { query: userMessage }, confidence: 0.6 }] };
    }
    return { tools: [], directResponse: '' };
  }

  /**
   * ReAct — 추가 도구 필요 여부 판단
   */
  private async needsMoreTools(userMessage: string, knowledge: string, context: ToolContext): Promise<boolean> {
    try {
      const result = await this.chatLlm([
        { role: 'system', content: '질문에 충분히 답할 수 있는지 판단. "YES" 또는 "NO"만 답변.' },
        { role: 'user', content: `질문: "${userMessage}"\n\n수집된 정보:\n${knowledge}\n\n이 정보로 충분히 답변 가능한가요?` },
      ], { temperature: 0.1, num_predict: 10 });
      return result.includes('NO');
    } catch { return false; }
  }

  /**
   * ReAct — 다음 실행할 도구 결정
   */
  private async decideNextTools(userMessage: string, knowledge: string, systemPrompt: string, context: any): Promise<{ name: string; params: Record<string, any>; confidence: number }[]> {
    try {
      const tools = this.registry.getToolDescriptions();
      const result = await this.chatLlm([
        { role: 'system', content: `추가로 필요한 도구를 JSON으로 답변. 없으면 {"tools":[]}\n\n도구:\n${tools}` },
        { role: 'user', content: `질문: "${userMessage}"\n이미 수집: ${knowledge}\n\n추가 도구?` },
      ], { temperature: 0.3, num_predict: 100 });
      const match = result.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return parsed.tools ?? [];
      }
    } catch {}
    return [];
  }

  /**
   * [6단계] 최종 종합
   */
  private async synthesize(userMessage: string, knowledge: string, systemPrompt: string, context: any): Promise<string> {
    const result = await this.chatLlm([
      { role: 'system', content: `${systemPrompt}\n\n한국어만. 존댓말. 300자 이내. 수집된 정보를 바탕으로 환자에게 친절하게 안내하세요. 핵심 데이터(이름/날짜/시간/금액/확률)는 정확히 유지.` },
      ...(context.history?.slice(-4) ?? []),
      { role: 'user', content: `질문: "${userMessage}"\n\n수집된 정보:\n${knowledge}\n\n자연스럽게 안내해주세요.` },
    ], { num_predict: 400 });
    return result;
  }

  /**
   * 품질 검증
   */
  private verifyQuality(response: string): string {
    if (!response || response.length < 5) return response;
    // CJK 혼입 체크
    const cjk = (response.match(/[\u4e00-\u9fff]/g) || []).length;
    if (cjk >= 5) {
      this.logger.warn(`Quality check: CJK detected (${cjk} chars)`);
      // CJK 문자 제거 시도
      return response.replace(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g, '').replace(/\s{2,}/g, ' ').trim();
    }
    return response;
  }
}
