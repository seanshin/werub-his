/**
 * `POST /api/v1/ai/auto-soap` → 제안 원장(`AiProposal` · SOAP_DRAFT) 배선 가드
 * 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` §2.1 · P1-②
 *
 * 무엇을 막는가
 *  · `UNAVAILABLE`(산출 불가)을 초안으로 저장하는 것 — "없음"과 "모름"은 다른 사실이다.
 *  · 모델이 안 준 `confidence` 를 기본값으로 채우는 것(R7 · 0.7 하드코딩의 재발).
 *  · 제안 생성 실패를 **성공처럼** 말하는 것(응답은 막지 않되 `proposalId:null`+코드로 말해야 한다).
 *  · 대상을 추정해서 붙이는 것 — 진료가 아직 없으면 `targetKey` 로 "미확정"임을 밝혀야 한다.
 *
 * 🔴 목은 **정본의 실제 반환 모양**을 쓴다 — 아래 `envelope()` 는 `finalizeSkill()`+서비스 stamp 의 실제 키다.
 *    (내가 가정한 모양을 테스트하면 가드가 헛돈다 — 수술기록 `ebl` 선례)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalAiController } from '../../src/modules/medical-ai/medical-ai.controller';
import { MedicalAiService, AUTO_SOAP_PROMPT_VERSION_AI } from '../../src/modules/medical-ai/medical-ai.service';
import { serializeSoapDraft } from '../../src/modules/medical-ai/medical-ai.controller';
import type { AiAutoSoapDto } from '../../src/modules/medical-ai/dto/medical-ai.dto';

const ENCOUNTER_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444';

/** `finalizeSkill()`(ai-verify) + `autoSoapRun` 의 stamp 가 실제로 내는 모양 */
function envelope(over: Record<string, unknown> = {}) {
  return {
    assessment: '급성 인두염 의심',
    plan: '1. 대증치료\n2. 3일 후 재평가',
    confidence: 0.42,
    references: ['대한이비인후과학회 지침'],
    disclaimer: 'AI 참고 정보',
    source: 'AI',
    latencyMs: 1234,
    verify: { passed: ['KOREAN', 'MIXED_SCRIPT'], failed: [] },
    groundedOn: ['S/O 텍스트'],
    promptVersion: AUTO_SOAP_PROMPT_VERSION_AI,
    inputSnapshotHash: 'a'.repeat(64),
    modelRef: 'qwen2.5:14b',
    ...over,
  };
}

function dto(over: Partial<AiAutoSoapDto> = {}): AiAutoSoapDto {
  return { patientId: PATIENT_ID, subjective: '3일 전부터 인후통', encounterId: ENCOUNTER_ID, ...over } as AiAutoSoapDto;
}

