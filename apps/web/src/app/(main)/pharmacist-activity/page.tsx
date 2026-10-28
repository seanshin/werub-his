'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import StatCard from '@/components/ui/StatCard';
import { Ratio, KDate, EmptyState } from '@/components/ui/display';
import PageHeader from '@/components/ui/PageHeader';
import PatientSelector from '@/components/ui/PatientSelector';
import CounselTab from './components/CounselTab';
import NaranjoDialog, { NARANJO_CAUSALITY_LABEL, type NaranjoResult } from './components/NaranjoDialog';
import DurOverrideList from '@/components/pharmacy/DurOverrideList';
import { INTERVENTION_TYPE_COLOR, INTERVENTION_TYPE_LABEL } from '@/lib/pharmacist-intervention';

// ── Types ──

interface Intervention {
  id: string;
  pharmacistId: string;
  /** 사용자 원장에서 조회 — 알 수 없으면 null(빈 문자열로 지어내지 않는다) */
  pharmacistName: string | null;
  patientId: string;
  patientName: string | null;
  prescriptionId: string | null;
  /** 책임 처방의(회신할 사람) — 서버가 연결 처방에서 도출. 처방 미연결·처방 없음이면 null */
  prescriberId: string | null;
  prescriberName: string | null;
  /** 미기재면 null — 서버 계약 그대로다(옵셔널 string 으로 좁히면 빈칸이 '' 로 보인다) */
  prescriptionDrug: string | null;
  type: 'DOSE' | 'INTERACTION' | 'DUPLICATE' | 'ROUTE' | 'OTHER';
  reason: string;
  suggestion: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  doctorResponse: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TdmRequest {
  id: string;
  patientId: string;
  patientName: string | null;
  drugName: string;
  indication: string | null;
  /** 🔴 목표범위 미설정은 null 이다 — 0 으로 좁히면 모든 결과가 "범위 밖"으로 붉게 뜬다 */
  targetRangeMin: number | null;
  targetRangeMax: number | null;
  targetUnit: string | null;
  status: string;
  resultLevel: number | null;
  resultInterpretation: string | null;
  doseRecommendation: string | null;
  requestedAt: string;
  resultedAt: string | null;
}

interface AdrReport {
  id: string;
  patientId: string;
  patientName: string;
  suspectedDrug: string;
  reaction: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'FATAL';
  onsetDate: string;
  outcome: string;
  causalityAssessment: string;
  /** Naranjo 총점 — 평가하지 않았으면 null(0 은 '희박'이라는 다른 사실이다) */
  naranjoScore: number | null;
  kaersReportId?: string;
  reportedAt: string;
}

interface ActivityStats {
  interventions: {
    total: number;
    accepted: number;
    rejected: number;
    pending: number;
    /** 처리된(수락+거절) 중재 수 — 수락률의 분모 */
    decided?: number;
    /** 🔴 처리된 중재가 없으면 null(산출 불가) — 0% 와 다른 사실이다 */
    acceptanceRate: number | null;
    byType: Record<string, number>;
  };
  tdm: { total: number; resulted: number };
  adr: { total: number };
  asp: { total: number; approved: number };
  trend: Array<{ month: string; interventions: number; tdm: number; adr: number; asp: number }>;
}

interface AspRequest {
  id: string;
  patientId: string;
  patientName: string | null;
  antimicrobialName: string;
  indication: string;
  duration: number | null;
  durationUnit: string | null;
  status: string;
  reviewedBy?: string | null;
  reviewComment?: string | null;
  requestedAt: string;
  reviewedAt?: string | null;
}

interface ActivePrescription {
  id: string;
  dosage: string | null;
  frequency: string | null;
  route: string | null;
  medicationCode?: { nameKo?: string | null; nameEn?: string | null; code?: string | null } | null;
}

// ── Labels ──

// 라벨표는 서버 어휘와 같아야 한다 — ROUTE 가 빠져 있어 그 유형이 **빈 배지**로 떴다(2026-08-18)
// 유형 라벨·색은 의사 회신 화면(/pharmacist-replies)과 같은 정본 하나를 쓴다
const TYPE_LABEL = INTERVENTION_TYPE_LABEL;
const TYPE_COLOR = INTERVENTION_TYPE_COLOR;
// 등록 폼의 선택지도 같은 표에서 나온다 — 종전에는 select 에 ROUTE 가 없어 **서버가 받는 유형을
// 화면에서는 고를 수 없었다**(라벨은 있는데 입력이 없는 상태 = 그 유형의 중재가 영원히 0건).
const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'DOSE', label: '용량 조절' }, { value: 'INTERACTION', label: '상호작용' },
  { value: 'DUPLICATE', label: '중복 처방' }, { value: 'ROUTE', label: '투여경로' }, { value: 'OTHER', label: '기타' },
];
const STATUS_LABEL: Record<string, string> = { PENDING: '대기', ACCEPTED: '수락', REJECTED: '거절' };
const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700', ACCEPTED: 'bg-emerald-100 text-emerald-700', REJECTED: 'bg-red-100 text-red-700',
};
const TDM_STATUS: Record<string, string> = { REQUESTED: '요청', SAMPLED: '채혈', RESULTED: '결과', REVIEWED: '검토완료' };
const TDM_COLOR: Record<string, string> = {
  REQUESTED: 'bg-blue-100 text-blue-700', SAMPLED: 'bg-amber-100 text-amber-700',
  RESULTED: 'bg-emerald-100 text-emerald-700', REVIEWED: 'bg-gray-100 text-gray-600',
};
const SEVERITY_LABEL: Record<string, string> = { MILD: '경미', MODERATE: '중등', SEVERE: '중증', FATAL: '치명' };
// ADR 결과·인과관계 — 스키마 주석 실측(adverse_reaction_reports.outcome/causality_assessment). 단일 화면 도메인이라 로컬 유지.
const ADR_OUTCOME_LABEL: Record<string, string> = { RECOVERED: '회복', RECOVERING: '회복 중', NOT_RECOVERED: '미회복', FATAL: '사망', UNKNOWN: '미상' };
// 인과관계 라벨은 Naranjo 다이얼로그와 같은 정본을 쓴다(두 벌이면 같은 등급이 다르게 읽힌다)
const ADR_CAUSALITY_LABEL = NARANJO_CAUSALITY_LABEL;
const SEVERITY_COLOR: Record<string, string> = {
  MILD: 'bg-green-100 text-green-700', MODERATE: 'bg-amber-100 text-amber-700',
  SEVERE: 'bg-red-100 text-red-700', FATAL: 'bg-red-600 text-white',
};
const ASP_STATUS: Record<string, string> = { PENDING: '대기', APPROVED: '승인', REJECTED: '거절', CONDITIONAL: '조건부' };
const ASP_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700', APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700', CONDITIONAL: 'bg-blue-100 text-blue-700',
};

