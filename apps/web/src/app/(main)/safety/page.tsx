'use client';

import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABEL,
  incidentTypeLabel,
  normalizeIncidentSeverity,
  INCIDENT_STATUS_LABEL,
  INCIDENT_STATUS_TRANSITIONS,
  formatNum,
  RATIO_UNAVAILABLE,
  incidentTransitionNeedsReason,
  isIncidentStatus,
  type IncidentSeverity,
  type IncidentStatus,
} from '@hospital-run/shared';
import { extractErrorMessage } from '@/lib/error-utils';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit, Ratio } from '@/components/ui/display';
import {
  canReviewSafety,
  hiddenSafetyTabLabels,
  safetyReviewBlockReason,
  visibleSafetyTabs,
  type SafetyTabKey,
} from './safety-access';

const incidentSchema = z.object({
  // 🔴 2026-10-08 — 유형·중증도가 '낙상·경미'로 미리 골라져 있었다(쓰기 폼은 미선택으로 시작 · 고르지 않은 값이 통계가 된다)
  type: z.string().min(1, '사고 유형을 고르세요'),
  severity: z.string().min(1, '중증도를 고르세요'),
  wardId: z.string().optional(),
  harmLevel: z.string().optional(),
  anonymous: z.boolean().optional(),
  description: z.string().min(1, '상세 설명을 입력하세요'),
  location: z.string().optional(),
  occurredAt: z.string().min(1),
  patientId: z.string().optional(),
});
type IncidentForm = z.infer<typeof incidentSchema>;

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

/**
 * 🔴 심각도 어휘가 **세 벌**이었다(2026-08-14·W7).
 *  화면 라벨표 5종(NEAR_MISS·MINOR·MODERATE·SEVERE·SENTINEL) ↔ DB 자유문자열(LOW·MODERATE…)
 *  ↔ 서버 에스컬레이션 판정 10종+. 저장된 `LOW` 2건이 어느 막대에도 속하지 못해
 *  "총 사고 3"인데 중증도 막대 합이 1이었고, 상세 패널 중증도 칸은 **빈칸**이었다
 *  (`SEV_LABEL['LOW']` = undefined, 표 행에만 있던 `?? i.severity` 폴백이 상세엔 없었다).
 *
 *  → **라벨 정본은 shared `INCIDENT_SEVERITY_LABEL`**(로컬 재정의 금지·가드 스펙 있음).
 *    여기서는 색만 정본 등급 키로 정의한다.
 */
const SEV_COLOR: Record<IncidentSeverity, string> = {
  NEAR_MISS: 'bg-gray-100 text-gray-600',
  MINOR: 'bg-yellow-100 text-yellow-700',
  MODERATE: 'bg-orange-100 text-orange-700',
  MAJOR: 'bg-red-100 text-red-700',
  CRITICAL: 'bg-red-200 text-red-800',
  SENTINEL: 'bg-red-600 text-white',
  // 🔴 미분류를 '경미'로 접지 않는다 — 모른다는 사실을 회색으로 드러낸다
  UNSPECIFIED: 'bg-slate-200 text-slate-700',
};
/** 보고 시 고를 수 있는 등급(미분류는 선택지가 아니다 — 보고자는 등급을 정해야 한다) */
const REPORTABLE_SEVERITIES = INCIDENT_SEVERITIES.filter((s) => s !== 'UNSPECIFIED');

