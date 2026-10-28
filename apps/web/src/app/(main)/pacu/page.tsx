'use client';

import { PACU_DELAY_REASON_LABEL } from '@hospital-run/shared';
import { vitalText } from '@/components/vitals/VitalSigns';
import { AnesthesiaHandoffCard, PacuIoPanel, PacuNotesPanel, PacuOpsBar, PacuQualityStrip, ScoreHistory, VitalsTrend, RASS_LABEL, RASS_OPTIONS, type PacuDetailRecord, type PacuQuality } from './PacuDetailPanels';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import NursingNotePanel from '@/components/nursing/NursingNotePanel';
import { useAuthStore } from '@/stores/auth-store';
import { DestinationPicker, destinationReady, useDestinationOptions, type Destination } from './DestinationPicker';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { PacuAlertRule } from './PacuAlertRule';

import { EmptyState, Unit, Duration, useDurationText } from '@/components/ui/display';

interface PendingSurgery {
  id: string;
  patientId: string;
  procedureName: string;
  endedAt: string;
  anesthesiaType?: string;
  patient?: { id: string; familyName: string; givenName: string; mrn: string };
}

/**
 * 서버가 계산한 회복실 감시 파생값(`pacu.service.decorate`).
 * 🔴 화면이 다시 계산하지 않는다 — 두 화면이 각자 세면 같은 환자를 두고 다른 말을 한다.
 */
interface PacuMonitoring {
  vitalsCount: number;
  lastVitalsAt: string | null;
  noVitalsYet: boolean;
  nextVitalsDueAt: string | null;
  /** 양수=지연 분 · 음수=남은 분 · null=퇴실 기록 */
  vitalsOverdueMin: number | null;
  vitalsOverdue: boolean;
  stayMinutes: number;
  prolongedStay: boolean;
  lastTemp: number | null;
  /** true=저체온 · false=정상 · null=체온 미측정 */
  hypothermia: boolean | null;
  hypothermiaSeverity: 'SEVERE' | 'MILD' | null;
  aldreteReady: boolean | null;
  /** Aldrete 0점 항목(총점과 관계없이 기준 미달 — 2026-09-30) · null = 세부 없음 */
  aldreteZeroItems?: string[] | null;
  padssReady: boolean | null;
  arrivalHandoffRecorded: boolean;
  dischargeHandoffRecorded: boolean;
}

interface PacuPatient extends Omit<PacuDetailRecord, 'id' | 'dischargeTime'> {
  id: string;
  patientId: string;
  surgeryId: string;
  arrivalTime: string;
  dischargeTime?: string | null;
  /** 정상 퇴실 절차를 거치지 않고 닫힌 기록(데이터 정리 등) — 체류시간이 사실이 아니다 */
  dischargeOverride?: string | null;
  disposition?: string | null;
  aldreteAssessedAt?: string | null;
  padssAssessedAt?: string | null;
  aldretScore?: number | null;
  painScore?: number | null;
  ponvScore?: number | null;
  ponvManagement?: string | null;
  padssScore?: number | null;
  oxygenTherapy?: string | null;
  notes?: string | null;
  complications?: { type: string; severity: string; intervention?: string; note?: string; time: string }[];
  painAssessments?: { score: number; scale?: string; intervention?: string; time: string }[];
  /** 자유 JSON — 시드는 `{drug,action,time}`, 신규는 `{type,detail,note,time,by}`. 모르는 키도 버리지 않는다 */
  interventions?: unknown[];
  monitoring?: PacuMonitoring;
  patient?: { id: string; familyName: string; givenName: string; mrn: string };
}

interface VitalRecord {
  time: string;
  bp?: string;
  hr?: number;
  rr?: number;
  spo2?: number;
  temp?: number;
  consciousness?: string;
  rass?: number;
  abnormal?: boolean;
  flags?: string[];
}

/** 척도 만점·임계·감시 주기 정본은 서버(`GET /api/v1/pacu/settings`) — 화면에 숫자를 적지 않는다 */
interface PacuSettings {
  vitalsIntervalMin: number;
  prolongedStayMin: number;
  hypothermiaWarnC: number;
  source: 'CONFIG' | 'DEFAULT' | 'UNAVAILABLE';
  /** 퇴실 기준값 출처 — 원내 기준 미설정이면 DEFAULT(사람 결정 `pacu.dischargeCriteria`) */
  criteriaSource?: 'CONFIG' | 'DEFAULT' | 'UNAVAILABLE';
  scales: {
    aldrete: { max: number; dischargeMin: number; items: number };
    padss: { max: number; dischargeMin: number; items: number };
  };
  /** 활력 경보 임계(2026-10-01 설정화 · 사람 결정 `pacu.vitalAlertThresholds`) — 구버전 서버면 없음 */
  alertThresholds?: { spo2Low: number; hrLow: number; hrHigh: number; rrLow: number; rrHigh: number; sbpLow: number; sbpHigh: number; tempLow: number; tempHigh: number };
  alertSource?: 'CONFIG' | 'DEFAULT' | 'UNAVAILABLE';
  alertDroppedKeys?: string[];
}

interface PacuStats {
  activeCount: number;
  dischargedToday: number;
  avgStayMinutes: number | null;
  avgAldrete: number | null;
  measurableCount: number;
  excludedOverride: number;
  vitalsOverdueCount: number;
  noVitalsYetCount: number;
  prolongedStayCount: number;
  hypothermiaCount: number;
  tempUnknownCount: number;
  arrivalHandoffMissingCount: number;
  dischargeHandoffMissingCount: number;
  quality?: PacuQuality;
  delayReasonCounts?: Record<string, number>;
}

interface ScaleItem {
  key: string;
  label: string;
  options: { value: number; label: string }[];
}

const ALDRETE_ITEMS: ScaleItem[] = [
  { key: 'activity', label: '활동', options: [{ value: 0, label: '사지 움직임 불가' }, { value: 1, label: '2개 사지 움직임' }, { value: 2, label: '4개 사지 움직임' }] },
  { key: 'respiration', label: '호흡', options: [{ value: 0, label: '무호흡' }, { value: 1, label: '호흡곤란/제한적' }, { value: 2, label: '심호흡/기침 가능' }] },
  { key: 'circulation', label: '순환', options: [{ value: 0, label: 'BP 수술전 +/-50' }, { value: 1, label: 'BP 수술전 +/-20~50' }, { value: 2, label: 'BP 수술전 +/-20' }] },
  { key: 'consciousness', label: '의식', options: [{ value: 0, label: '반응 없음' }, { value: 1, label: '자극시 각성' }, { value: 2, label: '완전 각성' }] },
  { key: 'spo2', label: '산소포화도', options: [{ value: 0, label: 'SpO2 <90%' }, { value: 1, label: 'SpO2 90-92% (O2)' }, { value: 2, label: 'SpO2 >92% (room air)' }] },
  { key: 'pain', label: '통증', options: [{ value: 0, label: '극심한 통증' }, { value: 1, label: '중등도 통증' }, { value: 2, label: '경미/무통증' }] },
];

const PONV_OPTIONS = [{ value: 0, label: '없음' }, { value: 1, label: '오심' }, { value: 2, label: '구역질' }, { value: 3, label: '구토' }];
const PADSS_ITEMS: ScaleItem[] = [
  { key: 'vitalSigns', label: '활력징후', options: [{ value: 0, label: '수술전 대비 40%↑ 변동' }, { value: 1, label: '20~40% 변동' }, { value: 2, label: '20% 이내' }] },
  { key: 'ambulation', label: '보행', options: [{ value: 0, label: '불가/어지럼' }, { value: 1, label: '보조 필요' }, { value: 2, label: '안정적 보행' }] },
  { key: 'nausea', label: '오심·구토', options: [{ value: 0, label: '중증' }, { value: 1, label: '중등도(치료 반응)' }, { value: 2, label: '경미/없음' }] },
  { key: 'pain', label: '통증', options: [{ value: 0, label: '중증' }, { value: 1, label: '중등도' }, { value: 2, label: '경미/없음' }] },
  { key: 'bleeding', label: '수술부위 출혈', options: [{ value: 0, label: '중증' }, { value: 1, label: '중등도' }, { value: 2, label: '경미/없음' }] },
];

