import { Injectable, Logger } from '@nestjs/common';
import { AiProposalStatus, Prisma } from '@prisma/client';
import { AI_PROPOSAL_STATUSES, ratioOf, roundBy, type RatioValue } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AiCallLogService } from '../ai-call-log/ai-call-log.service';
import { aiPseudonymousId } from '../../common/util/ai-phi-redact';
import { dayRange } from '../../common/day-range';
import { EDIT_DISTANCE_CAP } from '../../common/util/edit-distance';
import {
  SCRIBE_SOAP_FIELDS,
  measureScribeEdit,
  type ScribeSoapField,
  type TextEditMeasure,
} from '../../common/util/scribe-edit-measure';

/**
 * AI 감독(oversight) — 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` §2.3 P2.
 *
 * 🔴 **이 서비스는 판정하지 않는다. 세고, 세지 못한 것을 세지 못했다고 말한다.**
 *    운영 DB 는 이 축이 오늘 배선돼 행이 거의 없다. 그래서 여기서 가장 많이 하는 일은
 *    "표본이 없다"를 **0 이 아닌 `null`+사유**로 내는 것이다 — `0%` 는 "다 거부됐다"로도
 *    "아무 일도 없었다"로도 읽히고, 화면은 전자로 읽는다.
 *
 * 🔴 **비율은 분모와 함께**(`ratioOf` 정본). 분모 0/미상이면 `pct=null`+`unavailableReason`.
 *    화면은 `<Ratio numerator denominator />` 로 그린다 — 문구('산출 불가')는 정본이 만든다.
 *
 * 🔴 **`ACCEPTED` 를 "무수정 승인"으로 읽지 않는다.** 코어(`AiProposalService.decide`)는
 *    "ACCEPTED 인데 편집거리가 0 이 아닐 수 있다 — 값을 고쳐 쓰지 않고 그대로 남긴다"고 적어 두었다.
 *    고쳐 쓰지 않는 대신 **지표가 읽어야** 한다: `acceptedWithEdits`(>0) · `acceptedUnedited`(=0) ·
 *    `acceptedEditUnmeasured`(null=재지 않음)로 **셋으로** 가른다. null 을 0 에 합치면
 *    "안 고쳤다"와 "안 쟀다"가 같아진다.
 *
 * 🔴 **검토 소요시간은 `presentedAt` 이 있는 건만** 잰다. 노출 기록 없이 결정된 건
 *    (`NOT_PRESENTED`)을 "0초 검토"로 세면 무검토 승인 의심이 통째로 거짓말이 된다 —
 *    그 건들은 `notPresentedDecided` 로 **따로** 센다.
 */
@Injectable()
export class AiOversightService {
  private readonly logger = new Logger(AiOversightService.name);

  /** 검토시간·무검토 판정의 최소 표본. 이보다 적으면 분포를 내지 않는다(작은 표본의 p90 은 사실이 아니다). */
  static readonly MIN_DISTRIBUTION_SAMPLE = 5;
  /** 무검토 승인 의심 임계(초) — 원내 정책이라 config 로 두고, 미설정이면 그 사실을 함께 낸다. */
  static readonly QUICK_ACCEPT_CONFIG_KEY = 'ai.oversight.quickAcceptSec';
  static readonly QUICK_ACCEPT_DEFAULT_SEC = 5;
  /** 한 번에 훑는 제안 행 상한 — 넘으면 잘랐다고 말한다(조용히 자르지 않는다). */
  private static readonly SCAN_CAP = 20000;

  constructor(
    private readonly prisma: PrismaService,
    /**
     * 🔴 호출 분포의 정본은 `AiCallLogService.callStats` 다(§2.2). 여기서 같은 집계를 다시 만들면
     *    같은 사실에 정본이 둘이 된다(P12) — 그래서 **위임**하고, 그 정본이 내지 않는 것
     *    (지연 분포)만 여기서 더한다.
     */
    private readonly callLog: AiCallLogService,
  ) {}

  /* ═══════════════════ 요약 ═══════════════════ */

