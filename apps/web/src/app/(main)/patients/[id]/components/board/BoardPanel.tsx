'use client';

// BoardPanel — 패널 셸: 독립 스크롤 + 에러 격리 + 접기(수동) + 빈 패널 자동 축소.
// 패널 컴포넌트가 자체 카드·제목을 렌더하므로 제목바 중복을 피함:
//  - 펼침: 패널 자체 카드 + 우상단 접기 버튼(오버레이)
//  - 접힘: registry label로 컴팩트 바(빈 상태면 '기록 없음')
// 빈 감지: 콘텐츠를 항상 마운트한 채 자연 높이를 측정(로딩→로드 전환에도 안전).

import { Component, useState, useRef, useEffect, type ReactNode, type ErrorInfo } from 'react';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

class PanelErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* 격리만 */
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-sm text-gray-400 text-center">
          <T k="이 패널을 표시할 수 없습니다." />
        </div>
      );
    }
    return this.props.children;
  }
}

/** 이 높이(px) 미만이면 '빈 상태'로 간주해 자동 축소 */
const EMPTY_THRESHOLD = 150;

/** 핀 아이콘 — 고정(채움)/해제(윤곽) */
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 4.5l4.5 4.5-4.75 1.5-2.5 5.5L9.5 13.25 4 15l1.75-5.75L11.25 6.75 15 4.5z" />
      <path strokeLinecap="round" d="M9.5 13.25L4.75 18" />
    </svg>
  );
}

export function BoardPanel({ title, children, pinned = false, onTogglePin }: {
  title: string;
  children: ReactNode;
  /** 핀 고정 — 마소너리 배치에서 항상 상단(먼저) 배치. ChartBoard가 정렬·저장 담당 */
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  // null = 사용자 미개입(자동 규칙 적용), true/false = 수동 접기/펼치기
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [manual, setManual] = useState<boolean | null>(null);
  const [autoEmpty, setAutoEmpty] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setAutoEmpty(el.getBoundingClientRect().height < EMPTY_THRESHOLD);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const collapsed = manual ?? autoEmpty;
  const isEmptyCollapsed = collapsed && manual === null && autoEmpty;

  return (
    // group: 핀/접기 오버레이는 패널 hover(또는 키보드 포커스) 시에만 노출 —
    // 패널 자체 헤더 컨트롤(기간 칩·필터 탭)이 같은 우상단에 렌더되어 상시 노출 시 겹침(2026-07-07 리포트)
    <div className={`group relative rounded-2xl ${pinned && !collapsed ? 'ring-1 ring-indigo-200' : ''}`}>
      {collapsed && (
        <button
          type="button"
          onClick={() => setManual(false)}
          aria-expanded={false}
          title={tfAttr('{패널} 펼치기', { 패널: tAttr(title) })}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-white rounded-2xl border border-gray-100 shadow-sm text-left hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-semibold text-gray-500 flex items-center gap-1.5">
            {pinned && <span className="text-indigo-500"><PinIcon filled /></span>}
            <T k={title} />
          </span>
          <span className="flex items-center gap-2 text-xs text-gray-400">
            {isEmptyCollapsed && <span><T k="기록 없음" /></span>}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </button>
      )}

      {!collapsed && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity">
          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              title={tfAttr(pinned ? '{패널} 고정 해제' : '{패널} 상단 고정', { 패널: tAttr(title) })}
              aria-label={tfAttr(pinned ? '{패널} 고정 해제' : '{패널} 상단 고정', { 패널: tAttr(title) })}
              aria-pressed={pinned}
              className={`w-6 h-6 rounded-md bg-white shadow-sm border flex items-center justify-center transition-colors ${
                pinned ? 'border-indigo-200 text-indigo-500 hover:text-indigo-700' : 'border-gray-200 text-gray-400 hover:text-gray-600'
              }`}
            >
              <PinIcon filled={pinned} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setManual(true)}
            title={tfAttr('{패널} 접기', { 패널: tAttr(title) })}
            aria-label={tfAttr('{패널} 접기', { 패널: tAttr(title) })}
            className="w-6 h-6 rounded-md bg-white shadow-sm border border-gray-200 text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </button>
        </div>
      )}

      {/* 콘텐츠는 항상 마운트(로딩·측정 유지). 접힘 시 h-0로 클립하되 내부는 자연 높이 유지 → 측정 정확. */}
      <div className={collapsed ? 'h-0 overflow-hidden' : 'max-h-[calc(100vh-14rem)] overflow-y-auto rounded-2xl'}>
        <div ref={contentRef}>
          <PanelErrorBoundary>{children}</PanelErrorBoundary>
        </div>
      </div>
    </div>
  );
}
