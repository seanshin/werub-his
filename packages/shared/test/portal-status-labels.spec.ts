/**
 * 포털 상태 라벨 정본(2026-10-19 포털 세련화 A2) — 환자 화면에 영문 상태 코드(`CHECKED_IN`)가 그대로 보였다.
 *  · 예약 = `APPOINTMENT_STATUS_LABEL` · 수납 = 환자 관점 `BILLING_STATUS_PATIENT_LABEL`
 *  · 🔴 두 표 모두 DB enum 의 값을 **빠짐없이** 덮어야 한다(빠지면 화면이 코드를 보이거나 '확인 필요'로 접는다)
 *  · 환자 관점 수납 표는 직원 정본과 상태 집합이 같다(정본이 둘로 갈라지지 않게)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPOINTMENT_STATUS_LABEL, BILLING_STATUS_LABEL, BILLING_STATUS_PATIENT_LABEL } from '../src/constants';

const schema = readFileSync(join(__dirname, '../../../apps/api/prisma/schema.prisma'), 'utf8');
const enumValues = (name: string) => {
  const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  expect(m, name).not.toBeNull();
  return m![1].split('\n').map((l) => l.replace(/\/\/.*/, '').trim()).filter(Boolean).sort();
};

describe('포털 상태 라벨 = DB enum 전부', () => {
  it('예약 상태', () => { expect(Object.keys(APPOINTMENT_STATUS_LABEL).sort()).toEqual(enumValues('AppointmentStatus')); });
  it('수납 상태 — 환자 관점 표 = 직원 정본 = DB enum', () => {
    expect(Object.keys(BILLING_STATUS_PATIENT_LABEL).sort()).toEqual(enumValues('BillingStatus'));
    expect(Object.keys(BILLING_STATUS_PATIENT_LABEL).sort()).toEqual(Object.keys(BILLING_STATUS_LABEL).sort());
  });
});
