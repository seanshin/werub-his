import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 가드 — 질 지표 **측정값 입력 화면** (2026-08-18 신설)
 *
 * 🔴 원 결함: `POST /api/v1/quality/measurements` 는 API 만 있고 **부르는 화면이 web·mobile 어디에도
 *    없었다**(전수 grep). 지표를 등재해도 측정값을 넣을 방법이 없었고, `GET /quality/measurements/:id`
 *    로 쌓인 이력도 화면에서 볼 수 없었다 — "EP 를 만들면 부르는 화면까지가 한 벌".
 *
 * 이 가드가 지키는 사실(각 항목은 **결함을 재주입하면 실패한다**) —
 *   1. 적용 **배율·단위**를 화면이 밝힌다 — 같은 분자/분모라도 배율이 다르면 값이 달라진다.
 *      (배율 표기를 지우면 실패)
 *   2. 배율이 **가정**이면 가정이라고 말한다 — '등재'처럼 보이지 않는다.
 *   3. **분모 0 은 저장을 시도조차 하지 않는다** — 표본 부재는 값 0 이 아니다.
 *      (분모 0 허용으로 되돌리면 실패)
 *   4. 방향 미등재 지표는 저장되지만 **'판정 불가'** 로 표시한다 — '달성'으로 접지 않는다.
 *      (판정 불가를 '달성'으로 표시하면 실패)
 *   5. **저장 실패를 성공으로 말하지 않는다.**
 *   6. 이력의 판정은 **읽는 시점 재판정**이며, 저장값과 갈리면 그 사실을 드러낸다.
 *      (storedMeetTarget 을 그대로 그리면 실패)
 */

// vi.mock 은 파일 최상단으로 끌어올려지므로 팩토리가 참조하는 스파이는 vi.hoisted 로 함께 올린다.
const { get, post, patchFn, toastSuccess, toastError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patchFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (path: string, params?: unknown) => get(path, params),
    post: (path: string, body?: unknown) => post(path, body),
    patch: (path: string, body?: unknown) => patchFn(path, body),
    del: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@/stores/toast-store', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: 'ADMIN' } }),
}));

import QualityPage from '../../src/app/(main)/quality/page';

const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

/** 서버(`/quality/dashboard`)가 정책 해석까지 마쳐 내려주는 형태 그대로. */
const FALL = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '낙상 발생률',
  category: '환자안전',
  formula: '(낙상 발생 건수 / 재원일수) × 1000',
  unit: '건/1000 재원일수',
  direction: 'LOWER_IS_BETTER',
  directionSource: 'REGISTRY',
  directionConflict: false,
  registeredDirection: null,
  registeredUnit: null,
  registeredValueScale: null,
  valueScale: 1000,
  valueScaleKnown: true,
  valueScaleSource: 'FORMULA',
  targetValue: 1.5,
  latestValue: 1.2,
  latestPeriod: '2026-07',
  meetTarget: true,
  undeterminedReason: null,
  achievementPercent: 100,
};

/** 🔴 방향·단위·배율이 하나도 등재되지 않은 신규 지표 — 배율은 '가정'이다. */
const NEW_IDX = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '신규 지표 XYZ',
  category: '기타',
  formula: '분자 대비 분모',
  unit: null,
  direction: null,
  directionSource: null,
  directionConflict: false,
  registeredDirection: null,
  registeredUnit: null,
  registeredValueScale: null,
  valueScale: 100,
  valueScaleKnown: false,
  valueScaleSource: 'ASSUMED',
  targetValue: 50,
  latestValue: null,
  latestPeriod: null,
  meetTarget: null,
  undeterminedReason: 'NO_VALUE',
  achievementPercent: null,
};

/**
 * 🔴 저장 당시 판정(`storedMeetTarget`)과 읽는 시점 재판정(`meetTarget`)이 갈린 행.
 *    옛 규칙("전 지표 높을수록 좋음")으로 true 가 박혀 있으나, 낙상은 목표(1.5)를 넘었으므로 미달이다.
 */
const DIVERGED_ROW = {
  id: 'm-1',
  period: '2026-06',
  numerator: 3,
  denominator: 1000,
  value: 3,
  unit: '건/1000 재원일수',
  direction: 'LOWER_IS_BETTER',
  valueScale: 1000,
  valueScaleKnown: true,
  valueScaleSource: 'FORMULA',
  target: 1.5,
  meetTarget: false,
  storedMeetTarget: true,
  storedDiverges: true,
  undetermined: false,
  undeterminedReason: null,
  measuredAt: '2026-07-01T00:10:00.000Z',
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patchFn.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  get.mockImplementation((path: string) => {
    if (path.includes('/quality/dashboard')) return Promise.resolve({ data: [FALL, NEW_IDX] });
    if (path.includes(`/quality/measurements/${FALL.id}`)) return Promise.resolve({ data: [DIVERGED_ROW] });
    if (path.includes('/quality/measurements/')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] }); // /config?category=ui 등
  });
});

