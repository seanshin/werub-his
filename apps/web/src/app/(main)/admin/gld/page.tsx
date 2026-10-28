'use client';

import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAdminWrite } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

import { EmptyState, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

interface Staff { id: string; familyName: string; givenName: string; role: string; department?: string }
interface Committee { id: string; name: string; type: string; meetingCycle?: string; chair?: Staff | null; memberCount?: number; meetingCount?: number }
interface Meeting { id: string; committeeId: string; title: string; scheduledAt: string; location?: string; agenda?: string; minutes?: string; status: string; committee?: { name: string; type: string }; minutesSignedAt?: string | null; minutesSignRef?: string | null }
interface Policy { id: string; code?: string; title: string; category: string; version: string; status: string; reviewDate?: string; reviewDue?: boolean; effectiveDate?: string; approver?: Staff | null; committee?: { name: string } | null }
interface Dash { committees: number; meetingsThisMonth: number; activePolicies: number; draftPolicies: number; reviewDueCount: number; reviewDue: { id: string; title: string; category: string; reviewDate: string }[] }

const COMMITTEE_TYPES = [
  { k: 'QUALITY', l: '질향상' }, { k: 'SAFETY', l: '환자안전' }, { k: 'INFECTION', l: '감염관리' }, { k: 'PHARMACY', l: '약사' },
  { k: 'ETHICS', l: '의료윤리' }, { k: 'MEDICAL', l: '의무기록' }, { k: 'MORTALITY', l: '사망@위원회' }, { k: 'OTHER', l: '기타' },
];
const POLICY_CATS = [
  { k: 'CLINICAL', l: '진료@분류' }, { k: 'ADMIN', l: '행정' }, { k: 'SAFETY', l: '안전' }, { k: 'INFECTION', l: '감염' }, { k: 'HR', l: '인사' }, { k: 'OTHER', l: '기타' },
];
const MEMBER_ROLES = [{ k: 'CHAIR', l: '위원장' }, { k: 'VICE_CHAIR', l: '부위원장' }, { k: 'SECRETARY', l: '간사' }, { k: 'MEMBER', l: '위원' }];
const POLICY_STATUS: Record<string, { l: string; c: string }> = { DRAFT: { l: '초안', c: 'bg-gray-100 text-gray-600' }, ACTIVE: { l: '시행@정책', c: 'bg-emerald-100 text-emerald-700' }, UNDER_REVIEW: { l: '검토중', c: 'bg-amber-100 text-amber-700' }, ARCHIVED: { l: '보관', c: 'bg-gray-100 text-gray-400' } };
const tLabel = (k: string) => COMMITTEE_TYPES.find(t => t.k === k)?.l ?? k;
const fmtD = (d?: string) => d ? kdate(d) : '-';

export default function GldPage() {
  const [tab, setTab] = useState<'dashboard' | 'committees' | 'meetings' | 'policies'>('dashboard');
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="거버넌스·위원회 (GLD)" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="JCI GLD — 위원회 구성·회의록·기관 정책 관리" /></p>
      </div>
      <div className="flex gap-2 mb-6">
        {([['dashboard', '대시보드'], ['committees', '위원회'], ['meetings', '회의'], ['policies', '정책·규정']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === k ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200'}`}><T k={l} /></button>
        ))}
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'committees' && <CommitteesTab />}
      {tab === 'meetings' && <MeetingsTab />}
      {tab === 'policies' && <PoliciesTab />}
    </div>
  );
}

function useStaff() {
  const { data, isError, error, refetch } = useQuery({ queryKey: ['gld-staff'], queryFn: () => apiClient.get<{ data: Staff[] }>('/api/v1/users') });
  const list = ((data?.data as { data?: Staff[] })?.data ?? data?.data ?? []) as Staff[];
  return { list, isError, error, refetch };
}
const name = (u?: Staff | null) => u ? `${u.familyName}${u.givenName}` : '-';

