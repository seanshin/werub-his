import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';

/**
 * 🔴 증상 평가(트리아지)가 **죽었을 때** 챗이 아무 일도 없던 것처럼 답하지 않는지에 대한 가드(2026-08-21).
 *
 * LLM-first 경로의 `Promise.all([...evaluate().catch(() => null)])` 은 평가 실패를 `null` 로 접었고,
 * 그 뒤 분기는 `triageResult && EMERGENCY` 만 보므로 **응급 안내가 조용히 사라졌다**.
 * 실패는 '응급 아님'이 아니라 **모름**이다 — UNDETERMINED 와 같은 안전측 안내를 남긴다
 * (정본 문구 `PATIENT_EMERGENCY_UNDETERMINED`).
 *
 * 재주입 역검증: `.catch(() => null)`(플래그 없음)로 되돌리면 첫 두 it 이 실패한다.
 */
describe('예약 챗 — 증상 평가 실패를 침묵으로 넘기지 않는다', () => {
  let service: AgentSessionService;
  let prisma: any;
  let triage: any;
  let medicalAi: any;

  const session = {
    id: 'session-1',
    state: 'IDLE',
    channel: 'WEB_BOOKING',
    operatorId: 'op-1', // 공개 세션 본인확인 게이트를 우회(이 테스트의 관심이 아니다)
    context: { patient: { id: 'p-1', familyName: '김', givenName: '영수', verified: true }, reception: {}, recommendations: {} },
    messages: [],
  };

  beforeEach(() => {
    prisma = {
      agentSession: { findUnique: vi.fn().mockResolvedValue(session), update: vi.fn().mockResolvedValue({}) },
      patient: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      hospitalInfoContent: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      // findMany = 병원 정체 정본(hospital.* DB 행) — 행 없음 = 미설정
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    };
    triage = {
      evaluate: vi.fn().mockRejectedValue(new Error('AI 서버 timeout')),
      extractSymptoms: vi.fn().mockResolvedValue({ symptoms: [], symptomIds: [], matchedTerms: [], matchedSpans: [], normalizedText: '' }),
    };
    medicalAi = {
      enhancedChat: vi.fn().mockResolvedValue({ answer: '배가 아프신 경우 소화기 진료를 받아보실 수 있어요. 이 정보는 AI 참고용이며 전문의 상담을 권장합니다.' }),
    };
    service = new AgentSessionService(prisma, medicalAi, triage, {} as any, {} as any);
  });

  it('평가가 실패하면 "확인이 되지 않았다"는 사실과 안전측 안내(119)를 함께 낸다', async () => {
    const result = await service.processMessage('session-1', '어제부터 배가 아파요');
    expect(result.response).toContain('일시적으로 되지 않았습니다');
    expect(result.response).toContain('119');
  });

  it('실패를 응급으로 단정하지도 않는다 — 판단 불가 문구를 쓴다', async () => {
    const result = await service.processMessage('session-1', '어제부터 배가 아파요');
    expect(result.response).toContain('판단하지 못했습니다');
    expect(result.response).not.toContain('🚨 응급 상황일 수 있습니다');
  });

  it('평가가 정상 동작하면 그 안내를 덧붙이지 않는다(거짓 경보 금지)', async () => {
    triage.evaluate.mockResolvedValue({
      source: 'DB', symptoms: ['복통'],
      recommendations: [{ department: '내과', priority: 1, confidence: 60, reason: '복통' }],
      emergencyAssessment: 'NON_EMERGENCY', emergencyMsg: null, patientEmergencyAction: null,
    });
    const result = await service.processMessage('session-1', '어제부터 배가 아파요');
    expect(result.response).not.toContain('일시적으로 되지 않았습니다');
  });
});
