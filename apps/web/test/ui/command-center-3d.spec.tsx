/**
 * 통합 상황판 3D 건물 보기(2026-10-01 · 보조 보기).
 *  · 닫혀 있으면 부하·위치를 부르지 않는다(three.js·조회 모두 열 때만)
 *  · 색 = 진료실 판정(목표 초과 HIGH · 이내 LOW · 대기 없음 무색) · 스테이션은 칠하지 않는다
 *  · 🔴 공간에 못 놓은 대기를 분모와 함께 말한다 · 기준이 코드 기본값이면 그렇다고
 *  · 환자 위치 층: 관측/추정 수 · 대부분 추정이면 경고 · 권한 없는 역할(약사·검사)은 부르지 않고 이유를 말한다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const NOW = new Date().toISOString();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
let role = 'DOCTOR';
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: { user: { role: string } }) => unknown) => sel({ user: { role } }) }));
const heatSeen: unknown[] = [];
vi.mock('next/dynamic', () => ({ default: () => (props: { heat?: Map<string, string>; patients?: unknown }) => { heatSeen.push(props); return <div data-testid="webgl" />; } }));
vi.mock('@/components/space/SpaceViewer', () => ({
  useGeometry: () => ({ data: { data: { importId: 'i', source: 'SYNTHETIC', synthetic: true, notice: '합성 도면', confirmedAt: null, floors: [{ key: '1F', level: 1, title: '1층', spaces: [] }] } }, isLoading: false, isError: false }),
}));

const LOAD = {
  asOf: '2026-10-01T03:00:00Z', target: { opdWaitMin: 30, source: 'FALLBACK' },
  rooms: [
    { spaceNodeId: 'n1', name: '내과 1진료실', waiting: 2, called: 0, inConsultation: 1, longestWaitMin: 45, level: 'OVER_TARGET' },
    { spaceNodeId: 'n2', name: '외과 1진료실', waiting: 1, called: 0, inConsultation: 0, longestWaitMin: 10, level: 'WITHIN_TARGET' },
    { spaceNodeId: 'n3', name: '소아과 진료실', waiting: 0, called: 0, inConsultation: 1, longestWaitMin: null, level: 'IDLE' },
  ],
  stations: [{ spaceNodeId: 'n9', name: '채혈', waiting: 2, inProgress: 1 }],
  unplaced: { queueWithoutRoom: 260, queueRoomNotLinked: [{ roomName: '피부과 진료실', count: 3 }], stationsNotLinked: 1, stationLogsNotPlaced: 0 },
  queueTotal: 268,
  bedRooms: [
    { spaceNodeId: 'z301', emergency: false, beds: [{ bedId: 'b1', label: '301-A', state: 'OCCUPIED' }, { bedId: 'b2', label: '301-B', state: 'AVAILABLE' }] },
    { spaceNodeId: 'zer', emergency: true, beds: [{ bedId: 'e1', label: 'RESUS-1', state: 'OCCUPIED' }, { bedId: 'e2', label: 'RESUS-2', state: 'MISMATCH' }, { bedId: 'e3', label: 'GEN-1', state: 'AVAILABLE' }] },
  ],
  bedsUnlinked: [{ ward: '6층 정형외과병동', count: 6 }],
  bedsTotal: 11,
};

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); heatSeen.length = 0; role = 'DOCTOR'; });

async function mount() {
  get.mockImplementation(async (url: string) => {
    if (url.includes('space-load')) return { data: LOAD };
    // 2026-10-03 — "현재 위치"는 서버 정본 판정: 서버가 준 행은 전부 현재(7월에 입원해 아직 재원 중인 환자 포함) ·
    //   오래된 열린 기록은 싣지 않고 meta.staleOpen 으로 수만
    if (url.includes('metaverse/patients')) return { data: [
      { zoneId: 'n1', source: 'INFERRED_EVENT', granularity: 'ZONE', enteredAt: NOW }, { zoneId: 'n1', source: 'SIMULATED', granularity: 'ZONE', enteredAt: NOW },
      { zoneId: 'n2', source: 'OBSERVED_QR', granularity: 'ZONE', enteredAt: NOW }, { zoneId: 'f1', source: 'INFERRED_EVENT', granularity: 'FLOOR', enteredAt: NOW },
      { zoneId: 'n3', source: 'INFERRED_EVENT', granularity: 'ZONE', enteredAt: '2026-07-25T05:41:49Z' }, // 7월 입원 · 재원 중
    ], meta: { rule: 'TODAY_OR_ACTIVE_STAY', staleOpen: 3, truncated: false, total: 5 } };
    return { data: null };
  });
  const { Building3DSection } = await import('@/app/(main)/command-center/Building3DSection');
  return render(<Building3DSection />, { wrapper: wrap });
}

describe('3D 건물 보기', () => {
  it('닫혀 있으면 아무것도 부르지 않는다(three.js 도 열 때만)', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-cc-3d]')).not.toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByTestId('webgl')).toBeNull();
  });

  it('🔴 열면 진료실 판정으로 칠한다(초과 HIGH·이내 LOW·대기 없음 무색) · 기준이 코드 기본값이라고 · 못 놓은 대기를 분모와', async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByText('3D 로 열기'));
    await waitFor(() => expect(container.querySelector('[data-cc-3d-unplaced]')).not.toBeNull());
    expect(get).toHaveBeenCalledWith('/api/v1/command-center/space-load');
    const heat = (heatSeen[heatSeen.length - 1] as { heat: Map<string, string> }).heat;
    expect([...heat.entries()]).toEqual([['n1', 'HIGH'], ['n2', 'LOW']]);
    expect(container.querySelector('[data-cc-3d-target]')!.textContent).toContain('코드 기본값(원내 미설정)');
    const un = container.querySelector('[data-cc-3d-unplaced]')!.textContent!;
    expect(un).toContain('오늘 대기 268건 중 도면에 놓은 것 5건');
    expect(un).toContain('진료실 미지정 260건');
    expect(un).toContain('피부과 진료실');
    expect(un).toContain('검진 스테이션 1곳');
    expect(container.textContent).toContain('기준이 없어 색을 칠하지 않음');
    // 환자 위치는 켜기 전엔 부르지 않는다
    expect(get.mock.calls.some((c) => String(c[0]).includes('metaverse/patients'))).toBe(false);
  });

  it('🔴 환자 위치 — 관측/추정 수 · 대부분 추정이면 경고 · 층까지만 아는 사람은 방에 그리지 않는다', async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByText('3D 로 열기'));
    await waitFor(() => expect(container.querySelector('[data-cc-3d-patients]')).not.toBeNull());
    fireEvent.click(screen.getByLabelText('환자 위치 표시'));
    await waitFor(() => expect(container.querySelector('[data-cc-3d-patient-counts]')).not.toBeNull());
    const t = container.querySelector('[data-cc-3d-patient-counts]')!.textContent!;
    // 🔴 2026-10-09 — 시뮬레이션을 추정에 섞지 않고 따로 센다(7월에 들어온 재원 중 위치도 화면이 날짜로 다시 거르지 않는다)
    expect(t).toContain('관측 1명 · 추정 2명 · 시뮬레이션 1명');
    expect(t).toContain('대부분 추정 위치입니다');
    expect(t).toContain('층까지만 아는 1명');
    // 🔴 오래된 열린 기록은 서버가 준 수를 그대로 — 판정 규칙을 말한다
    const stale = container.querySelector('[data-cc-3d-patient-stale]')!.textContent!;
    expect(stale).toContain('현재 위치로 볼 근거가 있는 기록만 그립니다');
    expect(stale).toContain('오래된 열린 위치 3건 — 떠났는지 모름');
  });

  it('🔴 약사·검사 역할은 환자 위치를 부르지 않고 이유를 말한다(API 권한과 같다)', async () => {
    role = 'PHARMACIST';
    const { container } = await mount();
    fireEvent.click(screen.getByText('3D 로 열기'));
    await waitFor(() => expect(container.querySelector('[data-cc-3d-patients="no-role"]')).not.toBeNull());
    expect(get.mock.calls.some((c) => String(c[0]).includes('metaverse/patients'))).toBe(false);
  });

  it('부하 조회 실패는 실패로(빈 목록이 아니다)', async () => {
    get.mockImplementation(async (url: string) => { if (url.includes('space-load')) throw new Error('500'); return { data: null }; });
    const { Building3DSection } = await import('@/app/(main)/command-center/Building3DSection');
    const { container } = render(<Building3DSection />, { wrapper: wrap });
    fireEvent.click(screen.getByText('3D 로 열기'));
    await waitFor(() => expect(container.querySelector('[data-cc-3d-aside] [aria-busy="true"]')).toBeNull());
    expect(container.querySelector('[data-cc-3d-unplaced]')).toBeNull();
    expect(container.textContent).not.toContain('공간에 놓인 진료실의 오늘 대기가 없습니다');
  });
});

describe('환자 추적(2026-10-09)', () => {
  const ROWS = [
    { patientId: 'p-obs', patientName: '김관측', mrn: 'MRN000123', zoneId: 'n2', zoneName: '외과 1진료실', source: 'OBSERVED_QR', granularity: 'ZONE', enteredAt: NOW },
    { patientId: 'p-sim', patientName: '이시뮬', mrn: 'MRN000456', zoneId: 'n1', zoneName: '내과 대기실', source: 'SIMULATED', granularity: 'ZONE', enteredAt: NOW },
  ];
  async function mountTracker() {
    get.mockImplementation(async (url: string) => {
      if (url.includes('space-load')) return { data: LOAD };
      if (url.includes('/trail?date=')) return { data: [
        { zoneId: 'r1', zoneName: '접수', enteredAt: NOW, leftAt: NOW, duration: 4, source: 'SIMULATED' },
        { zoneId: 'n1', zoneName: '내과 대기실', enteredAt: NOW, leftAt: null, duration: null, source: 'SIMULATED' },
      ] };
      if (url.includes('metaverse/patients')) return { data: ROWS, meta: { rule: 'TODAY_OR_ACTIVE_STAY', staleOpen: 0, truncated: false, total: 2 } };
      return { data: null };
    });
    const { Building3DSection } = await import('@/app/(main)/command-center/Building3DSection');
    const r = render(<Building3DSection />, { wrapper: wrap });
    fireEvent.click(screen.getByText('3D 로 열기'));
    await waitFor(() => expect(r.container.querySelector('[data-cc-3d-patients]')).not.toBeNull());
    fireEvent.click(screen.getByLabelText('환자 위치 표시'));
    await waitFor(() => expect(r.container.querySelector('[data-cc-3d-track="p-obs"]')).not.toBeNull());
    return r;
  }

  it('🔴 리얼(빌드 기본)에선 시뮬레이션을 기본으로 숨긴다 · 이름은 가리고 등록번호는 끝 4자리만', async () => {
    const { container } = await mountTracker();
    const toggle = container.querySelector('[data-cc-3d-sim-toggle] input') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const tr = container.querySelector('[data-cc-3d-tracker]')!;
    expect(tr.querySelector('[data-cc-3d-track="p-obs"]')).not.toBeNull();
    expect(tr.querySelector('[data-cc-3d-track="p-sim"]')).toBeNull();
    expect(tr.textContent).not.toContain('김관측');
    expect(tr.textContent).toContain('…0123');
    expect(tr.textContent).not.toContain('MRN000123');
    // 켜면 시뮬레이션 환자도 목록에(출처 표기와 함께)
    fireEvent.click(toggle);
    await waitFor(() => expect(tr.querySelector('[data-cc-3d-track="p-sim"]')).not.toBeNull());
  });

  it('🔴 고르면 오늘(KST) 이동 경로를 부르고 줄마다 출처를 밝힌다', async () => {
    const { container } = await mountTracker();
    fireEvent.click(container.querySelector('[data-cc-3d-track="p-obs"]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-cc-3d-trail-row]').length).toBe(2));
    const call = get.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/trail?date='))!;
    expect(call).toMatch(/\/api\/v1\/metaverse\/patients\/p-obs\/trail\?date=\d{4}-\d{2}-\d{2}$/);
    expect(container.querySelector('[data-cc-3d-trail-row="SIMULATED"]')).not.toBeNull();
    expect(container.querySelector('[data-cc-3d-trail]')!.textContent).toContain('4분');
  });
});

describe('무선 AP 측위 층(2026-10-09)', () => {
  const APS = [
    { id: 'a1', label: 'AP-2F-01', floorKey: '1F', x: 6, y: 6, rssiAt1m: null, pathLossExponent: null, isActive: true, dataOrigin: 'SEED' },
    { id: 'a2', label: 'AP-2F-02', floorKey: '1F', x: 18, y: 6, rssiAt1m: -38, pathLossExponent: 2.6, isActive: true, dataOrigin: 'REGISTERED' },
  ];
  const LIVE = [
    { patientId: 'p-obs', observedAt: NOW, floorKey: '1F', x: 10, y: 8, accuracyM: 4.2, apCount: 4, quality: 'POINT', granularity: 'ZONE', source: 'OBSERVED_WIFI', uncalibrated: true },
    { patientId: 'p-sim', observedAt: NOW, floorKey: '1F', x: 12, y: 9, accuracyM: 9.5, apCount: 3, quality: 'POINT', granularity: 'FLOOR', source: 'SIMULATED', uncalibrated: true },
  ];
  async function mountWifi(aps = APS) {
    get.mockImplementation(async (url: string) => {
      if (url.includes('space-load')) return { data: LOAD };
      if (url.includes('location/wifi/access-points')) return { data: aps };
      if (url.includes('location/wifi/live')) return { data: LIVE, meta: { windowMin: 10, truncated: false, total: 2 } };
      if (url.includes('location/wifi/trail')) return { data: [] };
      if (url.includes('metaverse/patients')) return { data: [], meta: { rule: 'TODAY_OR_ACTIVE_STAY', staleOpen: 0, truncated: false, total: 0 } };
      return { data: null };
    });
    const { Building3DSection } = await import('@/app/(main)/command-center/Building3DSection');
    const r = render(<Building3DSection />, { wrapper: wrap });
    fireEvent.click(screen.getByText('3D 로 열기'));
    await waitFor(() => expect(r.container.querySelector('[data-cc-3d-wifi]')).not.toBeNull());
    return r;
  }

  it('🔴 켜기 전엔 무선 EP 를 부르지 않는다', async () => {
    await mountWifi();
    expect(get.mock.calls.some((c) => String(c[0]).includes('location/wifi'))).toBe(false);
  });

  it('🔴 켜면 AP·측위를 3D 에 넘긴다 — 교정 여부·데모 배치 수를 말하고 · 리얼(빌드 기본)에선 시뮬레이션 점을 넘기지 않는다', async () => {
    const { container } = await mountWifi();
    fireEvent.click(screen.getByLabelText('무선 AP 측위 표시(AP·측위 점·오차 반경)'));
    await waitFor(() => expect(container.querySelector('[data-cc-3d-wifi-counts]')).not.toBeNull());
    const t = container.querySelector('[data-cc-3d-wifi-counts]')!.textContent!;
    expect(t).toContain('AP 2대');
    expect(t).toContain('교정 안 됨 1대');
    expect(t).toContain('데모 배치 1대(실제 설치 아님)');
    expect(t).toContain('최근 10분 측위 — 관측 1명 · 시뮬레이션 1명');
    expect(t).toContain('시뮬레이션은 숨김');
    // 측위 방법(2026-10-10) — 신호 지도 표본이 없으면 모두 전파 모델이라고 말한다
    expect(container.querySelector('[data-cc-3d-wifi-fingerprint="0"]')!.textContent).toContain('모두 전파 모델');
    const last = heatSeen[heatSeen.length - 1] as { wifiAps?: Array<{ calibrated: boolean }>; wifiFixes?: Array<{ simulated: boolean; accuracyM: number }> };
    expect(last.wifiAps?.map((a) => a.calibrated)).toEqual([false, true]);
    expect(last.wifiFixes).toEqual([{ floorKey: '1F', x: 10, y: 8, accuracyM: 4.2, simulated: false, tracked: false }]);
  });

  it('신호 지도로 잡은 측위는 그 수를 따로 센다(방법 구분 · 2026-10-10)', async () => {
    LIVE[0] = { ...LIVE[0], method: 'FINGERPRINT_KNN_V1' } as never;
    try {
      const { container } = await mountWifi();
      fireEvent.click(screen.getByLabelText('무선 AP 측위 표시(AP·측위 점·오차 반경)'));
      await waitFor(() => expect(container.querySelector('[data-cc-3d-wifi-fingerprint="1"]')).not.toBeNull());
    } finally { delete (LIVE[0] as { method?: string }).method; }
  });

  it('🔴 AP 가 없으면 측위할 수 없다고 말한다(빈 화면을 환자 없음으로 읽히지 않게)', async () => {
    const { container } = await mountWifi([]);
    fireEvent.click(screen.getByLabelText('무선 AP 측위 표시(AP·측위 점·오차 반경)'));
    await waitFor(() => expect(container.querySelector('[data-cc-3d-wifi-no-ap]')).not.toBeNull());
  });

  it('wifiFixMarks — 시뮬레이션은 켰을 때만 · 추적 환자 표시', async () => {
    const { wifiFixMarks } = await import('@/app/(main)/command-center/Building3DSection');
    expect(wifiFixMarks(LIVE as never, true, 'p-sim').map((m) => [m.simulated, m.tracked])).toEqual([[false, false], [true, true]]);
    expect(wifiFixMarks(LIVE as never, false, null)).toHaveLength(1);
  });
});

describe('병상 층(2026-10-02)', () => {
  it('🔴 병상 표식을 3D 에 넘기고 · 놓은 수/전체 · 응급실은 구역별(한 공간) · 상태 불일치 · 미연결 병동을 말한다', async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByText('3D 로 열기'));
    await waitFor(() => expect(container.querySelector('[data-cc-3d-beds]')).not.toBeNull());
    const last = heatSeen[heatSeen.length - 1] as { beds?: Map<string, string[]> };
    expect(last.beds?.get('zer')).toEqual(['OCCUPIED', 'MISMATCH', 'AVAILABLE']);
    const t = container.querySelector('[data-cc-3d-beds]')!.textContent!;
    expect(t).toContain('병상 11개 중 도면에 놓은 것 5개');
    expect(container.querySelector('[data-cc-3d-er]')!.textContent).toContain('RESUS 1/2');
    expect(container.querySelector('[data-cc-3d-er]')!.textContent).toContain('GEN 0/1');
    expect(container.querySelector('[data-cc-3d-mismatch]')!.textContent).toContain('상태 불일치 1개');
    expect(container.querySelector('[data-cc-3d-beds-unlinked]')!.textContent).toContain('6층 정형외과병동 6');
  });
});
