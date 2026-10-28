'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

export default function SsoPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>}>
      <SsoContent />
    </Suspense>
  );
}

function SsoContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const loadProfile = useAuthStore((s) => s.loadProfile);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    const token = searchParams.get('token');
    const expiresIn = searchParams.get('expiresIn');

    // Case 1: Redirected from HIS backend with accessToken (SSO flow completed)
    if (accessToken) {
      completeAuth(accessToken, expiresIn);
      return;
    }

    // Case 2: Direct SSO with token (verify via API)
    if (token) {
      verifySsoToken(token);
      return;
    }

    // No token provided
    setStatus('error');
    setErrorMessage('SSO 토큰이 제공되지 않았습니다.');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function completeAuth(accessToken: string, expiresIn?: string | null) {
    sessionStorage.setItem('accessToken', accessToken);
    if (expiresIn) {
      sessionStorage.setItem('tokenExpiresIn', String(expiresIn));
    }
    apiClient.setToken(accessToken);
    await loadProfile();
    setStatus('success');
    router.replace('/dashboard');
  }

  async function verifySsoToken(token: string) {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const response = await fetch(`${apiUrl}/api/v1/sso/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `인증 실패 (HTTP ${response.status})`);
      }

      const result = await response.json();
      const { accessToken, expiresIn } = result.data;

      await completeAuth(accessToken, String(expiresIn));
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'SSO 인증 처리 중 오류가 발생했습니다.',
      );
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <h1 className="text-xl font-semibold text-gray-900">SSO 인증 중...</h1>
          <p className="mt-2 text-gray-500">Clinic에서 HIS로 로그인하고 있습니다.</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="mx-auto max-w-md rounded-lg bg-white p-8 shadow-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">SSO 인증 실패</h1>
          <p className="mt-2 text-gray-500">{errorMessage}</p>
          <div className="mt-6 space-y-3">
            <a
              href={process.env.NEXT_PUBLIC_CLINIC_URL || 'https://clinic.example.org'}
              className="block rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition-colors"
            >
              Clinic으로 돌아가기
            </a>
            <a
              href="/login"
              className="block rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              HIS 직접 로그인
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Success state (brief flash before redirect)
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">인증 완료</h1>
        <p className="mt-2 text-gray-500">대시보드로 이동합니다...</p>
      </div>
    </div>
  );
}
