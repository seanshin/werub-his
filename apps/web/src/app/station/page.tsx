'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 장소 스테이션 스캐너 — 환자 위치 QR을 인식해 동선 체크인. X-Station-Key 인증(직원 로그인 불필요).
// 카메라: 브라우저 네이티브 BarcodeDetector(있으면) / 없으면 키보드웨지·수동 입력.
interface CheckinResult {
  patient?: { familyName: string; givenName: string; mrn: string };
  fromZone?: { name: string } | null;
  toZone?: { name: string; floor?: number } | null;
  duplicate?: boolean;
  enteredAt?: string;
}

export default function StationPage() {
  const [stationKey, setStationKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState('');
  const [camOn, setCamOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastScan = useRef<{ v: string; t: number }>({ v: '', t: 0 });

  useEffect(() => {
    const k = localStorage.getItem('stationKey');
    if (k) { setStationKey(k); setKeySaved(true); }
  }, []);

  const doCheckin = useCallback(async (plt: string) => {
    const v = plt.trim();
    if (!v || busy) return;
    // 중복 스캔 디바운스(2초)
    if (lastScan.current.v === v && Date.now() - lastScan.current.t < 2000) return;
    lastScan.current = { v, t: Date.now() };
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/v1/patient-flow/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Station-Key': stationKey },
        body: JSON.stringify({ plt: v }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || '체크인 실패');
      setResult(json.data);
      setManual('');
      setTimeout(() => setResult(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '체크인 실패');
      setTimeout(() => setError(''), 4000);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [stationKey, busy]);

  // 카메라 QR 스캔(BarcodeDetector)
  useEffect(() => {
    if (!camOn) return;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setError('이 브라우저는 카메라 QR 인식을 지원하지 않습니다. 리더기/수동 입력을 사용하세요.'); setCamOn(false); return; }
    const detector = new BD({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let raf = 0;
    let active = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const loop = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) await doCheckin(codes[0].rawValue);
          } catch { /* 프레임 스킵 */ }
          raf = requestAnimationFrame(() => { setTimeout(loop, 400); });
        };
        loop();
      } catch { setError('카메라 접근 실패'); setCamOn(false); }
    })();
    return () => { active = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [camOn, doCheckin]);

  if (!keySaved) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-900 px-4">
        <div className="w-full max-w-sm bg-white rounded-3xl p-7 shadow-xl">
          <h1 className="text-lg font-bold text-gray-900 mb-1">스테이션 설정</h1>
          <p className="text-xs text-gray-500 mb-4">관리자에게 발급받은 이 기기의 <b>스테이션 키</b>를 입력하세요. (위치=관리자 등록 구역)</p>
          <input value={stationKey} onChange={(e) => setStationKey(e.target.value)} placeholder="stn_..."
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono mb-3" />
          <button onClick={() => { if (stationKey.trim()) { localStorage.setItem('stationKey', stationKey.trim()); setKeySaved(true); } }}
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm">이 기기 등록</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-900 text-white flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">🏥 동선 체크인</h1>
        <button onClick={() => { localStorage.removeItem('stationKey'); setKeySaved(false); }} className="text-xs text-slate-400">기기 재설정</button>
      </div>

      {/* 결과 */}
      <div className="w-full max-w-md min-h-[140px] mb-6">
        {result ? (
          <div className={`rounded-3xl p-6 text-center ${result.duplicate ? 'bg-slate-700' : 'bg-emerald-600'}`}>
            <p className="text-2xl font-bold">{result.patient ? `${result.patient.familyName}${result.patient.givenName}` : '환자'}</p>
            <p className="text-sm opacity-80">{result.patient?.mrn}</p>
            {result.duplicate ? (
              <p className="mt-3 text-sm">이미 <b>{result.toZone?.name}</b>에 체크인됨</p>
            ) : (
              <p className="mt-3 text-base">{result.fromZone?.name ? `${result.fromZone.name} → ` : '입장 · '}<b>{result.toZone?.name}</b> 체크인 완료</p>
            )}
          </div>
        ) : error ? (
          <div className="rounded-3xl p-6 text-center bg-red-600"><p className="text-base font-semibold">{error}</p></div>
        ) : (
          <div className="rounded-3xl p-6 text-center bg-slate-800 border border-slate-700">
            <p className="text-sm text-slate-400">환자 QR을 인식하세요</p>
          </div>
        )}
      </div>

      {/* 카메라 */}
      {camOn && (
        <div className="w-full max-w-md mb-4 rounded-2xl overflow-hidden bg-black aspect-square">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        </div>
      )}

      <div className="w-full max-w-md space-y-3">
        <button onClick={() => setCamOn((v) => !v)}
          className={`w-full py-3 rounded-xl font-semibold text-sm ${camOn ? 'bg-slate-700' : 'bg-blue-600'}`}>
          {camOn ? '카메라 끄기' : '📷 카메라 스캔'}
        </button>
        {/* 키보드웨지 리더/수동 입력 */}
        <form onSubmit={(e) => { e.preventDefault(); doCheckin(manual); }}>
          <input ref={inputRef} value={manual} onChange={(e) => setManual(e.target.value)} autoFocus
            placeholder="QR 리더기 인식 또는 토큰 수동 입력 후 Enter"
            className="w-full px-3 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder:text-slate-500" />
        </form>
        <p className="text-[11px] text-slate-500 text-center">{busy ? '처리 중…' : '리더기는 인식 즉시 자동 전송됩니다.'}</p>
      </div>
    </div>
  );
}
