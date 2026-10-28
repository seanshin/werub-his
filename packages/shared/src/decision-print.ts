import { DECISION_SUBDOMAINS, decisionSubdomainOf } from './decision-subdomains';
import type { DecisionDomain } from './decision-domains';

/**
 * 결정 인쇄본 정본 줄 — 서버 발급 스냅샷과 화면 인쇄본이 **같은 함수**를 쓴다(2026-10-12 기획 `decision-print-remaining` P0-1).
 *
 * 🔴 종전엔 화면(`print-sheet.tsx`)만 이 줄을 만들고 해시를 브라우저 안에서 계산했다 — 어디에도 남지 않아
 *    QR 을 찍어도 대조할 곳이 없었다(G1). 서버가 같은 줄을 만들어 발급 원장에 동결한다.
 *
 * 줄    = 결정키 "|" 상태 "|" 선택값 "|" 결정시각
 * 상태  = REAL(실결정) | SEED(개발 시드 — 실결정 아님) | OPEN(미결)
 * 본문  = 줄들을 "\n" 으로 이음 · 해시 = sha256 hex(UTF-8)
 * 🔴 바꾸면 이미 발급된 판과 대조가 깨진다 — 바꿀 때는 버전을 올리고 옛 버전 해석을 남긴다.
 */
export const DECISION_PRINT_CANON_VERSION = 1;

export type DecisionPrintState = 'REAL' | 'SEED' | 'OPEN';
export const DECISION_PRINT_STATES: readonly DecisionPrintState[] = ['REAL', 'SEED', 'OPEN'];

export interface DecisionPrintSource {
  key: string;
  decided: boolean;
  /** 없으면 시드 아님 */
  seeded?: boolean;
  record?: { choice: string; decidedAt: string } | null;
}

export function decisionPrintStateOf(i: { decided: boolean; seeded?: boolean }): DecisionPrintState {
  return i.decided ? 'REAL' : i.seeded ? 'SEED' : 'OPEN';
}

export function decisionPrintCanonLine(i: DecisionPrintSource): string {
  return [i.key, decisionPrintStateOf(i), i.record?.choice ?? '', i.record?.decidedAt ?? ''].join('|');
}

export interface DecisionPrintLine { key: string; state: DecisionPrintState | string; choice: string; decidedAt: string }

export function parseDecisionPrintLine(line: string): DecisionPrintLine {
  const [key = '', state = '', choice = '', decidedAt = ''] = line.split('|');
  return { key, state, choice, decidedAt };
}

/** 구분자 검사 — 키·선택값에 `|`·줄바꿈이 있으면 줄이 깨진다(가드가 등록부 전 키·전 선택값에 건다) */
export const isPrintCanonSafe = (s: string) => !/[|\r\n]/.test(s);

/**
 * 대장 정렬 — 세부 분류 정본 순서 → 결정 키(코드 포인트 순).
 * 🔴 `localeCompare` 를 쓰지 않는다 — 서버(Node ICU)·브라우저의 로캘이 다르면 순서가 갈려 해시가 달라진다.
 */
export function sortDecisionsForRegister<T extends { key: string; track: string; layer: string; domain?: DecisionDomain | null }>(items: readonly T[]): T[] {
  const order = [...DECISION_SUBDOMAINS.map((s) => s.key), 'OTHER'];
  const rank = (i: T) => order.indexOf(decisionSubdomainOf(i.key, i.track, i.layer, i.domain) ?? 'OTHER');
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export type DecisionPrintDiffEntry = {
  key: string;
  /** null = 그 판에 없던 결정(이후 등록) */
  before: DecisionPrintLine | null;
  /** null = 지금 등록부에 없는 결정 */
  after: DecisionPrintLine | null;
};

/**
 * 발급 판 ↔ 지금 원장 대조 — 키 단위.
 * 🔴 바뀌었다고 그 판이 무효가 아니다 — 그 시점의 진본이다. "이 판 이후 N건 바뀜"이라는 사실만 낸다.
 */
export function diffDecisionPrintLines(issued: readonly string[], now: readonly string[]): DecisionPrintDiffEntry[] {
  const a = new Map(issued.map((l) => { const p = parseDecisionPrintLine(l); return [p.key, { line: l, p }] as const; }));
  const b = new Map(now.map((l) => { const p = parseDecisionPrintLine(l); return [p.key, { line: l, p }] as const; }));
  const out: DecisionPrintDiffEntry[] = [];
  for (const [k, x] of a) {
    const y = b.get(k);
    if (!y) out.push({ key: k, before: x.p, after: null });
    else if (y.line !== x.line) out.push({ key: k, before: x.p, after: y.p });
  }
  for (const [k, y] of b) if (!a.has(k)) out.push({ key: k, before: null, after: y.p });
  return out;
}
