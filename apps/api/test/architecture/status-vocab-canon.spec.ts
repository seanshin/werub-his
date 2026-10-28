import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EQUIPMENT_STATUS_LABEL } from '@hospital-run/shared';

/**
 * 🔴 라벨표는 DB enum 과 **같은 어휘**를 써야 한다 — 화면 실사용 점검 W6(2026-08-14).
 *
 * 장비 상태는 DB enum 이 `ACTIVE · UNDER_MAINTENANCE · BROKEN · RETIRED` 인데
 * 화면 라벨표는 `ACTIVE · MAINTENANCE · INACTIVE · RETIRED` 라는 다른 어휘였다.
 * 겹치는 값이 ACTIVE/RETIRED 뿐이라 **정비중·고장 장비는 영문 원문 그대로**,
 * 색도 없이 회색 배지로 떴다. 고장난 제세동기가 목록에서 눈에 띄지 않는다.
 *
 * 라벨표는 조용히 드리프트한다 — enum 을 바꿔도 라벨은 따라오지 않기 때문에
 * 스키마를 정본으로 놓고 기계로 맞춘다.
 */
const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');

function enumValues(name: string): string[] {
  const m = SCHEMA.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!m) throw new Error(`enum ${name} 을 스키마에서 찾지 못했다`);
  return m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
}

describe('상태 라벨 어휘 정합', () => {
  it('🔴 EQUIPMENT_STATUS_LABEL 의 키가 DB enum 과 정확히 일치한다', () => {
    const dbValues = enumValues('EquipmentStatus').sort();
    const labelKeys = Object.keys(EQUIPMENT_STATUS_LABEL).sort();

    expect(labelKeys, 'enum 에 없는 라벨/라벨 없는 enum 값이 있으면 화면이 영문 원문을 흘린다').toEqual(dbValues);
  });

  it('🔴 모든 enum 값에 빈 라벨이 없다', () => {
    for (const [k, v] of Object.entries(EQUIPMENT_STATUS_LABEL)) {
      expect(v.trim(), `${k} 라벨이 비어 있다`).not.toBe('');
    }
  });

  it('🔴 폐기된 어휘가 되살아나지 않는다', () => {
    // 종전 로컬 표가 쓰던, DB 에 존재한 적 없는 값들
    expect(EQUIPMENT_STATUS_LABEL).not.toHaveProperty('MAINTENANCE');
    expect(EQUIPMENT_STATUS_LABEL).not.toHaveProperty('INACTIVE');
  });
});
