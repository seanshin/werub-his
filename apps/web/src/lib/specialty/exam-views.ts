/**
 * 과별 진료 화면 — 정본 exam 응답 → 탭 표시행 매퍼 (2026-08-18)
 *
 * 🔴 배경: 정신과·비뇨·정형·산부인과 화면이 **존재하지 않는 EP**
 *    (`psychiatry/mse`·`urology/psa`·`orthopedics/rom`·`obgyn/prenatal` …)를 부르고
 *    `.catch(() => ({ data: [] }))` 로 404 를 삼켜 **영구히 "기록 없음"** 이었다.
 *    정본은 각 과의 `exams/:patientId` 하나이고, 탭은 그 한 벌에서 갈라진다.
 *
 * 판정 규칙(CLAUDE.md 규약):
 * - **표본 부재의 정답은 빈 목록/`null`** — `?? 0`·`?? 10` 같은 폴백은 모르는 것을 아는 것처럼 말한다.
 * - **진짜 0 은 0 으로** 말한다(잔뇨 0mL·ROM 0도=강직은 사실이다).
 * - 해석·중증도는 **임상도구 정본**(`lib/clinical-charts`)에서만 가져온다 — 여기서 절단점을 새로 짓지 않는다.
 * - 판정할 수 없는 결과(특수검사 '?')는 **정상(초록)이 아니라 미상**이다.
 */
import { getChart, bandFor, type ScoringDef } from '@/lib/clinical-charts';
import type { ScoreSeries } from '@/components/specialty/ScoreTrendChart';

/* ── 원시값 안전 변환 ─────────────────────────────────────── */

export type ExamRow = Record<string, unknown>;

/** 숫자 아니면 null — 0 은 유효한 값이므로 통과시킨다. Prisma Decimal(문자열 직렬화)도 받는다. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 빈 문자열은 '기록 없음'이지 값이 아니다. */
export function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return null;
}

/** true/false/미평가(null) 3상 — 미평가를 false 로 접지 않는다. */
export function bool3(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object') : [];
}

function iso(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (v instanceof Date) return v.toISOString();
  return null;
}

/* ── 정신건강의학과 ───────────────────────────────────────── */

/** JSONB 요약 라벨 — 키를 모르면 키 원문을 그대로 보여준다(임의 해석 금지). */
const PSYCH_JSON_LABEL: Record<string, string> = {
  suicidalIdeation: '자살사고',
  suicidalPlan: '자살계획',
  homicidalIdeation: '타해사고',
  delusions: '망상',
  obsessions: '강박사고',
  phobia: '공포',
  hallucinations: '환각',
  auditory: '환청',
  visual: '환시',
  tactile: '환촉',
  olfactory: '환후',
  illusion: '착각',
  orientation: '지남력',
  memory: '기억력',
  attention: '주의력',
  calculation: '계산력',
  abstraction: '추상적 사고',
};

type BoolVocab = 'presence' | 'intact';

/**
 * JSONB 를 한 줄 요약으로. boolean 어휘는 도메인마다 다르다 —
 * 사고내용·지각은 **있음/없음**, 인지는 **유지/저하**(true 를 '있음'으로 읽으면 뜻이 뒤집힌다).
 */
