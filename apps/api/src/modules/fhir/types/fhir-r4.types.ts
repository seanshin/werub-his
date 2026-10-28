// FHIR R4 Patient Resource (simplified for MVP)

export interface FhirPatient {
  resourceType: 'Patient';
  id?: string;
  identifier?: FhirIdentifier[];
  name?: FhirHumanName[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string; // YYYY-MM-DD
  telecom?: FhirContactPoint[];
  address?: FhirAddress[];
}

export interface FhirIdentifier {
  system?: string;
  value?: string;
}

export interface FhirHumanName {
  family?: string;
  given?: string[];
  text?: string;
}

export interface FhirContactPoint {
  system?: 'phone' | 'email';
  value?: string;
}

export interface FhirAddress {
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface FhirBundle<T = FhirResource> {
  resourceType: 'Bundle';
  type: 'searchset' | 'transaction' | 'transaction-response';
  total?: number;
  entry?: FhirBundleEntry<T>[];
}

export interface FhirBundleEntry<T = FhirResource> {
  resource?: T;
  fullUrl?: string;
  request?: { method: string; url: string };
  response?: {
    status: string;
    location?: string;
    // 부분 성공/경고·스코프 거부 등 처리 결과 상세(FHIR OperationOutcome)
    outcome?: { resourceType: 'OperationOutcome'; issue: { severity: string; code: string; diagnostics?: string }[] };
  };
}

// Union type for all FHIR resources
export type FhirResource =
  | FhirPatient
  | FhirEncounter
  | FhirMedicationRequest
  | FhirCondition
  | FhirPractitioner
  | FhirOrganization
  | FhirAllergyIntolerance
  | FhirProcedure
  | FhirAppointment
  | FhirDiagnosticReport
  | FhirServiceRequest
  | FhirLocation
  | FhirCarePlan
  | FhirDocumentReference;

export interface FhirCapabilityStatement {
  resourceType: 'CapabilityStatement';
  status: 'active';
  kind: 'instance';
  fhirVersion: '4.0.1';
  format: string[];
  rest: FhirRestComponent[];
}

export interface FhirRestComponent {
  mode: 'server';
  security?: {
    service?: { coding: { code: string; system?: string; display?: string }[]; text?: string }[];
    description?: string;
    // SMART OAuth URI 확장(token/authorize 엔드포인트 광고)
    extension?: {
      url: string;
      extension?: { url: string; valueUri: string }[];
    }[];
  };
  resource?: FhirRestResource[];
}

export interface FhirRestResource {
  type: string;
  interaction?: { code: string }[];
  searchParam?: { name: string; type: string }[];
}

export interface FhirOperationOutcome {
  resourceType: 'OperationOutcome';
  issue: {
    severity: 'error' | 'warning' | 'information';
    code: string;
    diagnostics?: string;
  }[];
}

// ── Common FHIR Data Types ──

export interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirReference {
  reference?: string;
  display?: string;
}

export interface FhirPeriod {
  start?: string;
  end?: string;
}

export interface FhirDosage {
  text?: string;
  timing?: { code?: FhirCodeableConcept };
  route?: FhirCodeableConcept;
  doseAndRate?: { doseQuantity?: { value?: number; unit?: string } }[];
}

// ── Encounter Resource ──

export interface FhirEncounter {
  resourceType: 'Encounter';
  id?: string;
  // R4 값 목록 그대로 — 'amended' 는 Encounter 상태가 아니다(2026-10-01 제거)
  status?: 'planned' | 'arrived' | 'triaged' | 'in-progress' | 'onleave' | 'finished' | 'cancelled' | 'entered-in-error' | 'unknown';
  /** R4 상태 이력 — 원장 시각에서 파생한 구간만 */
  statusHistory?: { status: string; period: FhirPeriod }[];
  class?: FhirCoding;
  type?: FhirCodeableConcept[];
  subject?: FhirReference;
  participant?: { individual?: FhirReference }[];
  period?: FhirPeriod;
  reasonCode?: FhirCodeableConcept[];
  diagnosis?: { condition?: FhirReference; use?: FhirCodeableConcept }[];
}

// ── MedicationRequest Resource ──

export interface FhirMedicationRequest {
  resourceType: 'MedicationRequest';
  id?: string;
  status?: 'active' | 'on-hold' | 'cancelled' | 'completed' | 'entered-in-error' | 'stopped' | 'draft' | 'unknown';
  intent?: 'proposal' | 'plan' | 'order' | 'original-order' | 'reflex-order' | 'filler-order' | 'instance-order' | 'option';
  medicationCodeableConcept?: FhirCodeableConcept;
  subject?: FhirReference;
  encounter?: FhirReference;
  requester?: FhirReference;
  dosageInstruction?: FhirDosage[];
  authoredOn?: string;
}

// ── Observation Resource ──

export interface FhirObservation {
  resourceType: 'Observation';
  id?: string;
  status?: 'registered' | 'preliminary' | 'final' | 'amended' | 'corrected' | 'cancelled' | 'entered-in-error' | 'unknown';
  category?: FhirCodeableConcept[];
  code?: FhirCodeableConcept;
  subject?: FhirReference;
  valueQuantity?: { value?: number; unit?: string; system?: string; code?: string };
  referenceRange?: { low?: { value?: number; unit?: string }; high?: { value?: number; unit?: string }; text?: string }[];
}

// ── Condition Resource ──

export interface FhirCondition {
  resourceType: 'Condition';
  id?: string;
  clinicalStatus?: FhirCodeableConcept;
  code?: FhirCodeableConcept;
  subject?: FhirReference;
  encounter?: FhirReference;
  recordedDate?: string;
}

// ── Practitioner Resource ──

export interface FhirPractitioner {
  resourceType: 'Practitioner';
  id?: string;
  identifier?: FhirIdentifier[];
  name?: FhirHumanName[];
  telecom?: FhirContactPoint[];
  qualification?: {
    code?: FhirCodeableConcept;
    identifier?: FhirIdentifier[];
  }[];
  active?: boolean;
}

// ── Organization Resource ──

export interface FhirOrganization {
  resourceType: 'Organization';
  id?: string;
  name?: string;
  type?: FhirCodeableConcept[];
  telecom?: FhirContactPoint[];
  address?: FhirAddress[];
  active?: boolean;
}

// ── AllergyIntolerance Resource ──

export interface FhirAllergyIntolerance {
  resourceType: 'AllergyIntolerance';
  id?: string;
  clinicalStatus?: FhirCodeableConcept;
  verificationStatus?: FhirCodeableConcept;
  category?: string[];
  criticality?: 'low' | 'high' | 'unable-to-assess';
  code?: FhirCodeableConcept;
  patient?: FhirReference;
  onsetDateTime?: string;
  recordedDate?: string;
  note?: { text?: string }[];
}

// ── Procedure Resource ──

export interface FhirProcedure {
  resourceType: 'Procedure';
  id?: string;
  status?: 'preparation' | 'in-progress' | 'not-done' | 'on-hold' | 'stopped' | 'completed' | 'entered-in-error' | 'unknown';
  code?: FhirCodeableConcept;
  subject?: FhirReference;
  performedDateTime?: string;
  performedPeriod?: FhirPeriod;
  performer?: { actor?: FhirReference }[];
  note?: { text?: string }[];
}

// ── Appointment Resource ──

export interface FhirAppointment {
  resourceType: 'Appointment';
  id?: string;
  status?: 'proposed' | 'pending' | 'booked' | 'arrived' | 'fulfilled' | 'cancelled' | 'noshow' | 'entered-in-error' | 'checked-in' | 'waitlist';
  appointmentType?: FhirCodeableConcept;
  reasonCode?: FhirCodeableConcept[];
  start?: string;
  end?: string;
  minutesDuration?: number;
  participant?: {
    actor?: FhirReference;
    status?: 'accepted' | 'declined' | 'tentative' | 'needs-action';
  }[];
  created?: string;
}

// ── DiagnosticReport Resource ──

export interface FhirDiagnosticReport {
  resourceType: 'DiagnosticReport';
  id?: string;
  status?: 'registered' | 'partial' | 'preliminary' | 'final' | 'amended' | 'corrected' | 'appended' | 'cancelled' | 'entered-in-error' | 'unknown';
  category?: FhirCodeableConcept[];
  code?: FhirCodeableConcept;
  subject?: FhirReference;
  effectiveDateTime?: string;
  issued?: string;
  performer?: FhirReference[];
  result?: FhirReference[];
  conclusion?: string;
}

// ── 공용 메타 (증분 폴링 커서 — LIS H2) ──

export interface FhirMeta {
  lastUpdated?: string; // ISO — 소스 모델 updatedAt. LIS는 이 값으로 다음 _lastUpdated=ge{} 커서 전진
  versionId?: string;
}

// ── ServiceRequest Resource ──

export interface FhirServiceRequest {
  resourceType: 'ServiceRequest';
  id?: string;
  meta?: FhirMeta;
  status?: 'draft' | 'active' | 'on-hold' | 'revoked' | 'completed' | 'entered-in-error' | 'unknown';
  intent?: 'proposal' | 'plan' | 'directive' | 'order' | 'original-order' | 'reflex-order' | 'filler-order' | 'instance-order' | 'option';
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
  code?: FhirCodeableConcept;
  subject?: FhirReference;
  encounter?: FhirReference;
  requester?: FhirReference;
  authoredOn?: string;
  category?: FhirCodeableConcept[];
}

// ── Location Resource ──

export interface FhirLocation {
  resourceType: 'Location';
  id?: string;
  name?: string;
  description?: string;
  status?: 'active' | 'suspended' | 'inactive';
  mode?: 'instance' | 'kind';
  type?: FhirCodeableConcept[];
  physicalType?: FhirCodeableConcept;
  partOf?: FhirReference;
}

// ── CarePlan Resource ──

export interface FhirCarePlan {
  resourceType: 'CarePlan';
  id?: string;
  status?: 'draft' | 'active' | 'on-hold' | 'revoked' | 'completed' | 'entered-in-error' | 'unknown';
  intent?: 'proposal' | 'plan' | 'order' | 'option';
  category?: FhirCodeableConcept[];
  title?: string;
  subject?: FhirReference;
  period?: FhirPeriod;
  author?: FhirReference;
  activity?: {
    detail?: {
      kind?: string;
      code?: FhirCodeableConcept;
      status?: string;
      description?: string;
      scheduledString?: string;
    };
  }[];
  note?: { text?: string }[];
}

// ── DocumentReference Resource ──

export interface FhirDocumentReference {
  resourceType: 'DocumentReference';
  id?: string;
  status?: 'current' | 'superseded' | 'entered-in-error';
  type?: FhirCodeableConcept;
  category?: FhirCodeableConcept[];
  subject?: FhirReference;
  date?: string;
  author?: FhirReference[];
  description?: string;
  content?: {
    attachment?: {
      contentType?: string;
      /** base64 본문 — 트윈이 write-back 한 SBAR 처럼 원문이 DB 에 있는 경우 */
      data?: string;
      url?: string;
      title?: string;
      creation?: string;
    };
  }[];
}
