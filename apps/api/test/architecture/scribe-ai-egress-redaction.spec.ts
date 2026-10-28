import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
// 계측 규칙 정본은 스캐너 하나 — 주석·문자열 토크나이저를 여기서 다시 만들지 않는다
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 D5 — scribe 모듈에서 대화 원문을 AI 서버로 보내는 **모든 호출**(`medicalAi.autoRecord(`)이
 *    같은 함수 안에서 `redactForAiEgress(` 를 지나고, **그 결과(`<x>.text`)를 보낸다**.
 *
 * 2026-09-22 실측(voice-emr-ambient-conversation.plan.md §13.2 P0-3): `scribe.service.draft()`·`ambient.service.analyze()`
 * 가 실명 대화를 그대로 `autoRecord({ conversation })` 로 보냈다. 정본 `common/util/ai-phi-redact.ts` 는 있었고
 * 다른 두 소비처는 썼는데 이 축만 안 썼다 — "정본을 만든 것 ≠ 소비처가 쓰는 것".
 *
 * 🔴 **이름이 아니라 호출을 본다**(같은 날 `config-env-override-consumers` 가드가 import 한 줄 때문에 다른 이유로
 *    통과한 전례). 파일에 `redactForAiEgress` 가 import 돼 있어도, 다른 함수에서 불려도, 부르고서 원문을
 *    보내도 전부 위반이다. 판정 단위는 **`autoRecord(` 를 품은 함수 본문**이다.
 */
const SCRIBE_DIR = join(process.cwd(), 'src', 'modules', 'scribe');

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) tsFiles(f, out);
    else if (e.endsWith('.ts') && !e.endsWith('.spec.ts')) out.push(f);
  }
  return out;
}

