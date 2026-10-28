'use client';

import { useState, useMemo } from 'react';
import { Unit } from '@/components/ui/display';
import { useAuthStore } from '@/stores/auth-store';
import { useDashboardStore } from '../stores/dashboard-store';
import { getAvailableWidgets, CATEGORY_LABELS, type WidgetDef } from './widget-registry';
import { T, useTAttr } from '@/components/ui/i18n-text';

export default function WidgetCatalog() {
  const tt = useTAttr();
  const { user } = useAuthStore();
  const { layouts, hiddenWidgets, showWidget } = useDashboardStore();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState('');

  const availableWidgets = getAvailableWidgets(user?.role ?? 'DOCTOR', user?.permissions ?? []);
  const placedIds = new Set(layouts.lg?.map((l) => l.i) ?? []);
  const hiddenSet = new Set(hiddenWidgets);

  const filtered = useMemo(() => {
    let list = activeCategory === 'all'
      ? availableWidgets
      : availableWidgets.filter((w) => w.category === activeCategory);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((w) => w.name.toLowerCase().includes(q) || (w.description ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [availableWidgets, activeCategory, search]);

  const categories = ['all', ...new Set(availableWidgets.map((w) => w.category))];

  const handleAdd = (widget: WidgetDef) => {
    showWidget(widget.id, {
      i: widget.id,
      x: 0,
      y: Infinity,
      w: widget.defaultW,
      h: widget.defaultH,
    });
  };

  return (
    <div className="mt-3 bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900">+ <T k="위젯 추가" /> <span className="text-gray-400 font-normal">({availableWidgets.length}<Unit><T k="종" /></Unit>)</span></h3>
        <div className="relative">
          <svg className="absolute left-2.5 top-1.5 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tt('위젯 검색...')}
            className="pl-8 pr-3 py-1 text-[11px] border border-gray-200 rounded-lg w-40 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
        </div>
      </div>

      {/* 카테고리 탭 */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {categories.map((cat) => {
          const count = cat === 'all' ? availableWidgets.length : availableWidgets.filter((w) => w.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${
                activeCategory === cat
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <T k={cat === 'all' ? '전체' : CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat} />
              <span className="ml-1 text-[9px] opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* 위젯 목록 */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {filtered.map((widget) => {
          const isPlaced = placedIds.has(widget.id) && !hiddenSet.has(widget.id);
          return (
            <button
              key={widget.id}
              onClick={() => !isPlaced && handleAdd(widget)}
              disabled={isPlaced}
              className={`flex flex-col items-center gap-0.5 p-2.5 rounded-xl border text-center transition-colors ${
                isPlaced
                  ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                  : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer'
              }`}
            >
              {widget.icon && <span className="text-base">{widget.icon}</span>}
              <span className="text-[11px] font-medium text-gray-900 leading-tight"><T k={widget.name} /></span>
              {widget.description && <span className="text-[9px] text-gray-400 leading-tight line-clamp-1"><T k={widget.description} /></span>}
              <span className="text-[9px] text-gray-300 mt-0.5">
                {isPlaced ? <T k="배치됨" /> : `${widget.defaultW}×${widget.defaultH}`}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full py-6 text-center text-xs text-gray-400">
            {search ? <>&quot;{search}&quot; <T k="검색 결과 없음" /></> : <T k="이 카테고리에 위젯이 없습니다" />}
          </div>
        )}
      </div>
    </div>
  );
}
