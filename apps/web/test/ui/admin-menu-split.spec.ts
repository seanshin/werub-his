import { describe, it, expect } from 'vitest';
import { NAV_SECTIONS, SECTION_META, SCREEN_REGISTRY, SCREEN_CODE_BY_HREF } from '@/components/layout/Sidebar';

/**
 * 시스템 관리 메뉴 **개원 전 / 운영** 분리 — 2026-08-28.
 *
 * 🔴 이 분리는 **표시 분류**다. 권한이 아니다(§규약 5: nav 숨김 ≠ 권한 회수).
 * 🔴 위험 셋: ①옮기다 항목을 잃는다 ②같은 화면이 두 곳에 뜬다 ③번호가 바뀐다.
 */
const SETUP = '개원 전 시스템 관리';
const OPS = '운영 시스템 관리';

const sec = (t: string) => NAV_SECTIONS.find((s) => s.title === t);
const hrefs = (t: string) => (sec(t)?.items ?? []).map((i) => i.href);

describe('두 섹션이 실재한다', () => {
  it('개원 전 · 운영 두 섹션이 있고 비어 있지 않다', () => {
    expect(sec(SETUP), SETUP).toBeTruthy();
    expect(sec(OPS), OPS).toBeTruthy();
    expect(hrefs(SETUP).length).toBeGreaterThan(10);
    expect(hrefs(OPS).length).toBeGreaterThan(10);
  });

  it('🔴 옛 "관리자" 섹션은 남아 있지 않다 — 남으면 같은 화면이 두 곳에 뜬다', () => {
    expect(NAV_SECTIONS.some((s) => s.title === '관리자')).toBe(false);
    expect(SECTION_META['관리자']).toBeUndefined();
  });

  it('두 섹션 모두 SECTION_META 에 등재돼 있다 — 없으면 메뉴 허브에서 사라진다', () => {
    for (const t of [SETUP, OPS]) {
      expect(SECTION_META[t], t).toBeTruthy();
      expect(SECTION_META[t].domain).toBe('system');
      expect(SECTION_META[t].key, `${t} 허브 키`).toBeTruthy();
    }
    // 🔴 허브 키가 겹치면 `/menu/<key>` 가 한쪽만 보여준다
    expect(SECTION_META[SETUP].key).not.toBe(SECTION_META[OPS].key);
  });
});

describe('🔴 옮기면서 잃지 않는다', () => {
  it('같은 화면이 두 섹션에 동시에 있지 않다', () => {
    const dup = hrefs(SETUP).filter((h) => hrefs(OPS).includes(h));
    expect(dup).toEqual([]);
  });

  it('🔴 두 섹션 합계 기준선 — 조용히 줄면 실패한다', () => {
    // 2026-08-28 실측: 옛 '관리자' 62 + `/admin/opening` 1 = 63
    // 2026-09-02: + `/admin/sentinel`(상시 감시 관제) 1 = 64
    // 2026-09-06: + `/admin/break-glass`(응급 접근 사후검토 · gap-remediation R2) 1 = 65
    // 2026-09-06 R-W2: + `/admin/device-recall`·`/admin/retention` 2 = 67
    // 2026-09-07 i18n P1: + `/admin/ui-locale` 1 = 68
    // 2026-09-09 AI 감독 P2: + `/admin/ai-oversight`(제안 수용·수정·거부·만료 관제) 1 = 69
    // 2026-09-13 상용 릴리즈 T10-7: + `/admin/legal-hold`(법적 보존명령 · 3412) 1 = 70
    // 2026-09-28 +1: `/admin/space-assets`(공간 자산 배치 · 3413) = 71
    // 2026-09-28 +1: `/admin/space-model`(공간 도면 · 3414) = 72
    // 2026-10-07 +1: `/admin/vitals-standard`(활력 표시 표준 · 3415) = 73
    // 2026-10-09 +1: `/admin/wifi-location`(무선 위치 · 3416) = 74
    // 2026-10-21 +1: `/admin/clinical-rules`(임상 규칙 대장 · 3417) = 75
    // 2026-10-26 +1: `/admin/nursing-rules`(간호 원내 규정 · 3418) = 76
    const BASELINE = 76;
    expect(hrefs(SETUP).length + hrefs(OPS).length).toBe(BASELINE);
  });

  it('개원 축의 입구가 nav 에 있다 — 번호로만 가는 화면이 아니다', () => {
    expect(hrefs(SETUP)).toContain('/admin/opening');
  });
});

describe('🔴 번호는 바뀌지 않는다 — 섹션 이동은 주소가 아니다', () => {
  it('이동한 화면들의 화면번호가 동결값 그대로다', () => {
    // 대표 표본 — 두 섹션에서 하나씩(전체는 screen-codes.spec 이 본다)
    expect(SCREEN_CODE_BY_HREF['/admin/go-live']).toBe('3140');
    expect(SCREEN_CODE_BY_HREF['/admin/rbac']).toBe('3159');
    expect(SCREEN_CODE_BY_HREF['/admin/opening']).toBe('3167');
  });

  it('레지스트리에 중복 등재가 생기지 않았다', () => {
    const all = SCREEN_REGISTRY.map((e) => e.href);
    const seen = new Set<string>(); const dup: string[] = [];
    for (const h of all) { if (seen.has(h)) dup.push(h); seen.add(h); }
    expect(dup).toEqual([]);
  });
});

describe('🔴 분류가 권한을 바꾸지 않는다', () => {
  it('개원 전 섹션이 임상 역할에게 열리지 않는다(옮기며 roles 를 넓히지 않았다)', () => {
    // 이 섹션은 시스템 기준 설정이다 — 옮기는 김에 넓히면 그게 권한 변경이다
    for (const i of sec(SETUP)!.items) {
      expect(i.roles.length, `${i.href} roles 비어 있음`).toBeGreaterThan(0);
    }
  });
});
