import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DocumentService } from '../../src/modules/document/document.service';

/**
 * 인쇄 렌더 토큰(HMAC·2분) — 공개 EP `GET /documents/render/:issueNo?rt=`.
 * 2026-09-02 운영 실측: 서명 길이가 다른 토큰(`<exp>.abc`)에 `timingSafeEqual` 이 RangeError 를 던져
 * 404 가 아니라 500 이 나갔다. 다운로드 토큰은 길이 대조가 있었는데 렌더 토큰만 빠져 있었다.
 */
describe('DocumentService 렌더 토큰 — 길이 불일치도 500 이 아니라 거부', () => {
  let svc: DocumentService;
  let prisma: any;

  beforeEach(() => {
    process.env.PDF_RENDER_SECRET = 'test-render-secret';
    prisma = { issuedDocument: { findUnique: vi.fn().mockResolvedValue(null) } };
    svc = new DocumentService(prisma);
  });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.PDF_RENDER_SECRET; });

  const futureExp = () => Math.floor(Date.now() / 1000) + 60;

  it('서명 길이가 짧은 토큰 → invalid render token (RangeError 아님)', async () => {
    await expect(svc.renderData('WRB-CERT-20260902-0001', `${futureExp()}.abc`)).rejects.toThrow(/invalid render token/);
    expect(prisma.issuedDocument.findUnique).not.toHaveBeenCalled();
  });

  it('서명 길이가 긴 토큰 → invalid render token', async () => {
    await expect(svc.renderData('WRB-CERT-20260902-0001', `${futureExp()}.${'a'.repeat(65)}`)).rejects.toThrow(/invalid render token/);
  });

  it('대조군: 정상 토큰은 검증을 통과해 문서 조회까지 간다', async () => {
    const token = (svc as any).renderToken('WRB-CERT-20260902-0002') as string;
    await expect(svc.renderData('WRB-CERT-20260902-0002', token)).rejects.toThrow(/발급 문서 없음/);
    expect(prisma.issuedDocument.findUnique).toHaveBeenCalledTimes(1);
  });

  it('타 issueNo 토큰 재사용 불가', async () => {
    const token = (svc as any).renderToken('WRB-CERT-A') as string;
    await expect(svc.renderData('WRB-CERT-B', token)).rejects.toThrow(/invalid render token/);
  });
});
