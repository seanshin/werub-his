/**
 * 한국어 임상 텍스트 유틸 (공용·순수 함수)
 *
 * VoiceEMR 프로토타입(nbest 매처·수사 정규화)에서 검증된 로직을 공용화 —
 * 처방/검사/진단 코드 검색 UX(오타 내성·초성 검색)·음성·DUR 등에서 재사용.
 * 순수 함수(브라우저/DB 불필요). 골든: apps/api/test/shared/clinical-text.spec.ts
 */

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CHO_SET = new Set(CHO);

function isSyllable(code: number): boolean { return code >= 0xac00 && code <= 0xd7a3; }

/** 한글 → 자모 시퀀스(음소 유사도용) */
export function toJamo(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (isSyllable(code)) {
      const i = code - 0xac00;
      out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
    } else if (ch !== ' ') out += ch.toLowerCase();
  }
  return out;
}

/** 한글 → 초성 시퀀스(초성 검색용). 고혈압 → 'ㄱㅎㅇ' */
export function toChosung(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (isSyllable(code)) out += CHO[Math.floor((code - 0xac00) / 588)];
    else if (CHO_SET.has(ch)) out += ch;
    else if (ch !== ' ') out += ch.toLowerCase();
  }
  return out;
}

/** 질의가 전부 초성(자음)인가 — 초성 검색 판별 */
export function isChosungQuery(q: string): boolean {
  const t = q.replace(/\s/g, '');
  return t.length > 0 && [...t].every((c) => CHO_SET.has(c));
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
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

export type MatchType = 'exact' | 'substring' | 'chosung' | 'synonym' | 'phonetic';
export interface SearchOptions<T> {
  getName: (item: T) => string;
  getSynonyms?: (item: T) => string[] | undefined;
  topK?: number;
  minScore?: number;
}
export interface SearchHit<T> { item: T; score: number; matchType: MatchType }

/**
 * 오타 내성 + 초성 검색 코드 마스터 검색.
 * 신호: 정확 > 부분포함 > 초성 > 동의어 > 자모 음소.
 */
export function fuzzyCodeSearch<T>(query: string, items: T[], opts: SearchOptions<T>): SearchHit<T>[] {
  const { getName, getSynonyms, topK = 10, minScore = 0.35 } = opts;
  const q = query.trim();
  if (!q) return [];
  const qNo = q.replace(/\s+/g, '');
  const chosungMode = isChosungQuery(q);

  const hits: SearchHit<T>[] = [];
  for (const item of items) {
    const name = getName(item);
    const nameNo = name.replace(/\s+/g, '');
    let score = 0; let matchType: MatchType = 'phonetic';

    if (chosungMode) {
      const cs = toChosung(nameNo);
      if (cs === qNo) { score = 0.97; matchType = 'chosung'; }
      else if (cs.startsWith(qNo)) { score = 0.9; matchType = 'chosung'; }
      else if (cs.includes(qNo)) { score = 0.75; matchType = 'chosung'; }
    } else {
      if (nameNo === qNo) { score = 1; matchType = 'exact'; }
      else if (nameNo.includes(qNo)) { score = Math.max(0.8, 0.95 - (nameNo.length - qNo.length) * 0.01); matchType = 'substring'; }
      else {
        const syn = getSynonyms?.(item)?.some((sName) => { const s = sName.replace(/\s+/g, ''); return s === qNo || s.includes(qNo) || qNo.includes(s); });
        if (syn) { score = 0.85; matchType = 'synonym'; }
        const phon = jamoSimilarity(qNo, nameNo.replace(/\d.*$/, ''));
        if (phon > score) { score = phon; matchType = 'phonetic'; }
      }
    }
    if (score >= minScore) hits.push({ item, score: Math.round(score * 1000) / 1000, matchType });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ── 한국어 수사·단위 정규화(VoiceEMR 공용) ────────────────────────
const SINO: Record<string, number> = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const PLACE: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };

export function sinoToNumber(word: string): number | null {
  if (!word) return null;
  let total = 0, current = 0, matched = false;
  for (const ch of word) {
    if (ch in SINO) { current = SINO[ch]; matched = true; }
    else if (ch in PLACE) { total += (current === 0 ? 1 : current) * PLACE[ch]; current = 0; matched = true; }
    else if (ch === '만') { total = (total + current) * 10000; current = 0; matched = true; }
    else return null;
  }
  return matched ? total + current : null;
}

/** 한국어 수사(자릿값 포함 런)·소수 → 아라비아 숫자. 자릿값 없는 단일 한자어는 보존(오변환 방지). */
export function normalizeKoreanNumber(text: string): string {
  let t = text.replace(/([영공일이삼사오육칠팔구십백천만]+)\s*점\s*([영공일이삼사오육칠팔구십백천만]+)/g, (m, a, b) => {
    const i = sinoToNumber(a); let dec = '';
    for (const ch of b) dec += ch in SINO ? String(SINO[ch]) : '';
    return i === null || !dec ? m : `${i}.${dec}`;
  });
  t = t.replace(/[영공일이삼사오육칠팔구십백천만]+/g, (m, offset: number, full: string) => {
    // 🔴 종결·서술 어미의 '이'는 계사(copula)지 수사 2가 아니다: "혈압이 백사십이었어요"→140(142 아님).
    //    자릿값 없는 단일 한자어 보존과 같은 계열의 함정(주사의 '사'=4 오변환).
    let run = m, tail = '';
    if (run.length > 1 && run.endsWith('이') && /^(었|였|에요|어요|어서|야|니|라)/.test(full.slice(offset + m.length))) {
      run = run.slice(0, -1); tail = '이';
    }
    if (!/[십백천만]/.test(run)) return m;
    const n = sinoToNumber(run); return n === null ? m : String(n) + tail;
  });
  return t;
}
