import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripI18nKeys, countSelfTranslating, koFragments, scanScreens } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 계측 모델 교정(2026-09-12) — **스스로 번역하는 부품의 문자열 prop 은 배선이다.**
 *
 * 종전 스캐너는 `<EmptyState title="예약이 없습니다" />` 의 한국어를 잔여(`ko`)로 세고 배선(`t`)으로는 안 셌다.
 * 그래서 호출부가 `title={tAttr('…')}` 로 **미리 번역해 넘기는 285곳**이 생겼고 — 그래야 스캐너가 배선으로 봤다 —
 * 그 자리에서 AI 초안 표식(`data-i18n-draft`·툴팁 · AI기본법 §31)이 탈락했다. 계측이 잘못된 계약을 강요한 것이다.
 *
 * 지키는 것: ① 그 prop 의 한국어는 잔여가 아니다 ② 배선으로 센다 ③ `tAttr()` 로 감싼 자리를 이중 계수하지 않는다
 *            (껍데기를 벗겨도 수가 안 변해야 285곳 회수가 계측을 흔들지 않는다) ④ 🔴 대조군 — 일반 속성(`<div title>`)은 여전히 잔여다.
 */
describe('스캐너 — 스스로 번역하는 부품의 문자열 prop', () => {
  it('① ② EmptyState/Ratio 의 한국어 prop 은 잔여에서 빠지고 배선으로 센다', () => {
    const src = `<EmptyState icon="📋" title="예약이 없습니다" hint="등록되면 여기에" /><Ratio numerator={1} denominator={0} unavailableHint="분모 0" />`;
    expect([...koFragments(stripI18nKeys(src))]).toEqual([]);
    expect(countSelfTranslating(src)).toBe(3);
  });

  it('② 중괄호 식 안의 한국어 리터럴도 센다(조건식 폴백) — 노드는 세지 않는다', () => {
    const src = `<EmptyState title={list?.zeroMeaning ? <Data>{list.zeroMeaning}</Data> : '접수된 기록을 확인할 수 없습니다'} />`;
    expect([...koFragments(stripI18nKeys(src))]).toEqual([]);
    expect(countSelfTranslating(src)).toBe(1);
  });

  it('③ 🔴 `title={tAttr(…)}` 는 tAttr 규칙이 먼저 세므로 여기서 다시 세지 않는다(이중 계수 0)', () => {
    const wrapped = `<EmptyState title={tAttr('예약이 없습니다')} />`;
    const bare = `<EmptyState title="예약이 없습니다" />`;
    expect(countSelfTranslating(wrapped)).toBe(0);
    expect(countSelfTranslating(bare)).toBe(1);
    // 껍데기를 벗겨도 총 배선 수(tAttr 1 → prop 1)가 같고 잔여도 같다
    expect([...koFragments(stripI18nKeys(wrapped))]).toEqual([...koFragments(stripI18nKeys(bare))]);
  });

  it('④ 🔴 대조군 — 일반 속성·다른 부품의 한국어는 여전히 잔여다(규칙을 넓히면 미배선이 배선으로 둔갑한다)', () => {
    const src = `<div title="설명" /><Stat label="조제 대기" /><EmptyState icon="x" />`;
    expect([...koFragments(stripI18nKeys(src))].sort()).toEqual(['설명', '조제 대기']);
    expect(countSelfTranslating(src)).toBe(0);
  });

  it('여는 태그 경계 — 태그 뒤의 다른 JSX 를 삼키지 않는다', () => {
    const src = `<EmptyState title="없음" />\n<p title="일반">본문</p>`;
    expect([...koFragments(stripI18nKeys(src))].sort()).toEqual(['본문', '일반']);
    expect(countSelfTranslating(src)).toBe(1);
  });

  it('🔴 종단 — scanScreens 의 t 에 실제로 더해진다(함수만 맞고 합산이 빠진 첫 판을 여기서 잡는다)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-scan-'));
    mkdirSync(join(dir, 'x'));
    writeFileSync(join(dir, 'x', 'wrapped.tsx'), `export default function A(){ const tAttr = useTAttr(); return <EmptyState title={tAttr('예약이 없습니다')} />; }`);
    writeFileSync(join(dir, 'x', 'bare.tsx'), `export default function B(){ return <EmptyState title="예약이 없습니다" />; }`);
    const rows = scanScreens(dir, dir) as Array<{ file: string; t: number; ko: number }>;
    const w = rows.find((r) => r.file.endsWith('wrapped.tsx'))!;
    const b = rows.find((r) => r.file.endsWith('bare.tsx'))!;
    expect(w.t).toBe(1); expect(w.ko).toBe(0);
    expect(b.t, '스스로 번역하는 부품의 문자열 prop 이 scanScreens 의 t 에 더해지지 않았다').toBe(1);
    expect(b.ko).toBe(0);
  });
});
