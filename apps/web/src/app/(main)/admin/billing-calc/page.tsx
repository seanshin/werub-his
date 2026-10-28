'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { money } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { GradeCalculatorPanel } from './grade-calculator';
import { InstitutionGradePanel, NhiOutpatientRatePanel } from './institution-settings';

/** `source` — db(저장된 값)·env·default(카탈로그 기본값 = 설정이 아니다) */
interface ConfigItem { key: string; value: string | number | boolean | Record<string, unknown>; description: string; category: string; source?: string }

const SECTION_LABELS: Record<string, string> = {
  institution: '기관 등급',
  copay: '보험종류별 본인부담률',
  fee: '기본 수가',
  discount: '할인/감면 정책',
  rounding: '계산 규칙',
};

const SELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {};

/**
 * 🔴 (2026-10-20) 전용 패널에서만 정하는 설정 — 아래 범용 목록에서 뺀다.
 *  · 종별: 결정 기록 경로(근거 필수 · 집행 엔진)로만 — 목록에서 바로 바꾸면 근거 없이 청구 단가 전체가 바뀐다
 *  · 건보 외래 율 종별 차등: 객체 값이라 한 칸 입력으로 표현하지 못한다
 */
const PANEL_ONLY_KEYS = new Set(['billing.institution.grade', 'billing.copay.nhi.outpatient.byGrade']);

