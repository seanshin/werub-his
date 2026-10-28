import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { StaffDocumentController } from '../../src/modules/medical-record-issuance/staff-document.controller';

/**
 * 원무 창구 접수(2026-10-10 사용자 결정) — 원무(RECEPTIONIST)에게 **접수와 대기 목록만** 연다.
 * 🔴 상세·초안·작성·서명·발급·거절·수령은 원무에게 열리지 않는다(RolesGuard: 핸들러 @Roles 가 있으면 그것만, 없으면 클래스).
 */
const proto = StaffDocumentController.prototype as unknown as Record<string, unknown>;
const rolesOf = (handler: string): UserRole[] =>
  Reflect.getMetadata(ROLES_KEY, proto[handler] as object) ?? Reflect.getMetadata(ROLES_KEY, StaffDocumentController) ?? [];

describe('원무 창구 — 접수·대기 목록만', () => {
  it('접수(createRequest)·대기 목록(queue)은 원무 포함 · 기존 역할 유지', () => {
    for (const h of ['createRequest', 'queue']) {
      expect(rolesOf(h)).toEqual(expect.arrayContaining([UserRole.RECEPTIONIST, UserRole.NURSE, UserRole.DOCTOR, UserRole.MEDICAL_RECORDS]));
    }
  });
  it('🔴 나머지 처리 단계는 원무에게 열리지 않는다(대조군 — 전 핸들러를 센다)', () => {
    const handlers = Object.getOwnPropertyNames(StaffDocumentController.prototype).filter((n) => n !== 'constructor' && typeof proto[n] === 'function');
    expect(handlers.length).toBeGreaterThan(5);
    const opened = handlers.filter((h) => rolesOf(h).includes(UserRole.RECEPTIONIST));
    expect(opened.sort()).toEqual(['createRequest', 'queue']);
  });
});
