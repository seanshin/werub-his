'use client';

import Link from 'next/link';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 역할별 사용 매뉴얼 목적지(권한에 맞춰 본인 매뉴얼로 이동). 미지정 역할은 통합 허브.
 *
 * 🔴 UserRole 이 늘어나면 **여기도 같이 늘려야 한다.** v3.96 에서 지원부서 역할 4종이 신설됐는데
 *    이 표가 그대로여서 급양·총무·의무기록·검진 담당이 자기 매뉴얼 대신 통합 허브로 떨어졌고,
 *    원무를 NURSE→RECEPTIONIST 로 재배정한 뒤에는 **원무 직원이 원무 매뉴얼에 닿지 못했다**
 *    (원무 매핑이 CRM_STAFF 에만 걸려 있었다).
 */
export const MANUAL_BY_ROLE: Record<string, { href: string; label: string }> = {
  DOCTOR: { href: '/custom/guide-doctor', label: '의사 진료 매뉴얼' },
  NURSE: { href: '/custom/guide-nurse', label: '간호 매뉴얼' },
  PHARMACIST: { href: '/custom/guide-support', label: '진료지원 매뉴얼' },
  LAB_TECH: { href: '/custom/guide-support', label: '진료지원 매뉴얼' },
  RECEPTIONIST: { href: '/custom/manual', label: '원무 업무 매뉴얼' },
  CRM_STAFF: { href: '/custom/manual', label: '원무 업무 매뉴얼' },
  NUTRITION: { href: '/custom/guide-nutrition', label: '급양·영양 매뉴얼' },
  ADMIN_STAFF: { href: '/custom/guide-admin-staff', label: '총무·자재 매뉴얼' },
  MEDICAL_RECORDS: { href: '/custom/guide-records', label: '의무기록 매뉴얼' },
  CHECKUP: { href: '/custom/guide-checkup', label: '건강검진 매뉴얼' },
};

// 사이드바 좌측 하단(ERP 메뉴 위) 사용 매뉴얼 바로가기.
export function ManualLink({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const m = MANUAL_BY_ROLE[role] ?? { href: '/custom/guide', label: '사용 매뉴얼' };
  // 🔴 라벨 데이터(MANUAL_BY_ROLE)는 한국어 정본 그대로 — 조회는 렌더 지점에서만 한다
  const tAttr = useTAttr();
  return (
    <Link
      href={m.href}
      onClick={onNavigate}
      title={`${tAttr(m.label)} ${tAttr('열기')}`}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-700/70 transition-colors mb-2"
    >
      <span aria-hidden="true">📘</span>
      <T k={m.label} className="flex-1 text-left" />
    </Link>
  );
}
