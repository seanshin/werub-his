import { BillingStatus } from '@prisma/client';
import { mergeTargetMap, positiveNumberOr } from '../../common/qi-targets';
import { ONSITE_QUEUE_STATUSES } from '../patient/onsite-filter';

/**
 * 환자 흐름(외래·응급·입원) 집계 **정본** — 화면 실사용 점검 W8(2026-08-14).
 *
 * 🔴 왜 파일 하나로 모았나: 같은 사실(대기·지연·목표)을 관제(/journey-console)·분석(/flow-analytics)·
 *    경영(/executive)·대시보드(/dashboard)가 **각자 정의**해서, 한 병원의 같은 순간에 대해
 *    서로 다른 수를 말했다. 이 저장소에서 하루 4회 재발한 패턴이다 —
 *    **한 곳만 고치면 갈라진다**. 집합·상한·목표는 여기서만 나온다.
 */

// ── 상태 집합 ────────────────────────────────────────────────────────────────

/**
 * 외래에서 '아직 끝나지 않은' 상태 — 관제 보드·활성 카운트의 모집단.
 *
 * 🔴 **정본이 둘이었다**(2026-09-02). 같은 개념('아직 원내')을 `patient/onsite-filter.ts` 의
 *    `ONSITE_QUEUE_STATUSES` 도 정의하는데 그쪽은 `PHARMACY_WAITING` 을 포함하고 여기는 빠뜨렸다.
 *    그래서 **약국에서 조제를 기다리는 환자가 관제의 활성 집계와 보드 목록에서 사라졌다.**
 *    (수납하면 `billing.service` 가 CASHIER_WAITING → PHARMACY_WAITING 으로 바꾼다)
 *    → 원내 상태 집합은 `ONSITE_QUEUE_STATUSES` 하나에서 파생한다. 여기서 다시 적지 않는다.
 */
export const OPD_ACTIVE: string[] = ONSITE_QUEUE_STATUSES;

/**
 * 외래에서 '오늘 끝난' 상태 — 활성 보드가 당일분을 함께 보여줄 때의 모집단.
 * 🔴 `VISIT_COMPLETED`(처방 없이 수납 완료)를 빠뜨리면 그 환자는 활성에도 완료에도 없다.
 */
export const OPD_DONE_TODAY = ['COMPLETED', 'VISIT_COMPLETED'];

/**
 * 외래 '대기' 정본 — 접수 후 진료 시작 전(호출 포함).
 * 진료중(IN_CONSULTATION)·수납대기(CASHIER_WAITING)는 '대기'가 아니다.
 */
export const OPD_WAITING_STAGES = ['WAITING', 'CALLED'];

/** 응급 진행 중 — COMPLETED 는 종결(카운트만) */
export const ER_ACTIVE = ['PENDING_TRIAGE', 'TRIAGED', 'PENDING_DOCTOR', 'IN_TREATMENT', 'PENDING_RESULT', 'UNDER_OBSERVATION', 'PENDING_DISPOSITION'];

/**
 * '도착했지만 아직 트리아지 전' 후보 상태 — door-to-triage 목표 판정 모집단.
 * 보드의 `ER_ARRIVED` 단계와 같은 뜻이며, 실제 판정에는 `triagedAt/treatmentStartedAt/dispositionAt`
 * 이 모두 null 이라는 조건이 함께 걸린다(아래 `erPreTriageWhere`).
 */
export const ER_PRE_TRIAGE_STATUSES = ER_ACTIVE.filter((s) => s !== 'PENDING_DISPOSITION');

/** 미수납 정본 — 금액과 건수가 같은 집합을 본다 */
export const UNPAID_STATUS: BillingStatus[] = [BillingStatus.PENDING, BillingStatus.PARTIAL, BillingStatus.DEFERRED];

// ── 미래 체크인 상한 ─────────────────────────────────────────────────────────

