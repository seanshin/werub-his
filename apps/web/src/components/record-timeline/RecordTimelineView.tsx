'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Card, PERIODS, Segmented, TRACK_UI, openDetailWindow, type Resp, type TItem, type TrackType } from './record-card';
import { chipState, showChipCount } from './track-chip';
import { InsightView } from './InsightView';
import { AnalyticsView } from './AnalyticsView';
import { ChartCompareView } from './ChartCompareView';
import { PrescriptionLaneView } from './PrescriptionLaneView';
import { AiSummaryPanel } from './AiSummaryPanel';
import { RecordTimelinePrint, type PrintSubject } from './RecordPrintBody';
import { clampSummaryRatio, parseSummaryRatio, summaryRatioFromPointer, SUMMARY_DEFAULT_RATIO } from './summary-split';

import { EmptyState } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

export interface RecordTimelineViewProps {
  patientId: string;
  /** 입원 단위 시계열(scope=admission) — 지정 시 그 입원 문맥만 */
  admissionId?: string;
  /** 부모(참조 패널)의 남은 높이를 그대로 채운다. 일반 스크롤 페이지에서는 false(72vh 고정) */
  fillParent?: boolean;
  /** 차트 탭 내장 모드 — 인쇄/닫기 버튼과 환자 헤더를 숨기고 높이를 제한 */
  embedded?: boolean;
  /**
   * 인쇄본(2026-10-12) — 새 창이 넘기면 화면 대신 찍을 시계열 인쇄 문서를 함께 그린다(화면 조건 그대로).
   * 내장 모드(차트 탭·진료 서랍)는 넘기지 않는다 — 인쇄 버튼이 없다.
   */
  print?: { scopeLabel: string; subject: PrintSubject | null; period?: string | null };
}

/**
 * 임상 기록 통합 시계열 뷰 — 새 창(record-timeline 라우트)과 환자 차트 '기록 시계열' 탭이 공유.
 * 서버(record-timeline EP)가 트랙 필터·최신순 정렬·상한을 담당하므로 여기선 표현만 한다.
 */
