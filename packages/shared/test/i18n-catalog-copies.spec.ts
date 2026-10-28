import { describe, expect, it } from 'vitest';
import { catalogCopyReport } from '../src/i18n/catalog-copies';
import { AREA_CATALOGS } from '../src/i18n/messages/registry';
import { tOf } from '../src/i18n/t';

/**
 * 🔴 (2026-09-15 §12-E) 사본 판정은 **언어별**이다 — 종전 가드는 en/ja/ar 를 통째로 비교해
 *    "앞 영역엔 ar 이 있고 사본엔 없는" 죽은 사본 7개를 "값이 다른 사본"으로 셌다.
 *    분류 정의는 `src/i18n/catalog-copies.ts` 머리말. 실데이터 기준선은 web `p5-notify-nursing-i18n.spec.ts`.
 */
describe('catalogCopyReport — 언어별 사본 분류', () => {
  const A = { en: { 가: 'A', 나: 'N' }, ja: { 가: 'あ' }, ar: { 가: 'أ' } };

  it('🔴 사본이 ar 을 안 가진 것은 "다름"이 아니다 — 가진 값이 전부 같으면 죽은 사본', () => {
    const r = catalogCopyReport([{ area: 'a', c: A }, { area: 'b', c: { en: { 가: 'A' }, ja: { 가: 'あ' }, ar: {} } }]);
    expect(r.deadSame.map((x) => `${x.key}:${x.copy}`)).toEqual(['가:b']);
    expect(r.deadConflict).toEqual([]);
    expect(r.liveFill).toEqual([]);
  });

  it('앞 영역에 없는 언어를 공급하는 사본은 죽은 키가 아니다(지우면 번역이 사라진다)', () => {
    const r = catalogCopyReport([{ area: 'a', c: { en: { 나: 'N' }, ja: {}, ar: {} } }, { area: 'b', c: { en: { 나: 'N' }, ja: {}, ar: { 나: 'ن' } } }]);
    expect(r.liveFill).toEqual([{ key: '나', first: 'a', copy: 'b', locales: ['ar'] }]);
    expect(r.deadSame).toEqual([]);
  });

  it('값이 다른 언어가 있으면 deadConflict — 지우지 않고 사람 검수로', () => {
    const r = catalogCopyReport([{ area: 'a', c: A }, { area: 'b', c: { en: { 가: 'A' }, ja: { 가: 'い' }, ar: {} } }]);
    expect(r.deadConflict).toEqual([{ key: '가', first: 'a', copy: 'b', locales: ['ja'] }]);
    expect(r.deadSame).toEqual([]);
  });

  it('대조군: 한 영역에만 있는 키는 사본이 아니다 · en 이 비고 ja 만 있는 키도 전집에 든다', () => {
    const r = catalogCopyReport([{ area: 'a', c: A }, { area: 'b', c: { en: {}, ja: { 다: 'だ' }, ar: {} } }]);
    expect(r.deadSame.length + r.deadConflict.length + r.liveFill.length).toBe(0);
    expect(r.totalKeys).toBe(3);
  });

  it('실데이터: 등록부를 실제로 읽는다(헛돌지 않는다)', () => {
    // 🔴 liveFill 이 지어낸 규칙이 아닌지 — components2 는 ar 을 등재하지 않고 ws2 사본이 ar 을 공급한다.
    //    실제 조회가 그 사본 값을 내야 이 분류가 tOf·팩 조립의 언어별 우선순위와 같다.
    expect(tOf('환자 추가', 'ar').text).toBe('إضافة مريض');
    expect(tOf('환자 추가', 'en').text).toBe('Add patient');
    const r = catalogCopyReport(AREA_CATALOGS);
    expect(r.totalKeys).toBeGreaterThan(10000);
  });
});
