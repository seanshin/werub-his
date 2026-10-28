/**
 * 스크라이브(대화·녹음) 초안 ↔ 확정 진료기록 **수정량 계측** 정본.
 *
 * 원래 `modules/encounter/encounter.service.ts` 안에 `scribeDraftSoap` 이 있었고, 서명 시점에
 * `Encounter.aiEditDistance`(원 거리 · 전체 하나)만 남겼다. 집계(AI 감독)가 **같은 초안 해석**을
 * 써야 하므로 순수 함수만 여기로 옮긴다 — 서명 경로의 동작은 한 글자도 바뀌지 않는다(같은 사실에
 * 정본이 둘이면 갈라진다 = P12). 거리 자체는 `edit-distance.ts` 정본(`levenshteinCapped`)을 쓴다.
 *
 * ── 측정 정의 ─────────────────────────────────────────────────────────────
 *  · 초안 = `ScribeSession.draftSnapshot` 의 ① `appliedFields`(앰비언트 — 실제로 SOAP 에 반영된 제안,
 *    필드별 누적) ② 없으면 `soap`(녹음 스크라이브 생성 초안). **초안이 낸 섹션만** 잰다.
 *  · 확정 = 서명된 진료기록의 같은 섹션(`subjective`·`objective`·`assessment`·`plan`).
 *  · 거리 = 문자 단위 Levenshtein. 정규화 = 거리 ÷ max(초안 길이, 확정 길이) → 0(무수정)~1(전부 다름).
 *  · 🔴 초안에 있던 섹션이 확정본에서 비어 있으면(null) **지운 것**으로 잰다(정규화 1) — 서명 경로와 같은 규칙.
 *    "가장 큰 수정"을 미측정으로 빼면 수정률이 낮게 나온다(근거 없이 안심시킴 = P17).
 *  · 🔴 초안이 없는 섹션은 **null**(재지 못함) — 0 은 "한 글자도 안 고쳤다"는 다른 사실이다.
 *  · 🔴 어느 쪽이든 `EDIT_DISTANCE_CAP` 을 넘으면 **재지 않고 `CAPPED`** 로 말한다. 앞부분만 잰 값은
 *    하한이라 정규화 분포에 섞으면 수정률이 낮아진다(거리 정본은 하한을 내지만 비율에는 쓰지 않는다).
 *  · 🔴 한계: 앰비언트는 FE 가 반영 텍스트를 **기존 필드 뒤에 덧붙인다**. 의사가 반영 전에 직접 쓴 글도
 *    "초안에 없던 글"이라 수정량으로 계상된다 → 이 수는 **수정량의 상한 쪽으로 치우친다**.
 */
import { EDIT_DISTANCE_CAP, levenshteinCapped } from './edit-distance';

export const SCRIBE_SOAP_FIELDS = ['subjective', 'objective', 'assessment', 'plan'] as const;
export type ScribeSoapField = (typeof SCRIBE_SOAP_FIELDS)[number];

/**
 * 스크라이브 초안 스냅샷에서 **비교할 초안 텍스트와 그 필드**를 꺼낸다.
 *
 * 🔴 스냅샷이 없거나 SOAP 텍스트를 못 찾으면 **null 을 낸다** — 0 으로 채우지 않는다.
 *    편집거리 0 은 "의사가 초안을 한 글자도 안 고쳤다"는 임상적으로 무거운 주장이고,
 *    "재지 못했다"와 전혀 다른 사실이다(과신 모니터가 이 수를 읽는다).
 *
 * 🔴 **초안에 있는 필드만 비교한다.** 초안이 S·P 만 냈는데 서명본 전체(A 포함)와 비교하면
 *    의사가 스스로 쓴 평가가 통째로 "수정량"으로 계상돼 수정률이 부풀려진다.
 */
