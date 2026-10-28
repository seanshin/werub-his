import { UserRole } from '@prisma/client';

export enum Permission {
  // Patient permissions
  // 환자 — 🔴 종전엔 PATIENT_VIEW 하나가 목록·상세·보호자 연락처·가족관계를 전부 열었다.
  //      "보는 것"도 층이 다르다(기본 인적 / 연락처 / 신원식별정보) → 층별로 쪼갠다.
  PATIENT_VIEW = 'patient:view',                       // 목록·기본 인적(이름·MRN·성별·나이·태그)
  PATIENT_VIEW_CONTACT = 'patient:view:contact',       // 연락처·주소·보호자·가족관계(PHI 접촉 정보)
  PATIENT_VIEW_IDENTITY = 'patient:view:identity',     // 주민번호·여권번호 등 신원식별정보
  PATIENT_CREATE = 'patient:create',
  PATIENT_EDIT = 'patient:edit',                       // 인적정보 수정(원무 성격)
  PATIENT_RELATION_EDIT = 'patient:relation:edit',     // 보호자·가족관계 등록/수정
  PATIENT_DECEASED = 'patient:deceased',               // 사망 처리(법정 기록·의학적 판단)
  PATIENT_DELETE = 'patient:delete',
  PATIENT_MERGE = 'patient:merge',                     // 중복 환자 병합(되돌리기 어려움)
  PATIENT_IMPORT = 'patient:import',                   // 대량 등록
  PATIENT_EXPORT = 'patient:export',                   // 대량 반출(PHI 가 파일로 나감)

  // Prescription permissions
  PRESCRIPTION_VIEW = 'prescription:view',
  PRESCRIPTION_CREATE = 'prescription:create',
  PRESCRIPTION_EDIT = 'prescription:edit',
  PRESCRIPTION_DELETE = 'prescription:delete',

  // Order permissions
  ORDER_VIEW = 'order:view',
  ORDER_CREATE = 'order:create',
  ORDER_EDIT = 'order:edit',
  ORDER_DELETE = 'order:delete',

  // Billing permissions
  BILLING_VIEW = 'billing:view',
  BILLING_CREATE = 'billing:create',
  BILLING_EDIT = 'billing:edit',
  BILLING_DELETE = 'billing:delete',

  // Encounter permissions
  ENCOUNTER_VIEW = 'encounter:view',
  ENCOUNTER_CREATE = 'encounter:create',
  ENCOUNTER_EDIT = 'encounter:edit',
  ENCOUNTER_DELETE = 'encounter:delete',

  // User management permissions
  USER_VIEW = 'user:view',
  USER_CREATE = 'user:create',
  USER_EDIT = 'user:edit',
  USER_DELETE = 'user:delete',

  // Audit permissions
  AUDIT_VIEW = 'audit:view',
  AUDIT_EXPORT = 'audit:export',

  // System permissions
  SYSTEM_MANAGE = 'system:manage',
  CODE_MANAGE = 'code:manage',

  // Dashboard permissions
  DASHBOARD_VIEW = 'dashboard:view',

  // PACS permissions
  PACS_STUDY_VIEW = 'pacs:study:view',
  PACS_REPORT_VIEW = 'pacs:report:view',
  PACS_REPORT_CREATE = 'pacs:report:create',
  PACS_REPORT_SIGN = 'pacs:report:sign',
  PACS_VIEWER_ACCESS = 'pacs:viewer:access',
  PACS_WORKLIST_MANAGE = 'pacs:worklist:manage',
  PACS_ORDER_CREATE = 'pacs:order:create',
  PACS_AI_INFERENCE = 'pacs:ai:inference',
  PACS_ADMIN = 'pacs:admin',

