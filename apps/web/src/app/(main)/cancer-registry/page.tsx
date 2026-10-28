'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { AI_ORIGIN_TEXT, ratioText } from '@hospital-run/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';

import { EmptyState } from '@/components/ui/display';

/* ────────── Types ────────── */

interface Patient {
  id: string;
  familyName: string;
  givenName: string;
  birthDate?: string;
}

interface CancerRegistry {
  id: string;
  registrationNo: string;
  patientId: string;
  patient?: Patient;
  primarySite: string;
  morphology?: string | null;
  behavior?: string | null;
  grade?: string | null;
  laterality?: string | null;
  diagnosisBasis?: string | null;
  icdCode: string;
  tnmClinical?: string | null;
  tnmPathological?: string | null;
  /** 🔴 병기는 미상(null)일 수 있다 — 빈칸으로 흘리지 말고 '미상'으로 말한다 */
  ajccStage: string | null;
  diagnosisDate: string;
  vitalStatus: string;
  status: string;
  /** 🔴 '보고 대상 확정'일 뿐 전송 여부가 아니다 — 배지는 transmission 만 본다 */
  reportedToKccr: boolean;
  kccrTransmittedAt?: string | null;
  kccrSubmissionId?: string | null;
  transmission?: KccrTransmissionState;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  createdAt: string;
  /** 상세 조회(findOne) 응답에만 실려 온다 */
  treatments?: Treatment[];
  followUps?: FollowUp[];
}

/** 🔴 서버 필드명 정본: treatmentType / note (화면이 type·notes 로 읽어 전부 빈칸이었다) */
interface Treatment {
  id: string;
  registryId: string;
  treatmentType: string;
  regimen?: string | null;
  startDate: string;
  endDate?: string | null;
  cycles?: number | null;
  response?: string | null;
  surgeryType?: string | null;
  radiationDose?: string | null;
  note?: string | null;
}

/** 🔴 서버 필드명 정본: status / recurrence(boolean) / performanceStatus / note */
interface FollowUp {
  id: string;
  registryId: string;
  followUpDate: string;
  status: string;
  recurrence: boolean;
  metastasisSite?: string | null;
  performanceStatus?: string | null;
  note?: string | null;
}

/** 🔴 서버 타임라인 항목 정본: { date, type, title, detail } — id·description·metadata 는 없다 */
interface TimelineEvent {
  type: 'DIAGNOSIS' | 'TREATMENT' | 'FOLLOW_UP';
  date: string;
  title: string;
  detail?: Record<string, unknown> | null;
}

interface RegistryStats {
  total: number;
  /** 🔴 서버는 배열을 준다 — Record 로 읽어 카드가 '[object Object]' 였다 */
  byVitalStatus: { status: string; count: number }[];
  bySite: { site: string; count: number }[];
  byStage: { stage: string; count: number }[];
}

interface OverdueFollowUp {
  registryId: string;
  registrationNo: string;
  patient?: Patient;
  primarySite: string;
  ajccStage: string | null;
  diagnosisDate: string;
  lastContactDate: string | null;
  lastFollowUp: FollowUp | null;
  /** null = 한 번도 추적한 적 없음 (경증 아님 · 최우선) */
  daysSinceLastContact: number | null;
  neverContacted: boolean;
  daysSinceDiagnosis: number;
}

/** KCCR 채널 수준 사실 (전송 아님) */
interface KccrTransmission {
  status: string;
  channel: string | null;
  markMeaning: string;
  note: string;
  channelImplemented?: boolean;
  manualFallback?: string;
}

/**
 * 🔴 등록 건별 전송 근거 판정 — **서버가 정본**(`classifyKccrTransmission`).
 * 화면이 `reportedToKccr` 를 보고 스스로 '보고 완료'로 읽으면 정본이 둘이 된다(P12).
 */
interface KccrTransmissionState {
  state: 'NOT_PREPARED' | 'PREPARED_NOT_TRANSMITTED' | 'UNVERIFIED' | 'TRANSMITTED';
  transmitted: boolean;
  label: string;
  note: string;
  transmittedAt: string | null;
  submissionId: string | null;
  submissionIdIsLocal: boolean;
  resubmittable: boolean;
}

interface KccrReportResult {
  reportDate: string;
  requested: number;
  count: number;
  confirmed: boolean;
  preparedIds: string[];
  preparedCount: number;
  /** 원내 접수번호(기관 번호 아님 — LOCAL- 접두) */
  localSubmissionIds?: { id: string; kccrSubmissionId: string }[];
  skipped: { id: string; registrationNo: string | null; reason: string }[];
  /** 나가지 않은 건은 다시 제출할 수 있다 */
  resubmittable?: boolean;
  transmission: KccrTransmission;
}

interface KccrPreviewRow {
  registryId: string;
  registrationNo: string;
  patientMrn: string;
  patientName: string;
  birthDate: string | null;
  gender: string | null;
  diagnosisDate: string;
  primarySite: string;
  morphology: string;
  behavior: string;
  grade: string | null;
  laterality: string | null;
  diagnosisBasis: string;
  icdCode: string;
  tnmClinical: string | null;
  tnmPathological: string | null;
  ajccStage: string | null;
  ajccEdition: number | null;
  firstTreatment: string | null;
  firstTreatmentDate: string | null;
  vitalStatus: string;
  lastContactDate: string | null;
  deathDate: string | null;
  causeOfDeath: string | null;
  status: string;
  reportedToKccr: boolean;
  kccrTransmittedAt: string | null;
  kccrSubmissionId: string | null;
  treatments: { type: string; startDate: string; endDate: string | null }[];
  eligible: boolean;
  ineligibleReason: string | null;
  /** 이 건 하나의 전송 근거 판정(정본) */
  transmissionState?: KccrTransmissionState;
  transmission: KccrTransmission;
}

interface NewRegistryForm {
  patientId: string;
  diagnosisDate: string;
  primarySite: string;
  morphology: string;
  behavior: string;
  grade: string;
  laterality: string;
  diagnosisBasis: string;
  icdCode: string;
  tnmClinical: string;
  tnmPathological: string;
}

interface NewTreatmentForm {
  treatmentType: string;
  regimen: string;
  startDate: string;
  endDate: string;
  response: string;
}

interface NewFollowUpForm {
  followUpDate: string;
  status: string;
  recurrence: boolean;
  metastasisSite: string;
  performanceStatus: string;
  note: string;
}

/* ────────── Constants ────────── */

const TABS = ['등록 목록', '등록 상세/편집', '환자 타임라인', '통계 대시보드', 'KCCR 보고'] as const;
type TabName = typeof TABS[number];

const STAGE_COLOR: Record<string, string> = {
  I: 'bg-emerald-50 text-emerald-700',
  IA: 'bg-emerald-50 text-emerald-700',
  IB: 'bg-emerald-50 text-emerald-700',
  II: 'bg-yellow-50 text-yellow-700',
  IIA: 'bg-yellow-50 text-yellow-700',
  IIB: 'bg-yellow-50 text-yellow-700',
  III: 'bg-orange-50 text-orange-700',
  IIIA: 'bg-orange-50 text-orange-700',
  IIIB: 'bg-orange-50 text-orange-700',
  IIIC: 'bg-orange-50 text-orange-700',
  IV: 'bg-red-50 text-red-700',
  IVA: 'bg-red-50 text-red-700',
  IVB: 'bg-red-50 text-red-700',
};

