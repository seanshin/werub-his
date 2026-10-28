/**
 * VoiceEMR — n-best 코드 매처 (프로토타입·순수 로직·미배선)
 *
 * 구술된 약/검사 용어를 후보 리스트(마스터에서 주입)와 대조해 top-K 후보 점수화.
 * 실제 마스터(24,022 약품)는 DB 계층이 주입 — 여기선 매칭 알고리즘만.
 * 3중 신호: ①부분포함(브랜드⊂전체명) ②동의어 힌트(리피토→아토르바스타틴) ③자모 음소 유사도(오인식).
 * 단일 자동선택 금지 — preSelect 는 확인 게이트의 기본 선택일 뿐(§4.3·§2.7).
 */

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 한글 문자열 → 자모 시퀀스(음소 유사도용) */
export function toJamo(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const i = code - 0xac00;
      out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
    } else if (ch !== ' ') {
      out += ch.toLowerCase();
    }
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

/** 자모 음소 유사도 0~1 */
export function jamoSimilarity(a: string, b: string): number {
  const ja = toJamo(a), jb = toJamo(b);
  if (!ja || !jb) return 0;
  return 1 - levenshtein(ja, jb) / Math.max(ja.length, jb.length);
}

/**
 * 마스터 후보. 🔴 `highAlertFlag`/`highAlertCategory` 는 **약품 마스터 원값을 그대로** 실어나른다
 * (`medication_codes.high_alert_flag` / `high_alert_category`). 고위험 판정을 발화어로 흉내내지
 * 않기 위해 필요한 유일한 통로다 — `high-alert-screen.ts` 참조.
 * 값이 없으면 `undefined`(= 마스터를 안 봤다)이지 `false`(= 고위험 아님)가 아니다.
 */
export interface Candidate {
  code: string;
  name: string;
  synonyms?: string[];
  form?: string;
  highAlertFlag?: boolean | null;
  highAlertCategory?: string | null;
}
export interface Scored extends Candidate { score: number; via: 'substring' | 'synonym' | 'phonetic' }
export interface NbestResult { candidates: Scored[]; preSelect: string | null }

const FORM_WORDS = ['서방정', '속붕정', '츄어블', '캡슐', '시럽', '주사', '정'];

/** 구술 용어 → 후보 점수화 top-K */
export function matchNbest(spoken: string, candidates: Candidate[], opts: { topK?: number; tau?: number; delta?: number } = {}): NbestResult {
  const { topK = 5, tau = 0.6, delta = 0.15 } = opts;
  const s = spoken.replace(/\s+/g, '');
  const spokenForm = FORM_WORDS.find((f) => s.includes(f));
  const sBase = FORM_WORDS.reduce((acc, f) => acc.replace(f, ''), s);

  const scored: Scored[] = candidates.map((c) => {
    const nameNo = c.name.replace(/\s+/g, '');
    let score = 0; let via: Scored['via'] = 'phonetic';
    // ① 부분포함(브랜드⊂전체명 또는 역): 강한 신호
    if (nameNo.includes(sBase) || sBase.includes(nameNo.replace(/\d.*$/, ''))) { score = Math.max(score, 0.9); via = 'substring'; }
    // ② 동의어 힌트
    if (c.synonyms?.some((syn) => syn.replace(/\s+/g, '').includes(sBase) || sBase.includes(syn.replace(/\s+/g, '')))) { if (0.88 > score) { score = 0.88; via = 'synonym'; } }
    // ③ 자모 음소 유사도(오인식)
    const phon = jamoSimilarity(sBase, nameNo.replace(/\d.*$/, ''));
    if (phon > score) { score = phon; via = 'phonetic'; }
    // 제형 일치 보너스/불일치 페널티
    if (spokenForm) {
      if (c.form === spokenForm || nameNo.includes(spokenForm)) score = Math.min(1, score + 0.08);
      else if (c.form && c.form !== spokenForm) score -= 0.05;
    }
    return { ...c, score: Math.round(score * 1000) / 1000, via };
  }).filter((c) => c.score > 0.3).sort((a, b) => b.score - a.score).slice(0, topK);

  // 단일 자동선택 금지 — 확실할 때만 preSelect(기본 선택·확인은 여전히 필수)
  const preSelect = scored.length && scored[0].score >= tau && (scored.length === 1 || scored[0].score - scored[1].score >= delta)
    ? scored[0].code : null;

  return { candidates: scored, preSelect };
}
