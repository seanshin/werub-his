/**
 * 🔴 (2026-09-14) 원격진료 환자 대기실 입장·환자 메시지 EP 에 @Roles 가 없어 모든 인증 직원이 부를 수 있었다.
 * 지키는 것: 두 핸들러가 세션 관리 역할(DOCTOR·NURSE·ADMIN)로 제한된다 · 대조군 — doctor-reply 는 종전대로 DOCTOR·ADMIN.
 */
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { TelehealthController } from '../../src/modules/telehealth/telehealth.controller';

const roles = (h: keyof TelehealthController) => new Reflector().get<string[]>(ROLES_KEY, TelehealthController.prototype[h] as any);

describe('원격진료 환자 대리 입력 EP 역할', () => {
  it.each(['patientJoin', 'submitPatientMessage'] as const)('%s 는 DOCTOR·NURSE·ADMIN 만', (h) => {
    expect([...(roles(h) ?? [])].sort()).toEqual(['ADMIN', 'DOCTOR', 'NURSE']);
  });
  it('대조군 — submitDoctorReply 는 DOCTOR·ADMIN', () => {
    expect([...(roles('submitDoctorReply') ?? [])].sort()).toEqual(['ADMIN', 'DOCTOR']);
  });
});
