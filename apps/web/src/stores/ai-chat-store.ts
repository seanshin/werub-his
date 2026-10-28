'use client';

import { create } from 'zustand';
import { AI_CHAT_PANEL_ROLES, type AiChatContextPayload } from '@hospital-run/shared';

/** 화면이 어시스턴트에 걸어 두는 맥락(표시용 이름 포함 — 서버로는 id·SOAP 만 간다) */
export interface AiAssistantContext {
  patientId: string;
  patientName: string;
  encounterId?: string | null;
  department?: string | null;
  /** 어떤 화면이 걸었는지(표시) */
  surface: 'PATIENT' | 'ENCOUNTER' | 'INPATIENT';
}

type SoapGetter = () => NonNullable<AiChatContextPayload['soap']>;

/**
 * AI 어시스턴트 패널 상태 — 기획 `medical-term-display-toggle.plan.md` §2.4(옴니박스) · 2026-10-02 재구성.
 *
 * 🔴 종전에는 (main)/layout 로컬 useState 라 사이드바 로고 버튼이 **유일한 입구**였다 —
 *    검색(옴니박스)에서 "어시스턴트에게 묻기"로 열 수 있도록 스토어로 승격한다.
 * pendingQuestion 은 검색에서 넘긴 질의 — 패널이 열리면 한 번 소비하고 비운다.
 *
 * 🔴 (2026-10-02) 패널은 환자 맥락을 받을 길이 **없었다** — "○○ 환자 컨텍스트 연결됨" 문구는 도달 불가였고
 *    `/요약`·`/재입원` 은 늘 실패했다. 환자·진료 화면이 `useAiAssistantContext` 로 맥락을 건다.
 *    SOAP 는 값이 아니라 **읽는 함수**로 건다(타자마다 스토어를 흔들지 않고, 보내는 순간의 화면 값을 읽는다).
 */
export const useAiChatStore = create<{
  open: boolean;
  pendingQuestion: string | null;
  context: AiAssistantContext | null;
  soapGetter: SoapGetter | null;
  /** 넓게 보기 — 넓은 화면에서 본문이 패널 폭만큼 비켜선다(layout) */
  wide: boolean;
  toggleWide: () => void;
  toggle: () => void;
  close: () => void;
  openWith: (q: string) => void;
  consumePendingQuestion: () => string | null;
  setContext: (ctx: AiAssistantContext | null, soapGetter?: SoapGetter | null) => void;
  /** 그 화면이 건 맥락일 때만 푼다(다른 화면이 이미 바꿔 걸었으면 건드리지 않는다) */
  releaseContext: (patientId: string, surface: AiAssistantContext['surface']) => void;
}>((set, get) => ({
  open: false,
  pendingQuestion: null,
  context: null,
  soapGetter: null,
  wide: false,
  toggleWide: () => set((s) => ({ wide: !s.wide })),
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
  openWith: (q) => set({ open: true, pendingQuestion: q.trim() || null }),
  consumePendingQuestion: () => {
    const q = get().pendingQuestion;
    if (q) set({ pendingQuestion: null });
    return q;
  },
  setContext: (ctx, soapGetter = null) => set({ context: ctx, soapGetter: ctx ? soapGetter : null }),
  releaseContext: (patientId, surface) => {
    const c = get().context;
    if (c && c.patientId === patientId && c.surface === surface) set({ context: null, soapGetter: null });
  },
}));

/** 어시스턴트 EP(@Roles DOCTOR·NURSE + ADMIN 우회)와 같은 집합 — 정본은 shared `AI_CHAT_PANEL_ROLES` */
export const AI_CHAT_ALLOWED_ROLES = AI_CHAT_PANEL_ROLES;
export const canUseAiChat = (role: string | undefined | null): boolean =>
  !!role && (AI_CHAT_ALLOWED_ROLES as readonly string[]).includes(role);
