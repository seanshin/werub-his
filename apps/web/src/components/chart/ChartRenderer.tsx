'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { getChart } from '@/lib/clinical-charts';
import { ClinicalChartRunner, type ClinicalChartValue } from '@/components/clinical-charts/ClinicalChartRunner';
import { useClinicalChartCapture } from '@/components/clinical-charts/capture-context';
import { apiClient } from '@/lib/api-client';
import { bradenRiskLevel, BRADEN_RISK_LABEL, morseRiskLevel, MORSE_RISK_LABEL } from '@hospital-run/shared';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 차트 템플릿 동적 폼 렌더러
 * ChartTemplate의 sections/fields JSON을 실제 입력 가능한 폼으로 렌더링
 *
 * Phase 2: 특수 필드 렌더러 완성 + ScoreCalculator 6종
 */

interface FieldDef {
  id: string;
  type: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  items?: string[];
  mappedTo?: string;
  columns?: number;
  width?: string;
  aiAssist?: boolean;
  calculator?: string;
  clinicalChartId?: string;
  codeSystem?: string;
  durCheck?: boolean;
  /** 조건부 표시 — 대상 필드 값이 조건 충족 시에만 렌더 */
  showWhen?: { fieldId: string; op: 'eq' | 'ne' | 'gt' | 'lt' | 'notEmpty'; value?: string | number };
}

/** showWhen 조건 평가 — 조건 미정의/대상 미지정이면 항상 표시 */
function isFieldVisible(field: FieldDef, values: Record<string, unknown>): boolean {
  const sw = field.showWhen;
  if (!sw?.fieldId) return true;
  const v = values[sw.fieldId];
  switch (sw.op) {
    case 'notEmpty': return v != null && v !== '' && v !== false;
    case 'eq': return String(v ?? '') === String(sw.value ?? '');
    case 'ne': return String(v ?? '') !== String(sw.value ?? '');
    case 'gt': return v != null && Number(v) > Number(sw.value);
    case 'lt': return v != null && Number(v) < Number(sw.value);
    default: return true;
  }
}

interface Section {
  id: string;
  title: string;
  icon?: string;
  columns?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  fields: FieldDef[];
}

interface ChartRendererProps {
  sections: Section[];
  layout: string;           // tabs, accordion, single-page
  values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown, mappedTo?: string) => void;
  disabled?: boolean;
}

