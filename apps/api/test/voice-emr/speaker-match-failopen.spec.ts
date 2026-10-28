import { describe, it, expect, vi, afterEach } from 'vitest';
import { SttChunkClient } from '../../src/modules/voice-emr/stt-chunk.client';

/**
 * 성문 대조(B2 공용 인터페이스) fail-open 회귀 — WeRU.B /api/speaker/match 미확정(405 등)이거나
 * AI 미구성이면 { isEnrolled:false } 로 저하해야 한다(호출부가 마이크 분리 신뢰). 안전 원칙: 성문은 인증 아님.
 */
function client(cfg: Record<string, unknown>) {
  const config: any = { get: vi.fn((k: string) => cfg[k]) };
  return new SttChunkClient(config);
}
const AI_OK = { 'ai.server.url': 'https://ai.example/ollama', 'ai.server.gpuKey': 'sk-x', 'ai.server.enabled': true, 'ai.server.timeout': 5000, 'voiceEmr.speaker.threshold': 0.7 };

afterEach(() => { vi.unstubAllGlobals(); });

describe('matchSpeaker fail-open', () => {
  it('AI 미구성(url 없음)이면 fail-open', async () => {
    const c = client({ ...AI_OK, 'ai.server.url': '' });
    const r = await c.matchSpeaker('u1', new Uint8Array([1, 2, 3]));
    expect(r).toEqual({ isEnrolled: false, score: 0, isOwner: false });
  });

  it('엔드포인트 미개설(405)이면 fail-open', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 405, json: async () => ({}) }));
    const r = await client(AI_OK).matchSpeaker('u1', new Uint8Array([1]));
    expect(r.isEnrolled).toBe(false);
    expect(r.isOwner).toBe(false);
  });

  it('등록 화자·점수≥τ 이면 isOwner=true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ enrolled: true, score: 0.92 }) }));
    const r = await client(AI_OK).matchSpeaker('u1', new Uint8Array([1]));
    expect(r).toEqual({ isEnrolled: true, score: 0.92, isOwner: true });
  });

  it('등록 화자여도 점수<τ 이면 isOwner=false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ enrolled: true, score: 0.4 }) }));
    const r = await client(AI_OK).matchSpeaker('u1', new Uint8Array([1]));
    expect(r.isEnrolled).toBe(true);
    expect(r.isOwner).toBe(false);
  });

  it('네트워크 예외도 fail-open', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const r = await client(AI_OK).matchSpeaker('u1', new Uint8Array([1]));
    expect(r.isEnrolled).toBe(false);
  });
});
