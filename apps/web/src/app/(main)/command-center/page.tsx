'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BedDouble, ChevronRight, ClipboardList, FlaskConical, HeartPulse, Hourglass,
  Maximize2, Minimize2, Pill, Radio, ReceiptText, ShieldCheck, Siren, Stethoscope, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { FreshnessBadge } from '@/components/dashboard/FreshnessBadge';
import { pollMs } from '@/lib/ui-settings';
import {
  boardView, boardNote, criticalActions, ktasChips, fmtInt, fmtMoney, boardStatus, sortByStatus, alertComposition,
  numericSnapshot, numericDelta, wallMaskName, BOARD_STATUS_LABEL, type ActionItem, type BoardStatus,
} from './command-center-view';
import { UnitText, Unit, Ratio } from '@/components/ui/display';
import { DeptName } from '@/lib/master-display-name';
import { stageFlow, delayedPatients, delayedCount, type JourneyRow } from './journey-view';
import { canSeeJourneyBoard } from './journey-access';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { ratioText } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { Building3DSection } from './Building3DSection';
import { SpaceLoadMini } from './SpaceLoadMini';
import { KpiSparkline } from './KpiSparkline';
import { useWide } from './use-wide';
import type { TrendResponse, TrendSource } from './trend-view';

// 집계 EP(1요청) 기반 — 섹션별 부분 실패 허용 + 상단 통합 KPI + SSE 즉시 갱신 힌트(위급값·EWS)
type Section = { ok: boolean; summary?: Record<string, unknown>; error?: string };
type Summary = {
  sections: Record<string, Section>;
  // 🔴 실패 섹션은 0 이 아니라 null 로 온다(서버 buildKpi) — '0명'과 '조회 실패'는 다른 사실이다
  kpi: { census: number | null; erActive: number | null; criticalPending: number | null; occupancyRate: number | null; occupancyNumerator?: number | null; occupancyDenominator?: number | null; bedAlert: number; alertsTotal: number; alertsUnavailable?: string[] };
  generatedAt: string;
};

type BoardDef = { key: string; title: string; href: string; icon: LucideIcon };

/**
 * 🔴 (2026-10-02) 부서마다 띠 색(무지개)을 두던 것을 거둔다 — 빨간 윗선이 "위험"인지 "응급실 색"인지 읽히지 않았다.
 *    카드의 색은 **상태**(위험·조회 실패·주의·기준 초과 없음·데이터 없음)만 말하고, 부서는 아이콘이 말한다.
 */
const BOARDS: BoardDef[] = [
  { key: 'nursing', title: '간호 스테이션', href: '/nursing-station', icon: Stethoscope },
  { key: 'emergency', title: '응급실(KTAS)', href: '/emergency-board', icon: Siren },
  { key: 'bed', title: '병상·입원', href: '/bed-board', icon: BedDouble },
  { key: 'pharmacy', title: '약국', href: '/pharmacy-board', icon: Pill },
  { key: 'receptionBilling', title: '원무·수납', href: '/reception-billing-board', icon: ReceiptText },
  { key: 'diagnostics', title: '검사·영상 위험값', href: '/diagnostics-board', icon: FlaskConical },
  { key: 'safetyQuality', title: '감염·질안전', href: '/safety-quality-board', icon: ShieldCheck },
];

/** SSE 즉시 갱신 힌트 — 위급값·EWS 발생 시 summary 재조회 (30초 폴링은 백업으로 유지) */
function useRefreshHints(onHint: () => void) {
  const onHintRef = useRef(onHint);
  onHintRef.current = onHint;
  useEffect(() => {
    const abort = new AbortController();
    let stopped = false;
    (async function connect() {
      while (!stopped) {
        try {
          const token = apiClient.getToken();
          if (!token) return;
          const res = await fetch('/api/v1/command-center/stream', {
            headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            signal: abort.signal,
          });
          if (!res.ok || !res.body) throw new Error('stream unavailable');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() ?? '';
            for (const part of parts) {
              const line = part.split('\n').find((l) => l.startsWith('data:'));
              if (!line) continue;
              try {
                const msg = JSON.parse(line.slice(5));
                if (msg.type === 'refresh') onHintRef.current();
              } catch { /* heartbeat 등 무시 */ }
            }
          }
        } catch { /* 재연결 */ }
        if (!stopped) await new Promise((r) => setTimeout(r, 5000));
      }
    })();
    return () => { stopped = true; abort.abort(); };
  }, []);
}

const TONE_TEXT: Record<string, string> = { normal: 'text-gray-800', warn: 'text-amber-600', danger: 'text-rose-600' };
// 지표 칸 — 톤(값에서 온 것)이 바탕·점을 정한다 · 흐린(0·없음) 칸은 끝까지 흐리게
const FIELD_TILE: Record<string, string> = { normal: 'bg-slate-50/80', warn: 'bg-amber-50 ring-1 ring-amber-100', danger: 'bg-rose-50 ring-1 ring-rose-100' };
const FIELD_DOT: Record<string, string> = { normal: 'bg-slate-300', warn: 'bg-amber-400', danger: 'bg-rose-500' };
// KTAS 1(소생)~5(비응급) — 중증도 색. 0명 칸은 회색(색으로 있는 척하지 않는다)
const KTAS_TONE: Record<number, string> = {
  1: 'bg-rose-600 text-white', 2: 'bg-orange-500 text-white', 3: 'bg-amber-400 text-amber-950', 4: 'bg-emerald-500 text-white', 5: 'bg-sky-500 text-white',
};

