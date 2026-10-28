import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * 🔴 **마스터 영문명이 있는데 화면이 안 쓰던 자리**(2026-09-10 운영 실측).
 *
 * 화면 언어를 English 로 둬도 진료과가 전부 한국어였다. 데이터 공백이 아니라 **배선 공백**이었다 —
 * `GET /api/v1/codes/departments` 는 36건 전건에 `nameEn` 을 갖고 있었다.
 *
 * 이 스펙이 지키는 사실:
 *   ① ko 화면은 **글자가 하나도 바뀌지 않는다**(그리고 조회를 부르지도 않는다)
 *   ② en 은 **마스터 영문명**을 쓴다(카탈로그에 복제하지 않는다 — 정본은 마스터다)
 *   ③ 마스터에 없는 이름은 **지어내지 않는다** — 원문 그대로 + 그 사실을 남긴다
 *   ④ 조회 실패를 "영문명 없음"으로 번역하지 않는다(다른 사실이다)
 *   ⑤ ja·ar 은 마스터에 그 언어 이름이 없다 — **영문으로 대신 채우지 않는다**
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (p: string) => get(p), post: vi.fn(), put: vi.fn(), del: vi.fn(), getToken: () => 't' },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { DeptName, useDepartmentNames } from '../../src/lib/master-display-name';

/**
 * 🔴 조회가 **끝났는지**를 화면 표식으로 판정하면 안 된다 — 폴백 표식은 데이터가 오기 **전에도**
 *    떠 있어서, 재주입한 결함이 그 틈에 통과했다(2026-09-10 실측). 훅의 로딩 상태로 판정한다.
 */
function Probe({ ko }: { ko: string }) {
  const { nameOf, isLoading } = useDepartmentNames();
  return <span data-loading={isLoading ? 'yes' : 'no'}>{nameOf(ko)}</span>;
}
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';

const MASTER = { data: [{ code: 'IM', nameKo: '내과', nameEn: 'Internal Medicine' }, { code: 'GS', nameKo: '외과', nameEn: 'General Surgery' }] };

function view(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('🔴 마스터 표시명 — 진료과 영문명을 화면이 실제로 쓴다', () => {
  beforeEach(() => {
    get.mockReset();
    useUiLocaleStore.setState({ locale: 'ko' });
  });

  it('① ko 는 원문 그대로이고 조회하지도 않는다', async () => {
    get.mockResolvedValue(MASTER);
    view(<DeptName ko="내과" />);
    expect(screen.getByText('내과')).toBeTruthy();
    expect(get, 'ko 인데 마스터를 조회했다 — 필요 없는 호출이다').not.toHaveBeenCalled();
  });

  it('② en 은 마스터 영문명을 쓴다', async () => {
    useUiLocaleStore.setState({ locale: 'en' });
    get.mockResolvedValue(MASTER);
    view(<DeptName ko="내과" />);
    await waitFor(() => expect(screen.getByText('Internal Medicine')).toBeTruthy());
  });

  it('③ 마스터에 없는 이름은 지어내지 않는다 — 원문 + 그 사실', async () => {
    useUiLocaleStore.setState({ locale: 'en' });
    get.mockResolvedValue(MASTER);
    const { container } = view(<DeptName ko="한방내과" />);
    // 🔴 `toContain` 은 약하다 — `Dept 한방내과` 처럼 **앞에 지어낸 말을 붙여도** 통과한다(재주입에서 적발).
    //    정확히 원문이어야 한다.
    await waitFor(() => {
      const el = container.querySelector('[data-master-name-fallback]');
      expect(el?.getAttribute('data-master-name-fallback'), '원문으로 떨어진 사실이 남지 않았다').toBe('NO_MASTER_NAME');
    });
    expect(container.textContent, '마스터에 없는 이름에 무언가를 지어 붙였다').toBe('한방내과');
  });

  it('④ 조회 실패를 "영문명 없음"으로 번역하지 않는다', async () => {
    useUiLocaleStore.setState({ locale: 'en' });
    get.mockRejectedValue(new Error('boom'));
    const { container } = view(<DeptName ko="내과" />);
    await waitFor(() => {
      expect(container.querySelector('[data-master-name-fallback]')?.getAttribute('data-master-name-fallback')).toBe('FETCH_FAILED');
    });
    expect(container.textContent, '실패했는데 화면이 값을 지어냈다').toContain('내과');
  });

  it('⑤ ja 는 영문으로 대신 채우지 않는다 — 다른 언어를 그 언어인 척하지 않는다', async () => {
    useUiLocaleStore.setState({ locale: 'ja' });
    get.mockResolvedValue(MASTER);
    const { container } = view(<Probe ko="내과" />);
    // 조회가 끝난 뒤에 판정한다(로딩이 끝났다는 사실을 훅에서 직접 받는다)
    await waitFor(() => {
      expect(container.querySelector('[data-loading]')?.getAttribute('data-loading')).toBe('no');
    });
    expect(get, 'ja 인데 마스터를 조회하지 않았다 — 이 검사가 헛돈다').toHaveBeenCalled();
    expect(container.textContent, 'ja 인데 영문명이 나왔다').toBe('내과');
  });

  it('🔴 ⑥ 대조군 — 화면(통합 상황판)이 이 부품을 실제로 쓴다(만들어만 두지 않는다)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'command-center', 'page.tsx'), 'utf8');
    expect(src, '통합 상황판이 DeptName 을 쓰지 않는다 — 만든 것과 쓰는 것은 다른 일이다').toContain('<DeptName');
    // 합친 문자열로 되돌아가면 진료과를 번역할 수 없다
    expect(src, 'dept·place 를 다시 합쳐 그리고 있다').not.toMatch(/\{d\.where\s*\?/);
  });
});
