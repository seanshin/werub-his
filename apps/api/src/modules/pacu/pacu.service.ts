import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { NotificationService } from '../notification/notification.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { transferBedInTx } from '../inpatient/bed-transfer';
import { admitIcuInTx } from '../icu/icu-admit';
import { AdmitPacuDto, RecordVitalsDto, UpdateAldreteDto, UpdatePonvDto, UpdatePadssDto, HandoffDto, AddComplicationDto, AddPainDto, AddInterventionDto, AddPacuIoDto, AddPacuNoteDto, SetPacuDelayDto, SetPacuBayDto } from './dto/pacu.dto';
import { PACU_IO_ROUTES, pacuIoTotals } from '@hospital-run/shared';

/**
 * 퇴실 기준 **기본값** — 원내 기준이 정해지기 전까지(설정 `pacu.aldrete.dischargeMin`·`pacu.padss.dischargeMin` 이 이긴다).
 * 🔴 (2026-09-30) 이 병원 Aldrete 는 6항목 0~12 인데 기준 9 는 5항목 0~10 척도의 관례값이다 — 원내 기준은 사람 결정
 *    (`pacu.dischargeCriteria`). 그래서 기준값을 정책인 척하지 않고 `source` 로 미설정임을 말한다.
 */
const ALDRETE_DISCHARGE_MIN = 9; // 수정 Aldrete 퇴실 기준 기본값(총 0~12·WARD/ICU)
const PADSS_DISCHARGE_MIN = 9;   // PADSS 귀가 기준 기본값(총 0~10·HOME)
/** 척도 항목 — 세부는 **이 키들이 정확히** 있어야 한다(빠진 항목·모르는 키를 받지 않는다) */
export const ALDRETE_ITEM_KEYS = ['activity', 'respiration', 'circulation', 'consciousness', 'spo2', 'pain'] as const;
export const PADSS_ITEM_KEYS = ['vitalSigns', 'ambulation', 'nausea', 'pain', 'bleeding'] as const;
/** Aldrete 세부에서 0점 항목 — 총점이 기준 이상이어도 한 항목이 0(무반응·무호흡 등)이면 기준 충족으로 보지 않는다 */
export function aldreteZeroItems(detail: unknown): string[] | null {
  if (!detail || typeof detail !== 'object') return null;
  return ALDRETE_ITEM_KEYS.filter((k) => (detail as Record<string, unknown>)[k] === 0);
}
const PATIENT_SELECT = { id: true, mrn: true, familyName: true, givenName: true } as const;
const DISPOSITION_LABEL: Record<string, string> = { WARD: '병동', ICU: 'ICU', HOME: '귀가' };

/**
 * 🔴 척도 만점의 **정본은 서버 하나**다.
 *
 * 이 병원의 Aldrete 는 6항목(활동·호흡·순환·의식·SpO2·통증)×2 = **0~12** 인데
 * (`UpdateAldreteDto @Max(12)`·화면 입력 폼도 6항목), 화면 두 곳이 총점을 **`/10`** 이라
 * 적고 있었다 — `pacu/page.tsx` 재실 목록 배지와 `workstation/post-op` 표·상세.
 * 같은 화면 안에서도 입력 폼은 `/12`, 목록 배지는 `/10` 이었다(P12 정본이 둘).
 * `9/12` 와 `9/10` 은 다른 임상 사실이다 — 만점을 화면이 각자 적지 않고 여기서 받아 쓴다.
 */
export const PACU_SCALES = {
  aldrete: { max: 12, dischargeMin: ALDRETE_DISCHARGE_MIN, items: 6 },
  padss: { max: 10, dischargeMin: PADSS_DISCHARGE_MIN, items: 5 },
} as const;

/**
 * 회복실 밀착감시 기본값 — **원내 정책이 정해지기 전까지의 기본값**이지 정책이 아니다.
 * 화면은 `source` 를 함께 받아 "원내 정책 미설정 — 기본값 적용"이라고 말한다.
 *
 * · q15 = ASPAN Phase I 표준(입실 직후 활력, 이후 15분 간격)
 * · 재실 초과 120분 = Phase I 통상 60~90분을 넘긴 지연 회복(원인 확인 대상)
 * · 36.0℃ = 정상체온 하한(그 아래는 가온 중재 대상). **35℃ 미만 저체온 경보를 대체하지 않는다** —
 *   35 미만은 종전대로 저체온, 35~36 은 새로 추가한 **경도** 구간이다(경보를 좁히지 않았다).
 */
const PACU_MONITORING_DEFAULTS = {
  vitalsIntervalMin: 15,
  prolongedStayMin: 120,
  hypothermiaWarnC: 36.0,
} as const;

/**
 * 회복실 활력 경보 임계 — **원내 정책이 정해지기 전까지의 기본값**(2026-10-01 설정화).
 * 활력 정본(`VITALS_THRESHOLDS`)보다 의도적으로 더 엄격하다(마취 각성 중 밀착감시 — SpO2 92 vs 90·HR 50/120 vs 40/130·RR 24 vs 30).
 * 값은 마취통증의학과·회복실이 정한다(사람 결정 `pacu.vitalAlertThresholds`) — config `pacu.vitalAlertThresholds` 부분 덮어쓰기.
 * 경계: `Low` 는 **미만**, `High` 는 **초과**(`tempHigh` 만 이상)·종전 판정과 같다.
 */
export const PACU_ALERT_DEFAULTS = {
  spo2Low: 92, hrLow: 50, hrHigh: 120, rrLow: 8, rrHigh: 24, sbpLow: 90, sbpHigh: 180, tempLow: 35, tempHigh: 38.5,
} as const;
export type PacuAlertThresholds = { -readonly [K in keyof typeof PACU_ALERT_DEFAULTS]: number };
/** 짝(low<high)이 깨지면 둘 다 버린다 — 판정이 죽지 않게(버린 키는 밝힌다) */
const PACU_ALERT_PAIRS: [keyof PacuAlertThresholds, keyof PacuAlertThresholds][] = [['hrLow', 'hrHigh'], ['rrLow', 'rrHigh'], ['sbpLow', 'sbpHigh'], ['tempLow', 'tempHigh']];
/** 숫자로 받을 수 있는 범위(오타·단위 착오 방지 — 밖이면 버린다) */
const PACU_ALERT_RANGE: Record<keyof PacuAlertThresholds, [number, number]> = {
  spo2Low: [70, 100], hrLow: [20, 100], hrHigh: [60, 220], rrLow: [0, 20], rrHigh: [10, 60],
  sbpLow: [50, 140], sbpHigh: [120, 260], tempLow: [30, 37], tempHigh: [37, 42],
};

/** config 원시값 → 적용 임계 + 버린 키(미상 키·범위 밖·짝 역전) */
export function normalizePacuAlertThresholds(raw: unknown): { thresholds: PacuAlertThresholds; applied: string[]; dropped: string[] } {
  const t: PacuAlertThresholds = { ...PACU_ALERT_DEFAULTS };
  const applied: string[] = []; const dropped: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { thresholds: t, applied, dropped };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in PACU_ALERT_DEFAULTS)) { dropped.push(k); continue; }
    const key = k as keyof PacuAlertThresholds;
    const n = typeof v === 'number' ? v : Number.NaN;
    const [lo, hi] = PACU_ALERT_RANGE[key];
    if (!Number.isFinite(n) || n < lo || n > hi) { dropped.push(k); continue; }
    t[key] = n; applied.push(k);
  }
  for (const [lo, hi] of PACU_ALERT_PAIRS) {
    if (t[lo] >= t[hi]) {
      for (const k of [lo, hi]) { t[k] = PACU_ALERT_DEFAULTS[k]; if (applied.includes(k)) { applied.splice(applied.indexOf(k), 1); dropped.push(k); } }
    }
  }
  return { thresholds: t, applied, dropped };
}

const CONFIG_KEYS = {
  vitalsIntervalMin: 'pacu.vitalsIntervalMin',
  prolongedStayMin: 'pacu.prolongedStayMin',
  hypothermiaWarnC: 'pacu.hypothermiaWarnC',
  aldreteDischargeMin: 'pacu.aldrete.dischargeMin',
  padssDischargeMin: 'pacu.padss.dischargeMin',
  vitalAlertThresholds: 'pacu.vitalAlertThresholds',
} as const;

