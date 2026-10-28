'use client';

import { T } from '@/components/ui/i18n-text';

interface LoadingStateProps {
  /** compact: 인라인/테이블 내부, full: 페이지 전체 */
  size?: 'compact' | 'full';
  label?: string;
  className?: string;
}

export function LoadingState({ size = 'full', label = '불러오는 중...', className = '' }: LoadingStateProps) {
  if (size === 'compact') {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 text-xs text-gray-400 ${className}`}>
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span><T k={label} /></span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-16 ${className}`}>
      <svg className="w-8 h-8 text-blue-400 animate-spin mb-3" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p className="text-sm text-gray-400"><T k={label} /></p>
    </div>
  );
}