function DashboardTab() {
  const { data, isError, error, refetch } = useQuery({ queryKey: ['gld-dash'], queryFn: () => apiClient.get<{ data: Dash }>('/api/v1/gld/dashboard') });
  const d = (data?.data as { data?: Dash })?.data ?? (data?.data as Dash | null);
  // 🔴 에러 분기가 로딩 분기보다 먼저 — 조회 실패를 영구 '불러오는 중'으로 굳히지 않는다
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (!d) return <div className="text-center py-12 text-gray-400"><T k="불러오는 중..." /></div>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label={<T k="위원회" />} value={d.committees} color="text-gray-900" />
        <Card label={<T k="이번달 회의" />} value={d.meetingsThisMonth} color="text-blue-600" />
        <Card label={<T k="시행 정책" />} value={d.activePolicies} color="text-emerald-600" />
        <Card label={<T k="재검토 필요" />} value={d.reviewDueCount} color="text-red-600" />
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">📋 <T k="재검토 기한 경과 정책" /></h3>
        {d.reviewDue.length === 0 ? <p className="text-xs text-emerald-600"><T k="재검토 기한이 지난 정책이 없습니다 ✓" /></p> : (
          <div className="space-y-1.5">
            {d.reviewDue.map(p => (
              <div key={p.id} className="flex items-center justify-between border-b border-gray-50 py-1.5">
                <span className="text-xs text-gray-700">{p.title}</span>
                <span className="text-[11px] font-bold text-red-600"><T k="재검토 기한" /> {fmtD(p.reviewDate)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommitteesTab() {
  const tAttr = useTAttr();
  const canWrite = useAdminWrite();
  const qc = useQueryClient();
  const staffQ = useStaff();
  const staff = staffQ.list;
  const [form, setForm] = useState({ name: '', type: 'QUALITY', meetingCycle: '월간', chairId: '' });
  const [detailId, setDetailId] = useState<string | null>(null);
  const { data, isError, error, refetch } = useQuery({ queryKey: ['gld-committees'], queryFn: () => apiClient.get<{ data: Committee[] }>('/api/v1/gld/committees') });
  const items = ((data?.data as { data?: Committee[] })?.data ?? data?.data ?? []) as Committee[];
  const createMut = useMutation({ mutationFn: () => apiClient.post('/api/v1/gld/committees', form), onSuccess: () => { setForm({ name: '', type: 'QUALITY', meetingCycle: '월간', chairId: '' }); qc.invalidateQueries({ queryKey: ['gld-committees'] }); toast.success('위원회 생성됨'); }, onError: () => toast.error('생성 실패') });

  return (
    <div className="space-y-4">
      {/* 직원 목록 조회 실패 — "직원 없음"으로 말하지 않는다(위원장/위원 선택이 비어 보인다) */}
      {staffQ.isError && <QueryErrorFallback error={staffQ.error} onRetry={staffQ.refetch} size="compact" />}
      {/* 🔴 위원회 구성·정책 등록·의사록 봉인은 서버가 `@Roles(ADMIN)` 이다 —
          임상 직군에게는 조회 화면이라 nav 는 두되 누를 수 없는 폼을 띄우지 않는다.
          회의 등록·회의록 저장은 임상도 허용이라 그대로 둔다(성격이 다르다). */}
      {canWrite && <div className="bg-white rounded-2xl border border-gray-100 p-4 grid grid-cols-2 md:grid-cols-5 gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={tAttr('위원회명')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs md:col-span-2" />
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white">{COMMITTEE_TYPES.map(t => <option key={t.k} value={t.k}>{tAttr(t.l)}</option>)}</select>
        <select value={form.chairId} onChange={e => setForm({ ...form, chairId: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white"><option value="">{tAttr('위원장')}</option>{staff.map(u => <option key={u.id} value={u.id}>{name(u)}</option>)}</select>
        <button onClick={() => createMut.mutate()} disabled={!form.name.trim() || createMut.isPending} className="bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50">+ <T k="생성" /></button>
      </div>}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map(c => (
          <div key={c.id} className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">{c.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5"><span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700"><T k={tLabel(c.type)} /></span> · <T k="위원장" /> {name(c.chair)} · {c.meetingCycle ?? ''}</p>
              </div>
              <button onClick={() => setDetailId(detailId === c.id ? null : c.id)} className="text-xs text-blue-600">{detailId === c.id ? <T k="닫기" /> : <T k="위원" />}</button>
            </div>
            <p className="text-[11px] text-gray-400 mt-2"><T k="위원" /> {c.memberCount ?? 0}<Unit>명</Unit> · <T k="회의" /> {c.meetingCount ?? 0}<Unit>건</Unit></p>
            {detailId === c.id && <CommitteeMembers committeeId={c.id} staff={staff} />}
          </div>
        ))}
        {items.length === 0 && <EmptyState icon="📋" title="위원회가 없습니다" />}
      </div>
      )}
    </div>
  );
}

function CommitteeMembers({ committeeId, staff }: { committeeId: string; staff: Staff[] }) {
  const tAttr = useTAttr();
  const canWrite = useAdminWrite();
  const qc = useQueryClient();
  const [sel, setSel] = useState({ userId: '', role: 'MEMBER' });
  const { data, isError, error, refetch } = useQuery({ queryKey: ['gld-committee', committeeId], queryFn: () => apiClient.get<{ data: { members: { id: string; role: string; user: Staff | null }[] } }>(`/api/v1/gld/committees/${committeeId}`) });
  const detail = (data?.data as { data?: { members: { id: string; role: string; user: Staff | null }[] } })?.data ?? data?.data;
  const members = detail?.members ?? [];
  const addMut = useMutation({ mutationFn: () => apiClient.post(`/api/v1/gld/committees/${committeeId}/members`, sel), onSuccess: () => { setSel({ userId: '', role: 'MEMBER' }); qc.invalidateQueries({ queryKey: ['gld-committee', committeeId] }); qc.invalidateQueries({ queryKey: ['gld-committees'] }); } });
  const delMut = useMutation({ mutationFn: (mid: string) => apiClient.del(`/api/v1/gld/members/${mid}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['gld-committee', committeeId] }); qc.invalidateQueries({ queryKey: ['gld-committees'] }); } });
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      {isError && <QueryErrorFallback error={error} onRetry={refetch} size="compact" />}
      {!isError && members.map(m => (
        <div key={m.id} className="flex items-center justify-between text-xs">
          <span className="text-gray-700">{name(m.user)} <span className="text-gray-400">· <T k={MEMBER_ROLES.find(r => r.k === m.role)?.l ?? m.role} /></span></span>
          {canWrite && <button onClick={() => delMut.mutate(m.id)} className="text-red-400"><T k="제거" /></button>}
        </div>
      ))}
      {canWrite && <div className="flex gap-1.5">
        <select value={sel.userId} onChange={e => setSel({ ...sel, userId: e.target.value })} className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"><option value="">{tAttr('위원 추가')}</option>{staff.map(u => <option key={u.id} value={u.id}>{name(u)}</option>)}</select>
        <select value={sel.role} onChange={e => setSel({ ...sel, role: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">{MEMBER_ROLES.map(r => <option key={r.k} value={r.k}>{tAttr(r.l)}</option>)}</select>
        <button onClick={() => addMut.mutate()} disabled={!sel.userId} className="px-3 bg-blue-600 text-white text-xs rounded-lg disabled:opacity-40"><T k="추가" /></button>
      </div>}
    </div>
  );
}

function MeetingsTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data: cData, isError: cIsError, error: cError, refetch: refetchC } = useQuery({ queryKey: ['gld-committees'], queryFn: () => apiClient.get<{ data: Committee[] }>('/api/v1/gld/committees') });
  const committees = ((cData?.data as { data?: Committee[] })?.data ?? cData?.data ?? []) as Committee[];
  const [form, setForm] = useState({ committeeId: '', title: '', scheduledAt: '', location: '', agenda: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const { data, isError, error, refetch } = useQuery({ queryKey: ['gld-meetings'], queryFn: () => apiClient.get<{ data: Meeting[] }>('/api/v1/gld/meetings') });
  const items = ((data?.data as { data?: Meeting[] })?.data ?? data?.data ?? []) as Meeting[];
  const createMut = useMutation({ mutationFn: () => apiClient.post('/api/v1/gld/meetings', form), onSuccess: () => { setForm({ committeeId: '', title: '', scheduledAt: '', location: '', agenda: '' }); qc.invalidateQueries({ queryKey: ['gld-meetings'] }); toast.success('회의 등록됨'); }, onError: () => toast.error('등록 실패') });

  return (
    <div className="space-y-4">
      {/* 위원회 목록 조회 실패 — 선택지가 비어 보이는 것을 "위원회 없음"으로 말하지 않는다 */}
      {cIsError && <QueryErrorFallback error={cError} onRetry={refetchC} size="compact" />}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 grid grid-cols-2 md:grid-cols-6 gap-2">
        <select value={form.committeeId} onChange={e => setForm({ ...form, committeeId: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white"><option value="">{tAttr('위원회')}</option>{committees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={tAttr('회의 제목')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs md:col-span-2" />
        <input type="datetime-local" value={form.scheduledAt} onChange={e => setForm({ ...form, scheduledAt: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs" />
        <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder={tAttr('장소')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs" />
        <button onClick={() => createMut.mutate()} disabled={!form.committeeId || !form.title.trim() || !form.scheduledAt || createMut.isPending} className="bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50">+ <T k="등록" /></button>
      </div>
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : (
      <div className="space-y-2">
        {items.map(m => (
          <div key={m.id} className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">{m.title}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{m.committee?.name} · {kdate(new Date(m.scheduledAt), 'datetime')} {m.location ? `· ${m.location}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                {m.minutesSignedAt && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700"
                    title={`sign 해시체인 봉인 — ${kdate(new Date(m.minutesSignedAt), 'datetime')}${m.minutesSignRef ? `\nentryHash: ${m.minutesSignRef}` : ''}`}>
                    🔏 <T k="봉인됨" />
                  </span>
                )}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : m.status === 'CANCELLED' ? 'bg-gray-100 text-gray-400' : 'bg-blue-100 text-blue-700'}`}>{m.status === 'COMPLETED' ? <T k="완료" /> : m.status === 'CANCELLED' ? <T k="취소" /> : <T k="예정" />}</span>
                <button onClick={() => setEditId(editId === m.id ? null : m.id)} className="text-xs text-blue-600">{editId === m.id ? <T k="닫기" /> : <T k="회의록" />}</button>
              </div>
            </div>
            {editId === m.id && <MeetingMinutes meeting={m} onDone={() => { setEditId(null); qc.invalidateQueries({ queryKey: ['gld-meetings'] }); }} />}
          </div>
        ))}
        {items.length === 0 && <EmptyState icon="📋" title="회의가 없습니다" />}
      </div>
      )}
    </div>
  );
}

function MeetingMinutes({ meeting, onDone }: { meeting: Meeting; onDone: () => void }) {
  const tAttr = useTAttr();
  const canWrite = useAdminWrite();
  const sealed = !!meeting.minutesSignedAt;
  const [agenda, setAgenda] = useState(meeting.agenda ?? '');
  const [minutes, setMinutes] = useState(meeting.minutes ?? '');
  const saveMut = useMutation({ mutationFn: (status?: string) => apiClient.patch(`/api/v1/gld/meetings/${meeting.id}`, { agenda, minutes, ...(status ? { status } : {}) }), onSuccess: () => { toast.success('저장됨'); onDone(); }, onError: (e) => toast.error((e as { message?: string })?.message || '저장 실패') });
  const sealMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/gld/meetings/${meeting.id}/seal-minutes`, {}),
    onSuccess: () => { toast.success('의사록이 봉인되었습니다 — 이후 수정할 수 없습니다.'); onDone(); },
    onError: (e) => toast.error((e as { message?: string })?.message || '봉인 실패 — sign 연동·회의 상태를 확인하세요.'),
  });
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      {sealed && <p className="text-[11px] text-indigo-600 bg-indigo-50 rounded-lg px-2.5 py-1.5">🔏 <T k="봉인된 의사록 — 수정 불가(정정은 새 회의록으로)." /> entryHash: <span className="font-mono">{meeting.minutesSignRef}</span></p>}
      <textarea value={agenda} onChange={e => setAgenda(e.target.value)} rows={2} placeholder={tAttr('안건')} disabled={sealed} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none disabled:bg-gray-50 disabled:text-gray-500" />
      <textarea value={minutes} onChange={e => setMinutes(e.target.value)} rows={4} placeholder={tAttr('회의록 / 의결사항')} disabled={sealed} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none disabled:bg-gray-50 disabled:text-gray-500" />
      {!sealed && (
        <div className="flex gap-2">
          <button onClick={() => saveMut.mutate(undefined)} disabled={saveMut.isPending} className="flex-1 py-2 bg-gray-100 text-gray-700 text-xs rounded-lg"><T k="임시 저장" /></button>
          <button onClick={() => saveMut.mutate('COMPLETED')} disabled={saveMut.isPending} className="flex-1 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg"><T k="회의 완료(확정)" /></button>
          {meeting.status === 'COMPLETED' && (
            canWrite && <button onClick={() => { if (confirm('의사록을 봉인할까요?\n\nsign 해시체인에 기록되며 이후 수정할 수 없습니다(정정은 새 회의록으로).')) sealMut.mutate(); }}
              disabled={sealMut.isPending || !minutes.trim()}
              className="flex-1 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg disabled:opacity-40">
              {sealMut.isPending ? <T k="봉인 중…" /> : <>🔏 <T k="의사록 봉인" /></>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PoliciesTab() {
  const tAttr = useTAttr();
  const canWrite = useAdminWrite();
  const qc = useQueryClient();
  const { data: cData, isError: cIsError, error: cError, refetch: refetchC } = useQuery({ queryKey: ['gld-committees'], queryFn: () => apiClient.get<{ data: Committee[] }>('/api/v1/gld/committees') });
  const committees = ((cData?.data as { data?: Committee[] })?.data ?? cData?.data ?? []) as Committee[];
  const [form, setForm] = useState({ code: '', title: '', category: 'CLINICAL', committeeId: '', reviewDate: '', content: '' });
  const { data, isError, error, refetch } = useQuery({ queryKey: ['gld-policies'], queryFn: () => apiClient.get<{ data: Policy[] }>('/api/v1/gld/policies') });
  const items = ((data?.data as { data?: Policy[] })?.data ?? data?.data ?? []) as Policy[];
  const createMut = useMutation({ mutationFn: () => apiClient.post('/api/v1/gld/policies', form), onSuccess: () => { setForm({ code: '', title: '', category: 'CLINICAL', committeeId: '', reviewDate: '', content: '' }); qc.invalidateQueries({ queryKey: ['gld-policies'] }); toast.success('정책 등록됨'); }, onError: () => toast.error('등록 실패') });
  const approveMut = useMutation({ mutationFn: (id: string) => apiClient.post(`/api/v1/gld/policies/${id}/approve`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['gld-policies'] }); toast.success('정책 승인·시행'); } });

  return (
    <div className="space-y-4">
      {cIsError && <QueryErrorFallback error={cError} onRetry={refetchC} size="compact" />}
      {canWrite && <div className="bg-white rounded-2xl border border-gray-100 p-4 grid grid-cols-2 md:grid-cols-6 gap-2">
        <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder={tAttr('문서번호')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs" />
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={tAttr('정책명')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs md:col-span-2" />
        <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white">{POLICY_CATS.map(c => <option key={c.k} value={c.k}>{tAttr(c.l)}</option>)}</select>
        <input type="date" value={form.reviewDate} onChange={e => setForm({ ...form, reviewDate: e.target.value })} title={tAttr('재검토 기한')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs" />
        <button onClick={() => createMut.mutate()} disabled={!form.title.trim() || createMut.isPending} className="bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50">+ <T k="등록" /></button>
      </div>}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : (
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 text-xs text-gray-500"><th className="px-4 py-2.5 text-left"><T k="정책명" /></th><th className="px-4 py-2.5 text-left"><T k="분류" /></th><th className="px-4 py-2.5 text-left"><T k="버전" /></th><th className="px-4 py-2.5 text-left"><T k="재검토" /></th><th className="px-4 py-2.5 text-left"><T k="상태" /></th><th className="px-4 py-2.5 text-left"></th></tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={6} className="py-10 text-center text-gray-400 text-sm"><T k="정책이 없습니다" /></td></tr> : items.map(p => {
              const st = POLICY_STATUS[p.status] ?? POLICY_STATUS.DRAFT;
              return (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 text-gray-900">{p.code ? <span className="text-gray-400 font-mono text-[11px]">{p.code} </span> : ''}{p.title}</td>
                  <td className="px-4 py-3 text-xs text-gray-600"><T k={POLICY_CATS.find(c => c.k === p.category)?.l ?? p.category} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">v{p.version}</td>
                  <td className="px-4 py-3 text-xs"><span className={p.reviewDue ? 'text-red-600 font-bold' : 'text-gray-500'}>{fmtD(p.reviewDate)}{p.reviewDue ? ' ⚠' : ''}</span></td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${st.c}`}><T k={st.l} /></span></td>
                  <td className="px-4 py-3">{canWrite && p.status === 'DRAFT' && <button onClick={() => approveMut.mutate(p.id)} className="text-[11px] text-blue-600 underline"><T k="승인·시행" /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function Card({ label, value, color }: { label: ReactNode; value: number; color: string }) {
  return <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center"><p className={`text-2xl font-bold ${color}`}>{value}</p><p className="text-[11px] text-gray-500 mt-0.5">{label}</p></div>;
}
