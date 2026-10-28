import { describe, it, expect, vi } from 'vitest';
import {
  ScribeService,
  pickAiModelName,
  SCRIBE_DRAFT_PROMPT_VERSION_AI,
  SCRIBE_DRAFT_PROMPT_VERSION_RULE,
} from '../../src/modules/scribe/scribe.service';

/**
 * 🔴 R12-a — `ScribeSession.aiModel`·`aiPromptVersion` 은 **writer 가 0개**였다(죽은 정본).
 *    초안이 무엇으로 만들어졌는지 되물을 수 없었다. 여기서는 두 가지만 못박는다:
 *    ① 상류가 밝힌 모델만 적는다(안 밝히면 null — 지어내지 않는다)
 *    ② AI 경로와 규칙 저하 경로를 **다른 버전**으로 적는다(뭉치면 구분이 사라진다)
 */
const ENC = { id: 'e1', patientId: 'p1', doctorId: 'doc1' };
const SEGS = [{ role: 'DOCTOR', text: '어디가 불편하세요' }, { role: 'PATIENT', text: '두통이 있어요' }];

function make(medicalAi?: unknown) {
  const update = vi.fn().mockResolvedValue({});
  const prisma: any = {
    encounter: { findUnique: vi.fn().mockResolvedValue(ENC) },
    scribeSession: { findUnique: vi.fn().mockResolvedValue({ id: 's1', encounterId: 'e1', patientId: 'p1', doctorId: 'doc1', transcript: SEGS }), update },
    // D5 — draft() 는 AI 전송 전 비식별용 이름을 세션의 환자·의사에서 읽는다(실파이프 모양)
    patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '김', givenName: '철수', koreanName: null, mrn: 'M1' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ familyName: '박', givenName: '지훈' }) },
  };
  const config: any = { get: vi.fn((k: string) => Promise.resolve(k === 'scribe.enabled' ? true : undefined)) };
  const svc = new ScribeService(prisma, {} as any, {} as any, config, undefined, medicalAi as any);
  return { svc, update };
}

describe('🔴 초안 프로비넌스 — 모델은 상류가 말한 것만', () => {
  it('상류가 model_used 를 주면 그대로 적는다', async () => {
    const { svc, update } = make({ autoRecord: vi.fn().mockResolvedValue({ soap: { subjective: 'x' }, model_used: 'qwen2.5:14b' }) });
    await svc.draft('e1', 's1', 'doc1');
    expect(update.mock.calls[0][0].data).toMatchObject({
      aiModel: 'qwen2.5:14b',
      aiPromptVersion: SCRIBE_DRAFT_PROMPT_VERSION_AI,
    });
  });

  it('🔴 상류가 모델을 안 밝히면 null 이다 — 상수를 지어내지 않는다', async () => {
    const { svc, update } = make({ autoRecord: vi.fn().mockResolvedValue({ soap: { subjective: 'x' } }) });
    await svc.draft('e1', 's1', 'doc1');
    expect(update.mock.calls[0][0].data.aiModel).toBeNull();
    expect(update.mock.calls[0][0].data.aiPromptVersion).toBe(SCRIBE_DRAFT_PROMPT_VERSION_AI);
  });

  it('🔴 규칙 저하 경로는 AI 버전으로 적지 않는다(무엇으로 만들었는지가 달라진다)', async () => {
    const { svc, update } = make(undefined);
    await svc.draft('e1', 's1', 'doc1');
    expect(update.mock.calls[0][0].data).toMatchObject({
      aiModel: null,
      aiPromptVersion: SCRIBE_DRAFT_PROMPT_VERSION_RULE,
    });
    expect(SCRIBE_DRAFT_PROMPT_VERSION_RULE).not.toBe(SCRIBE_DRAFT_PROMPT_VERSION_AI);
  });

  it('모델 이름 추출은 문자열만 받고 64자(VarChar)로 자른다', () => {
    expect(pickAiModelName({ model: 'llama3' })).toBe('llama3');
    expect(pickAiModelName({ model_used: 'a', model: 'b' })).toBe('a'); // model_used 우선
    expect(pickAiModelName({ model: 12345 })).toBeNull(); // 숫자는 모델 이름이 아니다
    expect(pickAiModelName({ model: '   ' })).toBeNull();
    expect(pickAiModelName(null)).toBeNull();
    expect(pickAiModelName([{ model: 'x' }])).toBeNull();
    expect(pickAiModelName({ model: 'z'.repeat(200) })!.length).toBe(64);
  });
});
