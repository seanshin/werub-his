import { describe, it, expect, vi } from 'vitest';
import { DevDemoService } from '../../src/modules/dev-demo/dev-demo.service';

/**
 * 데모 날짜 롤포워드 — **일어난 일이 미래에 있으면 안 된다** (2026-08-28).
 *
 * 🔴 실측: 운영 `waiting_queue` 에 `checked_in_at` 이 **오늘 17:22**(현재 09:36)인 행 6건.
 *    롤은 **일 단위**로만 옮기므로, 원래 시각이 지금보다 늦은 행은 이동 후 오늘의 미래가 된다.
 *    접수·호출·진료시작·완료는 *일어난 일*의 시각이라 미래일 수 없다.
 *    (예약 `scheduled_at` 은 반대로 **미래가 정상**이다 — 성격을 구분한다)
 *
 * 🔴 `now()` 로 잘라 붙이지 않는다 — 여러 행이 같은 시각에 쌓여 순서가 사라진다.
 *    미래가 된 행만 **하루 더 되돌린다**(어제 같은 시각 = 실제로 일어난 일).
 *
 * 재주입: `pastOnly` 보정을 지우면 실패한다.
 */
function makeSvc(opts: { offsetDays: number; cnt: number }) {
  const executed: string[] = [];
  const prisma = {
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql.includes('CURRENT_DATE')) return [{ d: '2026-08-28' }];
      return [{ off: opts.offsetDays, cnt: opts.cnt }];
    }),
    $executeRawUnsafe: vi.fn(async (sql: string) => { executed.push(sql); return 1; }),
  };
  const config = { get: vi.fn(async () => true) };
  return { svc: new DevDemoService(prisma as never, config as never), executed };
}

describe('롤포워드 — 미래의 "일어난 일"을 만들지 않는다', () => {
  it('🔴 대기열은 시프트 후 미래 행을 되돌린다', async () => {
    const { svc, executed } = makeSvc({ offsetDays: 3, cnt: 10 });
    await svc.rollForward(false);
    const wq = executed.filter((s) => s.includes('waiting_queue'));
    expect(wq.length, '시프트 + 미래 보정 두 번이어야 한다').toBe(2);
    expect(wq[0]).toContain('make_interval(days => 3)');
    expect(wq[1]).toContain('make_interval(days => 1)');
    expect(wq[1]).toContain('-');
  });

  /**
   * 🔴 미래 판정은 **옮긴 컬럼 전부**를 본다 (2026-09-04 실측 — 감시자 60 적발).
   *    종전 가드는 `WHERE checked_in_at > now()` 를 그대로 검증했다 — **결함 모양을 가드가
   *    보증하고 있었다**(내 가정을 테스트하면 가드가 헛돈다). 접수는 아침·완료만 오후(미래)인
   *    전일 일괄 마감 배치 140건이 anchor 검사를 지나가 매일 아침 미래 대기열 1,000건대를 만들었다.
   */
  it('🔴 미래 보정 WHERE 가 시프트한 5컬럼 전부를 본다 — anchor 하나로는 완료만 미래인 행을 놓친다', async () => {
    const { svc, executed } = makeSvc({ offsetDays: 3, cnt: 10 });
    await svc.rollForward(false);
    const fix = executed.filter((s) => s.includes('waiting_queue'))[1];
    for (const col of ['checked_in_at', 'called_at', 'started_at', 'completed_at', 'created_at']) {
      expect(fix, `${col} 이 미래여도 되돌려야 한다`).toMatch(new RegExp(`${col} > now\\(\\)`));
    }
    // OR 결합 — AND 면 전 컬럼이 동시에 미래일 때만 잡아 사실상 무동작이다
    expect(fix).toMatch(/> now\(\) OR /);
  });

  it('🔴 예약은 되돌리지 않는다 — 미래 예약이 정상이다', async () => {
    const { svc, executed } = makeSvc({ offsetDays: 3, cnt: 10 });
    await svc.rollForward(false);
    const appt = executed.filter((s) => s.includes('appointments'));
    expect(appt.length, '예약은 시프트 한 번뿐이어야 한다').toBe(1);
    expect(appt[0]).not.toContain('now()');
  });

  it('🔴 now() 로 잘라 붙이지 않는다 — 같은 시각에 쌓이면 순서가 사라진다', async () => {
    const { svc, executed } = makeSvc({ offsetDays: 3, cnt: 10 });
    await svc.rollForward(false);
    for (const sql of executed) {
      expect(sql, `시각을 now() 로 덮어쓰면 안 된다: ${sql}`).not.toMatch(/=\s*now\(\)/);
    }
  });

  it('dryRun 은 아무것도 바꾸지 않는다', async () => {
    const { svc, executed } = makeSvc({ offsetDays: 3, cnt: 10 });
    const r = await svc.rollForward(true);
    expect(executed).toEqual([]);
    expect(r.tables.every((t) => t.shifted === 0 && t.futureFixed === 0)).toBe(true);
  });

  it('offset 이 0 이면 시프트하지 않는다(오늘이 이미 최신)', async () => {
    const { svc, executed } = makeSvc({ offsetDays: 0, cnt: 10 });
    await svc.rollForward(false);
    expect(executed).toEqual([]);
  });

  /**
   * 🔴 매일 채우는 대기열은 하루 밀림을 옮기지 않는다(2026-10-01 운영 실측).
   *    9시 크론이 오늘 몫을 만들면 자정의 offset 은 늘 1 — 전 행을 +1일 옮기고 미래가 된 아침 행을 되돌려,
   *    지난 모든 날의 데모 묶음이 '어제'에 쌓였다(WAITING 6,631건 · 39일 치).
   *    재주입: `dailyRefreshed` 판정을 지우면 실패한다.
   */
  it('🔴 대기열은 offset 1(어제 크론 묶음)이면 옮기지 않는다 · 예약은 그대로 옮긴다', async () => {
    const { svc, executed } = makeSvc({ offsetDays: 1, cnt: 10 });
    const r = await svc.rollForward(false);
    expect(executed.filter((s) => s.includes('waiting_queue')), '하루 밀림에 대기열 전 행을 옮기면 날짜가 한 날로 몰린다').toEqual([]);
    expect(r.tables.find((t) => t.table === 'waiting_queue')!.offsetDays).toBe(0);
    expect(executed.filter((s) => s.includes('appointments')).length).toBe(1);
  });

  it('대기열도 하루를 넘게 멈췄으면(크론 미가동) 옮긴다', async () => {
    const { svc, executed } = makeSvc({ offsetDays: 2, cnt: 10 });
    await svc.rollForward(false);
    const wq = executed.filter((s) => s.includes('waiting_queue'));
    expect(wq[0]).toContain('make_interval(days => 2)');
  });

  it('🔴 보정 건수를 응답에 담는다 — 0 이 정상이고, 늘면 신호다', async () => {
    const { svc } = makeSvc({ offsetDays: 3, cnt: 10 });
    const r = await svc.rollForward(false);
    const wq = r.tables.find((t) => t.table === 'waiting_queue')!;
    expect(wq).toHaveProperty('futureFixed');
    expect(r.tables.find((t) => t.table === 'appointments')!.futureFixed).toBe(0);
  });
});