/** 상태 → 윗선·테두리·배지 (색이 말하는 것은 이것뿐) */
const STATUS_STYLE: Record<BoardStatus, { bar: string; border: string; badge: string }> = {
  DANGER: { bar: 'bg-rose-500', border: 'border-rose-200', badge: 'bg-rose-600 text-white' },
  FAILED: { bar: 'bg-[repeating-linear-gradient(45deg,#f59e0b_0_6px,#fde68a_6px_12px)]', border: 'border-amber-300 border-dashed', badge: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' },
  WARN: { bar: 'bg-amber-400', border: 'border-amber-200', badge: 'bg-amber-400 text-amber-950' },
  CLEAR: { bar: 'bg-slate-200', border: 'border-slate-200/80', badge: 'bg-slate-100 text-slate-500' },
  NO_DATA: { bar: 'bg-slate-100', border: 'border-slate-200/60 border-dashed', badge: 'bg-slate-50 text-slate-400' },
};

/**
 * 직전 갱신 대비 변화 — ▲/▼ 와 크기만. 🔴 늘어난 것이 좋은지 나쁜지는 지표마다 달라 **색으로 판정하지 않는다**.
 * 기준은 이 화면이 받은 직전 응답(서버 이력 아님) — title 이 그렇게 말한다.
 */
function DeltaMark({ d }: { d?: number }) {
  const tAttr = useTAttr();
  if (!d) return null;
  return (
    <span data-delta={d} title={tAttr('직전 갱신 대비 변화')}
      className="ml-1 inline-flex items-center rounded bg-indigo-50 px-1 text-[10px] font-semibold tabular-nums text-indigo-600 ring-1 ring-indigo-100">
      {d > 0 ? '▲' : '▼'}{fmtInt(Math.abs(d))}
    </span>
  );
}

function MutedFieldsLine({ labels }: { labels: string[] }) {
  const tAttr = useTAttr();
  const names = labels.map((l) => tAttr(l)).join(' · ');
  return (
    <p className="mt-1.5 truncate text-[10.5px] text-slate-400" title={names} data-muted-fields={labels.length}>
      <Tf k="0·측정 없음 {n}개" params={{ n: labels.length }} /> — {names}
    </p>
  );
}

/** 주 값이 백분율이면 작은 원형 게이지 — 숫자를 읽을 수 있을 때만(못 읽으면 그리지 않는다) */
function PercentRing({ text }: { text: string }) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*%\s*$/.exec(text);
  if (!m) return null;
  const v = Math.max(0, Math.min(100, Number(m[1])));
  const R = 16, C = 2 * Math.PI * R;
  const color = v >= 90 ? '#e11d48' : v >= 75 ? '#f59e0b' : '#6366f1';
  return (
    <svg viewBox="0 0 40 40" className="h-11 w-11 shrink-0" aria-hidden data-ring={v}>
      <circle cx={20} cy={20} r={R} fill="none" stroke="#e2e8f0" strokeWidth={5} />
      <circle cx={20} cy={20} r={R} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 20 20)" />
    </svg>
  );
}

