'use client';

import { useEffect, useRef, useState } from 'react';
import { T } from '@/components/ui/i18n-text';

// 카메라 QR 스캔 — 브라우저 BarcodeDetector(라이브러리 불필요, Chrome 지원)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BD = any;

export function QrScanModal({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Detector: BD = (window as any).BarcodeDetector;
    if (!Detector) { setErr('이 브라우저는 카메라 QR 스캔을 지원하지 않습니다. 환자 검색을 이용하세요.'); return; }
    const detector = new Detector({ formats: ['qr_code'] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const scan = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length) { onResult(codes[0].rawValue as string); return; }
          } catch { /* 프레임 무시 */ }
          raf = requestAnimationFrame(scan);
        };
        raf = requestAnimationFrame(scan);
      } catch { setErr('카메라에 접근할 수 없습니다. 권한을 확인하세요.'); }
    })();

    return () => { stopped = true; if (raf) cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onResult]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900"><T k="환자 QR 스캔" /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-4">
          {err ? (
            <p className="text-sm text-red-500 py-8 text-center">{err}</p>
          ) : (
            <>
              <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                <div className="absolute inset-8 border-2 border-white/70 rounded-2xl pointer-events-none" />
              </div>
              <p className="text-xs text-gray-500 text-center mt-3"><T k="환자 포털의 체크인 QR을 비춰주세요" /></p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
