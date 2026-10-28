import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 🔴 레거시 PID(원시 hex 키) 대외 출력 복호 가드 — 2026-09-01.
 *
 * 배경: PatientService 는 `patient.insuranceNumber`·`patient.nationalId` 를
 *   `Buffer.from(ENCRYPTION_KEY,'hex')`(원시 hex 키)로 암호화한다.
 *   공용 `decryptField`/EncryptionService 는 `getKeyCustody().getSymmetricKey()`(파생 키)라
 *   **키가 달라 이 값을 복호하지 못한다**(authTag 실패 → ciphertext 그대로 반환).
 *
 * 실제 결함(이 가드가 막는 것):
 *   ① 청구 HIRA XML `<보험증번호>` 에 ciphertext 임베딩(심평원 거부 + PHI 암호문 유출)
 *   ② hira-edi ediData.insuranceNumber 에 ciphertext
 *   ③ 수진자 자격조회 provider.check() 에 ciphertext(NHIS 어댑터 조회 실패)
 * → 세 소비처는 `decryptLegacyPid`(원시 hex 키)로만 정상 복호된다.
 *
 * 오라클: 원시 hex 키로 암호화한 값을 파생 키(decryptField)로는 못 풀고
 *         decryptLegacyPid 로는 원문이 복원됨을 실제로 증명한다(재주입).
 */

const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, 'src', rel), 'utf8');

