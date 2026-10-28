/**
 * 내과 세부과 표시 정본 — 검사표 컬럼 + 점수추이 시리즈 (2026-08-26)
 *
 * 🔴 배경: 같은 개념의 정본이 **둘로 갈라져 있었다**(P12).
 *   · `patients/[id]/components/InternalMedicineTab.tsx` — 실컬럼명으로 이미 교정된 쪽
 *   · `app/(main)/internal-medicine/page.tsx`            — 옛 이름 그대로 남은 쪽
 *     `meld`/`haqdi`/`sofa`/`fev1fvc`/`childPugh`/`bmdTscore`/`frax`/`tnm`/`regimen`/`recist`/
 *     `antibiotic`/`tenderJoints`/`swollenJoints`/`autoantibody` — **14칸이 서버에 없는 이름**이라
 *     `formatCellValue(undefined) === '-'` 로 항상 비었다. 운영 실측: 그 14컬럼 각각 8행에 값이 있다.
 *     MELD·Child-Pugh 가 기록된 간경변 환자에게 화면이 `-` 를 보여주고 있었다.
 *
 * 🔴 그리고 점수추이는 **개통 이래 한 번도 렌더된 적이 없었다**: 서버 `getScoreTrend()` 는
 *     `{점수필드…, examinedAt}` 의 **flat 배열**을 돌려주는데 화면이 `trendMap['MELD']` 처럼
 *     시리즈 그룹맵을 기대해 언제나 `undefined → []` → `filter(len>0)` 가 전부 걸러냈다.
 *     탭 쪽은 `cfg.field` 로 클라이언트 그룹화하도록 고쳤고 대시보드만 옛 코드였다.
 *
 * 규약: **컬럼 key 는 Prisma `InternalMedicineExam` 의 실필드명**이고,
 *       세부과 key 는 shared `IM_SUBSPECIALTY_KEYS` 정본을 따른다(가드가 기계 대조).
 *       이 파일을 고치지 않고 화면에서 다시 정의하면 또 갈라진다 — 소비처는 여기만 import 한다.
 */

export type Subspecialty =
  | 'CARDIOLOGY'
  | 'PULMONOLOGY'
  | 'GASTRO'
  | 'ENDOCRINE'
  | 'NEPHROLOGY'
  | 'HEMATO_ONCOLOGY'
  | 'INFECTIOUS'
  | 'RHEUMATOLOGY';

export interface ImColumnDef {
  /** Prisma `InternalMedicineExam` 실필드명 */
  key: string;
  label: string;
  fmt?: (v: unknown) => string;
}

export interface ImScoreSeriesDef {
  /** 화면 표기 */
  name: string;
  /** 서버 flat 응답에서 읽을 실필드명 */
  field: string;
  color: string;
  maxScore: number;
}

export interface ImSubspecialtyViewDef {
  key: Subspecialty;
  label: string;
  columns: ImColumnDef[];
  scoreSeriesConfig: ImScoreSeriesDef[];
}

/** 항생제 — JsonB 배열 `[{name, start, end, route}]` → "Ceftriaxone, Vancomycin". null 안전. */
export function fmtAntibiotics(v: unknown): string {
  if (v == null) return '-';
  if (typeof v === 'string') return v || '-';
  if (Array.isArray(v)) {
    const names = v
      .filter((a): a is Record<string, unknown> => a != null && typeof a === 'object')
      .map((a) => (a.name != null ? String(a.name) : ''))
      .filter(Boolean);
    return names.length ? names.join(', ') : '-';
  }
  return '-';
}

/** 자가항체 — JsonB `{ANA, dsDNA, RF, CCP, ANCA}` → "ANA: +, RF: 1:320". null 안전. */
export function fmtAutoantibodies(v: unknown): string {
  if (v == null) return '-';
  if (typeof v === 'string') return v || '-';
  if (Array.isArray(v)) {
    return v.length ? v.map((x) => String(x)).join(', ') : '-';
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val != null && val !== '' && val !== false)
      .map(([k, val]) => (val === true ? k : `${k}: ${String(val)}`));
    return entries.length ? entries.join(', ') : '-';
  }
  return '-';
}

