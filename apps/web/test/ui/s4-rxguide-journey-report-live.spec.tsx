/**
 * S4(2026-09-15) — 화면 3종.
 *  ① 처방 설명 가이드: 마스터 미연결은 "마스터 미등록"(약 정보 지어내지 않음) · 빈 처방은 빈 상태 · 조회 실패는 오류(없음 아님)
 *  ② 기간 보고서: 간격 null 은 "산출 불가"(0 아님) · 기간 고르기 전엔 조회하지 않는다
 *  ③ 관제 실시간 배지: 끊김·권한 없음을 말한다(폴링은 끄지 않는다 — 소스 대조)
 *  ④ 새 키가 활성 축(en·ja)에서 조회된다
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tOf } from '@hospital-run/shared';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api-client')>()),
  apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => null },
}));

import { RxGuidePanel } from '@/app/(main)/workstation/outpatient-nursing/RxGuidePanel';
import { JourneyReportPanel } from '@/app/(main)/patients/[id]/components/JourneyReportPanel';
import { LiveStreamBadge } from '@/app/(main)/journey-console/live-stream';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => get.mockReset());

describe('① 처방 설명 가이드', () => {
  it('마스터 미연결 처방은 "마스터 미등록"으로 — 약 이름을 지어내지 않는다', async () => {
    get.mockResolvedValue({ data: { encounterId: 'e1', truncated: false, limit: 200, items: [
      { prescriptionId: 'r1', order: { dosage: '1정', frequency: 'TID', durationDays: 3, quantity: 9, route: 'PO', prescriberInstructions: null, priority: 'ROUTINE', dispensingType: 'EXTERNAL' }, medication: null },
    ] } });
    wrap(<RxGuidePanel encounterId="e1" />);
    expect(await screen.findByTestId('rx-no-master')).toBeTruthy();
    expect(screen.getByText('TID')).toBeTruthy();
  });

  it('처방이 없으면 빈 상태 · 조회 실패는 빈 상태가 아니다', async () => {
    get.mockResolvedValueOnce({ data: { encounterId: 'e1', truncated: false, limit: 200, items: [] } });
    const { unmount } = wrap(<RxGuidePanel encounterId="e1" />);
    expect(await screen.findByText('이 진료에 약 처방이 없습니다')).toBeTruthy();
    unmount();
    get.mockRejectedValueOnce(new Error('boom'));
    wrap(<RxGuidePanel encounterId="e2" />);
    await waitFor(() => expect(screen.queryByText('이 진료에 약 처방이 없습니다')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('rx-guide')).toBeNull());
  });
});

describe('② 기간 보고서', () => {
  it('기간을 고르기 전엔 조회하지 않고, 간격 null 은 "산출 불가"로 그린다', async () => {
    get.mockResolvedValue({ data: {
      period: { from: null, to: null, source: 'RANGE' },
      events: { total: 2, truncated: false, byType: [{ eventType: 'LAB_RESULT', count: 2 }], firstAt: '2026-09-01T01:00:00Z', lastAt: '2026-09-01T02:00:00Z' },
      intervals: { erStayMinutes: 90, admitToSurgeryMinutes: null, surgeryMinutes: null },
      counts: { prescriptionAdded: 0, labResult: 2, imagingResult: 0 },
    } });
    const { container } = wrap(<JourneyReportPanel patientId="p1" />);
    expect(get).not.toHaveBeenCalled();
    const [from, to] = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(from, { target: { value: '2026-09-01' } });
    fireEvent.change(to, { target: { value: '2026-09-02' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/v1/journey/p1/report?from=2026-09-01&to=2026-09-02'));
    const na = await screen.findAllByTestId('interval-na');
    expect(na).toHaveLength(2);
    // (2026-10-01 P3 UX) 유형은 표시 정본 라벨로 — 원 코드는 title(마우스 오버)로만 남는다
    expect(screen.getByText('검사 결과')).toBeTruthy();
    expect(container.querySelector('[title="LAB_RESULT"]')).not.toBeNull();
  });
});

describe('③ 관제 실시간 배지', () => {
  it.each(['live', 'disconnected', 'unauthorized', 'connecting'] as const)('%s 상태를 그린다', (st) => {
    const { container } = render(<LiveStreamBadge status={st} />);
    expect(container.querySelector(`[data-status="${st}"]`)).toBeTruthy();
  });

  it('스트림이 있어도 폴링(refetchInterval)을 끄지 않는다 · 401/403 은 재시도하지 않는다', () => {
    const page = readFileSync(resolve(__dirname, '../../src/app/(main)/journey-console/page.tsx'), 'utf8');
    expect(page).toMatch(/useJourneyConsoleStream\(/);
    expect(page).toMatch(/queryKey: \['jc-board', query\][\s\S]{0,200}refetchInterval: pollFast/);
    const hook = readFileSync(resolve(__dirname, '../../src/app/(main)/journey-console/live-stream.tsx'), 'utf8');
    expect(hook).toMatch(/res\.status === 401 \|\| res\.status === 403\) \{ setStatus\('unauthorized'\); return; \}/);
  });
});

describe('④ 새 키 조회', () => {
  const KEYS = [
    '실시간 연결됨', '실시간 연결 끊김 — 주기 갱신 중', '실시간 갱신 권한 없음 — 주기 갱신만', '실시간 연결 중',
    '이 진료에 약 처방이 없습니다', '마스터 미등록 처방', '보관@약품', '임부 분류', '유사명칭 그룹', '처방의 지시(원문)', '진료 후 처방 설명',
    '처방·약품 마스터에 등록된 값 그대로입니다 — 용법·주의 문구는 만들지 않습니다', '처방이 많아 앞의 {건수}건만 표시합니다',
    '기간 보고서', '시작일과 종료일을 고르면 보고서를 만듭니다', '기록된 이벤트 {건수}건', '조회 상한에 걸려 일부만 집계했습니다',
    '응급실 체류', '입원→수술 시작', '수술 시간', '이 기간에 기록된 여정 이벤트가 없습니다',
    '여정 이벤트는 기록이 배선된 행위만 남습니다 — 0건은 그 일이 없었다는 뜻이 아닐 수 있습니다',
  ];
  it.each(['en', 'ja'])('%s 에서 전부 조회된다', (loc) => {
    const missing = KEYS.filter((k) => tOf(k, loc).missing);
    expect(missing).toEqual([]);
  });
  it('보관@약품 은 "보관(Archived)"과 다른 뜻으로 번역된다', () => {
    expect(tOf('보관@약품', 'en').text).toBe('Storage');
  });
});
