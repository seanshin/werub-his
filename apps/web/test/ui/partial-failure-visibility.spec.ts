import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 조회 실패를 "없음"으로 번역하지 않는다 — 재검토에서 남아 있던 두 자리.
 *
 * 🔴 2026-09-02 재검토: 배포자(딜러) 포털은 대시보드 8개 조회가 전부 `.catch(() => null/[])` 였다.
 *    딜러 화면에는 재고·판매·정산·수령대기가 **모두 0** 으로 보이고, 그것이 조회 실패인지 진짜 0인지
 *    알 방법이 없었다(세션이 끊겨도 화면은 텅 빈 채 로그인 상태로 남는다).
 *
 * 🔴 배식 확인(5-Rights)은 서버가 돌려주기 시작했는데(`284840b1`) **데스크탑 급식 화면은 그리지 않았다** —
 *    만든 것과 소비처가 쓰는 것은 다른 일이다. 태블릿만 고치고 끝냈으면 병동 화면은 그대로 못 봤다.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('배포자 포털 — 실패를 없음으로 말하지 않는다', () => {
  const src = code(read('app', 'distributor', 'page.tsx'));

  it('🔴 대시보드 조회가 실패를 삼키지 않는다(.catch(() => null/[]) 부재)', () => {
    expect(src).not.toMatch(/\.catch\(\(\)\s*=>\s*(null|\[\])\)/);
  });

  it('실패 항목을 모아 화면에 말한다', () => {
    expect(src).toContain('loadFailed');
    expect(src).toContain('없음&rdquo;이 아닙니다');
  });

  it('🔴 401 은 다른 사실이다 — 세션 만료를 구분해 재로그인을 안내한다', () => {
    expect(src).toContain('sessionExpired');
    expect(src).toContain('HTTP_UNAUTHORIZED');
    expect(src).toMatch(/HTTP_UNAUTHORIZED\s*=\s*401/);
  });

  it('대조군: 재시도 경로가 있다(될 수 없는 행동만 남기지 않는다)', () => {
    expect(src).toMatch(/다시 시도|다시 로그인/);
  });
});

describe('배식 확인 — 급식을 나열하는 화면은 모두 그린다', () => {
  it.each([
    ['태블릿', ['app', 'tablet', 'nutrition', 'page.tsx'], 'DeliveryCheckLine'],
    ['데스크탑 급식 현황', ['app', '(main)', 'nutrition', 'page.tsx'], 'DeliveryCheckCell'],
  ])('%s 화면이 deliveryCheck 를 렌더한다', (_label, path, comp) => {
    const src = code(read(...path));
    expect(src).toContain(`<${comp}`);
    expect(src).toContain('deliveryCheck');
  });

  it('🔴 기록 없음과 미확인을 구분해 그린다', () => {
    const src = code(read('app', '(main)', 'nutrition', 'page.tsx'));
    expect(src).toContain('기록 없음');       // c == null
    expect(src).toContain('line-through');    // false 항목
  });
});
