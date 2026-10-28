import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException, ValidationPipe, BadRequestException } from '@nestjs/common';
import { DoctorsService } from '../../src/modules/doctors/doctors.service';
import { BulkAcknowledgeOrdersDto, ResultsInboxQueryDto } from '../../src/modules/doctors/dto/results-inbox.dto';
import { matchesWhere } from '../common/prisma-where-eval';

/**
 * 검사결과 확인함 — 2026-09-30.
 *
 * 🔴 `PATCH doctors/orders/:id/acknowledge` 는 있었는데 부르는 화면이 없어 센서스의 "미확인 검사 N건"을
 *    줄일 방법이 없었다. 여기서 지키는 것:
 *  ① "내 오더" = 책임 처방의·입력자·진료 담당의 중 하나가 나인 오더 — 남의 오더가 섞이지 않는다
 *  ② 위급 → 이상 → 그 외 순. **오래된 위급값이 최근 정상 결과에 밀려 잘리지 않는다**
 *  ③ 자르면 자른다고 말한다(total·counts)
 *  ④ 결과 없는 오더는 확인할 수 없다(먼저 확인하면 나중 결과가 숨는다) · 먼저 확인한 사람을 덮어쓰지 않는다
 *  ⑤ 일괄 확인은 실제 확인 수와 건너뜀 수를 돌려준다
 *
 * 목은 실제 prisma 처럼 where 를 **평가**한다(`prisma-where-eval`) — where 모양 대조로는 ②를 증명할 수 없다.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PATIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Item = { testName: string; value: string; unit: string; flag: string | null };
let seq = 0;
function order(o: {
  doctorId?: string; prescriberId?: string | null; createdBy?: string;
  department?: 'LAB' | 'IMAGING' | 'PHARMACY';
  status?: string; acknowledgedAt?: Date | null; cancelledAt?: Date | null;
  completedAt: Date; items?: Item[]; patientId?: string; labStatus?: string;
}) {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const dept = o.department ?? 'LAB';
  const patientId = o.patientId ?? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  return {
    id,
    department: dept,
    priority: 'ROUTINE',
    status: o.status ?? 'COMPLETED',
    acknowledgedAt: o.acknowledgedAt ?? null,
    acknowledgedBy: null as string | null,
    cancelledAt: o.cancelledAt ?? null,
    completedAt: o.completedAt,
    createdAt: o.completedAt,
    labResult: dept === 'LAB'
      ? { id: `lr-${seq}`, status: o.labStatus ?? 'COMPLETED', completedAt: o.completedAt, verifiedAt: null, items: o.items ?? [{ testName: 'Na', value: '140', unit: 'mmol/L', flag: 'N' }] }
      : null,
    imagingResult: dept === 'IMAGING'
      ? { id: `ir-${seq}`, status: 'REPORTED', modality: 'CT', bodyPart: 'Chest', impression: 'no acute finding', reportedAt: o.completedAt }
      : null,
    prescription: {
      id: `rx-${seq}`, type: 'LAB', instructions: `검사-${seq}`,
      prescriberId: o.prescriberId ?? null,
      createdBy: o.createdBy ?? OTHER,
      procedureCode: { code: `C${seq}`, nameKo: `검사명-${seq}` },
      encounter: {
        id: `enc-${seq}`, doctorId: o.doctorId ?? OTHER, patientId,
        patient: { id: patientId, familyName: '홍', givenName: `길동${seq}`, mrn: `MRN${seq}` },
      },
    },
  };
}
type Row = ReturnType<typeof order>;

/** where 를 평가하는 인메모리 prisma(order 만) */
function fakePrisma(rows: Row[]) {
  const sortDesc = (a: Row, b: Row) =>
    b.completedAt.getTime() - a.completedAt.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);
  const prisma = {
    order: {
      count: vi.fn(async ({ where }: any) => rows.filter((r) => matchesWhere(r, where)).length),
      findMany: vi.fn(async ({ where, skip = 0, take }: any) =>
        rows.filter((r) => matchesWhere(r, where)).sort(sortDesc).slice(skip, take == null ? undefined : skip + take)),
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => matchesWhere(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
  };
  return prisma;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

describe('① 내 오더 범위', () => {
  it('처방의·입력자·진료 담당의 중 하나가 나인 오더만 — 남의 오더는 빠진다', async () => {
    const rows = [
      order({ doctorId: ME, completedAt: minutesAgo(1) }),
      order({ prescriberId: ME, completedAt: minutesAgo(2) }),
      order({ createdBy: ME, completedAt: minutesAgo(3) }),
      order({ completedAt: minutesAgo(4) }), // 전부 OTHER
    ];
    const svc = new DoctorsService(fakePrisma(rows) as never);
    const r = await svc.getResultsInbox(ME);
    expect(r.scope).toBe('MINE');
    expect(r.total).toBe(3);
    expect(r.items.map((i) => i.orderId).sort()).toEqual(rows.slice(0, 3).map((x) => x.id).sort());
    expect(r.items.every((i) => i.orderedByMe)).toBe(true);
  });

  it('확인된 것·결과 없는 것·취소된 것·약 오더는 목록에 없다', async () => {
    const rows = [
      order({ doctorId: ME, completedAt: minutesAgo(1) }),
      order({ doctorId: ME, completedAt: minutesAgo(1), acknowledgedAt: minutesAgo(0) }),
      order({ doctorId: ME, completedAt: minutesAgo(1), status: 'IN_PROGRESS' }),
      order({ doctorId: ME, completedAt: minutesAgo(1), cancelledAt: minutesAgo(0) }),
      order({ doctorId: ME, completedAt: minutesAgo(1), department: 'PHARMACY' }),
    ];
    const r = await new DoctorsService(fakePrisma(rows) as never).getResultsInbox(ME);
    expect(r.items.map((i) => i.orderId)).toEqual([rows[0].id]);
  });

  it('patientId 를 주면 그 환자의 미확인 결과 전부(처방의 무관) — 센서스 숫자와 같은 정의', async () => {
    const rows = [
      order({ patientId: PATIENT_A, completedAt: minutesAgo(1) }), // 남의 오더
      order({ patientId: PATIENT_A, doctorId: ME, completedAt: minutesAgo(2) }),
      order({ doctorId: ME, completedAt: minutesAgo(3) }), // 다른 환자
    ];
    const r = await new DoctorsService(fakePrisma(rows) as never).getResultsInbox(ME, { patientId: PATIENT_A });
    expect(r.scope).toBe('PATIENT');
    expect(r.total).toBe(2);
    expect(r.items.find((i) => i.orderId === rows[0].id)?.orderedByMe).toBe(false);
  });
});

describe('② 위급 → 이상 → 그 외 · 오래된 위급값이 잘리지 않는다', () => {
  it('🔴 최근 정상 결과 60건 + 이틀 전 위급 1건, 50건 상한 → 위급이 맨 앞에 있다', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 60; i++) rows.push(order({ doctorId: ME, completedAt: minutesAgo(i + 1) }));
    const crit = order({ doctorId: ME, completedAt: minutesAgo(60 * 48), items: [{ testName: 'K', value: '7.1', unit: 'mmol/L', flag: 'HH' }] });
    const abn = order({ doctorId: ME, completedAt: minutesAgo(60 * 30), items: [{ testName: 'Hb', value: '9.0', unit: 'g/dL', flag: 'L' }] });
    rows.push(crit, abn);
    const r = await new DoctorsService(fakePrisma(rows) as never).getResultsInbox(ME, { limit: 50 });
    expect(r.items).toHaveLength(50);
    expect(r.items[0].orderId).toBe(crit.id);
    expect(r.items[0].severity).toBe('CRITICAL');
    expect(r.items[1].orderId).toBe(abn.id);
    expect(r.items[1].severity).toBe('ABNORMAL');
    // ③ 자르면 자른다고 — 총수와 묶음별 수
    expect(r.total).toBe(62);
    expect(r.counts).toEqual({ critical: 1, abnormal: 1, other: 60 });
  });

  it('offset 이 묶음 경계를 넘어도 빠짐·중복 없이 이어진다', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 3; i++) rows.push(order({ doctorId: ME, completedAt: minutesAgo(100 + i), items: [{ testName: 'K', value: '7', unit: '', flag: 'LL' }] }));
    for (let i = 0; i < 4; i++) rows.push(order({ doctorId: ME, completedAt: minutesAgo(50 + i), items: [{ testName: 'Na', value: '150', unit: '', flag: 'H' }] }));
    for (let i = 0; i < 5; i++) rows.push(order({ doctorId: ME, completedAt: minutesAgo(i) }));
    const svc = new DoctorsService(fakePrisma(rows) as never);
    const seen: string[] = [];
    for (let off = 0; off < 12; off += 5) {
      const page = await svc.getResultsInbox(ME, { limit: 5, offset: off });
      seen.push(...page.items.map((i) => i.orderId));
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    const sev = (await svc.getResultsInbox(ME, { limit: 100 })).items.map((i) => i.severity);
    expect(sev).toEqual([...Array(3).fill('CRITICAL'), ...Array(4).fill('ABNORMAL'), ...Array(5).fill('NORMAL')]);
  });

  it('미판정(flag null) 항목이 있으면 "정상"이라 말하지 않는다 · 영상은 판정 없음', async () => {
    const rows = [
      order({ doctorId: ME, completedAt: minutesAgo(1), items: [{ testName: 'X', value: '1', unit: '', flag: null }, { testName: 'Y', value: '1', unit: '', flag: 'N' }] }),
      order({ doctorId: ME, completedAt: minutesAgo(2), department: 'IMAGING' }),
    ];
    const r = await new DoctorsService(fakePrisma(rows) as never).getResultsInbox(ME);
    expect(r.items.map((i) => i.severity)).toEqual(['UNJUDGED', 'NO_FLAG']);
    expect(r.items[0].lab?.unjudgedCount).toBe(1);
  });
});

