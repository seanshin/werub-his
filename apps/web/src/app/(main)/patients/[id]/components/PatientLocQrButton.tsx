'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { apiClient } from '@/lib/api-client';
import { escapeHtml } from '@/lib/escape-html';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 환자 위치 QR(plt) 발급 — 접수/원무가 환자에게 발급(모바일·종이·카드). 동선 체크인용.
interface Issued { token: string; mode: string; expiresAt: string; qrDataUrl?: string }

export function PatientLocQrButton({ patientId, patientName, mrn }: { patientId: string; patientName: string; mrn?: string }) {
  const tAttr = useTAttr();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'DAILY' | 'ADMISSION'>('DAILY');
  const [consent, setConsent] = useState(true);
  const [issued, setIssued] = useState<Issued | null>(null);

  const issue = async (m: 'DAILY' | 'ADMISSION') => {
    setBusy(true); setMode(m);
    try {
      const r = await apiClient.post<{ data: Issued }>('/api/v1/patient-flow/qr', { patientId, mode: m, consent });
      setIssued(r.data);
    } catch { toast.error('QR 발급 실패'); } finally { setBusy(false); }
  };

  const printQr = () => {
    if (!issued?.qrDataUrl) return;
    const w = window.open('', '_blank', 'width=400,height=560');
    if (!w) return;
    // 환자 유래 값은 escapeHtml — 인쇄 팝업 document.write XSS 방지
    w.document.write(`<html><head><title>환자 위치 QR</title></head><body style="font-family:sans-serif;text-align:center;padding:24px">
      <h2 style="margin:0">${escapeHtml(patientName)}</h2><p style="color:#666;margin:4px 0">${escapeHtml(mrn ?? '')}</p>
      <img src="${escapeHtml(issued.qrDataUrl)}" style="width:280px;height:280px" />
      <p style="font-size:12px;color:#888">${mode === 'ADMISSION' ? '입원(재원기간)' : '당일'} · 만료 ${kdate(issued.expiresAt, 'datetimeSec')}</p>
      <p style="font-size:11px;color:#aaa">각 장소 스테이션에 인식하세요</p>
    </body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };

  return (
    <>
      <button onClick={() => { setOpen(true); setIssued(null); }}
        className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
        <span aria-hidden>📍</span> <T k="위치 QR" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900"><T k="환자 위치 QR 발급" /></h3>
            <p className="text-xs text-gray-500 mt-0.5 mb-4">{patientName} {mrn} — 동선 체크인용. 모바일·종이·카드 무엇으로 출력해도 동일 인식.</p>

            {!issued ? (
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 rounded-xl px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600" />
                  <span><b>위치추적 동의</b> — 원내 동선 확인·대기 안내·감염 역추적 목적으로 위치 기록에 동의합니다. (가입/접수 시 수집)</span>
                </label>
                <button disabled={busy} onClick={() => issue('DAILY')} className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"><T k="당일 QR 발급 (외래 · 자정 만료)" /></button>
                <button disabled={busy} onClick={() => issue('ADMISSION')} className="w-full py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"><T k="입원 QR 발급 (재원기간 · 팔찌)" /></button>
                <button onClick={() => setOpen(false)} className="w-full py-2 rounded-xl bg-gray-100 text-gray-600 text-sm"><T k="닫기" /></button>
              </div>
            ) : (
              <div className="text-center">
                {issued.qrDataUrl && <img src={issued.qrDataUrl} alt={tAttr("환자 위치 QR")} className="w-52 h-52 mx-auto rounded-xl border border-gray-100" />}
                <p className="mt-2 text-xs text-gray-500">{mode === 'ADMISSION' ? '입원(재원기간)' : '당일'} · 만료 {kdate(issued.expiresAt, 'datetimeShort')}</p>
                <div className="flex gap-2 mt-4">
                  <button onClick={printQr} className="flex-1 py-2.5 rounded-xl bg-gray-800 text-white text-sm font-medium"><T k="🖨️ 출력(종이/카드)" /></button>
                  <button onClick={() => setOpen(false)} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm"><T k="닫기" /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
