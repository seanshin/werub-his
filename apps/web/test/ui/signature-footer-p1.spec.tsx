import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<typeof import('@/lib/api-client')>()), apiClient: { get: (...a: unknown[]) => get(...a) } }));

import { ApiError } from '@/lib/api-client';
import SignedDocumentFooter from '@/components/signature/SignedDocumentFooter';

/**
 * 인쇄 서명 정보 조회 계약 — 2026-09-15 P1.
 * 🔴 ① 처방 인쇄물은 `documentId=encounterId` 로 물었는데 처방 서명은 **처방 id** 로 기록된다 → 늘 미서명.
 *    ② 서버는 서명 문서가 없으면 **404** 를 준다(`data:null` 이 아니다) — M1 대조군은 null 모양을 가정했다.
 *       404(`SIGNED_DOCUMENT_NOT_FOUND`)만 미서명이고, 다른 실패는 확인 불가다.
 */
const ROOT = resolve(__dirname, '../..');
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('서명 문서 없음(404) ≠ 조회 실패', () => {
  it('🔴 서버 404 SIGNED_DOCUMENT_NOT_FOUND → "(미서명)"(확인 불가 아님)', async () => {
    get.mockRejectedValue(new ApiError('SIGNED_DOCUMENT_NOT_FOUND', '서명 문서를 찾을 수 없습니다'));
    const { container } = wrap(<SignedDocumentFooter documentType="PRESCRIPTION" documentId="rx-404" />);
    await screen.findByText(/\(미서명\)/);
    expect(container.textContent).not.toContain('확인 불가');
  });

  it('대조군 — 다른 오류 코드(권한 등)는 "확인 불가"', async () => {
    get.mockRejectedValue(new ApiError('FORBIDDEN', '권한 없음'));
    const { container } = wrap(<SignedDocumentFooter documentType="PRESCRIPTION" documentId="rx-403" />);
    await screen.findByText(/확인 불가/);
    expect(container.textContent).not.toContain('(미서명)');
  });

  it('여러 건이면 어느 문서의 서명인지 캡션을 붙인다', async () => {
    get.mockRejectedValue(new ApiError('SIGNED_DOCUMENT_NOT_FOUND', 'x'));
    wrap(<SignedDocumentFooter documentType="PRESCRIPTION" documentId="rx-c" caption="처방 2/3" />);
    await screen.findByText(/처방 2\/3 · \(미서명\)/);
  });
});

describe('🔴 처방 인쇄물은 서명이 기록된 id(처방 id)로 묻는다', () => {
  const page = readFileSync(resolve(ROOT, 'src/app/(main)/print/prescription/[encounterId]/page.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const svc = readFileSync(resolve(ROOT, '../api/src/modules/prescription/prescription.service.ts'), 'utf8');

  it('서버 기록 id = prescription.id (계약의 한쪽)', () => {
    expect(svc).toMatch(/documentType: 'PRESCRIPTION',\s*documentId: prescription\.id/);
  });

  it('인쇄물은 PRESCRIPTION 을 진료 id 로 묻지 않는다 · 처방 id 로 묻는다', () => {
    expect(page).not.toMatch(/documentType="PRESCRIPTION"\s+documentId=\{encounterId\}/);
    expect(page).toMatch(/documentType="PRESCRIPTION"\s+documentId=\{rx\.id!?\}/);
  });
});
