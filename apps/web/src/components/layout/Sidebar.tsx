'use client';

import { Activity, BrainCircuit, Building2, ChevronsLeft, ChevronsRight, HeartPulse, Settings2, ShieldCheck, Stethoscope, UserRound, Users } from 'lucide-react';
import { HIS_VERSION, AI_ORIGIN_TEXT } from '@hospital-run/shared';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { canUseAiChat } from '@/stores/ai-chat-store';
import { apiClient } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { SCREEN_CODE_FROZEN } from './screen-codes.frozen';
import { ErpLauncher } from './ErpLauncher';
import { EduLauncher } from './EduLauncher';
import { ManualLink } from './ManualLink';
import { CHART_ACCESS_ROLES, CHART_CLINICAL_ROLES, TRANSFER_ACCESS_ROLES } from '@hospital-run/shared';

// Roles: A=Admin, D=Doctor, N=Nurse, P=Pharmacist, L=LabTech, *=All
type R = string[];
const ALL: R = ['ADMIN','DOCTOR','NURSE','PHARMACIST','LAB_TECH','NUTRITION','RECEPTIONIST','ADMIN_STAFF','MEDICAL_RECORDS','EXECUTIVE','CHECKUP']; // 전직원 공통(대시보드·교육·식단·개인설정) — 임상+지원 전 직군
// 🔴 ALL 에 READ(조회전용)·CRM 2종이 없어, READ 계정은 nav 가 통째로 비어 "접근 가능한 화면 0개" 였다.
//    다만 READ 를 ALL 에 통째로 넣으면 반대로 dead-menu 가 된다(API 는 24곳만 READ 허용) →
//    **API 가 실제로 READ 를 받는 화면에만** 명시 추가한다.
const ALL_WITH_READ: R = [...ALL, 'READ'];                       // ess.controller 가 받는 12역할과 동일
const EVERY_ROLE: R = [...ALL, 'READ', 'CRM_MANAGER', 'CRM_STAFF']; // 서버 호출이 없는 순수 FE 화면용
const CLINICAL: R = ['ADMIN','DOCTOR','NURSE'];
/**
 * 🔴 환자안전사고 보고는 **전 직군의 일**이다(환자안전법 §14 — 보건의료인·환자 등 누구나 보고).
 *    종전 `/safety` 가 CLINICAL(의사·간호사·관리자) 이라, 투약오류를 다루는 약사와
 *    검체라벨 오류를 다루는 검사기사가 **자기 직군 사고를 신고할 화면이 없었다**
 *    (운영 75건의 보고자가 전건 NURSE 인 이유). API 도 같은 날 함께 열었다
 *    (`safety:incident:report`) — nav 만 여는 것은 dead-menu 이고, nav 만 숨기는 것은 권한 회수가 아니다.
 *    화면은 권한에 따라 탭을 접는다: 전담인력이 아니면 '사고 보고'와 '본인 보고 목록'만 보인다.
 */
const SAFETY_REPORTERS: R = [...ALL, 'CRM_MANAGER', 'CRM_STAFF']; // API `safety:incident:report` 보유 13역할과 동일 집합(READ 제외)
const ADMIN_ONLY: R = ['ADMIN'];
/**
 * 병원 안내(공개 홈페이지 성격의 소개·소식·채용) — 환자 응대 직군이 쓰는 화면이다(2026-09-30 의사 메뉴 정리).
 * 의사 메뉴에서만 뺀다(진료와 무관한 6개). nav 숨김≠권한 회수 — 화면은 그대로 열리고, 관리자 메뉴 구성에서 되살릴 수 있다.
 */
// 리터럴로 적는다(역할 스캐너가 전개식만 푼다) — ALL 에서 DOCTOR 만 뺀 집합과 같은지는 테스트가 기계 대조한다
const GUIDE_VIEWERS: R = ['ADMIN','NURSE','PHARMACIST','LAB_TECH','NUTRITION','RECEPTIONIST','ADMIN_STAFF','MEDICAL_RECORDS','EXECUTIVE','CHECKUP'];
const DOCTOR_ADMIN: R = ['ADMIN','DOCTOR'];

