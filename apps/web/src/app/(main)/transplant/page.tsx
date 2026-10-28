'use client';

import { Fragment, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';
import { T, Tf } from '@/components/ui/i18n-text';
import { TransplantTdmPanel } from './transplant-tdm';

const TABS = [
  { key: 'waitlist', label: '대기자 관리', icon: '⏳' },
  { key: 'donors', label: '기증자 관리', icon: '🤝' },
  { key: 'records', label: '이식 기록', icon: '📋' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const ORGAN_LABEL: Record<string, string> = { KIDNEY: '신장', LIVER: '간', HEART: '심장', LUNG: '폐', PANCREAS: '췌장', CORNEA: '각막' };
const ORGAN_ICON: Record<string, string> = { KIDNEY: '🫘', LIVER: '🫁', HEART: '❤️', LUNG: '🫁', PANCREAS: '🔬', CORNEA: '👁️' };
const URGENCY_COLOR: Record<string, string> = { EMERGENCY: 'bg-red-100 text-red-700', URGENT: 'bg-amber-100 text-amber-700', ROUTINE: 'bg-gray-100 text-gray-600' };
const STATUS_COLOR: Record<string, string> = { WAITING: 'bg-blue-100 text-blue-700', MATCHED: 'bg-amber-100 text-amber-700', TRANSPLANTED: 'bg-emerald-100 text-emerald-700', REMOVED: 'bg-gray-200 text-gray-600' };

function fmtDate(d?: string) { return d ? kdate(d) : '-'; }

interface WaitlistItem { id: string; organType: string; bloodType: string; urgency: string; pra?: number; konosId?: string; status: string; registeredAt: string; patient?: { id?: string; familyName?: string; givenName?: string; mrn?: string } }
interface DonorItem { id: string; donorType: string; donorName?: string; relationship?: string; bloodType: string; organType: string; crossmatchResult?: string; status: string; donorPatient?: { familyName?: string; givenName?: string } }
interface TransplantItem { id: string; organType: string; transplantDate: string; outcome: string; graftFunction?: string; recipient?: { familyName?: string; givenName?: string; mrn?: string }; donor?: { donorType: string; donorName?: string }; surgeon?: { familyName?: string; givenName?: string }; _count?: { rejectionEvents: number } }
interface Stats { totalWaiting: number; totalTransplants: number; activeRejections: number; waitingByOrgan: { organType: string; _count: { id: number } }[] }

export default function TransplantPage() {
  const [tab, setTab] = useState<TabKey>('waitlist');

  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['transplant-stats'],
    queryFn: () => apiClient.get<{ data: Stats }>('/api/v1/transplant/stats'),
  });
  const stats = statsData?.data as Stats | null;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="장기이식 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="대기자 · 기증자 · 이식 기록 · 거부반응 모니터링" /></p>
      </div>

      {/* 🔴 통계 조회 실패로 카드가 사라지면 "대기자·거부반응 없음"으로 읽힌다 */}
      {statsIsError && <div className="mb-6"><QueryErrorFallback error={statsError} onRetry={refetchStats} size="compact" /></div>}
      {!statsIsError && stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="대기자" /></p><p className="text-2xl font-bold text-blue-700">{stats.totalWaiting}</p></div>
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="총 이식" /></p><p className="text-2xl font-bold text-emerald-700">{stats.totalTransplants}</p></div>
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="거부반응" /></p><p className="text-2xl font-bold text-red-700">{stats.activeRejections}</p></div>
          <div className="bg-white rounded-2xl border p-5">
            <p className="text-xs text-gray-500 mb-1"><T k="장기별 대기" /></p>
            <div className="flex flex-wrap gap-1">
              {stats.waitingByOrgan.map(w => (
                <span key={w.organType} className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded whitespace-nowrap">{ORGAN_ICON[w.organType] ?? ''} <T k={ORGAN_LABEL[w.organType] ?? w.organType} /> {w._count.id}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-6">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${tab === t.key ? 'bg-teal-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            <span>{t.icon}</span> <T k={t.label} />
          </button>
        ))}
      </div>

      {tab === 'waitlist' && <WaitlistTab />}
      {tab === 'donors' && <DonorsTab />}
      {tab === 'records' && <RecordsTab />}
    </div>
  );
}

function WaitlistTab() {
  const qc = useQueryClient();
  const [organFilter, setOrganFilter] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transplant-waitlist', organFilter],
    queryFn: () => apiClient.get<{ data: WaitlistItem[] }>(`/api/v1/transplant/waitlist${organFilter ? `?organType=${organFilter}` : ''}`),
  });
  const items = (Array.isArray(data?.data) ? data.data : []) as WaitlistItem[];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {['', ...Object.keys(ORGAN_LABEL)].map(o => (
          <button key={o} onClick={() => setOrganFilter(o)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${organFilter === o ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {o ? <>{ORGAN_ICON[o] ?? ''} <T k={ORGAN_LABEL[o]} /></> : <T k="전체" />}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 border-b text-xs text-gray-500">
            <th className="px-4 py-2.5 text-left"><T k="환자" /></th>
            <th className="px-4 py-2.5 text-left"><T k="장기" /></th>
            <th className="px-4 py-2.5 text-center"><T k="혈액형" /></th>
            <th className="px-4 py-2.5 text-center">PRA</th>
            <th className="px-4 py-2.5 text-left"><T k="긴급도" /></th>
            <th className="px-4 py-2.5 text-left">KONOS</th>
            <th className="px-4 py-2.5 text-left"><T k="상태" /></th>
            <th className="px-4 py-2.5 text-left"><T k="등록일" /></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="로딩 중..." /></td></tr> :
             items.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="대기자가 없습니다" /></td></tr> :
             items.map(w => (
              <tr key={w.id} className="hover:bg-gray-50">
                <td className="px-4 py-3"><p className="font-medium">{w.patient?.familyName}{w.patient?.givenName}</p><p className="text-[10px] text-gray-400">{w.patient?.mrn}</p></td>
                <td className="px-4 py-3 text-xs">{ORGAN_ICON[w.organType] ?? ''} <T k={ORGAN_LABEL[w.organType] ?? w.organType} /></td>
                <td className="px-4 py-3 text-center text-xs font-bold text-red-600">{w.bloodType}</td>
                <td className="px-4 py-3 text-center text-xs">{w.pra != null ? `${w.pra}%` : '-'}</td>
                <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${URGENCY_COLOR[w.urgency]}`}>{w.urgency}</span></td>
                <td className="px-4 py-3 text-xs font-mono text-gray-500">{w.konosId ?? '-'}</td>
                <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[w.status]}`}>{w.status}</span></td>
                <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(w.registeredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DonorsTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transplant-donors'],
    queryFn: () => apiClient.get<{ data: DonorItem[] }>('/api/v1/transplant/donors'),
  });
  const donors = (Array.isArray(data?.data) ? data.data : []) as DonorItem[];
  // 🔴 (2026-10-10) 조회 실패를 "등록된 기증자가 없습니다"로 말하지 않는다
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="bg-gray-50 border-b text-xs text-gray-500">
          <th className="px-4 py-2.5 text-left"><T k="기증자" /></th>
          <th className="px-4 py-2.5 text-left"><T k="유형" /></th>
          <th className="px-4 py-2.5 text-left"><T k="장기" /></th>
          <th className="px-4 py-2.5 text-center"><T k="혈액형" /></th>
          <th className="px-4 py-2.5 text-left"><T k="관계" /></th>
          <th className="px-4 py-2.5 text-left"><T k="교차시험" /></th>
          <th className="px-4 py-2.5 text-left"><T k="상태" /></th>
        </tr></thead>
        <tbody className="divide-y divide-gray-50">
          {isLoading ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="로딩 중..." /></td></tr> :
           donors.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="등록된 기증자가 없습니다" /></td></tr> :
           donors.map(d => (
            <tr key={d.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium">{d.donorPatient ? `${d.donorPatient.familyName}${d.donorPatient.givenName}` : d.donorName ?? '-'}</td>
              <td className="px-4 py-3 text-xs"><T k={d.donorType === 'LIVING' ? '생체' : d.donorType === 'DECEASED' ? '뇌사' : '사체'} /></td>
              <td className="px-4 py-3 text-xs">{ORGAN_ICON[d.organType] ?? ''} <T k={ORGAN_LABEL[d.organType] ?? d.organType} /></td>
              <td className="px-4 py-3 text-center text-xs font-bold text-red-600">{d.bloodType}</td>
              <td className="px-4 py-3 text-xs">{d.relationship ?? '-'}</td>
              <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.crossmatchResult === 'NEGATIVE' ? 'bg-emerald-100 text-emerald-700' : d.crossmatchResult === 'POSITIVE' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{d.crossmatchResult ?? <T k="미시행" />}</span></td>
              <td className="px-4 py-3 text-xs">{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordsTab() {
  const [tdmFor, setTdmFor] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transplant-records'],
    queryFn: () => apiClient.get<{ data: TransplantItem[] }>('/api/v1/transplant/records'),
  });
  const records = (Array.isArray(data?.data) ? data.data : []) as TransplantItem[];
  // 🔴 (2026-10-10) 조회 실패를 "이식 기록이 없습니다"로 말하지 않는다
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="bg-gray-50 border-b text-xs text-gray-500">
          <th className="px-4 py-2.5 text-left"><T k="수혜자" /></th>
          <th className="px-4 py-2.5 text-left"><T k="장기" /></th>
          <th className="px-4 py-2.5 text-left"><T k="기증자" /></th>
          <th className="px-4 py-2.5 text-left"><T k="집도의" /></th>
          <th className="px-4 py-2.5 text-left"><T k="이식일" /></th>
          <th className="px-4 py-2.5 text-left"><T k="결과" /></th>
          <th className="px-4 py-2.5 text-center"><T k="거부반응" /></th>
          <th className="px-4 py-2.5 text-center">TDM</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-50">
          {isLoading ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="로딩 중..." /></td></tr> :
           records.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="이식 기록이 없습니다" /></td></tr> :
           records.map(r => (
            <Fragment key={r.id}>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3"><p className="font-medium">{r.recipient?.familyName}{r.recipient?.givenName}</p><p className="text-[10px] text-gray-400">{r.recipient?.mrn}</p></td>
              <td className="px-4 py-3 text-xs">{ORGAN_ICON[r.organType] ?? ''} <T k={ORGAN_LABEL[r.organType] ?? r.organType} /></td>
              <td className="px-4 py-3 text-xs">{r.donor?.donorName ?? r.donor?.donorType ?? '-'}</td>
              <td className="px-4 py-3 text-xs">{r.surgeon?.familyName}{r.surgeon?.givenName}</td>
              <td className="px-4 py-3 text-xs">{fmtDate(r.transplantDate)}</td>
              <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.outcome === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{r.outcome}</span></td>
              <td className="px-4 py-3 text-center text-xs">{(r._count?.rejectionEvents ?? 0) > 0 ? <span className="text-red-600 font-bold">{r._count?.rejectionEvents}<Unit>건</Unit></span> : '-'}</td>
              <td className="px-4 py-3 text-center">
                <button type="button" onClick={() => setTdmFor(tdmFor === r.id ? null : r.id)} aria-expanded={tdmFor === r.id}
                  className="text-[11px] text-teal-700 hover:underline"><T k={tdmFor === r.id ? '닫기' : '보기·기록'} /></button>
              </td>
            </tr>
            {tdmFor === r.id && <tr className="bg-gray-50/60"><td colSpan={8} className="px-6 py-4"><TransplantTdmPanel recordId={r.id} /></td></tr>}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
