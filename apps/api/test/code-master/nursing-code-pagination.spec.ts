import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeMasterService } from '../../src/modules/code-master/code-master.service';
import { CodeSynonymService } from '../../src/modules/code-master/code-synonym.service';
import { CodeUsageService } from '../../src/modules/code-master/code-usage.service';
import { CodeMasterController } from '../../src/modules/code-master/code-master.controller';

/**
 * 🔴 W8 — 간호코드 검색이 `take: 100` 하나뿐이었다. 운영 167건(ICF 13·MedDRA 34·NANDA_I 58·
 *    NIC 50·NOC 12)을 `codeSystem asc` 로 자르면 **NIC 50 과 NOC 12 가 통째로 사라졌고**,
 *    화면은 잘렸다는 말도 하지 않았다. 상한으로 항목이 조용히 없어지면 안 된다.
 */

const ROWS = Array.from({ length: 167 }, (_, i) => ({ id: `n${i}`, code: `C${i}` }));

describe('간호코드 검색 — 상한으로 항목이 사라지지 않는다', () => {
  let prisma: {
    nursingCode: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  };
  let service: CodeMasterService;

  beforeEach(() => {
    prisma = {
      nursingCode: {
        findMany: vi.fn(async (args: { skip?: number; take?: number }) => ROWS.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? 100))),
        count: vi.fn().mockResolvedValue(ROWS.length),
      },
    };
    service = new CodeMasterService(
      prisma as never,
      new CodeUsageService(prisma as never),
      new CodeSynonymService(prisma as never),
    );
  });

  it('총건수를 함께 돌려준다 — 화면이 잘림을 알 수 있다', async () => {
    const r = await service.searchNursingCodes(undefined, undefined, undefined, 100, 1);
    expect(r.total).toBe(167);
    expect(r.items).toHaveLength(100);
    expect(r.hasMore).toBe(true);
  });

  it('🔴 페이지를 넘기면 전건에 도달한다 (167건 전부)', async () => {
    const seen = new Set<string>();
    let page = 1;
    for (;;) {
      const r = await service.searchNursingCodes(undefined, undefined, undefined, 20, page);
      r.items.forEach((i) => seen.add((i as { id: string }).id));
      if (!r.hasMore) break;
      page++;
      expect(page).toBeLessThan(50); // 무한루프 방지
    }
    expect(seen.size).toBe(167);
  });

  it('상한은 남기되 폭주하지 않는다(최대 500·최소 1)', async () => {
    expect((await service.searchNursingCodes(undefined, undefined, undefined, 99999, 1)).limit).toBe(500);
    expect((await service.searchNursingCodes(undefined, undefined, undefined, 0, 0)).limit).toBe(100);
  });

  it('컨트롤러가 pagination 을 응답에 실어 보낸다', async () => {
    const ctrl = new CodeMasterController(service, {} as never);
    const res = await ctrl.searchNursingCodes(undefined, undefined, undefined, '20', '2');
    expect(res.pagination).toMatchObject({ total: 167, page: 2, limit: 20, hasMore: true });
    expect(Array.isArray(res.data)).toBe(true);
  });
});