export function RecordTimelineView({ patientId, admissionId, embedded = false, fillParent = false, print }: RecordTimelineViewProps) {
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * 🔴 조회 실패를 빈 목록으로 덮지 않는다(2026-09-02).
   *    종전엔 `.catch(() => setResp({ items: [], … }))` 라 통합 임상기록 11트랙이 **0건**으로 그려졌고,
   *    의료진은 그것을 "이 환자는 과거 기록이 없다"로 읽었다. 소비처 4(환자 차트 탭·진료 작성 서랍·새 창 2).
   */
  const [loadError, setLoadError] = useState<unknown>(null);
  /** 재시도 트리거 — 실패 후 같은 인자로 다시 부를 수 있어야 한다("될 수 없는 행동"을 남기지 않는다) */
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<'merged' | 'split' | 'chart' | 'rx' | 'insight' | 'analytics'>('merged');
  /** 모드 전환 — 차트/처방 시계열은 경과를 보는 축이라 기간을 '전체'로 넓힌다(3개월이면 회차가 안 모임) */
  const switchView = (v: 'merged' | 'split' | 'chart' | 'rx' | 'insight' | 'analytics') => {
    setView(v);
    // 전용 축(차트·처방)과 의미찾기는 경과를 보는 관점 — 3개월로는 변화·추세가 모이지 않는다
    if (v === 'chart' || v === 'rx' || v === 'insight') setMonths(null);
    // 분석은 추이를 보는 축 — 1년 기본(전체는 오래된 기록까지 같은 축에 눌려 보인다)
    if (v === 'analytics') setMonths(12);
  };
  const [selected, setSelected] = useState<TrackType[]>([]);
  const [months, setMonths] = useState<number | null>(3);
  const [limit, setLimit] = useState(300);
  const [extra, setExtra] = useState<TItem[]>([]); // 커서로 이어 받은 다음 페이지들
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // 목록 ↔ 정리 영역 분할(기본 30%) — 마우스로 조절·브라우저에 저장
  const [summaryRatio, setSummaryRatio] = useState(SUMMARY_DEFAULT_RATIO);
  const [splitting, setSplitting] = useState(false);
  const splitBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    setSummaryRatio(parseSummaryRatio(localStorage.getItem('recordTimeline.summaryRatio')));
  }, []);

  useEffect(() => {
    if (!splitting) return;
    const move = (e: PointerEvent) => {
      const box = splitBoxRef.current?.getBoundingClientRect();
      if (!box) return;
      setSummaryRatio(summaryRatioFromPointer(e.clientY, box.top, box.height));
    };
    const up = () => {
      setSplitting(false);
      setSummaryRatio((r) => {
        const v = clampSummaryRatio(r);
        if (typeof localStorage !== 'undefined') localStorage.setItem('recordTimeline.summaryRatio', String(v));
        return v;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.userSelect = prev;
    };
  }, [splitting]);

  const resetSplit = useCallback(() => {
    setSummaryRatio(SUMMARY_DEFAULT_RATIO);
    if (typeof localStorage !== 'undefined') localStorage.setItem('recordTimeline.summaryRatio', String(SUMMARY_DEFAULT_RATIO));
  }, []);

  useEffect(() => {
    if (!patientId) return;
    setLoading(true);
    const qs = new URLSearchParams();
    if (months) qs.set('from', new Date(Date.now() - months * 30 * 86400000).toISOString());
    // 전용 모드는 해당 트랙만 조회(차트 비교=진료, 처방 레인=처방) — 칩 선택보다 우선
    const forced = view === 'chart' ? ['ENCOUNTER'] : view === 'rx' ? ['PRESCRIPTION'] : selected;
    if (forced.length) qs.set('types', forced.join(','));
    qs.set('limit', String(limit));
    if (admissionId) qs.set('admissionId', admissionId);
    apiClient.get<{ data: Resp }>(`/api/v1/patients/${patientId}/record-timeline?${qs.toString()}`)
      .then((t) => { setResp(t.data); setExtra([]); setCursor(t.data.nextCursor ?? null); setLoadError(null); })
      .catch((e) => setLoadError(e ?? new Error('조회 실패')))
      .finally(() => setLoading(false));
  }, [patientId, admissionId, months, selected, limit, view, reload]);


  /** '자료 ↗' — 그 기록만 담은 초점 창(차트 전체 화면 아님). 토큰은 해시로 전달(새 창 인증). */
  const openDetail = (it: TItem) => {
    const token = apiClient.getToken() || (typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : '') || '';
    const url = `/record-detail/${it.type}/${encodeURIComponent(it.id)}?patientId=${patientId}#auth=${encodeURIComponent(token)}`;
    openDetailWindow(url, it.type);
  };

  // 이어받은 페이지는 (유형,id)로 중복 제거 — 서버 커서가 경계를 정확히 잡지만
  // 구형 커서·재시도 경합에서 같은 항목이 두 번 들어오면 화면이 어긋나므로 표시 단계에서 한 번 더 막는다.
  const items = (() => {
    const seen = new Set<string>();
    const out: TItem[] = [];
    for (const i of [...(resp?.items ?? []), ...extra]) {
      const k = `${i.type}:${i.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(i);
    }
    return out;
  })();
  const encItems = items.filter((i) => i.type === 'ENCOUNTER');
  const otherItems = items.filter((i) => i.type !== 'ENCOUNTER');
  const tracks = resp?.tracks ?? [];
  const toggle = (t: TrackType) => setSelected((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  /** 인쇄본 조건 줄 — 화면에 걸린 기간·유형(보기 축은 인쇄본이 통합 목록 하나로 찍는다) */
  const printConditions = [
    `기간 ${PERIODS.find(([, m]) => m === months)?.[0] ?? '전체'}`,
    view === 'chart' ? '유형 진료기록' : view === 'rx' ? '유형 처방'
      : `유형 ${selected.length ? selected.map((t) => TRACK_UI[t]?.short ?? t).join('·') : '전체'}`,
  ].join(' · ');

  return (
    <div className={fillParent ? 'h-full flex flex-col min-h-0' : ''}>
      {print && resp && (
        <RecordTimelinePrint items={items} patientId={patientId} admissionId={admissionId} scopeLabel={print.scopeLabel}
          subject={print.subject} period={print.period} conditions={printConditions}
          truncatedTracks={resp.truncatedTracks} total={resp.hasMore ? resp.total : items.length} />
      )}
      {/* 툴바 — 축(보기)·기간은 세그먼트 한 덩어리로, 유형은 색점 칩으로. 테두리 버튼 나열·구분자('|')를 걷어냈다 */}
      <div className={`shrink-0 ${embedded ? 'mb-3' : 'px-5 py-3 border-b bg-white/60'}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented
            value={view}
            onChange={switchView}
            items={[
              { v: 'merged' as const, label: '통합', title: '모든 기록을 한 시간축에' },
              { v: 'split' as const, label: '분할', title: '진료기록과 나머지를 좌우로' },
              { v: 'chart' as const, label: '차트', title: '회차별 S/O/A/P 세로 비교' },
              { v: 'rx' as const, label: '처방', title: '약품별 레인·기간 막대' },
              { v: 'insight' as const, label: '의미찾기', title: '확인필요·마무리·진단 경과·약물 변화·수치 추세·에피소드로 자동 배치' },
              { v: 'analytics' as const, label: '분석', title: '검사·활력 항목별 추이·변화·범위 안 비율·처방 기간을 같은 시간축에' },
            ]}
          />
          <Segmented
            value={months}
            onChange={setMonths}
            items={PERIODS.map(([label, m]) => ({ v: m, label }))}
          />
          {resp && (
            <span className="ml-auto text-[11px] tabular-nums text-gray-400">
              {resp.total}건{resp.hasMore ? ` 중 ${items.length}건` : ''}
            </span>
          )}
        </div>

        {(view === 'merged' || view === 'split') && tracks.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setSelected([])}
              className={`h-6 rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                selected.length === 0 ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              전체
            </button>
            {tracks.map((t) => {
              const on = selected.includes(t.type);
              const n = resp?.counts?.[t.type.toLowerCase()] ?? 0;
              const ui = TRACK_UI[t.type];
              // 판정은 순수 로직(track-chip)에 — 필터 중 미조회 트랙을 죽이지 않는 규칙이 골든으로 고정됨
              if (chipState(n, on, selected.length > 0) === 'muted') {
                return (
                  <span key={t.type} title={`${ui?.label ?? t.label} — 이 기간에 기록 없음`}
                    className="h-6 cursor-default rounded-full px-2.5 text-[11px] text-gray-300">
                    {ui?.short ?? t.label}
                  </span>
                );
              }
              return (
                <button
                  key={t.type}
                  onClick={() => toggle(t.type)}
                  title={ui?.label ?? t.label}
                  aria-pressed={on}
                  className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                    on ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${ui?.dot ?? 'bg-gray-400'} ${on ? 'opacity-90' : ''}`} />
                  {ui?.short ?? t.label}
                  {showChipCount(n) && <span className={`tabular-nums ${on ? 'text-white/70' : 'text-gray-400'}`}>{n}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {resp && resp.truncatedTracks.length > 0 && (
        <div className={`text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 shrink-0 ${embedded ? 'mb-3' : 'mx-5 my-2'}`}>
          ⚠ 조회 상한 도달로 일부만 표시: {resp.truncatedTracks.map((t) => TRACK_UI[t as TrackType]?.label ?? t).join(', ')} — 기간을 좁혀 조회하세요.
        </div>
      )}

      {/* 내장 모드는 고정 높이 flex — 목록이 남는 높이를 채우고 하단 정리 패널이 빈 공간을 쓴다 */}
      <div ref={splitBoxRef} className={embedded ? `${fillParent ? 'flex-1' : 'h-[72vh]'} flex flex-col min-h-0` : 'p-4'}>
        <div className={embedded ? 'flex-1 min-h-0 overflow-y-auto pr-1' : ''}>
        {loading ? <div className="text-sm text-gray-400 py-6">불러오는 중…</div>
        : loadError ? <QueryErrorFallback error={loadError} onRetry={() => { setLoading(true); setLoadError(null); setReload((n) => n + 1); }} />
        // 분석은 자기 조회로 그린다(목록이 비어도 — 목록은 기간·유형 필터 기준이라 분석의 근거와 다르다)
        : view === 'analytics' ? <AnalyticsView patientId={patientId} months={months} />
        : items.length === 0 ? <EmptyState icon="📝" title="해당 기간 기록이 없습니다." />
        : view === 'insight' ? (
          <InsightView
            patientId={patientId}
            months={months}
            admissionId={admissionId}
            onOpenDetail={(ref) => openDetail({ type: ref.type, id: ref.id } as TItem)}
          />
        ) : view === 'chart' ? (
          <ChartCompareView items={items} onOpenDetail={openDetail} />
        ) : view === 'rx' ? (
          <PrescriptionLaneView items={items} onOpenDetail={openDetail} />
        ) : view === 'merged' ? (
          <div className={embedded ? 'space-y-3' : 'grid grid-cols-[repeat(auto-fit,minmax(460px,1fr))] items-start gap-3'}>
            {items.map((it) => <Card key={`${it.type}-${it.id}`} it={it} onOpenDetail={openDetail} />)}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-4">
            <div>
              <div className="text-sm font-bold text-blue-700 mb-2">진료기록 ({encItems.length})</div>
              <div className="space-y-3">{encItems.map((it) => <Card key={it.id} it={it} onOpenDetail={openDetail} />)}{!encItems.length && <div className="text-xs text-gray-400 py-8 text-center">없음</div>}</div>
            </div>
            <div>
              <div className="text-sm font-bold text-gray-700 mb-2">검사·영상·처방·간호 등 ({otherItems.length})</div>
              <div className="space-y-3">{otherItems.map((it) => <Card key={`${it.type}-${it.id}`} it={it} onOpenDetail={openDetail} />)}{!otherItems.length && <div className="text-xs text-gray-400 py-8 text-center">없음</div>}</div>
            </div>
          </div>
        )}

        {cursor && !loading && view !== 'insight' && view !== 'analytics' && (
          <div className="text-center mt-4">
            <button
              onClick={async () => {
                if (!cursor) return;
                setLoadingMore(true);
                try {
                  // 커서(before) 기반 — 앞 페이지를 다시 읽지 않는다(limit 확대 방식의 재조회 낭비 제거)
                  const qs = new URLSearchParams();
                  if (months) qs.set('from', new Date(Date.now() - months * 30 * 86400000).toISOString());
                  const forced = view === 'chart' ? ['ENCOUNTER'] : view === 'rx' ? ['PRESCRIPTION'] : selected;
                  if (forced.length) qs.set('types', forced.join(','));
                  if (admissionId) qs.set('admissionId', admissionId);
                  qs.set('limit', String(limit));
                  qs.set('before', cursor);
                  const r = await apiClient.get<{ data: Resp }>(`/api/v1/patients/${patientId}/record-timeline?${qs.toString()}`);
                  setExtra((prev) => [...prev, ...r.data.items]);
                  setCursor(r.data.nextCursor ?? null);
                } catch { /* 더보기 실패는 기존 목록 유지 */ }
                finally { setLoadingMore(false); }
              }}
              disabled={loadingMore}
              className="px-4 py-2 text-xs rounded-lg border bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {loadingMore ? '불러오는 중…' : `더 보기 (${items.length}건 표시)`}
            </button>
          </div>
        )}
        </div>

        {/* 분할선 — 위로 끌면 정리 영역이 커진다(더블클릭=기본 30%). 의미찾기는 정리 영역이 없어 숨김 */}
        {embedded && !loading && items.length > 0 && view !== 'insight' && view !== 'analytics' && (
          <div
            onPointerDown={(e) => { e.preventDefault(); setSplitting(true); }}
            onDoubleClick={resetSplit}
            role="separator"
            aria-orientation="horizontal"
            aria-label="정리 영역 높이 조절"
            title="드래그로 높이 조절 · 더블클릭으로 기본(30%)"
            className={`group relative h-2 shrink-0 cursor-row-resize ${splitting ? 'bg-blue-400/40' : 'hover:bg-blue-300/40'}`}
          >
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="w-0.5 h-0.5 rounded-full bg-blue-500" />
              <span className="w-0.5 h-0.5 rounded-full bg-blue-500" />
              <span className="w-0.5 h-0.5 rounded-full bg-blue-500" />
            </span>
          </div>
        )}

        {/* 하단 정리 — 모드별 관점(전체 경과/진료 경과/약물 이력).
            의미찾기는 '확인 필요'로 이슈를 이미 품고 있어 겹치므로 높이를 전부 내준다 */}
        {!loading && items.length > 0 && view !== 'insight' && view !== 'analytics' && (
          <div
            style={embedded ? { height: `${summaryRatio * 100}%` } : undefined}
            className={embedded ? 'shrink-0 min-h-0 flex flex-col' : ''}
          >
            <AiSummaryPanel
              patientId={patientId}
              mode={view === 'chart' ? 'chart' : view === 'rx' ? 'rx' : 'all'}
              months={months}
              types={selected}
              fill={embedded}
            />
          </div>
        )}
      </div>
    </div>
  );
}
