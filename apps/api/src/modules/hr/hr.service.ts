import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EmploymentStatus, Prisma, StaffCategory } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationOutboxService, type HisEvent } from '../integration/integration-outbox.service';
import { assertEnumParam } from '../../common/enum-param';

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: IntegrationOutboxService) {}

  private emitStaff(event: HisEvent, ref: string, s: { id: string; userId?: string | null; employeeNumber: string; erpEmployeeCode?: string | null; familyName?: string; givenName?: string; department?: string; position?: string; status?: string; email?: string | null }, extra: object = {}) {
    void this.outbox.enqueue('hr', event, ref, {
      staffId: s.id,
      userId: s.userId ?? null, // edu 식별키(=User.id) — 없으면 신규 입사자 staff.created 를 edu 가 버림(2026-07-29 edu #5 봉합)
      employeeNumber: s.employeeNumber, erpEmployeeCode: s.erpEmployeeCode ?? null,
      name: `${s.familyName ?? ''}${s.givenName ?? ''}`, email: s.email ?? null, // email = ERP staff-sync 자동매칭 키(요청서 #4)
      department: s.department, position: s.position, status: s.status, ...extra,
    });
  }

  // 기존 직원 ERP 디렉터리 백필 — staff.created 재발행(ref 멱등, ERP 인박스 UNIQUE → 중복 무시).
  // ESS 급여명세·연차잔여(ERP SoT)가 직원 동기화 후 동작하도록.
  async backfillStaffToErp(status: string = 'ACTIVE') {
    assertEnumParam(status, EmploymentStatus, '상태');
    const staff = await this.prisma.staff.findMany({ where: { status: status as EmploymentStatus } });
    for (const s of staff) {
      this.emitStaff('staff.created', `hr:create:${s.id}`, s, { hireDate: s.hireDate });
    }
    return { enqueued: staff.length, status };
  }

  // 기존 직원 User→Staff 백필 — Staff 레코드 없는 User에 Staff 생성(ESS 활성화). 멱등(staff 연결 존재 시 제외).
  async backfillUsersToStaff(): Promise<{ created: number; skipped: number; details: { email: string; employeeNumber: string }[] }> {
    const ROLE_CATEGORY: Record<string, StaffCategory> = {
      DOCTOR: 'MEDICAL', NURSE: 'MEDICAL', PHARMACIST: 'MEDICAL',
      LAB_TECH: 'TECHNICAL',
      ADMIN: 'ADMIN', CRM_MANAGER: 'ADMIN', CRM_STAFF: 'ADMIN', EXECUTIVE: 'ADMIN', READ: 'ADMIN',
    };
    const ROLE_POSITION: Record<string, string> = {
      DOCTOR: '의사', NURSE: '간호사', PHARMACIST: '약사', LAB_TECH: '임상병리사',
      ADMIN: '행정', CRM_MANAGER: 'CRM 매니저', CRM_STAFF: 'CRM 담당', EXECUTIVE: '임원', READ: '열람',
    };
    // User-Staff는 Prisma 관계가 아닌 unique 컬럼 → 연결된 userId 집합으로 미연결 User 선별
    const linked = await this.prisma.staff.findMany({ where: { userId: { not: null } }, select: { userId: true } });
    const linkedIds = new Set(linked.map((s) => s.userId));
    const allUsers = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true, familyName: true, givenName: true, role: true, department: true, specialty: true, createdAt: true },
    });
    const users = allUsers.filter((u) => !linkedIds.has(u.id));
    let created = 0, skipped = 0;
    const details: { email: string; employeeNumber: string }[] = [];
    let seq = 1;
    for (const u of users) {
      let employeeNumber = '';
      for (let tries = 0; tries < 100; tries++) {
        const cand = `BF-${new Date().getFullYear()}-${String(seq++).padStart(4, '0')}`;
        const dup = await this.prisma.staff.findUnique({ where: { employeeNumber: cand }, select: { id: true } });
        if (!dup) { employeeNumber = cand; break; }
      }
      if (!employeeNumber) { skipped++; continue; }
      const staff = await this.prisma.staff.create({
        data: {
          userId: u.id, employeeNumber,
          familyName: u.familyName, givenName: u.givenName,
          category: ROLE_CATEGORY[u.role] ?? 'ADMIN',
          department: u.department ?? '미지정',
          position: ROLE_POSITION[u.role] ?? '직원',
          specialty: u.specialty ?? null,
          hireDate: u.createdAt ?? new Date(),
          email: u.email,
          status: 'ACTIVE',
        },
      }).catch(() => null);
      if (staff) {
        created++; details.push({ email: u.email, employeeNumber });
        this.emitStaff('staff.created', `hr:create:${staff.id}`, staff, { hireDate: staff.hireDate });
      } else skipped++;
    }
    return { created, skipped, details };
  }

  async findAll(filters: { category?: string; department?: string; status?: string }) {
    const where: Prisma.StaffWhereInput = {};
    if (filters.category) { assertEnumParam(filters.category, StaffCategory, '분류'); where.category = filters.category as StaffCategory; }
    if (filters.department) where.department = { contains: filters.department, mode: 'insensitive' };
    // 🔴 기본이 ACTIVE 라 **휴직·정직 직원이 어느 화면에도 뜨지 않았다** — 목록에도,
    //    퇴직자 탭에도 없다. 'ALL' 로 전 재직상태를 볼 수 있게 연다(기본은 종전대로 재직).
    if (filters.status === 'ALL') {
      // 필터 없음 — 전 상태
    } else if (filters.status) {
      { assertEnumParam(filters.status, EmploymentStatus, '상태'); where.status = filters.status as EmploymentStatus; }
    } else {
      where.status = 'ACTIVE';
    }

    const staff = await this.prisma.staff.findMany({ where, orderBy: [{ department: 'asc' }, { familyName: 'asc' }] });

    // 🔴 화면 실사용 점검 W8 — 의료팀 편성(/admin/care-teams) 화면이 이 목록을 `role === 'DOCTOR'`
    //    로 걸러 드롭다운을 채웠는데, **Staff 에는 role 이 없다**(category/position 뿐).
    //    그래서 의사·간호사 드롭다운이 영구히 비어 있었다(선택지 0 → 팀 편성 불가).
    //    게다가 CareTeam.doctorId/nurseId 는 **users.id** 를 가리키는데 이 목록의 `id` 는
    //    staff.id 라 그대로 넘기면 FK 위반(P2003)이 난다. 두 테이블을 잇는 유일한 키는
    //    Staff.userId(1:1 unique, Prisma 관계 아님 — 컬럼 조인) 뿐이므로,
    //    여기서 계정 역할(role)과 계정 활성 여부(userActive)를 함께 실어 보낸다.
    //    (userId 는 원래 Staff 행에 이미 들어 있다 — 화면이 그걸 써야 한다)
    const userIds = staff.map((s) => s.userId).filter((v): v is string => !!v);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, role: true, isActive: true },
        })
      : [];
    const byUserId = new Map(users.map((u) => [u.id, u]));
    return staff.map((s) => {
      const u = s.userId ? byUserId.get(s.userId) : undefined;
      return {
        ...s,
        // 계정이 없는 직원은 role=null — 🔴 임의 추정 금지(모르는 것은 모른다고 말한다)
        role: u?.role ?? null,
        userActive: u?.isActive ?? null,
      };
    });
  }

  /**
   * 🔴 (2026-09-14 P3) 직원 상세의 `schedules` 는 옛 `StaffSchedule` 을 include 하고 있었다 — 쓰기 경로(setSchedule)는
   *    2026-07-22 모델 통합으로 이미 DutyEntry 로 옮겨져, 이 응답은 **쓰기가 끊긴 뒤 멈춘 낡은 근무표**를 보여줬다.
   *    읽기도 정본(DutyEntry + 승인 휴가 OFF 파생 = `buildUnifiedSchedules`)에서 조립한다. 응답 모양(최근 30건·날짜 내림차순·
   *    StaffSchedule 필드)은 유지한다. 옛 `staff_schedules` 행은 지우거나 옮기지 않는다(운영 행 수 미확인).
   */
  private async withUnifiedSchedules<T extends { id: string; userId: string | null; familyName: string; givenName: string; position: string | null; department: string | null }>(staff: T) {
    const rows = await this.buildUnifiedSchedules([staff]);
    const schedules = rows
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 30)
      .map(({ staff: _nested, ...row }) => row);
    return { ...staff, schedules };
  }

  /** 존재 확인만 — 변경 메서드가 근무표 조립 비용을 치르지 않게 */
  private async assertStaffExists(id: string) {
    const found = await this.prisma.staff.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Staff not found');
  }

  async findById(id: string) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException('Staff not found');
    return this.withUnifiedSchedules(staff);
  }

  async findByUserId(userId: string) {
    const staff = await this.prisma.staff.findUnique({ where: { userId } });
    if (!staff) throw new NotFoundException("Staff not found for this user");
    return this.withUnifiedSchedules(staff);
  }

  /** 보고라인(상급자 Staff) 설정 — 에스컬레이션 대상 산정(P1-7). null이면 해제. */
  async setManager(staffId: string, managerStaffId: string | null) {
    if (managerStaffId && managerStaffId === staffId) throw new BadRequestException('본인을 상급자로 지정할 수 없습니다');
    const target = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { id: true } });
    if (!target) throw new NotFoundException('직원을 찾을 수 없습니다');
    if (managerStaffId) {
      const mgr = await this.prisma.staff.findUnique({ where: { id: managerStaffId }, select: { id: true } });
      if (!mgr) throw new NotFoundException('상급자 직원을 찾을 수 없습니다');
      // 간접 순환 차단 — 상급자 체인을 타고 올라가며 자기(staffId) 도달 시 거부(A→B→A 등)
      let cursor: string | null = managerStaffId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === staffId) throw new BadRequestException('상급자 지정이 보고라인 순환을 만듭니다');
        if (seen.has(cursor)) break; // 기존 데이터 사이클이 있어도 무한루프 방지
        seen.add(cursor);
        const up: { managerStaffId: string | null } | null = await this.prisma.staff.findUnique({ where: { id: cursor }, select: { managerStaffId: true } });
        cursor = up?.managerStaffId ?? null;
      }
    }
    return this.prisma.staff.update({
      where: { id: staffId },
      data: { managerStaffId },
      select: { id: true, employeeNumber: true, managerStaffId: true },
    });
  }

  async create(data: {
    employeeNumber: string; familyName: string; givenName: string;
    category: StaffCategory; department: string; position: string;
    hireDate: string; licenseNumber?: string; specialty?: string;
    phone?: string; email?: string; userId?: string;
  }) {
    const existing = await this.prisma.staff.findUnique({ where: { employeeNumber: data.employeeNumber } });
    if (existing) throw new ConflictException('Employee number already exists');

    const staff = await this.prisma.staff.create({
      data: { ...data, hireDate: new Date(data.hireDate) },
    });
    this.emitStaff('staff.created', `hr:create:${staff.id}`, staff, { hireDate: staff.hireDate });
    return staff;
  }

  async update(id: string, data: Partial<{ department: string; position: string; phone: string; email: string; specialty: string }>) {
    await this.assertStaffExists(id);
    const staff = await this.prisma.staff.update({ where: { id }, data });
    this.emitStaff('staff.changed', `hr:update:${id}:${Date.now()}`, staff);
    return staff;
  }

  // 재직상태 변경(휴직 ON_LEAVE/복직 ACTIVE 등) — ERP 동기화용 staff.changed(status) 발행(staff-sync 2-b)
  async changeStatus(id: string, status: string, effectiveDate?: string) {
    assertEnumParam(status, EmploymentStatus, '상태');
    await this.assertStaffExists(id);
    const staff = await this.prisma.staff.update({ where: { id }, data: { status: status as EmploymentStatus } });
    this.emitStaff('staff.changed', `hr:status:${id}:${status}:${Date.now()}`, staff, { statusEffectiveFrom: effectiveDate ?? null });
    return staff;
  }

  async patch(id: string, data: Record<string, any>) {
    await this.assertStaffExists(id);
    // Allow only safe fields for partial update
    const allowedFields = ['department', 'position', 'phone', 'email', 'specialty', 'licenseNumber', 'clinicUserId', 'erpEmployeeCode'];
    const filtered: Record<string, any> = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        filtered[key] = data[key];
      }
    }
    if (Object.keys(filtered).length === 0) {
      return this.findById(id);
    }
    const staff = await this.prisma.staff.update({ where: { id }, data: filtered });
    this.emitStaff('staff.changed', `hr:patch:${id}:${Date.now()}`, staff);
    return staff;
  }

  async resign(id: string) {
    await this.assertStaffExists(id);
    const staff = await this.prisma.staff.update({ where: { id }, data: { status: 'RESIGNED', resignDate: new Date() } });
    this.emitStaff('staff.resigned', `hr:resign:${id}`, staff, { resignDate: staff.resignDate });
    return staff;
  }

  // ── 근무 스케줄 (정본=DutyEntry — 모델 이원화 통합 2026-07-22, OFF는 승인 LeaveRequest가 정본) ──

  async setSchedule(staffId: string, schedules: { date: string; shiftType: string; startTime?: string; endTime?: string }[]) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, userId: true, employeeNumber: true, erpEmployeeCode: true, familyName: true, givenName: true, department: true },
    });
    if (!staff) throw new NotFoundException('직원을 찾을 수 없습니다');
    if (!staff.userId) throw new BadRequestException('시스템 계정(User)이 연결되지 않은 직원은 근무표를 입력할 수 없습니다 — 계정 연결 후 재시도');
    const user = await this.prisma.user.findUnique({ where: { id: staff.userId }, select: { role: true, department: true } });
    const role = user?.role === 'DOCTOR' ? 'doctor' : 'nurse';

    for (const s of schedules) {
      const date = new Date(s.date);
      // 하루 1근무 의미 유지(구 StaffSchedule @@unique[staffId,date]) — 해당일 기존 배정 제거 후 재기록. OFF는 제거만.
      await this.prisma.dutyEntry.deleteMany({ where: { staffId: staff.userId, date } });
      if (s.shiftType !== 'OFF') {
        await this.prisma.dutyEntry.create({
          data: {
            date, shift: s.shiftType, staffId: staff.userId,
            staffName: `${staff.familyName}${staff.givenName}`,
            role, department: user?.department ?? staff.department ?? '미지정',
            startTime: s.startTime, endTime: s.endTime,
          },
        });
      }
    }
    // 근무 스케줄 → ERP 근태/급여 산정 입력 (계약 불변)
    void this.outbox.enqueue('hr', 'staff.schedule_changed', `hr:sched:${staffId}:${Date.now()}`, {
      staffId, employeeNumber: staff.employeeNumber, erpEmployeeCode: staff.erpEmployeeCode ?? null,
      schedules: schedules.map(x => ({ date: x.date, shiftType: x.shiftType, startTime: x.startTime, endTime: x.endTime })),
    });
    return { updated: schedules.length };
  }

  /** DutyEntry+승인 LeaveRequest(OFF 파생)를 구 StaffSchedule 응답 형태로 조립 — ERP 근태 계약 보존 */
  async buildUnifiedSchedules(
    staffRows: { id: string; userId: string | null; familyName: string; givenName: string; position: string | null; department: string | null }[],
    dateFrom?: Date, dateTo?: Date,
  ) {
    const byUserId = new Map(staffRows.filter(s => s.userId).map(s => [s.userId as string, s]));
    const userIds = [...byUserId.keys()];
    if (!userIds.length) return [];
    const dateWhere = (dateFrom || dateTo) ? { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } : undefined;

    const entries = await this.prisma.dutyEntry.findMany({
      where: { staffId: { in: userIds }, ...(dateWhere ? { date: dateWhere } : {}) },
      orderBy: { date: 'asc' },
    });
    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        userId: { in: userIds }, status: 'APPROVED',
        ...(dateTo ? { fromDate: { lte: dateTo } } : {}), ...(dateFrom ? { toDate: { gte: dateFrom } } : {}),
      },
      select: { id: true, userId: true, fromDate: true, toDate: true },
    });

    const rows = entries.map(e => {
      const st = byUserId.get(e.staffId)!;
      return {
        id: e.id, staffId: st.id, date: e.date, shiftType: e.shift,
        startTime: e.startTime, endTime: e.endTime, notes: e.notes, createdAt: e.createdAt,
        staff: { id: st.id, familyName: st.familyName, givenName: st.givenName, position: st.position, department: st.department },
      };
    });
    for (const l of leaves) {
      const st = byUserId.get(l.userId);
      if (!st) continue;
      const from = dateFrom && dateFrom > l.fromDate ? dateFrom : l.fromDate;
      const to = dateTo && dateTo < l.toDate ? dateTo : l.toDate;
      for (let t = from.getTime(); t <= to.getTime(); t += 86400_000) {
        const d = new Date(t);
        rows.push({
          id: `leave-off-${l.id}-${d.toISOString().slice(0, 10)}`, staffId: st.id, date: d, shiftType: 'OFF',
          startTime: null, endTime: null, notes: null, createdAt: d,
          staff: { id: st.id, familyName: st.familyName, givenName: st.givenName, position: st.position, department: st.department },
        });
      }
    }
    return rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.staff.familyName.localeCompare(b.staff.familyName));
  }

  async getSchedule(filters: { staffId?: string; department?: string; dateFrom: string; dateTo: string }) {
    const staffWhere: Prisma.StaffWhereInput = { userId: { not: null } };
    if (filters.staffId) staffWhere.id = filters.staffId;
    if (filters.department) staffWhere.department = { contains: filters.department, mode: 'insensitive' };
    const staffRows = await this.prisma.staff.findMany({
      where: staffWhere,
      select: { id: true, userId: true, familyName: true, givenName: true, position: true, department: true },
    });
    return this.buildUnifiedSchedules(staffRows, new Date(filters.dateFrom), new Date(filters.dateTo));
  }

  async getDepartmentList() {
    const departments = await this.prisma.staff.groupBy({ by: ['department'], where: { status: 'ACTIVE' }, _count: true });
    return departments.map(d => ({ department: d.department, staffCount: d._count }));
  }
}