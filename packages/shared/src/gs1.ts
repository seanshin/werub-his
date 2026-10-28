/**
 * GS1 바코드 정본 — GTIN-13/14 · GS1-128 응용식별자(AI).
 *
 * 🔴 발단(2026-08-26 사람 요구): 의료기기 관리에 GTIN 을 반영한다.
 *    실측하니 `medication_codes.barcode` **22,306건**이 저장돼 있는데 **그것을 파싱하는 코드가 0**이었고,
 *    `inventory_items.barcode`·`equipment` 에는 GTIN 자리 자체가 없었다.
 *
 * 🔴 **모르는 것을 아는 척하지 않는다** — 이 파일의 설계 원칙:
 *   · 체크디지트가 틀리면 **`valid:false` 로 말한다**(계산은 하되 "유효"라고 하지 않는다)
 *   · 해석하지 못한 AI 는 **버리지 않고 `unparsed` 로 남긴다**(버리면 스캔한 정보가 조용히 사라진다)
 *   · 유효기간 `DD=00`(월말 표기)은 **날짜를 지어내지 않고** `dayUnknown` 으로 표시한다
 */

/** GS1-128 에서 가변길이 AI 를 끝내는 구분자 — 스캐너는 보통 GS(0x1D)로 준다 */
export const GS1_FNC1 = '\x1d';

export interface Gs1Date {
  /** 원문 6자리(YYMMDD) — 해석과 무관하게 보존한다 */
  raw: string;
  year: number;
  month: number;
  /** `null` = 원문이 `00`(월말) — 🔴 날짜를 지어내지 않는다 */
  day: number | null;
  dayUnknown: boolean;
}

export interface Gs1Parsed {
  /** GTIN-14 로 정규화한 값(GTIN-13 은 앞에 `0` 을 붙인다) */
  gtin: string | null;
  /** 원문 그대로의 GTIN(13 이면 13자리) */
  gtinRaw: string | null;
  /** 🔴 체크디지트 검증 결과. `null` = GTIN 자체가 없어 판정 대상이 아님 */
  gtinValid: boolean | null;
  lot: string | null;
  serial: string | null;
  expiry: Gs1Date | null;
  productionDate: Gs1Date | null;
  /** 🔴 해석하지 못한 조각 — 버리지 않는다 */
  unparsed: string[];
  /** 어떤 형식으로 읽었는가 */
  format: 'GS1_128' | 'GTIN' | 'UNKNOWN';
}

/**
 * GTIN 체크디지트(mod-10). 마지막 자리를 뺀 나머지를 오른쪽부터 3,1,3,1… 로 가중합한다.
 * GTIN-8/12/13/14 에 같은 규칙이 적용된다.
 */
