'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AllergyTab, ProblemListTab, MedicationTab, LabResultsTab, ImagingTab, NursingRecordTab, VitalsTab } from '../../../components';
import { RecordTimelineView } from '@/components/record-timeline/RecordTimelineView';
import { DRAWER_MIN_PX, drawerMaxWidth, drawerWidthFromPointer } from './chart-drawer-width';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 진료 작성 중 환자 차트(참조) 분할 패널 — 진료 화면에 없는 정보를 옆에서 본다.
// 과거 진료 기록은 진료 화면 하단에 이미 있으므로 제외. 듀얼 모니터용 '새 창' 버튼 제공.
// 큰 화면 모드: 넓은 모니터에서 참조 패널을 2열 멀티패널로 동시 표시(탭 전환 불필요).
// 폭 조절: 왼쪽 경계 드래그(스플리터)로 자유 조절 + 프리셋 순환. 고정(📌)하면 폭·열림·탭이 다음에도 유지.
const TABS = [
  { k: 'timeline', label: '기록 시계열' },
  { k: 'allergy', label: '알레르기' },
  { k: 'problem', label: '문제목록' },
  { k: 'med', label: '투약' },
  { k: 'lab', label: '검사결과' },
  { k: 'vitals', label: '바이탈 추세' },
  { k: 'imaging', label: '영상' },
  { k: 'nursing', label: '간호기록' },
] as const;
type TabKey = (typeof TABS)[number]['k'];

type RefWidth = 'narrow' | 'normal' | 'wide';
const REF_W: Record<RefWidth, string> = { narrow: 'xl:w-[680px]', normal: 'xl:w-[880px]', wide: 'xl:w-[1140px]' }; // 정적 문자열 필수(JIT)
const REF_W_LABEL: Record<RefWidth, string> = { narrow: '좁게', normal: '보통', wide: '넓게' };
const PRESET_PX: Record<RefWidth, number> = { narrow: 680, normal: 880, wide: 1140 };

// 드래그 폭 한계·클램프는 순수 모듈로 분리(chart-drawer-width) — 단독 테스트 가능
const MIN_PX = DRAWER_MIN_PX;
const maxPx = () => (typeof window === 'undefined' ? 1400 : drawerMaxWidth(window.innerWidth));

export const CHART_DRAWER_KEYS = {
  pinned: 'chartDrawer.pinned',   // '1' 이면 진료 화면 진입 시 자동 열림
  widthPx: 'chartDrawer.widthPx', // 드래그로 조절한 폭(px)
  tab: 'chartDrawer.tab',         // 고정 시 마지막 탭 복원
} as const;

/** 고정 여부 — 진료 페이지가 초기 열림 상태를 결정할 때 사용 */
export function isChartDrawerPinned(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(CHART_DRAWER_KEYS.pinned) === '1';
}

