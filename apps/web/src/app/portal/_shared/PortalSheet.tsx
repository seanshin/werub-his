'use client';

import React from 'react';
import { PT, usePortalTAttr } from './PT';

/**
 * 공용 시트 — 모바일 바텀시트 / 데스크톱 센터 다이얼로그 (설계 §6.3)
 * GuardianManager 인라인 패턴을 표준화: 오버레이 클릭 닫기 + 내부 stopPropagation + sticky 헤더(✕)
 * 색은 globals.css가 .portal-dark로 매핑하는 유틸(bg-white·gray 계열)만 사용 — 다크모드 자동 대응
 */
export default function PortalSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const tAttr = usePortalTAttr();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between z-10">
          <p className="text-sm font-bold text-gray-900">{title}</p>
          <button
            onClick={onClose}
            aria-label={tAttr('닫기')}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
