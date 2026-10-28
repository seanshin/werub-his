'use client';
import { useState } from 'react';
import { ProblemListTab } from '@/app/(main)/patients/[id]/components/ProblemListTab';
import { AllergyTab } from '@/app/(main)/patients/[id]/components/AllergyTab';
import { AdmissionHistoryTab } from '@/app/(main)/patients/[id]/components/AdmissionHistoryTab';
import { SurgeryHistoryTab } from '@/app/(main)/patients/[id]/components/SurgeryHistoryTab';
import { ImagingTab } from '@/app/(main)/patients/[id]/components/ImagingTab';

const ITEMS = [
  { key: 'problems', label: '문제목록', icon: '📋' },
  { key: 'allergy', label: '알레르기', icon: '🛡️' },
  { key: 'admission', label: '입퇴원', icon: '🛏️' },
  { key: 'surgery', label: '수술이력', icon: '🔪' },
  { key: 'imaging', label: '영상', icon: '🩻' },
] as const;

/** 더보기 바텀시트 — 보조 차트 뷰(축약 IA 보완·전체 접근 보장). */
export default function MoreSheet({ patientId, patientMrn, onClose }: { patientId: string; patientMrn?: string; onClose: () => void }) {
  const [view, setView] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="닫기" />
      <div className="relative bg-gray-50 rounded-t-3xl max-h-[88vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            {view && (
              <button onClick={() => setView(null)} className="min-h-[40px] min-w-[40px] rounded-xl text-gray-600 text-xl" aria-label="목록">‹</button>
            )}
            <h3 className="text-lg font-bold text-gray-900">{view ? ITEMS.find((i) => i.key === view)?.label : '더보기'}</h3>
          </div>
          <button onClick={onClose} className="min-h-[44px] px-4 rounded-xl text-gray-600 border border-gray-200">닫기</button>
        </div>

        <div className="overflow-auto p-3">
          {!view ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ITEMS.map((it) => (
                <button key={it.key} onClick={() => setView(it.key)}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 min-h-[88px] flex flex-col items-start gap-2 active:bg-gray-50">
                  <span className="text-2xl">{it.icon}</span>
                  <span className="text-base font-semibold text-gray-800">{it.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div>
              {view === 'problems' && <ProblemListTab patientId={patientId} />}
              {view === 'allergy' && <AllergyTab patientId={patientId} />}
              {view === 'admission' && <AdmissionHistoryTab patientId={patientId} />}
              {view === 'surgery' && <SurgeryHistoryTab patientId={patientId} />}
              {view === 'imaging' && (patientMrn ? <ImagingTab patientMrn={patientMrn} /> : <p className="text-gray-400 p-4">MRN 없음</p>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
