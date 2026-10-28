import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { PrescriptionController } from '../../src/modules/prescription/prescription.controller';

/**
 * 약 선택 즉시 DUR(사전점검) — 2026-09-30 사람 질문 "약제 선택 시 DUR 을 실시간 운용하려면?".
 * 🔴 엔진·화면 호출은 이미 있었는데 EP 만 DOCTOR 전용이라, 처방을 입력하는 관리자·간호사(대리 입력)·치료사는
 *    약을 고를 때마다 403 → 실시간 DUR 이 한 번도 돌지 않았다. 처방 생성과 같은 역할이어야 한다.
 */
const rolesOf = (m: keyof PrescriptionController) =>
  (Reflect.getMetadata(ROLES_KEY, PrescriptionController.prototype[m] as object) ?? []) as string[];

describe('DUR 사전점검 역할 = 처방 생성 역할', () => {
  it('처방을 낼 수 있는 역할은 약을 고를 때 DUR 도 돌릴 수 있다', () => {
    const create = rolesOf('create' as keyof PrescriptionController);
    const check = rolesOf('checkDur');
    expect(create.length).toBeGreaterThan(0);
    for (const r of create) expect(check, `처방 생성은 ${r} 에 열려 있는데 DUR 사전점검은 막혀 있다`).toContain(r);
  });
  it('대조군 — 처방 권한이 없는 역할(원무)은 열지 않는다', () => {
    expect(rolesOf('checkDur')).not.toContain('RECEPTIONIST');
  });
});
