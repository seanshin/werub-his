/**
 * 통화 표기 분리 — 순수 로직.
 *
 * 금액은 **숫자가 주인공**이고 단위(원·만원·₩)는 보조다. 같은 크기로 붙어 있으면
 * '1,016만원'에서 눈이 숫자를 먼저 잡지 못한다 → 단위만 **절반 크기**로 렌더하기 위해 잘라낸다.
 * (문자열을 그대로 쓰는 곳이 많아 서식 함수는 건드리지 않고, 표시 단계에서만 나눈다)
 */

/** 뒤에 붙는 한국어 통화 단위 — 긴 것부터 검사해야 '만원'이 '원'으로 잘리지 않는다 */
const SUFFIXES = ['조원', '억원', '만원', '천원', '원'] as const;

export interface CurrencyParts {
  /** 숫자·부호·구분자 부분(크게 보여줄 것) */
  amount: string;
  /** 통화 단위(절반 크기로 보여줄 것) — 없으면 빈 문자열 */
  unit: string;
}

export function splitCurrency(text: string): CurrencyParts {
  const t = String(text ?? '');
  if (!t) return { amount: '', unit: '' };

  // 기호 표기(₩1,016) — 기호가 앞에 오면 기호를 단위로 본다
  if (t.startsWith('₩')) return { amount: t.slice(1), unit: '₩' };

  for (const s of SUFFIXES) {
    if (t.endsWith(s)) return { amount: t.slice(0, -s.length), unit: s };
  }
  return { amount: t, unit: '' };
}

/**
 * 일반 단위 분리 — %·명·건·일·회·℃·mmHg·kg 등 **숫자 뒤에 붙는 모든 단위**.
 *
 * 통화와 같은 이유다: 숫자가 주인공이고 단위는 보조다. 다만 잘못 자르면 값이 망가지므로 규칙을 좁게 둔다.
 *  - 숫자 부분은 **숫자·부호·구분자(, . / : -)와 공백**만 허용 → `2026-07-31`·`P2026-1370`·`10:30` 은 잘리지 않는다
 *    (뒤가 숫자로 끝나므로 애초에 매치되지 않는다)
 *  - 숫자 부분이 비면 자르지 않는다 → `없음`·`—`·`A형` 은 그대로
 */
const VALUE_UNIT = /^([\d.,\-+/:\s]+?)\s*([^\d.,\-+/:\s]+)$/;

export function splitValueUnit(text: string): CurrencyParts {
  const t = String(text ?? '').trim();
  if (!t) return { amount: '', unit: '' };
  if (t.startsWith('₩')) return { amount: t.slice(1), unit: '₩' };
  const m = VALUE_UNIT.exec(t);
  if (!m) return { amount: t, unit: '' };
  const [, amount, unit] = m;
  if (!/\d/.test(amount)) return { amount: t, unit: '' }; // 숫자가 없으면 단위가 아니다
  return { amount: amount.trimEnd(), unit };
}
