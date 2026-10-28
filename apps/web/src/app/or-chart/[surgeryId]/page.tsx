'use client';

/**
 * 수술방 차트(2026-10-05) — 마취과·집도·소독/순회 간호가 수술방 안에서 쓰는 차트.
 *
 * 🔴 배치는 **사람 × 기기 구성(태블릿·모니터 n대) × 수술방 역할**마다 저장한다(서버 `or_chart_layouts`).
 *    모니터 n대 = 창 n개 — 창마다 `?screen=` 으로 몇 번째 화면인지 고른다(기기 구성·화면 번호는 이 브라우저에 기억).
 * 🔴 기록은 append-only 원장(`intraop_events`) — 고치지 않고 무효(사유)+다시 기록. 단계 시각은 정본 칸(수술·마취 기록)에 쓴다.
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  OR_DEVICE_LABEL, OR_DEVICE_PROFILES, OR_PANELS, OR_PANEL_LABEL, OR_ROLES, OR_ROLE_LABEL, OR_SCREEN_COUNT,
  type OrDeviceProfile, type OrLayout, type OrPanel, type OrRole,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { renderPanel } from './panels';
import type { LayoutResp, OrChart } from './chart-types';

const LS_PROFILE = 'orChart.deviceProfile';
const lsGet = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* 저장 못 해도 화면은 그린다 */ } };

const GRID: Record<1 | 2 | 3, string> = { 1: 'grid-cols-1', 2: 'grid-cols-1 lg:grid-cols-2', 3: 'grid-cols-1 lg:grid-cols-3' };