export interface PacuMonitoringSettings {
  vitalsIntervalMin: number;
  prolongedStayMin: number;
  hypothermiaWarnC: number;
  /** CONFIG=원내 설정값 · DEFAULT=미설정(기본값 적용) · UNAVAILABLE=설정 조회 실패(기본값으로 감시 중) */
  source: 'CONFIG' | 'DEFAULT' | 'UNAVAILABLE';
  /** 퇴실 기준값의 출처 — 감시 주기와 따로 말한다(기준은 사람 결정 `pacu.dischargeCriteria`) */
  criteriaSource: 'CONFIG' | 'DEFAULT' | 'UNAVAILABLE';
  scales: { aldrete: { max: number; dischargeMin: number; items: number }; padss: { max: number; dischargeMin: number; items: number } };
  /** 활력 경보 임계(2026-10-01 설정화) — 출처는 감시 주기와 따로 말한다(사람 결정 `pacu.vitalAlertThresholds`) */
  alertThresholds: PacuAlertThresholds;
  alertSource: 'CONFIG' | 'DEFAULT' | 'UNAVAILABLE';
  /** 설정했지만 적용되지 않은 키(미상·범위 밖·짝 역전) — "설정했는데 안 먹는다"를 숨기지 않는다 */
  alertDroppedKeys: string[];
}

/** 저장된 활력 항목(자유 JSON) — 키가 있을 수도 없을 수도 있다. 있는 것만 읽는다. */
interface StoredVital {
  time?: unknown; bp?: unknown; hr?: unknown; rr?: unknown; spo2?: unknown; temp?: unknown;
  consciousness?: unknown; abnormal?: unknown; flags?: unknown;
}

/** 🔴 `0` 은 값이다 — `??`/`||` 로 접지 않고 유한수 여부만 본다. */
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const msOrNull = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