export function PatientChartDrawer({
  patientId,
  patientMrn,
  onClose,
  expanded = false,
  onToggleExpand,
  width = 'normal',
  onCycleWidth,
  onWidthChange,
}: {
  patientId: string;
  patientMrn?: string;
  onClose: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  width?: RefWidth;
  onCycleWidth?: () => void;
  /** 현재 패널 폭(px) 통지 — 진료 본문이 같은 폭만큼 비켜서 **동시 표시**되게(덮지 않게) */
  onWidthChange?: (px: number | null) => void;
}) {
  const tAttr = useTAttr();
  const [tab, setTab] = useState<TabKey>('allergy');
  const [pinned, setPinned] = useState(false);
  const [widthPx, setWidthPx] = useState<number | null>(null); // null = 미조절(프리셋/기본 폭 사용)
  const [dragging, setDragging] = useState(false);
  const [narrowScreen, setNarrowScreen] = useState(false); // <640px 는 전체폭 유지(px 폭 미적용)

  // 저장된 고정·폭·탭 복원
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const p = localStorage.getItem(CHART_DRAWER_KEYS.pinned) === '1';
    setPinned(p);
    const w = Number(localStorage.getItem(CHART_DRAWER_KEYS.widthPx));
    if (Number.isFinite(w) && w >= MIN_PX) setWidthPx(Math.min(w, maxPx()));
    if (p) {
      const t = localStorage.getItem(CHART_DRAWER_KEYS.tab) as TabKey | null;
      if (t && TABS.some((x) => x.k === t)) setTab(t);
    }
  }, []);

  // 화면 크기 추적 — 좁은 화면은 px 폭 무시, 창을 줄이면 상한도 재적용
  useEffect(() => {
    const apply = () => {
      setNarrowScreen(window.innerWidth < 640);
      setWidthPx((w) => (w ? Math.min(w, drawerMaxWidth(window.innerWidth)) : w));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  // 진료 헤더의 '기록 시계열' 버튼이 탭을 지정(패널을 열면서 특정 탭으로 진입)
  useEffect(() => {
    const onTab = (e: Event) => {
      const k = (e as CustomEvent).detail as TabKey;
      if (TABS.some((t) => t.k === k)) setTab(k);
    };
    window.addEventListener('chart-drawer:tab', onTab);
    return () => window.removeEventListener('chart-drawer:tab', onTab);
  }, []);

  // 고정 상태일 때만 마지막 탭을 기억(비고정은 매번 초기 탭)
  useEffect(() => {
    if (pinned && typeof localStorage !== 'undefined') localStorage.setItem(CHART_DRAWER_KEYS.tab, tab);
  }, [pinned, tab]);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CHART_DRAWER_KEYS.pinned, next ? '1' : '0');
      if (next) localStorage.setItem(CHART_DRAWER_KEYS.tab, tab);
    }
  };

  // ── 왼쪽 경계 드래그로 폭 조절(스플리터) ──
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      // 패널은 화면 오른쪽에 붙어 있으므로 폭 = 화면폭 - 커서 X
      setWidthPx(drawerWidthFromPointer(e.clientX, window.innerWidth));
    };
    const up = () => {
      setDragging(false);
      setWidthPx((w) => {
        if (w && typeof localStorage !== 'undefined') localStorage.setItem(CHART_DRAWER_KEYS.widthPx, String(Math.round(w)));
        return w;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // 드래그 중 텍스트 선택·아이프레임 캡처 방지
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.userSelect = prev;
    };
  }, [dragging]);

  // 프리셋 순환은 폭(px)도 함께 맞춰줌(드래그와 같은 축으로 동작)
  const cyclePreset = () => {
    onCycleWidth?.();
    const order: RefWidth[] = ['narrow', 'normal', 'wide'];
    const next = order[(order.indexOf(width) + 1) % order.length];
    const px = Math.min(PRESET_PX[next], maxPx());
    setWidthPx(px);
    if (typeof localStorage !== 'undefined') localStorage.setItem(CHART_DRAWER_KEYS.widthPx, String(px));
  };

  const resetWidth = () => {
    setWidthPx(null);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CHART_DRAWER_KEYS.widthPx);
  };

  // 폭: 드래그값이 있으면 그것이 우선(inline style), 없으면 종전 반응형 클래스
  const usePx = !!widthPx && !narrowScreen;
  // 폭이 바뀌면 부모(진료 본문)에 통지. 패널이 닫히면 null 로 되돌려 여백 해제.
  const notifyRef = useRef(onWidthChange); notifyRef.current = onWidthChange;
  useEffect(() => { notifyRef.current?.(usePx ? widthPx : null); }, [usePx, widthPx]);
  useEffect(() => () => { notifyRef.current?.(null); }, []);
  const styleWidth = usePx ? { width: `${widthPx}px`, maxWidth: '100vw' } : undefined;

  return (
    <aside
      style={styleWidth}
      className={`fixed inset-y-0 right-0 z-40 bg-white border-l border-gray-200 shadow-2xl flex flex-col ${usePx ? '' : `w-full sm:w-[440px] ${expanded ? REF_W[width] : ''}`}`}
    >
      {/* 스플리터 — 왼쪽 경계를 드래그해 폭 조절(더블클릭=기본 폭 복귀) */}
      <div
        onPointerDown={onPointerDown}
        onDoubleClick={resetWidth}
        role="separator"
        aria-orientation="vertical"
        aria-label={tAttr("참조 패널 폭 조절")}
        title={tAttr("드래그로 폭 조절 · 더블클릭으로 기본 폭")}
        className={`absolute inset-y-0 -left-1 w-2 cursor-col-resize group z-10 hidden sm:block ${dragging ? 'bg-blue-400/40' : 'hover:bg-blue-300/40'}`}
      >
        {/* 그립 표시 — 마우스를 올리면 보이는 3점 */}
        <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="w-0.5 h-0.5 rounded-full bg-blue-500" />
          <span className="w-0.5 h-0.5 rounded-full bg-blue-500" />
          <span className="w-0.5 h-0.5 rounded-full bg-blue-500" />
        </div>
      </div>

      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-gray-900"><T k="📋 환자 차트" /></span>
          <span className="text-[11px] text-gray-400"><T k="참조" /></span>
          {usePx && <span className="text-[10px] text-gray-300 tabular-nums">{Math.round(widthPx!)}px</span>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={togglePin}
            aria-pressed={pinned}
            title={pinned ? '고정 해제 — 다음 진료에서는 자동으로 열지 않음' : '고정 — 다음 진료에서도 이 폭·탭으로 자동 열림'}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${pinned ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            📌 {pinned ? '고정됨' : '고정'}
          </button>
          {onCycleWidth && (
            <button
              onClick={cyclePreset}
              title={tAttr("참조 폭 프리셋(좁게/보통/넓게) — 경계를 드래그하면 자유 조절")}
              className="hidden xl:inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              ↔ {REF_W_LABEL[width]}
            </button>
          )}
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              aria-pressed={expanded}
              title={expanded ? '일반 화면(단일 탭)' : '큰 화면(멀티패널 참조) — 넓은 모니터 권장'}
              className={`hidden xl:inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${expanded ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75a2.25 2.25 0 012.25-2.25h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
              </svg>
              {expanded ? '일반' : '큰 화면'}
            </button>
          )}
          <button
            onClick={() => window.open(`/patients/${patientId}`, '_blank', 'noopener,noreferrer')}
            title={tAttr("새 창으로 열기")}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <T k="↗ 새 창" />
          </button>
          <button onClick={onClose} title={tAttr("닫기")} className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex items-center justify-center">✕</button>
        </div>
      </header>

      {/* 단일 탭 네비 — 큰 화면(멀티패널)에선 숨김 */}
      {!expanded && (
        // 밑줄 탭 — 8개를 색 채운 알약으로 늘어놓으면 어느 것이 선택인지 되레 흐려진다(선택만 강조)
        <nav className="flex flex-shrink-0 gap-4 overflow-x-auto border-b border-gray-100 px-4" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              role="tab"
              aria-selected={tab === t.k}
              className={`relative whitespace-nowrap py-2.5 text-xs transition-colors ${
                tab === t.k ? 'font-semibold text-blue-700' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
              {tab === t.k && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-blue-600" />}
            </button>
          ))}
        </nav>
      )}

      <div className={`flex-1 min-h-0 p-4 ${tab === 'timeline' && !expanded ? 'overflow-hidden' : 'overflow-y-auto'} ${dragging ? 'pointer-events-none select-none' : ''}`}>
        {expanded ? (
          // 큰 화면 — 핵심 참조 패널 2열 동시 표시(자연 높이·items-start)
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            <VitalsTab patientId={patientId} />
            <LabResultsTab patientId={patientId} />
            <MedicationTab patientId={patientId} />
            <AllergyTab patientId={patientId} />
            <div className="xl:col-span-2">
              <ProblemListTab patientId={patientId} />
            </div>
          </div>
        ) : (
          <>
            {tab === 'timeline' && <RecordTimelineView patientId={patientId} embedded fillParent />}
            {tab === 'allergy' && <AllergyTab patientId={patientId} />}
            {tab === 'problem' && <ProblemListTab patientId={patientId} />}
            {tab === 'med' && <MedicationTab patientId={patientId} />}
            {tab === 'lab' && <LabResultsTab patientId={patientId} />}
            {tab === 'vitals' && <VitalsTab patientId={patientId} />}
            {tab === 'imaging' && (patientMrn ? <ImagingTab patientMrn={patientMrn} /> : <p className="text-xs text-gray-400"><T k="MRN 정보가 없어 영상을 불러올 수 없습니다." /></p>)}
            {tab === 'nursing' && <NursingRecordTab patientId={patientId} />}
          </>
        )}
      </div>
    </aside>
  );
}
