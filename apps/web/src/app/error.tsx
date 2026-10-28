'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body className="bg-gray-50 flex items-center justify-center min-h-screen">
        <div className="max-w-md text-center p-8">
          <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">시스템 오류</h1>
          <p className="text-sm text-gray-500 mb-6">{error.message || '예기치 않은 오류가 발생했습니다.'}</p>
          <button onClick={reset} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700">
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