/** 함수·메서드 머리(클래스 메서드 `async draft(` · `function x(` · `const x = async (`) — 여는 중괄호까지 */
const FN_HEAD = /(?:^|\n)[ \t]*(?:(?:public|private|protected|static|readonly)\s+)*(?:async\s+)?(?:function\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\{|(?:^|\n)[ \t]*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>\s*\{/g;

function bodyEnd(code: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return code.length;
}

export interface AutoRecordCall { fn: string; line: number; ok: boolean; why?: string }

/**
 * 순수 스캐너 — 코드 문자열에서 `autoRecord(` 호출마다 **가장 안쪽의 감싸는 함수** 본문을 잡아,
 * ① 그 본문에 `redactForAiEgress(` 호출이 있고 ② `autoRecord(` 인자가 그 결과 변수의 `.text` 를 쓰는지 본다.
 */
export function scanAutoRecordCalls(source: string): AutoRecordCall[] {
  const code = stripComments(source) as string;
  const heads: { name: string; open: number; close: number }[] = [];
  for (const m of code.matchAll(FN_HEAD)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    heads.push({ name: m[1] ?? m[2] ?? '?', open, close: bodyEnd(code, open) });
  }
  const out: AutoRecordCall[] = [];
  for (const m of code.matchAll(/\.autoRecord\s*\(/g)) {
    const at = m.index ?? 0;
    const line = code.slice(0, at).split('\n').length;
    // 가장 안쪽(가장 늦게 열린) 함수 — 화살표 콜백까지 잡히므로 `redactForAiEgress` 는 바깥 함수에 있을 수 있다.
    //   → 감싸는 함수들을 안쪽부터 바깥으로 보되 **메서드 경계(클래스 메서드 머리)** 를 넘지 않는다.
    const enclosing = heads.filter((h) => h.open < at && at < h.close).sort((a, b) => b.open - a.open);
    if (!enclosing.length) { out.push({ fn: '(top-level)', line, ok: false, why: '함수 밖에서 호출' }); continue; }
    const outer = enclosing[enclosing.length - 1];
    const body = code.slice(outer.open, outer.close + 1);
    const redVar = body.match(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*redactForAiEgress\s*\(/);
    if (!redVar) { out.push({ fn: outer.name, line, ok: false, why: '같은 함수 안에 redactForAiEgress( 호출 없음' }); continue; }
    // autoRecord( 의 첫 인자 — 괄호 짝까지
    let depth = 0, end = at;
    for (let i = at + m[0].length - 1; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    const arg = code.slice(at + m[0].length, end);
    if (!new RegExp(`\\b${redVar[1]}\\.text\\b`).test(arg)) {
      out.push({ fn: outer.name, line, ok: false, why: `redactForAiEgress 결과(${redVar[1]}.text)가 아니라 다른 것을 보낸다: ${arg.trim().slice(0, 60)}` });
      continue;
    }
    out.push({ fn: outer.name, line, ok: true });
  }
  return out;
}

describe('🔴 scribe → AI 전송은 함수마다 비식별을 지난다(D5 · 호출 단위)', () => {
  it('대조군 — 스캐너가 위반 3형을 실제로 잡는다(import 만 · 다른 함수에서 호출 · 부르고서 원문 전송)', () => {
    const importOnly = `import { redactForAiEgress } from '../../common/util/ai-phi-redact';
class S {
  async draft() { const ai = await this.medicalAi.autoRecord({ conversation }); return ai; }
}`;
    expect(scanAutoRecordCalls(importOnly)).toEqual([{ fn: 'draft', line: 3, ok: false, why: '같은 함수 안에 redactForAiEgress( 호출 없음' }]);

    const otherFn = `class S {
  private prep(t: string) { const red = redactForAiEgress(t, {}); return red.text; }
  async draft() { const ai = await this.medicalAi.autoRecord({ conversation }); return ai; }
}`;
    expect(scanAutoRecordCalls(otherFn).map((c) => c.ok)).toEqual([false]);

    const rawAfterRedact = `class S {
  async draft() {
    const red = redactForAiEgress(conversation, { patientNames: [n] });
    const ai = await this.medicalAi.autoRecord({ conversation });
  }
}`;
    const r = scanAutoRecordCalls(rawAfterRedact);
    expect(r[0].ok).toBe(false);
    expect(r[0].why).toMatch(/red\.text/);
  });

  it('대조군 — 올바른 모양(같은 함수 · 결과 .text 전송 · try 안 · 콜백 안)은 통과한다', () => {
    const good = `class S {
  async analyze() {
    const red = redactForAiEgress(conversation, { patientNames: names.patientNames });
    try {
      const ai = red.rehydrate(await this.medicalAi.autoRecord({ conversation: red.text }));
    } catch (e) { this.logger.warn('x'); }
    const later = await Promise.all(items.map(async (x) => this.medicalAi.autoRecord({ conversation: red.text, specialty: x })));
  }
}`;
    const r = scanAutoRecordCalls(good);
    expect(r).toHaveLength(2);
    expect(r.every((c) => c.ok)).toBe(true);
  });

  it('대조군 — 주석 속 autoRecord( 는 세지 않는다(주석이 문자열 검사에 걸리던 전례)', () => {
    const src = `class S {
  // 옛날엔 this.medicalAi.autoRecord({ conversation }) 를 바로 불렀다
  async draft() { return 1; }
}`;
    expect(scanAutoRecordCalls(src)).toEqual([]);
  });

  it('scribe 모듈의 autoRecord( 호출 전부가 같은 함수 안에서 비식별 결과를 보낸다(호출 ≥2 — 0이면 스캐너가 죽은 것)', () => {
    const files = tsFiles(SCRIBE_DIR);
    const calls: (AutoRecordCall & { file: string })[] = [];
    for (const f of files) {
      const rel = f.slice(process.cwd().length + 1);
      for (const c of scanAutoRecordCalls(readFileSync(f, 'utf8'))) calls.push({ file: rel, ...c });
    }
    // 🔴 하한 — draft()·analyze() 두 자리는 실재한다. 0이면 가드가 아무것도 안 본 것이다.
    expect(calls.length, `autoRecord( 호출 수: ${calls.length}`).toBeGreaterThanOrEqual(2);
    expect(calls.map((c) => c.fn).sort()).toEqual(expect.arrayContaining(['analyze', 'draft']));
    const offenders = calls.filter((c) => !c.ok).map((c) => `${c.file}:${c.line} ${c.fn} — ${c.why}`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
