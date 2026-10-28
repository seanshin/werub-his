import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasonInput } from '@/components/ui/ReasonInput';
import { REASON_PRESETS } from '@/lib/reason-presets';

/**
 * `<ReasonInput>` 실렌더 계약 (2026-08-24 · 입력 보조 UX P2)
 *
 * 🔴 소스 스캔만으로는 **부품이 실제로 자유 입력을 받는지** 알 수 없다.
 *    "목(mock)만 통과하는 테스트"(v4.2.0)·"내 가드가 내 어휘를 테스트해 통과"(v4.6.0)를 피하려고
 *    여기서는 실제로 렌더해서 **프리셋에 없는 값을 타이핑**해 본다.
 */
describe('ReasonInput — datalist 는 제안이지 제한이 아니다', () => {
  it('🔴 프리셋에 없는 값을 타이핑하면 그대로 전달된다', () => {
    const onChange = vi.fn();
    render(
      <ReasonInput domain="inventoryTxn" value="" onChange={onChange} data-testid="r" placeholder="사유" />,
    );
    const el = screen.getByTestId('r');
    // 정본 프리셋에 없는 어휘 — 현장이 실제로 쓰는 말은 목록보다 항상 넓다
    const freeText = '거래처 착오 반품(전표 2026-08-24-7)';
    expect(REASON_PRESETS.inventoryTxn).not.toContain(freeText);
    fireEvent.change(el, { target: { value: freeText } });
    expect(onChange).toHaveBeenCalledWith(freeText);
    // 값을 가공하지 않는다 — trim 도 하지 않는다(타이핑 중 커서가 튄다)
    fireEvent.change(el, { target: { value: '  앞뒤 공백 ' } });
    expect(onChange).toHaveBeenLastCalledWith('  앞뒤 공백 ');
  });

  it('프리셋이 있으면 datalist 로 제안하되 input 은 자유 입력 그대로다', () => {
    render(<ReasonInput domain="inventoryTxn" value="" onChange={() => {}} data-testid="r" />);
    const el = screen.getByTestId('r') as HTMLInputElement;
    expect(el.tagName).toBe('INPUT');
    expect(el.getAttribute('list')).toBeTruthy();
    const opts = Array.from(
      screen.getByTestId('r-preset').querySelectorAll('option'),
    ).map((o) => o.getAttribute('value'));
    expect(opts).toEqual([...REASON_PRESETS.inventoryTxn]);
  });

  it('🔴 프리셋이 비면 datalist 를 붙이지 않는다 (빈 제안 상자를 띄우지 않는다)', () => {
    expect(REASON_PRESETS.billingCancel).toEqual([]); // 실사용 0행이라 보류한 도메인
    render(<ReasonInput domain="billingCancel" value="" onChange={() => {}} data-testid="r" />);
    expect((screen.getByTestId('r') as HTMLInputElement).getAttribute('list')).toBeNull();
    expect(screen.queryByTestId('r-preset')).toBeNull();
  });

  it('기존 스타일 계약을 보존한다 — className 을 그대로 넘긴다', () => {
    const cls = 'w-full px-3 py-1.5 border border-red-200 rounded-lg text-xs';
    render(<ReasonInput domain="billingCancel" value="" onChange={() => {}} className={cls} data-testid="r" />);
    expect(screen.getByTestId('r').getAttribute('class')).toBe(cls);
  });

  it('여러 줄이던 자리는 textarea 로 남는다', () => {
    render(<ReasonInput domain="medicationHold" multiline rows={3} value="" onChange={() => {}} data-testid="r" />);
    const el = screen.getByTestId('r');
    expect(el.tagName).toBe('TEXTAREA');
    expect(el.getAttribute('rows')).toBe('3');
  });
});

describe('required — 어휘가 아니라 "비어 있음"만 말한다', () => {
  it('🔴 공백만 입력하면 화면이 그 사실을 말한다', () => {
    render(<ReasonInput domain="billingCancel" required value="   " onChange={() => {}} data-testid="r" />);
    expect(screen.getByText(/공백만으로는 남길 수 없습니다/)).toBeTruthy();
    expect(screen.getByTestId('r').getAttribute('aria-invalid')).toBe('true');
  });

  it('대조군 — 내용이 있으면 경고하지 않는다(거짓 경보는 진짜 경보를 죽인다)', () => {
    render(<ReasonInput domain="billingCancel" required value="중복 수납" onChange={() => {}} data-testid="r" />);
    expect(screen.queryByText(/공백만으로는 남길 수 없습니다/)).toBeNull();
    expect(screen.getByTestId('r').getAttribute('aria-invalid')).toBeNull();
  });

  it('대조군 — 아직 아무것도 안 쓴 빈 칸을 틀렸다고 하지 않는다', () => {
    render(<ReasonInput domain="billingCancel" required value="" onChange={() => {}} data-testid="r" />);
    expect(screen.queryByText(/공백만으로는 남길 수 없습니다/)).toBeNull();
  });

  it('required 가 아니면 공백에도 경고하지 않는다(선택 사유를 막지 않는다)', () => {
    render(<ReasonInput domain="patientFlag" value="  " onChange={() => {}} data-testid="r" />);
    expect(screen.queryByText(/공백만으로는 남길 수 없습니다/)).toBeNull();
  });

  it('🔴 (U4) maxLength 가 있으면 입력칸이 한도를 갖고, 80% 부터 글자 수를 보여 준다(대조군: 그 전·maxLength 없음은 숨김)', () => {
    const { rerender } = render(<ReasonInput domain="claimAdjust" value={'가'.repeat(239)} onChange={() => {}} maxLength={300} data-testid="r" />);
    expect((screen.getByTestId('r') as HTMLInputElement).maxLength).toBe(300);
    expect(screen.queryByTestId('r-count')).toBeNull();
    rerender(<ReasonInput domain="claimAdjust" value={'가'.repeat(240)} onChange={() => {}} maxLength={300} data-testid="r" />);
    expect(screen.getByTestId('r-count').textContent).toBe('240/300');
    rerender(<ReasonInput domain="claimAdjust" value={'가'.repeat(900)} onChange={() => {}} data-testid="r" />);
    expect(screen.queryByTestId('r-count')).toBeNull();
  });
});
