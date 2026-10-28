'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { EmptyState, Unit, PatientName, StaffName, Unknown } from '@/components/ui/display';
import PatientSelector from '@/components/ui/PatientSelector';
import { DraftBanner, recordDraftApplied, warnIfDraftNotRecorded, type DraftProvenance } from '@/components/ai/DraftBanner';
import { proposalIdFrom, markProposalPresented, decideProposal } from '@/lib/ai-proposal';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface MdtConference {
  id: string;
  title: string;
  conferenceType: string;
  department: string;
  scheduledAt: string;
  location?: string;
  status: string;
  createdAt?: string;
  chairpersonName?: string | null;
  /** 자동생성 회의록 — 서버 generate-minutes 결과 */
  minutes?: string | null;
  minutesGeneratedAt?: string | null;
  _count?: { cases: number; attendees: number };
  cases?: MdtCase[];
  attendees?: MdtAttendee[];
}

interface MdtCase {
  id: string;
  conferenceId: string;
  patientId: string;
  /** 서버(findOne)가 실제로 주는 형태 — 종전 FE 는 없는 `patientName` 을 읽어 화면에 UUID 가 찍혔다(W7 ③) */
  patient?: { id: string; familyName?: string | null; givenName?: string | null; mrn?: string | null };
  primaryDiag: string;
  tnmStage?: string;
  proposedPlan?: string;
  clinicalSummary?: string;
  decision?: string;
  decisionCategory?: string;
  createdAt?: string;
}

interface MdtAttendee {
  id: string;
  conferenceId: string;
  userId: string;
  /** 서버가 user 테이블에서 해석해 준다(없으면 null=기록 없음 — UUID 로 때우지 않는다) */
  userName?: string | null;
  department: string;
  role: string;
  attended: boolean;
}

interface PatientMdtRecord {
  id: string;
  conferenceId: string;
  conferenceTitle: string;
  conferenceDate: string;
  primaryDiag: string;
  tnmStage?: string;
  decision?: string;
  decisionCategory?: string;
}

/**
 * 통계 응답 계약 — 서버는 **객체 맵**(코드 → 건수)을 준다.
 * 🔴 종전 FE 는 배열로 알고 `.map()` 을 불러 통계 탭이 열자마자 TypeError 로 통째 죽었다(W7 ② · P11).
 *    `?.` 는 `{}` 를 막아주지 못한다 — 형태가 다른 것이지 없는 것이 아니다.
 */
interface MdtStats {
  totalConferences: number;
  totalCases: number;
  /** 예정일이 지났는데 아직 '예정'인 회의 */
  overdueScheduled?: number;
  /** 완료 처리됐지만 케이스·참석자 기록이 0건인 회의 */
  completedWithoutRecord?: number;
  byDecisionCategory: Record<string, number>;
  byStatus: Record<string, number>;
}

interface ConferenceFormData {
  title: string;
  conferenceType: string;
  department: string;
  scheduledAt: string;
  location: string;
}

interface CaseFormData {
  patientId: string;
  primaryDiag: string;
  tnmStage: string;
  proposedPlan: string;
}

interface StaffOption {
  id: string;
  familyName?: string | null;
  givenName?: string | null;
  role?: string | null;
  department?: string | null;
}

interface AttendeeFormData {
  userId: string;
  department: string;
  role: string;
}

interface DecisionFormData {
  decision: string;
  /** 빈 문자열 = 아직 고르지 않음 — 기본값(프리필)을 두지 않는다(W7 ①) */
  decisionCategory: string;
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'list', label: '회의 일정', icon: '📋' },
  { key: 'detail', label: '회의 상세', icon: '📄' },
  { key: 'patient', label: '환자별 MDT 이력', icon: '🏥' },
  { key: 'stats', label: '통계', icon: '📊' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const CONF_TYPE_LABEL: Record<string, string> = {
  TUMOR_BOARD: '종양위원회',
  MORBIDITY_MORTALITY: '이환사망회의',
  CASE_CONFERENCE: '증례토의',
};
const CONF_TYPE_COLOR: Record<string, string> = {
  TUMOR_BOARD: 'bg-red-100 text-red-700',
  MORBIDITY_MORTALITY: 'bg-amber-100 text-amber-700',
  CASE_CONFERENCE: 'bg-blue-100 text-blue-700',
};

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '예정',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  CANCELLED: '취소',
};
const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-gray-200 text-gray-600',
  CANCELLED: 'bg-red-100 text-red-600',
};

/**
 * 결정 분류 — 서버 정본(MDT_DECISION_CATEGORIES)과 같은 집합이어야 한다.
 * `UNCLASSIFIED`(미분류)는 "논의했으나 분류를 확정하지 않음"이고,
 * `OBSERVATION`(경과관찰)은 "치료하지 않고 지켜보기로 결정함"이다 — 둘은 다른 임상 사실이다.
 */
const DECISION_LABEL: Record<string, string> = {
  SURGERY: '수술',
  CHEMO: '항암치료',
  RADIATION: '방사선치료',
  COMBINED: '복합치료',
  PALLIATIVE: '완화치료',
  OBSERVATION: '경과관찰',
  UNCLASSIFIED: '미분류',
  /** 통계 응답에서 decisionCategory 가 null 인 케이스 */
  UNRECORDED: '분류 미기록',
};
const DECISION_COLOR: Record<string, string> = {
  SURGERY: 'bg-red-100 text-red-700',
  CHEMO: 'bg-purple-100 text-purple-700',
  RADIATION: 'bg-amber-100 text-amber-700',
  COMBINED: 'bg-blue-100 text-blue-700',
  PALLIATIVE: 'bg-emerald-100 text-emerald-700',
  OBSERVATION: 'bg-gray-100 text-gray-600',
  UNCLASSIFIED: 'bg-gray-100 text-gray-500',
  UNRECORDED: 'bg-gray-100 text-gray-500',
};
/** 의사가 고를 수 있는 분류(순서 = 화면 표시 순서). 프리필 없음 — 빈 값이 초기 상태다. */
const DECISION_OPTIONS = ['SURGERY', 'CHEMO', 'RADIATION', 'COMBINED', 'PALLIATIVE', 'OBSERVATION', 'UNCLASSIFIED'];

const ROLE_LABEL: Record<string, string> = {
  CHAIR: '의장',
  PRESENTER: '발표자',
  PANELIST: '패널',
  OBSERVER: '참관',
};
const ROLE_COLOR: Record<string, string> = {
  CHAIR: 'bg-yellow-100 text-yellow-700',
  PRESENTER: 'bg-blue-100 text-blue-700',
  PANELIST: 'bg-emerald-100 text-emerald-700',
  OBSERVER: 'bg-gray-100 text-gray-600',
};

