import { describe, it, expect } from 'vitest';
import { maskPhone, maskListItem, maskDetail } from '../../src/modules/patient/patient-field-mask';

/**
 * 응답 마스킹 골든 — 2026-07-31.
 * 🔴 라우트 가드만으로는 부족했다: 목록·상세 응답이 연락처·보호자·보험번호를 그대로 담아
 *    PATIENT_VIEW 만 가진 역할도 받아 갔다(프로드 실측).
 */
const FULL = { contact: true, identity: true };
const BASIC = { contact: false, identity: false };
const CLINICAL = { contact: true, identity: false };

describe('전화번호 마스킹', () => {
  it('앞 3자리·뒤 4자리만 남긴다(존재는 알리고 값은 감춘다)', () => {
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678');
    expect(maskPhone('01012345678')).toBe('010-****-5678');
  });

  it('없으면 그대로 없음(빈 값을 만들어내지 않는다)', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
  });

  it('형식이 짧으면 전부 감춘다', () => {
    expect(maskPhone('123')).toBe('***');
  });
});

describe('목록 항목', () => {
  const item = { id: 'p1', mrn: 'M1', familyName: '김', phone: '010-1234-5678', insuranceType: 'NHI' };

  it('권한이 다 있으면 손대지 않는다(동일 객체)', () => {
    expect(maskListItem(item, FULL)).toBe(item);
  });

  it('연락처 권한이 없으면 번호를 마스킹한다', () => {
    expect(maskListItem(item, BASIC).phone).toBe('010-****-5678');
  });

  it('보험 유형은 남긴다 — 수납·안내에 필요하고 식별정보가 아니다', () => {
    expect(maskListItem(item, BASIC).insuranceType).toBe('NHI');
  });
});

describe('상세', () => {
  const detail = {
    id: 'p1', mrn: 'M1', phone: '010-1234-5678', email: 'a@b.c',
    address: { city: '가상시' }, contacts: [{ name: '보호자', phone: '010-9999-8888' }],
    nationalId: '900101-1******', insuranceNumber: '12345', insuranceType: 'NHI',
  };

  it('🔴 연락처 권한이 없으면 주소·이메일·보호자를 아예 뺀다(부분 노출이 무의미)', () => {
    const m = maskDetail(detail, BASIC) as Record<string, unknown>;
    expect(m.address).toBeUndefined();
    expect(m.email).toBeUndefined();
    expect(m.contacts).toBeUndefined();
    expect(m.phone).toBe('010-****-5678');
  });

  it('🔴 신원식별 권한이 없으면 주민번호·보험번호를 뺀다(마스킹본도 남기지 않는다)', () => {
    const m = maskDetail(detail, CLINICAL) as Record<string, unknown>;
    expect(m.nationalId).toBeUndefined();
    expect(m.insuranceNumber).toBeUndefined();
    expect(m.insuranceType).toBe('NHI'); // 유형은 유지
  });

  it('진료 역할(연락처 O·신원 X)은 보호자를 그대로 본다', () => {
    const m = maskDetail(detail, CLINICAL) as Record<string, unknown>;
    expect(m.contacts).toHaveLength(1);
    expect(m.phone).toBe('010-1234-5678');
  });

  it('무엇이 가려졌는지 알린다 — 빈 값과 "권한 없음"을 구분', () => {
    const m = maskDetail(detail, BASIC) as Record<string, unknown>;
    expect(m.maskedFields).toContain('contacts');
    expect(m.maskedFields).toContain('nationalId');
  });

  it('권한이 다 있으면 손대지 않는다', () => {
    expect(maskDetail(detail, FULL)).toBe(detail);
  });
});
