import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { addMonths } from '../../common/day-range';
import type { AddCasePresentationDto, AddEpaAssessmentDto, AddLogbookEntryDto, AssignRotationDto } from './dto/education-training.dto';

/**
 * 무기한(갱신 불요) 이수 — `EducationProgram.validMonths = 0` 인 과정(예: 신규직원 오리엔테이션).
 *
 * 🔴 정본: **무기한 = `expiresAt === null`** (2026-08-18 스키마 nullable 전환).
 *    종전에는 컬럼이 NOT NULL 이라 `9999-12-31` 을 표식으로 우회했다. 그 값은
 *    "9999년에 만료된다"는 **틀린 사실**을 원장에 박은 것이었다 — 이제 쓰지 않는다.
 *
 * 🔴 `null` 을 "만료됨"이나 "만료 임박"으로 접으면 안 된다. 만료/임박 집계에서 **제외**하고
 *    화면에는 '무기한'으로 표시한다(`indefinite: true`).
 *
 * `LEGACY_INDEFINITE_MARKER` 는 **읽기 전용 하위호환**이다 — 전환 전 데이터에 남아 있을 수 있는
 * `9999-…` 행을 무기한으로 읽기 위해서만 존재하고, 새 기록에는 절대 쓰지 않는다.
 * (정리 SQL: `prisma/manual/education-indefinite-expiry-null-20260818.sql` — 적용은 사람)
 */
export const LEGACY_INDEFINITE_MARKER_YEAR = 9999;
/** @deprecated 쓰기 금지 — 무기한은 `null` 이다. 구 데이터 판정용으로만 남긴다. */
export const INDEFINITE_EXPIRES_AT = new Date('9999-12-31T23:59:59.999Z');

/** 무기한 판정 정본 — `null`(정본) 또는 구 `9999-…` 표식(레거시) */
export function isIndefiniteExpiry(d: Date | null | undefined): boolean {
  if (d === null || d === undefined) return true;
  return d.getUTCFullYear() >= LEGACY_INDEFINITE_MARKER_YEAR;
}

/** 만료/임박 목록 기본 상한 — 화면은 `total` 과 `truncated` 로 잘렸음을 반드시 말해야 한다. */
const EXPIRY_LIST_LIMIT_DEFAULT = 200;
const EXPIRY_LIST_LIMIT_MAX = 500;
/** 임박 지평선(일) */
const EXPIRY_HORIZON_DAYS = 30;

type StaffLite = { id: string; familyName: string; givenName: string; department: string; position: string; status: string };

export interface EducationExpiryItem {
  id: string;
  staffId: string;
  /** null = 직원 원장에서 찾지 못함(추정하지 않는다) */
  staffName: string | null;
  department: string | null;
  position: string | null;
  employmentStatus: string | null;
  programId: string;
  programName: string | null;
  programCategory: string | null;
  isMandatory: boolean;
  completedAt: Date;
  /** null = 무기한(갱신 불요) — '만료됨'이 아니다 */
  expiresAt: Date | null;
  /** true 면 만료 개념이 없다 — 화면은 날짜 대신 '무기한'을 표시한다 */
  indefinite: boolean;
  score: number | null;
  /** 음수 = 이미 실효된 경과일(만료). 0 이상 = 남은 일수(임박). null = 무기한(산출 불가) */
  daysLeft: number | null;
}

@Injectable()
export class EducationService {
  constructor(private readonly prisma: PrismaService) {}

  async getPrograms() { return this.prisma.educationProgram.findMany({ orderBy: { name: 'asc' } }); }

  async createProgram(data: { name: string; category: string; isMandatory: boolean; validMonths?: number }) {
    return this.prisma.educationProgram.create({ data });
  }

