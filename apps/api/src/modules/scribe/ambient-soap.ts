/**
 * 앰비언트 대화 → SOAP 정돈 초안 (순수 로직·결정적·테스트 가능)
 *
 * 발화 목록을 필드별 제안 카드로 **정돈**한다. 기획 §6 매핑 규칙 + §13.4 D2 정돈 규칙:
 *  - 증상(부정 포함) → S (화자 무관 — 의사가 되물어도 환자 증상)
 *  - 활력/수치      → O (**의사·미상 발화만** — 환자 발화 수치를 객관 소견으로 올리면 임상 왜곡: §3.4)
 *  - 계획/약물      → P (동일 이유로 환자 발화 제외 — 복약 '이력'이 계획이 되면 안 됨)
 *  - A(평가)        → 규칙 경로는 절대 제안하지 않음(임상 판단·AI 경로만 "(제안)" 접두로)
 * 제외분은 skipped 로 반환해 **조용한 누락을 만들지 않는다**(패널 칩으로 단건 반영은 여전히 가능).
 *
 * 🔴 무엇이 틀려 있었나(§13.2 P2 · 2026-09-22 실측): 종전 `buildRuleSuggestions` 는 발화별 NER 를 필드에
 *    **병합만** 했다 — 같은 term 만 걸러 세 번 말한 증상이 세 줄이 되진 않았지만, 주호소·시간 순서·활력의
 *    최신/이전 구분·계획의 종류 묶음이 없었고, 응답에 **분모**가 없어 "제안 3건"이 대화의 얼마를 덮었는지 몰랐다.
 *
 * 정돈 규칙(D2):
 *  ① 주호소(CC) = **가장 이른 seq 의 긍정 증상**(같은 발화에 둘이면 문장에서 먼저 나온 것). 증상이 없으면 CC 없음 — 지어내지 않는다.
 *  ② 같은 증상·활력·계획이 여러 발화에 나오면 **한 항목**·`firstSeq` 는 최초 발화(출처 역추적).
 *  ③ 긍정 증상 문장 → 부인 증상 문장 순서 고정(한 문장에 섞지 않는다). 긍정·부인이 발화마다 엇갈리면
 *     NER 의 발화 내 규약("하나라도 긍정이면 있음")을 발화 간에도 그대로 쓰되 `conflicted` 로 표시한다.
 *  ④ 활력은 종류별 한 항목 — **최신값**(마지막 seq)이 대표값, 이전 값이 있으면 괄호 안에 seq 순서로.
 *  ⑤ 계획은 종류별 묶음(LAB·IMAGING·MEDICATION·FOLLOWUP·OBSERVE·ORDER 순) · 약물은 MEDICATION 묶음.
 *  ⑥ A 는 여전히 비어 있다.
 *  ⑦ `coverage` 분모 동봉 — 다섯 수의 합이 `utterances` 와 같다(가드).
 *
 * 🔴 서버는 화면 문장을 조립하지 않는다 — `structure` 가 값 정본이고 화면 머리글은 `coverage` 로 조립한다.
 *    `suggestions[].text` 는 **차트에 붙는 초안 본문**(의사가 검토·서명하는 한국어 진료기록)이며 문장 조립은
 *    기존 `entitiesToSoap`(호소/부인) 하나를 재사용한다 — 새 한국어 템플릿을 서버에 더하지 않았다.
 */
import {
  extractClinicalEntities,
  entitiesToSoap,
  medText,
  vitalText,
  vitalValueText,
  type ExtractedMed,
  type ExtractedSymptom,
  type ExtractedVital,
  type PlanKind,
  type VitalType,
} from './clinical-ner';

export type SoapField = 'subjective' | 'objective' | 'assessment' | 'plan';
export type AmbientSpeaker = 'DOCTOR' | 'PATIENT' | 'UNKNOWN';

export interface UtteranceInput {
  seq: number;
  text: string;
  speaker?: AmbientSpeaker | string | null;
}

export interface SoapSuggestion {
  field: SoapField;
  text: string;
  sourceSeqs: number[];
  engine: 'RULE' | 'AI';
  note?: string;
}

export interface SkippedItem {
  seq: number;
  field: SoapField;
  detail: string;
  reason: 'PATIENT_SPEAKER';
}

/**
 * 분모 — 전부 **발화 수**이고 `withEntities + noEntities + lowConfidence + skipped === utterances`.
 * 화면 머리글 "N발화 중 M발화에서 제안"의 재료. `utterances` 가 0 이면 화면은 "산출 불가"로 말한다(0 은 다른 사실).
 */
