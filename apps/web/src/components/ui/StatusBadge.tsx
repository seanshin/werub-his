'use client';

import React from 'react';
import { StatusShapeMark, type StatusShape } from './display';
import { useUiLocale } from '@/stores/ui-locale-store';
import {
  AI_ORIGIN_TEXT, tOf, SURGERY_STATUS_LABEL,
  ORDER_STATUS_LABEL, PRESCRIPTION_STATUS_LABEL, LAB_RESULT_STATUS_LABEL,
  TRANSFUSION_ORDER_STATUS_LABEL, ADMISSION_STATUS_LABEL, CLAIM_STATUS_LABEL,
  ORDER_DEPT_STATUS_LABEL, PHARMACY_ORDER_STATUS_LABEL,
  APPOINTMENT_STATUS_LABEL, BILLING_STATUS_LABEL, ENCOUNTER_STATUS_LABEL,
  EMERGENCY_VISIT_STATUS_LABEL, PLAN_STATUS_LABEL,
  DOC_ISSUANCE_STATUS_LABEL, ONBOARDING_STATUS_LABEL, CAMPAIGN_STATUS_LABEL,
  INTL_CASE_STATUS_LABEL, WAITING_QUEUE_STATUS_LABEL, CONSENT_STATUS_LABEL,
  EQUIPMENT_STATUS_LABEL,
  CONTROLLED_SUBSTANCE_STATUS_LABEL,
  MED_ADMIN_STATUS_LABEL,
  NIMS_TRANSMISSION_STATUS_LABEL,
  RADIATION_PLAN_STATUS_LABEL, RADIATION_FRACTION_STATUS_LABEL,
  AI_PROPOSAL_STATUS_LABEL,
  DIAGNOSTIC_TEST_STATUS_LABEL,
  HR_REQUEST_STATUS_LABEL,
} from '@hospital-run/shared';

/* ── Default color config ────────────────────────────────────────────────────── */

const DEFAULT_CONFIG: Record<string, { label: string; bg: string; text: string; shape?: StatusShape }> = {
  SCHEDULED:  { label: '예약',     bg: 'bg-blue-100',    text: 'text-blue-700',    shape: 'info' },
  CONFIRMED:  { label: '확정',     bg: 'bg-emerald-100', text: 'text-emerald-700', shape: 'ok' },
  PAID:       { label: '납부완료', bg: 'bg-emerald-100', text: 'text-emerald-700', shape: 'ok' },
  PENDING:    { label: '미납',     bg: 'bg-amber-100',   text: 'text-amber-700',   shape: 'warn' },
  COMPLETED:  { label: '완료',     bg: 'bg-gray-100',    text: 'text-gray-600',    shape: 'neutral' },
  CANCELLED:  { label: '취소',     bg: 'bg-gray-100',    text: 'text-gray-600',    shape: 'neutral' },
  ACTIVE:     { label: '활성',     bg: 'bg-emerald-100', text: 'text-emerald-700', shape: 'ok' },
  INACTIVE:   { label: '비활성',   bg: 'bg-gray-100',    text: 'text-gray-600',    shape: 'neutral' },
  ERROR:      { label: '오류',     bg: 'bg-red-100',     text: 'text-red-700',     shape: 'danger' },
  WARNING:    { label: '경고',     bg: 'bg-amber-100',   text: 'text-amber-700',   shape: 'warn' },
};

// 🔴 모르는 상태에는 기호를 지어내지 않는다 — 색도 중립, 기호도 없음
const FALLBACK: { label: string; bg: string; text: string; shape?: StatusShape } = { label: '', bg: 'bg-gray-100', text: 'text-gray-600' };

/* ── 도메인 레지스트리(UX 일관성 검토 2026-07) ─────────────────────────────────
 * 라벨 정본=packages/shared 도메인 상수(동일 enum 3표기 난립 해소), 색=상태 의미별 단일 규약.
 * 216파일의 로컬 STATUS_LABEL/COLOR Record 재정의를 <StatusBadge domain="order" status={...} />로 대체.
 */
