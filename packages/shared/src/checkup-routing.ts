/**
 * 건강검진 다음 검사 추천 — 정본 하나 (기획 `spatial-flow-vision-3d.plan.md` P0-6)
 *
 * 🔴 종전 추천이 두 벌이었다 — 직원 워크스테이션(`getNextStation`: 대기 수×평균 소요 최소)과
 *    환자 앱(포털: 혼잡도 단계 → 예상 시간)이 **같은 환자에게 다른 방을** 권할 수 있었고,
 *    둘 다 검사 순서 규칙(금식 채혈 먼저·내시경은 마지막 — 결과지 경로표 `getRouteSheet` 가 쓰는 규칙)을 무시했다.
 *    워크스테이션 쪽은 대기 수에 날짜 조건이 없어(`arrivedAt: { not: undefined }` — Prisma 가 무시) 어제 미완료까지 셌다.
 *
 * 규칙: ① 순서 우선순위(낮을수록 먼저) ② 같은 우선순위 안에서 예상 대기가 짧은 방 ③ 대기를 모르면 뒤로(0 으로 치지 않는다)
 *       ④ (P4 · 2026-09-28) 대기까지 같으면 **이동 거리**가 짧은 방 — 확정 도면 경로 거리(m)만 · 모르면 뒤로.
 * 🔴 거리를 시간으로 바꿔 대기에 더하지 않는다 — 걸음 속도는 정하지 않았다(지어내지 않는다). 거리는 동점 처리와 표시에만 쓴다.
 */

export interface CheckupOrderingRule {
  priority: number;
  categories: string[];
  names?: string[];
}

/** 검사 순서 우선순위(금식→신체계측→비침습→초음파→검체→침습→AI→상담) — 이름 매칭이 카테고리보다 먼저 */
export const CHECKUP_ORDERING_RULES: readonly CheckupOrderingRule[] = [
  { priority: 1, categories: ['LAB'], names: ['혈액검사'] },
  { priority: 2, categories: ['PHYSICAL'] },
  { priority: 3, categories: [], names: ['심전도', '흉부 X-ray', '안과검사', '동맥경화검사', '호흡기능검사'] },
  { priority: 4, categories: ['IMAGING'] },
  { priority: 5, categories: [], names: ['소변검사', '대변검사'] },
  { priority: 6, categories: ['DIAGNOSTIC'] },
  { priority: 7, categories: ['AI'] },
  { priority: 99, categories: ['CONSULT'] },
];

/** 규칙에 없는 항목의 우선순위 — 상담(99) 앞, 나머지 뒤 */
export const CHECKUP_PRIORITY_UNRULED = 50;

export function checkupItemPriority(item: { category: string; name: string | null | undefined }): number {
  const name = item.name ?? '';
  for (const rule of CHECKUP_ORDERING_RULES) if (rule.names?.some((n) => name.includes(n))) return rule.priority;
  for (const rule of CHECKUP_ORDERING_RULES) if (rule.categories.includes(item.category)) return rule.priority;
  return CHECKUP_PRIORITY_UNRULED;
}

export interface StationCandidate {
  /** 비교 안정용 키(스테이션 코드·검사명) */
  key: string;
  priority: number;
  /** 오늘 도착·미완료 수 — 모르면 null(조회 실패·스테이션 미연결) */
  waitingCount: number | null;
  avgMinutes: number | null;
  /** 현재 위치(마지막 완료 스테이션)에서 이 방까지 확정 도면 경로 거리(m) — 모르면 null/없음 */
  distanceM?: number | null;
}

export function estimatedWaitMinutes(c: Pick<StationCandidate, 'waitingCount' | 'avgMinutes'>): number | null {
  return c.waitingCount != null && c.avgMinutes != null ? c.waitingCount * c.avgMinutes : null;
}

/** 추천 순서 — 입력을 바꾸지 않고 새 배열을 돌려준다 */
export function rankNextStations<T extends StationCandidate>(cands: readonly T[]): T[] {
  return [...cands].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const wa = estimatedWaitMinutes(a), wb = estimatedWaitMinutes(b);
    if (wa == null && wb != null) return 1;
    if (wb == null && wa != null) return -1;
    if (wa != null && wb != null && wa !== wb) return wa - wb;
    const da = a.distanceM ?? null, db = b.distanceM ?? null;
    if (da == null && db != null) return 1;
    if (db == null && da != null) return -1;
    if (da != null && db != null && da !== db) return da - db;
    return a.key.localeCompare(b.key);
  });
}
