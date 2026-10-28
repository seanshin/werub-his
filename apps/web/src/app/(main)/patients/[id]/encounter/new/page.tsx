'use client';

import { abnormalOf, type VitalItemFlag } from '@/lib/vital-flags';
import { VitalSignsStrip } from '@/components/vitals/VitalSigns';
import { VitalsRuleNote } from '@/components/vitals/VitalsRuleNote';
import { Term } from '@/components/ui/term';
import { use, useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePatient } from '@/hooks/usePatients';
import { useEncounter, useCreateEncounter, useUpdateEncounter, useSignEncounter, useAddPrescription, useCancelPrescription, usePatientEncounters } from '@/hooks/useEncounters';
import { useCreateBilling } from '@/hooks/useBilling';
import { safeFormat as format } from '@/lib/safe-date';
import { apiClient } from '@/lib/api-client';
import StatusBadge from '@/components/ui/StatusBadge';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { openDocumentWindow } from '@/lib/document-window';
import { SmartAppLauncher } from '@/components/smart-launch/SmartAppLauncher';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { ChartRenderer } from '@/components/chart/ChartRenderer';
import { ChartSaveNotice } from '@/components/chart/ChartSaveNotice';
import { applyChartValuesToSoap, type ChartSectionDef, type SoapSlot } from '@/components/chart/chart-values';
import { useClinicalChartCaptureStore, ClinicalChartCaptureProvider, EncounterRefProvider } from '@/components/clinical-charts/capture-context';
import { getChart } from '@/lib/clinical-charts';
import { INSURANCE_LABEL, MutationError, type EncounterWithRelations, ageOf, AI_ORIGIN_TEXT, DUR_WARNING_TYPE_LABEL } from '@hospital-run/shared';
import { useAuthStore } from '@/stores/auth-store';
import { useAiAssistantContext } from '@/components/ai/use-ai-assistant-context';
import {
  type CodeItem, useCodeSearch, CodeSearchDropdown, ACTIVITY_PRESETS, NURSING_FALLBACK_PRESETS, THERAPY_PRESETS,
} from '@/components/prescription/order-entry';
import { usePrescriberDelegate, PrescriberPicker, type DelegateBody } from '@/components/prescription/PrescriberDelegate';
import { OrderSetPanel } from './components/OrderSetPanel';
import { ApplyOrderSetModal } from './components/ApplyOrderSetModal';
import { RecommendedTemplates } from './components/RecommendedTemplates';
import { CopyPrescriptionButton } from './components/CopyPrescriptionButton';
import { PreOrderBanner } from './components/PreOrderBanner';
import { PreOrderCreateModal } from '../../components/PreOrderTab';
import { ChartTemplateSelector } from './components/ChartTemplateSelector';
import { AiAssistantPanel } from './components/AiAssistantPanel';
import { PreSignQaChecklist, type PreSignQaState, type PreSignQaResult } from './components/PreSignQaChecklist';
import { DraftBanner, recordDraftApplied, type DraftProvenance, type DraftSource } from '@/components/ai/DraftBanner';
import { RxContextPanel } from './components/RxContextPanel';
import { DiscontinueDialog } from '@/components/prescription/DiscontinueDialog';
import { VoiceHub } from '@/components/voice-emr/VoiceHub';
import ConversationStreamPanel from '@/components/voice-emr/ConversationStreamPanel';
import { CdssAlertBanner } from '@/components/cdss/CdssAlertBanner';
import { DentalEncounterLayout } from './components/DentalEncounterLayout';
import { OphthalmologyEncounterLayout } from './components/OphthalmologyEncounterLayout';
import { DermatologyEncounterLayout } from './components/DermatologyEncounterLayout';
import { EntEncounterLayout } from './components/EntEncounterLayout';
import { OrthopedicsEncounterLayout } from './components/OrthopedicsEncounterLayout';
import { ObGynEncounterLayout } from './components/ObGynEncounterLayout';
import { PediatricsEncounterLayout } from './components/PediatricsEncounterLayout';
import { PsychiatryEncounterLayout } from './components/PsychiatryEncounterLayout';
import { NeurosurgeryEncounterLayout } from './components/NeurosurgeryEncounterLayout';
import { PlasticEncounterLayout } from './components/PlasticEncounterLayout';
import { UrologyEncounterLayout } from './components/UrologyEncounterLayout';
import { InternalMedicineEncounterLayout } from './components/InternalMedicineEncounterLayout';
import { SurgeryEncounterLayout } from './components/SurgeryEncounterLayout';
import { EmergencyEncounterLayout } from './components/EmergencyEncounterLayout';
import { FamilyMedicineEncounterLayout } from './components/FamilyMedicineEncounterLayout';
import { RehabEncounterLayout } from './components/RehabEncounterLayout';
import SmartSignButton from '@/components/signature/SmartSignButton';
import NursingNotePanel from '@/components/nursing/NursingNotePanel';
import { PatientChartDrawer, isChartDrawerPinned } from './components/PatientChartDrawer';
import { EncounterAttachments } from './components/EncounterAttachments';
import { DiagnosisInput, type DiagnosisItem } from './components/DiagnosisInput';
import { RecommendedOrderSets } from './components/RecommendedOrderSets';
import { PregnancyStatusCard } from './components/PregnancyStatusCard';
import { money, kdate } from '@/lib/ui-settings';

import { EmptyState, Money, Unit } from '@/components/ui/display';

type PrescriptionTab = 'MEDICATION' | 'LAB' | 'IMAGING' | 'THERAPY' | 'DIET' | 'ACTIVITY' | 'NURSING';

type SpecialtyLayout = 'general' | 'dental' | 'ophthalmology' | 'dermatology' | 'ent' | 'orthopedics' | 'obgyn' | 'pediatrics' | 'psychiatry' | 'neurosurgery' | 'plastic' | 'urology' | 'internal-medicine' | 'surgery' | 'emergency' | 'family-medicine' | 'rehab';

function getSpecialtyLayout(dept?: string): SpecialtyLayout {
  if (dept === '치과') return 'dental';
  if (dept === '안과') return 'ophthalmology';
  if (dept === '피부과') return 'dermatology';
  if (dept === '이비인후과') return 'ent';
  if (dept === '정형외과') return 'orthopedics';
  if (dept === '산부인과') return 'obgyn';
  if (dept === '소아청소년과') return 'pediatrics';
  if (dept === '정신건강의학과') return 'psychiatry';
  if (dept === '신경외과') return 'neurosurgery';
  if (dept === '성형외과') return 'plastic';
  if (dept === '비뇨의학과') return 'urology';
  if (dept === '내과') return 'internal-medicine';
  if (dept === '외과') return 'surgery';
  if (dept === '응급의학과') return 'emergency';
  if (dept === '가정의학과') return 'family-medicine';
  if (dept === '재활의학과') return 'rehab';
  return 'general';
}

/** 처방 목록 유형 배지 — 탭 7종 전부(종전엔 약·검사 밖을 전부 '영상'이라 적었다) */
const RX_TYPE_LABEL: Record<string, string> = { MEDICATION: '약@처방', LAB: '검사', IMAGING: '영상', THERAPY: '치료', DIET: '식이', ACTIVITY: '활동', NURSING: '간호지시' };

const TAB_CONFIG: { key: PrescriptionTab; label: string; icon: React.ReactNode }[] = [
  {
    key: 'MEDICATION',
    label: '약처방',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.187 3.187 0 01-2.283.866 3.187 3.187 0 01-2.283-.866L5 14.5" />
      </svg>
    ),
  },
  {
    key: 'LAB',
    label: '검사',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5" />
      </svg>
    ),
  },
  {
    key: 'IMAGING',
    label: '영상',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
      </svg>
    ),
  },
  {
    key: 'THERAPY',
    label: '치료',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
      </svg>
    ),
  },
  {
    key: 'DIET',
    label: '식이',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 8.25v-1.5m-6 1.5v-1.5m12 9.75l-1.5.75a3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0L3 16.5m15-3.379a48.474 48.474 0 00-6-.371c-2.032 0-4.034.126-6 .371m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.169c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 013 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 016 13.12M12.265 3.11a.375.375 0 11-.53 0L12 2.845l.265.265zm-3 0a.375.375 0 11-.53 0L9 2.845l.265.265zm6 0a.375.375 0 11-.53 0L15 2.845l.265.265z" />
      </svg>
    ),
  },
  {
    key: 'ACTIVITY',
    label: '활동',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    key: 'NURSING',
    label: '간호지시',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15" />
      </svg>
    ),
  },
];

interface QuestionnaireSubmission {
  data: Record<string, string | string[]>;
}

interface QuestionnaireResponse {
  id: string;
  status: string;
  submission?: QuestionnaireSubmission;
  formSchema?: { name: string };
  completedAt?: string;
  reviewedAt?: string | null;
  reviewer?: { familyName: string; givenName: string } | null;
}

interface AiResultData {
  summary?: { subjective?: string; objective?: string; assessment?: string; plan?: string };
  icd_codes?: string[];
  differential_diagnosis?: DifferentialDiagnosis[];
  answer?: string;
  explanation?: string;
  sources?: { title: string }[];
  key_points?: string[];
  [key: string]: unknown;
}

interface AiResult {
  type: string;
  data: AiResultData;
}

interface DurWarning {
  severity: string;
  type?: string;
  message: string;
  drugA?: string;
  drugB?: string;
}

interface ChartTemplate {
  id: string;
  name: string;
  department: string;
  role: string;
  isPersonal?: boolean;
  sections?: unknown[];
  layout?: string;
}

/** 치료 프리셋 라인 아이콘(Heroicons 24 outline path) — 데이터는 정본(THERAPY_PRESETS), 표현만 차트 로컬 */
const THERAPY_ICON_PATHS: Record<string, string> = {
  PT_EXERCISE: 'M4.5 9.75v4.5M7.5 8.25v7.5M7.5 12h9M16.5 8.25v7.5M19.5 9.75v4.5',
  PT_MANUAL: 'M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 013.15 0V15M6.9 7.575a1.575 1.575 0 10-3.15 0v8.175a6.75 6.75 0 006.75 6.75h2.018a5.25 5.25 0 003.712-1.538l1.732-1.732a5.25 5.25 0 001.538-3.712l.003-2.024a.668.668 0 01.198-.471 1.575 1.575 0 10-2.228-2.228 3.818 3.818 0 00-1.12 2.687M6.9 7.575V12',
  PT_MODALITY: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  OT_ADL: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75',
  OT_COGNITIVE: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18',
  ST_SPEECH: 'M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z',
  ST_SWALLOW: 'M12 3.75s6 6.15 6 10.125a6 6 0 11-12 0C6 9.9 12 3.75 12 3.75z',
  HD_SESSION: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99',
  CHEMO_IV: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.187 3.187 0 01-2.283.866 3.187 3.187 0 01-2.283-.866L5 14.5m14 0l1.514 1.514a2.25 2.25 0 01.659 1.591v2.145c0 1.243-1.007 2.25-2.25 2.25H5.077c-1.243 0-2.25-1.007-2.25-2.25v-2.145c0-.597.237-1.17.659-1.591L5 14.5',
  RT_FRACTION: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM13.5 12a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM12 5.25v3M6.16 15.38l2.6-1.5M17.84 15.38l-2.6-1.5',
  PT_GAIT: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.1a7.5 7.5 0 0115 0',
  PT_TRACTION: 'M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5',
  PT_ESWT: 'M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0',
  PT_FES: 'M11.25 3v6H6l6.75 12v-7.5H18L11.25 3z',
  PT_LYMPH: 'M12 3.75s6 6.15 6 10.125a6 6 0 11-12 0C6 9.9 12 3.75 12 3.75zM9 14h6',
  REHAB_PULMO: 'M3 8h10a2.5 2.5 0 10-2.5-2.5M3 12h14a2.5 2.5 0 11-2.5 2.5M3 16h8',
  REHAB_CARDIAC: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z',
  PD_SESSION: 'M12 3v9m0 0l-3-3m3 3l3-3M5 15h14v4a2 2 0 01-2 2H7a2 2 0 01-2-2v-4z',
};

// 코드 검색 타입은 공용 정본(CodeItem)을 쓴다 — 로컬 정의가 정본과 어긋나며 계속 벌어졌다
type CodeSearchResultExtended = CodeItem;

interface AllergyBannerItem {
  id: string;
  allergen: string;
}

interface DifferentialDiagnosis {
  diagnosis_ko?: string;
  diagnosis?: string;
  icd10?: string;
  probability?: string;
  supporting?: string[];
}

type CodeSearchResult = CodeItem;

interface PrescriptionItem {
  /** 서버 처방 상태 — DISCONTINUED(중단)면 목록에 남기고 표시한다(지우지 않는다) */
  status?: 'ACTIVE' | 'DISCONTINUED';
  dispensingType?: 'INTERNAL' | 'EXTERNAL';
  id?: string;
  type: PrescriptionTab;
  codeId: string;
  codeName: string;
  codeValue: string;
  dosage?: string;
  frequency?: string;
  duration?: number;
  quantity?: number;
  route?: string;
  priority?: string;
  unitPrice?: number;
  insuranceCode?: string;
}

// 약품 급여 판정: 급여목록 등재 = 약가(unitPrice) 보유 기준.
// 표준코드 임포트가 전 품목에 insuranceCode를 채워 presence 판정이 무력화됨
// (비급여 미등재 ~2천 품목이 급여로 오표기·동의 모달 미발동). 수가(검사/영상)는 insuranceCode 판정 유지.
const isDrugCovered = (c: { unitPrice?: number | null }) => c.unitPrice != null && c.unitPrice > 0;

