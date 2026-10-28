import { ConsentType, ImagingResultStatus, Prisma, PrismaClient, UserRole } from '@prisma/client';
import { CRITICAL_LAB_FLAGS, rawSeverityAliases } from '@hospital-run/shared';
import { DOCTOR_SIGN_REQUIRED_CONSENT_TYPES } from '../../common/consent-types';
import { nonEmptyStringArrayOr } from '../../common/qi-targets';
import { IONIZING_MODALITY_VALUES } from '../../common/imaging-modality';
import { CRITICAL_ALERT_ACKNOWLEDGED_STATUSES, CRITICAL_ALERT_OPEN_STATUSES } from '../lab/critical-value-alert-states';

/**
 * 데이터 품질 지표 레지스트리(등록제) — 기획 data-quality-concierge.plan.md §2.5+.
 * 규약: 모든 지표는 워크리스트 딥링크(drillDown) 필수 — "누가 어디서 고치는가"까지가 지표의 정의.
 */
export interface QualityMetric {
  key: string; // 'patient.noPhone'
  domain: string; // patient | encounter | order | ...
  label: string;
  compute: (prisma: PrismaClient | Prisma.TransactionClient) => Promise<{ value: number; total?: number }>;
  drillDown: string; // FE 딥링크
  thresholdKey?: string; // config quality.threshold.<key>
  severityWhenOver: 'INFO' | 'WARNING' | 'CRITICAL';
  roles: UserRole[]; // 노출 대상(P1까지는 ADMIN 위주)
}

const YEAR = 365 * 86400_000;

/** P0: 환자 도메인 지표(현행 대시보드 이식 + 개선 2종) */
/**
 * 🔴 도메인 산출주체 역할 (B4 · 2026-08-31) — 자기 도메인 워크리스트를 그 직군이 본다
 * ("워크리스트가 없으면 직원은 기억으로 일한다"). 🔴 여는 게 항상 답은 아니다 — PII·임상판단·재무
 * 성격 도메인(patient·encounter·billing 등)은 ADMIN 유지, 명백한 현장 산출주체만 연다.
 */
export const DOMAIN_OWNER_ROLES: Record<string, UserRole[]> = {
  lab: [UserRole.LAB_TECH],
  nursing: [UserRole.NURSE],
  safety: [UserRole.NURSE],
};

/** 이 역할이 이 지표를 볼 수 있나 — ADMIN 전부 · 지표 declared roles · 도메인 산출주체 */
export function canViewMetric(m: QualityMetric, role?: string | null): boolean {
  if (role === UserRole.ADMIN) return true;
  if (!role) return false;
  if (m.roles.some((r) => (r as string) === role)) return true;
  return (DOMAIN_OWNER_ROLES[m.domain] ?? []).some((r) => (r as string) === role);
}

