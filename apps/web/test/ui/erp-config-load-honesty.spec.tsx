import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

/**
 * 🔴 **조회 실패를 초기값으로 덮고 저장하면 실제 설정이 날아간다.**
 *
 * `/admin/erp` 는 현재 설정을 `.catch(() => {})` 로 삼키고 있었다. 실패하면 화면은 하드코딩된
 * 초기값(`enabled=true` · `url='/erp'` · `integrationKey=''`)을 **실제 설정인 것처럼** 보여주고,
 * 저장을 누르면 그 일곱 키를 그대로 덮어썼다 — 연동 키까지 빈 문자열로.
 * 같은 모양을 이 저장소가 접근정책 화면에서 이미 겪었다(조회 실패를 초기값으로 덮고 저장 → 실 ACL 파괴).
 *
 * 그리고 성공했을 때는 **"설정돼 있다"와 "아무도 정한 적 없다"를 갈라 말해야** 한다
 * (이 구분이 없어서 2026-09-09 ERP SSO 진단이 막혔다).
 */

const cfgGet = vi.fn();
const putCalls: string[] = [];
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    // 🔴 목은 **정본의 실제 반환 모양**을 쓴다 — 내가 가정한 모양으로 만들면 화면이 엉뚱하게 터진다
    get: (p: string) => {
      // 🔴 `/config` 로 넓게 잡으면 T 컴포넌트(ui-locale)의 설정 조회까지 함께 거절돼
      //    "무엇이 실패했는지"가 뒤섞인다 — 이 화면이 부르는 그 경로만 겨눈다.
      if (p.includes('/config?category=integration')) return cfgGet(p);
      if (p.includes('/config')) return Promise.resolve({ data: null });
      if (p.includes('/outbox')) return Promise.resolve({ data: { byStatus: {}, byDomain: [], failed: [] } });
      return Promise.resolve({ data: [] });
    },
    post: async () => ({ data: {} }),
    put: async (p: string) => { putCalls.push(p); return { data: {} }; },
    getToken: () => 't',
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrap = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const load = async () => (await import('../../src/app/(main)/admin/erp/page')).default;

// 🔴 `() => cfgGet.mockReset()` 로 쓰지 않는다 — mockReset 이 **목 자신**을 돌려주고
//    vitest 가 그 반환값을 정리 콜백으로 보고 테스트 뒤에 호출한다(= 아무도 안 잡는 거절이 생긴다).
//    한 시간을 여기서 썼다: 화면이 만든 실패인 줄 알았는데 테스트가 만든 실패였다.
beforeEach(() => { cfgGet.mockReset(); putCalls.length = 0; });

describe('/admin/erp — 무엇이 저장돼 있는지 모르는 채로 덮어쓰지 않는다', () => {
  it('🔴 설정 조회가 실패하면 그 사실을 말하고 저장을 막는다', async () => {
    // 호출 시점에 새 거절을 만든다(미리 만들어 두면 아무도 안 잡은 거절로 잡힌다)
    cfgGet.mockImplementation(() => Promise.reject(new Error('boom')));
    const Page = await load();
    wrap(<Page />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent, '실패를 "없음"으로 번역하지 않는다').toContain('덮어씁니다');

    // 🔴 게이트는 **눌러서** 확인한다 — 비활성 버튼만 보면 저장 함수의 게이트가 도는지 알 수 없다
    //    (비활성만 두고 함수 게이트를 지워도 아무 테스트가 실패하지 않던 상태였다).
    const saveBtn = screen.getByRole('button', { name: '저장' });
    expect(saveBtn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(saveBtn);
    await new Promise((r) => setTimeout(r, 0));
    expect(putCalls, '무엇이 저장돼 있는지 모르는 채로 쓰면 실 설정이 날아간다').toEqual([]);
  });

  it('조회에 성공하면 기본값으로 도는 키를 분모와 함께 밝힌다 — 다만 막지 않는다', async () => {
    cfgGet.mockImplementation(async () => ({
      data: [
        { key: 'erp.enabled', value: true, source: 'db' },
        { key: 'erp.url', value: 'https://erp.example', source: 'db' },
        { key: 'erp.ssoPath', value: '/api/v1/auth/sso/his', source: 'default' },
        { key: 'erp.handoff', value: 'token', source: 'default' },
        { key: 'erp.webhookEnabled', value: false, source: 'default' },
        { key: 'erp.webhookUrl', value: '', source: 'default' },
        { key: 'erp.integrationKey', value: '', source: 'default' },
      ],
    }));
    const Page = await load();
    const { container } = wrap(<Page />);

    await waitFor(() => expect(screen.queryByText('불러오는 중...')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();

    const summary = [...container.querySelectorAll('div')].find((d) => d.textContent?.includes('erp.ssoPath · erp.handoff'));
    expect(summary, '기본값으로 도는 키를 밝히지 않으면 아무도 정한 적 없는 값이 결정처럼 보인다').toBeTruthy();
    expect(summary!.textContent).toContain('5 / 7'); // 🔴 분모 병기
    expect(summary!.textContent).not.toContain('erp.enabled'); // 설정된 키를 기본값이라 말하지 않는다

    // 기본값이라고 막지 않는다(CLAUDE.md §4)
    const saveBtn = screen.getByRole('button', { name: '저장' });
    expect(saveBtn.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(saveBtn);
    await waitFor(() => expect(putCalls.length).toBeGreaterThan(0));
  });

  it('🔴 서버가 출처를 말하지 않으면(구버전 응답) 지어내지 않는다 — 요약을 그리지 않는다', async () => {
    cfgGet.mockImplementation(async () => ({ data: [{ key: 'erp.enabled', value: true }, { key: 'erp.url', value: '/erp' }] }));
    const Page = await load();
    const { container } = wrap(<Page />);
    await waitFor(() => expect(screen.queryByText('불러오는 중...')).toBeNull());
    expect(container.textContent).not.toContain('아직 아무도 정한 적 없는 값');
  });
});

describe('출처 어휘는 shared 정본 하나', () => {
  it('화면이 자기 라벨을 지어내지 않는다', async () => {
    const { CONFIG_SOURCE_TEXT } = await import('@hospital-run/shared');
    // 🔴 외부 점검 — 배포 환경변수가 이긴 값을 말할 어휘가 없었다(`env` 추가).
    //    집합 가드는 유지한다 — 화면이 자기 라벨을 지어내는 것을 막는 것이 이 테스트의 목적이다.
    expect(Object.keys(CONFIG_SOURCE_TEXT).sort()).toEqual(['db', 'default', 'env', 'unset']);
  });
});
