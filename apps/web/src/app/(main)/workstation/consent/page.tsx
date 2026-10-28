'use client';

import { useState, useEffect, useRef } from 'react';
import { consentTypeText, isKnownConsentType, AI_ORIGIN_TEXT, RECORDING_CONSENT_DRAFT, recordingConsentDraftText } from '@hospital-run/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import SmartSignButton from '@/components/signature/SmartSignButton';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { QrImage } from '@/components/ui/QrImage';
import { DraftBanner, recordDraftApplied, warnIfDraftNotRecorded, type DraftProvenance } from '@/components/ai/DraftBanner';
import { proposalIdFrom, markProposalPresented } from '@/lib/ai-proposal';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Patient { id: string; familyName: string; givenName: string; mrn: string }
interface Template { id: string; name: string; type: string; consentType?: string }
interface ConsentItem {
  id: string; templateName: string; type: string; consentType?: string; status: string;
  stage: 'AWAIT_DOCTOR' | 'AWAIT_NURSE' | 'AWAIT_PATIENT' | 'AWAIT_WITNESS' | 'AWAIT_FINALIZE' | 'COMPLETED';
  doctorSigned?: boolean; nurseChecked?: boolean;
  signerType?: string; guardianName?: string; createdAt: string;
  patient?: Patient | null;
  doctor?: { id: string; familyName: string; givenName: string } | null;
  openSession?: { token: string; expiresAt: string } | null;
}
interface Stats { requested: number; pending: number; completed: number; expired: number }

// label 은 표시 문자열이 아니라 **t() 키**다(소비처가 `<T k=…>`)
const STAGE: Record<string, { label: string; cls: string }> = {
  AWAIT_DOCTOR: { label: '의사 사전 확인·서명', cls: 'bg-amber-100 text-amber-700' },
  AWAIT_NURSE: { label: '간호사 사전 확인', cls: 'bg-amber-100 text-amber-700' },
  AWAIT_PATIENT: { label: '환자/보호자 서명 대기', cls: 'bg-red-100 text-red-700' },
  AWAIT_WITNESS: { label: '증인 서명 대기', cls: 'bg-amber-100 text-amber-700' },
  AWAIT_FINALIZE: { label: '완료 처리 대기', cls: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: '완료', cls: 'bg-emerald-100 text-emerald-700' },
};
const CONSENT_TYPES = [
  // 선택 UI 순서용 코드 목록 — **라벨은 shared 정본에서 가져온다**(로컬 재정의 금지)
  // 🔴 집합은 shared `CONSENT_TYPE_CODES`(= Prisma enum) 와 일치해야 한다 — 가드 `test/architecture/consent-type-list-canon.spec.ts`.
  //    2026-09-22 까지 RECORDING 이 빠져 있어 서버가 요구하는 진료 녹음 동의를 **만들 화면이 없었다**(voice-emr §13.2 P0-2).
  'SURGERY', 'ANESTHESIA', 'PROCEDURE', 'TRANSFUSION', 'RESEARCH', 'DNR', 'TREATMENT', 'GENERAL', 'RECORDING',
].map((k) => ({ k, l: consentTypeText(k) }));

/**
 * 동의서 초안 본문 = 위험·대안·설명을 **고정 순서·고정 구분자**로 이은 것.
 *
 * 🔴 서버 정본 `apps/api/src/modules/consent/consent.service.ts` 의 `consentDraftText` 와 **한 벌**이다.
 *    한쪽만 바꾸면 수정량(편집거리)이 사람이 고치지 않은 만큼 부풀려진다(P11).
 *    비어 있는 항목도 자리를 지킨다(`filter(Boolean)` 금지).
 * 🔴 `page.tsx` 는 Next 가 허용한 export 외에는 내보낼 수 없다(내보내면 `next build` 가 깨진다) —
 *    그래서 모듈 지역 함수로 둔다. 가드는 import 가 아니라 **소스 대조**로 이 계약을 지킨다.
 */
function consentDraftText(s: { risks?: string | null; alternatives?: string | null; explanation?: string | null }): string {
  return [s.risks ?? '', s.alternatives ?? '', s.explanation ?? ''].join('\n\n');
}

interface Device { id: string; name: string; location?: string; approvalStatus: string; status: string; online: boolean }
interface Staff { id: string; familyName: string; givenName: string; role: string; department?: string }

