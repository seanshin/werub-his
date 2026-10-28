'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import SmartSignButton from '@/components/signature/SmartSignButton';
import PatientSelector from '@/components/ui/PatientSelector';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { EmptyState, Unit } from '@/components/ui/display';

/* ─── Types ─── */
interface PathologySpecimen {
  id: string;
  accessionNumber: string;
  status: string;
  specimenType: string;
  collectionSite: string;
  priority: string;
  fixative?: string;
  clinicalInfo?: string;
  collectedAt?: string;
  receivedAt: string;
  patient?: { id: string; familyName: string; givenName: string; mrn: string };
  grossDescription?: string;
  microDescription?: string;
  diagnosis?: string;
  diagnosisCode?: string;
  tnmStage?: string;
  pathologist?: { familyName: string; givenName: string };
  reportedAt?: string;
  signedAt?: string;
  report?: PathologyReport | null;
}

interface PathologyReport {
  id: string;
  specimenId: string;
  grossDescription?: string;
  microDescription?: string;
  diagnosis?: string;
  diagnosisCode?: string;
  ihcResults?: { marker: string; result: string }[];
  molecularResults?: { test: string; result: string }[];
  tnmT?: string;
  tnmN?: string;
  tnmM?: string;
  tnmStage?: string;
  tumorGrade?: string;
  marginStatus?: string;
  addendum?: string;
  signedAt?: string;
  signedBy?: string;
}

interface PathologyStats {
  totalReceived: number;
  totalReported: number;
  averageTAT: number;
  urgentCount: number;
  pendingCount?: number;
}

interface PathologyPatient {
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
  specimenCount: number;
  lastSpecimenDate?: string;
}

interface SmartListPatient {
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
}

interface SmartListData {
  myPatients: SmartListPatient[];
  recentPatients: SmartListPatient[];
  admittedPatients: SmartListPatient[];
  emergencyPatients: SmartListPatient[];
  searchResults: SmartListPatient[];
}

/* ─── Constants ─── */
type MainTab = 'specimens' | 'reports' | 'stats' | 'patients';

const MAIN_TABS: { key: MainTab; label: string; icon: string }[] = [
  { key: 'specimens', label: '검체 관리', icon: '🔬' },
  { key: 'reports', label: '판독 보고서', icon: '📋' },
  { key: 'stats', label: '통계', icon: '📊' },
  { key: 'patients', label: '환자 목록', icon: '👤' },
];

type SpecimenFilter = 'ALL' | 'RECEIVED' | 'PROCESSING' | 'REPORTED' | 'SIGNED';

const SPECIMEN_FILTERS: { key: SpecimenFilter; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'RECEIVED', label: '접수 대기' },
  { key: 'PROCESSING', label: '처리 중' },
  { key: 'REPORTED', label: '판독완료' },
  { key: 'SIGNED', label: '서명완료' },
];

