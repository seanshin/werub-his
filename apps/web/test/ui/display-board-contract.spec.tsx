import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LegacyWaitingBoard } from '../../src/app/display/_boards/LegacyWaitingBoard';
import { freshnessText, isStale } from '../../src/app/display/_boards/FreshnessBadge';

/**
 * 공개 전광판 FE 계약 — 2026-08-14 화면 실사용 점검 W9.
 *
 * 🔴 구형 호출 전광판이 **서버에 없는 필드 이름**을 읽고 있었다(P11). 운영 SSE 실측 페이로드는
 *    `patientName` · `IN_CONSULTATION` · `inConsultation` · `completedToday` 인데
 *    화면은 `patientInitial` · `IN_PROGRESS` · `inProgress` · `completed` 를 읽었다. 결과:
 *    대기 목록의 **이름 칸이 빈칸**, 호출 오버레이가 **"  님"**, '진료 중'·'완료' 타일이 **영구 0**.
 *    타입 검사로는 잡히지 않는다(서버 응답을 인터페이스로 **선언**해버리면 컴파일러는 믿는다) —
 *    그래서 **실제 페이로드를 흘려넣어 화면 출력으로** 고정한다.
 */

/** 운영 SSE `/api/v1/queue/public/stream` 실측 페이로드(2026-08-14 채취) — 손대지 말 것 */
const LIVE_QUEUE_UPDATE = {
  event: 'queue-update',
  data: {
    departments: [
      {
        name: '산부인과',
        queues: [
          { queueNumber: 1, status: 'CALLED', patientName: '전○우', roomName: null, doctorName: '한○부', type: 'APPOINTMENT', visitType: 'FOLLOW_UP', checkedInAt: '2026-08-13T23:54:13.290Z', calledAt: '2026-08-14T09:28:19.157Z', startedAt: null, waitMinutes: 395, callCount: 1 },
          { queueNumber: 3, status: 'WAITING', patientName: '손○연', roomName: null, doctorName: '한○부', type: 'WALK_IN', visitType: 'INITIAL', checkedInAt: '2026-08-14T00:30:13.290Z', calledAt: null, startedAt: null, waitMinutes: 359, callCount: 0 },
          { queueNumber: 9, status: 'IN_CONSULTATION', patientName: '박○아', roomName: '3진료실', doctorName: '한○부', type: 'WALK_IN', visitType: 'INITIAL', checkedInAt: '2026-08-14T01:00:00.000Z', calledAt: null, startedAt: null, waitMinutes: null, callCount: 1 },
        ],
        waiting: 6, called: 2, inConsultation: 1, completedToday: 24,
        avgWaitMinutes: null, waitSampleN: 0,
      },
    ],
  },
  timestamp: '2026-08-14T06:29:41.148Z',
};

