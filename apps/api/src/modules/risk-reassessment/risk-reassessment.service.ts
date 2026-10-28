import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { readRiskReassessIntervals } from '../nursing-rules/nursing-rules.read';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  type AssessmentType,
  type RiskLevel,
  DEFAULT_TOOL_BY_TYPE,
  initialIntervalHours,
  deriveRiskLevel,
  intervalHoursFor,
  isAssessmentType,
  AUTO_SCHEDULE_ON_ASSESSMENT_KEY,
} from './risk-reassessment.policy';
import { CreateRiskScheduleDto, RecordAssessmentDto } from './dto/risk-reassessment.dto';
import { BRADEN_REASSESSMENT_TOOL_VERSION, bradenTotalOf, joinPatientName, readBradenSubscores } from '@hospital-run/shared';

const PATIENT_SELECT = { id: true, mrn: true, familyName: true, givenName: true } as const;

/** overdue 목록의 계약 — FE 는 이 이름만 읽는다(id / overdueMinutes / lastScore / lastRiskLevel). */
export interface OverdueScheduleView {
  id: string;
  patientId: string;
  assessmentType: string;
  toolName: string;
  intervalHours: number;
  nextDueAt: Date;
  lastScore: number | null;
  lastRiskLevel: string | null;
  /** 서버 기준 경과 분 — 클라이언트 시계에 의존하지 않는다 */
  overdueMinutes: number;
  patient?: { id: string; mrn: string; familyName: string; givenName: string } | null;
}

