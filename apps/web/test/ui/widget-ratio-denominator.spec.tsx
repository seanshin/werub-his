/**
 * 🔴 위젯이 **분모 없는 퍼센트**를 그리지 않는다 — 가드 (2026-08-20)
 *
 * 배경: `ApiStatsWidget.format` 이 `(v) => string` 이라 위젯은 응답의 **분모에 닿을 수 없었다.**
 *       그래서 가동률·준수율 칸은 구조적으로 `50%` 밖에 못 그렸다 —
 *       2병상 중 1개도 50%, 200병상 중 100개도 50%. **"안 잰 것"과 "진짜 값"이 같아 보인다.**
 *       시그니처를 `(v, row) => ReactNode` 로 넓혀 3위젯이 정본 `<Ratio>` 를 그리게 했다.
 *
 * 이 가드가 못박는 것:
 *   ① 3위젯의 비율 칸이 `<Ratio numerator denominator>` 를 쓴다(직접 `%` 문자열 조립 금지)
 *   ② `<Ratio>` 에 넘기는 분자·분모가 **응답 필드에서 온다**(상수·재계산 금지)
 *   ③ `ApiStatsWidget` 이 `format` 두 번째 인자로 **응답 전체**를 넘긴다(안 넘기면 ①이 무의미)
 *   ④ 렌더 계약: 분모 0이면 `산출 불가`, 있으면 `n / N (p%)` — 분모 없는 퍼센트가 나오면 실패
 *
 * 재주입 역검증: `format` 을 `(v) => \`${v}%\`` 로 되돌리거나 두 번째 인자를 떼면 아래가 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Ratio } from '@/components/ui/display';

const WIDGETS = resolve(__dirname, '../../src/app/(main)/dashboard/components/widgets');

const RATIO_WIDGETS: { file: string; label: string; numeratorField: string; denominatorField: string }[] = [
  { file: 'ext/BedStatusWidget.tsx', label: '병상 가동률', numeratorField: 'occupied', denominatorField: 'total' },
  { file: 'ext/IcuDashboardWidget.tsx', label: 'ICU 가동률', numeratorField: 'occupied', denominatorField: 'totalBeds' },
  { file: 'ext/IpsgSummaryWidget.tsx', label: '손위생 준수율', numeratorField: 'handHygieneNumerator', denominatorField: 'handHygieneDenominator' },
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('🔴 비율 위젯은 분모 없는 퍼센트를 그리지 않는다', () => {
  for (const w of RATIO_WIDGETS) {
    const src = stripComments(readFileSync(resolve(WIDGETS, w.file), 'utf8'));

    it(`${w.label} — 정본 <Ratio> 로 그린다(직접 % 조립 금지)`, () => {
      expect(src, `${w.file}: <Ratio> 를 쓰지 않으면 분모가 화면에서 사라진다`).toMatch(/<Ratio\b/);
      expect(
        /`\$\{[^}]*\}%`/.test(src),
        `${w.file}: 퍼센트 문자열을 직접 조립하면 분모 없는 퍼센트가 된다 — <Ratio numerator denominator> 를 쓰라`,
      ).toBe(false);
    });

    it(`${w.label} — 분자·분모를 **응답 필드**에서 가져온다(상수·FE 재계산 금지)`, () => {
      expect(src, `${w.file}: 분자 필드(${w.numeratorField}) 참조가 없다`).toContain(w.numeratorField);
      expect(src, `${w.file}: 분모 필드(${w.denominatorField}) 참조가 없다`).toContain(w.denominatorField);
      // 🔴 FE 가 다시 나눗셈하면 정본이 둘이 된다(P12) — 위젯 안에서 비율을 계산하지 않는다
      expect(/\*\s*100/.test(src), `${w.file}: 위젯이 비율을 다시 계산하고 있다`).toBe(false);
    });
  }

  it('ApiStatsWidget.format 이 응답 전체(row)를 두 번째 인자로 넘긴다', () => {
    const src = stripComments(readFileSync(resolve(WIDGETS, 'ApiStatsWidget.tsx'), 'utf8'));
    // 시그니처가 row 를 받고
    expect(src, 'format 이 row 를 받지 않으면 위젯은 분모에 영원히 닿지 못한다').toMatch(/format\?:\s*\([^)]*row[^)]*\)/);
    // 호출부가 실제로 넘긴다(시그니처만 넓히고 안 넘기면 조용히 undefined 가 된다)
    expect(src, 'format 호출부가 row 를 넘기지 않는다').toMatch(/s\.format\(\s*val\s*,\s*data/);
  });
});

describe('렌더 계약 — 분모 0은 0%·100% 가 아니라 산출 불가', () => {
  it('분모가 있으면 n / N (p%) 를 그린다', () => {
    render(<Ratio numerator={30} denominator={40} />);
    expect(screen.getByText('30 / 40 (75.0%)')).toBeTruthy();
  });

  it('🔴 분모 0이면 산출 불가 — 0% 도 100% 도 아니다', () => {
    const { container } = render(<Ratio numerator={0} denominator={0} unavailableHint="30일 관찰 0건" />);
    expect(container.textContent).toContain('산출 불가');
    expect(container.textContent).not.toMatch(/(^|[^0-9])0%/);
    expect(container.textContent).not.toContain('100%');
    expect(container.querySelector('[data-ratio="unavailable"]')).toBeTruthy();
  });

  it('🔴 분자를 모르면(서버 미노출) 퍼센트를 지어내지 않는다', () => {
    const { container } = render(<Ratio numerator={undefined} denominator={40} />);
    expect(container.textContent).toContain('산출 불가');
    expect(container.textContent).not.toContain('%');
  });
});
