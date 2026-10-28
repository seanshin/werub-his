import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { NursingService, signDraftText, NURSING_AI_PROMPT_VERSION } from '../../src/modules/nursing/nursing.service';

/**
 * 가드 — 간호기록 AI 초안이 **제안 원장(AiProposal)** 에 남고, 사람의 결정이 그 원장으로 돌아오는가.
 * 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` §2.1 · P1-③(A).
 *
 * 이 가드가 막는 것(전부 이 저장소에서 실제로 겪은 유형):
 *  1. **모델 태그를 지어내는 것** — `aiModel: 'weru-b'` 는 공급자 이름이지 모델 태그가 아니다.
 *     상류가 안 알려주면 `modelRef` 는 `null` 이어야 한다(벤더명으로 채우면 감독 지표가 거짓이 된다).
 *  2. **신뢰도를 지어내는 것** — 화면 문구용 기본값 0.5 가 원장에 새어 들어가면 "모델이 0.5 라고 말했다"가 된다.
 *  3. **결정을 남기지 않는 것** — 서명(작성=서명 경로 포함)이 제안을 PRESENTED 로 남겨두면
 *     감독 지표는 "아무도 검토하지 않았다"고 말한다.
 *  4. **결정을 사실과 다르게 남기는 것** — 수정량 0 이 아닌데 ACCEPTED, 재지 못했는데 ACCEPTED.
 *  5. **원장 실패가 임상 업무를 막는 것** — 제안 생성 실패는 초안을, 결정 기록 실패는 서명을 막지 않는다.
 */

const ADMISSION_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const NURSE_ID = '33333333-3333-4333-8333-333333333333';

function draftPrisma() {
  return {
    admission: { findUnique: vi.fn().mockResolvedValue({ id: ADMISSION_ID, patientId: PATIENT_ID }) },
    earlyWarningScore: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ews-1', recordedAt: new Date('2026-06-29T05:00:00Z'), respiratoryRate: 20, spO2: 95,
        systolicBp: 150, heartRate: 92, temperature: 37.8, consciousness: 'ALERT', totalScore: 5, riskLevel: 'MEDIUM',
      }),
    },
    fallRiskAssessment: {
      findFirst: vi.fn().mockResolvedValue({ id: 'fr-1', score: 55, riskLevel: 'HIGH', assessedAt: new Date('2026-06-29T04:00:00Z') }),
    },
    medicationAdministration: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;
}

const gateOn = () => ({ get: vi.fn().mockResolvedValue(true) }) as never;

/** 목은 정본의 **실제 반환 모양**을 쓴다 — 내가 가정한 모양을 테스트하면 가드가 헛돈다 */
function proposalMock(overrides: Partial<{ create: unknown; decide: unknown }> = {}) {
  return {
    create: vi.fn().mockResolvedValue({ id: 'prop-1', status: 'GENERATED' }),
    decide: vi.fn().mockResolvedValue({
      proposal: { id: 'prop-1', status: 'ACCEPTED' },
      editDistance: 0,
      editDistanceCapped: false,
      notPresented: false,
    }),
    ...overrides,
  } as never;
}

const svc = (ai: unknown, proposal: unknown) =>
  new NursingService(draftPrisma(), ai as never, gateOn(), undefined, undefined, undefined, undefined, proposal as never);

