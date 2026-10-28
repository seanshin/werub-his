'use client';

import { useState, useMemo, useEffect } from 'react';
import NursingAiDraftPanel from '@/components/ai/NursingAiDraftPanel';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import {
  MedDoubleCheckPanel, DoubleCheckBypassBadge, doubleCheckScopeOf, doubleCheckReady,
  doubleCheckPayload, EMPTY_DOUBLE_CHECK, type DoubleCheckValue,
} from '@/components/nursing/MedDoubleCheck';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useHotkeys, comboLabel, ariaKeyshortcuts } from '@/components/hotkeys/HotkeyProvider';
import { pollMs, kdate } from '@/lib/ui-settings';
import { EmptyState, Unit, StaffName, KDate } from '@/components/ui/display';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { useShiftBoundaries, shiftOf, useLateEntryGrace } from '@/lib/shift';
import { kstToday } from '@/lib/kst-today';
import { isLateNursingEntry, nursingNoteSections, HANDOFF_ACK_MODE_LABEL, type HandoffKind, type NursingNoteBody } from '@hospital-run/shared';

/** 입원 간호기록 한 줄 요약 — 형식대로(SOAP·DAR·SBAR…) · 🔴 종전엔 입원 기록에 없는 `situation` 을 읽어 DAR·SOAP 가 전부 '-' 였다 */
const noteLine = (n: unknown) => nursingNoteSections(n as NursingNoteBody).map((x) => (x.label ? `${x.label}: ${x.text}` : x.text)).join(' · ') || '본문 없음';
import StatusBadge from '@/components/ui/StatusBadge';
import { VitalsRuleNote } from '@/components/vitals/VitalsRuleNote';
import { VitalSignsStrip, VitalSignsGrid, VitalHeaderCells, VitalRowCells } from '@/components/vitals/VitalSigns';
import { ACVPU_LABEL, ACVPU_VALUES, NEWS2_RISK_LABEL } from '@hospital-run/shared';
import { buildVsBatchBody, vsBatchHasValue, vsBatchNews2Preview } from '@/lib/vs-batch-form';
import { useNursingRules, unwrapData } from '@/lib/nursing-rules';
import { PainReassessTab } from './pain-reassess';

const vitalsSchema = z.object({
  bodyTemperature: z.string().optional(),
  systolicBp: z.string().optional(),
  diastolicBp: z.string().optional(),
  heartRate: z.string().optional(),
  respiratoryRate: z.string().optional(),
  spO2: z.string().optional(),
  painScore: z.string().optional(),
  note: z.string().optional(),
  // NEWS2 요소(2026-10-10) — 관측했을 때만(빈 값 = 미관측)
  consciousness: z.string().optional(),
  supplementalO2: z.string().optional(),
  measuredAtLocal: z.string().optional(),
});
type VitalsForm = z.infer<typeof vitalsSchema>;

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface Patient {
  id: string;
  familyName?: string;
  givenName?: string;
  mrn?: string;
  gender?: string;
  dateOfBirth?: string;
}

interface DiagnosisCode {
  code: string;
  nameKo?: string;
  nameEn?: string;
}

interface Admission {
  id: string;
  patientId: string;
  patient?: Patient;
  bed?: { id: string; roomNumber: string; bedLabel: string; ward?: { id: string; name: string } };
  admitDate?: string;
  admitReason?: string;
  attendingDoctor?: { id: string; familyName?: string; givenName?: string; department?: string };
  status?: string;
  // 🔴 `fallRiskScore` 는 **미평가면 `null`** 이다(서버가 0 으로 접지 않는다 — 0 은 Morse 최저위험).
  // 🔴 `pressureUlcerRisk` 는 Braden 미평가면 `null`(종전 서버는 'LOW' — 미평가를 저위험으로 말했다)
  nursingAssessment?: { fallRiskLevel?: string; fallRiskScore?: number | null; fallRiskAssessedAt?: string | null; pressureUlcerRisk?: string | null; bradenScore?: number | null } | null;
  primaryDiagnosis?: DiagnosisCode | null;
  lastVitalsAt?: string | null;
  lastNursingNoteAt?: string | null;
  /** 오늘 간호일 예정(SCHEDULED) — 서버가 보드와 같은 정의로 센다 */
  pendingMedCount?: number;
  /** 지난 날짜(최근 7일·이번 입원)에서 넘어온 미처리 — 종전엔 어디에도 안 보였다 */
  carriedOverMedCount?: number;
  /** 입원 일차 — 서버 정본 stayDays(입원 당일 = 1일차) */
  stayDays?: number;
}

interface WardOption {
  id: string;
  name: string;
}

/**
 * `/api/v1/beds/list` 원형(Prisma Bed + ward{name}).
 * 🔴 (2026-09-30) 종전 타입은 서버에 없는 `bedLabel`·`admission` 을 읽어 병상 번호가 늘 비고,
 *    환자 매칭은 화면 목록(내 담당만 켜면 남의 환자가 빠진다)에만 기대 **점유 병상을 "빈 병상"으로** 그렸다.
 */
interface BedInfo {
  id: string;
  wardId?: string;
  roomNumber: string;
  bedNumber: string;
  status: string;
  ward?: { name: string };
}

/**
 * 🔴 P11(FE↔서버 계약 불일치) — 종전 타입은 `scheduledTime`·`medicationName`·`dosage` 를 읽었으나
 *    `/api/v1/admissions/:id/medication-schedule` 은 Prisma 원형(`scheduledAt`·`dose`·
 *    `prescription.medicationCode.nameKo`)을 그대로 준다. 세 필드 모두 **항상 undefined** 였고
 *    화면은 모든 투약을 '약물'·'-'·시간 공란으로 표시했다. 상태 어휘도 `COMPLETED` 를 봤으나
 *    실제 enum 은 `ADMINISTERED` 라 "투약 0/N" 이 영구 0이었다.
 */
interface MedScheduleItem {
  id: string;
  scheduledAt: string;
  status: string;
  dose?: string;
  route?: string;
  notes?: string | null;
  prescription?: {
    route?: string | null;
    /** 처방 상태 — 중단(DISCONTINUED)·취소된 처방의 예정분은 투여하지 않는다(서버도 막는다) */
    status?: string | null;
    medicationCode?: { nameKo?: string; highAlertFlag?: boolean; highAlertCategory?: string | null };
  };
  /** 지난 날짜에서 넘어온 미처리(서버 `includeOverdue`) — "오늘 예정"과 섞어 말하지 않는다 */
  carriedOver?: boolean;
  /** 클라이언트가 덧붙이는 값(서버 응답 아님) */
  patientName?: string;
  admissionId?: string;
}

/** 약품명 — 없으면 `null`(모르는 것을 '약물'로 말하지 않는다) */
const medName = (m: MedScheduleItem): string | null => m.prescription?.medicationCode?.nameKo ?? null;
/** 투약 완료 상태 정본(enum = ADMINISTERED). COMPLETED 는 다른 도메인 어휘다. */
const isMedDone = (s: string) => s === 'ADMINISTERED' || s === 'COMPLETED';

/**
 * 🔴 서버 `IntakeOutput` 원장의 실제 컬럼(시드 흐름 검토 9단계·2026-08-24).
 *    종전에는 `{type, category, amount}` 라는 **서버에 없는 이름**을 적어 두어
 *    읽기는 `섭취 0 mL · 배설 NaN mL · 균형 NaN`(초록 배지)로, 쓰기는 전역 `whitelist:true` 에
 *    세 필드가 통째로 지워져 **금액 없는 빈 행**이 저장되는 상태였다(운영 원장 0행 = 아직 눌린 적 없음).
 *    한 행이 섭취·배출을 함께 담을 수 있다.
 */
interface IORecord {
  id: string;
  recordedAt: string;
  intakeType?: string | null;
  intakeAmount?: number | null;
  intakeDetail?: string | null;
  outputType?: string | null;
  outputAmount?: number | null;
  outputDetail?: string | null;
  patientName?: string;
  admissionId?: string;
}
/** I/O 유형 정본 — Prisma `IntakeType`/`OutputType` enum 그대로다(없는 값을 지어내지 않는다). */
const IO_INTAKE_TYPES: { v: string; label: string }[] = [
  { v: 'ORAL', label: '경구' }, { v: 'IV', label: '정맥(IV)' }, { v: 'OTHER', label: '기타' },
];
const IO_OUTPUT_TYPES: { v: string; label: string }[] = [
  { v: 'URINE', label: '소변' }, { v: 'DRAIN', label: '배액' }, { v: 'EMESIS', label: '구토' }, { v: 'OTHER', label: '기타' },
];

interface NursingNote {
  id: string;
  createdAt: string;
  noteType?: string;
  content?: string;
  situation?: string;
  background?: string;
  assessment?: string;
  recommendation?: string;
  patientName?: string;
  nurseName?: string;
  patientId?: string;
}

/** 정본 간호기록(admission 기반 NursingNote) — 워크스테이션 기록 탭 v2 */
interface WardNursingNote {
  id: string;
  noteType?: string;
  focus?: string; data?: string; action?: string; response?: string;
  subjective?: string; objective?: string; assessment?: string; plan?: string;
  content?: string;
  shiftType?: string;
  priority?: string;
  status?: string;
  recordedAt?: string;
  createdAt: string;
  /** 서버 파생 — 기록 시각이 속한 근무조가 끝난 뒤에 작성됨(막지 않고 표식만) */
  lateEntry?: boolean;
  nurse?: { familyName?: string; givenName?: string };
}

/**
 * `/api/v1/nurse-station/vitals/patient/:id` 원형(PreVisitVitals + nurseName + flags).
 * 🔴 (2026-10-01) 종전 타입은 서버에 없는 `bodyTemperature`·`spO2`·`recordedAt` 을 읽어 **체온·SpO2 가 늘 '-'** 였고
 *    시각은 측정 시각(`measuredAt`)이 아니라 저장 시각으로 그려졌다(P11). 이상 표시는 서버 정본 임계 판정(`flags`)이다.
 */
