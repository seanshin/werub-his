import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 오더 유형 표기 계약 — 2026-07-31.
 *
 * 🔴 유형 라벨이 4종(약물·검사·영상·치료)뿐이라 간호·식이·활동 오더가 **목록 행에서 라벨 없이** 나왔고,
 *    유형 탭 건수 합이 '전체'와 어긋났다(프로드 실측: 전체 18 vs 탭 합 14 — 활동 4건 누락).
 *    Prisma `PrescriptionType` enum 과 화면 라벨이 어긋나지 않게 고정한다.
 */
const page = readFileSync(join(process.cwd(), 'src/app/(main)/orders/page.tsx'), 'utf-8');
const schema = readFileSync(join(process.cwd(), '../api/prisma/schema.prisma'), 'utf-8');

function enumValues(name: string): string[] {
  const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  return m ? m[1].trim().split(/\s+/) : [];
}
function mapKeys(constName: string): string[] {
  const m = new RegExp(`const ${constName}: Record<string, string> = \\{([^}]*)\\}`).exec(page);
  return m ? [...m[1].matchAll(/(\w+):/g)].map((x) => x[1]) : [];
}

describe('처방 유형 라벨', () => {
  const types = enumValues('PrescriptionType');

  it('스키마를 실제로 읽었다(파싱 실패를 통과로 오인하지 않게)', () => {
    expect(types.length).toBeGreaterThanOrEqual(7);
    expect(types).toContain('ACTIVITY');
  });

  it('🔴 enum 전량에 한글 라벨이 있다 — 없으면 목록 행이 빈칸으로 나온다', () => {
    const labeled = mapKeys('TYPE_LABEL');
    expect(types.filter((t) => !labeled.includes(t))).toEqual([]);
  });

  it('enum 전량에 아이콘이 있다', () => {
    const iconed = mapKeys('TYPE_ICON');
    expect(types.filter((t) => !iconed.includes(t))).toEqual([]);
  });

  it('🔴 탭 순서 정의도 enum 전량을 덮는다 — 빠지면 그 유형은 걸러 볼 수 없다', () => {
    const m = /const TYPE_ORDER = \[([^\]]*)\]/.exec(page);
    const order = m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [];
    expect(types.filter((t) => !order.includes(t))).toEqual([]);
  });

  it('유형 집계는 동적이라 모르는 유형도 세어진다(합계가 전체와 어긋나지 않게)', () => {
    expect(page).toContain('byType');
    expect(page).toMatch(/acc\[t\] = \(acc\[t\] \?\? 0\) \+ 1/);
  });
});
