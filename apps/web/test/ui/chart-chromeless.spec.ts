import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 기록 한 건을 눌러 들어온 창(`?only=1`)은 **그 기록이 있는 영역만** 그린다.
 *
 * 🔴 2026-08-25 사람 신고 — 시계열의 '자료 ↗ → 원본 화면에서 보기' 로 들어왔는데
 *    환자 헤더·탭 목록·되돌아가기까지 다 나왔다. "이렇게 눌러 들어왔으니 진료이력만 보이게".
 *
 * 🔴 `focus`(사이드바 제거)와 **다른 축**이다 — focus 는 화면 밖, only 는 화면 안이다.
 *    둘을 한 파라미터로 합치면 상단 바 ⤢(전체 차트를 넓게 보기)까지 탭이 사라진다.
 */
const CHART = join(process.cwd(), 'src/app/(main)/patients/[id]/page.tsx');

describe('기록 단건 창은 그 영역만 그린다 (only=1)', () => {
  const src = readFileSync(CHART, 'utf8');

  it('only=1 을 읽어 chromeless 로 판정한다', () => {
    expect(src).toMatch(/get\('only'\) === '1'/);
  });

  it('되돌아가기·환자 헤더·탭 목록·사이드 레일이 모두 게이트 뒤에 있다', () => {
    // 감싼 자리마다 `{!chromeless && (` 가 있어야 한다 — 하나라도 빠지면 그 장치가 남는다
    const gates = src.match(/\{!chromeless &&/g) ?? [];
    expect(gates.length, '게이트가 4곳(되돌아가기·안전존·탭바·레일) 있어야 한다').toBeGreaterThanOrEqual(4);
  });

  it('🔴 대조군 — 기본(only 없음)에서는 그 장치들이 그대로 남는다', () => {
    // 게이트가 `!chromeless` 조건부여야 하고, 무조건 제거(주석/삭제)가 아니어야 한다
    expect(src).toContain('환자 목록');           // 되돌아가기 링크 자체는 남아 있다
    expect(src).toContain('Tab Bar');             // 탭 바도 남아 있다
    expect(src).not.toMatch(/\{false &&/);        // 통째로 꺼두지 않았다
  });

  it('focus 와 only 는 다른 파라미터다(합치지 않는다)', () => {
    const link = readFileSync(join(process.cwd(), 'src/lib/focus-link.ts'), 'utf8');
    expect(link).toContain("params.set('focus', '1')");
    expect(link).toContain("params.set('only', '1')");
  });
});
