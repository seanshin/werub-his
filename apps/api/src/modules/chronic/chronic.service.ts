import { Injectable, Optional, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateChronicObservationDto } from './dto/create-chronic-observation.dto';
import { CHRONIC_GUIDELINE, conditionForDiagnosis, meetsTarget, GuidelineCondition } from './chronic-guideline';
import { NotificationService } from '../notification/notification.service';
import { JourneyService } from '../journey/journey.service';
import { isPatientReportedSource, PATIENT_REPORTED_SOURCES } from '@hospital-run/shared';

export interface TrendQuery { codes?: string[]; from?: Date; to?: Date; limit?: number; includeAcute?: boolean }

// 만성 추적관리 — 모니터링 리콜 주기(일). 분기 1회 권고(DM HbA1c·HTN BP).
const RECALL_DAYS = 90;

/** 코드별 기본 단위·정상범위(혈압/체중/혈당). 기록 시 flag·정상범위 자동 산정에 사용 */
const CODE_SPEC: Record<string, { unit: string; min: number | null; max: number | null }> = {
  HBA1C: { unit: '%', min: 4.0, max: 6.5 },
  FBS: { unit: 'mg/dL', min: 70, max: 100 },
  PPG: { unit: 'mg/dL', min: null, max: 140 },
  SBP: { unit: 'mmHg', min: null, max: 120 },
  DBP: { unit: 'mmHg', min: null, max: 80 },
  WEIGHT: { unit: 'kg', min: null, max: null },
  BMI: { unit: 'kg/m2', min: 18.5, max: 23 },
};
const flagOf = (v: number, min: number | null, max: number | null): string =>
  max != null && v > max ? 'H' : min != null && v < min ? 'L' : 'N';

// 추세 판정 방향 — true=낮을수록 양호, false=높을수록 양호, undefined=중립(체중 등)
const LOWER_IS_BETTER: Record<string, boolean> = {
  HBA1C: true, FBS: true, PPG: true, SBP: true, DBP: true, LDL: true, TG: true, CR: true, BMI: true,
  EGFR: false, HDL: false,
};

/**
 * temporal abstraction(P3d) — 시계열을 안정/개선/악화로 자동 판정.
 * 전반부 평균 vs 후반부 평균(상대변화)으로 추세, 지표 방향(LOWER_IS_BETTER)으로 개선/악화 해석.
 * 가드레일: 3회 미만은 null(데이터 부족), 중립지표는 null.
 */
function classifyTrend(arr: { value: number }[], code: string): 'IMPROVING' | 'WORSENING' | 'STABLE' | null {
  if (arr.length < 3) return null;
  const dir = LOWER_IS_BETTER[code];
  if (dir === undefined) return null; // 중립 지표(체중 등)는 방향 판정 안 함
  const half = Math.floor(arr.length / 2);
  const mean = (a: { value: number }[]) => a.reduce((s, x) => s + x.value, 0) / a.length;
  const firstMean = mean(arr.slice(0, half));
  const lastMean = mean(arr.slice(arr.length - half));
  const diff = lastMean - firstMean;
  const vals = arr.map((x) => x.value);
  const range = Math.max(...vals) - Math.min(...vals);
  const rel = Math.abs(diff) / (range || Math.abs(firstMean) || 1);
  if (rel < 0.07) return 'STABLE'; // 7% 미만 변화는 안정
  const improving = dir ? diff < 0 : diff > 0;
  return improving ? 'IMPROVING' : 'WORSENING';
}

/** 만성질환 시계열 관찰값 추이 조회 — code·기간·limit 로 정제 */
@Injectable()
export class ChronicService {
  private readonly logger = new Logger(ChronicService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly journey?: JourneyService,
  ) {}

