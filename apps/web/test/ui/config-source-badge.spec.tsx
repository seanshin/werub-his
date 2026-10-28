import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { CONFIG_SEEDED_TEXT, CONFIG_SOURCE_TEXT, CONFIG_UNREGISTERED_TEXT } from '@hospital-run/shared';

/**
 * 🔴 **화면이 "설정됨"과 "기본값"을 갈라 말하는가** — 소스 문자열이 아니라 **그려진 것**으로 본다.
 *
 * 서버가 `source` 를 내려주기 시작해도(api `config-source-honesty.spec.ts`) 화면이 그리지 않으면
 * 아무것도 달라지지 않는다. 이 저장소가 v4.18.0 에서 겪은 것이 정확히 그것이다
 * (검수 원장·EP 를 다 만들고 **승인분을 화면에 얹는 한 줄이 없었다**).
 *
 * 재주입 역검증: 배지를 지우거나, `source` 를 무시하고 한 가지로 그리거나,
 * `source` 없는 행(구버전 응답)을 '설정됨'으로 그리면 각각 실패한다.
 */

const rows = [
  { key: 'a.stored', value: 'V', category: 'general', description: '사람이 정한 값', source: 'db', registered: true },
  { key: 'b.fallback', value: 10, category: 'general', description: '아무도 정한 적 없음', source: 'default', registered: true },
  { key: 'c.orphan', value: 1, category: 'general', description: '시드 잔재', source: 'db', registered: false },
  { key: 'd.unknown', value: null, category: 'general', description: '출처 미상(구버전 응답)' },
  // 2026-10-27 개발 시드 행 — 출처 db 지만 원내가 정한 값이 아니다
  { key: 'e.seeded', value: 120, category: 'nursing', description: '시드 값', source: 'db', registered: true, seeded: true },
];

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: async () => ({ data: rows }), getToken: () => 't' },
  ApiError: class ApiError extends Error {},
}));

const wrap = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('/admin/config — 값의 출처를 화면이 말한다', () => {
  it('저장된 값·기본값·미등재·출처 미상을 각각 다르게 그린다', async () => {
    const { default: ConfigPage } = await import('../../src/app/(main)/admin/config/page');
    const { container } = wrap(<ConfigPage />);
    await screen.findByText('a.stored');

    const cellOf = (key: string) =>
      [...container.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(key))!.children[2] as HTMLElement;

    expect(cellOf('a.stored').textContent).toContain(CONFIG_SOURCE_TEXT.db);
    // 🔴 기본값을 "설정됨"으로 그리면 아무도 정한 적 없는 값이 결정처럼 보인다
    expect(cellOf('b.fallback').textContent).toContain(CONFIG_SOURCE_TEXT.default);
    expect(cellOf('b.fallback').textContent).not.toContain(CONFIG_SOURCE_TEXT.db);
    // 미등재는 DB 행이 있으니 '설정됨' 이면서 동시에 '미등재' 다(둘 다 사실)
    expect(cellOf('c.orphan').textContent).toContain(CONFIG_UNREGISTERED_TEXT);
    // 🔴 서버가 출처를 말하지 않으면 지어내지 않는다
    const unknown = cellOf('d.unknown').textContent ?? '';
    expect(unknown).not.toContain(CONFIG_SOURCE_TEXT.db);
    expect(unknown).not.toContain(CONFIG_SOURCE_TEXT.default);
  });

  it('출처 배지에 "그래서 뭐"가 붙는다 — 배지만으로는 아무도 움직이지 않는다', async () => {
    const { default: ConfigPage } = await import('../../src/app/(main)/admin/config/page');
    const { container } = wrap(<ConfigPage />);
    await screen.findByText('b.fallback');
    const badge = [...container.querySelectorAll('tbody tr')]
      .find((tr) => tr.textContent?.includes('b.fallback'))!
      .querySelector('[title]') as HTMLElement;
    expect(badge?.getAttribute('title')?.length ?? 0).toBeGreaterThan(10);
  });

  it('🔴 개발 시드 행은 "개발 시드" 배지 — 사람이 정한 행에는 없다', async () => {
    const { default: ConfigPage } = await import('../../src/app/(main)/admin/config/page');
    const { container } = wrap(<ConfigPage />);
    await screen.findByText('e.seeded');
    expect(container.querySelector('[data-config-seeded="e.seeded"]')!.textContent).toContain(CONFIG_SEEDED_TEXT);
    expect(container.querySelector('[data-config-seeded="a.stored"]')).toBeNull();
  });

  it('🔴 편집 화면(/admin/ai-settings)도 시드 행에 배지 — 서버가 실은 seeded 로만', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'src/app/(main)/admin/ai-settings/page.tsx'), 'utf8');
    expect(src).toMatch(/\{config\.seeded && \(\s*<span[^>]*data-config-seeded=\{config\.key\}><T k=\{CONFIG_SEEDED_TEXT\} \/><\/span>/);
  });

  it('🔴 QI 결정 현황 — 시드 행을 "관리자 직접 변경"으로 그리지 않는다(출처 SEED 문구)', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'src/app/(main)/quality/QiFlowOps.tsx'), 'utf8');
    expect(src).toMatch(/r\.provenance\.by === 'SEED'\s*\?\s*<T k="개발 시드 — 위원회 의결 아님" \/>/);
  });
});

