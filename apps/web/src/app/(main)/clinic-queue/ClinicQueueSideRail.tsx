'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, Unit } from '@/components/ui/display';
import { usePollInterval } from '@/lib/ui-settings';
import { useQueueThresholds, waitTone, WAIT_TONE_TEXT } from '@/lib/queue-thresholds';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { DEPT_QUEUES, blockedDeptQueues, canFetchDeptQueue } from './queue-access';

/**
 * 진료실 대기 참조 레일 — 초광폭(1600px+) 우측 여백 활용(2026-08-04, 접수 데스크 레일과 같은 패턴).
 *
 * 이 화면의 곁눈 정보 3가지:
 *  - 부서 대기 한눈에: 검사실·영상실·약국 대기 수 — 종전엔 **탭을 눌러야만** 보였다(활성 탭만 배지).
 *    진료 중 "검사 보낼까/약국이 밀렸나"를 탭 전환 없이 판단. 클릭 시 해당 탭 전환.
 *  - 최장 대기 TOP: 본문 대기열은 번호순이라 오래 기다린 환자가 묻힌다 → 대기시간 내림차순 상위만.
 *  - 오늘 진행 요약: 완료·취소/노쇼·평균 진료시간(시작~완료 실측) — 회전 속도의 체감.
 */

interface QueueLike {
  id: string;
  queueNumber: number;
  status: string;
  checkedInAt: string;
  startedAt?: string;
  completedAt?: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
}

const CARD = 'rounded-2xl border border-gray-100 bg-white shadow-sm p-3';
const CARD_TITLE = 'text-[11px] font-bold text-gray-500 mb-2';

/** /lab|imaging|pharmacy/queue 도 이중 {data} 래핑 가능 — 배열/중첩 다 받는다 */
function unwrapList(res: unknown): unknown[] {
  const inner = (res as { data?: unknown })?.data;
  if (Array.isArray(inner)) return inner;
  const deeper = (inner as { data?: unknown })?.data;
  return Array.isArray(deeper) ? deeper : [];
}

/** 부서 큐 정의·역할 정본 = `./queue-access`(서버 @Roles 사본을 가드가 기계 대조) */
const DEPTS = DEPT_QUEUES;

