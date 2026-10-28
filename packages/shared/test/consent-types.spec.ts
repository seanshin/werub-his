import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSENT_TYPE_LABEL, CONSENT_TYPE_CODES, consentTypeText, isKnownConsentType } from '../src/consent-types';

const PRISMA_SCHEMA = join(__dirname, '../../../apps/api/prisma/schema.prisma');

/** `enum ConsentType { … }` 본문에서 코드만(주석 제거) */
function prismaConsentTypeCodes(): string[] {
  const src = readFileSync(PRISMA_SCHEMA, 'utf8');
  const m = src.match(/enum ConsentType \{([\s\S]*?)\}/);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
}

describe('🔴 CONSENT_TYPE_CODES — Prisma enum 의 거울(2026-09-22 · voice-emr §13.2 P0-2)', () => {
  it('스캔이 비면 아무것도 보증하지 않는다 — schema.prisma 에서 enum 을 실제로 읽는다', () => {
    expect(prismaConsentTypeCodes().length).toBeGreaterThan(5);
  });

  it('shared 코드 집합 == Prisma `enum ConsentType` 집합(한쪽에만 있는 코드 0)', () => {
    const prisma = [...prismaConsentTypeCodes()].sort();
    const shared = [...CONSENT_TYPE_CODES].sort();
    expect(shared).toEqual(prisma);
  });

  it('🔴 RECORDING 은 enum 코드다 — 서버(requireRecordingConsent)가 요구하는 유형이 목록에 있다', () => {
    expect(CONSENT_TYPE_CODES).toContain('RECORDING');
  });

  it('모든 enum 코드에 한글 라벨이 있다(RECORDING 은 2026-09-22 까지 없어 영문 코드가 그대로 나갔다)', () => {
    const unlabeled = CONSENT_TYPE_CODES.filter((c) => !isKnownConsentType(c));
    expect(unlabeled).toEqual([]);
    expect(consentTypeText('RECORDING')).toBe('진료 녹음·AI 문서화');
  });
});

/**
 * 동의서 유형 라벨 계약 — 2026-08-12 (화면 점검 W1 · 패턴 P4).
 *
 * 🔴 서버와 화면이 각자 라벨표를 들고 **같은 코드에 다른 말**을 했다
 *    (DNR: '연명의료' vs 'DNR' · GENERAL: '진료' vs '일반').
 *    게다가 화면은 못 찾으면 `?? type` 으로 **영문 코드를 그대로** 보여줬다.
 */

describe('동의서 유형 라벨', () => {
  it('🔴 DNR 은 연명의료결정법 용어를 쓴다(화면 로컬표의 "DNR" 아님)', () => {
    expect(CONSENT_TYPE_LABEL.DNR).toBe('연명의료');
  });

  it('🔴 GENERAL 과 TREATMENT 는 같은 말을 한다("일반" 으로 갈라졌던 이력)', () => {
    expect(consentTypeText('GENERAL')).toBe('진료');
    expect(consentTypeText('TREATMENT')).toBe('진료');
  });

  it('두 필드 중 아는 쪽으로 찾는다(consentType 이 비어도 type 으로)', () => {
    expect(consentTypeText(undefined, 'SURGERY')).toBe('수술');
    expect(consentTypeText(null, 'TRANSFUSION')).toBe('수혈');
  });

  it('등록 동의서 계열도 한글로 말한다', () => {
    expect(consentTypeText('PRIVACY_COLLECT')).toBe('개인정보 수집·이용');
    expect(consentTypeText('SENSITIVE_HEALTH')).toBe('민감정보 처리');
  });

  it('모르는 코드는 뭉개지 않고 그대로 — 대신 "미등록"으로 구분할 수 있다', () => {
    expect(consentTypeText('WEIRD_NEW_TYPE')).toBe('WEIRD_NEW_TYPE');
    expect(isKnownConsentType('WEIRD_NEW_TYPE')).toBe(false);
    expect(isKnownConsentType('SURGERY')).toBe(true);
  });

  it('아무것도 없으면 `-`', () => {
    expect(consentTypeText(undefined, null, '')).toBe('-');
  });
});
