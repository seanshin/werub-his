/**
 * 환자 차트 첫 화면(개요) — 진료 전 요약(2026-10-02 실측 환자 강민준 P2026-1152).
 *  🔴 종전: 'AI 환자 요약'은 건수만 넘긴 3줄(활성 처방 34건 = 검사·영상 포함 · 문제 목록이 비었을 뿐인데 "활성 문제: 없음")
 *     · '활성 처방' 카드가 영상 오더를 처방으로 · 같은 약 3건 활성·기간 지난 처방을 드러내지 않음
 *     · '최근 진료'가 빈 임시 기록 14건으로 서명 진료 4건을 밀어냄 · '7일 이상수치'가 전 기간(서버가 days 를 안 받음)
 *     · 차트를 열 때마다 AI 추이 해석 자동 호출(미확인 결과만 · 출력에 중국어 · HbA1c 7.2% 를 "정상")
 * 재주입: 진단 출처 표시·중복/기간 배지·최신값 기준·AI 자동 호출 차단·빈 초안 제외를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(async () => ({ data: {} })), getToken: () => null } }));
let role = 'DOCTOR';
vi.mock('@/hooks/use-admin-write', () => ({ useHasRole: (...roles: string[]) => role === 'ADMIN' || roles.includes(role) }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const P = '00000000-0000-4000-a000-000000d00480';
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const brief = {
  computedAt: ago(0), trigger: 'LAZY', basis: [], activeMedications: ['아토르바스타틴', '로사르탄'],
  medicationDetails: [
    { name: '아토르바스타틴', dosage: '10mg', frequency: '1일 1회', latestPrescribedAt: ago(58), durationDays: 28, overDuration: true, count: 3 },
    { name: '로사르탄', dosage: '50mg', frequency: '1일 1회', latestPrescribedAt: ago(2), durationDays: 28, overDuration: false, count: 1 },
  ],
  activeProblems: [],
  recordDiagnoses: [
    { code: 'J18.9', name: '폐렴', lastAt: ago(85), encounters: 1, diagnosisCodeId: 'dc-j', onProblemList: false },
    { code: 'I10', name: '본태성 고혈압', lastAt: ago(214), encounters: 2, diagnosisCodeId: 'dc-i', onProblemList: false },
  ],
  recentLabs: [], abnormalLabCount: 0, lastLabAt: ago(58),
  lastEncounter: { at: ago(85), chiefComplaint: '기침·발열 3일', assessment: '지역사회획득 폐렴(J18.9)', status: 'SIGNED' },
  currentAdmission: null, unavailable: [],
};

beforeEach(() => { get.mockReset(); role = 'DOCTOR'; });
afterEach(() => cleanup());

describe('진료 전 요약 카드', () => {
  it('🔴 문제 목록이 비어도 진료 기록 진단을 출처와 함께 · 정리 안 됐다고 말한다 · 마지막 서명 진료 · 30일 창이 비면 마지막 검사', async () => {
    get.mockResolvedValue({ data: brief });
    const { PatientBriefCard } = await import('@/app/(main)/patients/[id]/components/PatientBriefCard');
    const { container } = wrap(<PatientBriefCard patientId={P} onTabChange={() => {}} />);
    await waitFor(() => expect(container.querySelector('[data-brief-card]')).not.toBeNull());
    const dx = container.querySelector('[data-brief-diagnoses]')!.textContent!;
    expect(dx).toContain('진료 기록 진단(서명)');
    expect(dx).toContain('본태성 고혈압');
    // 🔴 (10-03) 진단마다 문제 목록 등재 여부 — 일부만 정리된 경우도 말한다(종전 완전히 빈 경우만)
    expect(dx).toContain('진료 기록 진단 2개 중 2개가 문제 목록에 없습니다');
    expect(container.querySelectorAll('[data-on-problem-list="false"]').length).toBe(2);
    expect(container.querySelector('[data-brief-last-encounter]')!.textContent).toContain('지역사회획득 폐렴');
    expect(container.querySelector('[data-brief-labs]')!.textContent).toMatch(/최근 30일 검사 없음.*마지막 검사.*58일 전/);
    expect(container.querySelector('[data-brief-meds]')!.textContent).toMatch(/2종.*처방 기간 지남 1/);
    expect(get.mock.calls[0][0]).toBe(`/api/v1/ai/brief/${P}`);
  });

  it('권한 밖(원무)은 부르지 않고 그 사실만', async () => {
    role = 'RECEPTIONIST';
    const { PatientBriefCard } = await import('@/app/(main)/patients/[id]/components/PatientBriefCard');
    const { container } = wrap(<PatientBriefCard patientId={P} onTabChange={() => {}} />);
    expect(container.querySelector('[data-brief-gated]')?.textContent).toContain('비어 있다는 뜻이 아닙니다');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('활성 투약 카드', () => {
  it('🔴 약 단위 · 같은 처방 여러 건 활성·처방 기간 지남을 드러낸다 · 전체 활성 오더 수는 따로', async () => {
    get.mockResolvedValue({ data: brief });
    const { ActiveMedicationsCard } = await import('@/app/(main)/patients/[id]/components/PatientBriefCard');
    const { container } = wrap(<ActiveMedicationsCard patientId={P} onTabChange={() => {}} totalActiveOrders={34} />);
    await waitFor(() => expect(container.querySelectorAll('[data-med-row]').length).toBe(2));
    expect(container.querySelectorAll('[data-med-dup]').length).toBe(1);
    expect(container.querySelector('[data-med-dup]')!.textContent).toContain('3건');
    expect(container.querySelectorAll('[data-med-over]').length).toBe(1);
    expect(container.textContent).toContain('활성 오더 전체 34건');
  });
});

describe('검사 이상 수치 — 항목별 최신값', () => {
  it('🔴 옛 이상값이 최신 정상값에 덮이면 싣지 않는다 · 최신 이상값만 · 마지막 검사 시각', async () => {
    const { latestAbnormalByTest } = await import('@/app/(main)/patients/[id]/components/OverviewTab');
    const r = latestAbnormalByTest([
      { completedAt: '2026-07-30T03:00:00Z', items: [{ testName: 'Glucose', value: '646', unit: 'mg/dL', flag: 'HH' }, { testName: 'Creatinine', value: '1.83', unit: 'mg/dL', flag: 'H' }] },
      { completedAt: '2026-08-05T03:00:00Z', items: [{ testName: 'Glucose', value: '98', unit: 'mg/dL', flag: 'N' }, { testName: 'Creatinine', value: '1.75', unit: 'mg/dL', flag: 'H' }] },
    ]);
    expect(r.rows.map((x) => `${x.testName}=${x.value}`)).toEqual(['Creatinine=1.75']);
    expect(r.lastAt).toBe('2026-08-05T03:00:00Z');
  });
});

describe('개요 탭 — 검사 추이·최근 진료', () => {
  const routes = (aiTrend?: unknown) => async (u: string) => {
    if (u.includes('/ai/brief/')) return { data: brief };
    if (u.includes('/record-timeline/analytics')) return { data: { analytes: [
      { key: 'cr', kind: 'LAB', name: 'Creatinine', unit: 'mg/dL', n: 4, first: { at: ago(64), value: 0.44 }, last: { at: ago(58), value: 1.75 }, rangeMove: 'LEFT', series: [] },
      { key: 'hb', kind: 'LAB', name: 'Hb', unit: 'g/dL', n: 3, first: { at: ago(64), value: 13 }, last: { at: ago(58), value: 13.5 }, rangeMove: 'STAYED_IN', series: [] },
    ] } };
    if (u.includes('/ai-trend')) return { data: aiTrend };
    return { data: [] };
  };

  it('🔴 AI 추이 해석은 자동으로 부르지 않는다 — 결정론 추이(범위를 넘나든 항목만)를 먼저 · 요청하면 부르고 다른 언어 섞임을 경고', async () => {
    get.mockImplementation(routes({ source: 'AI', trend: { answer: 'HbA1c 7.2% 在正常范围内' }, qualityWarnings: ['MIXED_SCRIPT'] }));
    const { OverviewTab } = await import('@/app/(main)/patients/[id]/components/OverviewTab');
    const { container } = wrap(<OverviewTab patientId={P} recentEncounters={[]} encountersLoading={false} billings={[]} billingsLoading={false} totalBillingAmount={0} paidBillings={0} onTabChange={() => {}} userRole="DOCTOR" emptyDraftCount={14} />);
    await waitFor(() => expect(container.querySelector('[data-lab-trend]')?.getAttribute('data-lab-trend')).toBe('1'));
    expect(container.querySelector('[data-lab-trend]')!.textContent).toContain('범위 안 → 밖');
    expect(get.mock.calls.some((c) => String(c[0]).includes('/ai-trend'))).toBe(false);
    fireEvent.click(container.querySelector('[data-ask-ai-trend]')!);
    await waitFor(() => expect(container.querySelector('[data-ai-mixed-script]')).not.toBeNull());
    // 빈 임시 기록만 있으면 "진료 기록이 없다"가 아니라 그 수를 말한다
    expect(container.textContent).toContain('빈 임시 기록 14건');
  });

  it('🔴 최근 진료는 내용 있는 기록만 — 화면이 빈 초안을 걸러 넘긴다(기계 대조)', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/(main)/patients/[id]/page.tsx'), 'utf8');
    expect(page).toMatch(/const recentEncounters = visibleEncounters\.slice\(0, 5\);/);
    expect(page).toMatch(/emptyDraftCount=\{draftCount\}/);
    // 종전 AI 요약(환자 설명문 EP 를 빌려 건수만 넘기던 것)이 돌아오지 않는다
    const ov = readFileSync(join(process.cwd(), 'src/app/(main)/patients/[id]/components/OverviewTab.tsx'), 'utf8');
    expect(ov).not.toMatch(/ai\/explain/);
    expect(ov).not.toMatch(/results\?days=7/);
  });
});
