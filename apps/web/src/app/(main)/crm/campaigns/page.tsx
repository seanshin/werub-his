'use client';

import { useEffect, useState, useCallback } from 'react';
import { Unit } from '@/components/ui/display';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { CAMPAIGN_STATUS_LABEL } from '@hospital-run/shared';
import StatusBadge from '@/components/ui/StatusBadge';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Campaign {
  id: string;
  name: string;
  type: string;
  channel: string;
  status: string;
  targetCount: number;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  content: string;
  createdAt: string;
  segment?: { name: string } | null;
  template?: { name: string } | null;
}


const STATUS_LABEL = CAMPAIGN_STATUS_LABEL; // 정본(campaign)

const TYPE_LABEL: Record<string, string> = {
  REMINDER: '리마인더', RECALL: '리콜', PROMOTION: '프로모션',
  FOLLOW_UP: '후속관리', REENGAGEMENT: '재활성화', SURVEY: '설문', ANNOUNCEMENT: '공지',
};

export default function CampaignsPage() {
  /**
   * 🔴 캠페인 **발송**은 대외 발신이라 서버가 `@Roles(CRM_MANAGER, ADMIN)` 으로 승인 층을 뒀다
   *    (§규약 6: 대외 발신은 구현+설정+승인 셋이 모여야 나간다). 담당자에게는 조회·작성 화면이다.
   */
  const canSend = useHasRole('CRM_MANAGER');
  const tAttr = useTAttr();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (status) params.status = status;
      const res = await apiClient.fetch<{ data: Campaign[]; meta: { total: number } }>('/api/v1/crm/campaigns', { params });
      setCampaigns(res.data);
      setTotal(res.meta.total);
    } catch { /* */ }
    setLoading(false);
  }, [page, status]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form: { name: string; type: string; channel: string; content: string }) => {
    try {
      await apiClient.fetch('/api/v1/crm/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setShowCreate(false);
      load();
    } catch { /* */ }
  };

  const handleSend = async (id: string) => {
    if (!confirm('이 캠페인을 발송하시겠습니까?')) return;
    try {
      await apiClient.fetch(`/api/v1/crm/campaigns/${id}/send`, { method: 'POST' });
      load();
    } catch { /* */ }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="캠페인 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="멀티채널 캠페인 생성, 발송, 결과 분석" /> ({total}<Unit>건</Unit>)</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
          <T k="+ 새 캠페인" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체', count: total, bg: 'bg-violet-50' },
          { label: '발송 완료', count: campaigns.filter(c => c.status === 'COMPLETED').length, bg: 'bg-emerald-50' },
          // 목록 KPI 는 현재 페이지만 셈 — 총계는 서버 total(위 카드)과 모수가 다르다는 것을 라벨로 밝힌다
          { label: '총 발송(현재 페이지)', count: campaigns.reduce((s, c) => s + c.sentCount, 0).toLocaleString(), bg: 'bg-blue-50' },
          { label: '초안', count: campaigns.filter(c => c.status === 'DRAFT').length, bg: 'bg-gray-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl border border-gray-100 p-4 text-center`}>
            <p className="text-2xl font-bold text-gray-900">{s.count}</p>
            <p className="text-xs text-gray-500 mt-1"><T k={s.label} /></p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {['', 'DRAFT', 'SCHEDULED', 'COMPLETED', 'CANCELLED'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${status === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={s ? STATUS_LABEL[s] : '전체'} />
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
                <th className="px-4 py-3 text-left"><T k="캠페인" /></th>
                <th className="px-4 py-3 text-center"><T k="유형" /></th>
                <th className="px-4 py-3 text-center"><T k="채널" /></th>
                <th className="px-4 py-3 text-center"><T k="상태" /></th>
                <th className="px-4 py-3 text-right"><T k="대상" /></th>
                <th className="px-4 py-3 text-right"><T k="발송@집계" /></th>
                <th className="px-4 py-3 text-right"><T k="오픈" /></th>
                <th className="px-4 py-3 text-center"><T k="액션" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campaigns.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href = `/crm/campaigns/${c.id}`}>
                  <td className="px-4 py-3">
                    <Link href={`/crm/campaigns/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600">{c.name}</Link>
                    {c.segment && <p className="text-[10px] text-gray-400">{c.segment.name}</p>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500"><T k={TYPE_LABEL[c.type] ?? c.type} /></td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500">{c.channel}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge domain="campaign" status={c.status} className="text-[10px] font-bold whitespace-nowrap" />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{c.targetCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{c.sentCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{c.openedCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    {canSend && c.status === 'DRAFT' && (
                      <button onClick={() => handleSend(c.id)} className="text-xs text-blue-600 hover:underline"><T k="발송" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400"><T k="캠페인이 없습니다" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 생성 모달 */}
      {showCreate && <CreateCampaignModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
    </div>
  );
}

function CreateCampaignModal({ onClose, onCreate }: { onClose: () => void; onCreate: (f: { name: string; type: string; channel: string; content: string }) => void }) {
  const tAttr = useTAttr();
  const [form, setForm] = useState({ name: '', type: 'REMINDER', channel: 'SMS', content: '' });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg space-y-4">
        <h2 className="text-lg font-bold"><T k="새 캠페인 생성" /></h2>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder={tAttr('캠페인 이름')} className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
        <div className="grid grid-cols-2 gap-4">
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm">
            <option value="REMINDER">{tAttr('리마인더')}</option>
            <option value="RECALL">{tAttr('리콜')}</option>
            <option value="PROMOTION">{tAttr('프로모션')}</option>
            <option value="FOLLOW_UP">{tAttr('후속관리')}</option>
            <option value="SURVEY">{tAttr('설문')}</option>
            <option value="ANNOUNCEMENT">{tAttr('공지')}</option>
          </select>
          <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm">
            <option value="SMS">SMS</option>
            <option value="PUSH">Push</option>
            <option value="PORTAL">{tAttr('포털')}</option>
            <option value="EMAIL">{tAttr('이메일')}</option>
            <option value="ALL">{tAttr('전체 채널')}</option>
          </select>
        </div>
        <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          placeholder={tAttr('메시지 내용 ({{patientName}} 등 변수 사용 가능)')} rows={4}
          className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"><T k="취소" /></button>
          <button onClick={() => form.name && form.content && onCreate(form)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-30"
            disabled={!form.name || !form.content}><T k="생성" /></button>
        </div>
      </div>
    </div>
  );
}