function OrChartInner() {
  const { surgeryId } = useParams<{ surgeryId: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { user, isAuthenticated, loadProfile } = useAuthStore();
  const [ready, setReady] = useState(false);
  // 서버 @Roles(DOCTOR·NURSE·ADMIN) 와 같은 판정 — 권한 밖이면 부르지 않는다(상시 403 을 장애처럼 그리지 않게)
  const canUse = useHasRole('DOCTOR', 'NURSE');

  useEffect(() => {
    (async () => {
      if (!isAuthenticated) { router.replace('/login'); return; }
      if (!user) { try { await loadProfile(); } catch { router.replace('/login'); return; } }
      setReady(true);
    })();
  }, [isAuthenticated, user, loadProfile, router]);

  const [profile, setProfile] = useState<OrDeviceProfile>('TABLET');
  useEffect(() => {
    const p = lsGet(LS_PROFILE);
    if (p && (OR_DEVICE_PROFILES as readonly string[]).includes(p)) setProfile(p as OrDeviceProfile);
  }, []);
  const screenCount = OR_SCREEN_COUNT[profile];
  const screenParam = Number(sp.get('screen') ?? '1');
  const screen = Number.isInteger(screenParam) && screenParam >= 1 && screenParam <= screenCount ? screenParam : 1;

  const chartKey = ['or-chart', surgeryId];
  const chart = useQuery({
    queryKey: chartKey,
    queryFn: () => apiClient.get<{ data: OrChart }>(`/api/v1/surgery/${surgeryId}/intraop`).then((r) => r.data),
    enabled: ready && canUse,
    refetchInterval: pollMs('fast'),
  });

  const [roleChoice, setRoleChoice] = useState<OrRole | null>(null);
  const role: OrRole = roleChoice ?? chart.data?.suggestedRole ?? 'OBSERVER';

  const layoutKey = ['or-chart-layout', profile, role];
  const layoutQ = useQuery({
    queryKey: layoutKey,
    queryFn: () => apiClient.get<{ data: LayoutResp }>(`/api/v1/or-chart/layouts?profile=${profile}&role=${role}`).then((r) => r.data),
    enabled: ready && canUse && !!chart.data,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OrLayout | null>(null);
  useEffect(() => { setDraft(null); setEditing(false); }, [profile, role]);
  const layout = draft ?? layoutQ.data?.layout ?? null;

  const save = useMutation({
    mutationFn: (l: OrLayout) => apiClient.put('/api/v1/or-chart/layouts', { profile, role, layout: l }),
    onSuccess: () => { toast.success(tAttr('배치를 저장했습니다.')); setEditing(false); setDraft(null); qc.invalidateQueries({ queryKey: layoutKey }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('배치를 저장하지 못했습니다.')),
  });
  const reset = useMutation({
    mutationFn: () => apiClient.del(`/api/v1/or-chart/layouts?profile=${profile}&role=${role}`),
    onSuccess: () => { toast.success(tAttr('기본 배치로 되돌렸습니다.')); setEditing(false); setDraft(null); qc.invalidateQueries({ queryKey: layoutKey }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('되돌리지 못했습니다.')),
  });

  const openScreen = (n: number) => {
    window.open(`/or-chart/${surgeryId}?screen=${n}`, `or-chart-${surgeryId}-${n}`, 'noopener');
  };

  if (!ready) return <div className="p-6"><div className="h-40 animate-pulse rounded-2xl bg-gray-200" /></div>;
  if (!canUse) {
    return <p className="m-6 rounded-xl bg-white p-6 text-sm text-gray-600" data-or-forbidden><T k="수술방 차트는 의사·간호사가 씁니다 — 이 계정의 역할로는 열 수 없습니다." /></p>;
  }
  if (chart.isError) return <div className="p-6"><QueryErrorFallback error={chart.error} onRetry={() => chart.refetch()} /></div>;
  const c = chart.data;
  if (!c) return <div className="p-6"><div className="h-40 animate-pulse rounded-2xl bg-gray-200" /></div>;

  const cur = layout?.screens[screen - 1] ?? null;
  // 모든 화면에 없는 패널 — 역할 기본 배치가 빼 둔 기능을 "없는 기능"으로 읽지 않게 말한다
  const placed = new Set(layout?.screens.flatMap((x) => x.panels) ?? []);
  const missing = layout ? OR_PANELS.filter((p) => !placed.has(p)) : [];

  return (
    <div className="mx-auto max-w-[1920px] space-y-3 p-3" data-or-chart>
      {/* 도구 줄 — 기기 구성·화면·역할·배치 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs shadow-sm">
        <button type="button" onClick={() => router.push('/surgery')} className="rounded-lg px-2 py-1.5 text-gray-600 hover:bg-gray-100">← <T k="수술 관리" /></button>
        <label className="flex items-center gap-1"><T k="기기" />
          <select value={profile} onChange={(e) => { const p = e.target.value as OrDeviceProfile; setProfile(p); lsSet(LS_PROFILE, p); }}
            className="rounded-lg border border-gray-200 px-2 py-1.5" aria-label={tAttr('기기 구성')}>
            {OR_DEVICE_PROFILES.map((p) => <option key={p} value={p}>{tAttr(OR_DEVICE_LABEL[p])}</option>)}
          </select>
        </label>
        {screenCount > 1 && (
          <span className="flex items-center gap-1" data-or-screens>
            <Tf k="화면 {번호}/{전체}" params={{ 번호: screen, 전체: screenCount }} />
            {Array.from({ length: screenCount }, (_, i) => i + 1).filter((n) => n !== screen).map((n) => (
              <button key={n} type="button" onClick={() => openScreen(n)} className="rounded-lg border border-gray-200 px-2 py-1 hover:bg-gray-50">
                <Tf k="{번호}번 화면 새 창" params={{ 번호: n }} />
              </button>
            ))}
          </span>
        )}
        <label className="flex items-center gap-1"><T k="내 역할" />
          <select value={role} onChange={(e) => setRoleChoice(e.target.value as OrRole)} className="rounded-lg border border-gray-200 px-2 py-1.5" aria-label={tAttr('수술방 역할')}>
            {OR_ROLES.map((r) => <option key={r} value={r}>{tAttr(OR_ROLE_LABEL[r])}</option>)}
          </select>
        </label>
        {!roleChoice && (
          <span className="text-[10px] text-gray-400">
            {c.suggestedRole ? <T k="수술 배정에서 고른 역할" /> : <T k="수술 배정에 없는 사람 — 참관으로 시작" />}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {layoutQ.data?.source === 'INVALID_SAVED' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800"><T k="저장된 배치를 읽지 못해 기본 배치로 보입니다" /></span>}
          {layoutQ.data && <span className="text-gray-400">{layoutQ.data.source === 'SAVED' ? <T k="내 배치" /> : <T k="기본 배치" />}</span>}
          {!editing ? (
            <button type="button" onClick={() => { setDraft(layout); setEditing(true); }} disabled={!layout}
              className="rounded-lg bg-gray-900 px-3 py-1.5 font-semibold text-white disabled:opacity-40"><T k="배치 편집" /></button>
          ) : (
            <>
              <button type="button" onClick={() => draft && save.mutate(draft)} disabled={save.isPending} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white"><T k="배치 저장" /></button>
              <button type="button" onClick={() => { setEditing(false); setDraft(null); }} className="rounded-lg px-2 py-1.5 text-gray-600"><T k="취소" /></button>
              {layoutQ.data?.source === 'SAVED' && <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending} className="rounded-lg px-2 py-1.5 text-rose-600"><T k="기본 배치로" /></button>}
            </>
          )}
        </span>
      </div>

      {/* 작성 권한 — 리얼은 수술팀만 · 리허설은 누구나(서버가 같은 판정으로 막는다) */}
      {!c.writePolicy.canWrite ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-or-write="readonly">
          <T k="운영 모드 — 이 수술의 수술팀 자리가 아니어서 읽기만 할 수 있습니다." /> <T k="순회 간호라면 머리의 '순회 간호 맡기'로 수술팀에 듭니다." />
        </p>
      ) : !c.writePolicy.teamOnly && !c.writePolicy.onTeam ? (
        <p className="rounded-xl bg-white px-3 py-1.5 text-[11px] text-gray-500" data-or-write="rehearsal-open">
          <T k="리허설 — 수술팀이 아니어도 기록할 수 있습니다(실제 운영에서는 수술팀만)." />
        </p>
      ) : null}
      {editing && draft && <LayoutEditor layout={draft} onChange={setDraft} />}
      {!editing && missing.length > 0 && (
        <p className="rounded-xl bg-white px-3 py-1.5 text-[11px] text-gray-500" data-or-missing>
          <T k="이 배치에 없는 패널" />: {missing.map((p, i) => <span key={p}>{i > 0 && ' · '}<T k={OR_PANEL_LABEL[p]} /></span>)}
          {' — '}<T k="'배치 편집'에서 추가하거나 '내 역할'을 바꾸면 보입니다." />
        </p>
      )}

      {layoutQ.isError && <QueryErrorFallback error={layoutQ.error} onRetry={() => layoutQ.refetch()} size="compact" />}
      {!cur ? (
        layoutQ.isError ? null : <div className="h-40 animate-pulse rounded-2xl bg-gray-200" />
      ) : (
        <div className="space-y-3">
          {cur.panels.includes('header') && renderPanel('header', c, chartKey)}
          {/* 열마다 따로 쌓는다 — 한 줄 격자는 키 큰 패널 옆에 빈 칸을 남긴다(순서는 열을 번갈아) */}
          <div className={`grid items-start gap-3 ${GRID[cur.columns]}`} data-or-screen={screen}>
            {Array.from({ length: cur.columns }, (_, col) => (
              <div key={col} className="flex min-w-0 flex-col gap-3">
                {cur.panels.filter((p) => p !== 'header').filter((_, i) => i % cur.columns === col).map((p) => <div key={p} className="min-w-0">{renderPanel(p, c, chartKey)}</div>)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 배치 편집 — 화면마다 패널을 고르고 순서·열 수를 정한다(저장은 서버가 정규화) */
function LayoutEditor({ layout, onChange }: { layout: OrLayout; onChange: (l: OrLayout) => void }) {
  const tAttr = useTAttr();
  const set = (i: number, panels: OrPanel[], columns = layout.screens[i].columns) =>
    onChange({ screens: layout.screens.map((s, j) => (j === i ? { panels, columns } : s)) });
  const used = useMemo(() => new Set(layout.screens.flatMap((s) => s.panels)), [layout]);
  return (
    <div className="grid gap-3 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 p-3 md:grid-cols-2 xl:grid-cols-4" data-or-layout-editor>
      {layout.screens.map((s, i) => (
        <div key={i} className="rounded-xl bg-white p-3 text-xs shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold"><Tf k="화면 {번호}" params={{ 번호: i + 1 }} /></p>
            <label className="flex items-center gap-1"><T k="열" />
              <select value={s.columns} onChange={(e) => set(i, s.panels, Number(e.target.value) as 1 | 2 | 3)} className="rounded border border-gray-200 px-1 py-0.5">
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <ol className="space-y-1">
            {s.panels.map((p, k) => (
              <li key={p} className="flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1">
                <span className="flex-1"><T k={OR_PANEL_LABEL[p]} /></span>
                <button type="button" aria-label={tAttr('위로')} disabled={k === 0} onClick={() => { const a = [...s.panels]; [a[k - 1], a[k]] = [a[k], a[k - 1]]; set(i, a); }} className="px-1 disabled:opacity-30">↑</button>
                <button type="button" aria-label={tAttr('아래로')} disabled={k === s.panels.length - 1} onClick={() => { const a = [...s.panels]; [a[k + 1], a[k]] = [a[k], a[k + 1]]; set(i, a); }} className="px-1 disabled:opacity-30">↓</button>
                <button type="button" aria-label={tAttr('빼기')} disabled={s.panels.length === 1} onClick={() => set(i, s.panels.filter((x) => x !== p))} className="px-1 text-rose-600 disabled:opacity-30">✕</button>
              </li>
            ))}
          </ol>
          <select value="" onChange={(e) => e.target.value && set(i, [...s.panels, e.target.value as OrPanel])} className="mt-2 w-full rounded border border-gray-200 px-1.5 py-1" aria-label={tAttr('패널 추가')}>
            <option value="">{tAttr('+ 패널 추가')}</option>
            {OR_PANELS.filter((p) => !s.panels.includes(p)).map((p) => (
              <option key={p} value={p}>{tAttr(OR_PANEL_LABEL[p])}{used.has(p) ? ` (${tAttr('다른 화면에 있음')})` : ''}</option>
            ))}
          </select>
        </div>
      ))}
      <p className="text-[11px] text-gray-500 md:col-span-2 xl:col-span-4">
        <T k="이 배치는 내 계정 · 지금 고른 기기 구성 · 역할에만 저장됩니다. 화면 하나에 패널이 하나는 있어야 합니다." />
      </p>
    </div>
  );
}

export default function OrChartPage() {
  return <Suspense fallback={null}><OrChartInner /></Suspense>;
}
