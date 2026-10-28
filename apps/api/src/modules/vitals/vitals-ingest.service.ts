import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { roundBy } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { VitalsTimeFlag as SharedVitalsTimeFlag } from '@hospital-run/shared';

/**
 * 활력 수집 포트 (`VitalsIngestService`) — **활력이 저장되는 단 하나의 진입점.**
 *
 * 기획: `docs/01-plan/features/vitals-device-integration.plan.md` §3(단일 수집 포트)·§9 P0.
 * 이 파일은 그 계획의 **선행 조건이 "—" 인 항목**(스키마 승인 없이 착수 가능)만 구현한다.
 *
 * ── 왜 필요한가 (2026-08-20 실측) ────────────────────────────────────────────────
 * 활력 쓰기가 세 곳에 있었고 **같은 개념을 서로 다르게** 처리했다:
 *   · 외래 `PreVisitVitals`  — roundBy 경유 · 이상판정 · `vitals.recorded` 발행 · 측정시각 **입력 불가**(DB now())
 *   · 입원 `FlowSheetEntry` — 반올림 없음 · 이상판정 없음 · 이벤트 없음 · 측정시각 입력 가능
 *   · 중환자 `IcuRecord`   — `v ? Number(v) : undefined` 라 🔴 **실측 0 이 미측정으로 사라짐**
 *                            (RASS 0=각성, 통증 0, PEEP 0, SpO₂ 0=프로브 이탈이 전부 유실)
 * 어느 것도 중복 수신·미래 시각·환자 결속을 검사하지 않았다.
 *
 * ── 이 포트가 하는 일 ───────────────────────────────────────────────────────────
 *  1. 정규화   — 결측은 `null`(0·기본값으로 접지 않는다) · 수치 정책 정본(`roundBy`) 경유
 *  2. 멱등     — 같은 환자·같은 **측정시각**·같은 값의 재수신을 저장하지 않고 `duplicate` 로 알림
 *  3. 시각검사 — 미래 시각·과도한 소급을 **표시**한다(거부하지 않는다 — 막으면 방치된다)
 *  4. 환자결속 — 결속 근거가 없으면 저장하지 않고 `PENDING` 을 돌려준다(임의 환자에 붙이지 않는다)
 *  5. 저장     — 기존 저장소 재사용(외래=PreVisitVitals·입원=FlowSheetEntry·중환자=IcuRecord)
 *  6. 이벤트   — `vitals.recorded` 를 **여기 한 곳에서만** 발행
 *
 * ── 🔴 스키마가 없어 **하지 못하는 것** (기획 §5 사람 승인 대기) ──────────────────
 *  · `source`(MANUAL/DEVICE/...)·`deviceId`·`reliability`·`rawRef` 를 **저장할 컬럼이 없다.**
 *    포트는 이 정보를 인터페이스로 **받되 저장하지 않는다.** 저장한 척하지 않기 위해
 *    반환값 `unstored` 에 "받았지만 저장되지 않은 것"을 그대로 실어 보낸다(전송 흉내 금지와 같은 규칙).
 *  · `recordedBy`/`nurseId` 가 세 저장소 모두 **NOT NULL** 이라 기기 측정(사람 없음)은 아예 저장할 수 없다.
 *    아무 사람 ID 를 빌려 쓰면 그 순간 원장이 거짓이 되므로 `PENDING(NO_RECORDER)` 로 돌려준다.
 *  · `receivedAt`(수신 시각) 컬럼이 없다. `PreVisitVitals` 는 `createdAt` 조차 없어 **수신 시각을 남길 자리가 전혀 없다.**
 *  · 보류함(`UnboundMeasurement`) 테이블이 없다 → 미결속 측정을 **쌓아 두지 못한다.**
 *    버리지 않기 위해 `PENDING` 결과 + 사유를 호출자에게 돌려주고 로그로 센다(화면·큐는 P1).
 */

