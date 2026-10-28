/**
 * 🔴 (2026-09-14) 서명 상태 배지 두 컴포넌트는 만들었지만 붙인 화면이 없다(기획서가 자리를 정하지 않음 — 컴포넌트 머리말 참조).
 * 지키는 것: "소비처 0" 이 조용히 바뀌지 않는다 — 누가 붙이면 이 목록을 사람이 갱신한다(붙인 사실이 보이게).
 *           대조군: 같은 폴더의 다른 컴포넌트(SmartSignButton)는 소비처가 있다 = 스캔이 실제로 import 를 읽는다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
function walk(d: string, acc: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(n)) acc.push(p);
  }
  return acc;
}
const files = walk(SRC);
const consumersOf = (name: string) => files
  .filter((f) => !f.endsWith(`components/signature/${name}.tsx`))
  .filter((f) => new RegExp(`from ['"][^'"]*components/signature/${name}['"]|<${name}[\\s/>]`).test(readFileSync(f, 'utf8')))
  .map((f) => relative(SRC, f));

describe('서명 상태 배지 소비처', () => {
  it.each(['SignatureBadge', 'SignatureStatusIndicator'])('%s — 소비처 0(동결)', (name) => {
    expect(consumersOf(name)).toEqual([]);
  });
  it('대조군 — SmartSignButton 은 소비처가 있다(스캔이 import 를 읽는다)', () => {
    expect(consumersOf('SmartSignButton').length).toBeGreaterThan(0);
  });
});
