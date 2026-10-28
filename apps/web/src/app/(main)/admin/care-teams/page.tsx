'use client';

import { useState, useMemo } from 'react';
import { Unit } from '@/components/ui/display';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

/** 서버가 준 실패 사유를 그대로 보여준다 — 삼키면 화면이 "왜 안 되는지"를 잃는다 */
function errMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  return msg || '저장에 실패했습니다.';
}

const careTeamSchema = z.object({
  teamType: z.enum(['OUTPATIENT', 'INPATIENT', 'EMERGENCY']),
  departmentName: z.string().min(1, '진료과를 선택하세요'),
  doctorId: z.string().min(1, '의사를 선택하세요'),
  nurseId: z.string().min(1, '간호사를 선택하세요'),
  isPrimary: z.boolean(),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().optional(),
});
type CareTeamForm = z.infer<typeof careTeamSchema>;

// ── Types ──────────────────────────────────────────────
interface CareTeam {
  id: string;
  doctorId: string;
  nurseId: string;
  departmentName: string;
  teamType: 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY';
  isPrimary: boolean;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
  doctor?: { familyName: string; givenName: string };
  nurse?: { familyName: string; givenName: string };
}

// 🔴 화면 실사용 점검 W8 — /hr/staff 는 **Staff** 행이라 `id` 는 staff.id 이고,
//    CareTeam.doctorId/nurseId 는 **users.id** 다(키 공간이 다르다). 두 테이블을 잇는 키는
//    Staff.userId(1:1) 하나뿐 — 드롭다운 value 는 반드시 `userId` 여야 한다.
//    또 Staff 에는 role 이 없어 종전 `s.role === 'DOCTOR'` 필터가 항상 0건이었다(드롭다운 영구 공백).
//    서버가 연결 계정의 role/활성 여부를 실어 보내도록 고쳤고, 여기서는 그것만 믿는다.
interface StaffMember {
  id: string;
  userId?: string | null;
  familyName: string;
  givenName: string;
  role?: string | null;
  userActive?: boolean | null;
  department?: string;
}

/** 담당자로 지정 가능한 직원 = 시스템 계정이 연결되어 있고 그 계정 역할이 맞고 활성인 사람 */
function assignable(list: StaffMember[], role: 'DOCTOR' | 'NURSE') {
  return list.filter((s) => !!s.userId && s.role === role && s.userActive !== false);
}

type TeamType = 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY';

const TEAM_TYPES: { key: TeamType; label: string }[] = [
  { key: 'OUTPATIENT', label: '외래' },
  { key: 'INPATIENT', label: '입원' },
  { key: 'EMERGENCY', label: '응급' },
];

// 진료과 목록 정본 = 마스터(useDepartments) + 의사 실소속 합집합 — 로컬 배열 재정의 금지(input-assist-ux P1)

const INITIAL_FORM: CareTeamForm = {
  teamType: 'OUTPATIENT',
  departmentName: '',
  doctorId: '',
  nurseId: '',
  isPrimary: false,
  effectiveFrom: kstToday(),
  effectiveTo: '',
};

