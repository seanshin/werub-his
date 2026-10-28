import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 넓은 드롭다운이 **컨테이너 밖으로 뻗어 잘리는** 것(2026-08-26 사람 신고).
 *
 *    차트 헤더의 `🎤 음성 ▾` 이 `absolute right-0 w-[248px]` 라 **왼쪽으로 248px** 뻗었고,
 *    본문 `<main className="… overflow-x-hidden">` 에 잘려 절반이 사라졌다.
 *    사용자에게는 "사이드바가 덮었다"로 보였지만 실제로는 **본문이 잘라낸 것**이었다.
 *
 * 🔴 같은 형태가 **5곳**이었다 — 한 곳만 고치면 갈라진다. 여는 방향 판정은 정본 하나다.
 */
const WEB = join(process.cwd(), '../web/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** 고정폭이 이만큼 넘으면 좁은 화면·좌측 배치에서 잘릴 수 있다 */
const WIDE_PX = 240;

function widthOf(cls: string): number | null {
  const px = cls.match(/w-\[(\d+)px\]/);
  if (px) return Number(px[1]);
  const tw = cls.match(/\bw-(\d+)\b/); // tailwind 스케일(1 = 0.25rem = 4px)
  if (tw) return Number(tw[1]) * 4;
  return null;
}

describe('가장자리에서 잘리는 드롭다운', () => {
  const files = walk(WEB);

  it('스캔이 실제로 파일을 찾았다 — 0을 통과로 읽지 않는다', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('🔴 넓은 `absolute right-0` 드롭다운은 전부 여는 방향 정본을 쓴다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/className=(?:"|\{`)([^"`]*absolute[^"`]*right-0[^"`]*)(?:"|`\})/g)) {
        const cls = m[1];
        // 🔴 조준을 좁힌다(완화가 아니다) — **패널만** 본다.
        //    첫 스캔이 로그인 화면의 **장식용 배경 원**(`rounded-full` 반투명 blob)을 드롭다운으로
        //    셌다. 오탐은 자진 철회하고 이유를 남긴다. 패널의 표식은 그림자다.
        if (!/shadow/.test(cls)) continue;
        const w = widthOf(cls);
        if (w != null && w >= WIDE_PX) {
          offenders.push(`${f.replace(WEB, '')}  w=${w}px`);
        }
      }
    }
    expect(
      offenders,
      `컨테이너 밖으로 뻗어 잘릴 수 있다 — useEdgeSafeAlign 을 쓰세요:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('🔴 대상이 0이 되지 않았다 — 좁힌 뒤에도 실제 패널을 세고 있다', () => {
    let panels = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/className=(?:"|\{`)([^"`]*absolute[^"`]*(?:right-0|\$\{[a-zA-Z]*[aA]lignClass\})[^"`]*)(?:"|`\})/g)) {
        if (/shadow/.test(m[1]) && (widthOf(m[1]) ?? 0) >= WIDE_PX) panels++;
      }
    }
    expect(panels, '좁힌 조준이 아무것도 세지 않으면 가드가 아니다').toBeGreaterThanOrEqual(4);
  });

  it('대조군 — 좁은 드롭다운은 이 가드에 걸리지 않는다(무조건 실패하는 가드가 아니다)', () => {
    expect(widthOf('absolute right-0 w-24')).toBe(96);
    expect(widthOf('absolute right-0 w-[248px]')).toBe(248);
    expect(widthOf('absolute right-0')).toBeNull();
  });

  it('🔴 정본은 양쪽 다 넘치면 뒤집지 않는다 — 방향만 바꾸면 원인을 더 못 찾는다', () => {
    const hook = readFileSync(join(WEB, 'components/ui/useEdgeSafeAlign.ts'), 'utf8');
    expect(hook).toMatch(/overflowsLeftIfRightAligned && !overflowsRightIfLeftAligned/);
  });

  it('잘라내는 주체는 스크롤 컨테이너다 — main 을 먼저 보고 없으면 뷰포트', () => {
    const hook = readFileSync(join(WEB, 'components/ui/useEdgeSafeAlign.ts'), 'utf8');
    expect(hook).toMatch(/closest\('main'\)/);
    expect(hook).toMatch(/window\.innerWidth/);
  });
});
