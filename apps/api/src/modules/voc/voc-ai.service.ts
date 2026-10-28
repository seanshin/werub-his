import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';

/**
 * VoC AI 컨시어지 C1~C5 — voc-service.plan.md §5.
 * 규약: 마스터(voc.ai.enabled)+기능별 게이트 전부 OFF 기본 · Human-in-loop(초안만·자동발송 금지)
 *      · PHI 경계(고객이 작성한 문의 본문만 전달·진료데이터 미전달) · 진단/임상판단 금지(분류·안내·번역만).
 * data-quality AI 패턴(llmGenerate·kill switch) 준용.
 */
@Injectable()
export class VocAiService {
  private readonly logger = new Logger(VocAiService.name);
  private readonly DEPARTMENTS = ['원무팀', '간호부', '진료부', '시설관리', '영양팀', '보험심사', '고객만족팀'];

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigRuntimeService) {}

  private async gate(feature: string): Promise<boolean> {
    const master = String((await this.config.get('voc.ai.enabled').catch(() => 'false')) ?? 'false') === 'true';
    if (!master) return false;
    return String((await this.config.get(`voc.ai.${feature}`).catch(() => 'false')) ?? 'false') === 'true';
  }

  /** WeRU.B generate(kill switch ai.server.enabled 상위 적용) */
  private async llmGenerate(prompt: string, timeoutMs = 60_000): Promise<string> {
    const [url, key, enabled] = await Promise.all([
      this.config.get('ai.server.url') as Promise<string | undefined>,
      this.config.get('ai.server.gpuKey') as Promise<string | undefined>,
      this.config.get('ai.server.enabled') as Promise<unknown>,
    ]);
    if (enabled === false || String(enabled) === 'false') throw new Error('AI 비활성(kill switch)');
    if (!url) throw new Error('ai.server.url 미설정');
    // G3: 목적지 검증 + 경계 통과 감사(정본 common/util/ai-egress-fetch).
    const res = await aiEgressFetch(url, '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: 'qwen2.5:14b', prompt, stream: false, options: { temperature: 0.2 } }),
      signal: AbortSignal.timeout(timeoutMs),
    }, { client: 'voc-ai' });
    if (!res.ok) throw new Error(`AI 서버 ${res.status}`);
    let full = '';
    for (const line of (await res.text()).split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { full += (JSON.parse(t) as { response?: string }).response ?? ''; } catch { /* skip */ }
    }
    return full.trim();
  }

  private extractJson(text: string): any {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }

  private async ticketText(id: string): Promise<{ title: string; body: string; type: string }> {
    const t = await this.prisma.vocTicket.findUnique({
      where: { id },
      select: { title: true, type: true, messages: { where: { authorType: 'PATIENT' }, orderBy: { createdAt: 'asc' }, take: 1, select: { body: true } } },
    });
    if (!t) throw new NotFoundException('문의를 찾을 수 없습니다.');
    return { title: t.title, body: t.messages[0]?.body ?? '', type: t.type };
  }

  /** C1 자동 분류 — 유형·카테고리·부서·심각도 제안(적용은 사람) */
  async classify(id: string) {
    if (!(await this.gate('classify'))) return { mode: 'off' as const };
    const { title, body } = await this.ticketText(id);
    const prompt = `너는 병원 고객의 소리 분류 보조자다. 아래 문의를 분류해 JSON만 출력하라.\n` +
      `type: QUESTION|COMPLAINT|SUGGESTION|COMPLIMENT 중 하나.\n` +
      `severity: LOW|NORMAL|HIGH|URGENT (환자안전·사고·감염 관련이면 URGENT).\n` +
      `department: ${this.DEPARTMENTS.join('|')} 중 가장 적합한 하나.\n` +
      `category: 20자 이내 핵심 주제.\n` +
      `임상 진단·판단 금지. JSON 형식: {"type","severity","department","category"}\n` +
      `문의 제목: ${title}\n문의 내용: ${body}`;
    try {
      const parsed = this.extractJson(await this.llmGenerate(prompt));
      if (!parsed) return { mode: 'ai' as const, suggestion: null };
      return { mode: 'ai' as const, suggestion: parsed, disclaimer: `${AI_ORIGIN_TEXT} 분류 제안 — 담당자 확인 후 적용하세요.` };
    } catch (e) {
      this.logger.warn(`C1 분류 실패: ${(e as Error).message}`);
      return { mode: 'error' as const };
    }
  }

  /** C2 즉답 초안 — FAQ/정책 기반 1차 안내 초안. aiDraft=true 로 스레드에 저장(미발송·직원 검토 후 발송) */
  async quickAnswerDraft(id: string) {
    if (!(await this.gate('autoReply'))) return { mode: 'off' as const };
    const { title, body } = await this.ticketText(id);
    const prompt = `너는 병원 고객 응대 보조자다. 아래 문의에 대한 답변 초안을 한국어로 정중히 작성하라.\n` +
      `- 확실치 않은 사실은 단정하지 말고 "담당자 확인 후 안내" 표현 사용.\n- 임상 진단·처방·검사결과 해석 금지(그런 문의는 "담당 의료진 확인 필요"로 안내).\n- 3~5문장.\n` +
      `문의 제목: ${title}\n문의 내용: ${body}`;
    try {
      const draft = await this.llmGenerate(prompt);
      if (!draft) return { mode: 'ai' as const, draft: null };
      // Human-in-loop: 초안을 aiDraft 메시지로 저장(환자 미노출까지는 아니나 발송 전 검토용). internal=true 로 격리.
      const msg = await this.prisma.vocMessage.create({
        data: { ticketId: id, authorType: 'AI', body: draft, aiDraft: true, internal: true },
        select: { id: true },
      });
      return { mode: 'ai' as const, messageId: msg.id, draft, disclaimer: '담당자 확인·수정 후 발송하세요(자동 발송 아님).' };
    } catch (e) {
      this.logger.warn(`C2 즉답 초안 실패: ${(e as Error).message}`);
      return { mode: 'error' as const };
    }
  }

  /** C3 답변 초안 보조 — 담당자 작성용 초안(저장 안 함·화면 표시만) */
  async replyAssist(id: string, staffNote?: string) {
    if (!(await this.gate('replyAssist'))) return { mode: 'off' as const };
    const { title, body } = await this.ticketText(id);
    const prompt = `너는 병원 고객 응대 답변 보조자다. 아래 문의와 담당자 메모를 참고해 정중한 답변 초안을 한국어로 작성하라.\n` +
      `- 임상 진단·처방 금지.\n- 정책 근거가 필요하면 "관련 규정에 따라" 수준으로만.\n- 3~5문장.\n` +
      `문의 제목: ${title}\n문의 내용: ${body}\n담당자 메모: ${staffNote ?? '(없음)'}`;
    try {
      const draft = await this.llmGenerate(prompt);
      return { mode: 'ai' as const, draft, disclaimer: `${AI_ORIGIN_TEXT} 초안 — 검토·수정 후 사용하세요.` };
    } catch (e) {
      this.logger.warn(`C3 답변 보조 실패: ${(e as Error).message}`);
      return { mode: 'error' as const };
    }
  }

  /** C4 다국어 번역 — 접수/답변 번역(외국인 응대) */
  async translate(text: string, targetLang: string) {
    if (!(await this.gate('translate'))) return { mode: 'off' as const };
    if (!text?.trim()) throw new BadRequestException('번역할 내용이 없습니다.');
    const LANG: Record<string, string> = { en: '영어', zh: '중국어', ja: '일본어', vi: '베트남어', ru: '러시아어', ko: '한국어' };
    const prompt = `다음 텍스트를 ${LANG[targetLang] ?? targetLang}로 자연스럽게 번역하라. 번역문만 출력.\n${text}`;
    try {
      return { mode: 'ai' as const, translated: await this.llmGenerate(prompt), targetLang };
    } catch (e) {
      this.logger.warn(`C4 번역 실패: ${(e as Error).message}`);
      return { mode: 'error' as const };
    }
  }

  /** C5 유사문의 클러스터 — 최근 불만 군집→개선과제 후보 제안(집계·본문만·식별자 0) */
  async cluster(days = 30) {
    if (!(await this.gate('cluster'))) return { mode: 'off' as const };
    const from = new Date(Date.now() - days * 86400_000);
    const rows = await this.prisma.vocTicket.findMany({
      where: { type: 'COMPLAINT', createdAt: { gte: from } },
      orderBy: { createdAt: 'desc' }, take: 60,
      select: { title: true },
    });
    if (rows.length < 3) return { mode: 'ai' as const, clusters: [], note: '군집화할 불만이 충분하지 않습니다.' };
    const titles = rows.map((r, i) => `${i + 1}. ${r.title}`).join('\n');
    const prompt = `너는 병원 고객불만 분석 보조자다. 아래 불만 제목 목록을 주제별로 군집화해 상위 3~5개 군집을 JSON으로 출력하라.\n` +
      `각 군집: {"theme":주제, "count":건수추정, "suggestedAction":개선과제 제안 1줄}. JSON: {"clusters":[...]}\n목록:\n${titles}`;
    try {
      const parsed = this.extractJson(await this.llmGenerate(prompt));
      return { mode: 'ai' as const, clusters: parsed?.clusters ?? [], disclaimer: `${AI_ORIGIN_TEXT} 군집 제안 — 개선과제 등록은 담당자 판단.` };
    } catch (e) {
      this.logger.warn(`C5 클러스터 실패: ${(e as Error).message}`);
      return { mode: 'error' as const };
    }
  }
}
