// ── Enums ──
export type UserRole = 'ADMIN' | 'DOCTOR' | 'NURSE' | 'PHARMACIST' | 'LAB_TECH';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
export type InsuranceType = 'NHI' | 'MEDICAID' | 'INDUSTRIAL' | 'AUTO' | 'SELF_PAY';
export type AppointmentStatus = 'SCHEDULED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type AppointmentType = 'INITIAL' | 'FOLLOW_UP' | 'URGENT' | 'ROUTINE';
export type EncounterStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'SIGNED' | 'AMENDED';
export type OrderStatus = 'ORDERED' | 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type BillingStatus = 'PENDING' | 'PAID' | 'PARTIAL' | 'REFUNDED' | 'CANCELLED';
export type AdmissionStatus = 'ADMITTED' | 'DISCHARGED' | 'TRANSFERRED' | 'CANCELLED';
export type TriageSeverity = 1 | 2 | 3 | 4 | 5;
export type InventoryRequestStatus = 'REQUESTED' | 'APPROVED' | 'ISSUED' | 'REJECTED' | 'CANCELLED';
export type PurchaseOrderStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';

// ── Entity Interfaces ──
export interface Patient {
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
  gender: Gender;
  birthDate: string;
  dateOfBirth?: string;
  phone?: string;
  insuranceType: InsuranceType;
  insuranceNumber?: string;
  address?: string;
  bloodType?: string;
  allergies?: string | string[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  familyName: string;
  givenName: string;
  role: UserRole;
  departmentId?: string;
  licenseNumber?: string;
  speciality?: string;
}

export interface Encounter {
  id: string;
  patientId: string;
  doctorId: string;
  appointmentId?: string;
  status: EncounterStatus;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  code: string;
  name: string;
  specification?: string;
  unit: string;
  category: string;
  currentStock: number;
  safetyStock: number;
  maxStock: number;
  unitPrice: number;
  storageId?: string;
  barcode?: string;
  isActive: boolean;
}

export interface InventorySupplier {
  id: string;
  name: string;
  businessNumber?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  isActive: boolean;
}

export interface ApiResponse<T> {
  data: T;
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

// ── Additional Enums ──
export type QueueStatus = 'WAITING' | 'CALLED' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type VisitType = 'INITIAL' | 'FOLLOW_UP';
export type PrescriptionType = 'MEDICATION' | 'LAB' | 'IMAGING';
export type PrescriptionPriority = 'STAT' | 'ROUTINE' | 'PRN';
/** 🔴 DB enum(EquipmentStatus)과 일치시킨 값 — 종전 'MAINTENANCE'|'INACTIVE' 는 존재하지 않는 상태였다 */
export type EquipmentStatus = 'ACTIVE' | 'UNDER_MAINTENANCE' | 'BROKEN' | 'RETIRED';
export type MaintenanceLogType = 'INSPECTION' | 'CALIBRATION' | 'REPAIR' | 'FAULT_REPORT' | 'AS_REQUEST';
export type MaintenanceLogStatus = 'REQUESTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

// ── Additional Entity Interfaces ──

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  scheduledAt: string;
  status: AppointmentStatus;
  type: AppointmentType;
  departmentName?: string;
  reason?: string;
  patient?: Pick<Patient, 'id' | 'familyName' | 'givenName' | 'mrn'>;
  doctor?: Pick<User, 'id' | 'familyName' | 'givenName'>;
}

export interface QueueEntry {
  id: string;
  queueNumber: number;
  patientId: string;
  doctorId?: string;
  departmentName: string;
  status: QueueStatus;
  visitType: VisitType;
  type: 'WALK_IN' | 'APPOINTMENT';
  checkedInAt: string;
  patient?: Pick<Patient, 'id' | 'familyName' | 'givenName' | 'mrn'>;
  doctor?: Pick<User, 'id' | 'familyName' | 'givenName'>;
}

export interface Prescription {
  id: string;
  encounterId: string;
  type: PrescriptionType;
  priority: PrescriptionPriority;
  medicationCodeId?: string;
  procedureCodeId?: string;
  dosage?: string;
  frequency?: string;
  duration?: number;
  quantity?: number;
  route?: string;
}

export interface Billing {
  id: string;
  patientId: string;
  encounterId?: string;
  totalAmount: number;
  paidAmount: number;
  status: BillingStatus;
  createdAt: string;
}

export interface Equipment {
  id: string;
  assetNumber: string;
  name: string;
  category: string;
  status: EquipmentStatus;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  location?: string;
  purchaseDate?: string;
  purchasePrice?: number;
  warrantyExpiry?: string;
  nextInspection?: string;
  supplierName?: string;
  supplierContact?: string;
  supplierPhone?: string;
  asContactName?: string;
  asContactPhone?: string;
  notes?: string;
}

export interface MaintenanceLog {
  id: string;
  equipmentId: string;
  type: MaintenanceLogType;
  status: MaintenanceLogStatus;
  description: string;
  performedBy?: string;
  vendor?: string;
  cost?: number;
  performedAt: string;
  partReplaced?: string;
  resultNotes?: string;
  equipment?: Pick<Equipment, 'name' | 'assetNumber'>;
}

export interface DiagnosisCode {
  id: string;
  code: string;
  nameKo: string;
  nameEn?: string;
}

export interface EncounterWithRelations extends Encounter {
  doctor?: Pick<User, 'id' | 'familyName' | 'givenName' | 'licenseNumber' | 'speciality' | 'departmentId'> & { department?: { name: string } };
  patient?: Pick<Patient, 'id' | 'familyName' | 'givenName' | 'mrn' | 'birthDate' | 'dateOfBirth' | 'gender' | 'insuranceType'>;
  diagnoses?: Array<{ id: string; diagnosisCode?: DiagnosisCode }>;
  prescriptions?: Prescription[];
}

/** Lightweight error shape for catch/onError handlers */
export interface MutationError {
  message?: string;
  details?: Record<string, unknown>;
  error?: { message?: string };
}

// ============================================================
// 건강검진 센터 (Checkup Center) Types
// ============================================================

export type CheckupVisitStatus =
  | 'RESERVED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'EXAM_COMPLETE'
  | 'REVIEW'
  | 'COMPLETED'
  | 'DELIVERED';

export type CheckupGrade = 'A' | 'B' | 'C1' | 'C2' | 'D1' | 'D2';

export type CheckupCategory = 'BASIC' | 'PLUS' | 'PRECISION' | 'PREMIUM' | 'PET_PRECISION' | 'SPECIAL';

export type CheckupItemCategory = 'LAB' | 'IMAGING' | 'DIAGNOSTIC' | 'PHYSICAL' | 'CONSULT' | 'AI';

export type CheckupFinding = 'NORMAL' | 'ABNORMAL' | 'CRITICAL' | 'PENDING';

export interface CheckupProgramItem {
  seq: number;
  category: CheckupItemCategory;
  name: string;
  codes: string[];
  interpretDept?: string;
  interpretRole?: 'DOCTOR' | 'AUTO';
}

export interface CheckupOption {
  id: string;
  name: string;
  price: number;
  category: CheckupItemCategory;
  codes: string[];
}

export interface CheckupSectionResult {
  area: string;
  grade: CheckupGrade;
  findings: string;
}

// ── ClinicAdapter — HIS Core 접근 인터페이스 ──

export interface LabOrderParams {
  encounterId: string;
  codes: string[];
  checkupVisitId?: string;
}

export interface ImagingOrderParams {
  encounterId: string;
  codes: string[];
  checkupVisitId?: string;
}

export interface DiagTestParams {
  encounterId: string;
  codes: string[];
  checkupVisitId?: string;
}

export interface AppointmentParams {
  patientId: string;
  doctorId?: string;
  department?: string;
  scheduledAt: string;
  reason?: string;
}

export interface ReferralParams {
  patientId: string;
  fromDepartment: string;
  toDepartment: string;
  reason: string;
  urgency: 'ROUTINE' | 'URGENT';
}

export interface BillingParams {
  patientId: string;
  encounterId: string;
  billingType: string;
  totalAmount: number;
  copayAmount: number;
  items: { name: string; amount: number; quantity: number }[];
}

export interface PatientInfo {
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
  gender: Gender;
  birthDate: string;
  phone?: string;
}

/** 스마트 환자 검색 결과 — PatientSelector/PatientAddModal 공통 인터페이스 */
export interface SmartPatientItem {
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
  gender: string;
  dateOfBirth?: string;
  age?: number;
  phone?: string;
  /** 상태 분류: 접수완료/검진접수/입원/응급/예약/최근진료/검색 */
  category: 'checkin' | 'checkup' | 'admitted' | 'emergency' | 'appointment' | 'recent' | 'search';
  /** 배지 텍스트 (예: "접수완료", "14:30 예약") */
  badge?: string;
  /** 배지 색상 (blue/green/purple/red/gray) */
  badgeColor?: string;
  /** 병동명 (입원 환자) */
  wardName?: string;
  /** 검진 프로그램명 */
  programName?: string;
  /** 검진 진행률 */
  checkupProgress?: { total: number; completed: number };
}

export interface ClinicAdapter {
  getPatient(patientId: string): Promise<PatientInfo>;
  searchPatients(query: string, limit?: number): Promise<PatientInfo[]>;
  createEncounter(patientId: string, visitType: string): Promise<{ encounterId: string }>;
  createLabOrder(params: LabOrderParams): Promise<{ orderId: string }>;
  createImagingOrder(params: ImagingOrderParams): Promise<{ orderId: string }>;
  createDiagnosticTest(params: DiagTestParams): Promise<{ testId: string }>;
  createAppointment(params: AppointmentParams): Promise<{ appointmentId: string }>;
  createReferral(params: ReferralParams): Promise<{ referralId: string }>;
  createBilling(params: BillingParams): Promise<{ billingId: string }>;
}
