/**
 * 환자 여정 화면 공용 표시 도우미(직원 여정 탭 · 관제 상세 · 대시보드가 같이 쓴다 — 표시가 갈라지지 않게).
 * 유형 라벨·트랙은 shared `journey-display` 정본, 여기는 웹 색·정렬 규칙만.
 */
import { JOURNEY_EVENT_ALIASES, journeyEventDisplay, type JourneyTrack } from '@hospital-run/shared';

/** 트랙 색 — 표시 묶음일 뿐 상태가 아니다 */
export const TRACK_TONE: Record<JourneyTrack, string> = {
  OPD: 'bg-blue-50 text-blue-700', ER: 'bg-rose-50 text-rose-700', IPD: 'bg-violet-50 text-violet-700',
  OR: 'bg-fuchsia-50 text-fuchsia-700', CHECKUP: 'bg-emerald-50 text-emerald-700', ORDER: 'bg-amber-50 text-amber-800',
  BILLING: 'bg-slate-100 text-slate-700', CONSENT: 'bg-cyan-50 text-cyan-700', OTHER: 'bg-gray-100 text-gray-600',
};
/** 타임라인 점 색(트랙) */
export const TRACK_DOT: Record<JourneyTrack, string> = {
  OPD: 'bg-blue-500', ER: 'bg-rose-500', IPD: 'bg-violet-500', OR: 'bg-fuchsia-500', CHECKUP: 'bg-emerald-500',
  ORDER: 'bg-amber-500', BILLING: 'bg-slate-400', CONSENT: 'bg-cyan-500', OTHER: 'bg-gray-400',
};
export const TRACK_ORDER: JourneyTrack[] = ['OPD', 'ER', 'IPD', 'OR', 'CHECKUP', 'ORDER', 'BILLING', 'CONSENT', 'OTHER'];

/** 표시 정본 — 옛 이름은 정본 별칭으로 읽는다(저장값은 바꾸지 않는다) */
export function displayOf(eventType: string) {
  return journeyEventDisplay(eventType) ?? journeyEventDisplay(JOURNEY_EVENT_ALIASES[eventType]);
}

/** 줄을 놓는 시각 — 발생 시각, 모르면 종전 표시 시각(그 사실은 시각 칸이 표식으로 말한다) */
export function placedAt(ev: { occurredAt?: string | null; eventAt: string }): number {
  const o = ev.occurredAt ? Date.parse(ev.occurredAt) : NaN;
  return Number.isFinite(o) ? o : Date.parse(ev.eventAt);
}

/** 제목이 라벨을 이미 말하면 라벨을 따로 보이지 않는다("검사 결과 · 검사 결과 완료" 중복 제거) */
export function titleCoversLabel(title: string | null | undefined, label: string | null | undefined): boolean {
  if (!title || !label) return false;
  const norm = (s: string) => s.replace(/\s+/g, '');
  return norm(title).includes(norm(label));
}
