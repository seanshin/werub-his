'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { pollMs } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { AI_ORIGIN_TEXT, RATIO_UNAVAILABLE, type ServerMessage } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { ServerText } from '@/components/ui/server-text';

// ── Types ──

interface MappingStats {
  totalCodes: number;
  totalMappings: number;
  mappingRate: number;
  /** 매핑된 코드 수(중복 제거) — 서버 실측. 없으면(구 API) 파생 수치를 그리지 않는다 */
  mappedDistinctTotal?: number;
  pendingCount: number;
  bySystem: { system: string; count: number }[];
  /** 표준별 분자·분모 실측 — 분모=엔진 적용 정책(isApplicable)×코드 마스터 카운트 */
  systemCoverage?: { system: string; mapped: number; applicableTotal: number; applicableTables: string[]; outOfPolicyMapped?: number; unknownSourceMapped: number }[];
  byCodeType: { diagnosis: number; procedure: number; medication: number; labTest: number };
  /** 유형별 매핑된 코드 수(중복 제거·시스템 불문) — 서버 실측 */
  mappedByType?: { diagnosis: number; procedure: number; medication: number; labTest: number };
}

interface MappingCandidate {
  targetCode: string;
  targetDisplay: string;
  confidence: number;
  method: string;
  reason: string;
}

interface PendingMapping {
  id: string;
  sourceTable: string;
  sourceCode: string;
  sourceName: string;
  targetSystem: string;
  candidates: MappingCandidate[];
  bestCandidate: string | null;
  bestConfidence: number | null;
  status: string;
  reviewedBy: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

interface BatchJob {
  id: string;
  sourceTable: string;
  targetSystem: string;
  totalCodes: number;
  processedCodes: number;
  confirmedCount: number;
  pendingCount: number;
  failedCount: number; // 신뢰도 미달
  // 🔴 종전에는 위 하나에 전부 뭉쳐 있었다 — 구버전 배치는 이 필드가 없을 수 있어 옵셔널
  notApplicableCount?: number;
  noCandidateCount?: number;
  errorCount?: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ── System Labels ──

const SYS_META: Record<string, { label: string; color: string; fullName: string }> = {
  SNOMED_CT: { label: 'SNOMED CT', color: 'bg-blue-100 text-blue-700', fullName: 'SNOMED Clinical Terms' },
  LOINC: { label: 'LOINC', color: 'bg-emerald-100 text-emerald-700', fullName: 'Logical Observation Identifiers Names and Codes' },
  ICD10PCS: { label: 'ICD-10-PCS', color: 'bg-violet-100 text-violet-700', fullName: 'Procedure Coding System' },
  MedDRA: { label: 'MedDRA', color: 'bg-rose-100 text-rose-700', fullName: 'Medical Dictionary for Regulatory Activities' },
  ICF: { label: 'ICF', color: 'bg-amber-100 text-amber-700', fullName: 'International Classification of Functioning' },
};

const SOURCE_LABEL: Record<string, string> = {
  diagnosis_codes: '진단코드 (KCD)',
  procedure_codes: '수가코드 (EDI)',
  medication_codes: '약품코드',
  lab_test_codes: '검사항목 (LOINC)',
};

// ── Sub-tab type ──

type SubTab = 'dashboard' | 'pending' | 'clinical' | 'bulk' | 'settings';

// ═══════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════

export default function AutoMappingDashboard() {
  const [subTab, setSubTab] = useState<SubTab>('dashboard');

  return (
    <div className="space-y-6">
      {/* Sub Navigation */}
      <div className="flex gap-1.5 border-b border-gray-200 pb-0">
        {([
          { key: 'dashboard', label: '매핑 현황', icon: ChartIcon },
          { key: 'clinical', label: '임상 검토', icon: ClinicalIcon },
          { key: 'pending', label: '관리자 승인', icon: ClockIcon },
          { key: 'bulk', label: `${AI_ORIGIN_TEXT} 일괄 매핑`, icon: BotIcon },
          { key: 'settings', label: '매핑 설정', icon: GearIcon },
        ] as { key: SubTab; label: string; icon: () => React.ReactNode }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
              subTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon()}
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'dashboard' && <DashboardPanel />}
      {subTab === 'clinical' && <ClinicalReviewPanel />}
      {subTab === 'pending' && <PendingPanel />}
      {subTab === 'bulk' && <BulkMappingPanel />}
      {subTab === 'settings' && <SettingsPanel />}
    </div>
  );
}

// ═══════════════════════════════════════════
// §4.0 Clinical Review Panel (의료진/간호 검토)
// ═══════════════════════════════════════════

interface ClinicalReviewStats {
  awaiting: number;
  approved: number;
  rejected: number;
  byDepartment: { department: string | null; count: number }[];
  byTargetSystem: { system: string; count: number }[];
}

const ROLE_LABEL: Record<string, { label: string; color: string }> = {
  DOCTOR: { label: '의사', color: 'bg-blue-100 text-blue-700' },
  NURSE: { label: '간호사', color: 'bg-pink-100 text-pink-700' },
  PHARMACIST: { label: '약사', color: 'bg-teal-100 text-teal-700' },
};

const REVIEW_GUIDE: Record<string, { role: string; desc: string }> = {
  diagnosis_codes: { role: 'DOCTOR', desc: '진단코드(KCD) → SNOMED CT 매핑은 담당 진료과 의사가 임상 적절성을 검토합니다.' },
  procedure_codes: { role: 'DOCTOR', desc: '수가코드(EDI) → SNOMED CT/ICD-10-PCS 매핑은 시술 담당 의사가 검토합니다.' },
  medication_codes: { role: 'PHARMACIST', desc: '약품코드 → MedDRA 부작용 매핑은 약제팀이 약물 안전성 관점에서 검토합니다.' },
  lab_test_codes: { role: 'DOCTOR', desc: '검사항목 → LOINC 매핑은 진단검사의학과 전문의가 검토합니다.' },
};

function ClinicalReviewPanel() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'AWAITING' | 'APPROVED' | 'REJECTED'>('AWAITING');
  const [deptFilter, setDeptFilter] = useState('');
  const [systemFilter, setSystemFilter] = useState('');

  const { data: statsData } = useQuery<{ data: ClinicalReviewStats }>({
    queryKey: ['clinical-review-stats'],
    queryFn: () => apiClient.get('/api/v1/codes/clinical-review/stats'),
    refetchInterval: pollMs('fast'),
  });

  const { data: listData, isLoading } = useQuery<{ data: PendingMapping[] }>({
    queryKey: ['clinical-review', filter, deptFilter, systemFilter],
    queryFn: () => apiClient.get(`/api/v1/codes/clinical-review?clinicalStatus=${filter}${deptFilter ? `&department=${deptFilter}` : ''}${systemFilter ? `&targetSystem=${systemFilter}` : ''}`),
  });

  const approveMut = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      apiClient.post(`/api/v1/codes/clinical-review/${id}/approve`, { notes }),
    onSuccess: () => { toast.success('임상 검토 승인'); qc.invalidateQueries({ queryKey: ['clinical-review'] }); qc.invalidateQueries({ queryKey: ['clinical-review-stats'] }); },
    onError: () => toast.error('승인 실패'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      apiClient.post(`/api/v1/codes/clinical-review/${id}/reject`, { notes }),
    onSuccess: () => { toast.success('임상 검토 반려'); qc.invalidateQueries({ queryKey: ['clinical-review'] }); qc.invalidateQueries({ queryKey: ['clinical-review-stats'] }); },
    onError: () => toast.error('반려 실패'),
  });

  const stats = statsData?.data;
  const items = listData?.data ?? [];

