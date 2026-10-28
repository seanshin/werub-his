/** 서버 `GET /api/v1/orders/tracking`(OrderTrackingService.getTracking) 계약 */
import type { OrderDept, OrderNote, OrderStageKey, OrderTrackPhase } from '@hospital-run/shared';

/** 환자 — 이름은 정본(joinPatientName)으로 조립된 원어 · 외국인은 한국식 호칭(koreanName) */
export interface TrackPatient { id: string; name: string; koreanName?: string | null; mrn: string; age?: number | null; gender?: string | null }
export interface TrackLocation { ward: string | null; room: string; bed: string }

export interface TrackOrder {
  id: string; department: OrderDept; name: string | null; priority: string; status: string; phase: OrderTrackPhase;
  careContext: string; patient: TrackPatient | null; location?: TrackLocation | null; doctor: string | null; createdAt: string;
  stages: { key: OrderStageKey; at: string | null }[];
  current: { key: OrderStageKey; at: string | null } | null; next: OrderStageKey | null;
  inStageMin: number | null; sinceOrderedMin: number | null; totalMin: number | null;
  critical: boolean; abnormal: boolean; attention: boolean | null; carriedOver: boolean;
}
export interface TrackCell {
  total: number; byPhase: Record<OrderTrackPhase, number>; stat: number; critical: number; attention: number;
  oldestActiveMin: number | null; orderIds: string[];
}
export interface Tracking {
  date: string; now: string; population: 'DAY_ISSUED_PLUS_ACTIVE'; truncated: boolean; total: number;
  attention: { configured: boolean; thresholds: Record<string, number> | null };
  summary: { active: number; waiting: number; inProcess: number; resultUnack: number; done: number; cancelled: number; statActive: number; critical: number; attention: number | null; carriedOver: number };
  lanes: { department: OrderDept; total: number; byPhase: Record<OrderTrackPhase, number>; stat: number; oldestWaitingMin: number | null; turnaroundMin: { value: number | null; n: number } }[];
  orders: TrackOrder[];
  matrix: { patient: TrackPatient; careContext: string; location?: TrackLocation | null; doctors?: string[]; notes?: OrderNote[]; total: number; active: number; stat: number; critical: number; oldestActiveMin: number | null; cells: Record<OrderDept, TrackCell | null> }[];
}

/** 국면 색 — 보드 열·매트릭스 막대·범례가 같은 표 */
export const PHASE_TONE: Record<OrderTrackPhase, { bar: string; soft: string; text: string }> = {
  WAITING: { bar: 'bg-amber-400', soft: 'bg-amber-50', text: 'text-amber-800' },
  IN_PROCESS: { bar: 'bg-sky-500', soft: 'bg-sky-50', text: 'text-sky-800' },
  RESULT_UNACK: { bar: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-800' },
  DONE: { bar: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-800' },
  CANCELLED: { bar: 'bg-gray-300', soft: 'bg-gray-50', text: 'text-gray-500' },
};
export const DEPT_TONE: Record<OrderDept, string> = {
  LAB: 'bg-teal-50 text-teal-700 ring-teal-200', IMAGING: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  PHARMACY: 'bg-amber-50 text-amber-800 ring-amber-200', THERAPY: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
};