export interface AnalysisCoverage {
  /** 분석 대상 발화 전체(삭제 제외·저신뢰 포함) */
  utterances: number;
  /** 제안에 조각을 하나라도 보탠 발화 */
  withEntities: number;
  /** 규칙이 아무 조각도 못 뽑은 발화(빈 발화 포함) */
  noEntities: number;
  /** 신뢰도 하한 미만이라 분석에 넣지 않은 발화 */
  lowConfidence: number;
  /** 조각은 있었으나 화자 규칙(환자 발화 수치·계획)으로 **전부** 제외된 발화 */
  skipped: number;
}

export interface ConsolidatedSymptom {
  term: string;
  negated: boolean;
  /** 대표 극성이 처음 나온 발화 */
  firstSeq: number;
  /** 이 증상이 언급된 모든 발화(극성 무관) */
  seqs: number[];
  /** 긍정·부인이 발화마다 엇갈렸다 — 화면이 표시할 사실(문장에 섞지 않는다) */
  conflicted: boolean;
}
export interface ConsolidatedVital {
  type: VitalType;
  unit: string;
  latest: number[];
  latestSeq: number;
  /** seq 순서(측정 시각 순서) · 같은 값의 연속 반복은 하나로 */
  history: { value: number[]; seq: number }[];
}
export interface ConsolidatedPlanItem { text: string; firstSeq: number; seqs: number[] }
export interface ConsolidatedPlanGroup { kind: PlanKind; items: ConsolidatedPlanItem[] }
export interface ConsolidatedMed extends Omit<ExtractedMed, 'raw'> { firstSeq: number; seqs: number[] }
export interface ConsolidatedStructure {
  chiefComplaint: { term: string; seq: number } | null;
  /** 긍정(firstSeq 순) → 부인(firstSeq 순) */
  symptoms: ConsolidatedSymptom[];
  vitals: ConsolidatedVital[];
  /** `PLAN_KIND_ORDER` 순 · 항목 없는 종류는 빠진다 */
  plan: ConsolidatedPlanGroup[];
  medications: ConsolidatedMed[];
}

export interface ConsolidateOptions {
  /** 서비스가 신뢰도 하한으로 미리 뺀 발화 수(분모에 더한다 · 여기 입력에는 없다) */
  lowConfidence?: number;
}

export interface ConsolidatedAnalysis {
  suggestions: SoapSuggestion[];
  skipped: SkippedItem[];
  coverage: AnalysisCoverage;
  structure: ConsolidatedStructure;
}

/** 계획 묶음 순서 — 화면·초안 본문이 같은 순서를 쓴다 */
export const PLAN_KIND_ORDER: readonly PlanKind[] = ['LAB', 'IMAGING', 'MEDICATION', 'FOLLOWUP', 'OBSERVE', 'ORDER'];
/** 초안 본문의 계획 머리말 — 차트 관용 약어(한국어 진료기록에서도 영문 약어를 쓴다) */
const PLAN_HEAD: Record<PlanKind, string> = {
  LAB: 'Lab', IMAGING: 'Imaging', MEDICATION: 'Med', FOLLOWUP: 'F/U', OBSERVE: 'Obs', ORDER: 'Order',
};

const key = {
  med: (m: { name: string; dose?: number; doseUnit?: string }) => `${m.name}|${m.dose ?? ''}${m.doseUnit ?? ''}`,
  plan: (p: { kind: string; text: string }) => `${p.kind}|${p.text.trim()}`,
};

interface SymptomAcc {
  term: string;
  posSeqs: number[];
  negSeqs: number[];
  /** CC 후보 정렬용 — 처음 나온 발화 안에서의 문자 위치(동의어로 잡혀 원문에 없으면 Infinity) */
  firstPos: number;
  order: number;
}

