'use client';

import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { USER_ROLE_LABEL } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, Ratio, Unit } from '@/components/ui/display';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface StaffUser { id: string; familyName: string; givenName: string; role: string; department?: string | null }
interface Credential {
  id: string; userId: string; type: string; name: string; number?: string; issuer?: string;
  issuedAt?: string; expiresAt?: string; status: string; effectiveStatus?: string; verifiedAt?: string | null;
  user: StaffUser | null; daysLeft?: number | null;
}
interface Education {
  id: string; userId: string; courseName: string; category: string; completedAt?: string; expiresAt?: string;
  user: StaffUser | null; daysLeft?: number | null;
}
/** 목록 응답 정본 — 🔴 상한(200)을 넘긴 사실을 화면이 말할 수 있어야 해서 배열이 아니라 봉투로 온다. */
interface ListEnvelope<T> { items: T[]; total: number; limit: number; truncated: boolean }
interface DueBucket<T> { total: number; truncated: boolean; items: T[] }
interface Dashboard {
  credentials: {
    total: number; expired: number; suspended: number; unverified: number;
    expiringSoon: Credential[]; expiringSoonTotal: number; expiringSoonTruncated: boolean;
    ledger: {
      built: boolean; rows: number; clinicalStaffActive: number; staffWithCredential: number;
      registrationRate: number | null; hrLicenseNumberRows: number; hrLedgerNote: string;
    };
  };
  education: {
    total: number; byCategory: { category: string; count: number }[];
    overdue: DueBucket<Education>; dueSoon: DueBucket<Education>; withoutDueDate: number;
  };
  panelLimit: number;
  generatedAt: string;
}

const CRED_TYPES = [
  { k: 'LICENSE', l: '면허' }, { k: 'CERTIFICATION', l: '자격증' }, { k: 'BLS', l: 'BLS' },
  { k: 'ACLS', l: 'ACLS' }, { k: 'PALS', l: 'PALS' },
];
/**
 * 교육 분류 라벨 — 🔴 종전 5종에는 실제 데이터에 있는 `CE`(보수교육)·`PATIENT_SAFETY` 가 없어
 *    화면에 영문 원문이 그대로 노출됐다(실측 분포 INFECTION 13 · CE 7 · MANDATORY 9 · PATIENT_SAFETY 1).
 *    `staffEducations.category` 는 enum 이 아니라 VarChar 라 값 집합이 열려 있다 →
 *    아는 값은 전부 덮고, 모르는 값은 `- 미분류(원문)` 로 **모른다는 사실을 함께** 표시한다.
 *    (shared 정본으로 올릴 후보 — 지금은 모듈 로컬)
 */
const EDU_CATEGORIES = [
  { k: 'MANDATORY', l: '법정필수' },
  { k: 'INFECTION', l: '감염관리' },
  { k: 'PATIENT_SAFETY', l: '환자안전' },
  { k: 'SAFETY', l: '환자안전' },
  { k: 'CE', l: '보수교육' },
  { k: 'CPR', l: '심폐소생술' },
  { k: 'FIRE', l: '소방안전' },
  { k: 'PRIVACY', l: '개인정보보호' },
  { k: 'ORIENTATION', l: '신규 오리엔테이션' },
];
/**
 * 🔴 모르는 분류는 원문 코드를 **자리표시자 값**으로 넘긴다 — `미분류(${k})` 를 통째로 키로 쓰면
 *    값마다 다른 키가 되어 영원히 미등록 티(EN×)로 나간다. 아는 라벨만 번역 키이고 코드는 번역하지 않는다.
 */
function EduCategoryLabel({ k }: { k: string }) {
  const l = EDU_CATEGORIES.find(c => c.k === k)?.l;
  return l ? <T k={l} /> : <Tf k="미분류({분류})" params={{ 분류: k }} />;
}

/**
 * 역할 라벨 — 🔴 종전 로컬 7키는 UserRole 14종을 덮지 못해 EXECUTIVE·CHECKUP·NUTRITION 등이
 *    영문 원문으로 노출됐다. 로컬 재정의를 지우고 shared 정본(USER_ROLE_LABEL)을 쓴다.
 */
