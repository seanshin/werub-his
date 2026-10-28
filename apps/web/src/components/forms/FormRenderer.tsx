'use client';

import { useState } from 'react';

interface FormQuestion {
  id: string;
  label: string;
  type: 'number' | 'text' | 'textarea' | 'select' | 'checkbox' | 'date';
  unit?: string;
  options?: { value: string; label: string }[];
  validation?: { min?: number; max?: number; required?: boolean };
}

interface FormSection {
  label: string;
  questions: FormQuestion[];
}

interface FormPage {
  label: string;
  sections: FormSection[];
}

interface FormSchema {
  name: string;
  version: string;
  locale: string;
  pages: FormPage[];
}

interface FormRendererProps {
  schema: FormSchema;
  onSubmit: (data: Record<string, unknown>) => void;
  isSubmitting?: boolean;
}

export function FormRenderer({ schema, onSubmit, isSubmitting }: FormRendererProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setValue = (id: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => ({ ...prev, [id]: '' }));
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    for (const page of schema.pages) {
      for (const section of page.sections) {
        for (const q of section.questions) {
          const val = formData[q.id];
          if (q.validation?.required && (val === undefined || val === '' || val === null)) {
            newErrors[q.id] = '필수 항목입니다';
          }
          if (q.type === 'number' && val !== undefined && val !== '') {
            const num = Number(val);
            if (q.validation?.min !== undefined && num < q.validation.min) {
              newErrors[q.id] = `최소값: ${q.validation.min}`;
            }
            if (q.validation?.max !== undefined && num > q.validation.max) {
              newErrors[q.id] = `최대값: ${q.validation.max}`;
            }
          }
        }
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {schema.pages.map((page) => (
        <div key={page.label}>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">{page.label}</h3>
          {page.sections.map((section) => (
            <div key={section.label} className="mb-4">
              <p className="text-sm font-medium text-gray-600 mb-2">{section.label}</p>
              <div className="grid grid-cols-2 gap-3">
                {section.questions.map((q) => (
                  <div key={q.id} className={q.type === 'textarea' ? 'col-span-2' : ''}>
                    <label className="block text-xs text-gray-500 mb-1">
                      {q.label} {q.unit && <span className="text-gray-400">({q.unit})</span>}
                      {q.validation?.required && <span className="text-red-400">*</span>}
                    </label>

                    {q.type === 'number' && (
                      <input
                        type="number"
                        value={(formData[q.id] as string) ?? ''}
                        onChange={(e) => setValue(q.id, e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm"
                        min={q.validation?.min}
                        max={q.validation?.max}
                      />
                    )}

                    {(q.type === 'text' || q.type === 'date') && (
                      <input
                        type={q.type}
                        value={(formData[q.id] as string) ?? ''}
                        onChange={(e) => setValue(q.id, e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm"
                      />
                    )}

                    {q.type === 'textarea' && (
                      <textarea
                        rows={2}
                        value={(formData[q.id] as string) ?? ''}
                        onChange={(e) => setValue(q.id, e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm"
                      />
                    )}

                    {q.type === 'select' && (
                      <select
                        value={(formData[q.id] as string) ?? ''}
                        onChange={(e) => setValue(q.id, e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm"
                      >
                        <option value="">선택</option>
                        {q.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    )}

                    {q.type === 'checkbox' && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!formData[q.id]}
                          onChange={(e) => setValue(q.id, e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-700">있음</span>
                      </label>
                    )}

                    {errors[q.id] && <p className="text-xs text-red-500 mt-0.5">{errors[q.id]}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      <button
        type="submit"
        disabled={isSubmitting}
        className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? '저장 중...' : '제출'}
      </button>
    </form>
  );
}
