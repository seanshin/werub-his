export function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500"><T k={label} /></span>
      <span className="font-medium text-gray-900">{value || '-'}</span>
    </div>
  );
}

import { T, useTAttr } from '@/components/ui/i18n-text';
import React from 'react';

type FieldProps = {
  label: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

export const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  ({ label, error, className, ...inputProps }, ref) => (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1"><T k={label} /></label>
      <input
        ref={ref}
        {...inputProps}
        type={inputProps.type ?? 'text'}
        className={className ?? 'w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent'}
      />
      {error && <p className="text-xs text-red-500 mt-0.5"><T k={error} /></p>}
    </div>
  )
);
Field.displayName = 'Field';

export interface EquipmentInfo { id: string; name: string; assetNumber?: string; }

export function EquipmentSelect({ equipments, value, onChange }: { equipments: EquipmentInfo[]; value: string; onChange: (v: string) => void }) {
  const tAttr = useTAttr();
  return (
    <select value={value} onChange={e => onChange(e.target.value)} required className="px-3 py-2 border border-gray-200 rounded-xl text-sm min-w-[200px]">
      <option value="">{tAttr('-- 장비 선택 --')}</option>
      {equipments.map((e: EquipmentInfo) => (
        <option key={e.id} value={e.id}>{e.name} ({e.assetNumber})</option>
      ))}
    </select>
  );
}
