import { JOURNEY_OBSERVED_SINCE } from '@hospital-run/shared';

/**
 * 환자 여정 기간 보고서 — 순수 조립(기획 patient-journey-tracking §3.4 `GET patients/:id/journey/report`).
 *
 * 🔴 여정 이벤트는 **발행 지점이 배선된 행위만** 남는다(`JOURNEY_EVENT_NOT_EMITTED` 참조) — 이벤트가 없다는 것은
 *    "그 일이 없었다"가 아니라 "기록되지 않았다"일 수 있다. 그래서 간격 지표는 **양 끝 이벤트가 모두 있을 때만** 내고,
 *    하나라도 없으면 `null`(산출 불가)이다. 0 으로 채우지 않는다.
 * 🔴 (P1 2026-10-01) 간격은 **발생 시각(occurredAt)** 으로만 잰다 — 모르는 행은 빼고 `excludedUnknownTime` 으로 센다.
 * 🔴 기획서 예시의 진단명·병동·담당의 기간·문서 목록은 여정 이벤트에서 파생할 수 없어 싣지 않는다(지어내지 않는다).
 */
export interface ReportEventRow {
  eventType: string;
  eventAt: Date;
  /** 원 기록 포인터 — 양 끝이 둘 다 가지고 있으면 **같은 방문**끼리만 짝짓는다(여정 P0-3) */
  refType?: string | null;
  refId?: string | null;
  /** (P1) 발생 시각 — 모르면 null. 간격은 이 값으로만 잰다(기록 시각으로 대신하지 않는다) */
  occurredAt?: Date | null;
}

export interface JourneyReport {
  period: { from: string | null; to: string | null; source: 'ADMISSION' | 'RANGE' };
  events: {
    total: number;
    /** 조회 상한에 걸려 잘렸다 — 아래 집계는 받은 행까지만이다 */
    truncated: boolean;
    byType: Array<{ eventType: string; count: number }>;
    firstAt: string | null;
    lastAt: string | null;
  };
  /** 분 단위 간격 — 양 끝 이벤트가 둘 다 있을 때만(없으면 null·산출 불가) */
  intervals: {
    erStayMinutes: number | null;
    admitToSurgeryMinutes: number | null;
    surgeryMinutes: number | null;
    /**
     * (P1) 간격 계산에 쓰는 사건(도착·퇴실·입원·수술 시작/종료) 중 **발생 시각을 몰라 뺀 행 수**.
     * 여정 P1 이전 행은 전부 발생 시각 미상이다 — 그 기간의 간격이 null 인 이유가 이것이다.
     */
    excludedUnknownTime: number;
  };
  /**
   * (P2 · 불변식 I7) 간격 계산에 쓰는 사건 중 **이 기간 시작 이후에야 기록되기 시작한 것**(since)과
   * 기록 시작을 확인하지 못한 것(since=null). 그 전 기간의 부재는 "없었다"가 아니라 "기록 범위 밖"이다.
   */
  observationScope: Array<{ eventType: string; since: string | null }>;
  /** 이벤트 건수(기록된 발행만 — 오더·결과 원장의 전수가 아니다) */
  counts: { prescriptionAdded: number; labResult: number; imagingResult: number };
  admission: {
    id: string;
    admitDate: string;
    dischargeDate: string | null;
    /** 재원일수(정본 stayDays) — 퇴원 전이면 오늘까지이며 inProgress=true */
    lengthOfStayDays: number | null;
    inProgress: boolean;
  } | null;
}

const minutesBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 60_000);

/**
 * 첫 `start` 이후에 온 첫 `ends` 중 하나까지의 분 — 없으면 null.
 * 🔴 (2026-10-01 P0-3) 양 끝이 모두 원 기록(refType·refId)을 가지면 **같은 원 기록끼리만** 잇는다 —
 *    종전엔 기간 안에 응급 방문이 둘이면 첫 도착과 **아무 방문의** 첫 끝을 이었다(발산). 과거 행처럼 한쪽이라도
 *    포인터가 없으면 종전 규칙(시간 순서)으로 잇는다 — 추정으로 귀속하지 않되 기존 산출은 유지한다.
 */
