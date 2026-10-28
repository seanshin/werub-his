'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE_LABEL } from '@hospital-run/shared';
import { T, Tf } from '@/components/ui/i18n-text';

interface Props {
  children: React.ReactNode;
  admissionId?: string;
}

/**
 * 간호사 전용 가드 — 간호사/관리자만 편집 UI 표시
 * 의사 등 다른 역할은 읽기전용 안내 표시
 */
export function NurseOnlyGuard({ children, admissionId }: Props) {
  const user = useAuthStore(s => s.user);

  if (!user) return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>;

  if (user.role !== 'NURSE' && user.role !== 'ADMIN') {
    return (
      <div className="max-w-lg mx-auto text-center py-16 px-4">
        <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2"><T k="읽기 전용" /></h3>
        {/* 🔴 (2026-09-11 §12-C) 조각 배선이라 어순이 깨졌고, 역할명은 `DOCTOR ? '의사' : 원시 enum` 하드코딩이라
            의사 외 13역할은 **어떤 언어에서도 'PHARMACIST' 같은 코드값**이 떴다 — 역할명 정본 USER_ROLE_LABEL 로 */}
        <p className="text-sm text-gray-500 mb-1"><Tf k="이 페이지는 {대상} 편집 화면입니다." params={{ 대상: <strong><T k="간호사 전용" /></strong> }} /></p>
        <p className="text-xs text-gray-400 mb-6"><Tf k="현재 {역할} 계정으로 로그인되어 있어 열람만 가능합니다." params={{ 역할: <strong><T k={USER_ROLE_LABEL[user.role] ?? user.role} /></strong> }} /></p>
        {admissionId && (
          <Link href={`/inpatient/${admissionId}`} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <T k="입원 상세로 돌아가기" />
          </Link>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