const TONE = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-700' },     // 대기·의뢰·미확정
  active: { bg: 'bg-blue-100', text: 'text-blue-700' },        // 진행중
  ready: { bg: 'bg-violet-100', text: 'text-violet-700' },     // 준비·중간 단계
  done: { bg: 'bg-emerald-100', text: 'text-emerald-700' },    // 완료·확정·승인
  neutral: { bg: 'bg-gray-100', text: 'text-gray-600' },       // 취소·종료
  danger: { bg: 'bg-red-100', text: 'text-red-700' },          // 반려·오류
} as const;

/**
 * 톤 → 색 외 기호. 🔴 색이 말하는 것과 **같은 사실**을 기호로도 말한다(`ui.a11y.statusShape`).
 *    go-live 가 "배선 완료(2026-08-20)"라 적었지만 실제로는 기호를 그리는 소비처가 0이라
 *    **스위치를 켜도 어느 화면도 달라지지 않았다**(2026-09-03 실측). 정본 배지가 그리면
 *    44개 파일의 상태 표시가 한 번에 배선된다. 스위치가 꺼져 있으면(기본) 현행 그대로다.
 */
const TONE_SHAPE: Record<keyof typeof TONE, StatusShape> = {
  pending: 'warn', active: 'info', ready: 'info', done: 'ok', neutral: 'neutral', danger: 'danger',
};

function fromLabels(labels: Record<string, string>, tones: Record<string, keyof typeof TONE>) {
  const out: Record<string, { label: string; bg: string; text: string; shape?: StatusShape }> = {};
  for (const [k, label] of Object.entries(labels)) {
    const tone = tones[k] ?? 'neutral';
    out[k] = { label, ...TONE[tone], shape: TONE_SHAPE[tone] };
  }
  return out;
}

