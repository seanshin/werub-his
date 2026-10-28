/** 수술실 실시간 모니터 응답(`GET /api/v1/surgery/live-board`) — 서버 `SurgeryMonitorService.getLiveBoard` 와 같은 모양 */
import type { IntraopVitalPoint, SurgeryPhase } from '@hospital-run/shared';

export type LiveCase = {
  id: string; status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'; procedureName: string;
  bodySite: string | null; laterality: string | null;
  scheduledAt: string; startedAt: string | null; endedAt: string | null;
  patient: { id: string; name: string; koreanName?: string | null; mrn: string } | null; surgeon: string | null; anesthesiaType: string | null;
  phases: { key: SurgeryPhase; at: string | null }[]; lastPhase: SurgeryPhase | null;
  runMin: number | null; estimatedMin: number | null; overrunMin: number | null;
  safety: { checklistPresent: boolean; signIn: boolean; timeOut: boolean; signOut: boolean; countStatus: string | null; countUnresolved: boolean; lateralitySet: boolean };
  preAnesthesia: { asaClass: string | null; status: string; completedAt: string | null; npoConfirmed: boolean } | null;
  asaClass: string | null;
  anesthesia: {
    inductionAt: string | null; intubationAt: string | null; extubationAt: string | null; ebl: number | null; urineOutput: number | null;
    vitals: IntraopVitalPoint[] | null; vitalsTotal: number | null; vitalsTruncated: boolean; lastVitalAt: string | null;
  } | null;
  ebl: number | null;
  pacu: { arrivalAt: string; dischargeAt: string | null; aldrete: number | null } | null;
  slot?: { startTime: string; endTime: string; estimatedDuration: number; plannedStart: string | null; plannedEnd: string | null };
};

/** 예약은 있는데 수술 원장에서 못 찾은 칸 */
export type MissingCase = { id: string; missing: true; slot: NonNullable<LiveCase['slot']> };

export type LiveRoom = {
  id: string; name: string; floor: string | null; roomType: string;
  state: 'IN_USE' | 'WAITING' | 'IDLE'; currentCaseId: string | null; nextCaseId: string | null;
  cases: (LiveCase | MissingCase)[];
};

export type LiveBoard = {
  date: string; now: string; rooms: LiveRoom[]; unassigned: LiveCase[];
  summary: { rooms: number; inUse: number; inProgress: number; scheduled: number; completed: number; overrun: number; staleInProgress: number };
};

export const isLive = (c: LiveCase | MissingCase): c is LiveCase => !('missing' in c);
