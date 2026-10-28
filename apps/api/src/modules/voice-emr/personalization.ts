/**
 * VoiceEMR — 개인화 런타임 통합 + 안전 검증 (프로토타입·순수 로직·미배선)
 *
 * VoiceCustomPhrase(ALIAS/HABIT/VOCAB/MACRO)를 **검증**(안전어 shadowing 금지·§B.6)하고
 * 파이프라인 주입용으로 **분류**한다(파서 customPhrases·vocab shortlist).
 * 설계: docs/02-design/voice-emr-personalization-design.md §B
 */
import { RESERVED_WORDS, type CustomPhrases } from './intent-parser';

export type PhraseType = 'ALIAS' | 'HABIT' | 'VOCAB' | 'MACRO';
export interface CustomPhrase {
  type: PhraseType;
  pattern: string;
  action?: unknown; // ALIAS:{kind,ref} · HABIT:{canonical} · MACRO:{body}
  enabled?: boolean;
  priority?: number;
}
export interface ValidationResult { valid: boolean; error?: string }

const MAX_PATTERN = 200;

/** 등록 검증 — 안전어 shadowing·형식·길이. 실패 시 등록 거부(§B.6). */
export function validateCustomPhrase(p: CustomPhrase): ValidationResult {
  const pattern = (p.pattern ?? '').trim();
  if (!pattern) return { valid: false, error: 'EMPTY_PATTERN' };
  if (pattern.length > MAX_PATTERN) return { valid: false, error: 'PATTERN_TOO_LONG' };

  // 🔴 안전어 shadowing 금지: ALIAS/MACRO 가 예약 명령(취소·확정·서명 등)을 가리면 거부.
  if (p.type === 'ALIAS' || p.type === 'MACRO') {
    const norm = pattern.replace(/\s+/g, '');
    if (RESERVED_WORDS.some((w) => norm === w || norm.includes(w))) {
      return { valid: false, error: 'RESERVED_SHADOWING' };
    }
  }

  const a = p.action as Record<string, unknown> | undefined;
  if (p.type === 'ALIAS') {
    if (!a || !a.kind || !a.ref) return { valid: false, error: 'ALIAS_ACTION_REQUIRED' };
    if (!['order-set', 'template', 'query'].includes(String(a.kind))) return { valid: false, error: 'ALIAS_KIND_INVALID' };
  }
  if (p.type === 'HABIT' && (!a || !a.canonical)) return { valid: false, error: 'HABIT_CANONICAL_REQUIRED' };
  if (p.type === 'MACRO' && (!a || !a.body)) return { valid: false, error: 'MACRO_BODY_REQUIRED' };
  return { valid: true };
}

export interface Personalization {
  parserPhrases: CustomPhrases;             // 파서 주입(habits·aliases)
  vocab: string[];                          // VOCAB shortlist 병합용
  macros: { pattern: string; body: string }[];
  rejected: { pattern: string; error: string }[];
}

/** 사용자 문구 집합 → 검증·분류(파이프라인 주입 형태). 유효·enabled 만 채택. */
export function buildPersonalization(phrases: CustomPhrase[]): Personalization {
  const habits: { from: string; to: string }[] = [];
  const aliases: { pattern: string; action: unknown }[] = [];
  const vocab: string[] = [];
  const macros: { pattern: string; body: string }[] = [];
  const rejected: { pattern: string; error: string }[] = [];

  const enabled = phrases.filter((p) => p.enabled !== false);
  // priority 오름차순(낮을수록 우선) — ALIAS 매칭 순서
  const sorted = [...enabled].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const p of sorted) {
    const v = validateCustomPhrase(p);
    if (!v.valid) { rejected.push({ pattern: p.pattern, error: v.error! }); continue; }
    const a = p.action as Record<string, unknown>;
    switch (p.type) {
      case 'HABIT': habits.push({ from: p.pattern, to: String(a.canonical) }); break;
      case 'ALIAS': aliases.push({ pattern: p.pattern, action: p.action }); break;
      case 'VOCAB': vocab.push(p.pattern); break;
      case 'MACRO': macros.push({ pattern: p.pattern, body: String(a.body) }); break;
    }
  }
  return { parserPhrases: { habits, aliases }, vocab, macros, rejected };
}
