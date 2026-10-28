'use client';

import { useVitalsThresholds } from '@/lib/vital-flags';
import { VitalHeaderCells, VitalRowCells, VitalSignsGrid, VitalSignsStrip } from '@/components/vitals/VitalSigns';

import { VitalsRuleNote } from '@/components/vitals/VitalsRuleNote';
import React, { use, useState, useEffect } from 'react';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { type VitalSignKey, MutationError, stayDays, ADMISSION_STATUS_LABEL, HANDOFF_ILLNESS, HANDOFF_ILLNESS_LABEL } from '@hospital-run/shared';
import { IllnessBadge } from '@/app/(main)/nursing-station/handoff-ui';
import { extractErrorMessage } from '@/lib/error-utils';
import { money, kdate } from '@/lib/ui-settings';

import { EmptyState, Money, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { kstToday } from '@/lib/kst-today';
import { ProgressNoteForm } from './ProgressNoteForm';
import { DeviceLinePanel } from './DeviceLinePanel';
import { DischargeSettlementPrint, type DischargeSettlementData } from './DischargeSettlementPrint';
import { InterimBillingSection } from './InterimBillingSection';
import { DiscontinueDialog } from '@/components/prescription/DiscontinueDialog';
import { useHasRole } from '@/hooks/use-admin-write';
import { useAiAssistantContext } from '@/components/ai/use-ai-assistant-context';

/** 시간별 플로시트 표(2026-10-07 표준 순서 — 종전 BP·HR·BT·SpO2·NRS 순 · 원값 체온 · truthy 혈압) */
const PRINT_VITAL_KEYS = ['spo2', 'systolicBp', 'heartRate', 'temperature', 'painScore'] as const;

/** 안전한 날짜 포맷 — Prisma DateTime이 {}일 때 Invalid Date 방지 */
/** 간호 타임라인 한 줄 — 혈압·맥박만(짧게) */
const TIMELINE_VITAL_KEYS: readonly VitalSignKey[] = ['systolicBp', 'heartRate'];

const safeDate = (d: unknown, format: 'date' | 'datetime' | 'short' = 'date'): string => {
  if (!d) return '-';
  try {
    const dt = new Date(String(d));
    if (isNaN(dt.getTime())) return '-';
    if (format === 'datetime') return kdate(dt, 'datetimeSec'); // 초까지 찍던 표기 — 정보를 줄이지 않는다
    if (format === 'short') return kdate(dt, 'datetimeShort');
    return kdate(dt, 'date');
  } catch { return '-'; }
};

interface AdmissionDetail {
  id: string;
  status: string;
  admitDate: string;
  dischargeDate?: string;
  admitReason?: string;
  dietType?: string;
  patient?: { id?: string; familyName: string; givenName: string; mrn: string };
  bed?: { ward?: { name: string }; roomNumber: string; bedNumber: string };
  admittingDoctor?: { familyName: string; givenName: string };
  progressNotes?: ProgressNote[];
}

interface CareTeamMember {
  id: string;
  role: string;
  assignedAt: string;
  releasedAt?: string;
  reason?: string;
  doctor?: { familyName: string; givenName: string; department?: string };
}

interface RoundRecord {
  id: string;
  roundType: string;
  roundedAt: string;
  assessment?: string;
  plan?: string;
  notes?: string;
  vitalSigns?: Record<string, string>;
  doctor?: { familyName: string; givenName: string };
}

interface BedHistoryItem {
  id: string;
  assignedAt: string;
  releasedAt?: string;
  reason?: string;
  bed?: { ward?: { name: string }; roomNumber: string; bedNumber: string };
}

interface ProgressNote {
  id: string;
  noteDate: string;
  content: string;
  /** PROGRESS | ADMISSION(입원 초진기록·H&P) — 구 응답은 없을 수 있다(없으면 경과기록) */
  noteType?: string;
  doctor?: { familyName: string; givenName: string };
}

interface DoctorOption {
  id: string;
  familyName: string;
  givenName: string;
  department?: string;
}

type Tab = 'overview' | 'vitals' | 'rounds' | 'beds' | 'careTeam' | 'notes' | 'handoffs' | 'interim';

export default function AdmissionDetailPage({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const { user } = useAuthStore();
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admission-detail', admissionId],
    queryFn: () => apiClient.get<{ data: AdmissionDetail }>(`/api/v1/inpatient/${admissionId}`),
  });

  const admission = data?.data;
  // AI 어시스턴트 맥락 — 이 입원 환자를 건다(`/재입원` 은 서버가 이 환자의 실제 입원 건에서 읽는다)
  const aiPt = (admission as { patient?: { id?: string; familyName?: string | null; givenName?: string | null } } | undefined)?.patient;
  useAiAssistantContext(aiPt?.id ? { patientId: aiPt.id, patientName: `${aiPt.familyName ?? ''}${aiPt.givenName ?? ''}`, surface: 'INPATIENT' } : null);

  if (isLoading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (!admission) return <p className="text-red-500 py-10 text-center"><T k="입원 정보를 찾을 수 없습니다." /></p>;

  const patient = admission.patient;
  // 라벨은 정본(ADMISSION_STATUS_LABEL) 경유 — 색상만 로컬. 종전 '전동' 드리프트(정본=전원) 근절.
  const STATUS_COLOR: Record<string, string> = {
    ADMITTED: 'bg-blue-100 text-blue-700',
    DISCHARGED: 'bg-gray-100 text-gray-600',
    TRANSFERRED: 'bg-amber-100 text-amber-700',
  };
  const st = { label: ADMISSION_STATUS_LABEL[admission.status] ?? admission.status, color: STATUS_COLOR[admission.status] ?? 'bg-gray-100' };

  return (
    <div className="max-w-5xl space-y-4">
      {/* 헤더 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/inpatient" className="p-2 hover:bg-gray-100 rounded-lg">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{patient?.familyName}{patient?.givenName}</h2>
              <p className="text-xs text-gray-500">MRN: {patient?.mrn} | {admission.bed?.ward?.name} {admission.bed?.roomNumber}-{admission.bed?.bedNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${st.color}`}>{st.label}</span>
            <span className="text-xs text-gray-400"><T k="입원일" />: {admission.admitDate && !isNaN(new Date(String(admission.admitDate)).getTime()) ?kdate(String(admission.admitDate), 'date') : '-'}</span>
          </div>
        </div>
      </div>

      {/* 역할별 탭 */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {(() => {
          const role = user?.role;
          const allTabs: Array<{ key: Tab; label: string; roles?: string[] }> = [
            { key: 'overview', label: '개요' },
            { key: 'vitals', label: '바이탈 추이' },
            { key: 'careTeam', label: '주치의/진료팀', roles: ['DOCTOR', 'ADMIN'] },
            { key: 'rounds', label: '회진', roles: ['DOCTOR', 'ADMIN'] },
            { key: 'notes', label: '경과 기록', roles: ['DOCTOR', 'ADMIN'] },
            { key: 'handoffs', label: '인수인계' },
            { key: 'beds', label: '병상 이력', roles: ['NURSE', 'ADMIN'] },
            { key: 'interim', label: '중간정산', roles: ['NURSE', 'ADMIN'] },
          ];
          const visibleTabs = allTabs.filter(t => !t.roles || t.roles.includes(role ?? '') || role === 'ADMIN');
          return visibleTabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <T k={t.label} />
            </button>
          ));
        })()}
      </div>

      {/* 입원 대시보드 카드 */}
      <InpatientDashboard admissionId={admissionId} />

      {tab === 'overview' && <OverviewTab admission={admission} />}
      {tab === 'vitals' && <VitalsTrendTab admissionId={admissionId} />}
      {tab === 'careTeam' && <CareTeamTab admissionId={admissionId} admission={admission} />}
      {tab === 'rounds' && <RoundsTab admissionId={admissionId} onOpenNotes={() => setTab('notes')} />}
      {tab === 'beds' && <BedHistoryTab admissionId={admissionId} />}
      {tab === 'notes' && <NotesTab admission={admission} canWrite={user?.role === 'DOCTOR'} />}
      {tab === 'handoffs' && <HandoffSection admissionId={admissionId} patientId={aiPt?.id ?? null} />}
      {tab === 'interim' && <div className="space-y-4"><InterimBillingSection admissionId={admissionId} />{/* 퇴원 정산서 (A-6) — 입원 전체 통합·중간정산 차감 잔액 + ERP export */}<DischargeSettlementCard admissionId={admissionId} /></div>}

      {/* 간호 업무 — 간호사/관리자만 표시 */}
      {(user?.role === 'NURSE' || user?.role === 'ADMIN') && (
        <NursingWorkPanel admissionId={admissionId} />
      )}
    </div>
  );
}

// ── 입원 대시보드 (바이탈/I·O/간호기록/투약) ──

interface FlowSheetRecord { systolicBp?: number; diastolicBp?: number; heartRate?: number; temperature?: number; spo2?: number; respiratoryRate?: number; painScore?: number; recordedAt?: string; shiftType?: string }
interface IoRecord { intakeAmount?: number; outputAmount?: number; intakeType?: string; outputType?: string }
interface NursingNoteRecord { focus?: string; subjective?: string; noteType?: string; recordedAt?: string; action?: string; nurse?: { familyName?: string; givenName?: string } }
interface MARRecord { dose?: string; route?: string; status?: string; scheduledAt?: string; administeredAt?: string; nurse?: { familyName?: string; givenName?: string }; prescriptionId?: string; prescription?: { id: string; status?: string; discontinuedAt?: string | null; medicationCode?: { nameKo?: string } | null } | null }

