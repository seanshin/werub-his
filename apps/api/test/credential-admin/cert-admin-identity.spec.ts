/**
 * 관리자 인증서 발급은 본인확인을 했다고 적지 않는다(2026-10-13 결함 발굴 C2).
 *  · 🔴 종전: `identityVerified: true` 를 근거 없이 · 갱신도 같은 경로라 자체 발급(null) 인증서가 true 로 승격
 *  · 이 경로는 본인확인 기록·증빙이 없다 → 값을 세우지 않는다(본문이 실어 와도) · 갱신도 마찬가지
 */
import { describe, it, expect, vi } from 'vitest';
import { CertAdminService } from '../../src/modules/credential-admin/cert-admin.service';

function mk() {
  const issued: any[] = [];
  const cert = { issue: vi.fn(async (d: any) => { issued.push(d); return { id: 'cert-new' }; }) };
  const prisma: any = {
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'DOCTOR', department: 'IM' }) },
    blockchainCertificate: { update: vi.fn(async () => ({ id: 'cert-new' })), findUnique: vi.fn().mockResolvedValue({ id: 'c-old', userId: 'u1', subjectDn: 'CN=x', identityVerified: null }) },
    auditLog: { create: vi.fn() },
  };
  const policy = { resolve: vi.fn(async () => ({ certValidityDays: 365 })) };
  const svc = new CertAdminService(prisma, cert as never, policy as never, {} as never);
  vi.spyOn(svc as any, 'audit').mockResolvedValue(undefined);
  return { svc, issued };
}

describe('🔴 관리자 발급 — 본인확인 값을 세우지 않는다', () => {
  it('발급 · 본문이 true 를 실어 와도 · 갱신(자체 발급 null 인증서)도', async () => {
    const a = mk();
    await a.svc.issue('admin', { userId: 'u1', subjectDn: 'CN=x', publicKey: 'pk', algorithm: 'ECDSA-P256', identityVerified: true } as never);
    expect(a.issued[0].identityVerified).toBeUndefined();
    expect(a.issued[0]).toMatchObject({ ownerType: 'STAFF', userId: 'u1', publicKey: 'pk' }); // 대조군 — 나머지는 그대로
    const b = mk();
    await b.svc.renew('admin', 'c-old', { publicKey: 'pk2', algorithm: 'ECDSA-P256' });
    expect(b.issued[0].identityVerified).toBeUndefined();
  });
});
