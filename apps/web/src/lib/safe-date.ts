import { format as fnsFormat } from 'date-fns';

/**
 * 안전한 날짜 포맷 — Invalid time value 방지
 * Prisma가 DateTime을 {} (빈 객체)로 반환하는 경우 대응
 */
export function safeFormat(
  dateVal: string | Date | Record<string, unknown> | null | undefined,
  fmt: string,
  fallback = '-',
): string {
  if (!dateVal) return fallback;
  try {
    const d = dateVal instanceof Date ? dateVal : new Date(String(dateVal));
    if (isNaN(d.getTime())) return fallback;
    return fnsFormat(d, fmt);
  } catch {
    return fallback;
  }
}

export function safeDate(dateVal: unknown): Date | null {
  if (!dateVal) return null;
  try {
    const d = dateVal instanceof Date ? dateVal : new Date(String(dateVal));
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
