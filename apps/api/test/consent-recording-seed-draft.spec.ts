import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSENT_TYPE_CODES, RECORDING_CONSENT_FORBIDDEN_ASSERTIONS, recordingConsentDraftText } from '@hospital-run/shared';

/**
 * 🔴 (2026-09-22 · voice-emr §13.4 D4) 진료 녹음 동의서 시드 견본은 **원내 표준이 아니다**.
 *    시드가 정책을 정해버린 전례(CLAUDE.md 함정 4)가 있어, 견본이 시드에 들어가면 "법무 검토 전" 표시가 함께 가야 한다.
 *
 * 지키는 것:
 *  ① 시드 `consentTemplates` 에 `type: 'RECORDING'` 견본이 있고, 이름·설명·본문이 shared 초안 정본(검토 전)에서 온다.
 *  ② 시드 소스가 문안을 따로 들고 있지 않다(정본 둘 금지) — 설치 형태 단정 문장이 시드에 없다.
 *  ③ 서명 요구 표(`SIGN_REQUIREMENTS`)가 enum 전 코드를 명시한다(누락≠결정).
 *
 * 재주입 검증(2026-09-22): 시드 견본의 `name` 에서 `${RECORDING_CONSENT_DRAFT.statusLabel}` 을 빼면 ① 이 실패한다.
 */
const ROOT = join(__dirname, '..');
const SEED = readFileSync(join(ROOT, 'prisma/seed.ts'), 'utf8');
const SERVICE = readFileSync(join(ROOT, 'src/modules/consent/consent.service.ts'), 'utf8');

function recordingTemplateBlock(): string {
  const start = SEED.indexOf("type: 'RECORDING'");
  if (start < 0) return '';
  // 견본 객체는 `requiredFields: [...] }` 로 끝난다
  const end = SEED.indexOf('requiredFields:', start);
  return end < 0 ? '' : SEED.slice(start, SEED.indexOf('\n', end));
}

describe('🔴 진료 녹음 동의서 시드 견본 — 검토 전 표시가 함께 간다', () => {
  const block = recordingTemplateBlock();

  it('① RECORDING 견본이 시드에 있고, 이름·설명·본문이 shared 초안 정본에서 온다', () => {
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/name: `[^`]*\$\{RECORDING_CONSENT_DRAFT\.statusLabel\}/);
    expect(block).toMatch(/description: `[^`]*\$\{RECORDING_CONSENT_DRAFT\.statusLabel\}/);
    expect(block).toContain('recordingConsentDraftText()');
    expect(block).toContain('RECORDING_CONSENT_DRAFT.status');
  });

  it('② 시드가 문안을 따로 들고 있지 않다 — 단정 문장·원문 예시 수치가 시드에 없다', () => {
    for (const bad of RECORDING_CONSENT_FORBIDDEN_ASSERTIONS) expect(SEED).not.toContain(bad);
    expect(SEED).not.toContain('24시간~7일');
    // 정본 본문은 검토 전 표시로 시작한다(시드가 그 본문을 그대로 쓴다)
    expect(recordingConsentDraftText().startsWith('※ 법무 검토 전 초안')).toBe(true);
  });

  it('③ SIGN_REQUIREMENTS 가 enum 전 코드를 명시한다', () => {
    const m = SERVICE.match(/const SIGN_REQUIREMENTS: Record<string, string\[\]> = \{([\s\S]*?)\n\};/);
    expect(m).not.toBeNull();
    const keys = [...m![1].matchAll(/^\s*([A-Z_]+):/gm)].map((x) => x[1]);
    const missing = CONSENT_TYPE_CODES.filter((c) => !keys.includes(c));
    expect(missing).toEqual([]);
  });
});