function InpatientDashboard({ admissionId }: { admissionId: string }) {
  // 이상 판정은 임계 정본(shared + 환자안전위 개정) — 화면이 숫자를 따로 적지 않는다(2026-10-01)
  const vitalsRule = useVitalsThresholds();
  const { data: vitalsData, isError: vitalsIsError, error: vitalsError, refetch: refetchVitals } = useQuery({
    queryKey: ['inpatient-vitals', admissionId],
    queryFn: () => apiClient.get<{ data: FlowSheetRecord | null; history: FlowSheetRecord[] }>(`/api/v1/inpatient/${admissionId}/vitals`),
  });

  const { data: ioData, isError: ioIsError, error: ioError, refetch: refetchIo } = useQuery({
    queryKey: ['inpatient-io', admissionId],
    queryFn: () => apiClient.get<{ data: IoRecord[] }>(`/api/v1/inpatient/${admissionId}/io`),
  });

  const { data: notesData, isError: notesIsError, error: notesError, refetch: refetchNotes } = useQuery({
    queryKey: ['inpatient-notes', admissionId],
    queryFn: () => apiClient.get<{ data: NursingNoteRecord[] }>(`/api/v1/inpatient/${admissionId}/nursing-notes`),
  });

  const { data: marData, isError: marIsError, error: marError, refetch: refetchMar } = useQuery({
    queryKey: ['inpatient-mar', admissionId],
    queryFn: () => apiClient.get<{ data: MARRecord[] }>(`/api/v1/inpatient/${admissionId}/mar`),
  });

  // 바이탈 파싱
  const vitalsRaw = vitalsData as Record<string, unknown> | undefined;
  const latestVitals: FlowSheetRecord | null = (vitalsRaw?.data as FlowSheetRecord) ?? null;
  const vitalsHistory: FlowSheetRecord[] = ((vitalsRaw?.history as FlowSheetRecord[]) ?? []).slice().reverse();

  // I/O 파싱
  const ioRaw = ioData?.data as IoRecord[] | { data?: IoRecord[] } | undefined;
  const ioList: IoRecord[] = Array.isArray(ioRaw) ? ioRaw : ((ioRaw as { data?: IoRecord[] } | undefined)?.data ?? []);
  const totalIntake = ioList.reduce((s: number, r: IoRecord) => s + (r.intakeAmount ?? 0), 0);
  const totalOutput = ioList.reduce((s: number, r: IoRecord) => s + (r.outputAmount ?? 0), 0);

  // 간호기록 파싱
  const notesRaw = notesData?.data as NursingNoteRecord[] | { data?: NursingNoteRecord[] } | undefined;
  const notes: NursingNoteRecord[] = Array.isArray(notesRaw) ? notesRaw : ((notesRaw as { data?: NursingNoteRecord[] } | undefined)?.data ?? []);

  // 투약 파싱
  const marRaw = marData?.data as MARRecord[] | { data?: MARRecord[] } | undefined;
  const marList: MARRecord[] = Array.isArray(marRaw) ? marRaw : ((marRaw as { data?: MARRecord[] } | undefined)?.data ?? []);
  const todayMAR = marList.filter(m => {
    const d = m.scheduledAt ? new Date(m.scheduledAt) : null;
    return d && d.toDateString() === new Date().toDateString();
  });
  const administered = todayMAR.filter(m => m.status === 'ADMINISTERED').length;
  const scheduled = todayMAR.filter(m => m.status === 'SCHEDULED').length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      {/* 최근 바이탈 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <T k="최근 바이탈" />
        </h4>
        {vitalsIsError ? (
          <QueryErrorFallback error={vitalsError} onRetry={() => refetchVitals()} size="compact" />
        ) : latestVitals ? (
          <div className="space-y-1.5 text-sm">
            {/* 🔴 미측정을 정상값으로 접지 않는다(종전 `?? 0`·`?? 200`) — 부품이 미측정 '—'·표준 순서·단위·서버 임계 색을 정한다.
                종전 BT 는 formatTemp(℃ 포함) 뒤에 °C 를 또 붙여 "36.8℃°C" 였다. */}
            <VitalSignsGrid vitals={latestVitals as Record<string, unknown>} rule={vitalsRule} columns={2} measuredAt={latestVitals.recordedAt ?? null} />
            <VitalsRuleNote rule={vitalsRule} />
            {/* 미니 스파크라인 */}
            {vitalsHistory.length >= 3 && (
              <div className="mt-2 pt-2 border-t border-gray-50">
                {[
                  { key: 'systolicBp', label: 'BP', color: '#dc2626', min: 80, max: 180 },
                  { key: 'heartRate', label: 'HR', color: '#db2777', min: 50, max: 120 },
                ].map(cfg => {
                  const values = vitalsHistory.map(r => Number((r as Record<string, unknown>)[cfg.key] ?? 0)).filter(v => v > 0);
                  if (values.length < 3) return null;
                  const w = 80; const h = 20;
                  const range = cfg.max - cfg.min || 1;
                  const points = values.slice(-8).map((v, i, a) => `${(i / (a.length - 1)) * w},${h - ((v - cfg.min) / range) * h}`).join(' ');
                  return (
                    <div key={cfg.key} className="flex items-center gap-1.5">
                      <span className="text-[9px] text-gray-400 w-5">{cfg.label}</span>
                      <svg viewBox={`0 0 ${w} ${h}`} className="w-16 h-4 flex-shrink-0">
                        <polyline points={points} fill="none" stroke={cfg.color} strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400"><T k="바이탈 데이터 없음" /></p>
        )}
      </div>

      {/* 오늘 I/O */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <T k="오늘 I/O" />
        </h4>
        {ioIsError ? (
          <QueryErrorFallback error={ioError} onRetry={() => refetchIo()} size="compact" />
        ) : ioList.length > 0 ? (
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500"><T k="섭취" /></span>
              <span className="font-bold text-blue-600">{totalIntake.toLocaleString()} mL</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500"><T k="배출" /></span>
              <span className="font-bold text-amber-600">{totalOutput.toLocaleString()} mL</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-xs">
              <span className="text-gray-500"><T k="균형" /></span>
              <span className={`font-bold ${totalIntake - totalOutput > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {totalIntake - totalOutput > 0 ? '+' : ''}{(totalIntake - totalOutput).toLocaleString()} mL
              </span>
            </div>
            <div className="text-[10px] text-gray-400 mt-1">{ioList.length}<Unit>건</Unit> <T k="기록@명사" /></div>
          </div>
        ) : (
          <p className="text-xs text-gray-400"><T k="오늘 I/O 기록 없음" /></p>
        )}
      </div>

      {/* 투약 현황 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-orange-500" />
          <T k="오늘 투약" />
        </h4>
        {marIsError ? (
          <QueryErrorFallback error={marError} onRetry={() => refetchMar()} size="compact" />
        ) : todayMAR.length > 0 ? (
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500"><T k="투여 완료" /></span>
              <span className="font-bold text-green-600">{administered}<Unit>건</Unit></span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500"><T k="예정@투약" /></span>
              <span className="font-bold text-amber-600">{scheduled}<Unit>건</Unit></span>
            </div>
            <div className="border-t pt-2">
              {todayMAR.filter(m => m.status === 'SCHEDULED').slice(0, 2).map((m, i) => (
                <div key={i} className="text-[10px] text-gray-500 mt-1">
                  <span className="bg-amber-50 text-amber-700 px-1 py-0.5 rounded whitespace-nowrap">{m.scheduledAt ? kdate(m.scheduledAt, 'time') : ''}</span>
                  <span className="ml-1">{m.dose}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-gray-400"><T k="오늘 투약 스케줄 없음" /></p>
            {marList.length > 0 && <p className="text-[10px] text-gray-400"><T k="전체" /> {marList.length}<Unit>건</Unit> <T k="기록@명사" /></p>}
          </div>
        )}
      </div>

      {/* 최근 간호 기록 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-violet-500" />
          <T k="최근 간호 기록" />
        </h4>
        {notesIsError ? (
          <QueryErrorFallback error={notesError} onRetry={() => refetchNotes()} size="compact" />
        ) : notes.length > 0 ? (
          <div className="space-y-2">
            {notes.slice(0, 3).map((n: NursingNoteRecord, i: number) => (
              <div key={i} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${n.noteType === 'SOAP' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                    {n.noteType === 'SOAP' ? 'SOAP' : n.focus ?? '기록'}
                  </span>
                  <span className="text-gray-400 text-[10px]">
                    {n.recordedAt ? safeDate(n.recordedAt) : ''}
                  </span>
                </div>
                {n.noteType === 'SOAP' && n.subjective && <p className="text-gray-500 text-[10px] mt-0.5 truncate">S: {n.subjective}</p>}
                {n.noteType !== 'SOAP' && n.action && <p className="text-gray-500 text-[10px] mt-0.5 truncate">{n.action}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400"><T k="간호 기록 없음" /></p>
        )}
      </div>
    </div>
  );
}

// ── 개요 ──
function OverviewTab({ admission }: { admission: AdmissionDetail }) {
  const tAttr = useTAttr();
  const vitalsRule = useVitalsThresholds();
  // FlowSheet 기반 바이탈 트렌드
  const { data: flowsheetData, isError: fsIsError, error: fsError, refetch: refetchFs } = useQuery({
    queryKey: ['flowsheet', admission.id],
    queryFn: () => apiClient.get<{ data: FlowSheetRecord[] }>(`/api/v1/inpatient/${admission.id}/flowsheet`),
  });

  const _fsRaw = flowsheetData?.data as FlowSheetRecord[] | { data?: FlowSheetRecord[] } | undefined;
  const flowsheet: FlowSheetRecord[] = Array.isArray(_fsRaw) ? _fsRaw : ((_fsRaw as { data?: FlowSheetRecord[] } | undefined)?.data ?? []);
  const vitalsHistory = flowsheet.filter(r => r.systolicBp != null || r.heartRate != null).slice(-12);
  const latestVitals = vitalsHistory.length > 0 ? vitalsHistory[vitalsHistory.length - 1] : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900"><T k="입원 정보" /></h3>
          <InfoRow label={tAttr('입원일')} value={admission.admitDate && !isNaN(new Date(String(admission.admitDate)).getTime()) ? kdate(String(admission.admitDate), 'datetimeSec') : '-'} />
          <InfoRow label={tAttr('퇴원일')} value={safeDate(admission.dischargeDate, 'datetime') === '-' ? '—' : safeDate(admission.dischargeDate, 'datetime')} />
          <InfoRow label={tAttr('입원 사유')} value={admission.admitReason ?? '—'} />
          <InfoRow label={tAttr('식이')} value={admission.dietType ?? '일반식'} />
          <InfoRow label={tAttr('입원의')} value={`${admission.admittingDoctor?.familyName ?? ''}${admission.admittingDoctor?.givenName ?? ''}`} />
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900"><T k="병실 정보" /></h3>
          <InfoRow label={tAttr('병동')} value={admission.bed?.ward?.name ?? '—'} />
          <InfoRow label={tAttr('병실')} value={`${admission.bed?.roomNumber ?? ''}-${admission.bed?.bedNumber ?? ''}`} />
          {/* 재원일수 정본(입원료 청구와 동일 산식·당일 입퇴원=1일) */}
          <InfoRow label={tAttr('재원일수')} value={admission.dischargeDate
            ? `${stayDays(admission.admitDate, admission.dischargeDate) ?? '-'}일`
            : `${stayDays(admission.admitDate) ?? '-'}일 (진행중)`} />
        </div>
      </div>

      {/* 최신 바이탈 + 트렌드 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4"><T k="바이탈 사인" /></h3>
        {fsIsError ? (
          <QueryErrorFallback error={fsError} onRetry={() => refetchFs()} size="compact" />
        ) : latestVitals ? (
          <>
            {/* 🔴 임계를 화면에 적지 않는다 · 측정된 0 을 버리지 않는다 · 혈압은 한 값 — 부품 정본(서버 임계) */}
            <VitalSignsGrid vitals={latestVitals as Record<string, unknown>} rule={vitalsRule} columns={6} measuredAt={latestVitals.recordedAt ?? null} className="mb-4" />
            <VitalsRuleNote rule={vitalsRule} className="mb-3" />
            {/* 스파크라인 트렌드 (FlowSheet 기반) */}
            {vitalsHistory.length >= 2 && (
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'systolicBp', label: '혈압 (SBP)', color: '#dc2626', min: 70, max: 200 },
                  { key: 'heartRate', label: '심박수 (HR)', color: '#db2777', min: 40, max: 140 },
                  { key: 'temperature', label: '체온 (BT)', color: '#d97706', min: 35, max: 40 },
                  { key: 'spo2', label: '산소포화도 (SpO2)', color: '#2563eb', min: 85, max: 100 },
                ].map(cfg => {
                  const values = vitalsHistory.map(r => Number((r as Record<string, unknown>)[cfg.key] ?? 0)).filter(v => v > 0);
                  if (values.length < 2) return null;
                  const range = cfg.max - cfg.min || 1;
                  const w = 200;
                  const h = 40;
                  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - cfg.min) / range) * h}`).join(' ');
                  const lastVal = values[values.length - 1];
                  return (
                    <div key={cfg.key} className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-[10px] text-gray-400 mb-1"><T k={cfg.label} /></p>
                        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8">
                          <polyline points={points} fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <span className="text-sm font-bold" style={{ color: cfg.color }}>{lastVal}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="🩺" title="바이탈 기록이 없습니다." />
        )}
      </div>

      {/* 경과기록 타임라인 + 활성 오더 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 최근 경과기록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3"><T k="최근 경과기록" /></h3>
          {(admission.progressNotes?.length ?? 0) > 0 ? (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {admission.progressNotes!.slice(0, 5).map((n: ProgressNote) => (
                <div key={n.id} className="relative pl-4 border-l-2 border-blue-200">
                  <div className="absolute -left-1.5 top-1 w-3 h-3 bg-blue-500 rounded-full" />
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-gray-900">{n.doctor?.familyName}{n.doctor?.givenName}</span>
                    <span className="text-[10px] text-gray-400">{safeDate(n.noteDate)}</span>
                  </div>
                  <p className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-3">{n.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="📝" title="경과기록이 없습니다." />
          )}
        </div>

        {/* 활성 처방/오더 */}
        <ActiveOrdersPanel admissionId={admission.id} />

        {/* 삽입 기구 원장 — 기구 관련 감염률 분모가 될 수 있는 기록(2026-10-09) */}
        <DeviceLinePanel admissionId={admission.id} patientId={admission.patient?.id ?? null} />
      </div>
    </div>
  );
}

function ActiveOrdersPanel({ admissionId }: { admissionId: string }) {
  const tAttr = useTAttr();
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['inpatient-mar-overview', admissionId],
    queryFn: () => apiClient.get<{ data: MARRecord[] }>(`/api/v1/inpatient/${admissionId}/mar`),
  });

  const marRaw = data?.data;
  const marList: MARRecord[] = Array.isArray(marRaw) ? marRaw : ((marRaw as { data?: MARRecord[] } | undefined)?.data ?? []);
  const active = marList.filter(m => m.status === 'SCHEDULED' || m.status === 'ADMINISTERED');
  // 🔴 종전엔 용량 문자열로 묶어 같은 '500mg' 인 다른 약이 한 줄로 합쳐지고 약 이름도 없었다 — 처방 단위로 묶는다(2026-09-30)
  const grouped = active.reduce<Record<string, MARRecord[]>>((acc, m) => {
    const key = m.prescription?.id ?? m.prescriptionId ?? `dose:${m.dose ?? '?'}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});
  const canStop = useHasRole('DOCTOR');
  const [stopTarget, setStopTarget] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-3"><T k="활성 처방/투약" /></h3>
      {stopTarget && (
        <DiscontinueDialog prescriptionId={stopTarget.id} name={stopTarget.name}
          onClose={() => setStopTarget(null)} onDone={() => { void refetch(); }} />
      )}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      ) : Object.keys(grouped).length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {Object.entries(grouped).map(([key, records]) => {
            const administered = records.filter(r => r.status === 'ADMINISTERED').length;
            const scheduled = records.filter(r => r.status === 'SCHEDULED').length;
            const route = records[0]?.route ?? '';
            const rx = records[0]?.prescription;
            const name = rx?.medicationCode?.nameKo ?? records[0]?.dose ?? '—';
            return (
              <div key={key} className="flex items-center justify-between gap-2 p-2.5 bg-gray-50 rounded-xl" data-mar-group={key}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">{name}</p>
                  <p className="text-[10px] text-gray-400">{[records[0]?.dose, route].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {rx?.status === 'DISCONTINUED' && <span className="text-[10px] bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded whitespace-nowrap font-semibold"><T k="중단" /></span>}
                  {administered > 0 && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="투여" /> {administered}</span>}
                  {scheduled > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="예정@투약" /> {scheduled}</span>}
                  {canStop && rx?.id && rx.status === 'ACTIVE' && (
                    <button type="button" onClick={() => setStopTarget({ id: rx.id, name })} data-rx-stop={rx.id}
                      className="min-h-[36px] rounded-lg border border-gray-300 bg-white px-2.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100">
                      <T k="중단" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="💊" title="활성 처방이 없습니다." />
      )}
    </div>
  );
}

// ── 주치의/진료팀 ──
function CareTeamTab({ admissionId, admission }: { admissionId: string; admission: AdmissionDetail }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showChange, setShowChange] = useState(false);
  const [newDoctorId, setNewDoctorId] = useState('');
  const [reason, setReason] = useState('');
  const [handoffNote, setHandoffNote] = useState('');

  const { data: attendingData } = useQuery({
    queryKey: ['attending', admissionId],
    queryFn: () => apiClient.get<{ data: CareTeamMember }>(`/api/v1/inpatient/${admissionId}/attending`),
  });
  const { data: teamData } = useQuery({
    queryKey: ['care-team', admissionId],
    queryFn: () => apiClient.get<{ data: CareTeamMember[] }>(`/api/v1/inpatient/${admissionId}/care-team`),
  });
  const { data: doctorsRes } = useQuery({
    queryKey: ['doctors-only'],
    queryFn: () => apiClient.get<{ data: DoctorOption[] }>('/api/v1/users/doctors'),
    staleTime: 5 * 60 * 1000,
  });
  const _doctorsRaw = doctorsRes?.data;
  const doctors: DoctorOption[] = Array.isArray(_doctorsRaw) ? _doctorsRaw : (_doctorsRaw as Record<string, unknown> | undefined)?.data as DoctorOption[] ?? [];

  const changeMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/inpatient/${admissionId}/attending`, { newDoctorId, reason, handoffNote }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attending', admissionId] });
      qc.invalidateQueries({ queryKey: ['care-team', admissionId] });
      qc.invalidateQueries({ queryKey: ['admission-detail', admissionId] });
      qc.invalidateQueries({ queryKey: ['inpatients'] });
      setShowChange(false); setNewDoctorId(''); setReason(''); setHandoffNote('');
      toast.success('주치의가 변경되었습니다.');
    },
    onError: (e: MutationError) => toast.error(e.message ?? '오류가 발생했습니다.'),
  });

  const _attRaw = attendingData?.data as Record<string, unknown> | CareTeamMember | undefined;
  const current: CareTeamMember | null = (_attRaw as { data?: CareTeamMember })?.data ?? (_attRaw as CareTeamMember) ?? null;
  const _teamRaw = teamData?.data;
  const team: CareTeamMember[] = Array.isArray(_teamRaw) ? _teamRaw : (_teamRaw as Record<string, unknown> | undefined)?.data as CareTeamMember[] ?? [];
  // doctors는 useEffect에서 설정됨
  // ChargeOfCare 없으면 admittingDoctor로 fallback
  const fallbackDoctor = !current ? admission?.admittingDoctor : null;

  return (
    <div className="space-y-4">
      {/* 현재 주치의 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900"><T k="현재 주치의" /></h3>
          <button onClick={() => setShowChange(!showChange)} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <T k="주치의 변경" />
          </button>
        </div>
        {(current || fallbackDoctor) ? (
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" /></svg>
            </div>
            <div>
              <p className="font-bold text-gray-900">
                {current ? `${current.doctor?.familyName ?? ''}${current.doctor?.givenName ?? ''}` || '미배정' : `${fallbackDoctor?.familyName ?? ''}${fallbackDoctor?.givenName ?? ''}` || '미배정'}
              </p>
              <p className="text-xs text-gray-500">
                {current ? `${current.doctor?.department ?? ''} | ${current.role ?? ''}`.replace(/^ \| $/, '') : <T k="입원 담당의 (ChargeOfCare 미등록)" />}
              </p>
              {current?.assignedAt && !isNaN(new Date(String(current.assignedAt)).getTime()) && <p className="text-xs text-gray-400"><T k="배정" />: {kdate(String(current.assignedAt), 'datetimeSec')}</p>}
              {!current && fallbackDoctor && (
                <p className="text-xs text-amber-500 mt-1"><T k="이전에 입원된 환자입니다. 주치의 변경으로 정식 배정하세요." /></p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400"><T k="주치의가 배정되지 않았습니다." /></p>
        )}
      </div>

      {/* 주치의 변경 폼 */}
      {showChange && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-3">
          <h4 className="text-sm font-bold text-blue-900"><T k="주치의 변경" /></h4>
          <select value={newDoctorId} onChange={e => setNewDoctorId(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="">{tAttr('새 주치의 선택')}</option>
            {doctors.map((d: DoctorOption) => <option key={d.id} value={d.id}>{d.familyName}{d.givenName} ({d.department ?? ''})</option>)}
          </select>
          <select value={reason} onChange={e => setReason(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="">{tAttr('변경 사유 선택')}</option>
            <option value="전과">{tAttr('전과')}</option>
            <option value="퇴직">{tAttr('퇴직')}</option>
            <option value="장기부재">{tAttr('장기부재')}</option>
            <option value="환자요청">{tAttr('환자 요청')}</option>
            <option value="기타">{tAttr('기타')}</option>
          </select>
          <textarea value={handoffNote} onChange={e => setHandoffNote(e.target.value)} placeholder={tAttr('인계 내용 (현재 투약, 주의사항 등)')} rows={3} className="w-full px-3 py-2 border rounded-lg text-sm" />
          <div className="flex gap-2">
            <button onClick={() => changeMut.mutate()} disabled={!newDoctorId || !reason}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"><T k="변경" /></button>
            <button onClick={() => setShowChange(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm"><T k="취소" /></button>
          </div>
        </div>
      )}

      {/* 진료팀 이력 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-3"><T k="진료팀 이력" /></h3>
        <div className="space-y-2">
          {team.map((c: CareTeamMember) => (
            <div key={c.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
              <div>
                <span className="text-sm font-medium text-gray-900">{c.doctor?.familyName}{c.doctor?.givenName}</span>
                <span className="text-xs text-gray-400 ml-2">{c.doctor?.department}</span>
                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded ml-2">{c.role}</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">{safeDate(c.assignedAt)} ~ {c.releasedAt ? safeDate(c.releasedAt) : <T k="현재" />}</p>
                {c.reason && <p className="text-[10px] text-gray-400">{c.reason}</p>}
              </div>
            </div>
          ))}
          {team.length === 0 && <EmptyState icon="📝" title="이력이 없습니다." />}
        </div>
      </div>
    </div>
  );
}

// ── 회진 ──
function RoundsTab({ admissionId, onOpenNotes }: { admissionId: string; onOpenNotes: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const initForm = {
    roundType: 'MORNING', assessment: '', plan: '', notes: '',
    vitalSigns: { sbp: '', dbp: '', hr: '', rr: '', bt: '', spo2: '' },
    // 🔴 일일 SOAP(S/O)은 여기서 받지 않는다 — 정본은 경과기록(ProgressNote · 「경과 기록」 탭). 종전엔 S/O 를
    //    `Round.notes` 에 섞어 두 곳에 갈라 쌓았다. 회진 폼은 회진 사건(유형·상태·활력·회진 소견 A/P·오더 변경)만.
    // 🔴 쓰기 폼 초기값은 미선택 — 종전엔 환자 상태가 '안정'으로 미리 골라져 누르지 않아도 '[상태] STABLE' 이 저장됐다.
    dietChange: '', activityLevel: '', painScore: '',
    orderChanges: '', pendingResults: '', patientCondition: '',
  };
  const [form, setForm] = useState(initForm);

  const { data } = useQuery({
    queryKey: ['rounds', admissionId],
    queryFn: () => apiClient.get<{ data: RoundRecord[] }>(`/api/v1/inpatient/${admissionId}/rounds`),
  });

  const addMut = useMutation({
    mutationFn: () => {
      const payload = {
        roundType: form.roundType,
        assessment: form.assessment,
        plan: form.plan,
        notes: [
          form.dietChange && `[식이] ${form.dietChange}`,
          form.activityLevel && `[활동] ${form.activityLevel}`,
          form.painScore && `[통증] NRS ${form.painScore}/10`,
          form.orderChanges && `[오더변경] ${form.orderChanges}`,
          form.pendingResults && `[대기결과] ${form.pendingResults}`,
          form.patientCondition && `[상태] ${form.patientCondition}`,
          form.notes && form.notes,
        ].filter(Boolean).join('\n'),
        vitalSigns: Object.fromEntries(Object.entries(form.vitalSigns).filter(([, v]) => v !== '')),
      };
      return apiClient.post(`/api/v1/inpatient/${admissionId}/rounds`, payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rounds', admissionId] }); setShowForm(false); setForm(initForm); toast.success('회진 기록 저장'); },
    onError: (e: MutationError) => toast.error(e.message ?? '오류가 발생했습니다.'),
  });

  const _roundsRaw = data?.data;
  const rounds: RoundRecord[] = Array.isArray(_roundsRaw) ? _roundsRaw : (_roundsRaw as Record<string, unknown> | undefined)?.data as RoundRecord[] ?? [];
  const TYPE_LABEL: Record<string, string> = { MORNING: '아침 회진', EVENING: '저녁 회진', NIGHT: '야간 회진', AD_HOC: '수시 회진' };
  const CONDITION_LABEL: Record<string, { label: string; color: string }> = {
    STABLE: { label: '안정', color: 'bg-green-100 text-green-700' },
    IMPROVING: { label: '호전', color: 'bg-blue-100 text-blue-700' },
    UNCHANGED: { label: '변화없음', color: 'bg-gray-100 text-gray-600' },
    WORSENING: { label: '악화', color: 'bg-red-100 text-red-700' },
    CRITICAL: { label: '위중', color: 'bg-red-600 text-white' },
  };

  const vs = form.vitalSigns;
  const setVs = (k: string, v: string) => setForm({ ...form, vitalSigns: { ...form.vitalSigns, [k]: v } });

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-sm text-gray-500"><T k="총" /> {rounds.length}<Unit>건</Unit></p>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">+ <T k="회진 기록" /></button>
      </div>

      {showForm && (
        <div className="bg-white border border-blue-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-blue-600 px-5 py-3 text-white font-semibold text-sm"><T k="회진 기록 작성" /></div>
          <div className="p-5 space-y-4">
            {/* 회진 유형 + 환자 상태 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1"><T k="회진 유형" /></label>
                <select value={form.roundType} onChange={e => setForm({ ...form, roundType: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="MORNING">{tAttr('아침 회진')}</option><option value="EVENING">{tAttr('저녁 회진')}</option><option value="NIGHT">{tAttr('야간 회진')}</option><option value="AD_HOC">{tAttr('수시 회진')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1"><T k="환자 상태" /></label>
                <div className="flex gap-1 flex-wrap">
                  {Object.entries(CONDITION_LABEL).map(([k, { label, color }]) => (
                    <button key={k} onClick={() => setForm({ ...form, patientCondition: k })}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${form.patientCondition === k ? color + ' ring-1 ring-offset-1' : 'bg-white text-gray-400 border-gray-200'}`}><T k={label} /></button>
                  ))}
                </div>
              </div>
            </div>

            {/* 활력징후 */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2"><T k="활력징후 (Vital Signs)" /></label>
              <div className="grid grid-cols-6 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-400"><T k="수축기 BP" /></label>
                  <input value={vs.sbp} onChange={e => setVs('sbp', e.target.value)} placeholder="mmHg" className="w-full px-2 py-1.5 border rounded text-sm text-center" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400"><T k="이완기 BP" /></label>
                  <input value={vs.dbp} onChange={e => setVs('dbp', e.target.value)} placeholder="mmHg" className="w-full px-2 py-1.5 border rounded text-sm text-center" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400"><T k="맥박 HR" /></label>
                  <input value={vs.hr} onChange={e => setVs('hr', e.target.value)} placeholder={tAttr('회/분')} className="w-full px-2 py-1.5 border rounded text-sm text-center" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400"><T k="호흡 RR" /></label>
                  <input value={vs.rr} onChange={e => setVs('rr', e.target.value)} placeholder={tAttr('회/분')} className="w-full px-2 py-1.5 border rounded text-sm text-center" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400"><T k="체온 BT" /></label>
                  <input value={vs.bt} onChange={e => setVs('bt', e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm text-center" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">SpO2</label>
                  <input value={vs.spo2} onChange={e => setVs('spo2', e.target.value)} placeholder="%" className="w-full px-2 py-1.5 border rounded text-sm text-center" />
                </div>
              </div>
            </div>

            {/* 일일 SOAP 정본 안내 — S/O 를 여기 적으면 경과기록과 두 벌이 된다 */}
            <div className="flex items-center justify-between gap-3 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2" data-testid="rounds-soap-canon-link">
              <p className="text-xs text-indigo-800"><T k="일일 경과기록(SOAP)은 「경과 기록」 탭에 작성합니다. 회진 기록에는 회진 소견만 남깁니다." /></p>
              <button type="button" onClick={onOpenNotes} className="min-h-[44px] px-3 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg whitespace-nowrap">
                <T k="경과 기록 작성으로 이동" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1"><T k="A — 평가/진단" /></label>
                <textarea value={form.assessment} onChange={e => setForm({ ...form, assessment: e.target.value })} placeholder={tAttr('현재 상태 평가, 경과 판단...')} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1"><T k="P — 치료 계획" /></label>
                <textarea value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })} placeholder={tAttr('투약 변경, 검사 추가, 수술 계획, 퇴원 계획 등...')} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
            </div>

            {/* 추가 항목 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1"><T k="통증 (NRS 0~10)" /></label>
                <div className="flex items-center gap-2">
                  <input type="range" min="0" max="10" value={form.painScore || '0'} onChange={e => setForm({ ...form, painScore: e.target.value })} className="flex-1" />
                  {/* 움직이지 않았으면 미측정('—') — 0 으로 그리면 "통증 없음"을 잰 것처럼 보인다 */}
                  <span className={`text-sm font-bold w-6 text-center ${form.painScore === '' ? 'text-gray-400' : Number(form.painScore) >= 7 ? 'text-red-600' : Number(form.painScore) >= 4 ? 'text-amber-600' : 'text-green-600'}`}>{form.painScore === '' ? '—' : form.painScore}</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1"><T k="식이 변경" /></label>
                <input value={form.dietChange} onChange={e => setForm({ ...form, dietChange: e.target.value })} placeholder={tAttr('예: NPO→유동식, 일반식 유지')} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1"><T k="활동 수준" /></label>
                <select value={form.activityLevel} onChange={e => setForm({ ...form, activityLevel: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="">{tAttr('선택')}</option>
                  <option value="절대안정 (Bed Rest)">{tAttr('절대안정 (Bed Rest)')}</option>
                  <option value="침상안정 (Bed Rest with BRP)">{tAttr('침상안정 (BRP)')}</option>
                  <option value="제한활동 (Limited)">{tAttr('제한활동')}</option>
                  <option value="보조보행 (Assisted)">{tAttr('보조보행')}</option>
                  <option value="자유보행 (Ad lib)">{tAttr('자유보행')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1"><T k="오더 변경 사항" /></label>
                <textarea value={form.orderChanges} onChange={e => setForm({ ...form, orderChanges: e.target.value })} placeholder={tAttr('투약 추가/변경/중단, 검사 추가 등...')} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1"><T k="대기 중 결과/참고 사항" /></label>
                <textarea value={form.pendingResults} onChange={e => setForm({ ...form, pendingResults: e.target.value })} placeholder={tAttr('대기 중인 검사 결과, 타과 의뢰 결과 등...')} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
            </div>

            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={tAttr('기타 메모 (가족 상담, 특이사항 등)')} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />

            <div className="flex gap-2 pt-2 border-t">
              <button onClick={() => addMut.mutate()} disabled={addMut.isPending} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {addMut.isPending ? <T k="저장 중..." /> : <T k="회진 기록 저장" />}
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {rounds.length === 0 ? (
          <EmptyState icon="📝" title="회진 기록이 없습니다." />
        ) : (
          <div className="divide-y divide-gray-50">
            {rounds.map((r: RoundRecord) => {
              const vs = r.vitalSigns ?? {};
              return (
              <div key={r.id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded"><T k={TYPE_LABEL[r.roundType] ?? r.roundType} /></span>
                    <span className="text-sm font-medium text-gray-900">{r.doctor?.familyName}{r.doctor?.givenName}</span>
                  </div>
                  <span className="text-xs text-gray-400">{safeDate(r.roundedAt, 'datetime')}</span>
                </div>
                {/* Vital Signs */}
                {Object.keys(vs).length > 0 && (
                  <div className="flex gap-3 mb-2 flex-wrap">
                    {vs.sbp && vs.dbp && <span className="text-[11px] bg-red-50 text-red-700 px-2 py-0.5 rounded">BP {vs.sbp}/{vs.dbp}</span>}
                    {vs.hr && <span className="text-[11px] bg-pink-50 text-pink-700 px-2 py-0.5 rounded">HR {vs.hr}</span>}
                    {vs.rr && <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded">RR {vs.rr}</span>}
                    {vs.bt && <span className="text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded">BT {vs.bt}°C</span>}
                    {vs.spo2 && <span className="text-[11px] bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded">SpO2 {vs.spo2}<Unit>%</Unit></span>}
                  </div>
                )}
                {r.assessment && <p className="text-sm text-gray-700 mb-1"><span className="text-xs font-semibold text-gray-400 mr-1">A</span>{r.assessment}</p>}
                {r.plan && <p className="text-sm text-gray-700 mb-1"><span className="text-xs font-semibold text-gray-400 mr-1">P</span>{r.plan}</p>}
                {r.notes && <p className="text-sm text-gray-500 whitespace-pre-wrap mt-2 bg-gray-50 rounded-lg p-3 text-xs">{r.notes}</p>}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 병상 이력 ──
function BedHistoryTab({ admissionId }: { admissionId: string }) {
  const tAttr = useTAttr();
  const { data } = useQuery({
    queryKey: ['bed-history', admissionId],
    queryFn: () => apiClient.get<{ data: BedHistoryItem[] }>(`/api/v1/inpatient/${admissionId}/bed-history`),
  });

  const _historyRaw = data?.data;
  const history: BedHistoryItem[] = Array.isArray(_historyRaw) ? _historyRaw : (_historyRaw as Record<string, unknown> | undefined)?.data as BedHistoryItem[] ?? [];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4"><T k="병상 이동 이력" /></h3>
      {history.length === 0 ? (
        <EmptyState icon="📝" title="이동 이력이 없습니다." />
      ) : (
        <div className="space-y-3">
          {history.map((b: BedHistoryItem) => (
            <div key={b.id} className="flex items-center gap-4">
              <div className={`w-3 h-3 rounded-full ${!b.releasedAt ? 'bg-blue-500' : 'bg-gray-300'}`} />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{b.bed?.ward?.name} {b.bed?.roomNumber}-{b.bed?.bedNumber}</p>
                <p className="text-xs text-gray-400">
                  {safeDate(b.assignedAt, 'datetime')} ~ {b.releasedAt ? safeDate(b.releasedAt, 'datetime') : <T k="현재" />}
                </p>
              </div>
              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{b.reason ?? ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 경과 기록 ──
// 일일 SOAP 정본 = 경과기록(ProgressNote). 쓰기 폼은 `ProgressNoteForm`(EP 는 DOCTOR 전용 — 다른 역할에겐 폼 대신 사실을 말한다).
function NotesTab({ admission, canWrite }: { admission: AdmissionDetail; canWrite: boolean }) {
  const notes = admission.progressNotes ?? [];
  return (
    <div className="space-y-4">
      {canWrite ? (
        <ProgressNoteForm admissionId={admission.id} />
      ) : (
        <p className="text-xs text-gray-500" data-testid="progress-note-readonly"><T k="경과기록 작성은 의사 계정만 할 수 있습니다." /></p>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4"><T k="경과 기록" /> ({notes.length}<Unit>건</Unit>)</h3>
        {notes.length === 0 ? (
          <EmptyState icon="📝" title="경과 기록이 없습니다." />
        ) : (
          <div className="space-y-3">
            {notes.map((n: ProgressNote) => (
              <div key={n.id} className="border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                    {n.noteType === 'ADMISSION' && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"><T k="입원 초진기록(H&P)" /></span>}
                    {n.doctor?.familyName}{n.doctor?.givenName}
                  </span>
                  <span className="text-xs text-gray-400">{safeDate(n.noteDate)}</span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 인수인계 (I-PASS) ──
/**
 * 🔴 (2026-10-04) 이 폼은 **개통 이래 한 번도 저장되지 않았다**(운영 실호출 400) —
 *    `patientId`·`toDoctorId` 를 빈 문자열로 보냈고(서버 IsUUID), 중증도는 자유 입력(`예: 안정 / 주의 / 위중`)이라
 *    DTO 어휘(`STABLE·UNSTABLE·CRITICAL`) 밖이었다. 상황 인식·종합은 요약 글자에만 붙고 필드로는 가지 않았다.
 *  · 환자 = 이 입원의 환자(서버도 입원↔환자 일치를 검사) · 인수자 = 고른 사람(의사는 의사, 그 외는 다음 근무조 제안 + 간호사)
 *  · 중증도는 정본 어휘에서 고른다(초기값 미선택 — 고르기 전엔 저장 불가) · I-PASS 다섯 칸을 필드로 보낸다
 */
function HandoffSection({ admissionId, patientId }: { admissionId: string; patientId: string | null }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const myRole = useAuthStore((st) => st.user?.role);
  const isDoctor = myRole === 'DOCTOR';
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    illness: '', patientSummary: '', actionList: '',
    situationAwareness: '', synthesis: '', toUserId: '',
  });

  // 인수자 후보 — 의사 인계는 의사, 그 외(간호)는 간호사 + 다음 근무조 근무표 제안(`/nurse-station` 과 같은 출처)
  const recipientsQ = useQuery({
    queryKey: ['handoff-recipients', isDoctor ? 'DOCTOR' : 'NURSE'],
    queryFn: () => apiClient.get<{ data: { id: string; familyName?: string; givenName?: string }[] }>(`/api/v1/users?role=${isDoctor ? 'DOCTOR' : 'NURSE'}`),
    enabled: showForm,
    staleTime: 5 * 60 * 1000,
  });
  const recipients = recipientsQ.data?.data ?? [];
  const nextShiftQ = useQuery({
    queryKey: ['handoff-next-shift-nurses'],
    queryFn: () => apiClient.get<{ data: { nextShift?: string; entries?: { staffId: string; staffName: string }[] } }>('/api/v1/handoffs/next-shift-nurses'),
    enabled: showForm && !isDoctor,
    staleTime: 60_000,
  });
  const suggested = isDoctor ? [] : (nextShiftQ.data?.data?.entries ?? []);
  const suggestedIds = new Set(suggested.map((e) => e.staffId));

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inpatient-handoffs', admissionId],
    // 🔴 `/inpatient/:id/handoffs` 는 서버에 없다(운영 404) — 목록 정본은 `/handoffs`(admissionId 필터)
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/handoffs', { admissionId }),
  });

  const createMut = useMutation({
    mutationFn: () => {
      const actions = form.actionList.split('\n').map((a) => a.trim()).filter(Boolean);
      const opt = (v: string) => (v.trim() ? v.trim() : undefined);
      return apiClient.post('/api/v1/handoffs', {
        type: isDoctor ? 'SHIFT_CHANGE' : 'NURSING_SHIFT',
        admissionId,
        patientId,
        // 인계자는 서버가 로그인 사용자로 정한다
        toDoctorId: form.toUserId,
        // 요약(필수) — 환자 요약이 비면 조치·상황 인식 순으로 채운다(목록 화면이 요약을 본다)
        summary: opt(form.patientSummary) ?? opt(actions.join(' · ')) ?? opt(form.situationAwareness) ?? '',
        illness: form.illness,
        patientSummary: opt(form.patientSummary),
        actionList: actions.map((action) => ({ action, status: 'PENDING' })),
        situationAwareness: opt(form.situationAwareness),
        synthesis: opt(form.synthesis),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inpatient-handoffs', admissionId] });
      qc.invalidateQueries({ queryKey: ['nursing-station'] });
      setShowForm(false);
      setForm({ illness: '', patientSummary: '', actionList: '', situationAwareness: '', synthesis: '', toUserId: '' });
      toast.success(tAttr('인수인계가 저장되었습니다.'));
    },
    // 🔴 서버가 거절 이유를 말한다(입원↔환자 불일치·인수자 누락 등) — 일반 문구로 덮지 않는다
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('인수인계 저장에 실패했습니다.')),
  });

  interface HandoffRecord { id?: string; shiftType?: string; nextShift?: string; type?: string; createdAt?: string; content?: string; summary?: string; illness?: string; patientSummary?: string; actionList?: Array<{ action: string; status: string }>; acknowledgedAt?: string; nurse?: { familyName?: string; givenName?: string }; fromDoctor?: { familyName?: string; givenName?: string }; toDoctor?: { familyName?: string; givenName?: string } }
  const handoffs: HandoffRecord[] = (() => {
    const raw = data?.data;
    return Array.isArray(raw) ? raw : ((raw as { data?: HandoffRecord[] })?.data ?? []);
  })();

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-sm text-gray-500"><T k="총" /> {handoffs.length}<Unit>건</Unit></p>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">+ <T k="인수인계 작성" /></button>
      </div>

      {/* I-PASS 작성 폼 */}
      {showForm && (
        <div className="bg-white border border-amber-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-amber-600 px-5 py-3 text-white font-semibold text-sm"><T k="인수인계 작성 (I-PASS)" /></div>
          <div className="p-5 space-y-3">
            {/* 근무조는 고르지 않는다 — 서버가 작성 시각으로 판정한다(종전 선택값은 어디에도 저장되지 않았다) */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1"><T k="인수자" /></label>
              {recipientsQ.isError ? (
                <QueryErrorFallback error={recipientsQ.error} onRetry={() => recipientsQ.refetch()} size="compact" />
              ) : (
                <select value={form.toUserId} onChange={e => setForm({ ...form, toUserId: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="">{isDoctor ? tAttr('— 인수 의사 —') : tAttr('— 인수 간호사 —')}</option>
                  {suggested.length > 0 && (
                    <optgroup label={tAttr('★ 다음 근무조 근무')}>
                      {suggested.map((e) => <option key={e.staffId} value={e.staffId}>{e.staffName}</option>)}
                    </optgroup>
                  )}
                  <optgroup label={isDoctor ? tAttr('의사') : tAttr('간호사')}>
                    {recipients.filter((u) => !suggestedIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.familyName}{u.givenName}</option>)}
                  </optgroup>
                </select>
              )}
            </div>
            <div>
              <span className="block text-xs font-medium text-amber-700 mb-1"><T k="I — Illness severity (환자 상태)" /></span>
              {/* 초기값 미선택 — 정본 어휘에서만 고른다 */}
              <div className="flex gap-2" role="radiogroup" aria-label={tAttr('중증도')}>
                {HANDOFF_ILLNESS.map((code) => (
                  <button key={code} type="button" role="radio" aria-checked={form.illness === code} onClick={() => setForm({ ...form, illness: code })}
                    className={`min-h-[44px] flex-1 rounded-lg border text-sm font-medium ${form.illness === code ? (code === 'CRITICAL' ? 'bg-rose-600 border-rose-600 text-white' : code === 'UNSTABLE' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-emerald-600 border-emerald-600 text-white') : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
                    <T k={HANDOFF_ILLNESS_LABEL[code]} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-amber-700 mb-1"><T k="P — Patient summary (환자 요약)" /></label>
              <textarea value={form.patientSummary} onChange={e => setForm({ ...form, patientSummary: e.target.value })} rows={2} placeholder={tAttr('현재 상태, 진단, 주요 관찰 사항...')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-amber-700 mb-1"><T k="A — Action list (조치 목록, 줄바꿈으로 구분)" /></label>
              <textarea value={form.actionList} onChange={e => setForm({ ...form, actionList: e.target.value })} rows={3} placeholder="바이탈 2시간 간격 체크&#10;검사 결과 확인&#10;통증 시 PRN 투여" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-amber-700 mb-1"><T k="S — Situation awareness (상황 인식)" /></label>
              <textarea value={form.situationAwareness} onChange={e => setForm({ ...form, situationAwareness: e.target.value })} rows={2} placeholder={tAttr('주의할 점, 가능한 변화, contingency plan...')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-amber-700 mb-1"><T k="S — Synthesis (종합 판단)" /></label>
              <textarea value={form.synthesis} onChange={e => setForm({ ...form, synthesis: e.target.value })} rows={1} placeholder={tAttr('전반적 평가 및 예상 경과...')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.illness || !form.toUserId || !patientId || !(form.patientSummary.trim() || form.actionList.trim() || form.situationAwareness.trim())}
                className="px-5 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
                {createMut.isPending ? <T k="저장 중..." /> : <T k="인수인계 저장" />}
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 인수인계 목록 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {isError ? (
          <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
        ) : isLoading ? (
          <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : handoffs.length === 0 ? (
          <div className="bg-gray-50 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-500"><T k="인수인계 기록이 없습니다" /></p>
          </div>
        ) : (
          <div className="space-y-3">
            {handoffs.map((h: HandoffRecord, i: number) => (
              <div key={h.id ?? i} className={`rounded-xl border p-4 ${h.acknowledgedAt ? 'bg-gray-50 border-gray-100' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full whitespace-nowrap">{h.type ?? h.shiftType ?? 'SHIFT'}</span>
                    {h.acknowledgedAt ? (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="인수 확인" /></span>
                    ) : (
                      <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="미확인" /></span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{safeDate(h.createdAt, 'datetime')}</span>
                </div>
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><span className="font-bold text-amber-700">I</span> <IllnessBadge value={h.illness} size="xs" /></p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{h.summary ?? h.content}</p>
                {h.actionList && h.actionList.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {h.actionList.map((a, ai) => (
                      <div key={ai} className="flex items-center gap-1.5 text-xs">
                        <span className={`w-3 h-3 rounded-full flex items-center justify-center text-[8px] ${a.status === 'DONE' ? 'bg-emerald-500 text-white' : 'bg-gray-200'}`}>
                          {a.status === 'DONE' ? '✓' : ''}
                        </span>
                        <span className={a.status === 'DONE' ? 'text-gray-400 line-through' : 'text-gray-700'}>{a.action}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400">
                  {h.fromDoctor && <span><T k="인계" />: {h.fromDoctor.familyName}{h.fromDoctor.givenName}</span>}
                  {h.toDoctor && <span>→ <T k="인수" />: {h.toDoctor.familyName}{h.toDoctor.givenName}</span>}
                  {h.nurse && <span>{h.nurse.familyName}{h.nurse.givenName}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 중간 정산 — `InterimBillingSection.tsx`(2026-10-22 재작성) ──

// ── 퇴원 정산서 ──
type DischargeSettlement = DischargeSettlementData;

function DischargeSettlementCard({ admissionId }: { admissionId: string }) {
  const [exporting, setExporting] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['discharge-settlement', admissionId],
    queryFn: () => apiClient.get<{ data: DischargeSettlement }>(`/api/v1/inpatient/${admissionId}/discharge-settlement`),
  });
  // 인쇄본의 환자·병상 — 상세 화면이 이미 읽은 입원 정보(같은 키 · 새 조회 아님)
  const { data: admData } = useQuery({
    queryKey: ['admission-detail', admissionId],
    queryFn: () => apiClient.get<{ data: AdmissionDetail }>(`/api/v1/inpatient/${admissionId}`),
  });
  const s = data?.data;
  // 🔴 조회 실패를 "정산서 없음"으로 숨기지 않는다(카드가 통째로 사라진다)
  if (isError) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mt-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3"><T k="퇴원 정산서" /></h3>
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      </div>
    );
  }
  if (isLoading || !s) return null;

  const warnings = s.reconciliation?.warnings ?? [];
  const exportToErp = async () => {
    setExporting(true);
    try {
      const r = await apiClient.post<{ data: { exported: boolean; balanceDue: number } }>(`/api/v1/inpatient/${admissionId}/discharge-settlement/export`, {});
      toast.success(`ERP 전송 완료 — 퇴원 수납 잔액 ${money(Number(r.data?.balanceDue ?? 0))}`);
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || 'ERP 전송에 실패했습니다.');
    }
    setExporting(false);
  };

  return (
    <div className="bg-white rounded-xl border border-indigo-200 p-5 print:border-black">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-indigo-900"><T k="퇴원 정산서" /> <span className="font-normal text-xs text-gray-400">(<T k="입원 전체 통합·중간정산 차감" />)</span></h4>
        <div className="flex gap-2 print:hidden">
          <button onClick={() => sanctionedPrint()} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="인쇄" /></button>
          <button onClick={exportToErp} disabled={exporting}
            className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {exporting ? <T k="전송 중..." /> : <T k="ERP 전송" />}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <div className="text-center"><p className="text-xs text-gray-400"><T k="총진료비" /> ({s.days ?? '-'}<Unit>일</Unit>)</p><p className="text-base font-bold text-gray-900"><Money value={Number(s.totalCharges ?? 0)} /></p></div>
        <div className="text-center"><p className="text-xs text-gray-400"><T k="총 본인부담" /></p><p className="text-base font-bold text-amber-600"><Money value={Number(s.totalCopay ?? 0)} /></p></div>
        <div className="text-center"><p className="text-xs text-gray-400"><T k="기납부(중간정산 포함)" /></p><p className="text-base font-bold text-emerald-600"><Money value={Number(s.alreadyPaid ?? 0)} /></p></div>
        <div className="text-center"><p className="text-xs text-gray-400"><T k="퇴원 수납 잔액" /></p><p className={`text-base font-bold ${Number(s.balanceDue ?? 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}><Money value={Number(s.balanceDue ?? 0)} /></p></div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11px] text-gray-500 border-t pt-2">
        <span><T k="진료 청구" /> {s.breakdown?.encounters?.count ?? 0}<Unit>건</Unit> · <Money value={Number(s.breakdown?.encounters?.charges ?? 0)} /></span>
        <span><T k="중간정산" /> {s.breakdown?.interim?.count ?? 0}<Unit>건</Unit> · <Money value={Number(s.breakdown?.interim?.charges ?? 0)} /></span>
      </div>
      {warnings.length > 0 && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-0.5">
          {warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-700">⚠ {w}</p>)}
        </div>
      )}
      {/* 🔴 인쇄는 화면 카드를 찍지 않고 퇴원 정산서 인쇄본으로(2026-10-12 · 종전엔 빈 종이) */}
      <DischargeSettlementPrint admissionId={admissionId} settlement={s} admission={admData?.data ?? null} />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

// ── 미니 타임라인 (입원 상세 하단 인라인) ──
interface TimelineEntry { time: string; type: string; data: Record<string, unknown>; nurse?: string }
interface TimelineSummary { totalIntake?: number; totalOutput?: number; balance?: number }
interface TimelineResponse { timeline?: TimelineEntry[]; summary?: TimelineSummary }

function NursingMiniTimeline({ admissionId }: { admissionId: string }) {
  const tAttr = useTAttr();
  const { data, isLoading } = useQuery({
    queryKey: ['nursing-mini-timeline', admissionId],
    queryFn: () => apiClient.get<{ data: TimelineResponse | { data: TimelineResponse } }>(`/api/v1/admissions/${admissionId}/timeline?date=${kstToday()}`),
    enabled: !!admissionId,
    staleTime: 60000,
  });
  const raw: TimelineResponse | undefined = (data?.data as { data?: TimelineResponse })?.data ?? data?.data as TimelineResponse | undefined;
  const timeline: TimelineEntry[] = (raw?.timeline ?? []).slice(0, 5);
  const summary = raw?.summary;

  const TYPE_ICON: Record<string, string> = { VITAL: '🩺', SOAP: '📝', DARE: '🩹', NOTE: '📝', MAR: '💊', IO: '💧', CHECKLIST: '✅' };
  const TYPE_LABEL: Record<string, string> = { VITAL: '바이탈', SOAP: 'SOAP', DARE: 'DARE', NOTE: '간호노트', MAR: '투약', IO: 'I/O', CHECKLIST: '체크' };

  function fmt(iso: string) { try { return kdate(iso, 'time'); } catch { return '-'; } }

  if (isLoading) return <div className="p-4"><div className="h-20 bg-gray-100 rounded-lg animate-pulse" /></div>;

  return (
    <div className="px-4 py-3">
      {/* I/O 밸런스 요약 */}
      {summary && (
        <div className="flex gap-3 mb-3">
          <div className="flex-1 bg-blue-50 rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-blue-500"><T k="섭취" /></p>
            <p className="text-sm font-bold text-blue-700">{summary.totalIntake}mL</p>
          </div>
          <div className="flex-1 bg-amber-50 rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-amber-500"><T k="배출" /></p>
            <p className="text-sm font-bold text-amber-700">{summary.totalOutput}mL</p>
          </div>
          <div className={`flex-1 rounded-lg px-3 py-2 text-center ${(summary?.balance ?? 0) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-[10px] text-gray-500">Balance</p>
            <p className={`text-sm font-bold ${(summary?.balance ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>{(summary?.balance ?? 0) >= 0 ? '+' : ''}{summary?.balance ?? 0}mL</p>
          </div>
        </div>
      )}

      {/* 최근 기록 5건 */}
      {timeline.length === 0 ? (
        <EmptyState icon="🩺" title="오늘 간호 기록이 없습니다" />
      ) : (
        <div className="space-y-2">
          {timeline.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-gray-400 font-mono w-10 text-right flex-shrink-0 pt-0.5">{fmt(item.time)}</span>
              <span className="flex-shrink-0">{TYPE_ICON[item.type] ?? '📋'}</span>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-gray-700"><T k={TYPE_LABEL[item.type] ?? item.type} /></span>
                {/* 혈압 한쪽이 없으면 빈 쪽 '—'(종전 "120/undefined") · 미측정 '—' — 부품 정본 */}
                {item.type === 'VITAL' && <VitalSignsStrip vitals={item.data as Record<string, unknown> | null} keys={TIMELINE_VITAL_KEYS} className="ml-1" />}
                {item.type === 'NOTE' && (item.data as { focus?: string })?.focus && <span className="text-gray-500 ml-1">— {(item.data as { focus?: string }).focus}</span>}
                {item.type === 'IO' && <span className="text-gray-500 ml-1">{(item.data as { intakeAmount?: number })?.intakeAmount ? `▲${(item.data as { intakeAmount?: number }).intakeAmount}mL` : `▼${(item.data as { outputAmount?: number })?.outputAmount}mL`}</span>}
                {item.nurse && <span className="text-gray-300 ml-1">{item.nurse}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 간호 업무 탭 패널 ──
function NursingWorkPanel({ admissionId }: { admissionId: string }) {
  const [nursingTab, setNursingTab] = useState('timeline');
  const TABS = [
    { key: 'timeline', icon: '📊', label: '타임라인' },
    { key: 'notes', icon: '📝', label: 'SOAP/DARE' },
    { key: 'flowsheet', icon: '📈', label: 'Flow Sheet' },
    { key: 'checklist', icon: '✅', label: '체크리스트' },
    { key: 'mar', icon: '💊', label: 'MAR' },
    { key: 'io', icon: '💧', label: 'I/O' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 border-b">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <span className="w-1.5 h-5 bg-emerald-500 rounded-full" />
          <T k="간호 업무" />
        </h3>
        <Link href={`/inpatient/${admissionId}/nursing/${nursingTab === 'timeline' ? 'timeline' : nursingTab}`}
          className="text-xs text-emerald-600 font-medium hover:underline"><T k="전체 화면" /> →</Link>
      </div>

      {/* 탭 바 */}
      <div className="flex overflow-x-auto border-b">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setNursingTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition ${
              nursingTab === t.key ? 'border-emerald-500 text-emerald-700 bg-emerald-50/50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            <span className="text-sm">{t.icon}</span> <T k={t.label} />
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="min-h-[200px]">
        {nursingTab === 'timeline' && <NursingMiniTimeline admissionId={admissionId} />}
        {nursingTab === 'notes' && (
          <div className="p-4 text-center">
            <p className="text-sm text-gray-500 mb-3"><T k="SOAP/DARE 간호기록 작성" /></p>
            <Link href={`/inpatient/${admissionId}/nursing/notes`} className="px-4 py-2 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700"><T k="기록 작성하기" /></Link>
          </div>
        )}
        {nursingTab === 'flowsheet' && <NursingMiniFlowSheet admissionId={admissionId} />}
        {nursingTab === 'checklist' && (
          <div className="p-4 text-center">
            <p className="text-sm text-gray-500 mb-3"><T k="근무교대 · 안전 · 수술 체크리스트" /></p>
            <Link href={`/inpatient/${admissionId}/nursing/checklist`} className="px-4 py-2 bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700"><T k="체크리스트 열기" /></Link>
          </div>
        )}
        {nursingTab === 'mar' && (
          <div className="p-4 text-center">
            <p className="text-sm text-gray-500 mb-3"><T k="투약 기록 (MAR)" /></p>
            <Link href={`/inpatient/${admissionId}/nursing/mar`} className="px-4 py-2 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700"><T k="MAR 열기" /></Link>
          </div>
        )}
        {nursingTab === 'io' && (
          <div className="p-4 text-center">
            <p className="text-sm text-gray-500 mb-3"><T k="섭취/배출 기록" /></p>
            <Link href={`/inpatient/${admissionId}/nursing/io`} className="px-4 py-2 bg-cyan-600 text-white text-xs rounded-lg hover:bg-cyan-700"><T k="I/O 열기" /></Link>
          </div>
        )}
      </div>

      {/* 하단 링크 */}
      <div className="flex gap-2 px-4 py-2.5 border-t bg-gray-50/50 text-xs">
        <Link href={`/inpatient/${admissionId}/nursing/assessment`} className="text-gray-500 hover:text-blue-600"><T k="간호 사정" /></Link>
        <span className="text-gray-300">|</span>
        <Link href={`/inpatient/${admissionId}/discharge-summary`} className="text-gray-500 hover:text-blue-600"><T k="퇴원 요약" /></Link>
      </div>
    </div>
  );
}

// ── 미니 Flow Sheet (탭 내 인라인) ──
interface FlowSheetEntry { systolicBp?: number; diastolicBp?: number; heartRate?: number; temperature?: number; spo2?: number; painScore?: number | null; intakeOral?: number; intakeIv?: number; outputUrine?: number; outputDrain?: number }
interface FlowSheetGrid { hour: string; entry?: FlowSheetEntry }
interface FlowSheetTotals { totalIntake?: number; totalOutput?: number; balance?: number }
interface FlowSheetResponse { grid?: FlowSheetGrid[]; totals?: FlowSheetTotals }

function NursingMiniFlowSheet({ admissionId }: { admissionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['mini-flowsheet', admissionId],
    queryFn: () => apiClient.get<{ data: FlowSheetResponse | { data: FlowSheetResponse } }>(`/api/v1/admissions/${admissionId}/flowsheet`),
    enabled: !!admissionId,
    staleTime: 60000,
  });
  const raw: FlowSheetResponse | undefined = (data?.data as { data?: FlowSheetResponse })?.data ?? data?.data as FlowSheetResponse | undefined;
  const grid: FlowSheetGrid[] = raw?.grid ?? [];
  const totals: FlowSheetTotals = raw?.totals ?? {};

  if (isLoading) return <div className="p-4"><div className="h-20 bg-gray-100 rounded-lg animate-pulse" /></div>;

  return (
    <div className="p-4 overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-2 py-1.5 text-left text-gray-500 font-medium"><T k="시간" /></th>
            <VitalHeaderCells keys={PRINT_VITAL_KEYS} className="px-2 py-1.5 text-center text-gray-500 font-medium" />
            <th className="px-2 py-1.5 text-center text-blue-500 font-medium"><T k="섭취" /></th>
            <th className="px-2 py-1.5 text-center text-amber-500 font-medium"><T k="배출" /></th>
          </tr>
        </thead>
        <tbody>
          {grid.filter((g: FlowSheetGrid) => g.entry).map((g: FlowSheetGrid, i: number) => {
            const e = g.entry;
            const intake = (e?.intakeOral??0)+(e?.intakeIv??0);
            const output = (e?.outputUrine??0)+(e?.outputDrain??0);
            return (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-2 py-1 font-mono text-gray-400">{g.hour}</td>
                <VitalRowCells vitals={e} keys={PRINT_VITAL_KEYS} className="px-2 py-1 text-center" />
                <td className="px-2 py-1 text-center text-blue-600">{intake||'-'}</td>
                <td className="px-2 py-1 text-center text-amber-600">{output||'-'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-bold">
            <td className="px-2 py-1.5"><T k="합계" /></td><td colSpan={5}></td>
            <td className="px-2 py-1.5 text-center text-blue-700">{totals.totalIntake??0}</td>
            <td className="px-2 py-1.5 text-center text-amber-700">{totals.totalOutput??0}</td>
          </tr>
        </tfoot>
      </table>
      {totals.balance != null && (
        <p className={`text-xs font-bold text-center mt-2 ${totals.balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
          Balance: {totals.balance >= 0 ? '+' : ''}{totals.balance}mL
        </p>
      )}
    </div>
  );
}

// ── 바이탈 추이 탭 (입원 기간 전체 트렌드) ──

function VitalsTrendTab({ admissionId }: { admissionId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inpatient-vitals-trend', admissionId],
    queryFn: () => apiClient.get<{ data: FlowSheetRecord | null; history: FlowSheetRecord[] }>(`/api/v1/inpatient/${admissionId}/vitals`),
  });

  const raw = data as Record<string, unknown> | undefined;
  const history: FlowSheetRecord[] = ((raw?.history as FlowSheetRecord[]) ?? []).slice().reverse();

  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;
  if (isLoading) return <div className="h-60 bg-gray-100 rounded-xl animate-pulse" />;
  if (history.length < 2) return <p className="text-sm text-gray-400 py-10 text-center"><T k="바이탈 기록이 2건 이상 필요합니다." /></p>;

  const VITALS_CONFIG = [
    { key: 'systolicBp', label: '수축기 혈압 (mmHg)', color: '#dc2626', normalMin: 90, normalMax: 140 },
    { key: 'diastolicBp', label: '이완기 혈압 (mmHg)', color: '#f97316', normalMin: 60, normalMax: 90 },
    { key: 'heartRate', label: '맥박 (bpm)', color: '#db2777', normalMin: 60, normalMax: 100 },
    { key: 'temperature', label: '체온 (°C)', color: '#8b5cf6', normalMin: 36.0, normalMax: 37.5 },
    { key: 'spo2', label: 'SpO2 (%)', color: '#2563eb', normalMin: 94, normalMax: 100 },
    { key: 'respiratoryRate', label: '호흡수 (/min)', color: '#059669', normalMin: 12, normalMax: 20 },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 mb-1"><T k="바이탈 사인 트렌드" /></h3>
        <p className="text-xs text-gray-400 mb-4"><T k="입원 기간 전체" /> {history.length}<Unit>건</Unit> <T k="기록@명사" /></p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {VITALS_CONFIG.map(cfg => {
            const values = history.map(r => ({
              v: Number((r as Record<string, unknown>)[cfg.key] ?? 0),
              t: r.recordedAt ? new Date(r.recordedAt) : null,
            })).filter(d => d.v > 0);

            if (values.length < 2) return null;

            const min = Math.min(...values.map(d => d.v), cfg.normalMin) - 5;
            const max = Math.max(...values.map(d => d.v), cfg.normalMax) + 5;
            const range = max - min || 1;
            const w = 400;
            const h = 120;
            const points = values.map((d, i) => `${(i / (values.length - 1)) * w},${h - ((d.v - min) / range) * h}`).join(' ');
            const normalY1 = h - ((cfg.normalMax - min) / range) * h;
            const normalY2 = h - ((cfg.normalMin - min) / range) * h;
            const latest = values[values.length - 1];
            const isAbnormal = latest.v < cfg.normalMin || latest.v > cfg.normalMax;

            return (
              <div key={cfg.key} className="p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-700"><T k={cfg.label} /></span>
                  <span className={`text-sm font-bold font-mono ${isAbnormal ? 'text-red-600' : 'text-gray-900'}`}>
                    {latest.v}{cfg.key === 'temperature' ? '°C' : ''}
                  </span>
                </div>
                <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
                  {/* 정상 범위 */}
                  <rect x="0" y={normalY1} width={w} height={normalY2 - normalY1} fill={cfg.color} fillOpacity="0.06" />
                  <line x1="0" y1={normalY1} x2={w} y2={normalY1} stroke={cfg.color} strokeWidth="0.5" strokeDasharray="4 2" opacity="0.3" />
                  <line x1="0" y1={normalY2} x2={w} y2={normalY2} stroke={cfg.color} strokeWidth="0.5" strokeDasharray="4 2" opacity="0.3" />
                  {/* 데이터 라인 */}
                  <polyline points={points} fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {/* 데이터 포인트 */}
                  {values.map((d, i) => {
                    const x = (i / (values.length - 1)) * w;
                    const y = h - ((d.v - min) / range) * h;
                    const abnormal = d.v < cfg.normalMin || d.v > cfg.normalMax;
                    return <circle key={i} cx={x} cy={y} r={abnormal ? 4 : 2.5} fill={abnormal ? '#dc2626' : cfg.color} />;
                  })}
                </svg>
                <div className="flex justify-between text-[9px] text-gray-400 mt-1">
                  <span>{kdate(values[0].t, 'monthDay', '')}</span>
                  <span className="text-[9px]" style={{ color: cfg.color }}><T k="정상" />: {cfg.normalMin}-{cfg.normalMax}</span>
                  <span>{kdate(values[values.length - 1].t, 'monthDay', '')}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 요약 테이블 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3"><T k="기록 상세" /></h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-2 py-2 text-left text-gray-600 border-b"><T k="일시" /></th>
                <VitalHeaderCells className="px-2 py-2 text-center text-gray-600 border-b" />
              </tr>
            </thead>
            <tbody>
              {history.slice(-20).reverse().map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  <td className="px-2 py-1.5 text-gray-500 border-b">{r.recordedAt ? kdate(r.recordedAt, 'datetimeShort') : '-'}</td>
                  <VitalRowCells vitals={r} className="px-2 py-1.5 text-center font-mono border-b" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
