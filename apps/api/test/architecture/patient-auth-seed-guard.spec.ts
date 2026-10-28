import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **환자 인증 시드 EP 가 운영에 무인증 공개돼 있었다** (2026-08-31 실측: 201).
 *
 * "개발용" 시드 4개(`seed-test-accounts` 등)가 클래스 레벨 가드 없이(개별 `@UseGuards` 만)
 * 열려 있어, 운영에서 **누구나 공용 비밀번호(`patient1234!`)로 테스트 환자 계정을 생성**할 수
 * 있었다. dev-demo 선례대로 직원 관리자 인증을 요구한다.
 */
const src = readFileSync(
  join(process.cwd(), 'src/modules/patient-auth/patient-auth.controller.ts'), 'utf8');

describe('🔴 시드 EP 는 관리자 인증 뒤에 있다', () => {
  const SEEDS = ['seed-test-accounts', 'seed-outpatient-journey', 'seed-consent-data', 'seed-checkup-journey'];

  for (const seed of SEEDS) {
    it(`${seed} — JwtAuthGuard·RolesGuard·@Roles(ADMIN) 가 붙어 있다`, () => {
      const i = src.indexOf(`@Post('${seed}')`);
      expect(i, `${seed} 를 찾지 못했다`).toBeGreaterThan(-1);
      const blk = src.slice(i, i + 260);
      expect(blk, `${seed} 가 무가드다`).toMatch(/@UseGuards\(JwtAuthGuard, RolesGuard\)/);
      expect(blk).toMatch(/@Roles\(UserRole\.ADMIN\)/);
    });
  }

  it('🔴 환자 로그인·가입은 그대로 공개다(대조군 — 시드만 막았다)', () => {
    const i = src.indexOf("@Post('login')");
    expect(src.slice(i, i + 200), '로그인에 직원 가드가 붙었다').not.toMatch(/JwtAuthGuard, RolesGuard/);
  });
});