export const NAV_SECTIONS = [
  { title: '외래', items: [
    { href: '/command-center', label: '통합 상황판', icon: DashboardIcon, roles: ['ADMIN', 'NURSE', 'DOCTOR', 'PHARMACIST', 'LAB_TECH'] },
    { href: '/dashboard', label: '대시보드', icon: DashboardIcon, roles: ALL },
    { href: '/reception', label: '접수', icon: ReceptionIcon, roles: ['ADMIN','NURSE','RECEPTIONIST'] },
    { href: '/clinic-queue', label: '진료실 대기', icon: ReceptionIcon, roles: [...CLINICAL,'RECEPTIONIST'] },
    { href: '/patients', label: '환자 관리', icon: PatientsIcon, roles: [...CHART_ACCESS_ROLES] as R }, // 🔴 의무기록·의료차트 — 정본 하나(shared). 종전엔 원무·검진까지 열고 API 는 막아 자기 계정이 고장난 것으로 읽혔다
    { href: '/patients/register/foreign', label: '외국인 환자 등록', icon: PatientsIcon, roles: ['ADMIN', 'NURSE'] },
    { href: '/patients/register/emergency', label: '응급 미확인 등록', icon: PatientsIcon, roles: ['ADMIN', 'NURSE', 'DOCTOR'] },
    { href: '/schedule', label: '예약', icon: ScheduleIcon, roles: [...CLINICAL,'RECEPTIONIST'] },
    // 🔴 (2026-09-29) 화면(canEnterOrder)은 LAB_TECH 입력을 여는데 메뉴에 없어 의료기사(임상병리·방사선·치료사)가 찾아올 길이 없었다.
    //    입력 범위는 직종이 정한다(shared order-entry-scope) — 메뉴는 여는 것까지만
    { href: '/orders', label: '처방(CPOE)', icon: OrdersIcon, roles: [...CLINICAL, 'LAB_TECH'] },
    // 🔴 (2026-10-07) 의사의 줄어드는 목록 넷(결과 확인·구두 처방 확인·갱신 대기·약사 회신)이 메뉴 넷에 흩어져 있었다 →
    //    할 일함 하나에서 센다(각 목록은 그 화면 컴포넌트 그대로 · 개별 경로는 OFF_NAV 로 남아 알림·위젯 링크가 산다)
    { href: '/doctor-inbox', label: '의사 할 일함', icon: OrdersIcon, roles: DOCTOR_ADMIN },
  ]},
  { title: '간호', items: [
    { href: '/nurse-station', label: '간호 워크스테이션', icon: NursingIcon, roles: ['ADMIN', 'NURSE'] },
    { href: '/nursing-station', label: '간호 스테이션 보드', icon: NursingIcon, roles: ['ADMIN', 'NURSE', 'DOCTOR'] },
    { href: '/nurse-station/imaging', label: '환자 영상 조회', icon: ImagingIcon, roles: ['ADMIN', 'NURSE', 'DOCTOR'] },
    // 2026-10-10 — 분만 보드·격리 감시 API 는 간호사에게 열려 있었는데 화면은 의사 전문과 메뉴(간호사에게 숨김) 안에만 있었다
    { href: '/nurse-station/delivery-board', label: '분만 현황', icon: NursingIcon, roles: ['ADMIN', 'NURSE'] },
    { href: '/nurse-station/seclusion', label: '격리·강박 감시', icon: NursingIcon, roles: ['ADMIN', 'NURSE'] },
  ]},
  { title: '진료 지원', items: [
    { href: '/pharmacy', label: '약국', icon: PharmacyIcon, roles: ['ADMIN','PHARMACIST'] },
    { href: '/pharmacy-board', label: '약국 보드', icon: PharmacyIcon, roles: ['ADMIN','PHARMACIST'] },
    { href: '/pharmacist-activity', label: '약사 임상활동', icon: PharmacyIcon, roles: ['ADMIN', 'PHARMACIST'] },
    { href: '/lab', label: '검사실', icon: LabIcon, roles: ['ADMIN','LAB_TECH'] },
    { href: '/imaging', label: '영상실', icon: ImagingIcon, roles: ['ADMIN','LAB_TECH','DOCTOR'] },
    { href: '/pathology', label: '병리과', icon: DiagnosticsIcon, roles: ['ADMIN','LAB_TECH','DOCTOR'] },
    { href: '/diagnostics', label: '기초검사', icon: DiagnosticsIcon, roles: CLINICAL },
    { href: '/blood-bank', label: '혈액은행', icon: LabIcon, roles: ['ADMIN','LAB_TECH','DOCTOR','NURSE'] },
    { href: '/telehealth', label: '화상진료', icon: ImagingIcon, roles: ['ADMIN','DOCTOR','NURSE'] },
    { href: '/remote-consult', label: '비대면진료', icon: ImagingIcon, roles: ['ADMIN','DOCTOR','NURSE'] },
    { href: '/chronic', label: '만성질환 관리', icon: DiagnosticsIcon, roles: CLINICAL },
    { href: '/clinical-tools', label: '임상 도구(점수·계산)', icon: DiagnosticsIcon, roles: CLINICAL },
    { href: '/diagnostics-board', label: '검사·영상 보드', icon: LabIcon, roles: ['ADMIN', 'LAB_TECH', 'DOCTOR', 'NURSE'] },
    { href: '/pacs-portal', label: 'PACS 주치의 포털', icon: ImagingIcon, roles: DOCTOR_ADMIN },
  ]},
  { title: '수술/중환자', items: [
    { href: '/surgery', label: '수술', icon: SurgeryIcon, roles: DOCTOR_ADMIN },
    { href: '/pacu', label: '회복실(PACU)', icon: IcuIcon, roles: CLINICAL },
    { href: '/emergency', label: '응급실', icon: EmergencyIcon, roles: CLINICAL },
    { href: '/emergency-board', label: '응급실 보드', icon: EmergencyIcon, roles: CLINICAL },
    { href: '/icu', label: '중환자실', icon: IcuIcon, roles: CLINICAL },
    // 심정지·RRT 경과 기록 — 호출·알림은 스태프콜(CODE)이 담당, 여기는 기록·통계 (gap-remediation R4)
    { href: '/code-blue', label: 'Code Blue / RRT', icon: EmergencyIcon, roles: CLINICAL },
  ]},
  { title: '전문 진료', items: [
    { href: '/internal-medicine', label: '내과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/orthopedics', label: '정형외과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/neurosurgery', label: '신경외과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/obgyn', label: '산부인과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/pediatrics', label: '소아청소년과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/psychiatry', label: '정신과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/ophthalmology', label: '안과', icon: ImagingIcon, roles: DOCTOR_ADMIN },
    { href: '/ent', label: '이비인후과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/dermatology', label: '피부과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/dental', label: '치과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/plastic', label: '성형외과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/urology', label: '비뇨의학과', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
  ]},
  { title: '특수 치료', items: [
    { href: '/rehab', label: '재활의학', icon: DiagnosticsIcon, roles: CLINICAL },
    { href: '/radiation', label: '방사선종양', icon: ImagingIcon, roles: DOCTOR_ADMIN },
    { href: '/chemo', label: '항암 치료(사이클)', icon: LabIcon, roles: ['ADMIN','DOCTOR','NURSE','PHARMACIST'] },
    { href: '/dialysis', label: '투석실', icon: LabIcon, roles: CLINICAL },
    { href: '/transplant', label: '장기이식', icon: SurgeryIcon, roles: DOCTOR_ADMIN },
  ]},
  { title: '의료 질/연구', items: [
    { href: '/clinical-pathway', label: '임상경로', icon: OrdersIcon, roles: DOCTOR_ADMIN },
    { href: '/mdt', label: '다학제진료(MDT)', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/cancer-registry', label: '암 등록', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/research', label: '임상 연구(IRB)', icon: DiagnosticsIcon, roles: DOCTOR_ADMIN },
    { href: '/omop-cdm', label: 'OMOP CDM', icon: DiagnosticsIcon, roles: ADMIN_ONLY },
    { href: '/duty-schedule', label: '당직/근무', icon: ScheduleIcon, roles: DOCTOR_ADMIN },
  ]},
  { title: '워크스테이션', items: [
    { href: '/workstation/front-desk', label: '접수 워크스테이션', icon: ReceptionIcon, roles: ['ADMIN','NURSE'] },
    { href: '/workstation', label: '워크스테이션', icon: DiagnosticsIcon, roles: ['ADMIN','LAB_TECH','NURSE'] },
    { href: '/workstation/lab', label: '검사실', icon: LabIcon, roles: ['ADMIN','LAB_TECH'] },
    { href: '/workstation/imaging', label: '영상실', icon: ImagingIcon, roles: ['ADMIN','LAB_TECH'] },
    { href: '/workstation/diagnostic', label: '기초검사', icon: DiagnosticsIcon, roles: ['ADMIN','NURSE','LAB_TECH'] },
    { href: '/workstation/reading', label: '판독 대기', icon: OrdersIcon, roles: DOCTOR_ADMIN },
    { href: '/workstation/therapy', label: '치료실', icon: DiagnosticsIcon, roles: ['ADMIN','NURSE','LAB_TECH'] },
    { href: '/workstation/templates', label: '검사항목 관리', icon: FormIcon, roles: ['ADMIN','LAB_TECH','NURSE'] },
    { href: '/workstation/pharmacy', label: '약국', icon: PharmacyIcon, roles: ['ADMIN','PHARMACIST'] },
    { href: '/workstation/nursing', label: '간호(입원)', icon: NursingIcon, roles: ['ADMIN','NURSE'] },
    { href: '/workstation/outpatient-nursing', label: '간호(외래)', icon: NursingIcon, roles: ['ADMIN','NURSE'] },
    { href: '/workstation/reception', label: '접수', icon: ReceptionIcon, roles: ['ADMIN','NURSE'] },
    { href: '/workstation/consent', label: '동의서', icon: FormIcon, roles: CLINICAL },
    { href: '/workstation/documents', label: '서류 발급', icon: FormIcon, roles: ['ADMIN','NURSE','RECEPTIONIST','MEDICAL_RECORDS'] }, // 원무는 접수·대기 목록만(2026-10-10) · 🔴 의무기록사는 서버가 처리 전 단계를 허용하는데 메뉴에 없었다(2026-10-10)
    { href: '/workstation/certificates', label: '진단서 발급', icon: FormIcon, roles: ['ADMIN','DOCTOR'] },
    { href: '/workstation/discharge', label: '퇴원', icon: InpatientIcon, roles: CLINICAL },
    { href: '/workstation/admission', label: '입원', icon: InpatientIcon, roles: CLINICAL },
    { href: '/workstation/surgery-prep', label: '수술 준비', icon: SurgeryIcon, roles: DOCTOR_ADMIN },
    { href: '/workstation/post-op', label: '수술 후 회복', icon: SurgeryIcon, roles: CLINICAL },
    { href: '/workstation/icu', label: '중환자실', icon: IcuIcon, roles: CLINICAL },
    { href: '/workstation/attending', label: '주치의', icon: OrdersIcon, roles: DOCTOR_ADMIN },
    { href: '/workstation/emergency', label: '응급실', icon: EmergencyIcon, roles: CLINICAL },
    { href: '/workstation/blood-bank', label: '혈액은행', icon: LabIcon, roles: ['ADMIN','LAB_TECH','NURSE'] },
    { href: '/workstation/nutrition', label: '영양', icon: NutritionIcon, roles: ['ADMIN','NURSE','NUTRITION'] },
    { href: '/workstation/equipment', label: '장비', icon: EquipmentIcon, roles: ADMIN_ONLY },
    { href: '/workstation/cssd', label: '중앙공급', icon: CssdIcon, roles: ADMIN_ONLY },
    { href: '/workstation/infection-control', label: '감염관리', icon: InfectionIcon, roles: CLINICAL },
    { href: '/workstation/rehab-station', label: '재활', icon: DiagnosticsIcon, roles: CLINICAL },
  ]},
  { title: '클리닉 센터', items: [
    { href: '/his-checkup', label: '건강검진센터', icon: DiagnosticsIcon, roles: [...CLINICAL,'CHECKUP'] },
    { href: '/his-checkup/reception', label: '검진 접수', icon: ReceptionIcon, roles: ['ADMIN','NURSE','CHECKUP'] },
    { href: '/his-checkup/waiting', label: '검진 대기', icon: ReceptionIcon, roles: [...CLINICAL,'CHECKUP'] },
    { href: '/his-checkup/ws', label: '검사실 허브', icon: DiagnosticsIcon, roles: ['ADMIN','NURSE','LAB_TECH'] },
    { href: '/his-checkup/flow-board', label: '동선 현황판', icon: ReceptionIcon, roles: [...CLINICAL,'CHECKUP'] },
    { href: '/patient-flow', label: '동선 모니터(QR)', icon: ReceptionIcon, roles: [...CLINICAL,'CHECKUP'] },
    { href: '/display/checkup', label: '대기 디스플레이', icon: ReceptionIcon, roles: [...CLINICAL,'CHECKUP'] },
    { href: '/his-checkup/station', label: '검진 스테이션', icon: ReceptionIcon, roles: CLINICAL },
    /**
     * 🔴 이 둘은 **마스터·CMS 편집 화면**이고 서버는 `SYSTEM_MANAGE` 를 요구한다.
     *    권한 정본이 이미 못박아 뒀다 — `CHECKUP_MANAGE` = "검진 방문 생애주기·문진 응답·추적관리·단체계약
     *    (**임상 입력·마스터 관리는 제외**)". nav 가 그 정본과 어긋나 있어서 검진 데스크는
     *    열자마자 CMS 조회 403, 저장·삭제도 전부 403 이었다(운영 실측 `GET /hospital-info` 403).
     *    **여는 것이 답이 아니다** — 권한 없는 사람에게 띄우고 403 을 맞게 하지 않는다(dead-menu 금지).
     */
    { href: '/his-checkup/questionnaires', label: '문진표 관리', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/his-checkup/programs', label: '검진 프로그램', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/his-checkup/test-catalog', label: '검사항목 관리', icon: DiagnosticsIcon, roles: ADMIN_ONLY },
    { href: '/his-checkup/protocols', label: '검진 프로토콜', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/his-checkup/schedule', label: '검진 예약', icon: ScheduleIcon, roles: [...CLINICAL,'CHECKUP'] },
    { href: '/his-checkup/review', label: '소견 대기', icon: OrdersIcon, roles: DOCTOR_ADMIN },
    { href: '/his-checkup/contracts', label: '단체 검진', icon: HrIcon, roles: ['ADMIN','CHECKUP'] },
    { href: '/his-checkup/follow-ups', label: '추적 관리', icon: SafetyIcon, roles: [...CLINICAL,'CHECKUP'] },
    { href: '/his-checkup/stats', label: '검진 통계', icon: QualityIcon, roles: [...DOCTOR_ADMIN,'CHECKUP'] },
  ]},
  { title: '입원', items: [
    { href: '/inpatient', label: '입원 환자', icon: InpatientIcon, roles: CLINICAL },
    { href: '/rounds', label: '회진', icon: RoundIcon, roles: DOCTOR_ADMIN },
    { href: '/handoffs', label: '인수인계', icon: HandoffIcon, roles: DOCTOR_ADMIN },
    { href: '/beds', label: '병상 현황', icon: BedIcon, roles: CLINICAL },
    { href: '/bed-board', label: '병상·입원 보드', icon: BedIcon, roles: CLINICAL },
    // 병동 간 전동 요청·수락(2026-09-30) — 받는 병동이 병상을 골라 수락하면 그때 옮긴다 · 서버 @Roles NURSE·DOCTOR·ADMIN(수락·거절은 NURSE·ADMIN)
    { href: '/bed-transfers', label: '병동 간 전동', icon: BedIcon, roles: CLINICAL },
    { href: '/nutrition', label: '급식', icon: NutritionIcon, roles: ['ADMIN','NURSE','NUTRITION'] },
  ]},
  { title: '의무기록', items: [
    { href: '/consent', label: '동의서', icon: FormIcon, roles: CLINICAL },
    { href: '/medical-records/search', label: '기록 검색', icon: OrdersIcon, roles: [...DOCTOR_ADMIN,'MEDICAL_RECORDS'] },
    { href: '/medical-records/copy', label: '사본 발급', icon: BillingIcon, roles: ['ADMIN','MEDICAL_RECORDS'] },
  ]},
  { title: '협진/의뢰', items: [
    { href: '/consultations', label: '협진 의뢰', icon: OrdersIcon, roles: CLINICAL },
    { href: '/consultations/letters', label: '의뢰서 문서', icon: FormIcon, roles: DOCTOR_ADMIN },
    { href: '/consult', label: '상담 데스크', icon: ReceptionIcon, roles: CLINICAL },
    // 환자↔담당의 메시지 직원 측(2026-09-14) — 역할은 API 정본 그대로(shared CHART_CLINICAL_ROLES · 답변은 서버가 DOCTOR 만)
    { href: '/patient-messages', label: '환자 메시지함', icon: FormIcon, roles: [...CHART_CLINICAL_ROLES] as R },
    // 🔴 dead-menu(역방향): API `/api/v1/admin/voc` 는 ADMIN·CRM_MANAGER·CRM_STAFF 를 받는데
    //    nav 가 ADMIN 전용이라, VoC 담당인 CRM 2종에게 메뉴가 보이지 않았다(권한은 있는데 길이 없음).
    { href: '/admin/voc', label: '고객의 소리(VoC)', icon: FormIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
  ]},
  { title: 'CRM', items: [
    { href: '/crm', label: 'CRM 대시보드', icon: DashboardIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/crm/checkup/targets', label: '검진 대상자', icon: PatientsIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/crm/checkup/analytics', label: '검진 실적', icon: DashboardIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/crm/international/cases', label: '해외환자 케이스', icon: PatientsIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/crm/international/analytics', label: '해외환자 실적', icon: DashboardIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/crm/campaigns', label: '캠페인', icon: FormIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/crm/templates', label: '템플릿', icon: FormIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/crm/segments', label: '세그먼트', icon: PatientsIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/crm/consultation', label: 'CRM 상담', icon: OrdersIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/crm/analytics', label: 'CRM 분석', icon: DashboardIcon, roles: ['ADMIN', 'CRM_MANAGER'] },
    { href: '/crm/automation', label: '자동화', icon: OrdersIcon, roles: ['ADMIN', 'CRM_MANAGER'] },
  ]},
  { title: '원무/관리', items: [
    { href: '/reception-billing-board', label: '원무·수납 보드', icon: DashboardIcon, roles: ['ADMIN', 'NURSE', 'DOCTOR'] },
    { href: '/billing', label: '수납', icon: BillingIcon, roles: ['ADMIN', 'NURSE', 'RECEPTIONIST', 'CHECKUP'] },
    { href: '/claims', label: '보험 청구', icon: ClaimIcon, roles: ADMIN_ONLY },
    { href: '/cost-analysis', label: '원가 분석', icon: DashboardIcon, roles: ADMIN_ONLY },
    { href: '/satisfaction', label: '환자 만족도', icon: QualityIcon, roles: ADMIN_ONLY },
    { href: '/inventory', label: '자재/재고', icon: InventoryIcon, roles: ['ADMIN','ADMIN_STAFF'] },
    { href: '/cssd', label: '중앙공급', icon: CssdIcon, roles: ADMIN_ONLY },
    { href: '/equipment', label: '장비', icon: EquipmentIcon, roles: ['ADMIN','ADMIN_STAFF'] },
    { href: '/hr', label: '인사', icon: HrIcon, roles: ALL },
    { href: '/admin/staff-devices', label: '생체등록·기기관리', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/identity', label: '인증 관리 콘솔', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/stepup-approvals', label: '승인 감사(서명·처방)', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/location-stations', label: '동선 스테이션', icon: ConfigIcon, roles: ADMIN_ONLY },
  ]},
  { title: '안전/질관리', items: [
    { href: '/safety', label: '환자안전(사고 보고)', icon: SafetyIcon, roles: SAFETY_REPORTERS },
    { href: '/safety-quality-board', label: '감염·질·안전 보드', icon: QualityIcon, roles: CLINICAL },
    { href: '/infection', label: '감염관리', icon: InfectionIcon, roles: CLINICAL },
    // 🔴 직원 노출 사고(니들스틱) — **신고는 전 직군**이다. 예리물을 다루는 의사·약사·검사기사는
    //    물론 급양·행정도 체액에 노출될 수 있고, 메뉴가 없으면 사고는 기록되지 않는다.
    //    (API 권한 staff:exposure:report 보유 역할과 동일 — READ 서비스계정만 제외.
    //     전 직원 이력 열람·추적관찰은 화면 안에서 staff:exposure:manage 로 다시 갈린다.)
    { href: '/infection/staff-exposure', label: '직원 노출 사고', icon: InfectionIcon, roles: [...ALL, 'CRM_MANAGER', 'CRM_STAFF'] },
    { href: '/quality', label: 'QI', icon: QualityIcon, roles: CLINICAL },
    // 🔴 nav 는 ALL 인데 API(`/api/v1/codes/clinical-review`)는 임상 4직군+ADMIN 만 통과한다(dead-menu 역방향).
    //    승인/반려는 임상 4직군 전용이므로 nav 도 임상직으로 좁힌다.
    { href: '/mapping-review', label: '매핑 임상검토', icon: QualityIcon, roles: ['ADMIN','DOCTOR','NURSE','PHARMACIST','LAB_TECH'] },
    { href: '/education', label: '직원교육', icon: EducationIcon, roles: ALL },
    { href: '/admin/sqe', label: '자격·교육(SQE)', icon: EducationIcon, roles: ADMIN_ONLY },
    { href: '/admin/gld', label: '위원회·정책(GLD)', icon: QualityIcon, roles: CLINICAL },
    { href: '/admin/safety-gates', label: '안전 게이트 관제', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/outbound-channels', label: '대외 발신 관제', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/agency-integrations', label: '기관 연동', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/decisions', label: '중요 결정', icon: SafetyIcon, roles: ADMIN_ONLY },
    // 사람 몫 할 일 — 개발이 끝나고 결정·입력·확인만 남은 일 H1~H10 · 상태는 정본에서 파생(체크박스 없음) · API 도 ADMIN (2026-10-26)
    { href: '/admin/human-actions', label: '사람 몫 할 일', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/audit-dashboard', label: '감사 대시보드', icon: QualityIcon, roles: ADMIN_ONLY },
    { href: '/admin/order-sign-logs', label: '오더 서명 로그', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/admin/terminal-security', label: '단말 보안', icon: AccessControlIcon, roles: ADMIN_ONLY },
  ]},
  { title: '병원 안내', items: [
    { href: '/departments', label: '진료과 안내', icon: DiagnosticsIcon, roles: GUIDE_VIEWERS },
    { href: '/doctors', label: '의료진 소개', icon: PatientsIcon, roles: GUIDE_VIEWERS },
    { href: '/facility-info', label: '시설 안내', icon: EquipmentIcon, roles: GUIDE_VIEWERS },
    { href: '/his-news', label: '병원 소식', icon: FormIcon, roles: GUIDE_VIEWERS },
    { href: '/his-health-info', label: '건강정보', icon: SafetyIcon, roles: GUIDE_VIEWERS },
    { href: '/recruit', label: '채용 안내', icon: HrIcon, roles: GUIDE_VIEWERS },
  ]},
  { title: `${AI_ORIGIN_TEXT}/시뮬레이션`, items: [
    { href: '/concierge', label: `${AI_ORIGIN_TEXT} 컨시어지`, icon: BotIcon, roles: CLINICAL },
    { href: '/ai-booking', label: `${AI_ORIGIN_TEXT} 예약 도우미`, icon: BotIcon, roles: CLINICAL },
    { href: '/simulator', label: '시뮬레이터/플로어맵', icon: DiagnosticsIcon, roles: ADMIN_ONLY },
    { href: '/metaverse', label: '메타버스 뷰어', icon: DiagnosticsIcon, roles: CLINICAL },
    { href: '/journey', label: '환자 여정', icon: OrdersIcon, roles: CLINICAL },
    { href: '/interoperability', label: '상호운용성', icon: DiagnosticsIcon, roles: CLINICAL },
    { href: '/interoperability/test', label: '연동 테스트 콘솔', icon: ConfigIcon, roles: ADMIN_ONLY },
  ]},
  { title: '전원/연동', items: [
    { href: '/transfer', label: '전원 관리', icon: OrdersIcon, roles: [...TRANSFER_ACCESS_ROLES] as R }, // 🔴 API `@Roles(DOCTOR,ADMIN)` 와 같은 목록 — 종전엔 nav 가 NURSE 를 열어 전 패널 403 이었다
    { href: '/transfer/request', label: '전원 의뢰', icon: OrdersIcon, roles: DOCTOR_ADMIN },
    { href: '/transfer/incoming', label: '수신 전원', icon: OrdersIcon, roles: [...TRANSFER_ACCESS_ROLES] as R },
    { href: '/transfer/history', label: '전원 이력', icon: OrdersIcon, roles: [...TRANSFER_ACCESS_ROLES] as R },
  ]},
  { title: '생활/편의', items: [
    { href: '/staff-meal', label: '직원 식단표', icon: NutritionIcon, roles: ALL },
  ]},
  // 🔴 '내 설정' 4화면은 nav 가 전부 ALL(11역할)인데 API 는 3~5역할만 통과했다 —
  //    나머지 역할은 열자마자 403 → "빈 화면 + 저장 실패". nav 를 API 와 맞춘다(양방향 정합).
  { title: '내 설정', items: [
    { href: '/ess', label: '내 행정(ESS)', icon: HrIcon, roles: ALL_WITH_READ }, // ess.controller = 12역할(READ 포함)
    // blockchain-cert: DOCTOR·NURSE·ADMIN·PHARMACIST
    { href: '/settings/my-certificate', label: '내 전자인증서', icon: SafetyIcon, roles: ['ADMIN','DOCTOR','NURSE','PHARMACIST'] },
    // users/me/signature: ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH
    { href: '/settings/my-signature', label: '내 서명 등록', icon: FormIcon, roles: ['ADMIN','DOCTOR','NURSE','PHARMACIST','LAB_TECH'] },
    { href: '/settings/my-codes', label: '나의 약속처방', icon: OrdersIcon, roles: DOCTOR_ADMIN },
    { href: '/settings/shortcuts', label: '단축키·화면번호', icon: FormIcon, roles: EVERY_ROLE }, // 서버 호출 없음(순수 FE)
    // auth/change-password = JwtAuthGuard 만(역할 무관) — 14역할 전부
    { href: '/settings/password', label: '비밀번호 변경', icon: SafetyIcon, roles: EVERY_ROLE },
    // voice-emr 컨트롤러 전 EP = DOCTOR·ADMIN·NURSE
    { href: '/settings/voice', label: '음성 설정 (VoiceEMR)', icon: FormIcon, roles: ['ADMIN','DOCTOR','NURSE'] },
  ]},
  { title: '경영진', items: [
    { href: '/executive', label: '경영 대시보드', icon: ExecutiveIcon, roles: ['ADMIN','EXECUTIVE'] },
    { href: '/executive/clinical', label: '의료 품질', icon: ClinicalIcon, roles: ['ADMIN','EXECUTIVE'] },
    // 공시 손익 동급 비교 — finance-benchmark 조회 EP = ADMIN·EXECUTIVE
    { href: '/executive/finance-benchmark', label: '경영성과 벤치마크', icon: ExecutiveIcon, roles: ['ADMIN','EXECUTIVE'] },
  ]},
  /**
   * 🔴 **개원 전 / 운영** 은 표시 분류다 — **권한이 아니다.**
   *    메뉴를 나눠도 권한은 그대로다(§규약 5: nav 숨김 ≠ 권한 회수).
   *    가른 기준: **어디서 자주 여는가.** 기준·마스터·개통은 개원 전에 몰려 있고,
   *    사람·일정·기록·지표는 문을 연 뒤에 매일 본다.
   * 🔴 "개원 전"이 "개원 후엔 못 고친다"는 뜻이 아니다 — 코드 마스터도 권한도
   *    운영 중에 바뀐다. 바뀌면 **여기서** 고친다.
   */
  { title: '개원 전 시스템 관리', items: [
    /**
     * 🔴 **소분류(`group`)는 표시 분류다 — 권한도, 순서 강제도 아니다.**
     *    36개가 한 목록에 평평하게 있어 "무엇을 여기서 정하는가"가 안 보였다.
     *    가른 기준: **무엇을 정하는 화면인가** — 진행을 보는 것(관제) · 이름표(마스터) ·
     *    진료가 따르는 것(규칙) · 물리 자원 · 권한 · 표시 · 그 밖의 설정.
     * 🔴 그룹은 **모든 항목이 하나씩** 갖는다(빈 값 금지·중복 금지 — 가드가 강제).
     *    빠뜨리면 그 항목은 소분류 없이 떠돌고, 사람은 "어디 있더라"를 다시 겪는다.
     */
    // ── 개원 관제 — 개원이 어디까지 왔는가 — 진행을 보는 곳(여기서 고치지 않는다)
    { href: '/admin/opening', label: '개원·운영 단계', group: '개원 관제', icon: SafetyIcon, roles: ['ADMIN', 'EXECUTIVE'] },
    { href: '/admin/go-live', label: '운영 전환(Go-Live) 관제', group: '개원 관제', icon: SafetyIcon, roles: ['ADMIN', 'EXECUTIVE'] },
    { href: '/admin/integration-gates', label: '연동 개통 게이트', group: '개원 관제', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/phase0-cutover', label: 'Phase0 컷오버 승인', group: '개원 관제', icon: ConfigIcon, roles: ADMIN_ONLY },
    { href: '/admin/emr-cert', label: 'EMR 인증', group: '개원 관제', icon: CertIcon, roles: ADMIN_ONLY },
    // ── 코드·마스터 — 무엇을 무엇이라 부르는가 — 진단·약품·수가·분류의 이름표
    { href: '/admin/codes', label: '코드 마스터', group: '코드·마스터', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/admin/non-covered', label: '비급여 관리', group: '코드·마스터', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/admin/drug-mapping', label: '약품 보험코드 매핑', group: '코드·마스터', icon: PharmacyIcon, roles: ['ADMIN', 'PHARMACIST'] },
    { href: '/admin/billing-calc', label: '수가 계산기', group: '코드·마스터', icon: ConfigIcon, roles: ADMIN_ONLY },
    { href: '/admin/dept-catalog', label: '진료과 카탈로그', group: '코드·마스터', icon: DiagnosticsIcon, roles: ADMIN_ONLY },
    { href: '/admin/categories', label: '카테고리 관리', group: '코드·마스터', icon: FormIcon, roles: ADMIN_ONLY },
    // ── 임상 규칙·템플릿 — 진료가 따르는 것 — 처방집·경로·규칙·서식
    // 임상 규칙 대장 — 10개 카탈로그 한 장(사용 중·승인 기록 없음·코드 기본값 대체·마지막 변경) · API 도 ADMIN (clinical-rules-templates-review P4 2026-10-21)
    { href: '/admin/clinical-rules', label: '임상 규칙 대장', group: '임상 규칙·템플릿', icon: SafetyIcon, roles: ADMIN_ONLY },
    // 간호 원내 규정 — 통증 재평가 기준·기한 · 인계 인수 확인↔담당 인수 방식 · 보호대 점검 간격 · 저장은 PUT /config(ADMIN) (2026-10-26)
    { href: '/admin/nursing-rules', label: '간호 원내 규정', group: '임상 규칙·템플릿', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/order-sets', label: '약속처방(CP)', group: '임상 규칙·템플릿', icon: OrdersIcon, roles: DOCTOR_ADMIN },
    { href: '/admin/treatment-templates', label: '치료일정 템플릿', group: '임상 규칙·템플릿', icon: ScheduleIcon, roles: DOCTOR_ADMIN },
    { href: '/admin/formulary', label: '원내 처방집(위원회)', group: '임상 규칙·템플릿', icon: OrdersIcon, roles: ADMIN_ONLY },
    { href: '/admin/cdss-rules', label: 'CDSS 규칙', group: '임상 규칙·템플릿', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/protocols', label: '여정 프로토콜', group: '임상 규칙·템플릿', icon: DashboardIcon, roles: ADMIN_ONLY },
    { href: '/admin/prescriber-rules', label: '처방의 지정 규칙', group: '임상 규칙·템플릿', icon: ConfigIcon, roles: ADMIN_ONLY },
    { href: '/admin/chart-editor', label: '차트 에디터', group: '임상 규칙·템플릿', icon: FormIcon, roles: DOCTOR_ADMIN },
    { href: '/admin/forms', label: '폼 빌더', group: '임상 규칙·템플릿', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/admin/clinical-chart-verification', label: '임상도구 검수', group: '임상 규칙·템플릿', icon: FormIcon, roles: DOCTOR_ADMIN },
    { href: '/admin/triage', label: '트리아지 관리', group: '임상 규칙·템플릿', icon: EmergencyIcon, roles: DOCTOR_ADMIN },
    // ── 시설·장비 — 물리적 자원 — 공간·병상·장비·단말
    { href: '/admin/facility', label: '시설 관리', group: '시설·장비', icon: BedIcon, roles: ADMIN_ONLY },
    { href: '/admin/er-beds', label: '응급실 베드 관리', group: '시설·장비', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/displays', label: 'TV 디스플레이 관리', group: '시설·장비', icon: ScheduleIcon, roles: ADMIN_ONLY },
    { href: '/admin/workstations', label: '워크스테이션·디바이스', group: '시설·장비', icon: EquipmentIcon, roles: ADMIN_ONLY },
    // 공간 자산 배치 — 워크스테이션·PC·의료기기·장비·보관 장소의 위치 원장 · API 도 ADMIN (spatial-flow-vision-3d §5-A)
    { href: '/admin/space-assets', label: '공간 자산 배치', group: '시설·장비', icon: EquipmentIcon, roles: ADMIN_ONLY },
    // 공간 도면 가져오기 — space-import.v1 올리기·검증·확정(P1) · API 도 ADMIN
    { href: '/admin/space-model', label: '공간 도면', group: '시설·장비', icon: EquipmentIcon, roles: ADMIN_ONLY },
    // 무선 위치 — AP 등록부·수집기·단말↔환자 연결(동의 근거) · API 관리 EP 는 ADMIN (wifi-ap-location 2026-10-09)
    { href: '/admin/wifi-location', label: '무선 위치', group: '시설·장비', icon: EquipmentIcon, roles: ADMIN_ONLY },
    // ── 권한·보안 — 누가 무엇을 할 수 있는가
    { href: '/admin/access-control', label: '접근 권한', group: '권한·보안', icon: AccessControlIcon, roles: ADMIN_ONLY },
    { href: '/admin/rbac', label: '역할 권한', group: '권한·보안', icon: AccessControlIcon, roles: ADMIN_ONLY },
    { href: '/admin/blockchain-cert', label: '전자인증서', group: '권한·보안', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/erp', label: 'ERP 접근 설정', group: '권한·보안', icon: ConfigIcon, roles: ADMIN_ONLY },
    // ── 화면·표시 — 사람에게 어떻게 보이는가 — 메뉴·번호·대시보드·수치 표현
    { href: '/admin/menus', label: '메뉴 관리', group: '화면·표시', icon: ConfigIcon, roles: ADMIN_ONLY },
    { href: '/admin/menu-config', label: '메뉴 구성·권한', group: '화면·표시', icon: ConfigIcon, roles: ADMIN_ONLY },
    { href: '/admin/screen-codes', label: '화면번호 레지스트리', group: '화면·표시', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/admin/dashboard-templates', label: '대시보드 템플릿', group: '화면·표시', icon: DashboardIcon, roles: ADMIN_ONLY },
    { href: '/admin/numeric-policy', label: '수치 표시·반올림 정책', group: '화면·표시', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/vitals-standard', label: '활력 표시 표준', group: '화면·표시', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/extensions', label: '확장 슬롯', group: '화면·표시', icon: ExtensionIcon, roles: ADMIN_ONLY },
    // ── 시스템 설정 — 그 밖의 운영 설정
    { href: '/admin/ai-settings', label: '시스템 설정', group: '시스템 설정', icon: ConfigIcon, roles: ADMIN_ONLY },
  ]},
  { title: '운영 시스템 관리', items: [
    /**
     * 🔴 **소분류(`group`)는 표시 분류다 — 권한도, 순서 강제도 아니다**(개원 전 섹션과 같은 규약).
     *    28개가 한 목록에 평평하게 있어 "무엇을 여기서 하는가"가 안 보였다(2026-09-04 사람 요청).
     *    가른 기준: **매일 무엇을 하러 오는 화면인가** — 사람·근무 / 운영 업무 / 돌아가는 것을
     *    보는 곳 / 의료질·안전 / 기록·감사·감시 / AI 산출의 운영·감수.
     * 🔴 항목 재정렬은 화면번호를 옮기지 않는다 — 28개 전부 SCREEN_CODE_FROZEN 등재 확인(2026-09-04).
     */
    // ── 인력·일정 — 사람과 근무 — 직원·팀 편성·진료표·당직
    { href: '/admin/staff-management', label: '직원 관리', group: '인력·일정', icon: HrIcon, roles: ADMIN_ONLY },
    { href: '/admin/onboarding', label: '신규 입사자 관리', group: '인력·일정', icon: HrIcon, roles: ADMIN_ONLY },
    { href: '/admin/care-teams', label: '의료팀 편성', group: '인력·일정', icon: HrIcon, roles: ADMIN_ONLY },
    { href: '/admin/clinic-schedule', label: '진료표', group: '인력·일정', icon: ScheduleIcon, roles: ADMIN_ONLY },
    { href: '/admin/duty-schedule', label: '당직표', group: '인력·일정', icon: ScheduleIcon, roles: ADMIN_ONLY },
    // ── 병원 운영 — 매일 처리하는 운영 업무 — 결재·문진·청구·환자 마킹
    { href: '/admin/approvals-dashboard', label: '전자결재 대시보드', group: '병원 운영', icon: DashboardIcon, roles: ADMIN_ONLY },
    { href: '/admin/questionnaire-dashboard', label: '문진 대시보드', group: '병원 운영', icon: DashboardIcon, roles: ADMIN_ONLY },
    { href: '/admin/hira-edi', label: 'HIRA 청구', group: '병원 운영', icon: ClaimIcon, roles: ADMIN_ONLY },
    { href: '/admin/patient-flags', label: '환자 마킹(루비)', group: '병원 운영', icon: PatientsIcon, roles: CLINICAL },
    // ── 관제·지표 — 병원이 어떻게 돌아가는가 — 경영·흐름·현황
    // 🔴 dead-menu: 이 화면은 전 패널이 `/api/v1/executive/*` 를 부르고, 그 API 는 기능접근
    //    매트릭스 `executive.console`(defaultRoles=ADMIN·EXECUTIVE)로 통제된다 → DOCTOR 에게
    //    메뉴만 보이고 열면 전 패널 403 이었다. **nav 를 API 에 맞춘다**(API 를 넓히지 않는다).
    { href: '/admin/analytics', label: '통계/분석', group: '관제·지표', icon: QualityIcon, roles: ['ADMIN', 'EXECUTIVE'] },
    { href: '/journey-console', label: '환자여정 관제', group: '관제·지표', icon: QualityIcon, roles: ['ADMIN', 'EXECUTIVE'] },
    { href: '/flow-analytics', label: '이탈·지연 분석', group: '관제·지표', icon: QualityIcon, roles: ['ADMIN', 'EXECUTIVE'] },
    { href: '/admin/status', label: '병원 현황', group: '관제·지표', icon: QualityIcon, roles: ADMIN_ONLY },
    // ── 의료질·안전 — 질 지표와 임상 안전 — QI·재평가·데이터 품질·마약류
    { href: '/admin/qi', label: '질관리 (QI)', group: '의료질·안전', icon: QualityIcon, roles: DOCTOR_ADMIN },
    // UDI 리콜 역추적 — 기기/로트로 사용 환자 조회 (gap-remediation R5)
    { href: '/admin/device-recall', label: '기기 리콜 역추적', group: '의료질·안전', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/risk-reassessment', label: '낙상/욕창 재평가', group: '의료질·안전', icon: SafetyIcon, roles: ['ADMIN','NURSE'] },
    { href: '/admin/data-quality', label: '데이터 품질', group: '의료질·안전', icon: ConfigIcon, roles: ADMIN_ONLY },
    { href: '/admin/controlled-substance', label: '마약류 관리', group: '의료질·안전', icon: SafetyIcon, roles: ADMIN_ONLY },
    // ── 기록·감사·감시 — 무엇이 남고 무엇이 새는가 — 미비기록·감사 로그·상시 감시
    { href: '/admin/him', label: '미비기록(HIM)', group: '기록·감사·감시', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/audit', label: '감사 로그', group: '기록·감사·감시', icon: SafetyIcon, roles: ADMIN_ONLY },
    // 로그인 응급접근(authEmergencyAccess) 사후 검토 — 환자열람 BTG 와 별개 원장 (gap-remediation R2)
    { href: '/admin/break-glass', label: '응급 접근 검토', group: '기록·감사·감시', icon: SafetyIcon, roles: ADMIN_ONLY },
    // 데이터 보유·파기 관제 — 정책·DRY-RUN·4-eyes 큐 (gap-remediation R6)
    { href: '/admin/retention', label: '보유·파기(Retention)', group: '기록·감사·감시', icon: SafetyIcon, roles: ADMIN_ONLY },
    // 법적 보존명령 — 파기·익명화·아카이브 이동 차단 표시(설정 1인 · 해제 4-eyes) · API 도 ADMIN·MEDICAL_RECORDS (상용 릴리즈 T10-7)
    { href: '/admin/legal-hold', label: '법적 보존명령', group: '기록·감사·감시', icon: SafetyIcon, roles: ['ADMIN', 'MEDICAL_RECORDS'] },
    // UI 다국어 검수 관제 — 카탈로그 현황 관측(기록≠적용) (ui-locale-i18n P1-E)
    { href: '/admin/ui-locale', label: 'UI 다국어 검수', group: '기록·감사·감시', icon: ConfigIcon, roles: ADMIN_ONLY },
    { href: '/admin/sentinel', label: '상시 감시', group: '기록·감사·감시', icon: ConfigIcon, roles: ADMIN_ONLY },
    // ── AI 운영·감수 — AI 산출을 운영하고 사람이 감수하는 곳(AI 동작 설정은 개원 전 '시스템 설정')
    { href: '/admin/drug-explain', label: 'AI 약물설명 승인', group: 'AI 운영·감수', icon: PharmacyIcon, roles: ['ADMIN', 'PHARMACIST'] },
    { href: '/admin/checkup-explainer', label: '검진해석 콘텐츠(감수)', group: 'AI 운영·감수', icon: FormIcon, roles: DOCTOR_ADMIN },
    { href: '/admin/bots', label: '봇 관리', group: 'AI 운영·감수', icon: BotIcon, roles: ADMIN_ONLY },
    { href: '/admin/medical-law', label: `의료법 ${AI_ORIGIN_TEXT}`, group: 'AI 운영·감수', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/ai-vision', label: `영상 ${AI_ORIGIN_TEXT}`, group: 'AI 운영·감수', icon: DashboardIcon, roles: ADMIN_ONLY },
    { href: '/admin/ai-meeting', label: '회의 분석', group: 'AI 운영·감수', icon: DashboardIcon, roles: ADMIN_ONLY },
    { href: '/admin/ai-counseling', label: `${AI_ORIGIN_TEXT} 상담`, group: 'AI 운영·감수', icon: DashboardIcon, roles: ADMIN_ONLY },
    { href: '/admin/ai-translate', label: `${AI_ORIGIN_TEXT} 번역`, group: 'AI 운영·감수', icon: DashboardIcon, roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
    // AI 감독 관제 — 제안 수용/수정/거부/만료·검토 소요·호출 분포(ai-judgment-governance §2.3).
    // 🔴 역할은 API `@Roles(ADMIN, EXECUTIVE, DOCTOR)` 와 **같아야** 한다 — nav 만 넓히면 dead-menu(403)가 된다.
    //    임상 초안 **본문**은 이 EP 에서 나가지 않아(환자는 가명) 경영·질관리 열람을 함께 둘 수 있다.
    { href: '/admin/ai-oversight', label: `${AI_ORIGIN_TEXT} 감독 관제`, group: 'AI 운영·감수', icon: QualityIcon, roles: ['ADMIN', 'EXECUTIVE', 'DOCTOR'] },
  ]},
  { title: '검진권', items: [
    { href: '/admin/voucher/issue', label: '검진권 발행·조회', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/voucher/list', label: '검진권 목록', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/voucher/dashboard', label: '검진권 대시보드', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/voucher/distributors', label: '검진권 딜러', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/voucher/settings', label: '검진권 정책', icon: ConfigIcon, roles: ADMIN_ONLY },
  ]},
  { title: '외부 연동', items: [
    { href: '/admin/partner-requests', label: '연동 신청 관리', icon: OrdersIcon, roles: ADMIN_ONLY },
    { href: '/admin/partner-monitoring', label: '연동 모니터링', icon: QualityIcon, roles: ADMIN_ONLY },
    { href: '/admin/organizations', label: '연동 기관', icon: HrIcon, roles: ADMIN_ONLY },
    { href: '/admin/smart-clients', label: 'SMART 클라이언트', icon: AccessControlIcon, roles: ADMIN_ONLY },
    { href: '/admin/transfer-stats', label: '전원 통계', icon: OrdersIcon, roles: ADMIN_ONLY },
    { href: '/admin/hie-dashboard', label: '진료정보교류(HIE)', icon: DiagnosticsIcon, roles: ADMIN_ONLY },
  ]},
  { title: '홈페이지 관리', items: [
    { href: '/admin/homepage', label: '홈페이지 대시보드', icon: DashboardIcon, roles: ADMIN_ONLY },
    { href: '/admin/hospital-info', label: '콘텐츠 관리(CMS)', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/admin/homepage/popups', label: '공지/팝업', icon: SafetyIcon, roles: ADMIN_ONLY },
    { href: '/admin/homepage/banners', label: '배너 관리', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/admin/homepage/media', label: '미디어 라이브러리', icon: FormIcon, roles: ADMIN_ONLY },
    { href: '/admin/homepage/seo', label: 'SEO/메타데이터', icon: ConfigIcon, roles: ADMIN_ONLY },
    { href: '/admin/homepage/deploy', label: '홈페이지 배포', icon: ConfigIcon, roles: ADMIN_ONLY },
  ]},
];

// ── 화면번호 레지스트리 ──
// 코드 출처: SCREEN_CODE_FROZEN(고정) 우선 → 없으면 임시 코드(9xxx 예약대역). 단일 소스.
export interface ScreenEntry { code: string; href: string; label: string; section: string; roles: string[] }
/**
 * 🔴 미고정 화면의 임시 코드. 종전 `(10+섹션)*100+항목` 은 **고정번호와 같은 대역**을 찍어
 *    38건 중복(1000·2900·3200~3204 …)을 만들었고, 사람이 외운 번호가 다른 화면으로 갔다.
 *    임시 코드는 고정 대역(1xxx~3xxx)과 겹치지 않는 9xxx 예약대역으로만 낸다 —
 *    9xxx 가 보이면 "freeze 미등록"이라는 뜻이며, 가드 스펙이 배포 전에 막는다.
 */
const TEMP_CODE_BASE = 9000;
const deriveTempCode = (globalIndex: number) => String(TEMP_CODE_BASE + globalIndex);
/**
 * 🔴 사이드바에 없지만 **번호로는 가야 하는 화면**(2026-08-21 실측).
 *    종전 레지스트리는 `NAV_SECTIONS` 만 훑어서, freeze 에 코드를 적어도 `SCREEN_BY_CODE` 에 들어가지
 *    않았다 — `/compounding`(1209)·`/workstation/triage`(1720)·`/admin/reference-ranges`(3134) 는
 *    **코드가 있는데 번호 이동이 조용히 실패**하고 있었다(사람은 오타로 읽는다).
 *    여기 등재 기준은 사이드바 유무가 아니라 **진입점이 명확한가**다. 진입점 없는 화면은 코드도 주지 않는다.
 *    동적 조합 화면(`[id]`·쿼리로 조합되는 상세)은 대상이 아니다 — 부모 화면 번호로 들어가 그대로 동작한다.
 */
export const OFF_NAV_SCREENS: { href: string; label: string; section: string; roles: R }[] = [
  // 의사 할 일함(/doctor-inbox)의 탭 — 개별 화면도 그대로 연다(알림·대시보드 위젯·번호 이동이 들어온다) · 2026-10-07
  { href: '/results-inbox', label: '검사결과 확인함', section: '진료·원무', roles: DOCTOR_ADMIN },
  { href: '/verbal-orders', label: '구두·전화 처방 확인', section: '진료·원무', roles: DOCTOR_ADMIN },
  { href: '/renewals', label: '처방 갱신 대기', section: '진료·원무', roles: DOCTOR_ADMIN },
  { href: '/pharmacist-replies', label: '약사 회신 요청', section: '진단·약제', roles: DOCTOR_ADMIN },
  { href: '/patients/new', label: '환자 등록', section: '진료·원무', roles: [...CLINICAL, 'RECEPTIONIST', 'MEDICAL_RECORDS', 'CHECKUP'] },
  { href: '/schedule/new', label: '예약 등록', section: '진료·원무', roles: [...CLINICAL, 'RECEPTIONIST'] },
  { href: '/compounding', label: '조제실', section: '진단·약제', roles: ['ADMIN', 'PHARMACIST'] },
  { href: '/pharmacy/admin', label: '약제 마스터 관리', section: '진단·약제', roles: ['ADMIN', 'PHARMACIST'] },
  // 🔴 진입점이 명확한 화면만 번호를 준다 — 결정 화면에서 링크로 들어간다(2026-08-27)
  { href: '/admin/decisions/console', label: '중요 결정 관리 콘솔', section: '관리', roles: ['ADMIN'] },
  // 결정 대장(문서) — 결정 화면 '결정 이력' 탭에서 링크로 들어간다(2026-10-11)
  { href: '/admin/decisions/register', label: '결정 대장', section: '관리', roles: ['ADMIN'] },
  // 사람 확인 문서(개시 전 필수 순서표·세부 분류 배치·인쇄본 점검) — 결정 화면 '결정 이력' 탭에서 링크(2026-10-12)
  { href: '/admin/decisions/checks', label: '사람 확인 문서', section: '관리', roles: ['ADMIN'] },
  // 🔴 위원회 대장에서 링크로 들어간다(2026-08-27) — 진입점이 명확하므로 번호를 준다
  { href: '/admin/governance/standards', label: '표준 발효 거버넌스', section: '관리', roles: ['ADMIN'] },
  { href: '/telehealth/recordings', label: '화상진료 녹화 기록', section: '진단·약제', roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
  { href: '/hospice', label: '호스피스', section: '특수 진료', roles: CLINICAL },
  { href: '/his-checkup/ws/hub', label: '검진 스테이션 허브', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/blood', label: '검진 스테이션 · 채혈', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/urine', label: '검진 스테이션 · 소변', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/physical', label: '검진 스테이션 · 계측', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/eye', label: '검진 스테이션 · 시력·안압', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/ecg', label: '검진 스테이션 · 심전도', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/pft', label: '검진 스테이션 · 폐기능', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/xray', label: '검진 스테이션 · 흉부X선', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/ultrasound', label: '검진 스테이션 · 초음파', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/endoscopy', label: '검진 스테이션 · 내시경', section: '건강검진', roles: ['ADMIN', 'NURSE', 'LAB_TECH'] },
  { href: '/his-checkup/ws/consult', label: '검진 스테이션 · 진찰', section: '건강검진', roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
  { href: '/workstation/triage', label: '트리아지 워크스테이션', section: '워크스테이션', roles: CLINICAL },
  { href: '/consent/templates', label: '동의서 서식 관리', section: '동의·기록', roles: CLINICAL },
  { href: '/consult/admin', label: '상담 팀 관리', section: '협진·상담', roles: CLINICAL },
  { href: '/consult/lead', label: '상담 리드', section: '협진·상담', roles: CLINICAL },
  { href: '/crm/checkup/follow-ups', label: '검진 사후관리', section: 'CRM', roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
  { href: '/crm/communications', label: '고객 커뮤니케이션', section: 'CRM', roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
  { href: '/crm/international/agencies', label: '해외 에이전시', section: 'CRM', roles: ['ADMIN', 'CRM_MANAGER', 'CRM_STAFF'] },
  { href: '/claims/stats', label: '청구 통계', section: '청구·정산', roles: ADMIN_ONLY },
  { href: '/notifications', label: '내 알림', section: '개인 설정', roles: EVERY_ROLE },
  /**
   * 🔴 「시스템 설정」이라는 이름이 **두 화면**에 있었다(2026-09-13 외부 실측 S8) — nav 는 편집 화면
   *    `/admin/ai-settings` 로 가는데 구축 가이드·Go-Live 드릴다운·결정 등록부는 이 읽기 화면을 가리켜,
   *    "시스템 설정에서 스위치를 끄세요"를 따라간 사람이 **끌 수 없는 화면**에 도착했다.
   *    값을 바꾸는 화면이 정본이므로 그 이름은 그쪽이 갖고, 여기는 무엇을 하는 화면인지로 이름을 바꾼다.
   *    화면번호(3163)·라우트는 그대로다. 가드: `apps/api/test/go-live/settings-screen-canon.spec.ts`
   */
  { href: '/admin/config', label: '설정값 목록(읽기 전용)', section: '시스템 관리', roles: ADMIN_ONLY },
  { href: '/admin/governance', label: '위원회 거버넌스', section: '시스템 관리', roles: ADMIN_ONLY },
  { href: '/admin/vip-patients', label: 'VIP 환자 관리', section: '시스템 관리', roles: ADMIN_ONLY },
  { href: '/admin/reference-ranges', label: '검사 기준치 마스터', section: '시스템 관리', roles: ADMIN_ONLY },
  // CMS 카테고리별 전용 편집 화면 — 진입점 = 홈페이지 관리 허브(/admin/homepage, 3300)
  { href: '/admin/homepage/departments', label: '진료과 소개 관리', section: '홈페이지 관리', roles: ADMIN_ONLY },
  { href: '/admin/homepage/centers', label: '전문센터 소개 관리', section: '홈페이지 관리', roles: ADMIN_ONLY },
  { href: '/admin/homepage/news', label: '뉴스/소식 관리', section: '홈페이지 관리', roles: ADMIN_ONLY },
  { href: '/admin/homepage/health-info', label: '건강정보 관리', section: '홈페이지 관리', roles: ADMIN_ONLY },
  { href: '/admin/homepage/health-tv', label: '건강TV 관리', section: '홈페이지 관리', roles: ADMIN_ONLY },
  { href: '/admin/homepage/gallery', label: '갤러리 관리', section: '홈페이지 관리', roles: ADMIN_ONLY },
  { href: '/admin/homepage/csr', label: '사회공헌 관리', section: '홈페이지 관리', roles: ADMIN_ONLY },
  { href: '/admin/homepage/recruit', label: '채용정보 관리', section: '홈페이지 관리', roles: ADMIN_ONLY },
  { href: '/admin/homepage/doctors', label: '의료진 소개 관리', section: '홈페이지 관리', roles: ADMIN_ONLY },
  /**
   * 언어팩 사람 검수 — 진입점은 `/admin/ui-locale`(3409) 화면의 링크다.
   * 🔴 역할을 ADMIN 으로 좁히지 않는다: 서버는 이 화면의 **읽기를 로그인한 직원 전체에 열어** 두었고
   *    (UI 문구라 PHI 가 아니다), 검수자는 설정 `i18n.reviewers` 로 지정되는 **비관리자 언어 전문가**다.
   *    쓰기 권한은 서버가 판정하고 화면이 그 사유를 그대로 말한다(숨김 ≠ 권한 회수).
   */
  { href: '/admin/ui-locale/review', label: '언어팩 사람 검수', section: '시스템 관리', roles: EVERY_ROLE },
];
export const SCREEN_REGISTRY: ScreenEntry[] = (() => {
  let n = 0;
  const nav = NAV_SECTIONS.flatMap((s) =>
    s.items.map((it) => ({ code: SCREEN_CODE_FROZEN[it.href] ?? deriveTempCode(n++), href: it.href, label: it.label, section: s.title, roles: it.roles })),
  );
  const navHrefs = new Set(nav.map((e) => e.href));
  const off = OFF_NAV_SCREENS.filter((e) => !navHrefs.has(e.href)).map((e) => ({
    code: SCREEN_CODE_FROZEN[e.href] ?? deriveTempCode(n++),
    href: e.href, label: e.label, section: e.section, roles: e.roles,
  }));
  return [...nav, ...off];
})();
/** 🔴 코드는 있는데 어디에도 등재되지 않은 화면 = 번호 이동이 조용히 실패한다. 가드가 0을 요구한다. */
export const SCREEN_CODE_ORPHANS: string[] = (() => {
  const known = new Set(SCREEN_REGISTRY.map((e) => e.href));
  return Object.keys(SCREEN_CODE_FROZEN).filter((h) => !known.has(h));
})();
export const SCREEN_CODE_BY_HREF: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const e of SCREEN_REGISTRY) if (!(e.href in m)) m[e.href] = e.code; // 별칭: 첫 코드 대표
  return m;
})();

// ── 화면번호 무결성(중복·미고정) — **환경 무관 상시 산출**이 정본 ──
// 🔴 종전 검증은 `NODE_ENV !== 'production'` 안에 있어 **운영에서만 조용**했다. 중복은 운영에서
//    사람을 다른 화면으로 보내는 결함이므로, 운영에서도 계산하고 드러낸다(콘솔 error + 화면 배너 + 이동 거부).
export interface ScreenCodeConflict { code: string; hrefs: string[] }
export const SCREEN_CODE_CONFLICTS: ScreenCodeConflict[] = (() => {
  const byCode = new Map<string, string[]>();
  for (const e of SCREEN_REGISTRY) byCode.set(e.code, [...(byCode.get(e.code) ?? []), e.href]);
  return [...byCode.entries()].filter(([, hrefs]) => hrefs.length > 1).map(([code, hrefs]) => ({ code, hrefs }));
})();
export const SCREEN_CODE_UNFROZEN: ScreenEntry[] = SCREEN_REGISTRY.filter((e) => !(e.href in SCREEN_CODE_FROZEN));
/** 코드 → 화면(첫 등록 우선). 충돌 코드는 담지 않는다 — "아무 데나 보내기"보다 이동 거부가 안전. */
export const SCREEN_BY_CODE: Record<string, ScreenEntry> = (() => {
  const conflicted = new Set(SCREEN_CODE_CONFLICTS.map((c) => c.code));
  const m: Record<string, ScreenEntry> = {};
  for (const e of SCREEN_REGISTRY) if (!conflicted.has(e.code) && !(e.code in m)) m[e.code] = e;
  return m;
})();

if (typeof window !== 'undefined') {
  if (SCREEN_CODE_CONFLICTS.length) {
    console.error('[screen-codes] 🔴 중복 화면번호(이동 거부됨):', SCREEN_CODE_CONFLICTS.map((c) => `${c.code}: ${c.hrefs.join(' ↔ ')}`));
  }
  if (SCREEN_CODE_UNFROZEN.length) {
    console.error('[screen-codes] 🔴 미고정 화면(screen-codes.frozen.ts 추가 필요):', SCREEN_CODE_UNFROZEN.map((e) => `${e.href}(임시 ${e.code})`));
  }
}

// ── 메뉴 항목 표시 판정(순수 함수 · 2026-09-30 의사 메뉴 정리로 추출) ──
// 진료과 → 사이드바 경로 매핑
const DEPT_TO_SPECIALTY_PATH: Record<string, string> = {
  '내과': '/internal-medicine', '치과': '/dental', '안과': '/ophthalmology',
  '피부과': '/dermatology', '이비인후과': '/ent', '정형외과': '/orthopedics',
  '산부인과': '/obgyn', '소아청소년과': '/pediatrics', '정신건강의학과': '/psychiatry',
  '신경외과': '/neurosurgery', '성형외과': '/plastic', '비뇨의학과': '/urology',
  '재활의학과': '/rehab', '방사선종양학과': '/radiation', '응급의학과': '/emergency',
  '가정의학과': '/internal-medicine', '마취통증의학과': '/surgery',
};
// 내과 세부 전문과도 내과 매핑
const INTERNAL_SUBSPECIALTIES = ['순환기내과', '호흡기내과', '소화기내과', '내분비내과', '신장내과', '혈액종양내과', '감염내과', '류마티스내과'];
/**
 * 진료과 전용 화면 — 의사는 본인 과만, 간호사는 숨김.
 * 🔴 (2026-09-30) 종전엔 여기에 `/dialysis`·`/blood-bank` 가 들어 있었다. 둘은 진료과가 아니라 **부서 공용 화면**인데
 *    어느 진료과도 그 경로로 매핑되지 않아 **모든 의사와 모든 간호사에게** 숨겨졌다(투석실 간호사가 투석실 메뉴를 못 봤다).
 */
export const SPECIALTY_PREFIXES = [
  '/internal-medicine', '/dental', '/ophthalmology', '/dermatology', '/ent',
  '/orthopedics', '/obgyn', '/pediatrics', '/psychiatry', '/neurosurgery',
  '/plastic', '/urology', '/rehab', '/radiation',
];
/**
 * 검진센터 운영 화면 — 의사·간호사에게는 **검진센터 소속일 때만**(2026-09-30).
 * 병동·외래 의사에게 검진 대기·동선·디스플레이·통계 9개가 늘 보였다. 소속을 모르면(빈 값) 숨기지 않는다.
 * `/his-checkup/review`(소견 대기)는 넣지 않는다 — 검진 소견은 타과 의사도 판독한다(원내 운영에 따라 다름).
 */
export const CHECKUP_OPS_PATHS = [
  '/his-checkup', '/his-checkup/waiting', '/his-checkup/flow-board', '/patient-flow', '/display/checkup',
  '/his-checkup/station', '/his-checkup/schedule', '/his-checkup/follow-ups', '/his-checkup/stats',
];
const DEPT_NARROWED = (dept: string) => dept.startsWith('검사실') || dept.startsWith('영상실') || dept.startsWith('기초검사') || dept.startsWith('영상의학과(') || dept.startsWith('치료실');

export function isNavItemVisible(
  item: { href: string; roles?: string[] },
  ctx: { role: string; dept: string; specialty?: string | null; deptAllowedPaths?: string[]; override?: { hidden?: boolean; roles?: string[] } },
): boolean {
  // 메뉴 오버라이드: 숨김·역할 재정의(세부 권한)
  if (ctx.override?.hidden) return false;
  const roles = ctx.override?.roles ?? item.roles;
  if (!roles || !roles.includes(ctx.role)) return false;
  // 부서별 메뉴 필터링 (검사실/영상실 등 전용 부서는 모든 역할에 적용)
  // 건강검진센터는 제외 — 폴백 경로(/checkup)가 실제 nav(/his-checkup)와 불일치해 narrowing 이
  // 검진 메뉴를 통째로 가리던 버그. 검진 직원은 role(CHECKUP·검진 의사=DOCTOR·간호=NURSE) 로 스코프.
  if (ctx.deptAllowedPaths && (ctx.role === 'ADMIN' || DEPT_NARROWED(ctx.dept))) {
    return ctx.deptAllowedPaths.some(p => item.href === p || item.href.startsWith(p + '/'));
  }
  // 검진센터 운영 화면: 의사·간호사는 검진센터 소속만(소속 미상이면 숨기지 않는다)
  if ((ctx.role === 'DOCTOR' || ctx.role === 'NURSE') && ctx.dept && !ctx.dept.startsWith('건강검진센터') && CHECKUP_OPS_PATHS.includes(item.href)) {
    return false;
  }
  // 의사: 전문과 메뉴는 본인 과만 표시
  if (ctx.role === 'DOCTOR' && SPECIALTY_PREFIXES.includes(item.href)) {
    const mySpec = ctx.specialty ?? '';
    const myPath = INTERNAL_SUBSPECIALTIES.includes(mySpec) ? '/internal-medicine' : (DEPT_TO_SPECIALTY_PATH[ctx.dept] ?? '');
    return item.href === myPath;
  }
  // 간호사: 전문과 메뉴 숨김 (진료과 페이지 불필요)
  if (ctx.role === 'NURSE' && SPECIALTY_PREFIXES.includes(item.href)) return false;
  return true;
}

// Fallback defaults (used before API loads)
const DEFAULT_DEPT_ACCESS: Record<string, string[]> = {
  '급양과': ['/dashboard', '/nutrition', '/workstation/nutrition', '/staff-meal', '/tablet/nutrition', '/hr', '/education'],
  '원무과': ['/dashboard', '/reception', '/billing', '/claims', '/patients', '/schedule', '/hr', '/education'],
  '행정과': ['/dashboard', '/hr', '/inventory', '/equipment', '/education', '/admin/analytics', '/admin/status'],
  '의무기록과': ['/dashboard', '/patients', '/medical-records/search', '/medical-records/copy', '/consent', '/hr', '/education', '/admin/emr-cert', '/admin/audit'],
  '경영진': ['/dashboard', '/executive', '/executive/clinical', '/executive/finance-benchmark', '/hr', '/admin/analytics', '/admin/status', '/admin/config', '/admin/access-control'],
  '건강검진센터(의사)': ['/checkup', '/checkup/reception', '/checkup/waiting', '/checkup/programs', '/checkup/schedule', '/checkup/review', '/checkup/follow-ups', '/checkup/stats', '/checkup/contracts', '/patients', '/consent', '/hr', '/education'],
  '건강검진센터(간호사)': ['/checkup', '/checkup/reception', '/checkup/waiting', '/checkup/schedule', '/checkup/follow-ups', '/patients', '/consent', '/hr', '/education'],
  '건강검진센터(원무)': ['/checkup', '/checkup/reception', '/checkup/waiting', '/checkup/schedule', '/checkup/contracts', '/checkup/stats', '/patients', '/billing', '/schedule', '/hr', '/education'],
  '건강검진센터(행정)': ['/checkup', '/checkup/contracts', '/checkup/stats', '/checkup/follow-ups', '/hr', '/education', '/admin/analytics'],
  '건강검진센터(검사실)': ['/checkup', '/checkup/station', '/checkup/waiting'],
  '검사실(채혈)': ['/workstation', '/workstation/lab', '/workstation/templates'],
  '검사실(혈액)': ['/workstation', '/workstation/lab', '/workstation/templates'],
  '검사실(생화학)': ['/workstation', '/workstation/lab', '/workstation/templates'],
  '검사실(소변)': ['/workstation', '/workstation/lab', '/workstation/templates'],
  '검사실(미생물)': ['/workstation', '/workstation/lab', '/workstation/templates'],
  '영상실(일반촬영)': ['/workstation', '/workstation/imaging'],
  '영상실(CT)': ['/workstation', '/workstation/imaging'],
  '영상실(MRI)': ['/workstation', '/workstation/imaging'],
  '영상실(초음파)': ['/workstation', '/workstation/imaging'],
  '기초검사(심전도)': ['/workstation', '/workstation/diagnostic'],
  '기초검사(폐기능)': ['/workstation', '/workstation/diagnostic'],
  '기초검사(내시경)': ['/workstation', '/workstation/diagnostic'],
  '영상의학과(판독)': ['/workstation', '/workstation/reading', '/imaging'],
  '치료실(물리)': ['/workstation', '/workstation/therapy'],
  '치료실(작업)': ['/workstation', '/workstation/therapy'],
  '치료실(언어)': ['/workstation', '/workstation/therapy'],
  '치료실(투석)': ['/workstation', '/workstation/therapy'],
  '치료실(항암)': ['/workstation', '/workstation/therapy'],
  '치료실(방사선)': ['/workstation', '/workstation/therapy'],
};

// ── 도메인 대분류(8) — 사이드바 2-tier + 메뉴 허브(/menu/[key]) ──
export const MENU_DOMAINS: { key: string; title: string; desc: string }[] = [
  { key: 'care', title: '진료', desc: '외래·입원·간호·전문진료·수술 등 임상 진료 전반' },
  { key: 'support', title: '진료지원', desc: '약국·검사·영상·의무기록·워크스테이션 등 진료 지원' },
  { key: 'patient', title: '환자·고객', desc: 'CRM·예약·병원 안내 등 환자/고객 관리' },
  { key: 'quality', title: '질·안전', desc: '환자안전·감염관리·질 지표·임상 연구' },
  { key: 'ops', title: '운영', desc: '원무·청구·인사·경영 대시보드·전원/연동' },
  { key: 'intel', title: '지능형', desc: `${AI_ORIGIN_TEXT} 진단보조·시뮬레이션·디지털 트윈` },
  { key: 'system', title: '시스템 관리', desc: '직원·권한·설정·외부연동·홈페이지 관리' },
  { key: 'personal', title: '개인', desc: '내 설정·복리후생·교육' },
];

// 섹션(NAV_SECTIONS.title) → 도메인·허브키·설명. 미매핑 섹션은 '개인'으로 폴백.
export const SECTION_META: Record<string, { domain: string; key: string; desc: string }> = {
  '외래': { domain: 'care', key: 'outpatient', desc: '접수·진료실 대기·환자 관리·예약·처방(CPOE) 등 외래 진료 전 과정' },
  '간호': { domain: 'care', key: 'nursing', desc: '간호 워크스테이션 등 간호 업무' },
  '수술/중환자': { domain: 'care', key: 'surgery-icu', desc: '수술·회복실(PACU)·응급실·중환자실' },
  '전문 진료': { domain: 'care', key: 'specialty', desc: '내과·외과 등 진료과별 전문 진료' },
  '특수 치료': { domain: 'care', key: 'special-care', desc: '투석·항암·재활 등 특수 치료' },
  '입원': { domain: 'care', key: 'inpatient', desc: '입원 환자 관리·병동' },
  '협진/의뢰': { domain: 'care', key: 'referral', desc: '타과 협진 의뢰·회신' },
  '진료 지원': { domain: 'support', key: 'clinical-support', desc: '약국·검사실·영상실·병리·혈액은행·화상진료' },
  '의무기록': { domain: 'support', key: 'medical-records', desc: '의무기록 조회·사본발급·제증명' },
  '워크스테이션': { domain: 'support', key: 'workstation', desc: '접수·검사·영상·간호·입원 등 부서별 워크스테이션' },
  '클리닉 센터': { domain: 'support', key: 'clinic-center', desc: '건강검진센터 등 클리닉 센터' },
  'CRM': { domain: 'patient', key: 'crm', desc: '검진·해외환자·캠페인 등 고객관계관리' },
  '병원 안내': { domain: 'patient', key: 'hospital-guide', desc: '병원 안내·동선·시설' },
  '안전/질관리': { domain: 'quality', key: 'safety-quality', desc: '환자안전·감염관리·질 지표' },
  '의료 질/연구': { domain: 'quality', key: 'quality-research', desc: '의료 질 관리·임상 연구' },
  '원무/관리': { domain: 'ops', key: 'admin-office', desc: '청구·수납·인사·재고·교육' },
  '경영진': { domain: 'ops', key: 'executive', desc: '경영 대시보드·임상 지표' },
  '전원/연동': { domain: 'ops', key: 'transfer', desc: '전원·외부기관 연동(HIE)' },
  [`${AI_ORIGIN_TEXT}/시뮬레이션`]: { domain: 'intel', key: 'ai-simulation', desc: `${AI_ORIGIN_TEXT} 진단보조·시뮬레이션·디지털 트윈` },
  '개원 전 시스템 관리': { domain: 'system', key: 'admin-setup', desc: '문 열기 전에 정해두는 기준 — 코드·수가 마스터, 템플릿·규칙, 권한, 연동 개통, 개원 단계 관제. 운영 중 바뀌면 여기서 고친다' },
  '운영 시스템 관리': { domain: 'system', key: 'admin-ops', desc: '문 연 뒤 매일 보는 것 — 인력·일정 · 병원 운영 · 관제·지표 · 의료질·안전 · 기록·감사·감시 · AI 운영·감수' },
  '검진권': { domain: 'system', key: 'voucher', desc: '건강검진권 발행·딜러·정책 관리' },
  '외부 연동': { domain: 'system', key: 'external', desc: '외부 서비스 연동 설정' },
  '홈페이지 관리': { domain: 'system', key: 'homepage-admin', desc: '홈페이지 콘텐츠·CMS 관리' },
  '내 설정': { domain: 'personal', key: 'my-settings', desc: '개인 설정·인증서·기기' },
  '생활/편의': { domain: 'personal', key: 'welfare', desc: '복리후생·교육·편의' },
};
const domainOf = (title: string) => SECTION_META[title]?.domain ?? 'personal';
const sectionKeyOf = (title: string) => SECTION_META[title]?.key ?? '';
// 역할별 기본 펼침 도메인(나머지 접힘 — 인지부하↓)
const DEFAULT_OPEN_DOMAINS: Record<string, string[]> = {
  ADMIN: ['ops'], DOCTOR: ['care'], NURSE: ['care'], PHARMACIST: ['support'], LAB_TECH: ['support'],
};

/** 메뉴 오버라이드 직전 성공값 캐시 — 조회 실패가 숨긴 메뉴를 되살리지 않게 하는 유일한 용도 */
const MENU_OVERRIDE_CACHE_KEY = 'sidebar.menuOverrides.v1';

/** 대분류 아이콘 — 좁은 화면에서 사이드바가 아이콘 줄(rail)로 접힐 때 대분류를 아이콘으로 보인다(2026-09-29) */
const DOMAIN_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  care: Stethoscope, support: Activity, patient: Users, quality: ShieldCheck, ops: Building2, intel: BrainCircuit, system: Settings2, personal: UserRound,
};

export function Sidebar({ onNavigate, onLogoClick, collapsed = false, onToggleCollapse }: {
  onNavigate?: () => void; onLogoClick?: () => void;
  /** 아이콘 줄(rail) 모드 — 대분류 아이콘만 · 누르면 옆으로 메뉴가 펼쳐진다 */
  collapsed?: boolean;
  /** 펼침/접힘 전환(사용자가 고른 것은 기억한다 — 레이아웃이 저장) */
  onToggleCollapse?: () => void;
} = {}) {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const userRole = user?.role ?? 'ADMIN';
  const userDept = user?.department ?? '';
  // 🔴 속성(aria-label)은 티를 그릴 수 없다 — 미등록이면 원문 그대로(지어내지 않는다)
  const tAttr = useTAttr();

  // Load dept access config from API
  const [deptAccessMap, setDeptAccessMap] = useState<Record<string, string[]>>(DEFAULT_DEPT_ACCESS);
  // 메뉴 오버라이드(href별 숨김/역할/라벨) — 관리자 구성·권한 설정.
  // 🔴 null = 아직 못 받음(로딩/실패) — 빈 객체(정상적으로 오버라이드 없음)와 다른 사실이다.
  const [menuOverrides, setMenuOverrides] = useState<Record<string, { hidden?: boolean; roles?: string[]; label?: string; order?: number }> | null>(null);
  // 조회 실패 시 무엇으로 접었는가: 'CACHE'=직전 성공값 · 'NONE'=캐시도 없어 기본 메뉴
  const [overridesFallback, setOverridesFallback] = useState<null | 'CACHE' | 'NONE'>(null);
  // 사용자 정의(커스텀) 메뉴 — 관리자가 추가한 항목
  const [menuCustom, setMenuCustom] = useState<Array<{ id: string; section: string; href: string; label: string; roles: string[] }>>([]);

  useEffect(() => {
    apiClient.get<{ data: Record<string, string[]> }>('/api/v1/access-control/dept-access')
      .then(res => { if (res.data) setDeptAccessMap(res.data); })
      .catch(() => {}); // fallback to defaults
    /**
     * 🔴 오버라이드 조회 실패를 `{}` 로 접으면 관리자가 숨긴 메뉴가 전부 되살아난다(fail-open·고지 없음).
     *    실패는 직전 성공값(localStorage 캐시)으로 접고, 그마저 없으면 기본 메뉴임을 배너로 밝힌다.
     *    (nav 숨김≠권한 회수 — API 는 RolesGuard 가 막는다. 그래서 여기서 메뉴 전체를 볼모로 잡지는 않는다.)
     */
    apiClient.get<{ data: Record<string, { hidden?: boolean; roles?: string[]; label?: string; order?: number }> }>('/api/v1/access-control/menu-overrides')
      .then(res => {
        const data = res.data ?? {};
        setMenuOverrides(data);
        setOverridesFallback(null);
        try { localStorage.setItem(MENU_OVERRIDE_CACHE_KEY, JSON.stringify(data)); } catch { /* 캐시 저장 실패는 무해 */ }
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem(MENU_OVERRIDE_CACHE_KEY);
          if (raw) { setMenuOverrides(JSON.parse(raw)); setOverridesFallback('CACHE'); return; }
        } catch { /* 캐시 읽기 실패 — 아래 NONE 으로 */ }
        setOverridesFallback('NONE');
      });
    apiClient.get<{ data: Array<{ id: string; section: string; href: string; label: string; roles: string[] }> }>('/api/v1/access-control/menu-custom')
      .then(res => { if (Array.isArray(res.data)) setMenuCustom(res.data); })
      .catch(() => {});
  }, []);

  const deptAllowedPaths = deptAccessMap[userDept];

  // 기본 메뉴 + 커스텀 메뉴 병합(섹션 title 기준)
  const sectionsWithCustom = NAV_SECTIONS.map(section => {
    const extra = menuCustom
      .filter(c => c.section === section.title)
      .map(c => ({ href: c.href, label: c.label, icon: ConfigIcon, roles: c.roles }));
    return extra.length ? { ...section, items: [...section.items, ...extra] } : section;
  });

  // 로딩 중·실패(캐시 없음)에는 빈 오버라이드로 그리되, 실패는 아래 배너가 사실을 말한다
  const ovMap = menuOverrides ?? {};
  const visibleSections = sectionsWithCustom.map(section => ({
    ...section,
    items: section.items
      .map((item, idx) => ({ ...item, label: ovMap[item.href]?.label ?? item.label, _ord: ovMap[item.href]?.order ?? idx }))
      .sort((a, b) => a._ord - b._ord) // 관리자 드래그 순서 적용
      .filter(item => isNavItemVisible(item, { role: userRole, dept: userDept, specialty: user?.specialty, deptAllowedPaths, override: ovMap[item.href] })),
  })).filter(section => section.items.length > 0);

  if (collapsed) {
    return (
      <SidebarRail
        domains={MENU_DOMAINS.map((d) => ({ domain: d, sections: visibleSections.filter((s) => domainOf(s.title) === d.key) })).filter((d) => d.sections.length > 0)}
        pathname={pathname} onNavigate={onNavigate} onToggleCollapse={onToggleCollapse}
        onLogoClick={canUseAiChat(userRole) ? onLogoClick : undefined} overridesFallback={overridesFallback}
      />
    );
  }

  return (
    <aside className="w-[232px] bg-slate-900 text-white h-full min-h-screen flex flex-col max-h-screen" aria-label={tAttr('주 내비게이션')}>
      <div className="px-4 py-4 border-b border-slate-700/50 flex items-center justify-between">
        {/* 🔴 어시스턴트 EP 는 의사·간호(+ADMIN 우회) 전용 — 다른 역할에게 열기 버튼을 보이면
            열자마자 403 이다(2026-09-04 실측). nav 를 API 에 맞춘다: 허용 역할에만 버튼, 나머지는 로고만 */}
        {canUseAiChat(userRole) ? (
          <button onClick={onLogoClick} className="flex items-center gap-3 text-left group" aria-label={`${AI_ORIGIN_TEXT} 어시스턴트 열기`} title={`${AI_ORIGIN_TEXT} 어시스턴트 열기`}>
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-500 transition-colors">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">WERUBYHOSP</h1>
              <p className="text-[10px] text-slate-400">위루비병원</p>
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-3 text-left">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-white" aria-hidden="true">W</span>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">WERUBYHOSP</h1>
              <p className="text-[10px] text-slate-400">위루비병원</p>
            </div>
          </div>
        )}
        <button onClick={onNavigate} className="lg:hidden p-1 rounded-lg hover:bg-slate-700 transition-colors" aria-label={tAttr('메뉴 닫기')}>
          <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <nav className="flex-1 px-2 py-2 overflow-y-auto scrollbar-thin" aria-label={tAttr('사이드바 메뉴')}>
        {overridesFallback && (
          <p className="mx-1 mb-1.5 px-2 py-1.5 rounded-lg bg-amber-500/10 text-amber-300 text-[10px] leading-snug" role="status">
            {overridesFallback === 'CACHE'
              ? <T k="메뉴 설정을 불러오지 못해 마지막으로 받은 설정으로 표시 중입니다." />
              : <T k="메뉴 설정을 불러오지 못했습니다 — 관리자 숨김·순서가 반영되지 않은 기본 메뉴입니다." />}
          </p>
        )}
        {MENU_DOMAINS.map((domain) => {
          const dsections = visibleSections.filter((s) => domainOf(s.title) === domain.key);
          if (!dsections.length) return null;
          return (
            <SidebarDomain key={domain.key} domain={domain} sections={dsections} pathname={pathname} onNavigate={onNavigate} userRole={userRole} />
          );
        })}
      </nav>
      <div className="px-3 pt-2 border-t border-slate-700/50">
        {onToggleCollapse && (
          <button type="button" onClick={onToggleCollapse} data-sidebar-toggle="collapse"
            className="mb-1 hidden w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200 lg:flex">
            <ChevronsLeft className="h-3.5 w-3.5" /><T k="메뉴 접기(아이콘으로)" />
          </button>
        )}
        <ManualLink role={userRole} onNavigate={onNavigate} />
        <EduLauncher />
        <ErpLauncher role={userRole} userId={user?.id} />
        <p className="text-[9px] text-slate-600 px-1 pb-2">{HIS_VERSION} · FHIR R4</p>
      </div>
    </aside>
  );
}

// --- SVG Icon Components ---
// ── Collapsible Section ──

// ── 아이콘 줄(rail) — 좁은 화면에서 자동으로 · 대분류 아이콘을 누르면 옆으로 그 대분류 메뉴가 펼쳐진다(2026-09-29) ──
function SidebarRail({ domains, pathname, onNavigate, onToggleCollapse, onLogoClick, overridesFallback }: {
  domains: { domain: { key: string; title: string; desc: string }; sections: Parameters<typeof SidebarSection>[0]['section'][] }[];
  pathname: string; onNavigate?: () => void; onToggleCollapse?: () => void; onLogoClick?: () => void;
  overridesFallback: null | 'CACHE' | 'NONE';
}) {
  const tAttr = useTAttr();
  const [fly, setFly] = useState<{ key: string; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  useEffect(() => { setFly(null); }, [pathname]);
  useEffect(() => {
    if (!fly) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || railRef.current?.contains(t)) return;
      setFly(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFly(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [fly]);
  const activeKey = domains.find((d) => d.sections.some((s) => s.items.some((i) => pathname === i.href || pathname?.startsWith(i.href + '/'))))?.domain.key;
  const open = fly ? domains.find((d) => d.domain.key === fly.key) : undefined;
  return (
    <aside ref={railRef} className="relative flex h-full max-h-screen min-h-screen w-[64px] flex-col items-center bg-slate-900 text-white" aria-label={tAttr('주 내비게이션')} data-sidebar-rail>
      <div className="flex w-full justify-center border-b border-slate-700/50 py-3">
        <button type="button" onClick={onLogoClick} disabled={!onLogoClick} title={onLogoClick ? `${AI_ORIGIN_TEXT} 어시스턴트 열기` : undefined} aria-label={onLogoClick ? `${AI_ORIGIN_TEXT} 어시스턴트 열기` : undefined}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white enabled:hover:bg-indigo-500">W</button>
      </div>
      <nav className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-2" aria-label={tAttr('사이드바 메뉴')}>
        {overridesFallback && <span className="mb-1 h-1.5 w-1.5 rounded-full bg-amber-400" title={tAttr('메뉴 설정을 불러오지 못했습니다 — 관리자 숨김·순서가 반영되지 않은 기본 메뉴입니다.')} />}
        {domains.map(({ domain }) => {
          const Icon = DOMAIN_ICON[domain.key] ?? HeartPulse;
          const isOpen = fly?.key === domain.key;
          const isActive = activeKey === domain.key;
          return (
            <button key={domain.key} type="button" data-rail-domain={domain.key}
              onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setFly(isOpen ? null : { key: domain.key, top: r.top }); }}
              aria-expanded={isOpen} aria-label={tAttr(domain.title)} title={tAttr(domain.title)}
              className={`group relative flex w-12 flex-col items-center gap-0.5 rounded-xl py-1.5 transition ${isOpen ? 'bg-slate-700 text-white' : isActive ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <Icon className="h-5 w-5" />
              <span className="w-full truncate px-0.5 text-center text-[9px] leading-tight"><T k={domain.title} /></span>
            </button>
          );
        })}
      </nav>
      {onToggleCollapse && (
        <button type="button" onClick={onToggleCollapse} data-sidebar-toggle="expand" aria-label={tAttr('메뉴 펼치기')} title={tAttr('메뉴 펼치기')}
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white">
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}
      <p className="pb-2 text-[8px] text-slate-600">{HIS_VERSION}</p>
      {/* 🔴 (2026-10-01) 펼침 메뉴는 body 로 띄운다 — 조상 상자에 이동(translate)·transform 이 남아 쌓임 맥락이 생기면
          fixed z-[60] 이 그 안에 갇혀 본문 카드 **아래**에 깔렸다(통합 상황판 스크린샷). 조상이 무엇이든 맨 위에 그린다. */}
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={panelRef} role="dialog" aria-label={tAttr(open.domain.title)} data-rail-flyout={open.domain.key}
          className="fixed left-[68px] z-[60] w-[248px] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl"
          style={{ top: Math.max(8, Math.min(fly!.top - 8, typeof window !== 'undefined' ? window.innerHeight - 320 : fly!.top)), maxHeight: 'calc(100vh - 16px)' }}>
          <p className="px-2.5 pb-1 pt-1 text-[12px] font-bold text-slate-100"><T k={open.domain.title} /></p>
          {open.sections.map((section) => (
            <SidebarSection key={section.title} section={section} pathname={pathname} onNavigate={() => { setFly(null); onNavigate?.(); }} forceOpen />
          ))}
        </div>,
        document.body,
      )}
    </aside>
  );
}

// ── 도메인(대분류·8) — 펼치면 하위 섹션 표시. 사이드바 최상위는 8개만 ──
function SidebarDomain({ domain, sections, pathname, onNavigate, userRole }: {
  domain: { key: string; title: string; desc: string };
  sections: { title: string; items: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; roles: string[] }[] }[];
  pathname: string;
  onNavigate?: () => void;
  userRole: string;
}) {
  const hasActive = sections.some(s => s.items.some(i => pathname === i.href || pathname?.startsWith(i.href + '/')));
  const tAttr = useTAttr();
  const [open, setOpen] = useState(hasActive || (DEFAULT_OPEN_DOMAINS[userRole] ?? []).includes(domain.key));
  useEffect(() => { if (hasActive && !open) setOpen(true); }, [hasActive]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`${tAttr(domain.title)} ${open ? tAttr('접기') : tAttr('펼치기')}`}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-bold text-slate-200 hover:bg-slate-800/60 transition-colors"
      >
        {/* 🔴 카탈로그에 키를 넣어도 화면이 부르지 않으면 안 바뀐다(2026-09-09 실측: 대분류 8개가 그랬다) */}
        <T k={domain.title} />
        <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div className="mt-0.5">
          {sections.map(section => (
            <SidebarSection key={section.title} section={section} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarSection({ section, pathname, onNavigate, forceOpen = false }: {
  section: { title: string; items: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; roles: string[] }[] };
  pathname: string;
  onNavigate?: () => void;
  /** 아이콘 줄의 펼침 패널 — 처음부터 펼쳐 둔다 */
  forceOpen?: boolean;
}) {
  const exactOnly = ['/dashboard', '/checkup', '/workstation'];
  const sectionHrefs = section.items.map(i => i.href);
  // prefix 매칭이라도 더 구체적인 형제 경로(예: /patients/register/emergency)가 매칭되면 부모(/patients)는 비활성
  const isItemActive = (href: string) => {
    if (pathname === href) return true;
    if (exactOnly.includes(href) || !pathname?.startsWith(href + '/')) return false;
    const moreSpecific = sectionHrefs.some(h => h !== href && h.startsWith(href + '/') && (pathname === h || pathname.startsWith(h + '/')));
    return !moreSpecific;
  };
  const hasActive = section.items.some(item => isItemActive(item.href));
  const [open, setOpen] = useState(hasActive || forceOpen);
  const hubKey = sectionKeyOf(section.title);
  // 🔴 라벨·title 데이터는 정본 키(한국어) 그대로 — 번역은 렌더 지점(T/tAttr)에서만 조회한다
  const tAttr = useTAttr();

  // 경로 변경 시 활성 섹션 자동 열기
  useEffect(() => {
    if (hasActive && !open) setOpen(true);
  }, [hasActive]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mb-0.5">
      {/* 섹션 헤더 — 라벨 클릭=허브(설명+화면 카드), 화살표=인라인 펼침 */}
      <div className="w-full flex items-center gap-1 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-slate-500">
        {hubKey ? (
          <Link href={`/menu/${hubKey}`} onClick={onNavigate} className="flex-1 hover:text-slate-200 transition-colors truncate" title={`${tAttr(section.title)} ${tAttr('안내')}`}>
            <T k={section.title} />
          </Link>
        ) : (
          <T k={section.title} className="flex-1 truncate" />
        )}
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={`${tAttr(section.title)} ${open ? tAttr('접기') : tAttr('펼치기')}`}
          className="p-0.5 -mr-0.5 rounded hover:bg-slate-800/60"
        >
          <svg className={`w-3 h-3 text-slate-600 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      {open && section.items.map((item, idx) => {
        const isActive = isItemActive(item.href);
        /**
         * 🔴 소분류 헤더는 **그룹이 바뀌는 첫 항목 앞에서만** 그린다.
         *    항목마다 그리면 목록이 헤더로 뒤덮이고, 한 번만 그리면 접힘/필터로
         *    앞 항목이 사라졌을 때 **헤더가 통째로 없어진다**(역할 필터가 실제로 항목을 지운다).
         */
        const group = (item as { group?: string }).group;
        const prevGroup = idx > 0 ? (section.items[idx - 1] as { group?: string }).group : undefined;
        const showGroup = !!group && group !== prevGroup;
        const Icon = item.icon;
        // 외부(http/https) 커스텀 링크는 새 탭 + noopener 로 안전 렌더(탭내비깅·레퍼러 유출 차단). 내부는 Link.
        const isExternal = /^https?:\/\//i.test(item.href);
        const cls = `group relative flex items-center gap-2 pl-3.5 pr-3 py-1.5 rounded-lg mb-px text-[12px] font-medium transition-all duration-150 ${
          isActive
            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-indigo-600/30'
            : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
        }`;
        const inner = (
          <>
            {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-1 rounded-full bg-white/80" aria-hidden="true" />}
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`} aria-hidden="true" />
            <T k={item.label} className="flex-1" />
            {SCREEN_CODE_BY_HREF[item.href] && (
              <span className={`text-[9px] tabular-nums ${isActive ? 'text-white/60' : 'text-slate-600 group-hover:text-slate-400'}`} aria-hidden="true">{SCREEN_CODE_BY_HREF[item.href]}</span>
            )}
          </>
        );
        const link = isExternal ? (
          <a key={item.href} href={item.href} onClick={onNavigate} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
        ) : (
          <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={isActive ? 'page' : undefined} className={cls}>{inner}</Link>
        );
        if (!showGroup) return link;
        return (
          <div key={`g-${group}`}>
            <T k={group} className="block px-3.5 pt-2 pb-0.5 text-[9px] font-semibold text-slate-600 tracking-wide" />
            {link}
          </div>
        );
      })}
    </div>
  );
}

function DashboardIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" /></svg>);
}
function PatientsIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>);
}
function ScheduleIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>);
}
function OrdersIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>);
}
function PharmacyIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 6v3m0 0v3m0-3h3m-3 0H7.5M6 20.25h12A2.25 2.25 0 0020.25 18V6.75A2.25 2.25 0 0018 4.5H6A2.25 2.25 0 003.75 6.75v11.25A2.25 2.25 0 006 20.25z" /></svg>);
}
function LabIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-1.756 4.39A2.25 2.25 0 0115.146 21H8.854a2.25 2.25 0 01-2.098-1.61L5 14.5m14 0H5" /></svg>);
}
function ImagingIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>);
}
function SurgeryIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>);
}
function EmergencyIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>);
}
function InpatientIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>);
}
function RoundIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" /></svg>);
}
function HandoffIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>);
}
function BedIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" /></svg>);
}
function NutritionIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 8.25v-1.5m-6 1.5v-1.5m12 9.75l-1.5.75a3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0L3 16.5m15-3.379a48.474 48.474 0 00-6-.371c-2.032 0-4.034.126-6 .371m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.169c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 013 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 016 13.12" /></svg>);
}
function BillingIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>);
}
function ClaimIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21" /></svg>);
}
function InventoryIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>);
}
function CssdIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.545 5.975 5.975 0 01-2.133-1.001A3.75 3.75 0 0012 18z" /></svg>);
}
function EquipmentIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.42 15.17l-5.25 3.03a.75.75 0 01-1.08-.67V6.61a.75.75 0 01.37-.65l5.25-3.03a.75.75 0 01.74 0l5.25 3.03a.75.75 0 01.37.65v10.92a.75.75 0 01-1.08.67l-5.25-3.03a.75.75 0 00-.74 0z" /></svg>);
}
function HrIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>);
}
function SafetyIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>);
}
function InfectionIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z" /></svg>);
}
function QualityIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>);
}
function EducationIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" /></svg>);
}
function FormIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>);
}
function BotIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>);
}
function ExtensionIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 00.657-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58z" /></svg>);
}
function ConfigIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>);
}
function CertIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.746 3.746 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" /></svg>);
}
function ReceptionIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>);
}
function IcuIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8.25v3.75m-1.875-1.875h3.75" /></svg>);
}
function DiagnosticsIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v-2.5m3 2.5v-4.5m3 4.5v-1.5" /></svg>);
}
function ExecutiveIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941" /></svg>);
}
function AccessControlIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>);
}
function NursingIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 11v3m0 0v3m0-3h3m-3 0H9" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18.5c1.5 0 2.5-.8 2.5-1.5" /></svg>);
}
function ClinicalIcon({ className }: { className?: string }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" /></svg>);
}
