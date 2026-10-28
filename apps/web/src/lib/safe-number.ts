/**
 * 안전한 숫자 변환/포맷 — React error #31 최후 방어(프론트)
 *
 * 백엔드 직렬화 계층(DateSerializerInterceptor)이 Decimal→number로 변환하지만,
 * 만약 Decimal 객체({s,e,d})·문자열이 그대로 내려와도 화면이 깨지지 않도록 방어한다.
 * 객체를 JSX에 직접 렌더하면 #31이 나므로, 표시 직전 반드시 number/문자열로 변환할 것.
 */

type DecimalLike = { s: number; e: number; d: number[] };

function isDecimalLike(v: unknown): v is DecimalLike {
  return (
    typeof v === 'object' && v !== null &&
    (v as DecimalLike).s !== undefined &&
    typeof (v as DecimalLike).e === 'number' &&
    Array.isArray((v as DecimalLike).d)
  );
}

/** decimal.js 내부표현 {s,e,d} → number 재구성 (백엔드 인터셉터와 동일 공식) */
function decimalLikeToNumber(o: DecimalLike): number {
  let digits = '';
  for (let i = 0; i < o.d.length; i++) digits += i === 0 ? String(o.d[i]) : String(o.d[i]).padStart(7, '0');
  return o.s * Number(digits) * Math.pow(10, o.e - (digits.length - 1));
}

/** 무엇이 와도 number 또는 null로 — 객체(Decimal)·문자열·null 모두 방어 */
export function toSafeNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  if (isDecimalLike(v)) return decimalLikeToNumber(v);
  return null;
}

/** 숫자 포맷(천단위) — 변환 불가 시 fallback */
export function formatNumber(v: unknown, fallback = '-'): string {
  const n = toSafeNumber(v);
  return n === null ? fallback : n.toLocaleString('ko-KR');
}

/** 통화(원) 포맷 — 변환 불가 시 fallback */
export function formatCurrency(v: unknown, fallback = '-'): string {
  const n = toSafeNumber(v);
  return n === null ? fallback : `${n.toLocaleString('ko-KR')}원`;
}