  async summary(q: SummaryQuery): Promise<AiOversightSummary> {
    const windowDays = normalizeDays(q.days);
    const since = daysAgo(windowDays);

    const dept = await this.resolveDept(q.dept);
    const where = this.buildWhere({ since, kind: q.kind, modelRef: q.modelRef, userId: q.userId, dept });

    // ── 분모: 기간 내 생성된 제안 수 ─────────────────────────────────────────
    const total = await this.prisma.aiProposal.count({ where });

    const statusGroups = await this.prisma.aiProposal.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const byStatus = statusCountMap(statusGroups);

    const decided = byStatus.ACCEPTED + byStatus.EDITED + byStatus.REJECTED;
    const expired = byStatus.EXPIRED;

    /**
     * 🔴 **만료는 결정이 아니다.** 그래서 만료율의 분모는 결정 건수가 아니라
     *    `결정 + 만료`(=결말이 난 건)다. 결정 분모에 만료를 얹으면 네 비율의 합이 100% 를 넘고,
     *    보는 사람은 만료를 거부처럼 읽는다(코어도 "만료는 거부가 아니다 — 섞으면 거부율이
     *    부풀려지고 그 숫자로 모델을 판단하게 된다"고 적어 두었다).
     *    분모가 다르다는 사실 자체를 응답이 말한다(`denominatorLabel`).
     */
    const resolved = decided + expired;
    const rates = {
      accepted: withDenominator(ratioOf(byStatus.ACCEPTED, decided), DECIDED_LABEL),
      edited: withDenominator(ratioOf(byStatus.EDITED, decided), DECIDED_LABEL),
      rejected: withDenominator(ratioOf(byStatus.REJECTED, decided), DECIDED_LABEL),
      expired: withDenominator(ratioOf(expired, resolved), RESOLVED_LABEL),
    };

    // ── ACCEPTED 인데 수정이 있었던 건 ───────────────────────────────────────
    const [acceptedWithEdits, acceptedUnedited, acceptedEditUnmeasured] = await Promise.all([
      this.prisma.aiProposal.count({ where: { ...where, status: AiProposalStatus.ACCEPTED, editDistance: { gt: 0 } } }),
      this.prisma.aiProposal.count({ where: { ...where, status: AiProposalStatus.ACCEPTED, editDistance: 0 } }),
      // 🔴 `null` = 재지 않았다. 0(안 고쳤다)과 **다른 사실**이라 따로 센다.
      this.prisma.aiProposal.count({ where: { ...where, status: AiProposalStatus.ACCEPTED, editDistance: null } }),
    ]);

    // ── 축(kind·modelRef·결정자) ─────────────────────────────────────────────
    const [kindGroups, modelGroups, deciderGroups] = await Promise.all([
      this.prisma.aiProposal.groupBy({ by: ['kind', 'status'], where, _count: { _all: true } }),
      this.prisma.aiProposal.groupBy({ by: ['modelRef', 'status'], where, _count: { _all: true } }),
      this.prisma.aiProposal.groupBy({
        by: ['decidedBy', 'status'],
        where: { ...where, decidedBy: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const byKind = axisRows(kindGroups, (g) => g.kind);
    const byModelRef = axisRows(modelGroups, (g) => g.modelRef ?? null);
    const byDecider = await this.attachStaff(axisRows(deciderGroups, (g) => g.decidedBy ?? null));

    // ── 검토 소요시간 · 무검토 승인 의심 ─────────────────────────────────────
    const quick = await this.quickAcceptThreshold();
    const review = await this.reviewTiming(where, quick.seconds);

    return {
      windowDays,
      since: since.toISOString(),
      generatedAt: new Date().toISOString(),
      filters: {
        kind: q.kind ?? null,
        modelRef: q.modelRef ?? null,
        userId: q.userId ?? null,
        dept: dept.name,
        /**
         * 🔴 부서 필터가 **아무도 못 찾았을 때**를 조용히 "그 부서 제안 0건"으로 말하지 않는다.
         *    Staff↔User 연결이 없으면(`userId` 미연결) 그 부서는 애초에 셀 수 없다.
         */
        deptMatchedUsers: dept.userIds === null ? null : dept.userIds.length,
        deptNote: dept.note,
      },
      /** 🔴 분모. 0 이면 아래 비율은 전부 산출 불가다(0% 가 아니다) */
      total,
      byStatus,
      decided,
      rates,
      accepted: {
        total: byStatus.ACCEPTED,
        /** 🔴 승인인데 사람이 고쳤다 — 코어가 값을 고쳐 쓰지 않으므로 지표가 읽는다 */
        withEdits: acceptedWithEdits,
        unedited: acceptedUnedited,
        /** null = 편집거리를 재지 않았다(0 이 아니다) */
        editUnmeasured: acceptedEditUnmeasured,
      },
      byKind,
      byModelRef,
      byDecider,
      review,
      note:
        'AiProposal 은 신규 생성부터 기록된다 — 이 표의 0 은 "AI 를 안 썼다"가 아니라 "이 원장에 남은 것이 없다"이다. ' +
        '수용/수정/거부의 분모는 결정 건수, 만료의 분모는 결정+만료다(만료는 결정이 아니다).',
    };
  }

  /* ═══════════════════ 검토 소요시간 ═══════════════════ */

  /**
   * `presentedAt → decidedAt` 분포와 "무검토 승인 의심".
   *
   * 🔴 표본이 {@link MIN_DISTRIBUTION_SAMPLE} 미만이면 p50/p90 을 **내지 않는다**(null).
   *    2건짜리 p90 은 그냥 최대값이고, 화면은 그것을 분포로 읽는다.
   * 🔴 `presentedAt` 이 없는 결정 건은 분포에서 **뺀다**. 0 으로 채우면 무검토 의심이 폭증한다.
   */
  private async reviewTiming(where: Prisma.AiProposalWhereInput, quickSec: number): Promise<ReviewTiming> {
    const decidedWhere: Prisma.AiProposalWhereInput = {
      ...where,
      status: { in: [AiProposalStatus.ACCEPTED, AiProposalStatus.EDITED, AiProposalStatus.REJECTED] },
    };

    const rows = await this.prisma.aiProposal.findMany({
      where: decidedWhere,
      select: { id: true, kind: true, status: true, presentedAt: true, decidedAt: true, decidedBy: true, modelRef: true, editDistance: true },
      orderBy: { decidedAt: 'desc' },
      take: AiOversightService.SCAN_CAP,
    });

    const notPresentedDecided = rows.filter((r) => r.presentedAt == null).length;
    const timed = rows
      .filter((r) => r.presentedAt != null && r.decidedAt != null)
      .map((r) => ({
        row: r,
        seconds: (r.decidedAt!.getTime() - r.presentedAt!.getTime()) / 1000,
      }))
      /**
       * 🔴 음수(결정이 노출보다 앞선 시각)는 **버리지 않고 따로 센다**. 시드·시계 어긋남에서
       *    실제로 나오는 값이고, 조용히 0 으로 접으면 무검토 의심이 부풀려진다.
       */
      .filter((x) => x.seconds >= 0);
    const negative = rows.filter(
      (r) => r.presentedAt != null && r.decidedAt != null && r.decidedAt.getTime() < r.presentedAt.getTime(),
    ).length;

    const secs = timed.map((x) => x.seconds).sort((a, b) => a - b);
    const enough = secs.length >= AiOversightService.MIN_DISTRIBUTION_SAMPLE;

    const quickRows = timed
      .filter((x) => x.row.status === AiProposalStatus.ACCEPTED && x.seconds < quickSec)
      .sort((a, b) => a.seconds - b.seconds)
      .slice(0, 100)
      .map((x) => ({
        proposalId: x.row.id,
        kind: x.row.kind,
        modelRef: x.row.modelRef,
        decidedBy: x.row.decidedBy,
        seconds: roundBy(x.seconds, 'seconds'),
        editDistance: x.row.editDistance,
      }));

    return {
      /** 검토 소요를 **잴 수 있었던** 건(=분모). 결정 건수와 다르다 */
      sample: secs.length,
      decidedSample: rows.length,
      truncated: rows.length === AiOversightService.SCAN_CAP,
      /** 🔴 표본 부족이면 null — "0초"가 아니다 */
      p50Sec: enough ? roundBy(percentile(secs, 50), 'seconds') : null,
      p90Sec: enough ? roundBy(percentile(secs, 90), 'seconds') : null,
      minSampleForDistribution: AiOversightService.MIN_DISTRIBUTION_SAMPLE,
      distributionUnavailableReason: enough
        ? null
        : `검토 소요를 잴 수 있는 건이 ${secs.length}건뿐이라 분포를 내지 않습니다(최소 ${AiOversightService.MIN_DISTRIBUTION_SAMPLE}건).`,
      /** 🔴 노출 기록 없이 결정된 건 — "0초 검토"가 아니라 **못 잰 건**이다 */
      notPresentedDecided,
      negativeInterval: negative,
      quickAccept: {
        thresholdSec: quickSec,
        count: quickRows.length,
        items: quickRows,
      },
    };
  }

  /**
   * 무검토 승인 임계 — SystemConfig `ai.oversight.quickAcceptSec`.
   * 🔴 미설정이면 코드 기본값을 쓰되 **기본값을 정책인 척하지 않는다**(`configured:false` 를 함께 낸다).
   */
  private async quickAcceptThreshold(): Promise<{ seconds: number; configured: boolean; note: string }> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: AiOversightService.QUICK_ACCEPT_CONFIG_KEY },
      select: { value: true },
    });
    const raw = row?.value;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) {
      return { seconds: n, configured: true, note: `원내 설정(${AiOversightService.QUICK_ACCEPT_CONFIG_KEY})` };
    }
    return {
      seconds: AiOversightService.QUICK_ACCEPT_DEFAULT_SEC,
      configured: false,
      note: `${AiOversightService.QUICK_ACCEPT_CONFIG_KEY} 미설정 — 코드 기본값 ${AiOversightService.QUICK_ACCEPT_DEFAULT_SEC}초를 씁니다(원내 정책으로 정해진 값이 아닙니다).`,
    };
  }