// ── Page ───────────────────────────────────────────────
export default function CareTeamsPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [activeTab, setActiveTab] = useState<TeamType>('OUTPATIENT');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { register, handleSubmit: rhfSubmit, reset, watch, setValue, formState: { errors } } = useForm<CareTeamForm>({
    resolver: zodResolver(careTeamSchema),
    defaultValues: { ...INITIAL_FORM },
  });
  const form = watch();
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Queries ──
  const { data: teamsRaw, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['care-teams'],
    queryFn: () => apiClient.get<{ data: CareTeam[] }>('/api/v1/care-teams'),
  });

  const { data: staffRaw } = useQuery({
    queryKey: ['hr-staff'],
    queryFn: () => apiClient.get<{ data: StaffMember[] }>('/api/v1/hr/staff'),
  });

  const allTeams: CareTeam[] = useMemo(() => {
    const raw = teamsRaw?.data;
    return Array.isArray(raw) ? raw : (raw as unknown as { data?: CareTeam[] })?.data ?? [];
  }, [teamsRaw]);

  const allStaff: StaffMember[] = useMemo(() => {
    const raw = staffRaw?.data;
    return Array.isArray(raw) ? raw : (raw as unknown as { data?: StaffMember[] })?.data ?? [];
  }, [staffRaw]);

  const filteredTeams = useMemo(
    () => allTeams.filter(t => t.teamType === activeTab),
    [allTeams, activeTab],
  );

  // Staff filtered by role — 계정(users.id)이 연결된 사람만 지정 가능
  const doctors = useMemo(() => assignable(allStaff, 'DOCTOR'), [allStaff]);
  const nurses = useMemo(() => assignable(allStaff, 'NURSE'), [allStaff]);
  // 계정 미연결이라 목록에서 빠진 인원 — 숨기지 않고 화면에 이유를 적는다
  const unlinkedCount = useMemo(() => allStaff.filter(s => !s.userId).length, [allStaff]);

  // Doctors filtered by selected department
  const filteredDoctors = useMemo(
    () => form.departmentName ? doctors.filter(d => d.department === form.departmentName) : doctors,
    [doctors, form.departmentName],
  );

  // 진료과 선택지 — 마스터 ∪ 의사 실소속(치과·검진센터 등). 🔴 마스터에만 의존하면 그 과 의사는 영영 지정할 수 없다
  const { names: departmentOptions } = useDepartments({ include: doctors.map(d => d.department) });

  // Stats
  const stats = useMemo(() => ({
    total: allTeams.length,
    outpatient: allTeams.filter(t => t.teamType === 'OUTPATIENT').length,
    inpatient: allTeams.filter(t => t.teamType === 'INPATIENT').length,
    emergency: allTeams.filter(t => t.teamType === 'EMERGENCY').length,
  }), [allTeams]);

  // ── Mutations ──
  // 🔴 화면 실사용 점검 W8 — 종전에는 onError 가 아예 없어 저장이 실패해도 화면이 아무 말도 하지
  //    않았다(모달만 남아 "왜 안 되지"). 실패는 실패라고 말하고, 성공했을 때만 닫는다.
  const createMut = useMutation({
    mutationFn: (data: Omit<CareTeamForm, 'effectiveTo'> & { effectiveTo?: string }) =>
      apiClient.post('/api/v1/care-teams', data),
    onMutate: () => setSaveError(null),
    onSuccess: () => {
      toast.success(tAttr('의료팀이 편성되었습니다.'));
      qc.invalidateQueries({ queryKey: ['care-teams'] });
      closeModal();
    },
    onError: (e: unknown) => setSaveError(errMessage(e)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CareTeamForm> }) =>
      apiClient.patch(`/api/v1/care-teams/${id}`, data),
    onMutate: () => setSaveError(null),
    onSuccess: () => {
      toast.success(tAttr('의료팀 편성이 수정되었습니다.'));
      qc.invalidateQueries({ queryKey: ['care-teams'] });
      closeModal();
    },
    onError: (e: unknown) => setSaveError(errMessage(e)),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/care-teams/${id}`),
    onSuccess: () => {
      toast.success(tAttr('의료팀이 해제되었습니다.'));
      qc.invalidateQueries({ queryKey: ['care-teams'] });
      setConfirmDeactivate(null);
    },
    onError: (e: unknown) => toast.error(errMessage(e)),
  });

  // ── Handlers ──
  function openCreate() {
    setEditingId(null);
    reset({ ...INITIAL_FORM, teamType: activeTab });
    setShowModal(true);
  }

  function openEdit(team: CareTeam) {
    setEditingId(team.id);
    reset({
      teamType: team.teamType,
      departmentName: team.departmentName,
      doctorId: team.doctorId,
      nurseId: team.nurseId,
      isPrimary: team.isPrimary,
      effectiveFrom: team.effectiveFrom?.slice(0, 10) ?? '',
      effectiveTo: team.effectiveTo?.slice(0, 10) ?? '',
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
    setSaveError(null);
    reset(INITIAL_FORM);
  }

  function onFormSubmit(data: CareTeamForm) {
    const payload = {
      ...data,
      effectiveTo: data.effectiveTo || undefined,
    };
    if (editingId) {
      updateMut.mutate({ id: editingId, data: payload });
    } else {
      createMut.mutate(payload);
    }
  }

  function staffName(s?: { familyName: string; givenName: string }) {
    return s ? `${s.familyName}${s.givenName}` : '-';
  }

  const isPending = createMut.isPending || updateMut.isPending;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  // ── Render ───────────────────────────────────────────
  return (
    <div className="max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="의료팀 편성 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="진료과별 의사-간호사 팀 편성 관리" /></p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <T k="+ 팀 편성" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TEAM_TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === t.key
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600"><T k="진료과" /></th>
                <th className="text-left px-4 py-3 font-medium text-gray-600"><T k="의사" /></th>
                <th className="text-left px-4 py-3 font-medium text-gray-600"><T k="간호사" /></th>
                <th className="text-left px-4 py-3 font-medium text-gray-600"><T k="유형" /></th>
                <th className="text-center px-4 py-3 font-medium text-gray-600"><T k="주담당" /></th>
                <th className="text-center px-4 py-3 font-medium text-gray-600"><T k="상태" /></th>
                <th className="text-right px-4 py-3 font-medium text-gray-600"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredTeams.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    <T k="해당 유형의 팀이 없습니다" />
                  </td>
                </tr>
              ) : (
                filteredTeams.map(team => (
                  <tr key={team.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900">{team.departmentName}</td>
                    <td className="px-4 py-3 text-gray-700">{staffName(team.doctor)} <T k="의사" /></td>
                    <td className="px-4 py-3 text-gray-700">{staffName(team.nurse)} <T k="간호사" /></td>
                    <td className="px-4 py-3">
                      <span className="inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        <T k={TEAM_TYPES.find(t => t.key === team.teamType)?.label ?? team.teamType} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {team.isPrimary ? (
                        <span className="inline-block w-3 h-3 rounded-full bg-blue-500" title={tAttr('주 담당')} />
                      ) : (
                        <span className="inline-block w-3 h-3 rounded-full bg-gray-300" title={tAttr('부 담당')} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${
                        team.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <T k={team.isActive ? '활성' : '비활성'} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(team)}
                          className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <T k="수정" />
                        </button>
                        {team.isActive && (
                          <button
                            onClick={() => setConfirmDeactivate(team.id)}
                            className="px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <T k="해제@팀" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Stats */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center gap-3">
          <span><T k="총" /> {stats.total}<Unit><T k="개" /></Unit> <T k="팀" /></span>
          <span className="text-gray-300">|</span>
          <span><T k="외래" /> {stats.outpatient}</span>
          <span className="text-gray-300">|</span>
          <span><T k="입원" /> {stats.inpatient}</span>
          <span className="text-gray-300">|</span>
          <span><T k="응급" /> {stats.emergency}</span>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeModal}>
          <form className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5" onClick={e => e.stopPropagation()} onSubmit={rhfSubmit(onFormSubmit)}>
            <h2 className="text-lg font-bold text-gray-900">
              <T k={editingId ? '팀 편성 수정' : '새 팀 편성'} />
            </h2>

            {saveError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                <T k="저장하지 못했습니다" /> — {saveError}
              </div>
            )}
            {(doctors.length === 0 || nurses.length === 0) && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <T k="담당자를 지정할 수 없습니다. 의료팀은" /> <b><T k="시스템 계정이 연결된 직원" /></b><T k="만 지정할 수 있습니다" />
                ({tAttr('지정 가능')}: {tAttr('의사')} {doctors.length}{tAttr('명')} · {tAttr('간호사')} {nurses.length}{tAttr('명')}
                {unlinkedCount > 0 ? ` · ${tAttr('계정 미연결 직원')} ${unlinkedCount}${tAttr('명 제외')}` : ''}).
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="유형" /></label>
              <div className="flex gap-2">
                {TEAM_TYPES.map(t => (
                  <label key={t.key} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" value={t.key} {...register('teamType')} className="accent-blue-600" />
                    <span className="text-sm text-gray-700"><T k={t.label} /></span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="진료과" /></label>
              <select {...register('departmentName', { onChange: () => setValue('doctorId', '') })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="">{tAttr('선택')}</option>
                {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              {errors.departmentName?.message && <p className="text-xs text-red-500 mt-1"><T k={errors.departmentName.message} /></p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="의사" /></label>
              <select {...register('doctorId')} disabled={doctors.length === 0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100">
                <option value="">{tAttr('선택')}</option>
                {/* value = users.id(=staff.userId). staff.id 를 넘기면 FK 위반이 난다 */}
                {filteredDoctors.map(d => <option key={d.userId!} value={d.userId!}>{d.familyName}{d.givenName} {d.department ? `(${d.department})` : ''}</option>)}
              </select>
              {errors.doctorId?.message && <p className="text-xs text-red-500 mt-1"><T k={errors.doctorId.message} /></p>}
              {doctors.length === 0
                ? <p className="text-xs text-red-600 mt-1"><T k="담당자를 지정할 수 없습니다 — 시스템 계정이 연결된 의사가 없습니다" /></p>
                : form.departmentName && filteredDoctors.length === 0
                  ? <p className="text-xs text-amber-600 mt-1"><T k="해당 진료과에 계정이 연결된 의사가 없습니다" /></p>
                  : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="간호사" /></label>
              <select {...register('nurseId')} disabled={nurses.length === 0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100">
                <option value="">{tAttr('선택')}</option>
                {nurses.map(n => <option key={n.userId!} value={n.userId!}>{n.familyName}{n.givenName} {n.department ? `(${n.department})` : ''}</option>)}
              </select>
              {errors.nurseId?.message && <p className="text-xs text-red-500 mt-1"><T k={errors.nurseId.message} /></p>}
              {nurses.length === 0 && <p className="text-xs text-red-600 mt-1"><T k="담당자를 지정할 수 없습니다 — 시스템 계정이 연결된 간호사가 없습니다" /></p>}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...register('isPrimary')} className="w-4 h-4 accent-blue-600 rounded" />
              <span className="text-sm text-gray-700"><T k="주 담당" /></span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="시작일" /></label>
                <input type="date" {...register('effectiveFrom')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="종료일 (선택)" /></label>
                <input type="date" {...register('effectiveTo')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={closeModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"><T k="취소" /></button>
              <button type="submit" disabled={isPending} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                <T k={isPending ? '처리 중...' : editingId ? '수정' : '편성'} />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Deactivate Confirmation Modal */}
      {confirmDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmDeactivate(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900"><T k="팀 해제 확인" /></h2>
            <p className="text-sm text-gray-600"><T k="이 의료팀을 비활성화하시겠습니까?" /></p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeactivate(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <T k="취소" />
              </button>
              <button
                onClick={() => deactivateMut.mutate(confirmDeactivate)}
                disabled={deactivateMut.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                <T k={deactivateMut.isPending ? '처리 중...' : '해제@팀'} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
