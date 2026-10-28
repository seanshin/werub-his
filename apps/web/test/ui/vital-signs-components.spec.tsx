/**
 * 활력징후 표시 부품 정본(2026-10-07).
 *  · 순서 = NEWS2 차트(RR → SpO₂ → BP → HR → 의식 → BT) · 혈압 한 값(`120/80`) · 단위·자릿수는 정본
 *  · 미측정 '—'(0 아님) · 이상 색은 적용 임계로 · 색만이 아니라 글자로도
 *  · 별칭 필드(pulse·temp·o2sat·"120/80")를 정본으로 읽는다 · 타당성 범위 밖은 값을 그대로 두고 "확인 필요"
 *  · 측정 시각 없음·미래를 '방금'으로 말하지 않는다
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: vi.fn(() => new Promise(() => {})), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => cleanup());
const mod = () => import('@/components/vitals/VitalSigns');

describe('VitalSignsStrip', () => {
  it('🔴 표준 순서 · 혈압 한 값 · 체온 소수 1자리 · 미측정 —', async () => {
    const { VitalSignsStrip } = await mod();
    const { container } = render(<VitalSignsStrip vitals={{ heartRate: 72, systolicBp: 120, diastolicBp: 80, temperature: 36.849, spo2: 97, respiratoryRate: 18 }} />, { wrapper: wrap });
    const order = [...container.querySelectorAll('[data-vital]')].map((e) => e.getAttribute('data-vital'));
    expect(order).toEqual(['respiratoryRate', 'spo2', 'bloodPressure', 'heartRate', 'temperature', 'painScore']);
    expect(container.querySelector('[data-vital="bloodPressure"]')!.textContent).toContain('120/80');
    expect(container.querySelector('[data-vital="temperature"]')!.textContent).toBe('36.8℃');
    const pain = container.querySelector('[data-vital="painScore"]')!;
    expect(pain.getAttribute('data-vital-state')).toBe('unmeasured');
    expect(pain.textContent).toBe('—');
  });
  it('🔴 별칭 필드를 정본으로 읽는다(pulse·temp·o2sat·"120/80")', async () => {
    const { VitalSignsStrip } = await mod();
    const { container } = render(<VitalSignsStrip vitals={{ pulse: 88, temp: '37.2', o2sat: 95, bp: '130/85', rr: 20 }} />, { wrapper: wrap });
    expect(container.querySelector('[data-vital="heartRate"]')!.textContent).toContain('88');
    expect(container.querySelector('[data-vital="temperature"]')!.textContent).toBe('37.2℃');
    expect(container.querySelector('[data-vital="bloodPressure"]')!.textContent).toContain('130/85');
    expect(container.querySelector('[data-vital-conformance]')!.getAttribute('data-vital-conformance')).toContain('ALIAS_FIELD');
  });
  it('🔴 이상은 적용 임계로(기본 SpO₂ ≤90 위급) · 글자로도', async () => {
    const { VitalSignsStrip } = await mod();
    const { container } = render(<VitalSignsStrip vitals={{ spo2: 85, heartRate: 70 }} />, { wrapper: wrap });
    const s = container.querySelector('[data-vital="spo2"]')!;
    expect(s.getAttribute('data-vital-flag')).toBe('CRITICAL');
    expect(s.textContent).toContain('위급');
    expect(container.querySelector('[data-vital="heartRate"]')!.getAttribute('data-vital-flag')).toBe('NORMAL');
  });
  it('🔴 0 은 측정값이다(—가 아니다) · 혈압 한쪽만이면 빈 쪽 —', async () => {
    const { VitalSignsStrip } = await mod();
    const { container } = render(<VitalSignsStrip vitals={{ heartRate: 0, systolicBp: 110 }} />, { wrapper: wrap });
    const hr = container.querySelector('[data-vital="heartRate"]')!;
    expect(hr.getAttribute('data-vital-state')).toBeNull();
    expect(hr.textContent).toContain('0');
    expect(hr.getAttribute('data-vital-flag')).toBe('CRITICAL');
    expect(container.querySelector('[data-vital="bloodPressure"]')!.textContent).toContain('110/—');
  });
  it('🔴 타당성 범위 밖은 값을 그대로 두고 확인 필요 · 이완기≥수축기도', async () => {
    const { VitalSignsStrip } = await mod();
    const { container } = render(<VitalSignsStrip vitals={{ temperature: 365, systolicBp: 80, diastolicBp: 90 }} />, { wrapper: wrap });
    expect(container.querySelector('[data-vital="temperature"]')!.textContent).toContain('365.0');
    expect(container.textContent).toContain('확인 필요 2');
  });
  it('🔴 측정 시각 — 없음은 없다고 · 미래는 미래라고(방금 아님)', async () => {
    const { VitalSignsStrip } = await mod();
    const a = render(<VitalSignsStrip vitals={{ heartRate: 70 }} measuredAt={null} />, { wrapper: wrap });
    expect(a.container.querySelector('[data-vital-time="none"]')).toBeTruthy();
    cleanup();
    const b = render(<VitalSignsStrip vitals={{ heartRate: 70 }} measuredAt={new Date(Date.now() + 3 * 3600_000).toISOString()} />, { wrapper: wrap });
    expect(b.container.querySelector('[data-vital-time="future"]')).toBeTruthy();
    expect(b.container.textContent).not.toContain('방금');
  });
});

describe('표 행·머리줄', () => {
  it('머리줄과 값 칸이 같은 순서 · 단위는 머리줄에', async () => {
    const { VitalHeaderCells, VitalRowCells } = await mod();
    const { container } = render(<table><thead><tr><VitalHeaderCells /></tr></thead><tbody><tr><VitalRowCells vitals={{ heartRate: 72, temperature: 36.5 }} /></tr></tbody></table>, { wrapper: wrap });
    const heads = [...container.querySelectorAll('th')].map((t) => t.textContent);
    expect(heads[0]).toContain('RR');
    expect(heads[2]).toContain('mmHg');
    const cells = [...container.querySelectorAll('td [data-vital]')].map((e) => e.getAttribute('data-vital'));
    expect(cells).toEqual(['respiratoryRate', 'spo2', 'bloodPressure', 'heartRate', 'temperature', 'painScore']);
    expect(container.querySelector('td [data-vital="temperature"]')!.textContent).toBe('36.5');
  });
});