describe('간호 AI 초안 → 제안 원장(create)', () => {
  it('create 인자 — kind/target/promptVersion/inputSnapshotHash/createdBy 가 정본 모양으로 간다', async () => {
    const p = proposalMock();
    const r = await svc(undefined, p).generateNursingDraft(ADMISSION_ID, 'SOAP', NURSE_ID);

    expect((p as { create: { mock: { calls: unknown[][] } } }).create.mock.calls.length).toBe(1);
    const arg = (p as { create: { mock: { calls: Record<string, unknown>[][] } } }).create.mock.calls[0][0];
    expect(arg.kind).toBe('NURSING_DRAFT');
    expect(arg.targetType).toBe('Admission');
    expect(arg.targetId).toBe(ADMISSION_ID);
    expect(arg.patientId).toBe(PATIENT_ID);
    expect(arg.promptVersion).toBe(NURSING_AI_PROMPT_VERSION);
    expect(arg.createdBy).toBe(NURSE_ID);
    expect(arg.source).toBe('FALLBACK'); // medicalAi 부재 → 규칙 초안

    // 본문은 노트에 실리는 초안 텍스트 그대로 — 스냅샷의 draftText 와 같은 문자열이어야 편집거리가 뜻을 갖는다
    const snap = r.provenance.aiSourceSnapshot as { draftText: string; evidence: unknown; aiProposalId: string | null };
    expect(arg.content).toBe(snap.draftText);

    // 입력 스냅샷 해시 = 근거(evidence) 의 sha256 — 승인 시점 대조의 유일한 실
    expect(arg.inputSnapshotHash).toBe(createHash('sha256').update(JSON.stringify(snap.evidence), 'utf8').digest('hex'));
    expect(snap.aiProposalId).toBe('prop-1');
  });

  it('🔴 modelRef 는 상류 보고값만 — 상류가 안 알려주면 null(벤더명 "weru-b" 금지)', async () => {
    const p = proposalMock();
    const ai = { autoSoap: vi.fn().mockResolvedValue({ assessment: '활력 상승', plan: '재측정', confidence: 0.7 }) };
    const r = await svc(ai, p).generateNursingDraft(ADMISSION_ID, 'SOAP', NURSE_ID);

    const arg = (p as { create: { mock: { calls: Record<string, unknown>[][] } } }).create.mock.calls[0][0];
    expect(arg.modelRef).toBeNull();
    expect(arg.modelRef).not.toBe('weru-b');
    // 노트 프로비넌스의 공급자 표기는 종전대로 남는다 — 그것과 modelRef 는 다른 사실이다
    expect(r.provenance.aiModel).toBe('weru-b');
  });

  it('modelRef — 상류가 model_used 를 주면 그 값(64자 상한)', async () => {
    const p = proposalMock();
    const ai = { autoSoap: vi.fn().mockResolvedValue({ assessment: 'A', plan: 'P', confidence: 0.7, model_used: 'qwen2.5:14b' }) };
    await svc(ai, p).generateNursingDraft(ADMISSION_ID, 'SOAP', NURSE_ID);
    const arg = (p as { create: { mock: { calls: Record<string, unknown>[][] } } }).create.mock.calls[0][0];
    expect(arg.modelRef).toBe('qwen2.5:14b');
  });

  it('🔴 confidence 는 모델 자기보고만 — 미보고면 null(화면 기본값 0.5 가 새지 않는다)', async () => {
    const p = proposalMock();
    const ai = { autoSoap: vi.fn().mockResolvedValue({ assessment: 'A', plan: 'P' }) }; // confidence 없음
    const r = await svc(ai, p).generateNursingDraft(ADMISSION_ID, 'SOAP', NURSE_ID);

    const arg = (p as { create: { mock: { calls: Record<string, unknown>[][] } } }).create.mock.calls[0][0];
    expect(arg.confidence).toBeNull();
    expect(r.confidence).toBe(0.5); // 화면 문구용 기본값은 종전대로(원장과 다른 사실)
  });

  it('confidence — 모델이 보고하면 그 값이 그대로', async () => {
    const p = proposalMock();
    const ai = { autoSoap: vi.fn().mockResolvedValue({ assessment: 'A', plan: 'P', confidence: 0.42 }) };
    await svc(ai, p).generateNursingDraft(ADMISSION_ID, 'SOAP', NURSE_ID);
    const arg = (p as { create: { mock: { calls: Record<string, unknown>[][] } } }).create.mock.calls[0][0];
    expect(arg.confidence).toBe(0.42);
  });

  it('🔴 제안 생성이 실패해도 초안은 나간다 — aiProposalId=null 로 "기록되지 않았다"고 말한다', async () => {
    const p = proposalMock({ create: vi.fn().mockRejectedValue(new Error('DB down')) });
    const r = await svc(undefined, p).generateNursingDraft(ADMISSION_ID, 'SOAP', NURSE_ID);
    expect(r.draft.objective).toContain('NEWS2 5(MEDIUM)');
    expect((r.provenance.aiSourceSnapshot as { aiProposalId: string | null }).aiProposalId).toBeNull();
  });

  it('AiProposalService 미주입이면 aiProposalId=null (있는 척하지 않는다)', async () => {
    const r = await svc(undefined, undefined).generateNursingDraft(ADMISSION_ID, 'SOAP', NURSE_ID);
    expect((r.provenance.aiSourceSnapshot as { aiProposalId: string | null }).aiProposalId).toBeNull();
  });
});

/* ═══════════════ 사람 결정(decide) ═══════════════ */