export default function BillingCalcSettingsPage() {
  const tAttr = useTAttr();
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string | number | boolean | Record<string, unknown>>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const loadConfigs = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: ConfigItem[] | { data: ConfigItem[] } }>('/api/v1/config?category=billing');
      const items: ConfigItem[] = Array.isArray(res.data) ? res.data : ((res.data as { data?: ConfigItem[] })?.data ?? []);
      setConfigs(items);
      const vals: Record<string, string | number | boolean | Record<string, unknown>> = {};
      for (const c of items) vals[c.key] = c.value;
      setEditValues(vals);
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  const handleSave = async (key: string) => {
    setSaving(p => ({ ...p, [key]: true }));
    try {
      let val = editValues[key];
      if (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val)) val = Number(val);
      if (val === 'true') val = true;
      if (val === 'false') val = false;
      await apiClient.put(`/api/v1/config/${encodeURIComponent(key)}`, { value: val });
      setSaved(p => ({ ...p, [key]: true }));
      setTimeout(() => setSaved(p => ({ ...p, [key]: false })), 2000);
    } catch { toast.error('저장 실패'); }
    setSaving(p => ({ ...p, [key]: false }));
  };

  const handleSaveAll = async () => {
    for (const config of configs) {
      // 🔴 (2026-10-20) 전용 패널 설정(종별 = 결정 기록 · 건보 외래 율 종별 차등)은 "전체 저장"이 건드리지 않는다 —
      //    화면 기본값(의원 등)을 박아 넣으면 아무도 고르지 않은 값이 정해진 것처럼 된다.
      if (PANEL_ONLY_KEYS.has(config.key)) continue;
      await handleSave(config.key);
    }
    toast.success('전체 설정이 저장되었습니다.');
  };

  // 섹션별 분류
  const sections: Record<string, ConfigItem[]> = {};
  configs.filter((c) => !PANEL_ONLY_KEYS.has(c.key)).forEach(c => {
    const parts = c.key.replace('billing.', '').split('.');
    const section = parts[0];
    if (!sections[section]) sections[section] = [];
    sections[section].push(c);
  });

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="수가 계산기 설정" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="보험종류별 부담률, 기본 수가, 할인/감면 정책을 관리합니다" /></p>
        </div>
        <button onClick={handleSaveAll} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
          <T k="전체 저장" />
        </button>
      </div>

      {/*
        🔴 W8 R3 C3 — 종전 수납 계산기는 이 설정을 무시하고 보험유형 정적표(NHI 30 / MEDICAID 0 / …)로
        요율을 정해, 의료급여 2종 15%·차상위 14%·산정특례 10%·자격상실 100% 를 실청구와 다르게 말했다.
        이제 계산기·실청구 모두 `EligibilityService.resolveCopayRate`(자격조회 우선, 아래 값은 그 소스)를 쓴다.
      */}
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs font-bold text-amber-900"><T k="실제 적용 요율은 환자별 수진자 자격조회 결과로 정해집니다" /></p>
        <p className="text-[11px] text-amber-800 mt-0.5">
          아래 값은 자격구분(건보·의료급여 1/2종·차상위·산정특례)별 <b>소스 값</b>이며, 수납 계산기와 실청구는 같은 정본
          함수를 통해 이 값을 씁니다. <b>자격조회 기록이 없는 환자는 요율을 단정하지 않고 &ldquo;자격 미확인 — 산출 불가&rdquo;</b>로 표시됩니다.
        </p>
      </div>

      {/* 요양기관 종별(결정 기록) · 건보 외래 본인부담률(종별) · 종별 계산기(2026-10-20) */}
      <InstitutionGradePanel />
      <NhiOutpatientRatePanel configs={configs} onSaved={() => void loadConfigs()} />
      <GradeCalculatorPanel />

      {/* 현재 계산 미리보기 */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 mb-6">
        <h3 className="text-sm font-bold text-blue-900 mb-3"><T k="현재 계산 설정 요약" /></h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-400"><T k="기관 등급" /></p>
            {/* 🔴 (2026-10-20) 종전 `?? 'CLINIC'` — 설정이 없어도 "의원"이라 말했다. 설정 행이 없으면 미설정이라고 말한다 */}
            <p className="text-sm font-bold text-gray-900" data-grade-summary>
              {/* 🔴 목록은 카탈로그 기본값('CLINIC')도 값으로 싣는다 — 출처가 default 면 설정이 아니다 */}
              {configs.some((c) => c.key === 'billing.institution.grade' && c.source !== 'default' && c.value != null && c.value !== '')
                ? <T k={{'CLINIC':'의원','HOSPITAL':'병원','GENERAL':'종합병원','TERTIARY':'상급종합병원'}[String(editValues['billing.institution.grade'])] ?? String(editValues['billing.institution.grade'])} />
                : <span className="text-amber-700"><T k="미설정(의원으로 청구)" /></span>}
            </p>
          </div>
          <div className="bg-white rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-400"><T k="건보 외래 부담률" /></p>
            <p className="text-sm font-bold text-blue-600">{String(editValues['billing.copay.nhi.outpatient'] ?? 30)}<Unit>%</Unit></p>
          </div>
          <div className="bg-white rounded-xl p-3 text-center">
            {/* 🔴 (2026-10-20) 종전엔 설정 `billing.fee.consultation.initial`(15,890)을 보였다 — 실청구가 쓰지 않는 값이다(미배선 다이얼).
                진찰료는 수가 마스터의 종별 코드로 청구된다 — 위 종별 계산기가 그 값을 보인다. */}
            <p className="text-[10px] text-gray-400"><T k="초진 진찰료" /></p>
            <p className="text-[11px] font-medium text-gray-700" data-consult-fee-summary><T k="수가 고시·종별 코드(위 계산기)" /></p>
          </div>
          <div className="bg-white rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-400"><T k="원단위 절사" /></p>
            <p className="text-sm font-bold text-gray-900">{String(editValues['billing.rounding'] ?? 10)}<Unit>원</Unit> <T k="미만" /></p>
          </div>
        </div>
      </div>

      {/* 섹션별 설정 */}
      {Object.entries(sections).map(([section, items]) => (
        <div key={section} className="mb-6">
          <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-5 bg-blue-500 rounded-full" />
            <T k={SECTION_LABELS[section] ?? section} />
          </h3>
          <div className="space-y-2">
            {items.map(config => {
              const val = editValues[config.key];
              const selectOpts = SELECT_OPTIONS[config.key];
              const isNumber = typeof config.value === 'number';

              return (
                <div key={config.key} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-gray-900">{config.description}</p>
                      <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{config.key}</span>
                    </div>
                    {selectOpts ? (
                      <select value={String(val ?? '')} onChange={e => setEditValues(p => ({ ...p, [config.key]: e.target.value }))}
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500">
                        {selectOpts.map(opt => <option key={opt.value} value={opt.value}>{tAttr(opt.label)}</option>)}
                      </select>
                    ) : (
                      <input type={isNumber ? 'number' : 'text'} value={String(val ?? '')}
                        onChange={e => setEditValues(p => ({ ...p, [config.key]: e.target.value }))}
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                    )}
                  </div>
                  <button onClick={() => handleSave(config.key)} disabled={saving[config.key]}
                    className={`mt-5 px-3 py-1.5 text-xs font-medium rounded-lg flex-shrink-0 ${
                      saved[config.key] ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                    }`}>
                    <T k={saving[config.key] ? '...' : saved[config.key] ? '\u2713' : '저장'} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {configs.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p><T k="수가 설정 항목이 없습니다." /></p>
          <p className="text-xs mt-1"><T k="시스템 설정에서 billing 카테고리 항목을 추가하세요." /></p>
        </div>
      )}

      {/* 법적 안내 */}
      <div className="mt-6 text-[10px] text-gray-400 space-y-0.5">
        <p><T k="※ 본인부담률은 국민건강보험법 시행령 제19조에 따릅니다." /></p>
        <p><T k="※ 수가 변경 시 즉시 수납 계산에 반영됩니다." /></p>
        <p><T k="※ 할인/감면 정책 변경 시 기존 미수납 건에는 소급 적용되지 않습니다." /></p>
      </div>
    </div>
  );
}