@Injectable()
export class PacuService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /**
   * 감시 주기·임계 조회.
   *
   * 🔴 `.catch(() => 기본값)` 을 쓰지 않는다 — 그러면 "설정 조회 실패"가 "미설정"으로 번역된다.
   *    조회가 실패해도 감시는 계속해야 하므로 기본값으로 재기는 하되, **그 사실을 `source` 로 말한다.**
   */
  async getMonitoringSettings(): Promise<PacuMonitoringSettings> {
    const d = PACU_MONITORING_DEFAULTS;
    const scalesWith = (a: number, p: number) => ({ aldrete: { ...PACU_SCALES.aldrete, dischargeMin: a }, padss: { ...PACU_SCALES.padss, dischargeMin: p } });
    const alertDefault = { alertThresholds: { ...PACU_ALERT_DEFAULTS }, alertDroppedKeys: [] as string[] };
    if (!this.config) {
      return { ...d, source: 'DEFAULT', criteriaSource: 'DEFAULT', scales: scalesWith(ALDRETE_DISCHARGE_MIN, PADSS_DISCHARGE_MIN), ...alertDefault, alertSource: 'DEFAULT' };
    }
    const read = (key: string) =>
      this.config!.get(key).then((v) => ({ ok: true, v }), () => ({ ok: false, v: null as unknown }));
    const [vi, ps, hw, am, pm, at] = await Promise.all([
      read(CONFIG_KEYS.vitalsIntervalMin), read(CONFIG_KEYS.prolongedStayMin), read(CONFIG_KEYS.hypothermiaWarnC),
      read(CONFIG_KEYS.aldreteDischargeMin), read(CONFIG_KEYS.padssDischargeMin), read(CONFIG_KEYS.vitalAlertThresholds),
    ]);
    // 조회 실패면 기본값으로 감시는 계속하되 UNAVAILABLE 로 말한다 · 적용된 키가 하나라도 있어야 CONFIG
    const alertNorm = at.ok ? normalizePacuAlertThresholds(at.v) : null;
    const alert = alertNorm
      ? { alertThresholds: alertNorm.thresholds, alertDroppedKeys: alertNorm.dropped, alertSource: (alertNorm.applied.length ? 'CONFIG' : 'DEFAULT') as 'CONFIG' | 'DEFAULT' }
      : { ...alertDefault, alertSource: 'UNAVAILABLE' as const };
    const pick = (raw: unknown, fallback: number) => {
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    // 척도 기준은 만점 이내 정수만(12 를 넘는 기준은 아무도 통과 못 한다 — 잘못된 설정은 기본값으로 · 출처가 말한다)
    const pickMin = (raw: unknown, fallback: number, max: number) => {
      const n = Number(raw);
      return Number.isInteger(n) && n > 0 && n <= max ? n : fallback;
    };
    const criteriaOk = am.ok && pm.ok;
    const criteriaConfigured = criteriaOk && [am.v, pm.v].some((v) => v !== null && v !== undefined);
    const scales = criteriaOk
      ? scalesWith(pickMin(am.v, ALDRETE_DISCHARGE_MIN, PACU_SCALES.aldrete.max), pickMin(pm.v, PADSS_DISCHARGE_MIN, PACU_SCALES.padss.max))
      : scalesWith(ALDRETE_DISCHARGE_MIN, PADSS_DISCHARGE_MIN);
    const criteriaSource = !criteriaOk ? 'UNAVAILABLE' : criteriaConfigured ? 'CONFIG' : 'DEFAULT';
    if (!vi.ok || !ps.ok || !hw.ok) {
      return { ...d, source: 'UNAVAILABLE', criteriaSource, scales, ...alert };
    }
    const configured = [vi.v, ps.v, hw.v].some((v) => v !== null && v !== undefined);
    return {
      vitalsIntervalMin: pick(vi.v, d.vitalsIntervalMin),
      prolongedStayMin: pick(ps.v, d.prolongedStayMin),
      hypothermiaWarnC: pick(hw.v, d.hypothermiaWarnC),
      source: configured ? 'CONFIG' : 'DEFAULT',
      criteriaSource,
      scales,
      ...alert,
    };
  }

  /**
   * 회복실 감시 파생값 — **화면이 계산하지 않는다**(두 화면이 각자 세면 갈라진다).
   *
   * 담는 사실:
   * · 마지막 활력 시각 / 다음 측정 예정 시각 / 지연 분 — PACU 는 q15 재측정이 표준인데
   *   운영 6건 중 90분 재실에 활력 1~2회뿐인 기록이 있었고, 화면에는 "다음 측정"이 **아예 없었다.**
   * · 재실 경과 / 재실 초과 여부
   * · 마지막 체온과 저체온 3상(측정됨-정상 / 측정됨-저체온 / **미측정**)
   * · 인수인계 기록 유무(운영 6건 중 퇴실 인계는 2건뿐)
   *
   * 🔴 미측정은 `null` 이다. `0`(측정된 0)과 구분한다.
   */
  private decorate<T extends {
    arrivalTime: Date; dischargeTime: Date | null; vitalSigns: unknown;
    aldretScore: number | null; padssScore: number | null; aldreteDetail?: unknown;
    arrivalHandoff: unknown; dischargeHandoff: unknown;
  }>(record: T, s: PacuMonitoringSettings, nowMs: number) {
    const zeroItems = aldreteZeroItems(record.aldreteDetail);
    const vitals: StoredVital[] = Array.isArray(record.vitalSigns) ? (record.vitalSigns as StoredVital[]) : [];
    const times = vitals.map((v) => msOrNull(v?.time)).filter((t): t is number => t !== null);
    const lastVitalsAtMs = times.length ? Math.max(...times) : null;
    const active = record.dischargeTime === null;
    const arrivalMs = record.arrivalTime.getTime();

    // 기준점: 아직 한 번도 재지 않았으면 **입실 시각**부터 센다(입실 활력이 첫 측정이다).
    const sinceMs = lastVitalsAtMs ?? arrivalMs;
    const dueMs = sinceMs + s.vitalsIntervalMin * 60_000;
    const overdueMin = active ? Math.floor((nowMs - dueMs) / 60_000) : null;

    const lastTempEntry = [...vitals].reverse().find((v) => finiteOrNull(v?.temp) !== null);
    const lastTemp = lastTempEntry ? finiteOrNull(lastTempEntry.temp) : null;

    // 마지막 활력 한 벌 — 보드가 배열을 뒤져 스스로 고르지 않게 서버가 고른 것을 준다.
    // 🔴 이상 판정(`abnormal`·`flags`)은 **기록 시점에 서버가 판정한 값**을 그대로 싣는다.
    //    화면이 임계 숫자를 새로 적으면 위원회가 임계를 고쳐도 화면은 옛 임계로 말한다.
    const lastEntry = lastVitalsAtMs !== null
      ? vitals.filter((v) => msOrNull(v?.time) === lastVitalsAtMs).slice(-1)[0]
      : (vitals.length ? vitals[vitals.length - 1] : undefined);
    const lastVitals = lastEntry
      ? {
          time: typeof lastEntry.time === 'string' ? lastEntry.time : null,
          bp: typeof lastEntry.bp === 'string' ? lastEntry.bp : null,
          hr: finiteOrNull(lastEntry.hr),
          rr: finiteOrNull(lastEntry.rr),
          spo2: finiteOrNull(lastEntry.spo2),
          temp: finiteOrNull(lastEntry.temp),
          consciousness: typeof lastEntry.consciousness === 'string' ? lastEntry.consciousness : null,
          abnormal: lastEntry.abnormal === true,
          flags: Array.isArray(lastEntry.flags) ? (lastEntry.flags as unknown[]).filter((f): f is string => typeof f === 'string') : [],
        }
      : null;

    const endMs = record.dischargeTime ? record.dischargeTime.getTime() : nowMs;
    const stayMinutes = Math.max(0, Math.round((endMs - arrivalMs) / 60_000));

    return {
      ...record,
      monitoring: {
        vitalsCount: vitals.length,
        lastVitalsAt: lastVitalsAtMs === null ? null : new Date(lastVitalsAtMs).toISOString(),
        /** 입실 후 활력을 한 번도 재지 않았다 — "정상"이 아니라 "모른다" */
        noVitalsYet: lastVitalsAtMs === null,
        lastVitals,
        nextVitalsDueAt: active ? new Date(dueMs).toISOString() : null,
        /** 지연 분(0 이하면 아직 여유). 퇴실 기록은 `null` — 지난 일에 "지연 중"이라 말하지 않는다 */
        vitalsOverdueMin: overdueMin,
        vitalsOverdue: overdueMin !== null && overdueMin > 0,
        stayMinutes,
        prolongedStay: stayMinutes > s.prolongedStayMin,
        lastTemp,
        /** true=저체온 · false=정상 · **null=미측정**(안전측으로 접지 않는다) */
        hypothermia: lastTemp === null ? null : lastTemp < s.hypothermiaWarnC,
        hypothermiaSeverity: lastTemp === null ? null : lastTemp < s.alertThresholds.tempLow ? 'SEVERE' : lastTemp < s.hypothermiaWarnC ? 'MILD' : null,
        /** 척도 충족 3상 — 미평가(`null`)를 0점으로 접지 않는다 */
        // 총점 기준 + 0점 항목 없음(2026-09-30) — 의식 0(무반응)인데 총점 9 로 "퇴실가능"이 되던 것
        aldreteReady: record.aldretScore === null ? null : record.aldretScore >= s.scales.aldrete.dischargeMin && !(zeroItems && zeroItems.length),
        aldreteZeroItems: zeroItems,
        padssReady: record.padssScore === null ? null : record.padssScore >= s.scales.padss.dischargeMin,
        arrivalHandoffRecorded: record.arrivalHandoff !== null && record.arrivalHandoff !== undefined,
        dischargeHandoffRecorded: record.dischargeHandoff !== null && record.dischargeHandoff !== undefined,
      },
    };
  }

  /**
   * 입실 — 🔴 (2026-09-30) 종전엔 화면이 보낸 환자·수술·간호사를 그대로 믿었다(다른 환자 붙이기·담당 간호사 사칭·같은 수술 이중 입실).
   *  · 수술이 있어야 하고 완료(COMPLETED)여야 한다 · 환자는 **수술에서** 정한다(보낸 값이 다르면 400)
   *  · 담당 간호사 = 입실 처리한 사용자 · 같은 수술에 재실 중 기록이 있으면 409
   */
  async admit(data: AdmitPacuDto, userId: string) {
    const surgery = await this.prisma.surgery.findUnique({ where: { id: data.surgeryId }, select: { id: true, patientId: true, status: true } });
    if (!surgery) throw new NotFoundException('Surgery not found');
    if (surgery.status !== 'COMPLETED') {
      throw new ConflictException({ code: 'PACU_SURGERY_NOT_COMPLETED', message: 'Only a completed surgery can be admitted to PACU' });
    }
    if (data.patientId && data.patientId !== surgery.patientId) {
      throw new BadRequestException({ code: 'PACU_PATIENT_MISMATCH', message: 'The patient does not match the surgery' });
    }
    const open = await this.prisma.pacuRecord.findFirst({ where: { surgeryId: surgery.id, dischargeTime: null }, select: { id: true } });
    if (open) throw new ConflictException({ code: 'PACU_ALREADY_ADMITTED', message: 'This surgery already has an active PACU record', details: { recordId: open.id } });
    const record = await this.prisma.pacuRecord.create({
      data: {
        patientId: surgery.patientId,
        surgeryId: surgery.id,
        arrivalTime: new Date(),
        nurseId: userId,
        oxygenTherapy: data.oxygenTherapy,
        notes: data.notes,
        vitalSigns: [],
        interventions: [],
        arrivalHandoff: (data.arrivalHandoff ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
      include: { patient: { select: PATIENT_SELECT } },
    });
    this.journey?.emit({
      patientId: record.patientId, eventType: 'PACU_ADMISSION',
      title: 'PACU(회복실) 입실', refType: 'PACU', refId: record.id, navUrl: '/pacu',
      // 여정 P1: 원 기록은 PACU 기록 — 방문 단위는 그 수술
      episode: { type: 'Surgery', id: surgery.id }, occurredAt: record.arrivalTime,
    });
    return record;
  }

  /**
   * 세부점수 검증 — 항목 0~2 범위 + **총점과 세부의 합이 같아야 한다.**
   *
   * 🔴 종전엔 범위만 봤다. 6항목 중 3항목만 담긴 세부와 임의의 총점이 함께 저장될 수 있었고,
   *    그러면 같은 기록 안에서 총점과 근거가 다른 말을 한다(어느 쪽이 사실인지 확인할 방법이 없다).
   */
  private assertDetail(detail: Record<string, number> | undefined, score: number, scale: string, keys: readonly string[]) {
    // 🔴 (2026-09-30) 종전엔 세부가 없으면 검사 없이 통과했다 — `{score:9}` 만 보내도 저장돼 퇴실 게이트가 열렸다.
    //    세부는 필수이고, 척도 항목이 **정확히** 있어야 한다(빠진 항목·모르는 키 금지).
    if (!detail || typeof detail !== 'object') {
      throw new BadRequestException({ code: 'PACU_SCORE_DETAIL_REQUIRED', message: 'Item scores (detail) are required', details: { scale, keys } });
    }
    const got = Object.keys(detail).sort().join(',');
    if (got !== [...keys].sort().join(',')) {
      throw new BadRequestException({ code: 'PACU_SCORE_DETAIL_KEYS', message: 'Item scores must contain exactly the scale items', details: { scale, keys } });
    }
    let sum = 0;
    for (const [k, val] of Object.entries(detail)) {
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 2) {
        throw new BadRequestException(`세부점수 ${k}는 0~2 범위`);
      }
      sum += val;
    }
    if (sum !== score) {
      throw new BadRequestException({
        code: 'PACU_SCORE_DETAIL_MISMATCH',
        message: `${scale} 총점(${score})과 세부 항목 합(${sum})이 다릅니다. 미평가 항목이 있으면 총점을 저장하지 않습니다.`,
      });
    }
  }

  /** 🔴 (2026-09-30) 퇴실 뒤에는 평가·기록을 고치지 않는다 — 퇴실 게이트의 근거가 사후에 바뀐다(활력·중재만 막혀 있었다) */
  private assertOpen(record: { dischargeTime: Date | null }) {
    if (record.dischargeTime) throw new BadRequestException({ code: 'PACU_ALREADY_DISCHARGED', message: '이미 퇴실한 환자입니다.' });
  }

  /**
   * 점수 이력 덧붙이기(2026-10-07) — 종전엔 점수 칸을 덮어써 입실·중간·퇴실 추이가 남지 않았다.
   * 그 종류의 첫 평가는 입실(ADMIT) · 그 뒤는 화면이 고른 시점(중간·퇴실 전 · 기본 중간).
   */
  private appendScore(
    record: { scoreHistory: unknown },
    kind: 'ALDRETE' | 'PADSS' | 'PONV', score: number, detail: Record<string, number> | null, phase: string | undefined, userId?: string,
  ): Prisma.InputJsonValue {
    const list = Array.isArray(record.scoreHistory) ? [...(record.scoreHistory as Array<Record<string, unknown>>)] : [];
    const first = !list.some((e) => e.kind === kind);
    list.push({ kind, score, detail, phase: first ? 'ADMIT' : (phase ?? 'INTERVAL'), at: new Date().toISOString(), by: userId ?? null });
    return list as unknown as Prisma.InputJsonValue;
  }

  /** PONV(수술후 오심·구토) 평가 */
  async updatePonv(id: string, dto: UpdatePonvDto, userId?: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    this.assertOpen(record);
    await this.prisma.pacuRecord.update({
      where: { id },
      data: {
        ponvScore: dto.score, ponvManagement: dto.management ?? null, ponvAssessedAt: new Date(), ponvAssessedById: userId ?? null,
        scoreHistory: this.appendScore(record, 'PONV', dto.score, null, dto.phase, userId),
      },
    });
    return { ponvScore: dto.score, needsManagement: dto.score >= 2, message: dto.score >= 2 ? 'PONV 중등도 이상 — 중재 권장' : 'PONV 경미/없음' };
  }

  /** PADSS 귀가 척도(HOME 퇴실 기준) */
  async updatePadss(id: string, dto: UpdatePadssDto, userId?: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    this.assertOpen(record);
    this.assertDetail(dto.detail, dto.score, 'PADSS', PADSS_ITEM_KEYS);
    const s = await this.getMonitoringSettings();
    const min = s.scales.padss.dischargeMin;
    await this.prisma.pacuRecord.update({
      where: { id },
      data: {
        padssScore: dto.score, padssDetail: (dto.detail ?? Prisma.JsonNull) as Prisma.InputJsonValue, padssAssessedAt: new Date(), padssAssessedById: userId ?? null,
        scoreHistory: this.appendScore(record, 'PADSS', dto.score, dto.detail ?? null, dto.phase, userId),
      },
    });
    return {
      padssScore: dto.score,
      max: PACU_SCALES.padss.max,
      threshold: min,
      criteriaSource: s.criteriaSource,
      homeDischargeReady: dto.score >= min,
      message: dto.score >= min ? `PADSS 기준 충족 — 귀가 가능` : `PADSS ${dto.score}점 — 귀가 기준(${min}) 미달`,
    };
  }

  async getRecords(filters: { date?: string; status?: string }) {
    const where: Prisma.PacuRecordWhereInput = {};
    if (filters.date) {
      const t = new Date(filters.date);
      const start = new Date(t.getFullYear(), t.getMonth(), t.getDate());
      where.arrivalTime = { gte: start, lt: new Date(start.getTime() + 86400000) };
    }
    if (filters.status === 'active') where.dischargeTime = null;
    else if (filters.status === 'discharged') where.dischargeTime = { not: null };

    const [rows, settings] = await Promise.all([
      this.prisma.pacuRecord.findMany({
        where, orderBy: { arrivalTime: 'desc' }, take: 300,
        include: { patient: { select: PATIENT_SELECT } },
      }),
      this.getMonitoringSettings(),
    ]);
    const now = Date.now();
    return rows.map((r) => this.decorate(r, settings, now));
  }

  async getRecordById(id: string) {
    const [record, settings] = await Promise.all([
      this.prisma.pacuRecord.findUnique({
        where: { id },
        include: { patient: { select: PATIENT_SELECT } },
      }),
      this.getMonitoringSettings(),
    ]);
    if (!record) throw new NotFoundException('PACU record not found');
    return this.decorate(record, settings, Date.now());
  }

  /** 활력징후 이상치 판정 — PACU 밀착감시(저산소·서맥/빈맥·저/고혈압·호흡·발열). */
  /**
   * PACU 이상 활력 판정.
   *
   * 🔴 (2026-10-01) 임계는 config `pacu.vitalAlertThresholds`(미설정이면 `PACU_ALERT_DEFAULTS`).
   * 🔴 임계치가 활력 정본(`vitals-evaluate.ts` `VITALS_THRESHOLDS`)보다 **더 엄격하다**
   * (SpO2 92 vs 90 · HR 50/120 vs 40/130 · RR 24 vs 30). 회복실은 마취 각성 중이라
   * 더 좁게 보는 것이 임상 판단이므로 **정본으로 통일하지 않는다** — 통일하면 경보가 느슨해진다.
   * 두 벌인 것은 사실이니 여기 적어 둔다(정본이 둘이면 갈라진다 — 바꿀 땐 양쪽을 함께 본다).
   *
   * 🔴 2026-08-20 봉합: 종전엔 `v.spo2 > 0`·`v.hr > 0`·`v.rr > 0` 조건이 붙어 있어
   * **측정된 0 을 통째로 버렸다.** DTO 는 `@Min(0)` 으로 0 을 받고, 화면은 빈칸을 `undefined`
   * 로 보내므로(`pacu/page.tsx` `num()`) 도착한 0 은 **실제 측정값**이다.
   * 회복실에서 HR 0 · RR 0 · SpO2 0 은 가장 놓치면 안 되는 값인데 **아무 경보도 뜨지 않았다.**
   * 0 은 진단하지 않고(프로브 이탈일 수도 있다) **확인을 요구**한다.
   */
  private vitalFlags(
    v: RecordVitalsDto,
    hypothermiaWarnC: number = PACU_MONITORING_DEFAULTS.hypothermiaWarnC,
    t: PacuAlertThresholds = PACU_ALERT_DEFAULTS,
  ): string[] {
    return pacuVitalFlags(v, hypothermiaWarnC, t);
  }


  async recordVitals(id: string, vitals: RecordVitalsDto, userId?: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    if (record.dischargeTime) throw new BadRequestException('이미 퇴실한 환자입니다.');

    // 🔴 **재지 않은 측정을 기록하지 않는다**(P16 — 실행하지 않고 성공 상태만 기록).
    //    종전엔 빈 폼으로 '기록'을 눌러도 `abnormal:false` 항목이 하나 쌓였고, 그 항목은
    //    타임라인에서 **정상으로 확인된 라운드**처럼 보였다(게다가 다음 측정 시각을 뒤로 밀었다).
    const measured = [vitals.bp, vitals.hr, vitals.rr, vitals.spo2, vitals.temp, vitals.consciousness, vitals.rass]
      .some((x) => x !== undefined && x !== null && x !== '');
    if (!measured) {
      throw new BadRequestException({
        code: 'PACU_VITALS_EMPTY',
        message: '측정값이 하나도 없습니다. 활력징후는 최소 한 항목 이상 입력해야 기록됩니다.',
      });
    }

    const settings = await this.getMonitoringSettings();
    const flags = this.vitalFlags(vitals, settings.hypothermiaWarnC, settings.alertThresholds);
    const current = (record.vitalSigns as Array<Record<string, unknown>>) || [];
    const entry = {
      time: new Date().toISOString(),
      bp: vitals.bp, hr: vitals.hr, rr: vitals.rr, spo2: vitals.spo2, temp: vitals.temp,
      consciousness: vitals.consciousness,
      // 진정 척도(RASS) — 미평가면 칸이 없다(0=명료와 구분)
      ...(vitals.rass !== undefined && vitals.rass !== null ? { rass: vitals.rass } : {}),
      abnormal: flags.length > 0,
      flags,
      by: userId ?? null, // 누가 쟀는지(2026-09-30) — 모르면 null
    };
    current.push(entry);

    await this.prisma.pacuRecord.update({
      where: { id },
      data: { vitalSigns: current as unknown as Prisma.JsonArray },
    });

    // 이상 활력 → 담당 간호사 알림 팬아웃(SSE·인박스). fire-and-forget.
    if (flags.length && record.nurseId && this.notifications) {
      this.notifications.create(record.nurseId, {
        type: 'PACU_VITAL_ALERT',
        title: 'PACU 활력징후 이상',
        message: `이상 소견: ${flags.join(', ')}`,
        severity: 'WARNING',
        refType: 'PACU',
        refId: id,
      }).catch(() => {});
    }
    return {
      entry,
      abnormal: flags.length > 0,
      flags,
      // 다음 측정 예정 — 화면이 자기 시계로 계산하지 않게 서버가 준다(주기 정본은 설정이다).
      nextVitalsDueAt: new Date(Date.parse(entry.time) + settings.vitalsIntervalMin * 60_000).toISOString(),
      vitalsIntervalMin: settings.vitalsIntervalMin,
    };
  }

  /**
   * 중재(처치) 기록 append — 산소·가온·약물·기도유지 등 "무엇을 했나".
   * 합병증(무슨 일이 있었나)과 별개 원장이다.
   */
  async addIntervention(id: string, dto: AddInterventionDto, byUserId?: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    if (record.dischargeTime) throw new BadRequestException('이미 퇴실한 환자입니다.');
    const list = (record.interventions as Array<Record<string, unknown>>) ?? [];
    const entry = {
      type: dto.type,
      detail: dto.detail,
      note: dto.note,
      time: new Date().toISOString(),
      by: byUserId ?? null, // 누가 했는지 모르면 모른다고 적는다(빈 문자열로 채우지 않는다)
    };
    list.push(entry);
    await this.prisma.pacuRecord.update({
      where: { id },
      data: { interventions: list as unknown as Prisma.JsonArray },
    });
    return { entry, count: list.length };
  }

  /** 구조화 합병증 기록(append) — SEVERE는 담당 간호사 알림 */
  async addComplication(id: string, dto: AddComplicationDto, userId?: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    this.assertOpen(record);
    const list = (record.complications as Array<Record<string, unknown>>) ?? [];
    const entry = { type: dto.type, severity: dto.severity, intervention: dto.intervention, note: dto.note, time: new Date().toISOString(), by: userId ?? null };
    list.push(entry);
    await this.prisma.pacuRecord.update({
      where: { id },
      data: { complications: list as unknown as Prisma.JsonArray },
    });
    if (dto.severity === 'SEVERE' && record.nurseId && this.notifications) {
      this.notifications.create(record.nurseId, {
        type: 'PACU_COMPLICATION', title: 'PACU 중증 합병증',
        message: `${dto.type}${dto.intervention ? ` · ${dto.intervention}` : ''}`,
        severity: 'CRITICAL', refType: 'PACU', refId: id,
      }).catch(() => {});
    }
    return { entry, count: list.length };
  }

  /** 통증 재평가 기록(append) — 최신값을 painScore에 반영 */
  async addPainAssessment(id: string, dto: AddPainDto, userId?: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    this.assertOpen(record);
    const list = (record.painAssessments as Array<Record<string, unknown>>) ?? [];
    const entry = { score: dto.score, scale: dto.scale ?? 'NRS', intervention: dto.intervention, time: new Date().toISOString(), by: userId ?? null };
    list.push(entry);
    await this.prisma.pacuRecord.update({
      where: { id },
      data: { painAssessments: list as unknown as Prisma.JsonArray, painScore: dto.score },
    });
    return { entry, count: list.length, trend: list.slice(-10) };
  }

  async updateAldrete(id: string, dto: UpdateAldreteDto, userId?: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    this.assertOpen(record);
    this.assertDetail(dto.detail, dto.score, 'Aldrete', ALDRETE_ITEM_KEYS);
    const s = await this.getMonitoringSettings();
    const min = s.scales.aldrete.dischargeMin;
    const zero = aldreteZeroItems(dto.detail) ?? [];
    const result = await this.prisma.pacuRecord.update({
      where: { id },
      data: {
        aldretScore: dto.score,
        aldreteDetail: (dto.detail ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        // 🔴 (2026-09-30) 종전엔 `painScore: dto.detail?.pain` 으로 **Aldrete 통증 항목(0=극심 · 2=경미)** 을 NRS 통증(0~10 · 0=무통) 칸에
        //    덮어써, 가장 아픈 환자가 "통증 0/10" 으로 보였다. 통증 점수는 통증 재평가(/pain)만 쓴다.
        aldreteAssessedAt: new Date(),
        aldreteAssessedById: userId ?? null,
        scoreHistory: this.appendScore(record, 'ALDRETE', dto.score, dto.detail ?? null, dto.phase, userId),
      },
    });
    const ready = dto.score >= min && zero.length === 0;
    return {
      ...result,
      dischargeReady: ready,
      threshold: min,
      criteriaSource: s.criteriaSource,
      zeroItems: zero,
      max: PACU_SCALES.aldrete.max,
      message: ready
        ? 'Aldrete 기준 충족 — 퇴실 가능'
        : zero.length
          ? 'Aldrete 0점 항목이 있어 총점과 관계없이 퇴실 기준 미달입니다' // 항목은 zeroItems 로 내려보낸다(서버가 문장을 조립하지 않는다)
          : `Aldrete ${dto.score}점 — 퇴실 기준(${min}) 미달`,
    };
  }

  // ── 2026-10-07 회복실 상세화 ──

  /** 회복실 섭취·배설 덧붙이기 — 합은 기록된 것만(shared pacuIoTotals) */
  async addIo(id: string, dto: AddPacuIoDto, userId?: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    this.assertOpen(record);
    const allowed = (PACU_IO_ROUTES[dto.kind] as readonly string[]);
    if (!allowed.includes(dto.route)) throw new BadRequestException({ code: 'PACU_IO_ROUTE', message: '섭취·배설 경로가 종류와 맞지 않습니다.' });
    const list = Array.isArray(record.ioEntries) ? [...(record.ioEntries as Array<Record<string, unknown>>)] : [];
    const entry = { kind: dto.kind, route: dto.route, ml: dto.ml, note: dto.note ?? null, at: new Date().toISOString(), by: userId ?? null };
    list.push(entry);
    await this.prisma.pacuRecord.update({ where: { id }, data: { ioEntries: list as unknown as Prisma.InputJsonValue } });
    return { entry, totals: pacuIoTotals(list as unknown as { kind: string; ml: number }[]) };
  }

  /** 회복실 간호기록 한 줄 덧붙이기 */
  async addNote(id: string, dto: AddPacuNoteDto, userId?: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    this.assertOpen(record);
    const list = Array.isArray(record.nursingNotes) ? [...(record.nursingNotes as Array<Record<string, unknown>>)] : [];
    const entry = { text: dto.text.trim(), at: new Date().toISOString(), by: userId ?? null };
    list.push(entry);
    await this.prisma.pacuRecord.update({ where: { id }, data: { nursingNotes: list as unknown as Prisma.InputJsonValue } });
    return { entry, count: list.length };
  }

  /**
   * 마취과 퇴실 확인 — 의사(관리자)만 · 한 번(다시 눌러도 처음 시각 유지).
   * 퇴실 때 필수로 할지는 원내 결정이라 여기서 강제하지 않는다(화면은 "미확인"을 그대로 말한다).
   */
  async signOff(id: string, userId: string, role?: string) {
    if (role !== 'DOCTOR' && role !== 'ADMIN') throw new ForbiddenException({ code: 'PACU_SIGNOFF_DOCTOR_ONLY', message: '마취과 퇴실 확인은 의사만 할 수 있습니다.' });
    const record = await this.prisma.pacuRecord.findUnique({ where: { id }, select: { id: true, anesthesiaSignOffAt: true, anesthesiaSignOffById: true } });
    if (!record) throw new NotFoundException('PACU record not found');
    if (record.anesthesiaSignOffAt) return { anesthesiaSignOffAt: record.anesthesiaSignOffAt, anesthesiaSignOffById: record.anesthesiaSignOffById, alreadySigned: true };
    const r = await this.prisma.pacuRecord.updateMany({ where: { id, anesthesiaSignOffAt: null }, data: { anesthesiaSignOffAt: new Date(), anesthesiaSignOffById: userId } });
    const after = await this.prisma.pacuRecord.findUnique({ where: { id }, select: { anesthesiaSignOffAt: true, anesthesiaSignOffById: true } });
    return { ...after, alreadySigned: r.count === 0 };
  }

  /** 퇴실 지연 사유 — 재실 중에만 · null 이면 해제 */
  async setDelay(id: string, dto: SetPacuDelayDto) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id }, select: { id: true, dischargeTime: true } });
    if (!record) throw new NotFoundException('PACU record not found');
    this.assertOpen(record);
    return this.prisma.pacuRecord.update({
      where: { id }, data: { delayReason: dto.reason ?? null, delayNote: dto.reason ? (dto.note ?? null) : null },
      select: { id: true, delayReason: true, delayNote: true },
    });
  }

  /** 회복실 자리(베이) — 재실 중에만 · 빈 값이면 해제 */
  async setBay(id: string, dto: SetPacuBayDto) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id }, select: { id: true, dischargeTime: true } });
    if (!record) throw new NotFoundException('PACU record not found');
    this.assertOpen(record);
    const code = dto.bayCode?.trim() || null;
    return this.prisma.pacuRecord.update({ where: { id }, data: { bayCode: code }, select: { id: true, bayCode: true } });
  }

  /**
   * 수술실 → 회복실 마취 인계 맥락(2026-10-07) — 마취기록·수술 중 기록 원장을 **읽기만** 한다.
   * 🔴 종전 회복실 화면은 인계를 SBAR 자유 글로만 받았다 — 같은 수술의 마취기록(기도·ETT·발관·역전제·진통제·수액·수혈·EBL·소변)이 있어도 안 읽었다.
   * 없는 기록은 null(화면이 "기록 없음"으로 말한다) · 수술 중 기록은 무효 처리된 것을 뺀다.
   */
  async getHandoffContext(id: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id }, select: { id: true, surgeryId: true } });
    if (!record) throw new NotFoundException('PACU record not found');
    const [surgery, anesthesia, events] = await Promise.all([
      this.prisma.surgery.findUnique({
        where: { id: record.surgeryId },
        select: { id: true, procedureName: true, anesthesiaType: true, scheduledAt: true, startedAt: true, endedAt: true, surgeon: { select: { familyName: true, givenName: true } } },
      }),
      this.prisma.anesthesiaRecord.findUnique({
        where: { surgeryId: record.surgeryId },
        select: {
          asaClass: true, anesthesiaType: true, airwayType: true, ettSize: true, inductionTime: true, intubationTime: true, extubationTime: true,
          analgesics: true, reversal: true, fluidInput: true, bloodProducts: true, ebl: true, urineOutput: true, complications: true, notes: true,
          anesthetist: { select: { familyName: true, givenName: true } },
        },
      }),
      this.prisma.intraopEvent.findMany({
        where: { surgeryId: record.surgeryId, voidedAt: null },
        select: { kind: true, occurredAt: true, payload: true },
        orderBy: { occurredAt: 'asc' },
        take: 300,
      }),
    ]);
    const byKind: Record<string, number> = {};
    for (const e of events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    return {
      surgery: surgery ?? null,
      anesthesia: anesthesia ?? null,
      intraop: { total: events.length, truncated: events.length >= 300, byKind, last: events.slice(-8) },
    };
  }

  /**
   * 퇴실 목적지 선택지(2026-09-30) — 화면이 고를 수 있는 것만 서버가 준다.
   *  · 재원 중 입원(원 병상) · 재원 중 ICU 입실(의사가 먼저 열어 둔 것) · 비어 있는 일반 병상 · 비어 있는 ICU 병상
   *  · 잘랐으면 잘랐다고 말한다
   */
  async getDestinationOptions(id: string) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id }, select: { id: true, patientId: true, dischargeTime: true } });
    if (!record) throw new NotFoundException('PACU record not found');
    const CAP = 200;
    const [admission, icu, wardBeds, icuBeds] = await Promise.all([
      this.prisma.admission.findFirst({
        where: { patientId: record.patientId, status: 'ADMITTED' }, orderBy: { admitDate: 'desc' },
        select: { id: true, bedId: true, bed: { select: { id: true, roomNumber: true, bedNumber: true, ward: { select: { name: true } } } } },
      }),
      this.prisma.icuAdmission.findFirst({
        where: { patientId: record.patientId, status: 'ADMITTED' },
        select: { id: true, icuBed: { select: { id: true, unitName: true, bedNumber: true } } },
      }),
      // 입원 가용 조회와 같이 응급 구역(EMERGENCY) 병상은 제외
      this.prisma.bed.findMany({
        where: { status: 'AVAILABLE', ward: { type: { not: 'EMERGENCY' }, isActive: true } },
        orderBy: [{ ward: { name: 'asc' } }, { roomNumber: 'asc' }, { bedNumber: 'asc' }],
        take: CAP + 1,
        select: { id: true, roomNumber: true, bedNumber: true, ward: { select: { name: true } } },
      }),
      this.prisma.icuBed.findMany({ where: { status: 'AVAILABLE' }, orderBy: [{ unitName: 'asc' }, { bedNumber: 'asc' }], take: CAP + 1, select: { id: true, unitName: true, bedNumber: true } }),
    ]);
    return {
      discharged: !!record.dischargeTime,
      activeAdmission: admission,
      activeIcuAdmission: icu,
      wardBeds: wardBeds.slice(0, CAP),
      wardBedsTruncated: wardBeds.length > CAP,
      icuBeds: icuBeds.slice(0, CAP),
      icuBedsTruncated: icuBeds.length > CAP,
    };
  }

  async discharge(id: string, dischargedById: string, disposition: string, overrideReason?: string, dischargeHandoff?: HandoffDto, dischargedByRole?: string,
    dest?: { targetBedId?: string; icuBedId?: string; icuAdmitReason?: string }) {
    const record = await this.prisma.pacuRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('PACU record not found');
    if (record.dischargeTime) throw new BadRequestException('이미 퇴실 처리되었습니다.');
    if (!['WARD', 'ICU', 'HOME'].includes(disposition)) {
      throw new BadRequestException('유효한 퇴실 구분: WARD, ICU, HOME');
    }

    // 환자안전 게이트 이원화 — HOME은 PADSS(귀가 척도), WARD/ICU는 수정 Aldrete
    // 🔴 **미평가와 0점은 다른 사실이다.** 게이트 판정은 종전과 같이 미평가도 미달로 막지만
    //    (안전측), 사람에게는 "0점"이 아니라 "아직 평가하지 않았다"고 말한다 — 종전 문구는
    //    한 번도 재지 않은 환자에게 "PADSS 0점"이라고 했다(재서 0점이 나온 것과 구분되지 않았다).
    const s = await this.getMonitoringSettings();
    const ALDRETE_MIN = s.scales.aldrete.dischargeMin;
    const PADSS_MIN = s.scales.padss.dischargeMin;
    let below = false;
    if (disposition === 'HOME') {
      const padss = record.padssScore;
      below = padss === null || padss < PADSS_MIN;
      if (below && !overrideReason) {
        throw new BadRequestException({
          code: padss === null ? 'PADSS_NOT_ASSESSED' : 'PADSS_BELOW_THRESHOLD',
          message: padss === null
            ? `귀가(HOME)는 PADSS 평가가 필요합니다 — 아직 평가 기록이 없습니다(기준 ${PADSS_MIN}점). 평가 없이 내보내려면 사유(마취과 판단)가 필요합니다.`
            : `귀가(HOME)는 PADSS ${padss}점으로 기준(${PADSS_MIN}점) 미달입니다. 강제 퇴실은 사유(마취과 판단)가 필요합니다.`,
        });
      }
    } else {
      const score = record.aldretScore;
      const zero = aldreteZeroItems(record.aldreteDetail) ?? [];
      below = score === null || score < ALDRETE_MIN || zero.length > 0;
      if (below && !overrideReason) {
        throw new BadRequestException({
          code: score === null ? 'ALDRETE_NOT_ASSESSED' : zero.length ? 'ALDRETE_ITEM_ZERO' : 'ALDRETE_BELOW_THRESHOLD',
          ...(zero.length ? { details: { zeroItems: zero } } : {}),
          message: score === null
            ? `Aldrete 평가 기록이 없습니다(퇴실 기준 ${ALDRETE_MIN}점/${PACU_SCALES.aldrete.max}점 만점). 평가 없이 퇴실하려면 사유(마취과 판단)가 필요합니다.`
            : zero.length
              ? 'Aldrete 0점 항목이 있어 퇴실 기준 미달입니다. 강제 퇴실은 사유(마취과 판단)가 필요합니다.'
              : `Aldrete ${score}점으로 퇴실 기준(${ALDRETE_MIN}점) 미달입니다. 강제 퇴실은 사유(마취과 판단)가 필요합니다.`,
        });
      }
    }

    // 기준 미달 강제 퇴실은 의사/마취과 판단 — 간호사 단독 override 금지(사유만으로 불충분).
    if (below && dischargedByRole && !['DOCTOR', 'ADMIN'].includes(dischargedByRole)) {
      throw new ForbiddenException({ code: 'DISCHARGE_OVERRIDE_REQUIRES_DOCTOR', message: '기준 미달 강제 퇴실은 의사(마취과)만 승인할 수 있습니다.' });
    }

    // ── 퇴실 목적지(2026-09-30) — 퇴실과 **같은 트랜잭션**에서 병상·ICU 를 잇는다(종전: 여정 이벤트만 · 병상·입원은 그대로) ──
    //  · WARD: 재원 중 입원이 있어야 한다(없으면 409 — 입원 수속은 입원 경로) · 병상을 바꾸면 전실 정본(transferBedInTx) · 아니면 원 병상 복귀
    //  · ICU: 의사가 먼저 연 ICU 입실이 있으면 잇는다 · 없으면 ICU 병상 + 입실 사유 + 의사(ICU 입실 EP 와 같은 권한)로 입실 정본(admitIcuInTx)
    //  · HOME: 재원 중 입원이 있으면 409 — 입원 환자의 귀가는 퇴원 절차(퇴원요약·정산)를 건너뛰지 않는다
    //  🔴 병동 병상을 ICU 로 갈 때 비울지는 사람 결정(`pacu.icuWardBedHold`) — 지금은 건드리지 않고 그 사실을 기록한다
    const [admission, icuActive] = await Promise.all([
      this.prisma.admission.findFirst({
        where: { patientId: record.patientId, status: 'ADMITTED' }, orderBy: { admitDate: 'desc' },
        select: { id: true, bedId: true, bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } } },
      }),
      disposition === 'ICU'
        ? this.prisma.icuAdmission.findFirst({ where: { patientId: record.patientId, status: 'ADMITTED' }, select: { id: true, icuBedId: true } })
        : Promise.resolve(null),
    ]);
    const role = dischargedByRole ?? '';
    if (disposition === 'WARD') {
      if (!admission) throw new ConflictException({ code: 'PACU_WARD_NEEDS_ADMISSION', message: 'Ward disposition needs an active admission — admit the patient first' });
      if (dest?.targetBedId && dest.targetBedId !== admission.bedId && !['NURSE', 'ADMIN'].includes(role)) {
        // 병상 이동 EP(inpatient transfer)와 같은 권한
        throw new ForbiddenException({ code: 'PACU_TRANSFER_ROLE', message: 'Only nurses or administrators can move the patient to another bed' });
      }
    } else if (disposition === 'ICU') {
      if (!icuActive) {
        if (!dest?.icuBedId) throw new ConflictException({ code: 'PACU_ICU_BED_REQUIRED', message: 'Choose an ICU bed, or open the ICU admission first' });
        if (!['DOCTOR', 'ADMIN'].includes(role)) throw new ForbiddenException({ code: 'PACU_ICU_ADMIT_ROLE', message: 'ICU admission requires a doctor' });
        if (!dest.icuAdmitReason?.trim()) throw new BadRequestException({ code: 'PACU_ICU_REASON_REQUIRED', message: 'An ICU admission reason is required' });
      }
    } else if (disposition === 'HOME' && admission) {
      throw new ConflictException({ code: 'PACU_HOME_WHILE_ADMITTED', message: 'The patient has an active admission — use the inpatient discharge process', details: { admissionId: admission.id } });
    }

    const now = new Date();
    const { updated, destination, transferredWard } = await this.prisma.$transaction(async (tx) => {
      let destination: Record<string, unknown>;
      let transferredWard: string | null = null;
      if (disposition === 'WARD' && admission) {
        if (dest?.targetBedId && dest.targetBedId !== admission.bedId) {
          const moved = await transferBedInTx(tx, admission, dest.targetBedId, 'PACU_DISCHARGE', now);
          transferredWard = moved.bed?.ward?.name ?? null;
          destination = { kind: 'WARD', action: 'TRANSFERRED', admissionId: admission.id, bedId: moved.bedId, fromBedId: admission.bedId, wardName: transferredWard, roomNumber: moved.bed?.roomNumber ?? null, bedNumber: moved.bed?.bedNumber ?? null };
        } else {
          destination = { kind: 'WARD', action: 'RETURN_TO_BED', admissionId: admission.id, bedId: admission.bedId, wardName: admission.bed?.ward?.name ?? null, roomNumber: admission.bed?.roomNumber ?? null, bedNumber: admission.bed?.bedNumber ?? null };
        }
      } else if (disposition === 'ICU') {
        if (icuActive) {
          destination = { kind: 'ICU', action: 'ICU_EXISTING', icuAdmissionId: icuActive.id, icuBedId: icuActive.icuBedId, wardBedHeld: admission ? admission.bedId : null };
        } else {
          const icu = await admitIcuInTx(tx, { patientId: record.patientId, icuBedId: dest!.icuBedId!, doctorId: dischargedById, admitReason: dest!.icuAdmitReason!.trim() });
          destination = { kind: 'ICU', action: 'ICU_ADMITTED', icuAdmissionId: icu.id, icuBedId: icu.icuBedId, unitName: icu.icuBed?.unitName ?? null, bedNumber: icu.icuBed?.bedNumber ?? null, wardBedHeld: admission ? admission.bedId : null };
        }
      } else {
        destination = { kind: 'HOME', action: 'HOME' };
      }
      // 조건부 — 동시에 다른 단말이 퇴실 처리했으면 병상·ICU 쓰기까지 되돌린다
      const done = await tx.pacuRecord.updateMany({
        where: { id, dischargeTime: null },
        data: {
          dischargeTime: now,
          disposition,
          dischargedById,
          dischargeOverride: below ? (overrideReason ?? null) : null,
          dischargeHandoff: (dischargeHandoff ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          destination: destination as Prisma.InputJsonValue,
        },
      });
      if (done.count === 0) throw new ConflictException({ code: 'PACU_ALREADY_DISCHARGED', message: '이미 퇴실한 환자입니다.' });
      const updated = await tx.pacuRecord.findUnique({ where: { id } });
      return { updated, destination, transferredWard };
    });
    if (transferredWard !== null || (destination as { action?: string }).action === 'TRANSFERRED') {
      this.journey?.emit({
        patientId: record.patientId, eventType: 'BED_TRANSFER',
        // 서버가 문장을 조립하지 않는다 — 병동 이름은 department 로(값)
        title: '전실', department: transferredWard ?? undefined,
        refType: 'ADMISSION', refId: (destination as { admissionId?: string }).admissionId,
      });
    }
    this.journey?.emit({
      patientId: record.patientId, eventType: 'PACU_DISCHARGE',
      title: `PACU 퇴실 → ${DISPOSITION_LABEL[disposition] ?? disposition}`,
      // 🔴 (2026-09-14) 강제 퇴실 사유(overrideReason)는 직원 자유 입력 — 환자 노출 유형이라 싣지 않는다(PACU 기록 dischargeOverride 가 정본).
      description: below ? '기준 미달 강제 퇴실' : undefined,
      doctorId: dischargedById, refType: 'PACU', refId: id,
      severity: below ? 'WARNING' : undefined,
      episode: { type: 'Surgery', id: record.surgeryId }, occurredAt: now, // 여정 P1: 원장 dischargeTime 과 같은 값
      outcome: disposition, // 여정 P2: 퇴실 목적지 구분
    });
    return updated;
  }

  async getVitals(id: string) {
    const r = await this.prisma.pacuRecord.findUnique({ where: { id }, select: { vitalSigns: true } });
    if (!r) throw new NotFoundException('PACU record not found');
    const arr = (r.vitalSigns as unknown[]) ?? [];
    return [...arr].reverse(); // 최신순
  }

  async getActivePatients() {
    const [rows, settings] = await Promise.all([
      this.prisma.pacuRecord.findMany({
        where: { dischargeTime: null },
        orderBy: { arrivalTime: 'asc' }, take: 300,
        include: { patient: { select: PATIENT_SELECT } },
      }),
      this.getMonitoringSettings(),
    ]);
    const now = Date.now();
    return rows.map((r) => this.decorate(r, settings, now));
  }

  /** 수술 완료 → PACU 입실 대기(완료 + PACU 미입실, 최근 24h). */
  async pendingAdmissions() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const surgeries = await this.prisma.surgery.findMany({
      where: { status: 'COMPLETED', endedAt: { gte: since } },
      orderBy: { endedAt: 'desc' },
      select: {
        id: true, patientId: true, procedureName: true, endedAt: true, anesthesiaType: true,
        patient: { select: PATIENT_SELECT },
      },
    });
    if (!surgeries.length) return [];
    const admitted = await this.prisma.pacuRecord.findMany({
      where: { surgeryId: { in: surgeries.map((s) => s.id) } },
      select: { surgeryId: true },
    });
    const done = new Set(admitted.map((a) => a.surgeryId));
    return surgeries.filter((s) => !done.has(s.id));
  }

  /**
   * 회복실 관제 지표 — **화면이 각자 세지 않는다.**
   *
   * 🔴 종전엔 이 EP 를 아무도 부르지 않았고(소비처 0), `/pacu` 화면이 목록에서 자기 식으로
   *    다시 셌다(P12 정본이 둘). 게다가 두 셈이 서로 달랐다 —
   *    화면은 강제 종결분을 평균에서 뺐지만 여기서는 넣었고, 여기서는 표본이 없을 때 `0` 을 냈다.
   *    **표본 부재의 정답은 `0` 이 아니라 `null` + "산출 불가"** 다(0 은 다른 사실이다).
   *
   * 🔴 평균에서 제외하는 것은 `dischargeOverride` 가 있는 기록 전부다 —
   *    2026-08-12 방치 데이터 정리로 닫힌 39일짜리 3건이 평균 체류를 `1시간 25분`→`19일`로
   *    만들었기 때문이다(그 39일은 체류가 아니라 "퇴실 처리 누락 기간"이다).
   *    다만 기준 미달 **강제 퇴실**도 같이 빠지므로, 뺀 건수를 함께 내보내 화면이 그렇게 말한다.
   */
  async getStats() {
    const settings = await this.getMonitoringSettings();
    const now = Date.now();
    // 🔴 (2026-10-07) 종전 `setHours(0,0,0,0)` 은 실행 환경 시간대 자정 — 병원 표준시(KST) 자정으로(서버가 UTC 면 하루 경계가 오전 9시가 된다)
    const kstNow = new Date(now + 9 * 3_600_000);
    const todayStart = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3_600_000);

    const [activeRows, completed, dischargedToday] = await Promise.all([
      this.prisma.pacuRecord.findMany({
        where: { dischargeTime: null },
        select: {
          arrivalTime: true, dischargeTime: true, vitalSigns: true, aldretScore: true, padssScore: true,
          arrivalHandoff: true, dischargeHandoff: true, delayReason: true,
        },
        take: 300,
      }),
      this.prisma.pacuRecord.findMany({
        where: { dischargeTime: { not: null } },
        select: {
          arrivalTime: true, dischargeTime: true, aldretScore: true, dischargeOverride: true, dischargeHandoff: true,
          ponvScore: true, scoreHistory: true, vitalSigns: true, complications: true, disposition: true, anesthesiaSignOffAt: true,
        },
        orderBy: { dischargeTime: 'desc' }, take: 100,
      }),
      this.prisma.pacuRecord.count({ where: { dischargeTime: { gte: todayStart } } }),
    ]);

    const decorated = activeRows.map((r) => this.decorate(r, settings, now).monitoring);
    const measurable = completed.filter((r) => r.dischargeOverride === null);
    const excludedOverride = completed.length - measurable.length;

    const avgStayMinutes = measurable.length
      ? Math.round(measurable.reduce((s, r) => s + (r.dischargeTime!.getTime() - r.arrivalTime.getTime()) / 60000, 0) / measurable.length)
      : null; // 표본 없음 = 산출 불가(0 이 아니다)
    const scored = measurable.filter((r) => r.aldretScore !== null);
    const avgAldrete = scored.length
      ? Math.round((scored.reduce((s, r) => s + (r.aldretScore as number), 0) / scored.length) * 10) / 10
      : null;

    return {
      activeCount: activeRows.length,
      dischargedToday,
      avgStayMinutes,
      avgAldrete,
      /** 평균의 분모 — "누적 N명 기준"을 화면이 함께 말한다 */
      measurableCount: measurable.length,
      excludedOverride,
      recentCompleted: completed.length,
      /** 지금 회복실에서 사람이 봐야 할 것 */
      vitalsOverdueCount: decorated.filter((m) => m.vitalsOverdue).length,
      noVitalsYetCount: decorated.filter((m) => m.noVitalsYet).length,
      prolongedStayCount: decorated.filter((m) => m.prolongedStay).length,
      hypothermiaCount: decorated.filter((m) => m.hypothermia === true).length,
      /** 체온을 한 번도 재지 않은 재실 환자 — `0` 이 아니라 "모른다"로 센다 */
      tempUnknownCount: decorated.filter((m) => m.hypothermia === null).length,
      arrivalHandoffMissingCount: decorated.filter((m) => !m.arrivalHandoffRecorded).length,
      dischargeHandoffMissingCount: completed.filter((r) => r.dischargeHandoff === null).length,
      /** 재실 중 퇴실 지연 사유별(사유 미기록은 세지 않는다 — 지연 판정은 prolongedStayCount) */
      delayReasonCounts: activeRows.reduce<Record<string, number>>((a, r) => { if (r.delayReason) a[r.delayReason] = (a[r.delayReason] ?? 0) + 1; return a; }, {}),
      quality: this.qualityOf(completed, settings.hypothermiaWarnC),
      settings,
    };
  }

  /**
   * 회복실 질 지표(2026-10-07) — 최근 퇴실(최대 100건)에서 **기록된 것만** 센다. 분모를 함께 · 표본 0 = null(산출 불가).
   *  · PONV 2점 이상(평가된 기록 중) · 입실 첫 체온 저체온(체온 잰 기록 중) · 호흡기 사건(기도·호흡저하·재삽관·탈포화) · ICU 퇴실
   * 🔴 ICU 퇴실이 "계획 외"인지는 수술 전 계획이 기록되지 않아 모른다 — 계획 외라 말하지 않는다.
   */
  private qualityOf(rows: Array<{ ponvScore: number | null; scoreHistory: unknown; vitalSigns: unknown; complications: unknown; disposition: string | null; anesthesiaSignOffAt: Date | null }>, hypoC: number) {
    const rate = (num: number, den: number) => ({ num, den, rate: den > 0 ? num / den : null });
    const ponvScores = (r: (typeof rows)[number]) => {
      const h = Array.isArray(r.scoreHistory) ? (r.scoreHistory as Array<{ kind?: string; score?: number }>).filter((e) => e.kind === 'PONV' && typeof e.score === 'number').map((e) => e.score as number) : [];
      return h.length ? h : r.ponvScore != null ? [r.ponvScore] : [];
    };
    const ponvAssessed = rows.filter((r) => ponvScores(r).length > 0);
    const firstTemp = (r: (typeof rows)[number]) => {
      const v = Array.isArray(r.vitalSigns) ? (r.vitalSigns as Array<{ temp?: number }>).find((x) => typeof x.temp === 'number') : undefined;
      return v?.temp ?? null;
    };
    const tempMeasured = rows.filter((r) => firstTemp(r) != null);
    const RESP = new Set(['AIRWAY', 'RESP_DEPRESSION', 'REINTUBATION', 'DESATURATION']);
    const hasResp = (r: (typeof rows)[number]) => Array.isArray(r.complications) && (r.complications as Array<{ type?: string }>).some((c) => RESP.has(String(c.type)));
    return {
      sample: rows.length,
      ponvModerate: rate(ponvAssessed.filter((r) => Math.max(...ponvScores(r)) >= 2).length, ponvAssessed.length),
      arrivalHypothermia: { ...rate(tempMeasured.filter((r) => (firstTemp(r) as number) < hypoC).length, tempMeasured.length), thresholdC: hypoC },
      respiratoryEvent: rate(rows.filter(hasResp).length, rows.length),
      icuDisposition: { ...rate(rows.filter((r) => r.disposition === 'ICU').length, rows.length), plannedUnknown: true },
      anesthesiaSignOff: rate(rows.filter((r) => r.anesthesiaSignOffAt != null).length, rows.length),
    };
  }
}

