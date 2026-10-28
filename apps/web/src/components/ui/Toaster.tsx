'use client';

import { useToastStore, type ToastType } from '@/stores/toast-store';
import { useTAttr } from '@/components/ui/i18n-text';

const CONFIG: Record<ToastType, { bg: string; icon: string; iconPath: string }> = {
  success: {
    bg: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    icon: 'text-emerald-500',
    iconPath: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  error: {
    bg: 'bg-red-50 border-red-200 text-red-800',
    icon: 'text-red-500',
    iconPath: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
  },
  warning: {
    bg: 'bg-amber-50 border-amber-200 text-amber-800',
    icon: 'text-amber-500',
    iconPath: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  },
  info: {
    bg: 'bg-blue-50 border-blue-200 text-blue-800',
    icon: 'text-blue-500',
    iconPath: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z',
  },
};

export function Toaster() {
  const { toasts, removeToast } = useToastStore();
  const tAttr = useTAttr();

  if (!toasts.length) return null;

  return (
    /**
     * 🔴 **전역 피드백 채널에 `aria-live` 가 없었다**(2026-09-02).
     *    `Providers` 의 `MutationCache.onError` 가 **모든 변이 실패**를 이 토스트로만 알리는데,
     *    저장 실패 메시지가 스크린리더에 전혀 전달되지 않았고 눈으로도 4초 안에 놓치면
     *    "저장됐다"고 오인했다. 오류는 assertive, 그 밖은 polite.
     */
    <div
      role="region"
      aria-label={tAttr('알림')}
      aria-live={toasts.some((t) => t.type === 'error' || t.type === 'warning') ? 'assertive' : 'polite'}
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm"
    >
      {toasts.map((t) => {
        const c = CONFIG[t.type];
        return (
          <div
            key={t.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg animate-slide-in ${c.bg}`}
          >
            <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${c.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={c.iconPath} />
            </svg>
            <p className="text-sm font-medium flex-1">{t.message}</p>
            <button onClick={() => removeToast(t.id)} className="flex-shrink-0 opacity-50 hover:opacity-100">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
