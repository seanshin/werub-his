/**
 * 임상 기록 창 인쇄본(2026-10-12 사용자 "나머지 인쇄 화면도 같은 방식으로 정돈") — 기록 상세·환자/입원 시계열.
 *  · 🔴 종전 인쇄는 빈 종이(공용 문서 CSS) → 인쇄 전용 문서를 body 직하 `.doc-print-root` 에
 *  · 없는 칸은 싣지 않는다 · 활력은 잰 것만 · 검사 미판정은 "판정 불가"(정상 아님)
 *  · 행별 기계 코드 없음 — 사람 확인 칸(☐) · 서명란 · 문서 QR·sha256
 *  · QR 에 이름·등록번호 없음 · 시계열은 날짜별 묶음 · 잘렸으면 맨 위에 고지
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtl, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TItem } from '@/components/record-timeline/record-card';

vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: vi.fn(), post: vi.fn(), getToken: () => 'x', setToken: vi.fn() } }));
const render = (ui: React.ReactElement) => rtl(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
beforeEach(() => { cleanup(); document.body.querySelectorAll('.doc-print-root').forEach((e) => e.remove()); });
const root = () => document.body.querySelector(':scope > .doc-print-root')!;

const PID = '00000000-0000-4000-8000-000000000001';
const ENC: TItem = { type: 'ENCOUNTER', id: 'enc-1', at: '2026-10-11T01:00:00.000Z', status: 'COMPLETED', visitType: '초진', title: '두통', soap: { S: '3일째 두통', A: '긴장성 두통' }, diagnoses: [{ code: 'G44.2', name: '긴장성 두통', type: 'PRIMARY' }] };
const LAB: TItem = { type: 'LAB', id: 'lab-1', at: '2026-10-11T02:00:00.000Z', status: 'VERIFIED', title: 'CBC',
  results: [{ name: 'WBC', value: '12.1', unit: '10³/µL', flag: 'H', refLow: 4, refHigh: 10 }, { name: 'Hb', value: '13.5', unit: 'g/dL', flag: 'N', refLow: 12, refHigh: 16 }, { name: 'CRP', value: '0.4', unit: 'mg/dL', flag: null, refLow: null, refHigh: null }] };
const VIT: TItem = { type: 'VITALS', id: 'vs-1', at: '2026-10-10T10:00:00.000Z', vitals: { bp: '120/80', hr: 0, temp: null, spo2: 97 } };
const NUR: TItem = { type: 'NURSING', id: 'nur-1', at: '2026-10-10T09:00:00.000Z', dar: { D: '불안 호소', A: '설명' } };
const SUBJ = { name: '홍길동', mrn: 'MRN-0001' };

describe('기록 상세 인쇄본', () => {
  it('🔴 body 직하 인쇄 루트 · 종류별 칸 · 검사 판정 정본 · 서명란 · 행 코드 없음', async () => {
    const { RecordDetailPrint } = await import('@/components/record-timeline/RecordPrintBody');
    render(<RecordDetailPrint item={LAB} patient={SUBJ} patientId={PID} />);
    await waitFor(() => expect(root()?.querySelector('[data-print-doc-hash]')?.textContent).toMatch(/[0-9a-f]{64}/));
    const r = root();
    expect(r.querySelector('[data-print-doc="RECORD_DETAIL"]')).toBeTruthy();
    const judge = [...r.querySelectorAll('[data-print-results] tbody tr')].map((tr) => tr.lastElementChild!.textContent);
    expect(judge).toEqual(['상회(H)', '정상', '판정 불가']);
    expect(r.querySelector('[data-print-results]')!.textContent).toContain('참고범위 없음');
    expect(r.querySelector('[data-print-signoff]')).toBeTruthy();
    expect(r.querySelector('[data-print-results]')!.textContent).not.toMatch(/\b[0-9a-f]{8}\b/);
    expect(r.textContent).toContain('홍길동');
  });
  it('🔴 활력은 잰 것만 — 0 은 측정값으로 싣고 null 은 싣지 않는다', async () => {
    const { RecordDetailPrint } = await import('@/components/record-timeline/RecordPrintBody');
    render(<RecordDetailPrint item={VIT} patient={SUBJ} patientId={PID} />);
    await waitFor(() => expect(root()?.querySelector('[data-print-vitals]')).toBeTruthy());
    const t = root().querySelector('[data-print-vitals]')!.textContent!;
    expect(t).toContain('맥박0 /분');
    expect(t).toContain('SpO₂97 %');
    expect(t).not.toContain('체온');
  });
  it('진료기록 — SOAP 중 있는 것만 · 진단 표', async () => {
    const { recordKvRows } = await import('@/components/record-timeline/RecordPrintBody');
    const keys = recordKvRows(ENC).map(([k]) => k);
    expect(keys).toContain('S 주관적');
    expect(keys).toContain('A 평가');
    expect(keys).not.toContain('O 객관적');
    expect(keys).not.toContain('P 계획');
  });
  it('🔴 QR 에 이름·등록번호가 없다', async () => {
    const { recordDetailQrPayload, recordTimelineQrPayload } = await import('@/components/record-timeline/RecordPrintBody');
    const a = JSON.stringify(recordDetailQrPayload(LAB, PID));
    const b = JSON.stringify(recordTimelineQrPayload({ patientId: PID, admissionId: 'adm-1', n: 3, total: 3, printedFrom: null }));
    for (const s of [a, b]) { expect(s).not.toContain('홍길동'); expect(s).not.toContain('MRN-0001'); expect(s).toContain(PID); }
    // 🔴 실을 수 있는 칸을 못박는다(제목·본문이 QR 로 새지 않게)
    expect(Object.keys(recordDetailQrPayload(LAB, PID)).sort()).toEqual(['at', 'id', 'patientId', 't', 'type', 'v']);
    expect(Object.keys(recordTimelineQrPayload({ patientId: PID, n: 1, total: 1, printedFrom: null })).sort()).toEqual(['admissionId', 'from', 'n', 'patientId', 't', 'total', 'v']);
  });
});

describe('시계열 인쇄본', () => {
  it('🔴 날짜별 묶음 · 조건 줄 · 사람 확인 칸 · 잘림 고지', async () => {
    const { RecordTimelinePrint } = await import('@/components/record-timeline/RecordPrintBody');
    render(<RecordTimelinePrint items={[LAB, ENC, VIT, NUR]} patientId={PID} admissionId="adm-1" scopeLabel="입원 기간 기록 시계열" subject={SUBJ}
      period="입원 기간 2026-10-01 ~ 재원 중" conditions="기간 3개월 · 유형 전체" truncatedTracks={['LAB']} total={10} />);
    await waitFor(() => expect(root()?.querySelector('[data-print-doc-hash]')?.textContent).toMatch(/[0-9a-f]{64}/));
    const r = root();
    const days = [...r.querySelectorAll('[data-print-day]')].map((d) => d.getAttribute('data-print-day'));
    expect(days.length).toBe(2);
    expect(new Set(days).size).toBe(2);
    expect(r.querySelectorAll('[data-print-row]').length).toBe(4);
    for (const row of r.querySelectorAll('[data-print-row]')) {
      expect(row.lastElementChild!.textContent).toContain('☐');
      expect(row.textContent).not.toMatch(/\b[0-9a-f]{8}\b/);
    }
    const tr = r.querySelector('[data-print-truncated]')!.textContent!;
    expect(tr).toContain('검사결과');
    expect(tr).toContain('전체 10건 중 4건');
    expect(r.textContent).toContain('입원 기간 2026-10-01');
    expect(r.textContent).toContain('기간 3개월 · 유형 전체');
    expect(r.querySelector('[data-print-row="LAB:lab-1"]')!.textContent).toContain('WBC 12.1');
    // DAR 만 있는 간호기록도 요약이 빈칸이 아니다
    expect(r.querySelector('[data-print-row="NURSING:nur-1"]')!.textContent).toContain('D: 불안 호소');
  });
  it('🔴 유형 잘림이 없어도 다 불러오지 않았으면 고지한다', async () => {
    const { RecordTimelinePrint } = await import('@/components/record-timeline/RecordPrintBody');
    render(<RecordTimelinePrint items={[ENC]} patientId={PID} scopeLabel="임상 기록 통합 시계열" subject={SUBJ} conditions="기간 전체 · 유형 전체" truncatedTracks={[]} total={300} />);
    await waitFor(() => expect(root()?.querySelector('[data-print-truncated]')?.textContent).toContain('전체 300건 중 1건'));
  });
  it('대조군 — 잘리지 않았으면 고지 없음 · 빈 조건은 빈 표 대신 문장', async () => {
    const { RecordTimelinePrint } = await import('@/components/record-timeline/RecordPrintBody');
    render(<RecordTimelinePrint items={[]} patientId={PID} scopeLabel="임상 기록 통합 시계열" subject={null} conditions="기간 1개월 · 유형 전체" truncatedTracks={[]} total={0} />);
    await waitFor(() => expect(root()?.querySelector('[data-print-empty]')).toBeTruthy());
    expect(root().querySelector('[data-print-truncated]')).toBeNull();
  });
  it('새 창 둘이 인쇄본을 넘긴다 · 내장 모드는 넘기지 않는다', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (p: string) => readFileSync(join(__dirname, '../../src', p), 'utf8');
    expect(read('app/record-timeline/patient/[patientId]/page.tsx')).toMatch(/<RecordTimelineView patientId=\{patientId\} print=\{/);
    expect(read('app/record-timeline/admission/[admissionId]/page.tsx')).toMatch(/print=\{\{ scopeLabel: '입원 기간 기록 시계열'/);
    expect(read('app/record-detail/[type]/[id]/page.tsx')).toMatch(/<RecordDetailPrint item=\{item\}/);
    expect(read('components/record-timeline/RecordTimelineView.tsx')).toMatch(/\{print && resp && \(/);
  });
});
