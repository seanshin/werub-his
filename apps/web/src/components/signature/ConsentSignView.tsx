'use client';

import { consentReadableSections } from '@hospital-run/shared';
import { useEffect, useRef, useState } from 'react';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

const API = process.env.NEXT_PUBLIC_API_URL || '';

/** 초진 등록 동의 묶음의 항목(서버 정본 — 문안은 화면이 갖지 않는다) */
interface RegistrationItem { type: string; label: string; required: boolean; law: string; detail: string | null }

interface ConsentData {
  session: { signMode: string; signerType: string; expiresAt?: string };
  /** 있으면 초진 등록 동의 묶음 — 환자가 항목마다 동의·미동의를 고른다(2026-10-02) */
  registrationItems?: RegistrationItem[];
  consent: {
    id: string; templateName: string; type: string; consentType?: string;
    content?: Record<string, unknown>; risks?: string; alternatives?: string; explanation?: string;
    patient?: { familyName: string; givenName: string; mrn: string; dateOfBirth?: string };
    doctor?: { familyName: string; givenName: string };
  };
}

const REL = [
  { k: 'PARENT', l: '부모(친권자)' }, { k: 'SPOUSE', l: '배우자' }, { k: 'CHILD', l: '자녀' }, { k: 'LEGAL_GUARDIAN', l: '법정대리인' },
];

/**
 * 동의서 서명 화면 본문 — /consent-sign/[token] 과 기기 상주 페이지가 공유.
 * onSigned: 서명 제출 성공 콜백(미지정 시 자체 완료 화면 표시).
 */