type TabKey = 'intervention' | 'counsel' | 'tdm' | 'asp' | 'adr' | 'dur' | 'stats';

function unwrap<T>(res: unknown): T {
  const r = res as Record<string, unknown>;
  return (r?.data ?? r) as T;
}

/** 서버가 목록을 잘랐는지 — 잘랐으면 잘랐다고 말한다(meta.truncated) */
function truncationOf(res: unknown): { truncated: boolean; limit: number } | null {
  const meta = (res as { meta?: { truncated?: boolean; limit?: number } })?.meta;
  if (!meta || typeof meta.truncated !== 'boolean') return null;
  return { truncated: meta.truncated, limit: meta.limit ?? 0 };
}

/** 잘린 목록 위에 붙는 한 줄 — 화면이 "전부"라고 말하지 않게 한다 */
function TruncationNote({ res, what }: { res: unknown; what: string }) {
  const t = truncationOf(res);
  if (!t?.truncated) return null;
  return (
    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <T k="최근" /> {t.limit}<T k="건만 표시했습니다 —" /> {what}<T k="가 더 있습니다(필터를 좁혀 주세요)." />
    </p>
  );
}

const drugLabelOf = (rx: ActivePrescription): string =>
  rx.medicationCode?.nameKo ?? rx.medicationCode?.nameEn ?? rx.medicationCode?.code ?? '품목 미기재';

// 인증 토큰 파일 다운로드(Bearer → fetch→blob)
async function adrAuthDownload(path: string, fallbackName: string) {
  const token = apiClient.getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { toast.error('다운로드 실패'); return; }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^"]+)"?/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = m ? m[1] : fallbackName; a.click();
  URL.revokeObjectURL(url);
}