export function gtinCheckDigit(digitsWithoutCheck: string): number {
  let sum = 0;
  const rev = [...digitsWithoutCheck].reverse();
  for (let i = 0; i < rev.length; i += 1) {
    const d = Number(rev[i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(gtin: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(gtin)) return false;
  return gtinCheckDigit(gtin.slice(0, -1)) === Number(gtin.slice(-1));
}

/** GTIN-8/12/13 → GTIN-14 정규화(왼쪽 0 패딩). 🔴 값을 바꾸지 않는다 — 자리만 맞춘다 */
export function toGtin14(gtin: string): string | null {
  const d = gtin.replace(/\D/g, '');
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(d)) return null;
  return d.padStart(14, '0');
}

/**
 * YYMMDD → 날짜. 🔴 `DD=00` 은 **월말**을 뜻하는 GS1 표기다 — 날짜를 지어내지 않고 `dayUnknown` 으로 둔다.
 * 세기 규칙은 GS1 General Specifications 를 따른다(`YY >= 51` → 19YY, 아니면 20YY).
 * 🔴 이 규칙을 바꾸면 유효기간이 통째로 어긋나므로 **가드로 못박는다**.
 */
export function parseGs1Date(raw: string): Gs1Date | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const yy = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(2, 4));
  const dd = Number(raw.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  if (dd < 0 || dd > 31) return null;
  return {
    raw,
    year: yy >= 51 ? 1900 + yy : 2000 + yy,
    month: mm,
    day: dd === 0 ? null : dd,
    dayUnknown: dd === 0,
  };
}

/** 고정 길이 AI — 값 길이가 표준으로 정해져 있어 구분자가 없어도 읽힌다 */
const FIXED_AI: Record<string, number> = {
  '00': 18, '01': 14, '02': 14,
  '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6,
  '20': 2,
};
/** 가변 길이 AI — 구분자(FNC1)나 문자열 끝까지 */
const VARIABLE_AI = new Set(['10', '21', '240', '241', '30', '37', '400', '401', '410', '414']);

/**
 * GS1-128 파싱. 괄호 표기(`(01)08806...`)와 원시 FNC1 표기 둘 다 받는다.
 * 🔴 해석하지 못한 나머지는 `unparsed` 에 남긴다 — 조용히 버리면 스캔한 정보가 사라진다.
 */
export function parseGs1(input: string): Gs1Parsed {
  const out: Gs1Parsed = {
    gtin: null, gtinRaw: null, gtinValid: null,
    lot: null, serial: null, expiry: null, productionDate: null,
    unparsed: [], format: 'UNKNOWN',
  };
  const src = (input ?? '').trim();
  if (!src) return out;

  // ① 괄호 표기가 아니고 숫자만이면 GTIN 단독으로 본다
  if (/^\d+$/.test(src) && [8, 12, 13, 14].includes(src.length)) {
    out.format = 'GTIN';
    out.gtinRaw = src;
    out.gtin = toGtin14(src);
    out.gtinValid = isValidGtin(src);
    return out;
  }

  // ② 괄호 표기 → FNC1 표기로 정규화
  const normalized = src.includes('(')
    ? src.replace(/\((\d{2,4})\)/g, (_m, ai) => `${GS1_FNC1}${ai}`).replace(new RegExp(`^${GS1_FNC1}`), '')
    : src;

  let rest = normalized;
  let read = false;
  while (rest.length > 0) {
    rest = rest.replace(new RegExp(`^${GS1_FNC1}+`), '');
    if (!rest) break;

    const ai2 = rest.slice(0, 2);
    const ai3 = rest.slice(0, 3);
    const ai = FIXED_AI[ai2] !== undefined || VARIABLE_AI.has(ai2) ? ai2 : VARIABLE_AI.has(ai3) ? ai3 : null;
    if (!ai) {
      // 🔴 모르는 조각은 통째로 남긴다
      out.unparsed.push(rest);
      break;
    }
    const after = rest.slice(ai.length);
    let value: string;
    if (FIXED_AI[ai] !== undefined) {
      value = after.slice(0, FIXED_AI[ai]);
      rest = after.slice(FIXED_AI[ai]);
    } else {
      const end = after.indexOf(GS1_FNC1);
      value = end === -1 ? after : after.slice(0, end);
      rest = end === -1 ? '' : after.slice(end);
    }
    read = true;

    switch (ai) {
      case '01':
      case '02':
        out.gtinRaw = value;
        out.gtin = toGtin14(value);
        out.gtinValid = /^\d{14}$/.test(value) ? isValidGtin(value) : null;
        break;
      case '10': out.lot = value || null; break;
      case '21': out.serial = value || null; break;
      case '17': out.expiry = parseGs1Date(value); break;
      case '11': out.productionDate = parseGs1Date(value); break;
      default:
        // 알지만 이 시스템이 쓰지 않는 AI — 있었다는 사실을 남긴다
        out.unparsed.push(`${ai}${value}`);
    }
  }

  out.format = read ? 'GS1_128' : 'UNKNOWN';
  if (!read) out.unparsed = [src];
  return out;
}

/** 화면 표기 — 🔴 검증 실패를 조용히 통과시키지 않는다 */
export function gs1Summary(p: Gs1Parsed): string {
  if (p.format === 'UNKNOWN') return '읽지 못한 바코드';
  const parts: string[] = [];
  if (p.gtin) parts.push(`GTIN ${p.gtin}${p.gtinValid === false ? ' (체크디지트 불일치)' : ''}`);
  if (p.lot) parts.push(`LOT ${p.lot}`);
  if (p.serial) parts.push(`S/N ${p.serial}`);
  if (p.expiry) {
    parts.push(
      `유효 ${p.expiry.year}-${String(p.expiry.month).padStart(2, '0')}` +
        (p.expiry.dayUnknown ? '(월말)' : `-${String(p.expiry.day).padStart(2, '0')}`),
    );
  }
  if (p.unparsed.length) parts.push(`미해석 ${p.unparsed.length}`);
  return parts.join(' · ') || '내용 없음';
}
