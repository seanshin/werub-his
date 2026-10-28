/**
 * 접수 화면 초진 동의(2026-10-03) — 원무 신환 탭·원무 워크스테이션.
 *  🔴 종전: 신환 탭은 직원 체크박스 두 개(개인정보·민감정보)가 **필수 입력**이었고 그 값이 "환자 동의"로 원장에 남았다.
 *     등록 완료 화면의 '동의서 태블릿 전송'은 수술·시술 동의서 화면으로 갔다. 워크스테이션은 포털 요청뿐이라 그 자리에서 받을 길이 없었고,
 *     직원 입력 동의도 '필수 완료'로 셌다.
 *  · 신환 등록은 동의 없이 보낸다 → 완료 화면에서 수집 패널(태블릿·휴대폰·종이) · 직원 입력은 초록으로 그리지 않는다
 * 재주입: 체크박스·consents 를 되살리면 · 완료 화면에서 수집 패널을 빼면 · 직원 입력 배지 분기를 빼면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), postForm: vi.fn(), getToken: () => null } }));
vi.mock('@/components/ui/AddressSearch', () => ({ AddressSearch: () => null, toPatientAddress: () => undefined }));
vi.mock('@/app/(main)/reception/components/PatientPhotoCapture', () => ({ PatientPhotoCapture: () => null, photoToBlob: vi.fn() }));
vi.mock('@/components/ui/QrImage', () => ({ QrImage: () => null }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const TYPES = ['PRIVACY', 'SENSITIVE', 'UNIQUE_ID', 'THIRD_PARTY', 'TREATMENT', 'HIE', 'MARKETING', 'RESEARCH', 'EMR_VIEW', 'TELEHEALTH'];
const row = (type: string, over: Record<string, unknown> = {}) => ({ type, label: type, required: TYPES.indexOf(type) < 6, law: '', agreed: false, signedAt: null, signedBy: null, signMethod: null, evidenceConsentFormId: null, expired: false, consentId: null, ...over });

beforeEach(() => { get.mockReset(); post.mockReset(); });
afterEach(() => cleanup());

describe('원무 신환 탭', () => {
  it('🔴 직원 동의 체크박스 없이 등록 — 동의를 보내지 않는다 · 완료 화면에서 환자가 직접 받는 수집 패널', async () => {
    post.mockResolvedValue({ data: { id: 'p-new', mrn: 'P2026-9999', familyName: '홍', givenName: '길동' } });
    get.mockImplementation(async (u: string) => (u.includes('/collect/devices') ? { data: [] } : { data: { consents: TYPES.map((t) => row(t)), requiredComplete: false, requiredStaffEntered: 0, openPackage: null } }));
    const { NewPatientTab } = await import('@/app/(main)/reception/components/NewPatientTab');
    const { container } = wrap(<NewPatientTab initial={{ familyName: '홍', givenName: '길동', birth: '1980-01-01' }} />);
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(1); // 남은 하나는 신분증 OCR 처리 동의(이미지 처리 동의 — 초진 동의가 아니다)
    expect(container.querySelector('[data-np-consent-note]')).not.toBeNull();
    fireEvent.click([...container.querySelectorAll('button')].find((b) => b.textContent === '남')!);
    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('환자 등록'))! as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe('/api/v1/patients');
    expect(post.mock.calls[0][1]).not.toHaveProperty('consents');
    await waitFor(() => expect(container.querySelector('[data-registration-consent-collector]')).not.toBeNull());
    expect(get.mock.calls.map((c) => c[0])).toContain('/api/v1/patients/p-new/registration-consents/collect');
    expect(container.innerHTML).not.toContain('/workstation/consent');
  });
});

describe('필수 동의 배지', () => {
  it('🔴 직원 입력만으로 채운 필수 동의는 초록이 아니다 · 대조군: 서명 증빙이면 완료', async () => {
    const { RequiredConsentBadge } = await import('@/components/consent/RegistrationConsentCollector');
    const base = { consents: [], openPackage: null };
    const a = render(<RequiredConsentBadge status={{ ...base, requiredComplete: true, requiredStaffEntered: 2 }} />);
    expect(a.container.querySelector('[data-rc-required]')?.getAttribute('data-rc-required')).toBe('staff-entered');
    expect(a.container.textContent).toContain('직원 입력 2건');
    cleanup();
    const b = render(<RequiredConsentBadge status={{ ...base, requiredComplete: true, requiredStaffEntered: 0 }} />);
    expect(b.container.querySelector('[data-rc-required]')?.getAttribute('data-rc-required')).toBe('complete');
    cleanup();
    const c = render(<RequiredConsentBadge status={{ ...base, requiredComplete: false, requiredStaffEntered: 0 }} />);
    expect(c.container.querySelector('[data-rc-required]')?.getAttribute('data-rc-required')).toBe('incomplete');
  });
});

describe('원무 워크스테이션 접수 패널', () => {
  it('🔴 그 자리에서 받는다(수집 패널) · 수집 패널과 같은 현황 캐시 · 직원 입력 배지 · 수술 동의서 화면으로 보내지 않는다(기계 대조)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/(main)/workstation/reception/page.tsx'), 'utf8');
    const panel = src.slice(src.indexOf('function LegalConsentPanel'));
    expect(panel).toMatch(/useRegistrationConsentStatus\(patientId\)/);
    expect(panel).toMatch(/<RequiredConsentBadge status=\{st\} \/>/);
    expect(panel).toMatch(/\{collecting && <RegistrationConsentCollector patientId=\{patientId\} \/>\}/);
    expect(panel).not.toMatch(/\/workstation\/consent/);
    expect(panel).not.toMatch(/registration-consents`\)/); // 옛 별도 조회(캐시가 갈라져 받은 뒤에도 배지가 낡았다)
  });
});