  // 직원 인증·자격증명 관리(credential-admin) — per-user grant로 부여(SECURITY_ADMIN/AUDITOR)
  CRED_DEVICE_MANAGE = 'cred:device:manage',
  CRED_CERT_ISSUE = 'cred:cert:issue',
  CRED_CERT_REVOKE = 'cred:cert:revoke',
  CRED_RECOVERY_APPROVE = 'cred:recovery:approve',
  CRED_POLICY_MANAGE = 'cred:policy:manage',
  CRED_AUDIT_READ = 'cred:audit:read',

  // 제로 트러스트 단말 보안(terminal-zero-trust) — per-user grant(SECURITY_ADMIN), ADMIN 기본보유
  TERMINAL_MANAGE = 'terminal:manage', // 단말 등록·모드 변경
  TERMINAL_OVERRIDE = 'terminal:override', // 현장 오버라이드·격리
  TERMINAL_KILL = 'terminal:kill', // 분실 Kill-Switch

  // 데이터 보유/파기 정책(security-governance G1) — ADMIN/보안담당자
  RETENTION_MANAGE = 'retention:manage', // 정책 관리·파기 실행

  /**
   * 직원 혈액·체액 노출 사고(니들스틱 등) — 산업안전보건법·감염관리 법정기록(2026-08-18).
   *
   * 🔴 종전엔 접수가 `PATIENT_EDIT`, 열람이 `AUDIT_VIEW` 였다. 둘 다 **다른 업무의 권한**이라
   *    실제 필요와 어긋났다:
   *     - `PATIENT_EDIT` 보유자 = ADMIN·NURSE·RECEPTIONIST 뿐 → **의사·약사·검사기사가
   *       자기 니들스틱을 신고할 수 없었다**(예리물을 가장 많이 다루는 직군이 막혔다).
   *       반대로 예리물을 다루지 않는 원무 접수는 열려 있었다.
   *     - `AUDIT_VIEW` 보유자에는 CRM_MANAGER 가 포함 → 마케팅 담당이 **동료의 HIV 노출
   *       이력**을 전건 열람할 수 있었다.
   *
   * 그래서 업무 자체의 권한으로 분리한다. 신고는 넓게(막으면 사고가 기록되지 않는다),
   * 타인 이력 열람·추적관찰은 좁게(원환자 HIV/HBV/HCV 와 피노출자 신원이 함께 담긴다).
   */
  STAFF_EXPOSURE_REPORT = 'staff:exposure:report', // 본인 노출 사고 신고 + 본인 이력 열람
  STAFF_EXPOSURE_MANAGE = 'staff:exposure:manage', // 전 직원 이력 열람 · 추적관찰/PEP 갱신 · 종결

  /**
   * 의료질지표(QI) 측정값 — 의료기관인증·환자안전법·감염관리 법정 근거 수치(2026-08-18).
   *
   * 🔴 종전엔 입력·정정·무효화가 전부 `@Roles(UserRole.ADMIN)` 단독이었다. **누가 이 일을 실제로
   *    하는가**로 다시 읽으면 어긋난다 — 운영 실측(계정 102개) 기준 ADMIN 은 **2개**뿐이고
   *    그중 하나는 원무과 소속이다. 반면 25지표 중 감염관리 4·환자안전 6 = **10지표(40%)** 의
   *    산출 주체는 법령상 감염관리실(의료법 시행규칙 §43)·환자안전 전담인력(환자안전법 §12)이며,
   *    이 저장소에서 그 직군의 역할은 `NURSE` 다(운영에 '감염관리실' NURSE 계정이 실재).
   *    즉 **지표를 만드는 사람이 지표를 넣을 수 없었다.**
   *
   * 🔴 넓혀도 PHI 노출은 **늘지 않는다**: QI 측정은 기간·분자·분모·값의 집계치이며 환자 식별자가
   *    하나도 없다. 그리고 `NURSE` 는 이미 `GET /quality/*` 를 전부 읽는다(읽기 범위 무변경).
   *    늘어나는 위험은 '수치의 신뢰성'이고, 그것은 ①변이 기본 감사 ON ②지표×기간 유니크
   *    ③값 확정은 서버 정본(`indicator-policy`) ④무효화 권한 분리(아래)로 통제한다.
   *
   * 🔴 **무효화는 정정보다 엄격하다** — 정정은 행이 남고 집계에도 계속 잡히지만, 무효화는 그 기간을
   *    집계·화면에서 **사라지게** 하고 같은 기간을 다시 쓸 수 있게 연다(voided 행 되살리기).
   *    입력자가 자기 입력을 스스로 없앨 수 있으면 '나쁜 달을 지우고 다시 쓰는' 경로가 되고,
   *    사유를 적는 사람이 곧 입력자면 사유는 통제가 아니다 → **직무 분리**로 ADMIN 에만 둔다.
   */
  QI_MEASURE_WRITE = 'qi:measure:write', // 측정값 입력·정정(값·판정은 서버가 재산출)
  QI_MEASURE_VOID = 'qi:measure:void',   // 측정값 무효화 — 집계에서 빼고 기간을 다시 연다(직무 분리)

