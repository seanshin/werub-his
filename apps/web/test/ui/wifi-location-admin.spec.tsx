/**
 * 무선 위치 관리(3416 · 2026-10-09).
 *  · 🔴 수집 꺼짐·기본값을 말한다 · 시뮬레이션 적중률은 분모와 함께 · "실제 병원 정확도 아님" · 방까지 정한 것이 0 이면 산출 불가
 *  · 🔴 단말 연결은 환자·단말·종류·동의 근거를 고르기 전엔 못 누른다 · 구두 동의는 메모가 있어야
 *  · 수집기 키는 발급 응답에서 한 번만 보인다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));

const STATUS = (sim: { total: number; zoned: number; hit: number }) => ({
  enabled: false, enabledSource: 'DEFAULT',
  accessPoints: { byFloor: [{ floorKey: '1F', dataOrigin: 'SEED', count: 12 }], uncalibrated: 12 },
  collectors: [], fixesLastHour: { SIMULATED: 300 }, activeBindings: 0, simulation: sim,
});
let status = STATUS({ total: 300, zoned: 200, hit: 150 });
// 현장 측정(2026-10-10) — 기본은 표본 없음
let survey: unknown[] = [];
let surveyMeta: Record<string, unknown> = { total: 0, truncated: false, perFloor: [], minSamplesPerFloor: 10 };
let suggestions: Record<string, unknown> = { samples: 0, items: [] };
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => {
  cleanup(); get.mockReset(); post.mockReset();
  status = STATUS({ total: 300, zoned: 200, hit: 150 });
  survey = []; surveyMeta = { total: 0, truncated: false, perFloor: [], minSamplesPerFloor: 10 }; suggestions = { samples: 0, items: [] };
  get.mockImplementation(async (url: string) => {
    if (url.includes('/status')) return { data: status };
    if (url.includes('/access-points')) return { data: [] };
    if (url.includes('/collectors')) return { data: [] };
    if (url.includes('/bindings')) return { data: [], meta: { total: 0, truncated: false } };
    if (url.includes('/api/v1/patients?search=')) return { data: [{ id: 'p1', familyName: '김', givenName: '테스트', mrn: 'M0001' }] };
    if (url.includes('/location/wifi/survey')) return { data: survey, meta: surveyMeta };
    if (url.includes('/calibration-suggestions')) return { data: suggestions };
    return { data: null };
  });
});

async function mount() {
  const { default: Page } = await import('@/app/(main)/admin/wifi-location/page');
  return render(<Page />, { wrapper: wrap });
}

describe('현황', () => {
  it('🔴 수집 꺼짐·기본값 · 적중률은 분모와 · 실제 정확도가 아니라고 말한다', async () => {
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-status]')).not.toBeNull());
    expect(container.querySelector('[data-wifi-enabled="off"]')!.textContent).toContain('기본값(원내 미설정)');
    const acc = container.querySelector('[data-wifi-sim-accuracy]')!.textContent!;
    expect(acc).toContain('150 / 200 (75.0%)');
    expect(acc).toContain('방까지 정한 것 200/300건');
    expect(acc).toContain('실제 병원 정확도가 아닙니다');
    expect(container.textContent).toContain('데모 배치 12대(실제 설치 아님)');
  });
  it('🔴 방까지 정한 것이 0 이면 산출 불가(0% 가 아니다)', async () => {
    status = STATUS({ total: 0, zoned: 0, hit: 0 });
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-sim-accuracy]')).not.toBeNull());
    const acc = container.querySelector('[data-wifi-sim-accuracy]')!.textContent!;
    expect(acc).toContain('산출 불가');
    expect(acc).not.toContain('0%');
  });
});

describe('단말 연결', () => {
  it('🔴 다 고르기 전엔 연결을 못 누르고 · 구두 동의는 메모가 있어야 · 보낸 값은 고른 그대로', async () => {
    post.mockResolvedValue({ data: { id: 'nb' } });
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-bind-form]')).not.toBeNull());
    const form = container.querySelector('[data-wifi-bind-form]')!;
    const btn = screen.getByRole('button', { name: '연결' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('이름·등록번호'), { target: { value: '김테' } });
    await waitFor(() => expect(screen.getByText(/김테스트 · M0001/)).toBeTruthy());
    fireEvent.click(screen.getByText(/김테스트 · M0001/));
    const inputs = form.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'TAG-0099' } });
    const selects = form.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'TAG' } });
    expect(btn.disabled).toBe(true); // 동의 근거 미선택
    fireEvent.change(selects[1], { target: { value: 'VERBAL_RECORDED' } });
    expect(btn.disabled).toBe(true); // 구두 동의 메모 없음
    fireEvent.change(inputs[1], { target: { value: '보호자 구두 동의 — 간호사 입회' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/v1/location/wifi/bindings', { deviceRef: 'TAG-0099', deviceKind: 'TAG', patientId: 'p1', consentBasis: 'VERBAL_RECORDED', consentNote: '보호자 구두 동의 — 간호사 입회' });
  });
});

describe('수집기', () => {
  it('발급 응답의 키를 한 번 보이고 닫으면 사라진다', async () => {
    post.mockResolvedValue({ data: { id: 'c1', label: '본관 WLC', mode: 'NETWORK', key: 'wfc_abc' } });
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-collectors]')).not.toBeNull());
    const sec = container.querySelector('[data-wifi-collectors]')!;
    fireEvent.change(sec.querySelector('input')!, { target: { value: '본관 WLC' } });
    fireEvent.change(sec.querySelector('select')!, { target: { value: 'NETWORK' } });
    fireEvent.click(screen.getByRole('button', { name: '수집기 발급' }));
    await waitFor(() => expect(container.querySelector('[data-wifi-issued-key]')).not.toBeNull());
    expect(container.querySelector('[data-wifi-issued-key]')!.textContent).toContain('wfc_abc');
    fireEvent.click(container.querySelector('[data-wifi-issued-key] button')!);
    expect(container.querySelector('[data-wifi-issued-key]')).toBeNull();
  });
});

describe('현장 측정 · 교정 제안(2026-10-10)', () => {
  it('🔴 표본이 없으면 모든 층이 전파 모델이라고 · 교정 제안도 없다고 말한다', async () => {
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-survey-none]')).not.toBeNull());
    await waitFor(() => expect(container.querySelector('[data-wifi-cal-none]')).not.toBeNull());
  });
  it('층별 유효 표본과 신호 지도 켜짐 · 제안은 버튼으로만 적용 · 못 맞추면 이유', async () => {
    surveyMeta = { total: 12, truncated: false, perFloor: [{ floorKey: '1F', samples: 12, fingerprintActive: true }, { floorKey: '2F', samples: 3, fingerprintActive: false }], minSamplesPerFloor: 10 };
    suggestions = { samples: 15, items: [
      { apId: 'a1', bssid: '02:00:00:00:00:01', label: 'AP1', floorKey: '1F', current: { rssiAt1m: null, pathLossExponent: null, calibratedAt: null }, suggestion: { rssiAt1m: -36.4, pathLossExponent: 3.2, pairs: 9, rmseDb: 2.1 }, reason: null, pairs: 9 },
      { apId: 'a2', bssid: '02:00:00:00:00:02', label: 'AP2', floorKey: '2F', current: { rssiAt1m: null, pathLossExponent: null, calibratedAt: null }, suggestion: null, reason: 'TOO_FEW_PAIRS', pairs: 2 },
    ] };
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-survey-floor="1F"]')).not.toBeNull());
    expect(container.querySelector('[data-wifi-survey-floor="1F"]')!.getAttribute('data-fingerprint')).toBe('on');
    expect(container.querySelector('[data-wifi-survey-floor="2F"]')!.getAttribute('data-fingerprint')).toBe('off');
    await waitFor(() => expect(container.querySelector('[data-wifi-cal-apply="02:00:00:00:00:01"]')).not.toBeNull());
    expect(container.querySelector('[data-wifi-cal-apply="02:00:00:00:00:02"]')).toBeNull();
    expect(container.querySelector('[data-wifi-cal-reason="TOO_FEW_PAIRS"]')!.textContent).toContain('모자랍니다');
  });
  it('🔴 형식이 틀린 줄이 있으면 저장 버튼이 꺼진다(조용히 버리지 않는다)', async () => {
    const { parseSurveyReadings } = await import('@/app/(main)/admin/wifi-location/SurveyPanel');
    expect(parseSurveyReadings('aa:bb:cc:dd:ee:01,-52\nAA-BB-CC-DD-EE-02 -67\n\nbad line\naa:bb:cc:dd:ee:03,5')).toEqual({
      readings: [{ bssid: 'aa:bb:cc:dd:ee:01', rssi: -52 }, { bssid: 'aa:bb:cc:dd:ee:02', rssi: -67 }],
      bad: ['bad line', 'aa:bb:cc:dd:ee:03,5'],
    });
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-survey-form]')).not.toBeNull());
    const form = container.querySelector('[data-wifi-survey-form]')!;
    const inputs = form.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: '1F' } });
    fireEvent.change(inputs[1], { target: { value: '5' } });
    fireEvent.change(inputs[2], { target: { value: '5' } });
    fireEvent.change(inputs[3], { target: { value: '2026-10-10T09:00' } });
    fireEvent.change(form.querySelector('textarea')!, { target: { value: 'aa:bb:cc:dd:ee:01,-52\nbad' } });
    expect((container.querySelector('[data-wifi-survey-save]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(form.querySelector('textarea')!, { target: { value: 'aa:bb:cc:dd:ee:01,-52' } });
    expect((container.querySelector('[data-wifi-survey-save]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('흐름 추적 보완(2026-10-10)', () => {
  it('🔴 열린 연결 점검(사망·재원 아님)·측정 표본·보존(결정 전 지우지 않음)을 현황이 말한다', async () => {
    status = { ...STATUS({ total: 0, zoned: 0, hit: 0 }), bindingCheck: { deceased: 1, notAdmitted: 2 }, survey: { samples: 12, fingerprintFloors: ['2F'], minSamplesPerFloor: 10 }, retention: { decisionKey: 'location.retentionDays', observedDeleted: false, simulatedHours: 24 } } as never;
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-binding-check="1/2"]')).not.toBeNull());
    expect(container.querySelector('[data-wifi-binding-check]')!.textContent).toContain('자동 해제하지 않습니다');
    expect(container.querySelector('[data-wifi-status-survey="1"]')!.textContent).toContain('2F');
    expect(container.querySelector('[data-wifi-retention="kept"]')!.textContent).toContain('location.retentionDays');
  });
  it('연결 목록 — 사망·재원 아님 표지(해제는 사람이)', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.includes('/status')) return { data: status };
      if (url.includes('/bindings')) return { data: [
        { id: 'b1', deviceKind: 'TAG', displayHint: '0001', patientId: 'p1', consentBasis: 'WRITTEN', consentNote: null, boundAt: '2026-10-09T00:00:00Z', unboundAt: null, unboundReason: null, patient: { familyName: '고', givenName: '인', mrn: 'M1' }, patientState: 'DECEASED' },
        { id: 'b2', deviceKind: 'TAG', displayHint: '0002', patientId: 'p2', consentBasis: 'WRITTEN', consentNote: null, boundAt: '2026-10-09T00:00:00Z', unboundAt: null, unboundReason: null, patient: { familyName: '외', givenName: '래', mrn: 'M2' }, patientState: 'NOT_ADMITTED' },
      ], meta: { total: 2, truncated: false } };
      if (url.includes('/location/wifi/survey')) return { data: [], meta: surveyMeta };
      if (url.includes('/calibration-suggestions')) return { data: suggestions };
      return { data: [] };
    });
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-binding-state="DECEASED"]')).not.toBeNull());
    expect(container.querySelector('[data-wifi-binding-state="NOT_ADMITTED"]')).not.toBeNull();
  });
});

describe('운영 도구(2026-10-10) — 키 교체·CSV 가져오기·도면 배치·연결 거르기/일괄 해제', () => {
  const GEO = { notice: null, floors: [{ key: '1F', level: 1, title: '1층', footprint: { x: 0, y: 0, w: 30, h: 20 }, spaceNodeId: null, connections: [], spaces: [{ id: 's1', name: '로비', number: null, type: 'LOBBY', rect: { x: 0, y: 0, w: 30, h: 20 }, open: true, restricted: false, verticalCore: null, spaceNodeId: 'z1' }] }] };
  const withData = (over: Record<string, unknown> = {}) => get.mockImplementation(async (url: string) => {
    for (const [k, v] of Object.entries(over)) if (url.includes(k)) return v;
    if (url.includes('/status')) return { data: status };
    if (url.includes('/space/geometry')) return { data: GEO };
    if (url.includes('/access-points')) return { data: [
      { id: 'a1', bssid: '02:00:00:00:00:01', label: 'AP1', floorKey: '1F', x: 5, y: 5, rssiAt1m: -38, pathLossExponent: 3, calibratedAt: '2026-10-10T00:00:00Z', isActive: true, dataOrigin: 'REGISTERED' },
      { id: 'a2', bssid: '02:00:00:00:00:02', label: 'AP2', floorKey: '1F', x: 20, y: 5, rssiAt1m: null, pathLossExponent: null, calibratedAt: null, isActive: true, dataOrigin: 'SEED' },
    ] };
    if (url.includes('/collectors')) return { data: [{ id: 'c1', label: 'WLC-1', mode: 'NETWORK', isActive: true, lastSeenAt: null, lastBatch: null, dataOrigin: 'REGISTERED', keyRotatedAt: null }] };
    if (url.includes('/bindings')) return { data: [
      { id: 'b1', deviceKind: 'TAG', displayHint: '0001', patientId: 'p1', consentBasis: 'WRITTEN', consentNote: null, boundAt: '2026-10-09T00:00:00Z', unboundAt: null, unboundReason: null, patient: { familyName: '김', givenName: '가', mrn: 'M1' }, patientState: 'DECEASED' },
    ], meta: { total: 1, truncated: false } };
    if (url.includes('/location/wifi/survey')) return { data: [{ id: 'sv1', floorKey: '1F', x: 10, y: 10, readings: [], measuredAt: '2026-10-10T00:00:00Z', note: null, voidedAt: null, voidReason: null }], meta: { total: 1, truncated: false, perFloor: [{ floorKey: '1F', samples: 1, fingerprintActive: false }], minSamplesPerFloor: 10 } };
    if (url.includes('/calibration-suggestions')) return { data: { samples: 0, items: [] } };
    return { data: null };
  });

  it('🔴 키 교체는 두 번 눌러야 — 새 키는 한 번 보이고 "이전 키 무효"를 말한다', async () => {
    withData();
    post.mockImplementation(async (url: string) => (url.includes('/rotate-key') ? { data: { label: 'WLC-1', key: 'wfc_NEWKEY' } } : { data: {} }));
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-rotate="c1"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-wifi-rotate="c1"]')!);
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-wifi-rotate="c1"]')!);
    await waitFor(() => expect(container.querySelector('[data-wifi-issued-key]')?.textContent).toContain('wfc_NEWKEY'));
    expect(post).toHaveBeenCalledWith('/api/v1/location/wifi/collectors/c1/rotate-key', {});
    expect(container.querySelector('[data-wifi-issued-key]')!.textContent).toContain('교체됨');
  });

  it('🔴 CSV — 미리보기 전·오류가 있으면 적용 버튼이 꺼진다 · 오류 줄을 보여준다', async () => {
    withData();
    post.mockImplementation(async () => ({ data: { total: 2, valid: 1, create: 1, floors: ['1F'], errors: [{ line: 3, reason: 'FLOOR_NOT_IN_DRAWING', value: '9F' }], skipExisting: [], applied: false, created: 0 } }));
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-ap-import]')).not.toBeNull());
    const apply = () => container.querySelector('[data-wifi-ap-import-apply]') as HTMLButtonElement;
    fireEvent.change(container.querySelector('[data-wifi-ap-import-csv]')!, { target: { value: 'bssid,label,floorKey,x,y,vendor\n02:00:00:00:00:09,A,1F,1,1,' } });
    expect(apply().disabled).toBe(true);
    fireEvent.click(container.querySelector('[data-wifi-ap-import-preview]')!);
    await waitFor(() => expect(container.querySelector('[data-wifi-ap-import-errors]')).not.toBeNull());
    expect(post.mock.calls[0][1]).toMatchObject({ dryRun: true });
    expect(container.querySelector('[data-wifi-ap-import-errors]')!.textContent).toContain('확정 도면에 없는 층');
    expect(apply().disabled).toBe(true);
  });

  it('대조군 — 오류 없는 미리보기면 적용이 열리고 dryRun:false 로 보낸다', async () => {
    withData();
    post.mockImplementation(async (_u: string, b: { dryRun: boolean }) => ({ data: { total: 1, valid: 1, create: 1, floors: ['1F'], errors: [], skipExisting: [], applied: !b.dryRun, created: b.dryRun ? 0 : 1 } }));
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-ap-import]')).not.toBeNull());
    fireEvent.change(container.querySelector('[data-wifi-ap-import-csv]')!, { target: { value: 'bssid,label,floorKey,x,y,vendor\n02:00:00:00:00:09,A,1F,1,1,' } });
    fireEvent.click(container.querySelector('[data-wifi-ap-import-preview]')!);
    await waitFor(() => expect((container.querySelector('[data-wifi-ap-import-apply]') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(container.querySelector('[data-wifi-ap-import-apply]')!);
    await waitFor(() => expect(container.querySelector('[data-wifi-ap-import-result="applied"]')).not.toBeNull());
    expect(post.mock.calls[1][1]).toMatchObject({ dryRun: false });
  });

  it('도면 위 배치 — AP 교정 여부를 구분하고 유효 표본을 찍는다 · 도면이 없으면 그렇게 말한다', async () => {
    withData();
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-map-ap="02:00:00:00:00:01"]')).not.toBeNull());
    expect(container.querySelector('[data-wifi-map-ap="02:00:00:00:00:01"]')!.getAttribute('data-calibrated')).toBe('yes');
    expect(container.querySelector('[data-wifi-map-ap="02:00:00:00:00:02"]')!.getAttribute('data-calibrated')).toBe('no');
    await waitFor(() => expect(container.querySelector('[data-wifi-map-sample="sv1"]')).not.toBeNull());
    cleanup();
    withData({ '/space/geometry': { data: null } });
    const again = await mount();
    await waitFor(() => expect(again.container.querySelector('[data-wifi-floor-map-none]')).not.toBeNull());
  });

  it('🔴 연결 거르기는 서버 state 로 · 고른 연결만 사유 하나로 일괄 해제', async () => {
    withData();
    post.mockImplementation(async () => ({ data: { requested: 1, unbound: 1, alreadyUnbound: 0, notFound: 0 } }));
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-binding-filter-opt="DECEASED"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-wifi-binding-filter-opt="DECEASED"]')!);
    await waitFor(() => expect(get.mock.calls.some((c) => String(c[0]).includes('/bindings?state=DECEASED'))).toBe(true));
    await waitFor(() => expect(container.querySelector('[data-wifi-binding-pick="b1"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-wifi-binding-pick="b1"]')!);
    const submit = () => container.querySelector('[data-wifi-bulk-submit]') as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-wifi-bulk-unbind] input')!, { target: { value: '사망 — 태그 회수' } });
    fireEvent.click(submit());
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/location/wifi/bindings/unbind-bulk', { ids: ['b1'], reason: '사망 — 태그 회수' }));
    await waitFor(() => expect(container.querySelector('[data-wifi-bulk-result]')).not.toBeNull());
  });
});

describe('사람 결정 두 가지 — 현재 값·결정 화면 링크(2026-10-10)', () => {
  const withCollector = (lastBatch: Record<string, unknown> | null = null) => get.mockImplementation(async (url: string) => {
    if (url.includes('/status')) return { data: status };
    if (url.includes('/collectors')) return { data: [{ id: 'c1', label: 'WLC-1', mode: 'NETWORK', isActive: true, lastSeenAt: '2026-10-10T00:00:00Z', lastBatch, dataOrigin: 'REGISTERED', keyRotatedAt: null }] };
    if (url.includes('/bindings')) return { data: [], meta: { total: 0, truncated: false } };
    if (url.includes('/location/wifi/survey')) return { data: [], meta: { total: 0, truncated: false, perFloor: [], minSamplesPerFloor: 10 } };
    if (url.includes('/calibration-suggestions')) return { data: { samples: 0, items: [] } };
    if (url.includes('/access-points')) return { data: [] };
    return { data: null };
  });
  const decided = (auto: boolean, grace: number | null) => ({
    ...STATUS({ total: 0, zoned: 0, hit: 0 }),
    autoUnbind: { on: auto, source: 'db', decisionKey: 'location.wifi.autoUnbindOnEnd' },
    keyRotationGrace: { minutes: grace, source: grace == null ? 'default' : 'db', decisionKey: 'location.wifi.keyRotationGraceMinutes' },
  }) as never;

  it('꺼짐·유예 없음 — 값을 말하고 결정 화면 링크 · 교체 확인이 "즉시 무효"', async () => {
    status = decided(false, null);
    withCollector();
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-decision="auto-unbind"]')?.textContent).toContain('꺼짐'));
    expect(container.querySelector('[data-wifi-decision="auto-unbind"] a')!.getAttribute('href')).toBe('/admin/decisions/location.wifi.autoUnbindOnEnd');
    expect(container.querySelector('[data-wifi-decision="key-grace"]')!.textContent).toContain('즉시 무효');
    await waitFor(() => expect(container.querySelector('[data-wifi-rotate="c1"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-wifi-rotate="c1"]')!);
    expect(container.querySelector('[data-wifi-rotate="c1"]')!.textContent).toContain('즉시 무효');
  });

  it('🔴 켜짐·유예 30분 — 교체 확인이 유예를 말하고, 결과는 서버가 준 끝 시각으로(이전 키 "더 이상 받지 않음"이라 말하지 않는다)', async () => {
    status = decided(true, 30);
    withCollector({ stored: 1, unbound: 0, viaGraceKey: true });
    post.mockImplementation(async () => ({ data: { label: 'WLC-1', key: 'wfc_NEW', graceUntil: '2026-10-10T06:30:00Z' } }));
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-decision="auto-unbind"]')?.textContent).toContain('켜짐'));
    expect(container.querySelector('[data-wifi-decision="key-grace"]')!.textContent).toContain('30');
    await waitFor(() => expect(container.querySelector('[data-wifi-via-grace="c1"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-wifi-rotate="c1"]')!);
    expect(container.querySelector('[data-wifi-rotate="c1"]')!.textContent).toContain('30');
    expect(container.querySelector('[data-wifi-rotate="c1"]')!.textContent).not.toContain('즉시 무효');
    fireEvent.click(container.querySelector('[data-wifi-rotate="c1"]')!);
    await waitFor(() => expect(container.querySelector('[data-wifi-issued-key]')?.textContent).toContain('wfc_NEW'));
    expect(container.querySelector('[data-wifi-issued-key]')!.textContent).toContain('이때까지만');
    expect(container.querySelector('[data-wifi-issued-key]')!.textContent).not.toContain('더 이상 받지 않습니다');
  });

  it('🔴 현황 조회 실패면 꺼짐으로 그리지 않고 모른다고 말한다', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.includes('/status')) throw new Error('500');
      if (url.includes('/collectors')) return { data: [] };
      if (url.includes('/bindings')) return { data: [], meta: { total: 0, truncated: false } };
      if (url.includes('/location/wifi/survey')) return { data: [], meta: { total: 0, truncated: false, perFloor: [], minSamplesPerFloor: 10 } };
      if (url.includes('/access-points')) return { data: [] };
      if (url.includes('/calibration-suggestions')) return { data: { samples: 0, items: [] } };
      return { data: null };
    });
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-wifi-decision="auto-unbind"]')?.textContent).toContain('확인할 수 없음'));
    expect(container.querySelector('[data-wifi-decision="auto-unbind"]')!.textContent).not.toContain('꺼짐');
    expect(container.querySelector('[data-wifi-decision="key-grace"]')!.textContent).toContain('확인할 수 없음');
  });
});
