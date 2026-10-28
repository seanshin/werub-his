'use client';

import { useState } from 'react';
import { auditNewWindowPrint } from '@/components/print/PrintGuard';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface Letter {
  id: string;
  type: string;
  toDepartment: string;
  fromDepartment: string;
  urgency: string;
  status: string;
  content: string;
  letterNumber?: string;
  aiModel?: string;
  editedByDoctor: boolean;
  signedAt?: string;
  createdAt: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  fromDoctor?: { familyName?: string; givenName?: string; department?: string };
  toDoctor?: { familyName?: string; givenName?: string };
}

const TYPE_LABEL: Record<string, string> = {
  CONSULTATION_REQUEST: '협진 의뢰서',
  CONSULTATION_REPLY: '협진 회신서',
  TRANSFER: '전원 의뢰서',
  LAB_ORDER: '검사 의뢰서',
  CHECKUP_REFERRAL: '외래 의뢰서',
  MEDICAL_OPINION: '진료 소견서',
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  DRAFT: { label: '초안', color: 'bg-gray-100 text-gray-600' },
  SIGNED: { label: '서명', color: 'bg-blue-100 text-blue-700' },
  SENT: { label: '전송', color: 'bg-indigo-100 text-indigo-700' },
  RECEIVED: { label: '수신', color: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: '거절', color: 'bg-red-100 text-red-700' },
  VOIDED: { label: '무효', color: 'bg-gray-200 text-gray-500' },
  ARCHIVED: { label: '보관', color: 'bg-gray-100 text-gray-500' },
};

export default function LettersPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  // 전체 의뢰서 — pending department 기반
  const { data, isLoading } = useQuery({
    queryKey: ['referral-letters-all'],
    queryFn: () => apiClient.get<{ data: Letter[] }>('/api/v1/referral-letters/all'),
  });
  const _raw = data?.data as Letter[] | { data?: Letter[] } | undefined;
  const letters: Letter[] = Array.isArray(_raw) ? _raw : ((_raw as { data?: Letter[] })?.data ?? []);

  const filtered = filter === 'all' ? letters : letters.filter(l => l.status === filter);
  const draftCount = letters.filter(l => l.status === 'DRAFT').length;

  const signAndSend = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/referral-letters/${id}/sign-and-send`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referral-letters-all'] });
      toast.success(tAttr('서명 + 전송 완료'));
    },
    onError: () => toast.error(tAttr('처리 실패')),
  });

  const showPreview = async (id: string) => {
    try {
      const res = await apiClient.get<{ data: { html: string } }>(`/api/v1/referral-letters/${id}/html`);
      const html = (res as any)?.data?.data?.html ?? (res as any)?.data?.html ?? '';
      setPreviewHtml(html);
    } catch {
      toast.error(tAttr('미리보기 실패'));
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="의뢰서 문서" /></h1>
        <p className="text-sm text-gray-500 mt-1"><Tf k="{AI표기} 자동작성 의뢰서 관리 (서명, 전송, PDF)" params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
      </div>

      {/* 필터 */}
      <div className="flex gap-2">
        {['all', 'DRAFT', 'SIGNED', 'SENT', 'RECEIVED'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium rounded-xl ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f === 'all' ? <Tf k="전체 ({건수})" params={{ 건수: letters.length }} /> : <><T k={STATUS_MAP[f]?.label ?? f} /> ({letters.filter(l => l.status === f).length})</>}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-sm"><T k="의뢰서가 없습니다" /></p>
          <p className="text-gray-300 text-xs mt-1"><Tf k="환자 차트 → 의뢰/회신 탭에서 {AI표기} 초안을 생성하세요" params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(l => {
            const st = STATUS_MAP[l.status] ?? { label: l.status, color: 'bg-gray-100' };
            return (
              <div key={l.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.color}`}><T k={st.label} /></span>
                    <span className="text-sm font-semibold text-gray-900"><T k={TYPE_LABEL[l.type] ?? l.type} /></span>
                    <span className="text-xs text-gray-500">{l.fromDepartment} → {l.toDepartment}</span>
                    {l.letterNumber && <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{l.letterNumber}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {l.aiModel && <span className="text-[10px] text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded">{AI_ORIGIN_TEXT}</span>}
                    <span className="text-xs text-gray-400">{kdate(new Date(l.createdAt))}</span>
                  </div>
                </div>

                {l.patient && (
                  <p className="text-xs text-gray-500 mb-2">
                    <Tf k="환자: {환자} ({MRN})" params={{ 환자: `${l.patient.familyName ?? ''}${l.patient.givenName ?? ''}`, MRN: l.patient.mrn ?? '' }} />
                    {l.fromDoctor && <> | <Tf k="작성: {작성자}" params={{ 작성자: `${l.fromDoctor.familyName ?? ''}${l.fromDoctor.givenName ?? ''}` }} /></>}
                  </p>
                )}

                <p className="text-sm text-gray-700 line-clamp-2 mb-3">{l.content}</p>

                <div className="flex gap-2">
                  <button onClick={() => showPreview(l.id)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
                    <T k="미리보기" />
                  </button>
                  {l.status === 'DRAFT' && (
                    <button onClick={() => signAndSend.mutate(l.id)} disabled={signAndSend.isPending}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40">
                      <T k={signAndSend.isPending ? '처리 중...' : '서명 + 전송'} />
                    </button>
                  )}
                  {l.signedAt && <span className="text-[10px] text-emerald-600 self-center"><Tf k="서명: {일시}" params={{ 일시: kdate(l.signedAt, 'datetimeSec') }} /></span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PDF 미리보기 모달 */}
      {previewHtml && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => { setPreviewHtml(null); document.body.style.overflow = ''; }}
          ref={() => { document.body.style.overflow = 'hidden'; }}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-3 border-b sticky top-0 bg-white z-10">
              <h3 className="font-semibold text-gray-900"><T k="의뢰서 미리보기" /></h3>
              <div className="flex gap-2">
                <button onClick={() => { auditNewWindowPrint('consult-letter'); const w = window.open(); w?.document.write(previewHtml); w?.print(); }}
                  className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"><T k="인쇄" /></button>
                <button onClick={() => { setPreviewHtml(null); document.body.style.overflow = ''; }} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
              </div>
            </div>
            <div className="p-6" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      )}
    </div>
  );
}
