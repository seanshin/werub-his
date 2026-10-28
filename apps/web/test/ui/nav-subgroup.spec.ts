import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAV_SECTIONS } from '@/components/layout/Sidebar';

/**
 * 🔴 개원 전 시스템 관리 소분류 (2026-08-28).
 *
 * 36개가 한 목록에 평평하게 있어 "무엇을 여기서 정하는가"가 안 보였다.
 * `group` 은 **표시 분류**이지 권한이 아니다(§규약 5: nav 숨김 ≠ 권한 회수).
 */
type Item = { href: string; label: string; group?: string };
/**
 * 🔴 소분류가 적용된 섹션 목록 — 섹션을 추가로 나누면 여기 등재한다.
 *    한 섹션만 핀 고정하면 "가드가 그 파일 하나로 핀 고정" 함정(형제 화면 미커버)을 반복한다.
 *    minItems 는 섹션을 못 찾았을 때 아래 검사가 전부 자동 통과하는 것을 막는 대조군이다.
 */
const GROUPED_SECTIONS: { title: string; minItems: number }[] = [
  { title: '개원 전 시스템 관리', minItems: 30 },
  { title: '운영 시스템 관리', minItems: 25 },
];

describe.each(GROUPED_SECTIONS)('$title — 소분류', ({ title, minItems }) => {
  const section = (NAV_SECTIONS as { title: string; items: Item[] }[]).find((s) => s.title === title)!;

  it('섹션을 실제로 찾았다(대조군 — 못 찾으면 아래가 전부 자동 통과한다)', () => {
    expect(section, `'${title}' 섹션이 없다`).toBeTruthy();
    expect(section.items.length).toBeGreaterThan(minItems);
  });

  it('🔴 모든 항목이 소분류를 하나씩 갖는다 — 빠뜨리면 그 항목은 떠돈다', () => {
    const orphans = section.items.filter((i) => !i.group || !i.group.trim());
    expect(orphans.map((i) => i.href), '소분류 없는 항목').toEqual([]);
  });

  it('🔴 같은 소분류가 흩어져 있지 않다 — 흩어지면 헤더가 여러 번 나온다', () => {
    const seen = new Set<string>();
    const broken: string[] = [];
    let prev: string | undefined;
    for (const it of section.items) {
      if (it.group !== prev) {
        if (seen.has(it.group!)) broken.push(it.group!);
        seen.add(it.group!);
        prev = it.group;
      }
    }
    expect(broken, '이 소분류가 목록에서 두 번 이상 끊겨 나타난다').toEqual([]);
  });

  it('항목이 두 소분류에 동시에 있지 않다(href 중복 없음)', () => {
    const hrefs = section.items.map((i) => i.href);
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it('🔴 소분류는 표시 분류일 뿐 — 권한(roles)을 바꾸지 않는다', () => {
    // 같은 소분류 안에서도 roles 가 서로 다를 수 있어야 한다(분류가 권한을 물들이면 안 된다)
    const byGroup = new Map<string, Set<string>>();
    for (const it of section.items) {
      const roles = JSON.stringify((it as { roles?: string[] }).roles ?? []);
      byGroup.set(it.group!, (byGroup.get(it.group!) ?? new Set()).add(roles));
    }
    // 최소 한 그룹은 서로 다른 roles 를 담고 있다 = 분류가 권한을 따라가지 않았다는 증거
    expect([...byGroup.values()].some((s) => s.size > 1)).toBe(true);
  });
});

describe('소분류 공통 대조군', () => {
  it('다른 섹션은 소분류를 강제받지 않는다', () => {
    const grouped = new Set(GROUPED_SECTIONS.map((g) => g.title));
    const others = (NAV_SECTIONS as { title: string; items: Item[] }[]).filter((s) => !grouped.has(s.title));
    expect(others.length).toBeGreaterThan(0);
    expect(others.some((s) => s.items.every((i) => !i.group))).toBe(true);
  });
});

/**
 * 🔴 허브 화면(`/menu/[section]`)도 같은 메뉴를 보여준다 — 사이드바만 나누면
 *    허브에서는 여전히 36개가 한 카드에 쏟아진다(같은 사실에 화면이 둘).
 */
describe('메뉴 허브도 소분류를 쓴다', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/app/(main)/menu/[section]/page.tsx'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('소분류로 카드를 나눈다', () => {
    expect(src).toMatch(/it\.group/);
    expect(src).toMatch(/const expand =/);
  });

  it('🔴 소분류가 없는 섹션은 종전대로 한 카드다 — 없는 분류를 지어내지 않는다', () => {
    expect(src).toMatch(/if \(!visible\.some\(\(i\) => i\.group\)\)/);
  });

  it('두 진입 경로(도메인·섹션)가 모두 소분류를 탄다 — 한쪽만 고치면 갈라진다', () => {
    // 🔴 정의는 `const expand = (` 라 `expand(` 에 걸리지 않는다 — **호출부만** 센다
    //    (처음엔 3 이상을 기대해 가드가 다른 이유로 실패했다)
    const calls = (src.match(/[^=]\bexpand\(/g) ?? []).length;
    expect(calls, '도메인 진입·섹션 진입 두 곳에서 불러야 한다').toBe(2);
  });
});
