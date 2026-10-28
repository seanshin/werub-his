'use client';

import { use, useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { SmartAppLauncher } from '@/components/smart-launch/SmartAppLauncher';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePatient, usePatientHistory } from '@/hooks/usePatients';
import { usePatientEncounters } from '@/hooks/useEncounters';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useAuthStore } from '@/stores/auth-store';
import { tabCapability } from '@/lib/capabilities';
import { ClinicalSideRail } from './components/NurseSideRail';
import { usePatientTabStore } from '@/stores/patient-tab-store';
import type { PatientContact } from '@/types/patient';
import dynamic from 'next/dynamic';
import {
  PatientHeader,
  PatientSafetyBar,
  BoardHeaderBar,
  OverviewTab,
  EditPatientModal,
  DeceasedModal,
  IdentifyPatientModal,
} from './components';
const TabSettingsModal = dynamic(() => import('./components/TabSettingsModal'));
import { PatientLocQrButton } from './components/PatientLocQrButton';
import { ArrivalNotesPanel } from './components/ArrivalNotesPanel';
import { PatientEducationPanel } from '@/components/patient-education/PatientEducationPanel';
import type { EncounterListItem, BillingWithRelations, HistoryEntry } from './components';
import { CapabilityBadge } from '@/components/ui/display';
import { ChartSearchPanel } from './components/ChartSearchPanel';
import { PatientChartPrint } from './components/PatientChartPrint';
import { T } from '@/components/ui/i18n-text';
import { AI_ORIGIN_TEXT, ageOf } from '@hospital-run/shared';
import { twinCdsView, type TwinCdsResponse } from '@/lib/twin-cds';
import { useAiAssistantContext } from '@/components/ai/use-ai-assistant-context';

// Lazy-loaded tabs — 초기 번들 최소화
const ProblemListTab = dynamic(() => import('./components').then(m => ({ default: m.ProblemListTab })));
const AllergyTab = dynamic(() => import('./components').then(m => ({ default: m.AllergyTab })));
const LabResultsTab = dynamic(() => import('./components').then(m => ({ default: m.LabResultsTab })));
const ImagingTab = dynamic(() => import('./components').then(m => ({ default: m.ImagingTab })));
const EncounterHistoryTab = dynamic(() => import('./components').then(m => ({ default: m.EncounterHistoryTab })));
const BillingTab = dynamic(() => import('./components').then(m => ({ default: m.BillingTab })));
const ConsentTab = dynamic(() => import('./components').then(m => ({ default: m.ConsentTab })));
const JourneyTab = dynamic(() => import('./components').then(m => ({ default: m.JourneyTab })));
const RecordTimelineView = dynamic(() => import('@/components/record-timeline/RecordTimelineView').then(m => ({ default: m.RecordTimelineView })));
const TreatmentScheduleTab = dynamic(() => import('./components').then(m => ({ default: m.TreatmentScheduleTab })));
const PreOrderTab = dynamic(() => import('./components').then(m => ({ default: m.PreOrderTab })));
const PatientInfoTab = dynamic(() => import('./components').then(m => ({ default: m.PatientInfoTab })));
const MedicalRecordTab = dynamic(() => import('./components').then(m => ({ default: m.MedicalRecordTab })));
const QuestionnaireTab = dynamic(() => import('./components').then(m => ({ default: m.QuestionnaireTab })));
const VitalsTab = dynamic(() => import('./components').then(m => ({ default: m.VitalsTab })));
const FamilyHistoryTab = dynamic(() => import('./components').then(m => ({ default: m.FamilyHistoryTab })));
const ChronicTrendPanel = dynamic(() => import('./components').then(m => ({ default: m.ChronicTrendPanel })));
const ChronicProblemSummary = dynamic(() => import('./components').then(m => ({ default: m.ChronicProblemSummary })));
const MedicationTab = dynamic(() => import('./components').then(m => ({ default: m.MedicationTab })));
const SurgeryHistoryTab = dynamic(() => import('./components').then(m => ({ default: m.SurgeryHistoryTab })));
const BurnsTab = dynamic(() => import('./components/BurnsTab'));
const AdmissionHistoryTab = dynamic(() => import('./components').then(m => ({ default: m.AdmissionHistoryTab })));
const ReferralTab = dynamic(() => import('./components').then(m => ({ default: m.ReferralTab })));
const NursingRecordTab = dynamic(() => import('./components').then(m => ({ default: m.NursingRecordTab })));
const OrderTrackingTab = dynamic(() => import('./components').then(m => ({ default: m.OrderTrackingTab })));
const CheckupHistoryTab = dynamic(() => import('./components').then(m => ({ default: m.CheckupHistoryTab })));
const DentalTab = dynamic(() => import('./components').then(m => ({ default: m.DentalTab })));
const OphthalmologyTab = dynamic(() => import('./components').then(m => ({ default: m.OphthalmologyTab })));
const EntTab = dynamic(() => import('./components').then(m => ({ default: m.EntTab })));
const DermatologyTab = dynamic(() => import('./components').then(m => ({ default: m.DermatologyTab })));
const OrthopedicsTab = dynamic(() => import('./components').then(m => ({ default: m.OrthopedicsTab })));
const ObGynTab = dynamic(() => import('./components').then(m => ({ default: m.ObGynTab })));
const PediatricsTab = dynamic(() => import('./components').then(m => ({ default: m.PediatricsTab })));
const PsychiatryTab = dynamic(() => import('./components').then(m => ({ default: m.PsychiatryTab })));
const NeurosurgeryTab = dynamic(() => import('./components').then(m => ({ default: m.NeurosurgeryTab })));
const PlasticTab = dynamic(() => import('./components').then(m => ({ default: m.PlasticTab })));
const UrologyTab = dynamic(() => import('./components').then(m => ({ default: m.UrologyTab })));
const InternalMedicineTab = dynamic(() => import('./components').then(m => ({ default: m.InternalMedicineTab })));
const RehabTab = dynamic(() => import('./components').then(m => ({ default: m.RehabTab })));
const RadiationTab = dynamic(() => import('./components').then(m => ({ default: m.RadiationTab })));
const DialysisTab = dynamic(() => import('./components').then(m => ({ default: m.DialysisTab })));
const BloodBankTab = dynamic(() => import('./components').then(m => ({ default: m.BloodBankTab })));
const TherapyHistoryTab = dynamic(() => import('./components').then(m => ({ default: m.TherapyHistoryTab })));
const ClinicalToolsTab = dynamic(() => import('./components').then(m => ({ default: m.ClinicalToolsTab })));
// 큰 화면 보기(멀티패널 board) — board 진입 시에만 청크 로드
const ChartBoard = dynamic(() => import('./components/board/ChartBoard').then(m => ({ default: m.ChartBoard })));

