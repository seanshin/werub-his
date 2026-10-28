'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

const QUESTION_TYPES = [
  { key: 'text', label: '텍스트' },
  { key: 'select', label: '단일선택' },
  { key: 'multiselect', label: '복수선택' },
  { key: 'boolean', label: '예/아니오' },
  { key: 'number', label: '숫자' },
  { key: 'date', label: '날짜' },
];

interface Question {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options?: string[];
}

interface Section {
  title: string;
  questions: Question[];
}

export default function QuestionnaireEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const tAttr = useTAttr();

  const { data: res, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ck-questionnaire', id],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/questionnaires/${id}`),
  });
  const template = res?.data;

  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<Section[]>([]);
  const [initialized, setInitialized] = useState(false);

  if (template && !initialized) {
    setTitle(template.title);
    setSections(template.sections as Section[]);
    setInitialized(true);
  }

  const save = useMutation({
    mutationFn: () => apiClient.put(`/api/v1/checkup/questionnaires/${id}`, { title, sections }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ck-questionnaire', id] });
      toast.success('템플릿 저장 완료');
    },
  });

  const addSection = () => {
    setSections([...sections, { title: `섹션 ${sections.length + 1}`, questions: [] }]);
  };

  const addQuestion = (si: number) => {
    const updated = [...sections];
    updated[si].questions.push({
      id: `q${Date.now()}`,
      type: 'text',
      label: '',
      required: false,
    });
    setSections(updated);
  };

  const updateQuestion = (si: number, qi: number, field: string, value: unknown) => {
    const updated = [...sections];
    (updated[si].questions[qi] as any)[field] = value;
    setSections(updated);
  };

  const removeQuestion = (si: number, qi: number) => {
    const updated = [...sections];
    updated[si].questions.splice(qi, 1);
    setSections(updated);
  };

  const removeSection = (si: number) => {
    setSections(sections.filter((_, i) => i !== si));
  };

  if (isLoading) return <div className="py-12 text-center text-gray-400"><T k="로딩 중..." /></div>;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/his-checkup/questionnaires" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">←</Link>
          <h1 className="text-xl font-bold"><T k="문진표 편집" /></h1>
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          <T k={save.isPending ? '저장 중...' : '저장'} />
        </button>
      </div>

      {/* 제목 */}
      <div className="bg-white border rounded-xl p-4">
        <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="템플릿 제목" /></label>
        <input className="w-full border rounded-lg px-3 py-2 text-sm font-semibold"
          value={title} onChange={(e) => setTitle(e.target.value)} />
        <p className="text-xs text-gray-400 mt-1">{template?.program?.name ?? tAttr('공통 (전체 프로그램)')} · {sections.length}섹션</p>
      </div>

      {/* 섹션 목록 */}
      {sections.map((sec, si) => (
        <div key={si} className="bg-white border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <input className="text-sm font-semibold border-b border-transparent hover:border-gray-300 focus:border-blue-400 outline-none px-1 py-0.5"
              value={sec.title} onChange={(e) => {
                const updated = [...sections];
                updated[si].title = e.target.value;
                setSections(updated);
              }} />
            <div className="flex gap-1">
              <button onClick={() => addQuestion(si)} className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs"><T k="+ 문항" /></button>
              <button onClick={() => removeSection(si)} className="px-2 py-1 bg-red-50 text-red-500 rounded text-xs"><T k="삭제" /></button>
            </div>
          </div>

          {sec.questions.map((q, qi) => (
            <div key={q.id} className="bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-6">Q{qi + 1}</span>
                <input className="flex-1 border rounded px-2 py-1.5 text-sm" placeholder={tAttr('질문')}
                  value={q.label} onChange={(e) => updateQuestion(si, qi, 'label', e.target.value)} />
                <select className="border rounded px-2 py-1.5 text-xs" value={q.type}
                  onChange={(e) => updateQuestion(si, qi, 'type', e.target.value)}>
                  {QUESTION_TYPES.map((t) => <option key={t.key} value={t.key}>{tAttr(t.label)}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(si, qi, 'required', e.target.checked)} />
                  <T k="필수" />
                </label>
                <button onClick={() => removeQuestion(si, qi)} className="text-red-400 text-xs hover:text-red-600">x</button>
              </div>

              {(q.type === 'select' || q.type === 'multiselect') && (
                <div className="ml-8">
                  <label className="text-[10px] text-gray-400"><T k="선택지 (쉼표 구분)" /></label>
                  <input className="w-full border rounded px-2 py-1 text-xs" placeholder="옵션1, 옵션2, 옵션3"
                    value={(q.options ?? []).join(', ')}
                    onChange={(e) => updateQuestion(si, qi, 'options', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
                </div>
              )}
            </div>
          ))}

          {sec.questions.length === 0 && (
            <EmptyState icon="📋" title="문항이 없습니다." hint={'"+ 문항"을 클릭하세요'} />
          )}
        </div>
      ))}

      <button onClick={addSection} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500">
        <T k="+ 섹션 추가" />
      </button>
    </div>
  );
}
