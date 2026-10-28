import type { ReactNode } from 'react';
/** 전문과 진료 레이아웃 공용 타입/상수 */

export interface BaseEncounterLayoutProps {
  patientId: string;
  encounterId: string | null;
  onStartEncounter: () => void;
  patient: { familyName?: string; givenName?: string; mrn?: string };
  onSaveDraft: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  onSignAndBill: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  isSaving: boolean;
  isSigning: boolean;
  /** 처방 열(페이지가 넘긴다) — 서명 바 위에 그린다 */
  rxSlot?: ReactNode;
}

export const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
export const selectCls = inputCls;
export const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';
export const textareaCls = 'w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300';
