'use client';
import { useVitalsThresholds, type VitalItemFlag } from '@/lib/vital-flags';
import { VitalSignsGrid } from '@/components/vitals/VitalSigns';
import { VitalsRuleNote } from '@/components/vitals/VitalsRuleNote';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';

import { useState } from 'react';
import { ageOf, AI_ORIGIN_TEXT, RATIO_UNAVAILABLE, VITAL_UNMEASURED_TEXT } from '@hospital-run/shared';
import { Unit, Duration } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import Link from 'next/link';
import { openPacsViewer } from '@/lib/pacs';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { extractErrorMessage } from '@/lib/error-utils';
import NursingNotePanel from '@/components/nursing/NursingNotePanel';
import { AiSuggestionPanel } from '@/components/ai/AiSuggestionPanel';
import { pollMs, kdate } from '@/lib/ui-settings';
import { KTAS_LEVEL_LABEL, KTAS_SOLID } from '@/lib/ktas';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { BedBoard } from './components/BedBoard';

interface EmergencyPatient {
  familyName: string;
  givenName: string;
  mrn: string;
  gender?: string;
  dateOfBirth?: string;
  bloodType?: string;
  insuranceType?: string;
  phone?: string;
  allergies?: string;
}

interface EmergencyVitalSigns {
  bp?: string;
  hr?: number;
  rr?: number;
  bt?: number;
  spo2?: number;
  gcs?: number;
}

interface EmergencyVisit {
  id: string;
  patientId: string;
  patient?: EmergencyPatient;
  triageLevel: string;
  chiefComplaint: string;
  arrivalAt: string;
  triagedAt?: string;
  treatmentStartedAt?: string;
  dispositionAt?: string;
  disposition?: string;
  vitalSigns?: EmergencyVitalSigns;
  triageNote?: string;
  treatmentNote?: string;
  doctorId?: string;
  status?: string; // PENDING_TRIAGE … PENDING_DISPOSITION | COMPLETED(=퇴실 확정). 처분 변경 가능 여부 판정에 쓴다
  dispositionRecord?: EmergencyDispositionRecord | null; // 현행 처분 기록(변경 화면 프리필의 유일한 출처)
}

/** 현행 처분 기록 — `EmergencyDispositionRecord`. 변경 화면은 이 값에서 시작해야 한다. */
interface EmergencyDispositionRecord {
  disposition: string;
  dischargeInstructions?: string | null;
  followUpDate?: string | null;
  transferTo?: string | null;
  transferReason?: string | null;
  decidedAt?: string | null;
}

/** `POST /emergency/visits/:id/disposition` 응답 계약 — 서버 `{ data, meta }` 본문 그대로. */
interface DispositionResponse {
  data?: { outcome?: string };
  meta?: { outcome?: string };
}

interface EmergencyStats {
  current: number;
  total?: number;
  byLevel?: Record<string, number>;
}

// KTAS 표시 정본(D7) — 라벨 shared·색 lib/ktas.ts 단일화(로컬 Record 재정의 금지 규약)
const KTAS_COLOR = KTAS_SOLID;
const KTAS_LABEL = KTAS_LEVEL_LABEL;
// 🔴 처분 결정 패널은 OBSERVATION·SURGERY 도 보내는데 라벨 맵에 없어서 헤더가 "| undefined" 를 찍었다.
//    보내는 값과 라벨은 같은 목록이어야 한다.
const DISPOSITION_LABEL: Record<string, string> = {
  ADMISSION: '입원', DISCHARGE: '퇴원', TRANSFER: '전원', DEATH: '사망', LEAVE_AMA: '자의퇴원',
  OBSERVATION: '관찰', SURGERY: '수술',
};

function formatTime(dt: string | null) {
  if (!dt) return '-';
  return kdate(dt, 'time');
}
function formatDateTime(dt: string | null) {
  if (!dt) return '-';
  // 월/일을 손으로 조립하던 자리 — 표기 정책(dash·24h)과 UI 언어는 정본이 정한다
  return kdate(dt, 'datetimeShort');
}
function elapsedMinutes(dt: string) {
  return Math.floor((Date.now() - new Date(dt).getTime()) / 60000);
}

