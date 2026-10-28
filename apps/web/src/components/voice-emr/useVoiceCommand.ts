/**
 * VoiceEMR — 음성 캡처 훅 (프로토타입·미배선·브라우저 글루)
 *
 * Web Audio 캡처 → frameToPcm16(순수) → ChunkScheduler(순수) → 주입된 sendChunk 로 전송.
 * 네트워크는 주입(sendChunk)이라 훅은 캡처/스케줄만 담당(결합도↓). AudioWorklet 이 프로덕션
 * 타깃이나 스캐폴드는 ScriptProcessor 로 흐름 시연. 어떤 page 도 미import(런타임 무영향).
 * 설계: voice-emr-pipeline-design.md §1
 */
'use client';
import { useCallback, useEffect, useRef } from 'react';
import { frameToPcm16, pcmHasSpeech } from './audio-pcm';
import { ChunkScheduler } from './chunk-scheduler';

export interface ChunkResult { text?: string; confidence?: number; dropped_s?: number }

export interface UseVoiceCommandOpts {
  enabled: boolean;                 // config voiceEmr.enabled(서버) 반영
  ptt: boolean;                     // 활력/명령=PTT, 구술=오픈마이크
  chunkMs?: number;
  /** 청크 전송(주입) — 실제 EP `/api/v1/voice/session/:sid/chunk` 배선은 승인 후 */
  sendChunk: (sid: string, pcm: Int16Array, mode: 'partial' | 'final') => Promise<ChunkResult>;
  onPartial?: (text: string, confidence?: number) => void;
  onFinal?: (sid: string, r: ChunkResult) => void;
  onLevel?: (level: number) => void; // 마이크 입력 레벨 0~1(RMS·VU 미터)
  onError?: (e: unknown) => void;
}

export function useVoiceCommand(opts: UseVoiceCommandOpts) {
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const bufRef = useRef<Int16Array[]>([]);
  const schedRef = useRef<ChunkScheduler | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);

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

  const flush = useCallback(async (sid: string, mode: 'partial' | 'final') => {
    try {
      const pcm = drain();
      if (!pcm.length) return;
      if (!pcmHasSpeech(pcm)) return; // 무음 구간 → 전송 안 함(환각 방지). 상태 복귀는 endCapture 담당.
      const r = await opts.sendChunk(sid, pcm, mode);
      if (mode === 'final') opts.onFinal?.(sid, r);
      else if (r.text) opts.onPartial?.(r.text, r.confidence);
    } catch (e) { opts.onError?.(e); }
  }, [drain, opts]);

  /** 캡처 시작(PTT down / 오픈마이크 onset) */
  const begin = useCallback(async () => {
    if (!opts.enabled || typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    try {
      // 저장된 마이크 장치/감도(설정 화면)
      const deviceId = typeof localStorage !== 'undefined' ? localStorage.getItem('voice.micDeviceId') || undefined : undefined;
      const gain = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('voice.micGain')) || 1 : 1;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume(); // autoplay 정책 — 무음 방지
      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1); // 프로덕션=AudioWorklet
      procRef.current = proc;
      // PCM 캡처는 ScriptProcessor, 레벨(VU)은 AnalyserNode+rAF(설정 테스트와 동일·부드럽고 정확)
      proc.onaudioprocess = (e) => { bufRef.current.push(frameToPcm16(e.inputBuffer.getChannelData(0), ctx.sampleRate)); };
      source.connect(proc); proc.connect(ctx.destination);

      if (opts.onLevel) {
        const an = ctx.createAnalyser(); an.fftSize = 1024; source.connect(an);
        const buf = new Float32Array(an.fftSize);
        let peak = 0;
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0, p = 0;
          for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
          const rms = Math.sqrt(sum / buf.length);
          peak = Math.max(peak * 0.85, p);
          opts.onLevel!(Math.min(1, (Math.pow(rms, 0.5) * 2.4 + peak * 0.6) * gain));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      }

      const sched = new ChunkScheduler({ chunkMs: opts.chunkMs });
      schedRef.current = sched;
      sched.start(now());
      timerRef.current = setInterval(() => {
        const a = sched.tick(now());
        if (a.type === 'partial') void flush(a.sid, 'partial');
        else if (a.type === 'final') void flush(a.sid, 'final'); // 강제 final → nextSid 로 이어 캡처
      }, 250);
    } catch (e) { opts.onError?.(e); }
  }, [opts, flush]);

  /** 캡처 종료(PTT up / offset) */
  const end = useCallback(async () => {
    const sched = schedRef.current;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (sched) { const a = sched.end(); if (a.type === 'final') await flush(a.sid, 'final'); }
    procRef.current?.disconnect(); procRef.current = null;
    ctxRef.current?.close().catch(() => {}); ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null;
  }, [flush]);

  // 언마운트 정리 — ref로 최신 end 참조(매 렌더 재실행 금지·무한 루프 방지). 실제 unmount 시 1회만.
  const endRef = useRef(end); endRef.current = end;
  useEffect(() => () => { void endRef.current(); }, []);

  return { begin, end, ptt: opts.ptt };
}
