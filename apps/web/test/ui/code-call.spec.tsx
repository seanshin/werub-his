/**
 * 원내 코드 호출(2026-10-07).
 *  · 종류·위치 없으면 발신 막힘 · 두 번 눌러야 나간다(거짓 호출 방지) · 보낸 본문(ALL·종류·위치 · 환자 정보 없음)
 *  · 결과는 서버 도달 수 · CODE BLUE 는 소생 기록으로 이어진다(staffCallId) · 실패는 실패로
 *  · 직원 화면: 간호사도 코드 호출(정본 canCallCode) · 호출 창의 Code 탭 제거(한 길) · 코드블루 화면: 호출 버튼·호출에서 온 기록은 staffCallId
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { post: (...a: unknown[]) => post(...a), get: vi.fn(), getToken: () => 'x' } }));
beforeEach(() => { cleanup(); post.mockReset(); });

async function modal() {
  const { CodeCallModal } = await import('@/components/staff-call/CodeCallModal');
  return render(<CodeCallModal onClose={vi.fn()} />);
}

describe('코드 호출 창', () => {
  it('🔴 종류·위치 없으면 막힘 · 두 번 눌러야 발신 · 본문은 ALL·종류·위치', async () => {
    post.mockResolvedValue({ data: { id: 'call-1', delivered: 87, fcmSent: 40 } });
    const { container } = await modal();
    const send = () => container.querySelector('[data-code-call-send]') as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    fireEvent.click(container.querySelector('[data-code-type="CODE_BLUE"]')!);
    expect(send().disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-code-location]')!, { target: { value: '본관 5층 503호' } });
    fireEvent.click(send());
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-code-call-confirm]')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/staff-calls/code', { targetKind: 'ALL', codeType: 'CODE_BLUE', location: '본관 5층 503호' }));
    await waitFor(() => expect(container.querySelector('[data-code-call-result="call-1"]')).toBeTruthy());
    expect(container.textContent).toContain('87');
    expect(container.querySelector('[data-code-call-record]')!.getAttribute('href')).toBe(`/code-blue?staffCallId=call-1&location=${encodeURIComponent('본관 5층 503호')}`);
  });
  it('실패는 실패로 — 다시 확인 단계부터', async () => {
    post.mockRejectedValue(new Error('rate limit'));
    const { container } = await modal();
    fireEvent.click(container.querySelector('[data-code-type="CODE_RED"]')!);
    fireEvent.change(container.querySelector('[data-code-location]')!, { target: { value: '별관 1층' } });
    fireEvent.click(container.querySelector('[data-code-call-send]')!);
    fireEvent.click(container.querySelector('[data-code-call-confirm]')!);
    await waitFor(() => expect(container.querySelector('[data-code-call-error]')).toBeTruthy());
    expect(container.querySelector('[data-code-call-record]')).toBeNull();
  });
});

describe('배선(구조)', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');
  it('🔴 직원 화면 — 간호사도(canCallCode) · 호출 창 Code 탭은 없다(한 길)', () => {
    const s = read('app/staff/page.tsx');
    expect(s).toMatch(/const canCode = canCallCode\(role\)/);
    expect(s).toMatch(/\{canCode && \(\s*<button onClick=\{\(\) => setCodeOpen\(true\)\}/);
    expect(s).not.toMatch(/setMode\('CODE'\)\}/);
  });
  it('🔴 코드블루 화면 — 호출 버튼 · 호출에서 온 기록은 staffCallId 를 보낸다', () => {
    const s = read('app/(main)/code-blue/page.tsx');
    expect(s).toMatch(/canCallCode\(role\) && \(/);
    expect(s).toMatch(/prefill\?\.staffCallId \? \{ staffCallId: prefill\.staffCallId \} : \{\}/);
  });
});
