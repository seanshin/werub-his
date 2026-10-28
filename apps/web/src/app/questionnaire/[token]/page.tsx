'use client';

import { use, useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

async function fetchPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

async function postPublic<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to submit');
  return res.json();
}

interface FormField {
  type: string;
  label: string;
  key: string;
  placeholder?: string;
  required?: boolean;
  options?: (string | { value: string | number; label: string })[];
  conditional?: { showIf: { field: string; value: string } };
}

interface FormSection {
  title: string;
  fields: FormField[];
}

interface QuestionnaireSchema {
  title?: string;
  description?: string;
  sections?: FormSection[];
  fields?: FormField[];
}

interface QuestionnaireFormSchema {
  name?: string;
  estimatedMinutes?: number;
  schema?: QuestionnaireSchema;
}

interface QuestionnaireData {
  formSchema?: QuestionnaireFormSchema;
  patient?: { familyName?: string; givenName?: string };
}

export default function QuestionnairePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [formData, setFormData] = useState<Record<string, string | string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const [currentSection, setCurrentSection] = useState(0);
  const [chatMode, setChatMode] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['questionnaire', token],
    queryFn: () => fetchPublic<{ data: QuestionnaireData }>(`/api/v1/questionnaires/${token}`),
  });

  const submitMut = useMutation({
    mutationFn: () => postPublic(`/api/v1/questionnaires/${token}/submit`, { data: formData ?? {} }),
    onSuccess: () => setSubmitted(true),
    onError: (e) => { console.error('제출 에러:', e); alert(`문진표 제출에 실패했습니다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`); },
  });

  // 스키마에서 섹션 추출
  const { sections, title, description, estimatedMinutes } = useMemo(() => {
    if (!data?.data?.formSchema?.schema) return { sections: [], title: '', description: '', estimatedMinutes: 0 };
    const schema = data.data.formSchema.schema as QuestionnaireSchema;
    let secs: FormSection[] = [];

    if (schema.sections?.length) {
      secs = schema.sections;
    } else if (schema.fields?.length) {
      secs = [{ title: '', fields: schema.fields }];
    }

    return {
      sections: secs,
      title: schema.title ?? data.data.formSchema.name ?? '문진표',
      description: schema.description ?? '',
      estimatedMinutes: data.data.formSchema.estimatedMinutes ?? 0,
    };
  }, [data]);

  const setValue = (key: string, value: string) => setFormData(d => ({ ...d, [key]: value }));
  const toggleCheckbox = (key: string, option: string) => {
    setFormData(d => {
      const raw = d[key];
      const current: string[] = Array.isArray(raw) ? raw : [];
      return { ...d, [key]: current.includes(option) ? current.filter(v => v !== option) : [...current, option] };
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center max-w-md">
          {/**
            * 🔴 오류 **하나**를 만료·중복작성이라는 특정 원인으로 단정하지 않는다(2026-09-02).
            *    서버 500·네트워크 끊김도 같은 문장이 나와, 아직 유효한 문진표를 환자가 포기했다.
            *    서버가 만료/중복을 말할 때만 그렇게 말하고, 그 밖은 "일시적"이라고 말한다.
            */}
          <p className="text-red-500 text-lg font-semibold mb-2">문진표를 열 수 없습니다</p>
          <p className="text-gray-500 text-sm">
            {/expired|만료|already|이미|not found|찾을 수 없|404|410/i.test(
              String((error as { message?: string })?.message ?? ''),
            )
              ? '링크가 만료되었거나 이미 작성된 문진표입니다.'
              : '일시적으로 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
          </p>
          <div className="flex gap-3 mt-6">
            <a href="/portal" className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 text-center">환자 포털로 이동</a>
            <a href="/booking" className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 text-center">예약하기</a>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 text-center max-w-lg w-full">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-10 h-10 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <p className="text-xl font-bold text-gray-900">문진표가 제출되었습니다</p>
          <p className="text-sm text-gray-500 mt-2">감사합니다. 진료 시 활용됩니다.</p>
          <div className="flex gap-3 mt-8">
            <a href="/portal" className="flex-1 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 text-center transition-colors">환자 포털</a>
            <a href="/booking" className="flex-1 py-3 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200 text-center transition-colors">예약하기</a>
            <a href="/home" className="flex-1 py-3 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200 text-center transition-colors">병원 홈페이지</a>
          </div>
        </div>
      </div>
    );
  }

  const questionnaire = data?.data;
  const patientName = `${questionnaire?.patient?.familyName ?? ''}${questionnaire?.patient?.givenName ?? ''}`;
  const isMultiSection = sections.length > 1;
  const section = sections[currentSection];
  const totalFields = sections.reduce((n, s) => n + s.fields.length, 0);
  const filledFields = Object.keys(formData).filter(k => {
    const v = formData[k];
    return v !== '' && v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
  }).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white py-6 px-4">
      <div className={`mx-auto ${chatMode ? 'max-w-5xl' : 'max-w-lg'}`}>
        {/* 헤더 */}
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
            <h1 className="text-lg font-bold text-gray-900">{title}</h1>
          </div>
          {description && <p className="text-xs text-gray-500 text-center">{description}</p>}
          <p className="text-xs text-gray-400 text-center mt-1">
            {patientName}님 {estimatedMinutes ? `| 예상 ${estimatedMinutes}분` : ''}
          </p>

          {/* 진행률 */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
              <span>{filledFields}/{totalFields} 항목</span>
              {isMultiSection && <span>{currentSection + 1}/{sections.length} 섹션</span>}
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${totalFields > 0 ? (filledFields / totalFields) * 100 : 0}%` }} />
            </div>
          </div>

          {/* 모드 토글 */}
          <div className="flex gap-2 mt-3">
            <button onClick={() => setChatMode(false)}
              className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${!chatMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
              📋 폼 작성
            </button>
            <button onClick={() => setChatMode(true)}
              className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${chatMode ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
              💬 {AI_ORIGIN_TEXT} 문답 작성
            </button>
          </div>
        </div>

        {/* WeRU.B 문답 모드 — 좌: 실시간 표 / 우: 채팅 */}
        {chatMode && (
          <div className="flex gap-4 mb-4">
            {/* 좌측: 실시간 작성 결과 표 */}
            <div className="w-1/2 bg-white rounded-2xl shadow-sm p-4 max-h-[520px] overflow-y-auto">
              <p className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <span className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center text-[10px]">📋</span>
                작성 현황 ({filledFields}/{totalFields})
              </p>
              {sections.map((sec, si) => (
                <div key={si} className="mb-3">
                  {sec.title && <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">{sec.title}</p>}
                  <div className="space-y-1">
                    {sec.fields.map((f, fi) => {
                      const val = formData[f.key];
                      const filled = val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0);
                      return (
                        <div key={fi} className={`flex items-start justify-between py-1.5 px-2.5 rounded-lg text-xs transition-colors ${filled ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50 border border-gray-100'}`}>
                          <span className={`${filled ? 'text-emerald-700' : 'text-gray-400'} flex items-center gap-1`}>
                            {filled ? '✓' : '○'} {f.label}{f.required ? ' *' : ''}
                          </span>
                          <span className={`font-medium ml-2 text-right ${filled ? 'text-emerald-900' : 'text-gray-300'}`}>
                            {filled ? (Array.isArray(val) ? val.join(', ') : val) : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 우측: 채팅 */}
            <div className="w-1/2">
              <AiQuestionnaireChat
                sections={sections}
                formData={formData}
                setFormData={setFormData}
                patientName={patientName}
                onComplete={() => { setChatMode(false); }}
                onSubmit={() => submitMut.mutate()}
                isSubmitting={submitMut.isPending}
              />
            </div>
          </div>
        )}

        {/* 폼 모드 */}
        {!chatMode && (
        <>
        {/* 섹션 네비게이션 (멀티 섹션) */}
        {isMultiSection && (
          <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
            {sections.map((s, i) => (
              <button key={i} onClick={() => setCurrentSection(i)}
                className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  i === currentSection ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'
                }`}>
                {s.title || `섹션 ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        {/* 현재 섹션 필드 */}
        {section && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            {section.title && <h2 className="text-sm font-semibold text-gray-800 mb-4 pb-2 border-b">{section.title}</h2>}
            <div className="space-y-4">
              {section.fields.map((field, idx) => {
                const key = field.key ?? `field_${currentSection}_${idx}`;

                // 조건부 필드
                if (field.conditional?.showIf) {
                  const { field: depField, value: depValue } = field.conditional.showIf;
                  if (formData[depField] !== depValue) return null;
                }

                return (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>

                    {/* textarea */}
                    {field.type === 'textarea' && (
                      <textarea value={formData[key] ?? ''} onChange={e => setValue(key, e.target.value)}
                        rows={3} placeholder={field.placeholder ?? ''}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" />
                    )}

                    {/* select */}
                    {field.type === 'select' && (
                      <select value={formData[key] ?? ''} onChange={e => setValue(key, e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 bg-white">
                        <option value="">선택하세요</option>
                        {(field.options ?? []).map((o, oi) => {
                          const val = typeof o === 'string' ? o : String(o.value);
                          const lab = typeof o === 'string' ? o : o.label;
                          return <option key={oi} value={val}>{lab}</option>;
                        })}
                      </select>
                    )}

                    {/* radio */}
                    {field.type === 'radio' && (
                      <div className="space-y-1.5">
                        {(field.options ?? []).map((o, oi) => {
                          const val = typeof o === 'string' ? o : String(o.value);
                          const lab = typeof o === 'string' ? o : o.label;
                          return (
                            <label key={oi} className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                              <input type="radio" name={key} value={val} checked={formData[key] === val}
                                onChange={() => setValue(key, val)} className="accent-blue-600" />
                              <span className="text-sm text-gray-700">{lab}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* checkbox (다중 선택) */}
                    {field.type === 'checkbox' && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {(field.options ?? []).map((o, oi) => {
                          const val = typeof o === 'string' ? o : String(o.value);
                          const lab = typeof o === 'string' ? o : o.label;
                          const checked = (formData[key] as string[] ?? []).includes(val);
                          return (
                            <label key={oi} className={`flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer transition-colors text-xs ${
                              checked ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                            }`}>
                              <input type="checkbox" checked={checked} onChange={() => toggleCheckbox(key, val)}
                                className="accent-blue-600 rounded" />
                              <span>{lab}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* number */}
                    {field.type === 'number' && (
                      <input type="number" value={formData[key] ?? ''} onChange={e => setValue(key, e.target.value)}
                        placeholder={field.placeholder ?? ''} min={0}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                    )}

                    {/* text (기본) */}
                    {(field.type === 'text' || !['textarea', 'select', 'radio', 'checkbox', 'number'].includes(field.type)) && field.type !== 'checkbox' && field.type !== 'radio' && field.type !== 'select' && field.type !== 'textarea' && field.type !== 'number' && (
                      <input type="text" value={formData[key] ?? ''} onChange={e => setValue(key, e.target.value)}
                        placeholder={field.placeholder ?? ''}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 네비게이션 버튼 */}
        <div className="mt-4 flex gap-2">
          {isMultiSection && currentSection > 0 && (
            <button onClick={() => setCurrentSection(p => p - 1)}
              className="flex-1 py-3 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50">
              이전
            </button>
          )}
          {isMultiSection && currentSection < sections.length - 1 ? (
            <button onClick={() => setCurrentSection(p => p + 1)}
              className="flex-1 py-3 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
              다음 ({sections[currentSection + 1]?.title || '계속'})
            </button>
          ) : (
            <button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}
              className="flex-1 py-3 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
              {submitMut.isPending ? '제출 중...' : '문진표 제출'}
            </button>
          )}
        </div>

        <p className="text-center text-[10px] text-gray-400 mt-4">위루비병원 | 개인정보는 안전하게 처리됩니다</p>
        </>
        )}
      </div>
    </div>
  );
}

/* ── WeRU.B 문답 모드 컴포넌트 ── */
function AiQuestionnaireChat({
  sections, formData, setFormData, patientName, onComplete, onSubmit, isSubmitting,
}: {
  sections: FormSection[];
  formData: Record<string, string | string[]>;
  setFormData: React.Dispatch<React.SetStateAction<Record<string, string | string[]>>>;
  patientName: string;
  onComplete: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  // 모든 필드를 순서대로 나열
  const allFields = useMemo(() =>
    sections.flatMap(s => s.fields.map(f => ({ ...f, section: s.title }))),
    [sections]
  );
  const [currentIdx, setCurrentIdx] = useState(0);
  const [chatHistory, setChatHistory] = useState<{ role: 'ai' | 'user'; text: string }[]>([
    { role: 'ai', text: `${patientName}님, 문진표를 대화로 작성해볼게요.\n편하게 답변해주시면 자동으로 기록됩니다.` },
  ]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // 필드 라벨 → 친근한 질문 문장 변환
  const toFriendlyQuestion = (label: string, required: boolean): string => {
    const map: Record<string, string> = {
      '변화 상세': '구체적으로 어떻게 변했는지 알려주세요 😊',
      '지난 진료 이후 증상 변화': '지난 진료 이후 증상이 어떻게 변했나요?',
      '처방약 복용 상태': '처방받은 약은 잘 드시고 계신가요?',
      '약 부작용/불편': '약을 드시면서 불편하거나 이상한 점이 있었나요?',
      '의료진에게 전달할 사항': '담당 의사에게 따로 전하고 싶은 말이 있으신가요?',
      '주요 증상': '가장 불편한 증상이 무엇인가요?',
      '증상 시작 시기': '이 증상은 언제부터 시작되었나요?',
      '증상 정도': '증상이 얼마나 심한 편인가요?',
      '과거 병력': '이전에 앓았거나 진단받은 질환이 있나요?',
      '현재 복용약': '현재 복용 중인 약이 있으시면 알려주세요',
      '알레르기': '알레르기가 있으시면 알려주세요',
      '수술 이력': '수술 받으신 적이 있나요?',
      '가족력': '가족 중에 특별한 질환이 있는 분이 계신가요?',
      '흡연': '흡연을 하시나요?',
      '음주': '음주는 어느 정도 하시나요?',
    };
    const friendly = map[label];
    if (friendly) return friendly;
    // 기본: 라벨이 짧으면 질문형으로, 길면 그대로
    if (label.length <= 8) return `${label}${label.endsWith('요') || label.endsWith('가') ? '' : '에 대해 알려주세요'}${required ? ' (필수)' : ''}`;
    return `${label}${required ? ' (필수)' : ''}`;
  };

  // 현재 질문 표시
  useEffect(() => {
    if (currentIdx < allFields.length) {
      const field = allFields[currentIdx];
      const question = toFriendlyQuestion(field.label, !!field.required);
      const optionText = field.options?.length
        ? `\n\n${field.options.map(o => typeof o === 'string' ? o : o.label).join(' / ')}`
        : '';
      setChatHistory(prev => [...prev, {
        role: 'ai',
        text: `${question}${optionText}`,
      }]);
    } else if (currentIdx >= allFields.length && allFields.length > 0) {
      setChatHistory(prev => [...prev, {
        role: 'ai',
        text: '모든 항목을 작성했습니다! 아래에서 결과를 확인하고 제출해주세요.',
      }]);
    }
  }, [currentIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    // 새 질문 표시 후 입력 포커스
    setTimeout(() => chatInputRef.current?.focus(), 100);
  }, [chatHistory]);

  const handleAnswer = () => {
    const answer = input.trim();
    if (!answer || currentIdx >= allFields.length) return;

    const field = allFields[currentIdx];
    setChatHistory(prev => [...prev, { role: 'user', text: answer }]);
    setInput('');

    // 값 저장
    if (field.type === 'checkbox') {
      setFormData(d => ({ ...d, [field.key]: answer.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean) }));
    } else {
      setFormData(d => ({ ...d, [field.key]: answer }));
    }

    setCurrentIdx(prev => prev + 1);
  };

  const completed = currentIdx >= allFields.length;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-4">
      {/* 채팅 영역 */}
      <div ref={scrollRef} className="h-[360px] overflow-y-auto p-4 space-y-2.5 bg-gray-50/50">
        {chatHistory.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-violet-600 text-white rounded-br-md'
                : 'bg-white text-gray-800 rounded-bl-md shadow-sm border border-gray-100'
            }`}>
              <div className="whitespace-pre-wrap">{msg.text}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 입력 또는 완료 */}
      {!completed ? (
        <div className="border-t p-3 flex gap-2">
          {/* 선택형이면 버튼 표시 */}
          {allFields[currentIdx]?.options?.length ? (
            <div className="flex flex-wrap gap-1.5 w-full">
              {allFields[currentIdx].options!.map((opt, oi) => {
                const label = typeof opt === 'string' ? opt : opt.label;
                const value = typeof opt === 'string' ? opt : String(opt.value);
                return (
                  <button key={oi} onClick={() => { setInput(value); setTimeout(() => { setInput(''); setChatHistory(prev => [...prev, { role: 'user', text: label }]); setFormData(d => ({ ...d, [allFields[currentIdx].key]: value })); setCurrentIdx(prev => prev + 1); }, 0); }}
                    className="px-3 py-1.5 bg-violet-50 border border-violet-200 rounded-full text-xs text-violet-700 hover:bg-violet-100">
                    {label}
                  </button>
                );
              })}
              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAnswer()}
                placeholder="직접 입력..."
                className="flex-1 min-w-[120px] px-3 py-1.5 border border-gray-200 rounded-xl text-sm" />
              {input.trim() && (
                <button onClick={handleAnswer}
                  className="px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-medium hover:bg-violet-700 shrink-0">
                  입력
                </button>
              )}
            </div>
          ) : (
            <>
              <input ref={chatInputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAnswer()}
                placeholder="답변을 입력하세요..."
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500"
                autoFocus />
              <button onClick={handleAnswer} disabled={!input.trim()}
                className="px-4 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-40">
                확인
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="border-t p-4 space-y-3">
          <div className="text-center space-y-3">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <p className="text-sm font-semibold text-gray-900">모든 항목 작성 완료!</p>
            <p className="text-xs text-gray-500">왼쪽 표에서 결과를 확인 후 제출해주세요</p>
            <button onClick={onSubmit} disabled={isSubmitting}
              className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50">
              {isSubmitting ? '제출 중...' : '문진표 제출'}
            </button>
            <button onClick={onComplete}
              className="w-full py-2 text-xs text-gray-500 hover:text-gray-700">
              폼으로 돌아가서 수정하기
            </button>
          </div>
        </div>
      )}

      {/* 진행 표시 */}
      {!completed && (
        <div className="px-4 py-2 bg-violet-50 text-[10px] text-violet-500 text-center">
          {currentIdx + 1} / {allFields.length} 항목 · {allFields[currentIdx]?.section}
        </div>
      )}
    </div>
  );
}
