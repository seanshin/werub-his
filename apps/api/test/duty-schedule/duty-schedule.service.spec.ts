import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DutyScheduleService } from '../../src/modules/duty-schedule/duty-schedule.service';

/**
 * 🔴 W7: 종전 스펙은 `'swap-001'` 같은 **코드성 id** 로 통과했다. 실제 컬럼은 `@db.Uuid` 라
 *    운영에서 같은 호출이 Prisma P2023 → 500 이 났다(화면은 "처리에 실패했습니다"만).
 *    스펙이 운영과 다른 세계를 검증하고 있었다 — id 는 uuid 로 고정한다.
 */
const SWAP_A = '11111111-1111-4111-8111-111111111111';
const SWAP_B = '22222222-2222-4222-8222-222222222222';
const SWAP_MISSING = '99999999-9999-4999-8999-999999999999';
const LEAVE_A = '33333333-3333-4333-8333-333333333333';
const LEAVE_NEW = '44444444-4444-4444-8444-444444444444';
const LEAVE_MISSING = '88888888-8888-4888-8888-888888888888';

describe('DutyScheduleService', () => {
  let service: DutyScheduleService;
  let mockPrisma: any;

  // 서비스가 인메모리 → prisma 기반으로 이관됨. 아래 목은 기존 인메모리 픽스처
  // (doc-001 김태현·내과·의사, doc-002 이준호·내과·의사, nur-001 윤서연·내과·간호사 +
  //  현재월 근무표)를 상태기반으로 재현한다.
  const toTime = (v: any) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

  beforeEach(() => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;

    const userRows = [
      { id: 'doc-001', familyName: '김', givenName: '태현', role: 'DOCTOR', department: '내과', isActive: true },
      { id: 'doc-002', familyName: '이', givenName: '준호', role: 'DOCTOR', department: '내과', isActive: true },
      { id: 'nur-001', familyName: '윤', givenName: '서연', role: 'NURSE', department: '내과', isActive: true },
    ];
    const staffMeta = [
      { id: 'doc-001', name: '김태현', role: 'doctor', department: '내과' },
      { id: 'doc-002', name: '이준호', role: 'doctor', department: '내과' },
      { id: 'nur-001', name: '윤서연', role: 'nurse', department: '내과' },
    ];
    const shiftCycle = ['DAY', 'EVENING', 'NIGHT'];

    // 현재월 1~5일, 3명 × 각 1근무 → getSchedule/getStats/getOnCall 등에 데이터 제공
    const entries: any[] = [];
    let idc = 0;
    for (let d = 1; d <= 5; d++) {
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      staffMeta.forEach((s, i) => {
        entries.push({
          id: `de-${++idc}`,
          date: dateObj,
          shift: shiftCycle[(d + i) % 3],
          staffId: s.id,
          staffName: s.name,
          role: s.role,
          department: s.department,
        });
      });
    }

    const entryWhereMatch = (e: any, where: any = {}) => {
      if (where.staffId && e.staffId !== where.staffId) return false;
      if (where.department && e.department !== where.department) return false;
      if (where.shift && e.shift !== where.shift) return false;
      if (where.date) {
        if (where.date.gte || where.date.lt) {
          if (where.date.gte && e.date.getTime() < toTime(where.date.gte)) return false;
          if (where.date.lt && e.date.getTime() >= toTime(where.date.lt)) return false;
        } else if (e.date.getTime() !== toTime(where.date)) {
          return false;
        }
      }
      return true;
    };

    mockPrisma = {
      overtimeRequest: { findMany: vi.fn().mockResolvedValue([]) },
      leaveRequest: { findMany: vi.fn().mockResolvedValue([]) }, // 통합 뷰 휴가 병합(기본 없음)
      dutyStaffingRule: { findMany: vi.fn().mockResolvedValue([]) }, // 인력기준(P1b·기본 없음)
      user: {
        findMany: vi.fn(async ({ where }: any = {}) => {
          let r = userRows;
          if (where?.department) r = r.filter((u) => u.department === where.department);
          return r;
        }),
      },
      dutyEntry: {
        findMany: vi.fn(async ({ where }: any = {}) => entries.filter((e) => entryWhereMatch(e, where))),
        findFirst: vi.fn(async ({ where }: any = {}) => entries.find((e) => entryWhereMatch(e, where)) ?? null),
        create: vi.fn(async ({ data }: any) => {
          const e = { id: `de-new-${++idc}`, ...data };
          entries.push(e);
          return e;
        }),
        createMany: vi.fn(async ({ data }: any) => ({ count: data.length })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
      dutySwapRequest: {
        create: vi.fn(async ({ data }: any) => ({ id: 'swap-new', createdAt: new Date(), ...data })),
        findUnique: vi.fn(async ({ where }: any) =>
          where.id === SWAP_MISSING
            ? null
            : { id: where.id, requesterId: 'doc-001', targetId: 'doc-002', originalDate: '2026-06-01', originalShift: 'DAY', swapDate: '2026-06-02', swapShift: 'NIGHT', status: 'PENDING' },
        ),
        update: vi.fn(async ({ where, data }: any) => ({ id: where.id, status: data.status })),
        updateMany: vi.fn(async ({ where }: any) => ({ count: where.id === SWAP_MISSING ? 0 : 1 })),
        findMany: vi.fn(async () => []),
      },
      dutyLeaveRequest: {
        // 🔴 (2026-09-16 J4) requestLeave 는 만들기 전에 **같은 기간·같은 종류의 대기 신청**을 findFirst 로 본다
        //    — 목이 그 모양을 갖지 않으면 정본과 다른 것을 시험한다.
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: any) => ({ id: LEAVE_NEW, createdAt: new Date(), ...data })),
        findUnique: vi.fn(async ({ where }: any) => (where.id === LEAVE_MISSING ? null : { id: where.id, status: 'PENDING' })),
        update: vi.fn(async ({ where, data }: any) => ({ id: where.id, status: data.status })),
        updateMany: vi.fn(async ({ where }: any) => ({ count: where.id === LEAVE_MISSING ? 0 : 1 })),
        findMany: vi.fn(async () => []),
      },
      $transaction: vi.fn(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
    };

    service = new DutyScheduleService(mockPrisma);
  });

  /* ── 1. getSchedule ──────────────────────── */

  describe('getSchedule', () => {
    it('should return monthly schedule with grouped dates', async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const result = await service.getSchedule(month);

      expect(result.month).toBe(month);
      expect(result.department).toBe('전체');
      expect(result.schedules.length).toBeGreaterThan(0);
      expect(result.totalEntries).toBeGreaterThan(0);
    });

    it('통합 뷰 — 승인 휴가가 해당 날짜 leaves에 병합(OFF 통합 표시)', async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      mockPrisma.leaveRequest.findMany = vi.fn().mockResolvedValue([
        { userId: 'u-1', type: 'ANNUAL', fromDate: new Date(`${month}-03`), toDate: new Date(`${month}-04`) },
      ]);
      mockPrisma.user.findMany = vi.fn().mockResolvedValue([{ id: 'u-1', familyName: '김', givenName: '간호', department: '내과' }]);
      const result = await service.getSchedule(month);
      const d3 = result.schedules.find((s: any) => s.date === `${month}-03`);
      expect(d3?.leaves).toEqual([{ userId: 'u-1', name: '김간호', type: 'ANNUAL' }]);
      // 휴가 종료 다음날(05)엔 없음
      const d5 = result.schedules.find((s: any) => s.date === `${month}-05`);
      expect(d5?.leaves ?? []).toEqual([]);
    });

    it('should filter by department when provided', async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const result = await service.getSchedule(month, '내과');

      expect(result.department).toBe('내과');
      for (const day of result.schedules) {
        for (const shift of day.shifts) {
          expect(shift.department).toBe('내과');
        }
      }
    });

    it('should return empty schedules for non-existent month', async () => {
      const result = await service.getSchedule('1990-01');

      expect(result.schedules).toHaveLength(0);
      expect(result.totalEntries).toBe(0);
    });

    it('should include dayOfWeek for each date', async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const result = await service.getSchedule(month);

      const validDays = ['일', '월', '화', '수', '목', '금', '토'];
      for (const day of result.schedules) {
        expect(validDays).toContain(day.dayOfWeek);
      }
    });
  });

  /* ── 2. autoGenerate ─────────────────────── */

  describe('autoGenerate', () => {
    it('should generate schedule for a department respecting constraints', async () => {
      const result = await service.autoGenerate('2026-06', '내과', {
        maxConsecutiveNights: 2,
        maxWeeklyHours: 80,
      });

      expect(result.generated).toBeGreaterThan(0);
      expect(result.month).toBe('2026-06');
      expect(result.department).toBe('내과');
      expect(result.totalDays).toBe(30);
      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.summary)).toBe(true);
    });

    it('should return error when no staff available for department', async () => {
      const result = await service.autoGenerate('2026-06', '존재하지않는과', {});

      expect(result.error).toBe('해당 부서에 배정 가능한 직원이 없습니다');
      expect(result.generated).toBe(0);
    });

    it('should generate for all departments when "전체" is specified', async () => {
      const result = await service.autoGenerate('2026-07', '전체', {});

      expect(result.generated).toBeGreaterThan(0);
      expect(result.staffCount).toBeGreaterThan(1);
    });

    it('should include shift breakdown in summary', async () => {
      const result = await service.autoGenerate('2026-06', '내과', {});

      if (result.summary && Array.isArray(result.summary)) {
        for (const s of result.summary) {
          expect(s).toHaveProperty('dayShifts');
          expect(s).toHaveProperty('eveningShifts');
          expect(s).toHaveProperty('nightShifts');
          expect(s.totalShifts).toBe(s.dayShifts + s.eveningShifts + s.nightShifts);
        }
      }
    });
  });

  /* ── 3. assign ───────────────────────────── */

  describe('assign', () => {
    it('should create a manual assignment for valid staff', async () => {
      const result = await service.assign({
        date: '2026-12-25',
        shift: 'DAY',
        staffId: 'doc-001',
      });

      expect(result.data).toBeDefined();
      expect(result.data!.staffId).toBe('doc-001');
      expect(result.data!.shift).toBe('DAY');
      expect(result.data!.date).toBe('2026-12-25');
      expect(result.message).toBe('배정 완료');
    });

    it('should return error for unknown staff', async () => {
      const result = await service.assign({
        date: '2026-12-25',
        shift: 'DAY',
        staffId: 'unknown-999',
      });

      expect(result.error).toBe('직원을 찾을 수 없습니다');
    });

    it('should prevent duplicate assignment', async () => {
      await service.assign({ date: '2026-12-31', shift: 'NIGHT', staffId: 'doc-002' });
      const dup = await service.assign({ date: '2026-12-31', shift: 'NIGHT', staffId: 'doc-002' });

      expect(dup.error).toBe('이미 해당 근무에 배정되어 있습니다');
    });
  });

  /* ── 4. requestSwap ──────────────────────── */

  describe('requestSwap', () => {
    it('should create a swap request with PENDING status', async () => {
      const result = await service.requestSwap({
        requesterId: 'doc-001',
        targetId: 'doc-002',
        originalDate: '2026-06-01',
        originalShift: 'DAY',
        swapDate: '2026-06-02',
        swapShift: 'NIGHT',
        reason: '개인 사유',
      });

      expect(result.data.status).toBe('PENDING');
      expect(result.data.requesterId).toBe('doc-001');
      expect(result.data.targetId).toBe('doc-002');
      expect(result.message).toBe('교대 요청이 등록되었습니다');
    });

    it('should populate requester and target names from STAFF', async () => {
      const result = await service.requestSwap({
        requesterId: 'doc-001',
        targetId: 'nur-001',
        originalDate: '2026-06-01',
        originalShift: 'DAY',
        swapDate: '2026-06-01',
        swapShift: 'EVENING',
        reason: '일정 변경',
      });

      expect(result.data.requesterName).toBe('김태현');
      expect(result.data.targetName).toBe('윤서연');
    });
  });

  /* ── 5. handleSwap ───────────────────────── */

  describe('handleSwap', () => {
    it('should approve a swap request', async () => {
      const result = await service.handleSwap(SWAP_A, true);

      expect(result.data!.status).toBe('APPROVED');
      expect(result.message).toBe('교대 요청이 승인되었습니다');
    });

    it('should reject a swap request', async () => {
      const result = await service.handleSwap(SWAP_B, false);

      expect(result.data!.status).toBe('REJECTED');
      expect(result.message).toBe('교대 요청이 거절되었습니다');
    });

    // 🔴 W7: 종전엔 `{ error }` 를 **반환**했고 컨트롤러가 `{ ok:true, ...result }` 로 감싸 200 을 냈다
    //    → 화면은 "승인했습니다" 토스트를 띄웠다(조용한 성공·P16). 이제 404 로 던진다.
    it('없는 교대 요청은 NotFound 로 던진다(조용한 성공 금지)', async () => {
      await expect(service.handleSwap(SWAP_MISSING, true)).rejects.toThrow(NotFoundException);
    });

    // 🔴 W7: uuid 가 아닌 id → 종전엔 Prisma P2023 으로 500. 이제 조회 전에 404.
    it('uuid 가 아닌 id 는 500 이 아니라 NotFound (P2023 차단)', async () => {
      await expect(service.handleSwap('swap-001', true)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.dutySwapRequest.findUnique).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'swap-001' } }),
      );
    });
  });

  /* ── 6. getHours ─────────────────────────── */

  describe('getHours', () => {
    it('should return weekly hours for a staff member', async () => {
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = weekStart.toISOString().split('T')[0];

      const result = await service.getHours('doc-001', weekStartStr);

      expect(result.staffId).toBe('doc-001');
      expect(result.weekStart).toBe(weekStartStr);
      expect(result.maxAllowed).toBe(80);
      expect(typeof result.totalHours).toBe('number');
      expect(typeof result.isOverLimit).toBe('boolean');
    });

    it('should return zero hours for staff with no shifts in the week', async () => {
      const result = await service.getHours('doc-001', '1990-01-01');

      expect(result.totalHours).toBe(0);
      expect(result.shifts).toHaveLength(0);
      expect(result.isOverLimit).toBe(false);
    });
  });

  /* ── 7. getViolations ────────────────────── */

  describe('getViolations', () => {
    it('should return violations list with maxWeeklyHours = 80', async () => {
      const result = await service.getViolations();

      expect(result.maxWeeklyHours).toEqual({ doctor: 80, other: 52 });
      expect(Array.isArray(result.violations)).toBe(true);
      expect(typeof result.totalViolations).toBe('number');
    });

    it('should sort violations by overBy descending', async () => {
      const result = await service.getViolations();

      for (let i = 1; i < result.violations.length; i++) {
        expect(result.violations[i - 1].overBy).toBeGreaterThanOrEqual(result.violations[i].overBy);
      }
    });
  });

  /* ── 8. getOnCall ────────────────────────── */

  describe('getOnCall', () => {
    // 🔴 W7: 이 단언 자체가 UTC(`toISOString`)였다 — 서버 기본값의 결함을 스펙이 **보호**하고
    //    있었다. KST 00:00~09:00 에는 어제 당직표가 나온다. 로컬 달력 날짜로 고정한다.
    it('기본 날짜는 서버 로컬(KST) 달력 날짜다 (UTC 절단 금지)', async () => {
      const n = new Date();
      const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
      const result = await service.getOnCall();

      expect(result.date).toBe(today);
      expect(Array.isArray(result.shifts)).toBe(true);
      expect(typeof result.totalOnCall).toBe('number');
    });

    it('should return on-call staff for a specific date', async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const targetDate = `${month}-01`;
      const result = await service.getOnCall(targetDate);

      expect(result.date).toBe(targetDate);
      expect(result.totalOnCall).toBeGreaterThan(0);
    });

    it('should return empty for a date with no schedule', async () => {
      const result = await service.getOnCall('1990-01-01');

      expect(result.totalOnCall).toBe(0);
      expect(result.shifts).toHaveLength(0);
    });
  });

  /* ── 9. requestLeave ─────────────────────── */

  describe('requestLeave', () => {
    it('should create a leave request with PENDING status', async () => {
      const result = await service.requestLeave({
        staffId: 'doc-001',
        startDate: '2026-07-01',
        endDate: '2026-07-05',
        type: 'ANNUAL',
        reason: '연차 휴가',
      });

      expect(result.data.status).toBe('PENDING');
      expect(result.data.staffName).toBe('김태현');
      expect(result.data.department).toBe('내과');
      expect(result.data.type).toBe('ANNUAL');
      expect(result.message).toBe('휴가 신청이 등록되었습니다');
    });

    it('should support different leave types', async () => {
      const types = ['ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY'] as const;
      for (const type of types) {
        const result = await service.requestLeave({
          staffId: 'nur-001',
          startDate: '2026-08-01',
          endDate: '2026-08-01',
          type,
          reason: `${type} test`,
        });
        expect(result.data.type).toBe(type);
      }
    });
  });

  /* ── 10. handleLeave ─────────────────────── */

  describe('handleLeave', () => {
    it('should approve a leave request', async () => {
      const result = await service.handleLeave(LEAVE_A, true);

      expect(result.data!.status).toBe('APPROVED');
      expect(result.message).toBe('휴가가 승인되었습니다');
    });

    it('should reject a leave request', async () => {
      // Create a fresh leave to reject
      const leave = await service.requestLeave({
        staffId: 'doc-002',
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        type: 'PERSONAL',
        reason: '테스트',
      });
      const result = await service.handleLeave(leave.data.id, false);

      expect(result.data!.status).toBe('REJECTED');
      expect(result.message).toBe('휴가가 거절되었습니다');
    });

    it('없는 휴가 신청은 NotFound 로 던진다(조용한 성공 금지)', async () => {
      await expect(service.handleLeave(LEAVE_MISSING, true)).rejects.toThrow(NotFoundException);
    });

    it('uuid 가 아닌 id 는 500 이 아니라 NotFound (P2023 차단)', async () => {
      await expect(service.handleLeave('leave-001', true)).rejects.toThrow(NotFoundException);
    });
  });

  /* ── 11. getStats ────────────────────────── */

  describe('getStats', () => {
    it('should return stats for the current month by default', async () => {
      const result = await service.getStats();

      expect(result.month).toBeDefined();
      expect(result.totalEntries).toBeGreaterThan(0);
      expect(Array.isArray(result.byDepartment)).toBe(true);
      expect(Array.isArray(result.byPerson)).toBe(true);
    });

    it('should include shift breakdown by department', async () => {
      const result = await service.getStats();

      for (const dept of result.byDepartment) {
        expect(dept).toHaveProperty('department');
        expect(dept).toHaveProperty('day');
        expect(dept).toHaveProperty('evening');
        expect(dept).toHaveProperty('night');
        expect(dept).toHaveProperty('total');
      }
    });

    it('should sort byPerson by total descending', async () => {
      const result = await service.getStats();

      for (let i = 1; i < result.byPerson.length; i++) {
        expect(result.byPerson[i - 1].total).toBeGreaterThanOrEqual(result.byPerson[i].total);
      }
    });
  });

  /* ── 12. getFairnessReport ───────────────── */

  describe('getFairnessReport', () => {
    it('should return fairness index between 0 and 100', async () => {
      const result = await service.getFairnessReport();

      expect(result.fairnessIndex).toBeGreaterThanOrEqual(0);
      expect(result.fairnessIndex).toBeLessThanOrEqual(100);
    });

    it('should return valid rating string', async () => {
      const result = await service.getFairnessReport();

      expect(['매우 공정', '양호', '보통', '개선 필요']).toContain(result.rating);
    });

    it('should include standard deviation and mean', async () => {
      const result = await service.getFairnessReport();

      expect(typeof result.stdDeviation).toBe('number');
      expect(typeof result.mean).toBe('number');
      expect(result.persons.length).toBeGreaterThan(0);
    });

    it('should include deviation per person', async () => {
      const result = await service.getFairnessReport();

      for (const p of result.persons) {
        expect(p).toHaveProperty('deviation');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('total');
        expect(p).toHaveProperty('night');
      }
    });

    it('should return N/A rating for empty month', async () => {
      const result = await service.getFairnessReport('1990-01');

      expect(result.rating).toBe('N/A');
      expect(result.fairnessIndex).toBe(0);
      expect(result.persons).toHaveLength(0);
    });
  });

  /* ── W7 화면 실사용 점검 봉합 ─────────────── */

  describe('W7 — 화면이 사실을 말하게 하는 서버 계약', () => {
    it('getSchedule — 배정 직군 스냅샷과 현재 UserRole 을 함께 보낸다 (행정직원이 "간호사"로 보이던 것)', async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const result = await service.getSchedule(month);
      const anyShift = result.schedules.flatMap((s: any) => s.shifts)[0];

      expect(anyShift).toHaveProperty('roleNow');
      expect(anyShift).toHaveProperty('roleMismatch');
      // 목 사용자(doc-001=DOCTOR / nur-001=NURSE)는 스냅샷과 일치 → 불일치 아님
      expect(result.schedules.flatMap((s: any) => s.shifts).every((s: any) => s.roleMismatch === false)).toBe(true);
    });

    it('getSchedule — UserRole 이 바뀐 직원은 roleMismatch 로 표시된다', async () => {
      mockPrisma.user.findMany = vi.fn(async () => [
        { id: 'nur-001', familyName: '윤', givenName: '서연', role: 'ADMIN_STAFF', department: '내과', isActive: true },
      ]);
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const result = await service.getSchedule(month);
      const nur = result.schedules.flatMap((s: any) => s.shifts).filter((s: any) => s.staffId === 'nur-001');

      expect(nur.length).toBeGreaterThan(0);
      expect(nur.every((s: any) => s.roleMismatch === true)).toBe(true);
      expect(nur[0].roleNow).toBe('ADMIN_STAFF');
      // 🔴 스냅샷(법정 기록)은 덮어쓰지 않는다
      expect(nur[0].role).toBe('nurse');
    });

    // 🔴 종전엔 maxAllowed 가 누구든 80 고정 — 간호사(52h) 기준을 화면이 감췄다
    it('getHours — 상한이 직군별이다 (의사 80 / 그 외 52)', async () => {
      const doc = await service.getHours('doc-001', '1990-01-01');
      const nur = await service.getHours('nur-001', '1990-01-01');

      expect(doc.maxAllowed).toBe(80);
      expect(nur.maxAllowed).toBe(52);
      expect(doc.maxWeeklyHours).toEqual({ doctor: 80, other: 52 });
    });

    it('getHours — 계정을 못 찾으면 이름을 지어내지 않는다(null)', async () => {
      mockPrisma.user.findMany = vi.fn(async () => []);
      const r = await service.getHours('없는-사람', '1990-01-01');

      expect(r.staffKnown).toBe(false);
      expect(r.staffName).toBeNull(); // 종전엔 '-' 라는 이름이 찍혔다
    });

    it('getOnCall — 배정 없는 교대를 응답에서 빼지 않는다(미배정 명시)', async () => {
      const r = await service.getOnCall('1990-01-01');

      expect(r.totalOnCall).toBe(0);
      expect(r.unassignedShifts).toEqual(['DAY', 'EVENING', 'NIGHT']);
    });

    // 🔴 공정성 지수는 배정이 적을수록 올라간다(stdDev→0) — 표본 부재를 응답이 밝혀야 한다
    it('getFairnessReport — 표본이 얇으면 insufficient 로 고지한다', async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const r: any = await service.getFairnessReport(month);

      expect(r.sample).toBeDefined();
      expect(r.sample.coveredDays).toBe(5); // 픽스처는 1~5일만 배정
      expect(r.sample.totalDays).toBeGreaterThanOrEqual(28);
      expect(r.sample.unassignedDays).toBe(r.sample.totalDays - 5);
      expect(r.sample.insufficient).toBe(true);
    });

    it('getFairnessReport — 배정 0건인 달도 표본 정보를 준다', async () => {
      const r: any = await service.getFairnessReport('1990-01');

      expect(r.rating).toBe('N/A');
      expect(r.sample.totalEntries).toBe(0);
      expect(r.sample.insufficient).toBe(true);
    });

    // 🔴 기본 월이 UTC 라 매월 1일 KST 새벽엔 전월 통계가 나왔다
    it('getStats — 기본 월은 서버 로컬(KST) 달력의 이번 달이다', async () => {
      const n = new Date();
      const expected = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
      const r = await service.getStats();

      expect(r.month).toBe(expected);
    });

    it('getFairnessReport — 기본 월도 로컬 기준이다', async () => {
      const n = new Date();
      const expected = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
      const r = await service.getFairnessReport();

      expect(r.month).toBe(expected);
    });
  });
});
