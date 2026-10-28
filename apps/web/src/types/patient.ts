export interface Patient {
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  insuranceType: 'NHI' | 'MEDICAID' | 'INDUSTRIAL' | 'AUTO' | 'SELF_PAY';
  insuranceNumber?: string;
  phone?: string;
  email?: string;
  address?: string | {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode?: string;
    country: string;
  };
  bloodType?: string;
  allergies: string[];
  createdAt: string;
  photoUrl?: string;
  // Phase 1 추가 필드
  residentNumber?: string;
  nationality?: string;
  preferredLanguage?: string;
  occupation?: string;
  smokingStatus?: 'CURRENT' | 'FORMER' | 'NEVER' | 'UNKNOWN';
  religion?: string;
  maritalStatus?: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED' | 'SEPARATED' | 'OTHER';
  memo?: string;
  tags?: string[];
  isActive?: boolean;
  isDeceased?: boolean;
  visaType?: string | null;
  deathDate?: string;
  deathCause?: string;
  deceasedAt?: string;
  contacts?: PatientContact[];
}

export interface PatientContact {
  id: string;
  patientId: string;
  name: string;
  relationship: string;
  phone: string;
  isEmergencyContact: boolean;
  isLegalGuardian: boolean;
  isPrimaryContact: boolean;
  createdAt?: string;
}

export interface PatientListItem {
  /** 외국인 한국식 호칭(목록 select 에 포함 · 없으면 원어만) */
  koreanName?: string | null;
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
  dateOfBirth: string;
  gender: string;
  insuranceType: string;
  phone?: string;
  photoUrl?: string;
  tags?: string[];
  isActive?: boolean;
  isDeceased?: boolean;
  nationality?: string | null;
  preferredLanguage?: string | null;
  visaType?: string | null;
  hasPortalAccount?: boolean;
  portalActive?: boolean;
  hasCertificate?: boolean;
  lastVisitDate?: string;
  createdAt: string;
  _count?: { encounters?: number };
  /** 서명된 진료(SIGNED·AMENDED)와 작성 중(DRAFT) — 2026-10-20 · `_count.encounters` 는 작성 중까지 센다 */
  encounterCounts?: { signed: number; drafts: number };
  /** 2026-10-20 P3 — 서명된 진료 최근 시각(없으면 null) · 다음 예약 · 머무는 곳(재원·응급) · 알레르기 상태(권한 역할만 — 아니면 칸 없음) */
  lastVisitAt?: string | null;
  nextAppointment?: { at: string; department: string | null } | null;
  stay?: { kind: 'ADMITTED'; ward: string | null; room: string | null; bed: string | null } | { kind: 'ER'; status: string } | null;
  allergyStatus?: string;
  allergyAssessedAt?: string | null;
  /** 오래된 작성 중 기록(P4 B6) — 의사 본인 것만·관리자 전체 · 권한 밖이면 칸 없음 */
  staleDrafts?: { count: number; oldestAt: string | null };
}

export interface PatientRelation {
  id: string;
  relatedPatient: {
    id: string;
    mrn: string;
    familyName: string;
    givenName: string;
    dateOfBirth: string;
    gender: string;
    photoUrl?: string;
  };
  relationship: string;
  direction: 'outgoing' | 'incoming';
  notes?: string;
}

/** 데이터 품질 지표 — 지표마다 분자·분모(2026-10-20 환자 목록 P1 · 분모 0 = 산출 불가) */
export interface QualityDashboard {
  total: number;
  noPhone: { count: number; denominator: number };
  /** 건강보험·의료급여 환자 중 증번호 없음(자비·산재·자보 제외) */
  noInsurance: { count: number; denominator: number };
  noAddress: { count: number; denominator: number };
  /** 등록 1년이 지났고 최근 1년 진료 기록 없음 — 분모는 등록 1년이 지난 환자 */
  dormant: { count: number; denominator: number };
  duplicateSuspect: { groups: number; patients: number; denominator: number };
  noPhoto: { count: number; denominator: number; policy: 'UNDECIDED' };
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  matches: Array<{
    id: string;
    mrn: string;
    familyName: string;
    givenName: string;
    dateOfBirth: string;
    similarity: number;
  }>;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
  /** 환자 목록 — 숫자로 찾았는데 전화번호 검색 권한이 없으면 서버가 그 사실을 알린다(2026-10-20) */
  searchNote?: 'PHONE_SEARCH_NOT_ALLOWED' | null;
}
