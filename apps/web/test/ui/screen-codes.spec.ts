import { describe, it, expect } from 'vitest';

import { SCREEN_REGISTRY, SCREEN_BY_CODE, SCREEN_CODE_CONFLICTS, SCREEN_CODE_UNFROZEN, SCREEN_CODE_ORPHANS, OFF_NAV_SCREENS } from '@/components/layout/Sidebar';
import { SCREEN_CODE_FROZEN } from '@/components/layout/screen-codes.frozen';

/**
 * 화면번호 무결성 가드 (2026-08 W7)
 *
 * 🔴 배경: 미고정 화면 62개가 `(10+섹션)*100+항목` 폴백으로 굴러가며 **고정번호와 38건 충돌**했다.
 *    1000=/dashboard 인데 /command-center 로, 2900=/settings/my-certificate 인데 /ess 로 가는 식으로
 *    사람이 외운 번호가 다른 화면을 열었다. 중복 경고는 `NODE_ENV!=='production'` 안에 있어
 *    **운영에서만 조용**했다 → 기계 검사로 못 박는다(환경 무관).
 */
describe('화면번호(screen-codes) 무결성', () => {
  it('중복 화면번호가 하나도 없다', () => {
    const detail = SCREEN_CODE_CONFLICTS.map((c) => `${c.code}: ${c.hrefs.join(' ↔ ')}`).join('\n');
    expect(SCREEN_CODE_CONFLICTS, `중복 화면번호:\n${detail}`).toHaveLength(0);
  });

  it('nav 의 모든 화면이 freeze 맵에 등재되어 있다(임시 9xxx 배포 금지)', () => {
    const detail = SCREEN_CODE_UNFROZEN.map((e) => `${e.href}(임시 ${e.code}·${e.section})`).join('\n');
    expect(SCREEN_CODE_UNFROZEN, `screen-codes.frozen.ts 등재 필요:\n${detail}`).toHaveLength(0);
  });

  it('임시 코드(9xxx 예약대역)는 고정 대역과 겹치지 않는다', () => {
    const frozenIn9xxx = Object.entries(SCREEN_CODE_FROZEN).filter(([, code]) => code.startsWith('9'));
    expect(frozenIn9xxx, '9xxx 는 미고정 임시 코드 전용 대역이다').toHaveLength(0);
  });

  it('코드 정본 맵(SCREEN_BY_CODE)과 레지스트리가 1:1 이다 — 제안 목록과 이동 대상이 갈리지 않는다', () => {
    expect(Object.keys(SCREEN_BY_CODE)).toHaveLength(SCREEN_REGISTRY.length);
    for (const e of SCREEN_REGISTRY) expect(SCREEN_BY_CODE[e.code]?.href).toBe(e.href);
  });

  /**
   * 🔴 2026-08-21 재주입 검증: OFF_NAV_SCREENS 에서 한 줄을 지우면 이 테스트가 실패한다.
   *    종전 레지스트리는 NAV_SECTIONS 만 훑어서, freeze 에 코드를 적어도 `SCREEN_BY_CODE` 에 담기지 않았다 —
   *    `/compounding`(1209)·`/workstation/triage`(1720)·`/admin/reference-ranges`(3134) 3건이 그 상태로
   *    **코드는 있는데 번호를 쳐도 이동하지 않았다**. 사람은 그것을 오타로 읽는다.
   */
  it('freeze 의 모든 코드가 레지스트리에서 해석된다 — "코드는 있는데 안 가는" 화면 0', () => {
    expect(SCREEN_CODE_ORPHANS, `레지스트리 미등재 freeze:\n${SCREEN_CODE_ORPHANS.join('\n')}`).toHaveLength(0);
  });

  it('OFF_NAV_SCREENS 는 nav 와 겹치지 않는다 — 정본이 둘이 되지 않는다', () => {
    const navHrefs = new Set(SCREEN_REGISTRY.filter((e) => !OFF_NAV_SCREENS.some((o) => o.href === e.href)).map((e) => e.href));
    const dup = OFF_NAV_SCREENS.filter((o) => navHrefs.has(o.href)).map((o) => o.href);
    expect(dup, `사이드바에 이미 있는 화면:\n${dup.join('\n')}`).toHaveLength(0);
  });

  it('화면번호는 4자리 숫자다', () => {
    for (const e of SCREEN_REGISTRY) expect(e.code, e.href).toMatch(/^\d{4}$/);
  });
});

/**
 * nav 노출 ↔ API 권한 정합 (dead-menu 도 결함이다).
 * 서버 @Roles 를 여기 옮겨 적어 **한쪽만 바뀌면 실패**하게 한다.
 */
describe('nav 역할 ↔ API 역할 정합', () => {
  const expected: Record<string, string[]> = {
    // voice-emr.controller: @Roles(DOCTOR, ADMIN, NURSE) — 전 EP 동일
    '/settings/voice': ['ADMIN', 'DOCTOR', 'NURSE'],
    // user.controller me/signature: ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH
    '/settings/my-signature': ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH'],
    // blockchain-cert.controller my/issue/renew: DOCTOR·NURSE·ADMIN·PHARMACIST
    '/settings/my-certificate': ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST'],
    // code-master clinical-review: DOCTOR·NURSE·PHARMACIST·LAB_TECH(+ADMIN 조회)
    '/mapping-review': ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH'],
  };

  for (const [href, roles] of Object.entries(expected)) {
    it(`${href} 의 nav 역할이 API 와 같다`, () => {
      const entry = SCREEN_REGISTRY.find((e) => e.href === href);
      expect(entry, `${href} 가 nav 에 없다`).toBeTruthy();
      expect([...entry!.roles].sort()).toEqual([...roles].sort());
    });
  }

  it('READ(조회전용) 계정에도 보이는 화면이 있다 — nav 통째 공백 금지', () => {
    const readable = SCREEN_REGISTRY.filter((e) => e.roles.includes('READ'));
    expect(readable.length).toBeGreaterThan(0);
    // ess.controller 는 클래스 @Roles 에 READ 를 포함한다 — 실제로 열리는 화면이어야 한다.
    expect(readable.map((e) => e.href)).toContain('/ess');
  });
});