// ── 정규 DTO ───────────────────────────────────────────────────────────────────

/** 저장 라우팅 — 새 저장소를 만들지 않는다(기획 §3 Canonical Store) */
export type VitalsRoute = 'OUTPATIENT' | 'INPATIENT' | 'ICU';

/** 출처 종류 — 🔴 현재 **저장되지 않는다**(컬럼 부재). 기획 §5.1 승인 후 배선 */
export type VitalsSourceKind = 'MANUAL' | 'DEVICE' | 'IMPORT' | 'PATIENT_REPORTED';

/** 신뢰도 — 🔴 현재 **저장되지 않는다**(컬럼 부재). 기획 §6 */
export type VitalsReliability = 'OK' | 'CALIBRATION_EXPIRED' | 'ARTIFACT_SUSPECT' | 'UNVERIFIED';

/**
 * 출처 메타 — 포트는 이것을 **받지만 어느 것도 저장하지 못한다.**
 * 어댑터(P1)가 채우게 될 자리를 지금 열어 두되, 저장된 것처럼 보이지 않도록 반환값이 밝힌다.
 */
export interface VitalsSourceMeta {
  kind: VitalsSourceKind;
  /** `Equipment.id` — 저장 컬럼 없음 */
  deviceId?: string | null;
  /** 기기 시리얼/MAC — 저장 컬럼 없음 */
  deviceSerial?: string | null;
  /** 원문 보관 참조 — 저장 컬럼 없음 */
  rawRef?: string | null;
  /** 저장 컬럼 없음 */
  reliability?: VitalsReliability;
}

/**
 * 활력 관측값 — 🔴 **결측은 `null`.** `0`·`false`·정상값으로 접지 않는다.
 * (`undefined` 로 들어오면 포트가 `null` 로 접는다. 그 반대는 하지 않는다.)
 */
export interface VitalsValues {
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  temperature?: number | null;
  spo2?: number | null;
  respiratoryRate?: number | null;
  weight?: number | null;
  height?: number | null;
  painScore?: number | null;
  /** NEWS2 요소 — 미관측 `null`(`false` 아님. 2점이 조용히 사라진다) */
  supplementalO2?: boolean | null;
  /**
   * 의식 수준 — **원문 그대로** 저장한다.
   * 🔴 여기서 `normalizeAcvpu` 로 접어 저장하면 기록된 어휘가 바뀐다(구 AVPU 'VERBAL' → 'VOICE').
   *    어휘 접기는 **채점 시점**(shared `canScoreNews2`/`scoreNews2`)의 일이지 저장의 일이 아니다.
   */
  consciousness?: string | null;
}

/** 라우트별 비(非)활력 동반 컬럼 — 포트는 값을 해석하지 않고 그대로 전달한다 */
export interface VitalsExtras {
  // 공통
  notes?: string | null;
  // 외래(PreVisitVitals)
  bmi?: number | null;
  isAbnormal?: boolean;
  // 입원(FlowSheetEntry)
  painLocation?: string | null;
  shiftType?: 'DAY' | 'EVENING' | 'NIGHT';
  gcsScore?: number | null;
  // 중환자(IcuRecord)
  gcScore?: number | null;
  pupilReaction?: string | null;
  ventMode?: string | null;
  fio2?: number | null;
  peep?: number | null;
  tidalVolume?: number | null;
  pip?: number | null;
  apacheScore?: number | null;
  sofaScore?: number | null;
  sedationScore?: number | null;
  // I/O (입원·중환자 공통)
  intakeOral?: number | null;
  intakeIv?: number | null;
  intakeOther?: number | null;
  outputUrine?: number | null;
  outputDrain?: number | null;
  outputOther?: number | null;
}

