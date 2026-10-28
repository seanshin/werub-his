/**
 * 전자서명은 서버가 계산한 문서 내용 해시에 한다(2026-10-13 결함 발굴 A2).
 *  · 🔴 종전: 모달이 `${documentType}:${documentId}:${documentTitle}` 을 해시 — 서명이 내용에 묶이지 않았다
 *  · 모달은 `GET document-sign/content-hash/:type/:id` 의 해시·문서 id 로 서명 · 받지 못하면 서명 버튼이 잠긴다
 *  · 서명 순간에 저장하는 화면(진료기록)은 prepare 로 먼저 저장 — 실패·거절이면 서명 창을 열지 않는다
 *  · 인쇄 서명 정보는 서버 대조(contentState)만 말한다 — 없으면 "대조할 수 없음"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), getToken: () => 'x' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
vi.mock('@/lib/crypto/key-manager', () => ({
  hasStoredKey: vi.fn(async () => true),
  loadKeyFromStore: vi.fn(async () => ({ encryptedPrivateKey: 'e', salt: 's', iv: 'i', algorithm: 'ECDSA-P256', authMethod: 'PIN' })),
  decryptPrivateKey: vi.fn(async () => 'PRIVATE'),
  decryptPrivateKeyWithBiometric: vi.fn(),
}));
const signer = vi.hoisted(() => ({ signHash: vi.fn(async (_k: unknown, h: string) => `SIG(${h})`) }));
vi.mock('@/lib/crypto/signer', async (orig) => ({ ...(await orig<object>()), signHash: signer.signHash }));
vi.mock('@/lib/crypto/webauthn', () => ({ authenticateBiometric: vi.fn() }));

const CERT = { id: 'cert-1', serialNumber: 'SERIAL-0000001', status: 'ACTIVE', algorithm: 'ECDSA-P256', expiresAt: '2099-01-01' };
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
beforeEach(() => { cleanup(); api.get.mockReset(); api.post.mockReset(); signer.signHash.mockClear(); });

const route = (content: unknown | Error) => api.get.mockImplementation(async (url: string) => {
  if (url === '/api/v1/blockchain-cert/my') return { data: CERT };
  if (url.startsWith('/api/v1/document-sign/content-hash/')) { if (content instanceof Error) throw content; return content; }
  throw new Error(`unexpected ${url}`);
});

describe('🔴 서명 모달 — 서버 내용 해시에 서명한다', () => {
  it('퇴원요약: 입원 id 로 열어도 서버가 준 요약 id·내용 해시로 서명 · 제목 문자열 해시가 아니다', async () => {
    route({ data: { documentId: 'ds-1', hash: 'abc123', canon: 'doc-content-v1' } });
    api.post.mockResolvedValue({ data: { signature: { id: 'sig-1' } } });
    const { default: SignatureModal } = await import('@/components/signature/SignatureModal');
    const done = vi.fn();
    const v = wrap(<SignatureModal isOpen onClose={() => {}} documentType="DISCHARGE_SUMMARY" documentId="adm-1" documentTitle="퇴원요약 서명" patientId="p1" onSignComplete={done} />);
    await waitFor(() => expect(v.container.querySelector('[data-sign-content-hash]')?.textContent).toContain('abc123'));
    expect(api.get).toHaveBeenCalledWith('/api/v1/document-sign/content-hash/DISCHARGE_SUMMARY/adm-1');
    const key1 = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '1')!;
    for (let i = 0; i < 6; i++) fireEvent.click(key1);
    const btn = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '전자서명')!;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1]).toMatchObject({ documentType: 'DISCHARGE_SUMMARY', documentId: 'ds-1', documentHash: 'abc123', signatureValue: 'SIG(abc123)' });
    // 🔴 (U2) 직원 인증서 서명은 STAFF — 문서에 환자가 있어도 PATIENT 로 보내지 않는다
    expect(api.post.mock.calls[0][1]).toMatchObject({ signerType: 'STAFF' });
    await waitFor(() => expect(done).toHaveBeenCalledWith('sig-1', 'abc123', 'SIG(abc123)'));
  });
  it('🔴 내용 해시를 받지 못하면 말하고 서명 버튼이 잠긴다 — 서명하지 않는다', async () => {
    route(new Error('404'));
    const { default: SignatureModal } = await import('@/components/signature/SignatureModal');
    const v = wrap(<SignatureModal isOpen onClose={() => {}} documentType="ENCOUNTER" documentId="e1" documentTitle="진료 기록" />);
    await waitFor(() => expect(v.container.querySelector('[data-sign-content-hash-error]')).toBeTruthy());
    const key1 = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '1')!;
    expect(key1.disabled).toBe(true);
    expect([...document.body.querySelectorAll('button')].find((b) => b.textContent === '전자서명')!.disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('🔴 구조 가드 — 모달 소스에 제목 문자열 해시가 없다', () => {
    const s = readFileSync(resolve(__dirname, '../../src/components/signature/SignatureModal.tsx'), 'utf8');
    expect(s).not.toMatch(/\$\{documentType\}:\$\{documentId\}/);
    expect(s).not.toMatch(/hashDocument\(/);
    expect(s).toContain('/api/v1/document-sign/content-hash/');
  });
});

describe('SmartSignButton prepare — 저장한 뒤에 서명 창을 연다', () => {
  it('prepare 실패·false 면 창을 열지 않는다 · 대조군: 성공하면 연다', async () => {
    route({ data: { documentId: 'e1', hash: 'h', canon: 'c' } });
    const { default: SmartSignButton } = await import('@/components/signature/SmartSignButton');
    const onSign = vi.fn();
    for (const [prepare, opens] of [[vi.fn(async () => { throw new Error('저장 실패'); }), false], [vi.fn(async () => false), false], [vi.fn(async () => true), true]] as const) {
      cleanup();
      const v = wrap(<SmartSignButton documentType="ENCOUNTER" documentId="e1" onSign={onSign} prepare={prepare} />);
      await waitFor(() => expect(v.container.querySelector('button')!.disabled).toBe(false));
      fireEvent.click(v.container.querySelector('button')!);
      await waitFor(() => expect(prepare).toHaveBeenCalled());
      if (opens) await waitFor(() => expect(document.body.textContent).toContain('SERIAL-00000'));
      else { await new Promise((r) => setTimeout(r, 30)); expect(document.body.textContent).not.toContain('SERIAL-00000'); }
      expect(onSign).not.toHaveBeenCalled();
    }
  });
});

describe('인쇄 서명 정보 — 내용 대조는 서버가 말한 것만', () => {
  it('MATCH = 일치 · MISMATCH = 다름 · 없음 = 대조할 수 없음', async () => {
    const { default: Footer } = await import('@/components/signature/SignedDocumentFooter');
    for (const [state, text] of [['MATCH', '지금 내용과 일치'], ['MISMATCH', '지금 문서 내용과 다름'], [undefined, '대조할 수 없음']] as const) {
      cleanup();
      api.get.mockResolvedValue({ data: { status: 'COMPLETED', documentHash: 'h', contentState: state, signatures: [{ signedAt: '2026-10-13T00:00:00Z', isValid: true, verification: 'VERIFIED' }] } });
      const v = wrap(<Footer documentType="ENCOUNTER" documentId={`e-${state}`} />);
      await waitFor(() => expect(v.container.textContent).toContain(text));
    }
  });
});
