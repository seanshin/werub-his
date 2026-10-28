import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';
import { QueueDisplayService } from '../../src/modules/waiting-queue/queue-display.service';

/**
 * 외래 '진료 시작 시각'(`waiting_queue.started_at`) 원장 가드 — 화면 실사용 점검 W8 잔여.
 *
 * 배경(실측 2026-08-14 · 운영 DB):
 *   COMPLETED 462건 중 `called_at` 6건 · `started_at` 5건 · `completed_at` 462건.
 *   완료 462건 가운데 **456건은 호출도 진료 시작도 진료기록(Encounter)도 없다**
 *   (같은 날 같은 환자의 encounter 존재 = 0건). 그 456건의 `completed_at` 은 네 개의
 *   분 단위 버킷에 몰려 있다(08-14 09:00 241건 · 10:24 150건 · 08-13 10:15 30건 · 08-04 15:46 26건)
 *   — 데모 롤포워드(`dev-demo`)가 초과 WAITING 을 `updateMany` 로 곧장 COMPLETED 로 찍은 흔적이다.
 *   즉 `started_at` 기록률 1.1% 는 **전이 코드의 누락이 아니라, 전이를 건너뛴 합성 행이 분모를 채운 결과**다.
 *
 * 이 스펙이 고정하는 두 가지:
 *   1) 정상 전이(CALLED→IN_CONSULTATION)는 **반드시** `startedAt` 을 남긴다. 그리고 서비스 경로로는
 *      `startedAt` 없이 COMPLETED 에 도달할 수 없다(전이 순서 강제).
 *   2) 🔴 **소급 추정 금지** — `startedAt` 은 전이가 일어난 '지금'이다. 접수 시각·호출 시각에서
 *      역산하거나 보정해 채워 넣지 않는다(모르는 시각은 원장에 박지 않는다).
 *   3) 표본이 없을 때 대기 지표는 0 이 아니라 null(산출 불가)이다 — 0분은 '기다림이 없다'는 다른 사실이다.
 */

const CHECKED_IN = new Date('2026-08-14T00:10:00Z');
const CALLED = new Date('2026-08-14T00:40:00Z');
const NOW = new Date('2026-08-14T01:00:00Z');

function calledQueue(over: Record<string, unknown> = {}) {
  return {
    id: 'q1', patientId: 'p1', doctorId: 'd1', departmentName: '순환기내과', queueNumber: 5,
    status: 'CALLED', checkedInAt: CHECKED_IN, calledAt: CALLED, startedAt: null,
    completedAt: null, encounterId: null, callCount: 1,
    ...over,
  };
}

function makeSvc(queue: Record<string, unknown> | null) {
  const update = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...queue, ...data, patient: { familyName: '홍', givenName: '길동' }, doctor: { familyName: '김', givenName: '의사' } }),
  );
  // 🔴 정본은 진료 시작(Encounter 생성 + 큐 전이)을 한 트랜잭션에서 한다(K1) — 목도 그 모양이어야
  //    콜백 안의 쓰기가 실제로 돈다(목에 `$transaction` 이 없으면 콜백이 아예 실행되지 않는다).
  const prisma: Record<string, unknown> = {
    waitingQueue: { findUnique: vi.fn().mockResolvedValue(queue), update },
    encounter: { create: vi.fn().mockResolvedValue({ id: 'e1' }), findUnique: vi.fn().mockResolvedValue({ status: 'DRAFT' }) },
  };
  prisma.$transaction = vi.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  const svc = new WaitingQueueService(prisma as never, { emit: vi.fn() } as never);
  return { svc, prisma, update };
}

