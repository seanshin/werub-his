'use client';
/**
 * VoiceEMR 앰비언트 — 오픈마이크 대화 캡처 훅 (브라우저 글루)
 *
 * useVoiceCommand(PTT)와 달리 **연속 청취**: 프레임별 VAD → VadSegmenter 가 발화 경계
 * (onset/무성 1.2s offset)를 판정하고, 발화 중에만 ChunkScheduler 로 partial/강제 final.
 * 네트워크는 주입(sendChunk) — 훅은 캡처/경계만 담당. 기획 §4.
 */
import { useCallback, useRef, useState } from 'react';
import { frameToPcm16, pcmHasSpeech } from './audio-pcm';
import { ChunkScheduler } from './chunk-scheduler';
import { VadSegmenter } from './vad-segmenter';

export interface AmbientChunkResult { text?: string; confidence?: number; dropped_s?: number }
export type FinalReason = 'silence' | 'forced' | 'stop';

export interface UseAmbientCaptureOpts {
  /** 청크 전송 — /api/v1/voice/session/:voiceSid/chunk (voiceSid 는 호출측 보유) */
  sendChunk: (mode: 'partial' | 'final', pcm: Int16Array) => Promise<AmbientChunkResult>;
  /** 발화 확정(final 응답) — reason=forced 면 25s 초과 연속 발화의 이어짐 */
  onFinal: (r: AmbientChunkResult, reason: FinalReason) => void;
  onPartial?: (text: string, confidence?: number) => void;
  onLevel?: (level: number) => void;
  onError?: (e: unknown) => void;
  silenceFinalizeMs?: number; // 기본 1200
  chunkMs?: number;
}

export function useAmbientCapture(opts: UseAmbientCaptureOpts) {
  const [capturing, setCapturing] = useState(false); // 마이크 열림
  const [speaking, setSpeaking] = useState(false);   // 발화 중(세그먼터 active)
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const bufRef = useRef<Int16Array[]>([]);
  const schedRef = useRef<ChunkScheduler | null>(null);
  const segRef = useRef<VadSegmenter | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const optsRef = useRef(opts); optsRef.current = opts;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

  const drain = useCallback((): Int16Array => {
    const parts = bufRef.current;
    bufRef.current = [];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Int16Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }, []);

  const flush = useCallback(async (mode: 'partial' | 'final', reason?: FinalReason) => {
    try {
      const pcm = drain();
      if (mode === 'final') {
        if (pcm.length && pcmHasSpeech(pcm)) {
          const r = await optsRef.current.sendChunk('final', pcm);
          optsRef.current.onFinal(r, reason ?? 'silence');
        } else if (reason !== 'stop') {
          // 꼬리가 전부 무음이어도 발화는 확정해야 함 — 서버 partial 누적을 final 로 닫음(빈 PCM 전송 대신 1프레임 무음)
          const r = await optsRef.current.sendChunk('final', pcm.length ? pcm : new Int16Array(160));
          optsRef.current.onFinal(r, reason ?? 'silence');
        }
        return;
      }
      if (!pcm.length || !pcmHasSpeech(pcm)) return; // partial 무음 → 미전송(환각 방지)
      const r = await optsRef.current.sendChunk('partial', pcm);
      if (r.text) optsRef.current.onPartial?.(r.text, r.confidence);
    } catch (e) { optsRef.current.onError?.(e); }
  }, [drain]);

  /** 대화 캡처 시작(오픈마이크) */
  const begin = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || ctxRef.current) return;
    try {
      const deviceId = typeof localStorage !== 'undefined' ? localStorage.getItem('voice.micDeviceId') || undefined : undefined;
      const gain = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('voice.micGain')) || 1 : 1;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      const sched = new ChunkScheduler({ chunkMs: optsRef.current.chunkMs });
      schedRef.current = sched;
      const seg = new VadSegmenter({ silenceMs: optsRef.current.silenceFinalizeMs ?? 1200 });
      segRef.current = seg;

      proc.onaudioprocess = (e) => {
        if (pausedRef.current) return;
        const pcm = frameToPcm16(e.inputBuffer.getChannelData(0), ctx.sampleRate);
        const ev = seg.feed(pcmHasSpeech(pcm), now());
        if (ev === 'onset') {
          sched.start(now());
          bufRef.current = [pcm];
          setSpeaking(true);
          return;
        }
        if (seg.active) bufRef.current.push(pcm);
        if (ev === 'offset') {
          const a = sched.end();
          setSpeaking(false);
          if (a.type === 'final') void flush('final', 'silence');
        }
      };
      source.connect(proc); proc.connect(ctx.destination);

      if (optsRef.current.onLevel) {
        const an = ctx.createAnalyser(); an.fftSize = 1024; source.connect(an);
        const buf = new Float32Array(an.fftSize);
        let peak = 0;
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0, p = 0;
          for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
          const rms = Math.sqrt(sum / buf.length);
          peak = Math.max(peak * 0.85, p);
          optsRef.current.onLevel?.(Math.min(1, (Math.pow(rms, 0.5) * 2.4 + peak * 0.6) * gain));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      }

      timerRef.current = setInterval(() => {
        if (pausedRef.current || !seg.active) return;
        const a = sched.tick(now());
        if (a.type === 'partial') void flush('partial');
        else if (a.type === 'final') void flush('final', 'forced'); // 25s 초과 — 발화 분절·nextSid 로 이어짐
      }, 250);
      setCapturing(true);
    } catch (e) { optsRef.current.onError?.(e); }
  }, [flush]);

  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p;
    if (p && segRef.current?.active) { // 일시정지 시 진행 중 발화 확정
      const a = schedRef.current?.end();
      segRef.current.reset();
      setSpeaking(false);
      if (a && a.type === 'final') void flush('final', 'silence');
    }
  }, [flush]);

  /** 캡처 종료 — 진행 중 발화 확정 후 자원 해제 */
  const stop = useCallback(async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (segRef.current?.active) {
      const a = schedRef.current?.end();
      segRef.current.reset();
      if (a && a.type === 'final') await flush('final', 'stop');
    }
    procRef.current?.disconnect(); procRef.current = null;
    ctxRef.current?.close().catch(() => {}); ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null;
    schedRef.current = null; segRef.current = null;
    pausedRef.current = false;
    setSpeaking(false);
    setCapturing(false);
  }, [flush]);

  return { begin, stop, setPaused, capturing, speaking };
}