const PRIORITY_LABEL: Record<string, string> = { ROUTINE: '일반', URGENT: '긴급', FROZEN: '동결' };
const PRIORITY_COLOR: Record<string, string> = {
  ROUTINE: 'bg-gray-100 text-gray-600',
  URGENT: 'bg-amber-100 text-amber-700',
  FROZEN: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<string, string> = { RECEIVED: '접수', PROCESSING: '처리중', REPORTED: '판독완료', SIGNED: '서명완료', AMENDED: '수정판독' };
const STATUS_COLOR: Record<string, string> = {
  RECEIVED: 'bg-blue-100 text-blue-700',
  PROCESSING: 'bg-amber-100 text-amber-700',
  REPORTED: 'bg-emerald-100 text-emerald-700',
  SIGNED: 'bg-green-100 text-green-700',
  AMENDED: 'bg-violet-100 text-violet-700',
};

// 🔴 단계(4)와 라벨(5)이 어긋나 진행바가 한 칸씩 밀리고 '서명'은 영원히 점등되지 않았다(P3)
const STATUS_STEPS = ['RECEIVED', 'PROCESSING', 'REPORTED', 'SIGNED'];
const STATUS_STEP_LABELS = ['접수@상태', '처리중', '판독', '서명'];

const SPECIMEN_TYPES = [
  { value: 'BIOPSY', label: '조직검사 (Biopsy)' },
  { value: 'EXCISION', label: '절제 (Excision)' },
  { value: 'CYTOLOGY', label: '세포검사 (Cytology)' },
  { value: 'FNA', label: '세침흡인 (FNA)' },
  { value: 'FROZEN', label: '동결절편 (Frozen)' },
];
// 표시용 — 등록 모달에만 쓰이고 목록/상세는 영문 코드 원문이 노출됐다(P4·2026-08-13 W3)
const SPECIMEN_TYPE_LABEL: Record<string, string> = Object.fromEntries(SPECIMEN_TYPES.map((t) => [t.value, t.label]));
const specimenTypeText = (v: string | undefined | null) => (v ? SPECIMEN_TYPE_LABEL[v] ?? v : '-');

const FIXATIVE_OPTIONS = [
  { value: '10% formalin', label: '10% 포르말린' },
  { value: 'alcohol', label: '알코올' },
  { value: 'fresh', label: 'Fresh (비고정)' },
  { value: 'other', label: '기타' },
];

const PRIORITY_OPTIONS = [
  { value: 'ROUTINE', label: '일반' },
  { value: 'URGENT', label: '긴급' },
  { value: 'FROZEN', label: '동결' },
];

const T_OPTIONS = ['Tx', 'Tis', 'T1', 'T1a', 'T1b', 'T2', 'T2a', 'T2b', 'T3', 'T4', 'T4a', 'T4b'];
const N_OPTIONS = ['Nx', 'N0', 'N1', 'N1a', 'N1b', 'N2', 'N2a', 'N2b', 'N3'];
const M_OPTIONS = ['Mx', 'M0', 'M1', 'M1a', 'M1b'];
const GRADE_OPTIONS = ['G1', 'G2', 'G3', 'G4', 'Gx'];
const MARGIN_OPTIONS = [
  { value: 'CLEAR', label: '음성 (Clear)' },
  { value: 'INVOLVED', label: '양성 (Involved)' },
  { value: 'CLOSE', label: '근접 (Close)' },
];

/* ─── Helper Components ─── */
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${colorClass}`}>
      {label}
    </span>
  );
}

function ProgressBar({ status }: { status: string }) {
  const currentIdx = STATUS_STEPS.indexOf(status);
  const progress = currentIdx >= 0 ? currentIdx : -1;

  return (
    <div className="flex items-center gap-1 w-full">
      {/* 단계 라벨은 표시만 t() 를 따른다 — STATUS_STEPS 판정(코드값)은 불변 */}
      {STATUS_STEP_LABELS.map((label, idx) => {
        const isActive = idx <= progress;
        const isCurrent = idx === progress;
        return (
          <div key={label} className="flex items-center gap-1 flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all ${
                isCurrent ? 'border-blue-600 bg-blue-600 text-white' :
                isActive ? 'border-blue-400 bg-blue-100 text-blue-700' :
                'border-gray-200 bg-white text-gray-400'
              }`}>{idx + 1}</div>
              <p className={`text-[10px] mt-0.5 whitespace-nowrap ${isCurrent ? 'text-blue-700 font-bold' : isActive ? 'text-blue-500' : 'text-gray-400'}`}><T k={label} /></p>
            </div>
            {idx < STATUS_STEP_LABELS.length - 1 && (
              <div className={`h-0.5 flex-1 rounded ${idx < progress ? 'bg-blue-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Specimen Registration Modal ─── */
function SpecimenRegModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [patientId, setPatientId] = useState('');
  const [specimenType, setSpecimenType] = useState('BIOPSY');
  const [collectionSite, setCollectionSite] = useState('');
  const [fixative, setFixative] = useState('10% formalin');
  const [priority, setPriority] = useState('ROUTINE');
  const [clinicalInfo, setClinicalInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!patientId) { toast.error('환자를 선택해주세요'); return; }
    if (!collectionSite.trim()) { toast.error('채취부위를 입력해주세요'); return; }
    setSubmitting(true);
    try {
      await apiClient.post('/api/v1/pathology/specimens', {
        patientId,
        specimenType,
        collectionSite: collectionSite.trim(),
        fixative,
        priority,
        clinicalInfo: clinicalInfo.trim() || undefined,
      });
      toast.success('검체 접수 완료');
      onSuccess();
      onClose();
      setPatientId('');
      setCollectionSite('');
      setClinicalInfo('');
      setSpecimenType('BIOPSY');
      setFixative('10% formalin');
      setPriority('ROUTINE');
    } catch {
      toast.error('검체 접수 실패');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">검체 접수</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          {/* Patient Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">환자 검색</label>
            <PatientSelector
              value={patientId}
              onChange={(id) => setPatientId(id)}
              context="lab"
              placeholder="이름 또는 등록번호 검색..."
              autoFocus
            />
          </div>

          {/* Specimen Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">검체유형</label>
            <div className="flex flex-wrap gap-2">
              {SPECIMEN_TYPES.map(t => (
                <label key={t.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-all ${
                  specimenType === t.value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                  <input type="radio" name="specimenType" value={t.value} checked={specimenType === t.value}
                    onChange={() => setSpecimenType(t.value)} className="sr-only" />
                  {t.label}
                </label>
              ))}
            </div>
          </div>

          {/* Collection Site */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">채취부위</label>
            <input type="text" value={collectionSite} onChange={e => setCollectionSite(e.target.value)}
              placeholder="예: 위체부, 대장 상행부, 유방 좌측..." className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Fixative */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">고정액</label>
            <select value={fixative} onChange={e => setFixative(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {FIXATIVE_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">우선순위</label>
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map(p => (
                <label key={p.value} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm cursor-pointer transition-all ${
                  priority === p.value ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                  <input type="radio" name="priority" value={p.value} checked={priority === p.value}
                    onChange={() => setPriority(p.value)} className="sr-only" />
                  {p.label}
                </label>
              ))}
            </div>
          </div>

          {/* Clinical Info */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">임상정보</label>
            <textarea value={clinicalInfo} onChange={e => setClinicalInfo(e.target.value)}
              rows={3} placeholder="환자의 임상 소견, 의심 진단, 과거 병력 등..."
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">취소</button>
          <button onClick={handleSubmit} disabled={submitting || !patientId}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {submitting ? '접수 중...' : '접수'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Addendum Modal ─── */
function AddendumModal({ open, onClose, reportId, onSuccess }: { open: boolean; onClose: () => void; reportId: string; onSuccess: () => void }) {
  const [addendum, setAddendum] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!addendum.trim()) { toast.error('추가 소견을 입력해주세요'); return; }
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/pathology/reports/${reportId}/addendum`, { addendum: addendum.trim() });
      toast.success('추가 소견 등록 완료');
      setAddendum('');
      onSuccess();
      onClose();
    } catch {
      toast.error('추가 소견 등록 실패');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">추가 보고서 (Addendum)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5">
          <textarea value={addendum} onChange={e => setAddendum(e.target.value)}
            rows={5} placeholder="추가 소견을 입력하세요..."
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">취소</button>
          <button onClick={handleSubmit} disabled={submitting}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50 transition-colors">
            {submitting ? '등록 중...' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Report Form ─── */
function ReportForm({ specimen, onDone }: { specimen: PathologySpecimen; onDone: () => void }) {
  const qc = useQueryClient();
  const [grossDescription, setGrossDescription] = useState('');
  const [microDescription, setMicroDescription] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [diagnosisCode, setDiagnosisCode] = useState('');
  const [ihcRows, setIhcRows] = useState<{ marker: string; result: string }[]>([]);
  const [molecularRows, setMolecularRows] = useState<{ test: string; result: string }[]>([]);
  const [tnmT, setTnmT] = useState('');
  const [tnmN, setTnmN] = useState('');
  const [tnmM, setTnmM] = useState('');
  const [tnmStage, setTnmStage] = useState('');
  const [tumorGrade, setTumorGrade] = useState('');
  const [marginStatus, setMarginStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [existingReportId, setExistingReportId] = useState<string | null>(null);
  const [addendumOpen, setAddendumOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load existing report
  const { data: reportData } = useQuery({
    queryKey: ['pathology-report', specimen.id],
    queryFn: () => apiClient.get<{ data: PathologyReport | null }>(`/api/v1/pathology/reports/${specimen.id}`),
    retry: false,
  });

  // Populate form from existing report
  useMemo(() => {
    if (loaded) return;
    const r = reportData?.data as unknown as PathologyReport | null;
    if (r && r.id) {
      setExistingReportId(r.id);
      setGrossDescription(r.grossDescription ?? '');
      setMicroDescription(r.microDescription ?? '');
      setDiagnosis(r.diagnosis ?? '');
      setDiagnosisCode(r.diagnosisCode ?? '');
      setIhcRows(r.ihcResults ?? []);
      setMolecularRows(r.molecularResults ?? []);
      setTnmT(r.tnmT ?? '');
      setTnmN(r.tnmN ?? '');
      setTnmM(r.tnmM ?? '');
      setTnmStage(r.tnmStage ?? '');
      setTumorGrade(r.tumorGrade ?? '');
      setMarginStatus(r.marginStatus ?? '');
      setLoaded(true);
    }
  }, [reportData, loaded]);

  const handleSave = async () => {
    if (!diagnosis.trim()) { toast.error('최종 진단을 입력해주세요'); return; }
    setSaving(true);
    try {
      const payload = {
        specimenId: specimen.id,
        grossDescription: grossDescription.trim() || undefined,
        microDescription: microDescription.trim() || undefined,
        diagnosis: diagnosis.trim(),
        diagnosisCode: diagnosisCode.trim() || undefined,
        ihcResults: ihcRows.length > 0 ? ihcRows : undefined,
        molecularResults: molecularRows.length > 0 ? molecularRows : undefined,
        tnmT: tnmT || undefined,
        tnmN: tnmN || undefined,
        tnmM: tnmM || undefined,
        tnmStage: tnmStage.trim() || undefined,
        tumorGrade: tumorGrade || undefined,
        marginStatus: marginStatus || undefined,
      };

      if (existingReportId) {
        await apiClient.patch(`/api/v1/pathology/reports/${existingReportId}`, payload);
      } else {
        const res = await apiClient.post<{ data: PathologyReport }>('/api/v1/pathology/reports', payload);
        const created = (res as unknown as { data: PathologyReport })?.data;
        if (created?.id) setExistingReportId(created.id);
      }
      toast.success('보고서 저장 완료');
      qc.invalidateQueries({ queryKey: ['pathology-specimens'] });
      qc.invalidateQueries({ queryKey: ['pathology-report', specimen.id] });
    } catch {
      toast.error('보고서 저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const signMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/pathology/reports/${id}/sign`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathology-specimens'] });
      qc.invalidateQueries({ queryKey: ['pathology-report', specimen.id] });
      toast.success('보고서 서명 완료');
      onDone();
    },
    onError: () => toast.error('서명 실패'),
  });

  const handleSign = async () => {
    if (!existingReportId) {
      toast.error('보고서를 먼저 저장해주세요');
      return;
    }
    // save then sign
    await handleSave();
    signMut.mutate(existingReportId);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900">판독 보고서 작성</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {specimen.patient?.familyName}{specimen.patient?.givenName} / {specimen.accessionNumber} / {specimenTypeText(specimen.specimenType)}
          </p>
        </div>
        <button onClick={onDone} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">닫기</button>
      </div>

      {/* Gross */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">육안 소견 (Gross Description)</label>
        <textarea value={grossDescription} onChange={e => setGrossDescription(e.target.value)}
          rows={3} placeholder="검체의 육안적 소견을 기술하세요..."
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>

      {/* Micro */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">현미경 소견 (Microscopic Description)</label>
        <textarea value={microDescription} onChange={e => setMicroDescription(e.target.value)}
          rows={3} placeholder="조직학적 소견을 기술하세요..."
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>

      {/* Diagnosis */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">최종 진단 (Diagnosis)</label>
          <textarea value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
            rows={2} placeholder="최종 병리학적 진단..."
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">진단코드 (ICD)</label>
          <input type="text" value={diagnosisCode} onChange={e => setDiagnosisCode(e.target.value)}
            placeholder="C50.9" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* IHC */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-700">면역화학 (IHC)</label>
          <button onClick={() => setIhcRows(prev => [...prev, { marker: '', result: '' }])}
            className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">+ 추가</button>
        </div>
        {ihcRows.length === 0 && <p className="text-xs text-gray-400 italic">항목 없음</p>}
        {ihcRows.map((row, idx) => (
          <div key={idx} className="flex gap-2 mb-1.5">
            <input type="text" value={row.marker} placeholder="Marker (예: ER)"
              onChange={e => { const n = [...ihcRows]; n[idx] = { ...n[idx], marker: e.target.value }; setIhcRows(n); }}
              className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input type="text" value={row.result} placeholder="결과 (예: Positive 90%)"
              onChange={e => { const n = [...ihcRows]; n[idx] = { ...n[idx], result: e.target.value }; setIhcRows(n); }}
              className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={() => setIhcRows(prev => prev.filter((_, i) => i !== idx))}
              className="text-red-400 hover:text-red-600 text-xs px-1">삭제</button>
          </div>
        ))}
      </div>

      {/* Molecular */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-700">분자검사 (Molecular)</label>
          <button onClick={() => setMolecularRows(prev => [...prev, { test: '', result: '' }])}
            className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">+ 추가</button>
        </div>
        {molecularRows.length === 0 && <p className="text-xs text-gray-400 italic">항목 없음</p>}
        {molecularRows.map((row, idx) => (
          <div key={idx} className="flex gap-2 mb-1.5">
            <input type="text" value={row.test} placeholder="검사명 (예: EGFR)"
              onChange={e => { const n = [...molecularRows]; n[idx] = { ...n[idx], test: e.target.value }; setMolecularRows(n); }}
              className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input type="text" value={row.result} placeholder="결과"
              onChange={e => { const n = [...molecularRows]; n[idx] = { ...n[idx], result: e.target.value }; setMolecularRows(n); }}
              className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={() => setMolecularRows(prev => prev.filter((_, i) => i !== idx))}
              className="text-red-400 hover:text-red-600 text-xs px-1">삭제</button>
          </div>
        ))}
      </div>

      {/* TNM Staging */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">TNM 병기</label>
        <div className="flex gap-2 items-center">
          <select value={tnmT} onChange={e => setTnmT(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">T</option>
            {T_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={tnmN} onChange={e => setTnmN(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">N</option>
            {N_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={tnmM} onChange={e => setTnmM(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">M</option>
            {M_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <input type="text" value={tnmStage} onChange={e => setTnmStage(e.target.value)}
            placeholder="Stage (예: IIA)" className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Grade + Margin */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">종양 등급</label>
          <select value={tumorGrade} onChange={e => setTumorGrade(e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">선택</option>
            {GRADE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">절제면</label>
          <select value={marginStatus} onChange={e => setMarginStatus(e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">선택</option>
            {MARGIN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50 transition-colors">
          {saving ? '저장 중...' : '저장'}
        </button>
        {existingReportId && (
          <>
            <SmartSignButton
              documentType="PATHOLOGY_REPORT"
              documentId={existingReportId}
              documentTitle="병리 판독 서명"
              onSign={handleSign}
              variant="small"
              label="서명 + 보고 완료"
            />
            <button onClick={() => setAddendumOpen(true)}
              className="px-4 py-2 text-sm font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-xl transition-colors">
              추가 보고서
            </button>
          </>
        )}
      </div>

      {existingReportId && (
        <AddendumModal
          open={addendumOpen}
          onClose={() => setAddendumOpen(false)}
          reportId={existingReportId}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['pathology-specimens'] });
            qc.invalidateQueries({ queryKey: ['pathology-report', specimen.id] });
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  MAIN PAGE                                  */
/* ═══════════════════════════════════════════ */
export default function PathologyPage() {
  /**
   * 🔴 서버가 명시적으로 갈라 둔 자리다 — 리포트 작성·수정·서명은
   *    `@Roles(DOCTOR, ADMIN)` 이고 주석에 **"최종 진단 서명은 병리의만(검사기사 서명 금지)"**
   *    라고 적혀 있다. 검체 접수·처리는 검사기사(LAB_TECH) 업무로 열려 있다.
   *    화면이 판독·서명 UI 를 검사기사에게 띄우면 누를 때마다 403 이고,
   *    **검사기사가 진단 서명을 할 수 있는 것처럼** 보인다.
   */
  const canDiagnose = useHasRole('DOCTOR');
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [mainTab, setMainTab] = useState<MainTab>('specimens');
  const [specimenFilter, setSpecimenFilter] = useState<SpecimenFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [regModalOpen, setRegModalOpen] = useState(false);
  const [reportSpecimenId, setReportSpecimenId] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  /* ─── Queries ─── */
  const { data: specimensData, isLoading: specimensLoading, isError: specimensError, error: specimensErr, refetch: specimensRefetch } = useQuery({
    queryKey: ['pathology-specimens'],
    queryFn: () => apiClient.get<{ data: PathologySpecimen[] }>('/api/v1/pathology/specimens'),
    refetchInterval: pollMs('fast'),
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['pathology-stats'],
    queryFn: () => apiClient.get<{ data: PathologyStats }>('/api/v1/pathology/stats'),
    refetchInterval: pollMs('normal'),
  });

  const { data: patientsData, isLoading: patientsLoading } = useQuery({
    queryKey: ['pathology-patients'],
    queryFn: () => apiClient.get<{ data: PathologyPatient[] }>('/api/v1/pathology/patients'),
    enabled: mainTab === 'patients',
  });

  /* ─── Mutations ─── */
  const receiveMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/pathology/specimens/${id}/receive`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pathology-specimens'] }); toast.success('검체 수령 확인 완료'); },
    onError: () => toast.error('수령 확인 실패'),
  });

  const signMut = useMutation({
    mutationFn: (reportId: string) => apiClient.post(`/api/v1/pathology/reports/${reportId}/sign`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pathology-specimens'] }); toast.success('판독 서명 완료'); },
    onError: () => toast.error('서명 실패'),
  });

  /* ─── Derived Data ─── */
  const _raw = specimensData?.data;
  const allSpecimens: PathologySpecimen[] = useMemo(() => {
    if (!_raw) return [];
    return Array.isArray(_raw) ? _raw : ((_raw as unknown as Record<string, unknown>)?.items ?? (_raw as unknown as Record<string, unknown>)?.data) as PathologySpecimen[] ?? [];
  }, [_raw]);

  const filteredSpecimens = useMemo(() => {
    if (specimenFilter === 'ALL') return allSpecimens;
    return allSpecimens.filter(s => s.status === specimenFilter);
  }, [allSpecimens, specimenFilter]);

  const reportSpecimens = useMemo(() => {
    return allSpecimens.filter(s => ['PROCESSING', 'REPORTED', 'SIGNED', 'AMENDED'].includes(s.status));
  }, [allSpecimens]);

  const counts = useMemo(() => ({
    received: allSpecimens.filter(s => s.status === 'RECEIVED').length,
    processing: allSpecimens.filter(s => s.status === 'PROCESSING').length,
    reported: allSpecimens.filter(s => s.status === 'REPORTED' || s.status === 'SIGNED').length,
    today: allSpecimens.filter(s => {
      if (!s.receivedAt) return false;
      return new Date(s.receivedAt).toDateString() === new Date().toDateString();
    }).length,
  }), [allSpecimens]);

  const selected = allSpecimens.find(s => s.id === selectedId);
  const reportSpecimen = allSpecimens.find(s => s.id === reportSpecimenId);

  const stats = statsData?.data as unknown as PathologyStats | undefined;
  const patients = useMemo(() => {
    const raw = patientsData?.data;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : (raw as unknown as Record<string, unknown>)?.items as PathologyPatient[] ?? [];
  }, [patientsData]);

  const patientSpecimens = useMemo(() => {
    if (!selectedPatientId) return [];
    return allSpecimens.filter(s => s.patient?.id === selectedPatientId);
  }, [allSpecimens, selectedPatientId]);

  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  if (specimensError) return <QueryErrorFallback error={specimensErr} onRetry={specimensRefetch} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="병리과" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="검체 접수 / 조직처리 / 판독 관리" /></p>
        </div>
        {mainTab === 'specimens' && (
          <button onClick={() => setRegModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            <T k="검체 접수" />
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-2xl p-4">
          <p className="text-xs text-blue-500 font-medium"><T k="접수대기" /></p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{counts.received}</p>
        </div>
        <div className="bg-amber-50 rounded-2xl p-4">
          <p className="text-xs text-amber-500 font-medium"><T k="처리중" /></p>
          <p className="text-3xl font-bold text-amber-700 mt-1">{counts.processing}</p>
        </div>
        <div className="bg-emerald-50 rounded-2xl p-4">
          <p className="text-xs text-emerald-500 font-medium"><T k="판독완료" /></p>
          <p className="text-3xl font-bold text-emerald-700 mt-1">{counts.reported}</p>
        </div>
        <div className="bg-indigo-50 rounded-2xl p-4">
          <p className="text-xs text-indigo-500 font-medium"><T k="오늘접수" /></p>
          <p className="text-3xl font-bold text-indigo-700 mt-1">{counts.today}</p>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-1 bg-gray-100/80 p-1 rounded-xl w-fit">
        {MAIN_TABS.map(t => (
          <button key={t.key} onClick={() => { setMainTab(t.key); setSelectedId(null); setReportSpecimenId(null); setSelectedPatientId(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              mainTab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}><T k={t.label} /></button>
        ))}
      </div>

      {/* ═══ Tab 1: 검체 관리 ═══ */}
      {mainTab === 'specimens' && (
        <>
          {/* Specimen Sub-filters */}
          <div className="flex gap-1 bg-gray-50 p-1 rounded-lg w-fit">
            {SPECIMEN_FILTERS.map(f => (
              <button key={f.key} onClick={() => { setSpecimenFilter(f.key); setSelectedId(null); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  specimenFilter === f.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}><T k={f.label} /></button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
            {/* Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="접수번호" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검체유형" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="채취부위" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="우선순위" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="접수일" /></th>
                  </tr>
                </thead>
                <tbody>
                  {specimensLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td colSpan={7} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      </tr>
                    ))
                  ) : filteredSpecimens.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="검체가 없습니다" /></td></tr>
                  ) : filteredSpecimens.map(spec => (
                    <tr key={spec.id} onClick={() => setSelectedId(spec.id)}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${selectedId === spec.id ? 'bg-indigo-50' : 'hover:bg-gray-50/50'}`}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{spec.accessionNumber}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{spec.patient?.familyName}{spec.patient?.givenName}</p>
                        <p className="text-[10px] text-gray-400">{spec.patient?.mrn}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{specimenTypeText(spec.specimenType)}</td>
                      <td className="px-4 py-3 text-gray-700">{spec.collectionSite}</td>
                      <td className="px-4 py-3">
                        <Badge label={PRIORITY_LABEL[spec.priority] ?? spec.priority} colorClass={PRIORITY_COLOR[spec.priority] ?? 'bg-gray-100 text-gray-600'} />
                      </td>
                      <td className="px-4 py-3">
                        <Badge label={STATUS_LABEL[spec.status] ?? spec.status} colorClass={STATUS_COLOR[spec.status] ?? 'bg-gray-100 text-gray-600'} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {spec.receivedAt ?kdate(spec.receivedAt, 'date') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Detail Panel */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              {!selected ? (
                <div className="text-center py-12">
                  <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <p className="text-sm text-gray-400"><T k="검체를 선택하세요" /></p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900"><T k="검체 상세" /></h3>
                    <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>

                  {/* Progress Bar */}
                  <div className="bg-gray-50 rounded-xl p-3">
                    <ProgressBar status={selected.status} />
                  </div>

                  {/* Patient Info */}
                  <div className="bg-indigo-50 rounded-xl p-3">
                    <p className="text-xs text-indigo-600 font-medium"><T k="환자" /></p>
                    <p className="text-sm font-bold text-gray-900">{selected.patient?.familyName}{selected.patient?.givenName}</p>
                    <p className="text-[10px] text-gray-500">MRN: {selected.patient?.mrn}</p>
                  </div>

                  {/* Specimen Info */}
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                    <p className="text-xs text-gray-500 font-medium"><T k="검체 정보" /></p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-gray-400"><T k="접수번호" /></span><p className="font-mono font-medium text-gray-900">{selected.accessionNumber}</p></div>
                      <div><span className="text-gray-400"><T k="검체유형" /></span><p className="font-medium text-gray-900">{specimenTypeText(selected.specimenType)}</p></div>
                      <div><span className="text-gray-400"><T k="채취부위" /></span><p className="font-medium text-gray-900">{selected.collectionSite}</p></div>
                      <div>
                        <span className="text-gray-400"><T k="우선순위" /></span>
                        <p><Badge label={PRIORITY_LABEL[selected.priority] ?? selected.priority} colorClass={PRIORITY_COLOR[selected.priority] ?? 'bg-gray-100 text-gray-600'} /></p>
                      </div>
                      {selected.fixative && (
                        <div><span className="text-gray-400"><T k="고정액" /></span><p className="font-medium text-gray-900">{selected.fixative}</p></div>
                      )}
                      {selected.collectedAt && (
                        <div><span className="text-gray-400"><T k="채취일" /></span><p className="font-medium text-gray-900">{kdate(new Date(selected.collectedAt))}</p></div>
                      )}
                    </div>
                    {selected.clinicalInfo && (
                      <div className="pt-2">
                        <span className="text-gray-400 text-xs"><T k="임상정보" /></span>
                        <p className="text-xs text-gray-700 bg-white rounded-lg p-2 mt-0.5">{selected.clinicalInfo}</p>
                      </div>
                    )}
                    <div className="pt-1">
                      <Badge label={STATUS_LABEL[selected.status] ?? selected.status} colorClass={STATUS_COLOR[selected.status] ?? 'bg-gray-100 text-gray-600'} />
                    </div>
                  </div>

                  {/* Receive Button */}
                  {selected.status === 'RECEIVED' && (
                    <button onClick={() => receiveMut.mutate(selected.id)} disabled={receiveMut.isPending}
                      className="w-full py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50 transition-colors">
                      {receiveMut.isPending ? <T k="처리 중..." /> : <T k="수령 확인" />}
                    </button>
                  )}

                  {/* Report Summary */}
                  {(selected.grossDescription || selected.microDescription || selected.diagnosis) && (
                    <div className="space-y-3 border-t border-gray-100 pt-3">
                      <p className="text-xs font-bold text-gray-700"><T k="판독 보고서" /></p>
                      {selected.grossDescription && (
                        <div>
                          <p className="text-[10px] text-gray-400 font-medium mb-1"><T k="육안 소견" /></p>
                          <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2">{selected.grossDescription}</p>
                        </div>
                      )}
                      {selected.microDescription && (
                        <div>
                          <p className="text-[10px] text-gray-400 font-medium mb-1"><T k="현미경 소견" /></p>
                          <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2">{selected.microDescription}</p>
                        </div>
                      )}
                      {selected.diagnosis && (
                        <div>
                          <p className="text-[10px] text-gray-400 font-medium mb-1"><T k="진단" /></p>
                          <p className="text-xs text-gray-900 font-medium bg-emerald-50 rounded-lg p-2">{selected.diagnosis}</p>
                        </div>
                      )}
                      {selected.diagnosisCode && (
                        <p className="text-[10px] text-gray-500">ICD: {selected.diagnosisCode}</p>
                      )}
                      {selected.tnmStage && (
                        <p className="text-[10px] text-gray-500">TNM Stage: {selected.tnmStage}</p>
                      )}
                      {selected.pathologist && (
                        <p className="text-[10px] text-gray-400">
                          <T k="판독의" />: {selected.pathologist.familyName}{selected.pathologist.givenName}
                          {selected.reportedAt && ` | ${kdate(selected.reportedAt, 'datetimeSec')}`}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Sign Button */}
                  {canDiagnose && selected.status === 'REPORTED' && (
                    <SmartSignButton
                      documentType="PATHOLOGY_REPORT"
                      documentId={selected.id}
                      documentTitle="병리 판독 서명"
                      onSign={() => { if (selected.report?.id) signMut.mutate(selected.report.id); else toast.error('판독 보고서가 없습니다'); }}
                      variant="small"
                      label={tAttr('판독 서명')}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ═══ Tab 2: 판독 보고서 ═══ */}
      {mainTab === 'reports' && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
          {/* Specimen List for Reporting */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
              <h3 className="text-sm font-bold text-gray-700"><T k="판독 대상 검체" /></h3>
              <p className="text-[10px] text-gray-400 mt-0.5"><T k="처리중 / 판독완료 / 서명완료 검체" /></p>
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y divide-gray-50">
              {specimensLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="px-4 py-3"><Skeleton className="h-10 w-full" /></div>
                ))
              ) : reportSpecimens.length === 0 ? (
                <EmptyState icon="🔬" title="판독 대상 검체가 없습니다" />
              ) : reportSpecimens.map(spec => (
                <button key={spec.id} onClick={() => setReportSpecimenId(spec.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${reportSpecimenId === spec.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{spec.patient?.familyName}{spec.patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{spec.accessionNumber}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge label={STATUS_LABEL[spec.status] ?? spec.status} colorClass={STATUS_COLOR[spec.status] ?? 'bg-gray-100 text-gray-600'} />
                      <Badge label={PRIORITY_LABEL[spec.priority] ?? spec.priority} colorClass={PRIORITY_COLOR[spec.priority] ?? 'bg-gray-100 text-gray-600'} />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">{specimenTypeText(spec.specimenType)} - {spec.collectionSite}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Report Form */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            {!reportSpecimen ? (
              <div className="text-center py-16">
                <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm text-gray-400"><T k="판독할 검체를 선택하세요" /></p>
              </div>
            ) : !canDiagnose ? (
              <div className="text-center py-16">
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg inline-block px-3 py-1.5">
                  <T k="판독 보고서 작성·서명은 병리의 권한입니다 — 이 계정에서는 검체 접수·처리와 조회만 가능합니다." />
                </p>
              </div>
            ) : (
              <ReportForm
                key={reportSpecimen.id}
                specimen={reportSpecimen}
                onDone={() => setReportSpecimenId(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* ═══ Tab 3: 통계 ═══ */}
      {mainTab === 'stats' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {statsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <Skeleton className="h-4 w-20 mb-3" />
                  <Skeleton className="h-8 w-16" />
                </div>
              ))
            ) : (
              <>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs text-gray-500 font-medium"><T k="총 접수" /></p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stats?.totalReceived ?? 0}</p>
                  <p className="text-[10px] text-gray-400 mt-1"><T k="전체 기간" /></p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs text-gray-500 font-medium"><T k="보고 완료" /></p>
                  <p className="text-3xl font-bold text-emerald-600 mt-2">{stats?.totalReported ?? 0}</p>
                  <p className="text-[10px] text-gray-400 mt-1"><T k="서명 포함" /></p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs text-gray-500 font-medium"><T k="평균 TAT" /></p>
                  <p className="text-3xl font-bold text-blue-600 mt-2">{stats?.averageTAT ?? 0}<span className="text-sm font-normal text-gray-400 ml-1"><T k="시간@단위" /></span></p>
                  <p className="text-[10px] text-gray-400 mt-1"><T k="접수~보고 완료" /></p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs text-gray-500 font-medium"><T k="긴급 건수" /></p>
                  <p className="text-3xl font-bold text-red-600 mt-2">{stats?.urgentCount ?? 0}</p>
                  <p className="text-[10px] text-gray-400 mt-1">URGENT + FROZEN</p>
                </div>
              </>
            )}
          </div>

          {/* Pending Summary */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-3"><T k="현황 요약" /></h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-blue-50 rounded-xl p-4">
                <p className="text-2xl font-bold text-blue-700">{counts.received}</p>
                <p className="text-xs text-blue-500 mt-1"><T k="접수 대기" /></p>
              </div>
              <div className="bg-amber-50 rounded-xl p-4">
                <p className="text-2xl font-bold text-amber-700">{counts.processing}</p>
                <p className="text-xs text-amber-500 mt-1"><T k="처리 중" /></p>
              </div>
              <div className="bg-emerald-50 rounded-xl p-4">
                <p className="text-2xl font-bold text-emerald-700">{counts.reported}</p>
                <p className="text-xs text-emerald-500 mt-1"><T k="판독 완료" /></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Tab 4: 환자 목록 ═══ */}
      {mainTab === 'patients' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
          {/* Patient List */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="등록번호" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="검체 수" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="최근 검체일" /></th>
                </tr>
              </thead>
              <tbody>
                {patientsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td colSpan={4} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    </tr>
                  ))
                ) : patients.length === 0 ? (
                  <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="환자 데이터가 없습니다" /></td></tr>
                ) : patients.map(pt => (
                  <tr key={pt.id} onClick={() => setSelectedPatientId(pt.id)}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${selectedPatientId === pt.id ? 'bg-indigo-50' : 'hover:bg-gray-50/50'}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{pt.familyName}{pt.givenName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{pt.mrn}</td>
                    <td className="px-4 py-3">
                      <Badge label={`${pt.specimenCount}건`} colorClass="bg-blue-100 text-blue-700" />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {pt.lastSpecimenDate ?kdate(pt.lastSpecimenDate, 'date') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Patient Specimen History */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            {!selectedPatient ? (
              <div className="text-center py-12">
                <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <p className="text-sm text-gray-400"><T k="환자를 선택하세요" /></p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-900"><T k="검체 이력" /></h3>
                  <button onClick={() => setSelectedPatientId(null)} className="text-gray-400 hover:text-gray-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                <div className="bg-indigo-50 rounded-xl p-3">
                  <p className="text-sm font-bold text-gray-900">{selectedPatient.familyName}{selectedPatient.givenName}</p>
                  <p className="text-[10px] text-gray-500">MRN: {selectedPatient.mrn} / 총 {selectedPatient.specimenCount}<Unit>건</Unit></p>
                </div>

                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {patientSpecimens.length === 0 ? (
                    <EmptyState icon="🧫" title="검체 이력이 없습니다" />
                  ) : patientSpecimens.map(spec => (
                    <div key={spec.id} className="bg-gray-50 rounded-xl p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-mono text-gray-600">{spec.accessionNumber}</p>
                        <Badge label={STATUS_LABEL[spec.status] ?? spec.status} colorClass={STATUS_COLOR[spec.status] ?? 'bg-gray-100 text-gray-600'} />
                      </div>
                      <p className="text-xs text-gray-700">{specimenTypeText(spec.specimenType)} - {spec.collectionSite}</p>
                      <div className="flex items-center gap-2">
                        <Badge label={PRIORITY_LABEL[spec.priority] ?? spec.priority} colorClass={PRIORITY_COLOR[spec.priority] ?? 'bg-gray-100 text-gray-600'} />
                        <span className="text-[10px] text-gray-400">
                          {spec.receivedAt ?kdate(spec.receivedAt, 'date') : ''}
                        </span>
                      </div>
                      {spec.diagnosis && (
                        <p className="text-[10px] text-emerald-700 bg-emerald-50 rounded-lg p-1.5 mt-1">{spec.diagnosis}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <SpecimenRegModal
        open={regModalOpen}
        onClose={() => setRegModalOpen(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['pathology-specimens'] })}
      />
    </div>
  );
}
