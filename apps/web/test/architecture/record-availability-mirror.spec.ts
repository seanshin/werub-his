import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VACCINATION_RECORDING_SUPPORTED, VACCINATION_UNSUPPORTED_NOTE } from '@hospital-run/shared';

/**
 * 모바일 미러 대조 — 값이 갈라지면 같은 환자가 앱을 바꿀 때 다른 말을 듣는다.
 *
 * 🔴 모바일은 Metro 번들러가 워크스페이스 패키지를 따라가지 못해 `@hospital-run/shared` 를
 *    import 하지 못한다(`lab-flags.ts` 와 같은 관례로 값을 복제한다). 복제는 갈라진다 —
 *    그래서 **기계로 대조**한다. 2026-08-19 에도 같은 이유로 포털과 공개 사이트가 AI 표기를
 *    다르게 말했다.
 */
const MIRROR = join(process.cwd(), '..', 'mobile', 'src', 'lib', 'record-availability.ts');
const src = readFileSync(MIRROR, 'utf8');

describe('예방접종 기록 가용성 — 모바일 미러가 정본과 같다', () => {
  it('플래그 값이 같다', () => {
    const m = src.match(/VACCINATION_RECORDING_SUPPORTED\s*=\s*(true|false)/);
    expect(m, '모바일 미러에서 플래그를 찾지 못했다').toBeTruthy();
    expect(m![1] === 'true').toBe(VACCINATION_RECORDING_SUPPORTED);
  });

  it('문구가 한 글자도 다르지 않다', () => {
    const m = src.match(/VACCINATION_UNSUPPORTED_NOTE\s*=\s*\n?\s*'([^']+)'/);
    expect(m, '모바일 미러에서 문구를 찾지 못했다').toBeTruthy();
    expect(m![1]).toBe(VACCINATION_UNSUPPORTED_NOTE);
  });

  it('모바일 화면이 그 값을 실제로 쓴다 — import 만 있는 것은 통과가 아니다', () => {
    const screen = readFileSync(join(process.cwd(), '..', 'mobile', 'app', '(tabs)', 'health.tsx'), 'utf8')
      .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(screen).toContain('VACCINATION_RECORDING_SUPPORTED');
    expect(screen).toContain('VACCINATION_UNSUPPORTED_NOTE');
  });
});