export interface VitalsObservation {
  route: VitalsRoute;
  /** 외래 필수. 입원·중환자는 `admissionId` 가 결속 근거다 */
  patientId?: string | null;
  admissionId?: string | null;
  encounterId?: string | null;
  queueId?: string | null;
  /**
   * 🔴 **측정 시각. 모르면 `null`/생략한다 — `now()` 로 채우지 않는다.**
   * 모르는 채로 저장하면 그 사실을 `timeFlags` 로 돌려준다(원장에는 스키마상 수신 시각이 박힌다 — §스키마 부재).
   */
  measuredAt?: Date | string | null;
  /** 서버 수신 시각(기본 now). 🔴 저장할 컬럼이 없다 — 판정에만 쓴다 */
  receivedAt?: Date;
  /** 기록자 — 세 저장소 모두 NOT NULL. 없으면 저장하지 않는다 */
  recordedBy?: string | null;
  values: VitalsValues;
  extras?: VitalsExtras;
  /** 🔴 받되 저장되지 않는다(컬럼 부재). 기본 MANUAL */
  source?: VitalsSourceMeta;
}

// ── 반환 shape ─────────────────────────────────────────────────────────────────

export type VitalsIngestStatus = 'STORED' | 'DUPLICATE' | 'PENDING';

/**
 * 🔴 값 정본은 shared 다(`VITALS_TIME_FLAG`). 여기서 문자열을 다시 적으면 화면과 갈라진다 —
 * 2026-08-20 에 실제로 갈라져 **교집합 0**이 됐다(화면이 다른 어휘를 적어 전건 폴백).
 */
export type VitalsTimeFlag = SharedVitalsTimeFlag;

export type VitalsPendingReason =
  /** 환자·재원 결속 근거가 없다 — 🔴 추정 결속 금지 */
  | 'NO_PATIENT_BINDING'
  /** 기록자가 없다 — 저장소가 NOT NULL 이라 기기 측정을 담을 자리가 없다 */
  | 'NO_RECORDER';

/** 🔴 받았지만 **저장되지 않은 것** — 저장한 척하지 않기 위해 반환값이 밝힌다 */
export interface VitalsUnstored {
  reason: 'SCHEMA_PENDING';
  /** 저장할 컬럼이 없는 필드 이름 */
  fields: readonly string[];
  /** 호출자가 넘긴 출처(그대로 되돌려준다 — 저장되지 않았다) */
  source: VitalsSourceMeta | null;
  /** 수신 시각도 담을 자리가 없다 */
  receivedAt: Date;
}

export interface VitalsIngestResult<T = unknown> {
  status: VitalsIngestStatus;
  /** 저장된 행. `DUPLICATE`·`PENDING` 이면 `null` */
  stored: T | null;
  duplicate: boolean;
  /** 중복일 때 기존 행 id */
  duplicateOfId: string | null;
  pendingReason: VitalsPendingReason | null;
  timeFlags: VitalsTimeFlag[];
  /**
   * 멱등 검사를 **실제로 수행했는지**. 🔴 `false` 는 "중복 없음"이 아니라 "판정 불가"다
   * (측정 시각을 모르면 삽입 시각으로 중복을 잴 수밖에 없고, 그러면 정상 재측정이 중복으로 지워진다).
   */
  dedupeChecked: boolean;
  /** 저장된 측정 시각(모르면 `null` — 수신 시각을 측정 시각처럼 돌려주지 않는다) */
  measuredAt: Date | null;
  unstored: VitalsUnstored;
}

// ── 판정 상수 (🔴 config 키를 새로 만들지 않는다 — 근거는 아래 주석) ─────────────

/**
 * 미래 시각 허용 오차 — 기기·단말 NTP 오차 흡수용.
 * 🔴 부호가 아니라 **격차**를 잰다(1ms 역전을 사건으로 세면 거짓 경보가 진짜 경보를 죽인다 — v4.4.0 교훈).
 * 2분: 이 저장소가 이미 겪은 오탐(시점 정합 스캔의 1ms 역전 32건)을 흡수하면서 사람의 오타(시·일 단위)는 걸러지는 폭.
 */
