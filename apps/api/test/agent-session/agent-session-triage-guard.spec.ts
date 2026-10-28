import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';

/**
 * 예약 챗이 환자에게 **무엇을 말하는가**에 대한 계약.
 * 🔴 T2 — 못 알아들으면 "내과 · 기본 추천(50%)" 을 사실인 양 말했다(실운영 공개 예약 16건 중 6건).
 * 🔴 T3 — 그러면서 응급 여부를 '아님'으로 단정했다.
 * 🔴 T6 — 응급일 땐 DB 감별진단 메모("급성 관상동맥증후군/대동맥박리 감별 필요")를
 *          미인증 공개 예약 챗 환자의 응답 맨 앞에 그대로 붙이고, 119 지시는 없었다.
 */
describe('AgentSession 트리아지 응답 계약', () => {
  let service: AgentSessionService;
  let mockPrisma: any;
  let mockTriage: any;
  let mockMedicalAi: any;

  const session = (channel: string) => ({
    id: 'session-1',
    state: 'COLLECTING_SYMPTOMS',
    channel,
    context: {
      patient: { id: 'p-1', familyName: '김', givenName: '영수', lastEncounter: null },
      reception: {},
      recommendations: {},
    },
    messages: [],
  });

  const FALLBACK = {
    source: 'FALLBACK',
    symptoms: [],
    recommendations: [],
    emergencyAssessment: 'UNDETERMINED',
    emergencyMsg: null,
    patientEmergencyAction: '말씀만으로는 응급 여부를 판단하지 못했습니다. 가슴 통증·호흡곤란·의식 저하·심한 출혈이 있으면 즉시 119에 연락하세요.',
  };

  const EMERGENCY = {
    source: 'DB',
    symptoms: ['흉통'],
    recommendations: [{ department: '순환기내과', reason: '급성 심근경색, 불안정 협심증 감별', priority: 1, confidence: 90 }],
    emergencyAssessment: 'EMERGENCY',
    // 운영 DB 실측값 — 감별진단 임상 메모다
    emergencyMsg: '급성 관상동맥증후군/대동맥박리 감별 필요',
    patientEmergencyAction: '🚨 응급 상황일 수 있습니다. 지금 바로 119에 연락하거나 가까운 응급실로 가세요.',
  };

  beforeEach(() => {
    mockPrisma = {
      agentSession: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      patient: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
      problemList: { findMany: vi.fn().mockResolvedValue([]) },
      encounter: { findFirst: vi.fn().mockResolvedValue(null) },
      // findMany = 병원 정체 정본(hospital.* DB 행) — 행 없음 = 미설정
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      clinicSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    };
    mockTriage = {
      evaluate: vi.fn(),
      extractSymptoms: vi.fn().mockResolvedValue({ symptoms: [], symptomIds: [], matchedTerms: [], matchedSpans: [], normalizedText: '' }),
    };
    // 🔴 `{} as any` 는 medicalAsk 가 없는 목이었다 — 서비스의 try/catch 가 TypeError 를 삼켜 `CALL_FAILED` 로 통과했다.
    //    정본의 실제 반환 모양(3상태 봉투 `MedicalAskResult`)으로 맞춘다(2026-09-28 a18ec 재판정).
    mockMedicalAi = { medicalAsk: vi.fn().mockResolvedValue({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_ERROR' }) };
    service = new AgentSessionService(mockPrisma, mockMedicalAi, mockTriage, {} as any, {} as any);
  });

  describe('🔴 T2/T3: 못 알아들었을 때', () => {
    beforeEach(() => {
      mockPrisma.agentSession.findUnique.mockResolvedValue(session('WEB_BOOKING'));
      mockTriage.evaluate.mockResolvedValue(FALLBACK);
    });

    it('가짜 추천("내과 기본 추천 50%")을 만들어 내지 않는다', async () => {
      const result = await service.processMessage('session-1', '온몸이 여기저기 아파요');
      expect(result.response).not.toContain('기본 추천');
      expect(result.response).not.toMatch(/1순위:\s*내과/);
    });

    it('응급 여부를 "아님"으로 단정하지 않고 판단 불가임을 말한다 (공개 채널 안전측 안내)', async () => {
      const result = await service.processMessage('session-1', '온몸이 여기저기 아파요');
      expect(result.response).toContain('판단하지 못했습니다');
      expect(result.response).toContain('119');
    });
  });

  describe('🔴 T6: 응급일 때 환자에게 보내는 문구', () => {
    it('환자 채널(공개 예약)에는 행동 지시(119)만 나가고 감별진단 용어는 나가지 않는다', async () => {
      mockPrisma.agentSession.findUnique.mockResolvedValue(session('WEB_BOOKING'));
      mockTriage.evaluate.mockResolvedValue(EMERGENCY);

      const result = await service.processMessage('session-1', '가슴이 답답해요');

      expect(result.response).toContain('119');
      expect(result.response).toContain('응급실');
      // 🔴 감별진단 임상 메모가 환자에게 그대로 나가면 안 된다
      expect(result.response).not.toContain('대동맥박리');
      expect(result.response).not.toContain('감별 필요');
      // 응답 맨 앞이 행동 지시여야 한다
      expect(result.response.startsWith('🚨')).toBe(true);
      // 🔴 이 시나리오는 medicalAsk 정본 경로를 실제로 지난다(예외 경로 `CALL_FAILED` 가 대신 통과시키지 않는다)
      expect(mockMedicalAi.medicalAsk).toHaveBeenCalledWith(expect.objectContaining({ symptoms: ['흉통'] }));
      expect(result.uiDirective?.payload?.medicalInsight).toEqual({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_ERROR' });
    });

    it('스태프 채널(원무 데스크)에는 임상 메모를 참고로 함께 준다', async () => {
      mockPrisma.agentSession.findUnique.mockResolvedValue(session('HIS_RECEPTION'));
      mockTriage.evaluate.mockResolvedValue(EMERGENCY);

      const result = await service.processMessage('session-1', '가슴이 답답해요');

      expect(result.response).toContain('119');
      expect(result.response).toContain('급성 관상동맥증후군/대동맥박리 감별 필요');
    });
  });
});
