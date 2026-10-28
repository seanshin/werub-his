/**
 * 키 정렬 JSON — 해시 입력 정본(2026-10-13 결함 발굴 A2·C4).
 *  · Date = ISO · Decimal = 문자열 · bigint = 문자열 · undefined 키는 빠진다
 *  · 🔴 JSONB 는 키 순서를 바꿔 저장한다 — `JSON.stringify(obj)` 로 봉인한 값은 저장된 본문으로 다시 계산할 수 없다(C4).
 *    봉인·대조는 이 함수로 한다.
 */
function norm(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object' && typeof (v as { toFixed?: unknown }).toFixed === 'function' && typeof (v as { d?: unknown }).d !== 'undefined') return String(v); // Prisma Decimal
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) o[k] = norm(x);
    }
    return o;
  }
  return v;
}
/** 키 정렬 JSON — 해시 입력 정본 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(norm(v));
}
