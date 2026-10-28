/**
 * 환자 차트·퇴원 정산서 인쇄본(2026-10-12 사용자 "나머지 인쇄 화면도 같은 방식으로 정돈").
 *  · 🔴 종전 두 화면의 인쇄는 빈 종이 — 인쇄 전용 문서를 body 직하 `.doc-print-root` 에 그린다
 *  · 모르는 것을 "없음"·0 으로 찍지 않는다(나이 미상·조회 실패·확인 불가 · 알레르기 빈 목록 ≠ 없음 · 금액 null ≠ 0원)
 *  · 사람 확인 칸·서명란 · 문서 QR 에 PHI 없음
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtl, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), getToken: () => 'x' } }));
import { useAuthStore } from '@/stores/auth-store';
const asRole = (role: string) => useAuthStore.setState({ user: { role } as never });
beforeEach(() => {
  cleanup(); get.mockReset(); asRole('DOCTOR');
  document.body.querySelectorAll('.doc-print-root').forEach((e) => e.remove());
});
const render = (ui: React.ReactElement) => rtl(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const root = () => document.body.querySelector(':scope > .doc-print-root')!;
const ready = () => waitFor(() => expect(root()?.querySelector('[data-print-doc-hash]')?.textContent).toMatch(/[0-9a-f]{64}/));

const PATIENT = { familyName: '김', givenName: '인쇄', mrn: 'MRN-0099', dateOfBirth: '1980-02-03', gender: 'FEMALE', bloodType: null };
const ENC = [
  { id: 'e1', status: 'SIGNED', createdAt: '2026-10-01T01:00:00.000Z', doctor: { familyName: '이', givenName: '의사' }, diagnoses: [{ id: 'd1', diagnosisCode: { code: 'I10', nameKo: '본태성 고혈압' } }] },
  { id: 'e2', status: 'COMPLETED', createdAt: '2026-09-01T01:00:00.000Z', diagnoses: [] },
];

describe('환자 차트 인쇄본', () => {
  it('🔴 body 직하 인쇄 루트 · 식별·알레르기·요약·최근 진료 · 확인 칸·서명란', async () => {
    get.mockResolvedValue({ data: { status: 'HAS_ALLERGIES', assessedAt: '2026-10-01T00:00:00.000Z', allergies: [{}] } });
    const { PatientChartPrint } = await import('@/app/(main)/patients/[id]/components/PatientChartPrint');
    render(<PatientChartPrint patientId="11111111-2222-4333-8444-555555555555" patient={PATIENT} patientAge={46} allergies={['페니실린']}
      encounters={ENC as never} emptyDraftCount={3} activeRxCount={2} orderCount={5} printedAt="2026-10-12T01:00:00.000Z" />);
    await ready();
    const r = root();
    expect(r.querySelector('[data-print-doc="PATIENT_CHART"]')).toBeTruthy();
    expect([...r.querySelectorAll('[data-print-section]')].map((x) => x.getAttribute('data-print-section'))).toEqual(['IDENTITY', 'ALLERGY', 'SUMMARY', 'ENCOUNTERS']);
    expect(r.textContent).toContain('MRN-0099');
    expect(r.querySelector('[data-print-age]')!.textContent).toContain('46');
    expect(r.querySelector('[data-print-section="ALLERGY"]')!.textContent).toContain('페니실린');
    await waitFor(() => expect(r.querySelector('[data-print-allergy-status]')!.getAttribute('data-print-allergy-status')).toBe('HAS_ALLERGIES'));
    expect([...r.querySelectorAll('[data-print-encounter]')].map((x) => x.getAttribute('data-print-encounter'))).toEqual(['e1', 'e2']);
    expect(r.querySelector('[data-print-encounter="e1"]')!.textContent).toContain('본태성 고혈압');
    expect(r.querySelector('[data-print-encounter="e1"]')!.textContent).toContain('☐');
    expect(r.querySelector('[data-print-signoff]')!.textContent).toContain('검토자');
  });

  it('🔴 모르는 것을 없음·0 으로 찍지 않는다 — 나이 미상·알레르기 빈 목록·진료 조회 실패·처방 수 확인 불가', async () => {
    get.mockRejectedValue(new Error('down'));
    const { PatientChartPrint } = await import('@/app/(main)/patients/[id]/components/PatientChartPrint');
    render(<PatientChartPrint patientId="p1" patient={{ ...PATIENT, dateOfBirth: null }} patientAge={null} allergies={[]}
      encounters={null} emptyDraftCount={0} printedAt="2026-10-12T01:00:00.000Z" />);
    await ready();
    const r = root();
    expect(r.querySelector('[data-print-age]')!.textContent).toBe('나이 미상');
    expect(r.querySelector('[data-print-age]')!.textContent).not.toContain('0');
    expect(r.querySelector('[data-print-allergy-unknown]')).toBeTruthy();
    // 🔴 확인 상태 조회 실패를 안전으로 접지 않는다
    await waitFor(() => expect(r.querySelector('[data-print-allergy-status]')!.getAttribute('data-print-allergy-status')).toBe('FAILED'));
    expect(r.querySelector('[data-print-allergy-status]')!.textContent).toContain('없다는 뜻이 아닙니다');
    expect(r.querySelector('[data-print-encounters-failed]')).toBeTruthy();
    expect(r.querySelector('[data-print-rx]')!.textContent).toBe('확인 불가');
    expect(r.querySelector('[data-print-orders]')!.textContent).toBe('확인 불가');
  });

  it('권한 밖 역할은 확인 상태를 부르지 않고 그렇다고 말한다', async () => {
    asRole('RECEPTIONIST');
    const { PatientChartPrint } = await import('@/app/(main)/patients/[id]/components/PatientChartPrint');
    render(<PatientChartPrint patientId="p1" patient={PATIENT} patientAge={46} allergies={[]} encounters={[]} emptyDraftCount={0} printedAt="2026-10-12T01:00:00.000Z" />);
    await ready();
    expect(root().querySelector('[data-print-allergy-status]')!.getAttribute('data-print-allergy-status')).toBe('NO_PERMISSION');
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining('/allergies/status'));
  });

  it('🔴 문서 QR 에 PHI 없음 — 이름·등록번호·생년월일이 들어가지 않는다', async () => {
    const { patientChartQrPayload } = await import('@/app/(main)/patients/[id]/components/PatientChartPrint');
    const j = JSON.stringify(patientChartQrPayload({ patientId: 'p1', at: '2026-10-12T01:00:00.000Z', encounters: 2, allergies: 1 }));
    for (const phi of ['김', '인쇄', 'MRN-0099', '1980']) expect(j).not.toContain(phi);
    expect(Object.keys(JSON.parse(j)).sort()).toEqual(['allergies', 'at', 'encounters', 'patient', 't', 'v']);
  });

  it('페이지가 인쇄본을 그린다(차트 머리·큰 화면 보기 두 단추가 같은 문서)', () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/patients/[id]/page.tsx'), 'utf8');
    expect(src).toMatch(/<PatientChartPrint\s/);
    expect(src).toContain('encounters={encountersError ? null : visibleEncounters}');
  });
});

describe('퇴원 정산서 인쇄본', () => {
  const S = { admitDate: '2026-09-20', dischargeDate: '2026-10-01', days: 11, totalCharges: 1200000, totalCopay: 240000, alreadyPaid: 100000, balanceDue: 140000,
    reconciliation: { warnings: ['중간정산 1건이 진료 청구와 겹칩니다'] }, breakdown: { encounters: { count: 3, charges: 1000000, copay: 200000, paid: 0 }, interim: { count: 1, charges: 200000, copay: 40000, paid: 100000 } } };
  const ADM = { patient: { id: 'p1', familyName: '박', givenName: '정산', mrn: 'MRN-7' }, bed: { ward: { name: '7병동' }, roomNumber: '701', bedNumber: '2' } };

  it('🔴 body 직하 인쇄 루트 · 환자·입원·대사 경고·금액·구성 · 수납 담당·환자/보호자 서명란', async () => {
    const { DischargeSettlementPrint } = await import('@/app/(main)/inpatient/[admissionId]/DischargeSettlementPrint');
    render(<DischargeSettlementPrint admissionId="a1" settlement={S} admission={ADM} printedAt="2026-10-12T01:00:00.000Z" />);
    await ready();
    const r = root();
    expect(r.querySelector('[data-print-doc="DISCHARGE_SETTLEMENT"]')).toBeTruthy();
    expect([...r.querySelectorAll('[data-print-section]')].map((x) => x.getAttribute('data-print-section'))).toEqual(['IDENTITY', 'AMOUNTS', 'BREAKDOWN']);
    expect(r.textContent).toContain('MRN-7');
    expect(r.querySelector('[data-print-warnings]')!.textContent).toContain('겹칩니다');
    expect(r.querySelector('[data-print-balance]')!.textContent).toMatch(/140,000/);
    const so = r.querySelector('[data-print-signoff]')!.textContent!;
    expect(so).toContain('수납 담당');
    expect(so).toContain('환자/보호자');
  });

  it('🔴 서버가 주지 않은 금액은 0원이 아니다 — 확인 불가', async () => {
    const { DischargeSettlementPrint } = await import('@/app/(main)/inpatient/[admissionId]/DischargeSettlementPrint');
    render(<DischargeSettlementPrint admissionId="a1" settlement={{ totalCharges: 50000 }} admission={null} printedAt="2026-10-12T01:00:00.000Z" />);
    await ready();
    const r = root();
    expect(r.querySelector('[data-print-balance]')!.textContent).toBe('확인 불가');
    expect(r.querySelector('[data-print-section="AMOUNTS"]')!.textContent).not.toMatch(/(^|[^0-9,])0\s*원/);
    expect(r.querySelector('[data-print-warnings]')).toBeNull();
  });

  it('🔴 문서 QR 에 PHI 없음', async () => {
    const { settlementQrPayload } = await import('@/app/(main)/inpatient/[admissionId]/DischargeSettlementPrint');
    const j = JSON.stringify(settlementQrPayload({ admissionId: 'a1', at: 'x', balanceKnown: true }));
    for (const phi of ['박', '정산', 'MRN-7']) expect(j).not.toContain(phi);
  });

  it('카드가 인쇄본을 그린다', () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/inpatient/[admissionId]/page.tsx'), 'utf8');
    expect(src).toMatch(/<DischargeSettlementPrint admissionId=\{admissionId\} settlement=\{s\}/);
  });
});
