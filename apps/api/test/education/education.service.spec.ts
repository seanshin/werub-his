import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { EducationService, isIndefiniteExpiry } from '../../src/modules/education/education.service';

describe('EducationService', () => {
  let service: EducationService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      educationProgram: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
      educationCompletion: { findMany: vi.fn(), create: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
      staff: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new EducationService(mockPrisma);
  });

  describe('getPrograms', () => {
    it('should return all programs ordered by name', async () => {
      mockPrisma.educationProgram.findMany.mockResolvedValue([{ id: 'p1', name: '감염관리' }, { id: 'p2', name: '심폐소생술' }]);
      const result = await service.getPrograms();
      expect(result).toHaveLength(2);
      expect(mockPrisma.educationProgram.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
    });
  });

  describe('createProgram', () => {
    it('should create a new program', async () => {
      const dto = { name: '감염관리', category: 'SAFETY', isMandatory: true, validMonths: 12 };
      mockPrisma.educationProgram.create.mockResolvedValue({ id: 'p1', ...dto });
      const result = await service.createProgram(dto);
      expect(result.name).toBe('감염관리');
    });
  });

  describe('recordCompletion', () => {
    it('should record completion with expiry based on validMonths', async () => {
      mockPrisma.educationProgram.findUnique.mockResolvedValue({ id: 'p1', validMonths: 6 });
      mockPrisma.educationCompletion.create.mockResolvedValue({ id: 'c1', programId: 'p1', staffId: 's1' });
      const result = await service.recordCompletion({ programId: 'p1', staffId: 's1', score: 95 });
      expect(result.programId).toBe('p1');
      const createCall = mockPrisma.educationCompletion.create.mock.calls[0][0];
      expect(createCall.data.completedAt).toBeInstanceOf(Date);
      expect(createCall.data.expiresAt).toBeInstanceOf(Date);
      expect((createCall.data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 5 * 28 * 86400000);
    });

    it('should default to 12 months if validMonths is null', async () => {
      mockPrisma.educationProgram.findUnique.mockResolvedValue({ id: 'p1', validMonths: null });
      mockPrisma.educationCompletion.create.mockResolvedValue({ id: 'c1' });
      await service.recordCompletion({ programId: 'p1', staffId: 's1' });
      const createCall = mockPrisma.educationCompletion.create.mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt as Date;
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 11 * 30 * 86400000);
    });

    // 🔴 가드 — 원 결함 ①: `program?.validMonths ?? 12` 는 `0`(무기한·갱신 불요)을 잡지 못해
    //    `expiresAt = 등록 시각` 이 됐다. 무기한 교육이 이수 즉시 만료로 기록되던 것.
    // 🔴 원 결함 ②: 컬럼이 NOT NULL 이라 `9999-12-31` 을 표식으로 박았다 — 원장에
    //    "9999년 만료"라는 **틀린 사실**을 적은 것. 이제 무기한의 정본은 **null** 이다.
    it('validMonths=0 (무기한) → 즉시 만료도 9999 표식도 아니고 null 이어야 한다', async () => {
      mockPrisma.educationProgram.findUnique.mockResolvedValue({ id: 'p1', validMonths: 0 });
      mockPrisma.educationCompletion.create.mockResolvedValue({ id: 'c1' });
      await service.recordCompletion({ programId: 'p1', staffId: 's1' });
      const expiresAt = mockPrisma.educationCompletion.create.mock.calls[0][0].data.expiresAt;
      expect(expiresAt).toBeNull();
      expect(expiresAt).not.toBeInstanceOf(Date); // 9999 표식 재주입 차단
      expect(isIndefiniteExpiry(expiresAt)).toBe(true);
    });

    // 🔴 가드 — null 을 '만료됨'으로 접지 않는다(만료 판정의 정본은 isIndefiniteExpiry 하나)
    it('무기한 판정: null=무기한 · 구 9999 표식도 무기한 · 일반 만료일은 아니다', () => {
      expect(isIndefiniteExpiry(null)).toBe(true);
      expect(isIndefiniteExpiry(undefined)).toBe(true);
      expect(isIndefiniteExpiry(new Date('9999-12-31T23:59:59.999Z'))).toBe(true); // 레거시 하위호환
      expect(isIndefiniteExpiry(new Date('2026-12-31T00:00:00Z'))).toBe(false);
    });

    // 🔴 가드 — 원 결함: 프로그램이 없어도 조용히 12개월을 부여해 유령 과정의 이수기록이 만들어졌다.
    it('존재하지 않는 프로그램이면 기록하지 않고 404', async () => {
      mockPrisma.educationProgram.findUnique.mockResolvedValue(null);
      await expect(service.recordCompletion({ programId: 'nope', staffId: 's1' })).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.educationCompletion.create).not.toHaveBeenCalled();
    });
  });

  describe('getStaffCompletions', () => {
    it('should return completions for a staff member with indefinite flag', async () => {
      mockPrisma.educationCompletion.findMany.mockResolvedValue([
        { id: 'c1', expiresAt: new Date('2026-12-31T00:00:00Z') },
        { id: 'c2', expiresAt: new Date('9999-12-31T23:59:59.999Z') }, // 구 표식(레거시 데이터)
        { id: 'c3', expiresAt: null }, // 정본 = 무기한
      ]);
      const result = await service.getStaffCompletions('s1');
      expect(result).toHaveLength(3);
      expect(result[0].indefinite).toBe(false);
      expect(result[1].indefinite).toBe(true);
      expect(result[2].indefinite).toBe(true);
    });
  });

  describe('getExpiringSoon (만료/임박 분리)', () => {
    const now = () => new Date();

    function wireRows(expired: any[], dueSoon: any[], totals = { expired: expired.length, dueSoon: dueSoon.length }) {
      mockPrisma.educationCompletion.count
        .mockResolvedValueOnce(totals.expired)
        .mockResolvedValueOnce(totals.dueSoon);
      mockPrisma.educationCompletion.findMany
        .mockResolvedValueOnce(expired)
        .mockResolvedValueOnce(dueSoon);
    }

    const row = (id: string, daysFromNow: number) => ({
      id, staffId: 'st1', programId: 'p1', score: 90,
      completedAt: new Date(now().getTime() - 400 * 86400000),
      expiresAt: new Date(now().getTime() + daysFromNow * 86400000),
      program: { name: '개인정보보호 교육', category: '법정', isMandatory: true },
    });

    // 🔴 가드(핵심) — 원 결함: `where: { expiresAt: { lte: now+30d } }` 에 **하한이 없어**
    //    7.5개월 전 실효분까지 "만료 임박"으로 묶였다(261건 중 194건=74%가 이미 실효).
    it('임박(dueSoon) 쿼리에는 반드시 하한(gte: now)이 있어야 한다', async () => {
      wireRows([], []);
      await service.getExpiringSoon();
      const dueSoonWhere = mockPrisma.educationCompletion.findMany.mock.calls[1][0].where;
      expect(dueSoonWhere.expiresAt.gte).toBeInstanceOf(Date);
      expect(dueSoonWhere.expiresAt.lte).toBeInstanceOf(Date);
      expect(dueSoonWhere.expiresAt.gte.getTime()).toBeLessThan(dueSoonWhere.expiresAt.lte.getTime());
      // 하한 없는 조회(= 실효분 혼입)를 다시 만들지 못하게 한다
      expect(Object.keys(dueSoonWhere.expiresAt)).toContain('gte');
    });

    // 🔴 가드 — 무기한(expiresAt=null)은 만료도 임박도 아니다. 두 집계 모두에서 빠져야 한다.
    it('무기한(null)은 만료·임박 조회에서 제외된다', async () => {
      wireRows([], []);
      await service.getExpiringSoon();
      const expiredWhere = mockPrisma.educationCompletion.findMany.mock.calls[0][0].where;
      const dueSoonWhere = mockPrisma.educationCompletion.findMany.mock.calls[1][0].where;
      expect(expiredWhere.expiresAt.not).toBeNull();
      expect(dueSoonWhere.expiresAt.not).toBeNull();
      // count 도 같은 where 를 써야 한다(목록과 총계가 갈라지면 화면이 모순된다)
      expect(mockPrisma.educationCompletion.count.mock.calls[0][0].where.expiresAt.not).toBeNull();
      expect(mockPrisma.educationCompletion.count.mock.calls[1][0].where.expiresAt.not).toBeNull();
    });

    // 🔴 가드 — 혹시 null 행이 목록에 섞여 들어와도 '0일 남음'/'만료'로 접지 않는다.
    it('null 만료가 항목으로 들어와도 무기한으로 표시하고 daysLeft 를 지어내지 않는다', async () => {
      const indefinite = { ...row('i1', 0), expiresAt: null };
      wireRows([], [indefinite]);
      const res = await service.getExpiringSoon();
      expect(res.dueSoon.items[0].indefinite).toBe(true);
      expect(res.dueSoon.items[0].expiresAt).toBeNull();
      expect(res.dueSoon.items[0].daysLeft).toBeNull();
    });

    it('실효(expired)는 상한 now 로만 조회한다', async () => {
      wireRows([], []);
      await service.getExpiringSoon();
      const expiredWhere = mockPrisma.educationCompletion.findMany.mock.calls[0][0].where;
      expect(expiredWhere.expiresAt.lt).toBeInstanceOf(Date);
      expect(expiredWhere.expiresAt.gte).toBeUndefined();
    });

    it('실효와 임박을 분리해 각각 total 과 함께 돌려준다', async () => {
      wireRows([row('e1', -220)], [row('d1', 10)], { expired: 194, dueSoon: 67 });
      const res = await service.getExpiringSoon();
      expect(res.expired.total).toBe(194);
      expect(res.dueSoon.total).toBe(67);
      expect(res.expired.items[0].daysLeft).toBeLessThan(0);
      expect(res.dueSoon.items[0].daysLeft).toBeGreaterThanOrEqual(0);
    });

    // 🔴 가드 — 원 결함: 261건 중 5건만 그리고 나머지 256건을 화면이 말하지 않았다.
    it('상한에 걸리면 truncated 로 잘렸음을 알린다', async () => {
      wireRows([row('e1', -10)], [], { expired: 194, dueSoon: 0 });
      const res = await service.getExpiringSoon(1);
      expect(res.limit).toBe(1);
      expect(res.expired.truncated).toBe(true);
      expect(res.dueSoon.truncated).toBe(false);
    });

    // 🔴 가드 — 원 결함: FE 가 읽던 staffName/programName 이 서버 응답에 아예 없어
    //    모든 행이 "  -  2025.12.28 만료" 로 보였다.
    it('직원명·교육명을 응답에 담는다', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([
        { id: 'st1', familyName: '김', givenName: '간호', department: '간호부', position: '수간호사', status: 'ACTIVE' },
      ]);
      wireRows([row('e1', -30)], []);
      const res = await service.getExpiringSoon();
      expect(res.expired.items[0].staffName).toBe('김간호');
      expect(res.expired.items[0].department).toBe('간호부');
      expect(res.expired.items[0].programName).toBe('개인정보보호 교육');
      expect(res.expired.items[0].isMandatory).toBe(true);
    });

    it('직원을 찾지 못하면 이름을 지어내지 않고 null 을 준다', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([]);
      wireRows([row('e1', -30)], []);
      const res = await service.getExpiringSoon();
      expect(res.expired.items[0].staffName).toBeNull();
    });
  });

  describe('getCompletionCoverage (이수율 아님)', () => {
    beforeEach(() => {
      mockPrisma.staff.findMany.mockResolvedValue([
        { id: 's1', familyName: '김', givenName: '가', department: '내과', position: '전문의' },
        { id: 's2', familyName: '이', givenName: '나', department: '간호부', position: '간호사' },
        { id: 's3', familyName: '박', givenName: '다', department: '약제부', position: '약사' },
      ]);
      mockPrisma.educationCompletion.groupBy.mockResolvedValue([{ staffId: 's1', _count: { id: 4 } }]);
    });

    // 🔴 가드 — 대상자 지정 모델이 없으므로 이수율의 분모를 지어내면 안 된다.
    it('이수율은 0 이 아니라 null(산출 불가) 이고 사유를 함께 준다', async () => {
      const res = await service.getCompletionCoverage();
      expect(res.completionRate).toBeNull();
      expect(res.completionRateUnavailableReason).toContain('대상자');
    });

    // 🔴 가드 — 기록이 1건도 없는 재직자가 화면 어디에도 없던 것.
    it('무기록 재직자를 세고 명단으로 내보낸다', async () => {
      const res = await service.getCompletionCoverage();
      expect(res.activeStaffTotal).toBe(3);
      expect(res.withAnyRecord).toBe(1);
      expect(res.withoutAnyRecord).toBe(2);
      expect(res.staffWithoutAnyRecord.items.map((i) => i.staffName)).toEqual(['이나', '박다']);
    });

    it('재직자(ACTIVE)만 분모로 삼는다', async () => {
      await service.getCompletionCoverage();
      expect(mockPrisma.staff.findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE' });
    });

    it('명단 상한을 넘기면 truncated 로 알린다', async () => {
      const res = await service.getCompletionCoverage(1);
      expect(res.staffWithoutAnyRecord.truncated).toBe(true);
      expect(res.staffWithoutAnyRecord.items).toHaveLength(1);
    });
  });
});