  async recordCompletion(data: { programId: string; staffId: string; score?: number }) {
    const program = await this.prisma.educationProgram.findUnique({ where: { id: data.programId } });
    // 🔴 종전엔 프로그램이 없어도 조용히 12개월을 부여해, 존재하지 않는 과정의 이수기록이 만들어졌다.
    if (!program) throw new NotFoundException('교육 프로그램을 찾을 수 없습니다');
    // 🔴 종전: `program?.validMonths ?? 12` — `0`(무기한·갱신 불요)은 nullish 가 아니라 그대로 통과했다.
    //    그 결과 `expiresAt = 등록 시각` 이 되어 **무기한 교육이 이수 즉시 만료**됐다(법정 교육 오탐의 원인).
    // 🔴 무기한(validMonths<=0)은 **null** 이다. 종전 `9999-12-31` 표식은 "9999년 만료"라는
    //    틀린 사실을 원장에 박았다(스키마 nullable 전환 2026-08-18).
    const validMonths = program.validMonths ?? 12;
    let expiresAt: Date | null;
    if (validMonths <= 0) {
      expiresAt = null;
    } else {
      // 🔴 이수증 유효기간도 말일에서 굴러가면 실제보다 길어진다
      expiresAt = addMonths(new Date(), validMonths);
    }
    return this.prisma.educationCompletion.create({ data: { ...data, completedAt: new Date(), expiresAt } });
  }

  async getStaffCompletions(staffId: string) {
    const rows = await this.prisma.educationCompletion.findMany({ where: { staffId }, include: { program: true }, orderBy: { completedAt: 'desc' } });
    // 무기한 표식을 그대로 내보내면 화면이 "9999.12.31 만료"를 찍는다 → 플래그로 사실을 말한다.
    return rows.map((r) => ({ ...r, indefinite: isIndefiniteExpiry(r.expiresAt) }));
  }

  /** staffId(=Staff.id) → 직원 최소 정보. EducationCompletion 에는 관계가 없어 별도 조회한다. */
  private async staffMapOf(staffIds: string[]): Promise<Map<string, StaffLite>> {
    const ids = [...new Set(staffIds)];
    if (!ids.length) return new Map();
    const rows = await this.prisma.staff.findMany({
      where: { id: { in: ids } },
      select: { id: true, familyName: true, givenName: true, department: true, position: true, status: true },
    });
    return new Map(rows.map((s) => [s.id, { ...s, status: String(s.status) } as StaffLite]));
  }

  private toExpiryItem(
    r: { id: string; staffId: string; programId: string; completedAt: Date; expiresAt: Date | null; score: number | null; program?: { name: string; category: string; isMandatory: boolean } | null },
    staff: Map<string, StaffLite>,
    now: Date,
  ): EducationExpiryItem {
    const s = staff.get(r.staffId) ?? null;
    // 🔴 무기한이면 남은 일수를 계산하지 않는다 — 0 도 큰 수도 사실이 아니다(산출 불가 = null).
    const indefinite = isIndefiniteExpiry(r.expiresAt);
    return {
      id: r.id,
      staffId: r.staffId,
      staffName: s ? `${s.familyName}${s.givenName}` : null,
      department: s?.department ?? null,
      position: s?.position ?? null,
      employmentStatus: s?.status ?? null,
      programId: r.programId,
      programName: r.program?.name ?? null,
      programCategory: r.program?.category ?? null,
      isMandatory: r.program?.isMandatory ?? false,
      completedAt: r.completedAt,
      expiresAt: indefinite ? null : r.expiresAt,
      indefinite,
      score: r.score,
      daysLeft: indefinite || !r.expiresAt ? null : Math.floor((r.expiresAt.getTime() - now.getTime()) / 86400000),
    };
  }

