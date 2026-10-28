/**
 * 재활 치료 완료 본문·평가 표시(2026-10-07).
 *  · 종전 화면은 `activities` 를 배열로 보내 DTO `@IsObject` 가 400 — 활동을 적으면 완료 저장이 늘 실패했다
 *  · 활동마다 `duration: 30` 을 지어 붙였다 → 치료 시간은 사람이 적은 값만(없으면 서버가 시작~완료로 잰다)
 *  · 평가 표가 서버에 없는 `painVas`·`gaitStatus`·`riskLevel` 을 읽어 늘 '-' — 정본은 `vas`·`gait`, 위험도는 Berg 해석
 */
export type RehabCompleteForm = { activities: string; bp: string; hr: string; progress: string; duration: string };

export const emptyRehabCompleteForm = (): RehabCompleteForm => ({ activities: '', bp: '', hr: '', progress: '', duration: '' });

export function buildRehabCompleteBody(f: RehabCompleteForm): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.activities.trim()) body.activities = { text: f.activities.trim() };
  const vitals: Record<string, unknown> = {};
  if (f.bp.trim()) vitals.bp = f.bp.trim();
  const hr = f.hr.trim() === '' ? null : Number(f.hr);
  if (hr != null && Number.isFinite(hr) && Math.sign(hr) === 1) vitals.hr = hr;
  if (Object.keys(vitals).length) body.vitals = vitals;
  if (f.progress.trim()) body.progress = f.progress.trim();
  const dur = f.duration.trim() === '' ? null : Number(f.duration);
  if (dur != null && Number.isInteger(dur) && dur > 0) body.duration = dur;
  return body;
}

/** 활동 표시 — 새 모양 `{text}` · 옛 배열 `[{name}]` 둘 다 읽는다. */
export function rehabActivitiesText(v: unknown): string | null {
  if (!v) return null;
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? (x as { name?: string }).name : String(x))).filter(Boolean).join(', ') || null;
  if (typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string') return (v as { text: string }).text;
  return null;
}

/** Berg 균형 척도 낙상 위험 해석(0~20 고위험·21~40 중위험·41~56 저위험) — 점수 없으면 null(미평가). */
export function bergFallRisk(berg: number | null | undefined): 'HIGH' | 'MODERATE' | 'LOW' | null {
  if (typeof berg !== 'number' || !Number.isFinite(berg)) return null;
  if (berg <= 20) return 'HIGH';
  if (berg <= 40) return 'MODERATE';
  return 'LOW';
}