  /**
   * 환자안전사고 보고·열람 — **환자안전법 §14·§16·§17**(2026-08-18).
   *
   * 🔴 종전엔 컨트롤러 클래스 `@Roles(DOCTOR, NURSE, ADMIN)` 하나가 보고와 열람을 **같이** 막고
   *    같이 열었다. 두 축은 정반대 방향으로 틀려 있었다:
   *     - 보고가 **너무 좁았다**: 운영 실측 75건 중 투약오류 12·검체라벨 10·장비 10 이 있는데
   *       그 일을 하는 **약사(PHARMACIST)·검사기사(LAB_TECH)가 신고할 수 없었다.**
   *       실제 보고자는 전건 NURSE 였다(75/75) — 남이 대신 적어준 기록이라는 뜻이다.
   *       🔴 보고를 막으면 사고가 없어지는 게 아니라 **기록이 없어진다**(§14 는 누구나 보고).
   *     - 열람이 **너무 넓었다**: 보고 가능한 의사·간호사 전원이 전건을 열람했고,
   *       응답에는 `reporterId` 가 그대로 실려 나갔다(§17 = 비밀 누설 3년 이하 징역).
   *
   * → 두 축을 쪼갠다. 보고는 넓게, 열람은 좁게. 그리고 **보고자 신원은 어느 권한으로도
   *   응답에 실리지 않는다**(권한이 아니라 서버 select 로 차단 — patient-safety.select.ts).
   */
  SAFETY_INCIDENT_REPORT = 'safety:incident:report', // 사고 보고 + 본인이 보고한 건 열람
  SAFETY_INCIDENT_REVIEW = 'safety:incident:review', // 전건 열람 · 조사(상태 변경) · RCA 작성/승인