const roleLabel = (role: string) => USER_ROLE_LABEL[role] ?? role;
const fmtD = (d?: string | null) => d ? kdate(d) : '-';
/** 직원 표기 — 이름·부서는 데이터라 번역하지 않고, 역할 라벨과 '직원 미상'만 `tr`(tAttr)로 번역한다 */
const staffName = (u: StaffUser | null, tr: (k: string) => string) => u ? `${u.familyName}${u.givenName} (${tr(roleLabel(u.role))}${u.department ? '·' + u.department : ''})` : tr('직원 미상');

/** `{ data: X }` / `{ data: { data: X } }` 양쪽 언랩 */
function unwrap<T>(res: unknown): T | undefined {
  const outer = (res as { data?: unknown } | undefined)?.data;
  if (outer && typeof outer === 'object' && 'data' in (outer as Record<string, unknown>)) {
    return (outer as { data: T }).data;
  }
  return outer as T | undefined;
}

/** 🔴 등록률은 분모(활성 임상직)와 함께 낸다 — 정본 `<Ratio>`. 활성 임상직 0명이면 '산출 불가'다. */
const RegistrationRate = ({ led }: { led: { clinicalStaffActive: number; staffWithCredential: number } }) => {
  const tAttr = useTAttr();
  return <Ratio numerator={led.staffWithCredential} denominator={led.clinicalStaffActive} pctOnly unavailableHint="활성 임상직 0명" />;
};

export default function SqePage() {
  const [tab, setTab] = useState<'dashboard' | 'credentials' | 'education'>('dashboard');
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="직원 자격·교육 (SQE)" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="JCI SQE — 면허·자격증 관리 및 필수교육 이수 추적" /></p>
      </div>
      <div className="flex gap-2 mb-6">
        {[{ k: 'dashboard', l: '대시보드' }, { k: 'credentials', l: '자격·면허' }, { k: 'education', l: '교육' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as typeof tab)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium ${tab === t.k ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}><T k={t.l} /></button>
        ))}
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'credentials' && <CredentialsTab />}
      {tab === 'education' && <EducationTab />}
    </div>
  );
}

/** 🔴 종전엔 `.catch(() => ({data: []}))` 로 조회 실패를 "직원 없음"으로 흡수했다 — 실패는 실패로 알린다. */
function useStaff() {
  const q = useQuery({
    queryKey: ['sqe-staff'],
    queryFn: () => apiClient.get<{ data: StaffUser[] | { data: StaffUser[] } }>('/api/v1/users'),
  });
  return { staff: unwrap<StaffUser[]>(q.data) ?? [], isError: q.isError, error: q.error, refetch: q.refetch };
}

