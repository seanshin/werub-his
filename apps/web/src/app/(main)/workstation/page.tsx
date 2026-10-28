'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { pollMs } from '@/lib/ui-settings';

/** 스테이션 태그 중 CT·MRI 등 언어중립 표기는 카탈로그에 등재하지 않는다(미등록 티 소음 방지) */
const hasKorean = (s: string) => /[가-힣]/.test(s);

interface StationSection {
  title: string;
  color: string;
  href: string;
  icon: string;
  stations: string[];
  queueEndpoint: string;
}

const SECTIONS: StationSection[] = [
  {
    title: '검사실',
    color: 'blue',
    href: '/workstation/lab',
    icon: '🔬',
    stations: ['채혈실', '혈액검사@검사실', '생화학검사', '소변검사', '미생물', '혈액은행', '병리'],
    queueEndpoint: '/api/v1/workstation/station/lab-hematology/queue',
  },
  {
    title: '영상실',
    color: 'indigo',
    href: '/workstation/imaging',
    icon: '📡',
    stations: ['일반촬영(X-ray)', 'CT', 'MRI', '초음파', '유방촬영', '중재시술', '핵의학'],
    queueEndpoint: '/api/v1/workstation/station/imaging-xray/queue',
  },
  {
    title: '기초검사',
    color: 'amber',
    href: '/workstation/diagnostic',
    icon: '💓',
    stations: ['심전도', '폐기능', '뇌파', '근전도', '청력', '내시경', '심장검사'],
    queueEndpoint: '/api/v1/workstation/station/diag-ecg/queue',
  },
  {
    title: '치료실',
    color: 'emerald',
    href: '/workstation/therapy',
    icon: '💪',
    stations: ['물리치료', '작업치료', '언어치료', '투석', '항암치료', '방사선치료'],
    queueEndpoint: '/api/v1/workstation/station/therapy-pt/queue',
  },
  {
    title: '판독 대기',
    color: 'violet',
    href: '/workstation/reading',
    icon: '📋',
    stations: ['영상 판독 대기열'],
    queueEndpoint: '/api/v1/workstation/imaging/reading-queue',
  },
  {
    title: '약국',
    color: 'emerald',
    href: '/workstation/pharmacy',
    icon: '💊',
    stations: ['조제', '투약', '약품 관리'],
    queueEndpoint: '/api/v1/workstation/station/pharmacy/queue',
  },
  {
    title: '간호',
    color: 'blue',
    href: '/workstation/nursing',
    icon: '🩺',
    stations: ['간호 업무', '바이탈', '투약'],
    queueEndpoint: '/api/v1/workstation/station/nursing/queue',
  },
  {
    title: '접수',
    color: 'amber',
    href: '/workstation/reception',
    icon: '🏥',
    stations: ['외래 접수', '원무'],
    queueEndpoint: '/api/v1/workstation/station/reception/queue',
  },
  {
    title: '입퇴원@워크스테이션',
    color: 'indigo',
    href: '/workstation/admission',
    icon: '🛏️',
    stations: ['입원', '퇴원'],
    queueEndpoint: '/api/v1/workstation/station/admission/queue',
  },
  {
    title: '수술',
    color: 'violet',
    href: '/workstation/surgery-prep',
    icon: '🔪',
    stations: ['수술 준비', '수술 후 회복'],
    queueEndpoint: '/api/v1/workstation/station/surgery-prep/queue',
  },
  {
    title: '응급/중환자',
    color: 'amber',
    href: '/workstation/emergency',
    icon: '🚨',
    stations: ['응급실', '트리아지', '중환자실'],
    queueEndpoint: '/api/v1/workstation/station/emergency/queue',
  },
  {
    title: '혈액/감염/멸균',
    color: 'blue',
    href: '/workstation/blood-bank',
    icon: '🩸',
    stations: ['혈액은행', '감염관리', '중앙공급'],
    queueEndpoint: '/api/v1/workstation/station/blood-bank/queue',
  },
  {
    title: '영양/장비/재활',
    color: 'emerald',
    href: '/workstation/nutrition',
    icon: '🍽️',
    stations: ['영양관리', '장비관리', '재활'],
    queueEndpoint: '/api/v1/workstation/station/nutrition/queue',
  },
];

const GRADIENT: Record<string, string> = {
  blue: 'from-blue-500 to-blue-600',
  indigo: 'from-indigo-500 to-indigo-600',
  amber: 'from-amber-500 to-amber-600',
  emerald: 'from-emerald-500 to-emerald-600',
  violet: 'from-violet-500 to-violet-600',
};

const ICON_BG: Record<string, string> = {
  blue: 'from-blue-100 to-blue-200 text-blue-700',
  indigo: 'from-indigo-100 to-indigo-200 text-indigo-700',
  amber: 'from-amber-100 to-amber-200 text-amber-700',
  emerald: 'from-emerald-100 to-emerald-200 text-emerald-700',
  violet: 'from-violet-100 to-violet-200 text-violet-700',
};

function useQueueCount(endpoint: string) {
  return useQuery({
    queryKey: ['ws-count', endpoint],
    queryFn: () =>
      apiClient
        .get<{ data: { status?: string }[] }>(endpoint)
        .then((res) => {
          const items = res?.data ?? [];
          const waiting = items.filter(
            (i) => i.status === 'ORDERED' || i.status === 'RECEIVED',
          ).length;
          const inProgress = items.filter(
            (i) => i.status === 'IN_PROGRESS',
          ).length;
          const completed = items.filter(
            (i) => i.status === 'COMPLETED',
          ).length;
          return { total: items.length, waiting, inProgress, completed };
        }),
    refetchInterval: pollMs('normal'),
  });
}

