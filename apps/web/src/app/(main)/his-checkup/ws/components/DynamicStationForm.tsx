'use client';

import { useState } from 'react';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select' | 'multiselect' | 'computed';
  unit?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  formula?: string;
}

interface PendingItem { testName: string; finding: string }

interface DynamicStationFormProps {
  template: { fields: FieldDef[] } | null;
  /** 🔴 완료 대상 검사를 명시해 넘긴다 — 서버가 category 로 일괄 마감하면 시행하지 않은 검사가 '정상'이 된다 */
  onSubmit: (data: Record<string, unknown>, finding: string, testNames: string[]) => void;
  loading?: boolean;
  stationName?: string;
  /** 이 수검자가 이 스테이션 분류에서 아직 안 한 검사들 */
  pendingItems?: PendingItem[];
}

const FINDING_OPTIONS = [
  { key: 'NORMAL', label: '정상', cls: 'bg-emerald-100 border-emerald-300 text-emerald-700' },
  { key: 'ABNORMAL', label: '이상', cls: 'bg-amber-100 border-amber-300 text-amber-700' },
  { key: 'CRITICAL', label: '위험', cls: 'bg-red-100 border-red-300 text-red-700' },
];

export function DynamicStationForm({ template, onSubmit, loading, stationName, pendingItems = [] }: DynamicStationFormProps) {
  const tAttr = useTAttr();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [finding, setFinding] = useState('NORMAL');
  const [note, setNote] = useState('');
  // 🔴 기본 전체 선택하지 않는다 — 시행 여부는 사람이 밝히는 사실이지 기본값이 아니다
  const [checked, setChecked] = useState<string[]>([]);
  const pending = pendingItems.filter((i) => i.finding === 'PENDING');
  const toggle = (name: string) => setChecked((c) => (c.includes(name) ? c.filter((x) => x !== name) : [...c, name]));
  const canSubmit = pending.length === 0 || checked.length > 0;

  const TestPicker = () => (
    pending.length === 0 ? null : (
      <div className="border border-gray-200 rounded-xl p-3">
        <p className="text-xs font-medium text-gray-500 mb-2"><T k="시행한 검사 선택" /> <span className="text-red-500">*</span></p>
        <div className="space-y-1.5">
          {pending.map((i) => (
            <label key={i.testName} className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
              <input type="checkbox" checked={checked.includes(i.testName)} onChange={() => toggle(i.testName)} className="rounded" />
              {i.testName}
            </label>
          ))}
        </div>
        {checked.length === 0 && <p className="text-[11px] text-amber-600 mt-2"><T k="시행한 검사를 선택해야 완료할 수 있습니다 — 선택하지 않은 검사는 대기로 남습니다." /></p>}
      </div>
    )
  );

  const fields = template?.fields ?? [];

  const setValue = (name: string, value: unknown) => {
    const next = { ...values, [name]: value };

    // BMI 자동 계산
    if ((name === 'height' || name === 'weight') && next.height && next.weight) {
      const h = Number(next.height) / 100;
      if (h > 0) next.bmi = Math.round((Number(next.weight) / (h * h)) * 10) / 10;
    }

    setValues(next);
  };

  const handleSubmit = () => {
    onSubmit({ ...values, note }, finding, checked);
  };

  // 템플릿 없으면 기본 폼
  if (fields.length === 0) {
    return (
      <div className="bg-white border rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">{stationName ?? tAttr('결과 입력')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="결과값" /></label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('결과값')}
              onChange={(e) => setValue('value', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="단위" /></label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('단위')}
              onChange={(e) => setValue('unit', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="비고" /></label>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <TestPicker />
        <FindingSelector finding={finding} onChange={setFinding} />
        <button onClick={handleSubmit} disabled={loading || !canSubmit}
          title={!canSubmit ? tAttr('시행한 검사를 선택하세요') : undefined}
          className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          <T k={loading ? '저장 중...' : '검사 완료'} />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-gray-800">{stationName ?? tAttr('결과 입력')}</h3>

      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => {
          if (field.type === 'computed') {
            return (
              <div key={field.name}>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{field.label}</label>
                <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm font-medium text-gray-900">
                  {values[field.name] != null ? String(values[field.name]) : '-'}
                  {field.unit && <span className="text-gray-400 text-xs ml-1">{field.unit}</span>}
                </div>
              </div>
            );
          }

          if (field.type === 'textarea') {
            return (
              <div key={field.name} className="col-span-2">
                <label className="text-xs font-medium text-gray-500 mb-1 block">
                  {field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2}
                  placeholder={field.placeholder}
                  onChange={(e) => setValue(field.name, e.target.value)} />
              </div>
            );
          }

          if (field.type === 'select') {
            return (
              <div key={field.name}>
                <label className="text-xs font-medium text-gray-500 mb-1 block">
                  {field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"
                  onChange={(e) => setValue(field.name, e.target.value)}>
                  <option value="">{tAttr('선택')}</option>
                  {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            );
          }

          if (field.type === 'multiselect') {
            const selected = (values[field.name] as string[]) ?? [];
            return (
              <div key={field.name} className="col-span-2">
                <label className="text-xs font-medium text-gray-500 mb-1 block">{field.label}</label>
                <div className="flex flex-wrap gap-1.5">
                  {field.options?.map((opt) => (
                    <button key={opt} type="button"
                      onClick={() => {
                        const next = selected.includes(opt)
                          ? selected.filter((s) => s !== opt)
                          : [...selected, opt];
                        setValue(field.name, next);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition ${
                        selected.includes(opt)
                          ? 'bg-blue-100 border-blue-300 text-blue-700'
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <div key={field.name}>
              <label className="text-xs font-medium text-gray-500 mb-1 block">
                {field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder={field.placeholder}
                  onChange={(e) => setValue(field.name, field.type === 'number' ? parseFloat(e.target.value) || '' : e.target.value)}
                />
                {field.unit && <span className="text-xs text-gray-400 whitespace-nowrap">{field.unit}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="비고" /></label>
        <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('특이사항')}
          value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <TestPicker />

      <FindingSelector finding={finding} onChange={setFinding} />

      <button onClick={handleSubmit} disabled={loading || !canSubmit}
        title={!canSubmit ? tAttr('시행한 검사를 선택하세요') : undefined}
        className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
        <T k={loading ? '저장 중...' : '검사 완료'} />
      </button>
    </div>
  );
}

function FindingSelector({ finding, onChange }: { finding: string; onChange: (f: string) => void }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-500 mb-1.5 block"><T k="판정" /></label>
      <div className="flex gap-2">
        {FINDING_OPTIONS.map((f) => (
          <button key={f.key} type="button" onClick={() => onChange(f.key)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition ${
              finding === f.key ? f.cls : 'bg-white border-gray-200 text-gray-400'
            }`}>
            <T k={f.label} />
          </button>
        ))}
      </div>
    </div>
  );
}