  /**
   * 법정 의무교육 만료 현황 — **이미 실효된 것(expired)과 앞으로 도래할 것(dueSoon)을 분리**한다.
   *
   * 🔴 종전 쿼리는 `expiresAt: { lte: now+30d }` 로 **하한이 없었다**. 그래서 7.5개월 전에 실효된
   *    기록까지 전부 "만료 임박"으로 묶여 배지에 261건이 떴고, 그 중 194건(74%)이 이미 실효 상태였다.
   *    법정 의무교육에서 **실효를 '임박'으로 완화 표기**하는 것은 위반 사실을 숨기는 것과 같다.
   * 🔴 종전엔 `take` 도 없어 261건을 전부 전송한 뒤 화면이 5건만 그리고 버렸다 → total/truncated 를 함께 낸다.
   * 🔴 종전엔 직원 이름이 응답에 아예 없었다(관계 부재) → Staff 조회로 붙인다. 못 찾으면 null(추정 금지).
   */
  async getExpiringSoon(limit = EXPIRY_LIST_LIMIT_DEFAULT) {
    const take = Math.min(Math.max(1, Math.floor(limit) || EXPIRY_LIST_LIMIT_DEFAULT), EXPIRY_LIST_LIMIT_MAX);
    const now = new Date();
    const horizon = new Date(now.getTime() + EXPIRY_HORIZON_DAYS * 86400000);
    // 🔴 무기한(expiresAt = null)은 만료도 임박도 아니다 — 두 집계 모두에서 제외된다.
    //    (`lt` / `gte` 비교는 SQL 에서 NULL 행을 걸러내고, 구 `9999-…` 표식도 지평선 밖이라 섞이지 않는다.)
    const expiredWhere = { expiresAt: { not: null, lt: now } };
    const dueSoonWhere = { expiresAt: { not: null, gte: now, lte: horizon } };

    const [expiredTotal, dueSoonTotal, expiredRows, dueSoonRows] = await Promise.all([
      this.prisma.educationCompletion.count({ where: expiredWhere }),
      this.prisma.educationCompletion.count({ where: dueSoonWhere }),
      this.prisma.educationCompletion.findMany({ where: expiredWhere, include: { program: true }, orderBy: { expiresAt: 'asc' }, take }),
      this.prisma.educationCompletion.findMany({ where: dueSoonWhere, include: { program: true }, orderBy: { expiresAt: 'asc' }, take }),
    ]);

    const staff = await this.staffMapOf([...expiredRows, ...dueSoonRows].map((r) => r.staffId));

    return {
      asOf: now.toISOString(),
      horizonDays: EXPIRY_HORIZON_DAYS,
      limit: take,
      expired: {
        total: expiredTotal,
        truncated: expiredTotal > expiredRows.length,
        items: expiredRows.map((r) => this.toExpiryItem(r, staff, now)),
      },
      dueSoon: {
        total: dueSoonTotal,
        truncated: dueSoonTotal > dueSoonRows.length,
        items: dueSoonRows.map((r) => this.toExpiryItem(r, staff, now)),
      },
    };
  }

