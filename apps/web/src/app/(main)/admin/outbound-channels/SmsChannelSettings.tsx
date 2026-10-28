'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 SMS 채널 설정 — **설정을 저장해도 지금은 발송되지 않는다.**
 *
 * 실측(2026-08-20): `CrmChannelService.providers` 에 `'SMS'` 가 **등록돼 있지 않다.**
 * `send('SMS', …)` 는 `{ success: true, simulated: true }` 로 돌아온다 —
 * 즉 **성공처럼 보이지만 아무것도 나가지 않는다**. 환자 로그인 OTP 가 이 경로를 쓰므로
 * 인증번호가 **서버 로그에만** 남는다(실환자 개시 불가).
 *
 * 그래서 이 화면은 **켜는 화면이 아니라 무엇이 막고 있는지 보여주는 화면**이다.
 * 계약·발신번호는 **기록만** 하고, 발송 가능 여부는 코드 구현에 달려 있다고 그 자리에서 말한다.
 * 🔴 켤 수 없는 것을 켤 수 있는 것처럼 보이게 하면 가짜 게이트가 된다.
 */
interface Channel { key: string; implemented: boolean | null; enabled: boolean | null; missingConfig: string[] }

export function SmsChannelSettings() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [provider, setProvider] = useState('');
  const [sender, setSender] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sms-channel-settings'],
    queryFn: async () => {
      const [ch, p, sdr, dec] = await Promise.all([
        apiClient.get<{ data: { channels: Channel[] } }>('/api/v1/admin/outbound-channels'),
        apiClient.get<{ data: unknown }>('/api/v1/config/sms.provider'),
        apiClient.get<{ data: unknown }>('/api/v1/config/sms.senderNumber'),
        apiClient.get<{ data: { items: Array<{ key: string; decided: boolean; record: { choice: string } | null }> } }>('/api/v1/admin/decisions'),
      ]);
      return {
        sms: ch?.data?.channels?.find((c) => c.key === 'SMS') ?? null,
        provider: typeof p?.data === 'string' ? p.data : '',
        sender: typeof sdr?.data === 'string' ? sdr.data : '',
        entrustment: dec?.data?.items?.find((i) => i.key === 'legal.sms.entrustment') ?? null,
      };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      await apiClient.put('/api/v1/config/sms.provider', { value: provider.trim() });
      await apiClient.put('/api/v1/config/sms.senderNumber', { value: sender.trim() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-channel-settings'] });
      qc.invalidateQueries({ queryKey: ['outbound-channels'] });
      // 🔴 "저장했습니다"만 띄우면 켜진 줄 안다 — 실제 상태를 함께 말한다
      toast.warning(tAttr('설정을 저장했습니다 — 다만 제공자 코드가 없어 아직 발송되지 않습니다.'));
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tAttr('설정 저장에 실패했습니다.')),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  if (isLoading) return <div className="py-8 text-center text-gray-400 animate-pulse"><T k="SMS 설정을 불러오는 중…" /></div>;

  const d = data;
  const contracted = d?.entrustment?.record?.choice === 'CONTRACTED';
  const codeReady = d?.sms?.implemented === true;
  const configReady = !!d?.provider && !!d?.sender;

  /** 🔴 셋을 모두 만족해야 나간다 — 하나만 보고 "설정했다"고 말하지 않는다 */
  const steps = [
    { ok: contracted, label: '위탁계약(허가권자 결정)', how: '/admin/decisions 의 「SMS 개인정보 처리위탁 계약」에 근거 문서와 함께 기록' },
    { ok: codeReady, label: '제공자 코드 구현', how: '🔴 개발 작업 — 이 화면이 켜지 못합니다(CrmChannelService 에 SMS 제공자 없음)' },
    { ok: configReady, label: '제공자·발신번호 설정', how: '아래에서 기록합니다(사전등록된 발신번호)' },
  ];
  const done = steps.filter((x) => x.ok).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-700"><T k="문자(SMS) 채널" /></p>
        {/* 🔴 분모를 함께 */}
        <p className="text-[11px] text-gray-500 mt-0.5"><T k="발송 조건" /> <b>{done}</b>/3 <T k="충족 · 환자 로그인 OTP 가 이 채널을 씁니다" /></p>
      </div>

      {!codeReady && (
        <div className="mx-5 mt-3 text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          🔴 <T k="지금은" /> <b><T k="설정을 저장해도 문자가 나가지 않습니다" /></b> <T k="— 제공자 코드가 구현되어 있지 않습니다." />
          {' '}<T k="그동안 인증번호는" /> <b><T k="서버 로그에만" /></b> <T k="남습니다(실환자 개시 불가)." />
        </div>
      )}

      <ul className="px-5 py-3 space-y-1.5">
        {steps.map((x) => (
          <li key={x.label} className="text-xs flex items-start gap-2">
            <span aria-label={x.ok ? tAttr('충족') : tAttr('미충족')}
              className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full border ${x.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
              {x.ok ? <T k="충족" /> : <T k="미충족" />}
            </span>
            <span className="text-gray-800"><T k={x.label} /><span className="block text-[11px] text-gray-500"><T k={x.how} /></span></span>
          </li>
        ))}
      </ul>

      <div className="px-5 pb-4 space-y-2">
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-gray-600"><T k="제공자명" /> {d?.provider && <span className="text-gray-400">(<T k="현재" /> {d.provider})</span>}</span>
            <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder={tAttr('예: 알리고 · NHN Toast')}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-600"><T k="발신번호" /> {d?.sender && <span className="text-gray-400">(<T k="현재" /> {d.sender})</span>}</span>
            <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder={tAttr('사전등록된 번호')}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => save.mutate()} disabled={save.isPending || (!provider.trim() && !sender.trim())}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {save.isPending ? <T k="저장 중…" /> : <T k="설정 기록" />}
          </button>
          <Link href="/admin/decisions" className="text-xs text-blue-600 hover:underline"><T k="위탁계약 결정 기록하기" /></Link>
        </div>
        {(d?.sms?.missingConfig?.length ?? 0) > 0 && (
          <p className="text-[11px] text-amber-800"><T k="비어 있는 설정:" /> {d!.sms!.missingConfig.map((k) => <code key={k} className="mx-0.5">{k}</code>)}</p>
        )}
      </div>
    </div>
  );
}