/**
 * 지표 행의 [측정] 버튼을 눌러 패널을 연다.
 * (지표명은 표 밖 '방향 미등재' 안내 배너에도 나오므로 **표 행 안의** 것만 고른다.)
 */
async function openPanel(name: string) {
  render(withQuery(<QualityPage />));
  const hits = await screen.findAllByText(name);
  const cell = hits.find((el) => el.closest('td'));
  expect(cell, `표에서 지표 행을 찾지 못함: ${name}`).toBeTruthy();
  const row = cell!.closest('tr') as HTMLTableRowElement;
  fireEvent.click(within(row).getByRole('button', { name: '측정' }));
  return row;
}

describe('질 지표 측정값 입력 화면', () => {
  it('🔴 EP 를 부르는 화면이 존재한다 — 측정 이력 EP 를 실제로 호출한다', async () => {
    await openPanel('낙상 발생률');
    await waitFor(() =>
      expect(get.mock.calls.some((c) => String(c[0]).includes(`/quality/measurements/${FALL.id}`))).toBe(true),
    );
  });

  it('🔴 적용 배율과 단위를 화면이 밝힌다 (배율 표기를 지우면 실패)', async () => {
    await openPanel('낙상 발생률');
    const panel = await screen.findByTestId(`qi-panel-${FALL.id}`);
    expect(within(panel).getByTestId('qi-scale').textContent).toBe('×1000');
    expect(within(panel).getByTestId('qi-unit').textContent).toBe('건/1000 재원일수');
  });

  it('🔴 계산 미리보기가 배율을 반영한다 — 3/1000 은 ×1000 이면 3 이다(×100 이면 0.3)', async () => {
    await openPanel('낙상 발생률');
    const panel = await screen.findByTestId(`qi-panel-${FALL.id}`);
    fireEvent.change(within(panel).getByLabelText('분자'), { target: { value: '3' } });
    fireEvent.change(within(panel).getByLabelText('분모'), { target: { value: '1000' } });
    const preview = within(panel).getByTestId('qi-preview');
    expect(preview.textContent).toContain('3 / 1000 × 1000 = 3');
    expect(preview.textContent).toContain('건/1000 재원일수');
  });

  it('🔴 배율이 가정이면 가정이라고 말한다 — 단위 미상은 %로 지어내지 않는다', async () => {
    await openPanel('신규 지표 XYZ');
    const panel = await screen.findByTestId(`qi-panel-${NEW_IDX.id}`);
    expect(panel.textContent).toContain('(가정)');
    expect(within(panel).getByTestId('qi-unit').textContent).toBe('단위 미등재');
    expect(panel.textContent).toContain('백분율(×100)로 가정');
  });

  it('🔴 분모 0 은 저장을 시도조차 하지 않는다 (분모 0 을 허용하면 실패)', async () => {
    await openPanel('낙상 발생률');
    const panel = await screen.findByTestId(`qi-panel-${FALL.id}`);
    fireEvent.change(within(panel).getByLabelText('분자'), { target: { value: '3' } });
    fireEvent.change(within(panel).getByLabelText('분모'), { target: { value: '0' } });

    expect(within(panel).getByTestId('qi-preview').textContent).toContain('산출 불가');
    const submit = within(panel).getByTestId('qi-measure-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(submit);
    await new Promise((r) => setTimeout(r, 0));
    expect(post).not.toHaveBeenCalled();
  });

  it('방향 미등재 지표도 저장은 된다 — 그리고 🔴 "판정 불가"로 표시한다(달성으로 접지 않는다)', async () => {
    post.mockResolvedValue({
      data: {
        id: 'm-new', period: '2026-08', numerator: 4, denominator: 8, value: 50,
        unit: null, direction: null, directionSource: null,
        valueScale: 100, valueScaleKnown: false, valueScaleSource: 'ASSUMED',
        target: 50, meetTarget: null, undetermined: true,
        undeterminedReason: 'DIRECTION_NOT_REGISTERED',
      },
    });
    await openPanel('신규 지표 XYZ');
    const panel = await screen.findByTestId(`qi-panel-${NEW_IDX.id}`);
    fireEvent.change(within(panel).getByLabelText('측정기간'), { target: { value: '2026-08' } });
    fireEvent.change(within(panel).getByLabelText('분자'), { target: { value: '4' } });
    fireEvent.change(within(panel).getByLabelText('분모'), { target: { value: '8' } });
    fireEvent.click(within(panel).getByTestId('qi-measure-submit'));

    const result = await screen.findByTestId('qi-save-result');
    expect(post).toHaveBeenCalledWith('/api/v1/quality/measurements', {
      indicatorId: NEW_IDX.id, period: '2026-08', numerator: 4, denominator: 8,
    });
    expect(result.textContent).toContain('판정 불가');
    expect(result.textContent).toContain('지표 방향');
    // 🔴 '판정 불가'를 달성/미달로 접지 않는다(사유 문구의 '달성 판정 불가' 는 판정 배지가 아니다)
    expect(result.textContent).not.toContain('✓ 달성');
    expect(result.textContent).not.toContain('✗ 미달');
    // 어디서 등재하는지 안내한다
    expect(panel.textContent).toContain('[정의]');
  });

  it('🔴 저장 실패를 성공으로 말하지 않는다', async () => {
    post.mockRejectedValue({ message: '분모가 0 입니다 — 측정값을 산출할 수 없습니다' });
    await openPanel('낙상 발생률');
    const panel = await screen.findByTestId(`qi-panel-${FALL.id}`);
    fireEvent.change(within(panel).getByLabelText('분자'), { target: { value: '3' } });
    fireEvent.change(within(panel).getByLabelText('분모'), { target: { value: '1000' } });
    fireEvent.click(within(panel).getByTestId('qi-measure-submit'));

    const err = await screen.findByTestId('qi-save-error');
    expect(err.textContent).toContain('저장하지 못했습니다');
    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByTestId('qi-save-result')).toBeNull();
    // 입력값을 지우지 않는다
    expect((within(panel).getByLabelText('분자') as HTMLInputElement).value).toBe('3');
  });

  it('🔴 이력 판정은 읽는 시점 재판정이고, 저장값과 갈리면 드러낸다 (storedMeetTarget 을 그리면 실패)', async () => {
    await openPanel('낙상 발생률');
    const rows = await screen.findByTestId('qi-history-rows');
    const row = within(rows).getByText('2026-06').closest('tr') as HTMLTableRowElement;
    // 저장값은 true(달성)였지만 정본 재판정은 미달이다
    expect(within(row).getByText('✗ 미달')).toBeTruthy();
    expect(within(row).queryByText('✓ 달성')).toBeNull();
    expect(within(row).getByTestId('qi-stored-diverges').textContent).toContain('저장값 ✓ 달성 ≠ 재판정');
  });

  it('이력은 최근 12건까지임을 밝힌다(자르면 잘랐다고 말한다)', async () => {
    await openPanel('낙상 발생률');
    const panel = await screen.findByTestId(`qi-panel-${FALL.id}`);
    expect(panel.textContent).toContain('최근 12건까지 표시');
  });
});

