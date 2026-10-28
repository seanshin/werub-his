'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from '@/stores/toast-store';
import { scribeApi, type LabeledSegment, type ScribeRole } from '@/lib/scribe-api';
import ScribeRecorderPanel from './ScribeRecorderPanel';
import TranscriptViewer from './TranscriptViewer';
import ScribeDraftPanel, { type SoapDraft } from './ScribeDraftPanel';

/**
 * 진료 작성기 스크라이브 섹션(§8.2) — 녹음→업로드→전사→화자분리 뷰어→SOAP 초안→적용.
 * 조합 컴포넌트: encounter 페이지 diff 최소화(1줄 삽입). 전사 미활성/실패는 우아하게 저하(무중단).
 * 보조 우선(P-1): 초안 적용 후에도 의사가 편집·검토·서명.
 */
export default function EncounterScribeSection({
  encounterId,
  onApplySoap,
}: {
  encounterId: string;
  onApplySoap: (field: keyof SoapDraft, text: string) => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [segments, setSegments] = useState<LabeledSegment[]>([]);
  const [status, setStatus] = useState<string>('');
  const [transcribing, setTranscribing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => () => stopPoll(), []);

  const startTranscribe = async () => {
    if (!sessionId) return;
    setTranscribing(true);
    try {
      await scribeApi.transcribe(encounterId, sessionId, true);
      stopPoll();
      let ticks = 0;
      pollRef.current = setInterval(async () => {
        ticks += 1;
        try {
          const s = (await scribeApi.getSession(encounterId, sessionId)).data;
          setStatus(s.status);
          if (Array.isArray(s.transcript)) setSegments(s.transcript as LabeledSegment[]);
          if (['TRANSCRIBED', 'FAILED', 'DRAFTED'].includes(s.status) || ticks > 40) {
            stopPoll();
            setTranscribing(false);
          }
        } catch {
          stopPoll();
          setTranscribing(false);
        }
      }, 3000);
    } catch (e) {
      setTranscribing(false);
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('TRANSCRIPTION_DISABLED')) toast.info('전사 기능이 비활성 상태입니다(운영 전환 대기).');
      else toast.error('전사 요청 실패 — 직접 작성하세요.');
    }
  };

  /**
   * 🔴 D8 — 종전에는 로컬 상태만 바꿨다(voice-emr-ambient-conversation.plan.md §13.2 P2).
   *    `scribeApi.draft()` 는 DB `ScribeSession.transcript` 를 읽으므로, 서버에 남기지 않으면
   *    의사가 고친 화자가 초안에 반영되지 않는다. 실패는 되돌리고 말한다(낙관적 갱신 + 복원).
   */
  const relabel = (i: number, role: ScribeRole) => {
    if (!sessionId) return;
    const prev = segments;
    setSegments((p) => p.map((s, idx) => (idx === i ? { ...s, role } : s)));
    scribeApi.relabelSegment(encounterId, sessionId, i, role).catch(() => {
      setSegments(prev);
      toast.error('화자 라벨 저장 실패 — 이전 라벨로 되돌렸습니다.');
    });
  };

  const hasPanel = sessionId || segments.length > 0;
  return (
    <div className="relative">
      <ScribeRecorderPanel encounterId={encounterId} onSession={setSessionId} />

      {/* 전사·초안 — 헤더에서 아래로 늘어나지 않게 absolute 드롭다운(녹음 후에만 표시) */}
      {hasPanel && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(420px,90vw)] space-y-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          {sessionId && (
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={startTranscribe}
                disabled={transcribing}
                className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-50 dark:border-neutral-600"
              >
                {transcribing ? '전사 중…' : '전사·화자분리'}
              </button>
              {status && <span className="text-neutral-500">상태: {status}</span>}
            </div>
          )}
          {segments.length > 0 && <TranscriptViewer segments={segments} onRelabel={relabel} />}
          {sessionId && <ScribeDraftPanel encounterId={encounterId} sessionId={sessionId} onApply={onApplySoap} />}
        </div>
      )}
    </div>
  );
}