const VITAL_COLOR: Record<string, string> = {
  ALIVE: 'bg-emerald-50 text-emerald-700',
  DECEASED: 'bg-gray-100 text-gray-600',
  UNKNOWN: 'bg-yellow-50 text-yellow-700',
};
const VITAL_LABEL: Record<string, string> = {
  ALIVE: '생존', DECEASED: '사망', UNKNOWN: '불명',
};

const STATUS_COLOR: Record<string, string> = {
  REGISTERED: 'bg-blue-50 text-blue-700',
  VERIFIED: 'bg-emerald-50 text-emerald-700',
  REPORTED: 'bg-purple-50 text-purple-700',
  CLOSED: 'bg-gray-100 text-gray-600',
};
const STATUS_LABEL: Record<string, string> = {
  REGISTERED: '등록', VERIFIED: '검증완료', REPORTED: '보고완료', CLOSED: '종결',
};

const TX_TYPE_COLOR: Record<string, string> = {
  SURGERY: 'bg-blue-50 text-blue-700',
  CHEMOTHERAPY: 'bg-violet-50 text-violet-700',
  RADIATION: 'bg-amber-50 text-amber-700',
  IMMUNOTHERAPY: 'bg-emerald-50 text-emerald-700',
  TARGETED: 'bg-pink-50 text-pink-700',
  HORMONE: 'bg-orange-50 text-orange-700',
  OTHER: 'bg-gray-100 text-gray-600',
};
const TX_TYPE_LABEL: Record<string, string> = {
  SURGERY: '수술', CHEMOTHERAPY: '항암화학', RADIATION: '방사선',
  IMMUNOTHERAPY: '면역', TARGETED: '표적', HORMONE: '호르몬', OTHER: '기타',
};

const RESPONSE_COLOR: Record<string, string> = {
  CR: 'bg-emerald-50 text-emerald-700',
  PR: 'bg-blue-50 text-blue-700',
  SD: 'bg-yellow-50 text-yellow-700',
  PD: 'bg-red-50 text-red-700',
};

const TIMELINE_COLOR: Record<string, string> = {
  DIAGNOSIS: 'bg-red-500',
  TREATMENT: 'bg-blue-500',
  FOLLOW_UP: 'bg-emerald-500',
};
const TIMELINE_LABEL: Record<string, string> = {
  DIAGNOSIS: '진단', TREATMENT: '치료', FOLLOW_UP: '추적',
};

/** 추적관찰 상태 (CancerFollowUp.status) — 시드/운영 값은 NED */
const FU_STATUS_LABEL: Record<string, string> = {
  NED: '무병상태(NED)',
  AWD: '유병생존(AWD)',
  DOD: '암으로 사망(DOD)',
  DOC: '타 원인 사망(DOC)',
  LOST: '추적소실',
  UNKNOWN: '불명',
};
const FU_STATUS_COLOR: Record<string, string> = {
  NED: 'bg-emerald-50 text-emerald-700',
  AWD: 'bg-yellow-50 text-yellow-700',
  DOD: 'bg-gray-100 text-gray-600',
  DOC: 'bg-gray-100 text-gray-600',
  LOST: 'bg-red-50 text-red-700',
  UNKNOWN: 'bg-yellow-50 text-yellow-700',
};

const AJCC_STAGES = ['I', 'IA', 'IB', 'II', 'IIA', 'IIB', 'III', 'IIIA', 'IIIB', 'IIIC', 'IV', 'IVA', 'IVB'];

const STATUSES = ['REGISTERED', 'VERIFIED', 'REPORTED', 'CLOSED'];
const VITAL_STATUSES = ['ALIVE', 'DECEASED', 'UNKNOWN'];

const EMPTY_REGISTRY_FORM: NewRegistryForm = {
  patientId: '', diagnosisDate: '', primarySite: '', morphology: '',
  behavior: '', grade: '', laterality: '', diagnosisBasis: '',
  icdCode: '', tnmClinical: '', tnmPathological: '',
};

const EMPTY_TREATMENT_FORM: NewTreatmentForm = {
  treatmentType: '', regimen: '', startDate: '', endDate: '', response: '',
};

const EMPTY_FOLLOWUP_FORM: NewFollowUpForm = {
  followUpDate: '', status: 'NED', recurrence: false, metastasisSite: '',
  performanceStatus: '', note: '',
};

/* ────────── Helpers ────────── */

/**
 * 🔴 원결함: 서버 목록 응답은 `{ data: { items, total, page, limit } }` 인데
 * unwrap 이 `raw.data` 만 배열로 기대해 **항상 빈 목록**이 됐다(실제 3건이 화면에서 사라짐).
 * 타임라인 응답도 `{ data: { timeline: [...] } }` 라 같은 이유로 늘 비어 있었다.
 * → items / timeline 컨테이너를 함께 인식한다.
 */
function unwrap<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items as T[];
    if (Array.isArray(o.timeline)) return o.timeline as T[];
    if (o.data !== undefined && o.data !== null) return unwrap<T>(o.data);
  }
  return [];
}

/** `{ data: X }` 한 겹(또는 두 겹)을 벗겨 단일 객체를 꺼낸다 */
function unwrapOne<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.data !== undefined && o.data !== null) return unwrapOne<T>(o.data) ?? (o.data as T);
  return raw as T;
}

/** 🔴 미상(null)을 빈칸으로 흘리지 않는다 — 아는 것과 모르는 것을 구분해 말한다 */
const UNKNOWN_STAGE_LABEL = '미상';
function stageLabel(stage: string | null | undefined): string {
  return stage && stage.trim() ? stage : UNKNOWN_STAGE_LABEL;
}

