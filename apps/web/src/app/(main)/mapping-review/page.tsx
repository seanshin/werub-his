'use client';

import { useState, useMemo } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/* ── Types ── */

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
  clinicalStatus: string;
  clinicalReviewedBy: string | null;
  clinicalReviewerRole: string | null;
  clinicalNotes: string | null;
  clinicalReviewedAt: string | null;
  assignedDept: string | null;
  priority: string;
  createdAt: string;
}

interface MappingCandidate {
  targetCode: string;
  targetDisplay: string;
  confidence: number;
  method: string;
  reason: string;
}

interface ClinicalReviewStats {
  awaiting: number;
  approved: number;
  rejected: number;
  byDepartment: { department: string | null; count: number }[];
  byTargetSystem: { system: string; count: number }[];
}

/* ── Constants ── */

const SYS_META: Record<string, { label: string; color: string }> = {
  SNOMED_CT: { label: 'SNOMED CT', color: 'bg-blue-100 text-blue-700' },
  LOINC: { label: 'LOINC', color: 'bg-emerald-100 text-emerald-700' },
  ICD10PCS: { label: 'ICD-10-PCS', color: 'bg-violet-100 text-violet-700' },
  MedDRA: { label: 'MedDRA', color: 'bg-rose-100 text-rose-700' },
  ICF: { label: 'ICF', color: 'bg-amber-100 text-amber-700' },
};

const SOURCE_LABEL: Record<string, string> = {
  diagnosis_codes: '진단코드 (KCD)',
  procedure_codes: '수가코드 (EDI)',
  medication_codes: '약품코드',
  lab_test_codes: '검사항목',
};

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  DOCTOR: { label: '의사', color: 'bg-blue-100 text-blue-700', icon: '🩺' },
  NURSE: { label: '간호사', color: 'bg-pink-100 text-pink-700', icon: '💉' },
  PHARMACIST: { label: '약사', color: 'bg-teal-100 text-teal-700', icon: '💊' },
};

const REVIEW_GUIDE: Record<string, { role: string; desc: string; examples: string }> = {
  diagnosis_codes: {
    role: 'DOCTOR',
    desc: '진단코드(KCD)가 올바른 SNOMED CT 코드에 매핑되었는지 확인합니다.',
    examples: '예: J06.9(급성상기도감염) → 54150009(Upper respiratory infection)가 임상적으로 동일한 개념인지 검토',
  },
  procedure_codes: {
    role: 'DOCTOR',
    desc: '수가코드(EDI)가 올바른 SNOMED CT 또는 ICD-10-PCS에 매핑되었는지 확인합니다.',
    examples: '예: 충수절제술 코드 → 0DTJ4ZZ(Resection of Appendix, Percutaneous Endoscopic)가 시술 방법까지 정확히 일치하는지 검토',
  },
  medication_codes: {
    role: 'PHARMACIST',
    desc: '약품코드가 올바른 MedDRA 부작용 용어에 매핑되었는지 확인합니다.',
    examples: '예: 타이레놀 → 10001367(ALT increased)가 해당 약물의 주요 부작용으로 적절한지, 빈도/중증도 관점에서 검토',
  },
  lab_test_codes: {
    role: 'DOCTOR',
    desc: '검사항목이 올바른 LOINC 코드에 매핑되었는지 확인합니다.',
    examples: '예: 총콜레스테롤 → 2093-3(Total Cholesterol)이 검체 유형(혈청)과 측정 방법까지 일치하는지 검토',
  },
};

/* ── Main Page ── */