/**
 * 진료과 선택지 = **마스터(useDepartments)** ∪ 실제 데이터에 있는 값.
 * 🔴 종전 로컬 상수 20과는 마스터와 어긋났고('소아과'·'비뇨기과'·'심장내과' 는 마스터 밖 표기),
 *    마스터에만 의존하면 데이터의 실제 과는 필터에서 영영 못 고른다 — 그래서 합집합이 정본이다.
 */
function departmentOptions(master: string[], present: (string | undefined)[], selected?: string) {
  return [...new Set([...master, ...present.filter((d): d is string => !!d), ...(selected ? [selected] : [])])];
}

function fmtDateTime(d?: string) {
  return d ? kdate(d, 'datetime') : '-';
}
function fmtDate(d?: string) {
  return d ? kdate(d) : '-';
}

/**
 * 예정일이 지났는데 아직 시작되지 않은 회의 — 화면이 그냥 '예정'이라고 말하면
 * 71일 지난 미개최 회의가 앞으로 열릴 회의처럼 보인다(W7 ⑧ · P1ⓓ).
 */
function overdueDays(c: { status?: string; scheduledAt?: string }): number | null {
  if (c.status !== 'SCHEDULED' || !c.scheduledAt) return null;
  const diff = Date.now() - new Date(c.scheduledAt).getTime();
  if (Number.isNaN(diff) || diff <= 0) return null;
  return Math.floor(diff / 86_400_000);
}

/** 상태 배지 — 기한이 지난 '예정'은 '미개최'로 말한다 */
function StatusBadgeOf({ c }: { c: { status: string; scheduledAt?: string } }) {
  const od = overdueDays(c);
  if (od !== null) {
    return <Badge label={od > 0 ? <Tf k="미개최 ({일수}일 경과)" params={{ 일수: od }} /> : '미개최 (기한 경과)'} color="bg-red-100 text-red-700" />;
  }
  return <Badge label={STATUS_LABEL[c.status] ?? c.status} color={STATUS_COLOR[c.status] ?? 'bg-gray-100 text-gray-600'} />;
}

/* ═══════════════════════════════════════════════════════════════
   Badge Component
   ═══════════════════════════════════════════════════════════════ */

