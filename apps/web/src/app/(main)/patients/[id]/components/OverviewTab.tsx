'use client';

import { LabTerm } from '@/components/ui/lab-term';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { safeFormat as format } from '@/lib/safe-date';
import { vitalsFreshness } from '@/lib/vital-ranges';
import { VitalSignsGrid } from '@/components/vitals/VitalSigns';
import { useVitalsThresholds, flagsWith, anyAbnormal } from '@/lib/vital-flags';
import { VitalsRuleNote } from '@/components/vitals/VitalsRuleNote';
import { temperatureStatus, type VitalSignKey } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { AiSuggestionPanel } from '@/components/ai/AiSuggestionPanel';
import { PatientBriefCard, ActiveMedicationsCard, AgoText } from './PatientBriefCard';
import { useHasRole } from '@/hooks/use-admin-write';
import { useAuthStore } from '@/stores/auth-store';
import { canRequestDrugInteractionAi, screenDrugsForInteraction, DRUG_INTERACTION_MAX } from '@/lib/drug-interaction-screen';
import type { EncounterListItem, BillingWithRelations } from './types';
import { STATUS_CONFIG } from './types';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, Money, Unit } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useAllergyStatus } from '@/components/clinical/allergy-status';
import { allergyStatusIsReassuring, allergyStatusMeta, canReadAllergyStatus } from '@hospital-run/shared';
import { isCriticalFlag, isHighFlag, isLowFlag, AI_ORIGIN_TEXT } from '@hospital-run/shared';

interface PatientSummary {
  patient?: {
    familyName?: string;
    givenName?: string;
    gender?: string;
    dateOfBirth?: string;
    mrn?: string;
    insuranceType?: string;
    bloodType?: string;
  };
  latestVitals?: {
    systolicBp?: number;
    diastolicBp?: number;
    heartRate?: number;
    spo2?: number;
    temperature?: number;
    weight?: number;
    respiratoryRate?: number;
    measuredAt?: string;
  };
  allergies?: Array<{ allergen: string; severity?: string }>;
  /** 이 역할에 싣지 않은 임상 항목(서버 RESTRICTED_KEYS) — 빈 것과 다르다 */
  restricted?: string[];
  problems?: Array<{ id: string; description: string; code?: string; status?: string }>;
  activeRxCount?: number;
  recentEncounters?: Array<{ id: string; createdAt: string; doctorName?: string; status?: string }>;
  upcomingAppointments?: Array<{ id: string; scheduledAt: string; department?: string }>;
}

interface OverviewTabProps {
  patientId: string;
  recentEncounters: EncounterListItem[];
  encountersLoading: boolean;
  billings: BillingWithRelations[];
  billingsLoading: boolean;
  totalBillingAmount: number;
  paidBillings: number;
  onTabChange: (tab: string) => void;
  userRole?: string; // ADMIN, DOCTOR, NURSE 등
  /** 내용 없는 임시 기록(빈 DRAFT) 수 — 최근 진료에서 뺀 것을 말한다 */
  emptyDraftCount?: number;
}


/** 개요 타일 — 요약 응답(latestVitals)이 싣는 항목만(통증은 싣지 않아 '미측정'으로 그리면 거짓) */
const OVERVIEW_VITAL_KEYS: readonly VitalSignKey[] = ['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature', 'weight'];

