import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<typeof import('@/lib/api-client')>()), apiClient: { get: (...a: unknown[]) => get(...a) } }));

import SignedDocumentFooter, { toSignatureInfo } from '@/components/signature/SignedDocumentFooter';

/**
 * 전자서명 인쇄 정보·서명 모달 계약 — 2026-09-15 M1.
 * 🔴 ① 조회 실패를 인쇄물에 "(미서명)"으로 찍었다 — 서명된 문서가 미서명으로 출력될 수 있었다
 *    ② "QR Code" 빈 상자 + `/verify/<유형>/<id>` — 그 경로는 존재하지 않는다(공개 검증은 `/verify/document/<발급번호>` 뿐)
 *    ③ 내부 앵커 `internal-<난수>` 를 "블록체인 확인됨"으로 그렸다
 *    ④ 서명 버튼이 서명 **행 id** 를 서명값으로 임상 경로에 넘겨, 서버 공개키 검증이 늘 실패했다(P11)
 */
const ROOT = resolve(__dirname, '../..');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('인쇄 서명 정보 — 모르는 것을 미서명이라 하지 않는다', () => {
  it('🔴 조회 실패 → "확인 불가"(미서명 아님)', async () => {
    get.mockRejectedValue(new Error('500'));
    const { container } = wrap(<SignedDocumentFooter documentType="ENCOUNTER" documentId="e1" />);
    await screen.findByText(/확인 불가/);
    expect(container.textContent).not.toContain('(미서명)');
  });

  it('대조군 — 서명 문서가 없으면(null) 미서명', async () => {
    get.mockResolvedValue({ data: null });
    const { container } = wrap(<SignedDocumentFooter documentType="ENCOUNTER" documentId="e2" />);
    await screen.findByText('(미서명)');
    expect(container.textContent).not.toContain('확인 불가');
  });

  it('🔴 존재하지 않는 검증 URL·QR 자리를 인쇄하지 않는다', async () => {
    get.mockResolvedValue({ data: { status: 'COMPLETED', documentHash: 'h', signatures: [{ signedAt: '2026-09-10T00:00:00Z', isValid: true, verification: 'VERIFIED' }] } });
    const { container } = wrap(<SignedDocumentFooter documentType="ENCOUNTER" documentId="e3" />);
    await screen.findByText(/공개키 검증됨/);
    expect(container.textContent).not.toMatch(/\/verify\/ENCOUNTER\//);
    expect(container.textContent).not.toContain('QR Code');
    // (A2) 서버가 내용 대조를 말하지 않으면 일치라 하지 않는다
    expect(container.textContent).toContain('대조할 수 없음');
    expect(container.textContent).not.toContain('지금 내용과 일치');
  });

  it('🔴 내부 앵커 txId 는 "블록체인 확인됨"이 아니다 · 대조군 — 외부 txId 는 CONFIRMED', () => {
    expect(toSignatureInfo({ status: 'COMPLETED', blockchainTxId: 'internal-abcd', signatures: [] } as never)!.blockchainStatus).toBe('INTERNAL');
    expect(toSignatureInfo({ status: 'COMPLETED', blockchainTxId: '0xabc', signatures: [] } as never)!.blockchainStatus).toBe('CONFIRMED');
  });
});

describe('🔴 서명 버튼 → 임상 경로에 실제 서명값을 넘긴다(행 id 아님)', () => {
  it('SmartSignButton 이 signatureId 를 signatureValue 로 쓰지 않는다', () => {
    const s = code('src/components/signature/SmartSignButton.tsx');
    expect(s.length).toBeGreaterThan(500);
    expect(s).not.toMatch(/signatureValue:\s*_?signatureId/);
    // onBlockchainSign 에 넘기는 객체의 서명값 = 모달이 준 실제 서명값(단축 속성)
    expect(s).toMatch(/certificateId: cert\.id,\s*signatureValue,\s*signatureAlgorithm/);
    expect(s).toMatch(/handleSignComplete = async \([^)]*signatureValue: string\)/);
  });
  it('SignatureModal 이 두 서명 경로 모두 서명값을 onSignComplete 로 넘긴다', () => {
    const s = code('src/components/signature/SignatureModal.tsx');
    expect(s).toContain('onSignComplete?.(res.data.signature.id, docHash, signature)');
    expect(s).toContain('onSignComplete?.(result.signatureId, result.hash, result.signatureValue)');
  });
});
