'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

export interface OrderSetApplyItem {
  type: string;
  name: string;
  code?: string;
  medicationCodeId?: string;
  procedureCodeId?: string;
  dosage?: string;
  frequency?: string;
  duration?: number;
  route?: string;
  certType?: string;
  required?: boolean;
  isDefault?: boolean;
  instructions?: string;
}

const TYPE_META: Record<string, { label: string; icon: string }> = {
  MEDICATION: { label: '약처방', icon: '💊' },
  LAB: { label: '검사', icon: '🔬' },
  IMAGING: { label: '영상', icon: '📷' },
  THERAPY: { label: '치료', icon: '🩹' },
  DIET: { label: '식이', icon: '🍚' },
  ACTIVITY: { label: '활동', icon: '🚶' },
  NURSING: { label: '간호', icon: '🩺' },
  ORDER: { label: '일반오더', icon: '📋' },
  DOCUMENT: { label: '발급 서류', icon: '📄' },
};
const TYPE_ORDER = ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY', 'NURSING', 'ORDER', 'DOCUMENT'];

const CODE_REQUIRED = new Set(['MEDICATION', 'LAB', 'IMAGING', 'THERAPY']);
const isUnresolved = (it: OrderSetApplyItem) =>
  CODE_REQUIRED.has(it.type) && !it.medicationCodeId && !it.procedureCodeId;

/**
 * 약속처방 적용 검토 모달 — 기본형(isDefault) 자동 체크·필수(required) 고정,
 * 미해석 항목 표시(생성 제외). 확인 시 선택 항목만 생성 실행.
 */
export function ApplyOrderSetModal({
  name, items, warnings, onConfirm, onClose,
}: {
  name: string;
  items: OrderSetApplyItem[];
  warnings: string[]; // 연령군/금기 경고 (호출측 계산)
  onConfirm: (selected: OrderSetApplyItem[]) => void;
  onClose: () => void;
}) {
  // 세트에 isDefault 지정이 하나도 없으면 레거시 — 전량 기본 선택(기존 동작 호환)
  const legacyAllDefault = useMemo(() => !items.some(it => it.isDefault !== undefined), [items]);
  const [checked, setChecked] = useState<boolean[]>(() =>
    items.map(it => !isUnresolved(it) && (it.required || (legacyAllDefault ? true : !!it.isDefault))),
  );

  const groups = useMemo(() => {
    const map = new Map<string, number[]>();
    items.forEach((it, i) => {
      const key = TYPE_META[it.type] ? it.type : 'ORDER';
      map.set(key, [...(map.get(key) ?? []), i]);
    });
    return TYPE_ORDER.filter(t => map.has(t)).map(t => ({ type: t, idx: map.get(t)! }));
  }, [items]);

  const selectedCount = checked.filter(Boolean).length;

  // P3-c: 적용 시점 AI 안전 체크 — 비차단(응답 지연/실패 시 모달 동작 무영향, 차단은 기존 DUR 게이트만)
  const [aiCheck, setAiCheck] = useState<{ risk?: string; events: string[] } | null>(null);
  useEffect(() => {
    const medNames = items.filter(it => it.type === 'MEDICATION' && it.name).map(it => it.name);
    if (!medNames.length) return;
    let alive = true;
    apiClient.post<{ data: { risk_level?: string; adverse_events?: { event?: string; drug?: string }[] } }>(
      '/api/v1/ai/predict/adverse-drug', { drugs: medNames.slice(0, 10) },
    ).then(res => {
      if (!alive) return;
      const d = res?.data;
      if (d) setAiCheck({ risk: d.risk_level, events: (d.adverse_events ?? []).map(e => e.event ?? e.drug ?? '').filter(Boolean).slice(0, 3) });
    }).catch(() => { /* 비차단 */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const unresolvedCount = items.filter(isUnresolved).length;

  const toggle = (i: number) => {
    if (items[i].required || isUnresolved(items[i])) return; // 필수 고정·미해석 선택 불가
    setChecked(prev => prev.map((c, j) => (j === i ? !c : c)));
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-gray-900">약속처방 적용 검토 — {name}</h3>
          <p className="text-[11px] text-gray-400 mt-1"><T k="기본형 항목이 자동 선택됩니다. 검토 후 생성할 항목을 확정하세요." /></p>
        </div>

        {aiCheck && (aiCheck.risk === 'HIGH' || aiCheck.risk === 'MODERATE' || aiCheck.events.length > 0) && (
          <div className={`rounded-xl p-2.5 border ${aiCheck.risk === 'HIGH' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
            <p className="text-xs font-medium text-gray-800">
              {AI_ORIGIN_TEXT} 안전 체크: 위험도 {aiCheck.risk === 'HIGH' ? '고위험' : aiCheck.risk === 'MODERATE' ? '주의' : '참고'}
              {aiCheck.events.length > 0 && <span className="text-gray-500"> — {aiCheck.events.join(', ')}</span>}
            </p>
            <p className="text-[9px] text-gray-400 mt-0.5">비차단 참고용 — 차단 판정은 DUR 게이트, 최종 판단은 의사에게 있습니다</p>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
            {warnings.map((w, i) => <p key={i} className="text-xs text-amber-800">⚠ {w}</p>)}
          </div>
        )}
        {unresolvedCount > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-2.5">
            <p className="text-xs text-red-700">미해석 {unresolvedCount}건은 생성에서 제외됩니다 — 관리자 코드 해석 필요</p>
          </div>
        )}

        {groups.map(g => (
          <div key={g.type} className="space-y-1">
            <p className="text-xs font-semibold text-gray-500">{TYPE_META[g.type].icon} {TYPE_META[g.type].label}</p>
            {g.idx.map(i => {
              const it = items[i];
              const unres = isUnresolved(it);
              return (
                <label key={i}
                  className={`flex items-center gap-2 p-2 rounded-lg border text-sm ${
                    unres ? 'border-red-100 bg-red-50/40 cursor-not-allowed opacity-70'
                      : checked[i] ? 'border-blue-200 bg-blue-50/50 cursor-pointer' : 'border-gray-100 cursor-pointer hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={checked[i]} disabled={unres || it.required} onChange={() => toggle(i)} />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-gray-900">{it.name}</span>
                    {(it.dosage || it.frequency) && (
                      <span className="ml-2 text-[11px] text-gray-400">{it.dosage ?? ''} {it.frequency ?? ''}{it.duration ? ` · ${it.duration}일` : ''}</span>
                    )}
                  </span>
                  {it.required && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="필수" /></span>}
                  {!it.required && it.isDefault && <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded whitespace-nowrap"><T k="기본형" /></span>}
                  {unres && <span className="text-[10px] font-bold text-red-500 whitespace-nowrap">미해석</span>}
                </label>
              );
            })}
          </div>
        ))}

        <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="닫기" /></button>
          <button
            onClick={() => onConfirm(items.filter((_, i) => checked[i]))}
            disabled={selectedCount === 0}
            className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            선택 {selectedCount}건 생성
          </button>
        </div>
      </div>
    </div>
  );
}