  /** 임계 고지 — 화면이 "이 값이 어디서 왔는가"를 말할 수 있게 별도로도 낸다. */
  async quickAcceptPolicy() {
    return this.quickAcceptThreshold();
  }

  /* ═══════════════════ 목록 ═══════════════════ */

  /**
   * 감독용 제안 목록 — 🔴 **본문 없음 · 환자 식별자 없음**.
   *
   * 감독은 "AI 산출이 어떻게 처리됐는가"를 보는 자리다. 환자가 누구인지는 이 화면의 판단에
   * 필요 없고, 관리·경영 역할이 임상 초안 본문을 보는 경로를 여기에 만들지 않는다
   * (본문은 `AiProposalService.get()` — 임상 역할·환자 귀속 감사 경로가 따로 있다).
   * 그래서 환자는 **가명**(`aiPseudonymousId`)으로만 나가고, 그마저 시크릿을 못 읽으면 `null` 이다.
   */
  async proposals(q: ProposalListQuery): Promise<AiOversightProposalList> {
    const windowDays = normalizeDays(q.days);
    const since = daysAgo(windowDays);
    const dept = await this.resolveDept(q.dept);
    const where = this.buildWhere({ since, kind: q.kind, modelRef: q.modelRef, userId: q.userId, dept });
    if (q.status) where.status = q.status as AiProposalStatus;

    const limit = clamp(q.limit ?? 50, 1, 200);
    const rows = await this.prisma.aiProposal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        kind: true,
        targetType: true,
        patientId: true,
        modelRef: true,
        promptVersion: true,
        source: true,
        reasonCode: true,
        status: true,
        version: true,
        editDistance: true,
        /**
         * 🔴 거부 사유는 **원내 화면에만** 낸다(역할 게이트 안) — 왜 거부했는지가 이 화면의 신호다.
         *    반대로 **CSV 반출에는 원문을 담지 않는다**(기록 여부만): 자유 입력이라 PHI 가 섞일 수 있고
         *    반출은 경계를 넘는다. 같은 필드에 규칙이 둘인 것은 실수가 아니라 경계가 다르기 때문이다.
         */
        rejectReason: true,
        createdAt: true,
        presentedAt: true,
        decidedAt: true,
        decidedBy: true,
        // 🔴 `targetId`(정본 행 id)는 담지 않는다 — 환자를 가명으로 가려 놓고 정본 행 키를 주면
        //    가린 의미가 없다. 감독에 필요한 것은 "무엇에 대한 제안이었나"(targetType)까지다.
      },
    });

    const deciderNames = await this.staffNames(rows.map((r) => r.decidedBy).filter(isString));

    return {
      windowDays,
      since: since.toISOString(),
      limit,
      /** 🔴 잘랐으면 잘랐다고 말한다 */
      truncated: rows.length === limit,
      items: rows.map(({ patientId, ...rest }) => ({
        ...rest,
        /** 🔴 환자 UUID 는 나가지 않는다 — 재식별 키가 되지 않게 HMAC 가명만(못 만들면 null) */
        patientPseudonym: aiPseudonymousId(patientId),
        decider: rest.decidedBy ? (deciderNames.get(rest.decidedBy) ?? null) : null,
        /** 🔴 노출 기록 없이 결정된 건 — 검토시간이 0 이 아니라 **미측정**이라는 뜻 */
        notPresented: rest.decidedAt != null && rest.presentedAt == null,
        reviewSec:
          rest.presentedAt != null && rest.decidedAt != null
            ? roundBy((rest.decidedAt.getTime() - rest.presentedAt.getTime()) / 1000, 'seconds')
            : null,
      })),
      note: '본문·환자 식별자는 이 목록에 담기지 않는다(환자는 가명). 초안 본문은 임상 경로에서만 열린다.',
    };
  }

  /* ═══════════════════ 호출 분포 ═══════════════════ */

  /**
   * AI 호출 분포 — 🔴 skill×모델·상태 분포는 **정본(`AiCallLogService.callStats`)에 위임**한다.
   *    여기서 같은 집계를 다시 짜면 두 화면이 다른 숫자를 말하게 된다.
   *    이 메서드가 더하는 것은 정본이 내지 않는 **지연 분포**뿐이다.
   */
  async calls(days: number): Promise<AiOversightCalls> {
    const windowDays = normalizeDays(days);
    const distribution = await this.callLog.callStats(windowDays);

    const since = daysAgo(windowDays);
    const rows = await this.prisma.aiCallLog.findMany({
      where: { createdAt: { gte: since }, latencyMs: { not: null } },
      select: { latencyMs: true },
      take: AiOversightService.SCAN_CAP,
    });
    const lat = rows.map((r) => r.latencyMs!).sort((a, b) => a - b);
    const enough = lat.length >= AiOversightService.MIN_DISTRIBUTION_SAMPLE;

    return {
      windowDays,
      distribution,
      latency: {
        /** 지연을 **기록한** 호출 수(분모). 호출 수와 다를 수 있다 — 실패는 지연이 없다 */
        sample: lat.length,
        p50Ms: enough ? percentile(lat, 50) : null,
        p90Ms: enough ? percentile(lat, 90) : null,
        minSampleForDistribution: AiOversightService.MIN_DISTRIBUTION_SAMPLE,
        unavailableReason: enough
          ? null
          : `지연이 기록된 호출이 ${lat.length}건뿐이라 분포를 내지 않습니다(최소 ${AiOversightService.MIN_DISTRIBUTION_SAMPLE}건).`,
      },
    };
  }

  /* ═══════════════════ 스크라이브 초안 ↔ 확정 수정량 ═══════════════════ */

  /**
   * 스크라이브(대화·녹음) 초안 ↔ 서명된 진료기록 **수정량 분포** — 정본 `common/util/scribe-edit-measure.ts`.
   *
   * 🔴 **집계만 낸다** — 환자·진료 식별자·본문은 응답에 없다(분모와 분포 수만).
   * 🔴 분모를 단계별로 밝힌다: 기간 내 서명된 스크라이브 진료 → 정정 이력 제외 → 초안 스냅샷 있음 →
   *    상한 초과 제외 → 측정. 어느 단계에서 빠졌는지를 숫자로 말한다(조용히 빼지 않는다).
   * 🔴 정정(AMENDED) 이력이 있는 건은 **분포에서 뺀다** — 섹션별 "처음 확정본"이 원장에 남지 않아
   *    지금 텍스트는 서명 후 정정까지 섞인 값이다. 정정 사실은 여정 사건(`ENCOUNTER_AMENDED`)으로만 알 수 있어
   *    사건 발행 이전의 정정은 세지 못한다(그 한계도 응답이 말한다).
   * 🔴 표본이 `MIN_DISTRIBUTION_SAMPLE` 미만이면 중앙값·p90 은 null + 사유 — 0 이 아니다.
   */
  async scribeEdits(days: number | undefined): Promise<ScribeEditStats> {
    const windowDays = normalizeDays(days);
    const since = daysAgo(windowDays);

    const encs = await this.prisma.encounter.findMany({
      where: { aiScribed: true, signedAt: { gte: since } },
      select: {
        id: true, status: true, scribeSessionId: true,
        subjective: true, objective: true, assessment: true, plan: true,
      },
      take: AiOversightService.SCAN_CAP,
    });
    const truncated = encs.length === AiOversightService.SCAN_CAP;

    // 지금 SIGNED 가 아닌 것(정정 중 AMENDED 등)은 확정본이 아니다
    const signed = encs.filter((e) => e.status === 'SIGNED');
    const notCurrentlySigned = encs.length - signed.length;

    const ids = signed.map((e) => e.id);
    const amendedRows = ids.length
      ? await this.prisma.patientJourneyEvent.findMany({
          where: { eventType: 'ENCOUNTER_AMENDED', refType: 'ENCOUNTER', refId: { in: ids } },
          select: { refId: true },
        })
      : [];
    const amended = new Set(amendedRows.map((r) => r.refId));
    const pool = signed.filter((e) => !amended.has(e.id));

    const sessionIds = [...new Set(pool.map((e) => e.scribeSessionId).filter((v): v is string => typeof v === 'string'))];
    const sessions = sessionIds.length
      ? await this.prisma.scribeSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, draftSnapshot: true } })
      : [];
    const snapById = new Map(sessions.map((x) => [x.id, x.draftSnapshot as unknown]));

    const overall = new EditBucket();
    const sections = Object.fromEntries(SCRIBE_SOAP_FIELDS.map((f) => [f, new EditBucket()])) as Record<ScribeSoapField, EditBucket>;
    let noDraft = 0;
    for (const e of pool) {
      const m = e.scribeSessionId ? measureScribeEdit(snapById.get(e.scribeSessionId), e) : null;
      if (!m) { noDraft++; continue; }
      overall.add(m.overall);
      for (const f of SCRIBE_SOAP_FIELDS) sections[f].add(m.sections[f]);
    }

    // 녹음 스크라이브 초안이 만들어졌지만 진료기록에 반영 기록(APPLIED·aiScribed)이 없는 세션 — 측정 밖
    const draftedWithoutApply = await this.prisma.scribeSession.count({
      where: { status: 'DRAFTED', createdAt: { gte: since } },
    });

    const min = AiOversightService.MIN_DISTRIBUTION_SAMPLE;
    return {
      windowDays,
      since: since.toISOString(),
      generatedAt: new Date().toISOString(),
      truncated,
      funnel: {
        signedScribed: encs.length,
        notCurrentlySigned,
        amendedAfterSign: signed.length - pool.length,
        eligible: pool.length,
        noDraftSnapshot: noDraft,
        capped: overall.capped,
        measured: overall.values.length,
      },
      overall: overall.result(min),
      sections: Object.fromEntries(SCRIBE_SOAP_FIELDS.map((f) => [f, sections[f].result(min)])) as Record<ScribeSoapField, EditDistribution>,
      draftedWithoutApply,
      capChars: EDIT_DISTANCE_CAP,
      definition:
        '정규화 수정량 = 문자 단위 Levenshtein 거리 ÷ max(초안 길이, 확정 길이) × 100(%). 0 = 초안 그대로 서명. '
        + '초안 = 진료기록에 반영된 스크라이브 초안(앰비언트 반영분 · 없으면 녹음 초안)의 섹션만. 확정 = 서명된 진료기록의 같은 섹션. '
        + '초안에 있던 섹션을 지우면 100%. 한쪽이라도 상한(capChars 자)을 넘으면 재지 않고 상한 초과로 센다(하한을 비율에 섞지 않는다).',
      caveats: [
        '앰비언트 반영은 기존 입력 뒤에 덧붙는다 — 의사가 반영 전에 직접 쓴 글도 수정량으로 계상돼 이 값은 상한 쪽으로 치우친다.',
        '서명 후 정정한 기록은 섹션별 처음 확정본이 원장에 없어 분포에서 뺐다. 정정 여부는 여정 사건(ENCOUNTER_AMENDED)으로만 판정하므로 사건 발행 이전 정정은 세지 못한다.',
        '녹음 스크라이브 초안 중 진료기록 반영 기록이 없는 세션(draftedWithoutApply)은 무엇이 반영됐는지 원장에 없어 재지 않는다.',
      ],
    };
  }

  /* ═══════════════════ 내보내기(PMS) ═══════════════════ */

  /**
   * 제안 + 전이 + 호출 로그 CSV — 🔴 **PHI 없음**.
   *
   *  · 환자: `aiPseudonymousId` 가명(HMAC). 시크릿을 못 읽으면 빈 칸(원 UUID 로 떨어지지 않는다).
   *  · 본문: 담지 않는다(`contentEnc` 를 select 하지 않는다 — 실수로 새는 경로 자체를 만들지 않는다).
   *  · 거부 사유: 사람이 자유 입력한 문장이라 PHI 가 섞일 수 있다 → **기록 여부만**(`Y`/빈칸).
   *
   * 🔴 감사행은 **컨트롤러가** 남긴다(이 서비스는 요청자를 모른다).
   */
  async exportCsv(from: string | null | undefined, to: string | null | undefined): Promise<ExportResult> {
    // 🔴 날짜 파싱 실패는 500 이 아니라 400 — `dayRange` 정본이 그렇게 말한다
    const range = dayRange(from, to);
    const createdAt = range ?? undefined;
    const where: Prisma.AiProposalWhereInput = createdAt ? { createdAt } : {};

    const proposals = await this.prisma.aiProposal.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: AiOversightService.SCAN_CAP,
      select: {
        id: true,
        kind: true,
        targetType: true,
        patientId: true,
        modelRef: true,
        promptVersion: true,
        inputSnapshotHash: true,
        contentHash: true,
        confidence: true,
        source: true,
        reasonCode: true,
        status: true,
        version: true,
        editDistance: true,
        rejectReason: true,
        createdAt: true,
        presentedAt: true,
        decidedAt: true,
        decidedBy: true,
      },
    });

    const transitions = proposals.length
      ? await this.prisma.aiProposalTransition.findMany({
          where: { proposalId: { in: proposals.map((p) => p.id) } },
          orderBy: [{ proposalId: 'asc' }, { at: 'asc' }],
          take: AiOversightService.SCAN_CAP,
          select: {
            id: true,
            proposalId: true,
            fromStatus: true,
            toStatus: true,
            actorId: true,
            at: true,
            reason: true,
            editDistance: true,
            clientContext: true,
          },
        })
      : [];

    const calls = await this.prisma.aiCallLog.findMany({
      where: createdAt ? { createdAt } : {},
      orderBy: { createdAt: 'asc' },
      take: AiOversightService.SCAN_CAP,
      select: {
        id: true,
        skill: true,
        client: true,
        requestedModel: true,
        modelRef: true,
        latencyMs: true,
        httpStatus: true,
        source: true,
        reasonCode: true,
        proposalId: true,
        bytes: true,
        mode: true,
        createdAt: true,
      },
    });

    const lines: string[] = [];
    lines.push('# AI oversight export — PHI 없음(환자=HMAC 가명 · 초안 본문 미포함 · 거부 사유는 기록 여부만)');
    lines.push(`# range,${from ?? ''},${to ?? ''}`);
    lines.push(`# generatedAt,${new Date().toISOString()}`);
    lines.push('');

    lines.push('# section,proposals');
    lines.push(
      [
        'proposal_id', 'kind', 'target_type', 'patient_pseudonym', 'model_ref', 'prompt_version',
        'input_snapshot_hash', 'content_hash', 'confidence', 'source', 'reason_code', 'status',
        'version', 'edit_distance', 'reject_reason_recorded', 'created_at', 'presented_at',
        'decided_at', 'decided_by', 'review_sec',
      ].join(','),
    );
    for (const p of proposals) {
      const reviewSec =
        p.presentedAt && p.decidedAt ? roundBy((p.decidedAt.getTime() - p.presentedAt.getTime()) / 1000, 'seconds') : null;
      lines.push(
        [
          p.id, p.kind, p.targetType,
          aiPseudonymousId(p.patientId) ?? '',
          p.modelRef, p.promptVersion, p.inputSnapshotHash, p.contentHash,
          p.confidence == null ? '' : String(p.confidence),
          p.source, p.reasonCode, p.status, p.version, p.editDistance,
          // 🔴 자유 입력 사유는 내보내지 않는다 — 기록됐는지만
          p.rejectReason ? 'Y' : '',
          iso(p.createdAt), iso(p.presentedAt), iso(p.decidedAt), p.decidedBy, reviewSec,
        ].map(csv).join(','),
      );
    }
    lines.push('');

    lines.push('# section,transitions');
    lines.push(['transition_id', 'proposal_id', 'from_status', 'to_status', 'actor_id', 'at', 'reason', 'edit_distance', 'client_context'].join(','));
    for (const t of transitions) {
      lines.push(
        [t.id, t.proposalId, t.fromStatus, t.toStatus, t.actorId, iso(t.at), t.reason, t.editDistance, t.clientContext]
          .map(csv)
          .join(','),
      );
    }
    lines.push('');

    lines.push('# section,calls');
    lines.push(['call_id', 'skill', 'client', 'requested_model', 'model_ref', 'latency_ms', 'http_status', 'source', 'reason_code', 'proposal_id', 'bytes', 'mode', 'created_at'].join(','));
    for (const c of calls) {
      lines.push(
        [c.id, c.skill, c.client, c.requestedModel, c.modelRef, c.latencyMs, c.httpStatus, c.source, c.reasonCode, c.proposalId, c.bytes, c.mode, iso(c.createdAt)]
          .map(csv)
          .join(','),
      );
    }

    const truncated =
      proposals.length === AiOversightService.SCAN_CAP ||
      transitions.length === AiOversightService.SCAN_CAP ||
      calls.length === AiOversightService.SCAN_CAP;
    if (truncated) {
      lines.push('');
      lines.push(`# truncated,true,cap,${AiOversightService.SCAN_CAP}`);
    }

    return {
      // 🔴 BOM — 엑셀이 UTF-8 을 자동 인식하지 못해 한글이 깨진다
      content: '﻿' + lines.join('\n'),
      counts: { proposals: proposals.length, transitions: transitions.length, calls: calls.length },
      truncated,
      filename: `ai-oversight-${from ?? 'all'}_${to ?? 'all'}.csv`,
    };
  }

  /* ═══════════════════ 내부 ═══════════════════ */

  private buildWhere(input: {
    since: Date;
    kind?: string | null;
    modelRef?: string | null;
    userId?: string | null;
    dept: DeptScope;
  }): Prisma.AiProposalWhereInput {
    const where: Prisma.AiProposalWhereInput = { createdAt: { gte: input.since } };
    if (input.kind) where.kind = input.kind;
    if (input.modelRef) where.modelRef = input.modelRef;
    /**
     * 🔴 사용자 축과 부서 축을 **같은 키에 덮어쓰지 않는다**. 종전 관용구대로 `where.decidedBy` 에
     *    각각 대입하면 나중에 쓴 쪽이 앞의 필터를 지워, 화면은 "부서+사용자로 좁혔다"고 믿으면서
     *    실제로는 한 축만 걸린 결과를 본다(필터가 조용히 사라지는 부류).
     * 🔴 부서 필터가 아무도 못 찾았으면 **아무것도 매치하지 않는 조건**(`in: []`)이 된다 —
     *    필터를 무시하고 전건을 보여주는 것보다 "0건"이 정직하고, 그 이유는 `deptNote` 가 말한다.
     */
    const and: Prisma.AiProposalWhereInput[] = [];
    if (input.userId) and.push({ decidedBy: input.userId });
    if (input.dept.userIds !== null) and.push({ decidedBy: { in: input.dept.userIds } });
    if (and.length) where.AND = and;
    return where;
  }

  /**
   * 부서명 → 그 부서 직원의 User id 집합.
   * 🔴 `Staff.userId` 가 없는 직원은 이 축에서 셀 수 없다 — 그 사실을 `note` 로 말한다.
   */
  private async resolveDept(dept?: string | null): Promise<DeptScope> {
    const name = (dept ?? '').trim();
    if (!name) return { name: null, userIds: null, note: null };
    const staff = await this.prisma.staff.findMany({
      where: { department: name },
      select: { userId: true },
    });
    const userIds = staff.map((s) => s.userId).filter(isString);
    const unlinked = staff.length - userIds.length;
    return {
      name,
      userIds,
      note:
        staff.length === 0
          ? `'${name}' 부서로 등록된 직원이 없습니다 — 이 필터의 0 은 "제안이 없었다"가 아니라 "셀 대상이 없다"입니다.`
          : unlinked > 0
            ? `'${name}' 부서 ${staff.length}명 중 ${unlinked}명은 시스템 계정(User)이 연결되지 않아 이 축에서 세지 않습니다.`
            : null,
    };
  }

  /** 결정자 축에 이름·부서를 붙인다(못 찾으면 붙이지 않는다 — 지어내지 않는다). */
  private async attachStaff(rows: AxisRow[]): Promise<AxisRow[]> {
    const ids = rows.map((r) => r.key).filter(isString);
    if (!ids.length) return rows;
    const names = await this.staffNames(ids);
    return rows.map((r) => ({ ...r, label: (r.key && names.get(r.key)) || null }));
  }

  private async staffNames(userIds: string[]): Promise<Map<string, DeciderLabel>> {
    const out = new Map<string, DeciderLabel>();
    const ids = [...new Set(userIds)];
    if (!ids.length) return out;
    const staff = await this.prisma.staff.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, familyName: true, givenName: true, department: true },
    });
    for (const s of staff) {
      if (!s.userId) continue;
      out.set(s.userId, { name: `${s.familyName}${s.givenName}`, department: s.department });
    }
    return out;
  }
}