function CriticalAlertBanner({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  /**
   * 🔴 알레르기 축(2026-10-03) — 종전엔 환자 요약에 `allergies` 키가 없을 때만 경고했다.
   *    임상 역할에겐 요약이 늘 배열(빈 배열 포함)을 실어 **미평가 환자에게도 경고가 뜬 적이 없었고**,
   *    비임상 역할(원무 등)에겐 권한상 빼고 보내는 것을 "알레르기 정보 미확인 — 처방 전 확인"으로 말했다.
   *    → 정본 4상태(`/allergies/status`) · 조회 역할(`canReadAllergyStatus`)만 부른다 · 미평가·확인 불가·근거 없는 "없음"만 경고.
   */
  const role = useAuthStore((s) => s.user?.role);
  const canAllergy = canReadAllergyStatus(role);
  const allergyQ = useAllergyStatus(patientId, canAllergy);
  const allergySt = allergyQ.data?.data;
  const allergyAlert: { type: 'allergy'; message: string; detail?: string } | null =
    !canAllergy || !allergySt || allergySt.status === 'HAS_ALLERGIES' || allergyStatusIsReassuring(allergySt.status, allergySt.assessedAt)
      ? null
      : { type: 'allergy', message: allergyStatusMeta(allergySt.status).label, detail: `${allergyStatusMeta(allergySt.status).meaning} 처방 전 반드시 확인하세요.` };
  const [alerts, setAlerts] = useState<Array<{ type: 'critical' | 'allergy'; message: string; detail?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  /** 조회하지 못한 안전 축 — 배너가 '확인 불가'로 말한다(0건과 구분) */
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    const items: typeof alerts = [];
    const failedAxes: string[] = [];

    Promise.all([
      // 1. 위급값 체크 — 최근 검사에서 Critical 플래그
      apiClient.get<{data: unknown}>(`/api/v1/lab/patients/${patientId}/results?days=3`)
        .then(res => {
          const raw = res?.data;
          const rawObj = (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : null;
          const results = (Array.isArray(raw) ? raw : (rawObj?.data ?? [])) as Record<string, unknown>[];
          results.forEach((r: Record<string, unknown>) => {
            (r.items as Record<string, unknown>[] ?? []).forEach((item: Record<string, unknown>) => {
              if (isCriticalFlag(typeof item.flag === 'string' ? item.flag.toUpperCase() : undefined)) {
                items.push({
                  type: 'critical',
                  message: `위급값: ${String(item.testName ?? '')} ${String(item.value ?? '')} ${String(item.unit ?? '')}`,
                  detail: (() => { const at = (r.completedAt ?? r.collectedAt ?? r.createdAt) as string | undefined; return at ? kdate(at, 'datetimeShort') : undefined; })(),
                });
              }
            });
          });
        })
        .catch(() => { failedAxes.push('위급 검사값'); }),

      // 2. 약물 상호작용(AI)은 여기서 자동으로 부르지 않는다 — 아래 `InteractionAiRow`(요청 시만 · 의사·약사).
      //    🔴 종전엔 차트를 열 때마다 불러 간호사·관리자에게 403 → '확인하지 못했습니다'가 상시였고,
      //       기간 끝난 약까지 넣었으며, AI 결과를 AI 표기 없이 'DUR:'로 그렸다(2026-10-03).

      // 3. 알레르기 — 위 정본 4상태 훅(역할 게이트)이 맡는다
    ]).finally(() => {
      setAlerts(items);
      /**
       * 🔴 **안전 배너는 침묵이 곧 "이상 없음"으로 읽힌다**(2026-09-02).
       *    종전엔 세 축 모두 `.catch(() => {})` 로 실패를 삼켰고, 경보 0건이면 배너 자체를 렌더하지
       *    않아(`visibleAlerts.length === 0 → null`) 의사는 "경보 없음 = 안전"으로 읽었다.
       *    조회하지 못한 축은 **확인 불가**라고 말한다 — 0건과 확인 불가는 다른 사실이다.
       */
      setFailed([...new Set(failedAxes)]);
      setLoading(false);
    });
  }, [patientId]);

  // 알레르기 경고는 맨 뒤 고정 자리(닫기 색인이 흔들리지 않게)
  const allAlerts = allergyAlert ? [...alerts, allergyAlert] : alerts;
  const allFailed = canAllergy && allergyQ.isError ? [...failed, '알레르기 확인'] : failed;
  const visibleAlerts = allAlerts.filter((_, i) => !dismissed.has(i));

  if (loading || (canAllergy && allergyQ.isLoading) || (visibleAlerts.length === 0 && allFailed.length === 0)) return null;

  const typeConfig = {
    critical: { bg: 'bg-red-50 border-red-300', icon: '\u{1F534}', textColor: 'text-red-800', detailColor: 'text-red-600' },
    allergy: { bg: 'bg-amber-50 border-amber-300', icon: '\u26A0\uFE0F', textColor: 'text-amber-800', detailColor: 'text-amber-600' },
  };

  return (
    <div className="space-y-2">
      {/* 🔴 확인하지 못한 축을 먼저 말한다 — 경보가 없는 것이 아니라 못 본 것이다 */}
      {allFailed.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {allFailed.join(' · ')} <T k="을(를) 확인하지 못했습니다. 경보가 없다는 뜻이 아닙니다." />
        </div>
      )}
      {visibleAlerts.map((alert, idx) => {
        const originalIdx = allAlerts.indexOf(alert);
        const config = typeConfig[alert.type];
        return (
          <div key={originalIdx} className={`${config.bg} border rounded-xl px-4 py-3 flex items-center justify-between`}>
            <div className="flex items-center gap-3">
              <span className="text-lg">{config.icon}</span>
              <div>
                <p className={`text-sm font-bold ${config.textColor}`}>{alert.message}</p>
                {alert.detail && <p className={`text-xs ${config.detailColor}`}>{alert.detail}</p>}
              </div>
            </div>
            <button onClick={() => setDismissed(prev => new Set(prev).add(originalIdx))}
              className="text-gray-400 hover:text-gray-600 text-sm p-1" title={tAttr('닫기')}>
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 약물 상호작용 AI 점검 — **요청할 때만**(2026-10-03 · 검사 추이 AI 와 같은 규칙).
 *  - 권한 밖(EP 는 의사·약사)은 부르지 않는다 — 403 을 '확인 불가'로 상시 띄우던 것.
 *  - 점검 대상은 투약 탭과 같은 규칙(`screenDrugsForInteraction` — 끝난 약 제외·기간 미상 포함) · 분모를 밝힌다.
 *  - 결과는 AI 표기와 함께. 보고된 상호작용이 없어도 "이상 없음"이라 말하지 않는다.
 */
function InteractionAiRow({ patientId }: { patientId: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const allowed = canRequestDrugInteractionAi(role);
  const [ask, setAsk] = useState(false);
  const rx = useQuery({
    queryKey: ['overview-rx-screen', patientId],
    queryFn: () => apiClient.get<{ data: unknown }>(`/api/v1/prescriptions/patient/${patientId}?status=ACTIVE&limit=200`),
    enabled: !!patientId && allowed,
    staleTime: 60 * 1000,
  });
  const raw = rx.data?.data as unknown;
  const rows = (Array.isArray(raw) ? raw : ((raw as { data?: unknown[] } | undefined)?.data ?? [])) as Parameters<typeof screenDrugsForInteraction>[0];
  const screen = screenDrugsForInteraction(rows);
  const drugs = screen.names.slice(0, DRUG_INTERACTION_MAX);
  const ai = useQuery({
    queryKey: ['overview-drug-interactions-ai', patientId, drugs],
    queryFn: () => apiClient.post<{ data: { interactions?: Array<{ drug_a?: string; drug_b?: string; drug1?: string; drug2?: string; description?: string; severity?: string }> } }>('/api/v1/ai/drug-interactions', { drugs }),
    enabled: allowed && ask && drugs.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
  if (!allowed || rx.isLoading) return null;
  if (rx.isError) return <QueryErrorFallback error={rx.error} onRetry={rx.refetch} size="compact" />;
  // 2종 미만이면 점검이 성립하지 않는다 — 여기서는 말하지 않고 투약 탭이 말한다
  if (screen.names.length < 2) return null;
  const inters = ai.data?.data?.interactions ?? [];
  const truncated = screen.names.length > drugs.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs" data-interaction-ai>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-gray-600">
          <Tf k="상호작용 점검 대상 {수}종" params={{ 수: drugs.length }} />
          {truncated && <> · <Tf k="{전체}종 중 {수}종만" params={{ 전체: screen.names.length, 수: drugs.length }} /></>}
          {screen.unknownIncluded > 0 && <span className="text-amber-600"> · <Tf k="투여기간 미기재 {수}건 포함" params={{ 수: screen.unknownIncluded }} /></span>}
          {screen.endedExcluded > 0 && <> · <Tf k="기간 종료 {수}건 제외" params={{ 수: screen.endedExcluded }} /></>}
        </span>
        {!ask && (
          <button type="button" onClick={() => setAsk(true)} data-ask-interaction-ai
            className="min-h-[32px] rounded-lg border border-gray-200 px-2.5 py-1 text-gray-700 hover:bg-gray-50">
            {AI_ORIGIN_TEXT} <T k="약물 상호작용 점검 요청" />
          </button>
        )}
      </div>
      {ask && (
        <div className="mt-2">
          {ai.isLoading ? <div className="h-8 animate-pulse rounded-lg bg-gray-100" />
            : ai.isError ? <QueryErrorFallback error={ai.error} onRetry={ai.refetch} size="compact" />
            : inters.length === 0 ? (
              <p className="text-gray-500" data-interaction-ai-none>{AI_ORIGIN_TEXT} <T k="보고된 상호작용이 없습니다 — 안전을 확인한 것은 아닙니다(약국 DUR 을 대신하지 않습니다)." /></p>
            ) : (
              <ul className="space-y-1" data-interaction-ai-result>
                {inters.map((it, i) => (
                  <li key={i} className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-orange-800">
                    <span className="mr-1.5 rounded bg-white px-1 text-[10px] font-semibold text-orange-700">{AI_ORIGIN_TEXT}</span>
                    <b>{it.drug_a ?? it.drug1} + {it.drug_b ?? it.drug2}</b>
                    {(it.severity || it.description) && <span className="text-orange-700"> — {[it.severity, it.description].filter(Boolean).join(' · ')}</span>}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}

export function OverviewTab({
  patientId,
  recentEncounters,
  encountersLoading,
  billings,
  billingsLoading,
  totalBillingAmount,
  paidBillings,
  onTabChange,
  userRole,
  emptyDraftCount = 0,
}: OverviewTabProps) {
  // 🔴 알레르기 '없음'은 서버 4상태 정본으로만 말한다(빈 목록 ≠ 확인함).
  // 정본 4상태 — 조회 역할(의사·간호사·약사·관리자)만 부른다(종전 역할 무관 호출 → 원무 403)
  const canAllergyStatus = canReadAllergyStatus(useAuthStore((s) => s.user?.role));
  const { data: allergyStatusRes, isError: allergyStatusError } = useAllergyStatus(patientId, canAllergyStatus);
  const allergyStatus = allergyStatusRes?.data;
  const tAttr = useTAttr();
  const showBilling = userRole === 'ADMIN' || userRole === 'RECEPTIONIST' || userRole === 'CHECKUP' || !userRole; // 수납 담당(원무·검진)도 수납 요약 열람
  const [summary, setSummary] = useState<PatientSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [vitalTrend, setVitalTrend] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    apiClient.get<{ data: PatientSummary }>(`/api/v1/patients/${patientId}/summary`)
      .then((res) => {
        if (!cancelled) {
          const d = res?.data;
          const s = (d && typeof d === 'object' && 'patient' in (d as Record<string, unknown>))
            ? d as unknown as PatientSummary
            : (d as unknown as { data?: PatientSummary })?.data ?? null;
          setSummary(s);
        }
      })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [patientId]);

  useEffect(() => {
    apiClient.get<{data: unknown}>(`/api/v1/nurse-station/vitals/patient/${patientId}?days=7`)
      .then(res => {
        const raw = res?.data;
        const rawObj = (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : null;
        const list = (Array.isArray(raw) ? raw : (rawObj?.data ?? [])) as Record<string, unknown>[];
        // 🔴 서버는 기간 인자를 받지 않는다 — "7일 추이"는 여기서 7일로 자른다(종전엔 석 달 전 한 건도 7일 추이였다)
        const since = Date.now() - 7 * 86_400_000;
        setVitalTrend(list
          .filter((v) => typeof v.measuredAt === 'string' && new Date(v.measuredAt).getTime() >= since)
          .sort((a, b) => String(a.measuredAt).localeCompare(String(b.measuredAt)))
          .map(v => v.systolicBp as number).filter((v) => v != null).slice(-7));
      })
      .catch(() => {});
  }, [patientId]);

  const vitals = summary?.latestVitals;
  // 이상 판정은 임계 정본(shared + 환자안전위 개정) — 화면이 숫자를 따로 적지 않는다(2026-10-01)
  const vitalsRule = useVitalsThresholds();
  const vf = flagsWith(vitalsRule, vitals);
  const abnormalVitals = anyAbnormal(vf) === true;
  const allergies = summary?.allergies ?? [];
  const problems = summary?.problems?.filter(p => p.status !== 'RESOLVED') ?? [];
  const summaryEncounters = summary?.recentEncounters?.slice(0, 3) ?? [];
  const appointments = summary?.upcomingAppointments ?? [];

  return (
    <div className="space-y-6">
      {/* 긴급 알림 배너 */}
      <CriticalAlertBanner patientId={patientId} />
      <InteractionAiRow patientId={patientId} />

      {/* 진료 전 요약 — 서버 결정론 브리핑(LLM 없음 · 환자 지목 감사). 종전 'AI 환자 요약'은 건수만 넘겨 받은 3줄이었다 */}
      <PatientBriefCard patientId={patientId} onTabChange={onTabChange} />

      {/* 🔴 카드들을 한 흐름으로 두고 **열 수가 폭에 따라 자동으로 늘어나게** 한다.
          종전엔 2~3장짜리 행이 고정돼 있어 넓은 화면에서 카드가 늘어지거나 오른쪽이 통째로 남았다.
          break-inside-avoid 로 카드가 열 경계에서 잘리지 않는다(큰 화면 보드의 마소너리와 같은 결과). */}
      <div className="columns-1 gap-4 xl:columns-2 2xl:columns-3 min-[2560px]:columns-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
        {/* 최근 바이탈 · 알레르기 — 아래 카드들과 한 흐름으로 재배치된다.
            (핵심 정보 카드는 제거 — 환자 헤더가 이름·성별·나이·MRN·보험·혈액형을 이미 표시하는 중복 표현이었다) */}
        {/* 최근 바이탈 */}
        <div className={`rounded-2xl shadow-sm border p-5 ${abnormalVitals ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-500 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              <T k="최근 바이탈" />
            </h4>
            {/* 진료 전 확인: 오래된 측정을 최신처럼 보여주지 않는다 */}
            {(() => {
              const f = vitalsFreshness(vitals?.measuredAt);
              if (!f) return null;
              const tone = f.tone === 'stale' ? 'bg-red-100 text-red-700' : f.tone === 'aging' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
              return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${tone}`}>{f.stale ? '⚠ ' : ''}{f.text}</span>;
            })()}
          </div>
          {summaryLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : vitals ? (
            <div className="space-y-1.5 text-sm">
              {/* 표준 순서·단위·미측정 '—'·이상 색(서버 임계)은 부품 정본 — 측정 시각·경과도 부품이 말한다 */}
              <VitalSignsGrid vitals={vitals} keys={OVERVIEW_VITAL_KEYS} rule={vitalsRule} columns={3} measuredAt={vitals.measuredAt ?? null} />
              {(() => {
                const s = temperatureStatus(vitals.temperature, vitalsRule.thresholds.temperature);
                if (!s) return null;
                const tone = s === 'HYPOTHERMIA' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700';
                return <span className={`inline-block text-[9px] font-semibold px-1 py-0.5 rounded ${tone}`}><T k={s === 'HYPERTHERMIA' ? '고열' : s === 'FEVER' ? '발열' : '저체온'} /></span>;
              })()}
              <VitalsRuleNote rule={vitalsRule} className="mt-1" />
              {vitalTrend.length > 1 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 mb-1"><T k="BP 7일 추이" /></p>
                  <div className="flex items-end gap-0.5 h-6">
                    {vitalTrend.map((v, i) => {
                      const max = Math.max(...vitalTrend);
                      const min = Math.min(...vitalTrend);
                      const range = max - min || 1;
                      const h = Math.max(3, ((v - min) / range) * 20);
                      const hi = vitalsRule.thresholds.systolicBp?.warnHigh; // 임계 정본(화면이 숫자를 적지 않는다)
                      const isHigh = hi != null && v >= hi;
                      return <div key={i} className={`flex-1 rounded-sm ${isHigh ? 'bg-red-400' : 'bg-blue-300'}`} style={{height: `${h}px`}} title={`${v}mmHg`} />;
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400"><T k="바이탈 데이터 없음" /></p>
          )}
        </div>

        {/* 알레르기 경고 */}
        <div className={`rounded-2xl shadow-sm border p-5 ${allergies.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
          <h4 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-1.5">
            {allergies.length > 0 ? (
              <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            )}
            <T k="알레르기 경고" />
          </h4>
          {summaryLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : summary?.restricted?.includes('allergies') ? (
            /* 🔴 이 역할에 싣지 않은 것 — "미확인"(처방 전 확인)으로 말하지 않는다 */
            <p className="text-xs text-gray-500" data-allergy-restricted><T k="알레르기 정보는 임상 역할 화면입니다 — 비어 있다는 뜻이 아닙니다." /></p>
          ) : allergies.length > 0 ? (
            <div className="space-y-1">
              {allergies.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  <span className="text-xs text-red-700 font-medium">{a.allergen}</span>
                  {a.severity && (
                    <span className="text-[10px] text-red-500">({a.severity})</span>
                  )}
                </div>
              ))}
            </div>
          ) : canAllergyStatus && allergyStatusError ? (
            <p className="text-xs text-amber-700" data-allergy-status-error><T k="알레르기 확인 상태를 불러오지 못했습니다 — 미확인과 다릅니다. 처방 전 직접 확인하세요." /></p>
          ) : allergyStatusIsReassuring(allergyStatus?.status, allergyStatus?.assessedAt) ? (
            /* 🔴 종전 조건은 `summary?.allergies !== undefined` — **응답이 왔다**는 뜻일 뿐인데
               "확인됨"이라 적었다. 초록은 평가 기록이 있을 때만이다. */
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs text-emerald-700 font-medium"><T k="알레르기 없음(확인함)" /></span>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-700 font-medium">⚠ <T k="알레르기 미확인" /></p>
              <p className="text-[10px] text-amber-600"><T k="처방 전 반드시 확인하세요" /></p>
            </div>
          )}
        </div>

        {/* 활성 문제 목록 · 활성 처방 */}
        {/* 활성 문제 목록 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-500 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <T k="활성 문제 목록" />
            </h4>
            <button
              onClick={() => onTabChange('problems')}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              <T k="전체 보기" />
            </button>
          </div>
          {summaryLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : problems.length > 0 ? (
            <div className="space-y-1.5">
              {problems.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-gray-700">{p.description}</span>
                  {p.code && (
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded whitespace-nowrap">{p.code}</span>
                  )}
                </div>
              ))}
              {problems.length > 5 && (
                <p className="text-[10px] text-gray-400">외 {problems.length - 5}<Unit>건</Unit></p>
              )}
            </div>
          ) : (
            /* 🔴 "활성 문제 없음"은 없다는 단정이다 — 문제 목록에 등록된 것이 없을 뿐(진료 기록 진단은 위 요약) */
            <p className="text-xs text-gray-400"><T k="문제 목록에 등록된 활성 문제 없음" /></p>
          )}
        </div>

        {/* 활성 투약 — 🔴 종전엔 status=ACTIVE 처방 5건을 종류 구분 없이 받아 검사·영상 오더를 '처방'으로 그렸고(이름이 없으면 '처방약'·'검사'),
            같은 약이 세 번 활성인 것·처방 기간이 지난 것을 드러내지 않았다. 브리핑의 약 단위 목록을 쓴다 */}
        <ActiveMedicationsCard patientId={patientId} onTabChange={onTabChange} totalActiveOrders={summary?.activeRxCount ?? null} />

        {/* 최근 진료 · 예정 일정 */}
        {/* 최근 진료 3건 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-500 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <T k="최근 진료" />
            </h4>
            {recentEncounters.length > 0 && (
              <button
                onClick={() => onTabChange('encounters')}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                <T k="전체 보기" />
              </button>
            )}
          </div>

          {encountersLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : recentEncounters.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-gray-400">{emptyDraftCount > 0 ? <Tf k="내용 있는 진료 기록이 없습니다(빈 임시 기록 {수}건)." params={{ 수: emptyDraftCount }} /> : <T k="진료 기록이 없습니다." />}</p>
              <Link
                href={`/patients/${patientId}/encounter/new`}
                className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <T k="첫 진료 시작하기" />
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {emptyDraftCount > 0 && (
                <p className="text-[10px] text-gray-400" data-empty-drafts={emptyDraftCount}><Tf k="내용 없는 임시 기록 {수}건은 빼고 보여줍니다" params={{ 수: emptyDraftCount }} /></p>
              )}
              {recentEncounters.slice(0, 3).map((enc: EncounterListItem) => {
                const status = STATUS_CONFIG[enc.status] ?? { label: enc.status, bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' };
                return (
                  <div key={enc.id} className="rounded-xl border border-gray-100 px-3 py-2.5 hover:border-blue-200 hover:bg-blue-50/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.text} whitespace-nowrap`}>
                          {status.label}
                        </span>
                        <span className="text-xs text-gray-500">
                          {format(new Date(enc.createdAt), 'yyyy-MM-dd')}
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-400">
                        {enc.doctor?.familyName}{enc.doctor?.givenName}
                      </span>
                    </div>
                    {(enc.diagnoses?.length ?? 0) > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {enc.diagnoses!.slice(0, 2).map((d) => (
                          <span key={d.id} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                            {d.diagnosisCode?.code}
                          </span>
                        ))}
                      </div>
                    )}
                    {enc.assessment && (
                      <p className="text-[10px] text-gray-500 mt-1 truncate">A: {enc.assessment}</p>
                    )}
                    {enc.plan && (
                      <p className="text-[10px] text-blue-600 mt-0.5 truncate">P: {enc.plan}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 예정 일정 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h4 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            <T k="예정 일정" />
          </h4>
          {summaryLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : appointments.length > 0 ? (
            <div className="space-y-2">
              {appointments.slice(0, 5).map((apt) => (
                <div key={apt.id} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2">
                  <span className="text-xs text-gray-700 font-medium">
                    {format(new Date(apt.scheduledAt), 'MM/dd (EEE) HH:mm')}
                  </span>
                  {apt.department && (
                    <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full whitespace-nowrap">{apt.department}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 py-4 text-center"><T k="예정된 일정 없음" /></p>
          )}
        </div>

      {/* 최근 검사 이상수치 + WeRU.B 검사 추이 해석 (검사 정보 인접 배치) */}
      <RecentAbnormalLabs patientId={patientId} onTabChange={onTabChange} />
      <LabTrendCard patientId={patientId} onTabChange={onTabChange} />

      {/* Billing Summary — ADMIN/BILLING만 표시 (의사/간호사 숨김) */}
      {showBilling && <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900"><T k="수납 요약" /></h3>
          {billings.length > 0 && (
            <button
              onClick={() => onTabChange('billing')}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <T k="상세 보기" />
            </button>
          )}
        </div>
        {billingsLoading ? (
          <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : billings.length === 0 ? (
          <EmptyState icon="💳" title="수납 내역이 없습니다." />
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
              <p className="text-[11px] text-gray-400 font-medium mb-1"><T k="총 청구액" /></p>
              <p className="text-lg font-bold text-gray-900"><Money value={totalBillingAmount} /></p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
              <p className="text-[11px] text-gray-400 font-medium mb-1"><T k="수납 완료" /></p>
              <p className="text-lg font-bold text-emerald-600">{paidBillings}<Unit>건</Unit></p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
              <p className="text-[11px] text-gray-400 font-medium mb-1"><T k="미수납" /></p>
              <p className="text-lg font-bold text-amber-600">{billings.length - paidBillings}<Unit>건</Unit></p>
            </div>
          </div>
        )}
      </div>}
      </div>
    </div>
  );
}

type LabItemRow = { testName: string; value: string; unit: string; flag: string; resultedAt: string };

/**
 * 최근 검사 이상 수치 — **항목별 최신값** 기준(2026-10-02).
 * 🔴 종전엔 `?days=7` 을 붙였지만 서버가 기간을 받지 않아 **전 기간**의 이상값을 "7일"이라 그렸고, 같은 항목의
 *    옛 이상값(이미 정상으로 돌아온 것)도 나란히 섰다. 이제 항목마다 가장 최근 값만 보고, 그 값이 이상일 때만 싣는다.
 */
export function latestAbnormalByTest(results: Record<string, unknown>[]): { rows: LabItemRow[]; lastAt: string | null } {
  const latest = new Map<string, LabItemRow>();
  const sorted = [...results].sort((a, b) => String(b.completedAt ?? b.createdAt ?? '').localeCompare(String(a.completedAt ?? a.createdAt ?? '')));
  for (const r of sorted) {
    const at = String(r.completedAt ?? r.createdAt ?? '');
    for (const it of (Array.isArray(r.items) ? r.items : []) as Record<string, unknown>[]) {
      const name = String(it.testName ?? '');
      if (!name || latest.has(name)) continue;
      latest.set(name, { testName: name, value: String(it.value ?? ''), unit: String(it.unit ?? ''), flag: typeof it.flag === 'string' ? it.flag : '', resultedAt: at });
    }
  }
  const rows = [...latest.values()].filter((x) => x.flag && x.flag !== 'N' && x.flag !== 'NORMAL');
  return { rows, lastAt: sorted.length ? String(sorted[0].completedAt ?? sorted[0].createdAt ?? '') || null : null };
}

function RecentAbnormalLabs({ patientId, onTabChange }: { patientId: string; onTabChange: (tab: string) => void }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['overview-lab-results', patientId],
    queryFn: () => apiClient.get<{ data: unknown }>(`/api/v1/lab/patients/${patientId}/results`),
    enabled: !!patientId,
  });
  if (isLoading) return <div className="h-20 bg-gray-100 rounded-xl animate-pulse" />;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  const raw = data?.data;
  const results = (Array.isArray(raw) ? raw : ((raw as Record<string, unknown> | null)?.data ?? [])) as Record<string, unknown>[];
  const { rows, lastAt } = latestAbnormalByTest(results);
  if (results.length === 0) return null;

  const flagStyle = (flag: string) => {
    if (isCriticalFlag(flag)) return 'bg-red-100 text-red-700';
    if (isHighFlag(flag) || flag === 'HIGH') return 'bg-amber-100 text-amber-700';
    if (isLowFlag(flag) || flag === 'LOW') return 'bg-blue-100 text-blue-700';
    return 'bg-gray-100 text-gray-600';
  };
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5" data-abnormal-labs={rows.length}>
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-semibold text-gray-500"><T k="검사 이상 수치(항목별 최신값)" /></h4>
        <button onClick={() => onTabChange('labresults')} className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="전체 보기" /></button>
      </div>
      {lastAt && <p className="mb-2 text-[10px] text-gray-400"><T k="마지막 검사" /> {kdate(lastAt)} <AgoText at={lastAt} /></p>}
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500"><T k="항목별 최신값 중 이상 표시 없음" /></p>
      ) : (
        <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
          {rows.slice(0, 10).map((a) => (
            <div key={a.testName} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
              <div className="min-w-0">
                <span className="text-xs text-gray-700 font-medium"><LabTerm name={a.testName} /></span>
                <p className="text-[10px] text-gray-400">{kdate(a.resultedAt)} <AgoText at={a.resultedAt} /></p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-gray-900">{a.value} {a.unit}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${flagStyle(a.flag)}`}>{a.flag}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length > 10 && <p className="mt-1 text-[10px] text-gray-400"><Tf k="{전체}건 중 10건 표시" params={{ 전체: rows.length }} /></p>}
    </div>
  );
}

/** 서버 `record-analytics` 계약 중 이 카드가 읽는 부분 */
interface TrendAnalyte {
  key: string; kind: 'LAB' | 'VITAL'; name: string; unit: string | null; n: number;
  first: { at: string; value: number } | null; last: { at: string; value: number } | null;
  rangeMove: 'STAYED_IN' | 'ENTERED' | 'LEFT' | 'STAYED_OUT' | null;
  series: { at: string; value: number; flag: string | null; range: 'IN' | 'OUT' | null }[];
}
const TREND_MOVE: Record<'ENTERED' | 'LEFT' | 'STAYED_OUT', { label: string; tone: string }> = {
  LEFT: { label: '범위 안 → 밖', tone: 'bg-amber-50 text-amber-800' },
  STAYED_OUT: { label: '범위 밖 유지', tone: 'bg-rose-50 text-rose-700' },
  ENTERED: { label: '범위 밖 → 안', tone: 'bg-sky-50 text-sky-700' },
};

/**
 * 검사 추이 — 결정론(2026-10-02). 🔴 종전엔 차트를 열 때마다 AI 추이 해석을 자동으로 불렀고, 그 해석은
 *    **미확인(COMPLETED) 결과만** 보고(확인된 16건 제외) 두 달 전 값을 "현재값"이라 했으며, 출력에 중국어가 섞여
 *    HbA1c 7.2% 를 "정상 범위"라 적었다. 이제 기록 시계열 분석 정본(참고 범위 기준의 사실·크기만)을 먼저 보이고,
 *    AI 해석은 **요청할 때만** 부른다.
 */
function LabTrendCard({ patientId, onTabChange }: { patientId: string; onTabChange: (tab: string) => void }) {
  const tAttr = useTAttr();
  const allowed = useHasRole('DOCTOR', 'NURSE'); // 분석 EP 역할(ADMIN 포함)과 같다
  const [askAi, setAskAi] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['overview-lab-trend', patientId],
    queryFn: () => apiClient.get<{ data: { analytes: TrendAnalyte[] } }>(`/api/v1/patients/${patientId}/record-timeline/analytics`),
    enabled: !!patientId && allowed,
    staleTime: 5 * 60 * 1000,
  });
  const ai = useQuery({
    queryKey: ['ai-lab-trend', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/lab/patients/${patientId}/ai-trend`),
    enabled: !!patientId && allowed && askAi,
    staleTime: 5 * 60 * 1000,
  });
  if (!allowed) return null;
  if (isLoading) return <div className="h-20 bg-gray-100 rounded-xl animate-pulse" />;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  const analytes = (data?.data?.analytes ?? []).filter((a) => a.kind === 'LAB' && a.n >= 2);
  // 최신값이 범위 밖이거나 범위를 넘나든 항목만 — 범위 안에 머문 항목은 여기서 말하지 않는다(탭에서 전부 본다)
  const moving = analytes.filter((a) => a.rangeMove === 'LEFT' || a.rangeMove === 'STAYED_OUT' || a.rangeMove === 'ENTERED');
  const aiTrend = ai.data?.data as Record<string, unknown> | undefined;
  const warnings = Array.isArray(aiTrend?.qualityWarnings) ? (aiTrend!.qualityWarnings as string[]) : [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5" data-lab-trend={moving.length}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-500"><T k="검사 추이(2회 이상 측정 · 지난 1년)" /></h4>
        <button onClick={() => onTabChange('timeline')} className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="전체 분석" /></button>
      </div>
      {analytes.length === 0 ? (
        <p className="text-xs text-gray-500"><T k="2회 이상 측정한 검사 항목이 없어 추이를 말할 수 없습니다." /></p>
      ) : moving.length === 0 ? (
        <p className="text-xs text-gray-500"><Tf k="{수}개 항목 모두 참고 범위 안에 머물렀습니다." params={{ 수: analytes.length }} /></p>
      ) : (
        <ul className="space-y-1.5">
          {moving.slice(0, 8).map((a) => {
            const mv = TREND_MOVE[a.rangeMove as keyof typeof TREND_MOVE];
            return (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-gray-800"><LabTerm name={a.name} /></span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-gray-700">{a.first?.value ?? '-'} → <b>{a.last?.value ?? '-'}</b> {a.unit ?? ''}</span>
                  <span className="text-[10px] text-gray-400"><Tf k="{수}회" params={{ 수: a.n }} /> · {kdate(a.last?.at)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${mv.tone}`}><T k={mv.label} /></span>
                </span>
              </li>
            );
          })}
          {moving.length > 8 && <li className="text-[10px] text-gray-400"><Tf k="{전체}개 중 8개 표시" params={{ 전체: moving.length }} /></li>}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-gray-400"><T k="참고 범위 기준의 사실만 — 호전·악화 판단이 아닙니다." /></p>

      {/* AI 해석 — 요청할 때만(자동 호출하지 않는다) */}
      <div className="mt-3 border-t border-gray-100 pt-3">
        {!askAi ? (
          <button type="button" onClick={() => setAskAi(true)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50" data-ask-ai-trend>
            {AI_ORIGIN_TEXT} <T k="해석 요청" />
          </button>
        ) : ai.isLoading ? <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
          : ai.isError ? <QueryErrorFallback error={ai.error} onRetry={ai.refetch} size="compact" />
          : aiTrend?.source === 'UNAVAILABLE' ? <p className="text-xs text-gray-400"><T k="검사 추이 분석: 산출 불가 —" /> {typeof aiTrend.reason === 'string' ? aiTrend.reason : <T k="근거 자료가 없습니다." />}</p>
          : aiTrend?.source === 'FALLBACK' || aiTrend?.trend == null ? <p className="text-xs text-amber-700">{AI_ORIGIN_TEXT} <T k="해석을 받지 못했습니다 — 위 추이를 직접 확인하세요." /></p>
          : (
            <>
              {warnings.includes('MIXED_SCRIPT') && (
                <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800" data-ai-mixed-script>
                  ⚠ {AI_ORIGIN_TEXT} <T k="출력에 한국어가 아닌 문자가 섞였습니다 — 해석 품질을 믿을 수 없습니다. 위 수치를 기준으로 판단하세요." />
                </p>
              )}
              <AiSuggestionPanel title={tAttr('검사 추이 분석')} data={aiTrend} source={aiTrend?.source as string} isLoading={false} compact />
            </>
          )}
      </div>
    </div>
  );
}
