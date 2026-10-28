import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';

/**
 * 스크라이브 전용 WeRU.B STT 클라이언트 — 오디오 업로드·전사(diarize) 잡·폴링.
 * medical-ai `aiFetch`(private)와 동일 계약(런타임키·타임아웃·kill-switch)을 재현하되 격리한다
 * (medical-ai.service.ts 미접촉). 향후 aiFetch 공개 시 통합 권장.
 *
 * ⚠️ 인증: System/Image 태그 EP는 Bearer `ai.server.gpuKey`(sk-) 필요. Python UA는 403 → 브라우저 UA.
 * ⚠️ 응답 스키마: `/api/stt`·`/api/meeting/analyze`의 diarize 응답 형태는 실측 미확정(D-2).
 *    parseSegments는 방어적으로 여러 후보 경로를 시도 — 실 응답 캡처 후 정본화 필요.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface RawTranscriptSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
  embedding?: number[];
}
export interface RawTranscription {
  segments: RawTranscriptSegment[];
  diarized: boolean;
  hasEmbeddings: boolean;
  fullText: string;
}

@Injectable()
export class ScribeAiClient {
  private readonly logger = new Logger(ScribeAiClient.name);

  constructor(@Optional() private readonly config?: ConfigRuntimeService) {}

  private async cfg() {
    const url = ((await this.config?.get('ai.server.url')) as string) || ''; // P0-6
    const gpuKey = ((await this.config?.get('ai.server.gpuKey')) as string) || '';
    const enabled = (await this.config?.get('ai.server.enabled')) !== false;
    const timeoutMs = Number(await this.config?.get('ai.server.timeout')) || 30_000;
    return { url: url.replace(/\/$/, ''), gpuKey, enabled, timeoutMs };
  }

  private headers(gpuKey: string): Record<string, string> {
    return { Authorization: `Bearer ${gpuKey}`, 'User-Agent': UA };
  }

  /**
   * WeRU.B S3에 오디오 업로드 → presigned URL (meeting/analyze는 file_url 필수).
   * 전달방식: **개발**=WeRU.B `/api/image/s3/upload-raw`(wasabi) 경유 허용. **운영**=별도 내부 스토리지
   *   (HIS 자체 HMAC 서명 URL을 file_url로 넘겨 WeRU.B가 fetch → PHI가 HIS에 잔류·P-8)로 전환(D-9).
   *   전사 자체가 `scribe.transcription.enabled` 게이트(기본 OFF) 아래 있어 운영 전환 전엔 미노출.
   */
  async uploadAudio(buf: Buffer, filename: string, mime: string): Promise<string> {
    const { url, gpuKey, enabled, timeoutMs } = await this.cfg();
    if (!enabled) throw new ServiceUnavailableException({ code: 'AI_DISABLED', message: 'AI 서버 비활성(kill-switch)' });
    const fd = new FormData();
    fd.append('image', new Blob([buf], { type: mime }), filename);
    fd.append('filename', filename);
    // G3: 목적지 검증 + 경계 통과 감사(정본 common/util/ai-egress-fetch).
    // 🔴 여기로 나가는 것은 **진료 녹취 원음**이다 — 검증 없이 나가던 자리(2026-08-20 봉합).
    const res = await aiEgressFetch(url, '/api/image/s3/upload-raw', {
      method: 'POST',
      headers: this.headers(gpuKey),
      body: fd,
      signal: AbortSignal.timeout(timeoutMs),
    }, { client: 'scribe/upload-audio' });
    if (!res.ok) throw new ServiceUnavailableException({ code: 'STT_UPLOAD_FAIL', message: `업로드 실패(${res.status})` });
    const j = (await res.json()) as { url?: string };
    if (!j.url) throw new ServiceUnavailableException({ code: 'STT_UPLOAD_FAIL', message: '업로드 URL 없음' });
    return j.url;
  }

  /** 전사+화자분리 잡 제출 → jobId (비동기) */
  async submitTranscription(fileUrl: string, diarize: boolean): Promise<string> {
    const { url, gpuKey, enabled, timeoutMs } = await this.cfg();
    if (!enabled) throw new ServiceUnavailableException({ code: 'AI_DISABLED', message: 'AI 서버 비활성(kill-switch)' });
    const res = await aiEgressFetch(url, '/api/meeting/analyze', {
      method: 'POST',
      headers: { ...this.headers(gpuKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_url: fileUrl, options: { diarize, summary: false }, metadata: { source: 'scribe' } }),
      signal: AbortSignal.timeout(timeoutMs),
    }, { client: 'scribe/submit-transcription' });
    const j = (await res.json().catch(() => ({}))) as { job_id?: string; id?: string };
    const jobId = j.job_id ?? j.id;
    if (!res.ok || !jobId) throw new ServiceUnavailableException({ code: 'STT_SUBMIT_FAIL', message: `전사 제출 실패(${res.status})` });
    return jobId;
  }

  /**
   * 잡 상태/결과 폴링(단건) — 완료/실패 여부와 raw 반환. 오케스트레이션은 서비스에서 백오프.
   *
   * 🔴 r3 B3 (2026-09-28): 종전에는 `res.ok` 를 보지 않았다 — 잡 만료·키 회전으로 401/404 가 오면 본문에
   *    `status` 가 없어 `'unknown'`(= 진행 중)이 되고, 세션은 TRANSCRIBING 에 영원히 멈췄다(재전사도 멱등 분기에 막힘).
   *    이제 비-2xx 는 `status:'http_error'` + `httpStatus` 로 **실패로** 말한다(서비스가 FAILED 로 전이 → 재전사 가능).
   */
  async pollJob(jobId: string): Promise<{ status: string; error?: string; httpStatus?: number; raw: unknown }> {
    const { url, gpuKey, timeoutMs } = await this.cfg();
    const res = await aiEgressFetch(url, `/api/meeting/job/${jobId}`, {
      headers: this.headers(gpuKey),
      signal: AbortSignal.timeout(timeoutMs),
    }, { client: 'scribe/poll-job' });
    const j = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
    if (!res.ok) return { status: 'http_error', httpStatus: res.status, error: j.error ?? `HTTP ${res.status}`, raw: j };
    return { status: j.status ?? 'unknown', error: j.error, raw: j };
  }

  /**
   * 방어적 전사 파서 — diarize 응답 스키마 미확정(D-2)이라 여러 후보 경로 시도.
   * 실 응답 1건 캡처 후 이 매핑을 정본화할 것.
   */
  parseTranscription(raw: unknown): RawTranscription {
    const r = raw as Record<string, any>;
    const cand: any =
      r?.result?.segments ?? r?.segments ?? r?.diarization ?? r?.result?.transcript?.segments ?? null;
    if (Array.isArray(cand) && cand.length) {
      const segments: RawTranscriptSegment[] = cand.map((s: any) => ({
        speaker: String(s.speaker ?? s.speaker_id ?? s.spk ?? 'UNKNOWN'),
        start: Number(s.start ?? s.start_ms ?? 0),
        end: Number(s.end ?? s.end_ms ?? 0),
        text: String(s.text ?? s.content ?? ''),
        embedding: Array.isArray(s.embedding) ? s.embedding : Array.isArray(s.vector) ? s.vector : undefined,
      }));
      return {
        segments,
        diarized: new Set(segments.map((s) => s.speaker)).size > 1,
        hasEmbeddings: segments.some((s) => Array.isArray(s.embedding)),
        fullText: segments.map((s) => s.text).join(' '),
      };
    }
    // 평문 폴백(화자분리 없음)
    const text = String(r?.result?.transcript?.text ?? r?.transcript?.text ?? r?.text ?? '');
    return {
      segments: text ? [{ speaker: 'UNKNOWN', start: 0, end: 0, text }] : [],
      diarized: false,
      hasEmbeddings: false,
      fullText: text,
    };
  }
}
