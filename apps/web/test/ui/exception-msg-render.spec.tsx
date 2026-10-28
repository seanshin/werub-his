import React from 'react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { renderServerMessageKo, serverMsg } from '@hospital-run/shared';
import { apiClient, ApiError } from '../../src/lib/api-client';
import { extractErrorMessage } from '../../src/lib/error-utils';
import { QueryErrorFallback } from '../../src/components/ui/QueryErrorFallback';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';

/**
 * 🔴 서버 예외 문장 `{ k, params }` 렌더 — 예외 배치 (2026-09-15 I4).
 *
 * 서버가 조립한 예외 message(`PTA 우측: 120 초과는 입력할 수 없습니다`)는 영어 화면에서도 한국어였고,
 * `QueryErrorFallback` 의 `<T k={message}>` 는 값이 녹은 문장이라 키가 매번 달라 **영영 번역되지 않았다**.
 * 이제 서버 예외가 `error.msg` 를 싣고(`msgException`), `ApiError.msg` → 카탈로그 조립.
 *
 * 지키는 사실:
 *   ① `apiClient` 가 응답의 `error.msg` 를 `ApiError.msg` 로 옮긴다 · 모양이 아니면 버린다 · msg 없으면 undefined(대조군).
 *   ② `extractErrorMessage` — en 한국어 0(값은 그대로) · ko 는 서버 message 와 글자 단위 동일 · msg 없는 오류는 종전 message(대조군).
 *   ③ `QueryErrorFallback`(`extractErrorMessage` 경유 — 문장 정본 하나) — msg 가 있으면 en 에서 한국어 0 · EN× 0 / msg 없으면 종전 원문(대조군).
 *   ④ 화면 배선 — `/admin/opening` 기관 항목 변이·기초검사 워크스테이션 오류 토스트가 `extractErrorMessage` 를 지난다.
 */

const ROOT = resolve(__dirname, '../..');
const MSG = serverMsg('{항목}: {최대} 초과는 입력할 수 없습니다', { 항목: 'PTA 우측', 최대: 120 });
const MSG_PIPE = serverMsg('{파라미터} 는 YYYY-MM-DD 형식이어야 합니다 (받은 값: {값})', { 파라미터: 'from', 값: 'NOTADATE' });
const KO = renderServerMessageKo(MSG);

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status,
    json: async () => body,
    clone() { return this; },
  }));
}

async function errOf(p: Promise<unknown>): Promise<ApiError> {
  try { await p; } catch (e) { return e as ApiError; }
  throw new Error('오류가 나지 않았다');
}

beforeEach(() => useUiLocaleStore.setState({ locale: 'ko' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('① apiClient — error.msg → ApiError.msg', () => {
  it('🔴 msg 가 실린 오류 응답 → ApiError.msg · message/code/details 는 종전 그대로', async () => {
    mockFetchOnce(400, { error: { code: 'Bad Request', message: KO, details: KO, msg: MSG }, meta: {} });
    const err = await errOf(apiClient.get('/api/v1/x'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.msg).toEqual(MSG);
    expect(err.message).toBe(KO);
    expect(err.code).toBe('Bad Request');
    expect(err.details).toBe(KO);
  });

  it('대조군 — msg 없는 응답 → msg undefined · 모양이 아닌 msg 도 버린다', async () => {
    mockFetchOnce(400, { error: { code: 'Bad Request', message: '항목 이름이 필요합니다' }, meta: {} });
    const a = await errOf(apiClient.get('/api/v1/x'));
    expect(a.msg).toBeUndefined();
    expect(a.message).toBe('항목 이름이 필요합니다');
    mockFetchOnce(400, { error: { code: 'Bad Request', message: 'x', msg: 'not-a-message' }, meta: {} });
    const b = await errOf(apiClient.get('/api/v1/x'));
    expect(b.msg).toBeUndefined();
  });
});

describe('② extractErrorMessage — 화면 언어로 조립', () => {
  it('🔴 en — 한국어 문장 틀이 번역되고 값은 그대로(스토어 현재 언어)', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const text = extractErrorMessage(new ApiError('Bad Request', KO, KO, MSG_PIPE));
    expect(text).not.toMatch(/[가-힣]/);
    expect(text).toContain('from');
    expect(text).toContain('NOTADATE');
  });

  it('en — 값에 든 데이터(측정 항목 이름)는 번역하지 않는다 · 문장 틀만 바뀐다', () => {
    const text = extractErrorMessage(new ApiError('Bad Request', KO, KO, MSG), 'en');
    expect(text).toBe('PTA 우측: values above 120 cannot be entered');
  });

  it('ko — 서버 message 와 글자 단위 동일(한국어 화면 불변)', () => {
    expect(extractErrorMessage(new ApiError('Bad Request', KO, KO, MSG))).toBe(KO);
  });

  it('대조군 — msg 없는 오류는 en 에서도 종전 message 그대로(지어내지 않는다)', () => {
    expect(extractErrorMessage(new ApiError('Bad Request', '항목 이름이 필요합니다'), 'en')).toBe('항목 이름이 필요합니다');
  });
});

describe('③ QueryErrorFallback — msg 를 화면 언어로(extractErrorMessage 경유)', () => {
  it('🔴 en — 한국어 0 · EN× 0(full·compact)', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    for (const size of ['full', 'compact'] as const) {
      const { container } = render(<QueryErrorFallback error={new ApiError('Bad Request', KO, KO, MSG_PIPE)} onRetry={() => {}} size={size} />);
      expect(container.textContent, size).not.toMatch(/[가-힣]/);
      expect(container.textContent, size).not.toMatch(/EN×/);
      expect(container.textContent, size).toContain('NOTADATE');
      cleanup();
    }
  });

  it('ko — 서버 message 그대로', () => {
    const { container } = render(<QueryErrorFallback error={new ApiError('Bad Request', KO, KO, MSG)} />);
    expect(container.textContent).toContain(KO);
  });

  it('대조군 — msg 없는 오류는 종전 원문(서버 문장)을 그린다', () => {
    const { container } = render(<QueryErrorFallback error={new ApiError('Bad Request', '항목 이름이 필요합니다')} />);
    expect(container.textContent).toContain('항목 이름이 필요합니다');
  });
});

describe('④ 화면 배선', () => {
  const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  it('/admin/opening — 변이 오류 토스트가 e.message 원문을 직접 그리지 않는다', () => {
    const s = src('src/app/(main)/admin/opening/page.tsx');
    expect(s).not.toMatch(/toast\.error\(\s*e\.message\s*\)/);
    expect(s).not.toMatch(/e instanceof Error \? e\.message/);
    expect((s.match(/extractErrorMessage\(e\)/g) ?? []).length).toBe(7);
  });

  it('기초검사 워크스테이션 — errText 가 ApiError 를 extractErrorMessage 로', () => {
    const s = src('src/app/(main)/workstation/diagnostic/page.tsx');
    const fn = s.slice(s.indexOf('function errText('), s.indexOf('function errText(') + 400);
    expect(fn).toMatch(/e instanceof ApiError \? extractErrorMessage\(e\)/);
  });
});
