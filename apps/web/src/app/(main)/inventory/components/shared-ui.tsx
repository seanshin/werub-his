'use client';

import React from 'react';
import { T } from '@/components/ui/i18n-text';

// ─── Types ────────────────────────────────────────────────────────────────────
export type Item = { id: string; code: string; name: string; specification: string; category: string; unit: string; storageId: string; currentStock: number; safetyStock: number; status: string };
export type Transaction = { id: string; itemId: string; itemName: string; type: string; quantity: number; reason: string; createdAt: string; createdBy: string };
export type Storage = { id: string; code: string; name: string; type: string; location: string; temperature: string; managerName: string };
export type Supplier = { id: string; code: string; name: string; businessNumber: string; contactName: string; contactPhone: string; contactEmail: string; paymentTerms: string; rating: number };
export type PO = { id: string; orderNumber: string; supplierId: string; supplier: { name: string }; status: string; totalAmount: number; createdAt: string; items: POItem[] };
export type POItem = { id: string; poItemId?: string; itemId: string; itemName: string; quantity: number; orderedQty: number; unitPrice: number; receivedQty?: number };
export type Request = { id: string; requestNumber: string; department: string; status: string; createdAt: string; items: { itemName: string; quantity: number }[] };
export type Lot = { id: string; lotNumber: string; itemName: string; quantity: number; expiryDate: string; status: string };
export type RepackOrder = { id: string; orderNumber: string; type: string; targetItemName: string; targetQty: number; targetUnit: string; status: string; performedBy: string | null; instructions: string; items: { itemId: string; quantity: number }[]; createdAt: string };
export type QrLabel = { id: string; labelType: string; referenceId: string; referenceName: string; referenceCode: string; qrData: string; printedAt: string | null; printCount: number; createdAt: string };

// ─── Shared UI ────────────────────────────────────────────────────────────────
export const Badge = ({ label, color }: { label: string; color: string }) => (
  // 🔴 label 은 **표시 문자열**이다(저장값은 호출부의 enum) — 여기서 화면 언어를 입힌다.
  //    한글이 없는 값(영문 enum)은 <T> 가 티 없이 그대로 그린다.
  <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${color}`}><T k={label} /></span>
);
export const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-50 text-emerald-700', INACTIVE: 'bg-gray-100 text-gray-500',
    LOW: 'bg-rose-50 text-rose-700', NORMAL: 'bg-emerald-50 text-emerald-700',
    DRAFT: 'bg-gray-100 text-gray-600', SUBMITTED: 'bg-blue-50 text-blue-700',
    APPROVED: 'bg-violet-50 text-violet-700', ORDERED: 'bg-amber-50 text-amber-700',
    RECEIVED: 'bg-emerald-50 text-emerald-700', CANCELLED: 'bg-rose-50 text-rose-700',
    PENDING: 'bg-amber-50 text-amber-700', REQUESTED: 'bg-amber-50 text-amber-700',
    ISSUED: 'bg-emerald-50 text-emerald-700',
    EXPIRED: 'bg-rose-50 text-rose-700', IN: 'bg-blue-50 text-blue-700',
    OUT: 'bg-rose-50 text-rose-700', ADJUST: 'bg-amber-50 text-amber-700',
    RETURN: 'bg-violet-50 text-violet-700',
  };
  return <Badge label={status} color={map[status] ?? 'bg-gray-100 text-gray-500'} />;
};
export const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th className={`px-4 py-3 text-xs font-medium text-gray-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);
export const Td = ({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) => (
  <td className={`px-4 py-3 text-sm text-gray-700 ${right ? 'text-right' : ''} ${mono ? 'font-mono text-xs text-gray-500' : ''}`}>{children}</td>
);
export const EmptyRow = ({ cols, msg }: { cols: number; msg: string }) => (
  <tr><td colSpan={cols} className="px-4 py-12 text-center text-sm text-gray-400"><T k={msg} /></td></tr>
);
export const Btn = ({ onClick, children, variant = 'primary', sm }: { onClick?: () => void; children: React.ReactNode; variant?: 'primary' | 'ghost' | 'danger'; sm?: boolean }) => {
  const base = `rounded-lg font-medium transition-colors ${sm ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`;
  const v = { primary: 'bg-blue-600 text-white hover:bg-blue-700', ghost: 'border border-gray-200 text-gray-700 hover:bg-gray-50', danger: 'bg-rose-600 text-white hover:bg-rose-700' };
  return <button className={`${base} ${v[variant]}`} onClick={onClick}>{children}</button>;
};
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
  <input {...props} ref={ref} className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${props.className ?? ''}`} />
));
Input.displayName = 'Input';
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>((props, ref) => (
  <select {...props} ref={ref} className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${props.className ?? ''}`} />
));
Select.displayName = 'Select';
export const Label = ({ children }: { children: React.ReactNode }) => <label className="block text-xs font-medium text-gray-600 mb-1">{children}</label>;
export const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${className ?? ''}`}>{children}</div>
);
export const FormGrid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{children}</div>
);
