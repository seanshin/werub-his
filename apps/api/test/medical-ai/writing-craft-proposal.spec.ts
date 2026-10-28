/**
 * `POST /api/v1/ai/writing/craft` → 제안 원장(`AiProposal` · DISCHARGE_DRAFT) 배선 가드
 * 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` §2.1 · P1-②
 *
 * 🔴 craft 는 **범용 문서 작성 스킬**이다(퇴원요약/소견서/의뢰서). 종류를 구분하는 필드는 기존 `style` 하나뿐이라
 *    그것으로 가르고, **매핑이 없는 style 은 제안을 만들지 않는다** — 어휘를 지어내지 않기 위해서다.
 * 🔴 craft 는 3상태 봉투(SkillEnvelope)를 쓰지 않는다(상류 응답 그대로). 그래서 "본문이 있으면 AI",
 *    "본문이 비면 만들지 않음", "상류 실패는 예외로 올라가 여기 도달하지 않음"이 이 EP 의 계약이다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { MedicalAiController, WRITING_CRAFT_PROPOSAL_KIND } from '../../src/modules/medical-ai/medical-ai.controller';
import { MedicalAiService, WRITING_CRAFT_PROMPT_VERSION } from '../../src/modules/medical-ai/medical-ai.service';
import { AI_PROPOSAL_KINDS } from '@hospital-run/shared';

const ADMISSION_ID = '55555555-5555-4555-8555-555555555555';
const PATIENT_ID = '66666666-6666-4666-8666-666666666666';
const USER_ID = '77777777-7777-4777-8777-777777777777';
const PROPOSAL_ID = '88888888-8888-4888-8888-888888888888';

const TEXT = '환자 입원 경과를 요약하여 퇴원요약을 작성해주세요. 입원일: 2026-08-01, 진단: 폐렴';
/** 상류 `/api/writing/craft` 의 실제 반환 모양 — FE 가 읽는 키는 `result` 다 */
const crafted = (over: Record<string, unknown> = {}) => ({ result: '입원 3일차 해열, 5일차 퇴원.', quality_score: 0.91, ...over });