export function summarizeJson(v: unknown, vocab: BoolVocab = 'presence'): string | null {
  const o = obj(v);
  if (o) {
    const parts = Object.entries(o).flatMap(([k, val]) => {
      const label = PSYCH_JSON_LABEL[k] ?? k;
      if (typeof val === 'boolean') {
        return [`${label} ${vocab === 'intact' ? (val ? '유지' : '저하') : val ? '있음' : '없음'}`];
      }
      if (val !== null && typeof val === 'object') {
        const inner = summarizeJson(val, vocab);
        return inner ? [inner] : [];
      }
      const s = typeof val === 'number' ? String(val) : str(val);
      return s ? [`${label} ${s}`] : [];
    });
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  if (typeof v === 'boolean') return vocab === 'intact' ? (v ? '유지' : '저하') : v ? '있음' : '없음';
  return str(v);
}

export interface PsychMseRow {
  id: string;
  examinedAt: string | null;
  appearanceBehavior: string | null;
  speech: string | null;
  moodAffect: string | null;
  thoughtContent: string | null;
  thoughtProcess: string | null;
  perception: string | null;
  cognition: string | null;
  insight: string | null;
}

/** 외양·행동은 DB 에서 분리 저장이라 표시에서만 합친다(둘 다 없으면 null — 슬래시만 남기지 않는다). */
function joinPair(a: string | null, b: string | null): string | null {
  if (a && b) return `${a} / ${b}`;
  return a ?? b;
}

export function psychMseRows(exams: ExamRow[]): PsychMseRow[] {
  return exams.map((e) => ({
    id: String(e.id ?? ''),
    examinedAt: iso(e.examinedAt),
    appearanceBehavior: joinPair(str(e.appearance), str(e.behavior)),
    speech: str(e.speech),
    moodAffect: joinPair(str(e.mood), str(e.affect)),
    thoughtContent: summarizeJson(e.thoughtContent),
    thoughtProcess: str(e.thoughtProcess),
    perception: summarizeJson(e.perception),
    cognition: summarizeJson(e.cognition, 'intact'),
    insight: str(e.insight),
  }));
}

/** 화면에 나가는 심리검사 4종 — 점수 컬럼 ↔ 임상도구 정본 chartId 대응 */
const PSYCH_SCALES: { key: string; chartId: string; label: string; color: string }[] = [
  { key: 'phq9', chartId: 'PHQ9', label: 'PHQ-9', color: '#dc2626' },
  { key: 'gad7', chartId: 'GAD7', label: 'GAD-7', color: '#2563eb' },
  { key: 'mmse', chartId: 'MMSE', label: 'MMSE', color: '#059669' },
  { key: 'audit', chartId: 'AUDIT', label: 'AUDIT', color: '#d97706' },
];

export interface ScaleRow {
  id: string;
  testedAt: string | null;
  testName: string;
  score: number;
  /** 임상도구 정본 밴드 — 없으면 '산출 불가'(여기서 절단점을 지어내지 않는다) */
  interpretation: string | null;
  level: string | null;
  recommendation: string | null;
}

function scoringDef(chartId: string): ScoringDef | null {
  const def = getChart(chartId);
  return def && def.archetype === 'scoring' ? def : null;
}

function maxScoreOf(def: ScoringDef): number {
  return Math.max(...def.bands.map((b) => b.max));
}

export function psychScaleRows(exams: ExamRow[]): ScaleRow[] {
  return exams.flatMap((e) =>
    PSYCH_SCALES.flatMap((s) => {
      const score = num(e[s.key]);
      if (score === null) return []; // 미시행을 0 점으로 만들지 않는다
      const def = scoringDef(s.chartId);
      const band = def ? bandFor(def.bands, score) : undefined;
      return [{
        id: `${String(e.id ?? '')}:${s.key}`,
        testedAt: iso(e.examinedAt),
        testName: s.label,
        score,
        interpretation: band?.label ?? null,
        level: band?.level ?? null,
        recommendation: band?.recommendation ?? null,
      }];
    }),
  );
}

/** 추이 차트 — 시행된 척도만 시리즈로 만든다(빈 시리즈는 넣지 않는다). */
export function psychScaleSeries(exams: ExamRow[]): ScoreSeries[] {
  return PSYCH_SCALES.flatMap((s) => {
    const def = scoringDef(s.chartId);
    if (!def) return [];
    const data = exams
      .flatMap((e) => {
        const v = num(e[s.key]);
        const d = iso(e.examinedAt);
        return v !== null && d ? [{ date: d.slice(0, 10), value: v }] : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    return data.length > 0 ? [{ name: s.label, data, color: s.color, maxScore: maxScoreOf(def) }] : [];
  });
}

export interface SuicideRiskRow {
  id: string;
  assessedAt: string | null;
  riskLevel: string | null;
  cssrsScore: number | null;
  suicidalIdeation: boolean | null;
  suicidalPlan: boolean | null;
  safetyPlan: boolean | null;
  /** 자살사고 판정 근거 — 화면이 근거 없이 단정하지 않도록 함께 내보낸다 */
  ideationSource: 'THOUGHT_CONTENT' | 'PHQ9_ITEM9' | 'CSSRS' | null;
  notes: string | null;
}

export function psychSuicideRows(exams: ExamRow[]): SuicideRiskRow[] {
  return exams.flatMap((e) => {
    const tc = obj(e.thoughtContent);
    const cssrs = obj(e.cssrs);
    const item9 = num(e.phq9Item9);

    let ideation = bool3(tc?.suicidalIdeation);
    let source: SuicideRiskRow['ideationSource'] = ideation !== null ? 'THOUGHT_CONTENT' : null;
    if (ideation === null && cssrs && 'ideation' in cssrs) {
      ideation = bool3(cssrs.ideation);
      if (ideation !== null) source = 'CSSRS';
    }
    // PHQ-9 문항9 는 자살사고 문항이다 — 양성(≥1)이면 '있음'. 0 은 '없음'이 맞다.
    if (ideation === null && item9 !== null) {
      ideation = item9 >= 1;
      source = 'PHQ9_ITEM9';
    }

    const plan = bool3(tc?.suicidalPlan) ?? bool3(cssrs?.plan);
    const safetyRaw = e.safetyPlan;
    const safety = safetyRaw === null || safetyRaw === undefined ? null : bool3(safetyRaw) ?? true;
    const risk = str(e.suicideRisk);
    const cssrsScore = num(cssrs?.score) ?? num(e.cssrs);

    // 평가 흔적이 하나도 없으면 행 자체를 만들지 않는다(빈 목록이 정답).
    if (risk === null && cssrsScore === null && ideation === null && plan === null && safety === null) return [];

    return [{
      id: String(e.id ?? ''),
      assessedAt: iso(e.examinedAt),
      riskLevel: risk,
      cssrsScore,
      suicidalIdeation: ideation,
      suicidalPlan: plan,
      safetyPlan: safety,
      ideationSource: source,
      notes: str(e.plan),
    }];
  });
}

/* ── 비뇨의학과 ───────────────────────────────────────────── */

export interface UroExamRow {
  id: string;
  examinedAt: string | null;
  maxFlowRate: number | null;
  avgFlowRate: number | null;
  voidedVolume: number | null;
  residualVolume: number | null;
  prostateVolume: number | null;
  diagnosis: string | null;
}

export function uroExamRows(exams: ExamRow[]): UroExamRow[] {
  return exams.map((e) => {
    const u = obj(e.urodynamics);
    return {
      id: String(e.id ?? ''),
      examinedAt: iso(e.examinedAt),
      maxFlowRate: num(u?.maxFlowRate),
      avgFlowRate: num(u?.avgFlowRate),
      voidedVolume: num(u?.voidedVolume),
      residualVolume: num(u?.residualVolume),
      prostateVolume: num(e.prostateVolume),
      diagnosis: str(e.diagnosis),
    };
  });
}

/**
 * `psaDensity` — 서버가 같은 검사 행의 PSA ÷ 전립선 용적으로 계산한 값(2026-10-10 · 화면이 나누지 않는다).
 * `null` 이면 산출 불가 — `psaDensityUnavailable` 이 이유(NO_VOLUME·INVALID_VOLUME).
 */
export interface PsaRow { id: string; testedAt: string | null; psaValue: number; psaDensity: number | null; psaDensityUnavailable: string | null }

export function uroPsaRows(exams: ExamRow[]): PsaRow[] {
  return exams.flatMap((e) => {
    const psa = num(e.psaValue);
    return psa === null ? [] : [{
      id: String(e.id ?? ''), testedAt: iso(e.examinedAt), psaValue: psa,
      psaDensity: num(e.psaDensity), psaDensityUnavailable: str(e.psaDensityUnavailable),
    }];
  });
}

/** PSA 밀도 산출 불가 이유 → 화면 문구(원문 = i18n 키) */
export const PSA_DENSITY_UNAVAILABLE_TEXT: Record<string, string> = {
  NO_PSA: 'PSA 없음',
  NO_VOLUME: '같은 검사에 전립선 용적 없음',
  INVALID_VOLUME: '전립선 용적이 0 이하',
};

export interface IpssRow { id: string; assessedAt: string | null; totalScore: number; qolScore: number | null }

export function uroIpssRows(exams: ExamRow[]): IpssRow[] {
  return exams.flatMap((e) => {
    const total = num(e.ipssScore);
    return total === null ? [] : [{
      id: String(e.id ?? ''),
      assessedAt: iso(e.examinedAt),
      totalScore: total,
      qolScore: num(e.ipssQol),
    }];
  });
}

/** IPSS 중증도 — AUA/IPSS 표준 구간(0-7/8-19/20-35) */
export function ipssSeverity(total: number): 'MILD' | 'MODERATE' | 'SEVERE' {
  return total <= 7 ? 'MILD' : total <= 19 ? 'MODERATE' : 'SEVERE';
}

export function uroIpssSeries(rows: IpssRow[]): ScoreSeries[] {
  const data = rows
    .flatMap((r) => (r.assessedAt ? [{ date: r.assessedAt.slice(0, 10), value: r.totalScore }] : []))
    .sort((a, b) => a.date.localeCompare(b.date));
  return data.length > 0 ? [{ name: 'IPSS', data, color: '#2563eb', maxScore: 35 }] : [];
}

export function uroPsaSeries(rows: PsaRow[]): ScoreSeries[] {
  const data = rows
    .flatMap((r) => (r.testedAt ? [{ date: r.testedAt.slice(0, 10), value: r.psaValue }] : []))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (data.length === 0) return [];
  // PSA 는 상한이 없는 실측치라 축 상한을 관측값에서 잡는다(기준선 4.0 은 참고선으로만).
  const maxScore = Math.max(10, Math.ceil(Math.max(...data.map((d) => d.value))));
  return [{ name: 'PSA (ng/mL)', data, color: '#dc2626', maxScore, referenceValue: 4, referenceLabel: '기준 4.0' }];
}

/* ── 정형외과 ─────────────────────────────────────────────── */

export interface RomRow {
  id: string;
  measuredAt: string | null;
  bodyPart: string | null;
  side: string | null;
  movement: string | null;
  measured: number | null;
  normal: number | null;
  notes: string | null;
}

export function orthoRomRows(exams: ExamRow[]): RomRow[] {
  return exams.flatMap((e) =>
    arr(e.rom).map((r, i) => ({
      id: `${String(e.id ?? '')}:rom:${i}`,
      measuredAt: iso(e.examinedAt),
      bodyPart: str(e.bodyPart),
      side: str(e.side),
      movement: str(r.movement) ?? str(r.joint),
      measured: num(r.measured), // 0도 = 강직. 사실이므로 숨기지 않는다
      normal: num(r.normal),
      notes: str(r.notes),
    })),
  );
}

export type SpecialTestResult = 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';

/** 아는 결과만 판정한다 — 모르는 표기를 음성(초록)으로 접으면 거짓 안심이다. */
export function specialTestResultKind(raw: string | null): SpecialTestResult {
  if (raw === null) return 'UNKNOWN';
  const v = raw.trim().toUpperCase();
  if (['+', 'POSITIVE', 'POS', '양성'].includes(v)) return 'POSITIVE';
  if (['-', 'NEGATIVE', 'NEG', '음성'].includes(v)) return 'NEGATIVE';
  return 'UNKNOWN';
}

export interface SpecialTestRow {
  id: string;
  testedAt: string | null;
  testName: string | null;
  result: string | null;
  resultKind: SpecialTestResult;
  bodyPart: string | null;
  side: string | null;
  notes: string | null;
}

export function orthoSpecialTestRows(exams: ExamRow[]): SpecialTestRow[] {
  return exams.flatMap((e) =>
    arr(e.specialTests).map((t, i) => {
      const result = str(t.result);
      return {
        id: `${String(e.id ?? '')}:st:${i}`,
        testedAt: iso(e.examinedAt),
        testName: str(t.test) ?? str(t.testName),
        result,
        resultKind: specialTestResultKind(result),
        bodyPart: str(e.bodyPart),
        side: str(e.side),
        notes: str(t.notes),
      };
    }),
  );
}

/* ── 산부인과 ─────────────────────────────────────────────── */

/** "28W3D" → 28.43주. 형식이 아니면 null(추정하지 않는다). */
export function gestationalWeeks(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{1,2})\s*[Ww](?:\s*(\d)\s*[Dd])?$/.exec(s);
  if (!m) return null;
  const w = Number(m[1]);
  const d = m[2] ? Number(m[2]) : 0;
  return w + d / 7;
}

export interface PrenatalRow {
  id: string;
  examinedAt: string | null;
  gestationalAge: string | null;
  edd: string | null;
  gravida: number | null;
  para: number | null;
  currentWeight: number | null;
  bloodPressure: string | null;
  urineProtein: string | null;
  urineGlucose: string | null;
  fundalHeight: number | null;
  fetalHeartRate: number | null;
}

const isPrenatal = (e: ExamRow) => str(e.examType) === 'PRENATAL';

export function obgynPrenatalRows(exams: ExamRow[]): PrenatalRow[] {
  return exams.filter(isPrenatal).map((e) => ({
    id: String(e.id ?? ''),
    examinedAt: iso(e.examinedAt),
    gestationalAge: str(e.gestationalAge),
    edd: iso(e.edd),
    gravida: num(e.gravida),
    para: num(e.para),
    currentWeight: num(e.currentWeight),
    bloodPressure: str(e.bloodPressure),
    urineProtein: str(e.urineProtein),
    urineGlucose: str(e.urineGlucose),
    fundalHeight: num(e.fundalHeight),
    fetalHeartRate: num(e.fetalHeartRate), // 미측정은 null — 0bpm(사망)으로 말하지 않는다
  }));
}

export interface GynRow {
  id: string;
  examinedAt: string | null;
  diagnosis: string | null;
  papSmear: string | null;
  hpvTest: string | null;
  pelvicUltrasound: string | null;
  plan: string | null;
}

export function obgynGynRows(exams: ExamRow[]): GynRow[] {
  return exams.filter((e) => str(e.examType) === 'GYNECOLOGY').map((e) => ({
    id: String(e.id ?? ''),
    examinedAt: iso(e.examinedAt),
    diagnosis: str(e.diagnosis),
    papSmear: str(e.papSmear),
    hpvTest: str(e.hpvTest),
    pelvicUltrasound: summarizeJson(e.pelvicUltrasound),
    plan: str(e.plan),
  }));
}

export interface UltrasoundRow {
  id: string;
  examinedAt: string | null;
  gestationalAge: string | null;
  gestationalWeek: number | null;
  bpd: number | null;
  fl: number | null;
  ac: number | null;
  efw: number | null;
  afi: number | null;
  presentation: string | null;
  placentaLocation: string | null;
}

export function obgynUltrasoundRows(exams: ExamRow[]): UltrasoundRow[] {
  return exams.flatMap((e) => {
    const u = obj(e.ultrasound);
    if (!u) return []; // 초음파를 안 한 진료는 '기록 없음'이지 빈 값 행이 아니다
    return [{
      id: String(e.id ?? ''),
      examinedAt: iso(e.examinedAt),
      gestationalAge: str(e.gestationalAge),
      gestationalWeek: gestationalWeeks(e.gestationalAge),
      bpd: num(u.bpd),
      fl: num(u.fl),
      ac: num(u.ac),
      efw: num(u.efw),
      afi: num(u.afi), // 미측정은 null — 종전엔 `?? 10` 이라 **안 잰 것이 정상(초록)** 으로 보였다
      presentation: str(u.presentation),
      placentaLocation: str(u.placentaLocation),
    }];
  });
}

export interface FetalGrowthPoint { gestationalWeek: number; bpd?: number; fl?: number; ac?: number; efw?: number }

/** 태아 성장곡선 — 주수를 모르는 초음파는 곡선에 찍을 수 없다(x 축이 없다). */
export function obgynGrowthPoints(rows: UltrasoundRow[]): FetalGrowthPoint[] {
  return rows
    .flatMap((r) => {
      if (r.gestationalWeek === null) return [];
      const p: FetalGrowthPoint = { gestationalWeek: r.gestationalWeek };
      if (r.bpd !== null) p.bpd = r.bpd;
      if (r.fl !== null) p.fl = r.fl;
      if (r.ac !== null) p.ac = r.ac;
      if (r.efw !== null) p.efw = r.efw;
      return [p];
    })
    .sort((a, b) => a.gestationalWeek - b.gestationalWeek);
}
