import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn().mockResolvedValue({}) },
}));

import { PreOrderTab, PreOrderCreateModal } from '../../src/app/(main)/patients/[id]/components/PreOrderTab';
import { useTermLangStore } from '../../src/stores/term-lang-store';

/**
 * 사전처방 탭 약품명 — 의료용어 한/영 토글(2026-09-11).
 *
 * 🔴 결함: 사전처방 작성 모달의 검색 결과가 약품을 <Term> 으로 그렸다. <Term> 은 성분명 폴백이 없어
 *    영문 모드에서 약 99.8% 가 'EN×'(영문명 미등록)였다 — 상품명 nameEn 은 0.2%뿐이고 영문 표시의
 *    실탄은 성분명(98.2%)이다. 약품은 정본 <DrugName>(상품명→라틴 성분명→한글+티)으로 그린다.
 *    목록 표는 토글을 아예 타지 않고 한글만 조용히 그렸다(영문 모드에서 미등록 표시조차 없음).
 *
 * 대조군: 검사/영상/치료(ProcedureCode)는 영문명 필드가 없다 → 지어내지 않고 한글+'EN×' 로 밝힌다.
 *
 * 목은 실제 응답 모양: 코드 검색 = `{ data: MedicationCode 전 컬럼[], pagination }`(select 없음),
 * 사전처방 목록 = 컨트롤러 `{ data: <서비스 {data:[...]}> }` 이중 래핑.
 */

const MED_ROW = {
  id: 'm-1', code: '644900310', nameKo: '타이레놀정500밀리그램(아세트아미노펜)', nameEn: null, ingredient: 'Acetaminophen',
  category: '해열.진통.소염제', ingredientCode: '101301ATB', manufacturer: '한국얀센', dosageForm: '정제', unit: '정',
  isActive: true, validFrom: '2020-01-01T00:00:00.000Z', validTo: null,
};
const PROC_ROW = { id: 'pc-1', code: 'D2200', nameKo: '일반혈액검사(CBC)', category: '검체검사', isActive: true };
const PAGE = { total: 1, page: 1, limit: 20, hasMore: false };

function route(path: string) {
  if (path === '/api/v1/codes/medication') return Promise.resolve({ data: [MED_ROW], pagination: PAGE });
  if (path === '/api/v1/codes/procedure') return Promise.resolve({ data: [PROC_ROW], pagination: PAGE });
  if (path === '/api/v1/appointments') return Promise.resolve({ data: [] });
  if (path === '/api/v1/pre-orders') {
    return Promise.resolve({
      data: {
        data: [
          {
            id: 'po-1', type: 'MEDICATION', status: 'PENDING', createdAt: '2026-09-10T01:00:00.000Z',
            dosage: '500mg', frequency: '1일 3회', duration: 5,
            doctor: { id: 'd-1', familyName: '김', givenName: '의사' },
            medicationCode: { id: 'm-1', code: '644900310', nameKo: MED_ROW.nameKo, nameEn: null, ingredient: 'Acetaminophen' },
            procedureCode: null, appointment: null,
          },
          {
            id: 'po-2', type: 'LAB', status: 'PENDING', createdAt: '2026-09-10T01:00:00.000Z',
            doctor: { id: 'd-1', familyName: '김', givenName: '의사' },
            medicationCode: null, procedureCode: { id: 'pc-1', code: 'D2200', nameKo: PROC_ROW.nameKo }, appointment: null,
          },
        ],
      },
    });
  }
  return Promise.reject(new Error(`unexpected GET ${path}`));
}

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

async function searchIn(typeLabel: string, placeholder: string, q: string) {
  wrap(<PreOrderCreateModal patientId="p-1" onClose={() => {}} onCreated={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: typeLabel }));
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: q } });
}

afterEach(() => {
  cleanup();
  get.mockReset();
  useTermLangStore.setState({ mode: 'KO' });
});

describe('사전처방 작성 모달 — 약품 검색 결과는 <DrugName>', () => {
  it('🔴 영문 모드 + 상품 영문명 없음 + 라틴 성분명 있음 → 성분명을 그리고 EN× 를 붙이지 않는다', async () => {
    get.mockImplementation(route);
    useTermLangStore.setState({ mode: 'EN' });
    await searchIn('약처방', '약품명 검색 (2자 이상)', '타이레놀');
    const hit = await screen.findByText('Acetaminophen');
    const row = hit.closest('button')!;
    expect(row.textContent).toContain('644900310');
    expect(row.textContent).not.toContain('EN×');
    expect(row.textContent).not.toContain('타이레놀');
  });

  it('대조군: 한글 모드는 종전과 같다(한글 제품명)', async () => {
    get.mockImplementation(route);
    await searchIn('약처방', '약품명 검색 (2자 이상)', '타이레놀');
    const hit = await screen.findByText(MED_ROW.nameKo);
    expect(hit.closest('button')!.textContent).not.toContain('Acetaminophen');
  });

  it('대조군: 검사 항목(ProcedureCode)은 영문명이 없다 — 지어내지 않고 한글+EN× 로 밝힌다', async () => {
    get.mockImplementation(route);
    useTermLangStore.setState({ mode: 'EN' });
    await searchIn('검사', '검사/영상/치료 항목명 검색 (2자 이상)', 'CBC');
    const hit = await screen.findByText(PROC_ROW.nameKo);
    expect(hit.closest('button')!.textContent).toContain('EN×');
  });
});

describe('사전처방 목록 — 약품 행은 <DrugName>, 비약품 행은 한글 그대로', () => {
  it('🔴 영문 모드에서 약품 행은 성분명으로 그려진다(한글만 조용히 그리지 않는다)', async () => {
    get.mockImplementation(route);
    useTermLangStore.setState({ mode: 'EN' });
    const { container } = wrap(<PreOrderTab patientId="p-1" />);
    await screen.findByText('Acetaminophen');
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Acetaminophen');
    expect(rows[0].textContent).not.toContain('EN×');
    // 비약품은 영문명 필드가 없다 — 지어내지 않는다(한글 그대로)
    expect(rows[1].textContent).toContain(PROC_ROW.nameKo);
  });
});
