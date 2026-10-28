'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

type Status = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

interface Content {
  id: string; testCode: string; testName: string;
  plainWhat?: string | null; plainMeaning?: string | null; lifestyleInfo?: string | null;
  whenToSeeDoctor?: string | null; sourceRef?: string | null;
  status: Status; version: number;
  reviewedByName?: string | null; reviewedAt?: string | null; reviewNote?: string | null;
  approverCount?: number; pending2nd?: boolean;
}
interface ListResponse { fourEyes: boolean; items: Content[] }

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  DRAFT: { label: '작성중', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  IN_REVIEW: { label: '감수중', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  APPROVED: { label: '승인', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  REJECTED: { label: '반려', cls: 'bg-red-100 text-red-700 border-red-200' },
};

const EMPTY = { testCode: '', testName: '', plainWhat: '', plainMeaning: '', lifestyleInfo: '', whenToSeeDoctor: '', sourceRef: '' };

export default function CheckupExplainerPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Status | 'ALL'>('ALL');
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const { data } = useQuery({
    queryKey: ['checkup-explainer', filter],
    queryFn: () => apiClient.get<{ data: ListResponse }>('/api/v1/checkup-explainer', filter === 'ALL' ? {} : { status: filter }),
  });
  const { list, fourEyes } = useMemo(() => {
    const raw = data?.data as ListResponse | Content[] | { data?: ListResponse } | undefined;
    const unwrapped = (raw && !Array.isArray(raw) && 'data' in raw ? raw.data : raw) as ListResponse | Content[] | undefined;
    if (Array.isArray(unwrapped)) return { list: unwrapped, fourEyes: false };
    return { list: unwrapped?.items ?? [], fourEyes: unwrapped?.fourEyes ?? false };
  }, [data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['checkup-explainer'] });
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3000); };

  const upsertMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/checkup-explainer', form),
    onSuccess: () => { flash('저장됨(작성중)'); setForm({ ...EMPTY }); setEditId(null); invalidate(); },
    onError: (e: unknown) => flash(`저장 실패: ${(e as { message?: string })?.message ?? '가드레일 차단 가능'}`),
  });
  const submitMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/checkup-explainer/${id}/submit`, {}),
    onSuccess: () => { flash('감수 제출됨'); invalidate(); },
  });
  const reviewMut = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) =>
      apiClient.post(`/api/v1/checkup-explainer/${id}/review`, { decision, reviewNote: reviewNote.trim() || undefined }),
    onSuccess: (_d, v) => { flash(v.decision === 'APPROVED' ? '승인됨' : '반려됨'); setReviewNote(''); invalidate(); },
  });

  const startEdit = (c: Content) => {
    setEditId(c.id);
    setForm({ testCode: c.testCode, testName: c.testName, plainWhat: c.plainWhat ?? '', plainMeaning: c.plainMeaning ?? '', lifestyleInfo: c.lifestyleInfo ?? '', whenToSeeDoctor: c.whenToSeeDoctor ?? '', sourceRef: c.sourceRef ?? '' });
  };

  const FIELDS: { key: keyof typeof EMPTY; label: string; area?: boolean }[] = [
    { key: 'plainWhat', label: '이 검사는 무엇을 보나요(한 문장)', area: true },
    { key: 'plainMeaning', label: '일반적으로 이런 뜻이에요 (단정 금지·정보 제공)', area: true },
    { key: 'lifestyleInfo', label: '참고 생활정보 (맞춤 처방 아님)', area: true },
    { key: 'whenToSeeDoctor', label: '이럴 땐 진료를 권해요', area: true },
    { key: 'sourceRef', label: '근거(가이드라인·기관)' },
  ];

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900"><T k="검진결과 해석 콘텐츠 (감수)" /></h1>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-yellow-100 text-yellow-800 border border-yellow-200"><T k="소비자 미노출 · 저작/감수 인프라" /></span>
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${fourEyes ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
            <T k="4-eyes(2인 승인)" />: <T k={fourEyes ? '활성' : '비활성'} />
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          검사코드별 <b>쉬운말 해석</b>을 저작 → 감수(승인/반려)합니다. 저장 시 <b>가드레일</b>(진단 확정·처방/용량 지시 금칙)이 자동 검증됩니다.
          웰니스(정보 제공) 유지를 위해 단정·처방 표현을 배제하세요. 소비자 노출은 규제 포지션 확정 후 별도 연결됩니다.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] gap-5">
        {/* 저작 폼 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3 h-fit">
          <p className="text-sm font-bold text-gray-700"><T k={editId ? '수정' : '새 콘텐츠'} /> {editId && <span className="text-[11px] text-orange-600"><T k="(승인본 수정 시 재감수 필요)" /></span>}</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.testCode} disabled={!!editId} onChange={(e) => setForm((f) => ({ ...f, testCode: e.target.value }))}
              placeholder={tAttr('검사코드')} className="px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-50" />
            <input value={form.testName} onChange={(e) => setForm((f) => ({ ...f, testName: e.target.value }))}
              placeholder={tAttr('검사명')} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          {FIELDS.map((fd) => (
            <div key={fd.key}>
              <label className="text-[11px] text-gray-500 block mb-0.5"><T k={fd.label} /></label>
              {fd.area ? (
                <textarea value={form[fd.key]} onChange={(e) => setForm((f) => ({ ...f, [fd.key]: e.target.value }))} rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:border-blue-400 focus:outline-none" />
              ) : (
                <input value={form[fd.key]} onChange={(e) => setForm((f) => ({ ...f, [fd.key]: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none" />
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={() => upsertMut.mutate()} disabled={upsertMut.isPending || !form.testCode || !form.testName}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40"><T k="저장" /></button>
            {editId && <button onClick={() => { setEditId(null); setForm({ ...EMPTY }); }} className="px-3 py-2 rounded-lg bg-gray-100 text-sm text-gray-600"><T k="새로 작성" /></button>}
            {msg && <span className="text-xs font-medium text-emerald-600">{msg}</span>}
          </div>
        </div>

        {/* 목록·감수 */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(['ALL', 'DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'] as const).map((k) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium border ${filter === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                <T k={k === 'ALL' ? '전체' : STATUS_META[k].label} />
              </button>
            ))}
          </div>
          {list.length === 0 && <p className="text-sm text-gray-400 text-center py-10"><T k="콘텐츠 없음" /></p>}
          {list.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-bold text-gray-900 truncate">{c.testName}</span>
                  <span className="text-[11px] text-gray-400">{c.testCode} · v{c.version}</span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_META[c.status].cls}`}><T k={STATUS_META[c.status].label} /></span>
                  {c.pending2nd && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-blue-100 text-blue-700 border-blue-200 whitespace-nowrap"><T k="2차 승인 대기" /></span>}
                </div>
                <button onClick={() => startEdit(c)} className="text-xs text-blue-600 hover:underline shrink-0"><T k="수정" /></button>
              </div>
              {c.plainWhat && <p className="text-xs text-gray-600 line-clamp-1">{c.plainWhat}</p>}
              {c.reviewedByName && <p className="text-[11px] text-gray-400 mt-0.5"><T k="감수" /> {c.reviewedByName} · {kdate(c.reviewedAt && new Date(c.reviewedAt))}{c.reviewNote ? ` · ${c.reviewNote}` : ''}</p>}
              <div className="flex items-center gap-2 mt-2">
                {(c.status === 'DRAFT' || c.status === 'REJECTED') && (
                  <button onClick={() => submitMut.mutate(c.id)} className="px-3 py-1.5 text-xs rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200"><T k="감수 제출" /></button>
                )}
                {c.status === 'IN_REVIEW' && (
                  <>
                    <input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder={tAttr('감수 소견')}
                      className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
                    <button onClick={() => reviewMut.mutate({ id: c.id, decision: 'APPROVED' })} className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><T k="승인" />{fourEyes ? ` (${c.approverCount ?? 0}/2)` : ''}</button>
                    <button onClick={() => reviewMut.mutate({ id: c.id, decision: 'REJECTED' })} className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700"><T k="반려" /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
