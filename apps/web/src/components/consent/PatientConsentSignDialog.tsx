'use client';

import { useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { SignaturePad, type SignaturePadHandle } from '@/components/signature/SignaturePad';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { extractErrorMessage } from '@/lib/error-utils';

/**
 * 동의서 환자 서명 받기(2026-10-13 결함 발굴 A1).
 *  · 🔴 종전: 직원 화면이 `prompt('서명자 이름')` 하나로 `PATCH consent/:id/sign` 을 불러 환자 서명 없이 "서명 완료"가 됐다.
 *  · 이제 증거 둘 중 하나 — 서명패드(환자가 이 화면에 직접) 또는 종이 서명(서명된 종이의 스캔본을 올림).
 *  · 쓰기 폼 초기값은 미선택 — 방식·서명자 이름 모두 비어서 시작한다.
 */
type Mode = 'PAD' | 'PAPER';

export function PatientConsentSignDialog({ consentId, title, onClose, onSigned }: {
  consentId: string; title?: string; onClose: () => void; onSigned: () => void;
}) {
  const tAttr = useTAttr();
  const pad = useRef<SignaturePadHandle>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [signedBy, setSignedBy] = useState('');
  const [padEmpty, setPadEmpty] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = !!signedBy.trim() && (mode === 'PAD' ? !padEmpty : mode === 'PAPER' ? !!file : false);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      if (mode === 'PAD') {
        const img = pad.current?.toDataURL();
        if (!img) { setPadEmpty(true); return; }
        await apiClient.patch(`/api/v1/consent/${consentId}/sign`, { patientSignedBy: signedBy.trim(), signMode: 'PAD', patientSignature: img });
      } else {
        const form = new FormData();
        form.append('file', file!);
        const up = await apiClient.postForm<{ data: { attachments: unknown[] } }>(`/api/v1/consent/${consentId}/attachments`, form);
        const n = Array.isArray(up?.data?.attachments) ? up.data.attachments.length : 0;
        if (n < 1) throw new Error(tAttr('스캔본 업로드 결과를 확인할 수 없어 서명을 기록하지 않았습니다'));
        await apiClient.patch(`/api/v1/consent/${consentId}/sign`, { patientSignedBy: signedBy.trim(), signMode: 'PAPER', paperScanIndex: n - 1 });
      }
      onSigned();
    } catch (e) {
      setError(extractErrorMessage(e) || tAttr('서명을 기록하지 못했습니다'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-patient-sign-dialog>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900"><T k="환자 서명 받기" /></h3>
        {title && <p className="mt-0.5 text-xs text-gray-500">{title}</p>}

        <label className="mt-4 block text-xs font-medium text-gray-700"><T k="서명한 사람(환자 또는 대리인)" /></label>
        <input
          value={signedBy}
          onChange={(e) => setSignedBy(e.target.value)}
          data-patient-sign-field="signedBy"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />

        <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup">
          {(['PAD', 'PAPER'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              data-patient-sign-mode={m}
              onClick={() => { setMode(m); setError(null); }}
              className={`min-h-[44px] rounded-lg border px-3 py-2 text-sm ${mode === m ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-700'}`}
            >
              {m === 'PAD' ? <T k="서명패드(환자가 직접)" /> : <T k="종이 서명(스캔본 첨부)" />}
            </button>
          ))}
        </div>

        {mode === 'PAD' && (
          <div className="mt-3 rounded-lg border border-gray-300">
            <SignaturePad height={180} onChange={setPadEmpty} ref={pad} />
            <div className="flex justify-end border-t border-gray-200 px-2 py-1">
              <button type="button" onClick={() => pad.current?.clear()} className="text-xs text-gray-500"><T k="지우기" /></button>
            </div>
          </div>
        )}
        {mode === 'PAPER' && (
          <div className="mt-3">
            <p className="text-xs text-gray-600"><T k="환자가 서명한 종이 동의서를 스캔해 올리세요. 올린 스캔본은 서명의 증거로 남아 지울 수 없습니다." /></p>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              data-patient-sign-field="scan"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm"
              aria-label={tAttr('서명된 종이 스캔본')}
            />
          </div>
        )}
        {mode === null && <p className="mt-3 text-xs text-gray-500"><T k="서명 방식을 고르세요" /></p>}

        {error && <p className="mt-3 text-xs text-red-600" data-patient-sign-error>{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm"><T k="취소" /></button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready || busy}
            data-patient-sign-save
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <T k="기록 중…" /> : <T k="서명 기록" />}
          </button>
        </div>
      </div>
    </div>
  );
}