/** 🔴 문자열 label 은 **키 원문**이다 — 여기서 `<T>` 로 그린다(호출부가 번역해 넘기지 않는다). 보간 문장은 노드로 넘긴다. */
function Badge({ label, color }: { label: React.ReactNode; color: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${color}`}>
      {typeof label === 'string' ? <T k={label} /> : label}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Modal Component
   ═══════════════════════════════════════════════════════════════ */

function Modal({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          {/* title 은 키 원문 — 여기서 번역한다 */}
          <h3 className="text-lg font-bold text-gray-900"><T k={title} /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 1: Conference List
   ═══════════════════════════════════════════════════════════════ */

function ConferenceListTab({ onSelect }: { onSelect: (id: string) => void }) {
  const { names: deptMaster } = useDepartments({ category: 'CLINICAL' });
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ConferenceFormData>({
    title: '', conferenceType: 'TUMOR_BOARD', department: '', scheduledAt: '', location: '',
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['mdt-conferences', filterDept, filterStatus],
    queryFn: () =>
      // 🔴 종전엔 `department=` 로 보냈는데 서버는 @Query('dept') 를 읽어
      //    "내과"를 골라도 소화기내과·유방외과가 그대로 남았다(W7 ⑤ · P11).
      apiClient.get<{ data: MdtConference[] }>('/api/v1/mdt/conferences', {
        ...(filterDept && { dept: filterDept }),
        ...(filterStatus && { status: filterStatus }),
      }),
  });

  const conferences: MdtConference[] = (() => {
    const raw = data?.data;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)) {
      return (raw as unknown as { data: MdtConference[] }).data ?? [];
    }
    return [];
  })();

  const createMut = useMutation({
    mutationFn: (d: ConferenceFormData) => apiClient.post('/api/v1/mdt/conferences', d),
    onSuccess: () => {
      toast.success(tAttr('회의가 생성되었습니다.'));
      qc.invalidateQueries({ queryKey: ['mdt-conferences'] });
      setShowCreate(false);
      setForm({ title: '', conferenceType: 'TUMOR_BOARD', department: '', scheduledAt: '', location: '' });
    },
    onError: () => toast.error(tAttr('회의 생성에 실패했습니다.')),
  });

  const startMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/mdt/conferences/${id}/start`),
    onSuccess: () => { toast.success(tAttr('회의가 시작되었습니다.')); qc.invalidateQueries({ queryKey: ['mdt-conferences'] }); },
    onError: () => toast.error(tAttr('회의 시작에 실패했습니다.')),
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/mdt/conferences/${id}/complete`),
    onSuccess: () => { toast.success(tAttr('회의가 종료되었습니다.')); qc.invalidateQueries({ queryKey: ['mdt-conferences'] }); },
    onError: () => toast.error(tAttr('회의 종료에 실패했습니다.')),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
          <option value="">{tAttr('전체 진료과')}</option>
          {departmentOptions(deptMaster, conferences.map(c => c.department), filterDept).map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
          <option value="">{tAttr('전체 상태')}</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{tAttr(v)}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={() => setShowCreate(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">
          + <T k="회의 생성" />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-400 text-sm"><T k="로딩 중..." /></div>
        ) : conferences.length === 0 ? (
          <EmptyState icon="👥" title="등록된 회의가 없습니다" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="제목" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 w-[110px]"><T k="유형" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="진료과" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 w-[140px]"><T k="일시" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-[60px]"><T k="케이스" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-[60px]"><T k="참석" /></th>
                <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 w-[160px]"><T k="액션" /></th>
              </tr>
            </thead>
            <tbody>
              {conferences.map(c => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer"
                  onClick={() => onSelect(c.id)}>
                  <td className="px-5 py-3 font-medium text-gray-900">{c.title}</td>
                  <td className="px-5 py-3">
                    <Badge label={CONF_TYPE_LABEL[c.conferenceType] ?? c.conferenceType} color={CONF_TYPE_COLOR[c.conferenceType] ?? 'bg-gray-100 text-gray-600'} />
                  </td>
                  <td className="px-5 py-3 text-gray-600">{c.department}</td>
                  <td className="px-5 py-3 text-gray-600">{fmtDateTime(c.scheduledAt)}</td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <StatusBadgeOf c={c} />
                      {/* 완료로 표시됐지만 케이스·참석자 기록이 하나도 없는 회의 — 완료가 곧 기록은 아니다(W7 ⑧) */}
                      {c.status === 'COMPLETED' && (c._count?.cases ?? 0) === 0 && (c._count?.attendees ?? 0) === 0 && (
                        <span className="text-[10px] text-amber-600" title={tAttr('완료 처리됐지만 논의 케이스·참석자가 기록되지 않았습니다')}><T k="기록 없음" /></span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center text-gray-600">{c._count?.cases ?? 0}</td>
                  <td className="px-5 py-3 text-center text-gray-600">{c._count?.attendees ?? 0}</td>
                  <td className="px-5 py-3 text-center" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      {c.status === 'SCHEDULED' && (
                        <button onClick={() => startMut.mutate(c.id)}
                          className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                          <T k="시작" />
                        </button>
                      )}
                      {c.status === 'IN_PROGRESS' && (
                        <button onClick={() => completeMut.mutate(c.id)}
                          className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
                          <T k="종료" />
                        </button>
                      )}
                      <button onClick={() => onSelect(c.id)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                        <T k="상세" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="MDT 회의 생성">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="제목" /></label>
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder={tAttr('회의 제목')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="유형" /></label>
            <select value={form.conferenceType} onChange={e => setForm(p => ({ ...p, conferenceType: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
              {Object.entries(CONF_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{tAttr(v)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="진료과" /></label>
            <select value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
              <option value="">{tAttr('선택')}</option>
              {departmentOptions(deptMaster, conferences.map(c => c.department), form.department).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="일시" /></label>
            <input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(p => ({ ...p, scheduledAt: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="장소" /></label>
            <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder={tAttr('회의실')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"><T k="취소" /></button>
            <button onClick={() => createMut.mutate(form)} disabled={!form.title || !form.department || !form.scheduledAt || createMut.isPending}
              className="min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <T k={createMut.isPending ? '생성 중...' : '생성'} />
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 2: Conference Detail
   ═══════════════════════════════════════════════════════════════ */

function ConferenceDetailTab({ conferenceId, onBack }: { conferenceId: string; onBack: () => void }) {
  const { names: deptMaster } = useDepartments({ category: 'CLINICAL' });
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [showAddCase, setShowAddCase] = useState(false);
  const [showAddAttendee, setShowAddAttendee] = useState(false);
  const [editDecisionId, setEditDecisionId] = useState<string | null>(null);
  const [showEditConf, setShowEditConf] = useState(false);

  const [caseForm, setCaseForm] = useState<CaseFormData>({ patientId: '', primaryDiag: '', tnmStage: '', proposedPlan: '' });
  const [attendeeForm, setAttendeeForm] = useState<AttendeeFormData>({ userId: '', department: '', role: 'PANELIST' });
  // 🔴 종전 초기값이 'OBSERVATION'(경과관찰=무치료)이었다. 의사가 결정문만 쓰고 저장하면
  //    고르지도 않은 무치료 결정이 기록됐다(W7 ① · P15). 초기값은 '아직 고르지 않음'뿐이다.
  const [decisionForm, setDecisionForm] = useState<DecisionFormData>({ decision: '', decisionCategory: '' });
  const [editConfForm, setEditConfForm] = useState<ConferenceFormData>({
    title: '', conferenceType: 'TUMOR_BOARD', department: '', scheduledAt: '', location: '',
  });
  /**
   * 🔴 초안≠확정 — AI 임상요약은 **화면 안에만** 산다. 서버는 더 이상 저장하지 않고 초안을 돌려줄 뿐이고,
   *    정본(`clinicalSummary`)은 아래 '요약 저장' 을 사람이 눌러야 들어간다(PATCH /mdt/cases/:id).
   *    산출 불가(UNAVAILABLE)면 초안은 null 이고 사유만 말한다 — 빈 글로 채우지 않는다.
   */
  const [summaryDraft, setSummaryDraft] = useState<{
    caseId: string;
    patientId?: string | null;
    text: string;
    /** 🔴 AI 가 낸 **원문** — 저장 시 `text` 와 비교해 수용(ACCEPTED)/수정(EDITED)을 가른다(고쳤는데 수용으로 세지 않는다) */
    originalText: string;
    source: 'AI' | 'UNAVAILABLE';
    reason: string | null;
    model: string | null;
    /** 서버 제안 원장 id — 없으면 null(지어내지 않는다 · 결정도 남기지 않는다) */
    proposalId: string | null;
    provenance: DraftProvenance | null;
  } | null>(null);
  /** 거부 사유는 **선택**이다 — 강제하면 거짓 사유가 쌓인다(빈 값이면 사유 없이 거부로 남는다) */
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['mdt-conference', conferenceId],
    queryFn: () => apiClient.get<{ data: MdtConference }>(`/api/v1/mdt/conferences/${conferenceId}`),
    enabled: !!conferenceId,
  });

  // 참석자 선택용 직원 목록 — 사용자 UUID 를 손으로 적게 하지 않는다
  const { data: staffData, isError: staffIsError, error: staffError, refetch: refetchStaff } = useQuery({
    queryKey: ['mdt-staff'],
    queryFn: () => apiClient.get<{ data: StaffOption[] }>('/api/v1/users'),
    enabled: showAddAttendee,
    staleTime: 300_000,
  });
  const staffOptions: StaffOption[] = Array.isArray(staffData?.data) ? staffData.data : [];

  const conference: MdtConference | null = (() => {
    const raw: unknown = data?.data;
    if (!raw || typeof raw !== 'object') return null;
    if ('id' in (raw as Record<string, unknown>)) return raw as MdtConference;
    if ('data' in (raw as Record<string, unknown>)) return (raw as { data: MdtConference }).data ?? null;
    return null;
  })();

  const cases: MdtCase[] = conference?.cases ?? [];
  const attendees: MdtAttendee[] = conference?.attendees ?? [];

  // Mutations
  const addCaseMut = useMutation({
    mutationFn: (d: CaseFormData) => apiClient.post(`/api/v1/mdt/conferences/${conferenceId}/cases`, d),
    onSuccess: () => {
      toast.success(tAttr('케이스가 추가되었습니다.'));
      qc.invalidateQueries({ queryKey: ['mdt-conference', conferenceId] });
      setShowAddCase(false);
      setCaseForm({ patientId: '', primaryDiag: '', tnmStage: '', proposedPlan: '' });
    },
    onError: () => toast.error(tAttr('케이스 추가에 실패했습니다.')),
  });

  const deleteCaseMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/mdt/cases/${id}`),
    onSuccess: () => {
      toast.success(tAttr('케이스가 삭제되었습니다.'));
      qc.invalidateQueries({ queryKey: ['mdt-conference', conferenceId] });
    },
    onError: () => toast.error(tAttr('케이스 삭제에 실패했습니다.')),
  });

  const updateDecisionMut = useMutation({
    mutationFn: ({ id, data: body }: { id: string; data: DecisionFormData }) =>
      apiClient.patch(`/api/v1/mdt/cases/${id}`, body),
    onSuccess: () => {
      toast.success(tAttr('결정이 기록되었습니다.'));
      qc.invalidateQueries({ queryKey: ['mdt-conference', conferenceId] });
      setEditDecisionId(null);
    },
    onError: () => toast.error(tAttr('결정 기록에 실패했습니다.')),
  });

  /**
   * AI 임상요약 **초안** 생성 — 서버 응답 계약 `{ data: { draft, source, reason, model } }`.
   * 🔴 종전엔 이 버튼 한 번이 곧 정본 저장이었다(서버가 clinicalSummary 에 즉시 썼다).
   *    이제는 아무것도 저장되지 않는다 — 아래 편집칸에 채워 놓고 사람이 '요약 저장'을 눌러야 기록된다.
   */
  const aiSummaryMut = useMutation({
    mutationFn: (caseId: string) =>
      apiClient.post<{ data: { draft: string | null; source: 'AI' | 'UNAVAILABLE'; reason: string | null; model: string | null; patientId?: string | null; proposalId?: string | null } }>(
        `/api/v1/mdt/cases/${caseId}/auto-summary`,
      ),
    onSuccess: async (res, caseId) => {
      type Payload = { draft?: string | null; source?: 'AI' | 'UNAVAILABLE'; reason?: string | null; model?: string | null; patientId?: string | null; proposalId?: string | null };
      // 응답 봉투가 한 겹인지 두 겹인지에 화면이 죽지 않게(P11) — 'draft' 키가 있는 층을 쓴다
      const lvl1 = (res as { data?: Payload & { data?: Payload } } | undefined)?.data;
      const payload: Payload | undefined = lvl1 && 'draft' in lvl1 ? lvl1 : lvl1?.data;
      const source = payload?.source ?? 'UNAVAILABLE';
      const draft = payload?.draft ?? null;
      if (source !== 'AI' || !draft) {
        // 산출 불가를 '요약 없음'으로 말하지 않는다 — 사유를 그대로 보여준다
        setSummaryDraft({
          caseId, patientId: payload?.patientId ?? null, text: '', originalText: '', source: 'UNAVAILABLE',
          reason: payload?.reason ?? tAttr('사유를 확인할 수 없습니다'), model: payload?.model ?? null,
          proposalId: null, provenance: null,
        });
        setRejectReason('');
        toast.error(tfAttr('{AI표기} 요약 초안 생성 불가 — {사유}', { AI표기: AI_ORIGIN_TEXT, 사유: payload?.reason ?? tAttr('사유 미상') }));
        return;
      }
      const proposalId = proposalIdFrom(payload);
      setSummaryDraft({
        caseId, patientId: payload?.patientId ?? null, text: draft, originalText: draft, source: 'AI', reason: null,
        model: payload?.model ?? null,
        proposalId,
        provenance: { source: 'GENERATOR', fields: ['임상 요약'], appliedAt: new Date().toISOString(), model: payload?.model ?? null, recorded: null, proposalId },
      });
      setRejectReason('');
      // 초안이 화면에 실제로 그려지는 시점 = 노출(presented). 사람이 봤다는 보증이 아니라 **보여줬다**는 사실이다.
      if (proposalId) await markProposalPresented(proposalId, 'mdt/임상 요약 초안');
      toast.success(tfAttr('{AI표기} 임상 요약 초안이 생성되었습니다 — 검토·수정 후 \'요약 저장\'을 누르세요.', { AI표기: AI_ORIGIN_TEXT }));
    },
    onError: () => toast.error(tfAttr('{AI표기} 요약 생성 요청에 실패했습니다.', { AI표기: AI_ORIGIN_TEXT })),
  });

  /** 임상요약 정본 쓰기 — 사람이 누르는 유일한 경로(초안 자동 저장 없음) */
  const saveSummaryMut = useMutation({
    mutationFn: ({ id, clinicalSummary }: { id: string; clinicalSummary: string }) =>
      apiClient.patch(`/api/v1/mdt/cases/${id}`, { clinicalSummary }),
    onSuccess: async (_r, vars) => {
      const d = summaryDraft;
      // 프로비넌스: MdtCase 에 AI 컬럼이 없다 → 적용 사실은 감사 원장에만 남는다(P1 AiProposal 로 승격 예정)
      // resourceType 어휘 MDT_SUMMARY 는 BE DTO(AI_DRAFT_RESOURCE_TYPES)와 같은 배포에 넣었다 — 갈라지면 400 이 조용히 난다
      if (d && d.caseId === vars.id && d.source === 'AI') {
        const recorded = await recordDraftApplied({
          resourceType: 'MDT_SUMMARY', source: 'GENERATOR', patientId: d.patientId ?? undefined,
          resourceId: vars.id, field: 'clinicalSummary', model: d.model, textLength: vars.clinicalSummary.length,
          // 🔴 사람이 정본에 저장한 이 시점이 결정 시점이다. 고쳤으면 EDITED — 수정량은 서버가 finalText 로 잰다.
          proposalId: d.proposalId,
          decision: vars.clinicalSummary === d.originalText ? 'ACCEPTED' : 'EDITED',
          finalText: vars.clinicalSummary,
          clientContext: 'mdt/요약 저장',
        });
        // 초안(배너)을 곧 지운다 — 기록 실패는 여기서 말한다
        warnIfDraftNotRecorded(recorded, tAttr);
      }
      toast.success(tAttr('임상 요약이 저장되었습니다.'));
      setSummaryDraft(null);
      setRejectReason('');
      qc.invalidateQueries({ queryKey: ['mdt-conference', conferenceId] });
    },
    onError: () => toast.error(tAttr('임상 요약 저장에 실패했습니다.')),
  });

  /**
   * 초안 버리기 = 사람이 이 초안을 쓰지 않기로 한 것 → 제안 원장에 `REJECTED`.
   * 🔴 결정 없이 화면에서만 지우면 그 제안은 나중에 `EXPIRED` 가 되어 "사람이 보지도 않았다"로 읽힌다
   *    (거부와 만료는 다른 사실이고, 섞이면 거부율이 통째로 거짓이 된다).
   * 기록 실패는 화면 동작을 막지 않는다 — 그 사실만 말한다.
   */
  const discardSummaryDraft = async () => {
    const d = summaryDraft;
    setSummaryDraft(null);
    setRejectReason('');
    if (!d?.proposalId || d.source !== 'AI') return;
    const r = await decideProposal(d.proposalId, {
      decision: 'REJECTED',
      ...(rejectReason.trim() ? { reason: rejectReason.trim() } : {}),
      clientContext: 'mdt/초안 버리기',
    });
    if (!r.ok) toast.error(tfAttr('{AI표기} 초안 거부 사실을 제안 원장에 남기지 못했습니다.', { AI표기: AI_ORIGIN_TEXT }));
  };

  const addAttendeeMut = useMutation({
    mutationFn: (d: AttendeeFormData) => apiClient.post(`/api/v1/mdt/conferences/${conferenceId}/attendees`, d),
    onSuccess: () => {
      toast.success(tAttr('참석자가 추가되었습니다.'));
      qc.invalidateQueries({ queryKey: ['mdt-conference', conferenceId] });
      setShowAddAttendee(false);
      setAttendeeForm({ userId: '', department: '', role: 'PANELIST' });
    },
    onError: () => toast.error(tAttr('참석자 추가에 실패했습니다.')),
  });

  const toggleAttendedMut = useMutation({
    mutationFn: ({ id, attended }: { id: string; attended: boolean }) =>
      apiClient.patch(`/api/v1/mdt/attendees/${id}`, { attended }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mdt-conference', conferenceId] }),
    onError: () => toast.error(tAttr('참석 상태 변경에 실패했습니다.')),
  });

  // 회의록 자동생성 — BE(POST /conferences/:id/generate-minutes)는 구현돼 있었는데
  // 🔴 부르는 화면이 0건이라 어느 경로로도 도달할 수 없었다(W7 ⑥ · EP 를 만들면 부르는 화면까지가 한 벌).
  const generateMinutesMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/mdt/conferences/${conferenceId}/generate-minutes`),
    onSuccess: () => {
      toast.success(tAttr('회의록이 생성되었습니다.'));
      qc.invalidateQueries({ queryKey: ['mdt-conference', conferenceId] });
    },
    onError: () => toast.error(tAttr('회의록 생성에 실패했습니다.')),
  });

  const updateConfMut = useMutation({
    mutationFn: (d: ConferenceFormData) => apiClient.patch(`/api/v1/mdt/conferences/${conferenceId}`, d),
    onSuccess: () => {
      toast.success(tAttr('회의 정보가 수정되었습니다.'));
      qc.invalidateQueries({ queryKey: ['mdt-conference', conferenceId] });
      qc.invalidateQueries({ queryKey: ['mdt-conferences'] });
      setShowEditConf(false);
    },
    onError: () => toast.error(tAttr('회의 수정에 실패했습니다.')),
  });

  if (isLoading) return <div className="p-12 text-center text-gray-400 text-sm"><T k="로딩 중..." /></div>;
  if (!conference) return <div className="p-12 text-center text-gray-400 text-sm"><T k="회의를 찾을 수 없습니다." /></div>;

  return (
    <div>
      {/* Back + Header */}
      <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-700 mb-4 flex items-center gap-1">
        <span>&larr;</span> <T k="목록으로 돌아가기" />
      </button>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">{conference.title}</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <Badge label={CONF_TYPE_LABEL[conference.conferenceType] ?? conference.conferenceType}
                color={CONF_TYPE_COLOR[conference.conferenceType] ?? 'bg-gray-100 text-gray-600'} />
              <StatusBadgeOf c={conference} />
              <span>{conference.department}</span>
              <span>|</span>
              <span>{fmtDateTime(conference.scheduledAt)}</span>
              {conference.location && <><span>|</span><span>{conference.location}</span></>}
              <span>|</span>
              <span><T k="의장" /> <StaffName name={conference.chairpersonName} /></span>
            </div>
            {/* 완료 처리됐지만 논의 기록이 하나도 없는 회의 — 화면이 그 사실을 말한다(W7 ⑧) */}
            {conference.status === 'COMPLETED' && cases.length === 0 && attendees.length === 0 && (
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <T k="완료로 표시돼 있으나 논의 케이스·참석자가 한 건도 기록되지 않았습니다. 실제 개최 여부를 확인하세요." />
              </p>
            )}
          </div>
          <button onClick={() => {
            setEditConfForm({
              title: conference.title,
              conferenceType: conference.conferenceType,
              department: conference.department,
              scheduledAt: conference.scheduledAt ? new Date(conference.scheduledAt).toISOString().slice(0, 16) : '',
              location: conference.location ?? '',
            });
            setShowEditConf(true);
          }}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
            <T k="수정@동작" />
          </button>
        </div>
      </div>

      {/* Cases Section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-base font-bold text-gray-900"><Tf k="케이스 ({건수})" params={{ 건수: cases.length }} /></h4>
          <button onClick={() => setShowAddCase(true)}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-xl text-xs font-medium hover:bg-blue-700 transition-colors">
            + <T k="케이스 추가" />
          </button>
        </div>

        {cases.length === 0 ? (
          <EmptyState icon="📋" title="등록된 케이스가 없습니다" />
        ) : (
          <div className="space-y-3">
            {cases.map(c => (
              <div key={c.id} className="border border-gray-100 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    {/* 🔴 종전엔 서버에 없는 c.patientName 을 읽어 환자 이름 대신 UUID 가 찍혔다(W7 ③) */}
                    <p className="text-sm font-medium text-gray-900">
                      <T k="환자" />{' '}
                      {c.patient
                        ? <PatientName familyName={c.patient.familyName} givenName={c.patient.givenName} mrn={c.patient.mrn} />
                        : <Unknown kind="UNRECORDED" />}
                      {c.tnmStage && <span className="ml-2 text-xs text-gray-500">TNM: {c.tnmStage}</span>}
                    </p>
                    <p className="text-sm text-gray-600 mt-0.5"><Tf k="진단: {진단}" params={{ 진단: c.primaryDiag }} /></p>
                    {c.proposedPlan && <p className="text-sm text-gray-500 mt-0.5"><Tf k="제안: {제안}" params={{ 제안: c.proposedPlan }} /></p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => aiSummaryMut.mutate(c.id)}
                      disabled={aiSummaryMut.isPending}
                      className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50">
                      {aiSummaryMut.isPending ? <T k="생성중..." /> : <Tf k="{AI표기} 임상 요약 초안" params={{ AI표기: AI_ORIGIN_TEXT }} />}
                    </button>
                    {editDecisionId === c.id ? null : (
                      <button onClick={() => {
                        // 기록된 분류가 없으면 빈 값(=미선택)으로 연다 — 임의 분류를 미리 채우지 않는다
                        setDecisionForm({ decision: c.decision ?? '', decisionCategory: c.decisionCategory ?? '' });
                        setEditDecisionId(c.id);
                      }}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                        <T k="결정 기록" />
                      </button>
                    )}
                    <button onClick={() => { if (confirm(tAttr('케이스를 삭제하시겠습니까?'))) deleteCaseMut.mutate(c.id); }}
                      className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                      <T k="삭제" />
                    </button>
                  </div>
                </div>

                {/* 기록된 임상 요약(정본) — 사람이 저장한 것만 여기 뜬다. AI 초안은 아래 편집칸에만 산다. */}
                {c.clinicalSummary && summaryDraft?.caseId !== c.id && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-xs font-medium text-gray-600 mb-1"><T k="임상 요약(기록됨)" /></p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.clinicalSummary}</p>
                  </div>
                )}

                {/* 🔴 초안≠확정 — 저장은 사람이 누른다. 서버는 이 글을 아직 어디에도 쓰지 않았다. */}
                {summaryDraft?.caseId === c.id && (
                  <div className="mt-2 space-y-2">
                    {summaryDraft.source === 'UNAVAILABLE' ? (
                      <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
                        <p className="font-semibold"><Tf k="{AI표기} 임상 요약 초안을 만들지 못했습니다" params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
                        <p className="mt-0.5">{summaryDraft.reason}</p>
                        <p className="mt-0.5 text-amber-700"><T k="초안이 없습니다 — 요약이 필요하면 직접 작성해 저장하세요(아래 칸)." /></p>
                      </div>
                    ) : (
                      <DraftBanner provenance={summaryDraft.provenance} signLabel="요약 저장" />
                    )}
                    <textarea
                      value={summaryDraft.text}
                      onChange={e => setSummaryDraft(p => (p && p.caseId === c.id ? { ...p, text: e.target.value } : p))}
                      rows={5}
                      placeholder={tAttr('임상 요약을 검토·수정한 뒤 저장하세요')}
                      className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none resize-y"
                    />
                    <p className="text-[11px] text-gray-500">
                      <Tf
                        k="{AI표기} 초안은 참고 정보입니다 — 최종 판단은 의료진에게 있습니다. {강조}"
                        params={{ AI표기: AI_ORIGIN_TEXT, 강조: <b><T k="저장 전까지 기록에 남지 않습니다." /></b> }}
                      />
                    </p>
                    {/* 🔴 사유는 선택이다 — 필수로 강제하면 아무 값이나 골라 통과시키는 거짓 사유가 쌓인다 */}
                    {summaryDraft.proposalId && (
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder={tAttr('버릴 경우 사유(선택 · 비워도 됩니다) — 예: 사실과 다름, 근거 부족')}
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-gray-400 focus:outline-none"
                      />
                    )}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => discardSummaryDraft()}
                        className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium text-gray-600 bg-gray-200 hover:bg-gray-300 transition-colors">
                        <T k="버리기" />
                      </button>
                      <button
                        onClick={() => saveSummaryMut.mutate({ id: c.id, clinicalSummary: summaryDraft.text.trim() })}
                        disabled={saveSummaryMut.isPending || !summaryDraft.text.trim()}
                        className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors">
                        <T k={saveSummaryMut.isPending ? '저장중...' : '요약 저장'} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Decision — 분류가 없으면 '분류 미기록'. 임의 분류로 채워 말하지 않는다 */}
                {c.decision && editDecisionId !== c.id && (
                  <div className="mt-2 flex items-center gap-2">
                    <Badge label={c.decisionCategory ? (DECISION_LABEL[c.decisionCategory] ?? c.decisionCategory) : '분류 미기록'}
                      color={DECISION_COLOR[c.decisionCategory ?? ''] ?? 'bg-gray-100 text-gray-500'} />
                    <span className="text-sm text-gray-700">{c.decision}</span>
                  </div>
                )}

                {/* Decision Edit Inline */}
                {editDecisionId === c.id && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        <T k="결정 분류" /> <span className="text-red-500">*</span>
                      </label>
                      <select value={decisionForm.decisionCategory}
                        onChange={e => setDecisionForm(p => ({ ...p, decisionCategory: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        <option value="">{tAttr('— 선택하세요 —')}</option>
                        {DECISION_OPTIONS.map(k => <option key={k} value={k}>{tAttr(DECISION_LABEL[k])}</option>)}
                      </select>
                      {!decisionForm.decisionCategory && (
                        <p className="mt-1 text-[11px] text-gray-500">
                          {/* 한 문장 한 키 — `<b>결정</b>` 은 노드 자리표시자 · 인용부호는 소스에 실문자로 둔다(엔티티 디코드 함정) */}
                          <Tf
                            k="분류를 고르지 않으면 저장할 수 없습니다. 확정하지 못했다면 ‘미분류’를 선택하세요 (‘경과관찰’은 치료하지 않기로 {강조}했다는 뜻입니다)."
                            params={{ 강조: <b><T k="결정" /></b> }}
                          />
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1"><T k="결정 내용" /></label>
                      <textarea value={decisionForm.decision}
                        onChange={e => setDecisionForm(p => ({ ...p, decision: e.target.value }))}
                        rows={2}
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                        placeholder={tAttr('MDT 결정 사항을 기록하세요')} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditDecisionId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-200 hover:bg-gray-300 transition-colors"><T k="취소" /></button>
                      <button onClick={() => updateDecisionMut.mutate({ id: c.id, data: decisionForm })}
                        disabled={updateDecisionMut.isPending || !decisionForm.decisionCategory || !decisionForm.decision.trim()}
                        className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors">
                        <T k={updateDecisionMut.isPending ? '저장중...' : '저장'} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attendees Section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-base font-bold text-gray-900"><Tf k="참석자 ({인원})" params={{ 인원: attendees.length }} /></h4>
          <button onClick={() => setShowAddAttendee(true)}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-xl text-xs font-medium hover:bg-blue-700 transition-colors">
            + <T k="참석자 추가" />
          </button>
        </div>

        {attendees.length === 0 ? (
          <EmptyState icon="🧑‍⚕️" title="등록된 참석자가 없습니다" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="이름" /></th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="진료과" /></th>
                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 w-[80px]"><T k="역할" /></th>
                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 w-[70px]"><T k="참석" /></th>
              </tr>
            </thead>
            <tbody>
              {attendees.map(a => (
                <tr key={a.id} className="border-b border-gray-50">
                  {/* 🔴 종전엔 이름이 없으면 userId(UUID)를 그대로 찍었다(W7 ④) — 서버가 해석해 준 이름만 쓴다 */}
                  <td className="px-4 py-2 text-gray-900"><StaffName name={a.userName} /></td>
                  <td className="px-4 py-2 text-gray-600">{a.department}</td>
                  <td className="px-4 py-2 text-center">
                    <Badge label={ROLE_LABEL[a.role] ?? a.role} color={ROLE_COLOR[a.role] ?? 'bg-gray-100 text-gray-600'} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input type="checkbox" checked={a.attended}
                      onChange={e => toggleAttendedMut.mutate({ id: a.id, attended: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Minutes Section — BE 는 오래전부터 있었는데 부르는 화면이 없었다(W7 ⑥) */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mt-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-base font-bold text-gray-900"><T k="회의록" /></h4>
            <p className="text-xs text-gray-400 mt-0.5">
              {conference.minutesGeneratedAt
                ? <Tf k="{일시} 자동 생성" params={{ 일시: fmtDateTime(conference.minutesGeneratedAt) }} />
                : <T k="아직 생성되지 않았습니다 — 참석자·증례·결정을 모아 회의록을 만듭니다" />}
            </p>
          </div>
          <button onClick={() => generateMinutesMut.mutate()}
            disabled={generateMinutesMut.isPending}
            className="min-h-[44px] px-3 py-2 rounded-xl text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            <T k={generateMinutesMut.isPending ? '생성 중...' : conference.minutes ? '회의록 다시 생성' : '회의록 생성'} />
          </button>
        </div>
        {conference.minutes ? (
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans bg-gray-50 border border-gray-100 rounded-xl p-4 max-h-[420px] overflow-y-auto">
            {conference.minutes}
          </pre>
        ) : (
          <EmptyState icon="📝" title="생성된 회의록이 없습니다" />
        )}
      </div>

      {/* Add Case Modal */}
      <Modal open={showAddCase} onClose={() => setShowAddCase(false)} title="케이스 추가">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="환자" /></label>
            {/* UUID 를 손으로 적게 하지 않는다 — 임상의가 환자 UUID 를 알 방법은 없다 */}
            <PatientSelector value={caseForm.patientId}
              onChange={(id) => setCaseForm(p => ({ ...p, patientId: id }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="주 진단" /></label>
            <input value={caseForm.primaryDiag} onChange={e => setCaseForm(p => ({ ...p, primaryDiag: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder={tAttr('진단명')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="TNM 병기" /></label>
            <input value={caseForm.tnmStage} onChange={e => setCaseForm(p => ({ ...p, tnmStage: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder={tAttr('예: T2N1M0')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="제안 계획" /></label>
            <textarea value={caseForm.proposedPlan} onChange={e => setCaseForm(p => ({ ...p, proposedPlan: e.target.value }))}
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" placeholder={tAttr('치료 계획 제안')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowAddCase(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"><T k="취소" /></button>
            <button onClick={() => addCaseMut.mutate(caseForm)}
              disabled={!caseForm.patientId || !caseForm.primaryDiag || addCaseMut.isPending}
              className="min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <T k={addCaseMut.isPending ? '추가 중...' : '추가'} />
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Attendee Modal */}
      <Modal open={showAddAttendee} onClose={() => setShowAddAttendee(false)} title="참석자 추가">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="직원" /></label>
            {/* 🔴 종전엔 사용자 UUID 직접 입력이라 사실상 등록 불가였다 */}
            <select value={attendeeForm.userId}
              onChange={e => {
                const picked = staffOptions.find(u => u.id === e.target.value);
                setAttendeeForm(p => ({
                  ...p,
                  userId: e.target.value,
                  department: p.department || (picked?.department ?? ''),
                }));
              }}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
              <option value="">{tAttr('선택')}</option>
              {staffOptions.map(u => (
                <option key={u.id} value={u.id}>
                  {`${u.familyName ?? ''}${u.givenName ?? ''}`.trim() || u.id}
                  {u.department ? ` · ${u.department}` : ''}{u.role ? ` · ${u.role}` : ''}
                </option>
              ))}
            </select>
            {staffIsError ? (
              <QueryErrorFallback error={staffError} onRetry={refetchStaff} size="compact" className="mt-1" />
            ) : staffOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-gray-500"><T k="등록된 직원이 없습니다." /></p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="진료과" /></label>
            <select value={attendeeForm.department} onChange={e => setAttendeeForm(p => ({ ...p, department: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
              <option value="">{tAttr('선택')}</option>
              {departmentOptions(deptMaster, staffOptions.map(u => u.department ?? undefined), attendeeForm.department).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="역할" /></label>
            <select value={attendeeForm.role} onChange={e => setAttendeeForm(p => ({ ...p, role: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{tAttr(v)}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowAddAttendee(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"><T k="취소" /></button>
            <button onClick={() => addAttendeeMut.mutate(attendeeForm)}
              disabled={!attendeeForm.userId || !attendeeForm.department || addAttendeeMut.isPending}
              className="min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <T k={addAttendeeMut.isPending ? '추가 중...' : '추가'} />
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Conference Modal */}
      <Modal open={showEditConf} onClose={() => setShowEditConf(false)} title="회의 수정">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="제목" /></label>
            <input value={editConfForm.title} onChange={e => setEditConfForm(p => ({ ...p, title: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="유형" /></label>
            <select value={editConfForm.conferenceType} onChange={e => setEditConfForm(p => ({ ...p, conferenceType: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
              {Object.entries(CONF_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{tAttr(v)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="진료과" /></label>
            <select value={editConfForm.department} onChange={e => setEditConfForm(p => ({ ...p, department: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
              <option value="">{tAttr('선택')}</option>
              {departmentOptions(deptMaster, [], editConfForm.department).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="일시" /></label>
            <input type="datetime-local" value={editConfForm.scheduledAt}
              onChange={e => setEditConfForm(p => ({ ...p, scheduledAt: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="장소" /></label>
            <input value={editConfForm.location} onChange={e => setEditConfForm(p => ({ ...p, location: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowEditConf(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"><T k="취소" /></button>
            <button onClick={() => updateConfMut.mutate(editConfForm)}
              disabled={updateConfMut.isPending}
              className="min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <T k={updateConfMut.isPending ? '저장 중...' : '저장'} />
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 3: Patient MDT History
   ═══════════════════════════════════════════════════════════════ */

function PatientHistoryTab() {
  // 🔴 종전엔 환자 UUID 를 손으로 입력하는 칸 하나뿐이었다. 임상의가 UUID 를 알 방법이 없어
  //    이 탭은 사실상 사용 불가였다(W7 ⑦). 환자 검색·선택은 병원 정본 PatientSelector 를 쓴다.
  const [activePatientId, setActivePatientId] = useState('');
  const [activePatientLabel, setActivePatientLabel] = useState('');

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['mdt-patient', activePatientId],
    queryFn: () => apiClient.get<{ data: PatientMdtRecord[] }>(`/api/v1/mdt/patient/${activePatientId}`),
    enabled: !!activePatientId,
  });

  const records: PatientMdtRecord[] = (() => {
    const raw = data?.data;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)) {
      return (raw as unknown as { data: PatientMdtRecord[] }).data ?? [];
    }
    return [];
  })();

  return (
    <div>
      {/* Search — 이름·MRN·전화번호로 찾아 선택한다 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 max-w-md">
          <PatientSelector
            value={activePatientId}
            onChange={(id, p) => {
              setActivePatientId(id);
              setActivePatientLabel(id ? `${p?.familyName ?? ''}${p?.givenName ?? ''} ${p?.mrn ?? ''}`.trim() : '');
            }}
            placeholder="환자 검색 (이름, MRN, 전화번호)"
          />
        </div>
        {activePatientId && (
          <span className="text-xs text-gray-500">{activePatientLabel}{isFetching ? <> · <T k="조회 중..." /></> : ''}</span>
        )}
      </div>

      {/* Timeline */}
      {!activePatientId ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-400 text-sm">
          <T k="환자를 검색·선택하면 MDT 이력을 보여줍니다." />
        </div>
      ) : isLoading ? (
        <div className="p-12 text-center text-gray-400 text-sm"><T k="로딩 중..." /></div>
      ) : records.length === 0 ? (
        <EmptyState icon="👤" title="해당 환자의 MDT 이력이 없습니다." className="bg-white rounded-2xl border border-gray-100 shadow-sm" />
      ) : (
        <div className="relative">
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />
          <div className="space-y-4">
            {records.map((r, idx) => (
              <div key={r.id} className="relative pl-14">
                {/* Timeline dot */}
                <div className="absolute left-4 top-4 w-4 h-4 rounded-full border-2 border-blue-500 bg-white z-10" />
                {idx === 0 && (
                  <div className="absolute left-[14px] top-0 w-6 h-4 bg-white" />
                )}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-gray-900">{r.conferenceTitle}</span>
                    <span className="text-xs text-gray-400">{fmtDate(r.conferenceDate)}</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-1"><Tf k="진단: {진단}" params={{ 진단: r.primaryDiag }} /></p>
                  {r.tnmStage && <p className="text-xs text-gray-500 mb-2">TNM: {r.tnmStage}</p>}
                  {r.decision && (
                    <div className="flex items-center gap-2 mt-2">
                      <Badge label={r.decisionCategory ? (DECISION_LABEL[r.decisionCategory] ?? r.decisionCategory) : '분류 미기록'}
                        color={DECISION_COLOR[r.decisionCategory ?? ''] ?? 'bg-gray-100 text-gray-500'} />
                      <span className="text-sm text-gray-700">{r.decision}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 4: Stats
   ═══════════════════════════════════════════════════════════════ */

function StatsTab() {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['mdt-stats'],
    queryFn: () => apiClient.get<{ data: MdtStats }>('/api/v1/mdt/stats'),
  });

  const stats: MdtStats | null = (() => {
    const raw: unknown = data?.data;
    if (!raw || typeof raw !== 'object') return null;
    if ('totalConferences' in (raw as Record<string, unknown>)) return raw as MdtStats;
    if ('data' in (raw as Record<string, unknown>)) return (raw as { data: MdtStats }).data ?? null;
    return null;
  })();

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading) return <div className="p-12 text-center text-gray-400 text-sm"><T k="로딩 중..." /></div>;
  if (!stats) return <div className="p-12 text-center text-gray-400 text-sm"><T k="통계 데이터를 불러올 수 없습니다." /></div>;

  // 🔴 서버는 { SCHEDULED: 2, COMPLETED: 2 } 객체를 준다. 종전 FE 는 배열로 알고 `.map()` 을 불러
  //    통계 탭이 열자마자 TypeError 로 죽었다(W7 ② · P11). 객체를 [코드, 건수] 쌍으로 읽는다.
  const toRows = (m: Record<string, number> | undefined) =>
    Object.entries(m ?? {})
      .filter(([, v]) => typeof v === 'number')
      .sort((a, b) => b[1] - a[1]);

  const decisionRows = toRows(stats.byDecisionCategory);
  const statusRows = toRows(stats.byStatus);
  const maxDecisionCount = Math.max(...decisionRows.map(([, v]) => v), 1);
  const maxStatusCount = Math.max(...statusRows.map(([, v]) => v), 1);

  return (
    <div>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: '총 회의 수', value: stats.totalConferences, color: 'text-blue-600', bg: 'bg-blue-50/50', hint: undefined as string | undefined },
          { label: '총 케이스', value: stats.totalCases, color: 'text-emerald-600', bg: 'bg-emerald-50/50', hint: undefined },
          {
            label: '기한 경과 미개최',
            value: stats.overdueScheduled ?? 0,
            color: (stats.overdueScheduled ?? 0) > 0 ? 'text-red-600' : 'text-gray-400',
            bg: (stats.overdueScheduled ?? 0) > 0 ? 'bg-red-50/60' : 'bg-white',
            hint: '예정일이 지났는데 아직 시작되지 않은 회의',
          },
          {
            label: '완료·기록 없음',
            value: stats.completedWithoutRecord ?? 0,
            color: (stats.completedWithoutRecord ?? 0) > 0 ? 'text-amber-600' : 'text-gray-400',
            bg: (stats.completedWithoutRecord ?? 0) > 0 ? 'bg-amber-50/60' : 'bg-white',
            hint: '완료 처리됐으나 케이스·참석자가 0건인 회의',
          },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl border border-gray-100 shadow-sm p-4`} title={s.hint ? tAttr(s.hint) : undefined}>
            <p className="text-[11px] font-medium text-gray-500 mb-1"><T k={s.label} /></p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            {s.hint && <p className="text-[10px] text-gray-400 mt-1"><T k={s.hint} /></p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Decision Category Distribution */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h4 className="text-base font-bold text-gray-900 mb-4"><T k="결정 분류별 분포" /></h4>
          {decisionRows.length === 0 ? (
            <EmptyState icon="🗂" title="기록된 케이스가 없습니다" hint="표본이 없어 분포를 낼 수 없습니다" compact />
          ) : (
            <div className="space-y-3">
              {decisionRows.map(([category, count]) => (
                <div key={category}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-700">
                      <T k={DECISION_LABEL[category] ?? category} />
                    </span>
                    <span className="text-sm font-medium text-gray-900">{count}<Unit>건</Unit></span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${(count / maxDecisionCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Conference Status Distribution */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h4 className="text-base font-bold text-gray-900 mb-4"><T k="회의 상태별 분포" /></h4>
          {statusRows.length === 0 ? (
            <EmptyState icon="📊" title="등록된 회의가 없습니다" hint="표본이 없어 분포를 낼 수 없습니다" compact />
          ) : (
            <div className="space-y-3">
              {statusRows.map(([status, count]) => (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge label={STATUS_LABEL[status] ?? status} color={STATUS_COLOR[status] ?? 'bg-gray-100 text-gray-600'} />
                      {status === 'SCHEDULED' && (stats.overdueScheduled ?? 0) > 0 && (
                        <span className="text-[11px] text-red-600"><Tf k="이 중 {건수}건은 기한 경과" params={{ 건수: stats.overdueScheduled ?? 0 }} /></span>
                      )}
                    </div>
                    <span className="text-sm font-medium text-gray-900">{count}<Unit>건</Unit></span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-emerald-500 h-2 rounded-full transition-all"
                      style={{ width: `${(count / maxStatusCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════════ */

export default function MdtPage() {
  const [tab, setTab] = useState<TabKey>('list');
  const [selectedConferenceId, setSelectedConferenceId] = useState<string | null>(null);

  const handleSelectConference = (id: string) => {
    setSelectedConferenceId(id);
    setTab('detail');
  };

  const handleBackToList = () => {
    setTab('list');
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="다학제 통합진료 (MDT)" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="다학제 팀 컨퍼런스 관리 · 케이스 토의 · 치료 결정" /></p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {TABS.map(t => {
          const isDisabled = t.key === 'detail' && !selectedConferenceId;
          return (
            <button key={t.key}
              onClick={() => !isDisabled && setTab(t.key)}
              disabled={isDisabled}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
                tab === t.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isDisabled
                    ? 'bg-gray-50 text-gray-300 border border-gray-100 cursor-not-allowed'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}>
              <span>{t.icon}</span> <T k={t.label} />
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {tab === 'list' && <ConferenceListTab onSelect={handleSelectConference} />}
      {tab === 'detail' && selectedConferenceId && (
        <ConferenceDetailTab conferenceId={selectedConferenceId} onBack={handleBackToList} />
      )}
      {tab === 'patient' && <PatientHistoryTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}
