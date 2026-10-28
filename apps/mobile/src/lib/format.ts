/** 날짜 포맷 유틸 — 전 화면 일관성 */

export function formatDate(dateStr: string | Date): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateShort(dateStr: string | Date): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export function formatDateTime(dateStr: string | Date): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function formatTime(dateStr: string | Date): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * 측정/기록 시각 표시 — 오늘이면 시:분, 아니면 날짜까지 붙인다.
 *
 * 🔴 2026-08-14(W9). 종전 입원 카드는 바이탈 측정 시각을 `toLocaleTimeString`(시:분)만 찍었다.
 *    운영 실측에서 서버가 주는 값은 66일 전 측정치였는데(입원 전 preVisitVitals) 화면에는
 *    "12:18" 만 떠서 오늘 잰 값처럼 보였다. 언제 잰 값인지가 값 자체만큼 중요하다.
 */
export function formatMeasuredAt(dateStr?: string | Date | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return `${d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ${time}`;
}

/** 기준 시각이 오늘이 아닌가 — "오래된 값" 표시를 붙일지 판단용. */
export function isStale(dateStr?: string | Date | null, hours = 24): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > hours * 3600_000;
}

export function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return formatDate(dateStr);
}

export function formatAmount(amount: number): string {
  const n = Number(amount) || 0;
  return n.toLocaleString('ko-KR') + '원';
}
