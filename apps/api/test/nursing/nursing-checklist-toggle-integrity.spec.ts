import { describe, it, expect, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NursingService } from '../../src/modules/nursing/nursing.service';

/**
 * 간호 체크리스트 항목 체크(2026-09-15 N3).
 * 🔴 ① 경로의 입원 id 를 버리고 체크리스트 id 만으로 갱신 — 다른 입원의 체크리스트를 체크할 수 있었다(IDOR).
 * 🔴 ② 누가 체크했는지 남지 않았다(시각만). ③ 범위 밖 index 는 `throw new Error` 로 500.
 */
const ADM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function mk() {
  const row = { id: CL, admissionId: ADM, items: [{ item: 'A', checked: false }, { item: 'B', checked: true, checkedBy: 'x', checkedAt: '2026-09-15T00:00:00Z' }], checkedItems: 1 };
  const prisma: any = {
    nursingChecklist: {
      // 넘겨받은 조건만 평가한다 — 조건을 빠뜨린 코드는 다른 입원의 행을 그대로 받는다(실제 Prisma 와 같다)
      findFirst: vi.fn(async ({ where }: any) =>
        (Object.entries(where).every(([k, v]) => (row as any)[k] === v) ? JSON.parse(JSON.stringify(row)) : null)),
      findUniqueOrThrow: vi.fn(async () => JSON.parse(JSON.stringify(row))),
      update: vi.fn(async ({ data }: any) => ({ ...row, ...data })),
    },
    $queryRaw: vi.fn(async () => []),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: any) => unknown) => fn(prisma));
  const svc: any = Object.create(NursingService.prototype);
  svc.prisma = prisma;
  return { svc, prisma };
}

describe('🔴 체크리스트 항목 체크 — 소속·행위자·입력 범위', () => {
  it('대조군 — 같은 입원이면 체크되고 checkedBy=로그인 사용자', async () => {
    const { svc, prisma } = mk();
    await svc.toggleChecklistItem(ADM, CL, 0, { checked: true }, 'nurse-1');
    const items = prisma.nursingChecklist.update.mock.calls[0][0].data.items;
    expect(items[0].checked).toBe(true);
    expect(items[0].checkedBy).toBe('nurse-1');
    expect(items[0].checkedAt).toBeTruthy();
  });

  it('🔴 다른 입원 경로로는 404 · 갱신하지 않는다', async () => {
    const { svc, prisma } = mk();
    await expect(svc.toggleChecklistItem(OTHER, CL, 0, { checked: true }, 'nurse-1')).rejects.toThrow(NotFoundException);
    expect(prisma.nursingChecklist.update).not.toHaveBeenCalled();
  });

  it('해제하면 checkedBy·checkedAt 이 비워진다', async () => {
    const { svc, prisma } = mk();
    await svc.toggleChecklistItem(ADM, CL, 1, { checked: false }, 'nurse-2');
    const items = prisma.nursingChecklist.update.mock.calls[0][0].data.items;
    expect(items[1].checkedBy).toBeNull();
    expect(items[1].checkedAt).toBeNull();
  });

  it('🔴 범위 밖 index 는 500 이 아니라 400', async () => {
    const { svc } = mk();
    await expect(svc.toggleChecklistItem(ADM, CL, 5, { checked: true }, 'n')).rejects.toThrow(BadRequestException);
    await expect(svc.toggleChecklistItem(ADM, CL, Number.NaN, { checked: true }, 'n')).rejects.toThrow(BadRequestException);
  });
});

/**
 * 🔴 (2026-09-15 M3) 동시 체크 유실 — 항목 JSON 을 통째로 읽고 쓰므로, 두 간호사가 **다른 항목**을 거의 동시에 체크하면
 *    나중에 쓴 쪽이 먼저 쓴 쪽의 체크를 지웠다(둘 다 성공 응답). 행 잠금(`FOR UPDATE`)으로 직렬화한다.
 *    목은 실제 DB 처럼 동작한다: `FOR UPDATE` 는 트랜잭션이 끝날 때까지 같은 행의 다른 잠금을 기다리게 하고,
 *    읽기와 쓰기 사이에 이벤트 루프를 양보해 경합이 실제로 생기게 한다(잠금이 없으면 두 읽기가 쓰기보다 먼저 끝난다).
 */
function mkShared() {
  let row: any = { id: CL, admissionId: ADM, items: [{ item: 'A', checked: false }, { item: 'B', checked: false }], checkedItems: 0 };
  let lock: Promise<void> = Promise.resolve();
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const makeTx = () => ({
    /** FOR UPDATE — 앞선 잠금이 풀릴 때까지 기다리고, 풀기 함수를 돌려준다 */
    $queryRaw: vi.fn(async () => {
      const prev = lock;
      let release!: () => void;
      const mine = new Promise<void>((r) => { release = r; });
      lock = prev.then(() => mine);
      await prev;
      return release;
    }),
    nursingChecklist: {
      findFirst: vi.fn(async ({ where }: any) => {
        const snap = (Object.entries(where).every(([k, v]) => row[k] === v) ? JSON.parse(JSON.stringify(row)) : null);
        await tick();
        return snap;
      }),
      update: vi.fn(async ({ data }: any) => { await tick(); row = { ...row, ...JSON.parse(JSON.stringify(data)) }; return row; }),
    },
  });
  const prisma: any = {
    $transaction: vi.fn(async (fn: (tx: any) => unknown) => {
      let releaseFn: (() => void) | null = null;
      const tx: any = makeTx();
      const origLock = tx.$queryRaw;
      tx.$queryRaw = vi.fn(async (...a: unknown[]) => { releaseFn = (await origLock(...a)) as () => void; return []; });
      try { return await fn(tx); } finally { releaseFn?.(); }
    }),
  };
  // 잠금 없이 prisma 를 직접 쓰는 코드(재주입)도 같은 행을 보게 한다
  const direct = makeTx();
  prisma.nursingChecklist = direct.nursingChecklist;
  const svc: any = Object.create(NursingService.prototype);
  svc.prisma = prisma;
  return { svc, get row() { return row; } };
}

describe('🔴 동시 체크 — 한쪽 체크가 사라지지 않는다', () => {
  it('두 간호사가 다른 항목을 동시에 체크하면 두 체크가 모두 남는다', async () => {
    const h = mkShared();
    await Promise.all([
      h.svc.toggleChecklistItem(ADM, CL, 0, { checked: true }, 'nurse-1'),
      h.svc.toggleChecklistItem(ADM, CL, 1, { checked: true }, 'nurse-2'),
    ]);
    expect(h.row.items[0].checked).toBe(true);
    expect(h.row.items[1].checked).toBe(true);
    expect(h.row.items[0].checkedBy).toBe('nurse-1');
    expect(h.row.items[1].checkedBy).toBe('nurse-2');
    expect(h.row.checkedItems).toBe(2);
  });

  it('대조군 — 한 명만 체크하면 그 항목만 체크된다', async () => {
    const h = mkShared();
    await h.svc.toggleChecklistItem(ADM, CL, 1, { checked: true }, 'nurse-2');
    expect(h.row.items[0].checked).toBe(false);
    expect(h.row.items[1].checked).toBe(true);
    expect(h.row.checkedItems).toBe(1);
  });
});
