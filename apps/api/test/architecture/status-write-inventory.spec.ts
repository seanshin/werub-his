import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { prismaModelNames, scanRawStatusUpdates, scanStatusWrites, scanStatusWritesInSource, uncheckedByFile } from './status-write-scan';
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';
import { STATUS_WRITE_UNCHECKED_BASELINE, STATUS_WRITE_TOTAL_BASELINE } from './status-write-inventory.baseline';

/**
 * 🔴 상태를 **읽지 않고 쓰는** 자리의 기준선(2026-09-15 D1 전수).
 *
 * 이 저장소에서 같은 기전이 반복해 나왔다 — 취소된 치료 오더가 완료로 뒤집혀 취소한 치료가 청구되고(P3),
 * 거절된 당직 교대가 다시 승인되고(N3), 확정된 코드 매핑이 거부로 뒤집히고(B10), 종결된 협진에 회신이
 * 덮어써지고 사망 등록이 ACTIVE 로 되돌아갔다(D1). 전부 "현재 상태를 보지 않는다" 하나다.
 *
 * 🔴 **이 수는 상한이지 결함 수가 아니다.** 생성 직후 첫 전이·관리 토글·크론 일괄 갱신은 정당하다.
 *    지키는 것은 하나 — **늘지 않는다**. 새 상태 쓰기를 만들 때는 현재 상태를 읽고 쓰거나(전이 정본),
 *    `updateMany({ where: { id, status: 현재 } })` 로 DB 가 경합을 판정하게 한다(`common/state-transition.ts`).
 */
const MODULES = path.join(__dirname, '..', '..', 'src', 'modules');

describe('🔴 상태 전이 — 읽지 않고 쓰는 자리는 늘지 않는다', () => {
  const rows = scanStatusWrites(MODULES);

  it('대조군 — 스캐너가 실제로 상태 쓰기를 찾는다(0건이면 이 가드는 아무것도 지키지 않는다)', () => {
    expect(rows.length).toBeGreaterThan(300);
    // 분류가 전부 한 칸으로 몰리면(예: 전건 '검사안함') 분류기가 죽은 것이다
    const canon = rows.filter((r) => r.cls === '정본' || r.cls === '조건부').length;
    expect(canon).toBeGreaterThan(50);
  });

  it('전체 상태 쓰기 수가 기준선과 같다(늘면 새 경로 · 줄면 이 수를 내린다)', () => {
    expect(rows.length).toBe(STATUS_WRITE_TOTAL_BASELINE);
  });

  it('파일별 "검사안함" 수가 기준선과 정확히 같다', () => {
    const actual = uncheckedByFile(rows);
    // 늘어난 파일·새로 들어온 파일을 그대로 보여준다(합계만 맞추면 어디가 늘었는지 묻히다)
    expect(actual).toEqual(STATUS_WRITE_UNCHECKED_BASELINE);
  });

  it('D1 에서 고친 자리는 더 이상 "검사안함" 이 아니다(재주입 시 이 목록에 다시 나타난다)', () => {
    const fixed = [
      'transfer/transfer.service.ts',
      'consultation/consultation.service.ts',
      'hospice/hospice.service.ts',
      'pharmacy/pharmacy.service.ts',
      'inventory/inventory.service.ts',
    ];
    const unchecked = uncheckedByFile(rows);
    const before: Record<string, number> = {
      'transfer/transfer.service.ts': 5,
      'consultation/consultation.service.ts': 2,
      'hospice/hospice.service.ts': 2,
      'pharmacy/pharmacy.service.ts': 5,
      'inventory/inventory.service.ts': 4,
    };
    for (const f of fixed) expect(unchecked[f] ?? 0).toBeLessThan(before[f]);
  });
});

/**
 * 🔴 계측 사각 봉합(2026-10-01) — 종전 수신자는 `tx|prisma|this.prisma|this.tx` 고정이라 트랜잭션 콜백을 다른 이름으로 받거나
 *    `const db = client ?? this.prisma` 별칭으로 쓰면 **세어지지도 않았다**. 원문 SQL 의 상태 쓰기도 보지 않았다.
 *    실측(2026-10-01): 둘 다 0건 — 지금 새는 것은 없다. 아래는 앞으로 새지 않게 하는 대조군이다.
 * 재주입: CALL 수신자를 옛 고정 목록으로 되돌리면 '별칭 수신자' 대조군이 실패한다.
 */
describe('🔴 상태 쓰기 계측 — 수신자 이름·원문 SQL 사각', () => {
  const models = prismaModelNames(path.join(__dirname, '..', '..', 'prisma', 'schema.prisma'));
  const src = (recv: string) => `class X {\n  async go() {\n    await ${recv}.order.update({ where: { id }, data: { status: 'DONE' } });\n  }\n}\n`;

  it('대조군 — 스키마 모델 이름을 읽는다', () => {
    expect(models.size).toBeGreaterThan(500);
    expect(models.has('order')).toBe(true);
  });

  it.each(['tx', 'prisma', 'this.prisma', 't', 'trx', 'db', 'client', 'this.db'])('별칭 수신자 `%s` 의 상태 쓰기도 센다', (recv) => {
    expect(scanStatusWritesInSource(src(recv), 'x.ts', models)).toEqual([expect.objectContaining({ model: 'order', op: 'update', cls: '검사안함' })]);
  });

  it('모델이 아닌 둘째 마디는 세지 않는다(서비스 메서드 호출 오탐 방지)', () => {
    expect(scanStatusWritesInSource(src('this.orderService'), 'x.ts', models)).toHaveLength(1); // .order 는 모델
    const notModel = `class X {\n  async go() {\n    await this.service.notAModel.update({ data: { status: 'X' } });\n  }\n}\n`;
    expect(scanStatusWritesInSource(notModel, 'x.ts', models)).toEqual([]);
  });

  it('원문 SQL 의 상태 쓰기 — 0 으로 동결(주석은 세지 않는다)', () => {
    expect(scanRawStatusUpdates(MODULES, stripComments)).toEqual([]);
  });

  it('대조군 — 원문 SQL 탐지기가 실제로 잡는다', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-status-'));
    fs.writeFileSync(path.join(tmp, 'a.ts'), "await this.prisma.$executeRaw`UPDATE orders SET status = 'DONE' WHERE id = ${id}`;\n// UPDATE orders SET status = 'X'\n");
    expect(scanRawStatusUpdates(tmp, stripComments)).toEqual([{ file: 'a.ts', line: 1 }]);
  });
});