describe('④ 단건 확인', () => {
  it('🔴 결과가 없는 오더는 409 — 먼저 확인하면 나중에 온 결과가 숨는다', async () => {
    const rows = [order({ doctorId: ME, completedAt: minutesAgo(1), status: 'IN_PROGRESS' })];
    const prisma = fakePrisma(rows);
    await expect(new DoctorsService(prisma as never).acknowledgeOrder(rows[0].id, ME)).rejects.toBeInstanceOf(ConflictException);
    expect(rows[0].acknowledgedAt).toBeNull();
  });

  it('없는 오더는 404', async () => {
    await expect(new DoctorsService(fakePrisma([]) as never).acknowledgeOrder('nope', ME)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('결과 있는 오더는 확인되고 목록에서 빠진다(줄어드는 목록)', async () => {
    const rows = [order({ doctorId: ME, completedAt: minutesAgo(1) }), order({ doctorId: ME, completedAt: minutesAgo(2) })];
    const svc = new DoctorsService(fakePrisma(rows) as never);
    await svc.acknowledgeOrder(rows[0].id, ME);
    expect(rows[0].acknowledgedBy).toBe(ME);
    const r = await svc.getResultsInbox(ME);
    expect(r.total).toBe(1);
    expect(r.items[0].orderId).toBe(rows[1].id);
  });

  it('이미 확인된 건은 먼저 확인한 사람을 덮어쓰지 않는다', async () => {
    const first = minutesAgo(5);
    const rows = [order({ doctorId: ME, completedAt: minutesAgo(10), acknowledgedAt: first })];
    rows[0].acknowledgedBy = OTHER;
    const out = await new DoctorsService(fakePrisma(rows) as never).acknowledgeOrder(rows[0].id, ME);
    expect(out?.acknowledgedBy).toBe(OTHER);
    expect(rows[0].acknowledgedAt).toBe(first);
  });
});

describe('⑤ 일괄 확인', () => {
  it('실제 확인 수와 건너뜀 수를 돌려준다 — 요청 수를 "확인됨"으로 말하지 않는다', async () => {
    const rows = [
      order({ doctorId: ME, completedAt: minutesAgo(1) }),
      order({ doctorId: ME, completedAt: minutesAgo(2), status: 'IN_PROGRESS' }),
      order({ doctorId: ME, completedAt: minutesAgo(3), acknowledgedAt: minutesAgo(0) }),
    ];
    const r = await new DoctorsService(fakePrisma(rows) as never).acknowledgeOrders(rows.map((x) => x.id), ME);
    expect(r).toEqual({ requested: 3, acknowledged: 1, skipped: 2 });
    expect(rows[1].acknowledgedAt).toBeNull();
  });

  it('DTO — 빈 배열·UUID 아닌 id·100건 초과는 400', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const meta = { type: 'body' as const, metatype: BulkAcknowledgeOrdersDto };
    await expect(pipe.transform({ orderIds: [] }, meta)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ orderIds: ['x'] }, meta)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ orderIds: Array.from({ length: 101 }, () => ME) }, meta)).rejects.toBeInstanceOf(BadRequestException);
    // 대조군: 정상 본문은 통과한다
    await expect(pipe.transform({ orderIds: [ME] }, meta)).resolves.toEqual({ orderIds: [ME] });
  });

  it('조회 DTO — limit 은 1~100 정수(문자열 쿼리를 숫자로) · patientId 는 UUID', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const meta = { type: 'query' as const, metatype: ResultsInboxQueryDto };
    await expect(pipe.transform({ limit: '101' }, meta)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ patientId: 'MRN001' }, meta)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ limit: '20', offset: '40' }, meta)).resolves.toMatchObject({ limit: 20, offset: 40 });
  });
});
