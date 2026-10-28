'use client';

import Link from 'next/link';
import { kdate } from '@/lib/ui-settings';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 기관 연동 관리 — 법정 보고·청구 채널을 **따로** 관리한다(2026-08-20 사람 결정).
 *
 * 발신 관제(`/admin/outbound-channels`)와 분리한 이유: 기관 전송은 성격이 다르다.
 * 법정 의무이고, 대외 계약·인증서가 선행하며, **실 서비스 개시 전까지 구현되어 있으면 된다.**
 * 🔴 그래서 지금 "미구현"은 **결함이 아니라 예정된 상태**다 — 그동안 신고·청구는 수기로 대체된다.
 * 화면이 이것을 빨간 경보로 그리면 진짜 경보가 묻힌다.
 *
 * 구현 여부는 각 모듈의 채널 상수에서, 담당·개시 추적은 **Go-Live 등록부**에서 온다(여기서 다시 적지 않는다).
 */
interface AgencyChannel {
  key: string; name: string;
  implemented: boolean | null;
  manualFallback: string | null;
  source: string;
  goLive: { key: string; title: string; owner: string | null; note: string | null; blocking: boolean } | null;
}

export default function AgencyIntegrationsPage() {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['agency-integrations'],
    queryFn: () => apiClient.get<{ data: { channels: AgencyChannel[]; measuredAt: string; caveat: string } }>('/api/v1/admin/agency-integrations'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const payload = data?.data;
  const channels = payload?.channels ?? [];
  const done = channels.filter((c) => c.implemented === true).length;
  const unknown = channels.filter((c) => c.implemented === null).length;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="기관 연동" /></h1>
        <p className="text-xs text-gray-500 mt-1">
          <T k="법정 보고·청구 기관으로 나가는 전송 채널. 발신 관제(메시지·환자 앱)와는 별도로 관리합니다 —" />{' '}
          <Link href="/admin/outbound-channels" className="text-blue-600 hover:underline"><T k="대외 발신 관제" /></Link>
        </p>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-400 animate-pulse"><T k="불러오는 중…" /></div>
      ) : (
        <>
          {/* 🔴 분모를 함께 · 미구현을 경보색으로 그리지 않는다(개시 전까지는 예정된 상태다) */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-700">
              채널 <b>{channels.length}</b>개 중 전송 구현 <b>{done}</b>개
              {unknown > 0 && <span className="text-gray-500"> · 판정 불가 {unknown}개</span>}
            </span>
            {payload?.measuredAt && (
              <span className="text-gray-400">기준 {kdate(payload.measuredAt, 'datetimeSec')}</span>
            )}
          </div>
          {payload?.caveat && (
            <p className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">※ {payload.caveat}</p>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {channels.map((c) => (
              <div key={c.key} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{c.name}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      <code>{c.key}</code> · <T k="근거" /> <code>{c.source}</code>
                    </p>
                  </div>
                  {/* 색만으로 말하지 않는다 — 라벨이 항상 함께 나간다(§4.6) */}
                  <span
                    title={c.implemented === true ? tAttr('전송 코드가 구현돼 있습니다') : c.implemented === null ? tAttr('코드에서 구현 여부를 읽지 못했습니다') : tAttr('개시 전까지 구현하면 됩니다 — 그동안은 수기로 대체합니다')}
                    aria-label={`${c.name} ${c.implemented === true ? tAttr('구현됨') : c.implemented === null ? tAttr('판정 불가') : tAttr('개시 전 구현 예정')}`}
                    className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
                      c.implemented === true ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : c.implemented === null ? 'bg-gray-100 text-gray-600 border-gray-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}>
                    <T k={c.implemented === true ? '구현됨' : c.implemented === null ? '판정 불가' : '개시 전 구현 예정'} />
                  </span>
                </div>

                {c.implemented !== true && c.manualFallback && (
                  <p className="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 mt-2">
                    <T k="그동안 사람이 할 일" />: {c.manualFallback}
                  </p>
                )}

                {/* 담당·개시 추적은 Go-Live 등록부가 정본 — 여기서 다시 적지 않고 연결만 한다 */}
                <p className="text-[11px] text-gray-500 mt-2">
                  {c.goLive ? (
                    <>
                      <T k="개시 항목" /> <Link href="/admin/go-live" className="text-blue-600 hover:underline">{c.goLive.title}</Link>
                      {c.goLive.owner && <> · <T k="담당@책임자" /> {c.goLive.owner}</>}
                      {c.goLive.blocking ? <> · <b><T k="개시 필수" /></b></> : <> · <T k="개시 선택" /></>}
                    </>
                  ) : (
                    // 🔴 추적되고 있다고 지어내지 않는다
                    <span className="text-amber-800"><T k="Go-Live 등록부에 등재되어 있지 않습니다 — 개시 추적에서 빠져 있습니다." /></span>
                  )}
                </p>
                {c.goLive?.note && <p className="text-[11px] text-gray-400 mt-1">{c.goLive.note}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