export function ConsentSignView({ token, onSigned }: { token: string; onSigned?: () => void }) {
  const [data, setData] = useState<ConsentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  const [signerType, setSignerType] = useState<'PATIENT' | 'GUARDIAN'>('PATIENT');
  const [confirmed, setConfirmed] = useState(false);
  const [signedBy, setSignedBy] = useState('');
  const [guardian, setGuardian] = useState({ name: '', relation: 'PARENT' });
  const [submitting, setSubmitting] = useState(false);
  const [empty, setEmpty] = useState(true);
  const padRef = useRef<SignaturePadHandle>(null);
  // 초진 동의 묶음 — 항목별 선택(미선택은 undefined · 직원이 대신 고르지 않는다)
  const [choices, setChoices] = useState<Record<string, boolean | undefined>>({});
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [missingRequired, setMissingRequired] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null); setDone(false); setConfirmed(false);
    fetch(`${API}/api/v1/consent-sign/${token}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error?.message || body?.message || '서명 세션을 불러올 수 없습니다');
        if (!alive) return;
        const d = (body?.data ?? body) as ConsentData;
        setData(d);
        setSignerType((d.session.signerType as 'PATIENT' | 'GUARDIAN') ?? 'PATIENT');
        if (d.session.signerType === 'PATIENT' && d.consent.patient) setSignedBy(`${d.consent.patient.familyName}${d.consent.patient.givenName}`);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [token]);

  const submit = async () => {
    const img = padRef.current?.toDataURL();
    if (!img) { alert('서명을 입력해주세요'); return; }
    if (!signedBy.trim()) { alert('서명자 이름을 입력해주세요'); return; }
    if (signerType === 'GUARDIAN' && !guardian.name.trim()) { alert('보호자 정보를 입력해주세요'); return; }
    const items = data?.registrationItems;
    if (items && !items.every((it) => typeof choices[it.type] === 'boolean')) { alert('모든 항목에 동의 또는 동의하지 않음을 선택해주세요'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/v1/consent-sign/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signatureImage: img, signedBy: signedBy.trim(), signerType,
          ...(signerType === 'GUARDIAN' ? { guardianName: guardian.name.trim(), guardianRelation: guardian.relation, guardianLegalBasis: guardian.relation === 'LEGAL_GUARDIAN' ? 'POA' : 'FAMILY' } : {}),
          ...(items ? { choices } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || body?.message || '서명 제출에 실패했습니다');
      setMissingRequired(((body?.data ?? body)?.registration?.missingRequired as string[] | undefined) ?? []);
      if (onSigned) onSigned(); else setDone(true);
    } catch (e) { alert(e instanceof Error ? e.message : '서명 제출 실패'); }
    setSubmitting(false);
  };

  if (loading) return <Center><div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" /></Center>;
  if (error) return <Center><div className="text-center"><p className="text-4xl mb-3">⚠️</p><p className="text-gray-700 font-medium">{error}</p><p className="text-sm text-gray-400 mt-1">직원에게 다시 요청해주세요.</p></div></Center>;
  if (done) return <Center><div className="text-center" data-sign-done><p className="text-5xl mb-3">✅</p><p className="text-xl font-bold text-gray-900">서명이 완료되었습니다</p><p className="text-sm text-gray-500 mt-2">감사합니다. 이 화면은 닫으셔도 됩니다.</p>
    {missingRequired.length > 0 && <p className="mt-3 text-sm text-amber-700" data-sign-missing-required>필수 항목 중 동의하지 않은 것이 있습니다 — 진료가 제한될 수 있어 직원이 안내해 드립니다.</p>}</div></Center>;
  if (!data) return null;

  const c = data.consent;
  /** 🔴 본문 정본 — 서명 대상 문서(서버 동결 HTML)와 같은 함수(2026-10-12) · 본문이 없으면 지어 채우지 않는다 */
  const readable = consentReadableSections(c);

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8" style={{ fontFamily: "'Pretendard Variable', -apple-system, system-ui, sans-serif" }}>
      <div className="max-w-3xl mx-auto bg-white rounded-3xl shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4">
          <p className="text-xs text-blue-100">위루비병원</p>
          <h1 className="text-lg font-bold">{c.templateName}</h1>
        </div>

        <div className="p-6 space-y-4">
          {c.patient && (
            <div className="bg-gray-50 rounded-xl p-3 text-sm">
              <span className="font-semibold text-gray-900">{c.patient.familyName}{c.patient.givenName}</span>
              <span className="text-gray-500"> · {c.patient.mrn}</span>
              {c.doctor && <span className="text-gray-500"> · 담당 {c.doctor.familyName}{c.doctor.givenName}</span>}
            </div>
          )}

          {data.registrationItems ? (
            <div className="space-y-2" data-registration-items>
              <p className="text-sm text-gray-600">항목마다 <b>동의함</b> 또는 <b>동의하지 않음</b>을 선택해주세요. 필수 항목에 동의하지 않으면 진료가 제한될 수 있습니다. 선택 항목은 동의하지 않아도 진료에 영향이 없습니다.</p>
              {data.registrationItems.map((it) => (
                <div key={it.type} className="rounded-xl border border-gray-100 p-3" data-reg-item={it.type}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" onClick={() => setOpenDetail(openDetail === it.type ? null : it.type)} className="text-left">
                      <span className="text-sm font-semibold text-gray-900">{it.label}</span>
                      <span className={`ml-2 text-xs font-bold ${it.required ? 'text-red-600' : 'text-gray-400'}`}>{it.required ? '필수' : '선택'}</span>
                      <span className="ml-2 text-xs text-blue-600 underline">{openDetail === it.type ? '접기' : '전문 보기'}</span>
                    </button>
                    <div className="flex gap-2">
                      {([[true, '동의함'], [false, '동의하지 않음']] as const).map(([v, l]) => (
                        <button key={String(v)} type="button" onClick={() => setChoices((p) => ({ ...p, [it.type]: v }))} aria-pressed={choices[it.type] === v}
                          className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold ${choices[it.type] === v ? (v ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white') : 'bg-gray-100 text-gray-700'}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">{it.law}</p>
                  {openDetail === it.type && <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">{it.detail ?? '전문이 등록되지 않았습니다 — 직원에게 문의해주세요.'}</p>}
                </div>
              ))}
            </div>
          ) : (
          <div className="max-h-[40vh] overflow-y-auto border border-gray-100 rounded-xl p-4 text-sm text-gray-700 space-y-3 leading-relaxed">
            {!readable.hasBody && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 font-medium text-amber-900" data-consent-no-body>본문이 없는 동의서입니다 — 서명하기 전에 담당 직원에게 동의서 내용을 확인하세요.</p>
            )}
            {readable.sections.map((s, i) => (
              <div key={i}>{s.title && <p className="font-semibold text-gray-900 mb-1">{s.title}</p>}<p className="whitespace-pre-wrap">{s.body}</p></div>
            ))}
          </div>
          )}

          <div className="flex gap-2">
            {([['PATIENT', '본인'], ['GUARDIAN', '보호자']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSignerType(k)}
                className={`flex-1 py-2.5 text-sm rounded-xl border-2 font-medium ${signerType === k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>{l}</button>
            ))}
          </div>
          {signerType === 'GUARDIAN' && (
            <div className="grid grid-cols-2 gap-2">
              <input value={guardian.name} onChange={(e) => { setGuardian({ ...guardian, name: e.target.value }); setSignedBy(e.target.value); }} placeholder="보호자 성명" className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm" />
              <select value={guardian.relation} onChange={(e) => setGuardian({ ...guardian, relation: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white">
                {REL.map((r) => <option key={r.k} value={r.k}>{r.l}</option>)}
              </select>
            </div>
          )}
          {signerType === 'PATIENT' && (
            <input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="본인 성명" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm" />
          )}

          <label className="flex items-start gap-2.5 text-sm text-gray-700">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 rounded" />
            {data.registrationItems ? '위 항목별 선택은 본인(또는 법정대리인)의 의사와 같습니다.' : '위 내용을 충분히 설명받고 이해하였으며, 이에 동의합니다.'}
          </label>

          <SignaturePad ref={padRef} onChange={setEmpty} />

          <button onClick={submit} disabled={!confirmed || empty || submitting || !signedBy.trim() || (!!data.registrationItems && !data.registrationItems.every((it) => typeof choices[it.type] === 'boolean'))}
            className="w-full py-3.5 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {submitting ? '제출 중...' : data.registrationItems ? '선택한 대로 서명 제출' : '동의하고 서명 제출'}
          </button>
          <p className="text-[10px] text-gray-400 text-center">⚖️ 의료법 제24조의2 설명·동의 · 제22조에 따라 의무기록으로 보존됩니다</p>
        </div>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">{children}</div>;
}
