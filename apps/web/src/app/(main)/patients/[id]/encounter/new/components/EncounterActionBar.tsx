'use client';

import { T, Data } from '@/components/ui/i18n-text';

interface EncounterActionBarProps {
  encounterId: string | null;
  onSaveDraft: () => void;
  onSignAndBill: () => void;
  isSaving: boolean;
  isSigning: boolean;
  extraSaving?: boolean;
  statusText?: string;
}

export default function EncounterActionBar({
  encounterId, onSaveDraft, onSignAndBill, isSaving, isSigning, extraSaving, statusText,
}: EncounterActionBarProps) {
  return (
    <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
          {/* 🔴 `statusText` 는 호출부가 만든 문장이 들어온다 — 카탈로그 키가 아니라 데이터다 */}
          {statusText ? <Data>{statusText}</Data> : <T k={encounterId ? '진료 중' : '진료 시작 전'} />}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onSaveDraft}
            disabled={!encounterId || isSaving || extraSaving}
            className="inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
          >
            <T k={isSaving || extraSaving ? '저장중...' : '저장 (임시)'} />
          </button>
          <button
            onClick={onSignAndBill}
            disabled={!encounterId || isSigning}
            className="inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
          >
            <T k={isSigning ? '처리중...' : '서명 완료'} />
          </button>
        </div>
      </div>
    </div>
  );
}
