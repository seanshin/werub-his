import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { isAiDisabledError, isAiServerEnabled } from '../../src/common/util/ai-kill-switch';
import { FormularyService } from '../../src/modules/formulary/formulary.service';
import { GovernanceService } from '../../src/modules/gld/governance.service';
import { DrugExplainService } from '../../src/modules/portal/drug-explain.service';
import { TranslationService } from '../../src/modules/i18n/translation.service';

/**
 * 🔴 r3 B6 — kill switch `ai.server.enabled=false` 를 읽지 않던 AI 클라이언트 4곳.
 *
 * 관리자가 AI 를 꺼도 drug-explain·formulary·governance·translation 은 `ai.server.url` 로 프롬프트를 보냈다.
 * 못박는 것:
 *   (a) 꺼져 있으면 **fetch 가 한 번도 일어나지 않는다**(보내지 않는다) · 거절은 503 `AI_DISABLED`
 *   (b) 호출부는 조용히 폴백하지 않는다 — drug-explain=UNAVAILABLE(null) · translation=`reason:'AI_DISABLED'`
 *       · governance 사전 검토=거절 전파("AI 응답 파싱 실패" 로 둔갑하지 않는다)
 *   (c) 대조군 — 켜짐(명시 true)·미설정(행 없음)이면 실제로 보낸다(성공 경로를 막지 않는다)
 *
 * 목은 정본의 실제 모양을 쓴다: `system_configs.value` 는 Json — 불리언 `false` 로 들어온다.
 */

const URL = 'http://10.0.0.5:8000'; // 원내 사설망 — 호스트 목록 없이 나가는 목적지(ai-egress-url 규약)

type Row = { key: string; value: unknown };
const rowsOff: Row[] = [{ key: 'ai.server.url', value: URL }, { key: 'ai.server.enabled', value: false }];
const rowsOn: Row[] = [{ key: 'ai.server.url', value: URL }, { key: 'ai.server.enabled', value: true }];
const rowsUnset: Row[] = [{ key: 'ai.server.url', value: URL }];

function prismaWith(rows: Row[]) {
  return {
    systemConfig: { findMany: vi.fn(async () => rows) },
    drugExplainCache: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    translation: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    committeeAgenda: { findMany: vi.fn(async () => []) },
    committeeSurfaceMap: { findMany: vi.fn(async () => []) },
  };
}

/** Ollama NDJSON(generate) · /api/chat 스트림 둘 다 읽히는 응답 */
function okResponse(): Response {
  return new Response('{"response":"{\\"ok\\":true}","message":{"content":"Hello"}}\n', { status: 200 });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okResponse());
});
afterEach(() => {
  fetchSpy.mockRestore();
});

type Llm = { llmGenerate: (p: string, t?: number) => Promise<string> };

const clients: Array<{ name: string; call: (rows: Row[]) => Promise<unknown> }> = [
  {
    name: 'formulary',
    call: (rows) => (new FormularyService(prismaWith(rows) as never) as unknown as Llm).llmGenerate('p', 1000),
  },
  {
    name: 'gld/governance',
    call: (rows) => (new GovernanceService(prismaWith(rows) as never) as unknown as Llm).llmGenerate('p', 1000),
  },
  {
    name: 'portal/drug-explain',
    call: (rows) =>
      (new DrugExplainService(prismaWith(rows) as never, {} as never, {} as never) as unknown as Llm).llmGenerate('p', 1000),
  },
  {
    name: 'i18n/translation',
    call: (rows) => new TranslationService(prismaWith(rows) as never, { get: () => '' } as never).complete('p', 1000),
  },
];

describe('isAiServerEnabled — 명시적 false 만 꺼짐', () => {
  it('false·"false" 는 꺼짐 · true·미설정·기타는 켜짐', () => {
    expect(isAiServerEnabled(false)).toBe(false);
    expect(isAiServerEnabled('false')).toBe(false);
    expect(isAiServerEnabled(true)).toBe(true);
    expect(isAiServerEnabled(undefined)).toBe(true);
    expect(isAiServerEnabled(null)).toBe(true);
  });
});

describe.each(clients)('🔴 $name — kill switch', ({ call }) => {
  it('(a) 꺼져 있으면 보내지 않고 503 AI_DISABLED', async () => {
    const err = await call(rowsOff).then(() => null, (e: unknown) => e);
    expect(fetchSpy, '꺼졌는데 외부로 나갔다').not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(isAiDisabledError(err)).toBe(true);
  });

  it('(c) 대조군 — 켜짐(명시 true)이면 실제로 보낸다', async () => {
    await call(rowsOn);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('(c) 대조군 — 미설정(행 없음)은 켜짐이다(코드 기본 true)', async () => {
    await call(rowsUnset);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('(b) 호출부는 꺼짐을 조용한 폴백으로 바꾸지 않는다', () => {
  it('translation — 원문을 주되 reason=AI_DISABLED(ENGINE_FAILED 와 다른 사실)', async () => {
    const svc = new TranslationService(prismaWith(rowsOff) as never, { get: () => '' } as never);
    const r = await svc.translate('수술 동의서', 'en', 'ko');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ translated: '수술 동의서', fallback: true, cached: false, reason: 'AI_DISABLED' });
  });

  it('governance 사전 검토 — 거절이 전파된다("AI 응답 파싱 실패" 질의로 둔갑하지 않는다)', async () => {
    const config = { get: vi.fn(async (k: string) => (k === 'governance.ai.enabled' ? true : null)) };
    const svc = new GovernanceService(prismaWith(rowsOff) as never, undefined, undefined, config as never);
    const err = await svc.precheckAgenda({ title: '안건 제목' }).then(() => null, (e: unknown) => e);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(isAiDisabledError(err)).toBe(true);
  });

  it('governance 사전 검토 대조군 — 켜져 있고 파싱만 실패하면 종전 폴백(브리핑은 나간다)', async () => {
    fetchSpy.mockImplementation(async () => new Response('{"response":"not json"}\n', { status: 200 }));
    const config = { get: vi.fn(async (k: string) => (k === 'governance.ai.enabled' ? true : null)) };
    const svc = new GovernanceService(prismaWith(rowsOn) as never, undefined, undefined, config as never);
    const r = await svc.precheckAgenda({ title: '안건 제목' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.questions[0]).toContain('파싱 실패');
  });
});
