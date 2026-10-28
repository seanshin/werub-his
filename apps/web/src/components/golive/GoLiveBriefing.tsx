'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { KDate } from '@/components/ui/display';
import { RATIO_UNAVAILABLE, goLivePrintLines } from '@hospital-run/shared';
import { usePrintIssue } from '@/components/print/usePrintIssue';
import type { DecisionsPayload } from '@/app/(main)/admin/decisions/types';
import { GoLivePrint } from '@/components/print/GoLivePrint';

/**
 * 실서비스 개시 브리핑 — **개시 회의에 들고 들어가는 문서**.
 *
 * 사람 지시(2026-08-21): "허가권자, 위원회, 실서비스 개시 부분에 대한 UX와 설명자료등을
 * 디테일하게 개선하고 보완."
 *
 * 🔴 이 문서가 지키는 것:
 *  · **준비율 하나로 말하지 않는다** — 시스템이 확인한 것과 사람이 신고한 것을 갈라서 낸다
 *  · **분모가 비면 정본 문구(`RATIO_UNAVAILABLE`)** 로 말한다(0% 도 100% 도 아니다)
 *  · **누가 움직여야 하는가**를 소관별로 묶어 낸다 — 목록만으로는 사람이 움직이지 못한다
 *  · 🔴 **개시 전 반드시 필요한 사람 결정**을 함께 싣는다 — 기술 항목만 보면 "거의 다 됐다"로 읽힌다
 *  · 🔴 **미구현이 곧 결함은 아니다** — 기관 전송은 개시 시점 작업이며 그렇게 표기한다
 */

interface Item {
  key: string; title: string; area: string; areaLabel: string; type: string;
  owner?: string | null; status: string; detail?: string;
  evidence?: 'VERIFIED' | 'SELF_REPORTED';
  isBlocking: boolean; targetDate?: string | null; overdue?: boolean; note?: string | null;
}
interface Readiness {
  computable: boolean; pct: number | null; total: number; ready: number;
  verifiedReady: number; selfReportedReady: number; basis: string;
}
export interface GoLiveRollup {
  readiness: Readiness; blockingTotal: number; blockingReady: number;
  overdueCount: number; canGoLive: boolean; items: Item[];
}

const DONE = new Set(['READY', 'DONE']);
const TYPE_KO: Record<string, string> = {
  CONFIG_GATE: '안전 게이트', APPROVAL: '승인', EXTERNAL: '외부 기관·업체',
  MANUAL: '수동 작업', HARDWARE: '하드웨어', SERVICE_FLAG: '개시 설정', DB_PROBE: 'DB 실측',
};

