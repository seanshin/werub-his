import { Permission } from './permission.types';

/**
 * 권한 카탈로그 — 관리 화면(역할×권한 매트릭스)이 읽는 **표시 정본**.
 *
 * 코드의 `Permission` 값만으로는 관리자가 무엇을 켜고 끄는지 알 수 없다(`patient:view:contact` 가
 * '보호자 연락처까지 본다'는 뜻인지 화면에서 읽혀야 한다) → 라벨·설명·도메인을 함께 정의한다.
 * 여기 없는 권한은 화면에 '설명 없음'으로 뜨므로, 권한을 추가하면 여기도 채운다.
 */
export interface PermissionMeta {
  key: Permission;
  label: string;
  /** 무엇을 할 수 있게 되는가 — 관리자가 결정하려면 결과가 보여야 한다 */
  hint: string;
  /** 되돌리기 어렵거나 대량·민감한 권한(화면에서 경고 표시) */
  sensitive?: boolean;
}

export interface PermissionDomain {
  key: string;
  label: string;
  permissions: PermissionMeta[];
}

export const PERMISSION_CATALOG: PermissionDomain[] = [
  {
    key: 'patient',
    label: '환자',
    permissions: [
      { key: Permission.PATIENT_VIEW, label: '기본 인적 열람', hint: '목록·상세의 이름·MRN·성별·나이·태그·보험 유형' },
      { key: Permission.PATIENT_VIEW_CONTACT, label: '연락처·보호자 열람', hint: '전화·이메일·주소·보호자·가족관계. 없으면 전화는 마스킹되고 나머지는 응답에서 빠진다', sensitive: true },
      { key: Permission.PATIENT_VIEW_IDENTITY, label: '신원식별정보 열람', hint: '주민번호·여권번호·보험번호. 진료에는 불필요하고 원무·관리자 업무', sensitive: true },
      { key: Permission.PATIENT_CREATE, label: '환자 등록', hint: '신규 환자 생성' },
      { key: Permission.PATIENT_EDIT, label: '인적정보 수정', hint: '이름·연락처·보험 등 원무 성격 정보 수정' },
      { key: Permission.PATIENT_RELATION_EDIT, label: '보호자·가족관계 관리', hint: '보호자 등록·수정·삭제' },
      { key: Permission.PATIENT_DECEASED, label: '사망 처리', hint: '사망 등록 — 의학적 판단이며 법정 기록', sensitive: true },
      { key: Permission.PATIENT_DELETE, label: '환자 삭제', hint: '소프트 삭제(목록·검색에서 사라짐)', sensitive: true },
      { key: Permission.PATIENT_MERGE, label: '중복 환자 병합', hint: '두 환자를 하나로 합침 — 되돌리기 어렵다', sensitive: true },
      { key: Permission.PATIENT_IMPORT, label: '대량 등록', hint: '파일로 여러 환자를 한 번에 등록' },
      { key: Permission.PATIENT_EXPORT, label: '대량 반출(CSV)', hint: 'PHI 가 파일로 병원 밖에 나가는 지점 — 건수·조건이 감사에 남는다', sensitive: true },
    ],
  },
  {
    key: 'encounter',
    label: '진료기록',
    permissions: [
      { key: Permission.ENCOUNTER_VIEW, label: '진료기록 열람', hint: 'SOAP·진단 등 진료 내용 보기' },
      { key: Permission.ENCOUNTER_CREATE, label: '진료기록 작성', hint: '새 진료 시작·기록' },
      { key: Permission.ENCOUNTER_EDIT, label: '진료기록 수정', hint: '서명 전 기록 수정' },
      { key: Permission.ENCOUNTER_DELETE, label: '진료기록 삭제', hint: '법정 기록 삭제', sensitive: true },
    ],
  },
  {
    key: 'prescription',
    label: '처방',
    permissions: [
      { key: Permission.PRESCRIPTION_VIEW, label: '처방 열람', hint: '처방 내역 보기' },
      { key: Permission.PRESCRIPTION_CREATE, label: '처방 발행', hint: 'DUR·포뮬러리 게이트를 거쳐 처방 생성', sensitive: true },
      { key: Permission.PRESCRIPTION_EDIT, label: '처방 수정', hint: '발행 전 처방 변경' },
      { key: Permission.PRESCRIPTION_DELETE, label: '처방 취소', hint: '처방 취소·삭제' },
    ],
  },
  {
    key: 'order',
    label: '오더(검사·영상)',
    permissions: [
      { key: Permission.ORDER_VIEW, label: '오더 열람', hint: '검사·영상 오더 보기' },
      { key: Permission.ORDER_CREATE, label: '오더 발행', hint: '검사·영상 의뢰' },
      { key: Permission.ORDER_EDIT, label: '오더 수정', hint: '오더 내용·상태 변경' },
      { key: Permission.ORDER_DELETE, label: '오더 취소', hint: '오더 취소' },
    ],
  },
  {
    key: 'billing',
    label: '수납·청구',
    permissions: [
      { key: Permission.BILLING_VIEW, label: '수납 열람', hint: '청구·수납 내역 보기' },
      { key: Permission.BILLING_CREATE, label: '청구 생성', hint: '진료비 청구 발행' },
      { key: Permission.BILLING_EDIT, label: '수납 처리', hint: '수납·환불 처리', sensitive: true },
      { key: Permission.BILLING_DELETE, label: '청구 삭제', hint: '청구 취소·삭제', sensitive: true },
    ],
  },
  {
    key: 'user',
    label: '직원 계정',
    permissions: [
      { key: Permission.USER_VIEW, label: '직원 조회', hint: '직원 목록·상세' },
      { key: Permission.USER_CREATE, label: '직원 등록', hint: '계정 생성', sensitive: true },
      { key: Permission.USER_EDIT, label: '직원 수정', hint: '역할·부서 등 변경 — 권한 승격 경로', sensitive: true },
      { key: Permission.USER_DELETE, label: '직원 삭제', hint: '계정 비활성·삭제', sensitive: true },
    ],
  },
  {
    key: 'audit',
    label: '감사·보안',
    permissions: [
      { key: Permission.AUDIT_VIEW, label: '감사 로그 조회', hint: '누가 무엇을 열람·변경했는지' },
      { key: Permission.AUDIT_EXPORT, label: '감사 로그 반출', hint: '감사 기록 내려받기', sensitive: true },
      { key: Permission.RETENTION_MANAGE, label: '보유·파기 관리', hint: '보존기간 정책·실파기 실행', sensitive: true },
    ],
  },
  {
    key: 'system',
    label: '시스템',
    permissions: [
      { key: Permission.SYSTEM_MANAGE, label: '시스템 설정', hint: '전역 설정·게이트 변경', sensitive: true },
      { key: Permission.CODE_MANAGE, label: '코드 마스터 관리', hint: '약품·진단·수가 코드 관리' },
      { key: Permission.DASHBOARD_VIEW, label: '대시보드 열람', hint: '통계·관제 화면' },
    ],
  },
  {
    key: 'pacs',
    label: '영상(PACS)',
    permissions: [
      { key: Permission.PACS_STUDY_VIEW, label: '검사 목록 열람', hint: '영상 검사 목록' },
      { key: Permission.PACS_VIEWER_ACCESS, label: '뷰어 접근', hint: 'OHIF 뷰어로 영상 열람' },
      { key: Permission.PACS_REPORT_VIEW, label: '판독문 열람', hint: '판독 결과 보기' },
      { key: Permission.PACS_REPORT_CREATE, label: '판독문 작성', hint: '판독 소견 작성' },
      { key: Permission.PACS_REPORT_SIGN, label: '판독문 서명', hint: '판독 확정 서명', sensitive: true },
      { key: Permission.PACS_ORDER_CREATE, label: '영상 오더', hint: '영상 검사 의뢰' },
      { key: Permission.PACS_WORKLIST_MANAGE, label: '워크리스트 관리', hint: '촬영 목록 배정·조정' },
      { key: Permission.PACS_AI_INFERENCE, label: 'AI 판독 보조', hint: '영상 AI 추론 실행' },
      { key: Permission.PACS_ADMIN, label: 'PACS 관리', hint: 'PACS 시스템 설정', sensitive: true },
    ],
  },
  {
    key: 'cred',
    label: '인증서·단말',
    permissions: [
      { key: Permission.CRED_DEVICE_MANAGE, label: '기기 관리', hint: '단말 등록·해제' },
      { key: Permission.CRED_CERT_ISSUE, label: '인증서 발급', hint: '전자서명 인증서 발급', sensitive: true },
      { key: Permission.CRED_CERT_REVOKE, label: '인증서 폐지', hint: '인증서 무효화', sensitive: true },
      { key: Permission.CRED_RECOVERY_APPROVE, label: '복구 승인', hint: '분실·재발급 승인', sensitive: true },
      { key: Permission.CRED_POLICY_MANAGE, label: '인증 정책 관리', hint: '재인증·생체 정책', sensitive: true },
      { key: Permission.CRED_AUDIT_READ, label: '인증 감사 조회', hint: '인증서·단말 감사 기록' },
      { key: Permission.TERMINAL_MANAGE, label: '단말 관리', hint: '단말 등록·모드 변경' },
      { key: Permission.TERMINAL_OVERRIDE, label: '단말 현장 오버라이드', hint: '현장 강제 허용·격리', sensitive: true },
      { key: Permission.TERMINAL_KILL, label: '단말 Kill-Switch', hint: '분실 단말 즉시 차단', sensitive: true },
    ],
  },
  {
    key: 'qi',
    label: '의료질지표(QI)',
    permissions: [
      {
        key: Permission.QI_MEASURE_WRITE,
        label: '측정값 입력 · 정정',
        hint: '질 지표의 기간별 분자/분모를 입력하고 오기를 정정한다(값·달성판정은 서버가 재산출). 환자 식별정보는 다루지 않는 집계 수치다. 끄면 그 직군은 자기가 산출한 지표를 넣을 수 없다 — 감염관리·환자안전 지표가 비거나 관리자 계정 공용 사용으로 흐른다',
      },
      {
        key: Permission.QI_MEASURE_VOID,
        label: '측정값 무효화',
        hint: '한 기간의 측정을 집계·화면에서 제외하고 그 기간을 다시 입력할 수 있게 연다(기록은 사유와 함께 남는다). 🔴 입력 권한과 분리해 둔다 — 입력자가 자기 입력을 없앨 수 있으면 나쁜 달을 지우고 다시 쓰는 경로가 된다',
        sensitive: true,
      },
    ],
  },
  {
    key: 'staff-safety',
    label: '직원 안전(노출 사고)',
    permissions: [
      {
        key: Permission.STAFF_EXPOSURE_REPORT,
        label: '노출 사고 신고 · 본인 이력',
        hint: '니들스틱·체액 노출을 본인 명의로 접수하고 본인 기록만 조회. 끄면 그 직군은 사고를 신고할 수 없다(수기 서식으로만 남는다)',
      },
      {
        key: Permission.STAFF_EXPOSURE_MANAGE,
        label: '전 직원 노출 이력 · 추적관찰',
        hint: '동료의 노출 이력과 원환자 HBV/HCV/HIV 결과를 전건 열람하고 PEP·추적관찰을 갱신·종결. 감염관리실·보건관리자 업무',
        sensitive: true,
      },
    ],
  },
  {
    key: 'patient-safety',
    label: '환자안전사고 보고',
    permissions: [
      {
        key: Permission.SAFETY_INCIDENT_REPORT,
        label: '사고 보고 · 본인 보고 건 열람',
        hint: '환자안전사고를 본인 명의로 보고하고 **자기가 보고한 건만** 조회. 끄면 그 직군은 사고를 보고할 수 없다 — 환자안전법 §14 는 누구나 보고할 수 있게 하라고 정한다(막아도 사고는 없어지지 않고 기록만 없어진다)',
      },
      {
        key: Permission.SAFETY_INCIDENT_REVIEW,
        label: '전건 열람 · 조사 · RCA',
        hint: '전 직원의 보고 내용을 전건 열람하고 상태 변경·근본원인분석(RCA)을 작성·승인. 환자안전 전담인력(§12) 업무. 🔴 보고자 신원(reporterId)은 이 권한으로도 응답에 실리지 않는다 — 서버가 아예 내려보내지 않는다(§17 비밀 누설 처벌)',
        sensitive: true,
      },
    ],
  },
  {
    key: 'checkup',
    label: '건강검진센터 원무',
    permissions: [
      {
        key: Permission.CHECKUP_MANAGE,
        label: '검진 예약·접수·추적관리·단체계약',
        hint: '검진 방문의 생애주기(예약·당일접수·체크인·진행상태·취소/변경)와 문진 응답 저장·추적관리·단체 검진 계약. 끄면 검진센터 직원은 사이드바의 검진 메뉴는 보이는데 접수 버튼에서 403 을 받는다. 🔴 검사 결과 입력·판독·종합소견·서명과 마스터(프로그램·문진표 정의)는 이 권한에 **포함되지 않는다** — 그쪽은 임상/시스템 권한이다',
      },
      {
        key: Permission.CHECKUP_FOLLOWUP_COMPLETE,
        label: '검진 사후관리 연락 완료 처리',
        hint: '검진 결과에 따른 재검·상담 권유 연락을 마치고 그 건을 닫는다(`/crm/checkup/follow-ups`). CRM 직군에게 준다 — 끄면 대상 목록은 보이는데 완료를 찍을 수 없어 워크리스트가 줄지 않고 미실시가 드러나지 않는다. 🔴 검진 예약·접수·문진 등 방문 생애주기는 이 권한에 **포함되지 않는다**(그쪽은 검진 예약·접수 권한).',
      },
    ],
  },
];

const META = new Map<string, PermissionMeta>(
  PERMISSION_CATALOG.flatMap((d) => d.permissions.map((p) => [p.key as string, p])),
);

export function permissionMeta(key: string): PermissionMeta | undefined {
  return META.get(key);
}

/** 카탈로그에 빠진 권한(라벨 없이 화면에 뜨는 것) — 테스트로 감시 */
export function uncatalogedPermissions(all: string[]): string[] {
  return all.filter((p) => !META.has(p));
}
