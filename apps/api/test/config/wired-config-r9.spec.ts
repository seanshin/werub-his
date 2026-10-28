import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { passwordPolicyViolations, PASSWORD_MIN_LENGTH } from '../../src/modules/auth/password-policy';

/**
 * R9 config 배선 가드 (2026-09-06) — "만든 것 ≠ 소비처가 쓰는 것"의 재발 방지.
 * 배선 4종은 소비 코드가 실재해야 하고, 제거 2종은 정본에 되살아나면 안 된다(중복 정본 재발).
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');

describe('R9 — 위급 통보 게이트는 fail-open(명시적 false 만 억제)', () => {
  it('vitals: notifyAbnormal 앞에 criticalAlert 게이트가 있고, 억제는 로그를 남긴다', () => {
    const s = stripComments(read('modules/vitals/vitals.service.ts'));
    expect(s).toContain("get('clinical.vitals.criticalAlert')");
    // 명시적 false 비교 — truthy 검사로 바꾸면 조회 실패(null)가 통보를 끈다(재주입 표적)
    expect(s).toMatch(/alertEnabled === false/);
    expect(s).toMatch(/criticalAlert=false/); // 억제 로그
  });

  it('lab: 리스너 진입부 한 곳에 criticalNotify 게이트 — 발행 4곳에 각자 끼우지 않는다', () => {
    const s = stripComments(read('modules/notification/notification.listener.ts'));
    expect(s).toContain("get('clinical.lab.criticalNotify')");
    expect(s).toMatch(/notifyEnabled === false/);
    // 발행부(lab.service)에는 게이트가 없어야 한다 — 정본 한 곳
    const lab = stripComments(read('modules/lab/lab.service.ts'));
    expect(lab).not.toContain('clinical.lab.criticalNotify');
  });
});

describe('R9 — 세션 만료·비밀번호 정책 배선', () => {
  it('auth: 로그인·회전 양쪽 발급이 security.session.timeoutMinutes 를 지난다', () => {
    const s = stripComments(read('modules/auth/auth.service.ts'));
    expect(s).toContain("get('security.session.timeoutMinutes')");
    // 로그인 발급 + refresh 회전 두 자리 모두 sessionTimeoutSeconds 를 소비
    const uses = s.match(/sessionTimeoutSeconds\(\)/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3); // 정의 1 + 소비 2
  });

  it('password: minLength 는 강화 전용 — 12 미만 설정은 적용되지 않는다(완화 불가)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    const weak = 'Aa1!Aa1!Aa1'; // 11자
    // 설정으로 완화 시도(8) → 여전히 12 하한이 이긴다
    expect(passwordPolicyViolations(weak, { minLength: 8 })).toContain('최소 12자 이상');
    // 강화(16)는 적용된다
    const twelve = 'Aa1!Aa1!Aa1!';
    expect(passwordPolicyViolations(twelve, { minLength: 16 })).toContain('최소 16자 이상');
    // 이상값·미설정은 12 유지
    expect(passwordPolicyViolations(twelve, { minLength: Number.NaN })).toEqual([]);
    expect(passwordPolicyViolations(twelve)).toEqual([]);
  });

  it('user.service: 생성·수정·초기화 세 경로 전부 정책을 지난다(update 뒷문 봉합)', () => {
    const s = stripComments(read('modules/user/user.service.ts'));
    const calls = s.match(/assertPasswordPolicy\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4); // 정의 1 + create·update·reset 3
    expect(s).toContain("get('security.password.minLength')");
  });
});

describe('R9 — 제거한 중복 정본이 되살아나지 않는다', () => {
  const defaults = read('modules/config/config-runtime.service.ts');
  it('requireSpecial·audit.retentionDays 키가 DEFAULTS 에 없다', () => {
    expect(defaults).not.toMatch(/'security\.password\.requireSpecial':\s*\{/);
    expect(defaults).not.toMatch(/'security\.audit\.retentionDays':\s*\{/);
  });
  it('대조군: 배선된 형제 키는 그대로 있다(스캔이 헛돌지 않는다)', () => {
    expect(defaults).toMatch(/'security\.password\.minLength':\s*\{/);
    expect(defaults).toMatch(/'security\.session\.timeoutMinutes':\s*\{/);
  });
});

describe('R4 — code-blue 최소권한·통계 정직성', () => {
  it('GET 3종(stats·목록·rrt 목록)에 @Roles 가 있다 — 누락 시 전 직군 열람(실측 재발 방지)', () => {
    const s = read('modules/code-blue/code-blue.controller.ts');
    // @Get 데코레이터 수와, 각 @Get 블록 안 @Roles 수를 대조
    const gets = s.match(/@Get\(/g) ?? [];
    expect(gets.length).toBe(3);
    // 각 @Get 뒤 @ApiOperation 전에 @Roles 가 등장해야 한다
    const blocks = s.split(/@Get\(/).slice(1);
    for (const b of blocks) {
      const head = b.split('async')[0];
      expect(head).toContain('@Roles(');
    }
  });

  it('stats: 표본 0 이면 roscRate 는 0% 가 아니라 null(산출 불가)', () => {
    const s = stripComments(read('modules/code-blue/code-blue.service.ts'));
    expect(s).toMatch(/roscRate:\s*total\s*\?[^:]+:\s*null/);
    expect(s).toContain('arrivalsN'); // 평균의 분모 병기
  });
});
