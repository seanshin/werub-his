import { describe, it, expect } from 'vitest';
import { registerCatalog, tfOf, tf, hasParams, tOf } from '../src';

/**
 * 🔴 **자리표시자 보간** — 조각 배선이 어순을 깨뜨리던 자리의 대안(2026-09-10 신설).
 *
 * 원 결함(운영 화면 실측): i18n 코어에 보간이 없어서 문장을 조각으로 쪼개 배선해 왔고,
 * 그 결과 영어 화면이 이렇게 나왔다 —
 *   · `1,750명` → **`1750people`**(숫자와 단위가 붙고 띄어쓰기가 사라짐)
 *   · `{활성}명 중 {등재}명` → **`12 of 0`**(분모와 분자가 뒤집힘 — 숫자를 오독하게 만든다)
 *   · `{서명}하세요` → 동사 활용이 한국어 문법에 묶여 영어 문장이 성립하지 않음
 *
 * 여기서 지키는 사실:
 *   ① 번역문이 자리표시자를 **그 언어 어순대로** 옮길 수 있다(같은 값, 다른 순서)
 *   ② 값이 안 온 자리표시자는 **지우지 않는다**(조용히 뜻을 잃지 않게) — `unfilled` 로 드러낸다
 *   ③ 미등록 키도 한국어 원문에 보간해서 돌려준다(원문+티는 소비처가 그린다)
 */

const KEY = '{활성}명 중 {등재}명';
const VERB = '{서명} 전 · 확정 아님';

registerCatalog(
  {
    en: {
      // 🔴 영어는 순서가 뒤집힌다 — 조각 배선으로는 표현할 수 없던 사실이다
      [KEY]: '{등재} of {활성}',
      [VERB]: 'not final — before {서명}',
    },
    ja: { [KEY]: '{활성}名中 {등재}名', [VERB]: '{서명}前・確定ではありません' },
    ar: { [KEY]: '{등재} من {활성}', [VERB]: 'غير نهائي — قبل {서명}' },
  },
  new Set<string>(),
);

describe('🔴 i18n 자리표시자 보간', () => {
  it('① 번역문이 어순을 바꿔 담을 수 있다 — 같은 값, 다른 순서', () => {
    expect(tf(KEY, 'ko', { 활성: 12, 등재: 0 })).toBe('12명 중 0명');
    // 영어에서 분자·분모가 제자리를 찾는다(조각 배선이면 "12 of 0" 이 됐다)
    expect(tf(KEY, 'en', { 활성: 12, 등재: 0 })).toBe('0 of 12');
    expect(tf(KEY, 'ja', { 활성: 12, 등재: 0 })).toBe('12名中 0名');
  });

  it('② 값이 안 온 자리표시자는 지우지 않는다 — 조용히 뜻을 잃지 않는다', () => {
    const r = tfOf(KEY, 'en', { 활성: 12 });
    expect(r.text, '빈 문자열로 접으면 "0 of 12" 가 " of 12" 가 되어 무슨 수인지 알 수 없다').toContain('{등재}');
    expect(r.unfilled).toEqual(['등재']);
  });

  it('②-b 대조군 — 값이 다 오면 unfilled 는 비어 있다(항상 경고하지 않는다)', () => {
    expect(tfOf(KEY, 'en', { 활성: 12, 등재: 0 }).unfilled).toEqual([]);
  });

  it('③ 미등록 키는 한국어 원문에 보간한다(지어내지 않는다)', () => {
    const r = tfOf('{남은}건 남았습니다', 'en', { 남은: 3 });
    expect(r.missing, '미등록인데 등록으로 말한다').toBe(true);
    expect(r.text).toBe('3건 남았습니다');
  });

  it('④ ko 는 원문 그대로 — 보간만 한다', () => {
    expect(tfOf(VERB, 'ko', { 서명: '서명' }).text).toBe('서명 전 · 확정 아님');
  });

  it('⑤ `hasParams` — 자리표시자 유무를 가른다(가드가 t() 오용을 잡는 재료)', () => {
    expect(hasParams(KEY)).toBe(true);
    expect(hasParams('저장')).toBe(false);
  });

  it('🔴 ⑥ 대조군 — 보간 없는 키는 `t()` 와 결과가 같다(새 경로가 옛 경로를 바꾸지 않는다)', () => {
    for (const loc of ['ko', 'en', 'ja'] as const) {
      expect(tfOf('저장', loc, {}).text).toBe(tOf('저장', loc).text);
    }
  });
});
