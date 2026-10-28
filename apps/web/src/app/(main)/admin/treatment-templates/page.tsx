'use client';

import { ApprovalRecordNotice } from '@/components/governance/ApprovalRecordNotice';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAdminWrite } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { truncatedFieldsOf, truncationSummary } from '@/lib/truncated-fields';

/** 서버가 저장하지 않은 템플릿 항목(원래 순번) — `{ data: { droppedItems } }`·`{ droppedItems }` 어느 쪽이든 · 모양이 다르면 빈 목록 */
function droppedItemsOf(res: unknown): { index: number; reason: string }[] {
  const resBody = res as { data?: { droppedItems?: unknown }; droppedItems?: unknown } | null | undefined;
  const list = resBody?.data?.droppedItems ?? resBody?.droppedItems;
  if (!Array.isArray(list)) return [];
  return list.filter((d): d is { index: number; reason: string } => !!d && typeof (d as { index: unknown }).index === 'number');
}
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { activationNotices, editModeHint, editResultNotice } from '@/components/governance/catalog-lifecycle-feedback';
import { FormularyChip, FormularySummary, useFormularyStatus } from '@/components/formulary/FormularyChip';

/* ── 상수 ── */
const STATUSES = [
  { value: '', label: '전체' },
  { value: 'DRAFT', label: '작성중' },
  { value: 'PENDING_APPROVAL', label: '승인대기' },
  { value: 'APPROVED', label: '승인' },
  { value: 'ACTIVE', label: '활성' },
  { value: 'DEPRECATED', label: '폐기' },
];
const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  ACTIVE: 'bg-blue-100 text-blue-700',
  DEPRECATED: 'bg-red-100 text-red-500',
};
const ITEM_TYPES = ['VISIT', 'LAB', 'IMAGING', 'PROCEDURE', 'MEDICATION_CYCLE', 'EDUCATION', 'NURSING', 'ASSESSMENT'];
const TYPE_META: Record<string, { label: string; icon: string }> = {
  VISIT: { label: '재진', icon: '🩺' }, LAB: { label: '검사', icon: '🔬' }, IMAGING: { label: '영상', icon: '📷' },
  PROCEDURE: { label: '처치', icon: '💉' }, MEDICATION_CYCLE: { label: '투약주기', icon: '💊' },
  EDUCATION: { label: '교육', icon: '📖' }, NURSING: { label: '간호', icon: '🩹' }, ASSESSMENT: { label: '평가', icon: '📋' },
};
const CODE_REQUIRED = new Set(['LAB', 'IMAGING', 'PROCEDURE', 'MEDICATION_CYCLE']);

/* ── 타입 ── */
interface TplItem {
  dayOffset: number; timeOfDay?: string | null; itemType: string; title: string;
  refCodeId?: string | null; repeatEvery?: number | null; repeatCount?: number | null;
  isDefault?: boolean; notes?: string | null;
}
interface DxMapping { diagnosisCode: string; matchType: string; role: string; weight: number }
interface Template {
  id: string; name: string; department?: string | null; description?: string | null;
  status: string; version: number; totalDays: number;
  /** 승인자 — 승인 단계를 거치지 않으면 비어 있다 */
  approvedBy?: string | null;
  items: TplItem[]; diagnoses: DxMapping[];
}
interface CodeItem { id: string; code: string; nameKo: string }

const isUnresolved = (it: TplItem) => CODE_REQUIRED.has(it.itemType) && !it.refCodeId;

