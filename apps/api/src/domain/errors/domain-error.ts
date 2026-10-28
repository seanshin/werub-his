export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class PatientNotFoundError extends DomainError {
  constructor(id: string) {
    super('PATIENT_NOT_FOUND', `Patient with id ${id} not found`);
  }
}

export class DuplicateMrnError extends DomainError {
  constructor(mrn: string) {
    super('DUPLICATE_MRN', `Patient with MRN ${mrn} already exists`);
  }
}

export class AppointmentConflictError extends DomainError {
  constructor(doctorId: string, scheduledAt: Date, conflictId: string) {
    super(
      'APPOINTMENT_CONFLICT',
      `Doctor ${doctorId} already has appointment ${conflictId} at ${scheduledAt.toISOString()}`,
    );
  }
}

export class InvalidStatusTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      'INVALID_STATUS_TRANSITION',
      `Cannot transition from ${from} to ${to}`,
    );
  }
}

// ── EMR Enhancement Errors ──

export class ProblemNotFoundError extends DomainError {
  constructor(id: string) { super('PROBLEM_NOT_FOUND', `Problem ${id} not found`); }
}

export class ProblemAlreadyResolvedError extends DomainError {
  constructor(id: string) { super('PROBLEM_ALREADY_RESOLVED', `Problem ${id} is already resolved`); }
}

export class AllergyNotFoundError extends DomainError {
  constructor(id: string) { super('ALLERGY_NOT_FOUND', `Allergy record ${id} not found`); }
}

export class AllergyDrugConflictError extends DomainError {
  constructor(allergen: string, drug: string) {
    super('ALLERGY_DRUG_CONFLICT', `Drug allergy conflict: ${allergen} → ${drug}`, { allergen, drug });
  }
}

export class DischargeSummaryExistsError extends DomainError {
  constructor(admissionId: string) { super('DISCHARGE_SUMMARY_EXISTS', `Discharge summary already exists for admission ${admissionId}`); }
}

export class DischargeSummaryNotFoundError extends DomainError {
  constructor(admissionId: string) { super('DISCHARGE_SUMMARY_NOT_FOUND', `Discharge summary not found for admission ${admissionId}`); }
}

export class DischargeAlreadySignedError extends DomainError {
  constructor() { super('DISCHARGE_ALREADY_SIGNED', 'Discharge summary is already signed'); }
}

export class ConsentNotFoundError extends DomainError {
  constructor(id: string) { super('CONSENT_NOT_FOUND', `Consent form ${id} not found`); }
}

export class ConsentAlreadySignedError extends DomainError {
  constructor() { super('CONSENT_ALREADY_SIGNED', 'Consent form is already signed'); }
}

export class ConsentAlreadyRevokedError extends DomainError {
  constructor() { super('CONSENT_ALREADY_REVOKED', 'Consent form is already revoked'); }
}

export class NursingAssessmentExistsError extends DomainError {
  constructor(admissionId: string) { super('NURSING_ASSESSMENT_EXISTS', `Nursing assessment already exists for admission ${admissionId}`); }
}

export class AdmissionNotFoundError extends DomainError {
  constructor(id: string) { super('ADMISSION_NOT_FOUND', `Admission ${id} not found`); }
}

export class MedAdminNotScheduledError extends DomainError {
  constructor(id: string, status: string) { super('MED_ADMIN_NOT_SCHEDULED', `Cannot process: current status is ${status}`, { id, status }); }
}

export class MedAdminNotFoundError extends DomainError {
  constructor(id: string) { super('MED_ADMIN_NOT_FOUND', `Medication administration ${id} not found`); }
}
