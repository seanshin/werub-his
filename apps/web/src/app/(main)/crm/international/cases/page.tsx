'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { INTL_CASE_STATUS_LABEL } from '@hospital-run/shared';
import StatusBadge from '@/components/ui/StatusBadge';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface ForeignCase {
  id: string;
  source: string;
  agencyName: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  interpreterLang: string | null;
  packageType: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
  status: string;
  satisfactionScore: number | null;
  note: string | null;
  patient: { id: string; familyName: string; givenName: string; mrn: string; nameEn: string | null; nationality: string | null; phone: string | null; preferredLanguage: string | null };
  assignee: { id: string; familyName: string; givenName: string };
}

const STATUS_FLOW = ['INQUIRY', 'QUOTED', 'CONFIRMED', 'ARRIVED', 'IN_TREATMENT', 'DISCHARGED', 'FOLLOW_UP', 'CLOSED'];
// 라벨=정본(intlCase)·필터칩 색만 로컬(선택 안 된 칩 배경 전용)
const CHIP_COLOR: Record<string, string> = {
  INQUIRY: 'bg-gray-100 text-gray-600', QUOTED: 'bg-amber-100 text-amber-700', CONFIRMED: 'bg-blue-100 text-blue-700',
  ARRIVED: 'bg-indigo-100 text-indigo-700', IN_TREATMENT: 'bg-violet-100 text-violet-700', DISCHARGED: 'bg-emerald-100 text-emerald-700',
  FOLLOW_UP: 'bg-teal-100 text-teal-700', CLOSED: 'bg-gray-200 text-gray-500',
};

const PKG_LABEL: Record<string, string> = {
  CHECKUP_BASIC: '건강검진 기본', CHECKUP_PREMIUM: '프리미엄 검진',
  TREATMENT: '진료/치료', SURGERY: '수술',
};

export default function InternationalCasesPage() {
  const tAttr = useTAttr();
  const [cases, setCases] = useState<ForeignCase[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (filter !== 'all') params.status = filter;
      const res = await apiClient.fetch<{ data: ForeignCase[]; meta: { total: number } }>('/api/v1/crm/international/cases', { params });
      setCases(res.data);
      setTotal(res.meta.total);
    } catch { /* */ }
    setLoading(false);
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="해외환자 케이스 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="문의 → 견적 → 확정 → 입국 → 진료 → 퇴원 → 사후관리" /> ({total}<Unit>건</Unit>)</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 케이스', count: total, bg: 'bg-white' },
          { label: '진행 중', count: cases.filter(c => !['CLOSED', 'FOLLOW_UP'].includes(c.status)).length, bg: 'bg-indigo-50' },
          { label: '사후관리', count: cases.filter(c => c.status === 'FOLLOW_UP').length, bg: 'bg-teal-50' },
          { label: '이번 달 입국', count: cases.filter(c => c.arrivalDate && c.arrivalDate.startsWith(new Date().toISOString().slice(0, 7))).length, bg: 'bg-emerald-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl border border-gray-100 p-4 text-center`}>
            <p className="text-2xl font-bold text-gray-900">{s.count}</p>
            <p className="text-xs text-gray-500 mt-1"><T k={s.label} /></p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => { setFilter('all'); setPage(1); }} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k="전체" /></button>
        {STATUS_FLOW.map(s => (
          <button key={s} onClick={() => { setFilter(s); setPage(1); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${filter === s ? 'bg-blue-600 text-white' : CHIP_COLOR[s] ?? 'bg-gray-100'}`}>
            <T k={INTL_CASE_STATUS_LABEL[s]} />
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="space-y-3">
          {cases.map(c => {
            const name = c.patient.nameEn || `${c.patient.familyName}${c.patient.givenName}`;
            return (
              <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <StatusBadge domain="intlCase" status={c.status} className="text-[10px] font-bold whitespace-nowrap" />
                    <span className="text-sm font-semibold text-gray-900">{name}</span>
                    <span className="text-xs text-gray-500">{c.patient.nationality} ({c.patient.preferredLanguage ?? '-'})</span>
                  </div>
                  <span className="text-xs text-gray-400"><T k="담당@케이스" />: {c.assignee.familyName}{c.assignee.givenName}</span>
                </div>
                <div className="grid grid-cols-5 gap-4 text-xs text-gray-600">
                  <div><span className="text-gray-400"><T k="유입" />:</span> {c.source}</div>
                  <div><span className="text-gray-400"><T k="에이전시" />:</span> {c.agencyName ?? '-'}</div>
                  <div><span className="text-gray-400"><T k="패키지" />:</span> {PKG_LABEL[c.packageType ?? ''] ? <T k={PKG_LABEL[c.packageType ?? '']} /> : c.packageType ?? '-'}</div>
                  <div><span className="text-gray-400"><T k="입국일" />:</span> {c.arrivalDate?.slice(0, 10) ?? '-'}</div>
                  <div><span className="text-gray-400"><T k="통역" />:</span> {c.interpreterLang ?? <T k="불필요" />}</div>
                </div>
                {c.note && <p className="text-xs text-gray-400 mt-2">{c.note}</p>}
              </div>
            );
          })}
          {cases.length === 0 && (
            <EmptyState icon="📋" title="등록된 케이스가 없습니다" />
          )}
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
