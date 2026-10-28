import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { assertDateParam } from '../../src/common/day-range';

/**
 * 🔴 선택 날짜 파라미터 검증 가드 — 2026-09-01.
 *
 * 결함: `@Query('from') from?: string` 같은 개별 문자열 인자는 ValidationPipe 를 우회한다
 *   (교차/Partial DTO 가 아니라 개별 인자라 metatype 이 String → 파이프 스킵).
 *   `if (query.from) dateFilter.gte = new Date(query.from)` 은 **null 만 막고 형식 오류는 통과** →
 *   `?from=abc` → `new Date('abc')`=Invalid Date → Prisma where 로 들어가 **500**.
 *   (portal_date_param_500 과 같은 부류 — 그때는 포털·직원 GET 을 훑었고 통계 경로가 남아 있었다.)
 *
 * 정본: 값 구성은 그대로(@db.Date=UTC 자정 유지) 두고 `assertDateParam` 으로 형식만 검증(400).
 */

const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, 'src', rel), 'utf8');

describe('date-param-validation-guard 오라클: assertDateParam', () => {
  it('형식 오류면 400(BadRequestException)', () => {
    expect(() => assertDateParam('abc', '조회일')).toThrow(BadRequestException);
    expect(() => assertDateParam('2026/01/01x', '조회일')).toThrow(BadRequestException);
  });
  it('정상 날짜/부재/빈값은 통과(무동작)', () => {
    expect(() => assertDateParam('2026-01-01', '조회일')).not.toThrow();
    expect(() => assertDateParam(undefined, '조회일')).not.toThrow();
    expect(() => assertDateParam(null, '조회일')).not.toThrow();
    expect(() => assertDateParam('', '조회일')).not.toThrow();
  });
});

describe('date-param-validation-guard: 통계·조회 경로가 날짜 파라미터를 검증한다', () => {
  const cases: { file: string; methods: string[] }[] = [
    {
      file: 'modules/checkup/checkup.service.ts',
      methods: ['getRevenueStats', 'getDemographicStats', 'getFindingRateStats', 'getStats', 'getAbnormalStats'],
    },
    { file: 'modules/telehealth/telehealth.service.ts', methods: ['getSessions'] },
    { file: 'modules/inpatient/inpatient.service.ts', methods: ['getDailySummary'] },
    { file: 'modules/schedule/schedule.service.ts', methods: ['getStats'] },
  ];

  for (const { file, methods } of cases) {
    const src = read(file);
    for (const m of methods) {
      it(`${file.split('/').pop()} ${m} 은 assertDateParam 으로 날짜를 검증한다`, () => {
        const idx = src.indexOf(`async ${m}(`);
        expect(idx, `${m} 존재`).toBeGreaterThanOrEqual(0);
        // 메서드 본문 앞부분(다음 400자)에 검증 호출이 있어야 한다
        const head = src.slice(idx, idx + 400);
        expect(head, `${m} 이 assertDateParam 호출`).toContain('assertDateParam');
      });
    }
  }

  it('checkup 통계 경로에 raw new Date(query.from) 직행이 남아 있지 않다(검증 후 사용)', () => {
    // 검증 없이 new Date(query.from) 을 쓰던 형태가 assertDateParam 없이 남으면 재주입 실패
    const src = read('modules/checkup/checkup.service.ts');
    // 각 통계 메서드가 검증을 갖는지는 위에서 봤고, 여기선 파일 전체에 assertDateParam 이 최소 5회
    const count = (src.match(/assertDateParam\(/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(10);
  });
});