/** 진료 문서 출력 — 라벨·아이콘 정본(헤더 버튼에서 사용). kind 는 /print/<kind>/<encounterId> 경로와 일치 */
const DOC_PRINTS = [
  { kind: 'prescription', label: '처방전', icon: 'M6.72 13.83c-.24.03-.48.06-.72.1m.72-.1a42.4 42.4 0 0110.56 0m-10.56 0L6.34 18m10.94-4.17c.24.03.48.06.72.1m-.72-.1L17.66 18m0 0l.23 2.52a1.13 1.13 0 01-1.12 1.23H7.23c-.66 0-1.18-.57-1.12-1.23L6.34 18m11.32 0h1.09A2.25 2.25 0 0021 15.75V9.46c0-1.08-.77-2.02-1.84-2.18a48 48 0 00-1.91-.25M6.34 18H5.25A2.25 2.25 0 013 15.75V9.46c0-1.08.77-2.02 1.84-2.18a48 48 0 011.91-.25m10.5 0a48.5 48.5 0 00-10.5 0m10.5 0V3.38c0-.62-.5-1.13-1.13-1.13h-8.25c-.62 0-1.12.5-1.12 1.13v3.65' },
  // 진단서·소견서는 **발급 대장**(진단서 발급 화면)으로 — 종전 머리 버튼은 대장·수수료·발급번호 없이 진료기록을 곧장 인쇄했다(2026-09-30)
  { kind: 'diagnosis', label: '진단서', certType: 'DIAGNOSIS_CERT', icon: 'M19.5 14.25v-2.63a3.38 3.38 0 00-3.38-3.37h-1.5a1.13 1.13 0 01-1.12-1.13v-1.5a3.38 3.38 0 00-3.38-3.37H8.25m2.25 0H5.63c-.62 0-1.13.5-1.13 1.12v17.25c0 .62.5 1.13 1.13 1.13h12.75c.62 0 1.12-.5 1.12-1.13V11.25a9 9 0 00-9-9z' },
  { kind: 'opinion', label: '소견서', certType: 'OPINION', icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.11c0-1.14-.85-2.1-1.98-2.19a48.4 48.4 0 00-1.12-.08m-5.8 0c-.07.21-.1.43-.1.66 0 .42.34.75.75.75h4.5a.75.75 0 00.75-.75c0-.23-.04-.45-.1-.66m-5.8 0A2.25 2.25 0 0113.5 2.25H15c1.01 0 1.87.67 2.15 1.59m-5.8 0c-.38.02-.75.05-1.13.08C9.1 4.01 8.25 4.97 8.25 6.11V8.25m0 0H4.88c-.63 0-1.13.5-1.13 1.13v11.25c0 .62.5 1.12 1.13 1.12h9.75c.62 0 1.12-.5 1.12-1.12V9.38c0-.63-.5-1.13-1.12-1.13H8.25z' },
] as const;

export default function NewEncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const tA = useTAttr();
  const { id: patientId } = use(params);
  /** 문서는 탭이 아니라 **새 창** — 진료 입력 화면을 가리지 않고 나란히 두고 인쇄한다(종류별 창 재사용) */
  const openDoc = (url: string, kind: string) => {
    if (!openDocumentWindow(url, kind)) toast.error('팝업이 차단되었습니다 — 브라우저에서 팝업 허용 후 다시 눌러 주세요');
  };
  const router = useRouter();
  const { user } = useAuthStore();
  const specialtyLayout = getSpecialtyLayout(user?.department);
  const { data: patientData, isLoading: patientLoading, isError: patientError, error: patientErr, refetch: patientRefetch } = usePatient(patientId);
  const createEncounter = useCreateEncounter();
  const updateEncounter = useUpdateEncounter();
  const signEncounter = useSignEncounter();
  const addPrescription = useAddPrescription();
  const cancelPrescription = useCancelPrescription();
  const createBilling = useCreateBilling();

  // 큐 진료시작에서 이미 생성된 Encounter를 재사용(?encounterId=) — 중복 Encounter 생성 방지
  // (미전달 시에만 신규 생성) → 서명 대상과 큐.encounterId 일치 보장 → 수납 연동 유지
  const [encounterId, setEncounterId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return new URLSearchParams(window.location.search).get('encounterId');
    return null;
  });
  // 재진입(?encounterId=)이면 기존 진료 내용(SOAP/진단/처방)을 로드 — 미로딩 시 빈값 저장으로 기록 덮어쓰기·처방 중복 방지.
  const [reEntryEncounterId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return new URLSearchParams(window.location.search).get('encounterId');
    return null;
  });
  const [hydrated, setHydrated] = useState<boolean>(!(typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('encounterId')));
  const [isCreating, setIsCreating] = useState(false);
  const applyingSetRef = useRef(false); // 오더세트 적용 재진입(연타 중복 처방) 방지
  const [createError, setCreateError] = useState<string | null>(null);
  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  // 앰비언트 대화 → SOAP 반영은 항상 **append**(수기 입력 덮어쓰기 금지·중복 문장 재부착 안 함)
  const appendSoap = useCallback((field: 'subjective' | 'objective' | 'assessment' | 'plan', text: string) => {
    setSoap(prev => {
      const base = prev[field] ?? '';
      const add = text.trim();
      if (!add || base.includes(add)) return prev;
      return { ...prev, [field]: base.trim() ? `${base.replace(/\s+$/, '')}\n${add}` : add };
    });
  }, []);
  // G5 — 대화 전사 누락 미확인 시 서명 차단(패널이 신호)
  const [ambientGate, setAmbientGate] = useState<{ blocked: boolean; reason?: string }>({ blocked: false });
  const [diagnoses, setDiagnoses] = useState<DiagnosisItem[]>([]);
  const [pendingDocs, setPendingDocs] = useState<Array<{ certType: string; name: string }>>([]);
  const [soapSaved, setSoapSaved] = useState(false);
  // 🔴 초안≠확정 — AI 초안이 SOAP 에 적용된 사실(프로비넌스). 서명 전까지 배너로 보이고, 적용 사실은 감사 원장에 남긴다(§7.6-b)
  const [soapDraftProvenance, setSoapDraftProvenance] = useState<DraftProvenance | null>(null);
  /**
   * @param proposal 제안 원장 연결(P1) — `proposalId` 가 있으면 이 적용이 **사람 결정(ACCEPTED)** 으로 원장에 남고,
   *   `finalText` 로 서버가 편집거리를 잰다.
   *   🔴 적용 버튼은 초안을 **그대로** 넣는다(그 자리에서 편집할 수단이 화면에 없다) → 결정은 `ACCEPTED`.
   *      사람이 그 뒤 폼에서 고친 양은 서명 시 `/ai/draft-outcome`(무수정 승인율)이 따로 잰다 — 두 축은 다른 사실이다.
   *   🔴 `finalText` 직렬화는 서버 `serializeSoapDraft`(A\nP)와 **같은 규칙**이어야 편집거리가 사실이 된다.
   */
  const markSoapDraftApplied = (
    source: DraftSource,
    fields: string[],
    textLength: number,
    proposal?: { proposalId?: string | null; finalText?: string },
  ) => {
    const appliedAt = new Date().toISOString();
    setSoapDraftProvenance((prev) => ({
      source,
      fields: Array.from(new Set([...(prev?.fields ?? []), ...fields])),
      appliedAt,
      model: prev?.model ?? null,
      recorded: null,
      proposalId: proposal?.proposalId ?? prev?.proposalId ?? null,
    }));
    void recordDraftApplied({
      resourceType: 'ENCOUNTER_SOAP',
      source,
      patientId,
      resourceId: encounterId ?? undefined,
      field: fields.join(','),
      textLength,
      ...(proposal?.proposalId ? { proposalId: proposal.proposalId, decision: 'ACCEPTED' as const, clientContext: 'encounter-new' } : {}),
      ...(proposal?.proposalId && proposal.finalText != null ? { finalText: proposal.finalText } : {}),
    })
      .then((recorded) => setSoapDraftProvenance((prev) => (prev ? { ...prev, recorded } : prev)));
  };

  // 🔴 무수정 승인율(기획서 §4.5) — "적용된 초안" 과 "서명 시점의 최종 A/P" 를 서버가 편집 거리로 잰다.
  //    · 초안이 적용된 적이 없으면 **부르지 않는다**(편집거리 0 행은 사실이 아니라 잡음이다)
  //    · 서명을 절대 막거나 늦추지 않는다(fire-and-forget · PreSignQaChecklist 와 같은 비차단 규약)
  //    · 비율은 여기서 그리지 않는다(관제 화면의 몫)
  const appliedDraftRef = useRef<{ source: DraftSource; field: string; text: string } | null>(null);
  const apTextOf = (a?: string | null, p?: string | null) => [a, p].filter(Boolean).join('\n');
  const [draftOutcomeRecorded, setDraftOutcomeRecorded] = useState<boolean | null>(null);
  const rememberAppliedDraft = (source: DraftSource, assessment: string, plan: string) => {
    const text = apTextOf(assessment, plan);
    if (!text.trim()) return;
    appliedDraftRef.current = { source, field: 'assessment,plan', text };
    setDraftOutcomeRecorded(null);
  };
  const reportDraftOutcome = (eff: typeof soap): void => {
    const applied = appliedDraftRef.current;
    if (!applied) return; // AI 초안을 적용한 적이 없다 — 보고할 것이 없다
    const finalText = apTextOf(eff.assessment, eff.plan);
    if (!finalText.trim()) return;
    apiClient.post<{ data?: { recorded?: boolean } }>('/api/v1/ai/draft-outcome', {
      resourceType: 'ENCOUNTER_SOAP',
      source: applied.source,
      patientId,
      ...(encounterId ? { resourceId: encounterId } : {}),
      field: applied.field,
      draftText: applied.text,
      finalText,
    })
      .then((r) => setDraftOutcomeRecorded(!!r?.data?.recorded))
      .catch(() => setDraftOutcomeRecorded(false));
  };
  const [recordMode, setRecordMode] = useState<'soap' | 'structured'>('soap');
  const [structured, setStructured] = useState({
    chiefComplaint: '',
    historyPresentIllness: '',
    pastMedicalHistory: '',
    familyHistory: '',
    // 🔴 쓰기 폼 초기값은 '미선택' — 종전 '비흡연·음주 없음'이 묻지 않은 사회력으로 저장·서명됐다(2026-09-30)
    socialHistory: { smoking: '', alcohol: '', occupation: '' },
    reviewOfSystems: {} as Record<string, { normal: boolean; findings: string }>,
    physicalExamination: {} as Record<string, { normal: boolean; findings: string }>,
  });
  const [activeTab, setActiveTab] = useState<PrescriptionTab>('MEDICATION');
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[]>([]);
  // 비처방 역할(간호사·임상병리사)의 대리입력 — 책임 처방의 지정 + 그 의사의 승인.
  // 🔴 종전엔 이 화면만 역할 게이팅이 없어, 간호사가 처방을 다 입력한 뒤 **저장 시점에 403** 을 봤다.
  //    /orders·워크스테이션과 같은 공용 부품을 쓴다(따로 구현하면 또 어긋난다).
  const delegate = usePrescriberDelegate(encounterId);

  // 재진입 시 기존 Encounter 로드 → SOAP/진단/처방 hydrate(최초 1회). 로드 완료 전 저장/서명은 차단.
  const existingEncounter = useEncounter(reEntryEncounterId ?? '');
  /**
   * 서명된 진료기록을 다시 열었으면 이 저장은 **정정**이다(서버가 직전 서명본을 보존하고 AMENDED 로 바꾼다 · 2026-10-03).
   * 정정 사유는 선택 입력 — 강제하면 아무 값이나 넣고 넘어간다. 서명본 → 정정으로 넘어가는 그 저장에만 보존본에 남는다.
   */
  const reEntryStatus = ((existingEncounter.data?.data ?? existingEncounter.data) as Record<string, unknown> | undefined)?.status as string | undefined;
  const amendingSigned = !!reEntryEncounterId && reEntryStatus === 'SIGNED';
  const [amendmentReason, setAmendmentReason] = useState('');
  const amendExtra = () => (amendingSigned && amendmentReason.trim() ? { amendmentReason: amendmentReason.trim() } : {});
  useEffect(() => {
    if (hydrated || !reEntryEncounterId) return;
    const raw = (existingEncounter.data?.data ?? existingEncounter.data) as Record<string, unknown> | undefined;
    if (!raw) return;
    setSoap({
      subjective: (raw.subjective as string) ?? '', objective: (raw.objective as string) ?? '',
      assessment: (raw.assessment as string) ?? '', plan: (raw.plan as string) ?? '',
    });
    // 🔴 구조화 문진도 불러온다(2026-10-03) — 종전엔 불러오지 않아, 재진입 후 '구조화 저장'이 빈 칸으로 기존 값을 덮을 수 있었다
    //    (서버가 저장하지 않던 동안엔 드러나지 않았다). 사회력은 '미선택' 초기값 모양을 유지한 채 저장된 값만 덮는다.
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
    setStructured((prev) => ({
      chiefComplaint: (raw.chiefComplaint as string) ?? '',
      historyPresentIllness: (raw.historyPresentIllness as string) ?? '',
      pastMedicalHistory: (raw.pastMedicalHistory as string) ?? '',
      familyHistory: (raw.familyHistory as string) ?? '',
      socialHistory: { ...prev.socialHistory, ...(obj(raw.socialHistory) as typeof prev.socialHistory | null ?? {}) },
      reviewOfSystems: (obj(raw.reviewOfSystems) as typeof prev.reviewOfSystems | null) ?? prev.reviewOfSystems,
      physicalExamination: (obj(raw.physicalExamination) as typeof prev.physicalExamination | null) ?? prev.physicalExamination,
    }));
    if (Array.isArray(raw.diagnoses)) {
      setDiagnoses((raw.diagnoses as Record<string, unknown>[]).map((d) => {
        const dc = d.diagnosisCode as Record<string, unknown> | undefined;
        return { diagnosisCodeId: d.diagnosisCodeId, code: dc?.code ?? '', nameKo: dc?.nameKo ?? '', nameEn: dc?.nameEn ?? null, type: d.type ?? 'SECONDARY', certainty: d.certainty ?? 'CONFIRMED' } as unknown as DiagnosisItem;
      }));
    }
    if (Array.isArray(raw.prescriptions)) {
      setPrescriptions((raw.prescriptions as Record<string, unknown>[])
        // 중단(2026-09-30)된 처방도 보여 준다(읽기 전용 · '중단' 배지) — 거르면 재진입 때 조용히 사라진다
        .filter((p) => p.status === 'ACTIVE' || p.status === 'DISCONTINUED')
        .map((p) => {
          const mc = p.medicationCode as Record<string, unknown> | undefined;
          const pc = p.procedureCode as Record<string, unknown> | undefined;
          return {
            id: p.id, type: p.type,
            codeId: (p.medicationCodeId ?? p.procedureCodeId ?? '') as string,
            codeName: (mc?.nameKo ?? pc?.nameKo ?? p.instructions ?? '') as string,
            codeValue: (mc?.code ?? pc?.code ?? '') as string,
            dosage: p.dosage, frequency: p.frequency, duration: p.duration, quantity: p.quantity, route: p.route,
            status: p.status, dispensingType: p.dispensingType,
          } as unknown as PrescriptionItem;
        }));
    }
    setHydrated(true);
  }, [existingEncounter.data, hydrated, reEntryEncounterId]);

  const [durWarnings, setDurWarnings] = useState<DurWarning[]>([]);
  /** 약 선택 즉시 DUR 사전점검 실패(약 이름) — 실패를 '경고 없음'으로 두지 않는다 */
  const [durPrecheckFailed, setDurPrecheckFailed] = useState<string | null>(null);
  // DUR ERROR로 차단된 처방의 강제처방(override) 컨텍스트 — 사유 입력 후 재전송
  // delegateBody 를 함께 들고 있는다 — 승인 토큰은 1회 소비라 강제처방 재전송 때 **새로 받아야** 한다
  const [durBlock, setDurBlock] = useState<{ payload: { type: string } & Record<string, unknown>; delegateBody: DelegateBody; warnings: DurWarning[]; rx: PrescriptionItem; codeName: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [drugInteractions, setDrugInteractions] = useState<{ severity: string; drug1: string; drug2: string; description: string }[]>([]);
  const [drugInteractionLoading, setDrugInteractionLoading] = useState(false);
  const [drugInteractionFailed, setDrugInteractionFailed] = useState(false);
  const [showCpPanel, setShowCpPanel] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  // AI responses have varied/dynamic shapes — typed as AiResultData
  const [aiResult, setAiResult] = useState<AiResult | null>(null);

  // 차트 템플릿 상태
  const [useChartTemplate, setUseChartTemplate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ChartTemplate | null>(null);
  const [chartValues, setChartValues] = useState<Record<string, unknown>>({});
  const clinicalCapture = useClinicalChartCaptureStore();
  // 직전 합성분 — 다시 합성할 때 이 부분만 교체해 의사가 직접 친 문장을 보존한다
  const chartComposedRef = useRef<Partial<Record<SoapSlot, string>>>({});
  const chartSections = ((selectedTemplate?.sections ?? []) as unknown as ChartSectionDef[]);

  /**
   * 🔴 E1/E2 — 종전엔 `chartValues` 가 **어떤 요청에도 실리지 않았고**(저장 경로 자체가 없었다),
   *    SOAP 매핑도 `setSoap(prev => ({...prev,[mappedTo]: value}))` 대입이라 같은 슬롯끼리 서로
   *    덮어썼다(내과 외래 초진: objective 6필드 → 마지막 하나만 생존).
   *    이제 값 전체를 라벨과 함께 SOAP 본문으로 합성한다 — 매핑 없는 필드도 버리지 않는다.
   */
  const handleChartFieldChange = (fieldId: string, value: unknown) => {
    const nextValues = { ...chartValues, [fieldId]: value };
    setChartValues(nextValues);
    const { soap: nextSoap, composed } = applyChartValuesToSoap(
      soap, chartComposedRef.current, chartSections, nextValues, selectedTemplate?.name ?? '차트 템플릿',
    );
    chartComposedRef.current = composed;
    setSoap(nextSoap);
  };

  // Code search state
  // 검색 상태·로직은 공용 훅(정본) — CPOE 모달·/orders 와 같은 것을 쓴다(따로 구현하면 또 어긋난다)
  const codeSearch = useCodeSearch(activeTab);
  const { query: codeQuery, setQuery: setCodeQuery, results: codeResults, open: showDropdown, setOpen: setShowDropdown, searching: isSearching, search: searchCodes } = codeSearch;
  const [selectedCode, setSelectedCode] = useState<CodeSearchResult | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Medication fields
  // 🔴 쓰기 폼 초기값은 '미선택' — 종전 5일·15개·경구가 기본으로 깔려, 바꾸지 않으면 주사제도 경구 5일로 나갔다(2026-09-30)
  const EMPTY_MED_FORM = { dosage: '', frequency: '', duration: null as number | null, quantity: null as number | null, route: '', priority: 'ROUTINE' };
  const [medForm, setMedForm] = useState(EMPTY_MED_FORM);
  // 원내/원외 조제 — 종전엔 진료 화면에 선택이 없어 서버 기본값(원내)으로만 저장됐고, 인쇄 처방전은 '원외'를 고정 표기했다.
  // 서버 기본값과 같은 '원내'에서 시작하되 화면에 드러낸다(숨은 기본값 금지 · 2026-09-30).
  const [dispensingType, setDispensingType] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');

  const [isSigning, setIsSigning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [signCompleted, setSignCompleted] = useState(false);

  // 비급여 동의 확인 상태
  const [showNonCoveredConsent, setShowNonCoveredConsent] = useState(false);
  const [pendingNonCoveredRx, setPendingNonCoveredRx] = useState<{code: CodeSearchResult; payload: null} | null>(null);

  const { data: pastEncounters } = usePatientEncounters(patientId);
  const _pastRaw = pastEncounters?.data;
  const _pastAll: EncounterWithRelations[] = Array.isArray(_pastRaw) ? _pastRaw : (_pastRaw as Record<string, unknown> | undefined)?.data as EncounterWithRelations[] ?? [];
  // 빈 진료기록 (SOAP 미입력 + DRAFT) 필터링
  const pastEncList = _pastAll.filter(e => e.status !== 'DRAFT' || e.subjective || e.objective || e.assessment || e.plan);
  const patient = patientData?.data;
  // AI 어시스턴트 맥락 — 이 환자·이 진료·**작성 중 SOAP**(보내는 순간의 화면 값)를 건다.
  //   🔴 종전엔 맥락을 거는 화면이 없어 `/요약` 이 "진료 작성 화면에서 사용해주세요"로 늘 실패했다.
  useAiAssistantContext(
    patient ? { patientId, patientName: `${patient.familyName ?? ''}${patient.givenName ?? ''}`, encounterId, department: user?.department ?? null, surface: 'ENCOUNTER' } : null,
    soap,
  );

  // 알레르기 문진 상태(NKA 안전) — "미문진"과 "무알레르기 확인"을 구별해 오안심 방지
  // 🔴 조회 실패·로딩을 'NOT_ASSESSED'(미확인)로 접지 않는다 — 종전엔 실패하면 페니실린 알레르기 환자가 "미확인"+[무알레르기 확인] 버튼으로 보였다
  const { data: allergyStatusData, isError: allergyIsError, isLoading: allergyLoading, refetch: refetchAllergy } = useQuery({
    queryKey: ['patient-allergy-status', patientId],
    queryFn: () => apiClient.get<{ data: { status: string; assessedAt: string | null; allergies: AllergyBannerItem[] } }>(`/api/v1/patients/${patientId}/allergies/status`),
    enabled: !!patientId,
  });
  const _sRaw = allergyStatusData?.data as { status?: string; assessedAt?: string | null; allergies?: AllergyBannerItem[]; data?: unknown } | undefined;
  const allergyStatusObj = (_sRaw?.status ? _sRaw : (_sRaw?.data as typeof _sRaw)) ?? {};
  const allergyStatus: string = allergyIsError ? 'ERROR' : allergyLoading ? 'LOADING' : (allergyStatusObj.status ?? 'NOT_ASSESSED');
  const activeAllergies: AllergyBannerItem[] = allergyStatusObj.allergies ?? [];
  const allergyAssessedAt: string | null = allergyStatusObj.assessedAt ?? null;

  // 감염 격리 상태(활성 격리 오더 → 배너 경고·PPE)
  // 조회 실패를 '격리 없음'(+ 격리 지시 버튼)으로 그리지 않는다
  const { data: isolationData, isError: isolationIsError, isLoading: isolationLoading, refetch: refetchIsolation } = useQuery({
    queryKey: ['patient-isolation-status', patientId],
    queryFn: () => apiClient.get<{ data: { isolated: boolean; precautions: { id: string; type: string; reason?: string; protocol?: { requiredPPE?: string[] } }[] } }>(`/api/v1/infection-control/isolation/patient/${patientId}`),
    enabled: !!patientId,
  });
  const _isoRaw = isolationData?.data as { isolated?: boolean; precautions?: { id: string; type: string; reason?: string; protocol?: { requiredPPE?: string[] } }[]; data?: unknown } | undefined;
  const isoObj = (_isoRaw && 'isolated' in _isoRaw ? _isoRaw : (_isoRaw?.data as typeof _isoRaw)) ?? {};
  const isolationPrecautions = isoObj.precautions ?? [];
  const ISO_LABEL: Record<string, string> = { STANDARD: '표준주의', CONTACT: '접촉주의', DROPLET: '비말주의', AIRBORNE: '공기주의', PROTECTIVE: '역격리', STRICT: '엄격격리' };

  const allergyQc = useQueryClient();

  // 격리 오더 발행/해제
  const [showIsoForm, setShowIsoForm] = useState(false);
  const [isoType, setIsoType] = useState('CONTACT');
  const [isoReason, setIsoReason] = useState('');
  const isoOrderMut = useMutation({
    mutationFn: (payload: { isolationType: string; reason: string }) =>
      apiClient.post(`/api/v1/infection-control/isolation/assign`, { patientId, isolationType: payload.isolationType, reason: payload.reason }),
    onSuccess: () => {
      allergyQc.invalidateQueries({ queryKey: ['patient-isolation-status', patientId] });
      toast.success('격리 오더를 발행했습니다');
      setShowIsoForm(false); setIsoReason('');
    },
    onError: () => toast.error('격리 오더 발행 실패'),
  });
  const isoReleaseMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => apiClient.put(`/api/v1/infection-control/isolation/${id}/release`, { reason: '해제' }))),
    onSuccess: () => {
      allergyQc.invalidateQueries({ queryKey: ['patient-isolation-status', patientId] });
      toast.success('격리를 해제했습니다');
    },
    onError: () => toast.error('격리 해제 실패'),
  });

  // NKA 문진 기록(화면에서 "무알레르기 확인"/"문진 불가" 기록 → 미확인 경고 해소)
  const assessAllergyMut = useMutation({
    mutationFn: (result: 'NO_KNOWN_ALLERGIES' | 'UNABLE_TO_ASSESS') =>
      apiClient.post(`/api/v1/patients/${patientId}/allergies/assessment`, { result }),
    onSuccess: (_r, result) => {
      allergyQc.invalidateQueries({ queryKey: ['patient-allergy-status', patientId] });
      toast.success(result === 'NO_KNOWN_ALLERGIES' ? '무알레르기로 확인 기록했습니다' : '문진 불가로 기록했습니다');
    },
    onError: () => toast.error('알레르기 문진 기록 실패'),
  });

  // 문진표 응답 조회
  const { data: questionnaireData } = useQuery({
    queryKey: ['patient-questionnaires-encounter', patientId],
    queryFn: () => apiClient.get<{ data: QuestionnaireResponse[] }>(`/api/v1/patients/${patientId}/questionnaires`),
    enabled: !!patientId,
  });
  const _qRaw = questionnaireData?.data;
  const questionnaires = (Array.isArray(_qRaw) ? _qRaw : (_qRaw as Record<string, unknown> | undefined)?.data as QuestionnaireResponse[] ?? []).filter((q: QuestionnaireResponse) => q.status === 'COMPLETED' && q.submission);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  // 문진표 검토 완료 — 진료 화면에서 바로(환자 문진 탭과 같은 EP). 🔴 검토 완료 ≠ 임상 기록 확정(화면이 말한다).
  const questionnaireQc = useQueryClient();
  const reviewQuestionnaire = useMutation({
    mutationFn: (id: string) => apiClient.put<{ data: { alreadyReviewed: boolean } }>(`/api/v1/admin/questionnaire/review/${id}`),
    onSuccess: (r) => {
      if (r?.data?.alreadyReviewed) toast.info(tA('이미 다른 사람이 검토했습니다'));
      questionnaireQc.invalidateQueries({ queryKey: ['patient-questionnaires-encounter', patientId] });
      questionnaireQc.invalidateQueries({ queryKey: ['patient-questionnaires', patientId] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tA('검토 완료 표시 실패')),
  });

  // 간호사 측정 바이탈 조회
  interface NurseVital {
    systolicBp?: number | null;
    diastolicBp?: number | null;
    heartRate?: number | null;
    spo2?: number | null;
    temperature?: number | null;
    weight?: number | null;
    measuredAt?: string;
    isAbnormal?: boolean;
    /** 서버가 임계 정본(shared + 환자안전위 개정)으로 판정한 항목별 표시(2026-10-01) */
    flags?: Partial<Record<'systolicBp' | 'diastolicBp' | 'heartRate' | 'spo2' | 'temperature', VitalItemFlag>>;
  }
  // 🔴 조회 실패를 "바이탈 미측정 — 간호사에게 요청"으로 말하지 않는다(실패 ≠ 없음)
  const { data: vitalsData, isError: vitalsIsError, error: vitalsErr, refetch: refetchVitals } = useQuery({
    queryKey: ['nurse-vitals-encounter', patientId],
    queryFn: () => apiClient.get<{ data: NurseVital[]; meta?: { vitalsRule?: { source: 'CONFIGURED' | 'DEFAULT'; droppedKeys?: string[]; invertedKeys?: string[] } } }>(`/api/v1/nurse-station/vitals/patient/${patientId}`),
    enabled: !!patientId,
  });
  const _vitalsRaw = vitalsData?.data;
  const nurseVitals: NurseVital[] = Array.isArray(_vitalsRaw) ? _vitalsRaw : (_vitalsRaw as Record<string, unknown> | undefined)?.data as NurseVital[] ?? [];
  const latestVital = nurseVitals.length > 0 ? nurseVitals[0] : null;

  // 입원/응급 환자는 활력징후 필수, 외래는 권고 — 현재 입원중(ADMITTED) 여부로 판정
  const { data: admissionData, isError: admIsError, error: admError, refetch: refetchAdm } = useQuery({
    queryKey: ['patient-admission', patientId],
    queryFn: () => apiClient.get<{ data: Array<{ status?: string }> }>(`/api/v1/inpatient/patient/${patientId}`).then((r) => r.data),
    enabled: !!patientId,
  });
  const admRows = Array.isArray(admissionData) ? admissionData : ((admissionData as { data?: Array<{ status?: string }> } | undefined)?.data ?? []);
  const requireVitals = admRows.some((a) => a?.status === 'ADMITTED');

  // 원내 처방집 시행 모드(OFF/WARN/BLOCK) — 비승인 코드 처방 게이트
  const { data: fmPolicyData, isError: fmPolicyIsError, error: fmPolicyError, refetch: refetchFmPolicy } = useQuery({
    queryKey: ['fm-policy'],
    queryFn: () => apiClient.get<{ data: Record<string, string> }>('/api/v1/formulary/policy'),
    staleTime: 5 * 60 * 1000,
  });
  const fmPolicy: Record<string, string> = (fmPolicyData?.data as unknown as { data?: Record<string, string> })?.data ?? (fmPolicyData?.data as Record<string, string>) ?? {};

  // 간호지시 — NIC(간호중재분류) 표준 코드(DB 50종·도메인 필터)
  interface NicCode { code: string; nameKo: string; domain?: string | null }
  const { data: nicData, isError: nicIsError, error: nicError, refetch: refetchNic } = useQuery({
    queryKey: ['nic-codes'],
    queryFn: () => apiClient.get<{ data: NicCode[] }>('/api/v1/codes/nursing', { codeSystem: 'NIC' }),
    staleTime: 10 * 60 * 1000,
  });
  const _nicRaw = nicData?.data;
  const nicList: NicCode[] = Array.isArray(_nicRaw) ? _nicRaw : ((_nicRaw as { data?: NicCode[] } | undefined)?.data ?? []);
  const [nicDomain, setNicDomain] = useState<string>('');
  const [nicFilter, setNicFilter] = useState('');
  const nicDomains = [...new Set(nicList.map((n) => n.domain).filter((d): d is string => !!d))];
  const nicShown = nicList.filter((n) => (!nicDomain || n.domain === nicDomain) && (!nicFilter || n.nameKo.includes(nicFilter) || n.code.includes(nicFilter)));

  // 진료 작성 중 환자 차트(참조) 분할 패널
  const [chartOpen, setChartOpen] = useState(false);
  // 고정(📌)해 둔 경우 진료 진입 시 자동 개방 — 폭·탭은 패널이 스스로 복원
  useEffect(() => { if (isChartDrawerPinned()) setChartOpen(true); }, []);
  // 참조 패널이 드래그로 조절된 폭(px) — 진료 본문이 그만큼 비켜서 **덮이지 않고 함께 보이게**
  const [chartWidthPx, setChartWidthPx] = useState<number | null>(null);
  const [chartExpanded, setChartExpanded] = useState(false); // 큰 화면(멀티패널 참조)
  // 활동/간호지시 다중 선택(여러 지시 동시 처방 — 각각 개별 처방 행 생성)
  const [presetSelection, setPresetSelection] = useState<{ code: string; name: string }[]>([]);
  // 검사/영상 다중 담기(검색→담기 반복→일괄 오더 — 각각 개별 처방 행 생성)
  const [codeSelection, setCodeSelection] = useState<CodeSearchResultExtended[]>([]);
  // 활동 제한 직접 입력(프리셋 외 자유 지시 — 예: 우측 하지 체중부하 금지)
  const [customActivity, setCustomActivity] = useState('');
  const [refWidth, setRefWidth] = useState<'narrow' | 'normal' | 'wide'>('normal'); // 콕핏 분할 비율
  // 콕핏 진입(큰 화면 board의 '진료 시작' → ?cockpit=1): 넓은 화면이면 참조를 자동 개방·확장
  const searchParams = useSearchParams();
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const w = localStorage.getItem('encounter-ref-width');
      if (w === 'narrow' || w === 'wide' || w === 'normal') setRefWidth(w);
    }
    if (searchParams.get('cockpit') === '1' && typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches) {
      setChartOpen(true);
      setChartExpanded(true);
    }
  }, [searchParams]);
  const cycleRefWidth = () => {
    setRefWidth((w) => {
      const next = w === 'narrow' ? 'normal' : w === 'normal' ? 'wide' : 'narrow';
      if (typeof window !== 'undefined') { try { localStorage.setItem('encounter-ref-width', next); } catch { /* ignore */ } }
      return next;
    });
  };
  // 참조 폭 → 본문 우측 패딩(정적 클래스로 Tailwind JIT 인식)
  const REF_PAD = { narrow: 'xl:pr-[700px]', normal: 'xl:pr-[900px]', wide: 'xl:pr-[1160px]' } as const;
  /**
   * 활력 이상 여부.
   *
   * 🔴 2026-08-19 봉합 전: 서버가 이미 준 `isAbnormal` **위에 화면이 자기 임계치를 얹고** 있었고,
   *    미측정을 전부 교과서 정상값으로 접었다(`spo2 ?? 100` · `temperature ?? 36.5` ·
   *    `heartRate ?? 72` · `systolicBp ?? 120`). 같은 값에 폴백이 둘(`?? 0` / `?? 120`)이라
   *    그 자체가 임의값이라는 자백이었고, 결과적으로 **활력을 하나도 안 잰 환자가 "정상"** 이었다.
   *    게다가 DBP 는 정본에 주의 임계가 아예 없는데 화면이 `>=90 / <60` 을 만들어냈고,
   *    무엇보다 **환자안전위가 config 로 임계를 개정해도 이 화면은 바뀌지 않았다.**
   *
   * 임계 정본은 서버다(`vitals-evaluate.VITALS_THRESHOLDS` + `clinical.vitals.thresholds`).
   * 화면은 서버 판정을 그대로 쓰고, **판정이 없으면 없다고 말한다**(false 로 접지 않는다).
   */
  /** 항목 색 — 서버 판정(위급 빨강·주의 주황·정상·판정 없음=회색). 🔴 화면에 임계 숫자를 두지 않는다(2026-10-01) */
  const vitalAbnormalFlag: boolean | null = latestVital
    ? abnormalOf(latestVital.isAbnormal, null)
    : null;
  const vitalIsAbnormal = vitalAbnormalFlag === true;

  const labelMap: Record<string, string> = {
    chiefComplaint: '주요 증상', onsetDuration: '시작 시기', severity: '정도', pattern: '양상',
    currentDiseases: '현재 질환', surgeryHistory: '수술력', traumaHistory: '외상력',
    currentMedications: '복용 약물', drugAllergy: '약물 알레르기', otherAllergy: '기타 알레르기',
    familyDiseases: '가족력', smoking: '흡연', drinking: '음주', exercise: '운동',
    pastHistory: '과거 병력', familyHistory: '가족력', allergies: '알레르기',
    symptomChange: '증상 변화', symptomDetail: '상세', compliance: '복약 순응',
    sideEffects: '부작용', painLocation: '통증 부위', painScale: '통증 정도',
  };

  // 문진표 → SOAP S 항목 자동 채움
  const applyQuestionnaireToSOAP = (submission: QuestionnaireSubmission) => {
    const d = submission.data;
    const parts: string[] = [];
    if (d.chiefComplaint) parts.push(`[주소] ${d.chiefComplaint}`);
    if (d.onsetDuration) parts.push(`[시작] ${d.onsetDuration}`);
    if (d.severity) parts.push(`[정도] ${d.severity}`);
    if (d.pattern) parts.push(`[양상] ${d.pattern}`);
    if (d.symptomChange) parts.push(`[변화] ${d.symptomChange}`);
    if (d.symptomDetail) parts.push(`[상세] ${d.symptomDetail}`);
    if (d.painLocation) parts.push(`[통증부위] ${d.painLocation}`);
    if (d.painScale) parts.push(`[통증정도] ${d.painScale}`);
    // 과거력은 별도
    const pmh: string[] = [];
    if (d.currentDiseases?.length) pmh.push(`기저질환: ${Array.isArray(d.currentDiseases) ? d.currentDiseases.join(', ') : d.currentDiseases}`);
    if (d.pastHistory) pmh.push(`과거력: ${d.pastHistory}`);
    if (d.surgeryHistory) pmh.push(`수술력: ${d.surgeryHistory}`);
    if (d.currentMedications) pmh.push(`복용약: ${d.currentMedications}`);
    if (d.drugAllergy) pmh.push(`약물알레르기: ${d.drugAllergy}`);
    if (d.smoking && d.smoking !== '비흡연' && d.smoking !== '피운 적 없음') pmh.push(`흡연: ${d.smoking}`);
    if (d.drinking && d.drinking !== '안 함' && d.drinking !== '전혀 안 마심') pmh.push(`음주: ${d.drinking}`);

    const subjective = parts.join('\n');
    const pmhText = pmh.length ? `\n[PMH] ${pmh.join(' / ')}` : '';

    setSoap(prev => ({
      ...prev,
      subjective: prev.subjective ? `${prev.subjective}\n\n--- 문진표 ---\n${subjective}${pmhText}` : `${subjective}${pmhText}`,
    }));
    setShowQuestionnaire(false);
    toast.success('문진표 응답이 SOAP에 반영되었습니다.');
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Start encounter manually
  const handleStartEncounter = async () => {
    if (encounterId || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await createEncounter.mutateAsync({ patientId });
      setEncounterId(res.data.id);
    } catch (err: unknown) {
      setIsCreating(false);
      const typedErr = err as MutationError;
      const msg = String(typedErr?.message || typedErr?.details || '');
      if (msg.includes('Forbidden') || msg.includes('403')) {
        setCreateError('진료 기록을 생성할 권한이 없습니다. 의사 또는 관리자 계정으로 로그인해주세요.');
      } else {
        setCreateError(`진료 생성 실패: ${msg || '알 수 없는 오류'}`);
      }
    }
  };

  // 페이지 진입 시 자동으로 진료 시작
  useEffect(() => {
    if (!encounterId && !isCreating && patient) {
      handleStartEncounter();
    }
  }, [patient]); // eslint-disable-line react-hooks/exhaustive-deps

  // 검색 실행은 공용 훅(codeSearch.search) — 빈 질의=둘러보기(핀→내 목록→과 카탈로그→전체)
  const handleCodeQueryChange = (value: string) => {
    setCodeQuery(value);
    setSelectedCode(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchCodes(value), 300);
  };

  // 원내 처방집 등재 요청 — 비승인 코드 클릭 시 사유 입력 후 위원회 심의함으로
  const requestFormulary = async (code: CodeSearchResultExtended) => {
    const reason = prompt(`『${code.nameKo}』 원내 처방집 등재 요청\n\n임상 사유를 입력하세요(필수):`);
    if (!reason?.trim()) return;
    try {
      await apiClient.post('/api/v1/formulary/requests', {
        domain: activeTab,
        codeId: code.id,
        codeLabel: `${code.code} ${code.nameKo}`,
        reason: reason.trim(),
      });
      toast.success('등재 요청이 접수되었습니다 — 위원회 심의 후 반영됩니다.');
    } catch {
      toast.error('등재 요청에 실패했습니다.');
    }
  };

  const handleSelectCode = (code: CodeSearchResultExtended) => {
    // 검사/영상 — 다중 담기: 선택 시 목록에 추가하고 검색창 비워 연속 검색
    if (activeTab === 'LAB' || activeTab === 'IMAGING') {
      setCodeSelection((prev) => (prev.some((c) => c.id === code.id) ? prev : [...prev, code]));
      setCodeQuery('');
      setShowDropdown(false);
      return;
    }
    setSelectedCode(code);
    setCodeQuery(`${code.code} - ${code.nameKo}`);
    setShowDropdown(false);
    // 실시간 DUR 사전점검 (약물 선택 즉시 고위험/LASA/상호작용 경고 — IPSG.3)
    if (activeTab === 'MEDICATION' && encounterId && code.id) {
      // 🔴 앞 약의 경고가 새 약 옆에 남지 않게 먼저 비운다
      setDurWarnings([]);
      setDurPrecheckFailed(null);
      apiClient.post<{ data?: { durWarnings?: DurWarning[] }; durWarnings?: DurWarning[] }>(
        `/api/v1/dur/check?encounterId=${encounterId}&medicationCodeId=${code.id}`,
      ).then((r) => {
        const w = ((r as { data?: { durWarnings?: DurWarning[] } })?.data?.durWarnings) ?? (r as { durWarnings?: DurWarning[] })?.durWarnings;
        setDurWarnings(w && w.length ? w : []);
        if (w?.some((x) => x.type === 'HIGH_ALERT' || x.type === 'LASA' || x.severity === 'ERROR')) {
          toast.warning(`${code.nameKo} — 안전 경고를 확인하세요.`);
        }
      }).catch((e) => { console.warn('DUR 사전점검 실패(비차단)', e); setDurPrecheckFailed(code.nameKo ?? code.code); });
    }
    /**
     * 🔴 프리필 값이 제형과 모순이면 **처방 입력 출발점부터 틀린다** — 2026-08-14(W7).
     *
     * 진료과 카탈로그 실측 8건 중 둘이 임상적으로 불가능한 조합이었다:
     * 덱사메타손 **주사** 5mg 을 `1C PO 28일`, 신선동결혈장(FFP) **혈액제제**를 `1T PO 30일`.
     * 그 값이 개인 약속처방(⭐고정·38회 사용)에 등재돼 이 폼을 채우고 있었다.
     * 서버가 판정해 보낸 모순을 **자동 적용 전에** 알린다(값은 넣되 조용히 넣지 않는다).
     */
    if (code.hasDosageIssue && code.dosageIssues?.length) {
      for (const issue of code.dosageIssues) {
        toast.warning(`${code.nameKo} — ${issue.message}. 기본값을 확인하세요.`);
      }
    }

    // 내 목록/과 카탈로그 기본값 자동 적용
    if (code.myDefaults) {
      const defaults = code.myDefaults;
      setMedForm(prev => ({
        ...prev,
        dosage: defaults.dosage || prev.dosage,
        frequency: defaults.frequency || prev.frequency,
        duration: defaults.duration || prev.duration,
        route: defaults.route || prev.route,
      }));
    } else if (code.deptGuide) {
      const guide = code.deptGuide;
      setMedForm(prev => ({
        ...prev,
        dosage: guide.defaultDosage || prev.dosage,
        frequency: guide.defaultFrequency || prev.frequency,
      }));
    }
  };

  // Save SOAP
  const handleSaveSOAP = async () => {
    if (!encounterId) return;
    if (!hydrated) { toast.error('기존 진료 기록을 불러오는 중입니다. 잠시 후 다시 시도하세요.'); return; }
    setIsSaving(true);
    try {
      await updateEncounter.mutateAsync({ id: encounterId, data: { ...soap, ...amendExtra() } });
      setSoapSaved(true);
      setTimeout(() => setSoapSaved(false), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  // Add prescription
  // 🔴 처방 추가 연타 — 성공해 선택이 풀리기 전까지 버튼이 살아 있어 같은 약이 두 번 나갔다(2026-09-30)
  const addingRxRef = useRef(false);
  const [addingRx, setAddingRx] = useState(false);
  const handleAddPrescription = async () => {
    if (addingRxRef.current) return;
    addingRxRef.current = true;
    setAddingRx(true);
    try { await addPrescriptionOnce(); } finally { addingRxRef.current = false; setAddingRx(false); }
  };
  const addPrescriptionOnce = async () => {
    if (!encounterId) return;

    // 원내 처방집 게이트(WARN/BLOCK) — 코드 기반 탭의 비승인 코드
    const fmMode = fmPolicy[activeTab] ?? 'OFF';
    if (fmMode !== 'OFF' && ['MEDICATION', 'LAB', 'IMAGING', 'DIET'].includes(activeTab)) {
      const targets = (activeTab === 'LAB' || activeTab === 'IMAGING') ? codeSelection : selectedCode ? [selectedCode] : [];
      // 폴백 검색(/codes/*) 결과는 formularyStatus 필드 자체가 없음(undefined) — 상태 미상을 비승인으로
      // 오차단하지 않고 안내 후 통과 (null=통합검색이 '비승인'으로 확정한 경우만 게이트 대상)
      const statusUnknown = targets.filter((c) => c.formularyStatus === undefined);
      if (statusUnknown.length > 0) {
        toast.info('원내 처방집 승인 상태를 확인할 수 없어 게이트 없이 진행합니다.');
      }
      const unapproved = targets.filter((c) => c.formularyStatus !== undefined && c.formularyStatus !== 'ACTIVE');
      if (unapproved.length > 0) {
        const names = unapproved.map((c) => c.nameKo).slice(0, 3).join(', ') + (unapproved.length > 3 ? ` 외 ${unapproved.length - 3}건` : '');
        if (fmMode === 'BLOCK') {
          toast.error(`원내 처방집 비승인 코드는 처방할 수 없습니다: ${names} — 검색 결과의 '등재요청'으로 위원회 심의를 요청하세요.`);
          return;
        }
        if (!confirm(`원내 처방집 비승인 코드가 포함되어 있습니다:\n${names}\n\n위원회 미승인 항목입니다(조제/시행 불가할 수 있음). 계속 처방하시겠습니까?`)) {
          return;
        }
      }
    }

    // 치료/활동/간호지시 — 다중 선택 일괄 처방(항목별 개별 행 → 개별 중단 가능)
    if ((activeTab === 'THERAPY' || activeTab === 'ACTIVITY' || activeTab === 'NURSING') && presetSelection.length > 0) {
      const created: PrescriptionItem[] = [];
      const failed: string[] = [];
      for (const p of presetSelection) {
        try {
          // 항목마다 개별 승인 — 승인 토큰은 1회 소비이고 처방 본문에 바인딩된다
          const auth = await delegate.authorize({ type: activeTab });
          if (!auth) throw new Error(delegate.error || '지정 처방의 승인을 받지 못했습니다.');
          const res = await addPrescription.mutateAsync({
            encounterId,
            data: { type: activeTab, priority: medForm.priority, instructions: p.name, ...auth.fields },
            headers: auth.headers,
          });
          created.push({ id: res.data?.id, type: activeTab, codeId: p.code, codeName: p.name, codeValue: p.code, priority: medForm.priority } as PrescriptionItem);
        } catch { failed.push(p.name); }
      }
      if (created.length) setPrescriptions([...prescriptions, ...created]);
      if (failed.length) toast.error(`실패: ${failed.join(', ')}`);
      else toast.success(`${activeTab === 'NURSING' ? '간호 지시' : activeTab === 'THERAPY' ? '치료 처방' : '활동 제한'} ${created.length}건이 추가되었습니다.`);
      setPresetSelection([]);
      return;
    }

    // 검사/영상 — 다중 담기 일괄 오더(항목별 개별 처방 행)
    if ((activeTab === 'LAB' || activeTab === 'IMAGING') && codeSelection.length > 0) {
      const primaryDx = diagnoses.find(d => d.type === 'PRIMARY')?.diagnosisCodeId;
      const created: PrescriptionItem[] = [];
      const failed: string[] = [];
      for (const c of codeSelection) {
        try {
          const auth = await delegate.authorize({ type: activeTab, procedureCodeId: c.id });
          if (!auth) throw new Error(delegate.error || '지정 처방의 승인을 받지 못했습니다.');
          const res = await addPrescription.mutateAsync({
            encounterId,
            data: { type: activeTab, priority: medForm.priority, procedureCodeId: c.id, ...(primaryDx ? { diagnosisCodeId: primaryDx } : {}), ...auth.fields },
            headers: auth.headers,
          });
          created.push({ id: res.data?.id, type: activeTab, codeId: c.id, codeName: c.nameKo, codeValue: c.code, priority: medForm.priority, unitPrice: c.unitPrice, insuranceCode: c.insuranceCode } as PrescriptionItem);
        } catch { failed.push(c.nameKo); }
      }
      if (created.length) setPrescriptions([...prescriptions, ...created]);
      if (failed.length) toast.error(`실패: ${failed.join(', ')}`);
      else toast.success(`${activeTab === 'LAB' ? '검사' : '영상'} 오더 ${created.length}건이 추가되었습니다.`);
      setCodeSelection([]);
      return;
    }

    if (!selectedCode) return;

    // 약 처방은 처방전 기재 항목(1회 용량·횟수·경로·일수·총량)이 다 있어야 한다 — 비어 있으면 무엇이 빠졌는지 말한다
    if (activeTab === 'MEDICATION') {
      const missing = [
        !medForm.dosage.trim() && '용량',
        !medForm.frequency.trim() && '투약 횟수',
        !medForm.route && '투여 경로',
        !(medForm.duration && medForm.duration > 0) && '투약 일수',
        !(medForm.quantity && medForm.quantity > 0) && '총 수량',
      ].filter(Boolean);
      if (missing.length) { toast.error(`입력하지 않은 항목: ${missing.join(', ')}`); return; }
    }

    // 비급여 항목 동의 확인
    if (activeTab === 'MEDICATION' && selectedCode && !isDrugCovered(selectedCode) && !showNonCoveredConsent) {
      setPendingNonCoveredRx({ code: selectedCode, payload: null });
      setShowNonCoveredConsent(true);
      return;
    }
    // 동의 완료 후 처방 진행 시 모달 닫기
    if (showNonCoveredConsent) {
      setShowNonCoveredConsent(false);
      setPendingNonCoveredRx(null);
    }

    const payload = {
      type: activeTab,
      priority: medForm.priority,
      // 관련 상병 자동 연결(G2-5) — 주상병 기준(SOAP A↔P 근거)
      ...(diagnoses.find(d => d.type === 'PRIMARY')?.diagnosisCodeId ? { diagnosisCodeId: diagnoses.find(d => d.type === 'PRIMARY')!.diagnosisCodeId } : {}),
      ...(activeTab === 'MEDICATION'
        ? {
            medicationCodeId: selectedCode.id,
            dosage: medForm.dosage,
            frequency: medForm.frequency,
            duration: medForm.duration ?? undefined,
            quantity: medForm.quantity ?? undefined,
            route: medForm.route,
            dispensingType,
          }
        : activeTab === 'THERAPY' || activeTab === 'ACTIVITY' || activeTab === 'NURSING'
          ? {
              // 프리셋 지시(수가코드 아님) — instructions만 전송(THERAPY 패턴)
              instructions: [selectedCode.nameKo ?? selectedCode.code, medForm.dosage].filter(Boolean).join(' · '),
            }
          : activeTab === 'DIET'
            ? {
                procedureCodeId: selectedCode.id,
                instructions: medForm.dosage || selectedCode.nameKo || selectedCode.code,
              }
            : {
                procedureCodeId: selectedCode.id,
              }),
    };

    // 승인 요청 본문 — 서버 bodyHash 와 필드·값이 같아야 한다(DUR 강제처방 재요청에도 재사용)
    const delegateBody: DelegateBody = {
      type: activeTab,
      ...(activeTab === 'MEDICATION'
        ? { medicationCodeId: selectedCode.id, dosage: medForm.dosage, frequency: medForm.frequency, duration: medForm.duration ?? undefined, quantity: medForm.quantity ?? undefined, route: medForm.route }
        : activeTab === 'THERAPY' || activeTab === 'ACTIVITY' || activeTab === 'NURSING'
          ? {}
          : { procedureCodeId: selectedCode.id }),
    };
    const auth = await delegate.authorize(delegateBody);
    if (!auth) { toast.error(delegate.error || '지정 처방의 승인을 받지 못했습니다.'); return; }
    Object.assign(payload as Record<string, unknown>, auth.fields);

    try {
      const res = await addPrescription.mutateAsync({ encounterId, data: payload, headers: auth.headers });
      const newRx: PrescriptionItem = {
        id: res.data?.id,
        type: activeTab,
        codeId: selectedCode.id,
        codeName: selectedCode.nameKo,
        codeValue: selectedCode.code,
        priority: medForm.priority,
        unitPrice: selectedCode.unitPrice ?? 0, // 검색에서 온 약은 약가 유무가 곧 급여 판정(없음=0=비급여) — 모름(undefined)과 구별
        insuranceCode: selectedCode.insuranceCode,
        ...(activeTab === 'MEDICATION' ? {
          dosage: medForm.dosage,
          frequency: medForm.frequency,
          duration: medForm.duration ?? undefined,
          quantity: medForm.quantity ?? undefined,
          route: medForm.route,
          dispensingType,
        } : {}),
      };
      const updatedPrescriptions = [...prescriptions, newRx];
      setPrescriptions(updatedPrescriptions);
      if (res.durWarnings?.length) {
        setDurWarnings(res.durWarnings);
        toast.warning('DUR 경고가 있습니다. 확인해주세요.');
      } else {
        toast.success(`${selectedCode.nameKo} 처방이 추가되었습니다.`);
      }

      // Auto drug interaction check when 2+ medications
      if (activeTab === 'MEDICATION') {
        checkDrugInteractions(updatedPrescriptions);
      }

      // Reset form
      setSelectedCode(null);
      codeSearch.reset();
      setMedForm(EMPTY_MED_FORM);
    } catch (err: unknown) {
      const typedErr = err as MutationError;
      const details = typedErr.details as Record<string, unknown> | undefined;
      if (details?.durWarnings) {
        // DUR ERROR 차단 — 강제처방 사유 입력 모달로 유도(처방 시점에 override 사유 기록)
        const warnings = details.durWarnings as DurWarning[];
        setDurWarnings(warnings);
        const rxSnapshot: PrescriptionItem = {
          type: activeTab, codeId: selectedCode.id, codeName: selectedCode.nameKo, codeValue: selectedCode.code,
          priority: medForm.priority, unitPrice: selectedCode.unitPrice ?? 0, insuranceCode: selectedCode.insuranceCode,
          ...(activeTab === 'MEDICATION' ? { dosage: medForm.dosage, frequency: medForm.frequency, duration: medForm.duration ?? undefined, quantity: medForm.quantity ?? undefined, route: medForm.route, dispensingType } : {}),
        };
        setDurBlock({ payload, delegateBody, warnings, rx: rxSnapshot, codeName: selectedCode.nameKo });
        setOverrideReason('');
      } else {
        toast.error(typedErr?.message || '처방 추가에 실패했습니다.');
      }
    }
  };

  // DUR 경고 무시 강제처방 — 사유와 함께 재전송(overrideDur+overrideReason)
  const handleForcePrescribe = async () => {
    if (!durBlock || !encounterId) return;
    // 🔴 사유 없는 강제 처방은 서버가 거부한다(DUR_OVERRIDE_REASON_REQUIRED) — 승인 절차를
    //    태우기 전에 이 자리에서 말한다(눌러 본 뒤 실패하면 지정 처방 승인이 헛되이 소비된다).
    if (!overrideReason.trim()) { toast.error('강제 처방 사유를 입력해 주세요 — 약국·심사 추적에 남습니다.'); return; }
    // 재전송도 처방 생성이다 — 앞선 승인 토큰은 이미 소비됐으므로 승인을 다시 받는다
    // (overrideDur·사유는 bodyHash 대상이 아니라 같은 본문으로 승인받으면 된다)
    const auth = await delegate.authorize(durBlock.delegateBody);
    if (!auth) { toast.error(delegate.error || '지정 처방의 승인을 받지 못했습니다.'); return; }
    try {
      const res = await addPrescription.mutateAsync({
        encounterId,
        data: {
          ...durBlock.payload, ...auth.fields,
          overrideDur: true, overrideReason: overrideReason.trim(),
        },
        headers: auth.headers,
      });
      const newRx: PrescriptionItem = { ...durBlock.rx, id: res.data?.id };
      const updated = [...prescriptions, newRx];
      setPrescriptions(updated);
      toast.success(`${durBlock.codeName} 강제 처방되었습니다(사유 기록).`);
      if (durBlock.rx.type === 'MEDICATION') checkDrugInteractions(updated);
      setDurBlock(null); setOverrideReason('');
      setSelectedCode(null); codeSearch.reset();
      setMedForm(EMPTY_MED_FORM);
    } catch (e) {
      toast.error((e as MutationError)?.message || '강제 처방에 실패했습니다.');
    }
  };

  // Drug interaction check
  const checkDrugInteractions = async (rxList: PrescriptionItem[]) => {
    const meds = rxList.filter(rx => rx.type === 'MEDICATION' && rx.status !== 'DISCONTINUED'); // 중단된 약은 상호작용 대상이 아니다
    // 약이 2종 미만이 되면(삭제 등) 앞선 결과를 남기지 않는다
    if (meds.length < 2) { setDrugInteractions([]); setDrugInteractionFailed(false); return; }
    setDrugInteractionLoading(true);
    try {
      const res = await apiClient.post<{ data: { interactions: { severity: string; drug1: string; drug2: string; description: string }[] } }>('/api/v1/ai/drug-interactions', {
        drugs: meds.map(m => m.codeName),
      });
      const data = (res.data as unknown as Record<string, unknown>)?.data as { interactions: Record<string, unknown>[] } ?? res.data;
      // 실응답 필드는 drug_a/drug_b(2026-07-07 운영 실측) — 구형 drug1/drug2도 방어적으로 수용
      const normalized = (data?.interactions ?? []).map((it: Record<string, unknown>) => ({
        severity: String(it.severity ?? ''),
        drug1: String(it.drug1 ?? it.drug_a ?? ''),
        drug2: String(it.drug2 ?? it.drug_b ?? ''),
        description: String(it.description ?? ''),
      }));
      if (normalized.length) {
        setDrugInteractions(normalized);
        toast.warning('약물 상호작용이 감지되었습니다. 확인해주세요.');
      } else {
        setDrugInteractions([]);
      }
      setDrugInteractionFailed(false);
    } catch {
      // 참고용 점검이라 막지는 않지만, 실패를 '상호작용 없음'으로 두지 않는다
      setDrugInteractions([]);
      setDrugInteractionFailed(true);
    } finally {
      setDrugInteractionLoading(false);
    }
  };

  // Remove prescription — 서버 영속 처방(id 보유)은 서버 취소까지 수행(로컬만 제거 시 유령 청구·검사 시행 방지)
  // 발효된 처방(투약 기록·시작된 오더)은 서버가 취소를 409 로 거부한다 → 중단(사유)으로 안내(2026-09-30)
  const [discontinueTarget, setDiscontinueTarget] = useState<{ id: string; name: string } | null>(null);
  const handleRemovePrescription = async (index: number) => {
    const rx = prescriptions[index];
    if (rx?.id) {
      try {
        await cancelPrescription.mutateAsync(rx.id);
      } catch (e) {
        if ((e as { code?: string })?.code === 'PRESCRIPTION_TOOK_EFFECT') {
          setDiscontinueTarget({ id: rx.id, name: rx.codeName });
          return;
        }
        toast.error((e as { message?: string })?.message || '처방 취소에 실패했습니다. 다시 시도해 주세요.');
        return; // 서버 취소 실패 시 로컬에서도 유지(불일치 방지)
      }
    }
    const remaining = prescriptions.filter((_, i) => i !== index);
    setPrescriptions(remaining);
    // 지운 약의 상호작용 경고가 남지 않게 남은 목록으로 다시 본다
    if (rx?.type === 'MEDICATION') void checkDrugInteractions(remaining);
  };

  // Save as draft
  // 전문과 레이아웃은 자체 soap 상태를 가지므로 서명/저장 시 그 값을 override 로 넘긴다.
  // (footer 버튼이 onClick 으로 직접 바인딩돼 이벤트가 들어올 수 있어 soap 키 유무로 가드)
  type SoapOverride = Partial<typeof soap>;
  const pickSoap = (o?: SoapOverride): typeof soap => {
    const valid = !!o && typeof o === 'object' && ('subjective' in o || 'objective' in o || 'assessment' in o || 'plan' in o);
    return valid ? { ...soap, ...o } : soap;
  };

  // 서명 전 기록품질(감시 모드 · 비차단) — chart-ai-assistant-agent §4.2 기록품질.
  // 🔴 서명을 이 결과에 걸지 않는다(가짜 게이트 금지). 호출은 서명과 병렬로 돌고, 15초 넘으면 실패라고 말한다.
  //    종전엔 handleSignAndBill 이 chart-qa 를 await 해 서명이 6~17초 멈췄고 결과는 toast 로 사라졌다.
  const [preSignQa, setPreSignQa] = useState<PreSignQaState>({ status: 'idle' });
  const preSignQaAbortRef = useRef<AbortController | null>(null);
  const preSignQaKeyOf = (eff: typeof soap) => JSON.stringify([encounterId, eff.subjective, eff.objective, eff.assessment, eff.plan]);
  const runPreSignQa = useCallback((eff: typeof soap): void => {
    const inputKey = JSON.stringify([encounterId, eff.subjective, eff.objective, eff.assessment, eff.plan]);
    preSignQaAbortRef.current?.abort();
    const controller = new AbortController();
    preSignQaAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    setPreSignQa({ status: 'running', startedAt: new Date().toISOString() });
    // 🔴 반환값을 기다리는 곳이 없어야 한다 — 서명은 이 promise 와 무관하게 진행된다
    apiClient.fetch<{ data: PreSignQaResult }>('/api/v1/ai/chart-qa', {
      method: 'POST',
      body: JSON.stringify({
        encounterId: encounterId || undefined,
        subjective: eff.subjective,
        objective: eff.objective || undefined,
        assessment: eff.assessment || undefined,
        plan: eff.plan || undefined,
      }),
      signal: controller.signal,
    }).then((res) => {
      if (preSignQaAbortRef.current !== controller) return;
      const data = ((res as unknown as Record<string, unknown>)?.data as PreSignQaResult | undefined) ?? (res as unknown as PreSignQaResult);
      setPreSignQa({ status: 'done', result: data ?? {}, at: new Date().toISOString(), inputKey });
    }).catch((e: { message?: string }) => {
      if (preSignQaAbortRef.current !== controller) return;
      setPreSignQa({ status: 'failed', error: controller.signal.aborted ? '시간 초과(15초)' : (e?.message ?? '원인 미상'), at: new Date().toISOString() });
    }).finally(() => clearTimeout(timeoutId));
  }, [encounterId]);

  // 진료화면의 임상도구(clinical-chart) 값 → ClinicalChartResult 자동 영속(인카운터 연계·멱등)
  const persistClinicalResults = useCallback(async () => {
    if (!encounterId) return;
    const items = clinicalCapture.getAll();
    if (!items.length) return;
    // 🔴 (2026-10-10) 실패를 통째로 삼켰다 — 서버가 부분 합 Braden 을 400 으로 거절해도 진료 화면은 아무 말이 없었다.
    //    진료 흐름은 막지 않되(기록 저장은 이어간다) 저장 못 한 도구 수와 다 고르지 않은 점수표 수를 말한다.
    const incomplete = items.filter(({ value }) => value?.result?.incomplete).length;
    {
      const results = await Promise.allSettled(items.map(({ value }) => {
        const r = value?.result;
        const hasResult = !!r && !r.incomplete && (r.label != null || r.value != null || r.total != null);
        if (!value?.chartId || !hasResult) return Promise.resolve(null);
        const def = getChart(value.chartId);
        return apiClient.post('/api/v1/clinical-chart-results', {
          patientId,
          encounterId,
          chartId: value.chartId,
          chartName: def?.name ?? value.chartId,
          archetype: def?.archetype ?? 'scoring',
          sourceVersion: def?.sourceVersion,
          inputs: value.inputs ?? {},
          resultLabel: r.label,
          resultLevel: r.level,
          resultValue: typeof r.value === 'number' ? r.value : (typeof r.total === 'number' ? r.total : undefined),
          recommendation: r.recommendation,
          flags: r.flags,
        });
      }));
      const failed = results.filter((x) => x.status === 'rejected').length;
      if (failed) toast.warning(`임상 도구 결과 ${failed}건을 환자 차트에 저장하지 못했습니다.`);
      if (incomplete) toast.warning(`다 고르지 않은 점수표 ${incomplete}건은 저장하지 않았습니다.`);
    }
  }, [encounterId, patientId, clinicalCapture]);

  const handleSaveDraft = async (override?: SoapOverride) => {
    if (!encounterId) return;
    if (!hydrated) { toast.error('기존 진료 기록을 불러오는 중입니다. 잠시 후 다시 시도하세요.'); return; }
    const eff = pickSoap(override);
    setIsSaving(true);
    try {
      await updateEncounter.mutateAsync({ id: encounterId, data: { ...eff, ...(diagnoses.length ? { diagnoses: diagnoses.map((d) => ({ diagnosisCodeId: d.diagnosisCodeId, type: d.type, certainty: d.certainty })) } : {}), ...amendExtra() } });
      await persistClinicalResults();
      if (eff !== soap) setSoap(eff);
      toast.success('SOAP 노트가 저장되었습니다.');
      router.push(`/patients/${patientId}`);
    } catch (err: unknown) {
      const msg = (err as MutationError)?.message;
      toast.error(msg || '저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // Sign and bill (with pre-sign chart QA)
  const hasSoapContent = !!(soap.subjective || soap.objective || soap.assessment || soap.plan);
  const canSign = !!encounterId && hasSoapContent && !ambientGate.blocked;

  // 🔴 전자서명(인증서) 경로가 저장·게이트보다 **먼저** 서버 서명을 호출해, 화면이 아니라 서버에 남은 옛 SOAP 에 서명하고
  //    전사 게이트·의증 확인을 건너뛰었다(2026-09-30). 이제 서명값은 여기 보관했다가 아래 서명 요청에 함께 싣는다.
  const pendingBlockchainSigRef = useRef<Record<string, unknown> | null>(null);
  const signingRef = useRef(false); // 서명 연타 — setIsSigning 은 다음 렌더에야 버튼을 막는다
  // 🔴 (2026-10-13 A2) 전자서명 해시는 서버가 **저장된** 진료기록으로 계산한다 — 서명 창을 열기 전에 지금 입력을 저장한다.
  //    종전엔 모달이 제목 문자열을 해시했고, 저장은 서명 창을 닫은 뒤(handleSignAndBill)에 일어났다.
  const prepareBlockchainSign = async () => {
    if (!encounterId || !hydrated) return false;
    const eff = pickSoap();
    if (!(eff.subjective || eff.objective || eff.assessment || eff.plan)) {
      toast.error('SOAP 노트를 최소 1개 항목 이상 작성해주세요.');
      return false;
    }
    await updateEncounter.mutateAsync({ id: encounterId, data: { ...eff, ...(diagnoses.length ? { diagnoses: diagnoses.map((d) => ({ diagnosisCodeId: d.diagnosisCodeId, type: d.type, certainty: d.certainty })) } : {}), ...amendExtra() } });
    return true;
  };

  const handleSignAndBill = async (override?: SoapOverride) => {
    if (!encounterId) return;
    if (signingRef.current) return;
    // 이번 서명 시도에만 쓴다 — 확인 창에서 취소해도 다음 시도에 남지 않게 먼저 꺼낸다
    const blockchainSignature = pendingBlockchainSigRef.current ?? undefined;
    pendingBlockchainSigRef.current = null;
    if (!hydrated) { toast.error('기존 진료 기록을 불러오는 중입니다. 잠시 후 다시 시도하세요.'); return; }
    // G5 — 음성 대화 전사 누락 구간을 확인하지 않은 채 서명 금지(진료 대화 패널에서 확인)
    if (ambientGate.blocked) { toast.error(ambientGate.reason ?? '대화 전사 누락 구간 확인이 필요합니다.'); return; }
    const eff = pickSoap(override);
    if (!(eff.subjective || eff.objective || eff.assessment || eff.plan)) {
      toast.error('SOAP 노트를 최소 1개 항목 이상 작성해주세요.');
      return;
    }
    // 의증/R-O 주상병 청구 방지 경고 — 주상병은 확진 권고(HIRA 심사 삭감 관리)
    const primaryDx = diagnoses.find((d) => d.type === 'PRIMARY');
    if (primaryDx && primaryDx.certainty !== 'CONFIRMED') {
      const label = primaryDx.certainty === 'PROVISIONAL' ? '의증' : primaryDx.certainty === 'RULE_OUT' ? 'R/O' : '배제';
      if (!confirm(`주상병(${primaryDx.code} ${primaryDx.nameKo})이 '${label}' 상태입니다.\n확진되지 않은 상병으로 청구 시 심사 삭감 위험이 있습니다.\n\n계속 서명하시겠습니까?`)) {
        return;
      }
    }
    // 주상병 사용 불가 상병 경고 — HIRA 상병마스터 '주상병사용구분 N'(심사 반려 위험)
    if (primaryDx?.notPrimary) {
      if (!confirm(`주상병(${primaryDx.code} ${primaryDx.nameKo})은 HIRA 기준 주상병으로 사용할 수 없는 상병입니다.\n부상병으로 변경을 권고합니다(청구 시 심사 반려 위험).\n\n계속 서명하시겠습니까?`)) {
        return;
      }
    }
    if (eff !== soap) setSoap(eff);
    signingRef.current = true;
    setIsSigning(true);
    try {
      // 서명 전 기록품질(감시 · 비차단) — 같은 입력으로 이미 본 결과가 없으면 **병렬**로 돌린다. 서명은 기다리지 않는다.
      if (!(preSignQa.status === 'done' && preSignQa.inputKey === preSignQaKeyOf(eff))) runPreSignQa(eff);

      await updateEncounter.mutateAsync({ id: encounterId, data: { ...eff, ...(diagnoses.length ? { diagnoses: diagnoses.map((d) => ({ diagnosisCodeId: d.diagnosisCodeId, type: d.type, certainty: d.certainty })) } : {}), ...amendExtra() } });
      await persistClinicalResults();
      await signEncounter.mutateAsync(blockchainSignature ? { id: encounterId, blockchainSignature } : encounterId);
      // 🔴 무수정 승인율 보고 — 서명이 끝난 뒤 fire-and-forget(await 금지). 실패해도 서명은 이미 확정이다.
      reportDraftOutcome(eff);
      toast.success('진료 서명이 완료되었습니다. 수납은 원무과에서 처리합니다.');
      setSignCompleted(true);
    } catch (err: unknown) {
      const msg = (err as MutationError)?.message;
      toast.error(msg || '서명/수납 처리에 실패했습니다.');
    } finally {
      signingRef.current = false;
      setIsSigning(false);
    }
  };

  // 약속처방 적용(공용) — 패널 [적용] → 검토 모달(기본형 자동선택·필수 고정) → 선택 항목만 생성.
  type OrderSetApplyItem = { type: string; name: string; code?: string; medicationCodeId?: string; procedureCodeId?: string; dosage?: string; frequency?: string; duration?: number; route?: string; certType?: string; instructions?: string; required?: boolean; isDefault?: boolean };
  const [pendingCp, setPendingCp] = useState<{ name: string; items: OrderSetApplyItem[]; orderSetId?: string; warnings: string[] } | null>(null);
  const [showPreOrderCreate, setShowPreOrderCreate] = useState(false);

  // 패널 [적용] 진입점 — 즉시 생성 대신 검토 모달 오픈(연령군/금기 경고는 모달에 표시)
  const openCpReview = (items: OrderSetApplyItem[], orderSetId?: string, meta?: { name?: string; ageGroup?: string; contraindications?: Array<{ note?: string }> }) => {
    const age = patient?.dateOfBirth ? ageOf(patient.dateOfBirth) : null; // 모르면 null — 0세(신생아)로 판정하지 않는다
    const warnings: string[] = [];
    if (meta?.ageGroup && age != null) {
      const fit = meta.ageGroup === 'ADULT' ? age >= 19 : meta.ageGroup === 'PEDIATRIC' ? age < 19 : meta.ageGroup === 'GERIATRIC' ? age >= 65 : true;
      const label = { ADULT: '성인', PEDIATRIC: '소아', GERIATRIC: '노인' }[meta.ageGroup] ?? meta.ageGroup;
      if (!fit) warnings.push(`대상 연령군(${label})과 환자 나이(${age}세) 불일치`);
    }
    const contra = (meta?.contraindications ?? []).map(c => c?.note).filter(Boolean);
    if (contra.length) warnings.push('금기 조건: ' + contra.join(', '));
    setPendingCp({ name: meta?.name ?? '약속처방', items, orderSetId, warnings });
  };

  const handleApplyOrderSet = async (items: OrderSetApplyItem[], orderSetId?: string) => {
    if (!encounterId) return;
    if (applyingSetRef.current) return; // 적용 진행 중 연타 무시(중복 처방 방지)
    applyingSetRef.current = true;
    const VALID_TABS = ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY', 'NURSING'];
    const CODE_REQUIRED = new Set(['MEDICATION', 'LAB', 'IMAGING', 'THERAPY']);
    const docItems = items.filter(it => it.type === 'DOCUMENT');
    const manualItems = items.filter(it => it.type === 'ORDER'); // 일반오더 — PrescriptionType 아님(수동 입력 안내)
    const rxItems = items.filter(it => it.type !== 'DOCUMENT' && it.type !== 'ORDER');
    const tabOf = (t: string): PrescriptionTab => (VALID_TABS.includes(t) ? t : 'LAB') as PrescriptionTab;
    const created: PrescriptionItem[] = [];
    const skipped: string[] = []; // 미해석(코드 없음) — 서버 처방 미생성이므로 로컬 표시도 하지 않음(유령 방지)
    const failed: string[] = [];  // 서버 생성 실패 — 마찬가지로 로컬 미표시
    for (const item of rxItems) {
      const codeId = item.medicationCodeId ?? item.procedureCodeId;
      const needsCode = CODE_REQUIRED.has(item.type);
      if (needsCode && !codeId) { skipped.push(item.name); continue; }
      const isMed = item.type === 'MEDICATION';
      const payload = {
        type: item.type,
        priority: 'ROUTINE',
        ...(isMed
          ? { medicationCodeId: item.medicationCodeId, dosage: item.dosage, frequency: item.frequency, duration: item.duration, route: item.route }
          : needsCode
            ? { procedureCodeId: item.procedureCodeId }
            // 식이/활동/간호 — 코드 없이 지시 텍스트로 생성 (PrescriptionType 7유형)
            : { instructions: [item.name, item.instructions].filter(Boolean).join(' — ') }),
      };
      try {
        // 약속처방도 항목별 개별 처방이다 — 비처방 역할이면 항목마다 지정 처방의 승인을 받는다
        const auth = await delegate.authorize({
          type: item.type,
          ...(isMed
            ? { medicationCodeId: item.medicationCodeId, dosage: item.dosage, frequency: item.frequency, duration: item.duration, route: item.route }
            : needsCode ? { procedureCodeId: item.procedureCodeId } : {}),
        });
        if (!auth) throw new Error(delegate.error || '지정 처방의 승인을 받지 못했습니다.');
        Object.assign(payload as Record<string, unknown>, auth.fields);
        const res = await addPrescription.mutateAsync({ encounterId, data: payload, headers: auth.headers });
        created.push({ id: res.data?.id, type: tabOf(item.type), codeId: codeId ?? '', codeName: item.name, codeValue: item.code ?? '', dosage: item.dosage ?? '', frequency: item.frequency ?? '', duration: item.duration ?? 0, quantity: 0, route: item.route ?? '' });
      } catch { failed.push(item.name); }
    }
    setPrescriptions(prev => [...prev, ...created]);
    if (docItems.length) setPendingDocs(prev => [...prev, ...docItems.map(d => ({ certType: d.certType ?? 'DIAGNOSIS_CERT', name: d.name }))]);
    if (orderSetId) {
      try { await apiClient.post(`/api/v1/order-sets/${orderSetId}/use`, { encounterId, patientId, itemsApplied: created.length, itemsModified: 0 }); } catch { /* 통계 실패 무시 */ }
    }
    setShowCpPanel(false);
    const parts: string[] = [];
    if (created.length) parts.push(`처방 ${created.length}건`);
    if (docItems.length) parts.push(`발급 서류 ${docItems.length}건`);
    if (created.length || docItems.length) toast.success(`약속처방 적용: ${parts.join(' · ')}`);
    if (manualItems.length) toast.success(`일반오더 ${manualItems.length}건은 자동 생성 미지원 — 수동 입력 필요 (${manualItems.map(m => m.name).slice(0, 2).join(', ')})`);
    if (skipped.length) toast.error(`미해석 ${skipped.length}건 생성 제외 (${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? ' 외' : ''}) — 관리자 코드 해석 필요`);
    if (failed.length) toast.error(`생성 실패 ${failed.length}건 (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' 외' : ''})`);
    applyingSetRef.current = false;
  };

  // 서명 완료 → 다음 환자 안내 화면
  if (signCompleted) {
    return (
      <div className="max-w-lg mx-auto mt-16">
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-8 text-center">
          <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-1"><T k="진료 완료" /></h3>
          <p className="text-sm text-gray-500 mb-6">{patient?.familyName}{patient?.givenName}님 진료가 완료되었습니다.</p>
          {/* 서명과 병렬로 돌던 기록품질 제안이 서명 뒤 도착하면 여기서 보인다(감시 · 비차단 · 이미 서명됨을 말한다) */}
          <PreSignQaChecklist state={preSignQa} afterSign className="text-left mb-4" />
          {/* 무수정 승인율 보고가 실패하면 그렇게 말한다 — 조용히 성공한 척하지 않는다(서명·기록에는 영향 없음).
              서명 뒤에는 DraftBanner 가 있는 편집 화면이 사라지므로, 이 카드가 사람이 결과를 볼 수 있는 유일한 자리다. */}
          {draftOutcomeRecorded === false && (
            <p className="text-left text-[11px] text-amber-700 mb-4" data-draft-outcome="failed">
              ⚠️ {AI_ORIGIN_TEXT} 초안 대비 수정 정도를 계측에 남기지 못했습니다 — 서명·기록에는 영향이 없습니다.
            </p>
          )}
          <div className="flex flex-col gap-3">
            <button
              // 다음 환자는 진료실 대기에서 부른다(종전: 대기열이 없는 대시보드로 보냈다)
              onClick={() => router.push('/clinic-queue')}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              <T k="다음 환자 (진료실 대기)" />
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => router.push(`/patients/${patientId}`)}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                <T k="환자 차트 보기" />
              </button>
              <button
                // 재진 예약을 이 환자로 바로 — 종전엔 예약 목록으로 가서 환자를 다시 찾아야 했다
                onClick={() => router.push(`/schedule/new?patientId=${patientId}&type=FOLLOW_UP${user?.department ? `&department=${encodeURIComponent(user.department)}` : ''}`)}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
                data-followup-booking
              >
                <T k="다음 예약 잡기" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (patientError) return <QueryErrorFallback error={patientErr} onRetry={patientRefetch} />;

  if (patientLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="animate-spin h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span className="ml-2 text-gray-500 text-sm"><T k="환자 정보 로딩 중..." /></span>
      </div>
    );
  }

  if (!patient) {
    return <p className="text-red-500"><T k="환자를 찾을 수 없습니다." /></p>;
  }

  if (createError) {
    return (
      <div className="max-w-lg mx-auto mt-20">
        <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-8 text-center">
          <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2"><T k="진료 생성 실패" /></h3>
          <p className="text-sm text-gray-600 mb-6">{createError}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => router.back()} className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200">
              <T k="돌아가기" />
            </button>
            <button onClick={() => { setCreateError(null); setIsCreating(false); }} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
              <T k="다시 시도" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 간호사 측정 바이탈 — 일반·진료과 레이아웃이 함께 쓴다(진료과 레이아웃은 종전에 이 카드가 없어 의사가 측정값을 못 봤다)
  // 🔴 시각만 적으면 며칠 전 측정이 오늘 값처럼 읽힌다 — 오늘이 아니면 날짜를 붙이고 '오늘 측정 아님'을 말한다
  const vitalAt = latestVital?.measuredAt ? new Date(latestVital.measuredAt) : null;
  const vitalIsToday = !!vitalAt && format(vitalAt, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  const nurseVitalsCard = (
          <div data-nurse-vitals className={`rounded-xl border px-4 py-3 ${
            vitalsIsError
              ? 'bg-white border-red-200'
              : latestVital
              ? vitalIsAbnormal
                ? 'bg-red-50 border-red-200'
                : 'bg-blue-50 border-blue-200'
              : 'bg-gray-50 border-gray-200'
          }`}>
            {vitalsIsError ? (
              <QueryErrorFallback error={vitalsErr} onRetry={() => refetchVitals()} size="compact" />
            ) : latestVital ? (
              <div>
                <p className="text-[11px] font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
                  <T k="간호사 측정 바이탈" /> ({vitalAt ? format(vitalAt, vitalIsToday ? 'HH:mm' : 'M/d HH:mm') : '-'})
                  {vitalAt && !vitalIsToday && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" data-vitals-stale><T k="오늘 측정 아님" /></span>
                  )}
                </p>
                {/* 🔴 항목별 색도 미측정을 정상값으로 접지 않는다 — 측정된 것만 판정하고, 미측정은 회색으로 말한다 */}
                {/* 활력 표시 정본(2026-10-07) — 표준 순서·단위·혈압 한 값 · 미측정 — · 이상 색은 적용 임계 */}
                <VitalSignsStrip vitals={latestVital} keys={['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature', 'weight']} className="text-sm" />
                <VitalsRuleNote rule={vitalsData?.meta?.vitalsRule ? { ...vitalsData.meta.vitalsRule, droppedKeys: vitalsData.meta.vitalsRule.droppedKeys ?? [], invertedKeys: vitalsData.meta.vitalsRule.invertedKeys ?? [], state: 'ready' } : null} className="mt-1" />
              </div>
            ) : (
              <p className="text-xs text-gray-400"><T k="바이탈 미측정 — 간호사에게 요청하세요" /></p>
            )}
          </div>
  );

  // 처방 열 — 일반 레이아웃 오른쪽 + 진료과 레이아웃의 서명 바 위(rxSlot).
  // 🔴 종전 진료과 레이아웃 16종에는 처방 입력·DUR·처방 참고가 아예 없었다 — 과가 지정된 의사는 차트에서 처방을 낼 수 없었다(2026-09-30)
  const rxColumn = (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.187 3.187 0 01-2.283.866 3.187 3.187 0 01-2.283-.866L5 14.5" />
            </svg>
            <T k="처방 입력" />
          </h3>

          {/* 비처방 역할이면 여기서 책임 처방의를 먼저 지정한다 — 저장 시점 403 대신 입력 전에 안내 */}
          <PrescriberPicker
            info={delegate.info}
            infoState={delegate.infoState}
            prescriberId={delegate.prescriberId}
            onSelect={(id) => { delegate.setPrescriberId(id); delegate.reset(); }}
            status={delegate.status}
            error={delegate.error}
            orderSource={delegate.orderSource}
            onOrderSource={delegate.setOrderSource}
            readBackConfirmed={delegate.readBackConfirmed}
            onReadBack={delegate.setReadBackConfirmed}
          />

          {/* 약속처방 + 이전처방 + Pre-Order 버튼 */}
          <div className="flex gap-2 mb-3 flex-wrap">
            <button onClick={() => setShowCpPanel(!showCpPanel)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 ${showCpPanel ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600 hover:bg-indigo-50'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              약속처방 (CP)
            </button>
            {/* 복사·사전처방은 서버가 의사 전용으로 막는다(위임 경로 없음) — 비처방 역할에겐 아예 감춘다.
                띄워두면 누르는 순간 403 이고, 화면엔 이유가 남지 않는다. */}
            {!delegate.info?.delegationRequired && (<>
              <CopyPrescriptionButton
                patientId={patientId}
                encounterId={encounterId!}
                onCopied={(count) => toast.success(`이전 처방 ${count}건 복사 완료`)}
              />
              <PreOrderBanner patientId={patientId} encounterId={encounterId!} />
              <button type="button" onClick={() => setShowPreOrderCreate(true)}
                className="px-2.5 py-1.5 text-[11px] font-medium bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100 whitespace-nowrap"
                title="차기 진료·검사 대비 사전처방 작성 — 발효는 승인 시(DUR 재검증)">
                + 사전처방
              </button>
            </>)}
          </div>

          {/* 사전처방 작성 모달 — 차트 탭과 동일 컴포넌트 재사용 */}
          {showPreOrderCreate && (
            <PreOrderCreateModal patientId={patientId} onClose={() => setShowPreOrderCreate(false)}
              onCreated={() => setShowPreOrderCreate(false)} />
          )}

          {/* 약속처방 패널 */}
          {showCpPanel && (
            <OrderSetPanel onApply={openCpReview} />
          )}

          {/* 진단 기반 추천 약속처방 (G1-5) — 주상병 가중·prefix 매칭·연령군 필터·금기 대조 (추천 엔진 v2) */}
          <RecommendedOrderSets
            diagnosisCodes={diagnoses.map(d => d.code)}
            primaryCode={diagnoses.find(d => d.type === 'PRIMARY')?.code}
            age={patient?.dateOfBirth ? ageOf(patient.dateOfBirth) : null}
            patientId={patientId}
            onApply={openCpReview}
          />

          {/* 진단 기반 추천 치료일정 (P2) — 전개 검토 모달 경유 */}
          <RecommendedTemplates
            diagnosisCodes={diagnoses.map(d => d.code)}
            primaryCode={diagnoses.find(d => d.type === 'PRIMARY')?.code}
            patientId={patientId}
            encounterId={encounterId}
          />

          {/* 약속처방 적용 검토 모달 — 기본형 자동선택·필수 고정·미해석 제외 */}
          {pendingCp && (
            <ApplyOrderSetModal
              name={pendingCp.name}
              items={pendingCp.items}
              warnings={pendingCp.warnings}
              onClose={() => setPendingCp(null)}
              onConfirm={(selected) => { const osId = pendingCp.orderSetId; setPendingCp(null); void handleApplyOrderSet(selected, osId); }}
            />
          )}

          {/* 오더세트 서류 발급 안내 — DOCUMENT 항목은 §17 담당의가 진단서 워크스테이션에서 발급 */}
          {pendingDocs.length > 0 && (
            <div className="mt-3 p-3 border border-amber-200 bg-amber-50 rounded-xl text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-amber-800">📄 발급 대상 서류 ({pendingDocs.length})</span>
                <button type="button" onClick={() => setPendingDocs([])} className="text-amber-500 hover:text-amber-700 text-[11px]">지우기</button>
              </div>
              <ul className="space-y-0.5 mb-2">
                {pendingDocs.map((d, i) => (
                  <li key={i} className="text-amber-700">
                    · {({ DIAGNOSIS_CERT: '진단서', OPINION: '소견서', ADMISSION_CERT: '입퇴원확인서' } as Record<string, string>)[d.certType] ?? d.certType}
                    {d.name ? ` — ${d.name}` : ''}
                  </li>
                ))}
              </ul>
              <a href="/workstation/certificates" target="_blank" rel="noreferrer"
                className="inline-block px-3 py-1 bg-amber-600 text-white rounded-lg text-[11px] font-medium hover:bg-amber-700">
                진단서 워크스테이션에서 발급 →
              </a>
              <p className="text-[10px] text-amber-500 mt-1.5">진단서·소견서는 직접 진찰한 담당의가 작성·전자서명·발급합니다(의료법 §17).</p>
            </div>
          )}


          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto">
            {TAB_CONFIG.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setSelectedCode(null);
                  codeSearch.reset();
                  setPresetSelection([]);
                  setCodeSelection([]);
                  setNicFilter('');
                  setCustomActivity('');
                }}
                className={`flex-1 inline-flex items-center justify-center gap-1 whitespace-nowrap px-2.5 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.icon}
                <T k={tab.label} />
              </button>
            ))}
          </div>

          {/* Therapy Type Selection (치료 탭 전용) — 다중 선택(운동+도수+열전기 동시 처방 표준) */}
          {activeTab === 'THERAPY' && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-500">치료 유형 선택
                <span className="text-gray-400 font-normal ml-1.5">여러 개 선택 가능 · 각각 개별 처방으로 등록</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {THERAPY_PRESETS.map((tp) => ({ ...tp, d: THERAPY_ICON_PATHS[tp.code] ?? '' })) /* 데이터=정본·아이콘만 로컬 */.map((t) => {
                  const on = presetSelection.some((p) => p.code === t.code);
                  return (
                  <button key={t.code} type="button"
                    aria-pressed={on}
                    onClick={() => setPresetSelection((prev) => on ? prev.filter((p) => p.code !== t.code) : [...prev, { code: t.code, name: t.name }])}
                    className={`relative flex items-center gap-2.5 p-3 rounded-xl border text-left text-sm transition ${
                      on
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700'
                    }`}>
                    {on && <span className="absolute top-1.5 right-2 text-blue-500 text-xs font-bold">✓</span>}
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${on ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d={t.d} />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium leading-tight">{t.name}</span>
                      <span className={`block text-[10px] font-mono mt-0.5 ${on ? 'text-blue-400' : 'text-gray-400'}`}>{t.code}</span>
                    </span>
                  </button>
                  );
                })}
              </div>
              {presetSelection.length > 0 && (
                <div className="bg-blue-50 rounded-xl p-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-blue-700 shrink-0">{presetSelection.length}<Unit>건</Unit> 선택</span>
                    {presetSelection.map((p) => (
                      <span key={p.code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-blue-200 text-blue-700 text-xs whitespace-nowrap">
                        {p.name}
                        <button type="button" onClick={() => setPresetSelection((prev) => prev.filter((x) => x.code !== p.code))} className="text-blue-300 hover:text-blue-600" aria-label={`${p.name} 제거`}>✕</button>
                      </span>
                    ))}
                  </div>
                  <span className="block text-xs text-blue-500 mt-1.5">→ 처방 추가 시 치료실 대기열에 등록</span>
                </div>
              )}
            </div>
          )}

          {/* Activity/Nursing Preset Selection (활동·간호지시 탭 전용) — 수가코드 없음·표준 지시 프리셋·다중 선택 */}
          {(activeTab === 'ACTIVITY' || activeTab === 'NURSING') && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-500">
                {activeTab === 'ACTIVITY' ? '활동 제한 선택' : `간호 지시 선택 (NIC 간호중재분류 ${nicList.length || 10}종)`}
                <span className="text-gray-400 font-normal ml-1.5">여러 개 선택 가능 · 각각 개별 지시로 등록</span>
              </p>
              {/* 🔴 표준 코드 목록 조회 실패 — 아래는 정본 폴백 프리셋이지 "NIC 전량"이 아니다 */}
              {activeTab === 'NURSING' && nicIsError && (
                <QueryErrorFallback error={nicError} onRetry={refetchNic} size="compact" />
              )}
              {activeTab === 'NURSING' && nicList.length > 0 && (
                <div className="space-y-2">
                  <div className="flex gap-1.5 flex-wrap">
                    <button type="button" onClick={() => setNicDomain('')}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${!nicDomain ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>전체</button>
                    {nicDomains.map((d) => (
                      <button key={d} type="button" onClick={() => setNicDomain(nicDomain === d ? '' : d)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${nicDomain === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{d}</button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={nicFilter} onChange={(e) => setNicFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && nicFilter.trim()) {
                          e.preventDefault();
                          const name = nicFilter.trim();
                          setPresetSelection((prev) => prev.some((p) => p.name === name) ? prev : [...prev, { code: 'CUSTOM', name }]);
                          setNicFilter('');
                        }
                      }}
                      placeholder="간호 중재 검색 — 목록에 없으면 입력 후 직접 추가..."
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-300" />
                    <button type="button" disabled={!nicFilter.trim()}
                      onClick={() => {
                        const name = nicFilter.trim();
                        setPresetSelection((prev) => prev.some((p) => p.name === name) ? prev : [...prev, { code: 'CUSTOM', name }]);
                        setNicFilter('');
                      }}
                      title="검색어를 직접 지시로 추가"
                      className="shrink-0 px-3 py-2 rounded-xl text-sm font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 whitespace-nowrap">
                      ＋ 직접 추가
                    </button>
                  </div>
                </div>
              )}
              <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${activeTab === 'NURSING' ? 'max-h-[340px] overflow-y-auto pr-1' : ''}`}>
                {activeTab === 'NURSING' && nicList.length > 0 && nicShown.length === 0 && (
                  <EmptyState icon="🔍" title="검색/필터에 맞는 간호 중재가 없습니다." className="col-span-full" />
                )}
                {(activeTab === 'ACTIVITY'
                  ? ACTIVITY_PRESETS /* 정본 — 인라인 중복이 정본과 어긋나며 벌어졌다 */
                  : nicShown.length > 0
                    ? nicShown.map((n) => ({ code: `NIC ${n.code}`, name: n.nameKo }))
                    : nicList.length > 0
                      ? [] // 필터 결과 없음(아래 빈 안내)
                      : NURSING_FALLBACK_PRESETS // 정본 폴백
                ).map((t) => {
                  const on = presetSelection.some((p) => p.code === t.code);
                  return (
                  <button key={t.code} type="button"
                    aria-pressed={on}
                    onClick={() => setPresetSelection((prev) => on ? prev.filter((p) => p.code !== t.code) : [...prev, { code: t.code, name: t.name }])}
                    className={`relative p-2.5 rounded-xl border text-left text-sm transition ${
                      on
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700'
                    }`}>
                    {on && (
                      <span className="absolute top-1.5 right-2 text-blue-500 text-xs font-bold">✓</span>
                    )}
                    <span className="block font-medium leading-tight">{t.name}</span>
                    <span className={`block text-[10px] font-mono mt-0.5 ${on ? 'text-blue-400' : 'text-gray-400'}`}>{t.code}</span>
                  </button>
                  );
                })}
              </div>
              {activeTab === 'ACTIVITY' && (
                <div className="flex gap-2">
                  <input type="text" value={customActivity} onChange={(e) => setCustomActivity(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customActivity.trim()) {
                        e.preventDefault();
                        const name = customActivity.trim();
                        setPresetSelection((prev) => prev.some((p) => p.name === name) ? prev : [...prev, { code: 'CUSTOM', name }]);
                        setCustomActivity('');
                      }
                    }}
                    placeholder="기타 활동 제한 직접 입력 (예: 우측 하지 체중부하 금지)..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-300" />
                  <button type="button" disabled={!customActivity.trim()}
                    onClick={() => {
                      const name = customActivity.trim();
                      setPresetSelection((prev) => prev.some((p) => p.name === name) ? prev : [...prev, { code: 'CUSTOM', name }]);
                      setCustomActivity('');
                    }}
                    className="shrink-0 px-3 py-2 rounded-xl text-sm font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 whitespace-nowrap">
                    ＋ 직접 추가
                  </button>
                </div>
              )}
              {presetSelection.length > 0 && (
                <div className="bg-blue-50 rounded-xl p-3 text-sm flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-blue-700 shrink-0">{presetSelection.length}<Unit>건</Unit> 선택</span>
                  {presetSelection.map((p) => (
                    <span key={p.code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-blue-200 text-blue-700 text-xs whitespace-nowrap">
                      {p.name}
                      <button type="button" onClick={() => setPresetSelection((prev) => prev.filter((x) => x.code !== p.code))} className="text-blue-300 hover:text-blue-600" aria-label={`${p.name} 제거`}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Code Search (약/검사/영상/식이) */}
          <div ref={searchRef} className={`relative ${activeTab === 'THERAPY' || activeTab === 'ACTIVITY' || activeTab === 'NURSING' ? 'hidden' : ''}`}>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              {activeTab === 'MEDICATION' ? '약품 검색' : activeTab === 'LAB' ? '검사 검색' : activeTab === 'IMAGING' ? '영상 검색' : activeTab === 'THERAPY' ? '치료 검색' : activeTab === 'DIET' ? '식이 검색 (예: 저염식, 당뇨식)' : activeTab === 'ACTIVITY' ? '활동 제한 (예: 절대안정, 보행제한)' : '간호 지시 검색'}
            </label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={codeQuery}
                onChange={(e) => handleCodeQueryChange(e.target.value)}
                onFocus={() => searchCodes(selectedCode ? '' : codeQuery)}
                placeholder={activeTab === 'MEDICATION' ? '약품명 또는 코드 검색 (클릭하면 목록 표시)...' : activeTab === 'THERAPY' ? '치료 유형 검색 (운동치료, 투석 등)...' : activeTab === 'DIET' ? '식이 처방 검색 (저염식, 당뇨식 등)...' : activeTab === 'ACTIVITY' ? '활동 제한 검색 (절대안정, 보행제한 등)...' : activeTab === 'NURSING' ? '간호 지시 검색...' : '검사/시술명 또는 코드 검색 (클릭하면 목록 표시)...'}
                disabled={!encounterId}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow disabled:bg-gray-50 placeholder:text-gray-300"
              />
              {isSearching && (
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
            </div>

            {/* 검색 결과 목록 — 공용 부품(성분·포뮬러리·급여·약가·고위험 배지 포함) */}
            {showDropdown && (
              <CodeSearchDropdown
                activeTab={activeTab}
                results={codeResults}
                query={codeQuery}
                searching={isSearching}
                failed={codeSearch.failed}
                onSelect={handleSelectCode}
                onRequestFormulary={requestFormulary}
              />
            )}
          </div>

          {/* 검사/영상 다중 담기 목록 */}
          {(activeTab === 'LAB' || activeTab === 'IMAGING') && codeSelection.length > 0 && (
            <div className="bg-blue-50 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-700">{codeSelection.length}<Unit>건</Unit> 담김 — 추가 검색으로 계속 담기</span>
                <span className="text-xs font-mono text-blue-600">
                  합계 <Money value={codeSelection.reduce((s, c) => s + (c.unitPrice ?? 0), 0)} />
                </span>
              </div>
              <div className="space-y-1">
                {codeSelection.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 bg-white border border-blue-100 rounded-lg px-2.5 py-1.5">
                    <span className="text-sm text-gray-800 min-w-0 truncate">{c.nameKo}</span>
                    <span className="text-[10px] font-mono text-gray-400 shrink-0">{c.code}</span>
                    <span className="ml-auto flex items-center gap-1.5 shrink-0">
                      {c.insuranceCode ? (
                        <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">급여</span>
                      ) : (
                        <span className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-medium">비급여</span>
                      )}
                      {c.unitPrice != null && c.unitPrice > 0 && (
                        <span className="text-[10px] text-gray-500 font-mono"><Money value={c.unitPrice} /></span>
                      )}
                      <button type="button" onClick={() => setCodeSelection((prev) => prev.filter((x) => x.id !== c.id))}
                        className="text-gray-300 hover:text-red-500" aria-label={`${c.nameKo} 제거`}>✕</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Medication Detail Fields */}
          {activeTab === 'MEDICATION' && selectedCode && (
            <div className="space-y-3 bg-gray-50 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">용량</label>
                  <input
                    type="text"
                    value={medForm.dosage}
                    onChange={(e) => setMedForm({ ...medForm, dosage: e.target.value })}
                    placeholder="예: 500mg"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">투여 경로</label>
                  <select
                    value={medForm.route}
                    onChange={(e) => setMedForm({ ...medForm, route: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  >
                    <option value="">선택</option>
                    <option value="경구">경구 (PO)</option>
                    <option value="정맥">정맥 (IV)</option>
                    <option value="근육">근육 (IM)</option>
                    <option value="피하">피하 (SC)</option>
                    <option value="외용">외용</option>
                  </select>
                </div>
              </div>
              {/* 조제 구분 — 원외면 원외처방전에 실린다 */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="조제 유형" /></label>
                <div className="flex gap-2" data-dispensing-type>
                  {([{ v: 'INTERNAL' as const, l: '원내' }, { v: 'EXTERNAL' as const, l: '원외' }]).map((o) => (
                    <button key={o.v} type="button" onClick={() => setDispensingType(o.v)} aria-pressed={dispensingType === o.v}
                      className={`flex-1 min-h-[36px] text-xs font-medium rounded-lg border transition-all ${dispensingType === o.v ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                      <T k={o.l} />
                    </button>
                  ))}
                </div>
              </div>
              {/* 우선순위 */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">우선순위</label>
                <div className="flex gap-2">
                  {[
                    { value: 'STAT', label: 'STAT (긴급)', color: 'bg-red-100 text-red-700 border-red-300' },
                    { value: 'ROUTINE', label: 'Routine', color: 'bg-gray-100 text-gray-700 border-gray-300' },
                    { value: 'PRN', label: 'PRN (필요시)', color: 'bg-amber-100 text-amber-700 border-amber-300' },
                  ].map((p) => (
                    <button key={p.value} onClick={() => setMedForm({ ...medForm, priority: p.value })}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                        medForm.priority === p.value ? p.color + ' ring-1' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                      }`}>{p.label}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">투약 횟수</label>
                  <input
                    type="text"
                    value={medForm.frequency}
                    onChange={(e) => setMedForm({ ...medForm, frequency: e.target.value })}
                    placeholder="예: 1일 3회"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">투약 일수</label>
                  <input
                    type="number"
                    value={medForm.duration ?? ''}
                    onChange={(e) => setMedForm({ ...medForm, duration: e.target.value === '' ? null : Number(e.target.value) })}
                    min={1}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">총 수량</label>
                  <input
                    type="number"
                    value={medForm.quantity ?? ''}
                    onChange={(e) => setMedForm({ ...medForm, quantity: e.target.value === '' ? null : Number(e.target.value) })}
                    min={1}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Add Prescription Button */}
          <button
            onClick={handleAddPrescription}
            disabled={!encounterId || addingRx || ((activeTab === 'THERAPY' || activeTab === 'ACTIVITY' || activeTab === 'NURSING') ? presetSelection.length === 0 : (activeTab === 'LAB' || activeTab === 'IMAGING') ? codeSelection.length === 0 : !selectedCode)}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            처방 추가
          </button>

          {/* 비급여 확인 — 🔴 이 창은 동의를 서버에 남기지 않는다(가짜 게이트 금지). 그래서 '동의 기록'처럼 말하지 않고,
              조사하지 않은 법 조문도 적지 않는다(종전 '의료법 제45조에 따라 사전 동의가 필요' · 2026-09-30) */}
          {showNonCoveredConsent && pendingNonCoveredRx && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
                <h4 className="text-sm font-bold text-amber-900"><T k="비급여 항목 확인" /></h4>
              </div>
              <div className="bg-white rounded-xl p-4 border border-amber-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900">{pendingNonCoveredRx.code.nameKo}</span>
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold whitespace-nowrap">비급여</span>
                </div>
                <p className="text-xs text-gray-500">{pendingNonCoveredRx.code.code} · {pendingNonCoveredRx.code.ingredient ?? ''}</p>
                {pendingNonCoveredRx.code.unitPrice != null && pendingNonCoveredRx.code.unitPrice > 0 && (
                  <p className="text-sm font-mono text-red-600 mt-1">예상 비용: <Money value={pendingNonCoveredRx.code.unitPrice} />/단위</p>
                )}
              </div>
              <div className="text-xs text-amber-800 space-y-1">
                <p>※ 이 항목은 건강보험이 적용되지 않는 비급여 항목입니다(전액 본인부담).</p>
                <p><T k="※ 환자 설명·동의는 원내 절차(동의서)로 받으세요 — 이 화면은 동의를 기록하지 않습니다." /></p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => {
                  setShowNonCoveredConsent(false);
                  setPendingNonCoveredRx(null);
                  handleAddPrescription();
                }} className="flex-1 py-2.5 bg-amber-600 text-white text-sm font-bold rounded-xl hover:bg-amber-700">
                  <T k="확인하고 처방 추가" />
                </button>
                <button onClick={() => {
                  setShowNonCoveredConsent(false);
                  setPendingNonCoveredRx(null);
                  toast.info('비급여 처방이 취소되었습니다.');
                }} className="flex-1 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl hover:bg-gray-200">
                  처방 취소
                </button>
              </div>
            </div>
          )}

          {/* DUR Warnings — 유형별 강조 (IPSG.3 고위험/LASA) */}
          {durPrecheckFailed && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-dur-precheck-failed>
              ⚠ <Tf k="{name} — 선택 즉시 DUR 사전점검을 하지 못했습니다. 처방 추가 시 서버 DUR 점검은 그대로 거칩니다." params={{ name: durPrecheckFailed }} />
            </p>
          )}
          {durWarnings.length > 0 && (() => {
            // 라벨은 shared 정본(DUR_WARNING_TYPE_LABEL — CPOE 경고 부담 분석과 같은 말) · 아이콘·색만 여기
            const TYPE_STYLE: Record<string, { icon: string; cls: string }> = {
              HIGH_ALERT: { icon: '⛔', cls: 'bg-red-100 border-red-300 text-red-800' },
              LASA: { icon: '🔤', cls: 'bg-orange-100 border-orange-300 text-orange-800' },
              ALLERGY: { icon: '🚫', cls: 'bg-red-100 border-red-300 text-red-800' },
              MAX_DOSE: { icon: '📏', cls: 'bg-red-100 border-red-300 text-red-800' },
              INTERACTION: { icon: '⚠️', cls: 'bg-amber-100 border-amber-300 text-amber-800' },
              DUPLICATE: { icon: '♻️', cls: 'bg-amber-50 border-amber-200 text-amber-700' },
              THERAPEUTIC_DUPLICATION: { icon: '♻️', cls: 'bg-amber-50 border-amber-200 text-amber-700' },
              AGE_CONTRAINDICATION: { icon: '🧒', cls: 'bg-amber-100 border-amber-300 text-amber-800' },
              BEERS: { icon: '👴', cls: 'bg-amber-100 border-amber-300 text-amber-800' },
              DOSE_EXCEEDED: { icon: '📏', cls: 'bg-amber-50 border-amber-200 text-amber-700' },
              PREGNANCY: { icon: '🤰', cls: 'bg-amber-100 border-amber-300 text-amber-800' },
            };
            const TYPE_META: Record<string, { icon: string; label: string; cls: string }> = Object.fromEntries(
              Object.entries(TYPE_STYLE).map(([k, v]) => [k, { ...v, label: DUR_WARNING_TYPE_LABEL[k] ?? k }]),
            );
            const sorted = [...durWarnings].sort((a, b) => (a.severity === 'ERROR' ? -1 : 1) - (b.severity === 'ERROR' ? -1 : 1));
            const hasHighAlert = durWarnings.some((w) => w.type === 'HIGH_ALERT' || w.type === 'LASA');
            return (
              <div className={`rounded-xl p-4 border ${durWarnings.some((w) => w.severity === 'ERROR') ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex items-center gap-2 mb-2.5">
                  <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm font-semibold text-gray-800">DUR 안전 점검 ({durWarnings.length})</p>
                  {hasHighAlert && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white">IPSG.3 고위험</span>}
                </div>
                <div className="space-y-1.5">
                  {sorted.map((w: DurWarning, i: number) => {
                    const meta = TYPE_META[w.type ?? ''] ?? { icon: 'ℹ️', label: w.type ?? '안내', cls: 'bg-gray-50 border-gray-200 text-gray-700' };
                    return (
                      <div key={i} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${meta.cls}`}>
                        <span className="text-sm leading-none mt-0.5">{meta.icon}</span>
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-wide mr-1.5"><T k={meta.label} /></span>
                          {w.severity === 'ERROR' && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-600 text-white mr-1.5">차단</span>}
                          <span className="text-xs">{w.message}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hasHighAlert && <p className="text-[10px] text-red-600 mt-2">⛔ 고위험·유사명칭 약물은 투약 전 2인 확인(Two-person check)이 필요합니다.</p>}
              </div>
            );
          })()}

          {/* WeRU.B DUR 정밀점검(참조) — 담긴 약 2종 이상일 때 수동 트리거 (로컬 DUR 패널과 별개·순수 참조) */}
          {(() => {
            const medNames = Array.from(new Set(
              prescriptions
                .filter((rx) => rx.type === 'MEDICATION' && rx.status !== 'DISCONTINUED')
                .map((rx) => (rx.codeName ?? '').split('(')[0].trim())
                .filter(Boolean),
            ));
            if (medNames.length < 2) return null;
            return (
              <WerubDurCheckPanel
                // 약 목록이 바뀌면 앞 목록의 점검 결과를 남기지 않는다(키로 새로 그린다)
                key={medNames.join('|')}
                drugs={medNames}
                age={patient?.dateOfBirth ? (ageOf(patient.dateOfBirth) ?? undefined) : undefined}
              />
            );
          })()}

          {/* CDSS 보완 검증(선택 약물) — 알레르기·신기능 용량(환자 기준). encounterId 미전달 → DUR 패널과 비중복(리뷰 반영·IPSG.3)
              · 🔴 2026-10-21 기록은 남긴다 — logEncounterId 는 판정 범위를 바꾸지 않고 CdssLog(안전 게이트 통계 원천)에만 쓰인다(종전 운영 0건) */}
          {activeTab === 'MEDICATION' && selectedCode && (
            <CdssAlertBanner patientId={patientId} medicationCodeId={selectedCode.id} logEncounterId={encounterId} />
          )}

          {/* Prescriptions List */}
          {prescriptions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                처방 목록 ({prescriptions.length}건)
              </p>
              <div className="space-y-2">
                {prescriptions.map((rx, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {rx.priority === 'STAT' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse">STAT</span>
                        )}
                        {rx.priority === 'PRN' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white">PRN</span>
                        )}
                        {/* 🔴 종전엔 약·검사가 아니면 전부 '영상'이라 적었다(치료·식이·활동·간호지시까지) */}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          rx.type === 'MEDICATION' ? 'bg-blue-100 text-blue-700' :
                          rx.type === 'LAB' ? 'bg-purple-100 text-purple-700' :
                          rx.type === 'IMAGING' ? 'bg-teal-100 text-teal-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          <T k={RX_TYPE_LABEL[rx.type] ?? rx.type} />
                        </span>
                        <span className="text-sm font-medium text-gray-900 truncate">{rx.codeName}</span>
                        {rx.dispensingType === 'EXTERNAL' && <span className="text-[9px] bg-violet-100 text-violet-700 px-1 rounded whitespace-nowrap"><T k="원외" /></span>}
                        {rx.status === 'DISCONTINUED' && <span className="text-[9px] bg-gray-200 text-gray-700 px-1 rounded whitespace-nowrap font-semibold" data-rx-discontinued><T k="중단" /></span>}
                        <span className="text-xs text-gray-400">{rx.codeValue}</span>
                      </div>
                      {rx.type === 'MEDICATION' && rx.dosage && (
                        <p className="text-xs text-gray-500 mt-1 ml-10">
                          {/* 총량 단위는 제형마다 다르다(정·mL·앰플) — '정'을 지어 붙이지 않는다 */}
                          {[rx.dosage, rx.frequency, rx.duration != null ? `${rx.duration}일` : null, rx.quantity != null ? `총 ${rx.quantity}` : null, rx.route].filter(Boolean).join(' / ')}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 ml-10">
                        {/* 급여 정보가 없는 줄(재진입·약속처방으로 담긴 것)은 '비급여'가 아니라 '미상'이다 */}
                        {/* 약은 약가(unitPrice) 보유가 급여 판정 정본(isDrugCovered — 표준코드 임포트가 insuranceCode 를 전 품목에 채웠다),
                            검사·영상은 insuranceCode. 판정 근거가 없는 줄(재진입·약속처방)은 '미상' */}
                        {(() => {
                          const cov = rx.type === 'MEDICATION'
                            ? (rx.unitPrice === undefined ? 'UNKNOWN' : isDrugCovered(rx) ? 'COVERED' : 'NON')
                            : (rx.insuranceCode ? 'COVERED' : rx.insuranceCode === undefined ? 'UNKNOWN' : 'NON');
                          return cov === 'COVERED' ? (
                            <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">급여</span>
                          ) : cov === 'UNKNOWN' ? (
                            <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium whitespace-nowrap"><T k="급여 미상" /></span>
                          ) : (
                            <span className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">비급여</span>
                          );
                        })()}
                        {/* 단가 × 총량(약) — 종전엔 일수를 곱해 금액을 지어냈다. 총량을 모르면 단가만 */}
                        {rx.unitPrice != null && rx.unitPrice > 0 && (
                          <span className="text-[10px] text-gray-400 font-mono">
                            {rx.type === 'MEDICATION' && rx.quantity ? (<><Money value={rx.unitPrice} /> × {rx.quantity} = <Money value={rx.unitPrice * rx.quantity} /></>) : (<><T k="단가" /> <Money value={rx.unitPrice} /></>)}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 중단된 처방은 읽기 전용 — 다시 취소·중단하지 않는다 */}
                    {rx.status !== 'DISCONTINUED' && <button
                      type="button"
                      // 서버에 이미 낸 처방을 취소한다 — 되돌릴 수 없으니 묻는다 · 임상 쓰기 버튼 44px
                      onClick={() => { if (window.confirm(`${rx.codeName ?? ''} 처방을 취소할까요?${rx.id ? '\n이미 전달된 처방이면 약국·검사실에도 취소로 반영됩니다.' : ''}`)) handleRemovePrescription(i); }}
                      aria-label={tA('처방 취소')}
                      className="ml-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Drug Interaction Warning Banner */}
          {drugInteractionLoading && (
            <div className="flex items-center gap-2 text-xs text-amber-600 py-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              약물 상호작용 확인 중...
            </div>
          )}
          {drugInteractionFailed && !drugInteractionLoading && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-interaction-failed>
              ⚠ <T k="약물 상호작용 점검을 하지 못했습니다 — '상호작용 없음'이 아닙니다." />{' '}
              <button type="button" className="font-semibold underline" onClick={() => void checkDrugInteractions(prescriptions)}><T k="다시 시도" /></button>
            </p>
          )}
          {drugInteractions.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                </svg>
                <p className="text-xs font-bold text-amber-800">약물 상호작용 경고</p>
                <button onClick={() => setDrugInteractions([])} className="ml-auto text-amber-400 hover:text-amber-600">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {drugInteractions.map((ix, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${
                    ix.severity === 'HIGH' || ix.severity === 'CRITICAL' ? 'bg-red-500 text-white' :
                    ix.severity === 'MODERATE' ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>{ix.severity}</span>
                  <div>
                    <p className="text-xs font-medium text-gray-800">{ix.drug1} + {ix.drug2}</p>
                    <p className="text-[10px] text-gray-600">{ix.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 진료 첨부(이미지/파일) — 처방 흐름을 가리지 않게 처방 목록 아래로(2026-09-30 · 종전엔 처방 입력 바로 위에 빈 칸이 크게 자리했다) */}
          {encounterId && (
            <div className="p-3 border border-gray-100 rounded-xl bg-white">
              <EncounterAttachments encounterId={encounterId} />
            </div>
          )}

          {/* 타과 협진 */}
          {encounterId && <ConsultationSection encounterId={encounterId} />}

          {/* 진료 대화 스트림(앰비언트) — VoiceHub '대화 기록' 선택 시 표시. config OFF 저하 */}
          {encounterId && (
            <ConversationStreamPanel
              encounterId={encounterId}
              onAppendSoap={appendSoap}
              onGateChange={setAmbientGate}
            />
          )}

          {/* 처방 참고 — 처방/협진 열의 남는 세로 공간을 처방 판단 근거로 채운다(SOAP 열이 더 길어 비어 있었음) */}
          <RxContextPanel patientId={patientId} onPickDrug={(name) => { setActiveTab('MEDICATION'); handleCodeQueryChange(name); }} />
          {discontinueTarget && (
            <DiscontinueDialog
              prescriptionId={discontinueTarget.id}
              name={discontinueTarget.name}
              note={tA('이미 조제·투약이 시작된 처방이라 취소(무효)할 수 없습니다 — 중단하면 지금 이후만 멈춥니다.')}
              onClose={() => setDiscontinueTarget(null)}
              onDone={() => {
                const id = discontinueTarget.id;
                // 중단된 처방은 지우지 않고 표시한다 — 이미 일어난 투약은 기록에 남는다
                const next = prescriptions.map((p) => (p.id === id ? { ...p, status: 'DISCONTINUED' as const } : p));
                setPrescriptions(next);
                void checkDrugInteractions(next.filter((p) => p.status !== 'DISCONTINUED'));
              }}
            />
          )}
        </div>
  );

  return (
    <ClinicalChartCaptureProvider value={clinicalCapture}>
    <EncounterRefProvider value={encounterId ? { encounterId, patientId } : null}>
    <div
      // 드래그 폭이 있으면 그 값으로 여백(정확히 패널 폭 + 간격), 없으면 종전 프리셋 클래스
      style={chartOpen && chartWidthPx ? { paddingRight: chartWidthPx + 16 } : undefined}
      className={`w-full space-y-4 transition-[padding] ${chartOpen && !chartWidthPx ? (chartExpanded ? REF_PAD[refWidth] : 'sm:pr-[460px]') : ''}`}
    >
      {/* 환자 차트(참조) 분할 패널 — 진료 작성 중 옆에서 보기. 토글 버튼은 환자명 옆 헤더에 위치. */}
      {chartOpen && (
        <PatientChartDrawer
          patientId={patientId}
          patientMrn={patient?.mrn}
          onClose={() => setChartOpen(false)}
          expanded={chartExpanded}
          onToggleExpand={() => setChartExpanded((v) => !v)}
          width={refWidth}
          onCycleWidth={cycleRefWidth}
          onWidthChange={setChartWidthPx}
        />
      )}

      {/* 🔴 게이트 판정 재료(입원 여부·처방집 시행모드)를 못 읽으면 게이트가 조용히 꺼진다 —
          "위반 없음"으로 보이지 않도록 못 읽었다는 사실을 화면에 남긴다 */}
      {admIsError && (
        <div>
          <p className="text-[11px] font-bold text-gray-400 mb-1">입원 여부(활력징후 필수 판정)</p>
          <QueryErrorFallback error={admError} onRetry={refetchAdm} size="compact" />
        </div>
      )}
      {fmPolicyIsError && (
        <div>
          <p className="text-[11px] font-bold text-gray-400 mb-1">원내 처방집 시행 모드</p>
          <QueryErrorFallback error={fmPolicyError} onRetry={refetchFmPolicy} size="compact" />
        </div>
      )}

      {/* Patient Header — 스크롤해도 환자 식별·알레르기가 늘 보이게 위에 고정(오환자 기록 방지) */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur rounded-2xl shadow-sm border border-gray-100 px-6 py-4" data-encounter-header>
        {/* 🔴 좁은 폭에서 flex 자식이 눌리며 '환자 차트'가 한 글자씩 세로로 쪼개졌다 →
            줄바꿈 허용(wrap)+각 항목 shrink-0/whitespace-nowrap. 라벨은 xl 미만에서 숨기고 아이콘만 남긴다. */}
        <div className="flex flex-wrap items-center justify-between gap-y-2">
          <div className="flex items-center gap-4">
            <Link
              href={`/patients/${patientId}`}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </Link>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="shrink-0 whitespace-nowrap text-lg font-bold text-gray-900">{patient.familyName}{patient.givenName}</h2>
                <button
                  onClick={() => setChartOpen((v) => !v)}
                  className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${chartOpen ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                  title="환자 차트 참조 패널"
                  aria-label="환자 차트"
                >
                  📋 <span className="hidden xl:inline"><T k="환자 차트" /></span>
                </button>
                {/* 지난 기록을 시간축 하나로 — 진료 중 경과 파악(참조 패널 '기록 시계열' 탭과 동일 뷰) */}
                <button
                  onClick={() => { setChartOpen(true); window.dispatchEvent(new CustomEvent('chart-drawer:tab', { detail: 'timeline' })); }}
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                  title="지난 진료·검사·영상·처방·활력·입퇴원을 한 시간축에서 보기"
                  aria-label="기록 시계열"
                >
                  🕒 <span className="hidden xl:inline"><T k="기록 시계열" /></span>
                </button>
                <SmartAppLauncher patientId={patientId} compact />

                {/* 문서 출력 — 하단 액션 바에 묻혀 있던 것을 헤더 빈 공간으로(진료 중 언제든 새 창으로 출력).
                    이웃 버튼이 이미 색을 쓰고 있어 여기선 중립 톤 — 주 동작이 아니라 부수 동작이다. */}
                {encounterId && (
                  <>
                    <span className="mx-0.5 h-4 w-px bg-gray-200" aria-hidden />
                    {DOC_PRINTS.map((d) => (
                      <button
                        key={d.kind}
                        type="button"
                        onClick={() => ('certType' in d
                          ? openDoc(`/workstation/certificates?patientId=${patientId}&type=${d.certType}${encounterId ? `&encounterId=${encounterId}` : ''}`, `cert-${d.kind}`)
                          : openDoc(`/print/${d.kind}/${encounterId}`, d.kind))}
                        title={'certType' in d ? `${d.label} 발급(발급 대장) — 새 창` : `${d.label} 새 창으로 출력`}
                        aria-label={d.label}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={d.icon} />
                        </svg>
                        <span className="hidden xl:inline"><T k={d.label} /></span>
                      </button>
                    ))}
                    {/* 외부 의뢰·회송 — 전원 화면을 이 환자로(회송 수가·진료 연속성의 근거 문서) */}
                    <button
                      type="button"
                      onClick={() => openDoc(`/transfer/request?patientId=${patientId}`, 'transfer-request')}
                      title={tA('의뢰·회송 — 새 창')}
                      aria-label={tA('의뢰·회송')}
                      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                      data-referral-link
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
                      <span className="hidden xl:inline"><T k="의뢰·회송" /></span>
                    </button>
                  </>
                )}
              </div>
              <p className="text-xs text-gray-500">
                MRN: {patient.mrn}
                <span className="mx-1.5 text-gray-300">·</span>
                {patient.gender === 'MALE' ? '남' : patient.gender === 'FEMALE' ? '여' : '-'}
                {patient.dateOfBirth && ageOf(patient.dateOfBirth) != null ? ` · 만 ${ageOf(patient.dateOfBirth)}세` : ''}
                <span className="mx-1.5 text-gray-300">·</span>
                {patient.bloodType ? `${patient.bloodType}형` : '혈액형 미상'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* 음성 허브 — 진료 기록(스크라이브)+명령·구술(VoiceEMR) 단일 진입점(config OFF면 각자 저하) */}
            {encounterId && (
              <VoiceHub
                encounterId={encounterId}
                onApplySoap={(field, text, source) => {
                  // 🔴 음성 쓰기(구술·스크라이브 초안)는 **append 정본 하나**(`appendSoap`) — 종전엔 여기서
                  //    `setSoap(prev => ({...prev, [field]: text}))` 로 수기 입력을 **덮어썼다**(§13.2 P0-1·P1-1 · 앰비언트만 append 였다).
                  appendSoap(field, text);
                  markSoapDraftApplied(source, [String(field).charAt(0).toUpperCase()], text?.length ?? 0);
                }}
                onOrderDraft={(d) => {
                  // 음성 오더 → 해당 처방 탭 전환 + 검색 프리필(코드→ID·DUR·step-up 은 처방 폼/정본 EP 에서 강제).
                  if (d.type === 'MEDICATION' || d.type === 'LAB' || d.type === 'IMAGING') setActiveTab(d.type);
                  const q = d.type === 'MEDICATION' ? d.code
                    : d.type === 'LAB' ? (d.labs?.[0]?.term || d.labs?.[0]?.code || undefined)
                    : d.modality;
                  if (q) handleCodeQueryChange(String(q));
                  const detail = [d.code && `코드 ${d.code}`, d.dosage && `${d.dosage}${d.doseUnit || ''}`, d.frequency, d.modality, d.bodyPart]
                    .filter(Boolean).join(' · ');
                  toast.info(`음성 오더 후보를 처방 탭에 띄웠습니다${detail ? ` (${detail})` : ''}. 확인 후 확정하세요(DUR·승인 적용).`);
                }}
              />
            )}
            <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
              {INSURANCE_LABEL[patient.insuranceType] ?? patient.insuranceType}
            </span>
            {isolationIsError ? (
              <button type="button" onClick={() => refetchIsolation()} data-isolation-error
                className="shrink-0 whitespace-nowrap text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white text-red-700 border border-red-300 hover:bg-red-50">
                ⚠ <T k="격리 상태 조회 실패" /> · <T k="다시 시도" />
              </button>
            ) : isolationLoading ? null : isolationPrecautions.length > 0 ? (
              <span
                className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-orange-100 text-orange-800 border border-orange-300"
                title={isolationPrecautions.map(p => `${ISO_LABEL[p.type] ?? p.type}${p.protocol?.requiredPPE?.length ? ` · PPE: ${p.protocol.requiredPPE.join(', ')}` : ''}`).join(' / ')}
              >
                ⚠ 격리: {isolationPrecautions.map(p => ISO_LABEL[p.type] ?? p.type).join(', ')}
                <button
                  onClick={() => { if (window.confirm(`격리 ${isolationPrecautions.length}건을 모두 해제할까요?`)) isoReleaseMut.mutate(isolationPrecautions.map(p => p.id)); }}
                  disabled={isoReleaseMut.isPending}
                  className="ml-0.5 px-1.5 py-0.5 rounded bg-white/70 text-gray-600 hover:bg-white disabled:opacity-50">해제</button>
              </span>
            ) : (
              <button
                onClick={() => setShowIsoForm(v => !v)}
                className="shrink-0 whitespace-nowrap text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 hover:bg-orange-50 hover:text-orange-700">+ 격리 지시</button>
            )}
            {allergyStatus === 'ERROR' && (
              <button type="button" onClick={() => refetchAllergy()} data-allergy-error
                className="shrink-0 whitespace-nowrap text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white text-red-700 border border-red-300 hover:bg-red-50">
                ⚠ <T k="알레르기 조회 실패 — 확인 전 처방 주의" /> · <T k="다시 시도" />
              </button>
            )}
            {allergyStatus === 'LOADING' && (
              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500"><T k="알레르기 확인 중…" /></span>
            )}
            {allergyStatus === 'HAS_ALLERGIES' && (
              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                {/* 상태는 '있음'인데 항목이 비어 오면 사라지지 않고 '항목 미상'으로 말한다 */}
                🚫 알레르기: {activeAllergies.length > 0 ? activeAllergies.map((a: AllergyBannerItem) => a.allergen).join(', ') : tA('있음(항목 미상)')}
              </span>
            )}
            {allergyStatus === 'NO_KNOWN_ALLERGIES' && (
              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                ✓ 무알레르기 확인{allergyAssessedAt ? ` (${allergyAssessedAt.slice(0, 10)})` : ''}
              </span>
            )}
            {allergyStatus === 'UNABLE_TO_ASSESS' && (
              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                알레르기 문진 불가
              </span>
            )}
            {allergyStatus === 'NOT_ASSESSED' && (
              <span className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                ⚠ 알레르기 미확인
                <button
                  onClick={() => { if (window.confirm('이 환자를 문진 결과 "무알레르기(NKA)"로 기록할까요?')) assessAllergyMut.mutate('NO_KNOWN_ALLERGIES'); }}
                  disabled={assessAllergyMut.isPending}
                  className="ml-0.5 px-1.5 py-0.5 rounded bg-white/70 text-emerald-700 hover:bg-white disabled:opacity-50">무알레르기 확인</button>
                <button
                  onClick={() => { if (window.confirm('문진 불가(의식저하·의사소통 곤란 등)로 기록할까요?')) assessAllergyMut.mutate('UNABLE_TO_ASSESS'); }}
                  disabled={assessAllergyMut.isPending}
                  className="px-1.5 py-0.5 rounded bg-white/70 text-gray-600 hover:bg-white disabled:opacity-50">문진 불가</button>
              </span>
            )}
            {!encounterId && !isCreating && (
              <button
                onClick={handleStartEncounter}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                진료 시작
              </button>
            )}
            {isCreating && !encounterId && (
              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                진료 생성 중...
              </span>
            )}
            {encounterId && (
              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                진료 진행중
              </span>
            )}
          </div>
        </div>
        {showIsoForm && isolationPrecautions.length === 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 bg-orange-50/60 border border-orange-100 rounded-xl p-2.5">
            <span className="text-[11px] font-semibold text-orange-700">격리 지시</span>
            <select value={isoType} onChange={e => setIsoType(e.target.value)}
              className="px-2 py-1 border border-orange-200 rounded-lg text-xs bg-white">
              {Object.entries(ISO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={isoReason} maxLength={500} onChange={e => setIsoReason(e.target.value)} placeholder="사유(병원체/상황)"
              className="flex-1 min-w-[160px] px-2 py-1 border border-orange-200 rounded-lg text-xs" />
            <button
              onClick={() => { if (!isoReason.trim()) { toast.warning('사유를 입력하세요'); return; } isoOrderMut.mutate({ isolationType: isoType, reason: isoReason.trim() }); }}
              disabled={isoOrderMut.isPending}
              className="px-3 py-1 bg-orange-600 text-white rounded-lg text-xs font-medium hover:bg-orange-700 disabled:opacity-50">발행</button>
            <button onClick={() => setShowIsoForm(false)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">취소</button>
          </div>
        )}
      </div>

      {!encounterId && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          {createError ? (
            <>
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
              </div>
              <p className="text-sm text-red-600 mb-4">{createError}</p>
              <button onClick={handleStartEncounter} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">다시 시도</button>
            </>
          ) : (
            <>
              <div className="w-12 h-12 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-gray-500">진료 기록을 생성하고 있습니다...</p>
            </>
          )}
        </div>
      )}

      {/* 진료과 레이아웃 공통 머리 — 간호사 측정 바이탈·임신 여부(DUR 임부금기 입력). 종전엔 진료과 레이아웃에서 둘 다 보이지 않았다 */}
      {encounterId && specialtyLayout !== 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-specialty-context>
          {nurseVitalsCard}
          <PregnancyStatusCard
            encounterId={encounterId}
            patient={patient}
            value={((existingEncounter.data?.data ?? existingEncounter.data) as Record<string, unknown> | undefined)?.pregnancyStatus as string | undefined}
          />
        </div>
      )}

      {/* Specialty Layouts */}
      {encounterId && specialtyLayout === 'dental' && (
        <DentalEncounterLayout rxSlot={rxColumn}
          patientId={patientId}
          encounterId={encounterId}
          onStartEncounter={handleStartEncounter}
          patient={patient}
          onSaveDraft={handleSaveDraft}
          onSignAndBill={handleSignAndBill}
          isSaving={isSaving}
          isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'ophthalmology' && (
        <OphthalmologyEncounterLayout rxSlot={rxColumn}
          patientId={patientId}
          encounterId={encounterId}
          onStartEncounter={handleStartEncounter}
          patient={patient}
          onSaveDraft={handleSaveDraft}
          onSignAndBill={handleSignAndBill}
          isSaving={isSaving}
          isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'dermatology' && (
        <DermatologyEncounterLayout rxSlot={rxColumn}
          patientId={patientId}
          encounterId={encounterId}
          onStartEncounter={handleStartEncounter}
          patient={patient}
          onSaveDraft={handleSaveDraft}
          onSignAndBill={handleSignAndBill}
          isSaving={isSaving}
          isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'ent' && (
        <EntEncounterLayout rxSlot={rxColumn}
          patientId={patientId}
          encounterId={encounterId}
          onStartEncounter={handleStartEncounter}
          patient={patient}
          onSaveDraft={handleSaveDraft}
          onSignAndBill={handleSignAndBill}
          isSaving={isSaving}
          isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'orthopedics' && (
        <OrthopedicsEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'obgyn' && (
        <ObGynEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'pediatrics' && (
        <PediatricsEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'psychiatry' && (
        <PsychiatryEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'neurosurgery' && (
        <NeurosurgeryEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'plastic' && (
        <PlasticEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'urology' && (
        <UrologyEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'internal-medicine' && (
        <InternalMedicineEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning} requireVitals={requireVitals}
        />
      )}
      {encounterId && specialtyLayout === 'surgery' && (
        <SurgeryEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'emergency' && (
        <EmergencyEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'family-medicine' && (
        <FamilyMedicineEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}
      {encounterId && specialtyLayout === 'rehab' && (
        <RehabEncounterLayout rxSlot={rxColumn}
          patientId={patientId} encounterId={encounterId} onStartEncounter={handleStartEncounter}
          patient={patient} onSaveDraft={handleSaveDraft} onSignAndBill={handleSignAndBill}
          isSaving={isSaving} isSigning={isSigning}
        />
      )}

      {/* Two Column Layout: SOAP | Prescriptions (WeRU.B는 하단 전체폭) */}
      {encounterId && specialtyLayout === 'general' && (<>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: SOAP Notes or Chart Template */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          {/* 차트 템플릿 선택기 */}
          <ChartTemplateSelector
            useTemplate={useChartTemplate}
            selectedTemplate={selectedTemplate as { id: string; name: string; department: string; role: string; isPersonal?: boolean; sections?: unknown[] } | null}
            onToggle={() => setUseChartTemplate(!useChartTemplate)}
            onSelect={async (t) => {
              setSelectedTemplate(t as ChartTemplate);
              setUseChartTemplate(true);
              // 템플릿을 바꾸면 이전 템플릿의 값·합성분은 더는 유효하지 않다(다음 합성이 잘라낼 근거 상실)
              setChartValues({});
              chartComposedRef.current = {};
              // 사용 기록
              try { await apiClient.post(`/api/v1/chart-templates/${t.id}/use`, {}); } catch {}
            }}
            diagnosisCodes={
              // SOAP Assessment에서 KCD 코드 패턴 추출 (예: J18, E11.2)
              soap.assessment
                ? (soap.assessment.match(/[A-Z]\d{2}(?:\.\d{1,2})?/g) ?? [])
                : undefined
            }
          />

          {/* 차트 템플릿 모드 */}
          {useChartTemplate && selectedTemplate && (
            <div>
              <ChartSaveNotice sections={chartSections} templateName={selectedTemplate.name} />
              <ChartRenderer
                sections={(selectedTemplate.sections ?? []) as React.ComponentProps<typeof ChartRenderer>['sections']}
                layout={selectedTemplate.layout ?? 'tabs'}
                values={chartValues}
                onChange={handleChartFieldChange}
                disabled={!encounterId}
              />
              <button onClick={handleSaveSOAP} disabled={!encounterId || isSaving}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40">
                {isSaving ? '저장중...' : '차트 저장'}
              </button>
            </div>
          )}

          {/* 문진표 응답 배너 */}
          {questionnaires.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-indigo-600">📋</span>
                  <span className="text-xs font-semibold text-indigo-800">사전 문진표 {questionnaires.length}<Unit>건</Unit> 작성됨</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setShowQuestionnaire(!showQuestionnaire)}
                    className="text-xs px-2.5 py-1 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-100">
                    {showQuestionnaire ? '접기' : '보기'}
                  </button>
                  <button onClick={() => questionnaires[0].submission && applyQuestionnaireToSOAP(questionnaires[0].submission)}
                    className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                    SOAP에 반영
                  </button>
                </div>
              </div>
              {showQuestionnaire && (
                <div className="mt-2 pt-2 border-t border-indigo-200 space-y-2">
                  {questionnaires.map((q: QuestionnaireResponse) => (
                    <div key={q.id} className="bg-white rounded-lg p-3">
                      <p className="text-xs font-medium text-gray-700 mb-1.5">{q.formSchema?.name} ({q.completedAt ? kdate(q.completedAt) : '-'})</p>
                      <div className="grid grid-cols-2 gap-1 text-[11px]">
                        {Object.entries(q.submission?.data ?? {}).map(([k, v]) => {
                          if (!v || (Array.isArray(v) && v.length === 0)) return null;
                          const displayVal = Array.isArray(v) ? v.join(', ') : String(v);
                          if (!displayVal) return null;
                          return (
                            <div key={k} className="flex gap-1">
                              <span className="text-gray-400 shrink-0">{labelMap[k] ?? k}:</span>
                              <span className="text-gray-700 truncate">{displayVal}</span>
                            </div>
                          );
                        })}
                      </div>
                      {questionnaires.length > 1 && (
                        <button onClick={() => q.submission && applyQuestionnaireToSOAP(q.submission)}
                          className="mt-1.5 text-[10px] text-indigo-600 hover:underline">이 문진표 반영</button>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {q.reviewedAt ? (
                          <span className="text-[10px] text-green-700">
                            <Tf k="검토 {검토자} · {시각}" params={{ 검토자: q.reviewer ? `${q.reviewer.familyName}${q.reviewer.givenName}` : tA('검토자 확인 불가'), 시각: kdate(q.reviewedAt, 'datetime') }} />
                          </span>
                        ) : (
                          <button onClick={() => reviewQuestionnaire.mutate(q.id)} disabled={reviewQuestionnaire.isPending}
                            className="min-h-[44px] text-[11px] px-3 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50">
                            <T k="검토 완료" />
                          </button>
                        )}
                        <span className="text-[10px] text-gray-400"><T k="검토 완료는 응답을 읽었다는 표시이며 임상 기록 확정이 아닙니다" /></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {nurseVitalsCard}

          {/* 임신 여부 — DUR 임부금기·영상 방사선 판정 입력(가임기 여성만) */}
          <PregnancyStatusCard
            encounterId={encounterId}
            patient={patient}
            value={((existingEncounter.data?.data ?? existingEncounter.data) as Record<string, unknown> | undefined)?.pregnancyStatus as string | undefined}
          />

          {/* 외래 간호 기록 */}
          {encounterId && (
            <div className="rounded-xl border border-gray-100 px-4 py-3">
              <NursingNotePanel
                patientId={patientId}
                contextType="OUTPATIENT"
                contextId={encounterId}
                compact
              />
            </div>
          )}

          {/* 기록 모드 토글 */}
          {!useChartTemplate && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4">
              <button onClick={() => setRecordMode('soap')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${recordMode === 'soap' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                간단 (SOAP)
              </button>
              <button onClick={() => setRecordMode('structured')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${recordMode === 'structured' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                구조화 (CC/HPI/PMH/ROS/PE)
              </button>
            </div>
          )}

          {/* 구조화 입력 모드 */}
          {!useChartTemplate && recordMode === 'structured' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15" /></svg>
                구조화 의무기록
              </h3>
              <DraftBanner provenance={soapDraftProvenance} signLabel="서명" />

              {/* CC: 주소 */}
              <div>
                <label className="block text-xs font-bold text-red-600 uppercase tracking-wide mb-1">CC (주소) *</label>
                <input value={structured.chiefComplaint}
                  onChange={e => setStructured(s => ({...s, chiefComplaint: e.target.value}))}
                  placeholder="두통, 어지러움, 흉통 등 방문 사유..."
                  disabled={!encounterId}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>

              {/* HPI: 현병력 */}
              <div>
                <label className="block text-xs font-bold text-blue-600 uppercase tracking-wide mb-1">HPI (현병력)</label>
                <textarea value={structured.historyPresentIllness}
                  onChange={e => setStructured(s => ({...s, historyPresentIllness: e.target.value}))}
                  rows={3} placeholder="발병 시기, 경과, 양상, 악화/완화 인자, 동반 증상..."
                  disabled={!encounterId}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" />
              </div>

              {/* PMH: 과거력 */}
              <div>
                <label className="block text-xs font-bold text-purple-600 uppercase tracking-wide mb-1">PMH (과거력)</label>
                <textarea value={structured.pastMedicalHistory}
                  onChange={e => setStructured(s => ({...s, pastMedicalHistory: e.target.value}))}
                  rows={2} placeholder="기저질환, 수술력, 입원력..."
                  disabled={!encounterId}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" />
              </div>

              {/* FH: 가족력 */}
              <div>
                <label className="block text-xs font-bold text-teal-600 uppercase tracking-wide mb-1">FH (가족력)</label>
                <input value={structured.familyHistory}
                  onChange={e => setStructured(s => ({...s, familyHistory: e.target.value}))}
                  placeholder="부: 고혈압, 모: 당뇨, 형제: 특이사항 없음..."
                  disabled={!encounterId}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>

              {/* SH: 사회력 */}
              <div>
                <label className="block text-xs font-bold text-amber-600 uppercase tracking-wide mb-1.5">SH (사회력)</label>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400">흡연</label>
                    <select value={structured.socialHistory.smoking}
                      onChange={e => setStructured(s => ({...s, socialHistory: {...s.socialHistory, smoking: e.target.value}}))}
                      className="w-full border rounded-lg px-2 py-1.5 text-xs">
                      <option value="">선택 안 함</option><option>비흡연</option><option>과거 흡연</option><option>현재 흡연</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400">음주</label>
                    <select value={structured.socialHistory.alcohol}
                      onChange={e => setStructured(s => ({...s, socialHistory: {...s.socialHistory, alcohol: e.target.value}}))}
                      className="w-full border rounded-lg px-2 py-1.5 text-xs">
                      <option value="">선택 안 함</option><option>없음</option><option>사회적</option><option>주 1-2회</option><option>주 3회 이상</option><option>매일</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400">직업</label>
                    <input value={structured.socialHistory.occupation}
                      onChange={e => setStructured(s => ({...s, socialHistory: {...s.socialHistory, occupation: e.target.value}}))}
                      placeholder="사무직, 주부..."
                      className="w-full border rounded-lg px-2 py-1.5 text-xs" />
                  </div>
                </div>
              </div>

              {/* ROS: 계통별 문진 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-indigo-600 uppercase tracking-wide">ROS (계통별 문진)</label>
                  <button onClick={() => {
                    const allNormal: Record<string, {normal: boolean; findings: string}> = {};
                    ['전신','두경부','심혈관','호흡기','소화기','비뇨생식','근골격','신경','정신','피부','내분비','혈액'].forEach(k => allNormal[k] = {normal: true, findings: ''});
                    setStructured(s => ({...s, reviewOfSystems: allNormal}));
                  }} className="text-[10px] text-indigo-600 hover:underline">전체 정상 체크</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                  {['전신','두경부','심혈관','호흡기','소화기','비뇨생식','근골격','신경','정신','피부','내분비','혈액'].map(system => {
                    const ros = structured.reviewOfSystems[system] ?? { normal: false, findings: '' };
                    return (
                      <div key={system} className={`border rounded-lg px-2.5 py-2 ${ros.normal ? 'bg-emerald-50 border-emerald-200' : ros.findings ? 'bg-amber-50 border-amber-200' : 'border-gray-200'}`}>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={ros.normal}
                            onChange={e => setStructured(s => ({...s, reviewOfSystems: {...s.reviewOfSystems, [system]: {normal: e.target.checked, findings: e.target.checked ? '' : ros.findings}}}))}
                            className="rounded text-emerald-600 w-3.5 h-3.5" />
                          <span className="text-xs font-medium text-gray-700">{system}</span>
                        </label>
                        {!ros.normal && (
                          <input value={ros.findings}
                            onChange={e => setStructured(s => ({...s, reviewOfSystems: {...s.reviewOfSystems, [system]: {normal: false, findings: e.target.value}}}))}
                            placeholder="이상 소견..."
                            className="mt-1 w-full border-0 border-b border-gray-200 px-0 py-0.5 text-xs focus:ring-0 focus:border-blue-400 bg-transparent" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* PE: 신체검진 */}
              <div>
                <label className="block text-xs font-bold text-emerald-600 uppercase tracking-wide mb-1.5">PE (신체검진)</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                  {['전신상태','두경부','흉부','심음','복부','사지','신경','피부','기타'].map(area => {
                    const pe = structured.physicalExamination[area] ?? { normal: false, findings: '' };
                    return (
                      <div key={area} className={`border rounded-lg px-2.5 py-2 ${pe.normal ? 'bg-emerald-50 border-emerald-200' : pe.findings ? 'bg-blue-50 border-blue-200' : 'border-gray-200'}`}>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={pe.normal}
                            onChange={e => setStructured(s => ({...s, physicalExamination: {...s.physicalExamination, [area]: {normal: e.target.checked, findings: e.target.checked ? '정상' : ''}}}))}
                            className="rounded text-emerald-600 w-3.5 h-3.5" />
                          <span className="text-xs font-medium text-gray-700">{area}</span>
                        </label>
                        {!pe.normal && (
                          <input value={pe.findings}
                            onChange={e => setStructured(s => ({...s, physicalExamination: {...s.physicalExamination, [area]: {normal: false, findings: e.target.value}}}))}
                            placeholder="소견..."
                            className="mt-1 w-full border-0 border-b border-gray-200 px-0 py-0.5 text-xs focus:ring-0 focus:border-blue-400 bg-transparent" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 구조화 -> SOAP 변환 + 저장 */}
              <div className="flex gap-2">
                <button onClick={() => {
                  // 구조화 -> SOAP 자동 합성
                  const sLines = [
                    structured.chiefComplaint && `CC: ${structured.chiefComplaint}`,
                    structured.historyPresentIllness && `HPI: ${structured.historyPresentIllness}`,
                    structured.pastMedicalHistory && `PMH: ${structured.pastMedicalHistory}`,
                    structured.familyHistory && `FH: ${structured.familyHistory}`,
                    // 사회력은 고른 항목만 — 고르지 않은 흡연·음주를 '비흡연·없음'으로 적지 않는다
                    (() => {
                      const sh = [
                        structured.socialHistory.smoking && `흡연(${structured.socialHistory.smoking})`,
                        structured.socialHistory.alcohol && `음주(${structured.socialHistory.alcohol})`,
                        structured.socialHistory.occupation && `직업(${structured.socialHistory.occupation})`,
                      ].filter(Boolean);
                      return sh.length ? `SH: ${sh.join(', ')}` : '';
                    })(),
                  ].filter(Boolean).join('\n');
                  // 🔴 ROS 를 하나도 체크하지 않았으면 '전체 정상'이 아니라 '미시행'이다(종전: 빈 문진이 정상 ROS 로 서명됐다)
                  const rosEntries = Object.entries(structured.reviewOfSystems);
                  const rosAbn = rosEntries.filter(([,v]) => !v.normal && v.findings).map(([k,v]) => `${k}: ${v.findings}`);
                  const rosNormal = rosEntries.filter(([,v]) => v.normal).map(([k]) => k);
                  const rosText = rosAbn.length === 0 && rosNormal.length === 0
                    ? 'ROS: 미시행'
                    : `ROS: ${[rosAbn.length ? rosAbn.join(', ') : '', rosNormal.length ? `정상(${rosNormal.join('·')})` : ''].filter(Boolean).join(' / ')}`;
                  const peFindings = Object.entries(structured.physicalExamination).map(([k,v]) => `${k}: ${v.normal ? '정상' : v.findings || '-'}`);
                  const oLines = [peFindings.length ? `PE:\n${peFindings.join('\n')}` : 'PE: 미기록', rosText].join('\n');
                  // 이미 적은 S·O 를 말없이 덮지 않는다
                  if ((soap.subjective.trim() || soap.objective.trim()) && !confirm('이미 작성한 S·O 내용을 구조화 기록으로 바꿉니다. 계속할까요?')) return;
                  setSoap(prev => ({
                    ...prev,
                    subjective: sLines,
                    objective: oLines,
                  }));
                  setRecordMode('soap');
                  toast.success('구조화 기록이 SOAP에 반영되었습니다.');
                }} disabled={!encounterId}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40">
                  SOAP에 반영
                </button>
                <button onClick={async () => {
                  if (!encounterId) return;
                  setIsSaving(true);
                  try {
                    await updateEncounter.mutateAsync({
                      id: encounterId,
                      data: {
                        chiefComplaint: structured.chiefComplaint,
                        historyPresentIllness: structured.historyPresentIllness,
                        pastMedicalHistory: structured.pastMedicalHistory,
                        familyHistory: structured.familyHistory,
                        socialHistory: structured.socialHistory,
                        reviewOfSystems: structured.reviewOfSystems,
                        physicalExamination: structured.physicalExamination,
                        ...amendExtra(),
                      },
                    });
                    toast.success('구조화 기록이 저장되었습니다.');
                  } catch { toast.error('저장 실패'); }
                  setIsSaving(false);
                }} disabled={!encounterId || isSaving}
                  className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 disabled:opacity-40">
                  {isSaving ? '저장 중...' : '구조화 저장'}
                </button>
              </div>
            </div>
          )}

          {/* 기존 SOAP 모드 */}
          {!useChartTemplate && recordMode === 'soap' && (<>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              SOAP 노트
            </h3>
            {soapSaved && (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                저장됨
              </span>
            )}
          </div>
          {/* 🔴 초안≠확정 — AI 초안이 들어간 SOAP 는 서명 전까지 그 사실을 화면이 말한다(§7.6-b). 구조화 모드·템플릿 모드에도 동일 상태를 쓴다 */}
          <DraftBanner provenance={soapDraftProvenance} signLabel="서명" />

          {/* WeRU.B 보조 버튼 */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: `${AI_ORIGIN_TEXT} 요약`, icon: '📝', action: async () => {
                if (!soap.subjective && !soap.objective) return toast.warning('S/O 내용을 먼저 입력하세요.');
                setAiLoading(true); setAiResult(null);
                try {
                  const text = `S: ${soap.subjective}\nO: ${soap.objective}\nA: ${soap.assessment}\nP: ${soap.plan}`;
                  const res = await apiClient.post<{ data: AiResultData }>('/api/v1/ai/summarize', { text });
                  setAiResult({ type: 'summarize', data: res.data });
                } catch { toast.error(`${AI_ORIGIN_TEXT} 요약 실패`); } setAiLoading(false);
              }},
              { label: '감별진단', icon: '🔍', action: async () => {
                if (!soap.subjective) return toast.warning('S 내용을 먼저 입력하세요.');
                setAiLoading(true); setAiResult(null);
                try {
                  const res = await apiClient.post<{ data: AiResultData }>('/api/v1/ai/diagnose', { symptoms: soap.subjective.split(/[,，\n]/).map(s => s.trim()).filter(Boolean) });
                  setAiResult({ type: 'diagnose', data: res.data });
                } catch { toast.error('감별진단 실패'); } setAiLoading(false);
              }},
              { label: '약물참고', icon: '💊', action: async () => {
                const q = soap.plan || soap.assessment || '약물 정보';
                setAiLoading(true); setAiResult(null);
                try {
                  const res = await apiClient.post<{ data: AiResultData }>('/api/v1/ai/reference', { question: q, category: 'drug' });
                  setAiResult({ type: 'reference', data: res.data });
                } catch { toast.error('약물참고 실패'); } setAiLoading(false);
              }},
              { label: '환자설명', icon: '📄', action: async () => {
                if (!soap.assessment) return toast.warning('A 내용을 먼저 입력하세요.');
                setAiLoading(true); setAiResult(null);
                try {
                  const res = await apiClient.post<{ data: AiResultData }>('/api/v1/ai/explain', { diagnosis: soap.assessment, treatmentPlan: soap.plan || '' });
                  setAiResult({ type: 'explain', data: res.data });
                } catch { toast.error('환자설명 생성 실패'); } setAiLoading(false);
              }},
            ].map(btn => (
              <button key={btn.label} onClick={btn.action} disabled={aiLoading || !encounterId}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                <span>{btn.icon}</span> {btn.label}
              </button>
            ))}
            {aiLoading && <span className="text-xs text-indigo-500 animate-pulse ml-2 self-center">{AI_ORIGIN_TEXT} 처리중...</span>}
          </div>

          {/* WeRU.B 결과 표시 */}
          {aiResult && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-indigo-600 uppercase">
                  {aiResult.type === 'summarize' ? `${AI_ORIGIN_TEXT} 요약` : aiResult.type === 'diagnose' ? '감별진단' : aiResult.type === 'reference' ? '약물참고' : '환자설명'}
                </span>
                <button onClick={() => setAiResult(null)} className="text-indigo-400 hover:text-indigo-600"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
              {aiResult.type === 'summarize' && aiResult.data?.summary && (() => {
                const summary = aiResult.data.summary!;
                return (
                <div className="space-y-1 text-xs text-gray-700">
                  <p><strong>S:</strong> {summary.subjective}</p>
                  <p><strong>O:</strong> {summary.objective}</p>
                  <p><strong>A:</strong> {summary.assessment}</p>
                  <p><strong>P:</strong> {summary.plan}</p>
                  {(aiResult.data.icd_codes?.length ?? 0) > 0 && <p className="mt-1 text-indigo-600">ICD: {aiResult.data.icd_codes!.join(', ')}</p>}
                  <button onClick={() => {
                    // 🔴 AI 요약은 **초안**이다 — 종전엔 초안 표시·감사 기록 없이 네 칸을 통째로 덮었다(2026-09-30).
                    //    바뀌는 칸만 초안으로 표시하고, 의사가 이미 적은 칸을 덮을 때는 먼저 묻는다.
                    const next = { subjective: summary.subjective || soap.subjective, objective: summary.objective || soap.objective, assessment: summary.assessment || soap.assessment, plan: summary.plan || soap.plan };
                    const keys = ['subjective', 'objective', 'assessment', 'plan'] as const;
                    const changed = keys.filter((k) => !!summary[k] && summary[k] !== soap[k]);
                    const overwritten = changed.filter((k) => soap[k].trim());
                    if (overwritten.length && !confirm(`이미 작성한 ${overwritten.map((k) => k[0].toUpperCase()).join('·')} 칸을 ${AI_ORIGIN_TEXT} 요약 초안으로 바꿉니다. 계속할까요?`)) return;
                    setSoap(next);
                    if (changed.length) markSoapDraftApplied('ASSISTANT', changed.map((k) => k[0].toUpperCase()), changed.reduce((n, k) => n + (summary[k]?.length ?? 0), 0));
                    setAiResult(null);
                  }}
                    className="mt-2 px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700">SOAP에 반영</button>
                </div>
                ); })()}
              {aiResult.type === 'diagnose' && (
                <div className="space-y-2">
                  {((aiResult.data?.differential_diagnosis as DifferentialDiagnosis[]) ?? []).map((dx: DifferentialDiagnosis, i: number) => (
                    <div key={i} className="text-xs">
                      <span className="font-bold text-gray-900">{i + 1}. {dx.diagnosis_ko ?? dx.diagnosis}</span>
                      <span className="text-indigo-600 ml-1">({dx.icd10})</span>
                      <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${dx.probability === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{dx.probability}</span>
                      {(dx.supporting?.length ?? 0) > 0 && <p className="text-gray-500 ml-4">근거: {dx.supporting!.join(', ')}</p>}
                    </div>
                  ))}
                </div>
              )}
              {aiResult.type === 'reference' && (
                <div className="text-xs text-gray-700 whitespace-pre-wrap">
                  {aiResult.data?.answer ?? '결과 없음'}
                  {(aiResult.data?.sources?.length ?? 0) > 0 && (
                    <p className="mt-2 text-indigo-500">참고: {aiResult.data.sources!.map((s) => s.title).join(', ')}</p>
                  )}
                </div>
              )}
              {aiResult.type === 'explain' && (
                <div className="text-xs text-gray-700">
                  <p className="whitespace-pre-wrap">{aiResult.data?.explanation ?? '결과 없음'}</p>
                  {(aiResult.data?.key_points?.length ?? 0) > 0 && (
                    <ul className="mt-2 list-disc list-inside text-indigo-600">{aiResult.data.key_points!.map((k: string, i: number) => <li key={i}>{k}</li>)}</ul>
                  )}
                </div>
              )}
              <p className="text-[11px] text-indigo-500 mt-2 pt-1 border-t border-indigo-200">{AI_ORIGIN_TEXT} 참고자료 — 의료행위에 해당하지 않습니다</p>
            </div>
          )}

          {([
            { key: 'subjective', label: 'S - 주관적 증상', placeholder: '환자가 호소하는 증상을 기록하세요...' },
            { key: 'objective', label: 'O - 객관적 소견', placeholder: '검사 결과, 활력징후 등 객관적 소견...' },
            { key: 'assessment', label: 'A - 평가/진단', placeholder: '진단명, 감별진단...' },
            { key: 'plan', label: 'P - 치료 계획', placeholder: '처방, 검사 계획, 경과 관찰 등...' },
          ] as const).map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                {label}
              </label>
              <textarea
                rows={key === 'subjective' || key === 'plan' ? 4 : 3}
                value={soap[key as keyof typeof soap]}
                onChange={(e) => setSoap({ ...soap, [key]: e.target.value })}
                placeholder={placeholder}
                disabled={!encounterId}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow resize-none disabled:bg-gray-50 disabled:text-gray-400 placeholder:text-gray-300"
              />
            </div>
          ))}

          {/* 구조화 진단(주상병) — SOAP 'A' 병행, 청구 상병코드 생성 */}
          <div className="p-3 border border-gray-100 rounded-xl bg-white">
            <DiagnosisInput
              value={diagnoses}
              onChange={setDiagnoses}
              patientSex={patient?.gender}
              patientAge={patient?.dateOfBirth ? (ageOf(patient.dateOfBirth) ?? undefined) : undefined}
            />
          </div>

          <button
            onClick={handleSaveSOAP}
            disabled={!encounterId || isSaving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
          >
            {isSaving ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
            )}
            <T k="SOAP 저장" />
          </button>
        </>)}
        </div>

        {/* Right: Prescriptions — 진료과 레이아웃과 같은 열을 쓴다(rxColumn) */}
        {rxColumn}

      </div>

      {/* WeRU.B 진료 보조 — 하단 전체폭 */}
      <div>
        <AiAssistantPanel
          patientId={patientId}
          soap={soap}
          encounterId={encounterId}
          onApplyOrderSet={openCpReview}
          onApplySoap={(assessment, plan, meta) => {
            // 의사가 이미 적은 A·P 를 말없이 덮지 않는다
            const overwrite = [soap.assessment.trim() && soap.assessment !== assessment && 'A', soap.plan.trim() && soap.plan !== plan && 'P'].filter(Boolean);
            if (overwrite.length && !confirm(`이미 작성한 ${overwrite.join('·')} 칸을 ${AI_ORIGIN_TEXT} 초안으로 바꿉니다. 계속할까요?`)) return false;
            setSoap(prev => ({ ...prev, assessment, plan }));
            markSoapDraftApplied('ASSISTANT', ['A', 'P'], (assessment?.length ?? 0) + (plan?.length ?? 0), {
              proposalId: meta?.proposalId ?? null,
              // 서버 `serializeSoapDraft` 와 같은 규칙(A\nP · 빈 칸은 뺀다)
              finalText: [assessment, plan].filter((s) => s && s.trim()).join('\n'),
            });
            // 서명 시 무수정 승인율 산출의 기준 텍스트(적용 시점의 초안 그대로)
            rememberAppliedDraft('ASSISTANT', assessment, plan);
          }}
          onApplyDiagnosis={(code, name) => {
            const entry = `[${code}] ${name}`;
            setSoap(prev => ({
              ...prev,
              assessment: prev.assessment ? `${prev.assessment}\n${entry}` : entry,
            }));
          }}
          onOrderDrug={(drugName, dosage, medicationCodeId) => {
            // 🔴 P16 봉합(2026-08-19) — 종전엔 패널이 `처방 추가` 성공 토스트를 띄우고 여기서는 "검색하세요" 안내만 했다.
            //    아무것도 추가되지 않는데 화면이 성공을 말했다. 이건 **프리필**이다 — 실제 처방 생성은 처방 폼이 한다
            //    (DUR·승인 토큰·step-up 은 처방 파이프 정본이 강제 — 우회 금지). VoiceHub `onOrderDraft` 와 같은 경로·같은 어휘.
            setActiveTab('MEDICATION');
            handleCodeQueryChange(drugName);
            const detail = [dosage, medicationCodeId ? '약가마스터 매칭' : null].filter(Boolean).join(' · ');
            toast.info(`"${drugName}"을(를) 처방 탭에 띄웠습니다${detail ? ` (${detail})` : ''} — 확인 후 확정하세요(DUR·승인 적용).`);
          }}
          onOrderTest={(testName) => {
            // 프리필만 — 검사 오더 생성은 검사 탭에서 코드를 골라 확정한다
            setActiveTab('LAB');
            handleCodeQueryChange(testName);
            toast.info(`"${testName}"을(를) 검사 탭에 띄웠습니다 — 확인 후 확정하세요(승인 적용).`);
          }}
        />
      </div>

      {/* Bottom Action Bar — 아래에 고정(긴 SOAP·처방 중에도 저장·서명이 보인다) */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4 space-y-3" data-encounter-actions>
        {/* 서명 전 기록품질 체크리스트 — 감시 모드 · 비차단(결과가 있을 때만 그린다) */}
        <PreSignQaChecklist state={preSignQa} onRun={() => runPreSignQa(soap)} canRun={hasSoapContent} />
        {amendingSigned && (
          <label className="block rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-amendment-reason>
            <span className="font-semibold"><T k="서명된 진료기록을 정정합니다 — 저장하면 직전 서명본이 보존되고 재서명이 필요합니다" /></span>
            <input value={amendmentReason} onChange={(e) => setAmendmentReason(e.target.value)} maxLength={500} placeholder={tA('정정 사유(선택)')}
              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-sm text-gray-800" data-amendment-reason-input />
          </label>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            SOAP {soap.subjective || soap.objective || soap.assessment || soap.plan ? '작성중' : '미작성'} / 처방 {prescriptions.length}건
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSaveDraft()}
              disabled={!encounterId || isSaving}
              className="inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              {isSaving && (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              <T k="저장 (임시)" />
            </button>
            <button
              type="button"
              onClick={() => runPreSignQa(soap)}
              disabled={!hasSoapContent || preSignQa.status === 'running'}
              title={`${AI_ORIGIN_TEXT} 기록품질 제안 — 서명을 막지 않습니다(감시 모드)`}
              className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2.5 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-xl hover:bg-indigo-100 transition-colors disabled:opacity-40"
            >
              {preSignQa.status === 'running' ? <T k="기록품질 확인 중…" /> : <T k="서명 전 기록품질 확인" />}
            </button>
            <SmartSignButton
              documentType="ENCOUNTER"
              documentId={encounterId}
              documentTitle="진료 기록"
              patientName={patient ? `${patient.familyName}${patient.givenName}` : undefined}
              patientId={patientId}
              onSign={handleSignAndBill}
              prepare={prepareBlockchainSign}
              onBlockchainSign={async (sig) => {
                // 여기서 서버를 부르지 않는다 — 저장·게이트를 지난 뒤 서명 요청에 함께 싣는다(handleSignAndBill)
                pendingBlockchainSigRef.current = sig as unknown as Record<string, unknown>;
              }}
              label={tA('서명 완료')}
              disabled={!canSign || isSigning}
            />
          </div>
        </div>

      </div>
      </>)}

      {/* Past Encounter History */}
      {pastEncList.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            과거 진료 기록 ({pastEncList.length}건)
          </h3>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {pastEncList.map((enc: EncounterWithRelations) => (
              <div key={enc.id} className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50/50 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {/* 상태 라벨·색은 shared 정본(UX 규약: 로컬 재정의 금지) */}
                    <StatusBadge status={enc.status as string} domain="encounter" className="!text-[10px] !px-2" />
                    <span className="text-xs text-gray-500">
                      {enc.createdAt ? format(new Date(enc.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {enc.doctor?.familyName}{enc.doctor?.givenName}
                  </span>
                </div>
                {(enc.diagnoses?.length ?? 0) > 0 && (
                  <div className="flex gap-1 flex-wrap mb-2">
                    {enc.diagnoses!.map((d: { id: string; diagnosisCode?: { code: string; nameKo: string; nameEn?: string | null } }) => (
                      <span key={d.id} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                        {d.diagnosisCode?.code} <Term nameKo={d.diagnosisCode?.nameKo} nameEn={d.diagnosisCode?.nameEn} />
                      </span>
                    ))}
                  </div>
                )}
                {enc.subjective && (
                  <p className="text-xs text-gray-600 mb-1">
                    <span className="font-medium text-gray-500">S:</span> {enc.subjective.length > 80 ? enc.subjective.slice(0, 80) + '...' : enc.subjective}
                  </p>
                )}
                {enc.assessment && (
                  <p className="text-xs text-gray-600 mb-1">
                    <span className="font-medium text-gray-500">A:</span> {enc.assessment.length > 80 ? enc.assessment.slice(0, 80) + '...' : enc.assessment}
                  </p>
                )}
                {enc.plan && (
                  <p className="text-xs text-gray-600">
                    <span className="font-medium text-gray-500">P:</span> {enc.plan.length > 80 ? enc.plan.slice(0, 80) + '...' : enc.plan}
                  </p>
                )}
                {(enc.prescriptions?.length ?? 0) > 0 && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-400">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5m14 0H5" /></svg>
                    처방 {enc.prescriptions!.length}건
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {durBlock && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setDurBlock(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-red-700 mb-1">⚠️ DUR 위험 경고 — 강제 처방</h3>
            <p className="text-xs text-gray-500 mb-3">{durBlock.codeName} · 아래 경고에도 처방하려면 사유를 입력하세요(약국·심사 추적).</p>
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 max-h-40 overflow-y-auto space-y-1">
              {durBlock.warnings.map((w, i) => (
                <p key={i} className="text-xs text-red-700">• {(w as { message?: string; type?: string }).message ?? (w as { type?: string }).type}</p>
              ))}
            </div>
            <label className="text-xs text-gray-500 mb-1 block">강제 처방 사유 <span className="text-red-400">*</span></label>
            <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="예: 임상적 필요·기존 병용 유지·대체 불가"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4" />
            <div className="flex gap-2">
              <button onClick={handleForcePrescribe} disabled={addPrescription.isPending || !overrideReason.trim()}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">{addPrescription.isPending ? '처리 중…' : '경고 무시하고 강제 처방'}</button>
              <button onClick={() => setDurBlock(null)} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </EncounterRefProvider>
    </ClinicalChartCaptureProvider>
  );
}

interface ConsultationRecord {
  id?: string;
  status?: string;
  urgency?: string;
  toDepartment?: string;
  reason?: string;
  createdAt?: string;
  replyContent?: string;
  recommendations?: string;
  replyDoctor?: { familyName?: string; givenName?: string };
}

function ConsultationSection({ encounterId }: { encounterId: string }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ toDepartment: '', toDoctorId: '', reason: '', clinicalQuestion: '', urgency: 'ROUTINE' });
  const [submitting, setSubmitting] = useState(false);

  const { data, refetch, isError, error } = useQuery({
    queryKey: ['consultations', encounterId],
    queryFn: () => apiClient.get<{ data: ConsultationRecord[] | { data: ConsultationRecord[] } }>(`/api/v1/consultations/encounter/${encounterId}`),
  });
  const consultations: ConsultationRecord[] = (() => { const raw = data?.data; return Array.isArray(raw) ? raw : ((raw as { data?: ConsultationRecord[] })?.data ?? []); })();

  // 수신 과 목록(활성 의사 보유 과 — 알림 대상 일치)
  const { data: deptData, isError: deptIsError, error: deptError, refetch: refetchDept } = useQuery({
    queryKey: ['consult-departments'],
    queryFn: () => apiClient.get<{ data: string[] }>('/api/v1/consultations/departments'),
  });
  const departments: string[] = (() => { const raw = deptData?.data; return Array.isArray(raw) ? raw : ((raw as unknown as { data?: string[] })?.data ?? []); })();
  // 지정의 후보
  const { data: docData, isError: docIsError, error: docError, refetch: refetchDoc } = useQuery({
    queryKey: ['consult-doctors', form.toDepartment],
    queryFn: () => apiClient.get<{ data: { id: string; familyName?: string; givenName?: string }[] }>(`/api/v1/consultations/doctors?department=${encodeURIComponent(form.toDepartment)}`),
    enabled: !!form.toDepartment,
  });
  const doctors: { id: string; familyName?: string; givenName?: string }[] = (() => { const raw = docData?.data; return Array.isArray(raw) ? raw : ((raw as unknown as { data?: { id: string; familyName?: string; givenName?: string }[] })?.data ?? []); })();

  const submit = async () => {
    if (!form.toDepartment || !form.reason) return;
    setSubmitting(true);
    try {
      await apiClient.post('/api/v1/consultations', {
        encounterId, toDepartment: form.toDepartment, toDoctorId: form.toDoctorId || undefined,
        reason: form.reason, clinicalQuestion: form.clinicalQuestion, urgency: form.urgency,
      });
      setShowForm(false);
      setForm({ toDepartment: '', toDoctorId: '', reason: '', clinicalQuestion: '', urgency: 'ROUTINE' });
      refetch();
      toast.success('협진 의뢰가 전송되었습니다.');
    } catch {
      toast.error('협진 의뢰에 실패했습니다.');
    }
    setSubmitting(false);
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
          <svg className="w-4 h-4 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
          타과 협진
        </h4>
        {!showForm && <button onClick={() => setShowForm(true)} className="text-xs px-3 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700">+ 의뢰</button>}
      </div>

      {showForm && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">의뢰 과</label>
              {/* 🔴 수신 과 목록 조회 실패를 "의뢰할 과 없음"으로 말하지 않는다 */}
              {deptIsError && <QueryErrorFallback error={deptError} onRetry={refetchDept} size="compact" className="mb-1" />}
              <select value={form.toDepartment} onChange={e => setForm(f => ({...f, toDepartment: e.target.value, toDoctorId: ''}))} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">선택</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">긴급도</label>
              <select value={form.urgency} onChange={e => setForm(f => ({...f, urgency: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="ROUTINE">일반</option><option value="URGENT">긴급</option><option value="EMERGENT">응급</option>
              </select>
            </div>
          </div>
          {form.toDepartment && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">지정의 <span className="text-gray-400">(미선택 시 과 전체)</span></label>
              {docIsError && <QueryErrorFallback error={docError} onRetry={refetchDoc} size="compact" className="mb-1" />}
              <select value={form.toDoctorId} onChange={e => setForm(f => ({...f, toDoctorId: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">과 단위 의뢰</option>
                {doctors.map(d => <option key={d.id} value={d.id}>{d.familyName ?? ''}{d.givenName ?? ''}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">의뢰 사유</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({...f, reason: e.target.value}))} rows={2} placeholder="의뢰 사유를 입력하세요..." className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">임상 질문 (선택)</label>
            <input value={form.clinicalQuestion} onChange={e => setForm(f => ({...f, clinicalQuestion: e.target.value}))} placeholder="구체적 질문..." className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={submit} disabled={submitting || !form.toDepartment || !form.reason} className="flex-1 py-2 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700 disabled:opacity-50">{submitting ? '전송 중...' : '의뢰서 전송'}</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-600 text-xs rounded-lg">취소</button>
          </div>
        </div>
      )}

      {/* 🔴 협진 이력 조회 실패를 "협진 없음"(목록 미렌더)으로 말하지 않는다 */}
      {isError && <QueryErrorFallback error={error} onRetry={refetch} size="compact" />}
      {!isError && consultations.length > 0 && (
        <div className="space-y-2">
          {consultations.map((c: ConsultationRecord) => (
            <div key={c.id} className={`rounded-xl border p-3 ${c.status === 'REPLIED' ? 'bg-emerald-50 border-emerald-200' : c.urgency === 'EMERGENT' ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${c.status === 'REPLIED' ? 'bg-emerald-100 text-emerald-700' : c.status === 'REQUESTED' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {c.status === 'REQUESTED' ? '의뢰' : c.status === 'REPLIED' ? '회신완료' : c.status === 'CLOSED' ? '종료' : c.status}
                  </span>
                  <span className="text-xs text-gray-700 font-medium">{c.toDepartment}</span>
                  {c.urgency !== 'ROUTINE' && <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${c.urgency === 'EMERGENT' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{c.urgency === 'EMERGENT' ? '응급' : '긴급'}</span>}
                </div>
                <span className="text-[10px] text-gray-400">{c.createdAt ? kdate(c.createdAt) : ''}</span>
              </div>
              <p className="text-xs text-gray-600">{c.reason}</p>
              {c.replyContent && (
                <div className="mt-2 pt-2 border-t border-emerald-200">
                  <p className="text-[10px] text-emerald-600 font-medium mb-0.5">회신 ({c.replyDoctor?.familyName}{c.replyDoctor?.givenName})</p>
                  <p className="text-xs text-gray-700">{c.replyContent}</p>
                  {c.recommendations && <p className="text-xs text-blue-600 mt-1">권고: {c.recommendations}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────
   AI(WeRU.B) DUR 정밀점검(참조) — 식약처 DUR 미러 기반
   로컬 DUR 패널(룰 23종·IPSG.3)과 별개의 참조 정보.
   명칭 배열만 해석됨(EDI 코드 미해석 — 운영 실측 기지).
──────────────────────────────────────────────── */
interface WerubDurItem {
  dur_type?: string;
  ingr_name?: string;
  criteria?: string;
  content?: string;
}

interface WerubDurResult {
  contraindications?: WerubDurItem[];
  pregnancy_warnings?: WerubDurItem[];
  age_warnings?: WerubDurItem[];
  elderly_warnings?: WerubDurItem[];
  advisories?: WerubDurItem[];
  split_cautions?: WerubDurItem[];
  duplicate_therapy?: Array<{ sers_name?: string; ingredients?: WerubDurItem[] }>;
  has_contraindication?: boolean;
  has_warning?: boolean;
  disclaimer?: string;
  resolved?: Array<{ input?: { name?: string }; resolved?: boolean }>;
}

function WerubDurCheckPanel({ drugs, age }: { drugs: string[]; age?: number }) {
  const [durState, setDurState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [durResult, setDurResult] = useState<WerubDurResult | null>(null);

  const runCheck = async () => {
    setDurState('loading');
    try {
      const res = await apiClient.post<{ data: WerubDurResult }>('/api/v1/ai/dur/check', {
        drugs,
        ...(age != null ? { age } : {}),
      });
      const d = ((res as { data?: WerubDurResult & { data?: WerubDurResult } })?.data?.data
        ?? (res as { data?: WerubDurResult })?.data) as WerubDurResult | undefined;
      if (!d || typeof d !== 'object') throw new Error('empty');
      setDurResult(d);
      setDurState('done');
    } catch {
      setDurState('error');
    }
  };

  // 유형명 원문 배지 — 금기류는 red, 주의류는 amber (경고 강도 희석 금지)
  const typeBadgeCls = (durType?: string) =>
    (durType ?? '').includes('금기')
      ? 'bg-red-100 text-red-700 border-red-200'
      : 'bg-amber-100 text-amber-800 border-amber-200';

  const flatItems: WerubDurItem[] = durResult
    ? [
        ...(durResult.contraindications ?? []),
        ...(durResult.pregnancy_warnings ?? []),
        ...(durResult.age_warnings ?? []),
        ...(durResult.elderly_warnings ?? []),
        ...(durResult.advisories ?? []),
        ...(durResult.split_cautions ?? []),
      ]
    : [];
  const dupGroups = durResult?.duplicate_therapy ?? [];
  const unresolvedNames = (durResult?.resolved ?? [])
    .filter((r) => r.resolved === false)
    .map((r) => r.input?.name)
    .filter(Boolean);
  const hasFindings = flatItems.length > 0 || dupGroups.length > 0;

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-semibold text-indigo-900">{AI_ORIGIN_TEXT} 정밀점검(참조)</p>
          <span className="text-[10px] text-gray-400 truncate">식약처 DUR 미러 · 대상 {drugs.length}<Unit>종</Unit></span>
        </div>
        <button onClick={runCheck} disabled={durState === 'loading'}
          className="shrink-0 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          {durState === 'loading' ? '점검 중...' : durState === 'done' ? '다시 점검' : '정밀점검 실행'}
        </button>
      </div>

      {durState === 'error' && (
        <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          <p className="text-xs text-gray-500">점검 불가 — {AI_ORIGIN_TEXT} 서비스에 연결하지 못했습니다. 로컬 DUR 점검 결과를 우선 확인하세요.</p>
        </div>
      )}

      {durState === 'done' && durResult && (
        <div className="mt-2 space-y-1.5">
          {/* 🔴 약 이름을 하나도 해석하지 못했으면 '주의 항목 없음'이 아니라 '점검 불가'다 */}
          {!hasFindings && (durResult.resolved?.length ?? 0) > 0 && (durResult.resolved ?? []).every((r) => r.resolved === false) ? (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
              <T k="점검 불가 — 약 이름을 DUR 목록과 맞추지 못했습니다(0건 해석). 로컬 DUR 점검 결과를 확인하세요." />
            </p>
          ) : !hasFindings && (
            <p className="text-xs text-gray-500 bg-white/70 rounded-lg px-3 py-2 border border-gray-100">
              등록된 DUR 주의 항목이 없습니다{durResult.resolved?.length ? ` (명칭 해석 ${(durResult.resolved ?? []).filter((r) => r.resolved).length}/${durResult.resolved.length})` : ''}.
            </p>
          )}
          {flatItems.map((it, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${typeBadgeCls(it.dur_type)}`}>
              <span className="text-[10px] font-bold whitespace-nowrap mt-0.5 px-1.5 py-0.5 rounded bg-white/70 border border-black/10">
                {it.dur_type ?? 'DUR'}
              </span>
              <div className="min-w-0 text-xs">
                <span className="font-semibold">{it.ingr_name ?? '-'}</span>
                {it.criteria && <span className="ml-1.5">{it.criteria}</span>}
                {it.content && <span className="ml-1.5 opacity-80">{it.content}</span>}
              </div>
            </div>
          ))}
          {dupGroups.map((g, i) => (
            <div key={`dup-${i}`} className="rounded-lg border border-amber-200 bg-amber-100 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold whitespace-nowrap px-1.5 py-0.5 rounded bg-white/70 text-amber-800 border border-amber-200">효능군중복</span>
                <span className="text-xs font-semibold text-amber-900">{g.sers_name ?? '-'}</span>
              </div>
              {(g.ingredients ?? []).length > 0 && (
                <p className="text-xs text-amber-800 mt-1 ml-1">
                  {(g.ingredients ?? []).map((ing) => ing.ingr_name).filter(Boolean).join(' + ')}
                </p>
              )}
            </div>
          ))}
          {unresolvedNames.length > 0 && (
            <p className="text-[10px] text-gray-400">명칭 미해석(점검 제외): {unresolvedNames.join(', ')}</p>
          )}
          <p className="text-[10px] text-gray-400 pt-0.5">
            {durResult.disclaimer ?? `${AI_ORIGIN_TEXT}가 생성한 참고 정보입니다 — 최종 판단은 의료진에게 있습니다.`}
          </p>
        </div>
      )}
    </div>
  );
}
