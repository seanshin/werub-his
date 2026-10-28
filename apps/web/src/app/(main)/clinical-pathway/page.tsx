'use client';

import type React from 'react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAdminWrite } from '@/hooks/use-admin-write';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

import { EmptyState, Ratio, Unit, KDate, PatientName } from '@/components/ui/display';
import PatientSelector from '@/components/ui/PatientSelector';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { MilestoneOrderSetField, orderSetDetailPatch, type MilestoneOrderSetRef } from './milestone-order-set';

// ── Interfaces ──

interface Milestone {
  id: string;
  day: number;
  category: MilestoneCategory;
  title: string;
  isRequired: boolean;
  sortOrder: number;
  /** 서버가 detail.orderSetId 로 붙여 준 연결 세트(이름·상태) */
  orderSet?: MilestoneOrderSetRef;
}

interface Pathway {
  id: string;
  code: string;
  name: string;
  department: string;
  targetDrg: string | null;
  totalDays: number;
  description: string | null;
  status: PathwayStatus;
  /** 목록 EP 는 milestones 배열이 아니라 milestoneCount 를 준다(상세 EP 에만 배열이 있다) */
  milestoneCount?: number;
  milestones?: Milestone[];
  createdAt: string;
  updatedAt: string;
}

interface AssignmentPatient {
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
}

interface AssignmentPathway {
  id: string;
  code: string;
  name: string;
}

interface MilestoneOutcome {
  id: string;
  milestoneId: string;
  status: OutcomeStatus;
  actualDay?: number;
  variance: string | null;
  performedAt: string;
  milestone?: Milestone;
}

interface Assignment {
  id: string;
  patientId: string;
  pathwayId: string;
  encounterId: string;
  startDate: string;
  status: AssignmentStatus;
  deviations: number;
  /** 진행률 정본 — 서버가 완료 판정과 **같은 산식**으로 계산해 내려준다.
   *  🔴 종전 FE 는 completedMilestones/totalMilestones 를 스스로 나눴는데,
   *     목록 EP 의 completedMilestones 는 상태 무관 outcome 개수(건너뜀·이탈 포함)였고
   *     상세 EP 는 두 필드를 아예 주지 않아 상세는 항상 0% 였다(W7 ⑩⑪).
   *  마일스톤이 하나도 없으면 0% 가 아니라 null(산출 불가)다. */
  progressRate: number | null;
  /** 게이트 중 DONE 으로 기록된 수 */
  completedMilestones: number;
  /** 진행률 분모(필수 마일스톤; 없으면 전체) */
  requiredMilestones: number;
  /** 경로 전체 마일스톤 수 */
  totalMilestones: number;
  patient: AssignmentPatient;
  pathway: AssignmentPathway;
  outcomes?: MilestoneOutcome[];
}

interface AssignmentDetail extends Assignment {
  outcomes: MilestoneOutcome[];
  pathway: AssignmentPathway & { milestones: Milestone[] };
}

/**
 * 경로 분석 응답 계약 — 서버는 **경로별 배열**을 준다(집계 객체가 아니다).
 * 🔴 종전 FE 는 totalPathways·avgCompletionRate·topPathways·departmentStats 라는
 *    서버가 준 적 없는 집계 객체로 읽어 "전체 경로 (빈칸) · 평균 완료율 NaN% · 평균 이탈률 NaN%"
 *    를 띄우고 하위 표 2개를 통째 숨겼다(W7 ⑨ · P11).
 * completionRate/deviationRate 는 표본이 없으면 **null(산출 불가)** — 0 이 아니다(W7 ⑭).
 */
interface PathwayAnalyticsRow {
  pathwayId: string;
  pathwayName: string;
  pathwayCode: string;
  department: string;
  expectedDays: number;
  totalAssignments: number;
  completedCount: number;
  completionRate: number | null;
  completionNumerator?: number;
  completionDenominator?: number;
  deviationRate: number | null;
  /** 🔴 이탈률의 분자(이탈 있는 완료)·분모(완료) — 완료율의 분모(배정 전량)와 **다르다**(2026-08-20 서버 추가) */
  deviationNumerator?: number;
  deviationDenominator?: number;
  avgActualDays: number | null;
  activeCount: number;
  cancelledCount: number;
}

interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

type PathwayStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
/** 🔴 'DEVIATED' 를 배정 상태로 쓰는 서버 코드는 없다(이탈은 deviations 카운트로만 남는다).
 *  레거시 행을 만나도 배지가 깨지지 않게 라벨만 남겨두되, **필터 선택지로는 제공하지 않는다**(W7 ⑫). */
type AssignmentStatus = 'ACTIVE' | 'COMPLETED' | 'DEVIATED' | 'CANCELLED';
type MilestoneCategory = 'ASSESSMENT' | 'ORDER' | 'MEDICATION' | 'DIET' | 'EDUCATION' | 'DISCHARGE';
type OutcomeStatus = 'DONE' | 'SKIPPED' | 'DELAYED' | 'DEVIATED';

// ── Constants ──

