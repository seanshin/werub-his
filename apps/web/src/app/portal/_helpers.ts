import type { DiagnosticTest, PortalItem } from './_types';
import { portalDateText } from './_shared/portal-date';

export const unwrapResponse = (d: unknown): unknown[] => Array.isArray(d) ? d : (d as PortalItem)?.data as unknown[] ?? [];

// 🔴 포털 언어 축 정본 경유 — 종전 `toLocaleDateString('ko')` 는 영어·중국어·일본어 환자에게도 `2026. 9. 12.` 를 그렸다(ko 출력은 동일)
export const fmt = (d: string | null | undefined) => portalDateText(d, 'date');
export const fmtTime = (d: string | null | undefined) => { if (!d) return '-'; const dt = new Date(d); return isNaN(dt.getTime()) ? '-' : `${dt.getHours()}:${String(dt.getMinutes()).padStart(2, '0')}`; };
export const currency = (n: number) => n.toLocaleString() + '원';

/** 기초검사 — 서버 계약(`testType`·`testName`·`conclusion`·`findings`)을 화면 모양으로. 없는 값은 null(지어내지 않는다) */
export function toDiagnosticTest(d: Record<string, unknown>): DiagnosticTest {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  return {
    id: String(d.id ?? ''),
    type: str(d.testType ?? d.type),
    name: str(d.testName ?? d.name),
    performedAt: String(d.performedAt ?? ''),
    conclusion: str(d.conclusion),
    findings: str(d.findings),
    // 판독 검토 전이면 서버가 결론·소견을 비운다(결정 portal.labResultRelease) — 상태를 모르면(옛 응답) null
    release: d.release === 'REVIEWED' || d.release === 'AWAITING_REVIEW' ? d.release : null,
    reviewedAt: str(d.reviewedAt),
  };
}

/** 진료 이력 한 줄의 진단명 — 추정 진단은 "(추정)"을 붙인다 · 감별·배제 진단은 서버가 이미 뺐다 */
export function encounterDiagnosisNames(diagnoses: unknown): string[] {
  if (!Array.isArray(diagnoses)) return [];
  return diagnoses
    .map((d: PortalItem) => {
      const name = ((d.diagnosisCode as PortalItem | undefined)?.nameKo ?? d.name) as string | undefined;
      if (!name) return null;
      return d.certainty === 'PROVISIONAL' ? `${name} (추정)` : name;
    })
    .filter((n): n is string => n != null);
}

/** 다가오는 예약 = 오늘(병원 시간대) 이후이면서 끝나지 않은 것 · 나머지는 지난 예약(최신 먼저) */
const CLOSED_APPOINTMENT = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW']);
export function splitAppointments<T extends { scheduledAt: string; status: string }>(list: T[], now = new Date()): { upcoming: T[]; past: T[] } {
  const todayStart = new Date(`${new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)}T00:00:00+09:00`).getTime();
  const isUpcoming = (a: T) => !CLOSED_APPOINTMENT.has(a.status) && new Date(a.scheduledAt).getTime() >= todayStart;
  const upcoming = list.filter(isUpcoming).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const past = list.filter((a) => !isUpcoming(a)).sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
  return { upcoming, past };
}
