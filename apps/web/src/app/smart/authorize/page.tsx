'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

/**
 * SMART standalone launch 동의 화면 — 외부 앱(예: Cerno)이 `/oauth2/authorize` 로 왔을 때
 * **의료진 본인 확인 + 대상 환자 선택 + 스코프 동의**를 받고 인가 코드를 발급받아 앱으로 돌려보낸다.
 *
 * 왜 필요한가: 종전 authorize 는 무인증으로 즉시 코드를 발급해 토큰에 사용자 신원(fhirUser)이 없었다.
 * 사용자 신원이 없으면 "의료진 본인 권한 범위 내 열람"이라는 전제도 성립하지 않는다.
 * (EHR launch — 차트에서 launch 토큰을 갖고 오는 경로 — 는 이 화면을 거치지 않는다.)
 */
interface ClientInfo { name: string; clientId: string; scopes: string[]; redirectUris: string[] }
interface PatientHit { id: string; mrn: string; familyName?: string | null; givenName?: string | null }

const SCOPE_LABEL: Record<string, string> = {
  'patient/Patient.read': '환자 기본정보', 'patient/Condition.read': '진단',
  'patient/Observation.read': '관찰·활력', 'patient/DiagnosticReport.read': '검사 결과',
  'patient/Procedure.read': '수술·시술', 'patient/MedicationRequest.read': '처방',
  'patient/AllergyIntolerance.read': '알레르기', 'patient/DocumentReference.read': '문서(동의서·첨부)',
  launch: '실행 컨텍스트', openid: '로그인 신원', fhirUser: '의료진 식별',
};

export default function SmartAuthorizePage() {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [picked, setPicked] = useState<PatientHit | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setParams(sp);
    const token = localStorage.getItem('accessToken');
    if (!token) {
      // 미로그인 → HIS 로그인 후 이 화면으로 복귀(?redirect 지원)
      window.location.replace(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    apiClient.setToken(token);
    const cid = sp.get('client_id');
    if (!cid) { setError('client_id 가 없습니다.'); return; }
    apiClient.get<{ data: ClientInfo }>(`/api/v1/smart/authorize/client/${encodeURIComponent(cid)}`)
      .then((r) => setClient(r.data))
      .catch(() => setError('등록되지 않았거나 비활성 상태인 클라이언트입니다.'));
  }, []);

  const scopes = (params?.get('scope') ?? '').split(/\s+/).filter(Boolean);
  const needsPatient = scopes.some((s) => s.startsWith('patient/') || s === 'launch/patient');

  const search = useCallback(async () => {
    if (q.trim().length < 2) return;
    try {
      const r = await apiClient.get<{ data: PatientHit[] | { data: PatientHit[] } }>(`/api/v1/patients?search=${encodeURIComponent(q.trim())}&limit=8`);
      const raw = (r.data as { data?: PatientHit[] })?.data ?? (r.data as PatientHit[]);
      setHits(Array.isArray(raw) ? raw : []);
    } catch { setHits([]); }
  }, [q]);

  const approve = async () => {
    if (!params || !client) return;
    setSubmitting(true); setError(null);
    try {
      const r = await apiClient.post<{ data: { redirectTo: string } }>('/api/v1/smart/authorize/consent', {
        clientId: client.clientId,
        redirectUri: params.get('redirect_uri'),
        scope: params.get('scope') ?? '',
        state: params.get('state') ?? '',
        patientId: picked?.id,
        codeChallenge: params.get('code_challenge') ?? undefined,
        codeChallengeMethod: params.get('code_challenge_method') ?? undefined,
      });
      window.location.replace(r.data.redirectTo); // 앱으로 코드 전달
    } catch (e) {
      setError(e instanceof Error ? e.message : '동의 처리에 실패했습니다.');
      setSubmitting(false);
    }
  };

  const deny = () => {
    const uri = params?.get('redirect_uri');
    if (!uri) { window.close(); return; }
    const url = new URL(uri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('state', params?.get('state') ?? '');
    window.location.replace(url.toString());
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h1 className="text-lg font-bold text-gray-900">외부 앱 접근 승인</h1>
        <p className="text-xs text-gray-500 mt-1">
          아래 앱이 <b>귀하의 권한으로</b> 환자 기록을 <b>읽기</b> 위해 접근을 요청합니다.
        </p>

        {error && <p className="mt-4 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

        {client && (
          <>
            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
              <div className="text-sm font-semibold text-gray-900">{client.name}</div>
              <div className="text-[11px] text-gray-400 break-all">{client.clientId}</div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-700 mb-1.5">요청 권한</div>
              <ul className="space-y-0.5">
                {scopes.map((s) => (
                  <li key={s} className="text-[11px] text-gray-600 flex gap-1.5">
                    <span className="text-gray-300">·</span>
                    <span>{SCOPE_LABEL[s] ?? s}{!client.scopes.includes(s) && <b className="text-rose-600"> (미등록 — 발급 거부됨)</b>}</span>
                  </li>
                ))}
              </ul>
            </div>

            {needsPatient && (
              <div className="mt-4">
                <div className="text-xs font-semibold text-gray-700 mb-1.5">대상 환자 선택 <span className="text-rose-500">*</span></div>
                {picked ? (
                  <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                    <span className="text-xs text-gray-800">{picked.familyName ?? ''}{picked.givenName ?? ''} · {picked.mrn}</span>
                    <button onClick={() => setPicked(null)} className="text-[11px] text-gray-500 hover:text-gray-700">변경</button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-1.5">
                      <input value={q} onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
                        placeholder="환자명 또는 MRN(2자 이상)"
                        className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs" />
                      <button onClick={() => void search()} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">검색</button>
                    </div>
                    {hits.length > 0 && (
                      <ul className="mt-1.5 border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-40 overflow-y-auto">
                        {hits.map((h) => (
                          <li key={h.id}>
                            <button onClick={() => { setPicked(h); setHits([]); }}
                              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-gray-50">
                              {h.familyName ?? ''}{h.givenName ?? ''} <span className="text-gray-400">· {h.mrn}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button onClick={deny} className="flex-1 px-4 py-2 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">거부</button>
              <button onClick={approve} disabled={submitting || (needsPatient && !picked)}
                className="flex-1 px-4 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {submitting ? '처리 중…' : '승인'}
              </button>
            </div>
            <p className="mt-3 text-[10px] text-gray-400">
              승인하면 이 앱은 선택한 환자의 기록을 <b>귀하의 권한 범위 내에서 읽기</b>만 할 수 있습니다.
              모든 접근은 감사 기록에 남습니다. 권한은 관리자가 언제든 회수할 수 있습니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
