'use client';

import { useState } from 'react';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 호스피스 종결(퇴원·사망) — 🔴 (2026-10-10) 종전 '퇴원' 버튼 한 번이 그 순간을 퇴원 시각으로 박았고, 사망 처리는 화면이 없었다.
 *    구분·시각을 고르기 전엔 저장하지 않는다(미선택 시작) · 사망은 되돌릴 수 없어 확인을 한 번 더 받는다.
 */
export function HospiceEndForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: { status: 'DISCHARGED' | 'DECEASED'; occurredAt: string }) => void }) {
  const tAttr = useTAttr();
  const [kind, setKind] = useState<'' | 'DISCHARGED' | 'DECEASED'>('');
  const [at, setAt] = useState('');
  const [armed, setArmed] = useState(false);
  const ready = !!kind && !!at;
  return (
    <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-xs" data-hospice-end-form>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1"><T k="종결 구분" />
          <select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setArmed(false); }} className="rounded-lg border px-2 py-1.5" data-hospice-end-kind>
            <option value="">{tAttr('— 선택 —')}</option>
            <option value="DISCHARGED">{tAttr('퇴원')}</option>
            <option value="DECEASED">{tAttr('사망')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">{kind === 'DECEASED' ? <T k="사망 시각" /> : <T k="퇴원 시각" />}
          <input type="datetime-local" value={at} onChange={(e) => { setAt(e.target.value); setArmed(false); }} className="rounded-lg border px-2 py-1.5" data-hospice-end-at />
        </label>
      </div>
      <button type="button" disabled={!ready || busy} data-hospice-end-submit data-armed={armed ? 'yes' : 'no'}
        onClick={() => {
          if (kind === 'DECEASED' && !armed) { setArmed(true); return; }
          onSubmit({ status: kind as 'DISCHARGED' | 'DECEASED', occurredAt: new Date(at).toISOString() });
        }}
        className={`min-h-[44px] w-full rounded-lg px-3 font-semibold text-white disabled:opacity-40 ${kind === 'DECEASED' ? 'bg-gray-800' : 'bg-gray-600'}`}>
        {armed ? <T k="한 번 더 누르면 확정(되돌릴 수 없음)" /> : <T k="종결 기록" />}
      </button>
    </div>
  );
}
