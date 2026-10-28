'use client';

import { useEffect, useState } from 'react';
import { useDurationText } from '@/components/ui/display';
import { FreshnessBadge } from './FreshnessBadge';
import { localeTimeText } from '@hospital-run/shared';

/**
 * 검진 대기 TV 보드 — **공개 화면**(로그인 없는 대기실 브라우저).
 *
 * 🔴 2026-08-13 W5: 종전엔 이 보드가 `(main)` 스태프 셸 **안에서** 렌더돼,
 *    사이드바·통합검색과 함께 **위급값 배너가 실명+MRN 으로** 대기실 TV 에 떴다.
 *    또 인증(PATIENT_VIEW)을 요구해 TV 브라우저에 스태프 토큰을 상주시켜야 했다 —
 *    그 토큰이면 전 환자 차트에 닿는다. ER 흐름·외래 호출 전광판과 같은 규약으로 옮긴다:
 *    **(main) 밖 독립 라우트 + 무인증 공개 EP + 서버 마스킹**.
 */
const GROUP_STYLE: Record<string, { gradient: string; icon: string }> = {
  '대기': { gradient: 'from-blue-600 to-blue-700', icon: '🏥' },
  '검사중': { gradient: 'from-amber-500 to-orange-600', icon: '🔬' },
  '검사완료': { gradient: 'from-emerald-500 to-teal-600', icon: '✅' },
  '소견대기': { gradient: 'from-violet-500 to-purple-600', icon: '📝' },
};

interface Item { id: string; name: string; program: string; waitMinutes: number | null }
interface Group { label: string; count: number; items: Item[] }

/**
 * 대기 시간 표기 — 미접수(null)는 '-'.
 * 🔴 로컬 포맷터가 정본과 갈라져 있었다(W9·P12): 24시간을 일로 못 바꾸고, **음수를 그대로 찍었다**
 *    (`-93분` — 접수 시각이 아직 오지 않은 행). 정본 `useDurationText` 는 음수·비유한값을 '-' 로 돌려준다.
 */
function useWaitText() {
  const fmtDur = useDurationText();
  return (min: number | null) => fmtDur(min);
}

export function CheckupBoard() {
  const waitText = useWaitText();
  const [clock, setClock] = useState(new Date());
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  /** 🔴 자료를 **받은** 시각 — 시계는 자료가 멈춰도 돈다 */
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const load = async () => {
      try {
        const r = await fetch(`${apiUrl}/api/v1/checkup/public/display`);
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        setGroups(j?.data?.groups ?? []);
        setTotal(j?.data?.total ?? 0);
        setFailed(false);
        setUpdatedAt(Date.now());
      } catch {
        // 🔴 조회 실패를 '대기자 없음'으로 위장하지 않는다 — 화면이 사실을 말해야 한다
        setFailed(true);
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white p-8 flex flex-col">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center text-3xl font-black shadow-lg shadow-blue-500/30">H</div>
          <div>
            <h1 className="text-3xl font-black tracking-tight">건강검진센터</h1>
            <p className="text-gray-400 text-sm">대기 현황 안내</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-5xl font-mono font-black tabular-nums tracking-tight">
            {localeTimeText(clock, 'ko-KR', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-gray-400 text-sm mt-1">
            {clock.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-4 gap-6">
        {groups.map((g) => {
          const style = GROUP_STYLE[g.label] ?? GROUP_STYLE['대기'];
          return (
            <div key={g.label} className="flex flex-col">
              <div className={`bg-gradient-to-r ${style.gradient} rounded-t-2xl px-5 py-3 flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{style.icon}</span>
                  <span className="text-lg font-bold">{g.label}</span>
                </div>
                <span className="text-4xl font-black tabular-nums">{g.count}</span>
              </div>
              <div className="flex-1 bg-gray-800/50 rounded-b-2xl border border-gray-700/50 divide-y divide-gray-700/30 overflow-hidden">
                {g.items.length === 0 && <div className="text-center text-gray-600 py-12 text-lg">-</div>}
                {g.items.map((item) => (
                  <div key={item.id} className="px-5 py-4 flex items-center justify-between">
                    <div>
                      <span className="text-2xl font-bold text-white tracking-wide">{item.name}</span>
                      <div className="text-sm text-gray-400 mt-0.5">{item.program}</div>
                    </div>
                    <span className="text-lg font-mono text-gray-300 tabular-nums">{waitText(item.waitMinutes)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {failed && (
          <div className="col-span-4 flex items-center justify-center text-amber-400 text-xl">
            현황을 불러오지 못했습니다 — 잠시 후 다시 시도합니다
          </div>
        )}
        {/* 🔴 `groups.every(...)` 는 **빈 배열에 true** 다 — 첫 응답 전에도 "대기자가 없습니다"라고 단정했다(W9·P1).
            아직 못 받은 것과 진짜 0명은 다른 사실이다. 받은 뒤에만 0명을 말한다. */}
        {!failed && updatedAt != null && groups.length > 0 && groups.every((g) => g.count === 0) && (
          <div className="col-span-4 flex items-center justify-center text-gray-600 text-xl">
            현재 검진 대기자가 없습니다
          </div>
        )}
        {!failed && updatedAt == null && (
          <div className="col-span-4 flex items-center justify-center text-gray-600 text-xl">
            현황을 불러오는 중입니다…
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between text-gray-500 text-sm">
        <span>{updatedAt == null ? '전체 -' : `전체 ${total}명`}</span>
        {/* 🔴 "5초마다 자동 갱신"은 **의도**지 사실이 아니다 — 실제로 받은 시각을 말한다 */}
        <FreshnessBadge updatedAt={updatedAt} staleAfterSec={20} />
      </div>
    </div>
  );
}
