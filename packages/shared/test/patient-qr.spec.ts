import { describe, it, expect } from 'vitest';
import { buildPatientQr, parsePatientQr, LEGACY_PATIENT_QR_PREFIX } from '../src/patient-qr';

/**
 * 환자 식별 QR 페이로드 정본(2026-08-18).
 * 봉합 전: 발급 3형식(JSON 팔찌 · JSON 포털 · `HRPT:` 포털) × 소비 2파서(MRN 완전일치 · `HRPT:` 제거)
 * → 팔찌를 BCMA 에 스캔하면 **항상 BCMA_PATIENT_MISMATCH**.
 */
describe('buildPatientQr — 발급 정본', () => {
  it('MRN 만 담는다(성명·생년월일·성별 금지 — PHI 최소화)', () => {
    const qr = buildPatientQr('MRN-2026-0001');
    expect(qr).toBe('MRN-2026-0001');
    expect(qr).not.toContain('{');
    expect(qr.toLowerCase()).not.toContain('dob');
  });

  it('BCMA 소비측(MRN 완전일치)이 그대로 통과시킬 수 있다', () => {
    const mrn = 'P000123';
    expect(buildPatientQr(mrn).toUpperCase()).toBe(mrn.toUpperCase());
  });

  it('공백은 제거, 미상은 빈 문자열', () => {
    expect(buildPatientQr('  P1 ')).toBe('P1');
    expect(buildPatientQr(null)).toBe('');
  });
});

describe('parsePatientQr — 소비 정본(구 형식까지 관대하게)', () => {
  it('신규(순수 MRN)', () => expect(parsePatientQr('P000123')).toBe('P000123'));
  it('구 포털 접두', () => expect(parsePatientQr(`${LEGACY_PATIENT_QR_PREFIX}P000123`)).toBe('P000123'));
  it('구 팔찌 JSON — 이미 인쇄돼 병동에 도는 팔찌', () => {
    expect(parsePatientQr('{"t":"PATIENT","mrn":"P000123","n":"홍길동","dob":"1980-01-01","g":"M","h":"HR"}')).toBe('P000123');
  });
  it('환자 QR 이 아닌 JSON(자산 라벨 등)은 null — 추정하지 않는다', () => {
    expect(parsePatientQr('{"t":"STORAGE","id":"s1","c":"ST-1"}')).toBeNull();
  });
  it('깨진 JSON·빈 값은 null', () => {
    expect(parsePatientQr('{"t":"PATIENT"')).toBeNull();
    expect(parsePatientQr('')).toBeNull();
    expect(parsePatientQr(undefined)).toBeNull();
    expect(parsePatientQr(LEGACY_PATIENT_QR_PREFIX)).toBeNull();
  });
  it('발급→소비 왕복이 성립한다', () => {
    expect(parsePatientQr(buildPatientQr('P000123'))).toBe('P000123');
  });
});
