'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

interface Staff { familyName: string; givenName: string }
interface PatientRef { id: string; familyName: string; givenName: string; mrn: string }
interface MaliciousRow { patient: PatientRef; rubyCount: number; reasons: string[]; lastAt: string }
interface OtherRow { id: string; flagType: string; relation?: string; patient: PatientRef; flagger?: Staff | null; related?: Staff | null }

const sname = (u?: Staff | null) => u ? `${u.familyName}${u.givenName}` : '-';

export default function PatientFlagsAdminPage() {
  const [tab, setTab] = useState<'MALICIOUS' | 'VIP' | 'ACQUAINTANCE'>('MALICIOUS');
  const { data, isError, error, refetch } = useQuery({ queryKey: ['pflag-admin', tab], queryFn: () => apiClient.get<{ data: any }>(`/api/v1/patient-flags/list?type=${tab}`) });
  const d = (data?.data as { data?: any })?.data ?? data?.data ?? {};
  const malicious = (d.malicious ?? []) as MaliciousRow[];
  const items = (d.items ?? []) as OtherRow[];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="환자 마킹 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="악성(루비)·VIP·직원 지인 마킹 현황 (비표준 내부 표시)" /></p>
      </div>

      {/* 🔴 W8 — VIP 표식이 무엇을 하는지(그리고 무엇을 하지 않는지) 화면이 직접 말한다.
          종전에는 이 표식과 이상탐지가 서로 다른 원장을 봐서, VIP 로 찍어도 접근 경보가
          걸릴 수 있는 경로가 아예 없었다(정본이 둘). 지금은 같은 원장을 쓴다. */}
      {tab === 'VIP' && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          VIP 표식은 <b>이상탐지가 읽는 정본과 같은 원장</b>입니다 — 표식된 환자의 기록 열람이
          감지되면 30분 주기 점검에서 관리자에게 통보됩니다(같은 직원·환자 조합은 1회).
          악성(루비)·직원 지인 표식은 <b>경보 대상이 아니며 표시 용도</b>입니다.
        </div>
      )}
      <div className="flex gap-2 mb-6">
        {([['MALICIOUS', '💎 루비(악성)'], ['VIP', '⭐ VIP'], ['ACQUAINTANCE', '👥 직원 지인']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}><T k={l} /></button>
        ))}
      </div>

      {tab === 'MALICIOUS' ? (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-500"><th className="px-4 py-2.5 text-left"><T k="환자" /></th><th className="px-4 py-2.5 text-left"><T k="루비" /></th><th className="px-4 py-2.5 text-left"><T k="사유" /></th><th className="px-4 py-2.5 text-left"><T k="최근" /></th></tr></thead>
            <tbody>
              {isError ? <tr><td colSpan={4} className="px-4 py-3"><QueryErrorFallback error={error} onRetry={refetch} size="compact" /></td></tr>
               : malicious.length === 0 ? <tr><td colSpan={4} className="py-10 text-center text-gray-400 text-sm"><T k="마킹된 환자가 없습니다" /></td></tr> : malicious.map((m) => (
                <tr key={m.patient.id} className="border-b border-gray-50">
                  <td className="px-4 py-3"><Link href={`/patients/${m.patient.id}`} className="text-blue-600 hover:underline">{m.patient.familyName}{m.patient.givenName}</Link> <span className="text-gray-400 text-xs">{m.patient.mrn}</span></td>
                  <td className="px-4 py-3"><span className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">💎 {m.rubyCount}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-600">{m.reasons.slice(0, 3).join(' / ') || '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{kdate(new Date(m.lastAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-500"><th className="px-4 py-2.5 text-left"><T k="환자" /></th><th className="px-4 py-2.5 text-left"><T k={tab === 'VIP' ? '누구의 VIP' : '누구의 지인'} /></th><th className="px-4 py-2.5 text-left"><T k="관계" /></th><th className="px-4 py-2.5 text-left"><T k="표시한 직원" /></th></tr></thead>
            <tbody>
              {isError ? <tr><td colSpan={4} className="px-4 py-3"><QueryErrorFallback error={error} onRetry={refetch} size="compact" /></td></tr>
               : items.length === 0 ? <tr><td colSpan={4} className="py-10 text-center text-gray-400 text-sm"><T k="마킹이 없습니다" /></td></tr> : items.map((it) => (
                <tr key={it.id} className="border-b border-gray-50">
                  <td className="px-4 py-3"><Link href={`/patients/${it.patient.id}`} className="text-blue-600 hover:underline">{it.patient.familyName}{it.patient.givenName}</Link> <span className="text-gray-400 text-xs">{it.patient.mrn}</span></td>
                  <td className="px-4 py-3 text-gray-700">{sname(it.related)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500"><T k={it.relation === 'FAMILY' ? '가족' : it.relation === 'FRIEND' ? '지인' : it.relation ?? '-'} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{sname(it.flagger)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