  return (
    <div className="space-y-6">
      {/* 워크플로우 안내 */}
      <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
        <h4 className="text-xs font-semibold text-blue-800 mb-2"><T k="임상 검토 워크플로우" /></h4>
        <div className="flex items-center gap-3 text-[11px] text-blue-600">
          <span className="bg-white rounded-lg px-3 py-1.5 border border-blue-200 font-medium">{AI_ORIGIN_TEXT} 자동 매핑</span>
          <span className="text-blue-300">→</span>
          <span className="bg-blue-600 text-white rounded-lg px-3 py-1.5 font-medium"><T k="임상 검토 (현재)" /></span>
          <span className="text-blue-300">→</span>
          <span className="bg-white rounded-lg px-3 py-1.5 border border-blue-200 font-medium"><T k="관리자 최종 승인" /></span>
          <span className="text-blue-300">→</span>
          <span className="bg-white rounded-lg px-3 py-1.5 border border-blue-200 font-medium"><T k="매핑 확정" /></span>
        </div>
        <p className="text-[10px] text-blue-500 mt-2">의료진/간호사/약사가 {AI_ORIGIN_TEXT} 매핑의 임상 적절성을 검토합니다. 임상 승인된 건만 관리자 최종 승인 단계로 넘어갑니다.</p>
      </div>

      {/* 통계 카드 */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-amber-50 rounded-2xl p-4">
            <div className="text-[11px] font-medium text-amber-600"><T k="검토 대기" /></div>
            <div className="text-2xl font-bold text-amber-700">{stats.awaiting}</div>
          </div>
          <div className="bg-emerald-50 rounded-2xl p-4">
            <div className="text-[11px] font-medium text-emerald-600"><T k="임상 승인" /></div>
            <div className="text-2xl font-bold text-emerald-700">{stats.approved}</div>
          </div>
          <div className="bg-red-50 rounded-2xl p-4">
            <div className="text-[11px] font-medium text-red-600"><T k="임상 반려" /></div>
            <div className="text-2xl font-bold text-red-700">{stats.rejected}</div>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1.5">
          {(['AWAITING', 'APPROVED', 'REJECTED'] as const).map(st => (
            <button key={st} onClick={() => setFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === st ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>
              {st === 'AWAITING' ? '검토 대기' : st === 'APPROVED' ? '승인됨' : '반려됨'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <select value={systemFilter} onChange={e => setSystemFilter(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
            <option value="">{tAttr('표준체계 전체')}</option>
            {Object.entries(SYS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
            <option value="">{tAttr('부서 전체')}</option>
            {(stats?.byDepartment ?? []).filter(d => d.department).map(d => (
              <option key={d.department} value={d.department!}>{d.department} ({d.count})</option>
            ))}
          </select>
        </div>
      </div>

      {/* 검토 목록 */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ClinicalIcon />
          <p className="text-sm mt-3">{filter === 'AWAITING' ? '임상 검토 대기 중인 매핑이 없습니다' : '항목이 없습니다'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const candidates = (item.candidates ?? []) as MappingCandidate[];
            const sysMeta = SYS_META[item.targetSystem] ?? { label: item.targetSystem, color: 'bg-gray-100 text-gray-600' };
            const guide = REVIEW_GUIDE[item.sourceTable];
            const isReadonly = filter !== 'AWAITING';

            return (
              <ClinicalReviewCard
                key={item.id}
                item={item}
                candidates={candidates}
                sysMeta={sysMeta}
                guide={guide}
                readonly={isReadonly}
                onApprove={(notes) => approveMut.mutate({ id: item.id, notes })}
                onReject={(notes) => rejectMut.mutate({ id: item.id, notes })}
              />
            );
          })}
        </div>
      )}

      {/* 검토자 역할 안내 */}
      <div className="bg-gray-50 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-semibold text-gray-700"><T k="검토 역할 안내" /></h4>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(REVIEW_GUIDE).map(([table, info]) => (
            <div key={table} className="bg-white rounded-xl p-3 border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-medium text-gray-500">{SOURCE_LABEL[table] ?? table}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${ROLE_LABEL[info.role]?.color ?? 'bg-gray-100 text-gray-600'}`}>
                  {ROLE_LABEL[info.role]?.label ?? info.role}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed">{info.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClinicalReviewCard({
  item, candidates, sysMeta, guide, readonly, onApprove, onReject,
}: {
  item: PendingMapping;
  candidates: MappingCandidate[];
  sysMeta: { label: string; color: string };
  guide?: { role: string; desc: string };
  readonly: boolean;
  onApprove: (notes?: string) => void;
  onReject: (notes?: string) => void;
}) {
  const tAttr = useTAttr();
  const [notes, setNotes] = useState('');
  const clinicalStatus = (item as PendingMapping & { clinicalStatus?: string }).clinicalStatus;
  const clinicalNotes = (item as PendingMapping & { clinicalNotes?: string }).clinicalNotes;
  const clinicalReviewerRole = (item as PendingMapping & { clinicalReviewerRole?: string }).clinicalReviewerRole;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-gray-900">{item.sourceCode}</span>
          <span className="text-sm text-gray-600">{item.sourceName}</span>
          <span className="text-[10px] text-gray-400">{SOURCE_LABEL[item.sourceTable] ?? item.sourceTable}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${sysMeta.color}`}>{sysMeta.label}</span>
          {guide && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${ROLE_LABEL[guide.role]?.color ?? 'bg-gray-100 text-gray-600'}`}>
              {ROLE_LABEL[guide.role]?.label} 검토
            </span>
          )}
        </div>
      </div>

      {/* 검토 안내 */}
      {guide && !readonly && (
        <div className="bg-blue-50/50 rounded-lg px-3 py-2 mb-3">
          <p className="text-[10px] text-blue-600">{guide.desc}</p>
        </div>
      )}

      {/* WeRU.B 매핑 후보 */}
      <div className="space-y-2 mb-3">
        <div className="text-[10px] font-medium text-gray-500">{AI_ORIGIN_TEXT} 매핑 후보</div>
        {candidates.slice(0, 3).map((c, i) => {
          const pctWidth = Math.round(c.confidence * 100);
          return (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${
              i === 0 ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100'
            }`}>
              {i === 0 && <span className="text-[9px] font-bold text-blue-600 shrink-0"><T k="추천@후보" /></span>}
              <span className="font-mono text-xs font-medium text-gray-700">{c.targetCode}</span>
              <span className="text-xs text-gray-600 truncate flex-1">{c.targetDisplay}</span>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div className={`h-full rounded-full ${pctWidth >= 90 ? 'bg-emerald-500' : pctWidth >= 70 ? 'bg-amber-500' : 'bg-red-400'}`}
                    style={{ width: `${pctWidth}%` }} />
                </div>
                <span className={`text-xs font-bold ${pctWidth >= 90 ? 'text-emerald-600' : pctWidth >= 70 ? 'text-amber-600' : 'text-red-500'}`}>
                  {pctWidth}%
                </span>
              </div>
              {c.reason && <span className="text-[9px] text-gray-400 shrink-0">{c.reason}</span>}
            </div>
          );
        })}
      </div>

      {/* 임상 의견 + 액션 */}
      {!readonly ? (
        <div className="pt-3 border-t border-gray-100 space-y-3">
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1"><T k="임상 의견" /></label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder={tAttr('임상적 관점에서 이 매핑이 적절한지 의견을 작성해주세요. (예: 해당 진단에 SNOMED 코드가 정확히 일치함 / 더 구체적인 코드가 필요함)')}
              rows={2}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => onApprove(notes || undefined)}
              className="flex-1 py-2 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 flex items-center justify-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              <T k="임상 적절 — 승인" />
            </button>
            <button onClick={() => onReject(notes || undefined)}
              className="flex-1 py-2 bg-red-50 text-red-600 text-xs font-medium rounded-lg hover:bg-red-100 flex items-center justify-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              <T k="부적절 — 반려" />
            </button>
          </div>
        </div>
      ) : (
        /* 검토 완료 정보 */
        <div className="pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2 text-[10px]">
            <span className={`font-bold px-1.5 py-0.5 rounded-full ${
              clinicalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}>{clinicalStatus === 'APPROVED' ? '임상 승인' : '임상 반려'}</span>
            {clinicalReviewerRole && (
              <span className={`font-bold px-1.5 py-0.5 rounded-full ${ROLE_LABEL[clinicalReviewerRole]?.color ?? 'bg-gray-100 text-gray-600'}`}>
                {ROLE_LABEL[clinicalReviewerRole]?.label}
              </span>
            )}
          </div>
          {clinicalNotes && <p className="text-[10px] text-gray-500 mt-1">의견: {clinicalNotes}</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// §4.1 Dashboard Panel
// ═══════════════════════════════════════════

interface ActivityItem {
  type: string;
  sourceCode: string;
  targetSystem: string;
  targetCode: string;
  targetDisplay: string;
  mapSource: string;
  confidence: number | null;
  date: string;
}

interface AiServerStatus {
  total_models?: number;
  active_models?: number;
  total_documents?: number;
  gpu_memory?: string;
  status?: string;
}

function DashboardPanel() {
  const tAttr = useTAttr();
  const { data: stats, isLoading } = useQuery<{ data: MappingStats }>({
    queryKey: ['mapping-stats'],
    queryFn: () => apiClient.get('/api/v1/codes/auto-map/stats'),
    refetchInterval: pollMs('normal'),
  });

  const { data: activityData } = useQuery<{ data: ActivityItem[] }>({
    queryKey: ['mapping-activity'],
    queryFn: () => apiClient.get('/api/v1/codes/auto-map/recent'),
    refetchInterval: pollMs('fast'),
  });

  const { data: aiStatus, isError: aiIsError, error: aiError, refetch: refetchAi } = useQuery<{ data: AiServerStatus }>({
    queryKey: ['ai-server-status'],
    queryFn: () => apiClient.get<{ data: AiServerStatus }>('/api/v1/ai/status'),
    refetchInterval: pollMs('slow'),
    retry: false,
  });

  const s = stats?.data;
  const activities = activityData?.data ?? [];
  const ai = aiStatus?.data;

  if (isLoading || !s) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  /**
   * 🔴 (2026-09-03) 이 화면이 들고 있던 분모 상수(`ICF: 20`)와 비례 배분 추정을 걷어냈다 —
   *    분모·분자는 서버 실측(`systemCoverage`·`mappedByType`)만 쓴다.
   *    "매핑 줄 수"로 미매핑을 빼면 한 코드의 다중 매핑이 미매핑을 음수로 갉아먹는다.
   */
  const unmapped = s.mappedDistinctTotal != null ? s.totalCodes - s.mappedDistinctTotal : null;

  return (
    <div className="space-y-6">
      {/* AI Server Status + Summary Cards */}
      <div className="grid grid-cols-5 gap-4">
        {/* 🔴 상태 조회 실패를 초록 "정상"으로 말하지 않는다 — 못 물어본 것이다 */}
        <div className={`rounded-2xl p-5 ${aiIsError ? 'bg-amber-50' : ai?.status === 'offline' ? 'bg-red-50' : 'bg-emerald-50'}`}>
          <div className="text-[11px] font-medium opacity-70 mb-1">{AI_ORIGIN_TEXT} 서버</div>
          {aiIsError ? (
            <QueryErrorFallback error={aiError} onRetry={refetchAi} size="compact" />
          ) : (
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${ai?.status === 'offline' ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
            <span className={`text-sm font-bold ${ai?.status === 'offline' ? 'text-red-700' : 'text-emerald-700'}`}>
              {ai?.status === 'offline' ? '오프라인' : '정상'}
            </span>
          </div>
          )}
          {!aiIsError && ai && ai.status !== 'offline' && (
            <div className="mt-1.5 space-y-0.5 text-[10px] text-emerald-600">
              {ai.total_models != null && <div>모델: {ai.active_models ?? ai.total_models}<Unit>개</Unit></div>}
              {ai.total_documents != null && <div>문서: {ai.total_documents.toLocaleString()}<Unit>건</Unit></div>}
              {ai.gpu_memory && <div>GPU: {ai.gpu_memory}</div>}
            </div>
          )}
        </div>
        <StatCard label="전체 코드" value={s.totalCodes} color="gray" />
        <StatCard label="매핑된 코드" value={s.mappedDistinctTotal ?? '—'} sub={s.mappedDistinctTotal != null ? `${s.mappingRate}% · 매핑 ${s.totalMappings.toLocaleString()}줄` : '서버 실측 없음'} color="emerald" />
        <StatCard label="승인 대기" value={s.pendingCount} color="amber" />
        <StatCard label="미매핑" value={unmapped ?? '—'} sub={unmapped == null ? RATIO_UNAVAILABLE : undefined} color="red" />
      </div>

      {/* Unmapped Distribution — 🔴 비례 배분 추정치 대신 서버 실측(mappedByType)만 그린다 */}
      {unmapped != null && unmapped > 0 && s.mappedByType && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3"><T k="미매핑 코드 분포" /></h3>
          <div className="grid grid-cols-4 gap-2">
            {([
              { key: 'diagnosis' as const, label: '진단', icon: '🩺', total: s.byCodeType.diagnosis },
              { key: 'procedure' as const, label: '수가', icon: '📋', total: s.byCodeType.procedure },
              { key: 'medication' as const, label: '약품', icon: '💊', total: s.byCodeType.medication },
              { key: 'labTest' as const, label: '검사', icon: '🔬', total: s.byCodeType.labTest },
            ]).map(t => {
              const um = Math.max(0, t.total - (s.mappedByType?.[t.key] ?? 0));
              const pct = t.total > 0 ? Math.round((um / t.total) * 100) : 0;
              return (
                <div key={t.key} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-700">{t.icon} {t.label}</span>
                    <span className={`text-[10px] font-bold ${um > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{um.toLocaleString()}<Unit><T k="건" /></Unit></span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[9px] text-gray-400 mt-1 text-right">{pct}<Unit>%</Unit> <T k="미매핑" /> <span className="text-gray-300">/ {t.total.toLocaleString()}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-System Progress */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4"><T k="표준별 매핑률" /> <span className="text-[10px] font-normal text-gray-400"><T k="분모 = 엔진 적용 정책 × 코드 마스터 실카운트" /></span></h3>
        <div className="space-y-3">
          {s.bySystem.map(sys => {
            const meta = SYS_META[sys.system] ?? { label: sys.system, color: 'bg-gray-100 text-gray-600' };
            const cov = s.systemCoverage?.find(c => c.system === sys.system);
            // 🔴 실측 분모가 없으면(구 API·미상 표준) 비율을 지어내지 않는다 — 매핑 수만 말한다
            if (!cov || cov.applicableTotal <= 0) {
              return (
                <div key={sys.system} className="flex items-center gap-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${meta.color}`}>{meta.label}</span>
                  <span className="flex-1 text-[10px] text-gray-400">{`분모(적용 대상) 미상 — 비율 ${RATIO_UNAVAILABLE}`}</span>
                  <span className="text-xs text-gray-600 font-medium text-right">매핑 {sys.count.toLocaleString()}<Unit>줄</Unit></span>
                </div>
              );
            }
            const pct = Math.round((cov.mapped / cov.applicableTotal) * 100);
            return (
              <div key={sys.system} className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${meta.color}`}>{meta.label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <span className="text-xs text-gray-600 font-medium text-right whitespace-nowrap">
                  {cov.mapped.toLocaleString()}/{cov.applicableTotal.toLocaleString()} ({pct}<Unit>%</Unit>)
                  {cov.outOfPolicyMapped != null && cov.outOfPolicyMapped > 0 && <span className="text-[9px] text-amber-600"> +정책 밖 {cov.outOfPolicyMapped}</span>}
                  {cov.unknownSourceMapped > 0 && <span className="text-[9px] text-gray-400"> +마스터 밖 {cov.unknownSourceMapped}</span>}
                </span>
              </div>
            );
          })}
          {s.bySystem.length === 0 && (
            <EmptyState icon="📊" title="매핑 데이터가 없습니다" />
          )}
        </div>
      </div>

      {/* Code Type Distribution */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4"><T k="코드 유형별 현황" /></h3>
        <div className="grid grid-cols-4 gap-3">
          {([
            { key: 'diagnosis', label: '진단코드', icon: '🩺' },
            { key: 'procedure', label: '수가코드', icon: '📋' },
            { key: 'medication', label: '약품코드', icon: '💊' },
            { key: 'labTest', label: '검사항목', icon: '🔬' },
          ] as const).map(t => (
            <div key={t.key} className="bg-gray-50 rounded-xl p-4 text-center">
              <div className="text-2xl mb-1">{t.icon}</div>
              <div className="text-lg font-bold text-gray-900">{s.byCodeType[t.key]}</div>
              <div className="text-[11px] text-gray-500">{t.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4"><T k="최근 매핑 활동" /></h3>
        {activities.length > 0 ? (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {activities.map((a, i) => {
              const sysMeta = SYS_META[a.targetSystem] ?? { label: a.targetSystem, color: 'bg-gray-100 text-gray-600' };
              const icon = a.mapSource === 'REJECTED' ? '✕' : a.mapSource === 'AI_AUTO' || a.mapSource === 'RULE_OFFICIAL' ? '✓' : a.mapSource === 'REVIEWED' ? '✓' : '⏳';
              const iconColor = a.mapSource === 'REJECTED' ? 'text-red-500' : a.mapSource === 'AI_AUTO' || a.mapSource === 'RULE_OFFICIAL' || a.mapSource === 'REVIEWED' ? 'text-emerald-600' : 'text-amber-500';
              const label = a.mapSource === 'AI_AUTO' ? '자동확정' : a.mapSource === 'RULE_OFFICIAL' || a.mapSource === 'OFFICIAL' ? '규칙매핑' : a.mapSource === 'REVIEWED' ? '관리자승인' : a.mapSource === 'REJECTED' ? '거부' : a.mapSource;
              const timeAgo = getTimeAgo(new Date(a.date));
              return (
                <div key={i} className="flex items-center gap-3 py-1.5">
                  <span className={`text-sm font-bold ${iconColor}`}>{icon}</span>
                  <span className="font-mono text-xs text-gray-700 w-16 shrink-0">{a.sourceCode}</span>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${sysMeta.color}`}>{sysMeta.label}</span>
                  <span className="font-mono text-xs text-gray-600">{a.targetCode}</span>
                  <span className="text-[10px] text-gray-400 truncate flex-1">{label}{a.confidence != null ? `, ${(Number(a.confidence) * 100).toFixed(0)}%` : ''}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{timeAgo}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon="📋" title="매핑 활동이 없습니다" />
        )}
      </div>
    </div>
  );
}

function getTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  const colorMap: Record<string, string> = {
    gray: 'bg-gray-50 text-gray-900',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className={`rounded-2xl p-5 ${colorMap[color] ?? colorMap.gray}`}>
      <div className="text-[11px] font-medium opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-bold">
        {typeof value === 'number' ? value.toLocaleString() : value}
        {sub && <span className="text-sm font-medium ml-1.5 opacity-70">{sub}</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// §4.4 Pending Panel
// ═══════════════════════════════════════════

function PendingPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('PENDING');

  const { data, isLoading } = useQuery<{ data: PendingMapping[] }>({
    queryKey: ['pending-mappings', filter],
    queryFn: () => apiClient.get(`/api/v1/codes/pending-mappings?status=${filter}`),
  });

  const confirmMut = useMutation({
    mutationFn: ({ id, selectedCode, notes }: { id: string; selectedCode: string; notes?: string }) =>
      apiClient.post(`/api/v1/codes/pending-mappings/${id}/confirm`, { selectedCode, notes }),
    onSuccess: () => { toast.success('매핑 승인 완료'); qc.invalidateQueries({ queryKey: ['pending-mappings'] }); qc.invalidateQueries({ queryKey: ['mapping-stats'] }); },
    onError: () => toast.error('승인 실패'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      apiClient.post(`/api/v1/codes/pending-mappings/${id}/reject`, { notes }),
    onSuccess: () => { toast.success('매핑 거부 완료'); qc.invalidateQueries({ queryKey: ['pending-mappings'] }); qc.invalidateQueries({ queryKey: ['mapping-stats'] }); },
    onError: () => toast.error('거부 실패'),
  });

  const items = data?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {['PENDING', 'CONFIRMED', 'REJECTED'].map(st => (
            <button key={st} onClick={() => setFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === st ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>
              {st === 'PENDING' ? '승인 대기' : st === 'CONFIRMED' ? '승인됨' : '거부됨'}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400">{items.length}<Unit><T k="건" /></Unit></span>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ClockIcon />
          <p className="text-sm mt-3">{filter === 'PENDING' ? '승인 대기 중인 매핑이 없습니다' : '항목이 없습니다'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <PendingCard
              key={item.id}
              item={item}
              onConfirm={(selectedCode, notes) => confirmMut.mutate({ id: item.id, selectedCode, notes })}
              onReject={(notes) => rejectMut.mutate({ id: item.id, notes })}
              readonly={filter !== 'PENDING'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingCard({
  item,
  onConfirm,
  onReject,
  readonly,
}: {
  item: PendingMapping;
  onConfirm: (code: string, notes?: string) => void;
  onReject: (notes?: string) => void;
  readonly: boolean;
}) {
  const tAttr = useTAttr();
  const [selectedCode, setSelectedCode] = useState(item.bestCandidate ?? '');
  const [notes, setNotes] = useState('');
  const candidates = (item.candidates ?? []) as MappingCandidate[];
  const sysMeta = SYS_META[item.targetSystem] ?? { label: item.targetSystem, color: 'bg-gray-100 text-gray-600' };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-gray-900">{item.sourceCode}</span>
          <span className="text-sm text-gray-600">{item.sourceName}</span>
          <span className="text-[10px] text-gray-400">{SOURCE_LABEL[item.sourceTable] ?? item.sourceTable}</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${sysMeta.color}`}>{sysMeta.label}</span>
      </div>

      {/* Candidates */}
      <div className="space-y-2 mb-3">
        {candidates.map((c, i) => {
          const pctWidth = Math.round(c.confidence * 100);
          return (
            <label key={i} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              selectedCode === c.targetCode ? 'border-blue-300 bg-blue-50/50' : 'border-gray-100 hover:bg-gray-50'
            }`}>
              {!readonly && (
                <input type="radio" name={`candidate-${item.id}`} checked={selectedCode === c.targetCode}
                  onChange={() => setSelectedCode(c.targetCode)} className="text-blue-600" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium text-gray-700">{c.targetCode}</span>
                  <span className="text-xs text-gray-600 truncate">{c.targetDisplay}</span>
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">{c.reason}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div className={`h-full rounded-full ${pctWidth >= 90 ? 'bg-emerald-500' : pctWidth >= 70 ? 'bg-amber-500' : 'bg-red-400'}`}
                    style={{ width: `${pctWidth}%` }} />
                </div>
                <span className={`text-xs font-bold ${pctWidth >= 90 ? 'text-emerald-600' : pctWidth >= 70 ? 'text-amber-600' : 'text-red-500'}`}>
                  {pctWidth}%
                </span>
              </div>
            </label>
          );
        })}
      </div>

      {/* Actions */}
      {!readonly && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder={tAttr('검토 메모 (선택)')}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <button onClick={() => onConfirm(selectedCode, notes || undefined)}
            disabled={!selectedCode}
            className="px-4 py-2 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            <T k="승인@버튼" />
          </button>
          <button onClick={() => onReject(notes || undefined)}
            className="px-4 py-2 bg-red-50 text-red-600 text-xs font-medium rounded-lg hover:bg-red-100">
            <T k="거부@행위" />
          </button>
        </div>
      )}

      {/* Review info for readonly */}
      {readonly && item.reviewNotes && (
        <div className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">
          검토 메모: {item.reviewNotes}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// §4.2~4.3 Bulk Mapping Panel
// ═══════════════════════════════════════════

function BulkMappingPanel() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [sourceTable, setSourceTable] = useState('diagnosis_codes');
  const [targetSystem, setTargetSystem] = useState('SNOMED_CT');
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [limit, setLimit] = useState(50);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  const bulkMut = useMutation({
    mutationFn: () => apiClient.post<{ data: { batchId: string } }>('/api/v1/codes/auto-map/bulk', {
      sourceTable, targetSystem, filter: 'unmapped', autoConfirm, limit,
    }),
    onSuccess: (res) => {
      const batchId = res.data.batchId;
      setActiveBatchId(batchId);
      toast.success('일괄 매핑 시작');
    },
    onError: () => toast.error('일괄 매핑 시작 실패'),
  });

  // Poll batch status
  const { data: batchData } = useQuery<{ data: BatchJob }>({
    queryKey: ['batch-status', activeBatchId],
    queryFn: () => apiClient.get(`/api/v1/codes/auto-map/bulk/${activeBatchId}`),
    enabled: !!activeBatchId,
    refetchInterval: activeBatchId ? 2000 : false,
  });

  const batch = batchData?.data;
  const isRunning = batch?.status === 'RUNNING';
  const isDone = batch?.status === 'COMPLETED' || batch?.status === 'FAILED';

  useEffect(() => {
    if (isDone) {
      qc.invalidateQueries({ queryKey: ['mapping-stats'] });
      qc.invalidateQueries({ queryKey: ['pending-mappings'] });
    }
  }, [isDone, qc]);

  return (
    <div className="space-y-6">
      {/* Configuration */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">{AI_ORIGIN_TEXT} 일괄 매핑 실행</h3>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5"><T k="소스 코드 체계" /></label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(SOURCE_LABEL).map(([key, label]) => (
                <button key={key} onClick={() => setSourceTable(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                    sourceTable === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>{label}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5"><T k="대상 표준" /></label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(SYS_META).map(([key, meta]) => (
                <button key={key} onClick={() => setTargetSystem(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                    targetSystem === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>{meta.label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6 mb-4">
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={autoConfirm} onChange={e => setAutoConfirm(e.target.checked)} className="rounded text-blue-600" />
            {/* 🔴 화면이 서버가 하지 않는 일을 약속하지 않는다(2026-08-26).
                 대조할 표준 코드 사전이 없어 **AI 제안은 자동 확정되지 않는다** — 규칙(마스터 대조) 결과만 확정된다. */}
            규칙 매핑은 신뢰도 {'>'}= 0.90 이면 자동 확정
          </label>
          <span className="text-[11px] text-amber-600">
            🔴 <T k="AI 제안은 자동 확정되지 않습니다 — 승인 대기로 쌓입니다" />
          </span>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <T k="처리 제한:" />
            <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="border rounded-lg px-2 py-1 text-xs">
              <option value={20}>{tAttr('20건')}</option>
              <option value={50}>{tAttr('50건')}</option>
              <option value={100}>{tAttr('100건')}</option>
            </select>
          </label>
        </div>

        <button onClick={() => bulkMut.mutate()}
          disabled={bulkMut.isPending || isRunning}
          className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
          {isRunning ? (
            <><Spinner /> <T k="매핑 진행 중..." /></>
          ) : bulkMut.isPending ? (
            <><Spinner /> <T k="시작 중..." /></>
          ) : (
            <><BotIcon /> {AI_ORIGIN_TEXT} 일괄 매핑 시작</>
          )}
        </button>
      </div>

      {/* Progress */}
      {batch && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900"><T k="매핑 진행 상황" /></h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
              batch.status === 'RUNNING' ? 'bg-blue-100 text-blue-700' :
              batch.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
              'bg-red-100 text-red-700'
            }`}>{batch.status}</span>
          </div>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{batch.processedCodes} / {batch.totalCodes}</span>
              <span>{batch.totalCodes > 0 ? Math.round((batch.processedCodes / batch.totalCodes) * 100) : 0}<Unit>%</Unit></span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${batch.totalCodes > 0 ? (batch.processedCodes / batch.totalCodes) * 100 : 0}%` }} />
            </div>
          </div>

          {/* Stats — 🔴 상태를 뭉치지 않는다. "해당 사항 아님"과 "AI 가 죽어서 못 함"은 다른 사실이고,
               다시 돌려야 하는 것은 오류뿐이다(2026-08-26) */}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-emerald-700">{batch.confirmedCount}</div>
              <div className="text-[10px] text-emerald-600"><T k="확정" /></div>
            </div>
            <div className="bg-amber-50 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-amber-700">{batch.pendingCount}</div>
              <div className="text-[10px] text-amber-600"><T k="승인 대기" /></div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center" title={tAttr('이 코드 종류에 이 표준은 애초에 해당하지 않습니다 — 갭이 아닙니다')}>
              <div className="text-lg font-bold text-gray-600">{batch.notApplicableCount ?? 0}</div>
              <div className="text-[10px] text-gray-500"><T k="해당 없음" /></div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-center" title={tAttr('물어봤는데 후보를 찾지 못했습니다')}>
              <div className="text-lg font-bold text-slate-600">{batch.noCandidateCount ?? 0}</div>
              <div className="text-[10px] text-slate-500"><T k="후보 없음" /></div>
            </div>
            <div className="bg-orange-50 rounded-xl p-3 text-center" title={tAttr('후보는 있으나 신뢰도가 임계 미만입니다')}>
              <div className="text-lg font-bold text-orange-700">{batch.failedCount}</div>
              <div className="text-[10px] text-orange-600"><T k="신뢰도 미달" /></div>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center" title={tAttr('수행하지 못했습니다 — 다시 돌려야 하는 것은 이것뿐입니다')}>
              <div className="text-lg font-bold text-red-700">{batch.errorCount ?? 0}</div>
              <div className="text-[10px] text-red-600"><T k="오류(재시도 대상)" /></div>
            </div>
          </div>

          {isDone && (
            <button onClick={() => { setActiveBatchId(null); }}
              className="mt-4 w-full py-2 bg-gray-100 text-gray-600 text-xs font-medium rounded-xl hover:bg-gray-200">
              <T k="닫기" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// §4.5 Real-time AI Suggestion (for code add modal)
// ═══════════════════════════════════════════

export function AiMappingSuggestionPanel({
  sourceTable,
  sourceId,
  onDismiss,
}: {
  sourceTable: string;
  sourceId: string | null;
  onDismiss?: () => void;
}) {
  const qc = useQueryClient();
  const [targetSystems] = useState(['SNOMED_CT', 'LOINC', 'MedDRA']);
  /**
   * 🔴 표준별 결과를 **후보와 실패로 나눠** 담는다(2026-08-26).
   *    종전에는 `catch { result[ts] = [] }` 라 **조회 실패가 "해당 없음"으로 보였다** —
   *    AI 서버가 죽어도 화면은 "이 코드에는 해당 표준이 없다"고 단정했다.
   */
  const [suggestions, setSuggestions] = useState<Record<string, { candidates: MappingCandidate[]; error?: string }>>({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendResult, setSendResult] = useState<{ requested: number; pended: number; rows: { targetSystem: string; status: string; reason?: string; reasonMsg?: ServerMessage }[] } | null>(null);

  const fetchSuggestions = useCallback(async () => {
    if (!sourceId) return;
    setLoading(true);
    const result: Record<string, { candidates: MappingCandidate[]; error?: string }> = {};
    for (const ts of targetSystems) {
      try {
        const res = await apiClient.post<{ data: MappingCandidate[] }>('/api/v1/codes/auto-map/suggest', {
          sourceTable, sourceId, targetSystem: ts,
        });
        result[ts] = { candidates: res.data ?? [] };
      } catch (e) {
        // 🔴 실패를 빈 배열로 접지 않는다 — 화면이 "없음"이라 단정하게 된다
        result[ts] = { candidates: [], error: (e as Error)?.message || '조회 실패' };
      }
    }
    setSuggestions(result);
    setLoading(false);
  }, [sourceId, sourceTable, targetSystems]);

  useEffect(() => {
    if (sourceId) {
      const timer = setTimeout(fetchSuggestions, 1000);
      return () => clearTimeout(timer);
    }
  }, [sourceId, fetchSuggestions]);

  /**
   * 🔴 **이 버튼은 매핑을 확정하지 않는다**(2026-09-09 R8).
   *    종전에는 `autoConfirm:true` 로 보내 확인창도 미리보기도 없이 **한 번에 확정**됐다.
   *    표준 매핑은 청구·기관 교환에 직결되고, 이 저장소에는 SNOMED/LOINC/MedDRA 코드 사전이
   *    없어 AI 가 낸 코드가 실재하는지 확인할 방법도 없다.
   *    → 검토 대기(PENDING)로만 적재하고, 확정은 건별 승인 화면(`/mapping-review`)이 한다.
   *
   * 🔴 서버는 `autoConfirm` 을 **빠뜨리면 true 로 읽는다**(`params.autoConfirm ?? true`).
   *    그래서 "안 보내기"로는 안 되고 **명시적으로 false 를 보낸다** — 여기서 값을 빼면 조용히
   *    자동확정으로 돌아간다.
   */
  const targetsWithCandidates = targetSystems.filter(ts => (suggestions[ts]?.candidates.length ?? 0) > 0);
  const sendCount = targetsWithCandidates.length;

  const handleSendToReview = async () => {
    if (!sourceId || sendCount === 0) return;
    setConfirmOpen(false);
    setApplying(true);
    try {
      const res = await apiClient.post<{ data: { targetSystem: string; status: string; reason?: string; reasonMsg?: ServerMessage }[] }>(
        '/api/v1/codes/auto-map',
        { sourceTable, sourceId, targetSystems: targetsWithCandidates, autoConfirm: false },
      );
      const rows = Array.isArray(res?.data) ? res.data : [];
      const pended = rows.filter(r => r.status === 'PENDING').length;
      // 🔴 "N건 보냈다"고 뭉치지 않는다 — 신뢰도 미달·후보 없음은 대기 목록에 **쌓이지 않는다**
      setSendResult({ requested: sendCount, pended, rows });
      toast.success(`검토 대기로 보냈습니다 — ${pended}/${sendCount}건`);
      qc.invalidateQueries({ queryKey: ['code-mappings'] });
      qc.invalidateQueries({ queryKey: ['mapping-audit'] });
      qc.invalidateQueries({ queryKey: ['pending-mappings'] });
      setSuggestions({});
    } catch (e) {
      toast.error(`검토 대기 적재 실패 — ${(e as Error)?.message ?? '사유 미상'}`);
    } finally {
      setApplying(false);
    }
  };

  if (!sourceId) return null;

  return (
    <div className="border border-blue-200 bg-blue-50/30 rounded-xl p-4 mt-3">
      <div className="flex items-center gap-2 mb-3">
        <BotIcon />
        <span className="text-xs font-semibold text-blue-700">{AI_ORIGIN_TEXT} 표준 매핑 제안</span>
        {(loading || applying) && <Spinner />}
      </div>

      {Object.entries(suggestions).map(([sys, r]) => {
        const meta = SYS_META[sys] ?? { label: sys, color: 'bg-gray-100 text-gray-600' };
        const candidates = r.candidates;
        return (
          <div key={sys} className="mb-2 last:mb-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${meta.color}`}>{meta.label}</span>
            </div>
            {r.error ? (
              /* 🔴 못 물어본 것을 "없다"고 말하지 않는다 */
              <span className="text-[10px] text-rose-500 pl-2">제안을 받지 못했습니다 — {r.error}</span>
            ) : candidates.length > 0 ? (
              candidates.slice(0, 1).map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-600 pl-2">
                  <span className="font-mono">{c.targetCode}</span>
                  <span className="truncate">{c.targetDisplay}</span>
                  <span className={`font-bold ml-auto ${c.confidence >= 0.9 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {Math.round(c.confidence * 100)}%
                  </span>
                </div>
              ))
            ) : (
              /* 물어봤고 답도 왔는데 후보가 없다 — 진짜 '없음' */
              <span className="text-[10px] text-gray-400 pl-2"><T k="제안 없음" /></span>
            )}
          </div>
        );
      })}

      {sendResult && (
        <div className="mt-3 pt-2 border-t border-blue-200 text-[11px] space-y-1">
          <p className="text-gray-700">
            검토 대기 적재 <span className="font-bold">{sendResult.pended}</span>/{sendResult.requested}건 —
            <span className="text-gray-500"> 확정된 것은 없습니다.</span>
          </p>
          {/* 🔴 대기에 쌓이지 않은 건은 이유를 그대로 말한다(빠진 것을 조용히 두지 않는다) */}
          {sendResult.rows.filter(r => r.status !== 'PENDING').map((r, i) => (
            <p key={i} className="text-amber-700">
              {SYS_META[r.targetSystem]?.label ?? r.targetSystem}: 대기 적재 안 됨({r.status}){(r.reasonMsg || r.reason) && <> — <ServerText msg={r.reasonMsg} fallback={r.reason} /></>}
            </p>
          ))}
          <Link href="/mapping-review" className="inline-block text-blue-600 font-medium underline">
            매핑 검토 화면에서 건별 승인/반려 →
          </Link>
        </div>
      )}

      {Object.keys(suggestions).length > 0 && !loading && (
        <div className="flex gap-2 mt-3 pt-2 border-t border-blue-200">
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={applying || sendCount === 0}
            className="flex-1 py-1.5 bg-blue-600 text-white text-[11px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {applying ? '보내는 중...' : `검토 대기로 보내기(${sendCount}건)`}
          </button>
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 bg-white text-gray-600 text-[11px] font-medium rounded-lg border border-gray-200 hover:bg-gray-50">
            <T k="매핑 없이 추가" />
          </button>
        </div>
      )}
      {Object.keys(suggestions).length > 0 && !loading && (
        <p className="text-[10px] text-gray-500 mt-1">
          이 버튼은 매핑을 확정하지 않습니다 — 검토 대기 목록에 쌓이고, 확정은 매핑 검토 화면에서 건별로 승인해야 합니다.
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="검토 대기로 보냅니다"
        message={`${AI_ORIGIN_TEXT} 제안 ${sendCount}건을 관리자 검토 대기 목록에 적재합니다. 지금 확정되지 않으며, 매핑 검토 화면(/mapping-review)에서 건별로 승인해야 실제 매핑이 됩니다. 표준 매핑은 청구·기관 간 교환에 쓰입니다.`}
        variant="warning"
        confirmText="검토 대기로 보내기"
        onConfirm={handleSendToReview}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════
// §4.5b Inline AI Suggestion (for Add Code Modal)
// ═══════════════════════════════════════════

export function InlineAiSuggestion({
  sourceTable,
  code,
  nameKo,
  nameEn,
  category,
}: {
  sourceTable: string;
  code: string;
  nameKo: string;
  nameEn?: string;
  category?: string;
}) {
  const [suggestions, setSuggestions] = useState<Record<string, MappingCandidate[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastKey, setLastKey] = useState('');

  const key = `${sourceTable}:${code}:${nameKo}`;

  useEffect(() => {
    if (!code || !nameKo || code.length < 2 || nameKo.length < 2) return;
    if (key === lastKey) return;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiClient.post<{ data: Record<string, MappingCandidate[]> }>('/api/v1/codes/auto-map/suggest-by-name', {
          sourceTable, code, nameKo, nameEn: nameEn ?? '', category: category ?? '',
          targetSystems: ['SNOMED_CT', 'LOINC', 'MedDRA'],
        });
        setSuggestions(res.data ?? {});
        setLastKey(key);
      } catch {
        setSuggestions(null);
      }
      setLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, [key, lastKey, sourceTable, code, nameKo, nameEn, category]);

  if (!code || !nameKo || code.length < 2 || nameKo.length < 2) return null;

  return (
    <div className="border border-blue-200 bg-blue-50/30 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <BotIcon />
        <span className="text-[11px] font-semibold text-blue-700">{AI_ORIGIN_TEXT} 표준 매핑 제안</span>
        {loading && <Spinner />}
      </div>

      {suggestions ? (
        <div className="space-y-1.5">
          {Object.entries(suggestions).map(([sys, candidates]) => {
            const meta = SYS_META[sys] ?? { label: sys, color: 'bg-gray-100 text-gray-600' };
            return (
              <div key={sys} className="flex items-center gap-2">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${meta.color}`}>{meta.label}</span>
                {candidates.length > 0 ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <span className="font-mono">{candidates[0].targetCode}</span>
                    <span className="truncate max-w-[200px]">{candidates[0].targetDisplay}</span>
                    <span className={`font-bold ${candidates[0].confidence >= 0.9 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {Math.round(candidates[0].confidence * 100)}%
                    </span>
                  </div>
                ) : (
                  <span className="text-[10px] text-gray-400"><T k="해당 없음" /></span>
                )}
              </div>
            );
          })}
        </div>
      ) : !loading ? (
        <span className="text-[10px] text-gray-400">코드 및 명칭을 입력하면 {AI_ORIGIN_TEXT}가 매핑을 제안합니다</span>
      ) : null}

      <p className="text-[9px] text-gray-400 mt-2"><T k="코드 추가 후 자동매핑 탭에서 확정할 수 있습니다" /></p>
    </div>
  );
}

// ═══════════════════════════════════════════
// §4.7 Settings Panel
// ═══════════════════════════════════════════

interface AutoMapperConfig {
  autoConfirmThreshold: number;
  pendingThreshold: number;
  rejectThreshold: number;
  maxCandidates: number;
  aiTimeoutMs: number;
  enableAutoMap: boolean;
  enableAutoSuggest: boolean;
  requireCrossValidation: boolean;
  bulkRateLimit: number;
}

function SettingsPanel() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  // Load config from DB
  const { data: configData, isLoading } = useQuery<{ data: AutoMapperConfig }>({
    queryKey: ['automapper-config'],
    queryFn: () => apiClient.get('/api/v1/codes/auto-map/config'),
  });

  const [form, setForm] = useState<AutoMapperConfig>({
    autoConfirmThreshold: 0.90,
    pendingThreshold: 0.70,
    rejectThreshold: 0.50,
    maxCandidates: 3,
    aiTimeoutMs: 10000,
    enableAutoMap: true,
    enableAutoSuggest: true,
    requireCrossValidation: true,
    bulkRateLimit: 5,
  });

  // Sync form with DB config
  useEffect(() => {
    if (configData?.data) setForm(configData.data);
  }, [configData]);

  const update = (key: keyof AutoMapperConfig, val: number | boolean) => {
    setForm(f => ({ ...f, [key]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.patch('/api/v1/codes/auto-map/config', form);
      toast.success('설정이 서버에 저장되었습니다');
      qc.invalidateQueries({ queryKey: ['automapper-config'] });
    } catch {
      toast.error('설정 저장 실패');
    }
    setSaving(false);
  };

  if (isLoading) {
    return <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* ── 자동 매핑 설정 ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-900"><T k="자동 매핑 설정" /></h3>

        <div className="space-y-4">
          <ToggleRowDetailed
            label="자동 매핑 활성화"
            desc={`코드 추가/수정 시 규칙 엔진과 ${AI_ORIGIN_TEXT}가 자동으로 표준 코드를 매핑합니다. 비활성화 시 수동 매핑만 가능합니다.`}
            checked={form.enableAutoMap} onChange={v => update('enableAutoMap', v)}
          />
          <ToggleRowDetailed
            label="코드 추가 시 자동 제안"
            desc={`코드 추가 모달에서 코드명 입력 시 ${AI_ORIGIN_TEXT}가 실시간으로 SNOMED/LOINC/MedDRA 매핑 후보를 미리 제안합니다.`}
            checked={form.enableAutoSuggest} onChange={v => update('enableAutoSuggest', v)}
          />
        </div>
      </div>

      {/* ── 신뢰도 임계값 ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-900"><T k="신뢰도 임계값" /></h3>
          <p className="text-[11px] text-gray-400 mt-1">{AI_ORIGIN_TEXT}가 제안한 매핑의 신뢰도(0~1)에 따라 자동 확정, 승인 대기, 매핑 불가를 구분합니다.</p>
        </div>

        <div className="space-y-5">
          <ThresholdSliderDetailed
            label="자동 확정 기준"
            desc="이 값 이상이면 관리자 확인 없이 즉시 매핑됩니다. 너무 낮으면 오매핑 위험이 있으므로 0.85 이상을 권장합니다."
            value={form.autoConfirmThreshold} onChange={v => update('autoConfirmThreshold', v)}
            min={0.7} max={1.0} step={0.05} color="emerald"
          />
          <ThresholdSliderDetailed
            label="승인 대기 기준"
            desc="이 값 이상 ~ 자동확정 미만이면 '승인 대기' 목록에 들어갑니다. 관리자가 후보를 검토하고 승인/거부합니다."
            value={form.pendingThreshold} onChange={v => update('pendingThreshold', v)}
            min={0.5} max={0.9} step={0.05} color="amber"
          />
          <ThresholdSliderDetailed
            label="매핑 불가 기준"
            desc={`이 값 미만이면 매핑이 불가능한 것으로 판정하고 건너뜁니다. ${AI_ORIGIN_TEXT}가 적절한 후보를 찾지 못한 경우입니다.`}
            value={form.rejectThreshold} onChange={v => update('rejectThreshold', v)}
            min={0.3} max={0.7} step={0.05} color="red"
          />
        </div>

        {/* 임계값 시각적 흐름도 */}
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="text-[10px] font-medium text-gray-500 mb-2"><T k="판정 흐름" /></div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="bg-red-100 text-red-600 px-2 py-1 rounded-lg font-medium whitespace-nowrap">0 ~ {form.rejectThreshold.toFixed(2)}</span>
            <span className="text-gray-400"><T k="→ 매핑 불가" /></span>
            <span className="text-gray-300 mx-1">|</span>
            <span className="bg-amber-100 text-amber-600 px-2 py-1 rounded-lg font-medium whitespace-nowrap">{form.rejectThreshold.toFixed(2)} ~ {form.pendingThreshold.toFixed(2)}</span>
            <span className="text-gray-400"><T k="→ 무시(회색지대)" /></span>
            <span className="text-gray-300 mx-1">|</span>
            <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg font-medium whitespace-nowrap">{form.pendingThreshold.toFixed(2)} ~ {form.autoConfirmThreshold.toFixed(2)}</span>
            <span className="text-gray-400"><T k="→ 승인 대기" /></span>
            <span className="text-gray-300 mx-1">|</span>
            <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg font-medium whitespace-nowrap">{form.autoConfirmThreshold.toFixed(2)} ~ 1.00</span>
            <span className="text-gray-400"><T k="→ 자동 확정" /></span>
          </div>
        </div>
      </div>

      {/* ── 교차 검증 및 성능 ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-900"><T k="교차 검증 및 성능" /></h3>

        <ToggleRowDetailed
          label="교차 검증 필수 (자동 확정 시)"
          desc={`자동 확정 전에 규칙 엔진과 ${AI_ORIGIN_TEXT} 결과를 교차 비교합니다. 두 방법의 결과가 일치해야 확정됩니다. 정확도는 높아지지만 처리 속도가 느려집니다.`}
          checked={form.requireCrossValidation} onChange={v => update('requireCrossValidation', v)}
        />

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1"><T k="벌크 Rate Limit" /></label>
            <select value={form.bulkRateLimit} onChange={e => update('bulkRateLimit', Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-xs">
              <option value={3}>{tAttr('3건/초 (안전)')}</option>
              <option value={5}>{tAttr('5건/초 (권장)')}</option>
              <option value={10}>{tAttr('10건/초 (빠름)')}</option>
            </select>
            <p className="text-[10px] text-gray-400 mt-1">{AI_ORIGIN_TEXT} 서버 부하를 고려하여 초당 처리량을 제한합니다.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{AI_ORIGIN_TEXT} 타임아웃</label>
            <select value={form.aiTimeoutMs} onChange={e => update('aiTimeoutMs', Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-xs">
              <option value={5000}>{tAttr('5초 (빠른 응답)')}</option>
              <option value={10000}>{tAttr('10초 (권장)')}</option>
              <option value={15000}>{tAttr('15초 (복잡한 코드)')}</option>
              <option value={30000}>{tAttr('30초 (최대 대기)')}</option>
            </select>
            <p className="text-[10px] text-gray-400 mt-1">{AI_ORIGIN_TEXT} 서버 응답 제한 시간. 초과 시 규칙 엔진 결과만 사용합니다.</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"><T k="최대 후보 수" /></label>
          <select value={form.maxCandidates} onChange={e => update('maxCandidates', Number(e.target.value))} className="w-40 border rounded-lg px-3 py-2 text-xs">
            <option value={1}>{tAttr('1개 (최선만)')}</option>
            <option value={3}>{tAttr('3개 (권장)')}</option>
            <option value={5}>{tAttr('5개 (상세 비교)')}</option>
          </select>
          <p className="text-[10px] text-gray-400 mt-1"><T k="승인 대기 시 관리자에게 보여줄 후보 매핑 수입니다." /></p>
        </div>
      </div>

      {/* Save */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <button onClick={handleSave} disabled={saving}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
          {saving ? '저장 중...' : '설정 저장'}
        </button>
        <p className="text-[10px] text-gray-400 text-center mt-2">
          <T k="설정은 서버 DB(SystemConfig)에 영구 저장되며 자동 매핑 엔진에 즉시 반영됩니다" />
        </p>
      </div>

      {/* ── 표준 코드 체계 참고 가이드 ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900"><T k="표준 코드 체계 참고 가이드" /></h3>
        <p className="text-[11px] text-gray-400"><T k="각 내부 코드가 어떤 표준 체계로 매핑되는지 참고하세요. 매핑 전략 수립에 활용할 수 있습니다." /></p>

        <div className="space-y-3">
          {/* SNOMED CT */}
          <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100">
            <div className="flex items-start gap-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap shrink-0 mt-0.5">SNOMED CT</span>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-gray-800">Systematized Nomenclature of Medicine — Clinical Terms</div>
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  <T k="임상 의학 전 분야를 포괄하는 국제 표준 용어. 진단/시술/약품 모두 매핑 가능. WHO, HL7, FHIR에서 핵심 코드 체계로 사용." />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded"><T k="진단코드 (KCD) → SNOMED CT" /></span>
                  <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded"><T k="수가코드 (EDI) → SNOMED CT" /></span>
                  <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded"><T k="약품코드 → SNOMED CT" /></span>
                </div>
                <div className="text-[10px] text-gray-400 mt-1"><T k="규칙 엔진: ICD-10↔SNOMED 공식 변환표 22건 내장 | AI: WeRU.B reference API 활용" /></div>
              </div>
            </div>
          </div>

          {/* LOINC */}
          <div className="bg-emerald-50/50 rounded-xl p-4 border border-emerald-100">
            <div className="flex items-start gap-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap shrink-0 mt-0.5">LOINC</span>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-gray-800">Logical Observation Identifiers Names and Codes</div>
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  <T k="검사 항목과 관찰값에 대한 국제 표준. 혈액검사, 소변검사, 바이탈 사인 등의 결과를 표준화. FHIR Observation 리소스 필수 코딩." />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-[9px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded"><T k="검사항목 → LOINC (직접 매핑)" /></span>
                </div>
                <div className="text-[10px] text-gray-400 mt-1"><T k="검사항목 시드에 LOINC 코드가 이미 포함되어 있어 매핑률 100%에 가까움" /></div>
              </div>
            </div>
          </div>

          {/* ICD-10-PCS */}
          <div className="bg-violet-50/50 rounded-xl p-4 border border-violet-100">
            <div className="flex items-start gap-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 whitespace-nowrap shrink-0 mt-0.5">ICD-10-PCS</span>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-gray-800">International Classification of Diseases, 10th — Procedure Coding System</div>
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  <T k="수술/시술에 대한 7자리 코드 체계. 각 자리가 Section/Body System/Root Operation/Body Part/Approach/Device/Qualifier를 나타냄. 미국 입원환자 시술 분류에 사용." />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-[9px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded"><T k="수가코드 (수술) → ICD-10-PCS" /></span>
                </div>
                <div className="text-[10px] text-gray-400 mt-1">규칙 엔진: 주요 수술코드 5건 매핑 | 나머지는 {AI_ORIGIN_TEXT} 기반 분류</div>
              </div>
            </div>
          </div>

          {/* MedDRA */}
          <div className="bg-rose-50/50 rounded-xl p-4 border border-rose-100">
            <div className="flex items-start gap-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 whitespace-nowrap shrink-0 mt-0.5">MedDRA</span>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-gray-800">Medical Dictionary for Regulatory Activities</div>
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  <T k="약물 부작용(ADR)과 의료기기 안전 보고에 사용하는 국제 표준 용어. ICH(국제의약품규제조화위원회)에서 관리. KAERS(한국 약물부작용 보고 시스템) 보고 필수." />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-[9px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded"><T k="약품코드 → MedDRA (부작용 관련)" /></span>
                </div>
                <div className="text-[10px] text-gray-400 mt-1"><T k="PT(Preferred Term) 코드 34건 시드 | 약품당 평균 2~3건의 주요 부작용 매핑" /></div>
              </div>
            </div>
          </div>

          {/* ICF */}
          <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-100">
            <div className="flex items-start gap-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap shrink-0 mt-0.5">ICF</span>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-gray-800">International Classification of Functioning, Disability and Health</div>
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  <T k="WHO가 제정한 기능/장애/건강 분류 체계. 재활의학에서 환자의 기능 상태를 표준화하여 기록. 신체기능(b), 활동/참여(d), 신체구조(s), 환경인자(e)로 분류." />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded"><T k="재활수가코드 → ICF (기능 분류)" /></span>
                </div>
                <div className="text-[10px] text-gray-400 mt-1"><T k="재활치료 12개 수가코드 → ICF 기능분류 매핑 | 재활 평가/치료 기록의 표준화에 활용" /></div>
              </div>
            </div>
          </div>
        </div>

        {/* 매핑 파이프라인 (4단계) */}
        <div className="bg-gray-50 rounded-xl p-4 mt-4">
          <div className="text-xs font-medium text-gray-700 mb-3"><T k="매핑 파이프라인 (4단계)" /></div>
          <div className="grid grid-cols-4 gap-2 text-[11px] text-gray-500">
            <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
              <div className="font-bold text-gray-700 mb-0.5">Stage 1</div>
              <div className="text-[10px] font-medium text-blue-600"><T k="규칙 엔진" /></div>
              <div className="text-[9px] text-gray-400 mt-1 leading-relaxed"><T k="ICD-10↔SNOMED 공식표" /><br/><T k="LOINC 직접 매핑" /><br/><T k="응답: 즉시" /></div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
              <div className="font-bold text-gray-700 mb-0.5">Stage 2</div>
              <div className="text-[10px] font-medium text-violet-600">{AI_ORIGIN_TEXT} 엔진 ({AI_ORIGIN_TEXT})</div>
              <div className="text-[9px] text-gray-400 mt-1 leading-relaxed"><T k="LLM 기반 매핑 추론" /><br/><T k="한국어→영어 자동 번역" /><br/><T k="응답: 3~10초" /></div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-emerald-200 text-center">
              <div className="font-bold text-gray-700 mb-0.5">Stage 3</div>
              <div className="text-[10px] font-medium text-emerald-600"><T k="임상 검토" /></div>
              <div className="text-[9px] text-gray-400 mt-1 leading-relaxed"><T k="의사: 진단/시술 매핑" /><br/><T k="약사: 약품/부작용 매핑" /><br/><T k="간호사: 검사/간호 매핑" /></div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
              <div className="font-bold text-gray-700 mb-0.5">Stage 4</div>
              <div className="text-[10px] font-medium text-amber-600"><T k="관리자 확정" /></div>
              <div className="text-[9px] text-gray-400 mt-1 leading-relaxed"><T k="임상 승인 건 최종 확인" /><br/><T k="매핑 확정 또는 거부" /><br/><T k="TerminologyMapping 생성" /></div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 px-2">
            {['자동', '자동', '수동 (임상)', '수동 (관리자)'].map((label, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${i < 2 ? 'bg-blue-400' : 'bg-amber-400'}`} />
                <span className="text-[9px] text-gray-400">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 스케줄 배치 안내 */}
        <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100">
          <div className="text-xs font-medium text-blue-700 mb-1"><T k="자동 스케줄 배치" /></div>
          <div className="text-[11px] text-gray-500 leading-relaxed">
            <T k="매일 새벽 03:00에 미매핑 코드를 자동으로 처리합니다 (Stage 1~2, 최대 50건/표준체계). 자동 확정 기준 이상이면 바로 확정, 미만이면 임상 검토 대기열에 추가됩니다. 매일 새벽 04:00에 만료된 승인 대기 건을 자동 정리합니다." />
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs text-gray-600">{label}</span>
      <button onClick={() => onChange(!checked)} type="button"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}>
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </label>
  );
}

function ToggleRowDetailed({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex-1">
        <div className="text-xs font-medium text-gray-700">{label}</div>
        <div className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{desc}</div>
      </div>
      <button onClick={() => onChange(!checked)} type="button"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors mt-0.5 ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}>
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

function ThresholdSliderDetailed({
  label, desc, value, onChange, min, max, step, color,
}: {
  label: string; desc: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; color: string;
}) {
  const colorMap: Record<string, string> = { emerald: 'accent-emerald-600', amber: 'accent-amber-600', red: 'accent-red-600' };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <span className="text-sm font-bold text-gray-800">{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-full h-1.5 ${colorMap[color] ?? ''}`} />
      <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">{desc}</p>
    </div>
  );
}

function ThresholdSlider({
  label, value, onChange, min, max, step, color,
}: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; color: string;
}) {
  const colorMap: Record<string, string> = { emerald: 'accent-emerald-600', amber: 'accent-amber-600', red: 'accent-red-600' };
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-600 w-28 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={`flex-1 h-1.5 ${colorMap[color] ?? ''}`} />
      <span className="text-xs font-bold text-gray-700 w-12 text-right">{value.toFixed(2)}</span>
    </div>
  );
}

// ── Icons ──

function ChartIcon() { return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>; }
function ClockIcon() { return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function BotIcon() { return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-1.756 4.39A2.25 2.25 0 0115.146 21H8.854a2.25 2.25 0 01-2.098-1.61L5 14.5m14 0H5" /></svg>; }
function GearIcon() { return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>; }
function ClinicalIcon() { return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>; }
function Spinner() { return <svg className="w-4 h-4 animate-spin text-current" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>; }