describe('auto-soap → AiProposal(SOAP_DRAFT)', () => {
  let controller: MedicalAiController;
  let service: MedicalAiService;
  let proposals: { create: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = { autoSoap: vi.fn() } as unknown as MedicalAiService;
    proposals = { create: vi.fn().mockResolvedValue({ id: PROPOSAL_ID }) };
    controller = new MedicalAiController(service, undefined, undefined, proposals as never);
  });

  it('source=AI 면 제안 1행을 만들고 응답에 proposalId 를 싣는다', async () => {
    vi.mocked(service.autoSoap).mockResolvedValue(envelope() as never);

    const res = await controller.autoSoap(dto(), USER_ID);

    expect(proposals.create).toHaveBeenCalledTimes(1);
    const arg = proposals.create.mock.calls[0][0];
    expect(arg.kind).toBe('SOAP_DRAFT');
    expect(arg.targetType).toBe('Encounter');
    expect(arg.targetId).toBe(ENCOUNTER_ID);
    expect(arg.patientId).toBe(PATIENT_ID);
    expect(arg.content).toBe('급성 인두염 의심\n1. 대증치료\n2. 3일 후 재평가');
    expect(arg.source).toBe('AI');
    expect(arg.confidence).toBe(0.42);
    expect(arg.modelRef).toBe('qwen2.5:14b');
    expect(arg.promptVersion).toBe(AUTO_SOAP_PROMPT_VERSION_AI);
    expect(arg.inputSnapshotHash).toBe('a'.repeat(64));
    expect(arg.createdBy).toBe(USER_ID);
    expect(res.data.proposalId).toBe(PROPOSAL_ID);
    // 초안 본문은 그대로 나간다(제안 배선이 스킬 응답을 갉아먹지 않는다)
    expect(res.data.assessment).toBe('급성 인두염 의심');
  });

  it('source=FALLBACK 도 제안을 만든다 — 규칙 대체도 사람이 결정하는 초안이다', async () => {
    vi.mocked(service.autoSoap).mockResolvedValue(envelope({ source: 'FALLBACK', reason: 'UPSTREAM_FALLBACK', confidence: null }) as never);

    const res = await controller.autoSoap(dto(), USER_ID);

    expect(proposals.create).toHaveBeenCalledTimes(1);
    expect(proposals.create.mock.calls[0][0].source).toBe('FALLBACK');
    expect(proposals.create.mock.calls[0][0].reasonCode).toBe('UPSTREAM_FALLBACK');
    expect(res.data.proposalId).toBe(PROPOSAL_ID);
  });

  it('🔴 source=UNAVAILABLE 이면 제안을 만들지 않는다 — 산출물이 없다', async () => {
    vi.mocked(service.autoSoap).mockResolvedValue(
      envelope({ source: 'UNAVAILABLE', reason: 'UPSTREAM_AUTH', assessment: '', plan: '', confidence: null, modelRef: null }) as never,
    );

    const res = await controller.autoSoap(dto(), USER_ID);

    expect(proposals.create).not.toHaveBeenCalled();
    expect(res.data.proposalId).toBeNull();
    expect(res.data.proposalSkipped).toBe('UNAVAILABLE');
    // 만들지 않은 것과 만들려다 실패한 것은 다른 사실이다
    expect(res.data.proposalError).toBeUndefined();
  });

  it('🔴 초안이 비면(FALLBACK+빈 본문) 만들지 않고 EMPTY_DRAFT 로 말한다 — 빈 제안을 원장에 남기지 않는다', async () => {
    vi.mocked(service.autoSoap).mockResolvedValue(
      envelope({ source: 'FALLBACK', reason: 'EMPTY_RESULT', assessment: '', plan: '', confidence: null }) as never,
    );

    const res = await controller.autoSoap(dto(), USER_ID);

    expect(proposals.create).not.toHaveBeenCalled();
    expect(res.data.proposalSkipped).toBe('EMPTY_DRAFT');
  });

  it('🔴 제안 생성이 실패해도 스킬 응답은 막지 않고, 실패를 코드로 말한다', async () => {
    vi.mocked(service.autoSoap).mockResolvedValue(envelope() as never);
    proposals.create.mockRejectedValue(new Error('DB down'));

    const res = await controller.autoSoap(dto(), USER_ID);

    expect(res.data.assessment).toBe('급성 인두염 의심'); // 초안은 살아 있다
    expect(res.data.proposalId).toBeNull();
    expect(res.data.proposalError).toBe('PROPOSAL_CREATE_FAILED');
  });

  it('🔴 모델이 신뢰도를 안 주면 null 로 넘긴다 — 기본값(0.7)을 만들지 않는다', async () => {
    vi.mocked(service.autoSoap).mockResolvedValue(envelope({ confidence: null }) as never);

    await controller.autoSoap(dto(), USER_ID);

    expect(proposals.create.mock.calls[0][0].confidence).toBeNull();
  });

  it('🔴 상류가 모델을 안 밝히면 modelRef 는 null — 요청 태그로 채우지 않는다', async () => {
    vi.mocked(service.autoSoap).mockResolvedValue(envelope({ modelRef: null }) as never);

    await controller.autoSoap(dto(), USER_ID);

    expect(proposals.create.mock.calls[0][0].modelRef).toBeNull();
  });

  it('🔴 진료가 아직 없으면 targetKey 로 "미확정"임을 밝힌다 — 다른 진료에 붙이지 않는다', async () => {
    vi.mocked(service.autoSoap).mockResolvedValue(envelope() as never);

    await controller.autoSoap(dto({ encounterId: undefined }), USER_ID);

    const arg = proposals.create.mock.calls[0][0];
    expect(arg.targetId).toBeUndefined();
    expect(arg.targetKey).toBe(`encounter-pending:patient:${PATIENT_ID}`);
  });

  it('UUID 가 아닌 encounterId 는 targetId 로 쓰지 않고 targetKey 로 접는다(@db.Uuid poison 방지)', async () => {
    vi.mocked(service.autoSoap).mockResolvedValue(envelope() as never);

    await controller.autoSoap(dto({ encounterId: 'not-a-uuid' }), USER_ID);

    const arg = proposals.create.mock.calls[0][0];
    expect(arg.targetId).toBeUndefined();
    expect(arg.targetKey).toBe(`encounter-pending:patient:${PATIENT_ID}`);
  });

  it('제안 원장이 주입되지 않은 배포에서도 스킬은 동작하고, 못 남겼다고 말한다', async () => {
    const bare = new MedicalAiController(service);
    vi.mocked(service.autoSoap).mockResolvedValue(envelope() as never);

    const res = await bare.autoSoap(dto(), USER_ID);

    expect(res.data.proposalId).toBeNull();
    expect(res.data.proposalSkipped).toBe('LEDGER_UNAVAILABLE');
  });
});

