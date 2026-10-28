/**
 * 시계열 커서 — 순수 로직.
 *
 * 🔴 시각만으로 커서를 잡으면 **같은 시각 항목이 여럿일 때 유실·중복**이 난다(프로드 실측: 90건 중 84건만
 * 수집되고 1건 중복). 경과기록 9건이 같은 초에 작성되는 일은 흔하고, 투약실행은 정렬 기준(`administeredAt`)과
 * DB 필터 필드(`scheduledAt`)가 달라 경계에서 어긋난다.
 *
 * 그래서 커서는 `<ISO>|<id>` 복합키로 잡고, **DB 는 동일 시각을 포함(lte)해 가져온 뒤 병합 결과에서
 * 커서 위치 이후만 남긴다**. 정렬은 (시각 내림차순, id 오름차순)으로 결정적이어야 한다.
 */

export interface CursorPos {
  at: Date;
  id: string;
}

export interface TimelineItemLike {
  at: Date | string;
  id: string;
}

/** `<ISO>|<id>` 파싱 — id 없는 구형 커서(시각만)도 받는다(호환) */
export function parseCursor(raw?: string): CursorPos | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  // ISO 에는 '|' 가 없으므로 **첫 구분자**로 나눈다 → id 안에 '|' 가 있어도 온전히 복원
  const sep = raw.indexOf('|');
  const iso = sep === -1 ? raw : raw.slice(0, sep);
  const id = sep === -1 ? '' : raw.slice(sep + 1);
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return { at, id };
}

export function formatCursor(item: TimelineItemLike): string {
  return `${new Date(item.at).toISOString()}|${item.id}`;
}

/** 결정적 정렬 — 시각 내림차순, 같은 시각은 id 오름차순 */
export function compareItems(a: TimelineItemLike, b: TimelineItemLike): number {
  const d = new Date(b.at).getTime() - new Date(a.at).getTime();
  return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
}

/**
 * 커서 위치 이후(더 과거)만 남긴다. 같은 시각은 id 순서로 판정하므로
 * 커서 항목 자체와 그보다 앞선 동일 시각 항목은 제외되고, **뒤따르던 동일 시각 항목은 살아남는다**.
 */
export function applyCursor<T extends TimelineItemLike>(items: T[], cursor?: CursorPos): T[] {
  if (!cursor) return items;
  const cAt = cursor.at.getTime();
  return items.filter((i) => {
    const t = new Date(i.at).getTime();
    if (t < cAt) return true;
    if (t > cAt) return false;
    return cursor.id ? String(i.id).localeCompare(cursor.id) > 0 : false;
  });
}
