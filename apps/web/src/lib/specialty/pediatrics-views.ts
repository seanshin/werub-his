/**
 * 소아 성장기록 → 성장곡선 입력 매퍼 정본 (2026-08-26)
 *
 * 🔴 배경: 성장곡선을 그리는 화면이 셋인데 둘이 `gender="male"` 을 **하드코딩**하고 있었다
 *    (`app/(main)/pediatrics/page.tsx` 는 `data={[]}` 까지 하드코딩 — 운영 457행이 하나도 안 찍혔다).
 *    성장곡선의 백분위 참조선은 성별로 다르므로, 하드코딩은 **여아를 남아 곡선 위에 그리는** 임상 오정보다.
 *
 * 규약:
 * - 성별은 **환자 원장에서 온 값**만 쓴다. `OTHER`/`UNKNOWN`/부재는 `null`(미상)이고,
 *   차트는 미상일 때 참조곡선을 그리지 않고 그 사실을 화면에 말한다.
 * - 계측값은 `?? 0` 으로 채우지 않는다 — 안 잰 것을 0kg 으로 만들면 곡선이 거짓말한다.
 */
import type { GrowthDataPoint, GrowthSex } from '@/components/specialty/GrowthCurveChart';

/** 숫자만 통과(Prisma Decimal 의 문자열 직렬화 포함). 0 은 유효값이므로 버리지 않는다. */
export function numOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 성장기록 행에 실린 환자 성별(`patient.gender`) → 곡선 성별.
 * 🔴 `MALE`/`FEMALE` 외에는 전부 `null`(미상) — 임의로 남아로 접지 않는다.
 */
export function growthSexOf(row: Record<string, unknown> | undefined): GrowthSex {
  const patient = row?.patient as { gender?: unknown } | undefined;
  const g = typeof patient?.gender === 'string' ? patient.gender.toUpperCase() : null;
  if (g === 'MALE') return 'male';
  if (g === 'FEMALE') return 'female';
  return null;
}

/* ── 발달평가 결과 어휘 ─────────────────────────────────────────
 * 🔴 같은 값에 표현이 셋이었다:
 *   · `patients/[id]/components/PediatricsTab.tsx` — NORMAL/DELAYED/AT_RISK/CAUTION/SUSPECT/ADVANCED
 *   · `app/(main)/pediatrics/page.tsx` — NORMAL/CAUTION/DELAY/ADVANCED 만 아는 로컬 Record
 *     (게다가 `DENVER_LABEL` 은 선언만 되고 한 번도 쓰이지 않아 셀에 **영문 원문**이 노출됐다)
 *   · 진료 입력 화면 — NORMAL/SUSPECT/DELAYED 로 저장
 *   → 입력이 저장한 `SUSPECT`/`DELAYED` 를 대시보드가 모르는 값으로 회색 처리했다.
 * 여기를 정본으로 두고 세 화면이 같이 읽는다. **모르는 값은 원문 그대로** 보여준다(삼키지 않는다).
 */
export const DEV_RESULT_LABEL: Record<string, string> = {
  NORMAL: '정상',
  ADVANCED: '우수',
  AT_RISK: '경계',
  CAUTION: '주의',
  SUSPECT: '의심',
  DELAY: '지연',
  DELAYED: '지연',
};

export const DEV_RESULT_COLOR: Record<string, string> = {
  NORMAL: 'bg-emerald-100 text-emerald-700',
  ADVANCED: 'bg-blue-100 text-blue-700',
  AT_RISK: 'bg-amber-100 text-amber-700',
  CAUTION: 'bg-amber-100 text-amber-700',
  SUSPECT: 'bg-amber-100 text-amber-700',
  DELAY: 'bg-red-100 text-red-700',
  DELAYED: 'bg-red-100 text-red-700',
};

/** 미평가(`null`/빈 문자열)는 회색 `-` — '정상'으로 접지 않는다. */
export function devResultView(v: unknown): { label: string; cls: string } | null {
  if (v == null || v === '') return null;
  const key = String(v);
  return { label: DEV_RESULT_LABEL[key] ?? key, cls: DEV_RESULT_COLOR[key] ?? 'bg-gray-100 text-gray-600' };
}

/**
 * 4개 영역 결과 → 종합판정. **가장 나쁜 영역**을 그대로 올린다(평균·다수결로 뭉개지 않는다).
 * 하나라도 미평가면 `null` — 종합판정을 지어내지 않는다.
 */
export function devOverallResult(results: (string | null | undefined)[]): string | null {
  if (results.length === 0 || results.some((r) => r == null || r === '')) return null;
  const rank = (r: string) => (r === 'DELAYED' || r === 'DELAY' ? 3 : r === 'SUSPECT' || r === 'CAUTION' || r === 'AT_RISK' ? 2 : 1);
  return (results as string[]).reduce((worst, r) => (rank(r) > rank(worst) ? r : worst));
}

/** 성장기록 목록 → 곡선 점. 월령이 없는 행은 x축에 놓을 자리가 없으므로 제외한다. */
export function growthPointsOf(rows: Record<string, unknown>[]): GrowthDataPoint[] {
  const points: GrowthDataPoint[] = [];
  for (const r of rows) {
    const ageMonths = numOrNull(r.ageMonths);
    if (ageMonths == null) continue;
    points.push({
      ageMonths,
      weight: numOrNull(r.weight) ?? undefined,
      height: numOrNull(r.height) ?? undefined,
    });
  }
  return points.sort((a, b) => a.ageMonths - b.ageMonths);
}
