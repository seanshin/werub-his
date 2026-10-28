/**
 * 언어 선택 UI 커버리지 정직성 가드 — `components/layout/UiLocaleSelect.tsx`.
 *
 * 🔴 이 가드가 생긴 이유(2026-09-07 실측):
 *    추가 언어 팩 6종(zh·ru·vi·kk·mn·th)이 코어 6,175키 중 **약 9%** 만 가진 채 전부
 *    `status: 'ACTIVE'` 였고, 언어 선택 UI 는 팩의 `label` 만 그렸다. 사용자는
 *    "Tiếng Việt" 라는 이름만 보고 완역된 언어라고 읽은 뒤 화면의 90%를 한국어 원문+티로 본다.
 *    `packCoverage()` 는 **있었지만 소비처가 shared 테스트 한 곳뿐**이었다 —
 *    만든 것과 소비처가 쓰는 것은 다른 일이다.
 *
 * 🔴 여기서 지키는 것은 두 가지뿐이다:
 *    ① 부분 번역 언어의 선택지에 **분모가 병기된다**("9%" 가 아니라 "586 / 6,175").
 *    ② 완역 언어에는 그 수치가 붙지 않는다(거짓 캐비아트 금지 — 대조군).
 *    **막지 않는다.** 9% 언어를 ACTIVE 로 둘 것인가는 사람 결정거리다.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { activeLocaleCoverage, getLocalePack, COVERAGE_CORE_LOCALE } from '@hospital-run/shared';
import { UiLocaleSelect } from '@/components/layout/UiLocaleSelect';

const nf = new Intl.NumberFormat('ko-KR');
const optionTexts = (c: HTMLElement) => [...c.querySelectorAll('option')].map((o) => o.textContent ?? '');

describe('화면 언어 셀렉트 — 커버리지를 분모와 함께 말한다', () => {
  it('표본 확인 — 부분 번역 언어가 실제로 선택지에 있다(없으면 이 가드는 아무것도 지키지 않는다)', () => {
    const partial = activeLocaleCoverage().filter((c) => !c.complete && !c.unavailable);
    expect(partial.length, '부분 번역 ACTIVE 팩이 0 — 표본이 사라졌다').toBeGreaterThan(0);
  });

  it('🔴 부분 번역 언어의 선택지에 「번역 N / 분모」가 붙는다', () => {
    const { container } = render(<UiLocaleSelect />);
    const texts = optionTexts(container);
    const partial = activeLocaleCoverage().filter((c) => !c.complete && !c.unavailable);

    for (const c of partial) {
      const hit = texts.find((t) => t.startsWith(c.label));
      expect(hit, `${c.code} 선택지가 없다`).toBeTruthy();
      // 분자
      expect(hit, `${c.code} 번역 키 수 미표기`).toContain(nf.format(c.translated));
      // 🔴 분모 — 이 저장소 규약: 비율에는 분모를 함께. 이것이 빠지면 "586키" 가 완역처럼 읽힌다
      expect(hit, `${c.code} 분모 미병기 — 커버리지가 사실을 말하지 않는다`).toContain(nf.format(c.coreTotal));
    }
  });

  it('완역 언어·한국어에는 수치를 붙이지 않는다 — 대조군(성공을 실패로 말하지 않는다)', () => {
    const { container } = render(<UiLocaleSelect />);
    const texts = optionTexts(container);
    const complete = activeLocaleCoverage().filter((c) => c.complete);
    expect(complete.length, '완역 언어 표본이 없다').toBeGreaterThan(0);
    for (const c of complete) {
      expect(texts, `${c.code} 선택지가 없다`).toContain(c.label);
    }
    // 한국어(원문 정본)를 "0 / N" 으로 그리면 "한국어가 미번역"이라는 거짓말이 된다
    expect(texts.some((t) => t.startsWith('한국어') && t.includes('/')), 'ko 에 커버리지 수치가 붙었다').toBe(false);
  });

  it('숫자가 실제 팩과 일치한다 — 화면이 자기 수치를 지어내지 않는다', () => {
    const core = getLocalePack(COVERAGE_CORE_LOCALE)!;
    const coreTotal = Object.keys(core.messages).filter((k) => core.messages[k]).length;
    const { container } = render(<UiLocaleSelect />);
    const texts = optionTexts(container);
    const vi = activeLocaleCoverage().find((c) => c.code === 'vi');
    if (!vi) return; // vi 팩이 빠졌다면 이 단언은 표본 부재 — 다른 단언이 잡는다
    const hit = texts.find((t) => t.startsWith(vi.label))!;
    const viKeys = Object.keys(getLocalePack('vi')!.messages).filter((k) => getLocalePack('vi')!.messages[k]).length;
    expect(hit).toContain(`${nf.format(viKeys)} / ${nf.format(coreTotal)}`);
  });

  it('셀렉트에 접근성 라벨과 안내(툴팁)가 남아 있다 — 숫자의 뜻을 그 자리에서 말한다', () => {
    render(<UiLocaleSelect />);
    const sel = screen.getByRole('combobox');
    expect(sel.getAttribute('aria-label')).toContain('화면 전체 문구');
    const label = sel.closest('label')!;
    expect(label.getAttribute('title')).toContain('미번역');
  });
});
