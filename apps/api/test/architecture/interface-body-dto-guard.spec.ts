import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **`@Body() x: XxxDto` 인데 XxxDto 가 interface/type 이면 검증이 통째로 스킵된다** (2026-09-01).
 *
 * 발단: 변이 EP 1,168개를 빈 바디로 눌러 500 을 봤더니 뿌리가 "본문 무검증 → Prisma 필수 필드
 * 누락 → 500". 대부분은 이미 동결된 인라인 @Body 기준선(`inline-body-dto-guard`)이었으나,
 * 여섯 개는 **이름이 `...Dto` 라 그 가드가 "검증됨"으로 세어 넘겼다**(가드 구멍) — 실제로는
 * `interface` 라 런타임 metatype 이 `Object` → ValidationPipe 스킵. `CreateMenuDto`·
 * `ForeignPatientDto` 등이 그랬다(환자 PII 포함).
 *
 * 🔴 규약 — *"정본을 부르는 모양만 갖춘 코드를 의심한다"* · *"가드가 다른 이유로 통과한다"*.
 *    이 가드는 이름이 아니라 **선언 종류(class 여부)** 를 본다.
 *
 * 재주입: 아무 DTO 를 `class` → `interface` 로 되돌리면(그리고 컨트롤러가 그것을 @Body 타입으로
 * 쓰면) 이 목록에 다시 잡힌다. 아래 self-test 가 인터페이스 탐지 자체가 동작함을 확인한다.
 */
const SRC = join(__dirname, '..', '..', 'src');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walkTs(f, out);
    else if (e.endsWith('.ts')) out.push(f);
  }
  return out;
}

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 전역에서 심볼 → 선언 종류. class 가 하나라도 있으면 class 로 확정(우선). */
export function indexTypeKinds(files: string[]): Record<string, 'class' | 'interface' | 'type'> {
  const kind: Record<string, 'class' | 'interface' | 'type'> = {};
  for (const f of files) {
    const s = strip(readFileSync(f, 'utf8'));
    for (const m of s.matchAll(/\b(class|interface|type)\s+(\w+)\b/g)) {
      const [, k, name] = m as unknown as [string, 'class' | 'interface' | 'type', string];
      if (kind[name] !== 'class') kind[name] = k;
    }
  }
  return kind;
}

/**
 * 문서화된 예외 — FHIR 리소스는 class-validator 가 아니라 FHIR 로직이 검증한다.
 * 기존 `external-body-dto.spec.ts` 도 fhir 컨트롤러를 ALLOWED_INLINE 로 이미 면제하고 있다.
 * 🔴 예외는 **이름으로** 좁게 둔다(파일 전체 면제는 다른 명명 타입까지 놓친다).
 */
const ALLOWED_TYPES = new Set(['FhirBundle', 'FhirResource']);

/** 컨트롤러의 `@Body() name: Type` 사용에서 이름 타입만 뽑는다(인라인 리터럴/원시는 기존 가드 몫). */
export function bodyNamedTypes(src: string): string[] {
  const s = strip(src);
  const out: string[] = [];
  for (const m of s.matchAll(/@Body\(\s*\)\s*\w+\s*:\s*([A-Za-z_]\w*)(\[\])?/g)) {
    if (!ALLOWED_TYPES.has(m[1])) out.push(m[1]);
  }
  return out;
}

describe('🔴 @Body() 의 명명 타입은 class 여야 한다 (interface/type = 검증 스킵)', () => {
  const files = walkTs(SRC);
  const kinds = indexTypeKinds(files);
  const controllers = files.filter((f) => f.endsWith('.controller.ts'));

  const offenders: string[] = [];
  for (const f of controllers) {
    for (const t of bodyNamedTypes(readFileSync(f, 'utf8'))) {
      const k = kinds[t];
      if (k === 'interface' || k === 'type') {
        offenders.push(`${t} (${k}) <- ${f.replace(/^.*src\//, 'src/')}`);
      }
    }
  }

  it('컨트롤러를 실제로 수집한다(스캔이 비면 가드가 아니다)', () => {
    expect(controllers.length).toBeGreaterThan(200);
  });

  it('타입 종류 인덱스가 class·interface 를 모두 본다(탐지기 자체 동작)', () => {
    // 리포지토리에 반드시 존재하는 대조군
    const anyClass = Object.values(kinds).includes('class');
    const anyInterface = Object.values(kinds).includes('interface');
    expect(anyClass && anyInterface).toBe(true);
  });

  it('🔴 interface/type 로 타입된 @Body 가 없다', () => {
    expect(
      offenders.sort(),
      `interface/type @Body(=ValidationPipe 스킵):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