const DRAFT_TEXT = 'O \n A';
const snapshotOf = (proposalId: string | null) => ({
  generatedAt: '2026-09-09T00:00:00.000Z',
  evidence: { ewsId: 'ews-1', fallId: null, marIds: [] },
  draftText: DRAFT_TEXT,
  sig: signDraftText(DRAFT_TEXT),
  ...(proposalId ? { aiProposalId: proposalId } : {}),
});

function notePrisma(note: Record<string, unknown>) {
  return {
    admission: { findUnique: vi.fn().mockResolvedValue({ id: ADMISSION_ID }) },
    nursingNote: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'nn-1', ...data })),
      findUnique: vi.fn().mockResolvedValue(note),
      findFirst: vi.fn().mockResolvedValue(note), // 소속 대조(입원↔기록)는 findFirst 로 한다
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...note, ...data })),
    },
  } as never;
}

const noteSvc = (prisma: unknown, proposal: unknown) =>
  new NursingService(prisma as never, undefined, { get: vi.fn() } as never, undefined, undefined, undefined, undefined, proposal as never);

describe('간호기록 서명 → 제안 원장(decide)', () => {
  let decide: ReturnType<typeof vi.fn>;
  let proposal: unknown;

  beforeEach(() => {
    decide = vi.fn().mockResolvedValue({ proposal: { id: 'prop-1', status: 'ACCEPTED' }, editDistance: 0, editDistanceCapped: false, notPresented: false });
    proposal = proposalMock({ decide });
  });

  it('signNote — 무수정이면 ACCEPTED · finalText 와 actorId 를 함께 보낸다', async () => {
    const note = { id: 'nn-4', status: 'DRAFT', nurseId: NURSE_ID, aiAssisted: true, aiEditDistance: null, aiSourceSnapshot: snapshotOf('prop-1'), objective: 'O', assessment: 'A' };
    const out = await noteSvc(notePrisma(note), proposal).signNote(ADMISSION_ID, 'nn-4', NURSE_ID);

    expect(decide.mock.calls.length).toBe(1);
    expect(decide.mock.calls[0][0]).toBe('prop-1');
    expect(decide.mock.calls[0][1]).toMatchObject({ decision: 'ACCEPTED', actorId: NURSE_ID, finalText: DRAFT_TEXT });
    expect((out as { aiProposalDecision?: { recorded: boolean } }).aiProposalDecision?.recorded).toBe(true);
  });

  it('signNote — 고쳤으면 EDITED (수정량 0 이 아닌데 ACCEPTED 라 부르지 않는다)', async () => {
    const note = { id: 'nn-5', status: 'DRAFT', nurseId: NURSE_ID, aiAssisted: true, aiEditDistance: null, aiSourceSnapshot: snapshotOf('prop-1'), objective: 'O', assessment: 'A2' };
    await noteSvc(notePrisma(note), proposal).signNote(ADMISSION_ID, 'nn-5', NURSE_ID);
    expect(decide.mock.calls[0][1]).toMatchObject({ decision: 'EDITED' });
  });

  it('🔴 decide 실패가 서명을 막지 않는다 — 기록은 SIGNED, 반환은 recorded:false 로 그 사실을 말한다', async () => {
    const failing = proposalMock({ decide: vi.fn().mockRejectedValue(new Error('ledger down')) });
    const note = { id: 'nn-6', status: 'DRAFT', nurseId: NURSE_ID, aiAssisted: true, aiEditDistance: null, aiSourceSnapshot: snapshotOf('prop-1'), objective: 'O', assessment: 'A' };
    const prisma = notePrisma(note);
    const out = await noteSvc(prisma, failing).signNote(ADMISSION_ID, 'nn-6', NURSE_ID);

    const updateArg = (prisma as unknown as { nursingNote: { update: { mock: { calls: Record<string, { data: Record<string, unknown> }>[] } } } }).nursingNote.update.mock.calls.at(-1)![0];
    expect(updateArg.data.status).toBe('SIGNED');
    const dec = (out as { aiProposalDecision?: { recorded: boolean; reason?: string } }).aiProposalDecision;
    expect(dec?.recorded).toBe(false);
    expect(dec?.reason).toContain('ledger down');
  });

  it('제안 id 없는 초안(원장 도입 이전)은 결정할 대상이 없다 — decide 미호출·서명은 정상', async () => {
    const note = { id: 'nn-7', status: 'DRAFT', nurseId: NURSE_ID, aiAssisted: true, aiEditDistance: null, aiSourceSnapshot: snapshotOf(null), objective: 'O', assessment: 'A' };
    const out = await noteSvc(notePrisma(note), proposal).signNote(ADMISSION_ID, 'nn-7', NURSE_ID);
    expect(decide.mock.calls.length).toBe(0);
    expect((out as { aiProposalDecision?: unknown }).aiProposalDecision).toBeUndefined();
  });

  it('🔴 수정량을 재지 못했으면 아무 쪽으로도 단정하지 않는다(decide 미호출·사유 기록)', async () => {
    // 초안 원문이 문자열이 아니다 → 편집거리 미측정. 0 으로 접어 ACCEPTED 라 부르면 "무수정 승인"이 부풀려진다.
    const note = { id: 'nn-8', status: 'DRAFT', nurseId: NURSE_ID, aiAssisted: true, aiEditDistance: null, aiSourceSnapshot: { aiProposalId: 'prop-1' }, objective: 'O', assessment: 'A' };
    const out = await noteSvc(notePrisma(note), proposal).signNote(ADMISSION_ID, 'nn-8', NURSE_ID);
    expect(decide.mock.calls.length).toBe(0);
    expect((out as { aiProposalDecision?: { reason?: string } }).aiProposalDecision?.reason).toBe('EDIT_DISTANCE_UNMEASURED');
  });

  it('🔴 작성=서명(createNote) 경로도 결정을 남긴다 — signNote 를 지나지 않는 주 경로다', async () => {
    const prisma = notePrisma({});
    const dto = {
      noteType: 'SOAP', shiftType: 'DAY', objective: 'O', assessment: 'A',
      aiProvenance: { aiModel: 'weru-b', aiPromptVersion: NURSING_AI_PROMPT_VERSION, aiSourceSnapshot: snapshotOf('prop-1') },
    };
    const out = await noteSvc(prisma, proposal).createNote(ADMISSION_ID, dto as never, NURSE_ID);

    expect(decide.mock.calls.length).toBe(1);
    expect(decide.mock.calls[0][1]).toMatchObject({ decision: 'ACCEPTED', actorId: NURSE_ID, clientContext: 'nursing-createNote' });
    expect((out as { aiProposalDecision?: { recorded: boolean } }).aiProposalDecision?.recorded).toBe(true);

    // 스냅샷은 **그대로** 저장된다(새 컬럼 없이 제안 원장과 이어지는 유일한 실)
    const createArg = (prisma as unknown as { nursingNote: { create: { mock: { calls: Record<string, { data: Record<string, unknown> }>[] } } } }).nursingNote.create.mock.calls.at(-1)![0];
    expect((createArg.data.aiSourceSnapshot as { aiProposalId: string }).aiProposalId).toBe('prop-1');
  });

  it('DRAFT 로 보관하면 아직 결정이 아니다 — decide 미호출', async () => {
    const prisma = notePrisma({});
    const dto = {
      noteType: 'SOAP', shiftType: 'DAY', objective: 'O', assessment: 'A', draft: true,
      aiProvenance: { aiModel: 'weru-b', aiPromptVersion: NURSING_AI_PROMPT_VERSION, aiSourceSnapshot: snapshotOf('prop-1') },
    };
    await noteSvc(prisma, proposal).createNote(ADMISSION_ID, dto as never, NURSE_ID);
    expect(decide.mock.calls.length).toBe(0);
  });

  it('이미 서명된 기록의 재서명은 멱등 — 결정을 두 번 남기지 않는다', async () => {
    const note = { id: 'nn-9', status: 'SIGNED', nurseId: NURSE_ID, aiAssisted: true, aiEditDistance: 0, aiSourceSnapshot: snapshotOf('prop-1') };
    await noteSvc(notePrisma(note), proposal).signNote(ADMISSION_ID, 'nn-9', NURSE_ID);
    expect(decide.mock.calls.length).toBe(0);
  });
});

/* ═══════════════ 대조군 — 가드가 "성공하면 실패"라고 말하지 않는가 ═══════════════ */

describe('대조군', () => {
  it('AI 보조가 아닌 일반 기록은 제안 원장을 건드리지 않는다(정상 저장)', async () => {
    const decide = vi.fn();
    const prisma = notePrisma({});
    const out = await noteSvc(prisma, proposalMock({ decide })).createNote(
      ADMISSION_ID,
      { noteType: 'DAR', shiftType: 'DAY', focus: '통증', data: 'D', action: 'A', response: 'R' } as never,
      NURSE_ID,
    );
    expect(decide.mock.calls.length).toBe(0);
    expect((out as { id: string }).id).toBe('nn-1');
    expect((out as { aiProposalDecision?: unknown }).aiProposalDecision).toBeUndefined();
  });
});