/**
 * 🔴 정정·무효화 계약 가드 — 이연 회수 T2-14(2026-08-18).
 *
 * 종전에는 오기를 고칠 방법이 없었고, 같은 기간을 다시 넣으면 별도 행으로 쌓였다.
 * 화면 문구도 "덮어쓰지 않고 별도 행으로 추가됩니다"라고 안내하고 있었다 —
 * 유니크 제약이 생긴 지금 그 문구는 **더 이상 사실이 아니다**.
 */
describe('측정값 정정·무효화', () => {
  const RAW = readFileSync(
    join(process.cwd(), 'src/app/(main)/quality/MeasurementPanel.tsx'),
    'utf8',
  );
  // 🔴 주석은 옛 동작을 **설명**할 수 있다 — 화면이 실제로 말하는 것만 본다
  //    (다른 가드가 이 함정에 두 번 걸렸다: 주석 속 문자열이 단언을 통과시킨다)
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔴 중복 기간 안내가 "별도 행으로 추가"라고 말하지 않는다', () => {
    expect(SRC).not.toContain('별도 행');
    expect(SRC).toContain('거절');
  });

  it('정정은 서버 정정 EP 를 부른다', () => {
    expect(SRC).toMatch(/apiClient\.patch\(`\/api\/v1\/quality\/measurements\/\$\{id\}`/);
  });

  it('🔴 무효화는 삭제가 아니라 무효화 EP 를 부르고 사유를 함께 보낸다', () => {
    expect(SRC).toMatch(/measurements\/\$\{id\}\/void/);
    expect(SRC).toContain('reason');
    expect(SRC, '하드 삭제 경로를 만들지 않는다').not.toMatch(/apiClient\.delete\(`\/api\/v1\/quality\/measurements/);
  });

  it('사유 없이 무효화 버튼이 눌리지 않는다', () => {
    // 🔴 계약은 "공백만으로는 무효화되지 않는다"이지 `.trim()` 이라는 **철자**가 아니다.
    //    2026-08-24 이 자리가 사유 입력 공통 부품(`reasonFilled`)으로 옮겨가면서 이 단언이
    //    구현 문자열을 못박고 있었다는 것이 드러났다(가드가 오라클을 계약으로 못박은 사례).
    //    두 표현 다 허용하되 **게이트가 사라지면 여전히 실패한다.**
    expect(SRC).toMatch(/voidReason\.trim\(\) === ''|!reasonFilled\(voidReason\)/);
    expect(SRC, '무효화 버튼의 disabled 가 사유를 보지 않는다').toMatch(
      /disabled=\{voidMut\.isPending \|\| (?:voidReason\.trim\(\) === ''|!reasonFilled\(voidReason\))\}/,
    );
  });

  it('정정 폼도 분모 0 을 막는다', () => {
    expect(SRC).toMatch(/Number\(correctDen\) > 0/);
  });
});