function DashboardTab() {
  const tAttr = useTAttr();
  // 🔴 종전: `.catch(() => ({ data: null }))` → API 실패가 무한 "불러오는 중..." 으로 위장됐다.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sqe-dashboard'],
    queryFn: () => apiClient.get<{ data: Dashboard | { data: Dashboard } }>('/api/v1/staff-qualification/dashboard'),
  });
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading) return <div className="space-y-4"><div className="h-24 rounded-2xl bg-gray-50 animate-pulse" /><div className="h-48 rounded-2xl bg-gray-50 animate-pulse" /></div>;
  const d = unwrap<Dashboard>(data);
  if (!d) return <QueryErrorFallback error={new Error(tAttr('대시보드 응답을 해석할 수 없습니다'))} onRetry={refetch} />;

  const led = d.credentials.ledger;

  return (
    <div className="space-y-6">
      {/*
        🔴 원장 미구축 고지 — 종전 화면은 등록 0 · 만료 0 · 미검증 0 을 회색 숫자로만 보여주고
           만료 임박 패널을 emerald 초록 "임박한 만료가 없습니다 ✓" 로 채웠다.
           표본이 0 인 것은 "이상 없음"이 아니라 **원장이 비어 있다**는 사실이다.
      */}
      {!led.built && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-800"><T k="면허·자격 원장 미구축 — 등록 자격 0건" /></p>
          <p className="text-xs text-red-700 mt-1.5">
            {/* 🔴 분자·분모가 든 문장은 통째로 키다 — '중' 조각 배선은 영어에서 어순을 뒤집고(`12 of 0`) '중'은 미등록이라 티까지 떴다 */}
            <Tf k="활성 임상직(의사·간호사·약사·검사기사) {활성}명 중 자격 등재 {등재}명" params={{ 활성: led.clinicalStaffActive, 등재: led.staffWithCredential }} />
            · <T k="등록률" /> <span className="font-semibold"><RegistrationRate led={led} /></span>.{' '}
            <T k="이 화면의 만료·미검증 지표는" /> <span className="font-semibold"><T k="모두 표본 0 기준" /></span><T k="이라 안전을 의미하지 않습니다." />
          </p>
          {led.hrLicenseNumberRows > 0 && (
            <p className="text-xs text-red-700 mt-1.5">
              <T k="참고 — 인사 원장(staff.license_number)에는 면허번호" /> <span className="font-semibold">{led.hrLicenseNumberRows}</span><Unit>건</Unit><T k="이 있습니다." />
              {' '}{led.hrLedgerNote}
            </p>
          )}
        </div>
      )}
      {led.built && led.registrationRate != null && led.registrationRate < 1 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs text-amber-800">
            <Tf k="자격 등재 미완 — 활성 임상직 {활성}명 중 {등재}명 등재" params={{ 활성: led.clinicalStaffActive, 등재: led.staffWithCredential }} />{' '}
            (<T k="등록률" /> <RegistrationRate led={led} />). <T k="미등재 인원의 만료 여부는 이 화면이 알 수 없습니다." />
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label={<T k="등록 자격" />} value={d.credentials.total} color={d.credentials.total === 0 ? 'text-red-600' : 'text-gray-900'} />
        {/* 🔴 만료 집계는 이제 표(effectiveStatus)와 같은 정본 — 관리자가 EXPIRED 로 바꾼 건도 센다 */}
        <Card label={<T k="만료됨" />} value={d.credentials.expired} color="text-red-600" hint={d.credentials.suspended ? <><T k="정지" /> {d.credentials.suspended}<Unit>건</Unit> <T k="별도" /></> : undefined} />
        <Card label={<T k="미검증" />} value={d.credentials.unverified} color="text-amber-600" />
        <Card label={<T k="교육 이수" />} value={d.education.total} color="text-emerald-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3">⏰ <T k="자격 만료 임박 (30일 내)" /></h3>
          {/* 🔴 초록 ✓ 는 근거가 있을 때만 — 원장이 비어 있으면 '이상 없음'을 말할 수 없다 */}
          {!led.built ? (
            <p className="text-xs text-red-600"><T k="판단 불가 — 등록된 자격이 0건입니다(원장 미구축)." /></p>
          ) : d.credentials.expiringSoonTotal === 0 ? (
            <p className="text-xs text-emerald-600"><T k="임박한 만료가 없습니다 ✓" /> <span className="text-gray-400">(<Tf k="등록 자격 {건수}건 기준" params={{ 건수: d.credentials.total }} />)</span></p>
          ) : (
            <>
              <div className="space-y-1.5">
                {d.credentials.expiringSoon.map(c => (
                  <div key={c.id} className="flex items-center justify-between border-b border-gray-50 py-1.5">
                    <span className="text-xs text-gray-700">{staffName(c.user, tAttr)} · {c.name}</span>
                    <span className={`text-[11px] font-bold ${(c.daysLeft ?? 0) <= 7 ? 'text-red-600' : 'text-amber-600'}`}>D-{c.daysLeft}</span>
                  </div>
                ))}
              </div>
              <PanelFooter total={d.credentials.expiringSoonTotal} shown={d.credentials.expiringSoon.length} truncated={d.credentials.expiringSoonTruncated} limit={d.panelLimit} />
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3">📚 <T k="필수교육 재이수" /></h3>
          {/*
            🔴 종전엔 `category='MANDATORY'` 한 종만 추적해 감염관리·환자안전이 통째로 빠졌고,
               '초과(이미 실효)'와 '임박'을 한 목록에 섞었다. 지금은 기한이 설정된 모든 기록을
               분류 표기와 함께 추적하고 초과/임박을 분리한다.
          */}
          {d.education.overdue.total === 0 && d.education.dueSoon.total === 0 ? (
            d.education.total === 0 ? (
              <p className="text-xs text-red-600"><T k="판단 불가 — 등록된 교육 이수 기록이 0건입니다." /></p>
            ) : (
              <p className="text-xs text-emerald-600">
                <T k="초과·임박 없음 ✓" />{' '}
                <span className="text-gray-400">(<Tf k="기한이 설정된 기록 {건수}건 기준" params={{ 건수: d.education.total - d.education.withoutDueDate }} />)</span>
              </p>
            )
          ) : (
            <div className="space-y-3">
              <DueList title={<T k="재이수 기한 초과" />} tone="red" bucket={d.education.overdue} limit={d.panelLimit} />
              <DueList title={<T k="30일 내 도래" />} tone="amber" bucket={d.education.dueSoon} limit={d.panelLimit} />
            </div>
          )}
          {d.education.withoutDueDate > 0 && (
            <p className="mt-3 text-[11px] text-gray-500">
              <T k="재이수 기한이 없는 기록" /> {d.education.withoutDueDate}<Unit>건</Unit><T k="은 추적 대상이 아닙니다(만료 여부 미상)." />
            </p>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400"><T k="기준 시각" /> {kdate(d.generatedAt, 'datetime')}</p>
    </div>
  );
}

function DueList({ title, tone, bucket, limit }: { title: ReactNode; tone: 'red' | 'amber'; bucket: DueBucket<Education>; limit: number }) {
  const tAttr = useTAttr();
  const color = tone === 'red' ? 'text-red-600' : 'text-amber-600';
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-600 mb-1">{title} <span className="text-gray-400">{bucket.total}<Unit>건</Unit></span></p>
      {bucket.total === 0 ? (
        <p className="text-[11px] text-gray-400"><T k="해당 없음" /></p>
      ) : (
        <>
          <div className="space-y-1.5">
            {bucket.items.map(e => (
              <div key={e.id} className="flex items-center justify-between border-b border-gray-50 py-1.5 gap-2">
                <span className="text-xs text-gray-700 truncate">
                  {staffName(e.user, tAttr)} · {e.courseName}
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700"><EduCategoryLabel k={e.category} /></span>
                </span>
                <span className={`text-[11px] font-bold whitespace-nowrap ${color}`}>
                  {(e.daysLeft ?? 0) < 0 ? <>{Math.abs(e.daysLeft ?? 0)}<Unit>일</Unit> <T k="초과" /></> : `D-${e.daysLeft}`}
                </span>
              </div>
            ))}
          </div>
          <PanelFooter total={bucket.total} shown={bucket.items.length} truncated={bucket.truncated} limit={limit} />
        </>
      )}
    </div>
  );
}

/** 🔴 패널 상한(20)·목록 상한(200)에 표식이 없어 잘린 사실을 아무도 몰랐다. */
function PanelFooter({ total, shown, truncated, limit }: { total: number; shown: number; truncated: boolean; limit: number }) {
  return (
    <p className="mt-2 text-[11px] text-gray-500">
      <Tf k="{전체}건 중 {표시}건 표시" params={{ 전체: total, 표시: shown }} />
      {truncated && <span className="text-gray-400"> · <Tf k="상한 {상한}건까지만 표시됩니다" params={{ 상한: limit }} /></span>}
    </p>
  );
}

function CredentialsTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { staff, isError: staffError } = useStaff();
  const [form, setForm] = useState({ userId: '', type: 'LICENSE', name: '', number: '', issuer: '', expiresAt: '' });
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sqe-credentials'],
    queryFn: () => apiClient.get<{ data: ListEnvelope<Credential> | { data: ListEnvelope<Credential> } }>('/api/v1/staff-qualification/credentials'),
  });
  const env = unwrap<ListEnvelope<Credential>>(data);
  const items = env?.items ?? [];

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/staff-qualification/credentials', form),
    onSuccess: () => { setForm({ userId: '', type: 'LICENSE', name: '', number: '', issuer: '', expiresAt: '' }); qc.invalidateQueries({ queryKey: ['sqe-credentials'] }); qc.invalidateQueries({ queryKey: ['sqe-dashboard'] }); toast.success(tAttr('자격 등록됨')); },
    onError: () => toast.error(tAttr('등록 실패')),
  });
  const verifyMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/staff-qualification/credentials/${id}/verify`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sqe-credentials'] }); qc.invalidateQueries({ queryKey: ['sqe-dashboard'] }); toast.success(tAttr('검증 확인됨')); },
    onError: () => toast.error(tAttr('검증 실패')),
  });

  return (
    <div className="space-y-4">
      {staffError && <p className="text-xs text-red-600"><T k={'직원 목록을 불러오지 못했습니다 — 선택 목록이 비어 있는 것은 "직원 없음"이 아닙니다.'} /></p>}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 grid grid-cols-2 md:grid-cols-6 gap-2">
        <select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs">
          <option value="">{tAttr('직원 선택')}</option>
          {staff.map(u => <option key={u.id} value={u.id}>{staffName(u, tAttr)}</option>)}
        </select>
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs">
          {CRED_TYPES.map(t => <option key={t.k} value={t.k}>{tAttr(t.l)}</option>)}
        </select>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={tAttr('명칭(예: 의사면허)')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs" />
        <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder={tAttr('번호')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs" />
        <input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs" />
        <button onClick={() => createMut.mutate()} disabled={!form.userId || !form.name.trim() || createMut.isPending} className="bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"><T k="등록" /></button>
      </div>

      {/* 🔴 조회 실패를 "등록된 자격이 없습니다"로 위장하지 않는다 */}
      {isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="px-4 py-2.5 text-left"><T k="직원" /></th><th className="px-4 py-2.5 text-left"><T k="유형" /></th><th className="px-4 py-2.5 text-left"><T k="명칭/번호" /></th><th className="px-4 py-2.5 text-left"><T k="만료" /></th><th className="px-4 py-2.5 text-left"><T k="상태" /></th><th className="px-4 py-2.5 text-left"><T k="검증" /></th>
            </tr></thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="py-10 text-center"><div className="h-4 w-40 mx-auto bg-gray-100 rounded animate-pulse" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6}><EmptyState title="등록된 자격이 없습니다" hint="면허·자격 원장이 아직 구축되지 않았습니다" /></td></tr>
              ) : items.map(c => (
                <tr key={c.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 text-gray-900">{staffName(c.user, tAttr)}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs"><T k={CRED_TYPES.find(t => t.k === c.type)?.l ?? c.type} /></td>
                  <td className="px-4 py-3 text-gray-700 text-xs">{c.name}{c.number ? ` · ${c.number}` : ''}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtD(c.expiresAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${(c.effectiveStatus ?? c.status) === 'EXPIRED' ? 'bg-red-100 text-red-700' : (c.effectiveStatus ?? c.status) === 'SUSPENDED' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {(c.effectiveStatus ?? c.status) === 'EXPIRED' ? <T k="만료" /> : (c.effectiveStatus ?? c.status) === 'SUSPENDED' ? <T k="정지@자격" /> : <T k="유효" />}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {c.verifiedAt ? <span className="text-[11px] text-emerald-600">✓ <T k="검증됨" /></span> : <button onClick={() => verifyMut.mutate(c.id)} className="text-[11px] text-blue-600 underline"><T k="검증" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {env && env.total > 0 && (
            <p className="px-4 py-2.5 text-[11px] text-gray-500 border-t border-gray-50">
              <Tf k="{전체}건 중 {표시}건 표시" params={{ 전체: env.total, 표시: items.length }} />
              {env.truncated && <span className="text-gray-400"> · <Tf k="서버 상한 {상한}건 — 나머지는 필터를 좁혀 조회하세요" params={{ 상한: env.limit }} /></span>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EducationTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { staff, isError: staffError } = useStaff();
  const [form, setForm] = useState({ userId: '', courseName: '', category: 'MANDATORY', completedAt: '', expiresAt: '' });
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sqe-education'],
    queryFn: () => apiClient.get<{ data: ListEnvelope<Education> | { data: ListEnvelope<Education> } }>('/api/v1/staff-qualification/education'),
  });
  const env = unwrap<ListEnvelope<Education>>(data);
  const items = env?.items ?? [];

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/staff-qualification/education', form),
    onSuccess: () => { setForm({ userId: '', courseName: '', category: 'MANDATORY', completedAt: '', expiresAt: '' }); qc.invalidateQueries({ queryKey: ['sqe-education'] }); qc.invalidateQueries({ queryKey: ['sqe-dashboard'] }); toast.success(tAttr('교육 기록됨')); },
    onError: () => toast.error(tAttr('기록 실패')),
  });

  // 등록 폼에는 중복 라벨(SAFETY/PATIENT_SAFETY)을 노출하지 않는다 — 신규 입력은 정규 키만.
  const formCategories = EDU_CATEGORIES.filter(c => c.k !== 'SAFETY');

  return (
    <div className="space-y-4">
      {staffError && <p className="text-xs text-red-600"><T k={'직원 목록을 불러오지 못했습니다 — 선택 목록이 비어 있는 것은 "직원 없음"이 아닙니다.'} /></p>}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 grid grid-cols-2 md:grid-cols-6 gap-2">
        <select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs">
          <option value="">{tAttr('직원 선택')}</option>
          {staff.map(u => <option key={u.id} value={u.id}>{staffName(u, tAttr)}</option>)}
        </select>
        <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-xs">
          {formCategories.map(c => <option key={c.k} value={c.k}>{tAttr(c.l)}</option>)}
        </select>
        <input value={form.courseName} onChange={e => setForm({ ...form, courseName: e.target.value })} placeholder={tAttr('교육과정명')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs md:col-span-2" />
        <input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} title={tAttr('재이수 기한')} className="border border-gray-200 rounded-lg px-2 py-2 text-xs" />
        <button onClick={() => createMut.mutate()} disabled={!form.userId || !form.courseName.trim() || createMut.isPending} className="bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"><T k="기록@버튼" /></button>
      </div>

      {isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="px-4 py-2.5 text-left"><T k="직원" /></th><th className="px-4 py-2.5 text-left"><T k="분류" /></th><th className="px-4 py-2.5 text-left"><T k="교육과정" /></th><th className="px-4 py-2.5 text-left"><T k="이수일" /></th><th className="px-4 py-2.5 text-left"><T k="재이수 기한" /></th>
            </tr></thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="py-10 text-center"><div className="h-4 w-40 mx-auto bg-gray-100 rounded animate-pulse" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5}><EmptyState title="교육 기록이 없습니다" /></td></tr>
              ) : items.map(e => (
                <tr key={e.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 text-gray-900">{staffName(e.user, tAttr)}</td>
                  <td className="px-4 py-3"><span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700"><EduCategoryLabel k={e.category} /></span></td>
                  <td className="px-4 py-3 text-gray-700 text-xs">{e.courseName}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtD(e.completedAt)}</td>
                  {/* 재이수 기한 미설정은 '-' 가 아니라 추적 불가라는 사실 */}
                  <td className="px-4 py-3 text-xs text-gray-500">{e.expiresAt ? kdate(e.expiresAt) : <span className="text-gray-400" title={tAttr('기한이 없어 만료를 추적하지 않습니다')}><T k="기한 없음" /></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {env && env.total > 0 && (
            <p className="px-4 py-2.5 text-[11px] text-gray-500 border-t border-gray-50">
              <Tf k="{전체}건 중 {표시}건 표시" params={{ 전체: env.total, 표시: items.length }} />
              {env.truncated && <span className="text-gray-400"> · <Tf k="서버 상한 {상한}건 — 나머지는 필터를 좁혀 조회하세요" params={{ 상한: env.limit }} /></span>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ label, value, color, hint }: { label: ReactNode; value: number; color: string; hint?: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}
