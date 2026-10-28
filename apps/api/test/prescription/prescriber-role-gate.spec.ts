import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 역할별 처방 입력 계약 — 2026-07-31.
 *
 * 모델: **입력은 열되 책임은 의사**. 간호사(구두처방 대리입력)·임상병리사(워크인 검사 등록)가
 * 처방을 입력할 수 있지만, 처방 주체(prescriberId)는 반드시 의사여야 하고 그 의사의 승인을 거친다.
 *
 * 🔴 여기서 지키는 것: **규칙이 꺼져 있어도(fail-closed)** 대리입력자가 책임 처방자로 기록되지 않는다.
 *    종전 `resolvePrescriber` 는 `rules.enabled === false` 면 무조건 작성자 본인을 처방자로 저장했다.
 *    비의사에게 EP 를 열면서 그 분기를 그대로 뒀다면, 간호사 명의 처방이 그대로 저장됐을 것이다.
 */
const svc = readFileSync(join(process.cwd(), 'src/modules/prescription/prescription.service.ts'), 'utf-8');
const ctrl = readFileSync(join(process.cwd(), 'src/modules/prescription/prescription.controller.ts'), 'utf-8');

/** 처방 생성 EP 의 @Roles 목록 */
function createRoles(): string[] {
  const i = ctrl.indexOf("@Post('encounters/:encounterId/prescriptions')");
  expect(i).toBeGreaterThan(-1);
  const window = ctrl.slice(i, ctrl.indexOf('async ', i));
  const m = /@Roles\(([^)]*)\)/s.exec(window);
  return m ? [...m[1].matchAll(/UserRole\.(\w+)/g)].map((x) => x[1]) : [];
}

/** resolvePrescriber 본문 */
function resolveBody(): string {
  const i = svc.indexOf('private async resolvePrescriber(');
  expect(i).toBeGreaterThan(-1);
  return svc.slice(i, svc.indexOf('\n  }', svc.indexOf('return prescriberId;', i)));
}

describe('처방 입력 역할', () => {
  it('간호사·임상병리사도 입력 EP 에 들어올 수 있다', () => {
    const roles = createRoles();
    expect(roles).toContain('NURSE');
    expect(roles).toContain('LAB_TECH');
    expect(roles).toContain('DOCTOR');
  });

  it('약사·CRM 등 다른 역할까지 열리지는 않았다', () => {
    const roles = createRoles();
    expect(roles).not.toContain('PHARMACIST');
    expect(roles).not.toContain('CRM');
    expect(roles).not.toContain('EXECUTIVE');
  });
});

describe('책임 처방의 강제(fail-closed)', () => {
  const body = resolveBody();

  it('🔴 비처방 역할 판정이 rules.enabled 분기보다 **먼저** 온다', () => {
    const gate = body.indexOf('actorMayPrescribe');
    const enabledShortCircuit = body.indexOf('if (!rules.enabled) return actingUserId;');
    expect(gate).toBeGreaterThan(-1);
    expect(enabledShortCircuit).toBeGreaterThan(-1);
    // 순서가 뒤집히면 규칙 OFF 상태에서 간호사가 처방자로 저장된다
    expect(gate).toBeLessThan(enabledShortCircuit);
  });

  it('비처방 역할은 지정 처방의가 없으면 거부한다', () => {
    expect(body).toContain('PRESCRIBER_REQUIRED');
  });

  it('자기 자신을 처방의로 지정하는 우회를 막는다', () => {
    expect(body).toMatch(/target === actingUserId/);
  });

  it('지정 처방의 자격(역할·담당 의료군)을 검증한다', () => {
    expect(body).toContain('assertPrescriberEligible');
  });

  it('🔴 지정 처방의의 승인 토큰 없이는 통과할 수 없다', () => {
    expect(body).toContain('PRESCRIBER_AUTH_REQUIRED');
    // 토큰 주체가 지정 처방의여야 한다 — 입력자 토큰으로 우회 불가
    expect(body).toMatch(/consume\(prescriberStepUpToken, target, 'PRESCRIPTION_CREATE'/);
  });

  it('🔴 승인 토큰이 처방 내용에 바인딩돼 있어야 한다(승인한 약과 저장한 약이 달라지는 것 차단)', () => {
    expect(body).toContain('bodyHash');
    expect(body).toContain('STEPUP_BODY_UNBOUND');
  });

  it('ADMIN 은 종전 동작(본인 명의)을 유지한다 — 운영 계정', () => {
    expect(body).toMatch(/actor\.role === 'ADMIN'/);
  });
});
