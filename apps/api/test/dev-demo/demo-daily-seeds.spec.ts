import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DevDemoService } from '../../src/modules/dev-demo/dev-demo.service';

/** 데모 롤포워드 편입 — 진료실 대기/접수 예약 당일 목표치 보충(top-up·롤포워드 시프트와 중복 축적 방지) */
describe('DevDemoService 당일 데모 시드(top-up)', () => {
  let svc: DevDemoService;
  let prisma: any;

  // 🔴 refreshClinicQueue 는 KST 09시 이전 조기 종료(야간 시드 방지) — 실시간으로 돌리면 오전에 플레이크.
  //    Date 만 고정(12:00 KST)해 시각·날짜 모두 결정적으로.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-05T03:00:00Z') });
  });
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    prisma = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'doc-1', department: '내과' }, { id: 'doc-2', department: '외과' }]) },
      patient: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ id: `p-${i}` }))) },
      waitingQueue: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        aggregate: vi.fn().mockResolvedValue({ _max: { queueNumber: null } }),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      clinicSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      appointment: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    svc = new DevDemoService(prisma, { get: vi.fn(async () => true) } as any);
  });

  // 신계약(2026-08 과별 리치니스): 목표치=과별 5~20명(날짜 해시 가변)·목표 초과분은 오래된 순 COMPLETED 마감
  describe('진료실 대기(refreshClinicQueue)', () => {
    it('WAITING 0 → 과별 목표치(5~20)만큼 보충·waitingToken(dcq-) 멱등키', async () => {
      const r = await svc.refreshClinicQueue();
      expect(r.depts).toBe(2);
      expect(r.created).toBeGreaterThanOrEqual(10); // 2개 과 × 최소 5
      expect(r.created).toBeLessThanOrEqual(40); // 2개 과 × 최대 20
      expect(prisma.waitingQueue.create).toHaveBeenCalledTimes(r.created);
      const first = prisma.waitingQueue.create.mock.calls[0][0].data;
      expect(first.waitingToken).toMatch(/^dcq-\d{8}-/);
      expect(first.status).toBe('WAITING');
    });

    /**
     * 🔴 이 스펙이 결함을 계약으로 굳혀두고 있었다 — 화면 실사용 점검 W8(2026-08-14).
     *
     * 롤포워드가 초과 대기분을 `COMPLETED` 로 찍었고 이 단언이 그것을 지켰다.
     * 그런데 그 환자들은 **호출도 진료 시작도 Encounter 도 없다** — 진료를 받은 적이 없다.
     * 실측: COMPLETED 462건 중 456건이 called_at·started_at·encounter_id 전부 NULL,
     *       completed_at 이 분 단위 네 버킷에 몰려 있고, 같은 날 encounter 가 있는 것은 0건.
     * 그래서 "오늘 완료 462건"이라는 처리량 실적이 허구였고, 대기 지표의 분모까지 오염됐다.
     *
     * 진료를 받지 않았으면 완료가 아니다. CANCELLED 는 이 저장소 집계 규약상
     * **대기에도 완료에도 세지 않는** 상태이며 정확히 이 경우를 위한 것이다.
     * (NO_SHOW 는 '오지 않았다'는 뜻이라 접수 기록이 있는 이들에게는 틀린 말이다.)
     */
    it('목표 초과(WAITING 25) → 생성 0·초과분은 진료 없이 마감이므로 완료가 아니라 취소', async () => {
      prisma.waitingQueue.findMany.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: `w-${i}` })));
      const r = await svc.refreshClinicQueue();
      expect(r.created).toBe(0);
      expect(prisma.waitingQueue.create).not.toHaveBeenCalled();
      expect(prisma.waitingQueue.updateMany).toHaveBeenCalled();

      // 초과분 마감 호출(id 목록) — 첫 호출은 전일 데모 마감(아래 스펙)
      const call = prisma.waitingQueue.updateMany.mock.calls.find((c: any) => c[0].where.id);
      const data = call[0].data;
      expect(data.status).toBe('CANCELLED');
      expect(data.status).not.toBe('COMPLETED'); // 진료 실적으로 세지 않는다
      expect(String(data.reason)).toContain('진료 없이 마감');
    });

    /**
     * 🔴 지난 날짜의 데모 대기는 닫는다(2026-10-01 운영 실측 — 서로 다른 39일 치 데모 묶음 WAITING 6,631건이 '어제'에 쌓여 있었다).
     *    종전엔 오늘 창의 초과분만 마감해 어제로 밀린 묶음은 영원히 '대기'였다.
     *    재주입: 전일 마감 블록을 지우면 실패한다.
     */
    it('🔴 전일 데모 접수(dcq-)가 대기·호출이면 진료 없이 마감 — 사람 접수·오늘 행은 건드리지 않는다', async () => {
      prisma.waitingQueue.updateMany.mockResolvedValueOnce({ count: 6631 });
      const r = await svc.refreshClinicQueue();
      expect(r.closedStale).toBe(6631);
      const call = prisma.waitingQueue.updateMany.mock.calls.find((c: any) => c[0].where.waitingToken);
      expect(call, '전일 데모 마감 호출이 있어야 한다').toBeTruthy();
      const { where, data } = call[0];
      expect(where.waitingToken).toEqual({ startsWith: 'dcq-' }); // 데모 생성분만
      expect(where.status).toEqual({ in: ['WAITING', 'CALLED'] });
      // 오늘 KST 00시(= 2026-08-04T15:00Z) 이전만 — 오늘 행은 남는다
      expect(where.checkedInAt).toEqual({ lt: new Date('2026-08-04T15:00:00Z') });
      expect(data.status).toBe('CANCELLED');
      expect(String(data.reason)).toContain('전일 미진료 마감');
    });

    /**
     * (2026-10-01) 진료실 — 실제 접수와 같은 규칙(의사 진료 일정 · KST 요일 · 시간대 우선, 없으면 ALL). 종전 데모 대기는 진료실이 비어
     *    통합 상황판 3D 가 오늘 대기 전부를 "진료실 미지정"으로 그렸다. 일정 없는 의사는 비운다(지어내지 않는다).
     */
    it('🔴 새 데모 대기는 의사 진료 일정의 진료실을 싣는다 · 시간대 일정이 ALL 보다 먼저 · 일정 없으면 null', async () => {
      prisma.clinicSchedule.findMany.mockResolvedValue([
        { doctorId: 'doc-1', roomName: '내과 종일실', period: 'ALL' },
        { doctorId: 'doc-1', roomName: '내과 1진료실', period: 'AM' },
      ]);
      await svc.refreshClinicQueue();
      const where = prisma.clinicSchedule.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ dayOfWeek: 3, isActive: true, OR: [{ period: 'AM' }, { period: 'ALL' }] }); // 2026-08-05 12:00 KST = 수요일 오전
      const rows = prisma.waitingQueue.create.mock.calls.map((c: any) => c[0].data);
      expect(rows.filter((r: any) => r.doctorId === 'doc-1').every((r: any) => r.roomName === '내과 1진료실')).toBe(true);
      expect(rows.filter((r: any) => r.doctorId === 'doc-2').every((r: any) => r.roomName === null)).toBe(true);
    });

    it('dryRun 은 전일 데모도 닫지 않는다', async () => {
      await svc.refreshClinicQueue(true);
      expect(prisma.waitingQueue.updateMany).not.toHaveBeenCalled();
    });

    it('부분 소진(WAITING 4) → 부족분(목표-4)만 보충', async () => {
      const full = await svc.refreshClinicQueue(true); // 대기 0일 때의 총 목표치(동일 날짜 해시라 결정적)
      prisma.waitingQueue.findMany.mockResolvedValue(Array.from({ length: 4 }, (_, i) => ({ id: `w-${i}` })));
      const r = await svc.refreshClinicQueue(true);
      expect(r.created).toBe(full.created - 8); // 2개 과 × 4명 재직
    });
  });

  describe('접수 예약(refreshReceptionAppointments)', () => {
    it('오늘 0건 → 20건 생성·결정적 id·CONFIRMED 1/3', async () => {
      const r = await svc.refreshReceptionAppointments();
      expect(r).toBe(20);
      const ids = prisma.appointment.create.mock.calls.map((c: any) => c[0].data.id);
      expect(ids[0]).toMatch(/^a0000000-0000-4000-9000-\d{8}0000$/);
      const confirmed = prisma.appointment.create.mock.calls.filter((c: any) => c[0].data.status === 'CONFIRMED').length;
      expect(confirmed).toBe(7);
    });

    it('시프트분 포함 이미 20건 → 생성 0', async () => {
      prisma.appointment.count.mockResolvedValue(20);
      const r = await svc.refreshReceptionAppointments();
      expect(r).toBe(0);
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('부족 5건 → 5건만 보충', async () => {
      prisma.appointment.count.mockResolvedValue(15);
      const r = await svc.refreshReceptionAppointments();
      expect(r).toBe(5);
      expect(prisma.appointment.create).toHaveBeenCalledTimes(5);
    });
  });

  it('dryRun — 쓰기 없이 부족분만 산정', async () => {
    prisma.waitingQueue.findMany.mockResolvedValue(Array.from({ length: 4 }, (_, i) => ({ id: `w-${i}` })));
    prisma.appointment.count.mockResolvedValue(12);
    const q = await svc.refreshClinicQueue(true);
    const a = await svc.refreshReceptionAppointments(true);
    expect(q.created).toBeGreaterThanOrEqual(2); // 과별 최소 목표 5 - 4 = 1 × 2과
    expect(a).toBe(8);
    expect(prisma.waitingQueue.create).not.toHaveBeenCalled();
    expect(prisma.waitingQueue.updateMany).not.toHaveBeenCalled();
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });
});
