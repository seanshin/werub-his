import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * 가드 — `Promise.all` 안에서 실패가 조용히 사라지던 자리 (2026-08-21)
 *
 * 🔴 `Promise.all([...])` 안에서 `.catch(() => null | [] | {})` 로 접으면 한 조각이 실패해도
 *    전체는 성공이 되고, 화면은 그것을 **"없음/0"** 으로 읽는다. 이 저장소에서 이미 두 번
 *    확인된 유형이다(간호 스테이션 — 환자 1명 조회 실패가 그 환자만 목록에서 지웠다 /
 *    치료 캘린더 — 하루치 실패가 "예약 없음"으로 보였다).
 *
 * 여기서 지키는 사실 — **각 항목은 결함을 재주입하면 실패한다**:
 *   · 증명서 워크스테이션: 유형별 조회 실패가 큐에서 조용히 빠지지 않는다(+부분 성공은 살린다)
 *   · 미디어 라이브러리/피커: 조회 실패를 "파일이 없습니다"·"이미지가 없습니다"로 말하지 않는다
 *   · 미디어 라이브러리 헤더: 조회 실패를 영구 '로딩 중...' 으로 굳히지 않는다
 *   · CRM 분석/자동화: 실패한 패널이 이름 없이 사라지지 않는다
 */

const { get, post, del, fetchFn } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  fetchFn: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (p: string, q?: unknown) => get(p, q),
    post: (p: string, b?: unknown) => post(p, b),
    del: (p: string) => del(p),
    fetch: (p: string, o?: unknown) => fetchFn(p, o),
    getToken: () => 't',
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import CertificateWorkstationPage from '../../src/app/(main)/workstation/certificates/page';
import MediaLibraryPage from '../../src/app/(main)/admin/homepage/media/page';
import { MediaPickerModal } from '../../src/components/admin/MediaPickerModal';
import CrmAnalyticsPage from '../../src/app/(main)/crm/analytics/page';
import AutomationPage from '../../src/app/(main)/crm/automation/page';

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── 1. 증명서 워크스테이션 — 유형별 조회 실패 ─────────────────── */

describe('증명서 워크스테이션 — 유형 하나가 죽어도 조용히 빠지지 않는다', () => {
  const item = (id: string, name: string) => ({
    id, type: 'OPINION', status: 'REQUESTED', createdAt: '2026-08-20T01:00:00Z',
    patient: { mrn: 'M1', name },
  });

  it('🔴 진단서 조회만 실패해도 "무엇을 못 읽었는지" 말한다 — 나머지 유형은 그대로 보인다', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('DIAGNOSIS_CERT')) throw new Error('조회 실패');
      if (path.includes('OPINION')) return { data: { items: [item('r1', '홍길동')] } };
      return { data: { items: [] } };
    });

    render(<CertificateWorkstationPage />);

    await waitFor(() => expect(screen.getByText('홍길동')).toBeTruthy()); // 부분 성공은 살린다
    expect(screen.getByText(/진단서.*조회에 실패/)).toBeTruthy();
  });

  it('🔴 전 유형이 실패하면 "처리할 증명서 요청이 없습니다"라고 말하지 않는다', async () => {
    get.mockRejectedValue(new Error('조회 실패'));

    render(<CertificateWorkstationPage />);

    await waitFor(() => expect(screen.getByText(/요청이 없는 것이 아니라 조회에 실패/)).toBeTruthy());
    expect(screen.queryByText('처리할 증명서 요청이 없습니다.')).toBeNull();
  });

  it('실제로 요청이 없을 때는 그대로 "없습니다"라고 말한다(정직한 빈 상태는 유지)', async () => {
    get.mockResolvedValue({ data: { items: [] } });

    render(<CertificateWorkstationPage />);

    await waitFor(() => expect(screen.getByText('처리할 증명서 요청이 없습니다.')).toBeTruthy());
  });
});

/* ── 2. 미디어 라이브러리 / 피커 ─────────────────────────────── */

describe('미디어 라이브러리 — 조회 실패를 "파일 없음"으로 말하지 않는다', () => {
  it('🔴 파일 목록 조회가 실패하면 "파일이 없습니다"를 그리지 않는다', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('/media?')) throw new Error('목록 조회 실패');
      if (path.includes('/folders')) return { data: ['/'] };
      return { data: { totalFiles: 3, totalSize: 100, imageCount: 3 } };
    });

    render(<MediaLibraryPage />);

    await waitFor(() => expect(screen.getByText('목록 조회 실패')).toBeTruthy());
    expect(screen.queryByText(/파일이 없습니다/)).toBeNull();
  });

  it('🔴 통계 조회 실패를 영구 "로딩 중..." 으로 굳히지 않는다 — 목록은 그대로 보인다', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('/media/stats')) throw new Error('통계 조회 실패');
      if (path.includes('/folders')) return { data: ['/'] };
      return { data: [{ id: 'f1', fileName: 'a.png', originalName: 'a.png', mimeType: 'image/png', fileSize: 10, url: '/media/a.png', folder: '/', createdAt: '2026-08-20T00:00:00Z' }] };
    });

    render(<MediaLibraryPage />);

    await waitFor(() => expect(screen.getByText('사용량을 불러오지 못했습니다')).toBeTruthy());
    expect(screen.queryByText('로딩 중...')).toBeNull();
    expect(screen.getByAltText('a.png')).toBeTruthy(); // 부분 성공은 살린다
  });
});