export default function PharmacistActivityPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('intervention');

  // ── Modals ──
  const [showIntvModal, setShowIntvModal] = useState(false);
  const [showTdmReqModal, setShowTdmReqModal] = useState(false);
  const [showTdmResultModal, setShowTdmResultModal] = useState<string | null>(null);
  const [showAdrModal, setShowAdrModal] = useState(false);
  const [showAspModal, setShowAspModal] = useState(false);
  const [showNaranjo, setShowNaranjo] = useState(false);

  // ── Forms ──
  // 🔴 쓰기 폼의 초기값은 "미선택"이다. 종전에는 중재 유형이 `DOSE`, ADR 중증도가 `MODERATE`,
  //    결과가 `RECOVERED`, 인과관계가 `POSSIBLE` 로 시작했다 — 아무도 판단하지 않은 임상 값이
  //    저장 버튼 한 번에 원장으로 들어간다(표시보다 저장이 더 위험하다).
  const [intvForm, setIntvForm] = useState({
    patientId: '', prescriptionId: '', prescriptionDrug: '',
    type: '', reason: '', suggestion: '',
  });
  const [tdmReqForm, setTdmReqForm] = useState({
    patientId: '', drugName: '', indication: '',
    targetRangeMin: '', targetRangeMax: '', targetUnit: '',
  });
  const [tdmResultForm, setTdmResultForm] = useState({
    resultLevel: '', resultInterpretation: '', doseRecommendation: '',
  });
  // outcome/causality 는 스키마 enum 값으로 보낸다(한글 자유입력·대소문자 혼합이 섞이면 첫 등록부터 표기 2벌).
  const [adrForm, setAdrForm] = useState({
    patientId: '', patientName: '', suspectedDrug: '', reaction: '',
    severity: '', onsetDate: '', outcome: '', causalityAssessment: '',
    // Naranjo 는 계산했을 때만 채워진다 — 계산 없이 보고하면 null 로 남는다
    naranjoScore: null as number | null,
    kaersReportId: '',
  });
  // requestedBy/reviewedBy 는 서버가 인증 사용자로 채운다 — 종전 하드코딩 'dr-001'/'ph-001' 은
  // uuid 컬럼에 들어가지 못해 등록·승인 액션이 구조적으로 실패했다.
  const [aspForm, setAspForm] = useState({
    patientId: '', antimicrobialName: '', indication: '',
    duration: '', durationUnit: '',
  });

  // ── Filters ──
  // 워크리스트가 없으면 약사는 기억으로 일한다 — 회신 대기분을 서버에서 걸러 본다.
  const [intvStatus, setIntvStatus] = useState<'' | 'PENDING' | 'ACCEPTED' | 'REJECTED'>('');

  // ── Queries ──

  const { data: intvData, isLoading: intvLoading, isError: intvError, error: intvErr, refetch: intvRefetch } = useQuery({
    queryKey: ['pharmacist-interventions', intvStatus],
    queryFn: () => apiClient.get<{ data: Intervention[] }>(
      `/api/v1/pharmacist/interventions${intvStatus ? `?status=${intvStatus}` : ''}`),
    enabled: tab === 'intervention',
  });

  const { data: tdmData, isLoading: tdmLoading, isError: tdmIsError, error: tdmErr, refetch: tdmRefetch } = useQuery({
    queryKey: ['pharmacist-tdm'],
    queryFn: () => apiClient.get<{ data: TdmRequest[] }>('/api/v1/pharmacist/tdm'),
    enabled: tab === 'tdm',
  });

  const { data: adrData, isLoading: adrLoading, isError: adrIsError, error: adrErr, refetch: adrRefetch } = useQuery({
    queryKey: ['pharmacist-adr'],
    queryFn: () => apiClient.get<{ data: AdrReport[] }>('/api/v1/pharmacist/adr'),
    enabled: tab === 'adr',
  });

  const { data: aspData, isLoading: aspLoading, isError: aspIsError, error: aspErr, refetch: aspRefetch } = useQuery({
    queryKey: ['pharmacist-asp'],
    queryFn: () => apiClient.get<{ data: AspRequest[] }>('/api/v1/pharmacist/asp'),
    enabled: tab === 'asp',
  });

  const { data: statsData, isError: statsIsError, error: statsErr, refetch: statsRefetch } = useQuery({
    queryKey: ['pharmacist-stats'],
    queryFn: () => apiClient.get<{ data: ActivityStats }>('/api/v1/pharmacist/stats'),
    enabled: tab === 'stats',
  });

  // 중재 대상 처방 — 환자를 고른 뒤에만 부른다. 서버가 "그 환자의 처방인지"를 검증하므로
  // 화면도 그 환자의 활성 처방만 보여준다(엉뚱한 처방에 중재가 붙지 않게).
  const rxQuery = useQuery({
    queryKey: ['pharmacist-intv-active-rx', intvForm.patientId],
    queryFn: () => apiClient.get<{ data: ActivePrescription[] }>(
      `/api/v1/prescriptions/patient/${intvForm.patientId}/active`),
    enabled: showIntvModal && !!intvForm.patientId,
  });

  const interventions = unwrap<Intervention[]>(intvData);
  const tdmRequests = unwrap<TdmRequest[]>(tdmData);
  const adrReports = unwrap<AdrReport[]>(adrData);
  const aspRequests = unwrap<AspRequest[]>(aspData);
  const stats = unwrap<ActivityStats>(statsData);
  const activeRx = unwrap<ActivePrescription[]>(rxQuery.data) ?? [];

  // ── Mutations ──

  const [respondTarget, setRespondTarget] = useState<{ id: string; status: 'ACCEPTED' | 'REJECTED' } | null>(null);
  const [respondText, setRespondText] = useState('');
  const [aspTarget, setAspTarget] = useState<{ id: string; approve: boolean } | null>(null);
  const [aspComment, setAspComment] = useState('');

  const resetIntvForm = () => setIntvForm({ patientId: '', prescriptionId: '', prescriptionDrug: '', type: '', reason: '', suggestion: '' });

  const createIntv = useMutation({
    // 🔴 스프레드 금지 — 전역 whitelist:true 가 DTO(`CreateInterventionDto`)에 없는 키를 조용히 지운다.
    //    종전 폼은 `pharmacistId: 'ph-001'`·`pharmacistName`·`patientName` 을 함께 보내고 있었다.
    mutationFn: () => apiClient.post('/api/v1/pharmacist/interventions', {
      patientId: intvForm.patientId,
      prescriptionId: intvForm.prescriptionId || undefined,
      prescriptionDrug: intvForm.prescriptionDrug.trim() || undefined,
      type: intvForm.type,
      reason: intvForm.reason,
      suggestion: intvForm.suggestion,
    }),
    onSuccess: (res: unknown) => {
      toast.success('중재 등록 완료');
      // 🔴 처방의 알림 결과를 그대로 말한다 — 등록 성공 ≠ 처방의가 안다(처방 미연결이면 받을 사람이 없다)
      const notice = (unwrap<{ prescriberNotice?: { sent: boolean; reason: string | null } }>(res))?.prescriberNotice;
      if (notice && !notice.sent) {
        toast.warning(notice.reason === 'NO_PRESCRIPTION'
          ? tAttr('처방이 연결되지 않아 처방의에게 알림이 가지 않았습니다 — 직접 연락하세요')
          : tAttr('처방의 알림을 보내지 못했습니다 — 직접 연락하세요'));
      }
      qc.invalidateQueries({ queryKey: ['pharmacist-interventions'] });
      qc.invalidateQueries({ queryKey: ['pharmacist-stats'] });
      setShowIntvModal(false); resetIntvForm();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '중재 등록 실패'),
  });

  // 🔴 서버에 `PATCH /pharmacist/interventions/:id`(수락·거절)가 있는데 **부르는 화면이 없었다** —
  //    그래서 모든 중재가 PENDING 으로 남고 수락률은 영구히 '산출 불가'였다.
  //    EP 를 만들면 부르는 화면까지가 한 벌이다.
  const respondIntv = useMutation({
    mutationFn: ({ id, status, doctorResponse }: { id: string; status: 'ACCEPTED' | 'REJECTED'; doctorResponse?: string }) =>
      apiClient.patch(`/api/v1/pharmacist/interventions/${id}`, { status, doctorResponse }),
    onSuccess: () => {
      toast.success('중재 회신이 기록되었습니다');
      qc.invalidateQueries({ queryKey: ['pharmacist-interventions'] });
      qc.invalidateQueries({ queryKey: ['pharmacist-stats'] });
      setRespondTarget(null);
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '중재 회신 실패'),
  });

  const createTdm = useMutation({
    mutationFn: () => apiClient.post('/api/v1/pharmacist/tdm', {
      patientId: tdmReqForm.patientId,
      drugName: tdmReqForm.drugName,
      indication: tdmReqForm.indication.trim() || undefined,
      // 🔴 빈 목표범위를 `Number('') = 0` 으로 보내면 서버가 **실제 목표 0** 으로 저장한다 — 미입력은 보내지 않는다
      targetRangeMin: tdmReqForm.targetRangeMin === '' ? undefined : Number(tdmReqForm.targetRangeMin),
      targetRangeMax: tdmReqForm.targetRangeMax === '' ? undefined : Number(tdmReqForm.targetRangeMax),
      targetUnit: tdmReqForm.targetUnit || undefined,
    }),
    onSuccess: () => {
      toast.success('TDM 요청 등록 완료');
      qc.invalidateQueries({ queryKey: ['pharmacist-tdm'] });
      setShowTdmReqModal(false);
      setTdmReqForm({ patientId: '', drugName: '', indication: '', targetRangeMin: '', targetRangeMax: '', targetUnit: '' });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? 'TDM 요청 실패'),
  });

  const recordTdmResult = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient.patch(`/api/v1/pharmacist/tdm/${id}/result`, {
        resultLevel: Number(tdmResultForm.resultLevel),
        resultInterpretation: tdmResultForm.resultInterpretation,
        doseRecommendation: tdmResultForm.doseRecommendation.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('TDM 결과 입력 완료');
      qc.invalidateQueries({ queryKey: ['pharmacist-tdm'] });
      setShowTdmResultModal(null);
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? 'TDM 결과 입력 실패'),
  });

  const createAdr = useMutation({
    mutationFn: () => apiClient.post('/api/v1/pharmacist/adr', {
      patientId: adrForm.patientId,
      patientName: adrForm.patientName || undefined,
      suspectedDrug: adrForm.suspectedDrug,
      reaction: adrForm.reaction,
      severity: adrForm.severity,
      onsetDate: adrForm.onsetDate,
      outcome: adrForm.outcome,
      causalityAssessment: adrForm.causalityAssessment,
      // 계산하지 않았으면 보내지 않는다 — Naranjo 0 은 '희박'이라는 임상 판정이다
      naranjoScore: adrForm.naranjoScore ?? undefined,
      kaersReportId: adrForm.kaersReportId.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('ADR 보고 완료');
      qc.invalidateQueries({ queryKey: ['pharmacist-adr'] });
      setShowAdrModal(false);
      setAdrForm({ patientId: '', patientName: '', suspectedDrug: '', reaction: '', severity: '', onsetDate: '', outcome: '', causalityAssessment: '', naranjoScore: null, kaersReportId: '' });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? 'ADR 보고 실패'),
  });

  const createAsp = useMutation({
    mutationFn: () => apiClient.post('/api/v1/pharmacist/asp', {
      patientId: aspForm.patientId,
      antimicrobialName: aspForm.antimicrobialName,
      indication: aspForm.indication,
      // 기간을 안 적었으면 보내지 않는다(0일은 다른 사실이다)
      duration: aspForm.duration.trim() === '' ? undefined : Number(aspForm.duration),
      durationUnit: aspForm.durationUnit || undefined,
    }),
    onSuccess: () => {
      toast.success('ASP 요청 등록 완료');
      qc.invalidateQueries({ queryKey: ['pharmacist-asp'] });
      setShowAspModal(false);
      setAspForm({ patientId: '', antimicrobialName: '', indication: '', duration: '', durationUnit: '' });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? 'ASP 요청 실패'),
  });

  // 🔴 종전 화면은 승인·거절 버튼에 `comment: '승인'` / `'부적절'` 을 하드코딩해 보냈다 —
  //    **아무도 쓰지 않은 문장이 항생제 승인 기록의 검토 의견으로 남았다**(화면이 값을 지어내지 않는다).
  //    이제 사람이 쓴 것만 보내고, 비었으면 필드를 아예 보내지 않는다.
  const handleAsp = useMutation({
    mutationFn: ({ id, approve, comment }: { id: string; approve: boolean; comment: string }) =>
      apiClient.patch(`/api/v1/pharmacist/asp/${id}`, {
        approve,
        reviewComment: comment.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('ASP 처리 완료');
      qc.invalidateQueries({ queryKey: ['pharmacist-asp'] });
      qc.invalidateQueries({ queryKey: ['pharmacist-stats'] });
      setAspTarget(null);
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? 'ASP 처리 실패'),
  });

  // ── Skeleton ──
  const Skeleton = ({ rows = 3, cols = 8 }: { rows?: number; cols?: number }) => (
    <>{Array.from({ length: rows }).map((_, i) => (
      <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
    ))}</>
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'intervention', label: '처방 중재' },
    { key: 'counsel', label: '복약상담' },
    { key: 'tdm', label: 'TDM 관리' },
    { key: 'asp', label: '항생제 스튜어드십' },
    { key: 'adr', label: '부작용 보고' },
    // DUR 경고 무시 사유 — 처방에 남기만 하고 아무 화면도 모아 보여주지 않았다(읽기 전용 검토 목록)
    { key: 'dur', label: 'DUR 무시 기록' },
    { key: 'stats', label: '통계' },
  ];

  return (
    <div>
      <PageHeader title={tAttr('약사 임상활동')} />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit flex-wrap">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* ══════ 처방 중재 ══════ */}
      {tab === 'intervention' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-1 bg-gray-100/80 p-1 rounded-xl">
              {([['', '전체'], ['PENDING', '회신 대기'], ['ACCEPTED', '수락'], ['REJECTED', '거절']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setIntvStatus(v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg ${intvStatus === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={() => { setShowIntvModal(true); resetIntvForm(); }}
              className="min-h-[44px] px-4 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700"><T k="+ 중재 등록" /></button>
          </div>

          {intvError ? <QueryErrorFallback error={intvErr} onRetry={intvRefetch} /> : (
            <>
              <TruncationNote res={intvData} what={tAttr('중재 기록')} />
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="유형" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처방약" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="책임 처방의" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="사유" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="제안" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[90px]"><T k="일시" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[150px]"><T k="회신" /></th>
                  </tr></thead>
                  <tbody>
                    {intvLoading ? <Skeleton /> : !interventions?.length ? (
                      <tr><td colSpan={9} className="py-12 text-center text-gray-400">
                        {intvStatus
                          ? <><T k={STATUS_LABEL[intvStatus]} /> <T k="상태의 중재 기록 없음" /></>
                          : <T k="중재 기록 없음" />}
                      </td></tr>
                    ) : interventions.map((intv: Intervention) => (
                      <tr key={intv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TYPE_COLOR[intv.type] ?? ''}`}><T k={TYPE_LABEL[intv.type] ?? intv.type} /></span></td>
                        {/* 이름을 모르면 그렇게 말한다 — 빈칸은 "이름이 없는 환자"로 읽힌다 */}
                        <td className="px-4 py-3 text-xs text-gray-900 font-medium">{intv.patientName ?? <span className="text-gray-400"><T k="이름 미상" /></span>}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{intv.prescriptionDrug ?? <span className="text-gray-300"><T k="미기재" /></span>}</td>
                        {/* 🔴 회신할 사람 — 처방이 연결되지 않으면 모른다(알림도 가지 않았다). 빈칸이 아니라 그 사실을 말한다 */}
                        <td className="px-4 py-3 text-xs text-gray-700">
                          {intv.prescriberId
                            ? (intv.prescriberName ?? <span className="text-gray-400"><T k="이름 미상" /></span>)
                            : <span className="text-amber-600" title={tAttr('처방이 연결되지 않아 회신할 의사를 알 수 없습니다 — 알림도 가지 않았습니다')}><T k="처방 미연결" /></span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate" title={intv.reason}>{intv.reason}</td>
                        <td className="px-4 py-3 text-xs text-blue-600 max-w-[200px] truncate" title={intv.suggestion}>{intv.suggestion}</td>
                        <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[intv.status] ?? ''}`}><T k={STATUS_LABEL[intv.status] ?? intv.status} /></span></td>
                        <td className="px-4 py-3 text-[10px] text-gray-400"><KDate value={intv.createdAt} mode="datetime" /></td>
                        <td className="px-4 py-3">
                          {intv.status === 'PENDING' ? (
                            <div className="flex gap-1">
                              <button onClick={() => { setRespondTarget({ id: intv.id, status: 'ACCEPTED' }); setRespondText(''); }}
                                className="text-[11px] font-bold px-2.5 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap"><T k="수락" /></button>
                              <button onClick={() => { setRespondTarget({ id: intv.id, status: 'REJECTED' }); setRespondText(''); }}
                                className="text-[11px] font-bold px-2.5 py-2 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 whitespace-nowrap"><T k="거절" /></button>
                            </div>
                          ) : (
                            <div className="text-[10px] text-gray-500 space-y-0.5">
                              <p className="truncate max-w-[140px]" title={intv.doctorResponse ?? undefined}>{intv.doctorResponse ?? '회신 내용 없음'}</p>
                              {/* 🔴 누가 회신을 기록했는지 밝힌다 — 약사가 대리 입력했는지 의사가 직접 눌렀는지는 다른 사실이다 */}
                              <p className="text-gray-400"><T k="기록" /> <KDate value={intv.respondedAt} mode="datetime" unknown="UNRECORDED" /></p>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════ DUR 무시 기록(읽기 전용) ══════ */}
      {tab === 'dur' && <DurOverrideList />}

      {/* ══════ 복약상담 ══════ */}
      {tab === 'counsel' && <CounselTab />}

      {/* ══════ TDM 관리 ══════ */}
      {tab === 'tdm' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900"><T k="TDM (약물농도모니터링)" /></h3>
            <button onClick={() => setShowTdmReqModal(true)}
              className="min-h-[44px] px-4 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700"><T k="+ TDM 요청" /></button>
          </div>
          {tdmIsError ? <QueryErrorFallback error={tdmErr} onRetry={tdmRefetch} /> : (
            <>
              <TruncationNote res={tdmData} what={tAttr('TDM 요청')} />
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                <table className="w-full text-sm min-w-[800px]">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="약물" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="적응증" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[120px]"><T k="목표범위" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[120px]"><T k="결과" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="조작" /></th>
                  </tr></thead>
                  <tbody>
                    {tdmLoading ? <Skeleton cols={7} /> : !tdmRequests?.length ? (
                      <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="TDM 요청 없음" /></td></tr>
                    ) : tdmRequests.map((tdm: TdmRequest) => {
                      // 🔴 목표범위가 없으면 **판정하지 않는다**. 종전 코드는 null 을 0 으로 강등해
                      //    `level >= 0 && level <= 0` 이 되어, 목표를 정하지 않은 요청의 모든 결과가
                      //    빨간 "범위 밖"으로 떴다(조건식에서 미측정을 폴백하지 않는다).
                      const hasTarget = tdm.targetRangeMin != null && tdm.targetRangeMax != null;
                      const inRange = hasTarget && tdm.resultLevel != null
                        ? tdm.resultLevel >= (tdm.targetRangeMin as number) && tdm.resultLevel <= (tdm.targetRangeMax as number)
                        : null;
                      return (
                        <tr key={tdm.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs text-gray-900 font-medium">{tdm.patientName ?? <span className="text-gray-400"><T k="이름 미상" /></span>}</td>
                          <td className="px-4 py-3 text-xs text-gray-700 font-medium">{tdm.drugName}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{tdm.indication ?? <span className="text-gray-300">-</span>}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {hasTarget ? `${tdm.targetRangeMin}-${tdm.targetRangeMax} ${tdm.targetUnit ?? ''}`.trim()
                              : <span className="text-gray-400"><T k="목표범위 미설정" /></span>}
                          </td>
                          <td className="px-4 py-3 text-xs font-medium">
                            {tdm.resultLevel == null ? <span className="text-gray-300">-</span> : (
                              <span className={inRange === null ? 'text-gray-700' : inRange ? 'text-emerald-600' : 'text-red-600'}
                                title={inRange === null ? '목표범위가 없어 범위 내/밖을 판정할 수 없습니다' : undefined}>
                                {tdm.resultLevel} {tdm.targetUnit ?? ''}
                                {inRange === null && <span className="ml-1 text-[10px] text-gray-400"><T k="(판정 불가)" /></span>}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TDM_COLOR[tdm.status] ?? ''}`}>{TDM_STATUS[tdm.status] ?? tdm.status}</span></td>
                          <td className="px-4 py-3">
                            {(tdm.status === 'REQUESTED' || tdm.status === 'SAMPLED') && (
                              <button onClick={() => { setShowTdmResultModal(tdm.id); setTdmResultForm({ resultLevel: '', resultInterpretation: '', doseRecommendation: '' }); }}
                                className="text-[11px] text-blue-600 hover:underline font-medium min-h-[44px]"><T k="결과입력" /></button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════ ASP ══════ */}
      {tab === 'asp' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900"><T k="ASP (항생제 스튜어드십)" /></h3>
            <button onClick={() => setShowAspModal(true)}
              className="min-h-[44px] px-4 bg-violet-600 text-white text-sm font-medium rounded-xl hover:bg-violet-700"><T k="+ ASP 요청" /></button>
          </div>
          {aspIsError ? <QueryErrorFallback error={aspErr} onRetry={aspRefetch} /> : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="항생제" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="적응증" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="기간" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검토 의견" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[110px]"><T k="조작" /></th>
                </tr></thead>
                <tbody>
                  {aspLoading ? <Skeleton cols={7} /> : !aspRequests?.length ? (
                    <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="ASP 요청 없음" /></td></tr>
                  ) : aspRequests.map((asp: AspRequest) => (
                    <tr key={asp.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs text-gray-900 font-medium">{asp.patientName ?? <span className="text-gray-400"><T k="이름 미상" /></span>}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{asp.antimicrobialName}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{asp.indication}</td>
                      {/* 기간이 없으면 '0일'이 아니라 미기재다 */}
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {asp.duration == null ? <span className="text-gray-300"><T k="미기재" /></span>
                          : `${asp.duration}${asp.durationUnit === 'days' ? '일' : asp.durationUnit === 'hours' ? '시간' : (asp.durationUnit ?? '')}`}
                      </td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${ASP_COLOR[asp.status] ?? ''}`}>{ASP_STATUS[asp.status] ?? asp.status}</span></td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[220px] truncate" title={asp.reviewComment ?? undefined}>
                        {asp.reviewComment ?? (asp.status === 'PENDING' ? <span className="text-gray-300"><T k="미검토" /></span> : <span className="text-gray-300"><T k="의견 없음" /></span>)}
                      </td>
                      <td className="px-4 py-3">
                        {asp.status === 'PENDING' && (
                          <div className="flex gap-1">
                            <button onClick={() => { setAspTarget({ id: asp.id, approve: true }); setAspComment(''); }}
                              className="text-[11px] px-2.5 py-2 bg-emerald-100 text-emerald-700 rounded-lg font-medium hover:bg-emerald-200"><T k="승인" /></button>
                            <button onClick={() => { setAspTarget({ id: asp.id, approve: false }); setAspComment(''); }}
                              className="text-[11px] px-2.5 py-2 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200"><T k="거절" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════ 부작용 보고 ══════ */}
      {tab === 'adr' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAdrModal(true)}
              className="min-h-[44px] px-4 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700"><T k="+ ADR 보고" /></button>
          </div>
          {adrIsError ? <QueryErrorFallback error={adrErr} onRetry={adrRefetch} /> : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="의심약물" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="이상반응" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="중증도" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="결과" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[110px]"><T k="인과관계" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]">Naranjo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]">KAERS</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[110px]"><T k="보고일" /></th>
                </tr></thead>
                <tbody>
                  {adrLoading ? <Skeleton cols={9} /> : !adrReports?.length ? (
                    <tr><td colSpan={9} className="py-12 text-center text-gray-400"><T k="ADR 보고 없음" /></td></tr>
                  ) : adrReports.map((adr: AdrReport) => (
                    <tr key={adr.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs text-gray-900 font-medium">{adr.patientName}</td>
                      <td className="px-4 py-3 text-xs text-gray-700 font-medium">{adr.suspectedDrug}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{adr.reaction}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SEVERITY_COLOR[adr.severity] ?? ''}`}><T k={SEVERITY_LABEL[adr.severity] ?? adr.severity} /></span></td>
                      <td className="px-4 py-3 text-xs text-gray-500"><T k={ADR_OUTCOME_LABEL[adr.outcome] ?? adr.outcome} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500"><T k={ADR_CAUSALITY_LABEL[adr.causalityAssessment] ?? adr.causalityAssessment} /></td>
                      {/* 🔴 Naranjo 미평가는 0 점이 아니다 — 평가하지 않았다고 말한다 */}
                      <td className="px-4 py-3 text-xs text-gray-600">{adr.naranjoScore != null ? `${adr.naranjoScore}점` : <span className="text-gray-400"><T k="미평가" /></span>}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-400">{adr.kaersReportId ?? '-'}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-400 whitespace-nowrap">
                        <KDate value={adr.reportedAt} />
                        <button onClick={() => adrAuthDownload(`/api/v1/pharmacy/adr/${adr.id}/e2b`, `E2B-${adr.id.slice(0, 8)}.xml`)} className="ml-2 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100">E2B</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════ 통계 ══════ */}
      {tab === 'stats' && (
        statsIsError ? <QueryErrorFallback error={statsErr} onRetry={statsRefetch} />
          : !stats ? <EmptyState title="통계를 불러오는 중입니다" hint="집계가 오면 여기에 표시됩니다" />
          : (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard title={tAttr('총 중재')} value={stats.interventions?.total ?? 0} color="gray" />
            {/* 🔴 서버는 처리된 중재가 없으면 `acceptanceRate: null`(산출 불가)을 준다 —
                이를 `?? 0` 으로 접으면 "의사가 약사 중재를 하나도 안 받는다"는 **다른 사실**이 된다 */}
            {/* 🔴 비율은 분모와 함께(§3.3) — 분모는 '처리된(수락+거절) 중재'다.
                정본 `<Ratio>` 가 처리 0건이면 '산출 불가'를 그리므로 자체 삼항을 두지 않는다. */}
            <StatCard
              title={tAttr('수락률')}
              value={<Ratio
                numerator={stats.interventions?.accepted}
                denominator={stats.interventions?.decided}
                unavailableHint="처리된 중재 없음"
              />}
              color="emerald"
              subtitle={tAttr('분모 = 처리된(수락+거절) 중재')}
            />
            <StatCard title={tAttr('회신 대기')} value={stats.interventions?.pending ?? 0} color="amber" subtitle={tAttr('아직 수락·거절이 없는 중재')} />
            <StatCard title="TDM" value={stats.tdm?.total ?? 0} color="blue" subtitle={`/ ${stats.tdm?.resulted ?? 0} 완료`} />
            <StatCard title={tAttr('ADR 보고')} value={stats.adr?.total ?? 0} color="red" />
          </div>

          {/* By Type */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="중재 유형별 현황" /></h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {Object.entries(stats.interventions?.byType ?? {}).map(([type, count]) => (
                <div key={type} className="text-center p-3 rounded-xl bg-gray-50">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLOR[type] ?? 'bg-gray-100'}`}><T k={TYPE_LABEL[type] ?? type} /></span>
                  <p className="text-xl font-bold text-gray-900 mt-2">{count as number}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Trend */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="월별 추이" /></h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100">
                  <th className="px-3 py-2 text-left text-xs text-gray-500"><T k="월" /></th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500"><T k="중재" /></th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500">TDM</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500">ADR</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500">ASP</th>
                </tr></thead>
                <tbody>
                  {(stats.trend ?? []).map((row) => (
                    <tr key={row.month} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-xs font-medium text-gray-700">{row.month}</td>
                      <td className="px-3 py-2 text-center text-xs text-gray-900 font-medium">{row.interventions}</td>
                      <td className="px-3 py-2 text-center text-xs text-blue-600">{row.tdm}</td>
                      <td className="px-3 py-2 text-center text-xs text-red-600">{row.adr}</td>
                      <td className="px-3 py-2 text-center text-xs text-violet-600">{row.asp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        )
      )}

      {/* ══════ Modals ══════ */}

      {/* 중재 등록 모달 */}
      {showIntvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowIntvModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="처방 중재 등록" /></h3>
            <div className="space-y-3">
              {/* 🔴 종전에는 "환자 ID *" 자유 입력(placeholder `pt-001`)이었다. 서버는 UUID 를
                  요구하므로 **아무도 이 폼을 통과할 수 없었고**, 그래서 운영 중재 기록이 0행이었다.
                  ("데이터 0행"을 믿기 전에 쓰기 경로를 눌러본다) */}
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자 *" /></label>
                <PatientSelector value={intvForm.patientId}
                  onChange={(id) => setIntvForm(f => ({ ...f, patientId: id, prescriptionId: '', prescriptionDrug: '' }))}
                  context="order" placeholder={tAttr('환자 검색 (이름·MRN·전화번호)')} /></div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="대상 처방 (선택)" /></label>
                {!intvForm.patientId ? (
                  <p className="text-xs text-gray-400 py-2"><T k="환자를 먼저 선택하세요" /></p>
                ) : rxQuery.isError ? (
                  <QueryErrorFallback error={rxQuery.error} onRetry={rxQuery.refetch} size="compact" />
                ) : rxQuery.isLoading ? (
                  <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
                ) : activeRx.length === 0 ? (
                  <p className="text-xs text-gray-500 py-2"><T k="활성 처방이 없습니다 — 아래에 대상 약물을 직접 적어 주세요." /></p>
                ) : (
                  <select value={intvForm.prescriptionId}
                    onChange={e => {
                      const rx = activeRx.find(r => r.id === e.target.value);
                      setIntvForm(f => ({
                        ...f,
                        prescriptionId: e.target.value,
                        // 처방을 고르면 약물 표기를 채운다 — 사람이 고쳐 쓸 수 있다
                        prescriptionDrug: rx ? drugLabelOf(rx) : f.prescriptionDrug,
                      }));
                    }}
                    className="w-full border rounded-xl px-3 py-2 text-sm">
                    <option value="">{tAttr('처방과 연결하지 않음')}</option>
                    {activeRx.map(rx => (
                      <option key={rx.id} value={rx.id}>
                        {[drugLabelOf(rx), rx.dosage, rx.frequency, rx.route].filter(Boolean).join(' · ')}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="중재 대상 약물 *" /></label>
                <input value={intvForm.prescriptionDrug} onChange={e => setIntvForm(f => ({ ...f, prescriptionDrug: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm" />
                <p className="text-[11px] text-gray-400 mt-1"><T k="처방이 삭제돼도 남는 기록입니다" /></p></div>

              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="중재 유형 *" /></label>
                <select value={intvForm.type} onChange={e => setIntvForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">{tAttr('선택하세요')}</option>
                  {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{tAttr(o.label)}</option>)}
                </select></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="사유 *" /></label>
                <textarea value={intvForm.reason} onChange={e => setIntvForm(f => ({ ...f, reason: e.target.value }))} rows={2} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="제안 *" /></label>
                <textarea value={intvForm.suggestion} onChange={e => setIntvForm(f => ({ ...f, suggestion: e.target.value }))} rows={2} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createIntv.mutate()}
                disabled={createIntv.isPending || !intvForm.patientId || !intvForm.type || !intvForm.prescriptionDrug.trim() || !intvForm.reason.trim() || !intvForm.suggestion.trim()}
                className="flex-1 min-h-[44px] bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
                <T k={createIntv.isPending ? '등록 중...' : '등록'} /></button>
              <button onClick={() => setShowIntvModal(false)} className="px-4 min-h-[44px] bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* TDM 요청 모달 */}
      {showTdmReqModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowTdmReqModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="TDM 요청" /></h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자 *" /></label>
                <PatientSelector value={tdmReqForm.patientId} onChange={(id) => setTdmReqForm(f => ({ ...f, patientId: id }))}
                  context="lab" placeholder={tAttr('환자 검색 (이름·MRN·전화번호)')} /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="약물 *" /></label>
                <input value={tdmReqForm.drugName} onChange={e => setTdmReqForm(f => ({ ...f, drugName: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="적응증" /></label>
                <input value={tdmReqForm.indication} onChange={e => setTdmReqForm(f => ({ ...f, indication: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="목표 최소" /></label>
                <input value={tdmReqForm.targetRangeMin} onChange={e => setTdmReqForm(f => ({ ...f, targetRangeMin: e.target.value }))} type="number" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="목표 최대" /></label>
                <input value={tdmReqForm.targetRangeMax} onChange={e => setTdmReqForm(f => ({ ...f, targetRangeMax: e.target.value }))} type="number" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1"><T k="단위" /></label>
                {/* 🔴 단위는 약물마다 다르다 — 화면이 mcg/mL 을 골라 두면 ng/mL 약물의 목표가 1000배 어긋난다 */}
                <select value={tdmReqForm.targetUnit} onChange={e => setTdmReqForm(f => ({ ...f, targetUnit: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">{tAttr('선택하세요')}</option>
                  <option value="mcg/mL">mcg/mL</option><option value="ng/mL">ng/mL</option><option value="mg/L">mg/L</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1"><T k="목표범위를 비워 두면 결과의 범위 내/밖을 판정하지 않습니다" /></p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createTdm.mutate()}
                disabled={createTdm.isPending || !tdmReqForm.patientId || !tdmReqForm.drugName.trim()}
                className="flex-1 min-h-[44px] bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
                <T k={createTdm.isPending ? '요청 중...' : 'TDM 요청'} /></button>
              <button onClick={() => setShowTdmReqModal(false)} className="px-4 min-h-[44px] bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* TDM 결과 입력 모달 */}
      {showTdmResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowTdmResultModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="TDM 결과 입력" /></h3>
            <div className="space-y-3">
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="측정 농도 *" /></label>
                <input value={tdmResultForm.resultLevel} onChange={e => setTdmResultForm(f => ({ ...f, resultLevel: e.target.value }))} type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="해석 *" /></label>
                <textarea value={tdmResultForm.resultInterpretation} onChange={e => setTdmResultForm(f => ({ ...f, resultInterpretation: e.target.value }))} rows={2} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="용량 권고" /></label>
                <textarea value={tdmResultForm.doseRecommendation} onChange={e => setTdmResultForm(f => ({ ...f, doseRecommendation: e.target.value }))} rows={2} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => recordTdmResult.mutate({ id: showTdmResultModal })}
                disabled={recordTdmResult.isPending || tdmResultForm.resultLevel.trim() === '' || !tdmResultForm.resultInterpretation.trim()}
                className="flex-1 min-h-[44px] bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50">
                <T k={recordTdmResult.isPending ? '저장 중...' : '결과 저장'} /></button>
              <button onClick={() => setShowTdmResultModal(null)} className="px-4 min-h-[44px] bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* ADR 보고 모달 */}
      {showAdrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAdrModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="약물이상반응(ADR) 보고" /></h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자 *" /></label>
                <PatientSelector value={adrForm.patientId}
                  onChange={(id, p) => setAdrForm(f => ({ ...f, patientId: id, patientName: `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim() }))}
                  placeholder={tAttr('환자 검색 (이름·MRN·전화번호)')} /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="의심약물 *" /></label>
                <input value={adrForm.suspectedDrug} onChange={e => setAdrForm(f => ({ ...f, suspectedDrug: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="중증도 *" /></label>
                <select value={adrForm.severity} onChange={e => setAdrForm(f => ({ ...f, severity: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">{tAttr('선택하세요')}</option>
                  {Object.entries(SEVERITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1"><T k="이상반응 *" /></label>
                <textarea value={adrForm.reaction} onChange={e => setAdrForm(f => ({ ...f, reaction: e.target.value }))} rows={2} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="발생일 *" /></label>
                <input value={adrForm.onsetDate} onChange={e => setAdrForm(f => ({ ...f, onsetDate: e.target.value }))} type="date" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="결과 *" /></label>
                <select value={adrForm.outcome} onChange={e => setAdrForm(f => ({ ...f, outcome: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">{tAttr('선택하세요')}</option>
                  {Object.entries(ADR_OUTCOME_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>

              <div className="col-span-2 p-3 rounded-xl bg-gray-50 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-gray-600"><T k="인과관계 평가 *" /></label>
                  {/* 🔴 Naranjo EP 는 개통 이래 부르는 화면이 없었다 — 인과관계는 감으로 고른 값이었다 */}
                  <button type="button" onClick={() => setShowNaranjo(true)}
                    className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"><T k="Naranjo 로 계산" /></button>
                </div>
                <select value={adrForm.causalityAssessment} onChange={e => setAdrForm(f => ({ ...f, causalityAssessment: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">{tAttr('선택하세요')}</option>
                  {Object.entries(ADR_CAUSALITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <p className="text-[11px] text-gray-500">
                  {adrForm.naranjoScore != null
                    ? `Naranjo ${adrForm.naranjoScore}점이 이 보고에 함께 저장됩니다`
                    : 'Naranjo 를 계산하지 않으면 점수 없이(미평가) 저장됩니다'}
                </p>
              </div>

              <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1"><T k="KAERS 보고번호" /></label>
                <input value={adrForm.kaersReportId} onChange={e => setAdrForm(f => ({ ...f, kaersReportId: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" />
                <p className="text-[11px] text-gray-400 mt-1"><T k="기관에 접수해 번호를 받았을 때만 적습니다 — 이 화면은 기관으로 전송하지 않습니다" /></p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createAdr.mutate()}
                disabled={createAdr.isPending || !adrForm.patientId || !adrForm.suspectedDrug.trim() || !adrForm.reaction.trim() || !adrForm.severity || !adrForm.onsetDate || !adrForm.outcome || !adrForm.causalityAssessment}
                className="flex-1 min-h-[44px] bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 disabled:opacity-50">
                <T k={createAdr.isPending ? '보고 중...' : 'ADR 보고'} /></button>
              <button onClick={() => setShowAdrModal(false)} className="px-4 min-h-[44px] bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Naranjo 계산기 */}
      {showNaranjo && (
        <NaranjoDialog
          onClose={() => setShowNaranjo(false)}
          onApply={(r: NaranjoResult) => {
            setAdrForm(f => ({ ...f, causalityAssessment: r.causality, naranjoScore: r.score }));
            setShowNaranjo(false);
            toast.success(`Naranjo ${r.score}점 · ${NARANJO_CAUSALITY_LABEL[r.causality] ?? r.causality} 적용`);
          }}
        />
      )}

      {/* ASP 요청 모달 */}
      {showAspModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAspModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="ASP 승인 요청" /></h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자 *" /></label>
                <PatientSelector value={aspForm.patientId} onChange={(id) => setAspForm(f => ({ ...f, patientId: id }))}
                  context="order" placeholder={tAttr('환자 검색 (이름·MRN·전화번호)')} /></div>
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1"><T k="항생제 *" /></label>
                <input value={aspForm.antimicrobialName} onChange={e => setAspForm(f => ({ ...f, antimicrobialName: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1"><T k="적응증 *" /></label>
                <input value={aspForm.indication} onChange={e => setAspForm(f => ({ ...f, indication: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="사용기간" /></label>
                <input value={aspForm.duration} onChange={e => setAspForm(f => ({ ...f, duration: e.target.value }))} type="number" min={1} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="단위" /></label>
                <select value={aspForm.durationUnit} onChange={e => setAspForm(f => ({ ...f, durationUnit: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">{tAttr('선택하세요')}</option>
                  <option value="days">{tAttr('일')}</option><option value="hours">{tAttr('시간')}</option>
                </select></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createAsp.mutate()}
                disabled={createAsp.isPending || !aspForm.patientId || !aspForm.antimicrobialName.trim() || !aspForm.indication.trim()}
                className="flex-1 min-h-[44px] bg-violet-600 text-white text-sm font-medium rounded-xl hover:bg-violet-700 disabled:opacity-50">
                <T k={createAsp.isPending ? '요청 중...' : 'ASP 요청'} /></button>
              <button onClick={() => setShowAspModal(false)} className="px-4 min-h-[44px] bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* ASP 검토 — 승인·거절 의견은 사람이 쓴 것만 남는다 */}
      {aspTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900"><T k="항생제" /> <T k={aspTarget.approve ? '승인' : '거절'} /></h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                <T k="검토 의견" />{!aspTarget.approve && <span className="text-gray-400"> <T k="· 거절 사유를 남기면 처방의가 대안을 찾을 수 있다" /></span>}
              </label>
              <textarea rows={3} value={aspComment} onChange={(e) => setAspComment(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm resize-none" />
              <p className="text-[11px] text-gray-400 mt-1"><T k="비워 두면 의견 없이 기록됩니다(문구를 대신 채우지 않습니다)" /></p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleAsp.mutate({ id: aspTarget.id, approve: aspTarget.approve, comment: aspComment })}
                disabled={handleAsp.isPending}
                className={`flex-1 min-h-[44px] text-white text-sm font-medium rounded-xl disabled:opacity-50 ${aspTarget.approve ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-700 hover:bg-gray-800'}`}>
                <T k={handleAsp.isPending ? '기록 중...' : aspTarget.approve ? '승인 기록' : '거절 기록'} />
              </button>
              <button onClick={() => setAspTarget(null)} className="px-4 min-h-[44px] bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 중재 회신 — 수락/거절과 사유를 기록한다(회신이 없으면 수락률을 산출할 수 없다) */}
      {respondTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              <T k="약사 중재" /> <T k={respondTarget.status === 'ACCEPTED' ? '수락' : '거절'} />
            </h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                <T k="회신 내용" />{respondTarget.status === 'REJECTED' && <span className="text-gray-400"> <T k="· 거절 사유를 남기면 다음 중재가 정확해진다" /></span>}
              </label>
              <textarea rows={3} value={respondText} onChange={(e) => setRespondText(e.target.value)}
                placeholder={respondTarget.status === 'ACCEPTED' ? '예: 동의합니다. 감량 처방하겠습니다.' : '예: 의도적 처방입니다(전환 예정).'}
                className="w-full border rounded-xl px-3 py-2 text-sm resize-none" />
              {/* 🔴 화면이 갖지 않은 권한을 가진 척하지 않는다 — 기록 주체는 지금 로그인한 사람이다 */}
              <p className="text-[11px] text-gray-400 mt-1"><T k="회신자는 지금 로그인한 사용자로 기록됩니다(구두 회신을 대신 적었다면 내용에 밝혀 주세요)" /></p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => respondIntv.mutate({ id: respondTarget.id, status: respondTarget.status, doctorResponse: respondText.trim() || undefined })}
                disabled={respondIntv.isPending}
                className={`flex-1 min-h-[44px] text-white text-sm font-medium rounded-xl disabled:opacity-50 ${respondTarget.status === 'ACCEPTED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-700 hover:bg-gray-800'}`}>
                <T k={respondIntv.isPending ? '기록 중...' : respondTarget.status === 'ACCEPTED' ? '수락 기록' : '거절 기록'} />
              </button>
              <button onClick={() => setRespondTarget(null)} className="px-4 min-h-[44px] bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
