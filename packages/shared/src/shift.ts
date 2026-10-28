/**
 * 간호 교대(shift) 판정 정본 — 기획 v2 P1-3 (nurse-workstation-notes-handoff.plan.md).
 *
 * 🔴 07/15/23 경계가 화면 3곳(타블렛 기록·워크스테이션·간호 대시보드)에 하드코딩돼 있었다.
 *    병원 교대 시각이 바뀌면 세 곳이 따로 벌어진다 — 판정은 여기 한 곳, 경계는
 *    config `nursing.shift.boundaries` 로 병원별 조정.
 */

export type NursingShift = 'DAY' | 'EVENING' | 'NIGHT';

/** 교대 값 목록(검증·화면 선택지용) — 타입과 한 벌. 앱마다 따로 적으면 갈라진다 */
export const NURSING_SHIFTS = ['DAY', 'EVENING', 'NIGHT'] as const satisfies readonly NursingShift[];

export interface ShiftBoundaries {
  /** DAY 시작 시(0-23) */ day: number;
  /** EVENING 시작 시 */ evening: number;
  /** NIGHT 시작 시 */ night: number;
}

export const DEFAULT_SHIFT_BOUNDARIES: ShiftBoundaries = { day: 7, evening: 15, night: 23 };

/** config 원시값 → 경계 정규화 — 형식이 어긋나면 기본값(잘못된 설정으로 판정이 죽지 않게) */
export function normalizeShiftBoundaries(raw: unknown): ShiftBoundaries {
  if (!raw || typeof raw !== 'object') return DEFAULT_SHIFT_BOUNDARIES;
  const r = raw as Record<string, unknown>;
  const day = Number(r.day), evening = Number(r.evening), night = Number(r.night);
  const valid = [day, evening, night].every((h) => Number.isInteger(h) && h >= 0 && h <= 23)
    && day < evening && evening < night; // 경계 순서가 깨지면 판정이 뒤집힌다
  return valid ? { day, evening, night } : DEFAULT_SHIFT_BOUNDARIES;
}

/** 시각 → 교대 판정. NIGHT 는 자정을 넘겨 이어진다(night~24시 + 0시~day) */
export function shiftOf(date: Date | string | number, b: ShiftBoundaries = DEFAULT_SHIFT_BOUNDARIES): NursingShift {
  const d = date instanceof Date ? date : new Date(date);
  const h = Number.isNaN(d.getTime()) ? new Date().getHours() : d.getHours();
  if (h >= b.day && h < b.evening) return 'DAY';
  if (h >= b.evening && h < b.night) return 'EVENING';
  return 'NIGHT';
}

/** 병원 표준시 오프셋(분) — 한국 KST. `getHours()` 는 실행 환경 시간대에 기댄다(운영 서버는 현재 KST 지만 CI·컨테이너는 UTC 일 수 있다) */
export const HOSPITAL_TZ_OFFSET_MIN = 540;

/**
 * 시각 → 그 시각이 속한 교대와 그 교대의 [시작, 끝) — 서버용(2026-09-30 · 근무조 마감·늦은 기록 판정).
 * `shiftOf` 는 실행 환경의 로컬 시각을 쓴다. 서버는 이 함수로 병원 표준시 기준 판정한다(환경 시간대에 기대지 않게).
 * NIGHT 는 자정을 넘긴다 — 0시~day 시각이면 전날 night 시각에 시작한 교대다.
 */
export function shiftWindowAt(
  date: Date | string | number,
  b: ShiftBoundaries = DEFAULT_SHIFT_BOUNDARIES,
  tzOffsetMin: number = HOSPITAL_TZ_OFFSET_MIN,
): { shift: NursingShift; start: Date; end: Date } {
  const t = (date instanceof Date ? date : new Date(date)).getTime();
  const off = tzOffsetMin * 60_000;
  const local = new Date(t + off); // UTC 필드가 병원 표준시 벽시계
  const h = local.getUTCHours();
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off; // 병원 자정(UTC 시각)
  const at = (dayShift: number, hour: number) => new Date(midnight + dayShift * 86_400_000 + hour * 3_600_000);
  if (h >= b.day && h < b.evening) return { shift: 'DAY', start: at(0, b.day), end: at(0, b.evening) };
  if (h >= b.evening && h < b.night) return { shift: 'EVENING', start: at(0, b.evening), end: at(0, b.night) };
  if (h >= b.night) return { shift: 'NIGHT', start: at(0, b.night), end: at(1, b.day) };
  return { shift: 'NIGHT', start: at(-1, b.night), end: at(0, b.day) };
}

/**
 * 늦은 기록 유예(분) 정규화 — config `nursing.lateEntry.graceMinutes`(원내 기록 규정).
 * 0~720 정수만 받는다. 그 밖(미설정·비수치·음수·과대)은 `null` = **미설정** — 호출부는 유예 0 으로 판정하되
 * "원내 규정 미설정"이라고 밝힌다(0 을 정책인 척하지 않는다).
 */
export const LATE_ENTRY_GRACE_MAX_MIN = 720;
export function normalizeLateEntryGraceMinutes(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= LATE_ENTRY_GRACE_MAX_MIN ? n : null;
}

/**
 * 늦은 기록 — 기록(관찰) 시각이 속한 근무조가 **끝난 뒤(+유예)에** 작성된 기록(2026-09-30 · 유예 2026-10-01).
 * 막지 않는다(늦게라도 적는 것이 안 적는 것보다 낫다). 표식으로만 드러낸다. 파생값이라 저장하지 않는다.
 * `graceMinutes` 는 원내 규정(`normalizeLateEntryGraceMinutes`) — 미설정이면 0(근무조 종료 시각 기준).
 */
export function isLateNursingEntry(
  recordedAt: Date | string,
  createdAt: Date | string,
  b: ShiftBoundaries = DEFAULT_SHIFT_BOUNDARIES,
  graceMinutes: number | null = 0,
): boolean {
  const c = new Date(createdAt).getTime();
  if (Number.isNaN(c) || Number.isNaN(new Date(recordedAt).getTime())) return false;
  const grace = (graceMinutes ?? 0) * 60_000;
  return c >= shiftWindowAt(recordedAt, b).end.getTime() + grace;
}

/**
 * 근무표 부서 ↔ 병동 연결(2026-10-04 · 간호 스테이션 보드) — config `nursing.roster.wardDepartments`.
 * 🔴 근무표(DutyEntry.department, 예: '간호부 (내과병동)')와 병동(Ward, 예: '3층 내과병동')을 잇는 정본이 없었다 —
 *    이름이 비슷하다고 짝지으면 다른 병동 간호사를 우리 병동 상번으로 말한다. 그래서 **사람이 연결한 것만** 쓴다.
 * 모양: `{ "<병동 id>": ["근무표 부서", ...] }`. 모양이 어긋난 칸은 버리고, 남는 게 없으면 `null`(미설정).
 */
export const ROSTER_WARD_DEPARTMENTS_KEY = 'nursing.roster.wardDepartments';
export function normalizeRosterWardDepartments(raw: unknown): Record<string, string[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string[]> = {};
  for (const [ward, deps] of Object.entries(raw as Record<string, unknown>)) {
    if (!ward.trim() || !Array.isArray(deps)) continue;
    const clean = [...new Set(deps.filter((d): d is string => typeof d === 'string' && !!d.trim()).map((d) => d.trim()))];
    if (clean.length) out[ward] = clean;
  }
  return Object.keys(out).length ? out : null;
}
