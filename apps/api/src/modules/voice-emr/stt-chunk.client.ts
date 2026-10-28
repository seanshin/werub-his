import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';
import { EgressBlockedError } from '../../common/util/safe-fetch';

/**
 * VoiceEMR — WeRU.B 실시간 STT 청크 클라이언트 (격리·scribe-ai.client 패턴).
 * `/api/stt/chunk`(raw PCM 16-bit LE mono·Bearer gpuKey·브라우저 UA). Q1~Q13 계약.
 * 연결정보 재사용: ai.server.url + ai.server.gpuKey(prod SET). kill-switch=ai.server.enabled.
 */
export interface ChunkResult { text?: string; is_final?: boolean; confidence?: number; dropped_s?: number; session_max_s?: number; translation?: string; translation_held?: string }

@Injectable()
export class SttChunkClient {
  private readonly logger = new Logger(SttChunkClient.name);
  constructor(@Optional() private readonly config?: ConfigRuntimeService) {}

  private async cfg() {
    const url = ((await this.config?.get('ai.server.url')) as string) || '';
    const gpuKey = ((await this.config?.get('ai.server.gpuKey')) as string) || '';
    const enabled = (await this.config?.get('ai.server.enabled')) !== false;
    const timeoutMs = Number(await this.config?.get('ai.server.timeout')) || 30_000;
    return { url: url.replace(/\/$/, ''), gpuKey, enabled, timeoutMs };
  }

  private headers(gpuKey: string, extra: Record<string, string> = {}): Record<string, string> {
    // STT/System = Bearer(gpuKey)·Python UA는 403 → 브라우저 UA
    return {
      Authorization: `Bearer ${gpuKey}`,
      'User-Agent': 'Mozilla/5.0 (HospitalRUN VoiceEMR)',
      ...extra,
    };
  }

  private async ensure() {
    const c = await this.cfg();
    if (!c.enabled) throw new ServiceUnavailableException({ code: 'AI_DISABLED', message: 'AI 서버 비활성' });
    if (!c.url || !c.gpuKey) throw new ServiceUnavailableException({ code: 'AI_UNCONFIGURED', message: 'AI 서버 미구성' });
    return c;
  }

  /**
   * G3 — 이 클라이언트가 내보내는 것은 **진료 대화 원음(PCM)과 성문 표본**이다.
   * 2026-08-20 이전엔 `ai.server.url`(DB SystemConfig·관리화면에서 바꿀 수 있는 값)을 검증 없이
   * 그대로 fetch 했다. 목적지 검증+감사는 정본 `common/util/ai-egress-fetch` 하나로 통과시킨다.
   */
  private sttFetch(base: string, path: string, init: RequestInit) {
    return aiEgressFetch(base, path, init, { client: 'voice-emr/stt-chunk' });
  }

  /** 진료 시작 훅: 모델 워밍(콜드 18s 회피·Q2) */
  async warm(): Promise<void> {
    const c = await this.ensure();
    try {
      await this.sttFetch(c.url, '/api/stt/chunk/warm', { method: 'POST', headers: this.headers(c.gpuKey), signal: AbortSignal.timeout(20_000) });
    } catch (e) { this.logger.warn(`warm 실패(무시): ${e instanceof Error ? e.message : e}`); }
  }

