'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { MutationError, UserRole, USER_ROLE_LABEL, CLINICAL_PROFESSIONS, CLINICAL_PROFESSION_LABEL, PROFESSION_ROLE, ROLE_DEFAULT_PROFESSION, type ClinicalProfession } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

const createStaffSchema = z.object({
  email: z.string().email('올바른 이메일을 입력하세요'),
  familyName: z.string().min(1, '성을 입력하세요'),
  givenName: z.string().min(1, '이름을 입력하세요'),
  role: z.string().min(1),
  department: z.string().min(1),
  specialty: z.string().optional(),
  /** 직종(오더 입력 범위) — '' = 역할 기본. 역할과 맞는 것만 고를 수 있다(서버도 검사) */
  profession: z.string().optional(),
});
type CreateStaffForm = z.infer<typeof createStaffSchema>;

interface StaffUser {
  id: string;
  email: string;
  familyName: string;
  givenName: string;
  role: UserRole;
  department?: string;
  specialty?: string;
  profession?: string | null;
  isActive: boolean;
}

/** 역할에 둘 수 있는 직종 — 정본 shared PROFESSION_ROLE(의료기사는 LAB_TECH 공유·직종으로 갈림) */
function professionsForRole(role: string): ClinicalProfession[] {
  return CLINICAL_PROFESSIONS.filter((p) => PROFESSION_ROLE[p] === role);
}

interface OrgDept {
  department: string;
  count: number;
  members: { id: string; familyName: string; givenName: string; role: string; specialty?: string }[];
}

interface RoleMapping {
  staffId: string;
  name: string;
  department?: string;
  hisRole: string;
  linked: boolean;
}

interface SyncLog {
  id: string;
  syncType: string;
  status: string;
  executedAt: string;
  totalSent: number;
  registered: number;
  skipped: number;
  failed: number;
  errorMessage?: string;
  executor?: { familyName: string; givenName: string };
}

interface ClinicStatus {
  configured: boolean;
  hospitalCode?: string;
  clinicApiUrl?: string;
  hasApiKey: boolean;
}

interface SyncResult {
  registered?: number;
  skipped?: number;
}

const ROLES = [
  { value: 'ADMIN', label: '관리자' },
  { value: 'DOCTOR', label: '의사' },
  { value: 'NURSE', label: '간호사' },
  { value: 'PHARMACIST', label: '약사' },
  { value: 'LAB_TECH', label: '검사' },
];
const ROLE_COLOR: Record<string, string> = {
  ADMIN: 'bg-red-50 text-red-700',
  DOCTOR: 'bg-blue-50 text-blue-700',
  NURSE: 'bg-emerald-50 text-emerald-700',
  PHARMACIST: 'bg-violet-50 text-violet-700',
  LAB_TECH: 'bg-amber-50 text-amber-700',
};
// 🔴 근무부서 어휘는 마스터(진료과 36)와 실사용(병동·검사실 파트 단위 51종)이 갈라져 있다 —
//    정비는 사람 판단(input-assist-ux.plan §6). 그때까지 목록 = 마스터 ∪ 재직자 실소속(합집합).

/** UI 크롬 언어(P2-7) — ROLES 라벨은 ko 정본 그대로 두고 렌더 키만 문맥화한다.
 *  '검사'는 검체검사(공통 어휘)와 동음이의라 `검사@직군` 문맥 키를 쓴다. */
const roleKey = (label: string) => (label === '검사' ? '검사@직군' : label);

