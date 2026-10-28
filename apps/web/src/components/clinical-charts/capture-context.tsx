'use client';

/**
 * 임상도구 값 캡처 — 진료화면의 모든 ChartRenderer(메인/전문과 레이아웃)가 거치는
 * ClinicalChartField가 값을 한 곳(Map)에 등록 → 인카운터 서명/저장 시 일괄 영속.
 * Provider 없으면(예: /clinical-tools) no-op.
 */
import { createContext, useContext, useMemo, useRef } from 'react';
import type { ClinicalChartValue } from './ClinicalChartRunner';

export interface CapturedClinical { fieldId: string; value: ClinicalChartValue }

export interface ClinicalChartCaptureApi {
  register: (fieldId: string, value: ClinicalChartValue) => void;
  getAll: () => CapturedClinical[];
  clear: () => void;
}

const Ctx = createContext<ClinicalChartCaptureApi | null>(null);

/** 페이지에서 store 생성 → Provider value 로 주입하고, 서명 핸들러에서 getAll() 사용 */
export function useClinicalChartCaptureStore(): ClinicalChartCaptureApi {
  const ref = useRef<Map<string, ClinicalChartValue>>(new Map());
  return useMemo(() => ({
    register: (fieldId, value) => { ref.current.set(fieldId, value); },
    getAll: () => Array.from(ref.current.entries()).map(([fieldId, value]) => ({ fieldId, value })),
    clear: () => ref.current.clear(),
  }), []);
}

export function ClinicalChartCaptureProvider({ value, children }: { value: ClinicalChartCaptureApi; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useClinicalChartCapture = () => useContext(Ctx);

/* ── 인카운터 컨텍스트 (CPOE 결선 P0) ──
 * 진료 작성 화면이 encounterId/patientId 를 주입 → TreeRunner 가 '처방 초안 생성' 버튼 노출.
 * Provider 없으면(예: /clinical-tools) null → 버튼 미노출(산출 보조만). */
export interface EncounterRef { encounterId: string; patientId: string }

const EncounterRefCtx = createContext<EncounterRef | null>(null);

export function EncounterRefProvider({ value, children }: { value: EncounterRef | null; children: React.ReactNode }) {
  return <EncounterRefCtx.Provider value={value}>{children}</EncounterRefCtx.Provider>;
}

export const useEncounterRef = () => useContext(EncounterRefCtx);
