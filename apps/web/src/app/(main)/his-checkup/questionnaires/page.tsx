'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

const SAMPLE_SECTIONS = [
  {
    title: '기본 건강 정보',
    questions: [
      { id: 'q1', type: 'select', label: '흡연 여부', required: true, options: ['비흡연', '과거흡연 (금연중)', '현재흡연'] },
      { id: 'q2', type: 'select', label: '음주 빈도', required: true, options: ['전혀 안함', '월 1-2회', '주 1-2회', '주 3회 이상', '매일'] },
      { id: 'q3', type: 'select', label: '주당 운동 횟수', required: true, options: ['거의 안함', '1-2회', '3-4회', '5회 이상'] },
    ],
  },
  {
    title: '과거 병력',
    questions: [
      { id: 'q4', type: 'multiselect', label: '진단받은 질환', required: false, options: ['고혈압', '당뇨병', '고지혈증', '심장질환', '뇌혈관질환', '간질환', '갑상선질환', '암', '기타'] },
      { id: 'q5', type: 'boolean', label: '현재 복용 중인 약물이 있습니까?', required: true },
      { id: 'q5a', type: 'text', label: '복용 약물 상세', required: false },
    ],
  },
  {
    title: '가족력',
    questions: [
      { id: 'q6', type: 'multiselect', label: '직계 가족 질환', required: false, options: ['고혈압', '당뇨병', '심장질환', '뇌졸중', '암(위)', '암(대장)', '암(유방)', '암(폐)'] },
    ],
  },
  {
    title: '현재 증상',
    questions: [
      { id: 'q7', type: 'multiselect', label: '최근 6개월 내 경험한 증상', required: false, options: ['두통', '어지러움', '가슴통증', '호흡곤란', '소화불량', '복통', '피로감', '체중변화', '혈변/혈뇨', '없음'] },
    ],
  },
];

export default function CheckupQuestionnairesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tAttr = useTAttr();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', programId: '' });

  const { data: res, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ck-questionnaires'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/questionnaires'),
  });
  const templates = res?.data ?? [];

  const { data: programsRes } = useQuery({
    queryKey: ['checkup-programs-active'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/programs', { isActive: 'true' }),
  });
  const programs = programsRes?.data ?? [];

  const create = useMutation({
    mutationFn: (body: { title: string; programId?: string; sections: unknown }) =>
      apiClient.post('/api/v1/checkup/questionnaires', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ck-questionnaires'] });
      setShowCreate(false);
      toast.success('문진 템플릿 생성 완료');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/checkup/questionnaires/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ck-questionnaires'] });
      toast.success('비활성화 완료');
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold"><T k="문진표 관리" /></h1>
          <p className="text-sm text-gray-500"><T k="검진 프로그램별 사전 문진 템플릿" /></p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
          <T k="+ 템플릿 생성" />
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold"><T k="새 문진 템플릿" /></h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="제목" /></label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="일반 건강검진 문진표"
                value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="연결 프로그램 (선택)" /></label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm"
                value={createForm.programId} onChange={(e) => setCreateForm({ ...createForm, programId: e.target.value })}>
                <option value="">{tAttr('공통 (전체 프로그램)')}</option>
                {programs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
            <T k="기본 문진표 템플릿(생활습관/과거병력/가족력/현재증상)이 자동 적용됩니다." />
          </div>
          <div className="flex gap-2">
            <button onClick={() => create.mutate({
              title: createForm.title,
              programId: createForm.programId || undefined,
              sections: SAMPLE_SECTIONS,
            })} disabled={!createForm.title}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm disabled:opacity-50"><T k="생성" /></button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-100 rounded-xl text-sm"><T k="취소" /></button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-gray-400"><T k="로딩 중..." /></div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : templates.length === 0 ? (
        <div className="py-12 text-center text-gray-400">
          <div className="text-3xl mb-2">📝</div>
          <p><T k="등록된 문진 템플릿이 없습니다" /></p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((t: any) => {
            const sections = (t.sections as any[]) ?? [];
            const questionCount = sections.reduce((sum: number, s: any) => sum + (s.questions?.length ?? 0), 0);
            return (
              <div
                key={t.id}
                onClick={() => router.push(`/his-checkup/questionnaires/${t.id}`)}
                className={`bg-white border rounded-xl p-5 cursor-pointer hover:shadow-md hover:border-blue-200 transition ${!t.isActive ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">{t.title}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t.program ? t.program.name : tAttr('공통 (전체 프로그램)')} · {sections.length}섹션 · {questionCount}문항
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                    t.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                  }`}><T k={t.isActive ? '활성' : '비활성'} /></span>
                </div>

                <div className="space-y-1 mb-3">
                  {sections.map((s: any, i: number) => (
                    <div key={i} className="text-xs text-gray-500 flex items-center gap-1.5">
                      <span className="w-4 h-4 bg-gray-100 rounded text-[10px] font-bold text-center leading-4">{i + 1}</span>
                      {s.title} ({s.questions?.length ?? 0})
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2 border-t" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-gray-400"><T k="응답" /> {t._count?.responses ?? 0}<Unit>건</Unit></span>
                  <div className="flex gap-2">
                    <button onClick={() => router.push(`/his-checkup/questionnaires/${t.id}`)}
                      className="px-3 py-1 bg-blue-50 text-blue-600 rounded text-xs hover:bg-blue-100 font-medium"><T k="편집" /></button>
                    {t.isActive && (
                      <button onClick={() => { if (confirm('비활성화하시겠습니까?')) remove.mutate(t.id); }}
                        className="px-3 py-1 bg-red-50 text-red-500 rounded text-xs hover:bg-red-100"><T k="비활성화" /></button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