export default function EmergencyPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'bed' | 'list'>('bed'); // 베드 보드가 기본(기획 §4.1)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['emergency'],
    queryFn: () => apiClient.get<{ data: EmergencyVisit[] }>('/api/v1/emergency'),
    refetchInterval: pollMs('fast'),
  });
  const _erRaw = data?.data;
  const emergencyList: EmergencyVisit[] = Array.isArray(_erRaw) ? _erRaw : (_erRaw as unknown as Record<string, unknown>)?.data as EmergencyVisit[] ?? [];

  const { data: stats } = useQuery({
    queryKey: ['er-stats'],
    queryFn: () => apiClient.get<{ data: EmergencyStats }>('/api/v1/emergency/stats'),
  });

  const selected = emergencyList.find((v: EmergencyVisit) => v.id === selectedId);
  const statsData: EmergencyStats | null = (stats?.data as unknown as Record<string, unknown>)?.data as EmergencyStats ?? stats?.data ?? null;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="flex gap-0 h-[calc(100vh-80px)]">
      {/* 좌측: 환자 목록 */}
      <div className={`${selected ? 'w-[55%]' : 'w-full'} transition-all overflow-auto`}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900"><T k="응급실" /></h2>
            <p className="text-sm text-gray-500 mt-1"><T k="KTAS 기반 중증도 분류 / 10초 자동 갱신" /></p>
          </div>
          {statsData && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-rose-50 rounded-xl border border-rose-100">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-sm font-semibold text-rose-700 whitespace-nowrap"><T k="재실" /> {statsData.current}<Unit>명</Unit></span>
              </div>
              {/* KTAS 1·2 중증 — 있을 때만 소리낸다 */}
              {((statsData.byLevel?.LEVEL_1 ?? 0) + (statsData.byLevel?.LEVEL_2 ?? 0)) > 0 && (
                <div className="px-4 py-2.5 bg-red-600 rounded-xl">
                  <span className="text-sm font-bold text-white whitespace-nowrap">
                    <T k="중증(1·2급)" /> {(statsData.byLevel?.LEVEL_1 ?? 0) + (statsData.byLevel?.LEVEL_2 ?? 0)}<Unit>명</Unit>
                  </span>
                </div>
              )}
              <div className="flex rounded-xl bg-gray-100 p-0.5">
                {([['bed', '베드 보드'], ['list', '목록']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setView(k)}
                    className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${view === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    <T k={label} />
                  </button>
                ))}
              </div>
              <Link href="/emergency-board"
                className="px-4 py-2.5 bg-gray-100 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-200 whitespace-nowrap">
                <T k="관제 보드(NEDOCS·사전통보)" /> →
              </Link>
            </div>
          )}
        </div>

        {view === 'bed' && <BedBoard onSelectVisit={(id) => setSelectedId(id === selectedId ? null : id)} />}

        <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${view === 'bed' ? 'hidden' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">KTAS</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="주소(증상)" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="도착" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="대기" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처분" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : !emergencyList.length ? (
                <tr><td colSpan={6} className="py-16 text-center text-gray-400"><T k="응급실 환자 없음" /></td></tr>
              ) : (
                emergencyList.map((v: EmergencyVisit) => {
                  const isActive = !v.disposition;
                  const waiting = isActive ? elapsedMinutes(v.arrivalAt) : null;
                  return (
                    <tr key={v.id}
                      onClick={() => setSelectedId(v.id === selectedId ? null : v.id)}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${
                        v.id === selectedId ? 'bg-blue-50' : 'hover:bg-gray-50/70'
                      } ${!isActive ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${KTAS_COLOR[v.triageLevel]}`}>
                          {KTAS_LABEL[v.triageLevel]}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 text-xs">
                        {v.patient?.familyName}{v.patient?.givenName}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs truncate max-w-[200px]">{v.chiefComplaint}</td>
                      <td className="px-4 py-3 text-gray-500 text-[11px]">{formatTime(v.arrivalAt)}</td>
                      <td className="px-4 py-3 text-[11px]">
                        {waiting != null ? (
                          <span className={`font-medium ${waiting > 60 ? 'text-red-600' : waiting > 30 ? 'text-amber-600' : 'text-gray-500'}`}>
                            <Duration minutes={waiting} />
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          v.disposition === 'ADMISSION' ? 'bg-blue-100 text-blue-700' :
                          v.disposition === 'DISCHARGE' ? 'bg-green-100 text-green-700' :
                          v.disposition === 'TRANSFER' ? 'bg-purple-100 text-purple-700' :
                          v.disposition ? 'bg-gray-100 text-gray-600' :
                          'bg-rose-50 text-rose-600'
                        }`}>
                          {v.disposition ? DISPOSITION_LABEL[v.disposition] ?? v.disposition : '대기'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 우측: 응급 차트 상세 */}
      {selected && (
        <div className="w-[45%] pl-4 overflow-auto">
          <EmergencyChart visit={selected} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}

function EmergencyChart({ visit, onClose }: { visit: EmergencyVisit; onClose: () => void }) {
  const tA = useTAttr();
  const vitals = visit.vitalSigns;
  const vitalsRule = useVitalsThresholds();
  const isActive = !visit.disposition;
  const waiting = isActive ? elapsedMinutes(visit.arrivalAt) : null;
  // 🔴 처분이 찍히면 종전 화면은 액션 패널을 통째로 감췄다 — 결정 뒤 처분이 바뀌어도 **누를 곳이 없었다**.
  //    퇴실(COMPLETED) 전까지는 처분을 바꿀 수 있어야 한다(결정≠퇴실).
  const isClosed = visit.status === 'COMPLETED';
  const isRevision = !isActive;
  const canRevise = isRevision && !isClosed;
  const queryClient = useQueryClient();

  // Treatment modal state
  const [treatmentModal, setTreatmentModal] = useState<string | null>(null);
  const [treatmentNote, setTreatmentNote] = useState('');
  // Disposition modal
  const [showDisposition, setShowDisposition] = useState(false);
  const [dispType, setDispType] = useState('DISCHARGE');
  const [dispInstructions, setDispInstructions] = useState('');
  const [dispFollowUp, setDispFollowUp] = useState('');
  // 🔴 처분은 바뀐다(관찰→입원, 전원 결정 후 취소). 변경할 때는 사유를 함께 남긴다 — KTAS 재분류와 같은 규칙.
  const [dispRevisionReason, setDispRevisionReason] = useState('');
  const [dispTransferTo, setDispTransferTo] = useState('');
  const [dispTransferReason, setDispTransferReason] = useState('');

  /**
   * 패널을 열 때 현행 처분에서 시작한다.
   * 🔴 빈 칸에서 다시 쓰게 하면 화면에 안 보이던 귀가지침·전원기관이 저장 시 사라진다 —
   *    화면에 보이는 것과 저장되는 것이 같아야 한다.
   */
  const openDispositionPanel = () => {
    const rec = visit.dispositionRecord ?? null;
    setDispType(rec?.disposition ?? visit.disposition ?? 'DISCHARGE');
    setDispInstructions(rec?.dischargeInstructions ?? '');
    setDispFollowUp(rec?.followUpDate ? String(rec.followUpDate).slice(0, 10) : '');
    setDispTransferTo(rec?.transferTo ?? '');
    setDispTransferReason(rec?.transferReason ?? '');
    setDispRevisionReason('');
    setShowDisposition(true);
  };
  // Status
  const [showStatusChange, setShowStatusChange] = useState(false);
  // Reassess
  const [showReassess, setShowReassess] = useState(false);
  const [newKtas, setNewKtas] = useState('');
  const [reassessReason, setReassessReason] = useState('');

  // Assessment state
  const [assessmentText, setAssessmentText] = useState('');
  // WeRU.B 보조 결과 인라인 표시 (alert 대체)
  const [aiPanel, setAiPanel] = useState<{ title: string; text: string } | null>(null);

  // Status change
  const statusMut = useMutation({
    mutationFn: (status: string) => apiClient.put(`/api/v1/emergency/visits/${visit.id}/visit-status`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['emergency-queue'] }); toast.success('상태 변경 완료'); setShowStatusChange(false); },
  });
  // Disposition
  const dispositionMut = useMutation({
    mutationFn: () => apiClient.post<DispositionResponse>(`/api/v1/emergency/visits/${visit.id}/disposition`, {
      disposition: dispType,
      // 🔴 화면에 안 보이는 값은 보내지 않는다 — 퇴원 지침을 프리필한 뒤 '입원'으로 바꾸면
      //    보이지도 않는 귀가지침이 입원 기록에 실린다(반대 방향의 같은 오정보).
      dischargeInstructions: (dispType === 'DISCHARGE' || dispType === 'LEAVE_AMA') ? (dispInstructions || undefined) : undefined,
      followUpDate: dispType === 'DISCHARGE' ? (dispFollowUp || undefined) : undefined,
      transferTo: dispType === 'TRANSFER' ? (dispTransferTo || undefined) : undefined,
      transferReason: dispType === 'TRANSFER' ? (dispTransferReason || undefined) : undefined,
      revisionReason: isRevision ? dispRevisionReason : undefined,
    }),
    // 🔴 목록 쿼리키는 ['emergency'] 다. ['emergency-queue'] 무효화는 아무것도 갱신하지 않았다
    //    ("처분 결정 완료" 토스트만 뜨고 화면은 옛 처분을 계속 보여줬다).
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['emergency'] });
      queryClient.invalidateQueries({ queryKey: ['er-stats'] });
      // 🔴 서버가 실제로 무엇을 했는지로 말한다 — 아무것도 안 바뀐 재전송에 "변경 완료"라고 하면 거짓이다.
      //    apiClient 는 응답 본문을 그대로 돌려주므로 `{ data, meta }` 의 meta 를 읽는다(P11 계약 가드 있음).
      const outcome = res?.meta?.outcome ?? res?.data?.outcome;
      toast.success(outcome === 'REVISED' ? '처분 변경 완료' : outcome === 'UNCHANGED' ? '이미 같은 처분입니다 — 변경 없음' : '처분 결정 완료');
      setShowDisposition(false); setDispRevisionReason('');
    },
    // 서버가 이유를 말해주면 그대로 보여준다 — "처분 결정 실패" 한 줄은 아무것도 알려주지 않는다.
    onError: (e) => toast.error((e as { message?: string })?.message || '처분 결정 실패'),
  });
  // Reassess
  const reassessMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/emergency/visits/${visit.id}/reassess`, { newLevel: newKtas, reason: reassessReason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['emergency-queue'] }); toast.success('KTAS 재분류 완료'); setShowReassess(false); },
  });

  // Treatment mutation
  const treatmentMutation = useMutation({
    mutationFn: (payload: { visitId: string; note: string }) =>
      apiClient.post(`/api/v1/emergency/visits/${payload.visitId}/treatment`, { note: payload.note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergency'] });
      setTreatmentModal(null);
      setTreatmentNote('');
    },
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm sticky top-0">
      {/* Header */}
      <div className="px-5 py-4 border-b flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${KTAS_COLOR[visit.triageLevel]}`}>
              {KTAS_LABEL[visit.triageLevel]}
            </span>
            <h3 className="text-lg font-bold text-gray-900">
              {visit.patient?.familyName}{visit.patient?.givenName}
            </h3>
            {isActive && waiting != null && (
              <span className={`text-xs font-medium ${waiting > 60 ? 'text-red-600' : 'text-gray-500'}`}>
                <T k="대기" /> <Duration minutes={waiting} />
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {visit.patient?.mrn} | <T k="도착" /> {formatDateTime(visit.arrivalAt)}
            {visit.disposition && ` | ${DISPOSITION_LABEL[visit.disposition] ?? visit.disposition}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/patients/${visit.patientId}`}
            className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
            <T k="환자 차트" />
          </Link>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4 text-sm">
        {/* 환자 기본 정보 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
          <InfoRow label="성별" value={visit.patient?.gender === 'MALE' ? '남' : visit.patient?.gender === 'FEMALE' ? '여' : '-'} />
          <InfoRow label="나이" value={visit.patient?.dateOfBirth ? `만 ${(ageOf(visit.patient.dateOfBirth) ?? 0)}세` : '-'} />
          <InfoRow label="혈액형" value={visit.patient?.bloodType ?? '-'} />
          <InfoRow label="보험" value={visit.patient?.insuranceType === 'NHI' ? '건강보험' : visit.patient?.insuranceType === 'MEDICAID' ? '의료급여' : visit.patient?.insuranceType === 'SELF_PAY' ? '비급여' : '-'} />
          <InfoRow label="연락처" value={visit.patient?.phone ?? '-'} />
          <InfoRow label="알레르기" value={(() => { try { const a = JSON.parse(visit.patient?.allergies ?? '[]'); return a.length ? a.join(', ') : '없음'; } catch { return visit.patient?.allergies || '없음'; } })()} warn={(() => { try { return JSON.parse(visit.patient?.allergies ?? '[]').length > 0; } catch { return !!visit.patient?.allergies; } })()} />
        </div>

        {/* 주호소 */}
        <Section title="주호소 (Chief Complaint)">
          <p className="text-gray-900 bg-rose-50 rounded-lg px-3 py-2 border border-rose-100">
            {visit.chiefComplaint}
          </p>
          {/* WeRU.B 트리아지 + 추론 + KTAS */}
          <div className="flex gap-2 mt-2 flex-wrap">
            <button onClick={async () => {
              try {
                // 🔴 `?? 0` 이면 생년월일이 이상할 때 **만 0세(신생아)** 로 보낸다 — KTAS 소아 가중이
                //    엉뚱하게 걸린다. 모르는 나이는 보내지 않는다(서버 DTO 도 선택 항목이다).
                //    종전엔 DTO 에 `age` 키가 없어 whitelist 가 지웠기 때문에 이 값이 AI 에 닿은 적이 없다.
                const age = visit.patient?.dateOfBirth ? (ageOf(visit.patient.dateOfBirth) ?? undefined) : undefined;
                const sex = visit.patient?.gender === 'MALE' ? 'M' : visit.patient?.gender === 'FEMALE' ? 'F' : undefined;
                const res = await apiClient.post<{ data: { recommendations?: Array<{ rank: number; department: string; confidence: number }>; emergency_warning?: string; ktas_level?: number; red_flags?: string[] } }>('/api/v1/ai/triage', { symptom: visit.chiefComplaint, age, sex });
                const d = res?.data;
                const recs = d?.recommendations ?? [];
                const msg = recs.map((r) => `${r.rank}. ${r.department} (${Math.round(r.confidence * 100)}%)`).join('\n');
                const ktas = d?.ktas_level ? `\n\nKTAS 제안: Level ${d.ktas_level}` : '';
                const flags = d?.red_flags?.length ? `\n\nRed Flags:\n${d.red_flags.map((f) => `  - ${f}`).join('\n')}` : '';
                setAiPanel({ title: `${AI_ORIGIN_TEXT} 진료과 + KTAS`, text: `${msg}${ktas}${flags}${d?.emergency_warning ? `\n\n[응급] ${d.emergency_warning}` : ''}` || '분석 결과 없음' });
              } catch { toast.error(`${AI_ORIGIN_TEXT} 트리아지 실패`); }
            }} className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-[11px] font-medium hover:bg-indigo-200">
              {AI_ORIGIN_TEXT} 진료과 + KTAS
            </button>
            <button onClick={async () => {
              try {
                const symptoms = visit.chiefComplaint.split(/[,，、\n]/).map((s: string) => s.trim()).filter(Boolean);
                const res = await apiClient.post<{ data: { steps?: Array<{ name: string; result?: string }> } }>('/api/v1/ai/reasoning/chain', { symptoms });
                const steps = res?.data?.steps ?? [];
                setAiPanel({ title: `${AI_ORIGIN_TEXT} 감별진단 (5단계 추론)`, text: steps.length ? steps.map((s, i) => `${i + 1}. ${s.name}: ${s.result ?? ''}`).join('\n') : '분석 결과 없음' });
              } catch { toast.error(`${AI_ORIGIN_TEXT} 추론 실패`); }
            }} className="px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg text-[11px] font-medium hover:bg-violet-200">
              {AI_ORIGIN_TEXT} 감별진단
            </button>
            <button onClick={async () => {
              // 🔴 나이·성별을 지어내지 않는다 — 종전엔 생년월일이 없으면 **65세**, 성별은 **무조건 'M'**
              //    을 보냈다(여성 환자도 남성으로 예측). 서버 DTO 는 둘 다 필수라 모르면 예측할 수 없다.
              const age = visit.patient?.dateOfBirth ? ageOf(visit.patient.dateOfBirth) : null;
              const sex = visit.patient?.gender === 'MALE' ? 'M' : visit.patient?.gender === 'FEMALE' ? 'F' : null;
              if (age == null || sex == null) {
                const missing = [age == null ? '생년월일' : null, sex == null ? '성별' : null].filter(Boolean).join('·');
                setAiPanel({ title: '합병증 예측', text: `예측할 수 없습니다 — 환자 ${missing}이(가) 등록돼 있지 않습니다. 값을 지어내 예측하지 않습니다.` });
                return;
              }
              try {
                // 🔴 종전엔 `diagnoses`(배열)·`surgeryType` 을 보냈다 — 둘 다 DTO 에 없는 키라
                //    whitelist 가 지웠고, 필수 `diagnosis` 가 비어 **요청이 항상 400**(버튼 무발동)이었다.
                const res = await apiClient.post<{ data: { risk_level?: string; complications?: string[]; recommendations?: string[] } }>('/api/v1/ai/predict/complication', {
                  age, sex,
                  diagnosis: visit.chiefComplaint,
                });
                const d = res?.data;
                // 🔴 표본 부재("모름")를 "없음"으로 바꿔 말하지 않는다 — 빈 배열만 "없음"이다.
                //    문구는 shared 정본(`RATIO_UNAVAILABLE`)을 쓴다(화면마다 손으로 적으면 어휘가 갈라진다).
                const comp = d?.complications == null ? RATIO_UNAVAILABLE : d.complications.length ? d.complications.join(', ') : '예측된 합병증 없음';
                setAiPanel({
                  title: '합병증 예측',
                  text: `위험도: ${d?.risk_level ?? RATIO_UNAVAILABLE}\n예상: ${comp}${d?.recommendations?.length ? `\n권고: ${d.recommendations.join(', ')}` : ''}\n\n입력: 주호소(확정 진단 아님)·만 ${age}세·${sex === 'M' ? '남' : '여'}`,
                });
              // AI 서버가 바쁨(429)이면 서버 문구가 "잠시 후 다시"를 말한다 — 고장과 같은 말로 덮지 않는다
              } catch (e) { toast.error(extractErrorMessage(e) || '합병증 예측 실패'); }
            }} className="px-3 py-1.5 bg-rose-100 text-rose-700 rounded-lg text-[11px] font-medium hover:bg-rose-200">
              <T k="합병증 예측" />
            </button>
          </div>
          {/* WeRU.B 보조 결과 인라인 카드 */}
          {aiPanel && (
            <div className="mt-2 bg-amber-50/60 border border-amber-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-bold text-amber-800">{aiPanel.title}</p>
                <button onClick={() => setAiPanel(null)} className="text-[10px] text-gray-400 hover:text-gray-600"><T k="닫기" /></button>
              </div>
              <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{aiPanel.text}</p>
              <p className="mt-1.5 text-[11px] text-gray-500">{AI_ORIGIN_TEXT}가 생성한 참고 정보입니다 — 최종 판단은 의료진에게 있습니다.</p>
            </div>
          )}
        </Section>

        {/* 바이탈 사인 */}
        {vitals && (
          <Section title="활력징후 (Vital Signs)">
            {/* 🔴 (2026-10-07) 표시 부품 정본 — 미측정 항목이 사라지던 카드(`value == null → null`)를 '—'로 남긴다 ·
                 "120/80" 문자열 혈압·hr/rr/bt 별칭은 부품이 읽는다 · 이상 색은 임계 정본(rule) */}
            <VitalSignsGrid vitals={vitals as Record<string, unknown>} rule={vitalsRule} columns={3}
              keys={['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature']} />
            {/* GCS 는 활력 정본 밖 척도 — 미측정을 15(정상)로 접지 않는다 */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              <VitalCard label="GCS" value={vitals.gcs} unit="/15" warn={vitals.gcs != null && vitals.gcs < 15} />
            </div>
            <VitalsRuleNote rule={vitalsRule} className="mt-1" />
          </Section>
        )}

        {/* 트리아지 노트 */}
        {visit.triageNote && (
          <Section title="트리아지 평가">
            <p className="text-gray-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100 whitespace-pre-wrap">
              {visit.triageNote}
            </p>
          </Section>
        )}

        {/* 의사 평가/소견 */}
        {isActive && (
          <Section title="의사 평가 (Assessment)">
            <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="text-xs text-gray-400">
                <T k={visit.doctorId ? '담당의가 배정되었습니다.' : '아직 담당의가 배정되지 않았습니다.'} />
              </div>
              <textarea
                placeholder={tA('초기 평가 소견을 입력하세요... (예: 심전도 판독 결과, 감별 진단, 추가 검사 계획)')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                rows={3}
                value={assessmentText}
                onChange={(e) => setAssessmentText(e.target.value)}
              />
            </div>
          </Section>
        )}

        {/* 오더 현황 */}
        <Section title="오더 현황">
          <div className="space-y-1.5">
            <OrderRow icon="🩸" category="혈액검사" items={['CBC, CMP, Cardiac enzyme (Troponin-I, CK-MB)', 'ABG, Coagulation (PT/aPTT)']} status="진행중" />
            <OrderRow icon="📷" category="영상검사" items={['Chest X-ray (PA)', 'CT — 해당 시 추가 오더']} status="대기"
              action={
                /* 🔴 raw /pacs/ 는 Orthanc 이고 자체 Basic 인증이 걸려 있어 브라우저 로그인 창이 뜬다.
                   HIS SSO 로 OHIF(/viewer/)를 여는 공용 헬퍼를 쓴다. */
                <button type="button" onClick={() => void openPacsViewer(undefined, visit.patient?.mrn)}
                  className="text-[10px] text-blue-600 hover:underline"><T k="PACS 뷰어" /></button>
              } />
            <OrderRow icon="💊" category="약물투여" items={['NS 1L IV bolus', '해열제/진통제 — 증상에 따라']} status="투여중" />
            <OrderRow icon="🫀" category="심전도" items={['12-lead ECG']} status={visit.triageLevel === 'LEVEL_1' ? '완료' : '대기'} />
          </div>
        </Section>

        {/* 중증도 재분류 제안 */}
        <EmergencyAiTriage visitId={visit.id} />

        {/* 간호 기록 */}
        <NursingNotePanel
          patientId={visit.patientId}
          contextType="EMERGENCY"
          contextId={visit.id}
          patientName={`${visit.patient?.familyName || ''}${visit.patient?.givenName || ''}`}
          compact
        />

        {/* 타임라인 */}
        <Section title="타임라인">
          <div className="space-y-2 pl-1">
            <TimelineItem time={visit.arrivalAt} label="응급실 도착" color="text-rose-600" />
            {visit.triagedAt && <TimelineItem time={visit.triagedAt} label="트리아지 완료" color="text-amber-600" />}
            {visit.treatmentStartedAt && <TimelineItem time={visit.treatmentStartedAt} label="치료 시작" color="text-blue-600" />}
            {visit.dispositionAt && <TimelineItem time={visit.dispositionAt} label={visit.disposition ? DISPOSITION_LABEL[visit.disposition] ?? '처분 결정' : '처분 결정'} color="text-green-600" />}
            {isActive && (
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
                <span className="text-[11px] text-gray-400"><T k="진행 중..." /></span>
              </div>
            )}
          </div>
        </Section>

        {/* 상태 표시 */}
        {!!(visit as unknown as Record<string, unknown>).status && (
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-2">
            <span className="text-[10px] text-gray-500"><T k="현재 상태" /></span>
            <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
              {String((visit as unknown as Record<string, unknown>).status ?? 'PENDING_TRIAGE').replace(/_/g, ' ')}
            </span>
          </div>
        )}

        {/* 비응급 경고 */}
        {!!(visit as unknown as Record<string, unknown>).isNonEmergency && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
            <p className="text-xs font-bold text-amber-700"><T k="비응급 판정 (KTAS 5)" /></p>
            <p className="text-[10px] text-amber-600">외래 진료가 적절합니다. 응급의료관리료 미청구.</p>
          </div>
        )}

        {/* 하단 액션 — 상태별 버튼 */}
        {isActive && (
          <div className="space-y-2 pt-2 border-t">
            <div className="flex gap-2">
              <Link href={`/patients/${visit.patientId}`} className="flex-1 text-center px-3 py-2 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium">
                <T k="전체 차트" />
              </Link>
              <button onClick={() => setTreatmentModal(visit.id)}
                className="flex-1 px-3 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                <T k="치료 기록" />
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowStatusChange(true)}
                className="flex-1 px-3 py-2 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium">
                <T k="상태 변경" />
              </button>
              <button onClick={() => setShowReassess(true)}
                className="flex-1 px-3 py-2 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 font-medium">
                <T k="KTAS 재분류" />
              </button>
              <button onClick={openDispositionPanel}
                className="flex-1 px-3 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium">
                <T k="처분 결정" />
              </button>
            </div>
          </div>
        )}

        {/* 처분 변경 — 결정 뒤에도 퇴실 전까지는 바뀔 수 있다(관찰→입원, 전원 결정 후 취소) */}
        {canRevise && !showDisposition && (
          <div className="pt-2 border-t">
            <button onClick={openDispositionPanel}
              className="w-full px-3 py-2 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 font-medium">
              <T k="처분 변경" /> (<T k="현재" />: {DISPOSITION_LABEL[visit.disposition ?? ''] ?? visit.disposition})
            </button>
          </div>
        )}
        {isClosed && isRevision && (
          <p className="pt-2 border-t text-[10px] text-gray-400">
            <T k="퇴실 확정된 방문입니다 — 처분 변경 불가" /> (<T k="현재" />: {DISPOSITION_LABEL[visit.disposition ?? ''] ?? visit.disposition})
          </p>
        )}

        {/* 상태 변경 패널 */}
        {showStatusChange && (
          <div className="bg-white border rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-gray-700"><T k="상태 변경" /></p>
            <div className="grid grid-cols-2 gap-1">
              {['PENDING_TRIAGE', 'TRIAGED', 'PENDING_DOCTOR', 'IN_TREATMENT', 'PENDING_RESULT', 'UNDER_OBSERVATION', 'PENDING_DISPOSITION'].map(s => (
                <button key={s} onClick={() => statusMut.mutate(s)}
                  className="py-1.5 text-[10px] bg-gray-100 hover:bg-blue-100 rounded-lg font-medium">
                  {s.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <button onClick={() => setShowStatusChange(false)} className="text-[10px] text-gray-400"><T k="닫기" /></button>
          </div>
        )}

        {/* KTAS 재분류 패널 */}
        {showReassess && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-amber-700"><T k="KTAS 재분류" /></p>
            <div className="flex gap-1">
              {['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5'].map(l => (
                <button key={l} onClick={() => setNewKtas(l)}
                  className={`flex-1 py-1.5 text-[10px] rounded-lg font-bold ${newKtas === l ? 'bg-amber-600 text-white' : 'bg-white border'}`}>
                  {l.replace('LEVEL_', '')}
                </button>
              ))}
            </div>
            <ReasonInput domain="erReassess" required value={reassessReason} onChange={setReassessReason}
              placeholder={tA('변경 사유...')} className="w-full px-2 py-1.5 border rounded-lg text-xs" />
            <div className="flex gap-2">
              <button onClick={() => setShowReassess(false)} className="text-[10px] text-gray-400"><T k="닫기" /></button>
              <button onClick={() => reassessMut.mutate()} disabled={!newKtas || !reasonFilled(reassessReason)}
                className="flex-1 py-1.5 bg-amber-600 text-white text-xs font-bold rounded-lg disabled:opacity-50"><T k="재분류 확정" /></button>
            </div>
          </div>
        )}

        {/* 처분 결정 패널 */}
        {showDisposition && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-emerald-700"><T k={isRevision ? '처분 변경' : '처분 결정'} /></p>
            {isRevision && (
              <p className="text-[10px] text-emerald-800 bg-white/70 border border-emerald-200 rounded-lg px-2 py-1">
                현재 처분 <b>{DISPOSITION_LABEL[visit.disposition ?? ''] ?? visit.disposition}</b>
                {visit.dispositionAt ? ` (${formatDateTime(visit.dispositionAt)} 결정)` : ''} — 변경 전 기록은 감사에 보존됩니다.
              </p>
            )}
            <div className="grid grid-cols-3 gap-1">
              {[
                { key: 'DISCHARGE', label: '퇴원', cls: 'bg-green-100 text-green-700' },
                { key: 'ADMISSION', label: '입원', cls: 'bg-blue-100 text-blue-700' },
                { key: 'TRANSFER', label: '전원', cls: 'bg-purple-100 text-purple-700' },
                { key: 'OBSERVATION', label: '관찰', cls: 'bg-amber-100 text-amber-700' },
                { key: 'SURGERY', label: '수술', cls: 'bg-red-100 text-red-700' },
                { key: 'LEAVE_AMA', label: '자의퇴원', cls: 'bg-gray-100 text-gray-700' },
              ].map(d => (
                <button key={d.key} onClick={() => setDispType(d.key)}
                  className={`py-1.5 text-[10px] rounded-lg font-bold ${dispType === d.key ? 'ring-2 ring-emerald-500 ' + d.cls : d.cls + ' opacity-60'}`}>
                  {d.label}
                </button>
              ))}
            </div>
            {(dispType === 'DISCHARGE' || dispType === 'LEAVE_AMA') && (
              <textarea value={dispInstructions} onChange={e => setDispInstructions(e.target.value)}
                rows={2} placeholder={tA('귀가 지침 / 주의사항...')} className="w-full px-2 py-1.5 border rounded-lg text-xs resize-none" />
            )}
            {dispType === 'DISCHARGE' && (
              <input type="date" value={dispFollowUp} onChange={e => setDispFollowUp(e.target.value)}
                className="w-full px-2 py-1.5 border rounded-lg text-xs" />
            )}
            {/* 전원기관·전원사유는 원장 컬럼인데 이 화면에 입력칸이 없어 언제나 비어 저장됐다 */}
            {dispType === 'TRANSFER' && (
              <>
                <input value={dispTransferTo} onChange={e => setDispTransferTo(e.target.value)}
                  placeholder={tA('전원 대상 기관')} className="w-full px-2 py-1.5 border rounded-lg text-xs" />
                <ReasonInput domain="erTransfer" value={dispTransferReason} onChange={setDispTransferReason}
                  placeholder={tA('전원 사유')} className="w-full px-2 py-1.5 border rounded-lg text-xs" />
              </>
            )}
            {isRevision && (
              <ReasonInput domain="erReassess" required value={dispRevisionReason} onChange={setDispRevisionReason}
                placeholder={tA('변경 사유... (필수)')} className="w-full px-2 py-1.5 border rounded-lg text-xs" />
            )}
            <div className="flex gap-2">
              <button onClick={() => setShowDisposition(false)} className="text-[10px] text-gray-400"><T k="닫기" /></button>
              <button onClick={() => dispositionMut.mutate()}
                disabled={dispositionMut.isPending || (isRevision && !reasonFilled(dispRevisionReason))}
                className="flex-1 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                <T k={dispositionMut.isPending ? '처리 중...' : isRevision ? '처분 변경 확정' : '처분 확정'} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 치료 기록 추가 모달 */}
      {treatmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-[420px] p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4"><T k="치료 기록 추가" /></h3>
            <p className="text-sm text-gray-600 mb-3">
              <T k="환자" />: <span className="font-medium text-gray-900">{visit.patient?.familyName}{visit.patient?.givenName}</span>
            </p>
            <textarea
              placeholder={tA('치료/처치 내용 입력...')}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
              rows={5}
              value={treatmentNote}
              onChange={(e) => setTreatmentNote(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setTreatmentModal(null); setTreatmentNote(''); }}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
              >
                <T k="취소" />
              </button>
              <button
                onClick={() => treatmentMutation.mutate({ visitId: treatmentModal, note: treatmentNote })}
                disabled={!treatmentNote.trim() || treatmentMutation.isPending}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                <T k={treatmentMutation.isPending ? '저장 중...' : '저장'} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5"><T k={title} /></h4>
      {children}
    </div>
  );
}

function InfoRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <T k={label} className="text-gray-500 min-w-[48px]" />
      <span className={`font-medium ${warn ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}

function OrderRow({ icon, category, items, status, action }: { icon: string; category: string; items: string[]; status: string; action?: React.ReactNode }) {
  const statusColor = status === '완료' ? 'text-green-600 bg-green-50' : status === '진행중' || status === '투여중' ? 'text-blue-600 bg-blue-50' : 'text-gray-500 bg-gray-50';
  return (
    <div className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <span className="text-sm mt-0.5">{icon}</span>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <T k={category} className="text-xs font-medium text-gray-900" />
          <div className="flex items-center gap-2">
            {action}
            <T k={status} className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusColor}`} />
          </div>
        </div>
        {items.map((item, i) => <p key={i} className="text-[11px] text-gray-500">{item}</p>)}
      </div>
    </div>
  );
}

function VitalCard({ label, value, unit, warn, flag }: { label: string; value: string | number | undefined; unit: string; warn?: boolean; flag?: VitalItemFlag }) {
  // 미측정은 카드를 지우지 않고 '—'(VITAL_UNMEASURED_TEXT)로 남긴다
  const shown = value == null || value === '' ? VITAL_UNMEASURED_TEXT : value;
  // 위급=빨강·주의=주황(임계 정본 판정) · `warn` 은 활력 임계가 아닌 척도(GCS 등)에만
  const crit = flag === 'CRITICAL' || (flag == null && warn);
  const box = crit ? 'bg-red-50 border-red-200' : flag === 'WARNING' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100';
  return (
    <div className={`rounded-lg px-3 py-2 text-center border ${box}`}>
      <p className="text-[10px] text-gray-500 font-medium">{label}</p>
      <p className={`text-base font-bold ${shown === VITAL_UNMEASURED_TEXT ? 'text-gray-400' : crit ? 'text-red-600' : flag === 'WARNING' ? 'text-amber-700' : 'text-gray-900'}`}>{shown}</p>
      <p className="text-[9px] text-gray-400">{unit}</p>
    </div>
  );
}

function TimelineItem({ time, label, color }: { time: string; label: string; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-2 h-2 rounded-full ${color.replace('text-', 'bg-')}`} />
      <span className="text-[11px] text-gray-400 w-24">{formatDateTime(time)}</span>
      <T k={label} className={`text-xs font-medium ${color}`} />
    </div>
  );
}

function EmergencyAiTriage({ visitId }: { visitId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ai-emergency-triage', visitId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/emergency/visits/${visitId}/ai-triage`),
    staleTime: 5 * 60 * 1000,
  });
  const result = (data?.data as { data?: Record<string, unknown> })?.data ?? data?.data;
  // 🔴 조회 실패를 `null`(제안 없음)로 접지 않는다 — 패널이 실패를 실패라고 말한다
  return <AiSuggestionPanel title="중증도 재분류 제안" data={result} source={(result as Record<string, unknown>)?.source as string} isLoading={isLoading} error={isError ? extractErrorMessage(error) : undefined} compact />;
}
