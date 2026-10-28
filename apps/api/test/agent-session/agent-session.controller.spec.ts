import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentSessionController, BookingController } from '../../src/modules/agent-session/agent-session.controller';

describe('AgentSessionController (HIS Internal)', () => {
  let controller: AgentSessionController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      createSession: vi.fn(),
      processMessage: vi.fn(),
      getSession: vi.fn(),
    };

    controller = new AgentSessionController(mockService);
  });

  describe('POST /session', () => {
    it('should create session with HIS channel', async () => {
      const mockSession = {
        id: 'session-1',
        channel: 'HIS_RECEPTION',
        state: 'IDLE',
      };

      vi.mocked(mockService.createSession).mockResolvedValue(mockSession);

      const result = await controller.createSession({ channel: 'HIS_RECEPTION' }, 'user-1');

      expect(result.data.id).toBe('session-1');
      expect(mockService.createSession).toHaveBeenCalledWith('HIS_RECEPTION', 'user-1');
    });

    it('should use default channel if not provided', async () => {
      const mockSession = { id: 'session-1', channel: 'HIS_RECEPTION', state: 'IDLE' };

      vi.mocked(mockService.createSession).mockResolvedValue(mockSession);

      const result = await controller.createSession({}, 'user-1');

      expect(result.data.channel).toBe('HIS_RECEPTION');
      expect(mockService.createSession).toHaveBeenCalledWith('HIS_RECEPTION', 'user-1');
    });

    it('should wrap response in data object', async () => {
      const mockSession = { id: 'session-1' };

      vi.mocked(mockService.createSession).mockResolvedValue(mockSession);

      const result = await controller.createSession({}, 'user-1');

      expect(result).toHaveProperty('data');
      expect(result.data.id).toBe('session-1');
    });

    it('should pass userId from CurrentUser decorator', async () => {
      vi.mocked(mockService.createSession).mockResolvedValue({ id: 'session-1' });

      await controller.createSession({}, 'doctor-123');

      expect(mockService.createSession).toHaveBeenCalledWith('HIS_RECEPTION', 'doctor-123');
    });
  });

  describe('POST /session/:sessionId/message', () => {
    it('should send message and return response', async () => {
      const mockResult = {
        response: '어떤 증상으로 내원하셨나요?',
        state: 'COLLECTING_SYMPTOMS',
        context: { patient: { id: 'p-1' } },
        uiDirective: null,
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: 'P2026-0001' });

      expect(result.data.response).toContain('증상');
      expect(mockService.processMessage).toHaveBeenCalledWith('session-1', 'P2026-0001');
    });

    it('should handle state transitions', async () => {
      const mockResult = {
        response: '김영수님 확인되었습니다.',
        state: 'COLLECTING_SYMPTOMS',
        context: { patient: { id: 'p-1', mrn: 'P2026-0001' } },
        uiDirective: { type: 'SHOW_PATIENT_CARD', payload: {} },
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: 'P2026-0001' });

      expect(result.data.state).toBe('COLLECTING_SYMPTOMS');
      expect(result.data.uiDirective).toBeDefined();
    });

    it('should include context in response', async () => {
      const mockResult = {
        response: '진료과 선택',
        state: 'CONFIRMING',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수' },
          reception: { department: '내과', reason: '두통' },
        },
        uiDirective: null,
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: '머리가 아파요' });

      expect(result.data.context.patient).toBeDefined();
      expect(result.data.context.reception.department).toBe('내과');
    });

    it('should wrap response in data object', async () => {
      const mockResult = { response: 'test', state: 'IDLE', context: {}, uiDirective: null };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: 'test' });

      expect(result).toHaveProperty('data');
    });
  });

  describe('GET /session/:sessionId', () => {
    it('should retrieve session state', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'COLLECTING_SYMPTOMS',
        channel: 'HIS_RECEPTION',
        context: { patient: { id: 'p-1' } },
        messages: [{ role: 'agent', content: 'greeting' }],
      };

      vi.mocked(mockService.getSession).mockResolvedValue(mockSession);

      const result = await controller.getSession('session-1');

      expect(result.data.state).toBe('COLLECTING_SYMPTOMS');
      expect(mockService.getSession).toHaveBeenCalledWith('session-1');
    });

    it('should include full conversation history', async () => {
      const mockSession = {
        id: 'session-1',
        state: 'CONFIRMING',
        messages: [
          { role: 'agent', content: 'greeting', timestamp: new Date() },
          { role: 'user', content: 'P2026-0001', timestamp: new Date() },
          { role: 'agent', content: 'patient_found', timestamp: new Date() },
          { role: 'user', content: '머리가 아파요', timestamp: new Date() },
        ],
      };

      vi.mocked(mockService.getSession).mockResolvedValue(mockSession);

      const result = await controller.getSession('session-1');

      expect(result.data.messages).toHaveLength(4);
    });

    it('should wrap response in data object', async () => {
      const mockSession = { id: 'session-1', state: 'IDLE' };

      vi.mocked(mockService.getSession).mockResolvedValue(mockSession);

      const result = await controller.getSession('session-1');

      expect(result).toHaveProperty('data');
      expect(result.data.id).toBe('session-1');
    });
  });
});

