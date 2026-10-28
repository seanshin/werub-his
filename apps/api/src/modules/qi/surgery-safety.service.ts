import { Injectable, Optional } from '@nestjs/common';
import { Prisma, SurgeryStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { nonEmptyStringArrayOr } from '../../common/qi-targets';
import { LATERALITY_REQUIRED_KEYWORDS } from '../../common/laterality-keywords';
import {
  CHECKLIST_PHASE_LABEL,
  evaluateSurgerySafety,
  isChecklistComplete,
  type ChecklistPhase,
  type SurgerySafetyFinding,
} from '../../common/surgery-safety-canon';
import { dayRange, localDateKey } from '../../common/day-range';

/**
 * 수술 안전(IPSG.4) 미이행 탐지 — **워크리스트**.
 *
 * 🔴 왜 알림이 아니라 상시 목록인가:
 *    이 저장소의 알림 읽음률은 운영 실측 **8.6%**(348건 중 30건)다. 수술 46건에 미완료 8건이면
 *    건당 알림 8통이 늘 뿐이고, 그 8통이 진짜 위급 알림(CRITICAL)까지 같이 묻는다
 *    ("거짓 경보는 진짜 경보를 죽인다"). 미완료 체크리스트는 **초 단위로 다투는 사건이 아니라
 *    잔여 작업(backlog)** 이다 — 잔여 작업의 정본 표현은 사라지는 알림이 아니라 **줄어드는 목록**이다.
 *    그래서 상시 워크리스트를 정본으로 두고, 크론은 **하루 1회 집계 1건**만 상신해
 *    목록으로 데려간다(탐지만 하고 아무에게도 안 알리는 크론은 이 저장소 규약 위반이다).
 *
 * 🔴 분모를 항상 함께 낸다. "미완료 8건"만 쓰면 전체가 46건인지 8건인지 알 수 없다.
 *    대상 수술이 0건이면 이행률은 0% 가 아니라 **산출 불가**(null)다.
 */
@Injectable()
export class SurgerySafetyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** 체크리스트 이행 모집단 = 수술방을 거친 것. 예정·취소는 '아직 안 한 것'이지 '미이행'이 아니다. */
  private static readonly PERFORMED: Prisma.EnumSurgeryStatusFilter = { in: [SurgeryStatus.IN_PROGRESS, SurgeryStatus.COMPLETED] };

  private async lateralityKeywords(): Promise<string[]> {
    return nonEmptyStringArrayOr(
      await this.config?.get('surgery.lateralityKeywords').catch(() => null),
      LATERALITY_REQUIRED_KEYWORDS,
    );
  }

  private resolveRange(from?: string, to?: string) {
    const now = new Date();
    const defFrom = localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const defTo = localDateKey(now);
    const r = dayRange(from || defFrom, to || defTo)!;
    return { gte: r.gte!, lt: r.lt!, from: from || defFrom, to: to || defTo };
  }

  private async load(where: Prisma.SurgeryWhereInput) {
    const surgeries = await this.prisma.surgery.findMany({
      where,
      select: {
        id: true, procedureName: true, bodySite: true, laterality: true, status: true, scheduledAt: true,
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        surgeon: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 1000,
    });
    if (!surgeries.length) return { surgeries, findings: [] as SurgerySafetyFinding[] };
    const checklists = await this.prisma.surgicalChecklist.findMany({
      where: { surgeryId: { in: surgeries.map((s) => s.id) } },
      select: {
        surgeryId: true, signInCompletedAt: true, timeOutCompletedAt: true,
        signOutCompletedAt: true, countStatus: true, countDiscrepancyNote: true,
      },
    });
    const byId = new Map(checklists.map((c) => [c.surgeryId, c]));
    const keywords = await this.lateralityKeywords();
    const findings = surgeries.map((s) =>
      evaluateSurgerySafety({ ...s, laterality: s.laterality ?? null }, byId.get(s.id), keywords),
    );
    return { surgeries, findings };
  }

  /**
   * 🔴 조회 실패를 'OFF' 로 접지 않는다 — 접으면 QI 화면이 **켜져 있는 게이트를 "꺼짐"이라 말한다**
   *    (키 부재는 `get()` 이 null 을 돌려주므로 그대로 기본값으로 흐른다 — 부재와 실패는 다른 사실이다).
   */
  private async gateModes() {
    return {
      siteVerify: gateMode(await this.config?.get('surgery.siteVerify.enforce'), 'OFF'),
      signOut: gateMode(await this.config?.get('surgery.signOutEnforce')),
      count: gateMode(await this.config?.get('surgery.countEnforce'), 'OFF'),
    };
  }

  /**
   * IPSG.4 요약 — 체크리스트 이행률 + 부위·좌우 확인 갭. **측정값만** 낸다(추정·상수 금지).
   */
  async getSummary(from?: string, to?: string) {
    const range = this.resolveRange(from, to);
    const period = { from: range.from, to: range.to, resolvedFrom: range.gte.toISOString(), resolvedToExclusive: range.lt.toISOString() };

    // 체크리스트 이행 — 수술방을 거친 수술이 분모
    const performed = await this.load({ scheduledAt: { gte: range.gte, lt: range.lt }, status: SurgerySafetyService.PERFORMED });
    // 부위·좌우 — 예약된 전건이 분모(수술 전에 잡아야 의미가 있다)
    const scheduled = await this.load({ scheduledAt: { gte: range.gte, lt: range.lt }, status: { not: 'CANCELLED' } });

    const pf = performed.findings;
    const complete = pf.filter(isChecklistComplete).length;
    const noRow = pf.filter((f) => !f.checklistPresent).length;
    const byPhase = (['SIGN_IN', 'TIME_OUT', 'SIGN_OUT'] as ChecklistPhase[]).map((ph) => ({
      phase: ph,
      label: CHECKLIST_PHASE_LABEL[ph],
      missing: pf.filter((f) => f.missingPhases.includes(ph)).length,
    }));

    const sf = scheduled.findings;
    const requiredYes = sf.filter((f) => f.lateralityRequired === true).length;
    const requiredUnknown = sf.filter((f) => f.lateralityRequired === null).length;
    const gaps = sf.filter((f) => f.lateralityGap).length;

    const gates = await this.gateModes();
    return {
      // 🔴 두 축 모두 모집단이 0 이면 '이행 100%'가 아니라 산출 불가다.
      available: pf.length > 0 || sf.length > 0,
      reason: pf.length === 0 && sf.length === 0
        ? `${range.from}~${range.to} 구간에 수술이 없습니다 — 이행률·부위확인율 산출 불가(0% 아님).`
        : null,
      period,
      checklist: {
        denominator: pf.length,
        complete,
        incomplete: pf.length - complete,
        noChecklistRow: noRow,
        byPhase,
        compliancePct: pf.length > 0 ? Math.round((complete / pf.length) * 1000) / 10 : null,
        basis: pf.length > 0
          ? `수술방을 거친 수술 ${pf.length}건(IN_PROGRESS·COMPLETED) 중 3단계(Sign-In·Time-Out·Sign-Out) 모두 완료 시각이 찍힌 건 = ${complete}건`
          : '대상 수술 없음 — 이행률 산출 불가',
      },
      siteVerification: {
        denominator: sf.length,
        lateralityRequired: requiredYes,
        // 🔴 '판정 못 했다'를 '필요 없다'에 합치지 않는다 — 합치면 갭이 줄어 보인다.
        lateralityUndetermined: requiredUnknown,
        gaps,
        verifiedPct: requiredYes > 0 ? Math.round(((requiredYes - gaps) / requiredYes) * 1000) / 10 : null,
        basis: requiredYes > 0
          ? `좌우 구분 필요 술식 ${requiredYes}건 중 좌/우가 특정된 건 = ${requiredYes - gaps}건(판정 불가 ${requiredUnknown}건은 분모 밖)`
          : `좌우 구분 필요 술식 0건 — 확인율 산출 불가(판정 불가 ${requiredUnknown}건)`,
      },
      count: {
        denominator: pf.length,
        mismatchUnresolved: pf.filter((f) => f.countUnresolved).length,
      },
      gateModes: gates,
      // 게이트가 꺼져 있으면 "위반 0"이 준수라는 뜻이 아니다 — 화면이 그렇게 읽지 않게 말해 둔다.
      gateNote: gates.siteVerify === 'OFF'
        ? '오부위 방지 게이트(surgery.siteVerify.enforce)가 OFF 입니다 — 위 갭은 차단되지 않고 통과합니다.'
        : null,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 미이행 워크리스트 — 줄여야 할 목록. `kind=CHECKLIST|SITE|COUNT|ALL`.
   * 분모(scanned)를 함께 내서 "3건"이 3/3 인지 3/46 인지 화면이 알 수 있게 한다.
   */
  async getWorklist(opts: { from?: string; to?: string; kind?: string }) {
    const range = this.resolveRange(opts.from, opts.to);
    const kind = (opts.kind ?? 'ALL').toUpperCase();
    const where: Prisma.SurgeryWhereInput = kind === 'SITE'
      ? { scheduledAt: { gte: range.gte, lt: range.lt }, status: { not: 'CANCELLED' } }
      : kind === 'ALL'
        ? { scheduledAt: { gte: range.gte, lt: range.lt }, status: { not: 'CANCELLED' } }
        : { scheduledAt: { gte: range.gte, lt: range.lt }, status: SurgerySafetyService.PERFORMED };

    const { surgeries, findings } = await this.load(where);
    const byId = new Map(surgeries.map((s) => [s.id, s]));
    const performedStatuses = new Set(['IN_PROGRESS', 'COMPLETED']);

    const items = findings
      .map((f) => {
        const s = byId.get(f.surgeryId)!;
        const performed = performedStatuses.has(f.status);
        const issues: { code: string; label: string; severity: 'HIGH' | 'MEDIUM' }[] = [];
        if (f.lateralityGap && (kind === 'ALL' || kind === 'SITE')) {
          issues.push({ code: 'LATERALITY_MISSING', label: '좌우 구분 필요 술식인데 좌/우 미지정', severity: 'HIGH' });
        }
        // 체크리스트 미이행은 **수술방을 거친 건**에만 의미가 있다(예정 건은 아직 할 때가 아니다).
        if (performed && (kind === 'ALL' || kind === 'CHECKLIST')) {
          if (!f.checklistPresent) {
            issues.push({ code: 'CHECKLIST_ABSENT', label: '수술 안전 체크리스트 기록 자체 없음', severity: 'HIGH' });
          } else {
            for (const ph of f.missingPhases) {
              issues.push({ code: `PHASE_MISSING_${ph}`, label: `${CHECKLIST_PHASE_LABEL[ph]} 미완료`, severity: ph === 'SIGN_OUT' ? 'HIGH' : 'MEDIUM' });
            }
          }
        }
        if (performed && f.countUnresolved && (kind === 'ALL' || kind === 'COUNT')) {
          issues.push({ code: 'COUNT_UNRESOLVED', label: '기구·거즈 계수 불일치 미해소(잔류이물 위험)', severity: 'HIGH' });
        }
        return {
          surgeryId: f.surgeryId,
          procedureName: f.procedureName,
          bodySite: f.bodySite,
          laterality: f.laterality,
          lateralityRequired: f.lateralityRequired,
          status: f.status,
          scheduledAt: f.scheduledAt.toISOString(),
          patient: s.patient ? { id: s.patient.id, mrn: s.patient.mrn, name: `${s.patient.familyName}${s.patient.givenName}` } : null,
          surgeon: s.surgeon ? `${s.surgeon.familyName}${s.surgeon.givenName}` : null,
          issues,
        };
      })
      .filter((i) => i.issues.length > 0)
      .sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1));

    return {
      period: { from: range.from, to: range.to },
      kind,
      // 🔴 분모 — "N건"만 있는 목록은 심각도를 말할 수 없다.
      scanned: findings.length,
      flagged: items.length,
      items,
      basis: findings.length > 0
        ? `${range.from}~${range.to} 대상 수술 ${findings.length}건 중 미이행 ${items.length}건`
        : `${range.from}~${range.to} 대상 수술 0건 — 미이행 여부 산출 불가(0건 아님)`,
      generatedAt: new Date().toISOString(),
    };
  }
}
