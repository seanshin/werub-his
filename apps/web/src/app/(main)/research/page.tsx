'use client';

/**
 * 임상연구(IRB) 화면 — 2026-08 화면 실사용 점검 W7 전면 교정.
 *
 * 🔴 이 화면이 말하던 거짓말들(전부 실측 확인 후 봉합):
 *   - IRB 만료일이 화면 어디에도 없었고 만료 판정 로직도 없어 **승인은 영구 유효**였다(규제 위반 은닉).
 *   - 통계 탭은 열자마자 죽었다 — 서버는 객체(`byType:{...}`), 화면은 배열로 보고 `.map()`(P11).
 *   - 카드 6개가 서버에 없는 키를 읽어 "IRB 승인률 undefined%".
 *   - 'IRB 심의 예정'에 7개월 전 **승인 완료일**을 나열했다(`scheduledDate = irbApprovalDate`).
 *   - 승인된 연구가 '보류'로 표시됐다(리뷰 상태 3항 연쇄가 IRB 어휘를 몰랐다).
 *   - 등록 대상자 수가 실계수 0인데 500 이라고 말할 수 있었다(정본이 둘 — P12).
 *   - 책임연구자·환자명 열이 통째로 공백(BE 필드명 불일치), 문서·변경심의·대상자 등록 폼은 항상 실패.
 */

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, PatientName, Ratio, StaffName, Unit, Unknown } from '@/components/ui/display';

/* ═══════════════════════════════════════════════════════════════
   Types — 서버 응답 계약과 1:1 (임의 개명 금지: 계약 불일치의 근원)
   ═══════════════════════════════════════════════════════════════ */

interface StaffRef {
  id: string;
  familyName: string;
  givenName: string;
  department?: string | null;
}

type IrbValidityState =
  | 'NOT_APPROVED'
  | 'NO_EXPIRY_ON_RECORD'
  | 'VALID'
  | 'EXPIRING_SOON'
  | 'EXPIRED';

interface IrbValidity {
  state: IrbValidityState;
  expiryDate: string | null;
  daysLeft: number | null;
  reason: string;
}

interface Study {
  id: string;
  studyNo: string;
  title: string;
  piUserId: string;
  pi: StaffRef | null;
  department: string;
  studyType: string;
  phase?: string | null;
  sponsor?: string | null;
  irbStatus: string;
  irbApprovalDate?: string | null;
  irbExpiryDate?: string | null;
  irbValidity: IrbValidity;
  targetEnroll?: number | null;
  /** research_subjects 실계수 — 등록 현황의 정본 */
  subjectCount: number;
  activeSubjectCount: number;
  /** current_enroll 저장 카운터(참고값) */
  storedEnroll: number;
  enrollMismatch: boolean;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  createdAt?: string;
}

interface StudyDetail extends Omit<Study, 'subjectCount' | 'activeSubjectCount'> {
  subjectCount: number;
  activeSubjectCount: number;
  documents?: StudyDocument[];
  amendments?: Amendment[];
}

interface StudyDocument {
  id: string;
  studyId: string;
  docType: string;
  version: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: string;
  uploadedBy: string;
  uploader: StaffRef | null;
}

