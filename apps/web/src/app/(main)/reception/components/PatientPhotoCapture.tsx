'use client';

import { useEffect, useRef, useState } from 'react';
import { T, useTAttr } from '@/components/ui/i18n-text';

export type PhotoValue = { type: 'camera'; dataUrl: string } | { type: 'preset'; path: string } | null;

const PRESETS = [
  '/images/avatars/patient-m-20.png', '/images/avatars/patient-m-40.png', '/images/avatars/patient-m-60.png', '/images/avatars/patient-m-70.png',
  '/images/avatars/patient-f-20.png', '/images/avatars/patient-f-30.png', '/images/avatars/patient-f-60.png',
  '/images/avatars/patient-child-m.png', '/images/avatars/patient-child-f.png',
];

export function PatientPhotoCapture({ value, onChange }: { value: PhotoValue; onChange: (v: PhotoValue) => void }) {
  const tAttr = useTAttr();
  const [cam, setCam] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

  const preview = value?.type === 'camera' ? value.dataUrl : value?.type === 'preset' ? value.path : null;

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="w-20 h-20 rounded-2xl bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center flex-shrink-0">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={tAttr('환자 사진')} className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl text-gray-300">👤</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => setCam(true)} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">📷 <T k="사진 촬영" /></button>
          <button type="button" onClick={() => setShowPresets((v) => !v)} className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50"><T k="이미지 선택 (촬영 불가 시)" /></button>
          {value && <button type="button" onClick={() => onChange(null)} className="text-[11px] text-gray-400 underline"><T k="제거" /></button>}
        </div>
      </div>

      {showPresets && (
        <div className="mt-2 flex flex-wrap gap-1.5 p-2 bg-gray-50 rounded-xl max-w-[260px]">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => { onChange({ type: 'preset', path: p }); setShowPresets(false); }}
              className={`w-14 h-14 rounded-lg overflow-hidden border-2 ${value?.type === 'preset' && value.path === p ? 'border-blue-500' : 'border-gray-200'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" className="w-full h-full object-cover bg-white" />
            </button>
          ))}
        </div>
      )}

      {cam && <CameraModal onCapture={(dataUrl) => { onChange({ type: 'camera', dataUrl }); setCam(false); }} onClose={() => setCam(false)} />}
    </div>
  );
}

function CameraModal({ onCapture, onClose }: { onCapture: (dataUrl: string) => void; onClose: () => void }) {
  const tAttr = useTAttr();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
        if (videoRef.current && !stopped) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      } catch { setErr(tAttr('카메라에 접근할 수 없습니다. 권한을 확인하거나 이미지를 선택하세요.')); }
    })();
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const capture = () => {
    const v = videoRef.current; if (!v) return;
    const size = 320;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    // 정사각형 중앙 크롭
    const min = Math.min(v.videoWidth, v.videoHeight);
    const sx = (v.videoWidth - min) / 2; const sy = (v.videoHeight - min) / 2;
    ctx.drawImage(v, sx, sy, min, min, 0, 0, size, size);
    onCapture(canvas.toDataURL('image/jpeg', 0.85));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900"><T k="환자 사진 촬영" /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-4">
          {err ? <p className="text-sm text-red-500 py-8 text-center">{err}</p> : (
            <>
              <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                <div className="absolute inset-6 border-2 border-white/70 rounded-full pointer-events-none" />
              </div>
              <button onClick={capture} className="mt-3 w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">📸 <T k="촬영" /></button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** PhotoValue → 업로드용 Blob */
export async function photoToBlob(v: PhotoValue): Promise<Blob | null> {
  if (!v) return null;
  if (v.type === 'camera') {
    const res = await fetch(v.dataUrl);
    return res.blob();
  }
  const res = await fetch(v.path);
  return res.blob();
}