export function ClinicQueueSideRail({ waiting, completed, cancelled, onGoDeptTab }: {
  waiting: QueueLike[];
  completed: QueueLike[];
  cancelled: QueueLike[];
  onGoDeptTab: (tab: 'lab' | 'imaging' | 'pharmacy') => void;
}) {
  const tt = useTAttr();
  const poll = usePollInterval('normal');
  const thresholds = useQueueThresholds(); // 임계 정본 = config clinical.queue.*(§7 P2)
  const role = useAuthStore((s) => s.user?.role);
  // 🔴 자기 역할이 받을 수 있는 큐만 부른다 — 못 부르는 것은 `enabled:false` 로 **아예 호출하지 않는다**
  //    (`.catch(()=>[])` 로 삼키면 403 이 "0건"이 되고 오류 폴백이 도달 불가 코드가 된다)
  const deptOpts = (i: number) => ({
    queryKey: ['rail-dept-queue', DEPTS[i].key],
    queryFn: () => apiClient.get(DEPTS[i].api),
    refetchInterval: poll,
    enabled: canFetchDeptQueue(role, DEPTS[i].key),
  });
  const deptQs = [useQuery(deptOpts(0)), useQuery(deptOpts(1)), useQuery(deptOpts(2))];
  const blocked = blockedDeptQueues(role);

  const now = Date.now();
  const waitMins = (q: QueueLike) => Math.round((now - new Date(q.checkedInAt).getTime()) / 60000);
  const longest = [...waiting].sort((a, b) => waitMins(b) - waitMins(a)).slice(0, 5);

  const durations = completed
    .filter((q) => q.startedAt && q.completedAt)
    .map((q) => (new Date(q.completedAt!).getTime() - new Date(q.startedAt!).getTime()) / 60000)
    .filter((m) => m >= 0);
  const avgConsult = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  return (
    <aside aria-label={tt('진료실 대기 참조 패널')} className="no-print hidden min-[1600px]:flex w-80 flex-shrink-0 flex-col gap-3 overflow-y-auto">
      <div className={CARD}>
        <p className={CARD_TITLE}><T k="부서 대기 한눈에" /></p>
        <div className="grid grid-cols-3 gap-1.5">
          {DEPTS.map((d, i) => {
            const q = deptQs[i];
            const allowed = canFetchDeptQueue(role, d.key);
            const n = unwrapList(q.data).length;
            // 🔴 권한이 없어 **묻지 않은 것**을 "0건"으로도 "오류"로도 말하지 않는다 — 자물쇠로 그린다
            if (!allowed) {
              return (
                <div key={d.key} title={`${d.whose} 권한이 있는 계정에만 표시됩니다 — 이 계정은 조회하지 않습니다`}
                  className="rounded-xl bg-gray-50 px-2 py-2 text-left opacity-70">
                  <p className="text-lg font-bold leading-tight text-gray-300">🔒</p>
                  <p className="text-[10px] font-medium text-gray-400">{d.icon} <T k={d.label} /></p>
                </div>
              );
            }
            // 🔴 조회 실패를 "0건"으로 말하지 않는다 — 모르는 것은 '-' 로 두고 재시도를 준다
            return (
              <button key={d.key} onClick={() => (q.isError ? q.refetch() : onGoDeptTab(d.key))}
                title={q.isError ? tt('대기 건수를 불러오지 못했습니다 — 눌러서 재시도') : undefined}
                className={`rounded-xl px-2 py-2 text-left transition-colors ${q.isError ? 'bg-red-50 hover:bg-red-100' : n > 0 ? 'bg-blue-50 hover:bg-blue-100' : 'bg-gray-50 hover:bg-gray-100'}`}>
                <p className={`text-lg font-bold tabular-nums leading-tight ${q.isError ? 'text-red-600' : n > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                  {q.isError ? '-' : <>{n}<Unit>건</Unit></>}
                </p>
                <p className="text-[10px] font-medium text-gray-500">{d.icon} <T k={d.label} /></p>
              </button>
            );
          })}
        </div>
        {/* 숨긴 것과 없는 것은 다르다 — 왜 자물쇠인지 밝힌다 */}
        {blocked.length > 0 && (
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
            🔒 {blocked.map((d) => d.label).join('·')} 대기는 {blocked.map((d) => d.whose).join('·')} 권한이 있는
            계정에만 표시됩니다 — 이 계정은 조회하지 않습니다(0건이라는 뜻이 아닙니다).
          </p>
        )}
        {deptQs.some((q) => q.isError) && (
          <QueryErrorFallback
            error={deptQs.find((q) => q.isError)?.error}
            onRetry={() => deptQs.forEach((q) => { if (q.isError) q.refetch(); })}
            size="compact"
            className="mt-2"
          />
        )}
      </div>

      <div className={CARD}>
        <p className={CARD_TITLE}><T k="최장 대기" /></p>
        {longest.length === 0 ? (
          <EmptyState compact icon="⏳" title="대기 환자 없음" />
        ) : longest.map((q) => {
          const m = waitMins(q);
          return (
            <div key={q.id} className="mb-1.5 last:mb-0 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0 pb-1.5 last:pb-0">
              <p className="text-xs text-gray-800 min-w-0 truncate">
                <span className="font-bold text-gray-400 mr-1">#{q.queueNumber}</span>
                <span className="font-medium">{`${q.patient?.familyName ?? ''}${q.patient?.givenName ?? ''}`.trim() || '-'}</span>
              </p>
              <p className={`text-xs font-bold tabular-nums flex-shrink-0 ${WAIT_TONE_TEXT[waitTone(m, thresholds)!] ?? 'text-gray-600'}`}>
                {m}<Unit>분</Unit>
              </p>
            </div>
          );
        })}
      </div>

      <div className={CARD}>
        <p className={CARD_TITLE}><T k="오늘 진행 요약" /></p>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-xl bg-emerald-50 px-2 py-1.5">
            <p className="text-lg font-bold tabular-nums text-emerald-700 leading-tight">{completed.length}<Unit>명</Unit></p>
            <p className="text-[10px] font-medium text-emerald-600 opacity-80"><T k="완료" /></p>
          </div>
          <div className="rounded-xl bg-amber-50 px-2 py-1.5">
            <p className="text-lg font-bold tabular-nums text-amber-700 leading-tight">{cancelled.length}<Unit>명</Unit></p>
            <p className="text-[10px] font-medium text-amber-600 opacity-80"><T k="취소·노쇼" /></p>
          </div>
          <div className="rounded-xl bg-gray-50 px-2 py-1.5">
            <p className="text-lg font-bold tabular-nums text-gray-700 leading-tight">{avgConsult ?? '-'}{avgConsult != null && <Unit>분</Unit>}</p>
            <p className="text-[10px] font-medium text-gray-500"><T k="평균 진료" /></p>
          </div>
        </div>
      </div>
    </aside>
  );
}
