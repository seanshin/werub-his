import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StaffName, Unknown, KDate, EmptyState, Ratio } from '../../src/components/ui/display';

// KDate 는 ui.* 설정(useUiSettings)을 읽어 표기 형식을 정하므로 쿼리 프로바이더가 필요하다
const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

/**
 * 표현 정본 부품 — 2026-08-03.
 *
 * 🔴 값이 없을 때 전부 `-` 였다. 그래서 "취소 시각이 기록되지 않았다"(사후 추정 금지 대상)와
 *    "아직 취소되지 않았다"(정상)가 화면에서 같아 보였다. 시각·행위자를 추정하지 않기로 한 이상
 *    화면은 모른다는 사실 자체를 말할 수 있어야 한다.
 */
describe('Unknown — 없음의 종류', () => {
  it('기록 없음과 해당 없음과 아직 없음을 구분한다', () => {
    const { rerender } = render(<Unknown kind="UNRECORDED" />);
    expect(screen.getByText('기록 없음')).toBeTruthy();

    rerender(<Unknown kind="NA" />);
    expect(screen.getByText('해당 없음')).toBeTruthy();

    rerender(<Unknown kind="PENDING" />);
    expect(screen.getByText('아직 없음')).toBeTruthy();
  });

  it('추정하지 않는다는 사실을 툴팁으로 남긴다', () => {
    render(<Unknown kind="UNRECORDED" />);
    expect(screen.getByText('기록 없음').getAttribute('title')).toContain('추정');
  });
});

describe('KDate — 없음의 의미', () => {
  it('unknown 을 주면 - 대신 그 사실을 말한다', () => {
    render(withQuery(<KDate value={null} unknown="UNRECORDED" />));
    expect(screen.getByText('기록 없음')).toBeTruthy();
  });

  it('unknown 이 없으면 종전대로 fallback', () => {
    const { container } = render(withQuery(<KDate value={null} />));
    expect(container.textContent).toBe('-');
  });
});

describe('StaffName — 직원 표시', () => {
  it('성+이름을 합쳐 보여준다', () => {
    render(<StaffName familyName="김" givenName="영수" />);
    expect(screen.getByText(/김영수/)).toBeTruthy();
  });

  it('조립된 이름도 받는다 + 호칭·역할', () => {
    const { container } = render(<StaffName name="이수진" suffix=" 선생님" role="판독의" />);
    expect(container.textContent).toContain('이수진 선생님');
    expect(container.textContent).toContain('판독의');
  });

  it('이름이 없으면 - 가 아니라 "기록 없음"', () => {
    const { container } = render(<StaffName />);
    expect(container.textContent).toBe('기록 없음');
  });

  it('환자와 달리 마스킹하지 않는다 — 누가 했는지가 기록의 핵심', () => {
    const { container } = render(<StaffName familyName="김" givenName="영수" />);
    expect(container.textContent).not.toContain('○');
  });
});

describe('EmptyState — 압축형', () => {
  it('위젯용 압축형은 한 줄로 — 기본형(py-12)이 카드 높이를 먹지 않게', () => {
    const { container } = render(<EmptyState compact title="대기 중인 환자가 없습니다." icon="👤" />);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('P');
    expect(el.className).toContain('py-3');
    expect(el.className).not.toContain('py-12');
    expect(el.textContent).toContain('대기 중인 환자가 없습니다.');
  });

  it('기본형은 종전 그대로 — 전체 화면 빈 목록은 여백이 있어야 한다', () => {
    const { container } = render(<EmptyState title="자료가 없습니다" />);
    expect(container.firstElementChild!.className).toContain('py-12');
  });
});

/**
 * Ratio — 비율·완결률 정본(2026-08-19 §2.1·§3.3). 분모와 함께, 분모 0·미상은 '산출 불가'.
 * 🔴 손위생 준수율 관찰 0건이 `-`, ICU NEWS2 산출 불가가 `0점` 으로 나오던 자리의 정본이다.
 */
describe('Ratio — 비율은 분모와 함께', () => {
  it('n / N (p%) 를 한 덩어리로 그린다', () => {
    const { container } = render(<Ratio numerator={12} denominator={15} />);
    expect(container.textContent).toBe('12 / 15 (80.0%)');
  });
  it('pctOnly 여도 title 에 n/N 을 남긴다(공간이 좁아도 분모를 잃지 않는다)', () => {
    const { container } = render(<Ratio numerator={12} denominator={15} pctOnly decimals={0} />);
    expect(container.textContent).toBe('80%');
    expect(container.querySelector('span')?.getAttribute('title')).toBe('12 / 15 (80%)');
  });
  it('🔴 분모 0 은 0% 도 100% 도 `-` 도 아니다 — 산출 불가 + 사유', () => {
    const { container } = render(<Ratio numerator={0} denominator={0} unavailableHint="이 기간 관찰 기록 없음" />);
    expect(container.textContent).toContain('산출 불가');
    expect(container.textContent).toContain('이 기간 관찰 기록 없음');
    expect(container.textContent).not.toContain('%');
    expect(container.querySelector('[data-ratio="unavailable"]')?.getAttribute('title')).toContain('분모 0');
  });
  it('분자 미집계(null)도 산출 불가 — 0 으로 접지 않는다', () => {
    const { container } = render(<Ratio numerator={null} denominator={20} />);
    expect(container.textContent).toContain('산출 불가');
    expect(container.textContent).not.toContain('0 / 20');
  });
});
