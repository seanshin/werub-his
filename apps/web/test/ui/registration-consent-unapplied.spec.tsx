/**
 * 초진 동의 — 서명은 됐는데 원장에 없는 묶음(2026-10-03).
 *  🔴 태블릿·휴대폰 서명은 서명 저장 뒤 원장 10종을 따로 쓴다. 그 사이 실패하면 서명본만 남고 현황은 "미수집"으로 보여
 *     아무도 그 환자를 찾지 않았다 · 수집 패널은 원장이 안 바뀌어 '서명을 기다리는 중'이 끝나지 않았다.
 *  · 패널: 서명본에 선택이 남아 있으면 '서명본대로 원장에 기록' · 아니면 다시 받아야 하는 이유
 *  · 목록(접수 데스크·접수 워크스테이션): 줄어드는 목록 · 0건이면 그리지 않음 · 자르면 말함 · 권한 밖은 부르지 않음
 * 재주입: 기록 버튼 EP·이유 문구·기다림 멈춤·0건 숨김·역할 게이트·화면 배치를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'tok' } }));
vi.mock('@/components/ui/QrImage', () => ({ QrImage: ({ value }: { value: string }) => <img data-qr={value} alt="qr" /> }));

import { useAuthStore } from '@/stores/auth-store';

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const P = '00000000-0000-4000-a000-000000d00001';
const TYPES = ['PRIVACY', 'SENSITIVE', 'UNIQUE_ID', 'THIRD_PARTY', 'TREATMENT', 'HIE', 'MARKETING', 'RESEARCH', 'EMR_VIEW', 'TELEHEALTH'];
const rows = TYPES.map((type) => ({ type, label: type, required: false, law: '', agreed: false, signedAt: null, signedBy: null, signMethod: null, evidenceConsentFormId: null, expired: false, consentId: null }));
const status = (unappliedSigned: unknown = null) => ({ consents: rows, requiredComplete: false, openPackage: null, unappliedSigned });
const unapplied = (action: string, reason: string | null) => ({ consentId: 'cf-9', signedAt: '2026-10-03T01:00:00Z', signMode: 'TABLET', action, reason });
const setRole = (role: string) => useAuthStore.setState({ user: { id: 'u', email: 'u@x', familyName: '', givenName: '', role, permissions: [] } });
const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

beforeEach(() => { get.mockReset(); post.mockReset(); setRole('RECEPTIONIST'); });
afterEach(() => cleanup());

describe('수집 패널', () => {
  it('🔴 서명본에 선택이 남아 있으면 — 서명본대로 원장에 기록(그 묶음을 지목)', async () => {
    get.mockImplementation(async (u: string) => (u.endsWith('/devices') ? { data: [] } : { data: status(unapplied('APPLY', null)) }));
    post.mockResolvedValue({ data: { recorded: 10 } });
    const { RegistrationConsentCollector } = await import('@/components/consent/RegistrationConsentCollector');
    const { container } = wrap(<RegistrationConsentCollector patientId={P} />);
    await waitFor(() => expect(container.querySelector('[data-rc-unapplied="APPLY"]')).not.toBeNull());
    expect(container.querySelector('[data-rc-unapplied]')!.textContent).toContain('원장에 기록되지 않았습니다');
    fireEvent.click(container.querySelector('[data-rc-apply-signed]')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/v1/patients/${P}/registration-consents/collect/apply-signed`, { consentId: 'cf-9' }));
  });

  it.each([['NO_CHOICES', '알 수 없어'], ['NEWER_RECORDS', '덮지 않습니다']])('🔴 다시 받아야 할 때(%s) — 이유를 말하고 기록 버튼이 없다', async (reason, text) => {
    get.mockImplementation(async (u: string) => (u.endsWith('/devices') ? { data: [] } : { data: status(unapplied('RECOLLECT', reason)) }));
    const { RegistrationConsentCollector } = await import('@/components/consent/RegistrationConsentCollector');
    const { container } = wrap(<RegistrationConsentCollector patientId={P} />);
    await waitFor(() => expect(container.querySelector('[data-rc-unapplied="RECOLLECT"]')).not.toBeNull());
    expect(container.querySelector('[data-rc-recollect-reason]')!.textContent).toContain(text);
    expect(container.querySelector('[data-rc-apply-signed]')).toBeNull();
  });

  it('대조군 — 원장에 다 들어가 있으면 알림이 없다', async () => {
    get.mockImplementation(async (u: string) => (u.endsWith('/devices') ? { data: [] } : { data: status(null) }));
    const { RegistrationConsentCollector } = await import('@/components/consent/RegistrationConsentCollector');
    const { container } = wrap(<RegistrationConsentCollector patientId={P} />);
    await waitFor(() => expect(container.querySelector('[data-rc-status]')).not.toBeNull());
    expect(container.querySelector('[data-rc-unapplied]')).toBeNull();
  });

  it('🔴 서명은 들어왔는데 원장이 실패하면 "서명을 기다리는 중"을 멈춘다', async () => {
    let s: unknown = status(null);
    get.mockImplementation(async (u: string) => (u.endsWith('/devices') ? { data: [] } : { data: s }));
    post.mockResolvedValue({ data: { path: '/consent-sign/abc', expiresAt: '2026-10-03T09:15:00Z' } });
    const { RegistrationConsentCollector } = await import('@/components/consent/RegistrationConsentCollector');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={qc}><RegistrationConsentCollector patientId={P} /></QueryClientProvider>);
    fireEvent.click(container.querySelector('[data-rc-method="mobile"]')!);
    fireEvent.click(container.querySelector('[data-rc-issue-link]')!);
    await waitFor(() => expect(container.querySelector('[data-rc-waiting]')).not.toBeNull());
    s = status(unapplied('APPLY', null));
    await qc.invalidateQueries();
    await waitFor(() => expect(container.querySelector('[data-rc-unapplied]')).not.toBeNull());
    expect(container.querySelector('[data-rc-waiting]')).toBeNull();
  });
});

describe('재수집 목록 카드', () => {
  const list = (total: number, n = total) => ({ items: Array.from({ length: n }, (_, i) => ({ ...unapplied(i ? 'RECOLLECT' : 'APPLY', i ? 'NO_CHOICES' : null), consentId: `cf-${i}`, patientId: `p-${i}`, patient: { familyName: '홍', givenName: `길동${i}`, mrn: `M${i}` } })), total, limit: 200 });

  it('🔴 서명본대로 기록 가능/다시 받아야 함 · 동의서 탭으로 · 자르면 말한다', async () => {
    get.mockResolvedValue({ data: list(250, 2) });
    const { UnappliedSignaturesCard } = await import('@/components/consent/RegistrationConsentCollector');
    const { container } = wrap(<UnappliedSignaturesCard />);
    await waitFor(() => expect(container.querySelector('[data-rc-unapplied-list]')).not.toBeNull());
    expect(get.mock.calls[0][0]).toBe('/api/v1/registration-consents/unapplied-signatures');
    expect(container.querySelector('[data-rc-unapplied-list]')!.textContent).toContain('250명');
    expect([...container.querySelectorAll('[data-rc-unapplied-row]')].map((e) => e.getAttribute('data-rc-unapplied-row'))).toEqual(['APPLY', 'RECOLLECT']);
    expect(container.querySelector('a[href="/patients/p-0?tab=consent"]')).not.toBeNull();
    expect(container.textContent).toContain('250명 중 2명 표시');
  });

  it('0건이면 그리지 않는다(희소 축의 0 을 경보하지 않는다) · 조회 실패는 실패로', async () => {
    get.mockResolvedValue({ data: list(0) });
    const { UnappliedSignaturesCard } = await import('@/components/consent/RegistrationConsentCollector');
    const r1 = wrap(<UnappliedSignaturesCard />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((res) => setTimeout(res, 10));
    expect(r1.container.innerHTML).toBe('');
    cleanup();
    get.mockRejectedValue(new Error('boom'));
    const r2 = wrap(<UnappliedSignaturesCard />);
    await waitFor(() => expect(r2.container.innerHTML).not.toBe(''));
  });

  it('🔴 권한 밖(약사)은 부르지 않는다 — 403 을 실패로 상시 띄우지 않게', async () => {
    setRole('PHARMACIST');
    const { UnappliedSignaturesCard } = await import('@/components/consent/RegistrationConsentCollector');
    const { container } = wrap(<UnappliedSignaturesCard />);
    await new Promise((res) => setTimeout(res, 10));
    expect(get).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });
});

describe('계약·배치 — 기계 대조', () => {
  it('🔴 다시 받기 이유 라벨이 서버 어휘와 같다 · 카드 역할이 서버 COLLECT_ROLES 와 같다', async () => {
    const svc = src('../api/src/modules/consent/registration-consent-collect.service.ts');
    const server = [...svc.match(/export type UnappliedReason = ([^;]+);/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    const { RECOLLECT_REASON } = await import('@/components/consent/RegistrationConsentCollector');
    expect(Object.keys(RECOLLECT_REASON).sort()).toEqual(server);
    const ctl = src('../api/src/modules/consent/registration-consent-collect.controller.ts');
    const roles = [...ctl.match(/const COLLECT_ROLES = \[([^\]]+)\]/)![1].matchAll(/UserRole\.(\w+)/g)].map((m) => m[1]).filter((r) => r !== 'ADMIN').sort();
    const card = src('src/components/consent/RegistrationConsentCollector.tsx');
    const cardRoles = [...card.match(/const allowed = useHasRole\(([^)]+)\)/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(cardRoles).toEqual(roles);
  });

  it('접수 데스크·접수 워크스테이션이 목록을 그린다', () => {
    expect(src('src/app/(main)/reception/page.tsx')).toMatch(/<UnappliedSignaturesCard \/>/);
    expect(src('src/app/(main)/workstation/reception/page.tsx')).toMatch(/<UnappliedSignaturesCard \/>/);
  });
});