const BASE_TABS = [
  { key: 'overview', label: '개요' },
  { key: 'problems', label: '문제목록' },
  { key: 'allergies', label: '알레르기' },
  { key: 'labresults', label: '검사결과' },
  { key: 'imaging', label: '영상' },
  { key: 'vitals', label: '바이탈' },
  { key: 'chronic', label: '만성질환' },
  { key: 'medications', label: '투약 이력' },
  { key: 'surgeries', label: '수술 이력' },
  { key: 'burns', label: '화상 평가' },
  { key: 'orders', label: '오더 추적' },
  { key: 'therapy', label: '치료 이력' },
  { key: 'admissions', label: '입퇴원' },
  { key: 'referrals', label: '의뢰/회신' },
  { key: 'timeline', label: '기록 시계열' },
  { key: 'encounters', label: '진료 이력' },
  { key: 'questionnaire', label: '문진표' },
  { key: 'billing', label: '처방/수납' },
  { key: 'consent', label: '동의서' },
  { key: 'checkup', label: '검진 이력' },
  { key: 'clinical-tools', label: '임상도구 결과' },
  { key: 'schedule', label: '치료일정' },
  { key: 'pre-orders', label: '사전처방' },
  { key: 'journey', label: '여정' },
  { key: 'nursing', label: '간호기록' },
  { key: 'education', label: '환자 교육' }, // 2026-09-30 — 누가·누구에게·무엇을·이해도 · 다른 기록의 교육도 출처와 함께
  // 2026-10-02 — 기록 완결(미비)·발급 문서·발급 요청·열람 이력(서버에 있었는데 차트에서 볼 자리가 없었다)
  { key: 'medical-record', label: '의무기록' },
  { key: 'family-history', label: '가족력' },
  { key: 'info', label: '환자 정보' },
] as const;
const PRIMARY_TAB_KEYS = ['overview', 'encounters', 'medications', 'labresults', 'vitals', 'orders'] as const;
type BaseTabKey = (typeof BASE_TABS)[number]['key'];
type SpecialtyTabKey = 'dental' | 'ophthalmology' | 'dermatology' | 'ent' | 'orthopedics' | 'obgyn' | 'pediatrics' | 'psychiatry' | 'neurosurgery' | 'plastic' | 'urology' | 'internal-medicine' | 'rehab' | 'radiation' | 'dialysis' | 'blood-bank';
type TabKey = BaseTabKey | SpecialtyTabKey;

const SPECIALTY_TABS: { key: SpecialtyTabKey; label: string; dept: string }[] = [
  { key: 'internal-medicine', label: '내과', dept: '내과' },
  { key: 'dental', label: '치과', dept: '치과' },
  { key: 'ophthalmology', label: '안과', dept: '안과' },
  { key: 'dermatology', label: '피부과', dept: '피부과' },
  { key: 'ent', label: '이비인후과', dept: '이비인후과' },
  { key: 'orthopedics', label: '정형외과', dept: '정형외과' },
  { key: 'obgyn', label: '산부인과', dept: '산부인과' },
  { key: 'pediatrics', label: '소아청소년과', dept: '소아청소년과' },
  { key: 'psychiatry', label: '정신과', dept: '정신건강의학과' },
  { key: 'neurosurgery', label: '신경외과', dept: '신경외과' },
  { key: 'plastic', label: '성형외과', dept: '성형외과' },
  { key: 'urology', label: '비뇨의학과', dept: '비뇨의학과' },
  { key: 'rehab', label: '재활의학과', dept: '재활의학과' },
  { key: 'radiation', label: '방사선종양', dept: '방사선종양학과' },
  { key: 'dialysis', label: '투석실', dept: '투석실' },
  { key: 'blood-bank', label: '혈액은행', dept: '혈액은행' },
];

const ALL_TAB_KEYS = [...BASE_TABS.map(t => t.key), ...SPECIALTY_TABS.map(t => t.key)] as string[];

function isValidTabKey(key: string | null): key is TabKey {
  return key != null && ALL_TAB_KEYS.includes(key);
}