const DOMAIN_CONFIG: Record<string, Record<string, { label: string; bg: string; text: string; shape?: StatusShape }>> = {
  order: fromLabels(ORDER_STATUS_LABEL, { ORDERED: 'pending', RECEIVED: 'ready', IN_PROGRESS: 'active', COMPLETED: 'done', CANCELLED: 'neutral', ISSUED: 'ready', ON_HOLD: 'pending' }),
  prescription: fromLabels(PRESCRIPTION_STATUS_LABEL, { ACTIVE: 'active', DISCONTINUED: 'neutral', COMPLETED: 'done', CANCELLED: 'neutral', ON_HOLD: 'pending' }),
  labResult: fromLabels(LAB_RESULT_STATUS_LABEL, { PENDING: 'pending', COLLECTED: 'ready', IN_PROGRESS: 'active', COMPLETED: 'ready', VERIFIED: 'done' }),
  transfusionOrder: fromLabels(TRANSFUSION_ORDER_STATUS_LABEL, { ORDERED: 'pending', CROSSMATCHING: 'active', READY: 'ready', ISSUED: 'ready', IN_PROGRESS: 'active', COMPLETED: 'done', CANCELLED: 'neutral' }),
  admission: fromLabels(ADMISSION_STATUS_LABEL, { ADMITTED: 'active', DISCHARGED: 'done', TRANSFERRED: 'neutral' }),
  claim: fromLabels(CLAIM_STATUS_LABEL, { DRAFT: 'pending', SUBMITTED: 'ready', UNDER_REVIEW: 'active', APPROVED: 'done', PARTIALLY_APPROVED: 'ready', REJECTED: 'danger', PAID: 'done' }),
  // 수행부서(약국/검사/영상 큐) 관점 — 의뢰자 관점(order)과 시점 언어가 다름(ORDERED=접수대기)
  orderDept: fromLabels(ORDER_DEPT_STATUS_LABEL, { ORDERED: 'pending', RECEIVED: 'ready', IN_PROGRESS: 'active', COMPLETED: 'done', CANCELLED: 'neutral', ON_HOLD: 'pending' }),
  pharmacyOrder: fromLabels(PHARMACY_ORDER_STATUS_LABEL, { ORDERED: 'pending', RECEIVED: 'ready', PENDING: 'active', IN_PROGRESS: 'active', DISPENSED: 'done', VERIFIED: 'ready', ISSUED: 'neutral', COMPLETED: 'done', CANCELLED: 'danger' }),
  appointment: fromLabels(APPOINTMENT_STATUS_LABEL, { SCHEDULED: 'pending', CONFIRMED: 'ready', CHECKED_IN: 'ready', IN_PROGRESS: 'active', COMPLETED: 'done', CANCELLED: 'neutral', NO_SHOW: 'danger' }),
  billing: fromLabels(BILLING_STATUS_LABEL, { PENDING: 'pending', PAID: 'done', PARTIAL: 'ready', REFUNDED: 'neutral', CANCELLED: 'neutral', DEFERRED: 'pending', INSTALLMENT: 'ready' }),
  encounter: fromLabels(ENCOUNTER_STATUS_LABEL, { DRAFT: 'pending', IN_PROGRESS: 'active', COMPLETED: 'done', SIGNED: 'done', AMENDED: 'ready' }),
  emergencyVisit: fromLabels(EMERGENCY_VISIT_STATUS_LABEL, { PENDING_TRIAGE: 'pending', TRIAGED: 'ready', PENDING_DOCTOR: 'pending', IN_TREATMENT: 'active', PENDING_RESULT: 'ready', UNDER_OBSERVATION: 'active', PENDING_DISPOSITION: 'pending', COMPLETED: 'neutral' }),
  // 일정/계획 공통(전문과 오늘 일정·치료계획) — PLANNED 4상태
  plan: fromLabels(PLAN_STATUS_LABEL, { PLANNED: 'pending', IN_PROGRESS: 'active', COMPLETED: 'done', CANCELLED: 'neutral' }),
  docIssuance: fromLabels(DOC_ISSUANCE_STATUS_LABEL, { REQUESTED: 'pending', IN_REVIEW: 'active', PROCESSING: 'active', READY: 'ready', DELIVERED: 'done', REJECTED: 'danger' }),
  onboarding: fromLabels(ONBOARDING_STATUS_LABEL, { INVITED: 'pending', VERIFIED: 'ready', DOC_SUBMITTED: 'ready', CONTRACT_SIGNED: 'active', APPROVED: 'done', BOOTED: 'done', EXPIRED: 'neutral', REVOKED: 'danger' }),
  campaign: fromLabels(CAMPAIGN_STATUS_LABEL, { DRAFT: 'pending', SCHEDULED: 'ready', SENDING: 'active', COMPLETED: 'done', CANCELLED: 'neutral' }),
  intlCase: fromLabels(INTL_CASE_STATUS_LABEL, { INQUIRY: 'pending', QUOTED: 'ready', CONFIRMED: 'ready', ARRIVED: 'active', IN_TREATMENT: 'active', DISCHARGED: 'done', FOLLOW_UP: 'ready', CLOSED: 'neutral' }),
  waitingQueue: fromLabels(WAITING_QUEUE_STATUS_LABEL, { WAITING: 'pending', CALLED: 'ready', IN_CONSULTATION: 'active', CASHIER_WAITING: 'ready', PHARMACY_WAITING: 'ready', COMPLETED: 'done', CANCELLED: 'neutral', NO_SHOW: 'danger' }),
  consent: fromLabels(CONSENT_STATUS_LABEL, { PENDING: 'pending', SIGNED: 'done', EXPIRED: 'neutral', REVOKED: 'danger' }),
  // 🔴 고장은 위험색으로 — 종전 로컬 표는 DB 어휘와 어긋나 'BROKEN' 을 회색 영문으로 흘렸다
  equipment: fromLabels(EQUIPMENT_STATUS_LABEL, { ACTIVE: 'done', UNDER_MAINTENANCE: 'pending', BROKEN: 'danger', RETIRED: 'neutral' }),
  // 🔴 마약류 법정 원장(W8) — 폐기는 위험색. 화면 로컬 Record 재정의 금지
  controlledSubstance: fromLabels(CONTROLLED_SUBSTANCE_STATUS_LABEL, { PRESCRIBED: 'pending', VERIFIED: 'ready', DISPENSED: 'active', ADMINISTERED: 'done', WASTED: 'danger', RETURNED: 'neutral' }),
  // 🔴 투약 기록(MAR) — 보류·거부는 간호사가 판단을 남긴 것(할 일 아님·예정색 금지) · 미투약은 위험색
  medAdmin: fromLabels(MED_ADMIN_STATUS_LABEL, { SCHEDULED: 'pending', ADMINISTERED: 'done', HELD: 'neutral', REFUSED: 'danger', MISSED: 'danger' }),
  // 🔴 NIMS 전송(W8) — **미전송을 초록으로 칠하지 않는다.** 도달의 근거는 수기 접수번호뿐이다
  nimsTransmission: fromLabels(NIMS_TRANSMISSION_STATUS_LABEL, { QUEUED: 'pending', LOCAL_ONLY: 'pending', SEND_FAILED: 'danger', UNVERIFIED: 'danger', MANUAL_ACK: 'done', TRANSMITTED: 'done' }),
  // 🔴 방사선(T2-4) — 종전 화면 로컬 표는 실제 값(APPROVED·IN_TREATMENT·DELIVERING)을 몰라
  //    치료 중인 계획이 영문 회색으로 떴다. 라벨표는 shared 정본 하나뿐이다.
  radiationPlan: fromLabels(RADIATION_PLAN_STATUS_LABEL, { PLANNED: 'pending', APPROVED: 'ready', IN_TREATMENT: 'active', COMPLETED: 'done', CANCELLED: 'neutral', ON_HOLD: 'pending' }),
  radiationFraction: fromLabels(RADIATION_FRACTION_STATUS_LABEL, { SCHEDULED: 'pending', DELIVERING: 'active', DELIVERED: 'done', SKIPPED: 'pending', CANCELLED: 'neutral' }),
  // 🔴 AI 제안 — **GENERATED 를 초록으로 칠하지 않는다**(사람이 본 적조차 없는 상태다).
  //    EXPIRED 는 거부가 아니라 무결정이라 중립이다(둘을 같은 색으로 그리면 거부율이 부풀려 보인다).
  aiProposal: fromLabels(AI_PROPOSAL_STATUS_LABEL, { GENERATED: 'pending', PRESENTED: 'active', ACCEPTED: 'done', EDITED: 'ready', REJECTED: 'danger', EXPIRED: 'neutral', SUPERSEDED: 'neutral' }),
  // 기초검사(P2 취소·보류) — 보류는 멈춘 것이지 끝난 것이 아니라 대기색, 취소는 중립
  diagnosticTest: fromLabels(DIAGNOSTIC_TEST_STATUS_LABEL, { ORDERED: 'pending', SCHEDULED: 'ready', IN_PROGRESS: 'active', COMPLETED: 'done', ON_HOLD: 'pending', CANCELLED: 'neutral' }),
  // 인사 신청 — 철회는 거부가 아니라 신청자 취소라 중립(반려와 같은 색이면 반려율이 부풀려 보인다)
  hrRequest: fromLabels(HR_REQUEST_STATUS_LABEL, { REQUESTED: 'pending', APPROVED: 'done', REJECTED: 'danger', WITHDRAWN: 'neutral' }),
  surgery: fromLabels(SURGERY_STATUS_LABEL, { SCHEDULED: 'pending', IN_PROGRESS: 'active', COMPLETED: 'done', CANCELLED: 'neutral' }),
};