function BoardCard({ def, section, generatedAt, isFetching, isError, status, delta }: {
  def: BoardDef; section?: Section; generatedAt?: string; isFetching: boolean; isError: boolean;
  status: BoardStatus; delta: Record<string, number>;
}) {
  const st = STATUS_STYLE[status];
  const sectionError = isError || (section ? !section.ok : false);
  const summary = section?.ok ? section.summary : undefined;
  const v = summary ? boardView(def.key, summary) : null;
  const ktas = def.key === 'emergency' && summary ? ktasChips(summary) : [];
  const note = summary ? boardNote(def.key, summary) : null;

  return (
    <Link href={def.href} data-board={def.key} data-board-status={status}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white p-4 pt-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg ${st.border}`}>
      <span className={`absolute inset-x-0 top-0 h-1.5 ${st.bar}`} />
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><def.icon className="h-4 w-4" /></span>
          <span className="truncate"><T k={def.title} /></span>
        </h3>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.badge}`} data-status-badge><T k={BOARD_STATUS_LABEL[status]} /></span>
          <FreshnessBadge updatedAt={generatedAt ? new Date(generatedAt).getTime() : undefined} isFetching={isFetching} isError={sectionError} />
        </span>
      </div>

      {v ? (
        <>
          <div className="flex items-end justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
            <PercentRing text={v.primary.value} />
            <div className="min-w-0">
              <div className="flex items-start text-[34px] font-extrabold leading-none tracking-tight tabular-nums text-slate-900"><UnitText text={v.primary.value} /><DeltaMark d={delta[`${def.key}.${v.primary.key}`]} /></div>
              <div className="mt-1.5 text-[11px] font-medium text-slate-500"><T k={v.primary.label} /></div>
            </div>
            </div>
            {v.alert && (
              <span className={`flex shrink-0 flex-col items-end rounded-xl px-2.5 py-1.5 ${v.alert.value > 0 ? 'bg-rose-50 ring-1 ring-rose-100' : 'bg-slate-50'}`}>
                <span className={`text-lg font-bold leading-tight tabular-nums ${v.alert.value > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{fmtInt(v.alert.value)}</span>
                <span className={`text-[10px] ${v.alert.value > 0 ? 'text-rose-500' : 'text-slate-400'}`}><T k={v.alert.label} /></span>
              </span>
            )}
          </div>

          {/* KTAS 분포 — 응급은 총원보다 중증도 구성이 먼저 읽혀야 한다 */}
          {ktas.length > 0 && (
            <div className="mt-2.5 flex gap-1">
              {ktas.map((k) => (
                <span
                  key={k.level}
                  title={`KTAS ${k.level}`}
                  className={`flex-1 rounded-md px-1 py-1 text-center text-[10.5px] font-semibold tabular-nums shadow-sm ${
                    k.count === 0 ? 'bg-slate-50 font-normal text-slate-300 shadow-none' : KTAS_TONE[Number(String(k.level).replace(/^L/, ''))] ?? 'bg-slate-100 text-slate-600'
                  } ${k.danger && k.count > 0 ? 'ring-2 ring-rose-300 ring-offset-1' : ''}`}
                >
                  {k.level} {k.count}
                </span>
              ))}
            </div>
          )}

          {/* 서버가 준 나머지 지표 — 버리지 않고 조밀하게 */}
          <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-3">
            {v.fields.filter((f) => !f.muted).map((f) => (
              <div key={f.key} data-field-tone={f.muted ? 'muted' : f.tone}
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${f.muted ? 'bg-transparent' : FIELD_TILE[f.tone]}`}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${f.muted ? 'bg-slate-200' : FIELD_DOT[f.tone]}`} />
                  <span className={`truncate text-[11px] ${f.muted ? 'text-slate-300' : 'text-slate-600'}`}><T k={f.label} /></span>
                </span>
                <span className={`shrink-0 text-[13px] font-bold tabular-nums ${f.muted ? 'font-normal text-slate-300' : TONE_TEXT[f.tone]}`}>
                  <UnitText text={f.value} /><DeltaMark d={delta[`${def.key}.${f.key}`]} />
                </span>
              </div>
            ))}
          </div>
          {/* 🔴 0·측정 없음 칸은 버리지 않고 한 줄로 접는다 — 이름은 그대로 남긴다(숨긴 것이 아니라 접은 것)
              카드 안은 링크라 펼치기 버튼을 두지 않는다(중첩 상호작용 금지) */}
          {v.fields.some((f) => f.muted) && (
            <MutedFieldsLine labels={v.fields.filter((f) => f.muted).map((f) => f.label)} />
          )}

          {/* 🔴 이 값이 **언제 것인가** — 서버가 표본 창을 계산해 두고도 읽는 화면이 없었다(2026-09-02) */}
          {note && (
            <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-snug text-slate-400">
              <Tf k={note.key} params={note.params} />
            </div>
          )}
        </>
      ) : (
        <div className={`py-5 text-xs ${section && !section.ok ? 'text-amber-600' : 'text-slate-300'}`}><T k={section && !section.ok ? '보드 응답 오류' : '데이터 없음'} /></div>
      )}
      <span className="mt-auto flex items-center gap-1 pt-3 text-[11px] font-medium text-slate-400 transition group-hover:text-indigo-600">
        <T k="상세 보드" /> <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** 지금 조치 필요 — 상황판에서 가장 먼저 읽혀야 하는 것 */
function ActionPanel({ actions, delta }: { actions: ActionItem[]; delta: Record<string, number> }) {
  if (actions.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-700">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <T k="지금 조치가 필요한 항목이 없습니다 — 위급값·고위험·지연 모두 0건입니다." />
      </div>
    );
  }
  const danger = actions.filter((a) => a.tone === 'danger');
  return (
    <div className={`rounded-2xl border bg-white p-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ${danger.length > 0 ? 'border-rose-200' : 'border-amber-200'}`}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${danger.length > 0 ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}><AlertTriangle className="h-4 w-4" /></span>
        <h2 className="text-sm font-bold text-slate-900"><T k="지금 조치 필요" /></h2>
        {danger.length > 0 && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white"><T k="위험" /> {danger.length}</span>}
        <span className="text-[11px] text-slate-400">
          {danger.length > 0 && <><T k="위험" /> {danger.length}<T k="종" /> · </>}
          <T k="총" /> {actions.length}<T k="종" /> — <T k="누르면 해당 보드로" />
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2">
        {actions.map((a) => (
          <Link
            key={a.key}
            href={a.href}
            className={`relative overflow-hidden rounded-xl border py-2 pl-4 pr-3 transition hover:-translate-y-0.5 hover:shadow-md ${
              a.tone === 'danger' ? 'border-rose-200 bg-rose-50/60 hover:bg-rose-50' : 'border-amber-200 bg-amber-50/50 hover:bg-amber-50'
            }`}
          >
            <span className={`absolute inset-y-0 left-0 w-1 ${a.tone === 'danger' ? 'bg-rose-500' : 'bg-amber-400'}`} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-slate-900">
                {a.tone === 'danger' && <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" /></span>}
                <T k={a.label} />
              </span>
              <span className={`shrink-0 text-base font-bold tabular-nums ${a.tone === 'danger' ? 'text-rose-600' : 'text-amber-600'}`}>{fmtInt(a.count)}<DeltaMark d={delta[`${a.section}.${a.key}`]} /></span>
            </div>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500"><T k={a.why} /></p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function KpiStrip({ kpi, sections, delta, trend, trendFailed }: {
  kpi: Summary['kpi']; sections: Record<string, Section>; delta: Record<string, number>;
  /** 서버 이력(5분 칸) — 없으면 추세선을 그리지 않는다(지어내지 않는다) */
  trend?: TrendResponse; trendFailed?: boolean;
}) {
  const tt = useTAttr();
  const tfAttr = useTfAttr();
  const sec = (k: string) => (sections?.[k]?.ok ? sections[k].summary ?? {} : {});
  const nOf = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  /**
   * 🔴 **조회 실패를 0 으로 그리지 않는다**(2026-09-02).
   *    이 EP 는 섹션 부분 실패를 허용하는데, 실패 섹션을 `{}` 로 접어 `nOf(...)=0` 이 되면
   *    '접수 대기 0 · 조제 대기 0 · 미수금 0원' 이라는 **가장 안심되는 화면**이 나온다.
   *    실패는 없음이 아니다 — 그 자리에 '조회 실패'라고 쓰고 사유를 title 로 붙인다(§1).
   */
  const failed = (k: string) => sections?.[k] !== undefined && sections[k].ok === false;
  const Failed = ({ k }: { k: string }) => (
    <span className="text-amber-600" title={`${k} ${tt('섹션 조회가 실패했습니다 — 이 값은 0 이 아니라 알 수 없음입니다')}${sections?.[k]?.error ? ` (${sections[k].error})` : ''}`}><T k="조회 실패" /></span>
  );
  // 상단은 "병원 전체가 지금 어떤 상태인가" — 부서 카드로 내려가기 전에 읽는 값들
  /**
   * 🔴 **값 · 라벨 · 보조를 각자 줄에 둔다**(2026-09-03).
   *    종전에는 값과 라벨을 한 줄에 붙여 놔서, 값 길이가 제각각인 만큼 라벨 시작점이 흔들리고
   *    긴 값(QI `88% (22/25) 2026-05 측정`)이 카드 안에서 3줄로 접히며 라벨이 `QI ...` 로 잘렸다.
   *    보조 정보(분자/분모·측정 시점·부분 집계)는 **값이 아니라 보조 줄**로 내린다 —
   *    값 자리에 사실을 더 쑤셔 넣으면 정렬이 아니라 정보가 먼저 깨진다.
   */
  const ICON: Record<string, LucideIcon> = {
    '재원': Users, '병상 가동률': BedDouble, '응급 재실': Siren, '위급값 미보고': HeartPulse, '접수 대기': ClipboardList,
    '조제 대기': Pill, '판독 대기': Hourglass, '미수금': Wallet, 'QI 달성률': ShieldCheck,
  };
  const items: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone: string; dk?: string; tr?: TrendSource }[] = [
    { label: '재원', value: failed('nursing') ? <Failed k="nursing" /> : fmtInt(kpi.census ?? 0), tone: 'text-gray-900', dk: 'kpi.census', tr: { key: 'kpi.census' } },
    // 🔴 등록 병상 0이면 서버가 null 을 준다 — `${null}%` 로 찍지 않고 <Ratio> 가 산출 불가를 그린다
    //    다만 **조회 실패**를 '등록 병상 없음'이라 말하면 그것도 거짓이라, 실패는 갈라서 그린다
    { label: '병상 가동률', value: failed('bed') ? <Failed k="bed" /> : <Ratio numerator={kpi.occupancyNumerator ?? null} denominator={kpi.occupancyDenominator ?? null} pctOnly decimals={0} unavailableHint="등록 병상 없음" />, tone: kpi.bedAlert ? 'text-rose-600' : 'text-gray-900', tr: { ratio: ['kpi.occupancyNumerator', 'kpi.occupancyDenominator'] } },
    { label: '응급 재실', value: failed('emergency') ? <Failed k="emergency" /> : fmtInt(kpi.erActive ?? 0), tone: (kpi.erActive ?? 0) > 0 ? 'text-rose-600' : 'text-gray-900', dk: 'kpi.erActive', tr: { key: 'kpi.erActive' } },
    { label: '위급값 미보고', value: failed('diagnostics') ? <Failed k="diagnostics" /> : fmtInt(kpi.criticalPending ?? 0), tone: (kpi.criticalPending ?? 0) > 0 ? 'text-rose-600' : 'text-gray-900', dk: 'kpi.criticalPending', tr: { key: 'kpi.criticalPending' } },
    { label: '접수 대기', value: failed('receptionBilling') ? <Failed k="receptionBilling" /> : fmtInt(nOf(sec('receptionBilling'), 'waiting')), tone: 'text-gray-900', dk: 'receptionBilling.waiting', tr: { key: 'receptionBilling.waiting' } },
    { label: '조제 대기', value: failed('pharmacy') ? <Failed k="pharmacy" /> : fmtInt(nOf(sec('pharmacy'), 'pending')), tone: 'text-gray-900', dk: 'pharmacy.pending', tr: { key: 'pharmacy.pending' } },
    { label: '판독 대기', value: failed('diagnostics') ? <Failed k="diagnostics" /> : fmtInt(nOf(sec('diagnostics'), 'imagingUnread')), tone: 'text-gray-900', dk: 'diagnostics.imagingUnread', tr: { key: 'diagnostics.imagingUnread' } },
    { label: '미수금', value: failed('receptionBilling') ? <Failed k="receptionBilling" /> : fmtMoney(nOf(sec('receptionBilling'), 'outstandingAmount')), tone: 'text-gray-900', tr: { key: 'receptionBilling.outstandingAmount' } },
    // 🔴 비율은 분모와 함께 — 판정 지표 0이면 '—'가 아니라 산출 불가(§2.1)
    // 🔴 달성률은 **언제 것인지**와 함께 — 이번 달 측정이 아니면 그 사실을 값 옆에 쓴다(운영은 4개월 전 값이었다)
    {
      label: 'QI 달성률',
      value: failed('safetyQuality')
        ? <Failed k="safetyQuality" />
        : <UnitText text={ratioText(nOf(sec('safetyQuality'), 'qiMet'), nOf(sec('safetyQuality'), 'qiJudged'), { pctOnly: true, decimals: 0 })} />,
      // 분모와 표본 시점은 보조 줄로 — 값 옆에 붙이면 카드가 접히고 라벨이 잘린다
      sub: failed('safetyQuality') ? null : (
        <span title={(() => { const n = boardNote('safetyQuality', sec('safetyQuality')); return n ? tfAttr(n.key, n.params) : undefined; })()}>
          {nOf(sec('safetyQuality'), 'qiJudged') ? `${nOf(sec('safetyQuality'), 'qiMet')}/${nOf(sec('safetyQuality'), 'qiJudged')}` : null}
          {sec('safetyQuality').qiIsCurrentPeriod === false && typeof sec('safetyQuality').qiLatestPeriod === 'string' && (
            <span className="text-amber-600">{nOf(sec('safetyQuality'), 'qiJudged') ? ' · ' : ''}{String(sec('safetyQuality').qiLatestPeriod)} <T k="측정" /></span>
          )}
        </span>
      ),
      tone: 'text-gray-900',
    },
    // 🔴 (2026-10-02) '경고 총합' 칸은 머리 띠의 경보 구성(위험·주의 종류·건수)으로 옮겼다 — 같은 숫자를 두 번 크게 그리지 않는다
  ];
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2">
      {items.map((it) => (
        /* 🔴 `justify-center` — 같은 줄의 가장 높은 카드(보조 줄이 있는 것)에 맞춰 늘어난
           카드에서 내용이 위로 쏠려 아래가 비어 보였다. 남는 높이는 위아래로 나눈다. */
        (() => {
          // 톤은 값에서 온 것 — 위험(붉은 값)·주의(주황 값)만 카드 바탕을 물들인다(정상 카드는 조용히)
          const danger = it.tone.includes('rose'), warn = it.tone.includes('amber');
          const Icon = ICON[it.label] ?? Activity;
          return (
        <div key={it.label} className={`relative flex flex-col justify-center gap-0.5 overflow-hidden rounded-xl border px-3 py-2.5 pl-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${
          /* 🔴 불투명 바탕 — 반투명(rose-50/50)은 관제 모드의 어두운 바탕 위에서 회색으로 비쳐 붉은 값이 읽히지 않았다(10-02 실화면) */
          danger ? 'border-rose-200 bg-rose-50' : warn ? 'border-amber-200 bg-amber-50' : 'border-slate-200/80 bg-white'}`}>
          <span className={`absolute inset-y-0 left-0 w-1 ${danger ? 'bg-rose-500' : warn ? 'bg-amber-400' : 'bg-slate-200'}`} />
          <Icon className={`absolute right-2.5 top-2.5 h-4 w-4 ${danger ? 'text-rose-300' : warn ? 'text-amber-300' : 'text-slate-200'}`} />
          {/* 값 — 한 줄 고정. 넘치면 줄바꿈이 아니라 가로 스크롤로(카드 높이가 흔들리지 않게) */}
          <span className={`overflow-x-auto whitespace-nowrap pr-5 text-[22px] font-extrabold leading-tight tracking-tight tabular-nums ${it.tone}`}>
            {typeof it.value === 'string' ? <UnitText text={it.value} /> : it.value}
            {it.dk && <DeltaMark d={delta[it.dk]} />}
          </span>
          <span className="truncate text-[11px] font-medium leading-tight text-slate-500"><T k={it.label} /></span>
          {/* 보조 — 있을 때만. 없는 카드가 억지로 자리를 비워 두지 않는다(grid 가 높이를 맞춘다) */}
          {it.sub && <span className="truncate text-[10px] leading-tight text-gray-400">{it.sub}</span>}
          {/* 추세선(F) — 서버 이력만 · 끊긴 칸은 잇지 않는다 · 색 판정 없음 */}
          {it.tr && <KpiSparkline trend={trend} src={it.tr} failed={trendFailed} />}
        </div>
          );
        })()
      ))}
    </div>
  );
}

/**
 * 환자 여정 — 상황판 하단. "지금 어느 단계에 몇 명"과 "어디서 막혔나"만 보여주고
 * 상세 조작은 여정 콘솔로 넘긴다(상황판은 진입점이지 작업 화면이 아니다).
 */
function DelayedRow({ masked, href, className, children }: { masked: boolean; href: string; className: string; children: React.ReactNode }) {
  return masked ? <div className={className} data-masked-row>{children}</div> : <Link href={href} className={className}>{children}</Link>;
}

function JourneySection({ masked = false, compact = false }: { masked?: boolean; compact?: boolean }) {
  // 🔴 여정 보드는 경영 관제 EP(@Roles(ADMIN, EXECUTIVE)) — 임상 역할은 **부르지 않는다**.
  //    `enabled:false` 로 호출 자체를 막는다(catch 로 삼키면 isError 가 영원히 false 가 된다).
  const role = useAuthStore((s) => s.user?.role);
  const allowed = canSeeJourneyBoard(role);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['command-center-journey'],
    queryFn: () => apiClient.get<{ data: { asOf: string; opd: JourneyRow[]; ipd: JourneyRow[] } }>('/api/v1/journey-console/board?limit=400'),
    refetchInterval: pollMs('normal'),
    retry: 1,
    enabled: allowed,
  });
  const board = ((data?.data as unknown as { data?: { asOf: string; opd: JourneyRow[]; ipd: JourneyRow[] } })?.data ?? data?.data) as
    { asOf?: string; opd?: JourneyRow[]; ipd?: JourneyRow[] } | undefined;

  const opd = board?.opd ?? [];
  const ipd = board?.ipd ?? [];
  const opdFlow = stageFlow(opd, 'OPD');
  const ipdFlow = stageFlow(ipd, 'IPD');
  const delayed = delayedPatients(opd, ipd);
  // 🔴 목록은 잘린다 — 분모를 따로 센다(자르면 잘랐다고 말한다)
  const delayedTotal = delayedCount(opd, ipd);
  const maxCount = Math.max(1, ...opdFlow.map((s) => s.count));

  /**
   * 🔴 권한이 없어 **묻지 않았다**는 사실을 말한다 — 종전엔 403 뒤 `return null` 로 섹션이
   *    통째로 사라져 "여정에 아무 일도 없음"으로 읽혔다(숨긴 것과 없는 것은 다르다).
   */
  if (!allowed) {
    // 🔴 (2026-10-02) 종전엔 임상 역할에게 권한 설명 문단이 **늘** 떠 있었다 — 한 줄로 줄이고 갈 곳을 준다.
    //    숨긴 것과 없는 것은 다르다는 사실은 그대로 말한다(비어 있다는 뜻이 아니다).
    return (
      <p className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-2 text-[11px] text-gray-500" data-journey-gated>
        <T k="환자 여정 보드는 경영 관제 권한 화면입니다 — 비어 있다는 뜻이 아닙니다. 지연 환자는 각 부서 보드에서 확인하세요." />
      </p>
    );
  }

  // 🔴 부분 실패 허용은 상황판 나머지를 살리자는 것이지 **실패를 감추자는 것이 아니다**.
  //    종전 `return null` 은 조회 실패를 "여정 이상 없음"으로 읽히게 했다.
  if (isError) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-gray-900"><T k="환자 여정" /></h2>
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><Activity className="h-4 w-4" /></span>
        <h2 className="text-sm font-bold text-slate-900"><T k="환자 여정" /></h2>
        <span className="text-[11px] text-gray-400">
          <T k="외래" /> <b className="text-gray-600">{opd.length}</b><Unit>명</Unit> · <T k="입원" /> <b className="text-gray-600">{ipd.length}</b><Unit>명</Unit> — <T k="단계별 인원과 지연 지점" />
        </span>
        <Link href="/journey-console" className="ml-auto text-[11px] font-medium text-blue-600 hover:text-blue-700"><T k="여정 콘솔" /> →</Link>
      </div>

      {/*
        🔴 **두 칸으로 나누지 않는다**(2026-08-26 사람 신고 2회).
        단계 카드는 짧고 지연 목록은 길어서, 나란히 두면 왼쪽이 늘 비었다.
        카드를 늘려 채우려 했더니 **숫자 하나에 세로 800px** 짜리 기둥이 됐다 —
        빈 자리를 늘려서 메우는 것은 채우는 것이 아니다.
        그래서 **위아래로 쌓고 각각 전폭을 쓴다**: 흐름은 한 줄, 지연 환자는 여러 열.
      */}
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
      ) : (
        <div className="space-y-3">
          {/* ① 흐름 — 접수부터 완료까지 어디에 몰려 있는지. 한 줄, 전폭 */}
          <div className="flex flex-wrap items-stretch gap-1">
            {opdFlow.map((s, i) => (
              <div key={s.stage} className="flex min-w-[96px] flex-1 items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
              <div
                className={`min-w-0 flex-1 rounded-xl border px-2.5 py-2 ${
                  s.delayed > 0 ? 'border-rose-200 bg-rose-50/40' : s.count === 0 ? 'border-slate-100 bg-slate-50/50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className={`truncate text-[10px] ${s.count === 0 ? 'text-gray-300' : 'text-gray-500'}`}><T k={s.label} /></span>
                  {s.delayed > 0 && <span className="shrink-0 text-[9px] font-bold text-rose-500"><T k="지연" /> {s.delayed}</span>}
                </div>
                <div className={`text-lg font-bold leading-tight tabular-nums ${s.count === 0 ? 'text-gray-300' : 'text-gray-900'}`}>{s.count}</div>
                {/* 몰림을 눈으로 — 최대 단계 대비 비율 막대 */}
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-100">
                  <div className={`h-full rounded-full ${s.delayed > 0 ? 'bg-rose-400' : 'bg-blue-400'}`} style={{ width: `${Math.round((s.count / maxCount) * 100)}%` }} />
                </div>
              </div>
              </div>
            ))}
          </div>

          {ipd.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ipdFlow.filter((s) => s.count > 0).map((s) => (
                <span key={s.stage} className="inline-flex items-baseline gap-1 rounded-lg bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700">
                  <T k="입원" /> <T k={s.label} /> <b className="tabular-nums">{s.count}</b>
                  {s.delayed > 0 && <span className="text-rose-500"><T k="지연" /> {s.delayed}</span>}
                </span>
              ))}
            </div>
          )}

          {/* ② 막힌 지점 — 사람 단위로 바로 짚을 수 있게. 전폭 여러 열이라 스크롤 없이 다 보인다 */}
          <div className="min-w-0 border-t border-gray-100 pt-3">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
              <span className="font-semibold text-gray-500">
                <T k="지연 환자" /> {delayedTotal > 0 ? <>{delayedTotal}<Unit>명</Unit></> : null}
              </span>
              {/* 🔴 자르면 잘랐다고 말한다 — 종전엔 잘린 12건을 그대로 "12명"이라 적었다 */}
              {delayedTotal > delayed.length && (
                <span className="text-gray-400">
                  <T k="오래 기다린 순" /> {delayed.length}<T k="명만 표시" /> —{' '}
                  <Link href="/journey-console" className="font-medium text-blue-600 hover:text-blue-700"><T k="전체 보기" /></Link>
                </span>
              )}
            </div>
            {delayed.length === 0 ? (
              <p className="rounded-lg bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-700"><T k="지연된 환자가 없습니다." /></p>
            ) : (
              /* 3단 배치의 오른쪽 열(좁다)에서는 한 열 — 폭이 좁은데 3열로 쪼개면 이름·단계가 잘린다 */
              <ul className={`grid max-h-72 grid-cols-1 gap-1 overflow-y-auto ${compact ? '2xl:max-h-[28rem]' : 'md:grid-cols-2 2xl:grid-cols-3'}`}>
                {delayed.map((d) => (
                  <li key={d.patientId} className="min-w-0">
                    {/* 🔴 관제 모드는 이름을 가리고 등록번호·병실을 빼며 환자 화면으로 가는 링크도 없다(벽 모니터) */}
                    <DelayedRow masked={masked} href={`/patients/${d.patientId}`}
                      className={`flex items-baseline gap-2 rounded-lg border px-2 py-1.5 transition hover:shadow-sm ${
                        d.tone === 'danger' ? 'border-rose-200 bg-rose-50/50' : 'border-amber-200 bg-amber-50/40'
                      }`}
                    >
                      <span className="shrink-0 text-[11px] font-semibold text-gray-900" data-patient-name>{masked ? wallMaskName(d.name) : d.name}</span>
                      {!masked && <span className="shrink-0 font-mono text-[10px] text-gray-400">{d.mrn}</span>}
                      <span className="min-w-0 flex-1 truncate text-[10.5px] text-gray-500">
                        <T k={d.stageLabel} />
                        {d.dept ? <> · <DeptName ko={d.dept} /></> : null}
                        {d.place && !masked ? ` · ${d.place}` : ''}
                      </span>
                      <span className={`shrink-0 text-[10px] font-semibold ${d.tone === 'danger' ? 'text-rose-600' : 'text-amber-600'}`}>
                        {d.flagLabels.map((fl, i) => <span key={fl}>{i > 0 ? '·' : ''}<T k={fl} /></span>)}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-gray-400"><UnitText text={d.stay} /></span>
                    </DelayedRow>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * 머리 띠 — 관제 모니터에서 멀리서도 읽히게. 🔴 "실시간" 표시는 **마지막 응답 시각**에서 온다(시계가 아니라 데이터 기준) —
 * 조회가 실패하면 초록 점을 끄고 "갱신 실패"라고 말한다(살아 있는 척하지 않는다).
 */
function HeroBar({ generatedAt, isFetching, isError, actions, alertsTotal, alertsUnavailable, wall, onToggleWall }: {
  generatedAt?: string; isFetching: boolean; isError: boolean; actions: ActionItem[] | null;
  alertsTotal: number | null; alertsUnavailable: string[]; wall: boolean; onToggleWall: () => void;
}) {
  const tAttr = useTAttr();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmmss = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const updated = generatedAt ? new Date(generatedAt) : null;
  const comp = actions ? alertComposition(actions) : null;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 px-5 py-4 text-white shadow-lg">
      <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight"><Radio className="h-5 w-5 text-indigo-300" /><T k="통합 상황판" /></h1>
          <p className="mt-0.5 text-[11px] text-slate-300"><T k="30초 폴링 + 위급 이벤트 즉시 갱신 · 카드 클릭 시 상세 보드" /></p>
          {/* 🔴 (2026-10-02) 이 화면이 무엇을 답하는지 — 병원 전체 지금. 내 할 일은 대시보드(관제 모드에선 숨김 — 벽 모니터) */}
          {!wall && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-300" data-cc-role>
              <span className="font-semibold text-white/90"><T k="병원 전체 · 지금" /></span>
              <Link href="/dashboard" className="underline-offset-2 hover:text-white hover:underline"><T k="내 할 일은 대시보드" /> →</Link>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5 text-[12px]">
          {/* 🔴 (2026-10-02) 종전 "경고 총합 337" — 숫자만 컸다. "지금 조치 필요"와 같은 원천으로 등급별 종류·건수를 말한다 */}
          {comp && (comp.dangerKinds > 0 || comp.warnKinds > 0) && (
            <span className="flex items-center gap-1.5" data-alert-composition title={alertsTotal != null ? `${tAttr('경고 총합')} ${alertsTotal}` : undefined}>
              {comp.dangerKinds > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-rose-500/20 px-3 py-1 font-semibold text-rose-100 ring-1 ring-rose-300/40">
                  <AlertTriangle className="h-3.5 w-3.5" /><Tf k="위험 {종}종 {건}건" params={{ 종: comp.dangerKinds, 건: fmtInt(comp.dangerCount) }} />
                </span>
              )}
              {comp.warnKinds > 0 && (
                <span className="rounded-full bg-amber-400/15 px-3 py-1 font-semibold text-amber-200 ring-1 ring-amber-300/30">
                  <Tf k="주의 {종}종 {건}건" params={{ 종: comp.warnKinds, 건: fmtInt(comp.warnCount) }} />
                </span>
              )}
            </span>
          )}
          {/* 🔴 기여 섹션이 죽으면 경보는 **부분 집계**다 — 더 작은 숫자로 안심시키지 않는다 */}
          {alertsUnavailable.length > 0 && (
            <span className="rounded-full bg-amber-400/15 px-3 py-1 text-amber-200 ring-1 ring-amber-300/30"
              title={`${alertsUnavailable.join(', ')} ${tAttr('섹션 조회 실패로 이 합계에서 빠졌습니다 — 실제는 이보다 클 수 있습니다')}`}>
              <T k="부분 집계" />
            </span>
          )}
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 ring-1 ${isError ? 'bg-amber-400/15 text-amber-200 ring-amber-300/30' : 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/20'}`}>
            <span className="relative flex h-2 w-2">
              {!isError && <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 ${isFetching ? 'animate-ping' : ''}`} />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${isError ? 'bg-amber-400' : 'bg-emerald-400'}`} />
            </span>
            {isError ? <T k="갱신 실패" /> : <><T k="마지막 갱신" /> <span className="tabular-nums">{updated ? hhmmss(updated) : '—'}</span></>}
          </span>
          {now && <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-[13px] tabular-nums text-slate-100">{hhmmss(now)}</span>}
          {wall && <span className="rounded-full bg-indigo-400/20 px-3 py-1 text-indigo-100 ring-1 ring-indigo-300/40" data-wall-badge><T k="관제 모드 · 환자 이름 가림" /></span>}
          <button type="button" onClick={onToggleWall} data-wall-toggle
            className="flex min-h-[32px] items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-slate-100 ring-1 ring-white/20 hover:bg-white/20">
            {wall ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <T k={wall ? '관제 모드 끄기' : '관제 모드'} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 관제 모드(벽 모니터) — 2026-10-02.
 * 전체화면 · 어두운 바탕 · 큰 글자 · 3초 무조작 시 커서 숨김 · **환자 이름 가림·환자 링크 없음**.
 * 🔴 상황판은 관제 모니터에 띄우는 물건인데 환자 여정의 지연 환자 이름·등록번호·병실이 그대로 보였다 — 벽 모니터는 지나가는 사람도 본다.
 * URL `?wall=1` 로 들어오면 관제 모드로 연다(모니터 즐겨찾기용) · 전체화면은 브라우저가 거절할 수 있다(사용자 동작 없이 열면) — 그때도 나머지는 적용된다.
 */
function useWallMode(ref: React.RefObject<HTMLDivElement | null>) {
  const [wall, setWall] = useState(false);
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get('wall') === '1') setWall(true); } catch { /* SSR 외 환경 */ }
  }, []);
  useEffect(() => {
    if (!wall) { setIdle(false); return; }
    let t: ReturnType<typeof setTimeout>;
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3000); };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', wake); window.removeEventListener('keydown', wake); };
  }, [wall]);
  // 전체화면을 Esc 로 빠져나오면 관제 모드도 끈다(이름 가림만 남는 어중간한 상태를 만들지 않는다)
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setWall((w) => (w && wasFullscreen.current ? false : w)); wasFullscreen.current = !!document.fullscreenElement; };
    const wasFullscreen = { current: false };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggle = () => {
    const next = !wall;
    setWall(next);
    try {
      const u = new URL(window.location.href);
      if (next) u.searchParams.set('wall', '1'); else u.searchParams.delete('wall');
      window.history.replaceState(null, '', u.toString());
    } catch { /* 주소 갱신 실패는 모드에 영향 없음 */ }
    try {
      if (next && ref.current?.requestFullscreen && !document.fullscreenElement) void ref.current.requestFullscreen().catch(() => undefined);
      if (!next && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } catch { /* 전체화면 미지원 — 나머지 관제 모드는 적용 */ }
  };
  return { wall, idle, toggle };
}

export default function CommandCenterPage() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role ?? '');
  const q = useQuery({
    queryKey: ['command-center-summary'],
    queryFn: () => apiClient.get<{ data: Summary }>('/api/v1/command-center/summary').then((r) => {
      const raw = r.data as unknown;
      return ((raw as { data?: Summary })?.data ?? (raw as Summary));
    }),
    refetchInterval: pollMs('normal'), retry: 1, staleTime: 5000,
  });
  useRefreshHints(() => qc.invalidateQueries({ queryKey: ['command-center-summary'] }));
  const rootRef = useRef<HTMLDivElement>(null);
  const { wall, idle, toggle } = useWallMode(rootRef);
  // 3단 관제 배치(C) — 1536px 이상. 공간 부하 요약은 넓은 화면에서만 부른다
  const wide = useWide(1536);
  // 추세선(F) — 서버 이력(5분 칸). 칸이 5분마다 하나 생기므로 그 주기로만 다시 읽는다
  const trendQ = useQuery({
    queryKey: ['command-center-trend', 24],
    queryFn: () => apiClient.get<{ data: TrendResponse }>('/api/v1/command-center/trend?hours=24').then((r) => {
      const raw = r.data as unknown;
      return ((raw as { data?: TrendResponse })?.data ?? (raw as TrendResponse));
    }),
    refetchInterval: 5 * 60_000, retry: 1, staleTime: 60_000,
  });

  const summary = q.data;
  // 직전 갱신 대비 — 이 화면이 받은 직전 응답과 비교(서버 이력이 아니다)
  const prevSnap = useRef<Record<string, number> | null>(null);
  const [delta, setDelta] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!summary) return;
    const cur = numericSnapshot(summary);
    setDelta(numericDelta(prevSnap.current, cur));
    prevSnap.current = cur;
  }, [summary]);

  const actions = summary?.sections ? criticalActions(summary.sections) : null;
  // 서버가 역할별 섹션만 반환 — 반환된 섹션만 카드로 표시 · 상태순(위험 → 조회 실패 → 주의 → 기준 초과 없음)
  const statusOf = (key: string): BoardStatus => boardStatus(key, summary?.sections?.[key], actions ?? []);
  const visible = sortByStatus(BOARDS.filter((b) => summary?.sections?.[b.key] || (!summary && role)), statusOf);

  return (
    /* 상황판은 큰 화면(관제 모니터)에 띄우는 물건 — 폭을 제한하지 않고 열 수가 늘어나게 한다 */
    <div ref={rootRef} data-wall={wall ? '1' : '0'}
      className={wall ? `min-h-screen space-y-4 overflow-y-auto bg-slate-950 p-6 [zoom:1.12] ${idle ? 'cursor-none' : ''}` : 'space-y-4 p-4'}>
      <HeroBar generatedAt={summary?.generatedAt} isFetching={q.isFetching} isError={q.isError} actions={actions}
        alertsTotal={summary?.kpi?.alertsTotal ?? null} alertsUnavailable={summary?.kpi?.alertsUnavailable ?? []} wall={wall} onToggleWall={toggle} />

      {summary?.kpi && <KpiStrip kpi={summary.kpi} sections={summary.sections} delta={delta} trend={trendQ.data} trendFailed={trendQ.isError} />}

      {/*
        🔴 (2026-10-02 · 디자인 C) 넓은 화면(관제 모니터 · 1536px+)에서는 3단 — 왼쪽 "지금 조치 필요"(세로 고정) · 가운데 부서 카드 ·
           오른쪽 환자 여정·공간 부하. 종전엔 위에서 아래로만 쌓여 큰 모니터에서도 환자 여정·3D 가 스크롤 밖이었다.
           좁은 화면은 같은 순서로 위아래로 쌓인다(DOM 순서 = 읽는 순서).
      */}
      <div className="space-y-4 2xl:grid 2xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(320px,420px)] 2xl:items-start 2xl:gap-4 2xl:space-y-0" data-cc-layout>
      <aside className="2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-y-auto" data-cc-col="actions">
        {actions && <ActionPanel actions={actions} delta={delta} />}
      </aside>
      <div className="min-w-0" data-cc-col="boards">

      {q.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-gray-100" />)}
        </div>
      ) : !summary || Object.keys(summary.sections).length === 0 ? (
        <p className="text-sm text-gray-400"><T k="표시할 현장 보드가 없습니다." /></p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
          {visible.map((b) => (
            <BoardCard key={b.key} def={b} section={summary.sections[b.key]} generatedAt={summary.generatedAt} isFetching={q.isFetching} isError={q.isError}
              status={statusOf(b.key)} delta={delta} />
          ))}
        </div>
      )}

      </div>
      <aside className="min-w-0 space-y-4" data-cc-col="journey">
      {/* 환자 여정 — 부서 카드가 '무엇이 얼마나'라면, 여기는 '사람이 어디서 막혔나' · 관제 모드는 이름 가림 */}
      <JourneySection masked={wall} compact={wide} />
      {wide && <SpaceLoadMini />}
      </aside>
      </div>

      {/* 3D 건물 보기(보조) — 진료실·검진 스테이션 부하를 도면 위에 · 열 때만 three.js 를 내려받는다 */}
      <Building3DSection />

      {/* 🔴 (2026-10-02) 경영성과 벤치마크 카드를 뺐다 — 연 단위 공시 손익은 실시간 관제가 아니다(정본 /executive/finance-benchmark).
          게다가 카드는 "관리자·경영진"을 그렸는데 경영진은 이 화면의 API 권한 밖이라 볼 수 없었다. */}
    </div>
  );
}
