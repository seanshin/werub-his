/**
 * VoiceEMR — 오케스트레이터 (프로토타입·순수 로직·미배선)
 *
 * final 전사 1건 → 정규화·파서 → (오더) n-best → **확인 페이로드** 조립.
 * DB(약/검사 마스터)는 lookupCandidates 로 주입(순수 유지). 환자 신원(G3)은 모든
 * write/order outcome 에 항상 부착. 오더/입력은 needsConfirm=true(자동 실행 0·P-1/P-6).
 * 설계: docs/02-design/voice-emr-pipeline-design.md §2~§3
 */
import { parseIntent, type IntentResult, type CustomPhrases } from './intent-parser';
import { matchNbest, type Candidate, type NbestResult } from './nbest-matcher';
import { resolveRxHighAlert, type HighAlertVerdict } from './high-alert-screen';

export interface PatientRef { name: string; mrn: string; sexAge?: string }
export interface OrchestratorCtx {
  patient: PatientRef;
  confidence?: number;
  customPhrases?: CustomPhrases;
  /** 마스터 후보 조회(DB 주입). kind: 'drug'|'lab'|'imaging' */
  lookupCandidates?: (term: string, kind: 'drug' | 'lab') => Candidate[];
  /** 활력 정상범위 판정(주입) → true=이탈 */
  isVitalAbnormal?: (metric: string, values: number[]) => boolean;
}

export type Outcome =
  | { kind: 'read'; target: string; term?: string }            // 확인 불요
  | { kind: 'hold'; reason: string }
  | { kind: 'system'; action: string }
  | { kind: 'vital'; patient: PatientRef; metric: string; values: number[]; abnormal: boolean; needsConfirm: true }
  | {
      kind: 'order-rx'; patient: PatientRef;
      /** 구술 원문(약품명) — 확정 전 마스터 재조회·재판정의 열쇠. */
      term: string;
      nbest: NbestResult; dose?: number; unit?: string; freq?: string; route?: string; needsConfirm: true;
      /** 🔴 `false` 가 곧 "고위험 아님"이 아니다 — `highAlertSource` 를 함께 읽는다. */
      highAlert: boolean;
      highAlertSource: HighAlertVerdict['source'];
      highAlertCategory: HighAlertVerdict['category'];
      /** 독립 이중확인 대상 여부. 판정 불가는 `null`. */
      doubleCheckRequired: HighAlertVerdict['doubleCheckRequired'];
      highAlertReason: string;
    }
  | { kind: 'order-lab'; patient: PatientRef; labs: { term: string; nbest: NbestResult }[]; needsConfirm: true }
  | { kind: 'order-imaging'; patient: PatientRef; modality: string; bodyPart?: string; needsConfirm: true }
  | { kind: 'alias'; patient: PatientRef; action: unknown; needsConfirm: true }
  /**
   * 🔴 구술(T2)도 **쓰기**다 — 확인 카드·환자 신원(G3) 규약의 예외가 아니다.
   *    종전 `{ kind: 'dictate'; text }` 는 needsConfirm 도 patient 도 없어서 화면이 확인 없이 S 에 덮어썼다
   *    (파서는 어떤 규칙에도 안 걸린 발화·의문형을 전부 DICTATE 로 폴백한다 — 잡담이 기록이 됐다).
   *    기획서 voice-emr-ambient-conversation §13.2 P0-1 · §13.4 D1.
   */
  | { kind: 'dictate'; patient: PatientRef; text: string; needsConfirm: true };

/**
 * 🔴 종전 이 자리에는 한글 8개짜리 하드코딩 목록과 `r.drug.includes(...)` 가 있었다.
 *    마스터(`medication_codes.high_alert_flag` 634품목·7분류)를 **한 번도 보지 않았고**,
 *    `heparin`·`insulin` 처럼 영문으로 발화하면 고위험 표식이 붙지 않았다
 *    (v4.4.0 "DUR 43룰이 한글 룰·영문 마스터라 매칭 0" 과 같은 형태).
 *    판정은 `high-alert-screen.ts` 로 옮겼다 — 정본은 마스터 표식, 발화어는 후단일 뿐이다.
 */
export type RxOutcome = Extract<Outcome, { kind: 'order-rx' }>;

/**
 * 처방 outcome 조립 — 고위험 판정은 **후보(마스터)와 경로**를 함께 넘겨 정본이 내린다.
 * 마스터를 나중에(비동기로) 조회해 다시 부를 수 있게 따로 뺐다(`rebuildRxOutcome`).
 */
export function buildRxOutcome(input: {
  patient: PatientRef; term: string; nbest: NbestResult;
  dose?: number; unit?: string; freq?: string; route?: string;
}): RxOutcome {
  const verdict = resolveRxHighAlert({
    spokenTerm: input.term,
    candidates: input.nbest.candidates,
    route: input.route ?? null,
  });
  return {
    kind: 'order-rx', patient: input.patient, term: input.term, nbest: input.nbest,
    dose: input.dose, unit: input.unit, freq: input.freq, route: input.route,
    needsConfirm: true,
    highAlert: verdict.highAlert,
    highAlertSource: verdict.source,
    highAlertCategory: verdict.category,
    doubleCheckRequired: verdict.doubleCheckRequired,
    highAlertReason: verdict.reason,
  };
}

/** 마스터 후보를 늦게 얻었을 때 같은 처방 outcome 을 **정본으로 다시 판정**한다. */
export function rebuildRxOutcome(o: RxOutcome, nbest: NbestResult): RxOutcome {
  return buildRxOutcome({
    patient: o.patient, term: o.term, nbest,
    dose: o.dose, unit: o.unit, freq: o.freq, route: o.route,
  });
}

function toOutcome(r: IntentResult, ctx: OrchestratorCtx): Outcome {
  const { patient } = ctx;
  const lookup = ctx.lookupCandidates ?? (() => []);
  switch (r.intent) {
    case 'READ': return { kind: 'read', target: r.target, term: r.term };
    case 'HOLD': return { kind: 'hold', reason: r.reason };
    case 'SYSTEM': return { kind: 'system', action: r.action };
    case 'DICTATE': return { kind: 'dictate', patient, text: r.text, needsConfirm: true };
    case 'ALIAS': return { kind: 'alias', patient, action: r.action, needsConfirm: true };
    case 'VITAL':
      return { kind: 'vital', patient, metric: r.metric, values: r.values, abnormal: ctx.isVitalAbnormal?.(r.metric, r.values) ?? false, needsConfirm: true };
    case 'ORDER':
      if (r.sub === 'RX') {
        const nbest = matchNbest(r.drug, lookup(r.drug, 'drug'));
        return buildRxOutcome({
          patient, term: r.drug, nbest,
          dose: r.dose, unit: r.unit, freq: r.freq, route: r.route,
        });
      }
      if (r.sub === 'LAB') {
        return { kind: 'order-lab', patient, labs: r.labs.map((t) => ({ term: t, nbest: matchNbest(t, lookup(t, 'lab')) })), needsConfirm: true };
      }
      return { kind: 'order-imaging', patient, modality: r.modality, bodyPart: r.bodyPart, needsConfirm: true };
  }
}

/** final 텍스트 1건 → outcome[](복합=다건). 오더/입력(구술 포함)은 전부 needsConfirm+환자 신원. */
export function processUtterance(finalText: string, ctx: OrchestratorCtx): Outcome[] {
  const parsed = parseIntent(finalText, { confidence: ctx.confidence, customPhrases: ctx.customPhrases });
  return parsed.map((r) => toOutcome(r, ctx));
}