  /**
   * 검진센터 원무·행정 — 시드 흐름 전수 검토 8단계(검진·2026-08-24).
   *
   * 🔴 검진 컨트롤러의 쓰기 20개가 전부 `PATIENT_EDIT` 였다. 그 권한 보유자는
   *    **ADMIN·NURSE·RECEPTIONIST 셋뿐**이라, v3.96 에 신설한 검진 전담 직군 `CHECKUP` 은
   *    자기 본업인 **예약·당일접수·체크인·상태변경·취소·문진 저장·추적관리**를 하나도 할 수 없었다.
   *    사이드바는 그 직군에 검진 메뉴 11개를 보여주고 있었고(`Sidebar.tsx`), 역할 정의 주석은
   *    "검진 기능은 role 로 열림"이라 적혀 있었지만 **컨트롤러에 `@Roles` 는 하나도 없다.**
   *    운영 실측(2026-08-24): CHECKUP 계정 2개(`ck.office@`·`ck.admin@`) ·
   *    `rbac.roleOverrides` = `{}`(오버라이드 없음) → **개통 이래 403**.
   *    직원 노출 신고(`STAFF_EXPOSURE_REPORT`)와 같은 처방 — **업무 자체의 권한으로 분리한다.**
   *
   * 🔴 **임상은 여기에 담지 않는다.** 검사 결과 입력·스테이션 완료·판독 완료·종합소견·서명은
   *    그대로 `PATIENT_EDIT`/`ENCOUNTER_CREATE` 다(사이드바도 그 화면들은 CHECKUP 에 안 보여준다).
   *    마스터 관리(프로그램·문진표 정의·검사항목·스테이션 설정)도 `SYSTEM_MANAGE` 로 남긴다.
   */
  CHECKUP_MANAGE = 'checkup:manage', // 검진 방문 생애주기(예약·접수·상태)·문진 응답·추적관리·단체계약
  /**
   * 🔴 **검진 사후관리 연락 완료 처리만** 하는 좁은 권한 (2026-08-30).
   *    `/crm/checkup/follow-ups` 는 CRM 전용 화면인데(nav = ADMIN·CRM_MANAGER·CRM_STAFF)
   *    목록은 `PATIENT_VIEW` 로 읽히고 **완료 처리만 막혀** 있었다 —
   *    운영 실측: CRM_MANAGER 로 대상 **11건이 보이는데 하나도 닫을 수 없었다.**
   *    워크리스트가 줄지 않으면 미실시가 드러나지 않는다(§규약 9).
   *    `CHECKUP_MANAGE` 를 통째로 주면 검진 방문 생애주기·문진·단체계약까지 열리므로
   *    **이 행위 하나만** 갖는 권한을 둔다.
   */
  CHECKUP_FOLLOWUP_COMPLETE = 'checkup:followup:complete',
}

