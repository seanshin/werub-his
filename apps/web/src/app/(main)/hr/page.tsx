'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useAuthStore } from '@/stores/auth-store';
import StatCard from '@/components/ui/StatCard';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface HrStaff {
  id: string;
  employeeNumber: string;
  familyName: string;
  givenName: string;
  department: string;
  position: string;
  category: string;
  licenseNumber?: string;
  hireDate?: string;
  resignDate?: string;
  status: string;
  specialty?: string;
  phone?: string;
  email?: string;
  clinicUserId?: string;
  executiveRole?: string;
}

interface HrDept {
  id: string;
  name: string;
}

const CL: Record<string, string> = { MEDICAL: '의료진', TECHNICAL: '의료기사', ADMIN: '행정', SUPPORT: '지원' };
/**
 * 🔴 표시용 i18n 키 — CL 에서 **파생**한다(정본 둘 금지). '지원'만 다의어(지원부서 ↔ 지원하다)라
 *    문맥 키로 가른다. `tOf` 는 ko 에서 `@` 뒤를 지우므로 한국어 화면은 그대로 '지원'이다.
 */
const CL_KEY: Record<string, string> = { ...CL, SUPPORT: '지원@직군' };
const CL_COLOR: Record<string, string> = { MEDICAL: 'bg-blue-50 text-blue-700', TECHNICAL: 'bg-violet-50 text-violet-700', ADMIN: 'bg-amber-50 text-amber-700', SUPPORT: 'bg-emerald-50 text-emerald-700' };
const STATUS_COLOR: Record<string, string> = { ACTIVE: 'bg-emerald-50 text-emerald-700', RESIGNED: 'bg-gray-100 text-gray-500', LEAVE: 'bg-amber-50 text-amber-700', SUSPENDED: 'bg-rose-50 text-rose-700' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: '재직', RESIGNED: '퇴직', LEAVE: '휴직', SUSPENDED: '정직' };

type Tab = 'list' | 'register' | 'resigned';

