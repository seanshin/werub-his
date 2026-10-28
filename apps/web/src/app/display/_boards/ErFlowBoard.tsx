'use client';

import { useDurationText } from '@/components/ui/display';

import { useEffect, useState } from 'react';
import { FreshnessBadge } from './FreshnessBadge';
import { localeTimeText } from '@hospital-run/shared';

/**
 * ER 환자 흐름 TV 보드(공개·emergency-flow-tv-board.plan.md) — 대기실 벽면 TV 전용.
 * /display 레이아웃(무인증) — 데이터는 공개 EP 가 서버 마스킹으로 내려준다(클라 가공 없음).
 * 표시=마스킹 이름·베드·도착/대기시간·6단계 흐름. 중증도·주호소·진단·실명 없음(D1 계약).
 * 2026-08-05 v2: TV 가독성 재구성 — 단계 스테퍼 대형화(원 라벨 상하 배치)·대기시간 칩 강조·카드형.
 */

interface FlowRow {
  id: string;
  name: string;
  bed: string | null;
  arrivalAt: string;
  currentStage: number;
  careLabel: string | null;
  tests: { total: number; done: number } | null;
  dispositionLabel: string | null;
  completed: boolean;
  completedAt: string | null;
}
interface Board { stages: string[]; rows: FlowRow[]; activeCount: number }

/**
 * 도착 후 경과 — 🔴 **아직 오지 않은 시각을 '방금'이라 말하지 않는다**(W9·P1).
 * 종전 `if (m < 1) return '방금 도착'` 은 음수(=arrivalAt 이 미래)도 삼켜서,
 * 시각이 틀어진 행이 전광판에서 **가장 급한 환자처럼** 보였다.
 */