export function ChartRenderer({ sections, layout, values, onChange, disabled }: ChartRendererProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(sections.filter(s => s.defaultOpen !== false).map(s => s.id))
  );

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (layout === 'tabs') {
    return (
      <div>
        <div className="flex gap-1 border-b border-gray-100 mb-4 overflow-x-auto">
          {sections.map((sec, i) => (
            <button key={sec.id} onClick={() => setActiveTab(i)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                activeTab === i ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}>{sec.title}</button>
          ))}
        </div>
        {sections[activeTab] && (
          <SectionFields section={sections[activeTab]} values={values} onChange={onChange} disabled={disabled} />
        )}
      </div>
    );
  }

  if (layout === 'accordion') {
    return (
      <div className="space-y-2">
        {sections.map(sec => (
          <div key={sec.id} className="border border-gray-100 rounded-xl overflow-hidden">
            <button onClick={() => toggleSection(sec.id)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors">
              <span className="text-sm font-semibold text-gray-900">{sec.title}</span>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${openSections.has(sec.id) ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {openSections.has(sec.id) && (
              <div className="p-4">
                <SectionFields section={sec} values={values} onChange={onChange} disabled={disabled} />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // single-page / side-by-side
  return (
    <div className={layout === 'side-by-side' ? 'grid grid-cols-2 gap-6' : 'space-y-6'}>
      {sections.map(sec => (
        <div key={sec.id}>
          <h4 className="text-sm font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">{sec.title}</h4>
          <SectionFields section={sec} values={values} onChange={onChange} disabled={disabled} />
        </div>
      ))}
    </div>
  );
}

function SectionFields({ section, values, onChange, disabled }: { section: Section; values: Record<string, unknown>; onChange: (id: string, val: FieldValue, mappedTo?: string) => void; disabled?: boolean }) {
  const cols = section.columns ?? 1;
  const gridClass = cols === 3 ? 'grid grid-cols-3 gap-3' : cols === 2 ? 'grid grid-cols-2 gap-3' : 'space-y-3';

  return (
    <div className={gridClass}>
      {section.fields.filter(field => isFieldVisible(field, values)).map(field => (
        <FieldRenderer key={field.id} field={field} value={(values[field.id] ?? values[field.mappedTo ?? ''] ?? '') as FieldValue} onChange={(val) => onChange(field.id, val, field.mappedTo)} disabled={disabled} />
      ))}
    </div>
  );
}

// Dynamic form field values can be primitives, arrays, or nested objects.
// This chart renderer accepts arbitrary field shapes defined by JSON templates at runtime.
type FieldValue = string | number | boolean | null | undefined | Record<string, unknown> | unknown[];

function FieldRenderer({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (val: FieldValue) => void; disabled?: boolean }) {
  const tAttr = useTAttr();
  const baseInput = "w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400";

  switch (field.type) {
    case 'text':
      return (
        <div>
          <FieldLabel field={field} />
          <input type="text" value={value as string | number | readonly string[] | undefined} onChange={e => onChange(e.target.value)} placeholder={field.placeholder} disabled={disabled} required={field.required} className={baseInput} />
        </div>
      );

    case 'textarea':
      return (
        <div>
          <FieldLabel field={field} />
          <textarea value={value as string | number | readonly string[] | undefined} onChange={e => onChange(e.target.value)} placeholder={field.placeholder} disabled={disabled} required={field.required} rows={field.rows ?? 3} className={`${baseInput} resize-none`} />
        </div>
      );

    case 'number':
      return (
        <div>
          <FieldLabel field={field} />
          <input type="number" value={value as string | number | undefined} onChange={e => onChange(e.target.value)} min={field.min} max={field.max} step={field.step} disabled={disabled} className={baseInput} />
        </div>
      );

    case 'select':
      return (
        <div>
          <FieldLabel field={field} />
          <select value={value as string | number | readonly string[] | undefined} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseInput}>
            <option value="">{tAttr('선택')}</option>
            {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      );

    case 'multiselect':
      return (
        <div>
          <FieldLabel field={field} />
          <div className="flex flex-wrap gap-1.5">
            {(field.options ?? []).map(opt => {
              const selected = Array.isArray(value) ? value.includes(opt) : false;
              return (
                <button key={opt} type="button" disabled={disabled}
                  onClick={() => {
                    const arr = Array.isArray(value) ? [...value] : [];
                    selected ? onChange(arr.filter(v => v !== opt)) : onChange([...arr, opt]);
                  }}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${selected ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:border-blue-200'}`}
                >{opt}</button>
              );
            })}
          </div>
        </div>
      );

    case 'checkbox':
      return (
        <label className="flex items-center gap-2 py-2 cursor-pointer">
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} disabled={disabled} className="w-4 h-4 rounded border-gray-300 text-blue-600" />
          <span className="text-sm text-gray-700">{field.label}</span>
        </label>
      );

    case 'date':
      return (
        <div>
          <FieldLabel field={field} />
          <input type="date" value={value as string | number | readonly string[] | undefined} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseInput} />
        </div>
      );

    case 'time':
      return (
        <div>
          <FieldLabel field={field} />
          <input type="time" value={value as string | number | readonly string[] | undefined} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseInput} />
        </div>
      );

    case 'slider':
      return (
        <div>
          <FieldLabel field={field} />
          <div className="flex items-center gap-3">
            <input type="range" min={field.min ?? 0} max={field.max ?? 10} step={field.step ?? 1} value={(value as number) || 0} onChange={e => onChange(Number(e.target.value))} disabled={disabled} className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
            <span className="text-sm font-bold text-blue-600 w-8 text-center">{(value as number) || 0}</span>
          </div>
        </div>
      );

    case 'checklist':
      return (
        <div>
          <FieldLabel field={field} />
          <div className="space-y-1">
            {(field.items ?? field.options ?? []).map(item => {
              const checked = Array.isArray(value) ? value.includes(item) : false;
              return (
                <label key={item} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked} disabled={disabled}
                    onChange={() => {
                      const arr = Array.isArray(value) ? [...value] : [];
                      checked ? onChange(arr.filter(v => v !== item)) : onChange([...arr, item]);
                    }}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600" />
                  <span className="text-gray-700">{item}</span>
                </label>
              );
            })}
          </div>
        </div>
      );

    // -- 의료 전용 필드 --

    case 'vitals':
      return <VitalsField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'diagnosis-search':
      return <DiagnosisSearchField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'medication-search':
      return <CodeSearchField field={field} value={value} onChange={onChange} disabled={disabled} kind="medication" />;

    case 'procedure-search':
      return <CodeSearchField field={field} value={value} onChange={onChange} disabled={disabled} kind="procedure" />;

    case 'pain-scale':
      return <PainScaleField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'score-calculator':
      return <ScoreCalculatorField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'clinical-chart':
      return <ClinicalChartField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'body-diagram':
      return <BodyDiagramField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'growth-chart':
      return <GrowthChartField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'lab-reference':
      return <LabReferenceField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'prescription':
      return <PrescriptionField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'order':
      return <OrderField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'timeline':
      return <TimelineField field={field} value={value} onChange={onChange} disabled={disabled} />;

    // 🔴 E8 — 서명·사진은 이 렌더러에 구현이 없다. "구현 예정" 점선 박스와 onClick 없는 '사진 첨부'
    //         버튼은 기능이 있는 것처럼 보였다. 없는 것은 없다고 말하고, 대체 경로를 안내한다(P16).
    case 'signature':
      return <UnavailableField field={field} what="전자 서명" where="진료 화면 하단 '서명' 으로 진료기록 전체를 서명합니다" />;

    case 'photo-capture':
      return <UnavailableField field={field} what="사진 촬영·첨부" where="환자 상세 > 첨부/미디어에서 등록하세요" />;

    default:
      return (
        <div>
          <FieldLabel field={field} />
          <input type="text" value={value as string | number | readonly string[] | undefined} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseInput} />
        </div>
      );
  }
}

/* ================================================================== */
/*  Vitals Field                                                       */
/* ================================================================== */

function VitalsField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const vitals = (typeof value === 'object' && value ? value : {}) as Record<string, string>;
  const setVital = (k: string, v: string) => onChange({ ...vitals, [k]: v });

  const VITAL_DEFS = [
    { key: 'hr', label: 'HR', unit: 'bpm', normal: '60-100' },
    { key: 'systolicBp', label: 'SBP', unit: 'mmHg', normal: '90-140' },
    { key: 'diastolicBp', label: 'DBP', unit: 'mmHg', normal: '60-90' },
    { key: 'spo2', label: 'SpO2', unit: '%', normal: '95-100' },
    { key: 'rr', label: 'RR', unit: '/min', normal: '12-20' },
    { key: 'bt', label: 'BT', unit: '\u00B0C', normal: '36.1-37.2' },
  ];

  const isAbnormal = (key: string, val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return false;
    const ranges: Record<string, [number, number]> = {
      hr: [60, 100], systolicBp: [90, 140], diastolicBp: [60, 90],
      spo2: [95, 100], rr: [12, 20], bt: [36.1, 37.2],
    };
    const r = ranges[key];
    return r ? num < r[0] || num > r[1] : false;
  };

  return (
    <div>
      <FieldLabel field={field} />
      <div className="grid grid-cols-3 gap-2">
        {VITAL_DEFS.map(v => {
          const abnormal = isAbnormal(v.key, vitals[v.key] ?? '');
          return (
            <div key={v.key}>
              <label className="text-[10px] text-gray-400 flex items-center gap-1">
                {v.label} ({v.unit})
                {abnormal && <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />}
              </label>
              <input type="number" value={(vitals[v.key] ?? '') as string | number | undefined} onChange={e => setVital(v.key, e.target.value)}
                disabled={disabled} placeholder={v.normal}
                className={`w-full px-2 py-1.5 border rounded-lg text-sm ${abnormal ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200'}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Diagnosis Search (KCD)                                             */
/* ================================================================== */

/** 자주 쓰는 KCD — 서버 검색 실패 시에만 쓰는 오프라인 폴백(정본은 KCD-8 마스터 18,184건). */
const KCD_COMMON: { code: string; name: string }[] = [
    { code: 'J06.9', name: '급성 상기도 감염' }, { code: 'J20.9', name: '급성 기관지염' },
    { code: 'J45.9', name: '천식' }, { code: 'I10', name: '본태성 고혈압' },
    { code: 'E11.9', name: '제2형 당뇨병' }, { code: 'M54.5', name: '요통' },
    { code: 'K29.7', name: '위염' }, { code: 'K21.0', name: '위식도역류질환' },
    { code: 'N39.0', name: '요로감염' }, { code: 'R51', name: '두통' },
    { code: 'J00', name: '급성 비인두염(감기)' }, { code: 'H10.9', name: '결막염' },
    { code: 'L30.9', name: '피부염' }, { code: 'R10.4', name: '복통' },
    { code: 'F41.9', name: '불안장애' }, { code: 'F32.9', name: '우울증' },
    { code: 'G43.9', name: '편두통' }, { code: 'K58.9', name: '과민성장증후군' },
  { code: 'M79.3', name: '지절통' }, { code: 'R05', name: '기침' },
];

/** 서버 응답 봉투(`{data}` / `{data:{data}}`) 를 배열로 편다 — 코드 API 는 둘 다 쓴다. */
function unwrapList<T>(res: unknown): T[] {
  const raw = (res as { data?: unknown } | undefined)?.data;
  if (Array.isArray(raw)) return raw as T[];
  const inner = (raw as { data?: unknown } | undefined)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

function DiagnosisSearchField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const tAttr = useTAttr();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ code: string; name: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [offline, setOffline] = useState(false);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /**
   * 🔴 종전엔 하드코딩 20건(KCD_COMMON)만 뒤져 그 밖의 진단은 "결과 없음"이었다.
   *    운영 KCD-8 마스터는 18,184건 — 정본 `/api/v1/codes/diagnosis` 로 검색하고,
   *    호출 실패 시에만 20건 폴백을 쓰며 그 사실을 화면에 표시한다.
   */
  const runSearch = useCallback(async (q: string) => {
    const seq = ++seqRef.current;
    setSearching(true);
    try {
      const res = await apiClient.get('/api/v1/codes/diagnosis', { q, limit: 20 });
      if (seq !== seqRef.current) return;
      const list = unwrapList<{ code: string; nameKo?: string; name?: string }>(res)
        .map((d) => ({ code: d.code, name: d.nameKo ?? d.name ?? '' }));
      setOffline(false);
      setResults(list);
      setShowDropdown(true);
    } catch {
      if (seq !== seqRef.current) return;
      const lower = q.toLowerCase();
      const matched = KCD_COMMON.filter(k => k.code.toLowerCase().includes(lower) || k.name.includes(lower)).slice(0, 8);
      setOffline(true);
      setResults(matched);
      setShowDropdown(true);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }, []);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 1) { setShowDropdown(false); setResults([]); return; }
    timerRef.current = setTimeout(() => { void runSearch(q.trim()); }, 250);
  }, [runSearch]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const selected = typeof value === 'object' && value ? value as { code: string; name: string } : null;

  return (
    <div>
      <FieldLabel field={field} />
      <div className="relative">
        {selected ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
            <span className="text-xs font-mono font-semibold text-blue-700">{selected.code}</span>
            <span className="text-sm text-gray-800 flex-1">{selected.name}</span>
            {!disabled && (
              <button type="button" onClick={() => { onChange(''); setQuery(''); }}
                className="text-gray-400 hover:text-red-500 text-xs">&#x2715;</button>
            )}
          </div>
        ) : (
          <>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input type="text" value={query} onChange={e => handleSearch(e.target.value)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                placeholder={field.placeholder || tAttr('KCD 코드 또는 진단명 검색...')}
                disabled={disabled}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              />
            </div>
            {showDropdown && (
              <div className="absolute z-20 w-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg max-h-48 overflow-y-auto">
                {offline && (
                  <p className="px-3 py-1.5 text-[10px] text-amber-600 bg-amber-50 border-b border-amber-100">
                    코드 마스터에 연결하지 못해 자주 쓰는 {KCD_COMMON.length}건에서만 찾았습니다
                  </p>
                )}
                {results.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">{searching ? <T k="검색 중..." /> : <T k="검색 결과가 없습니다" />}</p>
                ) : results.map(r => (
                  <button key={r.code} type="button"
                    onClick={() => { onChange({ code: r.code, name: r.name }); setShowDropdown(false); setQuery(''); }}
                    className="w-full px-3 py-2 text-left hover:bg-blue-50 transition-colors last:rounded-b-xl">
                    <span className="text-xs font-mono font-semibold text-blue-600 mr-2">{r.code}</span>
                    <span className="text-sm text-gray-800">{r.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {field.codeSystem && (
          <p className="text-[10px] text-gray-400 mt-1"><T k="코드 체계" />: {field.codeSystem}</p>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Pain Scale (NRS 0-10)                                              */
/* ================================================================== */

const PAIN_FACES = ['\uD83D\uDE0A','\uD83D\uDE42','\uD83D\uDE10','\uD83D\uDE41','\uD83D\uDE23','\uD83D\uDE16','\uD83D\uDE2B','\uD83D\uDE29','\uD83D\uDE2D','\uD83E\uDD2F','\uD83D\uDC80'];
const PAIN_LABELS = ['통증 없음','아주 약간','약간','약간 불편','불편','상당히 아픔','많이 아픔','매우 아픔','극심한 통증','최악의 통증','참을 수 없음'];
const PAIN_COLORS = ['#22c55e','#4ade80','#86efac','#fde047','#facc15','#f59e0b','#f97316','#ef4444','#dc2626','#b91c1c','#7f1d1d'];

function PainScaleField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const score = typeof value === 'number' ? value : (typeof value === 'string' && value !== '' ? parseInt(value) : -1);
  return (
    <div>
      <FieldLabel field={field} />
      <div className="p-3 bg-gray-50 rounded-xl space-y-2">
        <div className="flex gap-0.5">
          {Array.from({ length: 11 }, (_, i) => (
            <button key={i} type="button" disabled={disabled}
              onClick={() => onChange(i)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                score === i ? 'text-white shadow-md scale-110 z-10' : 'text-gray-500 hover:opacity-80'
              }`}
              style={{ backgroundColor: score === i ? PAIN_COLORS[i] : `${PAIN_COLORS[i]}20` }}
              title={PAIN_LABELS[i]}
            >{i}</button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-lg">{score >= 0 ? PAIN_FACES[score] : '\u2753'}</span>
          <span className="text-xs font-medium" style={{ color: score >= 0 ? PAIN_COLORS[score] : '#9ca3af' }}>
            {score >= 0 ? PAIN_LABELS[score] : <T k="점수를 선택하세요" />}
          </span>
          {score >= 0 && (
            <button type="button" onClick={() => onChange('')} disabled={disabled}
              className="text-[10px] text-gray-400 hover:text-gray-600"><T k="초기화" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Score Calculator — 6종 (GCS, NEWS, MORSE, BRADEN, SOFA, APACHE_II, GAF)  */
/* ================================================================== */

const SCORE_DEFINITIONS: Record<string, { name: string; range: string; categories: { label: string; options: { text: string; score: number }[] }[] }> = {
  GCS: {
    name: 'Glasgow Coma Scale',
    range: '3-15',
    categories: [
      { label: '개안 반응 (E)', options: [
        { text: '자발적 개안', score: 4 }, { text: '음성에 개안', score: 3 },
        { text: '통증에 개안', score: 2 }, { text: '개안 없음', score: 1 }
      ]},
      { label: '언어 반응 (V)', options: [
        { text: '지남력 정상', score: 5 }, { text: '혼돈 대화', score: 4 },
        { text: '부적절 단어', score: 3 }, { text: '이해불가 소리', score: 2 },
        { text: '언어반응 없음', score: 1 }
      ]},
      { label: '운동 반응 (M)', options: [
        { text: '명령에 따름', score: 6 }, { text: '통증 부위 인지', score: 5 },
        { text: '도피 반응', score: 4 }, { text: '비정상 굴곡', score: 3 },
        { text: '신전 반응', score: 2 }, { text: '운동반응 없음', score: 1 }
      ]}
    ]
  },
  NEWS: {
    name: 'National Early Warning Score',
    range: '0-20',
    categories: [
      { label: '호흡수', options: [
        { text: '\u22648 또는 \u226525', score: 3 }, { text: '9-11', score: 1 },
        { text: '12-20', score: 0 }, { text: '21-24', score: 2 }
      ]},
      { label: 'SpO2 (%)', options: [
        { text: '\u226491', score: 3 }, { text: '92-93', score: 2 },
        { text: '94-95', score: 1 }, { text: '\u226596', score: 0 }
      ]},
      { label: '수축기 혈압', options: [
        { text: '\u226490', score: 3 }, { text: '91-100', score: 2 },
        { text: '101-110', score: 1 }, { text: '111-219', score: 0 },
        { text: '\u2265220', score: 3 }
      ]},
      { label: '맥박', options: [
        { text: '\u226440', score: 3 }, { text: '41-50', score: 1 },
        { text: '51-90', score: 0 }, { text: '91-110', score: 1 },
        { text: '111-130', score: 2 }, { text: '\u2265131', score: 3 }
      ]},
      { label: '의식수준', options: [
        { text: '명료 (Alert)', score: 0 }, { text: 'CVPU', score: 3 }
      ]},
      { label: '체온', options: [
        { text: '\u226435.0', score: 3 }, { text: '35.1-36.0', score: 1 },
        { text: '36.1-38.0', score: 0 }, { text: '38.1-39.0', score: 1 },
        { text: '\u226539.1', score: 2 }
      ]}
    ]
  },
  MORSE: {
    name: 'Morse Fall Scale',
    range: '0-125',
    categories: [
      { label: '낙상 병력', options: [{ text: '없음', score: 0 }, { text: '있음', score: 25 }] },
      { label: '이차 진단', options: [{ text: '없음', score: 0 }, { text: '있음', score: 15 }] },
      { label: '보행 보조기구', options: [
        { text: '없음/침상안정/간호사보조', score: 0 },
        { text: '목발/지팡이/보행기', score: 15 },
        { text: '가구 잡고 이동', score: 30 }
      ]},
      { label: 'IV 라인/헤파린 락', options: [{ text: '없음', score: 0 }, { text: '있음', score: 20 }] },
      { label: '보행/이동', options: [
        { text: '정상/침상안정/부동', score: 0 },
        { text: '허약', score: 10 }, { text: '장애', score: 20 }
      ]},
      { label: '정신상태', options: [
        { text: '자신의 제한 인지', score: 0 },
        { text: '자신의 제한 과대평가/망각', score: 15 }
      ]}
    ]
  },
  BRADEN_SCALE: {
    name: 'Braden Scale (욕창 위험)',
    range: '6-23',
    categories: [
      { label: '감각 인지', options: [
        { text: '완전 제한', score: 1 }, { text: '매우 제한', score: 2 },
        { text: '약간 제한', score: 3 }, { text: '제한 없음', score: 4 }
      ]},
      { label: '습기', options: [
        { text: '항상 습함', score: 1 }, { text: '매우 습함', score: 2 },
        { text: '가끔 습함', score: 3 }, { text: '거의 건조', score: 4 }
      ]},
      { label: '활동 정도', options: [
        { text: '침상 안정', score: 1 }, { text: '의자에 앉음', score: 2 },
        { text: '가끔 보행', score: 3 }, { text: '자주 보행', score: 4 }
      ]},
      { label: '이동 능력', options: [
        { text: '완전 부동', score: 1 }, { text: '매우 제한', score: 2 },
        { text: '약간 제한', score: 3 }, { text: '제한 없음', score: 4 }
      ]},
      { label: '영양', options: [
        { text: '매우 불량', score: 1 }, { text: '부적절', score: 2 },
        { text: '적절', score: 3 }, { text: '우수', score: 4 }
      ]},
      { label: '마찰/전단력', options: [
        { text: '문제 있음', score: 1 }, { text: '잠재적 문제', score: 2 },
        { text: '문제 없음', score: 3 }
      ]}
    ]
  },
  SOFA: {
    name: 'SOFA Score (장기부전)',
    range: '0-24',
    categories: [
      { label: '호흡 (PaO2/FiO2)', options: [
        { text: '\u2265400', score: 0 }, { text: '<400', score: 1 },
        { text: '<300', score: 2 }, { text: '<200 + 기계환기', score: 3 },
        { text: '<100 + 기계환기', score: 4 }
      ]},
      { label: '응고 (혈소판 \u00D710\u00B3)', options: [
        { text: '\u2265150', score: 0 }, { text: '<150', score: 1 },
        { text: '<100', score: 2 }, { text: '<50', score: 3 },
        { text: '<20', score: 4 }
      ]},
      { label: '간 (빌리루빈 mg/dL)', options: [
        { text: '<1.2', score: 0 }, { text: '1.2-1.9', score: 1 },
        { text: '2.0-5.9', score: 2 }, { text: '6.0-11.9', score: 3 },
        { text: '>12.0', score: 4 }
      ]},
      { label: '심혈관', options: [
        { text: 'MAP \u226570', score: 0 }, { text: 'MAP <70', score: 1 },
        { text: 'Dopa \u22645', score: 2 }, { text: 'Dopa >5 / Epi \u22640.1', score: 3 },
        { text: 'Dopa >15 / Epi >0.1', score: 4 }
      ]},
      { label: '중추신경 (GCS)', options: [
        { text: '15', score: 0 }, { text: '13-14', score: 1 },
        { text: '10-12', score: 2 }, { text: '6-9', score: 3 },
        { text: '<6', score: 4 }
      ]},
      { label: '신장 (Cr mg/dL)', options: [
        { text: '<1.2', score: 0 }, { text: '1.2-1.9', score: 1 },
        { text: '2.0-3.4', score: 2 }, { text: '3.5-4.9', score: 3 },
        { text: '>5.0', score: 4 }
      ]}
    ]
  },
  APACHE_II: {
    name: 'APACHE II (간이)',
    range: '0-71',
    categories: [
      { label: '체온 (\u00B0C)', options: [
        { text: '36-38.4', score: 0 }, { text: '38.5-38.9 / 34-35.9', score: 1 },
        { text: '39-40.9 / 32-33.9', score: 3 }, { text: '\u226541 / \u226429.9', score: 4 }
      ]},
      { label: '평균동맥압 (mmHg)', options: [
        { text: '70-109', score: 0 }, { text: '110-129 / 50-69', score: 2 },
        { text: '130-159 / -', score: 3 }, { text: '\u2265160 / \u226449', score: 4 }
      ]},
      { label: '심박수', options: [
        { text: '70-109', score: 0 }, { text: '110-139 / 55-69', score: 2 },
        { text: '140-179 / 40-54', score: 3 }, { text: '\u2265180 / \u226439', score: 4 }
      ]},
      { label: '호흡수', options: [
        { text: '12-24', score: 0 }, { text: '25-34 / 10-11', score: 1 },
        { text: '35-49 / 6-9', score: 3 }, { text: '\u226550 / \u22645', score: 4 }
      ]},
      { label: 'PaO2 / FiO2', options: [
        { text: '>70 / \u2265200', score: 0 }, { text: '61-70', score: 1 },
        { text: '55-60', score: 3 }, { text: '<55', score: 4 }
      ]},
      { label: '동맥혈 pH', options: [
        { text: '7.33-7.49', score: 0 }, { text: '7.50-7.59 / 7.25-7.32', score: 1 },
        { text: '7.60-7.69 / 7.15-7.24', score: 3 }, { text: '\u22657.70 / <7.15', score: 4 }
      ]},
      { label: 'Na (mEq/L)', options: [
        { text: '130-149', score: 0 }, { text: '150-154 / 120-129', score: 2 },
        { text: '155-159 / 111-119', score: 3 }, { text: '\u2265160 / \u2264110', score: 4 }
      ]},
      { label: 'K (mEq/L)', options: [
        { text: '3.5-5.4', score: 0 }, { text: '5.5-5.9 / 3.0-3.4', score: 1 },
        { text: '6.0-6.9 / 2.5-2.9', score: 3 }, { text: '\u22657.0 / <2.5', score: 4 }
      ]},
      { label: 'Cr (mg/dL)', options: [
        { text: '0.6-1.4', score: 0 }, { text: '1.5-1.9 / <0.6', score: 2 },
        { text: '2.0-3.4', score: 3 }, { text: '\u22653.5', score: 4 }
      ]},
      { label: 'Hct (%)', options: [
        { text: '30-45.9', score: 0 }, { text: '46-49.9 / 20-29.9', score: 2 },
        { text: '50-59.9', score: 3 }, { text: '\u226560 / <20', score: 4 }
      ]},
      { label: 'WBC (\u00D71000)', options: [
        { text: '3-14.9', score: 0 }, { text: '15-19.9 / 1-2.9', score: 2 },
        { text: '20-39.9', score: 3 }, { text: '\u226540 / <1', score: 4 }
      ]},
      { label: '나이', options: [
        { text: '\u226444세', score: 0 }, { text: '45-54', score: 2 },
        { text: '55-64', score: 3 }, { text: '65-74', score: 5 }, { text: '\u226575', score: 6 }
      ]},
    ]
  },
};

const RISK_COLOR = { HIGH: '#dc2626', MODERATE: '#f59e0b', LOW: '#22c55e' } as const;

function getScoreLevel(key: string, total: number): { label: string; color: string } {
  if (key === 'GCS') return total <= 8 ? { label: '중증', color: '#dc2626' } : total <= 12 ? { label: '중등도', color: '#f59e0b' } : { label: '경증', color: '#22c55e' };
  if (key === 'NEWS') return total >= 7 ? { label: '고위험', color: '#dc2626' } : total >= 5 ? { label: '중위험', color: '#f59e0b' } : { label: '저위험', color: '#22c55e' };
  // 🔴 (2026-10-26) Morse·Braden 등급은 shared 정본 — 종전 이 표만 Braden 15~18 '경위험'·19+ '정상' 4단계로 서버 재평가·이력·워크스테이션(3단계)과 갈라져 있었다
  if (key === 'MORSE' || key === 'BRADEN_SCALE') {
    const lv = key === 'MORSE' ? morseRiskLevel(total) : bradenRiskLevel(total);
    if (!lv) return { label: '', color: '#6b7280' }; // 범위 밖·미완성 합계는 등급을 지어내지 않는다
    return { label: (key === 'MORSE' ? MORSE_RISK_LABEL : BRADEN_RISK_LABEL)[lv], color: RISK_COLOR[lv] };
  }
  if (key === 'SOFA') return total >= 12 ? { label: '사망위험\u2191', color: '#dc2626' } : total >= 6 ? { label: '중증', color: '#f59e0b' } : { label: '경증', color: '#22c55e' };
  if (key === 'APACHE_II') return total >= 25 ? { label: '사망률>50%', color: '#dc2626' } : total >= 15 ? { label: '사망률25%', color: '#f59e0b' } : total >= 10 ? { label: '중등도', color: '#eab308' } : { label: '경증', color: '#22c55e' };
  if (key === 'GAF') return total <= 30 ? { label: '중증 장애', color: '#dc2626' } : total <= 50 ? { label: '심각한 증상', color: '#f59e0b' } : total <= 70 ? { label: '경미한 증상', color: '#eab308' } : { label: '양호', color: '#22c55e' };
  return { label: '', color: '#6b7280' };
}

function ScoreCalculatorField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const calcKey = field.calculator ?? 'GCS';
  const scoreDef = SCORE_DEFINITIONS[calcKey];
  interface ScoreData { selections?: Record<number, number>; total?: number }
  const data = (typeof value === 'object' && value ? value : { selections: {}, total: 0 }) as ScoreData;

  // GAF: special slider-based calculator (0-100)
  if (calcKey === 'GAF') {
    const gafScore = typeof data.total === 'number' ? data.total : 50;
    const gafLevel = getScoreLevel('GAF', gafScore);

    const GAF_RANGES = [
      { min: 91, max: 100, desc: '넓은 범위의 활동에서 뛰어난 기능, 문제가 있어도 통제 가능' },
      { min: 81, max: 90, desc: '최소한의 증상, 모든 영역에서 양호한 기능' },
      { min: 71, max: 80, desc: '일시적 증상, 심리사회적 스트레스에 대한 예상 가능한 반응' },
      { min: 61, max: 70, desc: '경미한 증상 또는 사회/직업/학교 기능의 약간의 어려움' },
      { min: 51, max: 60, desc: '중등도 증상 또는 사회/직업 기능의 중등도 어려움' },
      { min: 41, max: 50, desc: '심각한 증상 또는 사회/직업/학교 기능의 심각한 장애' },
      { min: 31, max: 40, desc: '현실검증/의사소통의 일부 장애 또는 여러 영역의 주요 장해' },
      { min: 21, max: 30, desc: '심각한 망상/환각, 거의 모든 영역에서 기능 불가' },
      { min: 11, max: 20, desc: '자해/타해 위험, 최소한의 개인위생 유지 불가' },
      { min: 1, max: 10, desc: '자해의 지속적 위험 또는 최소한의 위생 유지 불가' },
    ];

    const currentRange = GAF_RANGES.find(r => gafScore >= r.min && gafScore <= r.max) ?? GAF_RANGES[GAF_RANGES.length - 1];

    return (
      <div>
        <FieldLabel field={field} />
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-700">GAF (Global Assessment of Functioning)</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold" style={{ color: gafLevel.color }}>{gafScore}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: gafLevel.color }}>{gafLevel.label}</span>
            </div>
          </div>
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-4">0</span>
              <input type="range" min={0} max={100} value={gafScore}
                onChange={e => onChange({ selections: {}, total: Number(e.target.value) })}
                disabled={disabled}
                className="flex-1 h-3 rounded-lg appearance-none cursor-pointer accent-blue-600"
                style={{
                  background: `linear-gradient(to right, #dc2626 0%, #f59e0b 30%, #eab308 50%, #22c55e 70%, #22c55e 100%)`
                }}
              />
              <span className="text-xs text-gray-400 w-6">100</span>
            </div>
            <div className="bg-blue-50 rounded-lg p-2">
              <p className="text-xs text-blue-800">
                <span className="font-semibold">{currentRange.min}-{currentRange.max}:</span> {currentRange.desc}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fallback for undefined calculators
  if (!scoreDef) {
    return (
      <div>
        <FieldLabel field={field} />
        <div className="p-3 bg-gray-50 rounded-xl flex items-center gap-3">
          <input type="number" value={data.total || ''} onChange={e => onChange({ ...data, total: parseInt(e.target.value) || 0 })} disabled={disabled} className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center" />
          <span className="text-xs text-gray-500">{calcKey} 점수</span>
        </div>
      </div>
    );
  }

  const handleSelect = (catIdx: number, optScore: number) => {
    const sel = { ...(data.selections || {}) } as Record<number, number>;
    sel[catIdx] = optScore;
    const total = Object.values(sel).reduce((a: number, b) => a + (b as number), 0);
    onChange({ selections: sel, total });
  };

  const level = getScoreLevel(calcKey, data.total || 0);

  return (
    <div>
      <FieldLabel field={field} />
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
          <div>
            <span className="text-xs font-semibold text-gray-700">{scoreDef.name}</span>
            <span className="text-[10px] text-gray-400 ml-1.5">({scoreDef.range})</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold" style={{ color: level.color }}>{data.total || 0}</span>
            {level.label && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: level.color }}>{level.label}</span>}
          </div>
        </div>
        <div className="p-2 space-y-2 max-h-72 overflow-y-auto">
          {scoreDef.categories.map((cat, ci) => (
            <div key={ci}>
              <p className="text-[10px] font-semibold text-gray-500 mb-1">{cat.label}</p>
              <div className="flex flex-wrap gap-1">
                {cat.options.map((opt, oi) => {
                  const selected = data.selections?.[ci] === opt.score;
                  return (
                    <button key={oi} type="button" disabled={disabled}
                      onClick={() => handleSelect(ci, opt.score)}
                      className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${
                        selected ? 'bg-blue-50 border-blue-400 text-blue-700 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-blue-200'
                      }`}
                    >{opt.text} ({opt.score})</button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Body Diagram (SVG)                                                 */
/* ================================================================== */

const BODY_REGIONS = [
  { id: 'head', label: '머리', x: 50, y: 8, r: 7 },
  { id: 'neck', label: '목', x: 50, y: 18, r: 4 },
  { id: 'chest', label: '흉부', x: 50, y: 28, r: 10 },
  { id: 'abdomen', label: '복부', x: 50, y: 42, r: 9 },
  { id: 'l-shoulder', label: '좌 어깨', x: 28, y: 22, r: 5 },
  { id: 'r-shoulder', label: '우 어깨', x: 72, y: 22, r: 5 },
  { id: 'l-arm', label: '좌 상완', x: 22, y: 32, r: 5 },
  { id: 'r-arm', label: '우 상완', x: 78, y: 32, r: 5 },
  { id: 'l-forearm', label: '좌 전완', x: 18, y: 42, r: 5 },
  { id: 'r-forearm', label: '우 전완', x: 82, y: 42, r: 5 },
  { id: 'l-hand', label: '좌 손', x: 14, y: 52, r: 4 },
  { id: 'r-hand', label: '우 손', x: 86, y: 52, r: 4 },
  { id: 'pelvis', label: '골반', x: 50, y: 54, r: 8 },
  { id: 'l-thigh', label: '좌 대퇴', x: 40, y: 65, r: 6 },
  { id: 'r-thigh', label: '우 대퇴', x: 60, y: 65, r: 6 },
  { id: 'l-knee', label: '좌 무릎', x: 40, y: 75, r: 4 },
  { id: 'r-knee', label: '우 무릎', x: 60, y: 75, r: 4 },
  { id: 'l-leg', label: '좌 하퇴', x: 40, y: 84, r: 5 },
  { id: 'r-leg', label: '우 하퇴', x: 60, y: 84, r: 5 },
  { id: 'l-foot', label: '좌 발', x: 38, y: 94, r: 4 },
  { id: 'r-foot', label: '우 발', x: 62, y: 94, r: 4 },
];

function BodyDiagramField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const tAttr = useTAttr();
  const marks: Record<string, string> = (typeof value === 'object' && value && !Array.isArray(value) ? value : {}) as Record<string, string>;

  const toggleRegion = (regionId: string) => {
    if (disabled) return;
    const next = { ...marks };
    if (next[regionId]) {
      delete next[regionId];
    } else {
      next[regionId] = '통증';
    }
    onChange(Object.keys(next).length > 0 ? next : '');
  };

  const updateNote = (regionId: string, note: string) => {
    onChange({ ...marks, [regionId]: note });
  };

  const markedRegions = Object.keys(marks);

  return (
    <div>
      <FieldLabel field={field} />
      <div className="flex gap-3">
        {/* SVG Body */}
        <div className="flex-shrink-0 w-40 bg-gray-50 rounded-xl p-2">
          <svg viewBox="0 0 100 100" className="w-full">
            {/* Body outline */}
            <ellipse cx="50" cy="8" rx="7" ry="8" fill="none" stroke="#d1d5db" strokeWidth="0.8" />
            <line x1="50" y1="16" x2="50" y2="52" stroke="#d1d5db" strokeWidth="0.8" />
            <line x1="28" y1="22" x2="14" y2="52" stroke="#d1d5db" strokeWidth="0.8" />
            <line x1="72" y1="22" x2="86" y2="52" stroke="#d1d5db" strokeWidth="0.8" />
            <line x1="42" y1="52" x2="38" y2="96" stroke="#d1d5db" strokeWidth="0.8" />
            <line x1="58" y1="52" x2="62" y2="96" stroke="#d1d5db" strokeWidth="0.8" />
            {/* Clickable regions */}
            {BODY_REGIONS.map(region => {
              const isMarked = !!marks[region.id];
              return (
                <circle key={region.id} cx={region.x} cy={region.y} r={region.r}
                  fill={isMarked ? '#ef444440' : 'transparent'}
                  stroke={isMarked ? '#ef4444' : 'transparent'}
                  strokeWidth="0.8"
                  className={`cursor-pointer transition-all ${!disabled ? 'hover:fill-blue-100 hover:stroke-blue-400' : ''}`}
                  onClick={() => toggleRegion(region.id)}
                >
                  <title>{region.label}</title>
                </circle>
              );
            })}
            {/* Marked dots */}
            {BODY_REGIONS.filter(r => marks[r.id]).map(r => (
              <circle key={`dot-${r.id}`} cx={r.x} cy={r.y} r="2" fill="#ef4444" />
            ))}
          </svg>
          <p className="text-[9px] text-gray-400 text-center mt-1"><T k="부위를 클릭하세요" /></p>
        </div>
        {/* Marked list */}
        <div className="flex-1 min-w-0">
          {markedRegions.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-400">
              <T k="마킹된 부위가 없습니다" />
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {markedRegions.map(rid => {
                const region = BODY_REGIONS.find(r => r.id === rid);
                return (
                  <div key={rid} className="flex items-center gap-1.5 p-1.5 bg-red-50 rounded-lg">
                    <span className="text-red-500 text-xs">\u25CF</span>
                    <span className="text-xs font-medium text-gray-700 w-14 flex-shrink-0">{region?.label}</span>
                    <input type="text" value={marks[rid] || ''} onChange={e => updateNote(rid, e.target.value)}
                      disabled={disabled} placeholder={tAttr('메모...')}
                      className="flex-1 px-2 py-0.5 text-xs border border-red-200 rounded bg-white min-w-0" />
                    {!disabled && (
                      <button type="button" onClick={() => toggleRegion(rid)}
                        className="text-gray-400 hover:text-red-500 text-xs flex-shrink-0">\u2715</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Growth Chart (WHO percentile)                                      */
/* ================================================================== */

const WHO_DATA = {
  male: {
    height: {
      months: [0,3,6,9,12,18,24,36,48,60],
      p3:  [46.1,57.3,63.3,67.5,71.0,77.1,82.5,91.2,98.9,105.3],
      p15: [47.9,59.4,65.5,69.7,73.4,79.6,85.1,93.9,101.6,108.2],
      p50: [49.9,61.4,67.6,72.0,75.7,82.3,87.8,96.1,103.3,110.0],
      p85: [51.8,63.5,69.8,74.2,78.1,84.9,90.5,98.9,106.7,113.6],
      p97: [53.7,65.5,71.9,76.5,80.5,87.5,93.1,101.7,109.9,117.0],
    },
    weight: {
      months: [0,3,6,9,12,18,24,36,48,60],
      p3:  [2.5,4.7,6.1,7.1,7.7,8.8,9.7,11.3,12.7,14.1],
      p15: [2.9,5.2,6.7,7.8,8.5,9.7,10.8,12.7,14.3,16.0],
      p50: [3.3,6.0,7.5,8.6,9.6,10.9,12.2,14.3,16.3,18.3],
      p85: [3.9,6.7,8.3,9.6,10.8,12.2,13.6,16.2,18.6,21.0],
      p97: [4.4,7.4,9.2,10.5,11.8,13.5,15.0,18.1,20.9,23.7],
    }
  },
  female: {
    height: {
      months: [0,3,6,9,12,18,24,36,48,60],
      p3:  [45.4,55.6,61.2,65.3,68.9,74.0,80.0,87.4,94.1,99.9],
      p15: [47.0,57.7,63.5,67.7,71.4,76.9,82.5,90.5,97.5,103.4],
      p50: [49.1,59.8,65.7,70.1,74.0,80.0,85.7,95.1,101.5,107.8],
      p85: [51.0,62.0,68.0,72.6,76.7,83.0,88.9,98.1,105.6,112.1],
      p97: [52.9,64.0,70.3,75.0,79.2,85.9,92.0,101.5,109.4,116.4],
    },
    weight: {
      months: [0,3,6,9,12,18,24,36,48,60],
      p3:  [2.4,4.2,5.5,6.4,7.0,8.0,9.0,10.6,12.0,13.5],
      p15: [2.8,4.7,6.1,7.1,7.8,9.0,10.2,11.9,13.5,15.3],
      p50: [3.2,5.4,7.0,8.0,8.9,10.2,11.5,13.9,15.9,17.9],
      p85: [3.7,6.2,7.8,9.0,10.0,11.6,13.0,16.0,18.5,21.0],
      p97: [4.2,6.9,8.7,10.0,11.0,12.9,14.5,17.8,20.9,23.5],
    }
  }
};

function GrowthChartField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  interface GrowthData { gender?: string; metric?: string; ageMonths?: string; measurement?: string }
  const data = (typeof value === 'object' && value && !Array.isArray(value) ? value : { gender: 'male', metric: 'height', ageMonths: '', measurement: '' }) as GrowthData;

  const update = (patch: Record<string, unknown>) => onChange({ ...data, ...patch });

  const gender: 'male' | 'female' = data.gender === 'female' ? 'female' : 'male';
  const metric: 'height' | 'weight' = data.metric === 'weight' ? 'weight' : 'height';
  const whoMetric = WHO_DATA[gender][metric];
  const unit = metric === 'height' ? 'cm' : 'kg';

  const ageM = parseFloat(data.ageMonths ?? '');
  const mVal = parseFloat(data.measurement ?? '');
  let percentileText = '';
  if (!isNaN(ageM) && !isNaN(mVal) && ageM >= 0 && ageM <= 60) {
    const idx = whoMetric.months.findIndex(m => m >= ageM);
    const getInterp = (arr: number[]) => {
      if (idx === 0) return arr[0];
      const prev = idx - 1;
      const ratio = (ageM - whoMetric.months[prev]) / (whoMetric.months[idx] - whoMetric.months[prev]);
      return arr[prev] + ratio * (arr[idx] - arr[prev]);
    };
    const p3 = getInterp(whoMetric.p3), p15 = getInterp(whoMetric.p15);
    const p50 = getInterp(whoMetric.p50), p85 = getInterp(whoMetric.p85);

    if (mVal < p3) percentileText = '< 3rd 백분위 (저신장/저체중)';
    else if (mVal < p15) percentileText = '3-15th 백분위';
    else if (mVal < p50) percentileText = '15-50th 백분위';
    else if (mVal < p85) percentileText = '50-85th 백분위 (정상)';
    else percentileText = '> 85th 백분위';
  }

  const chartW = 280, chartH = 160, padL = 35, padB = 20, padT = 10, padR = 10;
  const drawW = chartW - padL - padR, drawH = chartH - padT - padB;
  const xMin = 0, xMax = 60;
  const yMin = metric === 'height' ? 40 : 0;
  const yMax = metric === 'height' ? 120 : 25;
  const toX = (m: number) => padL + (m - xMin) / (xMax - xMin) * drawW;
  const toY = (v: number) => padT + drawH - (v - yMin) / (yMax - yMin) * drawH;

  const makePath = (arr: number[]) =>
    whoMetric.months.map((m, i) => `${i === 0 ? 'M' : 'L'}${toX(m).toFixed(1)},${toY(arr[i]).toFixed(1)}`).join(' ');

  return (
    <div>
      <FieldLabel field={field} />
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-gray-200 text-[11px]">
            <button type="button" onClick={() => update({ gender: 'male' })} disabled={disabled}
              className={`px-2 py-1 ${gender === 'male' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600'}`}><T k="남아" /></button>
            <button type="button" onClick={() => update({ gender: 'female' })} disabled={disabled}
              className={`px-2 py-1 ${gender === 'female' ? 'bg-pink-500 text-white' : 'bg-white text-gray-600'}`}><T k="여아" /></button>
          </div>
          <div className="flex rounded-lg overflow-hidden border border-gray-200 text-[11px]">
            <button type="button" onClick={() => update({ metric: 'height' })} disabled={disabled}
              className={`px-2 py-1 ${metric === 'height' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-600'}`}><T k="신장" /></button>
            <button type="button" onClick={() => update({ metric: 'weight' })} disabled={disabled}
              className={`px-2 py-1 ${metric === 'weight' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-600'}`}><T k="체중" /></button>
          </div>
          <div className="flex items-center gap-1 ml-auto text-[11px]">
            <input type="number" value={data.ageMonths ?? ''} onChange={e => update({ ageMonths: e.target.value })}
              disabled={disabled} placeholder="개월" className="w-14 px-1.5 py-1 border border-gray-200 rounded text-center text-xs" />
            <span className="text-gray-400">개월</span>
            <input type="number" value={data.measurement ?? ''} onChange={e => update({ measurement: e.target.value })}
              disabled={disabled} placeholder={unit} className="w-16 px-1.5 py-1 border border-gray-200 rounded text-center text-xs" />
            <span className="text-gray-400">{unit}</span>
          </div>
        </div>
        <div className="p-2">
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" style={{ maxHeight: 200 }}>
            {[0, 12, 24, 36, 48, 60].map(m => (
              <g key={m}>
                <line x1={toX(m)} y1={padT} x2={toX(m)} y2={chartH - padB} stroke="#f3f4f6" strokeWidth="0.5" />
                <text x={toX(m)} y={chartH - 4} textAnchor="middle" className="text-[8px] fill-gray-400">{m}m</text>
              </g>
            ))}
            {Array.from({ length: 5 }, (_, i) => yMin + (yMax - yMin) * i / 4).map(v => (
              <g key={v}>
                <line x1={padL} y1={toY(v)} x2={chartW - padR} y2={toY(v)} stroke="#f3f4f6" strokeWidth="0.5" />
                <text x={padL - 3} y={toY(v) + 3} textAnchor="end" className="text-[7px] fill-gray-400">{v.toFixed(0)}</text>
              </g>
            ))}
            {[
              { data: whoMetric.p97, label: '97th', opacity: 0.2 },
              { data: whoMetric.p85, label: '85th', opacity: 0.3 },
              { data: whoMetric.p50, label: '50th', opacity: 0.6 },
              { data: whoMetric.p15, label: '15th', opacity: 0.3 },
              { data: whoMetric.p3, label: '3rd', opacity: 0.2 },
            ].map(curve => (
              <path key={curve.label} d={makePath(curve.data)} fill="none"
                stroke={gender === 'male' ? '#3b82f6' : '#ec4899'}
                strokeWidth={curve.label === '50th' ? 1.5 : 0.8}
                opacity={curve.opacity} />
            ))}
            {[
              { data: whoMetric.p97, label: '97' },
              { data: whoMetric.p50, label: '50' },
              { data: whoMetric.p3, label: '3' },
            ].map(c => (
              <text key={c.label} x={chartW - padR + 2} y={toY(c.data[c.data.length - 1]) + 3}
                className="text-[7px] fill-gray-400">{c.label}</text>
            ))}
            {!isNaN(ageM) && !isNaN(mVal) && ageM >= 0 && ageM <= 60 && (
              <>
                <circle cx={toX(ageM)} cy={toY(mVal)} r="4" fill="#ef4444" stroke="white" strokeWidth="1.5" />
                <text x={toX(ageM) + 6} y={toY(mVal) + 3} className="text-[8px] fill-red-600 font-semibold">
                  {mVal}{unit}
                </text>
              </>
            )}
          </svg>
        </div>
        {percentileText && (
          <div className="px-3 py-2 bg-green-50 border-t border-gray-100">
            <p className="text-xs text-green-700">
              <span className="font-semibold">결과:</span> {data.ageMonths}<Unit>개월</Unit>, {data.measurement}{unit} &rarr; {percentileText}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Lab Reference (최근 검사 결과)                                      */
/* ================================================================== */

/**
 * 최근 검사 결과 참조.
 * 🔴 종전엔 CBC/Chemistry 8항목을 값 '-' 로 **고정 표에 그려놓고** "진료 화면 연동 시 자동 표시"
 *    라고 적었다 — 실제 연동은 없고, 표는 이 환자의 검사가 아니다(P15 임상 표 날조).
 *    이 필드는 자유 메모만 저장하므로 그렇게만 말한다.
 */
function LabReferenceField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const tAttr = useTAttr();
  const data = (typeof value === 'object' && value && !Array.isArray(value) ? value : { note: '' }) as { note?: string };

  return (
    <div>
      <FieldLabel field={field} />
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5" />
          </svg>
          <span className="text-xs font-semibold text-blue-700"><T k="검사 결과 메모" /></span>
        </div>
        <div className="px-3 py-2">
          <p className="text-[10px] text-gray-400 mb-1.5">
            이 칸은 <strong>메모만</strong> 저장합니다 — 환자의 실제 검사 수치는 진료 화면의 &lsquo;검사 결과&rsquo; 패널에서 확인하세요.
          </p>
          <input type="text" value={(data.note || '') as string} onChange={e => onChange({ ...data, note: e.target.value })}
            placeholder={tAttr('검사 결과 메모...')} disabled={disabled}
            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Code Search (약품·처치 마스터)                                      */
/* ================================================================== */

interface CodeHit { id?: string; code: string; nameKo?: string; name?: string; ingredient?: string | null }

/**
 * 🔴 E7 — 종전 '약물 검색'·'처치 검색' 은 평문 input 에 "코드 검색은 **진료 화면에서 작동합니다**"
 *    라는 안내를 달아뒀다. 그런데 이 컴포넌트가 바로 그 진료 화면이다(코드 바인딩이 아예 없었다).
 *    정본 코드 마스터(/api/v1/codes/{medication|procedure})로 실제 검색해 코드까지 저장한다.
 */
function CodeSearchField({ field, value, onChange, disabled, kind }: {
  field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean; kind: 'medication' | 'procedure';
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const selected = (typeof value === 'object' && value && !Array.isArray(value) ? value : null) as { code?: string; name?: string } | null;
  const freeText = typeof value === 'string' ? value : '';

  const runSearch = useCallback(async (q: string) => {
    const seq = ++seqRef.current;
    setSearching(true);
    try {
      const res = await apiClient.get(`/api/v1/codes/${kind}`, { q, limit: 20 });
      if (seq !== seqRef.current) return;
      setFailed(false);
      setResults(unwrapList<CodeHit>(res));
      setOpen(true);
    } catch {
      if (seq !== seqRef.current) return;
      setFailed(true);
      setResults([]);
      setOpen(true);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }, [kind]);

  const onType = (q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 1) { setOpen(false); setResults([]); return; }
    timerRef.current = setTimeout(() => { void runSearch(q.trim()); }, 250);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (selected?.code) {
    return (
      <div>
        <FieldLabel field={field} />
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
          <span className="text-xs font-mono font-semibold text-emerald-700">{selected.code}</span>
          <span className="text-sm text-gray-800 flex-1">{selected.name}</span>
          {!disabled && (
            <button type="button" onClick={() => { onChange(''); setQuery(''); }} className="text-gray-400 hover:text-red-500 text-xs">&#x2715;</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <FieldLabel field={field} />
      <div className="relative">
        <input type="text" value={query || freeText} onChange={e => onType(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder={field.placeholder || `${kind === 'medication' ? '약품명·성분·코드' : '처치·수가명·코드'} 검색...`}
          disabled={disabled}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50" />
        {open && (
          <div className="absolute z-20 w-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg max-h-56 overflow-y-auto">
            {failed ? (
              <p className="px-3 py-2 text-xs text-amber-600"><T k="코드 마스터에 연결하지 못했습니다 — 잠시 후 다시 시도하세요" /></p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">{searching ? <T k="검색 중..." /> : <T k="검색 결과가 없습니다" />}</p>
            ) : results.map((r, i) => (
              <button key={`${r.code}-${i}`} type="button"
                onClick={() => { onChange({ code: r.code, name: r.nameKo ?? r.name ?? '' }); setOpen(false); setQuery(''); }}
                className="w-full px-3 py-2 text-left hover:bg-blue-50 transition-colors last:rounded-b-xl">
                <span className="text-xs font-mono font-semibold text-blue-600 mr-2">{r.code}</span>
                <span className="text-sm text-gray-800">{r.nameKo ?? r.name}</span>
                {r.ingredient && <span className="ml-1 text-[10px] text-gray-400">({r.ingredient})</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        선택한 코드는 진료기록에 <strong>기록</strong>됩니다 — 실제 처방·오더는 생성되지 않습니다(처방 패널에서 입력).
      </p>
    </div>
  );
}

/** 이 렌더러에 구현이 없는 필드 — 있는 척하지 않는다(P16). */
function UnavailableField({ field, what, where }: { field: FieldDef; what: string; where: string }) {
  return (
    <div>
      <FieldLabel field={field} />
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5">
        <p className="text-xs font-medium text-gray-600">{what}은(는) 차트 템플릿에서 제공되지 않습니다</p>
        <p className="text-[10px] text-gray-400 mt-0.5">이 칸은 입력·저장되지 않습니다 — {where}.</p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Prescription Field (간이 처방)                                      */
/* ================================================================== */

function PrescriptionField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const tAttr = useTAttr();
  interface PrescriptionData { items?: { name: string; dosage: string; frequency: string; duration: string }[] }
  const data = (typeof value === 'object' && value && !Array.isArray(value) ? value : { items: [] }) as PrescriptionData;

  // 🔴 E6 — 종전엔 렌더 입력칸이 없는 `duration: '5일'` 을 상수로 심어, 화면에 없는 투여기간이
  //         기록에 남았다. 기간 칸을 실제로 그리고 기본값은 비운다(모르는 것을 아는 척하지 않는다).
  const addItem = () => {
    const items = [...(data.items || []), { name: '', dosage: '', frequency: '', duration: '' }];
    onChange({ ...data, items });
  };

  const updateItem = (idx: number, patch: Record<string, string>) => {
    const items = [...(data.items || [])];
    items[idx] = { ...items[idx], ...patch };
    onChange({ ...data, items });
  };

  const removeItem = (idx: number) => {
    const items = (data.items || []).filter((_: unknown, i: number) => i !== idx);
    onChange({ ...data, items });
  };

  return (
    <div>
      <FieldLabel field={field} />
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47" />
            </svg>
            <span className="text-xs font-semibold text-indigo-700"><T k="처방 메모" /></span>
            {/* 🔴 E5 — 종전엔 durCheck 가 켜지면 'DUR' 배지를 달았지만 이 컴포넌트 어디에도 DUR 호출이
                없다(약품명·용량이 자유 텍스트라 코드 바인딩 자체가 없다). 검증한다고 말하지 않는다. */}
            {field.durCheck && (
              <span className="text-[9px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded" title="이 칸은 DUR 검증 대상이 아닙니다">DUR 미적용</span>
            )}
          </div>
          {!disabled && (
            <button type="button" onClick={addItem}
              className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium">+ <T k="추가" /></button>
          )}
        </div>
        <div className="p-2 space-y-2">
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
            여기에 적은 내용은 <strong>진료기록 본문에 글로만</strong> 남습니다 — 처방이 생성되지 않고,
            DUR·상호작용·용량 점검도 하지 않습니다. 실제 투약은 <strong>처방 패널</strong>에서 입력하세요.
          </p>
          {(data.items || []).length === 0 ? (
            <EmptyState icon="💊" title="처방 항목이 없습니다" />
          ) : (
            (data.items || []).map((item: { name: string; dosage: string; frequency: string; duration: string }, idx: number) => (
              <div key={idx} className="flex items-start gap-2 p-2 bg-gray-50 rounded-lg">
                <div className="flex-1 grid grid-cols-3 gap-1.5">
                  <input type="text" value={item.name} onChange={e => updateItem(idx, { name: e.target.value })}
                    placeholder={tAttr('약품명...')} disabled={disabled}
                    className="col-span-3 px-2 py-1 text-xs border border-gray-200 rounded" />
                  <input type="text" value={item.dosage} onChange={e => updateItem(idx, { dosage: e.target.value })}
                    placeholder={tAttr('용량')} disabled={disabled}
                    className="px-2 py-1 text-xs border border-gray-200 rounded" />
                  <input type="text" value={item.frequency} onChange={e => updateItem(idx, { frequency: e.target.value })}
                    placeholder={tAttr('투여횟수')} disabled={disabled}
                    className="px-2 py-1 text-xs border border-gray-200 rounded" />
                  <input type="text" value={item.duration ?? ''} onChange={e => updateItem(idx, { duration: e.target.value })}
                    placeholder={tAttr('투여기간')} disabled={disabled}
                    className="px-2 py-1 text-xs border border-gray-200 rounded" />
                </div>
                {!disabled && (
                  <button type="button" onClick={() => removeItem(idx)}
                    className="text-gray-400 hover:text-red-500 text-xs mt-1">\u2715</button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Order Field (검사/영상 오더)                                        */
/* ================================================================== */

function OrderField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const tAttr = useTAttr();
  interface OrderData { items?: { type: string; name: string; priority: string; note: string }[] }
  const data = (typeof value === 'object' && value && !Array.isArray(value) ? value : { items: [] }) as OrderData;

  const addItem = (type: string) => {
    const items = [...(data.items || []), { type, name: '', priority: 'ROUTINE', note: '' }];
    onChange({ ...data, items });
  };

  const updateItem = (idx: number, patch: Record<string, string>) => {
    const items = [...(data.items || [])];
    items[idx] = { ...items[idx], ...patch };
    onChange({ ...data, items });
  };

  const removeItem = (idx: number) => {
    const items = (data.items || []).filter((_: unknown, i: number) => i !== idx);
    onChange({ ...data, items });
  };

  return (
    <div>
      <FieldLabel field={field} />
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-violet-50 border-b border-violet-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span className="text-xs font-semibold text-violet-700"><T k="오더 메모" /></span>
          </div>
          {!disabled && (
            <div className="flex gap-1">
              <button type="button" onClick={() => addItem('LAB')}
                className="text-[11px] text-purple-600 hover:text-purple-800 font-medium px-1.5 py-0.5 bg-purple-50 rounded">+ <T k="검사" /></button>
              <button type="button" onClick={() => addItem('IMAGING')}
                className="text-[11px] text-teal-600 hover:text-teal-800 font-medium px-1.5 py-0.5 bg-teal-50 rounded">+ <T k="영상" /></button>
            </div>
          )}
        </div>
        <div className="p-2 space-y-2">
          {/* 🔴 이 필드도 실제 오더를 만들지 않는다 — 기록 본문에만 남는다(P16). */}
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
            여기에 적은 내용은 <strong>진료기록 본문에 글로만</strong> 남습니다 — 검사/영상 오더는 생성되지 않습니다.
          </p>
          {(data.items || []).length === 0 ? (
            <EmptyState icon="📋" title="오더 항목이 없습니다" />
          ) : (
            (data.items || []).map((item: { type: string; name: string; priority: string; note: string }, idx: number) => (
              <div key={idx} className="flex items-start gap-2 p-2 bg-gray-50 rounded-lg">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                  item.type === 'LAB' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'
                }`}>{item.type === 'LAB' ? <T k="검사" /> : <T k="영상" />}</span>
                <div className="flex-1 space-y-1">
                  <input type="text" value={item.name} onChange={e => updateItem(idx, { name: e.target.value })}
                    placeholder={`${item.type === 'LAB' ? '검사' : '영상'}명...`} disabled={disabled}
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded" />
                  <div className="flex gap-1">
                    {['ROUTINE', 'STAT'].map(p => (
                      <button key={p} type="button" disabled={disabled}
                        onClick={() => updateItem(idx, { priority: p })}
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          item.priority === p
                            ? (p === 'STAT' ? 'bg-red-100 text-red-700 border-red-300' : 'bg-gray-200 text-gray-700 border-gray-300')
                            : 'bg-white text-gray-400 border-gray-200'
                        }`}>{p}</button>
                    ))}
                  </div>
                </div>
                {!disabled && (
                  <button type="button" onClick={() => removeItem(idx)}
                    className="text-gray-400 hover:text-red-500 text-xs mt-0.5">\u2715</button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Timeline Field (처치 타임라인)                                      */
/* ================================================================== */

function TimelineField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const tAttr = useTAttr();
  interface TimelineData { entries?: { time: string; action: string }[] }
  const data = (typeof value === 'object' && value && !Array.isArray(value) ? value : { entries: [] }) as TimelineData;

  const addEntry = () => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const entries = [...(data.entries || []), { time: timeStr, action: '' }];
    onChange({ ...data, entries });
  };

  const updateEntry = (idx: number, patch: Record<string, string>) => {
    const entries = [...(data.entries || [])];
    entries[idx] = { ...entries[idx], ...patch };
    onChange({ ...data, entries });
  };

  const removeEntry = (idx: number) => {
    const entries = (data.entries || []).filter((_: unknown, i: number) => i !== idx);
    onChange({ ...data, entries });
  };

  return (
    <div>
      <FieldLabel field={field} />
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold text-gray-700"><T k="처치 타임라인" /></span>
          </div>
          {!disabled && (
            <button type="button" onClick={addEntry}
              className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">+ <T k="기록 추가" /></button>
          )}
        </div>
        <div className="p-2">
          {(data.entries || []).length === 0 ? (
            <EmptyState icon="📝" title="타임라인 기록이 없습니다" />
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[42px] top-2 bottom-2 w-0.5 bg-gray-200" />
              <div className="space-y-2">
                {(data.entries || []).map((entry: { time: string; action: string }, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 relative">
                    <input type="time" value={entry.time} onChange={e => updateEntry(idx, { time: e.target.value })}
                      disabled={disabled}
                      className="w-[76px] px-1 py-1 text-[11px] border border-gray-200 rounded text-center bg-white relative z-10 shrink-0" />
                    <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0 relative z-10" />
                    <input type="text" value={entry.action} onChange={e => updateEntry(idx, { action: e.target.value })}
                      placeholder={tAttr('처치/관찰 내용...')}
                      disabled={disabled}
                      className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded" />
                    {!disabled && (
                      <button type="button" onClick={() => removeEntry(idx)}
                        className="text-gray-400 hover:text-red-500 text-xs mt-0.5 shrink-0">\u2715</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Field Label                                                        */
/* ================================================================== */

function FieldLabel({ field }: { field: FieldDef }) {
  if (field.type === 'checkbox') return null;
  return (
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
      {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

/** 임상도구(78종) 필드 — 차트 템플릿에서 chartId 참조 → 엔진 렌더(입력·판정 결과 저장) */
function ClinicalChartField({ field, value, onChange, disabled }: { field: FieldDef; value: FieldValue; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const capture = useClinicalChartCapture();
  const def = field.clinicalChartId ? getChart(field.clinicalChartId) : undefined;
  if (!def) {
    return (
      <div>
        <FieldLabel field={field} />
        <div className="p-3 rounded-xl border border-dashed border-gray-200 text-xs text-gray-400"><T k="임상도구가 선택되지 않았습니다(템플릿 설정에서 지정)." /></div>
      </div>
    );
  }
  return (
    <ClinicalChartRunner
      def={def}
      value={(value && typeof value === 'object' && !Array.isArray(value) ? value : undefined) as ClinicalChartValue | undefined}
      onChange={(v) => {
        onChange(v as unknown as FieldValue);
        // 진료화면 캡처(서명 시 ClinicalChartResult 자동 영속) — Provider 없으면 no-op
        if (capture && v && typeof v === 'object') capture.register(field.id, v);
      }}
      disabled={disabled}
    />
  );
}