describe('writing/craft → AiProposal(DISCHARGE_DRAFT)', () => {
  let controller: MedicalAiController;
  let service: MedicalAiService;
  let proposals: { create: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = { writingCraft: vi.fn() } as unknown as MedicalAiService;
    proposals = { create: vi.fn().mockResolvedValue({ id: PROPOSAL_ID }) };
    controller = new MedicalAiController(service, undefined, undefined, proposals as never);
  });

  it('style=medical_discharge 면 퇴원요약 제안 1행을 만들고 proposalId 를 싣는다', async () => {
    vi.mocked(service.writingCraft).mockResolvedValue(crafted());

    const res = await controller.writingCraft(
      { text: TEXT, style: 'medical_discharge', admissionId: ADMISSION_ID, patientId: PATIENT_ID },
      USER_ID,
    );

    expect(proposals.create).toHaveBeenCalledTimes(1);
    const arg = proposals.create.mock.calls[0][0];
    expect(arg.kind).toBe('DISCHARGE_DRAFT');
    expect(arg.targetType).toBe('Admission');
    expect(arg.targetId).toBe(ADMISSION_ID);
    expect(arg.patientId).toBe(PATIENT_ID);
    expect(arg.content).toBe('입원 3일차 해열, 5일차 퇴원.');
    expect(arg.source).toBe('AI');
    expect(arg.promptVersion).toBe(WRITING_CRAFT_PROMPT_VERSION);
    // 입력 스냅샷 = 실제로 상류로 나간 text 전문의 sha256(화면이 조립한 그대로)
    expect(arg.inputSnapshotHash).toBe(createHash('sha256').update(TEXT).digest('hex'));
    expect(arg.createdBy).toBe(USER_ID);
    expect(res.data.proposalId).toBe(PROPOSAL_ID);
    expect(res.data.result).toBe('입원 3일차 해열, 5일차 퇴원.'); // 본문은 그대로 나간다
  });

  it('🔴 craft 응답에 신뢰도가 없으므로 confidence 는 null 이다 — 품질점수를 신뢰도로 둔갑시키지 않는다', async () => {
    vi.mocked(service.writingCraft).mockResolvedValue(crafted({ quality_score: 0.91 }));

    await controller.writingCraft({ text: TEXT, style: 'medical_discharge', admissionId: ADMISSION_ID }, USER_ID);

    expect(proposals.create.mock.calls[0][0].confidence).toBeNull();
  });

  it('🔴 상류가 모델을 보고하면 그것만 쓰고, 안 하면 null 이다', async () => {
    vi.mocked(service.writingCraft).mockResolvedValue(crafted({ model_used: 'exaone-deep:7.8b' }));
    await controller.writingCraft({ text: TEXT, style: 'medical_discharge', admissionId: ADMISSION_ID }, USER_ID);
    expect(proposals.create.mock.calls[0][0].modelRef).toBe('exaone-deep:7.8b');

    proposals.create.mockClear();
    vi.mocked(service.writingCraft).mockResolvedValue(crafted());
    await controller.writingCraft({ text: TEXT, style: 'medical_discharge', admissionId: ADMISSION_ID }, USER_ID);
    expect(proposals.create.mock.calls[0][0].modelRef).toBeNull();
  });

  it('🔴 매핑 없는 style(소견서·의뢰서 등)은 제안을 만들지 않고 KIND_UNMAPPED 로 말한다 — 어휘를 지어내지 않는다', async () => {
    vi.mocked(service.writingCraft).mockResolvedValue(crafted());

    const res = await controller.writingCraft({ text: TEXT, style: 'professional', admissionId: ADMISSION_ID }, USER_ID);

    expect(proposals.create).not.toHaveBeenCalled();
    expect(res.data.proposalId).toBeNull();
    expect(res.data.proposalSkipped).toBe('KIND_UNMAPPED');
  });

  it('style 자체가 없으면(기본 문체) 제안을 만들지 않는다', async () => {
    vi.mocked(service.writingCraft).mockResolvedValue(crafted());

    const res = await controller.writingCraft({ text: TEXT }, USER_ID);

    expect(proposals.create).not.toHaveBeenCalled();
    expect(res.data.proposalSkipped).toBe('KIND_UNMAPPED');
  });

  it('🔴 입원을 모르면 대상을 지어내지 않는다 — TARGET_UNIDENTIFIED', async () => {
    vi.mocked(service.writingCraft).mockResolvedValue(crafted());

    const res = await controller.writingCraft({ text: TEXT, style: 'medical_discharge' }, USER_ID);

    expect(proposals.create).not.toHaveBeenCalled();
    expect(res.data.proposalSkipped).toBe('TARGET_UNIDENTIFIED');
  });

  it('🔴 상류가 200 + 빈 result 를 주면 제안을 만들지 않는다(EMPTY_DRAFT)', async () => {
    vi.mocked(service.writingCraft).mockResolvedValue(crafted({ result: '' }));

    const res = await controller.writingCraft({ text: TEXT, style: 'medical_discharge', admissionId: ADMISSION_ID }, USER_ID);

    expect(proposals.create).not.toHaveBeenCalled();
    expect(res.data.proposalSkipped).toBe('EMPTY_DRAFT');
  });

  it('🔴 제안 생성 실패는 초안 응답을 막지 않고 코드로 말한다', async () => {
    vi.mocked(service.writingCraft).mockResolvedValue(crafted());
    proposals.create.mockRejectedValue(new Error('DB down'));

    const res = await controller.writingCraft({ text: TEXT, style: 'medical_discharge', admissionId: ADMISSION_ID }, USER_ID);

    expect(res.data.result).toBe('입원 3일차 해열, 5일차 퇴원.');
    expect(res.data.proposalId).toBeNull();
    expect(res.data.proposalError).toBe('PROPOSAL_CREATE_FAILED');
  });

  it('상류 실패(예외)는 그대로 전파된다 — 실패를 빈 초안으로 번역하지 않는다', async () => {
    vi.mocked(service.writingCraft).mockRejectedValue(new Error('AI API error: 502'));

    await expect(controller.writingCraft({ text: TEXT, style: 'medical_discharge', admissionId: ADMISSION_ID }, USER_ID)).rejects.toThrow('502');
    expect(proposals.create).not.toHaveBeenCalled();
  });

  it('UUID 가 아닌 admissionId 는 원장에 넣지 않는다(@db.Uuid poison 방지)', async () => {
    vi.mocked(service.writingCraft).mockResolvedValue(crafted());

    const res = await controller.writingCraft({ text: TEXT, style: 'medical_discharge', admissionId: 'ADM-1' }, USER_ID);

    expect(proposals.create).not.toHaveBeenCalled();
    expect(res.data.proposalSkipped).toBe('TARGET_UNIDENTIFIED');
  });
});

describe('WRITING_CRAFT_PROPOSAL_KIND — 어휘 정본과의 대조', () => {
  it('매핑 값은 전부 shared AI_PROPOSAL_KINDS 안에 있다(지어낸 kind 0)', () => {
    for (const kind of Object.values(WRITING_CRAFT_PROPOSAL_KIND)) {
      expect(AI_PROPOSAL_KINDS as readonly string[]).toContain(kind);
    }
  });

  it('실제로 화면이 부르는 style 만 매핑돼 있다 — 지금은 medical_discharge 하나', () => {
    expect(Object.keys(WRITING_CRAFT_PROPOSAL_KIND)).toEqual(['medical_discharge']);
  });
});