/* ═══════════════════ 순수 함수 ═══════════════════ */

const DECIDED_LABEL = '결정된 건수(ACCEPTED+EDITED+REJECTED)';
const RESOLVED_LABEL = '결말이 난 건수(결정+만료) — 만료는 결정이 아니라 분모가 다르다';

/** 허용 구간은 7·30·90 셋뿐(DTO 가 이미 막지만, 서비스 단독 호출도 같은 규칙을 지킨다) */
export function normalizeDays(days: unknown): 7 | 30 | 90 {
  const n = Number(days);
  return n === 30 ? 30 : n === 90 ? 90 : 7;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * 선형보간 백분위. 🔴 표본 판정(최소 건수)은 **호출부**가 한다 — 여기서 접으면
 * "표본이 없어 못 냈다"와 "0 이었다"가 같아진다.
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) throw new Error('percentile: 표본 0 — 호출부가 먼저 판정해야 한다');
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = ((sortedAsc.length - 1) * p) / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** 상태별 건수 — 🔴 **전 상태를 0 으로 채워** 낸다(키가 없는 것과 0 은 화면에서 다르게 보인다) */
function statusCountMap(groups: { status: AiProposalStatus; _count: { _all: number } }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of AI_PROPOSAL_STATUSES) out[s] = 0;
  for (const g of groups) out[g.status] = (out[g.status] ?? 0) + g._count._all;
  return out;
}

