import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf-8');
/**
 * 🔴 `fs.globSync` 는 **Node 22+** 에만 있다 — CI 는 Node 20 이라 이 가드가
 *    2026-09-03~09-08 **닷새 동안 `TypeError` 로 죽어 있었고**, 그 사이 CI 는 계속 빨강이었다.
 *    로컬(Node 25)에서만 통과해서 아무도 눈치채지 못했다.
 *    저장소 관행대로 `readdirSync` 재귀로 훑는다(SRC 기준 상대 경로 — glob 출력과 같은 모양).
 */
function listTsx(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTsx(p, base));
    else if (e.name.endsWith('.tsx')) out.push(relative(base, p));
  }
  return out;
}

const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 통계 카드 정렬 계약 — 2026-09-03.
 *
 * 🔴 상황판 KPI 띠에서 실제로 겪은 것:
 *    값과 라벨을 **한 줄에 가로로** 붙여 놔서 값 길이만큼 라벨 시작점이 흔들렸고,
 *    가장 긴 값(`88% (22/25) 2026-05 측정`)이 카드 안에서 3줄로 접히며
 *    **라벨 `QI 달성률` 자체가 `QI ...` 로 잘렸다.** 그 카드 하나 때문에 grid 한 줄 전체가
 *    높아져 나머지 아홉 장이 텅 비어 보였다.
 *
 * 🔴 그리고 대시보드 지표 띠에서는 라벨이 **아예 사라졌다** —
 *    열 수를 화면 폭과 무관하게 `repeat(cols.length, 1fr)` 로 고정한 채 `truncate` 를 걸어,
 *    375px 화면에서 `내 미완료 차트` 가 `대…` 가 됐다.
 *    자르면 잘랐다고 말해야 하는데 라벨에는 그럴 자리가 없다.
 *
 * 이 가드는 그 셋(공용 카드·지표 띠·비율 표시)이 되돌아가지 않게 한다.
 */
