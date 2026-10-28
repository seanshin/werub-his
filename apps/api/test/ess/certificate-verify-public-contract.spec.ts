import { describe, it, expect, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

/**
 * 재직/경력 증명서 진위확인 공개 표면 계약 — `/api/v1/integration/ess/certificates/verify/:code` (무인증·QR).
 *
 * 제3자(은행·기관)가 QR 로 진위만 확인하는 공개 EP 다. 유효성/종류/발급일만 나가고
 * **직원 실명·사번·급여 같은 PII 는 절대 나가면 안 된다**. 화이트리스트를 고정한다.
 */

function makeSvc(cert: unknown) {
  const prisma = {
    employmentCertificate: { findUnique: vi.fn().mockResolvedValue(cert) },
  };
  // EssService 는 다수 의존성을 받지만 verifyCertificate 는 prisma 만 쓴다.
  return new EssService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
}

const CERT = {
  id: 'c1', verifyCode: 'ABC123', kind: 'EMPLOYMENT', revoked: false,
  issuedAt: new Date('2026-08-01T00:00:00Z'),
  // 저장 레코드엔 있지만 응답엔 나가면 안 되는 것들:
  userId: 'u1', employeeName: '홍길동', employeeNumber: 'EMP-001', salary: 5000000,
};

describe('EssService.verifyCertificate (공개 QR 진위확인)', () => {
  it('유효 증명서 — valid/kind/issuedAt 만, 직원 PII 없음', async () => {
    const res = await makeSvc(CERT).verifyCertificate('ABC123') as Record<string, unknown>;
    expect(res.valid).toBe(true);
    expect(Object.keys(res).sort()).toEqual(['issuedAt', 'kind', 'valid'].sort());
    for (const banned of ['userId', 'employeeName', 'employeeNumber', 'salary', 'verifyCode']) {
      expect(res).not.toHaveProperty(banned);
    }
    expect(JSON.stringify(res)).not.toContain('홍길동');
    expect(JSON.stringify(res)).not.toContain('EMP-001');
  });

  it('철회된 증명서 — valid:false(진위확인만, PII 없음)', async () => {
    const res = await makeSvc({ ...CERT, revoked: true }).verifyCertificate('ABC123') as Record<string, unknown>;
    expect(res.valid).toBe(false);
    expect(res).not.toHaveProperty('employeeName');
  });

  it('없는 코드 — valid:false(존재 오라클/PII 없음)', async () => {
    const res = await makeSvc(null).verifyCertificate('NOPE') as Record<string, unknown>;
    expect(res).toEqual({ valid: false });
  });
});