@Injectable()
export class RiskReassessmentService {
  private readonly logger = new Logger(RiskReassessmentService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    /** 자동 일정 결정 두 가지를 통계 응답에 함께 싣는다(화면이 켜짐/꺼짐을 말한다) — 미주입이면 null(모름) */
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** 위험 재평가 기한 초과 능동 감시 — 매시간. overdue 건을 risk.reassessment.overdue로 emit. */
  @Cron(CronExpression.EVERY_HOUR)
  async monitorOverdue() {
    try {
      const overdue = await this.getOverdue();
      for (const s of overdue) {
        this.events.emit('risk.reassessment.overdue', {
          patientId: s.patientId, scheduleId: s.id, assessmentType: s.assessmentType,
        });
      }
      if (overdue.length) this.logger.log;
    } catch (e) {
      this.logger.warn(`재평가 기한초과 Cron 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async createSchedule(dto: CreateRiskScheduleDto) {
    const assessmentType = dto.assessmentType as AssessmentType;
    // 주기·도구 기본값은 정본(policy)에서만 — 여기서 숫자를 새로 적지 않는다
    // 주기 = 원내 규정(설정 nursing.riskReassess.intervalHours · 비면 코드 기본값) · 2026-10-27
    const intervalHours = dto.intervalHours ?? initialIntervalHours(assessmentType, (await readRiskReassessIntervals(this.config)).table);
    const nextDueAt = new Date(Date.now() + intervalHours * 60 * 60 * 1000);

    return this.prisma.riskReassessmentSchedule.create({
      data: {
        patientId: dto.patientId,
        admissionId: dto.admissionId,
        assessmentType,
        toolName: dto.toolName || DEFAULT_TOOL_BY_TYPE[assessmentType],
        intervalHours,
        nextDueAt,
        isActive: true,
      },
    });
  }

  async getSchedules(filters: {
    patientId?: string;
    assessmentType?: string;
    overdue?: boolean;
  }) {
    const where: Prisma.RiskReassessmentScheduleWhereInput = {};
    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.assessmentType) where.assessmentType = filters.assessmentType;
    if (filters.overdue) {
      where.isActive = true;
      where.nextDueAt = { lt: new Date() };
    }

    return this.prisma.riskReassessmentSchedule.findMany({
      where,
      orderBy: { nextDueAt: 'asc' },
      include: { patient: { select: PATIENT_SELECT } },
    });
  }

  async getScheduleById(id: string) {
    const schedule = await this.prisma.riskReassessmentSchedule.findUnique({
      where: { id },
      include: { patient: { select: PATIENT_SELECT } },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  /**
   * 재평가 기록.
   * 🔴 원 결함 3종을 여기서 봉합한다.
   *   ② FE 가 보내는 필드는 `totalScore` 인데 서버는 `score` 를 읽었다 → 점수 undefined.
   *      Prisma 필수컬럼이라 저장은 100% 실패했고, 설령 통과해도 `undefined >= 45` 가 false 라
   *      **고위험 환자가 전건 LOW** 로 기록됐다. 이제 DTO 가 강제하고, 아래에서 한 번 더 방어한다.
   *   ③ 위험등급·주기 산출을 정본(policy) 한 곳으로 모았다. PRESSURE_ULCER 도 재산정한다.
   *   + 항목별 점수(`scores`)가 `factors` 로 저장되지 않고 `[]` 로 버려지던 것(법정기록의 근거 유실).
   *   + PRESSURE_ULCER 인데도 fall_risk_assessments 에 행을 만들던 것(Braden 점수를 낙상평가로 기록).
   */
  async recordAssessment(scheduleId: string, dto: RecordAssessmentDto & { assessedBy: string }) {
    const schedule = await this.prisma.riskReassessmentSchedule.findUnique({
      where: { id: scheduleId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');

    const score = dto.totalScore;
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      // 점수 없이 등급을 만들어내지 않는다 — 모르면 거부한다
      throw new BadRequestException('평가 총점(totalScore)이 없어 재평가를 기록할 수 없습니다.');
    }

    if (!isAssessmentType(schedule.assessmentType)) {
      // 정본에 없는 평가 유형은 등급/주기를 추정하지 않는다
      throw new BadRequestException(`지원하지 않는 평가 유형입니다: ${schedule.assessmentType}`);
    }
    const assessmentType: AssessmentType = schedule.assessmentType;
    // 🔴 (2026-10-07) DTO 는 유형 구분 없이 0~200 만 막아 Braden 99(→ LOW · 실제보다 안전하게 판정)·Morse 130 이 저장됐다
    const [lo, hi] = assessmentType === 'FALL_RISK' ? [0, 125] : [6, 23];
    if (!Number.isInteger(score) || score < lo || score > hi) {
      throw new BadRequestException(assessmentType === 'FALL_RISK' ? 'Morse 점수는 0~125 정수여야 합니다.' : 'Braden 점수는 6~23 정수여야 합니다.');
    }
    // 🔴 (2026-10-10) Braden 하위 항목을 다 보냈는데 합이 총점과 다르면 거부 — 어느 쪽이 사실인지 서버가 고르지 않는다
    if (assessmentType === 'PRESSURE_ULCER' && dto.scores) {
      const { scores, invalid } = readBradenSubscores(dto.scores);
      if (invalid.length) throw new BadRequestException({ code: 'BRADEN_SUBSCORE_RANGE', message: 'Braden 항목 점수가 범위를 벗어났습니다.', details: { items: invalid } });
      const sum = bradenTotalOf(scores);
      if (sum != null && sum !== score) throw new BadRequestException({ code: 'BRADEN_SUM_MISMATCH', message: 'Braden 항목 합이 총점과 다릅니다.', details: { sum, total: score } });
    }
    const riskLevel: RiskLevel = deriveRiskLevel(assessmentType, score);
    const newIntervalHours = intervalHoursFor(assessmentType, riskLevel, (await readRiskReassessIntervals(this.config)).table);
    const nextDueAt = new Date(Date.now() + newIntervalHours * 60 * 60 * 1000);

    // 항목별 점수는 근거이므로 그대로 보존(빈 객체로 대체 금지)
    const factors = (dto.scores ?? {}) as Prisma.InputJsonValue;
    const interventions = (dto.interventions ?? []) as Prisma.InputJsonValue;

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.riskReassessmentSchedule.update({
        where: { id: scheduleId },
        data: {
          lastScore: score,
          lastRiskLevel: riskLevel,
          lastAssessedAt: new Date(),
          lastAssessedBy: dto.assessedBy,
          intervalHours: newIntervalHours,
          nextDueAt,
        },
      }),
    ];

    // 🔴 낙상 평가만 fall_risk_assessments 에 남긴다.
    //    이전에는 욕창(Braden 6~23) 점수도 같은 테이블에 들어가 Morse(0~125)와 섞였다.
    //    욕창 전용 정본 테이블은 아직 없어(스키마 수정은 이 배치 범위 밖) 스케줄에만 기록한다.
    if (assessmentType === 'FALL_RISK') {
      ops.push(
        this.prisma.fallRiskAssessment.create({
          data: {
            patientId: schedule.patientId,
            assessorId: dto.assessedBy,
            score,
            riskLevel,
            factors,
            interventions,
            assessedAt: new Date(),
          },
        }),
      );
    }

    // 🔴 (2026-10-10) 욕창 재평가는 일정의 '마지막 점수'만 덮어써 이력이 남지 않았고 하위 항목은 버려졌다.
    //    전용 표 없이 기존 임상 도구 결과 원장(chartId BRADEN — 하위 항목·평가자·시각을 담는 표)에 같은 트랜잭션으로 남긴다.
    if (assessmentType === 'PRESSURE_ULCER') {
      const u = await this.prisma.user.findUnique({ where: { id: dto.assessedBy }, select: { familyName: true, givenName: true } });
      ops.push(
        this.prisma.clinicalChartResult.create({
          data: {
            patientId: schedule.patientId,
            chartId: 'BRADEN',
            chartName: 'Braden Scale',
            archetype: 'scoring',
            sourceVersion: null,
            inputs: { scores: (dto.scores ?? null) as Prisma.InputJsonValue, scheduleId } as Prisma.InputJsonValue,
            resultValue: score,
            resultLevel: riskLevel,
            performedBy: dto.assessedBy,
            performedByName: (u ? joinPatientName(u.familyName, u.givenName) : '') || '미상',
            usedToolVersion: BRADEN_REASSESSMENT_TOOL_VERSION,
          },
        }),
      );
    }

    const [updatedSchedule, assessment] = await this.prisma.$transaction(ops);

    // 낙상이면 두 번째 행 = 낙상 평가 · 욕창이면 두 번째 행 = Braden 이력 행
    return { schedule: updatedSchedule, assessment: assessment ?? null };
  }

  /**
   * 재원 종료(퇴원·전원·입원취소) 시 그 입원의 활성 스케줄을 일괄 종료.
   * 🔴 퇴원 후에도 활성으로 남으면 매시간 Cron 이 주치의에게 기한초과를 무한 발송한다.
   *    게이트(`risk.reassessment.autoCreate`)와 무관하게 항상 돈다 — 수동 생성분도 닫아야 한다.
   */
  async deactivateByAdmission(admissionId: string): Promise<number> {
    const { count } = await this.prisma.riskReassessmentSchedule.updateMany({
      where: { admissionId, isActive: true },
      data: { isActive: false },
    });
    return count;
  }

  async deactivate(id: string) {
    const schedule = await this.prisma.riskReassessmentSchedule.findUnique({ where: { id } });
    if (!schedule) throw new NotFoundException('Schedule not found');

    return this.prisma.riskReassessmentSchedule.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * 지연 목록.
   * 🔴 FE 는 `scheduleId` / `overdueMinutes` 를 읽는데 서버는 스케줄 원본(=`id`)만 돌려줬다.
   *    그래서 '지금 평가' 버튼이 `/schedules/undefined/assess` 를 눌러 ParseUUIDPipe 400,
   *    지연 시간은 항상 공백이었다. 경과 분은 **서버 시계**로 계산해서 함께 내려준다.
   */
  async getOverdue(): Promise<OverdueScheduleView[]> {
    const now = new Date();
    const rows = await this.prisma.riskReassessmentSchedule.findMany({
      where: { isActive: true, nextDueAt: { lt: now } },
      orderBy: { nextDueAt: 'asc' },
      include: { patient: { select: PATIENT_SELECT } },
    });
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      assessmentType: r.assessmentType,
      toolName: r.toolName,
      intervalHours: r.intervalHours,
      nextDueAt: r.nextDueAt,
      lastScore: r.lastScore,
      lastRiskLevel: r.lastRiskLevel,
      overdueMinutes: Math.max(0, Math.floor((now.getTime() - r.nextDueAt.getTime()) / 60000)),
      patient: r.patient ?? null,
    }));
  }

  /**
   * 통계.
   * 🔴 FE 가 `riskDistribution` 을 읽는데 서버가 내려주지 않아, FE 로컬 폴백이
   *    존재하지 않는 필드(`riskLevel`)로 세면서 **위험도 분포가 영구 전건 0** 이었다(P1/P17).
   *    서버가 실제로 집계해 내려준다. 표본이 없으면 0 이 아니라 `hasSample:false` 로 알린다.
   */
  async getStats() {
    const [activeSchedules, overdueCount, byType, byRisk] = await Promise.all([
      this.prisma.riskReassessmentSchedule.count({ where: { isActive: true } }),
      this.prisma.riskReassessmentSchedule.count({
        where: { isActive: true, nextDueAt: { lt: new Date() } },
      }),
      this.prisma.riskReassessmentSchedule.groupBy({
        by: ['assessmentType'],
        where: { isActive: true },
        _count: { id: true },
      }),
      this.prisma.riskReassessmentSchedule.groupBy({
        by: ['lastRiskLevel'],
        where: { isActive: true, lastRiskLevel: { not: null } },
        _count: { id: true },
      }),
    ]);

    return {
      /** 🔴 표본 부재를 "지연 0건"으로 읽지 못하게 하는 플래그 — 화면은 이 값으로 '산출 불가'를 판단한다 */
      hasSample: activeSchedules > 0,
      activeSchedules,
      overdueCount,
      /** 아직 한 번도 평가되지 않은 활성 스케줄 수(위험도 분포의 분모 밖) */
      neverAssessed: activeSchedules - byRisk.reduce((n, r) => n + r._count.id, 0),
      byType: byType.reduce(
        (acc, t) => ({ ...acc, [t.assessmentType]: t._count.id }),
        {} as Record<string, number>,
      ),
      riskDistribution: byRisk.reduce(
        (acc, r) => (r.lastRiskLevel ? { ...acc, [r.lastRiskLevel]: r._count.id } : acc),
        {} as Record<string, number>,
      ),
      policy: await this.autoSchedulePolicy(),
    };
  }

  /**
   * 일정 자동 생성 결정 두 가지(2026-10-10) — 켜짐/꺼짐 그대로. 설정 미주입이면 null(모름 — "꺼짐"이라 말하지 않는다).
   *  · onAssessment — 간호초기평가 저장 때 점수로 일정을 연다(`nursing.reassessment.autoScheduleOnAdmission`)
   *  · onAdmission — 입원 순간 저위험 주기로 연다(`risk.reassessment.autoCreate` · 종전 게이트)
   */
  private async autoSchedulePolicy(): Promise<{ onAssessment: boolean | null; onAdmission: boolean | null }> {
    if (!this.config) return { onAssessment: null, onAdmission: null };
    const [a, b] = await Promise.all([this.config.get(AUTO_SCHEDULE_ON_ASSESSMENT_KEY), this.config.get('risk.reassessment.autoCreate')]);
    return { onAssessment: a === true, onAdmission: b === true };
  }

  /**
   * 입원 시 낙상+욕창 재평가 스케줄 자동 생성.
   * 호출처 = `RiskReassessmentListener` (`admission.created`) — config `risk.reassessment.autoCreate`
   * 게이트 뒤에 있다(주기 표가 환자안전위원회 미확정 잠정값이라 기본 OFF).
   *    같은 환자·같은 입원에 두 번 불려도 스케줄이 중복 생성되지 않도록 멱등하다.
   */
  async autoCreateOnAdmission(patientId: string, admissionId: string) {
    const existing = await this.prisma.riskReassessmentSchedule.findMany({
      where: { patientId, admissionId, isActive: true },
      select: { assessmentType: true },
    });
    const have = new Set(existing.map((e) => e.assessmentType));

    const toCreate = (['FALL_RISK', 'PRESSURE_ULCER'] as AssessmentType[]).filter((t) => !have.has(t));
    if (!toCreate.length) return [];
    const { table } = await readRiskReassessIntervals(this.config);

    return this.prisma.$transaction(
      toCreate.map((assessmentType) =>
        this.prisma.riskReassessmentSchedule.create({
          data: {
            patientId,
            admissionId,
            assessmentType,
            toolName: DEFAULT_TOOL_BY_TYPE[assessmentType],
            intervalHours: initialIntervalHours(assessmentType, table),
            nextDueAt: new Date(Date.now() + initialIntervalHours(assessmentType, table) * 60 * 60 * 1000),
            isActive: true,
          },
        }),
      ),
    );
  }
}
