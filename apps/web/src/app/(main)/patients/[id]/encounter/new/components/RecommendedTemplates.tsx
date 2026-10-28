'use client';

import { useMemo, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

interface TplItem {
  id: string; dayOffset: number; timeOfDay?: string | null; itemType: string; title: string;
  refCodeId?: string | null; repeatEvery?: number | null; repeatCount?: number | null; isDefault?: boolean;
}
interface RecTemplate {
  id: string; name: string; department?: string | null; totalDays: number;
  items: TplItem[]; matchScore?: number; matchedBy?: string; matchedCode?: string;
}

const TYPE_META: Record<string, { label: string; icon: string }> = {
  VISIT: { label: '재진', icon: '🩺' }, LAB: { label: '검사', icon: '🔬' }, IMAGING: { label: '영상', icon: '📷' },
  PROCEDURE: { label: '처치', icon: '💉' }, MEDICATION_CYCLE: { label: '투약주기', icon: '💊' },
  EDUCATION: { label: '교육', icon: '📖' }, NURSING: { label: '간호', icon: '🩹' }, ASSESSMENT: { label: '평가', icon: '📋' },
};
const PRE_ORDER_TYPES = new Set(['LAB', 'IMAGING']);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** 진단 기반 치료일정 템플릿 추천 배너 + 전개 검토 모달 (진단 확정 → 일정 전개) */
export function RecommendedTemplates({ diagnosisCodes, primaryCode, patientId, encounterId }: {
  diagnosisCodes: string[]; primaryCode?: string; patientId: string; encounterId?: string | null;
}) {
  const codes = Array.from(new Set(diagnosisCodes.filter(Boolean)));
  const [applyTarget, setApplyTarget] = useState<RecTemplate | null>(null);

  const { data, isError, error, refetch } = useQuery({
    queryKey: ['tpl-recommend', codes.join(','), primaryCode ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: RecTemplate[] }>(
          `/api/v1/treatment-templates/recommend?diagnosisCodes=${encodeURIComponent(codes.join(','))}`
          + (primaryCode ? `&primaryCode=${encodeURIComponent(primaryCode)}` : ''),
        ),
    enabled: codes.length > 0,
  });
  const raw = data?.data as unknown;
  const templates: RecTemplate[] = Array.isArray(raw) ? raw as RecTemplate[] : ((raw as { data?: RecTemplate[] })?.data ?? []);

  if (!codes.length) return null;
  // 🔴 추천 조회 실패를 "추천 없음"으로 숨기지 않는다(배너가 통째로 사라진다)
  if (isError) {
    return (
      <div className="mt-3 p-3 border border-gray-200 bg-gray-50 rounded-xl">
        <span className="text-xs font-semibold text-gray-700"><T k="🗓️ 추천 치료일정" /></span>
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" className="mt-1.5" />
      </div>
    );
  }
  if (templates.length === 0) return null;

  return (
    <div className="mt-3 p-3 border border-cyan-200 bg-cyan-50 rounded-xl">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm font-semibold text-cyan-800"><T k="🗓️ 추천 치료일정" /></span>
        <span className="text-[10px] text-cyan-500"><T k="진단 기반 — 전개 시 검토 모달 경유" /></span>
      </div>
      <div className="space-y-1.5">
        {templates.map(tpl => (
          <div key={tpl.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
            <div className="min-w-0">
              <span className="text-xs font-medium text-gray-800">{tpl.name}</span>
              {tpl.matchedCode && primaryCode === tpl.matchedCode && (
                <span className="ml-1.5 text-[9px] font-bold text-cyan-700 bg-cyan-100 px-1.5 py-0.5 rounded"><T k="주상병" /></span>
              )}
              <span className="text-[10px] text-gray-400 ml-2">{tpl.totalDays}<Unit>일</Unit> 과정 · {tpl.items.length}항목{tpl.matchScore != null ? ` · 적합도 ${tpl.matchScore}` : ''}</span>
            </div>
            <button type="button" onClick={() => setApplyTarget(tpl)}
              className="px-2.5 py-1 text-[11px] font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 shrink-0">
              <T k="일정 전개" />
            </button>
          </div>
        ))}
      </div>

      {applyTarget && (
        <ApplyTemplateModal template={applyTarget} patientId={patientId} encounterId={encounterId}
          onClose={() => setApplyTarget(null)} onApplied={() => setApplyTarget(null)} />
      )}
    </div>
  );
}

function ApplyTemplateModal({ template, patientId, encounterId, onClose, onApplied }: {
  template: RecTemplate; patientId: string; encounterId?: string | null;
  onClose: () => void; onApplied: () => void;
}) {
  const [anchorDate, setAnchorDate] = useState(ymd(new Date()));
  const [checked, setChecked] = useState<Record<string, boolean>>(
    () => Object.fromEntries(template.items.map(it => [it.id, it.isDefault ?? true])),
  );
  const [applying, setApplying] = useState(false);

  const anchor = useMemo(() => new Date(`${anchorDate}T00:00:00`), [anchorDate]);
  const plannedDate = (day: number) => {
    const d = new Date(anchor.getTime() + day * 86400_000);
    return kdate(d, 'monthDayWeekday');
  };
  const occurrences = (it: TplItem) =>
    it.repeatEvery && it.repeatCount && it.repeatCount > 1
      ? Array.from({ length: it.repeatCount }, (_, k) => it.dayOffset + k * it.repeatEvery!).filter(d => d <= template.totalDays)
      : [it.dayOffset];

  const selectedCount = template.items.filter(it => checked[it.id]).length;

  const apply = async () => {
    setApplying(true);
    try {
      const res = await apiClient.post<{ data: { itemsCreated: number; linkedPreOrders: number; plannedOnly: number } }>(
        `/api/v1/treatment-templates/${template.id}/apply`,
        {
          patientId,
          ...(encounterId ? { encounterId } : {}),
          anchorDate,
          selectedItemIds: template.items.filter(it => checked[it.id]).map(it => it.id),
        },
      );
      const d = res.data;
      toast.success(`치료일정 전개: ${d.itemsCreated}건 (검사 사전처방 ${d.linkedPreOrders}건 · 계획 ${d.plannedOnly}건) — 환자차트 '치료일정' 탭에서 확인`);
      onApplied();
    } catch (e) { toast.error((e as { message?: string })?.message || '전개 실패'); }
    setApplying(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-gray-900">치료일정 전개 — {template.name}</h3>
          <p className="text-[11px] text-gray-400 mt-1"><T k="검사/영상은 사전처방(승인 대기)으로, 나머지는 계획 항목으로 생성됩니다. 자동 확정 없음." /></p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500"><T k="시작일(D0)" /></label>
          <input type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5" />
          <span className="text-[11px] text-gray-400">{template.totalDays}<Unit>일</Unit> <T k="과정" /></span>
        </div>

        <div className="space-y-1">
          {template.items.map(it => {
            const occ = occurrences(it);
            return (
              <label key={it.id}
                className={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer ${checked[it.id] ? 'border-cyan-200 bg-cyan-50/50' : 'border-gray-100 hover:bg-gray-50'}`}>
                <input type="checkbox" checked={!!checked[it.id]}
                  onChange={e => setChecked(prev => ({ ...prev, [it.id]: e.target.checked }))} />
                <span className="text-[11px] text-gray-400 whitespace-nowrap w-24">{TYPE_META[it.itemType]?.icon} {TYPE_META[it.itemType]?.label ?? it.itemType}</span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-gray-900">{it.title}</span>
                  <span className="ml-2 text-[11px] text-gray-400">
                    {occ.length > 1 ? `${occ.length}회 (${plannedDate(occ[0])} 시작·${it.repeatEvery}일 간격)` : plannedDate(it.dayOffset)}
                  </span>
                </span>
                {PRE_ORDER_TYPES.has(it.itemType) && (
                  <span className="text-[9px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="사전처방 생성" /></span>
                )}
                {it.isDefault && <span className="text-[9px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="기본형" /></span>}
              </label>
            );
          })}
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="닫기" /></button>
          <button onClick={apply} disabled={applying || selectedCount === 0}
            className="px-4 py-2 text-xs font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50">
            {applying ? '전개 중...' : `선택 ${selectedCount}건 전개`}
          </button>
        </div>
      </div>
    </div>
  );
}