const TABS = [
  { key: 'list', label: '경로 관리' },
  { key: 'editor', label: '경로 편집' },
  { key: 'assignments', label: '환자 적용 현황' },
  { key: 'analytics', label: '경로 분석' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const STATUS_BADGE: Record<PathwayStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  RETIRED: 'bg-red-50 text-red-600',
};

const STATUS_LABEL: Record<PathwayStatus, string> = {
  DRAFT: '초안',
  ACTIVE: '활성',
  RETIRED: '폐기',
};

const ASSIGN_STATUS_BADGE: Record<AssignmentStatus, string> = {
  ACTIVE: 'bg-blue-50 text-blue-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  DEVIATED: 'bg-amber-50 text-amber-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

const ASSIGN_STATUS_LABEL: Record<AssignmentStatus, string> = {
  ACTIVE: '진행중',
  COMPLETED: '완료',
  DEVIATED: '이탈',
  CANCELLED: '취소',
};

const CATEGORY_BADGE: Record<MilestoneCategory, string> = {
  ASSESSMENT: 'bg-blue-50 text-blue-700',
  ORDER: 'bg-purple-50 text-purple-700',
  MEDICATION: 'bg-rose-50 text-rose-700',
  DIET: 'bg-amber-50 text-amber-700',
  EDUCATION: 'bg-teal-50 text-teal-700',
  DISCHARGE: 'bg-gray-100 text-gray-700',
};

const CATEGORY_LABEL: Record<MilestoneCategory, string> = {
  ASSESSMENT: '평가',
  ORDER: '처방',
  MEDICATION: '투약',
  DIET: '식이',
  EDUCATION: '교육',
  DISCHARGE: '퇴원',
};

const CATEGORY_OPTIONS: MilestoneCategory[] = ['ASSESSMENT', 'ORDER', 'MEDICATION', 'DIET', 'EDUCATION', 'DISCHARGE'];

/**
 * 진료과 선택지 = **마스터(useDepartments)** ∪ 실제 데이터에 있는 값(W7 ⑬ 의 합집합 원칙 유지).
 * 종전 로컬 상수 15과는 마스터의 부분집합+이표기('소아과'·'비뇨기과')였다.
 */
function departmentOptions(master: string[], present: (string | undefined)[], selected?: string) {
  return [...new Set([...master, ...present.filter((d): d is string => !!d), ...(selected ? [selected] : [])])];
}

/** 오늘(YYYY-MM-DD) — 배정 시작일 기본값 */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const OUTCOME_OPTIONS: { value: OutcomeStatus; label: string; color: string }[] = [
  { value: 'DONE', label: '완료', color: 'bg-emerald-600 hover:bg-emerald-700' },
  { value: 'SKIPPED', label: '건너뜀', color: 'bg-gray-500 hover:bg-gray-600' },
  { value: 'DELAYED', label: '지연', color: 'bg-amber-500 hover:bg-amber-600' },
  { value: 'DEVIATED', label: '이탈', color: 'bg-red-500 hover:bg-red-600' },
];

// ── Helper: unwrap API response ──
function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as ApiResponse<T>).data;
  }
  return raw as T;
}

// ── Modal Shell ──
function Modal({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900"><T k={title} /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── Field helpers ──
function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-xs font-medium text-gray-700 mb-1">
      <T k={label} />{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function InputField({ value, onChange, placeholder, type = 'text' }: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    />
  );
}

function SelectField({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const tAttr = useTAttr();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{tAttr(o.label)}</option>
      ))}
    </select>
  );
}

// ══════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════