/** 저장된 자유 문자열을 정본 등급으로 접어 배지로 렌더(원본은 title 로 추적 가능하게 남긴다) */
function SeverityBadge({ raw, className = '' }: { raw?: string | null; className?: string }) {
  const level = normalizeIncidentSeverity(raw);
  return (
    <span title={raw ? `저장값: ${raw}` : undefined}
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SEV_COLOR[level]} ${className}`}>
      <T k={INCIDENT_SEVERITY_LABEL[level]} />
    </span>
  );
}

/**
 * 🔴 유형 라벨표를 **여기서 지웠다**(2026-08-18·보고자 보호 축).
 *  로컬 `Record` 재정의는 FE 표현 단위 규약 위반이고, 실제로 어휘가 갈라져 있었다:
 *  화면표는 MEDICATION·IDENTIFICATION·PRESSURE_INJURY 를 갖고 있었는데 저장값은
 *  MEDICATION_ERROR·PATIENT_ID·PRESSURE_ULCER·SPECIMEN_LABEL·DOCUMENTATION 이라
 *  운영 75건 중 **40건(53%)이 드롭다운에 없어 유형으로 조회조차 불가**했다.
 *  → 정본은 shared `INCIDENT_TYPE_LABEL` / `incidentTypeLabel`(미등재 저장값은 원본 그대로).
 */
// 상태 라벨·전이는 shared 정본(INCIDENT_STATUS_LABEL·INCIDENT_STATUS_TRANSITIONS) — 서버가 같은 표로 검증한다
const STATUS_LABEL: Record<string, string> = INCIDENT_STATUS_LABEL;
const TRANSITION_BUTTON: Record<IncidentStatus, string> = { REPORTED: '보고 상태로', INVESTIGATING: '조사 시작', RESOLVED: '해결', CLOSED: '종료' };
const STATUS_COLOR: Record<string, string> = {
  REPORTED: 'bg-blue-100 text-blue-700', INVESTIGATING: 'bg-amber-100 text-amber-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700', CLOSED: 'bg-gray-200 text-gray-600',
};

/**
 * 🔴 탭마다 필요한 권한이 다르다. 종전엔 전부 `@Roles(DOCTOR,NURSE,ADMIN)` 한 벌이라
 *    "보고할 수 있는 사람 = 전건 열람하는 사람"이었다(환자안전법 §14 ↔ §16 이 정반대 방향).
 *    `review: true` = 전담인력만 부를 수 있는 화면.
 *    없는 사람에게 **띄우고 403 을 맞게 하지 않는다**(dead-menu 금지).
 *
 * 🔴 판정 정본은 `./safety-access`(역할 AND 권한) — 종전 이 파일은 **권한만** 보고 있어서
 *    `/admin/rbac` 이 권한을 넓히면 서버 역할 게이트에 걸려 403 이 되는 탭을 열 수 있었다.
 */
type TabKey = SafetyTabKey;

/** 전건 열람·조사·RCA 권한(환자안전 전담인력) — 역할 AND 권한 */
function useCanReviewSafety(): boolean {
  const role = useAuthStore(st => st.user?.role);
  const permissions = useAuthStore(st => st.user?.permissions);
  return canReviewSafety({ role, permissions });
}

function fmtDate(d?: string) { return d ? kdate(d) : '-'; }
/** datetime-local 입력값(로컬 시각) — `toISOString()` 은 UTC 라 KST 에서 9시간 이르다 */
function localDateTimeInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDateTime(d?: string) { return d ? kdate(d, 'datetimeShort') : '-'; }

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface Incident {
  id: string; type: string; typeLabel?: string; severity: string; description?: string;
  location?: string; occurredAt?: string; createdAt?: string;
  actionTaken?: string; status: string; rcaCompleted?: boolean;
  /** 2026-10-08 — 첫 검토·종결 시각(검토 지연·종결 소요의 원천) · 위해 정도·익명 여부 */
  reviewedAt?: string | null; closedAt?: string | null;
  /** 2026-10-09 KOPS 직접 보고 기록(사람이 적은 번호) */
  kopsManualRef?: string | null; kopsManualAt?: string | null; harmLevel?: string | null; anonymous?: boolean; wardId?: string | null;
  patientId?: string;
  /** 🔴 서버는 `reporterId` 를 **내려주지 않는다**(환자안전법 §17). 본인 건 여부만 불리언으로 온다. */
  reportedByMe?: boolean;
}

interface IncidentStats {
  period: { scope: string; label: string; since: string | null };
  total: number; rcaCompleted: number; rcaPending: number;
  escalating: number; majorOrAbove: number; unspecified: number;
  falls: number; medication: number; thisMonth: number; thisMonthSince: string;
  /** 서버가 shared 정본으로 접어서 보낸다(미등재 저장값은 type:null + 원본 라벨) */
  byType: { type: string | null; rawType: string | null; label: string; count: number }[];
  /** 서버가 shared 정본으로 접어서 보낸다(0건 등급 포함) */
  bySeverity: { severity: IncidentSeverity; label: string; count: number }[];
  byStatus: { status: string; count: number }[];
  /** 보고 → 첫 검토 소요(최근 180일 · 2026-10-08 기록 시작) — 표본 0 이면 null */
  reviewLag?: { since: string; n: number; pendingReview: number; medianHours: number | null; p90Hours: number | null };
}

interface RcaRow {
  id: string; incidentId: string; status: string;
  findings?: string | null; owner?: string | null;
  contributingFactors?: unknown; actionPlan?: unknown;
  dueAt: string | null; approvedAt: string | null; createdAt: string;
  overdue: boolean; daysToDue: number | null;
  incident: {
    id: string; type: string; typeLabel?: string; severity: string; description: string;
    location?: string | null; occurredAt: string; status: string; rcaCompleted: boolean;
  } | null;
}

const RCA_STATUS_LABEL: Record<string, string> = {
  OPEN: '착수', IN_PROGRESS: '분석중', COMPLETED: '분석완료(승인대기)', APPROVED: '승인완료',
};
const RCA_STATUS_COLOR: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700', IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-violet-100 text-violet-700', APPROVED: 'bg-emerald-100 text-emerald-700',
};

/* ═══════════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════════ */

export default function SafetyPage() {
  const role = useAuthStore(st => st.user?.role);
  const permissions = useAuthStore(st => st.user?.permissions);
  const viewer = { role, permissions };
  const canReview = canReviewSafety(viewer);
  const blockReason = safetyReviewBlockReason(viewer);
  const [tab, setTab] = useState<TabKey>('report');
  const visibleTabs = visibleSafetyTabs(viewer);
  const hiddenLabels = hiddenSafetyTabLabels(viewer);
  const active = visibleTabs.some(t => t.key === tab) ? tab : 'report';

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="환자안전 (IPSG)" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="JCI 국제환자안전목표 기반 사고 보고 · 통계 · 관리" /></p>
        {/* 🔴 무엇을 볼 수 있는지 화면이 먼저 밝힌다 — 빈 목록을 '사고 없음'으로 읽지 않도록 */}
        <p className="text-xs text-gray-500 mt-1">
          <T k={canReview ? '전담인력 권한 — 전 직원의 보고를 열람·조사할 수 있습니다. 보고자 신원은 어떤 권한으로도 표시되지 않습니다(환자안전법 §17).' : '이 화면에서는 본인이 보고한 건만 보입니다. 전건 열람·조사는 환자안전 전담인력 권한이 필요합니다.'} />
        </p>
        {/* 🔴 숨긴 것과 없는 것은 다르다 — 무엇이 접혔고 왜 접혔는지 그 자리에서 말한다 */}
        {hiddenLabels.length > 0 && (
          <p className="text-xs text-gray-400 mt-1">
            <T k="권한이 없어 표시되지 않는 탭" /> {hiddenLabels.length}<T k="개:" /> <span className="text-gray-500">{hiddenLabels.join(' · ')}</span>
            {blockReason === 'ROLE' && (
              <span className="text-amber-600">
                {' '}<T k="— 이 계정에는 전담인력 권한이 부여돼 있으나, 서버가 이 역할(" /><T k={role ?? '알 수 없음'} /><T k=")에는 환자안전 조회를 허용하지 않습니다. 권한 설정만으로는 열리지 않습니다(관리자 문의)." />
              </span>
            )}
          </p>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${active === t.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            <span>{t.icon}</span> <T k={t.label} />
          </button>
        ))}
      </div>

      {active === 'dashboard' && <DashboardTab />}
      {active === 'identification' && <IdentificationTab />}
      {active === 'restraint' && <RestraintTab />}
      {active === 'readback' && <ReadBackTab />}
      {active === 'list' && <IncidentListTab onGoRca={() => setTab('rca')} />}
      {active === 'rca' && <RcaTab />}
      {active === 'report' && <ReportTab onSuccess={() => setTab('list')} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   대시보드 탭
   ═══════════════════════════════════════════════════════════════ */

function DashboardTab() {
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['safety-stats'],
    queryFn: () => apiClient.get<{ data: IncidentStats }>('/api/v1/safety/incidents/stats'),
  });
  const stats = data?.data as IncidentStats | null;
  // 🔴 에러 분기가 먼저 — 안전 통계 조회 실패를 영구 '불러오는 중'으로 굳히지 않는다
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (!stats) return <div className="text-center py-12 text-gray-400"><T k="통계 데이터를 불러오는 중..." /></div>;

  const typeData = [...stats.byType].sort((a, b) => b.count - a.count);
  const sevData = stats.bySeverity;
  const statusData = stats.byStatus;
  const maxType = Math.max(...typeData.map(t => t.count), 1);
  // 🔴 서버가 접어 보낸 등급 합 — 화면 하드코딩 키로 훑다가 값을 흘리던 것을 막는다
  const sevSum = sevData.reduce((a, s) => a + s.count, 0);

  return (
    <div className="space-y-6">
      {/* 🔴 기간 표기 부재 봉합 — /safety(전 기간)와 /safety-quality-board(30일)가 다른 수를 말했다 */}
      <p className="text-xs text-gray-500">
        <T k="집계 기간:" /> <span className="font-semibold text-gray-700"><T k={stats.period?.label ?? '전 기간 누적'} /></span>
        {' · '}<T k="이번 달 발생" /> {stats.thisMonth}<Unit><T k="건" /></Unit>
        <span className="text-gray-400"> <T k="(감염·질·안전 보드는 최근 30일 기준이라 수가 다를 수 있습니다)" /></span>
      </p>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="총 사고 (전 기간)" value={stats.total} color="blue" />
        <StatCard label="RCA 승인 완료" value={stats.rcaCompleted} color="green"
          hint={stats.rcaPending > 0 ? `진행 중 ${stats.rcaPending}건` : undefined} />
        <StatCard label="조사 중" value={statusData.find(s => s.status === 'INVESTIGATING')?.count ?? 0} color="amber" />
        {/* 🔴 종전 'SEVERE+SENTINEL' 두 키만 세어 서버가 위중으로 인정하는 CRITICAL·MAJOR·HIGH 가 0으로 샜다 */}
        <StatCard label="중대 이상" value={stats.majorOrAbove} color="rose"
          hint={`즉시통지 대상(위해·적신호) ${stats.escalating}건`} />
      </div>

      {/* 보고 → 첫 검토 소요 — 🔴 표본 0 이면 '산출 불가'(0시간이 아니다) · 검토 대기 건은 따로 센다 */}
      {stats.reviewLag && (
        <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs text-gray-700" data-safety-review-lag={stats.reviewLag.n}>
          <b><T k="보고 → 첫 검토 소요" /></b>{' '}
          {stats.reviewLag.medianHours == null
            ? <span className="text-gray-500"><T k={RATIO_UNAVAILABLE} />(<T k="검토 시각이 기록된 보고 없음" />)</span>
            : <span><T k="중앙값" /> {formatNum(stats.reviewLag.medianHours, 'reviewLagHours')}<T k="시간" /> · p90 {formatNum(stats.reviewLag.p90Hours ?? 0, 'reviewLagHours')}<T k="시간" /> <span className="text-gray-400">(n={stats.reviewLag.n})</span></span>}
          {' · '}<T k="검토 대기" /> <b>{stats.reviewLag.pendingReview}</b><T k="건" />
          <span className="block text-[10px] text-gray-400"><T k="최근 180일 · 첫 검토 시각은 2026-10-08부터 기록됩니다(그 전에 조사로 넘어간 보고는 분모에 없습니다)." /></span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 유형별 분포 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="사고 유형별 분포" /></h3>
          <div className="space-y-2.5">
            {typeData.length === 0 && <p className="text-xs text-gray-400"><T k="기록 없음" /></p>}
            {typeData.map(t => (
              <div key={t.type} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-20 shrink-0"><T k={t.label} /></span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <div className="bg-blue-500 h-full rounded-full transition-all" style={{ width: `${(t.count / maxType) * 100}%` }} />
                </div>
                <span className="text-xs font-bold text-gray-700 w-8 text-right">{t.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 중증도별 분포 — 서버 정본 집계를 그대로 렌더(로컬 키 목록으로 훑지 않는다) */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900"><T k="중증도별 분포" /></h3>
            <span className="text-[11px] text-gray-400"><T k="합계" /> {sevSum} <T k="/ 총" /> {stats.total}</span>
          </div>
          <div className="space-y-2.5">
            {sevData.map(s => (
              <div key={s.severity} className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-16 text-center whitespace-nowrap ${SEV_COLOR[s.severity]}`}><T k={s.label} /></span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${s.severity === 'SENTINEL' || s.severity === 'CRITICAL' || s.severity === 'MAJOR' ? 'bg-red-500' : s.severity === 'MODERATE' ? 'bg-orange-400' : s.severity === 'UNSPECIFIED' ? 'bg-slate-400' : 'bg-yellow-400'}`}
                    style={{ width: `${(s.count / Math.max(stats.total, 1)) * 100}%` }} />
                </div>
                <span className="text-xs font-bold text-gray-700 w-8 text-right">{s.count}</span>
              </div>
            ))}
          </div>
          {stats.unspecified > 0 && (
            <p className="text-[11px] text-slate-500 mt-3">
              <T k="⚠️ 중증도가 정본 등급으로 분류되지 않은 사건" /> {stats.unspecified}<Unit><T k="건" /></Unit> <T k="— 보고 내용 확인이 필요합니다." />
            </p>
          )}
        </div>
      </div>

      {/* 상태별 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="처리 현황" /> <span className="text-[11px] font-normal text-gray-400"><T k="(전 기간 누적)" /></span></h3>
        <div className="flex gap-4">
          {['REPORTED', 'INVESTIGATING', 'RESOLVED', 'CLOSED'].map(st => {
            const count = statusData.find(s => s.status === st)?.count ?? 0;
            return (
              <div key={st} className="flex-1 text-center">
                <p className="text-2xl font-bold text-gray-900">{count}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[st]}`}><T k={STATUS_LABEL[st]} /></span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, hint }: { label: string; value: number; color: string; hint?: string }) {
  const cls: Record<string, string> = { blue: 'text-blue-700', green: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700' };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs font-medium text-gray-500 mb-1"><T k={label} /></p>
      <p className={`text-2xl font-bold ${cls[color] ?? 'text-gray-900'}`}>{value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   사고 목록 탭
   ═══════════════════════════════════════════════════════════════ */

function IncidentListTab({ onGoRca }: { onGoRca: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const canReview = useCanReviewSafety();
  const [typeFilter, setTypeFilter] = useState('');
  const [sevFilter, setSevFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 사유가 필요한 전이는 브라우저 prompt 대신 화면 안 입력(2026-10-08)
  const [pendingTo, setPendingTo] = useState<IncidentStatus | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['incidents', typeFilter, sevFilter, statusFilter],
    queryFn: () => apiClient.get<{ data: Incident[] }>('/api/v1/safety/incidents', {
      type: typeFilter || undefined, severity: sevFilter || undefined, status: statusFilter || undefined,
    }),
  });

  const raw = data?.data;
  const incidents: Incident[] = Array.isArray(raw) ? raw : (raw as unknown as { data: Incident[] })?.data ?? [];

  const statusMut = useMutation({
    mutationFn: ({ id, status, actionTaken }: { id: string; status: string; actionTaken?: string }) => {
      // 전담인력(canReview)만 — 서버도 safety:incident:review 로 막는다
      if (!canReview) return Promise.reject(new Error(tAttr('사고 상태 변경 권한이 없습니다')));
      return apiClient.patch(`/api/v1/safety/incidents/${id}/status`, { status, actionTaken });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['incidents'] }); qc.invalidateQueries({ queryKey: ['safety-stats'] }); setPendingTo(null); setReason(''); toast.success(tAttr('상태가 변경되었습니다.')); },
    onError: (e: unknown) => toast.error(extractErrorMessage(e) || tAttr('상태 변경 실패')),
  });

  // 🔴 RCA 를 시작할 화면 경로가 없어 rca_reports 가 화면에서 만들어질 수 없었다(생성 EP 만 존재)
  const agendaMut = useMutation({
    mutationFn: (id: string) => {
      if (!canReview) return Promise.reject(new Error(tAttr('위원회 안건은 환자안전 전담인력이 올립니다')));
      return apiClient.post(`/api/v1/quality-flow/incidents/${id}/agenda`, {});
    },
    onSuccess: () => toast.success(tAttr('환자안전위원회(SAFE) 안건으로 올렸습니다 — 의결은 위원회가 합니다.')),
    onError: (e: unknown) => toast.error(extractErrorMessage(e) || tAttr('안건을 올리지 못했습니다.')),
  });
  const startRcaMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/safety/incidents/${id}/rca`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rca-list'] }); toast.success('RCA를 시작했습니다. RCA 탭에서 이어서 작성하세요.'); onGoRca(); },
    onError: (e: { message?: string }) => toast.error(e?.message || 'RCA 시작에 실패했습니다.'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const selected = incidents.find(i => i.id === selectedId);

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex flex-wrap gap-2">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-3 py-1.5 border rounded-lg text-xs">
          <option value="">{tAttr('유형 전체')}</option>
          {INCIDENT_TYPES.map(k => <option key={k} value={k}>{tAttr(INCIDENT_TYPE_LABEL[k])}</option>)}
        </select>
        {/* 🔴 종전 드롭다운에 LOW·MAJOR·CRITICAL·미분류가 없어 그 사건들은 조회조차 불가했다.
            정본 등급 전체(미분류 포함)를 노출하고, 서버가 원본 문자열 후보로 조회한다. */}
        <select value={sevFilter} onChange={e => setSevFilter(e.target.value)} className="px-3 py-1.5 border rounded-lg text-xs">
          <option value="">{tAttr('중증도 전체')}</option>
          {INCIDENT_SEVERITIES.map(k => <option key={k} value={k}>{tAttr(INCIDENT_SEVERITY_LABEL[k])}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-1.5 border rounded-lg text-xs">
          <option value="">{tAttr('상태 전체')}</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto self-center">{incidents.length}<Unit><T k="건" /></Unit></span>
      </div>

      <div className="flex gap-6">
        {/* 목록 */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="중증도" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="설명" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="발생일" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">RCA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="로딩 중..." /></td></tr> :
               incidents.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k={canReview ? '사고 기록이 없습니다' : '본인이 보고한 사고가 없습니다 (전건 열람 권한 없음)'} /></td></tr> :
               incidents.map(i => (
                <tr key={i.id} onClick={() => setSelectedId(i.id)}
                  className={`cursor-pointer transition-colors ${selectedId === i.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3 text-xs font-medium text-gray-700">{i.typeLabel ?? incidentTypeLabel(i.type)}</td>
                  <td className="px-4 py-3"><SeverityBadge raw={i.severity} /></td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[250px] truncate">{i.description?.slice(0, 60)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(i.occurredAt ?? i.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[i.status] ?? ''}`}><T k={STATUS_LABEL[i.status] ?? i.status} /></span>
                  </td>
                  <td className="px-4 py-3 text-xs">{i.rcaCompleted ? '✅' : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 상세 패널 */}
        {selected && (
          <div className="w-[350px] shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900"><T k="사고 상세" /></h3>
              <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between"><span className="text-gray-500"><T k="유형" /></span><span className="font-medium">{selected.typeLabel ?? incidentTypeLabel(selected.type)}</span></div>
              {/* 🔴 종전 이 칸만 폴백이 없어 저장값이 LOW 면 **빈칸**이 떴다 */}
              <div className="flex justify-between"><span className="text-gray-500"><T k="중증도" /></span><SeverityBadge raw={selected.severity} /></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="상태" /></span><span className={`font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[selected.status]}`}><T k={STATUS_LABEL[selected.status]} /></span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="발생일" /></span><span>{fmtDateTime(selected.occurredAt ?? selected.createdAt)}</span></div>
              {selected.location && <div className="flex justify-between"><span className="text-gray-500"><T k="장소" /></span><span>{selected.location}</span></div>}
              <div className="flex justify-between items-center">
                <span className="text-gray-500">RCA</span>
                {selected.rcaCompleted
                  ? <span><T k="✅ 승인 완료" /></span>
                  : canReview
                    ? <button onClick={() => startRcaMut.mutate(selected.id)} disabled={startRcaMut.isPending}
                        className="min-h-[44px] px-3 py-2 text-xs font-medium bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 disabled:opacity-50">
                        <T k="RCA 시작 / 열기" />
                      </button>
                    : <span className="text-gray-400"><T k="진행 중 아님" /></span>}
              </div>
            </div>
            {selected.description && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-500 font-medium mb-1"><T k="상세 설명" /></p>
                <p className="text-xs text-gray-700">{selected.description}</p>
              </div>
            )}
            {selected.actionTaken && (
              <div className="bg-emerald-50 rounded-xl p-3">
                <p className="text-[10px] text-emerald-600 font-medium mb-1"><T k="조치 내역" /></p>
                <p className="text-xs text-emerald-800">{selected.actionTaken}</p>
              </div>
            )}
            {/* 상태 변경 — 🔴 조사는 전담인력 업무(권한 없는 사람에게 버튼을 띄우고 403 을 맞게 하지 않는다)
                전이는 shared 정본 표 그대로(서버가 같은 표로 검증) · 사유가 필요한 전이는 화면 안 입력 */}
            {canReview && isIncidentStatus(selected.status) && INCIDENT_STATUS_TRANSITIONS[selected.status].length > 0 && (
              <div className="space-y-2 pt-2 border-t" data-incident-transitions>
                <div className="flex gap-1.5">
                  {INCIDENT_STATUS_TRANSITIONS[selected.status].map((to) => (
                    <button key={to} data-incident-to={to}
                      onClick={() => {
                        if (incidentTransitionNeedsReason(selected.status as IncidentStatus, to)) { setPendingTo(to); setReason(''); }
                        else statusMut.mutate({ id: selected.id, status: to });
                      }}
                      disabled={statusMut.isPending}
                      className={`flex-1 min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg disabled:opacity-50 ${STATUS_COLOR[to] ?? 'bg-gray-100 text-gray-600'}`}>
                      <T k={selected.status === 'RESOLVED' && to === 'INVESTIGATING' ? '재조사' : selected.status === 'REPORTED' && to === 'CLOSED' ? '사고 아님·중복으로 종료' : TRANSITION_BUTTON[to]} />
                    </button>
                  ))}
                </div>
                {pendingTo && (
                  <div className="space-y-1.5" data-incident-reason>
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                      placeholder={tAttr('조치 내역(사유) — 필수')} className="w-full border rounded-lg px-2.5 py-1.5 text-xs" />
                    <div className="flex gap-1.5">
                      <button disabled={!reason.trim() || statusMut.isPending} data-incident-reason-confirm
                        onClick={() => statusMut.mutate({ id: selected.id, status: pendingTo, actionTaken: reason.trim() })}
                        className="flex-1 min-h-[44px] px-3 text-xs font-semibold bg-indigo-600 text-white rounded-lg disabled:opacity-40">
                        <T k={STATUS_LABEL[pendingTo]} /> <T k="으로 변경" />
                      </button>
                      <button onClick={() => setPendingTo(null)} className="min-h-[44px] px-3 text-xs bg-gray-100 text-gray-600 rounded-lg"><T k="취소" /></button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* 검토·종결 시각 — 기록 시작(2026-10-08) 이전 건은 비어 있다(지어내지 않는다) */}
            <div className="space-y-1 text-[11px] text-gray-500" data-safety-review-times>
              <div className="flex justify-between"><span><T k="첫 검토" /></span><span>{selected.reviewedAt ? fmtDateTime(selected.reviewedAt) : <T k="기록 없음" />}</span></div>
              <div className="flex justify-between"><span><T k="종결" /></span><span>{selected.closedAt ? fmtDateTime(selected.closedAt) : '—'}</span></div>
              {selected.harmLevel && <div className="flex justify-between"><span><T k="위해 정도" /></span><span>{selected.harmLevel}</span></div>}
              {selected.anonymous && <p className="text-amber-700"><T k="익명 보고 — 보고자가 원장에 없습니다." /></p>}
            </div>
            {/* 위원회 검토 — 화면은 판단하지 않고 안건으로 올린다(환자 식별정보·서술 본문은 실리지 않는다) */}
            {canReview && (
              <button type="button" onClick={() => agendaMut.mutate(selected.id)} disabled={agendaMut.isPending} data-safety-incident-agenda
                className="min-h-[44px] w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-800 disabled:opacity-50">
                <T k="환자안전위원회 검토 안건으로 올리기" />
              </button>
            )}
            {/* 대외 보고(KOPS) — 🔴 송신 코드가 없다. "보고됨"을 지어내지 않는다 */}
            <KopsReportLine incident={selected} canReview={canReview} onSaved={() => qc.invalidateQueries({ queryKey: ['incidents'] })} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * KOPS 보고 줄(2026-10-09) — 송신 채널은 없다. 사람이 KOPS 웹에 직접 보고했으면 접수번호·시각을 남긴다(한 번).
 * 🔴 기관 접수를 시스템이 확인하지 않는다 — "보고됨"이 아니라 "직접 보고 기록"으로 말한다.
 */
function KopsReportLine({ incident, canReview, onSaved }: { incident: Incident; canReview: boolean; onSaved: () => void }) {
  const tAttr = useTAttr();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState('');
  const [at, setAt] = useState('');
  const save = useMutation({
    mutationFn: () => {
      if (!canReview) return Promise.reject(new Error(tAttr('KOPS 보고 기록은 환자안전 전담인력이 남깁니다')));
      return apiClient.post(`/api/v1/safety/incidents/${incident.id}/kops-manual`, { ref: ref.trim(), reportedAt: new Date(at).toISOString() });
    },
    onSuccess: () => { toast.success(tAttr('KOPS 직접 보고를 기록했습니다.')); setOpen(false); onSaved(); },
    onError: (e: unknown) => toast.error(extractErrorMessage(e) || tAttr('KOPS 보고를 기록하지 못했습니다.')),
  });
  if (incident.kopsManualRef) {
    return (
      <p className="text-[10px] text-gray-600" data-kops-status="MANUAL_REPORTED">
        <T k="KOPS 직접 보고 기록" />: <span className="font-mono">{incident.kopsManualRef}</span>{incident.kopsManualAt && <> · {fmtDateTime(incident.kopsManualAt)}</>}
        <span className="block text-gray-400"><T k="사람이 적은 접수번호입니다 — 기관 접수는 시스템이 확인하지 않습니다." /></span>
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-gray-500" data-kops-status="LOCAL_RECORDED">
        <T k="환자안전보고학습시스템(KOPS) 보고: 미구축 — 원내 기록만 있습니다(필요 시 KOPS 에 직접 보고)" />
      </p>
      {canReview && !open && (
        <button type="button" onClick={() => setOpen(true)} className="rounded border border-gray-300 px-2 py-0.5 text-[10px]" data-kops-manual-open>
          <T k="KOPS 에 직접 보고했으면 접수번호 기록" />
        </button>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-kops-manual-form>
          <input value={ref} onChange={(e) => setRef(e.target.value)} aria-label={tAttr('KOPS 접수번호')} placeholder={tAttr('KOPS 접수번호')} className="w-36 rounded border border-gray-200 px-2 py-1" />
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={tAttr('KOPS 보고 시각')} className="rounded border border-gray-200 px-2 py-1" />
          <button type="button" disabled={ref.trim().length < 3 || !at || save.isPending} onClick={() => save.mutate()} className="min-h-[36px] rounded bg-gray-900 px-2 text-white disabled:opacity-40" data-kops-manual-save>
            <T k="기록" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   사고 보고 탭
   ═══════════════════════════════════════════════════════════════ */

function ReportTab({ onSuccess }: { onSuccess: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<IncidentForm>({
    resolver: zodResolver(incidentSchema),
    // 🔴 발생 일시 기본값이 UTC(`toISOString`)라 KST 화면에 9시간 이른 시각이 들어가 있었다 — 로컬 시각으로
    defaultValues: { type: '', severity: '', description: '', location: '', occurredAt: localDateTimeInput(new Date()), patientId: '', wardId: '', harmLevel: '', anonymous: false },
  });
  // 사람 결정(익명 보고·위해 척도) — 결정 전엔 입력을 내지 않는다 · 읽기 실패면 선택 항목을 숨기고 그 사실을 말한다
  const flow = useQuery({
    queryKey: ['qi-flow-settings'],
    queryFn: () => apiClient.get<{ data: { rows: { key: string; value: unknown; source: string }[]; harmLevels: string[] | null } }>('/api/v1/quality-flow/settings').then((r) => r.data),
  });
  const anonymousAllowed = flow.data?.rows?.find((r) => r.key === 'safety.incident.anonymous' && r.source !== 'error')?.value === true;
  const harmLevels = flow.data?.harmLevels ?? null;
  const wards = useQuery({
    queryKey: ['safety-report-wards'],
    queryFn: () => apiClient.get<{ data: { id: string; name: string; isActive?: boolean }[] }>('/api/v1/beds/wards').then((r) => (Array.isArray(r.data) ? r.data : []).filter((w) => w.isActive !== false)),
    retry: false,
  });

  const reportMut = useMutation({
    mutationFn: (d: IncidentForm) => apiClient.post('/api/v1/safety/incidents', {
      ...d, occurredAt: new Date(d.occurredAt).toISOString(), patientId: d.patientId || undefined,
      wardId: d.wardId || undefined, harmLevel: d.harmLevel || undefined, anonymous: d.anonymous ? true : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['safety-stats'] });
      toast.success('안전 사고가 보고되었습니다.');
      onSuccess();
    },
    onError: () => toast.error('보고에 실패했습니다.'),
  });

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSubmit((d) => reportMut.mutate(d))} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <h3 className="text-lg font-bold text-gray-900"><T k="안전 사고 보고" /></h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="사고 유형" /></label>
            <select {...register('type')} className="w-full px-3 py-2 border rounded-lg text-sm" data-safety-report-type>
              <option value="">{tAttr('유형 선택')}</option>
              {INCIDENT_TYPES.map(k => <option key={k} value={k}>{tAttr(INCIDENT_TYPE_LABEL[k])}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="중증도" /></label>
            <select {...register('severity')} className="w-full px-3 py-2 border rounded-lg text-sm" data-safety-report-severity>
              <option value="">{tAttr('중증도 선택')}</option>
              {REPORTABLE_SEVERITIES.map(k => <option key={k} value={k}>{tAttr(INCIDENT_SEVERITY_LABEL[k])}</option>)}
            </select>
            {errors.severity && <p className="text-xs text-red-500 mt-0.5"><T k={errors.severity.message ?? ''} /></p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="발생 일시" /></label>
            <input type="datetime-local" {...register('occurredAt')} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="발생 장소" /></label>
            <input {...register('location')} placeholder={tAttr('예: 3층 내과병동 301호')} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="발생 병동 (선택)" /></label>
            {wards.isError
              ? <p className="text-[11px] text-gray-500" data-safety-report-ward="unavailable"><T k="병동 목록을 볼 권한이 없거나 불러오지 못했습니다 — 장소 칸에 적어 주십시오." /></p>
              : (
                <select {...register('wardId')} className="w-full px-3 py-2 border rounded-lg text-sm" data-safety-report-ward>
                  <option value="">{tAttr('병동 선택 안 함')}</option>
                  {(wards.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="위해 정도 (선택)" /></label>
            {harmLevels
              ? (
                <select {...register('harmLevel')} className="w-full px-3 py-2 border rounded-lg text-sm" data-safety-report-harm>
                  <option value="">{tAttr('위해 정도 선택 안 함')}</option>
                  {harmLevels.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              )
              : <p className="text-[11px] text-gray-500" data-safety-report-harm="unset"><T k={flow.isError ? '위해 정도 척도를 확인하지 못했습니다 — 비워 두고 보고합니다.' : '위해 정도 척도가 정해지지 않았습니다(결정 safety.harmLevelScale) — 비워 두고 보고합니다.'} /></p>}
          </div>
        </div>
        {errors.type && <p className="text-xs text-red-500 -mt-3"><T k={errors.type.message ?? ''} /></p>}
        {anonymousAllowed && (
          <label className="flex items-start gap-2 text-xs text-gray-700" data-safety-report-anonymous>
            <input type="checkbox" {...register('anonymous')} className="mt-0.5" />
            <span><T k="익명으로 보고 — 보고자가 원장에 남지 않습니다(본인도 이 보고를 '내 보고'로 다시 찾을 수 없습니다)." /></span>
          </label>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자 ID (선택)" /></label>
          <input {...register('patientId')} placeholder={tAttr('환자 ID (없으면 비워두세요)')} className="w-full px-3 py-2 border rounded-lg text-sm" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1"><T k="상세 설명" /></label>
          <textarea {...register('description')} rows={5} placeholder={tAttr('사고 경위, 환자 상태, 즉시 조치 사항 등을 상세히 기술하세요.')} className="w-full px-3 py-2 border rounded-lg text-sm resize-none" />
          {errors.description && <p className="text-xs text-red-500 mt-0.5"><T k={errors.description.message ?? ''} /></p>}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-700">
            {/* 🔴 종전 문구의 'SEVERE' 는 서버 통지 기준과 어긋난 어휘였다 — 실제 즉시통지는 위해·적신호 */}
            <strong><T k="참고:" /></strong> <b><T k="위해·적신호" /></b> <T k="사고는 보고 즉시 질관리·주치의에게 자동 통지되며, RCA(근본원인분석)가 필요합니다." />
          </p>
        </div>

        <button type="submit" disabled={reportMut.isPending}
          className="w-full py-3 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
          <T k={reportMut.isPending ? '보고 중...' : '사고 보고'} />
        </button>
      </form>
    </div>
  );
}

/* ── 환자 식별 통계 탭 (JCI IPSG.1) ── */
interface IdStats {
  window: { days: number | null; from: string | null; to: string | null; label: string };
  /** 🔴 관측이 있었는지 — "오류 없음"과 "관측 없음"을 가르는 유일한 근거 */
  hasObservations: boolean;
  overall: { total: number; pass: number; fail: number; verifyRate: number | null; failRate: number | null };
  byType: { key: string; label: string; fail: number; total: number; failRate: number | null }[];
  byMethod: { key: string; label: string; fail: number; total: number; failRate: number | null }[];
  recentFailures: { checkType: string; method: string; reason?: string | null; verifiedAt: string; patient: string | null }[];
}

/* 🔴 종전 로컬 `Pct` 는 표본 없음을 `-`(미측정)로 접고 분모를 잃었다 —
   정본 `<Ratio>`(분모와 함께·분모 0/미상이면 '산출 불가')로 수렴해 삭제했다. */

function IdentificationTab() {
  const tAttr = useTAttr();
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['id-check-stats'],
    queryFn: () => apiClient.get<{ data: IdStats }>('/api/v1/safety/identification-check/stats'),
  });
  const s = (data?.data as { data?: IdStats })?.data ?? (data?.data as IdStats | null);
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (!s) return <div className="text-center py-12 text-gray-400"><T k="통계 데이터를 불러오는 중..." /></div>;

  const observed = s.hasObservations;
  // 🔴 종전 `Math.max(rate, 2)` — 0% 에도 2% 폭이 칠해져 "오류가 조금 있다"로 보였다. 0 은 0 으로 그린다.
  const Bar = ({ rate }: { rate: number | null }) => (
    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
      {rate != null && rate > 0 && (
        <div className={`h-full ${rate < 2 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500"><T k="JCI IPSG.1 — 정확한 환자 확인 (" /><T k={s.window?.label ?? '최근 30일'} /><T k=", 두 가지 식별자/바코드/팔찌)" /></p>

      {/* 🔴 관측 0건을 '무사고'로 읽히게 두지 않는다 — 사실은 환자확인이 기록되지 않는 것 */}
      {!observed && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-800">
            <strong><T k="산출 불가 —" /></strong> <T k={s.window?.label ?? '해당 기간'} /><T k="에 환자 확인이" /> <strong><T k="한 건도 기록되지 않았습니다" /></strong><T k=". 성공률·오류율은 표본이 없어 계산할 수 없습니다(0% 가 아닙니다). 오류가 없다는 뜻이 아니라," /> <strong><T k="확인 자체가 기록되지 않는다" /></strong><T k="는 뜻입니다." />
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{s.overall.total}</p>
          <p className="text-[11px] text-gray-500 mt-0.5"><T k="총 식별 확인" /></p>
        </div>
        <div className={`rounded-2xl border p-4 text-center ${observed ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-200'}`}>
          {/* 🔴 비율은 분모와 함께(§2.1) — 관측 0건이면 정본 Ratio 가 '산출 불가'를 그린다 */}
          <p className={`text-2xl font-bold ${observed ? 'text-emerald-600' : 'text-gray-400'}`}><Ratio numerator={s.overall.pass} denominator={s.overall.total} pctOnly decimals={0} unavailableHint="관측 없음" /></p>
          <p className="text-[11px] text-gray-500 mt-0.5"><T k="식별 성공률" />{observed ? ` (${s.overall.pass}/${s.overall.total})` : ''}</p>
        </div>
        <div className={`rounded-2xl border p-4 text-center ${observed ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-200'}`}>
          <p className={`text-2xl font-bold ${observed ? 'text-red-600' : 'text-gray-400'}`}><Ratio numerator={s.overall.fail} denominator={s.overall.total} pctOnly decimals={0} unavailableHint="관측 없음" /></p>
          <p className="text-[11px] text-gray-500 mt-0.5"><T k="식별 오류율" />{observed ? ` (${s.overall.fail}/${s.overall.total})` : ''}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{s.overall.fail}</p>
          <p className="text-[11px] text-gray-500 mt-0.5"><T k="식별 오류 건수" /></p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="확인 유형별 오류율" /></h3>
          <div className="space-y-2">
            {s.byType.map((t) => (
              <div key={t.key} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-12"><T k={t.label} /></span>
                <Bar rate={t.failRate} />
                {/* 🔴 관측 0건인 확인유형을 `-` 로 접지 않는다 — 정본 `<Ratio>` 가 n/N 과 함께 산출 불가를 말한다 */}
                <span className="text-[11px] text-gray-700 w-24 text-right"><Ratio numerator={t.fail} denominator={t.total} unavailableHint="관측 없음" /></span>
              </div>
            ))}
            {!s.byType.length && <p className="text-[11px] text-gray-400"><T k="기록 없음" /></p>}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="확인 방법별 오류율" /></h3>
          <div className="space-y-2">
            {s.byMethod.map((m) => (
              <div key={m.key} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-16"><T k={m.label} /></span>
                <Bar rate={m.failRate} />
                <span className="text-[11px] text-gray-700 w-24 text-right"><Ratio numerator={m.fail} denominator={m.total} unavailableHint="관측 없음" /></span>
              </div>
            ))}
            {!s.byMethod.length && <p className="text-[11px] text-gray-400"><T k="기록 없음" /></p>}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="최근 식별 오류" /></h3>
        {s.recentFailures.length === 0 ? (
          // 🔴 안심 문구(초록 ✓)는 **관측이 있을 때만**. 표본 0 에는 근거가 없다.
          observed
            ? <p className="text-xs text-emerald-600"><T k={s.window?.label ?? '해당 기간'} /> <T k="식별 오류가 없습니다 ✓ (확인" /> {s.overall.total}<T k="건 중 0건)" /></p>
            : <p className="text-xs text-gray-500"><T k="기록된 환자 확인이 없어 오류 여부를 알 수 없습니다." /></p>
        ) : (
          <div className="space-y-2">
            {s.recentFailures.map((f, i) => (
              <div key={i} className="flex items-start gap-2 border-b border-gray-50 pb-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 whitespace-nowrap">{f.checkType}</span>
                <div className="min-w-0">
                  <p className="text-xs text-gray-800">{f.patient ?? '환자'} · {f.method}</p>
                  {f.reason && <p className="text-[11px] text-red-500">{f.reason}</p>}
                </div>
                <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">{fmtDateTime(f.verifiedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 신체보호대(Restraint) 관리 탭 ── */
interface RestraintItem {
  id: string; type: string; reason: string; bodyParts?: string[]; startedAt: string;
  consentObtained: boolean; status: string;
  patient: { familyName: string; givenName: string; mrn: string } | null;
  lastCheckedAt: string | null; lastCheckMinutesAgo: number | null; overdue: boolean;
  /** 처방 기한 경과(재오더 필요) · 점검 간격 초과 — 옛 서버면 없음 */
  expired?: boolean; monitoringOverdue?: boolean;
  /** 점검 간격(분)과 출처 — CONFIGURED 원내 설정 · CODE_DEFAULT 코드 기본값(원내 규정 미설정) · UNKNOWN 설정 조회 실패 */
  checkIntervalMinutes?: number; checkIntervalSource?: 'CONFIGURED' | 'SEED' | 'CODE_DEFAULT' | 'UNKNOWN';
}
const BODY_PARTS = ['좌측손목', '우측손목', '좌측발목', '우측발목', '체간'];

/* ═══════════════════════════════════════════════════════════════
   구두·전화 처방 복창(read-back) 미확인 워크리스트 — IPSG.2
   ═══════════════════════════════════════════════════════════════ */
/**
 * 🔴 이 탭이 없어서 확인 EP(`PATCH /api/v1/safety/read-back/:id`)는 **호출부가 0**이었다
 *    (2026-08-26 F3 고아 EP 회수). 발행 화면(`PrescriberDelegate`)의 체크박스는 저장 그 순간에만
 *    묻고, 체크하지 않은 건은 어느 화면에도 남지 않았다.
 *
 * 규칙:
 *  · **막지 않는다.** 구두처방을 못 내게 하면 환자가 방치된다 — 남은 일을 *줄어드는 목록*으로 보인다.
 *  · **자동으로 통과시키지 않는다.** 버튼 하나로 "복창했다"를 찍지 않고, 되읽어 확인했다는 진술을
 *    사람이 체크해야 확인 버튼이 열린다(v4.5.0 위급값 복창과 같은 장치).
 *  · **표본 부재를 '없음'으로 말하지 않는다.** 조회 실패는 QueryErrorFallback 으로 드러낸다.
 */
type PendingReadBack = {
  id: string;
  orderSource: string;
  type: string;
  drug: string | null;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  instructions?: string | null;
  createdAt: string;
  elapsedHours: number;
  enteredByName: string | null;
  prescriberName: string | null;
  patient: { id: string; name: string; mrn: string } | null;
};

const ORDER_SOURCE_LABEL: Record<string, string> = { VERBAL: '구두 지시(대면)', TELEPHONE: '전화 지시' };

function ReadBackTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  /** 🔴 초기값은 '미선택' — 확인문을 체크해야 버튼이 열린다(기본 참으로 두면 클릭 한 번에 통과한다) */
  const [heard, setHeard] = useState<Record<string, boolean>>({});

  const { data, isError, error, refetch } = useQuery({
    queryKey: ['read-back-pending'],
    queryFn: () => apiClient.get<{ data: { items: PendingReadBack[]; truncated: boolean } }>('/api/v1/safety/read-back/pending'),
    refetchInterval: pollMs('slow'),
  });
  const payload = ((data?.data as { data?: { items: PendingReadBack[]; truncated: boolean } })?.data ?? data?.data) as
    | { items: PendingReadBack[]; truncated: boolean } | undefined;
  const items = payload?.items ?? [];

  const confirmMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/safety/read-back/${id}`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['read-back-pending'] }); toast.success('복창 확인을 기록했습니다.'); },
    // 🔴 실패를 삼키지 않는다 — 서면 지시·중복 확인은 "확인되지 않았다"는 사실이다
    onError: (e) => toast.error((e as { message?: string })?.message || '복창 확인 기록에 실패했습니다'),
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-gray-900"><T k="구두·전화 처방 복창(read-back) 미확인" /></h3>
            <p className="text-xs text-gray-500 mt-1">
              <T k="받아 적은 지시를 지시한 의사에게 되읽어 확인했는지 기록합니다." /> <b><T k="서면·전자 지시는 이 목록에 없습니다" /></b>
              <T k="(복창 개념이 없는 건을 ‘누락’으로 세지 않습니다)." />
            </p>
          </div>
          {!isError && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap">{items.length}<Unit><T k="건" /></Unit></span>}
        </div>

        {isError ? (
          <div className="mt-3">
            <p className="text-xs font-medium text-red-700 mb-1.5"><T k="미확인 목록을 불러오지 못했습니다 — 남은 건이 있는지 알 수 없습니다." /></p>
            <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
          </div>
        ) : items.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="복창 미확인 건 없음" hint="구두·전화 지시로 기록된 처방 중 복창이 확인되지 않은 건이 없습니다." />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {payload?.truncated && (
              <p className="text-[11px] text-amber-700"><T k="목록이 상한(100건)에서 잘렸습니다 — 표시된 것이 전부가 아닙니다." /></p>
            )}
            {items.map(it => {
              const ok = !!heard[it.id];
              return (
                <div key={it.id} className="border border-amber-100 bg-amber-50/40 rounded-xl p-3">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-600 text-white whitespace-nowrap">
                      <T k={ORDER_SOURCE_LABEL[it.orderSource] ?? it.orderSource} />
                    </span>
                    <span className="font-medium text-gray-800">
                      {it.patient ? <>{it.patient.name} <span className="text-gray-400">{it.patient.mrn}</span></> : <span className="text-gray-400"><T k="환자 정보 없음" /></span>}
                    </span>
                    <span className="text-gray-600">{it.drug ?? '—'}{it.dosage ? ` · ${it.dosage}` : ''}{it.frequency ? ` · ${it.frequency}` : ''}{it.route ? ` · ${it.route}` : ''}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {fmtDateTime(it.createdAt)} <T k="입력 · 경과" /> {it.elapsedHours}<Unit><T k="시간" /></Unit>
                    {' · 입력 '}{it.enteredByName ?? '—'}
                    {it.prescriberName ? ` · 책임 처방의 ${it.prescriberName}` : ''}
                  </p>
                  {it.instructions && <p className="mt-1 text-[11px] text-gray-600"><T k="지시:" /> {it.instructions}</p>}

                  <label className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-gray-700">
                    <input type="checkbox" checked={ok} className="mt-0.5"
                      onChange={(e) => setHeard(prev => ({ ...prev, [it.id]: e.target.checked }))} />
                    <span>
                      <T k="위 내용을" /> <b><T k="지시한 의사에게 되읽어(read-back) 확인" /></b><T k="했습니다." />
                      <span className="block text-gray-500"><T k="확인하지 않았다면 체크하지 마세요 — 미확인 상태로 그대로 남습니다." /></span>
                    </span>
                  </label>
                  <button
                    onClick={() => confirmMut.mutate(it.id)}
                    disabled={!ok || confirmMut.isPending}
                    className="mt-2 min-h-[44px] px-4 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-40">
                    <T k="복창 확인 기록" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-[10px] text-gray-400">
          <T k="⚖️ JCI IPSG.2 — 구두·전화 지시는 받아 적고 되읽어 확인해야 합니다. 확인 시각은" /> <b><T k="지금" /></b><T k="으로 기록되며 소급 입력되지 않습니다(입력 시각과의 간격이 그대로 남습니다)." />
        </p>
      </div>
    </div>
  );
}

function RestraintTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [monitorId, setMonitorId] = useState<string | null>(null);
  const [form, setForm] = useState<{ mrn: string; type: string; reason: string; bodyParts: string[]; consentObtained: boolean }>({ mrn: '', type: 'PHYSICAL', reason: '', bodyParts: [], consentObtained: false });
  const [mon, setMon] = useState({ circulation: 'NORMAL', skinIntegrity: 'INTACT', rangeOfMotion: false, repositioned: false, continued: true });

  const { data, isError, error, refetch } = useQuery({
    queryKey: ['restraints-active'],
    queryFn: () => apiClient.get<{ data: RestraintItem[] }>('/api/v1/safety/restraints/active'),
    refetchInterval: pollMs('slow'),
  });
  const items = ((data?.data as { data?: RestraintItem[] })?.data ?? data?.data ?? []) as RestraintItem[];

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/safety/restraints', form),
    onSuccess: () => { setShowNew(false); setForm({ mrn: '', type: 'PHYSICAL', reason: '', bodyParts: [], consentObtained: false }); qc.invalidateQueries({ queryKey: ['restraints-active'] }); toast.success('신체보호대 처방 등록됨'); },
    onError: (e: { message?: string }) => toast.error(e?.message || '등록 실패'),
  });
  const monitorMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/safety/restraints/${id}/monitoring`, mon),
    onSuccess: () => { setMonitorId(null); setMon({ circulation: 'NORMAL', skinIntegrity: 'INTACT', rangeOfMotion: false, repositioned: false, continued: true }); qc.invalidateQueries({ queryKey: ['restraints-active'] }); toast.success('점검 기록됨'); },
  });
  const discontinueMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/safety/restraints/${id}/discontinue`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['restraints-active'] }); toast.success('해제됨'); },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500" data-restraint-interval={items[0]?.checkIntervalSource ?? 'NONE'}>
          <T k="환자 권리·안전 — 적용 중 신체보호대" />
          {/* 🔴 점검 간격은 원내 규정 — 서버가 준 값과 출처를 그대로(종전 '2시간마다' 고정 문구) · 적용 중이 없으면 간격을 지어내지 않는다 */}
          {items[0]?.checkIntervalMinutes != null && (
            <> · <Tf k="점검 간격 {분}분" params={{ 분: items[0].checkIntervalMinutes }} />
              {items[0].checkIntervalSource === 'CODE_DEFAULT' && <span className="text-amber-700"> (<T k="코드 기본값 — 원내 규정 미설정" />)</span>}
              {items[0].checkIntervalSource === 'UNKNOWN' && <span className="text-amber-700"> (<T k="설정 확인 불가 — 코드 기본값으로 감시" />)</span>}
              {items[0].checkIntervalSource === 'SEED' && <span className="text-violet-700"> (<T k="개발 시드 — 원내 규정 아님" />)</span>}
            </>
          )}
        </p>
        <button onClick={() => setShowNew(v => !v)} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"><T k="+ 신규 처방" /></button>
      </div>

      {showNew && (
        <div className="bg-white rounded-2xl border border-blue-200 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.mrn} onChange={e => setForm({ ...form, mrn: e.target.value })} placeholder={tAttr('환자번호(MRN)')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-1">
              {[{ k: 'PHYSICAL', l: '신체' }, { k: 'CHEMICAL', l: '약물' }].map(t => (
                <button key={t.k} onClick={() => setForm({ ...form, type: t.k })} className={`flex-1 py-2 text-xs rounded-lg border ${form.type === t.k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200'}`}>{t.l}</button>
              ))}
            </div>
          </div>
          <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={2} placeholder={tAttr('적용 사유 (예: 자해/낙상 위험, 치료선 유지)')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" />
          <div className="flex flex-wrap gap-1.5">
            {BODY_PARTS.map(p => (
              <button key={p} onClick={() => setForm({ ...form, bodyParts: form.bodyParts.includes(p) ? form.bodyParts.filter(x => x !== p) : [...form.bodyParts, p] })}
                className={`px-2.5 py-1 text-[11px] rounded-full border ${form.bodyParts.includes(p) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>{p}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={form.consentObtained} onChange={e => setForm({ ...form, consentObtained: e.target.checked })} className="rounded" /> <T k="보호자 동의 획득" />
          </label>
          <button onClick={() => createMut.mutate()} disabled={!form.mrn.trim() || !form.reason.trim() || createMut.isPending} className="w-full min-h-[44px] px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50"><T k="처방 등록" /></button>
        </div>
      )}

      {/* 🔴 조회 실패를 "적용 중인 신체보호대 없음"으로 말하지 않는다(안심시키는 거짓말) */}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : items.length === 0 ? (
        <EmptyState icon="📋" title="적용 중인 신체보호대가 없습니다" />
      ) : (
        <div className="space-y-3">
          {items.map(r => (
            <div key={r.id} className={`bg-white rounded-2xl border p-4 ${r.overdue ? 'border-red-300' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{r.patient ? `${r.patient.familyName}${r.patient.givenName} · ${r.patient.mrn}` : '환자'}</p>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"><T k={r.type === 'PHYSICAL' ? '신체' : '약물'} /></span>
                    {!r.consentObtained && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700"><T k="동의 미획득" /></span>}
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{r.reason}</p>
                  {r.bodyParts && r.bodyParts.length > 0 && <p className="text-[11px] text-gray-400 mt-0.5"><T k="부위:" /> {r.bodyParts.join(', ')}</p>}
                </div>
                <div className="text-right">
                  {/* 처방 기한 경과와 점검 지연은 다른 일이다(재오더 vs 점검) — 둘 다면 둘 다 */}
                  {r.expired && <span className="mr-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700" data-restraint-expired><T k="처방 기한 경과 — 재평가·재오더" /></span>}
                  {(r.monitoringOverdue ?? (r.overdue && !r.expired))
                    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700" data-restraint-overdue>{r.lastCheckMinutesAgo == null ? <T k="⏰ 점검 기록 없음" /> : <T k="⏰ 점검 필요" />}</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{r.lastCheckMinutesAgo}<Unit><T k="분" /></Unit> <T k="전 점검" /></span>}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setMonitorId(monitorId === r.id ? null : r.id)} className="flex-1 py-1.5 bg-blue-50 text-blue-700 text-xs font-medium rounded-lg hover:bg-blue-100"><T k="🔍 점검 기록" /></button>
                <button onClick={() => { if (confirm('신체보호대를 해제하시겠습니까?')) discontinueMut.mutate(r.id); }} className="min-h-[44px] px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"><T k="해제" /></button>
              </div>
              {monitorId === r.id && (
                <div className="mt-3 bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {[{ k: 'circulation', l: '말초순환', opts: [['NORMAL', '정상'], ['IMPAIRED', '저하']] }, { k: 'skinIntegrity', l: '피부상태', opts: [['INTACT', '정상'], ['INJURY', '손상']] }].map(field => (
                      <div key={field.k}>
                        <label className="text-[10px] font-semibold text-gray-500 block mb-1">{field.l}</label>
                        <div className="flex gap-1">
                          {field.opts.map(([v, l]) => (
                            <button key={v} onClick={() => setMon({ ...mon, [field.k]: v })} className={`flex-1 py-1.5 text-[11px] rounded-lg border ${(mon as Record<string, unknown>)[field.k] === v ? (v === 'IMPAIRED' || v === 'INJURY' ? 'border-red-400 bg-red-50 text-red-700' : 'border-blue-500 bg-blue-50 text-blue-700') : 'border-gray-200 text-gray-600'}`}>{l}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 text-[11px] text-gray-600">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={mon.rangeOfMotion} onChange={e => setMon({ ...mon, rangeOfMotion: e.target.checked })} className="rounded" /> <T k="관절가동운동" /></label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={mon.repositioned} onChange={e => setMon({ ...mon, repositioned: e.target.checked })} className="rounded" /> <T k="체위변경" /></label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={!mon.continued} onChange={e => setMon({ ...mon, continued: !e.target.checked })} className="rounded" /> <T k="지속 불필요(해제)" /></label>
                  </div>
                  <button onClick={() => monitorMut.mutate(r.id)} disabled={monitorMut.isPending} className="w-full min-h-[44px] px-3 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"><T k="점검 기록 저장" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-400"><T k="⚖️ 신체보호대는 최소 범위·최단 기간 적용, 정기 점검(순환/피부/가동)과 재평가가 필요합니다." /></p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   근본원인분석(RCA) 탭

   🔴 조회 화면이 없어 "RCA 완료 0"이 영구 고정돼 있었다(2026-08-14·W7).
      `rca_reports` 에 실데이터가 있는데도(status=OPEN·미승인·기한 2026-09-04)
      목록 EP(`GET /safety/rca`)·상세 EP(`GET /safety/incidents/:id/rca`)·
      승인 EP(`POST /safety/incidents/:id/rca/approve`) 를 **부르는 FE 코드가 0건**이었다.
      45일 기한 초과 크론이 `rca.overdue` 를 쏴도 열어볼 화면이 없었다.
      (이 저장소 교훈: **EP 를 만들면 부르는 화면까지가 한 벌**)
      대시보드의 "RCA 완료 0"은 **사실**이므로(1건은 미승인) 숫자는 손대지 않고,
      진행 중 RCA 가 보이도록 화면을 배선한다.
   ═══════════════════════════════════════════════════════════════ */

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
}

/* ── RCA 기여요인·개선계획 입력 ──────────────────────────────────────────────
   🔴 종전 이 화면은 `contributingFactors`·`actionPlan` 을 **읽기만** 했고(<ul>),
      쓰는 코드가 **0줄**이었다. 운영 DB 채움 5/15 는 전부 시드다 —
      근본원인분석은 사람이 쓰는 것이므로 입력 경로가 없으면 영원히 시드만 남는다.
      (EP 는 이미 있었다: PATCH /safety/incidents/:id/rca — "EP 를 만들면 부르는 화면까지가 한 벌") */

interface ActionItem { action: string; owner?: string; due?: string }

/** 저장된 개선계획 JSON → 화면 구조. 🔴 모양을 모르는 항목은 **버리지 않고 센다**(자르면 잘랐다고 말한다). */
function readActionPlan(v: unknown): { items: ActionItem[]; unreadable: number } {
  if (!Array.isArray(v)) return { items: [], unreadable: 0 };
  const items: ActionItem[] = [];
  let unreadable = 0;
  for (const x of v) {
    if (typeof x === 'string') { items.push({ action: x }); continue; }
    if (x && typeof x === 'object' && typeof (x as Record<string, unknown>).action === 'string') {
      const o = x as Record<string, unknown>;
      items.push({
        action: String(o.action),
        owner: typeof o.owner === 'string' ? o.owner : undefined,
        due: typeof o.due === 'string' ? o.due : undefined,
      });
      continue;
    }
    unreadable++;
  }
  return { items, unreadable };
}

function ActionPlanView({ value }: { value: unknown }) {
  const { items, unreadable } = readActionPlan(value);
  if (!items.length && !unreadable) return <p className="text-xs text-gray-400"><T k="미작성" /></p>;
  return (
    <>
      <ul className="text-xs text-gray-700 list-disc pl-4 space-y-0.5">
        {items.map((a, i) => (
          <li key={i}>
            {a.action}
            {(a.owner || a.due) && <span className="text-gray-400"> · {[a.owner, a.due].filter(Boolean).join(' / ')}</span>}
          </li>
        ))}
      </ul>
      {unreadable > 0 && <p className="text-[10px] text-amber-600 mt-1"><T k="형식을 알 수 없는 항목" /> {unreadable}<T k="건은 표시하지 않았습니다" /></p>}
    </>
  );
}

/** RCA 작성 폼 — findings · 기여요인(문자열 목록) · 개선계획(조치/담당/기한) */
function RcaEditor({
  rca, onSave, saving,
}: { rca: RcaRow; onSave: (body: Record<string, unknown>) => void; saving: boolean }) {
  const tAttr = useTAttr();
  const [findings, setFindings] = useState(rca.findings ?? '');
  const [factors, setFactors] = useState<string[]>(() => asStringList(rca.contributingFactors));
  const [plan, setPlan] = useState<ActionItem[]>(() => readActionPlan(rca.actionPlan).items);

  const setFactor = (i: number, v: string) => setFactors(f => f.map((x, j) => (j === i ? v : x)));
  const setPlanField = (i: number, k: keyof ActionItem, v: string) =>
    setPlan(p => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const submit = () => {
    // 🔴 빈 줄은 저장하지 않는다(빈 항목이 '기여요인 3건'으로 세어지면 분석이 있었던 것처럼 보인다)
    const cleanFactors = factors.map(f => f.trim()).filter(Boolean);
    const cleanPlan = plan
      .map(a => ({ action: a.action.trim(), owner: a.owner?.trim() || undefined, due: a.due?.trim() || undefined }))
      .filter(a => a.action);
    onSave({
      findings: findings.trim(),
      contributingFactors: cleanFactors,
      actionPlan: cleanPlan,
    });
  };

  return (
    <div className="space-y-3 pt-2 border-t">
      <div>
        <label className="block text-[10px] text-gray-500 font-medium mb-1"><T k="근본원인(findings)" /></label>
        <textarea value={findings} onChange={e => setFindings(e.target.value)} rows={3}
          placeholder={tAttr('왜 일어났는가 — 개인의 실수가 아니라 시스템 원인으로 기술합니다.')}
          className="w-full px-2 py-1.5 border rounded-lg text-xs resize-none" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-gray-500 font-medium"><T k="기여요인" /></label>
          <button type="button" onClick={() => setFactors(f => [...f, ''])}
            className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded hover:bg-gray-200"><T k="+ 추가" /></button>
        </div>
        {factors.length === 0 && <p className="text-[10px] text-gray-400"><T k="아직 없습니다. ‘+ 추가’로 입력하세요." /></p>}
        <div className="space-y-1">
          {factors.map((f, i) => (
            <div key={i} className="flex gap-1">
              <input value={f} onChange={e => setFactor(i, e.target.value)} placeholder={tAttr('예: 인수인계 정보 누락')}
                className="flex-1 px-2 py-1 border rounded-lg text-xs" />
              <button type="button" onClick={() => setFactors(x => x.filter((_, j) => j !== i))}
                className="px-1.5 text-gray-400 hover:text-red-500 text-xs">&times;</button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-gray-500 font-medium"><T k="개선계획" /></label>
          <button type="button" onClick={() => setPlan(p => [...p, { action: '' }])}
            className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded hover:bg-gray-200"><T k="+ 추가" /></button>
        </div>
        {plan.length === 0 && <p className="text-[10px] text-gray-400"><T k="아직 없습니다. ‘+ 추가’로 입력하세요." /></p>}
        <div className="space-y-1.5">
          {plan.map((a, i) => (
            <div key={i} className="space-y-1 bg-gray-50 rounded-lg p-2">
              <div className="flex gap-1">
                <input value={a.action} onChange={e => setPlanField(i, 'action', e.target.value)} placeholder={tAttr('개선 조치')}
                  className="flex-1 px-2 py-1 border rounded-lg text-xs" />
                <button type="button" onClick={() => setPlan(x => x.filter((_, j) => j !== i))}
                  className="px-1.5 text-gray-400 hover:text-red-500 text-xs">&times;</button>
              </div>
              <div className="flex gap-1">
                <input value={a.owner ?? ''} onChange={e => setPlanField(i, 'owner', e.target.value)} placeholder={tAttr('담당(부서)')}
                  className="flex-1 px-2 py-1 border rounded-lg text-xs" />
                <input value={a.due ?? ''} onChange={e => setPlanField(i, 'due', e.target.value)} placeholder={tAttr('기한(예: 30일)')}
                  className="flex-1 px-2 py-1 border rounded-lg text-xs" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <button type="button" onClick={submit} disabled={saving}
        className="w-full min-h-[44px] px-3 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
        <T k={saving ? '저장 중...' : 'RCA 내용 저장'} />
      </button>
    </div>
  );
}

function RcaTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rca-list', statusFilter],
    queryFn: () => apiClient.get<{ data: RcaRow[] }>('/api/v1/safety/rca', { status: statusFilter || undefined }),
  });
  const raw = data?.data;
  const rows: RcaRow[] = Array.isArray(raw) ? raw : (raw as unknown as { data: RcaRow[] })?.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['rca-list'] });
    qc.invalidateQueries({ queryKey: ['safety-stats'] });
    qc.invalidateQueries({ queryKey: ['incidents'] });
  };
  const updateMut = useMutation({
    mutationFn: ({ incidentId, body }: { incidentId: string; body: Record<string, unknown> }) =>
      apiClient.patch(`/api/v1/safety/incidents/${incidentId}/rca`, body),
    onSuccess: () => { invalidate(); toast.success('RCA가 갱신되었습니다.'); },
    onError: (e: { message?: string }) => toast.error(e?.message || 'RCA 갱신에 실패했습니다.'),
  });
  const approveMut = useMutation({
    mutationFn: (incidentId: string) => apiClient.post(`/api/v1/safety/incidents/${incidentId}/rca/approve`, {}),
    onSuccess: () => { invalidate(); toast.success('RCA를 승인했습니다.'); },
    onError: (e: { message?: string }) => toast.error(e?.message || '승인에 실패했습니다. (승인 권한: 의사·관리자)'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const selected = rows.find(r => r.id === selectedId);
  const overdueCount = rows.filter(r => r.overdue).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-gray-500"><T k="JCI QPS.7 — 적신호사건 근본원인분석. 기한" /> <b><T k="45일" /></b><T k=", 승인되어야 ‘RCA 완료’로 집계됩니다." /></p>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="ml-auto px-3 py-1.5 border rounded-lg text-xs">
          <option value="">{tAttr('상태 전체')}</option>
          {Object.entries(RCA_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-xs text-gray-400 self-center">{rows.length}<Unit><T k="건" /></Unit></span>
      </div>

      {overdueCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-xs text-red-700"><T k="⏰ 기한(45일)을 넘긴 미완료 RCA" /> <strong>{overdueCount}<Unit><T k="건" /></Unit></strong> <T k="— 담당자 확인이 필요합니다." /></p>
        </div>
      )}

      <div className="flex gap-6">
        <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="사건" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="중증도" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="RCA 상태" /></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"><T k="기한" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="로딩 중..." /></td></tr> :
               rows.length === 0 ? <tr><td colSpan={4} className="py-12 text-center text-gray-400"><T k="진행 중인 RCA가 없습니다" /></td></tr> :
               rows.map(r => (
                <tr key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`cursor-pointer transition-colors ${selectedId === r.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3 text-xs text-gray-700">
                    {/* 🔴 사건이 없으면 만들어내지 않는다 — 관계 부재를 그대로 밝힌다 */}
                    {r.incident
                      ? <>
                          <span className="font-medium">{r.incident.typeLabel ?? incidentTypeLabel(r.incident.type)}</span>
                          <span className="text-gray-400"> · {fmtDate(r.incident.occurredAt)}</span>
                          <p className="text-[11px] text-gray-500 truncate max-w-[280px]">{r.incident.description}</p>
                        </>
                      : <span className="text-gray-400"><T k="원 사건을 찾을 수 없음" /></span>}
                  </td>
                  <td className="px-4 py-3">{r.incident ? <SeverityBadge raw={r.incident.severity} /> : <span className="text-xs text-gray-400">-</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RCA_STATUS_COLOR[r.status] ?? 'bg-gray-100 text-gray-600'}`}><T k={RCA_STATUS_LABEL[r.status] ?? r.status} /></span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.dueAt
                      ? <span className={r.overdue ? 'text-red-600 font-bold' : 'text-gray-500'}>
                          {fmtDate(r.dueAt)}{r.overdue ? ` (${Math.abs(r.daysToDue ?? 0)}일 초과)` : r.daysToDue != null ? ` (D-${r.daysToDue})` : ''}
                        </span>
                      : <span className="text-gray-400"><T k="기한 없음" /></span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="w-[360px] shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900"><T k="RCA 상세" /></h3>
              <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center"><span className="text-gray-500"><T k="상태" /></span>
                <span className={`font-bold px-2 py-0.5 rounded-full ${RCA_STATUS_COLOR[selected.status] ?? 'bg-gray-100 text-gray-600'}`}><T k={RCA_STATUS_LABEL[selected.status] ?? selected.status} /></span>
              </div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="기한" /></span><span className={selected.overdue ? 'text-red-600 font-bold' : ''}><T k={selected.dueAt ? fmtDate(selected.dueAt) : '기한 없음'} /></span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="승인" /></span><span>{selected.approvedAt ? `✅ ${fmtDateTime(selected.approvedAt)}` : '미승인'}</span></div>
              {selected.incident && (
                <div className="flex justify-between items-center"><span className="text-gray-500"><T k="원 사건" /></span>
                  <span className="text-right">{selected.incident.typeLabel ?? incidentTypeLabel(selected.incident.type)} · {fmtDate(selected.incident.occurredAt)}</span>
                </div>
              )}
            </div>

            {selected.incident?.description && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-500 font-medium mb-1"><T k="사건 경위" /></p>
                <p className="text-xs text-gray-700">{selected.incident.description}</p>
              </div>
            )}

            {/* 🔴 승인된 RCA 는 읽기 전용 — 승인 이후 수정은 법정기록 변조다(서버도 400 으로 거절한다) */}
            {selected.status === 'APPROVED' ? (
              <>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 font-medium mb-1"><T k="근본원인(findings)" /></p>
                  {/* 🔴 미작성은 빈칸이 아니라 '미작성'으로 — 없는 내용을 지어내지 않는다 */}
                  <p className="text-xs text-gray-700">{selected.findings || <span className="text-gray-400"><T k="미작성" /></span>}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 font-medium mb-1"><T k="기여요인" /></p>
                  {asStringList(selected.contributingFactors).length
                    ? <ul className="text-xs text-gray-700 list-disc pl-4 space-y-0.5">{asStringList(selected.contributingFactors).map((f, i) => <li key={i}>{f}</li>)}</ul>
                    : <p className="text-xs text-gray-400"><T k="미작성" /></p>}
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 font-medium mb-1"><T k="개선계획" /></p>
                  <ActionPlanView value={selected.actionPlan} />
                </div>
              </>
            ) : (
              <RcaEditor
                key={selected.id}
                rca={selected}
                saving={updateMut.isPending}
                onSave={(body) => updateMut.mutate({ incidentId: selected.incidentId, body })}
              />
            )}

            {selected.status !== 'APPROVED' && (
              <div className="space-y-1.5 pt-2 border-t">
                <div className="flex gap-1.5">
                  {selected.status === 'OPEN' && (
                    <button onClick={() => updateMut.mutate({ incidentId: selected.incidentId, body: { status: 'IN_PROGRESS' } })}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"><T k="분석 시작" /></button>
                  )}
                  {selected.status === 'IN_PROGRESS' && (
                    <button onClick={() => updateMut.mutate({ incidentId: selected.incidentId, body: { status: 'COMPLETED' } })}
                      className="flex-1 min-h-[48px] py-3 text-sm font-semibold bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200"><T k="분석 완료(승인 요청)" /></button>
                  )}
                  <button onClick={() => { if (confirm('RCA를 승인 처리합니다. 사건의 RCA 완료로 집계됩니다.')) approveMut.mutate(selected.incidentId); }}
                    disabled={approveMut.isPending}
                    className="flex-1 min-h-[48px] py-3 text-sm font-semibold bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 disabled:opacity-50"><T k="승인(완료)" /></button>
                </div>
                <p className="text-[10px] text-gray-400"><T k="승인은 의사·관리자만 가능합니다." /></p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
