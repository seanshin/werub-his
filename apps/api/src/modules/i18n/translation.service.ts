import { Injectable, Logger } from '@nestjs/common';
import { configEnvOverride } from '../../common/config-env-overrides';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';
import { EgressBlockedError } from '../../common/util/safe-fetch';
import { aiDisabledException, isAiDisabledError, isAiServerEnabled } from '../../common/util/ai-kill-switch';

const LANG_NAME: Record<string, string> = {
  ko: 'Korean', en: 'English', zh: 'Chinese (Simplified)', ja: 'Japanese',
  ru: 'Russian', vi: 'Vietnamese', mn: 'Mongolian', ar: 'Arabic',
};

/**
 * 번역 결과 — 🔴 **원문이 돌아온 이유를 함께 든다.** `translated` 만 보면
 *    "번역된 것"과 "번역 못 해서 원문인 것"이 구분되지 않는다.
 */
export interface TranslateResult {
  translated: string;
  cached: boolean;
  /** 🔴 `true` = `translated` 는 **원문**이다(번역이 아니다) */
  fallback?: boolean;
  reason?: 'EMPTY' | 'SAME_LANG' | 'UNSUPPORTED_LANG' | 'ENGINE_FAILED' | 'AI_DISABLED';
}

/** 엔진이 번역할 수 있는 언어인가 — 🔴 언어 마스터(설정)와 **다를 수 있다**(th·kk 는 마스터에만 있다) */
export function engineSupportsLanguage(code: string): boolean {
  return !!LANG_NAME[code];
}

