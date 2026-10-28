import { readRestraintInterval, readRiskReassessIntervals } from '../nursing-rules/nursing-rules.read';
import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger, Optional } from '@nestjs/common';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { identityVerdict, identityReasonForStore, IDENTITY_PROBLEM_CODE, IDENTITY_PROBLEM_MESSAGE } from '../../common/identity-check-verdict';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABEL,
  foldSeverityCounts,
  foldTypeCounts,
  incidentTypeLabel,
  isEscalatingSeverity,
  normalizeIncidentSeverity,
  normalizeIncidentType,
  rawSeverityAliases,
  rawTypeAliases,
  scoreNews2,
  isVerbalOrder,
  INCIDENT_STATUS_TRANSITIONS,
  KOPS_REPORT_STATUS,
  kopsReportStatusOf,
  harmLevelsOf,
  incidentTransitionNeedsReason,
  isIncidentStatus,
  VERBAL_ORDER_SOURCES,
  type IncidentSeverity,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UpsertRcaDto } from './dto/rca.dto';
import {
  SAFETY_INCIDENT_INTERNAL_SELECT,
  SAFETY_INCIDENT_PUBLIC_SELECT,
  stripReporter,
} from './patient-safety.select';
import { CRITICAL_ALERT_OPEN_STATUSES } from '../lab/critical-value-alert-states';
import { deriveRiskLevel, intervalHoursFor } from '../risk-reassessment/risk-reassessment.policy';

/**
 * 사건을 읽는 사람 — **누가 보는가에 따라 보이는 범위가 다르다.**
 * `canReviewAll` = `safety:incident:review` 보유(환자안전 전담인력 업무).
 * 없으면 **본인이 보고한 건만** 보인다(환자안전법 §16·§17).
 */
export interface IncidentViewer {
  userId: string;
  canReviewAll: boolean;
}

/** RCA 가 아직 '완료(승인)'되지 않은 상태 — 기한초과 크론(monitorRcaDue)과 동일 집합. */
const RCA_OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED'] as const;

