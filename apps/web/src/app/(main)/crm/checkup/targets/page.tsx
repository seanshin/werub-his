'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { EmptyState, Unit, genderText } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface FollowUp {
  id: string;
  followUpType: string;
  description: string;
  dueDate: string;
  reminderSent: boolean;
  completedAt: string | null;
  visit: {
    patient: { id: string; familyName: string; givenName: string; mrn: string; phone: string; dateOfBirth: string; gender: string };
    program: { name: string } | null;
  };
}

const FILTERS = ['전체', 'PENDING', 'COMPLETED'];
const FILTER_LABEL: Record<string, string> = { '전체': '전체', PENDING: '미완료', COMPLETED: '완료' };

export default function CheckupTargetsPage() {
  const tAttr = useTAttr();
  const [data, setData] = useState<FollowUp[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('전체');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (filter !== '전체') params.status = filter;
      const res = await apiClient.fetch<{ data: FollowUp[]; meta: { total: number } }>('/api/v1/crm/checkup/targets', { params });
      setData(res.data);
      setTotal(res.meta.total);
    } catch { /* */ }
    setLoading(false);
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);

  const calcAge = (dob: string) => {
    const d = new Date(dob);
    return new Date().getFullYear() - d.getFullYear();
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="검진 대상자 관리" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="검진 이상 소견 추적 및 리마인더 관리" /> ({total}<Unit>건</Unit>)</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '전체', count: total, bg: 'bg-white' },
          { label: '미완료', count: data.filter(d => !d.completedAt).length, bg: 'bg-amber-50', color: 'text-amber-700' },
          { label: '리마인더 발송', count: data.filter(d => d.reminderSent).length, bg: 'bg-blue-50', color: 'text-blue-700' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl border border-gray-100 p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color ?? 'text-gray-900'}`}>{s.count}</p>
            <p className="text-xs text-gray-500 mt-1"><T k={s.label} /></p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button key={f} onClick={() => { setFilter(f); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium rounded-xl ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <T k={FILTER_LABEL[f]} />
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-3 text-left"><T k="환자" /></th>
                <th className="px-4 py-3 text-left">MRN</th>
                <th className="px-4 py-3 text-center"><T k="나이/성별" /></th>
                <th className="px-4 py-3 text-left"><T k="프로그램" /></th>
                <th className="px-4 py-3 text-left"><T k="추적 유형" /></th>
                <th className="px-4 py-3 text-left"><T k="예정일" /></th>
                <th className="px-4 py-3 text-center"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map(item => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{item.visit.patient.familyName}{item.visit.patient.givenName}</td>
                  <td className="px-4 py-3 text-gray-500">{item.visit.patient.mrn}</td>
                  <td className="px-4 py-3 text-center text-gray-500">
                    {calcAge(item.visit.patient.dateOfBirth)}세/{genderText(item.visit.patient.gender)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{item.visit.program?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{item.followUpType}</td>
                  <td className="px-4 py-3 text-gray-500">{item.dueDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${item.completedAt ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      <T k={item.completedAt ? '완료' : '추적중'} />
                    </span>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan={7}><EmptyState icon="🔍" title="대상자가 없습니다" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > 20 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg disabled:opacity-30"><T k="이전" /></button>
          <span className="px-3 py-1.5 text-sm text-gray-500">{page} / {Math.ceil(total / 20)}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 20)}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg disabled:opacity-30"><T k="다음" /></button>
        </div>
      )}
    </div>
  );
}
