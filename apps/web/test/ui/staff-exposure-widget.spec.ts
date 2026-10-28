import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 직원 노출 사고 위젯 — 인계 잔여 갭 회수(2026-08-18).
 *
 * 서버 `GET /api/v1/infection-control/dashboard` 는 `staffSafety`(+`zeroMeaning`) 를 내려주는데
 * **읽는 위젯이 없었다**("EP 를 만들면 부르는 화면까지가 한 벌"). 위젯을 붙이면서 같이 지킬 것:
 *   ① 0 을 "사고 없음"이라 말하지 않는다 — 0 의 뜻은 서버 `zeroMeaning` 이 정한다.
 *   ② 조회 실패를 0 건·빈 값으로 접지 않는다.
 *   ③ 레지스트리에 등재돼 실제로 배치할 수 있어야 한다(고아 위젯 금지).
 */
const ROOT = join(process.cwd(), 'src', 'app', '(main)', 'dashboard', 'components');
const WIDGET = join(ROOT, 'widgets', 'ext', 'StaffExposureWidget.tsx');
const REGISTRY = join(ROOT, 'widget-registry.ts');

const src = readFileSync(WIDGET, 'utf8');
const registry = readFileSync(REGISTRY, 'utf8');
/** 🔴 주석에는 금지 문구를 설명하는 문장이 들어 있다 — 스캔 전에 제거한다 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('직원 노출 사고 위젯', () => {
  it('레지스트리에 등재돼 있다(배치 가능)', () => {
    expect(registry).toContain("id: 'staff-exposure'");
    expect(registry).toContain('StaffExposureWidget');
  });

  it('서버의 staffSafety 블록을 읽는다', () => {
    expect(code).toContain('staffSafety');
    expect(code).toContain('/api/v1/infection-control/dashboard');
  });

  it('🔴 0 의 의미는 서버 zeroMeaning 을 쓴다', () => {
    expect(code).toContain('zeroMeaning');
  });

  it('🔴 "사고 없음"으로 단정하지 않는다', () => {
    expect(code).not.toMatch(/사고\s*없음/);
    expect(code).not.toMatch(/노출\s*없음/);
  });

  it('🔴 조회 실패를 데이터 없음/0 건으로 접지 않는다', () => {
    expect(code).toMatch(/if\s*\(error\)/);
    expect(code).toContain('조회 실패');
  });

  it('🔴 못 읽은 값을 0 으로 채우지 않는다(?? 0 금지)', () => {
    expect(code).not.toMatch(/\?\?\s*0\b/);
  });

  it('권한 없는 사용자에게 0 을 보여주지 않는다(WidgetForbidden 분기)', () => {
    expect(code).toContain('WidgetForbidden');
  });
});