export default function ConsentWorkstationPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isDoctor = currentUser?.role === 'DOCTOR';
  const [tab, setTab] = useState<'queue' | 'devices'>('queue');
  const [filter, setFilter] = useState<string>('');
  const [showNew, setShowNew] = useState(false);
  const [sessionModal, setSessionModal] = useState<{ token: string } | null>(null);
  const [dispatchFor, setDispatchFor] = useState<string | null>(null); // consentId 대기
  const [logFor, setLogFor] = useState<string | null>(null); // 블록체인 로그 볼 consentId

  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({ queryKey: ['cw-stats'], queryFn: () => apiClient.get<{ data: Stats }>('/api/v1/consent/workstation/stats'), refetchInterval: pollMs('fast') });
  const stats = (statsData?.data as { data?: Stats })?.data ?? (statsData?.data as Stats | null);

  const { data: listData, isError: listIsError, error: listError, refetch: refetchList } = useQuery({
    queryKey: ['cw-queue', filter],
    queryFn: () => apiClient.get<{ data: ConsentItem[] }>(`/api/v1/consent/workstation/queue${filter ? `?status=${filter}` : ''}`),
    refetchInterval: 8000,
  });
  const items = ((listData?.data as { data?: ConsentItem[] })?.data ?? listData?.data ?? []) as ConsentItem[];

  const sessionMut = useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: { token: string } }>(`/api/v1/consent/${id}/sign-session`, { signMode: 'TABLET', signerType: 'PATIENT' }),
    onSuccess: (res) => {
      const d = (res?.data as { data?: { token: string } })?.data ?? (res?.data as { token: string });
      if (d?.token) setSessionModal({ token: d.token });
      qc.invalidateQueries({ queryKey: ['cw-queue'] });
    },
    onError: () => toast.error('서명 세션 생성 실패'),
  });
  const doctorSignMut = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/consent/${id}/doctor-sign`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cw-queue'] }); toast.success('의사 서명 완료'); } });
  const witnessSignMut = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/consent/${id}/witness-sign`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cw-queue'] }); toast.success('증인 서명 완료'); } });
  const nurseCheckMut = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/consent/${id}/nurse-check`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cw-queue'] }); toast.success('간호사 사전 확인 완료'); } });

  // 등록 기기 목록 (디스패치 picker + 기기 탭 공용)
  const { data: devData, isError: devIsError, error: devError, refetch: refetchDevices } = useQuery({ queryKey: ['cw-devices'], queryFn: () => apiClient.get<{ data: Device[] }>('/api/v1/consent-devices'), refetchInterval: 8000 });
  const devices = ((devData?.data as { data?: Device[] })?.data ?? devData?.data ?? []) as Device[];
  const pendingCount = devices.filter(d => d.approvalStatus === 'PENDING').length;

  const dispatchMut = useMutation({
    mutationFn: ({ deviceId, consentId }: { deviceId: string; consentId: string }) => apiClient.post(`/api/v1/consent-devices/${deviceId}/dispatch`, { consentId }),
    onSuccess: () => { setDispatchFor(null); qc.invalidateQueries({ queryKey: ['cw-queue'] }); qc.invalidateQueries({ queryKey: ['cw-devices'] }); toast.success('기기로 전송했습니다'); },
    onError: () => toast.error('전송 실패 (승인된 대기 기기인지 확인)'),
  });

  // 실시간 SSE — 환자/보호자 서명 시 즉시 갱신 (폴링은 백업)
  useEffect(() => {
    const token = apiClient.getToken();
    if (!token) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/consent/workstation/stream`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n'); buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            qc.invalidateQueries({ queryKey: ['cw-queue'] });
            qc.invalidateQueries({ queryKey: ['cw-stats'] });
            qc.invalidateQueries({ queryKey: ['cw-devices'] });
          }
        }
      } catch { /* abort/network — 폴링이 백업 */ }
    })();
    return () => ctrl.abort();
  }, [qc]);

  const signUrl = (token: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/consent-sign/${token}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="동의서 워크스테이션" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="환자·보호자에게 설명 후 태블릿/PC에서 서명받기" /></p>
        </div>
        {tab === 'queue' && <button onClick={() => setShowNew(v => !v)} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">+ <T k="동의서 요청" /></button>}
      </div>

      <div className="flex gap-2 mb-5">
        {/* 🔴 라벨과 건수를 분리한다 — 보간 문자열은 t() 키가 될 수 없다(ko 렌더 문자는 동일) */}
        {([['queue', '동의서'], ['devices', '서명 기기']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === k ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200'} ${k === 'devices' && pendingCount ? 'ring-2 ring-amber-300' : ''}`}><T k={l} />{k === 'devices' && pendingCount ? <> ({pendingCount} <T k="승인대기" />)</> : ''}</button>
        ))}
      </div>

      {tab === 'devices' && <DevicesTab devices={devices} isError={devIsError} error={devError} onRetry={() => refetchDevices()} />}

      {tab === 'queue' && <>
      {statsIsError && <QueryErrorFallback error={statsError} onRetry={() => refetchStats()} size="compact" className="mb-5" />}
      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[{ l: '오늘 요청', v: stats.requested, c: 'text-gray-900' }, { l: '서명 대기', v: stats.pending, c: 'text-red-600' }, { l: '오늘 완료', v: stats.completed, c: 'text-emerald-600' }, { l: '만료', v: stats.expired, c: 'text-amber-600' }].map(s => (
            <div key={s.l} className="bg-white rounded-2xl border border-gray-100 p-4 text-center"><p className={`text-2xl font-bold ${s.c}`}>{s.v}</p><p className="text-[11px] text-gray-500 mt-0.5"><T k={s.l} /></p></div>
          ))}
        </div>
      )}

      {showNew && <NewConsentPanel onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['cw-queue'] }); qc.invalidateQueries({ queryKey: ['cw-stats'] }); }} />}

      <div className="flex gap-2 mb-4">
        {[{ k: '', l: '전체' }, { k: 'PENDING', l: '진행 중' }, { k: 'SIGNED', l: '완료' }].map(t => (
          <button key={t.k} onClick={() => setFilter(t.k)} className={`px-3.5 py-1.5 rounded-lg text-xs font-medium ${filter === t.k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}><T k={t.l} /></button>
        ))}
      </div>

      <div className="space-y-2.5">
        {listIsError ? <QueryErrorFallback error={listError} onRetry={() => refetchList()} /> : items.length === 0 ? <EmptyState icon="📄" title="동의서가 없습니다" /> : items.map(c => {
          const st = STAGE[c.stage] ?? STAGE.AWAIT_PATIENT;
          return (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{c.patient ? `${c.patient.familyName}${c.patient.givenName} · ${c.patient.mrn}` : '환자'}</p>
                    {/* 🔴 종전 `?? c.type` 이 **영문 코드를 그대로 노출**했다(GENERAL·TREATMENT·DNR).
                         라벨은 shared 정본만 쓴다 — 로컬표는 서버와 갈라져 있었다(DNR: 연명의료 vs DNR). */}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${isKnownConsentType(c.consentType, c.type) ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-700'}`}
                      title={isKnownConsentType(c.consentType, c.type) ? undefined : '라벨이 등록되지 않은 동의서 유형입니다'}
                    >
                      {consentTypeText(c.consentType, c.type)}
                    </span>
                    {c.guardianName && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">보호자 {c.guardianName}</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{c.templateName}{c.doctor ? ` · 담당의 ${c.doctor.familyName}${c.doctor.givenName}` : ''}</p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}><T k={st.label} /></span>
              </div>
              <div className="flex gap-2 mt-3">
                {c.stage === 'AWAIT_PATIENT' && <>
                  <button onClick={() => setDispatchFor(c.id)} className="flex-1 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg">📲 <T k="기기로 보내기" /></button>
                  {c.openSession
                    ? <button onClick={() => setSessionModal({ token: c.openSession!.token })} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg"><T k="링크" /></button>
                    : <button onClick={() => sessionMut.mutate(c.id)} disabled={sessionMut.isPending} className="min-h-[44px] px-3 py-2 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg disabled:opacity-50"><T k="링크 생성" /></button>}
                </>}
                {c.stage === 'AWAIT_DOCTOR' && (
                  isDoctor
                    ? <div className="flex-1"><SmartSignButton documentType="CONSENT" documentId={c.id} documentTitle={c.templateName} patientName={c.patient ? `${c.patient.familyName}${c.patient.givenName}` : undefined} label="의사 서명" variant="small" onSign={() => doctorSignMut.mutate(c.id)} /></div>
                    : <div className="flex-1 py-1.5 text-center text-xs text-amber-700 bg-amber-50 rounded-lg border border-amber-200"><T k="담당 의사 로그인 후 서명" /></div>
                )}
                {c.stage === 'AWAIT_NURSE' && <button onClick={() => nurseCheckMut.mutate(c.id)} disabled={nurseCheckMut.isPending} className="flex-1 min-h-[44px] px-3 py-2 bg-amber-600 text-white text-xs font-medium rounded-lg disabled:opacity-50"><T k="간호사 사전 확인" /> ({currentUser?.familyName}{currentUser?.givenName})</button>}
                {c.stage === 'AWAIT_WITNESS' && <button onClick={() => witnessSignMut.mutate(c.id)} disabled={witnessSignMut.isPending} className="flex-1 min-h-[48px] py-3 bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50"><T k="증인 서명" /> ({currentUser?.familyName}{currentUser?.givenName})</button>}
                <button onClick={() => setLogFor(c.id)} title="블록체인 서명 기록" className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">🔗</button>
                <a href={`/print/consent/${c.id}`} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">PDF</a>
              </div>
            </div>
          );
        })}
      </div>
      </>}

      {/* 기기로 보내기 — 기기 선택 모달 */}
      {dispatchFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDispatchFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1"><T k="기기로 보내기" /></h3>
            <p className="text-xs text-gray-500 mb-4"><T k="동의서를 표시할 태블릿을 선택하세요. 선택 즉시 해당 화면에 나타납니다." /></p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {devIsError ? (
                <QueryErrorFallback error={devError} onRetry={() => refetchDevices()} size="compact" />
              ) : devices.filter(d => d.approvalStatus === 'APPROVED').length === 0 ? (
                <EmptyState icon="✍️" title="등록된 기기가 없습니다." hint={'"서명 기기" 탭에서 등록하세요.'} />
              ) : devices.filter(d => d.approvalStatus === 'APPROVED').map(d => {
                const busy = d.status !== 'IDLE';
                return (
                  <button key={d.id} disabled={busy || !d.online || dispatchMut.isPending} onClick={() => dispatchMut.mutate({ deviceId: d.id, consentId: dispatchFor })}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-white">
                    <span className="text-sm font-medium text-gray-900">{d.name}{d.location ? ` · ${d.location}` : ''}</span>
                    <span className={`text-[11px] font-bold ${!d.online ? 'text-gray-400' : busy ? 'text-amber-600' : 'text-emerald-600'}`}>{!d.online ? <T k="오프라인" /> : busy ? <T k="사용중" /> : <>● <T k="대기" /></>}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setDispatchFor(null)} className="mt-4 w-full py-2 text-xs text-gray-400"><T k="닫기" /></button>
          </div>
        </div>
      )}

      {/* 블록체인 서명 기록 모달 */}
      {logFor && <BlockchainLogModal consentId={logFor} onClose={() => setLogFor(null)} />}

      {/* 서명 링크 모달 */}
      {sessionModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSessionModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1"><T k="서명 받기" /></h3>
            <p className="text-xs text-gray-500 mb-4"><T k="태블릿에서 아래 링크를 열거나, 이 기기에서 바로 서명하세요. (5분 후 만료)" /></p>
            <div className="bg-gray-50 rounded-xl p-3 text-[11px] text-gray-600 break-all mb-3">{signUrl(sessionModal.token)}</div>
            <div className="flex gap-2">
              <button onClick={() => { navigator.clipboard?.writeText(signUrl(sessionModal.token)); toast.success('링크 복사됨'); }} className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl"><T k="링크 복사" /></button>
              <a href={signUrl(sessionModal.token)} target="_blank" rel="noopener noreferrer" className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl"><T k="이 기기에서 서명" /></a>
            </div>
            <button onClick={() => setSessionModal(null)} className="mt-3 text-xs text-gray-400"><T k="닫기" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 동의서 요청 패널 ── */
function NewConsentPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [consentType, setConsentType] = useState('SURGERY');
  const [templateId, setTemplateId] = useState('');
  const [procedureName, setProcedureName] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [nurseId, setNurseId] = useState('');
  const [form, setForm] = useState({ risks: '', alternatives: '', explanation: '' });
  // 🔴 초안≠확정 — AI 가 채운 위험·대안·설명은 서명 전 초안이다(프로비넌스 → 감사 원장·§7.6-b)
  const [aiDraftProvenance, setAiDraftProvenance] = useState<DraftProvenance | null>(null);
  /** 서버 제안 원장 id — 없으면 null(제안이 기록되지 않았다는 사실이지, 기록된 척하지 않는다) */
  const [aiProposalId, setAiProposalId] = useState<string | null>(null);
  /** AI 가 낸 그대로의 초안 본문 — 저장 시점 본문과 비교해 수락/수정을 가른다 */
  const [aiDraftText, setAiDraftText] = useState<string | null>(null);
  const presentedRef = useRef<string | null>(null);
  const [signerType, setSignerType] = useState<'PATIENT' | 'GUARDIAN'>('PATIENT');
  const isRecording = consentType === 'RECORDING';
  /**
   * 유형 선택. RECORDING 이면 설명 요지가 비어 있을 때만 법무 초안(검토 전)을 채운다 —
   * 사람이 적은 글을 덮지 않는다. 환자가 서명 화면(`ConsentSignView`)에서 보는 본문은 risks/alternatives/explanation 이다.
   */
  const selectType = (k: string) => {
    setConsentType(k);
    setTemplateId('');
    if (k === 'RECORDING' && !form.explanation.trim()) setForm(f => ({ ...f, explanation: recordingConsentDraftText() }));
  };

  const { data: pData, isError: pIsError, error: pError, refetch: refetchPatients } = useQuery({
    queryKey: ['cw-patients', q],
    queryFn: () => apiClient.get<{ data: Patient[] }>(`/api/v1/patients/smart-list?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2 && !patient,
  });

  // 직원 목록 (의사/간호사 배정)
  const { data: uData, isError: uIsError, error: uError, refetch: refetchStaff } = useQuery({ queryKey: ['cw-staff-all'], queryFn: () => apiClient.get<{ data: Staff[] }>('/api/v1/users') });
  const allStaff = ((uData?.data as { data?: Staff[] })?.data ?? uData?.data ?? []) as Staff[];
  const doctors = allStaff.filter(u => u.role === 'DOCTOR');
  const nurses = allStaff.filter(u => u.role === 'NURSE');

  // WeRU.B 동의서 내용 생성
  const aiMut = useMutation({
    mutationFn: () => apiClient.post<{ data: { risks: string; alternatives: string; explanation: string; proposalId?: string | null } }>('/api/v1/consent/ai-generate', { consentType, procedureName: procedureName || CONSENT_TYPES.find(t => t.k === consentType)?.l, patientId: patient?.id }),
    onSuccess: (res) => {
      const d = (res?.data as { data?: { risks: string; alternatives: string; explanation: string } })?.data ?? (res?.data as { risks: string; alternatives: string; explanation: string });
      if (d) {
        setForm({ risks: d.risks || '', alternatives: d.alternatives || '', explanation: d.explanation || '' });
        // 🔴 노출(PRESENTED)은 초안이 실제로 폼에 그려진 지금 1회만. 제안 id 가 없으면 보고할 대상이 없다.
        const pid = proposalIdFrom(res?.data);
        setAiProposalId(pid);
        setAiDraftText(consentDraftText(d));
        if (pid && presentedRef.current !== pid) {
          presentedRef.current = pid;
          void markProposalPresented(pid, 'workstation-consent');
        }
        setAiDraftProvenance({ source: 'GENERATOR', fields: ['위험', '대안', '설명'], appliedAt: new Date().toISOString(), model: null, recorded: null, proposalId: pid });
        // 🔴 여기서는 감사 원장만 남긴다(`proposalId` 미전달) — 사람이 아직 아무것도 결정하지 않았다.
        //    이 자리에서 ACCEPTED 를 찍으면 "읽기도 전에 수락"이 원장에 남는다(P16).
        void recordDraftApplied({ resourceType: 'CONSENT', source: 'GENERATOR', patientId: patient?.id, field: 'risks,alternatives,explanation', textLength: (d.risks?.length ?? 0) + (d.alternatives?.length ?? 0) + (d.explanation?.length ?? 0) })
          .then((recorded) => setAiDraftProvenance((prev) => (prev ? { ...prev, recorded } : prev)));
        toast.success(`${AI_ORIGIN_TEXT}가 동의서 내용을 생성했습니다`);
      }
    },
    onError: () => toast.error(`${AI_ORIGIN_TEXT} 생성 실패 (잠시 후 재시도)`),
  });
  const patients = ((pData?.data as { data?: Patient[] })?.data ?? pData?.data ?? []) as Patient[];

  const { data: tData, isError: tIsError, error: tError, refetch: refetchTemplates } = useQuery({
    queryKey: ['cw-templates', consentType],
    queryFn: () => apiClient.get<{ data: Template[] }>('/api/v1/consent-templates'),
  });
  const templates = (((tData?.data as { data?: Template[] })?.data ?? tData?.data ?? []) as Template[]).filter(t => !t.consentType || t.consentType === consentType);

  const createMut = useMutation({
    mutationFn: () => {
      const tpl = templates.find(t => t.id === templateId);
      return apiClient.post('/api/v1/consent', {
        patientId: patient!.id,
        type: consentType,
        consentType,
        templateName: procedureName.trim() || tpl?.name || (CONSENT_TYPES.find(t => t.k === consentType)?.l + ' 동의서'),
        templateId: templateId || undefined,
        content: procedureName ? { title: procedureName } : {},
        risks: form.risks || undefined,
        alternatives: form.alternatives || undefined,
        explanation: form.explanation || undefined,
        doctorId: doctorId || undefined,
        nurseId: nurseId || undefined,
        signerType,
      });
    },
    onSuccess: (res) => {
      // 🔴 **사람의 결정은 여기서 일어난다** — 초안이 폼에 들어간 순간이 아니라, 사람이 그 본문으로 동의서를 만든 순간.
      //    최종본을 그대로 보내 서버가 수정량을 재게 한다(초안과 같으면 수락, 다르면 수정 — 우리가 0 으로 접지 않는다).
      if (aiProposalId) {
        const finalText = consentDraftText(form);
        const createdRaw = (res as { data?: { data?: { id?: unknown }; id?: unknown } } | undefined)?.data;
        const createdId = (createdRaw as { data?: { id?: unknown } } | undefined)?.data?.id ?? (createdRaw as { id?: unknown } | undefined)?.id;
        void recordDraftApplied({
          resourceType: 'CONSENT',
          source: 'GENERATOR',
          patientId: patient?.id,
          ...(typeof createdId === 'string' ? { resourceId: createdId } : {}),
          field: 'risks,alternatives,explanation',
          textLength: finalText.length,
          proposalId: aiProposalId,
          decision: aiDraftText != null && finalText === aiDraftText ? 'ACCEPTED' : 'EDITED',
          finalText,
          // 어느 동의서가 됐는지는 전이의 clientContext 에만 남는다(생성 시점엔 대상 행이 없었다)
          clientContext: typeof createdId === 'string' ? `consent-form:${createdId}` : 'workstation-consent',
        }).then((recorded) => warnIfDraftNotRecorded(recorded, tAttr)); // 생성 후 폼이 닫힌다 — 실패는 여기서 말한다
      }
      toast.success('동의서가 생성되었습니다'); onCreated();
    },
    onError: () => toast.error('동의서 생성 실패'),
  });

  return (
    <div className="bg-white rounded-2xl border-2 border-blue-200 p-4 mb-5 space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-gray-900"><T k="동의서 요청" /></h3><button onClick={onClose} className="text-gray-400">✕</button></div>

      {/* 환자 검색 */}
      {patient ? (
        <div className="flex items-center justify-between bg-blue-50 rounded-xl px-3 py-2">
          <span className="text-sm font-medium text-gray-900">{patient.familyName}{patient.givenName} · {patient.mrn}</span>
          <button onClick={() => { setPatient(null); setQ(''); }} className="text-xs text-blue-600"><T k="변경" /></button>
        </div>
      ) : (
        <div className="relative">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tAttr('환자명/MRN 검색 (2자 이상)')} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm" />
          {pIsError && <QueryErrorFallback error={pError} onRetry={() => refetchPatients()} size="compact" className="mt-1" />}
          {patients.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {patients.slice(0, 8).map(p => (
                <button key={p.id} onClick={() => setPatient(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">{p.familyName}{p.givenName} · {p.mrn}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 동의서 유형 */}
      <div className="flex flex-wrap gap-1.5">
        {CONSENT_TYPES.map(t => (
          <button key={t.k} onClick={() => selectType(t.k)} className={`px-2.5 py-1 text-xs rounded-lg border ${consentType === t.k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>{t.l}</button>
        ))}
      </div>

      {/* 🔴 RECORDING — 문안은 법무 검토 전 초안(shared 정본 `RECORDING_CONSENT_DRAFT`). 확정된 것처럼 그리지 않는다. */}
      {isRecording && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 space-y-1">
          <p>
            <span className="mr-1.5 rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"><T k="법무 검토 전 초안" /></span>
            <T k="진료 녹음 동의서 문안은 법무 검토 전 초안(2026-07-07)입니다. 설명 요지에 초안이 채워지며, [ ] 항목은 기관이 확정하기 전까지 비어 있습니다. 확정 문안이 아닙니다." />
          </p>
          <p className="text-amber-700">
            <T k="미확정 항목" />: {RECORDING_CONSENT_DRAFT.unresolved.join(' · ')}
          </p>
          {form.explanation !== recordingConsentDraftText() && (
            <button type="button" onClick={() => setForm(f => ({ ...f, explanation: recordingConsentDraftText() }))} className="text-[11px] text-blue-700 underline underline-offset-2"><T k="초안 다시 채우기" /></button>
          )}
        </div>
      )}

      {/* 시술/수술명 + WeRU.B 생성 — RECORDING 은 법무 문안이라 생성 대상이 아니다 */}
      <div className="flex gap-2">
        <input value={procedureName} onChange={e => setProcedureName(e.target.value)} placeholder={tAttr('시술/수술명 (예: 심장 스텐트 삽입술)')} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <button onClick={() => aiMut.mutate()} disabled={aiMut.isPending || !procedureName.trim() || isRecording}
          title={isRecording ? tAttr('진료 녹음 동의서 문안은 자동 생성하지 않습니다(법무 초안 사용)') : `${AI_ORIGIN_TEXT}로 위험·대안·설명 자동 작성`}
          className="px-3 py-2 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-40 whitespace-nowrap">{aiMut.isPending ? '생성 중…' : `✨ ${AI_ORIGIN_TEXT} 생성`}</button>
      </div>

      {/* 담당 의사/간호사 배정 */}
      {uIsError && <QueryErrorFallback error={uError} onRetry={() => refetchStaff()} size="compact" />}
      <div className="grid grid-cols-2 gap-2">
        <select value={doctorId} onChange={e => setDoctorId(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white">
          <option value="">{tAttr('담당 의사 선택')}</option>
          {doctors.map(u => <option key={u.id} value={u.id}>{u.familyName}{u.givenName}{u.department ? ` · ${u.department}` : ''}</option>)}
        </select>
        <select value={nurseId} onChange={e => setNurseId(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white">
          <option value="">{tAttr('담당 간호사 선택(선택)')}</option>
          {nurses.map(u => <option key={u.id} value={u.id}>{u.familyName}{u.givenName}{u.department ? ` · ${u.department}` : ''}</option>)}
        </select>
      </div>

      {/* 템플릿 + 서명자 */}
      {tIsError && <QueryErrorFallback error={tError} onRetry={() => refetchTemplates()} size="compact" />}
      <div className="grid grid-cols-2 gap-2">
        <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white">
          <option value="">{tAttr('템플릿 선택(선택)')}</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="flex gap-1">
          {([['PATIENT', '본인'], ['GUARDIAN', '보호자']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSignerType(k)} className={`flex-1 py-2 text-xs rounded-lg border ${signerType === k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}><T k={l} /></button>
          ))}
        </div>
      </div>

      {aiMut.isPending && <p className="text-[11px] text-violet-600">{AI_ORIGIN_TEXT}가 위험·대안·설명을 작성 중입니다… (의료진 검토 필수)</p>}
      <DraftBanner provenance={aiDraftProvenance} signLabel="서명" />
      <textarea value={form.risks} onChange={e => setForm({ ...form, risks: e.target.value })} rows={2} placeholder={tAttr('위험·합병증 (선택)')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" />
      <textarea value={form.alternatives} onChange={e => setForm({ ...form, alternatives: e.target.value })} rows={2} placeholder={tAttr('대체 치료법 (선택)')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" />
      <textarea value={form.explanation} onChange={e => setForm({ ...form, explanation: e.target.value })} rows={2} placeholder={tAttr('설명 요지 (구두 설명 내용)')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" />

      <button onClick={() => createMut.mutate()} disabled={!patient || createMut.isPending} className="w-full min-h-[44px] px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50"><T k={createMut.isPending ? '생성 중...' : '동의서 생성'} /></button>
    </div>
  );
}

/* ── 서명 기기 관리 탭 ── */
function DevicesTab({ devices, isError, error, onRetry }: { devices: Device[]; isError: boolean; error: unknown; onRetry: () => void }) {
  const qc = useQueryClient();
  const [showReg, setShowReg] = useState(false);
  const approve = useMutation({ mutationFn: (id: string) => apiClient.post(`/api/v1/consent-devices/${id}/approve`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cw-devices'] }); toast.success('기기를 승인했습니다'); } });
  const reject = useMutation({ mutationFn: (id: string) => apiClient.post(`/api/v1/consent-devices/${id}/reject`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cw-devices'] }); toast.success('등록을 거부했습니다'); } });
  const recall = useMutation({ mutationFn: (id: string) => apiClient.post(`/api/v1/consent-devices/${id}/recall`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cw-devices'] }); toast.success('전송을 회수했습니다'); } });
  const remove = useMutation({ mutationFn: (id: string) => apiClient.del(`/api/v1/consent-devices/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cw-devices'] }); toast.success('기기를 해제했습니다'); } });

  const pending = devices.filter(d => d.approvalStatus === 'PENDING');
  const approved = devices.filter(d => d.approvalStatus === 'APPROVED');
  // l 은 t() 키(소비처가 `<T k=…>`)
  const STATUS_L: Record<string, { l: string; c: string }> = { IDLE: { l: '대기 중', c: 'text-emerald-600' }, DISPATCHED: { l: '서명 진행 중', c: 'text-amber-600' }, SIGNING: { l: '서명 중', c: 'text-amber-600' } };

  return (
    <div className="space-y-5">
      <div className="flex justify-end"><button onClick={() => setShowReg(true)} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">+ <T k="기기 등록 (QR)" /></button></div>

      {pending.length > 0 && (
        <div>
          <p className="text-xs font-bold text-amber-700 mb-2"><T k="승인 대기" /> ({pending.length})</p>
          <div className="space-y-2">
            {pending.map(d => (
              <div key={d.id} className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between">
                <div><p className="text-sm font-bold text-gray-900">🆕 {d.name}</p><p className="text-[11px] text-gray-500"><T k={d.online ? '온라인' : '오프라인'} /> · <T k="등록 요청" /></p></div>
                <div className="flex gap-2">
                  <button onClick={() => approve.mutate(d.id)} disabled={approve.isPending} className="min-h-[44px] px-3 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"><T k="승인@행위" /></button>
                  <button onClick={() => reject.mutate(d.id)} disabled={reject.isPending} className="min-h-[44px] px-3 py-2 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg"><T k="거부@행위" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-bold text-gray-500 mb-2"><T k="등록된 기기" /> ({approved.length})</p>
        {isError ? <QueryErrorFallback error={error} onRetry={onRetry} size="compact" /> : approved.length === 0 ? <EmptyState icon="🖥️" title="등록된 기기가 없습니다." hint={'"기기 등록"으로 태블릿을 추가하세요.'} /> : (
          <div className="space-y-2">
            {approved.map(d => {
              const st = STATUS_L[d.status] ?? STATUS_L.IDLE;
              return (
                <div key={d.id} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${d.online ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                    <div>
                      <p className="text-sm font-bold text-gray-900">{d.name}{d.location ? ` · ${d.location}` : ''}</p>
                      <p className="text-[11px]"><span className={d.online ? st.c : 'text-gray-400'}><T k={d.online ? st.l : '오프라인'} /></span></p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {d.status !== 'IDLE' && <button onClick={() => recall.mutate(d.id)} disabled={recall.isPending} className="min-h-[44px] px-3 py-2 border border-amber-200 text-amber-700 text-xs font-medium rounded-lg"><T k="회수@행위" /></button>}
                    <button onClick={() => { if (confirm(`${d.name} 기기를 해제할까요?`)) remove.mutate(d.id); }} className="min-h-[44px] px-3 py-2 border border-gray-200 text-gray-500 text-xs font-medium rounded-lg"><T k="해제@페어링" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showReg && <DeviceRegisterModal onClose={() => setShowReg(false)} />}
    </div>
  );
}

/* ── 기기 등록 모달 (QR + 인증코드) ── */
function DeviceRegisterModal({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ code: string; expiresAt: string } | null>(null);
  const [left, setLeft] = useState(300);
  const issue = useMutation({
    mutationFn: () => apiClient.post<{ data: { code: string; expiresAt: string } }>('/api/v1/consent-devices/pairing-code', {}),
    onSuccess: (res) => { const d = (res?.data as { data?: { code: string; expiresAt: string } })?.data ?? (res?.data as { code: string; expiresAt: string }); setInfo(d); setLeft(300); },
    onError: () => toast.error('인증코드 발급 실패'),
  });
  useEffect(() => { issue.mutate(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (!info) return; const t = setInterval(() => setLeft(v => Math.max(0, v - 1)), 1000); return () => clearInterval(t); }, [info]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = info ? `${origin}/consent-device?code=${info.code}` : '';
  // 🔴 페어링 코드가 담긴 URL 을 외부 QR API 에 넘기던 것 봉합(코드=5분 유효 자격증명) — 로컬 생성.
  const mm = String(Math.floor(left / 60)).padStart(1, '0'); const ss = String(left % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-1"><T k="기기 등록" /></h3>
        <p className="text-xs text-gray-500 mb-4">태블릿에서 <b>{origin.replace(/^https?:\/\//, '')}/consent-device</b> 접속 후 QR을 스캔하거나 인증코드를 입력하세요.</p>
        {!info || left === 0 ? (
          <div className="py-8">
            {left === 0 ? <><p className="text-sm text-gray-500 mb-3"><T k="인증코드가 만료되었습니다" /></p><button onClick={() => issue.mutate()} className="min-h-[44px] px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg"><T k="새 코드 발급" /></button></>
              : <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />}
          </div>
        ) : (
          <>
            <div className="flex justify-center mb-3"><QrImage value={url} size={190} alt="기기 등록 QR" className="rounded-lg border border-gray-100" /></div>
            <p className="text-3xl font-bold tracking-[0.3em] text-gray-900">{info.code}</p>
            <p className="text-[11px] text-gray-400 mt-1"><T k="남은 시간" /> {mm}:{ss} · <T k="인증코드 입력 시 자동 승인" /></p>
          </>
        )}
        <button onClick={onClose} className="mt-5 w-full py-2 text-xs text-gray-400"><T k="닫기" /></button>
      </div>
    </div>
  );
}

/* ── 블록체인 서명 기록 모달 ── */
interface BcLog {
  document?: { documentHash: string; status: string; requiredSigners: number; completedSigners: number; blockchainTxId?: string | null; signatures: { signerRole: string; signerType: string; signatureValue: string; signedAt: string }[] } | null;
  anchors: { dataHash: string; txHash?: string | null; status: string; anchoredAt?: string | null; createdAt: string }[];
}
function BlockchainLogModal({ consentId, onClose }: { consentId: string; onClose: () => void }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['cw-bclog', consentId],
    queryFn: () => apiClient.get<{ data: BcLog }>(`/api/v1/consent/${consentId}/blockchain-log`),
  });
  const log = ((data?.data as { data?: BcLog })?.data ?? data?.data) as BcLog | undefined;
  const doc = log?.document;
  const anchors = log?.anchors ?? [];
  const short = (h?: string | null) => h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '-';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1"><h3 className="text-lg font-bold text-gray-900">🔗 <T k="블록체인 서명 기록" /></h3><button onClick={onClose} className="text-gray-400">✕</button></div>
        <p className="text-xs text-gray-500 mb-4"><T k="동의서 서명 이벤트가 SHA-256 해시로 내부 블록체인에 앵커링됩니다." /></p>
        {isError ? <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /> : isLoading ? <div className="py-8 text-center text-gray-400 text-sm"><T k="불러오는 중…" /></div> : (
          <>
            {doc ? (
              <div className="bg-gray-50 rounded-xl p-3 mb-3 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-gray-500"><T k="문서 상태" /></span><span className={`font-bold ${doc.status === 'COMPLETED' ? 'text-emerald-600' : 'text-amber-600'}`}>{doc.status} ({doc.completedSigners}/{doc.requiredSigners})</span></div>
                <div className="flex justify-between"><span className="text-gray-500"><T k="문서 해시" /></span><span className="font-mono text-gray-700">{short(doc.documentHash)}</span></div>
                {doc.blockchainTxId && <div className="flex justify-between"><span className="text-gray-500"><T k="앵커 Tx" /></span><span className="font-mono text-gray-700">{short(doc.blockchainTxId)}</span></div>}
              </div>
            ) : <p className="text-sm text-gray-400 mb-3"><T k="아직 서명 기록이 없습니다." /></p>}

            <p className="text-xs font-bold text-gray-600 mb-1.5"><T k="앵커 이력" /> ({anchors.length})</p>
            <div className="space-y-1.5">
              {anchors.map((a, i) => (
                <div key={i} className="flex items-center justify-between border-b border-gray-50 py-1.5 text-[11px]">
                  <div><span className="font-mono text-gray-700">{short(a.dataHash)}</span><span className="ml-2 text-gray-400">{a.anchoredAt ? kdate(a.anchoredAt, 'datetimeSec') : ''}</span></div>
                  <span className={`font-bold px-1.5 py-0.5 rounded-full ${a.status === 'ANCHORED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{a.status}</span>
                </div>
              ))}
              {anchors.length === 0 && <p className="text-xs text-gray-400 py-2"><T k="앵커 없음" /></p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
