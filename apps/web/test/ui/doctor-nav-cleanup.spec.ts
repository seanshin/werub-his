/**
 * 의사 메뉴 정리 — 2026-09-30.
 *  1. 🔴 투석실·혈액은행이 진료과 좁히기 목록에 있어 **모든 의사·모든 간호사**에게 숨겨졌다 → 부서 공용 화면으로
 *  2. 검진센터 운영 화면 9개는 의사·간호사에게 검진센터 소속일 때만(소속 미상이면 숨기지 않는다 · 소견 대기는 모든 의사)
 *  3. 병원 안내 6개는 의사 메뉴에서 뺀다
 *  4. 메뉴 허브도 같은 판정(정본 하나)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAV_SECTIONS, isNavItemVisible, CHECKUP_OPS_PATHS } from '@/components/layout/Sidebar';

type Item = { href: string; roles: string[] };
const all = (NAV_SECTIONS as { title: string; items: Item[] }[]).flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));
const item = (href: string) => { const i = all.find((x) => x.href === href); if (!i) throw new Error(href); return i; };
const visible = (role: string, dept: string, specialty?: string) => all.filter((i) => isNavItemVisible(i, { role, dept, specialty })).map((i) => i.href);

describe('투석실·혈액은행 — 진료과가 아니라 부서 공용 화면', () => {
  it('내과 의사·병동 간호사에게 보인다', () => {
    for (const [role, dept] of [['DOCTOR', '내과'], ['DOCTOR', '정형외과'], ['NURSE', '내과병동']]) {
      expect(visible(role, dept), `${role}/${dept}`).toEqual(expect.arrayContaining(['/dialysis', '/blood-bank']));
    }
  });
  it('대조군 — 진료과 화면은 여전히 본인 과만(의사) · 간호사는 숨김', () => {
    const d = visible('DOCTOR', '정형외과');
    expect(d).toContain('/orthopedics');
    expect(d).not.toContain('/dermatology');
    expect(visible('DOCTOR', '', '신장내과')).toContain('/internal-medicine');
    expect(visible('NURSE', '내과병동')).not.toContain('/orthopedics');
  });
});

describe('검진센터 운영 화면 — 의사·간호사는 검진센터 소속만', () => {
  it('병동·외래 의사·간호사에게는 운영 화면이 없다 · 소견 대기는 의사에게 남는다', () => {
    const d = visible('DOCTOR', '내과');
    for (const p of CHECKUP_OPS_PATHS) expect(d, p).not.toContain(p);
    expect(d).toContain('/his-checkup/review');
    for (const p of CHECKUP_OPS_PATHS) expect(visible('NURSE', '내과병동'), p).not.toContain(p);
  });
  it('검진센터 소속이면 그대로 · 소속 미상(빈 값)이면 숨기지 않는다 · 검진 직군(CHECKUP)은 영향 없음', () => {
    const ck = visible('DOCTOR', '건강검진센터(의사)');
    expect(ck).toEqual(expect.arrayContaining(['/his-checkup', '/his-checkup/waiting', '/his-checkup/stats', '/his-checkup/review']));
    expect(visible('NURSE', '건강검진센터(간호사)')).toContain('/his-checkup/station');
    expect(visible('DOCTOR', '')).toContain('/his-checkup');
    expect(visible('CHECKUP', '건강검진센터(원무)')).toContain('/his-checkup/waiting');
  });
  it('목록의 경로는 전부 실제 메뉴에 있다(오타로 무동작 금지)', () => {
    for (const p of CHECKUP_OPS_PATHS) expect(() => item(p)).not.toThrow();
  });
});

describe('병원 안내 — 의사 메뉴에서만 뺀다', () => {
  const guide = all.filter((i) => i.section === '병원 안내');
  it('6개 모두 의사에게 보이지 않고, 간호사·원무에게는 보인다', () => {
    expect(guide).toHaveLength(6);
    for (const g of guide) {
      expect(isNavItemVisible(g, { role: 'DOCTOR', dept: '내과' }), g.href).toBe(false);
      expect(isNavItemVisible(g, { role: 'RECEPTIONIST', dept: '원무과' }), g.href).toBe(true);
      expect(isNavItemVisible(g, { role: 'NURSE', dept: '내과병동' }), g.href).toBe(true);
    }
  });
  it('안내 역할 = 전직원 공통(ALL — 대시보드 역할)에서 의사만 뺀 집합(리터럴이 ALL 과 갈라지지 않는다)', () => {
    const allRoles = item('/dashboard').roles;
    for (const g of guide) expect([...g.roles].sort(), g.href).toEqual(allRoles.filter((r) => r !== 'DOCTOR').sort());
  });
  it('관리자 메뉴 구성(역할 재정의)으로 되살릴 수 있다', () => {
    expect(isNavItemVisible(guide[0], { role: 'DOCTOR', dept: '내과', override: { roles: ['DOCTOR'] } })).toBe(true);
  });
});

describe('메뉴 허브도 같은 판정', () => {
  it('허브가 역할만 보지 않고 isNavItemVisible 을 쓴다', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/(main)/menu/[section]/page.tsx'), 'utf8');
    expect(src).toMatch(/const pick = [^\n]*isNavItemVisible\(/);
  });
  it('사이드바 본체도 같은 함수를 부른다(인라인 판정 부활 금지)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/layout/Sidebar.tsx'), 'utf8');
    expect(src).toMatch(/\.filter\(item => isNavItemVisible\(item, \{ role: userRole/);
  });
});

it('의사(내과) 메뉴 항목 수 — 정리 전보다 줄었다', () => {
  // 실측(2026-09-30): 정리 전 내과 의사 111(역할 126 − 진료과·투석·혈액 좁히기 15) → 정리 후 98(검진 −9 · 안내 −6 · 투석/혈액 +2)
  expect(visible('DOCTOR', '내과').length).toBeLessThan(111);
});
