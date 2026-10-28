import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';

/**
 * 🔴 예약 챗 '참고 안내'(medicalAsk) 미가용을 침묵으로 옮기지 않는다 — 외부 점검.
 *
 * 종전: `medicalAsk` 가 실패를 `null` 로 돌려주면 `medicalInsight` 가 만들어지지 않아 디렉티브 payload 에서
 * **블록이 통째로 사라졌다.** 화면(booking `MedicalInsightCard`)은 `answer` 가 없으면 아무것도 그리지 않았다.
 *
 * 이제 서버는 3상태를 payload 에 **그대로** 싣는다. 🔴 서버가 문장을 붙이지 않는다(조립 한국어 가드 기준선 유지) —
 * 화면이 `source` 를 읽고 말한다. 답을 지어내지도 않는다(UNAVAILABLE 에 answer 없음).
 */
describe('예약 챗 medicalInsight 3상태', () => {
  let prisma: any;
  let triage: any;
  let medicalAi: any;
  let service: AgentSessionService;

  const session = {
    id: 'session-1',
    state: 'COLLECTING_SYMPTOMS', // 환자 확인이 끝난 뒤 증상 입력 단계 — 트리아지·medicalAsk 가 도는 상태
    channel: 'WEB_BOOKING',
    operatorId: 'op-1',
    context: { patient: { id: 'p-1', familyName: '김', givenName: '영수', verified: true, resolved: true, mrn: 'HR-1', birthDate: '1980-01-01' }, reception: {}, recommendations: {} },
    messages: [],
  };

  beforeEach(() => {
    session.context = { patient: { id: 'p-1', familyName: '김', givenName: '영수', verified: true, resolved: true, mrn: 'HR-1', birthDate: '1980-01-01' }, reception: {}, recommendations: {} };
    prisma = {
      agentSession: { findUnique: vi.fn().mockResolvedValue(session), update: vi.fn().mockResolvedValue({}) },
      patient: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      hospitalInfoContent: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    };
    triage = {
      evaluate: vi.fn().mockResolvedValue({
        source: 'DB', symptoms: ['복통'],
        recommendations: [{ department: '내과', priority: 1, confidence: 80, reason: '복통' }],
        emergencyAssessment: 'NON_EMERGENCY', emergencyMsg: null, patientEmergencyAction: null,
      }),
      extractSymptoms: vi.fn().mockResolvedValue({ symptoms: ['복통'], symptomIds: [], matchedTerms: [], matchedSpans: [], normalizedText: '' }),
    };
    medicalAi = { enhancedChat: vi.fn(), medicalAsk: vi.fn() };
    service = new AgentSessionService(prisma, medicalAi, triage, {} as any, {} as any);
  });

  const insightOf = (r: any) => r.uiDirective?.payload?.medicalInsight;

  it('🔴 UNAVAILABLE 이면 payload 에 출처·사유가 실린다 — 블록이 사라지지 않고, answer 를 지어내지 않는다', async () => {
    medicalAi.medicalAsk.mockResolvedValue({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_AUTH' });
    const r: any = await service.processMessage('session-1', '어제부터 배가 아파요');
    expect(medicalAi.medicalAsk).toHaveBeenCalled();
    expect(insightOf(r)).toEqual({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_AUTH' });
    expect(insightOf(r).answer).toBeUndefined();
    // 서버는 미가용을 문장으로 만들지 않는다 — 화면이 말한다
    expect(r.response).not.toContain('참고 안내');
    // 진료과 추천은 별개 경로라 그대로 남는다
    expect(r.response).toContain('내과');
  });

  it('대조군 — AI 가 답하면 source=AI 로 실리고 응답 본문에도 붙는다', async () => {
    medicalAi.medicalAsk.mockResolvedValue({ source: 'AI', data: { answer: '수분을 충분히 드세요', category: 'general' } });
    const r: any = await service.processMessage('session-1', '어제부터 배가 아파요');
    expect(insightOf(r)).toMatchObject({ source: 'AI', answer: '수분을 충분히 드세요', category: 'general' });
    expect(r.response).toContain('💡 참고 안내');
  });

  it('200 이라도 answer 가 비면 못 얻은 것이다(EMPTY_ANSWER) — 빈 카드를 AI 답변으로 그리지 않는다', async () => {
    medicalAi.medicalAsk.mockResolvedValue({ source: 'AI', data: { answer: '' } });
    const r: any = await service.processMessage('session-1', '어제부터 배가 아파요');
    expect(insightOf(r)).toEqual({ source: 'UNAVAILABLE', reason: 'EMPTY_ANSWER' });
  });

  it('호출 자체가 던져도(예상 밖) 침묵이 아니라 UNAVAILABLE/CALL_FAILED 로 말한다', async () => {
    medicalAi.medicalAsk.mockRejectedValue(new Error('boom'));
    const r: any = await service.processMessage('session-1', '어제부터 배가 아파요');
    expect(insightOf(r)).toEqual({ source: 'UNAVAILABLE', reason: 'CALL_FAILED' });
  });
});