  /** 측정값 기록(혈압·체중·혈당 등) — 정상범위·flag 서버 자동 산정 */
  async create(patientId: string, dto: CreateChronicObservationDto) {
    const spec = CODE_SPEC[dto.code] ?? { unit: '', min: null, max: null };
    const obs = await this.prisma.chronicObservation.create({
      data: {
        patientId,
        code: dto.code,
        value: dto.value,
        unit: dto.unit ?? spec.unit,
        measuredAt: dto.measuredAt ? new Date(dto.measuredAt) : new Date(),
        source: dto.source ?? 'CLINIC',
        normalMin: spec.min,
        normalMax: spec.max,
        flag: flagOf(dto.value, spec.min, spec.max),
        encounterId: dto.encounterId ?? null,
      },
    });
    // 🔴 (2026-10-20 결정 portal.patientReportedVitals = REFERENCE_ONLY) 환자가 직접 잰 값(SMBG)은 참고용 —
    //    담당의 경보를 내지 않는다(종전엔 포털 입력 하나가 바로 CHRONIC_ALERT 를 보냈다). 기록·표시는 그대로.
    if (isPatientReportedSource(obs.source)) return obs;
    // P2 능동 알림 — 가이드라인 목표 미달이면 담당의 통지(부작용·실패무시·디듑)
    // 🔴 (2026-09-15) 종전 `.catch(() => {})` + 담당의 조회 `.catch(() => null)` — 조회 실패가 "담당의 없음"이 되어
    //    목표 미달 경보가 흔적 없이 사라졌다. 측정 저장은 막지 않되 경보 누락은 남긴다.
    void this.maybeAlert(patientId, dto.code, dto.value)
      .catch((e) => this.logger.warn(`만성질환 목표 미달 경보 실패(경보 누락) patient=${patientId} code=${dto.code}: ${e instanceof Error ? e.message : String(e)}`));
    return obs;
  }

  /** 이상치 능동 알림 — 가이드라인 지표 목표 미달 시 담당의 통지 + 여정. 18h 디듑. */
  private async maybeAlert(patientId: string, code: string, value: number) {
    const g = CHRONIC_GUIDELINE.find((cond) => cond.indicators.some((i) => i.code === code));
    const ind = g?.indicators.find((i) => i.code === code);
    if (!g || !ind || meetsTarget(value, ind.target, ind.comparator)) return; // 목표 달성이면 알림 없음

    // 디듑 — 같은 환자·코드 알림이 최근 18h 내 있으면 스킵
    const refId = `chronic:${patientId}:${code}`;
    const recent = await this.prisma.notification.findFirst({
      where: { type: 'CHRONIC_ALERT', refId, createdAt: { gte: new Date(Date.now() - 18 * 3600_000) } },
      select: { id: true },
    });
    if (recent) return;

    // 담당의 해석 — 최근 외래 진료의 > 재원 주치의
    const enc = await this.prisma.encounter.findFirst({ where: { patientId }, orderBy: { createdAt: 'desc' }, select: { doctorId: true } });
    let doctorId: string | null = enc?.doctorId ?? null;
    if (!doctorId) {
      const adm = await this.prisma.admission.findFirst({ where: { patientId, status: 'ADMITTED' }, orderBy: { admitDate: 'desc' }, select: { attendingDoctorId: true } });
      doctorId = adm?.attendingDoctorId ?? null;
    }
    if (!doctorId) return;

    const cmpKo = ind.comparator === 'gte' ? '미만' : '초과';
    const msg = `${ind.label} ${value}${ind.unit} (목표 ${ind.target}${ind.unit} ${cmpKo}) — ${g.label} 관리 목표 미달`;
    await this.notifications?.create(doctorId, { type: 'CHRONIC_ALERT', title: `만성질환 목표 미달: ${ind.label}`, message: msg, severity: 'WARNING', refType: 'chronic', refId }).catch(() => {});
    this.journey?.emit({ patientId, eventType: 'CHRONIC_ALERT', title: `만성질환 경보: ${ind.label} ${value}${ind.unit}`, description: msg, refType: 'chronic', refId, severity: 'warning' });
  }

