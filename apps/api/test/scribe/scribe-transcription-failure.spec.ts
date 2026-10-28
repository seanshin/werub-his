import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScribeAiClient } from '../../src/modules/scribe/scribe-ai.client';
import { ScribeService } from '../../src/modules/scribe/scribe.service';
import { SpeakerResolver } from '../../src/modules/scribe/speaker-resolver';

/**
 * 🔴 r3 B3·B4 — 스크라이브 전사가 "실패"를 실패로 말하지 않던 두 자리.
 *
 *  B3 — `pollJob` 이 `res.ok` 를 보지 않았다: 잡 만료·키 회전으로 401/404 → 본문에 status 없음 → `'unknown'`
 *       → 세션이 TRANSCRIBING 에 영원히 멈춤(재제출도 멱등 분기가 같은 jobId 만 돌려줌).
 *  B4 — 파서가 세그먼트 0개를 내도 `TRANSCRIBED` — "무음"과 "파서가 못 읽음"(D-2 스키마 미확정)이 같은 모양.
 *
 * 실제 `ScribeAiClient`(fetch 만 가로챔)와 실제 `SpeakerResolver` 를 태운다 — 목이 내 가정이 되지 않게.
 */

const SESSION = { id: 's1', encounterId: 'e1', patientId: 'p1', doctorId: 'doc1', status: 'TRANSCRIBING', jobId: 'job-1' };

function make() {
  const session: Record<string, unknown> = { ...SESSION };
  const update = vi.fn(({ data }: { data: Record<string, unknown> }) => { Object.assign(session, data); return Promise.resolve(session); });
  const prisma = {
    encounter: { findUnique: vi.fn().mockResolvedValue({ id: 'e1', patientId: 'p1', doctorId: 'doc1' }) },
    scribeSession: {
      findUnique: vi.fn(() => Promise.resolve(session)),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(session)),
      update,
    },
    scribeVoiceProfile: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const cfgVals: Record<string, unknown> = {
    'scribe.enabled': true,
    'ai.server.url': 'http://10.0.0.5:8000', // 원내 사설망 — 호스트 목록 없이 나가는 목적지
    'ai.server.gpuKey': 'sk-test',
  };
  const config = { get: vi.fn((k: string) => Promise.resolve(cfgVals[k])) };
  const client = new ScribeAiClient(config as never);
  const svc = new ScribeService(prisma as never, client, new SpeakerResolver(), config as never);
  return { svc, session, update };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
afterEach(() => fetchSpy.mockRestore());
const reply = (status: number, body: unknown) => fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('🔴 B3 — 상류 비-2xx 는 "진행 중"이 아니라 실패다', () => {
  it.each([401, 404, 500])('잡 폴링 %i → FAILED(재전사 가능)', async (code) => {
    reply(code, { detail: 'nope' });
    const { svc, session, update } = make();
    await svc.getSession('e1', 's1', 'doc1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'FAILED' } });
    expect(session.status).toBe('FAILED');
  });

  it('pollJob 은 비-2xx 를 http_error + httpStatus 로 말한다', async () => {
    reply(401, {});
    const { svc } = make();
    const r = await (svc as unknown as { aiClient: ScribeAiClient }).aiClient.pollJob('job-1');
    expect(r).toMatchObject({ status: 'http_error', httpStatus: 401 });
  });

  it('대조군 — 2xx + running 은 진행 중(상태를 바꾸지 않는다)', async () => {
    reply(200, { status: 'running' });
    const { svc, session, update } = make();
    await svc.getSession('e1', 's1', 'doc1');
    expect(update).not.toHaveBeenCalled();
    expect(session.status).toBe('TRANSCRIBING');
  });
});

describe('🔴 B4 — 세그먼트 0개는 "전사 완료"가 아니다', () => {
  it('done + 파서가 모르는 키(utterances) → FAILED', async () => {
    reply(200, { status: 'done', result: { utterances: [{ who: 'A', said: '두통이 있어요' }] } });
    const { svc, session } = make();
    await svc.getSession('e1', 's1', 'doc1');
    expect(session.status).toBe('FAILED');
    expect(session.transcript).toBeUndefined();
  });

  it('done + 빈 결과 → FAILED', async () => {
    reply(200, { status: 'done', result: { segments: [] } });
    const { svc, session } = make();
    await svc.getSession('e1', 's1', 'doc1');
    expect(session.status).toBe('FAILED');
  });

  it('대조군 — done + 세그먼트가 있으면 TRANSCRIBED(성공을 실패로 말하지 않는다)', async () => {
    reply(200, {
      status: 'done',
      result: { segments: [
        { speaker: 'spk_0', start: 0, end: 1.2, text: '어디가 불편하세요' },
        { speaker: 'spk_1', start: 1.3, end: 2.5, text: '두통이 있어요' },
      ] },
    });
    const { svc, session } = make();
    await svc.getSession('e1', 's1', 'doc1');
    expect(session.status).toBe('TRANSCRIBED');
    expect(Array.isArray(session.transcript) && (session.transcript as unknown[]).length).toBe(2);
  });

  it('대조군 — done + 평문 전사(화자분리 없음)도 1세그먼트로 TRANSCRIBED', async () => {
    reply(200, { status: 'completed', text: '두통이 있어요' });
    const { svc, session } = make();
    await svc.getSession('e1', 's1', 'doc1');
    expect(session.status).toBe('TRANSCRIBED');
  });
});
