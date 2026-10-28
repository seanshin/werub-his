import { describe, it, expect } from 'vitest';
import { joinPatientName, patientNameView, patientNameLabel } from '../src/patient-name';

/** 환자 이름 표시 정본(2026-10-06) — 재주입: 띄어쓰기 규칙·한글 호칭 조건을 되돌리면 실패한다. */
describe('성 + 이름', () => {
  it('🔴 한글·한자는 붙이고 라틴·키릴은 띄운다', () => {
    expect(joinPatientName('강', '미래')).toBe('강미래');
    expect(joinPatientName('王', '伟')).toBe('王伟');
    expect(joinPatientName('Бат-Эрдэнэ', 'Сарнай')).toBe('Бат-Эрдэнэ Сарнай');
    expect(joinPatientName('Smith', 'John')).toBe('Smith John');
    expect(joinPatientName('Nguyễn', 'Thị Lan')).toBe('Nguyễn Thị Lan');
    expect(joinPatientName('', 'Fatima')).toBe('Fatima');
    // 🔴 숫자가 섞인 한글 이름(테스트·시드)은 붙인다 — 숫자는 문자권이 아니다
    expect(joinPatientName('홍', '길동1')).toBe('홍길동1');
    expect(joinPatientName('자격검증', '환자11')).toBe('자격검증환자11');
    expect(joinPatientName('홍', '길동now')).toBe('홍길동now');
  });
});

describe('한국식 호칭', () => {
  it('🔴 원어가 한글이 아니고 호칭이 있으면 함께 · 한글 이름·호칭 없음·같은 말은 원어만(지어내지 않는다)', () => {
    expect(patientNameView({ familyName: 'Бат-Эрдэнэ', givenName: 'Сарнай', koreanName: '사르나이' })).toEqual({ primary: 'Бат-Эрдэнэ Сарнай', korean: '사르나이' });
    expect(patientNameView({ familyName: '강', givenName: '미래', koreanName: '강미래' })).toEqual({ primary: '강미래', korean: null });
    expect(patientNameView({ familyName: 'Smith', givenName: 'John', koreanName: null })).toEqual({ primary: 'Smith John', korean: null });
    expect(patientNameView({ name: 'Wang Wei', koreanName: '왕 웨이' })).toEqual({ primary: 'Wang Wei', korean: '왕 웨이' });
    expect(patientNameLabel({ familyName: 'Tanaka', givenName: 'Hiroshi', koreanName: '다나카 히로시' })).toBe('Tanaka Hiroshi (다나카 히로시)');
  });
});
