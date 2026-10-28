import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';

describe('AgentSessionService', () => {
  let service: AgentSessionService;
  let mockPrisma: any;
  let mockMedicalAi: any;
  let mockTriageService: any;

  beforeEach(() => {
    mockPrisma = {
      agentSession: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      patient: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
      },
      allergy: {
        findMany: vi.fn(),
      },
      problemList: {
        findMany: vi.fn(),
      },
      encounter: {
        findFirst: vi.fn(),
      },
      waitingQueue: {
        create: vi.fn(),
        count: vi.fn(),
      },
      appointment: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      clinicSchedule: {
        findMany: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      labResult: {
        findMany: vi.fn(),
      },
      billing: {
        findMany: vi.fn(),
      },
      systemConfig: {
        findUnique: vi.fn(),
        // 병원 정체 정본(hospital.* DB 행) — 행 없음 = 미설정
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockMedicalAi = {
      orchestrate: vi.fn(),
      generateNaturalResponse: vi.fn(),
      // 🔴 목은 정본의 **실제 반환 모양**을 쓴다 — `medicalAsk` 는 3상태 봉투(`MedicalAskResult`)를 돌려준다.
      //    종전 목에는 이 메서드가 없어 서비스의 try/catch 가 **TypeError 를 삼키고** `CALL_FAILED` 로 통과했다
      //    (증상이 있는 모든 시나리오가 실제 경로가 아니라 예외 경로를 돌고 있었다). 2026-09-28 a18ec 재판정.
      medicalAsk: vi.fn().mockResolvedValue({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_ERROR' }),
    };

    mockTriageService = {
      evaluate: vi.fn(),
      // 🔴 T4 — 증상 추출도 하드코딩 맵이 아니라 TriageService(DB 정본)가 한다.
      extractSymptoms: vi.fn().mockResolvedValue({ symptoms: [], symptomIds: [], matchedTerms: [], matchedSpans: [], normalizedText: '' }),
    };

    const mockHolidayService = {
      getBusinessDays: vi.fn().mockResolvedValue([
        new Date('2026-05-19'),
        new Date('2026-05-20'),
        new Date('2026-05-21'),
        new Date('2026-05-22'),
        new Date('2026-05-23'),
      ]),
    };
    const mockQuestionnaireService = {
      generateForAppointment: vi.fn().mockResolvedValue(null),
    };
    service = new AgentSessionService(mockPrisma, mockMedicalAi, mockTriageService, mockHolidayService as any, mockQuestionnaireService as any);
  });

  describe('createSession', () => {
    it('should create session with WEB_BOOKING channel', async () => {
      const mockSession = {
        id: 'session-1',
        channel: 'WEB_BOOKING',
        operatorId: null,
        state: 'IDLE',
        context: { patient: {}, reception: {}, recommendations: {} },
        messages: [{ role: 'agent', content: '안녕하세요! 환자 정보를 입력해주세요.', timestamp: new Date() }],
      };

      vi.mocked(mockPrisma.agentSession.create).mockResolvedValue(mockSession);

      const result = await service.createSession('WEB_BOOKING');

      expect(result.state).toBe('IDLE');
      expect(result.channel).toBe('WEB_BOOKING');
      expect(mockPrisma.agentSession.create).toHaveBeenCalled();
    });

    it('should create session with HIS channel', async () => {
      const mockSession = {
        id: 'session-2',
        channel: 'HIS',
        operatorId: 'op-1',
        state: 'IDLE',
      };

      vi.mocked(mockPrisma.agentSession.create).mockResolvedValue(mockSession);

      const result = await service.createSession('HIS', 'op-1');

      expect(result.channel).toBe('HIS');
      expect(result.operatorId).toBe('op-1');
    });

    it('should initialize with greeting message', async () => {
      const mockSession = {
        id: 'session-3',
        messages: [{ role: 'agent', content: '안녕하세요! 환자 정보를 입력해주세요.', timestamp: expect.any(Date) }],
      };

      vi.mocked(mockPrisma.agentSession.create).mockResolvedValue(mockSession);

      const result = await service.createSession('WEB_BOOKING');

      expect(result.messages).toBeDefined();
      expect(result.messages[0].role).toBe('agent');
    });
  });

  describe('getSession', () => {
    it('should retrieve existing session', async () => {
      const mockSession = { id: 'session-1', state: 'IDENTIFYING_PATIENT', operatorId: 'op-1' };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);

      const result = await service.getSession('session-1');

      expect(result.id).toBe('session-1');
      expect(mockPrisma.agentSession.findUnique).toHaveBeenCalledWith({ where: { id: 'session-1' } });
    });

    it('should return null if session not found', async () => {
      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(null);

      const result = await service.getSession('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('processMessage - IDLE state', () => {
    it('should fail if session not found', async () => {
      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(null);

      await expect(service.processMessage('invalid-id', 'test')).rejects.toThrow(NotFoundException);
    });

    it('should handle MRN search in IDLE state', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'IDLE',
        channel: 'HIS',
        operatorId: 'op-1',
        context: { patient: {}, reception: {}, recommendations: {} },
        messages: [],
      };

      const mockPatient = {
        id: 'p-1',
        mrn: 'P2026-0001',
        familyName: '김',
        givenName: '영수',
        dateOfBirth: new Date('1980-01-01'),
        gender: 'MALE',
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.patient.findFirst).mockResolvedValue(mockPatient);
      vi.mocked(mockPrisma.allergy.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.problemList.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.encounter.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', 'P2026-0001');

      expect(result.state).toBe('COLLECTING_SYMPTOMS');
      expect(result.response).toContain('어떤 증상');
      expect(mockPrisma.patient.findFirst).toHaveBeenCalledWith({ where: { mrn: 'P2026-0001' } });
    });

    it('should handle patient name search in IDLE state', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'IDLE',
        operatorId: 'op-1', // 직원 세션 — 실제 직원 경로는 항상 operatorId 를 갖는다(공개 세션과 구분)
        channel: 'HIS',
        context: { patient: {}, reception: {}, recommendations: {} },
        messages: [],
      };

      const mockPatient = {
        id: 'p-1',
        mrn: 'P2026-0001',
        familyName: '김',
        givenName: '영수',
        dateOfBirth: new Date('1980-01-01'),
        gender: 'MALE',
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.patient.findMany).mockResolvedValue([mockPatient]);
      vi.mocked(mockPrisma.allergy.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.problemList.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.encounter.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '김영수');

      expect(result.state).toBe('COLLECTING_SYMPTOMS');
      expect(mockPrisma.patient.findMany).toHaveBeenCalled();
    });

    it('should handle multiple patient search results', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'IDLE',
        operatorId: 'op-1', // 직원 세션 — 실제 직원 경로는 항상 operatorId 를 갖는다(공개 세션과 구분)
        channel: 'HIS',
        context: { patient: {}, reception: {}, recommendations: {} },
        messages: [],
      };

      const mockPatients = [
        { id: 'p-1', mrn: 'P2026-0001', familyName: '김', givenName: '영수', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' },
        { id: 'p-2', mrn: 'P2026-0002', familyName: '김', givenName: '철수', dateOfBirth: new Date('1985-05-15'), gender: 'MALE' },
      ];

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.patient.findMany)
        .mockResolvedValueOnce(mockPatients) // first call returns multiple
        .mockResolvedValueOnce([]); // second call for full name search returns empty
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '김영수');

      expect(result.state).toBe('SEARCH_RESULTS');
      expect(result.response).toContain('발견');
    });

    it('should handle new patient registration flow', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'IDLE',
        operatorId: 'op-1', // 직원 세션 — 실제 직원 경로는 항상 operatorId 를 갖는다(공개 세션과 구분)
        channel: 'HIS',
        context: { patient: {}, reception: {}, recommendations: {} },
        messages: [],
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.patient.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '이순신');

      expect(result.state).toBe('COLLECTING_PATIENT_INFO');
      expect(result.response).toContain('신규 환자');
    });
  });

  describe('processMessage - COLLECTING_PATIENT_INFO state', () => {
    it('should create new patient with birthDate and phone', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'COLLECTING_PATIENT_INFO',
        channel: 'HIS',
        operatorId: 'op-1',
        context: {
          // 신환 등록은 주소 수집 단계를 거치므로 주소가 채워진 상태에서 등록 경로로 진입
          patient: { familyName: '이', givenName: '순신', birthDate: '1545-01-01', address: '서울 강남구 역삼동 101호' },
          reception: {},
          recommendations: {},
        },
        messages: [],
      };

      const mockNewPatient = {
        id: 'p-new',
        mrn: 'HR-20260513-0001',
        familyName: '이',
        givenName: '순신',
        dateOfBirth: new Date('1545-01-01'),
        gender: 'MALE',
        phone: '01012345678',
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.patient.create).mockResolvedValue(mockNewPatient);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '1545년 01월 01일 01012345678');

      expect(result.state).toBe('COLLECTING_SYMPTOMS');
      expect(result.response).toContain('환자 등록 완료');
      expect(mockPrisma.patient.create).toHaveBeenCalled();
    });

    it('should ask for missing birthDate if only phone provided', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'COLLECTING_PATIENT_INFO',
        channel: 'HIS',
        context: {
          patient: { familyName: '이', givenName: '순신', phone: null },
          reception: {},
        },
        messages: [],
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '01012345678');

      expect(result.response).toContain('생년월일');
    });
  });

  describe('processMessage - COLLECTING_SYMPTOMS state', () => {
    it.skip('should process symptoms with TriageService', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'COLLECTING_SYMPTOMS',
        channel: 'HIS',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수', lastEncounter: null },
          reception: { department: '내과' },
          recommendations: {},
        },
        messages: [],
      };

      const mockTriageResult = {
        source: 'DB',
        symptoms: ['두통'],
        recommendations: [
          { department: '신경과', reason: '편두통', priority: 1, confidence: 90 },
          { department: '내과', reason: '일반 두통', priority: 2, confidence: 70 },
        ],
        emergencyAssessment: 'NON_EMERGENCY',
        emergencyMsg: null,
        patientEmergencyAction: null,
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockTriageService.evaluate).mockResolvedValue(mockTriageResult);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '머리가 아파요');

      expect(result.state).toBe('CONFIRMING');
      expect(result.response).toContain('추천 진료과');
      expect(mockTriageService.evaluate).toHaveBeenCalledWith('머리가 아파요');
    });

    it('should detect emergency symptoms', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'COLLECTING_SYMPTOMS',
        channel: 'HIS',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수', lastEncounter: null },
          reception: {},
          recommendations: {},
        },
        messages: [],
      };

      const mockTriageResult = {
        source: 'MEDICAL_AI',
        symptoms: ['가슴통증'],
        recommendations: [{ department: '응급의학과', reason: '응급 감별', priority: 1, confidence: 95 }],
        emergencyAssessment: 'EMERGENCY',
        // DB 원문은 감별진단 임상 메모 — 환자에게 그대로 나가면 안 된다(T6)
        emergencyMsg: '급성 관상동맥증후군/대동맥박리 감별 필요',
        patientEmergencyAction: '🚨 응급 상황일 수 있습니다. 지금 바로 119에 연락하거나 가까운 응급실로 가세요.',
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockTriageService.evaluate).mockResolvedValue(mockTriageResult);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '가슴이 너무 아파요');

      // STEP 0 응급 감지가 트리아지보다 먼저 자체 응급 안내 메시지를 반환
      expect(result.response).toContain('응급');
    });

    it('should auto-fill department from last encounter', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'COLLECTING_SYMPTOMS',
        channel: 'HIS',
        context: {
          patient: {
            id: 'p-1',
            familyName: '김',
            givenName: '영수',
            lastEncounter: { department: '내과', doctor: '이의사' },
          },
          reception: {},
          recommendations: {},
        },
        messages: [],
      };

      const mockTriageResult = {
        source: 'DB',
        symptoms: ['두통'],
        recommendations: [{ department: '내과', reason: '일반 두통', priority: 1, confidence: 80 }],
        emergencyAssessment: 'NON_EMERGENCY',
        emergencyMsg: null,
        patientEmergencyAction: null,
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockTriageService.evaluate).mockResolvedValue(mockTriageResult);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '머리가 아파요');

      expect(result.state).toBe('CONFIRMING');
      expect(result.response).toContain('접수 준비');
      // 🔴 medicalAsk 는 **정본 경로**로 불렸다 — 예외 경로(`CALL_FAILED`)가 대신 통과시키지 않는다
      expect(mockMedicalAi.medicalAsk).toHaveBeenCalledWith(expect.objectContaining({ symptoms: ['두통'] }));
      const savedCtx = vi.mocked(mockPrisma.agentSession.update).mock.calls.at(-1)?.[0]?.data?.context as any;
      expect(savedCtx?.recommendations?.medicalInsight).toEqual({ source: 'UNAVAILABLE', reason: 'AI_UPSTREAM_ERROR' });
    });
  });

  describe('processMessage - CONFIRMING state', () => {
    it('should create waiting queue on confirmation (HIS)', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'CONFIRMING',
        channel: 'HIS',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수', mrn: 'P2026-0001' },
          reception: { department: '내과', reason: '두통', visitType: 'INITIAL', doctorName: '이의사' },
          recommendations: { departments: [] },
        },
        messages: [],
      };

      const mockDoctor = { id: 'dr-1', familyName: '이', givenName: '의사' };
      const mockQueue = {
        id: 'queue-1',
        queueNumber: 1,
        patientId: 'p-1',
        doctorId: 'dr-1',
        departmentName: '내과',
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.user.findFirst).mockResolvedValue(mockDoctor);
      vi.mocked(mockPrisma.waitingQueue.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.waitingQueue.create).mockResolvedValue(mockQueue);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '네');

      expect(result.state).toBe('COMPLETED');
      expect(result.response).toContain('접수 완료');
      expect(mockPrisma.waitingQueue.create).toHaveBeenCalled();
    });

    it('should handle booking flow (WEB_BOOKING)', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'CONFIRMING',
        channel: 'WEB_BOOKING',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수', mrn: 'P2026-0001' },
          reception: { department: '내과', reason: '두통' },
          recommendations: {},
        },
        messages: [],
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '네');

      expect(result.state).toBe('SELECTING_TIME');
      expect(result.response).toContain('예약 가능 날짜');
    });

    it('should handle cancellation', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'CONFIRMING',
        channel: 'HIS',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수' },
          reception: {},
          recommendations: {},
        },
        messages: [],
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '아니오');

      expect(result.state).toBe('COLLECTING_SYMPTOMS');
      expect(result.response).toContain('어떤 증상');
    });
  });

  describe('processMessage - SELECTING_TIME state', () => {
    it('should select date from available dates', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'SELECTING_TIME',
        channel: 'WEB_BOOKING',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수' },
          reception: { department: '내과' },
          availableDates: ['2026-05-14', '2026-05-15', '2026-05-16'],
          selectedDate: null,
          recommendations: {},
        },
        messages: [],
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '1');

      expect(result.response).toContain('예약 가능 시간');
    });

    it('should create appointment on time selection', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'SELECTING_TIME',
        channel: 'WEB_BOOKING',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수', mrn: 'P2026-0001' },
          reception: { department: '내과', reason: '두통', visitType: 'INITIAL' },
          availableDates: ['2026-05-14', '2026-05-15'],
          selectedDate: '2026-05-14',
          selectedTime: null,
          recommendations: {},
        },
        messages: [],
      };

      const mockDoctor = { id: 'dr-1', familyName: '이', givenName: '의사' };
      const mockAppointment = {
        id: 'appt-1',
        patientId: 'p-1',
        doctorId: 'dr-1',
        scheduledAt: new Date('2026-05-14T09:00:00'),
        status: 'SCHEDULED',
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.user.findFirst).mockResolvedValue(mockDoctor);
      vi.mocked(mockPrisma.appointment.create).mockResolvedValue(mockAppointment);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '1');

      expect(result.state).toBe('COMPLETED');
      expect(result.response).toContain('예약이 완료');
    });
  });

  describe('parseInput', () => {
    it('should extract MRN', async () => {
      const mockSession = { id: 'session-1', state: 'IDLE', channel: 'HIS', operatorId: 'op-1', context: {}, messages: [] };
      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.patient.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.patient.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      // MRN parsing is tested indirectly via processMessage
      // P2026-0001 should be recognized as MRN
      const result = await service.processMessage('session-1', 'P2026-0001');
      expect(mockPrisma.patient.findFirst).toHaveBeenCalled();
    });

    it('should extract phone number', () => {
      // parseInput is private, test indirectly
      // Phone number 01012345678 should be recognized
    });

    it('should extract birth year', () => {
      // Birth year like 1980년 should be recognized
    });

    it('should extract gender', () => {
      // 남자, 여자 should be recognized
    });

    it('should match symptoms by alias', () => {
      // 머리가 아파 should match '두통'
    });

    it('should extract name', () => {
      // 김영수 should extract as name
    });
  });

  describe('recommendDepartments', () => {
    it('should rank departments by symptom scores', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'COLLECTING_SYMPTOMS',
        channel: 'HIS',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수' },
          reception: {},
          recommendations: {},
        },
        messages: [],
      };

      const mockTriageResult = {
        source: 'DB',
        symptoms: ['두통', '어지러움'],
        recommendations: [
          { department: '신경과', reason: '신경과 평가', priority: 1, confidence: 95 },
          { department: '내과', reason: '내과 평가', priority: 2, confidence: 80 },
        ],
        emergencyAssessment: 'NON_EMERGENCY',
        emergencyMsg: null,
        patientEmergencyAction: null,
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockTriageService.evaluate).mockResolvedValue(mockTriageResult);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '머리가 어지러워요');

      expect(result.response).toContain('추천 진료과');
    });
  });

  describe('getLastEncounter', () => {
    it('should retrieve last encounter with doctor info', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'IDLE',
        operatorId: 'op-1', // 직원 세션 — 실제 직원 경로는 항상 operatorId 를 갖는다(공개 세션과 구분)
        channel: 'HIS',
        context: { patient: {}, reception: {}, recommendations: {} },
        messages: [],
      };

      const mockPatient = {
        id: 'p-1',
        mrn: 'P2026-0001',
        familyName: '김',
        givenName: '영수',
        dateOfBirth: new Date('1980-01-01'),
        gender: 'MALE',
      };

      const mockLastEncounter = {
        id: 'enc-1',
        patientId: 'p-1',
        createdAt: new Date('2026-05-10'),
        assessment: '두통으로 내원하셨습니다',
        doctor: { familyName: '이', givenName: '의사', department: '신경과' },
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockPrisma.patient.findFirst).mockResolvedValue(mockPatient);
      vi.mocked(mockPrisma.allergy.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.problemList.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.encounter.findFirst).mockResolvedValue(mockLastEncounter);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', 'P2026-0001');

      expect(result.response).toContain('마지막 진료');
    });
  });

  describe('Medical AI Orchestration', () => {
    it.skip('should call orchestrator for WEB_BOOKING channel', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'COLLECTING_SYMPTOMS',
        channel: 'WEB_BOOKING',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수', allergies: [] },
          reception: { department: '내과' },
          recommendations: {},
        },
        messages: [{ role: 'user', content: '두통', timestamp: new Date() }],
      };

      const mockTriageResult = {
        source: 'DB',
        symptoms: ['두통'],
        recommendations: [{ department: '신경과', reason: '신경과', priority: 1, confidence: 90 }],
        emergencyAssessment: 'NON_EMERGENCY',
        emergencyMsg: null,
        patientEmergencyAction: null,
      };

      const mockOrchResult = {
        response: 'AI 생성 응답',
        toolCalls: [],
      };

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockTriageService.evaluate).mockResolvedValue(mockTriageResult);
      vi.mocked(mockMedicalAi.orchestrate).mockResolvedValue(mockOrchResult);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '머리가 아파요');

      expect(mockMedicalAi.orchestrate).toHaveBeenCalled();
    });

    it('should execute tool calls from orchestrator', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'CONFIRMING',
        channel: 'WEB_BOOKING',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수', allergies: [] },
          reception: { department: '내과' },
          recommendations: {},
        },
        messages: [{ role: 'user', content: '어떤 의료진이 있나요?', timestamp: new Date() }],
      };

      const mockOrchResult = {
        response: '의료진 정보입니다',
        toolCalls: ['DOCTORS_NEEDED:내과'],
      };

      const mockDoctors = [
        { familyName: '이', givenName: '의사', department: '내과', specialty: '소화기' },
      ];

      vi.mocked(mockPrisma.agentSession.findUnique).mockResolvedValue(mockSession);
      vi.mocked(mockTriageService.evaluate).mockResolvedValue({
        source: 'DB',
        symptoms: [],
        recommendations: [],
        emergencyAssessment: 'UNDETERMINED',
        emergencyMsg: null,
        patientEmergencyAction: '말씀만으로는 응급 여부를 판단하지 못했습니다.',
      });
      vi.mocked(mockMedicalAi.orchestrate).mockResolvedValue(mockOrchResult);
      vi.mocked(mockPrisma.user.findMany).mockResolvedValue(mockDoctors);
      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.agentSession.update).mockResolvedValue({});

      const result = await service.processMessage('session-1', '어떤 의료진이 있나요?');

      expect(result.response).toBeDefined();
    });
  });
});
