import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PacsWebhookController } from '../../src/modules/pacs-proxy/pacs-webhook.controller';

/**
 * 🔴 (2026-09-03 실결함) accession 정본은 `order.accessionNumber` 인데 웹훅 3곳이
 *    `notes contains` 로만 찾았다 — 생산자가 2026-08 "notes 덮어쓰기" 수정으로 전용 컬럼에
 *    옮긴 뒤로 **매칭 0 → 판독 완료가 HIS 에 영영 안 붙는데 200 을 돌려줬다**
 *    (PACS 는 성공으로 알고 재시도하지 않는다).
 *    규칙: 취소 경로와 같게 accessionNumber 와 notes **둘 다** 본다(컬럼 도입 이전 잔재).
 */

// 🔴 (H4) 오더 전이와 영상결과 기록이 한 트랜잭션이 됐다 — 목은 정본의 실제 호출 모양을 쓴다
//    (내가 가정한 모양을 테스트하면 가드가 헛돈다).
const mkPrisma = (order: unknown) => {
  const p: Record<string, unknown> = {
    order: {
      findFirst: vi.fn(async () => order),
      update: vi.fn(async () => ({})),
    },
    imagingResult: { updateMany: vi.fn(async () => ({})) },
  };
  p.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(p) : Promise.all(arg as unknown[]),
  );
  return p;
};
const auth = { assertPacsWebhookKey: vi.fn(async () => undefined) };
const emitter = { emit: vi.fn() };

describe('PACS 웹훅 — accession 매칭', () => {
  it('🔴 오더 조회가 accessionNumber 컬럼을 본다(notes 만 보면 매칭 0)', async () => {
    const prisma = mkPrisma({ id: 'o1', prescription: null });
    const ctrl = new PacsWebhookController(prisma as never, auth as never, emitter as never);
    await ctrl.onReportCompleted('secret', { accession_number: 'ACC-20260903-DEADBEEF' } as never);
    const where = prisma.order.findFirst.mock.calls[0][0] as unknown as { where: { OR?: unknown[] } };
    expect(JSON.stringify(where.where), 'where 에 accessionNumber 조건이 없습니다 — 전용 컬럼으로 옮긴 오더를 못 찾습니다')
      .toContain('accessionNumber');
    expect(JSON.stringify(where.where), '컬럼 도입 이전 건(notes 잔재)도 봐야 합니다').toContain('notes');
  });

  it('매칭되면 판독을 반영하고 matched:true 를 답한다(대조군 — 성공을 실패로 말하지 않는다)', async () => {
    const prisma = mkPrisma({ id: 'o1', prescription: null });
    const ctrl = new PacsWebhookController(prisma as never, auth as never, emitter as never);
    const res = await ctrl.onReportCompleted('secret', { accession_number: 'A1', finding: 'f', impression: 'i' } as never);
    expect(res.data.matched).toBe(true);
    expect(prisma.imagingResult.updateMany).toHaveBeenCalled();
  });

  it('🔴 매칭 실패를 침묵하지 않는다 — matched:false + 드리프트 원장', async () => {
    const prisma = mkPrisma(null);
    const drift = { record: vi.fn() };
    const ctrl = new PacsWebhookController(prisma as never, auth as never, emitter as never, drift as never);
    const res = await ctrl.onReportCompleted('secret', { accession_number: 'A-GHOST' } as never);
    expect(res.data.matched).toBe(false);
    expect(drift.record, '어느 오더에도 안 붙은 판독이 아무 데도 안 남습니다').toHaveBeenCalledTimes(1);
    const sig = drift.record.mock.calls[0][0] as { consumer: string };
    expect(sig.consumer).toBe('pacs-webhook.orderLookup');
  });

  it('세 웹훅 전부 같은 조회 규칙을 쓴다(한 곳만 고치면 갈라진다)', () => {
    const src = readFileSync(join(process.cwd(), 'src/modules/pacs-proxy/pacs-webhook.controller.ts'), 'utf8');
    const uses = src.match(/this\.orderByAccession\(/g) ?? [];
    expect(uses.length, 'study-received·report-completed·study-updated 세 곳 전부').toBeGreaterThanOrEqual(3);
    expect(src, 'notes 단독 조회가 되살아났습니다').not.toMatch(/where:\s*\{\s*notes:\s*\{\s*contains/);
  });
});
