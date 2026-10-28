/**
 * 환자 차트 '의무기록' 탭(2026-10-02).
 *  · 🔴 미비 기록·발급 문서·발급 요청·열람 이력이 서버에는 있었는데 차트에서 볼 자리가 없었다(열람 이력 EP 는 부르는 화면 0)
 *  · 권한 밖(약사 등)은 부르지 않고 그 사실만 · 미비 항목은 그 기록으로 가는 길 · 자르면 잘랐다고 · 모르는 발급자는 지어내지 않는다
 *  · 열람 이력은 IP 를 관리자에게만(서버가 싣지 않으면 화면도 칸이 없다) · 더 보기
 * 재주입: 권한 게이트를 빼면 · 잘림 고지를 빼면 · 미비 링크를 빼면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HIM_DEFICIENCY_LABEL } from '@/lib/medical-record-labels';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => null } }));
let role = 'DOCTOR';
vi.mock('@/hooks/use-admin-write', () => ({ useHasRole: (...roles: string[]) => roles.includes(role) }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const P = '00000000-0000-4000-a000-000000d00001';

const bundle = {
  deficiencies: {
    items: [
      { type: 'UNSIGNED_ENCOUNTER', refId: 'enc-1', responsibleName: '김내과', since: '2026-09-28T01:00:00Z', overdueDays: 2, detail: '진료기록 미서명(DRAFT)' },
      { type: 'DISCHARGE_SUMMARY', refId: 'adm-1', responsibleName: '김내과', since: '2026-09-30T01:00:00Z', overdueDays: 0, detail: '퇴원요약 미작성' },
    ],
    counts: { total: 2, overdue: 1 }, policy: { summaryDueDays: 7, encounterDueDays: 3, noteDueDays: 1, lookbackDays: 90 },
  },
  issuedDocuments: { total: 73, limit: 50, items: [
    { issueNo: 'WRB-DX-1', documentType: 'MEDICAL_CERTIFICATE', status: 'ORIGINAL', reissueOf: null, issuedAt: '2026-09-01T00:00:00Z', issuedBy: { id: 'u1', name: '이의무' } },
    { issueNo: 'WRB-DX-2', documentType: 'MEDICAL_CERTIFICATE', status: 'REISSUE', reissueOf: 'WRB-DX-1', issuedAt: '2026-09-02T00:00:00Z', issuedBy: { id: 'ghost', name: null } },
  ] },
  documentRequests: { total: 1, limit: 50, items: [
    { id: 'r1', type: 'MEDICAL_RECORD', status: 'READY', copies: 2, purpose: '보험 청구', deliveryMethod: 'VISIT', createdAt: '2026-09-20T00:00:00Z', completedAt: null, issueNo: null },
  ] },
};
const access = (n: number, total: number, networkVisible = false) => ({
  total, limit: n, offset: 0, networkVisible,
  items: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, action: 'READ', resourceType: 'Patient', timestamp: '2026-10-02T05:00:00Z',
    ...(networkVisible ? { ipAddress: '10.0.0.7' } : {}), user: { id: i % 2 ? 'u1' : 'u2', familyName: i % 2 ? '조' : '김', givenName: i % 2 ? '간호' : '내과', role: i % 2 ? 'NURSE' : 'DOCTOR' } })),
});

beforeEach(() => { get.mockReset(); role = 'DOCTOR'; });
afterEach(() => cleanup());

describe('의무기록 탭', () => {
  it('🔴 권한 밖(약사)은 부르지 않고 그 사실만 — 비어 있다는 뜻이 아니다', async () => {
    role = 'PHARMACIST';
    const { MedicalRecordTab } = await import('@/app/(main)/patients/[id]/components/MedicalRecordTab');
    const { container } = wrap(<MedicalRecordTab patientId={P} />);
    expect(container.querySelector('[data-mr-gated]')?.textContent).toContain('비어 있다는 뜻이 아닙니다');
    expect(get).not.toHaveBeenCalled();
  });

  it('🔴 미비 기록 — 그 기록으로 가는 길 · 기한 초과 일수 · 정책', async () => {
    get.mockImplementation(async (u: string) => (u.includes('/medical-record') ? { data: bundle } : { data: access(3, 3) }));
    const { MedicalRecordTab } = await import('@/app/(main)/patients/[id]/components/MedicalRecordTab');
    const { container } = wrap(<MedicalRecordTab patientId={P} />);
    await waitFor(() => expect(container.querySelector('[data-mr-deficiencies]')).not.toBeNull());
    const hrefs = [...container.querySelectorAll('[data-mr-deficiencies] a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([`/patients/${P}/encounter/new?encounterId=enc-1`, '/inpatient/adm-1/discharge-summary']);
    expect(container.textContent).toContain('기한 2일 초과');
    expect(container.textContent).toMatch(/최근 90일/);
    expect(get.mock.calls.map((c) => c[0])).toContain(`/api/v1/patients/${P}/medical-record`);
  });

  it('🔴 발급 문서 — 73건 중 2건 표시 · 재발급 원본 · 모르는 발급자는 지어내지 않는다', async () => {
    get.mockImplementation(async (u: string) => (u.includes('/medical-record') ? { data: bundle } : { data: access(0, 0) }));
    const { MedicalRecordTab } = await import('@/app/(main)/patients/[id]/components/MedicalRecordTab');
    const { container } = wrap(<MedicalRecordTab patientId={P} />);
    await waitFor(() => expect(container.querySelector('[data-mr-issued]')).not.toBeNull());
    expect(container.textContent).toMatch(/73건 중 2건 표시/);
    expect(container.textContent).toContain('진단서');
    expect(container.textContent).toContain('재발급');
    expect(container.textContent).toContain('← WRB-DX-1');
    expect(container.textContent).toContain('이의무');
    expect(container.querySelector('[data-mr-requests]')?.textContent).toMatch(/의무기록 사본.*발급완료.*2\s*부/);
  });

  it('🔴 열람 이력 — 사람별 묶음 · 잘림 고지 · 더 보기 · IP 칸은 서버가 줄 때만(관리자)', async () => {
    get.mockImplementation(async (u: string) => {
      if (u.includes('/medical-record')) return { data: bundle };
      const limit = Number(/limit=(\d+)/.exec(u)?.[1]);
      return { data: access(Math.min(limit, 120), 120) };
    });
    const { MedicalRecordTab } = await import('@/app/(main)/patients/[id]/components/MedicalRecordTab');
    const { container } = wrap(<MedicalRecordTab patientId={P} />);
    await waitFor(() => expect(container.querySelector('[data-mr-access]')?.getAttribute('data-mr-access')).toBe('50'));
    expect(container.querySelector('[data-mr-access-users]')?.getAttribute('data-mr-access-users')).toBe('2');
    expect(container.textContent).toMatch(/120건 중 50건 표시/);
    expect(container.textContent).not.toContain('10.0.0.7');
    fireEvent.click(container.querySelector('[data-mr-access-more]')!);
    await waitFor(() => expect(container.querySelector('[data-mr-access]')?.getAttribute('data-mr-access')).toBe('100'));
  });

  it('관리자에게는 서버가 IP 를 싣는다 — 화면은 그대로 보인다', async () => {
    role = 'ADMIN';
    get.mockImplementation(async (u: string) => (u.includes('/medical-record') ? { data: bundle } : { data: access(2, 2, true) }));
    const { MedicalRecordTab } = await import('@/app/(main)/patients/[id]/components/MedicalRecordTab');
    const { container } = wrap(<MedicalRecordTab patientId={P} />);
    await waitFor(() => expect(container.textContent).toContain('10.0.0.7'));
  });

  it('환자 차트에 의무기록 탭이 있다 · 🔴 미비 라벨은 /admin/him 과 같은 말이다(두 곳 — 기계 대조)', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/(main)/patients/[id]/page.tsx'), 'utf8');
    expect(page).toMatch(/\{ key: 'medical-record', label: '의무기록' \}/);
    expect(page).toMatch(/activeTab === 'medical-record' && <MedicalRecordTab patientId=\{id\} \/>/);
    const him = readFileSync(join(process.cwd(), 'src/app/(main)/admin/him/page.tsx'), 'utf8');
    const himLabels = Object.fromEntries([...him.matchAll(/^\s+(\w+): \{ label: '([^']+)'/gm)].map((m) => [m[1], m[2]]));
    expect(Object.keys(himLabels).length).toBe(4); // 파싱 실패를 통과로 오인하지 않게
    expect(himLabels).toEqual(HIM_DEFICIENCY_LABEL);
  });
});