function axisRows<T extends { status: AiProposalStatus; _count: { _all: number } }>(
  groups: T[],
  keyOf: (g: T) => string | null,
): AxisRow[] {
  const map = new Map<string, AxisRow>();
  for (const g of groups) {
    const key = keyOf(g);
    const id = key ?? '';
    const row =
      map.get(id) ??
      ({ key, label: null, total: 0, byStatus: Object.fromEntries(AI_PROPOSAL_STATUSES.map((s) => [s, 0])) } as AxisRow);
    row.total += g._count._all;
    row.byStatus[g.status] = (row.byStatus[g.status] ?? 0) + g._count._all;
    map.set(id, row);
  }
  return [...map.values()]
    .map((r) => {
      const decided = r.byStatus.ACCEPTED + r.byStatus.EDITED + r.byStatus.REJECTED;
      return {
        ...r,
        decided,
        acceptedRate: withDenominator(ratioOf(r.byStatus.ACCEPTED, decided), DECIDED_LABEL),
        rejectedRate: withDenominator(ratioOf(r.byStatus.REJECTED, decided), DECIDED_LABEL),
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** 비율에 **분모가 무엇인지**를 붙인다 — 분모가 축마다 다른데 이름이 없으면 사람이 같은 것으로 읽는다 */
function withDenominator(r: RatioValue, denominatorLabel: string): RateValue {
  return { ...r, denominatorLabel };
}

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString() : '';
}

/** CSV 셀 — `null`/`undefined` 는 빈 칸(문자열 'null' 을 적지 않는다) */
function csv(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 수정량 표본 통 — 🔴 null(초안 없는 섹션)은 **표본이 아니다**(세지 않는다). CAPPED 는 따로 센다.
 */
export class EditBucket {
  /** 정규화 수정량(0~1) 원값 */
  readonly values: number[] = [];
  drafted = 0;
  capped = 0;
  unchanged = 0;

  add(m: TextEditMeasure | null): void {
    if (m == null) return;
    this.drafted++;
    if (m.status === 'CAPPED') { this.capped++; return; }
    this.values.push(m.normalized);
    if (m.distance === 0) this.unchanged++;
  }

  result(minSample: number): EditDistribution {
    const sorted = [...this.values].sort((a, b) => a - b);
    const n = sorted.length;
    const enough = n >= minSample;
    return {
      drafted: this.drafted,
      capped: this.capped,
      measured: n,
      medianPct: enough ? roundBy(percentile(sorted, 50) * 100, 'percent') : null,
      p90Pct: enough ? roundBy(percentile(sorted, 90) * 100, 'percent') : null,
      minSampleForDistribution: minSample,
      // 🔴 사유는 **코드**로 낸다 — 문장은 화면이 `measured`·`minSampleForDistribution` 로 조립한다
      //    (서버가 한국어 문장을 조립하면 화면 언어를 바꿔도 그 줄은 한국어다)
      distributionUnavailableReason: enough ? null : n === 0 ? 'NO_SAMPLE' : 'BELOW_MIN_SAMPLE',
      unchanged: withDenominator(ratioOf(this.unchanged, n), UNCHANGED_LABEL),
    };
  }
}

const UNCHANGED_LABEL = '수정량을 잴 수 있었던 초안 수(상한 초과·초안 없음 제외)';

/* ═══════════════════ 계약 ═══════════════════ */

export interface SummaryQuery {
  days?: number;
  kind?: string | null;
  dept?: string | null;
  userId?: string | null;
  modelRef?: string | null;
}

export interface ProposalListQuery extends SummaryQuery {
  status?: string | null;
  limit?: number;
}

export interface RateValue extends RatioValue {
  denominatorLabel: string;
}

export interface DeciderLabel {
  name: string;
  department: string;
}

export interface AxisRow {
  key: string | null;
  label: DeciderLabel | null;
  total: number;
  byStatus: Record<string, number>;
  decided?: number;
  acceptedRate?: RateValue;
  rejectedRate?: RateValue;
}

export interface QuickAcceptItem {
  proposalId: string;
  kind: string;
  modelRef: string | null;
  decidedBy: string | null;
  seconds: number | null;
  editDistance: number | null;
}

export interface ReviewTiming {
  sample: number;
  decidedSample: number;
  truncated: boolean;
  p50Sec: number | null;
  p90Sec: number | null;
  minSampleForDistribution: number;
  distributionUnavailableReason: string | null;
  notPresentedDecided: number;
  negativeInterval: number;
  quickAccept: { thresholdSec: number; count: number; items: QuickAcceptItem[] };
}

export interface AiOversightSummary {
  windowDays: number;
  since: string;
  generatedAt: string;
  filters: {
    kind: string | null;
    modelRef: string | null;
    userId: string | null;
    dept: string | null;
    deptMatchedUsers: number | null;
    deptNote: string | null;
  };
  total: number;
  byStatus: Record<string, number>;
  decided: number;
  rates: { accepted: RateValue; edited: RateValue; rejected: RateValue; expired: RateValue };
  accepted: { total: number; withEdits: number; unedited: number; editUnmeasured: number };
  byKind: AxisRow[];
  byModelRef: AxisRow[];
  byDecider: AxisRow[];
  review: ReviewTiming;
  note: string;
}

export interface AiOversightProposalList {
  windowDays: number;
  since: string;
  limit: number;
  truncated: boolean;
  items: unknown[];
  note: string;
}

export interface AiOversightCalls {
  windowDays: number;
  distribution: Awaited<ReturnType<AiCallLogService['callStats']>>;
  latency: {
    sample: number;
    p50Ms: number | null;
    p90Ms: number | null;
    minSampleForDistribution: number;
    unavailableReason: string | null;
  };
}

export interface EditDistribution {
  /** 초안이 이 범위(섹션·전체)를 낸 건수 */
  drafted: number;
  /** 상한 초과로 재지 않은 건수 */
  capped: number;
  /** 실제로 잰 건수 = 분포·무수정 비율의 분모 */
  measured: number;
  /** 🔴 표본 부족이면 null — 0% 가 아니다 */
  medianPct: number | null;
  p90Pct: number | null;
  minSampleForDistribution: number;
  /** NO_SAMPLE = 표본 0 · BELOW_MIN_SAMPLE = 최소 미만 · null = 분포 있음 */
  distributionUnavailableReason: 'NO_SAMPLE' | 'BELOW_MIN_SAMPLE' | null;
  /** 무수정(거리 0) 비율 — 분모 `measured` · 0 이면 pct=null */
  unchanged: RateValue;
}

export interface ScribeEditStats {
  windowDays: number;
  since: string;
  generatedAt: string;
  truncated: boolean;
  funnel: {
    /** 기간 내 서명된(signedAt) 스크라이브 진료 */
    signedScribed: number;
    /** 지금 SIGNED 가 아님(정정 중 등) — 확정본이 아니라 제외 */
    notCurrentlySigned: number;
    /** 서명 후 정정 이력 — 처음 확정본이 원장에 없어 제외 */
    amendedAfterSign: number;
    eligible: number;
    /** 초안 스냅샷이 없거나 SOAP 텍스트를 못 찾음 — 측정 불가 */
    noDraftSnapshot: number;
    /** 전체 비교에서 상한 초과 */
    capped: number;
    measured: number;
  };
  overall: EditDistribution;
  sections: Record<ScribeSoapField, EditDistribution>;
  draftedWithoutApply: number;
  /** 비교 상한(문자) — 넘으면 재지 않는다 */
  capChars: number;
  definition: string;
  caveats: string[];
}

export interface ExportResult {
  content: string;
  counts: { proposals: number; transitions: number; calls: number };
  truncated: boolean;
  filename: string;
}

interface DeptScope {
  name: string | null;
  /** null = 부서 필터 없음(전건). 배열이면 그 안의 사용자만(빈 배열이면 아무도 매치 안 됨) */
  userIds: string[] | null;
  note: string | null;
}