export default function MappingReviewPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [tab, setTab] = useState<'awaiting' | 'my-reviews' | 'guide'>('awaiting');
  const [deptFilter, setDeptFilter] = useState('');
  const [systemFilter, setSystemFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  // Stats
  const { data: statsData } = useQuery<{ data: ClinicalReviewStats }>({
    queryKey: ['clinical-review-stats'],
    queryFn: () => apiClient.get('/api/v1/codes/clinical-review/stats'),
    refetchInterval: pollMs('fast'),
  });

  // List
  const clinicalStatus = tab === 'my-reviews' ? 'APPROVED' : 'AWAITING';
  const { data: listData, isLoading, isError, error, refetch } = useQuery<{ data: PendingMapping[] }>({
    queryKey: ['clinical-review', clinicalStatus, deptFilter, systemFilter, sourceFilter],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('clinicalStatus', clinicalStatus);
      if (deptFilter) qs.set('department', deptFilter);
      if (systemFilter) qs.set('targetSystem', systemFilter);
      if (sourceFilter) qs.set('sourceTable', sourceFilter);
      return apiClient.get(`/api/v1/codes/clinical-review?${qs.toString()}`);
    },
    enabled: tab !== 'guide',
  });

  const approveMut = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      apiClient.post(`/api/v1/codes/clinical-review/${id}/approve`, { notes }),
    onSuccess: () => {
      toast.success(tAttr('임상 검토 승인 완료'));
      qc.invalidateQueries({ queryKey: ['clinical-review'] });
      qc.invalidateQueries({ queryKey: ['clinical-review-stats'] });
    },
    onError: () => toast.error(tAttr('승인 실패')),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      apiClient.post(`/api/v1/codes/clinical-review/${id}/reject`, { notes }),
    onSuccess: () => {
      toast.success(tAttr('임상 검토 반려 완료'));
      qc.invalidateQueries({ queryKey: ['clinical-review'] });
      qc.invalidateQueries({ queryKey: ['clinical-review-stats'] });
    },
    onError: () => toast.error(tAttr('반려 실패')),
  });

  const stats = statsData?.data;
  const items = listData?.data ?? [];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="표준 매핑 임상 검토" /></h2>
        <p className="text-sm text-gray-500 mt-1"><Tf k="{AI표기}가 제안한 의료 용어 매핑의 임상 적절성을 검토합니다" params={{ AI표기: AI_ORIGIN_TEXT }} /></p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
            <div className="text-[11px] font-medium text-amber-600"><T k="검토 대기" /></div>
            <div className="text-2xl font-bold text-amber-700">{stats.awaiting}</div>
          </div>
          <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
            <div className="text-[11px] font-medium text-emerald-600"><T k="임상 승인" /></div>
            <div className="text-2xl font-bold text-emerald-700">{stats.approved}</div>
          </div>
          <div className="bg-red-50 rounded-2xl p-4 border border-red-100">
            <div className="text-[11px] font-medium text-red-600"><T k="임상 반려" /></div>
            <div className="text-2xl font-bold text-red-700">{stats.rejected}</div>
          </div>
          <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
            <div className="text-[11px] font-medium text-blue-600"><T k="표준체계" /></div>
            <div className="text-sm font-medium text-blue-700 mt-1 space-y-0.5">
              {stats.byTargetSystem.map(s => (
                <div key={s.system} className="flex justify-between">
                  <span className="text-[10px]">{SYS_META[s.system]?.label ?? s.system}</span>
                  <span className="font-bold">{s.count}</span>
                </div>
              ))}
              {stats.byTargetSystem.length === 0 && <span className="text-[10px] text-gray-400"><T k="대기 없음" /></span>}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 border-b border-gray-200 mb-6">
        {([
          { key: 'awaiting' as const, label: '검토 대기', count: stats?.awaiting },
          { key: 'my-reviews' as const, label: '내 검토 이력', count: stats?.approved },
          { key: 'guide' as const, label: '검토 가이드' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-[1px] transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <T k={t.label} />
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Guide Tab */}
      {tab === 'guide' && (
        <div className="space-y-6">
          {/* Workflow */}
          <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
            <h3 className="text-sm font-semibold text-blue-800 mb-3"><T k="검토 워크플로우" /></h3>
            <div className="flex items-center gap-3 text-[11px]">
              <div className="bg-white rounded-lg px-3 py-2 border border-blue-200 text-center">
                <div className="font-medium text-gray-700">Stage 1~2</div>
                <div className="text-[10px] text-gray-400"><Tf k="{AI표기} 자동 매핑" params={{ AI표기: AI_ORIGIN_TEXT }} /></div>
              </div>
              <span className="text-blue-300 text-lg">→</span>
              <div className="bg-blue-600 text-white rounded-lg px-4 py-2 text-center">
                <div className="font-bold">Stage 3</div>
                <div className="text-[10px] text-blue-200"><T k="임상 검토 (현재 단계)" /></div>
              </div>
              <span className="text-blue-300 text-lg">→</span>
              <div className="bg-white rounded-lg px-3 py-2 border border-blue-200 text-center">
                <div className="font-medium text-gray-700">Stage 4</div>
                <div className="text-[10px] text-gray-400"><T k="관리자 최종 확정" /></div>
              </div>
            </div>
          </div>

          {/* Role Guide */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4"><T k="역할별 검토 범위" /></h3>
            <div className="space-y-4">
              {Object.entries(REVIEW_GUIDE).map(([table, guide]) => {
                const role = ROLE_CONFIG[guide.role];
                return (
                  <div key={table} className="bg-gray-50 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{role?.icon}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${role?.color}`}>{role?.label && <T k={role.label} />}</span>
                      <span className="text-xs font-medium text-gray-700"><T k={SOURCE_LABEL[table]} /></span>
                    </div>
                    <p className="text-[11px] text-gray-600 mb-1"><T k={guide.desc} /></p>
                    <p className="text-[10px] text-gray-400 italic"><T k={guide.examples} /></p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Review Tips */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3"><T k="검토 시 유의사항" /></h3>
            <ul className="space-y-2 text-xs text-gray-600">
              <li className="flex gap-2"><span className="text-emerald-500 font-bold shrink-0">1.</span> <Tf k="{AI표기} 신뢰도가 높아도(90%+) 임상적으로 부정확할 수 있습니다. 코드의 의미를 직접 확인하세요." params={{ AI표기: AI_ORIGIN_TEXT }} /></li>
              <li className="flex gap-2"><span className="text-emerald-500 font-bold shrink-0">2.</span> <Tf k="후보가 여러 개인 경우, {AI표기} 추천(1순위)이 아닌 다른 코드가 더 적절할 수 있습니다." params={{ AI표기: AI_ORIGIN_TEXT }} /></li>
              <li className="flex gap-2"><span className="text-emerald-500 font-bold shrink-0">3.</span> <Tf k="반려 시 사유를 상세히 기록하면, {AI표기} 매핑 품질 개선에 반영됩니다." params={{ AI표기: AI_ORIGIN_TEXT }} /></li>
              <li className="flex gap-2"><span className="text-emerald-500 font-bold shrink-0">4.</span> <T k="MedDRA 부작용 매핑은 약물별 주요 부작용만 매핑합니다. 희귀 부작용은 별도 등록이 필요합니다." /></li>
              <li className="flex gap-2"><span className="text-emerald-500 font-bold shrink-0">5.</span> <T k="SNOMED CT 코드는 가장 구체적인(narrow) 코드를 선택하는 것이 원칙입니다." /></li>
            </ul>
          </div>
        </div>
      )}

      {/* Awaiting / My Reviews */}
      {tab !== 'guide' && (
        <>
          {/* Filters */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-xs">
              <option value="">{tAttr('코드 유형 전체')}</option>
              {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{tAttr(v)}</option>)}
            </select>
            <select value={systemFilter} onChange={e => setSystemFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-xs">
              <option value="">{tAttr('표준체계 전체')}</option>
              {Object.entries(SYS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-xs">
              <option value="">{tAttr('부서 전체')}</option>
              {(stats?.byDepartment ?? []).filter(d => d.department).map(d => (
                <option key={d.department} value={d.department!}>{d.department} ({d.count})</option>
              ))}
            </select>
            <span className="text-xs text-gray-400 self-center ml-auto">{items.length}<Unit>건</Unit></span>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
          ) : items.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">{tab === 'awaiting' ? <T k="검토 대기 중인 매핑이 없습니다" /> : <T k="검토 이력이 없습니다" />}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map(item => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  readonly={tab === 'my-reviews'}
                  onApprove={(notes) => approveMut.mutate({ id: item.id, notes })}
                  onReject={(notes) => rejectMut.mutate({ id: item.id, notes })}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Review Card ── */

function ReviewCard({ item, readonly, onApprove, onReject }: {
  item: PendingMapping;
  readonly: boolean;
  onApprove: (notes?: string) => void;
  onReject: (notes?: string) => void;
}) {
  const tAttr = useTAttr();
  const [notes, setNotes] = useState('');
  const [expanded, setExpanded] = useState(false);
  const candidates = (item.candidates ?? []) as MappingCandidate[];
  const sysMeta = SYS_META[item.targetSystem] ?? { label: item.targetSystem, color: 'bg-gray-100 text-gray-600' };
  const guide = REVIEW_GUIDE[item.sourceTable];
  const role = guide ? ROLE_CONFIG[guide.role] : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            {role && <span className="text-lg">{role.icon}</span>}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-gray-900">{item.sourceCode}</span>
                <span className="text-sm text-gray-600">{item.sourceName}</span>
              </div>
              <span className="text-[10px] text-gray-400">{SOURCE_LABEL[item.sourceTable] ? <T k={SOURCE_LABEL[item.sourceTable]} /> : item.sourceTable}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {item.priority === 'HIGH' && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 whitespace-nowrap"><T k="긴급" /></span>
            )}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${sysMeta.color}`}>{sysMeta.label}</span>
            {role && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${role.color}`}><Tf k="{역할} 검토" params={{ 역할: <T k={role.label} /> }} /></span>
            )}
          </div>
        </div>

        {/* Guide */}
        {guide && !readonly && (
          <div className="bg-blue-50/50 rounded-lg px-3 py-2 mb-3 text-[10px] text-blue-600">
            <T k={guide.desc} />
          </div>
        )}

        {/* Best Candidate (always visible) */}
        {candidates.length > 0 && (
          <div className="mb-2">
            <div className="text-[10px] font-medium text-gray-500 mb-1.5"><Tf k="{AI표기} 추천 매핑" params={{ AI표기: AI_ORIGIN_TEXT }} /></div>
            <CandidateRow candidate={candidates[0]} isTop />
          </div>
        )}

        {/* More candidates */}
        {candidates.length > 1 && (
          <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-blue-600 hover:underline mb-2">
            {expanded ? <T k="접기" /> : <Tf k="다른 후보 {수}건 보기" params={{ 수: candidates.length - 1 }} />}
          </button>
        )}
        {expanded && candidates.slice(1).map((c, i) => (
          <CandidateRow key={i} candidate={c} />
        ))}
      </div>

      {/* Readonly result */}
      {readonly && (
        <div className="px-5 pb-4 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-[10px]">
            <span className={`font-bold px-1.5 py-0.5 rounded-full ${
              item.clinicalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}>{item.clinicalStatus === 'APPROVED' ? <T k="임상 승인" /> : <T k="임상 반려" />}</span>
            {item.clinicalReviewerRole && (
              <span className={`font-bold px-1.5 py-0.5 rounded-full ${ROLE_CONFIG[item.clinicalReviewerRole]?.color ?? 'bg-gray-100 text-gray-600'}`}>
                {ROLE_CONFIG[item.clinicalReviewerRole]?.label ? <T k={ROLE_CONFIG[item.clinicalReviewerRole].label} /> : null}
              </span>
            )}
            {item.clinicalReviewedAt && (
              <span className="text-gray-400">{kdate(new Date(item.clinicalReviewedAt))}</span>
            )}
          </div>
          {item.clinicalNotes && <p className="text-[10px] text-gray-500 mt-1"><Tf k="의견: {의견}" params={{ 의견: item.clinicalNotes }} /></p>}
        </div>
      )}

      {/* Action area */}
      {!readonly && (
        <div className="px-5 pb-5 pt-2 border-t border-gray-100 space-y-3">
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={tAttr('임상 의견을 작성하세요 (예: 해당 SNOMED 코드가 진단과 정확히 일치함 / 더 구체적인 코드 필요)')}
            rows={2}
            className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          <div className="flex gap-2">
            <button onClick={() => onApprove(notes || undefined)}
              className="flex-1 py-2.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 flex items-center justify-center gap-1.5">
              <CheckIcon /> <T k="임상 적절 — 승인" />
            </button>
            <button onClick={() => onReject(notes || undefined)}
              className="flex-1 py-2.5 bg-white text-red-600 text-xs font-semibold rounded-xl border border-red-200 hover:bg-red-50 flex items-center justify-center gap-1.5">
              <XIcon /> <T k="부적절 — 반려" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateRow({ candidate: c, isTop }: { candidate: MappingCandidate; isTop?: boolean }) {
  const pct = Math.round(c.confidence * 100);
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${isTop ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100 mb-1.5'}`}>
      {isTop && <span className="text-[9px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded shrink-0"><T k="추천" /></span>}
      <span className="font-mono text-xs font-medium text-gray-800">{c.targetCode}</span>
      <span className="text-xs text-gray-600 truncate flex-1">{c.targetDisplay}</span>
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-20 bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div className={`h-full rounded-full ${pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-400'}`}
            style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-xs font-bold w-8 text-right ${pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-500'}`}>
          {pct}%
        </span>
      </div>
      {c.reason && <span className="text-[9px] text-gray-400 shrink-0 max-w-[120px] truncate">{c.reason}</span>}
    </div>
  );
}

function CheckIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>; }
function XIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>; }
