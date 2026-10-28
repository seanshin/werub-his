/**
 * 환자 응답 노출 위생 — `include: { patient: true }` 가 암호화 PID·재무 필드까지 통째로
 * 응답 body 에 실어 나르던 것을 막는 정본 omit.
 *
 * 이 필드들은 임상 화면(간호/ICU/전원/의뢰/검진 등)이 **쓰지 않는데도** 엔티티 통째 반환에
 * 딸려 나가 브라우저·로그·캐시까지 흘렀다(전수 실측: 소비처 0). ciphertext 라 평문은 아니지만
 * 저장형 노출·최소권한 위반이라 응답에서 제거한다. 신원이 진짜 필요한 경로(FHIR identifier·
 * 신원 문서)는 patient 를 별도 조회/복호화하므로 이 omit 과 무관하다.
 *
 * 사용: `include: { patient: { omit: PATIENT_SENSITIVE_OMIT } }`
 * (omit 은 나머지 임상 필드를 전부 유지 → 화이트리스트 select 와 달리 FE 회귀 위험이 없다.)
 */
/**
 * 🔴 환자·보호자 화면(포털·모바일)이 받는 응답에서 **직원 몫**을 뺀다 (2026-09-16 F4).
 *
 * 위 `PATIENT_SENSITIVE_OMIT` 은 "직원 화면이 환자 엔티티를 통째로 실어 나르던 것"을 막는다.
 * 이것은 반대 방향이다 — **환자에게 나가는 응답**에 직원 자유기재 메모와 내부 식별자(직원 UUID·
 * 내부 기록 id)가 딸려 나가던 자리다. 전수 실측(F4): select 없이 모델을 통째로 돌려주는
 * 자리에서만 나왔고, 소비 화면(web portal·mobile)은 이 필드들을 **하나도 읽지 않는다**.
 *
 * 🔴 명시 select 로 골라 담은 필드는 여기 넣지 않는다 — 사람이 고른 것과 딸려 나간 것은 다른 사실이다
 *    (예: `getLabResults` 의 `notes: true` 는 의도가 있는 선택이라 F4 가 손대지 않고 후보로만 남겼다).
 *
 * 사용: `omit: PATIENT_FACING_OMIT.<model>` (omit 이라 나머지 필드는 그대로 — FE 회귀 위험이 없다)
 */
export const PATIENT_FACING_OMIT = {
  /** 알레르기 — `notes` 는 임상 자유기재, `recordedBy` 는 기록한 직원 UUID */
  allergy: { notes: true, recordedBy: true },
  /** 원격진료 — 직원 메모·약사 검토·간호기록 id·녹화본 주소(환자 화면 소비처 0) */
  telehealthSession: {
    notes: true,
    pharmacyReview: true,
    pharmacyReviewBy: true,
    pharmacyReviewAt: true,
    nursingNoteId: true,
    recordingUrl: true,
  },
  /** 서류 발급 신청 — 처리·기안·대리자격 검증 직원 UUID와 신청 계정 id */
  documentRequest: {
    processedBy: true,
    draftedBy: true,
    proxyVerifiedBy: true,
    requestorAccountId: true,
  },
  /** 입원 — 병상·담당의 내부 UUID(화면은 bed/attendingDoctor 관계로 이름을 받는다) */
  admission: { bedId: true, admittingDoctorId: true, attendingDoctorId: true },
} as const;

export const PATIENT_SENSITIVE_OMIT = {
  nationalId: true,          // AES-256-GCM 주민/외국인 등록번호
  nationalIdHash: true,      // HMAC 블라인드 인덱스
  ci: true,                  // 본인인증 CI(암호화)
  passportNumber: true,      // 여권번호(암호화)
  passportNumberHash: true,  // HMAC 블라인드 인덱스
  alienRegistrationNo: true, // 외국인등록번호(암호화)
  alienRegistrationNoHash: true, // HMAC 블라인드 인덱스
  insuranceNumber: true,     // 보험번호(암호화)
  incomeDecile: true,        // 소득분위(민감 재무 — 본인부담상한제)
} as const;
