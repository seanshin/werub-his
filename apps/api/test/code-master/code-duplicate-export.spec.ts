import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodeDuplicateService } from '../../src/modules/code-master/code-duplicate.service';
import { CodeExportService } from '../../src/modules/code-master/code-export.service';

/**
 * C5 — F6 중복 후보 · F9 내보내기(2026-08-26).
 *
 * 🔴 **"동일 명칭 = 중복"이 아니다.** 운영 실측으로 전제를 뒤집었다:
 *    수가 8,535 그룹 = 한 마취 행위의 가산 코드 240개 · 진단 `V19.4`/`V29.4` = 자전거/오토바이 ·
 *    약품 = 포장 단위별 보험코드. 그것을 합치면 **청구가 망가진다.**
 */
const DUP = join(process.cwd(), 'src/modules/code-master/code-duplicate.service.ts');

const dupPrisma = (rows: unknown[], master: unknown[] = []) => {
  const findMany = vi.fn().mockImplementation((args: { where?: { origin?: string } }) =>
    args?.where?.origin === 'LOCAL' ? Promise.resolve(rows) : Promise.resolve(master),
  );
  const t = { findMany };
  return { diagnosisCode: t, procedureCode: t, medicationCode: t } as never;
};

const L = (code: string, nameKo: string) => ({ id: `id-${code}`, code, nameKo, origin: 'LOCAL' });

describe('중복 후보', () => {
  const src = readFileSync(DUP, 'utf8');

  it('🔴 고시 마스터는 검사 대상이 아니다 — 원내 등록분만 훑는다', async () => {
    const prisma = dupPrisma([]);
    const svc = new CodeDuplicateService(prisma);
    const r = await svc.report('DiagnosisCode');
    expect(r.scope).toMatch(/LOCAL/);
    const calls = (prisma as unknown as { diagnosisCode: { findMany: { mock: { calls: unknown[][] } } } })
      .diagnosisCode.findMany.mock.calls;
    expect((calls[0][0] as { where: { origin: string } }).where.origin).toBe('LOCAL');
  });

  it('🔴 검사 대상이 0이면 "중복 없음"이 아니라 검사할 것이 없었다고 말한다', async () => {
    const svc = new CodeDuplicateService(dupPrisma([]));
    const r = await svc.report('DiagnosisCode');
    expect(r.scanned).toBe(0);
    expect(r.groups).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/검사할 원내 등록 코드가 없습니다/);
    expect(r.notes.join(' ')).toMatch(/중복이 없다는 뜻이 아닙니다/);
  });

  it('원내 코드끼리 명칭이 겹치면 무리로 낸다', async () => {
    const svc = new CodeDuplicateService(dupPrisma([L('X1', '원내 초음파'), L('X2', '원내 초음파'), L('X3', '다른 것')]));
    const r = await svc.report('DiagnosisCode');
    expect(r.scanned).toBe(3);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].codes.map((c) => c.code)).toEqual(['X1', 'X2']);
  });

  it('🔴 대조군 — 겹치지 않으면 조용하다(거짓 경보는 진짜 경보를 죽인다)', async () => {
    const svc = new CodeDuplicateService(dupPrisma([L('X1', '가'), L('X2', '나')]));
    const r = await svc.report('DiagnosisCode');
    expect(r.groups).toEqual([]);
    expect(r.collidesWithMaster).toEqual([]);
    expect(r.notes.join(' ')).not.toMatch(/청구가 되지 않을 수 있습니다/);
  });

  it('원내 코드가 마스터와 명칭이 같으면 청구 위험을 말한다', async () => {
    const svc = new CodeDuplicateService(
      dupPrisma([L('X1', '흉부 촬영')], [{ id: 'm1', code: 'G1234', nameKo: '흉부 촬영', origin: 'HIRA' }]),
    );
    const r = await svc.report('DiagnosisCode');
    expect(r.collidesWithMaster).toHaveLength(1);
    expect(r.notes.join(' ')).toMatch(/청구가 되지 않을 수 있습니다/);
  });

  it('🔴 병합 EP 를 새로 만들지 않았다 — 병합은 [폐지 + 후속 코드]이고 정본이 이미 있다', () => {
    expect(src).not.toMatch(/\bmerge\s*\(/);
    expect(src).toMatch(/폐지 \+ 후속 코드 지정/);
  });
});

describe('코드집 내보내기', () => {
  const expPrisma = (rows: Record<string, unknown>[], total: number) => {
    const t = {
      findMany: vi.fn().mockResolvedValue(rows),
      count: vi.fn().mockResolvedValue(total),
    };
    return { diagnosisCode: t, procedureCode: t, medicationCode: t } as never;
  };

  it('🔴 조용히 자르지 않는다 — 다음 장이 있으면 그렇게 말한다', async () => {
    const svc = new CodeExportService(expPrisma([{ code: 'A' }], 166744));
    const r = await svc.export('procedure', { page: 1 });
    expect(r.total).toBe(166744);
    expect(r.hasMore).toBe(true);
    expect(r.notes.join(' ')).toMatch(/다음 장이 있습니다/);
    expect(r.notes.join(' ')).toMatch(/일부만 제출됩니다/);
  });

  it('대조군 — 전부 들어갔으면 자름 안내를 그리지 않는다', async () => {
    const svc = new CodeExportService(expPrisma([{ code: 'A' }], 1));
    const r = await svc.export('procedure', { page: 1 });
    expect(r.hasMore).toBe(false);
    expect(r.notes.join(' ')).not.toMatch(/다음 장/);
  });

  it('🔴 CSV 주입을 막는다 — 표계산기가 수식으로 실행하는 값', async () => {
    const svc = new CodeExportService(expPrisma([{ code: '=HYPERLINK("http://x")', nameKo: '가,나' }], 1));
    const r = await svc.export('procedure', {});
    expect(r.csv).toMatch(/'=HYPERLINK/);
    expect(r.csv).toMatch(/"가,나"/);
  });

  it('엑셀이 한글을 깨뜨리지 않게 BOM 을 붙인다(깨진 코드집은 제출할 수 없다)', async () => {
    const svc = new CodeExportService(expPrisma([], 0));
    const r = await svc.export('diagnosis', {});
    expect(r.csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('🔴 0건이면 빈 파일이 나간다는 것을 말한다', async () => {
    const svc = new CodeExportService(expPrisma([], 0));
    const r = await svc.export('diagnosis', {});
    expect(r.notes.join(' ')).toMatch(/빈 파일이 나갑니다/);
  });

  it("출처 'UNKNOWN' 은 표기 없음(null)이다", async () => {
    const prisma = expPrisma([], 0);
    const svc = new CodeExportService(prisma);
    await svc.export('diagnosis', { origin: 'UNKNOWN' });
    const calls = (prisma as unknown as { diagnosisCode: { count: { mock: { calls: unknown[][] } } } })
      .diagnosisCode.count.mock.calls;
    expect((calls[0][0] as { where: { origin: unknown } }).where.origin).toBeNull();
  });
});
