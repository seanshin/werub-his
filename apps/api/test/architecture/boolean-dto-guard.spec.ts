import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 🔴 불리언 입구 가드(2026-09-15 P2) — `boolean` 으로 선언한 DTO 필드에 `@IsBoolean` 이 없으면
 *    문자열 `"false"` 가 통과한다(전역 ValidationPipe 는 implicit conversion 을 켜지 않는다).
 *    서비스가 `if (dto.x)` 나 `dto.x !== false` 로 읽으면 **"false" 가 참**이 된다.
 *
 *    실측으로 막은 것:
 *     · 사망 처리 `stopPrescriptions`·`cancelAppointments`·`dischargeIfAdmitted` — 서비스가 `!== false` 로 판정해
 *       사용자가 끈 처방 중단·예약 취소·퇴원이 그대로 실행됐다(되돌리기 어려운 연쇄)
 *     · ICU 입실 `ventilator`·`isolation`, 문진 매핑 `isActive` — Prisma Boolean 컬럼에서 500
 *     · AI 지식 색인 `shared`
 *    같은 계열(B6~B9): 재활 `overrideGate`·영상 `overrideSafety`·치료일정 `cancel` 은 인라인 본문 DTO 전환 때 봉합.
 *
 * 판정: class-validator 를 쓰는 클래스의 `x: boolean`/`x?: boolean` 선언 앞 데코레이터에 `@IsBoolean` 또는
 *   `@Equals(true|false)` 가 있어야 한다. 타입 리터럴 안(`{ hidden?: boolean }`)·주석은 필드가 아니다.
 * 기준선: **0**(여유 없음). 새 불리언 필드는 `@IsBoolean` 을 달거나 정당 사유를 이 파일 EXEMPT 에 적는다.
 */
const ROOT = resolve(__dirname, '../../src');

/** 정당 면제 — "파일::클래스.필드": 사유 (현재 없음) */
const EXEMPT: Record<string, string> = {};

const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
};

/** 문자열 안의 `//` 를 지우지 않도록 따옴표를 건너뛰며 주석만 공백으로 바꾼다(줄 수 보존) */
export function stripTsComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      const q = c; out += c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i++]; } out += src[i++]; }
      out += src[i++] ?? '';
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && n === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else { out += c; i++; }
  }
  return out;
}

export interface BoolField { file: string; cls: string; field: string; guarded: boolean }

export function scanBooleanDtoFields(src: string, file: string): BoolField[] {
  if (!/from 'class-validator'/.test(src)) return [];
  const code = stripTsComments(src);
  const out: BoolField[] = [];
  const clsRe = /\bclass\s+(\w+)[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = clsRe.exec(code))) {
    let i = clsRe.lastIndex;
    let depth = 1;
    while (i < code.length && depth) { if (code[i] === '{') depth++; else if (code[i] === '}') depth--; i++; }
    const body = code.slice(clsRe.lastIndex, i - 1);
    if (!/@(Is\w+|Validate\w*|Equals)\b/.test(body)) continue;
    // 클래스 본문 **최상위**(깊이 0) 줄만 필드로 본다 — `{ hidden?: boolean }` 같은 타입 리터럴 안은 제외
    let d = 0;
    let top = '';
    for (const ch of body) {
      if (ch === '{') { d++; top += ' '; continue; }
      if (ch === '}') { d--; top += ' '; continue; }
      top += d === 0 ? ch : (ch === '\n' ? '\n' : ' ');
    }
    const propRe = /((?:@[\w.]+(?:\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?\s*)*)(?:^|\n)?\s*(?:readonly\s+)?(\w+)\s*[!?]?\s*:\s*boolean\b/g;
    let p: RegExpExecArray | null;
    while ((p = propRe.exec(top))) {
      const decos = p[1] ?? '';
      const guarded = /@IsBoolean\b/.test(decos) || /@Equals\(\s*(true|false)\s*\)/.test(decos);
      out.push({ file, cls: m[1], field: p[2], guarded });
    }
  }
  return out;
}

const all = walk(ROOT).flatMap((f) => scanBooleanDtoFields(readFileSync(f, 'utf8'), relative(ROOT, f)));
const violations = all
  .filter((x) => !x.guarded)
  .map((x) => `${x.file}::${x.cls}.${x.field}`)
  .filter((k) => !(k in EXEMPT));

describe('🔴 DTO 불리언 필드는 @IsBoolean 으로 받는다 — 문자열 "false" 가 참이 되지 않게', () => {
  it('하한 — 스캐너가 실제로 불리언 필드를 찾는다(0 이면 가드가 헛돈다)', () => {
    expect(all.filter((x) => x.guarded).length).toBeGreaterThan(150);
  });

  it('기준선 0 — @IsBoolean 없는 불리언 DTO 필드가 없다', () => {
    expect(violations).toEqual([]);
  });

  it('대조군 — 스캐너가 누락을 잡고, 타입 리터럴·주석은 필드로 세지 않는다', () => {
    const fixture = `import { IsOptional, IsBoolean, IsObject } from 'class-validator';
      export class A {
        @IsOptional() danger?: boolean;
        @IsOptional() @IsBoolean() safe?: boolean;
        // legacy?: boolean;
        /** note: { hidden?: boolean } */
        @IsObject() map!: Record<string, { hidden?: boolean }>;
      }`;
    const r = scanBooleanDtoFields(fixture, 'fx.ts');
    expect(r.map((x) => `${x.field}:${x.guarded}`)).toEqual(['danger:false', 'safe:true']);
  });

  it('EXEMPT 에 적힌 항목은 실재해야 한다(죽은 면제 금지)', () => {
    const keys = new Set(all.map((x) => `${x.file}::${x.cls}.${x.field}`));
    expect(Object.keys(EXEMPT).filter((k) => !keys.has(k))).toEqual([]);
  });
});
