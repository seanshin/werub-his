import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 경보 등록부의 내장 액션(actionHref)은 **실제로 있는 화면**을 가리켜야 한다(기획서 alert-registry §5.1 "무엇을 하면 꺼지는가").
 * 정본은 api 의 `alert-registry.ts` — web 은 그 값을 소비만 한다(정본이 둘이 되지 않게 파일을 직접 읽어 대조).
 * 재주입: 등록부에 `/no-such-page` 를 넣으면 실패한다.
 */
describe('경보 등록부 actionHref → 화면 존재', () => {
  const REG = path.join(__dirname, '..', '..', '..', 'api', 'src', 'modules', 'notification', 'alert-registry.ts');
  const APP = path.join(__dirname, '..', '..', 'src', 'app');
  /**
   * 🔴 2026-08-20 확장 — **환자 대상 알림은 스태프 웹이 아니라 환자 앱으로 간다.**
   * 환자 푸시 4종이 등재되면서 `/(tabs)/…`(expo-router) 를 가리켰고, 웹만 보던 이 가드가
   * "화면이 없다"고 실패했다. 실재 여부는 `apps/mobile/app/(tabs)/<name>.tsx` 로 확인한다 —
   * 가드를 느슨하게 푼 것이 아니라 **찾는 자리를 맞춘 것**이다(없는 모바일 화면은 여전히 실패한다).
   */
  const MOBILE = path.join(__dirname, '..', '..', '..', 'mobile', 'app');
  const resolves = (h: string) =>
    h.startsWith('/(tabs)/')
      ? fs.existsSync(path.join(MOBILE, `${h.slice(1)}.tsx`)) || fs.existsSync(path.join(MOBILE, h.slice(1), 'index.tsx'))
      : fs.existsSync(path.join(APP, '(main)', h.slice(1), 'page.tsx')) || fs.existsSync(path.join(APP, h.slice(1), 'page.tsx'));

  it('모든 actionHref 가 (main)·최상위 라우트 또는 환자 앱 탭으로 해석된다', () => {
    const src = fs.readFileSync(REG, 'utf8');
    const hrefs = [...new Set([...src.matchAll(/actionHref:\s*'([^']+)'/g)].map((m) => m[1]))];
    expect(hrefs.length, '등록부에서 actionHref 를 하나도 못 읽었다 — 정본 파일 위치가 바뀌었는가').toBeGreaterThan(10);
    const missing = hrefs.filter((h) => !resolves(h));
    expect(missing, `경보 액션이 가리키는 화면이 없다:\n${missing.join('\n')}`).toEqual([]);
  });

  it('🔴 환자 앱 탭도 실재를 확인한다 — 없는 탭을 가리키면 잡는다', () => {
    expect(resolves('/(tabs)/notifications')).toBe(true);
    expect(resolves('/(tabs)/no-such-tab')).toBe(false);
  });
});
