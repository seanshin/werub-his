import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PortalController } from '../../src/modules/portal/portal.controller';
import { portalConsentEvidence } from '../../src/modules/registration-consent/consent-sign-evidence';

/**
 * 🔴 (2026-09-15 T2) 포털 접수 동의서 서명 — "블록체인 전자서명"을 주장하지 않는다.
 *   실측: 화면은 인증서가 있으면 `signMethod: 'BLOCKCHAIN'` + `base64(이름-유형-시각)` 서명값을 보냈고,
 *   서버는 방식만 저장하고 서명값은 버렸다(환자용 블록체인 서명·앵커링 경로 0). IP 증빙도 늘 null 이었다.
 */
describe('포털 접수 동의서 서명 증빙', () => {
  function makeController(updateConsent: ReturnType<typeof vi.fn>) {
    const ctrl = Object.create(PortalController.prototype) as any;
    ctrl.regConsentSvc = { updateConsent };
    return ctrl as PortalController;
  }
  const req = (headers: Record<string, string> = {}) => ({ portalPatientId: 'p-1', headers, ip: '10.0.0.9' }) as any;

  it('🔴 화면이 BLOCKCHAIN 을 보내도 서버는 PORTAL 로 기록하고 요청 IP 를 남긴다 · 응답이 blockchainAnchored=false', async () => {
    const updateConsent = vi.fn(async (_p: string, _t: string, d: any) => ({ id: 'c-1', ...d }));
    const ctrl = makeController(updateConsent);

    const res: any = await ctrl.signRegistrationConsent(
      req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), 'PRIVACY',
      { signedBy: '홍길동', signMethod: 'BLOCKCHAIN', blockchainSignature: { signatureValue: 'x' } } as any,
    );

    const data = updateConsent.mock.calls[0][2];
    expect(data.signMethod).toBe('PORTAL');
    expect(data.ipAddress).toBe('203.0.113.7');
    expect(data).not.toHaveProperty('blockchainSignature');
    expect(res.data.evidence).toEqual({ signMethod: 'PORTAL', signatureImageStored: false, ipRecorded: true, blockchainAnchored: false });
  });

  it('대조군 — 서명 이미지를 실제로 보내면 저장됐다고 말한다(있는 증빙은 있다고)', () => {
    expect(portalConsentEvidence({ signMethod: 'PORTAL', signatureData: 'data:image/png;base64,AAA', ipAddress: '1.2.3.4' }))
      .toEqual({ signMethod: 'PORTAL', signatureImageStored: true, ipRecorded: true, blockchainAnchored: false });
  });

  it('🔴 포털 화면이 서명값·BLOCKCHAIN 방식을 지어내지 않는다', () => {
    const src = readFileSync(join(__dirname, '../../../web/src/app/portal/_care/CareTab.tsx'), 'utf8');
    expect(src).not.toMatch(/signMethod:\s*certId\s*\?\s*'BLOCKCHAIN'/);
    expect(src).not.toMatch(/blockchainSignature\s*:/);
    expect(src).not.toMatch(/블록체인 전자서명이 자동 적용/);
    expect(src).not.toMatch(/일괄 블록체인 서명/);
  });
});
