import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { OrderStatus, BillingStatus } from '@prisma/client';
import { assertEnumParam } from '../../src/common/enum-param';

/**
 * 🔴 enum 쿼리 파라미터 검증 가드 — 2026-09-01.
 *
 * 결함: `if (filters.status) where.status = filters.status as OrderStatus` — TS 캐스트일 뿐
 *   런타임 검증이 없어 `?status=BOGUS` 가 Prisma where 로 들어가 PrismaClientValidationError → 500.
 *   운영 실측 500: orders·encounters·billings·claims·hr/staff·equipment.
 * 정본: 캐스트 앞에서 assertEnumParam(값·enum·라벨) 으로 허용값 검증(400).
 */

const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, 'src', rel), 'utf8');

describe('enum-param-validation-guard 오라클: assertEnumParam', () => {
  it('허용되지 않은 값이면 400', () => {
    expect(() => assertEnumParam('BOGUS', OrderStatus, '상태')).toThrow(BadRequestException);
    expect(() => assertEnumParam('bogus', BillingStatus, '상태')).toThrow(BadRequestException);
  });
  it('허용값/부재/빈값은 통과', () => {
    expect(() => assertEnumParam('COMPLETED', OrderStatus, '상태')).not.toThrow();
    expect(() => assertEnumParam(undefined, OrderStatus, '상태')).not.toThrow();
    expect(() => assertEnumParam(null, OrderStatus, '상태')).not.toThrow();
    expect(() => assertEnumParam('', OrderStatus, '상태')).not.toThrow();
  });
  it('문자열 배열 허용집합도 받는다', () => {
    expect(() => assertEnumParam('x', ['a', 'b'], '값')).toThrow(BadRequestException);
    expect(() => assertEnumParam('a', ['a', 'b'], '값')).not.toThrow();
  });
});

describe('enum-param-validation-guard: 변수 operand enum 캐스트는 검증을 거친다', () => {
  // 각 캐스트 문자열의 **모든** 등장 라인에 assertEnumParam 이 같은 줄 또는 앞 2줄에 있어야 한다.
  // (리터럴 operand 캐스트 — 예: `'AMENDED' as EncounterStatus` — 는 목록에서 제외)
  const sites: { file: string; casts: string[] }[] = [
    { file: 'modules/order/order.service.ts', casts: ['as OrderDepartment', 'as OrderStatus', 'as PrescriptionType'] },
    { file: 'modules/encounter/encounter.service.ts', casts: ["as Prisma.EnumEncounterStatusFilter['equals']"] },
    { file: 'modules/consent/consent.service.ts', casts: ['as ConsentStatus', 'as ConsentType'] },
    { file: 'modules/hr/hr.service.ts', casts: ['as StaffCategory', 'as EmploymentStatus'] },
    { file: 'modules/billing/billing.service.ts', casts: ['as BillingStatus'] },
    { file: 'modules/equipment/equipment.service.ts', casts: ["as Prisma.EquipmentWhereInput['status']", 'as EquipmentStatus'] },
    { file: 'modules/claim/claim.service.ts', casts: ['as ClaimStatus'] },
    { file: 'modules/cssd/cssd.service.ts', casts: ['as SterilizationStatus'] },
    { file: 'modules/nursing/nursing.service.ts', casts: ['as Prisma.EnumShiftTypeFilter'] },
  ];

  const isLiteralCast = (line: string, cast: string) => {
    // operand 가 따옴표 리터럴이면(예: 'AMENDED' as X) 검증 대상 아님
    const before = line.slice(0, line.indexOf(cast));
    return /['"`]\s*$/.test(before.replace(/\s+$/, (m) => m));
  };

  for (const { file, casts } of sites) {
    it(`${file.split('/').pop()} 은 변수 enum 캐스트마다 assertEnumParam 을 선행한다`, () => {
      const src = readFileSync(join(ROOT, 'src', file), 'utf8');
      expect(src, 'enum-param import').toContain("from '../../common/enum-param'");
      const lines = src.split('\n');
      for (const cast of casts) {
        const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.includes(cast) && !isLiteralCast(l, cast));
        expect(hits.length, `${cast} 등장`).toBeGreaterThan(0);
        for (const { l, i } of hits) {
          const window = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
          expect(window.includes('assertEnumParam('), `${file} ${cast} @${i + 1} 앞 검증`).toBe(true);
        }
      }
    });
  }
});
