/**
 * 오더 실시간 추적(2026-10-06).
 *  · 모집단 = 고른 날 발행분 ∪ 아직 끝나지 않은 오더(날짜 무관 — 어제 낸 STAT 이 사라지지 않는다)
 *  · 국면: 발행=접수 대기 · 접수/시행=진행 · 검사·영상 완료+확인 없음=결과 미확인 · 그 밖 완료 · 취소
 *  · 경과는 활성에만 · 끝난 오더는 발행→마지막 단계 · 주의는 기준(config)이 있을 때만 — 없으면 null(판정 안 함)
 *  · 매트릭스는 STAT·위급·가장 오래된 대기 순 · 잘리면 truncated
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { OrderTrackingService } from '../../src/modules/order/order-tracking.service';

const NOW = new Date('2026-10-06T03:00:00Z'); // KST 12:00
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000);
const pt = (id: string) => ({ patientId: id, admissionId: null, visitType: null, admission: null, patient: { id, mrn: `M-${id}`, familyName: '김', givenName: id }, doctor: { familyName: '박', givenName: '의사' } });
const order = (over: Record<string, unknown>) => ({
  id: Math.random().toString(36).slice(2), department: 'LAB', status: 'ORDERED', priority: 'ROUTINE', createdAt: ago(30),
  receivedAt: null, startedAt: null, completedAt: null, cancelledAt: null, acknowledgedAt: null, specimenCollectedAt: null, specimenCollectionSource: null,
  prescription: { type: 'LAB', priority: 'ROUTINE', medicationCode: null, procedureCode: { nameKo: 'CBC' }, encounter: pt('p1') },
  labResult: null, imagingResult: null, dispensing: null,
  ...over,
});

function mk(rows: unknown[], cfg: unknown = null, total?: number) {
  const prisma: any = {
    order: { count: vi.fn(async () => total ?? rows.length), findMany: vi.fn(async () => rows) },
  };
  const orders: any = { withCareContext: vi.fn(async (xs: any[]) => xs.map((x) => ({ ...x, careContext: 'OUTPATIENT' }))) };
  const config: any = { get: vi.fn(async () => cfg) };
  return { svc: new OrderTrackingService(prisma, orders, config), prisma };
}

describe('오더 실시간 추적', () => {
  it('🔴 모집단 — 고른 날 발행분 ∪ 아직 끝나지 않은 오더(날짜 무관)', async () => {
    const { svc, prisma } = mk([]);
    await svc.getTracking('2026-10-06', undefined, NOW);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { createdAt: { gte: expect.any(Date), lt: expect.any(Date) } },
      { status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } },
    ]);
  });

  it('🔴 국면 — 대기·진행·결과 미확인(검사·영상만)·완료·취소', async () => {
    const rows = [
      order({ id: 'w', status: 'ORDERED' }),
      order({ id: 'p', status: 'RECEIVED', receivedAt: ago(10) }),
      order({ id: 'u', status: 'COMPLETED', receivedAt: ago(25), completedAt: ago(5) }),
      order({ id: 'a', status: 'COMPLETED', receivedAt: ago(25), completedAt: ago(5), acknowledgedAt: ago(1) }),
      order({ id: 'rx', department: 'PHARMACY', status: 'COMPLETED', dispensing: { status: 'ISSUED', dispensedAt: ago(20), verifiedAt: ago(15), issuedAt: ago(10) } }),
      order({ id: 'c', status: 'CANCELLED', cancelledAt: ago(2) }),
    ];
    const r = await mk(rows).svc.getTracking('2026-10-06', undefined, NOW);
    const ph = Object.fromEntries(r.orders.map((o) => [o.id, o.phase]));
    expect(ph).toEqual({ w: 'WAITING', p: 'IN_PROCESS', u: 'RESULT_UNACK', a: 'DONE', rx: 'DONE', c: 'CANCELLED' });
    expect(r.summary).toMatchObject({ active: 3, waiting: 1, inProcess: 1, resultUnack: 1, done: 2, cancelled: 1 });
  });

  it('🔴 경과는 활성에만 · 지금 단계·다음 단계 · 끝난 오더는 발행→마지막 단계', async () => {
    const rows = [
      order({ id: 'p', status: 'RECEIVED', createdAt: ago(40), receivedAt: ago(10) }),
      order({ id: 'rx', department: 'PHARMACY', status: 'COMPLETED', createdAt: ago(60), dispensing: { status: 'ISSUED', dispensedAt: ago(30), verifiedAt: ago(25), issuedAt: ago(20) } }),
    ];
    const r = await mk(rows).svc.getTracking('2026-10-06', undefined, NOW);
    const p = r.orders.find((o) => o.id === 'p')!;
    expect(p).toMatchObject({ inStageMin: 10, sinceOrderedMin: 40, totalMin: null, next: 'COLLECTED' });
    expect(p.current?.key).toBe('RECEIVED');
    const rx = r.orders.find((o) => o.id === 'rx')!;
    expect(rx).toMatchObject({ inStageMin: null, sinceOrderedMin: null, totalMin: 40 });
  });

  it('🔴 주의 — 기준이 없으면 null(판정 안 함) · 있으면 긴급도별 · 기준 없는 긴급도는 null', async () => {
    const rows = [order({ id: 's', priority: 'STAT', createdAt: ago(40) }), order({ id: 'r', priority: 'ROUTINE', createdAt: ago(400) })];
    const none = await mk(rows).svc.getTracking('2026-10-06', undefined, NOW);
    expect(none.orders.map((o) => o.attention)).toEqual([null, null]);
    expect(none.attention.configured).toBe(false);
    expect(none.summary.attention).toBeNull();
    const set = await mk(rows, { STAT: 30, BOGUS: 5 }).svc.getTracking('2026-10-06', undefined, NOW);
    expect(set.orders.find((o) => o.id === 's')!.attention).toBe(true);
    expect(set.orders.find((o) => o.id === 'r')!.attention).toBeNull();
    expect(set.attention.thresholds).toEqual({ STAT: 30 });
  });

  it('어제 발행된 활성 오더는 carriedOver · 위급 플래그 · 부서 요약 중앙값(표본 수)', async () => {
    const rows = [
      order({ id: 'old', createdAt: new Date('2026-10-05T01:00:00Z') }),
      order({ id: 'cr', status: 'COMPLETED', createdAt: ago(100), completedAt: ago(40), labResult: { status: 'COMPLETED', collectedAt: null, completedAt: ago(40), verifiedAt: null, items: [{ flag: 'HH' }] } }),
    ];
    const r = await mk(rows).svc.getTracking('2026-10-06', undefined, NOW);
    expect(r.orders.find((o) => o.id === 'old')!.carriedOver).toBe(true);
    expect(r.orders.find((o) => o.id === 'cr')!.critical).toBe(true);
    const lab = r.lanes.find((l) => l.department === 'LAB')!;
    expect(lab.turnaroundMin).toEqual({ value: 60, n: 1 });
    expect(r.lanes.find((l) => l.department === 'IMAGING')!.turnaroundMin).toEqual({ value: null, n: 0 });
  });

  it('🔴 매트릭스 — 환자×부서 칸 · STAT 있는 환자가 먼저 · 잘리면 truncated', async () => {
    const rows = [
      order({ id: 'a1', createdAt: ago(300), prescription: { type: 'LAB', priority: 'ROUTINE', procedureCode: { nameKo: 'CBC' }, encounter: pt('A') } }),
      order({ id: 'b1', priority: 'STAT', department: 'IMAGING', createdAt: ago(5), prescription: { type: 'IMAGING', priority: 'STAT', procedureCode: { nameKo: 'CT' }, encounter: pt('B') } }),
    ];
    const r = await mk(rows, null, 900).svc.getTracking('2026-10-06', undefined, NOW);
    expect(r.matrix.map((m) => m.patient.id)).toEqual(['B', 'A']);
    expect(r.matrix[0].cells.IMAGING).toMatchObject({ total: 1, stat: 1 });
    expect(r.matrix[0].cells.LAB).toBeNull();
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(900);
  });

  it('날짜·부서 형식이 틀리면 400', async () => {
    const { svc } = mk([]);
    await expect(svc.getTracking('2026/10/06', undefined, NOW)).rejects.toThrow(/YYYY-MM-DD/);
    await expect(svc.getTracking(undefined, 'KITCHEN', NOW)).rejects.toThrow(/부서/);
  });
});

describe('환자 표시·확인 사항(2026-10-06)', () => {
  it('🔴 외국 이름은 띄어 쓰고 한국식 호칭을 함께 · 매트릭스 행에 위치·진료의·확인 사항', async () => {
    const foreign = { patientId: 'F', admissionId: 'adm', visitType: null,
      admission: { bed: { roomNumber: '501', bedNumber: 'A', ward: { name: '5층 내과병동' } } },
      patient: { id: 'F', mrn: 'FT-4', familyName: 'Бат-Эрдэнэ', givenName: 'Сарнай', koreanName: '사르나이', dateOfBirth: new Date('1990-01-01'), gender: 'FEMALE' },
      doctor: { familyName: '박', givenName: '의사' } };
    const rows = [order({ id: 's', priority: 'STAT', status: 'RECEIVED', receivedAt: ago(5), createdAt: ago(40), prescription: { type: 'IMAGING', priority: 'STAT', procedureCode: { nameKo: 'CT' }, encounter: foreign }, department: 'IMAGING' })];
    const r = await mk(rows).svc.getTracking('2026-10-06', undefined, NOW);
    expect(r.orders[0].patient).toMatchObject({ name: 'Бат-Эрдэнэ Сарнай', koreanName: '사르나이', gender: 'FEMALE' });
    expect(r.orders[0].patient!.age).toBeGreaterThan(30);
    const m = r.matrix[0];
    expect(m.location).toEqual({ ward: '5층 내과병동', room: '501', bed: 'A' });
    expect(m.doctors).toEqual(['박의사']);
    expect(m.notes[0]).toMatchObject({ code: 'STAT_ACTIVE', level: 'URGENT', count: 1, minutes: 40 });
  });
});

describe('환자 드릴다운(2026-10-06)', () => {
  const detailRow = (over: Record<string, unknown>) => order({
    notes: null, receiver: { familyName: '이', givenName: '검사' }, starter: null, completer: { familyName: '이', givenName: '검사' }, acknowledger: null, canceller: null,
    ...over,
  });
  it('🔴 최근 7일 ∪ 끝나지 않은 오더 · 그 환자만', async () => {
    const { svc, prisma } = mk([]);
    prisma.patient = { findUnique: vi.fn(async () => ({ id: 'p1' })) };
    await svc.getPatientDetail('p1', NOW);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.prescription).toEqual({ encounter: { patientId: 'p1' } });
    expect(where.OR[1]).toEqual({ status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } });
    expect(where.OR[0].createdAt.gte.getTime()).toBe(NOW.getTime() - 7 * 86400_000);
  });

  it('🔴 결과는 원장 값 그대로(수치·플래그·참고 범위 문자열 · 범위 없으면 null) · 사람 · 처방 세부 · DUR 문구/사유', async () => {
    const rows = [
      detailRow({ id: 'lab', status: 'COMPLETED', completedAt: ago(5), receivedAt: ago(30),
        labResult: { status: 'COMPLETED', collectedAt: null, completedAt: ago(5), verifiedAt: null, items: [
          { testName: 'K', value: '6.81', unit: 'mmol/L', flag: 'HH', normalMin: { toString: () => '3.5' }, normalMax: { toString: () => '5.1' } },
          { testName: 'Memo', value: 'pos', unit: '', flag: null, normalMin: null, normalMax: null },
        ] } }),
      detailRow({ id: 'rx', department: 'PHARMACY', prescription: { id: 'rx1', type: 'MEDICATION', priority: 'ROUTINE', durChecked: true, durWarnings: [{ message: '병용금기' }, '임부금기'], durOverridden: true, durOverrideReason: null,
        dosage: '1', frequency: 'TID', route: 'PO', duration: 3, quantity: 9, medicationCode: { nameKo: '와파린' }, procedureCode: null, encounter: pt('p1') } }),
    ];
    const { svc } = mk(rows);
    const r = await svc.getPatientDetail('p1', NOW);
    const lab = r.orders.find((o) => o.id === 'lab')!;
    expect(lab.lab!.items[0]).toEqual({ name: 'K', value: '6.81', unit: 'mmol/L', flag: 'HH', range: { min: '3.5', max: '5.1' } });
    expect(lab.lab!.items[1].range).toBeNull();
    expect(lab.critical).toBe(true);
    expect(lab.phase).toBe('RESULT_UNACK');
    expect(lab.people).toMatchObject({ received: '이검사', completed: '이검사', acknowledged: null });
    const rx = r.orders.find((o) => o.id === 'rx')!;
    expect(rx.prescription).toMatchObject({ dosage: '1', frequency: 'TID', durWarnings: ['병용금기', '임부금기'], durOverridden: true, durOverrideReason: null });
    expect(r.notes.map((n) => n.code)).toEqual(expect.arrayContaining(['CRITICAL_UNACK', 'DUR_OVERRIDDEN']));
    expect(r.patient!.id).toBe('p1');
  });

  it('없는 환자는 404 · 오더가 없을 뿐이면 빈 목록', async () => {
    const a = mk([]); a.prisma.patient = { findUnique: vi.fn(async () => null) };
    await expect(a.svc.getPatientDetail('nope', NOW)).rejects.toThrow(/환자를 찾을 수 없습니다/);
    const b = mk([]); b.prisma.patient = { findUnique: vi.fn(async () => ({ id: 'p9' })) };
    expect((await b.svc.getPatientDetail('p9', NOW)).orders).toEqual([]);
  });
});
