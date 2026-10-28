/**
 * 질관리 — 자동 산출 공급원 목록(2026-10-10).
 *  · 🔴 등재는 사람 — "이 정의로 새 지표 작성"은 폼만 채우고 등록 EP 를 부르지 않는다
 *  · 등재 여부는 서버가 붙인 effectiveSupplierKey(등재 키 우선 · 이름 정규형)로
 *  · 결정 의존 공급원은 그 결정을 밝힌다 · 권한 밖(작성 불가)이면 버튼 대신 '미등재'
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { QI_SUPPLIERS } from '@hospital-run/shared';
import { QiSupplierCatalog, supplierUsage } from '@/app/(main)/quality/QiSupplierCatalog';

beforeEach(() => cleanup());
const ind = (name: string, effectiveSupplierKey: string | null) => ({ id: name, name, effectiveSupplierKey } as never);

describe('공급원 목록', () => {
  it('등재 여부 — 서버가 붙인 실제 공급원으로 묶는다', () => {
    const m = supplierUsage([ind('낙상 발생률', 'FALL_RATE'), ind('직원 이직률', null)]);
    expect([...m.keys()]).toEqual(['FALL_RATE']);
  });
  it('🔴 작성 버튼은 폼만 채운다(등록하지 않는다) · 등재된 것은 지표 이름 · 결정 의존 표시', () => {
    const onDraft = vi.fn();
    const { container } = render(<QiSupplierCatalog indicators={[ind('낙상 발생률', 'FALL_RATE')]} canDraft onDraft={onDraft} />);
    const total = Object.keys(QI_SUPPLIERS).length;
    expect(container.querySelector('[data-qi-supplier-unlisted]')!.getAttribute('data-qi-supplier-unlisted')).toBe(String(total - 1));
    fireEvent.click(container.querySelector('[data-qi-supplier-catalog] button')!);
    expect(container.querySelector('[data-qi-supplier="FALL_RATE"]')!.getAttribute('data-qi-supplier-listed')).toBe('yes');
    expect(container.querySelector('[data-qi-supplier-draft="FALL_RATE"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-qi-supplier-draft="DOC_ISSUE_SLA"]')!);
    expect(onDraft).toHaveBeenCalledWith('DOC_ISSUE_SLA');
    expect(container.querySelector('[data-qi-supplier="DOC_ISSUE_SLA"]')!.textContent).toContain('qi.docIssuance.slaHours');
  });
  it('작성 권한이 없으면 버튼 대신 미등재', () => {
    const { container } = render(<QiSupplierCatalog indicators={[]} canDraft={false} onDraft={vi.fn()} />);
    fireEvent.click(container.querySelector('[data-qi-supplier-catalog] button')!);
    expect(container.querySelectorAll('[data-qi-supplier-draft]').length).toBe(0);
  });
});