describe('미디어 피커 — 조회 실패를 "이미지가 없습니다"로 말하지 않는다', () => {
  it('🔴 목록 조회 실패 시 EmptyState 를 그리지 않는다', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('/folders')) return { data: ['/'] };
      throw new Error('이미지 조회 실패');
    });

    render(<MediaPickerModal open onClose={() => {}} onSelect={() => {}} />);

    await waitFor(() => expect(screen.getByText('이미지 조회 실패')).toBeTruthy());
    expect(screen.queryByText('이미지가 없습니다')).toBeNull();
  });

  it('폴더 목록만 실패해도 이미지는 그대로 보인다(부분 성공)', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('/folders')) throw new Error('폴더 조회 실패');
      return { data: [{ id: 'f1', fileName: 'a.png', originalName: 'a.png', mimeType: 'image/png', fileSize: 10, url: '/media/a.png', folder: '/', createdAt: '2026-08-20T00:00:00Z' }] };
    });

    render(<MediaPickerModal open onClose={() => {}} onSelect={() => {}} />);

    await waitFor(() => expect(screen.getByAltText('a.png')).toBeTruthy());
    expect(screen.queryByText('이미지가 없습니다')).toBeNull();
  });
});

/* ── 3. CRM 분석 / 자동화 ───────────────────────────────────── */

describe('CRM 분석 — 실패한 패널이 이름 없이 사라지지 않는다', () => {
  const PERF = {
    data: {
      campaigns: [], totals: { sent: 10, delivered: 9, opened: 5, clicked: 2, conversions: 1 },
      avgOpenRate: 50, avgClickRate: 20,
    },
  };

  it('🔴 리텐션·발송시간 조회가 실패하면 그 사실을 말한다 — 성과 총계는 그대로 그린다', async () => {
    fetchFn.mockImplementation(async (path: string) => {
      if (path.includes('performance')) return PERF;
      throw new Error('조회 실패');
    });

    render(<CrmAnalyticsPage />);

    await waitFor(() => expect(screen.getByText(/코호트 리텐션·최적 발송 시간 조회에 실패/)).toBeTruthy());
    expect(screen.getByText('총 발송')).toBeTruthy(); // 부분 성공은 살린다
  });

  it('전부 성공하면 실패 배너가 없다', async () => {
    fetchFn.mockImplementation(async (path: string) => {
      if (path.includes('performance')) return PERF;
      if (path.includes('retention')) return { data: [] };
      return { data: { recommendedHour: 10, reason: '실측', hourlyStats: [] } };
    });

    render(<CrmAnalyticsPage />);

    await waitFor(() => expect(screen.getByText('총 발송')).toBeTruthy());
    expect(screen.queryByText(/조회에 실패/)).toBeNull();
  });
});

describe('CRM 자동화 — RFM 조회 실패가 "이탈 위험 없음"으로 읽히지 않는다', () => {
  it('🔴 RFM 조회 실패를 화면이 말한다', async () => {
    fetchFn.mockImplementation(async (path: string) => {
      if (path.includes('automation/status')) return { data: { pendingReminders: 3, upcomingFollowUps: 1, churnRiskCount: 7 } };
      throw new Error('조회 실패');
    });

    render(<AutomationPage />);

    await waitFor(() => expect(screen.getByText(/RFM 세그먼트 조회에 실패/)).toBeTruthy());
    expect(screen.getByText('7')).toBeTruthy(); // 부분 성공은 살린다
  });
});

/* ── 4. 만족도 감성 분석 — 서버가 밝힌 실패를 화면이 말한다 ─────── */

describe('만족도 감성 분석 — 원장 조회 실패를 "응답 없음"으로 그리지 않는다', () => {
  const renderTrendTab = async () => {
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { fireEvent } = await import('@testing-library/react');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { default: SatisfactionPage } = await import('../../src/app/(main)/satisfaction/page');
    render(<QueryClientProvider client={client}><SatisfactionPage /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText('추이 분석')).toBeTruthy());
    fireEvent.click(screen.getByText('추이 분석'));
  };

  it('🔴 unavailable 이 오면 실패라고 말한다 — EmptyState("분석할 응답이 없습니다")를 그리지 않는다', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('/stats/sentiment')) {
        return {
          data: {
            positive: null, neutral: null, negative: null,
            scoredCount: 0, commentCount: 0, topPositive: [], topNegative: [], aiSummary: null,
            unavailable: ['SURVEY_DISPATCH', 'SATISFACTION_SURVEY'],
          },
        };
      }
      return { data: [] };
    });

    await renderTrendTab();

    await waitFor(() => expect(screen.getByText(/조회에 실패했습니다 — 응답이 없는 것이 아니라/)).toBeTruthy());
    expect(screen.queryByText('분석할 응답이 없습니다.')).toBeNull();
  });

  it('표본이 진짜 없을 때는 그대로 "분석할 응답이 없습니다"(정직한 빈 상태 유지)', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('/stats/sentiment')) {
        return {
          data: {
            positive: null, neutral: null, negative: null,
            scoredCount: 0, commentCount: 0, topPositive: [], topNegative: [], aiSummary: null,
            unavailable: [],
          },
        };
      }
      return { data: [] };
    });

    await renderTrendTab();

    await waitFor(() => expect(screen.getByText('분석할 응답이 없습니다.')).toBeTruthy());
  });
});
