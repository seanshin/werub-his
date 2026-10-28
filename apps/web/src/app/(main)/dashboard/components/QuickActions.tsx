'use client';

import { T } from '@/components/ui/i18n-text';
import { QuickAction, QaPatientIcon, QaScheduleIcon, QaOrderIcon, QaEmergencyIcon, QaBillingIcon, QaPharmacyIcon, QaLabIcon, QaImagingIcon } from './shared';

interface QuickActionsProps {
  role?: string;
}

export default function QuickActions({ role }: QuickActionsProps) {
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {role === 'DOCTOR' && (
          <>
            <QuickAction href="/patients" icon={<QaPatientIcon />} label="환자 조회" color="blue" />
            <QuickAction href="/schedule" icon={<QaScheduleIcon />} label="진료 예약" color="emerald" />
            <QuickAction href="/orders" icon={<QaOrderIcon />} label="오더 확인" color="violet" />
            <QuickAction href="/emergency" icon={<QaEmergencyIcon />} label="응급 접수" color="red" />
          </>
        )}
        {/* 🔴 (2026-10-02) 관리자에게 의사 바로가기(진료 예약·오더 확인·응급 접수)를 주고 있었다 — 관리자 일로 바꾼다 */}
        {role === 'ADMIN' && (
          <>
            <QuickAction href="/billing" icon={<QaBillingIcon />} label="수납" color="amber" />
            <QuickAction href="/admin/decisions" icon={<QaOrderIcon />} label="사람 결정" color="violet" />
            <QuickAction href="/admin/staff-management" icon={<QaPatientIcon />} label="직원 관리" color="blue" />
            <QuickAction href="/admin/sentinel" icon={<QaEmergencyIcon />} label="상시 감시자" color="red" />
          </>
        )}
        {/* 2026-10-02 — 경영진은 종전 공통 최소 링크(알림·내 인사·근무표·설정)만 받았다 */}
        {role === 'EXECUTIVE' && (
          <>
            <QuickAction href="/executive" icon={<QaBillingIcon />} label="경영 대시보드" color="amber" />
            <QuickAction href="/executive/clinical" icon={<QaPatientIcon />} label="의료 품질" color="emerald" />
            <QuickAction href="/executive/finance-benchmark" icon={<QaOrderIcon />} label="경영성과 벤치마크" color="violet" />
            <QuickAction href="/notifications" icon={<QaScheduleIcon />} label="알림" color="blue" />
          </>
        )}
        {role === 'NURSE' && (
          <>
            <QuickAction href="/patients" icon={<QaPatientIcon />} label="환자 조회" color="blue" />
            <QuickAction href="/schedule" icon={<QaScheduleIcon />} label="예약 확인" color="emerald" />
            <QuickAction href="/inpatient" icon={<QaPatientIcon />} label="입원 환자" color="violet" />
            <QuickAction href="/beds" icon={<QaBillingIcon />} label="병상 현황" color="amber" />
          </>
        )}
        {role === 'PHARMACIST' && (
          <>
            <QuickAction href="/pharmacy" icon={<QaPharmacyIcon />} label="조제 대기" color="teal" />
            <QuickAction href="/orders" icon={<QaOrderIcon />} label="오더 확인" color="violet" />
            <QuickAction href="/inventory" icon={<QaBillingIcon />} label="재고 관리" color="amber" />
            <QuickAction href="/patients" icon={<QaPatientIcon />} label="환자 조회" color="blue" />
          </>
        )}
        {role === 'LAB_TECH' && (
          <>
            <QuickAction href="/lab" icon={<QaLabIcon />} label="검사 대기" color="indigo" />
            <QuickAction href="/imaging" icon={<QaImagingIcon />} label="영상 판독" color="pink" />
            <QuickAction href="/orders" icon={<QaOrderIcon />} label="오더 확인" color="violet" />
            <QuickAction href="/patients" icon={<QaPatientIcon />} label="환자 조회" color="blue" />
          </>
        )}
        {role === 'RECEPTIONIST' && (
          <>
            <QuickAction href="/reception" icon={<QaScheduleIcon />} label="접수" color="emerald" />
            <QuickAction href="/clinic-queue" icon={<QaPatientIcon />} label="진료실 대기" color="blue" />
            <QuickAction href="/schedule" icon={<QaScheduleIcon />} label="예약" color="violet" />
            <QuickAction href="/billing" icon={<QaBillingIcon />} label="수납" color="amber" />
          </>
        )}
        {(role === 'CRM_MANAGER' || role === 'CRM_STAFF') && (
          <>
            <QuickAction href="/crm" icon={<QaPatientIcon />} label="고객 관리" color="blue" />
            <QuickAction href="/consult" icon={<QaScheduleIcon />} label="상담 데스크" color="emerald" />
            <QuickAction href="/satisfaction" icon={<QaBillingIcon />} label="만족도" color="amber" />
            <QuickAction href="/notifications" icon={<QaOrderIcon />} label="알림" color="violet" />
          </>
        )}
        {/* 분기 없는 역할(급양·행정·의무기록·검진 등)도 빈 카드는 안 된다(P9) — 공통 최소 링크 */}
        {!['DOCTOR', 'ADMIN', 'EXECUTIVE', 'NURSE', 'PHARMACIST', 'LAB_TECH', 'RECEPTIONIST', 'CRM_MANAGER', 'CRM_STAFF'].includes(role ?? '') && (
          <>
            <QuickAction href="/notifications" icon={<QaOrderIcon />} label="알림" color="violet" />
            <QuickAction href="/ess" icon={<QaPatientIcon />} label="내 인사(ESS)" color="blue" />
            <QuickAction href="/duty-schedule" icon={<QaScheduleIcon />} label="근무표" color="emerald" />
            <QuickAction href="/settings" icon={<QaBillingIcon />} label="설정" color="amber" />
          </>
        )}
      </div>
    </div>
  );
}