export function scribeDraftSoap(
  snapshot: unknown,
): { fields: ScribeSoapField[]; text: string; sections: Partial<Record<ScribeSoapField, string>> } | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const snap = snapshot as Record<string, unknown>;
  const pick = (src: Record<string, unknown>) => {
    const fields = SCRIBE_SOAP_FIELDS.filter((f) => typeof src[f] === 'string' && (src[f] as string).trim().length > 0);
    if (!fields.length) return null;
    const sections: Partial<Record<ScribeSoapField, string>> = {};
    for (const f of fields) sections[f] = String(src[f]);
    return { fields, text: fields.map((f) => String(src[f])).join(' \n '), sections };
  };
  // ① 앰비언트: 실제로 SOAP 에 반영된 제안(필드별 누적) — applySuggestion 이 남긴다
  const applied = snap.appliedFields;
  if (applied && typeof applied === 'object' && !Array.isArray(applied)) {
    const r = pick(applied as Record<string, unknown>);
    if (r) return r;
  }
  // ② 녹음 스크라이브: draft() 가 남긴 생성 초안
  const soap = snap.soap;
  if (soap && typeof soap === 'object' && !Array.isArray(soap)) return pick(soap as Record<string, unknown>);
  return null;
}

/** 확정본 텍스트 — 서명 경로와 같은 규칙(초안이 낸 섹션만 · 비어 있으면 '' = 지움) */
export function scribeSignedText(fields: readonly ScribeSoapField[], record: Partial<Record<ScribeSoapField, unknown>>): string {
  return fields.map((f) => record[f]).map((v) => (typeof v === 'string' ? v : '')).join(' \n ');
}

export type TextEditMeasure =
  | {
      status: 'MEASURED';
      /** 문자 단위 Levenshtein 거리 */
      distance: number;
      /** 거리 ÷ max(초안, 확정) 길이 — 0~1 · 반올림하지 않은 원값(표시 쪽이 정본 자릿수로 줄인다) */
      normalized: number;
      draftLength: number;
      finalLength: number;
    }
  | {
      /** 🔴 상한 초과 — 재지 않았다(하한을 비율에 섞지 않는다) */
      status: 'CAPPED';
      draftLength: number;
      finalLength: number;
    };

/**
 * 초안 한 조각 ↔ 확정 한 조각.
 * 🔴 초안이 없거나(null·undefined·공백뿐) 확정본 인자가 주어지지 않으면(null·undefined) **null** — 0 이 아니다.
 *    확정본 `''` 은 "지웠다"는 사실이라 잰다.
 */
export function measureTextEdit(
  draft: string | null | undefined,
  final: string | null | undefined,
  cap = EDIT_DISTANCE_CAP,
): TextEditMeasure | null {
  if (typeof draft !== 'string' || draft.trim().length === 0) return null;
  if (typeof final !== 'string') return null;
  const draftLength = draft.length;
  const finalLength = final.length;
  if (draftLength > cap || finalLength > cap) return { status: 'CAPPED', draftLength, finalLength };
  const distance = levenshteinCapped(draft, final, cap);
  const denom = Math.max(draftLength, finalLength); // 초안이 공백이 아니므로 ≥ 1
  return { status: 'MEASURED', distance, normalized: distance / denom, draftLength, finalLength };
}

export interface ScribeEditMeasure {
  /** 섹션별 — 초안이 내지 않은 섹션은 null */
  sections: Record<ScribeSoapField, TextEditMeasure | null>;
  /** 전체(초안이 낸 섹션을 서명 경로와 같은 방식으로 이어 붙여 잰다) — 초안이 없으면 null */
  overall: TextEditMeasure | null;
}

/**
 * 스냅샷 + 확정 진료기록 → 섹션별·전체 수정량.
 * 🔴 스냅샷에서 초안을 못 찾으면 **null** — 측정 대상이 아니다(0 으로 접지 않는다).
 */
export function measureScribeEdit(
  snapshot: unknown,
  record: Partial<Record<ScribeSoapField, string | null | undefined>>,
  cap = EDIT_DISTANCE_CAP,
): ScribeEditMeasure | null {
  const draft = scribeDraftSoap(snapshot);
  if (!draft) return null;
  const sections = {} as Record<ScribeSoapField, TextEditMeasure | null>;
  for (const f of SCRIBE_SOAP_FIELDS) {
    const d = draft.sections[f];
    // 초안이 낸 섹션의 확정본이 비어 있으면 '' = 지움(서명 경로 규칙)
    sections[f] = d == null ? null : measureTextEdit(d, typeof record[f] === 'string' ? (record[f] as string) : '', cap);
  }
  const overall = measureTextEdit(draft.text, scribeSignedText(draft.fields, record), cap);
  return { sections, overall };
}