describe('legacy-pid-decrypt-guard: 대외 출력 insuranceNumber 복호', () => {
  it('청구 HIRA XML <보험증번호> 는 decryptLegacyPid 로 복호한다', () => {
    const src = read('modules/claim/claim.service.ts');
    const line = src.split('\n').find((l) => l.includes('보험증번호>'));
    expect(line, '보험증번호 임베딩 라인 존재').toBeTruthy();
    expect(line).toContain('decryptLegacyPid');
    // 재주입 방지: 원값을 그대로 넣는 형태가 남아 있으면 실패
    expect(/보험증번호>\$\{this\.escapeXml\(claim\.patient\?\.insuranceNumber\s*\|\|/.test(src)).toBe(false);
  });

  it('hira-edi ediData.insuranceNumber 는 decryptLegacyPid 로 복호한다', () => {
    const src = read('modules/hira-edi/hira-edi.service.ts');
    // ediData 조립부의 insuranceNumber 값 할당은 복호를 거쳐야 한다
    const assign = src.split('\n').find((l) => /insuranceNumber:\s*/.test(l) && l.includes('patient'));
    expect(assign, 'ediData insuranceNumber 할당 존재').toBeTruthy();
    expect(assign).toContain('decryptLegacyPid');
    expect(/insuranceNumber:\s*patient\.insuranceNumber\s*\|\|/.test(src)).toBe(false);
  });

  it('자격조회 provider.check insuranceNumber 는 decryptLegacyPid 로 복호한다', () => {
    const src = read('modules/eligibility/eligibility.service.ts');
    const assign = src.split('\n').find((l) => /insuranceNumber:\s*/.test(l) && l.includes('patient'));
    expect(assign, 'provider.check insuranceNumber 인자 존재').toBeTruthy();
    expect(assign).toContain('decryptLegacyPid');
    expect(/insuranceNumber:\s*patient\.insuranceNumber\s*,/.test(src)).toBe(false);
  });

  it('findOne 응답은 insuranceNumber(ciphertext)를 실어보내지 않는다', () => {
    const src = read('modules/claim/claim.controller.ts');
    const findOne = src.slice(src.indexOf('async findOne'), src.indexOf('async findOne') + 500);
    // 응답에서 insuranceNumber 를 벗기는 처리가 있어야 한다
    expect(findOne).toMatch(/insuranceNumber[^\n]*\.\.\.patient|const \{ insuranceNumber[^}]*\} = claim\.patient/);
  });
});

describe('legacy-pid-decrypt-guard 오라클: 두 키는 서로의 값을 못 푼다', () => {
  beforeAll(() => {
    // 32바이트(64 hex) 키 — 원시 hex 키/파생 키 모두 이 값을 소스로 쓴다
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('원시 hex 키로 암호화한 값: decryptLegacyPid=복원, decryptField(파생)=복원 실패(원본 반환)', async () => {
    const { encryptLegacyPidForTest, decryptLegacyPid } = await import(
      '../../src/common/crypto/legacy-pid-crypto'
    );
    const { decryptField, isEncrypted } = await import('../../src/common/crypto/field-encryption');

    const plain = '1234567890';
    const cipher = encryptLegacyPidForTest(plain);
    expect(isEncrypted(cipher)).toBe(true); // 포맷은 동일(iv:tag:cipher)

    // 원시 hex 키 복호 → 원문 복원
    expect(decryptLegacyPid(cipher)).toBe(plain);

    // 파생 키(decryptField)로는 authTag 검증 실패 → 원본(ciphertext) 그대로 반환(=복호 실패)
    const viaDerived = decryptField(cipher);
    expect(viaDerived).toBe(cipher);
    expect(viaDerived).not.toBe(plain);
  });

  it('평문 레거시/빈값은 그대로 통과한다(멱등)', async () => {
    const { decryptLegacyPid } = await import('../../src/common/crypto/legacy-pid-crypto');
    expect(decryptLegacyPid('00520')).toBe('00520'); // 평문 보험증번호
    expect(decryptLegacyPid('')).toBe('');
    expect(decryptLegacyPid(null)).toBe('');
    expect(decryptLegacyPid(undefined)).toBe('');
  });
});

describe('legacy-pid-decrypt-guard: nationalId 쓰기/읽기 키 통일(전진 정합)', () => {
  const readMod = (rel: string) => readFileSync(join(ROOT, 'src', rel), 'utf8');

  it('NICE 가입(patient-auth)은 nationalId 를 원시 키(encryptLegacyPid)+원시 hash 로 쓴다', () => {
    const src = readMod('modules/patient-auth/patient-auth.service.ts');
    expect(src).toContain('encryptLegacyPid(dto.nationalId');
    expect(src).toContain('hashNationalIdLegacy(dto.nationalId)');
    // 재주입 방지: 파생 키로 nationalId 를 쓰면 실패
    expect(/nationalId:\s*dto\.nationalId\s*\?\s*this\.encryption\.encrypt/.test(src)).toBe(false);
  });

  it('포털 setNationalId 는 원시 키+hash 로 쓰고, 마스킹 읽기는 관용 복호한다', () => {
    const src = readMod('modules/patient-auth/patient-profile.controller.ts');
    expect(src).toContain('encryptLegacyPid(clean)');
    expect(src).toContain('hashNationalIdLegacy(clean)');
    expect(src).toContain('decryptNationalIdTolerant(patient.nationalId)');
    // 재주입 방지: 파생 키 mask 로 되돌리면 실패
    expect(/masked:\s*this\.encryption\.maskNationalId\(patient\.nationalId\)/.test(src)).toBe(false);
  });

  it('직원 차트 상세(patient.service)는 nationalId 를 관용 복호로 읽는다(파생 값에 500 나지 않음)', () => {
    const src = readMod('modules/patient/patient.service.ts');
    expect(src).toContain('decryptNationalIdTolerant(patient.nationalId)');
    // 재주입 방지: this.decrypt(원시) 직접 호출로 되돌리면 실패
    expect(/const decrypted = this\.decrypt\(patient\.nationalId\)/.test(src)).toBe(false);
  });

  it('오라클: tolerant 복호는 원시·파생 두 키 값 모두 복원한다', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    const { encryptLegacyPid, decryptNationalIdTolerant, hashNationalIdLegacy, maskRrn } = await import(
      '../../src/common/crypto/legacy-pid-crypto'
    );
    const { encryptField } = await import('../../src/common/crypto/field-encryption');

    const rrn = '8605131234567';
    // 원시 키로 쓴 값 → tolerant 복원
    expect(decryptNationalIdTolerant(encryptLegacyPid(rrn))).toBe(rrn);
    // 파생 키로 쓴 값(마이그레이션 전 기존 NICE·포털) → tolerant 폴백 복원
    expect(decryptNationalIdTolerant(encryptField(rrn))).toBe(rrn);
    // 마스킹 규칙
    expect(maskRrn(rrn)).toBe('860513-1******');
    expect(maskRrn('')).toBe('******-*******');
    // hash 는 결정적(같은 입력 → 같은 해시), 하이픈 무시
    expect(hashNationalIdLegacy('860513-1234567')).toBe(hashNationalIdLegacy(rrn));
  });
});

describe('legacy-pid-decrypt-guard: 여권/외국인등록번호 암호화 + 블라인드 인덱스', () => {
  const readMod = (rel: string) => readFileSync(join(ROOT, 'src', rel), 'utf8');

  it('foreign-patient 은 여권/외국인번호를 암호화해 쓰고, 중복확인은 hash 로 한다', () => {
    const src = readMod('modules/foreign-patient/foreign-patient.service.ts');
    expect(src).toContain('encryptLegacyPid(dto.passportNumber)');
    expect(src).toContain('encryptLegacyPid(dto.alienRegistrationNo)');
    expect(src).toContain('passportNumberHash: hashForeignId');
    // 재주입 방지: 평문으로 중복확인/저장하면 실패
    expect(/where: \{ passportNumber: dto\.passportNumber/.test(src)).toBe(false);
    expect(/where: \{ alienRegistrationNo: dto\.alienRegistrationNo/.test(src)).toBe(false);
    // 부분검색(contains)에서 passportNumber 제거됨
    expect(/passportNumber: \{ contains: q/.test(src)).toBe(false);
    // 읽기 복호
    expect(src).toContain('decryptLegacyPid(patient.passportNumber)');
  });

  it('voucher 는 여권 중복확인을 hash 로, 저장을 암호화로 한다', () => {
    const src = readMod('modules/voucher/voucher.service.ts');
    expect(src).toContain('passportNumberHash: hashForeignId(dto.passportNo)');
    expect(src).toContain('encryptLegacyPid(dto.passportNo)');
    expect(/where: \{ passportNumber: dto\.passportNo \}/.test(src)).toBe(false);
  });

  it('billing 영수증은 여권번호를 복호해 싣는다(ciphertext 아님)', () => {
    const src = readMod('modules/billing/billing.service.ts');
    expect(src).toContain('decryptLegacyPid(receipt.patient.passportNumber)');
  });

  it('patient 상세는 여권/외국인번호를 복호한다', () => {
    const src = readMod('modules/patient/patient.service.ts');
    expect(src).toContain('decryptLegacyPid(patient.passportNumber)');
    expect(src).toContain('decryptLegacyPid(patient.alienRegistrationNo)');
  });

  it('PATIENT_SENSITIVE_OMIT 은 hash 컬럼도 가린다', () => {
    const src = readMod('common/patient-select.ts');
    expect(src).toContain('passportNumberHash: true');
    expect(src).toContain('alienRegistrationNoHash: true');
  });

  it('오라클: hashForeignId 는 결정적·대소문자/공백 무시, encryptLegacyPid 는 왕복', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    const { encryptLegacyPid, decryptLegacyPid, hashForeignId } = await import(
      '../../src/common/crypto/legacy-pid-crypto'
    );
    const pp = 'M12345678';
    expect(decryptLegacyPid(encryptLegacyPid(pp))).toBe(pp);
    expect(hashForeignId('m12345678')).toBe(hashForeignId(' M12345678 ')); // 정규화(trim+upper)
    expect(hashForeignId(pp)).not.toBe(hashForeignId('M99999999')); // 다른 값은 다른 해시
    expect(hashForeignId(pp)).toHaveLength(64); // sha256 hex
  });
});
