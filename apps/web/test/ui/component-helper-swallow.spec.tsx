import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, act, waitFor } from '@testing-library/react';

/**
 * 🔴 (2026-09-15 F3) `helper-swallow-list` 는 `lib`·`hooks` 헬퍼만 동결한다. 그런데 화면이 부르는 헬퍼 훅은
 *    `components/**` 에도 산다 — 한 번 훑어(내보낸 함수 중 apiClient·fetch 를 부르고 catch 를 가진 45개)
 *    **실패를 없음으로 바꾸는 확정 결함 2곳**을 교정하고 여기서 동작으로 못박는다.
 *
 *  ① `useCodeSearch`(처방 입력 코드 검색 — 처방 화면·진료 화면): 두 검색 경로가 다 실패하면 `results=[]` 만 남아
 *     열린 목록이 **"검색 결과가 없습니다."** 를 띄웠다 — 처방하려는 약이 원내에 없다고 말한다.
 *  ② `usePrescriberDelegate`(처방 권한): 조회 실패 → `info=null` → `authorize` 가 **"위임 불요"** 로 `{}` 반환 —
 *     비처방 역할이 책임 처방의·지시 경로 없이 저장으로 넘어갔다. 조회 중에 누른 저장도 같았다.
 */

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn() },
}));

beforeEach(() => { get.mockReset(); });

describe('① useCodeSearch · CodeSearchDropdown — 실패를 "결과 없음"으로 그리지 않는다', () => {
  it('두 경로 모두 실패 → failed=true · 목록은 실패 문구(결과 없음 문구 없음)', async () => {
    get.mockRejectedValue(new Error('500'));
    const { useCodeSearch, CodeSearchDropdown } = await import('@/components/prescription/order-entry');
    const { result } = renderHook(() => useCodeSearch('MEDICATION'));
    await act(async () => { await result.current.search('아세트'); });
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.failed).toBe(true);
    expect(result.current.open).toBe(true);
    render(<CodeSearchDropdown activeTab="MEDICATION" results={result.current.results} query="아세트" failed={result.current.failed} onSelect={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/검색하지 못했습니다/);
    expect(screen.queryByText('검색 결과가 없습니다.')).toBeNull();
  });

  it('대조군 — 진짜 0건이면 "결과 없음" · 폴백 성공이면 실패 아님 · 다음 검색은 실패 표시를 지운다', async () => {
    const { useCodeSearch, CodeSearchDropdown } = await import('@/components/prescription/order-entry');
    get.mockResolvedValueOnce({ data: [] });
    const { result } = renderHook(() => useCodeSearch('MEDICATION'));
    await act(async () => { await result.current.search('없는약'); });
    expect(result.current.failed).toBe(false);
    render(<CodeSearchDropdown activeTab="MEDICATION" results={[]} query="없는약" failed={false} onSelect={() => {}} />);
    expect(screen.getByText('검색 결과가 없습니다.')).toBeTruthy();

    get.mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce({ data: [] });
    await act(async () => { await result.current.search('폴백'); });
    expect(result.current.failed).toBe(false);

    get.mockRejectedValue(new Error('500'));
    await act(async () => { await result.current.search('실패'); });
    expect(result.current.failed).toBe(true);
    get.mockReset(); get.mockResolvedValue({ data: [] });
    await act(async () => { await result.current.search('회복'); });
    expect(result.current.failed).toBe(false);
  });
});

describe('② usePrescriberDelegate — 확인되지 않은 처방 권한을 "위임 불요"로 읽지 않는다', () => {
  it('조회 실패 → infoState ERROR · authorize 는 null(저장 중단) · 사유를 남긴다 · 선택 패널이 실패를 그린다', async () => {
    get.mockRejectedValue(new Error('500'));
    const { usePrescriberDelegate, PrescriberPicker } = await import('@/components/prescription/PrescriberDelegate');
    const { result } = renderHook(() => usePrescriberDelegate('enc-1'));
    await waitFor(() => expect(result.current.infoState).toBe('ERROR'));
    let auth: unknown = 'unset';
    await act(async () => { auth = await result.current.authorize({ type: 'MEDICATION' } as never); });
    expect(auth).toBeNull();
    expect(result.current.error).toMatch(/확인하지 못했습니다/);
    render(<PrescriberPicker info={null} infoState="ERROR" prescriberId="" onSelect={() => {}} status="IDLE" />);
    expect(screen.getByRole('alert').textContent).toMatch(/저장할 수 없습니다/);
  });

  it('조회 중 저장 → null(확인 중)', async () => {
    get.mockReturnValue(new Promise(() => {}));
    const { usePrescriberDelegate } = await import('@/components/prescription/PrescriberDelegate');
    const { result } = renderHook(() => usePrescriberDelegate('enc-1'));
    expect(result.current.infoState).toBe('LOADING');
    let auth: unknown = 'unset';
    await act(async () => { auth = await result.current.authorize({ type: 'MEDICATION' } as never); });
    expect(auth).toBeNull();
    expect(result.current.error).toMatch(/확인하는 중/);
  });

  it('대조군 — 조회 성공·위임 불요면 {fields:{}} 로 그대로 저장 · 진료 없음(encounterId 없음)도 막지 않는다', async () => {
    get.mockResolvedValue({ data: { enabled: false, allowDelegate: false, delegationRequired: false, prescribers: [] } });
    const { usePrescriberDelegate, PrescriberPicker } = await import('@/components/prescription/PrescriberDelegate');
    const { result } = renderHook(() => usePrescriberDelegate('enc-1'));
    await waitFor(() => expect(result.current.infoState).toBe('OK'));
    let auth: unknown = 'unset';
    await act(async () => { auth = await result.current.authorize({ type: 'MEDICATION' } as never); });
    expect(auth).toEqual({ fields: {} });
    const { container } = render(<PrescriberPicker info={result.current.info} infoState="OK" prescriberId="" onSelect={() => {}} status="IDLE" />);
    expect(container.textContent).toBe('');

    const none = renderHook(() => usePrescriberDelegate(null));
    let auth2: unknown = 'unset';
    await act(async () => { auth2 = await none.result.current.authorize({ type: 'MEDICATION' } as never); });
    expect(auth2).toEqual({ fields: {} });
  });
});
