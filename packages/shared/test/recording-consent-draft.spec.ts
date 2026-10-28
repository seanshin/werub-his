import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RECORDING_CONSENT_DRAFT,
  RECORDING_CONSENT_FORBIDDEN_ASSERTIONS,
  recordingConsentDraftText,
} from '../src/recording-consent-draft';

/**
 * 진료 녹음 동의서 문안 초안 정본 — 2026-09-22 (voice-emr §13.4 D4).
 *
 * 지키는 것:
 *  ① 문안은 **법무 검토 전**이고, 렌더 본문 첫 줄에 그 표시가 박힌다(라벨만 따로 두면 인쇄에서 떨어진다).
 *  ② `[ ]` 로 비어 있는 자리(보존기간 등)에 숫자를 **지어내지 않는다** — 일수·시간 수치가 본문에 없다.
 *  ③ 설치 형태를 모르면서 할 수 없는 단정("외부로 제공되지 않습니다" 류)이 본문에 없다.
 *  ④ 원문(2026-07-07)과 다르게 적은 자리는 `deviations` 에 전부 밝힌다 — 출처 문서가 실재한다.
 */
describe('진료 녹음 동의서 문안 초안 — 확정된 것처럼 말하지 않는다', () => {
  const text = recordingConsentDraftText();

  it('① 상태는 법무 검토 전이고, 본문 첫 줄이 그 사실을 말한다', () => {
    expect(RECORDING_CONSENT_DRAFT.status).toBe('LEGAL_REVIEW_PENDING');
    expect(text.split('\n')[0]).toContain(RECORDING_CONSENT_DRAFT.statusLabel);
    expect(text.split('\n')[0]).toContain('확정 문안이 아닙니다');
  });

  it('② 비어 있는 수치를 지어내지 않는다 — 보존기간 자리는 `[ ]` 이고 본문에 일수·시간 수치가 없다', () => {
    expect(text).toMatch(/\[보존기간: 미정/);
    // "24시간" "7일" "90일" 같은 기간 수치가 본문에 없다(원문 예시 "예 24시간~7일" 을 옮겨 적지 않았다)
    expect(text).not.toMatch(/\d+\s*(시간|일|개월|년)\b/);
    expect(RECORDING_CONSENT_DRAFT.unresolved.length).toBeGreaterThan(0);
  });

  it('③ 설치 형태에 따라 거짓이 되는 단정이 본문에 없다', () => {
    for (const bad of RECORDING_CONSENT_FORBIDDEN_ASSERTIONS) expect(text).not.toContain(bad);
    // 대신 "기관이 지정한 AI 서버" 라는, 설정값 그대로의 사실만 말한다
    expect(text).toContain('기관이 지정한 AI 서버');
  });

  it('④ 원문과 다르게 적은 자리를 전부 밝힌다 — 출처 문서가 실재한다', () => {
    const src = join(__dirname, '../../../', RECORDING_CONSENT_DRAFT.source);
    expect(existsSync(src)).toBe(true);
    const doc = readFileSync(src, 'utf8');
    expect(doc).toContain('법무 검토 전');
    expect(RECORDING_CONSENT_DRAFT.deviations.length).toBeGreaterThanOrEqual(4);
    // 대조군: 원문 3항의 단정은 **원문 문서에는** 있다(우리가 지운 것이지 원래 없던 것이 아니다)
    expect(doc).toContain('외부로 제공·공개되지 않습니다');
  });

  it('8개 항목·2개 동의란이 원문 A-1·A-2 와 같은 수', () => {
    expect(RECORDING_CONSENT_DRAFT.items.map((i) => i.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(RECORDING_CONSENT_DRAFT.consentLines).toHaveLength(2);
  });
});
