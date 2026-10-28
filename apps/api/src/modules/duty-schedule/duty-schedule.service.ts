import { Injectable, Optional, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { publicBaseUrl } from '../../common/util/public-url';
import { localDateKey, monthRangeLocal } from '../../common/day-range';

type Shift = 'DAY' | 'EVENING' | 'NIGHT';
const SHIFT_HOURS: Record<string, number> = { DAY: 8, EVENING: 8, NIGHT: 10 };
/** 직군별 주간 상한 기본값 — 의사(전공의법) 80h · 그 외(52시간제) 52h. config 로 오버라이드 */
const DEFAULT_MAX_WEEKLY_DOCTOR = 80;
const DEFAULT_MAX_WEEKLY_OTHER = 52;

interface StaffRef { id: string; name: string; role: string; department: string }

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
/**
 * 저장된 DutyEntry.date(=UTC 자정)를 날짜 키로 되돌린다.
 * 🔴 **지금(`new Date()`)에는 쓰면 안 된다** — `toISOString()` 은 UTC 라 KST 00:00~09:00 에
 *    어제 날짜를 낸다(야간 근무 시간대에 정확히 하루가 밀린다). 기본값은 `localDateKey` 를 쓸 것.
 */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/**
 * 🔴 W7: `DutySwapRequest.id`·`DutyLeaveRequest.id` 는 `@db.Uuid` 다. 코드성 문자열(`swap-001`)을
 *    넘기면 Prisma 가 **P2023 으로 500** 을 내 화면엔 "처리에 실패했습니다"만 뜬다(원인 불명).
 *    형식이 어긋나면 "없는 요청"으로 정직하게 404 를 낸다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 🔴 못 읽는 `month` 가 `new Date(NaN)` 으로 Prisma 에 들어가 **500** 이 났다(운영 실측).
//    정본 `monthRangeLocal` 이 400 으로 말한다 — 여기서 각자 풀지 않는다.
const monthRange = monthRangeLocal;

@Injectable()
export class DutyScheduleService {
  private readonly logger = new Logger(DutyScheduleService.name);
  constructor(private readonly prisma: PrismaService, @Optional() private readonly configRuntime?: ConfigRuntimeService) {}

  /**
   * 실 직원(User) 풀 — 의사/간호사. 부서 없으면 '미지정'.
   *
   * 🔴 W7 미해결(정책 판단 필요): 이 풀은 `role IN (DOCTOR,NURSE) AND isActive` 만 거른다.
   *    **병동 3교대 자격·부서 적합성 검증이 없다** — 실측(2026-08 배정 12건)에서 행정과·혈액은행·
   *    투석실·물리치료실·검진센터 소속이 병동 당직에 배정돼 있었다. 자격 정본(면허·병동 배치·
   *    교대 가능 여부)이 어느 테이블인지 확정되기 전에 코드로 막으면 배정이 전멸하므로
   *    여기서는 강제하지 않는다. 후보 — `StaffCredential`(면허·자격 만료, staff-qualification 모듈) /
   *    `DutyStaffingRule.nurseGrade`(간호등급) / `User.department`(병동 소속).
   *    셋 중 무엇을 자격 정본으로 삼을지 간호부·인사 판단이 필요하다(보고서 참조).
   */
  private async staffPool(department?: string): Promise<StaffRef[]> {
    const users = await this.prisma.user.findMany({
      where: {
        role: { in: ['DOCTOR', 'NURSE'] },
        isActive: true,
        ...(department && department !== '전체' ? { department } : {}),
      },
      select: { id: true, familyName: true, givenName: true, role: true, department: true },
      take: 500,
    });
    return users.map((u) => ({
      id: u.id,
      name: `${u.familyName}${u.givenName}`,
      role: u.role === 'DOCTOR' ? 'doctor' : 'nurse',
      department: u.department ?? '미지정',
    }));
  }

  /* ── 1. getSchedule ──────────────────────── */
  async getSchedule(month: string, department?: string) {
    const { start, end } = monthRange(month);
    const dept = department && department !== '전체' ? department : null;
    const rows = await this.prisma.dutyEntry.findMany({
      where: { date: { gte: start, lt: end }, ...(dept ? { department: dept } : {}) },
      orderBy: { date: 'asc' },
      take: 2000,
    });
    const dateMap = new Map<string, typeof rows>();
    for (const e of rows) {
      const ds = fmtDate(e.date);
      if (!dateMap.has(ds)) dateMap.set(ds, [] as never);
      (dateMap.get(ds) as typeof rows).push(e);
    }

    // 🔴 W7: DutyEntry.role 은 **배정 당시 스냅샷**이다. v3.96 RBAC 재배정으로 UserRole 이
    //    바뀐 직원(예: NURSE → ADMIN_STAFF)이 당직표에서는 여전히 '간호사' 뱃지로 보였다 —
    //    화면이 임상 인력으로 오인한다. 지금의 User.role 을 함께 실어 보내 화면이 대조할 수 있게 한다.
    //    (스냅샷은 법정 기록이라 덮어쓰지 않는다 — 표시만 재검증한다)
    const dutyStaffIds = [...new Set(rows.map((r) => r.staffId))];
    const dutyUsers = dutyStaffIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: dutyStaffIds } }, select: { id: true, role: true, isActive: true } })
      : [];
    const roleNowMap = new Map(dutyUsers.map((u) => [u.id, { role: u.role as string, isActive: u.isActive }]));
    /** DutyEntry.role('doctor'|'nurse') 과 비교 가능한 형태로 UserRole 을 접는다 */
    const foldRole = (userRole?: string) => (userRole === 'DOCTOR' ? 'doctor' : userRole === 'NURSE' ? 'nurse' : userRole ? 'other' : null);

    // ── 통합 뷰(P0) — 승인 휴가를 OFF로 병합. DutyEntry·LeaveRequest 모두 User.id 기준.
    //    (StaffSchedule OFF는 휴가 승인 시 파생분이라 중복 → LeaveRequest를 정본으로 사용)
    const leaves = await this.prisma.leaveRequest.findMany({
      where: { status: 'APPROVED', fromDate: { lt: end }, toDate: { gte: start } },
      select: { userId: true, type: true, fromDate: true, toDate: true },
    });
    const leaveUserIds = [...new Set(leaves.map((l) => l.userId))];
    const users = leaveUserIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: leaveUserIds } }, select: { id: true, familyName: true, givenName: true, department: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    // 근무 있는 날 + 휴가 걸친 날 합집합으로 날짜 축 구성(휴가만 있는 날도 표시)
    const allDates = new Set(dateMap.keys());
    for (const l of leaves) {
      for (let t = new Date(Math.max(l.fromDate.getTime(), start.getTime())); t < end && t <= l.toDate; t = new Date(t.getTime() + 86400_000)) {
        allDates.add(fmtDate(t));
      }
    }

    const leavesOn = (date: string) => {
      const d = new Date(date);
      return leaves
        .filter((l) => l.fromDate <= d && l.toDate >= d && (!dept || userMap.get(l.userId)?.department === dept))
        .map((l) => { const u = userMap.get(l.userId); return { userId: l.userId, name: u ? `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() : '-', type: l.type }; });
    };

    // ── 인력기준 미달 경고(P1b) — DutyStaffingRule 대비 부족 shift(부서 지정 시)
    const rules = await this.prisma.dutyStaffingRule.findMany({ where: dept ? { department: dept } : {} });
    const minFor = (shift: string, dateStr: string): number => {
      if (!dept) return 0;
      const dow = new Date(dateStr).getDay();
      const dt = dow === 0 || dow === 6 ? 'WEEKEND' : 'WEEKDAY';
      const r = rules.find((x) => x.shift === shift && (x.dayType === dt || x.dayType === 'ALL'));
      return r?.minCount ?? 0;
    };
    const understaffedOn = (date: string, items: typeof rows) =>
      (['DAY', 'EVENING', 'NIGHT'] as const)
        .map((sh) => { const req = minFor(sh, date); const actual = items.filter((i) => i.shift === sh).length; return req > 0 && actual < req ? { shift: sh as string, required: req, actual } : null; })
        .filter((x) => x !== null) as { shift: string; required: number; actual: number }[];

    return {
      month,
      department: department ?? '전체',
      schedules: [...allDates].sort((a, b) => a.localeCompare(b)).map((date) => {
        const items = dateMap.get(date) ?? [];
        return {
          date,
          dayOfWeek: ['일', '월', '화', '수', '목', '금', '토'][new Date(date).getDay()],
          shifts: items.map((i) => {
            const now = roleNowMap.get(i.staffId);
            const folded = foldRole(now?.role);
            return {
              id: i.id, shift: i.shift, staffId: i.staffId, staffName: i.staffName,
              role: i.role, // 배정 당시 스냅샷(법정 기록)
              department: i.department,
              // 🔴 재검증 결과 — 화면은 이 값으로 직군을 표시해야 한다(스냅샷은 낡을 수 있다)
              roleNow: now?.role ?? null,
              roleMismatch: folded !== null && folded !== i.role,
              staffInactive: now ? !now.isActive : false,
            };
          }),
          leaves: leavesOn(date), // 휴가/OFF 통합 표시
          understaffed: understaffedOn(date, items), // 인력기준 미달(P1b)
        };
      }),
      totalEntries: rows.length,
    };
  }

  /* ── 근무 전이·연속 규칙 (P1) ─────────────── */

  /** 제약 강제 모드 — config duty.constraint.enforce (OFF|WARN|BLOCK), 미설정=OFF */
  private async constraintMode(): Promise<'OFF' | 'WARN' | 'BLOCK'> {
    // 🔴 조회 실패를 'OFF' 로 접지 않는다(미설정=null 은 그대로 OFF — 부재와 실패는 다른 사실이다).
    const v = await this.configRuntime?.get('duty.constraint.enforce');
    return v === 'BLOCK' || v === 'WARN' ? v : 'OFF';
  }

  /**
   * 근무 전이·연속 규칙 검증(위반 사유 배열 반환·빈=통과).
   * - 같은 날 다른 근무 중복
   * - 전일 야간(N) → 당일 주간/저녁 금지(근무간 최소 휴식 인터벌)
   * - 야간(N) 다음날 주간/저녁이 이미 배정(대칭)
   * - 연속 야간 상한 초과
   */
  private async checkDutyConstraints(staffId: string, dateStr: string, shift: Shift, maxConsecutiveNights = 3): Promise<string[]> {
    const v: string[] = [];
    const d = new Date(`${dateStr}T00:00:00Z`);
    const prev = new Date(d.getTime() - 86400_000);
    const next = new Date(d.getTime() + 86400_000);
    const around = await this.prisma.dutyEntry.findMany({ where: { staffId, date: { in: [prev, d, next] } }, select: { date: true, shift: true } });
    const on = (dt: Date) => around.filter((a) => a.date.getTime() === dt.getTime());
    if (on(d).some((a) => a.shift !== shift)) v.push('같은 날 다른 근무가 이미 배정됨');
    if (on(prev).some((a) => a.shift === 'NIGHT') && shift !== 'NIGHT') v.push('전일 야간(N) 근무 후 당일 주간/저녁 배정 불가(근무간 최소 휴식)');
    if (shift === 'NIGHT' && on(next).some((a) => a.shift === 'DAY' || a.shift === 'EVENING')) v.push('야간(N) 다음날 주간/저녁이 이미 배정됨(근무간 최소 휴식)');
    if (shift === 'NIGHT') {
      let cnt = 0;
      for (let i = 1; i <= 10; i++) {
        const pd = new Date(d.getTime() - i * 86400_000);
        const e = await this.prisma.dutyEntry.findFirst({ where: { staffId, date: pd, shift: 'NIGHT' }, select: { id: true } });
        if (e) cnt++; else break;
      }
      if (cnt >= maxConsecutiveNights) v.push(`연속 야간 ${maxConsecutiveNights}일 초과 — 필수 OFF 필요`);
    }
    // 연속근무일수 제한(P1b·전공의법 연속근무) — 직전 연속 근무일(OFF 없이) + 당일
    const maxDays = Number((await this.configRuntime?.get('duty.maxConsecutiveDays').catch(() => null)) ?? 6);
    let workDays = 1;
    for (let i = 1; i <= 14; i++) {
      const pd = new Date(d.getTime() - i * 86400_000);
      const w = await this.prisma.dutyEntry.findFirst({ where: { staffId, date: pd }, select: { id: true } });
      if (w) workDays++; else break;
    }
    if (workDays > maxDays) v.push(`연속 근무 ${maxDays}일 초과 — 휴무(OFF) 필요`);
    return v;
  }

  /* ── 인력기준(P1b) CRUD ──────────────────── */
  async listStaffingRules(department?: string) {
    return this.prisma.dutyStaffingRule.findMany({ where: department && department !== '전체' ? { department } : {}, orderBy: [{ department: 'asc' }, { shift: 'asc' }] });
  }
  async upsertStaffingRule(dto: { department: string; shift: string; dayType?: string; minCount: number; nurseGrade?: string }) {
    const dayType = dto.dayType ?? 'ALL';
    return this.prisma.dutyStaffingRule.upsert({
      where: { department_shift_dayType: { department: dto.department, shift: dto.shift, dayType } },
      update: { minCount: dto.minCount, nurseGrade: dto.nurseGrade ?? null },
      create: { department: dto.department, shift: dto.shift, dayType, minCount: dto.minCount, nurseGrade: dto.nurseGrade ?? null },
    });
  }
  async deleteStaffingRule(id: string) {
    await this.prisma.dutyStaffingRule.delete({ where: { id } }).catch(() => undefined);
    return { deleted: true };
  }

  /* ── 당직 on-call(P2) — 3교대와 별개·과별 1st/2nd call ──────── */
  async listOnCall(month?: string, department?: string) {
    const m = month ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const { start, end } = monthRange(m);
    const rows = await this.prisma.onCallSchedule.findMany({
      where: { date: { gte: start, lt: end }, ...(department && department !== '전체' ? { department } : {}) },
      orderBy: [{ date: 'asc' }, { callLevel: 'asc' }],
    });
    const map = new Map<string, typeof rows>();
    for (const r of rows) { const d = fmtDate(r.date); if (!map.has(d)) map.set(d, [] as never); (map.get(d) as typeof rows).push(r); }
    return {
      month: m, department: department ?? '전체',
      oncall: [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({
        date, calls: items.map((i) => ({ id: i.id, department: i.department, callLevel: i.callLevel, staffId: i.staffId, staffName: i.staffName, note: i.note })),
      })),
    };
  }
  async assignOnCall(dto: { date: string; department: string; callLevel: string; staffId: string; note?: string }) {
    const staff = (await this.staffPool()).find((s) => s.id === dto.staffId);
    if (!staff) return { error: '직원을 찾을 수 없습니다' };
    const dateObj = new Date(`${dto.date}T00:00:00Z`);
    const rec = await this.prisma.onCallSchedule.upsert({
      where: { date_department_callLevel: { date: dateObj, department: dto.department, callLevel: dto.callLevel } },
      update: { staffId: staff.id, staffName: staff.name, note: dto.note ?? null },
      create: { date: dateObj, department: dto.department, callLevel: dto.callLevel, staffId: staff.id, staffName: staff.name, note: dto.note ?? null },
    });
    return { data: { ...rec, date: fmtDate(rec.date) }, message: '당직(on-call) 배정 완료' };
  }
  async removeOnCall(id: string) { await this.prisma.onCallSchedule.delete({ where: { id } }).catch(() => undefined); return { removed: true }; }

  /* ── 개인 근무 선호/기피(P3) ──────────────── */
  async listPreferences(month: string, staffId?: string) {
    return this.prisma.dutyPreference.findMany({ where: { month, ...(staffId ? { staffId } : {}) }, orderBy: { date: 'asc' } });
  }
  async upsertPreference(dto: { staffId: string; month: string; date: string; kind: string; note?: string }) {
    return this.prisma.dutyPreference.create({ data: { staffId: dto.staffId, month: dto.month, date: dto.date, kind: dto.kind, note: dto.note ?? null } });
  }
  async removePreference(id: string) { await this.prisma.dutyPreference.delete({ where: { id } }).catch(() => undefined); return { removed: true }; }

  /* ── 2. autoGenerate ─────────────────────── */
  async autoGenerate(month: string, department: string, constraints: { maxConsecutiveNights?: number; maxWeeklyHours?: number; minRestHours?: number }) {
    const { start: __ms } = monthRangeLocal(month);
    const year = __ms.getFullYear(); const mon = __ms.getMonth() + 1;
    const days = daysInMonth(year, mon);
    const shifts: Shift[] = ['DAY', 'EVENING', 'NIGHT'];
    // 🔴 (2026-09-15) 관리 화면은 '전체'를 `''` 로 보낸다. staffPool 은 `''` 을 전체로 읽는데 아래 삭제는 `department: ''`
    //    로 걸러 **아무것도 지우지 않았다** — 재편성할 때마다 같은 달 전 직원 배정이 한 벌씩 더 쌓였다. 해석을 하나로.
    const allDepts = !department || department === '전체';
    const deptStaff = await this.staffPool(allDepts ? undefined : department);
    if (deptStaff.length === 0) return { error: '해당 부서에 배정 가능한 직원이 없습니다', generated: 0 };

    // 기존 월/부서 배정 삭제(재생성)
    const { start, end } = monthRange(month);
    await this.prisma.dutyEntry.deleteMany({ where: { date: { gte: start, lt: end }, ...(allDepts ? {} : { department }) } });

    const countMap = new Map<string, number>(deptStaff.map((s) => [s.id, 0]));
    const consecutiveNights = new Map<string, number>();
    const toCreate: { date: Date; shift: string; staffId: string; staffName: string; role: string; department: string }[] = [];

    for (let d = 1; d <= days; d++) {
      const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(`${dateStr}T00:00:00Z`);
      for (const shift of shifts) {
        const todayAssigned = toCreate.filter((g) => fmtDate(g.date) === dateStr).map((g) => g.staffId);
        const prevStr = fmtDate(new Date(dateObj.getTime() - 86400_000));
        const available = deptStaff
          .filter((s) => !todayAssigned.includes(s.id))
          .filter((s) => shift !== 'NIGHT' || (consecutiveNights.get(s.id) ?? 0) < (constraints.maxConsecutiveNights ?? 3))
          // 전이규칙 — 전일 야간(N) 근무자는 당일 주간/저녁 배제(근무간 최소 휴식)
          .filter((s) => shift === 'NIGHT' || !toCreate.some((g) => fmtDate(g.date) === prevStr && g.staffId === s.id && g.shift === 'NIGHT'))
          .sort((a, b) => (countMap.get(a.id) ?? 0) - (countMap.get(b.id) ?? 0));
        if (available.length === 0) continue;
        const sel = available[0];
        toCreate.push({ date: dateObj, shift, staffId: sel.id, staffName: sel.name, role: sel.role, department: sel.department });
        countMap.set(sel.id, (countMap.get(sel.id) ?? 0) + 1);
        consecutiveNights.set(sel.id, shift === 'NIGHT' ? (consecutiveNights.get(sel.id) ?? 0) + 1 : 0);
      }
    }
    if (toCreate.length) await this.prisma.dutyEntry.createMany({ data: toCreate });

    const summary = deptStaff.map((s) => ({
      staffId: s.id, staffName: s.name, role: s.role, department: s.department,
      totalShifts: countMap.get(s.id) ?? 0,
      dayShifts: toCreate.filter((g) => g.staffId === s.id && g.shift === 'DAY').length,
      eveningShifts: toCreate.filter((g) => g.staffId === s.id && g.shift === 'EVENING').length,
      nightShifts: toCreate.filter((g) => g.staffId === s.id && g.shift === 'NIGHT').length,
    }));
    return { month, department, constraints, totalDays: days, generated: toCreate.length, staffCount: deptStaff.length, summary };
  }

  /* ── 3. assign ───────────────────────────── */
  async assign(data: { date: string; shift: Shift; staffId: string }) {
    const staff = (await this.staffPool()).find((s) => s.id === data.staffId);
    if (!staff) return { error: '직원을 찾을 수 없습니다' };
    const dateObj = new Date(`${data.date}T00:00:00Z`);
    const existing = await this.prisma.dutyEntry.findFirst({ where: { date: dateObj, shift: data.shift, staffId: data.staffId } });
    if (existing) return { error: '이미 해당 근무에 배정되어 있습니다' };
    // P1 근무 규칙 사전 검증 — BLOCK이면 차단, WARN이면 경고 동반 배정, OFF면 무검증
    const mode = await this.constraintMode();
    let warnings: string[] = [];
    if (mode !== 'OFF') {
      warnings = await this.checkDutyConstraints(data.staffId, data.date, data.shift);
      if (warnings.length && mode === 'BLOCK') return { error: `근무 규칙 위반: ${warnings.join(', ')}`, violations: warnings };
    }
    const entry = await this.prisma.dutyEntry.create({ data: { date: dateObj, shift: data.shift, staffId: staff.id, staffName: staff.name, role: staff.role, department: staff.department } });
    return { data: { ...entry, date: fmtDate(entry.date) }, message: '배정 완료', ...(warnings.length ? { warnings } : {}) };
  }

  /* ── 4. requestSwap ──────────────────────── */
  async requestSwap(data: { requesterId: string; targetId: string; originalDate: string; originalShift: string; swapDate: string; swapShift: string; reason: string }) {
    const pool = await this.staffPool();
    const requester = pool.find((s) => s.id === data.requesterId);
    const target = pool.find((s) => s.id === data.targetId);
    // 교대 전자결재(P2) — config ON 시 상대 직원 승인 결재선(EApprovalRelay HR_DUTY_SWAP). 승인 시 ess가 handleSwap 호출.
    const useEApproval = String(await this.configRuntime?.get('duty.swap.eApproval').catch(() => null)) === 'true';
    const targetStaff = useEApproval
      ? await this.prisma.staff.findUnique({ where: { userId: data.targetId }, select: { id: true } })
      : null;
    const swapData = {
      requesterId: data.requesterId, requesterName: requester?.name ?? '-',
      targetId: data.targetId, targetName: target?.name ?? '-',
      originalDate: data.originalDate, originalShift: data.originalShift,
      swapDate: data.swapDate, swapShift: data.swapShift, reason: data.reason, status: 'PENDING',
    };
    if (targetStaff) {
      const callbackUrl = `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`;
      /**
       * 🔴 (2026-09-16 K1) 종전엔 교대 요청을 먼저 커밋하고 결재 릴레이를 **따로** 만들었다 —
       *    릴레이 생성이 실패하면 요청만 PENDING 으로 남아 **아무에게도 결재가 가지 않고**, 사람이 다시
       *    신청하면 같은 교대가 두 건이 된다(둘 다 승인되면 근무가 두 번 바뀌어 원래대로 돌아간다).
       *    J1 이 ESS 휴가 신청에서 고친 것과 같은 자리 — 요청과 결재선은 한 트랜잭션이다.
       */
      const { swap, relay } = await this.prisma.$transaction(async (tx) => {
        const swapRow = await tx.dutySwapRequest.create({ data: swapData });
        const relayRow = await tx.eApprovalRelay.create({
          data: {
            docType: 'HR_DUTY_SWAP', title: `당직 교대 요청 (${data.originalDate} ${data.originalShift} ↔ ${data.swapDate} ${data.swapShift})`,
            refModule: 'duty.swap_requests', refId: swapRow.id, callbackUrl,
            approvalLine: [{ order: 1, staffId: targetStaff.id, userId: data.targetId, role: 'APPROVE' }] as object,
          },
        });
        return { swap: swapRow, relay: relayRow };
      });
      // 알림은 비차단 — 결재선이 남았으면 상대는 결재함에서 본다
      await this.prisma.notification.create({ data: { userId: data.targetId, type: 'HR_DUTY_SWAP', title: '당직 교대 요청', message: `${requester?.name ?? ''}님의 당직 교대 요청 결재`, severity: 'INFO', refType: 'DUTY_SWAP', refId: swap.id } }).catch((e) => this.logger.warn(`당직교대 알림 발신 실패: ${(e as Error).message}`));
      return { data: swap, message: '교대 요청이 전자결재로 상신되었습니다', relayId: relay.id };
    }
    const swap = await this.prisma.dutySwapRequest.create({ data: swapData });
    return { data: swap, message: '교대 요청이 등록되었습니다' };
  }

  /* ── 5. handleSwap ───────────────────────── */
  async handleSwap(id: string, approve: boolean) {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException({ code: 'DUTY_SWAP_NOT_FOUND', message: '교대 요청을 찾을 수 없습니다' });
    const swap = await this.prisma.dutySwapRequest.findUnique({ where: { id } });
    // 🔴 W7 조용한 성공(P16): 종전엔 `{ error }` 를 **반환**했고 컨트롤러가 `{ ok: true, ...result }`
    //    로 감싸 HTTP 200 을 냈다 → 화면은 onSuccess 로 들어가 "교대 요청을 승인했습니다" 토스트를
    //    띄웠다. 아무것도 승인되지 않았는데. 없는 것을 처리했다고 말하지 않도록 404 로 던진다.
    if (!swap) throw new NotFoundException({ code: 'DUTY_SWAP_NOT_FOUND', message: '교대 요청을 찾을 수 없습니다' });
    // 🔴 (2026-09-15) 상태를 보지 않고 덮어써, 거절된 요청을 다시 승인하면 근무가 **또** 교환됐다(이미 승인된 건은
    //    재승인마다 두 사람의 근무가 되돌려졌다). PENDING 에서만 결정한다 — 조건부 갱신이라 동시 결정도 한 건만 이긴다.
    const won = await this.prisma.dutySwapRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED' } });
    if (won.count === 0) {
      throw new ConflictException({ code: 'DUTY_SWAP_NOT_PENDING', message: '이미 처리된 교대 요청입니다', details: { status: swap.status } });
    }
    const updated = { ...swap, status: approve ? 'APPROVED' : 'REJECTED' };
    if (approve) {
      const reqEntry = await this.prisma.dutyEntry.findFirst({ where: { date: new Date(`${swap.originalDate}T00:00:00Z`), shift: swap.originalShift, staffId: swap.requesterId } });
      const tgtEntry = await this.prisma.dutyEntry.findFirst({ where: { date: new Date(`${swap.swapDate}T00:00:00Z`), shift: swap.swapShift, staffId: swap.targetId } });
      if (reqEntry && tgtEntry) {
        await this.prisma.$transaction([
          this.prisma.dutyEntry.update({ where: { id: reqEntry.id }, data: { staffId: tgtEntry.staffId, staffName: tgtEntry.staffName, role: tgtEntry.role, department: tgtEntry.department } }),
          this.prisma.dutyEntry.update({ where: { id: tgtEntry.id }, data: { staffId: reqEntry.staffId, staffName: reqEntry.staffName, role: reqEntry.role, department: reqEntry.department } }),
        ]);
      }
    }
    return { data: updated, message: approve ? '교대 요청이 승인되었습니다' : '교대 요청이 거절되었습니다' };
  }

  /** 직군별 주간 상한 — getViolations 와 같은 기준(config 오버라이드 동일 키) */
  private async weeklyLimits(): Promise<{ doctor: number; other: number }> {
    const doctor = Number((await this.configRuntime?.get('duty.maxWeeklyHours.doctor').catch(() => null)) ?? DEFAULT_MAX_WEEKLY_DOCTOR);
    const other = Number((await this.configRuntime?.get('duty.maxWeeklyHours.other').catch(() => null)) ?? DEFAULT_MAX_WEEKLY_OTHER);
    return { doctor, other };
  }

  /* ── 6. getHours ─────────────────────────── */
  async getHours(userId: string, weekStart: string) {
    const start = new Date(`${weekStart}T00:00:00Z`);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
    const endStr = fmtDate(new Date(end.getTime() - 86400000));
    const weekEntries = await this.prisma.dutyEntry.findMany({ where: { staffId: userId, date: { gte: start, lt: end } } });
    const totalHours = weekEntries.reduce((sum, e) => sum + (SHIFT_HOURS[e.shift] ?? 8), 0);

    // 🔴 W7: 이름을 당직 기록에서만 찾다 보니 배정이 없는 직원은 화면에 "-" 로 떴다(존재하지 않는
    //    사람처럼 보인다). User 를 정본으로 먼저 조회한다 — 직군 상한 판정에도 필요하다.
    const users = await this.prisma.user.findMany({
      where: { id: { in: [userId] } },
      select: { id: true, familyName: true, givenName: true, role: true, department: true, isActive: true },
    });
    const user = users.find((u) => u.id === userId) ?? null;
    const name = user ? `${user.familyName ?? ''}${user.givenName ?? ''}`.trim() : (weekEntries[0]?.staffName ?? null);

    // 🔴 W7: 상한이 **누구든 80h 고정**이었다. getViolations 는 간호사를 52h 로 판정하는데
    //    개인 카드는 "/ 80시간 제한" 이라 말해 같은 사실에 기준이 둘이었다 — 직군별로 통일한다.
    const limits = await this.weeklyLimits();
    const roleFolded = user ? (user.role === 'DOCTOR' ? 'doctor' : 'other') : (weekEntries[0]?.role === 'doctor' ? 'doctor' : 'other');
    const maxAllowed = roleFolded === 'doctor' ? limits.doctor : limits.other;

    return {
      staffId: userId,
      staffName: name, // 🔴 미상은 null — '-' 라는 이름을 지어내지 않는다
      staffRole: user?.role ?? null,
      staffDepartment: user?.department ?? null,
      staffKnown: !!user,
      staffInactive: user ? !user.isActive : null,
      weekStart, weekEnd: endStr,
      shifts: weekEntries.map((e) => ({ date: fmtDate(e.date), shift: e.shift, hours: SHIFT_HOURS[e.shift] ?? 8 })),
      totalHours, maxAllowed, maxWeeklyHours: limits, isOverLimit: totalHours > maxAllowed,
    };
  }

  /* ── 7. getViolations ────────────────────── */
  async getViolations() {
    const rows = await this.prisma.dutyEntry.findMany({ take: 5000, orderBy: { date: 'desc' } });
    const staffWeekMap = new Map<string, Map<string, number>>();
    const nameMap = new Map<string, { name: string; department: string }>();
    for (const e of rows) {
      nameMap.set(e.staffId, { name: e.staffName, department: e.department });
      if (!staffWeekMap.has(e.staffId)) staffWeekMap.set(e.staffId, new Map());
      const d = new Date(e.date); const ws = new Date(d); ws.setUTCDate(ws.getUTCDate() - ws.getUTCDay());
      const weekKey = fmtDate(ws);
      const wm = staffWeekMap.get(e.staffId)!;
      wm.set(weekKey, (wm.get(weekKey) ?? 0) + (SHIFT_HOURS[e.shift] ?? 8));
    }
    // 승인 초과근무 합산 (P1-2) — OvertimeRequest.userId = DutyEntry.staffId(User.id)
    const otRows = await this.prisma.overtimeRequest.findMany({
      where: { status: 'APPROVED' },
      select: { userId: true, workDate: true, hours: true },
      take: 5000,
    });
    for (const ot of otRows) {
      if (!staffWeekMap.has(ot.userId)) continue; // 당직표에 없는 직원은 집계 대상 밖(별도 트랙)
      const d = new Date(ot.workDate); const ws = new Date(d); ws.setUTCDate(ws.getUTCDate() - ws.getUTCDay());
      const weekKey = fmtDate(ws);
      const wm = staffWeekMap.get(ot.userId)!;
      wm.set(weekKey, (wm.get(weekKey) ?? 0) + Number(ot.hours));
    }

    // 직군별 기준 (P1-3): 의사(전공의 규정) 80h · 그 외(일반직 52시간제) 52h — config 오버라이드
    const roleMap = new Map<string, string>();
    for (const e of rows) if (!roleMap.has(e.staffId)) roleMap.set(e.staffId, e.role);
    const { doctor: maxDoctor, other: maxOther } = await this.weeklyLimits();
    const limitOf = (staffId: string) => (roleMap.get(staffId) === 'doctor' ? maxDoctor : maxOther);

    const violations: { staffId: string; staffName: string; department: string; role: string; weekStart: string; totalHours: number; maxAllowed: number; overBy: number }[] = [];
    for (const [staffId, wm] of staffWeekMap.entries()) {
      const info = nameMap.get(staffId);
      const limit = limitOf(staffId);
      for (const [weekStart, hours] of wm.entries()) {
        if (hours > limit) violations.push({ staffId, staffName: info?.name ?? '-', department: info?.department ?? '-', role: roleMap.get(staffId) ?? '-', weekStart, totalHours: hours, maxAllowed: limit, overBy: hours - limit });
      }
    }
    return { maxWeeklyHours: { doctor: maxDoctor, other: maxOther }, violations: violations.sort((a, b) => b.overBy - a.overBy), totalViolations: violations.length };
  }

  /* ── 8. getOnCall ────────────────────────── */
  async getOnCall(date?: string) {
    // 🔴 W7: 기본값이 `fmtDate(new Date())` = **UTC 날짜**였다. 컨테이너 OS 는 UTC 이고 pm2 TZ 만
    //    KST 라, KST 00:00~09:00(=야간 근무 시간대)에는 **어제 당직표**가 나왔다. 당직자를 묻는
    //    시각이 정확히 그 시간대다. 서버 로컬(KST) 달력 날짜로 고정한다.
    const targetDate = date ?? localDateKey(new Date());
    const rows = await this.prisma.dutyEntry.findMany({ where: { date: new Date(`${targetDate}T00:00:00Z`) } });
    const shiftMap: Record<string, { staffId: string; staffName: string; role: string; department: string }[]> = {};
    for (const e of rows) {
      (shiftMap[e.shift] ??= []).push({ staffId: e.staffId, staffName: e.staffName, role: e.role, department: e.department });
    }
    // 🔴 배정이 없는 교대를 응답에서 빼면 화면은 "조용히" 그 교대를 안 그린다 —
    //    빈 배열로 **명시**해 화면이 '미배정'을 말할 수 있게 한다.
    const unassignedShifts = (['DAY', 'EVENING', 'NIGHT'] as const).filter((s) => !(shiftMap[s]?.length));
    return {
      date: targetDate,
      shifts: Object.entries(shiftMap).map(([shift, staff]) => ({ shift, staff })),
      unassignedShifts,
      totalOnCall: rows.length,
    };
  }

  /* ── 9. requestLeave ─────────────────────── */
  async requestLeave(data: { staffId: string; startDate: string; endDate: string; type: string; reason: string }) {
    const staff = (await this.staffPool()).find((s) => s.id === data.staffId);
    /**
     * 🔴 (2026-09-16 J4) 같은 사람·같은 기간·같은 종류의 **대기 중** 신청이 이미 있으면 다시 만들지 않는다.
     *    종전엔 버튼을 두 번 누르면 PENDING 이 두 건 생겼고, 둘 다 승인되면 **연차가 두 번 차감된다**
     *    (I2 가 ESS 결재 콜백에서 차감 경로를 고친 그 자리와 같은 값이다). 결정 경로는 N3 가 PENDING 에서만
     *    처리하도록 막았지만, **신청이 두 건이면 둘 다 각각 PENDING** 이라 그 가드로는 걸러지지 않는다.
     */
    const dup = await this.prisma.dutyLeaveRequest.findFirst({
      where: { staffId: data.staffId, startDate: data.startDate, endDate: data.endDate, type: data.type, status: 'PENDING' },
      orderBy: { id: 'asc' },
    });
    if (dup) return { data: dup, message: '이미 대기 중인 동일 휴가 신청이 있습니다' };
    const leave = await this.prisma.dutyLeaveRequest.create({
      data: { staffId: data.staffId, staffName: staff?.name ?? '-', department: staff?.department ?? '-', startDate: data.startDate, endDate: data.endDate, type: data.type, reason: data.reason, status: 'PENDING' },
    });
    return { data: leave, message: '휴가 신청이 등록되었습니다' };
  }

  /* ── 10. handleLeave ─────────────────────── */
  async handleLeave(id: string, approve: boolean) {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException({ code: 'DUTY_LEAVE_NOT_FOUND', message: '휴가 신청을 찾을 수 없습니다' });
    const leave = await this.prisma.dutyLeaveRequest.findUnique({ where: { id } });
    // 🔴 W7 조용한 성공(P16) — handleSwap 과 같은 결함. 404 로 던진다.
    if (!leave) throw new NotFoundException({ code: 'DUTY_LEAVE_NOT_FOUND', message: '휴가 신청을 찾을 수 없습니다' });
    // 🔴 (2026-09-15) handleSwap 과 같다 — PENDING 에서만 결정(거절된 휴가를 다시 승인하던 것)
    const won = await this.prisma.dutyLeaveRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED' } });
    if (won.count === 0) {
      throw new ConflictException({ code: 'DUTY_LEAVE_NOT_PENDING', message: '이미 처리된 휴가 신청입니다', details: { status: leave.status } });
    }
    const updated = { ...leave, status: approve ? 'APPROVED' : 'REJECTED' };
    return { data: updated, message: approve ? '휴가가 승인되었습니다' : '휴가가 거절되었습니다' };
  }

  /* ── 11. getStats ────────────────────────── */
  async getStats(month?: string) {
    // 🔴 W7: 기본 월이 UTC 였다 — 매월 1일 KST 새벽엔 **전월** 통계가 나왔고, 컨트롤러의
    //    getSchedule 기본값(local getMonth())과 서로 다른 달을 가리켰다(기본값 두 벌).
    const targetMonth = month ?? localDateKey(new Date()).slice(0, 7);
    const { start, end } = monthRange(targetMonth);
    const rows = await this.prisma.dutyEntry.findMany({ where: { date: { gte: start, lt: end } }, take: 5000 });
    const deptMap = new Map<string, { day: number; evening: number; night: number; total: number }>();
    const personMap = new Map<string, { name: string; department: string; role: string; day: number; evening: number; night: number; total: number }>();
    for (const e of rows) {
      const d = deptMap.get(e.department) ?? { day: 0, evening: 0, night: 0, total: 0 };
      d.total++; if (e.shift === 'DAY') d.day++; else if (e.shift === 'EVENING') d.evening++; else d.night++;
      deptMap.set(e.department, d);
      const p = personMap.get(e.staffId) ?? { name: e.staffName, department: e.department, role: e.role, day: 0, evening: 0, night: 0, total: 0 };
      p.total++; if (e.shift === 'DAY') p.day++; else if (e.shift === 'EVENING') p.evening++; else p.night++;
      personMap.set(e.staffId, p);
    }
    return {
      month: targetMonth, totalEntries: rows.length,
      byDepartment: [...deptMap.entries()].map(([department, stat]) => ({ department, ...stat })),
      byPerson: [...personMap.values()].sort((a, b) => b.total - a.total),
    };
  }

  /* ── 12. getFairnessReport ───────────────── */
  async getFairnessReport(month?: string) {
    // 🔴 W7: 기본 월이 UTC 였다(getStats 와 동일 결함)
    const targetMonth = month ?? localDateKey(new Date()).slice(0, 7);
    const { start, end } = monthRange(targetMonth);
    const rows = await this.prisma.dutyEntry.findMany({ where: { date: { gte: start, lt: end } }, take: 5000 });
    const personCounts = new Map<string, { name: string; department: string; role: string; total: number; night: number }>();
    for (const e of rows) {
      const p = personCounts.get(e.staffId) ?? { name: e.staffName, department: e.department, role: e.role, total: 0, night: 0 };
      p.total++; if (e.shift === 'NIGHT') p.night++;
      personCounts.set(e.staffId, p);
    }

    /**
     * 🔴 W7 표본 부재 고지 — 공정성 지수는 `100 - stdDev*10` 이라 **배정이 적을수록 편차가
     *    작아져 점수가 올라간다**. 월의 90%가 미배정이면 stdDev→0 → "매우 공정".
     *    계산식은 실집계라 손대지 않되, 표본이 얼마나 얇은지를 **응답으로 밝힌다**
     *    (화면이 "매우 공정"만 말하는 것을 막는다).
     */
    const { start: __ts } = monthRangeLocal(targetMonth);
    const my = __ts.getFullYear(); const mm = __ts.getMonth() + 1;
    const totalDays = daysInMonth(my, mm);
    const coveredDays = new Set(rows.map((e) => fmtDate(e.date))).size;
    const sample = {
      totalEntries: rows.length,
      totalDays,
      coveredDays,
      unassignedDays: totalDays - coveredDays,
      /** 배정된 날 비율 — 0.5 미만이면 지수를 신뢰할 수 없다 */
      dayCoverage: totalDays > 0 ? Math.round((coveredDays / totalDays) * 100) / 100 : 0,
      /** 표본이 얇아 공정성 지수가 과대평가될 수 있는가 */
      insufficient: rows.length === 0 || coveredDays < totalDays / 2,
    };

    const counts = [...personCounts.values()];
    if (counts.length === 0) return { month: targetMonth, fairnessIndex: 0, stdDeviation: 0, mean: 0, persons: [], rating: 'N/A', sample };
    const totalArr = counts.map((c) => c.total);
    const mean = totalArr.reduce((a, b) => a + b, 0) / totalArr.length;
    const variance = totalArr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / totalArr.length;
    const stdDev = Math.sqrt(variance);
    const fairnessIndex = Math.max(0, Math.round(100 - stdDev * 10));
    const rating = fairnessIndex >= 90 ? '매우 공정' : fairnessIndex >= 70 ? '양호' : fairnessIndex >= 50 ? '보통' : '개선 필요';
    return {
      month: targetMonth, fairnessIndex, stdDeviation: Math.round(stdDev * 100) / 100, mean: Math.round(mean * 100) / 100, rating, sample,
      persons: counts.map((c) => ({ ...c, deviation: Math.round((c.total - mean) * 100) / 100 })).sort((a, b) => b.total - a.total),
    };
  }

  /* ── Helpers (controller) ────────────────── */
  async getSwapRequests() {
    return this.prisma.dutySwapRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }
  async getLeaveRequests() {
    return this.prisma.dutyLeaveRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