function firstInterval(rows: TimedRow[], start: string, ends: string[]): number | null {
  const s = rows.find((r) => r.eventType === start);
  if (!s) return null;
  // 🔴 (P1) 같은 **종류**의 원 기록일 때만 같은 건끼리 묶는다 — 입원(ADMISSION)→수술(SURGERY)처럼 종류가 다르면
  //    포인터 비교가 늘 '다름'이 되어 간격이 영원히 null 이었다(P0 규칙의 부작용).
  const sameCase = (r: TimedRow) =>
    !(s.refType && s.refId && r.refType && r.refId) || s.refType !== r.refType || s.refId === r.refId;
  const e = rows.find((r) => ends.includes(r.eventType) && r.at.getTime() >= s.at.getTime() && sameCase(r));
  return e ? minutesBetween(s.at, e.at) : null;
}

type TimedRow = ReportEventRow & { at: Date };
const INTERVAL_TYPES = ['ER_ARRIVAL', 'ER_CHECKOUT', 'ADMISSION', 'SURGERY_START', 'SURGERY_COMPLETE'];

export function buildJourneyReport(
  rows: ReportEventRow[],
  opts: {
    limit: number;
    period: JourneyReport['period'];
    admission?: { id: string; admitDate: Date; dischargeDate: Date | null; lengthOfStayDays: number | null } | null;
  },
): JourneyReport {
  const truncated = rows.length > opts.limit;
  const used = [...rows.slice(0, opts.limit)].sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime());
  const byTypeMap = new Map<string, number>();
  for (const r of used) byTypeMap.set(r.eventType, (byTypeMap.get(r.eventType) ?? 0) + 1);
  const count = (t: string) => byTypeMap.get(t) ?? 0;
  // 간격은 발생 시각이 있는 행만 — 없는 행은 빼고 그 수를 밝힌다(기록 시각으로 대신하면 롤포워드·늦은 입력이 간격이 된다)
  const intervalRows = used.filter((r) => INTERVAL_TYPES.includes(r.eventType));
  const timed: TimedRow[] = intervalRows
    .filter((r) => r.occurredAt instanceof Date && !Number.isNaN(r.occurredAt.getTime()))
    .map((r) => ({ ...r, at: r.occurredAt as Date }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    period: opts.period,
    events: {
      total: used.length,
      truncated,
      byType: [...byTypeMap.entries()]
        .map(([eventType, c]) => ({ eventType, count: c }))
        .sort((a, b) => b.count - a.count || a.eventType.localeCompare(b.eventType)),
      firstAt: used[0]?.eventAt.toISOString() ?? null,
      lastAt: used[used.length - 1]?.eventAt.toISOString() ?? null,
    },
    intervals: {
      // 🔴 (P0-3) 끝점에서 처분(ER_DISPOSITION)을 뺐다 — 결정≠퇴실(ER 베드 보드 규약). 퇴실 사건이 없으면 null
      erStayMinutes: firstInterval(timed, 'ER_ARRIVAL', ['ER_CHECKOUT']),
      admitToSurgeryMinutes: firstInterval(timed, 'ADMISSION', ['SURGERY_START']),
      surgeryMinutes: firstInterval(timed, 'SURGERY_START', ['SURGERY_COMPLETE']),
      excludedUnknownTime: intervalRows.length - timed.length,
    },
    observationScope: INTERVAL_TYPES.flatMap((t): Array<{ eventType: string; since: string | null }> => {
      const reg = JOURNEY_OBSERVED_SINCE[t as keyof typeof JOURNEY_OBSERVED_SINCE];
      if (reg === undefined) return [];
      if (reg === null) return [{ eventType: t, since: null }];
      const from = opts.period.from ? Date.parse(opts.period.from) : NaN;
      return Number.isFinite(from) && Date.parse(reg.since) > from ? [{ eventType: t, since: reg.since }] : [];
    }),
    counts: { prescriptionAdded: count('PRESCRIPTION_ADDED'), labResult: count('LAB_RESULT'), imagingResult: count('IMAGING_RESULT') },
    admission: opts.admission
      ? {
          id: opts.admission.id,
          admitDate: opts.admission.admitDate.toISOString(),
          dischargeDate: opts.admission.dischargeDate?.toISOString() ?? null,
          lengthOfStayDays: opts.admission.lengthOfStayDays,
          inProgress: opts.admission.dischargeDate == null,
        }
      : null,
  };
}
