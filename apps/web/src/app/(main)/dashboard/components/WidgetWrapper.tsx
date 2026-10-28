'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BarChart3, BedDouble, FlaskConical, LayoutGrid, ShieldCheck, Siren, Stethoscope, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { WidgetCategory, WidgetDef } from './widget-registry';
import { useDashboardStore } from '../stores/dashboard-store';
import Link from 'next/link';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useAuthStore } from '@/stores/auth-store';
import { canSeeCommandCenter, canSeeExecutive } from '@/app/(main)/command-center/journey-access';

interface Props {
  id: string;
  definition: WidgetDef;
  isEditing: boolean;
  children: React.ReactNode;
}

/** 위젯별 에러 경계 — crash 시 다른 위젯에 영향 안 줌 */
class WidgetErrorBoundary extends Component<
  { widgetName: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Widget Error] ${this.props.widgetName}:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center py-4">
          <p className="text-xs text-gray-400"><T k="위젯 로드 실패" /></p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-1 text-[10px] text-blue-600 hover:text-blue-700"
          >
            <T k="재시도" />
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 범주 표식 — 머리의 작은 아이콘 칩(2026-09-29 대시보드 정돈).
 * 색은 **범주를 알아보는 데만** 쓴다(값의 급함은 위젯 본문이 amber·rose 로 말한다 — 섞지 않는다).
 */
const CATEGORY_MARK: Record<WidgetCategory, { Icon: LucideIcon; chip: string }> = {
  patient:   { Icon: Users,        chip: 'bg-blue-50 text-blue-600' },
  clinical:  { Icon: Stethoscope,  chip: 'bg-indigo-50 text-indigo-600' },
  emergency: { Icon: Siren,        chip: 'bg-rose-50 text-rose-600' },
  orders:    { Icon: FlaskConical, chip: 'bg-teal-50 text-teal-600' },
  admin:     { Icon: Wallet,       chip: 'bg-amber-50 text-amber-600' },
  bed:       { Icon: BedDouble,    chip: 'bg-violet-50 text-violet-600' },
  quality:   { Icon: ShieldCheck,  chip: 'bg-emerald-50 text-emerald-600' },
  chart:     { Icon: BarChart3,    chip: 'bg-sky-50 text-sky-600' },
  system:    { Icon: LayoutGrid,   chip: 'bg-slate-100 text-slate-600' },
};

export default function WidgetWrapper({ id, definition, isEditing, children }: Props) {
  const tt = useTAttr();
  const { hideWidget } = useDashboardStore();
  const role = useAuthStore((st) => st.user?.role);

  // stat-bar는 프레임 없이 렌더링
  if (id === 'stat-bar') {
    return <div className="h-full">{children}</div>;
  }

  const mark = CATEGORY_MARK[definition.category] ?? CATEGORY_MARK.system;
  const Icon = mark.Icon;

  return (
    <section
      aria-label={tt(definition.name)}
      data-widget={id}
      className={`group/widget h-full flex flex-col overflow-hidden rounded-2xl border transition-[border-color,box-shadow]
      ${isEditing
        ? 'border-blue-300 border-dashed bg-white shadow-md shadow-blue-100'
        : 'border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300/80 hover:shadow-[0_4px_14px_-6px_rgba(15,23,42,0.12)]'}`}>

      {/* 헤더 — 범주 칩 + 제목 한 줄(위젯 본문은 제목을 다시 쓰지 않는다) */}
      <header className={`flex items-center justify-between gap-2 px-4 pt-3 pb-2 flex-shrink-0
        ${isEditing ? 'widget-drag-handle cursor-grab active:cursor-grabbing bg-blue-50/80 pb-3' : ''}`}>
        <div className="flex min-w-0 items-center gap-2">
          {isEditing ? (
            <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <circle cx="4" cy="4" r="1.5" /><circle cx="4" cy="8" r="1.5" /><circle cx="4" cy="12" r="1.5" />
              <circle cx="10" cy="4" r="1.5" /><circle cx="10" cy="8" r="1.5" /><circle cx="10" cy="12" r="1.5" />
            </svg>
          ) : (
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${mark.chip}`} aria-hidden>
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          )}
          <h3 className="truncate text-[13px] font-semibold tracking-tight text-slate-700"><T k={definition.name} /></h3>
        </div>
        {/* 🔴 내 일이 아닌 범위를 말한다 — 병원 전체 현황은 상황판, 추이·경영은 경영 화면이 정본(그 화면을 못 여는 역할에겐 링크 없이 표식만) */}
        {!isEditing && definition.scope === 'HOSPITAL' && (
          canSeeCommandCenter(role)
            ? <Link href="/command-center" data-widget-scope="HOSPITAL" className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"><T k="병원 전체 · 상황판에서 보기" /></Link>
            : <span data-widget-scope="HOSPITAL" className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500"><T k="병원 전체" /></span>
        )}
        {!isEditing && definition.scope === 'ANALYTICS' && (
          canSeeExecutive(role)
            ? <Link href="/executive" data-widget-scope="ANALYTICS" className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"><T k="추이·경영 · 경영 화면에서 보기" /></Link>
            : <span data-widget-scope="ANALYTICS" className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500"><T k="추이·경영" /></span>
        )}
        {isEditing && (
          <button
            onClick={(e) => { e.stopPropagation(); hideWidget(id); }}
            className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
            aria-label={`${tt(definition.name)} ${tt('위젯 숨기기')}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </header>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-auto px-4 pb-4 pt-1">
        <WidgetErrorBoundary widgetName={definition.name}>
          {children}
        </WidgetErrorBoundary>
      </div>
    </section>
  );
}