export default function TreatmentTemplatesPage() {
  const canWrite = useAdminWrite();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<Template | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [dxTarget, setDxTarget] = useState<Template | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['treatment-templates', statusFilter],
    queryFn: () => apiClient.get<{ data: Template[] }>('/api/v1/treatment-templates', { status: statusFilter || undefined }),
  });
  const raw = data?.data as unknown;
  const templates: Template[] = Array.isArray(raw) ? raw as Template[] : ((raw as { data?: Template[] })?.data ?? []);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/api/v1/treatment-templates/${id}/status`, { status }),
    onSuccess: (r) => {
      toast.success(tAttr('상태가 변경되었습니다'));
      for (const n of activationNotices(r)) toast.warning(tfAttr(n.k, n.params ?? {}));
      qc.invalidateQueries({ queryKey: ['treatment-templates'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('상태 변경 실패')),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/treatment-templates/${id}`),
    onSuccess: () => { toast.success(tAttr('삭제되었습니다')); qc.invalidateQueries({ queryKey: ['treatment-templates'] }); },
    onError: () => toast.error(tAttr('삭제 실패')),
  });

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['treatment-templates'] });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="치료일정 템플릿" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="진단 확정 시 환자 스케줄로 전개되는 D-day 기반 일정 정의 (재진·검사·처치·교육)" /></p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"><T k="+ 생성" /></button>
      </div>

      {/* 사용 중인데 승인 기록이 없는 템플릿(임상 규칙 교차검증 R4) */}
      <ApprovalRecordNotice items={data ? templates : undefined} what={<T k="치료일정 템플릿" />} recordPath={(id) => `/api/v1/treatment-templates/${id}/approval-record`} onRecorded={() => qc.invalidateQueries({ queryKey: ['treatment-templates'] })} />

      <div className="flex gap-2 flex-wrap">
        {STATUSES.map(s => (
          <button key={s.value} onClick={() => setStatusFilter(s.value)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium ${statusFilter === s.value ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
            <T k={s.label} />
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : templates.length === 0 ? (
        <EmptyState icon="📄" title="등록된 템플릿이 없습니다" className="bg-white rounded-xl border" />
      ) : (
        <div className="space-y-3">
          {templates.map(tpl => {
            const isOpen = expanded.has(tpl.id);
            const unresolved = tpl.items.filter(isUnresolved).length;
            return (
              <div key={tpl.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50/50" onClick={() => toggle(tpl.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[tpl.status] ?? 'bg-gray-100'}`}>
                        <T k={STATUSES.find(s => s.value === tpl.status)?.label ?? tpl.status} />
                      </span>
                      {tpl.department && <span className="text-[11px] text-gray-400">{tpl.department}</span>}
                      <span className="text-[11px] text-gray-400">{tpl.totalDays}<Unit><T k="일@단위" /></Unit> <T k="과정" /></span>
                      {tpl.diagnoses.length > 0 && (
                        <span className="text-[11px] font-mono text-indigo-500">{tpl.diagnoses.map(d => d.diagnosisCode).slice(0, 3).join(', ')}{tpl.diagnoses.length > 3 ? '…' : ''}</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 truncate">{tpl.name}</p>
                    {tpl.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{tpl.description}</p>}
                  </div>
                  <div className="flex items-center gap-3 ml-3 shrink-0">
                    {unresolved > 0 && <span className="text-[11px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><T k="미해석" /> {unresolved}</span>}
                    <span className="text-xs text-gray-400">{tpl.items.length}<T k="항목" /></span>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-gray-100">
                    <div className="px-4 py-3 bg-gray-50/50">
                      <table className="w-full text-sm">
                        <thead><tr>
                          <th className="text-left text-xs text-gray-400 pb-2 w-[70px]">D-day</th>
                          <th className="text-left text-xs text-gray-400 pb-2 w-[90px]"><T k="구분" /></th>
                          <th className="text-left text-xs text-gray-400 pb-2"><T k="항목" /></th>
                          <th className="text-left text-xs text-gray-400 pb-2 w-[110px]"><T k="반복" /></th>
                          <th className="text-left text-xs text-gray-400 pb-2 w-[60px]"><T k="기본" /></th>
                        </tr></thead>
                        <tbody>
                          {tpl.items.map((it, i) => (
                            <tr key={i} className="border-b border-gray-100 last:border-0">
                              <td className="py-1.5 font-mono text-gray-600">D+{it.dayOffset}{it.timeOfDay ? ` ${it.timeOfDay}` : ''}</td>
                              <td className="py-1.5 text-gray-500 whitespace-nowrap">{TYPE_META[it.itemType]?.icon} <T k={TYPE_META[it.itemType]?.label ?? it.itemType} /></td>
                              <td className="py-1.5 font-medium text-gray-900">
                                {it.title}
                                {isUnresolved(it) && <span className="ml-1.5 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded"><T k="미해석" /></span>}
                              </td>
                              <td className="py-1.5 text-xs text-gray-500">{it.repeatEvery ? `${it.repeatEvery}${tAttr('일마다')} ×${it.repeatCount ?? '-'}` : '-'}</td>
                              <td className="py-1.5 text-xs">{it.isDefault ? '✓' : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-2 border-t border-gray-100 flex gap-2 flex-wrap">
                      <button onClick={e => { e.stopPropagation(); setEditTarget(tpl); }}
                        className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"><T k="수정" /></button>
                      <button onClick={e => { e.stopPropagation(); setDxTarget(tpl); }}
                        className="text-xs px-3 py-1 rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100"><T k="진단 매핑" /> ({tpl.diagnoses.length})</button>
                      {/* 🔴 상태 전이·삭제는 서버가 `@Roles(ADMIN)` 이다 — 의사에게 띄우면 누를 때마다 403 */}
                      {canWrite && tpl.status !== 'APPROVED' && tpl.status !== 'ACTIVE' && tpl.status !== 'DEPRECATED' && (
                        <button onClick={e => { e.stopPropagation(); statusMut.mutate({ id: tpl.id, status: tpl.status === 'DRAFT' ? 'PENDING_APPROVAL' : 'APPROVED' }); }}
                          className="text-xs px-3 py-1 rounded-lg bg-green-50 text-green-600 hover:bg-green-100">
                          <T k={tpl.status === 'DRAFT' ? '승인요청' : '승인'} />
                        </button>
                      )}
                      {canWrite && tpl.status === 'APPROVED' && (
                        <button onClick={e => { e.stopPropagation(); statusMut.mutate({ id: tpl.id, status: 'ACTIVE' }); }}
                          className="text-xs px-3 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100"><T k="활성화" /></button>
                      )}
                      {canWrite && tpl.status !== 'DEPRECATED' && (
                        <button onClick={e => { e.stopPropagation(); statusMut.mutate({ id: tpl.id, status: 'DEPRECATED' }); }}
                          className="text-xs px-3 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"><T k="폐기" /></button>
                      )}
                      {canWrite && <button onClick={e => { e.stopPropagation(); removeMut.mutate(tpl.id); }}
                        className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-600"><T k="삭제" /></button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(showCreate || editTarget) && (
        <TemplateBuilder template={editTarget ?? undefined}
          onClose={() => { setShowCreate(false); setEditTarget(null); }}
          onSaved={() => { setShowCreate(false); setEditTarget(null); refresh(); }} />
      )}
      {dxTarget && (
        <TplDiagnosisModal template={dxTarget} onClose={() => setDxTarget(null)}
          onSaved={() => { setDxTarget(null); refresh(); }} />
      )}
    </div>
  );
}

/* ── 빌더 (생성/수정) ── */
function TemplateBuilder({ template, onClose, onSaved }: { template?: Template; onClose: () => void; onSaved: () => void }) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [name, setName] = useState(template?.name ?? '');
  const [department, setDepartment] = useState(template?.department ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [totalDays, setTotalDays] = useState(template?.totalDays ?? 28);
  const [items, setItems] = useState<TplItem[]>(template?.items?.map(it => ({ ...it })) ?? []);
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<TplItem>) =>
    setItems(prev => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  // 원내 처방집 상태(처방 게이트와 같은 판정 · 2026-10-21 P4) — 약 주기는 약품 코드, 검사·영상은 행위 코드
  const fDomain = (it: TplItem) => (it.itemType === 'MEDICATION_CYCLE' ? 'MEDICATION' : it.itemType === 'LAB' ? 'LAB' : it.itemType === 'IMAGING' ? 'IMAGING' : null);
  const formulary = useFormularyStatus(items.map((it) => ({ domain: fDomain(it), codeId: it.refCodeId })));

  const save = async () => {
    if (!name.trim()) { toast.error(tAttr('템플릿명을 입력하세요')); return; }
    setSaving(true);
    try {
      const body = { name, department: department || undefined, description: description || undefined, totalDays, items };
      const res = template
        ? await apiClient.put(`/api/v1/treatment-templates/${template.id}`, body)
        : await apiClient.post('/api/v1/treatment-templates', body);
      // 사용 중 템플릿은 새 판 초안 · 승인 단계는 초안으로(2026-10-21 P2)
      const notice = template ? editResultNotice(res) : null;
      if (notice) toast.success(tfAttr(notice.k, notice.params ?? {}));
      else toast.success(template ? tAttr('수정되었습니다') : tAttr('생성되었습니다 (작성중)'));
      // 🔴 (U4) 항목 제목 200·메모 300자를 넘으면 서버가 잘라 저장한다 — 그 사실을 말한다
      const cut = truncatedFieldsOf(res);
      if (cut.length) toast.warning(`${tAttr('저장 한도를 넘은 칸을 잘라 저장했습니다')}: ${truncationSummary(cut)}`);
      // 🔴 (2026-09-15 P3) 제목이 빈 항목·알 수 없는 유형은 서버가 저장하지 않는다 — 조용히 사라지지 않게 행 번호로 말한다
      const dropped = droppedItemsOf(res);
      if (dropped.length) toast.warning(`${tAttr('제목이 비었거나 유형을 알 수 없어 저장하지 않은 항목')}: ${dropped.map((d) => `#${d.index + 1}`).join(' · ')}`);
      onSaved();
    } catch (e) { toast.error((e as { message?: string })?.message || tAttr('저장 실패')); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900"><T k={template ? '템플릿 수정' : '치료일정 템플릿 생성'} /></h3>
        {template && editModeHint(template.status) && <p className="rounded-lg bg-amber-50 px-2 py-1 text-[12px] text-amber-900" data-edit-mode-hint><T k={editModeHint(template.status)!} /></p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder={tAttr('템플릿명 (예: 당뇨 초진 12주)')}
            className="col-span-2 text-sm border rounded-lg px-3 py-2" />
          <input value={department} onChange={e => setDepartment(e.target.value)} placeholder={tAttr('진료과')}
            className="text-sm border rounded-lg px-3 py-2" />
          <div className="flex items-center gap-1">
            <input type="number" value={totalDays} onChange={e => setTotalDays(Number(e.target.value) || 28)}
              className="w-full text-sm border rounded-lg px-3 py-2" min={1} max={365} />
            <span className="text-xs text-gray-400 whitespace-nowrap"><T k="일@단위" /></span>
          </div>
        </div>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder={tAttr('설명')}
          className="w-full text-sm border rounded-lg px-3 py-2" />

        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500"><T k="일정 항목 (D-day 오프셋 기준)" /></p>
          <button type="button"
            onClick={() => setItems(prev => [...prev, { dayOffset: 0, itemType: 'VISIT', title: '', isDefault: true }])}
            className="text-xs px-3 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100"><T k="+ 항목 추가" /></button>
        </div>

        <FormularySummary counts={formulary.counts} />
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="border rounded-lg p-2.5 bg-gray-50/50 space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-gray-400">D+</span>
                <input type="number" value={it.dayOffset} onChange={e => update(i, { dayOffset: Number(e.target.value) || 0 })}
                  className="w-14 text-xs border rounded px-1.5 py-1" min={0} max={totalDays} />
                <input value={it.timeOfDay ?? ''} onChange={e => update(i, { timeOfDay: e.target.value })} placeholder="09:00"
                  className="w-16 text-xs border rounded px-1.5 py-1" />
                <select value={it.itemType} onChange={e => update(i, { itemType: e.target.value, refCodeId: null })}
                  className="text-xs border rounded px-1.5 py-1 bg-white">
                  {ITEM_TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].icon} {tAttr(TYPE_META[t].label)}</option>)}
                </select>
                <span className="text-[10px] text-gray-400 ml-1"><T k="반복" /></span>
                <input type="number" value={it.repeatEvery ?? ''} onChange={e => update(i, { repeatEvery: e.target.value ? Number(e.target.value) : null })}
                  placeholder={tAttr('주기(일)')} className="w-16 text-xs border rounded px-1.5 py-1" />
                <input type="number" value={it.repeatCount ?? ''} onChange={e => update(i, { repeatCount: e.target.value ? Number(e.target.value) : null })}
                  placeholder={tAttr('횟수@용법')} className="w-14 text-xs border rounded px-1.5 py-1" />
                <label className="flex items-center gap-1 text-[11px] text-gray-600 ml-1 cursor-pointer">
                  <input type="checkbox" checked={it.isDefault ?? true} onChange={e => update(i, { isDefault: e.target.checked })} /> <T k="기본" />
                </label>
                <FormularyChip r={formulary.lookup(fDomain(it), it.refCodeId)} />
                <div className="flex-1" />
                <button type="button" onClick={() => setItems(prev => prev.filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-600 text-xs">✕</button>
              </div>
              {CODE_REQUIRED.has(it.itemType) ? (
                <CodeSearchInput item={it} onPick={(c, isMed) => update(i, { title: c.nameKo, refCodeId: c.id, notes: isMed ? it.notes : it.notes })} onTitle={t => update(i, { title: t, refCodeId: null })} />
              ) : (
                <input value={it.title} maxLength={200} onChange={e => update(i, { title: e.target.value })}
                  placeholder={it.itemType === 'VISIT' ? tAttr('예: 외래 재진 (내분비)') : tAttr('항목명')}
                  className="w-full text-xs border rounded px-2 py-1.5" />
              )}
            </div>
          ))}
          {items.length === 0 && <p className="text-xs text-gray-400 text-center py-4"><T k="항목을 추가하세요" /></p>}
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="닫기" /></button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <T k={saving ? '저장 중...' : '저장'} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 코드 검색 입력 (코드 필수 유형 — 미해석 방지) ── */
function CodeSearchInput({ item, onPick, onTitle }: {
  item: TplItem;
  onPick: (c: CodeItem, isMed: boolean) => void;
  onTitle: (t: string) => void;
}) {
  const tAttr = useTAttr();
  const [results, setResults] = useState<CodeItem[]>([]);
  const isMed = item.itemType === 'MEDICATION_CYCLE';

  useEffect(() => { setResults([]); }, [item.itemType]);

  const search = async (q: string) => {
    onTitle(q);
    if (q.trim().length < 2) { setResults([]); return; }
    try {
      const endpoint = isMed ? '/api/v1/codes/medication' : '/api/v1/codes/procedure';
      const res = await apiClient.get<{ data: CodeItem[] }>(endpoint, { q: q.trim() });
      const raw = res.data as unknown;
      setResults(Array.isArray(raw) ? raw as CodeItem[] : ((raw as { data?: CodeItem[] })?.data ?? []));
    } catch { setResults([]); }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <input value={item.title} onChange={e => search(e.target.value)}
          placeholder={`${tAttr(TYPE_META[item.itemType]?.label ?? '')} ${tAttr('코드 검색 (2자 이상)')}`}
          className="flex-1 text-xs border rounded px-2 py-1.5" />
        {item.refCodeId
          ? <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="코드 확정" /></span>
          : <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="미해석" /></span>}
      </div>
      {!item.refCodeId && results.length > 0 && (
        <div className="border border-gray-100 rounded-lg max-h-36 overflow-y-auto divide-y divide-gray-50 bg-white">
          {results.slice(0, 6).map(c => (
            <button key={c.id} type="button" onClick={() => { onPick(c, isMed); setResults([]); }}
              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50">
              <span className="font-medium text-gray-900">{c.nameKo}</span>
              <span className="ml-2 font-mono text-gray-400">{c.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 진단 매핑 모달 (약속처방과 동일 규칙) ── */
function TplDiagnosisModal({ template, onClose, onSaved }: { template: Template; onClose: () => void; onSaved: () => void }) {
  const tAttr = useTAttr();
  const [rows, setRows] = useState<DxMapping[]>(template.diagnoses.map(d => ({ ...d })));
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<DxMapping>) =>
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put(`/api/v1/treatment-templates/${template.id}/diagnoses`, { diagnoses: rows });
      toast.success(tAttr('진단 매핑을 저장했습니다'));
      onSaved();
    } catch { toast.error(tAttr('저장 실패')); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-gray-900"><T k="진단 매핑" /> — {template.name}</h3>
          <p className="text-[11px] text-gray-400 mt-1"><T k="진단 확정 시 이 템플릿이 추천됩니다 (완전일치/상위분류 · 주상병한정 · 가중치)" /></p>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={r.diagnosisCode} onChange={e => update(i, { diagnosisCode: e.target.value.toUpperCase() })}
                placeholder={tAttr('KCD 코드/prefix')} className="w-28 text-xs border rounded px-2 py-1.5 font-mono" />
              <select value={r.matchType} onChange={e => update(i, { matchType: e.target.value })} className="text-xs border rounded px-1.5 py-1.5 bg-white">
                <option value="EXACT">{tAttr('완전일치')}</option>
                <option value="PREFIX">{tAttr('상위분류')}</option>
              </select>
              <select value={r.role} onChange={e => update(i, { role: e.target.value })} className="text-xs border rounded px-1.5 py-1.5 bg-white">
                <option value="ANY">{tAttr('주/부상병')}</option>
                <option value="PRIMARY_ONLY">{tAttr('주상병한정')}</option>
              </select>
              <input type="number" value={r.weight} onChange={e => update(i, { weight: Number(e.target.value) || 100 })}
                className="w-16 text-xs border rounded px-2 py-1.5" />
              <button onClick={() => setRows(prev => prev.filter((_, j) => j !== i))}
                className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
            </div>
          ))}
          <button onClick={() => setRows(prev => [...prev, { diagnosisCode: '', matchType: 'EXACT', role: 'ANY', weight: 100 }])}
            className="text-xs px-3 py-1 rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100"><T k="+ 매핑 추가" /></button>
        </div>
        <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="닫기" /></button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50">
            <T k={saving ? '저장 중...' : '저장'} />
          </button>
        </div>
      </div>
    </div>
  );
}
