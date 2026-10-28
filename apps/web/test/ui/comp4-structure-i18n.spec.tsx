import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';
import { useAuthStore } from '../../src/stores/auth-store';

/**
 * 🔴 §12-C 구조 회수 (2026-09-11 · 카탈로그 `comp4`) — "배선으로는 못 고치는 것"이던 두 자리.
 *
 *  - `HisModePanel`: 안내문이 `<b>`·`<code>`·변수 사이로 **16조각** 나 있어 어떤 언어에서도 문장이 성립하지 않았다
 *    (admin8 가 "조각째로 뺐다"고 적어 둔 자리). 노드 자리표시자(`<Tf>` §12-H-2)로 **한 문장 한 키** 4개가 됐다.
 *  - `NurseOnlyGuard`: 조각 2문장 + 역할명이 `DOCTOR ? '의사' : user.role` 하드코딩이라 의사 외 13역할은
 *    **어떤 언어에서도 'PHARMACIST' 같은 코드값**이 떴다 → 역할명 정본 `USER_ROLE_LABEL`.
 *
 * 지키는 사실: ① ko 는 종전 문장과 글자 단위로 같다(역할명만 코드값 → 한국어 라벨로 고쳐짐)
 *              ② en 에서 한국어가 남지 않는다(코드값·명령어 제외) ③ 강조(`<b>`·`<code>`)가 살아 있다.
 */
vi.mock('../../src/lib/his-mode', () => ({
  useHisMode: () => ({ build: 'REHEARSAL', runtime: 'DEV', effective: 'REHEARSAL', runtimeEffective: false, runtimeUnknown: false }),
}));
vi.mock('@tanstack/react-query', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const { HisModePanel } = await import('../../src/components/admin/HisModePanel');
const { NurseOnlyGuard } = await import('../../src/components/nursing/NurseOnlyGuard');

beforeEach(() => useUiLocaleStore.setState({ locale: 'ko' }));
afterEach(() => cleanup());

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('HisModePanel — 16조각 → 한 문장 한 키', () => {
  it('① ko 문단이 종전 문장과 같다(강조·코드 유지)', () => {
    const { container } = render(<HisModePanel />);
    const text = norm(container.textContent);
    expect(text).toContain('모드는 두 층이다. 빌드 상한(REHEARSAL)은 이 배포본에 무엇이 들어 있는지를 정하고 재배포로만 바뀐다 (deploy.sh --mode rehearsal). 아래 버튼은 런타임 토글이며 더 좁히기만 한다 — 리얼 빌드에는 시드 로그인 모듈이 아예 없어 런타임으로 되살아나지 않는다.');
    expect(text).toContain('저장된 런타임 값(DEV)이 빌드 상한(REHEARSAL)보다 넓어 적용되지 않았다. 실효 모드는 REHEARSAL 다.');
    expect([...container.querySelectorAll('b')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['두 층', '들어 있는지', '더 좁히기만', '적용되지 않았다']));
    expect(container.querySelector('code')?.textContent).toBe('REHEARSAL');
  });

  it('② en — 안내문 두 문단에 한국어가 남지 않는다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<HisModePanel />);
    const paras = [...container.querySelectorAll('p')].map((p) => norm(p.textContent));
    const guide = paras.find((p) => p.includes('deploy.sh --mode rehearsal'));
    const warn = paras.find((p) => p.includes('effective mode'));
    expect(guide, '안내 문단을 못 찾았다').toBeTruthy();
    expect(guide).not.toMatch(/[가-힣]/);
    expect(warn, '미적용 경고 문단을 못 찾았다').toBeTruthy();
    expect(warn).not.toMatch(/[가-힣]/);
  });
});

describe('NurseOnlyGuard — 조각 2문장 · 역할명 정본', () => {
  const asRole = (role: string) => useAuthStore.setState({ user: { id: 'u1', role, email: 'x@y', name: 'x' } as never });

  it('① ko — 약사 계정이면 "약사"(종전엔 코드값 PHARMACIST 가 떴다)', () => {
    asRole('PHARMACIST');
    const { container } = render(<NurseOnlyGuard><div>편집</div></NurseOnlyGuard>);
    const text = norm(container.textContent);
    expect(text).toContain('이 페이지는 간호사 전용 편집 화면입니다.');
    expect(text).toContain('현재 약사 계정으로 로그인되어 있어 열람만 가능합니다.');
    expect(text).not.toContain('PHARMACIST');
  });

  it('② en — 역할명까지 번역되고 한국어가 남지 않는다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    asRole('DOCTOR');
    const { container } = render(<NurseOnlyGuard><div>x</div></NurseOnlyGuard>);
    const ps = [...container.querySelectorAll('p')].map((p) => norm(p.textContent));
    for (const p of ps) expect(p).not.toMatch(/[가-힣]/);
    expect(ps.join(' ')).not.toContain('DOCTOR');
  });

  it('대조군 — 간호사는 편집 UI 를 그대로 받는다(가드가 막지 않는다)', () => {
    asRole('NURSE');
    const { container } = render(<NurseOnlyGuard><div>편집 화면 본체</div></NurseOnlyGuard>);
    expect(container.textContent).toBe('편집 화면 본체');
  });
});
