import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
// 🔴 주석을 걷어내고 판정한다 — 주석 처리된 호출이 문자열 검사를 통과시킨 사고가 있었다(재주입에서 적발).
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **승인된 검수 번역이 실제로 화면에 나가는가** — 검수 축의 마지막 한 걸음.
 *
 * 원 결함(2026-09-09 실측): 원장(`TranslationOverride`)·EP(`GET /i18n/overrides`)·검수 화면·
 * shared `applyReviewOverlay` 가 **전부 있었는데 아무도 부르지 않았다**(전역 grep 소비처 0).
 * 검수자가 승인해도 어느 화면에도 나가지 않는 상태였다 — 이 저장소가 반복해 겪은
 * "만든 것 ≠ 소비처가 쓰는 것"(CLAUDE.md §2)의 자리다.
 *
 * 여기서 지키는 사실:
 *   ① `(main)` 레이아웃이 부팅 시 오버레이 등록을 **실제로 부른다**(소비처 0 재발 방지)
 *   ② 조회 실패를 **"승인분 0건"으로 번역하지 않는다**(다른 사실이다)
 *   ③ 화면이 그 실패를 말한다(조용한 폴백 금지 — 기획서 §2.2)
 *   ④ 대조군 — 성공하면 성공이라 말한다(성공을 실패로 그리지 않는다)
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (p: string, q?: unknown) => get(p, q),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    getToken: () => 't',
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useHydrateReviewOverlay, useI18nOverlayStore, __resetI18nOverlayStoreForTest } from '../../src/stores/i18n-overlay-store';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';
import { OverlayRuntimeNotice } from '../../src/app/(main)/admin/ui-locale/review/parts';

const WEB_SRC = path.join(__dirname, '..', '..', 'src');
const read = (p: string) => stripComments(fs.readFileSync(path.join(WEB_SRC, p), 'utf8')) as string;

function Boot() {
  useHydrateReviewOverlay();
  return <OverlayRuntimeNotice />;
}

describe('🔴 검수 오버레이 — 부팅 배선(승인분이 화면에 나가는 유일한 경로)', () => {
  beforeEach(() => {
    get.mockReset();
    __resetI18nOverlayStoreForTest();
    useUiLocaleStore.setState({ locale: 'en' });
  });

  it('① `(main)` 레이아웃이 오버레이 등록을 부른다 — 소비처 0 으로 되돌아가지 않는다', () => {
    const layout = read('app/(main)/layout.tsx');
    expect(layout, '레이아웃이 useHydrateReviewOverlay 를 import 하지 않는다').toContain('useHydrateReviewOverlay');
    // import 문만으로 통과하지 않게 **호출**을 따로 확인한다(이 저장소에서 import 만 넣은 커밋이 있었다)
    expect(layout, '`useHydrateReviewOverlay()` 호출이 없다 — import 만으로는 아무 일도 하지 않는다')
      .toMatch(/useHydrateReviewOverlay\(\s*\)/);
  });

  it('①-b 등록 경로는 shared 정본을 쓴다 — FE 가 따로 팩을 조립하지 않는다', () => {
    const store = read('stores/i18n-overlay-store.ts');
    expect(store).toContain('applyReviewOverlay');
    expect(store, 'FE 가 registerLocalePack 을 직접 불러 팩을 지어내면 정본이 둘이 된다')
      .not.toContain('registerLocalePack');
  });

  it('② 조회 실패를 "승인분 0건"으로 번역하지 않는다', async () => {
    get.mockRejectedValueOnce(new Error('boom'));
    render(<Boot />);
    await waitFor(() => {
      expect(useI18nOverlayStore.getState().status).toBe('FAILED');
    });
    const s = useI18nOverlayStore.getState();
    expect(s.error, '실패 사유가 비어 있다 — 무엇이 실패했는지 아무도 모른다').toBeTruthy();
    expect(s.status, '실패가 EMPTY(승인분 0건)로 번역됐다').not.toBe('EMPTY');
  });

  it('③ 화면이 그 실패를 말한다 — 조용한 폴백 금지', async () => {
    get.mockRejectedValueOnce(new Error('boom'));
    render(<Boot />);
    const box = await screen.findByTestId('overlay-runtime-notice');
    await waitFor(() => expect(box.getAttribute('data-overlay-status')).toBe('FAILED'));
    expect(box.textContent ?? '').toMatch(/불러오지 못했습니다|could not be loaded/);
  });

  it('④ 대조군 — 성공하면 성공이라 말한다(성공을 실패로 그리지 않는다)', async () => {
    get.mockResolvedValueOnce({ data: { locale: 'en', status: 'APPROVED', entries: [{ key: '저장', value: 'Save (reviewed)' }], count: 1 } });
    render(<Boot />);
    await waitFor(() => expect(useI18nOverlayStore.getState().status).toBe('APPLIED'));
    expect(useI18nOverlayStore.getState().applied).toBe(1);
    const box = screen.getByTestId('overlay-runtime-notice');
    expect(box.getAttribute('data-overlay-status')).toBe('APPLIED');
  });

  it('④-b 조회 성공·0건은 실패가 아니다 — 다른 사실로 말한다', async () => {
    get.mockResolvedValueOnce({ data: { locale: 'en', status: 'APPROVED', entries: [], count: 0 } });
    render(<Boot />);
    await waitFor(() => expect(useI18nOverlayStore.getState().status).toBe('EMPTY'));
    expect(useI18nOverlayStore.getState().error, '0건인데 실패 사유가 붙었다').toBeNull();
  });

  it('⑤ 한국어는 부르지 않는다 — 그리고 그것을 "실패"라 말하지 않는다', async () => {
    useUiLocaleStore.setState({ locale: 'ko' });
    render(<Boot />);
    await waitFor(() => expect(useI18nOverlayStore.getState().status).toBe('SKIPPED_KO'));
    expect(get, 'ko 인데 오버레이를 조회했다').not.toHaveBeenCalled();
  });

  it('⑥ 응답 모양이 계약과 다르면 0건이 아니라 실패로 말한다', async () => {
    get.mockResolvedValueOnce({ data: { nope: true } });
    render(<Boot />);
    await waitFor(() => expect(useI18nOverlayStore.getState().status).toBe('FAILED'));
  });
});