export function GoLiveBriefing({ rollup }: { rollup: GoLiveRollup }) {
  // 🔴 개시 전 반드시 필요한 **사람 결정**을 함께 싣는다. 실패는 숨기지 않고 그 사실을 적는다.
  const { data: dec, isError: decError, refetch: refetchDec } = useQuery({
    queryKey: ['human-decisions'],
    queryFn: () => apiClient.get<{ data: DecisionsPayload }>('/api/v1/admin/decisions'),
  });
  const decisions = dec?.data;
  const requiredDecisions = (decisions?.items ?? []).filter((i) => i.goLive === 'REQUIRED_BEFORE');
  /** 🔴 인쇄 = 서버 발급(개시 브리핑 · 발급 원장 동결·진위확인 QR) — 결정 등록부를 못 읽은 화면은 서버 줄과 달라 인쇄하지 않는다 */
  const lines = useMemo(() => goLivePrintLines(rollup.items, decisions?.items ?? []), [rollup.items, decisions]);
  const pr = usePrintIssue('GOLIVE_BRIEFING', {}, lines, () => { void refetchDec(); });

  const blocking = rollup.items.filter((i) => i.isBlocking && !DONE.has(i.status));
  const byOwner = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of blocking) {
      const k = i.owner?.trim() || '(소관 미지정)';
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko'));
  }, [blocking]);

  const external = rollup.items.filter((i) => i.type === 'EXTERNAL' && !DONE.has(i.status));
  const r = rollup.readiness;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 print:border-0 print:p-0 space-y-7 leading-relaxed">
      <header className="border-b border-gray-200 pb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">실서비스 개시 브리핑</p>
          <h2 className="text-2xl font-extrabold text-gray-900 mt-1.5">운영 전환 준비 현황</h2>
          <p className="text-[12px] text-gray-500 mt-1.5">
            기준 시각 <KDate value={new Date().toISOString()} mode="datetime" /> · 출처 go-live 레지스트리 · 결정 등록부
          </p>
        </div>
        <button onClick={() => void pr.start()} disabled={pr.issuing} data-print-issue-button
          className="print:hidden shrink-0 px-3 py-1.5 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-60">
          {pr.issuing ? '발급 중…' : '발급 후 인쇄 · PDF 저장'}
        </button>
      </header>
      {pr.bar}

      {/* 1. 준비도 — 하나의 숫자로 말하지 않는다 */}
      <section className="break-inside-avoid">
        <H n={1}>준비도 — 무엇을 근거로 센 숫자인가</H>
        {!r.computable || r.pct === null ? (
          <p className="text-[15px] text-gray-800">
            {/* 🔴 문구는 shared 정본이 만든다 — 화면마다 다시 적으면 갈라진다 */}
            <b className="text-gray-900">{RATIO_UNAVAILABLE}</b> — {r.basis}
          </p>
        ) : (
          <>
            <p className="text-[15px] text-gray-800">
              개시 필수 항목 <b>{r.total}</b>건 중 <b>{r.ready}</b>건 준비 완료 (<b>{r.pct}%</b>).
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label="시스템이 직접 확인" value={r.verifiedReady} total={r.total}
                note="설정·DB 를 읽어 확인한 것입니다." tone="emerald" />
              <Stat label="담당자 자가신고" value={r.selfReportedReady} total={r.total}
                note="🔴 시스템이 확인한 사실이 아닙니다 — 신고자의 진술입니다." tone={r.selfReportedReady > 0 ? 'amber' : 'gray'} />
            </div>
            <p className="mt-2.5 text-[12px] text-gray-500">
              🔴 두 근거를 합친 하나의 퍼센트만 보면 실제보다 준비된 것으로 읽힙니다. 그래서 갈라서 냅니다.
            </p>
          </>
        )}
      </section>

      {/* 2. 개시를 막는 것 — 소관별 */}
      <section className="break-inside-avoid">
        <H n={2}>개시를 막는 항목 — 누가 움직여야 하는가</H>
        {blocking.length === 0 ? (
          <p className="text-[15px] text-emerald-800 font-semibold">개시를 막는 필수 항목이 없습니다 ({rollup.blockingReady}/{rollup.blockingTotal} 준비 완료).</p>
        ) : (
          <>
            <p className="text-[14px] text-gray-800 mb-3">
              필수 <b>{rollup.blockingTotal}</b>건 중 <b>{blocking.length}</b>건이 남아 있습니다.
              {rollup.overdueCount > 0 && <span className="text-rose-700"> 목표일이 지난 항목 {rollup.overdueCount}건.</span>}
            </p>
            <div className="space-y-2.5">
              {byOwner.map(([owner, list]) => (
                <div key={owner} className="rounded-xl border border-gray-200 px-4 py-3 break-inside-avoid">
                  <p className="text-[13px] font-bold text-gray-900">
                    {owner} <span className="text-gray-400 font-medium">{list.length}건</span>
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {list.map((i) => (
                      <li key={i.key} className="text-[13px] text-gray-700">
                        · {i.title}
                        <span className="text-[11px] text-gray-400"> — {TYPE_KO[i.type] ?? i.type}</span>
                        {i.overdue && <span className="ml-1.5 text-[10px] font-bold text-rose-700">목표일 경과</span>}
                        {i.detail && <span className="block ml-3 text-[11px] text-gray-500">{i.detail}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 3. 외부 의존 — 우리가 못 정하는 것 */}
      <section className="break-inside-avoid">
        <H n={3}>외부 기관·업체에 달린 것</H>
        {external.length === 0 ? (
          <p className="text-[14px] text-gray-700">남아 있는 외부 의존 항목이 없습니다.</p>
        ) : (
          <>
            <p className="text-[14px] text-gray-800 mb-2">
              <b>{external.length}</b>건 — 원내 결정만으로 끝나지 않습니다. 상대 기관의 회신·발급·계약이 필요합니다.
            </p>
            <ul className="space-y-1">
              {external.map((i) => (
                <li key={i.key} className="text-[13px] text-gray-700">
                  · {i.title} <span className="text-[11px] text-gray-400">({i.owner ?? '소관 미지정'})</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[12px] text-gray-500">
              🔴 <b>미구현이 곧 결함은 아닙니다</b> — 기관 전송은 개시 시점에 개통하는 작업입니다. 다만 개시일을 잡으려면 리드타임을 먼저 받아야 합니다.
            </p>
          </>
        )}
      </section>

      {/* 4. 개시 전 반드시 필요한 사람 결정 */}
      <section className="break-inside-avoid">
        <H n={4}>개시 전 반드시 필요한 사람 결정</H>
        {decError ? (
          <p className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            결정 등록부를 불러오지 못했습니다 — <b>필요한 결정이 없다는 뜻이 아닙니다.</b> 개시 판단 전에 반드시 다시 확인하십시오.
          </p>
        ) : !decisions ? (
          <p className="text-[13px] text-gray-400">불러오는 중…</p>
        ) : requiredDecisions.length === 0 ? (
          <p className="text-[14px] text-gray-700">개시 전 필수로 표시된 결정 항목이 없습니다.</p>
        ) : (
          <>
            <p className="text-[14px] text-gray-800 mb-2">
              <b>{requiredDecisions.length}</b>건 중 기록됨 <b>{requiredDecisions.filter((d) => d.decided).length}</b>건.
              기술 항목이 모두 준비돼도 <b>이 결정 없이는 개시할 수 없습니다</b>.
            </p>
            {/* 🔴 개발 반영 결정은 의사결정만으로 끝나지 않는다 — 반영 대기·되돌림 필요를 따로 센다(기획 P2-4 · 확인 불가는 말한다) */}
            {decisions?.summary.devApply === null ? (
              <p className="text-[12px] text-gray-500 mb-2" data-golive-devapply="UNKNOWN">개발 반영 이행은 확인할 수 없습니다(이력 조회 실패).</p>
            ) : decisions?.summary.devApply && (
              <p className="text-[12px] text-gray-700 mb-2" data-golive-devapply>
                개시 전 필수 중 개발 반영 결정 <b>{decisions.summary.devApply.requiredBeforeGoLive.total}</b>건 — 반영 대기 <b>{decisions.summary.devApply.requiredBeforeGoLive.byStatus.PENDING_DEV}</b> ·
                되돌림 필요 <b className={decisions.summary.devApply.requiredBeforeGoLive.byStatus.REVERT_NEEDED ? 'text-rose-700' : ''}>{decisions.summary.devApply.requiredBeforeGoLive.byStatus.REVERT_NEEDED}</b> ·
                반영됨 {decisions.summary.devApply.requiredBeforeGoLive.byStatus.ENACTED} · 미결 {decisions.summary.devApply.requiredBeforeGoLive.byStatus.UNDECIDED}
              </p>
            )}
            <ul className="space-y-1.5">
              {requiredDecisions.map((d) => (
                <li key={d.key} className="text-[13px]">
                  <span className={d.decided ? 'text-gray-500 line-through' : 'text-gray-900 font-medium'}>{d.title}</span>
                  <span className="text-[11px] text-gray-400"> — {d.authority}</span>
                  {!d.decided && d.blockedBy.length > 0 && (
                    <span className="block ml-3 text-[11px] text-amber-800">
                      선행 대기: {d.blockedBy.map((b) => b.title).join(' · ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <footer className="border-t border-gray-200 pt-4">
        <p className="text-[11px] text-gray-500 leading-relaxed">
          🔴 이 문서는 <b>레지스트리에 등재된 것만</b> 셉니다 — 등재되지 않은 준비 사항은 여기 나오지 않습니다.
          🔴 <b>자가신고 항목은 시스템이 확인한 사실이 아닙니다.</b>
          🔴 운영 DB 는 현재 <b>가상 병원 시드 데이터</b>이며, 실환자 이관 전에는 모든 실측을 다시 확인해야 합니다.
        </p>
      </footer>
      {/* 🔴 인쇄는 화면을 찍지 않고 회의용 인쇄본으로(2026-10-12 — 종전엔 빈 종이) */}
      <GoLivePrint rollup={rollup} decisions={decisions?.items} decError={decError} {...pr.state} />
    </div>
  );
}

function H({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-extrabold text-gray-900 mb-2.5 flex items-center gap-2">
      <span className="w-5 h-5 rounded-md bg-gray-900 text-white text-[10px] flex items-center justify-center">{n}</span>
      {children}
    </h3>
  );
}

function Stat({ label, value, total, note, tone }: { label: string; value: number; total: number; note: string; tone: 'emerald' | 'amber' | 'gray' }) {
  const cls = tone === 'emerald' ? 'border-emerald-200 bg-emerald-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50';
  return (
    <div className={`rounded-xl border px-4 py-3 ${cls}`}>
      <p className="text-[11px] font-bold text-gray-600">{label}</p>
      <p className="text-xl font-extrabold text-gray-900 tabular-nums mt-0.5">
        {value}<span className="text-sm font-bold text-gray-400">/{total}</span>
      </p>
      <p className="text-[11px] text-gray-600 mt-0.5">{note}</p>
    </div>
  );
}
