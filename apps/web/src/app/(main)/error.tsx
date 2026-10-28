'use client';

import { T, Data } from '@/components/ui/i18n-text';

export default function MainError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2"><T k="오류가 발생했습니다" /></h2>
        {/* 🔴 서버·런타임이 준 message 는 데이터다 — 카탈로그 키로 조회하면 "번역 미등록" 티가 거짓으로 붙는다 */}
        <p className="text-sm text-gray-500 mb-6">{error.message ? <Data>{error.message}</Data> : <T k="페이지를 불러오는 중 문제가 발생했습니다." />}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
            <T k="다시 시도" />
          </button>
          <a href="/dashboard" className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
            <T k="대시보드로" />
          </a>
        </div>
      </div>
    </div>
  );
}