function sameValue(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * 정돈 초안 — 발화 seq 순으로 읽어 필드별 제안 + 값 구조 + 분모를 만든다.
 * 입력은 서비스가 신뢰도 하한을 지난 발화만 넘긴다(저신뢰 수는 `opts.lowConfidence` 로 분모에 더한다).
 */
export function consolidate(utts: UtteranceInput[], opts: ConsolidateOptions = {}): ConsolidatedAnalysis {
  const ordered = [...utts].sort((a, b) => a.seq - b.seq);
  const skipped: SkippedItem[] = [];

  const symptoms = new Map<string, SymptomAcc>();
  const vitals = new Map<VitalType, ConsolidatedVital>();
  const meds = new Map<string, ConsolidatedMed>();
  const plans = new Map<string, ConsolidatedPlanItem & { kind: PlanKind }>();

  let withEntities = 0;
  let noEntities = 0;
  let skippedUtts = 0;

  for (const u of ordered) {
    const text = (u.text ?? '').trim();
    if (!text) { noEntities += 1; continue; }
    const isPatient = u.speaker === 'PATIENT';
    const e = extractClinicalEntities(text);
    const had = e.symptoms.length + e.vitals.length + e.medications.length + e.plan.length > 0;
    if (!had) { noEntities += 1; continue; }
    let contributed = false;

    const flat = text.replace(/\s+/g, '');
    e.symptoms.forEach((s: ExtractedSymptom, i) => {
      contributed = true;
      let acc = symptoms.get(s.term);
      if (!acc) {
        const pos = flat.indexOf(s.term);
        acc = { term: s.term, posSeqs: [], negSeqs: [], firstPos: pos < 0 ? Number.POSITIVE_INFINITY : pos, order: symptoms.size * 100 + i };
        symptoms.set(s.term, acc);
      }
      (s.negated ? acc.negSeqs : acc.posSeqs).push(u.seq);
    });

    for (const v of e.vitals as ExtractedVital[]) {
      if (isPatient) { skipped.push({ seq: u.seq, field: 'objective', detail: `${v.type} ${v.value.join('/')}`, reason: 'PATIENT_SPEAKER' }); continue; }
      contributed = true;
      const cur = vitals.get(v.type);
      if (!cur) {
        vitals.set(v.type, { type: v.type, unit: v.unit, latest: v.value, latestSeq: u.seq, history: [{ value: v.value, seq: u.seq }] });
      } else {
        // 같은 값의 반복은 새 측정으로 세지 않는다(같은 말을 두 번 한 것) — 값이 바뀌면 이력에 쌓고 최신값을 갈아 끼운다
        if (!sameValue(cur.latest, v.value)) {
          cur.history.push({ value: v.value, seq: u.seq });
          cur.latest = v.value;
          cur.latestSeq = u.seq;
        }
      }
    }

    for (const m of e.medications) {
      if (isPatient) { skipped.push({ seq: u.seq, field: 'plan', detail: m.name, reason: 'PATIENT_SPEAKER' }); continue; }
      contributed = true;
      const k = key.med(m);
      const cur = meds.get(k);
      if (cur) { cur.seqs.push(u.seq); continue; }
      const { raw: _raw, ...rest } = m;
      meds.set(k, { ...rest, firstSeq: u.seq, seqs: [u.seq] });
    }

    for (const p of e.plan) {
      if (isPatient) { skipped.push({ seq: u.seq, field: 'plan', detail: p.text, reason: 'PATIENT_SPEAKER' }); continue; }
      contributed = true;
      const k = key.plan(p);
      const cur = plans.get(k);
      if (cur) { cur.seqs.push(u.seq); continue; }
      plans.set(k, { kind: p.kind, text: p.text.trim(), firstSeq: u.seq, seqs: [u.seq] });
    }

    if (contributed) withEntities += 1; else skippedUtts += 1;
  }

  // ── 증상 정돈: 대표 극성(긍정 우선) · firstSeq · 긍정→부인 순 ──
  const symptomList: ConsolidatedSymptom[] = [...symptoms.values()].map((a) => {
    const negated = a.posSeqs.length === 0;
    const winning = negated ? a.negSeqs : a.posSeqs;
    return {
      term: a.term,
      negated,
      firstSeq: Math.min(...winning),
      seqs: [...new Set([...a.posSeqs, ...a.negSeqs])].sort((x, y) => x - y),
      conflicted: a.posSeqs.length > 0 && a.negSeqs.length > 0,
    };
  });
  const bySeqThenPos = (x: ConsolidatedSymptom, y: ConsolidatedSymptom) => {
    if (x.firstSeq !== y.firstSeq) return x.firstSeq - y.firstSeq;
    const ax = symptoms.get(x.term)!; const ay = symptoms.get(y.term)!;
    if (ax.firstPos !== ay.firstPos) return ax.firstPos - ay.firstPos;
    return ax.order - ay.order;
  };
  const positive = symptomList.filter((s) => !s.negated).sort(bySeqThenPos);
  const negative = symptomList.filter((s) => s.negated).sort(bySeqThenPos);
  const chiefComplaint = positive.length ? { term: positive[0].term, seq: positive[0].firstSeq } : null;

  const vitalList = [...vitals.values()];
  const medList = [...meds.values()].sort((a, b) => a.firstSeq - b.firstSeq);
  const planGroups: ConsolidatedPlanGroup[] = PLAN_KIND_ORDER
    .map((kind) => ({
      kind,
      items: [...plans.values()].filter((p) => p.kind === kind).sort((a, b) => a.firstSeq - b.firstSeq)
        .map(({ text, firstSeq, seqs }) => ({ text, firstSeq, seqs })),
    }))
    .filter((g) => g.items.length > 0);

  const structure: ConsolidatedStructure = {
    chiefComplaint,
    symptoms: [...positive, ...negative],
    vitals: vitalList,
    plan: planGroups,
    medications: medList,
  };

  // ── 초안 본문(차트에 붙는 텍스트) ──
  const suggestions: SoapSuggestion[] = [];
  const seqsOf = (arr: { seqs: number[] }[]) => [...new Set(arr.flatMap((x) => x.seqs))].sort((a, b) => a - b);

  if (structure.symptoms.length) {
    // 호소/부인 문장은 기존 정본 하나(entitiesToSoap)로 — 순서는 여기서 고정한 긍정→부인
    const body = entitiesToSoap({
      vitals: [], medications: [], plan: [],
      symptoms: structure.symptoms.map((s) => ({ term: s.term, negated: s.negated })),
    }).subjective;
    const lines = [chiefComplaint ? `CC: ${chiefComplaint.term}` : null, body].filter((x): x is string => !!x);
    suggestions.push({ field: 'subjective', text: lines.join('\n'), sourceSeqs: seqsOf(structure.symptoms), engine: 'RULE' });
  }

  if (vitalList.length) {
    const text = vitalList.map((v) => {
      const latest = vitalText({ type: v.type, value: v.latest, unit: v.unit, raw: '' });
      if (v.history.length < 2) return latest;
      return `${latest} (${v.history.map((h) => vitalValueText(v.type, h.value)).join(' → ')})`;
    }).join(', ');
    const sourceSeqs = [...new Set(vitalList.flatMap((v) => v.history.map((h) => h.seq)))].sort((a, b) => a - b);
    suggestions.push({ field: 'objective', text, sourceSeqs, engine: 'RULE' });
  }

  if (planGroups.length || medList.length) {
    const lines: string[] = [];
    for (const kind of PLAN_KIND_ORDER) {
      const items = planGroups.find((g) => g.kind === kind)?.items.map((i) => i.text) ?? [];
      if (kind === 'MEDICATION') items.push(...medList.map((m) => medText({ ...m, raw: '' })));
      if (items.length) lines.push(`${PLAN_HEAD[kind]}: ${items.join(' · ')}`);
    }
    const sourceSeqs = [...new Set([...planGroups.flatMap((g) => g.items.flatMap((i) => i.seqs)), ...medList.flatMap((m) => m.seqs)])].sort((a, b) => a - b);
    suggestions.push({ field: 'plan', text: lines.join('\n'), sourceSeqs, engine: 'RULE' });
  }
  // assessment 는 규칙 경로 미제안(임상 판단)

  const lowConfidence = Math.max(0, opts.lowConfidence ?? 0);
  const coverage: AnalysisCoverage = {
    utterances: ordered.length + lowConfidence,
    withEntities,
    noEntities,
    lowConfidence,
    skipped: skippedUtts,
  };

  return { suggestions, skipped, coverage, structure };
}

/** AI 응답(autoRecord)에서 SOAP 필드 추출 — 스키마 변동에 방어적 */
export function aiSuggestionsFrom(ai: unknown, sourceSeqs: number[]): SoapSuggestion[] {
  const root = (ai ?? {}) as Record<string, unknown>;
  const inner = (root.data ?? root) as Record<string, unknown>;
  const soap = ((inner.soap ?? inner.SOAP ?? {}) as Record<string, unknown>) ?? {};
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = soap[k] ?? inner[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };
  const out: SoapSuggestion[] = [];
  const add = (field: SoapField, text?: string, note?: string) => {
    if (text) out.push({ field, text, sourceSeqs, engine: 'AI', ...(note ? { note } : {}) });
  };
  add('subjective', pick('subjective', 'S', 'chief_complaint'));
  add('objective', pick('objective', 'O'));
  // A 는 진단 가설 — 확진 표현 금지 규약상 "(제안)" 접두 강제(§6)
  const a = pick('assessment', 'A');
  add('assessment', a ? (a.startsWith('(제안)') ? a : `(제안) ${a}`) : undefined, '임상 판단 필요 — 확진 아님');
  add('plan', pick('plan', 'P'));
  return out;
}
