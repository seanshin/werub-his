import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 비대면 가능 진료과 설정 화면이 설정 상태를 사실대로 말한다 — 가드(2026-08-18).
 *
 * 종전 결함: 서버가 `enabled: null`(미설정 = **전체 허용**)을 주는데도 화면이 적합도 '높음·중간'
 * 9개 과를 **선택된 것처럼** 칠하고 저장 버튼에 '9개 진료과'라고 적었다. 관리자는 "지금 외과는
 * 비대면 불가"로 읽었지만 실제로는 허용 중이었다 — 설정이 없는 것을 "특정 9개만 허용"이라고
 * 말하면 사실이 아니다(P1: 모르는 것/없는 것을 아는 것처럼 말함).
 *
 * 규약: 미설정은 '전체 허용'이라고 말한다 · 숫자는 실제 선택 개수일 때만 쓴다 ·
 *       빈 배열(아무 과도 불가)로 저장되지 않게 한다.
 */
const PAGE = join(process.cwd(), 'src', 'app', '(main)', 'remote-consult', 'page.tsx');
const src = readFileSync(PAGE, 'utf8');

describe('비대면 가능 진료과 설정 — 미설정을 제한으로 위장하지 않는다', () => {
  it('서버의 enabled=null 을 그대로 "제한 없음"으로 읽는다', () => {
    expect(src).toContain('setRestrict(!!cfg.enabled)');
    expect(src).toContain('setEnabled(new Set(cfg.enabled ?? []))');
  });

  it('🔴 미설정 상태를 권고안(적합도 높음·중간)으로 미리 칠하지 않는다', () => {
    // 권고안은 관리자가 버튼을 눌렀을 때만 채워진다 — 초기화 경로에 들어가면 안 된다
    const init = src.slice(src.indexOf('if (cfg && !initialized)'), src.indexOf('const sel = enabled'));
    expect(init).not.toContain('DEPT_CATALOG');
    expect(src).toContain('const loadRecommended = () =>');
  });

  it('🔴 화면이 두 상태를 각각 사실대로 말한다', () => {
    expect(src).toContain('제한 없음');
    expect(src).toMatch(/모든 진료과에서 비대면 진료가 가능합니다/);
    // 🔴 UI 언어 배선 후 문구는 `<b><T k="선택한 진료과만" /></b>` 형태로도 존재한다(원문=키라 검색 가능).
    expect(src).toMatch(/선택한 진료과만<\/b> 비대면 진료가 가능합니다|<b>선택한 진료과만<\/b>|<b><T k="선택한 진료과만" \/><\/b>/);
  });

  it('🔴 저장 버튼의 개수는 실제 선택 개수일 때만 쓴다', () => {
    // 🔴 배선 후 형태: `` `${tAttr('저장')} (${sel.size}${tAttr('개 진료과만 허용')})` `` — 두 형태 모두 받되,
    //    **`sel.size` 가 그 문구와 같은 자리에 있는지**를 계속 못박는다(상수를 개수처럼 쓰는 회귀 방지).
    expect(src).toMatch(/restrict \? `[^`]*\$\{sel\.size\}[^`]*개 진료과만 허용[^`]*`/);
    expect(src).toMatch(/저장 \(전체 허용\)/);
  });

  it('전체 허용은 null 로 저장한다 — 빈 배열(아무 과도 불가)과 구분한다', () => {
    expect(src).toContain('enabled: restrict ? Array.from(sel) : null');
    // 제한 모드에서 한 과도 고르지 않은 채 저장되면 아무도 비대면 진료를 못 한다
    expect(src).toMatch(/disabled=\{[^}]*restrict && sel\.size === 0/);
  });
});
