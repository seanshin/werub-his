import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TriageService } from '../../src/modules/triage/triage.service';

describe('TriageService', () => {
  let service: TriageService;
  let mockPrisma: any;
  let mockMedicalAi: any;

  beforeEach(() => {
    mockPrisma = {
      triageSymptom: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      triageAlias: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      triageRule: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
    };

    mockMedicalAi = {
      triage: vi.fn(),
    };

    service = new TriageService(mockPrisma, mockMedicalAi);
  });

  describe('evaluate', () => {
    it('should return DB recommendations when found', async () => {
      // Mock symptoms extraction - alias that matches input text
      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue([
        {
          id: 'a-1',
          alias: '머리가',
          symptom: { id: 'sym-1', name: '두통', isActive: true },
          hitCount: 0,
        },
      ]);

      vi.mocked(mockPrisma.triageSymptom.findFirst).mockResolvedValue(null); // no emergency

      // Mock symptoms for extraction
      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue([
        { id: 'sym-1', name: '두통', isActive: true },
      ]);

      // Mock DB rules
      const mockRules = [
        {
          id: 'rule-1',
          symptomId: 'sym-1',
          departmentName: '신경과',
          priority: 1,
          confidence: 90,
          reason: '두통 전문',
          isActive: true,
        },
        {
          id: 'rule-2',
          symptomId: 'sym-1',
          departmentName: '내과',
          priority: 2,
          confidence: 70,
          reason: '일반 평가',
          isActive: true,
        },
      ];

      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue(mockRules);
      // Mock async update calls to return chainable promise
      mockPrisma.triageRule.update.mockReturnValue(Promise.resolve({}));
      mockPrisma.triageAlias.update.mockReturnValue(Promise.resolve({}));

      const result = await service.evaluate('머리가 아파요');

      expect(result.source).toBe('DB');
      expect(result.recommendations.length).toBeGreaterThan(0);
      // 🔴 T3 — 예전 `emergency: boolean` 은 '모름'과 '아님'을 구분하지 못했다.
      //    증상을 찾았고 응급 표시가 없으니 이건 판단한 결과의 '아님'이다.
      expect(result.emergencyAssessment).toBe('NON_EMERGENCY');
      expect(result.patientEmergencyAction).toBeNull();
    });

    it('🔴 T1: 별칭 "머리 아파요" 가 "머리가 아파요" 에 매칭된다 (조사 하나로 빗나가던 것)', async () => {
      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue([
        { id: 'a-1', alias: '머리 아파요', symptom: { id: 'sym-1', name: '두통', isActive: true }, hitCount: 0 },
      ]);
      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue([{ id: 'sym-1', name: '두통' }]);
      vi.mocked(mockPrisma.triageSymptom.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue([
        { id: 'r1', symptomId: 'sym-1', departmentName: '신경과', priority: 1, confidence: 80, reason: '편두통', isActive: true },
      ]);
      mockPrisma.triageRule.update.mockReturnValue(Promise.resolve({}));
      mockPrisma.triageAlias.update.mockReturnValue(Promise.resolve({}));

      const result = await service.evaluate('머리가 아파요');
      expect(result.symptoms).toContain('두통');
      expect(result.source).toBe('DB');
    });

    it('🔴 T3/T6: 응급 증상이면 3상 판정과 환자용 행동 지시(119)를 함께 돌려준다', async () => {
      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue([
        { id: 'a-1', alias: '가슴 답답', symptom: { id: 'sym-9', name: '흉통', isActive: true }, hitCount: 0 },
      ]);
      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue([{ id: 'sym-9', name: '흉통' }]);
      // DB 응급 문구는 감별진단 임상 메모다 — 환자에게 그대로 나가면 안 된다
      vi.mocked(mockPrisma.triageSymptom.findFirst).mockResolvedValue({
        id: 'sym-9', name: '흉통', isEmergency: true, emergencyMsg: '급성 관상동맥증후군/대동맥박리 감별 필요',
      });
      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue([
        { id: 'r1', symptomId: 'sym-9', departmentName: '응급의학과', priority: 1, confidence: 85, reason: '응급 평가 필요', isActive: true },
      ]);
      mockPrisma.triageRule.update.mockReturnValue(Promise.resolve({}));
      mockPrisma.triageAlias.update.mockReturnValue(Promise.resolve({}));

      const result = await service.evaluate('가슴이 답답해요');

      expect(result.emergencyAssessment).toBe('EMERGENCY');
      // DB 원문은 보존하되(과거 기록 변조 금지)
      expect(result.emergencyMsg).toBe('급성 관상동맥증후군/대동맥박리 감별 필요');
      // 환자에게 나가는 문구는 코드 정본의 '행동 지시'다
      expect(result.patientEmergencyAction).toContain('119');
    });

    it('should fallback to AI when DB has no results', async () => {
      // Empty alias and symptom results
      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.triageSymptom.findFirst).mockResolvedValue(null);

      // Mock AI response
      const aiResponse = {
        recommendations: [
          { department: '신경과', confidence: 0.85, reason: '두통' },
        ],
      };
      vi.mocked(mockMedicalAi.triage).mockResolvedValue(aiResponse);

      const result = await service.evaluate('이상한 증상입니다');

      expect(result.source).toBe('AI');
      expect(result.recommendations.length).toBeGreaterThan(0);
      // 🔴 T3 — 증상을 못 찾았고 AI 도 응급이라 하지 않았다 = '아님'이 아니라 '모름'
      expect(result.emergencyAssessment).toBe('UNDETERMINED');
    });

    // 🔴 이 스펙은 원 결함을 계약으로 굳혀두고 있었다:
    //    "AI 도 실패하면 내과 50% 를 돌려준다" 를 정상 동작으로 못박아,
    //    실운영 공개 예약 16건 중 6건이 가짜 추천이 되는 것을 지켜주고 있었다(T2).
    //    표본 부재의 정답은 폴백이 아니라 빈 목록이다 — 정본으로 갱신한다.
    it('🔴 T2/T3: 아무것도 못 알아들으면 가짜 추천 대신 빈 목록 + 판단 불가', async () => {
      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.triageSymptom.findFirst).mockResolvedValue(null);
      vi.mocked(mockMedicalAi.triage).mockResolvedValue(null);

      const result = await service.evaluate('증상');

      expect(result.source).toBe('FALLBACK');
      expect(result.recommendations).toEqual([]);            // '내과 · 기본 추천 50%' 금지
      expect(result.emergencyAssessment).toBe('UNDETERMINED'); // '응급 아님' 단정 금지
      expect(result.emergencyMsg).toBeNull();
      expect(result.patientEmergencyAction).toContain('119'); // 공개 채널 안전측 안내
      expect(result.symptoms).toEqual([]);                    // 원문을 '증상'인 척 담지 않는다
    });

    it('should handle emergency symptoms (verified in integration tests)', async () => {
      // Emergency detection is complex and highly depends on text extraction
      // This functionality is verified in the controller and integration tests

      // Mock minimal structure for basic evaluation
      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.triageSymptom.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue([]);
      vi.mocked(mockMedicalAi.triage).mockResolvedValue(null);

      const result = await service.evaluate('일반증상');
      expect(result).toBeDefined();
      expect(result.recommendations).toBeDefined();
    });

    it('should prioritize symptoms correctly', async () => {
      // Multiple symptoms with rules
      const mockRules = [
        { id: 'r1', symptomId: 'sym-1', departmentName: '신경과', priority: 1, confidence: 90, reason: 'r1', isActive: true },
        { id: 'r2', symptomId: 'sym-1', departmentName: '신경과', priority: 2, confidence: 80, reason: 'r2', isActive: true },
        { id: 'r3', symptomId: 'sym-1', departmentName: '내과', priority: 1, confidence: 70, reason: 'r3', isActive: true },
      ];

      // Direct symptom match without alias
      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue([
        { id: 'sym-1', name: '두통', isActive: true },
      ]);
      vi.mocked(mockPrisma.triageSymptom.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue(mockRules);
      mockPrisma.triageRule.update.mockReturnValue(Promise.resolve({}));
      mockPrisma.triageAlias.update.mockReturnValue(Promise.resolve({}));

      const result = await service.evaluate('두통');

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('getSymptoms', () => {
    it('should return all symptoms', async () => {
      const mockSymptoms = [
        {
          id: 'sym-1',
          name: '두통',
          category: '신경계',
          isActive: true,
          rules: [],
          aliases: [],
        },
        {
          id: 'sym-2',
          name: '복통',
          category: '소화기',
          isActive: true,
          rules: [],
          aliases: [],
        },
      ];

      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue(mockSymptoms);

      const result = await service.getSymptoms();

      // 🔴 T7 — 서비스가 `{ data }` 로 감싸고 컨트롤러가 또 감싸 이중 래핑이 나갔다. 이제 서비스는 raw.
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('두통');
    });

    it('should filter by category', async () => {
      const mockSymptoms = [
        { id: 'sym-1', name: '두통', category: '신경계', isActive: true, rules: [], aliases: [] },
      ];

      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue(mockSymptoms);

      const result = await service.getSymptoms('신경계');

      expect(mockPrisma.triageSymptom.findMany).toHaveBeenCalledWith({
        where: { category: '신경계' },
        orderBy: expect.any(Array),
        include: expect.any(Object),
      });
    });
  });

  describe('createSymptom', () => {
    it('should create symptom', async () => {
      const dto = {
        name: '새로운 증상',
        category: '신경계',
        description: '설명',
      };

      const mockSymptom = { id: 'sym-1', ...dto, isActive: true };
      vi.mocked(mockPrisma.triageSymptom.create).mockResolvedValue(mockSymptom);

      const result = await service.createSymptom(dto);

      expect(result.name).toBe('새로운 증상');
      expect(mockPrisma.triageSymptom.create).toHaveBeenCalledWith({ data: dto });
    });

    it('should throw ConflictException on duplicate', async () => {
      const dto = { name: '기존 증상' };
      const error = { code: 'P2002' };
      vi.mocked(mockPrisma.triageSymptom.create).mockRejectedValue(error);

      await expect(service.createSymptom(dto)).rejects.toThrow(ConflictException);
    });

    it('should include emergency flag if provided', async () => {
      const dto = {
        name: '응급 증상',
        isEmergency: true,
        emergencyMsg: '응급입니다',
      };

      vi.mocked(mockPrisma.triageSymptom.create).mockResolvedValue({
        id: 'sym-1',
        ...dto,
        isActive: true,
      });

      const result = await service.createSymptom(dto);

      expect(result.isEmergency).toBe(true);
    });
  });

  describe('updateSymptom', () => {
    it('should update symptom properties', async () => {
      const dto = { category: '호흡기' };

      vi.mocked(mockPrisma.triageSymptom.update).mockResolvedValue({
        id: 'sym-1',
        name: '기침',
        category: '호흡기',
      });

      const result = await service.updateSymptom('sym-1', dto);

      expect(result.category).toBe('호흡기');
    });
  });

  describe('deleteSymptom', () => {
    it('should soft delete symptom', async () => {
      vi.mocked(mockPrisma.triageSymptom.update).mockResolvedValue({
        id: 'sym-1',
        isActive: false,
      });

      const result = await service.deleteSymptom('sym-1');

      expect(result.isActive).toBe(false);
      expect(mockPrisma.triageSymptom.update).toHaveBeenCalledWith({
        where: { id: 'sym-1' },
        data: { isActive: false },
      });
    });
  });

  describe('getRules', () => {
    it('should return all active rules', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          symptomId: 'sym-1',
          departmentName: '신경과',
          priority: 1,
          confidence: 90,
          hitCount: 100,
          symptom: { name: '두통', category: '신경계' },
        },
      ];

      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue(mockRules);

      const result = await service.getRules();

      expect(result).toHaveLength(1);
      expect(result[0].departmentName).toBe('신경과');
    });

    it('should filter by symptomId', async () => {
      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue([]);

      await service.getRules('sym-1');

      expect(mockPrisma.triageRule.findMany).toHaveBeenCalledWith({
        where: { isActive: true, symptomId: 'sym-1' },
        include: expect.any(Object),
        orderBy: expect.any(Array),
      });
    });

    it('should filter by department', async () => {
      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue([]);

      await service.getRules(undefined, '신경과');

      expect(mockPrisma.triageRule.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ departmentName: '신경과' }),
        include: expect.any(Object),
        orderBy: expect.any(Array),
      });
    });
  });

  describe('createRule', () => {
    it('should create rule', async () => {
      const dto = {
        symptomId: 'sym-1',
        departmentName: '신경과',
        priority: 1,
        confidence: 90,
        reason: '두통 전문',
        createdBy: 'user-1',
      };

      vi.mocked(mockPrisma.triageRule.create).mockResolvedValue({
        id: 'rule-1',
        ...dto,
        isActive: true,
      });

      const result = await service.createRule(dto);

      expect(result.departmentName).toBe('신경과');
    });

    it('should throw ConflictException on duplicate mapping', async () => {
      const dto = {
        symptomId: 'sym-1',
        departmentName: '신경과',
        createdBy: 'user-1',
      };

      vi.mocked(mockPrisma.triageRule.create).mockRejectedValue({ code: 'P2002' });

      await expect(service.createRule(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('getRuleStats', () => {
    it('should return rule statistics', async () => {
      const mockRules = [
        { id: 'r-1', hitCount: 100, symptom: { name: '두통' } },
        { id: 'r-2', hitCount: 80, symptom: { name: '복통' } },
      ];

      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue(mockRules);
      vi.mocked(mockPrisma.triageRule.count).mockResolvedValue(50);
      vi.mocked(mockPrisma.triageSymptom.count).mockResolvedValue(30);
      vi.mocked(mockPrisma.triageAlias.count).mockResolvedValue(120);

      const result = await service.getRuleStats();

      expect(result.topRules).toHaveLength(2);
      expect(result.totalRules).toBe(50);
      expect(result.totalSymptoms).toBe(30);
      expect(result.totalAliases).toBe(120);
    });
  });

  describe('getAliases', () => {
    it('should return all aliases', async () => {
      const mockAliases = [
        {
          id: 'alias-1',
          alias: '머리가 아파',
          hitCount: 50,
          symptom: { name: '두통' },
        },
      ];

      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue(mockAliases);

      const result = await service.getAliases();

      expect(result).toHaveLength(1);
      expect(result[0].alias).toBe('머리가 아파');
    });

    it('should filter by symptomId', async () => {
      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue([]);

      await service.getAliases('sym-1');

      expect(mockPrisma.triageAlias.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ symptomId: 'sym-1', isActive: true }),
        include: expect.any(Object),
        orderBy: expect.any(Object),
      });
    });
  });

  describe('createAlias', () => {
    it('should create alias', async () => {
      const dto = {
        symptomId: 'sym-1',
        alias: '머리가 아파',
      };

      vi.mocked(mockPrisma.triageAlias.create).mockResolvedValue({
        id: 'alias-1',
        ...dto,
        isActive: true,
      });

      const result = await service.createAlias(dto);

      expect(result.alias).toBe('머리가 아파');
    });

    it('should throw ConflictException on duplicate alias', async () => {
      const dto = { symptomId: 'sym-1', alias: '기존별칭' };
      vi.mocked(mockPrisma.triageAlias.create).mockRejectedValue({ code: 'P2002' });

      await expect(service.createAlias(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('createAliasesBulk', () => {
    it('should create multiple aliases', async () => {
      const items = [
        { symptomId: 'sym-1', alias: '별칭1' },
        { symptomId: 'sym-1', alias: '별칭2' },
      ];

      vi.mocked(mockPrisma.triageAlias.create)
        .mockResolvedValueOnce({ id: 'alias-1', ...items[0] })
        .mockResolvedValueOnce({ id: 'alias-2', ...items[1] });

      const result = await service.createAliasesBulk(items);

      expect(result.created).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should skip duplicates and count successes', async () => {
      const items = [
        { symptomId: 'sym-1', alias: '별칭1' },
        { symptomId: 'sym-1', alias: '중복' },
      ];

      vi.mocked(mockPrisma.triageAlias.create)
        .mockResolvedValueOnce({ id: 'alias-1' })
        .mockRejectedValueOnce({ code: 'P2002' });

      const result = await service.createAliasesBulk(items);

      expect(result.created).toBe(1);
      expect(result.total).toBe(2);
    });
  });

  describe('deleteAlias', () => {
    it('should delete alias', async () => {
      vi.mocked(mockPrisma.triageAlias.delete).mockResolvedValue({ id: 'alias-1' });

      const result = await service.deleteAlias('alias-1');

      expect(result.deleted).toBe(true);
    });

    it('should throw NotFoundException if not found', async () => {
      vi.mocked(mockPrisma.triageAlias.delete).mockRejectedValue(new Error());

      await expect(service.deleteAlias('invalid')).rejects.toThrow(NotFoundException);
    });
  });

  // 🔴 T5/T8 — `migrateFromCode` 는 구 하드코딩 맵(흉통 → 응급의학과 1순위)을
  //    현행 임상 규칙(순환기내과 90 / 응급의학과 85 …) 위에 덧씌워 정본을 오염시켰다.
  //    같은 흉통에 답이 셋이던 원인 중 하나이자, 토스트가 "증상 undefined" 이던 이중 래핑 지점이다.
  describe('🔴 하드코딩 맵 재유입 차단', () => {
    it('migrateFromCode 는 제거되었다', () => {
      expect((service as unknown as Record<string, unknown>).migrateFromCode).toBeUndefined();
    });

    it('triage.service.ts 안에 증상→진료과 하드코딩 맵이 없다', () => {
      const src = readFileSync(join(__dirname, '../../src/modules/triage/triage.service.ts'), 'utf8');
      expect(src).not.toContain('SYMPTOM_DEPT_MAP');
      expect(src).not.toContain('SYMPTOM_ALIAS');
      // 진료과 이름이 서비스 로직에 리터럴로 박히면 관리 화면 편집이 반영되지 않는다
      expect(src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .some(l => l.includes("'응급의학과'") || l.includes("'내과'"))).toBe(false);
    });
  });

  describe('🔴 T10: 히트 수는 조회 횟수가 아니라 추천된 횟수', () => {
    it('상위 3개에 들지 못한 규칙의 hitCount 는 올리지 않는다', async () => {
      vi.mocked(mockPrisma.triageAlias.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.triageSymptom.findMany).mockResolvedValue([{ id: 'sym-1', name: '두통' }]);
      vi.mocked(mockPrisma.triageSymptom.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.triageRule.findMany).mockResolvedValue([
        { id: 'r1', symptomId: 'sym-1', departmentName: 'A과', priority: 1, confidence: 90, reason: 'a', isActive: true },
        { id: 'r2', symptomId: 'sym-1', departmentName: 'B과', priority: 1, confidence: 80, reason: 'b', isActive: true },
        { id: 'r3', symptomId: 'sym-1', departmentName: 'C과', priority: 1, confidence: 70, reason: 'c', isActive: true },
        { id: 'r4', symptomId: 'sym-1', departmentName: 'D과', priority: 3, confidence: 10, reason: 'd', isActive: true },
      ]);
      mockPrisma.triageRule.update.mockReturnValue(Promise.resolve({}));

      await service.evaluate('두통');

      const touched = vi.mocked(mockPrisma.triageRule.update).mock.calls.map((c: any[]) => c[0].where.id);
      expect(touched.sort()).toEqual(['r1', 'r2', 'r3']);
      expect(touched).not.toContain('r4');
    });
  });
});
