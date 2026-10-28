/**
 * 청력도(오디오그램) 읽기 정본 — 2026-08-26.
 *
 * 🔴 이비인후과 대시보드의 청력도가 **개통 이래 한 번도 그려진 적이 없었다.** 두 겹으로 죽어 있었다:
 *   ① 어휘: 서버(`ent.service.getAudiogram`)는 `audiogramRight`/`audiogramLeft` 를 주는데
 *      화면은 `rightAC`/`acRight`/`rightBC`/`bcRight` 를 읽었다 → **교집합 0**(FE 가 지어낸 어휘).
 *   ② 값 키: 저장 정본은 `[{freq, ac, bc?}]` 인데 파서는 `db` 키를 요구해 전건 탈락했다.
 *
 * 🔴 **정본은 서버 저장 형태다.** 운영 `ent_exams` 4/4건 실측:
 *   `[{"ac": 10, "bc": 5, "freq": 250}, …]` (bc 는 있을 수도 없을 수도 있다)
 *
 * 같은 개념의 정본이 둘이 되지 않게 대시보드(`app/(main)/ent/page.tsx`)와
 * 환자 차트 탭(`app/(main)/patients/[id]/components/EntTab.tsx`)이 이 함수 하나를 쓴다.
 */

import type { AudiogramPoint } from '@/components/specialty/AudiogramChart';

/**
 * 저장된 JSONB 한 귀(`audiogramRight` | `audiogramLeft`)에서 기도(`ac`)/골도(`bc`) 계열을 뽑는다.
 *
 * - 모르는 모양은 **지어내지 않고 버린다**(빈 배열 = "그릴 것이 없다").
 * - 구형 `{freq: db}` 객체는 기도만 담는다 — 골도로 넘겨 짚지 않는다.
 * - `db` 키 폴백은 **기도에만** 적용한다(측정 종류가 명시되지 않은 값을 골도라고 말하지 않는다).
 */
export function parseAudiogramSeries(field: unknown, key: 'ac' | 'bc'): AudiogramPoint[] {
  if (!field) return [];
  if (Array.isArray(field)) {
    return (field as Array<Record<string, unknown>>)
      .filter((p) => p != null && p.freq != null && (p[key] ?? (key === 'ac' ? p.db : undefined)) != null)
      .map((p) => ({ freq: Number(p.freq), db: Number(p[key] ?? p.db) }))
      .filter((p) => Number.isFinite(p.freq) && Number.isFinite(p.db));
  }
  if (key === 'ac' && typeof field === 'object') {
    return Object.entries(field as Record<string, unknown>)
      .filter(([, v]) => v != null)
      .map(([k, v]) => ({ freq: Number(k), db: Number(v) }))
      .filter((p) => Number.isFinite(p.freq) && Number.isFinite(p.db));
  }
  return [];
}

/**
 * 목록에서 **가장 최근** 검사를 고른다.
 *
 * 🔴 서버(`getAudiogram`)는 `examinedAt: 'asc'` 로 준다 — 화면이 `rows[0]` 을 "최신"이라 부르면
 *    실제로는 **가장 오래된** 청력도를 그린다. 차트가 한 번도 렌더된 적이 없어 아무도 못 봤을 뿐이다.
 *    순서에 기대지 않고 시각으로 고른다(시각이 없는 행은 후보로 삼지 않는다).
 */
export function latestAudiogramRow(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const t = (r: Record<string, unknown>) => {
    const v = r.examinedAt;
    const ms = v == null ? NaN : new Date(v as string).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  const dated = rows.filter((r) => t(r) != null);
  if (dated.length === 0) return rows[rows.length - 1]; // 시각을 못 읽으면 서버 정렬(asc)의 끝
  return dated.reduce((a, b) => ((t(b) as number) > (t(a) as number) ? b : a));
}

/** 검사 한 건에서 차트가 받는 네 계열을 만든다. */
export function audiogramSeriesOf(latest: Record<string, unknown>): {
  rightAC: AudiogramPoint[]; leftAC: AudiogramPoint[];
  rightBC: AudiogramPoint[]; leftBC: AudiogramPoint[];
} {
  return {
    rightAC: parseAudiogramSeries(latest.audiogramRight, 'ac'),
    leftAC: parseAudiogramSeries(latest.audiogramLeft, 'ac'),
    rightBC: parseAudiogramSeries(latest.audiogramRight, 'bc'),
    leftBC: parseAudiogramSeries(latest.audiogramLeft, 'bc'),
  };
}