export const PATIENT_METRICS: QualityMetric[] = [
  {
    key: 'patient.noPhone', domain: 'patient', label: '전화번호 미등록',
    compute: async (p) => ({ value: await p.patient.count({ where: { validTo: null, phone: null } }), total: await p.patient.count({ where: { validTo: null } }) }),
    drillDown: '/patients?quality=noPhone', thresholdKey: 'quality.threshold.patient.noPhone', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'patient.noInsurance', domain: 'patient', label: '보험정보 미확인',
    compute: async (p) => ({ value: await p.patient.count({ where: { validTo: null, insuranceNumber: null } }) }),
    drillDown: '/patients?quality=noInsurance', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
  {
    key: 'patient.noAddress', domain: 'patient', label: '주소 미등록',
    compute: async (p) => ({ value: await p.patient.count({ where: { validTo: null, address: { equals: Prisma.AnyNull } } }) }),
    drillDown: '/patients?quality=noAddress', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
  {
    key: 'patient.dormant', domain: 'patient', label: '1년 이상 미내원',
    compute: async (p) => ({ value: await p.patient.count({ where: { validTo: null, encounters: { none: { createdAt: { gte: new Date(Date.now() - YEAR) } } } } }) }),
    drillDown: '/patients?quality=dormant', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
  {
    key: 'patient.noPhoto', domain: 'patient', label: '사진 미등록',
    compute: async (p) => ({ value: await p.patient.count({ where: { validTo: null, photoUrl: null } }) }),
    drillDown: '/patients?quality=noPhoto', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
  {
    key: 'patient.passportExpiring', domain: 'patient', label: '여권 만료 임박(90일)',
    compute: async (p) => ({ value: await p.patient.count({ where: { validTo: null, nationality: { notIn: ['KR', 'KOR'], not: null }, passportExpiry: { lt: new Date(Date.now() + 90 * 86400_000) } } }) }),
    drillDown: '/patients?quality=passportExpiring', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
];

const H = 3600_000;
const D = 86400_000;

/** P1: 진료기록 */
export const ENCOUNTER_METRICS: QualityMetric[] = [
  {
    key: 'encounter.unsignedStale', domain: 'encounter', label: '미서명 진료 방치(48h↑)',
    compute: async (p) => ({ value: await p.encounter.count({ where: { status: 'DRAFT', createdAt: { lt: new Date(Date.now() - 48 * H) } } }) }),
    drillDown: 'panel', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'encounter.noDiagnosis', domain: 'encounter', label: '진단코드 없는 서명 진료(30일)',
    compute: async (p) => ({ value: await p.encounter.count({ where: { status: { in: ['SIGNED', 'AMENDED'] }, createdAt: { gte: new Date(Date.now() - 30 * D) }, diagnoses: { none: {} } } }) }),
    drillDown: 'panel', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
];

/** P1: 처방/오더 */
export const ORDER_METRICS: QualityMetric[] = [
  {
    key: 'order.staleOrdered', domain: 'order', label: '오더 접수 방치(24h↑)',
    compute: async (p) => ({ value: await p.order.count({ where: { status: 'ORDERED', receivedAt: null, createdAt: { lt: new Date(Date.now() - 24 * H) } } }) }),
    drillDown: '/orders', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
];

/** P1: 입원 */
export const ADMISSION_METRICS: QualityMetric[] = [
  {
    key: 'admission.noAttending', domain: 'admission', label: '재원 주치의 미지정',
    compute: async (p) => ({ value: await p.admission.count({ where: { status: 'ADMITTED', attendingDoctorId: null } }) }),
    drillDown: '/inpatient', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  /**
   * 🔴 2026-08-21 입원 흐름 검토 — **의무기록·이력 누락을 세는 곳이 없었다.**
   *    운영 실측: 퇴원 28건 중 **퇴원요약 없음 22건** · 재원 5명 중 **병상 배정 이력 없음 4명**.
   *    퇴원 게이트(`inpatient.dischargeGate`)는 **앞으로의 퇴원**을 막는다 —
   *    이미 쌓인 누락과 게이트가 적용되지 않는 경로(시드·직접 INSERT)는 보지 않는다.
   *    수술 흐름(§부록 C)과 같은 처방: **"없는 것"을 분모와 함께 센다.**
   */
  {
    key: 'admission.dischargeSummaryMissing', domain: 'admission',
    // 🔴 기존 `admission.summaryMissing`(최근 30일 · 서명 안 됨)과 **다른 질문**이다.
    //    이쪽은 **역대 전체 · 요약 행 자체가 없는 것**을 센다(의무기록 누락 누적).
    //    라벨이 서로를 구분하지 못하면 화면에서 왜 수가 다른지 아무도 모른다(운영 실측 10 vs 22).
    label: '퇴원요약이 아예 없음(역대 누적 — 30일 지표와 다른 질문)',
    compute: async (p) => {
      const [total, discharged, summaries] = await Promise.all([
        p.admission.count({ where: { status: 'DISCHARGED' } }),
        p.admission.findMany({ where: { status: 'DISCHARGED' }, select: { id: true } }),
        p.dischargeSummary.findMany({ select: { admissionId: true } }),
      ]);
      const have = new Set(summaries.map((d) => d.admissionId));
      return { value: discharged.filter((a) => !have.has(a.id)).length, total };
    },
    drillDown: '/inpatient', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
  {
    key: 'admission.bedAssignmentMissing', domain: 'admission', label: '재원인데 병상 배정 이력 없음',
    // 🔴 `admissions.bedId` 는 **현재 병상**만 말한다. "언제 이 병상에 왔는가"는 배정 이력이 정본이고,
    //    그것이 비면 병상 이력 조회·ER 베드 보드가 그 환자를 설명하지 못한다.
    compute: async (p) => {
      const admitted = await p.admission.findMany({ where: { status: 'ADMITTED' }, select: { id: true } });
      const assigns = await p.bedAssignment.findMany({ where: { releasedAt: null }, select: { admissionId: true } });
      const have = new Set(assigns.map((b) => b.admissionId));
      return { value: admitted.filter((a) => !have.has(a.id)).length, total: admitted.length };
    },
    drillDown: '/beds', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'admission.staleProtocol', domain: 'admission', label: '퇴원했는데 임상 프로토콜이 진행 중',
    /**
     * 🔴 **자동으로 끊지 않는다** — 프로토콜은 퇴원 후 외래로 이어질 수 있어 종료 여부는 임상 판단이다
     *    (급양 축의 "자동으로 끊는 방향은 사람 판단"과 같은 이유). 대신 **드러낸다.**
     *    분모 = 입원에 묶인 진행 중 프로토콜 전체.
     */
    compute: async (p) => {
      const active = await p.protocolInstance.findMany({
        where: { status: 'ACTIVE', admissionId: { not: null } },
        select: { admissionId: true },
      });
      if (!active.length) return { value: 0, total: 0 };
      const ids = [...new Set(active.map((x) => x.admissionId!))];
      const open = await p.admission.findMany({ where: { id: { in: ids }, status: 'ADMITTED' }, select: { id: true } });
      const openSet = new Set(open.map((a) => a.id));
      return { value: active.filter((x) => !openSet.has(x.admissionId!)).length, total: active.length };
    },
    drillDown: '/inpatient', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
];

/**
 * P3: 수술 — 🔴 **법정 의무기록 누락을 세는 곳이 없었다**(2026-08-21 수술 흐름 검토).
 *
 * 안전 게이트 관제는 체크리스트 이행을 **최근 30일**로 본다(추세 지표라 정당).
 * 그런데 **수술기록지(Op Note) 자체가 없는 완료 수술**은 어디서도 세지 않았다.
 * 운영 실측: 완료 46건 중 **수술기록지 없음 10건**(그중 **8건은 체크리스트도 없음**).
 * 수술기록은 의무기록 보존 대상이다 — 없으면 그 사실이 화면에 떠야 한다.
 */
/**
 * 응급 도메인 — 시드 흐름 전수 검토 5단계(§부록 E).
 * 🔴 이 도메인은 레지스트리에 **지표가 하나도 없었다.** 기능·게이트·전광판은 다 있는데
 *    "무엇이 기록되지 않았는가"를 세는 곳이 없어, 트리아지 사실이 개통 이래 한 번도
 *    원장에 남지 않은 것을 아무 화면도 말하지 못했다.
 */
export const EMERGENCY_METRICS: QualityMetric[] = [
  {
    key: 'emergency.triageActMissing', domain: 'emergency',
    // 🔴 KTAS 등급은 **분류의 산출물**이다. 등급이 있는데 분류 시각이 없다는 것은
    //    "분류했다고 적었지만 언제·누가 했는지는 없다"는 뜻이다(응급의료법상 중증도 분류는 법정 기록).
    //    봉합(createTriage 가 triagedAt/triageNurseId 기록) 이전 건은 여기 남는다 — 지우지 않는다.
    label: '중증도 분류 시각이 없는 응급 방문(등급만 있음)',
    compute: async (p) => {
      const total = await p.emergencyVisit.count();
      const value = await p.emergencyVisit.count({ where: { triagedAt: null } });
      return { value, total };
    },
    drillDown: '/emergency', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
  {
    key: 'emergency.triageNurseMissing', domain: 'emergency',
    // 분류 시각은 있는데 **분류자**가 없는 건 — 시각과 주체는 다른 사실이라 따로 센다.
    // 분모는 "분류 시각이 있는 건"이다(분류 자체가 없는 건은 위 지표가 센다 — 두 번 세지 않는다).
    label: '분류자(간호사)가 없는 중증도 분류',
    compute: async (p) => {
      const total = await p.emergencyVisit.count({ where: { triagedAt: { not: null } } });
      const value = await p.emergencyVisit.count({ where: { triagedAt: { not: null }, triageNurseId: null } });
      return { value, total };
    },
    drillDown: '/emergency', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'emergency.dispositionRecordMissing', domain: 'emergency',
    /**
     * 🔴 처분(퇴원·입원·전원)은 방문의 `disposition` 필드와 `EmergencyDispositionRecord` **두 곳**에 있다.
     *    원장 쪽에만 결정자·귀가지침·전원기관·전원사유가 담긴다. 필드만 있고 원장이 없으면
     *    **누가 그 처분을 결정했는지 아무 데도 없다.** 분모 = 처분이 정해진 방문 전체.
     *    (원장 없이 필드만 쓰는 경로가 실제로 있다 — 계획서 §부록 E 의 후보 참조)
     */
    label: '처분은 정해졌는데 처분 원장이 없음(결정자 미상)',
    compute: async (p) => {
      const decided = await p.emergencyVisit.findMany({ where: { disposition: { not: null } }, select: { id: true } });
      if (!decided.length) return { value: 0, total: 0 };
      const records = await p.emergencyDispositionRecord.findMany({ select: { visitId: true } });
      const have = new Set(records.map((r) => r.visitId));
      return { value: decided.filter((v) => !have.has(v.id)).length, total: decided.length };
    },
    drillDown: '/emergency', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'emergency.dispositionDisagree', domain: 'emergency',
    /**
     * 🔴 같은 방문에 처분이 **둘인데 서로 다른** 경우(P12). 목록 배지는 방문 필드를,
     *    처분 변경 패널은 원장을 읽는다 — 같은 환자에게 화면마다 다른 처분이 보인다.
     *    **어느 쪽이 맞는지 시스템은 모른다.** 고르지 않고 드러낸다.
     */
    label: '방문 처분과 처분 원장이 서로 다름(같은 사실에 답이 둘)',
    compute: async (p) => {
      const records = await p.emergencyDispositionRecord.findMany({ select: { visitId: true, disposition: true } });
      if (!records.length) return { value: 0, total: 0 };
      const visits = await p.emergencyVisit.findMany({
        where: { id: { in: records.map((r) => r.visitId) } },
        select: { id: true, disposition: true },
      });
      const byId = new Map(visits.map((v) => [v.id, v.disposition as string | null]));
      const value = records.filter((r) => {
        const field = byId.get(r.visitId);
        return field != null && field !== r.disposition;
      }).length;
      return { value, total: records.length };
    },
    drillDown: '/emergency', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
];

export const SURGERY_METRICS: QualityMetric[] = [
  {
    key: 'surgery.opNoteMissing', domain: 'surgery', label: '완료 수술인데 수술기록지 없음',
    // 🔴 분모(완료 수술)를 함께 낸다 — 분모가 0이면 "누락 0"은 성과가 아니라 표본 부재다.
    compute: async (p) => {
      const [total, notes] = await Promise.all([
        p.surgery.count({ where: { status: 'COMPLETED' } }),
        p.surgeryOpNote.findMany({ select: { surgeryId: true } }),
      ]);
      const have = new Set(notes.map((n) => n.surgeryId));
      const completed = await p.surgery.findMany({ where: { status: 'COMPLETED' }, select: { id: true } });
      return { value: completed.filter((s) => !have.has(s.id)).length, total };
    },
    drillDown: '/surgery', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
  {
    key: 'surgery.checklistMissing', domain: 'surgery', label: '수술방을 거쳤는데 안전 체크리스트 없음(IPSG.4)',
    // 게이트 관제(2408)는 30일 추세를 보고, 이 지표는 **누적 전체**를 본다 — 둘은 다른 질문이다.
    compute: async (p) => {
      const completed = await p.surgery.findMany({
        where: { status: { in: ['IN_PROGRESS', 'COMPLETED'] } }, select: { id: true },
      });
      const lists = await p.surgicalChecklist.findMany({ select: { surgeryId: true } });
      const have = new Set(lists.map((c) => c.surgeryId));
      return { value: completed.filter((s) => !have.has(s.id)).length, total: completed.length };
    },
    drillDown: '/surgery', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
];

/** P2: 검사 */
/**
 * 영상 도메인 — 시드 흐름 전수 검토 6단계.
 * 🔴 응급(5단계)과 같은 자리에서 같은 것이 나왔다. 안전게이트(조영제·임신·누적선량)도,
 *    선량 입력 UI 도, 누적선량 조회 EP 도 다 있는데 **"기록되지 않은 것"을 세는 곳이 없었다.**
 *    운영 실측(2026-08-24): 전리방사선 촬영 117건에 `radiation_exposures` **0행** —
 *    누적선량 게이트가 개통 이래 한 번도 잴 것을 가진 적이 없다.
 */
export const IMAGING_METRICS: QualityMetric[] = [
  {
    key: 'imaging.doseUnrecorded', domain: 'imaging',
    /**
     * 🔴 선량 입력은 촬영 화면의 **선택 입력**이라, 비워도 아무 일도 일어나지 않는다.
     *    그러면 `checkCumulativeDose` 는 영원히 "기록 없음"이고, 누적선량 경보(imaging.doseAlertMsv)는
     *    구조적으로 발동하지 않는다 — **켜져 있는데 잴 것이 없는 게이트**다.
     *    막지 않는다(강제하면 아무 숫자나 채워진다). 세어서 드러낸다.
     *    분모 = **시행된** 전리방사선 촬영(오더만 난 건은 아직 잴 선량이 없다).
     */
    label: '전리방사선 촬영인데 피폭선량 기록 없음',
    compute: async (p) => {
      const where = {
        status: { in: [ImagingResultStatus.ACQUIRED, ImagingResultStatus.REPORTED] },
        modality: { in: IONIZING_MODALITY_VALUES },
      };
      const [total, withDose] = await Promise.all([
        p.imagingResult.count({ where }),
        p.imagingResult.count({ where: { ...where, exposure: { isNot: null } } }),
      ]);
      return { value: total - withDose, total };
    },
    drillDown: '/workstation/imaging', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'imaging.safetyCheckMissing', domain: 'imaging',
    /**
     * 시행 전 안전게이트 평가 결과(`safetyChecks`)가 시행 원장에 없는 건.
     * 🔴 안전 게이트 관제(`/admin/safety-gates`)는 바로 이 JSON 에서 조영제·임신 위반을 센다.
     *    여기가 비어 있으면 그 화면의 "위반 0" 은 준수가 아니라 **판정 자체가 없는 것**이다.
     *    (게이트 모드가 OFF 였던 기간·서비스 경로를 타지 않고 만들어진 건이 여기 남는다 — 지우지 않는다)
     */
    label: '시행 원장에 안전게이트 판정이 없음(위반 집계의 모집단 밖)',
    compute: async (p) => {
      const where = { status: { in: [ImagingResultStatus.ACQUIRED, ImagingResultStatus.REPORTED] } };
      const [total, value] = await Promise.all([
        p.imagingResult.count({ where }),
        p.imagingResult.count({ where: { ...where, safetyChecks: { equals: Prisma.DbNull } } }),
      ]);
      return { value, total };
    },
    drillDown: '/admin/safety-gates', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
  {
    key: 'imaging.procedureCodeMissing', domain: 'imaging',
    /**
     * 🔴 **이송 전 안전 확인이 눈을 감는 지점.** 영상 처방에 시술코드가 없으면
     *    조영 여부·전리방사선 여부를 판정할 근거가 없다 — 촬영 전에는 기록된 modality 조차 없으므로
     *    `precheck` 는 `modalityKnown:false` 로 접고, 조영제·임신·피폭 항목이 **한 개도 돌지 않는다**.
     *    `procedureCodeId` 는 처방 DTO 전 경로에서 선택이라 실경로로 만들어질 수 있다.
     *    막지 않는다(강제하면 아무 코드나 골라 붙인다 — v4.5.0 laterality 교훈). 세어서 드러낸다.
     */
    label: '영상 처방에 시술코드 없음(이송 전 안전 판정 불가)',
    compute: async (p) => {
      const where = { type: 'IMAGING' as const };
      const [total, value] = await Promise.all([
        p.prescription.count({ where }),
        p.prescription.count({ where: { ...where, procedureCodeId: null } }),
      ]);
      return { value, total };
    },
    drillDown: '/imaging', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'imaging.radiologistMissing', domain: 'imaging',
    /**
     * 판독은 끝났다고 적혀 있는데 **누가 판독했는지가 없는** 건. 판독 소견은 진료 판단의 근거라
     * 작성자가 없으면 되물을 곳이 없다. `imaging.report` 는 `radiologistId` 를 선택으로 받아
     * `null` 로 저장할 수 있다(워크스테이션 경로는 항상 로그인 사용자를 넣는다 — 경로가 둘이다).
     * §6 회수(2026-08-25): PACS 웹훅 판독은 원내 User 가 아니라 **표시명(radiologistName)** 만 온다 —
     * 이름이 있으면 판독자 미상이 아니다(둘 다 없을 때만 센다).
     */
    label: '판독 완료인데 판독자가 없음(원내 ID·외부 표시명 모두)',
    compute: async (p) => {
      const [total, value] = await Promise.all([
        p.imagingResult.count({ where: { status: 'REPORTED' } }),
        p.imagingResult.count({ where: { status: 'REPORTED', radiologistId: null, radiologistName: null } }),
      ]);
      return { value, total };
    },
    drillDown: '/imaging', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
];

export const LAB_METRICS: QualityMetric[] = [
  {
    key: 'lab.criticalPending', domain: 'lab', label: '위급값 미확인(PENDING·ESCALATED)',
    compute: async (p) => ({ value: await p.criticalValueAlert.count({ where: { status: { in: CRITICAL_ALERT_OPEN_STATUSES } } }) }),
    drillDown: 'panel', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
  {
    key: 'lab.readBackMissing', domain: 'lab', label: '복창(read-back) 미확인(확인 후 24h↑)',
    // 🔴 이 지표는 2026-08-18 까지 **구조적으로 영원히 0** 이었다.
    //    서비스가 `readBackConfirmed: data.readBack ?? true`, 화면은 체크박스 없이 늘 `readBack: true` →
    //    `readBackConfirmed=false` 인 행이 만들어질 수 없었고, 화면은 "복창 누락 없음"이라고 안심시켰다(P17).
    //    지금은 복창이 검증을 통과할 때만 true 라 이 분자가 실제로 채워진다.
    // 🔴 분모를 함께 낸다 — total(=같은 기간 확인 완료 건수)이 0 이면 "누락 0"은 **표본 부재**이지 성과가 아니다.
    compute: async (p) => {
      const since = new Date(Date.now() - 24 * H);
      const [value, total] = await Promise.all([
        p.criticalValueAlert.count({ where: { status: { in: CRITICAL_ALERT_ACKNOWLEDGED_STATUSES }, readBackConfirmed: false, acknowledgedAt: { lt: since } } }),
        p.criticalValueAlert.count({ where: { status: { in: CRITICAL_ALERT_ACKNOWLEDGED_STATUSES }, acknowledgedAt: { lt: since } } }),
      ]);
      return { value, total };
    },
    drillDown: 'panel', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'lab.criticalUnalerted', domain: 'lab', label: '위급 flag 원자료인데 경보 미생성',
    // 🔴 화면·지표가 "탐지된 경보"만 세면 원자료와 어긋난 채 초록이 뜬다.
    //    운영 실측(2026-08-18): lab_result_items 3,188건 중 flag HH/LL 6건에 대응하는 경보가 **0건**이다
    //    (시드가 submitResult 탐지 경로를 우회해 INSERT). 그런데 진단검사 보드는 그 6건에 대해
    //    "미보고 위험값이 없습니다 ✓" 초록을 띄웠다. 원자료 기준으로 세어 그 괴리를 드러낸다.
    //    분자 = 위급 flag 를 가진 결과지 중 CriticalValueAlert 가 하나도 없는 것, 분모 = 위급 flag 결과지 전체.
    compute: async (p) => {
      const groups = await p.labResultItem.groupBy({
        by: ['labResultId'],
        where: { flag: { in: [...CRITICAL_LAB_FLAGS] } },
      });
      const ids = groups.map((g) => g.labResultId);
      if (!ids.length) return { value: 0, total: 0 };
      const alerted = await p.criticalValueAlert.findMany({
        where: { labResultId: { in: ids } },
        select: { labResultId: true }, distinct: ['labResultId'],
      });
      const has = new Set(alerted.map((a) => a.labResultId));
      return { value: ids.filter((id) => !has.has(id)).length, total: ids.length };
    },
    drillDown: '/diagnostics-board', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
];

/** P2: 청구 */
export const BILLING_METRICS: QualityMetric[] = [
  {
    key: 'billing.unclaimed', domain: 'billing', label: '수납 후 미청구(30일↑)',
    compute: async (p) => ({ value: await p.billing.count({ where: { status: { in: ['PAID', 'PARTIAL'] }, paidAt: { lt: new Date(Date.now() - 30 * D) }, claims: { none: {} } } }) }),
    drillDown: '/claims', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
  {
    key: 'billing.missingForSignedEncounter', domain: 'billing',
    /**
     * 🔴 서명된 진료인데 **청구가 아예 없다.**
     *    청구는 `encounter.signed` 이벤트로 자동 생성되는데, 3회 재시도 후 실패하면
     *    종전에는 **로그 한 줄만 남고 끝났다.** 그런데 같은 리스너가 대기열은
     *    `CASHIER_WAITING` 으로 넘긴다 — **원무는 부를 환자가 있는데 청구 내역이 없다.**
     *    실패가 어느 화면에도 뜨지 않아 "안 낸 것"과 "못 만든 것"을 구분할 방법이 없었다.
     *    분모 = 서명·정정 진료 전체. 막지 않는다(진료를 되돌릴 수는 없다) — 세어서 드러낸다.
     */
    label: '서명 진료인데 청구 없음',
    compute: async (p) => {
      const where = { status: { in: ['SIGNED' as const, 'AMENDED' as const] } };
      const [total, value] = await Promise.all([
        p.encounter.count({ where }),
        p.encounter.count({ where: { ...where, billing: { is: null } } }),
      ]);
      return { value, total };
    },
    drillDown: '/billing', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'billing.receiptNoMissing', domain: 'billing',
    /**
     * 수납이 끝났는데 영수증번호가 없다 — 환자가 나중에 영수증을 요구하면 채번 근거가 없다.
     * 분모 = 수납완료 건. 🔴 0건이어도 지표를 둔다(생길 자리가 있다).
     */
    label: '수납완료인데 영수증번호 없음',
    compute: async (p) => {
      const where = { status: 'PAID' as const };
      const [total, value] = await Promise.all([
        p.billing.count({ where }),
        p.billing.count({ where: { ...where, OR: [{ receiptNo: null }, { receiptNo: '' }] } }),
      ]);
      return { value, total };
    },
    drillDown: '/billing', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
];

/** 10단계(안전·감염) — 시드 흐름 전수 검토 2026-08-24. 이 도메인은 v4.5.0(신원 보호)·AgentEMR 축에서
 *  이미 강화돼 눌러본 결과 실결함 0 — 지표 하나만 비어 있었다(만들지 않은 판단도 부록에 기록). */
export const SAFETY_METRICS: QualityMetric[] = [
  {
    key: 'safety.rcaMissingForSevere', domain: 'safety',
    /**
     * 중대(적신호 SENTINEL·CRITICAL) 사고인데 RCA 가 완료되지 않았다 — 환자안전 보고학습 체계에서
     * 중대사고 RCA 는 상시 과제다. stats EP 는 전체 RCA 완료율만 세고 **중대 분모를 따로 세지 않는다**
     * (모집단이 다르면 다른 질문). RCA due 초과는 /safety 화면이 이미 세므로 여기 중복 신설하지 않는다.
     * 🔴 severity 는 자유 문자열이라 shared `rawSeverityAliases` 후보로 필터한다(단일 값 비교는 어휘를 놓친다).
     *    중대의 정의는 정본 `isEscalatingSeverity`(SENTINEL·CRITICAL)와 동일 — 조용히 넓히지 않는다.
     */
    label: '중대 사고(적신호·위기)인데 RCA 미완료',
    compute: async (p) => {
      const severe = [...rawSeverityAliases('SENTINEL'), ...rawSeverityAliases('CRITICAL')];
      const where = { severity: { in: severe } };
      const [total, done] = await Promise.all([
        p.safetyIncident.count({ where }),
        p.safetyIncident.count({ where: { ...where, rcaCompleted: true } }),
      ]);
      return { value: total - done, total };
    },
    drillDown: '/safety', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
];

/** 8단계(검진) — 시드 흐름 전수 검토 2026-08-24. 🔴 이 도메인은 실쓰기 0(전건 생성기)라
 *  수치 대부분이 시드를 세지만, "생길 자리"의 탐지기로 둔다(분모와 함께). */
export const CHECKUP_METRICS: QualityMetric[] = [
  {
    key: 'checkup.gradeUnjudged', domain: 'checkup',
    /** 🔴 판정룰 38개가 개통 이래 매칭 0 이던 축(v4.4.0 DUR 43룰 유형) — 결과는 있는데 등급이 없다 */
    label: '검사 결과가 입력됐는데 프로토콜 판정 등급이 없음',
    compute: async (p) => {
      const where = { finding: { notIn: ['PENDING', 'NOT_APPLICABLE'] } };
      const [total, graded] = await Promise.all([
        p.checkupResultItem.count({ where }),
        p.checkupResultItem.count({ where: { ...where, grade: { not: null } } }),
      ]);
      return { value: total - graded, total };
    },
    drillDown: '/his-checkup/review', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'checkup.summaryMissing', domain: 'checkup',
    label: '검사가 끝났는데 종합소견이 없음',
    compute: async (p) => {
      const where = { status: { in: ['EXAM_COMPLETE', 'PARTIAL_COMPLETE', 'REVIEW', 'COMPLETED', 'DELIVERED'] } };
      const [total, have] = await Promise.all([
        p.checkupVisit.count({ where }),
        p.checkupVisit.count({ where: { ...where, summary: { isNot: null } } }),
      ]);
      return { value: total - have, total };
    },
    drillDown: '/his-checkup/review', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'checkup.summarySignerMissing', domain: 'checkup',
    /** 서명 시각은 있는데 서명자가 없다 — 런타임 signSummary 는 서명자를 남기므로 전건 시드 생성분.
     *  시드 정리 후 0 이 되어야 정상이고, 0 이 아닌 동안은 그 사실이 보여야 한다 */
    label: '서명 시각은 있는데 서명자가 없는 결과서',
    compute: async (p) => {
      const where = { signedAt: { not: null } };
      const [total, value] = await Promise.all([
        p.checkupSummary.count({ where }),
        p.checkupSummary.count({ where: { ...where, signedBy: null } }),
      ]);
      return { value, total };
    },
    drillDown: '/his-checkup/review', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
  {
    key: 'checkup.resultDocMissing', domain: 'checkup',
    label: '검진 완료인데 결과서 발급 기록 없음',
    compute: async (p) => {
      const visits = await p.checkupVisit.findMany({
        where: { status: { in: ['COMPLETED', 'DELIVERED'] } }, select: { id: true },
      });
      if (visits.length === 0) return { value: 0, total: 0 };
      const docs = await p.issuedDocument.findMany({
        where: { documentType: 'CHECKUP_RESULT', sourceId: { in: visits.map((v) => v.id) } },
        select: { sourceId: true },
      });
      const have = new Set(docs.map((d) => d.sourceId));
      return { value: visits.filter((v) => !have.has(v.id)).length, total: visits.length };
    },
    drillDown: '/his-checkup/review', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'checkup.resultSourceUnlinked', domain: 'checkup',
    /** 🔴 sourceType/sourceId 는 생산자가 아예 없다(자동수집이 항상 "0건 수집 완료"라 말하던 원인).
     *  검진↔검사·영상 오더 연결은 미구현이지 결함이 아니다 — INFO. 빨간 경보로 그리면 진짜 경보가 묻힌다.
     *
     *  🔴 B7 검토(2026-08-31): 자동수집을 **하지 않는다** — 신뢰할 연결 키가 없기 때문이다(B6 POA 와 동형·
     *  "실측이 기획을 이긴다"). LabResult·ImagingResult·DiagnosticTest·Order 에 **checkupVisit back-reference 가
     *  없고**, `CheckupTestMaster.code`(CBC_18·CHEST_PA…)↔검사/영상 코드 **매핑도 없다**. 이 상태에서 환자+
     *  명칭+날짜로 퍼지 매칭하면 **엉뚱한 원자료에 연결(sourceId 오귀속)** — 데이터 정합성을 스스로 훼손한다.
     *  활성화 전제(사람/스키마): ① 검진 패널이 검사·영상 오더를 **생성할 때 checkupResultItemId 를 심거나**
     *  ② `CheckupTestMaster` 에 오더 코드 매핑을 등재. 그 전엔 지어내지 않고 '미연결'로 센다. */
    label: '결과항목이 검사·영상 원자료에 연결돼 있지 않음(자동수집 불가 — 연결 키 부재)',
    compute: async (p) => {
      const total = await p.checkupResultItem.count();
      const value = await p.checkupResultItem.count({ where: { OR: [{ sourceType: null }, { sourceId: null }] } });
      return { value, total };
    },
    drillDown: '/his-checkup', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
];

/** 9단계(간호) — 시드 흐름 전수 검토 2026-08-24. 간호기록부는 의료법 §22 법정 의무기록 */
export const NURSING_METRICS: QualityMetric[] = [
  {
    key: 'nursing.initialAssessmentMissing', domain: 'nursing',
    label: '입원인데 간호 초기평가 없음(역대 누적)',
    /** 분모 = 취소 제외 전체 입원 — 분모 0 이면 "누락 0"은 성과가 아니라 표본 부재 */
    compute: async (p) => {
      const adms = await p.admission.findMany({ where: { status: { not: 'CANCELLED' } }, select: { id: true } });
      if (adms.length === 0) return { value: 0, total: 0 };
      const have = new Set(
        (await p.nursingAssessment.findMany({ select: { admissionId: true } })).map((a) => a.admissionId),
      );
      return { value: adms.filter((a) => !have.has(a.id)).length, total: adms.length };
    },
    drillDown: '/inpatient', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'nursing.noteNoneForAdmission', domain: 'nursing',
    label: '입원 전 기간에 간호기록이 한 건도 없음',
    compute: async (p) => {
      const where = { status: { not: 'CANCELLED' as const } };
      const [total, value] = await Promise.all([
        p.admission.count({ where }),
        p.admission.count({ where: { ...where, nursingNotes: { none: {} } } }),
      ]);
      return { value, total };
    },
    drillDown: '/nursing-station', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
  {
    key: 'nursing.ioRowAmountMissing', domain: 'nursing',
    /** 스테이션 I/O 쓰기가 whitelist 로 전부 지워져 "금액 없는 빈 행"이 저장되던 결함의 탐지기.
     *  현재 0/92 — 0 이지만 결함이 생길 자리라 둔다 */
    label: 'I/O 기록인데 섭취·배출 금액이 둘 다 없음',
    compute: async (p) => {
      const [total, value] = await Promise.all([
        p.intakeOutput.count(),
        p.intakeOutput.count({ where: { intakeAmount: null, outputAmount: null } }),
      ]);
      return { value, total };
    },
    drillDown: '/nurse-station', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
];

/** P2: 동의서 */
export const CONSENT_METRICS: QualityMetric[] = [
  {
    key: 'consent.doctorUnsigned', domain: 'consent', label: '의사 서명 누락(환자서명 후 72h↑)',
    // 대상 유형 = config consent.doctorSignRequiredTypes(ess 상신 대상과 동일 정본·§7 P2 수렴).
    // compute 는 prisma 만 받으므로 systemConfig 직접 조회(저장소는 ConfigRuntime 과 동일).
    compute: async (p) => {
      const row = await p.systemConfig.findUnique({ where: { key: 'consent.doctorSignRequiredTypes' } }).catch(() => null);
      const configured = nonEmptyStringArrayOr(row?.value, DOCTOR_SIGN_REQUIRED_CONSENT_TYPES)
        .filter((t): t is ConsentType => t in ConsentType);
      const types = configured.length ? configured : (DOCTOR_SIGN_REQUIRED_CONSENT_TYPES as ConsentType[]);
      return { value: await p.consentForm.count({ where: { consentType: { in: types }, patientSignedAt: { lt: new Date(Date.now() - 72 * H) }, doctorSignedAt: null, status: { not: 'REVOKED' } } }) };
    },
    drillDown: '/consent', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
  {
    key: 'consent.expiringSoon', domain: 'consent', label: '동의서 만료 임박(7일)',
    compute: async (p) => ({ value: await p.consentForm.count({ where: { status: 'SIGNED', expiresAt: { gte: new Date(), lt: new Date(Date.now() + 7 * D) } } }) }),
    drillDown: '/consent', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
];

/** P2: 직원 */
export const STAFF_METRICS: QualityMetric[] = [
  {
    key: 'staff.credentialExpiring', domain: 'staff', label: '면허/자격 만료(60일 내·경과)',
    compute: async (p) => ({ value: await p.staffCredential.count({ where: { OR: [{ status: 'EXPIRED' }, { expiresAt: { lt: new Date(Date.now() + 60 * D) } }] } }) }),
    drillDown: 'panel', severityWhenOver: 'CRITICAL', roles: [UserRole.ADMIN],
  },
  {
    key: 'staff.noManager', domain: 'staff', label: '보고라인 없는 재직자(결재 불가)',
    compute: async (p) => ({ value: await p.staff.count({ where: { status: 'ACTIVE', managerStaffId: null } }) }),
    drillDown: 'panel', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
];

/** P2: 예약 */
export const APPOINTMENT_METRICS: QualityMetric[] = [
  {
    key: 'appointment.noShowRate', domain: 'appointment', label: '노쇼율(30일·%)',
    compute: async (p) => {
      const since = new Date(Date.now() - 30 * D);
      const [noShow, total] = await Promise.all([
        p.appointment.count({ where: { status: 'NO_SHOW', scheduledAt: { gte: since } } }),
        p.appointment.count({ where: { scheduledAt: { gte: since } } }),
      ]);
      return { value: total ? Math.round((noShow / total) * 100) : 0, total };
    },
    drillDown: '/schedule', severityWhenOver: 'INFO', roles: [UserRole.ADMIN],
  },
  {
    key: 'appointment.noPhone', domain: 'appointment', label: '연락처 없는 미래 예약(리마인드 불가)',
    compute: async (p) => ({ value: await p.appointment.count({ where: { scheduledAt: { gte: new Date() }, status: { in: ['SCHEDULED', 'CONFIRMED'] }, patient: { phone: null } } }) }),
    drillDown: '/schedule', severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
];

/** P3: 마스터/기관 기본정보 — 영수증·증명서·대외 문서에 그대로 인쇄되는 값들 */
export const MASTER_METRICS: QualityMetric[] = [
  {
    key: 'master.hospitalInfoUnset', domain: 'master', label: '기관 기본정보 미설정(기본값 잔존)',
    compute: async (p) => {
      const keys = ['hospital.name', 'hospital.code', 'hospital.bizNo', 'hospital.ceo', 'hospital.address', 'hospital.phone'];
      const rows = await p.systemConfig.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
      const byKey = new Map(rows.map((r) => [r.key, String(r.value ?? '').replace(/^"|"$/g, '')]));
      const PLACEHOLDER = ['Hospital RUN 병원', '12345678', '서울시 강남구', '02-1234-5678', ''];
      const unset = keys.filter((k) => {
        const v = byKey.get(k);
        return v === undefined || PLACEHOLDER.includes(v);
      });
      return { value: unset.length, total: keys.length };
    },
    drillDown: '/admin/ai-settings',
    severityWhenOver: 'WARNING',
    roles: [UserRole.ADMIN],
  },
];

/** VoC 도메인 지표 — 고객의 소리 SLA 관제(voc-service.plan.md §11-A.2) */
export const VOC_METRICS: QualityMetric[] = [
  {
    key: 'voc.slaOverdue', domain: 'voc', label: 'VoC SLA 초과 미답변',
    compute: async (p) => ({
      value: await (p as any).vocTicket.count({ where: { status: { notIn: ['CLOSED'] }, dueAt: { lt: new Date() }, firstResponseAt: null } }),
      total: await (p as any).vocTicket.count({ where: { status: { notIn: ['CLOSED'] } } }),
    }),
    drillDown: '/admin/voc?sla=overdue', thresholdKey: 'quality.threshold.voc.slaOverdue',
    severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
  },
];

/**
 * 🔴 전 도메인 지표 정본 하나 (2026-08-31 · P3/C5). 소비처(data-quality.service·enterprise-tools 챗도구)가
 * 각자 배열을 나열하면 도메인이 추가될 때 **한쪽만 갱신돼 갈라진다**(실제로 챗도구가 9/17 도메인만 봤다).
 * 여기 한 곳에서 합친다 — 새 도메인은 이 배열에만 추가하면 전 소비처에 반영된다.
 */
export const ALL_QUALITY_METRICS: QualityMetric[] = [
  ...PATIENT_METRICS, ...ENCOUNTER_METRICS, ...ORDER_METRICS, ...ADMISSION_METRICS,
  ...EMERGENCY_METRICS, ...SURGERY_METRICS, ...IMAGING_METRICS, ...LAB_METRICS,
  ...BILLING_METRICS, ...CHECKUP_METRICS, ...NURSING_METRICS, ...SAFETY_METRICS,
  ...CONSENT_METRICS, ...STAFF_METRICS, ...APPOINTMENT_METRICS, ...MASTER_METRICS, ...VOC_METRICS,
];