  /** 어휘 바이어싱 등록(진료별 shortlist≤200·JSON·Q3) */
  async registerVocab(sessionId: string, terms: string[]): Promise<{ truncated?: boolean; terms_applied?: number }> {
    const c = await this.ensure();
    const res = await this.sttFetch(c.url, '/api/stt/chunk/vocab', {
      method: 'POST', headers: this.headers(c.gpuKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ session_id: sessionId, terms: terms.slice(0, 200) }), signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (!res.ok) return {};
    return (await res.json().catch(() => ({}))) as { truncated?: boolean; terms_applied?: number };
  }

  /**
   * raw PCM 청크 전송. mode=partial(누적 재인식·replace) | final(발화 종료·스티칭).
   * headers: X-Session-Id(발화 단위)·X-Mode·X-Sample-Rate·X-Lang·X-Targets(번역·선택).
   */
  async sendChunk(opts: { sessionId: string; pcm: Uint8Array; mode: 'partial' | 'final'; sampleRate?: number; lang?: string; targets?: string }): Promise<ChunkResult> {
    const c = await this.ensure();
    const res = await this.sttFetch(c.url, '/api/stt/chunk', {
      method: 'POST',
      headers: this.headers(c.gpuKey, {
        'Content-Type': 'application/octet-stream',
        'X-Session-Id': opts.sessionId,
        'X-Mode': opts.mode,
        'X-Sample-Rate': String(opts.sampleRate ?? 16000),
        'X-Lang': opts.lang ?? 'ko',
        ...(opts.targets ? { 'X-Targets': opts.targets } : {}),
      }),
      body: Buffer.from(opts.pcm),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (!res.ok) throw new ServiceUnavailableException({ code: 'STT_CHUNK_FAIL', message: `STT ${res.status}` });
    // 🔴 (2026-10-01 .catch 비리터럴 판정) 종전 `.catch(() => ({}))` — 200 인데 본문을 못 읽으면 빈 결과(= "말이 없었다")로 넘어가
    //    그 구간 발화가 조용히 사라졌다. 못 읽은 것은 STT 실패와 같은 경로로(호출자가 이미 STT_CHUNK_FAIL 을 다룬다).
    const parsed = await res.json().catch(() => null);
    if (parsed === null || typeof parsed !== 'object') {
      throw new ServiceUnavailableException({ code: 'STT_CHUNK_FAIL', message: 'STT 응답을 읽지 못했습니다' });
    }
    return parsed as ChunkResult;
  }

  /**
   * 화자 등록 표본 전송(성문 임베딩 누적·ECAPA). speakerId=HIS userId.
   * WeRU.B 엔드포인트 미확정 → fail-open: 미가용(404/네트워크) 시 { unavailable:true }.
   * HIS 는 이때 로컬로 표본수만 집계(pending) 후 계약 확정 시 재전송.
   */
  async enrollSample(opts: { speakerId: string; pcm: Uint8Array; sampleRate?: number; promptId?: string }): Promise<{ ok: boolean; unavailable?: boolean; ref?: string; samples?: number; quality?: number }> {
    let c;
    try { c = await this.ensure(); } catch { return { ok: false, unavailable: true }; }
    try {
      const res = await this.sttFetch(c.url, '/api/speaker/enroll', {
        method: 'POST',
        headers: this.headers(c.gpuKey, {
          'Content-Type': 'application/octet-stream',
          'X-Speaker-Id': opts.speakerId,
          'X-Sample-Rate': String(opts.sampleRate ?? 16000),
          ...(opts.promptId ? { 'X-Prompt-Id': opts.promptId } : {}),
        }),
        body: Buffer.from(opts.pcm),
        signal: AbortSignal.timeout(c.timeoutMs),
      });
      if (res.status === 404 || res.status === 405 || res.status === 501) return { ok: false, unavailable: true };
      if (!res.ok) return { ok: false };
      const j = (await res.json().catch(() => ({}))) as { speaker_id?: string; samples?: number; quality?: number };
      return { ok: true, ref: j.speaker_id ?? opts.speakerId, samples: j.samples, quality: j.quality };
    } catch (e) {
      // 🔴 egress 차단은 "WeRU.B 미가용"이 아니다 — 원인이 우리 설정이므로 다른 말로 남긴다.
      if (e instanceof EgressBlockedError) this.logger.error(`enrollSample egress 차단: ${e.message}`);
      else this.logger.warn(`enrollSample 미가용(무시): ${e instanceof Error ? e.message : e}`);
      return { ok: false, unavailable: true };
    }
  }

  /**
   * B2 성문 공용 인터페이스(§3-1) — 발화가 등록 화자(=speakerId)인지 대조.
   * 스크라이브(세그먼트 의사/환자 귀속·S2)·VoiceEMR(명령 화자 게이트·V4) **양 코어 공용 접점**.
   * WeRU.B `/api/speaker/match` 미확정 → fail-open: 미가용 시 { isEnrolled:false }(호출부가 마이크 분리 신뢰).
   * ※ 안전 원칙: 성문은 1차 필터일 뿐 **인증 아님** — 오더/활력은 통과 여부와 무관하게 확인게이트 항상 유지.
   */
  async matchSpeaker(speakerId: string, pcm: Uint8Array, sampleRate?: number): Promise<{ isEnrolled: boolean; score: number; isOwner: boolean }> {
    let c;
    try { c = await this.ensure(); } catch { return { isEnrolled: false, score: 0, isOwner: false }; }
    const threshold = Number(await this.config?.get('voiceEmr.speaker.threshold')) || 0.7;
    try {
      const res = await this.sttFetch(c.url, '/api/speaker/match', {
        method: 'POST',
        headers: this.headers(c.gpuKey, { 'Content-Type': 'application/octet-stream', 'X-Speaker-Id': speakerId, 'X-Sample-Rate': String(sampleRate ?? 16000) }),
        body: Buffer.from(pcm),
        signal: AbortSignal.timeout(c.timeoutMs),
      });
      if (res.status === 404 || res.status === 405 || res.status === 501 || !res.ok) return { isEnrolled: false, score: 0, isOwner: false };
      const j = (await res.json().catch(() => ({}))) as { enrolled?: boolean; score?: number };
      const score = typeof j.score === 'number' ? j.score : 0;
      return { isEnrolled: !!j.enrolled, score, isOwner: !!j.enrolled && score >= threshold };
    } catch (e) {
      // 차단이어도 반환값은 안전측(미등록)이다 — 성문은 인증이 아니므로 게이트가 느슨해지지 않는다.
      // 다만 원인은 구분해 남긴다(설정 사고를 상류 장애로 묻지 않는다).
      if (e instanceof EgressBlockedError) this.logger.error(`matchSpeaker egress 차단: ${e.message}`);
      return { isEnrolled: false, score: 0, isOwner: false };
    }
  }

  /** 성문 삭제(철회권·개인정보 파기). fail-open. */
  async deleteSpeaker(speakerId: string): Promise<{ ok: boolean; unavailable?: boolean }> {
    let c;
    try { c = await this.ensure(); } catch { return { ok: false, unavailable: true }; }
    try {
      const res = await this.sttFetch(c.url, `/api/speaker/${encodeURIComponent(speakerId)}`, { method: 'DELETE', headers: this.headers(c.gpuKey), signal: AbortSignal.timeout(c.timeoutMs) });
      if (res.status === 404 || res.status === 405 || res.status === 501) return { ok: false, unavailable: true };
      return { ok: res.ok };
    } catch (e) {
      // 파기(철회권) 경로 — 차단으로 못 지운 것을 "미가용"으로만 적으면 파기했다고 오독된다.
      if (e instanceof EgressBlockedError) this.logger.error(`deleteSpeaker egress 차단(원격 성문 미삭제): ${e.message}`);
      return { ok: false, unavailable: true };
    }
  }

  async status(): Promise<{ loaded?: boolean; idle_seconds?: number; vocab_persistent?: boolean }> {
    const c = await this.cfg();
    if (!c.url || !c.gpuKey) return {};
    try {
      const res = await this.sttFetch(c.url, '/api/stt/chunk/status', { headers: this.headers(c.gpuKey), signal: AbortSignal.timeout(8000) });
      return res.ok ? ((await res.json()) as { loaded?: boolean; idle_seconds?: number }) : {};
    } catch { return {}; }
  }
}
