/**
 * 🔴 알레르기 확인 상태 EP 의 역할 목록은 **shared 정본 하나** — 2026-08-27 신설.
 *
 * 실측 배경: 화면(회진 보드·간호 타블렛·원격진료 패널)에 4상태 배지를 붙이자
 * `LAB_TECH·RECEPTIONIST·MEDICAL_RECORDS·CHECKUP` 이 **403** 을 받았다.
 * 그런데 같은 역할들이 `/patients/:id/summary` 로는 **알레르기 목록을 그대로 받고 있었다** —
 * 목록은 주면서 "확인 상태"만 막는 상태였다.
 *
 * 조치: 화면은 **권한이 없으면 부르지 않는다**(403 을 "확인 못 함"으로 그리면 시스템 장애처럼 읽히고,
 * 목록에 알레르기가 있는데도 경고가 약해진다). 그 판단의 근거가 FE·API 두 곳에 적히면 갈라지므로
 * `ALLERGY_STATUS_ROLES` 하나를 양쪽이 쓴다.
 *
 * 재주입: 컨트롤러의 `@Roles` 를 리터럴 목록으로 되돌리면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ALLERGY_STATUS_ROLES, canReadAllergyStatus } from '@hospital-run/shared';

const CONTROLLER = path.join(__dirname, '..', '..', 'src', 'modules', 'allergy', 'allergy.controller.ts');

describe('알레르기 확인 상태 — 역할 목록 정본', () => {
  const src = fs.readFileSync(CONTROLLER, 'utf8');
  /** `@Get('status')` 바로 다음의 `@Roles(...)` 한 줄 */
  const statusRoles = (() => {
    const i = src.indexOf("@Get('status')");
    expect(i, "컨트롤러에서 @Get('status') 를 못 찾았다").toBeGreaterThan(-1);
    const seg = src.slice(i, i + 600);
    return /@Roles\(([^)]*)\)/.exec(seg)?.[1] ?? '';
  })();

  it('🔴 status EP 의 @Roles 는 리터럴이 아니라 shared 정본을 쓴다', () => {
    expect(
      statusRoles.includes('ALLERGY_STATUS_ROLES'),
      `@Roles 가 shared 정본을 쓰지 않는다(현재: ${statusRoles}) — FE 와 갈라진다`,
    ).toBe(true);
    // 리터럴 역할을 함께 적어두면 그것이 조용히 정본을 넘어선다
    expect(statusRoles).not.toMatch(/UserRole\./);
  });

  it('정본이 임상 4역할이다 (2026-08-27 실측 — 바꾸려면 여기도 함께 바꾼다)', () => {
    expect([...ALLERGY_STATUS_ROLES].sort()).toEqual(['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST']);
  });

  it('🔴 대조군 — 403 을 받던 직군은 정본에서도 거짓이다(무조건 참을 반환하지 않는다)', () => {
    for (const r of ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN']) expect(canReadAllergyStatus(r)).toBe(true);
    for (const r of ['LAB_TECH', 'RECEPTIONIST', 'MEDICAL_RECORDS', 'CHECKUP', 'NUTRITION', 'READ', '', null, undefined]) {
      expect(canReadAllergyStatus(r), `${r} 는 status 를 읽지 못한다`).toBe(false);
    }
  });
});
