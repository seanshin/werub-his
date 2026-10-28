/**
 * 환자 이름 — 외국인 원어 + 한국식 호칭(2026-10-06).
 *  · 외국 이름은 띄어 쓴다(`Бат-Эрдэнэ Сарнай`) · 한글 이름은 붙인다
 *  · 원어가 한글이 아니고 호칭이 있으면 함께 · 호칭이 없으면 원어만(지어내지 않는다)
 *  · 마스킹 정책이면 호칭도 가린다(원어만 가리고 호칭으로 새면 안 된다)
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

let masking: 'OFF' | 'PARTIAL' = 'OFF';
vi.mock('@/lib/ui-settings', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, useUiSettings: () => ({ ...(real.UI_DEFAULTS as object), patientNameMasking: masking }) };
});

beforeEach(() => { cleanup(); masking = 'OFF'; });

async function show(props: Record<string, unknown>) {
  const { PatientName } = await import('@/components/ui/display');
  return render(<PatientName {...props} showMrn={false} maskable />);
}

describe('PatientName — 외국인', () => {
  it('🔴 원어는 띄어 쓰고 한국식 호칭을 함께 · 한글 이름은 붙이고 호칭을 덧붙이지 않는다', async () => {
    const a = await show({ familyName: 'Бат-Эрдэнэ', givenName: 'Сарнай', koreanName: '사르나이' });
    expect(a.container.textContent).toBe('Бат-Эрдэнэ Сарнай(사르나이)');
    cleanup();
    const b = await show({ familyName: '강', givenName: '미래', koreanName: '강미래' });
    expect(b.container.textContent).toBe('강미래');
    expect(b.container.querySelector('[data-patient-korean-name]')).toBeNull();
    cleanup();
    const c = await show({ name: 'Al-Rashid Fatima', koreanName: null });
    expect(c.container.textContent).toBe('Al-Rashid Fatima');
  });

  it('🔴 마스킹 정책이면 호칭도 가린다', async () => {
    masking = 'PARTIAL';
    const a = await show({ familyName: 'Tanaka', givenName: 'Hiroshi', koreanName: '다나카 히로시' });
    expect(a.container.textContent).not.toContain('다나카 히로시');
    expect(a.container.querySelector('[data-patient-korean-name]')!.textContent).toMatch(/^\(다\*+시\)$/);
  });
});
