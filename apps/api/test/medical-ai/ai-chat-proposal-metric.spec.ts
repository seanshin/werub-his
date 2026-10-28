/**
 * AI 어시스턴트 — 명령별 호출 계측 · 초안 → 제안 원장(2026-10-02).
 *  · 🔴 종전 원장 `skill` 은 `medical-ai` 한 덩어리 — 어시스턴트 호출이 명령별로 갈리지 않았다
 *    → `withAiSkill` 범위 안의 상류 호출은 `medical-ai:chat.<metric>` · 범위 밖은 종전 그대로 · 동시 호출이 섞이지 않는다
 *  · 🔴 종전 어시스턴트 초안(`/요약`·`/자동기록`·`/초안`)은 어디에도 남지 않았다(같은 SOAP 초안이 진료 화면에서는 원장에 남는데)
 *    → 원장에 있는 종류만(SOAP·퇴원·의뢰) · 맞는 종류 없으면 KIND_UNMAPPED · 대상 모르면 TARGET_UNIDENTIFIED(지어내지 않음)
 *    · AI 를 부르지 않았거나 초안이 아닌 명령은 원장에 안 간다 · UNAVAILABLE 은 만들지 않는다
 * 재주입: 범위를 지우면, 계측 키를 지우면, 종류 매핑을 넓히면(설명문→SOAP), 초안 판정을 지우면 실패한다.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AI_CHAT_COMMANDS } from '@hospital-run/shared';
import { aiEgressFetch, aiSkillTag, withAiSkill } from '../../src/common/util/ai-egress-fetch';
import { clearAiCallLogSink, registerAiCallLogSink, type AiCallLogRecord } from '../../src/common/util/ai-call-log-sink';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';
import { MedicalAiController, chatProposalKind, chatDraftContent } from '../../src/modules/medical-ai/medical-ai.controller';

const PID = '11111111-1111-4111-8111-111111111111';
const EID = '22222222-2222-4222-8222-222222222222';

describe('호출 계측 — 기능 범위', () => {
  it('범위 안 = `<client>:<범위>` · 밖 = 클라이언트 그대로 · 동시 범위가 섞이지 않는다', async () => {
    expect(aiSkillTag('medical-ai')).toBe('medical-ai');
    const [a, b] = await Promise.all([
      withAiSkill('chat.ddx', async () => { await new Promise((r) => setTimeout(r, 5)); return aiSkillTag('medical-ai'); }),
      withAiSkill('chat.summarize', async () => aiSkillTag('medical-ai')),
    ]);
    expect([a, b]).toEqual(['medical-ai:chat.ddx', 'medical-ai:chat.summarize']);
    expect(aiSkillTag('medical-ai')).toBe('medical-ai');
  });

  describe('원장 행', () => {
    let rows: AiCallLogRecord[];
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      rows = [];
      registerAiCallLogSink((r) => { rows.push(r); });
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ model: 'm1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    afterEach(() => { clearAiCallLogSink(); fetchSpy.mockRestore(); });

    it('🔴 범위 안 상류 호출은 원장 skill 이 명령 단위 · client 는 그대로', async () => {
      await withAiSkill('chat.ddx', () => aiEgressFetch('https://example.org/ollama', '/api/x', { method: 'POST', body: '{}' }, { client: 'medical-ai' }));
      await vi.waitFor(() => expect(rows).toHaveLength(1));
      expect(rows[0]).toMatchObject({ skill: 'medical-ai:chat.ddx', client: 'medical-ai' });
    });

    it('🔴 응답을 비동기로 읽는 사이 범위 밖으로 나가도 skill 은 호출 시점 값', async () => {
      await withAiSkill('chat.reference', () => aiEgressFetch('https://example.org/ollama', '/api/x', { method: 'POST', body: '{}' }, { client: 'medical-ai' }));
      await aiEgressFetch('https://example.org/ollama', '/api/y', { method: 'POST', body: '{}' }, { client: 'medical-ai' });
      await vi.waitFor(() => expect(rows).toHaveLength(2));
      expect(rows.map((r) => r.skill).sort()).toEqual(['medical-ai', 'medical-ai:chat.reference']);
    });
  });

  it('명령 정본의 계측 키는 모두 있고 ASCII·중복 없음', () => {
    const keys = AI_CHAT_COMMANDS.map((c) => c.metric);
    expect(keys.every((k) => /^[a-z][a-z0-9-]*$/.test(k))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('🔴 어시스턴트 명령이 부른 상류 호출이 그 명령의 범위 안에 있다(processCommand)', async () => {
    const config = { get: vi.fn((_k: string, d?: unknown) => d) };
    const runtime = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    const prisma = { systemConfig: { findMany: vi.fn().mockResolvedValue([]) }, patient: { findUnique: vi.fn() }, admission: { findFirst: vi.fn() } };
    const svc = new MedicalAiService(config as never, runtime as never, prisma as never);
    const seen: string[] = [];
    vi.spyOn(svc, 'analyze').mockImplementation(async () => { seen.push(aiSkillTag('medical-ai')); return { differential_diagnosis: [] }; });
    vi.spyOn(svc, 'reference').mockImplementation(async () => { seen.push(aiSkillTag('medical-ai')); return { answer: 'x' }; });
    await svc.processCommand('/감별 두통', null, { role: 'DOCTOR' });
    await svc.processCommand('두통 치료', null, { role: 'DOCTOR' });
    expect(seen).toEqual(['medical-ai:chat.ddx', 'medical-ai:chat.free']);
  });
});

describe('초안 → 제안 원장', () => {
  it('종류 매핑 — 원장 어휘에 있는 것만(설명문·문서는 없음)', () => {
    expect(chatProposalKind('/요약', '')).toBe('SOAP_DRAFT');
    expect(chatProposalKind('/자동기록', '대화')).toBe('SOAP_DRAFT');
    expect(chatProposalKind('/초안', '')).toBe('SOAP_DRAFT');
    expect(chatProposalKind('/초안', 'discharge_summary')).toBe('DISCHARGE_DRAFT');
    expect(chatProposalKind('/초안', 'referral')).toBe('REFERRAL_DRAFT');
    expect(chatProposalKind('/초안', '수술기록')).toBeNull();
    expect(chatProposalKind('/설명', '고혈압')).toBeNull();
    expect(chatProposalKind('/문서', '소견서')).toBeNull();
  });

  it('본문은 화면 복사본과 같은 SOAP 줄 규칙', () => {
    expect(chatDraftContent('summarize', { summary: { subjective: '두통', plan: '' , assessment: '긴장성' } })).toBe('S: 두통\nA: 긴장성');
    expect(chatDraftContent('draft', { content: '경과기록' })).toBe('경과기록');
    expect(chatDraftContent('explain', { explanation: 'x' })).toBe('');
  });

  function makeCtl(result: Record<string, unknown>) {
    const svc = { processCommand: vi.fn().mockResolvedValue(result) };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const proposals = { create: vi.fn().mockResolvedValue({ id: 'prop-1' }) };
    return { ctl: new MedicalAiController(svc as never, audit as never, undefined, proposals as never), proposals, audit };
  }

  it('🔴 /요약 + 환자 → SOAP_DRAFT · 진료 미상이면 "이 환자의 미확정 진료" · 본문·출처·작성자 · 응답에 proposalId', async () => {
    const { ctl, proposals, audit } = makeCtl({ cmd: '/요약', type: 'summarize', source: 'AI', draft: true, data: { summary: { subjective: '두통' }, model: 'm1' } });
    const r = await ctl.chat({ message: '/요약', context: { patientId: PID, soap: { subjective: '두통' } } }, { id: 'u1', role: 'DOCTOR' });
    expect(proposals.create).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'SOAP_DRAFT', targetType: 'Encounter', targetKey: `encounter-pending:patient:${PID}`, patientId: PID,
      content: 'S: 두통', source: 'AI', modelRef: 'm1', createdBy: 'u1', promptVersion: 'ai-chat-request-v1',
    }));
    expect((r.data as { proposal?: unknown }).proposal).toEqual({ proposalId: 'prop-1' });
    expect(JSON.stringify(audit.log.mock.calls)).toContain('proposal=CREATED');
  });

  it('진료가 있으면 그 진료가 대상', async () => {
    const { ctl, proposals } = makeCtl({ cmd: '/자동기록', type: 'auto-record', source: 'AI', draft: true, data: { soap: { assessment: 'A' } } });
    await ctl.chat({ message: '/자동기록 대화', context: { patientId: PID, encounterId: EID } }, { id: 'u1', role: 'DOCTOR' });
    expect(proposals.create.mock.calls[0][0]).toMatchObject({ targetType: 'Encounter', targetId: EID });
  });

  it('🔴 지어내지 않는다 — 맞는 종류 없음=KIND_UNMAPPED · 환자도 진료도 모름=TARGET_UNIDENTIFIED · 퇴원요약은 입원 모름', async () => {
    let t = makeCtl({ cmd: '/설명', type: 'explain', source: 'AI', draft: true, data: { explanation: 'x' } });
    let r = await t.ctl.chat({ message: '/설명 고혈압' }, { id: 'u1', role: 'DOCTOR' });
    expect((r.data as { proposal: unknown }).proposal).toEqual({ proposalId: null, proposalSkipped: 'KIND_UNMAPPED' });
    expect(t.proposals.create).not.toHaveBeenCalled();

    t = makeCtl({ cmd: '/요약', type: 'summarize', source: 'AI', draft: true, data: { summary: { subjective: 'S' } } });
    r = await t.ctl.chat({ message: '/요약', context: { soap: { subjective: 'S' } } }, { id: 'u1', role: 'DOCTOR' });
    expect((r.data as { proposal: unknown }).proposal).toEqual({ proposalId: null, proposalSkipped: 'TARGET_UNIDENTIFIED' });

    t = makeCtl({ cmd: '/초안', type: 'draft', source: 'AI', draft: true, data: { content: '퇴원요약' } });
    r = await t.ctl.chat({ message: '/초안 discharge_summary', context: { patientId: PID } }, { id: 'u1', role: 'DOCTOR' });
    expect((r.data as { proposal: unknown }).proposal).toEqual({ proposalId: null, proposalSkipped: 'TARGET_UNIDENTIFIED' });
    expect(t.proposals.create).not.toHaveBeenCalled();
  });

  it('UNAVAILABLE 은 만들지 않는다 · AI 를 부르지 않았거나 초안이 아닌 명령은 원장에 안 간다', async () => {
    let t = makeCtl({ cmd: '/요약', type: 'summarize', source: 'UNAVAILABLE', reason: 'UPSTREAM_ERROR', draft: true, data: null });
    let r = await t.ctl.chat({ message: '/요약', context: { patientId: PID } }, { id: 'u1', role: 'DOCTOR' });
    expect((r.data as { proposal: unknown }).proposal).toEqual({ proposalId: null, proposalSkipped: 'UNAVAILABLE' });
    expect(t.proposals.create).not.toHaveBeenCalled();

    t = makeCtl({ cmd: '/요약', type: 'notice', source: null, reason: 'SOAP_REQUIRED', draft: false, data: null });
    r = await t.ctl.chat({ message: '/요약' }, { id: 'u1', role: 'DOCTOR' });
    expect(r.data).not.toHaveProperty('proposal');

    t = makeCtl({ cmd: '/감별', type: 'diagnose', source: 'AI', draft: false, data: {} });
    r = await t.ctl.chat({ message: '/감별 두통', context: { patientId: PID } }, { id: 'u1', role: 'DOCTOR' });
    expect(r.data).not.toHaveProperty('proposal');
    expect(t.proposals.create).not.toHaveBeenCalled();
  });

  it('생성 실패는 응답을 막지 않고 코드로 말한다', async () => {
    const t = makeCtl({ cmd: '/요약', type: 'summarize', source: 'AI', draft: true, data: { summary: { subjective: 'S' } } });
    t.proposals.create.mockRejectedValueOnce(new Error('db down'));
    const r = await t.ctl.chat({ message: '/요약', context: { patientId: PID } }, { id: 'u1', role: 'DOCTOR' });
    expect((r.data as { proposal: unknown; type: string })).toMatchObject({ type: 'summarize', proposal: { proposalId: null, proposalError: 'PROPOSAL_CREATE_FAILED' } });
  });
});