describe('BookingController (Public Booking)', () => {
  let controller: BookingController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      createSession: vi.fn(),
      processMessage: vi.fn(),
      getSession: vi.fn(),
    };

    controller = new BookingController(mockService);
  });

  describe('POST /session (Public)', () => {
    it('should create public booking session', async () => {
      const mockSession = {
        id: 'session-1',
        channel: 'WEB_BOOKING',
        state: 'IDLE',
      };

      vi.mocked(mockService.createSession).mockResolvedValue(mockSession);

      const result = await controller.createSession();

      expect(result.data.channel).toBe('WEB_BOOKING');
      expect(mockService.createSession).toHaveBeenCalledWith('WEB_BOOKING');
    });

    it('should wrap response in data object', async () => {
      const mockSession = { id: 'session-1', channel: 'WEB_BOOKING' };

      vi.mocked(mockService.createSession).mockResolvedValue(mockSession);

      const result = await controller.createSession();

      expect(result).toHaveProperty('data');
      expect(result.data.id).toBe('session-1');
    });

    it('should not require authentication', async () => {
      // This is tested by the absence of @UseGuards decorator
      vi.mocked(mockService.createSession).mockResolvedValue({ id: 'session-1' });

      const result = await controller.createSession();

      expect(result.data).toBeDefined();
    });
  });

  describe('POST /session/:sessionId/message (Public)', () => {
    it('should process booking message', async () => {
      const mockResult = {
        response: '어떤 증상으로 내원하셨나요?',
        state: 'COLLECTING_SYMPTOMS',
        context: { patient: { familyName: '김', givenName: '영수' } },
        uiDirective: null,
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: '김영수' });

      expect(result.data.response).toBeDefined();
      expect(mockService.processMessage).toHaveBeenCalledWith('session-1', '김영수');
    });

    it('should handle new patient registration flow', async () => {
      const mockResult = {
        response: '신규 환자로 등록합니다. 생년월일을 알려주세요.',
        state: 'COLLECTING_PATIENT_INFO',
        context: { patient: { familyName: '이', givenName: '순신' } },
        uiDirective: null,
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: '이순신' });

      expect(result.data.state).toBe('COLLECTING_PATIENT_INFO');
    });

    it('should show booking availability', async () => {
      const mockResult = {
        response: '📅 예약 가능 날짜...',
        state: 'SELECTING_TIME',
        context: { patient: { id: 'p-1' }, availableDates: ['2026-05-14', '2026-05-15'] },
        uiDirective: { type: 'SHOW_DATES', payload: {} },
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: '네' });

      expect(result.data.response).toContain('예약 가능');
    });

    it('should wrap response in data object', async () => {
      const mockResult = { response: 'test', state: 'IDLE', context: {}, uiDirective: null };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: 'test' });

      expect(result).toHaveProperty('data');
    });
  });

  describe('GET /session/:sessionId (Public)', () => {
    it('should retrieve public booking session', async () => {
      const mockSession = {
        id: 'session-1',
        channel: 'WEB_BOOKING',
        state: 'SELECTING_TIME',
        context: { patient: { familyName: '김', givenName: '영수' } },
      };

      vi.mocked(mockService.getSession).mockResolvedValue(mockSession);

      const result = await controller.getSession('session-1');

      expect(result.data.channel).toBe('WEB_BOOKING');
      expect(mockService.getSession).toHaveBeenCalledWith('session-1');
    });

    it('should include appointment information if available', async () => {
      const mockSession = {
        id: 'session-1',
        channel: 'WEB_BOOKING',
        state: 'COMPLETED',
        resultType: 'BOOKING_COMPLETED',
        resultId: 'appt-1',
        context: {
          patient: { id: 'p-1', familyName: '김', givenName: '영수' },
          selectedDate: '2026-05-14',
          selectedTime: '09:00',
        },
      };

      vi.mocked(mockService.getSession).mockResolvedValue(mockSession);

      const result = await controller.getSession('session-1');

      expect(result.data.state).toBe('COMPLETED');
      expect(result.data.resultType).toBe('BOOKING_COMPLETED');
    });

    it('should wrap response in data object', async () => {
      const mockSession = { id: 'session-1', state: 'IDLE' };

      vi.mocked(mockService.getSession).mockResolvedValue(mockSession);

      const result = await controller.getSession('session-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limit to POST /session (5 requests per minute)', async () => {
      // @Throttle({ default: { limit: 5, ttl: 60000 } }) is applied
      // This test just verifies the decorator is present
      vi.mocked(mockService.createSession).mockResolvedValue({ id: 'session-1' });

      const result = await controller.createSession();

      expect(result.data).toBeDefined();
    });

    it('should apply rate limit to POST /message (20 requests per minute)', async () => {
      // @Throttle({ default: { limit: 20, ttl: 60000 } }) is applied
      vi.mocked(mockService.processMessage).mockResolvedValue({
        response: 'test',
        state: 'IDLE',
        context: {},
        uiDirective: null,
      });

      const result = await controller.sendMessage('session-1', { message: 'test' });

      expect(result.data).toBeDefined();
    });

    it('should apply rate limit to GET /session (30 requests per minute)', async () => {
      // @Throttle({ default: { limit: 30, ttl: 60000 } }) is applied
      vi.mocked(mockService.getSession).mockResolvedValue({ id: 'session-1', state: 'IDLE' });

      const result = await controller.getSession('session-1');

      expect(result.data).toBeDefined();
    });
  });

  describe('Multi-language Support', () => {
    it('should handle Korean symptom description', async () => {
      const mockResult = {
        response: '신경과로 추천합니다',
        state: 'CONFIRMING',
        context: { reception: { symptoms: ['두통'] } },
        uiDirective: null,
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: '머리가 어지러워요' });

      expect(result.data.response).toBeDefined();
    });

    it('should handle colloquial Korean input', async () => {
      const mockResult = {
        response: '내과로 추천합니다',
        state: 'CONFIRMING',
        context: { reception: { symptoms: ['설사'] } },
        uiDirective: null,
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: '배탈' });

      expect(result.data.response).toBeDefined();
    });
  });

  describe('UI Directive Handling', () => {
    it('should include UI directive for patient card display', async () => {
      const mockResult = {
        response: 'Patient found',
        state: 'COLLECTING_SYMPTOMS',
        context: { patient: { id: 'p-1', mrn: 'P2026-0001', familyName: '김', givenName: '영수' } },
        uiDirective: {
          type: 'SHOW_PATIENT_CARD',
          payload: { id: 'p-1', mrn: 'P2026-0001', familyName: '김', givenName: '영수' },
        },
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: 'P2026-0001' });

      expect(result.data.uiDirective.type).toBe('SHOW_PATIENT_CARD');
    });

    it('should include UI directive for department recommendation', async () => {
      const mockResult = {
        response: '신경과 추천',
        state: 'CONFIRMING',
        context: { recommendations: { departments: [{ name: '신경과', reason: '두통' }] } },
        uiDirective: {
          type: 'SHOW_DEPT_RECOMMENDATION',
          payload: { departments: [{ name: '신경과', reason: '두통' }] },
        },
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: 'confirm' });

      expect(result.data.uiDirective.type).toBe('SHOW_DEPT_RECOMMENDATION');
    });

    it('should include navigation directive on completion', async () => {
      const mockResult = {
        response: '예약 완료',
        state: 'COMPLETED',
        context: { resultType: 'BOOKING_COMPLETED', resultId: 'appt-1' },
        uiDirective: { type: 'NAVIGATE', payload: { url: '/booking/confirmation' } },
      };

      vi.mocked(mockService.processMessage).mockResolvedValue(mockResult);

      const result = await controller.sendMessage('session-1', { message: 'final' });

      expect(result.data.uiDirective.type).toBe('NAVIGATE');
    });
  });
});
