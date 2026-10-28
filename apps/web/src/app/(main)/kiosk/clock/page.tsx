'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 벽면/단말 출퇴근 QR — 단기 회전 세션을 주기 갱신해 표시. 직원이 폰으로 스캔.
export default function KioskClockPage() {
  const tAttr = useTAttr();
  const [qr, setQr] = useState<{ id: string; qrDataUrl: string } | null>(null);
  const [scanned, setScanned] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const newSession = async () => {
    setScanned(false);
    const { data } = await apiClient.post<{ data: { id: string; qrDataUrl: string } }>('/api/v1/qr/sessions', { purpose: 'CLOCK' });
    setQr(data);
  };

  useEffect(() => {
    newSession();
    const rotate = setInterval(newSession, 80_000); // TTL 90s 전 회전
    return () => clearInterval(rotate);
  }, []);

  // 소비(스캔) 폴링
  useEffect(() => {
    if (!qr) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await apiClient.get<{ data: { status: string } }>(`/api/v1/qr/sessions/${qr.id}`);
        if (data.status === 'CONSUMED') { setScanned(true); clearInterval(pollRef.current!); setTimeout(newSession, 2500); }
      } catch { /* ignore */ }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [qr]);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-bold mb-1"><T k="출·퇴근 체크" /></h1>
      <p className="text-slate-400 text-sm mb-6"><T k="휴대폰으로 QR을 스캔하세요" /></p>
      <div className="bg-white rounded-2xl p-5">
        {scanned ? (
          <div className="w-[220px] h-[220px] flex items-center justify-center text-emerald-600 text-6xl">✓</div>
        ) : qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr.qrDataUrl} alt={tAttr('출퇴근 QR')} width={220} height={220} />
        ) : (
          <div className="w-[220px] h-[220px] flex items-center justify-center text-slate-300"><T k="로딩…" /></div>
        )}
      </div>
      {scanned && <p className="mt-4 text-emerald-400"><T k="체크 완료!" /></p>}
    </div>
  );
}