function PatientDetailContent({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab = (() => {
    const tabParam = searchParams.get('tab');
    return isValidTabKey(tabParam) ? tabParam : 'overview';
  })();

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  /**
   * 🔴 **기록 한 건을 눌러 들어온 창**은 그 기록이 있는 영역만 본다(`?only=1`).
   *    환자 헤더·탭 목록·되돌아가기는 "차트를 훑는" 화면의 장치이고, 여기서는 방해가 된다
   *    (2026-08-25 사람 신고 — "이렇게 눌러 들어왔으니 진료이력만 보이게").
   *    🔴 초점 모드(`?focus=1`·사이드바 제거)와 **다른 축이다** — 그쪽은 화면 전체를 넓히는 것이고,
   *    이쪽은 그 안에서 무엇을 그릴지다. 그래서 파라미터를 따로 둔다.
   *    window 직접 판독 — `useSearchParams` Suspense 회피(레이아웃의 focus 판독과 같은 이유).
   */
  const [chromeless] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('only') === '1',
  );
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeceasedModal, setShowDeceasedModal] = useState(false);
  const [showIdentifyModal, setShowIdentifyModal] = useState(false);
  const [showMoreTabs, setShowMoreTabs] = useState(() => {
    return !PRIMARY_TAB_KEYS.includes(initialTab as any) && !SPECIALTY_TABS.some(s => s.key === initialTab);
  });
  const [showTabSettings, setShowTabSettings] = useState(false);
  const user = useAuthStore((s) => s.user);
  const tabConfig = usePatientTabStore((s) => s.config);
  const boardEnabled = usePatientTabStore((s) => s.boardEnabled);

  // Sync tab from URL on searchParams change
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (isValidTabKey(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }
    const qs = params.toString();
    router.replace(`/patients/${id}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, id, searchParams]);

  const allTabs = useMemo(() => {
    const filtered = SPECIALTY_TABS.filter(
      (t) => user?.role === 'ADMIN' || user?.department === t.dept,
    );
    const all = [...BASE_TABS, ...filtered];
    // 숨김 처리된 탭 제외
    return all.filter((t) => !tabConfig.hiddenKeys.includes(t.key));
  }, [user?.role, user?.department, tabConfig.hiddenKeys]);

  const userPrimaryKeys = tabConfig.primaryKeys;

  // ── Data fetching ──
  const { data, isLoading, isError, error, refetch } = usePatient(id);
  const { data: historyData } = usePatientHistory(id);
  const _histRaw = historyData?.data;
  const historyList = (Array.isArray(_histRaw) ? _histRaw : ((_histRaw as Record<string, unknown> | undefined)?.data ?? [])) as HistoryEntry[];

  const { data: encountersData, isLoading: encountersLoading, isError: encountersError } = usePatientEncounters(id);
  const { data: billingsData, isLoading: billingsLoading } = useQuery({
    queryKey: ['patient-billings', id],
    queryFn: () => apiClient.get<{ data: BillingWithRelations[] }>(`/api/v1/billings`, { patientId: id }),
    enabled: !!id,
  });
  const { data: summaryData } = useQuery({
    queryKey: ['patient-summary-counts', id],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/patients/${id}/summary`),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
  const { data: specialtyCountsData } = useQuery({
    queryKey: ['patient-specialty-counts', id],
    queryFn: () => apiClient.get<{ data: Record<string, number> }>(`/api/v1/patients/${id}/specialty-counts`),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const specialtyCounts: Record<string, number> = specialtyCountsData?.data ?? {};

  /**
   * 🔴 탭 배지 — 빈 탭과 내용 있는 탭이 **똑같이 생겨** 있었다(2026-08-26).
   *    종전엔 4종만 셌고 나머지 22개는 **눌러보기 전엔 알 수 없었다.**
   *    🔴 세지 못한 구간은 `0` 이 아니다 — 키가 없고 `failed` 에 담겨 온다.
   */
  const { data: sectionCountsData } = useQuery({
    queryKey: ['patient-section-counts', id],
    queryFn: () => apiClient.get<{ data: { counts: Record<string, number>; failed: string[] } }>(
      `/api/v1/patients/${id}/section-counts`,
    ),
    enabled: !!id,
    staleTime: 60_000,
    retry: false,
  });
  const sectionCounts: Record<string, number> = sectionCountsData?.data?.counts ?? {};
  const sectionCountFailed: string[] = sectionCountsData?.data?.failed ?? [];
  const { data: twinConsentData } = useQuery({
    queryKey: ['twin-consent', id],
    queryFn: () => apiClient.get<{ data: { consented: boolean } }>(`/api/v1/twin/consent/${id}`),
    enabled: !!id,
    retry: false,
  });
  const twinConsented = twinConsentData?.data?.consented ?? false;

  // AI 어시스턴트 맥락 — 이 환자를 건다(떠나면 푼다 · 서버로는 patientId 만 간다)
  const aiPatient = data?.data as { familyName?: string | null; givenName?: string | null } | undefined;
  useAiAssistantContext(id && aiPatient ? { patientId: id, patientName: `${aiPatient.familyName ?? ''}${aiPatient.givenName ?? ''}`, surface: 'PATIENT' } : null);

  // ── Error fallback ──
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-6">
        <div className="h-5 w-20 bg-gray-200 rounded animate-pulse" />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gray-200 animate-pulse" />
            <div className="space-y-2 flex-1">
              <div className="h-7 w-32 bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-4 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 w-24 bg-gray-200 rounded-full animate-pulse" />
          ))}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return <p className="text-red-500"><T k="환자를 찾을 수 없습니다." /></p>;

  // ── Derived data ──
  const patient = data.data;
  const _encountersRaw = encountersData?.data;
  const encounters = (Array.isArray(_encountersRaw) ? _encountersRaw : (_encountersRaw as Record<string, unknown> | undefined)?.data ?? []) as EncounterListItem[];

  const _billingsRaw = billingsData?.data;
  const billings: BillingWithRelations[] = Array.isArray(_billingsRaw) ? _billingsRaw : (_billingsRaw as Record<string, unknown> | undefined)?.data as BillingWithRelations[] ?? [];

  const allergies: string[] = typeof patient.allergies === 'string' ? JSON.parse(patient.allergies || '[]') : (patient.allergies ?? []);
  const patientTags: string[] = Array.isArray(patient.tags) ? patient.tags : [];
  const primaryContact = Array.isArray(patient.contacts) ? patient.contacts.find((c: PatientContact) => c.isPrimaryContact) : undefined;

  /**
   * 🔴 나이 정본은 shared `ageOf` 다 — 화면이 자기 계산을 갖지 않는다.
   *
   * 종전 이 자리의 로컬 계산은 불량·미래 생년월일에 **`return 0`** 이었다. 0세는 신생아라는
   * **다른 사실**이고, 이 값은 헤더·환자정보 탭이 그대로 찍는다(소아 용량·기준치를 읽는 사람이 본다).
   * 정본은 모르는 값을 `null` 로 답한다 — 아래 소비처는 `null` 을 "나이 미상"으로 그린다.
   */
  const patientAge = ageOf(patient.dateOfBirth as string | Date | null | undefined);

  const residentNumberMasked = patient.residentNumber
    ? patient.residentNumber.slice(0, 8) + '******'
    : undefined;

  const totalBillingAmount = billings.reduce((sum: number, b: BillingWithRelations) => sum + (b.totalAmount ?? 0), 0);
  const paidBillings = billings.filter((b: BillingWithRelations) => b.status === 'PAID').length;

  interface SummaryCounts { activeRxCount?: number; orderCount?: number }
  const summaryRaw: SummaryCounts = ((summaryData?.data as { data?: SummaryCounts })?.data ?? summaryData?.data ?? {}) as SummaryCounts;
  const visibleEncounters = encounters.filter((e: EncounterListItem) => e.status !== 'DRAFT' || e.subjective || e.objective || e.assessment || e.plan);
  const draftCount = encounters.length - visibleEncounters.length;
  // 🔴 개요 '최근 진료'는 내용 있는 기록만 — 종전엔 빈 임시 기록(DRAFT) 14건이 서명된 진료 4건을 밀어냈다(2026-10-02 실측)
  const recentEncounters = visibleEncounters.slice(0, 5);
  const tabCounts: Record<string, number | undefined> = {
    ...sectionCounts,
    // 화면이 이미 갖고 있는 값이 있으면 그것을 쓴다(같은 사실을 두 번 세지 않는다)
    encounters: visibleEncounters.length || sectionCounts.encounters,
    medications: summaryRaw?.activeRxCount ?? sectionCounts.medications,
    orders: summaryRaw?.orderCount ?? sectionCounts.orders,
    billing: billings.length || sectionCounts.billing,
    ...specialtyCounts,
  };
  const tabDraftCounts: Record<string, number> = {
    encounters: draftCount,
  };

  // 큰 화면 보기(board) 컨텍스트 — page가 이미 조회·계산한 데이터를 패널에 주입(재조회 0·§6)
  const boardCtx = {
    patientId: id,
    recentEncounters,
    encountersLoading,
    billings,
    billingsLoading,
    totalBillingAmount,
    paidBillings,
    emptyDraftCount: draftCount,
    userRole: user?.role,
    onTabChange: (tab: string) => handleTabChange(tab as TabKey),
  };

  return (
    // 개요는 카드 그리드라 폭을 넓힐수록 열이 늘어난다(auto-fit) → 폭 제한 해제.
    // 나머지 탭은 대부분 목록/본문이라 max-w-5xl 유지(줄이 길어지면 읽기 어려움).
    <div className={`${boardEnabled || activeTab === 'overview' ? 'max-w-none' : 'max-w-5xl'} space-y-6 print-area`}>
      {/* 임상 역할 공통 — 우측 여백에 참조 레일(역할별 카드·초광폭 전용·fixed 라 본문 무영향).
          개요 탭은 max-w-none 전폭 대시보드(자체 우측 컬럼)라 레일이 그 위를 덮는다 → 목록 탭(max-w-5xl)에서만. */}
      {!chromeless && user?.role && ['NURSE', 'DOCTOR', 'PHARMACIST', 'LAB_TECH', 'ADMIN'].includes(user.role) && !boardEnabled && activeTab !== 'overview' && (
        <ClinicalSideRail patientId={id} allergies={allergies} role={user.role} />
      )}
      <style jsx global>{`
        @media print {
          .sidebar, .top-header, .no-print { display: none !important; }
          .print-area { margin: 0; padding: 20px; }
          /* 큰 화면 보기(board) 그리드는 인쇄 부적합 → 단일 컬럼 강제(설계 §7·D5) */
          [data-density] { display: block !important; }
          [data-density] > div { max-height: none !important; overflow: visible !important; margin-bottom: 12px; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
      {/* Back link — 기록 단건 창(only=1)에서는 그리지 않는다 */}
      {!chromeless && (
      <Link href="/patients" className="no-print inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        <T k="환자 목록" />
      </Link>
      )}

      {/* 안전 존 — board 시 sticky: 식별·알러지·플래그·위험카드 상시 노출(P-1/P-2).
          기록 단건 창(only=1)에서는 그리지 않는다 — 그 기록만 보러 들어온 창이다. */}
      {!chromeless && (
      <div className={boardEnabled ? 'sticky top-0 z-20 bg-gray-50 pb-3 pt-1 space-y-3' : 'space-y-6'}>
      {boardEnabled ? (
        <>
          <BoardHeaderBar patient={patient} patientId={id} patientAge={patientAge} allergies={allergies} />
          <TwinCdsCards patientId={id} />
        </>
      ) : (
      /* 넓은 화면에서는 환자 헤더와 트윈 위험 카드를 **한 줄로 합친다**(세로로 쌓으면 첫 화면이 정보 없이 길어짐).
         좁은 화면에서는 종전대로 위아래. */
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:gap-4">
      <div className="min-w-0 flex-1 space-y-3">
      {/* Patient Header */}
      <div className="relative">
        <PatientHeader
          patient={patient}
          patientId={id}
          userRole={user?.role}
          onViewChart={() => handleTabChange('encounters')}
          onReviewMedications={() => handleTabChange('medications')}
          onViewLabs={() => handleTabChange('labresults')}
          patientAge={patientAge}
          allergies={allergies}
          patientTags={patientTags}
          primaryContact={primaryContact}
          residentNumberMasked={residentNumberMasked}
          onEditClick={() => setShowEditModal(true)}
          onDeceasedClick={() => setShowDeceasedModal(true)}
          onIdentifyClick={() => setShowIdentifyModal(true)}
          headerTools={<>
        {/* [외부 앱][디지털 트윈][인쇄] — 이름 행 ml-auto 편입(absolute 는 좁은 폭에서 배지와 겹쳤다) */}
        {/* 🔴 (2026-10-07) 차트 → 의사 할 일함 — 이 환자에게 걸린 내 일(결과 확인·구두 처방·갱신·사전처방·약사·협진)로. 할 일함 목록 EP 와 같은 역할(의사·관리자)만 */}
        {(user?.role === 'DOCTOR' || user?.role === 'ADMIN') && (
          <Link href={`/doctor-inbox?view=patients&patient=${id}`} data-chart-inbox-link
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">
            <T k="이 환자의 내 할 일" />
          </Link>
        )}
        <SmartAppLauncher patientId={id} compact />
        <button
          disabled={!twinConsented}
          onClick={async () => {
            if (!twinConsented) return;
            try {
              const r = await apiClient.get<{ data: { url: string } }>(`/api/v1/twin/launch/${id}`);
              if (r.data?.url) window.open(r.data.url, '_blank', 'noopener,noreferrer');
            } catch { alert('디지털 트윈을 열 수 없습니다 (동의·연동 상태를 확인하세요)'); }
          }}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${twinConsented ? 'text-white bg-indigo-600 hover:bg-indigo-700' : 'text-gray-400 bg-gray-100 cursor-not-allowed'}`}
          title={twinConsented ? '디지털 트윈 보기' : `트윈/${AI_ORIGIN_TEXT} 활용 동의 후 이용 가능`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
          </svg>
          <T k="디지털 트윈" />
        </button>
        <button
          onClick={() => sanctionedPrint()}
          className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors"
          title="차트 인쇄"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 12h.008v.008h-.008V12zm-2.25 0h.008v.008H16.5V12z" />
          </svg>
          <T k="인쇄" />
        </button>
          </>}
        />
      </div>

      {/* 임상 안전 스트립 — 격리/DNR/낙상/EWS(있을 때만·P-1) */}
      <PatientSafetyBar patientId={id} />
      </div>

      {/* 디지털 트윈 CDS 위험 카드 — xl 이상에서는 헤더 오른쪽 열 */}
      <div className="xl:w-[34%] xl:min-w-[320px] xl:max-w-[560px] xl:shrink-0">
        <TwinCdsCards patientId={id} className="" />
      </div>
      </div>
      )}
      </div>
      )}

      {/* Modals */}
      {showDeceasedModal && (
        <DeceasedModal
          patientId={id}
          patientName={`${patient.familyName}${patient.givenName}`}
          onClose={() => setShowDeceasedModal(false)}
        />
      )}
      {showIdentifyModal && (
        <IdentifyPatientModal
          patientId={id}
          currentName={`${patient.familyName ?? ''}${patient.givenName ?? ''}`}
          onClose={() => setShowIdentifyModal(false)}
        />
      )}
      {showEditModal && (
        <EditPatientModal
          patient={patient}
          patientId={id}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {showTabSettings && (
        <TabSettingsModal
          baseTabs={[...BASE_TABS, ...SPECIALTY_TABS.filter(t => user?.role === 'ADMIN' || user?.department === t.dept)]}
          onClose={() => setShowTabSettings(false)}
        />
      )}

      {boardEnabled ? (
        <ChartBoard ctx={boardCtx} />
      ) : (
      <>
      {/* Tab Bar — 주요 탭. 기록 단건 창(only=1)에서는 그리지 않는다(그 영역만 본다) */}
      {!chromeless && (
      <div className="no-print space-y-2">
        {/* 차트 내 검색(C4) — 탭을 하나씩 열지 않고 이 환자 기록 전체에서 찾는다 · 서버 전문검색 정본(환자 범위) */}
        <ChartSearchPanel patientId={id} onOpenTab={(tab) => handleTabChange(tab as TabKey)} />
        <div className="flex gap-2 flex-wrap">
          {allTabs.filter(t => userPrimaryKeys.includes(t.key)).map(tab => {
            const count = tabCounts[tab.key];
            const draft = tabDraftCounts[tab.key] ?? 0;
            // 🔴 못 센 것은 0 이 아니다 — 배지를 그리지 않고 "?" 로 그 사실을 말한다
            const uncounted = sectionCountFailed.includes(tab.key);
            const empty = count === 0 && !uncounted;
            return (
              <button key={tab.key} onClick={() => handleTabChange(tab.key as TabKey)}
                title={uncounted ? '건수를 세지 못했습니다 — 비어 있다는 뜻이 아닙니다' : undefined}
                className={`px-4 py-2 text-sm font-medium rounded-full transition-colors flex items-center gap-1.5 ${
                  activeTab === tab.key ? 'bg-blue-600 text-white'
                    : empty ? 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                <T k={tab.label} />
                {uncounted && <span className="text-[10px] text-amber-600" aria-label="건수 미상">?</span>}
                {count != null && count > 0 && (
                  <span className={`text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center ${
                    activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
                {draft > 0 && (
                  <span className={`text-[9px] ${activeTab === tab.key ? 'text-blue-200' : 'text-gray-400'}`}>
                    ({draft})
                  </span>
                )}
              </button>
            );
          })}
          <button onClick={() => setShowMoreTabs(!showMoreTabs)}
            className={`px-3 py-2 text-sm font-medium rounded-full transition-colors ${
              showMoreTabs ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>
            {showMoreTabs ? <T k="접기 ▲" /> : <T k="더보기 ▼" />}
          </button>
          <button onClick={() => setShowTabSettings(true)}
            className="px-2.5 py-2 text-sm text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
            title="탭 설정">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {/* 더보기 탭 */}
        {showMoreTabs && (
          <div className="flex gap-1.5 flex-wrap pl-1">
            {/* 🔴 0건 탭도 **숨기지 않는다** — 숨기면 다음 사람이 "없다"가 아니라 "그런 탭이 없다"로 읽는다.
                대신 개수를 붙이고 흐리게 둔다. 못 센 것은 `?` 로 따로 말한다. */}
            {allTabs.filter(t => !userPrimaryKeys.includes(t.key) && !SPECIALTY_TABS.some(s => s.key === t.key)).map(tab => {
              const count = tabCounts[tab.key];
              const uncounted = sectionCountFailed.includes(tab.key);
              const empty = count === 0 && !uncounted;
              return (
              <button key={tab.key} onClick={() => handleTabChange(tab.key as TabKey)}
                title={uncounted ? '건수를 세지 못했습니다 — 비어 있다는 뜻이 아닙니다' : undefined}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  activeTab === tab.key ? 'bg-blue-500 text-white'
                    : empty ? 'bg-white border border-gray-100 text-gray-300 hover:bg-gray-50'
                    : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}>
                <T k={tab.label} />
                {uncounted && <span className="text-[10px] text-amber-600" aria-label="건수 미상">?</span>}
                {count != null && count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 rounded-full ${activeTab === tab.key ? 'bg-white/25 text-white' : 'bg-blue-100 text-blue-600'}`}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
              );
            })}
          </div>
        )}

        {/* 전문과 탭 (해당 부서만) */}
        {allTabs.some(t => SPECIALTY_TABS.some(s => s.key === t.key)) && (
          <div className="flex gap-1.5 flex-wrap pl-1">
            <span className="text-[10px] text-gray-400 self-center mr-1"><T k="전문과" /></span>
            {allTabs.filter(t => SPECIALTY_TABS.some(s => s.key === t.key)).map(tab => {
              const cnt = specialtyCounts[tab.key];
              return (
              <button key={tab.key} onClick={() => handleTabChange(tab.key as TabKey)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  activeTab === tab.key ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-600 hover:bg-violet-100'
                }`}>
                <T k={tab.label} />
                {cnt != null && cnt > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? 'bg-white/25 text-white' : 'bg-violet-600 text-white'}`}>{cnt}</span>
                )}
              </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* 활성 탭의 작성 가능성 — 역할별 입력 가능/불가를 조용히 구분(2026-08-03 결정) */}
      {(() => {
        const cap = tabCapability(activeTab, user?.role);
        return cap ? (
          <div className="no-print -mt-2 flex justify-end">
            <CapabilityBadge mode={cap.mode} label={cap.label} reason={cap.reason} />
          </div>
        ) : null;
      })()}

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <>
          {/* 응급 도착 상황 기록 — 응급 미확인으로 들어온 환자(신원 확인 뒤에도 EMG- 번호가 남는다) · 임상 역할만(EP 권한과 같게) */}
          {((patient as { patientSource?: string | null }).patientSource === 'EMERGENCY_UNKNOWN' || patient.mrn?.startsWith('EMG-'))
            && (user?.role === 'NURSE' || user?.role === 'DOCTOR' || user?.role === 'ADMIN')
            && <ArrivalNotesPanel patientId={id} />}
          <OverviewTab
            patientId={id}
            recentEncounters={recentEncounters}
            encountersLoading={encountersLoading}
            billings={billings}
            billingsLoading={billingsLoading}
            totalBillingAmount={totalBillingAmount}
            paidBillings={paidBillings}
            onTabChange={(tab) => handleTabChange(tab as TabKey)}
            userRole={user?.role}
            emptyDraftCount={draftCount}
          />
          {/* 퀵 액션 바 */}
          <div className="no-print bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex gap-2 flex-wrap">
              {!user ? null : user.role === 'NURSE' ? (
                <>
                  <button onClick={() => handleTabChange('nursing')}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    <T k="간호 기록" />
                  </button>
                  <button onClick={() => handleTabChange('vitals')}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>
                    <T k="바이탈 기록" />
                  </button>
                  <button onClick={() => handleTabChange('medications')}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M14.25 3.104v5.714c0 .597.237 1.17.659 1.591L19 14.5" /></svg>
                    <T k="투약 확인" />
                  </button>
                </>
              ) : (user.role === 'DOCTOR' || user.role === 'ADMIN') ? (
                <>
                  <Link href={`/patients/${id}/encounter/new`}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    <T k="진료 시작" />
                  </Link>
                  <button onClick={() => handleTabChange('medications')}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M14.25 3.104v5.714c0 .597.237 1.17.659 1.591L19 14.5" /></svg>
                    <T k="처방 입력" />
                  </button>
                </>
              ) : null}
              {/* 오더 진입(검사·영상·바이탈)은 임상 역할만 — 원무/의무기록/검진 등 지원역할엔 비노출(환자 위치 QR 은 전 역할) */}
              {user && (user.role === 'DOCTOR' || user.role === 'NURSE' || user.role === 'ADMIN') && (
                <>
                  <button onClick={() => handleTabChange('labresults')}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082" /></svg>
                    <T k="검사 오더" />
                  </button>
                  <button onClick={() => handleTabChange('imaging')}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>
                    <T k="영상 오더" />
                  </button>
                  <button onClick={() => handleTabChange('vitals')}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>
                    <T k="바이탈" />
                  </button>
                </>
              )}
              <PatientLocQrButton patientId={id} patientName={`${patient.familyName}${patient.givenName}`} mrn={patient.mrn} />
            </div>
          </div>
        </>
      )}
      {activeTab === 'problems' && <ProblemListTab patientId={id} />}
      {activeTab === 'allergies' && <AllergyTab patientId={id} />}
      {activeTab === 'labresults' && <LabResultsTab patientId={id} />}
      {activeTab === 'imaging' && <ImagingTab patientMrn={patient.mrn} patientId={id} />}
      {activeTab === 'vitals' && <VitalsTab patientId={id} />}
      {activeTab === 'chronic' && (
        <div className="space-y-5">
          <ChronicProblemSummary patientId={id} />
          <ChronicTrendPanel patientId={id} />
        </div>
      )}
      {activeTab === 'medications' && <MedicationTab patientId={id} />}
      {activeTab === 'surgeries' && <SurgeryHistoryTab patientId={id} />}
      {activeTab === 'burns' && <BurnsTab patientId={id} />}
      {activeTab === 'orders' && <OrderTrackingTab patientId={id} />}
      {activeTab === 'therapy' && <TherapyHistoryTab patientId={id} />}
      {activeTab === 'admissions' && <AdmissionHistoryTab patientId={id} />}
      {activeTab === 'referrals' && <ReferralTab patientId={id} />}
      {activeTab === 'encounters' && (
        <EncounterHistoryTab
          patientId={id}
          encounters={encounters}
          encountersLoading={encountersLoading}
        />
      )}
      {activeTab === 'billing' && (
        <BillingTab
          billings={billings}
          billingsLoading={billingsLoading}
          encounters={encounters}
          encountersLoading={encountersLoading}
        />
      )}
      {activeTab === 'questionnaire' && <QuestionnaireTab patientId={id} />}
      {activeTab === 'consent' && <ConsentTab patientId={id} />}
      {activeTab === 'checkup' && <CheckupHistoryTab patientId={id} />}
      {activeTab === 'clinical-tools' && <ClinicalToolsTab patientId={id} />}
      {activeTab === 'schedule' && <TreatmentScheduleTab patientId={id} />}
      {activeTab === 'pre-orders' && <PreOrderTab patientId={id} />}
      {activeTab === 'timeline' && <RecordTimelineView patientId={id} embedded />}
      {activeTab === 'journey' && <JourneyTab patientId={id} />}
      {activeTab === 'nursing' && <NursingRecordTab patientId={id} />}
      {activeTab === 'education' && <PatientEducationPanel patientId={id} />}
      {activeTab === 'medical-record' && <MedicalRecordTab patientId={id} />}
      {activeTab === 'family-history' && <FamilyHistoryTab patientId={id} />}
      {activeTab === 'info' && (
        <PatientInfoTab
          patient={patient}
          patientId={id}
          patientAge={patientAge}
          allergies={allergies}
          patientTags={patientTags}
          residentNumberMasked={residentNumberMasked}
          historyList={historyList}
        />
      )}
      {activeTab === 'dental' && <DentalTab patientId={id} patientMrn={patient.mrn} />}
      {activeTab === 'ophthalmology' && <OphthalmologyTab patientId={id} />}
      {activeTab === 'ent' && <EntTab patientId={id} />}
      {activeTab === 'dermatology' && <DermatologyTab patientId={id} />}
      {activeTab === 'orthopedics' && <OrthopedicsTab patientId={id} />}
      {activeTab === 'obgyn' && <ObGynTab patientId={id} />}
      {activeTab === 'pediatrics' && <PediatricsTab patientId={id} />}
      {activeTab === 'psychiatry' && <PsychiatryTab patientId={id} />}
      {activeTab === 'neurosurgery' && <NeurosurgeryTab patientId={id} />}
      {activeTab === 'plastic' && <PlasticTab patientId={id} />}
      {activeTab === 'urology' && <UrologyTab patientId={id} />}
      {activeTab === 'internal-medicine' && <InternalMedicineTab patientId={id} />}
      {activeTab === 'rehab' && <RehabTab patientId={id} />}
      {activeTab === 'radiation' && <RadiationTab patientId={id} />}
      {activeTab === 'dialysis' && <DialysisTab patientId={id} />}
      {activeTab === 'blood-bank' && <BloodBankTab patientId={id} />}
      </>
      )}
      {/* 🔴 차트 인쇄 — 화면을 찍지 않고 인쇄 전용 문서로(2026-10-12 · 종전엔 빈 종이). 머리·큰 화면 보기 두 '인쇄' 단추가 같은 문서를 찍는다 */}
      {!chromeless && (
        <PatientChartPrint
          patientId={id}
          patient={patient}
          patientAge={patientAge}
          allergies={allergies}
          encounters={encountersError ? null : visibleEncounters}
          emptyDraftCount={draftCount}
          activeRxCount={summaryRaw?.activeRxCount}
          orderCount={summaryRaw?.orderCount}
        />
      )}
    </div>
  );
}

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={
      <div className="max-w-5xl space-y-6">
        <div className="h-5 w-20 bg-gray-200 rounded animate-pulse" />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="h-14 bg-gray-100 rounded-xl animate-pulse" />
        </div>
      </div>
    }>
      <PatientDetailContent id={id} />
    </Suspense>
  );
}

