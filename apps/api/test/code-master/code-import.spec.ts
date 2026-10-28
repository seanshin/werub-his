import { describe, it, expect, vi } from 'vitest';
import { CodeImportService } from '../../src/modules/code-master/code-import.service';

/**
 * 고시 개정 일괄 반영 — **차이를 먼저 보여주고 사람이 적용한다**(2026-08-26 · C2).
 *
 * 🔴 버전 가능 여부가 테이블마다 다르다(실측):
 *    `ProcedureCode` 만 `@@unique([code, validFrom])` → 새 버전. 진단·약품은 코드당 1행 = 덮어쓰기.
 *    "새 버전"이라 적어놓고 덮어쓰면 그것이 거짓말이다 — 미리보기가 사실대로 말해야 한다.
 */
// 🔴 (2026-09-17 L1) 수가 버전 교체(이전 종료 ↔ 새 버전)가 `$transaction` 으로 묶였다 —
//    `$transaction` 없는 목은 콜백을 실행하지 않아 적용 테스트가 공허하게 통과한다.
const prisma = (current: Record<string, unknown> | null, live = 10) => {
  const p: Record<string, unknown> = {
    diagnosisCode: { findFirst: vi.fn().mockResolvedValue(current), count: vi.fn().mockResolvedValue(live), create: vi.fn(), updateMany: vi.fn() },
    medicationCode: { findFirst: vi.fn().mockResolvedValue(current), count: vi.fn().mockResolvedValue(live), create: vi.fn(), updateMany: vi.fn() },
    procedureCode: { findFirst: vi.fn().mockResolvedValue(current), count: vi.fn().mockResolvedValue(live), upsert: vi.fn(), updateMany: vi.fn() },
  };
  p.$transaction = vi.fn(async (cb: unknown) =>
    typeof cb === 'function' ? (cb as (c: unknown) => unknown)(p) : Promise.all(cb as unknown[]),
  );
  return p as never;
};

const CSV = 'code,nameKo,unitPrice\nA100,검사 가,1000\n';

describe('고시 개정 미리보기', () => {
  it('🔴 미리보기는 아무것도 저장하지 않는다', async () => {
    const p = prisma(null);
    const svc = new CodeImportService(p);
    await svc.preview('procedure', CSV, '2026-09-01');
    expect((p as never as Record<string, { upsert: ReturnType<typeof vi.fn> }>).procedureCode.upsert).not.toHaveBeenCalled();
  });

  it('없는 코드는 신설로 판정한다', async () => {
    const r = await new CodeImportService(prisma(null)).preview('procedure', CSV, '2026-09-01');
    expect(r.counts.NEW).toBe(1);
  });

  it('값이 같으면 변경으로 세지 않는다(불필요한 버전을 만들지 않는다)', async () => {
    const r = await new CodeImportService(prisma({ nameKo: '검사 가', category: null, unitPrice: 1000 }))
      .preview('procedure', CSV, '2026-09-01');
    expect(r.counts.UNCHANGED).toBe(1);
    expect(r.counts.CHANGED).toBe(0);
  });

  it('달라진 것을 사람 말로 적는다', async () => {
    const r = await new CodeImportService(prisma({ nameKo: '옛 이름', category: null, unitPrice: 900 }))
      .preview('procedure', CSV, '2026-09-01');
    expect(r.counts.CHANGED).toBe(1);
    expect(r.rows[0].changes?.join(' ')).toMatch(/명칭|수가/);
  });

  it('🔴 수가는 버전 가능, 진단은 덮어쓰기라고 사실대로 말한다', async () => {
    const proc = await new CodeImportService(prisma(null)).preview('procedure', CSV, '2026-09-01');
    const diag = await new CodeImportService(prisma(null)).preview('diagnosis', 'code,nameKo\nA10,진단\n', '2026-09-01');
    expect(proc.versioned).toBe(true);
    expect(proc.notes.join(' ')).toContain('새 버전');
    expect(diag.versioned).toBe(false);
    expect(diag.notes.join(' ')).toContain('덮어씁니다');
  });

  it('🔴 진단에 없는 열(unitPrice)을 조용히 무시하지 않는다', async () => {
    const r = await new CodeImportService(prisma(null)).preview('diagnosis', CSV, '2026-09-01');
    expect(r.notes.join(' ')).toContain('반영하지 않는 열');
  });

  it('🔴 파일 안 중복 코드를 마지막 값으로 덮지 않는다', async () => {
    const r = await new CodeImportService(prisma(null)).preview('procedure', 'code,nameKo\nA,1\nA,2\n', '2026-09-01');
    expect(r.counts.ERROR).toBe(1);
  });

  it('🔴 파일에 없는 코드를 자동 폐지하지 않는다고 밝힌다', async () => {
    const r = await new CodeImportService(prisma(null, 50)).preview('procedure', CSV, '2026-09-01');
    expect(r.missingInFile).toBeGreaterThan(0);
    expect(r.notes.join(' ')).toContain('자동으로 폐지하지 않습니다');
  });

  it('숫자로 읽을 수 없는 수가는 0 으로 만들지 않고 오류로 낸다', async () => {
    const r = await new CodeImportService(prisma(null)).preview('procedure', 'code,nameKo,unitPrice\nA,이름,천원\n', '2026-09-01');
    expect(r.counts.ERROR).toBe(1);
  });

  it('헤더에 필수 열이 없으면 거부한다(열 이름을 추측하지 않는다)', async () => {
    await expect(new CodeImportService(prisma(null)).preview('procedure', 'a,b\n1,2\n', '2026-09-01')).rejects.toThrow();
  });
});

describe('고시 개정 적용', () => {
  it('🔴 오류가 하나라도 있으면 적용하지 않는다', async () => {
    const svc = new CodeImportService(prisma(null));
    await expect(svc.apply('procedure', 'code,nameKo\nA,1\nA,2\n', '2026-09-01', 'u')).rejects.toThrow();
  });

  it('🔴 수가 변경은 이전 버전을 종료하고 새 버전을 만든다(소급 변경 금지)', async () => {
    const p = prisma({ nameKo: '옛 이름', category: null, unitPrice: 900 });
    await new CodeImportService(p).apply('procedure', CSV, '2026-09-01', 'u');
    const pc = (p as never as Record<string, { updateMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }>).procedureCode;
    expect(pc.updateMany, '이전 버전을 종료하지 않았다').toHaveBeenCalled();
    expect(pc.upsert, '새 버전을 만들지 않았다').toHaveBeenCalled();
  });

  it('대조군 — 동일한 행은 아무것도 쓰지 않는다', async () => {
    const p = prisma({ nameKo: '검사 가', category: null, unitPrice: 1000 });
    const r = await new CodeImportService(p).apply('procedure', CSV, '2026-09-01', 'u');
    expect(r.created + r.updated + r.versioned).toBe(0);
  });

  it('🔴 폐지는 하지 않는다(파일에 없다고 지우지 않는다)', async () => {
    const r = await new CodeImportService(prisma(null, 99)).apply('procedure', CSV, '2026-09-01', 'u');
    expect(r.retired).toBe(0);
    expect(r.missingInFile).toBeGreaterThan(0);
  });
});