function MiniBar({
  waiting,
  inProgress,
  completed,
}: {
  waiting: number;
  inProgress: number;
  completed: number;
}) {
  const total = waiting + inProgress + completed;
  if (total === 0) return null;

  const wPct = (waiting / total) * 100;
  const iPct = (inProgress / total) * 100;
  const cPct = (completed / total) * 100;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 text-[10px] text-gray-500 mb-1">
        {waiting > 0 && <span><T k="대기" /> {waiting}</span>}
        {inProgress > 0 && <span><T k="진행" /> {inProgress}</span>}
        {completed > 0 && <span><T k="완료" /> {completed}</span>}
      </div>
      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden flex">
        {wPct > 0 && (
          <div
            className="bg-gray-400 h-full transition-all"
            style={{ width: `${wPct}%` }}
          />
        )}
        {iPct > 0 && (
          <div
            className="bg-amber-400 h-full transition-all"
            style={{ width: `${iPct}%` }}
          />
        )}
        {cPct > 0 && (
          <div
            className="bg-emerald-400 h-full transition-all"
            style={{ width: `${cPct}%` }}
          />
        )}
      </div>
    </div>
  );
}

function StationCard({ sec }: { sec: StationSection }) {
  const { data: counts, isError, error, refetch } = useQueueCount(sec.queueEndpoint);
  const waiting = counts?.waiting ?? 0;
  const inProgress = counts?.inProgress ?? 0;
  const completed = counts?.completed ?? 0;
  const total = counts?.total ?? 0;

  if (isError) return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <QueryErrorFallback error={error} onRetry={refetch} />
    </div>
  );

  return (
    <Link
      href={sec.href}
      className="group relative block bg-white border border-gray-200 rounded-2xl p-6 hover:shadow-lg hover:scale-[1.02] transition-all duration-200"
    >
      {/* 대기 건수 배지 */}
      {waiting > 0 && (
        <span className="absolute top-3 right-3 min-w-[24px] h-6 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
          {waiting}
        </span>
      )}

      <div className="flex items-center gap-3 mb-3">
        {/* 아이콘 그라데이션 배경 */}
        <div
          className={`w-10 h-10 rounded-xl bg-gradient-to-br ${ICON_BG[sec.color]} flex items-center justify-center text-lg`}
        >
          {sec.icon}
        </div>
        <div>
          <div
            className={`inline-block px-2.5 py-0.5 rounded-md text-white text-xs font-bold bg-gradient-to-r ${GRADIENT[sec.color]}`}
          >
            <T k={sec.title} />
          </div>
          {total > 0 && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              전체 {total}건
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {sec.stations.map((s) => (
          <span
            key={s}
            className="px-2 py-0.5 bg-gray-50 text-gray-500 rounded text-xs whitespace-nowrap"
          >
            {hasKorean(s) ? <T k={s} /> : s}
          </span>
        ))}
      </div>

      <MiniBar
        waiting={waiting}
        inProgress={inProgress}
        completed={completed}
      />

      <div className="mt-4 text-sm text-blue-600 font-medium group-hover:translate-x-1 transition-transform">
        <T k="열기" /> →
      </div>
    </Link>
  );
}

function SummaryItem({ sec }: { sec: StationSection }) {
  const { data, isLoading, isError } = useQueueCount(sec.queueEndpoint);
  const tAttr = useTAttr();

  // 🔴 종전 `count > 0 ? count : '-'` 는 **0 을 `-` 로 감췄다.**
  //    이 점검에서 반복한 원칙("모르는 것을 0으로 말하지 마라")의 정반대 잘못이다 —
  //    0 인 것을 "모른다"고 말한다. 대기가 없다는 것은 그 자체로 유용한 정보이고,
  //    `-` 는 **조회하지 못했을 때**를 위해 남겨야 구분이 선다.
  const count = isLoading || isError ? null : (data?.waiting ?? 0);

  return (
    <div className="text-center bg-white/5 rounded-xl py-3">
      <p className="text-2xl font-bold" title={isError ? tAttr('대기 건수를 불러오지 못했습니다') : undefined}>
        {count === null ? '-' : count}
      </p>
      <p className="text-xs text-slate-300 mt-0.5"><T k={sec.title} /> <T k="대기" /></p>
    </div>
  );
}

export default function WorkstationMainPage() {
  return (
    <div className="space-y-6">
      {/* 상단 요약 바 */}
      <div className="bg-gradient-to-r from-slate-700 to-slate-800 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold"><T k="워크스테이션" /></h1>
            <p className="text-sm text-slate-400 mt-0.5">
              <T k="각 검사실·영상실의 전용 작업 화면" />
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-block w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <T k="실시간 업데이트" />
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {SECTIONS.slice(0, 5).map((sec) => (
            <SummaryItem key={sec.title} sec={sec} />
          ))}
        </div>
      </div>

      {/* 카드 그리드 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((sec) => (
          <StationCard key={sec.title} sec={sec} />
        ))}
      </div>
    </div>
  );
}