@Injectable()
export class PatientSafetyService {
  private readonly logger = new Logger(PatientSafetyService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** 신체보호대 점검 지연(점검 간격 초과 — 설정 키 · 코드 기본값 120분)·처방 만료 능동 감시 — 30분 주기. overdue 건을 restraint.overdue로 emit. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async monitorRestraints() {
    try {
      const active = await this.getActiveRestraints();
      let flagged = 0;
      for (const r of active) {
        if (!r.overdue) continue;
        flagged++;
        this.events.emit('restraint.overdue', {
          patientId: r.patientId, orderId: r.id,
          reason: r.expired ? 'ORDER_EXPIRED' : 'MONITORING_OVERDUE',
          lastCheckMinutesAgo: r.lastCheckMinutesAgo,
        });
      }
      if (flagged) this.logger.log;
    } catch (e) {
      this.logger.warn(`보호대 모니터링 Cron 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async reportIncident(data: { patientId?: string; reporterId: string; type: string; severity: string; description: string; location?: string; occurredAt: string; wardId?: string; harmLevel?: string; anonymous?: boolean }) {
    // 저장 severity는 원본 유지(기존 기록 변조 금지). 정규화는 판정·표시에만 사용.
    // 🔴 생성 응답에도 `reporterId` 를 담지 않는다 — 보고자 신원이 나가는 경로를 **하나도** 남기지 않는다.
    const { anonymous, harmLevel, wardId, ...rest } = data;
    // 위해 정도 — 척도가 정해졌을 때만, 그 척도의 값만(결정 safety.harmLevelScale · 어휘를 지어내지 않는다)
    if (harmLevel) {
      const levels = harmLevelsOf(await this.cfg('safety.harmLevelScale'));
      if (!levels) throw new BadRequestException({ code: 'SAFETY_HARM_SCALE_UNSET', message: '위해 정도 척도가 정해지지 않았습니다(결정 safety.harmLevelScale) — 비워 두고 보고하십시오' });
      if (!levels.includes(harmLevel)) throw new BadRequestException({ code: 'SAFETY_HARM_LEVEL', message: '이 척도에 없는 위해 정도입니다', details: { allowed: levels } });
    }
    // 익명 — 허용됐을 때만(결정 safety.anonymousReport). 익명이면 보고자를 원장에 남기지 않는다(본인도 다시 찾을 수 없다)
    if (anonymous && (await this.cfg('safety.incident.anonymous')) !== true) {
      throw new BadRequestException({ code: 'SAFETY_ANONYMOUS_DISABLED', message: '익명 보고가 허용되지 않았습니다(결정 safety.anonymousReport)' });
    }
    if (wardId) {
      const w = await this.prisma.ward.findUnique({ where: { id: wardId }, select: { id: true } });
      if (!w) throw new BadRequestException({ code: 'SAFETY_WARD', message: '병동을 찾을 수 없습니다' });
    }
    const incident = await this.prisma.safetyIncident.create({
      data: {
        ...rest, occurredAt: new Date(data.occurredAt),
        reporterId: anonymous ? null : rest.reporterId,
        anonymous: !!anonymous, harmLevel: harmLevel ?? null, wardId: wardId ?? null,
      },
      select: SAFETY_INCIDENT_PUBLIC_SELECT,
    });
    // 적신호/치명 사건 — 질관리·경영진·주치의 능동 통지(JCI QPS.7). 기존: 낙상과 달리 통보 0.
    //
    // 🔴 종전 private `normalizeSeverity` 를 shared 정본으로 교체(2026-08-14·W7).
    //    서버·화면·QI 보드가 심각도 어휘를 각자 정의해 **세 벌**로 갈라져 있었다.
    //    통지 범위는 종전과 **동일**(SENTINEL || CRITICAL = `isEscalatingSeverity`) —
    //    표시를 고치면서 통지 대상을 조용히 넓히지 않는다.
    if (isEscalatingSeverity(data.severity)) {
      this.events.emit('incident.critical', {
        incidentId: incident.id,
        patientId: incident.patientId ?? undefined,
        severity: normalizeIncidentSeverity(data.severity),
        type: incident.type,
      });
    }
    return { ...incident, reportedByMe: !anonymous, typeLabel: incidentTypeLabel(incident.type) };
  }

  private async cfg(key: string): Promise<unknown> {
    try { return this.config ? await this.config.get(key) : null; } catch { return null; }
  }

  // ── 근본원인분석(RCA·P2-G) ──
  /**
   * 🔴 `data` 를 `Record<string, unknown>` 으로 받던 것을 DTO 타입으로 바꿨다.
   *    컨트롤러가 인라인 `@Body() body: Record<string, unknown>` 이면 런타임 metatype 이
   *    `Object` 라 **ValidationPipe 가 통째로 스킵**된다(v4.3.0 처방 EP 와 동일 결함).
   */
  async createRca(incidentId: string, data: UpsertRcaDto, userId: string) {
    const inc = await this.prisma.safetyIncident.findUnique({ where: { id: incidentId }, select: { id: true } });
    if (!inc) throw new NotFoundException('안전사건을 찾을 수 없습니다');
    const dueAt = data.dueAt ? new Date(data.dueAt) : new Date(Date.now() + 45 * 86400000); // 기본 45일
    const payload = {
      findings: data.findings ?? undefined,
      contributingFactors: (data.contributingFactors ?? []) as unknown as Prisma.InputJsonValue,
      actionPlan: (data.actionPlan ?? []) as unknown as Prisma.InputJsonValue,
      owner: data.owner ?? userId,
      dueAt,
      status: data.status ?? 'OPEN',
    };
    return this.prisma.rcaReport.upsert({
      where: { incidentId },
      create: { incidentId, ...payload },
      update: payload,
    });
  }

  async updateRca(incidentId: string, data: UpsertRcaDto) {
    const rca = await this.prisma.rcaReport.findUnique({ where: { incidentId } });
    if (!rca) throw new NotFoundException('RCA를 찾을 수 없습니다');
    // 🔴 승인된 RCA 는 더 이상 고치지 않는다 — 승인 이후의 무단 수정은 법정기록 변조다.
    if (rca.status === 'APPROVED') throw new BadRequestException('승인된 RCA 는 수정할 수 없습니다');
    const upd: Prisma.RcaReportUpdateInput = {};
    if (data.findings !== undefined) upd.findings = data.findings || null;
    if (data.contributingFactors !== undefined) upd.contributingFactors = data.contributingFactors as unknown as Prisma.InputJsonValue;
    if (data.actionPlan !== undefined) upd.actionPlan = data.actionPlan as unknown as Prisma.InputJsonValue;
    // 🔴 `APPROVED` 는 DTO 에서 차단 — 승인은 approveRca 만(승인자·승인시각·rcaCompleted 동시 기록).
    if (data.status !== undefined) upd.status = data.status;
    if (data.dueAt !== undefined) upd.dueAt = data.dueAt ? new Date(data.dueAt) : null;
    return this.prisma.rcaReport.update({ where: { incidentId }, data: upd });
  }

  /** RCA 승인(완료) — SafetyIncident.rcaCompleted 연동. */
  async approveRca(incidentId: string, userId: string) {
    const rca = await this.prisma.rcaReport.findUnique({ where: { incidentId } });
    if (!rca) throw new NotFoundException('RCA를 찾을 수 없습니다');
    const [updated] = await this.prisma.$transaction([
      this.prisma.rcaReport.update({ where: { incidentId }, data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date() } }),
      this.prisma.safetyIncident.update({ where: { id: incidentId }, data: { rcaCompleted: true } }),
    ]);
    return updated;
  }

  async getRca(incidentId: string) {
    const rca = await this.prisma.rcaReport.findUnique({ where: { incidentId } });
    if (!rca) return null;
    const [enriched] = await this.enrichRca([rca]);
    return enriched;
  }

  async listRca(status?: string) {
    const rows = await this.prisma.rcaReport.findMany({ where: status ? { status } : {}, orderBy: { dueAt: 'asc' }, take: 200 });
    return this.enrichRca(rows);
  }

  /**
   * RCA 행에 원 사건을 붙이고 기한 경과를 계산한다.
   *
   * 🔴 RCA 를 **볼 화면이 없었다**(2026-08-14·W7). 조회 EP(`GET /safety/rca`,
   *    `GET /safety/incidents/:id/rca`)와 승인 EP 는 있는데 부르는 FE 가 0건이라,
   *    45일 기한 초과 크론이 `rca.overdue` 를 쏴도 열어볼 데가 없었고 대시보드의
   *    "RCA 완료 0"만 영구 고정돼 있었다. 화면이 사건 맥락 없이 RCA 만 보면 쓸 수 없으므로
   *    (FK relation 미사용 모델이라) 수동 조인해서 내려준다.
   */
  private async enrichRca(rows: Array<{ incidentId: string; dueAt: Date | null; status: string; [k: string]: unknown }>) {
    const ids = [...new Set(rows.map((r) => r.incidentId))];
    const incidents = ids.length
      ? await this.prisma.safetyIncident.findMany({
          where: { id: { in: ids } },
          select: { id: true, type: true, severity: true, description: true, location: true, occurredAt: true, status: true, rcaCompleted: true },
        })
      : [];
    const imap = new Map(incidents.map((i) => [i.id, i]));
    const now = Date.now();
    return rows.map((r) => {
      const inc = imap.get(r.incidentId) ?? null;
      const open = (RCA_OPEN_STATUSES as readonly string[]).includes(r.status);
      const level = inc ? normalizeIncidentSeverity(inc.severity) : null;
      return {
        ...r,
        // 승인 완료 건은 기한이 지났어도 '초과'가 아니다(크론 판정과 동일 집합)
        overdue: open && !!r.dueAt && r.dueAt.getTime() < now,
        daysToDue: r.dueAt ? Math.ceil((r.dueAt.getTime() - now) / 86400000) : null,
        incident: inc
          ? {
            ...inc,
            severityLevel: level,
            severityLabel: level ? INCIDENT_SEVERITY_LABEL[level] : null,
            typeLabel: incidentTypeLabel(inc.type),
          }
          : null, // 🔴 사건이 지워졌으면 null — 빈 껍데기를 만들지 않는다
      };
    });
  }

  /** RCA 45일 기한 초과 능동 감시 — 매일. 초과 미완료 건을 rca.overdue로 emit. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async monitorRcaDue() {
    try {
      const overdue = await this.prisma.rcaReport.findMany({ where: { status: { in: [...RCA_OPEN_STATUSES] }, dueAt: { lt: new Date() } } });
      for (const r of overdue) this.events.emit('rca.overdue', { rcaId: r.id, incidentId: r.incidentId, owner: r.owner ?? undefined });
      if (overdue.length) this.logger.log;
    } catch (e) {
      this.logger.warn(`RCA 기한 Cron 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * 정본 등급 하나로 필터할 때 DB 에서 찾아야 할 원본 문자열 후보(대/소문자 변형 포함).
   * 🔴 `severity` 는 enum 이 아니라 자유 문자열이라 `severity = 'MINOR'` 만으로는
   *    실제 저장된 `LOW` 를 놓친다.
   */
  private severityRawVariants(level: IncidentSeverity): string[] {
    return [...new Set(rawSeverityAliases(level).flatMap((a) => [a, a.toLowerCase()]))];
  }

  /** 정본 유형 하나로 필터할 때 DB 에서 찾아야 할 원본 문자열 후보(대/소문자 변형 포함). */
  private typeRawVariants(raw: string): string[] | null {
    const t = normalizeIncidentType(raw);
    if (!t) return null; // 정본 미등재 — 저장값 그대로 찾는다(사람이 직접 넣은 문자열일 수 있다)
    return [...new Set(rawTypeAliases(t).flatMap((a) => [a, a.toLowerCase()]))];
  }

  async getIncidents(filters: { type?: string; severity?: string; status?: string }, viewer: IncidentViewer) {
    const where: Prisma.SafetyIncidentWhereInput = {};
    /**
     * 🔴 종전에는 화면이 보낸 문자열을 그대로 `type = ?` 로 걸었다. 심각도에서 이미 한 번 겪은
     *    것과 **같은 결함**이 유형에도 있었다 — 드롭다운 어휘(MEDICATION·IDENTIFICATION·
     *    PRESSURE_INJURY)와 저장값(MEDICATION_ERROR·PATIENT_ID·PRESSURE_ULCER)이 달라
     *    운영 75건 중 **40건(53%)이 유형으로 조회조차 불가**했다.
     *    → shared 정본으로 접은 뒤 그 유형의 원본 문자열 후보 전부를 `in` 으로 찾는다.
     */
    if (filters.type) {
      const variants = this.typeRawVariants(filters.type);
      where.type = variants ? { in: variants } : filters.type;
    }
    if (filters.status) where.status = filters.status;
    /**
     * 🔴 종전에는 화면이 보낸 문자열을 그대로 `severity = ?` 로 걸었다(2026-08-14·W7).
     *    화면 드롭다운 어휘(NEAR_MISS·MINOR·MODERATE·SEVERE·SENTINEL)와 저장값(LOW·MODERATE…)이
     *    달라 저장된 `LOW` 2건은 **중증도로 조회조차 불가**했다.
     *    → 정본 등급으로 접은 뒤 그 등급의 원본 문자열 후보 전부를 `in` 으로 찾는다.
     */
    if (filters.severity) {
      const level = normalizeIncidentSeverity(filters.severity);
      if (level === 'UNSPECIFIED') {
        // 미분류 = 어떤 정본 등급에도 매핑되지 않는 저장값. 알려진 후보를 모두 제외해서 찾는다.
        const known = INCIDENT_SEVERITIES.flatMap((s) => this.severityRawVariants(s));
        where.severity = { notIn: known };
      } else {
        where.severity = { in: this.severityRawVariants(level) };
      }
    }
    /**
     * 🔴 열람 범위 — 전담인력이 아니면 **본인이 보고한 건만**.
     *    종전에는 보고 가능한 의사·간호사 전원이 전건을 읽었다(환자안전법 §16 비밀 유지).
     */
    if (!viewer.canReviewAll) where.reporterId = viewer.userId;

    /**
     * 🔴 `select` 없는 `findMany` 는 스칼라 전체(= `reporterId`)를 응답에 싣는다.
     *    보고자 신원은 **응답에 실리지 않는다**(§17). 내부 select 로 뽑아 비교에만 쓰고
     *    `stripReporter` 로 걷어낸다.
     */
    const rows = await this.prisma.safetyIncident.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      select: SAFETY_INCIDENT_INTERNAL_SELECT,
    });
    return rows.map((r) => ({
      ...stripReporter(r, viewer.userId),
      typeLabel: incidentTypeLabel(r.type),
    }));
  }

  /**
   * 사고 처리 상태 전이 — 🔴 2026-10-08 종전엔 어떤 문자열이든 어떤 순서든 저장됐다(순서는 화면 버튼에만).
   * 전이표·사유 필수 여부는 shared 정본 하나. 읽은 상태 그대로일 때만 바꾼다(동시 조작 409).
   */
  async updateIncidentStatus(id: string, status: string, actionTaken?: string, actorId?: string) {
    if (!isIncidentStatus(status)) throw new BadRequestException({ code: 'INCIDENT_STATUS_UNKNOWN', message: '알 수 없는 사고 상태입니다.', details: { status } });
    const cur = await this.prisma.safetyIncident.findUnique({ where: { id }, select: { status: true, reviewedAt: true } });
    if (!cur) throw new NotFoundException('안전사건을 찾을 수 없습니다');
    const from = cur.status;
    if (!isIncidentStatus(from) || !INCIDENT_STATUS_TRANSITIONS[from].includes(status)) {
      throw new ConflictException({ code: 'INCIDENT_STATUS_SEQUENCE', message: '이 상태에서는 그 단계로 바꿀 수 없습니다.', details: { from, to: status, allowed: isIncidentStatus(from) ? INCIDENT_STATUS_TRANSITIONS[from] : [] } });
    }
    const reason = actionTaken?.trim();
    if (incidentTransitionNeedsReason(from, status) && !reason) {
      throw new BadRequestException({ code: 'INCIDENT_STATUS_REASON_REQUIRED', message: '이 단계로 바꾸려면 조치 내역(사유)을 적어야 합니다.', details: { from, to: status } });
    }
    const moved = await this.prisma.safetyIncident.updateMany({
      where: { id, status: from },
      data: {
        status, ...(reason ? { actionTaken: reason } : {}),
        // 첫 검토(REPORTED → 조사·종료) 시각·검토자 — 다시 조사로 돌아와도 첫 시각은 그대로(검토 소요 지표의 분자)
        ...(from === 'REPORTED' && !cur.reviewedAt ? { reviewedAt: new Date(), reviewerId: actorId ?? null } : {}),
        ...(status === 'CLOSED' ? { closedAt: new Date(), closedBy: actorId ?? null } : {}),
      },
    });
    if (moved.count === 0) throw new ConflictException({ code: 'INCIDENT_STATUS_RACE', message: '다른 사용자가 먼저 상태를 바꿨습니다 — 새로고침 후 다시 시도하세요.' });
    // 🔴 `update` 도 select 가 없으면 스칼라 전체(= reporterId)를 돌려준다.
    return this.prisma.safetyIncident.findUnique({ where: { id }, select: SAFETY_INCIDENT_PUBLIC_SELECT });
  }

  /**
   * 낙상(Morse) 평가 저장 정본 — 2026-10-07.
   * 🔴 이 경로(간호 워크스테이션·안전 화면)로 저장한 평가는 **재평가 일정을 갱신하지 않았다** — 방금 평가한 환자가
   *    `/risk-reassessment/overdue` 에 계속 "지연"으로 남았다(거짓 경보 · 재평가 준수율 산출 불가).
   *    → 평가 원장 기록과 그 환자의 활성 Morse 재평가 일정 갱신을 **한 트랜잭션**으로. 등급·주기는 재평가 정본 정책 하나(임계 사본 제거).
   * Morse 0~125 밖 점수는 거부한다(불가능한 값이 등급을 만들지 않게).
   */
  private async persistFallAssessment(data: { patientId: string; assessorId: string; score: number; factors: unknown; interventions?: unknown }) {
    if (!Number.isInteger(data.score) || data.score < 0 || data.score > 125) {
      throw new BadRequestException('Morse 낙상 점수는 0~125 정수여야 합니다.');
    }
    const riskLevel = deriveRiskLevel('FALL_RISK', data.score);
    const now = new Date();
    // 주기 = 원내 규정(비면 코드 기본값) · 2026-10-27
    const { table: intervals } = await readRiskReassessIntervals(this.config);
    const nextDueAt = new Date(now.getTime() + intervalHoursFor('FALL_RISK', riskLevel, intervals) * 3_600_000);
    const [created, sched] = await this.prisma.$transaction([
      this.prisma.fallRiskAssessment.create({
        data: {
          patientId: data.patientId,
          assessorId: data.assessorId,
          score: data.score,
          riskLevel,
          factors: data.factors as Prisma.InputJsonValue,
          interventions: (data.interventions ?? undefined) as Prisma.InputJsonValue | undefined,
          assessedAt: now,
        },
      }),
      // 소아(Humpty Dumpty) 일정은 Morse 점수로 갱신하지 않는다 — 도구가 다르다
      this.prisma.riskReassessmentSchedule.updateMany({
        where: { patientId: data.patientId, isActive: true, assessmentType: 'FALL_RISK', toolName: 'MORSE' },
        data: { lastScore: data.score, lastRiskLevel: riskLevel, lastAssessedAt: now, lastAssessedBy: data.assessorId, intervalHours: intervalHoursFor('FALL_RISK', riskLevel, intervals), nextDueAt },
      }),
    ]);
    // 고위험 시 주치의 능동 통지(낙상 예방 트리거) — notification.listener가 소비
    if (riskLevel === 'HIGH') {
      this.events.emit('fall.high', { patientId: data.patientId, assessmentId: created.id, score: data.score });
    }
    return { ...created, schedulesUpdated: sched.count };
  }

  async assessFallRisk(data: { patientId: string; assessorId: string; score: number; riskLevel?: string; factors: any; interventions?: any }) {
    // 자가입력 riskLevel 은 무시한다 — 서버 정본이 점수로 정한다(IPSG 집계 오염 방지)
    return this.persistFallAssessment({ patientId: data.patientId, assessorId: data.assessorId, score: data.score, factors: data.factors, interventions: data.interventions });
  }

  async getPatientFallRisk(patientId: string) {
    return this.prisma.fallRiskAssessment.findMany({ where: { patientId }, orderBy: { assessedAt: 'desc' }, take: 5 });
  }

  /**
   * 안전사건 통계.
   *
   * 🔴 이 응답이 화면과 어긋나 있던 것 3가지를 한꺼번에 봉합한다(2026-08-14·W7).
   *  1) `bySeverity` 를 groupBy 원본 문자열 그대로 내려 화면 하드코딩 5키가 훑다가
   *     저장된 `LOW` 2건을 흘렸다("총 사고 3"인데 막대 합 1). → shared `foldSeverityCounts` 로
   *     **서버가 접어서** 내려보낸다(저장값은 변형하지 않음).
   *  2) 대시보드 위젯이 읽던 `falls`·`medication`·`thisMonth` 키가 응답에 **아예 없어**
   *     4칸 중 3칸이 영구 `-` 였다(P11). → 실제로 계산해서 내려준다.
   *  3) 기간 표기가 없어 `/safety`(전 기간)와 `/safety-quality-board`(30일)가
   *     같은 '사건 수'를 다른 숫자로 말했다. → `period` 를 함께 내려 화면이 밝히게 한다.
   */
  async getIncidentStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [byTypeRows, bySeverityRows, byStatusRows, last180Rows, total, rcaCompleted, rcaPending, thisMonth] = await Promise.all([
      this.prisma.safetyIncident.groupBy({ by: ['type'], _count: { id: true } }),
      this.prisma.safetyIncident.groupBy({ by: ['severity'], _count: { id: true } }),
      this.prisma.safetyIncident.groupBy({ by: ['status'], _count: { id: true } }),
      this.prisma.safetyIncident.groupBy({
        by: ['type'],
        _count: { id: true },
        where: { occurredAt: { gte: new Date(now.getTime() - 180 * 86400000) } },
      }),
      this.prisma.safetyIncident.count(),
      this.prisma.safetyIncident.count({ where: { rcaCompleted: true } }),
      this.prisma.rcaReport.count({ where: { status: { in: [...RCA_OPEN_STATUSES] } } }),
      this.prisma.safetyIncident.count({ where: { occurredAt: { gte: monthStart } } }),
    ]);

    /**
     * 🔴 유형도 심각도와 같이 **서버가 접어서** 보낸다. 화면이 로컬 `Record` 로 라벨을
     *    재정의하던 것(FE 표현 단위 규약 위반)이 어휘 분기의 원인이었다.
     *    정본 미등재 저장값은 버리지 않고 `type:null` + 원본 라벨로 남긴다.
     */
    const byType = foldTypeCounts(byTypeRows.map((r) => ({ type: r.type, count: r._count.id })));
    const byStatus = byStatusRows.map((r) => ({ status: r.status, count: r._count.id }));
    const bySeverity = foldSeverityCounts(bySeverityRows.map((r) => ({ severity: r.severity, count: r._count.id })));
    const sevCount = (level: IncidentSeverity) => bySeverity.find((s) => s.severity === level)?.count ?? 0;
    const typeCount = (...types: string[]) => byType.filter((t) => t.type !== null && types.includes(t.type)).reduce((a, t) => a + t.count, 0);

    return {
      /** 🔴 이 통계의 기간 — 화면이 반드시 함께 표기한다(전 기간 누적) */
      period: { scope: 'ALL_TIME' as const, label: '전 기간 누적', since: null },
      total,
      rcaCompleted,
      /** 진행 중(미승인) RCA — "RCA 완료 0"만 보이던 화면에 '하는 중'이 보이도록 */
      rcaPending,
      /** 즉시 통지 대상(= isEscalatingSeverity 와 동일 집합: 위해·적신호) */
      escalating: sevCount('CRITICAL') + sevCount('SENTINEL'),
      /** 중대 이상(중대·위해·적신호) — 종전 화면은 SEVERE+SENTINEL 두 키만 세어 MAJOR·HIGH 를 흘렸다 */
      majorOrAbove: sevCount('MAJOR') + sevCount('CRITICAL') + sevCount('SENTINEL'),
      /** 분류되지 않은 사건 — 0 이 아니라 '모른다'로 드러낸다 */
      unspecified: sevCount('UNSPECIFIED'),
      falls: typeCount('FALL'),
      medication: typeCount('MEDICATION_ERROR'), // 정본으로 접은 뒤라 MEDICATION 별칭은 여기 합산돼 있다
      /** 이번 달(1일 00:00~) 발생 건 — 위젯이 읽던 키 */
      thisMonth,
      thisMonthSince: monthStart,
      byType,
      bySeverity,
      byStatus,
      /** 최근 180일 유형별 — 종전 키 이름이 `monthly` 였으나 월별 집계가 아니다(이름이 거짓말) */
      byTypeLast180d: foldTypeCounts(last180Rows.map((r) => ({ type: r.type, count: r._count.id }))),
      reviewLag: await this.reviewLag(now),
    };
  }

  /**
   * 보고 → 첫 검토 소요(QI 흐름 2026-10-08) — 최근 180일 보고 중 첫 검토 시각이 남은 건만(기록 시작 이전 사고는 분모에 없다).
   * 🔴 표본 0 이면 null(산출 불가) · 아직 검토 안 된 건은 따로 센다(분모를 숨기지 않는다).
   */
  private async reviewLag(now: Date) {
    const since = new Date(now.getTime() - 180 * 86400000);
    const [rows, pending] = await Promise.all([
      this.prisma.safetyIncident.findMany({ where: { createdAt: { gte: since }, reviewedAt: { not: null } }, select: { createdAt: true, reviewedAt: true } }),
      this.prisma.safetyIncident.count({ where: { createdAt: { gte: since }, reviewedAt: null, status: 'REPORTED' } }),
    ]);
    const hours = rows.map((r) => (r.reviewedAt!.getTime() - r.createdAt.getTime()) / 3_600_000).filter((h) => h >= 0).sort((x, y) => x - y);
    const q = (p: number) => (hours.length ? hours[Math.min(hours.length - 1, Math.floor(p * (hours.length - 1)))] : null);
    return { since, n: hours.length, pendingReview: pending, medianHours: q(0.5), p90Hours: q(0.9) };
  }

  async getIncidentById(id: string, viewer: IncidentViewer) {
    const row = await this.prisma.safetyIncident.findUnique({ where: { id }, select: SAFETY_INCIDENT_INTERNAL_SELECT });
    if (!row) throw new NotFoundException('안전사건을 찾을 수 없습니다');
    // 🔴 전담인력이 아니면 본인 보고 건만. 존재 자체를 알려주지 않는다(404 로 통일).
    // 🔴 2026-10-09 — 익명 보고(보고자 null)를 전담인력에게도 404 로 막던 조건을 고쳤다(익명 사고를 아무도 못 열었다).
    //    비전담은 여전히 본인 보고만 · 익명 건은 본인도 다시 찾을 수 없다(보고자를 남기지 않았으므로)
    if (!viewer.canReviewAll && (!row.reporterId || row.reporterId !== viewer.userId)) {
      throw new NotFoundException('안전사건을 찾을 수 없습니다');
    }
    // 대외 보고(KOPS)는 송신 코드가 없다 — "보고됨"을 지어내지 않고 원내 기록뿐임을 함께 준다
    return { ...stripReporter(row, viewer.userId), typeLabel: incidentTypeLabel(row.type), externalReport: kopsReportStatusOf(row) };
  }

  /**
   * KOPS 직접 보고 기록(2026-10-09) — 송신 채널이 없는 동안 사람이 KOPS 웹에 보고한 사실을 남긴다.
   * 🔴 기관 접수를 시스템이 확인하지 않는다(사람이 적은 번호) · 한 번(정정은 별도 경로 없음 — 같은 건에 두 번호를 겹쳐 쓰지 않는다)
   */
  async recordKopsManual(id: string, dto: { ref: string; reportedAt: string }, actorId: string) {
    const ref = dto.ref?.trim();
    if (!ref || ref.length < 3) throw new BadRequestException({ code: 'KOPS_REF_REQUIRED', message: 'KOPS 접수번호를 입력해주세요' });
    const at = new Date(dto.reportedAt);
    if (Number.isNaN(at.getTime())) throw new BadRequestException({ code: 'KOPS_REPORTED_AT', message: '보고 시각 형식이 올바르지 않습니다' });
    if (at.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException({ code: 'KOPS_REPORTED_AT', message: '미래 시각은 기록할 수 없습니다' });
    const inc = await this.prisma.safetyIncident.findUnique({ where: { id }, select: { occurredAt: true } });
    if (!inc) throw new NotFoundException('안전사건을 찾을 수 없습니다');
    if (at < inc.occurredAt) throw new BadRequestException({ code: 'KOPS_REPORTED_AT', message: '보고 시각이 사고 발생보다 이릅니다' });
    const r = await this.prisma.safetyIncident.updateMany({ where: { id, kopsManualRef: null }, data: { kopsManualRef: ref, kopsManualAt: at, kopsManualBy: actorId } });
    if (!r.count) throw new ConflictException({ code: 'KOPS_ALREADY_RECORDED', message: '이미 KOPS 직접 보고가 기록된 건입니다' });
    const row = await this.prisma.safetyIncident.findUnique({ where: { id }, select: SAFETY_INCIDENT_PUBLIC_SELECT });
    return { ...row, externalReport: kopsReportStatusOf(row!) };
  }

  // ── NEWS2 조기경보점수 ──
  // 🔴 채점 정본은 shared `scoreNews2`(RCP 2017) 하나다 — 이 파일에 점수표를 다시 적지 않는다.
  //    (2026-08-19 수렴 전에는 채점판이 네 벌이었고 위험등급 밴드가 서로 달랐다.)
  //    점수 밴드는 국제 표준이라 활력 임계 통합(vitals-evaluate)에서 의도적으로 제외한다 — 위원회 재량이 아니다.

  /**
   * @deprecated 새 코드는 shared `scoreNews2` 를 직접 쓴다. 기존 호출부 호환을 위한 얇은 위임.
   * 🔴 7요소가 전부 관측된 경우에만 산출된다 — 관측 부족이면 예외를 던진다(0점으로 저장하지 않는다).
   */
  calculateNews2(params: {
    respiratoryRate: number; spO2: number; supplementalO2: boolean; spO2Scale: number;
    systolicBp: number; heartRate: number; consciousness: string; temperature: number;
  }) {
    const result = scoreNews2({ ...params, spO2Scale: params.spO2Scale === 2 ? 2 : 1 });
    if (!result) {
      throw new BadRequestException(
        'NEWS2 는 7요소(호흡수·SpO₂·보충산소·수축기혈압·맥박·의식(ACVPU)·체온)가 모두 관측된 경우에만 산출됩니다.',
      );
    }
    return {
      totalScore: result.totalScore,
      riskLevel: result.riskLevel,
      escalationRequired: result.escalationRequired,
      scoreBreakdown: result.scoreBreakdown,
    };
  }

  async calculateAndSaveEws(patientId: string, nurseId: string, params: {
    respiratoryRate: number; spO2: number; supplementalO2: boolean; spO2Scale?: number;
    systolicBp: number; heartRate: number; consciousness: string; temperature: number;
  }) {
    const result = this.calculateNews2({ ...params, spO2Scale: params.spO2Scale ?? 1 });

    const ews = await this.prisma.earlyWarningScore.create({
      data: {
        patientId, nurseId,
        respiratoryRate: params.respiratoryRate,
        spO2: params.spO2,
        supplementalO2: params.supplementalO2,
        spO2Scale: params.spO2Scale ?? 1,
        systolicBp: params.systolicBp,
        heartRate: params.heartRate,
        consciousness: params.consciousness,
        temperature: params.temperature,
        totalScore: result.totalScore,
        riskLevel: result.riskLevel,
        scoreBreakdown: result.scoreBreakdown as never,
        escalationRequired: result.escalationRequired,
        recordedAt: new Date(),
      },
    });

    // 만성질환 측정 미러링(P1) — EWS 혈압을 ChronicObservation(context=ACUTE)으로 합류
    this.events.emit('ews.recorded', { patientId, ewsId: ews.id, systolicBp: params.systolicBp, recordedAt: ews.recordedAt, riskLevel: result.riskLevel, totalScore: result.totalScore, escalationRequired: result.escalationRequired });

    return { ews, ...result };
  }

  async getPatientEws(patientId: string) {
    return this.prisma.earlyWarningScore.findMany({
      where: { patientId },
      orderBy: { recordedAt: 'desc' },
      take: 50,
    });
  }

  async getHighRiskEws() {
    // escalationRequired 기준(HIGH·MEDIUM·단일3점) — LOW_MEDIUM red-flag가 대시보드에서 누락되던 것 교정.
    return this.prisma.earlyWarningScore.findMany({
      where: { escalationRequired: true, recordedAt: { gte: new Date(Date.now() - 24 * 3600000) } },
      include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
      orderBy: { totalScore: 'desc' },
    });
  }

  // ── 환자 식별 체크 ──

  /**
   * 🔴 (2026-09-15) 본문의 `result` 를 그대로 기록했다 — `{verifiedItems:{}, result:'PASS'}` 가 대조 없는 PASS 로
   *    IPSG.1 식별률 분자에 들어갔고, `{name:false}` 에 PASS 를 선언해도 PASS 였다. 판정은 eligibility 본인확인과
   *    같은 정본(`common/identity-check-verdict.ts`)이 대조 항목에서 유도한다.
   */
  async createIdCheck(data: { patientId: string; checkType: string; method: string; verifiedItems: Record<string, boolean>; verifiedBy: string; result: string; failureReason?: string; encounterId?: string; admissionId?: string }) {
    const outcome = identityVerdict(data, { method: data.method });
    if (outcome.problem) {
      throw new BadRequestException({ error: IDENTITY_PROBLEM_CODE[outcome.problem], message: IDENTITY_PROBLEM_MESSAGE[outcome.problem] });
    }
    return this.prisma.patientIdentificationCheck.create({
      data: {
        patientId: data.patientId,
        checkType: data.checkType,
        method: data.method,
        verifiedItems: outcome.items as never,
        verifiedBy: data.verifiedBy,
        verifiedAt: new Date(),
        result: outcome.verdict,
        failureReason: identityReasonForStore(outcome),
        encounterId: data.encounterId,
        admissionId: data.admissionId,
      },
    });
  }

  async getPatientIdChecks(patientId: string) {
    return this.prisma.patientIdentificationCheck.findMany({
      where: { patientId },
      include: { verifier: { select: { familyName: true, givenName: true } } },
      orderBy: { verifiedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * 환자 식별 통계 (IPSG.1) — 식별률·오류율, 유형/방법별, 최근 오류.
   *
   * 🔴 관측이 0건일 때 "성공률 0%"와 "오류 없음 ✓"을 동시에 말하던 것(P17·2026-08-14 W7).
   *    `rate(n, 0)` 이 **0 을 반환**해 `verifyRate: 0`(초록 카드)·`failRate: 0`·빈 `recentFailures`
   *    가 함께 나왔고, 화면은 "최근 30일 식별 오류가 없습니다 ✓"라고 안심시켰다.
   *    실제 `patient_identification_checks` 는 **전체 0행** — 사실은 "환자확인이 한 건도
   *    기록되지 않음"이다. 표본이 없으면 비율은 0 이 아니라 **`null`(산출 불가)**.
   */
  async getIdCheckStats(params: { dateFrom?: string; dateTo?: string }) {
    const where: any = {};
    const defaultWindowDays = 30;
    const custom = !!(params.dateFrom || params.dateTo);
    if (custom) {
      where.verifiedAt = {};
      if (params.dateFrom) where.verifiedAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.verifiedAt.lte = new Date(params.dateTo);
    } else {
      where.verifiedAt = { gte: new Date(Date.now() - defaultWindowDays * 86400000) };
    }

    const checks = await this.prisma.patientIdentificationCheck.findMany({
      where,
      select: { checkType: true, method: true, result: true },
    });
    const total = checks.length;
    const fail = checks.filter((c) => c.result === 'FAIL').length;
    /** 표본(분모) 0 → `null` = 산출 불가. 0% 라고 단정하지 않는다. */
    const rate = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

    const TYPE_LABEL: Record<string, string> = { ADMISSION: '입원', PROCEDURE: '시술', MEDICATION: '투약', TRANSFUSION: '수혈', SPECIMEN: '검체' };
    const METHOD_LABEL: Record<string, string> = { WRISTBAND: '팔찌', VERBAL: '구두', BARCODE: '바코드', TWO_IDENTIFIER: '두식별자' };

    const groupFail = (keyFn: (c: typeof checks[number]) => string, labels: Record<string, string>) => {
      const m = new Map<string, { fail: number; total: number }>();
      for (const c of checks) {
        const k = keyFn(c);
        const e = m.get(k) ?? { fail: 0, total: 0 };
        e.total++; if (c.result === 'FAIL') e.fail++;
        m.set(k, e);
      }
      return Array.from(m.entries()).map(([key, v]) => ({ key, label: labels[key] ?? key, fail: v.fail, total: v.total, failRate: rate(v.fail, v.total) }));
    };

    // 최근 식별 오류 5건 (사유 포함)
    const recentFailures = await this.prisma.patientIdentificationCheck.findMany({
      where: { ...where, result: 'FAIL' },
      orderBy: { verifiedAt: 'desc' },
      take: 5,
      select: { checkType: true, method: true, failureReason: true, verifiedAt: true, patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });

    return {
      window: {
        days: custom ? null : defaultWindowDays,
        from: where.verifiedAt?.gte ?? null,
        to: where.verifiedAt?.lte ?? null,
        label: custom ? '지정 기간' : `최근 ${defaultWindowDays}일`,
      },
      /** 🔴 표본이 없으면 "오류 없음"이 아니라 "관측 없음" — 화면이 이 플래그로 갈라야 한다 */
      hasObservations: total > 0,
      overall: { total, pass: total - fail, fail, verifyRate: rate(total - fail, total), failRate: rate(fail, total) },
      byType: groupFail((c) => c.checkType, TYPE_LABEL),
      byMethod: groupFail((c) => c.method, METHOD_LABEL),
      recentFailures: recentFailures.map((f) => ({
        checkType: TYPE_LABEL[f.checkType] ?? f.checkType,
        method: METHOD_LABEL[f.method] ?? f.method,
        reason: f.failureReason,
        verifiedAt: f.verifiedAt,
        patient: f.patient ? `${f.patient.familyName}${f.patient.givenName} (${f.patient.mrn})` : null,
      })),
    };
  }

  // ── Read-back 확인 ──

  /**
   * 구두·전화 처방 복창(read-back) **미확인 목록** — IPSG.2 / 의료법 시행규칙(구두처방 사후 확인).
   *
   * 🔴 이 목록이 없어서 "복창하지 않은 구두처방"은 **아무 화면에도 나타나지 않았다.**
   *    발행 화면(`PrescriberDelegate`)의 체크박스는 그 순간에만 물어보고, 체크하지 않고 저장한 건은
   *    그대로 사라졌다. 확인 EP(`PATCH read-back/:id`)는 호출부가 0이었다 — 부를 화면이 없었기 때문이다.
   *    **잔여 작업의 정본 표현은 사라지는 알림이 아니라 줄어드는 목록이다.**
   *
   * 🔴 분모는 구두·전화 지시뿐이다. 서면 지시에는 복창 개념 자체가 없으므로 세지 않는다.
   *    어휘는 shared `VERBAL_ORDER_SOURCES` 한 벌에서 온다(발행 경로가 쓰는 것과 같은 정본).
   */
  async getPendingReadBacks(limit = 100) {
    const rows = await this.prisma.prescription.findMany({
      where: {
        orderSource: { in: [...VERBAL_ORDER_SOURCES] },
        readBackConfirmedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true, createdAt: true, orderSource: true, type: true,
        dosage: true, frequency: true, route: true, instructions: true,
        createdBy: true, prescriberId: true,
        medicationCode: { select: { code: true, nameKo: true } },
        procedureCode: { select: { code: true, nameKo: true } },
        encounter: { select: { id: true, patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } } },
      },
    });

    // 입력자·책임처방의 이름 — 목록에서 "누가 받아 적었나"를 모르면 복창을 요청할 수 없다
    const userIds = [...new Set(rows.flatMap((r) => [r.createdBy, r.prescriberId]).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, familyName: true, givenName: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() || null]));

    const now = Date.now();
    return {
      items: rows.map((r) => ({
        id: r.id,
        orderSource: r.orderSource,
        type: r.type,
        drug: r.medicationCode?.nameKo ?? r.procedureCode?.nameKo ?? null,
        dosage: r.dosage, frequency: r.frequency, route: r.route, instructions: r.instructions,
        createdAt: r.createdAt,
        // 🔴 경과 시간을 서버가 계산해 내려준다(화면마다 다시 계산하면 갈라진다)
        elapsedHours: Math.floor((now - r.createdAt.getTime()) / 3600000),
        enteredByName: nameOf.get(r.createdBy) ?? null,
        prescriberName: r.prescriberId ? (nameOf.get(r.prescriberId) ?? null) : null,
        patient: r.encounter?.patient
          ? { id: r.encounter.patient.id, name: `${r.encounter.patient.familyName ?? ''}${r.encounter.patient.givenName ?? ''}`, mrn: r.encounter.patient.mrn }
          : null,
      })),
      // 🔴 잘랐으면 잘랐다고 말한다
      truncated: rows.length >= Math.min(Math.max(limit, 1), 200),
    };
  }

  /**
   * 구두·전화 처방 복창 확인 기록.
   *
   * 🔴 **자동으로 통과시키지 않는다.** 확인하는 시각은 지금이고(소급 입력 없음), 확인한 사람은 호출자다.
   *    발행 시점에 확인하지 못한 건을 나중에 확인하는 것은 정당한 경로이지만, `createdAt` 과
   *    `readBackConfirmedAt` 의 간격이 그 사실을 그대로 드러낸다 — 지우는 것이 아니라 남기는 것이다.
   * 🔴 서면 지시에는 복창 개념이 없다 → 400. "복창했다"를 아무 처방에나 찍을 수 있으면 지표가 죽는다.
   * 🔴 이미 확인된 건은 덮지 않는다 → 400. 먼저 확인한 사람의 기록이 원장이다.
   */
  async confirmReadBack(prescriptionId: string, userId: string) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      select: { id: true, orderSource: true, readBackConfirmedAt: true },
    });
    if (!rx) throw new NotFoundException('처방을 찾을 수 없습니다');
    if (!isVerbalOrder(rx.orderSource)) {
      throw new BadRequestException({
        code: 'READ_BACK_NOT_APPLICABLE',
        message: `복창(read-back)은 구두·전화 지시에만 해당합니다(이 처방의 지시 경로: ${rx.orderSource}).`,
      });
    }
    if (rx.readBackConfirmedAt) {
      throw new BadRequestException({
        code: 'READ_BACK_ALREADY_CONFIRMED',
        message: '이미 복창 확인된 처방입니다 — 먼저 확인한 기록을 덮지 않습니다.',
      });
    }
    return this.prisma.prescription.update({
      where: { id: prescriptionId },
      data: { readBackConfirmedAt: new Date(), readBackConfirmedBy: userId },
    });
  }

  // ── Morse Fall Scale 자동 계산 ──

  calculateMorseFallScale(factors: {
    historyOfFalling: boolean;         // 낙상 경험 (25점)
    secondaryDiagnosis: boolean;       // 이차 진단 (15점)
    ambulatoryAid: 'NONE' | 'CRUTCH' | 'FURNITURE'; // 보행 보조기구 (0/15/30)
    ivTherapy: boolean;                // 정맥주사 (20점)
    gait: 'NORMAL' | 'WEAK' | 'IMPAIRED'; // 보행 상태 (0/10/20)
    mentalStatus: 'ORIENTED' | 'OVERESTIMATES'; // 정신 상태 (0/15)
  }) {
    let score = 0;
    if (factors.historyOfFalling) score += 25;
    if (factors.secondaryDiagnosis) score += 15;
    if (factors.ambulatoryAid === 'CRUTCH') score += 15;
    else if (factors.ambulatoryAid === 'FURNITURE') score += 30;
    if (factors.ivTherapy) score += 20;
    if (factors.gait === 'WEAK') score += 10;
    else if (factors.gait === 'IMPAIRED') score += 20;
    if (factors.mentalStatus === 'OVERESTIMATES') score += 15;

    return { score, riskLevel: deriveRiskLevel('FALL_RISK', score), factors };
  }

  async assessMorseFallRisk(data: { patientId: string; assessorId: string; factors: { historyOfFalling: boolean; secondaryDiagnosis: boolean; ambulatoryAid: 'NONE' | 'CRUTCH' | 'FURNITURE'; ivTherapy: boolean; gait: 'NORMAL' | 'WEAK' | 'IMPAIRED'; mentalStatus: 'ORIENTED' | 'OVERESTIMATES' } }) {
    const result = this.calculateMorseFallScale(data.factors);
    return this.persistFallAssessment({ patientId: data.patientId, assessorId: data.assessorId, score: result.score, factors: result.factors });
  }

  // ── 신체보호대 (Restraint) 관리 ──

  async createRestraintOrder(orderedBy: string, data: {
    patientId?: string; mrn?: string; type: string; reason: string; bodyParts?: string[];
    plannedUntil?: string; consentObtained?: boolean; encounterId?: string; admissionId?: string;
  }) {
    let patientId = data.patientId;
    if (!patientId && data.mrn) {
      const p = await this.prisma.patient.findUnique({ where: { mrn: data.mrn }, select: { id: true } });
      if (!p) throw new NotFoundException('해당 환자번호(MRN)의 환자를 찾을 수 없습니다');
      patientId = p.id;
    }
    if (!patientId) throw new NotFoundException('환자 정보(patientId 또는 mrn)가 필요합니다');
    return this.prisma.restraintOrder.create({
      data: {
        patientId,
        type: data.type,
        reason: data.reason,
        bodyParts: (data.bodyParts ?? []) as never,
        orderedBy,
        plannedUntil: data.plannedUntil ? new Date(data.plannedUntil) : new Date(Date.now() + 24 * 3600000),
        consentObtained: data.consentObtained ?? false,
        encounterId: data.encounterId,
        admissionId: data.admissionId,
      },
    });
  }

  /** 적용 중 신체보호대 목록 (환자명 + 최근 점검) */
  /**
   * 신체보호대 점검 간격(분) — 🔴 원내 규정. 설정 키가 없거나 형식 밖이면 코드 기본값으로 **감시는 계속**하되(끄는 쪽이 덜 안전하다)
   * 출처를 함께 말한다: CONFIGURED(원내 설정) · CODE_DEFAULT(코드 기본값 — 원내 규정 미설정) · UNKNOWN(설정 조회 실패 — 기본값으로 감시).
   */
  async restraintCheckInterval(): Promise<{ minutes: number; source: 'CONFIGURED' | 'SEED' | 'CODE_DEFAULT' | 'UNKNOWN' }> {
    const r = await readRestraintInterval(this.config);
    if (r.source === 'UNKNOWN') this.logger.warn('보호대 점검 간격 설정 조회 실패 — 코드 기본값으로 감시');
    return r;
  }

  async getActiveRestraints() {
    const interval = await this.restraintCheckInterval();
    const orders = await this.prisma.restraintOrder.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
      include: { monitorings: { orderBy: { checkedAt: 'desc' }, take: 1 } },
    });
    const pids = [...new Set(orders.map((o) => o.patientId))];
    const patients = pids.length
      ? await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true, mrn: true } })
      : [];
    const pmap = new Map(patients.map((p) => [p.id, p]));
    const now = Date.now();
    return orders.map((o) => {
      const last = o.monitorings[0];
      const lastCheckMin = last ? Math.round((now - last.checkedAt.getTime()) / 60000) : null;
      const monitoringOverdue = lastCheckMin === null ? true : lastCheckMin > interval.minutes; // 점검 간격 초과(점검 기록이 없으면 늘 필요)
      // 재평가 기한(plannedUntil) 경과 = 의사 재오더(갱신) 필요. 지금까지 무시되어 무기한 적용 방치됐음.
      const expired = !!o.plannedUntil && o.plannedUntil.getTime() < now;
      return {
        ...o,
        patient: pmap.get(o.patientId) ?? null,
        lastCheckedAt: last?.checkedAt ?? null,
        lastCheckMinutesAgo: lastCheckMin,
        expired,
        monitoringOverdue,
        overdue: monitoringOverdue || expired,
        checkIntervalMinutes: interval.minutes,
        checkIntervalSource: interval.source,
      };
    });
  }

  async getRestraintDetail(id: string) {
    const order = await this.prisma.restraintOrder.findUnique({
      where: { id },
      include: { monitorings: { orderBy: { checkedAt: 'desc' } } },
    });
    if (!order) throw new NotFoundException('신체보호대 처방을 찾을 수 없습니다');
    return order;
  }

  /** 모니터링 점검 기록 (지속 불필요 시 자동 해제) */
  async recordRestraintMonitoring(restraintId: string, checkedBy: string, data: {
    circulation?: string; skinIntegrity?: string; rangeOfMotion?: boolean; repositioned?: boolean; behavior?: string; continued?: boolean; notes?: string;
  }) {
    const order = await this.prisma.restraintOrder.findUnique({ where: { id: restraintId } });
    if (!order) throw new NotFoundException('신체보호대 처방을 찾을 수 없습니다');
    if (order.status !== 'ACTIVE') throw new BadRequestException({ code: 'RESTRAINT_NOT_ACTIVE', message: '적용 중(ACTIVE)이 아닌 신체보호대에는 점검을 기록할 수 없습니다' });

    /**
     * 🔴 (2026-09-16 G3) 점검 기록과 자동 해제는 **한 트랜잭션**이다.
     *    종전엔 둘을 따로 커밋해, 해제가 실패하면 원장에는 "지속 불필요"가 적혔는데
     *    신체보호대는 ACTIVE 로 남았다 — 법정 기록과 실제 적용 상태가 어긋난다.
     */
    return this.prisma.$transaction(async (tx) => {
      const mon = await tx.restraintMonitoring.create({
        data: {
          restraintId, checkedBy,
          circulation: data.circulation, skinIntegrity: data.skinIntegrity,
          rangeOfMotion: data.rangeOfMotion ?? false, repositioned: data.repositioned ?? false,
          behavior: data.behavior, continued: data.continued ?? true, notes: data.notes,
        },
      });
      // 지속 불필요 점검 시 자동 해제
      if (data.continued === false && order.status === 'ACTIVE') {
        await tx.restraintOrder.update({
          where: { id: restraintId },
          data: { status: 'DISCONTINUED', discontinuedAt: new Date(), discontinuedBy: checkedBy },
        });
      }
      return mon;
    });
  }

  async discontinueRestraint(id: string, userId: string) {
    const order = await this.prisma.restraintOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('신체보호대 처방을 찾을 수 없습니다');
    return this.prisma.restraintOrder.update({
      where: { id },
      data: { status: 'DISCONTINUED', discontinuedAt: new Date(), discontinuedBy: userId },
    });
  }

  /**
   * 신체보호대 갱신 = 기존 오더 해제 + 새 의사 오더 생성(원자). 기한 경과 후 무기한 연장이 아니라
   * 신규 재오더를 강제 — 재평가 기록이 남는다. (컨트롤러에서 DOCTOR/ADMIN 한정)
   */
  async renewRestraintOrder(orderedBy: string, id: string, data: { plannedUntil?: string; reason?: string }) {
    const prev = await this.prisma.restraintOrder.findUnique({ where: { id } });
    if (!prev) throw new NotFoundException('신체보호대 처방을 찾을 수 없습니다');
    if (prev.status !== 'ACTIVE') throw new BadRequestException({ code: 'RESTRAINT_NOT_ACTIVE', message: '적용 중(ACTIVE)인 신체보호대만 갱신할 수 있습니다' });
    return this.prisma.$transaction(async (tx) => {
      await tx.restraintOrder.update({
        where: { id },
        data: { status: 'DISCONTINUED', discontinuedAt: new Date(), discontinuedBy: orderedBy },
      });
      return tx.restraintOrder.create({
        data: {
          patientId: prev.patientId,
          type: prev.type,
          reason: data.reason ?? prev.reason,
          bodyParts: (prev.bodyParts ?? []) as never,
          orderedBy,
          plannedUntil: data.plannedUntil ? new Date(data.plannedUntil) : new Date(Date.now() + 24 * 3600000),
          consentObtained: prev.consentObtained,
          encounterId: prev.encounterId,
          admissionId: prev.admissionId,
        },
      });
    });
  }

  /**
   * IPSG 통합 요약 — 흩어진 안전 데이터(위기값·감염·손위생·낙상)를 국제환자안전목표 단위로 집계.
   * 읽기전용·기존 데이터 재사용(신규 수집 없음). 최근 30일 윈도우.
   */
  async getIpsgSummary() {
    const since = new Date(Date.now() - 30 * 86400000);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [critPending, critToday, infActive, infIsolation, hhTotal, hhPerformed, fallHigh] = await Promise.all([
      this.prisma.criticalValueAlert.count({ where: { status: { in: CRITICAL_ALERT_OPEN_STATUSES } } }),
      this.prisma.criticalValueAlert.count({ where: { notifiedAt: { gte: today } } }),
      this.prisma.infectionSurveillance.count({ where: { resolvedAt: null } }),
      this.prisma.infectionSurveillance.count({ where: { resolvedAt: null, isolationType: { not: null } } }),
      this.prisma.handHygieneObservation.count({ where: { observedAt: { gte: since } } }),
      this.prisma.handHygieneObservation.count({ where: { observedAt: { gte: since }, action: 'PERFORMED' } }),
      this.prisma.fallRiskAssessment.findMany({ where: { assessedAt: { gte: since }, riskLevel: { in: ['HIGH', '높음', 'high'] } }, select: { patientId: true }, distinct: ['patientId'] }),
    ]);
    return {
      data: {
        windowDays: 30,
        // IPSG.2 정확한 의사소통(위기값 보고·확인)
        ipsg2_criticalValue: { pending: critPending, today: critToday },
        // IPSG.5 의료관련감염 위험감소(감염감시·손위생)
        ipsg5_infectionControl: {
          activeInfections: infActive, isolation: infIsolation,
          handHygieneObservations: hhTotal,
          handHygieneCompliancePct: hhTotal ? Math.round((hhPerformed / hhTotal) * 100) : null,
          /**
           * 🔴 준수율만 내보내면 화면은 **영원히 분모 없는 퍼센트**를 그린다(관찰 2건 중 1건도 50%,
           *    관찰 200건 중 100건도 50%). 내부에 이미 있는 분자·분모를 그대로 노출한다
           *    — 새로 세지 않는다(정본이 둘이 되면 갈라진다).
           */
          handHygieneNumerator: hhPerformed,
          handHygieneDenominator: hhTotal,
        },
        // IPSG.6 낙상 위험감소(최근 고위험 환자)
        ipsg6_fallPrevention: { highRiskPatients: fallHigh.length },
        // IPSG.1 환자확인 · IPSG.3 고위험약물 · IPSG.4 수술부위확인 = 전용 엔드포인트(safety/identification-check·CPOE·surgery) 참조
      },
    };
  }

  /** 환자 활성 격리 신호 — MDRO 등록(active)·감염감시(미해소) 병합. 차트 안전배지(P-1) 소비. */
  async getPatientIsolation(patientId: string) {
    const [mdro, inf, icu] = await Promise.all([
      this.prisma.mdroRegistry.findMany({
        where: { patientId, active: true, clearedAt: null },
        select: { mdroType: true, organism: true, isolationType: true, detectedAt: true },
        orderBy: { detectedAt: 'desc' },
      }),
      this.prisma.infectionSurveillance.findMany({
        where: { patientId, resolvedAt: null, isolationType: { not: null } },
        select: { infectionType: true, organism: true, isolationType: true, detectedAt: true },
        orderBy: { detectedAt: 'desc' },
      }),
      // 중환자실 격리(IcuAdmission.isolation) — 재원 중 격리 지정 환자
      this.prisma.icuAdmission.findMany({
        where: { patientId, status: 'ADMITTED', isolation: true },
        select: { admitDate: true },
        orderBy: { admitDate: 'desc' },
      }),
    ]);
    return [
      ...mdro.map((m) => ({ source: 'MDRO' as const, type: m.mdroType, organism: m.organism, isolationType: m.isolationType, detectedAt: m.detectedAt })),
      ...inf.map((i) => ({ source: 'INFECTION' as const, type: i.infectionType, organism: i.organism, isolationType: i.isolationType, detectedAt: i.detectedAt })),
      ...icu.map((a) => ({ source: 'ICU' as const, type: '중환자실 격리', organism: null, isolationType: null, detectedAt: a.admitDate })),
    ];
  }
}
