import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

/**
 * 🔴 D8 — `TranscriptViewer.onRelabel` 이 로컬 상태만 바꾸던 결함(voice-emr-ambient-conversation.plan.md
 * §13.2 P2). `EncounterScribeSection` 이 재라벨을 `scribeApi.relabelSegment` 로 서버에 영속시키고,
 * 실패하면 되돌리고 말한다(CLAUDE.md §1 — 낙관적 갱신은 유지하되 실패를 성공으로 보이게 하지 않는다).
 */
const { scribeApiMock, toastMock } = vi.hoisted(() => ({
  scribeApiMock: {
    startSession: vi.fn(),
    getSession: vi.fn(),
    uploadAudio: vi.fn(),
    transcribe: vi.fn(),
    draft: vi.fn(),
    relabelSegment: vi.fn(),
  },
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/scribe-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scribe-api')>('@/lib/scribe-api');
  return { ...actual, scribeApi: scribeApiMock };
});
vi.mock('@/stores/toast-store', () => ({ toast: toastMock }));
// 녹음·업로드 UI 는 이 축의 대상이 아니다 — 세션을 즉시 열어 전사 폴링만 검증한다
vi.mock('@/components/scribe/ScribeRecorderPanel', () => ({
  default: ({ onSession }: { onSession: (sid: string) => void }) => {
    React.useEffect(() => { onSession('s1'); }, []);
    return null;
  },
}));
vi.mock('@/components/scribe/ScribeDraftPanel', () => ({ default: () => null }));

import EncounterScribeSection from '../../src/components/scribe/EncounterScribeSection';

const SEGMENTS = [
  { speaker: 'spk_0', role: 'DOCTOR', start: 0, end: 1.2, text: '어디가 불편하세요' },
  { speaker: 'spk_1', role: 'DOCTOR', start: 1.3, end: 2.5, text: '두통이 있어요' }, // 화자분리가 틀렸다고 가정 — 의사가 정정
];

async function openWithSegments() {
  scribeApiMock.transcribe.mockResolvedValue({ data: { sessionId: 's1', jobId: 'j1', status: 'TRANSCRIBING' } });
  scribeApiMock.getSession.mockResolvedValue({ data: { id: 's1', status: 'TRANSCRIBED', transcript: SEGMENTS, encounterId: 'e1' } });
  render(<EncounterScribeSection encounterId="e1" onApplySoap={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('전사·화자분리')).toBeTruthy());
  vi.useFakeTimers();
  fireEvent.click(screen.getByText('전사·화자분리'));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  vi.useRealTimers();
  await waitFor(() => expect(screen.getByText('두통이 있어요')).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('스크라이브 화자 재라벨 — 서버 영속(D8)', () => {
  it('🔴 재라벨이 scribeApi.relabelSegment 로 서버에 저장된다', async () => {
    await openWithSegments();
    scribeApiMock.relabelSegment.mockResolvedValue({ data: { ...SEGMENTS[1], role: 'PATIENT' } });
    const selects = screen.getAllByLabelText('화자 라벨 수정');
    fireEvent.change(selects[1], { target: { value: 'PATIENT' } });
    await waitFor(() => expect(scribeApiMock.relabelSegment).toHaveBeenCalledWith('e1', 's1', 1, 'PATIENT'));
  });

  it('🔴 저장 실패 시 이전 라벨로 되돌리고 실패를 말한다(성공한 척하지 않는다)', async () => {
    await openWithSegments();
    scribeApiMock.relabelSegment.mockRejectedValueOnce(new Error('500'));
    const selects = screen.getAllByLabelText('화자 라벨 수정');
    fireEvent.change(selects[1], { target: { value: 'PATIENT' } });
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('되돌렸습니다')));
    // 되돌아간 뒤에도 select 는 여전히 DOCTOR(원래 라벨)를 가리킨다
    await waitFor(() => expect((screen.getAllByLabelText('화자 라벨 수정')[1] as HTMLSelectElement).value).toBe('DOCTOR'));
  });
});