type VitalFlag = 'CRITICAL' | 'WARNING' | 'NORMAL' | null;
type VitalFlagKey = 'systolicBp' | 'diastolicBp' | 'heartRate' | 'temperature' | 'spo2' | 'respiratoryRate' | 'painScore';
interface VitalsRecord {
  id: string;
  measuredAt?: string;
  createdAt?: string;
  temperature?: number | null;
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  respiratoryRate?: number | null;
  spo2?: number | null;
  painScore?: number | null;
  patientName?: string;
  nurseName?: string;
  flags?: Partial<Record<VitalFlagKey, VitalFlag>>;
}
/** 서버가 밝히는 적용 임계의 출처 */
interface VitalsRule { source: 'CONFIGURED' | 'DEFAULT'; droppedKeys?: string[]; invertedKeys?: string[] }

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'patients', label: '내 환자' },
  { key: 'mar', label: '투약 관리' },
  { key: 'vitals', label: '활력징후' },
  { key: 'io', label: 'I/O 기록' },
  { key: 'pain', label: '통증 재평가' },
  { key: 'notes', label: '간호 기록' },
  { key: 'handoff', label: '인계(상·하번)' },
  { key: 'closeout', label: '근무조 마감' },
  { key: 'ward', label: '병동 보드' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const MAR_FILTER_OPTIONS = ['전체', '예정', '미투약', '보류·거부', '완료'] as const;

const RISK_DOT: Record<string, string> = {
  HIGH: 'bg-rose-500',
  MODERATE: 'bg-amber-400',
  LOW: 'bg-emerald-500',
  // 🔴 2026-08-20: `NONE` 은 종전에 LOW 와 **같은 초록**이었다. 그런데 `riskLevel()` 은
  //    `fallRiskLevel ?? 'NONE'` 으로 접으므로 NONE 은 "위험 없음"이 아니라
  //    **간호 초기평가가 없어 등급을 모른다**는 뜻이다. 모르는 것을 안전한 색으로 칠하면
  //    화면이 실제보다 **더 안전하게** 말한다 — 회색(모름)으로 바꾼다.
  NONE: 'bg-gray-300',
};

/* 🔴 색만으로 낙상 위험도를 말하지 않는다(§4.6). 의미는 색이 아니라 riskLevel()이 읽는
   `nursingAssessment.fallRiskLevel` 에서 가져온다.
   🔴 `NONE` 은 "위험 없음"이 아니라 **간호 초기평가가 없어서 등급을 모른다**는 뜻이다
   (riskLevel 이 `?? 'NONE'` 으로 접는다). 그래서 문구는 '저위험'과 구분한다 —
   색은 LOW 와 같은 초록이라 색만 보면 구분되지 않는다. */
const RISK_WORD: Record<string, string> = {
  HIGH: '낙상 고위험',
  MODERATE: '낙상 중등도 위험',
  LOW: '낙상 저위험',
  NONE: '낙상 위험도 미평가',
};
const riskWord = (r: string) => RISK_WORD[r] ?? `낙상 위험도 ${r}`;

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function fmtTime(d?: string) {
  if (!d) return '-';
  return kdate(d, 'time');
}

function fmtDate(d?: string) {
  if (!d) return '-';
  return kdate(d, 'monthDay');
}

/**
 * '늦은 기록' 판정 기준 — 유예는 원내 기록 규정(config `nursing.lateEntry.graceMinutes`).
 * 미설정을 "유예 0분이 규정"인 것처럼 말하지 않는다 · 조회 실패·로딩은 미설정과 다른 사실이다.
 */
function LateEntryRuleNote({ grace }: { grace: { graceMinutes: number | null; state: 'loading' | 'error' | 'ready' } }) {
  if (grace.state === 'loading') return null;
  return (
    <span className="text-[10px] text-gray-500">
      {grace.state === 'error'
        ? <T k="늦은 기록 기준을 불러오지 못했습니다 — 유예 없이 판정합니다" />
        : grace.graceMinutes == null
          ? <T k="늦은 기록 기준: 근무조 종료 시각(유예 규정 미설정)" />
          : <Tf k="늦은 기록 기준: 근무조 종료 후 {분}분(원내 규정)" params={{ 분: grace.graceMinutes }} />}
    </span>
  );
}

/** 병원 표준시(KST) 날짜 키 — 시계열 그룹용(UTC `slice(0,10)` 금지) */
function kstDateKey(d: string) {
  return new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function fmtDateTime(d?: string) {
  if (!d) return '-';
  return kdate(d, 'datetimeShort');
}

/**
 * 입원 일차 — 서버 정본(`stayDays` · 입원 당일 = 1일차)을 그대로 쓴다.
 * 🔴 종전 `daysSince` 는 경과 일수(floor)라 입원 당일을 "0일차"로, 병동 보드와 하루 다르게 말했다. 서버 값이 없으면 모른다고 한다.
 */
function stayDayOf(a?: Admission): number | null {
  return typeof a?.stayDays === 'number' ? a.stayDays : null;
}

/** 투여 버튼을 보일 수 있는가 — 예정이고, 처방이 살아 있을 때만 */
const canAdminister = (m: MedScheduleItem) =>
  (m.status === 'SCHEDULED' || m.status === 'PENDING') && (m.prescription?.status == null || m.prescription.status === 'ACTIVE');

function timeAgo(d?: string) {
  if (!d) return '-';
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  return `${Math.floor(hrs / 24)}일 전`;
}

function patientName(p?: Patient | null) {
  if (!p) return '(미상)';
  return `${p.familyName ?? ''}${p.givenName ?? ''}`.trim() || '(미상)';
}

function riskLevel(a?: Admission): string {
  return a?.nursingAssessment?.fallRiskLevel ?? 'NONE';
}

/**
 * 활력 이상 표시 — 2026-10-07 부품 정본(`components/vitals/VitalSigns`)으로 이관.
 * 부품은 서버 병합 임계(`/api/v1/vitals-thresholds` — 응답 `flags` 와 같은 기준)로 칠한다 · 화면이 기준 숫자를 적지 않는다.
 * 🔴 (2026-10-01) 종전 `isAbnormalVital` 은 화면에 임계 숫자를 따로 적은 4번째 정본이었다.
 */
const vitalAt = (v: VitalsRecord) => v.measuredAt ?? v.createdAt;

/** 서버 meta.vitalsRule → 공용 기준 표시 부품 입력 */
const ruleOf = (r?: VitalsRule | null) => (r ? { source: r.source, droppedKeys: r.droppedKeys ?? [], invertedKeys: r.invertedKeys ?? [], state: 'ready' as const } : null);

/* ═══════════════════════════════════════════════════════════════
   Shared UI
   ═══════════════════════════════════════════════════════════════ */

function StatCard({ label, value, color }: { label: React.ReactNode; value: string | number; color: string }) {
  const cls: Record<string, string> = {
    blue: 'text-blue-700', green: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex-1 min-w-[140px]">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${cls[color] ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 1: 내 환자 (My Patients)
   ═══════════════════════════════════════════════════════════════ */

function MyPatientsTab({ admissions, myAdmissionIds }: { admissions: Admission[]; myAdmissionIds?: Set<string> }) {
  const tAttr = useTAttr();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'all' | 'vs' | 'med' | 'io' | 'note'>('all');

  const sorted = useMemo(
    () => [...admissions].sort((a, b) => (a.bed?.roomNumber ?? '').localeCompare(b.bed?.roomNumber ?? '')),
    [admissions],
  );
  const selected = sorted.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex gap-6 items-start">
      {/* Left: Patient list */}
      <div className="w-[55%] flex-shrink-0">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-700"><T k="입원 환자 목록" /></p>
          </div>
          {sorted.length === 0 ? (
            <EmptyState icon="🛏️" title="입원 환자가 없습니다." />
          ) : (
            <div className="divide-y divide-gray-50">
              {sorted.map((adm) => {
                const risk = riskLevel(adm);
                const isActive = adm.id === selectedId;
                return (
                  <div
                    key={adm.id}
                    onClick={() => setSelectedId(adm.id)}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${isActive ? 'bg-blue-50 border-l-2 border-l-blue-600' : 'hover:bg-gray-50'}`}
                  >
                    <span aria-label={riskWord(risk)} title={riskWord(risk)}
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${RISK_DOT[risk] ?? 'bg-gray-300'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 text-sm">{patientName(adm.patient)}</span>
                        <span className="text-gray-400 text-xs">({adm.patient?.mrn ?? '-'})</span>
                        {myAdmissionIds?.has(adm.id) && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap"><T k="내 담당" /></span>}
                        {adm.attendingDoctor && (
                          <span className="text-gray-400 text-xs">· {adm.attendingDoctor.familyName ?? ''}{adm.attendingDoctor.givenName ?? ''}</span>
                        )}
                      </div>
                      {/* Row 2: 병실 + 입원일차 + 진단 */}
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                        <span>{adm.bed?.roomNumber ?? '-'}호 {adm.bed?.bedLabel ?? ''}</span>
                        {stayDayOf(adm) != null ? <span><Tf k="입원 {일차}일차" params={{ 일차: stayDayOf(adm)! }} /></span> : <span><T k="입원 일차 미상" /></span>}
                        {adm.primaryDiagnosis && (
                          <span className="whitespace-nowrap text-gray-500 truncate max-w-[180px]" title={`${adm.primaryDiagnosis.code} ${adm.primaryDiagnosis.nameKo ?? adm.primaryDiagnosis.nameEn ?? ''}`}>
                            {adm.primaryDiagnosis.code} {adm.primaryDiagnosis.nameKo ?? adm.primaryDiagnosis.nameEn ?? ''}
                          </span>
                        )}
                      </div>
                      {/* Row 3: 위험도 배지 + 상태 요약 */}
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {risk === 'HIGH' && <span className="whitespace-nowrap text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium">낙상 HIGH</span>}
                        {risk === 'MODERATE' && <span className="whitespace-nowrap text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">낙상 MOD</span>}
                        {adm.nursingAssessment?.pressureUlcerRisk === 'HIGH' && <span className="whitespace-nowrap text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium">욕창 HIGH</span>}
                        {adm.nursingAssessment?.pressureUlcerRisk === 'MODERATE' && <span className="whitespace-nowrap text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">욕창 MOD</span>}
                        {(adm.pendingMedCount ?? 0) > 0 && <span className="whitespace-nowrap text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium"><Tf k="오늘 투약 {건수}건" params={{ 건수: adm.pendingMedCount! }} /></span>}
                        {!!adm.carriedOverMedCount && <span className="whitespace-nowrap text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium" title={tAttr('지난 날짜에 예정됐는데 기록되지 않은 투약 — 투여·보류·누락 중 하나로 기록하세요')}><Tf k="지난 미기록 {건수}건" params={{ 건수: adm.carriedOverMedCount! }} /></span>}
                        {adm.lastVitalsAt && <span className="whitespace-nowrap text-[10px] text-gray-400">VS {timeAgo(adm.lastVitalsAt)}</span>}
                        {adm.lastNursingNoteAt && <span className="whitespace-nowrap text-[10px] text-gray-400">기록 {timeAgo(adm.lastNursingNoteAt)}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: Quick view */}
      <div className="w-[45%] flex-shrink-0">
        {selected ? (
          <SelectedPatientPanel admission={selected} subTab={subTab} setSubTab={setSubTab} />
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <p className="text-sm text-gray-400"><T k="좌측 목록에서 환자를 선택하세요." /></p>
          </div>
        )}
      </div>
    </div>
  );
}

function SelectedPatientPanel({
  admission,
  subTab,
  setSubTab,
}: {
  admission: Admission;
  subTab: 'all' | 'vs' | 'med' | 'io' | 'note';
  setSubTab: (t: 'all' | 'vs' | 'med' | 'io' | 'note') => void;
}) {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const shiftBoundaries = useShiftBoundaries();

  const { data: assignData, isError: assignIsError, error: assignError, refetch: refetchAssign } = useQuery({
    queryKey: ['nurse-assignment-adm', admission.id],
    queryFn: () => apiClient.get<{ data: { id: string; nurseId: string; nurse?: { familyName?: string; givenName?: string }; shiftType?: string }[] }>(`/api/v1/nurse-station/assignments/admission/${admission.id}`),
  });
  const assignments = assignData?.data ?? [];
  const myAssignment = assignments.find(a => a.nurseId === user?.id);

  const assignMut = useMutation({
    // 🔴 (2026-09-30) 근무조를 보내지 않아 서버 기본 DAY 로 저장됐다(야간 배정도 DAY) — 교대 경계 설정으로 판정해 보낸다
    mutationFn: () => apiClient.post('/api/v1/nurse-station/assignments', { nurseId: user?.id, admissionId: admission.id, shiftType: shiftOf(new Date(), shiftBoundaries) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nurse-assignment-adm'] }); qc.invalidateQueries({ queryKey: ['nurse-assignments-my'] }); toast.success(tAttr('담당 배정 완료')); },
    onError: () => toast.error(tAttr('배정 실패')),
  });

  const releaseMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/nurse-station/assignments/${id}/release`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nurse-assignment-adm'] }); qc.invalidateQueries({ queryKey: ['nurse-assignments-my'] }); toast.success(tAttr('배정 해제')); },
    onError: () => toast.error(tAttr('해제 실패')),
  });
  const subTabs = [
    { key: 'all' as const, label: '통합' },
    { key: 'vs' as const, label: 'VS' },
    { key: 'med' as const, label: '투약@탭' },
    { key: 'io' as const, label: 'I/O' },
    { key: 'note' as const, label: '기록@탭' },
  ];

  const { data: vitalsData, isError: vitalsIsError, error: vitalsError, refetch: refetchVitals } = useQuery({
    queryKey: ['nurse-vitals-patient', admission.patientId],
    queryFn: () =>
      apiClient.get<{ data: VitalsRecord[]; meta?: { vitalsRule?: VitalsRule } }>(`/api/v1/nurse-station/vitals/patient/${admission.patientId}`),
    // 🔴 '통합' 탭도 이 값을 그린다 — 종전엔 `enabled: subTab === 'vs'` 라서
    //    통합 탭에서 **한 번도 조회하지 않은 채** "없음"을 표시했다(P1: 모르는 것을 0으로 말함).
    enabled: subTab === 'vs' || subTab === 'all',
  });

  const { data: medData, isError: medIsError, error: medError, refetch: refetchMed } = useQuery({
    queryKey: ['nurse-med-schedule', admission.id],
    queryFn: () =>
      // 🔴 (2026-09-30) 종전엔 날짜 없이 **입원 전 기간**을 오래된 순으로 받아 앞 6건(첫날 투약)만 보였다 → 오늘 + 지난 미처리
      apiClient.get<{ data: MedScheduleItem[] }>(`/api/v1/admissions/${admission.id}/medication-schedule?date=${kstToday()}&includeOverdue=true`),
    // 🔴 '통합' 탭도 이 값을 그린다 — 종전엔 `enabled: subTab === 'med'` 라서
    //    통합 탭에서 **한 번도 조회하지 않은 채** "없음"을 표시했다(P1: 모르는 것을 0으로 말함).
    enabled: subTab === 'med' || subTab === 'all',
  });

  const { data: ioData, isError: ioIsError, error: ioError, refetch: refetchIo } = useQuery({
    queryKey: ['nurse-io', admission.id],
    queryFn: () =>
      apiClient.get<{ data: IORecord[] }>(`/api/v1/admissions/${admission.id}/intake-outputs`),
    // 🔴 '통합' 탭도 이 값을 그린다 — 종전엔 `enabled: subTab === 'io'` 라서
    //    통합 탭에서 **한 번도 조회하지 않은 채** "없음"을 표시했다(P1: 모르는 것을 0으로 말함).
    enabled: subTab === 'io' || subTab === 'all',
  });

  const { data: noteData, isError: noteIsError, error: noteError, refetch: refetchNote } = useQuery({
    queryKey: ['nurse-notes-adm', admission.id],
    queryFn: () =>
      apiClient.get<{ data: NursingNote[] }>(`/api/v1/admissions/${admission.id}/nursing-notes`),
    // 🔴 '통합' 탭도 이 값을 그린다 — 종전엔 `enabled: subTab === 'note'` 라서
    //    통합 탭에서 **한 번도 조회하지 않은 채** "없음"을 표시했다(P1: 모르는 것을 0으로 말함).
    enabled: subTab === 'note' || subTab === 'all',
  });

  const latestVitals = (vitalsData?.data ?? [])[0];
  const meds = medData?.data ?? [];
  const ios = ioData?.data ?? [];
  const notes = noteData?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Patient header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <p className="text-lg font-bold text-gray-900">{patientName(admission.patient)}</p>
            <span className="text-xs text-gray-400">{admission.patient?.mrn ?? '-'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {riskLevel(admission) !== 'NONE' && riskLevel(admission) !== 'LOW' && (
              <span className={`whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded-full font-medium ${riskLevel(admission) === 'HIGH' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                낙상 {riskLevel(admission)}
              </span>
            )}
            {admission.nursingAssessment?.pressureUlcerRisk === 'HIGH' && (
              <span className="whitespace-nowrap text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium">욕창 HIGH</span>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-500">
          {admission.bed?.roomNumber ?? '-'}호 {admission.bed?.bedLabel ?? ''} | {stayDayOf(admission) != null ? <Tf k="입원 {일차}일차" params={{ 일차: stayDayOf(admission)! }} /> : <T k="입원 일차 미상" />} | 담당: {admission.attendingDoctor ? `${admission.attendingDoctor.familyName ?? ''}${admission.attendingDoctor.givenName ?? ''}` : '-'}
        </p>
        {/* 담당 간호사 배정 */}
        <div className="flex items-center gap-2 mt-2">
          {assignIsError && (
            <QueryErrorFallback error={assignError} onRetry={refetchAssign} size="compact" className="w-full" />
          )}
          {!assignIsError && assignments.length > 0 && (
            <div className="flex items-center gap-1">
              {assignments.map(a => (
                <span key={a.id} className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${a.nurseId === user?.id ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-gray-100 text-gray-600'}`}>
                  {a.nurse?.familyName}{a.nurse?.givenName}
                </span>
              ))}
            </div>
          )}
          {!assignIsError && (myAssignment ? (
            <button onClick={() => releaseMut.mutate(myAssignment.id)} className="min-h-[44px] px-3 py-2 text-xs font-medium text-red-500 hover:text-red-700 whitespace-nowrap"><T k="배정 해제" /></button>
          ) : (
            <button onClick={() => assignMut.mutate()} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-full hover:bg-blue-700 whitespace-nowrap"><T k="내가 담당" /></button>
          ))}
        </div>
        {admission.primaryDiagnosis && (
          <p className="text-xs text-blue-600 mt-1">
            {admission.primaryDiagnosis.code} {admission.primaryDiagnosis.nameKo ?? admission.primaryDiagnosis.nameEn ?? ''}
          </p>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          {subTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${subTab === t.key ? 'text-blue-700 border-b-2 border-blue-600 bg-blue-50/50' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {/[가-힣]/.test(t.label) ? <T k={t.label} /> : t.label}
            </button>
          ))}
        </div>
        <div className="p-4">
          {subTab === 'all' && (
            <div className="space-y-3">
              {/* 최근 바이탈 요약 */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="최근 VS" /></p>
                {vitalsIsError ? (
                  <QueryErrorFallback error={vitalsError} onRetry={refetchVitals} size="compact" />
                ) : latestVitals ? (
                  // 표준 순서·단위·미측정 '—'·이상 색 — 부품 정본(종전 BT '°' 와 VS 탭 '°C' 가 갈렸다)
                  <VitalSignsStrip vitals={latestVitals as unknown as Record<string, unknown>} />
                ) : <p className="text-[10px] text-gray-400"><T k="VS 없음" /></p>}
              </div>
              {/* 투약 요약 */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">투약 {medIsError ? '' : `(${meds.filter(m => isMedDone(m.status)).length}/${meds.length})`}</p>
                {medIsError ? (
                  <QueryErrorFallback error={medError} onRetry={refetchMed} size="compact" />
                ) : (
                <div className="flex flex-wrap gap-1">
                  {meds.slice(0, 4).map(m => (
                    <span key={m.id} className={`text-[9px] px-1.5 py-0.5 rounded-full ${isMedDone(m.status) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {medName(m)?.slice(0, 8) ?? '약품명 미상'}
                    </span>
                  ))}
                  {meds.length === 0 && <span className="text-[10px] text-gray-400"><T k="스케줄 없음" /></span>}
                </div>
                )}
              </div>
              {/* I/O 요약 */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">I/O</p>
                {ioIsError ? (
                  <QueryErrorFallback error={ioError} onRetry={refetchIo} size="compact" />
                ) : ios.length > 0 ? (
                  <div className="flex gap-3 text-xs">
                    <span className="text-blue-600">섭취 {ios.reduce((s, r) => s + (r.intakeAmount ?? 0), 0)}mL</span>
                    <span className="text-amber-600">배출 {ios.reduce((s, r) => s + (r.outputAmount ?? 0), 0)}mL</span>
                  </div>
                ) : <span className="text-[10px] text-gray-400"><T k="기록 없음" /></span>}
              </div>
              {/* 최근 기록 */}
              {noteIsError ? (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="최근 기록" /></p>
                  <QueryErrorFallback error={noteError} onRetry={refetchNote} size="compact" />
                </div>
              ) : notes.length > 0 ? (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="최근 기록" /></p>
                  <p className="text-[10px] text-gray-600 line-clamp-2" data-station-note-line>{noteLine(notes[0])}</p>
                </div>
              ) : null}
            </div>
          )}

          {subTab === 'vs' && (
            vitalsIsError ? (
              <QueryErrorFallback error={vitalsError} onRetry={refetchVitals} size="compact" />
            ) : latestVitals ? (
              <div className="space-y-2 text-sm">
                {/* 표준 순서·단위·미측정 '—'·이상 색·측정 시각과 경과 — 부품 정본 */}
                <VitalSignsGrid vitals={latestVitals as unknown as Record<string, unknown>} columns={2} measuredAt={vitalAt(latestVitals) ?? null} />
                <VitalsRuleNote rule={ruleOf(vitalsData?.meta?.vitalsRule)} />
              </div>
            ) : <p className="text-xs text-gray-400"><T k="기록 없음" /></p>
          )}

          {subTab === 'med' && (
            medIsError ? (
              <QueryErrorFallback error={medError} onRetry={refetchMed} size="compact" />
            ) : meds.length > 0 ? (
              <div className="space-y-2">
                {meds.slice(0, 6).map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 truncate max-w-[60%]">{medName(m) ?? '약품명 미상'}</span>
                    <span className="flex items-center gap-1">
                      {m.carriedOver && <span className="whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 font-medium"><T k="지난 날짜" /></span>}
                      <StatusBadge domain="medAdmin" status={m.status} />
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400"><T k="투약 스케줄 없음" /></p>
          )}

          {subTab === 'io' && (
            ioIsError ? (
              <QueryErrorFallback error={ioError} onRetry={refetchIo} size="compact" />
            ) : ios.length > 0 ? (
              <div className="space-y-2 text-xs">
                {ios.slice(0, 6).map((r) => {
                  const parts = [
                    r.intakeAmount != null ? `섭취 (${r.intakeDetail ?? IO_INTAKE_TYPES.find(t => t.v === r.intakeType)?.label ?? r.intakeType ?? '미상'}) ${r.intakeAmount} mL` : null,
                    r.outputAmount != null ? `배설 (${r.outputDetail ?? IO_OUTPUT_TYPES.find(t => t.v === r.outputType)?.label ?? r.outputType ?? '미상'}) ${r.outputAmount} mL` : null,
                  ].filter(Boolean);
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-2">
                      {/* 금액이 하나도 없으면 0 mL 라 말하지 않는다 — 기록이 비어 있다는 사실을 그대로 적는다 */}
                      <span className="text-gray-700">{parts.length ? parts.join(' · ') : '금액 미기록'}</span>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-xs text-gray-400"><T k="I/O 기록 없음" /></p>
          )}

          {subTab === 'note' && (
            noteIsError ? (
              <QueryErrorFallback error={noteError} onRetry={refetchNote} size="compact" />
            ) : notes.length > 0 ? (
              <div className="space-y-2 text-xs">
                {notes.slice(0, 4).map((n) => (
                  <div key={n.id} className="border-l-2 border-gray-200 pl-3 py-1">
                    <p className="text-gray-400">{fmtDateTime((n as { recordedAt?: string }).recordedAt ?? n.createdAt)}</p>
                    <p className="text-gray-700 line-clamp-2 mt-0.5" data-station-note-line>{noteLine(n)}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400"><T k="간호 기록 없음" /></p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {/* 간호 화면에서 왔으니 차트의 간호기록 탭으로(종전엔 개요) */}
        <Link href={`/patients/${admission.patientId}?tab=nursing`} data-station-chart-link className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium text-center hover:bg-blue-700 transition-colors">
          <T k="환자 상세" />
        </Link>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 2: 투약 관리 (MAR)
   ═══════════════════════════════════════════════════════════════ */

function MARTab({ admissions }: { admissions: Admission[] }) {
  const tAttr = useTAttr();
  const [filter, setFilter] = useState<string>('전체');
  const queryClient = useQueryClient();

  // Fetch all MAR schedules across admissions (combine)
  const { data: marData, isLoading, refetch: refetchMar } = useQuery({
    queryKey: ['mar-all', admissions.map((a) => a.id)],
    queryFn: async () => {
      // 🔴 환자 한 명의 조회가 실패하면 종전엔 `[]` 로 접혀 **그 환자만 조용히 목록에서 빠졌다.**
      //    간호사는 "그 환자는 해당 없음"으로 읽는다. 실패한 환자를 들고 나가 화면이 말하게 한다.
      const results = await Promise.all(
        admissions.map((adm) =>
          // 🔴 (2026-09-30) 종전엔 날짜 없이 입원 전 기간을 받아 "오늘 할 일"과 지난 기록이 한 표에 섞였다 → 오늘 + 지난 미처리(표식)
          apiClient.get<{ data: MedScheduleItem[] }>(`/api/v1/admissions/${adm.id}/medication-schedule?date=${kstToday()}&includeOverdue=true`)
            .then((res) => ({ ok: true, who: patientName(adm.patient), rows: (res.data ?? []).map((m) => ({ ...m, admissionId: adm.id, patientName: patientName(adm.patient) })) }))
            .catch(() => ({ ok: false, who: patientName(adm.patient), rows: [] as MedScheduleItem[] })),
        ),
      );
      return { rows: results.flatMap((r) => r.rows), failed: results.filter((r) => !r.ok).map((r) => r.who) };
    },
    enabled: admissions.length > 0,
  });

  // BCMA bedside 스캔 — 5-Rights 기계 대조(환자·약품). 게이트=nursing.bcma.enforce(백엔드 강제).
  const [scanFor, setScanFor] = useState<MedScheduleItem | null>(null);
  const [scan, setScan] = useState({ band: '', med: '' });
  // 실제 투여량·경로는 간호사가 확인한다 — 종전에는 '처방 용량'·'PO' 를 날조해 보냈다(P15)
  const [give, setGive] = useState({ dose: '', route: '' });
  const [dc, setDc] = useState<DoubleCheckValue>(EMPTY_DOUBLE_CHECK);

  const openScan = (m: MedScheduleItem) => {
    setScanFor(m);
    setScan({ band: '', med: '' });
    setGive({ dose: m.dose ?? '', route: m.route ?? m.prescription?.route ?? '' });
    setDc(EMPTY_DOUBLE_CHECK);
  };

  const administerMed = useMutation({
    mutationFn: ({ item, band, med }: { item: MedScheduleItem; band: string; med: string }) =>
      apiClient.patch<{ data: { warnings?: string[] } }>(`/api/v1/medication-administrations/${item.id}/administer`, {
        dose: give.dose.trim(), route: give.route.trim(),
        ...(band.trim() ? { patientBandScan: band.trim() } : {}),
        ...(med.trim() ? { medScan: med.trim() } : {}),
        ...doubleCheckPayload(doubleCheckScopeOf(item, give.route), dc),
      }),
    onSuccess: (res) => {
      const raw = res?.data as unknown as { data?: { warnings?: string[] }; warnings?: string[] };
      const warns = raw?.data?.warnings ?? raw?.warnings;
      if (warns?.length) warns.forEach((w) => toast.warning(w)); else toast.success(tAttr('스캔 대조 일치 — 투약 확인 완료'));
      queryClient.invalidateQueries({ queryKey: ['mar-all'] });
      setScanFor(null); setScan({ band: '', med: '' }); setDc(EMPTY_DOUBLE_CHECK);
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('대조 실패 — 투약 중단')),
  });

  const items = useMemo(() => {
    const all = marData?.rows ?? [];
    if (filter === '전체') return all;
    if (filter === '예정') return all.filter((m) => m.status === 'SCHEDULED' || m.status === 'PENDING');
    if (filter === '미투약') return all.filter((m) => m.status === 'MISSED' || m.carriedOver);
    if (filter === '완료') return all.filter((m) => m.status === 'COMPLETED' || m.status === 'ADMINISTERED');
    if (filter === '보류·거부') return all.filter((m) => m.status === 'HELD' || m.status === 'REFUSED');
    return all;
  }, [marData, filter]);

  // 🔴 (2026-09-30) 종전 로컬 표는 default 가 '예정'이라 **거부(REFUSED)를 예정으로** 말했다 → shared 정본 `medAdmin`
  const carriedCount = (marData?.rows ?? []).filter((m) => m.carriedOver).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* 🔴 부분 실패를 숨기지 않는다 — 빠진 환자를 "해당 없음"으로 읽지 않게 이름을 밝힌다 */}
      {(marData?.failed?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
          <Tf k="투약 스케줄 조회에 실패한 환자 {명수}명: {명단} — {강조}입니다." params={{ 명수: marData!.failed.length, 명단: <b>{marData!.failed.join(', ')}</b>, 강조: <b><T k="기록이 없는 것이 아니라 모르는 상태" /></b> }} />
          <button onClick={() => refetchMar()} className="px-2 py-0.5 rounded-lg border border-red-300 hover:bg-red-100 whitespace-nowrap"><T k="재시도" /></button>
        </div>
      )}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700"><T k="투약 스케줄 (MAR)" /></p>
        <div className="flex gap-1">
          {MAR_FILTER_OPTIONS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {/* MAR 상태어는 안전 어휘 — 사람 검수 전까지 한국어 그대로(settings3 헤더 ①) */}
              {f}
            </button>
          ))}
        </div>
      </div>
      <p className="px-5 py-1.5 text-[11px] text-gray-500 border-b border-gray-50">
        <Tf k="오늘({날짜}) 간호일 예정분 + 지난 7일 안에 예정됐는데 기록되지 않은 투약 {건수}건(이번 입원만)" params={{ 날짜: kstToday(), 건수: carriedCount }} />
      </p>
      {isLoading ? (
        <div className="p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon="💊" title="투약 스케줄이 없습니다." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs">
                <th className="px-4 py-2.5 text-left font-medium"><T k="시간" /></th>
                <th className="px-4 py-2.5 text-left font-medium"><T k="환자" /></th>
                <th className="px-4 py-2.5 text-left font-medium"><T k="약물명" /></th>
                <th className="px-4 py-2.5 text-left font-medium"><T k="용량" /></th>
                <th className="px-4 py-2.5 text-left font-medium"><T k="경로" /></th>
                <th className="px-4 py-2.5 text-center font-medium"><T k="상태" /></th>
                <th className="px-4 py-2.5 text-center font-medium"><T k="확인@투약" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((m) => {
                const isPending = m.status === 'SCHEDULED' || m.status === 'PENDING';
                const rxStopped = m.prescription?.status != null && m.prescription.status !== 'ACTIVE';
                return (
                  <tr key={m.id} className={m.carriedOver ? 'bg-rose-50/40 hover:bg-rose-50' : 'hover:bg-gray-50/50'}>
                    <td className="px-4 py-2.5 text-gray-700">
                      {m.carriedOver ? <span title={tAttr('지난 날짜 예정분')}>{fmtDateTime(m.scheduledAt)}</span> : fmtTime(m.scheduledAt)}
                      {m.carriedOver && <span className="ml-1 whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-medium"><T k="지난 날짜" /></span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-900 font-medium">{m.patientName ?? '-'}</td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {medName(m) ?? '-'}
                      {m.prescription?.medicationCode?.highAlertFlag && (
                        <span className="ml-1.5 text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold align-middle whitespace-nowrap" title="ISMP 고위험 약물">⛔고위험</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{m.dose ?? '-'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{m.route ?? '-'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <StatusBadge domain="medAdmin" status={m.status} />
                      {rxStopped && <StatusBadge domain="prescription" status={m.prescription!.status!} className="ml-1" />}
                      <DoubleCheckBypassBadge notes={m.notes} className="mt-0.5" />
                    </td>
                    <td className="px-4 py-2.5 text-center space-y-1">
                      {isPending && m.admissionId && (
                        // 보류·거부·누락 기록은 MAR 화면이 정본(사유 필수) — 여기서 따로 만들지 않는다
                        <Link href={`/inpatient/${m.admissionId}/nursing/mar`} className="block text-[11px] text-blue-600 hover:underline whitespace-nowrap"><T k="보류·거부 기록" /></Link>
                      )}
                      {isPending && rxStopped && <p className="text-[10px] text-gray-500"><T k="처방이 중단돼 투여하지 않습니다" /></p>}
                      {canAdminister(m) && (
                        <button
                          onClick={() => openScan(m)}
                          disabled={administerMed.isPending}
                          className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                          투약(스캔)
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* BCMA bedside 스캔 모달 — 5-Rights 기계 대조. 게이트=nursing.bcma.enforce(백엔드 강제) */}
      {scanFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setScanFor(null)}>
          <div className="bg-white rounded-2xl p-4 w-full max-w-xs space-y-3" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-sm font-bold text-gray-900">{medName(scanFor) ?? '약품명 미상'} 투약</p>
              <p className="text-[11px] text-gray-500">{scanFor.patientName ?? ''} · 처방 {scanFor.dose || '용량 미기재'} · {scanFor.route || scanFor.prescription?.route || '경로 미기재'}</p>
            </div>
            {/* 5-Rights ③ — 실제 투여량·경로를 간호사가 확인한다(자리표시 문자열 전송 금지) */}
            <div className="grid grid-cols-2 gap-2">
              <input value={give.dose} onChange={e => setGive(g => ({ ...g, dose: e.target.value }))}
                placeholder="실제 투여량" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
              <input value={give.route} onChange={e => setGive(g => ({ ...g, route: e.target.value }))}
                placeholder="투여 경로" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            </div>
            <MedDoubleCheckPanel scope={doubleCheckScopeOf(scanFor, give.route)} value={dc} onChange={setDc} compact />
            <div className="bg-rose-50/60 border border-rose-100 rounded-xl p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold text-rose-700">BCMA 바코드 대조 (환자·약품)</p>
              <input value={scan.band} onChange={e => setScan(s => ({ ...s, band: e.target.value }))} autoFocus
                placeholder="① 손목밴드 스캔(MRN)" className="w-full px-2.5 py-1.5 border border-rose-200 rounded-lg text-xs" />
              <input value={scan.med} onChange={e => setScan(s => ({ ...s, med: e.target.value }))}
                placeholder="② 약품 바코드 스캔" className="w-full px-2.5 py-1.5 border border-rose-200 rounded-lg text-xs" />
              {(!scan.band || !scan.med) && (
                <p className="text-[10px] text-rose-500">※ 미스캔 시 게이트 설정에 따라 경고/차단될 수 있습니다.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setScanFor(null)} className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700">취소</button>
              <button onClick={() => administerMed.mutate({ item: scanFor, band: scan.band, med: scan.med })}
                disabled={administerMed.isPending || !give.dose.trim() || !give.route.trim() || !doubleCheckReady(doubleCheckScopeOf(scanFor, give.route), dc)}
                title={!give.dose.trim() || !give.route.trim() ? '실제 투여량·경로를 입력하세요' : undefined}
                className="min-h-[44px] flex-1 py-2 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {administerMed.isPending ? '대조 중…' : '투약 확인'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 3: 활력징후 (Vital Signs)
   ═══════════════════════════════════════════════════════════════ */

function VitalsTab({ admissions }: { admissions: Admission[] }) {
  const tAttr = useTAttr();
  const [showModal, setShowModal] = useState(false);
  useHotkeys([{ combo: 'alt+a', label: 'VS 일괄 기록', group: '간호 — 활력징후', when: () => !showModal, onTrigger: () => setShowModal(true) }]);
  const queryClient = useQueryClient();

  const { data: vitalsAll, isLoading, refetch: refetchVitalsAll } = useQuery({
    queryKey: ['vitals-all', admissions.map((a) => a.patientId)],
    queryFn: async () => {
      // 🔴 환자 한 명의 조회가 실패하면 종전엔 `[]` 로 접혀 **그 환자만 조용히 목록에서 빠졌다.**
      //    간호사는 "그 환자는 해당 없음"으로 읽는다. 실패한 환자를 들고 나가 화면이 말하게 한다.
      const results = await Promise.all(
        admissions.map((adm) =>
          apiClient.get<{ data: VitalsRecord[]; meta?: { vitalsRule?: VitalsRule } }>(`/api/v1/nurse-station/vitals/patient/${adm.patientId}`)
            .then((res) => ({ ok: true, who: patientName(adm.patient), rule: res.meta?.vitalsRule ?? null, rows: (res.data ?? []).map((v) => ({ ...v, patientName: patientName(adm.patient) })) }))
            .catch(() => ({ ok: false, who: patientName(adm.patient), rule: null, rows: [] as VitalsRecord[] })),
        ),
      );
      return {
        rows: results.flatMap((r) => r.rows).sort((a, b) => new Date(vitalAt(b) ?? '').getTime() - new Date(vitalAt(a) ?? '').getTime()),
        failed: results.filter((r) => !r.ok).map((r) => r.who),
        // 임계는 병원 단위라 응답마다 같다 — 첫 성공 응답의 것을 쓴다
        rule: results.find((r) => r.rule)?.rule ?? null,
      };
    },
    enabled: admissions.length > 0,
  });

  const records = vitalsAll?.rows ?? [];

  // shift 분류
  const shiftBoundaries = useShiftBoundaries();
  const getShift = (dateStr?: string) => dateStr ? shiftOf(dateStr, shiftBoundaries) : 'DAY';
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'DAY' | 'EVENING' | 'NIGHT'>('ALL');
  const filteredRecords = shiftFilter === 'ALL' ? records : records.filter(v => getShift(vitalAt(v)) === shiftFilter);

  return (
    <>
      {/* 🔴 부분 실패를 숨기지 않는다 — 빠진 환자를 "해당 없음"으로 읽지 않게 이름을 밝힌다 */}
      {(vitalsAll?.failed?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
          <Tf k="활력징후 조회에 실패한 환자 {명수}명: {명단} — {강조}입니다." params={{ 명수: vitalsAll!.failed.length, 명단: <b>{vitalsAll!.failed.join(', ')}</b>, 강조: <b><T k="기록이 없는 것이 아니라 모르는 상태" /></b> }} />
          <button onClick={() => refetchVitalsAll()} className="px-2 py-0.5 rounded-lg border border-red-300 hover:bg-red-100 whitespace-nowrap"><T k="재시도" /></button>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-gray-700"><T k="활력징후 기록" /></p>
            <div className="flex gap-1">
              {([['ALL', '전체'], ['DAY', 'D'], ['EVENING', 'E'], ['NIGHT', 'N']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setShiftFilter(key)}
                  className={`px-2 py-1 text-[10px] font-bold rounded ${shiftFilter === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {/[가-힣]/.test(label) ? <T k={label} /> : label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/risk-reassessment" className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium hover:bg-amber-100">
              <T k="낙상/욕창 재평가" />
            </Link>
            <button onClick={() => setShowModal(true)} aria-keyshortcuts={ariaKeyshortcuts('alt+a')} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors">
              + <T k="VS 일괄 기록" /> <kbd className="ml-1 text-[9px] font-semibold bg-white/20 rounded px-1 py-0.5">{comboLabel('alt+a')}</kbd>
            </button>
          </div>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />)}
          </div>
        ) : filteredRecords.length === 0 ? (
          <EmptyState icon="🩺" title={shiftFilter === 'ALL' ? '활력징후 기록이 없습니다.' : `${shiftFilter} 근무 기록이 없습니다.`} />
        ) : (
          <div className="overflow-x-auto">
            <div className="px-4 py-1.5"><VitalsRuleNote rule={ruleOf(vitalsAll?.rule)} /></div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="px-4 py-2.5 text-left font-medium"><T k="시간" /></th>
                  <th className="px-4 py-2.5 text-left font-medium"><T k="환자" /></th>
                  <th className="px-4 py-2.5 text-center font-medium"><T k="근무" /></th>
                  {/* 표준 순서(RR → SpO₂ → BP → HR → BT → 통증) — 화면마다 열 순서가 달랐다 */}
                  <VitalHeaderCells className="px-4 py-2.5 text-center font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRecords.slice(0, 30).map((v, idx) => (
                  <tr key={v.id ?? idx} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-500">{fmtDateTime(vitalAt(v))}</td>
                    <td className="px-4 py-2.5 text-gray-900 font-medium">{v.patientName ?? '-'}</td>
                    <td className="px-4 py-2.5 text-center">
                      {(() => { const s = getShift(vitalAt(v)); const c = s === 'DAY' ? 'bg-amber-100 text-amber-700' : s === 'EVENING' ? 'bg-blue-100 text-blue-700' : 'bg-indigo-100 text-indigo-700'; return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${c}`}>{s[0]}</span>; })()}
                    </td>
                    <VitalRowCells vitals={v as unknown as Record<string, unknown>} className="px-4 py-2.5 text-center" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <VitalsRecordModal
          admissions={admissions}
          onClose={() => setShowModal(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['vitals-all'] })}
        />
      )}
    </>
  );
}

function VitalsRecordModal({
  admissions,
  onClose,
  onSaved,
}: {
  admissions: Admission[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  // 🔴 (2026-09-30) 쓰기 폼은 미선택으로 시작 — 첫 환자로 시작하면 고르지 않고 저장한 활력이 엉뚱한 환자에 붙는다
  const [patientId, setPatientId] = useState('');
  const { register, handleSubmit, watch } = useForm<VitalsForm>({
    resolver: zodResolver(vitalsSchema),
    defaultValues: { bodyTemperature: '', systolicBp: '', diastolicBp: '', heartRate: '', respiratoryRate: '', spO2: '', painScore: '', note: '', consciousness: '', supplementalO2: '', measuredAtLocal: '' },
  });
  const preview = vsBatchNews2Preview(watch());

  const selectedAdm = admissions.find((a) => a.patientId === patientId);

  /**
   * 🔴 2026-08-25 배선 — 종전엔 안내 토스트 하나를 띄우고 곧바로 예외를 던져 저장을 포기했다.
   *    버튼·단축키(alt+a)까지 배선된 "VS 일괄 기록"이 **열리지만 저장은 항상 실패**했고,
   *    안내 문구는 사실도 아니었다: 활력 쓰기 정본 EP(`POST /api/v1/vitals`)는 있었다.
   *    폼 키가 DTO 와 달라(bodyTemperature/spO2/note ↔ temperature/spo2/notes) 그대로 보내면
   *    whitelist 가 지운다 — ENT 와 같은 유형이라 **매핑해서** 보낸다.
   *    입력하지 않은 항목은 보내지 않는다(빈 값은 "쟀는데 0"과 구분되지 않는다).
   */
  const saveMutation = useMutation({
    mutationFn: async (form: VitalsForm) => {
      if (!patientId) throw new Error(tAttr('환자를 선택하세요'));
      // 재원을 밝혀 보낸다 — 서버가 입원 원장(플로시트)에 쓴다(2026-10-10) · 의식·산소·측정 시각은 관측했을 때만
      const body = buildVsBatchBody(form, patientId, selectedAdm?.id);
      if (!vsBatchHasValue(body)) throw new Error(tAttr('기록할 항목을 하나 이상 입력하세요'));
      return apiClient.post<{ data: unknown; meta?: { ingest?: { accepted?: boolean; reason?: string } } }>('/api/v1/vitals', body);
    },
    onSuccess: (res) => {
      // 서버가 저장 여부·사유를 meta.ingest 로 준다 — 거부됐으면 성공이라 말하지 않는다
      const ingest = (res as { meta?: { ingest?: { accepted?: boolean; reason?: string } } })?.meta?.ingest;
      if (ingest && ingest.accepted === false) {
        toast.error(tfAttr('활력징후가 저장되지 않았습니다 — {사유}', { 사유: ingest.reason ?? tAttr('사유 미상') }));
        return;
      }
      toast.success(tAttr('활력징후를 기록했습니다.'));
      onSaved(); onClose();
    },
    onError: (e: { message?: string }) => toast.error(e?.message || tAttr('활력징후 기록에 실패했습니다.')),
  });

  const fields: Array<{ key: keyof VitalsForm; label: string; ph: string }> = [
    { key: 'bodyTemperature', label: '체온 (°C)', ph: '36.5' },
    { key: 'systolicBp', label: '수축기 BP (mmHg)', ph: '120' },
    { key: 'diastolicBp', label: '이완기 BP (mmHg)', ph: '80' },
    { key: 'heartRate', label: '심박수 (bpm)', ph: '72' },
    { key: 'respiratoryRate', label: '호흡수 (회/분)', ph: '18' },
    { key: 'spO2', label: 'SpO2 (%)', ph: '98' },
    { key: 'painScore', label: '통증 (NRS 0-10)', ph: '0' },
  ];

  return (
    <Modal title="VS 일괄 기록" onClose={onClose}>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자 선택" /></label>
        <select
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{tAttr('— 환자 선택 —')}</option>
          {admissions.map((a) => (
            <option key={a.patientId} value={a.patientId}>
              {patientName(a.patient)} — {a.bed?.roomNumber ?? '-'}호
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
            <input
              type="number"
              step="any"
              {...register(f.key)}
              placeholder={f.ph}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1"><T k="의식(ACVPU)" /></label>
          <select {...register('consciousness')} className="w-full min-h-[44px] px-3 py-2 border border-gray-200 rounded-xl text-sm" data-vs-acvpu>
            <option value="">{tAttr('— 미관측 —')}</option>
            {ACVPU_VALUES.map((v) => <option key={v} value={v}>{tAttr(ACVPU_LABEL[v])}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1"><T k="산소 투여" /></label>
          <select {...register('supplementalO2')} className="w-full min-h-[44px] px-3 py-2 border border-gray-200 rounded-xl text-sm" data-vs-o2>
            <option value="">{tAttr('산소 투여(미관측)')}</option>
            <option value="true">{tAttr('산소 투여 중')}</option>
            <option value="false">{tAttr('실내 공기')}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1"><T k="측정 시각" /></label>
          <input type="datetime-local" {...register('measuredAtLocal')} className="w-full min-h-[44px] px-3 py-2 border border-gray-200 rounded-xl text-sm" data-vs-measured-at />
        </div>
      </div>
      {/* NEWS2 미리보기 — 7요소가 다 있을 때만 점수(서버 저장 때 같은 정본으로 다시 계산한다) */}
      <p className={`rounded-xl px-3 py-2 text-xs ${preview.result ? (preview.result.escalationRequired ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800') : 'bg-gray-50 text-gray-600'}`} data-vs-news2={preview.result ? preview.result.totalScore : 'none'}>
        {preview.result
          ? <>NEWS2 <b>{preview.result.totalScore}</b> · <T k={NEWS2_RISK_LABEL[preview.result.riskLevel]} />{preview.result.escalationRequired && <> · <T k="보고 필요" /></>}</>
          : <><T k="NEWS2 점수 없음 — 빠진 요소" />: {preview.missing.map((m, i) => <span key={m}>{i > 0 && ', '}<T k={m} /></span>)}</>}
      </p>
      <button
        onClick={handleSubmit((form) => saveMutation.mutate(form))}
        disabled={saveMutation.isPending}
        className="min-h-[44px] w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        저장
      </button>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 4: I/O 기록 (Intake/Output)
   ═══════════════════════════════════════════════════════════════ */

function IOTab({ admissions }: { admissions: Admission[] }) {
  const tAttr = useTAttr();
  const [showModal, setShowModal] = useState(false);
  useHotkeys([{ combo: 'alt+a', label: 'I/O 기록', group: '간호 — I/O', when: () => !showModal, onTrigger: () => setShowModal(true) }]);
  const queryClient = useQueryClient();
  // 🔴 `toISOString()` 은 UTC 다 — KST 00:00~08:59 에는 **어제**를 조회했다. 로컬 달력 날짜로 만든다.
  const today = ((d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date());

  const { data: ioAll, isLoading, refetch: refetchIoAll } = useQuery({
    queryKey: ['io-all', admissions.map((a) => a.id)],
    queryFn: async () => {
      // 🔴 환자 한 명의 조회가 실패하면 종전엔 `[]` 로 접혀 **그 환자만 조용히 목록에서 빠졌다.**
      //    간호사는 "그 환자는 해당 없음"으로 읽는다. 실패한 환자를 들고 나가 화면이 말하게 한다.
      const results = await Promise.all(
        admissions.map((adm) =>
          apiClient.get<{ data: IORecord[] }>(`/api/v1/admissions/${adm.id}/intake-outputs`, { date: today })
            .then((res) => ({ ok: true, who: patientName(adm.patient), rows: (res.data ?? []).map((r) => ({ ...r, admissionId: adm.id, patientName: patientName(adm.patient) })) }))
            .catch(() => ({ ok: false, who: patientName(adm.patient), rows: [] as IORecord[] })),
        ),
      );
      return { rows: results.flatMap((r) => r.rows), failed: results.filter((r) => !r.ok).map((r) => r.who) };
    },
    enabled: admissions.length > 0,
  });

  // Group by patient
  const grouped = useMemo(() => {
    const map: Record<string, { name: string; admissionId: string; intake: number; output: number; records: IORecord[] }> = {};
    for (const r of ioAll?.rows ?? []) {
      const key = r.admissionId ?? r.id;
      if (!map[key]) map[key] = { name: r.patientName ?? '-', admissionId: r.admissionId ?? '', intake: 0, output: 0, records: [] };
      map[key].intake += r.intakeAmount ?? 0;
      map[key].output += r.outputAmount ?? 0;
      map[key].records.push(r);
    }
    return Object.values(map);
  }, [ioAll]);

  const createIO = useMutation({
    mutationFn: (body: { admissionId: string; type: string; category: string; amount: number }) =>
      // 🔴 서버 DTO(`CreateIntakeOutputDto`) 이름으로 보낸다 — 종전 `{type,category,amount}` 는
      //    ValidationPipe `whitelist:true` 가 전부 지워 201 과 함께 **빈 행**이 저장됐다.
      apiClient.post(`/api/v1/admissions/${body.admissionId}/intake-outputs`,
        body.type === 'INTAKE'
          ? { intakeType: body.category, intakeAmount: body.amount }
          : { outputType: body.category, outputAmount: body.amount }),
    onSuccess: () => {
      toast.success(tAttr('I/O 기록이 저장되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['io-all'] });
      setShowModal(false);
    },
    onError: () => toast.error(tAttr('I/O 기록 저장에 실패했습니다.')),
  });

  return (
    <>
      {/* 🔴 부분 실패를 숨기지 않는다 — 빠진 환자를 "해당 없음"으로 읽지 않게 이름을 밝힌다 */}
      {(ioAll?.failed?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
          <Tf k="I/O 기록 조회에 실패한 환자 {명수}명: {명단} — {강조}입니다." params={{ 명수: ioAll!.failed.length, 명단: <b>{ioAll!.failed.join(', ')}</b>, 강조: <b><T k="기록이 없는 것이 아니라 모르는 상태" /></b> }} />
          <button onClick={() => refetchIoAll()} className="px-2 py-0.5 rounded-lg border border-red-300 hover:bg-red-100 whitespace-nowrap"><T k="재시도" /></button>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700"><T k="I/O 기록 (24시간)" /></p>
          <button onClick={() => setShowModal(true)} aria-keyshortcuts={ariaKeyshortcuts('alt+a')} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors">
            + <T k="I/O 기록" /> <kbd className="ml-1 text-[9px] font-semibold bg-white/20 rounded px-1 py-0.5">{comboLabel('alt+a')}</kbd>
          </button>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-gray-50 rounded-lg animate-pulse" />)}
          </div>
        ) : grouped.length === 0 ? (
          <EmptyState icon="💧" title="I/O 기록이 없습니다." />
        ) : (
          <div className="p-4 space-y-4">
            {grouped.map((g) => {
              const balance = g.intake - g.output;
              const alertBalance = Math.abs(balance) > 500;
              return (
                <div key={g.admissionId} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-gray-900">{g.name}</p>
                    <span className={`whitespace-nowrap text-xs px-2 py-0.5 rounded-full font-medium ${alertBalance ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      <T k="균형" />: {balance > 0 ? '+' : ''}{balance} mL
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-blue-50 rounded-lg p-2">
                      <p className="text-[10px] text-blue-500"><T k="섭취" /></p>
                      <p className="text-sm font-bold text-blue-700">{g.intake} mL</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2">
                      <p className="text-[10px] text-amber-500"><T k="배설" /></p>
                      <p className="text-sm font-bold text-amber-700">{g.output} mL</p>
                    </div>
                    <div className={`rounded-lg p-2 ${alertBalance ? 'bg-rose-50' : 'bg-gray-50'}`}>
                      <p className={`text-[10px] ${alertBalance ? 'text-rose-500' : 'text-gray-500'}`}><T k="균형" /></p>
                      <p className={`text-sm font-bold ${alertBalance ? 'text-rose-700' : 'text-gray-700'}`}>{balance > 0 ? '+' : ''}{balance}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <IORecordModal
          admissions={admissions}
          onClose={() => setShowModal(false)}
          onSave={(data) => createIO.mutate(data)}
          isPending={createIO.isPending}
        />
      )}
    </>
  );
}

function IORecordModal({
  admissions,
  onClose,
  onSave,
  isPending,
}: {
  admissions: Admission[];
  onClose: () => void;
  onSave: (data: { admissionId: string; type: string; category: string; amount: number }) => void;
  isPending: boolean;
}) {
  const tAttr = useTAttr();
  // 🔴 (2026-09-30) 쓰기 폼은 미선택으로 시작(첫 환자 자동 선택 금지)
  const [admissionId, setAdmissionId] = useState('');
  const [type, setType] = useState('INTAKE');
  const [category, setCategory] = useState('IV');
  const [amount, setAmount] = useState('');

  // 🔴 종전 목록의 `PO`·`BLOOD`·`STOOL` 은 Prisma enum 에 없다 — 골라도 400 이거나 조용히 사라진다.
  //    저장할 수 있는 값만 고르게 한다(어휘를 지어내지 않는다).
  const intakeCategories = IO_INTAKE_TYPES;
  const outputCategories = IO_OUTPUT_TYPES;

  return (
    <Modal title="I/O 기록" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자" /></label>
          <select value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{tAttr('— 환자 선택 —')}</option>
            {admissions.map((a) => (
              <option key={a.id} value={a.id}>{patientName(a.patient)} — {a.bed?.roomNumber ?? '-'}호</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="유형" /></label>
            <select value={type} onChange={(e) => { setType(e.target.value); setCategory(e.target.value === 'INTAKE' ? 'IV' : 'URINE'); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="INTAKE">{tAttr('섭취 (Intake)')}</option>
              <option value="OUTPUT">{tAttr('배설 (Output)')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="분류" /></label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {(type === 'INTAKE' ? intakeCategories : outputCategories).map((c) => (
                <option key={c.v} value={c.v}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">용량 (mL)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
      <button
        onClick={() => onSave({ admissionId, type, category, amount: Number(amount) || 0 })}
        disabled={isPending || !amount || !admissionId}
        className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? '저장 중...' : '저장'}
      </button>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 5: 간호 기록 (Nursing Notes — SBAR)
   ═══════════════════════════════════════════════════════════════ */

function NotesTab({ admissions }: { admissions: Admission[] }) {
  /**
   * 간호 기록 v2 — 정본 수렴 + 시계열 (nurse-workstation-notes-handoff.plan.md).
   * 🔴 종전엔 입원 기록을 외래용 Universal EP 에 SBAR JSON 문자열로 저장했다 —
   *    보드 최근기록/미서명·서명·QA 흐름에 전부 안 잡히는 유령 기록이었다.
   *    정본(`/admissions/:id/nursing-notes`·작성=서명)으로 쓰고, 시계열도 정본에서 읽는다.
   */
  const tAttr = useTAttr();
  const [admissionId, setAdmissionId] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'DAY' | 'EVENING' | 'NIGHT'>('ALL');
  const lateGrace = useLateEntryGrace();
  useHotkeys([{ combo: 'alt+a', label: '새 간호기록', group: '간호 — 기록', when: () => !showModal, onTrigger: () => setShowModal(true) }]);
  const queryClient = useQueryClient();

  // 🔴 (2026-09-30) 종전엔 isError 를 보지 않아 조회 실패가 "간호 기록이 없습니다"로 그려졌다
  const { data: notesData, isLoading, isError: notesIsError, error: notesError, refetch: refetchNotes } = useQuery({
    queryKey: ['ws-nursing-notes', admissionId],
    queryFn: () => apiClient.get<{ data: WardNursingNote[] }>(`/api/v1/admissions/${admissionId}/nursing-notes`),
    enabled: !!admissionId,
  });
  const notes: WardNursingNote[] = notesData?.data ?? [];
  const filtered = shiftFilter === 'ALL' ? notes : notes.filter((n) => n.shiftType === shiftFilter);

  // 날짜별 그룹(시계열) — 최신 날짜부터, 날짜 안에서는 최신 기록부터
  // 🔴 (2026-09-30) 종전 `.slice(0, 10)` 은 **UTC 날짜**라 KST 00~09시 기록이 전날 칸에 들어갔다 → 병원 표준시 날짜
  const byDate = new Map<string, WardNursingNote[]>();
  for (const n of filtered) {
    const d = kstDateKey(n.recordedAt ?? n.createdAt);
    byDate.set(d, [...(byDate.get(d) ?? []), n]);
  }
  const days = [...byDate.keys()].sort().reverse();

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-700"><T k="간호 기록" /></p>
            <select value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
              <option value="">{tAttr('— 환자 선택 —')}</option>
              {admissions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bed?.roomNumber ?? '-'}호 · {a.patient?.familyName}{a.patient?.givenName}
                </option>
              ))}
            </select>
            {/* 교대 필터 — 활력징후 탭과 동일 패턴 */}
            {admissionId && (['ALL', 'DAY', 'EVENING', 'NIGHT'] as const).map((key) => (
              <button key={key} onClick={() => setShiftFilter(key)}
                className={`px-2 py-1 text-[10px] font-bold rounded ${shiftFilter === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {key === 'ALL' ? <T k="전체" /> : key}
              </button>
            ))}
          </div>
          <button onClick={() => setShowModal(true)} aria-keyshortcuts={ariaKeyshortcuts('alt+a')}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors">
            + <T k="새 기록" /> <kbd className="ml-1 text-[9px] font-semibold bg-white/20 rounded px-1 py-0.5">{comboLabel('alt+a')}</kbd>
          </button>
        </div>

        {admissionId && <div className="px-5 pt-2"><LateEntryRuleNote grace={lateGrace} /></div>}
        {!admissionId ? (
          <EmptyState compact icon="🩺" title="환자를 선택하면 간호 기록이 교대별 시간축으로 표시됩니다." />
        ) : notesIsError ? (
          <div className="p-4"><QueryErrorFallback error={notesError} onRetry={refetchNotes} size="compact" /></div>
        ) : isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-gray-50 rounded-lg animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🩺" title={shiftFilter === 'ALL' ? '간호 기록이 없습니다.' : `${shiftFilter} 근무 기록이 없습니다.`} />
        ) : (
          <div className="px-5 py-3">
            {days.map((day) => (
              <div key={day} className="mb-4 last:mb-0">
                <div className="sticky top-0 z-10 -mx-5 px-5 py-1 bg-gray-50/95 text-[11px] font-semibold text-gray-500"><KDate value={`${day}T12:00:00+09:00`} mode="dateWeekday" /></div>
                {byDate.get(day)!
                  .slice()
                  .sort((a, b) => (b.recordedAt ?? b.createdAt).localeCompare(a.recordedAt ?? a.createdAt))
                  .map((n) => <WardNoteRow key={n.id} note={n} />)}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <WardNoteModal
          admissions={admissions}
          initialAdmissionId={admissionId}
          onClose={() => setShowModal(false)}
          onSaved={(aid) => {
            setShowModal(false);
            setAdmissionId(aid);
            queryClient.invalidateQueries({ queryKey: ['ws-nursing-notes', aid] });
          }}
        />
      )}
    </>
  );
}

/** 정본 간호기록 행 — 교대·유형·우선순위 배지 + 유형별 본문 요약 */
function WardNoteRow({ note: n }: { note: WardNursingNote }) {
  const tAttr = useTAttr();
  const at = n.recordedAt ?? n.createdAt;
  const body: [string, string | undefined][] = n.noteType === 'DAR'
    ? [['Focus', n.focus], ['D', n.data], ['A', n.action], ['R', n.response]]
    : n.noteType === 'NARRATIVE'
      ? [['', n.content]]
      : [['S', n.subjective], ['O', n.objective], ['A', n.assessment], ['P', n.plan]];
  return (
    <div className="relative pl-14 py-2 border-l border-gray-100 ml-1.5">
      {/* 🔴 종전 `at.slice(11, 16)` 은 UTC 시각이라 9시간 어긋나게 보였다 */}
      <span className="absolute left-3 top-2.5 text-[10px] tabular-nums text-gray-400">{fmtTime(at)}</span>
      <span className="absolute -left-[3px] top-3.5 w-1.5 h-1.5 rounded-full bg-blue-300" />
      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{n.noteType ?? 'SOAP'}</span>
        {n.shiftType && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{n.shiftType}</span>}
        {n.priority && n.priority !== 'NORMAL' && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">{n.priority}</span>
        )}
        {n.status === 'DRAFT' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">미서명</span>}
        {n.lateEntry && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700" title={tAttr('기록 시각의 근무조가 끝난 뒤에 작성된 기록')}>
            <T k="늦은 기록" />
          </span>
        )}
        {n.nurse && <StaffName familyName={n.nurse.familyName} givenName={n.nurse.givenName} className="text-[11px] text-gray-400" />}
      </div>
      <div className="grid gap-0.5 text-xs text-gray-600">
        {body.filter(([, v]) => !!v?.trim()).map(([label, v]) => (
          <p key={label} className="line-clamp-2">
            {label && <span className="font-semibold text-gray-400 mr-1">{label}</span>}{v}
          </p>
        ))}
      </div>
    </div>
  );
}

/** 빠른 작성 — 유형 3종(타블렛과 동일 필드맵)·교대 자동·자주 쓰는 문구 칩·정본 저장(작성=서명) */
const WARD_NOTE_FIELDS: Record<'SOAP' | 'DAR' | 'NARRATIVE', { key: WardNoteFieldKey; label: string; ph: string }[]> = {
  SOAP: [
    { key: 'subjective', label: 'S 주관적 호소', ph: '환자 호소·표현...' },
    { key: 'objective', label: 'O 객관적 관찰', ph: '관찰·측정 소견...' },
    { key: 'assessment', label: 'A 간호 판단', ph: '간호 판단...' },
    { key: 'plan', label: 'P 간호 계획', ph: '계획·중재 예정...' },
  ],
  DAR: [
    { key: 'focus', label: 'Focus 초점', ph: '문제/초점 (예: 통증)' },
    { key: 'data', label: 'D 자료', ph: '주관·객관 자료...' },
    { key: 'action', label: 'A 간호중재', ph: '수행한 중재...' },
    { key: 'response', label: 'R 반응/평가', ph: '환자 반응·평가...' },
  ],
  NARRATIVE: [{ key: 'content', label: '서술 기록', ph: '시간 순 서술...' }],
};
type WardNoteFieldKey = 'subjective' | 'objective' | 'assessment' | 'plan' | 'focus' | 'data' | 'action' | 'response' | 'content';

/** 자주 쓰는 문구 기본값 — 사용자 정의(P1-6)는 이 위에 얹힌다(브라우저 단위 저장) */
const DEFAULT_QUICK_PHRASES: { field: WardNoteFieldKey; text: string }[] = [
  { field: 'objective', text: '활력징후 안정.' },
  { field: 'objective', text: '수면 양호, 특이 호소 없음.' },
  { field: 'objective', text: '식이 섭취 양호.' },
  { field: 'action', text: '처방된 투약 시행함.' },
  { field: 'action', text: '체위변경 시행함.' },
  { field: 'plan', text: '지속 관찰 예정.' },
];
const PHRASES_LS_KEY = 'nursing.quickPhrases.v1';

/** 사용자 정의 문구(P1-6) — 이 단말·이 브라우저 단위(서버 프로필 필요성이 실증되면 승격) */
function loadQuickPhrases(): { field: WardNoteFieldKey; text: string }[] {
  try {
    const raw = localStorage.getItem(PHRASES_LS_KEY);
    if (!raw) return DEFAULT_QUICK_PHRASES;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_QUICK_PHRASES;
    return arr.filter((p) => p && typeof p.text === 'string' && p.text.trim() && typeof p.field === 'string').slice(0, 30);
  } catch { return DEFAULT_QUICK_PHRASES; }
}



function WardNoteModal({
  admissions, initialAdmissionId, onClose, onSaved,
}: {
  admissions: Admission[];
  initialAdmissionId?: string;
  onClose: () => void;
  onSaved: (admissionId: string) => void;
}) {
  const tAttr = useTAttr();
  // 🔴 (2026-09-30) 종전엔 목록 첫 환자로 시작해 **환자를 고르지 않고 저장하면 엉뚱한 환자에** 기록됐다 — 쓰기 폼은 미선택으로
  const [admissionId, setAdmissionId] = useState(initialAdmissionId || '');
  const [noteType, setNoteType] = useState<'SOAP' | 'DAR' | 'NARRATIVE'>('SOAP');
  const shiftBoundaries = useShiftBoundaries();
  const [shiftType, setShiftType] = useState<'DAY' | 'EVENING' | 'NIGHT'>(() => shiftOf(new Date(), shiftBoundaries));
  // 관찰 시각 — 비우면 지금. 지난 근무조의 일을 적으면 근무조가 따라가고, 서버는 '늦은 기록'으로 표식한다(막지 않는다)
  const [observedAt, setObservedAt] = useState('');
  const observedDate = observedAt ? new Date(observedAt) : null;
  const observedValid = !observedDate || (!Number.isNaN(observedDate.getTime()) && observedDate.getTime() <= Date.now() + 5 * 60_000);
  const lateGrace = useLateEntryGrace();
  const willBeLate = !!observedDate && observedValid && isLateNursingEntry(observedDate, new Date(), shiftBoundaries, lateGrace.graceMinutes);
  const [urgent, setUrgent] = useState(false);
  const [form, setForm] = useState<Partial<Record<WardNoteFieldKey, string>>>({});
  // P1-6 문구 커스텀 — 편집 모드에서 삭제/추가, 브라우저 저장
  const [phrases, setPhrases] = useState(loadQuickPhrases);
  const [editPhrases, setEditPhrases] = useState(false);
  const [newPhrase, setNewPhrase] = useState('');
  const [newPhraseField, setNewPhraseField] = useState<WardNoteFieldKey>('objective');
  const savePhrases = (next: { field: WardNoteFieldKey; text: string }[]) => {
    setPhrases(next);
    try { localStorage.setItem(PHRASES_LS_KEY, JSON.stringify(next)); } catch { /* 저장 실패=세션 한정 */ }
  };
  // P1-5 QA 점검 — 서버 nursingNoteQaContent(비활성이면 안내만)
  const [qa, setQa] = useState<{ score?: number; grade?: string; issues?: { level: string; message: string }[]; enabled?: boolean; failed?: boolean } | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const runQa = async () => {
    setQaLoading(true);
    try {
      const r = await apiClient.post<{ data: { enabled?: boolean; score?: number; grade?: string; issues?: { level: string; message: string }[] } }>(
        `/api/v1/admissions/${admissionId}/nursing-notes/qa-check`, { noteType, ...form });
      const d = (r.data as { data?: typeof r.data })?.data ?? r.data;
      setQa(d ?? {});
    } catch {
      // 🔴 (2026-09-30) 종전엔 요청 실패를 "QA 점검이 비활성 상태입니다"로 말했다 — 실패는 실패다
      setQa({ failed: true });
    }
    setQaLoading(false);
  };

  const fields = WARD_NOTE_FIELDS[noteType];
  const hasContent = fields.some((f) => (form[f.key] ?? '').trim());
  const append = (field: WardNoteFieldKey, text: string) =>
    setForm((prev) => ({ ...prev, [field]: [prev[field]?.trim(), text].filter(Boolean).join(' ') }));

  const save = useMutation({
    // 정본 저장(작성=서명·보드 최근기록/미서명에 즉시 반영). 유형 전환 잔여 필드는 보내지 않는다.
    mutationFn: () => apiClient.post(`/api/v1/admissions/${admissionId}/nursing-notes`, {
      noteType, shiftType, ...(urgent ? { priority: 'URGENT' } : {}),
      ...(observedDate ? { recordedAt: observedDate.toISOString() } : {}),
      ...Object.fromEntries(fields.map((f) => [f.key, form[f.key]]).filter(([, v]) => (v as string | undefined)?.trim())),
    }),
    onSuccess: () => { toast.success(tAttr('간호 기록이 저장되었습니다.')); onSaved(admissionId); },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('간호 기록 저장에 실패했습니다.')),
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900"><T k="새 간호 기록" /></h3>
          <button onClick={onClose} aria-label="닫기" className="p-1 text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}
            className="flex-1 min-w-[10rem] px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="">{tAttr('— 환자 선택 —')}</option>
            {admissions.map((a) => (
              <option key={a.id} value={a.id}>{a.patient?.familyName}{a.patient?.givenName} — {a.bed?.roomNumber ?? '-'}호</option>
            ))}
          </select>
          {(['SOAP', 'DAR', 'NARRATIVE'] as const).map((t) => (
            <button key={t} onClick={() => setNoteType(t)}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border ${noteType === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {t === 'NARRATIVE' ? '서술' : t}
            </button>
          ))}
          <select value={shiftType} onChange={(e) => setShiftType(e.target.value as typeof shiftType)}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" aria-label="근무조">
            <option value="DAY">DAY</option><option value="EVENING">EVENING</option><option value="NIGHT">NIGHT</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> 긴급
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <label className="flex items-center gap-1.5 text-gray-600">
            <T k="관찰 시각" />
            <input type="datetime-local" value={observedAt}
              onChange={(e) => {
                setObservedAt(e.target.value);
                const d = e.target.value ? new Date(e.target.value) : new Date();
                if (!Number.isNaN(d.getTime())) setShiftType(shiftOf(d, shiftBoundaries));
              }}
              className="px-2 py-1 border border-gray-200 rounded-lg" aria-label={tAttr('관찰 시각')} />
          </label>
          {!observedAt && <span className="text-gray-400"><T k="비우면 지금 시각으로 기록합니다" /></span>}
          {observedAt && <button type="button" onClick={() => { setObservedAt(''); setShiftType(shiftOf(new Date(), shiftBoundaries)); }} className="text-blue-600 hover:underline"><T k="지금으로" /></button>}
          {!observedValid && <span className="text-rose-600"><T k="미래 시각은 기록할 수 없습니다" /></span>}
          {willBeLate && <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700"><T k="근무조가 끝난 뒤의 기록 — '늦은 기록'으로 표시됩니다" /></span>}
          {observedAt && <LateEntryRuleNote grace={lateGrace} />}
        </div>

        {/* AI 초안(P1-5) — 타블렛과 같은 공용 패널. 적용 후 검토·수정은 사람 몫 */}
        {admissionId && (
          <div className="mb-3">
            <NursingAiDraftPanel admissionId={admissionId} noteType={noteType}
              onApply={(draft) => {
                const next: Partial<Record<WardNoteFieldKey, string>> = {};
                for (const [k, v] of Object.entries(draft)) if (v) next[k as WardNoteFieldKey] = v;
                setForm((f) => ({ ...f, ...next }));
              }} />
          </div>
        )}

        {/* 자주 쓰는 문구 — 현재 유형에 있는 필드만 노출·[편집]으로 커스텀(P1-6) */}
        <div className="flex flex-wrap items-center gap-1 mb-3">
          {phrases.filter((q) => fields.some((f) => f.key === q.field)).map((q, i) => (
            <span key={`${q.field}:${q.text}`} className="inline-flex items-center">
              <button type="button" onClick={() => append(q.field, q.text)}
                className="px-2 py-1 text-[11px] rounded-full bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-700">
                + {q.text}
              </button>
              {editPhrases && (
                <button type="button" aria-label="문구 삭제"
                  onClick={() => savePhrases(phrases.filter((p) => !(p.field === q.field && p.text === q.text)))}
                  className="ml-0.5 text-[11px] text-rose-500 hover:text-rose-700">✕</button>
              )}
            </span>
          ))}
          <button type="button" onClick={() => setEditPhrases((v) => !v)}
            className={`px-2 py-1 text-[11px] rounded-full border ${editPhrases ? 'border-blue-400 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-400 hover:text-gray-600'}`}>
            {editPhrases ? '완료' : '✎ 편집'}
          </button>
        </div>
        {editPhrases && (
          <div className="flex gap-1.5 mb-3">
            <select value={newPhraseField} onChange={(e) => setNewPhraseField(e.target.value as WardNoteFieldKey)}
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white" aria-label="문구 대상 필드">
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <input value={newPhrase} onChange={(e) => setNewPhrase(e.target.value)} placeholder="새 문구…"
              className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
            <button type="button" disabled={!newPhrase.trim()}
              onClick={() => { savePhrases([...phrases, { field: newPhraseField, text: newPhrase.trim() }]); setNewPhrase(''); }}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg disabled:opacity-40"><T k="추가" /></button>
          </div>
        )}

        <div className="space-y-2.5">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
              <textarea value={form[f.key] ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                rows={noteType === 'NARRATIVE' ? 6 : 2} placeholder={f.ph}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y" />
            </div>
          ))}
        </div>

        {/* QA 점검 결과(P1-5) — 차단이 아니라 조언(저장 판단은 간호사) */}
        {qa && (
          <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${qa.failed ? 'bg-rose-50' : qa.enabled === false ? 'bg-gray-50 text-gray-500' : (qa.issues?.length ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700')}`}>
            {qa.failed ? <span className="text-rose-700"><T k="QA 점검 요청에 실패했습니다 — 저장에는 영향이 없습니다." /></span> : qa.enabled === false ? 'QA 점검이 비활성 상태입니다(관리 설정).' : (
              <>
                <span className="font-semibold">QA {qa.grade ?? ''}{qa.score != null ? ` · ${qa.score}점` : ''}</span>
                {(qa.issues ?? []).slice(0, 4).map((it, i) => <p key={i} className="mt-0.5">· {it.message}</p>)}
                {!qa.issues?.length && <span className="ml-1"><T k="지적 없음" /></span>}
              </>
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] text-gray-400">저장과 동시에 서명됩니다(정정은 기록 화면에서 AMENDED 로).</p>
        <div className="mt-2 flex gap-2">
          <button onClick={runQa} disabled={!admissionId || !hasContent || qaLoading}
            className="px-4 py-2.5 bg-violet-50 text-violet-700 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-violet-100 whitespace-nowrap">
            {qaLoading ? '점검 중…' : 'QA 점검'}
          </button>
          <button onClick={() => save.mutate()} disabled={!admissionId || !hasContent || !observedValid || save.isPending}
            className="min-h-[44px] flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-blue-700">
            {save.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 6: 병동 보드 (Ward Board)
   ═══════════════════════════════════════════════════════════════ */

function WardBoardTab({ admissions, wardId }: { admissions: Admission[]; wardId: string }) {
  const tAttr = useTAttr();
  const { data: bedsData, isLoading, isError: bedsIsError, error: bedsError, refetch: refetchBeds } = useQuery({
    queryKey: ['beds-list', wardId],
    // 선택한 병동만(종전엔 병동 필터를 무시하고 병원 전 병상을 그렸다)
    queryFn: () => apiClient.get<{ data: BedInfo[] }>(`/api/v1/beds/list${wardId ? `?wardId=${wardId}` : ''}`),
  });

  const beds = bedsData?.data ?? [];

  const admissionByBedId = useMemo(() => {
    const map: Record<string, Admission> = {};
    for (const a of admissions) if (a.bed?.id) map[a.bed.id] = a;
    return map;
  }, [admissions]);

  // 병동 → 호실로 묶는다(여러 병동의 같은 호실 번호가 한 칸에 섞이지 않게)
  const rooms = useMemo(() => {
    const map = new Map<string, { ward: string; room: string; beds: BedInfo[] }>();
    for (const bed of beds) {
      const ward = bed.ward?.name ?? '';
      const room = bed.roomNumber ?? '-';
      const key = `${ward}\u0000${room}`;
      if (!map.has(key)) map.set(key, { ward, room, beds: [] });
      map.get(key)!.beds.push(bed);
    }
    return [...map.values()].sort((a, b) => a.ward.localeCompare(b.ward) || a.room.localeCompare(b.room, undefined, { numeric: true }));
  }, [beds]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-700"><T k="병동 보드" /></p>
      </div>
      {bedsIsError ? (
        <QueryErrorFallback error={bedsError} onRetry={refetchBeds} />
      ) : isLoading ? (
        <div className="p-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 bg-gray-50 rounded-xl animate-pulse" />)}
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState icon="🛏️" title="병상 정보가 없습니다." />
      ) : (
        <div className="p-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
          {rooms.map(({ ward, room, beds: roomBeds }) =>
            roomBeds.map((bed) => {
              const adm = admissionByBedId[bed.id] ?? null;
              // 점유 여부는 병상 상태가 정본 — 화면 목록에 환자가 없다고 빈 병상으로 말하지 않는다
              const occupied = bed.status === 'OCCUPIED';
              const risk = adm ? riskLevel(adm) : 'NONE';
              return (
                <div
                  key={bed.id}
                  className={`rounded-xl border p-4 transition-colors ${occupied ? 'border-gray-200 bg-white hover:shadow-md' : 'border-dashed border-gray-200 bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-gray-900">
                      {!wardId && ward && <span className="mr-1 text-[10px] font-medium text-gray-400">{ward}</span>}
                      {room}호 {bed.bedNumber}
                    </span>
                    {adm && <span aria-label={riskWord(risk)} title={riskWord(risk)}
                      className={`w-2.5 h-2.5 rounded-full ${RISK_DOT[risk] ?? 'bg-gray-300'}`} />}
                  </div>
                  {occupied && adm ? (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-800">{patientName(adm.patient)}</p>
                      <p className="text-[10px] text-gray-400 line-clamp-1">{adm.admitReason ?? '-'}</p>
                      <p className="text-[10px] text-gray-400">
                        {stayDayOf(adm) != null ? <Tf k="입원 {일차}일차" params={{ 일차: stayDayOf(adm)! }} /> : <T k="입원 일차 미상" />} | {adm.attendingDoctor ? `${adm.attendingDoctor.familyName ?? ''}${adm.attendingDoctor.givenName ?? ''}` : '-'}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {risk === 'HIGH' && <span className="whitespace-nowrap text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium">낙상HIGH</span>}
                        {adm.nursingAssessment?.pressureUlcerRisk === 'HIGH' && <span className="whitespace-nowrap text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">욕창HIGH</span>}
                      </div>
                    </div>
                  ) : occupied ? (
                    <p className="text-xs text-gray-500" title={tAttr('병상은 사용 중인데 재원 목록에서 환자를 찾지 못했습니다')}><T k="사용 중 — 환자 정보 없음" /></p>
                  ) : bed.status === 'AVAILABLE' ? (
                    <p className="text-xs text-gray-400"><T k="빈 병상" /></p>
                  ) : (
                    <p className="text-xs text-gray-400"><Tf k="사용 불가({상태})" params={{ 상태: bed.status }} /></p>
                  )}
                </div>
              );
            }),
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════════ */

export default function NurseStationPage() {
  const { user } = useAuthStore();
  const tAttr = useTAttr();
  const isNurse = user?.role === 'NURSE';
  const [activeTab, setActiveTab] = useState<TabKey>('patients');
  const [selectedWardId, setSelectedWardId] = useState<string>('');
  const [autoSelected, setAutoSelected] = useState(false);
  const [myPatientsOnly, setMyPatientsOnly] = useState(false);
  const [defaultSet, setDefaultSet] = useState(false);

  // Fetch ward list for filter
  const { data: wardsData, isError: wardsIsError, error: wardsError, refetch: refetchWards } = useQuery({
    queryKey: ['wards-list'],
    queryFn: () =>
      apiClient.get<{ data: { id: string; name: string; floor: number }[] }>('/api/v1/beds/wards'),
  });
  const wards: WardOption[] = (wardsData?.data ?? []).map((w) => ({ id: w.id, name: w.name }));

  // 로그인 간호사 부서 기반 병동 자동 선택
  useEffect(() => {
    if (autoSelected || !user?.department || wards.length === 0) return;
    const match = wards.find((w) => w.name.includes(user.department!));
    if (match) {
      setSelectedWardId(match.id);
    }
    setAutoSelected(true);
  }, [user, wards, autoSelected]);

  // 내 담당 환자 배정 목록 (항상 조회)
  const { data: myAssignData, isError: myAssignIsError, error: myAssignError, refetch: refetchMyAssign } = useQuery({
    queryKey: ['nurse-assignments-my'],
    queryFn: () => apiClient.get<{ data: { admissionId: string }[] }>('/api/v1/nurse-station/assignments/my'),
  });
  const myAssignments = myAssignData?.data ?? [];
  const myAdmissionIds = new Set(myAssignments.map(a => a.admissionId));

  // 간호사 로그인 시 배정이 있으면 자동으로 "내 담당" 모드
  useEffect(() => {
    if (defaultSet || !isNurse) return;
    if (myAssignments.length > 0) setMyPatientsOnly(true);
    setDefaultSet(true);
  }, [isNurse, myAssignments, defaultSet]);

  // Fetch active admissions (inpatients) — filtered by ward
  const { data: admissionsData, isLoading: admLoading, isError: admError, error: admErrorData, refetch: refetchAdmissions } = useQuery({
    queryKey: ['active-admissions', selectedWardId],
    queryFn: () => {
      const params = selectedWardId ? `?wardId=${selectedWardId}` : '';
      return apiClient.get<{ data: Admission[] }>(`/api/v1/admissions/active/list${params}`);
    },
    refetchInterval: pollMs('normal'),
  });

  const allAdmissions: Admission[] = admissionsData?.data ?? [];
  const admissions = myPatientsOnly ? allAdmissions.filter(a => myAdmissionIds.has(a.id)) : allAdmissions;

  // Stats calculations
  const totalPatients = admissions.length;
  const highRiskCount = admissions.filter((a) => riskLevel(a) === 'HIGH').length;
  const pressureHighCount = admissions.filter((a) => a.nursingAssessment?.pressureUlcerRisk === 'HIGH').length;
  const totalPendingMeds = admissions.reduce((sum, a) => sum + (a.pendingMedCount ?? 0), 0);
  const totalCarriedMeds = admissions.reduce((sum, a) => sum + (a.carriedOverMedCount ?? 0), 0);
  // 근무조 마감 → 인계 작성으로 넘길 환자
  const [handoffAdmissionId, setHandoffAdmissionId] = useState('');

  if (admError) return <QueryErrorFallback error={admErrorData} onRetry={refetchAdmissions} />;

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="간호 워크스테이션" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="병동 간호 업무 통합 관리" /></p>
        </div>
        <div className="flex items-center gap-3">
          {/* 내 담당만 토글 — 배정 조회가 실패하면 개수를 0 으로 말하지 않는다 */}
          {myAssignIsError ? (
            <QueryErrorFallback error={myAssignError} onRetry={refetchMyAssign} size="compact" />
          ) : (
            <button onClick={() => setMyPatientsOnly(f => !f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${myPatientsOnly ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {myPatientsOnly ? <>👤 <Tf k="내 담당 ({명수})" params={{ 명수: myAdmissionIds.size }} /></> : <>👥 <T k="전체" /></>}
            </button>
          )}
          {/* Ward filter — 병동 목록 조회 실패를 "병동 없음"으로 말하지 않는다 */}
          {wardsIsError ? (
            <QueryErrorFallback error={wardsError} onRetry={refetchWards} size="compact" />
          ) : (
            <select
              value={selectedWardId}
              onChange={(e) => setSelectedWardId(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{tAttr('전체 병동')}</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {admLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 animate-pulse">
              <div className="h-4 w-20 bg-gray-100 rounded mb-3" />
              <div className="h-8 w-12 bg-gray-100 rounded" />
            </div>
          ))
        ) : (
          <>
            <StatCard label={<T k="입원 환자" />} value={totalPatients} color="blue" />
            <StatCard label={<T k="낙상 위험" />} value={highRiskCount} color="rose" />
            <StatCard label={<T k="욕창 위험" />} value={pressureHighCount} color="amber" />
            <StatCard label={<T k="오늘 투약 대기" />} value={totalPendingMeds} color="green" />
            <StatCard label={<T k="지난 미기록 투약" />} value={totalCarriedMeds} color={totalCarriedMeds > 0 ? 'rose' : 'green'} />
          </>
        )}
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-6 overflow-hidden">
        <div className="flex overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 min-w-[100px] py-3 text-sm font-medium text-center transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'text-blue-700 border-b-2 border-blue-600 bg-blue-50/50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <T k={tab.label} />
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'patients' && <MyPatientsTab admissions={admissions} myAdmissionIds={myAdmissionIds} />}
      {activeTab === 'mar' && <MARTab admissions={admissions} />}
      {activeTab === 'vitals' && <VitalsTab admissions={admissions} />}
      {activeTab === 'io' && <IOTab admissions={admissions} />}
      {/* 통증 재평가 — 원내 규정대로 서버가 판정(2026-10-26) · 지금 보는 범위(병동·내 담당)로 거른다 */}
      {activeTab === 'pain' && <PainReassessTab scopeAdmissionIds={new Set(admissions.map((a) => a.id))} onRecordVitals={() => setActiveTab('vitals')} />}
      {activeTab === 'notes' && <NotesTab admissions={admissions} />}
      {activeTab === 'handoff' && <HandoffTab admissions={admissions} initialAdmissionId={handoffAdmissionId} />}
      {activeTab === 'closeout' && <ShiftCloseoutTab onWriteHandoff={(id) => { setHandoffAdmissionId(id); setActiveTab('handoff'); }} />}
      {/* 병동 보드는 병상 전체를 그린다 — '내 담당만'이어도 남의 환자 병상을 빈 병상으로 그리지 않게 전체 재원 목록을 넘긴다 */}
      {activeTab === 'ward' && <WardBoardTab admissions={allAdmissions} wardId={selectedWardId} />}
    </div>
  );
}
/* ═══════════════════════════════════════════════════════════════
   Tab 6: 인계(상·하번) — nurse-workstation-notes-handoff.plan.md
   기존 ClinicalHandoff(I-PASS·acknowledge)·AI SBAR 초안 EP 재사용(모델 신설 없음).
   하번=환자별 인계 작성(AI 초안→확정→인수자 지정) · 상번=받은 인계 확인(acknowledge).
   ═══════════════════════════════════════════════════════════════ */

/** 간호 교대 인계인가 — 🔴 종류 문자열 하나로 보지 않는다(간호사 인계 111건이 SHIFT_CHANGE 라 "담당 인수" 단추를 못 받았다) · 서버 판정 우선 */
const isNursingShift = (h: { kind?: HandoffKind; type?: string }) => (h.kind ? h.kind === 'NURSING_SHIFT' : h.type === 'NURSING_SHIFT');

interface HandoffRow {
  id: string;
  type?: string;
  /** 서버 판정 종류(종류 + 보낸 사람 직종) — 옛 서버면 없음(그때는 종류 문자열로) */
  kind?: HandoffKind;
  summary?: string;
  createdAt: string;
  acknowledgedAt?: string | null;
  patient?: { id?: string; familyName?: string; givenName?: string; mrn?: string };
  fromDoctor?: { familyName?: string; givenName?: string };
  toDoctor?: { familyName?: string; givenName?: string };
  pendingItems?: Record<string, unknown> | null;
  admissionId?: string | null;
}

function HandoffTab({ admissions, initialAdmissionId }: { admissions: Admission[]; initialAdmissionId?: string }) {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const shiftBoundaries = useShiftBoundaries();
  const [admissionId, setAdmissionId] = useState(initialAdmissionId ?? '');
  const [toUserId, setToUserId] = useState('');
  const [summary, setSummary] = useState('');
  const [pendingText, setPendingText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const selected = admissions.find((a) => a.id === admissionId) ?? null;

  // 상번 — 내게 온 미확인 인계
  const pendingQ = useQuery({
    queryKey: ['handoffs-pending'],
    queryFn: () => apiClient.get<{ data: HandoffRow[] | { data: HandoffRow[] } }>('/api/v1/handoffs/pending'),
    refetchInterval: pollMs('normal'),
  });
  // 🔴 이중 래핑 — 서비스가 {data:[…]} 를 반환하고 컨트롤러가 또 {data:…} 로 싼다(접수 이중래핑과 동일 패턴)
  const _pendingRaw = pendingQ.data?.data;
  const pending: HandoffRow[] = Array.isArray(_pendingRaw) ? _pendingRaw : _pendingRaw?.data ?? [];

  // 인수자 후보 — 간호사 목록(선례: blood-bank 워크스테이션)
  const nursesQ = useQuery({
    queryKey: ['nurse-list'],
    queryFn: () => apiClient.get<{ data: { id: string; familyName?: string; givenName?: string }[] }>('/api/v1/users?role=NURSE&limit=50'),
    staleTime: 5 * 60 * 1000,
  });
  const nurses = nursesQ.data?.data ?? [];

  // 다음 교대 근무자 제안(P1-4) — 근무표 기반. 미작성이면 빈 배열이라 전체 목록만 보인다(fail-open)
  const nextShiftQ = useQuery({
    queryKey: ['handoff-next-shift-nurses'],
    queryFn: () => apiClient.get<{ data: { nextShift: string; entries: { staffId: string; staffName: string; department?: string }[] } }>('/api/v1/handoffs/next-shift-nurses'),
    staleTime: 60_000,
  });
  const _nextRaw = nextShiftQ.data?.data as { nextShift?: string; entries?: { staffId: string; staffName: string }[] } | { data?: { nextShift?: string; entries?: { staffId: string; staffName: string }[] } } | undefined;
  const nextShiftData = (_nextRaw && 'entries' in _nextRaw ? _nextRaw : (_nextRaw as { data?: { nextShift?: string; entries?: { staffId: string; staffName: string }[] } })?.data) ?? {};
  const suggested = nextShiftData.entries ?? [];
  const suggestedIds = new Set(suggested.map((e) => e.staffId));
  const SHIFT_KO: Record<string, string> = { DAY: '주간', EVENING: '초번', NIGHT: '야간' };

  /**
   * 인수 확인 ↔ 담당 인수 방식 — 원내 규정(`/admin/nursing-rules` · 2026-10-26).
   *  · OFFER_BOTH(코드 기본값): 간호 교대 인계에 두 단추 · ALWAYS_BUNDLED: 인수 확인 = 담당 인수(서버가 함께 · 응답이 결과를 말한다)
   *  · SEPARATE: 인수 확인만 · 🔴 방식을 모르면(조회 실패·로딩) 인수 확인만 — 짐작으로 담당을 옮기지 않는다
   */
  const rulesQ = useNursingRules();
  const ackMode = rulesQ.data?.handoffAckMode?.mode ?? null;
  const ackModeSource = rulesQ.data?.handoffAckMode?.source ?? null;
  const ack = useMutation({
    // 응답은 이중 봉투({data:{data:…}}) — 한 겹이어도 읽는다
    mutationFn: async (id: string) => unwrapData<{ takeOver?: { done: boolean; reason: string | null; mode: string | null } | null }>(await apiClient.patch(`/api/v1/handoffs/${id}/acknowledge`))?.takeOver ?? null,
    onSuccess: (takeOver) => {
      if (takeOver?.mode === 'ALWAYS_BUNDLED' && takeOver.done) toast.success(tAttr('인수 확인 — 담당을 넘겨받았습니다.'));
      else if (takeOver?.mode === 'ALWAYS_BUNDLED' && takeOver.reason !== 'ALREADY_ACKNOWLEDGED') toast.warning(tAttr('인수 확인은 기록됐지만 담당 인수는 하지 않았습니다 — 환자 목록에서 “내가 담당”을 눌러 주세요.'));
      else toast.success(tAttr('인수 확인했습니다.'));
      queryClient.invalidateQueries({ queryKey: ['handoffs-pending'] });
      queryClient.invalidateQueries({ queryKey: ['nurse-assignments-my'] });
      queryClient.invalidateQueries({ queryKey: ['nurse-assignment-adm'] });
    },
    onError: () => toast.error(tAttr('인수 확인에 실패했습니다.')),
  });
  /**
   * 상번 — 인수 확인 + 담당 인수(2026-09-30). 인계만 확인하고 담당은 하번 이름으로 남아 "내 담당"이 비던 것.
   * 확인이 먼저다 — 확인이 실패하면 담당도 넘기지 않는다. 담당 인수가 실패하면 확인은 남았다고 그대로 말한다.
   */
  const ackAndTakeOver = useMutation({
    mutationFn: async (h: HandoffRow) => {
      await apiClient.patch(`/api/v1/handoffs/${h.id}/acknowledge`);
      try {
        await apiClient.post('/api/v1/nurse-station/assignments/take-over', { admissionId: h.admissionId, shiftType: shiftOf(new Date(), shiftBoundaries) });
        return { tookOver: true };
      } catch (e) {
        return { tookOver: false, error: (e as { message?: string })?.message };
      }
    },
    onSuccess: (r) => {
      if (r.tookOver) toast.success(tAttr('인수 확인 — 담당을 넘겨받았습니다.'));
      else toast.warning(tAttr('인수 확인은 기록됐지만 담당 인수에 실패했습니다 — 환자 목록에서 “내가 담당”을 눌러 주세요.'));
      queryClient.invalidateQueries({ queryKey: ['handoffs-pending'] });
      queryClient.invalidateQueries({ queryKey: ['nurse-assignments-my'] });
      queryClient.invalidateQueries({ queryKey: ['nurse-assignment-adm'] });
      queryClient.invalidateQueries({ queryKey: ['nurse-shift-closeout'] });
    },
    onError: () => toast.error(tAttr('인수 확인에 실패했습니다.')),
  });

  // AI SBAR 초안 — 결정적·근거기반(F-3). 실패해도 수기 작성은 그대로 가능(비차단).
  const draftFromAi = async () => {
    if (!admissionId) return;
    setDrafting(true);
    try {
      const r = await apiClient.get<{ data: { sbar?: { situation?: string; background?: string; assessment?: string; recommendation?: string }; summary?: string } }>(
        `/api/v1/admissions/${admissionId}/ai-handoff-sbar`,
      );
      const d = r.data;
      const s = d?.sbar;
      const text = s
        ? ['S: ' + (s.situation ?? ''), 'B: ' + (s.background ?? ''), 'A: ' + (s.assessment ?? ''), 'R: ' + (s.recommendation ?? '')].join('\n')
        : (d?.summary ?? '');
      if (text.trim()) { setSummary(text); toast.success('AI 초안을 채웠습니다 — 검토 후 확정하세요.'); }
      else toast.info('초안 재료가 부족합니다 — 직접 작성해 주세요.');
    } catch {
      toast.error('AI 초안 생성에 실패했습니다 — 직접 작성해 주세요.');
    }
    setDrafting(false);
  };

  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/handoffs', {
      type: 'NURSING_SHIFT',
      patientId: selected?.patientId,
      admissionId,
      // 필드명은 의사 중심이지만 User FK — 간호사 인계에 그대로 쓴다(기획 결정)
      // 🔴 (2026-09-30) 인계자는 서버가 로그인 사용자로 정한다 — 화면이 보내던 fromDoctorId 는 뺐다(남의 이름으로 쓸 수 없게)
      toDoctorId: toUserId,
      summary,
      ...(pendingText.trim() ? { pendingItems: { items: pendingText.split('\n').map((s) => s.trim()).filter(Boolean) } } : {}),
    }),
    onSuccess: () => {
      toast.success(tAttr('인계를 등록했습니다 — 인수 간호사 확인 대기.'));
      setSummary(''); setPendingText(''); setToUserId('');
      queryClient.invalidateQueries({ queryKey: ['handoffs-pending'] });
      queryClient.invalidateQueries({ queryKey: ['nurse-shift-closeout'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('인계 등록에 실패했습니다.')),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 상번 — 받은 인계 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700"><T k="받은 인계 (상번 확인)" /></p>
            {ackMode && (
              <p className="text-[10px] text-gray-400" data-ack-mode={ackMode} data-ack-mode-source={ackModeSource}>
                <T k="인수 방식" />: <T k={HANDOFF_ACK_MODE_LABEL[ackMode]} />{ackModeSource === 'CODE_DEFAULT' && <> · <T k="코드 기본값 — 원내 규정 미설정" /></>}{ackModeSource === 'SEED' && <> · <T k="개발 시드 — 원내 규정 아님" /></>}
              </p>
            )}
          </div>
          {!pendingQ.isError && pending.length > 0 && <span className="text-xs font-bold text-rose-600">{pending.length}건 미확인</span>}
        </div>
        {/* 🔴 조회 실패를 "미확인 인계 없음"(✅)으로 말하지 않는다 */}
        {pendingQ.isError ? (
          <div className="px-5 py-4">
            <QueryErrorFallback error={pendingQ.error} onRetry={pendingQ.refetch} size="compact" />
          </div>
        ) : pending.length === 0 ? (
          <EmptyState compact icon="✅" title="미확인 인계가 없습니다." />
        ) : (
          <div className="divide-y divide-gray-50">
            {pending.map((h) => (
              <div key={h.id} className="px-5 py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-900">{h.patient?.familyName}{h.patient?.givenName}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{h.patient?.mrn}</span>
                    <StaffName familyName={h.fromDoctor?.familyName} givenName={h.fromDoctor?.givenName} suffix=" →" className="text-[11px] text-gray-500" />
                  </div>
                  <span className="text-[11px] text-gray-400"><KDate value={h.createdAt} mode="datetime" /></span>
                </div>
                <p className="text-xs text-gray-600 whitespace-pre-line line-clamp-4">{h.summary}</p>
                {!!(h.pendingItems as { items?: string[] } | null)?.items?.length && (
                  <ul className="mt-1 text-[11px] text-amber-700">
                    {((h.pendingItems as { items: string[] }).items).map((it, i) => <li key={i}>▫ {it}</li>)}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {ackMode === 'OFFER_BOTH' && isNursingShift(h) && h.admissionId && (
                    <button onClick={() => ackAndTakeOver.mutate(h)} disabled={ack.isPending || ackAndTakeOver.isPending}
                      title={tAttr('인수 확인과 함께 이 환자의 담당을 넘겨받습니다(이전 담당 간호사의 배정은 해제)')}
                      className="min-h-[44px] px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">
                      <T k="인수 확인 + 담당 인수" />
                    </button>
                  )}
                  <button onClick={() => ack.mutate(h.id)} disabled={ack.isPending || ackAndTakeOver.isPending}
                    className={`min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${ackMode === 'OFFER_BOTH' && isNursingShift(h) && h.admissionId ? 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                    {ackMode === 'ALWAYS_BUNDLED' && isNursingShift(h) && h.admissionId ? <T k="인수 확인 + 담당 인수" /> : <T k="인수 확인" />}
                  </button>
                  {isNursingShift(h) && h.admissionId && ackMode === 'SEPARATE' && (
                    <span className="text-[11px] text-gray-500" data-ack-mode-hint="SEPARATE"><T k="원내 규정: 담당은 환자 목록의 “내가 담당”으로 따로 넘겨받습니다." /></span>
                  )}
                  {isNursingShift(h) && h.admissionId && ackMode == null && (
                    <span className="text-[11px] text-gray-500" data-ack-mode-hint="UNKNOWN"><T k="인수 방식 규정을 확인하지 못해 인수 확인만 보여 줍니다." /></span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 하번 — 인계 작성 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-medium text-gray-700 mb-3"><T k="인계 작성 (하번)" /></p>
        <div className="flex flex-wrap gap-2 mb-2">
          <select value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}
            className="flex-1 min-w-[10rem] px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="">{tAttr('— 환자 선택 —')}</option>
            {admissions.map((a) => (
              <option key={a.id} value={a.id}>{a.bed?.roomNumber ?? '-'}호 · {a.patient?.familyName}{a.patient?.givenName}</option>
            ))}
          </select>
          <button onClick={draftFromAi} disabled={!admissionId || drafting}
            className="px-3 py-2 bg-violet-50 text-violet-700 rounded-lg text-xs font-semibold hover:bg-violet-100 disabled:opacity-40">
            {drafting ? '생성 중…' : '✦ AI SBAR 초안'}
          </button>
        </div>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={7}
          placeholder={'인계 요약 (SBAR 권장)\nS: 현재 상황\nB: 배경\nA: 판단\nR: 다음 근무 요청사항'}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y mb-2" />
        <textarea value={pendingText} onChange={(e) => setPendingText(e.target.value)} rows={2}
          placeholder="미결 항목 — 줄바꿈으로 구분 (예: 22시 혈당 재측정)"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs resize-y mb-2" />
        {/* 🔴 인수자 목록 조회 실패를 "간호사 없음"으로 말하지 않는다 */}
        {nursesQ.isError && (
          <QueryErrorFallback error={nursesQ.error} onRetry={nursesQ.refetch} size="compact" className="mb-2" />
        )}
        {!nursesQ.isError && nextShiftQ.isError && (
          <QueryErrorFallback error={nextShiftQ.error} onRetry={nextShiftQ.refetch} size="compact" className="mb-2" />
        )}
        <div className="flex gap-2">
          <select value={toUserId} onChange={(e) => setToUserId(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="">{tAttr('— 인수 간호사 —')}</option>
            {suggested.length > 0 && (
              <optgroup label={`★ 다음 교대(${SHIFT_KO[nextShiftData.nextShift ?? ''] ?? nextShiftData.nextShift}) 근무`}>
                {suggested.map((e) => <option key={e.staffId} value={e.staffId}>{e.staffName}</option>)}
              </optgroup>
            )}
            <optgroup label={suggested.length > 0 ? '전체 간호사' : '간호사'}>
              {nurses.filter((u) => !suggestedIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.familyName}{u.givenName}</option>)}
            </optgroup>
          </select>
          <button onClick={() => create.mutate()} disabled={!admissionId || !toUserId || !summary.trim() || create.isPending}
            className="min-h-[44px] px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-blue-700">
            {create.isPending ? <T k="등록 중…" /> : <T k="인계 등록" />}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">AI 초안은 근거 기반 참고용 — 확정 책임은 작성 간호사에게 있습니다.</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 7: 근무조 마감(하번) — 2026-09-30
   내 담당 환자별로 이번 근무조에 남긴 것(간호기록·활력·I/O·투약·인계)을 한 표로.
   🔴 기록 **유무만** 센다 — 충분한지 판정하지 않는다. 막지 않는다(줄어드는 목록).
   ═══════════════════════════════════════════════════════════════ */

interface CloseoutItem {
  assignmentId: string;
  admissionId: string;
  patient: { id: string; familyName?: string; givenName?: string; mrn?: string };
  bed?: { roomNumber?: string; bedNumber?: string; ward?: { name?: string } } | null;
  notes: { mine: number; total: number; myDrafts: number };
  vitals: number;
  io: number;
  meds: { dueSoFar: number; pending: number };
  handoff: { at: string; acknowledgedAt: string | null; to?: { familyName?: string; givenName?: string } | null } | null;
}
interface CloseoutData {
  shift: 'DAY' | 'EVENING' | 'NIGHT';
  start: string;
  end: string;
  assignments: number;
  items: CloseoutItem[];
  summary: { withoutMyNote: number; withoutVitals: number; pendingMeds: number; withoutHandoff: number };
}
const SHIFT_LABEL: Record<string, string> = { DAY: '주간', EVENING: '초번', NIGHT: '야간' };

function ShiftCloseoutTab({ onWriteHandoff }: { onWriteHandoff: (admissionId: string) => void }) {
  const tAttr = useTAttr();
  const q = useQuery({
    queryKey: ['nurse-shift-closeout'],
    queryFn: () => apiClient.get<{ data: CloseoutData }>('/api/v1/nursing/shift-closeout'),
    refetchInterval: pollMs('normal'),
  });
  const d = q.data?.data;

  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={q.refetch} />;
  if (q.isLoading || !d) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />)}
      </div>
    );
  }

  const cell = (ok: boolean, text: React.ReactNode) => (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${ok ? 'text-emerald-700' : 'text-rose-600 font-semibold'}`}>
      <span aria-hidden>{ok ? '●' : '○'}</span>{text}
    </span>
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-700">
            <T k="근무조 마감" /> · <T k={SHIFT_LABEL[d.shift] ?? d.shift} /> <span className="text-xs text-gray-400"><KDate value={d.start} mode="datetimeShort" /> ~ <KDate value={d.end} mode="time" /></span>
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5"><T k="이번 근무조에 남긴 기록이 있는지만 셉니다 — 충분한지는 판정하지 않습니다. 인계 전에 빈칸을 확인하세요." /></p>
        </div>
        {d.assignments > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700"><Tf k="내 기록 없음 {명수}명" params={{ 명수: d.summary.withoutMyNote }} /></span>
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700"><Tf k="활력 없음 {명수}명" params={{ 명수: d.summary.withoutVitals }} /></span>
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700"><Tf k="미기록 투약 {건수}건" params={{ 건수: d.summary.pendingMeds }} /></span>
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700"><Tf k="인계 미작성 {명수}명" params={{ 명수: d.summary.withoutHandoff }} /></span>
          </div>
        )}
      </div>
      {d.assignments === 0 ? (
        // 🔴 배정 0 을 "모두 완료"로 그리지 않는다 — 마감할 대상이 없다는 사실과 이유를 말한다
        <EmptyState compact icon="🗂️" title="담당으로 배정된 재원 환자가 없습니다." hint="환자 목록에서 “내가 담당”을 누르거나, 받은 인계에서 “담당 인수”를 누르면 여기에 나타납니다." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs">
                <th className="px-4 py-2.5 text-left font-medium"><T k="환자" /></th>
                <th className="px-4 py-2.5 text-left font-medium"><T k="간호기록" /></th>
                <th className="px-4 py-2.5 text-left font-medium"><T k="활력" /></th>
                <th className="px-4 py-2.5 text-left font-medium">I/O</th>
                <th className="px-4 py-2.5 text-left font-medium"><T k="투약" /></th>
                <th className="px-4 py-2.5 text-left font-medium"><T k="인계" /></th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {d.items.map((it) => (
                <tr key={it.assignmentId} className="align-top">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900">{patientName(it.patient)}</p>
                    <p className="text-[11px] text-gray-400">{it.bed?.ward?.name ?? ''} {it.bed?.roomNumber ?? '-'}호 {it.bed?.bedNumber ?? ''} · {it.patient.mrn ?? '-'}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {cell(it.notes.mine > 0, <Tf k="내 기록 {건수}건" params={{ 건수: it.notes.mine }} />)}
                    {it.notes.total > it.notes.mine && <p className="text-[10px] text-gray-400"><Tf k="다른 간호사 {건수}건" params={{ 건수: it.notes.total - it.notes.mine }} /></p>}
                    {it.notes.myDrafts > 0 && <p className="text-[10px] text-amber-700"><Tf k="미서명 {건수}건" params={{ 건수: it.notes.myDrafts }} /></p>}
                  </td>
                  <td className="px-4 py-2.5">{cell(it.vitals > 0, <Tf k="{건수}회" params={{ 건수: it.vitals }} />)}</td>
                  <td className="px-4 py-2.5"><span className="text-xs text-gray-600"><Tf k="{건수}건" params={{ 건수: it.io }} /></span></td>
                  <td className="px-4 py-2.5">
                    {it.meds.dueSoFar === 0
                      ? <span className="text-xs text-gray-400"><T k="이번 근무 예정 없음" /></span>
                      : cell(it.meds.pending === 0, <Tf k="미기록 {미기록}/{예정}" params={{ 미기록: it.meds.pending, 예정: it.meds.dueSoFar }} />)}
                  </td>
                  <td className="px-4 py-2.5">
                    {it.handoff ? (
                      <div className="text-xs">
                        {cell(true, <StaffName familyName={it.handoff.to?.familyName} givenName={it.handoff.to?.givenName} />)}
                        <p className="text-[10px] text-gray-400">{it.handoff.acknowledgedAt ? <T k="인수 확인됨" /> : <T k="인수 확인 대기" />}</p>
                      </div>
                    ) : cell(false, <T k="미작성" />)}
                  </td>
                  <td className="px-4 py-2.5 text-right space-y-1">
                    <Link href={`/inpatient/${it.admissionId}/nursing/notes`} className="block text-[11px] text-blue-600 hover:underline whitespace-nowrap"><T k="기록 화면" /></Link>
                    {it.meds.pending > 0 && <Link href={`/inpatient/${it.admissionId}/nursing/mar`} className="block text-[11px] text-blue-600 hover:underline whitespace-nowrap">MAR</Link>}
                    {!it.handoff && (
                      <button onClick={() => onWriteHandoff(it.admissionId)} title={tAttr('인계 작성 탭으로 이 환자를 골라 둡니다')}
                        className="min-h-[44px] px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 whitespace-nowrap">
                        <T k="인계 쓰기" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
