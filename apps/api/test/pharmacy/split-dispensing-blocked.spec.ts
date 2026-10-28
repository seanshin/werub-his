import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';

/**
 * 🔴 분할조제는 **배선하면 안 된다** — 지금 구조로는 100% 실패한다(2026-08-26 실측).
 *
 * `Dispensing.orderId` 에 UNIQUE 가 걸려 있는데(`dispensings_order_id_key`,
 * 운영 DB 실측) `dispenseSplitNext` 는 **같은 orderId 로 새 Dispensing 행을 만든다**.
 * → 2회차는 항상 P2002. 운영 `dispensings` 330행 중 `split_seq_no > 1` 인 행 **0건**.
 *
 * 이 가드가 지키는 것: 제약이 그대로인 한 **화면에서 부르지 않는다**.
 * 100% 실패하는 버튼은 기능이 아니라 거짓말이다(사용자는 자기 조작을 의심한다).
 * 제약을 걷어 제대로 고쳤다면 이 가드가 알려주고 함께 갱신하게 한다.
 */

const REPO = join(process.cwd(), '..', '..');
const SCHEMA = readFileSync(join(REPO, 'apps', 'api', 'prisma', 'schema.prisma'), 'utf8');
const WEB_SRC = join(REPO, 'apps', 'web', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Dispensing 모델 블록에서 orderId 줄만 읽는다 */
function dispensingOrderIdLine(): string {
  const start = SCHEMA.indexOf('\nmodel Dispensing {');
  expect(start, 'model Dispensing 를 찾지 못했다').toBeGreaterThan(-1);
  const block = SCHEMA.slice(start, SCHEMA.indexOf('\n}', start));
  const line = block.split('\n').find((l) => /^\s*orderId\s/.test(l));
  expect(line, 'Dispensing.orderId 를 찾지 못했다').toBeTruthy();
  return line as string;
}

describe('분할조제 — 제약이 그대로면 화면이 부르지 않는다', () => {
  const orderIdIsUnique = /@unique/.test(dispensingOrderIdLine());

  it('전제 확인: Dispensing.orderId 는 아직 UNIQUE 다(회차별 행을 만들 수 없다)', () => {
    // 이 단언이 깨졌다면 스키마가 바뀐 것이다 — 분할조제를 제대로 회수할 수 있는지
    // 다시 판정하고(회차 테이블·splitOfId 채우기) 이 가드를 갱신하라.
    expect(orderIdIsUnique).toBe(true);
  });

  it('🔴 웹 어디에서도 /pharmacy/split-dispensing 을 부르지 않는다', () => {
    const callers = walk(WEB_SRC).filter((f) => readFileSync(f, 'utf8').includes('/pharmacy/split-dispensing'));
    expect(callers.map((f) => f.slice(WEB_SRC.length + 1))).toEqual([]);
  });

  it('대조군 — 스캐너는 실제로 파일을 읽는다(정상 경로는 찾아낸다)', () => {
    // 가드가 "아무것도 못 찾아서" 통과하는 것을 막는다: 살아 있는 조제 EP 는 반드시 잡혀야 한다
    const queueCallers = walk(WEB_SRC).filter((f) => readFileSync(f, 'utf8').includes('/api/v1/pharmacy/queue'));
    expect(queueCallers.length).toBeGreaterThan(0);
  });
});

/**
 * 🔴 **화면이 부르지 않는다**는 것과 **아무도 부를 수 없다**는 것은 다른 사실이다.
 *    기존 가드는 앞의 것만 지킨다. 외부 클라이언트·다음 개발자가 이 EP 를 부르면
 *    종전에는 **날것의 P2002**("Unique constraint failed on the fields: (order_id)")가 나갔다 —
 *    부른 쪽은 "구조적으로 아직 성립하지 않는다"를 알 수 없다.
 */
describe('분할조제 2회차 — 부르면 사실을 말한다', () => {
  const svc = (createImpl: () => Promise<unknown>) => {
    const s = Object.create(PharmacyService.prototype) as PharmacyService;
    (s as unknown as { prisma: unknown }).prisma = {
      dispensing: {
        findFirst: async () => ({
          id: 'd1', orderId: 'o1', splitSeqNo: 1, remainingQty: 10,
          totalPrescribedQty: 30, partialQty: 10,
        }),
        create: createImpl,
        findMany: async () => [{ id: 'd1', splitSeqNo: 1 }, { id: 'd2', splitSeqNo: 2 }],
      },
      order: {
        findUnique: async () => ({
          id: 'o1',
          prescription: { id: 'rx1', medicationCode: { id: 'm1', nameKo: '약' }, encounter: { patientId: 'p1' } },
        }),
        // 🔴 정본이 실제로 부르는 것을 채운다 — 빠뜨리면 대조군이 "성공"을 확인하지 못한다
        update: async () => ({ id: 'o1' }),
      },
    };
    return s;
  };

  it('🔴 P2002 를 그대로 흘리지 않고 무엇이 왜 안 되는지 말한다', async () => {
    const s = svc(() => Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })));
    await expect(s.dispenseSplitNext('o1', 'ph1')).rejects.toMatchObject({
      response: {
        code: 'SPLIT_DISPENSING_NOT_AVAILABLE',
        decisionKey: 'pharmacy.splitDispensingSchema',
      },
    });
  });

  it('🔴 "조제 기록은 만들어지지 않았다"를 함께 말한다 — 부른 쪽이 재시도를 판단할 수 있어야 한다', async () => {
    const s = svc(() => Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })));
    await expect(s.dispenseSplitNext('o1', 'ph1')).rejects.toThrow(/만들어지지 않았습니다/);
  });

  it('🔴 대조군: P2002 가 아닌 오류는 삼키지 않고 그대로 올린다', async () => {
    const s = svc(() => Promise.reject(Object.assign(new Error('DB down'), { code: 'P1001' })));
    await expect(s.dispenseSplitNext('o1', 'ph1')).rejects.toThrow(/DB down/);
  });

  it('🔴 대조군: 성공하면 조용하다 — 스키마가 고쳐지면 이 경로는 그냥 지나간다', async () => {
    const s = svc(() => Promise.resolve({ id: 'd2', splitSeqNo: 2 }));
    await expect(s.dispenseSplitNext('o1', 'ph1')).resolves.toMatchObject({ id: 'd2' });
  });
});
