'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { APPOINTMENT_STATUS_LABEL, BILLING_STATUS_PATIENT_LABEL } from '@hospital-run/shared';
import { PT } from './PT';

// ── Icon ──
export function Icon({ d, cls }: { d: string; cls?: string }) {
  return (
    <svg className={cls ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

// ── StatusBadge ──
/**
 * 🔴 (2026-10-19 포털 세련화 A2) 라벨은 shared 정본 — 예약 `APPOINTMENT_STATUS_LABEL` · 수납 환자 관점 `BILLING_STATUS_PATIENT_LABEL`.
 *    종전엔 이 파일이 자기 표(7개)를 들고 있어 접수·진료중·미내원·후납·분할납·환불을 몰랐고, 모르는 상태는 **영문 코드**(`CHECKED_IN`)를
 *    환자에게 그대로 보였다. 환자 화면에는 코드를 보이지 않는다 — 정본에 없는 상태는 "상태 확인 필요"(코드는 title 로만).
 */
const STATUS_TONE: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700', CONFIRMED: 'bg-emerald-100 text-emerald-700', CHECKED_IN: 'bg-indigo-100 text-indigo-700',
  IN_PROGRESS: 'bg-indigo-100 text-indigo-700', COMPLETED: 'bg-gray-100 text-gray-600', CANCELLED: 'bg-red-100 text-red-600', NO_SHOW: 'bg-gray-100 text-gray-500',
  PAID: 'bg-emerald-100 text-emerald-700', PENDING: 'bg-amber-100 text-amber-700', PARTIAL: 'bg-amber-100 text-amber-700',
  DEFERRED: 'bg-amber-100 text-amber-700', INSTALLMENT: 'bg-amber-100 text-amber-700', REFUNDED: 'bg-gray-100 text-gray-600',
};
export function StatusBadge({ status, domain }: { status: string; domain: 'appointment' | 'billing' }) {
  const label = (domain === 'appointment' ? APPOINTMENT_STATUS_LABEL : BILLING_STATUS_PATIENT_LABEL)[status] ?? '상태 확인 필요';
  const cls = STATUS_TONE[status] ?? 'bg-gray-100 text-gray-600';
  return <span title={status} data-status={status} className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}><PT k={label} /></span>;
}

// ── AnimatedTab (탭 전환 애니메이션 래퍼) ──
export function AnimatedTab({ tabKey, children }: { tabKey: string; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={tabKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// ── NotificationBadge (탭 알림 배지) ──
export function NotificationBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * ── EmptyState (UX 개선: 일러스트 + CTA + 페이드인) ──
 *
 * 🔴 **이 부품은 번역 조회를 하나도 지나지 않고 있었다**(2026-09-12 실측). 호출부가 `title` 만
 *    `usePortalTAttr()` 로 번역해 넘겼고, `description`·`actionLabel` 은 **생 한국어 18건**이
 *    어떤 언어에서도 그대로 나갔다 — 검사 결과·검진 비교·알림·원격진료 안내처럼 전부 환자가
 *    읽는 문구다. 그리고 그 사실은 **어디에도 드러나지 않았다**(`<PT>` 를 만든 이유 그대로 —
 *    `portal-i18n.ts` 헤더: "번역 누락이 영원히 드러나지 않았다").
 *
 * 계약: **문자열 = 카탈로그 키**(`<PT>` 가 조회하고 미등록이면 `EN×`/`ZH×`/`JA×` 티) ·
 *       **노드 = 그대로**(서버가 만든 문장은 호출부가 노드로 감싸 넘긴다).
 *       `tAttr()` 로 이미 번역해 넘기는 종전 호출부도 그대로 동작한다(번역문에는 한글이 없어 티가 붙지 않는다).
 */
export function EmptyState({ icon, title, description, actionLabel, onAction }: {
  icon?: string; title: React.ReactNode; description?: React.ReactNode; actionLabel?: React.ReactNode; onAction?: () => void;
}) {
  const asText = (v: React.ReactNode) => (typeof v === 'string' ? <PT k={v} /> : v);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="bg-white rounded-2xl border border-gray-100 p-8 text-center"
    >
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <p className="text-sm font-medium text-gray-700">{asText(title)}</p>
      {description && <p className="text-xs text-gray-400 mt-1">{asText(description)}</p>}
      {actionLabel && onAction && (
        <button onClick={onAction}
          className="mt-4 px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-xl hover:bg-blue-700 transition-colors active:scale-[0.98]">
          {asText(actionLabel)}
        </button>
      )}
    </motion.div>
  );
}

// ── SkeletonCard (UX 개선: 로딩 스켈레톤) ──
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse">
      <div className="h-3 bg-gray-200 rounded-full w-1/3 mb-3" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-2.5 bg-gray-100 rounded-full mb-2 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

// ── InfoRow ──
export function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-sm"><span className="text-gray-500">{label}</span><span className="text-gray-900 font-medium">{value}</span></div>;
}

// ── Row ──
export function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className="flex justify-between"><span className="text-gray-500">{label}</span><span className={bold ? 'font-semibold text-gray-900' : 'text-gray-700'}>{value}</span></div>;
}

// ── SegmentControl (서브 세그먼트 UI + animated indicator) ──
export function SegmentControl<T extends string>({ segments, active, onChange }: {
  segments: { key: T; label: string }[]; active: T; onChange: (key: T) => void;
}) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-xl p-1 relative">
      {segments.map(s => (
        <button key={s.key} onClick={() => onChange(s.key)}
          className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors relative z-10 ${
            active === s.key ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}>
          {s.label}
          {active === s.key && (
            <motion.div
              layoutId="segment-indicator"
              className="absolute inset-0 bg-white rounded-lg shadow-sm -z-10"
              transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