function Badge({ label, colorMap, value }: { label: string; colorMap: Record<string, string>; value: string }) {
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${colorMap[value] ?? 'bg-gray-100 text-gray-600'}`}>
      <T k={label} />
    </span>
  );
}

function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-gray-50">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-5 py-4"><div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="py-16 text-center">
        <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <p className="text-sm text-gray-400">{message}</p>
      </td>
    </tr>
  );
}

/* ────────── Page ────────── */

export default function CancerRegistryPage() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabName>('등록 목록');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newForm, setNewForm] = useState<NewRegistryForm>(EMPTY_REGISTRY_FORM);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txForm, setTxForm] = useState<NewTreatmentForm>(EMPTY_TREATMENT_FORM);
  const [showFuModal, setShowFuModal] = useState(false);
  const [fuForm, setFuForm] = useState<NewFollowUpForm>(EMPTY_FOLLOWUP_FORM);

  // KCCR 제출 — 대상 선택 / 미리보기 / 확정 확인
  const [selectedKccrIds, setSelectedKccrIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);
  const [lastReport, setLastReport] = useState<KccrReportResult | null>(null);

  // Filters
  const [filterSite, setFilterSite] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterVital, setFilterVital] = useState('');

  /* ────── Queries ────── */

  const { data: listRaw, isLoading: listLoading, isError, error, refetch } = useQuery({
    queryKey: ['cancer-registry', 'list', filterSite, filterStage, filterStatus, filterVital],
    queryFn: () =>
      apiClient.get<{ data: { items: CancerRegistry[]; total: number } }>('/api/v1/cancer-registry', {
        primarySite: filterSite || undefined,
        ajccStage: filterStage || undefined,
        status: filterStatus || undefined,
        vitalStatus: filterVital || undefined,
      }),
  });
  const registries: CancerRegistry[] = unwrap<CancerRegistry>(listRaw);

  const { data: detailRaw, isLoading: detailLoading } = useQuery({
    queryKey: ['cancer-registry', 'detail', selectedId],
    queryFn: () => apiClient.get<{ data: CancerRegistry }>(`/api/v1/cancer-registry/${selectedId}`),
    enabled: !!selectedId,
  });
  const detail: CancerRegistry | null = unwrapOne<CancerRegistry>(detailRaw);

  // 🔴 원결함: GET /:id/treatments · /:id/follow-ups 라우트는 존재하지 않아 404 였고
  // 화면은 그 404 를 "등록된 치료 이력이 없습니다"(=사실 없음)로 렌더했다.
  // 상세 응답에 이미 treatments·followUps 가 실려 오므로 그것을 정본으로 쓴다.
  const treatments: Treatment[] = detail?.treatments ?? [];
  const followUps: FollowUp[] = detail?.followUps ?? [];
  const txLoading = detailLoading;
  const fuLoading = detailLoading;

  const { data: timelineRaw, isLoading: timelineLoading } = useQuery({
    queryKey: ['cancer-registry', 'timeline', selectedId],
    queryFn: () => apiClient.get<{ data: { timeline: TimelineEvent[] } }>(`/api/v1/cancer-registry/${selectedId}/timeline`),
    enabled: !!selectedId && activeTab === '환자 타임라인',
  });
  const timeline: TimelineEvent[] = unwrap<TimelineEvent>(timelineRaw);

  // 통계는 원발부위 필터 후보(실제 등재된 코드)의 출처이기도 하므로 상시 조회한다.
  const { data: statsRaw, isLoading: statsLoading } = useQuery({
    queryKey: ['cancer-registry-stats'],
    queryFn: () => apiClient.get<{ data: RegistryStats }>('/api/v1/cancer-registry/stats'),
  });
  const stats: RegistryStats | null = unwrapOne<RegistryStats>(statsRaw);

  const { data: unreportedRaw, isLoading: unreportedLoading } = useQuery({
    queryKey: ['cancer-registry', 'unreported'],
    queryFn: () => apiClient.get<{ data: { items: CancerRegistry[] } }>('/api/v1/cancer-registry', {
      reportedToKccr: 'false',
    }),
    enabled: activeTab === 'KCCR 보고',
  });
  const unreported: CancerRegistry[] = unwrap<CancerRegistry>(unreportedRaw);

  const { data: overdueRaw, isLoading: overdueLoading } = useQuery({
    queryKey: ['cancer-registry-overdue'],
    queryFn: () => apiClient.get<{ data: OverdueFollowUp[] }>('/api/v1/cancer-registry/overdue-followups'),
    enabled: activeTab === 'KCCR 보고',
  });
  const overdueList: OverdueFollowUp[] = unwrap<OverdueFollowUp>(overdueRaw);

  // 🔴 미리보기 EP(GET /report/kccr/preview)는 있는데 부르는 화면이 없었다 → 오보고 방지용으로 배선
  const { data: previewRaw, isLoading: previewLoading, isError: previewError } = useQuery({
    queryKey: ['cancer-registry-kccr-preview', previewId],
    queryFn: () => apiClient.get<{ data: KccrPreviewRow }>('/api/v1/cancer-registry/report/kccr/preview', {
      id: previewId ?? '',
    }),
    enabled: !!previewId,
  });
  const preview: KccrPreviewRow | null = unwrapOne<KccrPreviewRow>(previewRaw);

  /* ────── Mutations ────── */

  const createMut = useMutation({
    mutationFn: (body: NewRegistryForm) =>
      apiClient.post('/api/v1/cancer-registry', body),
    onSuccess: () => {
      toast.success( '암등록이 완료되었습니다');
      queryClient.invalidateQueries({ queryKey: ['cancer-registry'] });
      setShowNewModal(false);
      setNewForm(EMPTY_REGISTRY_FORM);
    },
    onError: () => toast.error( '등록 실패'),
  });

  // 🔴 원결함: 화면은 PATCH /:id/verify 를 불렀는데 서버 라우트는 POST → 항상 404(검증 버튼 무효)
  const verifyMut = useMutation({
    mutationFn: (id: string) =>
      apiClient.post(`/api/v1/cancer-registry/${id}/verify`),
    onSuccess: () => {
      toast.success( '검증이 완료되었습니다');
      queryClient.invalidateQueries({ queryKey: ['cancer-registry'] });
      queryClient.invalidateQueries({ queryKey: ['cancer-registry-stats'] });
    },
    onError: () => toast.error( '검증 실패'),
  });

  const aiStagingMut = useMutation({
    mutationFn: (id: string) =>
      apiClient.post(`/api/v1/cancer-registry/${id}/auto-stage`),
    onSuccess: () => {
      toast.success( `${AI_ORIGIN_TEXT} 병기 산정이 완료되었습니다`);
      queryClient.invalidateQueries({ queryKey: ['cancer-registry', selectedId] });
    },
    onError: () => toast.error( `${AI_ORIGIN_TEXT} 병기 산정 실패`),
  });

  // 🔴 원결함(3곳 공통): apiClient.post 시그니처는 post(path, body) 인데
  // `{ body: JSON.stringify(...), headers }` 로 이중 래핑해 서버에는
  // `{ body: "...", headers: {...} }` 가 도착했다 → 필수 필드가 전부 undefined.
  const addTxMut = useMutation({
    mutationFn: (form: NewTreatmentForm) =>
      apiClient.post(`/api/v1/cancer-registry/${selectedId}/treatments`, {
        treatmentType: form.treatmentType,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        regimen: form.regimen || undefined,
        response: form.response || undefined,
      }),
    onSuccess: () => {
      toast.success( '치료 이력이 추가되었습니다');
      queryClient.invalidateQueries({ queryKey: ['cancer-registry', 'detail', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['cancer-registry', 'timeline', selectedId] });
      setShowTxModal(false);
      setTxForm(EMPTY_TREATMENT_FORM);
    },
    onError: () => toast.error( '치료 이력 추가 실패'),
  });

  const addFuMut = useMutation({
    mutationFn: (form: NewFollowUpForm) =>
      apiClient.post(`/api/v1/cancer-registry/${selectedId}/follow-ups`, {
        followUpDate: form.followUpDate,
        status: form.status,
        recurrence: form.recurrence,
        metastasisSite: form.metastasisSite || undefined,
        performanceStatus: form.performanceStatus || undefined,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      toast.success( '추적 관찰이 추가되었습니다');
      queryClient.invalidateQueries({ queryKey: ['cancer-registry', 'detail', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['cancer-registry', 'timeline', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['cancer-registry-overdue'] });
      setShowFuModal(false);
      setFuForm(EMPTY_FOLLOWUP_FORM);
    },
    onError: () => toast.error( '추적 관찰 추가 실패'),
  });

  /**
   * 🔴 원결함: 전송 코드가 없는데 "KCCR 일괄 보고가 완료되었습니다" 라고 말했고,
   * 이중 래핑 때문에 ids 가 서버에 닿지 않아 **선택하지 않은 전건**이 봉인됐다.
   * → ids 를 그대로 보내고(서버는 빈 ids 를 거부), 결과의 transmission 을 화면이 그대로 말한다.
   */
  const batchReportMut = useMutation({
    mutationFn: (ids: string[]) =>
      apiClient.post<{ data: KccrReportResult }>('/api/v1/cancer-registry/report/kccr', {
        ids,
        confirm: true,
      }),
    onSuccess: (res) => {
      const result = unwrapOne<KccrReportResult>(res);
      setLastReport(result);
      setSelectedKccrIds([]);
      const prepared = result?.preparedCount ?? 0;
      const skipped = result?.skipped?.length ?? 0;
      toast.success(
        `보고 대상 ${prepared}건 확정 — 아직 전송되지 않았습니다(중앙암등록본부 전송 연동 없음)` +
          (skipped ? ` · 제외 ${skipped}건` : ''),
      );
      queryClient.invalidateQueries({ queryKey: ['cancer-registry'] });
    },
    onError: () => toast.error( '보고 대상 확정 실패 — 아무 것도 변경되지 않았습니다'),
  });

  /* ────── Render helpers ────── */

  const handleRowClick = (id: string) => {
    setSelectedId(id);
    setActiveTab('등록 상세/편집');
  };

  /* ────── Tab 1: 등록 목록 ────── */
  function renderList() {
    return (
      <div>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {/* 🔴 원결함: 원발부위 후보가 한글 명칭('위','폐'…)이었는데 DB 값은 ICD-O-3 지형 코드(C34.1)라
              어떤 값을 골라도 결과 0건이었다 → 실제 등재된 코드(통계 groupBy)만 후보로 둔다 */}
          <select value={filterSite} onChange={(e) => setFilterSite(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none">
            <option value="">{tAttr('전체 원발부위')}</option>
            {(stats?.bySite ?? []).map((s) => (
              <option key={s.site} value={s.site}>{s.site} ({s.count})</option>
            ))}
          </select>
          <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none">
            <option value="">{tAttr('전체 병기')}</option>
            {AJCC_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none">
            <option value="">{tAttr('전체 상태')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{tAttr(STATUS_LABEL[s])}</option>)}
          </select>
          <select value={filterVital} onChange={(e) => setFilterVital(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none">
            <option value="">{tAttr('전체 생존상태')}</option>
            {VITAL_STATUSES.map((s) => <option key={s} value={s}>{tAttr(VITAL_LABEL[s])}</option>)}
          </select>
          <div className="flex-1" />
          <button onClick={() => setShowNewModal(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
            <T k="+ 신규 등록" />
          </button>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="등록번호" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="원발부위" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="ICD 코드" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="AJCC 병기" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="생존상태" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="진단일" /></th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <SkeletonRows cols={8} />
              ) : !registries.length ? (
                <EmptyRow cols={8} message={tAttr('등록된 암등록 데이터가 없습니다')} />
              ) : (
                registries.map((r) => (
                  <tr key={r.id} onClick={() => handleRowClick(r.id)}
                    className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors cursor-pointer">
                    <td className="px-5 py-4 font-mono text-xs text-gray-600">{r.registrationNo}</td>
                    <td className="px-5 py-4 font-medium text-gray-900">
                      {r.patient ? `${r.patient.familyName}${r.patient.givenName}` : r.patientId}
                    </td>
                    <td className="px-5 py-4 text-gray-700">{r.primarySite}</td>
                    <td className="px-5 py-4 font-mono text-xs text-gray-600">{r.icdCode}</td>
                    <td className="px-5 py-4 text-center">
                      {/* 🔴 병기 미상은 빈 배지가 아니라 '미상' 으로 말한다 */}
                      <Badge label={stageLabel(r.ajccStage)} colorMap={STAGE_COLOR} value={r.ajccStage ?? ''} />
                    </td>
                    <td className="px-5 py-4 text-center">
                      <Badge label={VITAL_LABEL[r.vitalStatus] ?? r.vitalStatus} colorMap={VITAL_COLOR} value={r.vitalStatus} />
                    </td>
                    <td className="px-5 py-4 text-center">
                      <Badge label={STATUS_LABEL[r.status] ?? r.status} colorMap={STATUS_COLOR} value={r.status} />
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-500">
                      {r.diagnosisDate ? kdate(r.diagnosisDate) : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ────── Tab 2: 등록 상세/편집 ────── */
  function renderDetail() {
    if (!selectedId) {
      return (
        <div className="py-20 text-center text-gray-400">
          <svg className="w-12 h-12 mx-auto text-gray-200 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.5a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
          </svg>
          <p className="text-sm"><T k="목록에서 암등록 건을 선택해주세요" /></p>
        </div>
      );
    }

    if (detailLoading) {
      return <div className="py-20 text-center text-gray-400 text-sm"><T k="불러오는 중..." /></div>;
    }

    if (!detail) {
      return <div className="py-20 text-center text-gray-400 text-sm"><T k="데이터를 불러올 수 없습니다" /></div>;
    }

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {detail.patient ? `${detail.patient.familyName}${detail.patient.givenName}` : detail.patientId}
              </h3>
              <p className="text-sm text-gray-500 mt-0.5"><T k="등록번호:" /> {detail.registrationNo}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => aiStagingMut.mutate(detail.id)}
                disabled={aiStagingMut.isPending}
                className="min-h-[44px] px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-xl hover:bg-violet-700 transition-colors shadow-sm disabled:opacity-50">
                {aiStagingMut.isPending ? '산정 중...' : `${AI_ORIGIN_TEXT} 병기 자동 산정`}
              </button>
              {detail.status !== 'VERIFIED' && (
                <button onClick={() => verifyMut.mutate(detail.id)}
                  disabled={verifyMut.isPending}
                  className="min-h-[44px] px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50">
                  <T k={verifyMut.isPending ? '검증 중...' : '검증 완료'} />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: '원발부위', value: detail.primarySite },
              { label: 'ICD 코드', value: detail.icdCode },
              // 🔴 다른 12개 필드는 `?? '-'` 인데 병기만 누락돼 미상이 빈칸으로 보였다
              { label: 'AJCC 병기', value: stageLabel(detail.ajccStage) },
              { label: '진단일', value: detail.diagnosisDate ? kdate(detail.diagnosisDate) : '-' },
              { label: '형태학(ICD-O-3)', value: detail.morphology ?? '-' },
              { label: '행동양식', value: detail.behavior ?? '-' },
              { label: '분화도', value: detail.grade ?? '-' },
              { label: '편측성', value: detail.laterality ?? '-' },
              { label: '진단근거', value: detail.diagnosisBasis ?? '-' },
              { label: 'TNM 임상', value: detail.tnmClinical ?? '-' },
              { label: 'TNM 병리', value: detail.tnmPathological ?? '-' },
              { label: '생존상태', value: VITAL_LABEL[detail.vitalStatus] ?? detail.vitalStatus },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-[11px] font-medium text-gray-400 mb-0.5"><T k={item.label} /></p>
                <p className="text-sm font-medium text-gray-800">{item.value}</p>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[11px] text-gray-500"><T k="병기 자동 산정은" /> {AI_ORIGIN_TEXT}<T k="가 생성한 참고 정보입니다 — 최종 판단은 의료진에게 있습니다." /></p>

          {detail.verifiedAt && (
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2">
              <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 whitespace-nowrap"><T k="검증완료" /></span>
              <span className="text-xs text-gray-400">
                {kdate(new Date(detail.verifiedAt))} {detail.verifiedBy && `(${detail.verifiedBy})`}
              </span>
            </div>
          )}
        </div>

        {/* Treatments */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h4 className="text-sm font-bold text-gray-900"><T k="치료 이력" /></h4>
            <button onClick={() => setShowTxModal(true)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"><T k="+ 추가" /></button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="치료유형" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="요법" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="시작일" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="종료일" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="반응" /></th>
              </tr>
            </thead>
            <tbody>
              {txLoading ? (
                <SkeletonRows cols={5} rows={3} />
              ) : !treatments.length ? (
                <EmptyRow cols={5} message={tAttr('등록된 치료 이력이 없습니다')} />
              ) : (
                treatments.map((t) => (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                    <td className="px-5 py-4">
                      <Badge label={TX_TYPE_LABEL[t.treatmentType] ?? t.treatmentType} colorMap={TX_TYPE_COLOR} value={t.treatmentType} />
                    </td>
                    <td className="px-5 py-4 text-gray-700">{t.regimen ?? '-'}</td>
                    <td className="px-5 py-4 text-xs text-gray-500">{kdate(t.startDate)}</td>
                    <td className="px-5 py-4 text-xs text-gray-500"><T k={t.endDate ? kdate(t.endDate) : '진행중'} /></td>
                    <td className="px-5 py-4 text-center">
                      {t.response ? <Badge label={t.response} colorMap={RESPONSE_COLOR} value={t.response} /> : <span className="text-xs text-gray-400">-</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Follow-ups */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h4 className="text-sm font-bold text-gray-900"><T k="추적 관찰" /></h4>
            <button onClick={() => setShowFuModal(true)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"><T k="+ 추가" /></button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="추적일" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="재발" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="전이 부위" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="수행능력" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
              </tr>
            </thead>
            <tbody>
              {fuLoading ? (
                <SkeletonRows cols={6} rows={3} />
              ) : !followUps.length ? (
                <EmptyRow cols={6} message={tAttr('등록된 추적 관찰이 없습니다')} />
              ) : (
                followUps.map((f) => (
                  <tr key={f.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                    <td className="px-5 py-4 text-xs text-gray-600">{kdate(f.followUpDate)}</td>
                    <td className="px-5 py-4 text-center">
                      <Badge label={FU_STATUS_LABEL[f.status] ?? f.status} colorMap={FU_STATUS_COLOR} value={f.status} />
                    </td>
                    <td className="px-5 py-4 text-gray-700 text-xs"><T k={f.recurrence ? '재발' : '없음'} /></td>
                    <td className="px-5 py-4 text-gray-700 text-xs">{f.metastasisSite ?? '-'}</td>
                    <td className="px-5 py-4 text-center text-sm font-medium text-gray-700">{f.performanceStatus ?? '-'}</td>
                    <td className="px-5 py-4 text-xs text-gray-500 max-w-[200px] truncate">{f.note ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ────── Tab 3: 환자 타임라인 ────── */
  function renderTimeline() {
    if (!selectedId) {
      return (
        <div className="py-20 text-center text-gray-400 text-sm">
          <T k="목록에서 암등록 건을 선택한 후 타임라인을 확인하세요" />
        </div>
      );
    }

    if (timelineLoading) {
      return (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400"><T k="타임라인 불러오는 중..." /></p>
        </div>
      );
    }

    if (!timeline.length) {
      return (
        <EmptyState icon="📋" title="타임라인 이벤트가 없습니다" />
      );
    }

    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h4 className="text-sm font-bold text-gray-900 mb-6">
          {detail?.patient ? `${detail.patient.familyName}${detail.patient.givenName}` : ''} <T k="타임라인" />
        </h4>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[18px] top-2 bottom-2 w-0.5 bg-gray-200" />
          <div className="space-y-6">
            {timeline.map((ev, idx) => (
              // 서버 타임라인 항목에는 id 가 없다 — 날짜+유형+순번으로 키를 만든다
              <div key={`${ev.date}-${ev.type}-${idx}`} className="relative flex items-start gap-4 pl-1">
                {/* Dot */}
                <div className={`relative z-10 flex-shrink-0 w-9 h-9 rounded-full ${TIMELINE_COLOR[ev.type] ?? 'bg-gray-400'} flex items-center justify-center`}>
                  {ev.type === 'DIAGNOSIS' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  )}
                  {ev.type === 'TREATMENT' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5" />
                    </svg>
                  )}
                  {ev.type === 'FOLLOW_UP' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                    </svg>
                  )}
                </div>
                {/* Content */}
                <div className={`flex-1 bg-gray-50 rounded-xl p-4 ${idx === 0 ? 'ring-1 ring-gray-200' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                      ev.type === 'DIAGNOSIS' ? 'bg-red-100 text-red-700' :
                      ev.type === 'TREATMENT' ? 'bg-blue-100 text-blue-700' :
                      'bg-emerald-100 text-emerald-700'
                    }`}>
                      <T k={TIMELINE_LABEL[ev.type] ?? ev.type} />
                    </span>
                    <span className="text-xs text-gray-400">{kdate(ev.date)}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900">{ev.title}</p>
                  {/* 🔴 서버가 주는 것은 detail 이다(description·metadata 는 존재한 적 없음) */}
                  {ev.detail && Object.keys(ev.detail).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {Object.entries(ev.detail)
                        .filter(([k, v]) => k !== 'id' && v !== null && v !== undefined && v !== '')
                        .map(([k, v]) => (
                          <span key={k} className="text-[10px] text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-100">
                            {k}: {String(v)}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ────── Tab 4: 통계 대시보드 ────── */
  function renderStats() {
    if (statsLoading) {
      return (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400"><T k="통계 불러오는 중..." /></p>
        </div>
      );
    }

    if (!stats) {
      return <div className="py-20 text-center text-gray-400 text-sm"><T k="통계 데이터를 불러올 수 없습니다" /></div>;
    }

    const maxSiteCount = Math.max(...(stats.bySite?.map((s) => s.count) ?? [1]), 1);
    const maxStageCount = Math.max(...(stats.byStage?.map((s) => s.count) ?? [1]), 1);

    return (
      <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title={tAttr('전체 등록 건수')} value={stats.total?.toLocaleString() ?? 0} color="gray" />
          {/* 🔴 서버 byVitalStatus 는 배열 — Object.entries 로 읽어 제목 '0' / 값 '[object Object]' 였다 */}
          {(stats.byVitalStatus ?? []).map((v) => (
            <StatCard
              key={v.status}
              title={tAttr(VITAL_LABEL[v.status] ?? v.status)}
              value={v.count.toLocaleString()}
              color={v.status === 'ALIVE' ? 'emerald' : v.status === 'DECEASED' ? 'gray' : 'amber'}
            />
          ))}
        </div>

        {/* Site distribution */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="원발부위별 분포" /></h4>
          {stats.bySite?.length ? (
            <div className="space-y-3">
              {stats.bySite.map((s) => (
                <div key={s.site} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-24 text-right flex-shrink-0">{s.site}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full flex items-center justify-end px-2 transition-all"
                      style={{ width: `${Math.max((s.count / maxSiteCount) * 100, 5)}%` }}>
                      <span className="text-[10px] font-bold text-white">{s.count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6"><T k="데이터 없음" /></p>
          )}
        </div>

        {/* Stage distribution */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="병기별 분포" /></h4>
          {stats.byStage?.length ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {stats.byStage.map((s) => (
                <div key={s.stage} className="text-center p-3 bg-gray-50 rounded-xl">
                  {/* 서버는 병기 미상을 'UNKNOWN' 으로 묶어 준다 */}
                  <Badge label={s.stage === 'UNKNOWN' ? UNKNOWN_STAGE_LABEL : s.stage} colorMap={STAGE_COLOR} value={s.stage} />
                  <p className="text-lg font-bold text-gray-900 mt-2">{s.count}</p>
                  <p className="text-[10px] text-gray-400">
                    {ratioText(s.count, stats.total, { pctOnly: true })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6"><T k="데이터 없음" /></p>
          )}
        </div>
      </div>
    );
  }

  /* ────── Tab 5: KCCR 보고 ────── */
  function renderKccr() {
    // 검증(VERIFIED) 전 건은 제출 대상이 아니다 — 서버도 같은 기준으로 거른다.
    const eligible = unreported.filter((r) => r.status === 'VERIFIED');
    const selectedSet = new Set(selectedKccrIds);
    const allEligibleSelected = eligible.length > 0 && eligible.every((r) => selectedSet.has(r.id));

    const toggleOne = (id: string) =>
      setSelectedKccrIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    const toggleAll = () =>
      setSelectedKccrIds(allEligibleSelected ? [] : eligible.map((r) => r.id));

    return (
      <div className="space-y-6">
        {/* 🔴 전송 연동이 없다는 사실을 화면이 먼저 말한다 — '보고 완료'라고 말하지 않는다 */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-bold text-amber-900"><T k="중앙암등록본부(KCCR) 전송 연동 없음" /></p>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            <T k="이 화면에서 할 수 있는 것은" /> <b><T k="제출 자료 생성" /></b><T k="과" /> <b><T k="보고 대상 확정" /></b><T k="까지입니다. 확정해도 자료가 중앙암등록본부로" /> <b><T k="전송되지 않습니다" /></b><T k=". 실제 제출은 확정된 자료를 내려받아 별도 경로로 진행해야 합니다. 확정 시 발급되는 접수번호는" /> <b><T k="원내 번호(LOCAL-)" /></b><T k="이며 기관이 부여한 번호가 아닙니다. 🔴" /> <b><T k="전송되지 않은 건은 언제든 자료를 다시 산출할 수 있습니다" /></b>
            <T k="(한 번의 확정으로 영구 미보고가 되지 않습니다)." />
          </p>
        </div>

        {/* 직전 확정 결과 — 무엇이 확정되고 무엇이 제외됐는지 그대로 보여준다 */}
        {lastReport && (
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
            <p className="text-sm font-bold text-gray-900">
              <T k="직전 처리 결과 ·" /> {kdate(lastReport.reportDate, 'datetime')}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              <li><T k="요청" /> {lastReport.requested}<T k="건 · 자료 생성" /> {lastReport.count}<T k="건 · 보고 대상 확정" /> {lastReport.preparedCount}<T k="건" /></li>
              <li className="text-red-700 font-medium"><T k="전송 상태:" /> {lastReport.transmission?.status ?? 'NOT_TRANSMITTED'} — {lastReport.transmission?.note}</li>
              {(lastReport.localSubmissionIds?.length ?? 0) > 0 && (
                <li>
                  <T k="원내 접수번호" /> {lastReport.localSubmissionIds!.length}<T k="건 발급 —" />{' '}
                  <span className="font-mono">{lastReport.localSubmissionIds!.map((x) => x.kccrSubmissionId).join(', ')}</span>
                  <span className="text-gray-400"> <T k="(기관이 부여한 번호가 아닙니다)" /></span>
                </li>
              )}
              {lastReport.resubmittable && (
                <li className="text-gray-500"><T k="전송되지 않은 건은 자료를 다시 산출할 수 있습니다." /></li>
              )}
              {lastReport.skipped?.length > 0 && (
                <li>
                  <T k="제외" /> {lastReport.skipped.length}<T k="건 —" />{' '}
                  {lastReport.skipped
                    .map((s) => `${s.registrationNo ?? s.id}(${
                      s.reason === 'NOT_VERIFIED' ? '검증 전' :
                      s.reason === 'ALREADY_TRANSMITTED' ? '이미 전송됨' :
                      s.reason === 'ALREADY_PREPARED' ? '이미 확정(미전송)' : '대상 없음'
                    })`)
                    .join(', ')}
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Unreported list */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h4 className="text-sm font-bold text-gray-900"><T k="미보고 목록" /></h4>
              <p className="text-xs text-gray-400 mt-0.5">
                <T k="전체" /> {unreported.length}<T k="건 · 제출 가능(검증완료)" /> {eligible.length}<T k="건 · 선택" /> {selectedKccrIds.length}<T k="건" />
              </p>
            </div>
            <button
              onClick={() => {
                // 🔴 대상이 비면 확대하지 않는다 — 서버도 400 으로 거부한다
                if (!selectedKccrIds.length) { toast.error( '보고 대상을 선택하세요'); return; }
                setShowBatchConfirm(true);
              }}
              disabled={batchReportMut.isPending || !selectedKccrIds.length}
              className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 transition-colors shadow-sm disabled:opacity-50">
              {batchReportMut.isPending ? '처리 중...' : `선택 ${selectedKccrIds.length}건 보고 대상 확정`}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-10">
                  <input type="checkbox" aria-label={tAttr('제출 가능 건 전체 선택')}
                    checked={allEligibleSelected} onChange={toggleAll}
                    disabled={!eligible.length} className="align-middle" />
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="등록번호" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="원발부위" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="AJCC 병기" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="진단일" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="제출 자료" /></th>
              </tr>
            </thead>
            <tbody>
              {unreportedLoading ? (
                <SkeletonRows cols={8} rows={4} />
              ) : !unreported.length ? (
                <EmptyRow cols={8} message={tAttr('미보고 건이 없습니다')} />
              ) : (
                unreported.map((r) => {
                  const canSubmit = r.status === 'VERIFIED';
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                      <td className="px-5 py-4 text-center">
                        <input type="checkbox"
                          aria-label={`${r.registrationNo} 선택`}
                          checked={selectedSet.has(r.id)}
                          disabled={!canSubmit}
                          onChange={() => toggleOne(r.id)} />
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-gray-600">{r.registrationNo}</td>
                      <td className="px-5 py-4 font-medium text-gray-900">
                        {r.patient ? `${r.patient.familyName}${r.patient.givenName}` : r.patientId}
                      </td>
                      <td className="px-5 py-4 text-gray-700">{r.primarySite}</td>
                      <td className="px-5 py-4 text-center">
                        <Badge label={stageLabel(r.ajccStage)} colorMap={STAGE_COLOR} value={r.ajccStage ?? ''} />
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">
                        {r.diagnosisDate ? kdate(r.diagnosisDate) : '-'}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <Badge label={STATUS_LABEL[r.status] ?? r.status} colorMap={STATUS_COLOR} value={r.status} />
                        {!canSubmit && <p className="text-[10px] text-gray-400 mt-1"><T k="검증 전 — 제출 불가" /></p>}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <button onClick={() => setPreviewId(r.id)}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="미리보기" /></button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Overdue follow-ups */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h4 className="text-sm font-bold text-gray-900"><T k="추적 관찰 연체" /></h4>
            <p className="text-xs text-gray-400 mt-0.5">
              <T k="마지막 접촉 후 6개월이 지났거나, 진단 이후" /> <b><T k="한 번도 추적하지 않은" /></b> <T k="생존 환자" />
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="등록번호" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="원발부위" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="마지막 추적일" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500"><T k="경과" /></th>
              </tr>
            </thead>
            <tbody>
              {overdueLoading ? (
                <SkeletonRows cols={5} rows={4} />
              ) : !overdueList.length ? (
                <EmptyRow cols={5} message={tAttr('연체된 추적 관찰이 없습니다')} />
              ) : (
                overdueList.map((o) => (
                  <tr key={o.registryId} className="border-b border-gray-50 hover:bg-red-50/20 transition-colors">
                    <td className="px-5 py-4 font-mono text-xs text-gray-600">{o.registrationNo}</td>
                    <td className="px-5 py-4 font-medium text-gray-900">
                      {o.patient ? `${o.patient.familyName}${o.patient.givenName}` : '-'}
                    </td>
                    <td className="px-5 py-4 text-gray-700">{o.primarySite}</td>
                    <td className="px-5 py-4 text-xs text-gray-500">
                      <T k={o.lastFollowUp ? kdate(o.lastFollowUp.followUpDate) : '기록 없음'} />
                    </td>
                    {/*
                      🔴 원결함: 화면이 o.daysSinceLast(존재하지 않는 필드) 로 읽어 `undefined일` 을 찍고,
                      `undefined > 365` 가 false 라 **한 번도 추적 안 한 환자를 가장 약한 노랑**으로 칠했다.
                      미상을 최경증으로 낙착시키지 않는다 — 추적 이력 없음이 가장 강한 신호다.
                    */}
                    <td className="px-5 py-4 text-center">
                      {o.neverContacted ? (
                        <>
                          <span className="text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap bg-red-600 text-white">
                            <T k="추적 이력 없음" />
                          </span>
                          <p className="text-[10px] text-red-700 mt-1"><T k="진단 후" /> {o.daysSinceDiagnosis}<T k="일" /></p>
                        </>
                      ) : (
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                          (o.daysSinceLastContact ?? 0) > 365 ? 'bg-red-100 text-red-700' :
                          (o.daysSinceLastContact ?? 0) > 180 ? 'bg-orange-100 text-orange-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {o.daysSinceLastContact}<T k="일" />
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ────── Modal: KCCR 제출 자료 미리보기 ────── */
  function renderPreviewModal() {
    if (!previewId) return null;

    const fields: { label: string; value: React.ReactNode }[] = preview
      ? [
          { label: '등록번호', value: preview.registrationNo },
          { label: '환자', value: `${preview.patientName} (${preview.patientMrn})` },
          { label: '생년월일', value: preview.birthDate ? kdate(preview.birthDate) : '-' },
          { label: '성별', value: preview.gender ?? '-' },
          { label: '진단일', value: kdate(preview.diagnosisDate) },
          { label: '원발부위', value: preview.primarySite },
          { label: '형태학', value: preview.morphology },
          { label: '행동양식', value: preview.behavior },
          { label: '분화도', value: preview.grade ?? '-' },
          { label: '편측성', value: preview.laterality ?? '-' },
          { label: '진단근거', value: preview.diagnosisBasis },
          { label: 'ICD 코드', value: preview.icdCode },
          { label: 'TNM 임상', value: preview.tnmClinical ?? '-' },
          { label: 'TNM 병리', value: preview.tnmPathological ?? '-' },
          { label: 'AJCC 병기', value: `${stageLabel(preview.ajccStage)}${preview.ajccEdition ? ` (${preview.ajccEdition}판)` : ''}` },
          { label: '최초 치료', value: preview.firstTreatment ?? '-' },
          { label: '최초 치료일', value: preview.firstTreatmentDate ? kdate(preview.firstTreatmentDate) : '-' },
          { label: '생존상태', value: VITAL_LABEL[preview.vitalStatus] ?? preview.vitalStatus },
          { label: '마지막 접촉일', value: preview.lastContactDate ? kdate(preview.lastContactDate) : '기록 없음' },
          { label: '사망일', value: preview.deathDate ? kdate(preview.deathDate) : '-' },
          { label: '사인', value: preview.causeOfDeath ?? '-' },
          { label: '치료 건수', value: `${preview.treatments.length}건` },
        ]
      : [];

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900"><T k="KCCR 제출 자료 미리보기" /></h3>
            <button onClick={() => setPreviewId(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-6">
            {previewLoading ? (
              <p className="py-10 text-center text-sm text-gray-400"><T k="불러오는 중..." /></p>
            ) : previewError || !preview ? (
              <p className="py-10 text-center text-sm text-red-600"><T k="제출 자료를 불러오지 못했습니다" /></p>
            ) : (
              <>
                {!preview.eligible && (
                  <p className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                    <T k="검증(VERIFIED) 전이라 제출 대상이 아닙니다 — 확정 시 제외됩니다." />
                  </p>
                )}
                <p className="mb-4 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-600">
                  {/* 🔴 배지는 서버 판정(transmissionState)만 본다 — reportedToKccr 로 자체 판정하지 않는다 */}
                  <T k="전송 상태:" /> <b className={preview.transmissionState?.transmitted ? 'text-green-700' : 'text-red-700'}>
                    {preview.transmissionState?.label ?? preview.transmission?.status}
                  </b>{' '}
                  — {preview.transmissionState?.note ?? preview.transmission?.note}
                  {preview.transmissionState?.submissionId && (
                    <>
                      <br />
                      <T k="접수번호:" /> <span className="font-mono">{preview.transmissionState.submissionId}</span>
                      {preview.transmissionState.submissionIdIsLocal && (
                        <span className="text-gray-400"> <T k="(원내 번호 — 기관 접수번호가 아닙니다)" /></span>
                      )}
                    </>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {fields.map((f) => (
                    <div key={f.label}>
                      <p className="text-[11px] font-medium text-gray-400 mb-0.5"><T k={f.label} /></p>
                      <p className="text-sm font-medium text-gray-800">{f.value}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-end mt-6">
              <button onClick={() => setPreviewId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
                <T k="닫기" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ────── Modal: 신규 등록 ────── */
  function renderNewModal() {
    if (!showNewModal) return null;

    const fields: { key: keyof NewRegistryForm; label: string; type?: string; placeholder?: string }[] = [
      { key: 'patientId', label: '환자 ID', placeholder: '환자 ID 입력' },
      { key: 'diagnosisDate', label: '진단일', type: 'date' },
      { key: 'primarySite', label: '원발부위 (ICD-O-3)', placeholder: 'C34.1' },
      { key: 'morphology', label: '형태학', placeholder: '8140/3' },
      { key: 'behavior', label: '행동양식', placeholder: '3' },
      { key: 'grade', label: '분화도', placeholder: 'G2' },
      { key: 'laterality', label: '편측성', placeholder: '좌/우/양측/해당없음' },
      { key: 'diagnosisBasis', label: '진단근거', placeholder: '조직학적' },
      { key: 'icdCode', label: 'ICD 코드', placeholder: 'C34.1' },
      { key: 'tnmClinical', label: 'TNM 임상', placeholder: 'cT2N1M0' },
      { key: 'tnmPathological', label: 'TNM 병리', placeholder: 'pT2N1M0' },
    ];

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900"><T k="신규 암등록" /></h3>
            <button onClick={() => { setShowNewModal(false); setNewForm(EMPTY_REGISTRY_FORM); }}
              className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-4">
              {fields.map((f) => (
                <div key={f.key} className={f.key === 'patientId' ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-gray-600 mb-1"><T k={f.label} /></label>
                  <input
                    type={f.type ?? 'text'}
                    value={newForm[f.key]}
                    onChange={(e) => setNewForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => { setShowNewModal(false); setNewForm(EMPTY_REGISTRY_FORM); }}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
                <T k="취소" />
              </button>
              <button onClick={() => createMut.mutate(newForm)}
                disabled={createMut.isPending || !newForm.patientId || !newForm.diagnosisDate}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50">
                <T k={createMut.isPending ? '등록 중...' : '등록'} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ────── Modal: 치료 추가 ────── */
  function renderTxModal() {
    if (!showTxModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900"><T k="치료 이력 추가" /></h3>
            <button onClick={() => { setShowTxModal(false); setTxForm(EMPTY_TREATMENT_FORM); }}
              className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="치료유형" /></label>
              <select value={txForm.treatmentType} onChange={(e) => setTxForm((p) => ({ ...p, treatmentType: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none">
                <option value="">{tAttr('선택')}</option>
                {Object.entries(TX_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="요법/프로토콜" /></label>
              <input type="text" value={txForm.regimen} onChange={(e) => setTxForm((p) => ({ ...p, regimen: e.target.value }))}
                placeholder={tAttr('FOLFOX, R-CHOP 등')}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="시작일" /></label>
                <input type="date" value={txForm.startDate} onChange={(e) => setTxForm((p) => ({ ...p, startDate: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="종료일" /></label>
                <input type="date" value={txForm.endDate} onChange={(e) => setTxForm((p) => ({ ...p, endDate: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="치료 반응" /></label>
              <select value={txForm.response} onChange={(e) => setTxForm((p) => ({ ...p, response: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none">
                <option value="">{tAttr('선택')}</option>
                <option value="CR">{tAttr('CR (완전반응)')}</option>
                <option value="PR">{tAttr('PR (부분반응)')}</option>
                <option value="SD">{tAttr('SD (안정)')}</option>
                <option value="PD">{tAttr('PD (진행)')}</option>
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => { setShowTxModal(false); setTxForm(EMPTY_TREATMENT_FORM); }}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
                <T k="취소" />
              </button>
              <button onClick={() => addTxMut.mutate(txForm)}
                disabled={addTxMut.isPending || !txForm.treatmentType || !txForm.startDate}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50">
                <T k={addTxMut.isPending ? '추가 중...' : '추가'} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ────── Modal: 추적 관찰 추가 ────── */
  function renderFuModal() {
    if (!showFuModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900"><T k="추적 관찰 추가" /></h3>
            <button onClick={() => { setShowFuModal(false); setFuForm(EMPTY_FOLLOWUP_FORM); }}
              className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="추적일" /></label>
              <input type="date" value={fuForm.followUpDate} onChange={(e) => setFuForm((p) => ({ ...p, followUpDate: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none" />
            </div>
            {/* 🔴 서버 필드명(status·recurrence:boolean·metastasisSite·performanceStatus·note)에 맞춘다.
                이전 폼은 vitalStatus·ecogScore·notes 를 보내 필수값 status 가 비어 항상 실패했다. */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="추적 상태" /></label>
              <select value={fuForm.status} onChange={(e) => setFuForm((p) => ({ ...p, status: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none">
                {Object.entries(FU_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="재발 여부" /></label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={fuForm.recurrence}
                  onChange={(e) => setFuForm((p) => ({ ...p, recurrence: e.target.checked }))} />
                <T k="재발 확인됨" />
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="전이 부위" /></label>
              <input type="text" value={fuForm.metastasisSite} onChange={(e) => setFuForm((p) => ({ ...p, metastasisSite: e.target.value }))}
                placeholder={tAttr('예: 간, 폐, 뼈 (없으면 비워 둠)')}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="ECOG 수행능력" /></label>
              <select value={fuForm.performanceStatus} onChange={(e) => setFuForm((p) => ({ ...p, performanceStatus: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none">
                <option value="">{tAttr('선택')}</option>
                <option value="ECOG-0">{tAttr('0 - 정상 활동')}</option>
                <option value="ECOG-1">{tAttr('1 - 경증 제한')}</option>
                <option value="ECOG-2">{tAttr('2 - 자가간호 가능, 50% 이상 보행')}</option>
                <option value="ECOG-3">{tAttr('3 - 제한적 자가간호, 50% 이상 침상')}</option>
                <option value="ECOG-4">{tAttr('4 - 완전 침상 생활')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="비고" /></label>
              <textarea value={fuForm.note} onChange={(e) => setFuForm((p) => ({ ...p, note: e.target.value }))}
                rows={2} placeholder={tAttr('특이사항 입력')}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none resize-none" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => { setShowFuModal(false); setFuForm(EMPTY_FOLLOWUP_FORM); }}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
                <T k="취소" />
              </button>
              <button onClick={() => addFuMut.mutate(fuForm)}
                disabled={addFuMut.isPending || !fuForm.followUpDate}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50">
                <T k={addFuMut.isPending ? '추가 중...' : '추가'} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ────── Main render ────── */
  return (
    <div>
      {/* Page header */}
      <PageHeader title={tAttr('암등록')} />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === tab
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}>
            <T k={tab} />
          </button>
        ))}
      </div>

      {/* Tab content */}
      {isError && <QueryErrorFallback error={error} onRetry={refetch} />}
      {!isError && activeTab === '등록 목록' && renderList()}
      {!isError && activeTab === '등록 상세/편집' && renderDetail()}
      {!isError && activeTab === '환자 타임라인' && renderTimeline()}
      {!isError && activeTab === '통계 대시보드' && renderStats()}
      {!isError && activeTab === 'KCCR 보고' && renderKccr()}

      {/* Modals */}
      {renderNewModal()}
      {renderTxModal()}
      {renderFuModal()}
      {renderPreviewModal()}

      {/* 확정은 되돌릴 수 없다 — 대상과 '전송 아님'을 다시 확인시킨다 */}
      <ConfirmDialog
        open={showBatchConfirm}
        variant="warning"
        title={tAttr('보고 대상 확정 (전송 아님)')}
        message={
          `선택한 ${selectedKccrIds.length}건을 '보고 대상 확정(미전송)' 으로 표시합니다.\n` +
          '중앙암등록본부 전송 연동이 없어 자료는 전송되지 않으며, 확정 표시는 되돌릴 수 없습니다.\n\n' +
          `대상: ${unreported
            .filter((r) => selectedKccrIds.includes(r.id))
            .map((r) => r.registrationNo)
            .join(', ')}`
        }
        confirmText={tAttr('확정')}
        onCancel={() => setShowBatchConfirm(false)}
        onConfirm={() => {
          setShowBatchConfirm(false);
          batchReportMut.mutate(selectedKccrIds);
        }}
      />
    </div>
  );
}
