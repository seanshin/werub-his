'use client';

import { useDashboardStore } from '../stores/dashboard-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Props {
  onSave: () => void;
  onReset: () => void;
  isSaving?: boolean;
}

export default function EditToolbar({ onSave, onReset, isSaving }: Props) {
  const tt = useTAttr();
  const { isDirty, undo, undoStack, cancelEditing } = useDashboardStore();

  const handleCancel = () => {
    if (isDirty && !confirm(tt('변경 사항을 버리시겠습니까?'))) return;
    cancelEditing();
  };

  const handleReset = () => {
    if (!confirm(tt('기본 레이아웃으로 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.'))) return;
    onReset();
  };

  return (
    <div className="sticky top-0 z-40 bg-blue-600 text-white rounded-xl px-4 py-2.5 mb-3 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
        </svg>
        <span className="text-sm font-bold"><T k="대시보드 편집 중" /></span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="px-3 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-400 rounded-lg disabled:opacity-40 transition-colors"
        >
          Ctrl+Z <T k="실행 취소" />
        </button>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-400 rounded-lg transition-colors"
        >
          <T k="기본으로 초기화" />
        </button>
        <div className="w-px h-5 bg-blue-400" />
        <button
          onClick={handleCancel}
          className="px-3 py-1.5 text-xs font-medium bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
        >
          <T k="취소" />
        </button>
        <button
          onClick={onSave}
          disabled={isSaving || !isDirty}
          className="px-4 py-1.5 text-xs font-bold bg-white text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          <T k={isSaving ? '저장 중...' : '저장'} />
        </button>
      </div>
    </div>
  );
}
