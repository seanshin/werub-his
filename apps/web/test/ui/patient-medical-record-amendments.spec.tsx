/**
 * 의무기록 탭 — 정정 이력·사본 발급 신청 접수(2026-10-03).
 *  🔴 진료기록·퇴원요약 정정은 서명본을 덮어써 정정 전 내용이 남지 않았다(이력 화면도 없음) → 서버가 직전 서명본을 보존하고
 *     탭이 출처별로(보존본·미보존·간호 정정문·검사 수정) 보인다. 보존 이전 정정은 "미보존"·"마지막 변경"이라 말한다(지어내지 않음).
 *  🔴 직원 접수 EP 는 있었는데 의무기록 사본을 받는 화면이 없었다 — 탭에서 접수(수령 방법은 미선택에서 시작) ·
 *     증명서 접수 화면으로는 환자만 넘긴다(종류를 미리 고르지 않는다).
 * 재주입: 정정 전·후 비교·미보존 표기·재서명 대기·이후 정정 고지·접수 본문·미선택 게이트·라벨 어휘 대조를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AMENDED_FIELD_LABEL, AMENDMENT_SOURCE_LABEL, AMENDMENT_RECORD_TYPE_LABEL } from '@/lib/medical-record-labels';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => null } }));
vi.mock('@/hooks/use-admin-write', () => ({ useHasRole: () => true }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const P = '00000000-0000-4000-a000-000000d00001';
const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const bundle = {
  deficiencies: { items: [], counts: { total: 0, overdue: 0 }, policy: { summaryDueDays: 7, encounterDueDays: 3, noteDueDays: 1, lookbackDays: 90 } },
  issuedDocuments: { total: 0, limit: 50, items: [] },
  documentRequests: { total: 0, limit: 50, items: [] },
  amendments: {
    total: 60, limit: 50, preservedSince: '2026-10-03',
    items: [
      { source: 'SIGNED_VERSION', recordType: 'ENCOUNTER', recordId: 'e1', at: '2026-10-03T03:00:00Z', by: { id: 'd2', name: '이의사' },
        versionId: 'v1', priorSignedAt: '2026-10-01T02:00:00Z', priorSignedBy: { id: 'd1', name: '김의사' }, changedFields: ['assessment'], resignPending: true },
      { source: 'UNPRESERVED', recordType: 'DISCHARGE_SUMMARY', recordId: 'ds9', at: '2026-09-20T03:00:00Z', by: null, resignPending: true },
      { source: 'NURSING_ADDENDUM', recordType: 'NURSING_NOTE', recordId: 'n1', addendumId: 'n2', at: '2026-09-30T03:00:00Z', by: { id: 'r1', name: '박간호' } },
      { source: 'LAB_RESULT_AMENDMENT', recordType: 'LAB_RESULT', recordId: 'l1', at: '2026-09-29T03:00:00Z', by: { id: 'k1', name: '최검사' }, reason: '검체 오표기', previousStatus: 'VERIFIED' },
    ],
  },
};
const version = { versionId: 'v1', recordType: 'ENCOUNTER', recordId: 'e1', priorSignedAt: '2026-10-01T02:00:00Z', supersededAt: '2026-10-03T03:00:00Z',
  changedFields: ['assessment'], prior: { assessment: '폐렴', plan: '항생제' }, current: { assessment: '폐렴 의증 — 결핵 감별', plan: '항생제' }, currentStatus: 'AMENDED', laterVersions: 2 };

const routes = async (u: string) => {
  if (u.includes('/medical-record/versions/')) return { data: version };
  if (u.endsWith('/medical-record')) return { data: bundle };
  return { data: { total: 0, limit: 50, offset: 0, networkVisible: false, items: [] } };
};

beforeEach(() => { get.mockReset(); post.mockReset(); get.mockImplementation(routes); });
afterEach(() => cleanup());

const open = async () => {
  const { MedicalRecordTab } = await import('@/app/(main)/patients/[id]/components/MedicalRecordTab');
  const r = wrap(<MedicalRecordTab patientId={P} />);
  await waitFor(() => expect(r.container.querySelector('[data-mr-amendments]')).not.toBeNull());
  return r;
};

describe('정정 이력', () => {
  it('🔴 출처별로 · 보존 시작일 · 재서명 대기 · 미보존은 "마지막 변경"·정정자 없음 · 바뀐 항목 · 검사 수정 사유 · 잘림', async () => {
    const { container } = await open();
    expect([...container.querySelectorAll('[data-mr-amend-row]')].map((e) => e.getAttribute('data-mr-amend-row'))).toEqual(['SIGNED_VERSION', 'UNPRESERVED', 'NURSING_ADDENDUM', 'LAB_RESULT_AMENDMENT']);
    expect(container.querySelector('[data-mr-amend-since]')!.textContent).toContain('2026-10-03');
    const rows = container.querySelectorAll('[data-mr-amend-row]');
    expect(rows[0].textContent).toMatch(/재서명 대기.*바뀐 항목.*A\(평가\)/);
    expect(rows[0].textContent).toMatch(/이전 서명/);
    expect(rows[1].textContent).toContain('이전 내용 미보존');
    expect(rows[1].textContent).toContain('마지막 변경');
    expect(rows[3].textContent).toContain('검체 오표기');
    expect(container.textContent).toContain('60건 중 4건 표시');
  });

  it('🔴 정정 전·후 비교 — 바뀐 항목만 · 지금은 재서명 대기 · 이후 정정이 더 있으면 말한다', async () => {
    const { container } = await open();
    fireEvent.click(container.querySelector('[data-mr-amend-open="v1"]')!);
    await waitFor(() => expect(container.querySelector('[data-mr-version="v1"]')).not.toBeNull());
    expect(get.mock.calls.some((c) => c[0] === `/api/v1/patients/${P}/medical-record/versions/v1`)).toBe(true);
    const fields = [...container.querySelectorAll('[data-mr-version-field]')].map((e) => e.getAttribute('data-mr-version-field'));
    expect(fields).toEqual(['assessment']); // 바뀌지 않은 plan 은 나란히 놓지 않는다
    const f = container.querySelector('[data-mr-version-field="assessment"]')!.textContent!;
    expect(f).toMatch(/정정 전\(서명본\).*폐렴.*지금.*재서명 대기.*결핵 감별/);
    expect(container.querySelector('[data-mr-version-later]')!.textContent).toContain('2번 더');
  });

  it('대조군 — 정정이 없으면 없다고만 · 보존 시작일은 그대로 말한다', async () => {
    get.mockImplementation(async (u: string) => (u.endsWith('/medical-record') ? { data: { ...bundle, amendments: { total: 0, limit: 50, preservedSince: '2026-10-03', items: [] } } } : routes(u)));
    const { MedicalRecordTab } = await import('@/app/(main)/patients/[id]/components/MedicalRecordTab');
    const { container } = wrap(<MedicalRecordTab patientId={P} />);
    await waitFor(() => expect(container.querySelector('[data-mr-amend-none]')).not.toBeNull());
    expect(container.querySelector('[data-mr-amend-since]')).not.toBeNull();
  });
});

describe('사본 발급 신청 접수', () => {
  it('🔴 수령 방법은 미선택에서 시작(고르기 전엔 접수 불가) · 본문은 의무기록 사본 · 비운 관계는 보내지 않는다', async () => {
    post.mockResolvedValue({ data: { id: 'r9' } });
    const { container } = await open();
    fireEvent.click(container.querySelector('[data-mr-copy-intake-open]')!);
    expect((container.querySelector('[data-mr-copy-submit]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-mr-copy-intake]')!.textContent).toContain('시스템은 검증하지 않고');
    fireEvent.change(container.querySelector('[data-mr-copy-delivery]')!, { target: { value: 'MAIL' } });
    fireEvent.change(container.querySelector('[data-mr-copy-copies]')!, { target: { value: '2' } });
    fireEvent.click(container.querySelector('[data-mr-copy-submit]')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toEqual(['/api/v1/staff/document-requests', { patientId: P, type: 'MEDICAL_RECORD', copies: 2, deliveryMethod: 'MAIL' }]);
  });

  it('🔴 증명서 접수로는 환자만 넘긴다 — 증명서 화면은 종류 없이 환자만 받아 접수 창을 연다(종류는 미선택)', async () => {
    const { container } = await open();
    expect(container.querySelector('[data-mr-cert-intake]')!.getAttribute('href')).toBe(`/workstation/certificates?patientId=${P}`);
    const cert = src('src/app/(main)/workstation/certificates/page.tsx');
    expect(cert).toMatch(/if \(!type\) return \{ patientId, type: '' \};/);
  });
});

describe('어휘 — 서버와 기계 대조', () => {
  it('🔴 출처·기록 종류·정정 항목 라벨이 서버 어휘를 덮는다(빠진 것이 있으면 코드가 그대로 화면에 나간다)', () => {
    const mr = src('../api/src/modules/him/patient-medical-record.service.ts');
    const sources = [...mr.match(/export type AmendmentSource = ([^;]+);/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(Object.keys(AMENDMENT_SOURCE_LABEL).sort()).toEqual(sources);
    const recordTypes = [...new Set([...mr.matchAll(/recordType: '(\w+)'/g)].map((m) => m[1]))];
    const srv = src('../api/src/modules/him/signed-record-version.ts');
    const signedTypes = [...srv.match(/SIGNED_RECORD_TYPES = \[([^\]]+)\]/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    for (const t of [...recordTypes, ...signedTypes]) expect(AMENDMENT_RECORD_TYPE_LABEL[t], t).toBeTruthy();
    const enc = src('../api/src/modules/encounter/encounter.service.ts');
    const encFields = [...enc.match(/ENCOUNTER_AMENDABLE_FIELDS = \[([^\]]+)\]/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    const ds = src('../api/src/modules/discharge-summary/discharge-summary.service.ts');
    const dsFields = [...ds.slice(ds.indexOf('private buildUpdateData')).matchAll(/data\.(\w+) =/g)].map((m) => m[1]);
    expect(encFields.length).toBeGreaterThan(0);
    expect(dsFields.length).toBeGreaterThan(10);
    for (const f of [...encFields, ...dsFields]) expect(AMENDED_FIELD_LABEL[f], f).toBeTruthy();
  });
});
