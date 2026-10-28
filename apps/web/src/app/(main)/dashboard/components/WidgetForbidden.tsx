'use client';

import { useDashboardStore } from '../stores/dashboard-store';
import { T } from '@/components/ui/i18n-text';

export default function WidgetForbidden({ widgetId }: { widgetId: string }) {
  const isEditing = useDashboardStore((s) => s.isEditing);
  const hideWidget = useDashboardStore((s) => s.hideWidget);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-4">
      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mb-2">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p className="text-xs text-gray-500"><T k="이 위젯에 접근 권한이 없습니다" /></p>
      {isEditing && (
        <button
          onClick={() => hideWidget(widgetId)}
          className="mt-2 text-[10px] text-blue-600 hover:text-blue-700"
        >
          <T k="위젯 제거" />
        </button>
      )}
    </div>
  );
}