export type StatusDomain = keyof typeof DOMAIN_CONFIG;

/* ── Props ───────────────────────────────────────────────────────────────────── */

export interface StatusBadgeProps {
  /** 상태 키 값 */
  status: string;
  /** 도메인 프리셋(shared 라벨 정본 + 색 규약) — 지정 시 config보다 우선 낮음(config로 부분 오버라이드 가능) */
  domain?: StatusDomain;
  /** 사용자 정의 상태 설정 (기본/도메인 설정을 오버라이드) */
  config?: Record<string, { label: string; bg: string; text: string; shape?: StatusShape }>;
  /** 추가 className */
  className?: string;
}

/** 상태 라벨만(인쇄본 등 색 없는 표면) — 배지와 같은 정본 · 모르는 코드는 코드 그대로(지어내지 않는다) */
export function statusLabelOf(status: string, domain?: StatusDomain, config?: Record<string, { label: string }>): string {
  const merged: Record<string, { label: string }> = { ...DEFAULT_CONFIG, ...(domain ? DOMAIN_CONFIG[domain] : {}), ...config };
  return merged[status]?.label || status;
}

/* ── Component ───────────────────────────────────────────────────────────────── */

export default function StatusBadge({ status, domain, config, className = '' }: StatusBadgeProps) {
  const locale = useUiLocale();
  const merged = { ...DEFAULT_CONFIG, ...(domain ? DOMAIN_CONFIG[domain] : {}), ...config };
  const c = merged[status] ?? FALLBACK;
  const displayLabel = c.label || status;

  /* ── UI 크롬 언어(P1-B) — ko 는 종전 렌더와 완전 동일(카탈로그를 보지 않는다).
   *  라벨(한국어 원문)이 있을 때만 조회한다 — 라벨표에 없는 상태 코드(FALLBACK)는
   *  번역 누락이 아니라 모르는 상태값이므로 티를 달지 않고 원문 그대로 둔다.
   *  상태 어휘는 버튼 어휘와 동음이의('취소'=Cancel/Cancelled)라 `@상태` 컨텍스트 키를 먼저 본다.
   *  미등록은 한국어 원문 + EN×/JA×/AR× 티(i18n-text.tsx 의 T 와 같은 규칙),
   *  AI 초안은 `data-i18n-draft` + 툴팁(AI 표기 병기 — AI기본법 §31). */
  let label: React.ReactNode = displayLabel;
  let draftTitle: string | undefined;
  if (locale !== 'ko' && c.label) {
    let r = tOf(`${c.label}@상태`, locale);
    if (r.missing) r = tOf(c.label, locale);
    if (r.missing) {
      label = (
        <>
          {c.label}
          <sup className="ml-0.5 text-[9px] font-semibold text-gray-400">{locale.toUpperCase()}×</sup>
        </>
      );
    } else {
      label = r.text;
      if (r.draft) draftTitle = `${AI_ORIGIN_TEXT} 초안 번역(사람 검수 전) — 원문: ${c.label}`;
    }
  }

  return (
    // whitespace-nowrap: 좁은 셀에서 한글 라벨이 글자 단위로 세로 꺾이는 것 방지(전 화면 공통)
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${c.bg} ${c.text} ${className}`}
      // 🔴 아랍어 표기 — 문자열 안 방향만 잡는다(레이아웃 RTL 과 무관·i18n-text.tsx 헤더 참조).
      //    ko 는 DOM 동일성 규약이라 속성을 붙이지 않는다.
      {...(locale !== 'ko' ? { dir: 'auto' as const } : {})}
      {...(draftTitle ? { 'data-i18n-draft': true, title: draftTitle } : {})}
    >
      {/* 색 외 기호 — `ui.a11y.statusShape` 켜짐일 때만 그려진다(부품이 스스로 게이트) */}
      <StatusShapeMark shape={c.shape} />
      {label}
    </span>
  );
}