describe('통계 카드 — grid 에서 늘어나도 정렬이 무너지지 않는다', () => {
  it('🔴 공용 StatCard 가 수직 중앙 정렬과 값 한 줄 고정을 유지한다', () => {
    const s = strip(read('components/ui/StatCard.tsx'));
    expect(s, 'grid 가 늘린 카드에서 내용이 위로 쏠린다').toMatch(/flex flex-col justify-center/);
    expect(s, '긴 값(금액 8자리·산출 불가 사유)이 접히면 그 카드만 높아진다')
      .toMatch(/whitespace-nowrap[^"]*text-xl font-bold/);
    // 대조군 — 이 파일이 실제로 카드를 그리는지(검사가 헛돌지 않게)
    expect(s).toMatch(/\{title\}/);
    expect(s).toMatch(/\{subtitle\}/);
  });

  it('🔴 대시보드 지표 띠가 열 수를 화면 폭과 무관하게 고정하지 않는다', () => {
    const w = strip(read('app/(main)/dashboard/components/widgets/StatBarWidget.tsx'));
    expect(w, '열 수를 고정하면 좁은 화면에서 한 칸이 50px 가 되어 라벨이 사라진다')
      .not.toMatch(/repeat\(\$\{cols\.length\}/);
    expect(w, '카드 최소 폭을 정하고 들어갈 만큼만 넣어야 한다').toMatch(/auto-fit,\s*minmax\(/);
  });

  it('🔴 지표 띠 라벨을 truncate 로 지우지 않는다 — 자를 자리가 없다', () => {
    const s = strip(read('app/(main)/dashboard/components/shared.tsx'));
    // 🔴 `title={label}` 이 className 과 `>{label}` 사이에 있다 — 그것을 넘지 못하는 정규식으로
    //    처음 썼다가 "찾지 못했습니다"로 실패했다(가드가 대상을 못 겨눈 것).
    // 🔴 라벨 렌더가 i18n 정본 `<T k={label} />` 로 바뀌어도 같은 줄이다(2026-09-09 P2d 배선).
    //    원문 렌더만 찾던 정규식은 그때 조용히 빈 문자열이 됐다 — 두 형태를 모두 겨눈다.
    const label = /<p className="[^"]*text-\[11px\][^"]*"[^>]*>(?:\{label\}|<T k=\{label\} \/>)<\/p>/.exec(s)?.[0] ?? '';
    expect(label, 'MiniStat 의 라벨 줄을 찾지 못했습니다 — 검사가 헛돕니다').not.toBe('');
    expect(label, 'truncate 는 라벨을 조용히 지운다').not.toMatch(/truncate/);
    expect(s, '라벨 줄 수가 갈리면 카드 높이가 어긋난다').toMatch(/flex flex-col justify-center/);
  });

  it('🔴 산출 불가 사유가 값 옆이 아니라 아래 줄에 온다', () => {
    const s = strip(read('components/ui/display.tsx'));
    // 🔴 `className` 은 `data-ratio` **앞**에 온다 — 뒤로만 훑던 정규식이 못 잡았다
    const block = /return \([\s\S]{0,900}?data-ratio="unavailable"[\s\S]{0,400}/.exec(s)?.[0] ?? '';
    expect(block, 'Ratio 의 산출 불가 분기를 찾지 못했습니다').not.toBe('');
    expect(block, '사유를 값 옆에 붙이면 값 줄이 길어져 카드가 접힌다').toMatch(/inline-flex flex-col/);
    // 🔴 사유 자체는 **버리지 않는다** — 왜 못 세는지가 이 표시의 핵심이다
    expect(block, '사유를 지우면 안 된다(위치만 옮기는 것이다)').toMatch(/unavailableHint/);
  });

  /**
   * 🔴 **새 카드가 옛 모양으로 돌아오는 것**을 막는다.
   *    값과 라벨을 한 줄에 붙이는 `items-baseline` 카드는 이 목록 밖에서 늘어나면 안 된다.
   *    기준선을 여유 있게 잡으면 신규 위반을 흡수하므로 **정확한 수**로 못박는다.
   */
  it('🔴 값·라벨을 한 줄에 붙인 카드가 늘어나지 않는다(기준선 동결)', () => {
    const files = listTsx(SRC);
    let n = 0;
    const hits: string[] = [];
    for (const f of files) {
      const src = strip(read(f));
      // 카드 컨테이너(둥근 모서리+패딩) 안에서 items-baseline 으로 값·라벨을 붙인 자리
      for (const m of src.matchAll(/className="[^"]*\bitems-baseline\b[^"]*"/g)) {
        if (!/rounded|border/.test(m[0])) continue;
        n += 1;
        hits.push(`${f}`);
      }
    }
    /**
     * 2026-09-03 실측 **8곳**. 전수 확인한 결과 남은 것들은 전부 **카드 격자가 아니다** —
     * 섹션 헤더 행(`제목 + 부제`), 칩 나열(`admin/him` 은 flex-wrap 이라 폭이 내용에 맞는다),
     * 라벨·값 쌍 목록(상황판 보드 카드 안의 지표 줄) 이다. 거기서는 가로 배치가 의도된 모양이고
     * grid 행 높이를 흔들지 않는다. **정당한 사용에 억지 가드를 만들지 않는다.**
     *
     * 🔴 여유를 두지 않고 **정확한 수**로 동결한다 — 여유를 두면 신규 위반을 흡수한다.
     *    줄어들면 여기를 낮춘다(늘어도 줄어도 실패해야 기준선이다).
     */
    expect(n, `값·라벨 가로 배치가 변했습니다(늘었으면 카드 격자인지 보고, 줄었으면 기준선을 낮추세요):\n  ${[...new Set(hits)].join('\n  ')}`)
      .toBe(8);
  });
});

/**
 * 색 외 상태 기호(`ui.a11y.statusShape`) 배선 — 2026-09-03.
 *
 * 🔴 go-live 가 "배선 완료"라 적었지만 기호를 그리는 소비처가 **0**이라
 *    스위치를 켜도 어느 화면도 달라지지 않았다("만든 것 ≠ 소비처가 쓰는 것").
 *    정본 StatusBadge 가 그리게 배선했다 — 여기서 동결한다.
 */
describe('색 외 상태 기호 — 스위치가 실제로 배선돼 있다', () => {
  const badge = strip(read('components/ui/StatusBadge.tsx'));

  it('🔴 정본 배지가 기호를 그린다(소비처 0 으로 되돌아가지 않게)', () => {
    expect(badge, '배지가 StatusShapeMark 를 렌더하지 않으면 스위치는 다시 죽은 것이 된다')
      .toMatch(/<StatusShapeMark shape=\{c\.shape\}/);
  });

  it('🔴 모든 톤에 기호가 있다 — 색이 말하는 것을 기호도 말한다', () => {
    const tones = [...badge.matchAll(/^\s{2}(\w+): \{ bg: 'bg-/gm)].map((m) => m[1]);
    expect(tones.length, 'TONE 정의를 못 찾았다 — 검사가 헛돕니다').toBeGreaterThanOrEqual(6);
    const mapBlock = /TONE_SHAPE[^}]+\}/.exec(badge)?.[0] ?? '';
    for (const t of tones) {
      expect(mapBlock, `톤 '${t}' 에 기호가 없다 — 그 색은 색으로만 말하게 된다`).toContain(`${t}:`);
    }
  });

  it('스위치가 꺼져 있으면 기호가 그려지지 않는다(현행 유지 — 부품이 스스로 게이트)', () => {
    const display = strip(read('components/ui/display.tsx'));
    const mark = /export function StatusShapeMark[\s\S]{0,300}/.exec(display)?.[0] ?? '';
    expect(mark, 'StatusShapeMark 를 못 찾았다').not.toBe('');
    expect(mark, '설정이 꺼져 있으면 null 을 그려야 켜기 전 화면이 달라지지 않는다')
      .toMatch(/if \(!shape \|\| !s\.statusShape\) return null;/);
  });
});
