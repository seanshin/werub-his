'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface Q { id: string; text: string; type: 'likert5' | 'nps' | 'text' }
interface Survey { status: string; templateName: string; patientName?: string; department?: string; questions?: Q[] }
const API = process.env.NEXT_PUBLIC_API_URL || '';

const LIKERT = [
  { v: 1, emoji: '😞', label: '매우 불만족' },
  { v: 2, emoji: '🙁', label: '불만족' },
  { v: 3, emoji: '😐', label: '보통' },
  { v: 4, emoji: '🙂', label: '만족' },
  { v: 5, emoji: '😀', label: '매우 만족' },
];

export default function SurveyFillPage() {
  const { token } = useParams<{ token: string }>();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/api/v1/public/survey/${token}`)
      .then(r => r.json())
      .then(res => setSurvey(res.data))
      .catch(() => setError('설문을 불러올 수 없습니다.'));
  }, [token]);

  const set = (id: string, v: number | string) => setAnswers(p => ({ ...p, [id]: v }));

  const required = (survey?.questions ?? []).filter(q => q.type !== 'text');
  const answeredCount = required.filter(q => answers[q.id] !== undefined && answers[q.id] !== '').length;
  const progress = required.length ? Math.round((answeredCount / required.length) * 100) : 0;
  const allRequired = answeredCount === required.length;

  const submit = async () => {
    if (!allRequired || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${API}/api/v1/public/survey/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }),
      });
      if (!r.ok) throw new Error();
      setDone(true);
    } catch { setError('제출에 실패했습니다. 다시 시도해 주세요.'); }
    setSubmitting(false);
  };

  // 상태 화면
  if (error && !survey) return <Center>{error}</Center>;
  if (!survey) return <Center>불러오는 중…</Center>;
  if (done || survey.status === 'COMPLETED') return (
    <Center>
      <div className="text-6xl mb-4">🙏</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">소중한 의견 감사합니다</h1>
      <p className="text-gray-500">더 나은 진료를 위해 반영하겠습니다.</p>
    </Center>
  );
  if (survey.status === 'EXPIRED') return <Center><div className="text-5xl mb-4">⏰</div><p className="text-gray-600">설문 기간이 만료되었습니다.</p></Center>;

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* 헤더 */}
      <div className="bg-gradient-to-br from-blue-700 to-indigo-700 text-white px-5 pt-8 pb-6 sticky top-0 z-10 shadow-md">
        <div className="max-w-2xl mx-auto">
          <p className="text-blue-200 text-xs font-medium mb-1">위루비병원</p>
          <h1 className="text-xl md:text-2xl font-bold">{survey.templateName}</h1>
          {survey.patientName && <p className="text-blue-100 text-sm mt-1">{survey.patientName}님</p>}
          <div className="mt-4 h-2 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[11px] text-blue-200 mt-1">{answeredCount} / {required.length} 응답</p>
        </div>
      </div>

      {/* 질문 */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4 pb-32">
        {(survey.questions ?? []).map((q, i) => (
          <div key={q.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex gap-2 mb-4">
              <span className="text-blue-600 font-bold text-sm">{i + 1}.</span>
              <h2 className="text-[15px] font-semibold text-gray-900 leading-snug">{q.text}</h2>
            </div>

            {q.type === 'likert5' && (
              <div className="grid grid-cols-5 gap-1.5">
                {LIKERT.map(o => (
                  <button key={o.v} onClick={() => set(q.id, o.v)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all ${answers[q.id] === o.v ? 'border-blue-500 bg-blue-50 scale-105' : 'border-gray-100 hover:border-blue-200'}`}>
                    <span className="text-2xl">{o.emoji}</span>
                    <span className={`text-[10px] leading-tight text-center ${answers[q.id] === o.v ? 'text-blue-700 font-semibold' : 'text-gray-400'}`}>{o.label}</span>
                  </button>
                ))}
              </div>
            )}

            {q.type === 'nps' && (
              <div>
                <div className="grid grid-cols-11 gap-1">
                  {Array.from({ length: 11 }, (_, n) => (
                    <button key={n} onClick={() => set(q.id, n)}
                      className={`aspect-square rounded-lg text-sm font-bold transition-all ${answers[q.id] === n ? 'bg-blue-600 text-white scale-110' : n <= 6 ? 'bg-red-50 text-red-400 hover:bg-red-100' : n <= 8 ? 'bg-amber-50 text-amber-500 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-500 hover:bg-emerald-100'}`}>
                      {n}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 mt-1.5"><span>전혀 아니다</span><span>매우 그렇다</span></div>
              </div>
            )}

            {q.type === 'text' && (
              <textarea value={(answers[q.id] as string) ?? ''} onChange={e => set(q.id, e.target.value)} rows={3}
                placeholder="자유롭게 의견을 적어주세요 (선택)"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 resize-none" />
            )}
          </div>
        ))}
        {error && <p className="text-center text-sm text-red-500">{error}</p>}
      </div>

      {/* 제출 (고정) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-gray-100 p-4">
        <div className="max-w-2xl mx-auto">
          <button onClick={submit} disabled={!allRequired || submitting}
            className="w-full py-4 rounded-2xl text-white font-bold text-base bg-gradient-to-r from-blue-600 to-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition">
            {submitting ? '제출 중…' : allRequired ? '제출하기' : `${required.length - answeredCount}개 항목이 남았습니다`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col items-center justify-center text-center px-6 bg-gradient-to-b from-blue-50 to-white">{children}</div>;
}
