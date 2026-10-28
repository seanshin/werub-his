'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import StatusBadge from '@/components/ui/StatusBadge';

import { EmptyState, Unit } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { CampaignLogsPanel } from './CampaignLogsPanel';

interface Campaign {
  id: string; name: string; type: string; channel: string; status: string;
  content: string; subject: string | null;
  targetCount: number; sentCount: number; deliveredCount: number;
  openedCount: number; clickedCount: number; conversionCount: number; failedCount: number;
  abTestEnabled: boolean; abVariantName: string | null;
  createdAt: string; sentAt: string | null; completedAt: string | null;
  segment: { name: string } | null; template: { name: string } | null;
}

interface AbResult {
  id: string; name: string; abVariantName: string | null;
  sentCount: number; openedCount: number; clickedCount: number; conversionCount: number;
  openRate: number; clickRate: number; conversionRate: number;
}

interface SegRec { id: string; name: string; patientCount: number; reason: string }
interface ContentGen { subject: string; content: string; variables: string[] }


export default function CampaignDetailPage() {
  const params = useParams();
  const tAttr = useTAttr();
  const id = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [abResults, setAbResults] = useState<AbResult[]>([]);
  const [segRecs, setSegRecs] = useState<SegRec[]>([]);
  const [generated, setGenerated] = useState<ContentGen | null>(null);
  const [loading, setLoading] = useState(true);
  const [abForm, setAbForm] = useState({ variantContent: '', splitRatio: 50 });
  const [showAbCreate, setShowAbCreate] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiClient.fetch<{ data: Campaign }>(`/api/v1/crm/campaigns/${id}`)
      .then(r => {
        setCampaign(r.data);
        // A/B 결과 로드
        if (r.data.abTestEnabled) {
          apiClient.fetch<{ data: AbResult[] }>(`/api/v1/crm/campaigns/${id}/ab-results`)
            .then(ab => setAbResults(ab.data)).catch(() => {});
        }
        // 세그먼트 추천
        apiClient.fetch<{ data: { segments: SegRec[] } }>(`/api/v1/crm/ai/recommend-segment?type=${r.data.type}`)
          .then(sr => setSegRecs(sr.data.segments)).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleGenerate = async () => {
    if (!campaign) return;
    try {
      const res = await apiClient.fetch<{ data: ContentGen }>('/api/v1/crm/ai/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignType: campaign.type, channel: campaign.channel }),
      });
      setGenerated(res.data);
    } catch { /* */ }
  };

  const handleCreateAb = async () => {
    if (!abForm.variantContent) return;
    try {
      await apiClient.fetch(`/api/v1/crm/campaigns/${id}/ab-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(abForm),
      });
      setShowAbCreate(false);
      // 새로고침
      const r = await apiClient.fetch<{ data: Campaign }>(`/api/v1/crm/campaigns/${id}`);
      setCampaign(r.data);
      const ab = await apiClient.fetch<{ data: AbResult[] }>(`/api/v1/crm/campaigns/${id}/ab-results`);
      setAbResults(ab.data);
    } catch { /* */ }
  };

  if (loading) return <div className="flex justify-center py-24"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  if (!campaign) return <div className="p-6 text-center text-gray-400"><T k="캠페인을 찾을 수 없습니다" /></div>;

  const openRate = campaign.sentCount > 0 ? Math.round((campaign.openedCount / campaign.sentCount) * 100) : 0;
  const clickRate = campaign.sentCount > 0 ? Math.round((campaign.clickedCount / campaign.sentCount) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
          <StatusBadge domain="campaign" status={campaign.status} className="text-[10px] font-bold whitespace-nowrap" />
          {campaign.abVariantName && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-100 text-violet-700">A/B {campaign.abVariantName}</span>}
        </div>
        <p className="text-sm text-gray-500 mt-1">{campaign.type} / {campaign.channel} {campaign.segment ? `/ ${campaign.segment.name}` : ''}</p>
      </div>

      {/* 성과 지표 */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: '대상', value: campaign.targetCount },
          { label: '발송@집계', value: campaign.sentCount },
          // 🔴 도달은 발송 콜백/웹훅이 있어야 아는 별개 사실이다 — 확인 경로가 없으면 '확인 불가'
          { label: '전달 확인', value: campaign.deliveredCount > 0 ? campaign.deliveredCount : <T k="확인 불가" /> },
          { label: '오픈', value: `${campaign.openedCount} (${openRate}%)` },
          { label: '클릭', value: `${campaign.clickedCount} (${clickRate}%)` },
          { label: '실패', value: campaign.failedCount, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-gray-50 rounded-xl p-3 text-center">
            <p className={`text-lg font-bold ${(s as { color?: string }).color ?? 'text-gray-900'}`}>{s.value}</p>
            <p className="text-[10px] text-gray-500"><T k={s.label} /></p>
          </div>
        ))}
      </div>

      {/* 콘텐츠 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-700 mb-2"><T k="메시지 내용" /></h2>
        {campaign.subject && <p className="text-sm text-gray-600 mb-1 font-medium">{campaign.subject}</p>}
        <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{campaign.content}</p>
      </div>

      {/* A/B 테스트 결과 */}
      {abResults.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="A/B 테스트 결과" /></h2>
          <div className="grid grid-cols-2 gap-4">
            {abResults.map(v => {
              // 🔴 오픈율이 양쪽 0이면 둘 다 '승자'가 됐다(표본 0에서 우열 단정) — 최댓값이 0이면 승자 없음
              const best = Math.max(...abResults.map(r => r.openRate));
              const isWinner = abResults.length === 2 && best > 0 && v.openRate >= best;
              return (
                <div key={v.id} className={`rounded-xl p-4 border-2 ${isWinner ? 'border-emerald-400 bg-emerald-50' : 'border-gray-100 bg-gray-50'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-bold text-gray-900">{v.abVariantName ?? '-'}</span>
                    {isWinner && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-emerald-500 text-white"><T k="승자" /></span>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><p className="text-lg font-bold text-blue-700">{v.openRate}<Unit>%</Unit></p><p className="text-gray-500"><T k="오픈율" /></p></div>
                    <div><p className="text-lg font-bold text-amber-700">{v.clickRate}<Unit>%</Unit></p><p className="text-gray-500"><T k="클릭율" /></p></div>
                    <div><p className="text-lg font-bold text-emerald-700">{v.conversionRate}<Unit>%</Unit></p><p className="text-gray-500"><T k="전환율" /></p></div>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">발송 {v.sentCount} / 오픈 {v.openedCount} / 클릭 {v.clickedCount}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* A/B 테스트 생성 (DRAFT만) */}
      {campaign.status === 'DRAFT' && !campaign.abTestEnabled && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-700"><T k="A/B 테스트" /></h2>
            <button onClick={() => setShowAbCreate(!showAbCreate)} className="text-xs text-blue-600 hover:underline">
              <T k={showAbCreate ? '취소' : '+ A/B 테스트 생성'} />
            </button>
          </div>
          {showAbCreate && (
            <div className="space-y-3">
              <textarea value={abForm.variantContent} onChange={e => setAbForm(f => ({ ...f, variantContent: e.target.value }))}
                rows={3} placeholder={tAttr('B 변형 메시지 내용')} className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500"><T k="A 비율" />:</label>
                <input type="range" min={10} max={90} value={abForm.splitRatio}
                  onChange={e => setAbForm(f => ({ ...f, splitRatio: Number(e.target.value) }))}
                  className="flex-1" />
                <span className="text-xs font-mono text-gray-700">{abForm.splitRatio}:{100 - abForm.splitRatio}</span>
              </div>
              <button onClick={handleCreateAb} disabled={!abForm.variantContent}
                className="px-4 py-2 bg-violet-600 text-white text-sm rounded-xl hover:bg-violet-700 disabled:opacity-30"><T k="A/B 생성" /></button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* WeRU.B 콘텐츠 생성 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-700">{AI_ORIGIN_TEXT} 콘텐츠 추천</h2>
            <button onClick={handleGenerate} className="text-xs text-blue-600 hover:underline">{AI_ORIGIN_TEXT} 생성</button>
          </div>
          {generated ? (
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-2">
              <p className="font-medium text-gray-900">{generated.subject}</p>
              <p className="text-gray-600 whitespace-pre-wrap">{generated.content}</p>
              <p className="text-[10px] text-gray-400"><T k="변수" />: {generated.variables.join(', ')}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400 py-4 text-center">{AI_ORIGIN_TEXT} 생성 버튼을 눌러 콘텐츠를 추천받으세요</p>
          )}
        </div>

        {/* WeRU.B 세그먼트 추천 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3">{AI_ORIGIN_TEXT} 세그먼트 추천</h2>
          {segRecs.length > 0 ? (
            <div className="space-y-2">
              {segRecs.map(s => (
                <div key={s.id} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{s.name}</span>
                    <span className="text-xs text-gray-500">{s.patientCount}<Unit>명</Unit></span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5">{s.reason}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="📋" title="추천 세그먼트가 없습니다" />
          )}
        </div>
      </div>

      {/* 발송 기록 — 캠페인 전체 요약·상태 필터·페이지(서버 `campaigns/:id/logs`) */}
      <CampaignLogsPanel campaignId={id} />
    </div>
  );
}