describe('진료 시작 시각(startedAt) 원장 가드', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('CALLED→IN_CONSULTATION 전이는 startedAt 을 반드시 남긴다', async () => {
    const { svc, update } = makeSvc(calledQueue());
    await svc.startConsultation('q1');

    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('IN_CONSULTATION');
    expect(data.startedAt).toBeInstanceOf(Date);
    // 전이와 함께 Encounter 가 연결돼야 '진료가 실제로 열렸다'는 증거가 남는다
    expect(data.encounterId).toBe('e1');
  });

  it('🔴 소급 추정 금지 — startedAt 은 전이 시점(now)이지 접수·호출 시각에서 역산한 값이 아니다', async () => {
    const { svc, update } = makeSvc(calledQueue());
    await svc.startConsultation('q1');

    const startedAt = update.mock.calls[0][0].data.startedAt as Date;
    expect(startedAt.getTime()).toBe(NOW.getTime());
    // 과거 시각을 원장에 박지 않는다
    expect(startedAt.getTime()).not.toBe(CHECKED_IN.getTime());
    expect(startedAt.getTime()).not.toBe(CALLED.getTime());
    expect(startedAt.getTime()).toBeGreaterThan(CALLED.getTime());
  });

  it('호출되지 않은 대기는 진료 시작으로 건너뛸 수 없다 — startedAt 없는 IN_CONSULTATION 차단', async () => {
    const { svc, update, prisma } = makeSvc(calledQueue({ status: 'WAITING', calledAt: null }));
    await expect(svc.startConsultation('q1')).rejects.toThrow('호출 상태가 아닙니다');
    expect(update).not.toHaveBeenCalled();
    expect(prisma.encounter.create).not.toHaveBeenCalled();
  });

  it('진료중이 아닌 건은 완료로 못 간다 — startedAt 없이 completedAt 만 찍히는 행을 서비스가 만들지 않는다', async () => {
    for (const status of ['WAITING', 'CALLED']) {
      const { svc, update } = makeSvc(calledQueue({ status }));
      await expect(svc.complete('q1')).rejects.toThrow('진료 중 상태가 아닙니다');
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('묵은 대기 자동 마감은 시작·완료 시각을 지어내지 않는다(NO_SHOW 상태만 바꾼다)', async () => {
    const stale = [{ id: 'q9', departmentName: '내과' }];
    const update = vi.fn().mockResolvedValue({});
    const prisma = { waitingQueue: { findMany: vi.fn().mockResolvedValue(stale), update } };
    const svc = new WaitingQueueService(
      prisma as never,
      { emit: vi.fn() } as never,
      undefined,
      { get: vi.fn().mockResolvedValue(24) } as never,
    );

    await svc.autoCloseStaleQueues();

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('NO_SHOW');
    expect(data).not.toHaveProperty('startedAt');
    expect(data).not.toHaveProperty('completedAt');
  });
});

describe('대기 지표 — 표본이 없으면 0 이 아니라 산출 불가(null)', () => {
  /** 오늘 접수는 있는데 아무도 진료를 시작하지 않은 상태(운영 실측 2026-08-14 의 모습) */
  const NO_SAMPLE_ROWS = [
    {
      departmentName: '순환기내과', doctorId: 'd1', status: 'WAITING', roomName: '3진료실',
      checkedInAt: CHECKED_IN, startedAt: null,
      doctor: { familyName: '김', givenName: '의사' },
      patient: { familyName: '홍', givenName: '길동' },
      queueNumber: 5, type: 'WALK_IN', visitType: 'INITIAL', calledAt: null, callCount: 0, priorityOrder: 0, id: 'q1',
    },
  ];

  function displaySvc(rows: unknown[]) {
    const prisma = {
      waitingQueue: {
        findMany: vi.fn().mockResolvedValue(rows),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const queueSvc = new WaitingQueueService(prisma as never, { emit: vi.fn() } as never);
    return new QueueDisplayService(prisma as never, queueSvc);
  }

  it('공개 전광판: 표본 0건이면 평균·최장 대기가 null 이고 표본 수를 밝힌다', async () => {
    const res = await displaySvc(NO_SAMPLE_ROWS).getPublicStats();
    const dept = res.data.departments[0];

    expect(dept.waiting).toBe(1);
    // 🔴 종전: 0 → "평균 대기 0분"으로 기다리는 환자에게 기다림이 없다고 말했다
    expect(dept.avgWaitMinutes).toBeNull();
    expect(dept.maxWaitMinutes).toBeNull();
    expect(dept.waitSampleN).toBe(0);
  });

  it('공개 전광판: 표본이 있으면 평균을 말하고 표본 수가 일치한다', async () => {
    const measured = [{
      ...NO_SAMPLE_ROWS[0],
      status: 'COMPLETED',
      startedAt: new Date(CHECKED_IN.getTime() + 20 * 60_000),
    }];
    const dept = (await displaySvc(measured).getPublicStats()).data.departments[0];

    expect(dept.avgWaitMinutes).toBe(20);
    expect(dept.maxWaitMinutes).toBe(20);
    expect(dept.waitSampleN).toBe(1);
  });

  it('진료과 대기 현황판: 표본 0건이면 avgWaitMinutes 는 null 이다', async () => {
    const res = await displaySvc(NO_SAMPLE_ROWS).getDisplay({});
    const stats = res.data.departments[0].stats;

    expect(stats.avgWaitMinutes).toBeNull();
    expect(stats.waitSampleN).toBe(0);
  });
});

describe('환자 대기번호표(getTicket) — 예상 대기시간을 상수로 지어내지 않는다', () => {
  function guideSvc(completedRows: unknown[], hospitalName: string | null = '위루비병원') {
    const queue = {
      id: 'q1', queueNumber: 7, departmentName: '순환기내과', doctorId: 'd1', roomName: '3진료실',
      type: 'WALK_IN', visitType: 'INITIAL', status: 'WAITING', checkedInAt: CHECKED_IN,
      calledAt: null, startedAt: null, completedAt: null, waitingToken: 'tok', callCount: 0,
      patient: { familyName: '홍', givenName: '길동' },
      doctor: { familyName: '김', givenName: '의사' },
    };
    const prisma = {
      waitingQueue: {
        findUnique: vi.fn().mockResolvedValue(queue),
        findFirst: vi.fn().mockResolvedValue(queue),
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue(completedRows),
      },
      // 번호표의 기관명은 정본 `system_configs hospital.name` DB 행에서 온다(종전엔 'Hospital RUN' 상수).
      // 목은 정본의 실제 반환 모양: findMany({where:{key:{in}},select:{key,value}}) → [{key, value}]
      systemConfig: { findMany: vi.fn(async () => (hospitalName ? [{ key: 'hospital.name', value: hospitalName }] : [])) },
    };
    const queueSvc = new WaitingQueueService(prisma as never, { emit: vi.fn() } as never);
    return new QueueDisplayService(prisma as never, queueSvc);
  }

  it('🔴 표본 0건이면 예상 대기시간은 null 이다(종전: 기본 15분을 곱해 그럴듯한 숫자를 만들었다)', async () => {
    const res = await guideSvc([]).getTicket('q1');

    expect(res.data.estimatedWaitMinutes).toBeNull();
    expect(res.data.estimatedWaitSampleN).toBe(0);
    expect(res.data.estimatedWaitBasis).toContain('산출할 수 없습니다');
  });

  /** 🔴 번호표의 기관명은 종전 'Hospital RUN' 상수였다 — 환자가 손에 받는 종이에 제품 이름을 병원 이름으로 찍었다. */
  it('🔴 번호표 기관명은 정본(DB 행)에서 오고, 미설정이면 지어내지 않는다(null)', async () => {
    expect((await guideSvc([]).getTicket('q1')).data.hospital.name).toBe('위루비병원');
    expect((await guideSvc([], null).getTicket('q1')).data.hospital.name).toBeNull();
  });

  it('표본이 있으면 그 표본으로 계산하고 근거를 밝힌다', async () => {
    const rows = [{ checkedInAt: CHECKED_IN, startedAt: new Date(CHECKED_IN.getTime() + 10 * 60_000) }];
    const res = await guideSvc(rows).getTicket('q1');

    expect(res.data.estimatedWaitMinutes).toBe(20); // 평균 10분 × (앞대기 3 + 1) / 2
    expect(res.data.estimatedWaitSampleN).toBe(1);
    expect(res.data.estimatedWaitBasis).toContain('1건');
  });
});
