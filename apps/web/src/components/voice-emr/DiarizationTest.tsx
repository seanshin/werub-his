'use client';

import { useCallback, useRef, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { voiceApi, type DiarizeResult } from '@/lib/voice-api';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 다자간 화자분리(diarization) 테스트 — 여러 명 대화를 녹음 → WeRU.B 화자분리 → 화자별 텍스트.
 * 회진·다직역 협진 기록으로 확장 예정. WeRU.B /api/meeting/analyze 재사용(fail-open).
 */
const MAX_MS = 120_000; // 2분
const SPEAKER_STYLE = [
  'bg-indigo-50 border-indigo-200 text-indigo-900',
  'bg-emerald-50 border-emerald-200 text-emerald-900',
  'bg-amber-50 border-amber-200 text-amber-900',
  'bg-rose-50 border-rose-200 text-rose-900',
  'bg-sky-50 border-sky-200 text-sky-900',
  'bg-violet-50 border-violet-200 text-violet-900',
];
const dot = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500'];

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export function DiarizationTest() {
  const tAttr = useTAttr();
  const [phase, setPhase] = useState<'idle' | 'recording' | 'processing' | 'done' | 'error'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<DiarizeResult | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const startAt = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (tick.current) clearInterval(tick.current);
    if (autoStop.current) clearTimeout(autoStop.current);
    ctx.current?.close().catch(() => {}); ctx.current = null;
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    setLevel(0);
  }, []);

  const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  const process = useCallback(async (blob: Blob) => {
    setPhase('processing'); setProgress(4);
    try {
      const b64 = await blobToBase64(blob);
      setProgress(10);
      const { jobId } = await voiceApi.diarizeSubmit(b64, blob.type || 'audio/webm');
      setProgress(18);
      const MAX = 45;
      // 폴링 (2초 간격·최대 ~90초). 진행률은 폴 횟수 기반 점근(완료 전 95% 상한).
      for (let i = 0; i < MAX; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await voiceApi.diarizePoll(jobId);
        // WeRU.B가 progress(0~1|0~100)를 주면 우선 사용, 아니면 점근 추정
        const raw = res as unknown as { progress?: number };
        const est = 18 + 77 * (1 - Math.exp(-(i + 1) / 8));
        const server = typeof raw.progress === 'number' ? (raw.progress <= 1 ? raw.progress * 100 : raw.progress) : undefined;
        setProgress(Math.min(95, Math.max(est, server ?? 0)));
        if (res.failed) { setErrMsg(res.error || tAttr('화자분리 실패')); setPhase('error'); return; }
        if (res.done) { setProgress(100); setResult(res); setPhase('done'); return; }
      }
      setErrMsg(tAttr('시간 초과 — 잠시 후 다시 시도하세요')); setPhase('error');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setErrMsg(/AI_DISABLED|UNCONFIG|503|UPLOAD|SUBMIT/i.test(msg) ? tAttr('AI 서버(화자분리) 미가용 — 계약 확정 후 동작합니다.') : msg || tAttr('오류'));
      setPhase('error');
    }
  }, []);

  const start = useCallback(async () => {
    setResult(null); setErrMsg('');
    try {
      const deviceId = localStorage.getItem('voice.micDeviceId') || undefined;
      const s = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
      stream.current = s;
      chunks.current = [];
      const rec = new MediaRecorder(s, MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined);
      mr.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => { const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }); cleanup(); void process(blob); };
      rec.start();
      // 레벨 미터
      const ac = new AudioContext(); ctx.current = ac;
      if (ac.state === 'suspended') await ac.resume();
      const src = ac.createMediaStreamSource(s); const an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const loop = () => { an.getFloatTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]; setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3)); raf.current = requestAnimationFrame(loop); };
      loop();
      startAt.current = Date.now(); setElapsed(0);
      tick.current = setInterval(() => setElapsed(Date.now() - startAt.current), 200);
      autoStop.current = setTimeout(() => stop(), MAX_MS);
      setPhase('recording');
    } catch { toast.error(tAttr('마이크를 사용할 수 없습니다.')); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup, process]);

  const stop = useCallback(() => {
    if (mr.current && mr.current.state !== 'inactive') mr.current.stop(); // onstop → process
  }, []);

  const reset = useCallback(() => { setPhase('idle'); setResult(null); setErrMsg(''); setElapsed(0); setProgress(0); }, []);

  return (
    <div className="rounded-2xl border p-4 space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900"><T k="다자간 화자분리 테스트" /></span>
          <span className="rounded-full bg-sky-100 text-sky-700 text-[11px] font-semibold px-2 py-0.5"><T k="실험" /></span>
        </div>
        <p className="text-[12px] text-gray-500 mt-0.5"><T k="여러 명이 나눈 대화를 녹음하면" /> <b><T k="화자별로 분리" /></b><T k="해 텍스트로 표시합니다. 회진·다직역 협진 기록으로 확장 예정입니다." /></p>
      </div>

      {/* 컨트롤 */}
      {phase === 'idle' && (
        <button type="button" onClick={start} className="rounded-full bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white">● <T k="대화 녹음 시작" /></button>
      )}
      {phase === 'recording' && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={stop} className="rounded-full bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white">■ <T k="녹음 종료" /></button>
          <div className="flex items-end gap-[2px] h-6 flex-1">
            {Array.from({ length: 28 }).map((_, i) => {
              const shape = 0.4 + 0.6 * Math.sin((i / 27) * Math.PI);
              const h = Math.max(2, Math.min(24, level * 24 * shape));
              return <span key={i} style={{ height: `${h}px` }} className={`w-[3px] rounded-full transition-[height] duration-75 ${level * shape > 0.4 ? 'bg-rose-500' : 'bg-rose-300'}`} />;
            })}
          </div>
          <span className="text-xs tabular-nums text-gray-500 w-12 text-right">{fmt(elapsed)}</span>
        </div>
      )}
      {phase === 'processing' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] text-gray-600">{progress < 18 ? tAttr('업로드 중…') : progress < 95 ? tAttr('화자분리 분석 중…') : tAttr('마무리 중…')}</span>
            <span className="text-[12px] tabular-nums text-gray-400">{Math.round(progress)}<Unit>%</Unit></span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600 transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-gray-400"><T k="AI 서버(WeRU.B)에서 음성을 화자별로 분리하는 중입니다. 대화 길이에 따라 수십 초 소요됩니다." /></p>
        </div>
      )}
      {phase === 'error' && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[13px] text-rose-700">
          {errMsg}
          <button type="button" onClick={reset} className="ml-2 underline"><T k="다시" /></button>
        </div>
      )}

      {/* 결과 */}
      {phase === 'done' && result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-gray-500">{result.diarized ? <Tf k="화자 {화자}명 인식" params={{ 화자: String(result.speakerCount) }} /> : tAttr('단일/미분리')} · <Tf k="{개수}개 발화" params={{ 개수: result.segments?.length ?? 0 }} /></span>
            <button type="button" onClick={reset} className="text-[12px] text-gray-500 underline"><T k="새로 녹음" /></button>
          </div>
          {result.segments?.length ? (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {result.segments.map((s, i) => {
                const n = (parseInt(s.speakerLabel.replace(/\D/g, ''), 10) || 1) - 1;
                return (
                  <div key={i} className={`rounded-xl border px-3 py-2 ${SPEAKER_STYLE[n % SPEAKER_STYLE.length]}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`inline-block h-2 w-2 rounded-full ${dot[n % dot.length]}`} />
                      <span className="text-[11px] font-semibold">{s.speakerLabel}</span>
                      {s.end > 0 && <span className="text-[10px] opacity-50">{fmt(s.start * 1000)}~{fmt(s.end * 1000)}</span>}
                    </div>
                    <p className="text-[13px] leading-relaxed">{s.text}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400"><T k="전사 결과가 비어 있습니다." /></p>
          )}
        </div>
      )}
    </div>
  );
}