export default function HrPage() {
  const tAttr = useTAttr();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  // 관리자: 전체 직원 목록 / 일반: 내 인사정보만
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['hr'], queryFn: () => apiClient.get<{ data: HrStaff[] }>('/api/v1/hr/staff?status=ALL'), enabled: isAdmin });
  const { data: myData, isLoading: myLoading } = useQuery({ queryKey: ['hr-me'], queryFn: () => apiClient.get<{ data: HrStaff }>('/api/v1/hr/me'), enabled: !isAdmin });
  const { data: resignedData } = useQuery({ queryKey: ['hr-resigned'], queryFn: () => apiClient.get<{ data: HrStaff[] }>('/api/v1/hr/staff?status=RESIGNED'), enabled: isAdmin && tab === 'resigned' });
  const { data: detailData } = useQuery({ queryKey: ['hr-detail', selectedId], queryFn: () => apiClient.get<{ data: HrStaff }>(`/api/v1/hr/staff/${selectedId}`), enabled: isAdmin && !!selectedId });
  const { data: deptData } = useQuery({ queryKey: ['hr-depts'], queryFn: () => apiClient.get<{ data: HrDept[] }>('/api/v1/hr/departments'), enabled: isAdmin });

  const _staffRaw = data?.data;
  const staff: HrStaff[] = Array.isArray(_staffRaw) ? _staffRaw : (_staffRaw as unknown as { data?: HrStaff[] })?.data ?? [];
  const _resignedRaw = resignedData?.data;
  const resigned: HrStaff[] = Array.isArray(_resignedRaw) ? _resignedRaw : (_resignedRaw as unknown as { data?: HrStaff[] })?.data ?? [];
  const detail = detailData?.data;
  const _deptRaw = deptData?.data;
  const depts: HrDept[] = Array.isArray(_deptRaw) ? _deptRaw : (_deptRaw as unknown as { data?: HrDept[] })?.data ?? [];
  const activeStaff = staff.filter((s) => s.status === 'ACTIVE');
  /**
   * 🔴 종전에는 목록 요청이 서버에서 이미 ACTIVE 로 걸러져 있었는데 FE 는 그걸 모르고
   * 다시 필터했다(P11). 그 결과 **휴직·정직 직원은 목록에도 퇴직자 탭에도 없어** 인사
   * 화면 어디에서도 보이지 않았고, 카드 '전체 직원'과 '재직중'은 늘 같은 수를 나란히 띄웠다.
   */
  const onLeaveStaff = staff.filter((s) => s.status === 'LEAVE' || s.status === 'SUSPENDED');
  const rosterStaff = staff.filter((s) => s.status !== 'RESIGNED');

  const resignMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/hr/staff/${id}/resign`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr'] }); setSelectedId(null); },
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  // 일반 직원: 내 인사정보만 표시
  if (!isAdmin) {
    const myProfile = (myData?.data as unknown as { data?: HrStaff })?.data ?? myData?.data;
    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900"><T k="내 인사정보" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="나의 인사 정보 확인" /></p>
        </div>
        {myLoading ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <p className="text-sm text-gray-400"><T k="로딩 중..." /></p>
          </div>
        ) : !myProfile ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <p className="text-sm text-gray-400"><T k="인사 정보가 등록되지 않았습니다." /></p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-xl font-bold text-blue-700">{myProfile.familyName}</span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{myProfile.familyName}{myProfile.givenName}</h3>
                  <p className="text-sm text-gray-500">{myProfile.department} · {myProfile.position}</p>
                </div>
                <span className={`ml-auto text-xs font-bold px-3 py-1 rounded-full ${CL_COLOR[myProfile.category]}`}><T k={CL_KEY[myProfile.category]} /></span>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                <InfoField label="사번" value={myProfile.employeeNumber} />
                <InfoField label="부서" value={myProfile.department} />
                <InfoField label="직위" value={myProfile.position} />
                <InfoField label="전공/전문" value={myProfile.specialty} />
                <InfoField label="면허번호" value={myProfile.licenseNumber} />
                <InfoField label="연락처" value={myProfile.phone} />
                <InfoField label="이메일" value={myProfile.email} />
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="재직 정보" /></h4>
              <div className="space-y-3 text-sm">
                <InfoField label="상태" badge={STATUS_LABEL[myProfile.status]} badgeColor={STATUS_COLOR[myProfile.status]} />
                <InfoField label="입사일" value={myProfile.hireDate ? kdate(myProfile.hireDate) : '-'} />
                {myProfile.hireDate && (
                  <InfoField label="근속기간" value={`${Math.floor((Date.now() - new Date(myProfile.hireDate).getTime()) / (1000 * 60 * 60 * 24 * 365))}년 ${Math.floor(((Date.now() - new Date(myProfile.hireDate).getTime()) % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30))}개월`} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="인사 관리" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="직원 등록, 인사정보, 입사/퇴사 관리" /></p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatCard title={tAttr('재직중')} value={activeStaff.length} color="bg-emerald-50 border-emerald-200 text-emerald-700" />
        <StatCard title={tAttr('휴직·정직')} value={onLeaveStaff.length} color="bg-amber-50 border-amber-200 text-amber-700" />
        <StatCard title={tAttr('의료진')} value={activeStaff.filter((s) => s.category === 'MEDICAL').length} color="bg-blue-50 border-blue-200 text-blue-700" />
        <StatCard title={tAttr('행정/지원')} value={activeStaff.filter((s) => s.category === 'ADMIN' || s.category === 'SUPPORT').length} color="bg-amber-50 border-amber-200 text-amber-700" />
        <StatCard title={tAttr('부서')} value={depts.length} color="bg-indigo-50 border-indigo-200 text-indigo-700" />
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { id: 'list' as Tab, label: '직원 목록' },
          { id: 'register' as Tab, label: '직원 등록' },
          { id: 'resigned' as Tab, label: '퇴직자' },
        ]).map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSelectedId(null); setEditMode(false); }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
        ))}
      </div>

      {/* ── 직원 목록 ── */}
      {tab === 'list' && !selectedId && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="사번" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="이름" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부서" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="직위" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="구분" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="면허번호" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="입사일" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <tr key={i} className="border-b border-gray-50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded-lg animate-pulse" /></td></tr>)
              ) : rosterStaff.map((s) => (
                <tr key={s.id} onClick={() => setSelectedId(s.id)} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.employeeNumber}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.familyName}{s.givenName}</td>
                  <td className="px-4 py-3 text-gray-600">{s.department}</td>
                  <td className="px-4 py-3 text-gray-600">{s.position}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CL_COLOR[s.category]}`}><T k={CL_KEY[s.category]} /></span></td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{s.licenseNumber ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs tabular-nums">{s.hireDate ? kdate(s.hireDate) : '-'}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[s.status]}`}><T k={STATUS_LABEL[s.status] ?? s.status} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 직원 상세 ── */}
      {tab === 'list' && selectedId && detail && (
        <StaffDetail
          staff={detail}
          editMode={editMode}
          onBack={() => { setSelectedId(null); setEditMode(false); }}
          onEdit={() => setEditMode(true)}
          onResign={() => { if (confirm(`${detail.familyName}${detail.givenName} 직원을 퇴직 처리하시겠습니까?`)) resignMut.mutate(selectedId); }}
          onSave={async (data: Record<string, string>) => { await apiClient.put(`/api/v1/hr/staff/${selectedId}`, data); qc.invalidateQueries({ queryKey: ['hr-detail', selectedId] }); qc.invalidateQueries({ queryKey: ['hr'] }); setEditMode(false); }}
        />
      )}

      {/* ── 직원 등록 ── */}
      {tab === 'register' && (
        <StaffRegisterForm onSuccess={() => { setTab('list'); qc.invalidateQueries({ queryKey: ['hr'] }); }} />
      )}

      {/* ── 퇴직자 ── */}
      {tab === 'resigned' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="사번" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="이름" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부서" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="직위" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="구분" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="입사일" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="퇴사일" /></th>
              </tr>
            </thead>
            <tbody>
              {resigned.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400 text-sm"><T k="퇴직자가 없습니다." /></td></tr>
              ) : resigned.map((s) => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{s.employeeNumber}</td>
                  <td className="px-4 py-3 text-gray-500">{s.familyName}{s.givenName}</td>
                  <td className="px-4 py-3 text-gray-400">{s.department}</td>
                  <td className="px-4 py-3 text-gray-400">{s.position}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CL_COLOR[s.category]}`}><T k={CL_KEY[s.category]} /></span></td>
                  <td className="px-4 py-3 text-gray-400 text-xs tabular-nums">{s.hireDate ? kdate(s.hireDate) : '-'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs tabular-nums">{s.resignDate ? kdate(s.resignDate) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* StatCard: moved to @/components/ui/StatCard */

function StaffDetail({ staff, editMode, onBack, onEdit, onResign, onSave }: { staff: HrStaff; editMode: boolean; onBack: () => void; onEdit: () => void; onResign: () => void; onSave: (d: Record<string, string>) => void }) {
  const [form, setForm] = useState<Record<string, string>>({ ...staff as unknown as Record<string, string> });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div>
      <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-700 mb-4 flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        <T k="목록으로" />
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 기본 정보 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-lg font-bold text-blue-700">{staff.familyName}</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">{staff.familyName}{staff.givenName}</h3>
                <p className="text-sm text-gray-500">{staff.department} · {staff.position}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {!editMode && <button onClick={onEdit} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="수정" /></button>}
              {!editMode && staff.status === 'ACTIVE' && <button onClick={onResign} className="px-3 py-1.5 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700"><T k="퇴직 처리" /></button>}
              {editMode && <button onClick={() => onSave(form)} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="저장" /></button>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <InfoField label="사번" value={staff.employeeNumber} />
            <InfoField label="구분" badge={CL_KEY[staff.category]} badgeColor={CL_COLOR[staff.category]} />
            {editMode ? (
              <>
                <EditField label="부서" value={form.department} onChange={v => set('department', v)} />
                <EditField label="직위" value={form.position} onChange={v => set('position', v)} />
                <EditField label="전공/전문" value={form.specialty ?? ''} onChange={v => set('specialty', v)} />
                <EditField label="연락처" value={form.phone ?? ''} onChange={v => set('phone', v)} />
                <EditField label="이메일" value={form.email ?? ''} onChange={v => set('email', v)} />
              </>
            ) : (
              <>
                <InfoField label="부서" value={staff.department} />
                <InfoField label="직위" value={staff.position} />
                <InfoField label="전공/전문" value={staff.specialty} />
                <InfoField label="면허번호" value={staff.licenseNumber} />
                <InfoField label="연락처" value={staff.phone} />
                <InfoField label="이메일" value={staff.email} />
              </>
            )}
          </div>
        </div>

        {/* 입퇴사 정보 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="입퇴사 정보" /></h4>
          <div className="space-y-3 text-sm">
            <InfoField label="상태" badge={STATUS_LABEL[staff.status]} badgeColor={STATUS_COLOR[staff.status]} />
            <InfoField label="입사일" value={staff.hireDate ? kdate(staff.hireDate) : '-'} />
            <InfoField label="퇴사일" value={staff.resignDate ? kdate(staff.resignDate) : '-'} />
            {staff.hireDate && (
              <InfoField label="근속기간" value={`${Math.floor((Date.now() - new Date(staff.hireDate).getTime()) / (1000 * 60 * 60 * 24 * 365))}년 ${Math.floor(((Date.now() - new Date(staff.hireDate).getTime()) % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30))}개월`} />
            )}
            {staff.clinicUserId && <InfoField label="Clinic 연동" value="연결됨" />}
            {/* 🔴 value 는 <T> 를 거치지 않는다 — 근속기간처럼 **계산된 한국어**('3년 2개월')에
                거짓 미등록 티가 붙기 때문이다. 값의 어휘는 별도 축(사람 검수 목록에 남긴다). */}
            {staff.executiveRole && <InfoField label="경영진 역할" value={staff.executiveRole === 'CEO' ? '경영진(CEO)' : '의료원장(CMO)'} />}
          </div>
        </div>
      </div>
    </div>
  );
}

const staffRegisterSchema = z.object({
  employeeNumber: z.string().min(1, '사번을 입력하세요'),
  familyName: z.string().min(1, '성을 입력하세요'),
  givenName: z.string().min(1, '이름을 입력하세요'),
  category: z.enum(['MEDICAL', 'TECHNICAL', 'ADMIN', 'SUPPORT']),
  department: z.string().min(1, '부서를 입력하세요'),
  position: z.string().min(1, '직위를 입력하세요'),
  licenseNumber: z.string().optional(),
  specialty: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('올바른 이메일 형식을 입력하세요').optional().or(z.literal('')),
  hireDate: z.string().min(1, '입사일을 입력하세요'),
});
type StaffRegisterFormData = z.infer<typeof staffRegisterSchema>;

function StaffRegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const tAttr = useTAttr();
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<StaffRegisterFormData>({
    resolver: zodResolver(staffRegisterSchema),
    defaultValues: { category: 'MEDICAL' },
  });

  const inputClass = (name: keyof StaffRegisterFormData) =>
    `w-full px-3 py-2 border ${errors[name] ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent`;

  const onSubmit = async (data: StaffRegisterFormData) => {
    setSaving(true);
    try {
      await apiClient.post('/api/v1/hr/staff', { ...data, status: 'ACTIVE' });
      onSuccess();
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-3xl">
      <h3 className="text-sm font-bold text-gray-900 mb-5"><T k="신규 직원 등록" /></h3>

      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3"><T k="기본 정보" /></p>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="사번 *" /></label>
          <input {...register('employeeNumber')} placeholder="EMP-2026-044" className={inputClass('employeeNumber')} />
          {errors.employeeNumber && <p className="text-xs text-red-500 mt-0.5"><T k={errors.employeeNumber.message ?? ''} /></p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="성 *" /></label>
          <input {...register('familyName')} placeholder="홍" className={inputClass('familyName')} />
          {errors.familyName && <p className="text-xs text-red-500 mt-0.5"><T k={errors.familyName.message ?? ''} /></p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="이름 *" /></label>
          <input {...register('givenName')} placeholder="길동" className={inputClass('givenName')} />
          {errors.givenName && <p className="text-xs text-red-500 mt-0.5"><T k={errors.givenName.message ?? ''} /></p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="구분 *" /></label>
          <select {...register('category')} className={inputClass('category')}>
            <option value="MEDICAL">{tAttr('의료진')}</option>
            <option value="TECHNICAL">{tAttr('의료기사')}</option>
            <option value="ADMIN">{tAttr('행정')}</option>
            <option value="SUPPORT">{tAttr('지원@직군')}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="부서 *" /></label>
          <input {...register('department')} placeholder="내과" className={inputClass('department')} />
          {errors.department && <p className="text-xs text-red-500 mt-0.5"><T k={errors.department.message ?? ''} /></p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="직위 *" /></label>
          <input {...register('position')} placeholder="전문의" className={inputClass('position')} />
          {errors.position && <p className="text-xs text-red-500 mt-0.5"><T k={errors.position.message ?? ''} /></p>}
        </div>
      </div>

      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3"><T k="상세 정보" /></p>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="면허번호" /></label>
          <input {...register('licenseNumber')} placeholder="MD-2026-00001" className={inputClass('licenseNumber')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="전공/전문" /></label>
          <input {...register('specialty')} placeholder="순환기내과" className={inputClass('specialty')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="연락처" /></label>
          <input {...register('phone')} placeholder="010-0000-0000" className={inputClass('phone')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="이메일" /></label>
          <input {...register('email')} placeholder="name@hospitalrun.example" className={inputClass('email')} />
          {errors.email && <p className="text-xs text-red-500 mt-0.5"><T k={errors.email.message ?? ''} /></p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="입사일 *" /></label>
          <input type="date" {...register('hireDate')} className={inputClass('hireDate')} />
          {errors.hireDate && <p className="text-xs text-red-500 mt-0.5"><T k={errors.hireDate.message ?? ''} /></p>}
        </div>
      </div>

      <button type="submit" disabled={saving} className="px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50">
        <T k={saving ? '등록중...' : '직원 등록'} />
      </button>
    </form>
  );
}

function InfoField({ label, value, badge, badgeColor }: { label: string; value?: string | null; badge?: string; badgeColor?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500"><T k={label} /></span>
      {badge ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}><T k={badge} /></span> : <span className="font-medium text-gray-900">{value || '-'}</span>}
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1"><T k={label} /></label>
      <input value={value} onChange={e => onChange(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
    </div>
  );
}