export default function ClinicalPathwayPage() {
  const tAttr = useTAttr();
  /**
   * 🔴 임상경로 **마스터**(생성·복제·발행·폐기·마일스톤 편집)는 서버가 전부 `@Roles(ADMIN)` 이다.
   *    의사 nav 에 열려 있어 버튼은 보이는데 누르면 403 이었다 — 환자 배정·진행 기록은 그대로 둔다.
   */
  const canEditMaster = useAdminWrite();
  const { names: deptMaster } = useDepartments({ category: 'CLINICAL' });
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('list');

  // -- shared selection state --
  const [selectedPathwayId, setSelectedPathwayId] = useState<string | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);

  // -- filters --
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignStatusFilter, setAssignStatusFilter] = useState('');
  /** 이탈 발생분만 — 서버 deviations>0 필터(배정 상태 'DEVIATED' 는 존재하지 않는다) */
  const [deviatedOnly, setDeviatedOnly] = useState(false);

  // -- modals --
  const [showCreate, setShowCreate] = useState(false);
  const [showMilestoneCreate, setShowMilestoneCreate] = useState(false);
  const [showMilestoneEdit, setShowMilestoneEdit] = useState<Milestone | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [outcomeModal, setOutcomeModal] = useState<{ milestoneId: string; assignmentId: string } | null>(null);

  // -- create pathway form --
  const [cpForm, setCpForm] = useState({
    code: '', name: '', department: '', targetDrg: '', totalDays: '7', description: '',
  });

  // -- create milestone form --
  const [msForm, setMsForm] = useState({
    day: '1', category: 'ASSESSMENT' as MilestoneCategory, title: '', isRequired: true, orderSetId: '',
  });

  // -- edit milestone form --
  const [msEditForm, setMsEditForm] = useState({
    day: '1', category: 'ASSESSMENT' as MilestoneCategory, title: '', isRequired: true, orderSetId: '',
  });

  // -- assign form --
  // 🔴 종전엔 startDate 를 아예 보내지 않아 서버가 Invalid Date 로 터졌다(경로 적용 자체가 불가).
  const [assignForm, setAssignForm] = useState({
    patientId: '', pathwayId: '', encounterId: '', startDate: todayStr(),
  });

  // -- outcome form --
  const [outcomeNote, setOutcomeNote] = useState('');

  // ── Queries ──

  const pathwaysQuery = useQuery({
    queryKey: ['pathways', deptFilter, statusFilter],
    queryFn: () =>
      // 🔴 종전엔 `department=` 로 보냈는데 서버는 @Query('dept') 를 읽어 필터가 무효였다(W7 ⑬ · P11)
      apiClient.get<ApiResponse<Pathway[]>>('/api/v1/pathways', {
        ...(deptFilter && { dept: deptFilter }),
        ...(statusFilter && { status: statusFilter }),
      }),
  });

  const pathwayDetailQuery = useQuery({
    queryKey: ['pathway-detail', selectedPathwayId],
    queryFn: () => apiClient.get<ApiResponse<Pathway>>(`/api/v1/pathways/${selectedPathwayId}`),
    enabled: !!selectedPathwayId,
  });

  const assignmentsQuery = useQuery({
    queryKey: ['pathway-assignments', assignStatusFilter, deviatedOnly],
    queryFn: () =>
      apiClient.get<ApiResponse<Assignment[]>>('/api/v1/pathways/assignments', {
        ...(assignStatusFilter && { status: assignStatusFilter }),
        ...(deviatedOnly && { deviated: 'true' }),
      }),
    enabled: tab === 'assignments',
  });

  const assignmentDetailQuery = useQuery({
    queryKey: ['pathway-assignment-detail', selectedAssignmentId],
    queryFn: () =>
      apiClient.get<ApiResponse<AssignmentDetail>>(`/api/v1/pathways/assignments/${selectedAssignmentId}`),
    enabled: !!selectedAssignmentId,
  });

  const analyticsQuery = useQuery({
    queryKey: ['pathway-analytics'],
    queryFn: () => apiClient.get<ApiResponse<PathwayAnalyticsRow[]>>('/api/v1/pathways/analytics'),
    enabled: tab === 'analytics',
  });

  /** 선택된 환자의 진료(Encounter) 목록 — 배정에 encounterId 가 필요한데 UUID 를 손으로 적게 할 수 없다 */
  const encounterQuery = useQuery({
    queryKey: ['pathway-assign-encounters', assignForm.patientId],
    queryFn: () =>
      apiClient.get<{ data: { id: string; createdAt: string; visitType?: string | null; chiefComplaint?: string | null }[] }>(
        '/api/v1/encounters', { patientId: assignForm.patientId, limit: 20 },
      ),
    enabled: showAssign && !!assignForm.patientId,
  });

  // ── Mutations ──

  const createPathway = useMutation({
    mutationFn: (body: { code: string; name: string; department: string; targetDrg: string; totalDays: number; description: string }) =>
      apiClient.post('/api/v1/pathways', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathways'] });
      toast.success(tAttr('경로가 생성되었습니다.'));
      setShowCreate(false);
      setCpForm({ code: '', name: '', department: '', targetDrg: '', totalDays: '7', description: '' });
    },
    onError: () => toast.error(tAttr('경로 생성에 실패했습니다.')),
  });

  const publishPathway = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/pathways/${id}/publish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathways'] });
      qc.invalidateQueries({ queryKey: ['pathway-detail'] });
      toast.success(tAttr('경로가 발행되었습니다.'));
    },
    onError: () => toast.error(tAttr('경로 발행에 실패했습니다.')),
  });

  const retirePathway = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/pathways/${id}/retire`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathways'] });
      qc.invalidateQueries({ queryKey: ['pathway-detail'] });
      toast.success(tAttr('경로가 폐기되었습니다.'));
    },
    onError: () => toast.error(tAttr('경로 폐기에 실패했습니다.')),
  });

  const clonePathway = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/pathways/${id}/clone`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathways'] });
      toast.success(tAttr('경로가 복제되었습니다.'));
    },
    onError: () => toast.error(tAttr('경로 복제에 실패했습니다.')),
  });

  const createMilestone = useMutation({
    mutationFn: (body: { day: number; category: MilestoneCategory; title: string; isRequired: boolean; detail?: { orderSetId: string | null } }) =>
      apiClient.post(`/api/v1/pathways/${selectedPathwayId}/milestones`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathway-detail'] });
      toast.success(tAttr('마일스톤이 추가되었습니다.'));
      setShowMilestoneCreate(false);
      setMsForm({ day: '1', category: 'ASSESSMENT', title: '', isRequired: true, orderSetId: '' });
    },
    onError: () => toast.error(tAttr('마일스톤 추가에 실패했습니다.')),
  });

  const updateMilestone = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { day: number; category: MilestoneCategory; title: string; isRequired: boolean; detail?: { orderSetId: string | null } } }) =>
      apiClient.patch(`/api/v1/pathways/milestones/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathway-detail'] });
      toast.success(tAttr('마일스톤이 수정되었습니다.'));
      setShowMilestoneEdit(null);
    },
    onError: () => toast.error(tAttr('마일스톤 수정에 실패했습니다.')),
  });

  const deleteMilestone = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/pathways/milestones/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathway-detail'] });
      toast.success(tAttr('마일스톤이 삭제되었습니다.'));
    },
    onError: () => toast.error(tAttr('마일스톤 삭제에 실패했습니다.')),
  });

  const assignPathway = useMutation({
    mutationFn: (body: { patientId: string; encounterId: string; startDate: string }) =>
      apiClient.post(`/api/v1/pathways/${assignForm.pathwayId}/assign`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathway-assignments'] });
      toast.success(tAttr('경로가 환자에게 적용되었습니다.'));
      setShowAssign(false);
      setAssignForm({ patientId: '', pathwayId: '', encounterId: '', startDate: todayStr() });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || tAttr('경로 적용에 실패했습니다.')),
  });

  const recordOutcome = useMutation({
    mutationFn: ({ assignmentId, body }: { assignmentId: string; body: { milestoneId: string; outcome: OutcomeStatus; note: string } }) =>
      apiClient.post(`/api/v1/pathways/assignments/${assignmentId}/outcome`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathway-assignment-detail'] });
      qc.invalidateQueries({ queryKey: ['pathway-assignments'] });
      toast.success(tAttr('결과가 기록되었습니다.'));
      setOutcomeModal(null);
      setOutcomeNote('');
    },
    onError: () => toast.error(tAttr('결과 기록에 실패했습니다.')),
  });

  // 모든 hook 이후 조건부 return (React #300 방지)
  if (pathwaysQuery.isError) return <QueryErrorFallback error={pathwaysQuery.error} onRetry={pathwaysQuery.refetch} />;

  // ── Derived data ──

  const pathways: Pathway[] = unwrap<Pathway[]>(pathwaysQuery.data) ?? [];
  const detail: Pathway | null = unwrap<Pathway>(pathwayDetailQuery.data) ?? null;
  const assignments: Assignment[] = unwrap<Assignment[]>(assignmentsQuery.data) ?? [];
  const assignmentDetail: AssignmentDetail | null = unwrap<AssignmentDetail>(assignmentDetailQuery.data) ?? null;
  const analyticsRaw = unwrap<PathwayAnalyticsRow[]>(analyticsQuery.data);
  const analytics: PathwayAnalyticsRow[] = Array.isArray(analyticsRaw) ? analyticsRaw : [];
  const encounters = (() => {
    const raw = unwrap<{ id: string; createdAt: string; visitType?: string | null; chiefComplaint?: string | null }[]>(encounterQuery.data);
    return Array.isArray(raw) ? raw : [];
  })();

  // group milestones by day
  const milestonesByDay: Record<number, Milestone[]> = {};
  if (detail?.milestones) {
    for (const ms of detail.milestones) {
      if (!milestonesByDay[ms.day]) milestonesByDay[ms.day] = [];
      milestonesByDay[ms.day].push(ms);
    }
  }
  const sortedDays = Object.keys(milestonesByDay).map(Number).sort((a, b) => a - b);

  // ── Handlers ──

  function handleSelectPathway(id: string) {
    setSelectedPathwayId(id);
    setTab('editor');
  }

  function handleCreatePathway() {
    if (!cpForm.code || !cpForm.name || !cpForm.department) {
      toast.error(tAttr('필수 필드를 입력하세요.'));
      return;
    }
    createPathway.mutate({
      code: cpForm.code,
      name: cpForm.name,
      department: cpForm.department,
      targetDrg: cpForm.targetDrg,
      totalDays: parseInt(cpForm.totalDays) || 7,
      description: cpForm.description,
    });
  }

  function handleCreateMilestone() {
    if (!msForm.title) {
      toast.error(tAttr('마일스톤 제목을 입력하세요.'));
      return;
    }
    createMilestone.mutate({
      day: parseInt(msForm.day) || 1,
      category: msForm.category,
      title: msForm.title,
      isRequired: msForm.isRequired,
      ...orderSetDetailPatch(msForm.category, msForm.orderSetId, null),
    });
  }

  function handleUpdateMilestone() {
    if (!showMilestoneEdit || !msEditForm.title) return;
    updateMilestone.mutate({
      id: showMilestoneEdit.id,
      body: {
        day: parseInt(msEditForm.day) || 1,
        category: msEditForm.category,
        title: msEditForm.title,
        isRequired: msEditForm.isRequired,
        ...orderSetDetailPatch(msEditForm.category, msEditForm.orderSetId, showMilestoneEdit.orderSet?.id ?? null),
      },
    });
  }

  function handleAssign() {
    if (!assignForm.patientId || !assignForm.pathwayId || !assignForm.encounterId || !assignForm.startDate) {
      toast.error(tAttr('환자·경로·진료·시작일을 모두 지정하세요.'));
      return;
    }
    assignPathway.mutate({
      patientId: assignForm.patientId,
      encounterId: assignForm.encounterId,
      // 시작일은 경과일·진행률의 기준 — 서버가 추정하지 않도록 화면이 명시해 보낸다
      startDate: assignForm.startDate,
    });
  }

  function openMilestoneEdit(ms: Milestone) {
    setMsEditForm({ day: String(ms.day), category: ms.category, title: ms.title, isRequired: ms.isRequired, orderSetId: ms.orderSet?.id ?? '' });
    setShowMilestoneEdit(ms);
  }

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Clinical Pathway</h2>
        <p className="text-sm text-gray-500 mt-1"><T k="표준 진료 경로 관리 및 환자 적용 현황" /></p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-50 rounded-xl p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t.key
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* ──────────── Tab 1: 경로 관리 ──────────── */}
      {tab === 'list' && (
        <div>
          {/* Filters & Actions */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <SelectField
              value={deptFilter}
              onChange={setDeptFilter}
              placeholder={tAttr('전체 진료과')}
              options={departmentOptions(deptMaster, pathways.map((p) => p.department), deptFilter).map((d) => ({ value: d, label: d }))}
            />
            <SelectField
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder={tAttr('전체 상태')}
              options={[
                { value: 'DRAFT', label: '초안' },
                { value: 'ACTIVE', label: '활성' },
                { value: 'RETIRED', label: '폐기' },
              ]}
            />
            <div className="flex-1" />
            {canEditMaster && <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <T k="+ 경로 생성" />
            </button>}
          </div>

          {/* Loading */}
          {pathwaysQuery.isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 animate-pulse">
                  <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
                  <div className="h-5 bg-gray-100 rounded w-2/3 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
                  <div className="h-8 bg-gray-100 rounded w-full" />
                </div>
              ))}
            </div>
          )}

          {/* Empty */}
          {!pathwaysQuery.isLoading && pathways.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
              <p className="text-gray-400"><T k="등록된 진료 경로가 없습니다" /></p>
            </div>
          )}

          {/* Cards */}
          {!pathwaysQuery.isLoading && pathways.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {pathways.map((pw) => (
                <div key={pw.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col">
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs text-gray-400 font-mono">{pw.code}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${STATUS_BADGE[pw.status]}`}>
                      <T k={STATUS_LABEL[pw.status]} />
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">{pw.name}</h3>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                    <span>{pw.department}</span>
                    <span>{pw.totalDays}<Unit><T k="일" /></Unit></span>
                    {/* 목록 EP 는 milestoneCount 를 준다 — milestones 배열은 상세 EP 에만 있어 늘 0으로 보였다 */}
                    <span>마일스톤 {pw.milestoneCount ?? pw.milestones?.length ?? 0}<Unit><T k="건" /></Unit></span>
                  </div>
                  {pw.description && (
                    <p className="text-xs text-gray-400 mb-3 line-clamp-2">{pw.description}</p>
                  )}
                  <div className="mt-auto flex gap-2 pt-3 border-t border-gray-50">
                    <button
                      onClick={() => handleSelectPathway(pw.id)}
                      className="flex-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg py-1.5 transition-colors"
                    >
                      <T k="상세" />
                    </button>
                    {canEditMaster && (
                      <button
                        onClick={() => clonePathway.mutate(pw.id)}
                        className="flex-1 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded-lg py-1.5 transition-colors"
                      >
                        <T k="복제" />
                      </button>
                    )}
                    {canEditMaster && pw.status === 'DRAFT' && (
                      <button
                        onClick={() => publishPathway.mutate(pw.id)}
                        className="flex-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded-lg py-1.5 transition-colors"
                      >
                        <T k="발행" />
                      </button>
                    )}
                    {canEditMaster && pw.status === 'ACTIVE' && (
                      <button
                        onClick={() => retirePathway.mutate(pw.id)}
                        className="flex-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg py-1.5 transition-colors"
                      >
                        <T k="폐기" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ──────────── Tab 2: 경로 편집 ──────────── */}
      {tab === 'editor' && (
        <div>
          {!selectedPathwayId ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
              <p className="text-gray-400 mb-3"><T k="경로를 선택하세요" /></p>
              <button
                onClick={() => setTab('list')}
                className="text-sm text-blue-600 hover:underline"
              >
                <T k="경로 관리 탭으로 이동" />
              </button>
            </div>
          ) : pathwayDetailQuery.isLoading ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 animate-pulse">
              <div className="h-6 bg-gray-100 rounded w-1/3 mb-4" />
              <div className="h-4 bg-gray-100 rounded w-1/2 mb-8" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-12 bg-gray-50 rounded" />
                ))}
              </div>
            </div>
          ) : detail ? (
            <div>
              {/* Pathway info header */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-bold text-gray-900">{detail.name}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${STATUS_BADGE[detail.status]}`}>
                        <T k={STATUS_LABEL[detail.status]} />
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className="font-mono">{detail.code}</span>
                      <span>{detail.department}</span>
                      <span>{detail.totalDays}<Unit><T k="일" /></Unit> <T k="경로" /></span>
                      {detail.targetDrg && <span>DRG: {detail.targetDrg}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedPathwayId(null); setTab('list'); }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    <T k="목록으로" />
                  </button>
                </div>
                {detail.description && (
                  <p className="text-sm text-gray-500 mt-2">{detail.description}</p>
                )}
              </div>

              {/* Add milestone button */}
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-semibold text-gray-900">
                  마일스톤 타임라인 ({detail.milestones?.length ?? 0}건)
                </h4>
                {canEditMaster && <button
                  onClick={() => setShowMilestoneCreate(true)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <T k="+ 마일스톤 추가" />
                </button>}
              </div>

              {/* Timeline by day */}
              {sortedDays.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
                  <p className="text-gray-400 text-sm">{canEditMaster ? <T k="마일스톤이 없습니다. 추가해 주세요." /> : <T k="마일스톤이 없습니다." />}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {sortedDays.map((day) => (
                    <div key={day} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="bg-gray-50 px-5 py-2.5 border-b border-gray-100">
                        <span className="text-sm font-semibold text-gray-700">Day {day}</span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {milestonesByDay[day]
                          .sort((a, b) => a.sortOrder - b.sortOrder)
                          .map((ms) => (
                            <div key={ms.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition-colors">
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${CATEGORY_BADGE[ms.category]}`}>
                                <T k={CATEGORY_LABEL[ms.category]} />
                              </span>
                              <span className="text-sm text-gray-900 flex-1">{ms.title}</span>
                              {ms.orderSet && (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] ${ms.orderSet.status === 'ACTIVE' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`} data-ms-orderset-badge={ms.orderSet.status}>
                                  📋 {ms.orderSet.name ?? '—'}{ms.orderSet.status !== 'ACTIVE' && <> · <T k={ms.orderSet.status === 'MISSING' ? '세트 없음' : '사용 중 아님'} /></>}
                                </span>
                              )}
                              {ms.isRequired && (
                                <span className="text-[10px] text-red-500 font-medium whitespace-nowrap"><T k="필수" /></span>
                              )}
                              {/* 수정·삭제는 서버가 관리자 전용(PATCH/DELETE pathways/milestones) — '추가'와 같은 조건으로(종전엔 의사에게 늘 403) */}
                              {canEditMaster && (<>
                              <button
                                onClick={() => openMilestoneEdit(ms)}
                                className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
                              >
                                <T k="수정" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(tAttr('이 마일스톤을 삭제하시겠습니까?'))) {
                                    deleteMilestone.mutate(ms.id);
                                  }
                                }}
                                className="text-xs text-gray-400 hover:text-red-600 transition-colors"
                              >
                                <T k="삭제" />
                              </button>
                              </>)}
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
              <p className="text-gray-400"><T k="경로를 찾을 수 없습니다" /></p>
            </div>
          )}
        </div>
      )}

      {/* ──────────── Tab 3: 환자 적용 현황 ──────────── */}
      {tab === 'assignments' && (
        <div>
          {/* Assignment detail overlay */}
          {selectedAssignmentId && assignmentDetail ? (
            <div>
              <button
                onClick={() => setSelectedAssignmentId(null)}
                className="text-xs text-gray-400 hover:text-gray-600 mb-4 inline-block"
              >
                &larr; <T k="목록으로" />
              </button>

              {/* Assignment info */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-base font-bold text-gray-900">
                      <PatientName
                        familyName={assignmentDetail.patient.familyName}
                        givenName={assignmentDetail.patient.givenName}
                        mrn={assignmentDetail.patient.mrn}
                      />
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">{assignmentDetail.pathway.name}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${ASSIGN_STATUS_BADGE[assignmentDetail.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      <T k={ASSIGN_STATUS_LABEL[assignmentDetail.status] ?? assignmentDetail.status} />
                    </span>
                    {/* 이탈은 상태가 아니라 카운트로 남는다 — 배지 하나로는 "진행중"만 보였다(W7 ⑫) */}
                    {assignmentDetail.deviations > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap bg-amber-50 text-amber-700">
                        이탈 {assignmentDetail.deviations}건
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 mt-2">
                  <span><T k="시작일:" /> <KDate value={assignmentDetail.startDate} /></span>
                  {/* 진행률은 서버 정본(progressRate) 그대로 — FE 가 다시 나누면 산식이 또 갈라진다 */}
                  <span title={tAttr("필수 마일스톤 중 '완료(DONE)'로 기록된 비율 — 건너뜀·지연·이탈은 완료가 아닙니다")}>
                    진행률: {assignmentDetail.progressRate === null || assignmentDetail.progressRate === undefined
                      ? <span className="text-gray-400"><T k="산출 불가 (마일스톤 없음)" /></span>
                      : <>{assignmentDetail.progressRate}<Unit>%</Unit> <span className="text-gray-400">({assignmentDetail.completedMilestones}/{assignmentDetail.requiredMilestones} 필수)</span></>}
                  </span>
                  {assignmentDetail.totalMilestones > assignmentDetail.requiredMilestones && (
                    <span className="text-gray-400">전체 마일스톤 {assignmentDetail.totalMilestones}건</span>
                  )}
                </div>
              </div>

              {/* Milestone checklist */}
              <h4 className="text-sm font-semibold text-gray-900 mb-3"><T k="마일스톤 체크리스트" /></h4>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {assignmentDetail.pathway.milestones?.length ? (
                  <div className="divide-y divide-gray-50">
                    {assignmentDetail.pathway.milestones
                      .sort((a, b) => a.day - b.day || a.sortOrder - b.sortOrder)
                      .map((ms) => {
                        const recorded = assignmentDetail.outcomes?.find((o) => o.milestoneId === ms.id);
                        return (
                          <div key={ms.id} className="px-5 py-3 flex items-center gap-3">
                            <span className="text-xs text-gray-400 w-12 shrink-0">Day {ms.day}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${CATEGORY_BADGE[ms.category]}`}>
                              <T k={CATEGORY_LABEL[ms.category]} />
                            </span>
                            <span className="text-sm text-gray-900 flex-1">{ms.title}</span>
                            {ms.isRequired && (
                              <span className="text-[10px] text-red-500 font-medium whitespace-nowrap"><T k="필수" /></span>
                            )}
                            {recorded ? (
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${
                                recorded.status === 'DONE' ? 'bg-emerald-50 text-emerald-700' :
                                recorded.status === 'SKIPPED' ? 'bg-gray-100 text-gray-600' :
                                recorded.status === 'DELAYED' ? 'bg-amber-50 text-amber-700' :
                                'bg-red-50 text-red-600'
                              }`}>
                                {recorded.status === 'DONE' ? '완료' :
                                 recorded.status === 'SKIPPED' ? '건너뜀' :
                                 recorded.status === 'DELAYED' ? '지연' : '이탈'}
                              </span>
                            ) : (
                              <button
                                onClick={() => setOutcomeModal({ milestoneId: ms.id, assignmentId: assignmentDetail.id })}
                                className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                              >
                                <T k="결과 기록" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <EmptyState icon="📋" title="마일스톤이 없습니다" />
                )}
              </div>
            </div>
          ) : (
            <div>
              {/* Filters & Actions */}
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <SelectField
                  value={assignStatusFilter}
                  onChange={setAssignStatusFilter}
                  placeholder={tAttr('전체 상태')}
                  options={[
                    { value: 'ACTIVE', label: '진행중' },
                    { value: 'COMPLETED', label: '완료' },
                    { value: 'CANCELLED', label: '취소' },
                  ]}
                />
                {/* 🔴 종전의 '이탈' 상태 필터는 영구 0건이었다 — 이탈은 상태가 아니라 카운트다(W7 ⑫) */}
                <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">
                  <input type="checkbox" checked={deviatedOnly} onChange={(e) => setDeviatedOnly(e.target.checked)}
                    className="rounded border-gray-300" />
                  <T k="이탈 발생분만" />
                </label>
                <div className="flex-1" />
                <button
                  onClick={() => setShowAssign(true)}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  <T k="+ 경로 적용" />
                </button>
              </div>

              {/* Table */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="등록번호" /></th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="경로" /></th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="시작일" /></th>
                      <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="상태" /></th>
                      <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="이탈" /></th>
                      <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-[140px]"><T k="진행률" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignmentsQuery.isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          {Array.from({ length: 7 }).map((_, j) => (
                            <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                          ))}
                        </tr>
                      ))
                    ) : assignments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-gray-400"><T k="적용된 경로가 없습니다" /></td>
                      </tr>
                    ) : (
                      assignments.map((a) => {
                        // 🔴 종전 산식은 `_count.outcomes / 전체` 였다 — 6개를 전부 '건너뜀'으로 기록해도
                        //    진행률 100%·초록 막대였다. 이제 서버 정본(progressRate)만 쓴다(W7 ⑩).
                        const pct = a.progressRate;
                        return (
                          <tr
                            key={a.id}
                            className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
                            onClick={() => setSelectedAssignmentId(a.id)}
                          >
                            <td className="px-5 py-3 font-medium text-gray-900">
                              <PatientName familyName={a.patient.familyName} givenName={a.patient.givenName} showMrn={false} />
                            </td>
                            <td className="px-5 py-3 text-gray-500 font-mono text-xs">{a.patient.mrn}</td>
                            <td className="px-5 py-3 text-gray-700">{a.pathway.name}</td>
                            <td className="px-5 py-3 text-gray-500"><KDate value={a.startDate} /></td>
                            <td className="px-5 py-3 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${ASSIGN_STATUS_BADGE[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                  <T k={ASSIGN_STATUS_LABEL[a.status] ?? a.status} />
                                </span>
                                {a.deviations > 0 && (
                                  <span className="text-[10px] text-amber-700">이탈 {a.deviations}건</span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3 text-center text-gray-700">{a.deviations}</td>
                            <td className="px-5 py-3">
                              {pct === null || pct === undefined ? (
                                <span className="text-xs text-gray-400" title={tAttr('이 경로에 마일스톤이 없어 진행률을 낼 수 없습니다')}><T k="산출 불가" /></span>
                              ) : (
                                <div className="flex items-center gap-2" title={`필수 ${a.requiredMilestones}건 중 완료(DONE) ${a.completedMilestones}건 — 건너뜀·지연·이탈은 완료가 아닙니다`}>
                                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-500 w-8 text-right">{pct}<Unit>%</Unit></span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ──────────── Tab 4: 경로 분석 ──────────── */}
      {tab === 'analytics' && (
        <div>
          {analyticsQuery.isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-1/2 mb-2" />
                  <div className="h-6 bg-gray-100 rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : analyticsQuery.isError ? (
            <QueryErrorFallback error={analyticsQuery.error} onRetry={analyticsQuery.refetch} />
          ) : analytics.length === 0 ? (
            <EmptyState icon="📈" title="분석할 경로가 없습니다" className="bg-white rounded-2xl border border-gray-100 shadow-sm" />
          ) : (
            <>
              {/* 요약 — 표본(적용 배정)이 없으면 비율은 0%가 아니라 '산출 불가'다(W7 ⑨⑭) */}
              {(() => {
                const totalAssignments = analytics.reduce((sum, r) => sum + r.totalAssignments, 0);
                const totalCompleted = analytics.reduce((sum, r) => sum + r.completedCount, 0);
                const activeAssignments = analytics.reduce((sum, r) => sum + r.activeCount, 0);
                // 평균의 평균이 아니라 **합산 분모**로 낸다(경로별 표본 크기가 제각각이다)
                const completionRate = totalAssignments > 0 ? Math.round((totalCompleted / totalAssignments) * 100) : null;
                const cards: { label: string; value: React.ReactNode; color: string; bg: string; hint: string }[] = [
                  { label: '전체 경로', value: String(analytics.length), color: 'text-gray-900', bg: 'bg-white', hint: '' },
                  { label: '적용 배정(누적)', value: String(totalAssignments), color: 'text-gray-900', bg: 'bg-white', hint: '' },
                  { label: '진행 중 배정', value: String(activeAssignments), color: 'text-blue-600', bg: 'bg-blue-50/50', hint: '' },
                  {
                    // 🔴 비율은 분모와 함께(§3.3) — 정본 `<Ratio>` 가 배정 0건이면 '산출 불가'를 그린다
                    label: '완료율',
                    value: <Ratio numerator={totalCompleted} denominator={totalAssignments} unavailableHint="적용된 배정 없음(표본 0)" />,
                    color: completionRate === null ? 'text-gray-400' : 'text-emerald-600',
                    bg: completionRate === null ? 'bg-white' : 'bg-emerald-50/50',
                    hint: '',
                  },
                ];
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                    {cards.map((c) => (
                      <div key={c.label} className={`${c.bg} rounded-2xl border border-gray-100 shadow-sm p-4`}>
                        <p className="text-[11px] font-medium text-gray-500 mb-1">{c.label}</p>
                        <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                        {c.hint && <p className="text-[10px] text-gray-400 mt-1">{c.hint}</p>}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 경로별 표 — 서버가 주는 그대로(경로별 배열) */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-900"><T k="경로별 지표" /></h4>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    <T k={'비율은 표본이 있을 때만 계산합니다 — 적용 0건은 ‘이탈 없음’이 아니라'} />{' '}<b><T k="알 수 없음" /></b><T k="입니다." />
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500"><T k="경로" /></th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500"><T k="진료과" /></th>
                      <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500"><T k="적용" /></th>
                      <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500"><T k="진행중" /></th>
                      <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500"><T k="완료" /></th>
                      <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500"><T k="완료율" /></th>
                      <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500"><T k="이탈률" /></th>
                      <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500"><T k="평균 소요일" /></th>
                      <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500"><T k="표준 일수" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.map((r) => (
                      <tr key={r.pathwayId} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3 text-gray-900 font-medium">
                          {r.pathwayName}
                          <span className="ml-2 text-[11px] text-gray-400 font-mono">{r.pathwayCode}</span>
                        </td>
                        <td className="px-5 py-3 text-gray-600">{r.department}</td>
                        <td className="px-5 py-3 text-center text-gray-700">{r.totalAssignments}</td>
                        <td className="px-5 py-3 text-center text-gray-700">{r.activeCount}</td>
                        <td className="px-5 py-3 text-center text-gray-700">{r.completedCount}</td>
                        <td className="px-5 py-3 text-center">
                          {/* 🔴 비율은 분모와 함께(§3.3) — 적용 0건이면 정본 `<Ratio>` 가 '산출 불가'를 그린다 */}
                          <Ratio numerator={r.completedCount} denominator={r.totalAssignments} className="text-gray-900 text-xs" unavailableHint="적용된 배정 없음" />
                        </td>
                        <td className="px-5 py-3 text-center">
                          {/* 🔴 이탈률의 분모는 **완료된 배정**이다 — 옆 칸(완료율)의 분모와 다르다는 사실이 보여야 한다 */}
                          <Ratio numerator={r.deviationNumerator} denominator={r.deviationDenominator} className={`text-xs ${r.deviationRate ? 'text-amber-700' : 'text-gray-900'}`} unavailableHint="완료된 배정 없음" />
                        </td>
                        <td className="px-5 py-3 text-center">
                          {r.avgActualDays === null
                            ? <span className="text-gray-400 text-xs"><T k="기록 없음" /></span>
                            : <span className="text-gray-900">{r.avgActualDays}<Unit><T k="일" /></Unit></span>}
                        </td>
                        <td className="px-5 py-3 text-center text-gray-500">{r.expectedDays}<Unit><T k="일" /></Unit></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          MODALS
         ══════════════════════════════════════════ */}

      {/* Create Pathway Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={tAttr('경로 생성')}>
        <div className="space-y-4">
          <div>
            <FieldLabel label="경로 코드" required />
            <InputField value={cpForm.code} onChange={(v) => setCpForm({ ...cpForm, code: v })} placeholder="CP-001" />
          </div>
          <div>
            <FieldLabel label="경로명" required />
            <InputField value={cpForm.name} onChange={(v) => setCpForm({ ...cpForm, name: v })} placeholder={tAttr('슬관절 전치환술')} />
          </div>
          <div>
            <FieldLabel label="진료과" required />
            <SelectField
              value={cpForm.department}
              onChange={(v) => setCpForm({ ...cpForm, department: v })}
              placeholder={tAttr('선택')}
              options={departmentOptions(deptMaster, pathways.map((p) => p.department), cpForm.department).map((d) => ({ value: d, label: d }))}
            />
          </div>
          <div>
            <FieldLabel label="목표 DRG" />
            <InputField value={cpForm.targetDrg} onChange={(v) => setCpForm({ ...cpForm, targetDrg: v })} placeholder="I20.2" />
          </div>
          <div>
            <FieldLabel label="총 일수" required />
            <InputField type="number" value={cpForm.totalDays} onChange={(v) => setCpForm({ ...cpForm, totalDays: v })} />
          </div>
          <div>
            <FieldLabel label="설명" />
            <textarea
              value={cpForm.description}
              onChange={(e) => setCpForm({ ...cpForm, description: e.target.value })}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder={tAttr('경로에 대한 간략한 설명')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <T k="취소" />
            </button>
            <button
              onClick={handleCreatePathway}
              disabled={createPathway.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <T k={createPathway.isPending ? '생성 중...' : '생성'} />
            </button>
          </div>
        </div>
      </Modal>

      {/* Create Milestone Modal */}
      <Modal open={showMilestoneCreate} onClose={() => setShowMilestoneCreate(false)} title={tAttr('마일스톤 추가')}>
        <div className="space-y-4">
          <div>
            <FieldLabel label="일차 (Day)" required />
            <InputField type="number" value={msForm.day} onChange={(v) => setMsForm({ ...msForm, day: v })} />
          </div>
          <div>
            <FieldLabel label="카테고리" required />
            <SelectField
              value={msForm.category}
              onChange={(v) => setMsForm({ ...msForm, category: v as MilestoneCategory })}
              options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
            />
          </div>
          <div>
            <FieldLabel label="제목" required />
            <InputField value={msForm.title} onChange={(v) => setMsForm({ ...msForm, title: v })} placeholder={tAttr('활력징후 측정')} />
          </div>
          <MilestoneOrderSetField category={msForm.category} value={msForm.orderSetId} onChange={(v) => setMsForm({ ...msForm, orderSetId: v })} />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ms-required"
              checked={msForm.isRequired}
              onChange={(e) => setMsForm({ ...msForm, isRequired: e.target.checked })}
              className="rounded border-gray-300"
            />
            <label htmlFor="ms-required" className="text-sm text-gray-700"><T k="필수 항목" /></label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowMilestoneCreate(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <T k="취소" />
            </button>
            <button
              onClick={handleCreateMilestone}
              disabled={createMilestone.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <T k={createMilestone.isPending ? '추가 중...' : '추가'} />
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Milestone Modal */}
      <Modal open={!!showMilestoneEdit} onClose={() => setShowMilestoneEdit(null)} title={tAttr('마일스톤 수정')}>
        <div className="space-y-4">
          <div>
            <FieldLabel label="일차 (Day)" required />
            <InputField type="number" value={msEditForm.day} onChange={(v) => setMsEditForm({ ...msEditForm, day: v })} />
          </div>
          <div>
            <FieldLabel label="카테고리" required />
            <SelectField
              value={msEditForm.category}
              onChange={(v) => setMsEditForm({ ...msEditForm, category: v as MilestoneCategory })}
              options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
            />
          </div>
          <div>
            <FieldLabel label="제목" required />
            <InputField value={msEditForm.title} onChange={(v) => setMsEditForm({ ...msEditForm, title: v })} />
          </div>
          <MilestoneOrderSetField category={msEditForm.category} value={msEditForm.orderSetId} current={showMilestoneEdit?.orderSet ?? null} onChange={(v) => setMsEditForm({ ...msEditForm, orderSetId: v })} />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ms-edit-required"
              checked={msEditForm.isRequired}
              onChange={(e) => setMsEditForm({ ...msEditForm, isRequired: e.target.checked })}
              className="rounded border-gray-300"
            />
            <label htmlFor="ms-edit-required" className="text-sm text-gray-700"><T k="필수 항목" /></label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowMilestoneEdit(null)}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <T k="취소" />
            </button>
            <button
              onClick={handleUpdateMilestone}
              disabled={updateMilestone.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <T k={updateMilestone.isPending ? '저장 중...' : '저장'} />
            </button>
          </div>
        </div>
      </Modal>

      {/* Assign Pathway Modal */}
      <Modal open={showAssign} onClose={() => setShowAssign(false)} title={tAttr('경로 적용')}>
        <div className="space-y-4">
          <div>
            <FieldLabel label="환자" required />
            {/* UUID 를 손으로 적게 하지 않는다 — 이름·MRN 으로 찾아 고른다 */}
            <PatientSelector
              value={assignForm.patientId}
              onChange={(id) => setAssignForm({ ...assignForm, patientId: id, encounterId: '' })}
            />
          </div>
          <div>
            <FieldLabel label="경로 선택" required />
            <select
              value={assignForm.pathwayId}
              onChange={(e) => setAssignForm({ ...assignForm, pathwayId: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value=""><T k="선택" /></option>
              {pathways
                .filter((p) => p.status === 'ACTIVE')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
            </select>
            {pathways.filter((p) => p.status === 'ACTIVE').length === 0 && (
              <p className="mt-1 text-[11px] text-amber-700"><T k="활성(ACTIVE) 경로가 없습니다 — 경로를 먼저 발행하세요." /></p>
            )}
          </div>
          <div>
            <FieldLabel label="진료 (Encounter)" required />
            <select
              value={assignForm.encounterId}
              onChange={(e) => setAssignForm({ ...assignForm, encounterId: e.target.value })}
              disabled={!assignForm.patientId}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white disabled:bg-gray-50"
            >
              <option value="">{tAttr(assignForm.patientId ? '선택' : '환자를 먼저 선택하세요')}</option>
              {encounters.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.createdAt?.slice(0, 10)} · {e.visitType ?? '진료'}{e.chiefComplaint ? ` · ${e.chiefComplaint.slice(0, 20)}` : ''}
                </option>
              ))}
            </select>
            {assignForm.patientId && !encounterQuery.isLoading && encounters.length === 0 && (
              <p className="mt-1 text-[11px] text-gray-500"><T k="이 환자의 진료 기록이 없습니다 — 진료 등록 후 경로를 적용하세요." /></p>
            )}
          </div>
          <div>
            <FieldLabel label="시작일" required />
            {/* 🔴 종전엔 아예 보내지 않아 서버에서 Invalid Date 로 실패했다 — 경과일·진행률의 기준값이다 */}
            <InputField
              type="date"
              value={assignForm.startDate}
              onChange={(v) => setAssignForm({ ...assignForm, startDate: v })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowAssign(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <T k="취소" />
            </button>
            <button
              onClick={handleAssign}
              disabled={assignPathway.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <T k={assignPathway.isPending ? '적용 중...' : '적용'} />
            </button>
          </div>
        </div>
      </Modal>

      {/* Outcome Recording Modal */}
      <Modal open={!!outcomeModal} onClose={() => { setOutcomeModal(null); setOutcomeNote(''); }} title={tAttr('결과 기록')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600"><T k="마일스톤 수행 결과를 선택하세요." /></p>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  if (!outcomeModal) return;
                  recordOutcome.mutate({
                    assignmentId: outcomeModal.assignmentId,
                    body: {
                      milestoneId: outcomeModal.milestoneId,
                      outcome: opt.value,
                      note: outcomeNote,
                    },
                  });
                }}
                disabled={recordOutcome.isPending}
                className={`${opt.color} text-white text-sm font-medium rounded-lg py-2.5 transition-colors disabled:opacity-50`}
              >
                <T k={opt.label} />
              </button>
            ))}
          </div>
          <div>
            <FieldLabel label="비고 (선택)" />
            <textarea
              value={outcomeNote}
              onChange={(e) => setOutcomeNote(e.target.value)}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder={tAttr('추가 메모')}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
