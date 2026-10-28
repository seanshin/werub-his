export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  scheduledAt: string;
  duration: number;
  status: AppointmentStatus;
  type: AppointmentType;
  reason?: string;
  notes?: string;
  patient: { id: string; mrn: string; familyName: string; givenName: string };
  doctor: { id: string; familyName: string; givenName: string };
  createdAt: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type AppointmentType = 'INITIAL' | 'FOLLOW_UP' | 'URGENT' | 'ROUTINE';

// APPOINTMENT_STATUS_LABEL 정본 정렬(예약·미내원) — 종전 신청/미방문 드리프트 봉합
export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: '예약',
  CONFIRMED: '확정',
  CHECKED_IN: '접수',
  IN_PROGRESS: '진료중',
  COMPLETED: '완료',
  CANCELLED: '취소',
  NO_SHOW: '미내원',
};

export const STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-slate-100 text-slate-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  CHECKED_IN: 'bg-yellow-100 text-yellow-700',
  IN_PROGRESS: 'bg-purple-100 text-purple-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  NO_SHOW: 'bg-red-100 text-red-700',
};

export const TYPE_LABEL: Record<AppointmentType, string> = {
  INITIAL: '초진',
  FOLLOW_UP: '재진',
  URGENT: '응급',
  ROUTINE: '정기',
};
