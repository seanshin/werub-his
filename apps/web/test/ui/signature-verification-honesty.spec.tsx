import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { toSignatureInfo } from '@/components/signature/SignedDocumentFooter';

/**
 * 전자서명 정직성 — 화면 쪽(2026-09-15 N2).
 * 🔴 ① 인쇄 서명 정보가 응답에 없는 최상위 필드를 읽어 서명자·일시가 찍힌 적이 없었다(P11)
 *    ② 포털이 `base64('portal-patient-<시각>')` 를 공개키로 보내 개인키 없는 인증서를 자동 발급받았다.
 */
const ROOT = resolve(__dirname, '../..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 코드가 아니다 — 경위를 적은 주석이 가드를 대신 실패시키거나 통과시키지 않게 걷는다 */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('인쇄 서명 정보 — 서버 응답 signatures[] 에서 뽑고 검증 상태를 말한다', () => {
  const doc = (verification?: 'VERIFIED' | 'NOT_VERIFIED') => ({
    status: 'COMPLETED', documentHash: 'h',
    signatures: [
      { signedAt: '2026-09-01T00:00:00Z', isValid: false, verification: 'VERIFIED' as const, signerUser: { familyName: '이전', givenName: '서명' }, certificate: { serialNumber: 'OLD' } },
      { signedAt: '2026-09-10T00:00:00Z', isValid: true, verification, signerUser: { familyName: '김', givenName: '의사' }, certificate: { serialNumber: 'CERT-9' } },
    ],
  });

  it('현행(대체되지 않은) 마지막 서명의 서명자·인증서·일시', () => {
    const i = toSignatureInfo(doc('VERIFIED'))!;
    expect(i.signerName).toBe('김의사');
    expect(i.certSerialNumber).toBe('CERT-9');
    expect(i.signedAt).toBe('2026-09-10T00:00:00Z');
    expect(i.verification).toBe('VERIFIED');
  });

  it('🔴 검증 상태가 없거나 NOT_VERIFIED 면 미검증 — 유효로 그리지 않는다', () => {
    expect(toSignatureInfo(doc('NOT_VERIFIED'))!.verification).toBe('NOT_VERIFIED');
    expect(toSignatureInfo(doc(undefined))!.verification).toBe('NOT_VERIFIED');
  });

  it('부품이 미검증 문구를 실제로 렌더한다(분기 존재)', () => {
    const s = src('src/components/signature/SignedDocumentFooter.tsx');
    expect(s).toContain("info.verification === 'VERIFIED'");
    expect(s).toContain('미검증');
  });
});

describe('🔴 포털이 공개키를 지어내 인증서를 발급받지 않는다', () => {
  for (const f of ['src/app/portal/_care/CareTab.tsx', 'src/app/portal/_profile/ProfileTab.tsx']) {
    it(`${f} — 가짜 공개키·발급 요청 없음`, () => {
      const s = code(f);
      expect(s.length).toBeGreaterThan(1000); // 대조군 — 파일을 실제로 읽었다
      expect(s).not.toMatch(/portal-patient-/);
      expect(s).not.toMatch(/\/portal\/cert\/request/);
      expect(s).not.toMatch(/자동으로 발급/);
    });
  }
});
