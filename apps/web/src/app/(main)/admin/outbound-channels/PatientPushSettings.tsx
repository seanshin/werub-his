'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { Duration } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 환자 앱 푸시 설정 — **대외 발신은 여기서 켜야 나간다.**
 *
 * 정책(사람 지시 2026-08-20): 대외 발신은 **구현 + 설정 + 승인** 셋을 모두 만족할 때만 나간다.
 * 이 화면은 그중 **설정**이다. 승인(직원 옵트인)은 각 업무 화면의 다이얼로그가 담당한다.
 *
 * 🔴 판정은 **마스터 AND 타입별**이다 — 한쪽만 보면 "켰는데 안 나간다"가 된다.
 * 그래서 타입마다 `effective` 를 서버가 계산해 주고, 이 화면은 그것을 그대로 표시한다.
 */
interface PushType {
  type: string; label: string; configKey: string;
  enabled: boolean; effective: boolean;
  /** 켰는데 안 나가는 이유(서버 판정) — 옛 서버면 없음 */
  blockedBy?: 'MASTER_OFF' | 'THRESHOLD_UNSET' | null;
  /** 차례 임박만 — 기준 앞 인원(원내 정책 · null = 미설정) */
  threshold?: { key: string; aheadCount: number | null };
  requiresOptIn: boolean; quietHoursExempt: boolean; quietHoursNote?: string;
  dedupMinutes: number; alertCode: string;
}
interface PushSettings {
  master: { key: string; enabled: boolean };
  pushChannel: { available: boolean; note: string };
  quietHours: { key: string; startHour: number; endHour: number; timezone: string; nowKstHour: number; inQuietHoursNow: boolean; deferred: boolean };
  types: PushType[];
}

export function PatientPushSettings() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-push-settings'],
    queryFn: () => apiClient.get<{ data: PushSettings }>('/api/v1/notifications/patient-push/settings'),
  });

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => apiClient.put(`/api/v1/config/${key}`, { value }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['patient-push-settings'] });
      qc.invalidateQueries({ queryKey: ['outbound-channels'] });
      toast.success(`${tAttr('설정을 저장했습니다')} — ${v.key} = ${String(v.value)}`);
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tAttr('설정 저장에 실패했습니다.')),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  if (isLoading) return <div className="py-8 text-center text-gray-400 animate-pulse"><T k="설정을 불러오는 중…" /></div>;

  const s = data?.data;
  if (!s) return null;
  const on = s.types.filter((t) => t.effective).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-700"><T k="환자 앱 푸시" /></p>
          {/* 🔴 분모를 함께 낸다 */}
          <p className="text-[11px] text-gray-500 mt-0.5">
            {s.types.length}<T k="종 중" /> <b>{on}</b><T k="종이 실제로 나갑니다 · 판정은" /> <b><T k="마스터 AND 타입별" /></b><T k="입니다" />
          </p>
        </div>
        <button
          onClick={() => save.mutate({ key: s.master.key, value: !s.master.enabled })}
          disabled={save.isPending}
          aria-label={`${tAttr('마스터 스위치')} ${tAttr(s.master.enabled ? '켜짐' : '꺼짐')}`}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap disabled:opacity-50 ${
            s.master.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200'
          }`}>
          <T k="마스터" /> {s.master.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* 🔴 설정을 다 켜도 이 층이 꺼져 있으면 폰은 울리지 않는다 */}
      {!s.pushChannel.available && (
        <div className="mx-5 mt-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <T k="단말 푸시 불가" />: {s.pushChannel.note}
        </div>
      )}

      <div className="divide-y divide-gray-50">
        {s.types.map((t) => (
          <div key={t.type} className="px-5 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-gray-900">
                {t.label}
                {/* 🔴 마스터가 꺼져 있으면 타입을 켜도 안 나간다는 사실을 그 자리에서 말한다 */}
                {t.enabled && !t.effective && (
                  // 🔴 이유를 서버 판정대로 — 차례 임박은 마스터를 켜도 기준이 없으면 나가지 않는다(마스터 탓으로 말하지 않는다)
                  <span className="ml-1.5 text-[11px] text-amber-700" data-push-blocked={t.blockedBy ?? 'MASTER_OFF'}>
                    {t.blockedBy === 'THRESHOLD_UNSET'
                      ? <T k="— 켜져 있으나 차례 임박 기준(앞 인원)이 정해지지 않아 만들지 않습니다" />
                      : <T k="— 켜져 있으나 마스터가 꺼져 있어 나가지 않습니다" />}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                <code>{t.configKey}</code> · <T k="등록부" /> <code>{t.alertCode}</code> · <T k="중복 억제" /> <Duration minutes={t.dedupMinutes} dense />
                {t.requiresOptIn && <> · <b><T k="직원 승인 필요" /></b><T k="(화면에서 체크해야 발송)" /></>}
                {t.quietHoursExempt ? <> · <T k="야간 억제" /> <b><T k="예외" /></b>{t.quietHoursNote ? `(${t.quietHoursNote})` : ''}</> : <> · <T k="야간 억제 적용" /></>}
              </p>
              {t.threshold && (
                <p className="text-[11px] mt-0.5" data-push-threshold={t.threshold.aheadCount ?? 'UNSET'}>
                  {t.threshold.aheadCount != null
                    ? <span className="text-gray-600"><Tf k="기준: 앞 대기 {수}명 이하가 된 첫 순간 한 번" params={{ 수: t.threshold.aheadCount }} /></span>
                    : <span className="text-amber-700"><T k="기준 미설정 — 원내 정책으로 정한 뒤 시스템 설정에서 입력합니다" /> <code>{t.threshold.key}</code></span>}
                </p>
              )}
            </div>
            <button
              onClick={() => save.mutate({ key: t.configKey, value: !t.enabled })}
              disabled={save.isPending}
              aria-label={`${tAttr(t.label)} ${tAttr(t.enabled ? '켜짐' : '꺼짐')}`}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold border whitespace-nowrap disabled:opacity-50 ${
                t.effective ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : t.enabled ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-gray-100 text-gray-600 border-gray-200'
              }`}>
              {t.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 text-[11px] text-gray-600">
        <T k="야간 억제" /> {s.quietHours.startHour}<T k="시@단위" />~{s.quietHours.endHour}<T k="시@단위" />({s.quietHours.timezone}) ·
        <T k="지금" /> {s.quietHours.nowKstHour}<T k="시@단위" /> {s.quietHours.inQuietHoursNow ? <b className="text-amber-700"><T k="— 억제 시간대" /></b> : ''}
        {/* 🔴 억제는 지연이 아니라 미발송이다 — 나중에 오는 줄 알면 안 된다 */}
        {!s.quietHours.deferred && <span className="block text-amber-800 mt-0.5"><T k="억제된 알림은" /> <b><T k="나중에 보내지 않습니다" /></b><T k="(예약 큐 없음)." /></span>}
      </div>
    </div>
  );
}