const FUTURE_TOLERANCE_MS = 2 * 60 * 1000;

/**
 * 과도한 소급 임계 — 24시간.
 * 🔴 이 값은 통계가 아니다. 기기 축이 아직 없어 **p95×2 를 뽑을 실측 분포가 없다**(기획 §3.2 가 요구하는 방식).
 *    그래서 임상 운영 규칙에서 왔다: 활력 소급 기록은 간호 3교대 1주기(24h) 안에서 이루어진다.
 *    🔴 기기 축이 생기면 이 상수를 그 축의 실측(p95×2)으로 **대체**한다.
 *    어느 경우에도 **거부하지 않는다** — 늦게 온 과거 측정은 버릴 것이 아니라 늦었다고 표시할 것이다.
 */
const EXCESSIVE_BACKDATE_MS = 24 * 60 * 60 * 1000;

/**
 * `vitals.recorded` 를 발행하는 라우트.
 *
 * 🔴 **외래만**이다. 입원·중환자 경로는 개통 이래 이 이벤트를 발행한 적이 없다.
 *    지금 켜면 `ChronicObservation` 미러(만성 추이)에 **입원 급성기 혈압·체중이 새로 섞인다** —
 *    그건 수렴이 아니라 임상 데이터 변경이고, 이 작업의 전제(동작 회귀 0)를 깬다.
 *    켤지 말지는 만성질환 추이의 정의 문제라 임상 판단이 필요하다(P1).
 *    ⚠ 지금 중요한 것: 이 결정이 **여기 한 줄**에 있고 경로마다 흩어져 있지 않다는 것.
 */
const EMIT_RECORDED_ROUTES: ReadonlySet<VitalsRoute> = new Set<VitalsRoute>(['OUTPATIENT']);

/** 저장할 컬럼이 없는 필드(기획 §5.1) — 반환값이 이 목록을 그대로 싣는다 */
const UNSTORABLE_FIELDS = ['source', 'deviceId', 'deviceSerial', 'reliability', 'rawRef', 'receivedAt'] as const;

// ── 구현 ───────────────────────────────────────────────────────────────────────