/* 디지털 트윈 CDS Hooks 위험 카드 (patient-view) */
interface CdsCard {
  summary: string;
  indicator?: 'info' | 'warning' | 'critical';
  detail?: string;
  source?: { label?: string; url?: string };
  links?: { label: string; url: string; type?: string }[];
}
function TwinCdsCards({ patientId, className = 'mt-3' }: { patientId: string; className?: string }) {
  const qc = useQueryClient();
  const { data: consentData } = useQuery({
    queryKey: ['twin-consent', patientId],
    queryFn: () => apiClient.get<{ data: { consented: boolean; recorded: boolean } }>(`/api/v1/twin/consent/${patientId}`),
    retry: false,
  });
  const consented = consentData?.data?.consented ?? false;
  const setConsent = useMutation({
    mutationFn: (v: boolean) => apiClient.post(`/api/v1/twin/consent/${patientId}`, { consented: v, method: 'VERBAL' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['twin-consent', patientId] }); qc.invalidateQueries({ queryKey: ['twin-cds', patientId] }); },
  });

  const cdsQuery = useQuery({
    queryKey: ['twin-cds', patientId],
    queryFn: () => apiClient.get<{ data: TwinCdsResponse<CdsCard> }>(`/api/v1/twin/cds/patient-view/${patientId}`),
    staleTime: 60000,
    retry: false,
    enabled: consented,
  });
  // 🔴 r3 B2: 서버 status 로 "진짜 0장"과 "트윈에 물어보지 못함"을 가른다(P17 — 0장을 안심으로 그리지 않는다)
  const view = twinCdsView({ data: cdsQuery.data?.data, isError: cdsQuery.isError });
  const cards = view === 'CARDS' ? (cdsQuery.data?.data?.cards ?? []) : [];

  // 동의 미기록/철회 → 동의 게이트 안내
  if (!consented) {
    return (
      <div className={`no-print rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-2.5 flex items-center justify-between ${className}`}>
        <span className="text-xs text-gray-500">🔒 디지털 트윈/{AI_ORIGIN_TEXT} 활용 동의가 필요합니다 (위험 카드·트윈 뷰어 비활성)</span>
        <button onClick={() => setConsent.mutate(true)} disabled={setConsent.isPending} className="text-xs font-medium text-white bg-indigo-600 rounded-lg px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"><T k="동의 기록" /></button>
      </div>
    );
  }
  if (!cards.length) {
    return (
      <div className={`no-print flex items-center justify-end gap-3 ${className}`}>
        {view === 'UNCHECKED' && (
          <span className="mr-auto text-xs text-amber-700" role="status">
            ⚠ <T k="트윈 위험 카드를 확인하지 못했습니다 — '위험 없음'이 아닙니다" />
          </span>
        )}
        {view === 'UNCONFIGURED' && (
          <span className="mr-auto text-xs text-gray-400" role="status">
            <T k="트윈 연동 미설정 — 위험 카드를 조회하지 않았습니다" />
          </span>
        )}
        <button onClick={() => setConsent.mutate(false)} className="text-[11px] text-gray-400 hover:text-gray-600 underline">트윈/{AI_ORIGIN_TEXT} 동의 철회</button>
      </div>
    );
  }
  const STYLE: Record<string, string> = {
    info: 'border-blue-200 bg-blue-50/60', warning: 'border-amber-300 bg-amber-50/70', critical: 'border-red-300 bg-red-50/70',
  };
  const ICON: Record<string, string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };
  return (
    <div className={`no-print space-y-2 ${className}`}>
      {cards.map((c, i) => {
        const ind = c.indicator ?? 'info';
        return (
          <div key={i} className={`rounded-xl border px-4 py-3 ${STYLE[ind] ?? STYLE.info}`}>
            <div className="flex items-start gap-2">
              <span className="text-base leading-5">{ICON[ind] ?? 'ℹ️'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800">{c.summary}</div>
                {c.detail && <div className="text-xs text-gray-500 mt-0.5">{c.detail}</div>}
                <div className="flex items-center gap-3 mt-1.5">
                  {(c.links ?? []).map((l, j) => (
                    <a key={j} href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline">{l.label} →</a>
                  ))}
                  {c.source?.label && <span className="text-[11px] text-gray-400">출처: {c.source.label}</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex justify-end"><button onClick={() => setConsent.mutate(false)} className="text-[11px] text-gray-400 hover:text-gray-600 underline">트윈/{AI_ORIGIN_TEXT} 동의 철회</button></div>
    </div>
  );
}
