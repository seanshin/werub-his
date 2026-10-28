'use client';
import Link from 'next/link';
import ApiWidget from './ApiWidget';
import { T, Tf } from '@/components/ui/i18n-text';
import { Duration, Unit } from '@/components/ui/display';

/**
 * 접수 대기 현황 — `GET /api/v1/queue/stats`(오늘 · 서버가 "지금 대기"와 "도착 전 예약"을 가른다).
 *
 * 🔴 (2026-10-02 실화면) 원무·관리자 기본 배치에 '내 대기 환자'(`/queue/my` = 의사 본인 대기열)가 있었다 —
 *    원무에게는 서버가 403, 관리자에게는 담당 환자가 없으니 늘 "대기 중인 환자가 없습니다"였는데,
 *    같은 화면 상단 띠는 "대기 환자 260"이라 말했다(같은 화면 안의 모순).
 *    창구가 볼 것은 병원 접수 대기다 → 과별 대기 인원과, 대기시간을 **잴 수 있는지**를 함께 말한다.
 *    평균 대기는 표본(진료 시작 시각이 있는 건)이 있는 과만 — 없는 과를 0분이라 말하지 않는다.
 */
interface QueueStats {
  statusCounts?: Array<{ _count: number; departmentName: string | null; status: string }>;
  avgWaitMinutes?: Record<string, number>;
  waitSampleN?: number;
  waitUnmeasuredN?: number;
  waitingNow?: number;
  waitingScheduled?: number;
}

const MAX_DEPTS = 6;

export default function ReceptionQueueWidget() {
  return <ApiWidget widgetId="reception-queue" endpoint="/api/v1/queue/stats" refetchInterval={30000} render={(raw) => {
    const d = (raw ?? {}) as QueueStats;
    const byDept = new Map<string, number>();
    for (const r of d.statusCounts ?? []) {
      if (r.status !== 'WAITING') continue;
      const k = r.departmentName ?? '';
      byDept.set(k, (byDept.get(k) ?? 0) + r._count);
    }
    const depts = [...byDept.entries()].sort((a, b) => b[1] - a[1]);
    const avg = d.avgWaitMinutes ?? {};
    const sample = d.waitSampleN ?? 0;
    const total = sample + (d.waitUnmeasuredN ?? 0);
    return (
      <div className="flex h-full flex-col text-xs">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-gray-900"><T k="지금 대기" /> <b className="text-base tabular-nums">{d.waitingNow ?? '-'}</b><Unit>명</Unit></span>
          <span className="text-gray-500"><T k="도착 전 예약" /> {d.waitingScheduled ?? '-'}<Unit>명</Unit></span>
        </div>
        {depts.length === 0 ? <p className="text-gray-400"><T k="오늘 접수 대기 없음" /></p> : (
          <div>
            {depts.slice(0, MAX_DEPTS).map(([dept, n]) => (
              <div key={dept || '-'} className="flex items-center justify-between border-b border-gray-50 px-1 py-1 last:border-0">
                <span className="truncate text-gray-700">{dept || <T k="진료과 미상" />}</span>
                <span className="flex items-baseline gap-3 tabular-nums">
                  <span className="text-[11px] text-gray-400">{avg[dept] != null ? <><T k="평균" /> <Duration minutes={avg[dept]} dense /></> : null}</span>
                  <span className="w-10 text-right font-semibold text-gray-900">{n}<Unit>명</Unit></span>
                </span>
              </div>
            ))}
            {depts.length > MAX_DEPTS && <p className="px-1 pt-1 text-[11px] text-gray-400"><T k="외" /> {depts.length - MAX_DEPTS}<Unit>개 과</Unit></p>}
          </div>
        )}
        <p className="mt-2 text-[11px] text-gray-400">
          {sample > 0
            ? <Tf k="평균 대기는 진료 시작 기록이 있는 {표본}건 기준(오늘 접수 {전체}건)" params={{ 표본: sample, 전체: total }} />
            : <Tf k="대기시간을 잴 수 없음 — 오늘 접수 {전체}건 모두 진료 시작 기록 없음" params={{ 전체: total }} />}
        </p>
        <div className="mt-auto pt-2 text-[11px]"><Link href="/reception" className="text-blue-600 hover:underline"><T k="접수 화면" /></Link></div>
      </div>
    );
  }} />;
}
