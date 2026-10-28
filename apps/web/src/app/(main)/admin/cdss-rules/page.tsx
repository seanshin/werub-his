'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { CodeRulesPanel, DurRulesPanel } from './dur-rules-panel';

const cdssRuleSchema = z.object({
  category: z.string().min(1),
  level: z.string().min(1),
  name: z.string().min(1, '규칙명은 필수입니다'),
  description: z.string().min(1, '설명은 필수입니다'),
  drugA: z.string().optional(),
  drugB: z.string().optional(),
  ageMin: z.string().optional(),
  ageMax: z.string().optional(),
  maxDose: z.string().optional(),
  diagnosisCode: z.string().optional(),
  recommendation: z.string().optional(),
  reference: z.string().optional(),
  isActive: z.boolean(),
});
type CdssRuleForm = z.infer<typeof cdssRuleSchema>;

/* ───── Types ───── */
interface CdssRule {
  id: string;
  category: string;
  level: string;
  name: string;
  description: string;
  drugA?: string;
  drugB?: string;
  ageMin?: number;
  ageMax?: number;
  maxDose?: string;
  diagnosisCode?: string;
  recommendation?: string;
  reference?: string;
  isActive: boolean;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CdssRuleStats {
  totalRules: number;
  activeRules: number;
  byCategory: Record<string, number>;
  /**
   * 판정 엔진 사실(2026-10-21) — 🔴 이 표는 처방 판정이 읽지 않는다 · 적중 수는 계측되지 않는다.
   * 종전 화면은 서버가 보내지 않는 `monthlyHits` 를 `?? 0` 으로 "이번달 적용 횟수 0"이라 그렸다.
   */
  engine?: { readsThisTable: boolean; hitsMeasured: boolean; durRulesActive: number | null; codeRules: string[] };
}

/* ───── Constants ───── */
const CATEGORIES = ['INTERACTION', 'ALLERGY', 'AGE', 'DOSE', 'DUPLICATE', 'DIAGNOSIS', 'GUIDELINE'] as const;

const CATEGORY_LABEL: Record<string, string> = {
  INTERACTION: '상호작용',
  ALLERGY: '알레르기',
  AGE: '연령',
  DOSE: '용량',
  DUPLICATE: '중복',
  DIAGNOSIS: '진단',
  GUIDELINE: '가이드라인',
};

const CATEGORY_COLOR: Record<string, string> = {
  INTERACTION: 'bg-red-100 text-red-700',
  ALLERGY: 'bg-pink-100 text-pink-700',
  AGE: 'bg-amber-100 text-amber-700',
  DOSE: 'bg-orange-100 text-orange-700',
  DUPLICATE: 'bg-purple-100 text-purple-700',
  DIAGNOSIS: 'bg-blue-100 text-blue-700',
  GUIDELINE: 'bg-emerald-100 text-emerald-700',
};

const LEVEL_ICON: Record<string, string> = {
  ERROR: '\uD83D\uDEAB',
  WARNING: '\u26A0\uFE0F',
  INFO: '\u2139\uFE0F',
};

const LEVEL_COLOR: Record<string, string> = {
  ERROR: 'bg-red-600 text-white',
  WARNING: 'bg-amber-500 text-white',
  INFO: 'bg-blue-500 text-white',
};

const EMPTY_FORM: CdssRuleForm = {
  category: 'INTERACTION',
  level: 'WARNING',
  name: '',
  description: '',
  drugA: '',
  drugB: '',
  ageMin: '',
  ageMax: '',
  maxDose: '',
  diagnosisCode: '',
  recommendation: '',
  reference: '',
  isActive: true,
};

/* ───── Component ───── */
/**
 * 화면 3105 「CDSS 규칙」(2026-10-21 임상 규칙 P1) — 판정이 실제로 읽는 규칙을 편집한다.
 *  · 판정 규칙 = DUR 룰 표(처방 경고의 정본) · 코드 규칙 = 판정 코드에 박힌 검사(편집 불가 · 목록만)
 *  · 옛 목록(`CdssRule`) = 판정이 읽지 않는 표 — 처리(이관·폐기)는 사람 결정 D3 · 그 전까지 읽기 전용
 */
export default function CdssRulesPage() {
  const [tab, setTab] = useState<'DUR' | 'CODE' | 'LEGACY'>('DUR');
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">CDSS <T k="규칙 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="처방 경고를 정하는 규칙 — 표에서 편집하는 DUR 룰과 코드에 박힌 검사로 판정합니다." /></p>
      </div>
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 w-fit" role="tablist">
        {([['DUR', <T key="d" k="판정 규칙(DUR 룰)" />], ['CODE', <T key="c" k="코드 규칙(편집 불가)" />], ['LEGACY', <T key="l" k="옛 목록(판정 미사용)" />]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-cdss-tab={k}
            className={`min-h-[40px] rounded-lg px-4 text-sm font-medium ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'DUR' && <DurRulesPanel />}
      {tab === 'CODE' && <CodeRulesPanel />}
      {tab === 'LEGACY' && <LegacyCdssRules />}
    </div>
  );
}

/** 옛 목록은 읽기 전용 — 편집 경로는 코드에 남되 그리지 않는다(서버 EP 도 그대로 · D3 결정 뒤 이관·폐기) */
const LEGACY_READ_ONLY = true;

/** 옛 CDSS 규칙 목록 — 🔴 판정이 읽지 않는다 · 사람 결정(D3 이관·폐기) 전까지 읽기 전용(편집해도 아무것도 바뀌지 않던 화면) */
function LegacyCdssRules() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [categoryFilter, setCategoryFilter] = useState('');
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { register, handleSubmit: rhfSubmit, reset, watch, setValue, formState: { errors } } = useForm<CdssRuleForm>({
    resolver: zodResolver(cdssRuleSchema),
    defaultValues: { ...EMPTY_FORM },
  });
  const form = watch();

  /* ── Queries ── */
  const { data: rulesRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['cdss-rules', categoryFilter],
    queryFn: () =>
      apiClient.get<{ data: CdssRule[] }>(
        '/api/v1/cdss/rules',
        categoryFilter ? { category: categoryFilter } : undefined,
      ),
  });

  const { data: statsRes } = useQuery({
    queryKey: ['cdss-stats'],
    queryFn: () => apiClient.get<{ data: CdssRuleStats }>('/api/v1/cdss/rules/stats'),
  });

  const rules: CdssRule[] = useMemo(() => {
    const d = rulesRes?.data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object' && 'data' in (d as Record<string, unknown>)) {
      const inner = (d as unknown as Record<string, unknown>).data;
      if (Array.isArray(inner)) return inner as CdssRule[];
    }
    return [];
  }, [rulesRes]);

  const stats: CdssRuleStats | null = useMemo(() => {
    const d = statsRes?.data;
    if (!d) return null;
    if ('totalRules' in (d as unknown as Record<string, unknown>)) return d as unknown as CdssRuleStats;
    if (typeof d === 'object' && 'data' in (d as unknown as Record<string, unknown>)) {
      return (d as unknown as Record<string, unknown>).data as CdssRuleStats;
    }
    return null;
  }, [statsRes]);

  /* ── Mutations ── */
  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiClient.post('/api/v1/cdss/rules', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cdss-rules'] });
      qc.invalidateQueries({ queryKey: ['cdss-stats'] });
      toast.success(tAttr('규칙이 추가되었습니다'));
      closeModal();
    },
    onError: () => toast.error(tAttr('규칙 추가에 실패했습니다')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiClient.put(`/api/v1/cdss/rules/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cdss-rules'] });
      qc.invalidateQueries({ queryKey: ['cdss-stats'] });
      toast.success(tAttr('규칙이 수정되었습니다'));
      closeModal();
    },
    onError: () => toast.error(tAttr('규칙 수정에 실패했습니다')),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/cdss/rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cdss-rules'] });
      qc.invalidateQueries({ queryKey: ['cdss-stats'] });
      toast.success(tAttr('규칙이 삭제되었습니다'));
    },
    onError: () => toast.error(tAttr('규칙 삭제에 실패했습니다')),
  });

  /* ── Helpers ── */
  function closeModal() {
    setModalMode(null);
    setEditingId(null);
    reset({ ...EMPTY_FORM });
  }

  function openAdd() {
    reset({ ...EMPTY_FORM });
    setEditingId(null);
    setModalMode('add');
  }

  function openEdit(rule: CdssRule) {
    reset({
      category: rule.category,
      level: rule.level,
      name: rule.name,
      description: rule.description,
      drugA: rule.drugA ?? '',
      drugB: rule.drugB ?? '',
      ageMin: rule.ageMin != null ? String(rule.ageMin) : '',
      ageMax: rule.ageMax != null ? String(rule.ageMax) : '',
      maxDose: rule.maxDose ?? '',
      diagnosisCode: rule.diagnosisCode ?? '',
      recommendation: rule.recommendation ?? '',
      reference: rule.reference ?? '',
      isActive: rule.isActive,
    });
    setEditingId(rule.id);
    setModalMode('edit');
  }

  function buildPayload(data: CdssRuleForm): Record<string, unknown> {
    const p: Record<string, unknown> = {
      category: data.category,
      level: data.level,
      name: data.name,
      description: data.description,
      isActive: data.isActive,
    };
    if (data.drugA) p.drugA = data.drugA;
    if (data.drugB) p.drugB = data.drugB;
    if (data.ageMin) p.ageMin = parseInt(data.ageMin);
    if (data.ageMax) p.ageMax = parseInt(data.ageMax);
    if (data.maxDose) p.maxDose = data.maxDose;
    if (data.diagnosisCode) p.diagnosisCode = data.diagnosisCode;
    if (data.recommendation) p.recommendation = data.recommendation;
    if (data.reference) p.reference = data.reference;
    return p;
  }

  function onFormSubmit(data: CdssRuleForm) {
    const payload = buildPayload(data);
    if (modalMode === 'edit' && editingId) {
      updateMut.mutate({ id: editingId, payload });
    } else {
      createMut.mutate(payload);
    }
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" ${tAttr('규칙을 삭제하시겠습니까?')}`)) return;
    deleteMut.mutate(id);
  }

  const isSaving = createMut.isPending || updateMut.isPending;

  /* ── 카테고리별 건수 ── */
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (stats?.byCategory) {
      for (const [k, v] of Object.entries(stats.byCategory)) {
        counts[k] = v as number;
      }
    }
    return counts;
  }, [stats]);

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  /* ───── Render ───── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900"><T k="옛 CDSS 규칙 목록" /></h3>
          <p className="text-sm text-gray-500 mt-1"><T k="읽기 전용 — 이관·폐기는 위원회 결정 뒤에 합니다." /></p>
        </div>
        {!LEGACY_READ_ONLY && <button
          onClick={openAdd}
          className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <T k="규칙 추가" />
        </button>}
      </div>

      {/* 🔴 판정에 쓰이지 않는 표라는 사실을 먼저 말한다(임상 규칙 교차검증 R1 · 정본 정리는 P1) */}
      {stats?.engine && !stats.engine.readsThisTable && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-cdss-engine-notice>
          <p className="font-semibold"><T k="이 목록의 규칙은 처방 판정에 쓰이지 않습니다" /></p>
          <p className="mt-1 text-[13px]">
            <Tf k="처방 경고는 코드 규칙({코드})과 DUR 룰 {수}건으로 판정합니다 — 여기서 규칙을 추가·수정해도 경고는 바뀌지 않습니다." params={{ 코드: stats.engine.codeRules.join('·'), 수: stats.engine.durRulesActive ?? '?' }} />
          </p>
          <p className="mt-1 text-[12px] text-amber-800"><T k="DUR 룰 관리 화면과 이 목록의 처리(이관·폐기)는 다음 단계에서 정합니다(기획 clinical-rules-templates-review)." /></p>
        </div>
      )}

      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="총 규칙 수" value={stats.totalRules ?? 0} color="indigo" />
          <StatCard label="활성 규칙" value={stats.activeRules ?? stats.totalRules ?? 0} color="emerald" />
          <StatCard
            label="카테고리"
            value={Object.keys(stats.byCategory ?? {}).length}
            color="blue"
          />
          {/* 적중 수는 계측되지 않는다 — 0 으로 그리지 않는다 */}
          <StatCard label="판정 사용" value={stats.engine ? (stats.engine.readsThisTable ? <T k="예" /> : <T k="아니오" />) : <T k="확인 불가" />} color="amber" />
        </div>
      )}

      {/* Category Filter Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        <FilterTab
          label="전체"
          count={stats?.totalRules}
          active={!categoryFilter}
          onClick={() => setCategoryFilter('')}
        />
        {CATEGORIES.map((cat) => (
          <FilterTab
            key={cat}
            label={CATEGORY_LABEL[cat]}
            count={categoryCounts[cat]}
            active={categoryFilter === cat}
            onClick={() => setCategoryFilter(cat)}
          />
        ))}
      </div>

      {/* Rules Table */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 w-[50px]"><T k="레벨" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="카테고리" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="규칙명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="약물 A/B" /></th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 w-[80px]"><T k="적용횟수" /></th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 w-[60px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 w-[100px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <T k="규칙을 불러오는 중..." />
                    </div>
                  </td>
                </tr>
              ) : !rules.length ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    <p className="text-lg mb-1"><T k="등록된 규칙이 없습니다" /></p>
                    <p className="text-xs"><T k={'상단의 "규칙 추가" 버튼으로 새 규칙을 등록해주세요'} /></p>
                  </td>
                </tr>
              ) : (
                rules.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-center">
                      <span title={r.level} className="text-base">
                        {LEVEL_ICON[r.level] ?? r.level}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${CATEGORY_COLOR[r.category] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        <T k={CATEGORY_LABEL[r.category] ?? r.category} />
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{r.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{r.description}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {r.drugA || r.drugB ? (
                        <span>
                          {r.drugA ?? '-'}
                          {r.drugB ? ` + ${r.drugB}` : ''}
                        </span>
                      ) : r.ageMin != null || r.ageMax != null ? (
                        <span>
                          {r.ageMin != null && <>{r.ageMin}<T k="세" /></>}
                          {r.ageMin != null && r.ageMax != null && ' ~ '}
                          {r.ageMax != null && <>{r.ageMax}<T k="세" /></>}
                        </span>
                      ) : r.maxDose ? (
                        <span><T k="최대" /> {r.maxDose}</span>
                      ) : r.diagnosisCode ? (
                        <span className="font-mono">{r.diagnosisCode}</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {stats?.engine && !stats.engine.hitsMeasured
                        ? <span className="text-[11px] text-gray-400" title={tAttr('적중 수를 올리는 코드가 없어 계측되지 않습니다')} data-hit-unmeasured><T k="계측 없음" /></span>
                        : <span className="text-xs font-mono text-gray-500">{r.hitCount ?? 0}</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${r.isActive ? 'bg-emerald-500' : 'bg-gray-300'}`}
                        title={r.isActive ? tAttr('활성') : tAttr('비활성')}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {!LEGACY_READ_ONLY && <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(r)}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          <T k="편집" />
                        </button>
                        <button
                          onClick={() => handleDelete(r.id, r.name)}
                          className="text-[11px] text-red-500 hover:text-red-700 font-medium"
                        >
                          <T k="삭제" />
                        </button>
                      </div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b flex items-center justify-between rounded-t-2xl">
              <h3 className="text-lg font-bold text-gray-900">
                <T k={modalMode === 'add' ? '새 규칙 추가' : '규칙 편집'} />
              </h3>
              <button onClick={closeModal} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={rhfSubmit(onFormSubmit)}>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="카테고리 *">
                  <select {...register('category')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    {CATEGORIES.map((k) => <option key={k} value={k}>{tAttr(CATEGORY_LABEL[k])}</option>)}
                  </select>
                </FormField>
                <FormField label="레벨 *">
                  <select {...register('level')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    <option value="ERROR">{LEVEL_ICON.ERROR} ERROR ({tAttr('금기')})</option>
                    <option value="WARNING">{LEVEL_ICON.WARNING} WARNING ({tAttr('주의')})</option>
                    <option value="INFO">{LEVEL_ICON.INFO} INFO ({tAttr('정보')})</option>
                  </select>
                </FormField>
              </div>

              <FormField label="규칙명 *">
                <input {...register('name')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder={tAttr('예: 와파린+아스피린 병용금기')} />
                {errors.name?.message && <p className="text-xs text-red-500 mt-1"><T k={errors.name.message} /></p>}
              </FormField>

              <FormField label="설명 *">
                <textarea {...register('description')} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none" placeholder={tAttr('규칙에 대한 상세 설명')} />
                {errors.description?.message && <p className="text-xs text-red-500 mt-1"><T k={errors.description.message} /></p>}
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="약물 A"><input {...register('drugA')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="Warfarin" /></FormField>
                <FormField label="약물 B"><input {...register('drugB')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="Aspirin" /></FormField>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField label="최소 연령"><input type="number" {...register('ageMin')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="0" min={0} /></FormField>
                <FormField label="최대 연령"><input type="number" {...register('ageMax')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="120" min={0} /></FormField>
                <FormField label="최대 용량"><input {...register('maxDose')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="500mg/day" /></FormField>
              </div>

              <FormField label="진단 코드"><input {...register('diagnosisCode')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono" placeholder="J45.0 (ICD-10)" /></FormField>

              <FormField label="권고사항"><textarea {...register('recommendation')} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none" placeholder={tAttr('대체 약물 사용 권고, 용량 조절 필요 등')} /></FormField>

              <FormField label="참고 문헌"><input {...register('reference')} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder={tAttr('DUR 가이드라인 2024, 약학정보원 등')} /></FormField>

              {modalMode === 'edit' && (
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" {...register('isActive')} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                  </label>
                  <span className="text-sm text-gray-700"><T k="규칙 활성화" /></span>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 border-t flex items-center justify-end gap-3 rounded-b-2xl">
              <button type="button" onClick={closeModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border rounded-lg hover:bg-gray-50 transition-colors"><T k="취소" /></button>
              <button type="submit" disabled={isSaving} className="px-6 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                <T k={isSaving ? '저장 중...' : modalMode === 'add' ? '추가' : '저장'} />
              </button>
            </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───── Sub-components ───── */
function StatCard({ label, value, color }: { label: string; value: number | React.ReactNode; color: string }) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 border-indigo-100',
    emerald: 'bg-emerald-50 border-emerald-100',
    blue: 'bg-blue-50 border-blue-100',
    amber: 'bg-amber-50 border-amber-100',
  };
  const textMap: Record<string, string> = {
    indigo: 'text-indigo-600',
    emerald: 'text-emerald-600',
    blue: 'text-blue-600',
    amber: 'text-amber-600',
  };

  return (
    <div className={`rounded-2xl border p-4 ${colorMap[color] ?? 'bg-white'}`}>
      <p className="text-[11px] font-medium text-gray-500 mb-1"><T k={label} /></p>
      <p className={`text-2xl font-bold ${textMap[color] ?? 'text-gray-900'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors whitespace-nowrap ${
        active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      <T k={label} />
      {count != null && (
        <span className={`ml-1 ${active ? 'text-indigo-200' : 'text-gray-400'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1"><T k={label} /></label>
      {children}
    </div>
  );
}
