'use client';

import { useState } from 'react';

// 브라우저에서는 상대경로 사용((homepage) 규약: apiClient 금지 → fetch)
const API_URL = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL || '');

interface VerifiedPatient { id: string; mrn: string; familyName: string; givenName: string; }

const TYPES = [
  { key: 'QUESTION', label: '질문', icon: '❓', desc: '진료·검사·비용 등 문의' },
  { key: 'COMPLAINT', label: '불만', icon: '😟', desc: '불편·개선이 필요한 점' },
  { key: 'SUGGESTION', label: '건의', icon: '💡', desc: '더 나은 서비스 제안' },
  { key: 'COMPLIMENT', label: '칭찬', icon: '💚', desc: '감사·좋았던 경험' },
] as const;

export default function VocIntake() {
  // 단계: auth → form → done
  const [step, setStep] = useState<'auth' | 'form' | 'done'>('auth');

  // 인증
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [token, setToken] = useState('');
  const [patient, setPatient] = useState<VerifiedPatient | null>(null);

  // 작성
  const [type, setType] = useState<string>('QUESTION');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<{ ticketNo: string; dueAt?: string } | null>(null);

  const handleAuth = async () => {
    if (!mrn.trim() || !dob) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/portal/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mrn: mrn.trim(), dateOfBirth: dob }),
      });
      if (!res.ok) throw new Error('auth failed');
      const json = await res.json();
      const pt = (json.data?.data ?? json.data ?? json) as VerifiedPatient;
      setPatient(pt);
      setToken(json.token ?? '');
      setStep('form');
    } catch {
      setAuthError('환자 정보를 찾을 수 없습니다. 등록번호와 생년월일을 확인해주세요.');
    }
    setAuthLoading(false);
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setSubmitError('제목을 입력해주세요.'); return; }
    if (!body.trim()) { setSubmitError('문의 내용을 입력해주세요.'); return; }
    if (!consent) { setSubmitError('개인정보 수집·이용 동의가 필요합니다.'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/portal/voc/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ type, title: title.trim(), body: body.trim(), consent: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || err?.message || '접수에 실패했습니다.');
      }
      const json = await res.json();
      const t = json.data?.data ?? json.data ?? json;
      setResult({ ticketNo: t.ticketNo, dueAt: t.dueAt });
      setStep('done');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '접수에 실패했습니다.');
    }
    setSubmitting(false);
  };

  const reset = () => {
    setStep('auth'); setMrn(''); setDob(''); setToken(''); setPatient(null);
    setType('QUESTION'); setTitle(''); setBody(''); setConsent(false); setResult(null);
    setAuthError(''); setSubmitError('');
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-5">
        <h2 className="text-lg font-bold text-white">병원에 질문하기</h2>
        <p className="text-sm text-amber-50 mt-0.5">본인 확인 후 질문·건의·불만·칭찬을 남기시면 담당자가 확인 후 답변드립니다.</p>
      </div>

      <div className="p-6">
        {/* ── 1단계: 본인 확인 ── */}
        {step === 'auth' && (
          <div className="max-w-md mx-auto">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">1</span>
              <span className="text-sm font-semibold text-gray-800">본인 확인</span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">환자 등록번호</label>
                <input type="text" value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="진료카드에 적힌 번호"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">생년월일</label>
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
              </div>
              {authError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{authError}</p>}
              <button onClick={handleAuth} disabled={authLoading || !mrn.trim() || !dob}
                className="w-full py-3 bg-amber-500 text-white font-medium rounded-xl hover:bg-amber-600 disabled:opacity-50 transition-colors">
                {authLoading ? '확인 중...' : '본인 확인 후 질문하기'}
              </button>
              <p className="text-center text-xs text-gray-400">개인정보는 안전하게 처리됩니다.</p>
            </div>
          </div>
        )}

        {/* ── 2단계: 질문 작성 ── */}
        {step === 'form' && patient && (
          <div className="max-w-xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">2</span>
                <span className="text-sm font-semibold text-gray-800">질문 작성</span>
              </div>
              <span className="text-xs text-gray-500">{patient.familyName}{patient.givenName}님 · {patient.mrn}</span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">유형</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TYPES.map((t) => (
                    <button key={t.key} onClick={() => setType(t.key)}
                      className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-all ${type === t.key ? 'bg-amber-50 border-amber-300 ring-1 ring-amber-200' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                      <span className="text-xl">{t.icon}</span>
                      <span className={`text-xs font-medium ${type === t.key ? 'text-amber-700' : 'text-gray-700'}`}>{t.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">{TYPES.find((t) => t.key === type)?.desc}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input type="text" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)}
                  placeholder="문의 제목을 입력하세요"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">내용</label>
                <textarea value={body} rows={6} maxLength={5000} onChange={(e) => setBody(e.target.value)}
                  placeholder="문의하실 내용을 자세히 적어주세요."
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none" />
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500" />
                <span className="text-xs text-gray-600 leading-relaxed">
                  개인정보 수집·이용에 동의합니다. 수집 항목(성함·등록번호·문의 내용)은 답변 처리 목적으로만 이용되며 관련 법령에 따라 보관 후 파기됩니다.
                </span>
              </label>

              {submitError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{submitError}</p>}

              <div className="flex gap-2">
                <button onClick={() => setStep('auth')} className="px-4 py-3 text-sm text-gray-500 hover:text-gray-700">이전</button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex-1 py-3 bg-amber-500 text-white font-medium rounded-xl hover:bg-amber-600 disabled:opacity-50 transition-colors">
                  {submitting ? '접수 중...' : '문의 접수'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 3단계: 접수 완료 ── */}
        {step === 'done' && result && (
          <div className="max-w-md mx-auto text-center py-4">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900">문의가 접수되었습니다</h3>
            <p className="text-sm text-gray-500 mt-1">담당자가 확인 후 답변드립니다.</p>
            <div className="bg-gray-50 rounded-xl p-4 mt-4 text-left space-y-2">
              <div className="flex justify-between text-sm"><span className="text-gray-500">접수번호</span><span className="font-mono font-semibold text-gray-800">{result.ticketNo}</span></div>
              {result.dueAt && <div className="flex justify-between text-sm"><span className="text-gray-500">답변 예정</span><span className="font-medium text-gray-800">{new Date(result.dueAt).toLocaleDateString('ko-KR')}</span></div>}
            </div>
            <p className="text-xs text-gray-400 mt-3">진행 상황과 답변은 <a href="/portal" className="text-amber-600 underline">환자 포털 &gt; 서비스 &gt; 나의 문의</a>에서 확인하실 수 있습니다.</p>
            <button onClick={reset} className="mt-4 w-full py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors">
              다른 문의 남기기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
