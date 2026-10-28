import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriageController } from '../../src/modules/triage/triage.controller';

describe('TriageController', () => {
  let controller: TriageController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      evaluate: vi.fn(),
      getSymptoms: vi.fn(),
      createSymptom: vi.fn(),
      updateSymptom: vi.fn(),
      deleteSymptom: vi.fn(),
      getRules: vi.fn(),
      createRule: vi.fn(),
      updateRule: vi.fn(),
      deleteRule: vi.fn(),
      getRuleStats: vi.fn(),
      getAliases: vi.fn(),
      createAlias: vi.fn(),
      createAliasesBulk: vi.fn(),
      deleteAlias: vi.fn(),
      selfCheck: vi.fn(),
      emergencyMsgAudit: vi.fn(),
    };

    controller = new TriageController(mockService);
  });

  describe('POST /api/v1/triage/evaluate', () => {
    it('should evaluate symptoms and return recommendations', async () => {
      const mockResult = {
        source: 'db',
        emergency: false,
        recommendations: [
          { rank: 1, department: '신경과', confidence: 0.95 },
        ],
      };

      vi.mocked(mockService.evaluate).mockResolvedValue(mockResult);

      const result = await controller.evaluate({ text: '두통 3일' });

      expect(result.data).toEqual(mockResult);
      expect(mockService.evaluate).toHaveBeenCalledWith('두통 3일', undefined);
    });

    it('should detect emergency symptoms', async () => {
      const mockResult = {
        source: 'db',
        emergencyAssessment: 'EMERGENCY',
        patientEmergencyAction: '🚨 응급 상황일 수 있습니다. 지금 바로 119에 연락하거나 가까운 응급실로 가세요.',
        recommendations: [],
      };

      vi.mocked(mockService.evaluate).mockResolvedValue(mockResult);

      const result = await controller.evaluate({ text: '응급' });

      expect(result.data.emergencyAssessment).toBe('EMERGENCY');
      expect(result.data.patientEmergencyAction).toContain('119');
    });

    it('should return AI-based recommendations on DB fallback', async () => {
      const mockResult = {
        source: 'ai',
        emergencyAssessment: 'UNDETERMINED',
        recommendations: [{ rank: 1, department: '응급의학과', confidence: 0.8 }],
      };

      vi.mocked(mockService.evaluate).mockResolvedValue(mockResult);

      const result = await controller.evaluate({ text: '증상' });

      expect(result.data.source).toBe('ai');
    });

    it('🔴 T3: FALLBACK 은 응급 여부를 단정하지 않는다', async () => {
      const mockResult = {
        source: 'FALLBACK',
        emergencyAssessment: 'UNDETERMINED',
        emergencyMsg: null,
        patientEmergencyAction: '말씀만으로는 응급 여부를 판단하지 못했습니다. … 즉시 119에 연락하세요.',
        recommendations: [],
      };

      vi.mocked(mockService.evaluate).mockResolvedValue(mockResult);

      const result = await controller.evaluate({ text: '미확인증상' });

      expect(result.data.source).toBe('FALLBACK');
      expect(result.data.emergencyAssessment).toBe('UNDETERMINED');
      expect(result.data.recommendations).toEqual([]);
    });
  });

  describe('GET /api/v1/triage/symptoms', () => {
    it('should return all symptoms', async () => {
      const mockSymptoms = [
        {
          id: 'symptom-1',
          name: '두통',
          category: 'neurological',
          emergency: false,
        },
        {
          id: 'symptom-2',
          name: '가슴통증',
          category: 'cardiovascular',
          emergency: true,
        },
      ];

      vi.mocked(mockService.getSymptoms).mockResolvedValue(mockSymptoms);

      const result = await controller.getSymptoms();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe('두통');
      expect(mockService.getSymptoms).toHaveBeenCalledWith(undefined);
    });

    it('should filter symptoms by category', async () => {
      const mockSymptoms = [
        {
          id: 'symptom-1',
          name: '두통',
          category: 'neurological',
        },
      ];

      vi.mocked(mockService.getSymptoms).mockResolvedValue(mockSymptoms);

      const result = await controller.getSymptoms('neurological');

      expect(result.data).toHaveLength(1);
      expect(mockService.getSymptoms).toHaveBeenCalledWith('neurological');
    });

    it('should return empty array when no symptoms match filter', async () => {
      vi.mocked(mockService.getSymptoms).mockResolvedValue([]);

      const result = await controller.getSymptoms('nonexistent');

      expect(result.data).toEqual([]);
    });
  });

  describe('POST /api/v1/triage/symptoms', () => {
    it('should create a new symptom', async () => {
      const dto = {
        name: '발열',
        category: 'systemic',
        emergency: false,
      };

      const mockSymptom = { id: 'symptom-1', ...dto, active: true };

      vi.mocked(mockService.createSymptom).mockResolvedValue(mockSymptom);

      const result = await controller.createSymptom(dto);

      // 🔴 T7 — 포장은 컨트롤러가 정확히 한 번만 한다(`{ data, meta }` 규약).
      expect(result).toEqual({ data: mockSymptom });
      expect(mockService.createSymptom).toHaveBeenCalledWith(dto);
    });

    it('should create symptom with emergency flag', async () => {
      const dto = {
        name: '심한 호흡곤란',
        category: 'respiratory',
        emergency: true,
      };

      const mockSymptom = { id: 'symptom-1', ...dto, active: true };

      vi.mocked(mockService.createSymptom).mockResolvedValue(mockSymptom);

      const result = await controller.createSymptom(dto);

      expect(result.data.emergency).toBe(true);
    });
  });

  describe('PATCH /api/v1/triage/symptoms/:id', () => {
    it('should update symptom details', async () => {
      const dto = { name: '두통 (수정됨)', category: 'neurological' };
      const mockSymptom = { id: 'symptom-1', ...dto, active: true };

      vi.mocked(mockService.updateSymptom).mockResolvedValue(mockSymptom);

      const result = await controller.updateSymptom('symptom-1', dto);

      expect(result).toEqual({ data: mockSymptom });
      expect(mockService.updateSymptom).toHaveBeenCalledWith('symptom-1', dto);
    });

    it('should update emergency flag', async () => {
      const dto = { emergency: true };
      const mockSymptom = { id: 'symptom-1', name: '두통', ...dto, active: true };

      vi.mocked(mockService.updateSymptom).mockResolvedValue(mockSymptom);

      const result = await controller.updateSymptom('symptom-1', dto);

      expect(result.data.emergency).toBe(true);
    });
  });

  describe('DELETE /api/v1/triage/symptoms/:id', () => {
    it('should soft delete a symptom', async () => {
      const mockSymptom = { id: 'symptom-1', name: '두통', active: false };

      vi.mocked(mockService.deleteSymptom).mockResolvedValue(mockSymptom);

      const result = await controller.deleteSymptom('symptom-1');

      expect(result.data).toEqual(mockSymptom);
      expect(result.data.active).toBe(false);
      expect(mockService.deleteSymptom).toHaveBeenCalledWith('symptom-1');
    });
  });

  describe('GET /api/v1/triage/rules', () => {
    it('should return all rules', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          symptomId: 'symptom-1',
          department: '신경과',
          priority: 1,
          hitCount: 100,
        },
      ];

      vi.mocked(mockService.getRules).mockResolvedValue(mockRules);

      const result = await controller.getRules();

      expect(result.data).toHaveLength(1);
      expect(mockService.getRules).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should filter rules by symptomId', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          symptomId: 'symptom-1',
          department: '신경과',
        },
      ];

      vi.mocked(mockService.getRules).mockResolvedValue(mockRules);

      const result = await controller.getRules('symptom-1');

      expect(result.data).toHaveLength(1);
      expect(mockService.getRules).toHaveBeenCalledWith('symptom-1', undefined);
    });

    it('should filter rules by department', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          symptomId: 'symptom-1',
          department: '신경과',
        },
      ];

      vi.mocked(mockService.getRules).mockResolvedValue(mockRules);

      const result = await controller.getRules(undefined, '신경과');

      expect(mockService.getRules).toHaveBeenCalledWith(undefined, '신경과');
    });

    it('should combine multiple filters', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          symptomId: 'symptom-1',
          department: '신경과',
        },
      ];

      vi.mocked(mockService.getRules).mockResolvedValue(mockRules);

      const result = await controller.getRules('symptom-1', '신경과');

      expect(mockService.getRules).toHaveBeenCalledWith('symptom-1', '신경과');
    });

    it('should order rules by hit count descending', async () => {
      const mockRules = [
        { id: 'rule-1', hitCount: 150 },
        { id: 'rule-2', hitCount: 100 },
        { id: 'rule-3', hitCount: 50 },
      ];

      vi.mocked(mockService.getRules).mockResolvedValue(mockRules);

      const result = await controller.getRules();

      expect(result.data[0].hitCount).toBeGreaterThanOrEqual(result.data[1].hitCount);
    });
  });

  describe('POST /api/v1/triage/rules', () => {
    it('should create a new rule', async () => {
      const dto = {
        symptomId: 'symptom-1',
        department: '신경과',
        priority: 1,
      };

      const mockRule = {
        id: 'rule-1',
        ...dto,
        createdBy: 'user-1',
        hitCount: 0,
      };

      vi.mocked(mockService.createRule).mockResolvedValue(mockRule);

      const result = await controller.createRule(dto, 'user-1');

      expect(result).toEqual({ data: mockRule });
      expect(mockService.createRule).toHaveBeenCalledWith({
        ...dto,
        createdBy: 'user-1',
      });
    });

    it('should set createdBy from CurrentUser', async () => {
      const dto = {
        symptomId: 'symptom-1',
        department: '신경과',
        priority: 1,
      };

      const mockRule = { id: 'rule-1', ...dto, createdBy: 'doctor-123' };

      vi.mocked(mockService.createRule).mockResolvedValue(mockRule);

      const result = await controller.createRule(dto, 'doctor-123');

      expect(mockService.createRule).toHaveBeenCalledWith({
        ...dto,
        createdBy: 'doctor-123',
      });
    });
  });

  describe('PATCH /api/v1/triage/rules/:id', () => {
    it('should update rule', async () => {
      const dto = { priority: 2 };
      const mockRule = { id: 'rule-1', department: '신경과', ...dto };

      vi.mocked(mockService.updateRule).mockResolvedValue(mockRule);

      const result = await controller.updateRule('rule-1', dto);

      expect(result).toEqual({ data: mockRule });
      expect(mockService.updateRule).toHaveBeenCalledWith('rule-1', dto);
    });
  });

  describe('DELETE /api/v1/triage/rules/:id', () => {
    it('should soft delete a rule', async () => {
      const mockRule = { id: 'rule-1', active: false };

      vi.mocked(mockService.deleteRule).mockResolvedValue(mockRule);

      const result = await controller.deleteRule('rule-1');

      expect(result.data).toEqual(mockRule);
      expect(mockService.deleteRule).toHaveBeenCalledWith('rule-1');
    });
  });

  describe('GET /api/v1/triage/rules/stats', () => {
    it('should return rule statistics', async () => {
      const mockStats = {
        topRules: [
          { ruleId: 'rule-1', hitCount: 500, department: '신경과' },
          { ruleId: 'rule-2', hitCount: 300, department: '내과' },
        ],
        totalRules: 45,
        totalSymptoms: 80,
        totalAliases: 150,
      };

      vi.mocked(mockService.getRuleStats).mockResolvedValue(mockStats);

      const result = await controller.getRuleStats();

      expect(result.data).toEqual(mockStats);
      expect(result.data.topRules).toHaveLength(2);
    });

    it('should include aggregated counts', async () => {
      const mockStats = {
        topRules: [],
        totalRules: 100,
        totalSymptoms: 200,
        totalAliases: 500,
      };

      vi.mocked(mockService.getRuleStats).mockResolvedValue(mockStats);

      const result = await controller.getRuleStats();

      expect(result.data.totalRules).toBe(100);
      expect(result.data.totalSymptoms).toBe(200);
      expect(result.data.totalAliases).toBe(500);
    });
  });

  describe('GET /api/v1/triage/aliases', () => {
    it('should return all aliases', async () => {
      const mockAliases = [
        { id: 'alias-1', symptomId: 'symptom-1', alias: '머리 아픔', hitCount: 10 },
        { id: 'alias-2', symptomId: 'symptom-1', alias: '편두통', hitCount: 5 },
      ];

      vi.mocked(mockService.getAliases).mockResolvedValue(mockAliases);

      const result = await controller.getAliases();

      expect(result.data).toHaveLength(2);
      expect(mockService.getAliases).toHaveBeenCalledWith(undefined);
    });

    it('should filter aliases by symptomId', async () => {
      const mockAliases = [
        { id: 'alias-1', symptomId: 'symptom-1', alias: '머리 아픔' },
      ];

      vi.mocked(mockService.getAliases).mockResolvedValue(mockAliases);

      const result = await controller.getAliases('symptom-1');

      expect(result.data).toHaveLength(1);
      expect(mockService.getAliases).toHaveBeenCalledWith('symptom-1');
    });

    it('should order aliases by hit count descending', async () => {
      const mockAliases = [
        { id: 'alias-1', hitCount: 100 },
        { id: 'alias-2', hitCount: 50 },
      ];

      vi.mocked(mockService.getAliases).mockResolvedValue(mockAliases);

      const result = await controller.getAliases();

      expect(result.data[0].hitCount).toBeGreaterThanOrEqual(result.data[1].hitCount);
    });
  });

  describe('POST /api/v1/triage/aliases', () => {
    it('should create a single alias', async () => {
      const body = { symptomId: 'symptom-1', alias: '머리 아픔' };
      const mockAlias = { id: 'alias-1', ...body };

      vi.mocked(mockService.createAlias).mockResolvedValue(mockAlias);

      const result = await controller.createAlias(body);

      expect(result.data).toEqual(mockAlias);
      expect(mockService.createAlias).toHaveBeenCalledWith(body);
    });

    it('should handle duplicate alias gracefully', async () => {
      const body = { symptomId: 'symptom-1', alias: '두통' };
      const mockAlias = { id: 'alias-1', ...body };

      vi.mocked(mockService.createAlias).mockResolvedValue(mockAlias);

      const result = await controller.createAlias(body);

      expect(result.data).toBeDefined();
    });
  });

  describe('POST /api/v1/triage/aliases/bulk', () => {
    it('should create multiple aliases', async () => {
      const items = [
        { symptomId: 'symptom-1', alias: '머리 아픔' },
        { symptomId: 'symptom-1', alias: '편두통' },
      ];

      const mockResult = {
        created: 2,
        total: 2,
      };

      vi.mocked(mockService.createAliasesBulk).mockResolvedValue(mockResult);

      const result = await controller.createAliasesBulk({ items });

      expect(result.data.created).toBe(2);
      expect(mockService.createAliasesBulk).toHaveBeenCalledWith(items);
    });

    it('should skip duplicates and report count', async () => {
      const items = [
        { symptomId: 'symptom-1', alias: '머리 아픔' },
        { symptomId: 'symptom-1', alias: '두통' }, // duplicate
      ];

      const mockResult = {
        created: 1,
        total: 2,
      };

      vi.mocked(mockService.createAliasesBulk).mockResolvedValue(mockResult);

      const result = await controller.createAliasesBulk({ items });

      expect(result.data.created).toBe(1);
      expect(result.data.total).toBe(2);
    });

    it('should handle large bulk operations', async () => {
      const items = Array(100)
        .fill(null)
        .map((_, i) => ({
          symptomId: 'symptom-1',
          alias: `alias-${i}`,
        }));

      const mockResult = {
        created: 100,
        total: 100,
      };

      vi.mocked(mockService.createAliasesBulk).mockResolvedValue(mockResult);

      const result = await controller.createAliasesBulk({ items });

      expect(result.data.created).toBe(100);
    });
  });

  describe('DELETE /api/v1/triage/aliases/:id', () => {
    it('should delete an alias', async () => {
      const mockAlias = { id: 'alias-1', symptomId: 'symptom-1', alias: '머리 아픔' };

      vi.mocked(mockService.deleteAlias).mockResolvedValue(mockAlias);

      const result = await controller.deleteAlias('alias-1');

      expect(result.data).toEqual(mockAlias);
      expect(mockService.deleteAlias).toHaveBeenCalledWith('alias-1');
    });
  });

  // 🔴 원 결함 T7 — 서비스도 `{ data }` 로 감싸고 컨트롤러도 감싸 `{data:{data:…}}` 가 나갔다.
  //    FE 통계 탭이 한 겹만 벗겨 등록 증상·규칙·별칭이 **전부 0** 이었고(실제 29/72/169),
  //    그래서 트리아지 매칭 실패가 화면 어디에서도 보이지 않았다.
  describe('🔴 응답 래핑 계약 — 정확히 한 겹', () => {
    const single = (v: unknown) => {
      expect(v).toHaveProperty('data');
      const inner = (v as { data: unknown }).data;
      // data 안에 또 data 가 있으면 이중 래핑이다
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        expect(Object.prototype.hasOwnProperty.call(inner, 'data')).toBe(false);
      }
    };

    it('통계 응답은 한 겹만 감싼다', async () => {
      vi.mocked(mockService.getRuleStats).mockResolvedValue({ topRules: [], totalRules: 72, totalSymptoms: 29, totalAliases: 169 });
      const result = await controller.getRuleStats();
      single(result);
      expect(result.data.totalSymptoms).toBe(29);
      expect(result.data.totalRules).toBe(72);
      expect(result.data.totalAliases).toBe(169);
    });

    it('목록/생성/수정/삭제 응답도 모두 한 겹', async () => {
      vi.mocked(mockService.getSymptoms).mockResolvedValue([{ id: 's1' }]);
      vi.mocked(mockService.getRules).mockResolvedValue([{ id: 'r1' }]);
      vi.mocked(mockService.getAliases).mockResolvedValue([{ id: 'a1' }]);
      vi.mocked(mockService.createSymptom).mockResolvedValue({ id: 's1' });
      vi.mocked(mockService.updateRule).mockResolvedValue({ id: 'r1' });
      vi.mocked(mockService.deleteAlias).mockResolvedValue({ deleted: true });

      single(await controller.getSymptoms());
      single(await controller.getRules());
      single(await controller.getAliases());
      single(await controller.createSymptom({ name: 'x' } as never));
      single(await controller.updateRule('rule-1', {} as never));
      single(await controller.deleteAlias('alias-1'));
    });
  });

  // 🔴 T5/T8 — 구 하드코딩 맵을 현행 규칙에 주입하던 `POST /migrate-from-code` 는 제거했다.
  describe('🔴 하드코딩 맵 마이그레이션 EP 재유입 차단', () => {
    it('migrate 핸들러가 없다', () => {
      expect((controller as unknown as Record<string, unknown>).migrate).toBeUndefined();
    });
  });

  describe('자가 점검 EP', () => {
    it('예시 문장 점검 결과를 한 겹으로 반환한다', async () => {
      vi.mocked(mockService.selfCheck).mockResolvedValue({ total: 15, expected: 13, recommendable: 9, gaps: 4, results: [] });
      const result = await controller.selfCheck();
      expect(result.data.gaps).toBe(4);
      expect(result.data.recommendable).toBe(9);
    });

    it('응급 문구 점검 결과를 한 겹으로 반환한다', async () => {
      vi.mocked(mockService.emergencyMsgAudit).mockResolvedValue([
        { id: 's1', name: '흉통', emergencyMsg: '급성 관상동맥증후군/대동맥박리 감별 필요', patientActionable: false },
      ]);
      const result = await controller.emergencyMessages();
      expect(result.data[0].patientActionable).toBe(false);
    });
  });
});