describe('serializeSoapDraft — 서버 content 와 FE finalText 의 공통 규칙', () => {
  it('A\\nP 로 잇고 빈 칸은 뺀다(배열 plan 도 줄바꿈으로 합친다)', () => {
    expect(serializeSoapDraft('A', 'P')).toBe('A\nP');
    expect(serializeSoapDraft('A', ['1', '2'])).toBe('A\n1\n2');
    expect(serializeSoapDraft('A', '')).toBe('A');
    expect(serializeSoapDraft('', '')).toBe('');
  });

  it('문자열이 아닌 값은 지어내지 않고 버린다', () => {
    expect(serializeSoapDraft(null, undefined)).toBe('');
    expect(serializeSoapDraft(42, { a: 1 })).toBe('');
  });
});

/**
 * 🔴 목이 아니라 **정본 서비스가 실제로** 세 값을 붙이는지 — 이게 없으면 위 테스트는 전부
 *    "내가 만든 목이 내 컨트롤러를 통과했다"만 증명한다.
 */
describe('MedicalAiService.autoSoap — 제안 원장이 읽는 세 값을 실제로 붙인다', () => {
  function makeService() {
    const config = { get: vi.fn((k: string, d?: unknown) => (k === 'MEDICAL_AI_URL' ? 'https://example.org/ollama' : d)) };
    const runtimeConfig = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    const prisma = {
      patient: { findUnique: vi.fn().mockResolvedValue({ dateOfBirth: new Date('1980-01-01'), gender: 'MALE', familyName: '홍', givenName: '길동' }) },
      systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
    };
    return new MedicalAiService(config as never, runtimeConfig as never, prisma as never);
  }

  it('AI 경로: promptVersion·inputSnapshotHash(sha256 64자)·modelRef(상류 보고분)를 붙인다', async () => {
    const svc = makeService();
    // chatLlm 은 상류 호출 — 여기서만 대체한다(프롬프트 조립·검증층은 정본 그대로 돈다)
    vi.spyOn(svc as never, 'chatLlm' as never).mockImplementation(async (...args: unknown[]) => {
      const meta = args[2] as { model?: string | null } | undefined;
      if (meta) meta.model = 'qwen2.5:14b'; // 상류가 보고한 모델
      return JSON.stringify({ assessment: '급성 인두염 의심', plan: '대증치료', confidence: 0.5, references: [] });
    });

    const r = (await svc.autoSoap({ patientId: PATIENT_ID, subjective: '인후통 3일' })) as unknown as Record<string, unknown>;

    expect(r.source).toBe('AI');
    expect(r.promptVersion).toBe(AUTO_SOAP_PROMPT_VERSION_AI);
    expect(typeof r.inputSnapshotHash).toBe('string');
    expect(r.inputSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.modelRef).toBe('qwen2.5:14b');
  });

  it('🔴 상류가 모델을 안 밝히면 modelRef 는 null 이다(요청 태그로 채우지 않는다)', async () => {
    const svc = makeService();
    vi.spyOn(svc as never, 'chatLlm' as never).mockResolvedValue(
      JSON.stringify({ assessment: '급성 인두염 의심', plan: '대증치료', confidence: null, references: [] }) as never,
    );

    const r = (await svc.autoSoap({ patientId: PATIENT_ID, subjective: '인후통 3일' })) as unknown as Record<string, unknown>;

    expect(r.modelRef).toBeNull();
    expect(r.confidence).toBeNull();
  });

  /**
   * 🔴 위 두 테스트는 `chatLlm` 자체를 대체하므로 **chatLlm 안에서 모델을 지어내는 결함은 못 본다**
   *    (재주입 역검증에서 실제로 통과해버렸다). 그래서 상류 응답(aiFetch)까지 내려가 확인한다.
   */
  const upstream = (payload: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) });

  it('🔴 chatLlm 은 상류 응답의 model_used 만 보고한다 — 요청에 실은 태그를 대신 채우지 않는다', async () => {
    const svc = makeService();
    const answer = JSON.stringify({ assessment: '급성 인두염 의심', plan: '대증치료', confidence: null, references: [] });
    // 상류가 모델을 **밝히지 않은** 응답
    vi.spyOn(svc as never, 'aiFetch' as never).mockResolvedValue(upstream({ answer }) as never);

    const r = (await svc.autoSoap({ patientId: PATIENT_ID, subjective: '인후통 3일' })) as unknown as Record<string, unknown>;

    expect(r.source).toBe('AI');
    expect(r.modelRef).toBeNull();
  });

  it('대조군 — 상류가 model_used 를 밝히면 그 값이 그대로 modelRef 가 된다(가드가 항상 null 만 통과시키지 않는다)', async () => {
    const svc = makeService();
    const answer = JSON.stringify({ assessment: '급성 인두염 의심', plan: '대증치료', confidence: null, references: [] });
    vi.spyOn(svc as never, 'aiFetch' as never).mockResolvedValue(upstream({ answer, model_used: 'exaone-deep:7.8b' }) as never);

    const r = (await svc.autoSoap({ patientId: PATIENT_ID, subjective: '인후통 3일' })) as unknown as Record<string, unknown>;

    expect(r.modelRef).toBe('exaone-deep:7.8b');
  });
});
