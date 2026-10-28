'use client';

import { useQuery } from '@tanstack/react-query';
import { kdate } from '@/lib/ui-settings';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { PatientPushSettings } from './PatientPushSettings';
import { SmsChannelSettings } from './SmsChannelSettings';
import { EgressInventorySection, type EgressInventory } from './EgressInventorySection';

/**
 * 🔴 대외 발신 관제 — **밖으로 나가는 통로를 한 곳에서 본다.**
 *
 * 배경(2026-08-20 실측): 대외 전송 채널이 **7파일에 흩어져** 선언돼 있고, 어느 것이 실제로
 * 나가는지 한눈에 보는 화면이 없었다. 그래서 "보고했다/전송했다"는 기록이 코드 곳곳에서 따로 생겼고,
 * 실제로는 나가지 않는데 화면이 완료로 말하는 일이 반복됐다.
 *
 * 이 화면은 **판정하지 않는다** — 각 모듈의 채널 상수(`implemented`)와 운영 설정을 그대로 옮긴다.
 */
interface Channel {
  key: string; name: string; family: string; familyLabel: string;
  implemented: boolean | null;
  configKey: string | null;
  enabled: boolean | null;
  effective: boolean | null;
  blockedBy: 'NOT_IMPLEMENTED' | 'DISABLED_BY_CONFIG' | null;
  missingConfig: string[];
  manualFallback: string | null;
  source: string;
}

/** 🔴 3상태다 — 모르는 것을 "가능"으로 접지 않는다 */
function effectiveView(c: Channel): { label: string; cls: string; why: string } {
  if (c.effective === true) return { label: '발신됨', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', why: '구현됐고 설정도 켜져 있습니다' };
  if (c.effective === null) return { label: '판정 불가', cls: 'bg-gray-100 text-gray-600 border-gray-200', why: '구현 여부 또는 설정을 읽지 못했습니다 — 나간다고도, 안 나간다고도 말할 수 없습니다' };
  return c.blockedBy === 'NOT_IMPLEMENTED'
    ? { label: '미구현', cls: 'bg-red-50 text-red-700 border-red-200', why: '전송 코드가 없습니다 — 어떤 기록도 "전송 완료"를 적을 수 없습니다' }
    : { label: '설정으로 꺼짐', cls: 'bg-amber-50 text-amber-800 border-amber-200', why: '구현은 됐으나 운영 설정이 꺼져 있습니다' };
}

export default function OutboundChannelsPage() {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['outbound-channels'],
    queryFn: () => apiClient.get<{ data: { channels: Channel[]; measuredAt: string; caveat: string; egress?: EgressInventory } }>('/api/v1/admin/outbound-channels'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const payload = data?.data;
  const channels = payload?.channels ?? [];
  const families = [...new Set(channels.map((c) => c.familyLabel))];
  const sendable = channels.filter((c) => c.effective === true).length;
  const unknown = channels.filter((c) => c.effective === null).length;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="대외 발신 관제" /></h1>
        <p className="text-xs text-gray-500 mt-1">
          <T k="병원 밖으로 나가는 통로 — 메시지 채널·환자 앱 푸시. 구현 여부는 각 모듈의 채널 선언에서, 켜짐 여부는 운영 설정에서 읽습니다." />
          {/* 🔴 기관 전송을 여기서 뺀 사실을 밝힌다 — 안 보이는 것이 없는 것으로 읽히지 않게 */}
          {' '}<T k="법정 보고·청구는" /> <a href="/admin/agency-integrations" className="text-blue-600 hover:underline"><T k="기관 연동" /></a><T k="에서 따로 관리합니다." />
        </p>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-400 animate-pulse"><T k="불러오는 중…" /></div>
      ) : (
        <>
          {/* 🔴 분모를 함께 낸다 — "N개 발신 가능"만 적으면 나머지가 보이지 않는다 */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-700">
              {/* 🔴 보간 문장 — 조각으로 쪼개면 번역이 더 나빠진다(§공통규약 2). 한국어 원문 유지 */}
              통로 <b>{channels.length}</b>개 중 실제 발신 <b>{sendable}</b>개
              {unknown > 0 && <span className="text-gray-500"> · 판정 불가 {unknown}개</span>}
            </span>
            {payload?.measuredAt && (
              <span className="text-gray-400"><T k="기준" /> {kdate(payload.measuredAt, 'datetimeSec')}</span>
            )}
          </div>
          {payload?.caveat && <p className="text-[11px] text-gray-500">※ {payload.caveat}</p>}

          {/* 🔴 환자 앱 푸시는 설정으로 켜야 나간다 — 관제와 같은 화면에 둔다(켜는 자리와 보는 자리가 갈리지 않게) */}
          <PatientPushSettings />

          {/* 🔴 SMS 는 설정이 아니라 **구현**이 없어 막혀 있다 — 별도 설정 화면이 그 사실을 말한다 */}
          <SmsChannelSettings />

          {families.map((fam) => (
            <div key={fam} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-700">{fam}</p>
              </div>
              <div className="divide-y divide-gray-50">
                {channels.filter((c) => c.familyLabel === fam).map((c) => {
                  const v = effectiveView(c);
                  return (
                    <div key={c.key} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{c.name}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            <code>{c.key}</code> · <T k="근거" /> <code>{c.source}</code>
                            {c.configKey && <> · <T k="설정" /> <code>{c.configKey}</code></>}
                          </p>
                        </div>
                        {/* 색만으로 말하지 않는다 — 라벨 텍스트가 항상 함께 나간다(§4.6) */}
                        <span title={tAttr(v.why)} aria-label={`${c.name} ${tAttr(v.label)}`}
                          className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${v.cls}`}>
                          <T k={v.label} />
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1"><T k={v.why} /></p>
                      {/* 🔴 어느 설정이 비어서 막혔는지 그대로 보여준다 — "설정을 확인하세요"는 조치가 아니다 */}
                      {(c.missingConfig?.length ?? 0) > 0 && (
                        <p className="text-[11px] text-amber-800 mt-1">
                          <T k="비어 있는 설정" />: {c.missingConfig.map((k) => <code key={k} className="mx-0.5">{k}</code>)}
                        </p>
                      )}
                      {c.effective !== true && c.manualFallback && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mt-1.5">
                          <T k="사람이 대신 할 일" />: {c.manualFallback}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* 🔴 메시지 채널 밖의 서버 발 외부 호출 전체 — T10-4 데이터 소재지(판정 없음·목록화·동결) */}
          <EgressInventorySection egress={payload?.egress} />
        </>
      )}
    </div>
  );
}