/**
 * 회복실 활력 이상 판정 정본(순수 함수 · 2026-10-07 추출) — 기록 경로(`recordVitals`)와 데모 생성이 같은 규칙을 쓴다.
 */
export function pacuVitalFlags(
  v: { bp?: string; hr?: number; rr?: number; spo2?: number; temp?: number },
  hypothermiaWarnC: number = PACU_MONITORING_DEFAULTS.hypothermiaWarnC,
  t: PacuAlertThresholds = PACU_ALERT_DEFAULTS,
): string[] {
    // 🔴 (2026-10-01) 임계는 설정(`pacu.vitalAlertThresholds`) — 소견 문구에 숫자를 박지 않는다(기준이 바뀌면 문구가 거짓이 된다).
    //    적용 기준값은 화면이 설정 응답(`alertThresholds`)으로 함께 보여 준다.
    const flags: string[] = [];
    if (typeof v.spo2 === 'number') {
      if (v.spo2 === 0) flags.push('SpO2 0 — 신호 없음(프로브·환자 즉시 확인)');
      else if (v.spo2 < t.spo2Low) flags.push('저산소(SpO2 기준 미만)');
    }
    if (typeof v.hr === 'number') {
      if (v.hr === 0) flags.push('HR 0 — 심박 없음(즉시 확인)');
      else if (v.hr < t.hrLow) flags.push('서맥(HR 기준 미만)');
      else if (v.hr > t.hrHigh) flags.push('빈맥(HR 기준 초과)');
    }
    if (typeof v.rr === 'number') {
      if (v.rr === 0) flags.push('RR 0 — 호흡 없음(즉시 확인)');
      else if (v.rr < t.rrLow) flags.push('호흡저하(RR 기준 미만)');
      else if (v.rr > t.rrHigh) flags.push('빈호흡(RR 기준 초과)');
    }
    const sbp = typeof v.bp === 'string' ? parseInt(v.bp.split('/')[0], 10) : NaN;
    if (Number.isFinite(sbp)) {
      if (sbp < t.sbpLow) flags.push('저혈압(SBP 기준 미만)');
      else if (sbp > t.sbpHigh) flags.push('고혈압(SBP 기준 초과)');
    }
    const temp = typeof v.temp === 'number' ? v.temp : NaN;
    if (Number.isFinite(temp)) {
      if (temp >= t.tempHigh) flags.push('발열(기준 이상)');
      else if (temp < t.tempLow) flags.push('저체온(기준 미만)');
      // 🔴 35~36 구간은 종전에 아무 말도 하지 않았다. 마취 후 저체온은 회복실에서 가장 흔한
      //    합병증이고 **가온 중재의 대상**인데(오한·창상감염·출혈 위험) 35.0 을 넘으면 침묵했다.
      //    기존 저체온 경보를 대체하지 않고 그 위에 경도 구간을 얹는다 — 좁힌 것이 아니라 넓혔다.
      else if (temp < hypothermiaWarnC) flags.push(`경도 저체온(<${hypothermiaWarnC}) — 가온 중재 대상`);
    }
    return flags;
}