/** 운영 SSE 호출 이벤트 실측 — roomName 이 null 인 것이 정상 케이스다(진료실 미배정) */
const LIVE_CALL = {
  event: 'call',
  data: {
    departmentName: '산부인과', queueNumber: 2, patientName: '최○준', roomName: null,
    doctorName: '한○부', calledAt: '2026-08-14T09:32:51.595Z', callCount: 1,
    ttsText: '산부인과 2번 최○준님, 접수 창구로 오세요',
  },
  timestamp: '2026-08-14T06:29:36.148Z',
};

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { FakeEventSource.last = this; }
  emit(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

beforeEach(() => {
  FakeEventSource.last = null;
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});
afterEach(() => { vi.useRealTimers(); });

describe('🔴 구형 호출 전광판 — 서버가 실제로 보내는 것을 읽는다(P11)', () => {
  const feed = (payload: unknown) => act(() => { FakeEventSource.last!.emit(payload); });

  it('대기 목록에 마스킹 환자 이름이 실제로 그려진다 — 종전엔 빈칸이었다', () => {
    render(<LegacyWaitingBoard />);
    feed(LIVE_QUEUE_UPDATE);
    expect(screen.getByText('손○연')).toBeTruthy();
    expect(screen.getByText('전○우')).toBeTruthy();
  });

  it('요약 타일 "진료 중"·"완료"가 서버 값을 그대로 보여준다 — 종전엔 영구 0 이었다', () => {
    const { container } = render(<LegacyWaitingBoard />);
    feed(LIVE_QUEUE_UPDATE);
    const tiles = [...container.querySelectorAll('.grid-cols-3 > div')].map((d) => d.textContent);
    expect(tiles[0]).toBe('6대기 중');        // waiting
    expect(tiles[1]).toBe('1진료 중');        // inConsultation — 종전 `inProgress` 라 0 이었다
    expect(tiles[2]).toBe('24완료');          // completedToday — 종전 `completed` 라 0 이었다
  });

  it('진료중 행의 상태 배지가 한글이다 — 종전엔 `IN_CONSULTATION` 원문이 전광판에 떴다', () => {
    render(<LegacyWaitingBoard />);
    feed(LIVE_QUEUE_UPDATE);
    expect(screen.getByText('진료중')).toBeTruthy();
    expect(screen.queryByText('IN_CONSULTATION')).toBeNull();
  });

  it('🔴 호출 오버레이가 누구를 부르는지 말한다 + 진료실 미배정이면 접수 창구로', () => {
    render(<LegacyWaitingBoard />);
    feed(LIVE_CALL);
    expect(screen.getByText('최○준 님')).toBeTruthy(); // 종전 "  님"
    // roomName=null 일 때 종전엔 "으로 오세요"만 떴다 — 서버 TTS 문구와 같은 곳을 가리켜야 한다
    expect(screen.getByText('산부인과 접수 창구로 오세요')).toBeTruthy();
  });

  it('waitMinutes 가 null 인 행(아직 오지 않은 접수 시각)을 0분이라 말하지 않는다', () => {
    render(<LegacyWaitingBoard />);
    feed({ ...LIVE_QUEUE_UPDATE, data: { departments: [{
      ...LIVE_QUEUE_UPDATE.data.departments[0],
      queues: [{ ...LIVE_QUEUE_UPDATE.data.departments[0].queues[1], waitMinutes: null }],
    }] } });
    expect(screen.getByText('-')).toBeTruthy();
    expect(screen.queryByText('0분')).toBeNull();
  });
});

describe('🔴 갱신 신선도 — 전광판은 사람이 리로드하지 않는다', () => {
  it('문구는 정확 비교로 고정한다(부분 문자열 단언은 깨진 출력을 숨긴다)', () => {
    const t0 = new Date('2026-08-14T06:00:00Z').getTime();
    expect(freshnessText(null, t0, 20)).toBe('자료를 아직 받지 못했습니다');
    expect(freshnessText(t0, t0, 20)).toBe('방금 갱신');
    expect(freshnessText(t0, t0 + 3_000, 20)).toBe('방금 갱신');
    expect(freshnessText(t0, t0 + 12_000, 20)).toBe('갱신 12초 전');
    // 임계를 넘기면 '몇 초 전'이 아니라 **멈췄다**고 말한다(마지막으로 받은 시각과 함께)
    const stale = freshnessText(t0, t0 + 21_000, 20);
    expect(stale.startsWith('⚠ 갱신 멈춤 · 마지막 ')).toBe(true);
    expect(stale).toBe(`⚠ 갱신 멈춤 · 마지막 ${new Date(t0).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`);
  });

  it('자료를 한 번도 못 받았으면 정체 상태로 친다 — 빈 화면을 "환자 없음"으로 읽히게 두지 않는다', () => {
    const t0 = Date.now();
    expect(isStale(null, t0, 20)).toBe(true);
    expect(isStale(t0, t0 + 5_000, 20)).toBe(false);
    expect(isStale(t0, t0 + 25_000, 20)).toBe(true);
  });

  it('SSE 가 멈추면 보드가 스스로 멈췄다고 말한다(옛 목록을 최신인 척 두지 않는다)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T06:00:00Z'));
    render(<LegacyWaitingBoard />);
    act(() => { FakeEventSource.last!.emit(LIVE_QUEUE_UPDATE); });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByTestId('freshness').textContent).toBe('방금 갱신');
    // 이후 아무것도 안 오면 — 목록은 그대로지만 화면은 멈춤을 말해야 한다
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('freshness').textContent).toBe('⚠ 갱신 멈춤 · 마지막 15:00:00');
    expect(screen.getByText('손○연')).toBeTruthy(); // 옛 목록은 남아 있되, 최신이라 주장하지 않는다
  });
});

describe('🔴 전 보드 구조 가드 — 한 곳만 고치면 갈라진다', () => {
  const BOARDS = ['ClinicQueueBoard', 'ErFlowBoard', 'LegacyWaitingBoard', 'CheckupBoard'];
  const src = (n: string) => readFileSync(join(process.cwd(), 'src/app/display/_boards', `${n}.tsx`), 'utf-8');
  /** 주석을 걷어낸 실코드 — 원 결함을 설명하는 🔴 주석이 가드에 걸리면 안 된다(설명은 남겨야 한다) */
  const code = (n: string) => src(n).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('공개 보드 네 종류 모두 마지막 갱신 시각을 표시한다', () => {
    for (const b of BOARDS) {
      expect(src(b), `${b} 가 갱신 시각을 말하지 않는다 — 끊겨도 최신처럼 보인다`).toContain('FreshnessBadge');
    }
  });

  it('서버에 없는 필드 이름을 되살리지 않는다(patientInitial·inProgress)', () => {
    for (const b of BOARDS) {
      const s = code(b);
      expect(s, `${b}: patientInitial 은 서버 응답에 없는 이름이다`).not.toMatch(/patientInitial/);
      expect(s, `${b}: 대기열 상태 원문은 IN_CONSULTATION 이다`).not.toMatch(/'IN_PROGRESS'/);
    }
  });

  it('공개 보드는 인증 클라이언트를 쓰지 않는다(TV 브라우저에 스태프 토큰 상주 금지)', () => {
    for (const b of BOARDS) {
      expect(src(b), `${b} 가 apiClient 를 쓴다`).not.toContain('apiClient');
    }
  });
});
