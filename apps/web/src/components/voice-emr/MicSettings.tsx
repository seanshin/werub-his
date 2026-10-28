'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 마이크 설정 — 장치 선택·감도·실시간 레벨 테스트.
 * 선택/감도는 localStorage(voice.micDeviceId·voice.micGain)에 저장 → useVoiceCommand 가 소비.
 */
export function MicSettings() {
  const tAttr = useTAttr();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [gain, setGain] = useState(1);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setDeviceId(localStorage.getItem('voice.micDeviceId') || '');
    setGain(Number(localStorage.getItem('voice.micGain')) || 1);
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      // 라벨 노출을 위해 권한 1회 요청
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'audioinput'));
    } catch { /* 권한 거부 */ }
  }, []);
  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const saveDevice = (id: string) => { setDeviceId(id); if (id) localStorage.setItem('voice.micDeviceId', id); else localStorage.removeItem('voice.micDeviceId'); };
  const saveGain = (g: number) => { setGain(g); localStorage.setItem('voice.micGain', String(g)); };

  const stopTest = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close().catch(() => {}); ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null;
    setTesting(false); setLevel(0);
  }, []);

  const startTest = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      const ctx = new AudioContext(); ctxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      setTesting(true);
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0, p = 0; for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, (Math.pow(rms, 0.5) * 2.4 + p * 0.6) * gain));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { stopTest(); }
  }, [deviceId, gain, stopTest]);
  useEffect(() => () => stopTest(), [stopTest]);

  return (
    <div className="rounded-2xl border bg-white shadow-xl p-4 space-y-4">
      <div>
        <label className="text-xs font-medium text-gray-500"><T k="마이크 장치" /></label>
        <div className="mt-1 flex gap-2">
          <select value={deviceId} onChange={(e) => saveDevice(e.target.value)} className="flex-1 rounded-lg border px-2 py-1.5 text-sm">
            <option value="">{tAttr('기본 마이크')}</option>
            {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || `마이크 ${d.deviceId.slice(0, 6)}`}</option>)}
          </select>
          <button type="button" onClick={loadDevices} className="rounded-lg border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"><T k="새로고침" /></button>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500">감도 (볼륨 배율): {gain.toFixed(1)}×</label>
        <input type="range" min={0.5} max={3} step={0.1} value={gain} onChange={(e) => saveGain(Number(e.target.value))} className="mt-1 w-full" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-500"><T k="마이크 테스트" /></label>
          {testing
            ? <button type="button" onClick={stopTest} className="rounded-full bg-gray-800 px-3 py-1 text-[11px] font-medium text-white"><T k="중지" /></button>
            : <button type="button" onClick={startTest} className="rounded-full bg-rose-600 px-3 py-1 text-[11px] font-medium text-white"><T k="테스트 시작" /></button>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-end gap-[2px] h-6 flex-1">
            {Array.from({ length: 32 }).map((_, i) => {
              const shape = 0.4 + 0.6 * Math.sin((i / 31) * Math.PI);
              const h = testing ? Math.max(2, Math.min(24, level * 24 * shape * (0.7 + 0.6 * Math.random()))) : 2;
              const hot = testing && level * shape > 0.45;
              return <span key={i} style={{ height: `${h}px` }} className={`w-[3px] rounded-full transition-[height] duration-75 ${hot ? 'bg-rose-500' : testing ? 'bg-rose-300' : 'bg-gray-200'}`} />;
            })}
          </div>
          <span className="w-10 text-right text-xs tabular-nums text-gray-500">{Math.round(level * 100)}<Unit>%</Unit></span>
        </div>
        <p className="mt-1 text-[11px] text-gray-400"><T k="말하면 바가 반응해야 합니다. 반응이 약하면 감도를 올리거나 마이크를 확인하세요." /></p>
      </div>
    </div>
  );
}
