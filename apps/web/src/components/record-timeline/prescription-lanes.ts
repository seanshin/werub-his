/**
 * 처방 시계열(레인) — 순수 로직.
 *
 * 카드 나열로는 "이 약을 언제부터 언제까지 먹었나 / 언제 바뀌었나"를 읽을 수 없다.
 * 같은 약을 하나의 레인으로 묶고 각 처방을 **기간 막대**로 배치해 중복·공백·변경을 눈으로 보게 한다.
 * 기간(duration)이 없는 처방은 시점 표시(막대 최소폭)로 둔다 — 없는 정보를 만들지 않는다.
 */

export interface RxInput {
  id: string;
  at: string;                 // 처방 시각(createdAt)
  title?: string | null;      // 약품명(또는 처방 유형)
  code?: string | null;
  rxType?: string | null;     // MEDICATION | LAB | IMAGING | THERAPY | DIET | ACTIVITY | NURSING
  dosage?: string | null;
  frequency?: string | null;
  duration?: number | null;   // 일수
  status?: string | null;     // ACTIVE | CANCELLED | DISCONTINUED(2026-09-30)
}

export interface RxBar {
  id: string;
  startMs: number;
  endMs: number;
  days: number;               // 표시 기간(일) — duration 없으면 0
  hasDuration: boolean;
  label: string;              // 용량·용법 요약
  status: string;
  /** 0~1 정규화 좌표(막대 렌더용) */
  left: number;
  width: number;
}

export interface RxLane {
  key: string;                // 그룹 키(코드 우선, 없으면 이름)
  name: string;
  rxType: string;
  bars: RxBar[];
  /** 오늘 시점에 복용/시행 중으로 보이는가(ACTIVE + 기간 내) */
  ongoing: boolean;
}

export interface LaneRange { startMs: number; endMs: number }

const DAY = 86400000;
const MIN_W = 0.012; // 기간 없는 처방의 최소 막대 폭(전체 축의 1.2%)

/** 축 범위 — 처방 시작 최소~(종료 최대, 최소 오늘). 빈 입력이면 null */
export function laneRange(items: RxInput[], nowMs: number): LaneRange | null {
  if (!items.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const r of items) {
    const s = new Date(r.at).getTime();
    if (!Number.isFinite(s)) continue;
    const e = s + Math.max(0, r.duration ?? 0) * DAY;
    if (s < min) min = s;
    if (e > max) max = e;
  }
  if (!Number.isFinite(min)) return null;
  max = Math.max(max, nowMs);
  // 좌우 여백 — 축 양끝에 막대가 붙지 않게 전체의 3%
  const pad = Math.max((max - min) * 0.03, DAY);
  return { startMs: min - pad, endMs: max + pad };
}

/** 처방 목록 → 약품별 레인. 최근 처방이 있는 레인이 위로. */
export function buildLanes(items: RxInput[], nowMs: number): { lanes: RxLane[]; range: LaneRange | null } {
  const range = laneRange(items, nowMs);
  if (!range) return { lanes: [], range: null };
  const span = Math.max(1, range.endMs - range.startMs);

  const map = new Map<string, RxLane>();
  for (const r of items) {
    const startMs = new Date(r.at).getTime();
    if (!Number.isFinite(startMs)) continue;
    const name = (r.title ?? r.rxType ?? '처방').trim();
    const key = (r.code && r.code.trim()) || name; // 같은 약이 이름 표기만 다를 때를 코드로 흡수
    const hasDuration = !!r.duration && r.duration > 0;
    const endMs = startMs + (hasDuration ? r.duration! * DAY : 0);
    const left = (startMs - range.startMs) / span;
    const width = hasDuration ? Math.max((endMs - startMs) / span, MIN_W) : MIN_W;
    const label = [r.dosage, r.frequency, hasDuration ? `${r.duration}일` : null].filter(Boolean).join(' · ');

    const bar: RxBar = {
      id: r.id, startMs, endMs, days: hasDuration ? r.duration! : 0, hasDuration,
      label, status: r.status ?? '', left, width,
    };
    const lane = map.get(key);
    if (lane) lane.bars.push(bar);
    else map.set(key, { key, name, rxType: r.rxType ?? 'MEDICATION', bars: [bar], ongoing: false });
  }

  const lanes = [...map.values()].map((l) => {
    l.bars.sort((a, b) => a.startMs - b.startMs);
    // 진행 중 = 취소·중단 아님 + (기간 내 or 기간 미상인 최근 7일 처방)
    // 🔴 중단(DISCONTINUED)은 기간이 남았어도 진행 중이 아니다(2026-09-30)
    l.ongoing = l.bars.some((b) =>
      b.status !== 'CANCELLED' && b.status !== 'DISCONTINUED' &&
      (b.hasDuration ? nowMs >= b.startMs && nowMs <= b.endMs : nowMs - b.startMs <= 7 * DAY),
    );
    return l;
  });
  // 최근 처방이 있는 레인 우선, 동률이면 이름
  lanes.sort((a, b) => {
    const la = Math.max(...a.bars.map((x) => x.startMs));
    const lb = Math.max(...b.bars.map((x) => x.startMs));
    return lb - la || a.name.localeCompare(b.name);
  });
  return { lanes, range };
}

/** 축 눈금 — 월 경계(범위가 짧으면 주 경계). 표시용 최대 12개 */
export function laneTicks(range: LaneRange): { ms: number; label: string; pos: number }[] {
  const span = range.endMs - range.startMs;
  const byWeek = span <= 70 * DAY;
  const out: { ms: number; label: string; pos: number }[] = [];
  const d = new Date(range.startMs);
  if (byWeek) {
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); // 다음 일요일부터
    for (let i = 0; i < 24 && d.getTime() <= range.endMs; i++) {
      out.push({ ms: d.getTime(), label: `${d.getMonth() + 1}/${d.getDate()}`, pos: (d.getTime() - range.startMs) / span });
      d.setDate(d.getDate() + 7);
    }
  } else {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < range.startMs) d.setMonth(d.getMonth() + 1);
    for (let i = 0; i < 24 && d.getTime() <= range.endMs; i++) {
      out.push({ ms: d.getTime(), label: `${d.getFullYear() % 100}.${d.getMonth() + 1}`, pos: (d.getTime() - range.startMs) / span });
      d.setMonth(d.getMonth() + 1);
    }
  }
  if (out.length <= 12) return out;
  const step = Math.ceil(out.length / 12);
  return out.filter((_, i) => i % step === 0);
}

/** 오늘 위치(0~1) — 범위 밖이면 null */
export function nowPos(range: LaneRange, nowMs: number): number | null {
  if (nowMs < range.startMs || nowMs > range.endMs) return null;
  return (nowMs - range.startMs) / (range.endMs - range.startMs);
}