  /** P2 추적관리 워크리스트 — 코호트별 리콜 미수행(>RECALL_DAYS)·목표 미달 케어갭. */
  async getCareGaps() {
    type Row = { patient_id: string; code: string; value: string; measured_at: Date };
    const latest = await this.prisma.$queryRaw<Row[]>`
      SELECT DISTINCT ON (patient_id, code) patient_id, code, value, measured_at
      FROM chronic_observations WHERE context = 'CHRONIC' AND source <> ALL(${[...PATIENT_REPORTED_SOURCES]})
      ORDER BY patient_id, code, measured_at DESC`; // 🔴 환자 입력(참고용)은 리콜·조절 판정에 세지 않는다(결정 portal.patientReportedVitals)
    const byPatient = new Map<string, Record<string, { value: number; measuredAt: Date }>>();
    for (const r of latest) {
      const m = byPatient.get(r.patient_id) ?? {};
      m[r.code] = { value: Number(r.value), measuredAt: new Date(r.measured_at) };
      byPatient.set(r.patient_id, m);
    }
    const ids = [...byPatient.keys()];
    if (!ids.length) return { gaps: [], summary: { total: 0, recall: 0, uncontrolled: 0 } };

    const [patients, problems] = await Promise.all([
      this.prisma.patient.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true, mrn: true } }),
      this.prisma.problemList.findMany({ where: { patientId: { in: ids }, status: 'ACTIVE' }, select: { patientId: true, diagnosisCode: { select: { code: true } } } }),
    ]);
    const condByPatient = new Map<string, Map<string, GuidelineCondition>>();
    for (const pr of problems) {
      const c = conditionForDiagnosis(pr.diagnosisCode?.code ?? '');
      if (!c) continue;
      const m = condByPatient.get(pr.patientId) ?? new Map<string, GuidelineCondition>();
      m.set(c.condition, c); condByPatient.set(pr.patientId, m);
    }
    const pMap = new Map(patients.map((p) => [p.id, p]));
    const now = Date.now();

    const rows = ids.map((pid) => {
      const v = byPatient.get(pid)!;
      let conds = [...(condByPatient.get(pid)?.values() ?? [])];
      if (!conds.length) { // 진단 미부여 시 보유 지표로 추정
        if (v.HBA1C || v.FBS) conds.push(CHRONIC_GUIDELINE[0]);
        if (v.SBP || v.DBP) conds.push(CHRONIC_GUIDELINE[1]);
      }
      const indicators: { code: string; label: string; value: number | null; target: number; met: boolean | null; daysSince: number | null }[] = [];
      const seen = new Set<string>();
      for (const c of conds) for (const ind of c.indicators) {
        if (seen.has(ind.code)) continue; seen.add(ind.code);
        const obs = v[ind.code];
        const daysSince = obs ? Math.floor((now - obs.measuredAt.getTime()) / 86_400_000) : null;
        indicators.push({ code: ind.code, label: ind.label, value: obs?.value ?? null, target: ind.target, met: obs ? meetsTarget(obs.value, ind.target, ind.comparator) : null, daysSince });
      }
      const measuredDays = indicators.map((i) => i.daysSince).filter((d): d is number => d != null);
      const minDays = measuredDays.length ? Math.min(...measuredDays) : null; // 가장 최근 핵심지표 경과일
      const uncontrolled = indicators.some((i) => i.met === false);
      const recall = minDays == null || minDays > RECALL_DAYS; // 한 번도 없거나 분기 경과
      const p = pMap.get(pid)!;
      const gaps: string[] = [];
      if (recall) gaps.push('RECALL');
      if (uncontrolled) gaps.push('UNCONTROLLED');
      return {
        patientId: pid, name: `${p.familyName}${p.givenName}`, mrn: p.mrn,
        conditions: conds.map((c) => c.condition), gaps,
        overdueDays: minDays, indicators,
        severity: (recall ? 2 : 0) + (uncontrolled ? 1 : 0),
      };
    }).filter((r) => r.gaps.length > 0);

    rows.sort((a, b) => b.severity - a.severity || (b.overdueDays ?? 9999) - (a.overdueDays ?? 9999));
    return {
      gaps: rows,
      summary: { total: rows.length, recall: rows.filter((r) => r.gaps.includes('RECALL')).length, uncontrolled: rows.filter((r) => r.gaps.includes('UNCONTROLLED')).length },
    };
  }

  /** 만성질환 관리 대시보드 — 코호트별 최신값 + 조절상태(CDSS 목표 미달) 집계 */
  async getDashboard(filter: { condition?: string; status?: string }) {
    type Row = { patient_id: string; code: string; value: string; measured_at: Date };
    // 환자×코드 최신값(DISTINCT ON)
    // 대시보드는 만성 맥락만(입원 급성 EWS 제외) — 코호트 최신값 왜곡 방지
    const latest = await this.prisma.$queryRaw<Row[]>`
      SELECT DISTINCT ON (patient_id, code) patient_id, code, value, measured_at
      FROM chronic_observations
      WHERE context = 'CHRONIC' AND source <> ALL(${[...PATIENT_REPORTED_SOURCES]})
      ORDER BY patient_id, code, measured_at DESC`; // 🔴 환자 입력(참고용)은 코호트 조절 판정에 세지 않는다
    const byPatient = new Map<string, Record<string, { value: number; measuredAt: Date }>>();
    for (const r of latest) {
      const m = byPatient.get(r.patient_id) ?? {};
      m[r.code] = { value: Number(r.value), measuredAt: r.measured_at };
      byPatient.set(r.patient_id, m);
    }
    const ids = [...byPatient.keys()];
    if (!ids.length) return { patients: [], summary: { total: 0, dm: 0, htn: 0, uncontrolled: 0 } };

    const [patients, problems] = await Promise.all([
      this.prisma.patient.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true, mrn: true } }),
      this.prisma.problemList.findMany({
        // 🔴 정확일치 ['E11','I10'] 은 1형당뇨(E10)·이상지질(E78)·CKD(N18)·I11~I15 를 통째로 놓친다 —
        //    추적관리 탭(가이드라인 prefix 4조건)과 같은 정본으로 센다(P3·P12·2026-08-13 W3).
        where: {
          patientId: { in: ids }, status: 'ACTIVE',
          OR: CHRONIC_GUIDELINE.flatMap((g) => g.diagnosisPrefixes).map((prefix) => ({ diagnosisCode: { code: { startsWith: prefix } } })),
        },
        select: { patientId: true, diagnosisCode: { select: { code: true } } },
      }),
    ]);
    const cond = new Map<string, Set<string>>();
    for (const pr of problems) {
      const matched = conditionForDiagnosis(pr.diagnosisCode.code);
      if (!matched) continue;
      const s = cond.get(pr.patientId) ?? new Set<string>();
      s.add(matched.condition);
      cond.set(pr.patientId, s);
    }

    const rows = patients.map((p) => {
      const v = byPatient.get(p.id) ?? {};
      const conds = cond.get(p.id) ?? new Set<string>();
      if (!conds.size) { // 진단 미부여 시 보유 지표로 추정
        if (v.HBA1C || v.FBS) conds.add('DM');
        if (v.SBP) conds.add('HTN');
      }
      const alerts: string[] = [];
      if (v.HBA1C && v.HBA1C.value >= 7) alerts.push(`HbA1c ${v.HBA1C.value}%`);
      if (v.FBS && v.FBS.value >= 130) alerts.push(`공복혈당 ${v.FBS.value}`);
      if ((v.SBP && v.SBP.value >= 140) || (v.DBP && v.DBP.value >= 90)) alerts.push(`혈압 ${v.SBP?.value ?? '-'}/${v.DBP?.value ?? '-'}`);
      const dates = Object.values(v).map((x) => new Date(x.measuredAt).getTime());
      return {
        patientId: p.id,
        name: `${p.familyName}${p.givenName}`,
        mrn: p.mrn,
        conditions: [...conds],
        latest: {
          HBA1C: v.HBA1C?.value ?? null, FBS: v.FBS?.value ?? null,
          SBP: v.SBP?.value ?? null, DBP: v.DBP?.value ?? null,
          WEIGHT: v.WEIGHT?.value ?? null, BMI: v.BMI?.value ?? null,
        },
        alerts,
        controlled: alerts.length === 0,
        lastMeasured: dates.length ? new Date(Math.max(...dates)) : null,
      };
    });

    let out = rows;
    if (filter.condition === 'DM' || filter.condition === 'HTN') out = out.filter((r) => r.conditions.includes(filter.condition as string));
    if (filter.status === 'UNCONTROLLED') out = out.filter((r) => !r.controlled);
    if (filter.status === 'CONTROLLED') out = out.filter((r) => r.controlled);
    out.sort((a, b) => Number(a.controlled) - Number(b.controlled) || ((b.lastMeasured?.getTime() ?? 0) - (a.lastMeasured?.getTime() ?? 0)));

    const summary = {
      total: rows.length,
      dm: rows.filter((r) => r.conditions.includes('DM')).length,
      htn: rows.filter((r) => r.conditions.includes('HTN')).length,
      uncontrolled: rows.filter((r) => !r.controlled).length,
    };
    return { patients: out, summary };
  }

  async getTrend(patientId: string, q: TrendQuery) {
    const where: { patientId: string; code?: { in: string[] }; measuredAt?: { gte?: Date; lte?: Date }; context?: string } = { patientId };
    // 기본은 만성 맥락만(입원 급성 EWS 제외). includeAcute=true 시 전체 포함
    if (!q.includeAcute) where.context = 'CHRONIC';
    if (q.codes?.length) where.code = { in: q.codes };
    if (q.from || q.to) where.measuredAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    const rows = await this.prisma.chronicObservation.findMany({
      where,
      orderBy: { measuredAt: 'asc' },
      take: Math.min(q.limit ?? 3000, 5000),
    });
    // 교차소스 dedup — 같은 (code, 분 버킷) 근접 중복은 소스 우선순위로 1건만(원본 DB 보존, 추이 집계만).
    // 🔴 (2026-10-20) 종전 SMBG 4 > CLINIC 3 — 같은 분의 외래 측정이 환자 입력에 밀려 사라졌다. 환자 입력(참고용)은 맨 뒤.
    const SRC_PRIORITY: Record<string, number> = { LAB: 6, DEVICE: 5, CHECKUP: 3, CLINIC: 3, NURSING: 2, EWS: 1, SMBG: 0.5 };
    const kept: typeof rows = [];
    const seen = new Map<string, { idx: number; pri: number }>();
    for (const r of rows) {
      const key = `${r.code}|${Math.floor(new Date(r.measuredAt).getTime() / 60000)}`;
      const pri = SRC_PRIORITY[r.source] ?? 0;
      const ex = seen.get(key);
      if (!ex) { seen.set(key, { idx: kept.length, pri }); kept.push(r); }
      else if (pri > ex.pri) { kept[ex.idx] = r; ex.pri = pri; }
    }
    const series: Record<string, Array<{ value: number; unit: string; measuredAt: Date; flag: string | null; normalMin: number | null; normalMax: number | null; source: string; patientReported: boolean }>> = {};
    for (const r of kept) {
      (series[r.code] ??= []).push({
        value: Number(r.value), unit: r.unit, measuredAt: r.measuredAt, flag: r.flag,
        source: r.source, patientReported: isPatientReportedSource(r.source),
        normalMin: r.normalMin != null ? Number(r.normalMin) : null,
        normalMax: r.normalMax != null ? Number(r.normalMax) : null,
      });
    }
    // 코드별 최신값 + 직전 대비 변화(Δ) 요약
    const summary = Object.fromEntries(Object.entries(series).map(([code, arr]) => {
      const last = arr[arr.length - 1];
      const prev = arr[arr.length - 2];
      // 🔴 판정(목표 미달·추세)은 의료진 측정만으로 — 환자 입력은 참고용(결정 portal.patientReportedVitals = REFERENCE_ONLY)
      const measured = arr.filter((x) => !x.patientReported);
      const lastMeasured = measured[measured.length - 1];
      return [code, {
        latest: last?.value ?? null, unit: last?.unit ?? '', measuredAt: last?.measuredAt ?? null,
        latestPatientReported: last?.patientReported ?? false,
        clinical: lastMeasured ? { latest: lastMeasured.value, measuredAt: lastMeasured.measuredAt } : null,
        delta: last && prev ? Number((last.value - prev.value).toFixed(2)) : null,
        count: arr.length,
        patientReportedCount: arr.length - measured.length,
        trend: classifyTrend(measured, code), // P3d 추세 자동판정(안정/개선/악화/null) — 의료진 측정만
      }];
    }));
    return { series, summary };
  }

  /**
   * 문제중심 뷰(P2) — 환자의 활성 만성 진단(ProblemList)별로 가이드라인 지표·목표·최신값·Δ·달성(CDSS)을 묶음.
   * 진단↔목표는 서버 단일정의(CHRONIC_GUIDELINE)에서 파생 — FE 상수 중복 제거.
   */
  async getProblemView(patientId: string) {
    const active = await this.prisma.problemList.findMany({
      where: { patientId, status: 'ACTIVE' },
      select: { diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } },
    });
    const conds = new Map<string, { cond: GuidelineCondition; diag: { code: string; name: string } }>();
    for (const p of active) {
      const code = p.diagnosisCode?.code ?? '';
      const c = conditionForDiagnosis(code);
      if (c && !conds.has(c.condition)) conds.set(c.condition, { cond: c, diag: { code, name: p.diagnosisCode?.nameKo ?? code } });
    }
    if (!conds.size) return { problems: [] };

    const codes = [...new Set([...conds.values()].flatMap((c) => c.cond.indicators.map((i) => i.code)))];
    const obs = await this.prisma.chronicObservation.findMany({
      // 🔴 조절 판정(목표 달성)은 의료진 측정만 — 환자 입력은 참고용(결정 portal.patientReportedVitals)
      where: { patientId, code: { in: codes }, context: 'CHRONIC', source: { notIn: [...PATIENT_REPORTED_SOURCES] } },
      orderBy: { measuredAt: 'desc' },
      select: { code: true, value: true, measuredAt: true },
    });
    const byCode = new Map<string, { value: number; measuredAt: Date }[]>();
    for (const o of obs) {
      const arr = byCode.get(o.code) ?? [];
      arr.push({ value: Number(o.value), measuredAt: o.measuredAt });
      byCode.set(o.code, arr);
    }

    const problems = [...conds.values()].map(({ cond, diag }) => {
      const indicators = cond.indicators.map((ind) => {
        const arr = byCode.get(ind.code) ?? [];
        const latest = arr[0]?.value ?? null;
        const prev = arr[1]?.value ?? null;
        return {
          code: ind.code, label: ind.label, unit: ind.unit, target: ind.target, comparator: ind.comparator,
          latest, measuredAt: arr[0]?.measuredAt ?? null,
          delta: latest != null && prev != null ? Number((latest - prev).toFixed(2)) : null,
          met: latest != null ? meetsTarget(latest, ind.target, ind.comparator) : null,
        };
      });
      const measured = indicators.filter((i) => i.latest != null);
      return {
        condition: cond.condition, label: cond.label, diagnosis: diag,
        indicators, hasData: measured.length > 0,
        controlled: measured.length > 0 && measured.every((i) => i.met),
      };
    });
    return { problems, guidelineVersion: CHRONIC_GUIDELINE.length };
  }

  /**
   * 만성질환 경과 서술(P2b) — 의무기록(퇴원요약·진단서) 자동초안용.
   * 진단별 지표 최신값·추세·목표달성을 SoT(getProblemView)에서 파생한 텍스트로 생성(수기 재작성 방지).
   */
  async getProblemNarrative(patientId: string) {
    const { problems } = await this.getProblemView(patientId);
    if (!problems.length) return { problems: [], text: '' };
    const lines = problems.map((p) => {
      const inds = p.indicators.filter((i) => i.latest != null).map((i) => {
        const trend = i.delta == null || i.delta === 0 ? '' : i.delta < 0 ? `(▼${Math.abs(i.delta)})` : `(▲${i.delta})`;
        const status = i.met === true ? '목표 달성' : i.met === false ? '목표 미달' : '';
        return `${i.label} ${i.latest}${i.unit}${trend ? ' ' + trend : ''}${status ? ' ' + status : ''}`;
      });
      const ctrl = p.hasData ? (p.controlled ? '조절 양호' : '조절 불량') : '측정 기록 없음';
      return `· ${p.label}(${p.diagnosis.code}): ${ctrl}${inds.length ? ' — ' + inds.join(', ') : ''}`;
    });
    return { problems, text: ['[만성질환 경과]', ...lines].join('\n') };
  }
}
