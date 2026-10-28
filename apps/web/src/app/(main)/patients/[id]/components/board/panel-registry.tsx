'use client';

// 패널 레지스트리 — key → { label, suitability, render(ctx) } 단일 소스 (설계 §2)
// 탭마다 prop 계약이 달라(대부분 { patientId }, OverviewTab은 요약 데이터 주입형)
// render(ctx)로 통일. dynamic import로 기존 코드분할(barrel 청크) 재사용(D7).

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import type { EncounterListItem, BillingWithRelations } from '../index';
import type { BoardPanelKey } from './board-constants';

const OverviewTab = dynamic(() => import('../index').then((m) => ({ default: m.OverviewTab })));
const VitalsTab = dynamic(() => import('../index').then((m) => ({ default: m.VitalsTab })));
const LabResultsTab = dynamic(() => import('../index').then((m) => ({ default: m.LabResultsTab })));
const MedicationTab = dynamic(() => import('../index').then((m) => ({ default: m.MedicationTab })));
const ProblemListTab = dynamic(() => import('../index').then((m) => ({ default: m.ProblemListTab })));
const AllergyTab = dynamic(() => import('../index').then((m) => ({ default: m.AllergyTab })));
const OrderTrackingTab = dynamic(() => import('../index').then((m) => ({ default: m.OrderTrackingTab })));
const NursingRecordTab = dynamic(() => import('../index').then((m) => ({ default: m.NursingRecordTab })));
const SurgeryHistoryTab = dynamic(() => import('../index').then((m) => ({ default: m.SurgeryHistoryTab })));
const AdmissionHistoryTab = dynamic(() => import('../index').then((m) => ({ default: m.AdmissionHistoryTab })));
const ReferralTab = dynamic(() => import('../index').then((m) => ({ default: m.ReferralTab })));
const CheckupHistoryTab = dynamic(() => import('../index').then((m) => ({ default: m.CheckupHistoryTab })));
const TherapyHistoryTab = dynamic(() => import('../index').then((m) => ({ default: m.TherapyHistoryTab })));
const TreatmentScheduleTab = dynamic(() => import('../index').then((m) => ({ default: m.TreatmentScheduleTab })));

/** board 패널이 공유하는 컨텍스트 — page.tsx가 이미 조회한 데이터를 주입(재조회 0·§6) */
export interface BoardCtx {
  patientId: string;
  recentEncounters: EncounterListItem[];
  encountersLoading: boolean;
  billings: BillingWithRelations[];
  billingsLoading: boolean;
  totalBillingAmount: number;
  paidBillings: number;
  emptyDraftCount?: number;
  userRole?: string;
  onTabChange: (tab: string) => void;
}

export type PanelSuitability = 'optimal' | 'list' | 'wide' | 'unfit';

interface PanelDef {
  label: string;
  suitability: PanelSuitability;
  render: (ctx: BoardCtx) => ReactNode;
}

export const PANEL_REGISTRY: Record<BoardPanelKey, PanelDef> = {
  overview: {
    label: '요약',
    suitability: 'optimal',
    render: (c) => (
      <OverviewTab
        patientId={c.patientId}
        recentEncounters={c.recentEncounters}
        encountersLoading={c.encountersLoading}
        billings={c.billings}
        billingsLoading={c.billingsLoading}
        totalBillingAmount={c.totalBillingAmount}
        paidBillings={c.paidBillings}
        onTabChange={c.onTabChange}
        userRole={c.userRole}
        emptyDraftCount={c.emptyDraftCount}
      />
    ),
  },
  vitals: { label: '바이탈', suitability: 'optimal', render: (c) => <VitalsTab patientId={c.patientId} /> },
  labresults: { label: '검사결과', suitability: 'optimal', render: (c) => <LabResultsTab patientId={c.patientId} /> },
  // 🔴 `투약@패널` — 맨 `투약` 은 앞 카탈로그에서 'Administered'(투약 완료 상태)다. 패널명은 'Medications'.
  medications: { label: '투약@패널', suitability: 'optimal', render: (c) => <MedicationTab patientId={c.patientId} /> },
  problems: { label: '문제목록', suitability: 'optimal', render: (c) => <ProblemListTab patientId={c.patientId} /> },
  allergies: { label: '알레르기', suitability: 'optimal', render: (c) => <AllergyTab patientId={c.patientId} /> },
  orders: { label: '오더 추적', suitability: 'optimal', render: (c) => <OrderTrackingTab patientId={c.patientId} /> },
  nursing: { label: '간호기록', suitability: 'list', render: (c) => <NursingRecordTab patientId={c.patientId} /> },
  surgeries: { label: '수술 이력', suitability: 'list', render: (c) => <SurgeryHistoryTab patientId={c.patientId} /> },
  admissions: { label: '입퇴원', suitability: 'list', render: (c) => <AdmissionHistoryTab patientId={c.patientId} /> },
  referrals: { label: '의뢰/회신', suitability: 'list', render: (c) => <ReferralTab patientId={c.patientId} /> },
  checkup: { label: '검진 이력', suitability: 'list', render: (c) => <CheckupHistoryTab patientId={c.patientId} /> },
  therapy: { label: '치료 이력', suitability: 'list', render: (c) => <TherapyHistoryTab patientId={c.patientId} /> },
  schedule: { label: '치료일정', suitability: 'list', render: (c) => <TreatmentScheduleTab patientId={c.patientId} /> },
};