const COMPLICATION_TYPES: { value: string; label: string }[] = [
  { value: 'AIRWAY', label: '기도폐쇄/후두경련' }, { value: 'RESP_DEPRESSION', label: '호흡저하' },
  { value: 'BLEEDING', label: '출혈' }, { value: 'SHIVERING', label: '오한/전율' },
  { value: 'DELIRIUM', label: '섬망/각성지연' }, { value: 'HYPOTHERMIA', label: '저체온' },
  { value: 'PONV_SEVERE', label: '심한 오심·구토' }, { value: 'HYPOTENSION', label: '저혈압' },
  { value: 'HYPERTENSION', label: '고혈압' }, { value: 'ARRHYTHMIA', label: '부정맥' },
  { value: 'PAIN_UNCONTROLLED', label: '통증조절 실패' },
  // 2026-10-07 — 질 지표가 셀 수 있게 기도·기타에 뭉쳐 있던 것을 가른다(서버 DTO 와 같은 어휘)
  { value: 'REINTUBATION', label: '재삽관' }, { value: 'DESATURATION', label: '탈포화' },
  { value: 'OTHER', label: '기타' },
];
const COMPLICATION_LABEL = Object.fromEntries(COMPLICATION_TYPES.map(c => [c.value, c.label]));
const SEVERITY_OPTIONS = [{ value: 'MILD', label: '경증' }, { value: 'MODERATE', label: '중등도' }, { value: 'SEVERE', label: '중증' }];

// 중재(처치) — 어휘 정본은 서버 `PACU_INTERVENTION_TYPES`
const INTERVENTION_TYPES: { value: string; label: string }[] = [
  { value: 'OXYGEN', label: '산소 투여' }, { value: 'WARMING', label: '가온' },
  { value: 'MEDICATION', label: '약물 투여' }, { value: 'FLUID', label: '수액' },
  { value: 'AIRWAY_SUPPORT', label: '기도 유지' }, { value: 'POSITIONING', label: '체위 변경' },
  { value: 'MONITORING', label: '감시 강화' }, { value: 'OTHER', label: '기타' },
];
const INTERVENTION_LABEL = Object.fromEntries(INTERVENTION_TYPES.map(i => [i.value, i.label]));

const CONSCIOUSNESS_OPTIONS = ['명료', '기면', '혼미', '반혼수', '혼수'];
const DISPOSITION_OPTIONS = [
  { value: 'WARD', label: '병동 이동' },
  { value: 'ICU', label: 'ICU 이동' },
  { value: 'HOME', label: '귀가' },
];

const HANDOFF_FIELDS = [
  ['situation', 'S 상황'], ['background', 'B 배경'], ['assessment', 'A 평가'],
  ['recommendation', 'R 권고'], ['notes', '라인·배액·알레르기'],
] as const;
type HandoffForm = Record<(typeof HANDOFF_FIELDS)[number][0], string>;
const EMPTY_HANDOFF: HandoffForm = { situation: '', background: '', assessment: '', recommendation: '', notes: '' };

/** 🔴 쓰기 폼 초기값은 "미선택" — 정상값으로 시작하면 누르지 않은 항목이 정상으로 저장된다 */
const emptyScores = (items: ScaleItem[]): Record<string, number | null> =>
  Object.fromEntries(items.map(i => [i.key, null]));

const hhmm = (iso: string) =>kdate(iso, 'time');

/** 저장된 중재 항목은 시드/신규가 서로 다른 모양이다 — 모르는 키를 버리지 않고 읽을 수 있는 것만 읽는다 */
function readIntervention(raw: unknown): { label: string; detail: string; time: string | null } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const type = str(o.type);
  const label = (type && (INTERVENTION_LABEL[type] ?? type)) ?? str(o.action) ?? '중재';
  const detail = [str(o.detail), str(o.drug), str(o.note)].filter(Boolean).join(' · ');
  return { label, detail, time: str(o.time) };
}

