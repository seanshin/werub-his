import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_ENV_OVERRIDES, configEnvOverride } from '../../src/common/config-env-overrides';

/**
 * 🔴 **정본을 만든 것 ≠ 소비처가 그것을 쓰는 것**(CLAUDE.md §2).
 *
 * 외부 점검 을 고치며 `AI_SERVER_URL` 이 DB 설정을 이기게 했는데, `ai.server.url` 을 읽는 곳은
 * 세 갈래였다 — 설정 서비스 하나와 **`system_configs` 를 직접 읽는 두 곳**(의료 AI · 포털 복약 설명).
 * 설정 서비스만 고쳤다면 "관리 화면에는 환경변수 값이 보이는데 **실제 전송은 DB 주소로 나가는**" 상태가 된다.
 *
 * 이 가드는 그 소비처를 **전역에서 센다** — 새로 생긴 직접 읽기도 잡힌다.
 */
const SRC = join(process.cwd(), 'src');
const CANON = 'src/common/config-env-overrides.ts';

/**
 * 🔴 키별 호출이 아니라 **모든 키에 일반 적용**하는 자리(설정 서비스 하나). 면제가 아니라 다른 적용 방식이라
 *    대조 코드를 따로 센다 — 읽기 세 경로(`get`·`getWithSource`·`getAll`)가 전부 덮어쓰기를 지나야 한다.
 */
const GENERIC_APPLIERS = ['src/modules/config/config-runtime.service.ts'];

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) tsFiles(f, out);
    else if (e.endsWith('.ts') && !e.endsWith('.spec.ts')) out.push(f);
  }
  return out;
}

describe('🔴 환경변수 덮어쓰기 — 소비처 전부가 정본을 지난다', () => {
  const files = tsFiles(SRC);

  it('대조군 — 소스를 실제로 훑었다', () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it.each(Object.keys(CONFIG_ENV_OVERRIDES))('%s 을 읽는 모든 자리가 덮어쓰기를 적용한다', (key) => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.slice(process.cwd().length + 1);
      if (rel === CANON) continue;
      const src = readFileSync(f, 'utf8');
      // 🔴 `ConfigRuntimeService.get()` 경유는 이미 정본을 지난다(그 안에서 덮어쓴다).
      //    여기서 보는 것은 **`system_configs` 를 직접 읽는** 자리뿐이다 — 그 길은 덮어쓰기가 닿지 않는다.
      const directRead = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*)/.test(l))
        .some((l) => l.includes(`'${key}'`) && /systemConfig\.(findMany|findFirst|findUnique)/.test(src));
      if (!directRead) continue;
      // 🔴 **이름이 아니라 호출을 본다**(2026-09-22 재주입에서 이 가드가 다른 이유로 통과했다):
      //    덮어쓰기를 걷어내도 `import { configEnvOverride }` 한 줄이 남아 있으면 초록이 됐다.
      //    이 키에 대한 **호출**이 있어야 통과한다.
      // 설정 서비스는 **모든 키에** 일반적으로 적용한다(키마다 호출하지 않는다) — 그 자리만 일반 적용으로 본다.
      const applied = GENERIC_APPLIERS.includes(rel)
        ? (src.match(/configEnvOverride\(\s*(?:key|def\.key)\s*\)/g) ?? []).length >= 3
        : new RegExp(`configEnvOverride\\(\\s*'${key.replace('.', '\\.')}'`).test(src);
      if (!applied) offenders.push(rel);
    }
    expect(
      offenders,
      `이 파일들이 ${key} 를 직접 읽으면서 환경변수 덮어쓰기를 지나지 않는다(관리 화면과 실제 목적지가 갈린다):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('덮어쓰기 규칙 자체 — 빈 문자열·공백은 덮지 않는다(설정을 지우지 않는다)', () => {
    expect(configEnvOverride('ai.server.url', { AI_SERVER_URL: '  ' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(configEnvOverride('ai.server.url', {} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(configEnvOverride('ai.server.url', { AI_SERVER_URL: ' https://a.b ' } as NodeJS.ProcessEnv)).toBe('https://a.b');
    expect(configEnvOverride('pharmacy.durGate.enforce', { AI_SERVER_URL: 'x' } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
