import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THERAPY_PRESETS } from '../../src/components/prescription/order-entry';

/**
 * 처방 입력 부품 수렴 계약 — 2026-08-03.
 *
 * 차트(encounter/new)·CPOE 모달·/orders 는 검색·프리셋을 **공용 부품 한 곳**에서 쓴다.
 * 🔴 차트가 자체 구현을 유지하던 시절, 세 화면이 계속 어긋났다(모달에 탭 누락·검색 결과에
 *    포뮬러리/급여 미표시·프리셋 목록 3벌 복제). 이 테스트는 로컬 재구현의 회귀를 막는다.
 */
const chart = readFileSync(
  join(process.cwd(), 'src/app/(main)/patients/[id]/encounter/new/page.tsx'), 'utf-8',
);
const chartPage = { path: 'encounter/new/page.tsx', text: chart };

describe('차트 처방 입력 수렴', () => {
  it('검색은 공용 훅·드롭다운만 — 자체 fetch/렌더 금지', () => {
    expect(chart).toContain('useCodeSearch(activeTab)');
    expect(chart).toContain('<CodeSearchDropdown');
    // 검색 API 직접 호출은 공용 훅 안에만 있어야 한다
    expect(chart).not.toContain("'/api/v1/code-search'");
    expect(chart).not.toContain('/api/v1/codes/medication');
  });

  it('프리셋 데이터는 정본만 — 인라인 복제 금지', () => {
    // 복제가 되살아나면 항목 코드 리터럴이 페이지에 다시 나타난다
    for (const probe of ["code: 'ACT_ABR'", "code: 'NRS_VS_Q4H'", "code: 'PT_EXERCISE', name:"]) {
      expect(chartPage.text, `${probe} 인라인 복제 감지`).not.toContain(probe);
    }
    expect(chart).toContain('ACTIVITY_PRESETS');
    expect(chart).toContain('NURSING_FALLBACK_PRESETS');
    expect(chart).toContain('THERAPY_PRESETS.map');
  });

  it('코드 검색 타입은 정본(CodeItem) 별칭 — 로컬 interface 재정의 금지', () => {
    expect(chart).toContain('type CodeSearchResultExtended = CodeItem');
    expect(chart).not.toMatch(/interface CodeSearchResult\b/);
  });

  it('치료 아이콘 맵은 정본 프리셋 전 코드를 덮는다 — 빠지면 아이콘이 조용히 빈다', () => {
    const iconBlock = /const THERAPY_ICON_PATHS[\s\S]*?\n\};/.exec(chart)?.[0] ?? '';
    expect(iconBlock).not.toBe('');
    for (const p of THERAPY_PRESETS) {
      expect(iconBlock, `${p.code} 아이콘 누락`).toContain(`${p.code}:`);
    }
  });
});
