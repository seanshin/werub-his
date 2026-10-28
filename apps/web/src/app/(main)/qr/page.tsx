'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { T, Data, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

// QR 딥링크 대상 — 직원(로그인)이 폰으로 벽면/단말 QR 스캔 시 진입. ?token 자동 처리.
export default function QrScanPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) { setState('err'); setMsg(tAttr('QR 토큰이 없습니다.')); return; }
    setState('busy');
    apiClient.post<{ data: any }>('/api/v1/qr/scan', { token })
      .then((r) => {
        const d = r.data;
        setState('ok');
        // 🔴 `출근`/`퇴근` + `체크 완료` 를 붙이면 어순이 언어마다 깨진다 — 한 문장 한 키로 넘긴다
        if (d.purpose === 'CLOCK') setMsg(tfAttr(d.type === 'CLOCK_IN' ? '출근 체크 완료 ({시각})' : '퇴근 체크 완료 ({시각})', { 시각: kdate(new Date(d.at), 'time') }));
        else if (d.purpose === 'ATTEND') setMsg(tAttr('출석 확인 완료'));
        else if (d.purpose === 'RECEIPT') setMsg(tAttr('수령 확인 완료'));
        else if (d.purpose === 'LOGIN') setMsg(tAttr('공용 단말 로그인 승인 완료'));
        else setMsg(tAttr('처리 완료'));
      })
      // 🔴 서버 message 는 데이터다 — 번역하지 않고 그대로, 없을 때만 카탈로그 문구
      .catch((e: any) => { setState('err'); setMsg(e?.message ?? tAttr('처리 실패')); });
  }, []);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="text-center">
        <div className={`text-5xl mb-3 ${state === 'ok' ? 'text-emerald-500' : state === 'err' ? 'text-rose-500' : 'text-slate-300'}`}>
          {state === 'ok' ? '✓' : state === 'err' ? '✕' : '⟳'}
        </div>
        <p className="text-lg font-medium">{state === 'busy' ? <T k="처리 중…" /> : <Data>{msg}</Data>}</p>
      </div>
    </div>
  );
}