export const IM_SUBSPECIALTY_VIEWS: ImSubspecialtyViewDef[] = [
  {
    key: 'CARDIOLOGY', label: '순환기',
    columns: [
      { key: 'nyhaClass', label: 'NYHA' },
      { key: 'lvef', label: 'LVEF%' },
      { key: 'cha2ds2vasc', label: 'CHA2DS2-VASc' },
      { key: 'heartScore', label: 'HEART Score' },
    ],
    scoreSeriesConfig: [
      { name: 'LVEF', field: 'lvef', color: '#3B82F6', maxScore: 100 },
      { name: 'CHA2DS2-VASc', field: 'cha2ds2vasc', color: '#EF4444', maxScore: 9 },
      { name: 'HEART', field: 'heartScore', color: '#F59E0B', maxScore: 10 },
    ],
  },
  {
    key: 'PULMONOLOGY', label: '호흡기',
    columns: [
      { key: 'fev1Fvc', label: 'FEV1/FVC' },
      { key: 'goldStage', label: 'GOLD Stage' },
      { key: 'curb65', label: 'CURB-65' },
      { key: 'catScore', label: 'CAT' },
    ],
    scoreSeriesConfig: [
      { name: 'FEV1/FVC', field: 'fev1Fvc', color: '#3B82F6', maxScore: 100 },
      { name: 'CURB-65', field: 'curb65', color: '#EF4444', maxScore: 5 },
      { name: 'CAT', field: 'catScore', color: '#F59E0B', maxScore: 40 },
    ],
  },
  {
    key: 'GASTRO', label: '소화기',
    columns: [
      { key: 'endoscopyType', label: '내시경유형' },
      { key: 'childPughScore', label: 'Child-Pugh' },
      { key: 'meldScore', label: 'MELD' },
      { key: 'ascites', label: '복수' },
    ],
    scoreSeriesConfig: [
      { name: 'Child-Pugh', field: 'childPughScore', color: '#8B5CF6', maxScore: 15 },
      { name: 'MELD', field: 'meldScore', color: '#EF4444', maxScore: 40 },
    ],
  },
  {
    key: 'ENDOCRINE', label: '내분비',
    columns: [
      { key: 'hba1c', label: 'HbA1c' },
      { key: 'fastingGlucose', label: '공복혈당' },
      { key: 'bmdTScore', label: 'BMD T-score' },
      { key: 'fraxScore', label: 'FRAX' },
    ],
    scoreSeriesConfig: [
      { name: 'HbA1c', field: 'hba1c', color: '#EF4444', maxScore: 15 },
      { name: 'FRAX', field: 'fraxScore', color: '#F59E0B', maxScore: 100 },
    ],
  },
  {
    key: 'NEPHROLOGY', label: '신장',
    columns: [
      { key: 'ckdStage', label: 'CKD Stage' },
      { key: 'egfr', label: 'eGFR' },
      { key: 'dialysisType', label: '투석유형' },
      { key: 'ktv', label: 'Kt/V' },
    ],
    scoreSeriesConfig: [
      { name: 'eGFR', field: 'egfr', color: '#3B82F6', maxScore: 150 },
      { name: 'Kt/V', field: 'ktv', color: '#10B981', maxScore: 3 },
    ],
  },
  {
    key: 'HEMATO_ONCOLOGY', label: '혈액종양',
    columns: [
      { key: 'cancerType', label: '암종' },
      { key: 'tnmStage', label: 'TNM' },
      { key: 'ecogPs', label: 'ECOG PS' },
      { key: 'regimenName', label: '레지멘' },
      { key: 'recistResponse', label: 'RECIST' },
    ],
    scoreSeriesConfig: [
      { name: 'ECOG PS', field: 'ecogPs', color: '#EF4444', maxScore: 5 },
    ],
  },
  {
    key: 'INFECTIOUS', label: '감염',
    columns: [
      { key: 'infectionSite', label: '감염부위' },
      { key: 'organism', label: '균' },
      { key: 'antibiotics', label: '항생제', fmt: fmtAntibiotics },
      { key: 'qsofa', label: 'qSOFA' },
      { key: 'sofaScore', label: 'SOFA' },
    ],
    scoreSeriesConfig: [
      { name: 'qSOFA', field: 'qsofa', color: '#EF4444', maxScore: 3 },
      { name: 'SOFA', field: 'sofaScore', color: '#F59E0B', maxScore: 24 },
    ],
  },
  {
    key: 'RHEUMATOLOGY', label: '류마티스',
    columns: [
      { key: 'das28', label: 'DAS28' },
      { key: 'tenderJointCount', label: '압통관절수' },
      { key: 'swollenJointCount', label: '종창관절수' },
      { key: 'haqDi', label: 'HAQ-DI' },
      { key: 'autoantibodies', label: '자가항체', fmt: fmtAutoantibodies },
    ],
    scoreSeriesConfig: [
      { name: 'DAS28', field: 'das28', color: '#EF4444', maxScore: 10 },
      { name: 'HAQ-DI', field: 'haqDi', color: '#8B5CF6', maxScore: 3 },
    ],
  },
];

export function imViewOf(key: Subspecialty): ImSubspecialtyViewDef {
  return IM_SUBSPECIALTY_VIEWS.find((s) => s.key === key) ?? IM_SUBSPECIALTY_VIEWS[0];
}

/** 검사표 셀 — 정의된 `fmt` 가 있으면 그것으로, 없으면 원값. 값 없음은 `-`. */
export function imCellValue(row: Record<string, unknown>, col: ImColumnDef): string {
  const raw = row[col.key];
  if (col.fmt) return col.fmt(raw);
  if (raw == null) return '-';
  return String(raw);
}

/**
 * 서버 flat 배열 → `ScoreTrendChart` 시리즈.
 * 🔴 서버는 시리즈 그룹맵을 주지 않는다 — `cfg.field` 로 **클라이언트에서** 그룹화한다.
 *    값이 없는 시점은 점을 찍지 않는다(`?? 0` 은 안 잰 것을 0점으로 만든다).
 */
export function imTrendSeries(
  rows: Record<string, unknown>[],
  def: ImSubspecialtyViewDef,
): { name: string; color: string; maxScore: number; data: { date: string; value: number }[] }[] {
  return def.scoreSeriesConfig
    .map((cfg) => ({
      name: cfg.name,
      color: cfg.color,
      maxScore: cfg.maxScore,
      data: rows
        .map((row) => ({ date: String(row.examinedAt ?? ''), raw: row[cfg.field] }))
        .filter((d) => d.raw != null && d.date && !Number.isNaN(Number(d.raw)))
        .map((d) => ({ date: d.date, value: Number(d.raw) })),
    }))
    .filter((s) => s.data.length > 0);
}
