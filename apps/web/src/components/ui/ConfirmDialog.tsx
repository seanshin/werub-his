'use client';

import React, { useEffect, useId, useRef } from 'react';

import { T } from '@/components/ui/i18n-text';

/* ── Props ───────────────────────────────────────────────────────────────────── */

export interface ConfirmDialogProps {
  /** 다이얼로그 표시 여부 */
  open: boolean;
  /** 다이얼로그 제목 */
  title: string;
  /** 확인 메시지 */
  message: string;
  /** 확인 버튼 클릭 */
  onConfirm: () => void;
  /** 취소 버튼 클릭 */
  onCancel: () => void;
  /** 스타일 변형 */
  variant?: 'danger' | 'warning' | 'info';
  /** 확인 버튼 텍스트 */
  confirmText?: string;
  /** 취소 버튼 텍스트 */
  cancelText?: string;
}

/* ── Variant styles ──────────────────────────────────────────────────────────── */

const VARIANT_STYLES: Record<string, { button: string }> = {
  danger:  { button: 'bg-red-600 hover:bg-red-700 text-white' },
  warning: { button: 'bg-amber-500 hover:bg-amber-600 text-white' },
  info:    { button: 'bg-blue-600 hover:bg-blue-700 text-white' },
};

/* ── Component ───────────────────────────────────────────────────────────────── */

/**
 * 확인 다이얼로그 정본.
 *
 * 🔴 종전엔 순수 div 라 스크린리더가 다이얼로그인 줄 모르고(role 없음), Esc 로 닫히지 않고,
 *    포커스가 배경에 남아 Tab 이 뒤 화면으로 새어나갔다 — 유일한 소비처가
 *    "되돌릴 수 없음" 확정(암등록)이라 가장 엄격해야 하는 자리였다.
 *  - danger 는 `alertdialog`, 그 외 `dialog` + aria-modal/labelledby/describedby
 *  - 열리면 **취소 버튼**에 포커스(파괴 액션에서 Enter 연타가 확정을 누르지 않게), 닫히면 원래 자리로 복원
 *  - Esc = 취소 · Tab 은 다이얼로그 안에서 순환
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  variant = 'info',
  confirmText = '확인',
  cancelText = '취소',
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !panelRef.current?.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      restoreTo?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  const v = VARIANT_STYLES[variant] ?? VARIANT_STYLES.info;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />

      {/* Dialog */}
      <div
        ref={panelRef}
        role={variant === 'danger' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6"
      >
        {/**
          * 🔴 `title`/`message` 는 문자열 prop 이라 여기서 감싼다(버튼 두 개는 이미 배선돼 있었다).
          *    호출부가 값을 끼워 만든 문장은 카탈로그에 없으므로 **한국어 원문 + 미등록 티**가 뜬다 —
          *    "번역된 척"보다 정직하다(QueryErrorFallback 의 서버 메시지 처리와 같은 규약).
          *    `@` 를 품은 문자열(이메일 등)은 `원문@문맥` 키 규약이 뒤를 잘라내므로 감싸지 않는다.
          */}
        <h3 id={titleId} className="text-lg font-bold text-gray-900 mb-2">
          {title.includes('@') ? title : <T k={title} />}
        </h3>
        <p id={descId} className="text-sm text-gray-600 mb-6 whitespace-pre-line">
          {message.includes('@') ? message : <T k={message} />}
        </p>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <T k={cancelText} />
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${v.button}`}
          >
            <T k={confirmText} />
          </button>
        </div>
      </div>
    </div>
  );
}
