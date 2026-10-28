import { describe, it, expect, vi } from 'vitest';
import { CONSENT_DETAILS } from '../../src/modules/registration-consent/consent-details';
import { RegistrationConsentService } from '../../src/modules/registration-consent/registration-consent.service';

/**
 * 동의서 전문(全文) 정본 가드 (2026-08-25 · 부분 실패 정직성 축 후속)
 *
 * 🔴 종전엔 법정 전문 10종이 **포털 FE 상수**에만 있었다 — 정본이 화면 코드에 있으면
 *    개정 시 배포가 필요하고 접수창구·포털·앱이 서로 다른 문안을 보여줄 수 있다.
 *    이제 서버 `consent-details.ts` 가 정본이고 EP 가 detail 을 동봉한다.
 */
describe('동의서 전문 정본 — 서버 하나', () => {
  it('🔴 10종 전부 전문이 있다 — 목록에 있는데 전문이 없으면 그 동의서는 읽을 수 없다', async () => {
    const svc = new RegistrationConsentService({ } as never);
    const types = Object.keys(svc.getConsentTypes());
    expect(types.length).toBe(10);
    for (const t of types) {
      expect(CONSENT_DETAILS[t], `전문 누락: ${t}`).toBeTruthy();
      expect(CONSENT_DETAILS[t].length, `전문이 비정상적으로 짧다: ${t}`).toBeGreaterThan(50);
    }
  });

  it('🔴 getConsents 가 detail 을 동봉한다 — 빼면 포털이 빈 전문에 서명을 열 수 없어 서명이 전부 막힌다', async () => {
    const prisma = { registrationConsent: { findMany: vi.fn().mockResolvedValue([]) } };
    const svc = new RegistrationConsentService(prisma as never);
    const r = await svc.getConsents('p-1');
    const consents = (r as { consents: { type: string; detail?: string | null }[] }).consents ?? r;
    const list = Array.isArray(consents) ? consents : [];
    expect(list.length).toBe(10);
    for (const c of list) expect(c.detail, `detail 미동봉: ${c.type}`).toBeTruthy();
  });

  it('대조군 — 전문에 실측 문안의 핵심 문구가 그대로 있다(이동 중 문안이 바뀌지 않았다)', () => {
    expect(CONSENT_DETAILS.PRIVACY).toContain('동의를 거부할 권리가 있습니다');
    expect(CONSENT_DETAILS.PRIVACY).toContain('개인정보보호법');
  });
});
