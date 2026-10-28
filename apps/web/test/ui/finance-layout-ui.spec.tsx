import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstitutionPicker, Tabs } from '../../src/app/(main)/executive/finance-benchmark/ui';

/** 경영성과 화면 부품(2026-09-29 레이아웃 정리) — 기관 찾기(1,000곳 넘는 긴 선택 상자 대신) · 탭 */
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('기관 찾기', () => {
  const names = Array.from({ length: 40 }, (_, i) => ({ name: `가병원${i}` })).concat([{ name: '가상중앙병원', hint: '상급종합병원' } as never]);
  it('이름으로 좁히고 고르면 onChange · 30곳이 넘으면 더 있다고 말한다 · 없으면 없다고', () => {
    const onChange = vi.fn();
    wrap(<InstitutionPicker names={names} value={null} onChange={onChange} />);
    const input = screen.getByLabelText('기관 이름으로 찾기');
    fireEvent.focus(input);
    expect(screen.getByText(/더 있음/)).toBeTruthy(); // 41곳 중 30곳만
    fireEvent.change(input, { target: { value: '중앙' } });
    fireEvent.click(screen.getByText('가상중앙병원'));
    expect(onChange).toHaveBeenCalledWith('가상중앙병원');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '없는이름' } });
    expect(screen.getByText('찾는 기관이 없습니다')).toBeTruthy();
  });
  it('고른 뒤에는 이름과 바꾸기·해제를 보인다', () => {
    const onChange = vi.fn();
    wrap(<InstitutionPicker names={names} value="가상중앙병원" onChange={onChange} />);
    expect(screen.getByText('가상중앙병원')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('선택 해제'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('탭', () => {
  it('누르면 onChange · 고른 탭은 aria-selected', () => {
    const onChange = vi.fn();
    wrap(<Tabs value="a" onChange={onChange} items={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} />);
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
