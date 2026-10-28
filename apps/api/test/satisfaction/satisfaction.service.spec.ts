import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SatisfactionService } from '../../src/modules/satisfaction/satisfaction.service';

describe('SatisfactionService', () => {
  let service: SatisfactionService;
  const mockAi = {
    reference: vi.fn().mockResolvedValue({
      answer: 'positive 60% neutral 30% negative 10%',
    }),
  };

  // Stateful in-memory stores so create/find round-trips (persistence tests) work.
  let customTemplates: any[] = [];
  let actionItems: any[] = [];

  const mockPrisma = {
    surveyTemplateCustom: {
      findMany: vi.fn(async () => customTemplates.filter((t) => t.isActive)),
      create: vi.fn(async ({ data }: any) => {
        const rec = {
          id: `custom-${customTemplates.length + 1}`,
          name: data.name,
          description: data.description ?? null,
          targetDepartment: data.targetDepartment ?? null,
          questions: data.questions,
          isActive: true,
          createdAt: new Date(),
        };
        customTemplates.push(rec);
        return rec;
      }),
    },
    surveyDispatch: {
      create: vi.fn(async ({ data }: any) => ({
        id: `disp-${Date.now()}`,
        status: 'PENDING',
        ...data,
      })),
      // Distinguish caller by requested `select` fields:
      //  - stats (getDepartmentStats): selects `department`  -> [] -> fallback
      //  - trend (getTrend): selects `submittedAt`           -> [] -> fallback
      //  - sentiment (getSentiment): selects `avgScore`+`questions` ->
      //      one text-only response (real comment, no numeric score) so that
      //      hasData=true (aiSummary becomes the "분석 중" message) while the
      //      positive/neutral/negative percentages keep their default values.
      findMany: vi.fn(async ({ select }: any = {}) => {
        if (select?.submittedAt) return [];
        if (select?.department) return [];
        if (select?.avgScore && select?.questions) {
          return [
            {
              questions: [{ id: 'q8', text: '개선 의견', type: 'text' }],
              answers: { q8: '친절했습니다' },
              avgScore: null,
            },
          ];
        }
        return [];
      }),
    },
    satisfactionSurvey: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
    },
    surveyActionItem: {
      create: vi.fn(async ({ data }: any) => {
        const rec = { id: `act-${actionItems.length + 100}`, createdAt: new Date(), ...data };
        actionItems.push(rec);
        return rec;
      }),
      findMany: vi.fn(async () => [...actionItems].reverse()),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    customTemplates = [];
    actionItems = [];
    service = new SatisfactionService(mockAi as any, mockPrisma as any);
  });

  /* ── 1. getTemplates ─────────────────────── */

  describe('getTemplates', () => {
    it('should return pre-seeded templates', async () => {
      const templates = await service.getTemplates();

      expect(templates.length).toBeGreaterThanOrEqual(3);
    });

    it('should include active templates with questions', async () => {
      const templates = await service.getTemplates();

      for (const t of templates) {
        expect(t.isActive).toBe(true);
        expect(t.questions.length).toBeGreaterThan(0);
        expect(t).toHaveProperty('id');
        expect(t).toHaveProperty('name');
        expect(t).toHaveProperty('description');
      }
    });

    it('should have question types of likert5, nps, or text', async () => {
      const templates = await service.getTemplates();
      const validTypes = ['likert5', 'nps', 'text'];

      for (const t of templates) {
        for (const q of t.questions) {
          expect(validTypes).toContain(q.type);
        }
      }
    });
  });

  /* ── 2. createTemplate ───────────────────── */

  describe('createTemplate', () => {
    it('should add a new template and return it', async () => {
      const created = await service.createTemplate({
        name: '테스트 설문',
        description: '단위 테스트용 설문',
        questions: [
          { text: '테스트 질문 1', type: 'likert5' },
          { text: '자유 응답', type: 'text' },
        ],
      });

      expect(created.name).toBe('테스트 설문');
      expect(created.isActive).toBe(true);
      expect(created.questions).toHaveLength(2);
      expect(created.questions[0].id).toBe('q1');
      expect(created.questions[1].id).toBe('q2');

      // Verify it persists in the list
      const all = await service.getTemplates();
      expect(all.find(t => t.id === created.id)).toBeDefined();
    });

    it('should assign target department when provided', async () => {
      const created = await service.createTemplate({
        name: '응급실 전용 설문',
        targetDepartment: '응급의학과',
        questions: [{ text: '질문', type: 'nps' }],
      });

      expect(created.targetDepartment).toBe('응급의학과');
    });

    it('should set targetDepartment to null when not provided', async () => {
      const created = await service.createTemplate({
        name: '공통 설문',
        questions: [{ text: '질문', type: 'likert5' }],
      });

      expect(created.targetDepartment).toBeNull();
    });
  });

  /* ── 3. dispatchToken ────────────────────── */
  /* `dispatch` was refactored into token-based `dispatchToken` (creates a
   * SurveyDispatch row and returns a one-time survey link). */

  describe('dispatchToken', () => {
    it('should issue a token and survey link for the given channel', async () => {
      const result = await service.dispatchToken({
        templateId: 'tmpl-001',
        channel: 'SMS',
      });

      expect(result.token).toBeDefined();
      expect(result.url).toContain('/survey/');
      expect(result.channel).toBe('SMS');
      expect(result.templateName).toBeDefined();
      expect(mockPrisma.surveyDispatch.create).toHaveBeenCalledTimes(1);
    });

    it('should default to PORTAL channel', async () => {
      const result = await service.dispatchToken({ templateId: 'tmpl-001' });

      expect(result.channel).toBe('PORTAL');
    });

    it('should throw when the template does not exist', async () => {
      await expect(
        service.dispatchToken({ templateId: 'does-not-exist' }),
      ).rejects.toThrow();
    });
  });

  /* ── 4. submitResponse ───────────────────── */

  describe('submitResponse', () => {
    it('should store a response and return it', async () => {
      const response = await service.submitResponse({
        templateId: 'tmpl-001',
        patientId: 'pt-100',
        department: '내과',
        answers: { q1: 5, q2: 4, q7: 9, q8: '좋았습니다' },
      });

      expect(response.id).toBeDefined();
      expect(response.templateId).toBe('tmpl-001');
      expect(response.patientId).toBe('pt-100');
      expect(response.department).toBe('내과');
      expect(response.answers.q1).toBe(5);
      expect(response.submittedAt).toBeDefined();
    });

    it('should accept mixed numeric and text answers', async () => {
      const response = await service.submitResponse({
        templateId: 'tmpl-002',
        patientId: 'pt-200',
        department: '외과',
        answers: { q1: 3, q2: 4, q3: 2, q8: '개선 필요' },
      });

      expect(typeof response.answers.q1).toBe('number');
      expect(typeof response.answers.q8).toBe('string');
    });
  });

  /* ── 5. getDepartmentStats ───────────────── */

  describe('getDepartmentStats', () => {
    /**
     * 🔴 표본 부재 → 빈 목록(P15 · W6).
     * 종전에는 완료 설문이 하나도 없어도 8개 과의 NPS·응답 수·문항 점수를 `randomBetween()`
     * 으로 만들어 냈고, 화면은 그것을 부서 실적으로 그렸다 — 새로고침마다 값이 달라졌다.
     */
    it('🔴 완료 응답이 없으면 빈 목록 — 난수 실적을 만들지 않는다', async () => {
      const stats = await service.getDepartmentStats();

      expect(stats).toEqual([]);
    });

    it('🔴 부서를 지정해도 응답이 없으면 그 부서를 지어내지 않는다', async () => {
      const stats = await service.getDepartmentStats('내과');

      expect(stats).toEqual([]);
    });
  });

  /* ── 6. getTrend ─────────────────────────── */

  describe('getTrend', () => {
    /**
     * 🔴 종전 폴백은 '2025-Q3 NPS 52 · 응답 420건' 같은 **존재한 적 없는 분기 실적**과,
     * 난수로 계속 우상향하는 8개월 추이를 반환했다. 스펙조차 그 상승을 계약으로 굳혀
     * ('should have increasing NPS in quarterly data') 날조가 회귀 테스트로 보호되고 있었다.
     */
    it('🔴 제출된 응답이 없으면 월별 추이는 빈 목록', async () => {
      expect(await service.getTrend()).toEqual([]);
    });

    it('🔴 분기 추이도 지어내지 않는다 — 없던 4개 분기 실적 금지', async () => {
      expect(await service.getTrend('quarterly')).toEqual([]);
    });
  });

  /* ── 7. getSentiment ─────────────────────── */

  describe('getSentiment', () => {
    /**
     * 🔴 종전에는 코멘트가 하나도 없을 때 **예시 문장 4개를 지어내 AI 에 넣고**,
     * 그 요약을 "WeRU.B 분석 요약"으로 화면에 그렸다 — 아무 환자도 하지 않은 말이
     * 환자 목소리로 읽혔다. 긍/부정 비율 62/23/15 와 키워드 6개도 고정 상수였다.
     */
    it('🔴 실제 코멘트만 AI 에 넘긴다 — 지어낸 예시 문장이 섞이지 않는다', async () => {
      const result = await service.getSentiment();

      // 목 데이터의 유일한 코멘트
      expect(mockAi.reference).toHaveBeenCalledTimes(1);
      const [prompt] = mockAi.reference.mock.calls[0];
      expect(prompt).toContain('친절했습니다');
      expect(prompt).not.toContain('의사 선생님이 매우 친절하게');
      expect(result.aiSummary).toBe('positive 60% neutral 30% negative 10%');
    });

    it('🔴 코멘트가 없으면 AI 를 아예 부르지 않는다', async () => {
      (mockPrisma.surveyDispatch.findMany as any).mockResolvedValueOnce([]);
      const result = await service.getSentiment();

      expect(mockAi.reference).not.toHaveBeenCalled();
      expect(result.aiSummary).toBeNull();
      expect(result.commentCount).toBe(0);
    });

    it('🔴 평점 표본이 없으면 비율은 0 이 아니라 null', async () => {
      const result = await service.getSentiment();

      expect(result.positive).toBeNull();
      expect(result.neutral).toBeNull();
      expect(result.negative).toBeNull();
      expect(result.scoredCount).toBe(0);
    });

    it('🔴 키워드를 고정 상수로 채우지 않는다', async () => {
      const result = await service.getSentiment();

      expect(result.topPositive).toEqual([]);
      expect(result.topNegative).toEqual([]);
    });

    /**
     * 🔴 `Promise.all` 안에서 실패가 조용히 사라지던 자리 (2026-08-21)
     *
     * 종전에는 두 조회 모두 `.catch(() => [])` 였다. 원장이 죽으면 표본이 통째로 비고,
     * 화면은 그것을 **"분석할 응답이 없습니다"**(EmptyState)로 그렸다 — DB 장애가
     * '설문 응답 0건'이라는 관측 사실로 읽혔다.
     *
     * 재주입 검증: `.catch(() => [])` 로 되돌리면 unavailable 이 항상 비어 아래가 실패한다.
     */
    it('🔴 조회 실패는 "응답 0건"이 아니다 — unavailable 로 드러낸다', async () => {
      (mockPrisma.surveyDispatch.findMany as any).mockRejectedValueOnce(new Error('DB down'));

      const result = await service.getSentiment();

      expect(result.unavailable).toContain('SURVEY_DISPATCH');
      expect(result.scoredCount).toBe(0);
      expect(result.commentCount).toBe(0);
      // 표본 부재와 구분되어야 한다 — 아래 케이스에서 unavailable 은 빈 배열이다
    });

    it('🔴 한쪽만 실패해도 나머지 표본은 살린다(부분 성공)', async () => {
      (mockPrisma.satisfactionSurvey.findMany as any).mockRejectedValueOnce(new Error('DB down'));

      const result = await service.getSentiment();

      expect(result.unavailable).toEqual(['SATISFACTION_SURVEY']);
      expect(result.commentCount).toBe(1); // surveyDispatch 쪽 코멘트는 살아 있다
    });

    it('둘 다 성공하면 unavailable 은 빈 배열 — 표본 부재와 조회 실패를 가른다', async () => {
      const result = await service.getSentiment();

      expect(result.unavailable).toEqual([]);
    });
  });

  /* ── 8. getBenchmark ─────────────────────── */

  describe('getBenchmark', () => {
    /**
     * 🔴 종전에는 10개 항목의 우리 병원 점수·전국 평균·격차가 전부 하드코딩이었는데
     * 화면 하단에 '출처: 건강보험심사평가원 환자경험평가 (2025)' 를 달아, 측정된 적 없는
     * 숫자에 공식 출처를 붙였다. 경영 보고에 그대로 쓰이면 없는 우위를 있다고 말하게 된다.
     */
    it('🔴 비교 기준이 없으면 available:false — 하드코딩 점수표를 반환하지 않는다', async () => {
      const benchmark = await service.getBenchmark();

      expect(benchmark.available).toBe(false);
      expect(benchmark.items).toEqual([]);
      expect(benchmark.reason).toBeTruthy();
    });

    it('🔴 출처가 없으면 출처를 표기하지 않는다', async () => {
      const benchmark = await service.getBenchmark();

      expect(benchmark.source).toBeUndefined();
    });
  });

  /* ── 9. createAction ─────────────────────── */

  describe('createAction', () => {
    it('should register an improvement action with OPEN status', async () => {
      const action = await service.createAction({
        department: '내과',
        title: '대기 시간 모니터링 강화',
        description: '실시간 대기 현황 대시보드 도입',
        priority: 'HIGH',
        assignee: '이담당',
      });

      expect(action.id).toBeDefined();
      expect(action.status).toBe('OPEN');
      expect(action.department).toBe('내과');
      expect(action.priority).toBe('HIGH');
      expect(action.assignee).toBe('이담당');
      expect(action.createdAt).toBeDefined();
    });

    it('should persist the action in the actions list', async () => {
      const action = await service.createAction({
        department: '외과',
        title: '수술 설명 개선',
        description: '시각자료 추가',
        priority: 'MEDIUM',
      });

      const all = await service.getActions();
      expect(all.find(a => a.id === action.id)).toBeDefined();
    });

    it('should support all priority levels', async () => {
      const priorities = ['HIGH', 'MEDIUM', 'LOW'] as const;

      for (const priority of priorities) {
        const action = await service.createAction({
          department: '내과',
          title: `${priority} 과제`,
          description: '테스트',
          priority,
        });
        expect(action.priority).toBe(priority);
      }
    });
  });
});