export const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  [UserRole.ADMIN]: new Set([
    Permission.PATIENT_VIEW,
    Permission.PATIENT_VIEW_CONTACT,
    Permission.PATIENT_VIEW_IDENTITY,
    Permission.PATIENT_CREATE,
    Permission.PATIENT_EDIT,
    Permission.PATIENT_RELATION_EDIT,
    Permission.PATIENT_DECEASED,
    Permission.PATIENT_DELETE,
    Permission.PATIENT_MERGE,
    Permission.PATIENT_IMPORT,
    Permission.PATIENT_EXPORT,
    Permission.PRESCRIPTION_VIEW,
    Permission.PRESCRIPTION_CREATE,
    Permission.PRESCRIPTION_EDIT,
    Permission.PRESCRIPTION_DELETE,
    Permission.ORDER_VIEW,
    Permission.ORDER_CREATE,
    Permission.ORDER_EDIT,
    Permission.ORDER_DELETE,
    Permission.BILLING_VIEW,
    Permission.BILLING_CREATE,
    Permission.BILLING_EDIT,
    Permission.BILLING_DELETE,
    Permission.ENCOUNTER_VIEW,
    Permission.ENCOUNTER_CREATE,
    Permission.ENCOUNTER_EDIT,
    Permission.ENCOUNTER_DELETE,
    Permission.USER_VIEW,
    Permission.USER_CREATE,
    Permission.USER_EDIT,
    Permission.USER_DELETE,
    Permission.AUDIT_VIEW,
    Permission.AUDIT_EXPORT,
    Permission.SYSTEM_MANAGE,
    Permission.CODE_MANAGE,
    Permission.DASHBOARD_VIEW,
    // PACS — 전체 권한
    Permission.PACS_STUDY_VIEW,
    Permission.PACS_REPORT_VIEW,
    Permission.PACS_REPORT_CREATE,
    Permission.PACS_REPORT_SIGN,
    Permission.PACS_VIEWER_ACCESS,
    Permission.PACS_WORKLIST_MANAGE,
    Permission.PACS_ORDER_CREATE,
    Permission.PACS_AI_INFERENCE,
    Permission.PACS_ADMIN,
    // 단말 보안 — ADMIN 전체
    Permission.TERMINAL_MANAGE,
    Permission.TERMINAL_OVERRIDE,
    Permission.TERMINAL_KILL,
    Permission.RETENTION_MANAGE,
    Permission.STAFF_EXPOSURE_REPORT,
    Permission.STAFF_EXPOSURE_MANAGE,
    Permission.QI_MEASURE_WRITE,
    Permission.QI_MEASURE_VOID,
    Permission.SAFETY_INCIDENT_REPORT,
    Permission.SAFETY_INCIDENT_REVIEW,
    Permission.CHECKUP_MANAGE,
  ]),
  [UserRole.DOCTOR]: new Set([
    Permission.PATIENT_VIEW,
    Permission.PATIENT_VIEW_CONTACT,
    Permission.PATIENT_CREATE,
    // 🔴 PATIENT_EDIT 제거 — 라우트(PUT /patients/:id)는 애초에 간호·관리자만 허용해 왔고,
    //    권한 정의만 '수정 가능'이라 화면·감사 판단이 실제와 어긋났다(정의를 실제에 맞춤).
    Permission.PATIENT_DECEASED, // 사망 처리는 의학적 판단

    Permission.PRESCRIPTION_VIEW,
    Permission.PRESCRIPTION_CREATE,
    Permission.PRESCRIPTION_EDIT,
    Permission.ORDER_VIEW,
    Permission.ORDER_CREATE,
    Permission.ORDER_EDIT,
    Permission.BILLING_VIEW,
    Permission.ENCOUNTER_VIEW,
    Permission.ENCOUNTER_CREATE,
    Permission.ENCOUNTER_EDIT,
    Permission.AUDIT_VIEW,
    Permission.DASHBOARD_VIEW,
    // PACS — 조회/리포트 작성/서명/뷰어/AI
    Permission.PACS_STUDY_VIEW,
    Permission.PACS_REPORT_VIEW,
    Permission.PACS_REPORT_CREATE,
    Permission.PACS_REPORT_SIGN,
    Permission.PACS_VIEWER_ACCESS,
    Permission.PACS_ORDER_CREATE,
    Permission.PACS_AI_INFERENCE,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.STAFF_EXPOSURE_MANAGE, // 감염관리·보건관리자 실무(전 직원 이력·추적관찰)
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 누구나 보고할 수 있어야 한다
    Permission.SAFETY_INCIDENT_REVIEW, // 환자안전 전담인력 자격 직군(§12) — 조사·RCA. 병원이 좁히려면 /admin/rbac 에서 끈다
  ]),
  [UserRole.NURSE]: new Set([
    Permission.PATIENT_VIEW,
    Permission.PATIENT_VIEW_CONTACT,
    Permission.PATIENT_CREATE,
    Permission.PATIENT_EDIT,
    Permission.PATIENT_RELATION_EDIT,
    Permission.PATIENT_IMPORT,
    Permission.PRESCRIPTION_VIEW,
    Permission.PRESCRIPTION_EDIT,
    Permission.ORDER_VIEW,
    Permission.ORDER_CREATE,
    Permission.ORDER_EDIT,
    Permission.BILLING_VIEW,
    Permission.BILLING_CREATE,
    Permission.BILLING_EDIT,
    Permission.ENCOUNTER_VIEW,
    Permission.ENCOUNTER_EDIT,
    Permission.AUDIT_VIEW,
    Permission.DASHBOARD_VIEW,
    // PACS — 조회만
    Permission.PACS_STUDY_VIEW,
    Permission.PACS_REPORT_VIEW,
    Permission.PACS_VIEWER_ACCESS,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.STAFF_EXPOSURE_MANAGE, // 감염관리·보건관리자 실무(전 직원 이력·추적관찰)
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 누구나 보고할 수 있어야 한다
    Permission.SAFETY_INCIDENT_REVIEW, // 환자안전 전담인력 자격 직군(§12) — 조사·RCA. 병원이 좁히려면 /admin/rbac 에서 끈다
    // 🔴 QI 측정 입력·정정 — 감염관리실·환자안전 전담인력이 산출 주체(25지표 중 10지표).
    //    무효화(QI_MEASURE_VOID)는 **주지 않는다** — 입력자가 자기 입력을 집계에서 지울 수 없게.
    Permission.QI_MEASURE_WRITE,
  ]),
  /**
   * 원무·접수 — 환자 인적정보와 수납이 주 업무. **임상 기록 권한은 없다**.
   * 종전엔 이 업무를 간호 또는 관리자 계정으로 처리해, 접수 담당이 임상 권한까지 갖거나
   * 관리자 권한(삭제·병합·반출)을 함께 갖는 과대권한이 생겼다.
   */
  [UserRole.RECEPTIONIST]: new Set([
    Permission.PATIENT_VIEW,
    Permission.PATIENT_VIEW_CONTACT,
    Permission.PATIENT_VIEW_IDENTITY, // 신원 확인·보험 자격 조회가 원무 업무
    Permission.PATIENT_CREATE,
    Permission.PATIENT_EDIT,
    Permission.PATIENT_RELATION_EDIT,
    Permission.PATIENT_IMPORT,
    Permission.BILLING_VIEW,
    Permission.BILLING_CREATE,
    Permission.BILLING_EDIT,
    Permission.ENCOUNTER_VIEW,        // 접수·수납 확인용 열람(작성 권한 없음)
    Permission.DASHBOARD_VIEW,
    // 없음: 삭제·병합·대량 반출(관리자) · 사망 처리(의학적 판단) · 처방/오더/기록 작성(임상)
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),

  [UserRole.PHARMACIST]: new Set([
    Permission.PATIENT_VIEW,
    Permission.PRESCRIPTION_VIEW,
    Permission.PRESCRIPTION_CREATE,
    Permission.PRESCRIPTION_EDIT,
    Permission.ORDER_VIEW,
    Permission.ORDER_CREATE,
    Permission.ORDER_EDIT,
    Permission.BILLING_VIEW,
    Permission.AUDIT_VIEW,
    Permission.DASHBOARD_VIEW,
    // PACS — 조회만 (영상 참조용)
    Permission.PACS_STUDY_VIEW,
    Permission.PACS_REPORT_VIEW,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),
  [UserRole.LAB_TECH]: new Set([
    Permission.PATIENT_VIEW,
    Permission.ORDER_VIEW,
    Permission.ORDER_CREATE,
    Permission.ORDER_EDIT,
    Permission.ENCOUNTER_VIEW,
    Permission.AUDIT_VIEW,
    Permission.DASHBOARD_VIEW,
    // PACS — 조회/워크리스트/뷰어/QC
    Permission.PACS_STUDY_VIEW,
    Permission.PACS_REPORT_VIEW,
    Permission.PACS_VIEWER_ACCESS,
    Permission.PACS_WORKLIST_MANAGE,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),
  // CRM 역할 — 환자 조회(제한) + 대시보드만, 의료 데이터 접근 불가
  [UserRole.CRM_MANAGER]: new Set([
    Permission.CHECKUP_FOLLOWUP_COMPLETE, // 검진 사후관리 연락 완료 — CRM 전용 화면의 유일한 행위
    Permission.PATIENT_VIEW,
    Permission.BILLING_VIEW,
    Permission.DASHBOARD_VIEW,
    Permission.AUDIT_VIEW,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),
  [UserRole.CRM_STAFF]: new Set([
    Permission.CHECKUP_FOLLOWUP_COMPLETE, // 검진 사후관리 연락 완료 — CRM 전용 화면의 유일한 행위
    Permission.PATIENT_VIEW,
    Permission.BILLING_VIEW,
    Permission.DASHBOARD_VIEW,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),
  // 급양·영양 — 급식/식단/영양 도메인 한정. 급식 대상 환자 식별(기본 인적)·대시보드만.
  // 임상 기록/처방/오더/청구/PHI 신원·연락처 없음. 급양 기능 자체는 nutrition 컨트롤러 @Roles(NUTRITION)로 열림.
  [UserRole.NUTRITION]: new Set([
    Permission.PATIENT_VIEW,
    Permission.DASHBOARD_VIEW,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),
  // 행정직(총무·시설·자재) — 재고/장비/일반 행정. 환자 임상데이터 없음(대시보드만).
  // 재고·장비 기능은 해당 컨트롤러 @Roles(ADMIN_STAFF)로 열림. 인사·급여 등 민감 영역은 ADMIN 유지.
  [UserRole.ADMIN_STAFF]: new Set([
    Permission.DASHBOARD_VIEW,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),
  // 의무기록사(HIM) — 기록 발급/검색. 환자 조회+진료 열람(작성 없음).
  // 처방/오더/기록 작성 등 임상 권한 없음. 감사·동의는 ADMIN 유지(필요 시 오버라이드로 부여).
  [UserRole.MEDICAL_RECORDS]: new Set([
    Permission.PATIENT_VIEW,
    Permission.PATIENT_VIEW_CONTACT, // 기록 발급 시 수령인 확인
    Permission.ENCOUNTER_VIEW,
    Permission.DASHBOARD_VIEW,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),
  // 건강검진센터 원무·행정 — 검진 접수/수납·예약·단체계약·통계. 환자 조회+수납+진료 열람.
  // 🔴 종전 주석은 "검진 기능은 role 로 열림"이라 적혀 있었으나 **틀렸다** — 검진 컨트롤러에
  //    `@Roles` 는 하나도 없고 전부 `@RequirePermission` 이다. 그래서 이 직군은 개통 이래
  //    자기 본업(예약·접수·체크인·추적관리)에서 403 이었다(§CHECKUP_MANAGE).
  //    본원 임상/처방/오더/시스템관리 권한은 계속 없다.
  [UserRole.CHECKUP]: new Set([
    Permission.PATIENT_VIEW,
    Permission.PATIENT_VIEW_CONTACT, // 검진 접수·수검자 확인
    Permission.ENCOUNTER_VIEW,
    Permission.BILLING_VIEW,
    Permission.BILLING_CREATE, // 검진 수납
    Permission.DASHBOARD_VIEW,
    Permission.CHECKUP_MANAGE, // 검진 방문 생애주기·문진 응답·추적관리·단체계약(임상 입력·마스터 관리는 제외)
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),
  // READ — 디지털 트윈 등 외부 연동 읽기전용 서비스계정(최소권한). 조회만.
  [UserRole.READ]: new Set([
    Permission.PATIENT_VIEW,
    Permission.DASHBOARD_VIEW,
    // 🔴 STAFF_EXPOSURE_REPORT 없음 — 사람이 아니라 외부 연동 서비스계정이다.
    //    노출 사고는 **피노출 당사자**가 접수하는 기록이라 서비스계정 명의로 남으면 안 된다.
    // 🔴 SAFETY_INCIDENT_REPORT 도 같은 이유로 없음 — 보고자는 사람이어야 한다(§14 '보건의료인·환자 등').
  ]),
  // 경영진 — 읽기 전용 관제(대시보드·환자/수납 조회). 강마스킹은 콘솔에서 적용.
  [UserRole.EXECUTIVE]: new Set([
    Permission.DASHBOARD_VIEW,
    Permission.PATIENT_VIEW,
    Permission.BILLING_VIEW,
    Permission.ENCOUNTER_VIEW,
    Permission.STAFF_EXPOSURE_REPORT, // 직원 안전 신고 — 본인 사고 접수·본인 이력
    Permission.SAFETY_INCIDENT_REPORT, // 환자안전사고 보고(§14) — 본인이 보고한 건만 열람
  ]),
};

export interface PermissionContext {
  userId: string;
  userRole: UserRole;
  resourceId?: string;
  resourceType?: string;
}