interface Amendment {
  id: string;
  studyId: string;
  amendmentNo: number;
  reason: string;
  changes?: Record<string, unknown> | null;
  status: string;
  submittedAt: string;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

interface Subject {
  id: string;
  subjectNo: string;
  patientId: string;
  patient?: { id: string; familyName: string; givenName: string; dateOfBirth?: string; gender?: string } | null;
  consentDate: string;
  status: string;
  armGroup?: string | null;
  studyId: string;
  withdrawDate?: string | null;
  withdrawReason?: string | null;
}

/** 연구별 IRB 심의 '상태' — 예정 심의가 아니다 */
interface IrbReview {
  id: string;
  studyId: string;
  studyNo: string;
  studyTitle: string;
  department: string;
  studyType: string;
  reviewType: string;
  irbStatus: string;
  submittedAt: string;
  approvalDate?: string | null;
  expiryDate?: string | null;
  irbValidity: IrbValidity;
  result?: string | null;
}

/** 진짜 예정 심의(SUBMITTED/UNDER_REVIEW) — 개최 예정일은 시스템에 없다 */
interface IrbCalendarItem {
  studyId: string;
  studyNo: string;
  title: string;
  status: string;
  department: string;
  submittedAt: string;
  daysWaiting: number;
  scheduledDate: string | null;
}

interface ResearchStats {
  totalStudies: number;
  activeStudies: number;
  totalSubjects: number;
  storedEnrollTotal: number;
  enrollMismatch: boolean;
  pendingReviews: number;
  /** 분모 0 이면 null — '산출 불가'. 0 으로 그리면 "전부 반려"로 읽힌다 */
  approvalRate: number | null;
  approvalBasis: { approved: number; rejected: number; decided: number };
  enrollmentRate: number | null;
  enrollmentBasis: { enrolled: number; target: number };
  irbExpiry: { expired: number; expiringSoon: number; noExpiryOnRecord: number };
  byType: { type: string; count: number }[];
  byStatus: { status: string; count: number }[];
  monthlyEnrollment: { month: string; count: number }[];
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'list', label: '연구 목록', icon: '📋' },
  { key: 'detail', label: '연구 상세', icon: '🔬' },
  { key: 'subjects', label: '대상자 관리', icon: '👥' },
  { key: 'irb', label: 'IRB 심의', icon: '⚖️' },
  { key: 'stats', label: '통계', icon: '📊' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/* 🔴 IRB/연구 어휘는 아직 shared 상태 정본(StatusBadge domain)에 등재되지 않았다.
 *    등재 전까지는 이 파일 한 곳에서만 정의하고, 화면 어디서도 재정의하지 않는다.
 *    (UX 규약상 최종 목적지는 shared + <StatusBadge domain="irb"> — 보고서 '스펙 변경' 참조) */
const STUDY_TYPE_COLOR: Record<string, string> = {
  INTERVENTIONAL: 'bg-blue-100 text-blue-700',
  OBSERVATIONAL: 'bg-emerald-100 text-emerald-700',
  RETROSPECTIVE: 'bg-sky-100 text-sky-700',
  REGISTRY: 'bg-purple-100 text-purple-700',
  EXPANDED_ACCESS: 'bg-amber-100 text-amber-700',
  OTHER: 'bg-gray-100 text-gray-600',
};
const STUDY_TYPE_LABEL: Record<string, string> = {
  INTERVENTIONAL: '중재연구',
  OBSERVATIONAL: '관찰연구',
  // 🔴 실데이터에 있는 유형인데 라벨·필터 선택지가 없어 회색 raw 로 뜨고 필터로는 찾을 수 없었다
  RETROSPECTIVE: '후향적연구',
  REGISTRY: '레지스트리',
  EXPANDED_ACCESS: '확대접근',
  OTHER: '기타',
};

const IRB_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  UNDER_REVIEW: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  TERMINATED: 'bg-red-200 text-red-800',
  CLOSED: 'bg-gray-200 text-gray-700',
  COMPLETED: 'bg-gray-200 text-gray-700',
};
const IRB_STATUS_LABEL: Record<string, string> = {
  DRAFT: '초안',
  SUBMITTED: '제출',
  UNDER_REVIEW: '심의중',
  APPROVED: '승인',
  REJECTED: '반려',
  SUSPENDED: '보류',
  TERMINATED: '종료',
  // close() 가 쓰는 값 — 종전 표에 없어 회색 'CLOSED' 로 샜다
  CLOSED: '연구종료',
  COMPLETED: '완료',
};

const SUBJECT_STATUS_COLOR: Record<string, string> = {
  SCREENING: 'bg-blue-100 text-blue-700',
  ENROLLED: 'bg-emerald-100 text-emerald-700',
  ACTIVE: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-gray-200 text-gray-700',
  WITHDRAWN: 'bg-red-100 text-red-700',
  SCREEN_FAILURE: 'bg-orange-100 text-orange-700',
};
const SUBJECT_STATUS_LABEL: Record<string, string> = {
  SCREENING: '스크리닝',
  ENROLLED: '등록',
  ACTIVE: '참여중',
  COMPLETED: '완료',
  WITHDRAWN: '철회',
  SCREEN_FAILURE: '스크리닝실패',
};

const IRB_VALIDITY_UI: Record<IrbValidityState, { label: string; cls: string }> = {
  NOT_APPROVED: { label: '해당 없음', cls: 'bg-gray-100 text-gray-500' },
  // 🔴 '유효'로 낙착시키지 않는다 — 만료일을 모른다는 사실 자체가 관리 대상이다
  NO_EXPIRY_ON_RECORD: { label: '만료일 미등록', cls: 'bg-amber-100 text-amber-800' },
  VALID: { label: '유효', cls: 'bg-emerald-100 text-emerald-700' },
  EXPIRING_SOON: { label: '만료 임박', cls: 'bg-orange-100 text-orange-800' },
  EXPIRED: { label: '만료', cls: 'bg-red-100 text-red-700' },
};

const DOC_TYPE_LABEL: Record<string, string> = {
  PROTOCOL: '프로토콜',
  ICF: '동의서 (ICF)',
  CRF: '증례기록서 (CRF)',
  IB: '연구자자료집 (IB)',
  APPROVAL: 'IRB 승인서',
  OTHER: '기타',
};

const PHASE_OPTIONS = ['Phase I', 'Phase II', 'Phase III', 'Phase IV'];

function fmtDate(d?: string | null) { return d ? kdate(d) : '-'; }

function IrbValidityBadge({ v, className = '' }: { v?: IrbValidity | null; className?: string }) {
  if (!v) return <Unknown kind="UNRECORDED" className={className} />;
  const ui = IRB_VALIDITY_UI[v.state] ?? IRB_VALIDITY_UI.NOT_APPROVED;
  return (
    <span title={v.reason} className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${ui.cls} ${className}`}>
      <T k={ui.label} />
      {v.expiryDate && <span className="ml-1 opacity-70">{v.expiryDate}</span>}
    </span>
  );
}

/** 등록 현황 — 실계수를 말하고, 저장 카운터와 다르면 그 사실을 숨기지 않는다 */
function EnrollCell({ s }: { s: Pick<Study, 'subjectCount' | 'storedEnroll' | 'enrollMismatch' | 'targetEnroll'> }) {
  const target = s.targetEnroll ?? 0;
  const pct = target > 0 ? (s.subjectCount / target) * 100 : null;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-[60px]">
        <div
          className={`h-2 rounded-full transition-all ${pct == null ? 'bg-gray-200' : pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-400'}`}
          style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-500 whitespace-nowrap">
        {s.subjectCount}
        {target > 0 ? `/${target}` : <span className="text-gray-400"> <T k="/ 목표 미설정" /></span>}
      </span>
      {s.enrollMismatch && (
        <span
          className="text-[10px] text-amber-600 cursor-help"
          title={`저장 카운터(current_enroll) ${s.storedEnroll}건 ↔ 실제 대상자 ${s.subjectCount}건 — 불일치. 화면은 실계수를 말합니다.`}
        >
          ⚠
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Schemas
   ═══════════════════════════════════════════════════════════════ */

const studySchema = z.object({
  title: z.string().min(1, '연구 제목을 입력하세요'),
  /** 🔴 종전엔 자유 텍스트 piName 을 받아 서버가 버렸다 — 실존 계정 UUID 를 고른다 */
  piUserId: z.string().min(1, '연구책임자를 선택하세요'),
  department: z.string().min(1, '진료과를 입력하세요'),
  studyType: z.string().min(1, '연구 유형을 선택하세요'),
  phase: z.string().optional(),
  sponsor: z.string().optional(),
  targetEnroll: z.coerce.number().int().positive('목표 등록 수를 입력하세요'),
  startDate: z.string().min(1, '시작일을 입력하세요'),
  endDate: z.string().optional(),
  description: z.string().optional(),
});
type StudyForm = z.infer<typeof studySchema>;

/** 문서는 BE 필수 4필드(docType/version/fileName/fileUrl) 그대로 받는다 */
const documentSchema = z.object({
  docType: z.string().min(1, '문서 유형을 선택하세요'),
  version: z.string().min(1, '버전을 입력하세요'),
  fileName: z.string().min(1, '파일명을 입력하세요'),
  fileUrl: z.string().min(1, '파일 경로(URL)를 입력하세요'),
});
type DocumentForm = z.infer<typeof documentSchema>;

/** 변경심의는 BE 필수 reason 을 받는다(종전엔 미전송이라 항상 실패) */
const amendmentSchema = z.object({
  studyId: z.string().min(1, '연구를 선택하세요'),
  version: z.string().optional(),
  reason: z.string().min(1, '변경 사유·내용을 입력하세요'),
});
type AmendmentForm = z.infer<typeof amendmentSchema>;

const subjectSchema = z.object({
  patientId: z.string().uuid('환자 검색에서 대상을 선택하세요'),
  consentDate: z.string().min(1, '동의일을 입력하세요'),
  armGroup: z.string().optional(),
});
type SubjectForm = z.infer<typeof subjectSchema>;

const withdrawSchema = z.object({
  reason: z.string().min(1, '중도탈락 사유는 필수입니다'),
});
type WithdrawForm = z.infer<typeof withdrawSchema>;

/* ═══════════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════════ */

export default function ResearchPage() {
  const [tab, setTab] = useState<TabKey>('list');
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);

  const handleSelectStudy = (id: string) => {
    setSelectedStudyId(id);
    setTab('detail');
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="임상연구 (IRB)" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="연구과제 관리 / IRB 심의 / 대상자 관리 / 통계" /></p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
              tab === t.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}>
            <span>{t.icon}</span> <T k={t.label} />
          </button>
        ))}
      </div>

      {tab === 'list' && <StudyListTab onSelect={handleSelectStudy} />}
      {tab === 'detail' && <StudyDetailTab studyId={selectedStudyId} />}
      {tab === 'subjects' && <SubjectsTab studyId={selectedStudyId} />}
      {tab === 'irb' && <IrbReviewTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 1 — 연구 목록
   ═══════════════════════════════════════════════════════════════ */

function StudyListTab({ onSelect }: { onSelect: (id: string) => void }) {
  const tAttr = useTAttr();
  const [showModal, setShowModal] = useState(false);
  const [filterDept, setFilterDept] = useState('전체');
  const [filterStatus, setFilterStatus] = useState('전체');
  const [filterType, setFilterType] = useState('전체');
  const [filterValidity, setFilterValidity] = useState('전체');
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['research-studies'],
    queryFn: () => apiClient.get<{ data: Study[] }>('/api/v1/research'),
  });

  const studies: Study[] = useMemo(() => data?.data ?? [], [data]);

  // 🔴 진료과 선택지를 상수로 박아두었더니(내과/외과/…) 실데이터(순환기내과·호흡기내과·신장내과)와
  //    한 건도 일치하지 않아 필터를 건드리는 순간 연구가 전멸했다. 선택지는 실데이터에서 만든다.
  const deptOptions = useMemo(
    () => ['전체', ...Array.from(new Set(studies.map(s => s.department).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'))],
    [studies],
  );
  // 유형·상태도 같은 이유로 '표에 있는 것 + 데이터에 있는 것'의 합집합으로 만든다(숨는 행 0).
  const typeOptions = useMemo(
    () => Array.from(new Set([...Object.keys(STUDY_TYPE_LABEL), ...studies.map(s => s.studyType)])),
    [studies],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set([...Object.keys(IRB_STATUS_LABEL), ...studies.map(s => s.irbStatus)])),
    [studies],
  );

  const filtered = useMemo(() => {
    return studies.filter(s => {
      if (filterDept !== '전체' && s.department !== filterDept) return false;
      if (filterStatus !== '전체' && s.irbStatus !== filterStatus) return false;
      if (filterType !== '전체' && s.studyType !== filterType) return false;
      if (filterValidity !== '전체' && s.irbValidity?.state !== filterValidity) return false;
      return true;
    });
  }, [studies, filterDept, filterStatus, filterType, filterValidity]);

  const alerts = useMemo(() => ({
    expired: studies.filter(s => s.irbValidity?.state === 'EXPIRED').length,
    soon: studies.filter(s => s.irbValidity?.state === 'EXPIRING_SOON').length,
    noExpiry: studies.filter(s => s.irbValidity?.state === 'NO_EXPIRY_ON_RECORD').length,
  }), [studies]);

  const { data: doctorsData, isError: doctorsIsError, error: doctorsError, refetch: refetchDoctors } = useQuery({
    queryKey: ['research-doctors'],
    queryFn: () => apiClient.get<{ data: StaffRef[] }>('/api/v1/users/doctors'),
  });
  const doctors = doctorsData?.data ?? [];

  const form = useForm<StudyForm>({ resolver: zodResolver(studySchema) });

  const createMut = useMutation({
    mutationFn: (body: StudyForm) => apiClient.post<{ data: Study }>('/api/v1/research', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-studies'] });
      toast.success('연구가 등록되었습니다');
      setShowModal(false);
      form.reset();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '연구 등록에 실패했습니다'),
  });

  // 모든 hook 호출 이후에 조건부 return (hooks 규칙 — React #300 방지)
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <>
      {/* 🔴 규제 경보 — 만료된 승인으로 진행 중인 연구는 목록을 스크롤하기 전에 보여야 한다 */}
      {(alerts.expired > 0 || alerts.soon > 0 || alerts.noExpiry > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs">
          <span className="font-bold text-amber-900"><T k="IRB 승인 유효성" /></span>
          {alerts.expired > 0 && (
            <button onClick={() => setFilterValidity('EXPIRED')} className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
              <T k="만료" /> {alerts.expired}<T k="건" />
            </button>
          )}
          {alerts.soon > 0 && (
            <button onClick={() => setFilterValidity('EXPIRING_SOON')} className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800">
              <T k="30일 내 만료" /> {alerts.soon}<T k="건" />
            </button>
          )}
          {alerts.noExpiry > 0 && (
            <button
              onClick={() => setFilterValidity('NO_EXPIRY_ON_RECORD')}
              title={tAttr("승인 기록에 만료일이 없어 유효 여부를 판정할 수 없습니다 — '유효'가 아닙니다")}
              className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800"
            >
              <T k="만료일 미등록" /> {alerts.noExpiry}<T k="건" />
            </button>
          )}
          {filterValidity !== '전체' && (
            <button onClick={() => setFilterValidity('전체')} className="ml-auto text-amber-700 underline"><T k="필터 해제" /></button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
          {deptOptions.map(d => <option key={d} value={d}><T k={d === '전체' ? '진료과 전체' : d} /></option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
          <option value="전체">{tAttr('IRB 상태 전체')}</option>
          {statusOptions.map(k => <option key={k} value={k}>{tAttr(IRB_STATUS_LABEL[k] ?? k)}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
          <option value="전체">{tAttr('연구 유형 전체')}</option>
          {typeOptions.map(k => <option key={k} value={k}>{tAttr(STUDY_TYPE_LABEL[k] ?? k)}</option>)}
        </select>
        <select value={filterValidity} onChange={e => setFilterValidity(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
          <option value="전체">{tAttr('승인 유효성 전체')}</option>
          {(Object.keys(IRB_VALIDITY_UI) as IrbValidityState[]).map(k => (
            <option key={k} value={k}>{tAttr(IRB_VALIDITY_UI[k].label)}</option>
          ))}
        </select>
        <button onClick={() => setShowModal(true)}
          className="ml-auto px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
          <T k="+ 연구 등록" />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="연구번호" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="연구제목" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="책임연구자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진료과" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="연구유형" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Phase</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="IRB 상태" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="승인 만료" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="등록 현황" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !filtered.length ? (
              <tr><td colSpan={9} className="py-16 text-center text-gray-400">
                <T k={studies.length ? '조건에 맞는 연구가 없습니다' : '등록된 연구가 없습니다'} />
              </td></tr>
            ) : (
              filtered.map(s => (
                <tr key={s.id} onClick={() => onSelect(s.id)}
                  className="border-b border-gray-50 hover:bg-blue-50/50 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{s.studyNo}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 truncate max-w-[280px]">{s.title}</p>
                  </td>
                  {/* 🔴 종전엔 존재하지 않는 s.piName 을 읽어 열 전체가 공백이었다 */}
                  <td className="px-4 py-3 text-gray-700">
                    <StaffName familyName={s.pi?.familyName} givenName={s.pi?.givenName} department={s.pi?.department} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.department}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STUDY_TYPE_COLOR[s.studyType] ?? 'bg-gray-100 text-gray-600'}`}>
                      <T k={STUDY_TYPE_LABEL[s.studyType] ?? s.studyType} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-600">{s.phase || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${IRB_STATUS_COLOR[s.irbStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                      <T k={IRB_STATUS_LABEL[s.irbStatus] ?? s.irbStatus} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center"><IrbValidityBadge v={s.irbValidity} /></td>
                  <td className="px-4 py-3"><EnrollCell s={s} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 연구 등록 Modal */}
      {showModal && (
        <Modal title="연구 등록" onClose={() => setShowModal(false)}>
          <form onSubmit={form.handleSubmit(d => createMut.mutate(d))} className="space-y-4">
            <Field label="연구 제목" error={form.formState.errors.title?.message}>
              <input {...form.register('title')} className={INPUT} placeholder={tAttr('연구 제목')} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              {/* 🔴 자유 텍스트 이름은 서버에서 버려졌다 — 실존 의사 계정을 고른다 */}
              <Field label="연구책임자 (PI)" error={form.formState.errors.piUserId?.message}>
                <select {...form.register('piUserId')} className={INPUT}>
                  <option value="">{tAttr('선택')}</option>
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.familyName}{d.givenName}{d.department ? ` · ${d.department}` : ''}</option>
                  ))}
                </select>
                {doctorsIsError
                  ? <QueryErrorFallback error={doctorsError} onRetry={() => refetchDoctors()} size="compact" className="mt-1" />
                  : !doctors.length && <p className="mt-1 text-[10px] text-gray-400"><T k="선택할 수 있는 의사 계정이 없습니다" /></p>}
              </Field>
              {/* 🔴 진료과 상수 목록은 실데이터와 어긋났다 — 기존 값 제안 + 자유 입력 */}
              <Field label="진료과" error={form.formState.errors.department?.message}>
                <input {...form.register('department')} list="research-dept-options" className={INPUT} placeholder={tAttr('예: 순환기내과')} />
                <datalist id="research-dept-options">
                  {deptOptions.filter(d => d !== '전체').map(d => <option key={d} value={d} />)}
                </datalist>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="연구 유형" error={form.formState.errors.studyType?.message}>
                <select {...form.register('studyType')} className={INPUT}>
                  <option value="">{tAttr('선택')}</option>
                  {Object.entries(STUDY_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Phase">
                <select {...form.register('phase')} className={INPUT}>
                  <option value="">{tAttr('해당 없음')}</option>
                  {PHASE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="목표 등록 수" error={form.formState.errors.targetEnroll?.message}>
                <input {...form.register('targetEnroll')} type="number" className={INPUT} placeholder="100" />
              </Field>
              <Field label="의뢰자 (Sponsor)">
                <input {...form.register('sponsor')} className={INPUT} placeholder={tAttr('선택')} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="시작일" error={form.formState.errors.startDate?.message}>
                <input {...form.register('startDate')} type="date" className={INPUT} />
              </Field>
              <Field label="종료일">
                <input {...form.register('endDate')} type="date" className={INPUT} />
              </Field>
            </div>
            <Field label="연구 개요">
              <textarea {...form.register('description')} className={`${INPUT} min-h-[80px]`} placeholder={tAttr('연구 개요 (선택)')} />
            </Field>
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
              <T k="등록 시 IRB 상태는" /> <b><T k="제출" /></b><T k="로 시작합니다. 승인 만료일은 승인 처리 시" /> <b><T k="승인서에 적힌 날짜" /></b><T k="를 입력합니다 (시스템이 임의로 1년을 부여하지 않습니다)." />
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className={BTN_GHOST}><T k="취소" /></button>
              <button type="submit" disabled={createMut.isPending} className={BTN_PRIMARY}>
                <T k={createMut.isPending ? '등록 중...' : '등록'} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 2 — 연구 상세
   ═══════════════════════════════════════════════════════════════ */

function StudyDetailTab({ studyId }: { studyId: string | null }) {
  const tAttr = useTAttr();
  const [showDocModal, setShowDocModal] = useState(false);
  const [showAmendModal, setShowAmendModal] = useState(false);
  const qc = useQueryClient();

  const { data: studyData, isLoading } = useQuery({
    queryKey: ['research-study', studyId],
    queryFn: () => apiClient.get<{ data: StudyDetail }>(`/api/v1/research/${studyId}`),
    enabled: !!studyId,
  });

  const { data: docsData } = useQuery({
    queryKey: ['research-documents', studyId],
    queryFn: () => apiClient.get<{ data: StudyDocument[] }>(`/api/v1/research/${studyId}/documents`),
    enabled: !!studyId,
  });

  const { data: amendsData } = useQuery({
    queryKey: ['research-amendments', studyId],
    queryFn: () => apiClient.get<{ data: Amendment[] }>(`/api/v1/research/${studyId}/amendments`),
    enabled: !!studyId,
  });

  const { data: chartData } = useQuery({
    queryKey: ['research-enrollment-chart', studyId],
    queryFn: () => apiClient.get<{ data: { month: string; enrolled: number; cumulative: number }[] }>(`/api/v1/research/${studyId}/enrollment-chart`),
    enabled: !!studyId,
  });

  const study = studyData?.data;
  const documents = docsData?.data ?? [];
  const amendments = amendsData?.data ?? [];
  const chart = chartData?.data ?? [];

  const docForm = useForm<DocumentForm>({ resolver: zodResolver(documentSchema) });
  const amendForm = useForm<AmendmentForm>({
    resolver: zodResolver(amendmentSchema),
    defaultValues: { studyId: studyId ?? '' },
  });

  const addDocMut = useMutation({
    mutationFn: (body: DocumentForm) => apiClient.post(`/api/v1/research/${studyId}/documents`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-documents', studyId] });
      toast.success('문서가 추가되었습니다');
      setShowDocModal(false);
      docForm.reset();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '문서 추가에 실패했습니다'),
  });

  const addAmendMut = useMutation({
    // 🔴 BE 계약은 {reason, changes} — 종전엔 {version, description} 을 보내 reason 누락으로 항상 실패했다
    mutationFn: (body: AmendmentForm) =>
      apiClient.post(`/api/v1/research/${studyId}/amendments`, {
        reason: body.reason,
        changes: body.version ? { version: body.version } : {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-amendments', studyId] });
      toast.success('변경사항이 등록되었습니다');
      setShowAmendModal(false);
      amendForm.reset({ studyId: studyId ?? '' });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '변경사항 등록에 실패했습니다'),
  });

  if (!studyId) {
    return <div className="text-center py-16 text-gray-400"><T k="연구 목록에서 연구를 선택하세요" /></div>;
  }
  if (isLoading) {
    return <div className="text-center py-16 text-gray-400"><T k="불러오는 중..." /></div>;
  }
  if (!study) {
    return <div className="text-center py-16 text-gray-400"><T k="연구 정보를 찾을 수 없습니다" /></div>;
  }

  const target = study.targetEnroll ?? 0;
  const pct = target > 0 ? (study.subjectCount / target) * 100 : null;

  return (
    <div className="space-y-6">
      {/* Study Info Card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between mb-4 gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{study.title}</h3>
            <p className="text-sm text-gray-500 mt-1">{study.studyNo}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap ${IRB_STATUS_COLOR[study.irbStatus] ?? 'bg-gray-100 text-gray-600'}`}>
              <T k={IRB_STATUS_LABEL[study.irbStatus] ?? study.irbStatus} />
            </span>
            <IrbValidityBadge v={study.irbValidity} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500"><T k="책임연구자" /></span><p className="font-medium text-gray-900 mt-0.5">
            <StaffName familyName={study.pi?.familyName} givenName={study.pi?.givenName} department={study.pi?.department} />
          </p></div>
          <div><span className="text-gray-500"><T k="진료과" /></span><p className="font-medium text-gray-900 mt-0.5">{study.department}</p></div>
          <div><span className="text-gray-500"><T k="연구유형" /></span><p className="font-medium text-gray-900 mt-0.5"><T k={STUDY_TYPE_LABEL[study.studyType] ?? study.studyType} /></p></div>
          <div><span className="text-gray-500">Phase</span><p className="font-medium text-gray-900 mt-0.5">{study.phase || '-'}</p></div>
          <div><span className="text-gray-500"><T k="시작일" /></span><p className="font-medium text-gray-900 mt-0.5">{fmtDate(study.startDate)}</p></div>
          <div><span className="text-gray-500"><T k="종료일" /></span><p className="font-medium text-gray-900 mt-0.5">{fmtDate(study.endDate)}</p></div>
          <div><span className="text-gray-500"><T k="IRB 승인일" /></span><p className="font-medium text-gray-900 mt-0.5">{fmtDate(study.irbApprovalDate)}</p></div>
          {/* 🔴 스키마에는 있었지만 응답 매핑에서 탈락해 화면에 한 번도 나온 적 없던 값 */}
          <div>
            <span className="text-gray-500"><T k="IRB 만료일" /></span>
            <p className="font-medium text-gray-900 mt-0.5">
              {study.irbExpiryDate
                ? fmtDate(study.irbExpiryDate)
                : <span className="text-amber-700" title={study.irbValidity?.reason}><T k="미등록" /></span>}
            </p>
          </div>
        </div>
        {study.irbValidity?.state === 'EXPIRED' && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            <T k="IRB 승인이 만료되었습니다(" />{study.irbValidity.reason}<T k="). 갱신 심의 전까지 대상자 신규 등록·중재 시행을 중단해야 합니다." />
          </p>
        )}
        {study.irbValidity?.state === 'NO_EXPIRY_ON_RECORD' && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            <T k="승인 기록에 만료일이 없습니다. 유효 여부를 시스템이 판정할 수 없으니 승인서의 만료일을 등록하세요." />
          </p>
        )}
      </div>

      {/* 연구 개요 */}
      {study.description && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h4 className="text-sm font-bold text-gray-900 mb-2"><T k="연구 개요" /></h4>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{study.description}</p>
        </div>
      )}

      {/* 등록 현황 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="등록 현황" /></h4>
        <div className="flex items-center gap-4 mb-3">
          <div className="flex-1 bg-gray-100 rounded-full h-4">
            <div className={`h-4 rounded-full transition-all ${pct == null ? 'bg-gray-200' : pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-400'}`}
              style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
          </div>
          {/* 🔴 비율은 분모(목표 등록 수)와 함께 — 목표 미설정이면 `<Ratio>` 가 '산출 불가'를 그린다 */}
          <Ratio numerator={study.subjectCount} denominator={target} className="text-sm font-bold text-gray-700" unavailableHint="목표 등록 수 미설정" />
        </div>
        <p className="text-xs text-gray-500">
          <T k="실제 등록" /> {study.subjectCount}<Unit><T k="명" /></Unit>
          {' · '}<T k="참여중" /> {study.activeSubjectCount}<Unit><T k="명" /></Unit>
          {' / '}<T k="목표" /> {target > 0 ? <>{target}<Unit><T k="명" /></Unit></> : '미설정'}
        </p>
        {study.enrollMismatch && (
          // 🔴 정본이 둘이던 자리 — 저장 카운터를 지우지 않고 불일치를 드러낸다(과거 기록 변조 금지)
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <T k="저장 카운터(current_enroll)" /> <b>{study.storedEnroll}</b><T k="건과 실제 대상자" /> <b>{study.subjectCount}</b><T k="건이 다릅니다. 화면은" /> <b><T k="실제 대상자 수" /></b><T k="를 기준으로 표시합니다. 저장 카운터는 확인 후 정정이 필요합니다." />
          </p>
        )}
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-500 mb-2"><T k="월별 등록 추이" /></p>
          {chart.length ? (
            <div className="flex items-end gap-2 h-40">
              {chart.map(m => {
                const maxM = Math.max(...chart.map(x => x.enrolled), 1);
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-gray-700">{m.enrolled}</span>
                    <div className="w-full bg-blue-400 rounded-t-md transition-all" style={{ height: `${Math.max((m.enrolled / maxM) * 100, 4)}%` }} />
                    <span className="text-[9px] text-gray-500">{m.month}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-24 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400 text-sm border border-dashed border-gray-200">
              <T k="등록된 대상자가 없습니다" />
            </div>
          )}
        </div>
      </div>

      {/* Documents */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold text-gray-900"><T k="문서 목록" /></h4>
          <button onClick={() => setShowDocModal(true)}
            className="text-xs px-3 py-1.5 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors font-medium">
            <T k="+ 문서 추가" />
          </button>
        </div>
        {!documents.length ? (
          <EmptyState icon="📄" title="등록된 문서가 없습니다" />
        ) : (
          <div className="space-y-2">
            {documents.map(doc => (
              <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    <T k={DOC_TYPE_LABEL[doc.docType] ?? doc.docType} /> · {doc.fileName}
                    <span className="ml-2 text-[10px] text-gray-500">v{doc.version}</span>
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {fmtDate(doc.uploadedAt)} <T k="/ 업로드" />{' '}
                    {/* 🔴 종전엔 uploadedBy(UUID) 를 그대로 찍었다 */}
                    <StaffName familyName={doc.uploader?.familyName} givenName={doc.uploader?.givenName} />
                  </p>
                </div>
                {doc.fileUrl && (
                  <a href={doc.fileUrl} target="_blank" rel="noreferrer"
                    className="text-[10px] px-2 py-1 text-blue-600 bg-blue-50 rounded-lg font-medium whitespace-nowrap"><T k="열기" /></a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Amendments */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold text-gray-900"><T k="변경사항 (Amendment)" /></h4>
          <button onClick={() => { amendForm.setValue('studyId', studyId); setShowAmendModal(true); }}
            className="text-xs px-3 py-1.5 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors font-medium">
            <T k="+ 변경사항 추가" />
          </button>
        </div>
        {!amendments.length ? (
          <EmptyState icon="📋" title="변경사항이 없습니다" />
        ) : (
          <div className="space-y-2">
            {amendments.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    <T k="변경 #" />{a.amendmentNo}
                    {typeof a.changes?.version === 'string' && <span className="ml-2 text-[10px] text-gray-500">v{a.changes.version}</span>}
                  </p>
                  <p className="text-xs text-gray-700 mt-0.5 whitespace-pre-wrap">{a.reason}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    <T k="제출:" /> {fmtDate(a.submittedAt)}
                    {a.reviewedAt ? ` / 심의: ${fmtDate(a.reviewedAt)}` : ' / 심의 전'}
                    {a.reviewNote ? ` / ${a.reviewNote}` : ''}
                  </p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                  a.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700'
                    : a.status === 'REJECTED' ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
                }`}><T k={a.status === 'APPROVED' ? '승인' : a.status === 'REJECTED' ? '반려' : '심의중'} /></span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Document Add Modal — BE 필수 4필드를 그대로 받는다 */}
      {showDocModal && (
        <Modal title="문서 추가" onClose={() => setShowDocModal(false)}>
          <form onSubmit={docForm.handleSubmit(d => addDocMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="문서 유형" error={docForm.formState.errors.docType?.message}>
                <select {...docForm.register('docType')} className={INPUT}>
                  <option value="">{tAttr('선택')}</option>
                  {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="버전" error={docForm.formState.errors.version?.message}>
                <input {...docForm.register('version')} className={INPUT} placeholder="1.0" />
              </Field>
            </div>
            <Field label="파일명" error={docForm.formState.errors.fileName?.message}>
              <input {...docForm.register('fileName')} className={INPUT} placeholder="protocol_v1.0.pdf" />
            </Field>
            <Field label="파일 경로 (URL)" error={docForm.formState.errors.fileUrl?.message}>
              <input {...docForm.register('fileUrl')} className={INPUT} placeholder={tAttr('/uploads/research/... 또는 문서관리 링크')} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowDocModal(false)} className={BTN_GHOST}><T k="취소" /></button>
              <button type="submit" disabled={addDocMut.isPending} className={BTN_PRIMARY}>
                <T k={addDocMut.isPending ? '추가 중...' : '추가'} />
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Amendment Add Modal */}
      {showAmendModal && (
        <Modal title="변경사항 등록" onClose={() => setShowAmendModal(false)}>
          <form onSubmit={amendForm.handleSubmit(d => addAmendMut.mutate(d))} className="space-y-4">
            <Field label="변경 버전 (선택)">
              <input {...amendForm.register('version')} className={INPUT} placeholder="2.0" />
            </Field>
            <Field label="변경 사유·내용" error={amendForm.formState.errors.reason?.message}>
              <textarea {...amendForm.register('reason')} className={`${INPUT} min-h-[80px]`} placeholder={tAttr('변경 사유와 내용을 상세히 기술하세요')} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAmendModal(false)} className={BTN_GHOST}><T k="취소" /></button>
              <button type="submit" disabled={addAmendMut.isPending} className={BTN_PRIMARY}>
                <T k={addAmendMut.isPending ? '등록 중...' : '등록'} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 3 — 대상자 관리
   ═══════════════════════════════════════════════════════════════ */

function SubjectsTab({ studyId }: { studyId: string | null }) {
  const tAttr = useTAttr();
  const [showModal, setShowModal] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<Subject | null>(null);
  const [patientQuery, setPatientQuery] = useState('');
  const [picked, setPicked] = useState<{ id: string; familyName: string; givenName: string; mrn?: string } | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['research-subjects', studyId],
    queryFn: () => apiClient.get<{ data: Subject[] }>(`/api/v1/research/${studyId}/subjects`),
    enabled: !!studyId,
  });

  const subjects: Subject[] = useMemo(() => data?.data ?? [], [data]);

  // 🔴 종전 폼은 'P000001'(MRN) 텍스트를 patientId 로 보냈고 컬럼은 @db.Uuid 라 등록이 항상 실패했다.
  //    환자를 검색해 고르게 하고, 서버에는 UUID 를 보낸다.
  const { data: patientData } = useQuery({
    queryKey: ['research-patient-search', patientQuery],
    queryFn: () => apiClient.get<{ data: { id: string; familyName: string; givenName: string; mrn?: string }[] }>(
      '/api/v1/patients', { q: patientQuery, limit: 8 },
    ),
    enabled: showModal && patientQuery.trim().length >= 2,
  });
  const patientHits = patientData?.data ?? [];

  const form = useForm<SubjectForm>({ resolver: zodResolver(subjectSchema) });
  const withdrawForm = useForm<WithdrawForm>({ resolver: zodResolver(withdrawSchema) });

  const enrollMut = useMutation({
    mutationFn: (body: SubjectForm) =>
      apiClient.post<{ data: Subject }>(`/api/v1/research/${studyId}/subjects`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-subjects', studyId] });
      qc.invalidateQueries({ queryKey: ['research-study', studyId] });
      qc.invalidateQueries({ queryKey: ['research-studies'] });
      toast.success('대상자가 등록되었습니다');
      setShowModal(false);
      setPicked(null);
      setPatientQuery('');
      form.reset();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '대상자 등록에 실패했습니다'),
  });

  const withdrawMut = useMutation({
    // 🔴 종전엔 {withdrawDate, withdrawReason} 을 보냈는데 서버는 `reason` 만 읽어 사유가 NULL 로 저장됐고,
    //    화면은 사유를 묻지도 않고 '연구자 판단'을 임의로 채웠다. 이제 사람에게 묻고 계약대로 보낸다.
    mutationFn: ({ subjectId, reason }: { subjectId: string; reason: string }) =>
      apiClient.patch(`/api/v1/research/subjects/${subjectId}/withdraw`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-subjects', studyId] });
      qc.invalidateQueries({ queryKey: ['research-study', studyId] });
      toast.success('대상자 철회 처리되었습니다');
      setWithdrawTarget(null);
      withdrawForm.reset();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '철회 처리에 실패했습니다'),
  });

  if (!studyId) {
    return <div className="text-center py-16 text-gray-400"><T k="연구 목록에서 연구를 먼저 선택하세요" /></div>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500"><T k="선택된 연구의 대상자 목록 · 총" /> {subjects.length}<T k="명" /></p>
        <button onClick={() => setShowModal(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
          <T k="+ 대상자 등록" />
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="대상자번호" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="동의일" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="배정군" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="중도탈락" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="조치" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !subjects.length ? (
              <tr><td colSpan={7} className="py-16 text-center text-gray-400"><T k="등록된 대상자가 없습니다" /></td></tr>
            ) : (
              subjects.map(s => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{s.subjectNo}</td>
                  {/* 🔴 종전엔 평면 s.patientName 을 읽어 열 전체가 공백이었다(BE 는 patient 중첩) */}
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <PatientName familyName={s.patient?.familyName} givenName={s.patient?.givenName} maskable showMrn={false} />
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-600">{fmtDate(s.consentDate)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${SUBJECT_STATUS_COLOR[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      <T k={SUBJECT_STATUS_LABEL[s.status] ?? s.status} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-600">{s.armGroup || <Unknown kind="NA" />}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {s.status === 'WITHDRAWN' ? (
                      <>
                        <span className="text-gray-500">{fmtDate(s.withdrawDate)}</span>
                        <span className="ml-2">{s.withdrawReason || <Unknown kind="UNRECORDED" />}</span>
                      </>
                    ) : <Unknown kind="NA" />}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {s.status !== 'WITHDRAWN' && s.status !== 'COMPLETED' && (
                      <button onClick={() => { withdrawForm.reset({ reason: '' }); setWithdrawTarget(s); }}
                        className="text-[10px] px-2 py-1 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors font-medium">
                        <T k="철회" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 대상자 등록 Modal */}
      {showModal && (
        <Modal title="대상자 등록" onClose={() => setShowModal(false)}>
          <form onSubmit={form.handleSubmit(d => enrollMut.mutate(d))} className="space-y-4">
            <Field label="환자 검색 (이름 / 등록번호)" error={form.formState.errors.patientId?.message}>
              <input value={patientQuery} onChange={e => { setPatientQuery(e.target.value); setPicked(null); form.setValue('patientId', ''); }}
                className={INPUT} placeholder={tAttr('2자 이상 입력')} />
              {picked ? (
                <p className="mt-1 text-xs text-emerald-700">
                  <T k="선택됨:" /> <PatientName familyName={picked.familyName} givenName={picked.givenName} mrn={picked.mrn} />
                </p>
              ) : patientQuery.trim().length >= 2 && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-100">
                  {!patientHits.length ? (
                    <p className="px-3 py-2 text-xs text-gray-400"><T k="일치하는 환자가 없습니다" /></p>
                  ) : patientHits.map(p => (
                    <button key={p.id} type="button"
                      onClick={() => { setPicked(p); form.setValue('patientId', p.id, { shouldValidate: true }); }}
                      className="block w-full px-3 py-2 text-left text-xs hover:bg-blue-50">
                      <PatientName familyName={p.familyName} givenName={p.givenName} mrn={p.mrn} />
                    </button>
                  ))}
                </div>
              )}
              <input type="hidden" {...form.register('patientId')} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="동의일" error={form.formState.errors.consentDate?.message}>
                <input {...form.register('consentDate')} type="date" className={INPUT} />
              </Field>
              <Field label="배정군 (선택)">
                <input {...form.register('armGroup')} className={INPUT} placeholder="Treatment A" />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className={BTN_GHOST}><T k="취소" /></button>
              <button type="submit" disabled={enrollMut.isPending} className={BTN_PRIMARY}>
                <T k={enrollMut.isPending ? '등록 중...' : '등록'} />
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* 중도탈락 Modal — 사유를 사람에게 묻는다 */}
      {withdrawTarget && (
        <Modal title="대상자 중도탈락" onClose={() => setWithdrawTarget(null)}>
          <form
            onSubmit={withdrawForm.handleSubmit(d => withdrawMut.mutate({ subjectId: withdrawTarget.id, reason: d.reason }))}
            className="space-y-4"
          >
            <p className="text-xs text-gray-500">
              {withdrawTarget.subjectNo} ·{' '}
              <PatientName familyName={withdrawTarget.patient?.familyName} givenName={withdrawTarget.patient?.givenName} maskable showMrn={false} />
            </p>
            <Field label="중도탈락 사유 (필수 · 기록에 남습니다)" error={withdrawForm.formState.errors.reason?.message}>
              <textarea {...withdrawForm.register('reason')} className={`${INPUT} min-h-[80px]`}
                placeholder={tAttr('예: 이상반응 발생으로 연구자 판단에 따라 중단 / 대상자 동의 철회')} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setWithdrawTarget(null)} className={BTN_GHOST}><T k="취소" /></button>
              <button type="submit" disabled={withdrawMut.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                <T k={withdrawMut.isPending ? '처리 중...' : '철회 처리'} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 4 — IRB 심의
   ═══════════════════════════════════════════════════════════════ */

function IrbReviewTab() {
  const tAttr = useTAttr();
  const [showAmendForm, setShowAmendForm] = useState(false);
  const qc = useQueryClient();

  // 🔴 진짜 예정 심의는 이 EP 가 정본이다(SUBMITTED/UNDER_REVIEW). 만들어놓고 아무도 부르지 않아
  //    화면은 대신 '승인 완료일'을 예정일로 그렸다 — EP 를 만들면 부르는 화면까지가 한 벌이다.
  const { data: calData, isLoading: calLoading } = useQuery({
    queryKey: ['irb-calendar'],
    queryFn: () => apiClient.get<{ data: IrbCalendarItem[] }>('/api/v1/research/irb-calendar'),
  });
  const upcoming = calData?.data ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['irb-reviews'],
    queryFn: () => apiClient.get<{ data: IrbReview[] }>('/api/v1/research/irb/reviews'),
  });
  const reviews: IrbReview[] = useMemo(() => data?.data ?? [], [data]);

  const expiryWatch = useMemo(
    () => reviews.filter(r => r.irbValidity?.state === 'EXPIRED' || r.irbValidity?.state === 'EXPIRING_SOON' || r.irbValidity?.state === 'NO_EXPIRY_ON_RECORD'),
    [reviews],
  );

  const { data: studiesData } = useQuery({
    queryKey: ['research-studies'],
    queryFn: () => apiClient.get<{ data: Study[] }>('/api/v1/research'),
  });
  const studies = studiesData?.data ?? [];

  const amendFormHook = useForm<AmendmentForm>({ resolver: zodResolver(amendmentSchema) });

  const submitAmendMut = useMutation({
    mutationFn: (body: AmendmentForm) => apiClient.post('/api/v1/research/irb/amendments', {
      studyId: body.studyId,
      reason: body.reason,
      changes: body.version ? { version: body.version } : {},
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['irb-reviews'] });
      toast.success('변경심의 요청이 제출되었습니다');
      setShowAmendForm(false);
      amendFormHook.reset();
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '변경심의 요청에 실패했습니다'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500"><T k="심의 대기 과제 · IRB 승인 유효성 · 변경심의 요청" /></p>
        <button onClick={() => setShowAmendForm(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
          <T k="+ 변경심의 요청" />
        </button>
      </div>

      {/* 1) 심의 대기 — 개최 예정일은 시스템에 없으므로 '미정'이라고 말한다 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="mb-3">
          <h4 className="text-sm font-bold text-gray-900"><T k="심의 대기 과제" /></h4>
          <p className="text-[11px] text-gray-400 mt-0.5">
            <T k="제출·심의중 상태의 과제입니다. IRB 개최 예정일은 시스템에 기록되지 않아" /> <b><T k="제출일 기준" /></b><T k="으로 표시합니다." />
          </p>
        </div>
        {calLoading ? (
          <div className="h-16 bg-gray-50 rounded animate-pulse" />
        ) : !upcoming.length ? (
          <EmptyState icon="📋" title="심의 대기 중인 과제가 없습니다" compact />
        ) : (
          <div className="space-y-2">
            {upcoming.map(u => (
              <div key={u.studyId} className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl">
                <div className="w-24 shrink-0 text-center">
                  <p className="text-[10px] text-gray-500"><T k="제출일" /></p>
                  <p className="text-sm font-bold text-blue-600">{fmtDate(u.submittedAt)}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.title}</p>
                  <p className="text-[10px] text-gray-500">{u.studyNo} · {u.department} <T k="· 대기" /> {u.daysWaiting}<T k="일" /></p>
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap"><T k="심의일 미정" /></span>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${IRB_STATUS_COLOR[u.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  <T k={IRB_STATUS_LABEL[u.status] ?? u.status} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2) 승인 만료 관리 — 규제 핵심 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="승인 만료 관리" /></h4>
        {isLoading ? (
          <div className="h-16 bg-gray-50 rounded animate-pulse" />
        ) : !expiryWatch.length ? (
          <EmptyState icon="✅" title="만료·만료임박·만료일 미등록 과제가 없습니다" compact />
        ) : (
          <div className="space-y-2">
            {expiryWatch.map(r => (
              <div key={r.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.studyTitle}</p>
                  <p className="text-[10px] text-gray-500">{r.studyNo} · {r.department} <T k="· 승인일" /> {fmtDate(r.approvalDate)}</p>
                </div>
                <IrbValidityBadge v={r.irbValidity} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3) 연구별 심의 상태 — '예정'이 아니라 상태 이력이다 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="연구별 IRB 심의 상태" /></h4>
        {isLoading ? (
          <div className="h-24 bg-gray-50 rounded animate-pulse" />
        ) : !reviews.length ? (
          <EmptyState icon="📋" title="등록된 연구가 없습니다" compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500"><T k="연구번호" /></th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500"><T k="연구제목" /></th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500"><T k="심의 구분" /></th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500"><T k="제출일" /></th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500"><T k="승인일" /></th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500"><T k="상태" /></th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500"><T k="승인 만료" /></th>
                </tr>
              </thead>
              <tbody>
                {reviews.map(r => (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.studyNo}</td>
                    <td className="px-3 py-2"><p className="truncate max-w-[280px]">{r.studyTitle}</p></td>
                    <td className="px-3 py-2 text-center text-xs text-gray-600"><T k="초기심의" /></td>
                    <td className="px-3 py-2 text-center text-xs text-gray-600">{fmtDate(r.submittedAt)}</td>
                    <td className="px-3 py-2 text-center text-xs text-gray-600">
                      {r.approvalDate ? fmtDate(r.approvalDate) : <Unknown kind="PENDING" />}
                    </td>
                    {/* 🔴 종전엔 SCHEDULED/IN_PROGRESS/COMPLETED 3항 연쇄가 그 외 전부를 '보류'로 낙착시켜
                        APPROVED 인 연구에 '보류'와 '승인' 뱃지가 나란히 떴다 */}
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${IRB_STATUS_COLOR[r.irbStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                        <T k={IRB_STATUS_LABEL[r.irbStatus] ?? r.irbStatus} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center"><IrbValidityBadge v={r.irbValidity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Amendment Request Form */}
      {showAmendForm && (
        <Modal title="변경심의 요청" onClose={() => setShowAmendForm(false)}>
          <form onSubmit={amendFormHook.handleSubmit(d => submitAmendMut.mutate(d))} className="space-y-4">
            {/* 🔴 종전엔 사람에게 UUID 를 손으로 적으라고 했다 */}
            <Field label="연구 선택" error={amendFormHook.formState.errors.studyId?.message}>
              <select {...amendFormHook.register('studyId')} className={INPUT}>
                <option value="">{tAttr('선택')}</option>
                {studies.map(s => <option key={s.id} value={s.id}>{s.studyNo} · {s.title}</option>)}
              </select>
            </Field>
            <Field label="변경 버전 (선택)">
              <input {...amendFormHook.register('version')} className={INPUT} placeholder="2.0" />
            </Field>
            <Field label="변경 사유·내용" error={amendFormHook.formState.errors.reason?.message}>
              <textarea {...amendFormHook.register('reason')} className={`${INPUT} min-h-[100px]`} placeholder={tAttr('변경 사유 및 내용을 상세히 기술하세요')} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAmendForm(false)} className={BTN_GHOST}><T k="취소" /></button>
              <button type="submit" disabled={submitAmendMut.isPending} className={BTN_PRIMARY}>
                <T k={submitAmendMut.isPending ? '제출 중...' : '제출'} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Tab 5 — 통계
   ═══════════════════════════════════════════════════════════════ */

function StatsTab() {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['research-stats'],
    queryFn: () => apiClient.get<{ data: ResearchStats }>('/api/v1/research/stats'),
  });

  const stats = data?.data;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading) return <div className="text-center py-16 text-gray-400"><T k="통계 데이터를 불러오는 중..." /></div>;
  if (!stats) return <EmptyState icon="📊" title="통계 데이터가 없습니다" />;

  // 🔴 byType/byStatus 는 배열 계약이다. 서버가 객체를 주던 시절 이 화면은 .map() 에서 죽었다.
  //    형태가 어긋나면 죽는 대신 빈 목록으로 견딘다(계약 가드는 BE 스펙이 잡는다).
  const byType = Array.isArray(stats.byType) ? stats.byType : [];
  const byStatus = Array.isArray(stats.byStatus) ? stats.byStatus : [];
  const monthly = Array.isArray(stats.monthlyEnrollment) ? stats.monthlyEnrollment : [];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="전체 연구" value={stats.totalStudies} color="text-gray-900" bg="bg-white" />
        <StatCard label="IRB 승인 진행" value={stats.activeStudies} color="text-blue-600" bg="bg-blue-50/50" />
        <StatCard
          label="총 등록 대상자"
          value={stats.totalSubjects}
          color="text-emerald-600"
          bg="bg-emerald-50/50"
          note={stats.enrollMismatch ? `저장 카운터 합 ${stats.storedEnrollTotal}건과 불일치` : undefined}
        />
        <StatCard label="심의 대기" value={stats.pendingReviews} color="text-amber-600" bg="bg-amber-50/50" />
        {/* 🔴 비율은 분모와 함께(§3.3) — 서버가 basis(분자·분모)를 함께 주므로 정본 `<Ratio>` 로 낸다.
            결정 0건·목표 0명이면 `<Ratio>` 가 '산출 불가'를 그린다(자체 삼항 없음). */}
        <StatCard
          label="IRB 승인률"
          value={<Ratio numerator={stats.approvalBasis?.approved} denominator={stats.approvalBasis?.decided} unavailableHint="승인/반려로 결정된 심의 없음" />}
          color="text-green-600"
          bg="bg-green-50/50"
        />
        <StatCard
          label="등록 달성률"
          value={<Ratio numerator={stats.enrollmentBasis?.enrolled} denominator={stats.enrollmentBasis?.target} unavailableHint="목표 등록 수 미설정" />}
          color="text-purple-600"
          bg="bg-purple-50/50"
        />
      </div>

      {/* IRB 만료 경보 */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="승인 만료" value={stats.irbExpiry?.expired ?? 0} color="text-red-600" bg="bg-red-50/60"
          note={tAttr('만료된 승인으로 연구를 계속하면 규제 위반')} />
        <StatCard label="30일 내 만료" value={stats.irbExpiry?.expiringSoon ?? 0} color="text-orange-600" bg="bg-orange-50/60"
          note={tAttr('갱신 심의 상정 필요')} />
        <StatCard label="만료일 미등록" value={stats.irbExpiry?.noExpiryOnRecord ?? 0} color="text-amber-700" bg="bg-amber-50/60"
          note={tAttr('승인이지만 만료일이 없어 유효 판정 불가')} />
      </div>

      {/* By Type */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="연구 유형별 현황" /></h4>
        <div className="space-y-3">
          {byType.map(item => {
            const maxCount = Math.max(...byType.map(t => t.count), 1);
            return (
              <div key={item.type} className="flex items-center gap-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap w-24 text-center ${STUDY_TYPE_COLOR[item.type] ?? 'bg-gray-100 text-gray-600'}`}>
                  <T k={STUDY_TYPE_LABEL[item.type] ?? item.type} />
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-3">
                  <div className="h-3 rounded-full bg-blue-400 transition-all" style={{ width: `${(item.count / maxCount) * 100}%` }} />
                </div>
                <span className="text-sm font-bold text-gray-700 w-8 text-right">{item.count}</span>
              </div>
            );
          })}
          {!byType.length && <p className="text-sm text-gray-400 text-center"><T k="등록된 연구가 없습니다" /></p>}
        </div>
      </div>

      {/* By Status */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="IRB 상태별 현황" /></h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {byStatus.map(item => (
            <div key={item.status} className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${IRB_STATUS_COLOR[item.status] ?? 'bg-gray-100 text-gray-600'}`}>
                <T k={IRB_STATUS_LABEL[item.status] ?? item.status} />
              </span>
              <span className="text-lg font-bold text-gray-900">{item.count}</span>
            </div>
          ))}
          {!byStatus.length && <p className="text-sm text-gray-400 col-span-4 text-center"><T k="등록된 연구가 없습니다" /></p>}
        </div>
      </div>

      {/* Monthly Enrollment */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h4 className="text-sm font-bold text-gray-900 mb-4"><T k="월별 대상자 등록 추이" /></h4>
        {monthly.length > 0 ? (
          <div className="flex items-end gap-2 h-40">
            {monthly.map(m => {
              const maxM = Math.max(...monthly.map(x => x.count), 1);
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-gray-700">{m.count}</span>
                  <div className="w-full bg-blue-400 rounded-t-md transition-all" style={{ height: `${Math.max((m.count / maxM) * 100, 4)}%` }} />
                  <span className="text-[9px] text-gray-500">{m.month}</span>
                </div>
              );
            })}
          </div>
        ) : (
          // 🔴 표본 부재의 정답은 폴백 그래프가 아니라 빈 상태다
          <div className="h-40 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400 text-sm border border-dashed border-gray-200">
            <T k="등록된 대상자가 없습니다" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Shared Components
   ═══════════════════════════════════════════════════════════════ */

const INPUT = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
const BTN_GHOST = 'px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors';
const BTN_PRIMARY = 'px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors';

function StatCard({ label, value, color, bg, note }: {
  label: string; value: React.ReactNode; color: string; bg: string; note?: string;
}) {
  return (
    <div className={`${bg} rounded-2xl border border-gray-100 shadow-sm p-4`}>
      <p className="text-[11px] font-medium text-gray-500 mb-1"><T k={label} /></p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {note && <p className="mt-1 text-[10px] text-gray-400 leading-tight">{note}</p>}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900"><T k={title} /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1"><T k={label} /></label>
      {children}
      {error && <p className="text-[10px] text-red-500 mt-0.5"><T k={error} /></p>}
    </div>
  );
}
