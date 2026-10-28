/**
 * 전문진료 3차(2026-10-10).
 *  · 신경외과 하단 요약 — 🔴 동공 반응을 고르지 않았는데 `(-)`(무반응)로 그렸다
 *  · 전문과 목록 — 🔴 "내 환자"라 했지만 그 과 기록이 있는 **모든** 환자 · 상한 없음 → 머리글 교정·상한/전체 수/잘림 고지
 *  · 개별 환자 조회 — 🔴 UUID 직접 입력칸(누르면 아무것도 안 하는 '조회 중...' 버튼) → 환자 검색 부품
 *  · 분만 보드·격리 감시 — 🔴 API 는 간호사에게 열려 있었는데 화면은 간호사에게 숨긴 의사 전문과 메뉴 안 → 간호 메뉴
 *    · 격리 지시·연장은 서버가 의사·관리자만 — 간호사에게 누를 수 없는 버튼을 보이지 않는다 · 등록 뒤 미선택으로
 *  · BMI — 가정의학 건강검진이 화면 계산 BMI 를 보내지 않는다(서버가 계산)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { pupilSummary } from '@/app/(main)/patients/[id]/encounter/new/components/NeurosurgeryEncounterLayout';
import { SpecialtyPatientListMeta, specialtyPatientMeta } from '@/components/specialty/SpecialtyPatientListMeta';
import { NAV_SECTIONS, isNavItemVisible } from '@/components/layout/Sidebar';
import { SCREEN_CODE_FROZEN } from '@/components/layout/screen-codes.frozen';

const src = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');
const apiSrc = (p: string) => readFileSync(resolve(__dirname, '../../../api/src/modules', p), 'utf8');
const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const asRole = (role: string) => useAuthStore.setState({ user: { id: 'u1', role } as never, isAuthenticated: true });

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

describe('신경외과 하단 요약 — 평가하지 않은 동공', () => {
  it('🔴 미선택은 — (종전 반응 미선택을 "-" = 무반응으로 그렸다)', () => {
    expect(pupilSummary('', null)).toBe('—(—)');
    expect(pupilSummary('3', null)).toBe('3mm(—)');
    expect(pupilSummary('4', false)).toBe('4mm(-)');
    expect(pupilSummary('2', true)).toBe('2mm(+)');
  });
});

describe('전문과 목록 범위 고지', () => {
  it('🔴 잘렸으면 잘랐다고 · 전체 수 · 아니면 전체 수만', () => {
    const t = render(<SpecialtyPatientListMeta meta={{ total: 250, limit: 100, truncated: true }} />);
    expect(t.container.querySelector('[data-specialty-truncated]')!.textContent).toContain('100');
    expect(t.container.querySelector('[data-specialty-truncated]')!.textContent).toContain('250');
    cleanup();
    const n = render(<SpecialtyPatientListMeta meta={{ total: 3, limit: 100, truncated: false }} />);
    expect(n.container.querySelector('[data-specialty-truncated]')).toBeNull();
    expect(n.container.querySelector('[data-specialty-total]')!.textContent).toContain('3');
  });
  it('meta 모양이 다르면 아무것도 말하지 않는다(지어내지 않는다)', () => {
    expect(specialtyPatientMeta({ data: [] })).toBeNull();
    expect(specialtyPatientMeta({ meta: { total: '3' } })).toBeNull();
    expect(specialtyPatientMeta({ data: [], meta: { total: 3, limit: 100, truncated: false } })).toEqual({ total: 3, limit: 100, truncated: false });
  });

  const PAGES = ['dental', 'dermatology', 'ent', 'internal-medicine', 'neurosurgery', 'obgyn', 'ophthalmology', 'orthopedics', 'pediatrics', 'plastic', 'psychiatry', 'urology'];
  it.each(PAGES)('🔴 /%s — UUID 입력칸·빈 조회 버튼 대신 환자 검색 · "내 환자" 대신 이 과 기록 환자 + 범위 고지', (p) => {
    const s = src(`app/(main)/${p}/page.tsx`);
    expect(s).not.toContain("tAttr('환자 ID 입력')");
    expect(s).not.toContain("toast.info('조회 중...')");
    expect(s).not.toContain("toast.info(tAttr('조회 중...'))");
    expect(s).toMatch(/<PatientSelector value=\{patientId\} onChange=\{\(id\) => setPatientId\(id\)\}/);
    expect(s).not.toContain('<T k="내 환자" />');
    expect(s).toContain('<SpecialtyPatientListMeta meta={specialtyPatientMeta(patientsData)} />');
  });
});

describe('🔴 간호사 — 분만 보드·격리 감시 화면', () => {
  const items = NAV_SECTIONS.flatMap((s) => s.items);
  const item = (href: string) => items.find((i) => i.href === href)!;
  it('간호 메뉴에 있고 간호사에게 보인다 · 화면번호 고정', () => {
    for (const href of ['/nurse-station/delivery-board', '/nurse-station/seclusion']) {
      expect(item(href), href).toBeTruthy();
      expect(isNavItemVisible(item(href), { role: 'NURSE', dept: '산부인과병동' })).toBe(true);
      expect(SCREEN_CODE_FROZEN[href]).toMatch(/^\d{4}$/);
    }
    // 대조군 — 의사 전문과 메뉴는 여전히 간호사에게 숨김
    expect(isNavItemVisible(item('/obgyn'), { role: 'NURSE', dept: '산부인과병동' })).toBe(false);
  });
  it('🔴 화면이 부르는 분만·격리 API 는 서버가 간호사에게 연다(지시·연장 제외 — 부품이 숨김)', () => {
    const ob = apiSrc('obgyn/obgyn.controller.ts');
    for (const ep of ["@Get('deliveries/board')", "@Post('deliveries')", "@Post('deliveries/:id/progress')", "@Post('deliveries/:id/newborn')", "@Post('newborns/:id/verify-match')"]) {
      const at = ob.indexOf(ep);
      expect(at, ep).toBeGreaterThan(-1);
      expect(ob.slice(at, at + 120), ep).toContain('UserRole.NURSE');
    }
    const ps = apiSrc('psychiatry/psychiatry.controller.ts');
    for (const ep of ["@Get('seclusions/active')", "@Post('seclusions/:id/monitorings')", "@Patch('seclusions/:id/release')"]) {
      const at = ps.indexOf(ep);
      expect(ps.slice(at, at + 120), ep).toContain('UserRole.NURSE');
    }
  });
  it('🔴 격리 지시·연장 역할 = 서버 클래스 @Roles(메서드 @Roles 없음)', async () => {
    const { SECLUSION_ORDER_ROLES } = await import('@/app/(main)/psychiatry/SeclusionRestraintSection');
    const ps = apiSrc('psychiatry/psychiatry.controller.ts');
    const cls = ps.match(/@Roles\(([^)]*)\)\s*\n@Controller\('api\/v1\/psychiatry'\)/)![1];
    expect([...SECLUSION_ORDER_ROLES].sort()).toEqual(cls.split(',').map((x) => x.trim().replace('UserRole.', '')).sort());
    for (const ep of ["@Post('seclusions')", "@Patch('seclusions/:id/extend')"]) {
      const at = ps.indexOf(ep);
      expect(ps.slice(at, at + 80), ep).not.toContain('@Roles(');
    }
  });

  const active = [{ id: 's1', type: 'SECLUSION', reason: 'r', riskType: 'SELF_HARM', startedAt: '2026-10-10T00:00:00Z', legalMaxUntil: '2026-10-10T12:00:00Z', extensionCount: 0, psychiatristVerified: true, remainingMinutes: 100, patient: { familyName: '김', givenName: '환', mrn: 'M1' } }];
  const mount = async () => {
    const { default: Section } = await import('@/app/(main)/psychiatry/SeclusionRestraintSection');
    get.mockResolvedValue({ data: active });
    return render(<Section />, { wrapper: wrap });
  };
  it('🔴 간호사 — 지시 등록·연장 버튼 없음 · 관찰 기록·해제는 있음 · 이유를 말한다', async () => {
    asRole('NURSE');
    const r = await mount();
    await waitFor(() => expect(r.container.textContent).toContain('관찰 기록'));
    expect(r.container.textContent).not.toContain('+ 지시 등록');
    expect(r.container.querySelector('[data-seclusion-extend]')).toBeNull();
    expect(r.container.textContent).toContain('해제');
    expect(r.container.querySelector('[data-seclusion-order-note]')).not.toBeNull();
  });
  it('대조군 — 의사는 지시 등록·연장 · 환자는 검색해 고른다(UUID 칸 없음)', async () => {
    asRole('DOCTOR');
    const r = await mount();
    await waitFor(() => expect(r.container.querySelector('[data-seclusion-extend]')).not.toBeNull());
    fireEvent.click(Array.from(r.container.querySelectorAll('button')).find((b) => b.textContent?.includes('+ 지시 등록'))!);
    expect(r.container.querySelector('input[placeholder="환자 UUID"]')).toBeNull();
    expect(src('app/(main)/psychiatry/SeclusionRestraintSection.tsx')).not.toContain("type: 'SECLUSION', riskType: 'SELF_HARM'");
  });
  it('분만 보드 개시 — 환자 UUID 칸 대신 검색', () => {
    const s = src('app/(main)/obgyn/DeliveryBoard.tsx');
    expect(s).not.toContain("tAttr('환자 ID(UUID)')");
    expect(s).toContain('<PatientSelector value={startForm.patientId}');
  });
});

describe('BMI — 화면 계산값을 보내지 않는다', () => {
  it('🔴 가정의학 건강검진 저장 본문에 화면 BMI 를 섞지 않는다(서버 계산)', () => {
    const s = src('app/(main)/patients/[id]/encounter/new/components/FamilyMedicineEncounterLayout.tsx');
    expect(s).not.toContain('checkup: { ...checkup, bmi }');
    expect(s).toMatch(/vitals: vitalsDisplay, checkup,\n/);
  });
});
