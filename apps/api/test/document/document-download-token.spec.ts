import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DocumentService } from '../../src/modules/document/document.service';

// ERP e-sign #6 — 완료본 다운로드 토큰(HMAC). prisma 미사용 경로만 검증(토큰 발급/검증).
describe('DocumentService 완료본 다운로드 토큰', () => {
  let svc: DocumentService;

  beforeEach(() => {
    process.env.DOC_DOWNLOAD_SECRET = 'test-download-secret';
    process.env.FRONTEND_URL = 'https://his.example.org';
    svc = new DocumentService({} as any);
  });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.DOC_DOWNLOAD_SECRET; });

  const tokenOf = (url: string) => new URL(url).searchParams.get('t') ?? undefined;

  it('downloadUrl 은 issueNo·만료 토큰을 포함한 절대 URL', () => {
    const { url, expiresAt } = svc.downloadUrl('WRB-CONSENT-20260628-1');
    expect(url).toContain('https://his.example.org/api/v1/documents/dl/WRB-CONSENT-20260628-1?t=');
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('유효 토큰이면 generatePdfWithToken 이 generatePdf 로 위임', async () => {
    const spy = vi.spyOn(svc, 'generatePdf').mockResolvedValue(Buffer.from('PDF'));
    const { url } = svc.downloadUrl('WRB-CONSENT-20260628-2');
    const buf = await svc.generatePdfWithToken('WRB-CONSENT-20260628-2', tokenOf(url));
    expect(buf.toString()).toBe('PDF');
    expect(spy).toHaveBeenCalledWith('WRB-CONSENT-20260628-2');
  });

  it('토큰 없으면 거부', async () => {
    const spy = vi.spyOn(svc, 'generatePdf').mockResolvedValue(Buffer.from('PDF'));
    await expect(svc.generatePdfWithToken('WRB-X', undefined)).rejects.toThrow(/invalid download token/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('변조 서명 거부(타 issueNo 토큰 재사용 불가 — IDOR)', async () => {
    const { url } = svc.downloadUrl('WRB-CONSENT-A');
    await expect(svc.generatePdfWithToken('WRB-CONSENT-B', tokenOf(url))).rejects.toThrow(/invalid download token/);
  });

  it('서명 1바이트 변조 거부', async () => {
    const { url } = svc.downloadUrl('WRB-CONSENT-C');
    const t = tokenOf(url)!;
    const flipped = t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a');
    await expect(svc.generatePdfWithToken('WRB-CONSENT-C', flipped)).rejects.toThrow(/invalid download token/);
  });

  it('만료 토큰 거부(exp 과거)', async () => {
    const { url } = svc.downloadUrl('WRB-CONSENT-D', 60);
    const t = tokenOf(url)!;
    const [, sig] = t.split('.');
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    await expect(svc.generatePdfWithToken('WRB-CONSENT-D', `${pastExp}.${sig}`)).rejects.toThrow(/invalid download token/);
  });

  it('렌더 토큰과 컨텍스트 분리(dl. 접두) — 다른 시크릿이면 불통', () => {
    const { url } = svc.downloadUrl('WRB-CONSENT-E');
    const t1 = tokenOf(url);
    process.env.DOC_DOWNLOAD_SECRET = 'other-secret';
    const svc2 = new DocumentService({} as any);
    const { url: url2 } = svc2.downloadUrl('WRB-CONSENT-E');
    expect(tokenOf(url2)).not.toBe(t1); // 시크릿 의존
  });
});
