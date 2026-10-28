import { Injectable, Logger, Optional } from '@nestjs/common';
import { SurgeryStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { recordGateViolation } from '../../common/gate-violation-record';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { classifyGateEntry, gateMode, summarizeMapGate } from '../../common/gate-mode';
import { nonEmptyStringArrayOr } from '../../common/qi-targets';
import { LATERALITY_REQUIRED_KEYWORDS } from '../../common/laterality-keywords';
import { evaluateSurgerySafety } from '../../common/surgery-safety-canon';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

export interface GateStat {
  key: string;
  label: string;
  domain: string;
  mode: string; // OFF | WARN | BLOCK (정규화)
  rawValue: unknown;
  defaultMode: string;
  violations7d: number;
  violations30d: number;
  overrides30d?: number; // 강제 시행(override) 건수 — 별도 소스 있는 게이트만
  /**
   * 🔴 30일 위반의 **심각도 내역**.
   * 종전엔 화면이 `violations30d` 를 통째로 "차단 N건"이라 불렀는데, 그 수에는 게이트가 WARN 이던
   * 기간의 경고와 OFF 상태 통과까지 섞여 있었다("30일 차단 3건"의 실제는 BLOCK 2 + WARN 1).
   * `undefined` = 이 소스가 심각도를 나눠 셀 수 없음(모르면 화면이 나누지 않는다).
   */
  blocked30d?: number;
  warned30d?: number;
  /**
   * 🔴 30일 내 이 게이트가 **평가된 횟수**(모집단). `undefined` = 소스가 모집단을 낼 수 없음.
   * 위반 0 이 '준수'인지 '평가된 적 없음'인지 가르는 유일한 근거다.
   */
  evaluated30d?: number;
  /** 집계가 실제로 수행됐는가 — false 면 위반 수는 0 이 아니라 '모름' */
  statsAvailable?: boolean;
  /**
   * 🔴 영역별 맵 게이트인가(예: `formulary.enforce`).
   * 참이면 화면은 **스칼라 모드 버튼을 띄우면 안 된다** — 문자열로 PUT 하면 맵 전체가 덮여
   * 영역별 설정이 통째로 사라진다("강화 버튼이 통제를 끄는 경로"). 편집은 전용 화면에서 한다.
   */
  isMap?: boolean;
  /** 영역별 실제 값 — `MEDICATION:WARN · LAB:OFF` */
  mapDetail?: string | null;
  /** 시행 중 영역 수 / 설정된 영역 수(분모) */
  mapActive?: number | null;
  mapTotal?: number | null;
  collectError?: string | null;
  /** 모집단이 있고 그 안에서 위반이 0 일 때만 true — 승격 권고의 유일한 근거 */
  promotionEligible?: boolean;
  recent: { at: string; severity: string; message: string; ref?: string }[];
  statsSource: string; // 집계 소스 설명('없음'=모드만 표시)
}

interface GateDef {
  key: string;
  label: string;
  domain: string;
  defaultMode: string;
  collect?: (svc: SafetyGateService, d7: Date, d30: Date) => Promise<Pick<GateStat, 'violations7d' | 'violations30d' | 'overrides30d' | 'blocked30d' | 'warned30d' | 'recent'>>;
  statsSource: string;
}

const RECENT_LIMIT = 5;

/**
 * 안전 게이트 관제 — 게이트별 현재 모드+위반 통계+최근 사례를 집계.
 * 목적: WARN→BLOCK 승격 판단을 로그 관찰이 아닌 화면 데이터로.
 * 소스: 도메인별 영속 데이터(imaging/rehab safetyChecks·CdssLog·격리강박) + 범용 GateViolationLog.
 */
@Injectable()
export class SafetyGateService {
  private readonly logger = new Logger(SafetyGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly drift?: DriftRecorderService,
  ) {}

  /**
   * 🔴 관측점(axis C): safetyChecks JSON 은 생산자(imaging-safety·rehab)와 이 롤업이 **다른 파일**에서
   *    같은 모양(`{checks:[{rule,level,message}],overridden}`)을 각자 리터럴로 가정한다 — 생산자가 모양을
   *    바꾸면 위반이 전부 0 이 되어 화면이 '준수'라 말한다. 값이 있는데 checks 배열이 아니면 원장에 적는다.
   */
  private observeChecksShape(producer: string, raw: unknown, sc: { checks?: unknown } | null) {
    if (raw != null && !Array.isArray(sc?.checks)) {
      this.drift?.record({
        kind: 'KEY_MISSING',
        producer,
        consumer: 'safety-gate.fromChecks',
        detail: `safetyChecks 에 checks 배열이 없음 · 실제 키: ${typeof raw === 'object' ? Object.keys(raw as object).join(', ').slice(0, 200) : typeof raw}`,
      });
    }
  }

  /**
   * 범용 위반 기록(다른 모듈이 호출) — 던지지 않되 **유실은 말한다**(정본 `common/gate-violation-record`).
   * 🔴 종전엔 `.catch(() => undefined)` 라 기록 실패가 아무 흔적도 남기지 않았다 —
   *    그러면 이 서비스가 그리는 관제 화면의 "위반 0"이 사실인지 아무도 확인할 수 없다.
   */
  async record(gateKey: string, severity: string, message: string, refType?: string, refId?: string) {
    await recordGateViolation(this.prisma, this.logger, { gateKey, severity, message, refType, refId });
  }

  /**
   * 🔴 위반이 **아닌** 원장 항목 — 위반 집계에서 제외한다.
   *   · `OVERRIDE` — 사람이 근거를 남기고 강제 시행한 건(별도 집계).
   *   · `EXEMPT` — **정책상 면제**로 게이트를 평가하지 않고 통과시킨 건(2026-08-26 신설).
   *     예: 사망·전원 퇴원(`inpatient.dischargeGate`). 면제를 위반으로 세면 붉은 숫자가 올라가
   *     진짜 위반이 묻힌다 — 거짓 경보는 진짜 경보를 죽인다.
   *     그렇다고 안 남기면 "0건"이 '준수'인지 '면제로 빠져나간 것'인지 구분되지 않으므로,
   *     집계에서만 빼고 **최근 목록(recent)에는 그대로 보이게** 한다.
   */
  private static readonly NON_VIOLATION_SEVERITIES = ['OVERRIDE', 'EXEMPT'];

  private async fromViolationLog(gateKey: string, d7: Date, d30: Date) {
    const notViolation = { notIn: SafetyGateService.NON_VIOLATION_SEVERITIES };
    const [v7, v30, o30, b30, w30, recent] = await Promise.all([
      this.prisma.gateViolationLog.count({ where: { gateKey, createdAt: { gte: d7 }, severity: notViolation } }),
      this.prisma.gateViolationLog.count({ where: { gateKey, createdAt: { gte: d30 }, severity: notViolation } }),
      this.prisma.gateViolationLog.count({ where: { gateKey, createdAt: { gte: d30 }, severity: 'OVERRIDE' } }),
      // 🔴 심각도를 나눠 센다 — 차단과 경고는 다른 사실이다
      this.prisma.gateViolationLog.count({ where: { gateKey, createdAt: { gte: d30 }, severity: 'BLOCK' } }),
      this.prisma.gateViolationLog.count({ where: { gateKey, createdAt: { gte: d30 }, severity: 'WARN' } }),
      this.prisma.gateViolationLog.findMany({
        where: { gateKey }, orderBy: { createdAt: 'desc' }, take: RECENT_LIMIT,
        select: { createdAt: true, severity: true, message: true, refType: true, refId: true },
      }),
    ]);
    return {
      violations7d: v7, violations30d: v30, blocked30d: b30, warned30d: w30, ...(o30 > 0 ? { overrides30d: o30 } : {}),
      recent: recent.map((r) => ({ at: r.createdAt.toISOString(), severity: r.severity, message: r.message, ref: r.refId ? `${r.refType ?? ''}:${r.refId}` : undefined })),
    };
  }

  /**
   * 퇴원 게이트 — 위반은 원장에서, **모집단은 실제 퇴원 건수**에서 센다.
   *
   * 🔴 2026-08-26: 이 게이트는 2026-07-24 부터 `true` 인데 위반이 어디에도 영속되지 않아
   *    관제가 "0건"의 뜻을 영영 구분할 수 없었다. 이제 차단·면제가 원장에 남고,
   *    분모(퇴원 전이 건수)를 함께 낸다 — 분모가 0이면 "위반 0"은 안전이 아니라 **표본 없음**이다.
   */
  private async fromDischargeGate(d7: Date, d30: Date) {
    const base = await this.fromViolationLog('inpatient.dischargeGate', d7, d30);
    const evaluated30d = await this.prisma.admission.count({
      where: { status: { in: ['DISCHARGED', 'TRANSFERRED'] }, dischargeDate: { gte: d30 } },
    });
    return { ...base, evaluated30d };
  }

  /** imaging_results.safetyChecks(Json)에서 특정 rule의 위반 집계 */
  private async fromImagingChecks(rules: string[], d7: Date, d30: Date) {
    const rows = await this.prisma.imagingResult.findMany({
      where: { createdAt: { gte: d30 } },
      select: { id: true, createdAt: true, safetyChecks: true },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const hits: { at: Date; severity: string; message: string; ref: string; overridden: boolean }[] = [];
    for (const r of rows) {
      const sc = r.safetyChecks as { checks?: { rule: string; level: string; message: string }[]; overridden?: boolean } | null;
      this.observeChecksShape('imaging-safety.safetyChecks', r.safetyChecks, sc);
      for (const c of sc?.checks ?? []) {
        if (rules.includes(c.rule) && (c.level === 'ERROR' || c.level === 'WARNING')) {
          hits.push({ at: r.createdAt, severity: c.level === 'ERROR' ? 'BLOCK-급' : 'WARN', message: c.message, ref: `imaging:${r.id}`, overridden: !!sc?.overridden });
        }
      }
    }
    return {
      violations7d: hits.filter((h) => h.at >= d7).length,
      violations30d: hits.length,
      overrides30d: hits.filter((h) => h.overridden).length,
      evaluated30d: rows.length, // 🔴 모집단 — 검사 자체가 0건이면 '위반 0'은 준수가 아니다
      recent: hits.slice(0, RECENT_LIMIT).map((h) => ({ at: h.at.toISOString(), severity: h.severity, message: h.message, ref: h.ref })),
    };
  }

  private async fromRehabChecks(d7: Date, d30: Date) {
    const rows = await this.prisma.rehabSession.findMany({
      where: { startTime: { gte: d30 } },
      select: { id: true, startTime: true, safetyChecks: true },
      orderBy: { startTime: 'desc' },
      take: 2000,
    });
    const hits: { at: Date; severity: string; message: string; ref: string; overridden: boolean }[] = [];
    for (const r of rows) {
      const sc = r.safetyChecks as { checks?: { rule: string; level: string; message: string }[]; overridden?: boolean } | null;
      this.observeChecksShape('rehab.safetyChecks', r.safetyChecks, sc);
      for (const c of sc?.checks ?? []) {
        if (c.level === 'ERROR' || c.level === 'WARNING') {
          hits.push({ at: r.startTime ?? new Date(), severity: c.level === 'ERROR' ? 'HOLD' : 'WARN', message: c.message, ref: `rehab:${r.id}`, overridden: !!sc?.overridden });
        }
      }
    }
    return {
      violations7d: hits.filter((h) => h.at >= d7).length,
      violations30d: hits.length,
      overrides30d: hits.filter((h) => h.overridden).length,
      evaluated30d: rows.length,
      recent: hits.slice(0, RECENT_LIMIT).map((h) => ({ at: h.at.toISOString(), severity: h.severity, message: h.message, ref: h.ref })),
    };
  }

  private async fromCdssLog(d7: Date, d30: Date) {
    const [v7, v30, o30, recent] = await Promise.all([
      this.prisma.cdssLog.count({ where: { overallLevel: { in: ['ERROR', 'WARNING'] }, createdAt: { gte: d7 } } }),
      this.prisma.cdssLog.count({ where: { overallLevel: { in: ['ERROR', 'WARNING'] }, createdAt: { gte: d30 } } }),
      this.prisma.cdssLog.count({ where: { overridden: true, createdAt: { gte: d30 } } }),
      this.prisma.cdssLog.findMany({
        where: { overallLevel: { in: ['ERROR', 'WARNING'] } }, orderBy: { createdAt: 'desc' }, take: RECENT_LIMIT,
        select: { createdAt: true, overallLevel: true, alerts: true, overridden: true },
      }),
    ]);
    // 🔴 모집단(평가 횟수)을 함께 낸다 — 0건이 '준수'인지 '평가된 적 없음'인지 화면이 구분해야 한다
    const evaluated30d = await this.prisma.cdssLog.count({ where: { createdAt: { gte: d30 } } });
    return {
      violations7d: v7, violations30d: v30, overrides30d: o30, evaluated30d,
      recent: recent.map((r) => {
        const first = Array.isArray(r.alerts) ? (r.alerts as { message?: string }[])[0] : null;
        return { at: r.createdAt.toISOString(), severity: r.overallLevel + (r.overridden ? '·override' : ''), message: first?.message ?? 'CDSS 경고' };
      }),
    };
  }

  private async fromSeclusion(d7: Date, d30: Date) {
    const now = new Date();
    const [unverified30, overdueActive, recent] = await Promise.all([
      this.prisma.psychSeclusionOrder.count({ where: { psychiatristVerified: false, createdAt: { gte: d30 } } }),
      this.prisma.psychSeclusionOrder.count({ where: { status: 'ACTIVE', legalMaxUntil: { lt: now } } }),
      this.prisma.psychSeclusionOrder.findMany({
        where: { OR: [{ psychiatristVerified: false }, { status: 'ACTIVE', legalMaxUntil: { lt: now } }] },
        orderBy: { createdAt: 'desc' }, take: RECENT_LIMIT,
        select: { createdAt: true, type: true, psychiatristVerified: true, legalMaxUntil: true, status: true },
      }),
    ]);
    const unverified7 = await this.prisma.psychSeclusionOrder.count({ where: { psychiatristVerified: false, createdAt: { gte: d7 } } });
    const evaluated30d = await this.prisma.psychSeclusionOrder.count({ where: { createdAt: { gte: d30 } } });
    return {
      violations7d: unverified7 + overdueActive,
      violations30d: unverified30 + overdueActive,
      evaluated30d,
      recent: recent.map((r) => ({
        at: r.createdAt.toISOString(),
        severity: r.status === 'ACTIVE' && r.legalMaxUntil < now ? '법정시간 초과' : '전문의 미검증',
        message: `${r.type === 'SECLUSION' ? '격리' : '강박'} — ${r.psychiatristVerified ? '' : '지시자 전문의 미검증'}${r.status === 'ACTIVE' && r.legalMaxUntil < now ? ' / 법정 최대시간 초과 진행 중' : ''}`,
      })),
    };
  }

  /**
   * 수술 안전(IPSG.4) 게이트 통계 — **원장(GateViolationLog)이 아니라 실제 수술 데이터**에서 센다.
   *
   * 🔴 왜 로그가 아닌가: 이 게이트들은 오래 OFF 였다. OFF 인 게이트는 로그를 남기지 않으므로
   *    "위반 0" 이 곧 "준수"로 읽힌다 — 안전 화면이 근거 없이 안심시키는 전형(P17).
   *    실제 수술·체크리스트 행을 세면 **게이트가 꺼져 있어도** 켰을 때 몇 건이 걸렸을지 나온다.
   *    그게 WARN→BLOCK 승격 판단에 필요한 유일한 숫자다. 모집단(evaluated30d)을 항상 함께 낸다.
   */
  /**
   * 🔴 BCMA(투약 전 바코드 스캔) — **원장에서 직접 센다.**
   *
   * 2026-08-21 실측: 운영 게이트는 `WARN` 으로 켜져 있는데
   *   · `medication_administrations.bcma_scan_at` **전건 NULL**(스캔 기록 0)
   *   · `gate_violation_logs` 에 BCMA 행 **0**
   * 였다. 우회 흔적이 `notes` 문자열(`[BCMA-BYPASS …]`)에만 남아 관제가 **"위반 0"** 으로 보였다 —
   * v4.4.0 "게이트가 BLOCK 인데 위반 0행이 곧 탐지기가 죽음이었다"와 같은 유형이다.
   *
   * 🔴 위반 수만 세면 커버리지를 모른다. **모집단(투약 시행 건)** 을 함께 낸다 —
   *    분모가 0이면 "위반 0"은 안전이 아니라 **표본 없음**이다.
   */
  private async fromBcma(d7: Date, d30: Date) {
    const scope = { status: 'ADMINISTERED' as const };
    const [n7, n30, scanned7, scanned30, recent] = await Promise.all([
      this.prisma.medicationAdministration.count({ where: { ...scope, administeredAt: { gte: d7 } } }),
      this.prisma.medicationAdministration.count({ where: { ...scope, administeredAt: { gte: d30 } } }),
      this.prisma.medicationAdministration.count({ where: { ...scope, administeredAt: { gte: d7 }, bcmaScanAt: { not: null } } }),
      this.prisma.medicationAdministration.count({ where: { ...scope, administeredAt: { gte: d30 }, bcmaScanAt: { not: null } } }),
      this.prisma.medicationAdministration.findMany({
        where: { ...scope, administeredAt: { gte: d30 }, bcmaScanAt: null },
        orderBy: { administeredAt: 'desc' }, take: RECENT_LIMIT,
        select: { id: true, administeredAt: true, dose: true },
      }),
    ]);
    return {
      // 위반 = 투약했는데 스캔 기록이 없는 건
      violations7d: n7 - scanned7,
      violations30d: n30 - scanned30,
      evaluated30d: n30,
      recent: recent.map((r) => ({
        at: (r.administeredAt ?? new Date()).toISOString(),
        severity: 'WARN',
        message: `BCMA 스캔 기록 없이 투약(${r.dose ?? '용량 미기재'})`,
        ref: r.id,
      })),
    };
  }

  private async fromSurgerySafety(aspect: 'SITE' | 'SIGN_OUT' | 'COUNT', d7: Date, d30: Date) {
    const scope = aspect === 'SITE'
      // 부위·좌우는 '예약된 것' 전부가 모집단(수술 전에 잡아야 의미가 있다)
      ? { scheduledAt: { gte: d30 } }
      // 체크리스트 이행은 '수술방을 거친 것'이 모집단
      : { scheduledAt: { gte: d30 }, status: { in: [SurgeryStatus.IN_PROGRESS, SurgeryStatus.COMPLETED] } };
    const surgeries = await this.prisma.surgery.findMany({
      where: scope,
      select: { id: true, procedureName: true, bodySite: true, laterality: true, status: true, scheduledAt: true },
      orderBy: { scheduledAt: 'desc' },
      take: 2000,
    });
    if (!surgeries.length) {
      return { violations7d: 0, violations30d: 0, evaluated30d: 0, recent: [] };
    }
    const checklists = await this.prisma.surgicalChecklist.findMany({
      where: { surgeryId: { in: surgeries.map((s) => s.id) } },
      select: {
        surgeryId: true, signInCompletedAt: true, timeOutCompletedAt: true,
        signOutCompletedAt: true, countStatus: true, countDiscrepancyNote: true,
      },
    });
    const byId = new Map(checklists.map((c) => [c.surgeryId, c]));
    const keywords = nonEmptyStringArrayOr(
      await this.config?.get('surgery.lateralityKeywords').catch(() => null),
      LATERALITY_REQUIRED_KEYWORDS,
    );
    const hits: { at: Date; severity: string; message: string; ref: string }[] = [];
    for (const s of surgeries) {
      const f = evaluateSurgerySafety({ ...s, laterality: s.laterality ?? null }, byId.get(s.id), keywords);
      if (aspect === 'SITE' && f.lateralityGap) {
        hits.push({ at: s.scheduledAt, severity: '좌우 미지정', message: `${s.procedureName}${s.bodySite ? ` (${s.bodySite})` : ''} — 좌우 구분 필요 술식인데 laterality 미지정`, ref: `surgery:${s.id}` });
      }
      if (aspect === 'SIGN_OUT' && f.missingPhases.includes('SIGN_OUT')) {
        hits.push({ at: s.scheduledAt, severity: f.checklistPresent ? 'Sign-Out 미완료' : '체크리스트 없음', message: `${s.procedureName} — ${f.checklistPresent ? 'Sign-Out 미완료' : '체크리스트 기록 자체 없음'}`, ref: `surgery:${s.id}` });
      }
      if (aspect === 'COUNT' && f.countUnresolved) {
        hits.push({ at: s.scheduledAt, severity: '계수 불일치 미해소', message: `${s.procedureName} — 기구·거즈 계수 MISMATCH 해소기록 없음(잔류이물 위험)`, ref: `surgery:${s.id}` });
      }
    }
    return {
      violations7d: hits.filter((h) => h.at >= d7).length,
      violations30d: hits.length,
      evaluated30d: surgeries.length,
      recent: hits.slice(0, RECENT_LIMIT).map((h) => ({ at: h.at.toISOString(), severity: h.severity, message: h.message, ref: h.ref })),
    };
  }

  /** 게이트 정의 — 통계 소스가 연결된 것 + 모드만 표시할 것(DEFAULTS 카탈로그에서 자동 수집) */
  private wiredGates(): GateDef[] {
    return [
      { key: 'dur.enforce', label: 'DUR 처방 게이트(병용금기·임부·알레르기·용량 — create/copy/repeat)', domain: '처방', defaultMode: 'BLOCK', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('dur.enforce', d7, d30) },
      { key: 'pharmacy.durGate.enforce', label: 'DUR 조제 게이트(미해결 경고 조제 차단·§37)', domain: '약국', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('pharmacy.durGate.enforce', d7, d30) },
      { key: 'cdss.enforce', label: 'CDSS 처방 검증(알레르기·신기능·연령)', domain: '처방', defaultMode: 'OFF', statsSource: 'CdssLog', collect: (s, d7, d30) => s.fromCdssLog(d7, d30) },
      { key: 'imaging.contrastEnforce', label: '조영제 안전(알레르기·eGFR)', domain: '영상', defaultMode: 'OFF', statsSource: 'imaging safetyChecks', collect: (s, d7, d30) => s.fromImagingChecks(['CONTRAST_ALLERGY', 'CONTRAST_RENAL'], d7, d30) },
      { key: 'imaging.pregnancyEnforce', label: '임신확인(가임기 전리방사선)', domain: '영상', defaultMode: 'OFF', statsSource: 'imaging safetyChecks', collect: (s, d7, d30) => s.fromImagingChecks(['PREGNANCY'], d7, d30) },
      { key: 'rehab.sessionGate', label: '재활 시행(낙상 Berg·활력징후 hold)', domain: '재활', defaultMode: 'OFF', statsSource: 'rehab safetyChecks', collect: (s, d7, d30) => s.fromRehabChecks(d7, d30) },
      { key: 'inventory.expiryIssueEnforce', label: '만료/리콜 LOT 불출', domain: '물류', defaultMode: 'WARN', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('inventory.expiryIssueEnforce', d7, d30) },
      { key: 'equipment.useEnforce', label: '사용중지 장비 사용', domain: '물류', defaultMode: 'WARN', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('equipment.useEnforce', d7, d30) },
      { key: 'psychiatry.seclusionEnforce', label: '§75 격리·강박 전문의 게이트', domain: '정신과', defaultMode: 'WARN', statsSource: '격리강박 원장', collect: (s, d7, d30) => s.fromSeclusion(d7, d30) },
      { key: 'psychiatry.ectConsentEnforce', label: 'ECT 동의 게이트', domain: '정신과', defaultMode: 'BLOCK', statsSource: '없음(차단형 — 시도 미영속)' },
      // 2026-08-03 추가 — 게이트는 있었는데 관제에 없어 위반 통계도, 승격 판단 근거도 없었다
      { key: 'encounter.requireDiagnosisOnSign', label: '진료 서명 상병(진단) 필수 — 청구 심사 삭감·반려 방지', domain: '진료', defaultMode: 'WARN', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('encounter.requireDiagnosisOnSign', d7, d30) },
      // 🔴 2026-08-14 추가 — 화면 실사용 점검 W8.
      //    `formulary.enforce` 는 화면이 "시행 게이트 WARN/BLOCK"이라 말했지만 **처방 발행 경로에 검사가 0건**이었고
      //    집행은 진료작성 FE 한 화면뿐이라 모바일·워크스테이션·API 직접 호출은 전부 통과했다.
      //    W8 에서 서버 집행(create·copy·repeat)을 붙여 GateViolationLog 가 쌓이기 시작했으므로,
      //    관제도 모드만이 아니라 **위반 통계와 승격 근거**를 함께 봐야 한다.
      //    (이 저장소 규약: EP 를 만들면 부르는 화면까지가 한 벌 — 기록만 쌓고 보여주지 않으면 절반이다.)
      /**
       * 🔴 2026-08-18 추가 — 수술 안전(IPSG.4). 게이트는 셋 다 코드에 있었는데 관제에 하나도 없었다.
       *    게다가 `surgery.signOutEnforce`·`surgery.countEnforce` 는 호출부가 `=== 'BLOCK'` 만 봐서
       *    **WARN 이 OFF 와 동일**했고(위반 미기록), `surgery.siteVerify.enforce` 는 Sign-In 한 곳뿐이었다.
       *    "다른 환자·부위의 수술"은 환자안전법 의무보고 4유형 중 하나다 — 관제에서 빠져 있을 자리가 아니다.
       */
      { key: 'surgery.siteVerify.enforce', label: '오부위수술 방지 — 좌우구분 술식 laterality 미기재(예약·Sign-In)', domain: '수술', defaultMode: 'OFF', statsSource: '수술 원장 실측(예약 전건 — 게이트 OFF 여도 산출)', collect: (s, d7, d30) => s.fromSurgerySafety('SITE', d7, d30) },
      { key: 'surgery.signOutEnforce', label: 'IPSG.4 Sign-Out 게이트 — 수술 종료 전 체크리스트 미완료', domain: '수술', defaultMode: 'BLOCK', statsSource: '수술·체크리스트 원장 실측', collect: (s, d7, d30) => s.fromSurgerySafety('SIGN_OUT', d7, d30) },
      { key: 'surgery.countEnforce', label: '수술 계수 대조 — 기구·거즈 불일치 미해소(잔류이물)', domain: '수술', defaultMode: 'OFF', statsSource: '수술·체크리스트 원장 실측', collect: (s, d7, d30) => s.fromSurgerySafety('COUNT', d7, d30) },
      /**
       * 🔴 2026-08-21 추가 — 투약 흐름 검토(계획서 §3 #1). 게이트는 운영에서 `WARN` 인데
       *    관제에 없어 **스캔율을 아무도 몰랐다**(스캔 기록 0 · 위반 원장 0).
       *    이제 우회는 `GateViolationLog` 에 남고, 통계는 **투약 원장 실측**으로 분모와 함께 낸다.
       */
      { key: 'nursing.bcma.enforce', label: 'BCMA 투약 스캔 — 손목밴드+약품 바코드 미스캔 투약', domain: '간호', defaultMode: 'OFF', statsSource: '투약 원장 실측(ADMINISTERED 전건이 모집단)', collect: (s, d7, d30) => s.fromBcma(d7, d30) },
      { key: 'formulary.enforce', label: '원내 처방집(포뮬러리) 시행 게이트 — 미등재·미승인 처방(create/copy/repeat)', domain: '처방', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('formulary.enforce', d7, d30) },
      /**
       * 🔴 2026-08-26 추가 — A4 전수 판정. 아래 게이트들은 **켜져 있는데 위반이 아무 곳에도
       *    영속되지 않았다**(예외만 던지거나 `logger.warn` 뿐). 관제에는 아예 없거나 모드만 떠서
       *    "0건"이 준수인지 미평가인지 구분할 방법이 없었다 — v4.4.0 DUR 43룰과 같은 유형이다.
       *    이제 각 호출부가 `record()` 를 부르므로 통계 소스를 붙인다.
       *
       *    🔴 `GateViolationLog` 는 **위반만 적재**하므로 모집단(`evaluated30d`)을 낼 수 없다 →
       *       `promotionEligible=false` 가 되어 화면이 '표본 미상'으로 말하고 승격을 권하지 않는다.
       *       근거 없이 안심시키지 않는 것이 여기서는 맞다(P17). 분모를 낼 수 있는 퇴원 게이트만
       *       전용 수집기를 쓴다.
       */
      { key: 'inpatient.dischargeGate', label: '퇴원 게이트 — 퇴원요약 미서명·수납 잔액 미납(전원·사망은 면제)', domain: '입원', defaultMode: 'OFF', statsSource: 'GateViolationLog + 퇴원 원장 실측(분모)', collect: (s, d7, d30) => s.fromDischargeGate(d7, d30) },
      { key: 'surgery.preAnesthesiaGate', label: '마취전평가 게이트 — 평가 없이 Sign-In', domain: '수술', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('surgery.preAnesthesiaGate', d7, d30) },
      { key: 'radiation.doseEnforce', label: '방사선 과선량 게이트 — 분할선량 이탈·누적선량 초과', domain: '방사선', defaultMode: 'BLOCK', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('radiation.doseEnforce', d7, d30) },
      { key: 'radiation.igrtEnforce', label: 'IGRT 셋업검증 게이트 — 영상유도 필요 기법인데 셋업검증 미완(오부위 RT)', domain: '방사선', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('radiation.igrtEnforce', d7, d30) },
      { key: 'obgyn.newbornId.enforce', label: '신생아 식별밴드 게이트 — 밴드 없이 신생아 등록(모아 오식별)', domain: '산부인과', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('obgyn.newbornId.enforce', d7, d30) },
      { key: 'cssd.biCiEnforce', label: 'CSSD BI/CI 게이트 — 지표 PASS 없이 STERILE 확정(비멸균 출고)', domain: '중앙공급', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('cssd.biCiEnforce', d7, d30) },
      { key: 'dialysis.ufRateEnforce', label: '투석 UF율 게이트 — 시간당 제수율 안전상한 초과 처방(투석중 저혈압)', domain: '투석', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('dialysis.ufRateEnforce', d7, d30) },
      { key: 'bloodbank.issueEnforce', label: '혈액 출고 게이트 — 교차시험 미완·ABO 부적합·만료 혈액 출고', domain: '혈액은행', defaultMode: 'BLOCK', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('bloodbank.issueEnforce', d7, d30) },
      { key: 'bloodBank.bedsideScan.enforce', label: '수혈 전 베드사이드 스캔 게이트 — 환자·혈액백 대조 없이 수혈 시작', domain: '혈액은행', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('bloodBank.bedsideScan.enforce', d7, d30) },
      { key: 'queue.completeRequiresSign', label: '진료 완료 게이트 — 진료기록 서명 없이 대기열 완료 처리', domain: '외래', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('queue.completeRequiresSign', d7, d30) },
      /**
       * 🔴 2026-08-26 추가 — 약국 조제 게이트 2종. 둘 다 **집행은 하는데 원장에 남기지 않아**
       *    관제에서 영원히 "위반 0건"이었다(BLOCK 은 예외만, WARN 은 `logger.warn` 뿐).
       *    이제 `PharmacyService` 가 `record()` 를 부른다.
       *
       *    🔴 두 게이트는 2026-08-26 현재 운영 `system_configs` 에 **행이 없다** → 등록 기본값이 곧 실효 모드다
       *       (`pharmacy.highAlertDoubleCheck`=BLOCK fail-closed · `asp.enforce`=OFF).
       *       그리고 평가 모집단이 실제로 0 이다(고위험/마약류 참조 조제 0건 ·
       *       `medication_codes.aspRestrictedLevel` 전량 NULL) — **"0건"은 준수가 아니라 표본 없음**이다.
       *       `GateViolationLog` 는 위반만 적재해 분모를 못 내므로 `promotionEligible=false` 로 남는다.
       *       화면이 승격을 권하지 않는 것이 여기서는 맞다(근거 없이 안심시키지 않는다).
       */
      { key: 'pharmacy.highAlertDoubleCheck', label: '고위험약/마약류 조제 2인확인 게이트 — 조제약사≠2차확인자 미충족(ISMP)', domain: '약국', defaultMode: 'BLOCK', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('pharmacy.highAlertDoubleCheck', d7, d30) },
      { key: 'asp.enforce', label: '항생제 스튜어드십(ASP) 조제 게이트 — 제한항생제인데 ASP 미승인', domain: '약국', defaultMode: 'OFF', statsSource: 'GateViolationLog', collect: (s, d7, d30) => s.fromViolationLog('asp.enforce', d7, d30) },
    ];
  }

  async getDashboard() {
    const now = Date.now();
    const d7 = new Date(now - 7 * 86400000);
    const d30 = new Date(now - 30 * 86400000);
    const defs = this.wiredGates();

    const gates: GateStat[] = [];
    for (const def of defs) {
      const raw = await this.config?.get(def.key);
      // 🔴 영역별 맵 게이트는 `gateMode` 로 접으면 `"[object Object]"` 가 되어 **무조건 BLOCK** 이 된다.
      //    실제로 `formulary.enforce` 는 전 영역 OFF 여도 관제에 BLOCK 으로 떴다(정반대의 사실).
      //    맵은 **최저 영역 기준**(floor)으로 접고 커버리지를 함께 낸다 — go-live 판정과 같은 규칙.
      const isMapGate = !!raw && typeof raw === 'object' && !Array.isArray(raw);
      const mapSummary = isMapGate ? summarizeMapGate(raw) : null;
      const mode = mapSummary ? mapSummary.mode : gateMode(raw, def.defaultMode as 'OFF' | 'WARN' | 'BLOCK');
      /**
       * 🔴 2026-08-14(W7) — "위반 0건"의 뜻을 화면이 구분할 수 있게 한다.
       *
       * 종전에는 세 가지가 전부 `violations30d: 0` 이라는 **같은 모양**으로 나갔다:
       *   ⓐ 게이트가 여러 번 평가됐고 위반이 없었다(= 진짜 준수)
       *   ⓑ 게이트가 **한 번도 평가된 적 없다**(모집단 0 — 판단 근거 없음)
       *   ⓒ **집계 쿼리가 실패했다**(`catch {}` 로 삼킴)
       * 그 위에 화면은 "30일 위반 0건 — BLOCK 승격 검토"라는 **초록 권고**까지 얹었다.
       * 실측: cdss_logs 0행 · equipment_usage_logs 0행 · psych_seclusion_orders 0행 등
       * **6종이 개통 이래 한 번도 평가된 적 없는데** 전부 승격 권고 대상으로 떴다.
       *
       * 승격은 안전 통제를 강화하는 결정이다 — 근거가 없으면 없다고 말해야 한다.
       */
      let stats: Pick<GateStat, 'violations7d' | 'violations30d' | 'overrides30d' | 'evaluated30d' | 'recent'> = {
        violations7d: 0, violations30d: 0, recent: [],
      };
      let collectError: string | null = null;
      let collected = false;
      if (def.collect) {
        try {
          stats = await def.collect(this, d7, d30);
          collected = true;
        } catch (err) {
          collectError = err instanceof Error ? err.message : '집계 실패';
        }
      }
      gates.push({
        // 🔴 맵 게이트는 스칼라 모드 버튼으로 바꾸면 안 된다(맵 전체가 문자열로 덮인다) — 화면이 이 값으로 판단한다
        isMap: !!mapSummary,
        mapDetail: mapSummary?.detail ?? null,
        mapActive: mapSummary?.active ?? null,
        mapTotal: mapSummary?.total ?? null,
        key: def.key, label: def.label, domain: def.domain, mode, rawValue: raw ?? null,
        defaultMode: def.defaultMode, statsSource: def.statsSource, ...stats,
        // 집계가 돌지 않았으면 위반 수는 '0'이 아니라 '모름'이다
        statsAvailable: collected && !collectError,
        collectError,
        /**
         * 승격 검토를 권할 수 있는가 — **모집단이 있고 그 안에서 위반이 0** 일 때만.
         * `evaluated30d` 를 내지 못하는 소스(GateViolationLog 는 위반만 적재)는 `null` →
         * 화면은 '표본 미상'으로 표시하고 권고하지 않는다.
         */
        promotionEligible:
          collected && !collectError && typeof stats.evaluated30d === 'number'
            ? stats.evaluated30d > 0 && (stats.violations30d ?? 0) === 0
            : false,
      });
    }

    // 그 외 게이트(모드만) — 분류기(classifyGateEntry) 기반: 3상 문자열 + Map형(영역/유형별) + boolean.
    // 종전엔 문자열 3상만 수집해 Map형 3종·boolean 게이트가 관제 사각이었다(§7 P1·헬스체크 실검출).
    const all = (await this.config?.getAll()) as { key: string; value: unknown; description?: string }[] | undefined;
    const wiredKeys = new Set(defs.map((d) => d.key));
    const others: { key: string; label: string; type: string; mode: string; detail?: string; rawValue: unknown }[] = [];
    for (const c of all ?? []) {
      if (wiredKeys.has(c.key)) continue;
      const type = classifyGateEntry(c);
      if (!type) continue;
      const label = c.description?.split('—')[0]?.trim() ?? c.key;
      if (type === 'MAP') {
        // 🔴 종전엔 "하나라도 BLOCK 이면 BLOCK"(최강 기준)이라 7영역 중 1개만 BLOCK 이어도
        //    붉은 배지가 떠 **여섯 영역이 열려 있다는 사실이 가려졌다.** 안전은 가장 약한 고리로 정해진다.
        const sum = summarizeMapGate(c.value);
        const detail = sum.unset ? '설정된 영역 없음' : `${sum.detail} (시행 ${sum.active}/${sum.total})`;
        others.push({ key: c.key, label, type, mode: sum.mode, detail, rawValue: c.value });
      } else if (type === 'BOOL') {
        others.push({ key: c.key, label, type, mode: c.value ? 'ON' : 'OFF', rawValue: c.value });
      } else {
        others.push({ key: c.key, label, type, mode: gateMode(c.value, 'OFF'), rawValue: c.value });
      }
    }

    return { generatedAt: new Date().toISOString(), gates, others };
  }
}
