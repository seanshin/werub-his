'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from '@/stores/toast-store';
import { scribeApi } from '@/lib/scribe-api';
import { useScribeRecorder } from './useScribeRecorder';
import RecordingConsentGate from './RecordingConsentGate';

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('오디오 인코딩 실패'));
    r.readAsDataURL(b);
  });
}

/**
 * WeRU.B 스크라이브 캡처 패널(P1 FE 셸) — 기획 §8.2.
 * 흐름: 동의 게이트 → 녹음(상시 표시) → 종료 → 업로드(세션 생성+오디오) → 전사(P1·501 대기).
 * 완전 논블로킹: 녹음/업로드 실패가 진료·서명 흐름을 막지 않음(수동 작성 그대로).
 * ⚠️ encounter 작성 페이지에 <ScribeRecorderPanel encounterId={...} /> 로 끼워넣어 사용(별도 배선).
 */
export default function ScribeRecorderPanel({ encounterId, onSession }: { encounterId: string; onSession?: (sid: string) => void }) {
  const rec = useScribeRecorder();
  const [consented, setConsented] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const autoTriedRef = useRef(false);

  const handleUpload = async () => {
    if (!rec.blob) return;
    setUploading(true);
    try {
      const dataUrl = await blobToBase64(rec.blob);
      const sid = sessionId ?? (await scribeApi.startSession(encounterId)).data.id;
      setSessionId(sid);
      onSession?.(sid);
      const res = await scribeApi.uploadAudio(encounterId, sid, dataUrl, rec.mimeType);
      setUploaded(true);
      toast.success(`녹음 업로드 완료 (${Math.round(res.data.bytes / 1024)}KB)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('RECORDING_CONSENT_REQUIRED')) {
        setConsented(false);
        toast.error('녹음 동의가 필요합니다.');
      } else if (msg.includes('SCRIBE_DISABLED')) {
        toast.info('스크라이브 기능이 비활성 상태입니다.');
      } else {
        toast.error('업로드 실패 — 수동 작성으로 진행하세요.');
      }
    } finally {
      setUploading(false);
    }
  };

  // 녹음 종료 → 자동 업로드(수동 클릭 불필요). 실패해도 재시도 버튼 노출·1회만 자동 시도.
  useEffect(() => {
    if (rec.state === 'stopped' && rec.blob && !uploaded && !uploading && !autoTriedRef.current) {
      autoTriedRef.current = true;
      void handleUpload();
    }
    if (rec.state !== 'stopped') autoTriedRef.current = false; // 다음 녹음 위해 리셋
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.state, rec.blob, uploaded, uploading]);

  // 통일 pill 스타일(VoiceHub 공용 언어) — 기본=다크, 라이브=로즈, 보조=고스트
  const primary = 'rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap bg-gray-900 text-white hover:bg-gray-700 transition';
  const live = 'rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap bg-rose-600 text-white hover:bg-rose-700 transition';
  const ghost = 'rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap border border-gray-200 text-gray-600 hover:bg-gray-50 transition';
  const ok = 'rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap bg-emerald-600 text-white disabled:opacity-50 transition';

  if (!consented) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setShowConsent(true)} className={primary}>🎙️ 녹음 시작</button>
        {showConsent && (
          <RecordingConsentGate
            onConsent={() => { setConsented(true); setShowConsent(false); }}
            onClose={() => setShowConsent(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {rec.state === 'recording' && (
        <span className="flex items-center gap-1 text-[11px] font-medium text-rose-600 whitespace-nowrap">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-600" aria-hidden /> {fmt(rec.seconds)}
        </span>
      )}
      {rec.state === 'paused' && <span className="text-[11px] text-amber-600 whitespace-nowrap">일시정지 {fmt(rec.seconds)}</span>}
      {(rec.state === 'denied' || rec.state === 'unsupported') && (
        <span className="text-[11px] text-rose-600 whitespace-nowrap" title="수동 작성으로 진행하세요">
          {rec.state === 'denied' ? '권한 거부' : '미지원'}
        </span>
      )}

      {rec.state === 'idle' && (
        <button type="button" onClick={rec.start} className={primary}>🎙️ 녹음 시작</button>
      )}
      {rec.state === 'recording' && (
        <>
          <button type="button" onClick={rec.pause} className={ghost}>일시정지</button>
          <button type="button" onClick={rec.stop} className={live}>■ 종료</button>
        </>
      )}
      {rec.state === 'paused' && (
        <>
          <button type="button" onClick={rec.resume} className={ghost}>재개</button>
          <button type="button" onClick={rec.stop} className={live}>■ 종료</button>
        </>
      )}
      {rec.state === 'stopped' && rec.blob && !uploaded && (
        <>
          {uploading ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 whitespace-nowrap">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-emerald-200 border-t-emerald-600 animate-spin" /> 업로드 중…
            </span>
          ) : (
            <button type="button" onClick={handleUpload} className={ok}>재시도</button>
          )}
          <button type="button" onClick={rec.reset} className={ghost}>다시 녹음</button>
        </>
      )}
      {uploaded && (
        <span className="flex items-center gap-1 text-[11px] text-emerald-600 whitespace-nowrap">
          업로드 완료
          <button type="button" onClick={() => { setUploaded(false); rec.reset(); }} className="underline">새 녹음</button>
        </span>
      )}
    </div>
  );
}
