'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { T, useTAttr } from '@/components/ui/i18n-text';

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: '관리자', DOCTOR: '의사', NURSE: '간호사', PHARMACIST: '약사', LAB_TECH: '검사실',
};

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500"><T k={label} /></span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  );
}

/**
 * 지표 칩 — 표면은 하나로 통일하고 **색은 의미(주의가 필요한 값)에만** 쓴다.
 *
 * 🔴 종전엔 지표마다 배경색이 달라(파랑·보라·초록·노랑·빨강) 띠 전체가 알록달록했고,
 *    'gray' 만 사실상 배경이 없어 마지막 칩이 혼자 떠 보였다(2026-08-03 피드백).
 *    색이 전부 다르면 **어느 값이 급한지 색으로 읽을 수 없다** — 색의 정보량이 0이 된다.
 *    그래서 표면은 흰 카드 하나로 맞추고, 주의(amber)·위험(rose)만 숫자 색과 좌측 띠로 구분한다.
 */
const STAT_TONE: Record<string, { value: string; accent: string; chip: string }> = {
  amber: { value: 'text-amber-600', accent: 'border-l-2 border-l-amber-400', chip: 'bg-amber-50 text-amber-600' },
  rose: { value: 'text-rose-600', accent: 'border-l-2 border-l-rose-400', chip: 'bg-rose-50 text-rose-600' },
};
const STAT_NEUTRAL = { value: 'text-slate-900', accent: '', chip: 'bg-slate-100 text-slate-500' };

export function MiniStat({ label, value, color, href, icon: Icon }: { label: string; value: number | string; color: string; href?: string; icon?: LucideIcon }) {
  const tt = useTAttr();
  const tone = STAT_TONE[color] ?? STAT_NEUTRAL;
  const inner = (
    <>
      <div className="flex items-center gap-1.5">
        {Icon && (
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${tone.chip}`} aria-hidden>
            <Icon className="h-3 w-3" strokeWidth={2.2} />
          </span>
        )}
        {/* 🔴 `truncate` 는 좁은 칸에서 **라벨을 조용히 지운다**. 자르면 잘랐다고 말해야 하는데
            라벨은 그럴 자리가 없다 — 그래서 자르지 않고 접는다(그리드가 최소 폭을 지킨다). */}
        <p className="text-[11px] font-medium leading-tight text-slate-500" title={tt(label)}><T k={label} /></p>
      </div>
      {/* tabular-nums: 자릿수가 달라도 숫자 기준선이 흔들리지 않는다(띠가 정돈돼 보이는 핵심)
          🔴 값이 없으면 '-' — 0 으로 채우지 않는다(모르는 것을 0 이라 말하지 않는다) */}
      <p className={`mt-1.5 text-[22px] font-bold leading-none tracking-tight tabular-nums ${tone.value}`}>{value ?? '-'}</p>
    </>
  );
  // 🔴 같은 줄에서 라벨 줄 수가 갈리면 카드 높이가 어긋난다 — 남는 높이는 위아래로 나눈다
  const cls = `flex flex-col justify-center rounded-2xl border border-slate-200/70 ${tone.accent} bg-white px-4 py-3 min-w-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]`;
  if (href) {
    return (
      <Link href={href} className={`${cls} transition-[border-color,box-shadow] hover:border-slate-300 hover:shadow-[0_4px_14px_-6px_rgba(15,23,42,0.12)]`}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export function StatCard({ title, value, sub, icon, color }: { title: string; value: string; sub: string; icon: React.ReactNode; color: string }) {
  const colors: Record<string, { bg: string; icon: string; text: string }> = {
    blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    text: 'text-blue-600' },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', text: 'text-emerald-600' },
    violet:  { bg: 'bg-violet-50',  icon: 'text-violet-600',  text: 'text-violet-600' },
    amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   text: 'text-amber-600' },
    rose:    { bg: 'bg-rose-50',    icon: 'text-rose-600',    text: 'text-rose-600' },
  };
  const c = colors[color] ?? colors.blue;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 ${c.bg} rounded-xl flex items-center justify-center`}>
          <div className={c.icon}>{icon}</div>
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs font-medium text-gray-900 mt-0.5"><T k={title} /></p>
      <p className="text-[11px] text-gray-400 mt-0.5"><T k={sub} /></p>
    </div>
  );
}

export function QuickAction({ href, icon, label, color }: { href: string; icon: React.ReactNode; label: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 group-hover:bg-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100',
    violet: 'bg-violet-50 text-violet-600 group-hover:bg-violet-100',
    amber: 'bg-amber-50 text-amber-600 group-hover:bg-amber-100',
    teal: 'bg-teal-50 text-teal-600 group-hover:bg-teal-100',
    indigo: 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100',
    pink: 'bg-pink-50 text-pink-600 group-hover:bg-pink-100',
    red: 'bg-red-50 text-red-600 group-hover:bg-red-100',
  };

  return (
    <Link href={href} className="group flex flex-col items-center gap-2 p-4 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${colors[color]}`}>
        {icon}
      </div>
      <span className="text-xs font-medium text-gray-700 group-hover:text-gray-900"><T k={label} /></span>
    </Link>
  );
}

// --- Stat Icons ---
export function PatientStatIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>;
}
export function CalendarStatIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>;
}
export function ActivityStatIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>;
}
export function BillingStatIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
export function OrderStatIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>;
}

// --- Quick Action Icons ---
export function QaPatientIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" /></svg>;
}
export function QaScheduleIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
export function QaOrderIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>;
}
export function QaBillingIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>;
}
export function QaPharmacyIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-1.756 4.39A2.25 2.25 0 0115.146 21H8.854a2.25 2.25 0 01-2.098-1.61L5 14.5m14 0H5" /></svg>;
}
export function QaLabIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>;
}
export function QaImagingIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>;
}
export function QaEmergencyIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>;
}
