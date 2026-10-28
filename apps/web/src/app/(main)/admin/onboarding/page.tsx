'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs, kdate } from '@/lib/ui-settings';
import { ONBOARDING_STATUS_LABEL } from '@hospital-run/shared';
import StatusBadge from '@/components/ui/StatusBadge';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Invite {
  id: string;
  candidateFamilyName: string;
  candidateGivenName: string;
  email: string | null;
  jobCategory: string;
  department: string | null;
  hireDate: string;
  status: string;
  expiresAt: string;
  _count?: { documents: number };
}
interface IssueResult { inviteId: string; email: string | null; token: string; link: string; qrDataUrl: string; expiresAt: string; }
/**
 * 🔴 2026-08-14 W8(P16) — 「📧 이메일 발송」 버튼은 서버에 이력만 적었고 **메일은 나가지 않았다**.
 *    지금은 서버가 실제로 발송을 시도하고 SENT/SIMULATED(미발송)/FAILED 를 돌려준다.
 *    화면은 그 결과를 그대로 말한다 — 성공 토스트를 미리 띄우지 않는다.
 */
interface SendResult { ok: boolean; delivery: string; reason?: string; message: string }

const STATUS_LABEL = ONBOARDING_STATUS_LABEL; // 정본(onboarding)
// 발송 결과 표기 정본 — 서버 meta.delivery 를 그대로 옮긴다(임의 해석 금지)
const SEND_CHANNEL_LABEL: Record<string, string> = { EMAIL: '이메일', QR_IMAGE: 'QR 전달', LINK: '링크 전달', RESEND: '토큰 재발급' };
const SEND_DELIVERY_LABEL: Record<string, { text: string; cls: string }> = {
  SENT: { text: '발송됨', cls: 'text-emerald-600 font-medium' },
  SIMULATED: { text: '나가지 않음 (메일 발송 경로 없음)', cls: 'text-amber-600 font-medium' },
  FAILED: { text: '발송 실패', cls: 'text-rose-600 font-medium' },
  HANDED_OVER: { text: '관리자 직접 전달', cls: 'text-slate-600' },
  REISSUED: { text: '토큰 재발급', cls: 'text-slate-600' },
};
const DOC_LABEL: Record<string, string> = { ID_CARD: '신분증', BANKBOOK: '통장사본', LICENSE: '면허/자격증', CAREER: '경력증명', PLEDGE: '서약서', HEALTH: '건강검진', PHOTO: '증명사진', ETC: '기타' };

export default function OnboardingAdminPage() {
  const [tab, setTab] = useState<'invites' | 'welcome'>('invites');
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4 border-b">
        <button onClick={() => setTab('invites')} className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'invites' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500'}`}><T k="입사자" /></button>
        <button onClick={() => setTab('welcome')} className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'welcome' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500'}`}><T k="환영·회사소개 편집" /></button>
      </div>
      {tab === 'invites' ? <InvitesTab /> : <WelcomeEditor />}
    </div>
  );
}

function InvitesTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['onboarding-invites', statusFilter],
    queryFn: () => apiClient.get<{ data: Invite[] }>('/api/v1/onboarding/invites', statusFilter ? { status: statusFilter } : undefined),
    refetchInterval: pollMs('fast'), // 상태 변화(서류제출·서명 등) 준실시간 반영 (FR-A4)
  });
  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post<{ data: IssueResult }>('/api/v1/onboarding/invites', body),
    onSuccess: (res) => { setIssued(res.data); setShowForm(false); qc.invalidateQueries({ queryKey: ['onboarding-invites'] }); },
  });
  const resendMut = useMutation({ mutationFn: (id: string) => apiClient.post<{ data: IssueResult }>(`/api/v1/onboarding/invites/${id}/resend`), onSuccess: (res) => { setIssued(res.data); qc.invalidateQueries({ queryKey: ['onboarding-invites'] }); } });
  const revokeMut = useMutation({ mutationFn: (id: string) => apiClient.post(`/api/v1/onboarding/invites/${id}/revoke`), onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-invites'] }) });
  const sendMut = useMutation({
    mutationFn: ({ id, channel, link }: { id: string; channel: string; link?: string }) =>
      apiClient.post<{ data: SendResult }>(`/api/v1/onboarding/invites/${id}/send`, { channel, link }),
    onSuccess: (res) => {
      const r = res.data;
      if (!r) return;
      if (r.delivery === 'SENT') toast.success(r.message);
      else if (r.delivery === 'SIMULATED' || r.delivery === 'FAILED') toast.error(r.message);
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tAttr('발송 처리에 실패했습니다.')),
  });

  const invites = data?.data ?? [];
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500"><T k="입사예정자 등록 → 초대 발급 → 서류·계약·활성화" /></p>
        <button onClick={() => { setShowForm(true); setIssued(null); }} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"><T k="+ 입사예정자 등록" /></button>
      </div>
      <div className="mb-3 flex gap-2 text-sm">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded-lg px-3 py-1.5">
          <option value="">{tAttr('전체 상태')}</option>
          {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{tAttr(STATUS_LABEL[s])}</option>)}
        </select>
      </div>
      {isLoading && <div className="text-slate-400 py-10 text-center"><T k="불러오는 중…" /></div>}
      {isError && <div className="text-rose-500 py-10 text-center"><T k="목록을 불러오지 못했습니다." /></div>}
      {!isLoading && !isError && (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr><th className="text-left px-4 py-2.5"><T k="이름" /></th><th className="text-left px-4 py-2.5"><T k="직종" /></th><th className="text-left px-4 py-2.5"><T k="부서" /></th><th className="text-left px-4 py-2.5"><T k="입사예정" /></th><th className="text-left px-4 py-2.5"><T k="상태" /></th><th className="text-right px-4 py-2.5"><T k="액션" /></th></tr>
            </thead>
            <tbody>
              {invites.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-10"><T k="등록된 입사예정자가 없습니다." /></td></tr>}
              {invites.map((iv) => (
                <tr key={iv.id} className="border-t hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-medium">{iv.candidateFamilyName}{iv.candidateGivenName}</td>
                  <td className="px-4 py-2.5">{iv.jobCategory}</td>
                  <td className="px-4 py-2.5 text-slate-500">{iv.department ?? '-'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{iv.hireDate?.slice(0, 10)}</td>
                  <td className="px-4 py-2.5"><StatusBadge domain="onboarding" status={iv.status} className="whitespace-nowrap" /></td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setDrawerId(iv.id)} className="text-xs text-slate-700 hover:underline mr-3"><T k="열기" /></button>
                    {iv.status !== 'BOOTED' && (
                      <>
                        <button onClick={() => resendMut.mutate(iv.id)} className="text-xs text-blue-600 hover:underline mr-3"><T k="재발급" /></button>
                        <button onClick={() => { if (confirm(tAttr('이 초대를 폐기할까요?'))) revokeMut.mutate(iv.id); }} className="text-xs text-rose-600 hover:underline"><T k="폐기@버튼" /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showForm && <RegisterModal onClose={() => setShowForm(false)} onSubmit={(b) => createMut.mutate(b)} pending={createMut.isPending} />}
      {issued && <IssueResultPanel result={issued} onClose={() => setIssued(null)} onSend={(channel) => sendMut.mutate({ id: issued.inviteId, channel, link: issued.link })} sending={sendMut.isPending} />}
      {drawerId && <DetailDrawer inviteId={drawerId} onClose={() => setDrawerId(null)} />}
    </>
  );
}

function DetailDrawer({ inviteId, onClose }: { inviteId: string; onClose: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['onboarding-detail', inviteId], queryFn: () => apiClient.get<{ data: any }>(`/api/v1/onboarding/invites/${inviteId}`) });
  const reviewMut = useMutation({
    mutationFn: ({ docId, status, rejectReason }: { docId: string; status: string; rejectReason?: string }) => apiClient.post(`/api/v1/onboarding/invites/documents/${docId}/review`, { status, rejectReason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-detail', inviteId] }),
  });
  const approveMut = useMutation({
    mutationFn: () => apiClient.post<{ data: any }>(`/api/v1/onboarding/invites/${inviteId}/approve-boot`),
    onSuccess: (res) => { alert(res.data?.pending ? res.data.message : `활성화 완료 — 사번 ${res.data.employeeNumber}`); qc.invalidateQueries({ queryKey: ['onboarding-invites'] }); qc.invalidateQueries({ queryKey: ['onboarding-detail', inviteId] }); },
    onError: (e: any) => alert(e?.message ?? tAttr('활성화 실패')),
  });

  const viewDoc = async (docId: string) => {
    const res = await fetch(`/api/v1/onboarding/invites/documents/${docId}/file`, { headers: { Authorization: `Bearer ${apiClient.getToken()}` }, credentials: 'include' });
    if (!res.ok) { alert(tAttr('열람 실패')); return; }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const iv = data?.data;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">{iv ? `${iv.candidateFamilyName}${iv.candidateGivenName}` : <T k="상세" />}</h2>
          <button onClick={onClose} className="text-slate-400 text-sm"><T k="닫기 ✕" /></button>
        </div>
        {isLoading && <p className="text-slate-400 py-10 text-center"><T k="불러오는 중…" /></p>}
        {iv && (
          <>
            <div className="text-xs text-slate-500 mb-1">{iv.jobCategory} · {iv.department ?? '-'} · <StatusBadge domain="onboarding" status={iv.status} /></div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-600 mb-4 border rounded-lg p-3 bg-slate-50/60">
              <dt className="text-slate-400"><T k="생년월일" /></dt><dd>{iv.birthDate ? iv.birthDate.slice(0, 10) : <T k="미입력" />}</dd>
              <dt className="text-slate-400"><T k="입사예정" /></dt><dd>{iv.hireDate?.slice(0, 10)}</dd>
              <dt className="text-slate-400"><T k="이메일" /></dt><dd>{iv.email ?? '-'}</dd>
              <dt className="text-slate-400"><T k="연락처" /></dt><dd>{iv.phone ?? '-'}</dd>
            </dl>

            <h3 className="font-semibold text-sm mb-2"><T k="제출 서류" /></h3>
            <div className="space-y-2 mb-4">
              {(iv.documents ?? []).length === 0 && <p className="text-xs text-slate-400"><T k="제출된 서류 없음" /></p>}
              {(iv.documents ?? []).map((d: any) => (
                <div key={d.id} className="flex items-center justify-between border rounded-lg p-2.5 text-sm">
                  <div>
                    <span className="font-medium"><T k={DOC_LABEL[d.category] ?? d.category} /></span>
                    <span className={`ml-2 text-xs ${d.status === 'APPROVED' ? 'text-emerald-600' : d.status === 'REJECTED' ? 'text-rose-600' : 'text-slate-400'}`}><T k={d.status === 'APPROVED' ? '승인' : d.status === 'REJECTED' ? '반려' : '검토대기'} /></span>
                    {d.sensitive && <span className="ml-1 text-[10px] text-amber-600"><T k="민감" /></span>}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => viewDoc(d.id)} className="text-xs text-blue-600 hover:underline"><T k="열람" /></button>
                    <button onClick={() => reviewMut.mutate({ docId: d.id, status: 'APPROVED' })} className="text-xs text-emerald-600 hover:underline"><T k="승인" /></button>
                    <button onClick={() => { const r = prompt(tAttr('반려 사유')); if (r !== null) reviewMut.mutate({ docId: d.id, status: 'REJECTED', rejectReason: r }); }} className="text-xs text-rose-600 hover:underline"><T k="반려" /></button>
                  </div>
                </div>
              ))}
            </div>

            {/* 발송 이력 — 🔴 '발송'과 '직접 전달'과 '나가지 않음'을 구분해서 보여준다(W8·P16) */}
            <h3 className="font-semibold text-sm mb-2"><T k="발송·전달 이력" /></h3>
            <div className="space-y-1 mb-4">
              {(iv.sends ?? []).length === 0 && <p className="text-xs text-slate-400"><T k="기록 없음" /></p>}
              {(iv.sends ?? []).map((sd: any) => {
                const d = sd.meta?.delivery as string | undefined;
                const label = SEND_DELIVERY_LABEL[d ?? ''] ?? { text: '기록만 (결과 미상)', cls: 'text-slate-400' };
                return (
                  <div key={sd.id} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 w-24"><T k={SEND_CHANNEL_LABEL[sd.channel] ?? sd.channel} /></span>
                    <span className={label.cls}><T k={label.text} /></span>
                    <span className="ml-auto text-slate-400">{kdate(sd.sentAt, 'datetimeSec')}</span>
                  </div>
                );
              })}
            </div>

            <h3 className="font-semibold text-sm mb-1"><T k="계약" /></h3>
            <p className="text-xs text-slate-500 mb-4">{iv.contract?.signedAt ? `서명 완료 (${kdate(iv.contract.signedAt, 'datetimeSec')})` : <T k="미서명" />}</p>

            {iv.status === 'CONTRACT_SIGNED' && (
              <button onClick={() => { if (confirm(tAttr('신분증·서류 확인 후 활성화(입사 확정)할까요?'))) approveMut.mutate(); }} disabled={approveMut.isPending} className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"><T k="계정 활성화(입사 확정)" /></button>
            )}
            {iv.status === 'BOOTED' && <p className="text-center text-sm text-emerald-600"><T k="활성화 완료 ✓" /></p>}
          </>
        )}
      </div>
    </div>
  );
}

function WelcomeEditor() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['onboarding-welcome'], queryFn: () => apiClient.get<{ data: any }>('/api/v1/admin/onboarding/welcome') });
  const [sections, setSections] = useState<any[] | null>(null);
  const saveMut = useMutation({
    mutationFn: (content: any) => apiClient.put('/api/v1/admin/onboarding/welcome', { content }),
    onSuccess: () => { alert(tAttr('저장되었습니다')); qc.invalidateQueries({ queryKey: ['onboarding-welcome'] }); },
  });

  const current = sections ?? data?.data?.sections ?? [];
  const setS = (next: any[]) => setSections(next);
  const update = (i: number, key: string, val: string) => setS(current.map((s: any, idx: number) => idx === i ? { ...s, [key]: key === 'title' || key === 'body' ? { ko: val } : val } : s));
  const pick = (v: any) => (typeof v === 'string' ? v : v?.ko ?? '');
  const TYPES = ['HERO', 'GREETING', 'ABOUT', 'MVV', 'CULTURE', 'BENEFITS', 'FACILITY', 'GUIDE', 'CODE_OF_CONDUCT'];

  if (isLoading) return <p className="text-slate-400 py-10 text-center"><T k="불러오는 중…" /></p>;
  return (
    <div className="max-w-2xl">
      <p className="text-sm text-slate-500 mb-3"><T k="입사자 환영 페이지에 표시될 섹션을 편집합니다. (ko)" /></p>
      <div className="space-y-3">
        {current.map((s: any, i: number) => (
          <div key={i} className="border rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <select value={s.type ?? 'ABOUT'} onChange={(e) => update(i, 'type', e.target.value)} className="border rounded-lg px-2 py-1 text-xs">
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={() => setS(current.filter((_: any, idx: number) => idx !== i))} className="ml-auto text-xs text-rose-600"><T k="삭제" /></button>
            </div>
            <input value={pick(s.title)} onChange={(e) => update(i, 'title', e.target.value)} placeholder={tAttr('제목')} className="w-full border rounded-lg px-3 py-1.5 text-sm mb-2" />
            <textarea value={pick(s.body)} onChange={(e) => update(i, 'body', e.target.value)} placeholder={tAttr('본문')} rows={3} className="w-full border rounded-lg px-3 py-1.5 text-sm" />
            {s.type === 'CODE_OF_CONDUCT' && <span className="text-[11px] text-amber-600"><T k="※ 필수 숙지 섹션" /></span>}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => setS([...current, { type: 'ABOUT', title: { ko: '' }, body: { ko: '' } }])} className="px-3 py-2 rounded-lg border text-sm"><T k="+ 섹션 추가" /></button>
        <button onClick={() => saveMut.mutate({ version: (data?.data?.version ?? 0) + 1, locales: ['ko'], sections: current })} disabled={saveMut.isPending} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"><T k="저장" /></button>
      </div>
    </div>
  );
}

function RegisterModal({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (b: Record<string, unknown>) => void; pending: boolean }) {
  const tAttr = useTAttr();
  const [f, setF] = useState({ candidateFamilyName: '', candidateGivenName: '', email: '', phone: '', birthDate: '', jobCategory: '', department: '', hireDate: '', contractType: 'FULL_TIME' });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.candidateFamilyName && f.candidateGivenName && f.jobCategory && f.hireDate;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold mb-3"><T k="입사예정자 등록" /></h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <input placeholder={tAttr('성')} value={f.candidateFamilyName} onChange={(e) => set('candidateFamilyName', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input placeholder={tAttr('이름')} value={f.candidateGivenName} onChange={(e) => set('candidateGivenName', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input placeholder={tAttr('이메일(선택)')} value={f.email} onChange={(e) => set('email', e.target.value)} className="border rounded-lg px-3 py-2 col-span-2" />
          <input placeholder={tAttr('휴대폰(선택)')} value={f.phone} onChange={(e) => set('phone', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input placeholder={tAttr('직종(예: 간호사)')} value={f.jobCategory} onChange={(e) => set('jobCategory', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input placeholder={tAttr('부서(선택)')} value={f.department} onChange={(e) => set('department', e.target.value)} className="border rounded-lg px-3 py-2" />
          <label className="text-xs text-slate-500 col-span-2 -mb-1"><T k="입사예정일" /></label>
          <input type="date" value={f.hireDate} onChange={(e) => set('hireDate', e.target.value)} className="border rounded-lg px-3 py-2" />
          <select value={f.contractType} onChange={(e) => set('contractType', e.target.value)} className="border rounded-lg px-3 py-2">
            <option value="FULL_TIME">{tAttr('정규직')}</option><option value="CONTRACT">{tAttr('계약직')}</option><option value="COMMISSIONED">{tAttr('위촉')}</option><option value="PART_TIME">{tAttr('시간제')}</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border"><T k="취소" /></button>
          <button disabled={!valid || pending} onClick={() => onSubmit({ ...f, email: f.email || undefined, phone: f.phone || undefined, birthDate: f.birthDate || undefined, department: f.department || undefined })} className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white disabled:opacity-50"><T k={pending ? '발급 중…' : '등록 + 초대 발급'} /></button>
        </div>
      </div>
    </div>
  );
}

function IssueResultPanel({ result, onClose, onSend, sending }: { result: IssueResult; onClose: () => void; onSend: (channel: string) => void; sending?: boolean }) {
  const tAttr = useTAttr();
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-5 w-full max-w-md text-center" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold mb-1"><T k="초대 발급 완료" /></h2>
        <p className="text-xs text-slate-500 mb-3"><T k="3가지 중 한 가지로 전달하세요" /> (만료: {result.expiresAt?.slice(0, 10)})</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={result.qrDataUrl} alt={tAttr('온보딩 초대 QR')} width={200} height={200} className="mx-auto rounded-xl border p-2" />
        <div className="flex gap-2 mt-4 text-sm">
          <a href={result.qrDataUrl} download={`onboarding-${result.inviteId.slice(0, 8)}.png`} onClick={() => onSend('QR_IMAGE')} className="flex-1 px-3 py-2 rounded-lg border hover:bg-slate-50">🔳 <T k="QR 다운로드" /></a>
          <button onClick={() => { navigator.clipboard.writeText(result.link); setCopied(true); onSend('LINK'); }} className="flex-1 px-3 py-2 rounded-lg border hover:bg-slate-50">🔗 <T k={copied ? '복사됨' : '링크 복사'} /></button>
          {/* 🔴 보낼 주소가 없으면 버튼을 살려두지 않는다 — 눌러도 안 나가는 버튼이 '발송했다'는 인상을 준다 */}
          <button onClick={() => onSend('EMAIL')} disabled={!result.email || sending}
            title={result.email ? `수신: ${result.email}` : tAttr('이 초대에는 이메일 주소가 없습니다')}
            className="flex-1 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600">
            <T k={sending ? '발송 중…' : '📧 이메일 발송'} />
          </button>
        </div>
        {!result.email && <p className="mt-2 text-xs text-amber-600"><T k="이메일 주소가 없어 메일로 보낼 수 없습니다 — QR 또는 링크로 직접 전달하세요." /></p>}
        <button onClick={onClose} className="mt-4 text-sm text-slate-500 hover:underline"><T k="닫기" /></button>
      </div>
    </div>
  );
}
