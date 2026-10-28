import { Injectable, Logger } from '@nestjs/common';
import { CRITICAL_LAB_FLAGS } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CRITICAL_ALERT_ESCALATE_CONFIG_KEY, CRITICAL_ALERT_OPEN_STATUSES, parseEscalateAfterMinutes } from './critical-value-alert-states';
import { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * 위급값 '허용시간 초과 미보고' 기준의 3상태 — 기준값은 상향 보고 크론과 **같은 config 키·같은 해석 함수** 하나.
 * 🔴 (2026-09-14 P3) 종전엔 보드가 `30` 을 하드코딩해 크론 설정과 따로 놀았다(상황판 라벨 '30분 초과'도 함께).
 *    미설정·해석 불가·조회 실패는 건수를 `null`(산출 불가)로 둔다 — 30 으로 폴백하면 위원회가 정할 값을 코드가 정한다.
 */
export type CriticalOverduePolicy = 'CONFIGURED' | 'NOT_CONFIGURED' | 'INVALID' | 'UNAVAILABLE';

/**
 * 검사·영상 위험값 보드(D8) — 위험값 미보고·검사 대기·영상 판독대기 실시간 집계.
 * raw SQL 미사용(Prisma ORM) — uuid 캐스팅 이슈 회피.
 */
@Injectable()
export class DiagnosticsBoardService {
  private readonly logger = new Logger(DiagnosticsBoardService.name);

  // 🔴 config 는 모듈이 반드시 공급한다(lab·command-center 둘 다 ConfigRuntimeModule import). 인자가 없으면(단위 테스트)
  //    기준을 모르는 것 — UNAVAILABLE 로 말하고 0 으로 접지 않는다.
  constructor(private readonly prisma: PrismaService, private readonly config?: ConfigRuntimeService) {}

  private async criticalOverduePolicy(): Promise<{ policy: CriticalOverduePolicy; afterMinutes: number | null }> {
    if (!this.config) return { policy: 'UNAVAILABLE', afterMinutes: null };
    try {
      const raw = await this.config.get(CRITICAL_ALERT_ESCALATE_CONFIG_KEY);
      const afterMinutes = parseEscalateAfterMinutes(raw);
      if (afterMinutes != null) return { policy: 'CONFIGURED', afterMinutes };
      return { policy: raw == null || raw === '' ? 'NOT_CONFIGURED' : 'INVALID', afterMinutes: null };
    } catch (err) {
      this.logger.warn(`${CRITICAL_ALERT_ESCALATE_CONFIG_KEY} lookup failed - criticalOverdue unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return { policy: 'UNAVAILABLE', afterMinutes: null };
    }
  }

  async getBoard() {
    const now = Date.now();

    // 위험값 미확인(PENDING·ESCALATED) — 환자안전 핵심. 🔴 PENDING 만 보면 상향 보고된 경보가 보드에서 사라진다
    const alerts = await this.prisma.criticalValueAlert.findMany({
      where: { status: { in: CRITICAL_ALERT_OPEN_STATUSES } },
      orderBy: { notifiedAt: 'asc' },
      take: 100,
      select: { id: true, patientId: true, testName: true, value: true, unit: true, reason: true, notifiedAt: true, status: true, escalatedAt: true },
    });
    const patIds = [...new Set(alerts.map((a) => a.patientId))];
    const pats = patIds.length
      ? await this.prisma.patient.findMany({ where: { id: { in: patIds } }, select: { id: true, familyName: true, givenName: true, mrn: true } })
      : [];
    const pMap = new Map(pats.map((p) => [p.id, p]));
    const criticalAlerts = alerts.map((a) => {
      const p = pMap.get(a.patientId);
      return {
        id: a.id, patientId: a.patientId,
        name: p ? `${p.familyName}${p.givenName}` : '-', mrn: p?.mrn ?? '-',
        testName: a.testName, value: a.value, unit: a.unit, reason: a.reason,
        notifiedAt: a.notifiedAt,
        status: a.status,
        escalatedAt: a.escalatedAt ?? null,
        minsElapsed: Math.floor((now - new Date(a.notifiedAt).getTime()) / 60000),
      };
    });

    // ── 🔴 원자료 대조 — 위급 flag 인데 경보가 생성되지 않은 결과 ──
    // 이 보드는 "탐지된 경보(CriticalValueAlert)"만 세어 왔다. 그래서 경보 생성 경로를 우회해
    // 들어온 위급 결과(운영 실측 2026-08-18: flag HH/LL 6건 · 대응 경보 0건)에 대해
    // "미보고 위험값이 없습니다 ✓" 초록을 띄웠다 — 원자료와 어긋난 안심(P17).
    // 경보 목록과 **분리해서** 보여준다: 경보가 아니라 "경보가 없다는 사실"이 여기서의 결함이다.
    const criticalItems = await this.prisma.labResultItem.findMany({
      where: { flag: { in: [...CRITICAL_LAB_FLAGS] } },
      select: { id: true, labResultId: true, testName: true, value: true, unit: true, flag: true },
      take: 500,
    });
    const critResultIds = [...new Set(criticalItems.map((i) => i.labResultId))];
    const alertedRows = critResultIds.length
      ? await this.prisma.criticalValueAlert.findMany({
          where: { labResultId: { in: critResultIds } }, select: { labResultId: true }, distinct: ['labResultId'],
        })
      : [];
    const alertedIds = new Set(alertedRows.map((a) => a.labResultId));
    const unalertedItems = criticalItems.filter((i) => !alertedIds.has(i.labResultId));
    const unalertedResultIds = [...new Set(unalertedItems.map((i) => i.labResultId))];
    const unalertedResults = unalertedResultIds.length
      ? await this.prisma.labResult.findMany({
          where: { id: { in: unalertedResultIds } },
          select: { id: true, patientId: true, completedAt: true, createdAt: true, status: true,
            patient: { select: { familyName: true, givenName: true, mrn: true } } },
        })
      : [];
    const rMap = new Map(unalertedResults.map((r) => [r.id, r]));
    const criticalUnalertedList = unalertedItems.slice(0, 50).map((i) => {
      const r = rMap.get(i.labResultId);
      return {
        id: i.id, labResultId: i.labResultId,
        patientId: r?.patientId ?? null,
        name: r?.patient ? `${r.patient.familyName}${r.patient.givenName}` : '-',
        mrn: r?.patient?.mrn ?? '-',
        testName: i.testName, value: i.value, unit: i.unit, flag: i.flag,
        resultAt: r?.completedAt ?? r?.createdAt ?? null,
      };
    });

    // 검사 대기(미완료) / 영상 판독대기(미보고)
    const [labPending, labInProgress, imagingUnread, imagingByModality, funcActive, funcCritical, pendingReviewList] = await Promise.all([
      this.prisma.labResult.count({ where: { status: { in: ['PENDING', 'COLLECTED'] } } }),
      this.prisma.labResult.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.imagingResult.count({ where: { reportedAt: null } }),
      // 영상 모달리티별 판독대기
      this.prisma.imagingResult.groupBy({ by: ['modality'], _count: { id: true }, where: { reportedAt: null } }),
      // 기능검사 활성(미완료) — 모달별 큐용
      this.prisma.diagnosticTest.findMany({
        where: { status: { in: ['ORDERED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD'] } },
        select: { id: true, testType: true, testName: true, status: true, priority: true, patientId: true, createdAt: true, targetTatMinutes: true, roomName: true },
        take: 500,
      }),
      // 기능검사 위험소견(미검토)
      this.prisma.diagnosticTest.findMany({
        where: { criticalFlag: true, reviewStatus: { not: 'APPROVED' } },
        select: { id: true, testType: true, testName: true, criticalNote: true, patientId: true, reportedAt: true },
        orderBy: { reportedAt: 'desc' }, take: 50,
      }),
      // 판독 검토 대기 목록
      this.prisma.diagnosticTest.findMany({
        where: { reviewStatus: 'PENDING_REVIEW' },
        select: { id: true, testType: true, testName: true, conclusion: true, patientId: true, deltaFlag: true, criticalFlag: true, reportedAt: true },
        orderBy: { reportedAt: 'desc' }, take: 50,
      }),
    ]);
    const pendingReview = pendingReviewList.length;

    // 기능검사 모달별 큐 집계
    const modalityMap = new Map<string, { testType: string; ordered: number; inProgress: number; total: number }>();
    for (const t of funcActive) {
      const m = modalityMap.get(t.testType) ?? { testType: t.testType, ordered: 0, inProgress: 0, total: 0 };
      if (t.status === 'IN_PROGRESS') m.inProgress++; else m.ordered++;
      m.total++;
      modalityMap.set(t.testType, m);
    }
    const functionalQueues = [...modalityMap.values()].sort((a, b) => b.total - a.total);

    // TAT 초과 — 오더 후 목표(또는 기본 60분) 경과 미완료
    // 🔴 KPI 는 자르기 전에 센다 — 종전엔 slice(0,30) 뒤 길이를 요약값으로 써서
    //    실제 59건이 "TAT 초과 30"으로 절반 감춰졌다(2026-08-13 실측·목록 상한이 KPI 를 누름).
    const DEFAULT_TAT = 60;
    const tatOverdueAll = funcActive
      .map((t) => ({ ...t, elapsed: Math.floor((now - new Date(t.createdAt).getTime()) / 60000), target: t.targetTatMinutes ?? DEFAULT_TAT }))
      .filter((t) => t.elapsed > t.target)
      .sort((a, b) => (b.elapsed - b.target) - (a.elapsed - a.target));
    const tatOverdue = tatOverdueAll.slice(0, 30);

    const overdue = await this.criticalOverduePolicy();
    const summary = {
      criticalPending: criticalAlerts.length,
      // 허용시간 초과 미보고 — 기준은 상향 보고 크론과 같은 config. 기준을 모르면 null(산출 불가)이지 0 이 아니다.
      criticalOverdue: overdue.afterMinutes == null ? null : criticalAlerts.filter((a) => a.minsElapsed >= (overdue.afterMinutes as number)).length,
      criticalOverdueAfterMinutes: overdue.afterMinutes,
      criticalOverduePolicy: overdue.policy,
      // 🔴 경보가 아니라 '경보 부재' 건수 — 원자료(위급 flag)와 경보의 괴리. 0 이 아니면 초록을 띄우면 안 된다.
      criticalUnalerted: unalertedItems.length,
      criticalFlagTotal: criticalItems.length, // 분모 — 0 이면 "괴리 0"은 표본 부재다
      labPending: labPending + labInProgress,
      imagingUnread,
      functionalActive: funcActive.length, // 미완료 전체(ORDERED·SCHEDULED·IN_PROGRESS·ON_HOLD) — 라벨도 '미완료'로
      functionalCritical: funcCritical.length,
      tatOverdue: tatOverdueAll.length,
      pendingReview,
    };
    return {
      summary, criticalAlerts, criticalUnalertedList,
      labStatus: { pending: labPending, inProgress: labInProgress },
      imagingUnread,
      imagingByModality: imagingByModality.map((m) => ({ modality: m.modality, count: m._count.id })),
      functionalQueues,
      functionalCritical: funcCritical,
      tatOverdue,
      pendingReviewList,
    };
  }
}
