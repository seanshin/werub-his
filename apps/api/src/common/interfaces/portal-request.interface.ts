import { Request } from 'express';

/**
 * 포털/환자 인증 Guard가 주입하는 확장 Request 인터페이스.
 * - PortalOrPatientGuard → portalPatientId (+ patientAccountId if 앱 JWT)
 * - PatientAccountAuthGuard → portalPatientId + patientAccountId
 */
export interface PortalRequest extends Request {
  portalPatientId: string;
  patientAccountId?: string;
  // 보호자(위임) 접근 컨텍스트 (PortalAuthGuard가 주입)
  isGuardianAccess?: boolean;
  guardianAccountId?: string;
  guardianScope?: Record<string, boolean>;
}

export interface PatientAccountRequest extends Request {
  portalPatientId: string;
  patientAccountId: string;
}