@Injectable()
export class VitalsIngestService {
  private readonly logger = new Logger(VitalsIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    /** 없으면 이벤트를 발행하지 않는다(발행한 척하지 않는다) */
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /**
   * 단일 진입점. 🔴 활력을 prisma 로 **직접** 쓰는 코드를 새로 만들지 않는다
   *    (구조 가드 `test/architecture/vitals-ingest-port-guard.spec.ts` 가 기준선 0 으로 동결).
   */
  async ingest<T = unknown>(obs: VitalsObservation): Promise<VitalsIngestResult<T>> {
    const receivedAt = obs.receivedAt ?? new Date();
    const source = obs.source ?? { kind: 'MANUAL' as const };
    const unstored: VitalsUnstored = {
      reason: 'SCHEMA_PENDING',
      fields: UNSTORABLE_FIELDS,
      source,
      receivedAt,
    };

    // ① 시각 — 🔴 모르면 모른다고 둔다. now() 로 채워 놓고 아는 척하지 않는다.
    const measuredAt = this.parseMeasuredAt(obs.measuredAt);
    const timeFlags = this.checkTime(measuredAt, receivedAt);

    // ② 환자 결속 — 근거가 없으면 저장하지 않는다(🔴 추정 결속 금지)
    const pendingReason = this.checkBinding(obs);
    if (pendingReason) {
      // 보류함 테이블이 없다 → 쌓아 두지 못한다. 최소한 세어는 둔다(사라지는 알림으로 끝내지 않기 위해).
      this.logger.warn(
        `활력 수집 보류(${pendingReason}) route=${obs.route} source=${source.kind} ` +
          `— 보류함 테이블 부재로 적재하지 못했다(기획 §5.2 승인 대기)`,
      );
      return {
        status: 'PENDING', stored: null, duplicate: false, duplicateOfId: null,
        pendingReason, timeFlags, dedupeChecked: false, measuredAt, unstored,
      };
    }

    // ③ 정규화 — 결측은 null. 🔴 기기 보고값은 재반올림하지 않는다(보고값 변조)
    const v = this.normalize(obs.values, source.kind);
    const x = this.normalizeExtras(obs.extras ?? {}, source.kind);

    // ④ 멱등 — 측정 시각을 아는 경우에만 판정할 수 있다
    const dedupeChecked = measuredAt != null;
    if (dedupeChecked) {
      const dup = await this.findDuplicate(obs, v, measuredAt);
      if (dup) {
        this.logger.log(`활력 재수신 무시(멱등) route=${obs.route} 기존행=${dup.id}`);
        return {
          status: 'DUPLICATE', stored: null, duplicate: true, duplicateOfId: dup.id,
          pendingReason: null, timeFlags, dedupeChecked, measuredAt, unstored,
        };
      }
    }

    // ⑤ 저장 — 기존 저장소 재사용
    const row = await this.persist(obs, v, x, measuredAt, receivedAt, timeFlags);

    // ⑥ 이벤트 — 한 곳에서만
    this.emitRecorded(obs, v, x, row);

    return {
      status: 'STORED', stored: row as T, duplicate: false, duplicateOfId: null,
      pendingReason: null, timeFlags, dedupeChecked, measuredAt, unstored,
    };
  }

  // ── ① 시각 ──────────────────────────────────────────────────────────────────

  /** 🔴 파싱 실패는 `null`(= 모른다). 잡값을 `now()` 로 접지 않는다 */
  private parseMeasuredAt(v: Date | string | null | undefined): Date | null {
    if (v == null) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  private checkTime(measuredAt: Date | null, receivedAt: Date): VitalsTimeFlag[] {
    const flags: VitalsTimeFlag[] = [];
    if (measuredAt == null) {
      flags.push('MEASURED_AT_UNKNOWN');
      // 세 저장소 모두 측정시각 컬럼이 NOT NULL 이라 비워둘 수 없다 → 수신 시각이 박힌다.
      // 그 사실을 감추지 않는다(기획 §1.2 #3 · §8 "측정 시각 미상 (수신 hh:mm)").
      flags.push('MEASURED_AT_DEFAULTED_TO_RECEIPT');
      return flags;
    }
    const gap = measuredAt.getTime() - receivedAt.getTime();
    if (gap > FUTURE_TOLERANCE_MS) flags.push('FUTURE_MEASURED_AT');
    if (-gap > EXCESSIVE_BACKDATE_MS) flags.push('EXCESSIVE_BACKDATE');
    return flags;
  }

  // ── ② 결속 ──────────────────────────────────────────────────────────────────

  private checkBinding(obs: VitalsObservation): VitalsPendingReason | null {
    const bound =
      obs.route === 'OUTPATIENT'
        ? !!obs.patientId?.trim()
        : !!obs.admissionId?.trim(); // 재원 자체가 환자 결속이다
    if (!bound) return 'NO_PATIENT_BINDING';
    // 🔴 사람 ID 를 빌려 쓰지 않는다 — 없으면 저장하지 않는다
    if (!obs.recordedBy?.trim()) return 'NO_RECORDER';
    return null;
  }

  // ── ③ 정규화 ────────────────────────────────────────────────────────────────

  /**
   * 🔴 두 규칙이 여기 함께 있다:
   *  · 결측은 `null` — `undefined`·`NaN` 을 0 으로 접지 않는다. 반대로 **실측 `0` 을 결측으로 버리지도 않는다**
   *    (`v ? Number(v) : undefined` 가 정확히 그 결함이었다 — RASS 0·통증 0·SpO₂ 0 이 사라졌다).
   *  · 기기 보고값은 **재반올림하지 않는다**(외부 보고값 변조 금지 — 수치 정책 규약). 수기 입력만 `roundBy` 를 탄다.
   */
  private num(v: number | null | undefined, key: string, kind: VitalsSourceKind): number | null {
    if (v == null || !Number.isFinite(Number(v))) return null;
    if (kind === 'DEVICE') return Number(v); // 보고값 그대로
    return roundBy(Number(v), key);
  }

  private normalize(values: VitalsValues, kind: VitalsSourceKind) {
    return {
      systolicBp: this.num(values.systolicBp, 'systolicBp', kind),
      diastolicBp: this.num(values.diastolicBp, 'diastolicBp', kind),
      heartRate: this.num(values.heartRate, 'heartRate', kind),
      temperature: this.num(values.temperature, 'temperature', kind),
      spo2: this.num(values.spo2, 'spo2', kind),
      respiratoryRate: this.num(values.respiratoryRate, 'respiratoryRate', kind),
      weight: this.num(values.weight, 'weight', kind),
      height: this.num(values.height, 'height', kind),
      // painScore 는 수치 정책 도메인이 없다(정수 NRS) — roundBy 가 원값을 돌려준다
      painScore: this.num(values.painScore, 'painScore', kind),
      supplementalO2: typeof values.supplementalO2 === 'boolean' ? values.supplementalO2 : null,
      consciousness: values.consciousness ?? null, // 원문 보존(어휘 접기는 채점의 일)
    };
  }

  /** 동반 컬럼 — 정책 도메인이 있는 것만 반올림, 나머지는 결측만 접는다 */
  private normalizeExtras(x: VitalsExtras, kind: VitalsSourceKind) {
    const plain = (v: number | null | undefined) =>
      v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    return {
      notes: x.notes ?? null,
      bmi: this.num(x.bmi, 'bmi', kind),
      isAbnormal: x.isAbnormal ?? false,
      painLocation: x.painLocation ?? null,
      shiftType: x.shiftType,
      gcsScore: plain(x.gcsScore),
      gcScore: plain(x.gcScore),
      pupilReaction: x.pupilReaction ?? null,
      ventMode: x.ventMode ?? null,
      fio2: plain(x.fio2),
      peep: plain(x.peep),
      tidalVolume: plain(x.tidalVolume),
      pip: plain(x.pip),
      apacheScore: plain(x.apacheScore),
      sofaScore: plain(x.sofaScore),
      sedationScore: plain(x.sedationScore),
      intakeOral: plain(x.intakeOral),
      intakeIv: plain(x.intakeIv),
      intakeOther: plain(x.intakeOther),
      outputUrine: plain(x.outputUrine),
      outputDrain: plain(x.outputDrain),
      outputOther: plain(x.outputOther),
    };
  }

  // ── ④ 멱등 ──────────────────────────────────────────────────────────────────

  /**
   * 멱등 키 — 🔴 **스키마에 멱등 키 컬럼이 없다**(`deviceId`·`rawRef` 부재. 기획 §3.2 의
   * `(deviceId, deviceMeasuredAt, metricCode)` 해시는 §5 승인 후에나 가능하다).
   * 그래서 **기존 컬럼 조합**으로만 판별한다:
   *
   *   (환자/재원) + (측정 시각 정확 일치) + (활력 6값 정확 일치)
   *
   * 근거: 사람도 기기도 **같은 시각에 같은 6값을 두 번 측정할 수 없다.**
   *       같은 시각·같은 값이 두 번 들어온 것은 재측정이 아니라 재수신이다.
   * 🔴 측정 시각을 모르면 이 판정을 **하지 않는다**(`dedupeChecked=false`).
   *    삽입 시각으로 중복을 재면 5분 뒤 정상 재측정이 중복으로 지워진다 — 그건 임상 기록의 소실이다.
   */
  private async findDuplicate(
    obs: VitalsObservation,
    v: ReturnType<VitalsIngestService['normalize']>,
    measuredAt: Date,
  ): Promise<{ id: string } | null> {
    const vitals = {
      systolicBp: v.systolicBp,
      diastolicBp: v.diastolicBp,
      heartRate: v.heartRate,
      temperature: v.temperature,
      spo2: v.spo2,
      respiratoryRate: v.respiratoryRate,
    };
    if (obs.route === 'OUTPATIENT') {
      return this.prisma.preVisitVitals.findFirst({
        where: { patientId: obs.patientId as string, measuredAt, ...vitals },
        select: { id: true },
      });
    }
    if (obs.route === 'INPATIENT') {
      return this.prisma.flowSheetEntry.findFirst({
        where: { admissionId: obs.admissionId as string, recordedAt: measuredAt, ...vitals },
        select: { id: true },
      });
    }
    return this.prisma.icuRecord.findFirst({
      where: { admissionId: obs.admissionId as string, recordTime: measuredAt, ...vitals },
      select: { id: true },
    });
  }

  // ── ⑤ 저장 ──────────────────────────────────────────────────────────────────

  private async persist(
    obs: VitalsObservation,
    v: ReturnType<VitalsIngestService['normalize']>,
    x: ReturnType<VitalsIngestService['normalizeExtras']>,
    measuredAt: Date | null,
    receivedAt: Date,
    timeFlags: VitalsTimeFlag[],
  ) {
    if (timeFlags.includes('MEASURED_AT_DEFAULTED_TO_RECEIPT')) {
      // 원장에는 수신 시각이 박힌다 — 그것을 아무도 모르게 두지 않는다(기획 §1.2 #3).
      // 🔴 다만 수기 입력은 **화면에 측정 시각 칸 자체가 없어** 전건이 미상이다. 그것을 WARN 으로 올리면
      //    모든 활력 기록이 경고가 되어 진짜 경고가 묻힌다(거짓 경보는 진짜 경보를 죽인다).
      //    어댑터(기기·이관)가 시각을 안 주는 것은 다른 사건이다 — 그쪽만 WARN.
      const kind = (obs.source ?? { kind: 'MANUAL' as const }).kind;
      const msg =
        `측정 시각 미상 route=${obs.route} source=${kind}` +
        ` — 수신 시각이 측정 시각 자리에 저장된다(컬럼 NOT NULL·수신시각 컬럼 부재)`;
      if (kind === 'MANUAL' || kind === 'PATIENT_REPORTED') this.logger.debug(msg);
      else this.logger.warn(msg);
    }

    if (obs.route === 'OUTPATIENT') {
      return this.prisma.preVisitVitals.create({
        data: {
          patientId: obs.patientId as string,
          encounterId: obs.encounterId ?? undefined,
          queueId: obs.queueId ?? undefined,
          nurseId: obs.recordedBy as string,
          // 🔴 모르면 넘기지 않는다 — DB 기본값(now)이 들어가고 그 사실은 timeFlags 가 말한다
          ...(measuredAt ? { measuredAt } : {}),
          systolicBp: v.systolicBp,
          diastolicBp: v.diastolicBp,
          heartRate: v.heartRate,
          temperature: v.temperature,
          spo2: v.spo2,
          respiratoryRate: v.respiratoryRate,
          weight: v.weight,
          height: v.height,
          bmi: x.bmi,
          painScore: v.painScore,
          notes: x.notes,
          isAbnormal: x.isAbnormal,
        },
      });
    }

    if (obs.route === 'INPATIENT') {
      return this.prisma.flowSheetEntry.create({
        data: {
          admissionId: obs.admissionId as string,
          nurseId: obs.recordedBy as string,
          recordedAt: measuredAt ?? receivedAt, // NOT NULL·기본값 없음
          systolicBp: v.systolicBp,
          diastolicBp: v.diastolicBp,
          heartRate: v.heartRate,
          temperature: v.temperature,
          spo2: v.spo2,
          respiratoryRate: v.respiratoryRate,
          consciousness: v.consciousness,
          painScore: v.painScore,
          painLocation: x.painLocation,
          gcsScore: x.gcsScore,
          intakeOral: x.intakeOral,
          intakeIv: x.intakeIv,
          intakeOther: x.intakeOther,
          outputUrine: x.outputUrine,
          outputDrain: x.outputDrain,
          outputOther: x.outputOther,
          shiftType: (x.shiftType ?? 'DAY') as 'DAY' | 'EVENING' | 'NIGHT',
          notes: x.notes,
        },
      });
    }

    return this.prisma.icuRecord.create({
      data: {
        admissionId: obs.admissionId as string,
        recordTime: measuredAt ?? receivedAt, // NOT NULL·기본값 없음
        heartRate: v.heartRate,
        systolicBp: v.systolicBp,
        diastolicBp: v.diastolicBp,
        spo2: v.spo2,
        respiratoryRate: v.respiratoryRate,
        temperature: v.temperature,
        gcScore: x.gcScore,
        consciousness: v.consciousness,
        pupilReaction: x.pupilReaction,
        intakeOral: x.intakeOral,
        intakeIv: x.intakeIv,
        intakeOther: x.intakeOther,
        outputUrine: x.outputUrine,
        outputDrain: x.outputDrain,
        outputOther: x.outputOther,
        ventMode: x.ventMode,
        fio2: x.fio2,
        peep: x.peep,
        tidalVolume: x.tidalVolume,
        pip: x.pip,
        apacheScore: x.apacheScore,
        sofaScore: x.sofaScore,
        painScore: v.painScore,
        sedationScore: x.sedationScore,
        notes: x.notes,
        recordedBy: obs.recordedBy as string,
      },
    });
  }

  // ── ⑥ 이벤트 ────────────────────────────────────────────────────────────────

  /**
   * `vitals.recorded` — 소비처: `ChronicSyncService`(만성추이 미러)·`PatientBriefService`(캐시 무효화).
   * payload 계약을 바꾸지 않는다.
   *
   * 🔴 한 가지만 달라졌다: 종전엔 이벤트가 **반올림 전 원값**을 싣고 저장은 반올림된 값을 써서
   *    같은 측정에 정본이 둘이었다(체중 70.25 → 저장 70.3 / 만성추이 70.25).
   *    이제 **저장된 값**을 싣는다.
   */
  private emitRecorded(
    obs: VitalsObservation,
    v: ReturnType<VitalsIngestService['normalize']>,
    x: ReturnType<VitalsIngestService['normalizeExtras']>,
    row: { id: string; measuredAt?: Date } | Record<string, unknown>,
  ) {
    if (!this.events) return;
    if (!EMIT_RECORDED_ROUTES.has(obs.route)) {
      // 입원·중환자 — 만성 추이 미러(`vitals.recorded`)에는 넣지 않되(위 주석), 요약 캐시 같은 소비처가 알 수 있게
      // 재원 단위 사건을 따로 낸다(2026-10-10 · 종전엔 입원 활력을 기록해도 아무 사건이 없어 진료 전 요약이 낡은 활력을 들고 있었다)
      if (obs.admissionId) this.events.emit('vitals.admission.recorded', { admissionId: obs.admissionId, route: obs.route });
      return;
    }
    const r = row as { id: string; measuredAt?: Date };
    this.events.emit('vitals.recorded', {
      patientId: obs.patientId,
      vitalsId: r.id,
      encounterId: obs.encounterId ?? null,
      systolicBp: v.systolicBp,
      diastolicBp: v.diastolicBp,
      weight: v.weight,
      bmi: x.bmi,
      measuredAt: r.measuredAt,
    });
  }
}