export default function PacuPage() {
  const fmtDur = useDurationText();
  const qc = useQueryClient();
  const tA = useTAttr();
  const { user } = useAuthStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDischarge, setShowDischarge] = useState(false);
  // 🔴 쓰기 폼 초기값은 미선택(2026-09-30) — 종전 'WARD' 로 시작해 고르지 않은 퇴실 구분이 병동으로 저장될 수 있었다
  const [disposition, setDisposition] = useState('');
  const [overrideReason, setOverrideReason] = useState(''); // 기준 미달 강제 퇴실 사유

  // Vital sign form — 🔴 의식수준도 "미선택"으로 시작한다(종전 기본값 '명료' 이 매 기록마다 저장됐다)
  const [vitalForm, setVitalForm] = useState({
    systolicBp: '', diastolicBp: '', heartRate: '', respiratoryRate: '', spo2: '', temperature: '', consciousnessLevel: '', rass: '',
  });

  // 🔴 Aldrete·PADSS·PONV·통증 전부 미선택으로 시작한다. 각 저장은 **그 시점의 새 평가**다.
  const [aldreteScores, setAldreteScores] = useState<Record<string, number | null>>(() => emptyScores(ALDRETE_ITEMS));
  const [padssScores, setPadssScores] = useState<Record<string, number | null>>(() => emptyScores(PADSS_ITEMS));
  const [ponvScore, setPonvScore] = useState<number | null>(null);
  // 점수 평가 시점 — 첫 평가는 서버가 '입실'로 적는다 · 그 뒤는 중간/퇴실 전(점수 이력)
  const [scorePhase, setScorePhase] = useState<'INTERVAL' | 'DISCHARGE'>('INTERVAL');
  const [ponvManagement, setPonvManagement] = useState('');
  const [dischargeHandoff, setDischargeHandoff] = useState<HandoffForm>(EMPTY_HANDOFF);
  const [compType, setCompType] = useState('');
  const [compSeverity, setCompSeverity] = useState('');
  const [compIntervention, setCompIntervention] = useState('');
  const [painScore, setPainScore] = useState<number | null>(null);
  const [painIntervention, setPainIntervention] = useState('');
  const [ivType, setIvType] = useState('');
  const [ivDetail, setIvDetail] = useState('');
  // 입실 처리(수술실→PACU 인계)
  const [admitTarget, setAdmitTarget] = useState<PendingSurgery | null>(null);
  const [admitOxygen, setAdmitOxygen] = useState('');
  const [arrivalHandoff, setArrivalHandoff] = useState<HandoffForm>(EMPTY_HANDOFF);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pacu-patients'],
    // 🔴 (2026-09-30) 종전엔 전체 기록(최신 300건)을 받아 화면이 재실만 걸렀다 — 300건을 넘으면 **가장 오래 재실 중인 환자부터** 목록에서 빠졌다
    queryFn: () => apiClient.get<{ data: PacuPatient[] }>('/api/v1/pacu/active'),
    refetchInterval: pollMs('fast'),
  });

  const { data: settingsRes, isError: settingsError } = useQuery({
    queryKey: ['pacu-settings'],
    queryFn: () => apiClient.get<{ data: PacuSettings }>('/api/v1/pacu/settings'),
    staleTime: 5 * 60 * 1000,
  });
  const settings = settingsRes?.data;

  const { data: statsRes, isError: statsError } = useQuery({
    queryKey: ['pacu-stats'],
    queryFn: () => apiClient.get<{ data: PacuStats }>('/api/v1/pacu/stats'),
    refetchInterval: pollMs('normal'),
  });
  const stats = statsRes?.data;

  const { data: vitalsData, isError: vitalsError } = useQuery({
    queryKey: ['pacu-vitals', selectedId],
    queryFn: () => apiClient.get<{ data: VitalRecord[] }>(`/api/v1/pacu/${selectedId}/vitals`),
    enabled: !!selectedId,
    refetchInterval: pollMs('fast'),
  });

  // 환자를 바꾸면 평가 폼을 비운다 — 앞 환자의 선택이 남아 다음 환자에게 저장되지 않게.
  useEffect(() => {
    setAldreteScores(emptyScores(ALDRETE_ITEMS));
    setPadssScores(emptyScores(PADSS_ITEMS));
    setPonvScore(null); setPonvManagement('');
    setPainScore(null); setPainIntervention('');
    setCompType(''); setCompSeverity(''); setCompIntervention('');
    setIvType(''); setIvDetail('');
    setVitalForm({ systolicBp: '', diastolicBp: '', heartRate: '', respiratoryRate: '', spo2: '', temperature: '', consciousnessLevel: '', rass: '' });
    setShowDischarge(false); setOverrideReason(''); setDischargeHandoff(EMPTY_HANDOFF);
  }, [selectedId]);

  const invalidateRecord = () => {
    qc.invalidateQueries({ queryKey: ['pacu-patients'] });
    qc.invalidateQueries({ queryKey: ['pacu-stats'] });
  };

  const recordVitalMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post<{ data: { abnormal?: boolean; flags?: string[]; nextVitalsDueAt?: string } }>(`/api/v1/pacu/${selectedId}/vitals`, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['pacu-vitals', selectedId] });
      invalidateRecord();
      const d = (res as { data?: { abnormal?: boolean; flags?: string[]; nextVitalsDueAt?: string } })?.data;
      const next = d?.nextVitalsDueAt ? ` · 다음 측정 ${hhmm(d.nextVitalsDueAt)}` : '';
      if (d?.abnormal) toast.warning(`⚠️ 활력징후 이상: ${(d.flags ?? []).join(', ')}${next}`);
      else toast.success(`활력징후 기록 완료${next}`);
      setVitalForm({ systolicBp: '', diastolicBp: '', heartRate: '', respiratoryRate: '', spo2: '', temperature: '', consciousnessLevel: '', rass: '' });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '기록 실패'),
  });

  const saveAldreteMut = useMutation({
    mutationFn: (body: { score: number; detail: Record<string, number> }) => apiClient.patch(`/api/v1/pacu/${selectedId}/aldrete`, { ...body, phase: scorePhase }),
    onSuccess: () => { invalidateRecord(); toast.success('Aldrete 점수 저장'); setAldreteScores(emptyScores(ALDRETE_ITEMS)); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '저장 실패'),
  });

  const savePonvMut = useMutation({
    mutationFn: (body: { score: number; management?: string }) => apiClient.patch(`/api/v1/pacu/${selectedId}/ponv`, { ...body, phase: scorePhase }),
    onSuccess: () => { invalidateRecord(); toast.success('PONV 평가 저장'); },
    onError: () => toast.error('저장 실패'),
  });

  const savePadssMut = useMutation({
    mutationFn: (body: { score: number; detail: Record<string, number> }) => apiClient.patch(`/api/v1/pacu/${selectedId}/padss`, { ...body, phase: scorePhase }),
    onSuccess: () => { invalidateRecord(); toast.success('PADSS 귀가 척도 저장'); setPadssScores(emptyScores(PADSS_ITEMS)); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '저장 실패'),
  });

  const addComplicationMut = useMutation({
    mutationFn: (body: { type: string; severity: string; intervention?: string }) => apiClient.post(`/api/v1/pacu/${selectedId}/complication`, body),
    onSuccess: () => { invalidateRecord(); toast.success('합병증 기록'); setCompType(''); setCompSeverity(''); setCompIntervention(''); },
    onError: () => toast.error('기록 실패'),
  });

  const addPainMut = useMutation({
    mutationFn: (body: { score: number; intervention?: string }) => apiClient.post(`/api/v1/pacu/${selectedId}/pain`, body),
    onSuccess: () => { invalidateRecord(); toast.success('통증 재평가 기록'); setPainScore(null); setPainIntervention(''); },
    onError: () => toast.error('기록 실패'),
  });

  const addInterventionMut = useMutation({
    mutationFn: (body: { type: string; detail?: string }) => apiClient.post(`/api/v1/pacu/${selectedId}/intervention`, body),
    onSuccess: () => { invalidateRecord(); toast.success('중재 기록'); setIvType(''); setIvDetail(''); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '기록 실패'),
  });

  // 퇴실 목적지(2026-09-30) — 서버가 준 선택지(원 병상·전실·ICU·귀가) · 초기값 미선택
  const [destination, setDestination] = useState<Destination>({ mode: '' });
  const destQ = useDestinationOptions(selectedId, showDischarge);
  useEffect(() => { setDestination({ mode: '' }); }, [selectedId, disposition]);
  const dischargeMut = useMutation({
    mutationFn: (body: { disposition: string; overrideReason?: string; dischargeHandoff?: Record<string, string>; targetBedId?: string; icuBedId?: string; icuAdmitReason?: string }) => apiClient.post(`/api/v1/pacu/${selectedId}/discharge`, body),
    onSuccess: () => {
      invalidateRecord();
      qc.invalidateQueries({ queryKey: ['pacu-destination-options'] });
      toast.success('퇴실 처리 완료');
      setSelectedId(null); setShowDischarge(false); setOverrideReason('');
      setDischargeHandoff(EMPTY_HANDOFF);
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '퇴실 처리 실패'),
  });

  // 수술 완료 → PACU 입실 대기
  const { data: pendingData, isError: pendingError } = useQuery({
    queryKey: ['pacu-pending'],
    queryFn: () => apiClient.get<{ data: PendingSurgery[] }>('/api/v1/pacu/pending-admissions'),
    refetchInterval: pollMs('normal'),
  });
  const pendingRaw = pendingData?.data;
  const pending: PendingSurgery[] = Array.isArray(pendingRaw) ? pendingRaw : (pendingRaw as unknown as Record<string, unknown>)?.data as PendingSurgery[] ?? [];

  const admitMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/api/v1/pacu/admit', body),
    onSuccess: () => {
      invalidateRecord();
      qc.invalidateQueries({ queryKey: ['pacu-pending'] });
      toast.success('PACU 입실 처리 완료');
      setAdmitTarget(null); setAdmitOxygen(''); setArrivalHandoff(EMPTY_HANDOFF);
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '입실 처리 실패'),
  });

  const _raw = data?.data;
  const allPatients: PacuPatient[] = Array.isArray(_raw) ? _raw : (_raw as unknown as Record<string, unknown>)?.data as PacuPatient[] ?? [];
  const activePatients = allPatients.filter(p => !p.dischargeTime);
  const vitals: VitalRecord[] = (() => { const r = vitalsData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as VitalRecord[] ?? []; })();

  const selected = activePatients.find(p => p.id === selectedId);
  const mon = selected?.monitoring;

  const aldreteAnswered = ALDRETE_ITEMS.filter(i => aldreteScores[i.key] != null).length;
  const aldreteComplete = aldreteAnswered === ALDRETE_ITEMS.length;
  const aldreteTotal = aldreteComplete ? ALDRETE_ITEMS.reduce((s, i) => s + (aldreteScores[i.key] as number), 0) : null;
  // 고른 항목 중 0점 — 총점이 기준 이상이어도 기준 미달(서버 게이트와 같은 규칙)
  const aldreteZeroSel = ALDRETE_ITEMS.filter((i) => aldreteScores[i.key] === 0).map((i) => i.key);
  const padssAnswered = PADSS_ITEMS.filter(i => padssScores[i.key] != null).length;
  const padssComplete = padssAnswered === PADSS_ITEMS.length;
  const padssTotal = padssComplete ? PADSS_ITEMS.reduce((s, i) => s + (padssScores[i.key] as number), 0) : null;

  const aldreteMin = settings?.scales.aldrete.dischargeMin ?? null;
  const padssMin = settings?.scales.padss.dischargeMin ?? null;
  /** 만점은 서버가 준다 — 아직 못 받았으면 분모를 지어내지 않고 생략한다 */
  const denom = (max?: number) => (max == null ? '' : `/${max}`);

  const scoreTone = (score: number | null | undefined, min: number | null) => {
    if (score == null) return 'text-gray-500 bg-gray-100';
    if (min == null) return 'text-gray-700 bg-gray-100';
    if (score >= min) return 'text-green-700 bg-green-100';
    if (score >= min - 2) return 'text-amber-700 bg-amber-100';
    return 'text-red-700 bg-red-100';
  };

  const handleRecordVital = () => {
    if (!selectedId) return;
    const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
    const body: Record<string, unknown> = {
      hr: num(vitalForm.heartRate),
      rr: num(vitalForm.respiratoryRate),
      spo2: num(vitalForm.spo2),
      temp: num(vitalForm.temperature),
    };
    if (vitalForm.consciousnessLevel) body.consciousness = vitalForm.consciousnessLevel;
    // 진정 척도 — 미선택이면 보내지 않는다(0 = 명료·차분과 미평가를 가른다)
    if (vitalForm.rass !== '') body.rass = Number(vitalForm.rass);
    if (vitalForm.systolicBp.trim() && vitalForm.diastolicBp.trim()) body.bp = `${vitalForm.systolicBp}/${vitalForm.diastolicBp}`;
    // 🔴 재지 않은 측정을 기록하지 않는다 — 빈 기록은 타임라인에서 "정상으로 확인된 라운드"로 읽힌다
    if (!Object.values(body).some(v => v !== undefined)) {
      toast.error('측정값을 한 항목 이상 입력해 주세요');
      return;
    }
    recordVitalMut.mutate(body);
  };

  const asHandoff = (h: HandoffForm) => {
    const filled = Object.fromEntries(Object.entries(h).filter(([, v]) => v.trim()));
    return Object.keys(filled).length ? filled : undefined;
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900"><T k="PACU 회복실" /></h2>
        <p className="text-sm text-gray-500 mt-1">
          <T k="수술 후 회복 모니터링 / 활력 재측정 / Aldrete·PADSS 평가 / 퇴실 관리" />
          {settings && (
            <span className="ml-2 text-xs text-gray-400">
              재측정 주기 <Duration minutes={settings.vitalsIntervalMin} /> · 재실 초과 <Duration minutes={settings.prolongedStayMin} /> · 저체온 {settings.hypothermiaWarnC}℃ 미만
              {settings.source === 'DEFAULT' && ' (원내 정책 미설정 — 기본값 적용 중)'}
              {settings.source === 'UNAVAILABLE' && ' (설정 조회 실패 — 기본값으로 감시 중)'}
            </span>
          )}
        </p>
        {settings?.alertThresholds && <PacuAlertRule s={settings} />}
      </div>

      {/* Stats — 🔴 서버 집계를 그대로 쓴다(화면이 따로 세면 같은 사실에 정본이 둘이 된다) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs text-blue-500 font-medium"><T k="현재 재실" /></p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{stats ? stats.activeCount : activePatients.length}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl p-4">
          <p className="text-xs text-emerald-500 font-medium"><T k="오늘 퇴실" /></p>
          <p className="text-3xl font-bold text-emerald-700 mt-1">{statsError ? <span className="text-xl text-red-500"><T k="조회 실패" /></span> : stats ? stats.dischargedToday : '…'}</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4">
          <p className="text-xs text-amber-500 font-medium"><T k="평균 체류" /></p>
          <p className="text-3xl font-bold text-amber-700 mt-1">
            {statsError ? <span className="text-xl text-red-500"><T k="조회 실패" /></span> : !stats ? <span className="text-xl text-gray-400">…</span>
              : stats.avgStayMinutes == null ? <span className="text-xl">산출 불가</span>
              : <Duration minutes={stats.avgStayMinutes} />}
          </p>
          <p className="text-[10px] text-amber-600/70 mt-0.5">
            {!stats ? ' '
              : stats.avgStayMinutes == null ? tA('정상 퇴실 기록 없음')
              : `누적 퇴실 ${stats.measurableCount}명 기준${stats.excludedOverride > 0 ? ` · 강제 퇴실·종결 ${stats.excludedOverride}건 제외` : ''}`}
          </p>
        </div>
        <div className="bg-indigo-50 rounded-xl p-4">
          <p className="text-xs text-indigo-500 font-medium"><T k="평균 Aldrete" /></p>
          <p className="text-3xl font-bold text-indigo-700 mt-1">
            {statsError ? <span className="text-xl text-red-500"><T k="조회 실패" /></span> : !stats ? <span className="text-xl text-gray-400">…</span>
              : stats.avgAldrete == null ? <span className="text-xl">산출 불가</span>
              : <>{stats.avgAldrete}<span className="text-base font-normal text-indigo-400">{denom(settings?.scales.aldrete.max)}</span></>}
          </p>
          <p className="text-[10px] text-indigo-600/70 mt-0.5">
            {!stats ? ' '
              : stats.avgAldrete == null ? tA('평가된 퇴실 기록 없음')
              : `누적 퇴실 ${stats.measurableCount}명 기준${stats.excludedOverride > 0 ? ` · 강제 퇴실·종결 ${stats.excludedOverride}건 제외` : ''}`}
          </p>
        </div>
      </div>

      {!statsError && stats?.quality && <PacuQualityStrip quality={stats.quality} delayReasonCounts={stats.delayReasonCounts} />}

      {/* 🔴 지금 사람이 손을 대야 할 것 — 종전에는 화면 어디에도 "다음 측정"이 없었다 */}
      {stats && (stats.vitalsOverdueCount > 0 || stats.noVitalsYetCount > 0 || stats.prolongedStayCount > 0 || stats.hypothermiaCount > 0) && (
        <div className="rounded-2xl border border-red-100 bg-red-50/70 p-4">
          <p className="text-sm font-bold text-red-800 mb-1"><T k="회복실 확인 필요" /></p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-red-700">
            {stats.vitalsOverdueCount > 0 && <span><T k="활력 재측정 지연" /> <b>{stats.vitalsOverdueCount}</b><Unit>명</Unit></span>}
            {stats.noVitalsYetCount > 0 && <span><T k="입실 후 활력 미측정" /> <b>{stats.noVitalsYetCount}</b><Unit>명</Unit></span>}
            {stats.prolongedStayCount > 0 && <span><T k="재실 시간 초과" /> <b>{stats.prolongedStayCount}</b><Unit>명</Unit></span>}
            {stats.hypothermiaCount > 0 && <span><T k="저체온" /> <b>{stats.hypothermiaCount}</b><Unit>명</Unit></span>}
            {stats.tempUnknownCount > 0 && <span className="text-red-500/80"><T k="체온 미측정" /> {stats.tempUnknownCount}<Unit>명</Unit>(<T k="판정 불가" />)</span>}
          </div>
        </div>
      )}

      {/* 수술 완료 → PACU 입실 대기 */}
      {pendingError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" data-pacu-pending-error><T k="입실 대기 목록을 불러오지 못했습니다 — 대기 환자가 없는 것이 아닙니다." /></p>
      )}
      {pending.length > 0 && (
        <div className="bg-amber-50/70 rounded-2xl border border-amber-100 p-4">
          <p className="text-sm font-bold text-amber-800 mb-2">🛏️ <T k="입실 대기 (수술 완료)" /> · {pending.length}<Unit>건</Unit></p>
          <div className="flex flex-wrap gap-2">
            {pending.map(s => (
              <div key={s.id} className={`flex items-center gap-2 bg-white rounded-xl border px-3 py-2 ${admitTarget?.id === s.id ? 'border-amber-400' : 'border-amber-100'}`}>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{s.patient?.familyName}{s.patient?.givenName} <span className="text-gray-400">{s.patient?.mrn}</span></p>
                  <p className="text-[10px] text-gray-400 truncate">{s.procedureName}{s.anesthesiaType ? ` · ${s.anesthesiaType}` : ''} · <T k="종료@시각" /> {hhmm(s.endedAt)}</p>
                </div>
                <button onClick={() => setAdmitTarget(admitTarget?.id === s.id ? null : s)}
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700">
                  <T k={admitTarget?.id === s.id ? '닫기' : '입실'} />
                </button>
              </div>
            ))}
          </div>

          {admitTarget && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-white p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-700">
                <T k="입실 처리" /> — {admitTarget.patient?.familyName}{admitTarget.patient?.givenName} · {admitTarget.procedureName}
              </p>
              <input value={admitOxygen} onChange={e => setAdmitOxygen(e.target.value)}
                placeholder={tA('산소요법 (예: O2 3L/min nasal · room air)')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs" />
              {/* 🔴 수술실→회복실 인계는 EP·컬럼이 있는데 입력 화면이 없었다(운영 기록은 시드뿐) */}
              <details className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2" open>
                <summary className="text-[11px] font-medium text-gray-600 cursor-pointer"><T k="수술실 → 회복실 인수인계 (SBAR)" /></summary>
                <div className="grid grid-cols-1 gap-1.5 mt-2">
                  {HANDOFF_FIELDS.map(([k, ph]) => (
                    <input key={k} value={arrivalHandoff[k]} onChange={e => setArrivalHandoff(h => ({ ...h, [k]: e.target.value }))}
                      placeholder={tA(ph)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-[11px]" />
                  ))}
                </div>
              </details>
              {!asHandoff(arrivalHandoff) && (
                <p className="text-[11px] text-amber-700">인계 내용을 적지 않으면 <b>인계 기록 없음</b>으로 남습니다(입실은 가능합니다).</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  disabled={admitMut.isPending || !user?.id}
                  onClick={() => admitMut.mutate({
                    patientId: admitTarget.patientId,
                    surgeryId: admitTarget.id,
                    nurseId: user?.id,
                    oxygenTherapy: admitOxygen.trim() || undefined,
                    arrivalHandoff: asHandoff(arrivalHandoff),
                  })}
                  className="min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                  <T k={admitMut.isPending ? '처리 중...' : '입실 확정'} />
                </button>
                {!user?.id && <span className="text-[11px] text-red-600"><T k="로그인 정보를 확인할 수 없어 담당 간호사를 지정할 수 없습니다" /></span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Layout: Left=Patient List, Right=Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* Patient List */}
        <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="h-4 bg-gray-100 rounded animate-pulse mb-2" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3" />
              </div>
            ))
          ) : activePatients.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-400"><T k="현재 재실 환자가 없습니다" /></p>
            </div>
          ) : activePatients.map(p => {
            const m = p.monitoring;
            return (
              <div key={p.id} onClick={() => setSelectedId(p.id)}
                className={`bg-white rounded-2xl border shadow-sm p-4 cursor-pointer transition-colors ${
                  selectedId === p.id ? 'border-indigo-300 bg-indigo-50/30' : 'border-gray-100 hover:bg-gray-50/50'
                }`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-gray-900">{`${p.patient?.familyName || ''}${p.patient?.givenName || ''}`}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${scoreTone(p.aldretScore, aldreteMin)}`}>
                    Aldrete {p.aldretScore ?? tA('미평가')}{p.aldretScore == null ? '' : denom(settings?.scales.aldrete.max)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-1">{(p.notes || tA('수술 후 회복'))}</p>
                <div className="flex items-center gap-3 text-[10px] text-gray-400">
                  <span><T k="도착" />: {hhmm(p.arrivalTime)}</span>
                  {m && (
                    <span className={`font-mono font-bold ${m.prolongedStay ? 'text-red-600' : 'text-gray-600'}`}>
                      <Duration minutes={m.stayMinutes} /> 경과{m.prolongedStay ? ' · 재실 초과' : ''}
                    </span>
                  )}
                  {p.painScore != null && <span><T k="통증" />: {p.painScore}/10</span>}
                </div>
                {/* 🔴 활력 재측정 관제 — q{주기} 가 표준인데 화면에 "다음 측정"이 아예 없었다 */}
                {m && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                    {m.noVitalsYet ? (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold whitespace-nowrap"><T k="입실 후 활력 미측정" /></span>
                    ) : m.vitalsOverdue ? (
                      <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold whitespace-nowrap">활력 <Duration minutes={m.vitalsOverdueMin} /> 지연</span>
                    ) : m.nextVitalsDueAt ? (
                      <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap"><T k="다음 측정" /> {hhmm(m.nextVitalsDueAt)}</span>
                    ) : null}
                    {m.hypothermia === true && (
                      <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold whitespace-nowrap">
                        <T k={m.hypothermiaSeverity === 'SEVERE' ? '저체온' : '경도 저체온'} /> {vitalText('temperature', m.lastTemp)}℃
                      </span>
                    )}
                    {m.hypothermia === null && (
                      <span className="px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 whitespace-nowrap"><T k="체온 미측정" /></span>
                    )}
                    {!m.arrivalHandoffRecorded && (
                      <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap"><T k="입실 인계 미기록" /></span>
                    )}
                    {/* 2026-10-07 자리·퇴실 지연 사유·마취과 확인 */}
                    {p.bayCode && <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 whitespace-nowrap" data-pacu-card-bay={p.bayCode}>{p.bayCode}</span>}
                    {p.delayReason && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap" data-pacu-card-delay={p.delayReason}><T k="지연" />: <T k={PACU_DELAY_REASON_LABEL[p.delayReason as keyof typeof PACU_DELAY_REASON_LABEL] ?? p.delayReason} /></span>}
                    {p.anesthesiaSignOffAt && <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 whitespace-nowrap"><T k="마취과 확인" /></span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="space-y-4">
          {!selected ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center py-16">
              <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <p className="text-sm text-gray-400"><T k="환자를 선택하세요" /></p>
            </div>
          ) : (
            <>
              {/* 2026-10-07 회복실 상세화 — 자리·지연·마취과 확인 · 마취 인계 · 점수 이력 · 활력 추이 */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3" data-pacu-detail-extra>
                <PacuOpsBar key={selected.id} record={selected as unknown as PacuDetailRecord} />
                <AnesthesiaHandoffCard recordId={selected.id} />
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900"><T k="점수 이력" /></h3>
                    <label className="text-[11px] text-gray-500"><T k="이번 평가 시점" />{' '}
                      <select value={scorePhase} onChange={e => setScorePhase(e.target.value as 'INTERVAL' | 'DISCHARGE')} className="rounded border px-1 py-0.5 text-[11px]" data-pacu-score-phase>
                        <option value="INTERVAL">{tA('중간')}</option><option value="DISCHARGE">{tA('퇴실 전')}</option>
                      </select>
                    </label>
                  </div>
                  <ScoreHistory history={selected.scoreHistory} />
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-bold text-gray-900"><T k="활력 추이" /></h3>
                  {vitalsError ? null : <VitalsTrend vitals={vitals} spo2Low={settings?.alertThresholds?.spo2Low ?? null} />}
                </div>
              </div>

              {/* Vital Sign Form */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-900"><T k="활력징후 기록@행위" /></h3>
                  {mon && (
                    <span className={`text-[11px] font-semibold ${mon.noVitalsYet || mon.vitalsOverdue ? 'text-red-600' : 'text-gray-400'}`}>
                      {mon.noVitalsYet ? '입실 후 첫 활력 미측정'
                        : mon.vitalsOverdue ? `재측정 ${fmtDur(mon.vitalsOverdueMin)} 지연 (마지막 ${mon.lastVitalsAt ? hhmm(mon.lastVitalsAt) : '-'})`
                        : `마지막 ${mon.lastVitalsAt ? hhmm(mon.lastVitalsAt) : '-'} · 다음 ${mon.nextVitalsDueAt ? hhmm(mon.nextVitalsDueAt) : '-'}`}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium"><T k="수축기 BP" /></label>
                    <input value={vitalForm.systolicBp} onChange={e => setVitalForm(f => ({ ...f, systolicBp: e.target.value }))}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="mmHg" type="number" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium"><T k="이완기 BP" /></label>
                    <input value={vitalForm.diastolicBp} onChange={e => setVitalForm(f => ({ ...f, diastolicBp: e.target.value }))}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="mmHg" type="number" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium"><T k="심박수 (HR)" /></label>
                    <input value={vitalForm.heartRate} onChange={e => setVitalForm(f => ({ ...f, heartRate: e.target.value }))}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="bpm" type="number" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium"><T k="호흡수 (RR)" /></label>
                    <input value={vitalForm.respiratoryRate} onChange={e => setVitalForm(f => ({ ...f, respiratoryRate: e.target.value }))}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="/min" type="number" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium">SpO2</label>
                    <input value={vitalForm.spo2} onChange={e => setVitalForm(f => ({ ...f, spo2: e.target.value }))}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="%" type="number" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium"><T k="체온 (BT)" /></label>
                    <input value={vitalForm.temperature} onChange={e => setVitalForm(f => ({ ...f, temperature: e.target.value }))}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="°C" type="number" step="0.1" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-gray-400 font-medium"><T k="의식수준" /></label>
                    <select value={vitalForm.consciousnessLevel} onChange={e => setVitalForm(f => ({ ...f, consciousnessLevel: e.target.value }))}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                      <option value="">{tA('선택 안 함')}</option>
                      {CONSCIOUSNESS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-gray-400 font-medium"><T k="진정(RASS)" /></label>
                    <select value={vitalForm.rass} onChange={e => setVitalForm(f => ({ ...f, rass: e.target.value }))} data-pacu-rass
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                      <option value="">{tA('미평가')}</option>
                      {RASS_OPTIONS.map(o => <option key={o} value={String(o)}>{tA(RASS_LABEL[o])}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={handleRecordVital} disabled={recordVitalMut.isPending}
                  className="w-full min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  <T k={recordVitalMut.isPending ? '기록 중...' : '기록@버튼'} />
                </button>
              </div>

              {/* Vitals Timeline */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="활력징후 타임라인" /></h3>
                {vitalsError ? (
                  // 🔴 조회 실패는 "기록 없음"이 아니다
                  <p className="text-xs text-red-600" data-pacu-vitals-error><T k="활력징후를 불러오지 못했습니다 — 기록이 없는 것이 아닙니다." /></p>
                ) : vitals.length === 0 ? (
                  <EmptyState icon="📝" title="기록이 없습니다" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/50">
                          <th className="px-3 py-2 text-left font-medium text-gray-500"><T k="시간" /></th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500">BP</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500">HR</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500">RR</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500">SpO2</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500">BT</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500"><T k="의식" /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {vitals.map((v, i) => (
                          <tr key={i} className={`border-b border-gray-50 ${v.abnormal ? 'bg-red-50/60' : ''}`}>
                            <td className="px-3 py-2 font-mono text-gray-600 whitespace-nowrap">
                              {v.abnormal && <span className="text-red-500 mr-1" title={(v.flags ?? []).join(', ')}>⚠️</span>}
                              {v.time ? hhmm(v.time) : '-'}
                            </td>
                            <td className="px-3 py-2 text-center font-mono">{v.bp ?? '-'}</td>
                            <td className="px-3 py-2 text-center font-mono">{v.hr ?? '-'}</td>
                            <td className="px-3 py-2 text-center font-mono">{v.rr ?? '-'}</td>
                            <td className="px-3 py-2 text-center font-mono">{v.spo2 != null ? `${v.spo2}%` : '-'}</td>
                            <td className={`px-3 py-2 text-center font-mono ${
                              v.temp != null && settings && v.temp < settings.hypothermiaWarnC ? 'text-sky-700 font-bold' : ''
                            }`}>{v.temp ?? '-'}</td>
                            <td className="px-3 py-2 text-gray-600">{v.consciousness ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!!vitals.length && vitals[0]?.flags?.length ? (
                  <p className="mt-2 text-[11px] text-red-600"><T k="최근 측정 소견" />: {vitals[0].flags?.join(', ')}</p>
                ) : null}
              </div>

              {/* 중재(처치) 기록 — 저체온 가온·산소 등 "무엇을 했나" */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-900"><T k="중재 기록" /> <T k="(산소·가온·약물)" className="text-[11px] font-normal text-gray-400" /></h3>
                  <span className="text-[11px] text-gray-400">{selected.interventions?.length ?? 0}<Unit>건</Unit></span>
                </div>
                {mon?.hypothermia === true && (
                  <div className="mb-2 rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-[11px] text-sky-800">
                    체온 {vitalText('temperature', mon.lastTemp)}℃ — {settings ? `${settings.hypothermiaWarnC}℃` : '정상 하한'} 미만입니다. 가온 중재를 기록해 주세요.
                  </div>
                )}
                {!!selected.interventions?.length && (
                  <div className="space-y-1 mb-2 max-h-24 overflow-y-auto">
                    {selected.interventions.slice().reverse().map((raw, i) => {
                      const iv = readIntervention(raw);
                      return (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold whitespace-nowrap">{iv.label}</span>
                          {iv.detail && <span className="text-gray-700 truncate">{iv.detail}</span>}
                          {iv.time && <span className="text-gray-400 whitespace-nowrap ml-auto">{Number.isFinite(Date.parse(iv.time)) ? hhmm(iv.time) : iv.time}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                  <select value={ivType} onChange={e => setIvType(e.target.value)} className="px-2 py-2 border border-gray-200 rounded-lg text-xs bg-white">
                    <option value="">{tA('중재 선택')}</option>
                    {INTERVENTION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input value={ivDetail} onChange={e => setIvDetail(e.target.value)}
                    placeholder={tA('내용(예: 가온담요 적용)')} className="px-3 py-2 border border-gray-200 rounded-lg text-xs" />
                </div>
                <button onClick={() => addInterventionMut.mutate({ type: ivType, detail: ivDetail.trim() || undefined })}
                  disabled={addInterventionMut.isPending || !ivType}
                  className="w-full min-h-[44px] px-3 py-2 text-xs font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50">
                  <T k={addInterventionMut.isPending ? '기록 중...' : '중재 기록'} />
                </button>
              </div>

              {/* 간호 기록 */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <NursingNotePanel
                  patientId={selected.patientId}
                  contextType="PACU"
                  contextId={selected.id}
                  patientName={`${selected.patient?.familyName || ''}${selected.patient?.givenName || ''}`}
                  compact
                />
              </div>

              {/* Aldrete Score Card */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-900">
                    Aldrete Score
                    <span className="ml-2 text-[11px] font-normal text-gray-400">
                      <T k="저장됨" /> {selected.aldretScore ?? tA('미평가')}{selected.aldretScore == null ? '' : denom(settings?.scales.aldrete.max)}
                    </span>
                  </h3>
                  <span className={`text-sm font-bold px-3 py-1 rounded-full whitespace-nowrap ${scoreTone(aldreteTotal, aldreteMin)}`}>
                    {aldreteTotal == null
                      ? `미선택 ${aldreteAnswered}/${ALDRETE_ITEMS.length}항목`
                      : `${aldreteTotal}${denom(settings?.scales.aldrete.max)}${aldreteMin != null ? (aldreteZeroSel.length ? ' (0점 항목 — 기준 미달)' : aldreteTotal >= aldreteMin ? ' (퇴실가능)' : ` (기준 ${aldreteMin}점 미달)`) : ''}`}
                  </span>
                </div>
                {/* 기준값 출처 — 원내 기준이 정해지기 전에는 기본값임을 말한다 · 조회 실패면 판정은 서버가 한다 */}
                <p className="mb-2 text-[11px] text-gray-500" data-pacu-criteria>
                  {settingsError ? <T k="퇴실 기준을 불러오지 못했습니다 — 퇴실 판정은 서버가 합니다." />
                    : settings?.criteriaSource === 'CONFIG' ? <Tf k="퇴실 기준 {n}점 이상 · 0점 항목 없음(원내 설정)" params={{ n: aldreteMin ?? '—' }} />
                    : <Tf k="퇴실 기준 {n}점 이상 · 0점 항목 없음 — 원내 기준 미설정(기본값)" params={{ n: aldreteMin ?? '—' }} />}
                  {selected.aldreteAssessedAt ? <> · <T k="마지막 평가" /> {kdate(selected.aldreteAssessedAt, 'time')}</> : null}
                </p>
                <div className="space-y-3">
                  {ALDRETE_ITEMS.map(item => (
                    <div key={item.key}>
                      <p className="text-xs font-medium text-gray-700 mb-1">{item.label}</p>
                      <div className="flex gap-1">
                        {item.options.map(opt => (
                          <button key={opt.value} onClick={() => setAldreteScores(s => ({ ...s, [item.key]: opt.value }))}
                            className={`flex-1 px-2 py-1.5 text-[10px] rounded-lg border transition-colors ${
                              aldreteScores[item.key] === opt.value
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                            }`}>
                            {opt.value}점 - {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => aldreteTotal != null && saveAldreteMut.mutate({ score: aldreteTotal, detail: aldreteScores as Record<string, number> })}
                  disabled={saveAldreteMut.isPending || !aldreteComplete}
                  className="w-full mt-4 min-h-[44px] px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {saveAldreteMut.isPending ? <T k="저장 중..." /> : aldreteComplete ? <T k="Aldrete 점수 저장" /> : `평가하지 않은 항목 ${ALDRETE_ITEMS.length - aldreteAnswered}개`}
                </button>
              </div>

              {/* PONV(수술후 오심·구토) */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-900"><T k="PONV (수술후 오심·구토)" /></h3>
                  <span className="text-[11px] text-gray-400">
                    <T k="저장됨" />: {typeof selected.ponvScore === 'number' ? (PONV_OPTIONS[selected.ponvScore]?.label ?? selected.ponvScore) : tA('미평가')}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {PONV_OPTIONS.map(o => (
                    <button key={o.value} onClick={() => setPonvScore(o.value)}
                      className={`py-1.5 text-[11px] rounded-lg border ${ponvScore === o.value ? (o.value >= 2 ? 'bg-red-600 text-white border-red-600' : 'bg-indigo-600 text-white border-indigo-600') : 'bg-white text-gray-600 border-gray-200'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
                {ponvScore != null && ponvScore >= 1 && (
                  <input value={ponvManagement} onChange={e => setPonvManagement(e.target.value)}
                    placeholder={tA('중재(약물·조치)')} className="w-full mb-2 px-3 py-2 border border-gray-200 rounded-lg text-xs" />
                )}
                <button onClick={() => ponvScore != null && savePonvMut.mutate({ score: ponvScore, management: ponvManagement.trim() || undefined })}
                  disabled={savePonvMut.isPending || ponvScore == null}
                  className="w-full min-h-[44px] px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  <T k={savePonvMut.isPending ? '저장 중...' : ponvScore == null ? '평가를 선택하세요' : 'PONV 저장'} />
                </button>
              </div>

              {/* PADSS 귀가 척도(HOME 퇴실 기준) */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-900">
                    <T k="PADSS 귀가 척도" />
                    <span className="ml-1 text-[11px] font-normal text-gray-400">
                      (귀가 시 필수{padssMin != null ? ` · ≥${padssMin}` : ''}) · 저장됨 {selected.padssScore ?? '미평가'}
                    </span>
                  </h3>
                  <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap ${scoreTone(padssTotal, padssMin)}`}>
                    {padssTotal == null ? `미선택 ${padssAnswered}/${PADSS_ITEMS.length}항목` : `${padssTotal}${denom(settings?.scales.padss.max)}`}
                  </span>
                </div>
                <div className="space-y-2">
                  {PADSS_ITEMS.map(item => (
                    <div key={item.key}>
                      <p className="text-[11px] text-gray-500 mb-0.5">{item.label}</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {item.options.map(opt => (
                          <button key={opt.value} onClick={() => setPadssScores(s => ({ ...s, [item.key]: opt.value }))}
                            className={`py-1.5 text-[10px] rounded-lg border ${padssScores[item.key] === opt.value ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => padssTotal != null && savePadssMut.mutate({ score: padssTotal, detail: padssScores as Record<string, number> })}
                  disabled={savePadssMut.isPending || !padssComplete}
                  className="w-full mt-3 min-h-[44px] px-3 py-2 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {savePadssMut.isPending ? <T k="저장 중..." /> : padssComplete ? <T k="PADSS 저장" /> : `평가하지 않은 항목 ${PADSS_ITEMS.length - padssAnswered}개`}
                </button>
              </div>

              {/* 통증 재평가(추이) */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-900"><T k="통증 재평가 (NRS 0~10)" /></h3>
                  <span className="text-[11px] text-gray-400"><T k="기록@명사" /> {selected.painAssessments?.length ?? 0}<Unit>회</Unit></span>
                </div>
                <div className="grid grid-cols-11 gap-1 mb-2">
                  {Array.from({ length: 11 }, (_, n) => (
                    <button key={n} onClick={() => setPainScore(n)}
                      className={`py-1.5 text-[11px] rounded border ${painScore === n ? (n >= 7 ? 'bg-red-600 text-white border-red-600' : n >= 4 ? 'bg-amber-500 text-white border-amber-500' : 'bg-green-600 text-white border-green-600') : 'bg-white text-gray-500 border-gray-200'}`}>
                      {n}
                    </button>
                  ))}
                </div>
                {painScore != null && painScore >= 4 && (
                  <input value={painIntervention} onChange={e => setPainIntervention(e.target.value)}
                    placeholder={tA('중재(진통제 등)')} className="w-full mb-2 px-3 py-2 border border-gray-200 rounded-lg text-xs" />
                )}
                {!!selected.painAssessments?.length && (
                  <div className="flex items-end gap-1 h-10 mb-2">
                    {selected.painAssessments.slice(-12).map((p, i) => (
                      <div key={i} title={`${p.score} · ${hhmm(p.time)}`}
                        className={`flex-1 rounded-t ${p.score >= 7 ? 'bg-red-400' : p.score >= 4 ? 'bg-amber-400' : 'bg-green-400'}`}
                        style={{ height: `${Math.max(8, p.score * 10)}%` }} />
                    ))}
                  </div>
                )}
                <button onClick={() => painScore != null && addPainMut.mutate({ score: painScore, intervention: painIntervention.trim() || undefined })}
                  disabled={addPainMut.isPending || painScore == null}
                  className="w-full min-h-[44px] px-3 py-2 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50">
                  <T k={addPainMut.isPending ? '기록 중...' : painScore == null ? '통증 점수를 선택하세요' : '통증 재평가 기록'} />
                </button>
              </div>

              {/* 구조화 합병증 */}
              {/* 2026-10-07 회복실 섭취·배설 · 간호기록 */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 grid gap-4 md:grid-cols-2">
                <div><h3 className="mb-2 text-sm font-bold text-gray-900"><T k="섭취·배설(회복실)" /></h3><PacuIoPanel record={selected as unknown as PacuDetailRecord} /></div>
                <div><h3 className="mb-2 text-sm font-bold text-gray-900"><T k="회복실 간호기록" /></h3><PacuNotesPanel record={selected as unknown as PacuDetailRecord} /></div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-900"><T k="합병증 기록" /></h3>
                  <span className="text-[11px] text-gray-400">{selected.complications?.length ?? 0}<Unit>건</Unit></span>
                </div>
                {!!selected.complications?.length && (
                  <div className="space-y-1 mb-2 max-h-24 overflow-y-auto">
                    {selected.complications.slice().reverse().map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className={`px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap ${c.severity === 'SEVERE' ? 'bg-red-100 text-red-700' : c.severity === 'MODERATE' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{SEVERITY_OPTIONS.find(s => s.value === c.severity)?.label ?? c.severity}</span>
                        <span className="text-gray-800">{COMPLICATION_LABEL[c.type] ?? c.type}</span>
                        {c.intervention && <span className="text-gray-400 truncate">· {c.intervention}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                  <select value={compType} onChange={e => setCompType(e.target.value)} className="px-2 py-2 border border-gray-200 rounded-lg text-xs bg-white">
                    <option value="">{tA('합병증 선택')}</option>
                    {COMPLICATION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <select value={compSeverity} onChange={e => setCompSeverity(e.target.value)} className="px-2 py-2 border border-gray-200 rounded-lg text-xs bg-white">
                    <option value="">{tA('중증도 선택')}</option>
                    {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <input value={compIntervention} onChange={e => setCompIntervention(e.target.value)}
                  placeholder={tA('중재(처치·약물)')} className="w-full mb-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs" />
                <button onClick={() => addComplicationMut.mutate({ type: compType, severity: compSeverity, intervention: compIntervention.trim() || undefined })}
                  disabled={addComplicationMut.isPending || !compType || !compSeverity}
                  className="w-full min-h-[44px] px-3 py-2 text-xs font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                  <T k={addComplicationMut.isPending ? '기록 중...' : '합병증 기록'} />
                </button>
              </div>

              {/* Discharge — 이원화 게이트(HOME: PADSS / WARD·ICU: Aldrete) + SBAR 핸드오프 */}
              {(() => {
                const isHome = disposition === 'HOME';
                const savedScore = isHome ? selected.padssScore : selected.aldretScore;
                const threshold = isHome ? padssMin : aldreteMin;
                const scaleName = isHome ? 'PADSS' : 'Aldrete';
                const notAssessed = savedScore == null;
                // 🔴 미평가는 "0점"이 아니다. 게이트는 종전과 같이 막되(안전측) 화면은 사실대로 말한다.
                // 0점 항목이 있으면 총점과 관계없이 미달(서버 게이트와 같은 규칙 · WARD/ICU 만)
                const zeroItems = !isHome ? (selected.monitoring?.aldreteZeroItems ?? []) : [];
                const belowThreshold = notAssessed || (threshold != null && savedScore < threshold) || zeroItems.length > 0;
                const handoffEmpty = !asHandoff(dischargeHandoff);
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-gray-900"><T k="퇴실 처리" /></h3>
                      {!showDischarge && (
                        <button onClick={() => setShowDischarge(true)}
                          className="px-4 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                          <T k="퇴실@병동" />
                        </button>
                      )}
                    </div>
                    {showDischarge && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <select value={disposition} onChange={e => setDisposition(e.target.value)} data-pacu-disposition
                            className="px-3 py-2 border border-gray-200 rounded-lg text-xs bg-white">
                            <option value="">{tA('퇴실 구분 선택')}</option>
                            {DISPOSITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <DestinationPicker disposition={disposition} value={destination} onChange={setDestination} q={destQ} role={user?.role} />
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] text-gray-500">
                            기준: <b>{scaleName}{threshold != null ? ` ≥ ${threshold}` : ''}</b> · 현재 {notAssessed ? <b className="text-red-600">미평가</b> : <>{savedScore}<Unit>점</Unit></>}
                          </span>
                        </div>
                        {belowThreshold && (
                          <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-[11px] text-red-700">
                            ⚠️ {notAssessed
                              ? <>{scaleName} <b>평가 기록이 없습니다</b> — 평가 없이 {isHome ? '귀가' : '퇴실'}시키려면</>
                              : <>{scaleName} <b>{savedScore}<Unit>점</Unit></b> — {isHome ? '귀가' : '퇴실'} 기준{threshold != null ? `(${threshold}점)` : ''} 미달. 강제 퇴실 시</>}
                            {' '}<b>사유(마취과 판단)</b>가 필요하며 감사 기록됩니다. 기준 미달 강제 퇴실은 <b>의사만</b> 승인할 수 있습니다.
                          </div>
                        )}
                        {belowThreshold && (
                          <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                            placeholder={`강제 퇴실 사유 (예: 마취과 OO 판단 하 ${isHome ? '귀가' : '병동 이송'})`}
                            className="w-full px-3 py-2 border border-red-200 rounded-lg text-xs" />
                        )}
                        {/* SBAR 인수인계 */}
                        <details className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2" open={handoffEmpty}>
                          <summary className="text-[11px] font-medium text-gray-600 cursor-pointer"><T k="인수인계 (SBAR)" /></summary>
                          <div className="grid grid-cols-1 gap-1.5 mt-2">
                            {HANDOFF_FIELDS.map(([k, ph]) => (
                              <input key={k} value={dischargeHandoff[k]} onChange={e => setDischargeHandoff(h => ({ ...h, [k]: e.target.value }))}
                                placeholder={tA(ph)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-[11px]" />
                            ))}
                          </div>
                        </details>
                        {/* 🔴 인계 없이 퇴실하는 것을 막지는 않는다(막으면 환자가 회복실에 남는다) — 사실대로 말하고 기록한다 */}
                        {handoffEmpty && (
                          <p className="text-[11px] text-amber-700">
                            인수인계 내용이 비어 있습니다. 이대로 퇴실하면 <b>인계 기록 없음</b>으로 남습니다
                            {isHome ? ' (귀가 시 보호자 교육 내용을 적어 두면 이후 문의에 답할 수 있습니다).' : ' (받는 병동이 확인할 기록이 없습니다).'}
                          </p>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => dischargeMut.mutate({
                              disposition,
                              overrideReason: belowThreshold ? overrideReason.trim() : undefined,
                              dischargeHandoff: asHandoff(dischargeHandoff),
                              ...(destination.mode === 'MOVE' ? { targetBedId: destination.targetBedId } : {}),
                              ...(destination.mode === 'ICU_NEW' ? { icuBedId: destination.icuBedId, icuAdmitReason: destination.icuAdmitReason?.trim() } : {}),
                            })}
                            disabled={dischargeMut.isPending || !disposition || !destinationReady(disposition, destination, destQ.data) || (belowThreshold && !overrideReason.trim())}
                            className="min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                            <T k={dischargeMut.isPending ? '처리 중...' : belowThreshold ? '강제 퇴실' : '퇴실 확인'} />
                          </button>
                          <button onClick={() => { setShowDischarge(false); setOverrideReason(''); }}
                            className="px-3 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="취소" /></button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