/**
 * 🔴 `checkedInAt ≤ now` 상한 — **전 축 공통**(W8 Q9).
 *
 *    상한이 없으면 **아직 오지 않은 사람**이 '지금 대기 중'에 섞인다. 그들은 경과가 음수라
 *    화면에서 '0분'으로 표시되고, 평균 대기를 끌어내리며, 대기 인원수를 부풀린다.
 *    실측(2026-08-14 14:07 KST): WAITING+CALLED **198명** 중 **2명**이 미래 접수 예정이었다.
 *    `dashboard` 만 이 상한을 걸고 있었고 `executive`·`journey-console` 은 빠져 있었다
 *    — 같은 화면군이 198 과 196 을 동시에 말했다(P12).
 */
export function notFutureCheckIn(now: Date = new Date()): { lte: Date } {
  return { lte: now };
}

/** 접수 시각 구간 + 미래 상한 — `from~to` 조회에도 상한은 항상 붙는다 */
export function checkInWindow(from?: Date, to?: Date, now: Date = new Date()): { gte?: Date; lte: Date } {
  const upper = to && to.getTime() < now.getTime() ? to : now;
  return { ...(from ? { gte: from } : {}), lte: upper };
}

// ── 목표(임계) 정본 ──────────────────────────────────────────────────────────

/** KTAS 도착→트리아지 목표(분) 폴백 — 정본 개정 표면은 config `qi.targets.doorToTriage` */
export const KTAS_DOOR_TO_TRIAGE_FALLBACK: Record<string, number> = {
  LEVEL_1: 1, LEVEL_2: 10, LEVEL_3: 30, LEVEL_4: 60, LEVEL_5: 120,
};

/**
 * 단계별 목표 **코드 폴백**. 운영 정본은 config `qi.targets.*`.
 *
 * 🔴 단계와 키를 1:1 로 못 박는다(W8 Q10). 종전에 `/flow-analytics` 는 '접수→호출 대기'에
 *    `cashierWaitMinutes`(수납 대기 목표 30분)를 걸어놓고, 관제 보드는 같은 지연을
 *    `callDelayMinutes`(10분)로 판정했다 — **같은 호출 지연이 화면마다 지연이었다 아니었다** 했다.
 */
export const FLOW_TARGET_FALLBACK = {
  /** 접수→진료 시작 대기 목표(분) */
  opdWaitMin: 30,
  /** 접수→호출 대기 / 호출 후 미입실 목표(분) — 두 화면이 같은 키를 본다 */
  callDelayMin: 10,
  /** 진료 종료→수납 완료 대기 목표(분) */
  cashierDelayMin: 30,
  /** 진료실 점유 장기화 임계(분) */
  consultDelayMin: 40,
  longStayMul: 1.5,
  highUnpaid: 500_000,
  defaultAlos: 7,
};

export type FlowTargets = typeof FLOW_TARGET_FALLBACK & { doorToTriage: Record<string, number> };

/**
 * 각 목표가 **원내 설정값인지 코드 기본값인지**.
 *
 * 🔴 2026-08-26 실측: 운영 DB 에 `qi.targets.opdWaitMinutes` 가 **없다.** 관제는 코드 기본값 30분으로
 *    194건을 "지연"이라 판정하면서 화면에는 그냥 "기준 대기 30분"이라 적어 **원내 정책처럼** 보였다.
 *    같은 순간 원무 화면은 원내가 실제로 설정한 `clinical.queue.*`(20/60분)로 색을 칠하고 있었다.
 *    **기본값을 정책인 척하지 않는다** — 어느 쪽인지 화면이 말할 수 있어야 한다.
 */
export type TargetSource = 'CONFIG' | 'FALLBACK';
export type FlowTargetSources = Record<keyof typeof FLOW_TARGET_FALLBACK | 'doorToTriage', TargetSource>;

/** config 를 읽을 수 있는 최소 계약 — 모듈 결합을 늘리지 않기 위해 구조 타입으로 받는다 */
export interface FlowTargetConfigReader {
  get(key: string): Promise<unknown>;
}

