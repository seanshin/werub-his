import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 규약: **조회 실패를 영구 로딩으로 굳히지 않는다**(CLAUDE.md 임상 UX 규약 §2.1).
 *
 * 2026-08-25 사람 신고 — 새 창에서 스피너만 계속 돌았고, 사용자는 이유를 알 수 없었다.
 * `(main)` 레이아웃의 인증 확인 분기는 **전 직군의 모든 화면**이 지나는 자리라
 * 여기서 침묵하면 아무 화면도 이유를 말하지 못한다.
 */
const LAYOUT = join(process.cwd(), 'src/app/(main)/layout.tsx');

describe('인증 확인이 오래 걸리면 화면이 그 사실을 말한다', () => {
  const src = readFileSync(LAYOUT, 'utf8');

  it('오래 걸림을 판정하는 타이머가 있다(스피너만 두지 않는다)', () => {
    expect(src).toMatch(/setAuthSlow\(true\)/);
    expect(src).toMatch(/setTimeout\(/);
  });

  it('오래 걸리면 사실 문장과 빠져나갈 경로를 준다', () => {
    expect(src).toContain('로그인 상태를 확인하지 못하고 있습니다');
    expect(src).toContain('다시 시도');
    expect(src).toContain('/login');
  });

  it('🔴 로딩이 끝나면 그 표시를 내린다(끝났는데 "확인 못 함"이라 말하지 않는다)', () => {
    expect(src).toMatch(/if \(!isLoading\) \{ setAuthSlow\(false\); return; \}/);
  });

  it('대조군 — 스피너 자체는 그대로 있다(로딩 중임을 숨기지 않는다)', () => {
    expect(src).toContain('animate-spin');
  });
});
