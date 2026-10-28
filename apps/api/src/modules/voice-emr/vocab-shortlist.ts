/**
 * VoiceEMR — vocab 바이어싱 shortlist 빌더 (프로토타입·순수 로직·미배선)
 *
 * WeRU.B `/vocab` 상한 200개(Q3). 진료별로 관련 어휘를 우선순위로 병합·중복 제거·상한 절단.
 * 우선순위: 개인 VOCAB > 환자 활성 처방 > 당일 오더 예정 > 진료과 상위 빈용.
 * 초과분은 truncated 통지(조용히 버리지 않음 — WeRU.B 계약과 동일 원칙).
 * 설계: docs/02-design/voice-emr-personalization-design.md §B.5 · plan §9 Q3.
 */

export interface ShortlistInput {
  personalVocab?: string[]; // 개인 VOCAB(최우선)
  patientMeds?: string[];   // 환자 활성 처방
  dayOrders?: string[];     // 당일 오더 예정
  deptTop?: string[];       // 진료과 상위 빈용
}
export interface Shortlist { terms: string[]; truncated: boolean; dropped: number; sources: Record<string, number> }

const MAX = 200;

/** 우선순위 병합 → 중복 제거 → 상한 절단 */
export function buildVocabShortlist(input: ShortlistInput, max = MAX): Shortlist {
  const order: [string, string[]][] = [
    ['personalVocab', input.personalVocab ?? []],
    ['patientMeds', input.patientMeds ?? []],
    ['dayOrders', input.dayOrders ?? []],
    ['deptTop', input.deptTop ?? []],
  ];
  const seen = new Set<string>();
  const terms: string[] = [];
  const sources: Record<string, number> = {};
  let dropped = 0;

  for (const [src, list] of order) {
    for (const raw of list) {
      const t = raw.trim();
      if (!t) continue;
      const key = t.replace(/\s+/g, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (terms.length < max) {
        terms.push(t);
        sources[src] = (sources[src] ?? 0) + 1;
      } else {
        dropped++;
      }
    }
  }
  return { terms, truncated: dropped > 0, dropped, sources };
}
