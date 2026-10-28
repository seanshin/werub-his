'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 공개 문서 검증 진입 — 발급번호를 받아 `/verify/document/<issueNo>`(공개 EP·PHI 미노출)로 보낸다.
 *
 * 2026-09-02 재작성. 종전 화면(2026-05-20)은 직원 전용 `POST /document-sign/verify`(JWT+역할)를
 * 무인증으로 불러 개통 이래 **항상 401** 이었고, 파일 업로드 검증도 서버에 받는 EP 가 없었다.
 * 화면이 갖지 않은 능력(서명 파일 검증)을 가진 척하지 않는다 — 서버가 공개로 답할 수 있는 것만 묻는다.
 */
export default function VerifyPage() {
  const router = useRouter();
  const [issueNo, setIssueNo] = useState('');
  const trimmed = issueNo.trim();

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    router.push(`/verify/document/${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">H</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">위루비병원</h1>
            <p className="text-xs text-gray-500">발급 문서 진위 검증</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <form onSubmit={go} className="bg-white rounded-2xl shadow-sm border p-8">
          <label htmlFor="issueNo" className="block text-sm font-medium text-gray-700 mb-2">
            발급번호
          </label>
          <p className="text-xs text-gray-500 mb-3">
            문서 하단의 발급번호(예: <span className="font-mono">WRB-CERTIFICATE-20260902-0001</span>)를 입력하거나, 문서의 QR 코드를 스캔하세요.
          </p>
          <div className="flex gap-2">
            <input
              id="issueNo"
              value={issueNo}
              onChange={(e) => setIssueNo(e.target.value)}
              placeholder="WRB-…"
              autoComplete="off"
              className="flex-1 border rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!trimmed}
              className="px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-40 min-h-[44px]"
            >
              검증
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-6">
            ※ 본 검증은 발급 사실·유효 여부만 확인하며, 진료정보는 표시하지 않습니다. 전자서명 원본 파일의 서명 검증은
            원내 인증 사용자 화면에서만 제공됩니다.
          </p>
        </form>
      </main>
    </div>
  );
}