// 공유 자동 번역 엔진 — 온프레미스 Ollama + 캐시(PHI 외부 유출 없음)
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private cfgCache: { url: string; key: string; gpuKey: string; model: string; enabled: boolean; ts: number } = { url: '', key: '', gpuKey: '', model: '', enabled: true, ts: 0 };

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private async aiCfg() {
    const now = Date.now();
    if (now - this.cfgCache.ts < 30000 && this.cfgCache.url) return this.cfgCache;
    let url = this.config.get<string>('MEDICAL_AI_URL', ''); // P0-6: 미설정=번역 비활성(조용한 외부 송신 방지)
    let key = '';
    let gpuKey = '';
    let model = 'qwen2.5:14b';
    let enabled = true;
    try {
      const rows = await this.prisma.systemConfig.findMany({ where: { key: { in: ['ai.server.url', 'ai.server.apiKey', 'ai.server.gpuKey', 'ai.model', 'ai.server.enabled'] } } });
      const m = new Map(rows.map((r) => [r.key, r.value]));
    // 🔴 배포 환경변수가 DB 설정을 이긴다 — 정본 `common/config-env-overrides`
      url = configEnvOverride('ai.server.url') ?? ((m.get('ai.server.url') as string) || url);
      key = (m.get('ai.server.apiKey') as string) || key;
      gpuKey = (m.get('ai.server.gpuKey') as string) || gpuKey;
      model = (m.get('ai.model') as string) || model;
      enabled = isAiServerEnabled(m.get('ai.server.enabled')); // 정본 common/util/ai-kill-switch
    } catch { /* defaults */ }
    this.cfgCache = { url, key, gpuKey, model, enabled, ts: now };
    return this.cfgCache;
  }

  /**
   * 단건 번역 (캐시 우선). 실패/타임아웃 시 원문 반환(폴백).
   *
   * 🔴 **원문을 돌려주는 이유가 넷이고, 넷이 다른 사실이다.** 종전에는 앞의 셋을
   *    한 줄로 묶어 `{cached: true}` 로 답했다 — 엔진이 **모르는 언어**(`th`·`kk` 는
   *    언어 마스터에는 있고 엔진에는 없다)에도 "캐시에서 번역됨"이라 말하며
   *    한국어를 돌려줬다. 소비처는 그것을 번역문으로 저장한다.
   *
   *  · `EMPTY` / `SAME_LANG` — 번역할 것이 없다(정상 · 폴백 아님)
   *  · `UNSUPPORTED_LANG` — 🔴 **번역 못 했다**(폴백)
   *  · `ENGINE_FAILED` — 🔴 **번역 실패**(폴백)
   *  · `AI_DISABLED` — 🔴 **관리자가 AI 를 껐다**(`ai.server.enabled=false` · 폴백 · 요청을 보내지 않았다 — r3 B6)
   */
  async translate(text: string, target: string, source = 'ko'): Promise<TranslateResult> {
    const t = (text ?? '').trim();
    if (!t) return { translated: text, cached: true, reason: 'EMPTY' };
    if (target === source) return { translated: text, cached: true, reason: 'SAME_LANG' };
    // 🔴 엔진이 모르는 언어에 "번역했다"고 답하지 않는다 — 원문을 주되 폴백이라 말한다
    if (!LANG_NAME[target]) return { translated: text, cached: false, fallback: true, reason: 'UNSUPPORTED_LANG' };
    const hash = crypto.createHash('sha256').update(`${source}|${target}|${t}`).digest('hex');

    const hit = await this.prisma.translation.findUnique({ where: { hash } }).catch(() => null);
    if (hit) return { translated: hit.translated, cached: true };

    try {
      const out = await this.callOllama(t, source, target);
      const cfg = await this.aiCfg();
      await this.prisma.translation.create({
        data: { hash, sourceLang: source, targetLang: target, sourceText: t, translated: out, engine: cfg.model },
      }).catch(() => {});
      return { translated: out, cached: false };
    } catch (e) {
      // 🔴 egress 차단은 일시적 번역 실패가 아니라 **설정/보안 사고**다 — 같은 톤으로 묻지 않는다.
      //    화면 동작은 유지(원문 표시·fallback:true 로 정직하게 표기)하되 로그 레벨을 올린다.
      if (isAiDisabledError(e)) {
        return { translated: text, cached: false, fallback: true, reason: 'AI_DISABLED' };
      }
      if (e instanceof EgressBlockedError) {
        this.logger.error(`번역 egress 차단 — ai.server.url 이 허용되지 않습니다: ${e.message}`);
      } else {
        this.logger.warn(`번역 실패(폴백 원문): ${(e as Error).message}`);
      }
      return { translated: text, cached: false, fallback: true, reason: 'ENGINE_FAILED' };
    }
  }

  private async callOllama(text: string, source: string, target: string): Promise<string> {
    const prompt = `You are a professional UI translator. Translate the ${LANG_NAME[source] ?? source} text below into ${LANG_NAME[target]}.\nRules: Output ONLY the final translation on a single line. No quotes, no notes, no alternatives, no explanation, no romanization. If it is a short label or counting unit, give the single most natural equivalent. Keep proper nouns/brand names as-is. Do NOT switch to any other language than ${LANG_NAME[target]}.\n\nText: ${text}\nTranslation:`;
    // 출력 토큰 제한 — 모호한 짧은 입력에 대한 장황한 설명/폭주 방지(원문 길이에 비례, 최소 64)
    const cap = Math.min(512, Math.max(64, text.length * 4));
    const out = await this.complete(prompt, 60000, cap);
    // 안전장치: 줄바꿈 다수(설명형) 응답이면 첫 비어있지 않은 줄만 사용
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length > 3 ? lines[0] : out;
  }

  /**
   * 범용 LLM 생성 — /api/chat 스트리밍(서버 권장, 첫토큰 0.6s). NDJSON 증분 소비.
   * onToken(누적문자열) 콜백으로 토큰 단위 스트리밍 가능. 전체 텍스트 반환.
   */
  async complete(prompt: string, timeoutMs = 60000, maxTokens?: number, onToken?: (full: string) => void): Promise<string> {
    const cfg = await this.aiCfg();
    // 🔴 kill switch — 꺼져 있으면 보내지 않는다(r3 B6). 타이머를 걸기 전에 거절한다.
    if (!cfg.enabled) throw aiDisabledException();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.gpuKey) headers['Authorization'] = `Bearer ${cfg.gpuKey}`;
      else if (cfg.key) headers['X-Medical-Key'] = cfg.key;
      const body: Record<string, unknown> = { model: cfg.model, messages: [{ role: 'user', content: prompt }], stream: true };
      if (maxTokens) body.options = { num_predict: maxTokens };
      // 미설정과 '허용되지 않음'은 다른 사실이다.
      if (!cfg.url?.trim()) throw new Error('AI 서버 미설정(ai.server.url)');
      // G3: 목적지 검증 + 경계 통과 감사(정본 common/util/ai-egress-fetch). 타임아웃은 기존 ac.signal 유지.
      const res = await aiEgressFetch(cfg.url, '/api/chat', { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal }, { client: 'i18n/translation' });
      if (!res.ok || !res.body) throw new Error(`AI ${res.status}`);

      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      let buf = '';
      let out = '';
      const consume = (line: string) => {
        const s = line.trim();
        if (!s) return;
        try {
          const j = JSON.parse(s) as { message?: { content?: string }; response?: string };
          const tok = j.message?.content ?? j.response ?? '';
          if (tok) { out += tok; onToken?.(out); }
        } catch { /* skip */ }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) { consume(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      }
      if (buf) consume(buf);
      out = out.trim();
      if (!out) throw new Error('빈 응답');
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
}