export default function StaffManagementPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [tab, setTab] = useState<'list' | 'org' | 'create' | 'clinic'>('list');
  const [resetModal, setResetModal] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  /** 🔴 서버가 발급한 일회용 비밀번호 — 이 화면 상태에만 두고 닫으면 버린다(다시 조회할 EP 가 없다·저장하지 않는다) */
  const [issued, setIssued] = useState<{ email: string | null; password: string } | null>(null);
  const [syncStatus, setSyncStatus] = useState('');
  const [syncLog, setSyncLog] = useState<{ time: string; type: string; message: string; data?: SyncResult }[]>([]);

  const { data: usersData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiClient.get<{ data: StaffUser[] }>('/api/v1/users'),
  });

  const users_ = (usersData as { data?: { department?: string | null }[] } | undefined)?.data ?? [];
  const { names: departments, isError: deptListError, refetch: refetchDepts } = useDepartments({ include: users_.map((u) => u.department) });

  const { data: orgData } = useQuery({
    queryKey: ['org-chart'],
    queryFn: () => apiClient.get<{ data: OrgDept[] }>('/api/v1/users/org-chart'),
    enabled: tab === 'org',
  });

  const resetPwMut = useMutation({
    // 🔴 (2026-09-14) 비워 보내면 서버가 정책을 통과하는 일회용 임의 비밀번호를 발급한다 — 공용 기본값 버튼(시드 계정 비밀번호와 같은 값)을 없앴다
    mutationFn: ({ id, pw }: { id: string; pw: string }) =>
      apiClient.patch<{ data?: { issuedPassword?: string } }>(`/api/v1/users/${id}/reset-password`, pw ? { newPassword: pw } : {}),
    onSuccess: (res, vars) => {
      const pw = res?.data?.issuedPassword;
      if (pw) setIssued({ email: users.find((u) => u.id === vars.id)?.email ?? null, password: pw });
      setResetModal(null); setNewPassword(''); qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  // 직종 지정 — 오더 입력 범위(본인 권한/의사 승인/불가)와 치료 시행 여부가 여기서 갈린다
  const professionMut = useMutation({
    mutationFn: ({ id, profession }: { id: string; profession: string | null }) =>
      apiClient.put(`/api/v1/users/${id}`, { profession }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch(`/api/v1/users/${id}/${active ? 'activate' : 'deactivate'}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const { data: clinicStatusData } = useQuery({
    queryKey: ['clinic-status'],
    queryFn: () => apiClient.get<{ data: ClinicStatus }>('/api/v1/clinic/status'),
    enabled: tab === 'clinic',
  });

  const { data: roleMappingData } = useQuery({
    queryKey: ['clinic-role-mapping'],
    queryFn: () => apiClient.get<{ data: { mappings: RoleMapping[] } }>('/api/v1/clinic/role-mapping'),
    enabled: tab === 'clinic',
  });

  const { data: syncLogsData } = useQuery({
    queryKey: ['clinic-sync-logs'],
    queryFn: () => apiClient.get<{ data: SyncLog[] }>('/api/v1/clinic/sync-logs'),
    enabled: tab === 'clinic',
  });

  const syncClinicMut = useMutation({
    mutationFn: () => apiClient.post<SyncResult>('/api/v1/clinic/push-staff'),
    onSuccess: (data: SyncResult) => {
      setSyncStatus('success');
      setSyncLog(prev => [{ time: kdate(new Date(), 'timeSec'), type: 'success', message: `동기화 완료: registered ${data?.registered ?? '?'}, skipped ${data?.skipped ?? '?'}`, data }, ...prev]);
      qc.invalidateQueries({ queryKey: ['clinic-status'] });
      qc.invalidateQueries({ queryKey: ['clinic-role-mapping'] });
    },
    onError: (e: MutationError) => {
      setSyncStatus('error');
      setSyncLog(prev => [{ time: kdate(new Date(), 'timeSec'), type: 'error', message: `동기화 실패: ${e.message}` }, ...prev]);
    },
  });

  const { register: regCreate, handleSubmit: handleCreate, formState: { errors: createErrors }, reset: resetCreate, watch: watchCreate } = useForm<CreateStaffForm>({
    resolver: zodResolver(createStaffSchema),
    defaultValues: { email: '', familyName: '', givenName: '', role: 'DOCTOR', department: '내과', specialty: '' },
  });
  const createMut = useMutation({
    // 🔴 (2026-09-14) 비밀번호를 보내지 않는다 — 서버가 일회용 임의 비밀번호를 발급해 응답에서 한 번만 돌려준다
    // 직종 '' = 미지정 → 보내지 않는다(서버 @IsIn 이 빈 문자열을 거부) · 역할과 안 맞는 직종은 서버가 400
    mutationFn: ({ profession, ...d }: CreateStaffForm) => apiClient.post<{ data?: { email?: string; issuedPassword?: string } }>('/api/v1/users', { ...d, ...(profession && professionsForRole(d.role).includes(profession as ClinicalProfession) ? { profession } : {}) }),
    onSuccess: (res) => {
      const pw = res?.data?.issuedPassword;
      if (pw) setIssued({ email: res?.data?.email ?? null, password: pw });
      qc.invalidateQueries({ queryKey: ['admin-users'] }); setTab('list'); resetCreate();
    },
  });

  const _usersRaw = usersData?.data;
  const users: StaffUser[] = Array.isArray(_usersRaw) ? _usersRaw : (_usersRaw as unknown as { data?: StaffUser[] })?.data ?? [];
  const _orgRaw = orgData?.data;
  const orgChart: OrgDept[] = Array.isArray(_orgRaw) ? _orgRaw : (_orgRaw as unknown as { data?: OrgDept[] })?.data ?? [];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="직원 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="계정 관리, 조직도, 패스워드 초기화, Clinic 동기화" /></p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => syncClinicMut.mutate()} disabled={syncClinicMut.isPending}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {syncClinicMut.isPending ? <T k="동기화 중..." /> : <T k="Clinic 동기화" />}
          </button>
        </div>
      </div>

      {syncStatus && (
        <div className={`px-4 py-3 rounded-xl text-sm ${syncStatus.includes('실패') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {syncStatus}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { key: 'list' as const, label: '직원 목록' },
          { key: 'org' as const, label: '조직도' },
          { key: 'create' as const, label: '+ 직원 등록' },
          { key: 'clinic' as const, label: 'Clinic 연동' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* 직원 목록 */}
      {tab === 'list' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="이름" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="이메일" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="역할" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진료과" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="세부전문과" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500" title={tAttr('오더 입력 범위와 치료 시행 여부를 정한다 — 의료기사(LAB_TECH)는 직종으로 갈린다')}><T k="직종" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="액션" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 w-20 bg-gray-100 rounded animate-pulse" /></td>)}
                  </tr>
                ))
              ) : users.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.familyName}{u.givenName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                      {(() => { const l = ROLES.find(r => r.value === u.role)?.label; return l ? <T k={roleKey(l)} /> : u.role; })()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{u.department ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{u.specialty ?? '-'}</td>
                  <td className="px-4 py-3 text-xs">
                    {(() => {
                      const opts = professionsForRole(u.role);
                      const def = ROLE_DEFAULT_PROFESSION[u.role];
                      if (opts.length <= 1) {
                        // 고를 것이 없는 역할(의사·간호사·약사 등) — 역할이 곧 직종
                        return <span className="text-gray-500">{def ? tAttr(CLINICAL_PROFESSION_LABEL[def]) : '-'}</span>;
                      }
                      return (
                        <select value={u.profession ?? ''} data-profession-select={u.id}
                          disabled={professionMut.isPending}
                          onChange={(e) => professionMut.mutate({ id: u.id, profession: e.target.value || null })}
                          aria-label={tAttr('직종')}
                          className={`rounded-lg border px-2 py-1 text-xs ${u.profession ? 'border-gray-200 text-gray-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                          <option value="">{tAttr('미지정')} ({def ? tAttr(CLINICAL_PROFESSION_LABEL[def]) : '-'} {tAttr('으로 판정')})</option>
                          {opts.map((p) => <option key={p} value={p}>{tAttr(CLINICAL_PROFESSION_LABEL[p])}</option>)}
                        </select>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {u.isActive ? <T k="활성" /> : <T k="비활성" />}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => { setResetModal(u.id); setNewPassword(''); }}
                        className="px-2 py-1 text-[11px] bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100"><T k="PW초기화" /></button>
                      <button onClick={() => toggleActiveMut.mutate({ id: u.id, active: !u.isActive })}
                        className={`px-2 py-1 text-[11px] rounded-lg ${u.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                        {u.isActive ? <T k="비활성화" /> : <T k="활성화" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 bg-gray-50 text-xs text-gray-500">
            <T k="총" /> {users.length}<Unit>명</Unit> | <T k="활성" /> {users.filter((u) => u.isActive).length}<Unit>명</Unit>
          </div>
        </div>
      )}

      {/* 조직도 */}
      {tab === 'org' && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {orgChart.map((dept) => (
            <div key={dept.department} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900">{dept.department}</h3>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{dept.count}<Unit>명</Unit></span>
              </div>
              <div className="space-y-2">
                {dept.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    {/* 🔴 색만으로 직군을 말하지 않는다(§4.6) — 의미는 m.role 에서(어휘 정본 shared USER_ROLE_LABEL).
                        회색은 "그 외 직군"이라 무슨 직군인지 색으로는 알 수 없다 */}
                    <span
                      aria-label={tAttr(USER_ROLE_LABEL[m.role] ?? (m.role || '직군 미지정'))}
                      title={tAttr(USER_ROLE_LABEL[m.role] ?? (m.role || '직군 미지정'))}
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.role === 'DOCTOR' ? 'bg-blue-500' : m.role === 'NURSE' ? 'bg-emerald-500' : m.role === 'ADMIN' ? 'bg-red-500' : 'bg-gray-400'}`}
                    />
                    <span className="text-xs text-gray-700">{m.familyName}{m.givenName}</span>
                    {m.specialty && <span className="text-[10px] text-gray-400">({m.specialty})</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 직원 등록 */}
      {tab === 'create' && (
        <form onSubmit={handleCreate((d) => createMut.mutate(d))} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-2xl">
          <h3 className="text-lg font-bold text-gray-900 mb-4"><T k="신규 직원 등록" /></h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="성" /></label>
              <input {...regCreate('familyName')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              {createErrors.familyName && <p className="text-xs text-red-500 mt-0.5"><T k={createErrors.familyName.message ?? ''} /></p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="이름" /></label>
              <input {...regCreate('givenName')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              {createErrors.givenName && <p className="text-xs text-red-500 mt-0.5"><T k={createErrors.givenName.message ?? ''} /></p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="이메일" /></label>
              <input {...regCreate('email')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="name@hospitalrun.example" />
              {createErrors.email && <p className="text-xs text-red-500 mt-0.5"><T k={createErrors.email.message ?? ''} /></p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="초기 비밀번호" /></label>
              <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600"><T k="등록하면 서버가 일회용 임의 비밀번호를 발급해 한 번만 보여 줍니다." /></p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="역할" /></label>
              <select {...regCreate('role')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {ROLES.map(r => <option key={r.value} value={r.value}>{tAttr(roleKey(r.label))}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="진료과" /></label>
              <select {...regCreate('department')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {departments.map(d => <option key={d}>{d}</option>)}
              </select>
              {deptListError && <DeptLoadError onRetry={refetchDepts} />}
            </div>
            {professionsForRole(watchCreate('role')).length > 1 && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="직종" /> <span className="text-gray-400">(<T k="의료기사는 직종으로 오더 입력 범위·치료 시행이 갈립니다" />)</span></label>
                <select {...regCreate('profession')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" data-create-profession>
                  <option value="">{tAttr('미지정')}</option>
                  {professionsForRole(watchCreate('role')).map((p) => <option key={p} value={p}>{tAttr(CLINICAL_PROFESSION_LABEL[p])}</option>)}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="세부전문과 (선택)" /></label>
              <input {...regCreate('specialty')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('순환기내과, 일반외과 등')} />
            </div>
          </div>
          <button type="submit" disabled={createMut.isPending}
            className="mt-4 px-6 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {createMut.isPending ? <T k="생성 중...@등록" /> : <T k="직원 등록" />}
          </button>
        </form>
      )}

      {/* Clinic 연동 */}
      {tab === 'clinic' && (() => {
        const cs = clinicStatusData?.data;
        const mappings: RoleMapping[] = roleMappingData?.data?.mappings ?? [];
        const linked = mappings.filter((m) => m.linked).length;
        const unlinked = mappings.filter((m) => !m.linked).length;

        return (
          <div className="space-y-6">
            {/* 연동 상태 카드 */}
            <div className="grid grid-cols-4 gap-4">
              <div className={`rounded-xl p-4 ${cs?.configured ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <p className="text-xs font-medium text-gray-500"><T k="연동 상태" /></p>
                <p className={`text-lg font-bold mt-1 ${cs?.configured ? 'text-emerald-700' : 'text-red-700'}`}>{cs?.configured ? <T k="연결됨" /> : <T k="미연결" />}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-4">
                <p className="text-xs font-medium text-gray-500">Hospital Code</p>
                <p className="text-sm font-mono font-bold text-blue-700 mt-1">{cs?.hospitalCode ?? '-'}</p>
              </div>
              <div className="bg-indigo-50 rounded-xl p-4">
                <p className="text-xs font-medium text-gray-500"><T k="매핑 완료" /></p>
                <p className="text-lg font-bold text-indigo-700 mt-1">{linked}<Unit>명</Unit> <span className="text-xs font-normal text-gray-400">/ {mappings.length}<Unit>명</Unit></span></p>
              </div>
              <div className="bg-amber-50 rounded-xl p-4">
                <p className="text-xs font-medium text-gray-500"><T k="미매핑" /></p>
                <p className="text-lg font-bold text-amber-700 mt-1">{unlinked}<Unit>명</Unit></p>
              </div>
            </div>

            {/* Clinic API 정보 */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="Clinic API 연동 정보" /></h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg px-3 py-2"><span className="text-gray-400 text-xs">API URL</span><p className="font-mono text-xs text-gray-700">{cs?.clinicApiUrl ?? '-'}</p></div>
                <div className="bg-gray-50 rounded-lg px-3 py-2"><span className="text-gray-400 text-xs">API Key</span><p className="font-mono text-xs text-gray-700">{cs?.hasApiKey ? <>••••••••(<T k="설정됨" />)</> : <T k="미설정" />}</p></div>
              </div>
            </div>

            {/* 동기화 버튼 + 로그 */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-900"><T k="Clinic 동기화" /></h3>
                <button onClick={() => syncClinicMut.mutate()} disabled={syncClinicMut.isPending}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {syncClinicMut.isPending ? <T k="동기화 중..." /> : <T k="HIS → Clinic 직원 동기화 실행" />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-4"><T k="HIS에 등록된 전체 직원을 Clinic에 일괄 등록합니다. 🔴 모든 직원이 같은 공용 초기 비밀번호로 등록됩니다(이메일 기준 중복 skip) — Clinic 에서 첫 로그인 후 변경하게 안내하세요." /></p>

              {/* 동기화 이력 (DB 저장) */}
              <div className="bg-gray-50 rounded-xl p-4 max-h-80 overflow-y-auto">
                <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2"><T k="동기화 이력" /></p>
                {(() => {
                  const _syncLogsRaw = syncLogsData?.data;
                  const logs: SyncLog[] = Array.isArray(_syncLogsRaw) ? _syncLogsRaw : (_syncLogsRaw as unknown as { data?: SyncLog[] })?.data ?? [];
                  return logs.length === 0 ? (
                    <p className="text-xs text-gray-400"><T k="아직 동기화 기록이 없습니다." /></p>
                  ) : (
                    <div className="space-y-2">
                      {logs.map((log) => (
                        <div key={log.id} className={`p-3 rounded-lg border ${log.status === 'SUCCESS' ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${log.status === 'SUCCESS' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              <span className="text-xs font-medium text-gray-900">{log.syncType}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${log.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{log.status}</span>
                            </div>
                            <span className="text-[10px] text-gray-400">{kdate(new Date(log.executedAt), 'datetime')}</span>
                          </div>
                          <div className="flex gap-4 text-[11px] text-gray-600">
                            <span><T k="전송" />: <strong>{log.totalSent}</strong><Unit>명</Unit></span>
                            <span><T k="등록" />: <strong className="text-emerald-600">{log.registered}</strong></span>
                            <span><T k="스킵" />: <strong className="text-amber-600">{log.skipped}</strong></span>
                            {log.failed > 0 && <span><T k="실패" />: <strong className="text-red-600">{log.failed}</strong></span>}
                            <span className="text-gray-400"><T k="실행" />: {log.executor?.familyName}{log.executor?.givenName}</span>
                          </div>
                          {log.errorMessage && <p className="text-[10px] text-red-500 mt-1">{log.errorMessage}</p>}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* 역할 매핑 테이블 */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-900"><T k="HIS 역할 매핑 현황" /></h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="이름" /></th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="진료과" /></th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="HIS 역할" /></th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="Clinic 연결" /></th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.staffId} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-medium text-gray-900">{m.name}</td>
                      <td className="px-4 py-2 text-gray-600 text-xs">{m.department ?? '-'}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          m.hisRole === 'MEDICAL' ? 'bg-blue-50 text-blue-700' :
                          m.hisRole === 'ADMIN' ? 'bg-red-50 text-red-700' :
                          m.hisRole === 'TECHNICAL' ? 'bg-amber-50 text-amber-700' :
                          'bg-gray-50 text-gray-600'
                        }`}>{m.hisRole}</span>
                      </td>
                      <td className="px-4 py-2">
                        {m.linked ? (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700"><T k="연결됨" /></span>
                        ) : (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"><T k="미연결" /></span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* 패스워드 초기화 모달 */}
      {resetModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setResetModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-96 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold"><T k="패스워드 초기화" /></h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="새 비밀번호" /></label>
              <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('비워 두면 일회용 임의 비밀번호를 발급합니다')} />
              <p className="text-[11px] text-gray-500 mt-1"><T k="직접 입력하면 비밀번호 정책(길이·대소문자·숫자·특수문자)을 서버가 검사합니다." /></p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => resetPwMut.mutate({ id: resetModal, pw: newPassword })} disabled={resetPwMut.isPending}
                className="flex-1 py-2.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50"><T k="초기화" /></button>
              <button onClick={() => setResetModal(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-sm rounded-lg"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 🔴 발급된 일회용 비밀번호 — 한 번만 보여 준다(닫으면 다시 볼 수 없다) */}
      {issued && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-96 space-y-4" role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold"><T k="발급된 일회용 비밀번호" /></h3>
            {issued.email && <p className="text-xs text-gray-500">{issued.email}</p>}
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono break-all select-all">{issued.password}</code>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(issued.password); }}
                className="px-3 py-2 bg-gray-100 text-gray-700 text-xs rounded-lg"><T k="복사" /></button>
            </div>
            <p className="text-xs text-amber-700"><T k="이 창을 닫으면 다시 볼 수 없습니다. 본인에게 안전하게 전달하고 첫 로그인 후 변경하게 안내하세요." /></p>
            <button type="button" onClick={() => setIssued(null)} className="w-full py-2.5 bg-gray-900 text-white text-sm rounded-lg"><T k="확인했습니다" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
