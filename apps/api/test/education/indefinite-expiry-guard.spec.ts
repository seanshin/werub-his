import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EducationService,
  isIndefiniteExpiry,
  INDEFINITE_EXPIRES_AT,
} from '../../src/modules/education/education.service';

/**
 * 🔴 교육 이수 '무기한' 가드 — 2026-08-18(`expiresAt` nullable 전환분 배선).
 *
 * 무엇이 잘못이었나
 *  - 컬럼이 NOT NULL 이라 "만료 없음"을 담을 자리가 없어 `9999-12-31` 을 표식으로 박았다.
 *    원장에 "9999년에 만료된다"는 **틀린 사실**을 적은 것이고, 표식을 모르는 코드가
 *    그대로 읽으면 "9999.12.31 만료"를 화면에 찍는다.
 *
 * 무엇이 정본인가
 *  - **무기한 = `expiresAt === null`**.
 *  - 🔴 `null` 을 "만료됨"이나 "만료 임박"으로 접지 않는다. 만료/임박 **집계에서 제외**하고
 *    화면에는 '무기한'으로 표시한다(`indefinite: true`, `daysLeft: null`).
 *  - 구 `9999-…` 행은 읽기에서만 무기한으로 인정한다(하위호환).
 *    정리 SQL: `prisma/manual/education-indefinite-expiry-null-20260818.sql`(적용은 사람).
 */
const SERVICE_PATH = join(process.cwd(), 'src/modules/education/education.service.ts');
const src = readFileSync(SERVICE_PATH, 'utf-8');
const codeLines = src.split('\n').filter((l) => {
  const t = l.trim();
  return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
});
const code = codeLines.join('\n');

function makeService() {
  const prisma: any = {
    educationProgram: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    educationCompletion: {
      create: vi.fn((a: any) => Promise.resolve({ id: 'c1', ...a.data })),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    staff: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { service: new EducationService(prisma), prisma };
}

describe('교육 이수 무기한 — null 을 만료로 접지 않는다(구조 가드)', () => {
  it('🔴 새 기록에 9999 표식을 쓰지 않는다', () => {
    // 무기한을 쓰는 자리에서 표식 상수를 다시 쓰면(= 결함 재주입) 여기서 잡힌다
    expect(code, '무기한 저장에 INDEFINITE_EXPIRES_AT 을 다시 쓰면 안 된다').not.toMatch(
      /expiresAt\s*=\s*new Date\(INDEFINITE_EXPIRES_AT\)/,
    );
    expect(code, "expiresAt 에 '9999' 리터럴을 넣으면 안 된다").not.toMatch(/expiresAt[^\n]*9999-12-31/);
    expect(code, '무기한은 null 로 저장한다').toMatch(/expiresAt\s*=\s*null/);
  });

  it('구 표식 상수는 읽기 하위호환용으로만 남아 있다(deprecated)', () => {
    expect(src).toContain('@deprecated');
    expect(isIndefiniteExpiry(INDEFINITE_EXPIRES_AT)).toBe(true);
  });

  it('🔴 만료·임박 조회에서 null 을 제외한다(not: null)', () => {
    expect(code).toMatch(/expiredWhere\s*=\s*\{\s*expiresAt:\s*\{\s*not:\s*null/);
    expect(code).toMatch(/dueSoonWhere\s*=\s*\{\s*expiresAt:\s*\{\s*not:\s*null/);
  });
});

describe('교육 이수 무기한 — 계약', () => {
  it('validMonths<=0 이면 만료일을 null 로 저장한다', async () => {
    const { service, prisma } = makeService();
    prisma.educationProgram.findUnique.mockResolvedValue({ id: 'p1', validMonths: 0 });
    await service.recordCompletion({ programId: 'p1', staffId: 's1' });
    expect(prisma.educationCompletion.create.mock.calls[0][0].data.expiresAt).toBeNull();
  });

  it('🔴 무기한은 만료 집계에도 임박 집계에도 들어가지 않는다', async () => {
    const { service, prisma } = makeService();
    await service.getExpiringSoon();
    for (const call of prisma.educationCompletion.count.mock.calls) {
      expect(call[0].where.expiresAt.not, '무기한(null)이 집계에 섞였다').toBeNull();
    }
    for (const call of prisma.educationCompletion.findMany.mock.calls) {
      expect(call[0].where.expiresAt.not, '무기한(null)이 목록에 섞였다').toBeNull();
    }
  });

  it('🔴 무기한 항목의 daysLeft 를 지어내지 않는다(0 도 큰 수도 사실이 아니다)', async () => {
    const { service, prisma } = makeService();
    prisma.educationCompletion.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prisma.educationCompletion.findMany
      .mockResolvedValueOnce([
        {
          id: 'c1',
          staffId: 's1',
          programId: 'p1',
          score: null,
          completedAt: new Date('2026-01-01'),
          expiresAt: null,
          program: { name: '신규직원 오리엔테이션', category: '필수', isMandatory: true },
        },
      ])
      .mockResolvedValueOnce([]);
    const res = await service.getExpiringSoon();
    const item = res.expired.items[0];
    expect(item.indefinite).toBe(true);
    expect(item.daysLeft).toBeNull();
    expect(item.daysLeft).not.toBe(0); // 0 은 '오늘 만료'라는 다른 사실
    expect(item.expiresAt).toBeNull();
  });

  it('직원별 이수 현황도 null 을 무기한으로 말한다', async () => {
    const { service, prisma } = makeService();
    prisma.educationCompletion.findMany.mockResolvedValue([{ id: 'c1', expiresAt: null }]);
    const rows = await service.getStaffCompletions('s1');
    expect(rows[0].indefinite).toBe(true);
  });
});

/**
 * 🔴 코디네이터 회수분(2026-08-18) — **시드가 무기한에 만료일을 지어내지 않는다.**
 *
 * `validMonths === 0`(무기한) 과정에 종전 시드는 `? ep.months : 12` 폴백으로 **조용히 12개월**을
 * 부여했다. 지금은 무기한 과정이 시드에 없어 눈에 띄지 않지만, 하나만 추가되면
 * "무기한 이수가 1년 뒤 만료"로 둔갑한다 — 어휘를 정본으로 바꿀 때 **시드까지 따라와야 한다**.
 */
describe('시드가 무기한 이수에 만료일을 만들지 않는다', () => {
  const SEED = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf-8');

  it('🔴 12개월 폴백이 없다', () => {
    expect(SEED).not.toMatch(/ep\.months\s*>\s*0\s*\?\s*ep\.months\s*:\s*12/);
  });

  it('무기한이면 만료일을 null 로 둔다', () => {
    expect(SEED).toMatch(/let expires: Date \| null = null;/);
  });
});