function useElapsed(): (dt: string) => string {
  const fmtDur = useDurationText();
  return (dt: string) => {
    const t = new Date(dt).getTime();
    if (!Number.isFinite(t)) return '도착 시각 확인 필요';
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 0) return '도착 시각 확인 필요'; // 미래 시각 — 추정하지 않는다
    if (m < 1) return '방금 도착';
    // 표시 정본 경유 — 로컬 계산은 24시간을 일로 못 바꿔 `30시간 12분` 같은 값이 전광판에 걸린다
    return fmtDur(m);
  };
}
const hhmm = (dt: string) => localeTimeText(new Date(dt), 'ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

export function ErFlowBoard() {
  const elapsed = useElapsed();
  const [board, setBoard] = useState<Board | null>(null);
  const [clock, setClock] = useState('');
  /** 🔴 보드를 **받은** 시각 — SSE 가 조용히 멈춰도 시계는 계속 돈다(최신인 척하는 화면) */
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [, tick] = useState(0); // 대기시간 1분 갱신

  useEffect(() => {
    // SSE 우선(외래 전광판 선례 ③) — 오류 시 10초 폴링 폴백. 둘 다 서버 마스킹 공개 EP.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    let alive = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const r = await fetch(`${apiUrl}/api/v1/emergency/public/flow-board`);
        if (!r.ok) throw new Error(String(r.status)); // 실패를 갱신으로 치지 않는다
        const j = await r.json();
        if (alive) { setBoard(j.data); setUpdatedAt(Date.now()); }
      } catch { /* 다음 주기 재시도 — updatedAt 은 그대로 두어 화면이 '갱신 멈춤'을 말하게 한다 */ }
    };
    const es = new EventSource(`${apiUrl}/api/v1/emergency/public/flow-board/stream`);
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (alive && d && !d.error) { setBoard(d); setUpdatedAt(Date.now()); }
      } catch { /* skip */ }
    };
    es.onerror = () => {
      es.close();
      if (!pollTimer) { load(); pollTimer = setInterval(load, 10_000); }
    };
    const clockTimer = setInterval(() => setClock(localeTimeText(new Date(), 'ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })), 1000);
    const minTimer = setInterval(() => tick((t) => t + 1), 60_000);
    return () => { alive = false; es.close(); if (pollTimer) clearInterval(pollTimer); clearInterval(clockTimer); clearInterval(minTimer); };
  }, []);

  const stages = board?.stages ?? ['도착', '중증도 분류', '담당의사 배정', '진료·검사', '처분 결정', '퇴실'];
  const rows = board?.rows ?? [];

  return (
    <div className="fixed inset-0 bg-[#0a0e16] text-white flex flex-col px-14 py-7 overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between pb-4 border-b-2 border-gray-800">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-rose-600 flex items-center justify-center text-4xl font-black">+</div>
          <div>
            <h1 className="text-6xl font-black tracking-tight">응급실 진행 현황</h1>
            <p className="text-2xl text-gray-400 mt-1.5">환자분의 진행 단계를 안내합니다 · 문의는 응급실 접수 창구로</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-6xl font-bold tabular-nums text-gray-100">{clock}</p>
          <p className="text-2xl text-gray-400 mt-1">진행 중 <span className="text-white font-bold">{board?.activeCount ?? '-'}</span>명</p>
          {/* SSE 10초 주기 — 40초 넘게 못 받으면 화면이 스스로 멈췄다고 말한다 */}
          <FreshnessBadge updatedAt={updatedAt} staleAfterSec={40} className="block text-xl mt-1" />
        </div>
      </div>

      {/* 환자 카드 목록 */}
      <div className="flex-1 overflow-hidden mt-4 space-y-4">
        {rows.length === 0 && (
          // 🔴 자료를 아직 못 받은 것과 '환자가 없는 것'은 다른 사실이다 — board 가 null 이면 단정하지 않는다(P1)
          <p className="text-4xl text-gray-500 text-center mt-28">
            {board ? '현재 진행 중인 환자가 없습니다' : '현황을 불러오는 중입니다…'}
          </p>
        )}
        {rows.slice(0, 4).map((r) => (
          <div key={r.id}
            className={`rounded-3xl border px-10 pt-5 pb-6 ${r.completed
              ? 'border-gray-800 bg-gray-900/40 opacity-60'
              : 'border-gray-700/80 bg-gray-900/70 shadow-[0_0_40px_rgba(0,0,0,0.4)]'}`}>
            {/* 상단: 이름·베드·도착·대기시간 */}
            <div className="flex items-center gap-7">
              <span className="text-5xl font-black tracking-tight w-56">{r.name}</span>
              <span className="text-3xl font-mono font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-2xl px-5 py-2 w-56 text-center">
                {r.bed ?? '배정 대기'}
              </span>
              <span className="text-2xl text-gray-400">도착 <span className="text-gray-200 font-semibold">{hhmm(r.arrivalAt)}</span></span>
              <span className="ml-auto">
                {r.completed && r.dispositionLabel ? (
                  <span className="text-3xl font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-6 py-2.5">
                    ✓ {r.dispositionLabel} 완료{r.completedAt ? ` · ${hhmm(r.completedAt)}` : ''}
                  </span>
                ) : (
                  <span className="text-3xl font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-6 py-2.5 tabular-nums">
                    ⏱ 대기 {elapsed(r.arrivalAt)}
                  </span>
                )}
              </span>
            </div>

            {/* 대형 스테퍼 — 원 위 · 라벨 아래 */}
            <div className="flex items-start mt-5">
              {stages.map((label, i) => {
                const done = i < r.currentStage || (r.completed && i === stages.length - 1);
                const current = !r.completed && i === r.currentStage;
                const text = i === 3 && (current || done) && r.careLabel && current ? r.careLabel
                  : i === 4 && current && r.dispositionLabel ? `${r.dispositionLabel} 준비`
                  : i === 5 && r.completed && r.dispositionLabel ? `퇴실 · ${r.dispositionLabel}`
                  : label;
                const sub = i === 3 && r.tests && (current || done) ? `검사 ${r.tests.done}/${r.tests.total}` : null;
                return (
                  <div key={i} className="flex items-start flex-1 last:flex-none min-w-0">
                    <div className="flex flex-col items-center flex-shrink-0 w-44">
                      <span className={`rounded-full flex items-center justify-center font-black transition-all ${
                        current
                          ? 'w-12 h-12 bg-amber-400 text-gray-950 text-2xl ring-8 ring-amber-400/25 animate-pulse'
                          : done
                            ? 'w-10 h-10 bg-emerald-400 text-gray-950 text-xl'
                            : 'w-10 h-10 bg-gray-800 text-gray-600 text-xl border-2 border-gray-700'
                      }`}>
                        {done ? '✓' : i + 1}
                      </span>
                      <span className={`mt-3 text-center leading-tight ${
                        current ? 'text-3xl font-black text-amber-300'
                        : done ? 'text-2xl font-semibold text-gray-200'
                        : 'text-2xl text-gray-600'
                      }`}>
                        {text}
                      </span>
                      {sub && <span className="mt-1 text-xl text-sky-300 font-semibold">{sub}</span>}
                    </div>
                    {i < stages.length - 1 && (
                      <div className={`flex-1 h-2 rounded-full mt-[18px] mx-1 ${
                        done ? 'bg-gradient-to-r from-emerald-400 to-emerald-500/60' : 'bg-gray-800'
                      }`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {rows.length > 4 && (
          <p className="text-2xl text-gray-500 pl-2">외 {rows.length - 4}명 진행 중 — 잠시 후 자세한 안내를 받으실 수 있습니다</p>
        )}
      </div>

      <p className="pt-3 text-lg text-gray-600 border-t border-gray-800">
        개인정보 보호를 위해 성명은 일부만 표시됩니다 · 자세한 상태는 담당 의료진 또는 접수 창구에 문의해 주세요
      </p>
    </div>
  );
}
