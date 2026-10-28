'use client';
import { useState, useMemo } from 'react';
import { portalDateText } from '../_shared/portal-date';
import { isCriticalFlag, isAbnormalFlag, AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { formatTemp } from '@/lib/vital-ranges';
import { Unit } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { apiClient } from '@/lib/api-client';
import type { PatientInfo, PortalData, MainTab, PortalItem, Appointment, Encounter, LabResult, Medication, Allergy, Billing, Questionnaire } from '../_types';
import { fmt, fmtTime, currency } from '../_helpers';
import { Icon, EmptyState } from '../_shared';
import { PT, usePortalTAttr } from '../_shared/PT';
import { ICONS } from '../_icons';
import OnboardingTour from './OnboardingTour';
import { usePortalOnboarding } from './onboarding-state';
import SelfCheckIn from './SelfCheckIn';
import { DrugExplainSheet } from '../_shared/DrugExplainSheet';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { splitAppointments } from '../_helpers';
import { mayCallAccountFeature, usePortalService } from '../_auth/session-check';

interface HomeTabProps {
  patient: PatientInfo;
  data: PortalData;
  onNavigate: (tab: MainTab, segment?: string) => void;
}

/** 응급 진행 카드 — 본인/가족 스코프(실명 담당의·베드·검사 진행). 재실 없으면 렌더 0 */
function ErStatusCard() {
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['portal-er-status'],
    queryFn: () => apiClient.get<{ data: {
      stages: string[]; arrivalAt: string; currentStage: number; careLabel: string | null;
      bed: string | null; doctorName: string | null; tests: { total: number; done: number } | null;
      dispositionLabel: string | null; completed: boolean;
    } | null }>('/api/v1/portal/er-status'),
    refetchInterval: 30_000,
  });
  const s = data?.data;
  // 🔴 (포털 A6) null = 응급실에 있지 않다(카드 없음) · 조회 실패는 그 사실이 아니다 — 받은 값이 없을 때만 실패로 그린다
  if (isError && !data) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />;
  if (!s) return null;
  return (
    <div className="rounded-2xl border-2 border-rose-200 bg-rose-50/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-rose-700">🏥 응급실 진행 상황</p>
        {s.bed && <span className="text-xs font-mono font-bold text-rose-600 bg-white rounded-lg px-2 py-0.5">{s.bed}</span>}
      </div>
      <div className="mt-3 flex items-center">
        {s.stages.map((label, i) => {
          const done = i < s.currentStage || (s.completed && i === s.stages.length - 1);
          const current = !s.completed && i === s.currentStage;
          return (
            <div key={i} className="flex items-center flex-1 min-w-0 last:flex-none">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${current ? 'bg-amber-400 animate-pulse' : done ? 'bg-emerald-500' : 'bg-gray-300'}`}
                title={label} />
              {i < s.stages.length - 1 && <div className={`flex-1 h-px mx-1 ${done ? 'bg-emerald-300' : 'bg-gray-200'}`} />}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-gray-700">
        <b>{s.completed && s.dispositionLabel ? `${s.dispositionLabel} 완료` : (s.careLabel ?? s.stages[s.currentStage])}</b>
        {s.tests && <span className="text-gray-500"> · 검사 {s.tests.done}/{s.tests.total} 완료</span>}
        {s.doctorName && <span className="text-gray-500"> · 담당의 {s.doctorName}</span>}
      </p>
    </div>
  );
}

const isToday = (d: string) => {
  const dt = new Date(d);
  const now = new Date();
  return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
};

// ── 카드 타입 정의 ──
interface CardItem {
  priority: number;
  key: string;
  render: () => React.ReactNode;
}

export default function HomeTab({ patient, data, onNavigate }: HomeTabProps) {
  const { appointments, encounters, labResults, diagnosticTests, billings, medications, questionnaires } = data;
  // 🔴 JSX 텍스트 자리는 <PT>(미번역이면 EN×/ZH×/JA× 티) · tAttr 은 문자열만 받는 부품(EmptyState 등)에만
  const tAttr = usePortalTAttr();

  // 첫 안내 — 계정 단위(계정 없는 등록번호 세션만 기기 단위) · `onboarding-state.ts`
  const onboarding = usePortalOnboarding();
  // 퇴원약 '쉽게 보기'(F-7 명칭 진입) — 열려 있는 약명
  const [explainMedName, setExplainMedName] = useState<string | null>(null);

  // ── Lifecycle Phase 감지 ──
  const { data: lifecycleData, isError: lifecycleIsError, error: lifecycleError, refetch: refetchLifecycle } = useQuery({
    queryKey: ['portal-lifecycle'],
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/portal/journey/status'),
    staleTime: 30000,
    refetchInterval: 60000,
  });
  const lifecycle = (lifecycleData?.data ?? lifecycleData) as Record<string, unknown> | null;
  const phase = (lifecycle?.phase as string) ?? 'IDLE';

  // ── F-3 입원 생활: 식이·중간정산 (config OFF·비입원이면 404 → null·카드 미렌더) ──
  const isInpatient = phase === 'INPATIENT';
  // 🔴 (2026-10-19 포털 세련화 A1 잔여) 병원 설정으로 꺼진 입원 생활은 부르지 않는다 — 종전엔 불러서 404 로 알았다(매 로딩 2건)
  const inpatientLife = usePortalService('inpatientLife');
  const { data: mealsData, isError: mealsIsError, error: mealsError, refetch: refetchMeals } = useQuery({
    queryKey: ['portal-inpatient-meals'],
    queryFn: () =>
      apiClient
        .get<{ data: { diet: Record<string, unknown> | null; meals: Record<string, unknown>[] } }>('/api/v1/portal/inpatient/meals'),
    enabled: isInpatient && mayCallAccountFeature(inpatientLife),
    staleTime: 5 * 60_000,
  });
  const mealsInfo = mealsData?.data ?? null;
  const { data: interimData, isError: interimIsError, error: interimError, refetch: refetchInterim } = useQuery({
    queryKey: ['portal-inpatient-interim-bill'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/api/v1/portal/inpatient/interim-bill'),
    enabled: isInpatient && mayCallAccountFeature(inpatientLife),
    staleTime: 5 * 60_000,
  });
  const interimBill = (interimData?.data ?? null) as (Record<string, unknown> & { available?: boolean; invoice?: Record<string, unknown> }) | null;

  // 🔴 (2026-10-19 포털 P2) 확정(CONFIRMED) 예약을 빠뜨렸다 — 예약 탭과 같은 정본 `splitAppointments`(오늘 이후 · 끝나지 않은 것)
  const upcomingAppts = splitAppointments(appointments).upcoming.filter(a => new Date(a.scheduledAt) > new Date());
  const todayAppts = appointments.filter(a => isToday(a.scheduledAt));
  const pendingQ = questionnaires.filter(q => q.status !== 'COMPLETED' && new Date(q.expiresAt) > new Date());
  // 🔴 (2026-10-19 포털 P2) 종전 `status !== 'PAID'` — 취소·환불 청구까지 미수납으로 셌고, 금액은 감면을 빼지 않았다.
  //    남은 금액 정본(`outstanding` = shared billingOutstanding)이 0 보다 큰 청구만 · 합계도 그 값으로.
  const unpaidBills = billings.filter(b => b.outstanding != null && b.outstanding > 0 && b.status !== 'CANCELLED' && b.status !== 'REFUNDED');
  const totalUnpaid = unpaidBills.reduce((sum, b) => sum + (b.outstanding ?? 0), 0);
  const unreadLabs = labResults.filter(l => !(l as LabResult & { isRead?: boolean }).isRead);

  // ── 동의서 배너 데이터 ──
  const { data: consentData, isError: consentIsError, error: consentError, refetch: refetchConsent } = useQuery({
    queryKey: ['portal-consent-banner'],
    queryFn: () => apiClient.get<{ data: { requiredComplete: boolean; consents: { type: string; required: boolean; agreed: boolean }[] } }>('/api/v1/portal/registration-consents'),
    staleTime: 60000,
  });
  const consentResult = consentData?.data as { requiredComplete?: boolean; consents?: { type: string; required: boolean; agreed: boolean }[] } | null;
  const hasConsentData = consentResult?.consents && consentResult.consents.length > 0;
  const consentComplete = hasConsentData ? consentResult?.requiredComplete : false;
  // 🔴 (2026-10-19 포털 P2) 동의서 기록이 하나도 없으면 미완료를 **6건으로 지어냈다**(P15). 그때는 건수를 모른다 — null 로 두고 "확인 필요"로 말한다.
  //    아직 오지 않았으면(consentData 없음) 말하지 않는다(로딩 ≠ 모름).
  const consentPending: number | null = !consentData ? 0 : hasConsentData ? (consentResult?.consents?.filter(c => c.required && !c.agreed).length ?? 0) : null;
  const consentNeedsAction = !consentIsError && !consentComplete && (consentPending == null || consentPending > 0) && !!consentData;

  // ── 대기 현황 ──
  const { data: waitingData, isError: waitingIsError, error: waitingError, refetch: refetchWaiting } = useQuery({
    queryKey: ['portal-waiting'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/waiting-status'),
    refetchInterval: 30000,
  });
  const waitingQueues = (() => {
    const raw = waitingData?.data;
    return (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  })();

  // ── 복용약 ──
  const { data: medData, isError: medIsError, error: medError, refetch: refetchMed } = useQuery({
    queryKey: ['portal-medications'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/medications'),
  });
  const portalMeds = (() => {
    const raw = medData?.data;
    return (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  })();

  // ── 공지 ──
  const { data: noticeData, isError: noticeIsError, error: noticeError, refetch: refetchNotice } = useQuery({
    queryKey: ['portal-notices'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/notices'),
  });
  const notices = (() => {
    const raw = noticeData?.data;
    return (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  })();

  // ── 판독 완료 ──
  const { data: readingData, isError: readingIsError, error: readingError, refetch: refetchReading } = useQuery({
    queryKey: ['portal-reading-notifications-home'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/imaging/notifications'),
    refetchInterval: 60000,
  });
  const readingItems = (() => {
    const raw = readingData?.data;
    return (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  })();

  // ════════════════════════════════════════
  // 우선순위 기반 카드 스트림 조합
  // ════════════════════════════════════════
  const cards = useMemo<CardItem[]>(() => {
    const items: CardItem[] = [];

    // ── Phase 전용 카드 (최우선) ──
    if (phase === 'INPATIENT' && lifecycle) {
      const adm = lifecycle.admission as Record<string, unknown> | undefined;
      const vitals = lifecycle.vitals as Record<string, unknown> | undefined;
      const meds = (lifecycle.todayMedications as Record<string, unknown>[]) ?? [];
      const notes = (lifecycle.recentProgressNotes as Record<string, unknown>[]) ?? [];
      items.push({
        priority: 0, key: 'inpatient-hero',
        render: () => (
          <div className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 rounded-2xl p-5 text-white overflow-hidden shadow-lg">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">입원 {String(adm?.daysSinceAdmit ?? '')}일차</p>
                <p className="text-xs text-blue-200">{String(adm?.ward ?? '')} {String(adm?.room ?? '')}호 {String(adm?.bed ?? '')}침대</p>
              </div>
              <p className="text-lg font-bold">
                {adm?.attendingDoctor ? `${(adm.attendingDoctor as Record<string, unknown>).familyName}${(adm.attendingDoctor as Record<string, unknown>).givenName} 교수 (주치의)` : '주치의 미배정'}
              </p>
              {vitals && (
                <div className="flex gap-3 mt-3 text-xs">
                  {vitals.systolicBp != null && <span>BP {String(vitals.systolicBp)}/{String(vitals.diastolicBp)}</span>}
                  {vitals.heartRate != null && <span>HR {String(vitals.heartRate)}</span>}
                  {vitals.spo2 != null && <span>SpO2 {String(vitals.spo2)}<Unit>%</Unit></span>}
                  {vitals.temperature != null && <span>T {formatTemp(Number(vitals.temperature))}</span>}{/* formatTemp 가 ℃ 를 붙인다 — 종전 "36.8℃°C" 단위 중복 */}
                </div>
              )}
            </div>
          </div>
        ),
      });
      // 오늘 투약
      if (meds.length > 0) {
        items.push({
          priority: 0.1, key: 'inpatient-meds',
          render: () => (
            <div className="bg-white rounded-2xl border border-emerald-200 p-4 shadow-sm">
              <p className="text-xs font-semibold text-emerald-800 mb-3 flex items-center gap-1.5">
                <Icon d={ICONS.pill} cls="w-4 h-4 text-emerald-600" /> 오늘 투약
              </p>
              <div className="space-y-2">
                {meds.slice(0, 6).map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {m.status === 'ADMINISTERED' ? (
                        <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                          <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        </span>
                      ) : (
                        <span className="w-5 h-5 rounded-full border-2 border-gray-300" />
                      )}
                      <span className={m.status === 'ADMINISTERED' ? 'text-gray-400 line-through' : 'text-gray-800'}>
                        {String(m.drugName ?? '')} {String(m.dose ?? '')}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">{m.scheduledAt ? fmtTime(String(m.scheduledAt)) : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          ),
        });
      }
      // 최근 회진
      if (notes.length > 0) {
        const latest = notes[0];
        items.push({
          priority: 0.2, key: 'inpatient-rounds',
          render: () => (
            <div className="bg-white rounded-2xl border border-blue-100 p-4 shadow-sm">
              <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
                <Icon d={ICONS.stethoscope} cls="w-4 h-4 text-blue-600" /> 최근 회진 기록
              </p>
              <p className="text-xs text-gray-500 mb-1">
                {latest.doctor ? `${(latest.doctor as Record<string, unknown>).familyName}${(latest.doctor as Record<string, unknown>).givenName}` : ''} · {latest.createdAt ? fmt(String(latest.createdAt)) : ''}
              </p>
              <p className="text-sm text-gray-800 line-clamp-3">{String(latest.content ?? '')}</p>
            </div>
          ),
        });
      }
      // 오늘 식사 — F-3 식이 정보 카드 (메뉴 텍스트는 데이터 부재 — 설계 §2.2)
      const dietInfo = mealsInfo?.diet as Record<string, unknown> | null | undefined;
      const todayMeals = ((mealsInfo?.meals as Record<string, unknown>[] | undefined) ?? []).filter(m => isToday(String(m.date)));
      if (dietInfo || todayMeals.length > 0) {
        const MEAL_LABEL: Record<string, string> = { BREAKFAST: '조식', LUNCH: '중식', DINNER: '석식', SNACK: '간식' };
        const MEAL_STATUS: Record<string, string> = { ORDERED: '예정', PREPARED: '준비됨', DELIVERED: '배송완료' };
        const cautionText = dietInfo?.notes ?? todayMeals.find(m => m.allergies)?.allergies;
        items.push({
          priority: 0.15, key: 'inpatient-meals-info',
          render: () => (
            <div className="bg-white rounded-2xl border border-orange-100 p-4 shadow-sm">
              <p className="text-xs font-semibold text-orange-800 mb-2">🍽️ 오늘 식사</p>
              {dietInfo != null && (
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-xs font-medium border border-orange-200">{String(dietInfo.dietType ?? '일반식')}</span>
                  {dietInfo.calorieTarget != null && <span className="text-xs text-gray-500">{String(dietInfo.calorieTarget)}kcal</span>}
                  {dietInfo.texture != null && <span className="text-xs text-gray-500">{String(dietInfo.texture)}</span>}
                </div>
              )}
              {todayMeals.length > 0 && (
                <div className="flex gap-3 text-xs flex-wrap">
                  {todayMeals.map((m, i) => (
                    <span key={i} className={m.status === 'DELIVERED' ? 'text-gray-400' : 'text-gray-800'}>
                      {m.status === 'DELIVERED' ? '✓ ' : ''}{MEAL_LABEL[String(m.mealType)] ?? String(m.mealType)} · {MEAL_STATUS[String(m.status)] ?? String(m.status)}
                    </span>
                  ))}
                </div>
              )}
              {cautionText != null && cautionText !== '' && (
                <p className="text-xs text-amber-600 mt-2">⚠️ {String(cautionText)}</p>
              )}
            </div>
          ),
        });
      }
      // 진료비 중간정산 — F-3 (ERP interim · 확정액 아님)
      const interimInvoice = interimBill?.available ? (interimBill.invoice as Record<string, unknown> | undefined) : undefined;
      if (interimInvoice) {
        items.push({
          priority: 0.3, key: 'inpatient-interim-bill',
          render: () => (
            <div className="bg-white rounded-2xl border border-blue-100 p-4 shadow-sm">
              <p className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
                <Icon d={ICONS.creditCard} cls="w-4 h-4 text-blue-600" /> <PT k="진료비 중간정산" />
              </p>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-gray-500"><PT k="현재까지 환자부담 발생액" /></span>
                <span className="text-lg font-bold text-gray-900">{currency(Number(interimInvoice.patientShare ?? interimInvoice.total ?? 0))}</span>
              </div>
              {interimInvoice.balanceDue != null && Number(interimInvoice.balanceDue) !== Number(interimInvoice.patientShare ?? 0) && (
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-xs text-gray-500"><PT k="납부 예정(선납 반영)" /></span>
                  <span className="text-sm font-semibold text-gray-800">{currency(Number(interimInvoice.balanceDue))}</span>
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-2">
                확정 금액이 아닙니다 · 최종 진료비는 퇴원 수납 시 확정 · 문의: 원무과{interimInvoice.asOf ? ` · 기준 ${fmtTime(String(interimInvoice.asOf))}` : ''}
              </p>
            </div>
          ),
        });
      }
    }

    if (phase === 'PRE_DISCHARGE' && lifecycle) {
      const ds = lifecycle.dischargeSummary as Record<string, unknown> | undefined;
      const cl = lifecycle.checklist as Record<string, unknown> | undefined;
      const billing = lifecycle.billing as Record<string, unknown> | undefined;
      items.push({
        priority: 0, key: 'predischarge-hero',
        render: () => (
          <div className="relative bg-gradient-to-br from-emerald-600 to-teal-700 rounded-2xl p-5 text-white overflow-hidden shadow-lg">
            <div className="absolute -top-10 -right-10 w-36 h-36 bg-white/5 rounded-full" />
            <div className="relative z-10">
              <p className="text-[10px] font-bold text-emerald-200 uppercase tracking-widest"><PT k="퇴원 준비" /></p>
              <p className="text-lg font-bold mt-1"><PT k="퇴원 예정일" />: {ds?.dischargeDate ? fmt(String(ds.dischargeDate)) : <PT k="미정" />}</p>
              {ds?.diagnosis != null && <p className="text-sm text-emerald-200 mt-1"><PT k="퇴원 진단" />: {String(ds.diagnosis)}</p>}
            </div>
          </div>
        ),
      });
      // 퇴원 체크리스트
      if (cl) {
        // 🔴 W9(2026-08-14): 종전 `!!cl.medicationReceived` — 서버가 '모른다'(null)고 보낸 항목을
        //    `!!` 로 **false(=안 함)** 로 뭉개 환자에게 "퇴원 약 수령: 미완료"라고 단정했다(P1).
        //    서버가 null 을 내는 항목은 '확인 필요'로 구분해 그리고, 완료 카운트 분모에서도 뺀다.
        const tri = (v: unknown): boolean | null => (v == null ? null : !!v);
        const checks: { label: string; done: boolean | null; action?: () => void }[] = [
          { label: '퇴원 처방 확인', done: true },
          { label: '퇴원 약 수령', done: tri(cl.medicationReceived) },
          { label: '다음 외래 예약', done: tri(cl.followUpBooked), action: () => onNavigate('care', 'appointments') },
          { label: '퇴원 수납', done: tri(cl.billingSettled), action: () => onNavigate('services', 'billing') },
          { label: '만족도 조사', done: tri(cl.satisfactionSurveyDone) },
        ];
        const knownChecks = checks.filter(c => c.done !== null);
        const doneCount = knownChecks.filter(c => c.done).length;
        const knownCount = knownChecks.length;
        items.push({
          priority: 0.1, key: 'predischarge-checklist',
          render: () => (
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-gray-900"><PT k="퇴원 체크리스트" /></span>
                <span className="text-xs text-gray-500">{doneCount}/{knownCount}{knownCount < checks.length ? <> (<PT k="확인 필요" /> {checks.length - knownCount})</> : ''}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${knownCount > 0 ? (doneCount / knownCount) * 100 : 0}%` }} />
              </div>
              <div className="space-y-2">
                {checks.map((c, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {c.done === true ? (
                        <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center"><svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg></span>
                      ) : c.done === null ? (
                        <span className="w-5 h-5 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-[10px] text-gray-400 font-bold">?</span>
                      ) : <span className="w-5 h-5 rounded-full border-2 border-gray-300" />}
                      <span className={`text-sm ${c.done === true ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                        <PT k={c.label} />
                        {c.done === null && <span className="text-[10px] text-gray-400 ml-1"><PT k="병동에 확인해주세요" /></span>}
                      </span>
                    </div>
                    {c.done === false && c.action && <button onClick={c.action} className="text-xs text-blue-600 font-medium"><PT k="처리" /></button>}
                  </div>
                ))}
              </div>
            </div>
          ),
        });
      }
      // 퇴원약
      if (ds?.medications && Array.isArray(ds.medications)) {
        items.push({
          priority: 0.2, key: 'predischarge-meds',
          render: () => (
            <div className="bg-white rounded-2xl border border-emerald-200 p-4 shadow-sm">
              <p className="text-xs font-semibold text-emerald-800 mb-2"><PT k="퇴원 약 안내" /></p>
              <div className="space-y-1.5">
                {(ds.medications as Record<string, unknown>[]).map((m, i) => {
                  const medName = String(m.drugName ?? m.drug ?? '').trim();
                  return (
                    <div key={i} className="flex items-center justify-between gap-2 text-sm bg-emerald-50 rounded-lg px-3 py-2">
                      <span className="text-gray-900 font-medium min-w-0 truncate">{medName}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-500">{String(m.dosage ?? '')} · {String(m.frequency ?? '')} · {String(m.duration ?? '')}<Unit>일</Unit></span>
                        {medName && (
                          <button onClick={() => setExplainMedName(medName)}
                            className="text-xs text-emerald-700 font-medium underline underline-offset-2">
                            <PT k="쉽게 보기" />
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ),
        });
      }
      // 퇴원 후 주의사항
      if (ds?.dietaryInstructions || ds?.activityRestrictions) {
        items.push({
          priority: 0.3, key: 'predischarge-instructions',
          render: () => (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-xs font-semibold text-amber-800 mb-2"><PT k="퇴원 후 주의사항" /></p>
              {/* 🔴 라벨만 번역한다 — 값(원내 작성 지시문)은 서버가 한국어로 준다. 지어내지 않는다. */}
              {ds.dietaryInstructions != null && <p className="text-sm text-gray-800 mb-1"><PT k="식이" />: {String(ds.dietaryInstructions)}</p>}
              {ds.activityRestrictions != null && <p className="text-sm text-gray-800 mb-1"><PT k="활동" />: {String(ds.activityRestrictions)}</p>}
              {ds.patientEducation != null && <p className="text-sm text-gray-800"><PT k="교육" />: {String(ds.patientEducation)}</p>}
            </div>
          ),
        });
      }
    }

    if (phase === 'POST_DISCHARGE' && lifecycle) {
      const dis = lifecycle.discharge as Record<string, unknown> | undefined;
      const nextAppt = lifecycle.nextAppointment as Record<string, unknown> | undefined;
      if (dis) {
        items.push({
          priority: 0, key: 'postdischarge-banner',
          render: () => (
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                  <Icon d={ICONS.heart} cls="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">퇴원 후 D+{String(dis.daysSinceDischarge ?? '')}</p>
                  <p className="text-xs text-gray-500">{dis.diagnosis ? `퇴원 진단: ${String(dis.diagnosis)}` : ''}</p>
                </div>
              </div>
              {dis.followUpPlan != null && <p className="text-xs text-purple-700 mt-2">{String(dis.followUpPlan)}</p>}
              {nextAppt && (
                <button onClick={() => onNavigate('care', 'appointments')} className="mt-2 text-xs text-blue-600 font-medium">
                  다음 외래: {nextAppt.scheduledAt ? fmt(String(nextAppt.scheduledAt)) : ''} →
                </button>
              )}
            </div>
          ),
        });
      }
    }

    if (phase === 'PRE_VISIT' && lifecycle) {
      const appt = lifecycle.appointment as Record<string, unknown> | undefined;
      const cl = lifecycle.checklist as Record<string, unknown> | undefined;
      if (appt) {
        items.push({
          priority: 0, key: 'previsit-hero',
          render: () => (
            <div className="relative bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-5 text-white overflow-hidden shadow-lg">
              <div className="absolute -top-12 -right-12 w-36 h-36 bg-white/10 rounded-full" />
              <div className="relative z-10">
                <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">방문 D-{String(appt.daysUntil ?? '')}</p>
                <p className="text-2xl font-bold mt-1">{appt.scheduledAt ? fmt(String(appt.scheduledAt)) : ''}</p>
                <p className="text-sm text-blue-200">{String(appt.department ?? '')} · {appt.doctor ? `${(appt.doctor as Record<string, unknown>).familyName}${(appt.doctor as Record<string, unknown>).givenName}` : ''}</p>
              </div>
            </div>
          ),
        });
        // 준비 체크리스트
        if (cl) {
          const checks = [
            { label: '예약 확인', done: true },
            { label: `동의서 서명`, done: (cl.consentPending as number) === 0, action: () => onNavigate('care', 'consent') },
            { label: '문진표 작성', done: (cl.questionnairePending as number) === 0, action: () => onNavigate('care', 'questionnaire') },
            { label: '복용약 목록 확인', done: false },
          ];
          const doneCount = checks.filter(c => c.done).length;
          items.push({
            priority: 0.1, key: 'previsit-checklist',
            render: () => (
              <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-gray-900"><PT k="방문 준비 체크리스트" /></span>
                  <span className="text-xs text-gray-500">{doneCount}/{checks.length}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full" style={{ width: `${(doneCount / checks.length) * 100}%` }} />
                </div>
                <div className="space-y-2">
                  {checks.map((c, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {c.done ? (
                          <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center"><svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg></span>
                        ) : <span className="w-5 h-5 rounded-full border-2 border-gray-300" />}
                        <span className={`text-sm ${c.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}><PT k={c.label} /></span>
                      </div>
                      {!c.done && c.action && <button onClick={c.action} className="text-xs text-blue-600 font-medium"><PT k="처리" /></button>}
                    </div>
                  ))}
                </div>
              </div>
            ),
          });
          // 금식 안내
          if (cl.hasFastingTest) {
            items.push({
              priority: 0.2, key: 'previsit-fasting',
              render: () => (
                <div className="bg-amber-50 border border-amber-300 border-l-4 border-l-amber-500 rounded-2xl p-4">
                  <p className="text-sm font-bold text-amber-800">⚠️ <PT k="검사 전 금식 필요" /></p>
                  {/* 🔴 상세 지시문은 **의도적으로 미등재** — 임상 지시의 오역은 안전사고다(사람 검수 몫).
                      PT 를 통과시켜 미번역이 EN×/ZH×/JA× 티로 환자에게 보이게 한다(조용한 폴백 금지). */}
                  <p className="text-xs text-amber-700 mt-1"><PT k="검사 전날 자정부터 금식해주세요. 아침 약은 소량의 물과 함께 복용 가능합니다." /></p>
                </div>
              ),
            });
          }
        }
      }
    }

    // P1: 긴급 — 동의서 미완료. 🔴 조회 실패 시에는 건수를 만들어내지 않는다(실패는 위 에러 스트립이 말한다)
    if (consentNeedsAction) {
      items.push({
        priority: 1, key: 'consent-urgent',
        render: () => (
          <button onClick={() => onNavigate('care', 'consent')}
            className="w-full bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300 border-l-4 border-l-amber-500 rounded-2xl p-4 text-left hover:shadow-md transition-all">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Icon d={ICONS.document} cls="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900" data-portal-consent-banner>{consentPending == null ? <PT k="필수 동의서 확인 필요" /> : <>필수 동의서 {consentPending}<Unit>건</Unit> 미완료</>}</p>
                <p className="text-xs text-gray-500 mt-0.5"><PT k="진료 접수 전 필수 동의서를 작성해주세요" /></p>
              </div>
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>
        ),
      });
    }

    // P2: 오늘 할 일 (To-Do)
    const todoItems: { label: string; done: boolean; action?: () => void; href?: string; count?: number }[] = [];
    if (consentNeedsAction) todoItems.push({ label: consentPending == null ? '동의서 확인' : `동의서 서명 (${consentPending}건)`, done: false, action: () => onNavigate('care', 'consent') });
    if (pendingQ.length > 0) todoItems.push({ label: '문진표 작성', done: false, action: () => onNavigate('care', 'questionnaire'), count: pendingQ.length });
    if (unpaidBills.length > 0) {
      todoItems.push({ label: `수납 ${currency(totalUnpaid)}`, done: false, action: () => onNavigate('services', 'billing') });
    }
    if (todayAppts.some(a => a.status === 'CHECKED_IN' || a.status === 'SCHEDULED')) {
      todoItems.push({ label: '접수 완료', done: todayAppts.some(a => a.status === 'CHECKED_IN') });
    }

    if (todoItems.length > 0) {
      const doneCount = todoItems.filter(t => t.done).length;
      const pct = Math.round((doneCount / todoItems.length) * 100);
      items.push({
        priority: 2, key: 'todo',
        render: () => (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Icon d={ICONS.clipboard} cls="w-4 h-4 text-gray-600" />
                <span className="text-sm font-bold text-gray-900"><PT k="오늘 할 일" /></span>
              </div>
              <span className="text-xs text-gray-500">{doneCount}/{todoItems.length} <PT k="완료" /></span>
            </div>
            {/* 프로그레스 바 */}
            <div className="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full bg-blue-600 rounded-full" />
            </div>
            <div className="space-y-2">
              {todoItems.map((t, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {t.done ? (
                      <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                        <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                      </span>
                    ) : (
                      <span className="w-5 h-5 rounded-full border-2 border-gray-300" />
                    )}
                    <span className={`text-sm ${t.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.label}</span>
                  </div>
                  {!t.done && t.action && (
                    <button onClick={t.action} className="text-xs text-blue-600 font-medium hover:underline"><PT k="처리하기" /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ),
      });
    }

    // P3: 다음 예약 / 오늘 진료 여정
    if (todayAppts.length > 0) {
      items.push({
        priority: 3, key: 'today-journey',
        render: () => <TodayJourneyCard appointments={todayAppts} />,
      });
    } else if (upcomingAppts.length > 0) {
      items.push({
        priority: 3, key: 'next-appointment',
        render: () => <NextAppointmentCard appointment={upcomingAppts[0]} onNavigate={onNavigate} />,
      });
    }

    // P3.5: 대기 현황
    if (waitingQueues.length > 0) {
      items.push({
        priority: 3.5, key: 'waiting-status',
        render: () => (
          <div className="bg-white rounded-2xl border border-emerald-200 p-4 shadow-sm">
            <p className="text-xs font-semibold text-emerald-800 mb-2 flex items-center gap-1.5">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <PT k="실시간 대기 현황" />
            </p>
            {waitingQueues.map((q) => (
              <div key={String(q.id)} className="flex justify-between items-center text-sm py-1">
                <span className="text-gray-700">{String(q.departmentName ?? '')} · #{String(q.queueNumber ?? '')}</span>
                <div className="text-right">
                  <span className="text-emerald-700 font-bold">앞 {String(q.aheadCount ?? '')}<Unit>명</Unit></span>
                  {/* 🔴 W9: `{estimatedMinutes ?? ''}분` 은 서버의 null(=표본 없어 모름)을 받아 "(분)" 으로 깨졌다. 모르면 안 적는다. */}
                  {q.estimatedMinutes != null && <span className="text-xs text-gray-500 ml-1">({String(q.estimatedMinutes)}<Unit>분</Unit>)</span>}
                  {q.roomName ? (
                    <a href={`/guide/${String(q.id)}`} target="_blank" rel="noopener noreferrer" data-portal-guide-link
                      className="ml-2 inline-flex min-h-[32px] items-center rounded-lg border border-emerald-300 bg-white px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                      <PT k="진료실 가는 길" />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ),
      });
    }

    // P4: 새 검사결과
    if (unreadLabs.length > 0 || readingItems.length > 0) {
      items.push({
        priority: 4, key: 'new-results',
        render: () => (
          <button onClick={() => onNavigate('health', 'labs')}
            className="w-full bg-white rounded-2xl border border-purple-200 p-4 text-left hover:shadow-md transition-all shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                <Icon d={ICONS.beaker} cls="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-gray-900"><PT k="새 검사결과" /></p>
                  <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded-full whitespace-nowrap">NEW</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {unreadLabs.length > 0 && `검사 ${unreadLabs.length}건`}
                  {unreadLabs.length > 0 && readingItems.length > 0 && ' · '}
                  {readingItems.length > 0 && `판독 ${readingItems.length}건`}
                  {' 결과가 나왔습니다'}
                </p>
              </div>
              <svg className="w-5 h-5 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
            {/* 미리보기: 최근 검사 수치 */}
            {unreadLabs.length > 0 && unreadLabs[0].items?.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {unreadLabs[0].items.slice(0, 3).map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600 w-20 truncate">{item.name}</span>
                    <span className="font-mono font-semibold text-gray-900">{item.value}</span>
                    <span className="text-gray-400">{item.unit}</span>
                    {/* 🔴 종전 H/L 만 처리해 위급값(HH·LL·C·CRITICAL)이 정상(초록)으로 보이던 것 봉합 */}
                    {(() => {
                      // 🔴 (2026-10-20 B8 · 결정 portal.labResultRelease) 의료진 확인 전이면 서버가 판정을 비운다 —
                      //    종전 분기는 판정이 없으면 초록 "정상"을 그렸다(근거 없는 안심 · P17). 판정이 없으면 판정을 말하지 않는다.
                      if (item.judgmentPending || !item.flag) {
                        return (<>
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full" />
                          <span className="text-gray-400 whitespace-nowrap" data-portal-home-judgment-pending>
                            {item.judgmentPending ? <PT k="확인 전" /> : null}
                          </span>
                        </>);
                      }
                      const crit = isCriticalFlag(item.flag);
                      const abn = isAbnormalFlag(item.flag);
                      return (<>
                        {/* 🔴 종전엔 `width:'70%'` 고정이라 **모든 검사 항목이 같은 막대**로 그려졌다.
                            참조범위와 무관한 시각화는 값을 지어내는 것이다(P15).
                            비율을 계산할 근거가 없으므로 막대를 그리지 않고 플래그만 색으로 말한다. */}
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${crit ? 'bg-red-500 w-full' : abn ? 'bg-amber-400 w-full' : 'bg-emerald-400 w-full'}`} />
                        </div>
                        {crit ? (
                          <span className="text-red-600 font-bold whitespace-nowrap"><PT k="병원 문의" /> 🔴</span>
                        ) : abn ? (
                          <span className="text-amber-600 font-medium whitespace-nowrap"><PT k="주의" /> ⚠️</span>
                        ) : (
                          <span className="text-emerald-600 whitespace-nowrap"><PT k="정상" /></span>
                        )}
                      </>);
                    })()}
                  </div>
                ))}
              </div>
            )}
          </button>
        ),
      });
    }

    // P5: 복용약 리마인더
    if (portalMeds.length > 0) {
      items.push({
        priority: 5, key: 'medication-reminder',
        render: () => (
          <div className="bg-white rounded-2xl border border-emerald-200 p-4 shadow-sm">
            <p className="text-xs font-semibold text-emerald-800 mb-3 flex items-center gap-1.5">
              <Icon d={ICONS.pill} cls="w-4 h-4 text-emerald-600" />
              <PT k="오늘 복용 안내" />
            </p>
            <div className="space-y-2">
              {portalMeds.slice(0, 4).map((m, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{String(m.name ?? m.code ?? '')}</p>
                    <p className="text-[10px] text-gray-500">{[m.dosage, m.frequency, m.route].filter(Boolean).map(String).join(' · ')}</p>
                  </div>
                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full whitespace-nowrap"><PT k="복용 예정" /></span>
                </div>
              ))}
            </div>
          </div>
        ),
      });
    }

    // P6: 미수납
    if (unpaidBills.length > 0) {
      items.push({
        priority: 6, key: 'unpaid-bills',
        render: () => (
          <button onClick={() => onNavigate('services', 'billing')}
            className="w-full bg-white rounded-2xl border border-gray-200 p-4 text-left hover:shadow-md transition-all shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                <Icon d={ICONS.creditCard} cls="w-5 h-5 text-gray-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900"><PT k="미수납 안내" /></p>
                <p className="text-xs text-gray-500 mt-0.5">{unpaidBills.length}<Unit>건</Unit> · {currency(totalUnpaid)}</p>
              </div>
              <span className="text-sm font-bold text-blue-600"><PT k="수납하기" /></span>
            </div>
          </button>
        ),
      });
    }

    // P7: WeRU.B 건강 요약
    items.push({
      priority: 7, key: 'ai-health',
      render: () => (
        <AiHealthSummaryCard
          appointments={upcomingAppts}
          encounters={encounters}
          labResults={labResults}
          medications={medications}
          allergies={data.allergies}
        />
      ),
    });

    // P8: 병원 공지
    if (notices.length > 0) {
      items.push({
        priority: 8, key: 'notices',
        render: () => (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Icon d={ICONS.info} cls="w-3.5 h-3.5 text-blue-500" />
              <PT k="병원 공지" />
            </h3>
            <div className="space-y-2">
              {notices.slice(0, 3).map((n, i) => (
                <div key={n.id != null ? String(n.id) : i} className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{String(n.title ?? '')}</p>
                    {n.content != null && <p className="text-[10px] text-gray-500 truncate">{String(n.content)}</p>}
                  </div>
                  <p className="text-[10px] text-gray-400 shrink-0">{portalDateText(n.createdAt, 'date', { fallback: '' })}</p>
                </div>
              ))}
            </div>
          </div>
        ),
      });
    }

    // 우선순위 정렬
    return items.sort((a, b) => a.priority - b.priority);
  }, [
    phase, lifecycle, consentComplete, consentPending, consentNeedsAction, consentIsError, pendingQ, unpaidBills, todayAppts,
    upcomingAppts, waitingQueues, unreadLabs, readingItems, portalMeds,
    notices, encounters, labResults, medications, data.allergies, onNavigate,
    mealsInfo, interimBill,
  ]);

  /**
   * 🔴 카드 스트림은 조회 실패를 "카드가 없음"으로 흡수한다 — 그러면 화면이
   *    "오늘은 특별한 일정이 없습니다" 라고 거짓말한다. 실패한 축을 이름으로 밝히고 재시도를 준다.
   */
  // 🔴 (2026-10-19) 입원 식이·중간 정산은 병원이 켠 기능(설정 portal.inpatientLife)이다 — 꺼져 있으면 서버가
  //    PORTAL_INPATIENT_LIFE_DISABLED 로 답하고 카드가 없는 것이 사실이다. 종전엔 그것을 "조회 실패"로 그렸다.
  //    세션 만료(UNAUTHORIZED)는 카드별로 말하지 않는다 — 포털 전체가 로그인 화면으로 돌아간다(page.tsx).
  const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;
  const realFailure = (isErr: boolean, e: unknown) => isErr && codeOf(e) !== 'PORTAL_INPATIENT_LIFE_DISABLED' && codeOf(e) !== 'UNAUTHORIZED';
  const failedSources: { key: string; label: string; error: unknown; retry: () => void }[] = [
    realFailure(lifecycleIsError, lifecycleError) && { key: 'lifecycle', label: '진료 진행 상황', error: lifecycleError, retry: refetchLifecycle },
    realFailure(mealsIsError, mealsError) && { key: 'meals', label: '입원 식이', error: mealsError, retry: refetchMeals },
    realFailure(interimIsError, interimError) && { key: 'interim', label: '중간 정산', error: interimError, retry: refetchInterim },
    realFailure(consentIsError, consentError) && { key: 'consent', label: '동의서 현황', error: consentError, retry: refetchConsent },
    realFailure(medIsError, medError) && { key: 'med', label: '복용약', error: medError, retry: refetchMed },
    realFailure(noticeIsError, noticeError) && { key: 'notice', label: '공지', error: noticeError, retry: refetchNotice },
    realFailure(readingIsError, readingError) && { key: 'reading', label: '판독 결과 알림', error: readingError, retry: refetchReading },
    // 🔴 (포털 A6) 대기 현황 — 받은 값이 없을 때만(30초 갱신 중 한 번 실패는 받은 값이 남는다) · 종전엔 실패가 "대기 없음"(카드 없음)이었다
    realFailure(waitingIsError && !waitingData, waitingError) && { key: 'waiting', label: '대기 현황', error: waitingError, retry: refetchWaiting },
  ].filter(Boolean) as { key: string; label: string; error: unknown; retry: () => void }[];

  return (
    <div className="space-y-3">
      {onboarding.show && <OnboardingTour onComplete={onboarding.complete} />}

      {failedSources.map((f) => (
        <div key={f.key}>
          <p className="text-[10px] font-bold text-gray-400 mb-1"><PT k={f.label} /></p>
          <QueryErrorFallback error={f.error} onRetry={f.retry} size="compact" />
        </div>
      ))}

      {/* 퇴원약 쉽게 보기(F-7 명칭 진입) — config OFF/미매칭이면 시트 내 조용한 폴백 */}
      {explainMedName && (
        <DrugExplainSheet open onClose={() => setExplainMedName(null)} byName={explainMedName} drugName={explainMedName} />
      )}

      {/* 셀프 체크인 (R10) + 체크인 QR (R8) */}
      <SelfCheckIn mrn={patient?.mrn} />

      {/* 응급 진행 카드(P1·emergency-flow-tv-board) — 재실/종결 60분 내에만 표시 */}
      <ErStatusCard />

      {/* 카드 스트림 — fadeInUp 애니메이션 */}
      {cards.map((card, index) => (
        <motion.div
          key={card.key}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.05, ease: 'easeOut' }}
        >
          {card.render()}
        </motion.div>
      ))}

      {cards.length === 0 && failedSources.length === 0 && (
        <EmptyState
          icon="🏥"
          // 🔴 EmptyState 는 문자열만 받아 티를 그릴 수 없다 — tAttr(원문 폴백)로 지어내지는 않는다
          title="오늘은 특별한 일정이 없습니다"
          description="예약이나 검사 결과가 있으면 여기에 표시됩니다"
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════
// 하위 카드 컴포넌트
// ════════════════════════════════════════

// ── TodayJourneyCard: Hero 스타일 ──
function TodayJourneyCard({ appointments }: { appointments: Appointment[] }) {
  const steps = [
    { key: 'checkin', label: '접수', icon: ICONS.clipboard },
    { key: 'waiting', label: '대기', icon: ICONS.clock },
    { key: 'consultation', label: '진료', icon: ICONS.stethoscope },
    { key: 'payment', label: '수납', icon: ICONS.creditCard },
  ];

  const appt = appointments[0];
  const status = appt.status.toUpperCase();
  const activeStepIdx = status === 'CHECKED_IN' ? 1
    : status === 'IN_PROGRESS' ? 2
    : status === 'COMPLETED' ? 3
    : 0;

  return (
    <div className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 rounded-2xl p-5 text-white overflow-hidden shadow-lg">
      {/* 장식 원형 */}
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full" />
      <div className="absolute -bottom-8 -left-8 w-28 h-28 bg-white/5 rounded-full" />

      <div className="relative z-10">
        <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest mb-1"><PT k="오늘의 진료" /></p>
        <p className="text-lg font-bold mb-1">
          {appt.department} · {appt.doctorName || `${appt.doctor?.familyName ?? ''}${appt.doctor?.givenName ?? ''}`}
        </p>
        <p className="text-sm text-blue-200 mb-4">{fmt(appt.scheduledAt)} {fmtTime(appt.scheduledAt)}</p>

        {/* 타임라인 */}
        <div className="flex items-center justify-between relative">
          <div className="absolute top-4 left-6 right-6 h-0.5 bg-blue-400/30" />
          <div className="absolute top-4 left-6 h-0.5 bg-white/70 transition-all duration-700" style={{ width: `${Math.min(activeStepIdx / (steps.length - 1) * 100, 100)}%` }} />

          {steps.map((step, i) => {
            const isDone = i < activeStepIdx;
            const isActive = i === activeStepIdx;
            return (
              <div key={step.key} className="flex flex-col items-center z-10 relative">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                  isDone ? 'bg-white border-white text-blue-600' :
                  isActive ? 'bg-white/20 border-white text-white ring-2 ring-white/40' :
                  'bg-blue-500/30 border-blue-400/40 text-blue-300'
                }`}>
                  {isDone ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                  ) : (
                    <Icon d={step.icon} cls="w-3.5 h-3.5" />
                  )}
                </div>
                <p className={`text-[10px] mt-1.5 font-medium ${isActive ? 'text-white' : isDone ? 'text-blue-200' : 'text-blue-300/60'}`}>
                  <PT k={step.label} />
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── NextAppointmentCard: Hero 그라데이션 ──
function NextAppointmentCard({ appointment, onNavigate }: { appointment: Appointment; onNavigate: (tab: MainTab) => void }) {
  return (
    <button onClick={() => onNavigate('care')}
      className="w-full relative bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-5 text-left text-white overflow-hidden shadow-lg hover:shadow-xl transition-all group">
      {/* 장식 */}
      <div className="absolute -top-12 -right-12 w-36 h-36 bg-white/10 rounded-full" />
      <div className="relative z-10">
        <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest"><PT k="다음 진료" /></p>
        <p className="text-2xl font-bold mt-1">{fmt(appointment.scheduledAt)}</p>
        <p className="text-lg font-medium text-blue-100">{fmtTime(appointment.scheduledAt)}</p>
        <p className="text-sm text-blue-200 mt-2">{appointment.department} · {appointment.doctorName}</p>
      </div>
    </button>
  );
}

// ── WeRU.B 건강 요약 카드 (Glassmorphism) ──
function AiHealthSummaryCard({ appointments, encounters, labResults, medications, allergies }: {
  appointments: Appointment[]; encounters: Encounter[]; labResults: LabResult[]; medications: Medication[]; allergies: Allergy[];
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const context = [
        appointments.length > 0 ? `예약 ${appointments.length}건 (${appointments[0]?.department ?? ''})` : '',
        encounters.length > 0 ? `최근 진료 ${encounters.length}건 (${encounters[0]?.diagnosisNames?.join(', ') ?? ''})` : '',
        labResults.length > 0 ? `검사 ${labResults.length}건` : '',
        medications.length > 0 ? `복용약 ${medications.length}종 (${medications.map(m => m.name).join(', ')})` : '',
        allergies.length > 0 ? `알레르기: ${allergies.map(a => a.allergen).join(', ')}` : '',
      ].filter(Boolean).join('\n');
      const question = `다음은 제 건강 정보입니다. 현재 건강 상태를 쉬운 한국어로 3~5문장으로 요약하고, 생활습관 관리 팁을 알려주세요.\n\n${context || '특이사항 없음'}`;
      const res = await apiClient.post<{ data: { answer?: string } }>('/api/v1/portal/ai/ask', { question });
      let text = res?.data?.answer ?? '';
      if (typeof text !== 'string') text = '';
      if (text.includes('Error:') || text.includes('BadStatusLine') || text.includes('Connection aborted')) text = '';
      setSummary(text || '요약을 생성하지 못했습니다.');
    } catch { setSummary(`${AI_ORIGIN_TEXT} 요약에 실패했습니다.`); }
    setLoading(false);
  };

  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-blue-100 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <Icon d={ICONS.sparkles} cls="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">{AI_ORIGIN_TEXT} <PT k="건강 분석" /></p>
            <p className="text-[10px] text-gray-500"><PT k="나의 건강 상태를 한눈에" /></p>
          </div>
        </div>
        <button onClick={generate} disabled={loading}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {loading ? <PT k="분석 중..." /> : summary ? <PT k="재분석" /> : <PT k="요약 보기" />}
        </button>
      </div>
      {summary && (
        <div className="bg-white rounded-xl p-3 text-sm text-gray-800 whitespace-pre-wrap border border-blue-50 mt-2">
          {summary}
          <p className="text-[10px] text-blue-400 mt-2 flex items-center gap-1">
            ⚖️ {AI_ORIGIN_TEXT} 분석은 참고용이며, 정확한 판단은 담당 의료진에게 문의하세요.
          </p>
        </div>
      )}
    </div>
  );
}
