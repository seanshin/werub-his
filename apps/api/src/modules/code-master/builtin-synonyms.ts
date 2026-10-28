/**
 * 코드 동의어·약어 초기 사전 — **전부 `PROPOSED`(검토 전)**.
 *
 * 🔴 **이 사전은 원내 표준이 아니다.** 승인하기 전까지 검색은 지금과 똑같이 동작한다.
 *    시드가 정책을 정해버리는 함정(이 저장소에서 반복해서 겪었다)을 피하려고 그렇게 두었다.
 *
 * 🔴 **전부 "질의 확장"형이다(`code = null`).** 어느 코드인지는 지목하지 않는다 —
 *    `DM` 을 어느 당뇨 코드로 볼지는 임상 판단이고, 시스템이 정할 일이 아니다.
 *    확장은 검색어를 넓힐 뿐이고 고르는 것은 사람이다.
 *
 * 🔴 **확장어가 실제로 무엇을 찾는지 운영 DB 에서 재고 담았다**(2026-08-26·`diagnosis_codes` 18,199행).
 *    아무것도 찾지 못하는 확장어는 담지 않았다(`GDM`·`이상지질` 등 — 그 어휘가 KCD 에 없다).
 */
export type SeedSynonym = {
  term: string;
  expandsTo: string;
  kind: 'ABBREVIATION' | 'COLLOQUIAL';
  /** 등재 시점 운영 DB 에서 이 확장어가 찾은 건수 — 검토자가 판단 근거로 본다 */
  measuredHits: number;
  /** 원 질의를 그대로 부분일치했을 때의 건수(대부분 무관한 우연한 일치) */
  noiseHits: number;
};

export const DIAGNOSIS_SYNONYM_SEED: SeedSynonym[] = [
  // ── 영문 약어: 지금은 이름 안에 묻힌 우연한 일치만 나온다
  { term: 'DM', expandsTo: '당뇨병', kind: 'ABBREVIATION', measuredHits: 213, noiseHits: 271 },
  { term: 'HTN', expandsTo: '고혈압', kind: 'ABBREVIATION', measuredHits: 37, noiseHits: 11 },
  { term: 'AMI', expandsTo: '심근경색', kind: 'ABBREVIATION', measuredHits: 24, noiseHits: 248 },
  { term: 'MI', expandsTo: '심근경색', kind: 'ABBREVIATION', measuredHits: 24, noiseHits: 1860 },
  { term: 'CHF', expandsTo: '심부전', kind: 'ABBREVIATION', measuredHits: 12, noiseHits: 0 },
  { term: 'HF', expandsTo: '심부전', kind: 'ABBREVIATION', measuredHits: 12, noiseHits: 0 },
  { term: 'AF', expandsTo: '심방세동', kind: 'ABBREVIATION', measuredHits: 5, noiseHits: 890 },
  { term: 'CAD', expandsTo: '관상동맥', kind: 'ABBREVIATION', measuredHits: 9, noiseHits: 1 },
  { term: 'CVA', expandsTo: '뇌혈관', kind: 'ABBREVIATION', measuredHits: 7, noiseHits: 0 },
  { term: 'CKD', expandsTo: '만성 신장', kind: 'ABBREVIATION', measuredHits: 6, noiseHits: 0 },
  { term: 'UTI', expandsTo: '요로감염', kind: 'ABBREVIATION', measuredHits: 3, noiseHits: 801 },
  { term: 'URI', expandsTo: '상기도', kind: 'ABBREVIATION', measuredHits: 8, noiseHits: 407 },
  { term: 'GERD', expandsTo: '위-식도역류', kind: 'ABBREVIATION', measuredHits: 2, noiseHits: 0 },
  { term: 'BPH', expandsTo: '전립선증식', kind: 'ABBREVIATION', measuredHits: 5, noiseHits: 0 },
  { term: 'RA', expandsTo: '류마티스관절염', kind: 'ABBREVIATION', measuredHits: 191, noiseHits: 5525 },
  { term: 'OA', expandsTo: '관절증', kind: 'ABBREVIATION', measuredHits: 99, noiseHits: 246 },
  { term: 'TB', expandsTo: '결핵', kind: 'ABBREVIATION', measuredHits: 126, noiseHits: 46 },
  { term: 'DVT', expandsTo: '정맥혈전', kind: 'ABBREVIATION', measuredHits: 6, noiseHits: 0 },
  { term: 'PE', expandsTo: '폐색전', kind: 'ABBREVIATION', measuredHits: 2, noiseHits: 7592 },
  { term: 'SLE', expandsTo: '루푸스', kind: 'ABBREVIATION', measuredHits: 7, noiseHits: 58 },
  { term: 'IBD', expandsTo: '염증성 장', kind: 'ABBREVIATION', measuredHits: 18, noiseHits: 0 },
  { term: 'COPD', expandsTo: '폐쇄성 폐질환', kind: 'ABBREVIATION', measuredHits: 17, noiseHits: 1 },

  // ── 한국어 구어·통칭: KCD 정본 표기와 달라 지금은 **0건**이 나온다
  { term: '맹장염', expandsTo: '충수염', kind: 'COLLOQUIAL', measuredHits: 6, noiseHits: 0 },
  { term: '디엠', expandsTo: '당뇨병', kind: 'COLLOQUIAL', measuredHits: 213, noiseHits: 0 },
  { term: '위암', expandsTo: '위의 악성', kind: 'COLLOQUIAL', measuredHits: 7, noiseHits: 0 },
  { term: '폐암', expandsTo: '폐의 악성', kind: 'COLLOQUIAL', measuredHits: 14, noiseHits: 0 },
  { term: '간암', expandsTo: '간의 악성', kind: 'COLLOQUIAL', measuredHits: 2, noiseHits: 0 },
  { term: '대장암', expandsTo: '결장의 악성', kind: 'COLLOQUIAL', measuredHits: 5, noiseHits: 0 },
  { term: '유방암', expandsTo: '유방의 악성', kind: 'COLLOQUIAL', measuredHits: 7, noiseHits: 0 },
  { term: '췌장암', expandsTo: '췌장의 악성', kind: 'COLLOQUIAL', measuredHits: 2, noiseHits: 0 },
  { term: '고지혈증', expandsTo: '고콜레스테롤', kind: 'COLLOQUIAL', measuredHits: 2, noiseHits: 0 },
];

/** 매칭 키 — 서비스의 `normalizeTerm` 과 같은 규칙(정본이 갈라지지 않게 여기서 다시 정의하지 않는다) */
export function seedNote(s: SeedSynonym): string {
  return `등재 시점 실측: 확장어 ${s.measuredHits}건 / 원 질의 부분일치 ${s.noiseHits}건`;
}
