import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { widgetSize, widgetGridClass, unsizedWidgets, allGridClasses, spansByBreakpoint, UNIT_SPAN_BY_BREAKPOINT } from './widget-size';

/**
 * 레지스트리는 위젯 컴포넌트를 전부 끌어와 브라우저 API 에 닿는다 → 파일에서 키만 읽는다
 * (검사 목적은 "등록 누락 감시"이지 컴포넌트 로딩이 아니다)
 */
function registryWidgetIds(): string[] {
  // 실행 위치(cwd=apps/web)에서 경로를 만든다 — import.meta.url 은 변환 후 경로가 어긋난다
  const src = readFileSync(join(process.cwd(), 'src/app/(main)/dashboard/components/widget-registry.ts'), 'utf-8');
  return [...src.matchAll(/\{\s*id:\s*'([\w-]+)'/g)].map((m) => m[1]);
}

/**
 * 위젯 폭 골든 — 2026-07-31.
 * 🔴 종전 고정 span 은 좁은 화면에서 위젯을 1/3로 눌렀고(모바일 ≈125px),
 *    넓은 화면에서는 max-w 상한 탓에 오른쪽이 비었다.
 */
describe('크기 매핑', () => {
  it('종전 폭을 그대로 옮겼다(12=full·8=lg·6=md·4=sm)', () => {
    expect(widgetSize('census')).toBe('full');
    expect(widgetSize('pharmacy-queue')).toBe('lg');
    expect(widgetSize('cashier-queue')).toBe('lg');
    expect(widgetSize('quick-actions')).toBe('sm');
    expect(widgetSize('inpatients')).toBe('md');
    expect(widgetSize('schedule')).toBe('sm');
  });

  it('모르는 위젯은 md 로 — 화면에서 사라지지 않는다', () => {
    expect(widgetSize('unknown-widget')).toBe('md');
  });

  it('🔴 레지스트리의 모든 위젯에 크기가 등록돼 있다(없으면 조용히 md 로 떨어진다)', () => {
    const ids = registryWidgetIds();
    expect(ids.length).toBeGreaterThan(30); // 파싱 실패를 통과로 오인하지 않게
    expect(unsizedWidgets(ids)).toEqual([]);
  });
});

describe('반응형 클래스', () => {
  it('모든 크기가 모바일에서 전폭이다 — 좁은 화면에서 눌리지 않게', () => {
    for (const id of ['stat-bar', 'quick-actions', 'inpatients', 'schedule']) {
      expect(widgetGridClass(id).startsWith('col-span-12')).toBe(true);
    }
  });

  it('넓어질수록 한 행에 더 들어간다(열 수 증가 — 위젯이 늘어나지 않는다)', () => {
    const sm = widgetGridClass('schedule');
    expect(sm).toContain('md:col-span-6');       // 2단위
    expect(sm).toContain('2xl:col-span-4');      // 3단위
    expect(sm).toContain('min-[2200px]:col-span-3'); // 4단위
  });

  /**
   * 🔴 2026-10-02 실화면 — 소형 1/4·표 1/3·큰 목록 1/2 가 한 줄에 섞이자 줄 끝마다 2칸이 남았다.
   *    2칸짜리 위젯은 없으니 dense 배치로도 못 메워 **줄마다 오른쪽이 비었다**.
   *    모든 크기가 그 폭 구간 단위의 배수여야 줄 끝에 메울 수 없는 빈칸이 생기지 않는다.
   */
  it('🔴 어느 폭에서든 모든 크기가 한 단위의 배수다(줄 끝 빈칸 없음)', () => {
    const classes = allGridClasses();
    expect(Object.keys(classes).length).toBe(5);
    for (const [size, cls] of Object.entries(classes)) {
      const spans = spansByBreakpoint(cls);
      for (const [bp, unit] of Object.entries(UNIT_SPAN_BY_BREAKPOINT)) {
        const span = spans[bp as keyof typeof spans];
        expect(span % unit, `${size} @${bp}: ${span}칸은 단위 ${unit}칸의 배수가 아니다`).toBe(0);
      }
    }
  });

  it('소형과 표는 같은 폭이다 — 폭이 둘이면 다시 섞인다', () => {
    expect(widgetGridClass('schedule')).toBe(widgetGridClass('inpatients'));
  });

  it('전폭 위젯은 초광폭에서만 절반이 된다', () => {
    const full = widgetGridClass('census');
    expect(full).toContain('min-[2200px]:col-span-6');
    expect(full).not.toContain('lg:col-span-6');
  });

  /**
   * 🔴 2026-08-03: KPI 스트립(높이 ≈100px)이 초광폭에서 절반이 되자, 옆에 온 세로로 긴
   *    관리자 패널이 행 높이를 정해 **띠 아래가 통째로 비었다**. 격자는 행 단위라 그 여백을
   *    다른 위젯이 채우지 못한다. 가로 띠는 어떤 폭에서도 한 줄을 통째로 써야 한다.
   */
  it('가로 띠(stat-bar)는 어떤 폭에서도 쪼개지지 않는다', () => {
    expect(widgetSize('stat-bar')).toBe('strip');
    const strip = widgetGridClass('stat-bar');
    expect(strip).toBe('col-span-12');
    expect(strip).not.toContain('min-[2200px]');
  });

  it('전폭이면서 한 줄 높이인 위젯은 전부 strip 이어야 한다', () => {
    // 레지스트리의 defaultH 가 그 위젯이 몇 줄짜리인지 말해준다.
    // 12칸 폭 + 1줄 높이 = 가로 띠 → 절반으로 쪼개면 옆 카드가 행 높이를 정해 아래가 빈다.
    const src = readFileSync(join(process.cwd(), 'src/app/(main)/dashboard/components/widget-registry.ts'), 'utf-8');
    const oneLineFullWidth = [...src.matchAll(/id:\s*'([\w-]+)'[^\n]*defaultW:\s*12,\s*defaultH:\s*1\b/g)].map((m) => m[1]);
    expect(oneLineFullWidth.length).toBeGreaterThan(0); // 파싱 실패를 통과로 오인하지 않게
    for (const id of oneLineFullWidth) {
      expect(widgetSize(id), `${id} 는 가로 띠라 strip 이어야 한다`).toBe('strip');
    }
  });
});
