import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **LLM 출력을 `JSON.parse` 할 때는 우아하게 실패한다** (2026-09-01 · 발굴).
 *
 * LLM 은 `{...}` 모양이나 유효하지 않은 JSON 을 흔히 낸다. draftOrderSet 은 다른 실패엔
 * `throw new Error('AI 초안 생성 실패 …')` 로 의미 있는 메시지를 던지는데, 파싱만 raw SyntaxError
 * ('Unexpected token …')로 500 에 샜다 → 같은 계약(의미 있는 메시지)으로 감쌌다.
 * (다른 LLM 파싱 지점은 호출부/근접 try 로 이미 잡힌다 — drug-explain extractJson·medical-ai stream/cache 등.)
 */
const src = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8');

describe('🔴 draftOrderSet LLM 파싱이 우아하게 실패한다', () => {
  const s = src('medical-ai/medical-ai.service.ts');
  it('jsonMatch 파싱이 try 로 감싸지고 의미 있는 메시지를 던진다', () => {
    // draftOrderSet 근방: JSON.parse(jsonMatch[0]) 이 try 안에 있고 '응답 형식 오류'로 던진다
    const block = s.slice(s.indexOf('async draftOrderSet'), s.indexOf('async draftOrderSet') + 1500);
    expect(block).toMatch(/try\s*\{\s*\n?\s*parsed = JSON\.parse\(jsonMatch\[0\]\)/);
    expect(block).toMatch(/AI 초안 생성 실패 — 응답 형식 오류/);
    // 🔴 try 없는 raw JSON.parse(jsonMatch[0]) 로 되돌아가지 않는다
    expect(block).not.toMatch(/const parsed = JSON\.parse\(jsonMatch\[0\]\) as/);
  });
});
