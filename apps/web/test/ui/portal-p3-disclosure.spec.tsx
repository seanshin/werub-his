/**
 * 환자 포털 세련화 P3 — 공개 범위(2026-10-20 · 결정 등록부 배치 10-J · 사용자 지시).
 *  · B8 검사: 🔴 판정이 비어 있으면(의료진 확인 전) 홈 미리보기가 초록 "정상"을 그렸다(P17) → "확인 전"
 *  · B6 예상 진료비: 늘 "예측 자료"를 먼저 · 모르면 금액 대신 "산출 불가" · 펼치기 전에는 부르지 않는다
 *  · B2 진료 후 요약: 펼치기 전 미호출 · 추정 진단 표기 · 의사 소견 원문을 그리는 자리 없음
 *  · B4 의료진 추이 패널: 🔴 환자 입력 최신값으로 "목표 미달" 경고를 내지 않는다 · 대조군 의료진 측정은 경고
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const api = vi.hoisted(() => ({ get: vi.fn(async (_url: string): Promise<unknown> => ({ data: [] })), post: vi.fn(), put: vi.fn(), getToken: () => 't', setToken: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

const wrap = (el: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>);
beforeEach(() => { cleanup(); api.get.mockReset(); });

describe('🔴 B8 홈 새 검사결과 — 판정이 없으면 "정상"이라 말하지 않는다', () => {
  async function home(items: unknown[]) {
    localStorage.setItem('portal-onboarding-done', 'true');
    api.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/portal/er-status') return { data: null };
      if (url.includes('registration-consents')) return { data: { requiredComplete: true, consents: [{ type: 'A', required: true, agreed: true }] } };
      return { data: url.includes('session') ? { kind: 'MRN', features: {}, expiresAt: null, services: { inpatientLife: false } } : [] };
    });
    const { default: HomeTab } = await import('@/app/portal/_home/HomeTab');
    const data = { appointments: [], encounters: [], labResults: [{ id: 'l1', orderName: 'CBC', orderedAt: '2026-10-18', items }], diagnosticTests: [], billings: [], allergies: [], medications: [], questionnaires: [] };
    let v!: ReturnType<typeof render>;
    await act(async () => { v = wrap(<HomeTab patient={{ id: 'p1', mrn: 'M' } as never} data={data as never} onNavigate={() => {}} />); });
    return v;
  }
  it('확인 전(판정 비움) → "확인 전" · "정상" 없음', async () => {
    const v = await home([{ name: 'Na', value: '149', unit: 'mmol/L', flag: '', judgmentPending: true }]);
    await waitFor(() => expect(v.container.querySelector('[data-portal-home-judgment-pending]')).not.toBeNull());
    expect(v.container.querySelector('[data-portal-home-judgment-pending]')!.textContent).toContain('확인 전');
    expect(v.container.textContent).not.toMatch(/정상/);
  });
  it('대조군 — 확인된 정상(N)은 "정상" · 높음(H)은 "주의"', async () => {
    const v = await home([{ name: 'Na', value: '140', unit: 'mmol/L', flag: 'N' }, { name: 'K', value: '5.6', unit: 'mmol/L', flag: 'H' }]);
    await waitFor(() => expect(v.container.textContent).toContain('정상'));
    expect(v.container.textContent).toContain('주의');
    expect(v.container.querySelector('[data-portal-home-judgment-pending]')).toBeNull();
  });
});

describe('🔴 B6 예상 진료비 — 예측 자료', () => {
  const est = (consultation: object, recent: object) => ({ data: { appointmentId: 'a1', estimate: true, consultation: { code: 'AA257', name: '재진', visitKind: 'FOLLOW_UP', totalAmount: null, patientCopay: null, basis: 'ELIGIBILITY', unknownReason: null, ...consultation }, recent: { department: '내과', sampleSize: 0, min: null, max: null, ...recent } } });
  it('펼치기 전 미호출 · 펼치면 "예측 자료" 먼저 · 단가 모름 → 금액 대신 이유(0원 아님) · 표본 0 → 알 수 없음', async () => {
    api.get.mockResolvedValue(est({ unknownReason: 'CONSULT_PRICE_UNKNOWN' }, {}));
    const { CostEstimatePanel } = await import('@/app/portal/_care/CostEstimatePanel');
    const v = wrap(<CostEstimatePanel appointmentId="a1" />);
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(v.container.querySelector('[data-portal-cost-estimate-toggle]')!);
    await waitFor(() => expect(v.container.querySelector('[data-portal-cost-consult-unknown]')).not.toBeNull());
    expect(api.get).toHaveBeenCalledWith('/api/v1/portal/appointments/a1/cost-estimate');
    expect(v.container.querySelector('[data-portal-cost-estimate-disclaimer]')!.textContent).toContain('예측 자료');
    expect(v.container.querySelector('[data-portal-cost-consult-unknown]')!.textContent).toContain('단가를 알 수 없어');
    expect(v.container.textContent).not.toMatch(/(^|[^0-9,])0원/);
    expect(v.container.querySelector('[data-portal-cost-recent-none]')).not.toBeNull();
  });
  it('대조군 — 금액이 있으면 금액 · 최근 범위는 표본 수와 함께 · 자격 미확인이면 가정치라고 말한다', async () => {
    api.get.mockResolvedValue(est({ patientCopay: 4010, totalAmount: 13370, basis: 'INSURANCE_TYPE_FALLBACK' }, { sampleSize: 3, min: 4000, max: 12500 }));
    const { CostEstimatePanel } = await import('@/app/portal/_care/CostEstimatePanel');
    const v = wrap(<CostEstimatePanel appointmentId="a1" />);
    fireEvent.click(v.container.querySelector('[data-portal-cost-estimate-toggle]')!);
    await waitFor(() => expect(v.container.querySelector('[data-portal-cost-consult]')?.textContent).toContain('4,010'));
    const r = v.container.querySelector('[data-portal-cost-recent]')!.textContent!;
    expect(r).toContain('4,000');
    expect(r).toContain('12,500');
    expect(r).toMatch(/3\s*회/);
    expect(v.container.textContent).toContain('보험 유형 기준');
  });
});

describe('B2 진료 후 요약 — 일반 수준', () => {
  it('펼치기 전 미호출 · 진단(추정 표기)·약·다음 예약·연락처 · 의사 소견을 그리지 않는다', async () => {
    api.get.mockResolvedValue({ data: {
      encounterId: 'e1', visitedAt: '2026-10-18T01:00:00Z', department: '내과', doctorName: '김의사',
      diagnoses: [{ name: '2형 당뇨병', code: 'E11', primary: true, provisional: true }],
      medications: [{ name: '메트포르민', dosage: '500mg', frequency: 'BID', durationDays: 30, route: 'PO', instructions: null, discontinued: false, dischargeMed: false }],
      orders: [], nextAppointment: null, hospitalPhone: '02-000-0000',
      assessment: '이 문장은 보이면 안 된다',
    } });
    const { VisitSummaryPanel } = await import('@/app/portal/_care/VisitSummaryPanel');
    const v = wrap(<VisitSummaryPanel encounterId="e1" />);
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(v.container.querySelector('[data-portal-visit-summary-toggle]')!);
    await waitFor(() => expect(v.container.textContent).toContain('2형 당뇨병'));
    expect(v.container.textContent).toContain('추정');
    expect(v.container.textContent).toContain('메트포르민');
    expect(v.container.textContent).toContain('30일');
    expect(v.container.textContent).toContain('02-000-0000');
    expect(v.container.textContent).toContain('잡힌 예약이 없습니다');
    expect(v.container.textContent).not.toContain('보이면 안 된다');
  });
  it('구조 — 진료 이력 카드·AI 요약이 소견 원문 필드를 읽지 않는다', () => {
    const care = readFileSync('src/app/portal/_care/CareTab.tsx', 'utf8');
    const page = readFileSync('src/app/portal/page.tsx', 'utf8');
    expect(care).not.toMatch(/assessmentSummary|planNote/);
    expect(page).not.toMatch(/e\.assessment|e\.plan\b/);
  });
});

describe('🔴 B4 의료진 추이 패널 — 환자 입력은 참고용', () => {
  const resp = (summary: object, patientReported: boolean) => ({ data: {
    series: { SBP: [
      { value: 130, measuredAt: '2026-09-01', flag: 'H', normalMin: null, normalMax: 120, patientReported: false },
      { value: 165, measuredAt: '2026-10-01', flag: 'H', normalMin: null, normalMax: 120, patientReported },
    ] },
    summary: { SBP: { latest: 165, unit: 'mmHg', measuredAt: '2026-10-01', delta: 35, count: 2, ...summary } },
  } });
  it('최신이 환자 입력 165 · 의료진 측정 130 → 목표 미달 경고 없음 · "환자 입력 · 참고용" 표식', async () => {
    api.get.mockResolvedValue(resp({ latestPatientReported: true, patientReportedCount: 1, clinical: { latest: 130, measuredAt: '2026-09-01' } }, true));
    const { ChronicTrendPanel } = await import('@/app/(main)/patients/[id]/components/ChronicTrendPanel');
    const v = wrap(<ChronicTrendPanel patientId="p1" />);
    await waitFor(() => expect(v.container.querySelector('[data-patient-reported-latest]')).not.toBeNull());
    expect(v.container.textContent).not.toContain('관리 목표 미달');
    expect(v.container.querySelector('[data-patient-reported-note]')).not.toBeNull();
    expect(v.container.querySelector('circle[data-patient-reported]')).not.toBeNull();
  });
  it('🔴 최신이 환자 입력 118(정상) 이어도 의료진 측정 165 면 경고 — 환자 입력이 의료진 판정을 지우지 않는다', async () => {
    api.get.mockResolvedValue(resp({ latest: 118, latestPatientReported: true, patientReportedCount: 1, clinical: { latest: 165, measuredAt: '2026-09-01' } }, true));
    const { ChronicTrendPanel } = await import('@/app/(main)/patients/[id]/components/ChronicTrendPanel');
    const v = wrap(<ChronicTrendPanel patientId="p1" />);
    await waitFor(() => expect(v.container.textContent).toContain('관리 목표 미달'));
    expect(v.container.textContent).toMatch(/혈압 165/);
  });
  it('대조군 — 의료진 측정 165 면 경고', async () => {
    api.get.mockResolvedValue(resp({ latestPatientReported: false, patientReportedCount: 0, clinical: { latest: 165, measuredAt: '2026-10-01' } }, false));
    const { ChronicTrendPanel } = await import('@/app/(main)/patients/[id]/components/ChronicTrendPanel');
    const v = wrap(<ChronicTrendPanel patientId="p1" />);
    await waitFor(() => expect(v.container.textContent).toContain('관리 목표 미달'));
    expect(v.container.querySelector('[data-patient-reported-latest]')).toBeNull();
  });
});

describe('B8 화면 정본 — 판정 대기·AI 해석', () => {
  it('구조 — 확인 전 결과에는 AI 해석을 부르지 않고 "확인 전"을 그리며, 최근 요약은 확인 전을 "없음"으로 말하지 않는다', () => {
    const src = readFileSync('src/app/portal/_health/HealthTab.tsx', 'utf8');
    expect(src).toMatch(/lr\.release !== 'AWAITING_REVIEW' && <PortalAiLabExplain/);
    expect(src).toMatch(/item\.judgmentPending\s*\?/);
    expect(src).toMatch(/pending > 0 \? null : <p/);
  });
  it('기초검사 매핑 — 공개 상태를 그대로 · 모르면 null', async () => {
    const { toDiagnosticTest, encounterDiagnosisNames } = await import('@/app/portal/_helpers');
    expect(toDiagnosticTest({ id: 'd', testName: 'ECG', release: 'AWAITING_REVIEW', reviewedAt: null })).toMatchObject({ release: 'AWAITING_REVIEW', conclusion: null });
    expect(toDiagnosticTest({ id: 'd', testName: 'ECG' }).release).toBeNull();
    expect(encounterDiagnosisNames([{ certainty: 'PROVISIONAL', diagnosisCode: { nameKo: '폐렴' } }, { diagnosisCode: { nameKo: '고혈압' } }])).toEqual(['폐렴 (추정)', '고혈압']);
  });
});