  /**
   * 이수 기록 보유 현황 — **이수율이 아니다.**
   *
   * 🔴 화면에는 '대상자'·'이수율' 개념이 없었고, 기록이 1건도 없는 재직자 34명(38%)은 어디에도 안 보였다.
   *    그렇다고 이수율을 만들 수는 없다: `EducationProgram` 에 **대상 직종·부서 필드가 없어**
   *    "이 과정을 누가 들어야 하는가"(분모)를 정의할 데이터가 없다. 분모를 지어내지 않고,
   *    지금 확실히 아는 사실(재직자 수 / 그 중 기록 보유자 수 / 무기록자 명단)만 낸다.
   */
  async getCompletionCoverage(limit = EXPIRY_LIST_LIMIT_DEFAULT) {
    const take = Math.min(Math.max(1, Math.floor(limit) || EXPIRY_LIST_LIMIT_DEFAULT), EXPIRY_LIST_LIMIT_MAX);
    const now = new Date();
    const [activeStaff, grouped] = await Promise.all([
      this.prisma.staff.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, familyName: true, givenName: true, department: true, position: true },
        orderBy: [{ department: 'asc' }, { familyName: 'asc' }, { givenName: 'asc' }],
      }),
      this.prisma.educationCompletion.groupBy({ by: ['staffId'], _count: { id: true } }),
    ]);
    const withRecord = new Set(grouped.map((g) => g.staffId));
    const missing = activeStaff.filter((s) => !withRecord.has(s.id));

    return {
      asOf: now.toISOString(),
      activeStaffTotal: activeStaff.length,
      withAnyRecord: activeStaff.length - missing.length,
      withoutAnyRecord: missing.length,
      /** 🔴 null = 산출 불가(0 이 아니다). 이유는 아래 reason 이 화면에 그대로 표시된다. */
      completionRate: null as number | null,
      completionRateUnavailableReason:
        '대상자 지정 모델 부재 — 교육 프로그램에 대상 직종·부서가 없어 이수율의 분모(수강 대상자)를 정의할 수 없습니다',
      staffWithoutAnyRecord: {
        total: missing.length,
        truncated: missing.length > take,
        items: missing.slice(0, take).map((s) => ({
          staffId: s.id,
          staffName: `${s.familyName}${s.givenName}`,
          department: s.department,
          position: s.position,
        })),
      },
    };
  }

  // ── 수련 로그북(영속) ──

  async addLogbookEntry(userId: string, data: AddLogbookEntryDto) {
    return this.prisma.trainingLogbook.create({
      data: {
        userId,
        date: data.date ? new Date(data.date as string) : new Date(),
        category: (data.category as string) ?? 'PROCEDURE',
        procedureName: (data.procedureName as string) ?? null,
        icdCode: (data.icdCode as string) ?? null,
        role: (data.role as string) ?? 'ASSISTANT',
        supervisor: (data.supervisor as string) ?? null,
        department: (data.department as string) ?? null,
        patientAge: data.patientAge != null ? Number(data.patientAge) : null,
        complexity: (data.complexity as string) ?? 'MODERATE',
        outcome: (data.outcome as string) ?? 'SUCCESSFUL',
        reflection: (data.reflection as string) ?? null,
      },
    });
  }

  async getLogbook(userId: string, period?: string) {
    const where: { userId: string; date?: { gte: Date; lt: Date } } = { userId };
    if (period && /^\d{4}-\d{2}$/.test(period)) {
      const [y, m] = period.split('-').map(Number);
      where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
    }
    const entries = await this.prisma.trainingLogbook.findMany({ where, orderBy: { date: 'desc' }, take: 1000 });
    return {
      userId,
      period: period ?? 'ALL',
      entries: entries.map((e) => ({ ...e, date: e.date.toISOString().slice(0, 10) })),
      summary: {
        total: entries.length,
        procedures: entries.filter((e) => e.category === 'PROCEDURE').length,
        cases: entries.filter((e) => e.category === 'CASE').length,
        verified: entries.filter((e) => e.verified).length,
      },
    };
  }

  // ── EPA(영속) ──

  async addEpaAssessment(userId: string, data: AddEpaAssessmentDto) {
    return this.prisma.epaAssessment.create({
      data: {
        userId,
        epaNumber: (data.epaNumber as string) ?? 'EPA-0',
        epaTitle: (data.epaTitle as string) ?? null,
        entrustmentLevel: data.entrustmentLevel != null ? Number(data.entrustmentLevel) : 1,
        assessor: (data.assessor as string) ?? null,
        assessorRole: (data.assessorRole as string) ?? null,
        clinicalContext: (data.clinicalContext as string) ?? null,
        strengths: (data.strengths as string) ?? null,
        improvements: (data.improvements as string) ?? null,
        feedback: (data.feedback as string) ?? null,
      },
    });
  }

  async getEpaStatus(userId: string) {
    const rows = await this.prisma.epaAssessment.findMany({ where: { userId }, orderBy: { assessedAt: 'asc' } });
    // epaNumber별 집계: 현재레벨=최신 평가, 횟수=평가건수
    /**
     * 🔴 (2026-09-16 I4) 종전엔 `targetLevel: 5` 를 **코드가 지어내** 각 EPA 의 목표인 양 응답에 실었다 —
     *    `EpaAssessment` 스키마에 목표 레벨 컬럼 자체가 없다(있는 것은 `entrustmentLevel` 1~5 뿐).
     *    수련 목표는 수련부·평가위원회가 정하는 원내 정책이지 서버가 만들 값이 아니다(지어낸 기준값 금지).
     *    → 목표를 응답에서 빼고, 목표가 없으므로 **진행률도 만들지 않는다**(`null` + 사유).
     *    `currentLevel`·`assessmentCount` 는 실제로 기록된 사실이라 그대로 낸다.
     */
    const map = new Map<string, { epaNumber: string; title: string; currentLevel: number; assessmentCount: number }>();
    for (const r of rows) {
      const cur = map.get(r.epaNumber) ?? { epaNumber: r.epaNumber, title: r.epaTitle ?? '', currentLevel: 0, assessmentCount: 0 };
      cur.currentLevel = r.entrustmentLevel; // 최신(정렬 asc → 마지막이 최신)
      if (r.epaTitle) cur.title = r.epaTitle;
      cur.assessmentCount += 1;
      map.set(r.epaNumber, cur);
    }
    const epas = [...map.values()].sort((a, b) => a.epaNumber.localeCompare(b.epaNumber));
    return {
      userId,
      epas,
      /** 🔴 목표 레벨 정본이 없으므로 달성률을 만들지 않는다 — 표본 부재(`평가 0건`)와도 구분해 사유를 밝힌다 */
      overallProgress: null as number | null,
      overallProgressUnavailableReason: epas.length
        ? 'EPA 목표 레벨 정본이 없습니다(수련부 결정 필요) — 달성률을 산출할 수 없습니다'
        : '등록된 EPA 평가가 없습니다(표본 0) — 달성률을 산출할 수 없습니다',
      assessedEpaCount: epas.length,
    };
  }

  // ── 로테이션(영속) ──

  async getRotations() {
    return this.prisma.trainingRotation.findMany({ orderBy: { startDate: 'desc' }, take: 500 });
  }

  async assignRotation(data: AssignRotationDto) {
    return this.prisma.trainingRotation.create({
      data: {
        residentId: (data.residentId as string) ?? '-',
        residentName: (data.residentName as string) ?? '-',
        department: (data.department as string) ?? '미지정',
        startDate: (data.startDate as string) ?? '',
        endDate: (data.endDate as string) ?? '',
        supervisor: (data.supervisor as string) ?? null,
        objectives: (data.objectives ?? []) as never,
      },
    });
  }

  // ── 증례 발표(영속) ──

  async addCasePresentation(data: AddCasePresentationDto) {
    return this.prisma.casePresentation.create({
      data: {
        title: (data.title as string) ?? '(제목없음)',
        presenter: (data.presenter as string) ?? null,
        department: (data.department as string) ?? null,
        presentationDate: data.presentationDate ? new Date(data.presentationDate as string) : new Date(),
        caseType: (data.caseType as string) ?? 'CLINICAL',
        diagnosis: (data.diagnosis as string) ?? null,
        summary: (data.summary as string) ?? null,
        learningPoints: (data.learningPoints ?? []) as never,
        attendees: (data.attendees ?? []) as never,
        feedback: (data.feedback as string) ?? null,
      },
    });
  }

  async getCasePresentations(dept?: string) {
    const rows = await this.prisma.casePresentation.findMany({ where: dept ? { department: dept } : {}, orderBy: { presentationDate: 'desc' }, take: 500 });
    return rows.map((r) => ({ ...r, presentationDate: r.presentationDate.toISOString().slice(0, 10) }));
  }

  // ── 수련 통계 대시보드(영속 집계) ──

  async getTrainingStats(userId: string) {
    const [logs, epas, rotations, cases] = await Promise.all([
      this.prisma.trainingLogbook.findMany({ where: { userId } }),
      this.prisma.epaAssessment.findMany({ where: { userId } }),
      this.prisma.trainingRotation.findMany({ where: { residentId: userId } }),
      this.prisma.casePresentation.count({ where: { presenter: userId } }),
    ]);
    // 🔴 (2026-09-17 L4) EPA 신뢰수준은 1~5 척도다 — 평가 0 건에 `0` 을 주면 **어떤 실제 평가보다 낮은 값**이
    //    수련 통계에 실린다(J3 가 만족도 avgScore·컨시어지 avgRating 에서 고친 것과 같은 모양).
    const avgLevel = epas.length ? Math.round(epas.reduce((s, e) => s + e.entrustmentLevel, 0) / epas.length * 10) / 10 : null;
    // 당직 시간(영속된 duty_entries 연계)
    const dutyRows = await this.prisma.dutyEntry.findMany({ where: { staffId: userId }, take: 500 });
    const dutyHours = dutyRows.reduce((s, e) => s + (e.shift === 'NIGHT' ? 10 : 8), 0);
    const weeks = Math.max(1, new Set(dutyRows.map((e) => e.date.toISOString().slice(0, 7))).size * 4);
    return {
      userId,
      logbook: {
        totalEntries: logs.length,
        procedures: logs.filter((l) => l.category === 'PROCEDURE').length,
        cases: logs.filter((l) => l.category === 'CASE').length,
        lectures: logs.filter((l) => l.category === 'LECTURE').length,
        conferences: logs.filter((l) => l.category === 'CONFERENCE').length,
        verified: logs.filter((l) => l.verified).length,
        pendingVerification: logs.filter((l) => !l.verified).length,
      },
      epa: { totalAssessments: epas.length, averageLevel: avgLevel },
      rotations: { total: rotations.length },
      casePresentations: cases,
      dutyHours: { total: dutyHours, weeklyAverage: Math.round(dutyHours / weeks) },
    };
  }
}