/**
 * 목표 정본 해석 — config `qi.targets.*` 우선, 미설정·비수치는 코드 폴백.
 * 관제·분석·경영이 **이 함수 하나**를 통해서만 목표를 얻는다.
 */
export async function resolveFlowTargets(config?: FlowTargetConfigReader | null): Promise<FlowTargets> {
  return (await resolveFlowTargetsWithSource(config)).targets;
}

/** 값과 **출처**를 함께 — 화면이 "원내가 정한 값인가"를 말할 수 있게 */
export async function resolveFlowTargetsWithSource(
  config?: FlowTargetConfigReader | null,
): Promise<{ targets: FlowTargets; sources: FlowTargetSources }> {
  const sources: Partial<FlowTargetSources> = {};
  const num = async (key: string, fallback: number, field: keyof FlowTargetSources) => {
    const raw = await config?.get(key).catch(() => null);
    const resolved = positiveNumberOr(raw, fallback);
    // 🔴 "읽었지만 값이 없다"와 "읽어서 이 값이다"를 구분한다. 비수치·0 은 설정으로 치지 않는다
    //    (그대로 두면 잘못 적힌 값이 정책인 척한다).
    sources[field] = raw !== null && raw !== undefined && resolved === positiveNumberOr(raw, -1)
      ? 'CONFIG'
      : 'FALLBACK';
    return resolved;
  };
  const [opdWaitMin, callDelayMin, cashierDelayMin, consultDelayMin, longStayMul, highUnpaid, defaultAlos, doorToTriageRaw] =
    await Promise.all([
      num('qi.targets.opdWaitMinutes', FLOW_TARGET_FALLBACK.opdWaitMin, 'opdWaitMin'),
      num('qi.targets.callDelayMinutes', FLOW_TARGET_FALLBACK.callDelayMin, 'callDelayMin'),
      num('qi.targets.cashierWaitMinutes', FLOW_TARGET_FALLBACK.cashierDelayMin, 'cashierDelayMin'),
      num('qi.targets.consultDelayMinutes', FLOW_TARGET_FALLBACK.consultDelayMin, 'consultDelayMin'),
      num('qi.targets.longStayMultiplier', FLOW_TARGET_FALLBACK.longStayMul, 'longStayMul'),
      num('qi.targets.highUnpaidAmount', FLOW_TARGET_FALLBACK.highUnpaid, 'highUnpaid'),
      num('qi.targets.defaultAlosDays', FLOW_TARGET_FALLBACK.defaultAlos, 'defaultAlos'),
      config?.get('qi.targets.doorToTriage').catch(() => null) ?? null,
    ]);
  sources.doorToTriage = doorToTriageRaw ? 'CONFIG' : 'FALLBACK';
  return {
    targets: {
      opdWaitMin, callDelayMin, cashierDelayMin, consultDelayMin, longStayMul, highUnpaid, defaultAlos,
      doorToTriage: mergeTargetMap(KTAS_DOOR_TO_TRIAGE_FALLBACK, doorToTriageRaw),
    },
    sources: sources as FlowTargetSources,
  };
}

// ── 파생 where 조각 ──────────────────────────────────────────────────────────

/**
 * '도착했지만 트리아지 전'이고 해당 KTAS 목표를 넘긴 건 — 보드 `TRIAGE_DELAY` flag 와 같은 판정.
 * 등급별 목표가 다르므로 **등급 단위**로 만든다(등급 혼합 단일 임계 금지).
 */
export function erPreTriageWhere(level: string, targetMin: number, now: Date = new Date()) {
  return {
    status: { in: ER_PRE_TRIAGE_STATUSES },
    triageLevel: level as never,
    triagedAt: null,
    treatmentStartedAt: null,
    dispositionAt: null,
    arrivalAt: { lt: new Date(now.getTime() - targetMin * 60_000) },
  };
}
