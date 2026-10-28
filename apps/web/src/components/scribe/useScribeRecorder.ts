'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ScribeRecState = 'idle' | 'recording' | 'paused' | 'stopped' | 'denied' | 'unsupported' | 'error';

function pickMime(): string {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return cands.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

/**
 * 진료 오디오 캡처 훅 — getUserMedia + MediaRecorder.
 * 논블로킹: 실패(권한 거부·미지원)해도 진료 흐름을 막지 않도록 상태만 노출.
 * 브라우저 잔존 금지: 종료·언마운트 시 트랙 정지, blob은 업로드 후 reset로 폐기.
 */
export function useScribeRecorder() {
  const [state, setState] = useState<ScribeRecState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [mimeType, setMimeType] = useState<string>('audio/webm');

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mt = pickMime();
      setMimeType(mt || 'audio/webm');
      // 음성 최적화 비트레이트(32kbps) — 파일 축소(10MB에 ~40분)·업로드 부담↓. 진료 대화는 저비트로 충분.
      const opts: MediaRecorderOptions = { audioBitsPerSecond: 32_000, ...(mt ? { mimeType: mt } : {}) };
      const rec = new MediaRecorder(stream, opts);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: mt || 'audio/webm' });
        setBlob(b);
        stopTracks();
      };
      rec.start(1000); // 1s 타임슬라이스(청크)
      recRef.current = rec;
      setBlob(null);
      setSeconds(0);
      setState('recording');
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setState('denied');
      stopTracks();
    }
  }, []);

  const pause = useCallback(() => {
    if (recRef.current?.state === 'recording') {
      recRef.current.pause();
      stopTimer();
      setState('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (recRef.current?.state === 'paused') {
      recRef.current.resume();
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setState('recording');
    }
  }, []);

  const stop = useCallback(() => {
    stopTimer();
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    recRef.current = null;
    setState('stopped');
  }, []);

  const reset = useCallback(() => {
    stopTimer();
    stopTracks();
    recRef.current = null;
    chunksRef.current = [];
    setBlob(null);
    setSeconds(0);
    setState('idle');
  }, []);

  // 언마운트/이탈 시 정리(잔존 금지)
  useEffect(() => {
    return () => {
      stopTimer();
      if (recRef.current && recRef.current.state !== 'inactive') {
        try {
          recRef.current.stop();
        } catch {
          /* noop */
        }
      }
      stopTracks();
    };
  }, []);

  return { state, seconds, blob, mimeType, start, pause, resume, stop, reset };
}
